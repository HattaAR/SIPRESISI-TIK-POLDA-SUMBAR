const db = require('../config/database').callbackPool;
const { logActivity } = require('../services/activityLogService');

exports.getStaffCreatePage = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];

        db.query("SELECT * FROM letter_types", (err, types) => {
            if (err) return res.redirect('/staff/dashboard');

            const editId = req.query.edit;

            if (editId) {
                const sql = "SELECT * FROM letters WHERE id = ? AND user_id = ?";

                db.query(sql, [editId, req.user.id], (err, results) => {
                    if (err || results.length === 0) return res.redirect('/staff/dashboard');

                    const letter = results[0];
                    let content = {};
                    try { content = JSON.parse(letter.content_data); } catch(e) {}

                    res.render('staff/create', {
                        title: 'Perbaiki Surat',
                        page: 'create',
                        user: freshUser,
                        types: types,
                        isEdit: true,
                        letter: letter,
                        content: content
                    });
                });

            } else {
                res.render('staff/create', {
                    title: 'Buat Surat Baru',
                    page: 'create',
                    user: freshUser,
                    types: types,
                    isEdit: false,
                    letter: null,
                    content: null
                });
            }
        });
    });
};

exports.createDraft = (req, res) => {
    const { type_id, subject, ...formData } = req.body;
    const userId = req.user.id;

    const insertSql = `
        INSERT INTO letters (user_id, type_id, letter_number, subject, content_data, status)
        VALUES (?, ?, 'DRAFT', ?, ?, 'DRAFT')
    `;

    db.query(insertSql, [userId, type_id, subject, JSON.stringify(formData)], (err, result) => {
        if (err) return res.status(500).json({ message: "Gagal menyimpan surat" });

        logActivity(userId, 'CREATE_DRAFT', `Membuat draft surat: ${subject}`, req);

        res.json({ message: "Draft berhasil disimpan", number: "DRAFT" });
    });
};

exports.updateDraft = (req, res) => {
    const { id, type_id, subject, ...contentData } = req.body;

    const checkSql = "SELECT id FROM letters WHERE id = ? AND user_id = ?";
    db.query(checkSql, [id, req.user.id], (err, results) => {
        if (err || results.length === 0) return res.status(403).json({ message: "Akses ditolak" });

        const updateSql = `
            UPDATE letters
            SET type_id = ?, subject = ?, content_data = ?, status = 'DRAFT', updated_at = NOW()
            WHERE id = ?
        `;

        db.query(updateSql, [type_id, subject, JSON.stringify(contentData), id], (err) => {
            if (err) return res.status(500).json({ message: "Gagal menyimpan revisi" });
            res.json({ message: "Revisi berhasil disimpan!" });
        });
    });
};

exports.sendLetter = (req, res) => {
    const id = req.params.id;
    const userId = req.user.id;

    const sql = "UPDATE letters SET status = 'PENDING', updated_at = NOW() WHERE id = ? AND user_id = ?";

    db.query(sql, [id, userId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Terjadi kesalahan server." });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Gagal mengirim. Data tidak ditemukan." });
        }
        logActivity(userId, 'SUBMIT_LETTER', `Mengajukan surat ID: ${id} ke Pimpinan`, req);

        res.json({ message: "Surat berhasil dikirim ke Pimpinan!" });
    });
};

exports.deleteLetter = (req, res) => {
    const id = req.params.id;
    const userId = req.user.id;

    const sql = "DELETE FROM letters WHERE id = ? AND user_id = ? AND status IN ('DRAFT', 'REJECTED')";

    db.query(sql, [id, userId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Gagal menghapus data." });
        }
        if (result.affectedRows === 0) {
            return res.status(400).json({ message: "Hanya surat DRAFT atau DITOLAK yang bisa dihapus." });
        }
        logActivity(userId, 'DELETE_LETTER', `Menghapus surat ID: ${id}`, req);

        res.json({ message: "Surat berhasil dihapus permanen." });
    });
};
