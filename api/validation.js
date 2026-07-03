
// Comprehensive list of Burmese and English profanity and sexual terms
const PROFANITY_LIST = [
    // Burmese Swear Words (Common variations)
    'လိုး', 'စောက်', 'ဖုတ်', 'လီး', 'ငပဲ', 'အဖုတ်', 'အလိုး', 'မအေလိုး', 'နှမလိုး', 'သားလိုး', 'မအေ', 'ဖာသည်', 'ဖာမ', 'ခွေးမသား', 'ဂျပိုး', 'စောက်ရူး', 'စောက်တုံး', 'စောက်ပေါ', 'စောက်ဖုတ်', 'စောက်လီး',
    
    // Sexual / Explicit Terms (Burmese)
    'လိုးချင်', 'အလိုးခံ', 'စောက်ပတ်', 'ကုန်း', 'မှုတ်', 'ဂွင်း', 'ဂွင်းတိုက်', 'ထု', 'လီးစုပ်', 'ဘဲဥ', 'နို့', 'ဖင်', 'ဖင်လိုး', 'ဖင်ကုန်း', 'ရည်းစားလိုး', 'အိုး', 'အိုးကြီး', 'စပ', 'စောက်ဖုတ်', 'ဖာ',
    
    // English Profanity & Sexual Terms
    'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'sex', 'porn', 'xxx', 'horny', 'cum', 'anal', 'boobs', 'nude', 'naked', 'slut', 'whore', 'fucker'
];

export const validateNickname = (name) => {
    if (!name || typeof name !== 'string') return { valid: false, error: "နာမည်ရိုက်ထည့်ပေးပါ" };
    const trimmed = name.trim();
    if (trimmed.length < 2) return { valid: false, error: "နာမည်က အနည်းဆုံး ၂ လုံးရှိရပါမယ်" };
    if (trimmed.length > 20) return { valid: false, error: "နာမည်က အလုံး ၂၀ ထက်မကျော်ရပါဘူး" };
    
    const hasBadWord = PROFANITY_LIST.some(word => trimmed.toLowerCase().includes(word.toLowerCase()));
    if (hasBadWord) return { valid: false, error: "မဆီလျော်တဲ့ စကားလုံးများ ပါဝင်နေပါတယ်" };
    
    return { valid: true, value: trimmed };
};

export const validateAge = (ageText) => {
    const age = parseInt(ageText);
    if (isNaN(age)) return { valid: false, error: "အသက်ကို ဂဏန်းဖြင့်သာ ရိုက်ထည့်ပေးပါ" };
    if (age < 18) return { valid: false, error: "စိတ်မကောင်းပါဘူး၊ ဒီ Bot ကို အသက် ၁၈ နှစ်ပြည့်မှသာ အသုံးပြုနိုင်ပါတယ်" };
    if (age > 100) return { valid: false, error: "အသက် မှန်ကန်စွာ ရိုက်ထည့်ပေးပါ" };
    return { valid: true, value: age };
};

export const validateBio = (bio) => {
    if (!bio || typeof bio !== 'string') return { valid: false, error: "Bio ရိုက်ထည့်ပေးပါ" };
    const trimmed = bio.trim();
    if (trimmed.length < 10) return { valid: false, error: "Bio က အနည်းဆုံး စာလုံး ၁၀ လုံး ရှိရပါမယ်" };
    if (trimmed.length > 200) return { valid: false, error: "Bio က စာလုံး ၂၀၀ ထက် မကျော်ရပါဘူး" };
    
    const hasBadWord = PROFANITY_LIST.some(word => trimmed.toLowerCase().includes(word.toLowerCase()));
    if (hasBadWord) return { valid: false, error: "Bio ထဲမှာ မဆီလျော်တဲ့ စကားလုံးများ ပါဝင်နေပါတယ်" };
    
    return { valid: true, value: trimmed };
};

export const validateSecretMessage = (msg) => {
    if (!msg || typeof msg !== 'string') return { valid: false, error: "စာသားတစ်ကြောင်း ရိုက်ထည့်ပေးပါ" };
    const trimmed = msg.trim();
    if (trimmed.length < 2) return { valid: false, error: "စာသားတစ်ကြောင်း အနည်းဆုံး ၂ လုံး လိုအပ်ပါသည်" };
    if (trimmed.length > 200) return { valid: false, error: "စာသားသည် ၂၀၀ လုံးထက် မကျော်ရပါ" };

    const hasBadWord = PROFANITY_LIST.some(word => trimmed.toLowerCase().includes(word.toLowerCase()));
    if (hasBadWord) return { valid: false, error: "မဆီလျော်သော စကားလုံးများ မပါနိုင်ပါ" };

    // Disallow commands or inputs starting with slash
    if (trimmed.startsWith('/')) return { valid: false, error: "Command များကို စာသားအဖြစ် အသုံးမပြုနိုင်ပါ" };

    return { valid: true, value: trimmed };
};
