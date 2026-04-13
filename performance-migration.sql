-- Performance Optimization Migration for MM Match Bot
-- This script adds indexes and optimizations for faster profile discovery

-- Add indexes for faster profile discovery
CREATE INDEX IF NOT EXISTS idx_users_discovery ON users(is_registered, gender);
CREATE INDEX IF NOT EXISTS idx_users_looking_for ON users(looking_for);

-- Add composite index for the main discovery query
CREATE INDEX IF NOT EXISTS idx_users_discovery_composite ON users(is_registered, gender, telegram_id);

-- Add index for likes table to optimize match queries
CREATE INDEX IF NOT EXISTS idx_likes_status ON likes(status);

-- Create a table to track viewed profiles for better discovery
CREATE TABLE IF NOT EXISTS profile_views (
    user_id INTEGER,
    viewed_profile_id INTEGER,
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, viewed_profile_id)
);

-- Create index for profile views
CREATE INDEX IF NOT EXISTS idx_profile_views_user ON profile_views(user_id, viewed_at);
