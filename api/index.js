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
        if (!text || text.trim() === '') return await ctx.reply('ကျေးဇူးပြု၍ interests (tags) တစ်ခုခု ရိုက်ထည့်ပါ၊ ဥပမာ: travel, music, food');

        // Normalize tags: keep as comma-separated string
        const parts = text.split(/[,;]+|\s+/).map(p => p.trim()).filter(Boolean);
        const normalized = parts.join(',');

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
                sql: "UPDATE users SET max_distance_km = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", 
                args: [distance, ctx.from.id] 
            });
            
            const welcomeText = `✅ *အားလုံးအဆင်ပြေသွားပါပြီ။*

အခုဆိုရင် သင်ဟာ MM Cupid ရဲ့ အဖွဲ့ဝင်တစ်ဦး ဖြစ်သွားပါပြီ။ 💕
အောက်က ခလုတ်ကိုနှိပ်ပြီး သင့်ရဲ့ ဖူးစာရှင်ကို စတင်ရှာဖွေနိုင်ပါပြီ။ 👇`;
            
            return await ctx.reply(welcomeText, {
                parse_mode: 'Markdown',
                ...Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize()
            });
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
                ['❌ Chat မှထွက်မည်']
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
    if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard' || req.url === '/api' || req.url === '/api/')) {
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

// Dashboard HTML with React
const dashboardHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MM Cupid Dashboard</title>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div id="root"></div>
    <script type="text/babel">
        const { useState, useEffect } = React;

        // Card Component
        const StatCard = ({ title, value, icon, color, trend }) => (
            <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500 mb-1">{title}</p>
                        <h3 className="text-2xl font-bold text-gray-800">{value}</h3>
                        {trend && (
                            <p className="text-xs text-green-500 mt-1">
                                <i className="fas fa-arrow-up mr-1"></i>{trend}
                            </p>
                        )}
                    </div>
                    <div className={\`w-12 h-12 rounded-full \${color} flex items-center justify-center text-white text-xl\`}>
                        <i className={\`fas \${icon}\`}></i>
                    </div>
                </div>
            </div>
        );

        // User List Component
        const UserList = ({ users, loading }) => {
            if (loading) return <div className="text-center py-8"><i className="fas fa-spinner fa-spin text-3xl text-pink-500"></i></div>;
            
            return (
                <div className="bg-white rounded-xl shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Age</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gender</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Looking For</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {users.map((user) => (
                                    <tr key={user.telegram_id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-red-500 flex items-center justify-center text-white text-sm font-medium mr-3">
                                                    {user.nickname?.charAt(0)?.toUpperCase() || '?'}
                                                </div>
                                                <span className="font-medium text-gray-800">{user.nickname}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600">{user.age}</td>
                                        <td className="px-4 py-3">
                                            <span className={\`px-2 py-1 rounded-full text-xs \${user.gender === 'male' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'}\`}>
                                                {user.gender?.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={\`px-2 py-1 rounded-full text-xs \${user.looking_for === 'male' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'}\`}>
                                                {user.looking_for?.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={\`px-2 py-1 rounded-full text-xs \${user.is_registered ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}\`}>
                                                {user.is_registered ? 'Active' : 'Pending'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        };

        // Match List Component
        const MatchList = ({ matches, loading }) => {
            if (loading) return <div className="text-center py-8"><i className="fas fa-spinner fa-spin text-3xl text-pink-500"></i></div>;
            
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {matches.map((match, index) => (
                        <div key={index} className="bg-white rounded-xl shadow-md p-4 border border-gray-100">
                            <div className="flex items-center justify-center mb-4">
                                <div className="flex items-center">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium">
                                        {match.user1.nickname?.charAt(0)?.toUpperCase()}
                                    </div>
                                    <div className="mx-2 text-red-500">
                                        <i className="fas fa-heart"></i>
                                    </div>
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-red-500 flex items-center justify-center text-white font-medium">
                                        {match.user2.nickname?.charAt(0)?.toUpperCase()}
                                    </div>
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="font-medium text-gray-800">{match.user1.nickname} ❤️ {match.user2.nickname}</p>
                                <p className="text-xs text-pink-500 mt-1">
                                    <i className="fas fa-heart mr-1"></i>Match!
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            );
        };

        // Login Component
        const LoginScreen = ({ onLogin, loginError }) => {
            const [password, setPassword] = useState('');
            const [showPassword, setShowPassword] = useState(false);

            const handleSubmit = (e) => {
                e.preventDefault();
                onLogin(password);
            };

            return (
                <div className="min-h-screen bg-gradient-to-br from-pink-500 via-red-500 to-purple-600 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-red-600 flex items-center justify-center text-white text-3xl mx-auto mb-4">
                                <i className="fas fa-heart"></i>
                            </div>
                            <h1 className="text-2xl font-bold text-gray-800">MM Cupid</h1>
                            <p className="text-gray-500">Admin Dashboard</p>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none"
                                        placeholder="Enter password"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    >
                                        <i className={\`fas \${showPassword ? 'fa-eye-slash' : 'fa-eye'}\`}></i>
                                    </button>
                                </div>
                            </div>

                            {loginError && (
                                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-red-600 text-sm">
                                        <i className="fas fa-exclamation-circle mr-2"></i>
                                        {loginError}
                                    </p>
                                </div>
                            )}

                            <button
                                type="submit"
                                className="w-full py-3 bg-gradient-to-r from-pink-500 to-red-600 text-white rounded-lg font-medium hover:from-pink-600 hover:to-red-700 transition-all transform hover:scale-[1.02]"
                            >
                                <i className="fas fa-lock mr-2"></i>Login
                            </button>
                        </form>

                        <div className="mt-6 text-center">
                            <p className="text-xs text-gray-400">
                                Default: admin123
                            </p>
                        </div>
                    </div>
                </div>
            );
        };

        // Main Dashboard Component
        const Dashboard = () => {
            const [stats, setStats] = useState({ totalUsers: 0, todayMatches: 0 });
            const [users, setUsers] = useState([]);
            const [matches, setMatches] = useState([]);
            const [activeTab, setActiveTab] = useState('overview');
            const [loading, setLoading] = useState(true);
            const [lastUpdate, setLastUpdate] = useState(new Date());
            const [error, setError] = useState(null);
            const [isLoggedIn, setIsLoggedIn] = useState(false);
            const [password, setPassword] = useState('');
            const [loginError, setLoginError] = useState('');
            
            // Analytics state
            const [analytics, setAnalytics] = useState({
                genderDistribution: [],
                totalLikes: 0,
                dailyActiveUsers: 0,
                topCities: [],
                ageDistribution: [],
                matchSuccessRate: '0%',
                totalMatches: 0
            });
            
            // Search state
            const [searchQuery, setSearchQuery] = useState('');
            const [searchType, setSearchType] = useState('nickname');
            const [searchResults, setSearchResults] = useState([]);
            const [searchLoading, setSearchLoading] = useState(false);
            
            // Moderation state
            const [bannedUsers, setBannedUsers] = useState([]);
            const [reports, setReports] = useState([]);
            const [actionMessage, setActionMessage] = useState('');

            const API_URL = '';

            const handleLogin = async (pwd) => {
                setPassword(pwd);
                setLoginError('');
                
                try {
                    const res = await fetch(\`\${API_URL}/api/check-auth?password=\${encodeURIComponent(pwd)}\`);
                    if (res.ok) {
                        setIsLoggedIn(true);
                        sessionStorage.setItem('dashboardPassword', pwd);
                    } else {
                        setLoginError('Invalid password');
                    }
                } catch (err) {
                    setLoginError('Connection error');
                }
            };

            // Check for saved password on mount
            useEffect(() => {
                const savedPwd = sessionStorage.getItem('dashboardPassword');
                if (savedPwd) {
                    handleLogin(savedPwd);
                }
            }, []);

            const fetchData = async () => {
                if (!isLoggedIn || !password) return;
                
                try {
                    setLoading(true);
                    setError(null);
                    
                    console.log('Fetching dashboard data...');
                    
                    const headers = { 'X-Password': password };
                    
                    const [statsRes, usersRes, matchesRes, analyticsRes, bannedRes, reportsRes] = await Promise.all([
                        fetch(\`\${API_URL}/api/stats\`, { headers }).then(async r => {
                            if (!r.ok) throw new Error(\`Stats API error: \${r.status}\`);
                            return r.json();
                        }),
                        fetch(\`\${API_URL}/api/users\`, { headers }).then(async r => {
                            if (!r.ok) throw new Error(\`Users API error: \${r.status}\`);
                            return r.json();
                        }),
                        fetch(\`\${API_URL}/api/matches\`, { headers }).then(async r => {
                            if (!r.ok) throw new Error(\`Matches API error: \${r.status}\`);
                            return r.json();
                        }),
                        fetch(\`\${API_URL}/api/analytics\`, { headers }).then(async r => {
                            if (!r.ok) throw new Error(\`Analytics API error: \${r.status}\`);
                            return r.json();
                        }),
                        fetch(\`\${API_URL}/api/banned-users\`, { headers }).then(async r => {
                            if (!r.ok) return { bannedUsers: [] };
                            return r.json();
                        }),
                        fetch(\`\${API_URL}/api/reports\`, { headers }).then(async r => {
                            if (!r.ok) return { reports: [] };
                            return r.json();
                        })
                    ]);
                    
                    console.log('Stats:', statsRes);
                    console.log('Users:', usersRes);
                    console.log('Matches:', matchesRes);
                    console.log('Analytics:', analyticsRes);
                    
                    if (statsRes.error) throw new Error(statsRes.error);
                    if (usersRes.error) throw new Error(usersRes.error);
                    if (matchesRes.error) throw new Error(matchesRes.error);
                    
                    setStats(statsRes);
                    setUsers(usersRes.users || []);
                    setMatches(matchesRes.matches || []);
                    setAnalytics(analyticsRes || {});
                    setBannedUsers(bannedRes?.bannedUsers || []);
                    setReports(reportsRes?.reports || []);
                    setLastUpdate(new Date());
                } catch (error) {
                    console.error('Error fetching data:', error);
                    setError(error.message);
                } finally {
                    setLoading(false);
                }
            };

            // Search function
            const handleSearch = async () => {
                if (!searchQuery.trim()) return;
                
                setSearchLoading(true);
                try {
                    const headers = { 'X-Password': password };
                    const res = await fetch(\`\${API_URL}/api/search?type=\${searchType}&q=\${encodeURIComponent(searchQuery)}\`, { headers });
                    const data = await res.json();
                    setSearchResults(data.users || []);
                } catch (err) {
                    console.error('Search error:', err);
                } finally {
                    setSearchLoading(false);
                }
            };

            // Ban user function
            const handleBanUser = async (userId, action) => {
                try {
                    const headers = { 
                        'X-Password': password,
                        'Content-Type': 'application/json'
                    };
                    const res = await fetch(\`\${API_URL}/api/ban\`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ userId, action })
                    });
                    const data = await res.json();
                    if (data.success) {
                        setActionMessage(\`User \${action === 'ban' ? 'banned' : 'unbanned'} successfully\`);
                        fetchData(); // Refresh data
                        setTimeout(() => setActionMessage(''), 3000);
                    }
                } catch (err) {
                    console.error('Ban error:', err);
                    setActionMessage('Error performing action');
                }
            };

            // Delete user function
            const handleDeleteUser = async (userId) => {
                if (!confirm('Are you sure you want to delete this user? This cannot be undone.')) return;
                
                try {
                    const headers = { 
                        'X-Password': password,
                        'Content-Type': 'application/json'
                    };
                    const res = await fetch(\`\${API_URL}/api/delete-user\`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ userId })
                    });
                    const data = await res.json();
                    if (data.success) {
                        setActionMessage('User deleted successfully');
                        fetchData(); // Refresh data
                        setTimeout(() => setActionMessage(''), 3000);
                    }
                } catch (err) {
                    console.error('Delete error:', err);
                    setActionMessage('Error deleting user');
                }
            };

            // Review report function
            const handleReviewReport = async (reportId, action, actionTaken) => {
                try {
                    const headers = { 
                        'X-Password': password,
                        'Content-Type': 'application/json'
                    };
                    const res = await fetch(\`\${API_URL}/api/review-report\`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ reportId, action, actionTaken })
                    });
                    const data = await res.json();
                    if (data.success) {
                        setActionMessage(\`Report \${action} successfully\`);
                        fetchData(); // Refresh data
                        setTimeout(() => setActionMessage(''), 3000);
                    }
                } catch (err) {
                    console.error('Review error:', err);
                    setActionMessage('Error reviewing report');
                }
            };

            useEffect(() => {
                if (isLoggedIn && password) {
                    fetchData();
                    const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
                    return () => clearInterval(interval);
                }
            }, [isLoggedIn, password]);

            // Show login screen if not authenticated
            if (!isLoggedIn) {
                return <LoginScreen onLogin={handleLogin} loginError={loginError} />;
            }

            return (
                <div className="min-h-screen bg-gray-50">
                    {/* Header */}
                    <header className="bg-white shadow-sm border-b border-gray-200">
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-red-600 flex items-center justify-center text-white mr-3">
                                        <i className="fas fa-heart"></i>
                                    </div>
                                    <div>
                                        <h1 className="text-xl font-bold text-gray-800">MM Cupid</h1>
                                        <p className="text-xs text-gray-500">Admin Dashboard</p>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-4">
                                    <span className="text-sm text-gray-500">
                                        Last updated: {lastUpdate.toLocaleTimeString()}
                                    </span>
                                    <button 
                                        onClick={fetchData}
                                        className="p-2 rounded-lg bg-pink-50 text-pink-600 hover:bg-pink-100 transition-colors"
                                    >
                                        <i className={\`fas fa-sync-alt \${loading ? 'fa-spin' : ''}\`}></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </header>

                    {/* Navigation */}
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit mb-6">
                            {[
                                { id: 'overview', label: 'Overview', icon: 'fa-chart-line' },
                                { id: 'analytics', label: 'Analytics', icon: 'fa-chart-pie' },
                                { id: 'users', label: 'Users', icon: 'fa-users' },
                                { id: 'search', label: 'Search', icon: 'fa-search' },
                                { id: 'matches', label: 'Matches', icon: 'fa-heart' },
                                { id: 'reports', label: 'Reports', icon: 'fa-flag' },
                                { id: 'moderation', label: 'Moderation', icon: 'fa-shield-alt' }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={\`px-4 py-2 rounded-md text-sm font-medium transition-all \${
                                        activeTab === tab.id 
                                            ? 'bg-white text-pink-600 shadow-sm' 
                                            : 'text-gray-600 hover:text-gray-800'
                                    }\`}
                                >
                                    <i className={\`fas \${tab.icon} mr-2\`}></i>
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Error Display */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                                <div className="flex items-center">
                                    <i className="fas fa-exclamation-circle text-red-500 mr-3"></i>
                                    <div>
                                        <p className="text-red-800 font-medium">Error loading data</p>
                                        <p className="text-red-600 text-sm">{error}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Content */}
                        {activeTab === 'overview' && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <StatCard 
                                        title="Total Users" 
                                        value={stats.totalUsers} 
                                        icon="fa-users" 
                                        color="bg-blue-500"
                                        trend="All time"
                                    />
                                    <StatCard 
                                        title="Today's Matches" 
                                        value={stats.todayMatches} 
                                        icon="fa-heart" 
                                        color="bg-pink-500"
                                        trend="Real-time"
                                    />
                                    <StatCard 
                                        title="Active Now" 
                                        value={users.filter(u => u.is_registered).length} 
                                        icon="fa-signal" 
                                        color="bg-green-500"
                                        trend="Registered"
                                    />
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div className="bg-white rounded-xl shadow-md p-6">
                                        <h3 className="text-lg font-bold text-gray-800 mb-4">
                                            <i className="fas fa-users mr-2 text-blue-500"></i>
                                            Recent Users
                                        </h3>
                                        <UserList users={users.slice(0, 5)} loading={loading} />
                                    </div>
                                    <div className="bg-white rounded-xl shadow-md p-6">
                                        <h3 className="text-lg font-bold text-gray-800 mb-4">
                                            <i className="fas fa-heart mr-2 text-pink-500"></i>
                                            Recent Matches
                                        </h3>
                                        <MatchList matches={matches.slice(0, 6)} loading={loading} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'users' && (
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-xl font-bold text-gray-800">All Users</h2>
                                    <span className="text-sm text-gray-500">Total: {users.length}</span>
                                </div>
                                <UserList users={users} loading={loading} />
                            </div>
                        )}

                        {activeTab === 'matches' && (
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-xl font-bold text-gray-800">All Matches</h2>
                                    <span className="text-sm text-gray-500">Total: {matches.length}</span>
                                </div>
                                <MatchList matches={matches} loading={loading} />
                            </div>
                        )}

                        {activeTab === 'analytics' && (
                            <div className="space-y-6">
                                <h2 className="text-xl font-bold text-gray-800">Analytics</h2>
                                
                                {/* Stats Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div className="bg-white rounded-xl shadow-md p-4">
                                        <p className="text-sm text-gray-500">Total Likes</p>
                                        <p className="text-2xl font-bold text-pink-600">{analytics.totalLikes || 0}</p>
                                    </div>
                                    <div className="bg-white rounded-xl shadow-md p-4">
                                        <p className="text-sm text-gray-500">Daily Active Users</p>
                                        <p className="text-2xl font-bold text-blue-600">{analytics.dailyActiveUsers || 0}</p>
                                    </div>
                                    <div className="bg-white rounded-xl shadow-md p-4">
                                        <p className="text-sm text-gray-500">Match Success Rate</p>
                                        <p className="text-2xl font-bold text-green-600">{analytics.matchSuccessRate || '0%'}</p>
                                    </div>
                                    <div className="bg-white rounded-xl shadow-md p-4">
                                        <p className="text-sm text-gray-500">Total Matches</p>
                                        <p className="text-2xl font-bold text-red-600">{analytics.totalMatches || 0}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Gender Distribution */}
                                    <div className="bg-white rounded-xl shadow-md p-6">
                                        <h3 className="text-lg font-semibold mb-4">Gender Distribution</h3>
                                        <div className="space-y-3">
                                            {(analytics.genderDistribution || []).map((g, i) => (
                                                <div key={i} className="flex items-center justify-between">
                                                    <span className="capitalize">{g.gender || 'Unknown'}</span>
                                                    <div className="flex items-center">
                                                        <div className="w-32 bg-gray-200 rounded-full h-2 mr-2">
                                                            <div 
                                                                className={\`h-2 rounded-full \${g.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}\`}
                                                                style={{ width: \`\${(g.count / (stats.totalUsers || 1)) * 100}%\` }}
                                                            ></div>
                                                        </div>
                                                        <span className="text-sm font-medium">{g.count}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Age Distribution */}
                                    <div className="bg-white rounded-xl shadow-md p-6">
                                        <h3 className="text-lg font-semibold mb-4">Age Distribution</h3>
                                        <div className="space-y-3">
                                            {(analytics.ageDistribution || []).map((a, i) => (
                                                <div key={i} className="flex items-center justify-between">
                                                    <span>{a.range}</span>
                                                    <div className="flex items-center">
                                                        <div className="w-32 bg-gray-200 rounded-full h-2 mr-2">
                                                            <div 
                                                                className="h-2 rounded-full bg-purple-500"
                                                                style={{ width: \`\${(a.count / (stats.totalUsers || 1)) * 100}%\` }}
                                                            ></div>
                                                        </div>
                                                        <span className="text-sm font-medium">{a.count}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Top Cities */}
                                <div className="bg-white rounded-xl shadow-md p-6">
                                    <h3 className="text-lg font-semibold mb-4">Top Cities</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                        {(analytics.topCities || []).map((city, i) => (
                                            <div key={i} className="bg-gray-50 rounded-lg p-3 text-center">
                                                <p className="text-sm font-medium text-gray-800">{city.address}</p>
                                                <p className="text-xs text-gray-500">{city.count} users</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'search' && (
                            <div className="space-y-6">
                                <h2 className="text-xl font-bold text-gray-800">Search Users</h2>
                                
                                <div className="bg-white rounded-xl shadow-md p-4">
                                    <div className="flex gap-2 mb-4">
                                        <select 
                                            value={searchType} 
                                            onChange={(e) => setSearchType(e.target.value)}
                                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none"
                                        >
                                            <option value="nickname">Nickname</option>
                                            <option value="city">City</option>
                                            <option value="age">Age</option>
                                        </select>
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder={\`Search by \${searchType}...\`}
                                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none"
                                            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                                        />
                                        <button
                                            onClick={handleSearch}
                                            disabled={searchLoading}
                                            className="px-6 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition-colors disabled:opacity-50"
                                        >
                                            <i className={\`fas \${searchLoading ? 'fa-spinner fa-spin' : 'fa-search'}\`}></i>
                                        </button>
                                    </div>

                                    {searchResults.length > 0 && (
                                        <div className="overflow-x-auto">
                                            <table className="w-full">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left">Nickname</th>
                                                        <th className="px-4 py-2 text-left">Age</th>
                                                        <th className="px-4 py-2 text-left">Gender</th>
                                                        <th className="px-4 py-2 text-left">City</th>
                                                        <th className="px-4 py-2 text-left">Bio</th>
                                                        <th className="px-4 py-2 text-left">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {searchResults.map((user) => (
                                                        <tr key={user.telegram_id}>
                                                            <td className="px-4 py-2 font-medium">{user.nickname}</td>
                                                            <td className="px-4 py-2">{user.age}</td>
                                                            <td className="px-4 py-2 capitalize">{user.gender}</td>
                                                            <td className="px-4 py-2">{user.address}</td>
                                                            <td className="px-4 py-2 text-sm text-gray-500 max-w-xs truncate">{user.bio}</td>
                                                            <td className="px-4 py-2">
                                                                <button
                                                                    onClick={() => handleBanUser(user.telegram_id, 'ban')}
                                                                    className="text-red-500 hover:text-red-700 mr-2"
                                                                    title="Ban User"
                                                                >
                                                                    <i className="fas fa-ban"></i>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteUser(user.telegram_id)}
                                                                    className="text-red-600 hover:text-red-800"
                                                                    title="Delete User"
                                                                >
                                                                    <i className="fas fa-trash"></i>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {searchResults.length === 0 && searchQuery && !searchLoading && (
                                        <p className="text-center text-gray-500 py-4">No users found</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'reports' && (
                            <div className="space-y-6">
                                <h2 className="text-xl font-bold text-gray-800">User Reports</h2>
                                
                                {actionMessage && (
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                        <p className="text-green-600 text-sm">{actionMessage}</p>
                                    </div>
                                )}

                                {/* Reports List */}
                                <div className="bg-white rounded-xl shadow-md p-6">
                                    <h3 className="text-lg font-semibold mb-4">Reports ({reports.length})</h3>
                                    {reports.length > 0 ? (
                                        <div className="space-y-4">
                                            {reports.map((report) => (
                                                <div key={report.id} className="border border-gray-200 rounded-lg p-4">
                                                    <div className="flex items-start justify-between mb-3">
                                                        <div>
                                                            <span className={\`px-2 py-1 rounded-full text-xs font-medium \${
                                                                report.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                                                                report.status === 'reviewed' ? 'bg-blue-100 text-blue-600' :
                                                                report.status === 'resolved' ? 'bg-green-100 text-green-600' :
                                                                'bg-gray-100 text-gray-600'
                                                            }\`}>
                                                                {report.status?.toUpperCase()}
                                                            </span>
                                                            <span className="ml-2 text-sm text-gray-500">
                                                                {new Date(report.created_at).toLocaleString()}
                                                            </span>
                                                        </div>
                                                        <span className="text-sm font-mono text-gray-400">#{report.id}</span>
                                                    </div>
                                                    
                                                    <div className="mb-3">
                                                        <p className="text-sm text-gray-600">
                                                            <span className="font-medium">Reporter:</span> {report.reporter_name || 'Unknown'} (ID: {report.reporter_id})
                                                        </p>
                                                        <p className="text-sm text-gray-600">
                                                            <span className="font-medium">Reported:</span> {report.reported_name || 'Unknown'} (ID: {report.reported_user_id})
                                                        </p>
                                                        <p className="text-sm text-gray-600">
                                                            <span className="font-medium">Reason:</span> 
                                                            <span className={\`ml-1 px-2 py-0.5 rounded text-xs \${
                                                                report.reason === 'fake' ? 'bg-purple-100 text-purple-600' :
                                                                report.reason === 'spam' ? 'bg-orange-100 text-orange-600' :
                                                                'bg-red-100 text-red-600'
                                                            }\`}>
                                                                {report.reason?.toUpperCase()}
                                                            </span>
                                                        </p>
                                                        {report.description && (
                                                            <p className="text-sm text-gray-600 mt-1">
                                                                <span className="font-medium">Description:</span> {report.description}
                                                            </p>
                                                        )}
                                                    </div>

                                                    {report.status === 'pending' && (
                                                        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                                                            <button
                                                                onClick={() => handleReviewReport(report.id, 'resolved', 'banned')}
                                                                className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
                                                            >
                                                                Ban User
                                                            </button>
                                                            <button
                                                                onClick={() => handleReviewReport(report.id, 'resolved', 'shadowbanned')}
                                                                className="px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600"
                                                            >
                                                                Shadowban
                                                            </button>
                                                            <button
                                                                onClick={() => handleReviewReport(report.id, 'dismissed', 'no_action')}
                                                                className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                                                            >
                                                                Dismiss
                                                            </button>
                                                        </div>
                                                    )}

                                                    {report.status !== 'pending' && (
                                                        <div className="mt-3 pt-3 border-t border-gray-100">
                                                            <p className="text-sm text-gray-500">
                                                                <span className="font-medium">Action Taken:</span> {report.action_taken || 'None'}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 text-center py-4">No reports</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'moderation' && (
                            <div className="space-y-6">
                                <h2 className="text-xl font-bold text-gray-800">Moderation</h2>
                                
                                {actionMessage && (
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                        <p className="text-green-600 text-sm">{actionMessage}</p>
                                    </div>
                                )}

                                {/* Banned Users */}
                                <div className="bg-white rounded-xl shadow-md p-6">
                                    <h3 className="text-lg font-semibold mb-4">Banned Users ({bannedUsers.length})</h3>
                                    {bannedUsers.length > 0 ? (
                                        <div className="overflow-x-auto">
                                            <table className="w-full">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left">User ID</th>
                                                        <th className="px-4 py-2 text-left">Nickname</th>
                                                        <th className="px-4 py-2 text-left">Type</th>
                                                        <th className="px-4 py-2 text-left">Reason</th>
                                                        <th className="px-4 py-2 text-left">Banned At</th>
                                                        <th className="px-4 py-2 text-left">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {bannedUsers.map((user) => (
                                                        <tr key={user.telegram_id}>
                                                            <td className="px-4 py-2 font-mono text-sm">{user.telegram_id}</td>
                                                            <td className="px-4 py-2">{user.nickname || 'Unknown'}</td>
                                                            <td className="px-4 py-2">
                                                                <span className={\`px-2 py-1 rounded-full text-xs \${
                                                                    user.is_banned ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                                                                }\`}>
                                                                    {user.is_banned ? 'Banned' : 'Shadowbanned'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2 text-sm text-gray-500">{user.ban_reason || 'N/A'}</td>
                                                            <td className="px-4 py-2 text-sm text-gray-500">
                                                                {user.banned_at ? new Date(user.banned_at).toLocaleString() : 'N/A'}
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                <button
                                                                    onClick={() => handleBanUser(user.telegram_id, user.is_banned ? 'unban' : 'unshadowban')}
                                                                    className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                                                                >
                                                                    {user.is_banned ? 'Unban' : 'Unshadowban'}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 text-center py-4">No banned users</p>
                                    )}
                                </div>

                                {/* Quick Stats */}
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div className="bg-white rounded-xl shadow-md p-4">
                                        <p className="text-sm text-gray-500">Total Users</p>
                                        <p className="text-2xl font-bold text-blue-600">{stats.totalUsers}</p>
                                    </div>
                                    <div className="bg-white rounded-xl shadow-md p-4">
                                        <p className="text-sm text-gray-500">Banned Users</p>
                                        <p className="text-2xl font-bold text-red-600">{bannedUsers.filter(u => u.is_banned).length}</p>
                                    </div>
                                    <div className="bg-white rounded-xl shadow-md p-4">
                                        <p className="text-sm text-gray-500">Shadowbanned</p>
                                        <p className="text-2xl font-bold text-orange-600">{bannedUsers.filter(u => u.is_shadowbanned).length}</p>
                                    </div>
                                    <div className="bg-white rounded-xl shadow-md p-4">
                                        <p className="text-sm text-gray-500">Pending Reports</p>
                                        <p className="text-2xl font-bold text-yellow-600">{reports.filter(r => r.status === 'pending').length}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        };

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<Dashboard />);
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