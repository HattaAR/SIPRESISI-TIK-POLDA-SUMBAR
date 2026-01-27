// app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Load env
dotenv.config();

// Import Database (Hanya untuk memastikan koneksi berjalan)
const db = require('./config/database');

// Inisialisasi App
const app = express();
const PORT = process.env.PORT || 3000;

// ================= MIDDLEWARE =================
// Keamanan dasar header HTTP
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
}));
// Izinkan akses dari frontend (React/Vue/HTML biasa)
app.use(cors()); 
// Parsing body request (agar bisa baca JSON dari POST request)
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ================= ROUTES =================
// Test Route (Untuk cek apakah server nyala)
app.get('/', (req, res) => {
    res.json({ 
        message: 'Server SiPresisi TIK Polda Sumbar is Running...',
        status: 'OK',
        timestamp: new Date()
    });
});

// Test Database Connection Route (Hapus ini nanti jika production)
app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS solution');
        res.json({ 
            message: 'Database Connected Successfully!', 
            result: rows[0].solution 
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Database Connection Failed', 
            error: error.message 
        });
    }
});

const authRoutes = require('./routes/authRoutes');
const typeRoutes = require('./routes/typeRoutes');
const letterRoutes = require('./routes/letterRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const logRoutes = require('./routes/logRoutes');
// Gunakan Routes
app.use('/api/auth', authRoutes);
app.use('/api/types', typeRoutes);
app.use('/api/letters', letterRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/logs', logRoutes);

// const authRoutes = require('./routes/authRoutes');
// app.use('/api/auth', authRoutes);


// ================= ERROR HANDLING GLOBAL =================
// Menangkap error 500 server agar tidak crash
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: 'error',
        message: 'Terjadi kesalahan internal pada server',
        detail: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ================= START SERVER =================
app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV}`);
    console.log(`=================================================`);
});