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

    const telegramId = req.query.telegram_id;

    if (!telegramId) {
        return res.status(400).json({ success: false, message: 'Invalid Telegram ID' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        // ১. চেক করা ইউজার আসলেই অ্যাডমিন কি না
        const [userRows] = await connection.execute(
            'SELECT role FROM users WHERE telegram_id = ?',
            [telegramId]
        );

        if (userRows.length === 0 || userRows[0].role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access Denied: Admins only' });
        }

        // ২. মোট ইউজার সংখ্যা বের করা
        const [countRows] = await connection.execute('SELECT COUNT(*) AS totalUsers FROM users');
        const totalUsers = countRows[0].totalUsers || 0;

        // ৩. সমস্ত ইউজারের মোট ব্যালেন্স যোগ করা
        const [sumRows] = await connection.execute('SELECT SUM(balance) AS totalBalance FROM users');
        const totalBalance = sumRows[0].totalBalance || 0;

        return res.status(200).json({
            success: true,
            totalUsers: totalUsers,
            totalBalance: parseFloat(totalBalance).toFixed(2)
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) await connection.end();
    }
};
