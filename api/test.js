import { Telegraf } from 'telegraf';
import 'dotenv/config';

console.log('Environment variables check:');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'SET' : 'MISSING');
console.log('TURSO_URL:', process.env.TURSO_URL ? 'SET' : 'MISSING');
console.log('TURSO_TOKEN:', process.env.TURSO_TOKEN ? 'SET' : 'MISSING');

export default async (req, res) => {
    if (req.method === 'POST') {
        return res.status(200).json({ ok: true });
    }
    res.status(200).send("Environment check - Check Vercel logs");
};
