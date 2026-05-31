# In-Bot Anonymous Chat Feature

## Overview
The MM Match bot now supports in-bot anonymous chat, allowing users to communicate securely without revealing their Telegram handles immediately. This feature is especially important for privacy and digital safety in Myanmar.

## How It Works

### 1. Mutual Match Event
When User A likes User B and there's a mutual like:
- The bot inserts a record into the `matches` table
- Both users receive a match notification with a "💬 စကားပြောမည် (Chat)" button
- No Telegram usernames are revealed initially

### 2. Entering Chat Session
When a user clicks the Chat button:
- The bot creates a chat session record in `chat_sessions`
- The user's step is set to `chat_mode`
- A custom keyboard appears with chat controls
- Users can send text, photos, voice messages, and stickers

### 3. Proxy Message Routing
While in chat mode:
- All messages are intercepted by the bot
- Messages are forwarded anonymously to the matched user
- Senders see a "✅ ပို့ပြီးပါပြီ" (delivered) confirmation
- No personal information is revealed during the chat

### 4. Identity Reveal
Either user can request to reveal their identity:
- Click "🔓 လျှို့ဝှက်ချက်ဖွင့်ပြမည်" (Reveal Identity)
- The partner receives a request with accept/reject options
- If accepted, both users receive each other's Telegram handles
- The match is marked as revealed in the database

### 5. Leaving Chat
Users can leave the chat at any time:
- Click "❌ Chat မှထွက်မည်" (Leave Chat)
- Chat session is deleted
- User returns to normal mode
- Partner can continue using the bot normally

### 6. Report/Block
Users can report inappropriate behavior:
- Click "🚨 Report / Block"
- Select report reason (Fake Profile, Spam, Inappropriate)
- Report is logged in the database for admin review
- Chat session is terminated

## Database Schema

### Matches Table
```sql
CREATE TABLE matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_one INTEGER NOT NULL, -- Lower Telegram ID
    user_two INTEGER NOT NULL, -- Higher Telegram ID
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_revealed BOOLEAN DEFAULT 0, -- 1 if usernames are mutually shared
    UNIQUE(user_one, user_two)
);
```

### Chat Sessions Table
```sql
CREATE TABLE chat_sessions (
    user_id INTEGER PRIMARY KEY, -- The user currently in chat mode
    matched_user_id INTEGER NOT NULL, -- The user they are talking to
    match_id INTEGER NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
);
```

## User Interface (Burmese)

### Match Notification
```
🎉 Match ဖြစ်သွားပါပြီ! ❤️

👤 [Partner_Nickname] နဲ့ သင်နဲ့ စိတ်ချင်းတူသွားပါပြီ။
မိမိရဲ့ Telegram ID အစစ်အမှန်ကို မသိစေဘဲ ဘော့ခ်ျထဲမှာပဲ လုံခြုံစွာ အရင်ဆုံး စကားပြောကြည့်လိုက်ပါ!

[💬 စကားပြောမည်] [➡️ ဆက်ရှာမည်]
```

### Active Chat Mode
```
💬 [Partner_Nickname] နှင့် အမည်ဝှက် စကားပြောနေပါသည်။
(စာသား၊ ပုံ၊ အသံဖိုင်များ ပေးပို့နိုင်ပါသည်။)
--------------------------------------
[🔓 လျှို့ဝှက်ချက်ဖွင့်ပြမည်] [🚨 Report / Block]
[❌ Chat မှထွက်မည်]
```

### Identity Reveal Request
```
🔓 [Nickname] မှ သူ့ရဲ့ Telegram Username ကို ပြသရန် ခွင့်ပြုချက်တောင်းခံနေပါသည်။ 
သင်ကော ပြသရန် သဘောတူပါသလား?

[👍 သဘောတူသည်] [👎 ငြင်းပယ်မည်]
```

## Privacy & Safety Features

### Anonymity
- No personal information revealed during initial chat
- Users control when to share their identity
- Telegram handles are only shared with mutual consent

### Reporting
- Easy reporting of inappropriate behavior
- Reports logged for admin review
- Chat session terminated on report

### Session Management
- Chat sessions are temporary and can be ended anytime
- Users can return to normal bot mode instantly
- No persistent connection between users

## Migration

To add the anonymous chat feature to an existing database:

```bash
# Apply chat migration
turso db shell your-db-name < chat-migration.sql
```

This will create the necessary tables and indexes for anonymous chat functionality.

## Benefits

### For Users
- **Privacy First**: Chat anonymously before sharing personal information
- **Safety**: Report/block inappropriate behavior easily
- **Control**: Choose when to reveal identity
- **Flexibility**: Leave chat anytime without consequences

### For Platform
- **Higher Engagement**: Users more likely to register and swipe
- **Trust**: Privacy-focused approach builds user confidence
- **Safety**: Built-in reporting and moderation tools
- **Scalable**: Serverless architecture handles thousands of concurrent chats
