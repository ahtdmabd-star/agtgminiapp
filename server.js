const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

// সরাসরি কোডের ভেতরে ডাটাবেজ কনফিগারেশন সেট করা হলো
// কোনো .env লাগবে না
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

// স্ট্যাটিক ফাইল সার্ভ করার জন্য
// index.html, admin.html ইত্যাদি
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


        // ========================================================
        // REFERRAL SETTINGS
        // ========================================================
        // settings table থেকে referral percentage এবং notice নেওয়া হচ্ছে.
        // এতে users table বা অন্য কোনো existing system পরিবর্তন হচ্ছে না.
        // ========================================================

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

            console.log(
                'Settings table fetch note: Using default values.'
            );

        }


        // User + Referral Settings একসাথে পাঠানো হচ্ছে
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
// ২. MAIN API ROUTE
// ============================================================
// Referral এবং Admin Data Management
// ============================================================

app.all('/api/action', async (req, res) => {

    const method = req.method;

    if (method !== 'POST' && method !== 'GET') {

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

        let responseData = {
            success: false,
            message: 'Invalid Action'
        };


        // ========================================================
        // GET USER
        // ========================================================

        if (action === 'get_user') {

            if (!tgId) {

                return res.status(400).json({
                    success: false,
                    message: 'Telegram ID is required'
                });

            }

            const [users] = await connection.execute(
                'SELECT * FROM users WHERE telegram_id = ?',
                [tgId]
            );

            if (users.length > 0) {

                responseData = {
                    success: true,
                    user: users[0]
                };

            } else {

                responseData = {
                    success: false,
                    message: 'User not found'
                };

            }

        }


        // ========================================================
        // GET ADMIN DATA (Existing)
        // ========================================================

        else if (action === 'get_admin_data') {

            if (!tgId) {

                return res.status(400).json({
                    success: false,
                    message: 'Telegram ID is required'
                });

            }


            const [users] = await connection.execute(
                'SELECT * FROM users WHERE telegram_id = ?',
                [tgId]
            );


            if (
                users.length === 0 ||
                users[0].role !== 'admin'
            ) {

                await connection.end();

                return res.status(403).json({
                    success: false,
                    message: 'Unauthorized: Admin access required'
                });

            }


            // Admin panel-এর জন্য referral settings
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

                console.log(
                    'Settings table fetch note: Using default values.'
                );

            }


            responseData = {
                success: true,
                user: users[0],
                settings: settings
            };

        }


        // ========================================================
        // GET ADMIN DASHBOARD STATS (New Added for Total Users & Total Balance)
        // ========================================================

        else if (action === 'get_admin_dashboard_stats') {

            if (!tgId) {
                return res.status(400).json({
                    success: false,
                    message: 'Telegram ID is required'
                });
            }

            const [users] = await connection.execute(
                'SELECT * FROM users WHERE telegram_id = ?',
                [tgId]
            );

            if (users.length === 0 || users[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({
                    success: false,
                    message: 'Unauthorized: Admin access required'
                });
            }

            // মোট ইউজার সংখ্যা এবং মোট ব্যালেন্সের যোগফল হিসাব করা
            const [countRows] = await connection.execute(
                'SELECT COUNT(*) as total_users, SUM(balance) as total_balance FROM users'
            );

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


        // ========================================================
        // GET ADMIN ACCOUNTS & LEDGER STATS (Accounts Page API)
        // ========================================================

        else if (action === 'get_admin_accounts') {
            if (!tgId) {
                return res.status(400).json({ success: false, message: 'Telegram ID is required' });
            }

            const [users] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
            if (users.length === 0 || users[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
            }

            const [userStats] = await connection.execute('SELECT COUNT(*) as total_users, SUM(balance) as total_user_balance FROM users');
            const [wallets] = await connection.execute('SELECT wallet_name, balance FROM admin_accounts');

            let totalWalletBalance = 0;
            wallets.forEach(w => {
                totalWalletBalance += parseFloat(w.balance);
            });

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


        // ========================================================
        // UPDATE WALLET BALANCE (Plus / Minus for Accounts Page)
        // ========================================================

        else if (action === 'update_wallet_balance') {
            const { wallet_name, type, amount } = body;
            if (!tgId || !wallet_name || !type || !amount) {
                return res.status(400).json({ success: false, message: 'Missing required fields' });
            }

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

            responseData = {
                success: true,
                message: 'Wallet balance updated successfully'
            };
        }


        // ========================================================
        // UPDATE REFERRAL SETTINGS
        // ========================================================

        else if (action === 'update_referral_settings') {

            const {
                referral_percentage,
                referral_notice
            } = body;


            if (!tgId) {

                return res.status(400).json({
                    success: false,
                    message: 'Telegram ID is required'
                });

            }


            // Admin check
            const [adminCheck] = await connection.execute(
                'SELECT role FROM users WHERE telegram_id = ?',
                [tgId]
            );


            if (
                adminCheck.length === 0 ||
                adminCheck[0].role !== 'admin'
            ) {

                await connection.end();

                return res.status(403).json({
                    success: false,
                    message: 'Unauthorized access'
                });

            }


            // Referral settings update
            await connection.execute(
                'UPDATE settings SET referral_percentage = ?, referral_notice = ? WHERE id = 1',
                [
                    referral_percentage,
                    referral_notice
                ]
            );


            responseData = {
                success: true,
                message: 'Referral settings updated successfully'
            };

        }


        // ====================================================================
        // এখানে আপনার নতুন সিস্টেমের কোড রাখুন
        // (ভবিষ্যতে নতুন কোনো এপিআই বা অ্যাকশন যোগ করতে হলে ঠিক এই জায়গায় রাখবেন)
        // ====================================================================
        // ========================================================
        // GET ALL USERS (Admin User Management)
        // ========================================================


        
        else if (action === 'get_all_users') {
            if (!tgId) {
                return res.status(400).json({ success: false, message: 'Telegram ID is required' });
            }

            const [adminCheck] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [tgId]);
            if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
                await connection.end();
                return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
            }

            const [allUsers] = await connection.execute('SELECT id, telegram_id, username, first_name, balance, role, status, created_at FROM users ORDER BY id DESC');
            
            responseData = {
                success: true,
                users: allUsers
            };
        }

        // ========================================================
        // MANAGE USER ACTIONS (Edit Balance, Status, Role, Delete)
        // ========================================================
        else if (action === 'manage_user_action') {
            const { target_tg_id, sub_action, value } = body;
            if (!tgId || !target_tg_id || !sub_action) {
                return res.status(400).json({ success: false, message: 'Missing required fields' });
            }

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
                // value হবে 'active' অথবা 'banned'
                await connection.execute('UPDATE users SET status = ? WHERE telegram_id = ?', [value, target_tg_id]);
            } 
            else if (sub_action === 'toggle_role') {
                // value হবে 'admin' অথবা 'user'
                await connection.execute('UPDATE users SET role = ? WHERE telegram_id = ?', [value, target_tg_id]);
            } 
            else if (sub_action === 'delete_user') {
                await connection.execute('DELETE FROM users WHERE telegram_id = ?', [target_tg_id]);
            }

            responseData = {
                success: true,
                message: 'User action executed successfully'
            };
                                                          }
        


        // ========================================================
        // SEND RESPONSE
        // ========================================================

        if (connection) {
            await connection.end();
        }

        res.json(responseData);


    } catch (error) {

        console.error('API Error:', error);


        if (connection) {
            await connection.end();
        }


        res.status(500).json({
            success: false,
            message: error.message
        });

    }

});


// ============================================================
// SELF-PING
// ============================================================
// Render server যাতে ঘুমিয়ে না পড়ে
// ============================================================

setInterval(() => {

    const appUrl = process.env.RENDER_EXTERNAL_URL;

    if (appUrl) {

        // প্রতি ১৪ মিনিট পর নিজের server-এ request
        fetch(
            `${appUrl}/api/get-user?tg_id=ping`
        ).catch(() => {});

    }

}, 14 * 60 * 1000);


// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {

    console.log(
        `Server is running on port ${PORT}`
    );

});
                    
