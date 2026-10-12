const { jwtSecret, tokenLifetimeSeconds, getTokenCookieOptions } = require('../config/auth');
const db = require('../config/database').callbackPool;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { logActivity } = require('../services/activityLogService');

exports.showLogin = (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, jwtSecret);
            if (decoded.role === 'admin') return res.redirect('/admin/dashboard');
            if (decoded.role === 'staff') return res.redirect('/staff/dashboard');
            if (decoded.role === 'pimpinan') return res.redirect('/pimpinan/dashboard');
        } catch (e) {
            res.clearCookie('token', getTokenCookieOptions(req));
        }
    }
    res.render('login', { title: 'Login - SIPRESISI TIK' });
};

exports.login = (req, res) => {
    const { username, password } = req.body;
    db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database Error" });
        if (results.length === 0) return res.status(401).json({ message: "Username tidak ditemukan!" });

        const user = results[0];

        // CEK is_active (1 = Aktif, 0 = Nonaktif)
        if (user.is_active === 0) {
            return res.status(403).json({ message: "Akun Anda telah dinonaktifkan oleh Admin." });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ message: "Password Salah!" });

        const token = jwt.sign(
            { id: user.id, name: user.full_name, role: user.role, nrp: user.nrp },
            jwtSecret,
            { expiresIn: tokenLifetimeSeconds }
        );

        logActivity(user.id, 'LOGIN', `User ${user.username} berhasil login ke sistem`, req);

        res.cookie('token', token, { ...getTokenCookieOptions(req), maxAge: tokenLifetimeSeconds * 1000 });
        res.json({ message: "Login Berhasil", user: { role: user.role, full_name: user.full_name } });
    });
};

exports.logout = (req, res) => {
    res.clearCookie('token', getTokenCookieOptions(req));
    res.redirect('/');
};
