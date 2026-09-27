/**
 * =================================================================
 * 𝑺𝒐𝒄𝒊𝒂𝒍-𝑿 - Gmail Sell Independent API Module (With Referral Commission)
 * =================================================================
 */

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

// ডাটাবেজ কনফিগারেশন আপডেট করা হয়েছে
const dbConfig = {
    host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
    port: 14363,
    user: 'avnadmin',
    password: 'AVNS_hhfXItvXPam49_lMnOU',
    database: 'defaultdb',
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// এনক্রিপশন কি ও মেকানিজম (জিমেইল পাসওয়ার্ড সিকিউর করার জন্য)
const GMAIL_CREDENTIAL_KEY = process.env.GMAIL_CREDENTIAL_KEY || 'SOCIAL_X_GMAIL_SECURE_KEY_2026';
const GMAIL_ENCRYPTION_KEY = crypto.createHash('sha256').update(GMAIL_CREDENTIAL_KEY).digest();

function encryptGmailSecret(value) {
    if (!value) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', GMAIL_ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptGmailSecret(value) {
    if (!value) return '';
    try {
        const parts = String(value).split('.');
        if (parts.length !== 3) return '';
        const iv = Buffer.from(parts[0], 'base64');
        const authTag = Buffer.from(parts[1], 'base64');
        const encrypted = Buffer.from(parts[2], 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', GMAIL_ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (error) {
        console.error('Gmail credential decrypt error:', error);
        return '';
    }
}

function cleanStr(val, maxLen = 500) {
    return val ? String(val).trim().slice(0, maxLen) : '';
}

function numVal(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

// ইউজার ভ্যালিডেশন মিডলওয়্যার ফাংশন
async function verifyUser(connection, tgId) {
    if (!tgId) {
        const err = new Error('Telegram ID is required.');
        err.statusCode = 400;
        throw err;
    }
    const [rows] = await connection.execute(
        `SELECT telegram_id, username, balance, role, status FROM users WHERE telegram_id = ? LIMIT 1`,
        [tgId]
    );
    if (rows.length === 0) {
        const err = new Error('User account not found in 𝑺𝒐𝒄𝒊𝒂𝒍-𝑿 system.');
        err.statusCode = 404;
        throw err;
    }
    const user = rows[0];
    if (user.status && String(user.status).toLowerCase() !== 'active') {
        const err = new Error('Your account is inactive.');
        err.statusCode = 403;
        throw err;
    }
    return user;
}

// এডমিন ভ্যালিডেশন ফাংশন
async function verifyAdmin(connection, tgId) {
    const user = await verifyUser(connection, tgId);
    if (String(user.role).toLowerCase() !== 'admin') {
        const err = new Error('Admin privileges required.');
        err.statusCode = 403;
        throw err;
    }
    return user;
}

// রেফারেল পার্সেন্টেজ বের করার ফাংশন
async function getReferralPercent(connection) {
    const [rows] = await connection.execute(
        'SELECT referral_percentage FROM settings WHERE id = 1 LIMIT 1'
    );
    if (rows.length === 0) return 0;
    const percentage = Number(rows[0].referral_percentage || 0);
    return Number.isFinite(percentage) && percentage > 0 ? percentage : 0;
}

// =================================================================
// API ENDPOINTS
// =================================================================

router.all('/gmail-sell', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const payload = req.method === 'POST' ? req.body : req.query;
    const action = payload.action;
    const tgId = payload.tg_id;
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        // ১. ক্যাটাগরি পেজ ডাটা ও ইউজার লিমিট চেক
        if (action === 'get_page_data') {
            const user = await verifyUser(connection, tgId);
            const category = cleanStr(payload.category, 50);

            if (!category) {
                return res.status(400).json({ success: false, message: 'Category parameter is missing.' });
            }

            const [settingsRows] = await connection.execute(
                `SELECT * FROM gmail_sell_settings WHERE category = ? LIMIT 1`,
                [category]
            );

            const settings = settingsRows.length > 0 ? settingsRows[0] : {
                category: category,
                rate_usd: 0.0050,
                tutorial_url: '',
                rules: '',
                fixed_password: '',
                enabled: 1
            };

            const [countRows] = await connection.execute(
                `SELECT COUNT(*) AS count24h FROM gmail_sell_submissions WHERE telegram_id = ? AND category = ? AND submitted_at >= (NOW() - INTERVAL 24 HOUR)`,
                [user.telegram_id, category]
            );
            const count24h = Number(countRows[0]?.count24h || 0);

            const [historyRows] = await connection.execute(
                `SELECT id, category, gmail_username, status, rate_usd, submitted_at, reviewed_at, admin_note FROM gmail_sell_submissions WHERE telegram_id = ? AND category = ? ORDER BY id DESC LIMIT 50`,
                [user.telegram_id, category]
            );

            return res.json({
                success: true,
                settings: {
                    category: settings.category,
                    rate_usd: Number(settings.rate_usd || 0),
                    tutorial_url: settings.tutorial_url || '',
                    rules: settings.rules || '',
                    fixed_password: settings.fixed_password || '',
                    enabled: Number(settings.enabled) === 1
                },
                user_count_24h: count24h,
                history: historyRows
            });
        }

        // ২. কাস্টম নেম ক্যাটাগরির জন্য পুল থেকে ডাটা ফেচ করা
        if (action === 'get_custom_name_task') {
            await verifyUser(connection, tgId);
            const [poolRows] = await connection.execute(
                `SELECT id, full_name, gmail_username FROM gmail_custom_pool WHERE status = 'available' ORDER BY id ASC LIMIT 1`
            );

            if (poolRows.length === 0) {
                return res.json({ success: false, message: 'No available tasks right now. Please check back later.' });
            }

            return res.json({
                success: true,
                task: poolRows[0]
            });
        }

        // ৩. জিমেইল সাবমিট হ্যান্ডলার
        if (action === 'submit_gmail') {
            const user = await verifyUser(connection, tgId);
            const category = cleanStr(payload.category, 50);
            const gmailUsername = cleanStr(payload.gmail_username, 255);
            const gmailPassword = cleanStr(payload.gmail_password, 255);
            const poolId = numVal(payload.pool_id, 0);
            const oldDays = cleanStr(payload.old_days, 50);
            const usedReason = cleanStr(payload.used_reason, 500);

            if (!category || !gmailUsername || !gmailPassword) {
                return res.status(400).json({ success: false, message: 'Required fields are missing.' });
            }

            const [settingsRows] = await connection.execute(
                `SELECT rate_usd, enabled FROM gmail_sell_settings WHERE category = ? LIMIT 1`,
                [category]
            );

            if (settingsRows.length === 0 || Number(settingsRows[0].enabled) !== 1) {
                return res.status(400).json({ success: false, message: 'This category is currently disabled by 𝑺𝒐𝒄𝒊𝒂𝒍-𝑿.' });
            }

            const rateUsd = Number(settingsRows[0].rate_usd || 0);
            const encryptedPassword = encryptGmailSecret(gmailPassword);

            await connection.beginTransaction();
            try {
                if (category === 'new_custom_name' && poolId > 0) {
                    await connection.execute(
                        `UPDATE gmail_custom_pool SET status = 'submitted', submitted_tg_id = ? WHERE id = ? AND status = 'available'`,
                        [user.telegram_id, poolId]
                    );
                }

                const [result] = await connection.execute(
                    `INSERT INTO gmail_sell_submissions 
                    (telegram_id, category, gmail_username, password_encrypted, pool_id, old_days, used_reason, rate_usd, status, submitted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', CURRENT_TIMESTAMP)`,
                    [
                        user.telegram_id,
                        category,
                        gmailUsername,
                        encryptedPassword,
                        poolId > 0 ? poolId : null,
                        oldDays || null,
                        usedReason || null,
                        rateUsd
                    ]
                );

                await connection.commit();
                return res.json({
                    success: true,
                    message: 'Gmail submitted successfully. Status is Pending.',
                    submission_id: result.insertId
                });

            } catch (err) {
                await connection.rollback();
                throw err;
            }
        }

        // ৪. এডমিন প্যানেল: সব সাবমিশন দেখা
        if (action === 'admin_get_submissions') {
            await verifyAdmin(connection, tgId);
            const categoryFilter = cleanStr(payload.category, 50);

            let query = `SELECT s.*, u.username as tg_username FROM gmail_sell_submissions s LEFT JOIN users u ON u.telegram_id = s.telegram_id`;
            let params = [];

            if (categoryFilter) {
                query += ` WHERE s.category = ?`;
                params.push(categoryFilter);
            }
            query += ` ORDER BY CASE WHEN s.status = 'Pending' THEN 0 ELSE 1 END, s.id DESC`;

            const [rows] = await connection.execute(query, params);

            const formattedRows = rows.map(row => ({
                ...row,
                gmail_password: decryptGmailSecret(row.password_encrypted)
            }));

            return res.json({ success: true, submissions: formattedRows });
        }

        // ৫. এডমিন প্যানেল: স্ট্যাটাস 'Checking' করা
        if (action === 'admin_checking') {
            await verifyAdmin(connection, tgId);
            const submissionId = numVal(payload.submission_id, 0);

            await connection.execute(
                `UPDATE gmail_sell_submissions SET status = 'Checking' WHERE id = ? AND status = 'Pending'`,
                [submissionId]
            );

            return res.json({ success: true, message: 'Status updated to Checking.' });
                        }

            // ৬. এডমিন প্যানেল: অ্যাপ্রুভ (ব্যালেন্স ও রেফারেল কমিশন যোগ করা)
        if (action === 'admin_approve') {
            await verifyAdmin(connection, tgId);
            const submissionId = numVal(payload.submission_id, 0);
            const adminNote = cleanStr(payload.admin_note, 500);

            await connection.beginTransaction();
            try {
                const [subRows] = await connection.execute(
                    `SELECT * FROM gmail_sell_submissions WHERE id = ? FOR UPDATE`,
                    [submissionId]
                );

                if (subRows.length === 0) throw new Error('Submission not found.');
                const sub = subRows[0];

                if (String(sub.status).toLowerCase() === 'approved') {
                    throw new Error('Already approved.');
                }

                const creditUsd = Number(sub.rate_usd || 0);
                if (!Number.isFinite(creditUsd) || creditUsd <= 0) {
                    throw new Error('Invalid Gmail credit amount.');
                }

                const [userRows] = await connection.execute(
                    `SELECT balance FROM users WHERE telegram_id = ? FOR UPDATE`,
                    [sub.telegram_id]
                );
                if (userRows.length === 0) throw new Error('User not found.');

                const balanceBefore = Number(userRows[0].balance || 0);
                const balanceAfter = balanceBefore + creditUsd;

                await connection.execute(
                    `UPDATE users SET balance = ? WHERE telegram_id = ?`,
                    [balanceAfter, sub.telegram_id]
                );

                const [transactionResult] = await connection.execute(
                    `INSERT INTO transactions (telegram_id, transaction_type, source_id, source_reference, amount_usd, balance_before, balance_after, status, description) VALUES (?, 'gmail_sell', ?, ?, ?, ?, ?, 'completed', ?)`,
                    [sub.telegram_id, sub.id, `GMAIL-${sub.id}`, creditUsd, balanceBefore, balanceAfter, `Gmail Sell Approved #${sub.id} (${sub.category})`]
                );

                const sourceTransactionId = transactionResult.insertId;

                // ==========================================
                // রেফারেল কমিশন সিস্টেম হ্যান্ডলিং
                // ==========================================
                let referralCommission = 0;
                let referrerTelegramId = null;

                const [referrerRows] = await connection.execute(
                    'SELECT referred_by FROM users WHERE telegram_id = ? LIMIT 1',
                    [sub.telegram_id]
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

                const referralPercent = await getReferralPercent(connection);

                if (referrerTelegramId && referrerTelegramId !== String(sub.telegram_id) && referralPercent > 0) {
                    referralCommission = (creditUsd * referralPercent) / 100;

                    const [referrerBalanceRows] = await connection.execute(
                        'SELECT balance FROM users WHERE telegram_id = ? FOR UPDATE',
                        [referrerTelegramId]
                    );

                    if (referrerBalanceRows.length > 0 && referralCommission > 0) {
                        const referrerBefore = Number(referrerBalanceRows[0].balance || 0);
                        const referrerAfter = referrerBefore + referralCommission;

                        const [commissionInsert] = await connection.execute(
                            `INSERT INTO referral_commissions 
                            (source_transaction_id, referrer_telegram_id, referred_telegram_id, commission_percent, source_amount_usd, commission_amount_usd, status) 
                            VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
                            [sourceTransactionId, referrerTelegramId, sub.telegram_id, referralPercent, creditUsd, referralCommission]
                        );

                        await connection.execute(
                            'UPDATE users SET balance = ? WHERE telegram_id = ?',
                            [referrerAfter, referrerTelegramId]
                        );

                        const [commissionTransaction] = await connection.execute(
                            `INSERT INTO transactions 
                            (telegram_id, transaction_type, source_id, source_reference, amount_usd, balance_before, balance_after, status, description) 
                            VALUES (?, 'referral_commission', ?, ?, ?, ?, ?, 'completed', ?)`,
                            [referrerTelegramId, sourceTransactionId, `GMAIL-${sub.id}`, referralCommission, referrerBefore, referrerAfter, `Direct referral commission from Gmail Sell #${sub.id}`]
                        );

                        await connection.execute(
                            'UPDATE referral_commissions SET commission_transaction_id = ? WHERE id = ?',
                            [commissionTransaction.insertId, commissionInsert.insertId]
                        );
                    }
                }

                await connection.execute(
                    `UPDATE gmail_sell_submissions SET status = 'Approved', admin_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [adminNote || null, submissionId]
                );

                await connection.commit();
                return res.json({
                    success: true,
                    message: 'Gmail approved and user balance credited successfully.',
                    submission_id: submissionId,
                    credited_usd: Number(creditUsd.toFixed(4)),
                    referral_commission_usd: Number(referralCommission.toFixed(4))
                });

            } catch (err) {
                await connection.rollback();
                throw err;
            }
        }

        // ৭. এডমিন প্যানেল: রিজেক্ট করা
        if (action === 'admin_reject') {
            await verifyAdmin(connection, tgId);
            const submissionId = numVal(payload.submission_id, 0);
            const adminNote = cleanStr(payload.admin_note, 500);

            await connection.execute(
                `UPDATE gmail_sell_submissions SET status = 'Reject', admin_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [adminNote || null, submissionId]
            );

            return res.json({ success: true, message: 'Gmail submission rejected.' });
        }

        // ৮. এডমিন প্যানেল: কাস্টম জিমেইলের জন্য বাল্ক আপলোড
        if (action === 'admin_bulk_upload_custom') {
            await verifyAdmin(connection, tgId);
            let records = payload.records;

            if (typeof records === 'string') {
                try { records = JSON.parse(records); } catch (e) {
                    return res.status(400).json({ success: false, message: 'Invalid JSON format for records.' });
                }
            }

            if (!Array.isArray(records) || records.length === 0) {
                return res.status(400).json({ success: false, message: 'Records array is required.' });
            }

            let insertedCount = 0;
            for (const item of records) {
                const fullName = cleanStr(item.full_name, 255);
                const username = cleanStr(item.username, 255);
                const password = cleanStr(item.password, 255);

                if (fullName && username && password) {
                    await connection.execute(
                        `INSERT INTO gmail_custom_pool (full_name, gmail_username, password_plain, status) VALUES (?, ?, ?, 'available')`,
                        [fullName, username, password]
                    );
                    insertedCount++;
                }
            }

            return res.json({ success: true, message: `Bulk upload successful. Total inserted: ${insertedCount}` });
        }

        return res.status(400).json({ success: false, message: 'Invalid action command specified for 𝑺𝒐𝒄𝒊𝒂𝒍-𝑿 Gmail module.' });

    } catch (error) {
        console.error('Gmail Sell Module Error:', error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Internal Server Error'
        });
    } finally {
        if (connection) {
            try { await connection.end(); } catch (e) {}
        }
    }
});

module.exports = router;
