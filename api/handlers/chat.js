import { Markup } from 'telegraf';

export const handleChatMode = async (ctx, user, db, bot) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;

    if (text === '🔓 လျှို့ဝှက်ချက်ဖွင့်ပြမည်') {
        const sessionResult = await db.execute({ sql: "SELECT matched_user_id FROM chat_sessions WHERE user_id = ?", args: [userId] });
        if (sessionResult.rows.length > 0) {
            const matchedUserId = sessionResult.rows[0].matched_user_id;
            await bot.telegram.sendMessage(matchedUserId, `🔓 *${user.nickname}* မှ သူ့ရဲ့ Telegram Username ကို ပြသရန် ခွင့်ပြုချက်တောင်းခံနေပါသည်။ သင်ကော ပြသရန် သဘောတူပါသလား?`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('👍 သဘောတူသည်', `reveal_accept_${userId}`), Markup.button.callback('👎 ငြင်းပယ်မည်', `reveal_reject_${userId}`)]])
            });
            return await ctx.reply('🔓 ခွင့်ပြုချက်တောင်းခံပြီးပါပြီ။ သူ့ဘက်က အဖြေစောင်းနေပါသည်။');
        }
        return;
    }

    if (text === '❌ Chat မှထွက်မည်') {
        await db.execute({ sql: "DELETE FROM chat_sessions WHERE user_id = ?", args: [userId] });
        await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [userId] });
        return await ctx.reply('❌ Chat မှ ထွက်ပြီးပါပြီ။', Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    }

    if (text === '🚨 Report / Block' || text === '🚫 Block & Unmatch') {
        const sessionResult = await db.execute({ sql: "SELECT matched_user_id FROM chat_sessions WHERE user_id = ?", args: [userId] });
        if (sessionResult.rows.length > 0) {
            const matchedUserId = sessionResult.rows[0].matched_user_id;
            await db.execute({ sql: "DELETE FROM chat_sessions WHERE user_id = ? OR matched_user_id = ?", args: [userId, userId] });
            await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [userId] });
            
            if (text === '🚨 Report / Block') {
                return await ctx.reply('🚨 Report အကြောင်းကို ရွေးပါ:', Markup.inlineKeyboard([
                    [Markup.button.callback('Fake Profile', `report_fake_${matchedUserId}`)],
                    [Markup.button.callback('Spam', `report_spam_${matchedUserId}`)],
                    [Markup.button.callback('Inappropriate', `report_inappropriate_${matchedUserId}`)]
                ]));
            } else {
                await db.execute({ sql: "DELETE FROM likes WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)", args: [userId, matchedUserId, matchedUserId, userId] });
                await ctx.reply('✅ Chat ပိတ်ပြီး Match ကို ဖျက်ပြီးပါပြီ။');
                try { await bot.telegram.sendMessage(matchedUserId, '❌ တစ်ဦးက သင်နှင့် Match ကို ဖျက်ပြီး Chat ကို ပိတ်ထားသည်။'); } catch (e) {}
                return;
            }
        }
    }

    // Proxy logic
    const sessionResult = await db.execute({ sql: "SELECT matched_user_id FROM chat_sessions WHERE user_id = ?", args: [userId] });
    if (sessionResult.rows.length > 0) {
        const matchedUserId = sessionResult.rows[0].matched_user_id;
        try {
            if (ctx.message.text) await bot.telegram.sendMessage(matchedUserId, ctx.message.text);
            else if (ctx.message.photo) await bot.telegram.sendPhoto(matchedUserId, ctx.message.photo[ctx.message.photo.length - 1].file_id, { caption: ctx.message.caption });
            else if (ctx.message.voice) await bot.telegram.sendVoice(matchedUserId, ctx.message.voice.file_id);
            else if (ctx.message.sticker) await bot.telegram.sendSticker(matchedUserId, ctx.message.sticker.file_id);
            await ctx.reply('✅ ပို့ပြီးပါပြီ');
        } catch (e) {
            console.error('Chat routing error:', e);
            await ctx.reply('❌ ပို့၍မရပါ။ တစ်ဖက်လူက bot ကို block ထားတာမျိုး ဖြစ်နိုင်ပါတယ်။');
        }
    } else {
        await db.execute({ sql: "UPDATE users SET step = 'done' WHERE telegram_id = ?", args: [userId] });
        await ctx.reply("Chat session မတွေ့ပါ။", Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    }
};
