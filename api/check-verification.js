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

        const [rows] = await connection.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            [telegramId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User account not found in database.' });
        }

        const user = rows[0];

        if (user.status === 'banned') {
            return res.status(200).json({
                success: true,
                verified: false,
                message: 'Your account has been banned.'
            });
        }

        // একসাথে চ্যানেল এবং গ্রুপের মেম্বারশিপ চেক করা হচ্ছে যাতে সময় কম লাগে (Fast Execution)
        const [isChannelMember, isGroupMember] = await Promise.all([
            checkTelegramMembership(channelUsername, telegramId),
            checkTelegramMembership(groupUsername, telegramId)
        ]);

        const isVerified = (isChannelMember && isGroupMember);
        const newTelegramStatus = isVerified ? 'verified' : 'unverified';

        // ডাটাবেজে স্ট্যাটাস আপডেট করা
        await connection.execute(
            'UPDATE users SET telegram_status = ? WHERE telegram_id = ?',
            [newTelegramStatus, telegramId]
        );

        user.telegram_status = newTelegramStatus;

        return res.status(200).json({
            success: true,
            verified: isVerified,
            userData: user
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) await connection.end();
    }
};
