// Comprehensive list of Burmese, Myanglish, and English profanity/toxic terms
const PROFANITY_LIST = [
    // --- Burmese Swear Words & Direct Insults (ဆဲစကားလုံး တိုက်ရိုက်များ) ---
    'လိုး', 'စောက်', 'ဖုတ်', 'လီး', 'ငပဲ', 'အဖုတ်', 'အလိုး', 'မအေလိုး', 'နှမလိုး', 'သားလိုး', 'မအေ', 'ဖာသည်', 'ဖာမ', 'ခွေးမသား', 'ဂျပိုး', 'စောက်ရူး', 'စောက်တုံး', 'စောက်ပေါ', 'စောက်ဖုတ်', 'စောက်လီး',
    'မအေလိုးမ', 'ခွေးသား', 'စောက်ခွက်', 'လီးပဲ', 'လီးဖြစ်', 'စောက်ချိုး', 'စောက်ရည်', 'ငပြူး', 'စောက်ကန်း', 'ဥက္ကာ', 'စောက်ချော', 'ဂျီးမင်း',
    'နှမလိုးမ', 'လီးလား', 'စောက်ရမ်း', 'လီးကောင်', 'ခွေးမွေးတာ', 'မျိုးမစစ်', 'စောက်သုံးမကျ', 'စောက်ကျိုးနည်း', 'အမေလိုး', 'လီးစိမ်း', 'ဖာသည်မ', 'ခွေးလိုး', 'ဖာခေါင်း',
    'နှမပေး', 'လီးပဲကွာ', 'စောက်ရူးမ', 'ခွေးမ', 'ဖာသည်မသား', 'စောက်ခွက်ပြဲ', 'လီးတို', 'မျိုးမစစ်တဲ့ကောင်', 'စောက်ခြောက်', 'လီးပဲနော်', 'မအေဘေး', 'လီးစုတ်မ',
    'ခွေးလိုကောင်', 'ငါးပါးမှောက်', 'သေနာကောင်', 'ဂျပိုးကောင်', 'စောက်ပေါက်', 'ငတုံး', 'ဂေါက်သီး', 'ဂေါက်တောက်တောက်', 'ဦးနှောက်မရှိ', 'စိတ်ရူး', 'ကောင်မစုတ်',
    // ဖြည့်စွက်ထားသော ဆဲစကားလုံးများ
    'မအေပေး', 'နှမပေးကောင်', 'ဖာသည်မသား', 'ခွေးမသားကောင်', 'ငရဲပန်း', 'မအေလိုးကောင်', 'လီးစုပ်တဲ့ကောင်', 'လီးခေါင်း', 'လီးပဲဟျောင့်', 'စောက်ခွက်ပိတ်', 'စောက်ပေါက်ပိတ်', 
    'စောက်ရှက်မရှိ', 'စောက်ချိုးမပြေ', 'စောက်ကျင့်မကောင်း', 'ကောင်မလိုး', 'ဖာသယ်', 'ဖာသယ်မ', 'ခွေးမွေးတဲ့ကောင်', 'မင်းအမေလိုး', 'မင်းနှမလိုး', 'လီးရှည်', 'လီးမစုပ်နဲ့',

    // --- Sexual / Explicit Terms (ကာမနှင့် လိင်ပိုင်းဆိုင်ရာ ရိုင်းစိုင်းသော စကားလုံးများ) ---
    'လိုးချင်', 'အလိုးခံ', 'စောက်ပတ်', 'ကုန်း', 'မှုတ်', 'ဂွင်း', 'ဂွင်းတိုက်', 'ထု', 'လီးစုပ်', 'ဘဲဥ', 'နို့', 'ဖင်', 'ဖင်လိုး', 'ဖင်ကုန်း', 'ရည်းစားလိုး', 'အိုး', 'အိုးကြီး', 'စပ', 'စောက်ဖုတ်', 'ဖာ',
    'လိုးမယ်', 'စုပ်ပေး', 'ယက်ပေး', 'ဖင်ch', 'ဖင်ယက်', 'စောက်မွှေး', 'လီးမွှေး', 'နို့ကြီး', 'နို့ကိုင်', 'ဂန်ဒူး', 'ခြောက်', 'အခြောက်', 'မုဒိမ်း', 'ကျူးလွန်', 'ကာမ', 'စပ်ယှက်',
    'ဖင်ခံ', 'လီးကြီး', 'ဂွင်းထု', 'စောက်ပတ်ယက်', 'နို့စို့', 'မှောက်ခုံ', 'ကာမစပ်ယှက်', 'အပြာကား', 'ချောင်းရိုက်', 'ဖင်မှင်တက်', 'စောက်စိ', 'လီးထိပ်', 'ခိုးရိုက်',
    'ကုန်းပေး', 'လိုးကြစို့', 'စောက်ပတ်ကြီး', 'ဖင်ကြီး', 'အဝတ်ဗလာ', 'နို့သီးခေါင်း', 'လီးအရည်', 'အလိုးကြမ်း', 'စောက်ဖတ်', 'ဂွင်းထုချင်', 'အပြာစာပေ',
    'ထန်ချင်', 'ထန်နေတယ်', 'အာသာဖြေ', 'ညစ်ညမ်း', 'ချောင်းကြည့်', 'အကြည်ကား', 'ဇာတ်ကားပြာ', 'ဖင်လိုးချင်',
    // ဖြည့်စွက်ထားသော လိင်ပိုင်းဆိုင်ရာစကားလုံးများ
    'လိုးကြမယ်', 'ဖင်ဆော်', 'ဖင်ချချင်', 'စောက်ပတ်နိုက်', 'နို့ကြီးတွေ', 'ဖင်ကြီးတွေ', 'အလိုးခံချင်', 'စောက်စိယက်', 'လီးစုပ်ပေး', 'စောက်ဖုတ်ယက်', 'ထန်ကား', 'လိုးကား', 'စောက်ခမ်း', 'လီးတံ',

    // --- Myanglish Profanity (အင်္ဂလိပ်လို ရေးသားထားသော ဗမာဆဲစကားလုံးများ) ---
    'loe', 'lo_e', 'sauk', 'sk', 'lee', 'le p', 'ma ay loe', 'gnapae', 'ah phoke', 'hnamah loe', 'foke', 'hnut', 'gwin', 'gwin tite', 'gwindite',
    'chout', 'ah chout', 'phar', 'pharma', 'khway ma thar', 'sauk ryu', 'sauk pussy', 'sauk phoke', 'sauk lee', 'foke pyat',
    'sauk pat', 'sauk pad', 'kone', 'koke', 'mote', 'soke pway', 'lee soke', 'phin', 'phin loe', 'ah phin', 'sauk si', 'ma ay bay', 'mae loe',
    'leee', 'loee', 'saukru', 'sauktone', 'saukpo', 'ahfoke', 'leebal', 'skp', 'saukphat', 'phinky', 'linloe', 'maloe',
    'ma_aye_loe', 'ma-ay-loe', 'leebalpal', 'sauk-khet', 'sauk-khwat', 'loechin', 'leeshote', 'hnamah-loe', 'khway-thar', 'farkhaung', 'pharkhaung',

    // --- English Profanity & Slurs (အင်္ဂလိပ် ဆဲစကားလုံးများနှင့် ဆဲနည်းမျိုးစုံ) ---
    'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'sex', 'porn', 'xxx', 'horny', 'cum', 'anal', 'boobs', 'nude', 'naked', 'slut', 'whore', 'fucker',
    'cunt', 'bastard', 'dickhead', 'motherfucker', 'cock', 'vagina', 'tit', 'tits', 'penis', 'blowjob', 'handjob', 'hentai', 'milf', 'dildo', 'condom', 'slutty',
    'deepthroat', 'orgasm', 'threesome', 'basterd', 'wanker', 'twat', 'clitoris', 'intercourse', 'erotic', 'gangbang',
    'faggot', 'hooker', 'escort', 'jerkoff', 'jackoff', 'nsfw', 'rape', 'incest', 'bDSM', 'pedophile', 'scrotum',
    'nigga', 'nigger', 'dumbass', 'bullshit', 'prick', 'twat', 'slut', 'dyke', 'retard', 'hoe', 'skank'
];

const normalizeString = (str) => {
    if (!str) return '';
    return str
        .toLowerCase()
        .replace(/[\s\u200B-\u200D\uFEFF]/g, '') 
        .replace(/[့း]/g, '') 
        .trim();
};

export const validateNickname = (name) => {
    if (!name || typeof name !== 'string') return { valid: false, error: "နာမည်ရိုက်ထည့်ပေးပါ" };
    const trimmed = name.trim();
    if (trimmed.length < 2) return { valid: false, error: "နာမည်က အနည်းဆုံး ၂ လုံးရှိရပါမယ်" };
    if (trimmed.length > 20) return { valid: false, error: "နာမည်က အလုံး ၂၀ ထက်မကျော်ရပါဘူး" };
    
    const normalized = normalizeString(trimmed);
    const hasBadWord = PROFANITY_LIST.some(word => normalized.includes(normalizeString(word)));
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
    
    const normalized = normalizeString(trimmed);
    const hasBadWord = PROFANITY_LIST.some(word => normalized.includes(normalizeString(word)));
    if (hasBadWord) return { valid: false, error: "Bio ထဲမှာ မဆီလျော်တဲ့ စကားလုံးများ ပါဝင်နေပါတယ်" };
    
    return { valid: true, value: trimmed };
};

export const validateSecretMessage = (msg) => {
    if (!msg || typeof msg !== 'string') return { valid: false, error: "စာသားတစ်ကြောင်း ရိုက်ထည့်ပေးပါ" };
    const trimmed = msg.trim();
    if (trimmed.length < 2) return { valid: false, error: "စာသားတစ်ကြောင်း အနည်းဆုံး ၂ လုံး လိုအပ်ပါသည်" };
    if (trimmed.length > 200) return { valid: false, error: "စာသားသည် ၂၀၀ လုံးထက် မကျော်ရပါ" };

    const normalized = normalizeString(trimmed);
    const hasBadWord = PROFANITY_LIST.some(word => normalized.includes(normalizeString(word)));
    if (hasBadWord) return { valid: false, error: "မဆီလျော်သော စကားလုံးများ မပါနိုင်ပါ" };

    // Disallow commands or inputs starting with slash
    if (trimmed.startsWith('/')) return { valid: false, error: "Command များကို စာသားအဖြစ် အသုံးမပြုနိုင်ပါ" };

    return { valid: true, value: trimmed };
};