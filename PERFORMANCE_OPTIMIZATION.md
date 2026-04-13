# MM Match Bot - Performance Optimization

## Problem Solved
The "Next" button in the like and next feature was slow due to inefficient database queries.

## Optimizations Implemented

### 1. Database Indexes
- Added indexes for faster profile discovery:
  - `idx_users_discovery` on `(is_registered, gender)`
  - `idx_users_looking_for` on `(looking_for)`
  - `idx_users_discovery_composite` on `(is_registered, gender, telegram_id)`
  - `idx_likes_status` on `(likes.status)`

### 2. Profile Views Tracking
- Created `profile_views` table to track which profiles users have seen
- Prevents showing the same profiles repeatedly
- Index on `(user_id, viewed_at)` for fast lookups

### 3. Query Optimization
- **Replaced `ORDER BY RANDOM()`** with `LIMIT 1 OFFSET ?` approach
- Uses count query + random offset for better performance
- Prioritizes unviewed profiles first

### 4. In-Memory Caching
- 5-minute TTL cache for frequently accessed profiles
- Maximum 100 cached profiles to manage memory
- Reduces database calls for repeated requests

### 5. Response Time Improvements
- Added `ctx.answerCbQuery()` for immediate button feedback
- Performance logging to monitor response times
- Better error handling with fallback options

## Performance Gains Expected
- **Query speed**: 70-90% faster profile discovery
- **User experience**: Instant button response
- **Database load**: Reduced by caching and indexing
- **Content quality**: Fewer duplicate profiles shown

## Migration Required
Run the SQL in `performance-migration.sql` on your Turso database:

```sql
-- Add indexes for faster profile discovery
CREATE INDEX IF NOT EXISTS idx_users_discovery ON users(is_registered, gender);
CREATE INDEX IF NOT EXISTS idx_users_looking_for ON users(looking_for);
CREATE INDEX IF NOT EXISTS idx_users_discovery_composite ON users(is_registered, gender, telegram_id);
CREATE INDEX IF NOT EXISTS idx_likes_status ON likes(status);

-- Create profile views tracking
CREATE TABLE IF NOT EXISTS profile_views (
    user_id INTEGER,
    viewed_profile_id INTEGER,
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, viewed_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_views_user ON profile_views(user_id, viewed_at);
```

## Testing
Run `node test-performance-optimized.js` to verify the optimizations are working.

## Key Functions Modified
- `showNextProfile()` - Now uses optimized discovery logic
- `getUnviewedProfile()` - Prioritizes new profiles
- `getRandomProfile()` - Uses offset instead of ORDER BY RANDOM()
- `markProfileAsViewed()` - Tracks viewed profiles
