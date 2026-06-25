export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
};

export const isRealLocation = (location) => location && typeof location.latitude === 'number' && typeof location.longitude === 'number';

export const formatInterests = (interestsText) => {
    if (!interestsText) return '';
    const parts = interestsText.split(/[,;]+|\s#|\s+/).map(p => p.trim()).filter(Boolean);
    return parts.map(p => p.startsWith('#') ? p : `#${p}`).join(' ');
};

export const RESERVED_USER_INPUTS = new Set([
    '/start', '/find', '/nearby', '/help', '/pulse', '/profile', '/edit', '/cancel',
    '🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse', '⚙️ Edit Profile', '👤 Profile', '✨ Daily Spark', '❌ Delete Account',
    '📝 Nickname', '🎂 Age', '🏠 Address', '📷 Photo', '📄 Bio', '📍 Share My Location'
]);

export const isReservedUserInput = (text) => {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim();
    return clean.startsWith('/') || RESERVED_USER_INPUTS.has(clean) || RESERVED_USER_INPUTS.has(clean.toLowerCase());
};

export const reservedInputReply = async (ctx) => {
    return await ctx.reply("ဒီအဆင့်မှာ command button မနှိပ်ပါနဲ့။ သင့်ဖြည့်ရမည့် အချက်အလက်ကို စာရိုက်ထည့်ပေးပါ။");
};
