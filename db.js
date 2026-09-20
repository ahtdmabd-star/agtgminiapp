const mysql = require('mysql2/promise');

// Aiven Database Configuration
const AIVEN_CONFIG = {
  host: 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com',
  port: 14363,
  user: 'avnadmin',
  password: 'AVNS_hhfXItvXPam49_lMnOU',
  database: 'defaultdb',
  ssl: { rejectUnauthorized: false }
};

async function getDatabaseConnection() {
  try {
    const connection = await mysql.createConnection(AIVEN_CONFIG);
    return connection;
  } catch (error) {
    console.error('Database Connection Failed:', error.message);
    throw error;
  }
}

module.exports = { getDatabaseConnection };
