
const mysql = require('mysql2');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

//  Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_sisk',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10, 
    queueLimit: 0
});


const db = pool.promise();
db.callbackPool = pool;

// Cek koneksi saat inisialisasi
pool.getConnection((err, connection) => {
    if (err) {
        console.error(` Database Gagal Terhubung (${err.code || 'UNKNOWN'}): ${err.message}`);
        return;
    }

    console.log(` Database Terhubung (MySQL: ${process.env.DB_NAME || 'db_sisk'})!`);
    connection.release();
});

module.exports = db;
