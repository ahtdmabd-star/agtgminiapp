const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
  port: 14363,
  user: 'avnadmin',
  password: 'AVNS_hhfXItvXPam49_lMnOU',
  database: 'defaultdb',
  ssl: {
    rejectUnauthorized: false
  }
};

exports.handler = async (event, context) => {
  const tgId = event.queryStringParameters.tg_id;

  if (!tgId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: 'Telegram ID is missing.' })
    };
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    
    // ডাটাবেজ থেকে ইউজার খোঁজা
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE telegram_id = ?',
      [tgId]
    );

    if (rows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, message: 'User account not found. Please start the bot first.' })
      };
    }

    const user = rows[0];

    // টেলিগ্রাম ভেরিফিকেশন চেক
    if (user.telegram_verified !== 'verified') {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, message: 'Please join our channel and group, then verify your account via the bot.' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, user })
    };

  } catch (error) {
    console.error('Database Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Internal Server Error: ' + error.message })
    };
  } finally {
    if (connection) await connection.end();
  }
};
