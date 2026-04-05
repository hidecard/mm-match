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
        
        ctx.reply(welcomeMessage);
    } catch (error) {
        console.error('Start command error:', error);
        ctx.reply("စနစ်အမှားဖြစ်ပါတယ်။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
});

bot.on('message', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const text = ctx.message.text;
    
    // Handle edit menu
    if (user && user.step === 'edit_menu') {
        if (text === '📝 Nickname') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_nickname' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("နာမည်အသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        
        if (text === '🎂 Age') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_age' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("အသက်အသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        
        if (text === '🏠 Address') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_address' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("နေရာအသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        
        if (text === '📷 Photo') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_photo' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("ပုံအသစ်ကို ပို့ပေးပါ:");
        }
        
        if (text === '📄 Bio') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_bio' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("Bio အသစ်ကို ရိုက်ထည့်ပေးပါ:");
        }
        
        if (text === '❌ Cancel') {
            await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
    }
    
    // Handle edit inputs
    if (user && (user.step === 'edit_nickname' || user.step === 'edit_age' || user.step === 'edit_address' || user.step === 'edit_bio')) {
        if (user.step === 'edit_nickname') {
            await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("Nickname ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_age') {
            if (isNaN(text)) return ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
            await db.execute({ sql: "UPDATE users SET age = ?, step = 'done' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
            return ctx.reply("Age ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_address') {
            await db.execute({ sql: "UPDATE users SET address = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("Address ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_bio') {
            await db.execute({ sql: "UPDATE users SET bio = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("Bio ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
    }
    
    // Handle edit photo
    if (user && user.step === 'edit_photo' && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'done' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        return ctx.reply("Photo ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
    }
    
    // If user is registered or doesn't exist, handle chat commands
    if (!user || user.is_registered) return handleChat(ctx, user);
    
    // Registration flow for new users
    
    if (user.step === 'ask_name') {
        await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'ask_age' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return ctx.reply("သင့်အသက်ကို ဂဏန်းဖြင့် ရိုက်ထည့်ပေးပါ:");
    }
    
    if (user.step === 'ask_age') {
        if (isNaN(text)) return ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
        await db.execute({ sql: "UPDATE users SET age = ?, step = 'ask_address' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
        return ctx.reply("သင်ဘယ်မြို့မှာ နေပါသလဲ (ဥပမာ- ရန်ကုန်):");
    }

    if (user.step === 'ask_address') {
        await db.execute({ sql: "UPDATE users SET address = ?, step = 'ask_photo' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return ctx.reply("သင့်ရဲ့ ပုံလှလှလေးတစ်ပုံ ပို့ပေးပါ (Photo):");
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
        return ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", 
            Markup.keyboard([
                ['Male', 'Female']
            ]).resize()
        );
    }

    if (user.step === 'ask_gender') {
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') {
            return ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", 
                Markup.keyboard([
                    ['Male', 'Female']
                ]).resize()
            );
        }
        await db.execute({ 
            sql: "UPDATE users SET gender = ?, step = 'ask_looking_for' WHERE telegram_id = ?", 
            args: [gender, ctx.from.id] 
        });
        return ctx.reply("ဘယ်လိင်ရဲ့ လူကို ရှာနေသလဲ (Male သို့မဟုတ် Female):", 
            Markup.keyboard([
                ['Male', 'Female']
            ]).resize()
        );
    }

    if (user.step === 'ask_looking_for') {
        const lookingFor = text.toLowerCase();
        if (lookingFor !== 'male' && lookingFor !== 'female') {
            return ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", 
                Markup.keyboard([
                    ['Male', 'Female']
                ]).resize()
            );
        }
        await db.execute({ 
            sql: "UPDATE users SET looking_for = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", 
            args: [lookingFor, ctx.from.id] 
        });
        return ctx.reply("မှတ်ပုံတင်ခြင်း အောင်မြင်ပါတယ်။ /find ကိုနှိပ်ပြီး Match ရှာနိုင်ပါပြီ။", 
            Markup.keyboard([
                ['/find', '/edit', '/help']
            ]).resize()
        );
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

async function showNextProfile(ctx) {
    const user = await getUser(ctx.from.id);
    if (!user || !user.looking_for) {
        return ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");
    }
    
    const rs = await db.execute({
        sql: "SELECT * FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? ORDER BY RANDOM() LIMIT 1",
        args: [ctx.from.id, user.looking_for]
    });

    const target = rs.rows[0];
    if (!target) return ctx.reply("ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    
    const caption = `👤 ${target.nickname} (${target.age})\n📍 ${target.address}\n\n📝 ${target.bio}`;
    
    await ctx.replyWithPhoto(target.photo_id, {
        caption: caption,
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`)],
            [Markup.button.callback('➡️ Next', 'next_profile')]
        ])
    });
}

bot.action('next_profile', (ctx) => {
    showNextProfile(ctx);
});

// --- 3. Like & Match Notification ---
bot.action(/like_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    const senderId = ctx.from.id;

    await db.execute({ sql: "INSERT OR IGNORE INTO likes (from_user, to_user) VALUES (?, ?)", args: [senderId, targetId] });
    
    // Target User ကို အကြောင်းကြားမယ်
    await bot.telegram.sendMessage(targetId, "တစ်ယောက်ယောက်က သင့်ကို သဘောကျနေပါတယ်! သူ့ Profile ကို ပြန်ကြည့်မလား?", 
        Markup.inlineKeyboard([
            [Markup.button.callback('သူ့ကို ကြည့်မယ်', `view_back_${senderId}`)],
            [Markup.button.callback('လက်ခံသည် ✅', `accept_${senderId}`)]
        ])
    );
    ctx.answerCbQuery("Like ပို့လိုက်ပါပြီ!");
});

// View back the person who liked you
bot.action(/view_back_(\d+)/, async (ctx) => {
    const senderId = ctx.match[1];
    const sender = await getUser(senderId);
    
    if (!sender) {
        return ctx.reply("သူ့ Profile မတွေ့ပါ။");
    }
    
    await ctx.replyWithPhoto(sender.photo_id, {
        caption: `👤 ${sender.nickname} (${sender.age})\n📍 ${sender.address}\n\n📝 ${sender.bio}`,
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❤️ Like', `like_${senderId}`)],
            [Markup.button.callback('➡️ Next', 'next_profile')],
            [Markup.button.callback('ပိတ်မယ်', 'close_profile')]
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
    
    if (ctx.message.text === '/update') {
        await db.execute({ sql: "UPDATE users SET step = 'ask_gender' WHERE telegram_id = ?", args: [ctx.from.id] });
        return ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", 
            Markup.keyboard([
                ['Male', 'Female']
            ]).resize()
        );
    }
    
    // Help command
    if (ctx.message.text === '/help') {
        const helpMessage = `🎯 **MM Match User Guide**

📋 **မှတ်ပုံတင်ခြင်း:**
/start - စတင်ဖို့မှတ်ပုံတင်ပါ

🔍 **ရှာဖွေခြင်း:**
/find - Profile ရှာပါ (လိင်အပြင်းအစားအလိုက်)

✏️ **ပြင်းဆင့်ခြင်း:**
/edit - Profile ပြင်းဆင့်ပါ
  • 📝 Nickname - နာမည်
  • 🎂 Age - အသက်
  • 🏠 Address - နေရာ
  • 📷 Photo - ပုံ
  • 📄 Bio - ကိုယ်ရေးတင်ပြ

⚙️ **ဆက်တင်ပြင်းဆင့်:**
/update - လိင်အပြင်းအစားပြောင်းပါ

❤️ **အလုပ်လုပ်ပုံ:**
1️⃣ /find ဖြင့် Profile ရှာပါ
2️⃣ ❤️ Like သို့မဟုတ် ➡️ Next နှိပ်ပါ
3️⃣ နှစ်ယောက်လုံး Like လိုက်ပါက Match ဖြစ်ပါမည်
4️⃣ Match ဖြစ်လျှင် Username ပေါ်ပြပါမည်

💡 **အသိပ်သည်းချက်:**
• Male များ Female ကိုသာ မြင်ရပါမည်
• Female များ Male ကိုသာ မြင်ရပါမည်
• ပုံကို Telegram မှာသာ သိမ်းဆည်းပါသည်
• Username မရှိပါက Link ပေးပါမည်

---
🎉 ကောင်းကောင်းတွေ့ပါစေ! 💕`;
        
        return ctx.reply(helpMessage);
    }
    
    // Edit profile command
    if (ctx.message.text === '/edit') {
        await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
        return ctx.reply("ဘာကိုပြင်းဆင့်လဲချင်တာပါ။", 
            Markup.keyboard([
                ['📝 Nickname', '🎂 Age'],
                ['🏠 Address', '📷 Photo'],
                ['📄 Bio', '❌ Cancel']
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
