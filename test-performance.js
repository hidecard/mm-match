// Performance test script for MM Match bot
// This script tests the optimized profile discovery functionality

const { createClient } = require('@libsql/client');

// Test configuration
const TEST_DB_URL = process.env.TURSO_URL;
const TEST_DB_TOKEN = process.env.TURSO_TOKEN;

async function testPerformance() {
    if (!TEST_DB_URL || !TEST_DB_TOKEN) {
        console.log('❌ Missing database credentials. Set TURSO_URL and TURSO_TOKEN environment variables.');
        return;
    }

    const db = createClient({ url: TEST_DB_URL, authToken: TEST_DB_TOKEN });
    
    console.log('🚀 Testing MM Match Performance Optimizations...\n');
    
    // Test 1: Original query vs Optimized query
    console.log('📊 Query Performance Test:');
    
    const testUserId = 12345;
    const lookingFor = 'female';
    
    // Original slow query (ORDER BY RANDOM())
    console.time('Original query (ORDER BY RANDOM())');
    try {
        const originalResult = await db.execute({
            sql: "SELECT * FROM users WHERE is_registered = 1 AND telegram_id != ? AND gender = ? ORDER BY RANDOM() LIMIT 1",
            args: [testUserId, lookingFor]
        });
        console.log(`   ✅ Found ${originalResult.rows.length} profile(s)`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
    console.timeEnd('Original query (ORDER BY RANDOM())');
    
    // Optimized query with LIMIT 20
    console.time('Optimized query (LIMIT 20)');
    try {
        const optimizedResult = await db.execute({
            sql: `SELECT * FROM users 
                  WHERE is_registered = 1 
                  AND telegram_id != ? 
                  AND gender = ? 
                  AND telegram_id NOT IN (
                      SELECT to_user FROM likes WHERE from_user = ?
                  )
                  ORDER BY telegram_id ASC 
                  LIMIT 20`,
            args: [testUserId, lookingFor, testUserId]
        });
        console.log(`   ✅ Found ${optimizedResult.rows.length} profile(s)`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
    console.timeEnd('Optimized query (LIMIT 20)');
    
    // Test 2: Index performance
    console.log('\n📈 Index Performance Test:');
    
    console.time('Query with idx_discovery index');
    try {
        const indexResult = await db.execute({
            sql: "SELECT * FROM users WHERE is_registered = 1 AND gender = ? LIMIT 10",
            args: [lookingFor]
        });
        console.log(`   ✅ Index query found ${indexResult.rows.length} profile(s)`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
    console.timeEnd('Query with idx_discovery index');
    
    // Test 3: Cache simulation
    console.log('\n💾 Cache Simulation Test:');
    
    const cache = new Map();
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    
    // Simulate cache operations
    console.time('Cache operations');
    const profiles = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }));
    
    // Set cache
    cache.set('test_key', {
        profiles,
        timestamp: Date.now()
    });
    
    // Get from cache
    const cached = cache.get('test_key');
    const isValid = cached && Date.now() - cached.timestamp < CACHE_TTL;
    
    console.log(`   ✅ Cache set: ${profiles.length} profiles`);
    console.log(`   ✅ Cache hit: ${isValid ? 'Valid' : 'Expired'}`);
    console.timeEnd('Cache operations');
    
    console.log('\n🎯 Performance Test Summary:');
    console.log('   • Optimized queries should be significantly faster');
    console.log('   • Cache reduces database calls for repeated requests');
    console.log('   • Indexes improve query performance');
    console.log('   • Pre-loading 20 profiles reduces "next" button latency');
    
    await db.close();
}

// Run the test
testPerformance().catch(console.error);
