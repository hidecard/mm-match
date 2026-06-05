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
    max_distance_km INTEGER DEFAULT 50, -- Maximum distance for matches in km
    daily_spark TEXT, -- Daily spark status with emoji (24-hour temporary status)
    spark_expires_at DATETIME -- Timestamp when spark expires
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
CREATE INDEX idx_location ON users(latitude, longitude) WHERE is_registered = 1;
CREATE INDEX idx_max_distance ON users(max_distance_km) WHERE is_registered = 1;

-- Anonymous Chat Feature Tables

-- Track the state of a match
CREATE TABLE matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_one INTEGER NOT NULL, -- Lower Telegram ID
    user_two INTEGER NOT NULL, -- Higher Telegram ID
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_revealed BOOLEAN DEFAULT 0, -- 1 if usernames are mutually shared
    UNIQUE(user_one, user_two)
);

-- Track who is actively chatting with whom right now
CREATE TABLE chat_sessions (
    user_id INTEGER PRIMARY KEY, -- The user currently in chat mode
    matched_user_id INTEGER NOT NULL, -- The user they are talking to
    match_id INTEGER NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
);

-- Indexes for anonymous chat feature
CREATE INDEX idx_matches_user_one ON matches(user_one);
CREATE INDEX idx_matches_user_two ON matches(user_two);
CREATE INDEX idx_matches_created ON matches(created_at);
CREATE INDEX idx_chat_sessions_matched ON chat_sessions(matched_user_id);

-- Analytics Tables for Retention, DAU, and Swipe Activity

-- User activity sessions - tracks when users are active for retention analysis
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_date DATE NOT NULL,
    first_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    activities_count INTEGER DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(telegram_id)
);

-- Swipe activity tracking - enhanced likes table with timestamp
ALTER TABLE likes ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_date ON user_sessions(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_user_sessions_date ON user_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_likes_created_at ON likes(created_at);
CREATE INDEX IF NOT EXISTS idx_likes_from_created ON likes(from_user, created_at);
CREATE INDEX IF NOT EXISTS idx_profile_views_date ON profile_views(viewed_at);

-- Group Dating / Double Dating Tables

-- Groups table - stores dating groups
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    bio TEXT,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    max_members INTEGER DEFAULT 2,
    FOREIGN KEY(created_by) REFERENCES users(telegram_id)
);

-- Group members table - tracks users in each group
CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_leader BOOLEAN DEFAULT 0,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(telegram_id),
    UNIQUE(group_id, user_id)
);

-- Group likes table - tracks when groups like other groups
CREATE TABLE IF NOT EXISTS group_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_group_id INTEGER NOT NULL,
    to_group_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(from_group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(to_group_id) REFERENCES groups(id) ON DELETE CASCADE,
    UNIQUE(from_group_id, to_group_id)
);

-- Group matches table - tracks mutual group matches
CREATE TABLE IF NOT EXISTS group_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_one_id INTEGER NOT NULL,
    group_two_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(group_one_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(group_two_id) REFERENCES groups(id) ON DELETE CASCADE,
    UNIQUE(group_one_id, group_two_id)
);

-- Group chat sessions - tracks active group chats
CREATE TABLE IF NOT EXISTS group_chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_match_id INTEGER NOT NULL,
    group_one_id INTEGER NOT NULL,
    group_two_id INTEGER NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(group_match_id) REFERENCES group_matches(id) ON DELETE CASCADE,
    FOREIGN KEY(group_one_id) REFERENCES groups(id),
    FOREIGN KEY(group_two_id) REFERENCES groups(id)
);

-- Indexes for group queries
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);
CREATE INDEX IF NOT EXISTS idx_groups_active ON groups(is_active);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_likes_from ON group_likes(from_group_id);
CREATE INDEX IF NOT EXISTS idx_group_likes_to ON group_likes(to_group_id);
CREATE INDEX IF NOT EXISTS idx_group_matches_one ON group_matches(group_one_id);
CREATE INDEX IF NOT EXISTS idx_group_matches_two ON group_matches(group_two_id);
