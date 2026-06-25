import { Markup } from 'telegraf';
import { calculateDistance, formatInterests } from '../utils/helpers.js';

export const getRandomProfile = async (userId, lookingFor, viewedIds, db, getUser) => {
    const currentUser = await getUser(userId);
    const userLat = currentUser?.latitude;
    const userLon = currentUser?.longitude;
    const maxDistance = currentUser?.max_distance_km || 50;
    const userInterests = currentUser?.interests ? currentUser.interests.split(',').map(i => i.trim()).filter(Boolean) : [];
    
    const notInClause = viewedIds.length > 0 ? `AND u.telegram_id NOT IN (${viewedIds.map(() => '?').join(',')})` : '';
    const notInArgs = viewedIds.length > 0 ? viewedIds : [];
    
    let interestScoreSql = '0 as interest_score';
    if (userInterests.length > 0) {
        interestScoreSql = userInterests.map(interest => 
            `(CASE WHEN u.interests LIKE '%${interest}%' THEN 1 ELSE 0 END)`
        ).join(' + ') + ' as interest_score';
    }

    let sql, args;
    if (userLat != null && userLon != null && maxDistance < 9999) {
        const latDelta = maxDistance / 111;
        const lonDelta = maxDistance / (111 * Math.cos(userLat * Math.PI / 180));
        sql = `SELECT u.*, ${interestScoreSql} FROM users u 
               LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
               WHERE u.is_registered = 1 AND u.telegram_id != ? AND u.gender = ? AND u.is_banned = 0 AND u.is_shadowbanned = 0
               AND pv.viewed_profile_id IS NULL AND u.telegram_id NOT IN (SELECT to_user FROM likes WHERE from_user = ?)
               AND u.latitude BETWEEN ? AND ? AND u.longitude BETWEEN ? AND ? ${notInClause} ORDER BY interest_score DESC, RANDOM() LIMIT 1`;
        args = [userId, userId, lookingFor, userId, userLat - latDelta, userLat + latDelta, userLon - lonDelta, userLon + lonDelta, ...notInArgs];
    } else {
        sql = `SELECT u.*, ${interestScoreSql} FROM users u 
               LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
               WHERE u.is_registered = 1 AND u.telegram_id != ? AND u.gender = ? AND u.is_banned = 0 AND u.is_shadowbanned = 0
               AND pv.viewed_profile_id IS NULL AND u.telegram_id NOT IN (SELECT to_user FROM likes WHERE from_user = ?)
               ${notInClause} ORDER BY interest_score DESC, RANDOM() LIMIT 1`;
        args = [userId, userId, lookingFor, userId, ...notInArgs];
    }
    
    const result = await db.execute({ sql, args });
    if (result.rows.length > 0) {
        const profile = result.rows[0];
        if (userLat != null && userLon != null && maxDistance < 9999 && profile.latitude != null) {
            if (calculateDistance(userLat, userLon, profile.latitude, profile.longitude) <= maxDistance) return profile;
        } else return profile;
    }
    return null;
};

export const showNextProfile = async (ctx, db, getUser, sessionCache) => {
    const userId = ctx.from.id;
    const user = await getUser(userId);
    if (!user || !user.looking_for) return await ctx.reply("Profile ပြည့်စုံအောင် မှတ်ပုံတင်ပြီးမှ ရှာဖို့လို့ပါ။");

    const viewedIds = sessionCache.get(userId) ? Array.from(sessionCache.get(userId)) : [];
    const target = await getRandomProfile(userId, user.looking_for, viewedIds, db, getUser);

    if (!target) {
        sessionCache.delete(userId);
        return await ctx.reply("⏳ ခေတ္တစောင့်ဆိုင်းပေးပါဦး...\n\nသတ်မှတ်ထားတဲ့ Radius အကွာအဝေးအတွင်းမှာ Profile အသစ်တွေ ကုန်သွားပါပြီ။ ✨");
    }

    if (!sessionCache.has(userId)) sessionCache.set(userId, new Set());
    sessionCache.get(userId).add(target.telegram_id);
    await db.execute({ sql: "INSERT OR IGNORE INTO profile_views (user_id, viewed_profile_id) VALUES (?, ?)", args: [userId, target.telegram_id] });

    let distanceText = '';
    if (user.latitude != null && target.latitude != null) {
        distanceText = `\n📏 ${calculateDistance(user.latitude, user.longitude, target.latitude, target.longitude).toFixed(1)} km ကွာဝေးသည်`;
    }

    const caption = `👤 **${target.nickname}** (${target.age})${distanceText}\n🔖 ${formatInterests(target.interests)}\n\n📝 ${target.bio}`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❤️ Like', `like_${target.telegram_id}`), Markup.button.callback('💌 Like + Msg', `like_with_message_${target.telegram_id}`)],
        [Markup.button.callback('➡️ Next', 'next_profile'), Markup.button.callback('🚨 Report', `report_${target.telegram_id}`)]
    ]);

    try {
        await ctx.replyWithPhoto(target.photo_id, { caption, reply_markup: keyboard.reply_markup, parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.reply(caption, { reply_markup: keyboard.reply_markup, parse_mode: 'Markdown' });
    }
};

export const handlePulse = async (ctx, db) => {
    const totalUsers = (await db.execute({ sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1", args: [] })).rows[0]?.count || 0;
    const totalMatches = Math.floor(((await db.execute({ sql: "SELECT COUNT(*) as count FROM likes l WHERE EXISTS (SELECT 1 FROM likes l2 WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user)", args: [] })).rows[0]?.count || 0) / 2);
    const pulseText = `💓 **MM Cupid Pulse**\n\n👥 စုစုပေါင်းအသုံးပြုသူ: ${totalUsers}\n💘 အောင်မြင်သွားသော Match များ: ${totalMatches}\n\n🔥 MM Cupid မှာ သင့်ဖူးစာရှင်ကို ရှာဖွေလိုက်ပါ!`;
    return await ctx.reply(pulseText, { parse_mode: 'Markdown' });
};
