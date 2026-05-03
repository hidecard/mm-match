import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@libsql/client';
import 'dotenv/config';

// Check environment variables
console.log('Bot starting...');
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

// --- 1. Registration Logic ---
bot.start(async (ctx) => {
    console.log('Start command received from:', ctx.from.id);
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
        console.log('Welcome message sent to:', ctx.from.id);
    } catch (error) {
        console.error('Start command error:', error);
        try {
            await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
        } catch (replyError) {
            console.error('Error sending error message:', replyError);
        }
    }
});

// Simple ping command for testing
bot.command('ping', async (ctx) => {
    await ctx.reply('pong');
});

bot.on('message', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const text = ctx.message.text;
    
    if (!user || user.is_registered) return await handleChat(ctx, user);
    
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

async function showNextProfile(ctx) {
    try {
        const user = await getUser(ctx.from.id);
        if (!user || !user.looking_for) return await ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");
        
        // Simplified random profile for debugging
        const rs = await db.execute({
            sql: "SELECT * FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? ORDER BY RANDOM() LIMIT 1",
            args: [ctx.from.id, user.looking_for]
        });
        
        const target = rs.rows[0];
        if (!target) return await ctx.reply("ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
        
        const caption = `👤 ${target.nickname} (${target.age})\n📍 ${target.address}\n\n📝 ${target.bio}`;
        await ctx.replyWithPhoto(target.photo_id, {
            caption: caption,
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`)],
                [Markup.button.callback('➡️ Next', 'next_profile')]
            ])
        });
    } catch (error) {
        console.error('Error in showNextProfile:', error);
        await ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
}

bot.action('next_profile', async (ctx) => {
    await ctx.answerCbQuery();
    await showNextProfile(ctx);
});

bot.action(/like_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    await db.execute({ sql: "INSERT OR IGNORE INTO likes (from_user, to_user) VALUES (?, ?)", args: [ctx.from.id, targetId] });
    try {
        await bot.telegram.sendMessage(targetId, "တစ်ယောက်ယောက်က သင့်ကို သဘောကျနေပါတယ်! /find ကိုနှိပ်ပြီး ပြန်ကြည့်နိုင်ပါတယ်။");
    } catch (e) {}
    await ctx.answerCbQuery("Like ပို့လိုက်ပါပြီ!");
});

async function handleChat(ctx, user) {
    if (ctx.message.text === '/find') return await showNextProfile(ctx);
    if (ctx.message.text === '/help') return await ctx.reply("MM Match Guide:\n/start - Register\n/find - Find Match\n/edit - Edit Profile");
}

// Vercel Handler
export default async (req, res) => {
    console.log('Webhook request received:', req.method);
    if (req.method !== 'POST') {
        return res.status(200).send('Bot is running...');
    }
    try {
        await bot.handleUpdate(req.body);
        console.log('Update handled successfully');
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(200).json({ ok: true }); // Always 200 for Telegram
    }
};
