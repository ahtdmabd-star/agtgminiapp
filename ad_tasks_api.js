const express = require('express');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

module.exports = function (dbConfig) {
    const router = express.Router();

    async function getConnection() {
        return await mysql.createConnection(dbConfig);
    }

    // টেবিল অটো-ক্রিয়েশন
    async function initTables() {
        let conn;
        try {
            conn = await getConnection();
            
            // ১. অ্যাড টাস্ক ইউজার টেবিল
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

            // ২. অ্যাডমিন সেটিংস টেবিল
            await conn.query(`
                CREATE TABLE IF NOT EXISTS ad_settings (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    task_reward_coins INT DEFAULT 100,
                    coins_per_usd INT DEFAULT 10000,
                    min_convert_coins INT DEFAULT 1000
                )
            `);

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

    const ADSGRAM_SECRET = process.env.ADSGRAM_SECRET || "YOUR_ADSGRAM_SECRET_KEY";

    /**
     * ১. Adsgram Webhook Callback
     */
    router.get('/reward-callback', async (req, res) => {
        let conn;
        try {
            const telegramUserId = req.query.userId || req.query.userid;
            const { hash, ...params } = req.query;

            if (!telegramUserId) return res.status(400).send("User ID missing");

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
            const [settings] = await conn.query(`SELECT task_reward_coins FROM ad_settings WHERE id = 1`);
            const rewardCoins = settings[0]?.task_reward_coins || 100;

            const [users] = await conn.query(`SELECT * FROM ad_task_users WHERE user_id = ?`, [telegramUserId]);
            const now = new Date();

            if (users.length === 0) {
                await conn.query(`
                    INSERT INTO ad_task_users (user_id, coins, completed_tasks, daily_completed_tasks, last_ad_time)
                    VALUES (?, ?, 1, 1, ?)
                `, [telegramUserId, rewardCoins, now]);
            } else {
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

            return res.status(200).send("OK");

        } catch (error) {
            return res.status(500).send("Server Error");
        } finally {
            if (conn) await conn.end();
        }
    });

    /**
     * ২. কয়েন থেকে ডলারে এক্সচেঞ্জ করার এপিআই (Coin Exchange API)
     */
    router.post('/convert-coins', async (req, res) => {
        let conn;
        try {
            const userId = req.body.userId || req.body.userid;
            if (!userId) return res.status(400).json({ success: false, message: "User ID missing" });

            conn = await getConnection();

            // সেটিংস চেক
            const [settings] = await conn.query(`SELECT coins_per_usd, min_convert_coins FROM ad_settings WHERE id = 1`);
            const coinsPerUsd = settings[0]?.coins_per_usd || 10000;
            const minConvert = settings[0]?.min_convert_coins || 1000;

            // ইউজারের কয়েন ডাটা চেক
            const [users] = await conn.query(`SELECT coins FROM ad_task_users WHERE user_id = ?`, [userId]);
            if (users.length === 0 || users[0].coins < minConvert) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Minimum ${minConvert} coins required to exchange.` 
                });
            }

            const currentCoins = users[0].coins;
            const usdAmount = (currentCoins / coinsPerUsd).toFixed(4); // ডলার অ্যামাউন্ট হিসাব

            //১. মূল 'users' টেবিলে ব্যালেন্স (USD) যোগ
            await conn.query(`
                UPDATE users 
                SET balance = balance + ? 
                WHERE telegram_id = ? OR id = ?
            `, [usdAmount, userId, userId]);

            // ২. অ্যাড টাস্কের কয়েন ০ করে দেওয়া
            await conn.query(`
                UPDATE ad_task_users 
                SET coins = 0 
                WHERE user_id = ?
            `, [userId]);

            return res.json({ 
                success: true, 
                message: `Successfully exchanged ${currentCoins} coins for $${usdAmount}!`,
                convertedUsd: usdAmount 
            });

        } catch (error) {
            console.error("Exchange Error:", error);
            return res.status(500).json({ success: false, message: "Server error during exchange" });
        } finally {
            if (conn) await conn.end();
        }
    });

    /**
     * ৩. অসম্পূর্ণ অ্যাড ট্র্যাকিং
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
     * ৪. ইউজারের অ্যাড ডাটা পাওয়ার এপিআই
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
     * ৫. অ্যাডমিন সেটিংস আপডেট
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
