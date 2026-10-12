const db = require('../config/database').callbackPool;

exports.getLogs = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];
        const page = parseInt(req.query.page) || 1;
        const limit = 100;
        const offset = (page - 1) * limit;

        db.query("SELECT COUNT(*) AS total FROM activity_logs", (err, countResult) => {
            if (err) {
                console.error(err);
                return res.status(500).send("Database Error");
            }

            const totalRecords = countResult[0].total;
            const totalPages = Math.ceil(totalRecords / limit);

            const sql = `
                SELECT l.*, u.full_name, u.role, u.nrp
                FROM activity_logs l
                JOIN users u ON l.user_id = u.id
                ORDER BY l.created_at DESC
                LIMIT ? OFFSET ?
            `;

            db.query(sql, [limit, offset], (err, results) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send("Database Error");
                }
                res.render('admin/logs', {
                    title: 'Log Aktivitas',
                    page: 'logs',
                    user: freshUser,
                    logs: results || [],
                    currentPage: page,
                    totalPages: totalPages,
                    totalRecords: totalRecords
                });
            });
        });
    });
};
