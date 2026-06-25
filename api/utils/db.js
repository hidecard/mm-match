import { createClient } from '@libsql/client';
import 'dotenv/config';

let db;
try {
    db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
} catch (error) {
    console.error('Database connection error:', error);
}

export const getDb = () => db;

export const getUser = async (id) => {
    try {
        if (!db) return null;
        const result = await db.execute({ sql: "SELECT * FROM users WHERE telegram_id = ?", args: [id] });
        return result.rows[0];
    } catch (error) {
        console.error('Error in getUser:', error);
        return null;
    }
};

export const migrateLocationSchema = async () => {
    if (!db) return;
    const migrations = [
        { sql: 'ALTER TABLE users ADD COLUMN latitude REAL', name: 'latitude' },
        { sql: 'ALTER TABLE users ADD COLUMN longitude REAL', name: 'longitude' },
        { sql: 'ALTER TABLE users ADD COLUMN interests TEXT', name: 'interests' }
    ];
    for (const migration of migrations) {
        try {
            await db.execute({ sql: migration.sql });
        } catch (error) {
            if (!/duplicate column|already exists/i.test(error.message)) {
                console.error(`Migration error (${migration.name}):`, error);
            }
        }
    }
    try {
        await db.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_location ON users(latitude, longitude) WHERE is_registered = 1 AND is_banned = 0 AND is_shadowbanned = 0' });
        await db.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_gender_registered ON users(gender, is_registered, is_banned, is_shadowbanned)' });
        await db.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_profile_views_user ON profile_views(user_id, viewed_profile_id)' });
        await db.execute({ sql: 'CREATE INDEX IF NOT EXISTS idx_likes_from ON likes(from_user, to_user)' });
    } catch (e) {}
};
