// Performance test for optimized MM Match Bot
import { createClient } from '@libsql/client';
import 'dotenv/config';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });

async function testPerformance() {
    console.log('Testing optimized performance...\n');
    
    // Test 1: Check if indexes exist
    try {
        const indexes = await db.execute(`
            SELECT name FROM sqlite_master 
            WHERE type='index' AND name LIKE 'idx_%'
        `);
        
        console.log('Available indexes:');
        indexes.rows.forEach(index => {
            console.log(`  - ${index.name}`);
        });
        console.log();
    } catch (error) {
        console.log('Error checking indexes:', error.message);
    }
    
    // Test 2: Check if profile_views table exists
    try {
        const tables = await db.execute(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='profile_views'
        `);
        
        if (tables.rows.length > 0) {
            console.log('profile_views table exists - optimization enabled!');
        } else {
            console.log('profile_views table missing - please run migration');
        }
        console.log();
    } catch (error) {
        console.log('Error checking tables:', error.message);
    }
    
    // Test 3: Simulate profile discovery performance
    try {
        const testUserId = 12345; // Test user ID
        const lookingFor = 'female';
        
        console.log('Testing profile discovery performance...');
        
        const startTime = Date.now();
        
        // Test the optimized query
        const result = await db.execute({
            sql: `
                SELECT u.* FROM users u 
                LEFT JOIN profile_views pv ON u.telegram_id = pv.viewed_profile_id AND pv.user_id = ?
                WHERE u.is_registered = 1 
                AND u.telegram_id != ? 
                AND u.gender = ? 
                AND pv.viewed_profile_id IS NULL
                ORDER BY u.telegram_id 
                LIMIT 10
            `,
            args: [testUserId, testUserId, lookingFor]
        });
        
        const endTime = Date.now();
        const queryTime = endTime - startTime;
        
        console.log(`Query executed in ${queryTime}ms`);
        console.log(`Found ${result.rows.length} potential profiles`);
        
        if (result.rows.length > 0) {
            console.log('Sample profile:', {
                telegram_id: result.rows[0].telegram_id,
                nickname: result.rows[0].nickname,
                age: result.rows[0].age
            });
        }
        
    } catch (error) {
        console.log('Error testing performance:', error.message);
    }
    
    console.log('\nPerformance test completed!');
}

testPerformance().catch(console.error);
