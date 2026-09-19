const mysql = require('mysql2/promise');
const dbConfig = { host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com', port: 14363, database: 'defaultdb', user: 'avnadmin', password: 'AVNS_hhfXItvXPam49_lMnOU', ssl: { rejectUnauthorized: false } };

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { telegram_id, method_id, account_number } = body;

    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [adminCheck] = await conn.execute('SELECT role FROM users WHERE telegram_id = ?', [telegram_id]);
        if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        await conn.execute('UPDATE deposit_methods SET account_number = ? WHERE id = ?', [account_number, method_id]);
        return res.status(200).json({ success: true, message: 'Payment number updated successfully!' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.end();
    }
};
