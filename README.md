# MM Match - Tinder-style Dating Bot

A complete Telegram dating bot with swipe functionality, built with Vercel and Turso for scalable performance supporting up to 100,000 users.

## 🤖 Bot Information

**Bot Name:** MM Match  
**Bot Username:** [@mmcupid_bot](https://t.me/mmcupid_bot)  
**Direct Link:** https://t.me/mmcupid_bot  

## 🎯 Features

### **User Features**
- **Step-by-step Registration**: 8-step process collecting nickname, age, location (GPS required), photo, bio, gender, preferences, and distance radius
- **Real GPS Location Sharing**: Users must share their real GPS coordinates via Telegram location button for accurate distance matching
- **Distance Display**: Shows distance between users in km on profile cards (e.g., "📏 5.2 km ကွာဝေးသည်")
- **Distance Filtering**: Set your preferred search radius (10km, 25km, 50km, 100km, or Any) to find nearby matches
- **In-Bot Anonymous Chat**: Chat securely without revealing Telegram handles until both users consent
- **Identity Reveal**: Choose when to share your Telegram username with mutual consent
- **Daily Sparks**: Set a temporary 24-hour status with emoji to show your current mood or activity
- **Spark Display**: Sparks appear on both your own profile and other users' profiles when viewing
- **Auto-Expiration**: Expired sparks are automatically cleaned up from the database
- **Discovery System**: Swipe through profiles with "Next", "Like", and "Like + Message" buttons
- **Gender-based Matching**: Male users see Female profiles, Female users see Male profiles
- **Match Notification**: When two users like each other, anonymous chat option is provided
- **Profile Editing**: Update nickname, age, address (GPS required), photo, and bio anytime
- **Smart UI**: Button-based interactions with pinned commands and inline keyboards
- **Welcome Back Feature**: Returning users see their profile with live stats and features overview
- **Profile View**: Users can view their own profile with active spark status
- **Like with Message**: Send a secret message when liking someone for more personal connections
- **Report System**: Report inappropriate profiles for admin review
- **Matching Pulse**: Live stats showing total users and total matches
- **Myanmar Language**: Full Myanmar language localization for welcome messages and user interface

### **Technical Features**
- **Scalable Architecture**: Optimized for 100,000+ users with serverless deployment
- **Zero Storage Cost**: Uses Telegram photo_id instead of storing images
- **Smart User Links**: Fallback to tg://user?id=xxx when username not set
- **Smart Session Cache**: No duplicate profiles shown in same session
- **Permanent Profile Tracking**: Database tracks viewed profiles across sessions
- **Proxy Message Routing**: Serverless-friendly chat message forwarding
- **Session Management**: Real-time chat session tracking without persistent connections
- **Ban/Shadowban System**: Admin tools for user moderation
- **Admin Dashboard**: Password-protected web dashboard with real-time data
- **Security**: SQL injection protection, input validation, and webhook security

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

### **Main Menu Keyboard**
```
[🔍 ဖူးစာရှင်ရှာမည်] [💓 Pulse]
[⚙️ Edit Profile] [👤 Profile]
[/help]
```

### **Welcome Back Screen**
```
🎉 Welcome Back!

[Nickname] ဟာ MM Cupid ကို ပြန်လည်ရောက်ရှိလာပါပြီ။ 💕

သင့်ရဲ့ Profile အချက်အလက်များက အောက်ပါအတိုင်းဖြစ်ပါတယ်။ �
```

### **Matching Pulse**
```
💓 Matching Pulse

👥 စုစုပေါင်း Register လုပ်ထားသူ: 540 ယောက်
❤️ ဒီနေ့ Match အရေအတွက်: 12 စုံ

🔥 MM Cupid မှာ သင့်ဖူးစာရှင်ကို ရှာဖွေလိုက်ပါ!
```

## 📊 Complete User Guide

### **1. Getting Started**
1. Open Telegram and search for **@mmcupid_bot**
2. Click **"Start"** or type `/start`
3. Follow the 8-step registration process

### **2. Registration Process**
1. **Nickname** - Type your display name
2. **Age** - Enter your age (numbers only)
3. **Address** - Enter your city/location OR send your live location via Telegram
4. **Photo** - Upload a profile photo
5. **Bio** - Write a short description about yourself
6. **Gender** - Select Male or Female (button-based)
7. **Looking For** - Select which gender you want to see
8. **Distance Radius** - Set your preferred search distance (10km, 25km, 50km, 100km, or Any)

### **3. Finding Matches**
- Type `/find` or click the **🔍 ဖူးစာရှင်ရှာမည်** button
- Browse through profiles with:
  - **❤️ Like** - Express interest in the profile
  - **💌 Like + Message** - Like with a personal secret message
  - **➡️ Next** - Skip to the next profile
  - **🚨 Report** - Report inappropriate profiles
- When both users like each other, it's a Match! You'll get an anonymous chat option
- **Location-based Filtering**: If you shared your location, you'll only see profiles within your chosen distance radius

### **4. Managing Your Profile**
- **View Profile**: Type `/profile` or click **👤 Profile** button
- **Edit Profile**: Type `/edit` or click **⚙️ Edit Profile** button
  - Edit nickname, age, address, photo, or bio
- **Update Preferences**: Type `/update` to change gender preferences

### **5. Live Statistics**
- Type `/pulse` or click **💓 Pulse** button
- View total registered users and total matches

### **6. Daily Sparks**
- Type `/spark` to set a temporary 24-hour status
- Add emoji to express your current mood or activity
- Your spark appears prominently at the top of your profile card
- Automatically expires after 24 hours without needing cleanup

### **7. Main Menu Commands**
- **🔍 ဖူးစာရှင်ရှာမည်** - Start finding matches
- **💓 Pulse** - View live statistics
- **⚙️ Edit Profile** - Update your profile information
- **👤 Profile** - View your current profile
- **✨ Daily Spark** - Set a temporary 24-hour status with emoji
- **❌ Delete Account** - Permanently delete your account and all data
- **/help** - Show help message

### 🚀 Installation & Setup

#### Prerequisites
- Node.js 18+ installed
- Telegram Bot Token ([@BotFather](https://t.me/botfather))
- Turso Database ([turso.tech](https://turso.tech))
- Vercel Account ([vercel.com](https://vercel.com))

#### Environment Variables
Create `.env` file with:
```bash
BOT_TOKEN=your_telegram_bot_token
TURSO_URL=libsql://your-db-name.turso.io
TURSO_TOKEN=your_turso_token
DASHBOARD_PASSWORD=your_secure_password
```

#### Database Setup
```bash
# Apply schema to Turso
turso db shell your-db-name < schema.sql
```

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

#### Production Deployment
```bash
# Deploy to Vercel
vercel --prod

# Set environment variables on Vercel
vercel env add BOT_TOKEN
vercel env add TURSO_URL
vercel env add TURSO_TOKEN
vercel env add DASHBOARD_PASSWORD

# Set webhook (replace with your Vercel URL)
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://mm-match.vercel.app/api" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```

### **Security Features**
- **Input Validation**: All user inputs validated
- **SQL Injection Protection**: Parameterized queries
- **Webhook Security**: Telegram webhook verification
- **Data Privacy**: Minimal data collection
- **Dashboard Protection**: Password-protected admin panel


## 📍 Location-based Matching

### **How It Works**
The bot uses the Haversine formula to calculate the distance between users' coordinates and filters matches based on your preferred distance radius.

### **Technical Implementation**
- **Bounding Box Approximation**: Uses SQL to filter profiles within a geographic bounding box for performance
- **Precise Distance Calculation**: Applies Haversine formula in JavaScript for accurate distance filtering
- **Fallback Logic**: If no profiles found within distance, falls back to broader search

### **Distance Options**
- **10 km** - Very local matches
- **25 km** - City-wide matches
- **50 km** - Regional matches (default)
- **100 km** - Extended regional matches
- **Any** - No distance restriction

### **Privacy**
- Location sharing is optional during registration
- Users can choose to enter city name instead of sharing coordinates
- Location data is stored securely in the database
## �️ Database Schema

The bot uses Turso (SQLite-compatible) database with the following schema:

```sql
-- Users table - stores user profiles and registration state
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
    interests TEXT, -- Interest tags like #travel #music #food
    mood_status TEXT, -- Current mood status with emoji
    step TEXT DEFAULT 'start', -- Registration step tracking
    is_registered BOOLEAN DEFAULT 0,
    latitude REAL, -- User's location latitude
    longitude REAL, -- User's location longitude
    max_distance_km INTEGER DEFAULT 50, -- Maximum distance for matches in km
    is_banned BOOLEAN DEFAULT 0,
    is_shadowbanned BOOLEAN DEFAULT 0,
    ban_reason TEXT,
    banned_at DATETIME,
    banned_by INTEGER -- Admin telegram_id who banned the user
);

-- Profile views table - tracks which profiles have been viewed
CREATE TABLE profile_views (
    user_id INTEGER,
    viewed_profile_id INTEGER,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, viewed_profile_id)
);

-- Likes table - tracks who likes whom
CREATE TABLE likes (
    from_user INTEGER,
    to_user INTEGER,
    status TEXT DEFAULT 'pending', -- 'pending' or 'accepted'
    PRIMARY KEY (from_user, to_user)
);

-- Reports table - tracks user reports for trust & safety
CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL, -- User who filed the report
    reported_user_id INTEGER NOT NULL, -- User being reported
    reason TEXT NOT NULL, -- 'fake_profile', 'spam', 'inappropriate'
    description TEXT, -- Additional details
    status TEXT DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved', 'dismissed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    reviewed_by INTEGER, -- Admin telegram_id who reviewed
    action_taken TEXT, -- 'banned', 'shadowbanned', 'warned', 'no_action'
    FOREIGN KEY (reporter_id) REFERENCES users(telegram_id),
    FOREIGN KEY (reported_user_id) REFERENCES users(telegram_id)
);

-- Performance indexes
CREATE INDEX idx_discovery ON users(is_registered, gender, looking_for);
CREATE INDEX idx_interests ON users(interests);
CREATE INDEX idx_mood_status ON users(mood_status);
CREATE INDEX idx_likes_from ON likes(from_user);
CREATE INDEX idx_likes_to ON likes(to_user);
CREATE INDEX idx_reports_reported ON reports(reported_user_id, status);
CREATE INDEX idx_reports_reporter ON reports(reporter_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_users_banned ON users(is_banned);
CREATE INDEX idx_users_shadowbanned ON users(is_shadowbanned);
CREATE INDEX idx_location ON users(latitude, longitude) WHERE is_registered = 1;
CREATE INDEX idx_max_distance ON users(max_distance_km) WHERE is_registered = 1;
```

## �� Admin Dashboard

Access the web dashboard at your Vercel URL: `https://your-app.vercel.app/`

### **Features**
- **Real-time Stats**: Total users, today's matches, active users
- **User List**: View all registered users with details
- **Match List**: See all mutual matches
- **Auto-refresh**: Data updates every 30 seconds
- **Password Protected**: Secure login with configurable password

### **Dashboard Password**
Default password: `admin123` (or set via environment variable)

```bash
# Set custom password
vercel env add DASHBOARD_PASSWORD
# Enter your secure password
vercel --prod
```

### **API Endpoints**
- `GET /api/stats` - Dashboard statistics
- `GET /api/users` - User list
- `GET /api/matches` - Match list

All endpoints require password in header: `X-Password: yourpassword`

## 🎯 Bot Commands Reference

| Command | Description | Usage |
|---------|-------------|-------|
| `/start` | Begin registration or welcome back | All users |
| `/find` | Discover profiles | Registered users |
| `/pulse` | View live stats | All users |
| `/profile` | View your own profile | Registered users |
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

## ✅ Completed Features

- ✅ Welcome Back feature for returning users
- ✅ Matching Pulse with live stats
- ✅ Session-based cache (no duplicate profiles)
- ✅ Admin Dashboard with password protection
- ✅ Profile view command
- ✅ Improved UI/UX with better messages

## 📈 Future Enhancements

- **Location-based Matching**: Geographic proximity filtering
- **Advanced Filters**: Age range, interests, etc.
- **Photo Verification**: Enhanced profile authenticity
- **Chat Features**: In-bot messaging capabilities
- **Premium Features**: Advanced matching algorithms
- **Push Notifications**: Real-time match alerts
- **Analytics**: User behavior insights

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
