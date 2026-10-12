const db = require('../config/database');
const bcrypt = require('bcryptjs');
const callbackDb = db.callbackPool;
const { logActivity } = require('../services/activityLogService');

exports.getUsersPage = (req, res) => {
    callbackDb.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];

        callbackDb.query("SELECT * FROM users ORDER BY id DESC", (err, results) => {
            res.render('admin/users', {
                title: 'Kelola User',
                page: 'users',
                user: freshUser,
                users: results || []
            });
        });
    });
};

exports.getUsersApi = (req, res) => {
    const { role, status } = req.query;
    let sql = "SELECT id, full_name, nrp, role, is_active, is_active AS status FROM users";
    let params = [];
    let conditions = [];

    if (role) {
        conditions.push("role = ?");
        params.push(role);
    }

    if (status) {
        conditions.push("is_active = ?");
        params.push(status);
    }

    if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY full_name ASC";

    callbackDb.query(sql, params, (err, results) => {
        if (err) {
            console.error("Gagal ambil data user:", err);
            return res.status(500).json([]);
        }
        res.json(results);
    });
};

exports.createUserApi = async (req, res) => {
    const { full_name, username, nrp, password, role } = req.body;

    if (!full_name || !username || !password || !role) {
        return res.status(400).json({ message: "Data tidak lengkap" });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO users (full_name, username, nrp, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)";

        callbackDb.query(sql, [full_name, username, nrp, hash, role], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: "Username/NRP sudah digunakan" });
                return res.status(500).json({ message: "Error database" });
            }

            logActivity(req.user.id, 'CREATE_USER', `Menambahkan user baru: ${username} (${role})`, req);
            res.json({ message: "Sukses menambahkan user" });
        });
    } catch (e) {
        res.status(500).json({ message: "Server error saat hashing" });
    }
};

exports.updateUserApi = async (req, res) => {
    const { full_name, username, nrp, role, password } = req.body;
    const userId = req.params.id;

    if (!full_name || !username || !role) return res.status(400).json({ message: "Data tidak lengkap" });

    try {
        if (password && password.trim() !== "") {
            const hash = await bcrypt.hash(password, 10);
            const sql = "UPDATE users SET full_name=?, username=?, nrp=?, role=?, password_hash=? WHERE id=?";

            callbackDb.query(sql, [full_name, username, nrp, role, hash, userId], (err) => {
                if (err) return res.status(500).json({ message: "Gagal update database" });

                logActivity(req.user.id, 'UPDATE_USER', `Mengupdate data & password user ID: ${userId}`, req);
                res.json({ message: "Data user & password berhasil diperbarui!" });
            });
        } else {
            const sql = "UPDATE users SET full_name=?, username=?, nrp=?, role=? WHERE id=?";

            callbackDb.query(sql, [full_name, username, nrp, role, userId], (err) => {
                if (err) return res.status(500).json({ message: "Gagal update database" });

                logActivity(req.user.id, 'UPDATE_USER', `Mengupdate data user ID: ${userId}`, req);
                res.json({ message: "Data user berhasil diperbarui!" });
            });
        }
    } catch (error) {
        return res.status(500).json({ message: "Server Error" });
    }
};

exports.updateUserStatusApi = (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'kasubbag') {
        return res.status(403).json({ message: "Akses ditolak!" });
    }

    const userId = req.params.id;
    const sql = "UPDATE users SET is_active = NOT is_active WHERE id = ?";

    callbackDb.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).json({ message: "Gagal update status" });
        if (result.affectedRows === 0) return res.status(404).json({ message: "User tidak ditemukan" });

        logActivity(req.user.id, 'UPDATE_USER_STATUS', `Mengubah status aktif user ID: ${userId}`, req);
        res.json({ message: "Status akun berhasil diubah!" });
    });
};

exports.deleteUserApi = (req, res) => {
    if (req.params.id == req.user.id) return res.status(400).json({ message: "Tidak bisa menghapus akun sendiri" });

    const userId = req.params.id;
    const conflictMessage = "User masih digunakan oleh data bisnis atau riwayat dan tidak dapat dihapus.";
    const referenceQueries = [
        "SELECT id FROM letters WHERE user_id = ? LIMIT 1 FOR UPDATE",
        "SELECT id FROM letters WHERE approver_id = ? LIMIT 1 FOR UPDATE",
        "SELECT id FROM dispositions WHERE sender_id = ? LIMIT 1 FOR UPDATE",
        "SELECT id FROM dispositions WHERE receiver_id = ? LIMIT 1 FOR UPDATE",
        "SELECT id FROM approval_history WHERE actor_id = ? LIMIT 1 FOR UPDATE",
        "SELECT id FROM activity_logs WHERE user_id = ? LIMIT 1 FOR UPDATE"
    ];

    callbackDb.getConnection((err, connection) => {
        if (err) return res.status(500).json({ message: "Gagal hapus" });

        let started = false;
        const stop = (status, message) => {
            const respond = () => res.status(status).json({ message });
            if (!started) {
                connection.release();
                return respond();
            }
            connection.rollback((rollbackError) => {
                if (rollbackError) connection.destroy();
                else connection.release();
                respond();
            });
        };
        const fail = (error) => {
            if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
                return stop(409, conflictMessage);
            }
            stop(500, "Gagal hapus");
        };
        const checkReference = (index) => {
            if (index < referenceQueries.length) {
                return connection.query(referenceQueries[index], [userId], (error, rows) => {
                    if (error) return fail(error);
                    if (rows.length > 0) return stop(409, conflictMessage);
                    checkReference(index + 1);
                });
            }
            connection.query("DELETE FROM users WHERE id = ?", [userId], (error, result) => {
                if (error) return fail(error);
                if (result.affectedRows === 0) return stop(404, "User tidak ditemukan");
                connection.commit((commitError) => {
                    if (commitError) return fail(commitError);
                    connection.release();
                    logActivity(req.user.id, 'DELETE_USER', `Menghapus user ID: ${req.params.id}`, req);
                    res.json({ message: "User berhasil dihapus permanen" });
                });
            });
        };

        
        connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", (isolationError) => {
            if (isolationError) return fail(isolationError);
            connection.beginTransaction((beginError) => {
                if (beginError) return fail(beginError);
                started = true;
                connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId], (error, rows) => {
                    if (error) return fail(error);
                    if (rows.length === 0) return stop(404, "User tidak ditemukan");
                    if (rows[0].id == req.user.id) return stop(400, "Tidak bisa menghapus akun sendiri");
                    checkReference(0);
                });
            });
        });
    });
};

exports.getAllUsers = async (req, res) => {
    try {
       
        const [rows] = await db.query('SELECT id, username, full_name, nrp, role, is_active FROM users ORDER BY id DESC');
        res.json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


exports.createUser = async (req, res) => {
    const { username, password, full_name, nrp, role } = req.body;
    
    try {
        
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
