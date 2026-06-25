import { Markup } from 'telegraf';
import { validateNickname, validateAge, validateBio } from '../validation.js';
import { isReservedUserInput, reservedInputReply, isRealLocation, formatInterests } from '../utils/helpers.js';

export const handleRegistration = async (ctx, user, db, stats) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;

    if (user.step === 'ask_name') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        const validation = validateNickname(text);
        if (!validation.valid) return await ctx.reply(`❌ ${validation.error}`);
        await db.execute({ sql: "UPDATE users SET nickname = ?, step = 'ask_age' WHERE telegram_id = ?", args: [validation.value, userId] });
        return await ctx.reply("သင့်အသက်ကို ဂဏန်းဖြင့် ရိုက်ထည့်ပေးပါ:");
    }
    
    if (user.step === 'ask_age') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        const validation = validateAge(text);
        if (!validation.valid) return await ctx.reply(`❌ ${validation.error}`);
        await db.execute({ sql: "UPDATE users SET age = ?, step = 'ask_address' WHERE telegram_id = ?", args: [validation.value, userId] });
        return await ctx.reply("📍 သင့်လက်ရှိ Location ကို Share လုပ်ပေးပါ\n\nအနီးနားရှိ ဖူးစာရှင်များကို ရှာဖွေရန် Location လိုအပ်ပါသည်။\n\n📱 Telegram ရဲ့ Location ခလုတ်ကို နှိပ်ပြီး သင့်လက်ရှိ Location ကို Share လုပ်ပေးပါ:", Markup.keyboard([Markup.button.locationRequest('📍 Share My Location')]).resize());
    }

    if (user.step === 'ask_address') {
        if (isRealLocation(ctx.message.location)) {
            const latitude = ctx.message.location.latitude;
            const longitude = ctx.message.location.longitude;
            await db.execute({
                sql: "UPDATE users SET address = ?, latitude = ?, longitude = ?, step = ? WHERE telegram_id = ?",
                args: ['Location shared', latitude, longitude, 'ask_photo', userId]
            });
            return await ctx.reply("✅ Location သိမ်းပြီးပါပြီ!\n\nသင့်ရဲ့ ပုံလှလှလေးတစ်ပုံ ပို့ပေးပါ (Photo):");
        }
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        if (text && text.trim() !== '') {
            await db.execute({ sql: "UPDATE users SET address = ?, step = 'ask_photo' WHERE telegram_id = ?", args: [text.trim(), userId] });
            return await ctx.reply("✅ Address သိမ်းပြီးပါပြီ!\n\nသင့်ရဲ့ ပုံလှလှတစ်ပုံ ပို့ပေးပါ (Photo):");
        }
        return await ctx.reply("❌ Location မတွေ့ပါ။\n\n📍 Telegram ကြောင့် အတည်ပြုထားတဲ့ Location ကို Share လုပ်ပေးပါ၊ သို့မဟုတ် သင့်နေရာအမည်ကို ရိုက်ထည့်ပေးပါ:", Markup.keyboard([Markup.button.locationRequest('📍 Share My Location')]).resize());
    }

    if (ctx.message.photo && user.step === 'ask_photo') {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await db.execute({ sql: "UPDATE users SET photo_id = ?, step = 'ask_bio' WHERE telegram_id = ?", args: [photoId, userId] });
        return await ctx.reply("သင့်အကြောင်း အနည်းငယ် ရေးပေးပါ (Bio):");
    }

    if (user.step === 'ask_bio') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        const validation = validateBio(text);
        if (!validation.valid) return await ctx.reply(`❌ ${validation.error}`);
        await db.execute({ sql: "UPDATE users SET bio = ?, step = 'ask_gender' WHERE telegram_id = ?", args: [validation.value, userId] });
        return await ctx.reply("သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
    }

    if (user.step === 'ask_gender') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        const gender = text.toLowerCase();
        if (gender !== 'male' && gender !== 'female') return await ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", Markup.keyboard([['Male', 'Female']]).resize());
        await db.execute({ sql: "UPDATE users SET gender = ?, step = 'ask_looking_for' WHERE telegram_id = ?", args: [gender, userId] });
        return await ctx.reply("ဘယ်လိင်ရဲ့ လူကို ရှာနေသလဲ (Male သို့မဟုတ် Female):", Markup.keyboard([['Male', 'Female']]).resize());
    }

    if (user.step === 'ask_looking_for') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        const lookingFor = text.toLowerCase();
        if (lookingFor !== 'male' && lookingFor !== 'female') return await ctx.reply("Male သို့မဟုတ် Female ပဲ ရွေးပေးပါ:", Markup.keyboard([['Male', 'Female']]).resize());
        await db.execute({ sql: "UPDATE users SET looking_for = ?, step = 'ask_distance' WHERE telegram_id = ?", args: [lookingFor, userId] });
        return await ctx.reply("သင်နှင့် မည်မျှအကွာအဝေးအတွင်း ရှာဖွေချင်ပါသလဲ?\n(ဥပမာ- 10, 25, 50):", Markup.keyboard([['10 km', '25 km', '50 km'], ['100 km', 'Any']]).resize());
    }

    if (user.step === 'ask_distance') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        let distance = 50;
        const cleanText = text.toLowerCase().replace('km', '').trim();
        if (cleanText === 'any') distance = 9999;
        else if (!isNaN(cleanText)) distance = parseInt(cleanText);
        
        await db.execute({ sql: "UPDATE users SET max_distance_km = ?, step = 'ask_interests' WHERE telegram_id = ?", args: [distance, userId] });
        return await ctx.reply('🎯 အကြိုက်ဆုံး အရာ (Interests) များကို ရိုက်ထည့်ပေးပါ။ ဥပမာ: travel, music, food\n\n(မလိုလျှင် /skip ထည့်ပေးပါ)');
    }

    if (user.step === 'ask_interests') {
        if (isReservedUserInput(text)) return await reservedInputReply(ctx);
        let normalized = null;
        if (text !== '/skip') {
            const parts = text.split(/[,;]+|\s+/).map(p => p.trim()).filter(Boolean);
            normalized = parts.join(',');
        }
        await db.execute({ sql: "UPDATE users SET interests = ?, is_registered = 1, step = 'done' WHERE telegram_id = ?", args: [normalized, userId] });
        return await ctx.reply('✅ Registration completed! ' + (normalized ? 'Interests saved: ' + formatInterests(normalized) : ''), Markup.keyboard([['🔍 ဖူးစာရှင်ရှာမည်', '💓 Pulse'], ['⚙️ Edit Profile', '👤 Profile'], ['✨ Daily Spark', '🏷️ Interests'], ['❌ Delete Account', '/help']]).resize());
    }
};

export const getWelcomeMessage = async (stats) => {
    const realStats = await stats.getRealStats();
    const totalUsers = realStats.total || 0;
    const totalMatches = realStats.matches || 0;
    
    return `🎉 **MM Cupid - မြန်မာ့ပထမဆုံး AI & Location-based ဖူးစာရှင်ရှာဖွေရေး ဘော့**

📊 **Matching Pulse (Live Stats):**
• အဖွဲ့ဝင်စုစုပေါင်း: ${totalUsers.toLocaleString()} ဦး
• ဖူးစာဆုံသွားသူများ: ${totalMatches.toLocaleString()} စုံ

---

✨ **MM Cupid ၏ ထူးခြားဆန်းသစ်သော Features များ:**

📍 **အနီးနားရှိသူများကို ရှာဖွေခြင်း (Distance Filtering)**
သင့်ရဲ့ လက်ရှိ Location ကို မျှဝေပြီး မိမိပတ်ဝန်းကျင် (10km, 25km, 50km သို့မဟုတ် စိတ်ကြိုက် Radius) အတွင်းရှိ ဖူးစာရှင်များကို စစ်ထုတ်ရှာဖွေနိုင်သည်။

🕵️‍♂️ **လုံခြုံစိတ်ချရသော အမည်ဝှက် Chat စနစ် (In-Bot Anonymous Chat)**
အပြန်အလှန် Like ဖြစ်သွားပါက Bot ထဲတွင် တိုက်ရိုက် အမည်ဝှက် Chat နိုင်မည်။ နှစ်ဦးလုံး သဘောတူညီမှသာ မိမိ၏ Telegram Username ကို ဖွင့်ပြမည့် (Identity Reveal) စနစ်ပါဝင်သဖြင့် လုံခြုံမှု ၁၀၀% ရှိသည်။

⚡ **နေ့စဉ်ခံစားချက်ပြသခြင်း (Daily Sparks)**
မိမိ၏ လက်ရှိ Mood သို့မဟုတ် လှုပ်ရှားမှုကို ၂၄ နာရီ ခေတ္တ status အဖြစ် အီမိုဂျီဖြင့် တင်ထားနိုင်သည်။

💌 **စာသားဖြင့် Like လုပ်ခြင်း (Like with Message)**
ပရိုဖိုင်ကို သဘောကျရုံတင်မကဘဲ တစ်ခါတည်း လျှို့ဝှက်စာသားပါ တွဲပို့ပြီး ပိုမို ရင်းနှီးစွာ စတင်ချက်ဆက်နိုင်သည်။

---

📋 **အကောင့်ဖွင့်ရန် လွယ်ကူသော အဆင့် ၈ ဆင့်:**
1️⃣ နာမည် (Nickname)
2️⃣ အသက် (Age)
3️⃣ နေရပ်မြို့နယ် (Location)
4️⃣ ပရိုဖိုင်ဓာတ်ပုံ (Photo)
5️⃣ ကိုယ်ရေးအကျဉ်း (Bio)
6️⃣ မိမိလိင် (Gender)
7️⃣ ရှာဖွေလိုသောလိင် (Preferences)
8️⃣ ရှာဖွေလိုသောအကွာအဝေး (Distance Radius)

🛡️ *ယောက်ျားလေးများသည် မိန်းကလေးများကိုသာ မြင်ရပြီး၊ မိန်းကလေးများသည် ယောက်ျားလေးများကိုသာ အပြန်အလှန် မြင်တွေ့ရမည့် စနစ်ဖြစ်သည်။*

---
🚀 ဖူးစာရှင်ရှာဖွေရေး ဂိမ်းကို စတင်ရန် **အဆင့် (၁) - သင့်ရဲ့ နာမည် (သို့မဟုတ်) အသုံးပြုချင်တဲ့ Nickname** ကို အောက်တွင် ရိုက်ပို့ပေးပါဦး ခင်ဗျာ 👇`;
};
