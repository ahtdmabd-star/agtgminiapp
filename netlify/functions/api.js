const mysql = require('mysql2/promise');

exports.handler = async (event, context) => {
    // শুধুমাত্র POST বা GET রিকোয়েস্ট অ্যালাউ করা
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ success: false, message: 'Method Not Allowed' }) 
        };
    }

    let connection;

    try {
        // ডাটাবেজ কানেকশন তৈরি
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        // বডি বা কুয়েরি প্যারামিটার থেকে ডাটা রিড করা
        const body = event.body ? JSON.parse(event.body) : {};
        const action = body.action || (event.queryStringParameters && event.queryStringParameters.action);
        const tgId = body.tg_id || (event.queryStringParameters && event.queryStringParameters.tg_id);

        let responseData = { success: false, message: 'Invalid Action' };

        // ১. সাধারণ ইউজারের ডাটা ফেচ করার জন্য
        if (action === 'get_user') {
            if (!tgId) {
                return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Telegram ID is required' }) };
            }

            const [users] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
            
            if (users.length > 0) {
                responseData = { success: true, user: users[0] };
            } else {
                responseData = { success: false, message: 'User not found' };
            }
        }

        // ২. অ্যাডমিন প্যানেলের জন্য ইউজার এবং সেটিংস ডেটা ফেচ করার কাজ
        else if (action === 'get_admin_data') {
            if (!tgId) {
                return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Telegram ID is required' }) };
            }

            // ইউজারের রোল চেক করা
            const [users] = await connection.execute('SELECT * FROM users WHERE telegram_id = ?', [tgId]);
            
            if (users.length === 0 || users[0].role !== 'admin') {
                await connection.end();
                return { 
                    statusCode: 403, 
                    body: JSON.stringify({ success: false, message: 'Unauthorized: Admin access required' }) 
                };
            }

            // সেটিংস টেবিল থেকে রেফারেল সেটিংস ফেচ করা (যদি টেবিল বা রো না থাকে তবে ডিফল্ট মান পাঠানো হবে)
            let settings = { referral_percentage: 5.00, referral_notice: '' };
            try {
                const [settingsRows] = await connection.execute('SELECT referral_percentage, referral_notice FROM settings WHERE id = 1');
                if (settingsRows.length > 0) {
                    settings = settingsRows[0];
                }
            } catch (err) {
                console.log('Settings table fetch note: Using default values.');
            }

            responseData = { 
                success: true, 
                user: users[0], 
                settings: settings 
            };
        }

        // ৩. রেফারেল সেটিংস আপডেট করার কাজ (শুধুমাত্র অ্যাডমিন)
        else if (action === 'update_referral_settings') {
            const { referral_percentage, referral_notice } = body;

            if (!tgId) {
                return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Telegram ID is required' }) };
            }

            // এডমিন ভেরিফিকেশন
            const [adminCheck] = await connection.execute('SELECT role FROM users WHERE telegram_id = ?', [tgId]);
            if (adminCheck.length === 0 || adminCheck[0].role !== 'admin') {
                await connection.end();
                return { 
                    statusCode: 403, 
                    body: JSON.stringify({ success: false, message: 'Unauthorized access' }) 
                };
            }

            // সেটিংস টেবিল আপডেট (যদি টেবিল না থাকে বা আপডেট করতে সমস্যা হয়)
            await connection.execute(
                'UPDATE settings SET referral_percentage = ?, referral_notice = ? WHERE id = 1',
                [referral_percentage, referral_notice]
            );

            responseData = { success: true, message: 'Referral settings updated successfully' };
        }

        if (connection) await connection.end();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseData)
        };

    } catch (error) {
        console.error('API Error:', error);
        if (connection) await connection.end();
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, message: error.message })
        };
    }
};
