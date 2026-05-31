-- Daily Sparks Feature Migration for MM Match
-- Run these queries to add daily spark fields to existing database

-- 1. Add daily spark columns to users table
ALTER TABLE users ADD COLUMN daily_spark TEXT;
ALTER TABLE users ADD COLUMN spark_expires_at DATETIME;

-- 2. Create index for efficient spark expiration queries
CREATE INDEX IF NOT EXISTS idx_spark_expires ON users(spark_expires_at) WHERE daily_spark IS NOT NULL;

-- 3. Verify the migration
SELECT 
    telegram_id,
    nickname,
    daily_spark,
    spark_expires_at
FROM users
WHERE daily_spark IS NOT NULL
LIMIT 5;

-- Note: Sparks will automatically expire when checked during profile display
-- No cron job needed - expiration is checked on read
