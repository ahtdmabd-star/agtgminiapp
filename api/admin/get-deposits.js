const mysql = require('mysql2/promise');
const dbConfig = { host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com', port: 14363, database: 'defaultdb', user: 'avnadmin', password: 'AVNS_hhfXItvXPam49_lMnOU', ssl: { rejectUnauthorized: false } };

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    const { telegram_id } = req.query;

    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [adminCheck] = await conn.execute('SELECT role FROM users WHERE telegram_id = ?', [telegram_id]);
        if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const [deposits] = await conn.execute('SELECT * FROM deposits WHERE status = "pending" ORDER BY id DESC');
        return res.status(200).json({ success: true, deposits });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.end();
    }
};
