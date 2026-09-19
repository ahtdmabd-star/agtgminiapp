const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
    port: 14363,
    database: 'defaultdb',
    user: 'avnadmin',
    password: 'AVNS_hhfXItvXPam49_lMnOU',
    ssl: { rejectUnauthorized: false }
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    // Vercel-এ বডি পার্স করার জন্য
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    const { telegram_id, method, send_amount, get_amount, transaction_id } = body;

    if (!telegram_id || !method || !send_amount || !get_amount || !transaction_id) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        // ডিপোজিট রিকোয়েস্ট সেভ করা
        await connection.execute(
            'INSERT INTO deposits (telegram_id, method, send_amount, get_amount, transaction_id, status) VALUES (?, ?, ?, ?, ?, ?)',
            [telegram_id, method, send_amount, get_amount, transaction_id, 'pending']
        );

        return res.status(200).json({ success: true, message: 'Deposit request submitted successfully.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) await connection.end();
    }
};
