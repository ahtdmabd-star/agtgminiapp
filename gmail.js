// ============================================================
// File: gmail.js - PART 1
// Dedicated Gmail API Router Module with Auto-Table & Column Sync
// ============================================================

const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();

module.exports = function(dbConfig) {

    // ----------------------------------------------------
    // ১. অটো-ডাটাবেজ টেবিল ও কলাম জেনারেটর (Auto Schema & Column Sync)
    // ----------------------------------------------------
    let isTablesInitialized = false;

    async function ensureTablesExist(connection) {
        if (isTablesInitialized) return;

        // ১.১ জিমেইল সেটিংস টেবিল তৈরি
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS \`gmail_settings\` (
                \`id\` INT PRIMARY KEY DEFAULT 1,
                \`rate_usd\` DECIMAL(12, 8) DEFAULT 0.00212475,
                \`fixed_password\` VARCHAR(255) DEFAULT 'Pass#2026!Fixed',
                \`tutorial_link\` VARCHAR(500) DEFAULT '',
                \`rules_text\` LONGTEXT NULL,
                \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // ডিফল্ট সেটিং রো না থাকলে ইনসার্ট করা
        await connection.execute(`
            INSERT IGNORE INTO \`gmail_settings\` (\`id\`, \`rate_usd\`, \`fixed_password\`, \`tutorial_link\`, \`rules_text\`) 
            VALUES (1, 0.00212475, 'Pass#2026!Fixed', 'https://youtube.com', '১. অবশ্যই নির্ধারিত পাসওয়ার্ড ব্যবহার করতে হবে।\\n২. সঠিক ইমেইল সাবমিট করুন।');
        `);

        // ১.২ জিমেইল সাবমিশন টেবিল তৈরি
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS \`gmail_submissions\` (
                \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                \`telegram_id\` VARCHAR(100) NOT NULL,
                \`email\` VARCHAR(255) NOT NULL,
                \`password\` VARCHAR(255) NOT NULL,
                \`rate_usd\` DECIMAL(12, 8) NOT NULL,
                \`status\` ENUM('pending', 'checking', 'approved', 'rejected') DEFAULT 'pending',
                \`admin_note\` VARCHAR(255) DEFAULT NULL,
                \`submitted_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                \`reviewed_at\` TIMESTAMP NULL,
                INDEX (\`telegram_id\`),
                INDEX (\`status\`),
                INDEX (\`submitted_at\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // ১.৩ নিরাপদ কলাম চেক ও এড করার ফাংশন
        const checkAndAddColumn = async (tableName, columnName, columnDefinition) => {
            try {
                const [cols] = await connection.execute(
                    `SHOW COLUMNS FROM \`${tableName}\` LIKE '${columnName}'`
                );
                if (cols.length === 0) {
                    await connection.execute(
                        `ALTER TABLE \`${tableName}\` ADD COLUMN ${columnDefinition}`
                    );
                }
            } catch (err) {
                console.error(`Error checking/adding column ${columnName}:`, err.message);
            }
        };

        // অটো-কলাম অল্টার চেক
        await checkAndAddColumn('gmail_submissions', 'rate_usd', '`rate_usd` DECIMAL(12, 8) NOT NULL AFTER `password`');
        await checkAndAddColumn('gmail_submissions', 'status', "`status` ENUM('pending', 'checking', 'approved', 'rejected') DEFAULT 'pending' AFTER `rate_usd`");
        await checkAndAddColumn('gmail_submissions', 'admin_note', '`admin_note` VARCHAR(255) DEFAULT NULL AFTER `status`');
        await checkAndAddColumn('gmail_submissions', 'reviewed_at', '`reviewed_at` TIMESTAMP NULL AFTER `submitted_at`');

        isTablesInitialized = true;
    }

    // ----------------------------------------------------
    // ২. প্রধান এপিআই রাউটিং (GET & POST)
    // ----------------------------------------------------
    router.all('*', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') {
            return res.status(405).json({ success: false, message: 'Method Not Allowed' });
        }

        const body = req.method === 'POST' ? req.body : req.query;
        const action = String(body.action || '').trim();
        const tgId = String(body.tg_id || '').trim();

        let connection;

        try {
            connection = await mysql.createConnection(dbConfig);
            
            // অটো টেবিল স্ট্রাকচার এবং কলাম চেক ও ক্রিয়েট
            await ensureTablesExist(connection);

            // ----------------------------------------------------
            // হেলপার: ইউজার যাচাইকরণ
            // ----------------------------------------------------
            const requireUser = async (telegramId) => {
                if (!telegramId) {
                    const err = new Error('Telegram ID is required.');
                    err.statusCode = 400;
                    throw err;
                }
                const [rows] = await connection.execute(
                    'SELECT * FROM `users` WHERE `telegram_id` = ? LIMIT 1',
                    [telegramId]
                );
                if (rows.length === 0) {
                    const err = new Error('User account not found.');
                    err.statusCode = 404;
                    throw err;
                }
                return rows[0];
            };

            // ----------------------------------------------------
            // হেলপার: এডমিন যাচাইকরণ
            // ----------------------------------------------------
            const requireAdmin = async (telegramId) => {
                const user = await requireUser(telegramId);
                if (String(user.role).toLowerCase() !== 'admin') {
                    const err = new Error('Admin access required.');
                    err.statusCode = 403;
                    throw err;
                }
                return user;
            };

            // ====================================================
            // ACTION 1: Get Configs & 24h Stats (ইউজার প্যানেল)
            // ====================================================
            if (action === 'get_user_init_data') {
                const user = await requireUser(tgId);

                // ১. জিমেইল গ্লোবাল সেটিংস আনা
                const [settings] = await connection.execute('SELECT * FROM `gmail_settings` WHERE `id` = 1 LIMIT 1');
                const config = settings[0] || {};

                // ২. গত ২৪ ঘণ্টায় ইউজারের মোট সাবমিশন কাউন্ট
                const [countRows] = await connection.execute(
                    `SELECT COUNT(*) as count_24h 
                     FROM \`gmail_submissions\` 
                     WHERE \`telegram_id\` = ? AND \`submitted_at\` >= NOW() - INTERVAL 24 HOUR`,
                    [user.telegram_id]
                );

                return res.json({
                    success: true,
                    rate_usd: config.rate_usd,
                    fixed_password: config.fixed_password,
                    tutorial_link: config.tutorial_link,
                    rules_text: config.rules_text,
                    submissions_24h: countRows[0].count_24h || 0
                });
            }

            // ====================================================
            // ACTION 2: Submit Gmail (ইউজার জিমেইল সাবমিট করবে)
            // ====================================================
            if (action === 'submit_gmail') {
                const user = await requireUser(tgId);
                const email = String(body.email || '').trim().toLowerCase();

                if (!email) {
                    return res.status(400).json({ success: false, message: 'Gmail address is required.' });
                }

                // জিমেইল ফরম্যাট ভ্যালিডেশন
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email) || !email.endsWith('@gmail.com')) {
                    return res.status(400).json({ success: false, message: 'Please enter a valid @gmail.com address.' });
                }

                // ডুপ্লিকেট চেকিং
                const [duplicate] = await connection.execute(
                    `SELECT \`id\` FROM \`gmail_submissions\` WHERE \`email\` = ? AND \`status\` IN ('pending', 'checking', 'approved') LIMIT 1`,
                    [email]
                );
                
                if (duplicate.length > 0) {
                    return res.status(400).json({ success: false, message: 'This Gmail address has already been submitted.' });
                }

                // বর্তমানে সেট করা রেট ও পাসওয়ার্ড নিয়ে সাবমিট করা
                const [settings] = await connection.execute('SELECT `rate_usd`, `fixed_password` FROM `gmail_settings` WHERE `id` = 1 LIMIT 1');
                const rateUsd = settings[0] ? settings[0].rate_usd : 0.00212475;
                const fixedPassword = settings[0] ? settings[0].fixed_password : 'Pass#2026!Fixed';

                // পেন্ডিং স্ট্যাটাসে এন্ট্রি হবে
                const [insertRes] = await connection.execute(
                    `INSERT INTO \`gmail_submissions\` (\`telegram_id\`, \`email\`, \`password\`, \`rate_usd\`, \`status\`) 
                     VALUES (?, ?, ?, ?, 'pending')`,
                    [user.telegram_id, email, fixedPassword, rateUsd]
                );

                return res.json({
                    success: true,
                    message: 'Gmail submitted successfully! Status is now Pending.',
                    submission_id: insertRes.insertId
                });
            }
            // ====================================================
            // ACTION 3: User Submission History
            // ====================================================
            if (action === 'get_user_history') {
                const user = await requireUser(tgId);
                const [history] = await connection.execute(
                    `SELECT \`id\`, \`email\`, \`password\`, \`rate_usd\`, \`status\`, \`submitted_at\` 
                     FROM \`gmail_submissions\` 
                     WHERE \`telegram_id\` = ? 
                     ORDER BY \`id\` DESC LIMIT 50`,
                    [user.telegram_id]
                );
                return res.json({ success: true, history });
            }

            // ====================================================
            // ACTION 4: ADMIN - Get Dashboard Data
            // ====================================================
            if (action === 'admin_get_dashboard') {
                await requireAdmin(tgId);

                const [settings] = await connection.execute('SELECT * FROM `gmail_settings` WHERE `id` = 1 LIMIT 1');
                const [submissions] = await connection.execute(
                    `SELECT s.*, u.username, u.first_name 
                     FROM \`gmail_submissions\` s 
                     LEFT JOIN \`users\` u ON u.\`telegram_id\` = s.\`telegram_id\` 
                     ORDER BY s.\`id\` DESC LIMIT 300`
                );

                return res.json({
                    success: true,
                    settings: settings[0] || {},
                    submissions
                });
            }

            // ====================================================
            // ACTION 5: ADMIN - Update Settings
            // ====================================================
            if (action === 'admin_update_settings') {
                await requireAdmin(tgId);

                const rateUsd = Number(body.rate_usd);
                const fixedPassword = String(body.fixed_password || '').trim();
                const tutorialLink = String(body.tutorial_link || '').trim();
                const rulesText = String(body.rules_text || '').trim();

                await connection.execute(
                    `UPDATE \`gmail_settings\` 
                     SET \`rate_usd\` = ?, \`fixed_password\` = ?, \`tutorial_link\` = ?, \`rules_text\` = ? 
                     WHERE \`id\` = 1`,
                    [rateUsd, fixedPassword, tutorialLink, rulesText]
                );

                return res.json({ success: true, message: 'Settings updated successfully!' });
            }

            // ====================================================
            // ACTION 6: ADMIN - Change Status (Pending -> Checking -> Approve/Reject)
            // ====================================================
            if (action === 'admin_update_status') {
                await requireAdmin(tgId);

                const submissionId = Number(body.submission_id);
                const newStatus = String(body.new_status || '').toLowerCase().trim();

                if (!['checking', 'approved', 'rejected'].includes(newStatus)) {
                    return res.status(400).json({ success: false, message: 'Invalid status provided.' });
                }

                // সাবমিশন ডিটেইলস নিয়ে আসা
                const [subRows] = await connection.execute(
                    'SELECT * FROM `gmail_submissions` WHERE `id` = ? LIMIT 1',
                    [submissionId]
                );

                if (subRows.length === 0) {
                    return res.status(404).json({ success: false, message: 'Submission not found.' });
                }

                const sub = subRows[0];

                if (sub.status === newStatus) {
                    return res.json({ success: true, message: `Status is already ${newStatus}` });
                }

                // ১. যদি শুধু 'Checking' বা 'Rejected' করা হয়
                if (newStatus === 'checking' || newStatus === 'rejected') {
                    await connection.execute(
                        'UPDATE `gmail_submissions` SET `status` = ?, `reviewed_at` = CURRENT_TIMESTAMP WHERE `id` = ?',
                        [newStatus, submissionId]
                    );
                    return res.json({ success: true, message: `Submission marked as ${newStatus}.` });
                }

                // ২. যদি 'Approved' করা হয়
                if (newStatus === 'approved') {
                    if (sub.status === 'approved') {
                        return res.status(400).json({ success: false, message: 'Already approved before.' });
                    }

                    await connection.beginTransaction();

                    try {
                        const creditAmount = Number(sub.rate_usd || 0);

                        // ইউজারের ব্যালেন্স লক এবং আপডেট
                        const [uRows] = await connection.execute(
                            'SELECT `balance` FROM `users` WHERE `telegram_id` = ? FOR UPDATE',
                            [sub.telegram_id]
                        );
                        const oldBal = Number(uRows[0]?.balance || 0);
                        const newBal = oldBal + creditAmount;

                        await connection.execute('UPDATE `users` SET `balance` = ? WHERE `telegram_id` = ?', [newBal, sub.telegram_id]);

                        // ট্রানজেকশন টেবিলে রেকর্ড
                        const [txRes] = await connection.execute(
                            `INSERT INTO \`transactions\` 
                            (\`telegram_id\`, \`transaction_type\`, \`source_id\`, \`source_reference\`, \`amount_usd\`, \`balance_before\`, \`balance_after\`, \`status\`, \`description\`) 
                            VALUES (?, 'gmail_sell', ?, ?, ?, ?, ?, 'completed', ?)`,
                            [sub.telegram_id, sub.id, `GMAIL-${sub.id}`, creditAmount, oldBal, newBal, `Gmail Sell #${sub.id} Approved`]
                        );

                        // রেফারেল কমিশন বন্টন লজিক
                        const [refUser] = await connection.execute('SELECT `referred_by` FROM `users` WHERE `telegram_id` = ? LIMIT 1', [sub.telegram_id]);
                        if (refUser.length > 0 && refUser[0].referred_by) {
                            const refCode = String(refUser[0].referred_by).trim();
                            const [parentUser] = await connection.execute('SELECT `telegram_id` FROM `users` WHERE `referral_code` = ? LIMIT 1', [refCode]);

                            if (parentUser.length > 0) {
                                const referrerTgId = String(parentUser[0].telegram_id);

                                const [st] = await connection.execute('SELECT `referral_percentage` FROM `settings` WHERE `id` = 1 LIMIT 1');
                                const refPercent = st.length > 0 ? Number(st[0].referral_percentage || 0) : 0;

                                if (refPercent > 0 && referrerTgId !== String(sub.telegram_id)) {
                                    const refComm = (creditAmount * refPercent) / 100;

                                    const [parentBalRows] = await connection.execute('SELECT `balance` FROM `users` WHERE `telegram_id` = ? FOR UPDATE', [referrerTgId]);
                                    if (parentBalRows.length > 0 && refComm > 0) {
                                        const parentOldBal = Number(parentBalRows[0].balance || 0);
                                        const parentNewBal = parentOldBal + refComm;

                                        // ক) রেফারেল কমিশন টেবিল
                                        const [commIns] = await connection.execute(
                                            `INSERT INTO \`referral_commissions\` 
                                            (\`source_transaction_id\`, \`referrer_telegram_id\`, \`referred_telegram_id\`, \`commission_percent\`, \`source_amount_usd\`, \`commission_amount_usd\`, \`status\`) 
                                            VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
                                            [txRes.insertId, referrerTgId, sub.telegram_id, refPercent, creditAmount, refComm]
                                        );

                                        // খ) রেফারারের ব্যালেন্স বৃদ্ধি
                                        await connection.execute('UPDATE `users` SET `balance` = ? WHERE `telegram_id` = ?', [parentNewBal, referrerTgId]);

                                        // গ) রেফারারের ট্রানজেকশন রেকর্ড
                                        const [commTx] = await connection.execute(
                                            `INSERT INTO \`transactions\` 
                                            (\`telegram_id\`, \`transaction_type\`, \`source_id\`, \`source_reference\`, \`amount_usd\`, \`balance_before\`, \`balance_after\`, \`status\`, \`description\`) 
                                            VALUES (?, 'referral_commission', ?, ?, ?, ?, ?, 'completed', ?)`,
                                            [referrerTgId, txRes.insertId, `GMAIL-${sub.id}`, refComm, parentOldBal, parentNewBal, `Referral commission from Gmail #${sub.id}`]
                                        );

                                        await connection.execute('UPDATE `referral_commissions` SET `commission_transaction_id` = ? WHERE `id` = ?', [commTx.insertId, commIns.insertId]);
                                    }
                                }
                            }
                        }

                        // জিমেইল সাবমিশনের স্ট্যাটাস Approved করা
                        await connection.execute(
                            'UPDATE `gmail_submissions` SET `status` = "approved", `reviewed_at` = CURRENT_TIMESTAMP WHERE `id` = ?',
                            [sub.id]
                        );

                        await connection.commit();
                        return res.json({ success: true, message: 'Submission approved, balance credited, and referral commission distributed.' });

                    } catch (err) {
                        await connection.rollback();
                        throw err;
                    }
                }
            }

            return res.status(400).json({ success: false, message: 'Invalid Gmail API action.' });

        } catch (error) {
            if (connection) await connection.rollback().catch(() => {});
            console.error('Gmail API Error:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Internal Server Error'
            });
        } finally {
            if (connection) await connection.end().catch(() => {});
        }
    });

    return router;
};
                                         
