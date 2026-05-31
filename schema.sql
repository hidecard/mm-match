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
    is_registered BOOLEAN DEFAULT 0,
    latitude REAL, -- User's location latitude
    longitude REAL, -- User's location longitude
    max_distance_km INTEGER DEFAULT 50 -- Maximum distance for matches in km
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

-- Ban status fields for users
ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT 0;
ALTER TABLE users ADD COLUMN is_shadowbanned BOOLEAN DEFAULT 0;
ALTER TABLE users ADD COLUMN ban_reason TEXT;
ALTER TABLE users ADD COLUMN banned_at DATETIME;
ALTER TABLE users ADD COLUMN banned_by INTEGER; -- Admin telegram_id who banned the user

-- Reports table - tracks user reports for trust & safety
CREATE TABLE IF NOT EXISTS reports (
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

-- Index for efficient discovery queries
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
