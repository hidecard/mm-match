// Debug script for start button issue
import 'dotenv/config';

console.log('=== Environment Variables Check ===');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'SET' : 'MISSING');
console.log('TURSO_URL:', process.env.TURSO_URL ? 'SET' : 'MISSING');
console.log('TURSO_TOKEN:', process.env.TURSO_TOKEN ? 'SET' : 'MISSING');

if (process.env.BOT_TOKEN) {
    console.log('BOT_TOKEN length:', process.env.BOT_TOKEN.length);
    console.log('BOT_TOKEN starts with:', process.env.BOT_TOKEN.substring(0, 10) + '...');
}

console.log('\n=== Testing Database Connection ===');
try {
    const { createClient } = require('@libsql/client');
    const db = createClient({ 
        url: process.env.TURSO_URL, 
        authToken: process.env.TURSO_TOKEN 
    });
    
    console.log('Database client created successfully');
    
    // Test a simple query
    db.execute({ sql: 'SELECT 1 as test' })
        .then(result => {
            console.log('Database query successful:', result.rows);
        })
        .catch(error => {
            console.error('Database query failed:', error.message);
        });
        
} catch (error) {
    console.error('Database connection error:', error.message);
}

console.log('\n=== Testing Bot Initialization ===');
try {
    const { Telegraf } = require('telegraf');
    const bot = new Telegraf(process.env.BOT_TOKEN);
    console.log('Bot initialized successfully');
    
    // Test bot info
    bot.telegram.getMe()
        .then(botInfo => {
            console.log('Bot info:', {
                id: botInfo.id,
                username: botInfo.username,
                first_name: botInfo.first_name
            });
        })
        .catch(error => {
            console.error('Error getting bot info:', error.message);
        });
        
} catch (error) {
    console.error('Bot initialization error:', error.message);
}

console.log('\n=== Checking Common Issues ===');
console.log('1. Make sure BOT_TOKEN is correct and valid');
console.log('2. Make sure TURSO_URL and TURSO_TOKEN are correct');
console.log('3. Check if bot is running on the correct port/webhook');
console.log('4. Verify database schema exists');
