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

try {
    db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
} catch (error) {
    console.error('Database connection error:', error);
}

// --- Helper Functions ---
const getUser = async (id) => (await db.execute({ sql: "SELECT * FROM users WHERE telegram_id = ?", args: [id] })).rows[0];

// --- 1. Registration Logic (Step-by-step) ---
bot.start(async (ctx) => {
    try {
        await db.execute({ 
            sql: "INSERT OR IGNORE INTO users (telegram_id, username, step) VALUES (?, ?, 'ask_name')", 
            args: [ctx.from.id, ctx.from.username || 'none'] 
        });
        ctx.reply("MM Match မှ ကြိုဆိုပါတယ်။ စတင်ဖို့ သင့်နာမည်ကို ပြောပြပေးပါ (Nickname):");
    } catch (error) {
        console.error('Start command error:', error);
        ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
});

bot.on('message', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (!user || user.is_registered) return handleChat(ctx, user);

    const text = ctx.message.text;
    
    if (user.step === 'ask_name') {
        await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'ask_age' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return ctx.reply("သင့်အသက်ကို ဂဏန်းဖြင့် ရိုက်ထည့်ပေးပါ:");
    }
    
    if (user.step === 'ask_age') {
        if (isNaN(text)) return ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
        await db.execute({ sql: "UPDATE users SET age = ?, step = 'ask_address' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
        return ctx.reply("သင့်တည်နေရာကို ပေးပါ။ တစ်ခါတည်း ရိုက်ပေးနိုင်သလား သို့မဟုတ် Location ခလုတ်ကို နှိပ်ပြီး GPS location ပေးနိုင်ပါသည်။", 
            Markup.keyboard([['📍 Share Location'], ['စာဖြင့်ပေးပါမည်']]).resize());
    }

    // Handle location sharing
    if (ctx.message.location && user.step === 'ask_address') {
        const { latitude, longitude } = ctx.message.location;
        await db.execute({ 
            sql: "UPDATE users SET address = ?, step = 'ask_photo' WHERE telegram_id = ?", 
            args: [`Lat: ${latitude}, Lon: ${longitude}`, ctx.from.id] 
        });
        return ctx.reply("သင့်ရဲ့ ပုံလှလှလေးတစ်ပုံ ပို့ပေးပါ (Photo):", Markup.removeKeyboard());
    }

    // Handle text location input
    if (user.step === 'ask_address' && text && !ctx.message.location) {
        if (text === 'စာဖြင့်ပေးပါမည်') {
            return ctx.reply("သင်ဘယ်မြို့မှာ နေပါသလဲ (ဥပမာ- ရန်ကုန်):", Markup.removeKeyboard());
        }
        
        // If user typed location directly (not a button)
        if (text !== '📍 Share Location' && text !== 'စာဖြင့်ပေးပါမည်') {
            await db.execute({ sql: "UPDATE users SET address = ?, step = 'ask_photo' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("သင့်ရဲ့ ပုံလှလှလေးတစ်ပုံ ပို့ပေးပါ (Photo):", Markup.removeKeyboard());
        }
    }

    if (ctx.message.photo && user.step === 'ask_photo') {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'ask_bio' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return ctx.reply("သင့်အကြောင်း အနည်းငယ် ရေးပေးပါ (Bio):");
    }

    if (user.step === 'ask_bio') {
        await db.execute({ 
            sql: "UPDATE users SET bio = ?, step = 'ask_gender' WHERE telegram_id = ?", 
            args: [text, ctx.from.id] 
        });
        return ctx.reply("သင့်လိင်ကို ရွေးပေးပါ (Male/Female):");
    }

    if (user.step === 'ask_gender') {
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') {
            return ctx.reply("Male သို့မဟုတ် Female ဟု ရိုက်ပေးပါ:");
        }
        
        const lookingFor = gender === 'male' ? 'female' : 'male';
        await db.execute({ 
            sql: "UPDATE users SET gender = ?, looking_for = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", 
            args: [gender, lookingFor, ctx.from.id] 
        });
        return ctx.reply("မှတ်ပုံတင်ခြင်း အောင်မြင်ပါတယ်။ /find ကိုနှိပ်ပြီး Match ရှာနိုင်ပါပြီ။", Markup.keyboard([['/find', '/profile']]).resize());
    }
});

// --- 2. Discovery Logic (Next / Like) ---
bot.command('find', (ctx) => showNextProfile(ctx));
bot.command('profile', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (!user || !user.is_registered) {
        return ctx.reply("သင့် profile မတွေ့ပါ။ စတင်မှတ်ပုံတင်ဖို့ /start ကိုနှိပ်ပါ။");
    }
    
    await ctx.replyWithPhoto(user.photo_id, {
        caption: `💕 သင့် Profile 💕\n\n👤 နာမည်: ${user.nickname}\n🎂 အသက်: ${user.age}\n🏠 တည်နေရာ: ${user.address}\n❤️‍🔥 Bio: ${user.bio}\n⚧️ လိင်: ${user.gender}\n🎯 ရှာဖွေရာ: ${user.looking_for}`,
        ...Markup.inlineKeyboard([
            [Markup.button.callback('📝 Edit Profile', 'edit_profile')],
            [Markup.button.callback('❌ Close', 'close_profile')]
        ])
    });
});

async function showNextProfile(ctx) {
    const user = await getUser(ctx.from.id);
    const rs = await db.execute({
        sql: "SELECT * FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? ORDER BY RANDOM() LIMIT 1",
        args: [ctx.from.id, user.looking_for]
    });

    const target = rs.rows[0];
    if (!target) return ctx.reply("ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    
    await ctx.replyWithPhoto(target.photo_id, {
        caption: `� ${target.nickname} (${target.age}) 💕\n🏠 ${target.address}\n❤️‍� ${target.bio} ❤️‍🔥`,
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❤️‍🔥 Like ❤️‍🔥', `like_${target.telegram_id}`)],
            [Markup.button.callback('➡️ Next', 'next_profile')]
        ])
    });
}

bot.action('next_profile', async (ctx) => {
    try {
        await showNextProfile(ctx);
    } catch (error) {
        console.error('Next profile error:', error);
        ctx.answerCbQuery('နောက်တစ်ယောက်ကို ရှာနေပါသည်...');
    }
});

// --- 3. Like & Match Notification ---
bot.action(/like_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    const senderId = ctx.from.id;

    await db.execute({ sql: "INSERT OR IGNORE INTO likes (from_user, to_user) VALUES (?, ?)", args: [senderId, targetId] });
    
    // Get sender's profile to show to target
    const sender = await getUser(senderId);
    
    // Target User ကို အကြောင်းကြားမယ်
    await bot.telegram.sendMessage(targetId, "တစ်ယောက်ယောက်က သင့်ကို သဘောကျနေပါတယ်! သူ့ Profile ကို ပြန်ကြည့်မလား?", 
        Markup.inlineKeyboard([
            [Markup.button.callback('သူ့ကို ကြည့်မယ်', `view_back_${senderId}`)],
            [Markup.button.callback('လက်ခံသည် ✅', `accept_${senderId}`)]
        ])
    );
    ctx.answerCbQuery("Like ပို့လိုက်ပါပြီ!");
});

// View profile action
bot.action(/view_back_(\d+)/, async (ctx) => {
    const senderId = ctx.match[1];
    const sender = await getUser(senderId);
    
    if (!sender) {
        ctx.answerCbQuery("Profile မတွေ့ပါ");
        return;
    }
    
    await ctx.replyWithPhoto(sender.photo_id, {
        caption: `${sender.nickname} (${sender.age}) 💕\n🏠 ${sender.address}\n❤️‍� ${sender.bio} ❤️‍🔥`,
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💝 Accept 💝', `accept_${senderId}`)],
            [Markup.button.callback('❌ Close', 'close_profile')]
        ])
    });
    ctx.answerCbQuery();
});

bot.action('close_profile', (ctx) => {
    ctx.deleteMessage();
    ctx.answerCbQuery();
});

bot.action('edit_profile', async (ctx) => {
    await db.execute({ sql: "UPDATE users SET step = 'ask_name' WHERE telegram_id = ?", args: [ctx.from.id] });
    ctx.reply("သင့်နာမည်ကို ပြောင်းလဲလိုပါသလား?");
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

    await ctx.reply(`Match ဖြစ်သွားပါပြီ! ❤️\nသူ့ဆီ စကားပြောလိုက်ပါ: ${partnerLink}`);
    await bot.telegram.sendMessage(partnerId, `သူက သင့်ကို လက်ခံလိုက်ပါပြီ! ❤️\nစကားပြောရန်: ${myLink}`);
    ctx.answerCbQuery();
});

// --- Helper function for chat ---
async function handleChat(ctx, user) {
    // Handle registered user commands
    if (ctx.message.text === '/find') {
        return showNextProfile(ctx);
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
