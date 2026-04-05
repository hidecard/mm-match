# MM Match - Tinder-style Dating Bot

A complete Telegram dating bot with swipe functionality, built with Vercel and Turso for scalable performance supporting up to 100,000 users.

## 🤖 Bot Information

**Bot Name:** MM Match  
**Bot Username:** [@mmcupid_bot](https://t.me/mmcupid_bot)  
**Direct Link:** https://t.me/mmcupid_bot  

## 🎯 Features

- **Step-by-step Registration**: Collects nickname, age, location, photo, bio, gender, and preferences
- **Discovery System**: Swipe through profiles with "Next" and "Like" buttons
- **Gender-based Matching**: Male users see Female profiles, Female users see Male profiles
- **Match Notification**: When two users like each other, usernames are revealed
- **Profile Editing**: Update any profile information anytime
- **Smart UI**: Button-based interactions with pinned commands
- **Scalable Architecture**: Optimized for 100,000+ users
- **Zero Storage Cost**: Uses Telegram photo_id instead of storing images
- **Smart User Links**: Fallback to tg://user?id=xxx when username not set

## 🛠️ Tech Stack

### **Backend**
- **Node.js** - Runtime environment
- **Telegraf** - Telegram Bot Framework
- **JavaScript (ES Modules)** - Modern JavaScript with import/export

### **Database**
- **Turso (SQLite-compatible)** - Edge database with global distribution
- **LibSQL Client** - Official Turso database driver

### **Deployment**
- **Vercel** - Serverless deployment platform
- **Vercel Functions** - Serverless API endpoints

### **APIs & Services**
- **Telegram Bot API** - Core messaging and bot functionality
- **Webhook Integration** - Real-time message handling

## 🎨 User Interface & Experience

### **Welcome Screen**
```
🎉 MM Match မှ ကြိုဆိုပါတယ်!

💕 Tinder-style Dating Bot
အရင်းအမြစ်လွယ်ကူတဲ့ ရည်းစားရှာဖွေရေး ဘော့

📋 မှတ်ပုံတင်လုပ်ရန် အဆင့်များ:
1️⃣ နာမည် (Nickname)
2️⃣ အသက် (Age) 
3️⃣ နေရပ် (Address)
4️⃣ ပုံ (Photo)
5️⃣ ကိုယ်ရေးတင်ပြ (Bio)
6️⃣ လိင် (Gender)
7️⃣ ရှာနေသောလိင် (Looking For)

🎯 အသုံးပြုရန် ကွန်ယက်များ:
/find - Profile ရှာပါ
/edit - Profile ပြင်းဆင့်ပါ
/update - လိင်အပြင်းအစားပြောင်းပါ
/help - ကူညီမှုကိုကြည့်ပါ

❤️ Male များ Female ကိုသာ မြင်ရပါမည်
❤️ Female များ Male ကိုသာ မြင်ရပါမည်
```

### **Gender Selection UI**
```
သင့်လိင်ကို ရွေးပါ (Male သို့မဟုတ် Female):

[Male] [Female]
```

### **Profile Display**
```
👤 Nickname (25)
📍 Yangon

📝 I love traveling and meeting new people!

[❤️ Like] [➡️ Next]
```

### **Match Notification**
```
Match ဖြစ်သွားပါပြီ! ❤️
သူ့ဆီ စကားပြောလိုက်ပါ: @username
```

### **Pinned Commands Menu**
```
/find  /edit  /help
```

### **Profile Edit Menu**
```
ဘာကိုပြင်းဆင့်လဲချင်တာပါ။

[📝 Nickname] [🎂 Age]
[🏠 Address] [📷 Photo]
[📄 Bio] [❌ Cancel]
```

## 📱 Complete User Guide

### **1. Getting Started**
1. Open Telegram and search for **@mmcupid_bot**
2. Click **"Start"** or type `/start`
3. Follow the 7-step registration process

### **2. Registration Process**
1. **Nickname** - Type your display name
2. **Age** - Enter your age (numbers only)
3. **Address** - Enter your city/location
4. **Photo** - Upload a profile photo
5. **Bio** - Write a short description about yourself
6. **Gender** - Select Male or Female (button-based)
7. **Looking For** - Select which gender you want to see

### **3. Finding Matches**
- Type `/find` or click the pinned command
- Browse through profiles with ❤️ Like or ➡️ Next
- When both users like each other, it's a Match!

### **4. Managing Your Profile**
```sql
-- Users table with enhanced fields
CREATE TABLE users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    nickname TEXT,
    age INTEGER,
    address TEXT,
    bio TEXT,
    photo_id TEXT,
    gender TEXT,
    looking_for TEXT,
    interests TEXT,        -- Interest tags
    mood_status TEXT,     -- Current mood
    step TEXT DEFAULT 'start',
    is_registered BOOLEAN DEFAULT 0
);

-- Performance indexes
CREATE INDEX idx_discovery ON users(is_registered, gender, looking_for);
CREATE INDEX idx_interests ON users(interests);
CREATE INDEX idx_mood_status ON users(mood_status);
```

### 🚀 Installation & Setup

#### Prerequisites
- Node.js 18+ installed
- Telegram Bot Token
- Turso Database URL and Token

#### Local Development
```bash
# Clone repository
git clone <repository-url>
cd mm-match

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your credentials

# Start development server
npm run dev
```

### **Security Features**
- **Input Validation**: All user inputs validated
- **SQL Injection Protection**: Parameterized queries
- **Webhook Security**: Telegram webhook verification
- **Data Privacy**: Minimal data collection

## 🎯 Bot Commands Reference

| Command | Description | Usage |
|---------|-------------|-------|
| `/start` | Begin registration | New users |
| `/find` | Discover profiles | Registered users |
| `/edit` | Update profile info | Registered users |
| `/update` | Change gender preferences | Registered users |
| `/help` | Show user guide | All users |

## 🌟 Key Benefits

### **For Users**
- **Easy to Use**: Simple button-based interface
- **Safe & Secure**: Privacy-focused matching
- **Real-time**: Instant notifications
- **Free to Use**: No charges for basic features

### **For Developers**
- **Scalable**: Handles 100,000+ users
- **Low Cost**: Minimal infrastructure costs
- **Modern Tech**: Latest JavaScript and serverless architecture
- **Well Documented**: Complete setup and usage guides

## 📈 Future Enhancements

- **Location-based Matching**: Geographic proximity filtering
- **Advanced Filters**: Age range, interests, etc.
- **Photo Verification**: Enhanced profile authenticity
- **Chat Features**: In-bot messaging capabilities
- **Premium Features**: Advanced matching algorithms

## 🤝 Contributing

This project is open for contributions. Key areas for improvement:
- UI/UX enhancements
- Performance optimizations
- New feature development
- Bug fixes and improvements

## 📄 License

MIT License - feel free to use and modify for your projects.

---

## 🎉 Start Using MM Match Today!

**Bot:** [@mmcupid_bot](https://t.me/mmcupid_bot)  
**Direct Link:** https://t.me/mmcupid_bot

Join thousands of users finding meaningful connections through MM Match! 💕
