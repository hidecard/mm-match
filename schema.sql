-- MM Match Dating Bot Database Schema
-- Compatible with Turso (SQLite-based)

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
    is_registered BOOLEAN DEFAULT 0
);

-- Likes table - tracks who likes whom
CREATE TABLE likes (
    from_user INTEGER,
    to_user INTEGER,
    status TEXT DEFAULT 'pending', -- 'pending' or 'accepted'
    PRIMARY KEY (from_user, to_user)
);

-- Index for efficient discovery queries
CREATE INDEX idx_discovery ON users(is_registered, gender, looking_for);
CREATE INDEX idx_interests ON users(interests);
CREATE INDEX idx_mood_status ON users(mood_status);
CREATE INDEX idx_likes_from ON likes(from_user);
CREATE INDEX idx_likes_to ON likes(to_user);

-- Additional performance indexes for optimized queries
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_gender_registered ON users(gender, is_registered);
CREATE INDEX idx_likes_composite ON likes(from_user, to_user);
