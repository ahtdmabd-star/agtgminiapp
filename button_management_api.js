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
// ১. ইউজার টাস্ক/বাটন ম্যানেজমেন্ট এপিআইসমূহ
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

// সকল বাটন দেখার এপিআই (আগে অ্যাড করাগুলো উপরে রাখার জন্য ASC করা হয়েছে)
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
// ২. এডমিন প্যানেল বাটন / কন্ট্রোল ম্যানেজমেন্ট এপিআই (ভবিষ্যত বা এক্সট্রা কাজের জন্য)
// =====================================================================

// এডমিন প্যানেলের বাটন লিস্ট বা কনফিগারেশন ফেচ করার এপিআই
router.all('/api/admin/buttons/list', async (req, res) => {
    try {
        // আপনি চাইলে এডমিন প্যানেলের আলাদা টেবিল বা লজিক এখানে যুক্ত করতে পারেন
        const connection = await mysql.createConnection(dbConfig);
        
        // উদাহরণ স্বরূপ একটি ডামি বা ফ্লেক্সিবল স্ট্রাকচার রাখা হলো
        // প্রয়োজনে টেবিল বানিয়ে এখানে কুয়েরি দিতে পারবেন।
        const adminButtons = [
            { id: 1, name: 'User Management', action: '/admin/users.html', icon: 'fa-solid fa-users' },
            { id: 2, name: 'Task Settings', action: '/admin/tasks.html', icon: 'fa-solid fa-tasks' }
        ];

        await connection.end();
        res.json({ success: true, data: adminButtons, message: 'Admin buttons fetched successfully.' });
    } catch (error) {
        console.error('Admin Buttons Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// এডমিন প্যানেলের নতুন কন্ট্রোল বা বাটন যুক্ত করার এপিআই
router.all('/api/admin/buttons/save', async (req, res) => {
    try {
        const { admin_action_name, endpoint_url } = req.body;
        
        // এখানে আপনার এডমিন প্যানেল ম্যানেজমেন্টের ডাটাবেজ লজিক বসাতে পারবেন
        
        res.json({ success: true, message: 'Admin control saved successfully.' });
    } catch (error) {
        console.error('Admin Save Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
                  
