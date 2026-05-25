const mysql = require('mysql2/promise');
require('dotenv').config();

let pool;
const connectionUri = process.env.DATABASE_URL || process.env.MYSQL_URL;

if (connectionUri) {
    pool = mysql.createPool({
        uri: connectionUri,
        ssl: { rejectUnauthorized: false },
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
} else {
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'chat_app',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });
}

module.exports = pool;
