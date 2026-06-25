import { Telegraf, Markup } from 'telegraf';
import 'dotenv/config';
import { getDb, getUser, migrateLocationSchema } from './utils/db.js';
import { isReservedUserInput, reservedInputReply } from './utils/helpers.js';
import { handleRegistration, getWelcomeMessage } from './handlers/registration.js';
import { showNextProfile, handlePulse } from './handlers/matching.js';
import { handleChatMode } from './handlers/chat.js';
import { validateNickname, validateAge, validateBio } from './validation.js';

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = getDb();
const sessionViewedCache = new Map();

const stats = {
    todayMatches: 0,
    lastMatchDate: new Date().toDateString(),
    async getRealStats() {
        if (!db) return { online: 0, matches: 0, total: 0 };
        try {
            const totalResult = await db.execute({ sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1", args: [] });
            const totalUsers = totalResult.rows[0]?.count || 0;
            const matchesResult = await db.execute({ sql: "SELECT COUNT(*) as count FROM likes l WHERE EXISTS (SELECT 1 FROM likes l2 WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user)", args: [] });
            const totalMatches = Math.floor((matchesResult.rows[0]?.count || 0) / 2);
            return { online: totalUsers, matches: totalMatches, total: totalUsers };
        } catch (error) {
            return { online: 0, matches: 0, total: 0 };
        }
    }
};

migrateLocationSchema().catch(console.error);

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const user = await getUser(userId);
    if (user && user.is_registered) {
        return await ctx.reply("Welcome back!", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    }
    const welcome = await getWelcomeMessage(stats);
    await db.execute({ sql: "INSERT OR IGNORE INTO users (telegram_id, username, step) VALUES (?, ?, 'ask_name')", args: [userId, ctx.from.username || 'none'] });
    await ctx.reply(welcome, { parse_mode: 'Markdown' });
});

bot.on('message', async (ctx) => {
    if (!ctx.message) return;
    const user = await getUser(ctx.from.id);
    if (!user) return;
    const text = ctx.message.text;

    if (user.step === 'chat_mode') return await handleChatMode(ctx, user, db, bot);
    
    if (user.step === 'ask_spark') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        await db.execute({ sql: "UPDATE users SET spark_status = ?, spark_at = datetime('now'), step = 'done' WHERE telegram_id = ?", args: [text, ctx.from.id] });
        return await ctx.reply("✨ Daily Spark တင်ပြီးပါပြီ။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    }

    if (user.step.startsWith('edit_')) {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        let updateSql = "";
        let arg = text;
        if (user.step === 'edit_nickname') {
            const v = validateNickname(text);
            if (!v.valid) return await ctx.reply(`❌ ${v.error}`);
            updateSql = "UPDATE users SET nickname = ?, step = 'done' WHERE telegram_id = ?";
            arg = v.value;
        } else if (user.step === 'edit_age') {
            const v = validateAge(text);
            if (!v.valid) return await ctx.reply(`❌ ${v.error}`);
            updateSql = "UPDATE users SET age = ?, step = 'done' WHERE telegram_id = ?";
            arg = v.value;
        } else if (user.step === 'edit_bio') {
            const v = validateBio(text);
            if (!v.valid) return await ctx.reply(`❌ ${v.error}`);
            updateSql = "UPDATE users SET bio = ?, step = 'done' WHERE telegram_id = ?";
            arg = v.value;
        }
        if (updateSql) {
            await db.execute({ sql: updateSql, args: [arg, ctx.from.id] });
            return await ctx.reply("✅ ပြင်ဆင်ပြီးပါပြီ။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
        }
    }

    if (!user.is_registered) return await handleRegistration(ctx, user, db, stats);

    if (text === '🔍 ဖူးစာရှင်ရှာမည်') return await showNextProfile(ctx, db, getUser, sessionViewedCache);
    if (text === '💓 Pulse') return await handlePulse(ctx, db);
    if (text === '👤 Profile') return await ctx.reply(`👤 Profile: ${user.nickname} (${user.age})\nBio: ${user.bio}`);
    if (text === '⚙️ Edit Profile') {
        await db.execute({ sql: "UPDATE users SET step = 'edit_menu' WHERE telegram_id = ?", args: [ctx.from.id] });
        return await ctx.reply("ဘာကိုပြင်ဆင်ချင်ပါသလဲ။", Markup.keyboard([['📝 Nickname', '🎂 Age'], ['🏠 Address', '📷 Photo'], ['📄 Bio', '❌ Cancel']]).resize());
    }
    if (text === '✨ Daily Spark') {
        await db.execute({ sql: "UPDATE users SET step = 'ask_spark' WHERE telegram_id = ?", args: [ctx.from.id] });
        return await ctx.reply("✨ Daily Spark တင်ပါ\n\nဒီနေ့ ဘာလုပ်ချင်လဲဆိုတဲ့ အခြေအနေကို Emoji လေးနဲ့ ရေးပေးပါ။", { parse_mode: 'Markdown' });
    }
    if (text === '❌ Delete Account') {
        return await ctx.reply("⚠️ Account ဖျက်မည်မှာ သေချာပါသလား?", Markup.inlineKeyboard([[Markup.button.callback('❌ ဖျက်မည်', 'delete_confirm'), Markup.button.callback('ပယ်ဖျက်မည်', 'delete_cancel')]]));
    }
    if (text === '/help') return await ctx.reply("📋 MM Cupid Bot Commands...");
});

bot.action('next_profile', async (ctx) => {
    await ctx.answerCbQuery();
    return await showNextProfile(ctx, db, getUser, sessionViewedCache);
});

bot.action(/^like_(.+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    await db.execute({ sql: "INSERT OR IGNORE INTO likes (from_user, to_user) VALUES (?, ?)", args: [ctx.from.id, targetId] });
    await ctx.answerCbQuery('❤️ Liked!');
    return await showNextProfile(ctx, db, getUser, sessionViewedCache);
});

bot.action('delete_confirm', async (ctx) => {
    await db.execute({ sql: "DELETE FROM users WHERE telegram_id = ?", args: [ctx.from.id] });
    await ctx.answerCbQuery('Account Deleted');
    return await ctx.reply("Account ဖျက်ပြီးပါပြီ။");
});

bot.action('delete_cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    return await ctx.reply("ပယ်ဖျက်လိုက်ပါပြီ။");
});

bot.action(/^reveal_accept_(.+)$/, async (ctx) => {
    const requesterId = ctx.match[1];
    const user = await getUser(ctx.from.id);
    const requester = await getUser(requesterId);
    await bot.telegram.sendMessage(requesterId, `✅ *${user.nickname}* မှ သဘောတူလိုက်ပါပြီ။\nUsername: @${ctx.from.username || 'none'}`, { parse_mode: 'Markdown' });
    await ctx.reply(`✅ သင်လည်း သဘောတူလိုက်ပါပြီ။\nUsername: @${requester.username || 'none'}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('Username Shared');
});

async function handleDashboardAPI(req, res) {
    const url = req.url || '';
    res.setHeader('Content-Type', 'application/json');
    if (url.includes('/api/stats')) {
        const s = await stats.getRealStats();
        return res.status(200).json({ totalUsers: s.total, todayMatches: s.matches });
    }
    res.status(404).json({ error: 'Not found' });
}

export default async (req, res) => {
    if (req.url.startsWith('/api/')) return await handleDashboardAPI(req, res);
    if (req.method === 'POST') {
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } else {
        res.status(200).send('Bot is running');
    }
};
