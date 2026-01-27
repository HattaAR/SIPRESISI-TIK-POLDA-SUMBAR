// controllers/authController.js
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

exports.login = async (req, res) => {
    const { username, password } = req.body;

    try {
        // 1. Cek User
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(401).json({ message: 'Username tidak ditemukan' });

        const user = users[0];

        // 2. Cek Password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ message: 'Password salah' });

        if (!user.is_active) return res.status(403).json({ message: 'Akun dinonaktifkan' });

        // 3. Buat Token
        const token = jwt.sign(
            { id: user.id, role: user.role, name: user.full_name },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        // ============================================================
        // [BARU] 4. CATAT LOG AKTIVITAS (CCTV)
        // ============================================================
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await db.query(
            'INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'LOGIN', `User ${user.username} berhasil login`, ip]
        );
        // ============================================================

        res.json({
            message: 'Login Berhasil',
            token,
            user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name }
        });

    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan ketika login', error: error.message });
    }
};