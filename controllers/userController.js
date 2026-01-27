const db = require('../config/database');
const bcrypt = require('bcryptjs');

// 1. Ambil Semua User
exports.getAllUsers = async (req, res) => {
    try {
        // Ambil semua kecuali password
        const [rows] = await db.query('SELECT id, username, full_name, nrp, role, is_active FROM users ORDER BY id DESC');
        res.json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2. Tambah User Baru
exports.createUser = async (req, res) => {
    const { username, password, full_name, nrp, role } = req.body;
    
    try {
        // Hash Password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        await db.query(
            'INSERT INTO users (username, password_hash, full_name, nrp, role, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [username, hash, full_name, nrp, role]
        );
        res.status(201).json({ message: 'User berhasil ditambahkan!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 3. Hapus User
exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM users WHERE id = ?', [id]);
        res.json({ message: 'User berhasil dihapus!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};