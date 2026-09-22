const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

// সরাসরি কোডের ভেতরে ডাটাবেজ কনফিগারেশন সেট করা হলো (কোনো .env লাগবে না)
const dbConfig = {
    host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
    port: 14363,
    user: 'avnadmin',
    password: 'AVNS_hhfXItvXPam49_lMnOU',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// স্ট্যাটিক ফাইল সার্ভ করার জন্য (index.html, admin.html ইত্যাদি)
app.use(express.static(path.join(__dirname, '/')));

// ১. গেট ইউজার এপিআই (আগের get-user.js এর কাজ)
app.get('/api/get-user', async (req, res) => {
    const tgId = req.query.tg_id;
    if (!tgId) {
        return res.status(400).json({ success: false, message: 'Telegram ID is missing.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User account not found. Please start the bot first.' });
        }

        const user = rows[0];
        if (user.telegram_verified !== 'verified') {
            return res.status(403).json({ success: false, message: 'Please join our channel and group, then verify your account via the bot.' });
        }

        res.json({ success: true, user });
    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    } finally {
        if (connection) await connection.end();
    }
});

// ২. মেইন এপিআই রাউট (আগের api.js এর কাজ - রেফারেল এবং অ্যাডমিন ডাটা ম্যানেজমেন্ট)
app.all('/api/action', async (req, res) => {
    const method = req.method;
    if (method !== 'POST' && method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const body = req.method === 'POST' ? req.body : req.query;
    const action = body.action;
    const tgId = body.tg_id;

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let responseData = { success: false, message: 'Invalid Action' };

        if (action === 'get_user') {
            if (!tgId) return res.status(400).json({ success: false, message: 'Telegram ID is required' });
            const [users] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
            if (users.length > 0) responseData = { success: true, user: users[0] };
            else responseData = { success: false, message: 'User not found' };
        } 
        else if (action === 'get_admin_data') {
            if (!tgId) return res.status(400).json({ success: false, message: 'Telegram ID is required' });
            const [users] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
            if (users.length === 0 || users[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
            }

            let settings = { referral_percentage: 5.00, referral_notice: '' };
            try {
                const [settingsRows] = await connection.execute('SELECT referral_percentage, referral_notice FROM settings WHERE id = 1');
                if (settingsRows.length > 0) settings = settingsRows[0];
            } catch (err) {
                console.log('Settings table fetch note: Using default values.');
            }

            responseData = { success: true, user: users[0], settings: settings };
        } 
        else if (action === 'update_referral_settings') {
            const { referral_percentage, referral_notice } = body;
            if (!tgId) return res.status(400).json({ success: false, message: 'Telegram ID is required' });

            const [adminCheck] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [tgId]);
            if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized access' });
            }

            await connection.execute(
                'UPDATE settings SET referral_percentage = ?, referral_notice = ? WHERE id = 1',
                [referral_percentage, referral_notice]
            );

            responseData = { success: true, message: 'Referral settings updated successfully' };
        }

        if (connection) await connection.end();
        res.json(responseData);

    } catch (error) {
        console.error('API Error:', error);
        if (connection) await connection.end();
        res.status(500).json({ success: false, message: error.message });
    }
});

// সেলফ-পিং (Self-Ping) মেকানিজম যাতে রেন্ডার সার্ভার ২৪ ঘণ্টা লাইভ থাকে এবং ঘুমিয়ে না পড়ে
setInterval(() => {
    const appUrl = process.env.RENDER_EXTERNAL_URL;
    if (appUrl) {
        // প্রতি ১৪ মিনিট পর পর নিজের সার্ভারেই রিকোয়েস্ট পাঠাবে
        fetch(`${appUrl}/api/get-user?tg_id=ping`).catch(() => {});
    }
}, 14 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
        
