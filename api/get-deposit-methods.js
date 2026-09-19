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

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT method_name, account_number FROM deposit_methods WHERE is_active = 1');
        
        let methods = {};
        rows.forEach(row => {
            methods[row.method_name] = row.account_number;
        });

        return res.status(200).json({ success: true, methods: methods });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) await connection.end();
    }
};
