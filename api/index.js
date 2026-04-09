import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@libsql/client';
import 'dotenv/config';

// Check environment variables
if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN is missing');
}
if (!process.env.TURSO_URL) {
    console.error('TURSO_URL is missing');
}
if (!process.env.TURSO_TOKEN) {
    console.error('TURSO_TOKEN is missing');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
let db;

// Performance optimization: Cache for user profiles
const profileCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

try {
    db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
} catch (error) {
    console.error('Database connection error:', error);
}

// --- Helper Functions ---
const getUser = async (id) => (await db.execute({ sql: "SELECT * FROM users WHERE telegram_id = ?", args: [id] })).rows[0];

// Cache helper functions
const getCachedProfiles = async (userId, lookingFor) => {
    const cacheKey = `${userId}_${lookingFor}`;
    const cached = profileCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.profiles;
    }
    
    return null;
};

const setCachedProfiles = async (userId, lookingFor, profiles) => {
    const cacheKey = `${userId}_${lookingFor}`;
    profileCache.set(cacheKey, {
        profiles,
        timestamp: Date.now()
    });
};

// Cache for seen profiles to reduce database queries
const seenProfilesCache = new Map();
const SEEN_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

const getSeenProfiles = async (userId) => {
    const cached = seenProfilesCache.get(userId);
    
    if (cached && Date.now() - cached.timestamp < SEEN_CACHE_TTL) {
        return cached.profiles;
    }
    
    const result = await db.execute({
        sql: "SELECT to_user FROM likes WHERE from_user = ?",
        args: [userId]
    });
    
    const seenSet = new Set(result.rows.map(row => row.to_user));
    seenProfilesCache.set(userId, {
        profiles: seenSet,
        timestamp: Date.now()
    });
    
    return seenSet;
};

// Periodic cache cleanup to prevent memory leaks
const cleanupCache = () => {
    const now = Date.now();
    
    // Clean profile cache
    for (const [key, value] of profileCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            profileCache.delete(key);
        }
    }
    
    // Clean seen profiles cache
    for (const [key, value] of seenProfilesCache.entries()) {
        if (now - value.timestamp > SEEN_CACHE_TTL) {
            seenProfilesCache.delete(key);
        }
    }
};

// Run cleanup every 5 minutes
setInterval(cleanupCache, 5 * 60 * 1000);

// --- 1. Registration Logic (Step-by-step) ---
bot.start(async (ctx) => {
    try {
        await db.execute({ 
            sql: "INSERT OR IGNORE INTO users (telegram_id, username, step) VALUES (?, ?, 'ask_name')", 
            args: [ctx.from.id, ctx.from.username || 'none'] 
        });
        
        const welcomeMessage = `🎉 *MM Cupid မှ ကြိုဆိုပါတယ်!*\n\n💕 *Tinder-style Dating Bot*\n\n📋 *မှတ်ပုံတင်ရန် အဆင့်များ:*\n\n1️⃣ နာမည် (Nickname)\n2️⃣ အသက် (Age)\n3️⃣ နေရပ် (Address)\n4️⃣ ပုံ (Photo)\n5️⃣ ကိုယ်ရေးတင်ပြ (Bio)\n6️⃣ လိင် (Gender)\n7️⃣ ရှာနေသောလိင် (Looking For)\n\n💖 *အချစ်ရှာဖွေရေး စည်းမျဉ်းများ*\n❤️ Male များ Female ကိုသာ မြင်ရပါမည်\n❤️ Female များ Male ကိုသာ မြင်ရပါမည်\n\n---\n🚀 *စတင်ဖို့ သင့်နာမည်ကို ပြောပြပေးပါ*\n✏️ *Nickname:*`;
        
        ctx.reply(welcomeMessage);
    } catch (error) {
        console.error('Start command error:', error);
        ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။ 😕");
    }
});

bot.on('message', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const text = ctx.message.text;
    
    // Handle edit menu
    if (user && user.step === 'edit_menu') {
        if (text === '📝 Nickname') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_nickname' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("✏️ *နာမည်အသစ်ကို ရိုက်ထည့်ပေးပါ:*");
        }
        
        if (text === '🎂 Age') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_age' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("🎂 *အသက်အသစ်ကို ရိုက်ထည့်ပေးပါ:*");
        }
        
        if (text === '🏠 Address') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_address' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("🏠 *နေရာအသစ်ကို ရိုက်ထည့်ပေးပါ:*");
        }
        
        if (text === '📷 Photo') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_photo' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("📷 *ပုံအသစ်ကို ပို့ပေးပါ:*");
        }
        
        if (text === '📄 Bio') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_bio' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("📝 *Bio အသစ်ကို ရိုက်ထည့်ပေးပါ:*");
        }
        
        if (text === '❌ Cancel') {
            await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("❌ *ပယ်ဖျက်လိုက်ပါတယ်။*", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
    }
    
    // Handle edit inputs
    if (user && (user.step === 'edit_nickname' || user.step === 'edit_age' || user.step === 'edit_address' || user.step === 'edit_bio')) {
        if (user.step === 'edit_nickname') {
            await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("✅ *Nickname ပြောင်းလဲပါပြီ။*", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_age') {
            if (isNaN(text)) return ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
            await db.execute({ sql: "UPDATE users SET age = ?, step = 'done' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
            return ctx.reply("✅ *Age ပြောင်းလဲပါပြီ။*", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_address') {
            await db.execute({ sql: "UPDATE users SET address = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("✅ *Address ပြောင်းလဲပါပြီ။*", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_bio') {
            await db.execute({ sql: "UPDATE users SET bio = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("✅ *Bio ပြောင်းလဲပါပြီ။*", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
    }
    
    // Handle edit photo
    if (user && user.step === 'edit_photo' && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'done' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return ctx.reply("✅ *Photo ပြောင်းလဲပါပြီ။*", Markup.keyboard([['/find', '/edit', '/help']]).resize());
    }
    
    // If user is registered or doesn't exist, handle chat commands
    if (!user || user.is_registered) return handleChat(ctx, user);
    
    // Registration flow for new users
    
    if (user.step === 'ask_name') {
        await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'ask_age' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return ctx.reply("🎂 *သင့်အသက်ကို ဂဏန်းဖြင့် ရိုက်ထည့်ပေးပါ:*");
    }
    
    if (user.step === 'ask_age') {
        if (isNaN(text)) return ctx.reply("⚠️ *ဂဏန်းအမှန်ရိုက်ပေးပါ:*");
        await db.execute({ sql: "UPDATE users SET age = ?, step = 'ask_address' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
        return ctx.reply("🏠 *သင်ဘယ်မြို့မှာ နေပါသလဲ (ဥပမာ- ရန်ကုန်):*");
    }

    if (user.step === 'ask_address') {
        await db.execute({ sql: "UPDATE users SET address = ?, step = 'ask_photo' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return ctx.reply("📷 *သင့်ရဲ့ ပုံလှလှလေးတစ်ပုံ ပို့ပေးပါ:*");
    }

    if (ctx.message.photo && user.step === 'ask_photo') {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'ask_bio' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return ctx.reply("📝 *သင့်အကြောင်း အနည်းငယ် ရေးပေးပါ (Bio):*");
    }

    if (user.step === 'ask_bio') {
        await db.execute({ 
            sql: "UPDATE users SET bio = ?, step = 'ask_gender' WHERE telegram_id = ?", 
            args: [text, ctx.from.id] 
        });
        return ctx.reply("🚻 *သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):*", 
            Markup.keyboard([
                ['🚹 Male', '🚺 Female']
            ]).resize()
        );
    }

    if (user.step === 'ask_gender') {
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') {
            return ctx.reply("⚠️ *Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:*", 
                Markup.keyboard([
                    ['🚹 Male', '🚺 Female']
                ]).resize()
            );
        }
        await db.execute({ 
            sql: "UPDATE users SET gender = ?, step = 'ask_looking_for' WHERE telegram_id = ?", 
            args: [gender, ctx.from.id] 
        });
        return ctx.reply("💕 *ဘယ်လိင်ရဲ့ လူကို ရှာနေသလဲ (Male သို့မဟုတ် Female):*", 
            Markup.keyboard([
                ['🚹 Male', '🚺 Female']
            ]).resize()
        );
    }

    if (user.step === 'ask_looking_for') {
        const lookingFor = text.toLowerCase();
        if (lookingFor !== 'male' && lookingFor !== 'female') {
            return ctx.reply("⚠️ *Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:*", 
                Markup.keyboard([
                    ['🚹 Male', '🚺 Female']
                ]).resize()
            );
        }
        await db.execute({ 
            sql: "UPDATE users SET looking_for = ?, step = 'ask_location' WHERE telegram_id = ?", 
            args: [lookingFor, ctx.from.id] 
        });
        return ctx.reply("Location-based matching  enabled!  Share your location?", 
            Markup.keyboard([
                ['Send Location', 'Skip Location'],
                ['Privacy Settings']
            ]).resize()
        );
    }

    // Handle location step
    if (user.step === 'ask_location') {
        if (text === 'Send Location') {
            return ctx.reply("Please share your location using the location button below.", 
                Markup.keyboard([
                    ['Share Location', 'Skip Location'],
                    ['Privacy Settings']
                ]).resize()
            );
        }
        
        if (text === 'Skip Location') {
            await db.execute({ 
                sql: "UPDATE users SET is_registered = 1, step = 'done', location_sharing = 0 WHERE telegram_id = ?", 
                args: [ctx.from.id] 
            });
            return ctx.reply("Registration completed! You can start finding matches now.", 
                Markup.keyboard([
                    ['Find Match', 'Edit Profile'],
                    ['Help']
                ]).resize()
            );
        }
        
        if (text === 'Privacy Settings') {
            return ctx.reply("Location privacy settings:", 
                Markup.keyboard([
                    ['Share Location', 'Skip Location'],
                    ['Privacy Settings']
                ]).resize()
            );
        }
    }
});

// --- 2. Discovery Logic (Next / Like) ---
bot.command('find', (ctx) => showNextProfile(ctx));

// Command to update gender preferences for existing users
bot.command('update', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (!user) return ctx.reply("အရင်းအမြစ် /start နဲ့ စပါ။");
    
    await db.execute({ sql: "UPDATE users SET step = 'ask_gender' WHERE telegram_id = ?", args: [ctx.from.id] });
    ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", 
        Markup.keyboard([
            ['Male', 'Female']
        ]).resize()
    );
});

// Handle location messages
bot.on('location', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (!user) return;
    
    if (user.step === 'ask_location') {
        const location = ctx.message.location;
        await db.execute({ 
            sql: "UPDATE users SET latitude = ?, longitude = ?, is_registered = 1, step = 'done', location_sharing = 1, last_location_update = CURRENT_TIMESTAMP WHERE telegram_id = ?", 
            args: [location.latitude, location.longitude, ctx.from.id] 
        });
        
        return ctx.reply("Registration completed! Location-based matching is now enabled.", 
            Markup.keyboard([
                ['Find Match', 'Edit Profile'],
                ['Help']
            ]).resize()
        );
    }
});

async function showNextProfile(ctx) {
    // Show loading indicator
    const loadingMessage = await ctx.reply("⏳ *Profile ရှာနေသည်...*");
    
    try {
        const user = await getUser(ctx.from.id);
        if (!user || !user.looking_for) {
            await ctx.deleteMessage(loadingMessage.message_id);
            return ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");
        }
        
        // Try to get cached profiles first
        let profiles = await getCachedProfiles(ctx.from.id, user.looking_for);
        let seenProfiles = await getSeenProfiles(ctx.from.id);
        
        if (!profiles || profiles.length === 0) {
            // Fetch fresh profiles with location-based query
            let locationQuery = "";
            let locationArgs = [];
            
            if (user.location_sharing && user.latitude && user.longitude) {
                // Use Haversine formula for distance calculation
                locationQuery = `AND (latitude IS NULL OR longitude IS NULL OR 
                    (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * 
                    cos(radians(longitude) - radians(?)) + sin(radians(?)) * 
                    sin(radians(latitude)))) <= COALESCE(?, 50))`;
                locationArgs = [user.latitude, user.longitude, user.latitude, user.location_radius || 50];
            }
            
            const rs = await db.execute({
                sql: `SELECT *, 
                    CASE 
                        WHEN latitude IS NULL OR longitude IS NULL OR ? IS NULL OR ? IS NULL THEN NULL
                        ELSE (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * 
                            cos(radians(longitude) - radians(?)) + sin(radians(?)) * 
                            sin(radians(latitude))))
                    END as distance
                    FROM users 
                    WHERE is_registered = 1 
                    AND telegram_id != ? 
                    AND gender = ? 
                    AND telegram_id NOT IN (
                        SELECT to_user FROM likes WHERE from_user = ?
                    )
                    ${locationQuery}
                    ORDER BY CASE 
                        WHEN distance IS NULL THEN 999999
                        ELSE distance 
                    END ASC
                    LIMIT 50`,
                args: [user.latitude, user.longitude, user.latitude, user.longitude, user.latitude, 
                    ctx.from.id, user.looking_for, ctx.from.id, ...locationArgs]
            });
            
            profiles = rs.rows;
            await setCachedProfiles(ctx.from.id, user.looking_for, profiles);
        }
        
        // Filter out already seen profiles
        const availableProfiles = profiles.filter(profile => 
            !seenProfiles.has(profile.telegram_id)
        );
        
        if (availableProfiles.length === 0) {
            // Try to refresh cache with more profiles
            profileCache.delete(`${ctx.from.id}_${user.looking_for}`);
            
            // Fetch fresh profiles again
            const rs = await db.execute({
                sql: `SELECT * FROM users 
                      WHERE is_registered = 1 
                      AND telegram_id != ? 
                      AND gender = ? 
                      AND telegram_id NOT IN (
                          SELECT to_user FROM likes WHERE from_user = ?
                      )
                      ORDER BY RANDOM() 
                      LIMIT 100`,
                args: [ctx.from.id, user.looking_for, ctx.from.id]
            });
            
            const freshProfiles = rs.rows;
            if (freshProfiles.length === 0) {
                await ctx.deleteMessage(loadingMessage.message_id);
                return ctx.reply("😔 *ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။*\n\n💡 *အကြံပြုချက်:*\n• နောက်မှ ပြန်လည်ကြိုးစားကြည့်ပါ\n• Profile ပိုမိုးများပေါ်လာနိုင်ပါတယ်");
            }
            
            await setCachedProfiles(ctx.from.id, user.looking_for, freshProfiles);
            const newAvailableProfiles = freshProfiles.filter(profile => 
                !seenProfiles.has(profile.telegram_id)
            );
            
            if (newAvailableProfiles.length === 0) {
                await ctx.deleteMessage(loadingMessage.message_id);
                return ctx.reply("😔 *ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။*");
            }
            
            const targetIndex = Math.floor(Math.random() * newAvailableProfiles.length);
            const target = newAvailableProfiles[targetIndex];
            
            const caption = `💕 *${target.nickname}* (${target.age})\n📍 ${target.address}\n\n📝 ${target.bio}\n\n💖 *သင့်အနှစ်သက်ရာလား?*`;
            
            await ctx.deleteMessage(loadingMessage.message_id);
            await ctx.replyWithPhoto(target.photo_id, {
                caption: caption,
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`), Markup.button.callback('➡️ Next', 'next_profile')],
                    [Markup.button.callback('👀 View Profile', `view_${target.telegram_id}`)]
                ])
            });
            return;
        }
        
        // Get next profile using simple indexing instead of random
        const targetIndex = Math.floor(Math.random() * availableProfiles.length);
        const target = availableProfiles[targetIndex];
        
        const caption = `💕 *${target.nickname}* (${target.age})\n📍 ${target.address}\n\n📝 ${target.bio}\n\n💖 *သင့်အနှစ်သက်ရာလား?*`;
        
        await ctx.deleteMessage(loadingMessage.message_id);
        await ctx.replyWithPhoto(target.photo_id, {
            caption: caption,
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`), Markup.button.callback('➡️ Next', 'next_profile')],
                [Markup.button.callback('👀 View Profile', `view_${target.telegram_id}`)]
            ])
        });
    } catch (error) {
        console.error('Error in showNextProfile:', error);
        await ctx.deleteMessage(loadingMessage.message_id);
        ctx.reply("⚠️ *စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။*");
    }
}

bot.action('next_profile', (ctx) => {
    showNextProfile(ctx);
});

// --- 3. Like & Match Notification ---
bot.action(/like_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    const senderId = ctx.from.id;

    await db.execute({ sql: "INSERT OR IGNORE INTO likes (from_user, to_user) VALUES (?, ?)", args: [senderId, targetId] });
    
    // Clear cache for this user since they've seen a new profile
    const user = await getUser(senderId);
    if (user) {
        profileCache.delete(`${senderId}_${user.looking_for}`);
        // Clear seen profiles cache to refresh
        seenProfilesCache.delete(senderId);
    }
    
    // Target User ကို အကြောင်းကြားမယ်
    await bot.telegram.sendMessage(targetId, "💕 *တစ်ယောက်ယောက်က သင့်ကို သဘောကျနေပါတယ်!*\n\n🎯 *သူ့ Profile ကို ပြန်ကြည့်မလား?*", 
        Markup.inlineKeyboard([
            [Markup.button.callback('👀 သူ့ကို ကြည့်မယ်', `view_back_${senderId}`)],
            [Markup.button.callback('❤️ လက်ခံသည်', `accept_${senderId}`)]
        ])
    );
    ctx.answerCbQuery("❤️ *Like ပို့လိုက်ပါပြီ!*");
});

// View back the person who liked you
bot.action(/view_back_(\d+)/, async (ctx) => {
    const senderId = ctx.match[1];
    const sender = await getUser(senderId);
    
    if (!sender) {
        return ctx.reply("😔 *သူ့ Profile မတွေ့ပါ။*");
    }
    
    await ctx.replyWithPhoto(sender.photo_id, {
        caption: `� *${sender.nickname}* (${sender.age})\n📍 ${sender.address}\n\n📝 ${sender.bio}\n\n💖 *သင့်အနှစ်သက်ရာလား?*`,
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Like', `like_${senderId}`), Markup.button.callback('➡️ Next', 'next_profile')],
            [Markup.button.callback('❌ ပိတ်မယ်', 'close_profile')]
        ])
    });
    ctx.answerCbQuery();
});

// Close profile view
bot.action('close_profile', (ctx) => {
    ctx.deleteMessage();
    ctx.answerCbQuery();
});

bot.action(/accept_(\d+)/, async (ctx) => {
    const partnerId = ctx.match[1];
    const myId = ctx.from.id;

    const partner = await getUser(partnerId);
    const me = await getUser(myId);

    // Match Message (Usernames Reveal)
    const partnerLink = partner.username !== 'none' ? `@${partner.username}` : `tg://user?id=${partnerId}`;
    const myLink = me.username !== 'none' ? `@${me.username}` : `tg://user?id=${myId}`;

    await ctx.reply(`🎉 *Match ဖြစ်သွားပါပြီ!* ❤️\n\n💬 *သူ့ဆီ စကားပြောလိုက်ပါ:* ${partnerLink}\n\n💡 *အကြံပြုချက်:*\n• သူ့ကို ဦးစွာစကားပြောပါ\n• သူ့အကြောင်းကို သိရှိပါ\n• ရိုးရှင်းစွာပြောဆိုပါ`);
    await bot.telegram.sendMessage(partnerId, `🎉 *သူက သင့်ကို လက်ခံလိုက်ပါပြီ!* ❤️\n\n💬 *စကားပြောရန်:* ${myLink}\n\n💡 *အကြံပြုချက်:*\n• သူ့ကို ဦးစွာစကားပြောပါ\n• သူ့အကြောင်းကို သိရှိပါ\n• ရိုးရှင်းစွာပြောဆိုပါ`);
    ctx.answerCbQuery();
});

// --- Helper function for chat ---
async function handleChat(ctx, user) {
    // Handle registered user commands
    if (ctx.message.text === '/find') {
        return showNextProfile(ctx);
    }
    
    if (ctx.message.text === '/update') {
        await db.execute({ sql: "UPDATE users SET step = 'ask_gender' WHERE telegram_id = ?", args: [ctx.from.id] });
        return ctx.reply("🚻 *သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):*", 
            Markup.keyboard([
                ['🚹 Male', '🚺 Female']
            ]).resize()
        );
    }
    
    // Edit profile command
    if (ctx.message.text === '/edit') {
        await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
        return ctx.reply("✏️ *ဘာကိုပြင်းဆင့်လဲချင်တာပါ။*", 
            Markup.keyboard([
                ['📝 Nickname', '🎂 Age'],
                ['🏠 Address', '📷 Photo'],
                ['📄 Bio', '❌ Cancel']
            ]).resize()
        );
    }
    
    // Help command
    if (ctx.message.text === '/help') {
        const helpMessage = `🎯 *MM Cupid User Guide*\n\n📋 *မှတ်ပုံတင်ခြင်း:*\n/start - စတင်ဖို့မှတ်ပုံတင်ပါ\n\n🔍 *ရှာဖွေခြင်း:*\n/find - Profile ရှာပါ (လိင်အပြင်းအစားအလိုက်)\n\n✏️ *ပြင်းဆင့်ခြင်း:*\n/edit - Profile ပြင်းဆင့်ပါ\n  • 📝 Nickname - နာမည်\n  • 🎂 Age - အသက်\n  • 🏠 Address - နေရာ\n  • 📷 Photo - ပုံ\n  • 📄 Bio - ကိုယ်ရေးတင်ပြ\n\n⚙️ *ဆက်တင်ပြင်ဆင်*\n/update - လိင်အပြင်းအစားပြောင်းပါ\n\n❤️ *အလုပ်လုပ်ပုံ:*\n1️⃣ /find ဖြင့် Profile ရှာပါ\n2️⃣ ❤️ Like သို့မဟုတ် ➡️ Next နှိပ်ပါ\n3️⃣ နှစ်ယောက်လုံး Like လိုက်ပါက Match ဖြစ်ပါမည်\n4️⃣ Match ဖြစ်လျှင် Username ပေါ်ပြပါမည်\n\n💡 *အသိပေးချက်*\n• Male များ Female ကိုသာ မြင်ရပါမည်\n• Female များ Male ကိုသာ မြင်ရပါမည်\n• ပုံကို Telegram မှာသာ သိမ်းဆည်းပါသည်\n• Username မရှိပါက Link ပေးပါမည်\n\n---\n🎉 *ကောင်းကောင်းတွေ့ပါစေ!* 💕`;
        
        return ctx.reply(helpMessage);
    }
    
    // Handle update flow steps
    if (user.step === 'ask_gender') {
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') {
            return ctx.reply("Please select Male or Female:", 
                Markup.keyboard([
                    ['Male', 'Female']
                ]).resize()
            );
        }
        await db.execute({ 
            sql: "UPDATE users SET gender = ?, step = 'ask_looking_for' WHERE telegram_id = ?", 
            args: [gender, ctx.from.id] 
        });
        return ctx.reply("Who are you looking for (Male or Female):", 
            Markup.keyboard([
                ['Male', 'Female']
            ]).resize()
        );
    }
    
    if (user.step === 'ask_looking_for') {
        const lookingFor = text.toLowerCase();
        if (lookingFor !== 'male' && lookingFor !== 'female') {
            return ctx.reply("Please select Male or Female:", 
                Markup.keyboard([
                    ['Male', 'Female']
                ]).resize()
            );
        }
        await db.execute({ 
            sql: "UPDATE users SET looking_for = ?, step = 'done' WHERE telegram_id = ?", 
            args: [lookingFor, ctx.from.id] 
        });
        return ctx.reply("Gender preferences updated successfully!", 
            Markup.keyboard([
                ['Find Match', 'Edit Profile'],
                ['Help']
            ]).resize()
        );
    }
    
    // Add other chat functionality here if needed
}

// Vercel Handler
export default async (req, res) => {
    try {
        if (req.method === 'POST') {
            console.log('Received webhook update:', JSON.stringify(req.body, null, 2));
            await bot.handleUpdate(req.body);
            return res.status(200).json({ ok: true });
        }
        res.status(200).send("MM Match Bot is Running...");
    } catch (error) {
        console.error('Vercel handler error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
