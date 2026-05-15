-- Migration: Report System and Ban System
-- This migration adds support for user reporting and admin ban functionality

-- Add ban status fields to users table
ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT 0;
ALTER TABLE users ADD COLUMN is_shadowbanned BOOLEAN DEFAULT 0;
ALTER TABLE users ADD COLUMN ban_reason TEXT;
ALTER TABLE users ADD COLUMN banned_at DATETIME;
ALTER TABLE users ADD COLUMN banned_by INTEGER;

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    reported_user_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    reviewed_by INTEGER,
    action_taken TEXT,
    FOREIGN KEY (reporter_id) REFERENCES users(telegram_id),
    FOREIGN KEY (reported_user_id) REFERENCES users(telegram_id)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_user_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(is_banned);
CREATE INDEX IF NOT EXISTS idx_users_shadowbanned ON users(is_shadowbanned);
