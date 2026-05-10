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
            // Get total registered users (cache for 5 minutes)
            const now = Date.now();
            if (now - this.lastCacheTime > 300000) {
                const totalResult = await db.execute({
                    sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1"
                });
                this.cachedTotalUsers = totalResult.rows[0]?.count || 0;
                this.lastCacheTime = now;
            }
            
            // Get today's matches from database (count mutual likes today)
            const today = new Date().toISOString().split('T')[0];
            const matchesResult = await db.execute({
                sql: `SELECT COUNT(*) as count FROM likes 
                      WHERE date(created_at) = date('now') 
                      OR (created_at IS NULL AND date('now') = date('now'))`  
            });
            
            // Use in-memory count + database estimate
            const dbMatches = matchesResult.rows[0]?.count || 0;
            const estimatedMatches = Math.max(this.todayMatches, Math.floor(dbMatches / 2)); // Divide by 2 since each match = 2 likes
            
            return {
                online: this.cachedTotalUsers,  // Total registered users
                matches: estimatedMatches,     // Today's matches
                total: this.cachedTotalUsers
            };
        } catch (error) {
            console.error('Error getting real stats:', error);
            return {
                online: this.cachedTotalUsers || 0,
                matches: this.todayMatches,
                total: this.cachedTotalUsers || 0
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

const getRandomProfile = async (userId, lookingFor, viewedIds = []) => {
    try {
        // Build the NOT IN clause if we have session viewed IDs
        const allViewedIds = [...viewedIds];
        const notInClause = allViewedIds.length > 0 
            ? `AND u.telegram_id NOT IN (${allViewedIds.map(() => '?').join(',')})`
            : '';
        const notInArgs = allViewedIds.length > 0 ? allViewedIds : [];
        
        // Try with profile_views join and session viewed IDs
        try {
            const sql = `SELECT u.* FROM users u 
                      LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                      WHERE u.is_registered = 1 
                        AND u.telegram_id != ? 
                        AND u.gender = ? 
                        AND pv.viewed_profile_id IS NULL
                        ${notInClause}
                      ORDER BY RANDOM() LIMIT 1`;
            
            const args = [userId, userId, lookingFor, ...notInArgs];
            
            console.log('Fetching random profile with viewedIds:', allViewedIds.length);
            const unviewedResult = await db.execute({ sql, args });
            
            if (unviewedResult.rows.length > 0) {
                return unviewedResult.rows[0];
            }
            
            // If no results with strict filtering, try without session viewed IDs
            if (allViewedIds.length > 0) {
                console.log('No new profiles, clearing session cache and retrying...');
                sessionViewedCache.delete(userId);
                
                const fallbackResult = await db.execute({
                    sql: `SELECT u.* FROM users u 
                          LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                          WHERE u.is_registered = 1 AND u.telegram_id != ? AND u.gender = ? AND pv.viewed_profile_id IS NULL
                          ORDER BY RANDOM() LIMIT 1`,
                    args: [userId, userId, lookingFor]
                });
                
                if (fallbackResult.rows.length > 0) {
                    return fallbackResult.rows[0];
                }
            }
        } catch (dbError) {
            console.error('Profile views query failed:', dbError.message);
        }
        
        // Fallback: get any random profile excluding session viewed
        const fallbackArgs = [userId, lookingFor, ...notInArgs];
        const fallbackWhere = allViewedIds.length > 0 
            ? `AND telegram_id NOT IN (${allViewedIds.map(() => '?').join(',')})`
            : '';
            
        const allResult = await db.execute({
            sql: `SELECT * FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? ${fallbackWhere} ORDER BY RANDOM() LIMIT 1`,
            args: fallbackArgs
        });
        
        return allResult.rows[0] || null;
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
            const welcomeBackText = `🎉 **Welcome Back!**

${existingUser.nickname} ဟာ MM Cupid ကို ပြန်လည်ရောက်ရှိလာပါပြီ။ 💕

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
                Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['/help']]).resize()
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
        const welcomeMessage = `🎉 MM Cupid မှ ကြိုဆိုပါတယ်!

💕 **Tinder-style Dating Bot**

📋 **မှတ်ပုံတင်လုပ်ရန် အဆင့်များ:**
1️⃣ နာမည် (Nickname)
2️⃣ အသက် (Age) 
3️⃣ နေရပ် (Address)
4️⃣ ပုံ (Photo)
5️⃣ ကိုယ်ရေးတင်ပြ (Bio)
6️⃣ လိင် (Gender)
7️⃣ ရှာနေသောလိင် (Looking For)

❤️ Male များမှာ Female ကိုသာ မြင်ရပါမည်
❤️ Female များမှာ Male ကိုသာ မြင်ရပါမည်

---
စတင်ဖို့ သင့်နာမည်ကို ပြောပြပေးပါ (Nickname):`;

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
            return await ctx.reply("နေရာအသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        if (text === '📷 Photo') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_photo' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("ပုံအသစ်ကို ပို့ပေးပါ:");
        }
        if (text === '📄 Bio') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_bio' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("Bio အသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        if (text === '❌ Cancel') {
            await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
            return await ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['/help']]).resize());
        }
    }

    // Handle edit inputs
    if (['edit_nickname', 'edit_age', 'edit_address', 'edit_bio'].includes(user.step)) {
        let updateSql = "";
        let arg = text;
        if (user.step === 'edit_nickname') updateSql = "UPDATE users SET nickname = ?, step = 'done' WHERE telegram_id = ?";
        if (user.step === 'edit_age') {
            if (isNaN(text)) return await ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
            updateSql = "UPDATE users SET age = ?, step = 'done' WHERE telegram_id = ?";
            arg = parseInt(text);
        }
        if (user.step === 'edit_address') updateSql = "UPDATE users SET address = ?, step = 'done' WHERE telegram_id = ?";
        if (user.step === 'edit_bio') updateSql = "UPDATE users SET bio = ?, step = 'done' WHERE telegram_id = ?";
        
        await db.execute({ sql: updateSql, args: [arg, ctx.from.id] });
        return await ctx.reply("ပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['/help']]).resize());
    }

    if (user.step === 'edit_photo' && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'done' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return await ctx.reply("ပုံပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['/help']]).resize());
    }

    if (user.is_registered) return await handleChat(ctx, user);
    
    // Registration flow
    if (user.step === 'ask_name') {
        await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'ask_age' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return await ctx.reply("သင့်အသက်ကို ဂဏန်းဖြင့် ရိုက်ထည့်ပေးပါ:");
    }
    if (user.step === 'ask_age') {
        if (isNaN(text)) return await ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
        await db.execute({ sql: "UPDATE users SET age = ?, step = 'ask_address' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
        return await ctx.reply("သင်ဘယ်မြို့မှာ နေပါသလဲ (ဥပမာ- ရန်ကုန်):");
    }
    if (user.step === 'ask_address') {
        await db.execute({ sql: "UPDATE users SET address = ?, step = 'ask_photo' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return await ctx.reply("သင့်ရဲ့ ပုံလှလှလေးတစ်ပုံ ပို့ပေးပါ (Photo):");
    }
    if (ctx.message.photo && user.step === 'ask_photo') {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'ask_bio' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return await ctx.reply("သင့်အကြောင်း အနည်းငယ် ရေးပေးပါ (Bio):");
    }
    if (user.step === 'ask_bio') {
        await db.execute({ sql: "UPDATE users SET bio = ?, step = 'ask_gender' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return await ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
    }
    if (user.step === 'ask_gender') {
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') return await ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", Markup.keyboard([['Male', 'Female']]).resize());
        await db.execute({ sql: "UPDATE users SET gender = ?, step = 'ask_looking_for' WHERE telegram_id = ?", args: [gender, ctx.from.id] });
        return await ctx.reply("ဘယ်လိင်ရဲ့ လူကို ရှာနေသလဲ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
    }
    if (user.step === 'ask_looking_for') {
        const lookingFor = text.toLowerCase();
        if (lookingFor !== 'male' && lookingFor !== 'female') return await ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", Markup.keyboard([['Male', 'Female']]).resize());
        await db.execute({ sql: "UPDATE users SET looking_for = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", args: [lookingFor, ctx.from.id] });
        const welcomeText = `✅ *အားလုံးအဆင်ပြေသွားပါပြီ။*

အခုဆိုရင် သင်ဟာ MM Cupid ရဲ့ အဖွဲ့ဝင်တစ်ဦး ဖြစ်သွားပါပြီ။ 💕
အောက်က ခလုတ်ကိုနှိပ်ပြီး သင့်ရဲ့ ဖူးစာရှင်ကို စတင်ရှာဖွေနိုင်ပါပြီ။ 👇`;
        return await ctx.reply(welcomeText, {
            parse_mode: 'Markdown',
            ...Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['/help']]).resize()
        });
    }
});

// --- Discovery & Actions ---
bot.command('test', async (ctx) => {
    await ctx.reply('Bot is working! Buttons test:', 
        Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Test Like', 'test_like')],
            [Markup.button.callback('➡️ Test Next', 'test_next')]
        ])
    );
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
bot.command('edit', async (ctx) => {
    await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.reply("ဘာကိုပြင်ဆင်ချင်ပါသလဲ။", Markup.keyboard([['📝 Nickname', '🎂 Age'], ['🏠 Address', '📷 Photo'], ['📄 Bio', '❌ Cancel']]).resize());
});
bot.command('profile', async (ctx) => await showMyProfile(ctx));
bot.command('help', async (ctx) => {
    const helpText = `📋 **MM Cupid Bot Commands**

🔹 /start - Register your profile
🔹 /find - Find matches (🔍 ဖူးစာရှင်ရှာမည်)
🔹 /pulse - Live stats (💓 Pulse)
🔹 /profile - View your profile (👤 Profile)
🔹 /edit - Edit your profile (⚙️ Edit Profile)
🔹 /update - Change preferences
🔹 /help - Show this help message

💕 ဖူးစာရှင်ကို ရှာဖွေလိုက်ပါ!`;
    await ctx.reply(helpText, { parse_mode: 'Markdown' });
});
bot.command('update', async (ctx) => {
    await db.execute({ sql: "UPDATE users SET step = 'ask_gender' WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
});

async function showMyProfile(ctx) {
    try {
        const user = await getUser(ctx.from.id);
        if (!user) return await ctx.reply("Profile မတွေ့ပါ။ /start နှိပ်ပြီး မှတ်ပုံတင်ပါ။");
        
        const caption = `👤 **My Profile**\n\n📝 ${user.nickname} (${user.age})\n📍 ${user.address}\n🧬 ${user.gender?.toUpperCase()}\n💕 Looking for: ${user.looking_for?.toUpperCase()}\n\n📝 ${user.bio}`;
        
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
            const emptyText = `⌛ *ခေတ္တစောင့်ဆိုင်းပေးပါဦး...*

အခုလောလောဆယ် သင့်အနီးအနားမှာ Profile အသစ်တွေ ကုန်နေပါပြီ။
User အသစ်တွေ အမြဲတမ်းဝင်လာနေတာမို့ ခဏနေရင် ပြန်လာကြည့်ပေးပါဦးနော်။ ✨

🚀 *သူငယ်ချင်းတွေကို Invite လုပ်ပြီး Match ပိုရှာချင်ရင်: /help*`;
            return await ctx.reply(emptyText, { parse_mode: 'Markdown' });
        }
        
        console.log('Showing profile:', target.telegram_id, 'to user:', ctx.from.id);
        
        // Add to session cache and mark as viewed in background
        addToSessionViewed(ctx.from.id, target.telegram_id);
        markProfileAsViewed(ctx.from.id, target.telegram_id).catch(e => console.error('markViewed error:', e));
        
        const caption = `👤 ${target.nickname} (${target.age})\n📍 ${target.address}\n\n📝 ${target.bio}`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`)],
            [Markup.button.callback('➡️ Next', 'next_profile')]
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

bot.action(/^like_(.+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    const senderId = ctx.from.id;
    
    console.log('Like button clicked - sender:', senderId, 'target:', targetId);
    
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
        await ctx.answerCbQuery('❤️ Like!').catch((e) => console.log('Answer error:', e.message));
        
        // Record the like and wait for it to complete
        console.log('Recording like...');
        await db.execute({ 
            sql: "INSERT OR IGNORE INTO likes (from_user, to_user) VALUES (?, ?)", 
            args: [senderId, targetId] 
        });
        console.log('Like recorded successfully');
        
        // Check for mutual like
        const mutualLike = await db.execute({
            sql: "SELECT * FROM likes WHERE from_user = ? AND to_user = ?",
            args: [targetId, senderId]
        });
        console.log('Mutual like check:', mutualLike.rows.length > 0 ? 'Match!' : 'No match yet');

        if (mutualLike.rows.length > 0) {
            const me = await getUser(senderId);
            const partner = await getUser(targetId);
            if (me && partner) {
                const partnerLink = partner.username !== 'none' ? `@${partner.username}` : `tg://user?id=${targetId}`;
                const myLink = me.username !== 'none' ? `@${me.username}` : `tg://user?id=${senderId}`;
                
                const matchText = `🎉 *ဝမ်းသာပါတယ်။ Match ဖြစ်သွားပါပြီ။*

သင်နဲ့ *${partner.nickname}* နဲ့ တစ်ယောက်ကိုတစ်ယောက် သဘောကျနေကြပါတယ်။ 😍
အခုပဲ စကားစပြောကြည့်လိုက်တော့နော်!

🔗 *စကားပြောရန်:* ${partnerLink}

💡 *အကြံပြုချက်:* "ဟိုင်း" လို့ အရင်စပြောလိုက်ပါ။`;
                stats.addMatch();
                await ctx.reply(matchText, { parse_mode: 'Markdown' });
                try {
                    const partnerMatchText = `🎉 *ဝမ်းသာပါတယ်။ Match ဖြစ်သွားပါပြီ။*

သင်နဲ့ *${me.nickname}* နဲ့ တစ်ယောက်ကိုတစ်ယောက် သဘောကျနေကြပါတယ်။ 😍
အခုပဲ စကားစပြောကြည့်လိုက်တော့နော်!

🔗 *စကားပြောရန်:* ${myLink}

💡 *အကြံပြုချက်:* "ဟိုင်း" လို့ အရင်စပြောလိုက်ပါ။`;
                    await bot.telegram.sendMessage(targetId, partnerMatchText, { parse_mode: 'Markdown' });
                } catch (e) {}
            }
        } else {
            try {
                const me = await getUser(senderId);
                if (me) {
                    const likeNotifyText = `🔔 *သတင်းကောင်းရှိပါတယ်။*

*${me.nickname}* က သင့်ကို သဘောကျလို့ Like လုပ်ထားပါတယ်။ 😉
အဲဒီလူက ဘယ်သူဖြစ်မလဲဆိုတာ သိချင်ရင် အောက်က ခလုတ်ကိုနှိပ်လိုက်ပါ!`;
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

async function handleChat(ctx, user) {
    const text = ctx.message.text;
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
🔹 /update - Change preferences
🔹 /help - Show this help message

💕 ဖူးစာရှင်ကို ရှာဖွေလိုက်ပါ!`;
        return await ctx.reply(helpText, { parse_mode: 'Markdown' });
    }
}

// Dashboard API Routes - Simplified for Vercel
async function handleDashboardAPI(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Get path from URL
    let path = req.url || '';
    console.log('Dashboard API request:', path);
    
    // Remove query params and normalize
    path = path.split('?')[0].replace(/^\//, '');
    console.log('Normalized path:', path);
    
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
                sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1"
            });
            const totalUsers = totalResult.rows[0]?.count || 0;
            console.log('Total users:', totalUsers);
            
            // Get total matches (mutual likes count)
            const matchesResult = await db.execute({
                sql: `SELECT COUNT(*) as count FROM likes l
                      WHERE EXISTS (
                          SELECT 1 FROM likes l2 
                          WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user
                      )`
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
                sql: `SELECT telegram_id, nickname, age, gender, looking_for, address, 
                             is_registered, created_at 
                      FROM users 
                      ORDER BY created_at DESC 
                      LIMIT 50`
            });
            
            const countResult = await db.execute({
                sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1"
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
                sql: `SELECT 
                        l.from_user as user1_id,
                        l.to_user as user2_id,
                        l.created_at as matched_at
                      FROM likes l
                      WHERE EXISTS (
                          SELECT 1 FROM likes l2 
                          WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user
                      )
                      ORDER BY l.created_at DESC
                      LIMIT 100`
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
                    },
                    matched_at: match.matched_at
                });
            }
            
            console.log('Matches fetched:', matchesWithNames.length);
            
            return res.status(200).json({
                matches: matchesWithNames,
                total: matchesWithNames.length
            });
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
        req.url === '/stats' || req.url === '/users' || req.url === '/matches') {
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
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
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
                                        <td className="px-4 py-3 text-gray-500 text-sm">
                                            {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
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
                                <p className="text-xs text-gray-500 mt-1">
                                    <i className="far fa-clock mr-1"></i>
                                    {match.matched_at ? new Date(match.matched_at).toLocaleString() : 'Recently'}
                                </p>
                            </div>
                        </div>
                    ))}
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

            const API_URL = '';

            const fetchData = async () => {
                try {
                    setLoading(true);
                    setError(null);
                    
                    console.log('Fetching dashboard data...');
                    
                    const [statsRes, usersRes, matchesRes] = await Promise.all([
                        fetch(\`\${API_URL}/api/stats\`).then(async r => {
                            if (!r.ok) throw new Error(\`Stats API error: \${r.status}\`);
                            return r.json();
                        }),
                        fetch(\`\${API_URL}/api/users\`).then(async r => {
                            if (!r.ok) throw new Error(\`Users API error: \${r.status}\`);
                            return r.json();
                        }),
                        fetch(\`\${API_URL}/api/matches\`).then(async r => {
                            if (!r.ok) throw new Error(\`Matches API error: \${r.status}\`);
                            return r.json();
                        })
                    ]);
                    
                    console.log('Stats:', statsRes);
                    console.log('Users:', usersRes);
                    console.log('Matches:', matchesRes);
                    
                    if (statsRes.error) throw new Error(statsRes.error);
                    if (usersRes.error) throw new Error(usersRes.error);
                    if (matchesRes.error) throw new Error(matchesRes.error);
                    
                    setStats(statsRes);
                    setUsers(usersRes.users || []);
                    setMatches(matchesRes.matches || []);
                    setLastUpdate(new Date());
                } catch (error) {
                    console.error('Error fetching data:', error);
                    setError(error.message);
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => {
                fetchData();
                const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
                return () => clearInterval(interval);
            }, []);

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
                                { id: 'users', label: 'Users', icon: 'fa-users' },
                                { id: 'matches', label: 'Matches', icon: 'fa-heart' }
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
                    </div>
                </div>
            );
        };

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<Dashboard />);
    </script>
</body>
</html>`;
