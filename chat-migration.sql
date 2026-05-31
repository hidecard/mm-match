-- Anonymous Chat Feature Migration for MM Match
-- Run these queries to add anonymous chat tables to existing database

-- 1. Create matches table to track the state of a match
CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_one INTEGER NOT NULL, -- Lower Telegram ID
    user_two INTEGER NOT NULL, -- Higher Telegram ID
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_revealed BOOLEAN DEFAULT 0, -- 1 if usernames are mutually shared
    UNIQUE(user_one, user_two)
);

-- 2. Create chat_sessions table to track who is actively chatting with whom
CREATE TABLE IF NOT EXISTS chat_sessions (
    user_id INTEGER PRIMARY KEY, -- The user currently in chat mode
    matched_user_id INTEGER NOT NULL, -- The user they are talking to
    match_id INTEGER NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
);

-- 3. Create indexes for anonymous chat feature
CREATE INDEX IF NOT EXISTS idx_matches_user_one ON matches(user_one);
CREATE INDEX IF NOT EXISTS idx_matches_user_two ON matches(user_two);
CREATE INDEX IF NOT EXISTS idx_matches_created ON matches(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_matched ON chat_sessions(matched_user_id);

-- 4. Verify the migration
SELECT 
    m.id,
    m.user_one,
    m.user_two,
    m.created_at,
    m.is_revealed,
    cs.user_id as chat_user_id,
    cs.matched_user_id,
    cs.started_at
FROM matches m
LEFT JOIN chat_sessions cs ON m.id = cs.match_id
LIMIT 5;

-- Note: For SQLite/Turso, the BOOLEAN type will be stored as INTEGER (0 or 1)
