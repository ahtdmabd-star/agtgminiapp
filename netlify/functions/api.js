const mysql = require('mysql2/promise');

exports.handler = async (event, context) => {
    // হেডার ও মেথড চেক
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ success: false, message: 'Method Not Allowed' }) };
    }

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        // রিকোয়েস্ট থেকে ডাটা বা অ্যাকশন প্যারামিটার রিড করা
        const body = event.body ? JSON.parse(event.body) : {};
        const action = body.action || event.queryStringParameters.action;

        let responseData = { success: false, message: 'Invalid Action' };

        // ১. ইউজার বা অ্যাডমিন ডাটা ফেচ করার কাজ
        if (action === 'get_user') {
            const tgId = body.tg_id || event.queryStringParameters.tg_id;
            const [users] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
            
            if (users.length > 0) {
                responseData = { success: true, user: users[0] };
            } else {
                responseData = { success: false, message: 'User not found' };
            }
        }

        // ২. রেফারেল সেটিংস আপডেট করার কাজ (শুধুমাত্র অ্যাডমিন)
        else if (action === 'update_referral_settings') {
            const { tg_id, referral_percentage, referral_notice } = body;

            // এডমিন ভেরিফিকেশন
            const [adminCheck] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [tg_id]);
            if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
                await connection.end();
                return { statusCode: 403, body: JSON.stringify({ success: false, message: 'Unauthorized access' }) };
            }

            // সেটিংস টেবিল আপডেট
            await connection.execute(
                'UPDATE settings SET referral_percentage = ?, referral_notice = ? WHERE id = 1',
                [referral_percentage, referral_notice]
            );

            responseData = { success: true, message: 'Referral settings updated successfully' };
        }

        await connection.end();

        return {
            statusCode: 200,
            body: JSON.stringify(responseData)
        };

    } catch (error) {
        console.error('API Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: error.message })
        };
    }
};
