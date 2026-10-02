const express = require('express');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const {
    sendUserNotification
} = require('./telegram_notifier');


module.exports = function (dbConfig) {

    const router = express.Router();


    // ============================================================
    // DATABASE CONNECTION
    // ============================================================

    async function getConnection() {
        return await mysql.createConnection(dbConfig);
    }


    // ============================================================
    // TABLE AUTO-CREATION
    // ============================================================

    async function initTables() {

        let conn;

        try {

            conn = await getConnection();


            // ----------------------------------------------------
            // ১. অ্যাড টাস্ক ইউজার টেবিল
            // ----------------------------------------------------

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


            // ----------------------------------------------------
            // ২. অ্যাডমিন সেটিংস টেবিল
            // ----------------------------------------------------

            await conn.query(`
                CREATE TABLE IF NOT EXISTS ad_settings (

                    id INT PRIMARY KEY AUTO_INCREMENT,

                    task_reward_coins INT DEFAULT 100,

                    coins_per_usd INT DEFAULT 10000,

                    min_convert_coins INT DEFAULT 1000

                )
            `);


            // ----------------------------------------------------
            // Default Settings
            // ----------------------------------------------------

            const [rows] = await conn.query(
                `SELECT * FROM ad_settings WHERE id = 1`
            );


            if (rows.length === 0) {

                await conn.query(`
                    INSERT INTO ad_settings
                    (
                        id,
                        task_reward_coins,
                        coins_per_usd,
                        min_convert_coins
                    )

                    VALUES
                    (
                        1,
                        100,
                        10000,
                        1000
                    )
                `);

            }


        } catch (err) {

            console.error(
                "Ad Task DB Init Error:",
                err
            );

        } finally {

            if (conn) {
                await conn.end();
            }

        }

    }


    // Initialize Tables
    initTables();


    // ============================================================
    // ADSGRAM SECRET
    // ============================================================

    const ADSGRAM_SECRET =
        process.env.ADSGRAM_SECRET ||
        "YOUR_ADSGRAM_SECRET_KEY";


    /**
     * ============================================================
     * ১. Adsgram Webhook Callback
     * ============================================================
     *
     * Ads দেখার পরে user reward পাবে।
     *
     * Reward সফলভাবে database-এ যোগ হওয়ার পরে
     * Telegram notification পাঠানো হবে।
     */

    router.get('/reward-callback', async (req, res) => {

        let conn;

        try {

            // ----------------------------------------------------
            // Telegram User ID
            // ----------------------------------------------------

            const telegramUserId =
                req.query.userId ||
                req.query.userid;


            const {
                hash,
                ...params
            } = req.query;


            if (!telegramUserId) {

                return res
                    .status(400)
                    .send("User ID missing");

            }


            // ----------------------------------------------------
            // Adsgram Hash Verification
            // ----------------------------------------------------

            if (hash) {

                const checkString =
                    Object.keys(params)

                        .sort()

                        .map(
                            key =>
                                `${key}=${params[key]}`
                        )

                        .join('\n');


                const secretKey =
                    crypto
                        .createHash('sha256')
                        .update(ADSGRAM_SECRET)
                        .digest();


                const hmac =
                    crypto
                        .createHmac(
                            'sha256',
                            secretKey
                        )
                        .update(checkString)
                        .digest('hex');


                if (hmac !== hash) {

                    return res
                        .status(403)
                        .send("Unauthorized Request");

                }

            }


            // ----------------------------------------------------
            // Database Connection
            // ----------------------------------------------------

            conn = await getConnection();


            // ----------------------------------------------------
            // Reward Setting
            // ----------------------------------------------------

            const [settings] =
                await conn.query(
                    `SELECT task_reward_coins
                     FROM ad_settings
                     WHERE id = 1`
                );


            const rewardCoins =
                Number(
                    settings[0]?.task_reward_coins || 100
                );


            // ----------------------------------------------------
            // User Check
            // ----------------------------------------------------

            const [users] =
                await conn.query(
                    `SELECT *
                     FROM ad_task_users
                     WHERE user_id = ?`,
                    [telegramUserId]
                );


            const now = new Date();


            // ====================================================
            // NEW USER
            // ====================================================

            if (users.length === 0) {

                await conn.query(`
                    INSERT INTO ad_task_users
                    (
                        user_id,
                        coins,
                        completed_tasks,
                        daily_completed_tasks,
                        last_ad_time
                    )

                    VALUES
                    (
                        ?,
                        ?,
                        1,
                        1,
                        ?
                    )
                `, [
                    telegramUserId,
                    rewardCoins,
                    now
                ]);


            } else {


                // =================================================
                // EXISTING USER
                // =================================================

                const user = users[0];


                const lastTime =
                    user.last_ad_time
                        ? new Date(user.last_ad_time)
                        : new Date(0);


                const hoursPassed =
                    (
                        now - lastTime
                    ) /
                    (1000 * 60 * 60);


                const newDaily =
                    hoursPassed >= 24
                        ? 1
                        : Number(
                            user.daily_completed_tasks || 0
                        ) + 1;


                await conn.query(`
                    UPDATE ad_task_users

                    SET

                        coins = coins + ?,

                        completed_tasks =
                            completed_tasks + 1,

                        daily_completed_tasks = ?,

                        last_ad_time = ?

                    WHERE user_id = ?
                `, [
                    rewardCoins,
                    newDaily,
                    now,
                    telegramUserId
                ]);

            }


            // ====================================================
            // TELEGRAM NOTIFICATION
            // ====================================================

            await sendUserNotification({

                telegramId:
                    telegramUserId,

                event:
                    'ad_reward',

                title:
                    '🎬 Ad Reward Received',

                message:
                    `You received ${rewardCoins} coins from an advertisement task.`,

                amount:
                    rewardCoins,

                extra: {

                    reward_coins:
                        rewardCoins,

                    source:
                        'adsgram'

                }

            });


            // ----------------------------------------------------
            // Adsgram Response
            // ----------------------------------------------------

            return res
                .status(200)
                .send("OK");


        } catch (error) {

            console.error(
                "Ads Reward Callback Error:",
                error
            );


            return res
                .status(500)
                .send("Server Error");


        } finally {

            if (conn) {
                await conn.end();
            }

        }

    });


    /**
     * ============================================================
     * ২. কয়েন থেকে ডলারে এক্সচেঞ্জ করার API
     * ============================================================
     */

    router.post('/convert-coins', async (req, res) => {

        let conn;

        try {


            // ----------------------------------------------------
            // User ID
            // ----------------------------------------------------

            const userId =
                req.body.userId ||
                req.body.userid;


            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User ID missing"

                });

            }


            // ----------------------------------------------------
            // Database Connection
            // ----------------------------------------------------

            conn = await getConnection();


            // ----------------------------------------------------
            // Settings
            // ----------------------------------------------------

            const [settings] =
                await conn.query(`
                    SELECT
                        coins_per_usd,
                        min_convert_coins

                    FROM ad_settings

                    WHERE id = 1
                `);


            const coinsPerUsd =
                Number(
                    settings[0]?.coins_per_usd ||
                    10000
                );


            const minConvert =
                Number(
                    settings[0]?.min_convert_coins ||
                    1000
                );


            // ----------------------------------------------------
            // User Coins Check
            // ----------------------------------------------------

            const [users] =
                await conn.query(`
                    SELECT coins

                    FROM ad_task_users

                    WHERE user_id = ?
                `, [
                    userId
                ]);


            if (
                users.length === 0 ||
                Number(users[0].coins) < minConvert
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        `Minimum ${minConvert} coins required to exchange.`

                });

            }


            // ----------------------------------------------------
            // Current Coins
            // ----------------------------------------------------

            const currentCoins =
                Number(
                    users[0].coins
                );


            // ----------------------------------------------------
            // USD Calculation
            // ----------------------------------------------------

            const usdAmount =
                (
                    currentCoins /
                    coinsPerUsd
                ).toFixed(4);


            // ====================================================
            // ১. মূল users table-এ USD Balance যোগ
            // ====================================================

            await conn.query(`
                UPDATE users

                SET balance =
                    balance + ?

                WHERE telegram_id = ?
                   OR id = ?
            `, [
                usdAmount,
                userId,
                userId
            ]);


            // ====================================================
            // ২. Ad Task Coins 0 করা
            // ====================================================

            await conn.query(`
                UPDATE ad_task_users

                SET coins = 0

                WHERE user_id = ?
            `, [
                userId
            ]);


            // ====================================================
            // TELEGRAM NOTIFICATION
            // ====================================================

            await sendUserNotification({

                telegramId:
                    userId,

                event:
                    'coins_converted',

                title:
                    '💵 Coins Converted',

                message:
                    `You converted ${currentCoins} coins into $${usdAmount}.`,

                amount:
                    Number(usdAmount),

                extra: {

                    coins:
                        currentCoins,

                    usd:
                        Number(usdAmount),

                    coins_per_usd:
                        coinsPerUsd

                }

            });


            // ----------------------------------------------------
            // API Response
            // ----------------------------------------------------

            return res.json({

                success: true,

                message:
                    `Successfully exchanged ${currentCoins} coins for $${usdAmount}!`,

                convertedUsd:
                    usdAmount

            });


        } catch (error) {

            console.error(
                "Exchange Error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Server error during exchange"

            });


        } finally {

            if (conn) {
                await conn.end();
            }

        }

    });


    /**
     * ============================================================
     * ৩. অসম্পূর্ণ অ্যাড ট্র্যাকিং
     * ============================================================
     */

    router.post('/track-incomplete', async (req, res) => {

        let conn;

        try {


            const userId =
                req.body.userId ||
                req.body.userid;


            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "userId required"

                });

            }


            conn = await getConnection();


            await conn.query(`
                INSERT INTO ad_task_users
                (
                    user_id,
                    incomplete_tasks
                )

                VALUES
                (
                    ?,
                    1
                )

                ON DUPLICATE KEY UPDATE

                    incomplete_tasks =
                        incomplete_tasks + 1
            `, [
                userId
            ]);


            return res.json({

                success: true,

                message:
                    "Incomplete task tracked"

            });


        } catch (error) {

            return res.status(500).json({

                success: false,

                message:
                    error.message

            });


        } finally {

            if (conn) {
                await conn.end();
            }

        }

    });


    /**
     * ============================================================
     * ৪. ইউজারের অ্যাড ডাটা পাওয়ার API
     * ============================================================
     */

    router.get('/user-stats/:userId', async (req, res) => {

        let conn;

        try {


            const {
                userId
            } = req.params;


            conn = await getConnection();


            const [rows] =
                await conn.query(`
                    SELECT *

                    FROM ad_task_users

                    WHERE user_id = ?
                `, [
                    userId
                ]);


            const data =
                rows[0] ||
                {

                    user_id:
                        userId,

                    coins:
                        0,

                    completed_tasks:
                        0,

                    incomplete_tasks:
                        0,

                    daily_completed_tasks:
                        0

                };


            return res.json({

                success: true,

                data

            });


        } catch (error) {

            return res.status(500).json({

                success: false,

                message:
                    error.message

            });


        } finally {

            if (conn) {
                await conn.end();
            }

        }

    });


    /**
     * ============================================================
     * ৫. অ্যাডমিন সেটিংস আপডেট
     * ============================================================
     */

    router.post('/admin/update-settings', async (req, res) => {

        let conn;

        try {


            const {
                task_reward_coins,
                coins_per_usd,
                min_convert_coins
            } = req.body;


            conn = await getConnection();


            await conn.query(`
                UPDATE ad_settings

                SET

                    task_reward_coins = ?,

                    coins_per_usd = ?,

                    min_convert_coins = ?

                WHERE id = 1
            `, [
                task_reward_coins,
                coins_per_usd,
                min_convert_coins
            ]);


            return res.json({

                success: true,

                message:
                    "Settings updated successfully"

            });


            } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });

    } finally {
        if (conn) await conn.end();
    }
});

return router;
};
