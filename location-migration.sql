-- Location-based matching migration for MM Match
-- Run these queries to add location fields to existing users table

-- 1. Add location columns to users table
ALTER TABLE users ADD COLUMN latitude REAL;
ALTER TABLE users ADD COLUMN longitude REAL;
ALTER TABLE users ADD COLUMN max_distance_km INTEGER DEFAULT 50;

-- 2. Create location-based indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_location ON users(latitude, longitude) WHERE is_registered = 1;
CREATE INDEX IF NOT EXISTS idx_max_distance ON users(max_distance_km) WHERE is_registered = 1;

-- 3. Set default search radius for existing users
UPDATE users SET max_distance_km = 50 WHERE is_registered = 1 AND max_distance_km IS NULL;

-- 4. Verify the migration
SELECT
    telegram_id,
    nickname,
    latitude,
    longitude,
    max_distance_km
FROM users
WHERE is_registered = 1
LIMIT 5;
