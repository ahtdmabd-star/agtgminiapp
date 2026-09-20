const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
    port: 14363,
    database: 'defaultdb',
    user: 'avnadmin',
    password: 'AVNS_hhfXItvXPam49_lMnOU',
    ssl: {
        rejectUnauthorized: false
    }
};

module.exports = async (req, res) => {

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
    );
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type'
    );
    res.setHeader('Content-Type', 'application/json');

    // OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).json({
            success: true
        });
    }

    let connection;

    try {

        connection = await mysql.createConnection(dbConfig);

        /*
        ==========================================
        POST
        Submit New Deposit
        ==========================================
        */

        if (req.method === 'POST') {

            let body = req.body;

            if (typeof body === 'string') {
                try {
                    body = JSON.parse(body);
                } catch (e) {
                    body = {};
                }
            }

            const {
                telegram_id,
                method,
                send_amount,
                get_amount,
                transaction_id
            } = body || {};

            // Required fields
            if (
                !telegram_id ||
                !method ||
                !send_amount ||
                !get_amount ||
                !transaction_id
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'All fields are required.'
                });
            }

            // Insert deposit
            await connection.execute(
                `INSERT INTO deposits
                (
                    telegram_id,
                    method,
                    send_amount,
                    get_amount,
                    transaction_id,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    String(telegram_id),
                    method,
                    send_amount,
                    get_amount,
                    transaction_id,
                    'pending'
                ]
            );

            return res.status(200).json({
                success: true,
                message: 'Deposit request submitted successfully.'
            });
        }


        /*
        ==========================================
        GET
        Deposit History
        ==========================================
        */

        if (req.method === 'GET') {

            const telegram_id =
                req.query?.telegram_id ||
                req.query?.telegramId;

            if (!telegram_id) {
                return res.status(400).json({
                    success: false,
                    message: 'telegram_id is required.'
                });
            }

            const [rows] = await connection.execute(
                `SELECT
                    id,
                    telegram_id,
                    method,
                    send_amount,
                    get_amount,
                    transaction_id,
                    status,
                    created_at
                 FROM deposits
                 WHERE telegram_id = ?
                 ORDER BY created_at DESC, id DESC
                 LIMIT 100`,
                [String(telegram_id)]
            );

            return res.status(200).json({
                success: true,
                deposits: rows
            });
        }


        /*
        ==========================================
        Other Methods
        ==========================================
        */

        return res.status(405).json({
            success: false,
            message: 'Method Not Allowed'
        });

    } catch (error) {

        console.error('Deposit API Error:', error);

        return res.status(500).json({
            success: false,
            message: 'Database error.',
            error: error.message
        });

    } finally {

        if (connection) {
            await connection.end();
        }
    }
};
