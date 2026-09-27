const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

// ডাটাবেজ কানেকশন কনফিগারেশন
const dbConfig = {
    host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
    port: 14363,
    user: 'avnadmin',
    password: 'AVNS_hhfXItvXPam49_lMnOU',
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
};

// ==========================================
// ১. ইউজার প্যানেল বাটন ম্যানেজমেন্ট এপিআইসমূহ
// ==========================================

// নতুন বাটন অ্যাড করার এপিআই
router.all('/api/buttons/add', async (req, res) => {
    try {
        const { button_name, button_action, button_icon } = req.body;
        
        if (!button_name || !button_action) {
            return res.status(400).json({ success: false, message: 'Button name and action are required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        const query = 'INSERT INTO custom_buttons (button_name, button_action, button_icon) VALUES (?, ?, ?)';
        const [result] = await connection.execute(query, [
            button_name, 
            button_action, 
            button_icon || 'fa-solid fa-bolt'
        ]);
        await connection.end();

        res.json({ success: true, message: 'সফলভাবে নতুন বাটন যোগ করা হয়েছে!', buttonId: result.insertId });
    } catch (error) {
        console.error('Add Button Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// বাটন আপডেট করার এপিআই
router.all('/api/buttons/update', async (req, res) => {
    try {
        const { id, button_name, button_action, button_icon } = req.body;
        
        if (!id) {
            return res.status(400).json({ success: false, message: 'Button ID is required for update.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        const query = 'UPDATE custom_buttons SET button_name = ?, button_action = ?, button_icon = ? WHERE id = ?';
        await connection.execute(query, [button_name, button_action, button_icon, id]);
        await connection.end();

        res.json({ success: true, message: 'বাটনের তথ্য সফলভাবে আপডেট করা হয়েছে!' });
    } catch (error) {
        console.error('Update Button Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// বাটন ডিলিট করার এপিআই
router.all('/api/buttons/delete', async (req, res) => {
    try {
        const { id } = req.body;
        
        if (!id) {
            return res.status(400).json({ success: false, message: 'Button ID is required for deletion.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        const query = 'DELETE FROM custom_buttons WHERE id = ?';
        await connection.execute(query, [id]);
        await connection.end();

        res.json({ success: true, message: 'বাটনটি সফলভাবে মুছে ফেলা হয়েছে!' });
    } catch (error) {
        console.error('Delete Button Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// সকল বাটন দেখার এপিআই
router.all('/api/buttons/list', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM custom_buttons ORDER BY id ASC');
        await connection.end();

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('List Buttons Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// =====================================================================
// ২. এডমিন প্যানেল বাটন / কন্ট্রোল ম্যানেজমেন্ট এপিআইসমূহ
// =====================================================================

// ক. এডমিন বাটন লিস্ট দেখার এপিআই
router.all('/api/admin/buttons/list', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS admin_buttons (
                id INT AUTO_INCREMENT PRIMARY KEY,
                button_key VARCHAR(100) UNIQUE NOT NULL,
                button_name VARCHAR(255) NOT NULL,
                button_desc TEXT NOT NULL,
                button_action VARCHAR(255) NOT NULL,
                is_fixed TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const [existing] = await connection.execute('SELECT COUNT(*) as count FROM admin_buttons');
        if (existing[0].count === 0) {
            const defaultAdminButtons = [
                ['accounts', 'Account Management', 'Review and manage accounts', 'accounts.html', 0],
                ['users', 'User Management', 'Manage registered users', 'users.html', 0],
                ['deposit', 'Deposit Requests', 'Review and manage deposits', 'deposit.html', 0],
                ['withdraw', 'Withdrawal Requests', 'Process user withdrawal requests', 'withdraw.html', 0],
                ['buttonmgmt', 'Button Management', 'Add, edit or delete user panel buttons', 'button_mgmt.html', 1],
                ['adminbuttonmgmt', 'Admin Button Management', 'Manage admin panel buttons and cards', 'admin_button_mgmt.html', 1],
                ['tasks', 'Task Management', 'Manage microtask submissions', 'tasks.html', 0],
                ['instagram', 'Instagram Tasks', 'Manage Instagram task operations', 'instagram.html', 0],
                ['instagram2fa', 'Instagram 2FA Random', 'Manage Instagram 2FA random accounts', 'instagram_2fa.html', 0],
                ['gmail', 'Gmail Tasks', 'Manage Gmail task submissions', 'gmail.html', 0],
                ['facebook', 'Facebook Tasks', 'Manage Facebook task operations', 'facebook.html', 0],
                ['tiktok', 'TikTok Tasks', 'Manage TikTok task operations', 'tiktok.html', 0],
                ['twitter', 'X / Twitter Tasks', 'Manage X and Twitter tasks', 'twitter.html', 0],
                ['gift', 'Gift Code Manager', 'Create and manage gift codes', 'gift_codes.html', 0],
                ['bonus', 'Bonus Management', 'Configure bonus campaigns', 'target_bonus.html', 0],
                ['referral', 'Referral Management', 'Manage referral commissions', 'referral_mgmt.html', 0],
                ['trophy', 'Referral Leaders', 'View top referral performers', 'top_referral.html', 0],
                ['star', 'Top Workers', 'Monitor highest earning workers', 'top_worker.html', 0],
                ['service', 'Service Center', 'Manage all available services', 'other_services.html', 0]
            ];

            for (let btn of defaultAdminButtons) {
                await connection.execute(
                    'INSERT IGNORE INTO admin_buttons (button_key, button_name, button_desc, button_action, is_fixed) VALUES (?, ?, ?, ?, ?)',
                    btn
                );
            }
        }

        const [rows] = await connection.execute('SELECT * FROM admin_buttons ORDER BY id ASC');
        await connection.end();

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Admin Buttons List Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// খ. নতুন এডমিন বাটন বা কার্ড যোগ করার এপিআই
router.all('/api/admin/buttons/add', async (req, res) => {
    try {
        const { button_key, button_name, button_desc, button_action } = req.body;
        if (!button_name || !button_action) {
            return res.status(400).json({ success: false, message: 'Button name and action are required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        const query = 'INSERT INTO admin_buttons (button_key, button_name, button_desc, button_action, is_fixed) VALUES (?, ?, ?, ?, 0)';
        const [result] = await connection.execute(query, [
            button_key || 'custom_' + Date.now(),
            button_name,
            button_desc || '',
            button_action
        ]);
        await connection.end();

        res.json({ success: true, message: 'সফলভাবে নতুন এডমিন বাটন যোগ করা হয়েছে!', buttonId: result.insertId });
    } catch (error) {
        console.error('Add Admin Button Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// গ. এডমিন বাটন ডিলিট করার এপিআই
router.all('/api/admin/buttons/delete', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Button ID is required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        
        const [rows] = await connection.execute('SELECT is_fixed FROM admin_buttons WHERE id = ?', [id]);
        if (rows.length > 0 && rows[0].is_fixed === 1) {
            await connection.end();
            return res.status(403).json({ success: false, message: 'এই বাটনটি সিস্টেমের জন্য অত্যন্ত জরুরি এবং এটি ডিলিট করা যাবে না!' });
        }

        await connection.execute('DELETE FROM admin_buttons WHERE id = ?', [id]);
        await connection.end();

        res.json({ success: true, message: 'এডমিন বাটনটি সফলভাবে মুছে ফেলা হয়েছে!' });
    } catch (error) {
        console.error('Delete Admin Button Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// =====================================================================
// ৩. 𝑺𝒐𝒄𝒊𝒂𝒍-𝑿 Gmail Sell & Management System APIs
// =====================================================================

// প্রয়োজনীয় টেবিলগুলো স্বয়ংক্রিয়ভাবে তৈরি করার হেলপার ফাংশন
async function initGmailTables(connection) {
    // ১. জিমেইল সাবমিশন টেবিল
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS gmail_submissions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            category VARCHAR(50) NOT NULL,
            email VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            additional_info TEXT NULL,
            rate DECIMAL(12, 6) NOT NULL DEFAULT 0.000000,
            status ENUM('pending', 'checking', 'approved', 'rejected') DEFAULT 'pending',
            admin_note TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ২. কাস্টম নেম ডাটা স্টক (বাল্ক আপলোড টেবিল)
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS gmail_custom_names_stock (
            id INT AUTO_INCREMENT PRIMARY KEY,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            suggested_email VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            is_used TINYINT(1) DEFAULT 0,
            used_by_user_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ৩. ক্যাটাগরি সেটিংস টেবিল (Rules, Rates, Tutorial Links)
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS gmail_settings (
            category_key VARCHAR(50) PRIMARY KEY,
            rules TEXT NULL,
            rate DECIMAL(12, 6) NOT NULL DEFAULT 0.000000,
            tutorial_link VARCHAR(500) NULL,
            custom_password VARCHAR(255) NULL
        )
    `);

    // ডিফল্ট ক্যাটাগরি সেটিংস ইনসার্ট করা
    const [existing] = await connection.execute('SELECT COUNT(*) as count FROM gmail_settings');
    if (existing[0].count === 0) {
        const defaultCategories = [
            ['new_random', '1. Submit active email.\n2. Do not use recovery phone.', 0.002000, 'https://youtube.com', ''],
            ['new_custom_password', '1. Use provided password only.', 0.002500, 'https://youtube.com', 'SocialX1234#'],
            ['new_custom_name', '1. Use assigned name and details.\n2. Violations lead to suspension.', 0.003000, 'https://youtube.com', ''],
            ['old_gmail', '1. Must be older than specified days.', 0.005000, 'https://youtube.com', ''],
            ['used_gmail', '1. Mention previous usage explicitly.', 0.001500, 'https://youtube.com', '']
        ];
        for (let cat of defaultCategories) {
            await connection.execute(
                'INSERT IGNORE INTO gmail_settings (category_key, rules, rate, tutorial_link, custom_password) VALUES (?, ?, ?, ?, ?)',
                cat
            );
        }
    }
}

// ---------------------------------------------------------------------
// ক. ইউজার পেজ ডাটা (ক্যাটাগরি রুলস, রেট, টিউটোরিয়াল ও গত ২৪ ঘণ্টার কাউন্ট)
// ---------------------------------------------------------------------
router.all('/api/gmail/category-info', async (req, res) => {
    try {
        const { category, user_id } = req.body;
        if (!category) {
            return res.status(400).json({ success: false, message: 'Category name is required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        await initGmailTables(connection);

        const [settings] = await connection.execute('SELECT * FROM gmail_settings WHERE category_key = ?', [category]);
        
        let last24Count = 0;
        if (user_id) {
            const [countResult] = await connection.execute(
                `SELECT COUNT(*) as count FROM gmail_submissions 
                 WHERE user_id = ? AND category = ? AND created_at >= NOW() - INTERVAL 1 DAY`,
                [user_id, category]
            );
            last24Count = countResult[0].count;
        }

        await connection.end();

        if (settings.length === 0) {
            return res.status(404).json({ success: false, message: 'Category settings not found.' });
        }

        res.json({
            success: true,
            brand: '𝑺𝒐𝒄𝒊𝒂𝒍-𝑿',
            data: {
                category: settings[0].category_key,
                rules: settings[0].rules,
                rate: parseFloat(settings[0].rate),
                tutorial_link: settings[0].tutorial_link,
                custom_password: settings[0].custom_password,
                submitted_last_24h: last24Count
            }
        });
    } catch (error) {
        console.error('Gmail Category Info Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---------------------------------------------------------------------
// খ. কাস্টম নেম ডাটা জেনারেট এপিআই (Category 3 - Unique System)
// ---------------------------------------------------------------------
router.all('/api/gmail/generate-custom-name', async (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id) {
            return res.status(400).json({ success: false, message: 'User ID is required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        await initGmailTables(connection);

        const [stock] = await connection.execute(
            'SELECT * FROM gmail_custom_names_stock WHERE is_used = 0 LIMIT 1'
        );

        if (stock.length === 0) {
            await connection.end();
            return res.status(404).json({ 
                success: false, 
                message: 'No available account data in stock! Please contact support or try later.' 
            });
        }

        await connection.end();

        res.json({
            success: true,
            data: {
                id: stock[0].id,
                first_name: stock[0].first_name,
                last_name: stock[0].last_name,
                suggested_email: stock[0].suggested_email,
                password: stock[0].password
            }
        });
    } catch (error) {
        console.error('Generate Custom Name Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---------------------------------------------------------------------
// গ. ইউজার জিমেইল সাবমিট এপিআই (All 5 Categories)
// ---------------------------------------------------------------------
router.all('/api/gmail/submit', async (req, res) => {
    try {
        const { user_id, category, email, password, additional_info, generated_stock_id, warning_agreed } = req.body;

        if (!user_id || !category || !email || !password) {
            return res.status(400).json({ success: false, message: 'Missing required submission fields.' });
        }

        if (category === 'new_custom_name' && !warning_agreed) {
            return res.status(400).json({ 
                success: false, 
                message: 'You must agree to the privacy and warning terms before submitting!' 
            });
        }

        const connection = await mysql.createConnection(dbConfig);
        await initGmailTables(connection);

        const [catSettings] = await connection.execute('SELECT rate FROM gmail_settings WHERE category_key = ?', [category]);
        const rate = catSettings.length > 0 ? catSettings[0].rate : 0.000000;

        const [result] = await connection.execute(
            `INSERT INTO gmail_submissions (user_id, category, email, password, additional_info, rate, status) 
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [user_id, category, email, password, additional_info || null, rate]
        );

        if (category === 'new_custom_name' && generated_stock_id) {
            await connection.execute(
                'UPDATE gmail_custom_names_stock SET is_used = 1, used_by_user_id = ? WHERE id = ?',
                [user_id, generated_stock_id]
            );
        }

        await connection.end();

        res.json({
            success: true,
            message: 'Gmail submitted successfully and is currently under review!',
            submission_id: result.insertId
        });
    } catch (error) {
        console.error('Gmail Submit Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---------------------------------------------------------------------
// ঘ. ইউজার সাবমিশন হিস্টরি দেখার এপিআই
// ---------------------------------------------------------------------
router.all('/api/gmail/user-history', async (req, res) => {
    try {
        const { user_id, category } = req.body;
        if (!user_id) {
            return res.status(400).json({ success: false, message: 'User ID is required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        await initGmailTables(connection);

        let query = 'SELECT * FROM gmail_submissions WHERE user_id = ?';
        let params = [user_id];

        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }

        query += ' ORDER BY id DESC LIMIT 50';

        const [rows] = await connection.execute(query, params);
        await connection.end();

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('User History Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---------------------------------------------------------------------
// ঙ. এডমিন ম্যানেজমেন্ট এপিআই - লিস্ট রিড (৫টি আলাদা ট্যাব সাপোর্টেড)
// ---------------------------------------------------------------------
router.all('/api/admin/gmail/submissions', async (req, res) => {
    try {
        const { category, status } = req.body;

        const connection = await mysql.createConnection(dbConfig);
        await initGmailTables(connection);

        let query = 'SELECT * FROM gmail_submissions WHERE 1=1';
        let params = [];

        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY id DESC';

        const [rows] = await connection.execute(query, params);
        await connection.end();

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Admin Submissions List Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---------------------------------------------------------------------
// চ. এডমিন স্ট্যাটাস চেঞ্জ (Checking/Approve/Reject + Referral Commission)
// ---------------------------------------------------------------------
router.all('/api/admin/gmail/update-status', async (req, res) => {
    try {
        const { submission_id, status, admin_note } = req.body;

        if (!submission_id || !['checking', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Valid submission ID and status are required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        await initGmailTables(connection);

        const [submissions] = await connection.execute('SELECT * FROM gmail_submissions WHERE id = ?', [submission_id]);
        if (submissions.length === 0) {
            await connection.end();
            return res.status(404).json({ success: false, message: 'Submission record not found.' });
        }

        const sub = submissions[0];

        if (sub.status === 'approved' || sub.status === 'rejected') {
            await connection.end();
            return res.status(400).json({ success: false, message: `Submission is already marked as ${sub.status}.` });
        }

        if (status === 'checking') {
            await connection.execute(
                'UPDATE gmail_submissions SET status = "checking", admin_note = ? WHERE id = ?',
                [admin_note || null, submission_id]
            );
            await connection.end();
            return res.json({ success: true, message: 'Status updated to Checking.' });
        }

        if (status === 'rejected') {
            await connection.execute(
                'UPDATE gmail_submissions SET status = "rejected", admin_note = ? WHERE id = ?',
                [admin_note || null, submission_id]
            );
            await connection.end();
            return res.json({ success: true, message: 'Submission rejected.' });
        }

        if (status === 'approved') {
            const earnedAmount = parseFloat(sub.rate);

            // ১. ইউজারের ব্যালেন্স যোগ
            await connection.execute(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [earnedAmount, sub.user_id]
            );

            // ২. জিমেইল সাবমিশন স্ট্যাটাস আপডেট
            await connection.execute(
                'UPDATE gmail_submissions SET status = "approved", admin_note = ? WHERE id = ?',
                [admin_note || null, submission_id]
            );

            // ৩. অটোমেটিক রেফারেল কমিশন যোগ
            const [userRows] = await connection.execute('SELECT referred_by FROM users WHERE id = ?', [sub.user_id]);
            
            if (userRows.length > 0 && userRows[0].referred_by) {
                const referrerId = userRows[0].referred_by;

                const [settingRows] = await connection.execute('SELECT value FROM settings WHERE key = "referral_percentage"');
                const referralPercent = settingRows.length > 0 ? parseFloat(settingRows[0].value) : 10.0;

                const commissionAmount = (earnedAmount * referralPercent) / 100.0;

                if (commissionAmount > 0) {
                    await connection.execute(
                        'UPDATE users SET balance = balance + ? WHERE id = ?',
                        [commissionAmount, referrerId]
                    );

                    await connection.execute(`
                        CREATE TABLE IF NOT EXISTS referral_commissions (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            referrer_id INT NOT NULL,
                            referred_user_id INT NOT NULL,
                            amount DECIMAL(12, 6) NOT NULL,
                            source VARCHAR(50) DEFAULT 'gmail',
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await connection.execute(
                        'INSERT INTO referral_commissions (referrer_id, referred_user_id, amount, source) VALUES (?, ?, ?, "gmail")',
                        [referrerId, sub.user_id, commissionAmount]
                    );

                    await connection.execute(`
                        CREATE TABLE IF NOT EXISTS transactions (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            user_id INT NOT NULL,
                            amount DECIMAL(12, 6) NOT NULL,
                            type VARCHAR(50) NOT NULL,
                            description TEXT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await connection.execute(
                        'INSERT INTO transactions (user_id, amount, type, description) VALUES (?, ?, "referral_commission", ?)',
                        [referrerId, commissionAmount, `Gmail referral commission from user #${sub.user_id}`]
                    );
                }
            }

            await connection.end();
            return res.json({ 
                success: true, 
                message: `Submission approved! Credited $${earnedAmount.toFixed(6)} to user balance and referral commission processed.` 
            });
        }

    } catch (error) {
        console.error('Admin Update Status Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---------------------------------------------------------------------
// ছ. কাস্টম নেম বাল্ক আপলোড এপিআই (Category 3 - Admin Bulk Upload)
// ---------------------------------------------------------------------
router.all('/api/admin/gmail/bulk-upload-custom-names', async (req, res) => {
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Items array is required for bulk upload.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        await initGmailTables(connection);

        let insertedCount = 0;
        for (let item of items) {
            if (item.first_name && item.last_name && item.suggested_email && item.password) {
                await connection.execute(
                    `INSERT INTO gmail_custom_names_stock (first_name, last_name, suggested_email, password) 
                     VALUES (?, ?, ?, ?)`,
                    [item.first_name, item.last_name, item.suggested_email, item.password]
                );
                insertedCount++;
            }
        }

        await connection.end();

        res.json({
            success: true,
            message: `Successfully bulk uploaded ${insertedCount} custom name records!`
        });
    } catch (error) {
        console.error('Bulk Upload Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---------------------------------------------------------------------
// জ. ডাইনামিক সেটিংস আপডেট (Rules, Rates, Tutorial Links, Passwords)
// ---------------------------------------------------------------------
router.all('/api/admin/gmail/update-settings', async (req, res) => {
    try {
        const { category_key, rules, rate, tutorial_link, custom_password } = req.body;

        if (!category_key) {
            return res.status(400).json({ success: false, message: 'category_key is required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        await initGmailTables(connection);

        await connection.execute(
            `INSERT INTO gmail_settings (category_key, rules, rate, tutorial_link, custom_password) 
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
             rules = VALUES(rules), 
             rate = VALUES(rate), 
             tutorial_link = VALUES(tutorial_link),
             custom_password = VALUES(custom_password)`,
            [category_key, rules || null, rate || 0.000000, tutorial_link || null, custom_password || null]
        );

        await connection.end();

        res.json({ success: true, message: `Settings updated successfully for ${category_key}!` });
    } catch (error) {
        console.error('Update Gmail Settings Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
