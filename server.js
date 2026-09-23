const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const app = express();
const PORT = process.env.PORT || 3000;

// সরাসরি কোডের ভেতরে ডাটাবেজ কনফিগারেশন সেট করা হলো
const dbConfig = {
    host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
    port: 14363,
    user: 'avnadmin',
    password: 'AVNS_hhfXItvXPam49_lMnOU',
    database: 'defaultdb',
    ssl: {
        rejectUnauthorized: false
    }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/')));

// ============================================================
// ১. GET USER API
// ============================================================
app.get('/api/get-user', async (req, res) => {
    const tgId = req.query.tg_id;
    if (!tgId) {
        return res.status(400).json({
            success: false,
            message: 'Telegram ID is missing.'
        });
    }
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            [tgId]
        );
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User account not found. Please start the bot first.'
            });
        }
        const user = rows[0];
        if (user.telegram_verified !== 'verified') {
            return res.status(403).json({
                success: false,
                message: 'Please join our channel and group, then verify your account via the bot.'
            });
        }
        let settings = {
            referral_percentage: 5.00,
            referral_notice: ''
        };
        try {
            const [settingsRows] = await connection.execute(
                'SELECT referral_percentage, referral_notice FROM settings WHERE id = 1'
            );
            if (settingsRows.length > 0) {
                settings = settingsRows[0];
            }
        } catch (err) {
            console.log('Settings table fetch note: Using default values.');
        }
        res.json({
            success: true,
            user: user,
            settings: settings
        });
    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error: ' + error.message
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});
// ============================================================
// DEPOSIT API
// ============================================================
app.all('/api/deposit', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            message: 'Method Not Allowed'
        });
    }
    const body = req.method === 'POST' ? req.body : req.query;
    const action = body.action;
    const tgId = body.tg_id;
    let connection;
    const closeConnection = async () => {
        if (connection) {
            try {
                await connection.end();
            } catch (e) {}
            connection = null;
        }
    };
    try {
        connection = await mysql.createConnection(dbConfig);
        const requireUser = async (telegramId) => {
            if (!telegramId) {
                throw new Error('Telegram ID is required');
            }
            const [rows] = await connection.execute(
                'SELECT * FROM users WHERE telegram_id = ? LIMIT 1',
                [telegramId]
            );
            if (rows.length === 0) {
                throw new Error('User not found');
            }
            return rows[0];
        };
        const requireAdmin = async (telegramId) => {
            const user = await requireUser(telegramId);
            if (user.role !== 'admin') {
                const error = new Error('Unauthorized: Admin access required');
                error.statusCode = 403;
                throw error;
            }
            return user;
        };

        if (action === 'get_deposit_data') {
            const user = await requireUser(tgId);
            const [settingsRows] = await connection.execute(
                `SELECT id, minimum_deposit_bdt, usd_rate,
                        deposit_charge_percent, deposit_rules
                 FROM deposit_settings
                 WHERE id = 1
                 LIMIT 1`
            );
            const [methods] = await connection.execute(
                `SELECT id, method_code, method_name, payment_account,
                        currency, enabled, sort_order
                 FROM deposit_methods
                 WHERE enabled = 1
                 ORDER BY sort_order ASC, id ASC`
            );
            const [history] = await connection.execute(
                `SELECT id, method_code, method_name, currency,
                        payment_amount, exchange_rate, gross_usd,
                        charge_percent, charge_usd, net_usd,
                        transaction_id, transaction_note, status,
                        admin_note, reviewed_at, created_at, updated_at
                 FROM deposit_requests
                 WHERE telegram_id = ?
                 ORDER BY id DESC`,
                [tgId]
            );
            return res.json({
                success: true,
                user: {
                    telegram_id: user.telegram_id,
                    balance: user.balance
                },
                settings: settingsRows[0] || {
                    minimum_deposit_bdt: 130,
                    usd_rate: 130,
                    deposit_charge_percent: 0,
                    deposit_rules: ''
                },
                methods,
                history
            });
        }

        if (action === 'submit_deposit') {
            await requireUser(tgId);
            const methodCode = String(body.method_code || '').trim();
            const transactionId = String(body.transaction_id || '').trim();
            const transactionNote = String(body.transaction_note || '').trim();
            const paymentAmount = Number(body.payment_amount);
            if (!methodCode || !transactionId) {
                return res.status(400).json({
                    success: false,
                    message: 'Payment method and transaction ID/hash are required.'
                });
            }
            if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid deposit amount.'
                });
            }
            const [settingsRows] = await connection.execute(
                `SELECT minimum_deposit_bdt, usd_rate,
                        deposit_charge_percent
                 FROM deposit_settings
                 WHERE id = 1
                 LIMIT 1`
            );
            if (settingsRows.length === 0) {
                return res.status(500).json({
                    success: false,
                    message: 'Deposit settings are not configured.'
                });
            }
            const settings = settingsRows[0];
            const [methodRows] = await connection.execute(
                `SELECT method_code, method_name, payment_account,
                        currency, enabled
                 FROM deposit_methods
                 WHERE method_code = ?
                 LIMIT 1`,
                [methodCode]
            );
            if (methodRows.length === 0 || Number(methodRows[0].enabled) !== 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Selected deposit method is not available.'
                });
            }
            const method = methodRows[0];
            let exchangeRate = 1;
            let grossUsd = paymentAmount;
            if (method.currency === 'BDT') {
                exchangeRate = Number(settings.usd_rate);
                if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
                    return res.status(500).json({
                        success: false,
                        message: 'Invalid USD exchange rate.'
                    });
                }
                const minimumBdt = Number(settings.minimum_deposit_bdt);
                if (paymentAmount < minimumBdt) {
                    return res.status(400).json({
                        success: false,
                        message: `Minimum deposit is ${minimumBdt.toFixed(2)} BDT.`
                    });
                }
                grossUsd = paymentAmount / exchangeRate;
            }
            const chargePercent = Math.max(0, Number(settings.deposit_charge_percent || 0));
            const chargeUsd = grossUsd * chargePercent / 100;
            const netUsd = grossUsd - chargeUsd;
            if (netUsd <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Deposit amount after charge must be greater than zero.'
                });
            }
            const user = await requireUser(tgId);
            const [duplicateRows] = await connection.execute(
                `SELECT id FROM deposit_requests WHERE method_code = ? AND transaction_id = ? AND status IN ('pending', 'approved') LIMIT 1`,
                [methodCode, transactionId]
            );
            if (duplicateRows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'This transaction ID/hash has already been submitted.'
                });
            }
            const [result] = await connection.execute(
                `INSERT INTO deposit_requests
                (telegram_id, username, first_name, method_code, method_name, payment_account, currency, payment_amount, exchange_rate, gross_usd, charge_percent, charge_usd, net_usd, transaction_id, transaction_note, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [tgId, user.username || null, user.first_name || null, method.method_code, method.method_name, method.payment_account || null, method.currency, paymentAmount, exchangeRate, grossUsd, chargePercent, chargeUsd, netUsd, transactionId, transactionNote || null]
            );
            return res.json({
                success: true,
                message: 'Deposit submitted successfully. It is pending admin verification.',
                deposit_id: result.insertId,
                calculation: {
                    payment_amount: paymentAmount,
                    currency: method.currency,
                    exchange_rate: exchangeRate,
                    gross_usd: Number(grossUsd.toFixed(4)),
                    charge_percent: chargePercent,
                    charge_usd: Number(chargeUsd.toFixed(4)),
                    net_usd: Number(netUsd.toFixed(4))
                }
            });
      }
                  if (action === 'get_admin_deposit_data') {
            await requireAdmin(tgId);
            const [settingsRows] = await connection.execute(
                `SELECT id, minimum_deposit_bdt, usd_rate, deposit_charge_percent, deposit_rules, updated_at FROM deposit_settings WHERE id = 1 LIMIT 1`
            );
            const [methods] = await connection.execute(
                `SELECT id, method_code, method_name, payment_account, currency, enabled, sort_order, created_at, updated_at FROM deposit_methods ORDER BY sort_order ASC, id ASC`
            );
            const [requests] = await connection.execute(
                `SELECT id, telegram_id, username, first_name, method_code, method_name, payment_account, currency, payment_amount, exchange_rate, gross_usd, charge_percent, charge_usd, net_usd, transaction_id, transaction_note, status, admin_telegram_id, admin_note, reviewed_at, created_at, updated_at FROM deposit_requests ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, id DESC`
            );
            return res.json({
                success: true,
                settings: settingsRows[0] || null,
                methods,
                requests
            });
        }

        if (action === 'update_deposit_settings') {
            await requireAdmin(tgId);
            const minimumDepositBdt = Number(body.minimum_deposit_bdt);
            const usdRate = Number(body.usd_rate);
            const chargePercent = Number(body.deposit_charge_percent);
            const depositRules = String(body.deposit_rules || '').trim();
            if (!Number.isFinite(minimumDepositBdt) || minimumDepositBdt <= 0 || !Number.isFinite(usdRate) || usdRate <= 0 || !Number.isFinite(chargePercent) || chargePercent < 0 || chargePercent > 100) {
                return res.status(400).json({ success: false, message: 'Invalid deposit settings.' });
            }
            await connection.execute(
                `INSERT INTO deposit_settings (id, minimum_deposit_bdt, usd_rate, deposit_charge_percent, deposit_rules) VALUES (1, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE minimum_deposit_bdt = VALUES(minimum_deposit_bdt), usd_rate = VALUES(usd_rate), deposit_charge_percent = VALUES(deposit_charge_percent), deposit_rules = VALUES(deposit_rules)`,
                [minimumDepositBdt, usdRate, chargePercent, depositRules]
            );
            return res.json({ success: true, message: 'Deposit settings updated successfully.' });
        }

        if (action === 'update_deposit_method') {
            await requireAdmin(tgId);
            const methodCode = String(body.method_code || '').trim();
            const paymentAccount = String(body.payment_account || '').trim();
            const enabled = Number(body.enabled) === 1 ? 1 : 0;
            const sortOrder = Number(body.sort_order || 0);
            if (!methodCode) {
                return res.status(400).json({ success: false, message: 'Method code is required.' });
            }
            const [result] = await connection.execute(
                `UPDATE deposit_methods SET payment_account = ?, enabled = ?, sort_order = ? WHERE method_code = ?`,
                [paymentAccount, enabled, sortOrder, methodCode]
            );
            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Deposit method not found.' });
            }
            return res.json({ success: true, message: 'Deposit method updated successfully.' });
        }

        if (action === 'approve_deposit') {
            const admin = await requireAdmin(tgId);
            const depositId = Number(body.deposit_id);
            if (!Number.isInteger(depositId) || depositId <= 0) {
                return res.status(400).json({ success: false, message: 'Valid deposit ID is required.' });
            }
            await connection.beginTransaction();
            try {
                const [depositRows] = await connection.execute(`SELECT * FROM deposit_requests WHERE id = ? FOR UPDATE`, [depositId]);
                if (depositRows.length === 0) throw new Error('Deposit request not found.');
                const deposit = depositRows[0];
                if (deposit.status !== 'pending') throw new Error(`This deposit has already been ${deposit.status}.`);
                const creditUsd = Number(deposit.net_usd);
                if (!Number.isFinite(creditUsd) || creditUsd <= 0) throw new Error('Invalid deposit credit amount.');

                const [userRows] = await connection.execute(`SELECT * FROM users WHERE telegram_id = ? FOR UPDATE`, [deposit.telegram_id]);
                if (userRows.length === 0) throw new Error('Deposit user not found.');
                const user = userRows[0];
                const balanceBefore = Number(user.balance || 0);
                const balanceAfter = balanceBefore + creditUsd;

                await connection.execute(`UPDATE users SET balance = ? WHERE telegram_id = ?`, [balanceAfter, deposit.telegram_id]);

                const [transactionResult] = await connection.execute(
                    `INSERT INTO transactions (telegram_id, transaction_type, source_id, source_reference, amount_usd, balance_before, balance_after, status, description) VALUES (?, 'deposit', ?, ?, ?, ?, ?, 'completed', ?)`,
                    [deposit.telegram_id, deposit.id, deposit.transaction_id, creditUsd, balanceBefore, balanceAfter, `Deposit #${deposit.id} approved via ${deposit.method_name}`]
                );
                const sourceTransactionId = transactionResult.insertId;

                let referralCommission = 0;
let referrerTelegramId = null;

const [referrerRows] = await connection.execute(
    `SELECT referred_by FROM users WHERE telegram_id = ? LIMIT 1`,
    [deposit.telegram_id]
);

if (referrerRows.length > 0 && referrerRows[0].referred_by) {
    const referralCode = String(referrerRows[0].referred_by).trim();

    const [referrerUserRows] = await connection.execute(
        `SELECT telegram_id FROM users WHERE referral_code = ? LIMIT 1`,
        [referralCode]
    );

    if (referrerUserRows.length > 0) {
        referrerTelegramId = String(referrerUserRows[0].telegram_id);
    }
}
                const [referralSettingsRows] = await connection.execute(`SELECT referral_percentage FROM settings WHERE id = 1 LIMIT 1`);
                const referralPercent = referralSettingsRows.length > 0 ? Number(referralSettingsRows[0].referral_percentage || 0) : 0;

                if (referrerTelegramId && referrerTelegramId !== String(deposit.telegram_id) && Number.isFinite(referralPercent) && referralPercent > 0) {
                    referralCommission = creditUsd * referralPercent / 100;
                    const [referrerUserRows] = await connection.execute(`SELECT balance FROM users WHERE telegram_id = ? FOR UPDATE`, [referrerTelegramId]);
                    if (referrerUserRows.length > 0) {
                        const referrerBefore = Number(referrerUserRows[0].balance || 0);
                        const referrerAfter = referrerBefore + referralCommission;
                        const [commissionInsert] = await connection.execute(
                            `INSERT INTO referral_commissions (source_transaction_id, referrer_telegram_id, referred_telegram_id, commission_percent, source_amount_usd, commission_amount_usd, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
                            [sourceTransactionId, referrerTelegramId, deposit.telegram_id, referralPercent, creditUsd, referralCommission]
                        );
                        await connection.execute(`UPDATE users SET balance = ? WHERE telegram_id = ?`, [referrerAfter, referrerTelegramId]);
                        const [commissionTransaction] = await connection.execute(
                            `INSERT INTO transactions (telegram_id, transaction_type, source_id, source_reference, amount_usd, balance_before, balance_after, status, description) VALUES (?, 'referral_commission', ?, ?, ?, ?, ?, 'completed', ?)`,
                            [referrerTelegramId, sourceTransactionId, String(deposit.id), referralCommission, referrerBefore, referrerAfter, `Direct referral commission from user ${deposit.telegram_id}`]
                        );
                        await connection.execute(`UPDATE referral_commissions SET commission_transaction_id = ? WHERE id = ?`, [commissionTransaction.insertId, commissionInsert.insertId]);
                    }
                }

                await connection.execute(
                    `UPDATE deposit_requests SET status = 'approved', admin_telegram_id = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`,
                    [admin.telegram_id, body.admin_note ? String(body.admin_note) : null, depositId]
                );
                await connection.commit();
                return res.json({
                    success: true,
                    message: 'Deposit approved and balance credited successfully.',
                    deposit_id: depositId,
                    credited_usd: Number(creditUsd.toFixed(4)),
                    referral_commission_usd: Number(referralCommission.toFixed(4))
                });
            } catch (transactionError) {
                try { await connection.rollback(); } catch (e) {}
                throw transactionError;
            }
        }

        if (action === 'reject_deposit') {
            const admin = await requireAdmin(tgId);
            const depositId = Number(body.deposit_id);
            const adminNote = String(body.admin_note || '').trim();
            if (!Number.isInteger(depositId) || depositId <= 0) {
                return res.status(400).json({ success: false, message: 'Valid deposit ID is required.' });
            }
            const [result] = await connection.execute(
                `UPDATE deposit_requests SET status = 'rejected', admin_telegram_id = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`,
                [admin.telegram_id, adminNote || null, depositId]
            );
            if (result.affectedRows === 0) {
                return res.status(409).json({ success: false, message: 'Deposit not found or it has already been processed.' });
            }
            return res.json({ success: true, message: 'Deposit rejected successfully.' });
        }
        return res.status(400).json({ success: false, message: 'Invalid deposit action.' });
    } catch (error) {
        console.error('Deposit API Error:', error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
    } finally {
        await closeConnection();
    }
});
// ============================================================
// WITHDRAW + EXCHANGE API
// ============================================================
app.all('/api/withdraw', async (req, res) => {

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            message: 'Method Not Allowed'
        });
    }

    const body = req.method === 'POST'
        ? req.body
        : req.query;

    const action = body.action;
    const tgId = body.tg_id;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        // ====================================================
        // USER CHECK
        // ====================================================
        const requireUser = async (telegramId) => {

            if (!telegramId) {
                throw new Error('Telegram ID is required');
            }

            const [rows] = await connection.execute(
                `SELECT *
                 FROM users
                 WHERE telegram_id = ?
                 LIMIT 1`,
                [telegramId]
            );

            if (rows.length === 0) {
                throw new Error('User not found');
            }

            return rows[0];
        };


        // ====================================================
        // ADMIN CHECK
        // ====================================================
        const requireAdmin = async (telegramId) => {

            const user = await requireUser(telegramId);

            if (user.role !== 'admin') {

                const error = new Error(
                    'Unauthorized: Admin access required'
                );

                error.statusCode = 403;

                throw error;
            }

            return user;
        };
                // ====================================================
        // 1. GET WITHDRAW DATA
        // ====================================================
        if (action === 'get_withdraw_data') {

            const user = await requireUser(tgId);

            // Withdraw settings
            const [settingsRows] = await connection.execute(
                `SELECT *
                 FROM withdraw_settings
                 WHERE id = 1
                 LIMIT 1`
            );


            // Withdraw methods
            const [methods] = await connection.execute(
                `SELECT *
                 FROM withdraw_methods
                 WHERE enabled = 1
                 ORDER BY sort_order ASC, id ASC`
            );


            // User withdraw history
            const [history] = await connection.execute(
                `SELECT *
                 FROM withdraw_requests
                 WHERE telegram_id = ?
                 ORDER BY id DESC`,
                [tgId]
            );


            // Exchange balance
            const [exchangeRows] = await connection.execute(
                `SELECT balance_bdt
                 FROM exchange_balances
                 WHERE telegram_id = ?
                 LIMIT 1`,
                [tgId]
            );


            const exchangeBalance =
                exchangeRows.length > 0
                    ? Number(exchangeRows[0].balance_bdt || 0)
                    : 0;


            return res.json({

                success: true,

                main_balance:
                    Number(user.balance || 0),

                exchange_balance:
                    Number(exchangeBalance.toFixed(2)),

                settings:
                    settingsRows[0] || null,

                methods,

                history

            });
        }
                // ====================================================
        // 2. EXCHANGE USD TO BDT
        // ====================================================
        if (action === 'exchange_usd') {

            await requireUser(tgId);

            const usdAmount =
                Number(body.usd_amount);


            if (
                !Number.isFinite(usdAmount) ||
                usdAmount <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid USD amount.'
                });
            }


            const [settingsRows] =
                await connection.execute(
                    `SELECT *
                     FROM withdraw_settings
                     WHERE id = 1
                     LIMIT 1`
                );


            if (settingsRows.length === 0) {
                return res.status(500).json({
                    success: false,
                    message:
                        'Withdraw settings are not configured.'
                });
            }


            const settings =
                settingsRows[0];


            const exchangeRate =
                Number(settings.exchange_rate_bdt);


            if (
                !Number.isFinite(exchangeRate) ||
                exchangeRate <= 0
            ) {
                return res.status(500).json({
                    success: false,
                    message: 'Invalid exchange rate.'
                });
            }


            // =================================================
            // EXCHANGE FEE
            // =================================================

            const exchangeFeeType =
                settings.exchange_fee_type || 'percent';

            const exchangeFeeValue =
                Number(settings.exchange_fee_value || 0);


            let exchangeFeeUsd = 0;


            if (exchangeFeeType === 'percent') {

                exchangeFeeUsd =
                    usdAmount *
                    exchangeFeeValue /
                    100;

            } else {

                exchangeFeeUsd =
                    exchangeFeeValue;
            }


            if (exchangeFeeUsd < 0) {
                exchangeFeeUsd = 0;
            }


            if (exchangeFeeUsd >= usdAmount) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Exchange fee cannot be equal to or greater than the exchange amount.'
                });
            }


            const netUsd =
                usdAmount - exchangeFeeUsd;


            const grossBdt =
                usdAmount * exchangeRate;


            const netBdt =
                netUsd * exchangeRate;


            // =================================================
            // TRANSACTION START
            // =================================================

            await connection.beginTransaction();

            try {

                const [userRows] =
                    await connection.execute(
                        `SELECT balance
                         FROM users
                         WHERE telegram_id = ?
                         FOR UPDATE`,
                        [tgId]
                    );


                if (userRows.length === 0) {
                    throw new Error('User not found.');
                }


                const oldMainBalance =
                    Number(userRows[0].balance || 0);


                if (oldMainBalance < usdAmount) {
                    throw new Error(
                        'Insufficient main balance.'
                    );
                }


                const newMainBalance =
                    oldMainBalance - usdAmount;


                // Main balance থেকে USD কাটা
                await connection.execute(
                    `UPDATE users
                     SET balance = ?
                     WHERE telegram_id = ?`,
                    [
                        newMainBalance,
                        tgId
                    ]
                );


                // Exchange balance row তৈরি
                await connection.execute(
                    `INSERT INTO exchange_balances
                    (
                        telegram_id,
                        balance_bdt
                    )
                    VALUES (?, 0)
                    ON DUPLICATE KEY UPDATE
                        telegram_id = telegram_id`,
                    [tgId]
                );


                const [exchangeRows] =
                    await connection.execute(
                        `SELECT balance_bdt
                         FROM exchange_balances
                         WHERE telegram_id = ?
                         FOR UPDATE`,
                        [tgId]
                    );


                const oldExchangeBalance =
                    Number(
                        exchangeRows[0].balance_bdt || 0
                    );


                const newExchangeBalance =
                    oldExchangeBalance + netBdt;


                // Exchange balance-এ BDT যোগ
                await connection.execute(
                    `UPDATE exchange_balances
                     SET balance_bdt = ?
                     WHERE telegram_id = ?`,
                    [
                        newExchangeBalance,
                        tgId
                    ]
                );
                                // =================================================
                // EXCHANGE TRANSACTION LOG
                // =================================================

                await connection.execute(
                    `INSERT INTO exchange_transactions
                    (
                        telegram_id,
                        usd_amount,
                        exchange_rate,
                        gross_bdt,
                        fee_type,
                        fee_value,
                        fee_usd,
                        net_usd,
                        credited_bdt
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        tgId,
                        usdAmount,
                        exchangeRate,
                        grossBdt,
                        exchangeFeeType,
                        exchangeFeeValue,
                        exchangeFeeUsd,
                        netUsd,
                        netBdt
                    ]
                );


                // Main transaction
                await connection.execute(
                    `INSERT INTO transactions
                    (
                        telegram_id,
                        transaction_type,
                        source_id,
                        source_reference,
                        amount_usd,
                        balance_before,
                        balance_after,
                        status,
                        description
                    )
                    VALUES
                    (
                        ?,
                        'exchange',
                        NULL,
                        NULL,
                        ?,
                        ?,
                        ?,
                        'completed',
                        ?
                    )`,
                    [
                        tgId,
                        -usdAmount,
                        oldMainBalance,
                        newMainBalance,
                        `Exchanged $${usdAmount.toFixed(4)} USD to BDT`
                    ]
                );


                await connection.commit();


                return res.json({

                    success: true,

                    message:
                        'Exchange completed successfully.',

                    usd_amount:
                        Number(
                            usdAmount.toFixed(4)
                        ),

                    exchange_fee_usd:
                        Number(
                            exchangeFeeUsd.toFixed(4)
                        ),

                    net_usd:
                        Number(
                            netUsd.toFixed(4)
                        ),

                    exchange_rate:
                        Number(
                            exchangeRate.toFixed(4)
                        ),

                    gross_bdt:
                        Number(
                            grossBdt.toFixed(2)
                        ),

                    credited_bdt:
                        Number(
                            netBdt.toFixed(2)
                        ),

                    main_balance:
                        Number(
                            newMainBalance.toFixed(4)
                        ),

                    exchange_balance:
                        Number(
                            newExchangeBalance.toFixed(2)
                        )

                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
        }
                // ====================================================
        // 3. SUBMIT WITHDRAW REQUEST
        // ====================================================
        if (action === 'submit_withdraw') {

            await requireUser(tgId);

            const methodCode =
                String(
                    body.method_code || ''
                ).trim();


            const amount =
                Number(body.amount);


            const accountNumber =
                String(
                    body.account_number || ''
                ).trim();


            const sourceBalance =
                String(
                    body.source_balance || 'main'
                ).trim();


            if (!methodCode) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Withdraw method is required.'
                });
            }


            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Please enter a valid amount.'
                });
            }


            if (!accountNumber) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Account number or wallet address is required.'
                });
            }


            const [settingsRows] =
                await connection.execute(
                    `SELECT *
                     FROM withdraw_settings
                     WHERE id = 1
                     LIMIT 1`
                );


            if (settingsRows.length === 0) {
                return res.status(500).json({
                    success: false,
                    message:
                        'Withdraw settings are not configured.'
                });
            }


            const settings =
                settingsRows[0];


            const [methodRows] =
                await connection.execute(
                    `SELECT *
                     FROM withdraw_methods
                     WHERE method_code = ?
                     AND enabled = 1
                     LIMIT 1`,
                    [methodCode]
                );


            if (methodRows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Selected withdraw method is unavailable.'
                });
            }


            const method =
                methodRows[0];


            // =================================================
            // USDT WITHDRAW
            // Only BEP20 / TRX
            // =================================================

            if (
                methodCode === 'bep20' ||
                methodCode === 'trx'
            ) {

                if (sourceBalance !== 'main') {
                    return res.status(400).json({
                        success: false,
                        message:
                            'USDT withdrawal must use main balance.'
                    });
                }


                const minimumUsdt =
                    Number(
                        settings.minimum_usdt_withdraw_usd || 0
                    );


                const maximumUsdt =
                    Number(
                        settings.max_usdt_withdraw_usd || 0
                    );


                if (
                    minimumUsdt > 0 &&
                    amount < minimumUsdt
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            `Minimum USDT withdrawal is $${minimumUsdt.toFixed(2)}.`
                    });
                }


                if (
                    maximumUsdt > 0 &&
                    amount > maximumUsdt
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            `Maximum USDT withdrawal is $${maximumUsdt.toFixed(2)}.`
                    });
                }


                // ---------------------------------------------
                // USDT Withdraw Charge
                // ---------------------------------------------

                const usdtChargePercent =
                    Number(
                        settings.usdt_withdraw_charge_percent || 0
                    );


                const chargeUsd =
                    amount *
                    usdtChargePercent /
                    100;


                const netUsd =
                    amount - chargeUsd;


                if (netUsd <= 0) {
                    return res.status(400).json({
                        success: false,
                        message:
                            'Amount after USDT withdrawal charge must be greater than zero.'
                    });
                }


                await connection.beginTransaction();

                try {

                    const [userRows] =
                        await connection.execute(
                            `SELECT balance
                             FROM users
                             WHERE telegram_id = ?
                             FOR UPDATE`,
                            [tgId]
                        );


                    if (userRows.length === 0) {
                        throw new Error(
                            'User not found.'
                        );
                    }


                    const oldBalance =
                        Number(
                            userRows[0].balance || 0
                        );


                    if (oldBalance < amount) {
                        throw new Error(
                            'Insufficient main balance.'
                        );
                    }


                    const newBalance =
                        oldBalance - amount;


                    // -----------------------------------------
                    // Balance immediately deducted
                    // -----------------------------------------

                    await connection.execute(
                        `UPDATE users
                         SET balance = ?
                         WHERE telegram_id = ?`,
                        [
                            newBalance,
                            tgId
                        ]
                    );


                    // -----------------------------------------
                    // Withdraw Request
                    // -----------------------------------------

                    const [result] =
                        await connection.execute(
                            `INSERT INTO withdraw_requests
                            (
                                telegram_id,
                                method_code,
                                method_name,
                                source_balance,
                                account_number,
                                requested_amount,
                                exchange_rate,
                                charge_percent,
                                charge_amount,
                                net_amount,
                                currency,
                                status
                            )
                            VALUES
                            (
                                ?,
                                ?,
                                ?,
                                'main',
                                ?,
                                ?,
                                1,
                                ?,
                                ?,
                                ?,
                                'USD',
                                'pending'
                            )`,
                            [
                                tgId,
                                methodCode,
                                method.method_name,
                                accountNumber,
                                amount,
                                usdtChargePercent,
                                chargeUsd,
                                netUsd
                            ]
                        );
                                        // -----------------------------------------
                    // Transaction Ledger
                    // -----------------------------------------

                    await connection.execute(
                        `INSERT INTO transactions
                        (
                            telegram_id,
                            transaction_type,
                            source_id,
                            source_reference,
                            amount_usd,
                            balance_before,
                            balance_after,
                            status,
                            description
                        )
                        VALUES
                        (
                            ?,
                            'withdraw',
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            'pending',
                            ?
                        )`,
                        [
                            tgId,
                            result.insertId,
                            accountNumber,
                            -amount,
                            oldBalance,
                            newBalance,
                            `USDT withdrawal request via ${method.method_name}`
                        ]
                    );


                    await connection.commit();


                    return res.json({

                        success: true,

                        message:
                            'USDT withdraw request submitted successfully.',

                        withdraw_id:
                            result.insertId,

                        requested_amount:
                            Number(
                                amount.toFixed(4)
                            ),

                        charge_percent:
                            Number(
                                usdtChargePercent.toFixed(2)
                            ),

                        charge:
                            Number(
                                chargeUsd.toFixed(4)
                            ),

                        receivable:
                            Number(
                                netUsd.toFixed(4)
                            ),

                        balance:
                            Number(
                                newBalance.toFixed(4)
                            )

                    });

                } catch (error) {

                    try {
                        await connection.rollback();
                    } catch (e) {}

                    throw error;
                }
            }


            // =================================================
            // BDT WITHDRAW
            // bKash / Nagad / Rocket / Upay
            // =================================================

            const bdtMethods = [
                'bkash',
                'nagad',
                'rocket',
                'upay'
            ];


            if (!bdtMethods.includes(methodCode)) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Invalid BDT withdrawal method.'
                });
            }


            if (sourceBalance !== 'exchange') {
                return res.status(400).json({
                    success: false,
                    message:
                        'BDT withdrawal must use exchange balance.'
                });
            }


            const minimumBdt =
                Number(
                    settings.minimum_bdt_withdraw || 0
                );


            const maximumBdt =
                Number(
                    settings.max_exchange_withdraw_bdt || 0
                );


            if (
                minimumBdt > 0 &&
                amount < minimumBdt
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        `Minimum BDT withdrawal is ৳${minimumBdt.toFixed(2)}.`
                });
            }


            if (
                maximumBdt > 0 &&
                amount > maximumBdt
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        `Maximum BDT withdrawal is ৳${maximumBdt.toFixed(2)}.`
                });
            }


            // -----------------------------------------------
            // BDT Withdraw Charge
            // -----------------------------------------------

            const bdtChargePercent =
                Number(
                    settings.bdt_withdraw_charge_percent || 0
                );


            const chargeBdt =
                amount *
                bdtChargePercent /
                100;


            const netBdt =
                amount - chargeBdt;


            if (netBdt <= 0) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Amount after BDT withdrawal charge must be greater than zero.'
                });
            }


            await connection.beginTransaction();

            try {

                const [exchangeRows] =
                    await connection.execute(
                        `SELECT balance_bdt
                         FROM exchange_balances
                         WHERE telegram_id = ?
                         FOR UPDATE`,
                        [tgId]
                    );


                if (exchangeRows.length === 0) {
                    throw new Error(
                        'Exchange balance not found.'
                    );
                }


                const oldExchangeBalance =
                    Number(
                        exchangeRows[0].balance_bdt || 0
                    );


                if (oldExchangeBalance < amount) {
                    throw new Error(
                        'Insufficient exchange balance.'
                    );
                }


                const newExchangeBalance =
                    oldExchangeBalance - amount;


                // -------------------------------------------
                // Exchange Balance immediately deducted
                // -------------------------------------------

                await connection.execute(
                    `UPDATE exchange_balances
                     SET balance_bdt = ?
                     WHERE telegram_id = ?`,
                    [
                        newExchangeBalance,
                        tgId
                    ]
                );


                const [result] =
                    await connection.execute(
                        `INSERT INTO withdraw_requests
                        (
                            telegram_id,
                            method_code,
                            method_name,
                            source_balance,
                            account_number,
                            requested_amount,
                            exchange_rate,
                            charge_percent,
                            charge_amount,
                            net_amount,
                            currency,
                            status
                        )
                        VALUES
                        (
                            ?,
                            ?,
                            ?,
                            'exchange',
                            ?,
                            ?,
                            1,
                            ?,
                            ?,
                            ?,
                            'BDT',
                            'pending'
                        )`,
                        [
                            tgId,
                            methodCode,
                            method.method_name,
                            accountNumber,
                            amount,
                            bdtChargePercent,
                            chargeBdt,
                            netBdt
                        ]
                    );
                                // -------------------------------------------
                // BDT Transaction Ledger
                // -------------------------------------------

                await connection.execute(
                    `INSERT INTO transactions
                    (
                        telegram_id,
                        transaction_type,
                        source_id,
                        source_reference,
                        amount_usd,
                        balance_before,
                        balance_after,
                        status,
                        description
                    )
                    VALUES
                    (
                        ?,
                        'exchange_withdraw',
                        ?,
                        ?,
                        0,
                        ?,
                        ?,
                        'pending',
                        ?
                    )`,
                    [
                        tgId,
                        result.insertId,
                        accountNumber,
                        oldExchangeBalance,
                        newExchangeBalance,
                        `BDT withdrawal request via ${method.method_name}`
                    ]
                );


                await connection.commit();


                return res.json({

                    success: true,

                    message:
                        'BDT withdraw request submitted successfully.',

                    withdraw_id:
                        result.insertId,

                    requested_amount:
                        Number(
                            amount.toFixed(2)
                        ),

                    charge_percent:
                        Number(
                            bdtChargePercent.toFixed(2)
                        ),

                    charge:
                        Number(
                            chargeBdt.toFixed(2)
                        ),

                    receivable:
                        Number(
                            netBdt.toFixed(2)
                        ),

                    exchange_balance:
                        Number(
                            newExchangeBalance.toFixed(2)
                        )

                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
        }


        // ====================================================
        // 4. ADMIN: GET WITHDRAW DATA
        // ====================================================
        if (action === 'get_admin_withdraw_data') {

            await requireAdmin(tgId);


            const [settingsRows] =
                await connection.execute(
                    `SELECT *
                     FROM withdraw_settings
                     WHERE id = 1
                     LIMIT 1`
                );


            const [methods] =
                await connection.execute(
                    `SELECT *
                     FROM withdraw_methods
                     ORDER BY sort_order ASC, id ASC`
                );


            const [requests] =
                await connection.execute(
                    `SELECT *
                     FROM withdraw_requests
                     ORDER BY
                     CASE
                         WHEN status = 'pending'
                         THEN 0
                         ELSE 1
                     END,
                     id DESC`
                );


            return res.json({

                success: true,

                settings:
                    settingsRows[0] || null,

                methods,

                requests

            });
        }
                // ====================================================
        // 5. ADMIN: UPDATE WITHDRAW SETTINGS
        // ====================================================
        if (action === 'update_withdraw_settings') {

            await requireAdmin(tgId);


            const minimumUsdt =
                Number(
                    body.minimum_usdt_withdraw_usd || 0
                );


            const maximumUsdt =
                Number(
                    body.max_usdt_withdraw_usd || 0
                );


            const minimumBdt =
                Number(
                    body.minimum_bdt_withdraw || 0
                );


            const maximumBdt =
                Number(
                    body.max_exchange_withdraw_bdt || 0
                );


            const exchangeRate =
                Number(
                    body.exchange_rate_bdt || 0
                );


            // ================================================
            // SEPARATE USDT WITHDRAW CHARGE
            // ================================================

            const usdtWithdrawCharge =
                Number(
                    body.usdt_withdraw_charge_percent || 0
                );


            // ================================================
            // SEPARATE BDT WITHDRAW CHARGE
            // ================================================

            const bdtWithdrawCharge =
                Number(
                    body.bdt_withdraw_charge_percent || 0
                );


            // ================================================
            // EXCHANGE FEE
            // ================================================

            const exchangeFeeType =
                String(
                    body.exchange_fee_type || 'percent'
                ).trim();


            const exchangeFeeValue =
                Number(
                    body.exchange_fee_value || 0
                );


            const withdrawRules =
                String(
                    body.withdraw_rules || ''
                ).trim();


            // ================================================
            // VALIDATION
            // ================================================

            if (
                !Number.isFinite(exchangeRate) ||
                exchangeRate <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Invalid exchange rate.'
                });
            }


            if (
                !Number.isFinite(usdtWithdrawCharge) ||
                usdtWithdrawCharge < 0 ||
                usdtWithdrawCharge > 100
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Invalid USDT withdrawal charge.'
                });
            }


            if (
                !Number.isFinite(bdtWithdrawCharge) ||
                bdtWithdrawCharge < 0 ||
                bdtWithdrawCharge > 100
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Invalid BDT withdrawal charge.'
                });
            }


            if (
                exchangeFeeType !== 'percent' &&
                exchangeFeeType !== 'fixed'
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Invalid exchange fee type.'
                });
            }


            if (
                !Number.isFinite(exchangeFeeValue) ||
                exchangeFeeValue < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Invalid exchange fee value.'
                });
            }


            // ================================================
            // SAVE SETTINGS
            // ================================================

            await connection.execute(
                `INSERT INTO withdraw_settings
                (
                    id,
                    minimum_usdt_withdraw_usd,
                    max_usdt_withdraw_usd,
                    minimum_bdt_withdraw,
                    max_exchange_withdraw_bdt,
                    exchange_rate_bdt,
                    usdt_withdraw_charge_percent,
                    bdt_withdraw_charge_percent,
                    exchange_fee_type,
                    exchange_fee_value,
                    withdraw_rules
                )
                VALUES
                (
                    1,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?
                )
                ON DUPLICATE KEY UPDATE

                    minimum_usdt_withdraw_usd =
                        VALUES(minimum_usdt_withdraw_usd),

                    max_usdt_withdraw_usd =
                        VALUES(max_usdt_withdraw_usd),

                    minimum_bdt_withdraw =
                        VALUES(minimum_bdt_withdraw),

                    max_exchange_withdraw_bdt =
                        VALUES(max_exchange_withdraw_bdt),

                    exchange_rate_bdt =
                        VALUES(exchange_rate_bdt),

                    usdt_withdraw_charge_percent =
                        VALUES(usdt_withdraw_charge_percent),

                    bdt_withdraw_charge_percent =
                        VALUES(bdt_withdraw_charge_percent),

                    exchange_fee_type =
                        VALUES(exchange_fee_type),

                    exchange_fee_value =
                        VALUES(exchange_fee_value),

                    withdraw_rules =
                        VALUES(withdraw_rules)`,
                [
                    1,
                    minimumUsdt,
                    maximumUsdt,
                    minimumBdt,
                    maximumBdt,
                    exchangeRate,
                    usdtWithdrawCharge,
                    bdtWithdrawCharge,
                    exchangeFeeType,
                    exchangeFeeValue,
                    withdrawRules
                ]
            );


            return res.json({

                success: true,

                message:
                    'Withdraw settings updated successfully.'

            });
                    }
                // ====================================================
        // 6. ADMIN: UPDATE WITHDRAW METHOD
        // ====================================================
        if (action === 'update_withdraw_method') {

            await requireAdmin(tgId);


            const methodCode =
                String(
                    body.method_code || ''
                ).trim();


            const enabled =
                Number(body.enabled) === 1
                    ? 1
                    : 0;


            const sortOrder =
                Number(
                    body.sort_order || 0
                );


            if (!methodCode) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Method code is required.'
                });
            }


            const [result] =
                await connection.execute(
                    `UPDATE withdraw_methods
                     SET
                        enabled = ?,
                        sort_order = ?
                     WHERE method_code = ?`,
                    [
                        enabled,
                        sortOrder,
                        methodCode
                    ]
                );


            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Withdraw method not found.'
                });
            }


            return res.json({

                success: true,

                message:
                    'Withdraw method updated successfully.'

            });
        }
                // ====================================================
        // 7. ADMIN: APPROVE WITHDRAW
        // ====================================================
        if (action === 'approve_withdraw') {

            const admin =
                await requireAdmin(tgId);


            const withdrawId =
                Number(
                    body.withdraw_id
                );


            if (
                !Number.isInteger(withdrawId) ||
                withdrawId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid withdraw ID is required.'
                });
            }


            await connection.beginTransaction();

            try {

                const [rows] =
                    await connection.execute(
                        `SELECT *
                         FROM withdraw_requests
                         WHERE id = ?
                         FOR UPDATE`,
                        [withdrawId]
                    );


                if (rows.length === 0) {
                    throw new Error(
                        'Withdraw request not found.'
                    );
                }


                const request =
                    rows[0];


                if (request.status !== 'pending') {
                    throw new Error(
                        `This withdrawal has already been ${request.status}.`
                    );
                }


                // --------------------------------------------
                // Balance already deducted at request time.
                // Therefore approve does NOT deduct again.
                // --------------------------------------------

                await connection.execute(
                    `UPDATE withdraw_requests
                     SET
                        status = 'approved',
                        admin_telegram_id = ?,
                        admin_note = ?,
                        reviewed_at = CURRENT_TIMESTAMP
                     WHERE id = ?
                     AND status = 'pending'`,
                    [
                        admin.telegram_id,
                        body.admin_note
                            ? String(body.admin_note)
                            : null,
                        withdrawId
                    ]
                );


                await connection.execute(
                    `UPDATE transactions
                     SET status = 'completed'
                     WHERE source_id = ?
                     AND transaction_type IN
                     (
                        'withdraw',
                        'exchange_withdraw'
                     )
                     AND status = 'pending'`,
                    [withdrawId]
                );


                await connection.commit();


                return res.json({

                    success: true,

                    message:
                        'Withdraw approved successfully.',

                    withdraw_id:
                        withdrawId

                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
        }
                // ====================================================
        // 8. ADMIN: REJECT WITHDRAW
        // ====================================================
        if (action === 'reject_withdraw') {

            const admin =
                await requireAdmin(tgId);


            const withdrawId =
                Number(
                    body.withdraw_id
                );


            if (
                !Number.isInteger(withdrawId) ||
                withdrawId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid withdraw ID is required.'
                });
            }


            await connection.beginTransaction();

            try {

                const [rows] =
                    await connection.execute(
                        `SELECT *
                         FROM withdraw_requests
                         WHERE id = ?
                         FOR UPDATE`,
                        [withdrawId]
                    );


                if (rows.length === 0) {
                    throw new Error(
                        'Withdraw request not found.'
                    );
                }


                const request =
                    rows[0];


                if (request.status !== 'pending') {
                    throw new Error(
                        `This withdrawal has already been ${request.status}.`
                    );
                }


                // ============================================
                // MAIN USD BALANCE REFUND
                // ============================================

                if (
                    request.source_balance === 'main'
                ) {

                    const [userRows] =
                        await connection.execute(
                            `SELECT balance
                             FROM users
                             WHERE telegram_id = ?
                             FOR UPDATE`,
                            [request.telegram_id]
                        );


                    if (userRows.length === 0) {
                        throw new Error(
                            'User not found.'
                        );
                    }


                    const oldBalance =
                        Number(
                            userRows[0].balance || 0
                        );


                    // Return NET amount only.
                    // Charge remains deducted.

                    const refundAmount =
                        Number(
                            request.net_amount || 0
                        );


                    const newBalance =
                        oldBalance +
                        refundAmount;


                    await connection.execute(
                        `UPDATE users
                         SET balance = ?
                         WHERE telegram_id = ?`,
                        [
                            newBalance,
                            request.telegram_id
                        ]
                    );


                    await connection.execute(
                        `INSERT INTO transactions
                        (
                            telegram_id,
                            transaction_type,
                            source_id,
                            source_reference,
                            amount_usd,
                            balance_before,
                            balance_after,
                            status,
                            description
                        )
                        VALUES
                        (
                            ?,
                            'withdraw_refund',
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            'completed',
                            ?
                        )`,
                        [
                            request.telegram_id,
                            request.id,
                            request.account_number,
                            refundAmount,
                            oldBalance,
                            newBalance,
                            `Refund for rejected withdrawal #${request.id}. Charge retained.`
                        ]
                    );
                }


                // ============================================
                // EXCHANGE BDT BALANCE REFUND
                // ============================================

                if (
                    request.source_balance === 'exchange'
                ) {

                    const [exchangeRows] =
                        await connection.execute(
                            `SELECT balance_bdt
                             FROM exchange_balances
                             WHERE telegram_id = ?
                             FOR UPDATE`,
                            [request.telegram_id]
                        );


                    if (exchangeRows.length === 0) {
                        throw new Error(
                            'Exchange balance not found.'
                        );
                    }


                    const oldBalance =
                        Number(
                            exchangeRows[0].balance_bdt || 0
                        );


                    // Return NET BDT only.
                    // Charge remains deducted.

                    const refundAmount =
                        Number(
                            request.net_amount || 0
                        );


                    const newBalance =
                        oldBalance +
                        refundAmount;


                    await connection.execute(
                        `UPDATE exchange_balances
                         SET balance_bdt = ?
                         WHERE telegram_id = ?`,
                        [
                            newBalance,
                            request.telegram_id
                        ]
                    );


                    await connection.execute(
                        `INSERT INTO transactions
                        (
                            telegram_id,
                            transaction_type,
                            source_id,
                            source_reference,
                            amount_usd,
                            balance_before,
                            balance_after,
                            status,
                            description
                        )
                        VALUES
                        (
                            ?,
                            'exchange_withdraw_refund',
                            ?,
                            ?,
                            0,
                            ?,
                            ?,
                            'completed',
                            ?
                        )`,
                        [
                            request.telegram_id,
                            request.id,
                            request.account_number,
                            oldBalance,
                            newBalance,
                            `Refund for rejected BDT withdrawal #${request.id}. Charge retained.`
                        ]
                    );
                }
                                // ============================================
                // UPDATE WITHDRAW STATUS
                // ============================================

                await connection.execute(
                    `UPDATE withdraw_requests
                     SET
                        status = 'rejected',
                        admin_telegram_id = ?,
                        admin_note = ?,
                        reviewed_at = CURRENT_TIMESTAMP
                     WHERE id = ?
                     AND status = 'pending'`,
                    [
                        admin.telegram_id,
                        body.admin_note
                            ? String(body.admin_note)
                            : null,
                        withdrawId
                    ]
                );


                // Original pending transaction
                // is now rejected

                await connection.execute(
                    `UPDATE transactions
                     SET status = 'rejected'
                     WHERE source_id = ?
                     AND transaction_type IN
                     (
                        'withdraw',
                        'exchange_withdraw'
                     )
                     AND status = 'pending'`,
                    [withdrawId]
                );


                await connection.commit();


                return res.json({

                    success: true,

                    message:
                        'Withdraw rejected. Net amount refunded and charge retained.',

                    withdraw_id:
                        withdrawId

                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
        }


        // ====================================================
        // INVALID ACTION
        // ====================================================

        return res.status(400).json({
            success: false,
            message:
                'Invalid withdraw action.'
        });


    } catch (error) {

        console.error(
            'Withdraw API Error:',
            error
        );


        try {
            if (connection) {
                await connection.rollback();
            }
        } catch (e) {}


        return res.status(
            error.statusCode || 500
        ).json({

            success: false,

            message:
                error.message ||
                'Internal Server Error'

        });


    } finally {

        if (connection) {

            try {
                await connection.end();
            } catch (e) {}

        }
    }
});
// ============================================================
// INSTAGRAM SELL API - SECTION 1
// Helpers + Security + Common Functions
// ============================================================

const crypto = require('crypto');

// IMPORTANT:
// Set INSTAGRAM_CREDENTIAL_KEY in your hosting environment.
// Do not use a public/shared key in production.
const INSTAGRAM_CREDENTIAL_KEY =
    process.env.INSTAGRAM_CREDENTIAL_KEY ||
    'CHANGE_THIS_AHTG_INSTAGRAM_CREDENTIAL_KEY_2026';

const INSTAGRAM_ENCRYPTION_KEY = crypto
    .createHash('sha256')
    .update(INSTAGRAM_CREDENTIAL_KEY)
    .digest();

function encryptInstagramSecret(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        INSTAGRAM_ENCRYPTION_KEY,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return [
        iv.toString('base64'),
        authTag.toString('base64'),
        encrypted.toString('base64')
    ].join('.');
}

function decryptInstagramSecret(value) {
    if (!value) {
        return '';
    }

    try {
        const parts = String(value).split('.');

        if (parts.length !== 3) {
            return '';
        }

        const iv = Buffer.from(parts[0], 'base64');
        const authTag = Buffer.from(parts[1], 'base64');
        const encrypted = Buffer.from(parts[2], 'base64');

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            INSTAGRAM_ENCRYPTION_KEY,
            iv
        );

        decipher.setAuthTag(authTag);

        return Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]).toString('utf8');

    } catch (error) {
        console.error('Instagram credential decrypt error:', error);
        return '';
    }
}

function instagramCleanString(value, maxLength = 500) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value)
        .trim()
        .slice(0, maxLength);
}

function instagramNumber(value, fallback = 0) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
        return fallback;
    }

    return n;
}

async function instagramRequireUser(connection, tgId) {

    if (!tgId) {
        const error = new Error('Telegram ID is required.');
        error.statusCode = 400;
        throw error;
    }

    const [rows] = await connection.execute(
        `
        SELECT
            id,
            telegram_id,
            username,
            first_name,
            balance,
            role,
            status,
            telegram_verified,
            referral_code,
            referred_by
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
        `,
        [tgId]
    );

    if (rows.length === 0) {
        const error = new Error('User account not found.');
        error.statusCode = 404;
        throw error;
    }

    const user = rows[0];

    if (
        user.status &&
        String(user.status).toLowerCase() !== 'active'
    ) {
        const error = new Error('Your account is not active.');
        error.statusCode = 403;
        throw error;
    }

    return user;
}

async function instagramRequireAdmin(connection, tgId) {

    const user = await instagramRequireUser(connection, tgId);

    if (String(user.role).toLowerCase() !== 'admin') {
        const error = new Error('Admin access required.');
        error.statusCode = 403;
        throw error;
    }

    return user;
}

async function instagramGetSettings(connection) {

    const [rows] = await connection.execute(
        `
        SELECT *
        FROM instagram_settings
        WHERE id = 1
        LIMIT 1
        `
    );

    if (rows.length === 0) {
        return {
            id: 1,
            rate_usd: 0.00,
            tutorial_url: '',
            instructions: '',
            task_limit: 0,
            assignment_timeout_minutes: 60,
            enabled: 1
        };
    }

    return rows[0];
}

async function instagramGetReferralPercent(connection) {

    const [rows] = await connection.execute(
        `
        SELECT referral_percentage
        FROM settings
        WHERE id = 1
        LIMIT 1
        `
    );

    if (rows.length === 0) {
        return 0;
    }

    const percentage = Number(
        rows[0].referral_percentage || 0
    );

    if (!Number.isFinite(percentage) || percentage < 0) {
        return 0;
    }

    return percentage;
    }
// ============================================================
// INSTAGRAM SELL API - SECTION 2
// Main Route + Settings
// ============================================================

app.all('/api/instagram', async (req, res) => {

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            message: 'Method Not Allowed'
        });
    }

    const body = req.method === 'POST'
        ? req.body
        : req.query;

    const action = body.action;
    const tgId = body.tg_id;

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        // ====================================================
        // GET SETTINGS
        // ====================================================

        if (action === 'get_settings') {

            const user = await instagramRequireUser(
                connection,
                tgId
            );

            const settings = await instagramGetSettings(
                connection
            );

            const [countRows] = await connection.execute(
                `
                SELECT COUNT(*) AS available_count
                FROM instagram_account_pool
                WHERE status = 'available'
                AND assigned_tg_id IS NULL
                `
            );

            const availableCount =
                Number(countRows[0]?.available_count || 0);

            return res.json({
                success: true,

                settings: {
                    rate_usd: Number(
                        settings.rate_usd || 0
                    ),

                    tutorial_url:
                        settings.tutorial_url || '',

                    instructions:
                        settings.instructions || '',

                    task_limit:
                        Number(settings.task_limit || 0),

                    available_count:
                        availableCount,

                    enabled:
                        Number(settings.enabled || 0) === 1
                }
            });
        }

        // ====================================================
        // ADMIN UPDATE SETTINGS
        // ====================================================

        if (action === 'admin_update_settings') {

            const admin = await instagramRequireAdmin(
                connection,
                tgId
            );

            const rateUsd = instagramNumber(
                body.rate_usd,
                0
            );

            const taskLimit = Math.max(
                0,
                Math.floor(
                    instagramNumber(
                        body.task_limit,
                        0
                    )
                )
            );

            const assignmentTimeout = Math.max(
                1,
                Math.floor(
                    instagramNumber(
                        body.assignment_timeout_minutes,
                        60
                    )
                )
            );

            const tutorialUrl =
                instagramCleanString(
                    body.tutorial_url,
                    1000
                );

            const instructions =
                instagramCleanString(
                    body.instructions,
                    10000
                );

            const enabled =
                Number(body.enabled) === 0 ? 0 : 1;

            if (
                !Number.isFinite(rateUsd) ||
                rateUsd < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid Instagram rate.'
                });
            }

            await connection.execute(
                `
                INSERT INTO instagram_settings
                (
                    id,
                    rate_usd,
                    tutorial_url,
                    instructions,
                    task_limit,
                    assignment_timeout_minutes,
                    enabled
                )
                VALUES
                (1, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    rate_usd = VALUES(rate_usd),
                    tutorial_url = VALUES(tutorial_url),
                    instructions = VALUES(instructions),
                    task_limit = VALUES(task_limit),
                    assignment_timeout_minutes =
                        VALUES(assignment_timeout_minutes),
                    enabled = VALUES(enabled)
                `,
                [
                    rateUsd,
                    tutorialUrl,
                    instructions,
                    taskLimit,
                    assignmentTimeout,
                    enabled
                ]
            );

            return res.json({
                success: true,
                message: 'Instagram settings updated successfully.',
                updated_by: admin.telegram_id
            });
        }

        // ====================================================
        // UNKNOWN ACTION
        // ====================================================

        if (!action) {
            return res.status(400).json({
                success: false,
                message: 'Instagram action is required.'
            });
        }

        // Remaining Instagram actions are handled below.
                // ====================================================
        // GET / ASSIGN CURRENT INSTAGRAM TASK
        // ====================================================

        if (action === 'get_task') {

            const user = await instagramRequireUser(
                connection,
                tgId
            );

            const settings =
                await instagramGetSettings(connection);

            if (Number(settings.enabled || 0) !== 1) {

                return res.json({
                    success: true,
                    available: false,
                    message: 'Instagram Sell is currently unavailable.'
                });
            }

            await connection.beginTransaction();

            try {

                // ------------------------------------------------
                // First check whether this user already has
                // an active assignment.
                // ------------------------------------------------

                const [existingRows] =
                    await connection.execute(
                        `
                        SELECT *
                        FROM instagram_account_pool
                        WHERE assigned_tg_id = ?
                        AND status = 'assigned'
                        ORDER BY assigned_at ASC
                        LIMIT 1
                        FOR UPDATE
                        `,
                        [user.telegram_id]
                    );

                let account = null;

                if (existingRows.length > 0) {

                    account = existingRows[0];

                } else {

                    // --------------------------------------------
                    // Release expired assignments first.
                    // --------------------------------------------

                    const timeoutMinutes =
                        Math.max(
                            1,
                            Number(
                                settings.assignment_timeout_minutes || 60
                            )
                        );

                    await connection.execute(
                        `
                        UPDATE instagram_account_pool
                        SET
                            assigned_tg_id = NULL,
                            assigned_at = NULL,
                            status = 'available'
                        WHERE status = 'assigned'
                        AND assigned_at IS NOT NULL
                        AND assigned_at <
                            DATE_SUB(
                                CURRENT_TIMESTAMP,
                                INTERVAL ? MINUTE
                            )
                        `,
                        [timeoutMinutes]
                    );

                    // --------------------------------------------
                    // Assign the oldest available account.
                    // --------------------------------------------

                    const [availableRows] =
                        await connection.execute(
                            `
                            SELECT *
                            FROM instagram_account_pool
                            WHERE status = 'available'
                            AND assigned_tg_id IS NULL
                            ORDER BY id ASC
                            LIMIT 1
                            FOR UPDATE
                            `
                        );

                    if (availableRows.length > 0) {

                        const selected =
                            availableRows[0];

                        await connection.execute(
                            `
                            UPDATE instagram_account_pool
                            SET
                                assigned_tg_id = ?,
                                assigned_at = CURRENT_TIMESTAMP,
                                status = 'assigned'
                            WHERE id = ?
                            AND status = 'available'
                            AND assigned_tg_id IS NULL
                            `,
                            [
                                user.telegram_id,
                                selected.id
                            ]
                        );

                        const [assignedRows] =
                            await connection.execute(
                                `
                                SELECT *
                                FROM instagram_account_pool
                                WHERE id = ?
                                LIMIT 1
                                `,
                                [selected.id]
                            );

                        account =
                            assignedRows.length > 0
                                ? assignedRows[0]
                                : null;
                    }
                }

                await connection.commit();

                if (!account) {

                    return res.json({
                        success: true,
                        available: false,
                        message:
                            'No Instagram task is currently available.'
                    });
                }

                return res.json({
                    success: true,
                    available: true,

                    task: {
                        id: account.id,

                        username:
                            account.instagram_username,

                        full_name:
                            account.full_name,

                        bio:
                            account.bio,

                        password:
                            decryptInstagramSecret(
                                account.password_encrypted
                            ),

                        assigned_at:
                            account.assigned_at
                    }
                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
        }

        // ====================================================
        // USER HISTORY
        // ====================================================

        if (action === 'get_history') {

            const user = await instagramRequireUser(
                connection,
                tgId
            );

            const [rows] =
                await connection.execute(
                    `
                    SELECT
                        id,
                        instagram_username,
                        full_name,
                        bio,
                        status,
                        rate_usd,
                        credited_usd,
                        submitted_at,
                        checked_at,
                        reviewed_at,
                        admin_note,
                        created_at
                    FROM instagram_submissions
                    WHERE telegram_id = ?
                    ORDER BY id DESC
                    `,
                    [user.telegram_id]
                );

            return res.json({
                success: true,
                history: rows.map(row => ({
                    id: row.id,
                    username: row.instagram_username,
                    full_name: row.full_name,
                    bio: row.bio,
                    status: row.status,
                    rate_usd: Number(row.rate_usd || 0),
                    credited_usd: Number(row.credited_usd || 0),
                    submitted_at: row.submitted_at,
                    checked_at: row.checked_at,
                    reviewed_at: row.reviewed_at,
                    admin_note: row.admin_note || '',
                    created_at: row.created_at
                }))
            });
                    }
                // ====================================================
        // SUBMIT INSTAGRAM ACCOUNT
        // ====================================================

        if (action === 'submit_task') {

            const user = await instagramRequireUser(
                connection,
                tgId
            );

            const poolId =
                Number(body.pool_id);

            const submittedUsername =
                instagramCleanString(
                    body.instagram_username,
                    255
                );

            const submittedFullName =
                instagramCleanString(
                    body.full_name,
                    255
                );

            const submittedBio =
                instagramCleanString(
                    body.bio,
                    2000
                );

            /*
             * This is the user's authenticator setup
             * information. It is encrypted before storage.
             */
            const authenticatorSetup =
                instagramCleanString(
                    body.authenticator_setup,
                    1000
                );

            if (
                !Number.isInteger(poolId) ||
                poolId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid task ID.'
                });
            }

            if (!submittedUsername) {
                return res.status(400).json({
                    success: false,
                    message: 'Instagram username is required.'
                });
            }

            if (!authenticatorSetup) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Authenticator setup information is required.'
                });
            }

            await connection.beginTransaction();

            try {

                const [poolRows] =
                    await connection.execute(
                        `
                        SELECT *
                        FROM instagram_account_pool
                        WHERE id = ?
                        FOR UPDATE
                        `,
                        [poolId]
                    );

                if (poolRows.length === 0) {
                    throw new Error(
                        'Instagram task not found.'
                    );
                }

                const pool = poolRows[0];

                if (
                    String(pool.assigned_tg_id) !==
                    String(user.telegram_id)
                ) {
                    throw new Error(
                        'This Instagram task is not assigned to your account.'
                    );
                }

                if (pool.status !== 'assigned') {
                    throw new Error(
                        'This Instagram task is no longer available.'
                    );
                }

                // --------------------------------------------
                // Prevent duplicate submission.
                // --------------------------------------------

                const [duplicateRows] =
                    await connection.execute(
                        `
                        SELECT id
                        FROM instagram_submissions
                        WHERE pool_id = ?
                        LIMIT 1
                        `,
                        [poolId]
                    );

                if (duplicateRows.length > 0) {
                    throw new Error(
                        'This Instagram task has already been submitted.'
                    );
                }

                const settings =
                    await instagramGetSettings(
                        connection
                    );

                const rateUsd =
                    Number(settings.rate_usd || 0);

                const authenticatorEncrypted =
                    encryptInstagramSecret(
                        authenticatorSetup
                    );

                // --------------------------------------------
                // Store the submitted account.
                // Password from the assigned pool is copied
                // into encrypted storage, never plaintext.
                // --------------------------------------------

                await connection.execute(
                    `
                    INSERT INTO instagram_submissions
                    (
                        pool_id,
                        telegram_id,
                        instagram_username,
                        password_encrypted,
                        full_name,
                        bio,
                        authenticator_encrypted,
                        rate_usd,
                        credited_usd,
                        status,
                        submitted_at
                    )
                    VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', CURRENT_TIMESTAMP)
                    `,
                    [
                        poolId,
                        user.telegram_id,
                        submittedUsername,
                        pool.password_encrypted,
                        submittedFullName,
                        submittedBio,
                        authenticatorEncrypted,
                        rateUsd
                    ]
                );

                // --------------------------------------------
                // Permanently consume this pool account.
                // It cannot go to another user.
                // --------------------------------------------

                await connection.execute(
                    `
                    UPDATE instagram_account_pool
                    SET
                        status = 'submitted',
                        submitted_tg_id = ?,
                        submitted_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    AND assigned_tg_id = ?
                    AND status = 'assigned'
                    `,
                    [
                        user.telegram_id,
                        poolId,
                        user.telegram_id
                    ]
                );

                await connection.commit();

                return res.json({
                    success: true,
                    message:
                        'Instagram account submitted successfully.',
                    rate_usd: rateUsd
                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
        }
                // ====================================================
        // ADMIN BULK UPLOAD
        // ====================================================

        if (action === 'admin_bulk_upload') {

            const admin =
                await instagramRequireAdmin(
                    connection,
                    tgId
                );

            let records = body.records ?? body.accounts;

            if (typeof records === 'string') {

                try {
                    records = JSON.parse(records);
                } catch (error) {
                    return res.status(400).json({
                        success: false,
                        message:
                            'Invalid JSON records.'
                    });
                }
            }

            if (!Array.isArray(records)) {
                return res.status(400).json({
                    success: false,
                    message:
                        'records must be an array.'
                });
            }

            if (records.length === 0) {
                return res.status(400).json({
                    success: false,
                    message:
                        'No Instagram accounts were supplied.'
                });
            }

            if (records.length > 10000) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Maximum 10,000 records per upload.'
                });
            }

            await connection.beginTransaction();

            try {

                let inserted = 0;
                let skipped = 0;

                for (const item of records) {

                    const username =
                        instagramCleanString(
                            item.username ||
                            item.instagram_username,
                            255
                        );

                    const fullName =
                        instagramCleanString(
                            item.full_name ||
                            item.fullName,
                            255
                        );

                    const bio =
                        instagramCleanString(
                            item.bio,
                            2000
                        );

                    const password =
                        instagramCleanString(
                            item.password,
                            500
                        );

                    if (
                        !username ||
                        !fullName ||
                        !password
                    ) {
                        skipped++;
                        continue;
                    }

                    // Prevent duplicate username in pool.
                    const [exists] =
    await connection.execute(
        `
        SELECT id
        FROM instagram_account_pool
        WHERE instagram_username = ?
        LIMIT 1
        `,
        [username]
    );

                    if (exists.length > 0) {
                        skipped++;
                        continue;
                    }

                    const encryptedPassword =
                        encryptInstagramSecret(
                            password
                        );

                    await connection.execute(
                        `
                        INSERT INTO instagram_account_pool
                        (
                            instagram_username,
                            password_encrypted,
                            full_name,
                            bio,
                            status
                        )
                        VALUES
                        (?, ?, ?, ?, 'available')
                        `,
                        [
                            username,
                            encryptedPassword,
                            fullName,
                            bio
                        ]
                    );

                    inserted++;
                }

                await connection.commit();

                return res.json({
                    success: true,
                    message:
                        'Instagram bulk upload completed.',
                    inserted,
                    skipped,
                    uploaded_by: admin.telegram_id
                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
        }

        // ====================================================
        // ADMIN GET POOL
        // ====================================================

        if (action === 'admin_get_pool') {

            await instagramRequireAdmin(
                connection,
                tgId
            );

            const limit =
                Math.min(
                    500,
                    Math.max(
                        1,
                        Number(body.limit || 100)
                    )
                );

            const [rows] =
                await connection.execute(
                    `
                    SELECT
                        id,
                        instagram_username,
                        full_name,
                        bio,
                        status,
                        assigned_tg_id,
                        assigned_at,
                        submitted_tg_id,
                        submitted_at,
                        created_at
                    FROM instagram_account_pool
                    ORDER BY id DESC
                    LIMIT ${limit}
                    `
                );

            const [stats] =
                await connection.execute(
                    `
                    SELECT
                        COUNT(*) AS total,
                        SUM(status = 'available') AS available,
                        SUM(status = 'assigned') AS assigned,
                        SUM(status = 'submitted') AS submitted
                    FROM instagram_account_pool
                    `
                );

            return res.json({
                success: true,
                pool: rows,
                stats: stats[0] || {}
            });
        }
                // ====================================================
        // ADMIN GET SUBMISSIONS
        // ====================================================

        if (action === 'admin_get_submissions') {

            await instagramRequireAdmin(
                connection,
                tgId
            );

            const statusFilter =
                instagramCleanString(
                    body.status,
                    30
                );

            let rows;

            if (
                statusFilter &&
                [
                    'pending',
                    'checking',
                    'approved',
                    'rejected'
                ].includes(statusFilter)
            ) {

                [rows] =
                    await connection.execute(
                        `
                        SELECT
                            s.*,
                            u.username AS user_username,
                            u.first_name AS user_first_name
                        FROM instagram_submissions s
                        LEFT JOIN users u
                            ON u.telegram_id = s.telegram_id
                        WHERE s.status = ?
                        ORDER BY
                            CASE
                                WHEN s.status IN
                                ('pending','checking')
                                THEN 0
                                ELSE 1
                            END,
                            s.id DESC
                        `,
                        [statusFilter]
                    );

            } else {

                [rows] =
                    await connection.execute(
                        `
                        SELECT
                            s.*,
                            u.username AS user_username,
                            u.first_name AS user_first_name
                        FROM instagram_submissions s
                        LEFT JOIN users u
                            ON u.telegram_id = s.telegram_id
                        ORDER BY
                            CASE
                                WHEN s.status IN
                                ('pending','checking')
                                THEN 0
                                ELSE 1
                            END,
                            s.id DESC
                        `
                    );
            }

            return res.json({
                success: true,

                submissions: rows.map(row => ({
                    id: row.id,
                    telegram_id: row.telegram_id,

                    user_username:
                        row.user_username || '',

                    user_first_name:
                        row.user_first_name || '',

                    instagram_username:
                        row.instagram_username,

                    full_name:
                        row.full_name,

                    bio:
                        row.bio,

                    password:
                        decryptInstagramSecret(
                            row.password_encrypted
                        ),

                    authenticator_setup:
                        decryptInstagramSecret(
                            row.authenticator_encrypted
                        ),

                    rate_usd:
                        Number(row.rate_usd || 0),

                    credited_usd:
                        Number(row.credited_usd || 0),

                    status:
                        row.status,

                    submitted_at:
                        row.submitted_at,

                    checked_at:
                        row.checked_at,

                    reviewed_at:
                        row.reviewed_at,

                    admin_note:
                        row.admin_note || ''
                }))
            });
        }

        // ====================================================
        // ADMIN CHECKING
        // ====================================================

        if (action === 'admin_checking') {

            const admin =
                await instagramRequireAdmin(
                    connection,
                    tgId
                );

            const submissionId =
                Number(body.submission_id);

            if (
                !Number.isInteger(submissionId) ||
                submissionId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid submission ID is required.'
                });
            }

            const [result] =
                await connection.execute(
                    `
                    UPDATE instagram_submissions
                    SET
                        status = 'checking',
                        checked_at = CURRENT_TIMESTAMP,
                        admin_telegram_id = ?
                    WHERE id = ?
                    AND status = 'pending'
                    `,
                    [
                        admin.telegram_id,
                        submissionId
                    ]
                );

            if (result.affectedRows === 0) {
                return res.status(409).json({
                    success: false,
                    message:
                        'Submission not found or already processed.'
                });
            }

            return res.json({
                success: true,
                message:
                    'Instagram submission moved to checking.'
            });
        }
                // ====================================================
        // ADMIN APPROVE
        // ====================================================

        if (action === 'admin_approve') {

            const admin =
                await instagramRequireAdmin(
                    connection,
                    tgId
                );

            const submissionId =
                Number(body.submission_id);

            const adminNote =
                instagramCleanString(
                    body.admin_note,
                    2000
                );

            if (
                !Number.isInteger(submissionId) ||
                submissionId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid submission ID is required.'
                });
            }

            await connection.beginTransaction();

            try {

                // --------------------------------------------
                // Lock submission
                // --------------------------------------------

                const [submissionRows] =
                    await connection.execute(
                        `
                        SELECT *
                        FROM instagram_submissions
                        WHERE id = ?
                        FOR UPDATE
                        `,
                        [submissionId]
                    );

                if (submissionRows.length === 0) {
                    throw new Error(
                        'Instagram submission not found.'
                    );
                }

                const submission =
                    submissionRows[0];

                if (
                    submission.status !== 'checking' &&
                    submission.status !== 'pending'
                ) {
                    throw new Error(
                        `This submission has already been ${submission.status}.`
                    );
                }

                const creditUsd =
                    Number(
                        submission.rate_usd || 0
                    );

                if (
                    !Number.isFinite(creditUsd) ||
                    creditUsd <= 0
                ) {
                    throw new Error(
                        'Invalid Instagram credit amount.'
                    );
                }

                // --------------------------------------------
                // Lock user
                // --------------------------------------------

                const [userRows] =
                    await connection.execute(
                        `
                        SELECT *
                        FROM users
                        WHERE telegram_id = ?
                        FOR UPDATE
                        `,
                        [submission.telegram_id]
                    );

                if (userRows.length === 0) {
                    throw new Error(
                        'Instagram submission user not found.'
                    );
                }

                const user =
                    userRows[0];

                const balanceBefore =
                    Number(user.balance || 0);

                const balanceAfter =
                    balanceBefore + creditUsd;

                // --------------------------------------------
                // Credit user
                // --------------------------------------------

                await connection.execute(
                    `
                    UPDATE users
                    SET balance = ?
                    WHERE telegram_id = ?
                    `,
                    [
                        balanceAfter,
                        submission.telegram_id
                    ]
                );

                // --------------------------------------------
                // Main transaction
                // --------------------------------------------

                const [transactionResult] =
                    await connection.execute(
                        `
                        INSERT INTO transactions
                        (
                            telegram_id,
                            transaction_type,
                            source_id,
                            source_reference,
                            amount_usd,
                            balance_before,
                            balance_after,
                            status,
                            description
                        )
                        VALUES
                        (
                            ?,
                            'instagram_sell',
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            'completed',
                            ?
                        )
                        `,
                        [
                            submission.telegram_id,
                            submission.id,
                            `INSTAGRAM-${submission.id}`,
                            creditUsd,
                            balanceBefore,
                            balanceAfter,
                            `Instagram Sell #${submission.id} approved`
                        ]
                    );

                const sourceTransactionId =
                    transactionResult.insertId;

                // --------------------------------------------
                // Existing AHTG referral system
                // --------------------------------------------

                let referralCommission = 0;
                let referrerTelegramId = null;

                const [referrerRows] =
                    await connection.execute(
                        `
                        SELECT referred_by
                        FROM users
                        WHERE telegram_id = ?
                        LIMIT 1
                        `,
                        [submission.telegram_id]
                    );

                if (
                    referrerRows.length > 0 &&
                    referrerRows[0].referred_by
                ) {

                    const referralCode =
                        String(
                            referrerRows[0].referred_by
                        ).trim();

                    const [referrerUserRows] =
                        await connection.execute(
                            `
                            SELECT telegram_id
                            FROM users
                            WHERE referral_code = ?
                            LIMIT 1
                            `,
                            [referralCode]
                        );

                    if (
                        referrerUserRows.length > 0
                    ) {
                        referrerTelegramId =
                            String(
                                referrerUserRows[0].telegram_id
                            );
                    }
                }

                const referralPercent =
                    await instagramGetReferralPercent(
                        connection
                    );

                if (
                    referrerTelegramId &&
                    referrerTelegramId !==
                        String(submission.telegram_id) &&
                    referralPercent > 0
                ) {

                    referralCommission =
                        creditUsd *
                        referralPercent /
                        100;

                    const [
                        referrerBalanceRows
                    ] =
                        await connection.execute(
                            `
                            SELECT balance
                            FROM users
                            WHERE telegram_id = ?
                            FOR UPDATE
                            `,
                            [referrerTelegramId]
                        );

                    if (
                        referrerBalanceRows.length > 0 &&
                        referralCommission > 0
                    ) {

                        const referrerBefore =
                            Number(
                                referrerBalanceRows[0]
                                    .balance || 0
                            );

                        const referrerAfter =
                            referrerBefore +
                            referralCommission;

                        // ------------------------------------
                        // Prevent duplicate referral commission
                        // ------------------------------------

                        const [
                            existingCommissionRows
                        ] =
                            await connection.execute(
                                `
                                SELECT id
                                FROM referral_commissions
                                WHERE source_transaction_id = ?
                                AND referrer_telegram_id = ?
                                LIMIT 1
                                `,
                                [
                                    sourceTransactionId,
                                    referrerTelegramId
                                ]
                            );

                        if (
                            existingCommissionRows.length === 0
                        ) {

                            const [
                                commissionInsert
                            ] =
                                await connection.execute(
                                    `
                                    INSERT INTO referral_commissions
                                    (
                                        source_transaction_id,
                                        referrer_telegram_id,
                                        referred_telegram_id,
                                        commission_percent,
                                        source_amount_usd,
                                        commission_amount_usd,
                                        status
                                    )
                                    VALUES
                                    (
                                        ?,
                                        ?,
                                        ?,
                                        ?,
                                        ?,
                                        ?,
                                        'completed'
                                    )
                                    `,
                                    [
                                        sourceTransactionId,
                                        referrerTelegramId,
                                        submission.telegram_id,
                                        referralPercent,
                                        creditUsd,
                                        referralCommission
                                    ]
                                );

                            await connection.execute(
                                `
                                UPDATE users
                                SET balance = ?
                                WHERE telegram_id = ?
                                `,
                                [
                                    referrerAfter,
                                    referrerTelegramId
                                ]
                            );

                            const [
                                commissionTransaction
                            ] =
                                await connection.execute(
                                    `
                                    INSERT INTO transactions
                                    (
                                        telegram_id,
                                        transaction_type,
                                        source_id,
                                        source_reference,
                                        amount_usd,
                                        balance_before,
                                        balance_after,
                                        status,
                                        description
                                    )
                                    VALUES
                                    (
                                        ?,
                                        'referral_commission',
                                        ?,
                                        ?,
                                        ?,
                                        ?,
                                        ?,
                                        'completed',
                                        ?
                                    )
                                    `,
                                    [
                                        referrerTelegramId,
                                        sourceTransactionId,
                                        `INSTAGRAM-${submission.id}`,
                                        referralCommission,
                                        referrerBefore,
                                        referrerAfter,
                                        `Direct referral commission from Instagram Sell #${submission.id}`
                                    ]
                                );

                            await connection.execute(
                                `
                                UPDATE referral_commissions
                                SET commission_transaction_id = ?
                                WHERE id = ?
                                `,
                                [
                                    commissionTransaction.insertId,
                                    commissionInsert.insertId
                                ]
                            );
                        }
                    }
                }

                // --------------------------------------------
                // Final submission status
                // --------------------------------------------

                await connection.execute(
                    `
                    UPDATE instagram_submissions
                    SET
                        status = 'approved',
                        credited_usd = ?,
                        admin_telegram_id = ?,
                        admin_note = ?,
                        reviewed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    AND status IN ('pending','checking')
                    `,
                    [
                        creditUsd,
                        admin.telegram_id,
                        adminNote || null,
                        submissionId
                    ]
                );

                // --------------------------------------------
                // Pool becomes completed
                // --------------------------------------------

                await connection.execute(
                    `
                    UPDATE instagram_account_pool
                    SET
                        status = 'completed'
                    WHERE id = ?
                    AND status = 'submitted'
                    `,
                    [submission.pool_id]
                );

                await connection.commit();

                return res.json({
                    success: true,
                    message:
                        'Instagram submission approved and balance credited.',
                    submission_id:
                        submissionId,
                    credited_usd:
                        Number(
                            creditUsd.toFixed(4)
                        ),
                    referral_commission_usd:
                        Number(
                            referralCommission.toFixed(4)
                        )
                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
                }
                // ====================================================
        // ADMIN REJECT
        // ====================================================

        if (action === 'admin_reject') {

            const admin =
                await instagramRequireAdmin(
                    connection,
                    tgId
                );

            const submissionId =
                Number(body.submission_id);

            const adminNote =
                instagramCleanString(
                    body.admin_note,
                    2000
                );

            if (
                !Number.isInteger(submissionId) ||
                submissionId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid submission ID is required.'
                });
            }

            await connection.beginTransaction();

            try {

                const [rows] =
                    await connection.execute(
                        `
                        SELECT *
                        FROM instagram_submissions
                        WHERE id = ?
                        FOR UPDATE
                        `,
                        [submissionId]
                    );

                if (rows.length === 0) {
                    throw new Error(
                        'Instagram submission not found.'
                    );
                }

                const submission = rows[0];

                if (
                    submission.status !== 'checking' &&
                    submission.status !== 'pending'
                ) {
                    throw new Error(
                        `This submission has already been ${submission.status}.`
                    );
                }

                await connection.execute(
                    `
                    UPDATE instagram_submissions
                    SET
                        status = 'rejected',
                        credited_usd = 0,
                        admin_telegram_id = ?,
                        admin_note = ?,
                        reviewed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    AND status IN ('pending','checking')
                    `,
                    [
                        admin.telegram_id,
                        adminNote || null,
                        submissionId
                    ]
                );

                await connection.execute(
                    `
                    UPDATE instagram_account_pool
                    SET
                        status = 'rejected'
                    WHERE id = ?
                    AND status = 'submitted'
                    `,
                    [submission.pool_id]
                );

                await connection.commit();

                return res.json({
                    success: true,
                    message:
                        'Instagram submission rejected successfully.'
                });

            } catch (error) {

                try {
                    await connection.rollback();
                } catch (e) {}

                throw error;
            }
        }

        // ====================================================
        // ADMIN DASHBOARD STATS
        // ====================================================

        if (action === 'admin_stats') {

            await instagramRequireAdmin(
                connection,
                tgId
            );

            const [submissionStats] =
                await connection.execute(
                    `
                    SELECT
                        COUNT(*) AS total,
                        SUM(status = 'pending') AS pending,
                        SUM(status = 'checking') AS checking,
                        SUM(status = 'approved') AS approved,
                        SUM(status = 'rejected') AS rejected,
                        COALESCE(
                            SUM(credited_usd),
                            0
                        ) AS total_paid
                    FROM instagram_submissions
                    `
                );

            const [poolStats] =
                await connection.execute(
                    `
                    SELECT
                        COUNT(*) AS total,
                        SUM(status = 'available') AS available,
                        SUM(status = 'assigned') AS assigned,
                        SUM(status = 'submitted') AS submitted,
                        SUM(status = 'completed') AS completed,
                        SUM(status = 'rejected') AS rejected
                    FROM instagram_account_pool
                    `
                );

            return res.json({
                success: true,
                submissions:
                    submissionStats[0] || {},
                pool:
                    poolStats[0] || {}
            });
        }

        // ====================================================
        // INVALID ACTION
        // ====================================================

        return res.status(400).json({
            success: false,
            message:
                'Invalid Instagram action.'
        });

    } catch (error) {

        console.error(
            'Instagram API Error:',
            error
        );

        return res.status(
            error.statusCode || 500
        ).json({
            success: false,
            message:
                error.message ||
                'Internal Server Error'
        });

    } finally {

        if (connection) {

            try {
                await connection.end();
            } catch (e) {}

        }
    }
});

// ============================================================
// END OF INSTAGRAM SELL API
// ============================================================
// ============================================================
// INSTAGRAM 2FA API - SECTION 1
// Constants + Common Helpers
// ============================================================

const INSTAGRAM_2FA_MAX_FIELD_NAME = 255;
const INSTAGRAM_2FA_MAX_PLACEHOLDER = 500;
const INSTAGRAM_2FA_MAX_VALUE = 5000;

function instagram2faCleanString(value, maxLength = 500) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value)
        .trim()
        .slice(0, maxLength);
}

function instagram2faNumber(value, fallback = 0) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
        return fallback;
    }

    return n;
}

function instagram2faError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}
// ============================================================
// INSTAGRAM 2FA API - SECTION 2
// User + Admin Authentication
// ============================================================

async function instagram2faRequireUser(connection, tgId) {

    if (!tgId) {
        throw instagram2faError(
            'Telegram ID is required.',
            400
        );
    }

    const [rows] = await connection.execute(
        `
        SELECT
            id,
            telegram_id,
            username,
            first_name,
            balance,
            role,
            status,
            telegram_verified,
            referral_code,
            referred_by
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
        `,
        [tgId]
    );

    if (rows.length === 0) {
        throw instagram2faError(
            'User account not found.',
            404
        );
    }

    const user = rows[0];

    if (
        user.status &&
        String(user.status).toLowerCase() !== 'active'
    ) {
        throw instagram2faError(
            'Your account is not active.',
            403
        );
    }

    return user;
}

async function instagram2faRequireAdmin(connection, tgId) {

    const user =
        await instagram2faRequireUser(
            connection,
            tgId
        );

    if (
        String(user.role).toLowerCase() !== 'admin'
    ) {
        throw instagram2faError(
            'Admin access required.',
            403
        );
    }

    return user;
            }
// ============================================================
// INSTAGRAM 2FA API - SECTION 3
// Settings Helper
// ============================================================

async function instagram2faGetSettings(connection) {

    const [rows] = await connection.execute(
        `
        SELECT
            id,
            rate_usd,
            tutorial_url,
            instructions,
            test_password_hash,
            enabled,
            updated_by,
            created_at,
            updated_at
        FROM instagram_2fa_settings
        WHERE id = 1
        LIMIT 1
        `
    );

    if (rows.length === 0) {

        return {
            id: 1,
            rate_usd: 0.002,
            tutorial_url: '',
            instructions: '',
            test_password_hash: '',
            enabled: 1
        };
    }

    return rows[0];
}
// ============================================================
// INSTAGRAM 2FA API - SECTION 4
// Referral Helper
// ============================================================

async function instagram2faGetReferralPercent(connection) {

    const [rows] = await connection.execute(
        `
        SELECT referral_percentage
        FROM settings
        WHERE id = 1
        LIMIT 1
        `
    );

    if (rows.length === 0) {
        return 0;
    }

    const percentage =
        Number(
            rows[0].referral_percentage || 0
        );

    if (
        !Number.isFinite(percentage) ||
        percentage < 0
    ) {
        return 0;
    }

    return percentage;
    }
// ============================================================
// INSTAGRAM 2FA API - SECTION 5
// Main Route
// ============================================================

app.all('/api/instagram-2fa', async (req, res) => {

    if (
        req.method !== 'GET' &&
        req.method !== 'POST'
    ) {
        return res.status(405).json({
            success: false,
            message: 'Method Not Allowed'
        });
    }

    const body =
        req.method === 'POST'
            ? req.body
            : req.query;

    const action =
        instagram2faCleanString(
            body.action,
            100
        );

    const tgId =
        instagram2faCleanString(
            body.tg_id,
            100
        );

    let connection;

    try {

        connection =
            await mysql.createConnection(
                dbConfig
            );

        // More actions will be added below.
        // ====================================================
// INSTAGRAM 2FA
// SECTION 6 - GET SETTINGS
// ====================================================

if (action === 'get_settings') {

    await instagram2faRequireUser(
        connection,
        tgId
    );

    const settings =
        await instagram2faGetSettings(
            connection
        );

    return res.json({
        success: true,

        settings: {
            rate_usd:
                Number(
                    settings.rate_usd || 0
                ),

            tutorial_url:
                settings.tutorial_url || '',

            instructions:
                settings.instructions || '',

            enabled:
                Number(settings.enabled) === 1
        }
    });
}
        // ====================================================
// INSTAGRAM 2FA
// SECTION 7 - ADMIN UPDATE SETTINGS
// ====================================================

if (action === 'admin_update_settings') {

    const admin =
        await instagram2faRequireAdmin(
            connection,
            tgId
        );

    const rateUsd =
        instagram2faNumber(
            body.rate_usd,
            NaN
        );

    const tutorialUrl =
        instagram2faCleanString(
            body.tutorial_url,
            2000
        );

    const instructions =
        instagram2faCleanString(
            body.instructions,
            10000
        );

    const testPassword =
        instagram2faCleanString(
            body.test_password,
            500
        );

    const enabled =
        Number(body.enabled) === 1
            ? 1
            : 0;

    if (
        !Number.isFinite(rateUsd) ||
        rateUsd < 0
    ) {
        return res.status(400).json({
            success: false,
            message: 'Invalid rate.'
        });
    }

    if (!testPassword) {
        return res.status(400).json({
            success: false,
            message:
                'Test Password is required.'
        });
    }

    /*
     * Test password is intentionally stored
     * as a one-way hash.
     *
     * No plaintext password is stored.
     */

    const cryptoHash =
        require('crypto');

    const salt =
        cryptoHash.randomBytes(16)
            .toString('hex');

    const hash =
        cryptoHash
            .scryptSync(
                testPassword,
                salt,
                64
            )
            .toString('hex');

    const passwordHash =
        `scrypt:${salt}:${hash}`;

    await connection.execute(
        `
        INSERT INTO instagram_2fa_settings
        (
            id,
            rate_usd,
            tutorial_url,
            instructions,
            test_password_hash,
            enabled,
            updated_by
        )
        VALUES
        (
            1,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        )
        ON DUPLICATE KEY UPDATE
            rate_usd = VALUES(rate_usd),
            tutorial_url = VALUES(tutorial_url),
            instructions = VALUES(instructions),
            test_password_hash =
                VALUES(test_password_hash),
            enabled = VALUES(enabled),
            updated_by = VALUES(updated_by)
        `,
        [
            rateUsd,
            tutorialUrl,
            instructions,
            passwordHash,
            enabled,
            admin.telegram_id
        ]
    );

    return res.json({
        success: true,
        message:
            'Instagram 2FA settings updated successfully.'
    });
}
        // ====================================================
// INSTAGRAM 2FA
// SECTION 8 - GET CUSTOM FIELDS
// ====================================================

if (action === 'get_fields') {

    await instagram2faRequireUser(
        connection,
        tgId
    );

    const [rows] =
        await connection.execute(
            `
            SELECT
                id,
                field_name,
                placeholder,
                field_type,
                required,
                sort_order
            FROM instagram_2fa_custom_fields
            WHERE enabled = 1
            ORDER BY
                sort_order ASC,
                id ASC
            `
        );

    return res.json({
        success: true,

        fields: rows.map(row => ({
            id: row.id,

            field_name:
                row.field_name,

            placeholder:
                row.placeholder || '',

            field_type:
                row.field_type,

            required:
                Number(row.required) === 1,

            sort_order:
                Number(row.sort_order || 0)
        }))
    });
    }
        // ====================================================
// INSTAGRAM 2FA
// SECTION 9 - ADMIN GET CUSTOM FIELDS
// ====================================================

if (action === 'admin_get_fields') {

    await instagram2faRequireAdmin(
        connection,
        tgId
    );

    const [rows] =
        await connection.execute(
            `
            SELECT
                id,
                field_name,
                placeholder,
                field_type,
                required,
                enabled,
                sort_order,
                created_at,
                updated_at
            FROM instagram_2fa_custom_fields
            ORDER BY
                sort_order ASC,
                id ASC
            `
        );

    return res.json({
        success: true,
        fields: rows.map(row => ({
            id: row.id,

            field_name:
                row.field_name,

            placeholder:
                row.placeholder || '',

            field_type:
                row.field_type,

            required:
                Number(row.required) === 1,

            enabled:
                Number(row.enabled) === 1,

            sort_order:
                Number(row.sort_order || 0),

            created_at:
                row.created_at,

            updated_at:
                row.updated_at
        }))
    });
}
        // ====================================================
// INSTAGRAM 2FA
// SECTION 10 - ADMIN ADD CUSTOM FIELD
// ====================================================

if (action === 'admin_add_field') {

    await instagram2faRequireAdmin(
        connection,
        tgId
    );

    const fieldName =
        instagram2faCleanString(
            body.field_name,
            255
        );

    const placeholder =
        instagram2faCleanString(
            body.placeholder,
            500
        );

    const fieldType =
        instagram2faCleanString(
            body.field_type || 'text',
            30
        );

    const required =
        Number(body.required) === 1
            ? 1
            : 0;

    const sortOrder =
        Math.max(
            0,
            Math.floor(
                instagram2faNumber(
                    body.sort_order,
                    0
                )
            )
        );

    if (!fieldName) {
        return res.status(400).json({
            success: false,
            message:
                'Field name is required.'
        });
    }

    if (
        fieldType !== 'text' &&
        fieldType !== 'textarea'
    ) {
        return res.status(400).json({
            success: false,
            message:
                'Invalid field type.'
        });
    }

    const [duplicate] =
        await connection.execute(
            `
            SELECT id
            FROM instagram_2fa_custom_fields
            WHERE field_name = ?
            LIMIT 1
            `,
            [fieldName]
        );

    if (duplicate.length > 0) {
        return res.status(409).json({
            success: false,
            message:
                'A field with this name already exists.'
        });
    }

    const [result] =
        await connection.execute(
            `
            INSERT INTO
            instagram_2fa_custom_fields
            (
                field_name,
                placeholder,
                field_type,
                required,
                enabled,
                sort_order
            )
            VALUES
            (?, ?, ?, ?, 1, ?)
            `,
            [
                fieldName,
                placeholder,
                fieldType,
                required,
                sortOrder
            ]
        );

    return res.json({
        success: true,
        message:
            'Custom field added successfully.',
        field_id:
            result.insertId
    });
        }
        // ============================================================
// SECTION 11
// ADMIN UPDATE CUSTOM FIELD
// ============================================================

if (action === 'admin_update_field') {

    const admin =
        await instagram2faRequireAdmin(
            connection,
            tgId
        );

    const fieldId =
        Number(body.field_id);

    const fieldName =
        instagram2faCleanString(
            body.field_name,
            255
        );

    const placeholder =
        instagram2faCleanString(
            body.placeholder,
            500
        );

    const fieldType =
        instagram2faCleanString(
            body.field_type,
            50
        ).toLowerCase();

    const required =
        Number(body.required) === 1
            ? 1
            : 0;

    const enabled =
        Number(body.enabled) === 0
            ? 0
            : 1;

    const sortOrder =
        Math.max(
            0,
            Math.floor(
                Number(body.sort_order || 0)
            )
        );


    // ============================================
    // VALIDATION
    // ============================================

    if (
        !Number.isInteger(fieldId) ||
        fieldId <= 0
    ) {

        return res.status(400).json({

            success: false,

            message:
                'Invalid custom field ID.'

        });

    }


    if (!fieldName) {

        return res.status(400).json({

            success: false,

            message:
                'Field name is required.'

        });

    }


    if (
        fieldType !== 'text' &&
        fieldType !== 'textarea'
    ) {

        return res.status(400).json({

            success: false,

            message:
                'Invalid field type.'

        });

    }


    // ============================================
    // CHECK FIELD EXISTS
    // ============================================

    const [fieldRows] =
        await connection.execute(

            `
            SELECT id
            FROM instagram_2fa_custom_fields
            WHERE id = ?
            LIMIT 1
            `,

            [fieldId]

        );


    if (fieldRows.length === 0) {

        return res.status(404).json({

            success: false,

            message:
                'Custom field not found.'

        });

    }


    // ============================================
    // DUPLICATE NAME CHECK
    // ============================================

    const [duplicateRows] =
        await connection.execute(

            `
            SELECT id
            FROM instagram_2fa_custom_fields
            WHERE LOWER(field_name) = LOWER(?)
            AND id <> ?
            LIMIT 1
            `,

            [
                fieldName,
                fieldId
            ]

        );


    if (duplicateRows.length > 0) {

        return res.status(409).json({

            success: false,

            message:
                'Another custom field already uses this name.'

        });

    }


    // ============================================
    // UPDATE
    // ============================================

    await connection.execute(

        `
        UPDATE instagram_2fa_custom_fields
        SET
            field_name = ?,
            placeholder = ?,
            field_type = ?,
            required = ?,
            enabled = ?,
            sort_order = ?
        WHERE id = ?
        `,

        [
            fieldName,
            placeholder || null,
            fieldType,
            required,
            enabled,
            sortOrder,
            fieldId
        ]

    );


    return res.json({

        success: true,

        message:
            'Custom field updated successfully.',

        field_id:
            fieldId

    });

                                    }
        // ============================================================
// SECTION 12
// ADMIN DISABLE CUSTOM FIELD
// ============================================================

if (action === 'admin_delete_field') {

    const admin =
        await instagram2faRequireAdmin(
            connection,
            tgId
        );

    const fieldId =
        Number(body.field_id);


    if (
        !Number.isInteger(fieldId) ||
        fieldId <= 0
    ) {

        return res.status(400).json({

            success: false,

            message:
                'Invalid custom field ID.'

        });

    }


    const [fieldRows] =
        await connection.execute(

            `
            SELECT id, field_name
            FROM instagram_2fa_custom_fields
            WHERE id = ?
            LIMIT 1
            `,

            [fieldId]

        );


    if (fieldRows.length === 0) {

        return res.status(404).json({

            success: false,

            message:
                'Custom field not found.'

        });

    }


    // ============================================
    // SOFT DELETE / DISABLE
    // ============================================

    await connection.execute(

        `
        UPDATE instagram_2fa_custom_fields
        SET enabled = 0
        WHERE id = ?
        `,

        [fieldId]

    );


    return res.json({

        success: true,

        message:
            'Custom field disabled successfully.',

        field_id:
            fieldId

    });

    }
        // ============================================================
// SECTION 13
// USER SUBMISSION HISTORY
// ============================================================

if (action === 'get_history') {

    const user =
        await instagram2faRequireUser(
            connection,
            tgId
        );


    const [submissionRows] =
        await connection.execute(

            `
            SELECT
                id,
                instagram_username,
                password_valid,
                rate_usd,
                credited_usd,
                consent_given,
                status,
                admin_note,
                submitted_at,
                checked_at,
                reviewed_at,
                created_at
            FROM instagram_2fa_submissions
            WHERE telegram_id = ?
            ORDER BY id DESC
            LIMIT 100
            `,

            [user.telegram_id]

        );


    // ============================================
    // LOAD FIELD VALUES
    // ============================================

    const submissionIds =
        submissionRows.map(
            row => Number(row.id)
        );


    let fieldValueRows = [];


    if (submissionIds.length > 0) {

        const placeholders =
            submissionIds
                .map(() => '?')
                .join(',');


        const [rows] =
            await connection.execute(

                `
                SELECT
                    v.submission_id,
                    v.field_id,
                    f.field_name,
                    v.field_value
                FROM instagram_2fa_submission_field_values v
                INNER JOIN instagram_2fa_custom_fields f
                    ON f.id = v.field_id
                WHERE v.submission_id IN (${placeholders})
                ORDER BY
                    f.sort_order ASC,
                    f.id ASC
                `,

                submissionIds

            );


        fieldValueRows = rows;

    }


    // ============================================
    // GROUP FIELD VALUES
    // ============================================

    const fieldMap = new Map();


    for (const row of fieldValueRows) {

        const submissionId =
            Number(row.submission_id);


        if (!fieldMap.has(submissionId)) {

            fieldMap.set(
                submissionId,
                []
            );

        }


        fieldMap
            .get(submissionId)
            .push({

                field_id:
                    Number(row.field_id),

                field_name:
                    row.field_name,

                value:
                    row.field_value || ''

            });

    }


    return res.json({

        success: true,

        submissions:
            submissionRows.map(row => ({

                id:
                    Number(row.id),

                instagram_username:
                    row.instagram_username,

                password_valid:
                    Number(row.password_valid) === 1,

                rate_usd:
                    Number(row.rate_usd || 0),

                credited_usd:
                    Number(row.credited_usd || 0),

                status:
                    row.status,

                admin_note:
                    row.admin_note || '',

                submitted_at:
                    row.submitted_at,

                checked_at:
                    row.checked_at,

                reviewed_at:
                    row.reviewed_at,

                fields:
                    fieldMap.get(
                        Number(row.id)
                    ) || []

            }))

    });

}
        // ============================================================
// SECTION 14
// USER SUBMIT INSTAGRAM 2FA TEST SUBMISSION
// ============================================================

if (action === 'submit') {

    const user =
        await instagram2faRequireUser(
            connection,
            tgId
        );


    // ============================================
    // GET CURRENT SETTINGS
    // ============================================

    const [settingsRows] =
        await connection.execute(

            `
            SELECT
                rate_usd,
                test_password_hash,
                enabled
            FROM instagram_2fa_settings
            WHERE id = 1
            LIMIT 1
            `

        );


    if (settingsRows.length === 0) {

        return res.status(503).json({

            success: false,

            message:
                'Instagram 2FA system is not configured.'

        });

    }


    const settings =
        settingsRows[0];


    if (
        Number(settings.enabled) !== 1
    ) {

        return res.status(403).json({

            success: false,

            message:
                'Instagram 2FA submissions are currently disabled.'

        });

    }


    // ============================================
    // USER INPUT
    // ============================================

    const instagramUsername =
        instagram2faCleanString(
            body.instagram_username,
            255
        );


    const testPassword =
        String(
            body.test_password || ''
        );


    const consent =
        Number(body.consent) === 1 ||
        body.consent === true ||
        body.consent === 'true';


    const fieldValues =
        (
            body.field_values &&
            typeof body.field_values === 'object'
        )
            ? body.field_values
            : {};


    // ============================================
    // BASIC VALIDATION
    // ============================================

    if (!instagramUsername) {

        return res.status(400).json({

            success: false,

            message:
                'Instagram username is required.'

        });

    }


    if (!testPassword) {

        return res.status(400).json({

            success: false,

            message:
                'Test Password is required.'

        });

    }


    if (!consent) {

        return res.status(400).json({

            success: false,

            message:
                'You must accept the consent checkbox.'

        });

    }


    // ============================================
    // VERIFY TEST PASSWORD
    // ============================================

    let passwordValid = false;


    try {

        const stored =
            String(
                settings.test_password_hash || ''
            );


        const parts =
            stored.split(':');


        if (
            parts.length === 3 &&
            parts[0] === 'scrypt'
        ) {

            const salt =
                parts[1];

            const storedHex =
                parts[2];

            const cryptoVerify =
                require('crypto');


            const derived =
                cryptoVerify
                    .scryptSync(
                        testPassword,
                        salt,
                        64
                    );


            const storedBuffer =
                Buffer.from(
                    storedHex,
                    'hex'
                );


            if (
                storedBuffer.length ===
                derived.length
            ) {

                passwordValid =
                    cryptoVerify
                        .timingSafeEqual(
                            derived,
                            storedBuffer
                        );

            }

        }

    } catch (passwordError) {

        passwordValid = false;

    }


    if (!passwordValid) {

        return res.status(400).json({

            success: false,

            message:
                'Invalid Test Password.'

        });

    }


    // ============================================
    // LOAD ACTIVE CUSTOM FIELDS
    // ============================================

    const [fieldRows] =
        await connection.execute(

            `
            SELECT
                id,
                field_name,
                required
            FROM instagram_2fa_custom_fields
            WHERE enabled = 1
            ORDER BY
                sort_order ASC,
                id ASC
            `

        );


    // ============================================
    // VALIDATE REQUIRED FIELDS
    // ============================================

    for (const field of fieldRows) {

        const fieldId =
            String(field.id);

        const value =
            fieldValues[fieldId] === undefined ||
            fieldValues[fieldId] === null
                ? ''
                : String(
                    fieldValues[fieldId]
                ).trim();


        if (
            Number(field.required) === 1 &&
            !value
        ) {

            return res.status(400).json({

                success: false,

                message:
                    `${field.field_name} is required.`

            });

        }

    }


    // ============================================
    // LOCK RATE AT SUBMISSION TIME
    // ============================================

    const lockedRate =
        Number(
            settings.rate_usd || 0
        );


    if (
        !Number.isFinite(lockedRate) ||
        lockedRate < 0
    ) {

        return res.status(500).json({

            success: false,

            message:
                'Invalid submission rate configuration.'

        });

    }


    // ============================================
    // TRANSACTION START
    // ============================================

    await connection.beginTransaction();


    try {

        // ========================================
        // INSERT SUBMISSION
        // ========================================

        const [submissionResult] =
            await connection.execute(

                `
                INSERT INTO instagram_2fa_submissions
                (
                    telegram_id,
                    instagram_username,
                    password_valid,
                    rate_usd,
                    credited_usd,
                    consent_given,
                    consent_at,
                    status,
                    submitted_at
                )
                VALUES
                (
                    ?,
                    ?,
                    ?,
                    ?,
                    0,
                    1,
                    CURRENT_TIMESTAMP,
                    'pending',
                    CURRENT_TIMESTAMP
                )
                `,

                [
                    user.telegram_id,
                    instagramUsername,
                    passwordValid ? 1 : 0,
                    lockedRate
                ]

            );


        const submissionId =
            submissionResult.insertId;


        // ========================================
        // SAVE CUSTOM FIELD VALUES
        // ========================================

        for (const field of fieldRows) {

            const fieldId =
                Number(field.id);


            const rawValue =
                fieldValues[
                    String(fieldId)
                ];


            const value =
                rawValue === undefined ||
                rawValue === null
                    ? ''
                    : String(rawValue)
                        .trim()
                        .slice(0, 10000);


            await connection.execute(

                `
                INSERT INTO
                instagram_2fa_submission_field_values
                (
                    submission_id,
                    field_id,
                    field_value
                )
                VALUES
                (
                    ?,
                    ?,
                    ?
                )
                `,

                [
                    submissionId,
                    fieldId,
                    value
                ]

            );

        }


        // ========================================
        // COMMIT
        // ========================================

        await connection.commit();


        return res.json({

            success: true,

            message:
                'Instagram 2FA test submission submitted successfully.',

            submission_id:
                submissionId,

            rate_usd:
                lockedRate,

            status:
                'pending'

        });


    } catch (error) {

        try {

            await connection.rollback();

        } catch (rollbackError) {}


        throw error;

    }

                }
        // ============================================================
// SECTION 15
// ADMIN GET ALL INSTAGRAM 2FA SUBMISSIONS
// ============================================================

if (action === 'admin_get_submissions') {

    await instagram2faRequireAdmin(
        connection,
        tgId
    );


    const [submissionRows] =
        await connection.execute(

            `
            SELECT
                s.id,
                s.telegram_id,
                u.username AS user_username,
                u.first_name,
                s.instagram_username,
                s.password_valid,
                s.rate_usd,
                s.credited_usd,
                s.consent_given,
                s.status,
                s.admin_telegram_id,
                s.admin_note,
                s.submitted_at,
                s.checked_at,
                s.reviewed_at,
                s.created_at
            FROM instagram_2fa_submissions s
            LEFT JOIN users u
                ON u.telegram_id = s.telegram_id
            ORDER BY
                s.id DESC
            LIMIT 500
            `

        );


    // ============================================
    // LOAD ALL FIELD VALUES
    // ============================================

    const submissionIds =
        submissionRows.map(
            row => Number(row.id)
        );


    let fieldValueRows = [];


    if (submissionIds.length > 0) {

        const placeholders =
            submissionIds
                .map(() => '?')
                .join(',');


        const [rows] =
            await connection.execute(

                `
                SELECT
                    v.submission_id,
                    v.field_id,
                    f.field_name,
                    v.field_value
                FROM instagram_2fa_submission_field_values v
                INNER JOIN instagram_2fa_custom_fields f
                    ON f.id = v.field_id
                WHERE v.submission_id IN (${placeholders})
                ORDER BY
                    f.sort_order ASC,
                    f.id ASC
                `,

                submissionIds

            );


        fieldValueRows = rows;

    }


    // ============================================
    // GROUP FIELD VALUES
    // ============================================

    const fieldMap =
        new Map();


    for (const row of fieldValueRows) {

        const submissionId =
            Number(row.submission_id);


        if (
            !fieldMap.has(
                submissionId
            )
        ) {

            fieldMap.set(
                submissionId,
                []
            );

        }


        fieldMap
            .get(submissionId)
            .push({

                field_id:
                    Number(row.field_id),

                field_name:
                    row.field_name,

                value:
                    row.field_value || ''

            });

    }


    return res.json({

        success: true,

        submissions:
            submissionRows.map(row => ({

                id:
                    Number(row.id),

                telegram_id:
                    row.telegram_id,

                user_username:
                    row.user_username || '',

                first_name:
                    row.first_name || '',

                instagram_username:
                    row.instagram_username,

                // ==================================
                // IMPORTANT:
                // NEVER RETURN THE PASSWORD
                // ==================================

                password_valid:
                    Number(
                        row.password_valid
                    ) === 1,

                rate_usd:
                    Number(
                        row.rate_usd || 0
                    ),

                credited_usd:
                    Number(
                        row.credited_usd || 0
                    ),

                consent_given:
                    Number(
                        row.consent_given
                    ) === 1,

                status:
                    row.status,

                admin_telegram_id:
                    row.admin_telegram_id || '',

                admin_note:
                    row.admin_note || '',

                submitted_at:
                    row.submitted_at,

                checked_at:
                    row.checked_at,

                reviewed_at:
                    row.reviewed_at,

                fields:
                    fieldMap.get(
                        Number(row.id)
                    ) || []

            }))

    });

}
// ============================================================
// SECTION 16
// ADMIN CHECKING
// ============================================================

if (action === 'admin_checking') {

    const admin =
        await instagram2faRequireAdmin(
            connection,
            tgId
        );

    const submissionId =
        Number(body.submission_id);


    if (
        !Number.isInteger(submissionId) ||
        submissionId <= 0
    ) {

        return res.status(400).json({

            success: false,

            message:
                'Valid submission ID is required.'

        });

    }


    const [result] =
        await connection.execute(

            `
            UPDATE instagram_2fa_submissions
            SET
                status = 'checking',
                checked_at = CURRENT_TIMESTAMP,
                admin_telegram_id = ?
            WHERE id = ?
            AND status = 'pending'
            `,

            [
                admin.telegram_id,
                submissionId
            ]

        );


    if (result.affectedRows === 0) {

        return res.status(409).json({

            success: false,

            message:
                'Submission not found or already processed.'

        });

    }


    return res.json({

        success: true,

        message:
            'Instagram 2FA submission moved to checking.'

    });

            }
        // ============================================================
// SECTION 17
// ADMIN APPROVE
// ============================================================

if (action === 'admin_approve') {

    const admin =
        await instagram2faRequireAdmin(
            connection,
            tgId
        );

    const submissionId =
        Number(body.submission_id);

    const adminNote =
        instagram2faCleanString(
            body.admin_note,
            2000
        );


    if (
        !Number.isInteger(submissionId) ||
        submissionId <= 0
    ) {

        return res.status(400).json({

            success: false,

            message:
                'Valid submission ID is required.'

        });

    }


    await connection.beginTransaction();


    try {

        // ============================================
        // LOCK SUBMISSION
        // ============================================

        const [submissionRows] =
            await connection.execute(

                `
                SELECT *
                FROM instagram_2fa_submissions
                WHERE id = ?
                FOR UPDATE
                `,

                [submissionId]

            );


        if (submissionRows.length === 0) {

            throw new Error(
                'Instagram 2FA submission not found.'
            );

        }


        const submission =
            submissionRows[0];


        // ============================================
        // ONLY CHECKING CAN BE APPROVED
        // ============================================

        if (
            submission.status !== 'checking'
        ) {

            throw new Error(
                `Only checking submissions can be approved. Current status: ${submission.status}`
            );

        }


        // ============================================
        // PASSWORD VALIDATION FLAG
        // ============================================

        if (
            Number(
                submission.password_valid
            ) !== 1
        ) {

            throw new Error(
                'Test Password validation failed.'
            );

        }


        // ============================================
        // LOCKED RATE
        // ============================================

        const creditUsd =
            Number(
                submission.rate_usd || 0
            );


        if (
            !Number.isFinite(creditUsd) ||
            creditUsd <= 0
        ) {

            throw new Error(
                'Invalid Instagram 2FA credit amount.'
            );

        }


        // ============================================
        // LOCK USER
        // ============================================

        const [userRows] =
            await connection.execute(

                `
                SELECT
                    telegram_id,
                    balance
                FROM users
                WHERE telegram_id = ?
                FOR UPDATE
                `,

                [
                    submission.telegram_id
                ]

            );


        if (userRows.length === 0) {

            throw new Error(
                'Submission user not found.'
            );

        }


        const user =
            userRows[0];


        const balanceBefore =
            Number(
                user.balance || 0
            );


        const balanceAfter =
            balanceBefore + creditUsd;


        // ============================================
        // CREDIT USER BALANCE
        // ============================================

        await connection.execute(

            `
            UPDATE users
            SET balance = ?
            WHERE telegram_id = ?
            `,

            [
                balanceAfter,
                submission.telegram_id
            ]

        );


        // ============================================
        // MAIN TRANSACTION
        // ============================================

        const [
            transactionResult
        ] =
            await connection.execute(

                `
                INSERT INTO transactions
                (
                    telegram_id,
                    transaction_type,
                    source_id,
                    source_reference,
                    amount_usd,
                    balance_before,
                    balance_after,
                    status,
                    description
                )
                VALUES
                (
                    ?,
                    'instagram_2fa',
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    'completed',
                    ?
                )
                `,

                [
                    submission.telegram_id,

                    submission.id,

                    `INSTAGRAM-2FA-${submission.id}`,

                    creditUsd,

                    balanceBefore,

                    balanceAfter,

                    `Instagram 2FA Test #${submission.id} approved`

                ]

            );


        const sourceTransactionId =
            transactionResult.insertId;


        // ============================================
        // EXISTING REFERRAL SYSTEM
        // ============================================

        let referralCommission = 0;

        let referrerTelegramId = null;


        const [referrerRows] =
            await connection.execute(

                `
                SELECT referred_by
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
                `,

                [
                    submission.telegram_id
                ]

            );


        if (
            referrerRows.length > 0 &&
            referrerRows[0].referred_by
        ) {

            const referralCode =
                String(
                    referrerRows[0].referred_by
                ).trim();


            const [
                referrerUserRows
            ] =
                await connection.execute(

                    `
                    SELECT telegram_id
                    FROM users
                    WHERE referral_code = ?
                    LIMIT 1
                    `,

                    [
                        referralCode
                    ]

                );


            if (
                referrerUserRows.length > 0
            ) {

                referrerTelegramId =
                    String(
                        referrerUserRows[0]
                            .telegram_id
                    );

            }

        }


        // ============================================
        // GET EXISTING REFERRAL PERCENTAGE
        // ============================================

        const referralPercent =
            await instagramGetReferralPercent(
                connection
            );


        // ============================================
        // REFERRAL COMMISSION
        // ============================================

        if (
            referrerTelegramId &&
            referrerTelegramId !==
                String(
                    submission.telegram_id
                ) &&
            referralPercent > 0
        ) {

            referralCommission =
                creditUsd *
                referralPercent /
                100;


            if (
                Number.isFinite(
                    referralCommission
                ) &&
                referralCommission > 0
            ) {

                // ========================================
                // LOCK REFERRER BALANCE
                // ========================================

                const [
                    referrerBalanceRows
                ] =
                    await connection.execute(

                        `
                        SELECT balance
                        FROM users
                        WHERE telegram_id = ?
                        FOR UPDATE
                        `,

                        [
                            referrerTelegramId
                        ]

                    );


                if (
                    referrerBalanceRows.length > 0
                ) {

                    const referrerBefore =
                        Number(
                            referrerBalanceRows[0]
                                .balance || 0
                        );


                    const referrerAfter =
                        referrerBefore +
                        referralCommission;


                    // ====================================
                    // DUPLICATE COMMISSION PROTECTION
                    // ====================================

                    const [
                        existingCommissionRows
                    ] =
                        await connection.execute(

                            `
                            SELECT id
                            FROM referral_commissions
                            WHERE source_transaction_id = ?
                            AND referrer_telegram_id = ?
                            LIMIT 1
                            `,

                            [
                                sourceTransactionId,
                                referrerTelegramId
                            ]

                        );


                    if (
                        existingCommissionRows.length === 0
                    ) {

                        // ==================================
                        // INSERT REFERRAL COMMISSION
                        // ==================================

                        const [
                            commissionInsert
                        ] =
                            await connection.execute(

                                `
                                INSERT INTO referral_commissions
                                (
                                    source_transaction_id,
                                    referrer_telegram_id,
                                    referred_telegram_id,
                                    commission_percent,
                                    source_amount_usd,
                                    commission_amount_usd,
                                    status
                                )
                                VALUES
                                (
                                    ?,
                                    ?,
                                    ?,
                                    ?,
                                    ?,
                                    ?,
                                    'completed'
                                )
                                `,

                                [
                                    sourceTransactionId,

                                    referrerTelegramId,

                                    submission.telegram_id,

                                    referralPercent,

                                    creditUsd,

                                    referralCommission
                                ]

                            );


                        // ==================================
                        // CREDIT REFERRER
                        // ==================================

                        await connection.execute(

                            `
                            UPDATE users
                            SET balance = ?
                            WHERE telegram_id = ?
                            `,

                            [
                                referrerAfter,
                                referrerTelegramId
                            ]

                        );


                        // ==================================
                        // REFERRAL TRANSACTION
                        // ==================================

                        const [
                            commissionTransaction
                        ] =
                            await connection.execute(

                                `
                                INSERT INTO transactions
                                (
                                    telegram_id,
                                    transaction_type,
                                    source_id,
                                    source_reference,
                                    amount_usd,
                                    balance_before,
                                    balance_after,
                                    status,
                                    description
                                )
                                VALUES
                                (
                                    ?,
                                    'referral_commission',
                                    ?,
                                    ?,
                                    ?,
                                    ?,
                                    ?,
                                    'completed',
                                    ?
                                )
                                `,

                                [
                                    referrerTelegramId,

                                    sourceTransactionId,

                                    `INSTAGRAM-2FA-${submission.id}`,

                                    referralCommission,

                                    referrerBefore,

                                    referrerAfter,

                                    `Direct referral commission from Instagram 2FA submission #${submission.id}`

                                ]

                            );


                        // ==================================
                        // LINK COMMISSION TRANSACTION
                        // ==================================

                        await connection.execute(

                            `
                            UPDATE referral_commissions
                            SET commission_transaction_id = ?
                            WHERE id = ?
                            `,

                            [
                                commissionTransaction
                                    .insertId,

                                commissionInsert
                                    .insertId

                            ]

                        );

                    }

                }

            }

        }


        // ============================================
        // MARK SUBMISSION APPROVED
        // ============================================

        await connection.execute(

            `
            UPDATE instagram_2fa_submissions
            SET
                status = 'approved',
                credited_usd = ?,
                admin_telegram_id = ?,
                admin_note = ?,
                reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            AND status = 'checking'
            `,

            [
                creditUsd,

                admin.telegram_id,

                adminNote || null,

                submissionId

            ]

        );


        // ============================================
        // COMMIT EVERYTHING
        // ============================================

        await connection.commit();


        return res.json({

            success: true,

            message:
                'Instagram 2FA submission approved and balance credited.',

            submission_id:
                submissionId,

            credited_usd:
                creditUsd,

            referral_commission_usd:
                referralCommission

        });


    } catch (error) {

        try {

            await connection.rollback();

        } catch (rollbackError) {}


        throw error;

    }

                    }
        // ============================================================
// SECTION 18
// ADMIN REJECT
// ============================================================

if (action === 'admin_reject') {

    const admin =
        await instagram2faRequireAdmin(
            connection,
            tgId
        );

    const submissionId =
        Number(body.submission_id);

    const adminNote =
        instagram2faCleanString(
            body.admin_note,
            2000
        );


    if (
        !Number.isInteger(submissionId) ||
        submissionId <= 0
    ) {

        return res.status(400).json({

            success: false,

            message:
                'Valid submission ID is required.'

        });

    }


    await connection.beginTransaction();


    try {

        // ============================================
        // LOCK SUBMISSION
        // ============================================

        const [rows] =
            await connection.execute(

                `
                SELECT
                    id,
                    status
                FROM instagram_2fa_submissions
                WHERE id = ?
                FOR UPDATE
                `,

                [submissionId]

            );


        if (rows.length === 0) {

            throw new Error(
                'Instagram 2FA submission not found.'
            );

        }


        const submission =
            rows[0];


        if (
            submission.status !== 'checking'
        ) {

            throw new Error(
                `Only checking submissions can be rejected. Current status: ${submission.status}`
            );

        }


        // ============================================
        // REJECT
        // ============================================

        await connection.execute(

            `
            UPDATE instagram_2fa_submissions
            SET
                status = 'rejected',
                credited_usd = 0,
                admin_telegram_id = ?,
                admin_note = ?,
                reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            AND status = 'checking'
            `,

            [
                admin.telegram_id,

                adminNote || null,

                submissionId

            ]

        );


        await connection.commit();


        return res.json({

            success: true,

            message:
                'Instagram 2FA submission rejected successfully.'

        });


    } catch (error) {

        try {

            await connection.rollback();

        } catch (rollbackError) {}


        throw error;

    }

            }
        // ============================================================
// SECTION 19
// ADMIN DASHBOARD STATS
// ============================================================

if (action === 'admin_stats') {

    await instagram2faRequireAdmin(
        connection,
        tgId
    );


    const [submissionStats] =
        await connection.execute(

            `
            SELECT
                COUNT(*) AS total,

                COALESCE(
                    SUM(status = 'pending'),
                    0
                ) AS pending,

                COALESCE(
                    SUM(status = 'checking'),
                    0
                ) AS checking,

                COALESCE(
                    SUM(status = 'approved'),
                    0
                ) AS approved,

                COALESCE(
                    SUM(status = 'rejected'),
                    0
                ) AS rejected,

                COALESCE(
                    SUM(credited_usd),
                    0
                ) AS total_paid

            FROM instagram_2fa_submissions
            `

        );


    const stats =
        submissionStats[0] || {};


    return res.json({

        success: true,

        stats: {

            total:
                Number(
                    stats.total || 0
                ),

            pending:
                Number(
                    stats.pending || 0
                ),

            checking:
                Number(
                    stats.checking || 0
                ),

            approved:
                Number(
                    stats.approved || 0
                ),

            rejected:
                Number(
                    stats.rejected || 0
                ),

            total_paid:
                Number(
                    stats.total_paid || 0
                )

        }

    });

}
        
        return res.status(400).json({
            success: false,
            message: 'Invalid Instagram 2FA action.'
        });

    } catch (error) {

        console.error(
            'Instagram 2FA API Error:',
            error
        );

        return res.status(
            error.statusCode || 500
        ).json({
            success: false,
            message:
                error.message ||
                'Internal Server Error'
        });

    } finally {

        if (connection) {

            try {
                await connection.end();
            } catch (e) {}

        }
    }
});


             // ============================================================
// ২. MAIN API ROUTE
// ============================================================
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
            if (users.length > 0) {
                responseData = { success: true, user: users[0] };
            } else {
                responseData = { success: false, message: 'User not found' };
            }
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
            } catch (err) {}
            responseData = { success: true, user: users[0], settings: settings };
        }
        else if (action === 'get_admin_dashboard_stats') {
            if (!tgId) return res.status(400).json({ success: false, message: 'Telegram ID is required' });
            const [users] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
            if (users.length === 0 || users[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
            }
            const [countRows] = await connection.execute('SELECT COUNT(*) as total_users, SUM(balance) as total_balance FROM users');
            let settings = { referral_percentage: 5.00, referral_notice: '' };
            try {
                const [settingsRows] = await connection.execute('SELECT referral_percentage, referral_notice FROM settings WHERE id = 1');
                if (settingsRows.length > 0) settings = settingsRows[0];
            } catch (err) {}
            responseData = {
                success: true,
                user: users[0],
                stats: {
                    total_users: countRows[0].total_users || 0,
                    total_balance: countRows[0].total_balance || 0
                },
                settings: settings
            };
        }
        else if (action === 'get_admin_accounts') {
            if (!tgId) return res.status(400).json({ success: false, message: 'Telegram ID is required' });
            const [users] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
            if (users.length === 0 || users[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
            }
            const [userStats] = await connection.execute('SELECT COUNT(*) as total_users, SUM(balance) as total_user_balance FROM users');
            const [wallets] = await connection.execute('SELECT wallet_name, balance FROM admin_accounts');
            let totalWalletBalance = 0;
            wallets.forEach(w => { totalWalletBalance += parseFloat(w.balance); });
            const totalUserBalance = parseFloat(userStats[0].total_user_balance || 0);
            const profitLoss = totalWalletBalance - totalUserBalance;
            responseData = {
                success: true,
                stats: {
                    total_users: userStats[0].total_users || 0,
                    total_user_balance: totalUserBalance,
                    wallets: wallets,
                    total_wallet_balance: totalWalletBalance,
                    profit_loss: profitLoss
                }
            };
        }
        else if (action === 'update_wallet_balance') {
            const { wallet_name, type, amount } = body;
            if (!tgId || !wallet_name || !type || !amount) return res.status(400).json({ success: false, message: 'Missing required fields' });
            const [adminCheck] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [tgId]);
            if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized access' });
            }
            const [walletRow] = await connection.execute('SELECT balance FROM admin_accounts WHERE wallet_name = ?', [wallet_name]);
            if (walletRow.length === 0) {
                await connection.end();
                return res.status(404).json({ success: false, message: 'Wallet not found' });
            }
            let currentBal = parseFloat(walletRow[0].balance);
            let numAmount = parseFloat(amount);
            let newBal = type === 'add' ? currentBal + numAmount : currentBal - numAmount;
            await connection.execute('UPDATE admin_accounts SET balance = ? WHERE wallet_name = ?', [newBal, wallet_name]);
            responseData = { success: true, message: 'Wallet balance updated successfully' };
        }
        else if (action === 'update_referral_settings') {
            const { referral_percentage, referral_notice } = body;
            if (!tgId) return res.status(400).json({ success: false, message: 'Telegram ID is required' });
            const [adminCheck] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [tgId]);
            if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized access' });
            }
            await connection.execute('UPDATE settings SET referral_percentage = ?, referral_notice = ? WHERE id = 1', [referral_percentage, referral_notice]);
            responseData = { success: true, message: 'Referral settings updated successfully' };
                  }
              else if (action === 'get_all_users') {
            if (!tgId) return res.status(400).json({ success: false, message: 'Telegram ID is required' });
            const [adminCheck] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [tgId]);
            if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
            }
            const [allUsers] = await connection.execute('SELECT id, telegram_id, username, first_name, balance, role, status, created_at FROM users ORDER BY id DESC');
            responseData = { success: true, users: allUsers };
        }
        else if (action === 'manage_user_action') {
            const { target_tg_id, sub_action, value } = body;
            if (!tgId || !target_tg_id || !sub_action) return res.status(400).json({ success: false, message: 'Missing required fields' });
            const [adminCheck] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [tgId]);
            if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized access' });
            }
            if (sub_action === 'balance_add' || sub_action === 'balance_sub') {
                const [targetUser] = await connection.execute('SELECT balance FROM users WHERE telegram_id = ?', [target_tg_id]);
                if (targetUser.length === 0) {
                    await connection.end();
                    return res.status(404).json({ success: false, message: 'User not found' });
                }
                let currentBal = parseFloat(targetUser[0].balance || 0);
                let amount = parseFloat(value);
                let newBal = sub_action === 'balance_add' ? currentBal + amount : currentBal - amount;
                if (newBal < 0) newBal = 0;
                await connection.execute('UPDATE users SET balance = ? WHERE telegram_id = ?', [newBal, target_tg_id]);
            } 
            else if (sub_action === 'toggle_status') {
                await connection.execute('UPDATE users SET status = ? WHERE telegram_id = ?', [value, target_tg_id]);
            } 
            else if (sub_action === 'toggle_role') {
                await connection.execute('UPDATE users SET role = ? WHERE telegram_id = ?', [value, target_tg_id]);
            } 
            else if (sub_action === 'delete_user') {
                await connection.execute('DELETE FROM users WHERE telegram_id = ?', [target_tg_id]);
            }
            responseData = { success: true, message: 'User action executed successfully' };
        }

        if (connection) {
            await connection.end();
        }
        res.json(responseData);
    } catch (error) {
        console.error('API Error:', error);
        if (connection) {
            await connection.end();
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// SELF-PING & START SERVER
// ============================================================
setInterval(() => {
    const appUrl = process.env.RENDER_EXTERNAL_URL;
    if (appUrl) {
        fetch(`${appUrl}/api/get-user?tg_id=ping`).catch(() => {});
    }
}, 14 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
