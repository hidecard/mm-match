import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@libsql/client';
import 'dotenv/config';

// Check environment variables
if (!process.env.BOT_TOKEN) console.error('BOT_TOKEN is missing');
if (!process.env.TURSO_URL) console.error('TURSO_URL is missing');
if (!process.env.TURSO_TOKEN) console.error('TURSO_TOKEN is missing');

const bot = new Telegraf(process.env.BOT_TOKEN);
let db;

// In-memory session cache for viewed profile IDs (userId -> Set of profileIds)
// Note: This is per-instance cache, works best for warm serverless functions
const sessionViewedCache = new Map();

// Live stats tracking - Queries real database data
const stats = {
    // In-memory for quick match tracking
    todayMatches: 0,
    lastMatchDate: new Date().toDateString(),
    cachedTotalUsers: 0,
    lastCacheTime: 0,
    
    addMatch() {
        const today = new Date().toDateString();
        if (this.lastMatchDate !== today) {
            this.todayMatches = 0;
            this.lastMatchDate = today;
        }
        this.todayMatches++;
    },
    
    // Get real stats from database
    async getRealStats() {
        if (!db) return { online: 0, matches: 0, total: 0 };
        
        try {
            // Get total registered users (always fresh data)
            const totalResult = await db.execute({
                sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1",
                args: []
            });
            const totalUsers = totalResult.rows[0]?.count || 0;
            
            // Get total mutual matches (all time)
            const matchesResult = await db.execute({
                sql: "SELECT COUNT(*) as count FROM likes l WHERE EXISTS (SELECT 1 FROM likes l2 WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user)",
                args: []
            });
            const totalMatches = Math.floor((matchesResult.rows[0]?.count || 0) / 2);
            
            console.log('Real stats - Users:', totalUsers, 'Matches:', totalMatches);
            
            return {
                online: totalUsers,  // Total registered users
                matches: totalMatches, // Total mutual matches
                total: totalUsers
            };
        } catch (error) {
            console.error('Error getting real stats:', error);
            return {
                online: 0,
                matches: 0,
                total: 0
            };
        }
    },
    
    // Legacy sync method for compatibility
    getStats() {
        const today = new Date().toDateString();
        if (this.lastMatchDate !== today) {
            this.todayMatches = 0;
            this.lastMatchDate = today;
        }
        return {
            online: this.cachedTotalUsers,
            matches: this.todayMatches
        };
    }
};

// Helper to add viewed ID to session cache
const addToSessionViewed = (userId, profileId) => {
    if (!sessionViewedCache.has(userId)) {
        sessionViewedCache.set(userId, new Set());
    }
    sessionViewedCache.get(userId).add(profileId);
    // Limit cache size per user to prevent memory issues
    if (sessionViewedCache.get(userId).size > 50) {
        const entries = Array.from(sessionViewedCache.get(userId));
        sessionViewedCache.set(userId, new Set(entries.slice(-30)));
    }
};

// Helper to get session viewed IDs as array
const getSessionViewed = (userId) => {
    return sessionViewedCache.has(userId) ? Array.from(sessionViewedCache.get(userId)) : [];
};

try {
    db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
} catch (error) {
    console.error('Database connection error:', error);
}

const migrateLocationSchema = async () => {
    if (!db) return;

    const migrations = [
        { sql: 'ALTER TABLE users ADD COLUMN latitude REAL', name: 'latitude' },
        { sql: 'ALTER TABLE users ADD COLUMN longitude REAL', name: 'longitude' },
        { sql: 'ALTER TABLE users ADD COLUMN interests TEXT', name: 'interests' }
    ];

    for (const migration of migrations) {
        try {
            await db.execute({ sql: migration.sql });
            console.log(`Migrated users table: added ${migration.name} column`);
        } catch (error) {
            if (!/duplicate column|already exists/i.test(error.message)) {
                console.error(`Location schema migration error (${migration.name}):`, error);
            }
        }
    }

    try {
        await db.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_location ON users(latitude, longitude) WHERE is_registered = 1' });
    } catch (error) {
        console.error('Location index migration error:', error);
    }

    try {
        await db.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_interests ON users(interests)' });
    } catch (error) {
        console.error('Location index migration error:', error);
    }
};

migrateLocationSchema().catch((error) => console.error('Location schema migration failed:', error));

// --- Helper Functions ---
const getUser = async (id) => {
    try {
        if (!db) return null;
        const result = await db.execute({ sql: "SELECT * FROM users WHERE telegram_id = ?", args: [id] });
        return result.rows[0];
    } catch (error) {
        console.error('Error in getUser:', error);
        return null;
    }
};

// Calculate distance between two coordinates using Haversine formula (in km)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
};

const isRealLocation = (location) => {
    return location && typeof location.latitude === 'number' && typeof location.longitude === 'number';
};

const saveSharedLocation = async (ctx, nextStep) => {
    const latitude = ctx.message.location.latitude;
    const longitude = ctx.message.location.longitude;
    const addressText = ctx.message.text?.trim() || 'Location shared';
    await db.execute({
        sql: "UPDATE users SET address = ?, latitude = ?, longitude = ?, step = ? WHERE telegram_id = ?",
        args: [addressText, latitude, longitude, nextStep, ctx.from.id]
    });
};

const RESERVED_USER_INPUTS = new Set([
    '/start', '/find', '/nearby', '/help', '/pulse', '/profile', '/edit', '/cancel',
    '🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse', '⚙️ Edit Profile', '👤 Profile', '✨ Daily Spark', '❌ Delete Account',
    '📝 Nickname', '🎂 Age', '🏠 Address', '📷 Photo', '📄 Bio', '📍 Share My Location'
]);

// Helper to format interests string into hashtag list
const formatInterests = (interestsText) => {
    if (!interestsText) return '';
    // split by comma or whitespace, keep words prefixed with #
    const parts = interestsText.split(/[,;]+|\s#|\s+/).map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    const tags = parts.map(p => p.startsWith('#') ? p : `#${p}`);
    return tags.join(' ');
};

const isReservedUserInput = (text) => {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim();
    if (clean.startsWith('/')) return true;
    return RESERVED_USER_INPUTS.has(clean) || RESERVED_USER_INPUTS.has(clean.toLowerCase());
};

const reservedInputReply = async (ctx) => {
    return await ctx.reply("ဒီအဆင့်မှာ command button မနှိပ်ပါနဲ့။ သင့်ဖြည့်ရမည့် အချက်အလက်ကို စာရိုက်ထည့်ပေးပါ။");
};

const getRandomProfile = async (userId, lookingFor, viewedIds = []) => {
    try {
        // Get current user's location and max distance preference
        const currentUser = await getUser(userId);
        const userLat = currentUser?.latitude;
        const userLon = currentUser?.longitude;
        const maxDistance = currentUser?.max_distance_km || 50;
        
        // Build the NOT IN clause for session viewed IDs (temporary - only current session)
        const allViewedIds = [...viewedIds];
        const notInClause = allViewedIds.length > 0 
            ? `AND u.telegram_id NOT IN (${allViewedIds.map(() => '?').join(',')})`
            : '';
        const notInArgs = allViewedIds.length > 0 ? allViewedIds : [];
        
        // Main query: exclude session viewed + exclude LIKED profiles + exclude PERMANENTLY VIEWED profiles + exclude BANNED users
        try {
            let sql, args;
            
            if (userLat != null && userLon != null && maxDistance < 9999) {
                // Use bounding box approximation for location filtering (1 degree ≈ 111 km)
                const latDelta = maxDistance / 111;
                const lonDelta = maxDistance / (111 * Math.cos(userLat * Math.PI / 180));
                
                sql = `SELECT u.* FROM users u 
                          LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                          WHERE u.is_registered = 1 
                            AND u.telegram_id != ? 
                            AND u.gender = ? 
                            AND u.is_banned = 0
                            AND u.is_shadowbanned = 0
                            AND pv.viewed_profile_id IS NULL
                            AND u.telegram_id NOT IN (
                                SELECT to_user FROM likes WHERE from_user = ?
                            )
                            AND u.latitude IS NOT NULL
                            AND u.longitude IS NOT NULL
                            AND u.latitude BETWEEN ? AND ?
                            AND u.longitude BETWEEN ? AND ?
                            ${notInClause}
                          ORDER BY RANDOM() LIMIT 1`;
                
                args = [userId, userId, lookingFor, userId, 
                       userLat - latDelta, userLat + latDelta,
                       userLon - lonDelta, userLon + lonDelta,
                       ...notInArgs];
            } else {
                // No location filtering
                sql = `SELECT u.* FROM users u 
                          LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                          WHERE u.is_registered = 1 
                            AND u.telegram_id != ? 
                            AND u.gender = ? 
                            AND u.is_banned = 0
                            AND u.is_shadowbanned = 0
                            AND pv.viewed_profile_id IS NULL
                            AND u.telegram_id NOT IN (
                                SELECT to_user FROM likes WHERE from_user = ?
                            )
                            ${notInClause}
                          ORDER BY RANDOM() LIMIT 1`;
                
                args = [userId, userId, lookingFor, userId, ...notInArgs];
            }
            
            console.log('Fetching random profile with viewedIds:', allViewedIds.length);
            const unviewedResult = await db.execute({ sql, args });
            
            if (unviewedResult.rows.length > 0) {
                // Precise distance filtering for location-based results
                if (userLat != null && userLon != null && maxDistance < 9999) {
                    const profile = unviewedResult.rows[0];
                    if (profile.latitude != null && profile.longitude != null) {
                        const distance = calculateDistance(userLat, userLon, profile.latitude, profile.longitude);
                        if (distance <= maxDistance) {
                            return profile;
                        }
                    }
                } else {
                    return unviewedResult.rows[0];
                }
            }
            
            // If no results with strict filtering, try without session viewed IDs (but keep liked and permanently viewed exclusion)
            if (allViewedIds.length > 0) {
                console.log('No new profiles in session, clearing session cache and retrying with database history...');
                sessionViewedCache.delete(userId);
                
                let fallbackSql, fallbackArgs;
                
                if (userLat != null && userLon != null && maxDistance < 9999) {
                    const latDelta = maxDistance / 111;
                    const lonDelta = maxDistance / (111 * Math.cos(userLat * Math.PI / 180));
                    
                    fallbackSql = `SELECT u.* FROM users u 
                                   LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                                   WHERE u.is_registered = 1 
                                     AND u.telegram_id != ? 
                                     AND u.gender = ? 
                                     AND u.is_banned = 0
                                     AND u.is_shadowbanned = 0
                                     AND pv.viewed_profile_id IS NULL
                                     AND u.telegram_id NOT IN (
                                         SELECT to_user FROM likes WHERE from_user = ?
                                     )
                                     AND u.latitude IS NOT NULL
                                     AND u.longitude IS NOT NULL
                                     AND u.latitude BETWEEN ? AND ?
                                     AND u.longitude BETWEEN ? AND ?
                                   ORDER BY RANDOM() LIMIT 1`;
                    
                    fallbackArgs = [userId, userId, lookingFor, userId,
                                  userLat - latDelta, userLat + latDelta,
                                  userLon - lonDelta, userLon + lonDelta];
                } else {
                    fallbackSql = `SELECT u.* FROM users u 
                                   LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                                   WHERE u.is_registered = 1 
                                     AND u.telegram_id != ? 
                                     AND u.gender = ? 
                                     AND u.is_banned = 0
                                     AND u.is_shadowbanned = 0
                                     AND pv.viewed_profile_id IS NULL
                                     AND u.telegram_id NOT IN (
                                         SELECT to_user FROM likes WHERE from_user = ?
                                     )
                                   ORDER BY RANDOM() LIMIT 1`;
                    
                    fallbackArgs = [userId, userId, lookingFor, userId];
                }
                
                const fallbackResult = await db.execute({ sql: fallbackSql, args: fallbackArgs });
                
                if (fallbackResult.rows.length > 0) {
                    if (userLat != null && userLon != null && maxDistance < 9999) {
                        const profile = fallbackResult.rows[0];
                        if (profile.latitude != null && profile.longitude != null) {
                            const distance = calculateDistance(userLat, userLon, profile.latitude, profile.longitude);
                            if (distance <= maxDistance) {
                                return profile;
                            }
                        }
                    } else {
                        return fallbackResult.rows[0];
                    }
                }
            }
        } catch (dbError) {
            console.error('Profile query failed:', dbError.message);
        }
        
        // Fallback: get any random profile (excluding liked and permanently viewed and banned users)
        const allResult = await db.execute({
            sql: `SELECT u.* FROM users WHERE u.is_registered = 1 
                  AND u.telegram_id != ? 
                  AND u.gender = ? 
                  AND u.is_banned = 0
                  AND u.is_shadowbanned = 0
                  AND u.telegram_id NOT IN (
                      SELECT to_user FROM likes WHERE from_user = ?
                  )
                  AND u.telegram_id NOT IN (
                      SELECT viewed_profile_id FROM profile_views WHERE user_id = ?
                  )
                  ORDER BY RANDOM() LIMIT 1`,
            args: [userId, lookingFor, userId, userId]
        });
        
        if (allResult.rows.length > 0) {
            if (userLat != null && userLon != null && maxDistance < 9999) {
                const profile = allResult.rows[0];
                if (profile.latitude != null && profile.longitude != null) {
                    const distance = calculateDistance(userLat, userLon, profile.latitude, profile.longitude);
                    if (distance <= maxDistance) {
                        return profile;
                    }
                }
            } else {
                return allResult.rows[0];
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error in getRandomProfile:', error);
        return null;
    }
};

const markProfileAsViewed = async (userId, profileId) => {
    try {
        if (!db) return;
        await db.execute({
            sql: "INSERT OR IGNORE INTO profile_views (user_id, viewed_profile_id) VALUES (?, ?)",
            args: [userId, profileId]
        });
    } catch (error) {
        console.error('Error marking profile as viewed:', error.message);
    }
};

// --- 1. Registration Logic ---
bot.start(async (ctx) => {
    try {
        const userId = ctx.from.id;
        
        if (!db) {
            return await ctx.reply("Database မချိတ်ဆက်နိုင်ပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
        }
        
        // Check if user already exists
        const existingUser = await getUser(userId);
        
        if (existingUser && existingUser.is_registered) {
            // Returning user - Welcome Back!
            // Get real stats for monthly user count
            const realStats = await stats.getRealStats();
            const totalUsers = realStats.total || 0;
            const totalMatches = realStats.matches || 0;
            
            const welcomeBackText = `🎉 **ပြန်လည်ကြိုဆိုပါတယ်!**

📊 **Matching Pulse (Live Stats):**
• အဖွဲ့ဝင်စုစုပေါင်း: ${totalUsers.toLocaleString()} ဦး
• ဖူးစာဆုံသွားသူများ: ${totalMatches.toLocaleString()} စုံ

${existingUser.nickname} မင်္ဂလာပါ! MM Cupid မှာ ပြန်လည်တွေ့ဆုံရတာ ဝမ်းသာပါတယ်။ 💕

---

✨ **MM Cupid ၏ ထူးခြားဆန်းသစ်သော Features များ:**

📍 **အနီးနားရှိသူများကို ရှာဖွေခြင်း (Distance Filtering)**
သင့်ရဲ့ လက်ရှိ Location ကို မျှဝေပြီး မိမိပတ်ဝန်းကျင် (10km, 25km, 50km သို့မဟုတ် စိတ်ကြိုက် Radius) အတွင်းရှိ ဖူးစာရှင်များကို စစ်ထုတ်ရှာဖွေနိုင်သည်။

🕵️‍♂️ **လုံခြုံစိတ်ချရသော အမည်ဝှက် Chat စနစ် (In-Bot Anonymous Chat)**
အပြန်အလှန် Like ဖြစ်သွားပါက Bot ထဲတွင် တိုက်ရိုက် အမည်ဝှက် Chat နိုင်မည်။ နှစ်ဦးလုံး သဘောတူညီမှသာ မိမိ၏ Telegram Username ကို ဖွင့်ပြမည့် (Identity Reveal) စနစ်ပါဝင်သဖြင့် လုံခြုံမှု ၁၀၀% ရှိသည်။

⚡ **နေ့စဉ်ခံစားချက်ပြသခြင်း (Daily Sparks)**
မိမိ၏ လက်ရှိ Mood သို့မဟုတ် လှုပ်ရှားမှုကို ၂၄ နာရီ ခေတ္တ status အဖြစ် အီမိုဂျီဖြင့် တင်ထားနိုင်သည်။

💌 **စာသားဖြင့် Like လုပ်ခြင်း (Like with Message)**
ပရိုဖိုင်ကို သဘောကျရုံတင်မကဘဲ တစ်ခါတည်း လျှို့ဝှက်စာသားပါ တွဲပို့ပြီး ပိုမို ရင်းနှီးစွာ စတင်ချိတ်ဆက်နိုင်သည်။

---

သင့်ရဲ့ Profile အချက်အလက်များက အောက်ပါအတိုင်းဖြစ်ပါတယ်။ 👇`;
            
            await ctx.reply(welcomeBackText, { parse_mode: 'Markdown' });
            
            // Show their profile
            const profileCaption = `👤 *Your Profile*\n\n` +
                `📝 ${existingUser.nickname} (${existingUser.age})\n` +
                `📍 ${existingUser.address}\n` +
                `🧬 ${existingUser.gender?.toUpperCase()}\n` +
                `💕 Looking for: ${existingUser.looking_for?.toUpperCase()}\n\n` +
                `📝 ${existingUser.bio}`;
            
            try {
                await ctx.replyWithPhoto(existingUser.photo_id, { 
                    caption: profileCaption,
                    parse_mode: 'Markdown'
                });
            } catch (e) {
                await ctx.reply(profileCaption, { parse_mode: 'Markdown' });
            }
            
            // Show main menu
            return await ctx.reply(
                `🔥 သင့်ဖူးစာရှင်ကို စတင်ရှာဖွေလိုက်ပါ!`,
                Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize()
            );
        }
        
        // New user or incomplete registration
        if (existingUser && !existingUser.is_registered) {
            // User started but didn't finish - continue where they left off
            const stepMessages = {
                'ask_name': 'နာမည်ကို ဆက်ရိုက်ထည့်ပေးပါ (Nickname):',
                'ask_age': 'အသက်ကို ဂဏန်းဖြင့် ဆက်ရိုက်ထည့်ပေးပါ:',
                'ask_address': 'နေရပ်ကို ဆက်ရိုက်ထည့်ပေးပါ:',
                'ask_photo': 'သင့်ပုံကို ပို့ပေးပါ:',
                'ask_bio': 'ကိုယ်ရေးတင်ပြချက်ကို ဆက်ရိုက်ထည့်ပေးပါ (Bio):',
                'ask_gender': 'သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):',
                'ask_looking_for': 'ဘယ်လိင်ရဲ့ လူကို ရှာနေသလဲ (Male သို့မဟုတ် Female):',
                'edit_menu': 'ဘာကိုပြင်ဆင်ချင်ပါသလဲ။'
            };
            
            const continueText = `👋 ပြန်လာတာကို ကြိုဆိုပါတယ်!

မှတ်ပုံတင်ခြင်းကို ဆက်လုပ်ရန်: ${stepMessages[existingUser.step] || 'စတင်ဖို့ သင့်နာမည်ကို ပြောပြပေးပါ:'}`;
            
            await ctx.reply(continueText);
            
            // Show appropriate keyboard based on step
            if (['ask_gender', 'ask_looking_for'].includes(existingUser.step)) {
                return await ctx.reply("ရွေးချယ်ပါ:", Markup.keyboard([['Male', 'Female']]).resize());
            }
            return;
        }
        
        // Completely new user
        // Get real stats for monthly user count
        const realStats = await stats.getRealStats();
        const totalUsers = realStats.total || 0;
        const totalMatches = realStats.matches || 0;
        
        const welcomeMessage = `🎉 **MM Cupid - မြန်မာ့ပထမဆုံး AI & Location-based ဖူးစာရှင်ရှာဖွေရေး ဘော့**

📊 **Matching Pulse (Live Stats):**
• အဖွဲ့ဝင်စုစုပေါင်း: ${totalUsers.toLocaleString()} ဦး
• ဖူးစာဆုံသွားသူများ: ${totalMatches.toLocaleString()} စုံ

---

✨ **MM Cupid ၏ ထူးခြားဆန်းသစ်သော Features များ:**

📍 **အနီးနားရှိသူများကို ရှာဖွေခြင်း (Distance Filtering)**
သင့်ရဲ့ လက်ရှိ Location ကို မျှဝေပြီး မိမိပတ်ဝန်းကျင် (10km, 25km, 50km သို့မဟုတ် စိတ်ကြိုက် Radius) အတွင်းရှိ ဖူးစာရှင်များကို စစ်ထုတ်ရှာဖွေနိုင်သည်။

🕵️‍♂️ **လုံခြုံစိတ်ချရသော အမည်ဝှက် Chat စနစ် (In-Bot Anonymous Chat)**
အပြန်အလှန် Like ဖြစ်သွားပါက Bot ထဲတွင် တိုက်ရိုက် အမည်ဝှက် Chat နိုင်မည်။ နှစ်ဦးလုံး သဘောတူညီမှသာ မိမိ၏ Telegram Username ကို ဖွင့်ပြမည့် (Identity Reveal) စနစ်ပါဝင်သဖြင့် လုံခြုံမှု ၁၀၀% ရှိသည်။

⚡ **နေ့စဉ်ခံစားချက်ပြသခြင်း (Daily Sparks)**
မိမိ၏ လက်ရှိ Mood သို့မဟုတ် လှုပ်ရှားမှုကို ၂၄ နာရီ ခေတ္တ status အဖြစ် အီမိုဂျီဖြင့် တင်ထားနိုင်သည်။

💌 **စာသားဖြင့် Like လုပ်ခြင်း (Like with Message)**
ပရိုဖိုင်ကို သဘောကျရုံတင်မကဘဲ တစ်ခါတည်း လျှို့ဝှက်စာသားပါ တွဲပို့ပြီး ပိုမို ရင်းနှီးစွာ စတင်ချိတ်ဆက်နိုင်သည်။

---

📋 **အကောင့်ဖွင့်ရန် လွယ်ကူသော အဆင့် ၈ ဆင့်:**
1️⃣ နာမည် (Nickname)
2️⃣ အသက် (Age)
3️⃣ နေရပ်မြို့နယ် (Location)
4️⃣ ပရိုဖိုင်ဓာတ်ပုံ (Photo)
5️⃣ ကိုယ်ရေးအကျဉ်း (Bio)
6️⃣ မိမိလိင် (Gender)
7️⃣ ရှာဖွေလိုသောလိင် (Preferences)
8️⃣ ရှာဖွေလိုသောအကွာအဝေး (Distance Radius)

🛡️ *ယောက်ျားလေးများသည် မိန်းကလေးများကိုသာ မြင်ရပြီး၊ မိန်းကလေးများသည် ယောက်ျားလေးများကိုသာ အပြန်အလှန် မြင်တွေ့ရမည့် စနစ်ဖြစ်သည်။*

---
🚀 ဖူးစာရှင်ရှာဖွေရေး ဂိမ်းကို စတင်ရန် **အဆင့် (၁) - သင့်ရဲ့ နာမည် (သို့မဟုတ်) အသုံးပြုချင်တဲ့ Nickname** ကို အောက်တွင် ရိုက်ပို့ပေးပါဦး ခင်ဗျာ 👇`;

        await db.execute({ 
            sql: "INSERT OR IGNORE INTO users (telegram_id, username, step) VALUES (?, ?, 'ask_name')", 
            args: [userId, ctx.from.username || 'none'] 
        });
        await ctx.reply(welcomeMessage);
    } catch (error) {
        console.error('Start command error:', error);
        await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
});

bot.on('message', async (ctx) => {
    if (!ctx.message) return;
    
    const user = await getUser(ctx.from.id);
    const text = ctx.message.text;
    
    if (!user) return;

    // Handle chat mode - proxy message routing
    if (user.step === 'chat_mode') {
        // Check if it's a keyboard button first
        if (text === '🔓 လျှို့ဝှက်ချက်ဖွင့်ပြမည်') {
            // Get chat session
            const sessionResult = await db.execute({
                sql: "SELECT matched_user_id FROM chat_sessions WHERE user_id = ?",
                args: [ctx.from.id]
            });
            
            if (sessionResult.rows.length > 0) {
                const matchedUserId = sessionResult.rows[0].matched_user_id;
                const sender = await getUser(ctx.from.id);
                
                // Send reveal request to partner
                await bot.telegram.sendMessage(matchedUserId, 
                    `🔓 *${sender.nickname}* မှ သူ့ရဲ့ Telegram Username ကို ပြသရန် ခွင့်ပြုချက်တောင်းခံနေပါသည်။ သင်ကော ပြသရန် သဘောတူပါသလား?`,
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('👍 သဘောတူသည်', `reveal_accept_${ctx.from.id}`)],
                            [Markup.button.callback('👎 ငြင်းပယ်မည်', `reveal_reject_${ctx.from.id}`)]
                        ])
                    }
                );
                
                await ctx.reply('🔓 ခွင့်ပြုချက်တောင်းခံပြီးပါပြီ။ သူ့ဘက်က အဖြေစောင်းနေပါသည်။');
            }
            return;
        }
        
        if (text === '❌ Chat မှထွက်မည်') {
            // Delete chat session
            await db.execute({
                sql: "DELETE FROM chat_sessions WHERE user_id = ?",
                args: [ctx.from.id]
            });
            
            // Reset user step
            await db.execute({
                sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?",
                args: [ctx.from.id]
            });
            
            await ctx.reply('❌ Chat မှ ထွက်ပြီးပါပြီ။', Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
            return;
        }
        
        if (text === '🚨 Report / Block') {
            // Get chat session
            const sessionResult = await db.execute({
                sql: "SELECT matched_user_id FROM chat_sessions WHERE user_id = ?",
                args: [ctx.from.id]
            });
            
            if (sessionResult.rows.length > 0) {
                const matchedUserId = sessionResult.rows[0].matched_user_id;
                
                // Exit chat first
                await db.execute({
                    sql: "DELETE FROM chat_sessions WHERE user_id = ?",
                    args: [ctx.from.id]
                });
                
                await db.execute({
                    sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?",
                    args: [ctx.from.id]
                });
                
                // Show report options
                await ctx.reply('🚨 Report အကြောင်းကို ရွေးပါ:', Markup.inlineKeyboard([
                    [Markup.button.callback('Fake Profile', `report_fake_${matchedUserId}`)],
                    [Markup.button.callback('Spam', `report_spam_${matchedUserId}`)],
                    [Markup.button.callback('Inappropriate', `report_inappropriate_${matchedUserId}`)]
                ]));
            }
            return;
        }
        if (text === '🚫 Block & Unmatch') {
            // Immediate unmatch and chat close without revealing names
            try {
                const sessionResult = await db.execute({ sql: "SELECT matched_user_id FROM chat_sessions WHERE user_id = ?", args: [ctx.from.id] });
                if (sessionResult.rows.length === 0) {
                    return await ctx.reply('Chat session မတွေ့ပါ။');
                }

                const matchedUserId = sessionResult.rows[0].matched_user_id;
                const userId = ctx.from.id;

                // Remove chat sessions for both users if exist
                await db.execute({ sql: "DELETE FROM chat_sessions WHERE user_id = ? OR user_id = ? OR matched_user_id = ? OR matched_user_id = ?", args: [userId, matchedUserId, userId, matchedUserId] });

                // Remove likes between users
                await db.execute({ sql: "DELETE FROM likes WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)", args: [userId, matchedUserId, matchedUserId, userId] });

                // Remove match record if exists
                const userOne = Math.min(userId, matchedUserId);
                const userTwo = Math.max(userId, matchedUserId);
                await db.execute({ sql: "DELETE FROM matches WHERE user_one = ? AND user_two = ?", args: [userOne, userTwo] });

                // Mark both users' steps as done (exit chat mode)
                await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id IN (?, ?)", args: [userId, matchedUserId] });

                // Optionally create a lightweight report entry for admin review
                try {
                    await db.execute({ sql: "INSERT INTO reports (reporter_id, reported_user_id, reason, description) VALUES (?, ?, 'blocked_unmatch', 'User blocked and unmatched via chat')", args: [userId, matchedUserId] });
                } catch (repErr) {
                    // ignore if reports table missing or other error
                }

                // Notify both sides without revealing identities
                await ctx.reply('✅ Chat ပိတ်ပြီး Match ကို ဖျက်ပြီးပါပြီ။ သင်ထင်ရသလို အရိုင်းစိုင်းမှုများရှိခဲ့လျှင် admin ကို report လုပ်ပေးပါ။');
                try {
                    await bot.telegram.sendMessage(matchedUserId, '❌ တစ်ဦးက သင်နှင့် Match ကို ဖျက်ပြီး Chat ကို ပိတ်ထားသည်။ အကယ်၍ သင်အနေဖြင့် သတင်းပေးချင်ပါက admin ကို ဆက်သွယ်ပါ။');
                } catch (notifyErr) {
                    console.error('Notify partner error:', notifyErr.message);
                }
            } catch (error) {
                console.error('Block & Unmatch error:', error);
                await ctx.reply('စနစ်အမှားတစ်ခုရှိနေပါသည်။ နောက်မှ ထပ်စမ်းပါ။');
            }
            return;
        }
        
        // If not a button, proxy the message
        try {
            // Get chat session
            const sessionResult = await db.execute({
                sql: "SELECT matched_user_id FROM chat_sessions WHERE user_id = ?",
                args: [ctx.from.id]
            });
            
            if (sessionResult.rows.length === 0) {
                // No active chat session, exit chat mode
                await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
                return await ctx.reply("Chat session မတွေ့ပါ။ ပြန်လည်စတင်ပါ။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
            }
            
            const matchedUserId = sessionResult.rows[0].matched_user_id;
            const sender = await getUser(ctx.from.id);
            
            // Handle different message types
            if (ctx.message.text) {
                await bot.telegram.sendMessage(matchedUserId, ctx.message.text);
            } else if (ctx.message.photo) {
                const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                const caption = ctx.message.caption || '';
                await bot.telegram.sendPhoto(matchedUserId, photoId, { caption });
            } else if (ctx.message.voice) {
                const voiceId = ctx.message.voice.file_id;
                await bot.telegram.sendVoice(matchedUserId, voiceId);
            } else if (ctx.message.sticker) {
                const stickerId = ctx.message.sticker.file_id;
                await bot.telegram.sendSticker(matchedUserId, stickerId);
            }
            
            // Show delivered confirmation
            await ctx.reply('✅ ပို့ပြီးပါပြီ');
            
        } catch (error) {
            console.error('Chat message routing error:', error);
            await ctx.reply('စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။');
        }
        return;
    }

    // Handle edit menu
    if (user.step === 'edit_menu') {
        if (text === '📝 Nickname') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_nickname' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("နာမည်အသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        if (text === '🎂 Age') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_age' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("အသက်အသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        if (text === '🏠 Address') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_address' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("📍 သင့်လက်ရှိ Location အသစ်ကို Share လုပ်ပေးပါ\n\nအနီးနားရှိ ဖူးစာရှင်များကို ရှာဖွေရန် Location လိုအပ်ပါသည်။\n\n📱 Telegram ရဲ့ Location ခလုတ်ကို နှိပ်ပြီး သင့်လက်ရှိ Location ကို Share လုပ်ပေးပါ:", Markup.keyboard([Markup.button.locationRequest('📍 Share My Location')]).resize());
        }
        if (text === '📷 Photo') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_photo' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("ပုံအသစ်ကို ပို့ပေးပါ:");
        }
        if (text === '📄 Bio') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_bio' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("Bio အသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        if (text === '🏷️ Interests') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_interests' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("သင့်စိတ်ဝင်စားသော အရာများ (tags) ကို ကော်မားဖြင့် ခွဲပြီး ရိုက်ထည့်ပေးပါ။ ဥပမာ: travel, music, food");
        }
        if (text === '❌ Cancel') {
            await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
        }
    }

    // Handle spark input
    if (user.step === 'ask_spark') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        if (!text || text.trim() === '') {
            return await ctx.reply("စာသားထည့်ပေးပါ။ ပယ်ဖျက်ချင်ရင် /cancel နှိပ်ပါ။");
        }
        
        // Calculate expiration time (24 hours from now)
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        
        await db.execute({
            sql: "UPDATE users SET daily_spark = ?, spark_expires_at = ?, step = 'done' WHERE telegram_id = ?",
            args: [text.trim(), expiresAt, ctx.from.id]
        });
        
        await ctx.reply("✅ Daily Spark တင်ပြီးပါပြီ!\n\nသင့် Profile ကို ဝင်ဆွိုက်တဲ့ သူတွေက ဒီ status ကို ၂၄ နာရီအတွင်း မြင်ရမှာဖြစ်ပါတယ်။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
        return;
    }

    // Handle edit inputs
    if (['edit_nickname', 'edit_age', 'edit_address', 'edit_bio'].includes(user.step)) {
        // Handle edit_address separately to require location
        if (user.step === 'edit_address') {
            if (isRealLocation(ctx.message.location)) {
                await saveSharedLocation(ctx, 'done');
                return await ctx.reply("✅ Location ပြင်ဆင်ပြီးပါပြီ!", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
            }
            if (text && text.trim() !== '') {
                if (isReservedUserInput(text)) return await reservedInputReply(ctx);
                await db.execute({ sql: "UPDATE users SET address = ?, step = 'done' WHERE telegram_id = ?", args: [text.trim(), ctx.from.id] });
                return await ctx.reply("✅ Address ပြင်ဆင်ပြီးပါပြီ!", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
            }
            return await ctx.reply("❌ Location မတွေ့ပါ။\n\n📍 Telegram ကြောင့် အတည်ပြုထားတဲ့ Location ကို Share လုပ်ပေးပါ၊ သို့မဟုတ် သင့်နေရာအမည်ကို ရိုက်ထည့်ပေးပါ:", Markup.keyboard([Markup.button.locationRequest('📍 Share My Location')]).resize());
        }
        
        let updateSql = "";
        let arg = text;
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        if (user.step === 'edit_nickname') updateSql = "UPDATE users SET nickname = ?, step = 'done' WHERE telegram_id = ?";
        if (user.step === 'edit_age') {
            if (isNaN(text)) return await ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
            updateSql = "UPDATE users SET age = ?, step = 'done' WHERE telegram_id = ?";
            arg = parseInt(text);
        }
        if (user.step === 'edit_bio') updateSql = "UPDATE users SET bio = ?, step = 'done' WHERE telegram_id = ?";
        
        await db.execute({ sql: updateSql, args: [arg, ctx.from.id] });
        return await ctx.reply("ပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    }

    if (user.step === 'edit_photo' && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'done' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return await ctx.reply("ပုံပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    }

    if (user.is_registered) return await handleChat(ctx, user);
    
    // Registration flow
    if (user.step === 'ask_name') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'ask_age' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return await ctx.reply("သင့်အသက်ကို ဂဏန်းဖြင့် ရိုက်ထည့်ပေးပါ:");
    }
    if (user.step === 'ask_age') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        if (isNaN(text)) return await ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
        await db.execute({ sql: "UPDATE users SET age = ?, step = 'ask_address' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
        return await ctx.reply("📍 သင့်လက်ရှိ Location ကို Share လုပ်ပေးပါ\n\nအနီးနားရှိ ဖူးစာရှင်များကို ရှာဖွေရန် Location လိုအပ်ပါသည်။\n\n📱 Telegram ရဲ့ Location ခလုတ်ကို နှိပ်ပြီး သင့်လက်ရှိ Location ကို Share လုပ်ပေးပါ:", Markup.keyboard([Markup.button.locationRequest('📍 Share My Location')]).resize());
    }
    if (user.step === 'ask_address') {
        // Handle location message - accept real GPS share or text fallback
        if (isRealLocation(ctx.message.location)) {
            await saveSharedLocation(ctx, 'ask_photo');
            return await ctx.reply("✅ Location သိမ်းပြီးပါပြီ!\n\nသင့်ရဲ့ ပုံလှလှလေးတစ်ပုံ ပို့ပေးပါ (Photo):");
        }
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        if (text && text.trim() !== '') {
            await db.execute({ sql: "UPDATE users SET address = ?, step = 'ask_photo' WHERE telegram_id = ?", args: [text.trim(), ctx.from.id] });
            return await ctx.reply("✅ Address သိမ်းပြီးပါပြီ!\n\nသင့်ရဲ့ ပုံလှလှတစ်ပုံ ပို့ပေးပါ (Photo):");
        }
        return await ctx.reply("❌ Location မတွေ့ပါ။\n\n📍 Telegram ကြောင့် အတည်ပြုထားတဲ့ Location ကို Share လုပ်ပေးပါ၊ သို့မဟုတ် သင့်နေရာအမည်ကို ရိုက်ထည့်ပေးပါ:", Markup.keyboard([Markup.button.locationRequest('📍 Share My Location')]).resize());
    }
    if (ctx.message.photo && user.step === 'ask_photo') {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'ask_bio' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return await ctx.reply("သင့်အကြောင်း အနည်းငယ် ရေးပေးပါ (Bio):");
    }
    if (user.step === 'ask_bio') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        await db.execute({ sql: "UPDATE users SET bio = ?, step = 'ask_gender' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return await ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
    }
    // Handle interests during registration or when user runs /interests
    if (user.step === 'ask_interests' || user.step === 'edit_interests') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);

        // allow skipping interests during initial registration
        if (user.step === 'ask_interests' && text === '/skip') {
            await db.execute({ sql: "UPDATE users SET interests = NULL, is_registered = 1, step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
            await ctx.reply('✅ Registration completed without interests. You can set interests later with /interests', Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
            return;
        }

        if (!text || text.trim() === '') return await ctx.reply('ကျေးဇူးပြု၍ interests (tags) တစ်ခုခု ရိုက်ထည့်ပါ၊ ဥပမာ: travel, music, food');

        // Normalize tags: keep as comma-separated string
        const parts = text.split(/[,;]+|\s+/).map(p => p.trim()).filter(Boolean);
        const normalized = parts.join(',');

        if (user.step === 'ask_interests') {
            // Finalize registration when interests provided during signup
            await db.execute({ sql: "UPDATE users SET interests = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", args: [normalized, ctx.from.id] });
            await ctx.reply('✅ Registration completed! Interests saved: ' + formatInterests(normalized), Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
            return;
        }

        // edit_interests flow
        await db.execute({ sql: "UPDATE users SET interests = ?, step = 'done' WHERE telegram_id = ?", args: [normalized, ctx.from.id] });
        await ctx.reply('✅ Interests သိမ်းပြီးပါပြီ: ' + formatInterests(normalized), Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
        return;
    }
    if (user.step === 'ask_gender') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') return await ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", Markup.keyboard([['Male', 'Female']]).resize());
        await db.execute({ sql: "UPDATE users SET gender = ?, step = 'ask_looking_for' WHERE telegram_id = ?", args: [gender, ctx.from.id] });
        return await ctx.reply("ဘယ်လိင်ရဲ့ လူကို ရှာနေသလဲ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
    }
    if (user.step === 'ask_looking_for') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        const lookingFor = text.toLowerCase();
        if (lookingFor !== 'male' && lookingFor !== 'female') return await ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", Markup.keyboard([['Male', 'Female']]).resize());
        await db.execute({ sql: "UPDATE users SET looking_for = ?, step = 'ask_distance' WHERE telegram_id = ?", args: [lookingFor, ctx.from.id] });
        return await ctx.reply("သင်နှင့် မည်မျှအကွာအဝေးအတွင်း ရှာဖွေချင်ပါသလဲ?\n(ဥပမာ- 10, 25, 50):", Markup.keyboard([['10 km', '25 km', '50 km'], ['100 km', 'Any']]).resize());
    }
    if (user.step === 'ask_distance') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        let distance = 50; // default
        // Clean up text by removing 'km' and extra spaces for matching
        const cleanText = text.toLowerCase().replace('km', '').trim();
        
        if (cleanText === '10') distance = 10;
        else if (cleanText === '20') distance = 20;
        else if (cleanText === '25') distance = 25;
        else if (cleanText === '50') distance = 50;
        else if (cleanText === '100') distance = 100;
        else if (cleanText === 'any') distance = 9999;
        else if (!isNaN(cleanText)) distance = parseInt(cleanText);
        
        try {
            await db.execute({ 
                sql: "UPDATE users SET max_distance_km = ?, step = 'ask_interests' WHERE telegram_id = ?", 
                args: [distance, ctx.from.id] 
            });
            
            const welcomeText = `✅ *အားလုံးအဆင်ပြေသွားပါပြီ။*

အခုဆိုရင် သင်ဟာ MM Cupid ရဲ့ အဖွဲ့ဝင်တစ်ဦး ဖြစ်သွားပါပြီ။ 💕
အောက်က ခလုတ်ကိုနှိပ်ပြီး သင့်ရဲ့ ဖူးစာရှင်ကို စတင်ရှာဖွေနိုင်ပါပြီ။ 👇`;
            
            // Prompt for interests before completing registration
            await ctx.reply('🎯 အကြိုက်ဆုံး အရာ (Interests) များကို ရိုက်ထည့်ပေးပါ။ ဥပမာ: travel, music, food\n\n(မလိုလျှင် /skip ထည့်ပေးပါ)');
            return;
        } catch (dbError) {
            console.error('Registration final update error:', dbError);
            return await ctx.reply("မှတ်ပုံတင်ခြင်း သိမ်းဆည်းရာတွင် အမှားအယွင်းရှိနေပါသည်။ ခေတ္တစောင့်ပြီး ပြန်လည်စမ်းသပ်ပေးပါ။");
        }
    }
});

// --- Discovery & Actions ---
bot.command('deleteaccount', async (ctx) => {
    try {
        const user = await getUser(ctx.from.id);
        if (!user || !user.is_registered) {
            return await ctx.reply("Profile မတွေ့ပါ။ /start နှိပ်ပြီး မှတ်ပုံတင်ပါ။");
        }
        
        await ctx.reply("⚠️ *Account ဖျက်မည်မှာ သေချာပါသလား?*\n\nသင့် Profile နဲ့ အချက်အလက်အားလုံး ပျောက်ပျက်သွားမှာဖြစ်ပါတယ်။", {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ ဖျက်မည်', 'delete_confirm')],
                [Markup.button.callback('ပယ်ဖျက်မည်', 'delete_cancel')]
            ])
        });
    } catch (error) {
        console.error('Delete account command error:', error);
        await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
});

bot.action('delete_confirm', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        
        // Delete user data from all tables
        await db.execute({ sql: "DELETE FROM chat_sessions WHERE user_id = ?", args: [ctx.from.id] });
        await db.execute({ sql: "DELETE FROM chat_sessions WHERE matched_user_id = ?", args: [ctx.from.id] });
        await db.execute({ sql: "DELETE FROM likes WHERE from_user = ? OR to_user = ?", args: [ctx.from.id, ctx.from.id] });
        await db.execute({ sql: "DELETE FROM profile_views WHERE user_id = ? OR viewed_profile_id = ?", args: [ctx.from.id, ctx.from.id] });
        await db.execute({ sql: "DELETE FROM users WHERE telegram_id = ?", args: [ctx.from.id] });
        
        await ctx.reply("❌ သင့် Account ကို ဖျက်ပြီးပါပြီ။\n\nနောက်ထပ် ပါဝင်ချင်ရင် /start နှိပ်ပါ။");
    } catch (error) {
        console.error('Delete confirm error:', error);
        await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
});

bot.action('delete_cancel', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        await ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    } catch (error) {
        console.error('Delete cancel error:', error);
    }
});

bot.command('spark', async (ctx) => {
    try {
        const user = await getUser(ctx.from.id);
        if (!user || !user.is_registered) {
            return await ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ သုံးနိုင်ပါမယ်။ /start နှိပ်ပါ။");
        }
        
        // Clean up expired spark if exists
        if (user.daily_spark && user.spark_expires_at) {
            const now = new Date();
            const expiresAt = new Date(user.spark_expires_at);
            if (now >= expiresAt) {
                await db.execute({
                    sql: "UPDATE users SET daily_spark = NULL, spark_expires_at = NULL WHERE telegram_id = ?",
                    args: [ctx.from.id]
                });
            }
        }
        
        // Set user step to ask for spark
        await db.execute({
            sql: "UPDATE users SET step = 'ask_spark' WHERE telegram_id = ?",
            args: [ctx.from.id]
        });
        
        await ctx.reply("✨ *Daily Spark* တင်ပါ\n\nဒီနေ့ ဘာလုပ်ချင်လဲဆိုတဲ့ အခြေအနေကို Emoji လေးနဲ့ ရေးပေးပါ။\n\nဥပမာ: ဒီနေ့ညနေ လှည်းတန်းဘက် ကော်ဖီတူတူသောက်မယ့်သူရှာနေပါတယ် ☕⛈️\n\n(၂၄ နာရီအတွင်း အလိုအလျောက် ပျောက်ပျက်သွားမှာဖြစ်ပါတယ်)", { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Spark command error:', error);
        await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
});

bot.command('test', async (ctx) => {
    await ctx.reply('Bot is working! Buttons test:', 
        Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Test Like', 'test_like')],
            [Markup.button.callback('➡️ Test Next', 'test_next')]
        ])
    );
});

// Interests command - let user set interests/tags
bot.command('interests', async (ctx) => {
    try {
        const user = await getUser(ctx.from.id);
        if (!user || !user.is_registered) return await ctx.reply('Profile မရှိသေးပါ။ /start နှိပ်ပြီး မှတ်ပုံတင်ပါ။');
        await db.execute({ sql: "UPDATE users SET step = 'ask_interests' WHERE telegram_id = ?", args: [ctx.from.id] });
        await ctx.reply('သင့်စိတ်ဝင်စားသော အရာများ (tags) ကို ကော်မား သို့မဟုတ် စာလုံးဖြင့် ခွဲ၍ ရိုက်ထည့်ပေးပါ။ ဥပမာ: travel, music, food');
    } catch (error) {
        console.error('Interests command error:', error);
        await ctx.reply('စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းပါ။');
    }
});

bot.action('test_like', async (ctx) => {
    await ctx.answerCbQuery('Like button works!');
    await ctx.reply('✅ Like button is working!');
});

bot.action('test_next', async (ctx) => {
    await ctx.answerCbQuery('Next button works!');
    await ctx.reply('✅ Next button is working!');
});

bot.command('pulse', async (ctx) => {
    const { online, matches } = await stats.getRealStats();
    const pulseText = `💓 *Matching Pulse*\n\n` +
        `👥 စုစုပေါင်း Register လုပ်ထားသူ: *${online}* ယောက်\n` +
        `❤️ ဒီနေ့ Match အရေအတွက်: *${matches}* စုံ\n\n` +
        `🔥 MM Cupid မှာ သင့်ဖူးစာရှင်ကို ရှာဖွေလိုက်ပါ!`;
    await ctx.reply(pulseText, { parse_mode: 'Markdown' });
});

bot.command('find', async (ctx) => {
    await showNextProfile(ctx);
});

bot.command('nearby', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (!user || !user.is_registered) {
        return await ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");
    }

    if (user.latitude == null || user.longitude == null) {
        return await ctx.reply("📍 သင့်လက်ရှိ Location မရှာရရှိသေးပါ။\n\nယခုလက်ရှိနေရာကို စနစ်တကျ Share လုပ်ပါ။", Markup.keyboard([Markup.button.locationRequest('📍 Share My Current Location')]).resize());
    }

    return await showNextProfile(ctx);
});

bot.command('edit', async (ctx) => {
    await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.reply("ဘာကိုပြင်ဆင်ချင်ပါသလဲ။", Markup.keyboard([['📝 Nickname', '🎂 Age'], ['🏠 Address', '📷 Photo'], ['📄 Bio', '🏷️ Interests'], ['❌ Cancel']]).resize());
});
bot.command('profile', async (ctx) => await showMyProfile(ctx));
bot.command('help', async (ctx) => {
    const helpText = `📋 **MM Cupid Bot Commands**

🔹 /start - Register your profile
🔹 /find - Find matches (🔍 ဖူးစာရှင်ရှာမည်)
🔹 /nearby - Find nearby matches using your shared location
🔹 /pulse - Live stats (💓 Pulse)
🔹 /profile - View your profile (👤 Profile)
🔹 /edit - Edit your profile (⚙️ Edit Profile)
🔹 /help - Show this help message

💕 ဖူးစာရှင်ကို ရှာဖွေလိုက်ပါ!`;
    await ctx.reply(helpText, { parse_mode: 'Markdown' });
});
bot.command('update', async (ctx) => {
    await db.execute({ sql: "UPDATE users SET step = 'ask_gender' WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
});

bot.command('cancel', async (ctx) => {
    await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '❌ Delete Account'], ['/help']]).resize());
});

// Admin commands for ban management
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];

bot.command('ban', async (ctx) => {
    const adminId = ctx.from.id;
    if (!ADMIN_IDS.includes(adminId)) {
        return await ctx.reply("❌ Admin only command");
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return await ctx.reply("Usage: /ban <user_id> [reason]");
    }
    
    const userId = parseInt(args[1]);
    const reason = args.slice(2).join(' ') || 'Violation of terms';
    
    await db.execute({
        sql: "UPDATE users SET is_banned = 1, is_shadowbanned = 0, ban_reason = ?, banned_at = CURRENT_TIMESTAMP, banned_by = ? WHERE telegram_id = ?",
        args: [reason, adminId, userId]
    });
    
    await ctx.reply(`✅ User ${userId} has been banned.\nReason: ${reason}`);
});

bot.command('unban', async (ctx) => {
    const adminId = ctx.from.id;
    if (!ADMIN_IDS.includes(adminId)) {
        return await ctx.reply("❌ Admin only command");
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return await ctx.reply("Usage: /unban <user_id>");
    }
    
    const userId = parseInt(args[1]);
    
    await db.execute({
        sql: "UPDATE users SET is_banned = 0, is_shadowbanned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE telegram_id = ?",
        args: [userId]
    });
    
    await ctx.reply(`✅ User ${userId} has been unbanned.`);
});

bot.command('shadowban', async (ctx) => {
    const adminId = ctx.from.id;
    if (!ADMIN_IDS.includes(adminId)) {
        return await ctx.reply("❌ Admin only command");
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return await ctx.reply("Usage: /shadowban <user_id> [reason]");
    }
    
    const userId = parseInt(args[1]);
    const reason = args.slice(2).join(' ') || 'Shadowban';
    
    await db.execute({
        sql: "UPDATE users SET is_banned = 0, is_shadowbanned = 1, ban_reason = ?, banned_at = CURRENT_TIMESTAMP, banned_by = ? WHERE telegram_id = ?",
        args: [reason, adminId, userId]
    });
    
    await ctx.reply(`✅ User ${userId} has been shadowbanned.\nReason: ${reason}`);
});

bot.command('unshadowban', async (ctx) => {
    const adminId = ctx.from.id;
    if (!ADMIN_IDS.includes(adminId)) {
        return await ctx.reply("❌ Admin only command");
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return await ctx.reply("Usage: /unshadowban <user_id>");
    }
    
    const userId = parseInt(args[1]);
    
    await db.execute({
        sql: "UPDATE users SET is_shadowbanned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE telegram_id = ?",
        args: [userId]
    });
    
    await ctx.reply(`✅ User ${userId} has been unshadowbanned.`);
});

async function showMyProfile(ctx) {
    try {
        const user = await getUser(ctx.from.id);
        if (!user) return await ctx.reply("Profile မတွေ့ပါ။ /start နှိပ်ပြီး မှတ်ပုံတင်ပါ။");
        
        // Check if spark is still valid (not expired)
        let sparkText = '';
        if (user.daily_spark && user.spark_expires_at) {
            const now = new Date();
            const expiresAt = new Date(user.spark_expires_at);
            if (now < expiresAt) {
                sparkText = `✨ ${user.daily_spark}\n\n`;
            } else {
                // Spark has expired, delete it from database
                await db.execute({
                    sql: "UPDATE users SET daily_spark = NULL, spark_expires_at = NULL WHERE telegram_id = ?",
                    args: [ctx.from.id]
                });
            }
        }
        
        const displayAddress = (user.latitude != null && user.longitude != null && (!user.address || /^(Location shared|Location updated)$/i.test(user.address.trim())))
            ? 'Location shared'
            : (user.address || 'Not set');

        const interestsLine = user.interests ? `\n🔖 ${formatInterests(user.interests)}\n` : '';

        const caption = `${sparkText}👤 **My Profile**\n\n📝 ${user.nickname} (${user.age})\n📍 ${displayAddress}\n🧬 ${user.gender?.toUpperCase()}\n💕 Looking for: ${user.looking_for?.toUpperCase()}${interestsLine}\n\n📝 ${user.bio}`;
        
        try {
            return await ctx.replyWithPhoto(user.photo_id, { caption: caption });
        } catch (e) {
            return await ctx.reply(caption);
        }
    } catch (error) {
        console.error('Error in showMyProfile:', error);
        return await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။");
    }
}

async function showNextProfile(ctx) {
    try {
        console.log('showNextProfile called for user:', ctx.from?.id);
        
        if (ctx.callbackQuery && ctx.callbackQuery.message) {
            try {
                await ctx.editMessageReplyMarkup();
                console.log('Cleared previous profile buttons for user:', ctx.from?.id);
            } catch (editErr) {
                console.log('Failed to clear previous profile buttons:', editErr.message);
            }
        }
        
        const user = await getUser(ctx.from.id);
        if (!user || !user.looking_for) {
            console.log('User not registered or no looking_for:', user);
            return await ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");
        }
        
        // Get session viewed IDs and pass to getRandomProfile
        const sessionViewed = getSessionViewed(ctx.from.id);
        console.log('Session viewed IDs:', sessionViewed.length);
        
        const target = await getRandomProfile(ctx.from.id, user.looking_for, sessionViewed);
        if (!target) {
            console.log('No target found for user:', ctx.from.id);
            // Clear session cache when no profiles found
            sessionViewedCache.delete(ctx.from.id);
            const emptyText = `⏳ ခေတ္တစောင့်ဆိုင်းပေးပါဦး...

သတ်မှတ်ထားတဲ့ Radius အကွာအဝေးအတွင်းမှာ Swipe လုပ်စရာ Profile အသစ်တွေ ကုန်သွားပါပြီ။ ✨

🚀 သူငယ်ချင်းတွေကို Invite လုပ်ပြီး အသိုက်အဝန်းကို ပိုမိုကြီးထွားစေချင်ရင်:
သင့်သူငယ်ချင်းတွေဆီ ရိုးရှင်းစွာ တဆင့်မျှဝေပေးနိုင်ပါတယ်။

👥 လူပိုများလာလေလေ၊ သင့်အတွက် ဖူးစာရှင်အသစ်တွေ ပိုမိုပေါ်ထွက်လာလေလေ ဖြစ်မှာပါခင်ဗျာ! 💕`;
            return await ctx.reply(emptyText, { parse_mode: 'Markdown' });
        }
        
        console.log('Showing profile:', target.telegram_id, 'to user:', ctx.from.id);
        
        // Add to session cache (temporary, clears when user restarts)
        addToSessionViewed(ctx.from.id, target.telegram_id);
        
        // Persist to database for permanent deduplication across sessions
        await markProfileAsViewed(ctx.from.id, target.telegram_id);
        
        // Check if spark is still valid (not expired)
        let sparkText = '';
        if (target.daily_spark && target.spark_expires_at) {
            const now = new Date();
            const expiresAt = new Date(target.spark_expires_at);
            if (now < expiresAt) {
                sparkText = `✨ ${target.daily_spark}\n\n`;
            } else {
                // Spark has expired, delete it from database
                await db.execute({
                    sql: "UPDATE users SET daily_spark = NULL, spark_expires_at = NULL WHERE telegram_id = ?",
                    args: [target.telegram_id]
                });
            }
        }
        
        // Calculate and display distance if both users have location
        let distanceText = '';
        if (user.latitude != null && user.longitude != null && target.latitude != null && target.longitude != null) {
            const distance = calculateDistance(user.latitude, user.longitude, target.latitude, target.longitude);
            distanceText = `\n📏 ${distance.toFixed(1)} km ကွာဝေးသည်`;
        }
        
        const targetInterests = target.interests ? `\n🔖 ${formatInterests(target.interests)}` : '';
        const caption = `${sparkText}👤 ${target.nickname} (${target.age})\n📍 ${target.address}${distanceText}${targetInterests}\n\n📝 ${target.bio}`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`),
             Markup.button.callback('💌 Like + Message', `like_with_message_${target.telegram_id}`)],
            [Markup.button.callback('➡️ Next', 'next_profile')],
            [Markup.button.callback('🚨 Report', `report_${target.telegram_id}`)]
        ]);
        
        
        // Try sending photo, fallback to text if photo fails
        try {
            console.log('Sending photo with ID:', target.photo_id?.substring(0, 20) + '...');
            return await ctx.replyWithPhoto(target.photo_id, {
                caption: caption,
                reply_markup: keyboard.reply_markup
            });
        } catch (photoError) {
            console.error('Photo send failed, sending text instead:', photoError.message);
            return await ctx.reply(caption, { reply_markup: keyboard.reply_markup });
        }
    } catch (error) {
        console.error('Error in showNextProfile:', error);
        return await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
}

// Bot-level error handler
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    console.error('Context:', ctx.updateType);
});

// Action handlers
bot.action('next_profile', async (ctx) => {
    console.log('Next button clicked by:', ctx.from?.id);
    try {
        await ctx.answerCbQuery('⏳ Loading...').catch((e) => console.log('Answer error:', e.message));
        return await showNextProfile(ctx);
    } catch (error) {
        console.error('Next profile action error:', error);
        await ctx.answerCbQuery('Error!').catch(() => {});
        return await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။").catch(() => {});
    }
});

// Store pending secret messages before like is confirmed
const pendingSecretMessages = new Map();

bot.action(/^like_with_message_(.+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    const senderId = ctx.from.id;
    
    console.log('Like with message clicked - sender:', senderId, 'target:', targetId);
    
    // Set user step to waiting for secret message
    await db.execute({ 
        sql: "UPDATE users SET step = ? WHERE telegram_id = ?", 
        args: [`secret_message_${targetId}`, senderId] 
    });
    
    await ctx.answerCbQuery('💌 Message');
    
    await ctx.reply(`💌 *စိတ်ကူးလေးရေးပါ*

သင့်စိတ်ကူးကို သုံးပြီး Like လုပ်ချင်ပါတယ်။
စိတ်ကူးတစ်ကြောင်းရေးပြီး ပို့လိုက်ပါ။

*ဥပမာ:* "You look cute 😊"`, { 
        parse_mode: 'Markdown',
        ...Markup.forceReply()
    });
});

bot.action(/^like_(.+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    const senderId = ctx.from.id;
    const secretMessage = pendingSecretMessages.get(`${senderId}_${targetId}`);
    
    console.log('Like button clicked - sender:', senderId, 'target:', targetId, 'hasMessage:', !!secretMessage);
    
    // Clear pending message
    pendingSecretMessages.delete(`${senderId}_${targetId}`);
    
    // Validate inputs
    if (!targetId || !senderId) {
        console.error('Missing targetId or senderId');
        await ctx.answerCbQuery('အမှား!').catch(() => {});
        return;
    }
    
    if (!db) {
        console.error('Database not connected');
        await ctx.answerCbQuery('Database error').catch(() => {});
        return await ctx.reply("Database မချိတ်ဆက်နိုင်ပါ။").catch(() => {});
    }
    
    try {
        // Answer callback query
        await ctx.answerCbQuery(secretMessage ? '❤️ Like + Message!' : '❤️ Like!').catch((e) => console.log('Answer error:', e.message));
        
        // Record the like and wait for it to complete
        console.log('Recording like...');
        await db.execute({ 
            sql: "INSERT OR IGNORE INTO likes (from_user, to_user) VALUES (?, ?)", 
            args: [senderId, targetId] 
        });
        console.log('Like recorded successfully');
        
        // Store secret message if provided
        if (secretMessage) {
            await db.execute({
                sql: "CREATE TABLE IF NOT EXISTS secret_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user INTEGER, to_user INTEGER, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
                args: []
            });
            await db.execute({
                sql: "INSERT INTO secret_messages (from_user, to_user, message) VALUES (?, ?, ?)",
                args: [senderId, targetId, secretMessage]
            });
            console.log('Secret message stored');
        }
        
        // Check for mutual like
        const mutualLike = await db.execute({
            sql: "SELECT * FROM likes WHERE from_user = ? AND to_user = ?",
            args: [targetId, senderId]
        });
        console.log('Mutual like check:', mutualLike.rows.length > 0 ? 'Match!' : 'No match yet');

        if (mutualLike.rows.length > 0) {
            const me = await getUser(senderId);
            const partner = await getUser(targetId);
            
            // Get any secret messages from partner
            const partnerMsgResult = await db.execute({
                sql: "SELECT message FROM secret_messages WHERE from_user = ? AND to_user = ? ORDER BY created_at DESC LIMIT 1",
                args: [targetId, senderId]
            });
            const partnerMessage = partnerMsgResult.rows[0]?.message;
            
            if (me && partner) {
                // Insert into matches table (ensure user_one < user_two for consistency)
                const userOne = Math.min(senderId, targetId);
                const userTwo = Math.max(senderId, targetId);
                
                try {
                    await db.execute({
                        sql: "INSERT OR IGNORE INTO matches (user_one, user_two) VALUES (?, ?)",
                        args: [userOne, userTwo]
                    });
                    console.log('Match inserted into matches table');
                } catch (e) {
                    console.error('Error inserting match:', e);
                }
                
                const partnerLink = partner.username !== 'none' ? `@${partner.username}` : `tg://user?id=${targetId}`;
                const myLink = me.username !== 'none' ? `@${me.username}` : `tg://user?id=${senderId}`;
                
                let matchText = `🎉 *Match ဖြစ်သွားပါပြီ!* ❤️

👤 *${partner.nickname}* နဲ့ သင်နဲ့ စိတ်ချင်းတူသွားပါပြီ။
မိမိရဲ့ Telegram ID အစစ်အမှန်ကို မသိစေဘဲ ဘော့ခ်ျထဲမှာပဲ လုံခြုံစွာ အရင်ဆုံး စကားပြောကြည့်လိုက်ပါ!`;
                
                if (partnerMessage) {
                    matchText += `\n\n💌 *သူ့ရဲ့စိတ်ကူးလေး:* "${partnerMessage}"`;
                }
                
                if (secretMessage) {
                    matchText += `\n\n💌 *သင်ပို့တဲ့စိတ်ကူးလေး:* "${secretMessage}"`;
                }
                
                stats.addMatch();
                await ctx.reply(matchText, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('💬 စကားပြောမည်', `chat_${targetId}`)],
                        [Markup.button.callback('➡️ ဆက်ရှာမည်', 'next_profile')]
                    ])
                });
                
                try {
                    let partnerMatchText = `🎉 *Match ဖြစ်သွားပါပြီ!* ❤️

👤 *${me.nickname}* နဲ့ သင်နဲ့ စိတ်ချင်းတူသွားပါပြီ။
မိမိရဲ့ Telegram ID အစစ်အမှန်ကို မသိစေဘဲ ဘော့ခ်ျထဲမှာပဲ လုံခြုံစွာ အရင်ဆုံး စကားပြောကြည့်လိုက်ပါ!`;
                    
                    if (secretMessage) {
                        partnerMatchText += `\n\n💌 *သူ့ရဲ့စိတ်ကူးလေး:* "${secretMessage}"`;
                    }
                    
                    if (partnerMessage) {
                        partnerMatchText += `\n\n💌 *သင်ပို့တဲ့စိတ်ကူးလေး:* "${partnerMessage}"`;
                    }
                    
                    await bot.telegram.sendMessage(targetId, partnerMatchText, {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('💬 စကားပြောမည်', `chat_${senderId}`)],
                            [Markup.button.callback('➡️ ဆက်ရှာမည်', 'next_profile')]
                        ])
                    });
                } catch (e) {
                    console.error('Error sending partner match notification:', e);
                }
            }
        } else {
            try {
                const me = await getUser(senderId);
                if (me) {
                    let likeNotifyText = `🔔 *သတင်းကောင်းရှိပါတယ်။*\n\nသင့်ကို သဘောကျလို့ Like လုပ်ထားပါတယ်။ 😉`;
                    
                    if (secretMessage) {
                        likeNotifyText += `\n\n💌 *သူ့ရဲ့စိတ်ကူးလေး:* "${secretMessage}"`;
                    }
                    
                    likeNotifyText += `\n\nအဲဒီလူက ဘယ်သူဖြစ်မလဲဆိုတာ သိချင်ရင် အောက်က ခလုတ်ကိုနှိပ်လိုက်ပါ!`;
                    
                    await bot.telegram.sendMessage(targetId, likeNotifyText, {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('👀 သူ့ကို ကြည့်မယ်', `view_back_${senderId}`)]
                        ])
                    });
                }
            } catch (e) {}
        }
    } catch (error) {
        console.error('Like Error:', error);
        await ctx.answerCbQuery('အမှား!').catch(() => {});
    }
    
    // Always show next profile after processing the like
    console.log('Showing next profile...');
    return await showNextProfile(ctx);
});

bot.action(/^reveal_accept_(.+)$/, async (ctx) => {
    const requesterId = ctx.match[1];
    const userId = ctx.from.id;
    
    try {
        await ctx.answerCbQuery('👍 သဘောတူသည်').catch((e) => console.log('Answer error:', e.message));
        
        const requester = await getUser(requesterId);
        const me = await getUser(userId);
        
        if (requester && me) {
            // Update match to revealed
            const userOne = Math.min(userId, requesterId);
            const userTwo = Math.max(userId, requesterId);
            
            await db.execute({
                sql: "UPDATE matches SET is_revealed = 1 WHERE user_one = ? AND user_two = ?",
                args: [userOne, userTwo]
            });
            
            // Send usernames to both users
            const requesterLink = requester.username !== 'none' ? `@${requester.username}` : `tg://user?id=${requesterId}`;
            const myLink = me.username !== 'none' ? `@${me.username}` : `tg://user?id=${userId}`;
            
            await ctx.reply(`🔓 *လျှို့ဝှက်ချက်ဖွင့်ပြီးပါပြီ!*

သင့်ရဲ့ Telegram: ${myLink}
သူ့ရဲ့ Telegram: ${requesterLink}`, { parse_mode: 'Markdown' });
            
            await bot.telegram.sendMessage(requesterId, 
                `🔓 *လျှို့ဝှက်ချက်ဖွင့်ပြီးပါပြီ!*

သင့်ရဲ့ Telegram: ${requesterLink}
သူ့ရဲ့ Telegram: ${myLink}`, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('Reveal accept error:', error);
    }
});

bot.action(/^reveal_reject_(.+)$/, async (ctx) => {
    const requesterId = ctx.match[1];
    
    try {
        await ctx.answerCbQuery('👎 ငြင်းပယ်မည်').catch((e) => console.log('Answer error:', e.message));
        
        await ctx.reply('👎 လျှို့ဝှက်ချက်ဖွင့်ခြင်းကို ငြင်းပယ်လိုက်ပါပြီ။ ဆက်လက် အမည်ဝှက်ဖြင့် စကားပြောနိုင်ပါသည်။');
        
        await bot.telegram.sendMessage(requesterId, '👎 သူ့ဘက်က လျှို့ဝှက်ချက်ဖွင့်ခြင်းကို ငြင်းပယ်လိုက်ပါပြီ။ ဆက်လက် အမည်ဝှက်ဖြင့် စကားပြောနိုင်ပါသည်။');
    } catch (error) {
        console.error('Reveal reject error:', error);
    }
});

bot.action(/^chat_(.+)$/, async (ctx) => {
    const matchedUserId = ctx.match[1];
    const userId = ctx.from.id;
    
    console.log('Chat button clicked - user:', userId, 'matched with:', matchedUserId);
    
    try {
        await ctx.answerCbQuery('💬 စကားပြောမည်').catch((e) => console.log('Answer error:', e.message));
        
        // Get the match ID
        const userOne = Math.min(userId, matchedUserId);
        const userTwo = Math.max(userId, matchedUserId);
        
        const matchResult = await db.execute({
            sql: "SELECT id FROM matches WHERE user_one = ? AND user_two = ?",
            args: [userOne, userTwo]
        });
        
        if (matchResult.rows.length === 0) {
            return await ctx.reply("Match မတွေ့ပါ။ ပြန်စမ်းကြည့်ပါ။");
        }
        
        const matchId = matchResult.rows[0].id;
        
        // Create chat session
        await db.execute({
            sql: "INSERT OR REPLACE INTO chat_sessions (user_id, matched_user_id, match_id) VALUES (?, ?, ?)",
            args: [userId, matchedUserId, matchId]
        });
        
        // Set user step to chat_mode
        await db.execute({
            sql: "UPDATE users SET step = 'chat_mode' WHERE telegram_id = ?",
            args: [userId]
        });
        
        // Get partner info
        const partner = await getUser(matchedUserId);
        if (!partner) {
            return await ctx.reply("Partner မတွေ့ပါ။");
        }
        
        const chatWelcomeText = `💬 *${partner.nickname}* နှင့် အမည်ဝှက် စကားပြောနေပါသည်။
(စာသား၊ ပုံ၊ အသံဖိုင်များ ပေးပို့နိုင်ပါသည်။)
--------------------------------------`;
        
        await ctx.reply(chatWelcomeText, {
            parse_mode: 'Markdown',
            ...Markup.keyboard([
                ['🔓 လျှို့ဝှက်ချက်ဖွင့်ပြမည်', '🚨 Report / Block'],
                ['🚫 Block & Unmatch', '❌ Chat မှထွက်မည်']
            ]).resize()
        });
        
    } catch (error) {
        console.error('Chat session creation error:', error);
        await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
});

bot.action(/^report_fake_(.+)$/, async (ctx) => {
    const reportedUserId = ctx.match[1];
    const reporterId = ctx.from.id;
    
    try {
        await ctx.answerCbQuery('🚨 Report တင်ပြီးပါပြီ').catch((e) => console.log('Answer error:', e.message));
        
        await db.execute({
            sql: "INSERT INTO reports (reporter_id, reported_user_id, reason, description) VALUES (?, ?, 'fake_profile', 'Reported from anonymous chat')",
            args: [reporterId, reportedUserId]
        });
        
        await ctx.reply('🚨 Report တင်ပြီးပါပြီ။ ကျေးဇူးပါ။', Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    } catch (error) {
        console.error('Report error:', error);
    }
});

bot.action(/^report_spam_(.+)$/, async (ctx) => {
    const reportedUserId = ctx.match[1];
    const reporterId = ctx.from.id;
    
    try {
        await ctx.answerCbQuery('🚨 Report တင်ပြီးပါပြီ').catch((e) => console.log('Answer error:', e.message));
        
        await db.execute({
            sql: "INSERT INTO reports (reporter_id, reported_user_id, reason, description) VALUES (?, ?, 'spam', 'Reported from anonymous chat')",
            args: [reporterId, reportedUserId]
        });
        
        await ctx.reply('🚨 Report တင်ပြီးပါပြီ။ ကျေးဇူးပါ။', Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '❌ Delete Account'], ['/help']]).resize());
    } catch (error) {
        console.error('Report error:', error);
    }
});

bot.action(/^report_inappropriate_(.+)$/, async (ctx) => {
    const reportedUserId = ctx.match[1];
    const reporterId = ctx.from.id;
    
    try {
        await ctx.answerCbQuery('🚨 Report တင်ပြီးပါပြီ').catch((e) => console.log('Answer error:', e.message));
        
        await db.execute({
            sql: "INSERT INTO reports (reporter_id, reported_user_id, reason, description) VALUES (?, ?, 'inappropriate', 'Reported from anonymous chat')",
            args: [reporterId, reportedUserId]
        });
        
        await ctx.reply('🚨 Report တင်ပြီးပါပြီ။ ကျေးဇူးပါ။', Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '❌ Delete Account'], ['/help']]).resize());
    } catch (error) {
        console.error('Report error:', error);
    }
});

bot.action(/^view_back_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    
    const senderId = ctx.match[1];
    const sender = await getUser(senderId);
    
    if (!sender) {
        return await ctx.reply("သူ့ Profile မတွေ့ပါ။");
    }
    
    return await ctx.replyWithPhoto(sender.photo_id, {
        caption: `👤 ${sender.nickname} (${sender.age})\n📍 ${sender.address}\n\n📝 ${sender.bio}`,
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Like', `like_${senderId}`)],
            [Markup.button.callback('➡️ Next', 'next_profile')],
            [Markup.button.callback('ပိတ်မယ်', 'close_profile')]
        ])
    });
});

bot.action('close_profile', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
});

// Report user functionality
bot.action(/^report_(\d+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    const reporterId = ctx.from.id;
    
    console.log('Report button clicked - reporter:', reporterId, 'target:', targetId);
    
    // Set user step to waiting for report reason
    await db.execute({ 
        sql: "UPDATE users SET step = ? WHERE telegram_id = ?", 
        args: [`report_reason_${targetId}`, reporterId] 
    });
    
    await ctx.answerCbQuery('🚨 Report');
    
    await ctx.reply(`🚨 *Report User*

ဘယ်အကြောင်းကြောင့် Report လုပ်ချင်ပါသလဲ。

အောက်က ခလုတ်များထဲမှ ရွေးပါ:`, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🎭 Fake Profile', `report_fake_${targetId}`)],
            [Markup.button.callback('📢 Spam', `report_spam_${targetId}`)],
            [Markup.button.callback('⚠️ Inappropriate', `report_inappropriate_${targetId}`)],
            [Markup.button.callback('❌ Cancel', 'cancel_report')]
        ])
    });
});

bot.action(/^report_(fake|spam|inappropriate)_(.+)$/, async (ctx) => {
    const reason = ctx.match[1];
    const targetId = ctx.match[2];
    const reporterId = ctx.from.id;
    
    console.log('Report reason selected:', reason, 'target:', targetId);
    
    // Set user step to waiting for report description
    await db.execute({ 
        sql: "UPDATE users SET step = ? WHERE telegram_id = ?", 
        args: [`report_desc_${reason}_${targetId}`, reporterId] 
    });
    
    await ctx.answerCbQuery();
    
    const reasonText = {
        'fake': '🎭 Fake Profile',
        'spam': '📢 Spam',
        'inappropriate': '⚠️ Inappropriate'
    };
    
    await ctx.reply(`${reasonText[reason]}

အသေးစိတ် ရှင်းပြချက် ရေးပေးပါ (Optional):
ဥပမာ - "ပုံက လူစစ်မဟုတ်ဘူး"`, {
        ...Markup.forceReply()
    });
});

bot.action('cancel_report', async (ctx) => {
    await ctx.answerCbQuery();
    await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.reply('Report ပယ်ဖျက်လိုက်ပါပြီ။');
    return await showNextProfile(ctx);
});

async function handleChat(ctx, user) {
    const text = ctx.message.text;
    
    // Handle interests when registered users edit or update interests
    if (user.step === 'ask_interests' || user.step === 'edit_interests') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);

        if (user.step === 'ask_interests' && text === '/skip') {
            await db.execute({ sql: "UPDATE users SET interests = NULL, is_registered = 1, step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply('✅ Registration completed without interests. You can set interests later with /interests', Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
        }

        if (!text || text.trim() === '') return await ctx.reply('ကျေးဇူးပြု၍ interests (tags) တစ်ခုခု ရိုက်ထည့်ပါ၊ ဥပမာ: travel, music, food');

        const parts = text.split(/[,;]+|\s+/).map(p => p.trim()).filter(Boolean);
        const normalized = parts.join(',');

        if (user.step === 'ask_interests') {
            await db.execute({ sql: "UPDATE users SET interests = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", args: [normalized, ctx.from.id] });
            return await ctx.reply('✅ Interests သိမ်းပြီးပါပြီ:' + formatInterests(normalized), Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
        }

        await db.execute({ sql: "UPDATE users SET interests = ?, step = 'done' WHERE telegram_id = ?", args: [normalized, ctx.from.id] });
        return await ctx.reply('✅ Interests သိမ်းပြီးပါပြီ: ' + formatInterests(normalized), Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    }
    
    // Handle report description input
    if (user?.step?.startsWith('report_desc_')) {
        const stepParts = user.step.replace('report_desc_', '').split('_');
        const reason = stepParts[0];
        const targetId = stepParts[1];
        const reporterId = ctx.from.id;
        const description = text.trim();
        
        console.log('Submitting report - reporter:', reporterId, 'target:', targetId, 'reason:', reason);
        
        // Insert report into database
        await db.execute({
            sql: "INSERT INTO reports (reporter_id, reported_user_id, reason, description, status) VALUES (?, ?, ?, ?, 'pending')",
            args: [reporterId, targetId, reason, description]
        });
        
        // Clear step
        await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [reporterId] });
        
        await ctx.reply(`✅ Report တင်ပြီးပါပြီ။

သင့် Report ကို Admin team က စစ်ဆေးပါမည်။
ကျေးဇူးတင်ပါတယ်! 🙏`, Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '❌ Delete Account'], ['/help']]).resize());
        return;
    }
    
    // Handle secret message input
    if (user?.step?.startsWith('secret_message_')) {
        const targetId = user.step.replace('secret_message_', '');
        const senderId = ctx.from.id;
        const secretMessage = text.trim();
        
        if (secretMessage.length < 1 || secretMessage.length > 200) {
            return await ctx.reply("❌ စိတ်ကူးလေးကို ၁လုံးကနေ ၂၀၀လုံးအတွင်းထည့်ပါ။");
        }
        
        // Store the message temporarily
        pendingSecretMessages.set(`${senderId}_${targetId}`, secretMessage);
        
        // Clear step
        await db.execute({ sql: "UPDATE users SET step = 'browse' WHERE telegram_id = ?", args: [senderId] });
        
        await ctx.reply(`💌 စိတ်ကူးလေး သိမ်းဆည်းပြီးပါပြီ။\n\n"${secretMessage}"\n\nအခု Like ခလုတ်နှိပ်လိုက်ရင် စိတ်ကူးလေးနဲ့တွဲပြီး ပို့ပေးပါမယ်။`, {
            reply_markup: {
                inline_keyboard: [[{ text: '❤️ Like + Message', callback_data: `like_${targetId}` }]]
            }
        });
        return;
    }
    
    if (text === '/pulse' || text === '💓 Pulse') {
        const { online, matches } = await stats.getRealStats();
        const pulseText = `💓 *Matching Pulse*\n\n` +
            `👥 စုစုပေါင်း Register လုပ်ထားသူ: *${online}* ယောက်\n` +
            `❤️ ဒီနေ့ Match အရေအတွက်: *${matches}* စုံ\n\n` +
            `🔥 MM Cupid မှာ သင့်ဖူးစာရှင်ကို ရှာဖွေလိုက်ပါ!`;
        return await ctx.reply(pulseText, { parse_mode: 'Markdown' });
    }
    if (text === '/find' || text === '🔍 Find Match' || text === '🔍 ဖူးစာရှင်ရှာမည်') {
        return await showNextProfile(ctx);
    }

    // Main menu Interests button
    if (text === '🏷️ Interests') {
        try {
            const userMenu = await getUser(ctx.from.id);
            if (!userMenu || !userMenu.is_registered) return await ctx.reply('Profile မရှိသေးပါ။ /start နှိပ်ပြီး မှတ်ပုံတင်ပါ။');
            await db.execute({ sql: "UPDATE users SET step = 'ask_interests' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply('သင့်စိတ်ဝင်စားသော အရာများ (tags) ကို ကော်မား သို့မဟုတ် စာလုံးဖြင့် ခွဲ၍ ရိုက်ထည့်ပေးပါ။ ဥပမာ: travel, music, food');
        } catch (error) {
            console.error('Interests button error:', error);
            return await ctx.reply('စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းပါ။');
        }
    }

    if (text === '✨ Daily Spark') {
        // Trigger spark command
        const user = await getUser(ctx.from.id);
        if (!user || !user.is_registered) {
            return await ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ သုံးနိုင်ပါမယ်။ /start နှိပ်ပါ။");
        }
        
        await db.execute({
            sql: "UPDATE users SET step = 'ask_spark' WHERE telegram_id = ?",
            args: [ctx.from.id]
        });
        
        await ctx.reply("✨ *Daily Spark* တင်ပါ\n\nဒီနေ့ ဘာလုပ်ချင်လဲဆိုတဲ့ အခြေအနေကို Emoji လေးနဲ့ ရေးပေးပါ။\n\nဥပမာ: ဒီနေ့ညနေ လှည်းတန်းဘက် ကော်ဖီတူတူသောက်မယ့်သူရှာနေပါတယ် ☕⛈️\n\n(၂၄ နာရီအတွင်း အလိုအလျောက် ပျောက်ပျက်သွားမှာဖြစ်ပါတယ်)", { parse_mode: 'Markdown' });
        return;
    }
    if (text === '❌ Delete Account') {
        // Trigger delete account command
        const user = await getUser(ctx.from.id);
        if (!user || !user.is_registered) {
            return await ctx.reply("Profile မတွေ့ပါ။ /start နှိပ်ပြီး မှတ်ပုံတင်ပါ။");
        }
        
        await ctx.reply("⚠️ *Account ဖျက်မည်မှာ သေချာပါသလား?*\n\nသင့် Profile နဲ့ အချက်အလက်အားလုံး ပျောက်ပျက်သွားမှာဖြစ်ပါတယ်။", {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ ဖျက်မည်', 'delete_confirm')],
                [Markup.button.callback('ပယ်ဖျက်မည်', 'delete_cancel')]
            ])
        });
        return;
    }
    if (text === '/edit' || text === '⚙️ Edit Profile') {
        await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
        return await ctx.reply("ဘာကိုပြင်ဆင်ချင်ပါသလဲ။", Markup.keyboard([['📝 Nickname', '🎂 Age'], ['🏠 Address', '📷 Photo'], ['📄 Bio', '❌ Cancel']]).resize());
    }
    if (text === '/profile' || text === '👤 Profile') return await showMyProfile(ctx);
    if (text === '/help') {
        const helpText = `📋 **MM Cupid Bot Commands**

🔹 /start - Register your profile
🔹 /find - Find matches (🔍 ဖူးစာရှင်ရှာမည်)
🔹 /pulse - Live stats (💓 Pulse)
🔹 /profile - View your profile (👤 Profile)
🔹 /edit - Edit your profile (⚙️ Edit Profile)
🔹 /spark - Set daily spark status
🔹 /deleteaccount - Delete your account (❌ Delete Account)
🔹 /help - Show this help message

💕 ဖူးစာရှင်ကို ရှာဖွေလိုက်ပါ!`;
        return await ctx.reply(helpText, { parse_mode: 'Markdown' });
    }
}

// Dashboard Password (set via env var or use default)
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'hidecard';

// Dashboard API Routes - Simplified for Vercel
async function handleDashboardAPI(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Password');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Password check (skip for login check endpoint)
    const url = req.url || '';
    if (!url.includes('/api/check-auth')) {
        const password = req.headers['x-password'] || req.query?.password;
        if (password !== DASHBOARD_PASSWORD) {
            return res.status(401).json({ error: 'Unauthorized - Invalid password' });
        }
    }
    
    // Get path from URL
    let path = url;
    console.log('Dashboard API request:', path);
    
    // Remove query params and normalize
    path = path.split('?')[0].replace(/^\//, '');
    console.log('Normalized path:', path);
    
    // Check password endpoint
    if (path === 'api/check-auth' || path === 'check-auth') {
        const password = req.headers['x-password'] || req.query?.password;
        if (password === DASHBOARD_PASSWORD) {
            return res.status(200).json({ success: true });
        }
        return res.status(401).json({ error: 'Invalid password' });
    }
    
    try {
        // Check database connection
        if (!db) {
            console.error('Database not connected');
            return res.status(500).json({ error: 'Database not connected' });
        }
        
        // API: /api/stats - Get dashboard stats
        if (path === 'api/stats' || path === 'stats') {
            console.log('Fetching stats...');
            
            // Get total users
            const totalResult = await db.execute({
                sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1",
                args: []
            });
            const totalUsers = totalResult.rows[0]?.count || 0;
            console.log('Total users:', totalUsers);
            
            // Get total matches (mutual likes count)
            const matchesResult = await db.execute({
                sql: "SELECT COUNT(*) as count FROM likes l WHERE EXISTS (SELECT 1 FROM likes l2 WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user)",
                args: []
            });
            const totalMatches = Math.floor((matchesResult.rows[0]?.count || 0) / 2);
            console.log('Total matches:', totalMatches);
            
            return res.status(200).json({
                totalUsers: totalUsers,
                todayMatches: totalMatches,
                lastUpdated: new Date().toISOString()
            });
        }
        
        // API: /api/users - Get user list
        if (path === 'api/users' || path === 'users') {
            console.log('Fetching users...');
            
            const usersResult = await db.execute({
                sql: "SELECT telegram_id, nickname, age, gender, looking_for, address, is_registered FROM users LIMIT 50",
                args: []
            });
            
            const countResult = await db.execute({
                sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1",
                args: []
            });
            
            console.log('Users fetched:', usersResult.rows.length);
            
            return res.status(200).json({
                users: usersResult.rows || [],
                total: countResult.rows[0]?.count || 0
            });
        }
        
        // API: /api/matches - Get match list
        if (path === 'api/matches' || path === 'matches') {
            console.log('Fetching matches...');
            
            // Get all mutual likes (matches) - simpler query for SQLite
            const matchesResult = await db.execute({
                sql: "SELECT l.from_user as user1_id, l.to_user as user2_id FROM likes l WHERE EXISTS (SELECT 1 FROM likes l2 WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user) LIMIT 100",
                args: []
            });
            
            // Get unique matches (each match appears twice)
            const seen = new Set();
            const uniqueMatches = [];
            
            for (const row of matchesResult.rows || []) {
                // Create a unique key (smaller ID first)
                const u1 = row.user1_id;
                const u2 = row.user2_id;
                const key = u1 < u2 ? u1 + '-' + u2 : u2 + '-' + u1;
                
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueMatches.push(row);
                }
            }
            
            // Fetch user nicknames for each match
            const matchesWithNames = [];
            for (const match of uniqueMatches.slice(0, 50)) {
                const [user1Res, user2Res] = await Promise.all([
                    db.execute({
                        sql: "SELECT nickname FROM users WHERE telegram_id = ?",
                        args: [match.user1_id]
                    }),
                    db.execute({
                        sql: "SELECT nickname FROM users WHERE telegram_id = ?",
                        args: [match.user2_id]
                    })
                ]);
                
                matchesWithNames.push({
                    user1: { 
                        id: match.user1_id, 
                        nickname: user1Res.rows[0]?.nickname || 'Unknown'
                    },
                    user2: { 
                        id: match.user2_id, 
                        nickname: user2Res.rows[0]?.nickname || 'Unknown'
                    }
                });
            }
            
            console.log('Matches fetched:', matchesWithNames.length);
            
            return res.status(200).json({
                matches: matchesWithNames,
                total: matchesWithNames.length
            });
        }

        // API: /api/analytics - Advanced statistics
        if (path === 'api/analytics' || path === 'analytics') {
            console.log('Fetching analytics...');
            
            // Gender distribution
            const genderResult = await db.execute({
                sql: "SELECT gender, COUNT(*) as count FROM users WHERE is_registered = 1 GROUP BY gender",
                args: []
            });
            
            // Total likes
            const likesResult = await db.execute({
                sql: "SELECT COUNT(*) as count FROM likes",
                args: []
            });
            
            // Daily active users (users who liked/viewed today)
            const activeTodayResult = await db.execute({
                sql: "SELECT COUNT(DISTINCT user_id) as count FROM profile_views WHERE date(viewed_at) = date('now')",
                args: []
            });
            
            // Users by city
            const citiesResult = await db.execute({
                sql: "SELECT address, COUNT(*) as count FROM users WHERE is_registered = 1 AND address IS NOT NULL GROUP BY address ORDER BY count DESC LIMIT 10",
                args: []
            });
            
            // Age distribution
            const ageResult = await db.execute({
                sql: "SELECT CASE WHEN age < 20 THEN 'Under 20' WHEN age BETWEEN 20 AND 30 THEN '20-30' WHEN age BETWEEN 31 AND 40 THEN '31-40' ELSE '40+' END as range, COUNT(*) as count FROM users WHERE is_registered = 1 GROUP BY range",
                args: []
            });
            
            // Calculate match success rate
            const totalUsers = (await db.execute({ sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1", args: [] })).rows[0]?.count || 0;
            const totalLikes = likesResult.rows[0]?.count || 0;
            const totalMatches = Math.floor(((await db.execute({ sql: "SELECT COUNT(*) as count FROM likes l WHERE EXISTS (SELECT 1 FROM likes l2 WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user)", args: [] })).rows[0]?.count || 0) / 2);
            
            const successRate = totalLikes > 0 ? ((totalMatches * 2) / totalLikes * 100).toFixed(1) : 0;
            
            console.log('Analytics fetched');
            
            return res.status(200).json({
                genderDistribution: genderResult.rows || [],
                totalLikes: totalLikes,
                dailyActiveUsers: activeTodayResult.rows[0]?.count || 0,
                topCities: citiesResult.rows || [],
                ageDistribution: ageResult.rows || [],
                matchSuccessRate: successRate + '%',
                totalMatches: totalMatches
            });
        }

        // API: /api/search - Search users
        if (path === 'api/search' || path === 'search') {
            const searchQuery = req.query?.q || '';
            const searchType = req.query?.type || 'nickname'; // nickname, city, age
            
            console.log('Searching:', searchType, searchQuery);
            
            let sql, params = [];
            
            if (searchType === 'nickname' && searchQuery) {
                sql = "SELECT telegram_id, nickname, age, gender, looking_for, address, is_registered, bio FROM users WHERE nickname LIKE ? AND is_registered = 1 LIMIT 50";
                params = ['%' + searchQuery + '%'];
            } else if (searchType === 'city' && searchQuery) {
                sql = "SELECT telegram_id, nickname, age, gender, looking_for, address, is_registered, bio FROM users WHERE address LIKE ? AND is_registered = 1 LIMIT 50";
                params = ['%' + searchQuery + '%'];
            } else if (searchType === 'age' && searchQuery) {
                sql = "SELECT telegram_id, nickname, age, gender, looking_for, address, is_registered, bio FROM users WHERE age = ? AND is_registered = 1 LIMIT 50";
                params = [parseInt(searchQuery)];
            } else {
                sql = "SELECT telegram_id, nickname, age, gender, looking_for, address, is_registered, bio FROM users WHERE is_registered = 1 LIMIT 50";
            }
            
            const usersResult = await db.execute({ sql, args: params });
            
            return res.status(200).json({
                users: usersResult.rows || [],
                query: searchQuery,
                type: searchType
            });
        }

        // API: /api/ban - Ban/unban/shadowban user
        if (path === 'api/ban' || path === 'ban') {
            if (req.method !== 'POST') {
                return res.status(405).json({ error: 'Method not allowed' });
            }
            
            const { userId, action, reason } = req.body || {};
            
            if (!userId) {
                return res.status(400).json({ error: 'User ID required' });
            }
            
            console.log('Ban action:', action, 'User:', userId, 'Reason:', reason);
            
            if (action === 'ban') {
                await db.execute({
                    sql: "UPDATE users SET is_banned = 1, is_shadowbanned = 0, ban_reason = ?, banned_at = CURRENT_TIMESTAMP, banned_by = ? WHERE telegram_id = ?",
                    args: [reason || 'Violation of terms', req.headers['x-admin-id'] || 0, userId]
                });
                return res.status(200).json({ success: true, message: 'User banned' });
            } else if (action === 'unban') {
                await db.execute({
                    sql: "UPDATE users SET is_banned = 0, is_shadowbanned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE telegram_id = ?",
                    args: [userId]
                });
                return res.status(200).json({ success: true, message: 'User unbanned' });
            } else if (action === 'shadowban') {
                await db.execute({
                    sql: "UPDATE users SET is_banned = 0, is_shadowbanned = 1, ban_reason = ?, banned_at = CURRENT_TIMESTAMP, banned_by = ? WHERE telegram_id = ?",
                    args: [reason || 'Shadowban', req.headers['x-admin-id'] || 0, userId]
                });
                return res.status(200).json({ success: true, message: 'User shadowbanned' });
            } else if (action === 'unshadowban') {
                await db.execute({
                    sql: "UPDATE users SET is_shadowbanned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE telegram_id = ?",
                    args: [userId]
                });
                return res.status(200).json({ success: true, message: 'User unshadowbanned' });
            }
            
            return res.status(400).json({ error: 'Invalid action' });
        }

        // API: /api/delete-user - Delete user
        if (path === 'api/delete-user' || path === 'delete-user') {
            if (req.method !== 'POST') {
                return res.status(405).json({ error: 'Method not allowed' });
            }
            
            const { userId } = req.body || {};
            
            if (!userId) {
                return res.status(400).json({ error: 'User ID required' });
            }
            
            console.log('Deleting user:', userId);
            
            // Delete from all related tables
            await db.execute({ sql: "DELETE FROM likes WHERE from_user = ? OR to_user = ?", args: [userId, userId] });
            await db.execute({ sql: "DELETE FROM profile_views WHERE user_id = ? OR viewed_profile_id = ?", args: [userId, userId] });
            await db.execute({ sql: "DELETE FROM users WHERE telegram_id = ?", args: [userId] });
            
            return res.status(200).json({ success: true, message: 'User deleted' });
        }

        // API: /api/banned-users - Get banned users list
        if (path === 'api/banned-users' || path === 'banned-users') {
            const bannedResult = await db.execute({
                sql: "SELECT telegram_id, nickname, is_banned, is_shadowbanned, ban_reason, banned_at FROM users WHERE is_banned = 1 OR is_shadowbanned = 1 ORDER BY banned_at DESC",
                args: []
            });
            
            return res.status(200).json({
                bannedUsers: bannedResult.rows || []
            });
        }

        // API: /api/reports - Get reports list
        if (path === 'api/reports' || path === 'reports') {
            const reportsResult = await db.execute({
                sql: `SELECT r.*, 
                      reporter.nickname as reporter_name, 
                      reported.nickname as reported_name 
                      FROM reports r 
                      LEFT JOIN users reporter ON r.reporter_id = reporter.telegram_id 
                      LEFT JOIN users reported ON r.reported_user_id = reported.telegram_id 
                      ORDER BY r.created_at DESC LIMIT 100`,
                args: []
            });
            
            return res.status(200).json({
                reports: reportsResult.rows || []
            });
        }

        // API: /api/review-report - Review and take action on a report
        if (path === 'api/review-report' || path === 'review-report') {
            if (req.method !== 'POST') {
                return res.status(405).json({ error: 'Method not allowed' });
            }
            
            const { reportId, action, actionTaken } = req.body || {};
            
            if (!reportId || !action) {
                return res.status(400).json({ error: 'Report ID and action required' });
            }
            
            console.log('Review report:', reportId, 'Action:', action, 'ActionTaken:', actionTaken);
            
            const adminId = req.headers['x-admin-id'] || 0;
            
            // Update report status
            await db.execute({
                sql: "UPDATE reports SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, action_taken = ? WHERE id = ?",
                args: [action, adminId, actionTaken || 'no_action', reportId]
            });
            
            return res.status(200).json({ success: true, message: 'Report reviewed' });
        }
        
        console.log('Unknown path:', path);
        return res.status(404).json({ error: 'Not found', path });
    } catch (error) {
        console.error('Dashboard API Error:', error);
        return res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message,
            stack: error.stack 
        });
    }
}

// Vercel Handler - Ensures all async operations complete
export default async (req, res) => {
    // Handle Dashboard API routes
    if (req.url?.startsWith('/api/stats') || req.url?.startsWith('/api/users') || req.url?.startsWith('/api/matches') ||
        req.url?.startsWith('/api/analytics') || req.url?.startsWith('/api/search') || 
        req.url?.startsWith('/api/ban') || req.url?.startsWith('/api/delete-user') || 
        req.url?.startsWith('/api/banned-users') || req.url?.startsWith('/api/reports') ||
        req.url?.startsWith('/api/review-report') || req.url?.startsWith('/api/check-auth') ||
        req.url === '/stats' || req.url === '/users' || req.url === '/matches' || req.url === '/analytics' || 
        req.url === '/search' || req.url === '/ban' || req.url === '/delete-user' || req.url === '/banned-users' ||
        req.url === '/reports' || req.url === '/review-report' || req.url === '/check-auth') {
        return handleDashboardAPI(req, res);
    }
    
    // Serve dashboard HTML for root path
    if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard' || req.url === '/api' || req.url === '/api/' || req.url === '/api/index' || req.url === '/api/index/' || req.url?.startsWith('/api/index?'))) {
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(dashboardHTML);
    }
    
    // Bot webhook handler
    if (req.method !== 'POST') return res.status(200).send('Bot is running. POST to this endpoint for webhook. Dashboard at /');
    
    console.log('Received update:', req.body?.update_id, 'Type:', Object.keys(req.body || {})[1]);
    
    try {
        // Create a promise that resolves when all bot processing is done
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.warn('Bot processing timeout - forcing response');
                resolve();
            }, 9000); // 9 second timeout for Vercel
            
            bot.handleUpdate(req.body)
                .then(() => {
                    clearTimeout(timeout);
                    // Give a small delay for any background DB operations
                    setTimeout(resolve, 200);
                })
                .catch((err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
        });
        
        console.log('Update processed successfully');
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(200).json({ ok: true });
    }
};

// Dashboard HTML with plain JS
const dashboardHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MM Cupid Dashboard</title>
    <style>
        :root {
            color-scheme: light;
            font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f5f7fb;
            color: #1f2937;
        }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%); }
        button { cursor: pointer; }
        .app-shell { width: min(1200px, calc(100% - 32px)); margin: 0 auto; padding: 24px 0 48px; }
        .topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-mark { width: 48px; height: 48px; border-radius: 16px; background: linear-gradient(135deg, #ec4899, #ef4444); display: grid; place-items: center; color: white; font-weight: 700; }
        .brand-name { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.04em; }
        .brand-subtitle { color: #6b7280; margin: 4px 0 0; font-size: 0.95rem; }
        .button { border: none; border-radius: 999px; padding: 10px 18px; background: #ec4899; color: white; font-weight: 600; transition: transform 0.2s ease, background 0.2s ease; }
        .button:hover { transform: translateY(-1px); background: #db2777; }
        .button-muted { background: #e5e7eb; color: #374151; }
        .button-muted:hover { background: #d1d5db; }
        .panel { background: white; border-radius: 24px; box-shadow: 0 24px 64px rgba(15, 23, 42, 0.08); border: 1px solid rgba(229, 231, 235, 0.9); padding: 24px; }
        .cards { display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 20px; margin-bottom: 24px; }
        @media (min-width: 768px) { .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        .card { background: #fff; border-radius: 24px; padding: 22px; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06); border: 1px solid #e5e7eb; }
        .card-title { margin: 0; font-size: 0.9rem; font-weight: 600; color: #6b7280; }
        .card-value { margin: 12px 0 0; font-size: 2rem; font-weight: 800; color: #111827; }
        .card-meta { margin-top: 8px; font-size: 0.85rem; color: #10b981; }
        .grid { display: grid; gap: 20px; }
        .grid-2 { grid-template-columns: 1fr; }
        @media (min-width: 900px) { .grid-2 { grid-template-columns: 1.3fr 0.85fr; } }
        .section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
        .section-title h2 { margin: 0; font-size: 1.15rem; font-weight: 700; }
        .section-title p { margin: 0; color: #6b7280; }
        .tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
        .tab { padding: 10px 18px; border-radius: 999px; background: #f9fafb; color: #374151; border: 1px solid #e5e7eb; font-weight: 600; }
        .tab.active { background: #ec4899; color: white; border-color: transparent; }
        .table-wrapper { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; min-width: 640px; }
        th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; color: #6b7280; font-weight: 700; }
        td { color: #374151; vertical-align: middle; }
        tr:hover { background: #f9fafb; }
        .badge { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 700; }
        .badge.active { background: #d1fae5; color: #065f46; }
        .badge.pending { background: #fef3c7; color: #92400e; }
        .badge.male { background: #dbeafe; color: #1d4ed8; }
        .badge.female { background: #fce7f3; color: #be185d; }
        .warning { color: #b91c1c; margin-bottom: 18px; }
        .login-shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
        .login-panel { width: 100%; max-width: 420px; background: white; border-radius: 32px; padding: 32px; box-shadow: 0 30px 60px rgba(15, 23, 42, 0.12); }
        .login-panel h1 { margin: 0 0 12px; font-size: 1.75rem; }
        .login-panel p { margin: 0 0 24px; color: #6b7280; }
        .form-group { margin-bottom: 18px; }
        .form-group label { display: block; margin-bottom: 8px; color: #374151; font-weight: 600; }
        .input { width: 100%; padding: 14px 16px; border-radius: 18px; border: 1px solid #d1d5db; outline: none; font-size: 0.95rem; }
        .input:focus { border-color: #ec4899; box-shadow: 0 0 0 4px rgba(236, 72, 153, 0.12); }
        .text-muted { color: #6b7280; }
        .small-text { font-size: 0.85rem; }
        .card-grid { display: grid; gap: 18px; }
        @media (min-width: 640px) { .card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid rgba(236, 72, 153, 0.2); border-top-color: #ec4899; border-radius: 50%; animation: spin 0.9s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div id="app"></div>
    <script>
        const PASSWORD_KEY = 'mm_cupid_dashboard_password';
        const app = document.getElementById('app');
        const state = {
            auth: false,
            loading: false,
            error: '',
            activeTab: 'overview',
            stats: { totalUsers: 0, todayMatches: 0, lastUpdated: '' },
            users: [],
            matches: [],
            analytics: { genderDistribution: [], totalLikes: 0, dailyActiveUsers: 0, topCities: [], ageDistribution: [], matchSuccessRate: '0%', totalMatches: 0 }
        };

        function setError(message) {
            state.error = message;
            render();
        }

        function setLoading(value) {
            state.loading = value;
            render();
        }

        function getPassword() {
            return sessionStorage.getItem(PASSWORD_KEY) || '';
        }

        function savePassword(password) {
            sessionStorage.setItem(PASSWORD_KEY, password);
        }

        function clearPassword() {
            sessionStorage.removeItem(PASSWORD_KEY);
        }

        async function apiRequest(path, options = {}) {
            const headers = { 'Content-Type': 'application/json' };
            const password = getPassword();
            if (password) headers['X-Password'] = password;
            const response = await fetch(path, { method: options.method || 'GET', headers, body: options.body ? JSON.stringify(options.body) : undefined });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                if (response.status === 401) {
                    throw new Error('Unauthorized');
                }
                throw new Error(errorBody?.error || errorBody?.message || response.statusText || 'Request failed');
            }
            return await response.json();
        }

        async function verifyPassword(password) {
            const response = await fetch('/api/check-auth', { method: 'GET', headers: { 'X-Password': password } });
            return response.ok;
        }

        async function login(password) {
            state.error = '';
            state.loading = true;
            render();
            try {
                const valid = await verifyPassword(password);
                if (!valid) {
                    setError('Invalid password. Please try again.');
                    return;
                }
                savePassword(password);
                state.auth = true;
                await loadDashboard();
            } catch (err) {
                setError(err.message || 'Login failed.');
            } finally {
                state.loading = false;
            }
        }

        async function loadDashboard() {
            state.error = '';
            state.loading = true;
            render();
            try {
                const [statsResult, usersResult, matchesResult, analyticsResult] = await Promise.all([
                    apiRequest('/api/stats'),
                    apiRequest('/api/users'),
                    apiRequest('/api/matches'),
                    apiRequest('/api/analytics')
                ]);
                state.stats = Object.assign({}, state.stats, statsResult);
                state.users = usersResult.users || [];
                state.matches = matchesResult.matches || [];
                state.analytics = Object.assign({}, state.analytics, analyticsResult);
                state.auth = true;
            } catch (err) {
                if (err.message === 'Unauthorized') {
                    clearPassword();
                    state.auth = false;
                    setError('Session expired. Please log in again.');
                } else {
                    setError(err.message || 'Unable to load dashboard.');
                }
            } finally {
                state.loading = false;
                render();
            }
        }

        function renderLogin() {
            app.innerHTML =
                '<div class="login-shell">' +
                    '<div class="login-panel">' +
                        '<div class="brand" style="margin-bottom: 28px;">' +
                            '<div class="brand-mark">❤</div>' +
                            '<div>' +
                                '<div class="brand-name">MM Cupid</div>' +
                                '<div class="brand-subtitle">Admin Dashboard</div>' +
                            '</div>' +
                        '</div>' +
                        '<h1>Welcome back</h1>' +
                        '<p class="text-muted">Enter the dashboard password to continue.</p>' +
                        '<form id="login-form">' +
                            '<div class="form-group">' +
                                '<label for="password">Password</label>' +
                                '<input id="password" class="input" type="password" autocomplete="current-password" placeholder="Enter password" />' +
                            '</div>' +
                            '<button type="submit" class="button">Unlock Dashboard</button>' +
                        '</form>' +
                        '<p class="small-text text-muted" style="margin-top: 16px;">Contact your admin for the dashboard password.</p>' +
                        (state.error ? '<p class="warning">' + state.error + '</p>' : '') +
                    '</div>' +
                '</div>';
            document.getElementById('login-form').addEventListener('submit', function(event) {
                event.preventDefault();
                var password = document.getElementById('password').value.trim();
                login(password);
            });
        }

        function buildUserRows(users) {
            return users.map(function(user) {
                var gender = (user.gender || 'N/A').toLowerCase();
                var lookingFor = (user.looking_for || '-').toLowerCase();
                var genderClass = gender === 'male' ? 'male' : gender === 'female' ? 'female' : '';
                var lookingForClass = lookingFor === 'male' ? 'male' : lookingFor === 'female' ? 'female' : '';
                var statusClass = user.is_registered ? 'active' : 'pending';
                var statusText = user.is_registered ? 'Active' : 'Pending';
                return '<tr>' +
                    '<td>' + (user.nickname || 'Unknown') + '</td>' +
                    '<td>' + (user.age || '-') + '</td>' +
                    '<td><span class="badge ' + genderClass + '">' + (user.gender || 'N/A') + '</span></td>' +
                    '<td><span class="badge ' + lookingForClass + '">' + (user.looking_for || '-') + '</span></td>' +
                    '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>' +
                '</tr>';
            }).join('');
        }

        function buildMatchRows(matches) {
            return matches.map(function(match) {
                return '<tr><td>' + (match.user1.nickname || 'Unknown') + '</td><td>❤️ ' + (match.user2.nickname || 'Unknown') + '</td></tr>';
            }).join('');
        }

        function buildCitiesRows(cities) {
            return (cities || []).map(function(city) {
                return '<tr><td>' + (city.address || 'Unknown') + '</td><td>' + (city.count || 0) + '</td></tr>';
            }).join('');
        }

        function renderDashboard() {
            var stats = state.stats;
            var users = state.users;
            var matches = state.matches;
            var analytics = state.analytics;
            var activeTab = state.activeTab;
            app.innerHTML =
                '<div class="app-shell">' +
                    '<div class="topbar">' +
                        '<div class="brand">' +
                            '<div class="brand-mark">❤</div>' +
                            '<div>' +
                                '<div class="brand-name">MM Cupid Admin</div>' +
                                '<div class="brand-subtitle">Live bot analytics and user controls</div>' +
                            '</div>' +
                        '</div>' +
                        '<div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">' +
                            '<button class="button" id="refresh-button">Refresh</button>' +
                            '<button class="button button-muted" id="logout-button">Logout</button>' +
                        '</div>' +
                    '</div>' +
                    (state.error ? '<p class="warning">' + state.error + '</p>' : '') +
                    '<div class="cards">' +
                        '<div class="card"><p class="card-title">Registered users</p><p class="card-value">' + (stats.totalUsers || 0) + '</p><p class="card-meta">Latest total active users</p></div>' +
                        '<div class="card"><p class="card-title">Total matches</p><p class="card-value">' + (stats.todayMatches || 0) + '</p><p class="card-meta">Mutual likes from database</p></div>' +
                        '<div class="card"><p class="card-title">Last synced</p><p class="card-value">' + new Date(stats.lastUpdated || Date.now()).toLocaleString() + '</p><p class="card-meta">Data refresh timestamp</p></div>' +
                    '</div>' +
                    '<div class="section-title"><div><h2>Overview</h2><p class="text-muted">Quick access to users, matches, and analytics.</p></div></div>' +
                    '<div class="tabs">' +
                        '<button class="tab' + (activeTab === 'overview' ? ' active' : '') + '" data-tab="overview">Overview</button>' +
                        '<button class="tab' + (activeTab === 'users' ? ' active' : '') + '" data-tab="users">Users</button>' +
                        '<button class="tab' + (activeTab === 'matches' ? ' active' : '') + '" data-tab="matches">Matches</button>' +
                        '<button class="tab' + (activeTab === 'analytics' ? ' active' : '') + '" data-tab="analytics">Analytics</button>' +
                    '</div>' +
                    '<div class="grid grid-2">' +
                        '<div class="panel" style="display:' + (activeTab === 'overview' ? 'block' : 'none') + ';">' +
                            '<div class="section-title"><h2>Summary</h2></div>' +
                            '<div class="card-grid" style="margin-bottom: 20px;">' +
                                '<div class="card"><p class="card-title">Daily active users</p><p class="card-value">' + (analytics.dailyActiveUsers || 0) + '</p></div>' +
                                '<div class="card"><p class="card-title">Total likes</p><p class="card-value">' + (analytics.totalLikes || 0) + '</p></div>' +
                                '<div class="card"><p class="card-title">Match success</p><p class="card-value">' + (analytics.matchSuccessRate || '0%') + '</p></div>' +
                            '</div>' +
                            '<div class="section-title"><h2>Top cities</h2></div>' +
                            '<div class="table-wrapper"><table><tbody>' + buildCitiesRows(analytics.topCities) + '</tbody></table></div>' +
                        '</div>' +
                        '<div class="panel" style="display:' + (activeTab === 'analytics' ? 'block' : 'none') + ';">' +
                            '<div class="section-title"><h2>Detailed analytics</h2></div>' +
                            '<div class="card-grid" style="margin-bottom: 20px;">' +
                                '<div class="card"><p class="card-title">Match total</p><p class="card-value">' + (analytics.totalMatches || 0) + '</p></div>' +
                                '<div class="card"><p class="card-title">Gender segments</p><p class="card-value">' + ((analytics.genderDistribution || []).map(function(item){ return item.gender + ': ' + item.count; }).join(', ') || 'No data') + '</p></div>' +
                                '<div class="card"><p class="card-title">Age spread</p><p class="card-value">' + ((analytics.ageDistribution || []).map(function(item){ return item.range + ': ' + item.count; }).join(', ') || 'No data') + '</p></div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="panel" style="display:' + (activeTab === 'users' ? 'block' : 'none') + ';">' +
                        '<div class="section-title"><h2>Users</h2></div>' +
                        '<div class="table-wrapper"><table><thead><tr><th>Name</th><th>Age</th><th>Gender</th><th>Looking for</th><th>Status</th></tr></thead><tbody>' + buildUserRows(users) + '</tbody></table></div>' +
                    '</div>' +
                    '<div class="panel" style="display:' + (activeTab === 'matches' ? 'block' : 'none') + ';">' +
                        '<div class="section-title"><h2>Latest matches</h2></div>' +
                        '<div class="table-wrapper"><table><thead><tr><th>Match</th><th></th></tr></thead><tbody>' + buildMatchRows(matches) + '</tbody></table></div>' +
                    '</div>' +
                '</div>';
            document.getElementById('refresh-button').addEventListener('click', function() { loadDashboard(); });
            document.getElementById('logout-button').addEventListener('click', function() { clearPassword(); state.auth = false; render(); });
            var tabs = document.querySelectorAll('.tab');
            tabs.forEach(function(button) {
                button.addEventListener('click', function() {
                    state.activeTab = button.getAttribute('data-tab');
                    render();
                });
            });
        }

        function render() {
            if (!state.auth) {
                renderLogin();
                return;
            }
            if (state.loading) {
                app.innerHTML = '<div class="app-shell" style="text-align:center;padding:60px;"><div class="spinner"></div><p style="margin-top:16px;color:#6b7280;">Loading dashboard...</p></div>';
                return;
            }
            renderDashboard();
        }

        async function init() {
            var password = getPassword();
            if (password) {
                state.loading = true;
                render();
                try {
                    var valid = await verifyPassword(password);
                    if (valid) {
                        state.auth = true;
                        await loadDashboard();
                        return;
                    }
                } catch (err) {
                    console.warn('Auth verify failed', err);
                }
                clearPassword();
                state.loading = false;
            }
            render();
        }

        window.addEventListener('DOMContentLoaded', init);
    </script>
</body>
</html>`;

// Local development - start bot with polling if not in Vercel environment
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    console.log('Starting bot in polling mode for local development...');
    bot.launch().then(() => {
        console.log('Bot started successfully!');
    }).catch((err) => {
        console.error('Failed to start bot:', err);
    });
}