// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    // 1. Ambil token dari Header (Format: "Bearer <token>")
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Ambil bagian tokennya saja

    // 2. Jika tidak ada token, tolak akses
    if (!token) {
        return res.status(401).json({ message: 'Akses Ditolak! Anda belum login.' });
    }

    // 3. Verifikasi Token
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token tidak valid atau kadaluarsa.' });
        }
        
        // 4. Jika valid, simpan data user ke request agar bisa dipakai di controller
        req.user = user;
        next(); // Lanjut ke proses berikutnya
    });
};