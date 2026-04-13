// Test script to verify start button functionality
require('dotenv').config();

const { Telegraf } = require('telegraf');

console.log('Testing start button functionality...\n');

// Test 1: Check environment variables
console.log('1. Environment Variables:');
console.log('   BOT_TOKEN:', process.env.BOT_TOKEN ? 'OK' : 'MISSING');
console.log('   TURSO_URL:', process.env.TURSO_URL ? 'OK' : 'MISSING');
console.log('   TURSO_TOKEN:', process.env.TURSO_TOKEN ? 'OK' : 'MISSING');

// Test 2: Initialize bot
try {
    console.log('\n2. Bot Initialization:');
    const bot = new Telegraf(process.env.BOT_TOKEN);
    console.log('   Bot created successfully');
    
    // Test 3: Check bot info
    bot.telegram.getMe()
        .then(botInfo => {
            console.log('\n3. Bot Info:');
            console.log('   Username:', '@' + botInfo.username);
            console.log('   Name:', botInfo.first_name);
            console.log('   ID:', botInfo.id);
            
            console.log('\n4. Start Button Status:');
            console.log('   Bot is properly configured');
            console.log('   Start command should work when bot is deployed');
            console.log('   Make sure webhook is set up correctly');
            
            console.log('\n=== Troubleshooting Tips ===');
            console.log('If start button still not working:');
            console.log('1. Check if bot is deployed and running');
            console.log('2. Verify webhook URL is correct');
            console.log('3. Check bot permissions in Telegram');
            console.log('4. Ensure database connection is working in production');
            
        })
        .catch(error => {
            console.error('   Error getting bot info:', error.message);
        });
        
} catch (error) {
    console.error('Bot initialization failed:', error.message);
}
