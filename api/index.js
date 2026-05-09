import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@libsql/client';
import 'dotenv/config';

// Check environment variables
if (!process.env.BOT_TOKEN) console.error('BOT_TOKEN is missing');
if (!process.env.TURSO_URL) console.error('TURSO_URL is missing');
if (!process.env.TURSO_TOKEN) console.error('TURSO_TOKEN is missing');

const bot = new Telegraf(process.env.BOT_TOKEN);
let db;

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

const getRandomProfile = async (userId, lookingFor) => {
    try {
        // Try with profile_views join first
        try {
            const unviewedResult = await db.execute({
                sql: `SELECT u.* FROM users u 
                      LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                      WHERE u.is_registered = 1 AND u.telegram_id != ? AND u.gender = ? AND pv.viewed_profile_id IS NULL
                      ORDER BY RANDOM() LIMIT 1`,
                args: [userId, userId, lookingFor]
            });
            
            if (unviewedResult.rows.length > 0) {
                return unviewedResult.rows[0];
            }
        } catch (dbError) {
            console.error('Profile views query failed:', dbError.message);
        }
        
        // Fallback: get any random profile
        const allResult = await db.execute({
            sql: "SELECT * FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? ORDER BY RANDOM() LIMIT 1",
            args: [userId, lookingFor]
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

❤️ Male များ Female ကိုသာ မြင်ရပါမည်
❤️ Female များ Male ကိုသာ မြင်ရပါမည်

---
စတင်ဖို့ သင့်နာမည်ကို ပြောပြပေးပါ (Nickname):`;

        if (db) {
            await db.execute({ 
                sql: "INSERT OR IGNORE INTO users (telegram_id, username, step) VALUES (?, ?, 'ask_name')", 
                args: [ctx.from.id, ctx.from.username || 'none'] 
            });
        }
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
            return await ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['🔍 Find Match', '⚙️ Edit Profile'], ['/help']]).resize());
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
        return await ctx.reply("ပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['🔍 Find Match', '⚙️ Edit Profile'], ['/help']]).resize());
    }

    if (user.step === 'edit_photo' && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'done' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return await ctx.reply("ပုံပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['🔍 Find Match', '⚙️ Edit Profile'], ['/help']]).resize());
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
        return await ctx.reply("မှတ်ပုံတင်ခြင်း အောင်မြင်ပါတယ်။ /find ကိုနှိပ်ပြီး Match ရှာနိုင်ပါပြီ။", Markup.keyboard([['🔍 Find Match', '⚙️ Edit Profile'], ['/help']]).resize());
    }
});

// --- Discovery & Actions ---
bot.command('find', async (ctx) => await showNextProfile(ctx));
bot.command('edit', async (ctx) => {
    await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.reply("ဘာကိုပြင်ဆင်ချင်ပါသလဲ။", Markup.keyboard([['📝 Nickname', '🎂 Age'], ['🏠 Address', '📷 Photo'], ['📄 Bio', '❌ Cancel']]).resize());
});
bot.command('help', async (ctx) => {
    await ctx.reply("MM Match Guide:\n/start - Register\n/find - Find Match\n/edit - Edit Profile\n/update - Change Preference");
});
bot.command('update', async (ctx) => {
    await db.execute({ sql: "UPDATE users SET step = 'ask_gender' WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
});

async function showNextProfile(ctx) {
    try {
        console.log('showNextProfile called for user:', ctx.from?.id);
        
        const user = await getUser(ctx.from.id);
        if (!user || !user.looking_for) {
            console.log('User not registered or no looking_for:', user);
            return await ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");
        }
        
        const target = await getRandomProfile(ctx.from.id, user.looking_for);
        if (!target) {
            console.log('No target found for user:', ctx.from.id);
            return await ctx.reply("ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
        }
        
        console.log('Showing profile:', target.telegram_id, 'to user:', ctx.from.id);
        
        // Mark as viewed in background
        markProfileAsViewed(ctx.from.id, target.telegram_id).catch(e => console.error('markViewed error:', e));
        
        const caption = `👤 ${target.nickname} (${target.age})\n📍 ${target.address}\n\n📝 ${target.bio}`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`)],
            [Markup.button.callback('➡️ Next', 'next_profile')]
        ]);
        
        // If it's a callback query, delete the old message first
        if (ctx.callbackQuery) {
            console.log('Deleting previous message');
            await ctx.deleteMessage().catch((e) => console.log('Delete error:', e.message));
        }
        
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
        // Answer callback query first to stop loading animation
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
                
                await ctx.reply(`Match ဖြစ်သွားပါပြီ! ❤️\nသူ့ဆီ စကားပြောလိုက်ပါ: ${partnerLink}`);
                try {
                    await bot.telegram.sendMessage(targetId, `သူက သင့်ကို Like ပြန်လုပ်လိုက်ပါတယ်! Match ဖြစ်သွားပါပြီ! ❤️\nစကားပြောရန်: ${myLink}`);
                } catch (e) {}
            }
        } else {
            try {
                const me = await getUser(senderId);
                if (me) {
                    await bot.telegram.sendMessage(targetId, `${me.nickname} က သင့်ကို သဘောကျနေပါတယ်! သူ့ Profile ကို ပြန်ကြည့်မလား?`, 
                        Markup.inlineKeyboard([
                            [Markup.button.callback('သူ့ကို ကြည့်မယ်', `view_back_${senderId}`)]
                        ]));
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
    if (text === '/find' || text === '🔍 Find Match') return await showNextProfile(ctx);
    if (text === '/edit' || text === '⚙️ Edit Profile') {
        await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
        return await ctx.reply("ဘာကိုပြင်ဆင်ချင်ပါသလဲ။", Markup.keyboard([['📝 Nickname', '🎂 Age'], ['🏠 Address', '📷 Photo'], ['📄 Bio', '❌ Cancel']]).resize());
    }
    if (text === '/help') return await ctx.reply("MM Match Guide:\n/start - Register\n/find - Find Match\n/edit - Edit Profile");
}

// Vercel Handler - Ensures all async operations complete
export default async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('Bot is running...');
    
    try {
        // Create a promise that resolves when all bot processing is done
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.warn('Bot processing timeout - forcing response');
                resolve();
            }, 8000); // 8 second timeout for Vercel
            
            bot.handleUpdate(req.body)
                .then(() => {
                    clearTimeout(timeout);
                    // Give a small delay for any background DB operations
                    setTimeout(resolve, 100);
                })
                .catch((err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
        });
        
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(200).json({ ok: true });
    }
};
