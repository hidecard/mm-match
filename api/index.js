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
// Cache for user data to reduce database calls
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getUser = async (id) => {
    // Check cache first
    const cached = userCache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    // Query database
    const result = await db.execute({ 
        sql: "SELECT telegram_id, username, nickname, age, address, bio, photo_id, gender, looking_for, interests, mood_status, step, is_registered FROM users WHERE telegram_id = ?", 
        args: [id] 
    });
    
    const user = result.rows[0];
    
    // Cache the result
    if (user) {
        userCache.set(id, {
            data: user,
            timestamp: Date.now()
        });
    }
    
    return user;
};

// Clear cache when user data is updated
const clearUserCache = (id) => {
    userCache.delete(id);
};

// --- 1. Registration Logic (Step-by-step) ---
bot.start(async (ctx) => {
    try {
        await db.execute({ 
            sql: "INSERT OR IGNORE INTO users (telegram_id, username, step) VALUES (?, ?, 'ask_name')", 
            args: [ctx.from.id, ctx.from.username || 'none'] 
        });
        
        const welcomeMessage = `💕 **Welcome to MM Cupid!** 💕

🎯 *Tinder-style Dating Bot*
အရင်းအမြစ်လွယ်ကူတဲ့ ရည်းစားရှာဖွေရေး ဘော့

🌟 **မှတ်ပုံတင်လုပ်ရန် အဆင့်များ:**
1️⃣ 📝 နာမည် (Nickname)
2️⃣ 🎂 အသက် (Age) 
3️⃣ 🏠 နေရပ် (Address)
4️⃣ 📸 ပုံ (Photo)
5️⃣ 📄 ကိုယ်ရေးတင်ပြ (Bio)
6️⃣ 🏷️ Interest Tags (စိတ်ဝင်စားပစ္စည်းများ)
7️⃣ 😊 Mood Status (လက်ရှိချိန်)
8️⃣ 👫 လိင် (Gender)
9️⃣ 💕 ရှာနေသောလိင် (Looking For)



💝 **Matching System:**
• Male 👨 များ Female 👩 ကိုသာ မြင်ရပါမည်
• Female 👩 များ Male 👨 ကိုသာ မြင်ရပါမည်
• Interest တူတဲ့ လူတွေကို ပိုမိုတွေ့ရပါမည်

---
🚀 စတင်ဖို့ သင့်နာမည်ကို ပြောပြပေးပါ ✨`;
        
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
        
        if (text === '🏷️ Interests') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_interests' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("Interest အသစ်များကို ရိုက်ထည့်ပေးပါ (ဥပမာ - #travel #music #food):");
        }
        
        if (text === '😊 Mood') {
            await db.execute({ sql: "UPDATE users SET step = 'edit_mood' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("ချိန်အသစ်ကို ရွေးပါ:", 
                Markup.keyboard([
                    ['😊 Happy', '🎉 Excited', '😌 Chill'],
                    ['🤔 Thinking', '💭 Dreaming', '🎯 Focused'],
                    ['💪 Energetic', '🌟 Optimistic', '🎨 Creative'],
                    ['❌ Cancel']
                ]).resize()
            );
        }
        
        if (text === '❌ Cancel') {
            await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [ctx.from.id] });
            return ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
    }
    
    // Handle edit inputs
    if (user && (user.step === 'edit_nickname' || user.step === 'edit_age' || user.step === 'edit_address' || user.step === 'edit_bio' || user.step === 'edit_interests')) {
        if (user.step === 'edit_nickname') {
            await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            clearUserCache(ctx.from.id);
            return ctx.reply("Nickname ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_age') {
            if (isNaN(text)) return ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
            await db.execute({ sql: "UPDATE users SET age = ?, step = 'done' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
            clearUserCache(ctx.from.id);
            return ctx.reply("Age ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_address') {
            await db.execute({ sql: "UPDATE users SET address = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            clearUserCache(ctx.from.id);
            return ctx.reply("Address ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_bio') {
            await db.execute({ sql: "UPDATE users SET bio = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            clearUserCache(ctx.from.id);
            return ctx.reply("Bio ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
        
        if (user.step === 'edit_interests') {
            await db.execute({ sql: "UPDATE users SET interests = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            clearUserCache(ctx.from.id);
            return ctx.reply("Interests ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
        }
    }
    
    // Handle edit mood
    if (user && user.step === 'edit_mood') {
        const moodOptions = ['😊 Happy', '🎉 Excited', '😌 Chill', '🤔 Thinking', '💭 Dreaming', '🎯 Focused', '💪 Energetic', '🌟 Optimistic', '🎨 Creative'];
        const selectedMood = moodOptions.includes(text) ? text : '😊 Happy';
        
        await db.execute({ sql: "UPDATE users SET mood_status = ?, step = 'done' WHERE telegram_id = ?", args: [selectedMood, ctx.from.id] });
        clearUserCache(ctx.from.id);
        return ctx.reply("Mood Status ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
    }
    
    // Handle edit photo
    if (user && user.step === 'edit_photo' && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'done' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        clearUserCache(ctx.from.id);
        return ctx.reply("Photo ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/help']]).resize());
    }
    
    // If user is registered or doesn't exist, handle chat commands
    if (!user || user.is_registered) return handleChat(ctx, user);
    
    // Registration flow for new users
    
    if (user.step === 'ask_name') {
        await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'ask_age' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        clearUserCache(ctx.from.id);
        return ctx.reply("✨ သင့်အသက်ကို ဂဏန်းဖြင့် ရိုက်ထည့်ပေးပါ:");
    }
    
    if (user.step === 'ask_age') {
        if (isNaN(text)) return ctx.reply("⚠️ ဂဏန်းအမှန်ရိုက်ပေးပါ:");
        await db.execute({ sql: "UPDATE users SET age = ?, step = 'ask_address' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
        clearUserCache(ctx.from.id);
        return ctx.reply("🏠 သင်ဘယ်မြို့မှာ နေပါသလဲ (ဥပမာ- ရန်ကုန်):");
    }

    if (user.step === 'ask_address') {
        await db.execute({ sql: "UPDATE users SET address = ?, step = 'ask_photo' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        clearUserCache(ctx.from.id);
        return ctx.reply("📸 သင့်ရဲ့ ပုံလှလှလေးတစ်ပုံ ပို့ပေးပါ:");
    }

    if (ctx.message.photo && user.step === 'ask_photo') {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'ask_bio' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
        clearUserCache(ctx.from.id);
        return ctx.reply("📝 သင့်အကြောင်း အနည်းငယ် ရေးပေးပါ:");
    }

    if (user.step === 'ask_bio') {
        await db.execute({ 
            sql: "UPDATE users SET bio = ?, step = 'ask_interests' WHERE telegram_id = ?", 
            args: [text, ctx.from.id] 
        });
        clearUserCache(ctx.from.id);
        return ctx.reply("🏷️ သင့်စိတ်ဝင်စားပစ္စည်းများကို ရေးပေးပါ (ဥပမာ - #travel #music #food #movie #sports #reading #coffee #photography):");
    }

    if (user.step === 'ask_interests') {
        await db.execute({ 
            sql: "UPDATE users SET interests = ?, step = 'ask_mood' WHERE telegram_id = ?", 
            args: [text, ctx.from.id] 
        });
        clearUserCache(ctx.from.id);
        return ctx.reply("😊 သင့်လက်ရှိချိန်ကို ရွေးပါ:", 
            Markup.keyboard([
                ['😊 Happy', '🎉 Excited', '😌 Chill'],
                ['🤔 Thinking', '💭 Dreaming', '🎯 Focused'],
                ['💪 Energetic', '🌟 Optimistic', '🎨 Creative'],
                ['❌ Skip']
            ]).resize()
        );
    }

    if (user.step === 'ask_mood') {
        const moodOptions = ['😊 Happy', '🎉 Excited', '😌 Chill', '🤔 Thinking', '💭 Dreaming', '🎯 Focused', '💪 Energetic', '🌟 Optimistic', '🎨 Creative'];
        const selectedMood = moodOptions.includes(text) ? text : '😊 Happy';
        
        await db.execute({ 
            sql: "UPDATE users SET mood_status = ?, step = 'ask_gender' WHERE telegram_id = ?", 
            args: [selectedMood, ctx.from.id] 
        });
        clearUserCache(ctx.from.id);
        return ctx.reply("👫 သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", 
            Markup.keyboard([
                ['Male', 'Female']
            ]).resize()
        );
    }

    if (user.step === 'ask_gender') {
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') {
            return ctx.reply("⚠️ Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", 
                Markup.keyboard([
                    ['Male', 'Female']
                ]).resize()
            );
        }
        await db.execute({ 
            sql: "UPDATE users SET gender = ?, step = 'ask_looking_for' WHERE telegram_id = ?", 
            args: [gender, ctx.from.id] 
        });
        clearUserCache(ctx.from.id);
        return ctx.reply("💕 ဘယ်လိင်ရဲ့ လူကို ရှာနေသလဲ (Male သို့မဟုတ် Female):", 
            Markup.keyboard([
                ['Male', 'Female']
            ]).resize()
        );
    }

    if (user.step === 'ask_looking_for') {
        const lookingFor = text.toLowerCase();
        if (lookingFor !== 'male' && lookingFor !== 'female') {
            return ctx.reply("⚠️ Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", 
                Markup.keyboard([
                    ['Male', 'Female']
                ]).resize()
            );
        }
        await db.execute({ 
            sql: "UPDATE users SET looking_for = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", 
            args: [lookingFor, ctx.from.id] 
        });
        clearUserCache(ctx.from.id);
        return ctx.reply("🎉 မှတ်ပုံတင်ခြင်း အောင်မြင်ပါတယ်။\n\n🔍 /find ကိုနှိပ်ပြီး Match ရှာနိုင်ပါပြီ။", 
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
    
    // Optimized query with better indexing and LIMIT
    const rs = await db.execute({
        sql: "SELECT telegram_id, nickname, age, address, bio, photo_id, interests, mood_status FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? ORDER BY RANDOM() LIMIT 5",
        args: [ctx.from.id, user.looking_for]
    });

    if (!rs.rows || rs.rows.length === 0) {
        return ctx.reply("⚠️ ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    }
    
    // Pick first result for now (can be enhanced for multiple profiles)
    const target = rs.rows[0];
    
    // Build caption efficiently
    let caption = `💕 **${target.nickname}** (${target.age})\n📍 ${target.address}`;
    
    // Add mood status if available
    if (target.mood_status) {
        caption += `\n${target.mood_status} ချိန်`;
    }
    
    // Add interests if available (limit length for performance)
    if (target.interests && target.interests.length < 200) {
        caption += `\n🏷️ ${target.interests}`;
    }
    
    // Add bio with length limit
    const bio = target.bio && target.bio.length > 200 ? target.bio.substring(0, 200) + "..." : target.bio;
    caption += `\n\n💭 ${bio || ''}`;
    
    // Send photo with optimized options
    await ctx.replyWithPhoto(target.photo_id, {
        caption: caption,
        parse_mode: 'Markdown',
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
    await bot.telegram.sendMessage(targetId, " တစ်ယောက်ယောက်က သင့်ကို သဘောကျနေပါတယ်! \nသူ့ Profile ကို ပြန်ကြည့်မလား?", 
        Markup.inlineKeyboard([
            [Markup.button.callback('', `view_back_${senderId}`)],
            [Markup.button.callback('', `accept_${senderId}`)]
        ])
    );
    ctx.answerCbQuery("");
});

// View back the person who liked you
bot.action(/view_back_(\d+)/, async (ctx) => {
    const senderId = ctx.match[1];
    const sender = await getUser(senderId);
    
    if (!sender) {
        return ctx.reply("သူ့ Profile မတွေ့ပါ။");
    }
    
    let caption = `👤 ${sender.nickname} (${sender.age})\n📍 ${sender.address}`;
    
    // Add mood status if available
    if (sender.mood_status) {
        caption += `\n${sender.mood_status} ချိန်`;
    }
    
    // Add interests if available
    if (sender.interests) {
        caption += `\n🏷️ ${sender.interests}`;
    }
    
    caption += `\n\n📝 ${sender.bio}`;
    
    await ctx.replyWithPhoto(sender.photo_id, {
        caption: caption,
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

    await ctx.reply(`🎉 **Match ဖြစ်သွားပါပြီ!** 💕\n\n💬 သူ့ဆီ စကားပြောလိုက်ပါ: ${partnerLink}\n\n🌟 ကံကောင်းပါစေ!`);
    await bot.telegram.sendMessage(partnerId, `🎉 **Match ဖြစ်သွားပါပြီ!** 💕\n\n💬 စကားပြောရန်: ${myLink}\n\n🌟 ကံကောင်းပါစေ!`);
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
        const helpMessage = `🎯 **MM Cupid User Guide**

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
                ['📄 Bio', '🏷️ Interests'],
                ['😊 Mood', '❌ Cancel']
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
