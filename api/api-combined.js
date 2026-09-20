const db = require("./db");
const fetch = require("node-fetch");

// ================================================================
// AL-HUDA TECH GLOBAL - Combined API
// One Vercel Serverless Function for the current user-side API files.
// Existing API URLs are preserved through this catch-all route.
// Keep api/db.js as the shared MySQL pool.
// ================================================================

function json(res, status, data) {
    res.status(status);
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(data));
}

async function getBody(req) {
    if (req.body && typeof req.body === "object") return req.body;
    return new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
            try { resolve(JSON.parse(body || "{}")); }
            catch { resolve({}); }
        });
    });
}

/* ======================== add-balance helper ======================== */
async function addBalanceWithTransaction(connection, telegramId, amount, type, description) {
    // ১. একটি ইউনিক ট্রানজেকশন আইডি তৈরি (যেমন: TXN-1718829381928-ABC)
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // ২. ইউজারের মূল ব্যালেন্স বাড়িয়ে দেওয়া
    await connection.execute(
        'UPDATE users SET balance = balance + ? WHERE telegram_id = ?',
        [amount, telegramId]
    );

    // ৩. ট্রানজেকশন টেবিলে অটোমেটিক হিস্টরি বা রেকর্ড সেভ করা
    await connection.execute(
        'INSERT INTO transactions (transaction_id, telegram_id, amount, type, description, status) VALUES (?, ?, ?, ?, ?, ?)',
        [transactionId, telegramId, amount, type, description, 'success']
    );

    return transactionId;
}

/* ===================== verification helpers ======================== */
const botToken = '8332234102:AAEn-gW1WCbt4_a7od8sCvysndE2u3nZtNc';
const channelUsername = '@AHTG_OFFICIAL';
const groupUsername = '@ahtgofic';

async function checkTelegramMembership(chatId, userId) {
    try {
        const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${chatId}&user_id=${userId}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.ok && data.result) {
            const status = data.result.status;
            const validStatuses = ['creator', 'administrator', 'member'];
            return validStatuses.includes(status);
        }
        return false;
    } catch (error) {
        return false;
    }
}

/* ======================== referral helpers ========================= */
// --------------------------------------------------
// Helpers
// --------------------------------------------------

function send(res, status, data) {
    res.status(status).json(data);
}

function getTelegramId(req) {
    return (
        req.query?.telegram_id ||
        req.body?.telegram_id ||
        req.headers["x-telegram-id"] ||
        null
    );
}

async function getUser(connection, telegramId) {
    const [rows] = await connection.execute(
        `
        SELECT
            id,
            telegram_id,
            username,
            first_name,
            role,
            balance,
            referred_by,
            referrals,
            status
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
        `,
        [String(telegramId)]
    );

    return rows[0] || null;
}

async function isAdmin(connection, telegramId) {
    const user = await getUser(connection, telegramId);

    return user && user.role === "admin";
}

async function getReferralSettings(connection) {
    const [rows] = await connection.execute(
        `
        SELECT
            id,
              percentage,
            description,
            updated_at
        FROM referral_settings
        WHERE id = 1
        LIMIT 1
        `
    );

    if (!rows.length) {
        return {
            id: 1,
            percentage: 5.00,
            description:
                "Invite friends and earn commission whenever they receive new balance."
        };
    }

    return rows[0];
}

/* ======================== withdrawal helpers ======================= */
async function withdrawGetBody(req) {
    if (req.body && typeof req.body === "object") {
        return req.body;
    }

    return new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                resolve({});
            }
        });
    });
}

async function withdrawGetUser(telegramId) {
    const [rows] = await db.execute(
        `SELECT
            id,
            telegram_id,
            username,
            first_name,
            role,
            balance,
            status
         FROM users
         WHERE telegram_id = ?
         LIMIT 1`,
        [String(telegramId)]
    );

    return rows[0] || null;
}

async function withdrawGetSettings() {
    const [rows] = await db.execute(
        `SELECT
            id,
            min_withdraw_usd,
            usd_to_bdt_rate,
            withdraw_charge_percent
         FROM withdrawal_settings
         WHERE id = 1
         LIMIT 1`
    );

    if (rows.length) {
        return rows[0];
    }

    await db.execute(
        `INSERT INTO withdrawal_settings
        (
            id,
            min_withdraw_usd,
            usd_to_bdt_rate,
            withdraw_charge_percent
        )
        VALUES (1, 1.00, 100.00, 5.00)`
    );

    return {
        id: 1,
        min_withdraw_usd: 1,
        usd_to_bdt_rate: 100,
        withdraw_charge_percent: 5
    };
}


/* =====================================================================
   FUTURE API EXTENSION AREA
   ---------------------------------------------------------------------
   Future API code should be added ONLY inside FUTURE_APIS below.

   Frontend URL pattern:
       /api/api-combined?route=YOUR_API_NAME

   Example:
       "hello": async ({ req, res, db, body, query, json }) => {
           return json(res, 200, { success: true, message: "Hello" });
       }

   IMPORTANT:
   - Do not edit the main dispatcher below.
   - Do not create another API file for future additions.
   - Each API name must be unique.
   - Keep authentication/authorization checks inside the API handler.
   ===================================================================== */

const FUTURE_APIS = {
    /*
    "YOUR_API_NAME": async ({ req, res, db, body, query, json }) => {
        // Paste your future API logic here.
        return json(res, 200, {
            success: true
        });
    },
    */
};

async function withdrawCheckAdmin(telegramId) {
    if (!telegramId) {
        return null;
    }

    const user = await withdrawGetUser(telegramId);

    if (!user) {
        return null;
    }

    if (user.role !== "admin") {
        return null;
    }

    if (user.status !== "active") {
        return null;
    }

    return user;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const pathname = String(req.url || '').split('?')[0].replace(/\/+$/, '') || '/';

    // Supports BOTH:
    // 1) Legacy URL: /api/check-verification
    // 2) Single API URL: /api/api-combined?route=check-verification
    const urlQuery = String(req.url || '').split('?')[1] || '';
    const routeFromQuery = new URLSearchParams(urlQuery).get('route');

    const route = routeFromQuery || pathname
        .replace(/^\/api\//, '')
        .replace(/^\//, '');

    let body = {};

    try {
        body = await getBody(req);
        const query = req.query || {};

        // Future/custom APIs are resolved here automatically.
        // Existing built-in APIs below remain unchanged.
        const futureApi = FUTURE_APIS[route];
        if (typeof futureApi === 'function') {
            return await futureApi({
                req,
                res,
                db,
                body,
                query,
                json
            });
        }

        /* ============================ add-balance ============================ */
        if (route === 'add-balance') {
            if (req.method !== 'POST') {
                return json(res, 405, { success: false, message: 'Method Not Allowed' });
            }
            const telegramId = body.telegram_id;
            const amount = Number(body.amount);
            const type = String(body.type || 'BALANCE_CREDIT');
            const description = String(body.description || 'Balance added');
            if (!telegramId || !Number.isFinite(amount) || amount <= 0) {
                return json(res, 400, { success: false, message: 'Invalid balance request.' });
            }
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                const transactionId = await addBalanceWithTransaction(connection, String(telegramId), amount, type, description);
                await connection.commit();
                return json(res, 200, { success: true, transaction_id: transactionId });
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        }

        /* ============================ admin-stats =========================== */
        if (route === 'admin-stats') {
            const telegramId = query.telegram_id;
            if (!telegramId) return res.status(400).json({ success: false, message: 'Invalid Telegram ID' });
            const connection = await db.getConnection();
            try {
                const [userRows] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [telegramId]);
                if (userRows.length === 0 || userRows[0].role !== 'admin') {
                    return res.status(403).json({ success: false, message: 'Access Denied: Admins only' });
                }
                const [countRows] = await connection.execute('SELECT COUNT(*) AS totalUsers FROM users');
                const [sumRows] = await connection.execute('SELECT SUM(balance) AS totalBalance FROM users');
                return res.status(200).json({
                    success: true,
                    totalUsers: countRows[0].totalUsers || 0,
                    totalBalance: parseFloat(sumRows[0].totalBalance || 0).toFixed(2)
                });
            } finally {
                connection.release();
            }
        }

        /* ======================== check-verification ======================== */
        if (route === 'check-verification') {
            const telegramId = query.telegram_id;
            if (!telegramId) return res.status(400).json({ success: false, message: 'Invalid Telegram ID' });
            const connection = await db.getConnection();
            try {
                const [rows] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
                if (rows.length === 0) return res.status(404).json({ success: false, message: 'User account not found in database.' });
                const user = rows[0];
                if (user.status === 'banned') {
                    return res.status(200).json({ success: true, verified: false, message: 'Your account has been banned.' });
                }
                const [isChannelMember, isGroupMember] = await Promise.all([
                    checkTelegramMembership(channelUsername, telegramId),
                    checkTelegramMembership(groupUsername, telegramId)
                ]);
                const isVerified = user.role === 'admin' ? true : (isChannelMember && isGroupMember);
                const newTelegramStatus = isVerified ? 'verified' : 'unverified';
                await connection.execute('UPDATE users SET telegram_status = ? WHERE telegram_id = ?', [newTelegramStatus, telegramId]);
                user.telegram_status = newTelegramStatus;
                return res.status(200).json({ success: true, verified: isVerified, role: user.role, userData: user });
            } finally {
                connection.release();
            }
        }

        /* ======================= get-deposit-methods ======================== */
        if (route === 'get-deposit-methods') {
            const connection = await db.getConnection();
            try {
                const [rows] = await connection.execute('SELECT method_name, account_number FROM deposit_methods WHERE is_active = 1');
                const methods = {};
                rows.forEach(row => { methods[row.method_name] = row.account_number; });
                return res.status(200).json({ success: true, methods });
            } finally {
                connection.release();
            }
        }

        /* ============================ submit-deposit ======================== */
        if (route === 'submit-deposit') {
            const connection = await db.getConnection();
            try {
                if (req.method === 'POST') {
                    const { telegram_id, method, send_amount, get_amount, transaction_id } = body || {};
                    if (!telegram_id || !method || !send_amount || !get_amount || !transaction_id) {
                        return res.status(400).json({ success: false, message: 'All fields are required.' });
                    }
                    await connection.execute(
                        `INSERT INTO deposits (telegram_id, method, send_amount, get_amount, transaction_id, status) VALUES (?, ?, ?, ?, ?, ?)`,
                        [String(telegram_id), method, send_amount, get_amount, transaction_id, 'pending']
                    );
                    return res.status(200).json({ success: true, message: 'Deposit request submitted successfully.' });
                }
                if (req.method === 'GET') {
                    const telegram_id = query.telegram_id || query.telegramId;
                    if (!telegram_id) return res.status(400).json({ success: false, message: 'telegram_id is required.' });
                    const [rows] = await connection.execute(
                        `SELECT id, telegram_id, method, send_amount, get_amount, transaction_id, status, created_at FROM deposits WHERE telegram_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
                        [String(telegram_id)]
                    );
                    return res.status(200).json({ success: true, deposits: rows });
                                  }
                return res.status(405).json({ success: false, message: 'Method Not Allowed' });
            } finally {
                connection.release();
            }
        }

        /* ================================= referral ========================= */
        if (route === 'referral') {
            const connection = await db.getConnection();
            try {
                const action = query.action || body.action || 'user-info';

                if (action === 'user-info') {
                    const telegramId = query.telegram_id || body.telegram_id || req.headers['x-telegram-id'] || null;
                    if (!telegramId) return json(res, 400, { success: false, message: 'Telegram ID is required.' });
                    const user = await getUser(connection, telegramId);
                    if (!user) return json(res, 404, { success: false, message: 'User not found.' });
                    const settings = await getReferralSettings(connection);
                    const [referralRows] = await connection.execute(`SELECT COUNT(*) AS total FROM users WHERE referred_by = ?`, [String(user.telegram_id)]);
                    const totalReferrals = Number(referralRows[0]?.total || 0);
                    let referrer = null;
                    if (user.referred_by) {
                        const [referrerRows] = await connection.execute(`SELECT telegram_id, username, first_name FROM users WHERE telegram_id = ? LIMIT 1`, [String(user.referred_by)]);
                        if (referrerRows.length) referrer = referrerRows[0];
                    }
                    return json(res, 200, {
                        success: true,
                        user: { telegram_id: user.telegram_id, username: user.username, first_name: user.first_name, balance: Number(user.balance || 0), referred_by: user.referred_by || null, referrals: totalReferrals },
                        referral: { percentage: Number(settings.percentage || 0), description: settings.description || '', total_referrals: totalReferrals, referred_by: user.referred_by || null, referrer }
                    });
                }

                if (action === 'admin-get') {
                    const telegramId = query.telegram_id || body.telegram_id || req.headers['x-telegram-id'] || null;
                    if (!telegramId) return json(res, 400, { success: false, message: 'Telegram ID is required.' });
                    const admin = await isAdmin(connection, telegramId);
                    if (!admin) return json(res, 403, { success: false, message: 'Admin access required.' });
                    const settings = await getReferralSettings(connection);
                    return json(res, 200, { success: true, settings: { percentage: Number(settings.percentage || 0), description: settings.description || '', updated_at: settings.updated_at || null } });
                }

                if (action === 'admin-update') {
                    const telegramId = query.telegram_id || body.telegram_id || req.headers['x-telegram-id'] || null;
                    if (!telegramId) return json(res, 400, { success: false, message: 'Telegram ID is required.' });
                    const admin = await isAdmin(connection, telegramId);
                    if (!admin) return json(res, 403, { success: false, message: 'Admin access required.' });
                    const percentage = Number(body.percentage ?? query.percentage);
                    const description = body.description ?? query.description;
                    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return json(res, 400, { success: false, message: 'Percentage must be between 0 and 100.' });
                    if (typeof description !== 'string' || description.trim().length === 0) return json(res, 400, { success: false, message: 'Referral description is required.' });
                    if (description.trim().length > 2000) return json(res, 400, { success: false, message: 'Referral description is too long.' });
                    await connection.execute(
                        `INSERT INTO referral_settings (id, percentage, description) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE percentage = VALUES(percentage), description = VALUES(description)`,
                        [percentage.toFixed(2), description.trim()]
                    );
                    const settings = await getReferralSettings(connection);
                    return json(res, 200, { success: true, message: 'Referral settings updated successfully.', settings: { percentage: Number(settings.percentage || 0), description: settings.description || '', updated_at: settings.updated_at || null } });
                }

                if (action === 'admin-stats') {
                    const telegramId = query.telegram_id || body.telegram_id || req.headers['x-telegram-id'] || null;
                    if (!telegramId) return json(res, 400, { success: false, message: 'Telegram ID is required.' });
                    const admin = await isAdmin(connection, telegramId);
                    if (!admin) return json(res, 403, { success: false, message: 'Admin access required.' });
                    const settings = await getReferralSettings(connection);
                    const [totalReferralsRows] = await connection.execute(`SELECT COUNT(*) AS total FROM users WHERE referred_by IS NOT NULL AND referred_by != ''`);
                    const [totalCommissionRows] = await connection.execute(`SELECT COALESCE(SUM(commission_amount), 0) AS total FROM referral_commissions`);
                    const [commissionCountRows] = await connection.execute(`SELECT COUNT(*) AS total FROM referral_commissions`);
                    return json(res, 200, {
                        success: true,
                        settings: { percentage: Number(settings.percentage || 0), description: settings.description || '' },
                        statistics: { total_referrals: Number(totalReferralsRows[0]?.total || 0), total_commissions: Number(totalCommissionRows[0]?.total || 0), commission_count: Number(commissionCountRows[0]?.total || 0) }
                    });
                }

                return json(res, 400, { success: false, message: 'Invalid referral API action.' });
            } finally {
                connection.release();
            }
        }

        /* ================================= withdraw ========================== */
        if (route === 'withdraw') {
            res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
    );

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    let body = {};

    try {
        body = await withdrawGetBody(req);

        const query = req.query || {};

        const action =
            body.action ||
            query.action ||
            "";
                           /*
        =====================================================
        USER INFO
        =====================================================
        */

        if (action === "info") {

            const telegramId =
                body.telegram_id ||
                query.telegram_id;
                      
            if (!telegramId) {
                return json(res, 400, {
                    success: false,
                    message: "Telegram ID is required."
                });
            }

            const user = await withdrawGetUser(telegramId);

            if (!user) {
                return json(res, 404, {
                    success: false,
                    message: "User not found."
                });
            }

            const settings = await withdrawGetSettings();

            return json(res, 200, {
                success: true,

                user: {
                    telegram_id: user.telegram_id,
                    username: user.username,
                    first_name: user.first_name
                },

                balance: Number(user.balance || 0),

                settings: {
                    min_withdraw_usd:
                        Number(settings.min_withdraw_usd),

                    usd_to_bdt_rate:
                        Number(settings.usd_to_bdt_rate),

                    withdraw_charge_percent:
                        Number(
                            settings.withdraw_charge_percent
                        )
                }
            });
        }


        /*
        =====================================================
        USER WITHDRAW HISTORY
        =====================================================
        */

        if (action === "history") {

            const telegramId =
                body.telegram_id ||
                query.telegram_id;

            if (!telegramId) {
                return json(res, 400, {
                    success: false,
                    message: "Telegram ID is required."
                });
            }

            const [rows] = await db.execute(
                `SELECT
                    id,
                    method,
                    account_number,
                    amount_usd,
                    usd_to_bdt_rate,
                    gross_bdt,
                    charge_percent,
                    charge_bdt,
                    net_bdt,
                    status,
                    admin_note,
                    created_at,
                    processed_at
                 FROM withdrawals
                 WHERE telegram_id = ?
                 ORDER BY id DESC`,
                [String(telegramId)]
            );

            return json(res, 200, {
                success: true,
                withdrawals: rows
            });
        }


        /*
        =====================================================
        USER SUBMIT WITHDRAWAL
        =====================================================
        */

        if (action === "submit") {

            const telegramId =
                body.telegram_id;

            const method =
                String(body.method || "").trim();

            const accountNumber =
                String(body.account_number || "").trim();

            const amount =
                Number(body.amount_usd);

            if (
                !telegramId ||
                !method ||
                !accountNumber ||
                !body.amount_usd
            ) {
                return json(res, 400, {
                    success: false,
                    message: "All fields are required."
                                  });
            }

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return json(res, 400, {
                    success: false,
                    message: "Invalid withdrawal amount."
                });
            }

            const allowedMethods = [
                "bKash",
                "Nagad",
                "Rocket",
                "Upay",
                "USDT-BEP20",
                "USDT-TRC20"
            ];

            if (!allowedMethods.includes(method)) {
                return json(res, 400, {
                    success: false,
                    message: "Invalid withdrawal method."
                });
            }

            const user = await withdrawGetUser(telegramId);

            if (!user) {
                return json(res, 404, {
                    success: false,
                    message: "User account not found."
                });
            }

            if (user.status !== "active") {
                return json(res, 403, {
                    success: false,
                    message: "Your account is not active."
                });
            }

            const settings = await withdrawGetSettings();

            const minimum =
                Number(settings.min_withdraw_usd);

            const rate =
                Number(settings.usd_to_bdt_rate);

            const chargePercent =
                Number(settings.withdraw_charge_percent);

            if (amount < minimum) {
                return json(res, 400, {
                    success: false,
                    message:
                        `Minimum withdrawal is $${minimum.toFixed(2)}.`
                });
            }

            const gross =
                amount * rate;

            const charge =
                gross * chargePercent / 100;

            const net =
                gross - charge;


            /*
            ================================================
            TRANSACTION START
            ================================================
            */

            const connection =
                await db.getConnection();

            try {

                await connection.beginTransaction();


                /*
                Lock user balance.
                */

                const [lockedUsers] =
                    await connection.execute(
                        `SELECT balance
                         FROM users
                         WHERE telegram_id = ?
                         FOR UPDATE`,
                        [String(telegramId)]
                    );

                if (!lockedUsers.length) {
                    throw new Error(
                        "User account not found."
                    );
                }

                const balance =
                    Number(
                        lockedUsers[0].balance || 0
                    );

                if (amount > balance) {
                    throw new Error(
                        "Insufficient balance."
                    );
                }


                /*
                Deduct balance immediately.
                The amount will be refunded if admin rejects.
                              */

                await connection.execute(
                    `UPDATE users
                     SET balance = balance - ?
                     WHERE telegram_id = ?`,
                    [
                        amount,
                        String(telegramId)
                    ]
                );


                /*
                Create withdrawal request.
                */

                const [result] =
                    await connection.execute(
                        `INSERT INTO withdrawals
                        (
                            telegram_id,
                            method,
                            account_number,
                            amount_usd,
                            usd_to_bdt_rate,
                            gross_bdt,
                            charge_percent,
                            charge_bdt,
                            net_bdt,
                            status
                        )
                        VALUES
                        (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                        [
                            String(telegramId),
                            method,
                            accountNumber,
                            amount,
                            rate,
                            gross,
                            chargePercent,
                            charge,
                            net
                        ]
                    );


                await connection.commit();

                return json(res, 200, {
                    success: true,
                    message:
                        "Withdrawal request submitted successfully.",

                    withdrawal_id:
                        result.insertId,

                    amount_usd:
                        Number(amount.toFixed(2)),

                    gross_bdt:
                        Number(gross.toFixed(2)),

                    charge_bdt:
                        Number(charge.toFixed(2)),

                    net_bdt:
                        Number(net.toFixed(2))
                });

            } catch (error) {

                await connection.rollback();

                throw error;

            } finally {

                connection.release();
            }
        }
        /*
        =====================================================
        ADMIN LIST
        =====================================================
        */

        if (action === "admin-list") {

            const adminId =
                body.telegram_id ||
                query.telegram_id;

            const admin =
                await withdrawCheckAdmin(adminId);

            if (!admin) {
                return json(res, 403, {
                    success: false,
                    message: "Unauthorized access."
                });
            }

            const [rows] =
                await db.execute(
                    `SELECT
                        id,
                        telegram_id,
                        method,
                        account_number,
                        amount_usd,
                        usd_to_bdt_rate,
                        gross_bdt,
                        charge_percent,
                        charge_bdt,
                        net_bdt,
                        status,
                        admin_note,
                                                created_at,
                        processed_at
                     FROM withdrawals
                     WHERE status = 'pending'
                     ORDER BY id ASC`
                );

            return json(res, 200, {
                success: true,
                withdrawals: rows
            });
        }


        /*
        =====================================================
        ADMIN SETTINGS GET
        =====================================================
        */

        if (action === "admin-settings-get") {

            const adminId =
                body.telegram_id ||
                query.telegram_id;

            const admin =
                await withdrawCheckAdmin(adminId);

            if (!admin) {
                return json(res, 403, {
                    success: false,
                    message: "Unauthorized access."
                });
            }

            const settings =
                await withdrawGetSettings();

            return json(res, 200, {
                success: true,
                settings: {
                    min_withdraw_usd:
                        Number(settings.min_withdraw_usd),

                    usd_to_bdt_rate:
                        Number(settings.usd_to_bdt_rate),

                    withdraw_charge_percent:
                        Number(
                            settings.withdraw_charge_percent
                        )
                }
            });
        }


        /*
        =====================================================
        ADMIN SETTINGS UPDATE
        =====================================================
        */

        if (action === "admin-settings-update") {

            const adminId =
                body.telegram_id;

            const admin =
                await withdrawCheckAdmin(adminId);

            if (!admin) {
                return json(res, 403, {
                    success: false,
                    message: "Unauthorized access."
                });
            }

            const minimum =
                Number(body.min_withdraw_usd);

            const rate =
                Number(body.usd_to_bdt_rate);

            const charge =
                Number(body.withdraw_charge_percent);

            if (
                !Number.isFinite(minimum) ||
                minimum <= 0
            ) {
                return json(res, 400, {
                    success: false,
                    message:
                        "Invalid minimum withdrawal."
                });
            }

            if (
                !Number.isFinite(rate) ||
                rate <= 0
            ) {
                return json(res, 400, {
                    success: false,
                    message:
                        "Invalid USD to BDT rate."
                });
            }

            if (
                !Number.isFinite(charge) ||
                charge < 0 ||
                charge > 100
            ) {
                return json(res, 400, {
                    success: false,
                    message:
                        "Invalid withdrawal charge."
                });
            }

            await db.execute(
                                  `UPDATE withdrawal_settings
                 SET
                    min_withdraw_usd = ?,
                    usd_to_bdt_rate = ?,
                    withdraw_charge_percent = ?
                 WHERE id = 1`,
                [
                    minimum,
                    rate,
                    charge
                ]
            );

            return json(res, 200, {
                success: true,
                message:
                    "Withdrawal settings updated successfully."
            });
        }


        /*
        =====================================================
        ADMIN APPROVE / REJECT
        =====================================================
        */

        if (action === "admin-process") {

            const adminId =
                body.telegram_id;

            const withdrawalId =
                Number(body.withdrawal_id);

            const processAction =
                String(
                    body.process_action || ""
                ).toLowerCase();

            const adminNote =
                String(
                    body.admin_note || ""
                ).trim();

            const admin =
                await withdrawCheckAdmin(adminId);

            if (!admin) {
                return json(res, 403, {
                    success: false,
                    message: "Unauthorized access."
                });
            }

            if (
                !withdrawalId ||
                !["approve", "reject"]
                    .includes(processAction)
            ) {
                return json(res, 400, {
                    success: false,
                    message:
                        "Invalid withdrawal request."
                });
            }

            const connection =
                await db.getConnection();

            try {

                await connection.beginTransaction();


                /*
                Lock withdrawal row.
                */

                const [rows] =
                    await connection.execute(
                        `SELECT *
                         FROM withdrawals
                         WHERE id = ?
                         FOR UPDATE`,
                        [withdrawalId]
                    );

                if (!rows.length) {
                    throw new Error(
                        "Withdrawal request not found."
                    );
                }

                const withdrawal =
                    rows[0];


                /*
                Prevent duplicate processing.
                */

                if (
                    withdrawal.status !==
                    "pending"
                ) {
                    throw new Error(
                        "This withdrawal has already been processed."
                    );
                }


                /*
                APPROVE
                */

                if (
                    processAction ===
                    "approve"
                ) {

                    await connection.execute(
                                      `UPDATE withdrawals
                         SET
                            status = 'approved',
                            admin_note = ?,
                            processed_at = NOW()
                         WHERE id = ?
                         AND status = 'pending'`,
                        [
                            adminNote || null,
                            withdrawalId
                        ]
                    );

                    await connection.commit();

                    return json(res, 200, {
                        success: true,
                        message:
                            "Withdrawal approved successfully."
                    });
                }


                /*
                REJECT
                */

                if (
                    processAction ===
                    "reject"
                ) {

                    /*
                    Refund the exact USD amount
                    previously deducted.
                    */

                    await connection.execute(
                        `UPDATE users
                         SET balance = balance + ?
                         WHERE telegram_id = ?`,
                        [
                            Number(
                                withdrawal.amount_usd
                            ),
                            String(
                                withdrawal.telegram_id
                            )
                        ]
                    );


                    await connection.execute(
                        `UPDATE withdrawals
                         SET
                            status = 'rejected',
                            admin_note = ?,
                            processed_at = NOW()
                         WHERE id = ?
                         AND status = 'pending'`,
                        [
                            adminNote || null,
                            withdrawalId
                        ]
                    );


                    await connection.commit();

                    return json(res, 200, {
                        success: true,
                        message:
                            "Withdrawal rejected and balance refunded."
                    });
                }

            } catch (error) {

                await connection.rollback();

                throw error;

            } finally {

                connection.release();
            }
        }


        /*
        =====================================================
        UNKNOWN ACTION
        =====================================================
        */

        return json(res, 400, {
            success: false,
            message: "Invalid action."
        });

    } catch (error) {

        console.error(
            "Withdrawal API Error:",
            error
        );

        return json(res, 500, {
            success: false,
            message:
                error.message ||
                "Internal server error."
        });
    }
        }

        return json(res, 404, { success: false, message: 'API endpoint not found.' });
    } catch (error) {
        console.error('Combined API Error:', error);
        return json(res, 500, { success: false, message: error.message || 'Internal server error.' });
    }
};

        
