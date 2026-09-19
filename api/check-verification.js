const pool = require('./db');
const fetch = require('node-fetch');

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
        connection = await pool.getConnection();

        const [rows] = await connection.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            [telegramId]
        );

        if (rows.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'User account not found in database.' });
        }

        const user = rows[0];

        if (user.status === 'banned') {
            connection.release();
            return res.status(200).json({
                success: true,
                verified: false,
                message: 'Your account has been banned.'
            });
        }

        const [isChannelMember, isGroupMember] = await Promise.all([
            checkTelegramMembership(channelUsername, telegramId),
            checkTelegramMembership(groupUsername, telegramId)
        ]);

        const isVerified = (user.role === 'admin') ? true : (isChannelMember && isGroupMember);
        const newTelegramStatus = isVerified ? 'verified' : 'unverified';

        await connection.execute(
            'UPDATE users SET telegram_status = ? WHERE telegram_id = ?',
            [newTelegramStatus, telegramId]
        );

        user.telegram_status = newTelegramStatus;
        connection.release();

        return res.status(200).json({
            success: true,
            verified: isVerified,
            role: user.role,
            userData: user
        });

    } catch (error) {
        if (connection) connection.release();
        return res.status(500).json({ success: false, message: error.message });
    }
};
