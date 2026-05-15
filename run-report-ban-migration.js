import { createClient } from '@libsql/client';
import 'dotenv/config';

const db = createClient({ 
    url: process.env.TURSO_URL, 
    authToken: process.env.TURSO_TOKEN 
});

async function runMigration() {
    console.log('Starting Report & Ban System migration...');
    
    try {
        // Add ban status fields to users table
        console.log('Adding ban status fields to users table...');
        await db.execute("ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT 0");
        await db.execute("ALTER TABLE users ADD COLUMN is_shadowbanned BOOLEAN DEFAULT 0");
        await db.execute("ALTER TABLE users ADD COLUMN ban_reason TEXT");
        await db.execute("ALTER TABLE users ADD COLUMN banned_at DATETIME");
        await db.execute("ALTER TABLE users ADD COLUMN banned_by INTEGER");
        console.log('✓ Ban status fields added');
        
        // Create reports table
        console.log('Creating reports table...');
        await db.execute(`
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
            )
        `);
        console.log('✓ Reports table created');
        
        // Create indexes
        console.log('Creating indexes...');
        await db.execute("CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_user_id, status)");
        await db.execute("CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id)");
        await db.execute("CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)");
        await db.execute("CREATE INDEX IF NOT EXISTS idx_users_banned ON users(is_banned)");
        await db.execute("CREATE INDEX IF NOT EXISTS idx_users_shadowbanned ON users(is_shadowbanned)");
        console.log('✓ Indexes created');
        
        console.log('\n✅ Migration completed successfully!');
    } catch (error) {
        if (error.message.includes('duplicate column')) {
            console.log('⚠️  Some columns already exist, skipping...');
            console.log('✅ Migration completed (partial - some fields already exist)');
        } else {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        }
    }
}

runMigration().then(() => process.exit(0));
