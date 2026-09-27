// ============================================================
// File: gmail.js
// Dedicated Gmail API Router Module
// ============================================================

const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();

module.exports = function(dbConfig) {

    // হ্যান্ডলার: রিকোয়েস্ট প্রসেসিং (GET এবং POST উভয় মেথড সাপোর্ট করবে)
    router.all('*', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') {
            return res.status(405).json({ success: false, message: 'Method Not Allowed' });
        }

        const body = req.method === 'POST' ? req.body : req.query;
        const action = String(body.action || '').trim();
        const tgId = String(body.tg_id || '').trim();

        let connection;

        try {
            // ডাটাবেজ কানেকশন তৈরি
            connection = await mysql.createConnection(dbConfig);

            // ----------------------------------------------------
            // হেলপার ১: ইউজার চেক
            // ----------------------------------------------------
            const requireUser = async (telegramId) => {
                if (!telegramId) {
                    const err = new Error('Telegram ID is required.');
                    err.statusCode = 400;
                    throw err;
                }
                const [rows] = await connection.execute(
                    'SELECT * FROM users WHERE telegram_id = ? LIMIT 1',
                    [telegramId]
                );
                if (rows.length === 0) {
                    const err = new Error('User account not found.');
                    err.statusCode = 404;
                    throw err;
                }
                if (rows[0].status && String(rows[0].status).toLowerCase() !== 'active') {
                    const err = new Error('Your account is not active.');
                    err.statusCode = 403;
                    throw err;
                }
                return rows[0];
            };

            // ----------------------------------------------------
            // হেলপার ২: অ্যাডমিন চেক
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
            // Action 1: Active Options (ইউজার প্যানেলের জন্য)
            // ====================================================
            if (action === 'get_options') {
                await requireUser(tgId);
                const [options] = await connection.execute(
                    'SELECT id, option_code, option_name, rate_usd, instructions FROM gmail_options WHERE enabled = 1 ORDER BY id ASC'
                );
                return res.json({ success: true, options });
            }

            // ====================================================
            // Action 2: Submit Gmail & Auto Balance Add + Referral Commission
            // ====================================================
            if (action === 'submit_gmail') {
                const user = await requireUser(tgId);
                const optionCode = String(body.option_code || '').trim();
                const email = String(body.email || '').trim().toLowerCase();
                const password = String(body.password || '').trim();
                const additionalInfo = String(body.additional_info || '').trim();

                if (!optionCode || !email || !password) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Option, Email, and Password are required.' 
                    });
                }

                // জিমেইল ইমেইল ফরম্যাট চেক
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email) || !email.endsWith('@gmail.com')) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Please enter a valid @gmail.com address.' 
                    });
                }

                // ট্রানজেকশন শুরু (যাতে যেকোনো এররে ডাটাবেজ আগের অবস্থায় থাকে)
                await connection.beginTransaction();

                try {
                    // ১. ডুপ্লিকেট জিমেইল সাবমিশন চেক (যদি আগে এক্সেপ্ট হয়ে থাকে)
                    const [duplicate] = await connection.execute(
                        'SELECT id FROM gmail_submissions WHERE email = ? AND status = "approved" LIMIT 1',
                        [email]
                    );
                    if (duplicate.length > 0) {
                        throw new Error('This Gmail account has already been submitted and approved.');
                    }

                    // ২. সিলেক্ট করা অপশনের রেট চেক
                    const [optRows] = await connection.execute(
                        'SELECT option_code, rate_usd FROM gmail_options WHERE option_code = ? AND enabled = 1 LIMIT 1',
                        [optionCode]
                    );
                    if (optRows.length === 0) {
                        throw new Error('Selected Gmail option is currently unavailable.');
                    }

                    const creditUsd = Number(optRows[0].rate_usd || 0);
                    if (creditUsd <= 0) {
                        throw new Error('Invalid rate configured for this option.');
                    }

                    // ৩. ইউজারের বর্তমান ব্যালেন্স লক করা (Concurrency Safety)
                    const [userRows] = await connection.execute(
                        'SELECT balance FROM users WHERE telegram_id = ? FOR UPDATE',
                        [user.telegram_id]
                    );
                    const oldBalance = Number(userRows[0].balance || 0);
                    const newBalance = oldBalance + creditUsd;

                    // ৪. জিমেইল সাবমিশন এন্ট্রি তৈরি (Auto Approve)
                    const [subResult] = await connection.execute(
                        `INSERT INTO gmail_submissions 
                        (telegram_id, option_code, email, password, additional_info, rate_usd, credited_usd, status, reviewed_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)`,
                        [user.telegram_id, optionCode, email, password, additionalInfo || null, creditUsd, creditUsd]
                    );
                    const submissionId = subResult.insertId;

                    // ৫. ইউজারের মেইন ব্যালেন্স আপডেট
                    await connection.execute(
                        'UPDATE users SET balance = ? WHERE telegram_id = ?',
                        [newBalance, user.telegram_id]
                    );

                    // ৬. ইউজারের ট্রানজেকশন হিস্টোরিতে যুক্ত করা
                    const [txResult] = await connection.execute(
                        `INSERT INTO transactions 
                        (telegram_id, transaction_type, source_id, source_reference, amount_usd, balance_before, balance_after, status, description) 
                        VALUES (?, 'gmail_sell', ?, ?, ?, ?, ?, 'completed', ?)`,
                        [user.telegram_id, submissionId, `GMAIL-${submissionId}`, creditUsd, oldBalance, newBalance, `Gmail Sell #${submissionId} auto-approved`]
                    );
                    const sourceTransactionId = txResult.insertId;

                    // ৭. রেফারেল কমিশন হিসাব ও বন্টন
                    let referralCommission = 0;
                    let referrerTelegramId = null;

                    // ইউজারের রেফারার বের করা
                    const [referrerRows] = await connection.execute(
                        'SELECT referred_by FROM users WHERE telegram_id = ? LIMIT 1',
                        [user.telegram_id]
                    );

                    if (referrerRows.length > 0 && referrerRows[0].referred_by) {
                        const referralCode = String(referrerRows[0].referred_by).trim();
                        const [referrerUserRows] = await connection.execute(
                            'SELECT telegram_id FROM users WHERE referral_code = ? LIMIT 1',
                            [referralCode]
                        );
                        if (referrerUserRows.length > 0) {
                            referrerTelegramId = String(referrerUserRows[0].telegram_id);
                        }
                    }

                    // গ্লোবাল সেটিং থেকে রেফারেল পার্সেন্টেজ রিড করা
                    const [settingsRows] = await connection.execute(
                        'SELECT referral_percentage FROM settings WHERE id = 1 LIMIT 1'
                    );
                    const referralPercent = settingsRows.length > 0 ? Number(settingsRows[0].referral_percentage || 0) : 0;

                    // রেফারার যদি থাকে এবং ইউজার নিজে না হয়
                    if (referrerTelegramId && referrerTelegramId !== String(user.telegram_id) && referralPercent > 0) {
                        referralCommission = (creditUsd * referralPercent) / 100;

                        // রেফারারের ব্যালেন্স লক করা
                        const [referrerBalanceRows] = await connection.execute(
                            'SELECT balance FROM users WHERE telegram_id = ? FOR UPDATE',
                            [referrerTelegramId]
                        );

                        if (referrerBalanceRows.length > 0 && referralCommission > 0) {
                            const referrerBefore = Number(referrerBalanceRows[0].balance || 0);
                            const referrerAfter = referrerBefore + referralCommission;

                            // ক) রেফারেল কমিশন টেবিলে এন্ট্রি
                            const [commInsert] = await connection.execute(
                                `INSERT INTO referral_commissions 
                                (source_transaction_id, referrer_telegram_id, referred_telegram_id, commission_percent, source_amount_usd, commission_amount_usd, status) 
                                VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
                                [sourceTransactionId, referrerTelegramId, user.telegram_id, referralPercent, creditUsd, referralCommission]
                            );

                            // খ) রেফারারের ব্যালেন্স বৃদ্ধি
                            await connection.execute(
                                'UPDATE users SET balance = ? WHERE telegram_id = ?',
                                [referrerAfter, referrerTelegramId]
                            );

                            // গ) রেফারারের ট্রানজেকশন হিস্টোরিতে যুক্ত করা
                            const [commTx] = await connection.execute(
                                `INSERT INTO transactions 
                                (telegram_id, transaction_type, source_id, source_reference, amount_usd, balance_before, balance_after, status, description) 
                                VALUES (?, 'referral_commission', ?, ?, ?, ?, ?, 'completed', ?)`,
                                [referrerTelegramId, sourceTransactionId, `GMAIL-${submissionId}`, referralCommission, referrerBefore, referrerAfter, `Referral commission from Gmail Sell #${submissionId}`]
                            );

                            // ঘ) রেফারেল কমিশন রেকর্ডে ট্রানজেকশন আইডি আপডেট
                            await connection.execute(
                                'UPDATE referral_commissions SET commission_transaction_id = ? WHERE id = ?',
                                [commTx.insertId, commInsert.insertId]
                            );
                        }
                    }

                    // সব কিছু ঠিক থাকলে Commit করা
                    await connection.commit();

                    return res.json({
                        success: true,
                        message: 'Gmail submitted successfully and balance credited!',
                        credited_usd: Number(creditUsd.toFixed(4)),
                        referral_commission_usd: Number(referralCommission.toFixed(4))
                    });

                } catch (err) {
                    await connection.rollback();
                    throw err;
                }
            }

            // ====================================================
            // Action 3: Get User Submission History
            // ====================================================
            if (action === 'get_history') {
                const user = await requireUser(tgId);
                const [history] = await connection.execute(
                    'SELECT id, option_code, email, credited_usd, status, submitted_at FROM gmail_submissions WHERE telegram_id = ? ORDER BY id DESC LIMIT 100',
                    [user.telegram_id]
                );
                return res.json({ success: true, history });
            }

            // ====================================================
            // Action 4: ADMIN - Save / Update Option
            // ====================================================
            if (action === 'admin_save_option') {
                await requireAdmin(tgId);
                const optionCode = String(body.option_code || '').trim();
                const optionName = String(body.option_name || '').trim();
                const rateUsd = Number(body.rate_usd || 0);
                const instructions = String(body.instructions || '').trim();
                const enabled = Number(body.enabled) === 1 ? 1 : 0;

                if (!optionCode || !optionName || rateUsd <= 0) {
                    return res.status(400).json({ success: false, message: 'Code, Name, and a valid Rate are required.' });
                }

                await connection.execute(
                    `INSERT INTO gmail_options (option_code, option_name, rate_usd, instructions, enabled) 
                    VALUES (?, ?, ?, ?, ?) 
                    ON DUPLICATE KEY UPDATE 
                        option_name = VALUES(option_name), 
                        rate_usd = VALUES(rate_usd), 
                        instructions = VALUES(instructions), 
                        enabled = VALUES(enabled)`,
                    [optionCode, optionName, rateUsd, instructions, enabled]
                );

                return res.json({ success: true, message: 'Gmail option saved successfully.' });
            }

            // ====================================================
            // Action 5: ADMIN - Get All Options
            // ====================================================
            if (action === 'admin_get_options') {
                await requireAdmin(tgId);
                const [options] = await connection.execute(
                    'SELECT * FROM gmail_options ORDER BY id DESC'
                );
                return res.json({ success: true, options });
            }

            // ====================================================
            // Action 6: ADMIN - Get All Submissions
            // ====================================================
            if (action === 'admin_get_submissions') {
                await requireAdmin(tgId);
                const [submissions] = await connection.execute(
                    `SELECT s.*, u.username, u.first_name 
                    FROM gmail_submissions s 
                    LEFT JOIN users u ON u.telegram_id = s.telegram_id 
                    ORDER BY s.id DESC LIMIT 500`
                );
                return res.json({ success: true, submissions });
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
                      
