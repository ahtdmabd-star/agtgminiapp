const mysql = require('mysql2/promise');
const dbConfig = { host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com', port: 14363, database: 'defaultdb', user: 'avnadmin', password: 'AVNS_hhfXItvXPam49_lMnOU', ssl: { rejectUnauthorized: false } };

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { telegram_id, deposit_id, action } = body;

    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [adminCheck] = await conn.execute('SELECT role FROM users WHERE telegram_id = ?', [telegram_id]);
        if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const [depRows] = await conn.execute('SELECT * FROM deposits WHERE id = ? AND status = "pending"', [deposit_id]);
        if (depRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Deposit not found or already processed.' });
        }

        const dep = depRows[0];

        if (action === 'approve') {
            // ১. ইউজারের ব্যালেন্স বাড়ানো
            await conn.execute('UPDATE users SET balance = balance + ? WHERE telegram_id = ?', [dep.get_amount, dep.telegram_id]);

            // ২. ট্রানজেকশন হিস্টরি টেবিলে অটোমেটিক রেকর্ড জমা করা
            const txnId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            await conn.execute(
                'INSERT INTO transactions (transaction_id, telegram_id, amount, type, description, status) VALUES (?, ?, ?, ?, ?, ?)',
                [txnId, dep.telegram_id, dep.get_amount, 'DEPOSIT', `Deposit approved via ${dep.method} (TrxID: ${dep.transaction_id})`, 'success']
            );

            // ৩. ডিপোজিট স্ট্যাটাস approved করা
            await conn.execute('UPDATE deposits SET status = "approved" WHERE id = ?', [deposit_id]);

            return res.status(200).json({ success: true, message: 'Deposit approved and balance added successfully!' });
        } else {
            await conn.execute('UPDATE deposits SET status = "rejected" WHERE id = ?', [deposit_id]);
            return res.status(200).json({ success: true, message: 'Deposit request rejected.' });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.end();
    }
};
