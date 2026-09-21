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
        // সরাসরি কোডের ভেতরে ডাটাবেজ ক্রডেনশিয়াল সেট করা হলো
        connection = await mysql.createConnection({
            host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',         // এখানে আপনার ডাটাবেজ হোস্ট দিন (যেমন: localhost বা রিমোট হোস্ট)
            user: 'avnadmin',         // এখানে আপনার ডাটাবেজের ইউজারনেম দিন
            password: 'AVNS_hhfXItvXPam49_lMnOU', // এখানে আপনার ডাটাবেজের পাসওয়ার্ড দিন
            database: 'defaultdb'      // এখানে আপনার ডাটাবেজের নাম দিন
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

            // সেটিংস টেবিল থেকে রেফারেল সেটিংস ফেচ করা
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

            // সেটিংস টেবিল আপডেট
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
        
