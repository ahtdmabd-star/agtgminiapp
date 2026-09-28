const express = require('express');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

module.exports = function (dbConfig) {
    const router = express.Router();

    // ডাটাবেজ হেলপার ফাংশন
    async function getConnection() {
        return await mysql.createConnection(dbConfig);
    }

    // টেবিল অটো-ক্রিয়েশন (সার্ভার চালু হলেই অটোমেটিক তৈরি হবে)
    async function initTables() {
        let conn;
        try {
            conn = await getConnection();
            
            // ১. ইউজার টাস্ক ডাটা টেবিল
            await conn.query(`
                CREATE TABLE IF NOT EXISTS ad_task_users (
                    user_id VARCHAR(100) PRIMARY KEY,
                    coins INT DEFAULT 0,
                    completed_tasks INT DEFAULT 0,
                    incomplete_tasks INT DEFAULT 0,
                    daily_completed_tasks INT DEFAULT 0,
                    last_ad_time DATETIME NULL
                )
            `);

            // ২. অ্যাডমিন অ্যাড সেটিংস টেবিল
            await conn.query(`
                CREATE TABLE IF NOT EXISTS ad_settings (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    task_reward_coins INT DEFAULT 100,
                    coins_per_usd INT DEFAULT 10000,
                    min_convert_coins INT DEFAULT 1000
                )
            `);

            // ডিফল্ট সেটিংস ইনসার্ট
            const [rows] = await conn.query(`SELECT * FROM ad_settings WHERE id = 1`);
            if (rows.length === 0) {
                await conn.query(`INSERT INTO ad_settings (id, task_reward_coins, coins_per_usd, min_convert_coins) VALUES (1, 100, 10000, 1000)`);
            }
        } catch (err) {
            console.error("Ad Task DB Init Error:", err);
        } finally {
            if (conn) await conn.end();
        }
    }
    initTables();

    // Adsgram Secret Key
    const ADSGRAM_SECRET = process.env.ADSGRAM_SECRET || "YOUR_ADSGRAM_SECRET_KEY";

    /**
     * ১. Adsgram Webhook
     * URL: https://agtgminiapp.onrender.com/api/ads/reward-callback?userId=[userId]
     */
    router.get('/reward-callback', async (req, res) => {
        let conn;
        try {
            // ছোট হাতের (userid) এবং বড় হাতের (userId) দুটিই সাপোর্ট করবে
            const telegramUserId = req.query.userId || req.query.userid;
            const { hash, ...params } = req.query;

            if (!telegramUserId) return res.status(400).send("User ID missing");

            // --- Signature Verification (সিকিউরিটি চেক) ---
            if (hash) {
                const checkString = Object.keys(params)
                    .sort()
                    .map(key => `${key}=${params[key]}`)
                    .join('\n');
                
                const secretKey = crypto.createHash('sha256').update(ADSGRAM_SECRET).digest();
                const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

                if (hmac !== hash) {
                    return res.status(403).send("Unauthorized Request");
                }
            }

            conn = await getConnection();

            // সেটিংস থেকে রিওয়ার্ড কয়েন পড়া
            const [settings] = await conn.query(`SELECT task_reward_coins FROM ad_settings WHERE id = 1`);
            const rewardCoins = settings[0]?.task_reward_coins || 100;

            // ইউজার ডাটা চেক করা
            const [users] = await conn.query(`SELECT * FROM ad_task_users WHERE user_id = ?`, [telegramUserId]);
            const now = new Date();

            if (users.length === 0) {
                // নতুন ইউজার রেকর্ড
                await conn.query(`
                    INSERT INTO ad_task_users (user_id, coins, completed_tasks, daily_completed_tasks, last_ad_time)
                    VALUES (?, ?, 1, 1, ?)
                `, [telegramUserId, rewardCoins, now]);
            } else {
                // ২৪ ঘন্টার হিসাব ও আপডেট
                const user = users[0];
                const lastTime = user.last_ad_time ? new Date(user.last_ad_time) : new Date(0);
                const hoursPassed = (now - lastTime) / (1000 * 60 * 60);

                let newDaily = hoursPassed >= 24 ? 1 : user.daily_completed_tasks + 1;

                await conn.query(`
                    UPDATE ad_task_users 
                    SET coins = coins + ?, 
                        completed_tasks = completed_tasks + 1, 
                        daily_completed_tasks = ?, 
                        last_ad_time = ?
                    WHERE user_id = ?
                `, [rewardCoins, newDaily, now, telegramUserId]);
            }

            console.log(`[Adsgram] ${rewardCoins} coins credited to User ${telegramUserId}`);
            return res.status(200).send("OK");

        } catch (error) {
            console.error("Adsgram Callback Error:", error);
            return res.status(500).send("Server Error");
        } finally {
            if (conn) await conn.end();
        }
    });

    /**
     * ২. অসম্পূর্ণ অ্যাড ট্র্যাকিং API
     */
    router.post('/track-incomplete', async (req, res) => {
        let conn;
        try {
            const userId = req.body.userId || req.body.userid;
            if (!userId) return res.status(400).json({ success: false, message: "userId required" });

            conn = await getConnection();
            await conn.query(`
                INSERT INTO ad_task_users (user_id, incomplete_tasks)
                VALUES (?, 1)
                ON DUPLICATE KEY UPDATE incomplete_tasks = incomplete_tasks + 1
            `, [userId]);

            return res.json({ success: true, message: "Incomplete task tracked" });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        } finally {
            if (conn) await conn.end();
        }
    });

    /**
     * ৩. ইউজারের অ্যাড ডাটা ও কয়েন পাওয়ার API
     */
    router.get('/user-stats/:userId', async (req, res) => {
        let conn;
        try {
            const { userId } = req.params;
            conn = await getConnection();

            const [rows] = await conn.query(`SELECT * FROM ad_task_users WHERE user_id = ?`, [userId]);

            const data = rows[0] || {
                user_id: userId,
                coins: 0,
                completed_tasks: 0,
                incomplete_tasks: 0,
                daily_completed_tasks: 0
            };

            return res.json({ success: true, data });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        } finally {
            if (conn) await conn.end();
        }
    });

    /**
     * ৪. অ্যাডমিন সেটিংস আপডেট API
     */
    router.post('/admin/update-settings', async (req, res) => {
        let conn;
        try {
            const { task_reward_coins, coins_per_usd, min_convert_coins } = req.body;
            conn = await getConnection();

            await conn.query(`
                UPDATE ad_settings 
                SET task_reward_coins = ?, coins_per_usd = ?, min_convert_coins = ?
                WHERE id = 1
            `, [task_reward_coins, coins_per_usd, min_convert_coins]);

            return res.json({ success: true, message: "Settings updated successfully" });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        } finally {
            if (conn) await conn.end();
        }
    });

    return router;
};
                                                              
