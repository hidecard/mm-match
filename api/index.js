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
    
    // Handle edit menu
    if (user && user.step === 'edit_menu') {
        const text = ctx.message.text;
        
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
            return ctx.reply("ပယ်ဖျက်လိုက်ပါတယ်။", Markup.keyboard([['/find', '/edit', '/location']]).resize());
        }
        
        // Handle edit inputs
        if (user.step === 'edit_nickname') {
            await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("Nickname ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/location']]).resize());
        }
        
        if (user.step === 'edit_age') {
            if (isNaN(text)) return ctx.reply("ဂဏန်းအမှန်ရိုက်ပေးပါ:");
            await db.execute({ sql: "UPDATE users SET age = ?, step = 'done' WHERE telegram_id = ?", args: [parseInt(text), ctx.from.id] });
            return ctx.reply("Age ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/location']]).resize());
        }
        
        if (user.step === 'edit_address') {
            await db.execute({ sql: "UPDATE users SET address = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("Address ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/location']]).resize());
        }
        
        if (ctx.message.photo && user.step === 'edit_photo') {
            const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'done' WHERE telegram_id = ?", args: [photoId, ctx.from.id] });
            return ctx.reply("Photo ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/location']]).resize());
        }
        
        if (user.step === 'edit_bio') {
            await db.execute({ sql: "UPDATE users SET bio = ?, step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
            return ctx.reply("Bio ပြောင်းလဲပါပြီ။", Markup.keyboard([['/find', '/edit', '/location']]).resize());
        }
    }
    
    if (!user || user.is_registered) return handleChat(ctx, user);

    const text = ctx.message.text;
    
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
        return ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):");
    }

    if (user.step === 'ask_gender') {
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') {
            return ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:");
        }
        await db.execute({ 
            sql: "UPDATE users SET gender = ?, step = 'ask_looking_for' WHERE telegram_id = ?", 
            args: [gender, ctx.from.id] 
        });
        return ctx.reply("ဘယ်လိင်ရဲ့ လူကို ရှာနေသလဲ (Male သို့မဟုတ် Female):");
    }

    if (user.step === 'ask_looking_for') {
        const lookingFor = text.toLowerCase();
        if (lookingFor !== 'male' && lookingFor !== 'female') {
            return ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:");
        }
        await db.execute({ 
            sql: "UPDATE users SET looking_for = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", 
            args: [lookingFor, ctx.from.id] 
        });
        return ctx.reply("မှတ်ပုံတင်ခြင်း အောင်မြင်ပါတယ်။", 
            Markup.keyboard([
                ['🔍 Find Profile', '📍 Share Location'],
                ['✏️ Edit Profile', '⚙️ Update Gender'],
                ['❓ Help', '🏠 Main Menu']
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
    ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):");
});

// Location sharing command
bot.command('location', (ctx) => {
    ctx.reply("သင့်တည်နေရာ ပေးပို့ပါ။", 
        Markup.keyboard([
            [Markup.button.locationRequest('📍 Location ပေးပို့ပါ')],
            ['/find']
        ]).resize()
    );
});

// Handle location message
bot.on('location', async (ctx) => {
    const location = ctx.message.location;
    await db.execute({ 
        sql: "UPDATE users SET latitude = ?, longitude = ? WHERE telegram_id = ?", 
        args: [location.latitude, location.longitude, ctx.from.id] 
    });
    ctx.reply("Location သိမ်းဆည်းပြီးပါပြီ။ အနီးနားက လူတွေကို ရှာဖို့ /find ကိုနှိပ်ပါ။", 
        Markup.keyboard([['/find']]).resize()
    );
});

async function showNextProfile(ctx) {
    const user = await getUser(ctx.from.id);
    if (!user || !user.looking_for) {
        return ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");
    }
    
    let rs;
    if (user.latitude && user.longitude) {
        // First try to find users with location
        rs = await db.execute({
            sql: "SELECT *, (ABS(latitude - ?) + ABS(longitude - ?)) as distance FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? AND latitude IS NOT NULL ORDER BY distance ASC, RANDOM() LIMIT 1",
            args: [user.latitude, user.longitude, ctx.from.id, user.looking_for]
        });
    }
    
    // If no nearby users or user has no location, get random user
    if (!rs.rows[0]) {
        rs = await db.execute({
            sql: "SELECT * FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? ORDER BY RANDOM() LIMIT 1",
            args: [ctx.from.id, user.looking_for]
        });
    }

    const target = rs.rows[0];
    if (!target) return ctx.reply("ရှာမတွေ့သေးပါ။ နောက်မှ ပြန်စမ်းကြည့်ပါ။");
    
    let caption = `👤 ${target.nickname} (${target.age})\n📍 ${target.address}`;
    
    // Add distance if both users have location
    if (user.latitude && user.longitude && target.latitude && target.longitude) {
        const distance = Math.abs(user.latitude - target.latitude) + Math.abs(user.longitude - target.longitude);
        caption += `\nအနီးနားကပ်: ~${(distance * 111).toFixed(1)} km`;
    }
    
    caption += `\n\n📝 ${target.bio}`;
    
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
    
    if (ctx.message.text === '/location') {
        return ctx.reply("သင့်တည်နေရာ ပေးပို့ပါ။", 
            Markup.keyboard([
                [Markup.button.locationRequest('📍 Location ပေးပို့ပါ')],
                ['/find']
            ]).resize()
        );
    }
    
    if (ctx.message.text === '/update') {
        await db.execute({ sql: "UPDATE users SET step = 'ask_gender' WHERE telegram_id = ?", args: [ctx.from.id] });
        return ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):");
    }
    
    // Help command
    if (ctx.message.text === '/help') {
        return ctx.reply("MM Match Commands:\n\n/start - စတင်ဖို့မှတ်ပုံတင်ပါ\n/menu - အဓိကမှုကိုကြည့်ပါ\n/find - Profile ရှာပါ\n/location - တည်နေရာပေးပို့ပါ\n/update - လိင်အပြင်းအစားပြင်းပြောင်းပါ\n/edit - Profile ပြင်းဆင့်ပါ\n/help - ကူညီမှုကိုကြည့်ပါ");
    }
    
    // Menu command - Show pinned commands
    if (ctx.message.text === '/menu') {
        return ctx.reply("MM Match Menu:", 
            Markup.keyboard([
                ['🔍 Find Profile', '📍 Share Location'],
                ['✏️ Edit Profile', '⚙️ Update Gender'],
                ['❓ Help', '🏠 Main Menu']
            ]).resize()
        );
    }
    
    // Handle menu button clicks
    if (ctx.message.text === '🔍 Find Profile') {
        return showNextProfile(ctx);
    }
    
    if (ctx.message.text === '📍 Share Location') {
        return ctx.reply("သင့်တည်နေရာ ပေးပို့ပါ။", 
            Markup.keyboard([
                [Markup.button.locationRequest('📍 Location ပေးပို့ပါ')],
                ['🏠 Main Menu']
            ]).resize()
        );
    }
    
    if (ctx.message.text === '✏️ Edit Profile') {
        await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
        return ctx.reply("ဘာကိုပြင်းဆင့်လဲချင်တာပါ။", 
            Markup.keyboard([
                ['📝 Nickname', '🎂 Age'],
                ['🏠 Address', '📷 Photo'],
                ['📄 Bio', '🏠 Main Menu']
            ]).resize()
        );
    }
    
    if (ctx.message.text === '⚙️ Update Gender') {
        await db.execute({ sql: "UPDATE users SET step = 'ask_gender' WHERE telegram_id = ?", args: [ctx.from.id] });
        return ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):");
    }
    
    if (ctx.message.text === '❓ Help') {
        return ctx.reply("MM Match Commands:\n\n/start - စတင်ဖို့မှတ်ပုံတင်ပါ\n/find - Profile ရှာပါ\n/location - တည်နေရာပေးပို့ပါ\n/update - လိင်အပြင်းအစားပြင်းပြောင်းပါ\n/edit - Profile ပြင်းဆင့်ပါ\n/help - ကူညီမှုကိုကြည့်ပါ");
    }
    
    if (ctx.message.text === '🏠 Main Menu') {
        return ctx.reply("MM Match Menu:", 
            Markup.keyboard([
                ['🔍 Find Profile', '📍 Share Location'],
                ['✏️ Edit Profile', '⚙️ Update Gender'],
                ['❓ Help', '🏠 Main Menu']
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
