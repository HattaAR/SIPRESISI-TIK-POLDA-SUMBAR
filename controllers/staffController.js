const db = require('../config/database').callbackPool;

exports.getStaffDashboard = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if (err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];

        const sqlStats = `
            SELECT
                SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft,
                SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected
            FROM letters WHERE user_id = ?
        `;

        db.query(sqlStats, [req.user.id], (err, resultStats) => {
            if (err) {
                console.error(err);
                return res.render('staff/dashboard', { title: 'Dashboard', user: freshUser, stats: {}, letters: [] });
            }

            const sqlActivity = `
                SELECT l.*, IFNULL(lt.name, 'Surat Umum') as type_name, lt.code_prefix
                FROM letters l
                LEFT JOIN letter_types lt ON l.type_id = lt.id  -- Gunakan type_id
                WHERE l.user_id = ?
                ORDER BY l.created_at DESC
                LIMIT 5
            `;

            db.query(sqlActivity, [req.user.id], (err2, activities) => {
                if (err2) console.error("Error Activity:", err2);

                res.render('staff/dashboard', {
                    title: 'Dashboard Staff',
                    page: 'dashboard',
                    user: freshUser,
                    stats: resultStats[0] || {},
                    letters: activities || []
                });
            });
        });
    });
};

exports.getStaffArchive = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        const { type_id, start_date, end_date, letter_number, search } = req.query;

        db.query("SELECT * FROM letter_types", (err, types) => {
            if (err) {
                console.error("Error ambil types:", err);
                return res.redirect('/staff/dashboard');
            }

            let whereParts = ["l.user_id = ?"];
            let params = [userId];

            if (type_id) { whereParts.push("l.type_id = ?"); params.push(type_id); }
            if (start_date) { whereParts.push("DATE(l.created_at) >= ?"); params.push(start_date); }
            if (end_date) { whereParts.push("DATE(l.created_at) <= ?"); params.push(end_date); }

            if (search) {
                whereParts.push("(l.letter_number LIKE ? OR l.subject LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            } else if (letter_number) {
                whereParts.push("l.letter_number LIKE ?");
                params.push(`%${letter_number}%`);
            }

            const whereClause = "WHERE " + whereParts.join(" AND ");
            const countSql = `SELECT COUNT(*) AS total FROM letters l ${whereClause}`;

            db.query(countSql, params, (err, countResult) => {
                if (err) {
                    console.error("Error count data:", err);
                    return res.render('staff/archive', {
                        title: 'Arsip', letters: [], user: freshUser, types: [],
                        currentPage: 1, totalPages: 1, totalItems: 0
                    });
                }

                const totalItems = countResult[0].total;
                const totalPages = Math.ceil(totalItems / limit);

                const dataSql = `
                    SELECT l.*, t.name as type_name
                    FROM letters l
                    LEFT JOIN letter_types t ON l.type_id = t.id
                    ${whereClause}
                    ORDER BY l.created_at DESC
                    LIMIT ? OFFSET ?
                `;

                const dataParams = [...params, limit, offset];

                db.query(dataSql, dataParams, (err, results) => {
                    if (err) {
                        console.error("Error get data:", err);
                        return res.render('staff/archive', {
                            title: 'Arsip', letters: [], user: freshUser, types: [],
                            currentPage: 1, totalPages: 1, totalItems: 0
                        });
                    }

                    res.render('staff/archive', {
                        title: 'Arsip Surat Saya',
                        page: 'archive',
                        user: freshUser,
                        letters: results || [],
                        types: types || [],
                        query: req.query,
                        search: search,
                        currentPage: page,
                        totalPages: totalPages,
                        totalItems: totalItems
                    });
                });
            });
        });
    });
};
