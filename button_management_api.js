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

// ১. নতুন বাটন অ্যাড করার এপিআই
router.all('/api/buttons/add', async (req, res) => {
    try {
        const { button_name, button_action, button_icon } = req.body;
        const connection = await mysql.createConnection(dbConfig);
        
        const query = 'INSERT INTO custom_buttons (button_name, button_action, button_icon) VALUES (?, ?, ?)';
        const [result] = await connection.execute(query, [button_name, button_action, button_icon]);
        await connection.end();

        res.json({ success: true, message: 'সফলভাবে নতুন বাটন যোগ করা হয়েছে!', buttonId: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ২. বাটন আপডেট করার এপিআই (বডি থেকে আইডি রিসিভ করার জন্য এটি ঠিক করা হয়েছে)
router.all('/api/buttons/update', async (req, res) => {
    try {
        const { id, button_name, button_action, button_icon } = req.body;
        const connection = await mysql.createConnection(dbConfig);

        const query = 'UPDATE custom_buttons SET button_name = ?, button_action = ?, button_icon = ? WHERE id = ?';
        await connection.execute(query, [button_name, button_action, button_icon, id]);
        await connection.end();

        res.json({ success: true, message: 'বাটনের তথ্য সফলভাবে আপডেট করা হয়েছে!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ৩. বাটন ডিলিট করার এপিআই (বডি থেকে আইডি রিসিভ করার জন্য)
router.all('/api/buttons/delete', async (req, res) => {
    try {
        const { id } = req.body;
        const connection = await mysql.createConnection(dbConfig);

        const query = 'DELETE FROM custom_buttons WHERE id = ?';
        await connection.execute(query, [id]);
        await connection.end();

        res.json({ success: true, message: 'বাটনটি সফলভাবে মুছে ফেলা হয়েছে!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ৪. সকল বাটন দেখার এপিআই
router.all('/api/buttons/list', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM custom_buttons');
        await connection.end();

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
