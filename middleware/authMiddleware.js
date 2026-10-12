const jwt = require('jsonwebtoken');
const { jwtSecret, getTokenCookieOptions } = require('../config/auth');

const authMiddleware = (req, res, next) => {
    // 1. Ambil token dari Header (Format: "Bearer <token>")
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

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
        next(); 
    });
};

const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.redirect('/');

    try {
        const decoded = jwt.verify(token, jwtSecret);
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('token', getTokenCookieOptions(req));
        return res.redirect('/');
    }
};

module.exports = authMiddleware;
module.exports.verifyToken = verifyToken;
