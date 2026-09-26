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

// ক. এডমিন বাটন লিস্ট দেখার এপিআই (টেবিল না থাকলে অটো ডিফল্ট বাটন ক্রিয়েট ও ইনসার্ট করবে)
router.all('/api/admin/buttons/list', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        
        // প্রথমে চেক করি এডমিন টেবিলটি ডাটাবেজে আছে কি না, না থাকলে তৈরি করে নেব
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
        
        // টেবিলে কোনো ডাটা না থাকলে ডিফল্ট এডমিন বাটনগুলো ইনসার্ট করে দেব
        const [existing] = await connection.execute('SELECT COUNT(*) as count FROM admin_buttons');
        if (existing[0].count === 0) {
            const defaultAdminButtons = [
                ['accounts', 'Account Management', 'Review and manage accounts', 'accounts.html', 0],
                ['users', 'User Management', 'Manage registered users', 'users.html', 0],
                ['deposit', 'Deposit Requests', 'Review and manage deposits', 'deposit.html', 0],
                ['withdraw', 'Withdrawal Requests', 'Process user withdrawal requests', 'withdraw.html', 0],
                ['buttonmgmt', 'Button Management', 'Add, edit or delete user panel buttons', 'button_mgmt.html', 1], // ফিক্সড কার্ড
                ['adminbuttonmgmt', 'Admin Button Management', 'Manage admin panel buttons and cards', 'admin_button_mgmt.html', 1], // ফিক্সড কার্ড
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

// গ. এডমিন বাটন ডিলিট করার এপিআই (ফিক্সড বাটনগুলো ডিলিট হওয়া থেকে সুরক্ষিত থাকবে)
router.all('/api/admin/buttons/delete', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Button ID is required.' });
        }

        const connection = await mysql.createConnection(dbConfig);
        
        // চেক করা যাক বাটনটি ফিক্সড কি না
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

module.exports = router;
