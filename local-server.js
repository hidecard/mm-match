import express from 'express';
import { createClient } from '@libsql/client';
import 'dotenv/config';

const app = express();
const port = 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'hidecard';

// Database connection
const db = createClient({ 
    url: process.env.TURSO_URL, 
    authToken: process.env.TURSO_TOKEN 
});

app.use(express.json());

// CORS headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Password');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Password check middleware
const checkPassword = (req, res, next) => {
    const url = req.url;
    if (!url.includes('/api/check-auth')) {
        const password = req.headers['x-password'] || req.query?.password;
        if (password !== DASHBOARD_PASSWORD) {
            return res.status(401).json({ error: 'Unauthorized - Invalid password' });
        }
    }
    next();
};

app.use(checkPassword);

// API: Check auth
app.get('/api/check-auth', (req, res) => {
    const password = req.headers['x-password'] || req.query?.password;
    if (password === DASHBOARD_PASSWORD) {
        return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: 'Invalid password' });
});

// API: Stats
app.get('/api/stats', async (req, res) => {
    try {
        const totalResult = await db.execute({
            sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1",
            args: []
        });
        const totalUsers = totalResult.rows[0]?.count || 0;
        
        const matchesResult = await db.execute({
            sql: "SELECT COUNT(*) as count FROM likes l WHERE EXISTS (SELECT 1 FROM likes l2 WHERE l2.from_user = l.to_user AND l2.to_user = l.from_user)",
            args: []
        });
        const totalMatches = Math.floor((matchesResult.rows[0]?.count || 0) / 2);
        
        res.json({ totalUsers, todayMatches: totalMatches, lastUpdated: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Users
app.get('/api/users', async (req, res) => {
    try {
        const usersResult = await db.execute({
            sql: "SELECT telegram_id, nickname, age, gender, looking_for, address, is_registered FROM users LIMIT 50",
            args: []
        });
        
        const countResult = await db.execute({
            sql: "SELECT COUNT(*) as count FROM users WHERE is_registered = 1",
            args: []
        });
        
        res.json({ users: usersResult.rows || [], total: countResult.rows[0]?.count || 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Banned users
app.get('/api/banned-users', async (req, res) => {
    try {
        const bannedResult = await db.execute({
            sql: "SELECT telegram_id, nickname, is_banned, is_shadowbanned, ban_reason, banned_at FROM users WHERE is_banned = 1 OR is_shadowbanned = 1 ORDER BY banned_at DESC",
            args: []
        });
        
        res.json({ bannedUsers: bannedResult.rows || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Reports
app.get('/api/reports', async (req, res) => {
    try {
        const reportsResult = await db.execute({
            sql: `SELECT r.*, 
                  reporter.nickname as reporter_name, 
                  reported.nickname as reported_name 
                  FROM reports r 
                  LEFT JOIN users reporter ON r.reporter_id = reporter.telegram_id 
                  LEFT JOIN users reported ON r.reported_user_id = reported.telegram_id 
                  ORDER BY r.created_at DESC LIMIT 100`,
            args: []
        });
        
        res.json({ reports: reportsResult.rows || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Ban user
app.post('/api/ban', async (req, res) => {
    try {
        const { userId, action, reason } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }
        
        if (action === 'ban') {
            await db.execute({
                sql: "UPDATE users SET is_banned = 1, is_shadowbanned = 0, ban_reason = ?, banned_at = CURRENT_TIMESTAMP, banned_by = ? WHERE telegram_id = ?",
                args: [reason || 'Violation of terms', 0, userId]
            });
            res.json({ success: true, message: 'User banned' });
        } else if (action === 'unban') {
            await db.execute({
                sql: "UPDATE users SET is_banned = 0, is_shadowbanned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE telegram_id = ?",
                args: [userId]
            });
            res.json({ success: true, message: 'User unbanned' });
        } else if (action === 'shadowban') {
            await db.execute({
                sql: "UPDATE users SET is_banned = 0, is_shadowbanned = 1, ban_reason = ?, banned_at = CURRENT_TIMESTAMP, banned_by = ? WHERE telegram_id = ?",
                args: [reason || 'Shadowban', 0, userId]
            });
            res.json({ success: true, message: 'User shadowbanned' });
        } else if (action === 'unshadowban') {
            await db.execute({
                sql: "UPDATE users SET is_shadowbanned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE telegram_id = ?",
                args: [userId]
            });
            res.json({ success: true, message: 'User unshadowbanned' });
        } else {
            res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Review report
app.post('/api/review-report', async (req, res) => {
    try {
        const { reportId, action, actionTaken } = req.body;
        
        if (!reportId || !action) {
            return res.status(400).json({ error: 'Report ID and action required' });
        }
        
        await db.execute({
            sql: "UPDATE reports SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, action_taken = ? WHERE id = ?",
            args: [action, 0, actionTaken || 'no_action', reportId]
        });
        
        res.json({ success: true, message: 'Report reviewed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve dashboard HTML
app.get('/', (req, res) => {
    // Import the dashboard HTML from the main file
    import('./api/index.js').then(module => {
        // The dashboard HTML is exported as dashboardHTML constant
        // Since it's in the same file, we need to read it
        res.setHeader('Content-Type', 'text/html');
        res.send(module.default ? 'Dashboard not available in local mode' : 'Dashboard not available');
    }).catch(() => {
        res.send('Dashboard not available - please use the main bot file');
    });
});

app.listen(port, () => {
    console.log(`Local dashboard server running at http://localhost:${port}`);
    console.log(`Dashboard password: ${DASHBOARD_PASSWORD}`);
});
