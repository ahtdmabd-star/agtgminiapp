const mysql = require('mysql2/promise');
const dbConfig = { host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com', port: 14363, database: 'defaultdb', user: 'avnadmin', password: 'AVNS_hhfXItvXPam49_lMnOU', ssl: { rejectUnauthorized: false } };

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [methods] = await conn.execute('SELECT * FROM deposit_methods');
        return res.status(200).json({ success: true, methods });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.end();
    }
};
