const db = require('../config/database').callbackPool;
const { logActivity } = require('../services/activityLogService');

exports.getStaffDispositions = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if (err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];
        const userId = req.user.id;

        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let searchSql = "";
        let searchParams = [];

        if (search) {
            searchSql = "AND (l.subject LIKE ? OR l.letter_number LIKE ? OR u.full_name LIKE ?)";
            searchParams = [`%${search}%`, `%${search}%`, `%${search}%`];
        }

        const countSql = `
            SELECT COUNT(*) AS total
            FROM dispositions d
            JOIN letters l ON d.letter_id = l.id
            JOIN users u ON d.sender_id = u.id
            WHERE d.receiver_id = ? ${searchSql}
        `;

        db.query(countSql, [userId, ...searchParams], (err, countResult) => {
            if (err) {
                console.error("Count Error:", err);
                return res.redirect('/dashboard');
            }

            const totalItems = countResult[0].total;
            const totalPages = Math.ceil(totalItems / limit);
            const sql = `
                SELECT d.*,
                       l.subject,
                       l.letter_number,
                       l.external_sender,
                       l.pdf_path,
                       u.full_name as pimpinan_name,
                       (LENGTH(l.content_data) > 0 OR l.pdf_path IS NOT NULL) as ada_file
                FROM dispositions d
                JOIN letters l ON d.letter_id = l.id
                JOIN users u ON d.sender_id = u.id
                WHERE d.receiver_id = ? ${searchSql}
                ORDER BY d.created_at DESC
                LIMIT ? OFFSET ?
            `;

            db.query(sql, [userId, ...searchParams, limit, offset], (err, results) => {
                if (err) console.error("Data Error:", err);

                res.render('staff/disposition_inbox', {
                    title: 'Tugas Masuk',
                    user: freshUser,
                    page: 'dispositions',
                    tasks: results || [],
                    currentPage: page,
                    totalPages: totalPages,
                    totalItems: totalItems,
                    search: search
                });
            });
        });
    });
};

exports.completeStaffDisposition = (req, res) => {
    const dispositionId = req.params.id;
    const userId = req.user.id;

    const sqlCheck = "SELECT * FROM dispositions WHERE id = ? AND receiver_id = ?";

    db.query(sqlCheck, [dispositionId, userId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ message: "Tugas tidak ditemukan atau akses ditolak." });
        }

        const letterId = results[0].letter_id;

        db.query("UPDATE dispositions SET status = 'COMPLETED' WHERE id = ?", [dispositionId], (err2) => {
            if (err2) return res.status(500).json({ message: "Database error saat update disposisi" });

            db.query("UPDATE letters SET status = 'COMPLETED' WHERE id = ?", [letterId], (err3) => {
                if (err3) {
                    console.error("Error Letter Status:", err3);
                    return res.status(500).json({ message: "Gagal update status surat utama" });
                }

                if (typeof logActivity === 'function') {
                    logActivity(userId, 'COMPLETE_TASK', `Menyelesaikan tugas disposisi (Letter ID: ${letterId})`, req);
                }

                res.json({ message: "Tugas berhasil diselesaikan! Status surat diperbarui." });
            });
        });
    });
};
