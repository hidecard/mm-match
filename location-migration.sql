-- Location-based matching migration for MM Match
-- Run these queries to add location fields to existing users table

-- 1. Add location columns to users table
ALTER TABLE users ADD COLUMN latitude REAL;
ALTER TABLE users ADD COLUMN longitude REAL;
ALTER TABLE users ADD COLUMN location_radius INTEGER DEFAULT 50;
ALTER TABLE users ADD COLUMN location_sharing BOOLEAN DEFAULT 1;
ALTER TABLE users ADD COLUMN last_location_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 2. Create location-based indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_location ON users(latitude, longitude) WHERE location_sharing = 1 AND is_registered = 1;
CREATE INDEX IF NOT EXISTS idx_location_radius ON users(location_sharing, location_radius) WHERE is_registered = 1;

-- 3. Update existing registered users to have default location sharing enabled
UPDATE users SET location_sharing = 1 WHERE is_registered = 1 AND location_sharing IS NULL;

-- 4. Set default search radius for existing users
UPDATE users SET location_radius = 50 WHERE is_registered = 1 AND location_radius IS NULL;

-- 5. Verify the migration
SELECT 
    telegram_id,
    nickname,
    latitude,
    longitude,
    location_radius,
    location_sharing,
    last_location_update
FROM users 
WHERE is_registered = 1
LIMIT 5;

-- Note: For SQLite/Turso, the BOOLEAN type will be stored as INTEGER (0 or 1)
-- The last_location_update will use SQLite's CURRENT_TIMESTAMP function
