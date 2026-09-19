const mysql = require('mysql2/promise');
const fetch = require('node-fetch');

const dbConfig = {
    host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
    port: 14363,
    database: 'defaultdb',
    user: 'avnadmin',
    password: 'AVNS_hhfXItvXPam49_lMnOU',
    ssl: { rejectUnauthorized: false }
};

const botToken = '8332234102:AAEn-gW1WCbt4_a7od8sCvysndE2u3nZtNc';
const channelUsername = '@AHTG_OFFICIAL';
const groupUsername = '@ahtgofic';

async function checkTelegramMembership(chatId, userId) {
    try {
        const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${chatId}&user_id=${userId}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result) {
            const status = data.result.status;
            const validStatuses = ['creator', 'administrator', 'member'];
            return validStatuses.includes(status);
        }
        return false;
    } catch (error) {
        return false;
    }
}

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

        const isChannelMember = await checkTelegramMembership(channelUsername, telegramId);
        const isGroupMember = await checkTelegramMembership(groupUsername, telegramId);

        const newStatus = (isChannelMember && isGroupMember) ? 'active' : 'unverified';

        await connection.execute(
            'UPDATE users SET status = ? WHERE telegram_id = ?',
            [newStatus, telegramId]
        );

        const [rows] = await connection.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            [telegramId]
        );

        if (rows.length > 0) {
            const user = rows[0];
            const isVerified = (isChannelMember && isGroupMember);
            return res.status(200).json({
                success: true,
                verified: isVerified,
                userData: user
            });
        } else {
            return res.status(404).json({ success: false, message: 'User account not found in database.' });
        }

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) await connection.end();
    }
};
