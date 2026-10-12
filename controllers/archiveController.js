const db = require('../config/database').callbackPool;

exports.getAdminArchive = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];

        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let whereClause = '';
        let queryParams = [limit, offset];

        if (search) {
            whereClause = `WHERE (l.letter_number LIKE ? OR l.subject LIKE ? OR u.full_name LIKE ? OR t.name LIKE ?)`;
            const searchPattern = `%${search}%`;
            queryParams = [searchPattern, searchPattern, searchPattern, searchPattern, limit, offset];
        }

        const countSql = `
            SELECT COUNT(*) AS total
            FROM letters l
            JOIN users u ON l.user_id = u.id
            LEFT JOIN letter_types t ON l.type_id = t.id
            ${whereClause}
        `;

        const countParams = search ? [queryParams[0], queryParams[1], queryParams[2], queryParams[3]] : [];

        db.query(countSql, countParams, (err, dataCount) => {
            if(err) {
                console.error(err);
                return res.send("Error Database Count");
            }

            const totalItems = dataCount[0].total;
            const totalPages = Math.ceil(totalItems / limit);

            const sql = `
                SELECT l.id, l.letter_number, l.subject, l.created_at, l.origin_type,
                       l.content_data,l.pdf_path,
                       t.name as type_name, u.full_name as pengirim
                FROM letters l
                LEFT JOIN letter_types t ON l.type_id = t.id
                JOIN users u ON l.user_id = u.id
                ${whereClause}
                ORDER BY l.created_at DESC
                LIMIT ? OFFSET ?
            `;

            db.query(sql, queryParams, (err2, results) => {
                if(err2) {
                    console.error(err2);
                    return res.send("Error Database Data");
                }

                res.render('admin/archive', {
                    title: 'Arsip Surat',
                    user: freshUser,
                    page: 'archive',
                    letters: results,
                    currentPage: page,
                    totalPages: totalPages,
                    totalItems: totalItems,
                    search: search
                });
            });
        });
    });
};
