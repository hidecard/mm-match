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
        // Get unviewed profiles first using RANDOM()
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
        
        // If no unviewed profiles, get any random profile
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
        await db.execute({
            sql: "INSERT OR IGNORE INTO profile_views (user_id, viewed_profile_id) VALUES (?, ?)",
            args: [userId, profileId]
        });
    } catch (error) {
        console.error('Error marking profile as viewed:', error);
    }
};

const getUnviewedProfile = async (userId, lookingFor) => {
    try {
        const rs = await db.execute({
            sql: `SELECT u.* FROM users u 
                  LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                  WHERE u.is_registered = 1 AND u.telegram_id != ? AND u.gender = ? AND pv.viewed_profile_id IS NULL
                  ORDER BY RANDOM() LIMIT 1`,
            args: [userId, userId, lookingFor]
        });
        if (rs.rows.length > 0) return rs.rows[0];
        return await getRandomProfile(userId, lookingFor);
    } catch (error) {
        return await getRandomProfile(userId, lookingFor);
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
            return await ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
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
        return await ctx.reply("ပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
    }

    if (user.step === 'edit_photo' && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'done' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return await ctx.reply("ပုံပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
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
        return await ctx.reply("မှတ်ပုံတင်ခြင်း အောင်မြင်ပါတယ်။ /find ကိုနှိပ်ပြီး Match ရှာနိုင်ပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
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
        const user = await getUser(ctx.from.id);
        if (!user || !user.looking_for) return await ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");
        const target = await getUnviewedProfile(ctx.from.id, user.looking_for);
        if (!target) return await ctx.reply("ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
        await markProfileAsViewed(ctx.from.id, target.telegram_id);
        const caption = `👤 ${target.nickname} (${target.age})\n📍 ${target.address}\n\n📝 ${target.bio}`;
        const markup = Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`)],
            [Markup.button.callback('➡️ Next', 'next_profile')]
        ]);
        
        // Try to edit the message if it exists, otherwise send a new one
        try {
            await ctx.editMessageMedia(
                { type: 'photo', media: target.photo_id },
                { caption: caption, ...markup }
            );
        } catch (editError) {
            // If edit fails, send a new message
            await ctx.replyWithPhoto(target.photo_id, {
                caption: caption,
                ...markup
            });
        }
    } catch (error) {
        console.error('Error in showNextProfile:', error);
        await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
}

// Universal action handler for debugging
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    console.log('Callback Query received:', data);
    
    try {
        if (data === 'next_profile') {
            await ctx.answerCbQuery();
            return await showNextProfile(ctx);
        }
        
        if (data.startsWith('like_')) {
            const targetId = data.split('_')[1];
            const senderId = ctx.from.id;
            await db.execute({ sql: "INSERT OR IGNORE INTO likes (from_user, to_user) VALUES (?, ?)", args: [senderId, targetId] });
            try {
                await bot.telegram.sendMessage(targetId, "တစ်ယောက်ယောက်က သင့်ကို သဘောကျနေပါတယ်! သူ့ Profile ကို ပြန်ကြည့်မလား?", 
                    Markup.inlineKeyboard([
                        [Markup.button.callback('သူ့ကို ကြည့်မယ်', `view_back_${senderId}`)],
                        [Markup.button.callback('လက်ခံသည် ✅', `accept_${senderId}`)]
                    ]));
            } catch (e) {}
            await ctx.answerCbQuery("Like ပို့လိုက်ပါပြီ!");
            return await showNextProfile(ctx);
        }
        
        if (data.startsWith('view_back_')) {
            const senderId = data.split('_')[2];
            const sender = await getUser(senderId);
            if (!sender) return await ctx.reply("သူ့ Profile မတွေ့ပါ။");
            await ctx.replyWithPhoto(sender.photo_id, {
                caption: `👤 ${sender.nickname} (${sender.age})\n📍 ${sender.address}\n\n📝 ${sender.bio}`,
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❤️ Like', `like_${senderId}`)],
                    [Markup.button.callback('➡️ Next', 'next_profile')],
                    [Markup.button.callback('ပိတ်မယ်', 'close_profile')]
                ])
            });
            return await ctx.answerCbQuery();
        }
        
        if (data === 'close_profile') {
            await ctx.deleteMessage();
            return await ctx.answerCbQuery();
        }
        
        if (data.startsWith('accept_')) {
            const partnerId = data.split('_')[1];
            const partner = await getUser(partnerId);
            const me = await getUser(ctx.from.id);
            const partnerLink = partner.username !== 'none' ? `@${partner.username}` : `tg://user?id=${partnerId}`;
            const myLink = me.username !== 'none' ? `@${me.username}` : `tg://user?id=${ctx.from.id}`;
            await ctx.reply(`Match ဖြစ်သွားပါပြီ! ❤️\nသူ့ဆီ စကားပြောလိုက်ပါ: ${partnerLink}`);
            try {
                await bot.telegram.sendMessage(partnerId, `သူက သင့်ကို လက်ခံလိုက်ပါပြီ! ❤️\nစကားပြောရန်: ${myLink}`);
            } catch (e) {}
            return await ctx.answerCbQuery();
        }
    } catch (error) {
        console.error('Callback Error:', error);
        await ctx.answerCbQuery("Error occurred");
    }
});

async function handleChat(ctx, user) {
    if (ctx.message.text === '/find') return await showNextProfile(ctx);
    if (ctx.message.text === '/edit') {
        await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
        return await ctx.reply("ဘာကိုပြင်ဆင်ချင်ပါသလဲ။", Markup.keyboard([['📝 Nickname', '🎂 Age'], ['🏠 Address', '📷 Photo'], ['📄 Bio', '❌ Cancel']]).resize());
    }
    if (ctx.message.text === '/help') return await ctx.reply("MM Match Guide:\n/start - Register\n/find - Find Match\n/edit - Edit Profile");
}

// Vercel Handler
export default async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('Bot is running...');
    try {
        await bot.handleUpdate(req.body);
        if (!res.writableEnded) res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        if (!res.writableEnded) res.status(200).json({ ok: true });
    }
};
