# Leo Match - Tinder-style Dating Bot

A complete Telegram dating bot with swipe functionality, built with Vercel and Turso for scalable performance supporting up to 100,000 users.

## Features

- **Step-by-step Registration**: Collects nickname, age, location, photo, and bio
- **Discovery System**: Swipe through profiles with "Next" and "Like" buttons
- **Match Notification**: When two users like each other, usernames are revealed
- **Scalable Architecture**: Optimized for 100,000+ users
- **Zero Storage Cost**: Uses Telegram photo_id instead of storing images
- **Smart User Links**: Fallback to tg://user?id=xxx when username not set

## Tech Stack

- **Backend**: Node.js with Telegraf
- **Database**: Turso (SQLite-compatible)
- **Deployment**: Vercel
- **Platform**: Telegram Bot API

## Quick Setup

### 1. Database Setup

Run this SQL in your Turso dashboard:

```sql
-- Users table
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
    step TEXT DEFAULT 'start',
    is_registered BOOLEAN DEFAULT 0
);

-- Likes table
CREATE TABLE likes (
    from_user INTEGER,
    to_user INTEGER,
    status TEXT DEFAULT 'pending',
    PRIMARY KEY (from_user, to_user)
);

-- Indexes for performance
CREATE INDEX idx_discovery ON users(is_registered, gender, looking_for);
CREATE INDEX idx_likes_from ON likes(from_user);
CREATE INDEX idx_likes_to ON likes(to_user);
```

### 2. Environment Variables

Create `.env` file:

```env
BOT_TOKEN=your_telegram_bot_token_here
TURSO_URL=libsql://mm-match-db-hidecatd.aws-ap-northeast-1.turso.io
TURSO_TOKEN=your_turso_auth_token_here
```

### 3. Deploy to Vercel

1. Push code to GitHub repository
2. Connect repository to Vercel
3. Add environment variables in Vercel Settings
4. Deploy

### 4. Set Telegram Webhook

After deployment, set the webhook:

```bash
# Replace YOUR_BOT_TOKEN and YOUR_VERCEL_URL
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-app.vercel.app
```

## How It Works

### Registration Flow
1. User starts bot with `/start`
2. Bot asks for nickname → age → location → photo → bio
3. After completion, user can use `/find` command

### Discovery Flow
1. User types `/find`
2. Bot shows random user profile with photo
3. User can "❤️ Like" or "➡️ Next"
4. If liked, target user gets notification

### Match System
1. When User A likes User B, User B gets notification
2. User B can view profile or accept
3. If accepted, both users get each other's usernames
4. Users can then start chatting directly

## Performance Optimizations

- **Photo Storage**: Only stores Telegram photo_id (zero storage cost)
- **Random Selection**: Uses `ORDER BY RANDOM()` for efficient discovery
- **Indexed Queries**: Optimized for large user bases
- **Connection Pooling**: Turso handles database connections efficiently

## Scaling to 100,000+ Users

For 1M+ users, consider:
- Replace `ORDER BY RANDOM()` with `TABLE SAMPLE` for better performance
- Add Redis for caching frequently accessed profiles
- Implement geographic filtering for better matching

## Commands

- `/start` - Begin registration
- `/find` - Start discovering profiles

## File Structure

```
mm-match/
├── api/
│   └── index.js          # Main bot engine
├── schema.sql             # Database schema
├── package.json           # Dependencies
├── vercel.json           # Vercel configuration
├── .env.example          # Environment template
└── README.md             # This file
```

## Dependencies

- `telegraf` - Telegram bot framework
- `@libsql/client` - Turso database client
- `dotenv` - Environment variable management

## License

MIT License - feel free to use and modify for your projects.
