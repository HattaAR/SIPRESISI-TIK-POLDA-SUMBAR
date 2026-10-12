const db = require('../config/database').callbackPool;

exports.getDashboard = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if (err || userResult.length === 0) return res.redirect('/logout');

        const currentUser = userResult[0];

        const sqlStats = `
            SELECT\x20
                (SELECT COUNT(*) FROM users WHERE role != 'admin') as total_users,
                (SELECT COUNT(*) FROM letter_types) as total_types,
                (SELECT COUNT(*) FROM letters) as total_letters,
                (SELECT COUNT(*) FROM letters WHERE status = 'COMPLETED') as total_archived
        `;

        db.query(sqlStats, (err2, statsResult) => {
            if (err2) {
                console.error(err2);
                return res.render('admin/dashboard', {
                    title: 'Dashboard Admin',
                    page: 'dashboard',
                    user: currentUser,
                    stats: {},
                    logs: []
                });
            }

            const sqlActivity = `
                SELECT * FROM (
                    SELECT\x20
                        l.id as ref_id,
                        l.created_at as activity_time,
                        u.full_name as actor_name,
                        u.role as actor_role,
                        CASE\x20
                            WHEN l.status = 'DRAFT' THEN 'Membuat Surat Baru'
                            WHEN l.status = 'PENDING' THEN 'Mengirim Surat (Menunggu Persetujuan)'
                            WHEN l.status = 'APPROVED' THEN 'Menyetujui Surat'
                            WHEN l.status = 'REJECTED' THEN 'Menolak Surat'
                            ELSE 'Update Status Surat'
                        END as activity_type,
                        l.subject as description,
                        l.status as status_badge,
                        l.external_sender,
                        l.letter_number
                    FROM letters l
                    LEFT JOIN users u ON l.user_id = u.id

                    UNION ALL

                    SELECT\x20
                        d.id as ref_id,
                        d.created_at as activity_time,
                        sender.full_name as actor_name,
                        sender.role as actor_role,
                        CASE\x20
                            WHEN d.status = 'PENDING' THEN 'Melakukan Disposisi'
                            WHEN d.status = 'COMPLETED' THEN 'Menyelesaikan Tugas Disposisi'
                            ELSE 'Aktivitas Disposisi'
                        END as activity_type,
                        l.subject as description,
                        d.status as status_badge,
                        l.external_sender,
                        l.letter_number
                    FROM dispositions d
                    LEFT JOIN letters l ON d.letter_id = l.id
                    LEFT JOIN users sender ON d.sender_id = sender.id
                ) AS combined_logs
                ORDER BY activity_time DESC
                LIMIT 10
            `;

            db.query(sqlActivity, (err3, activities) => {
                if (err3) console.error(err3);

                res.render('admin/dashboard', {
                    title: 'Dashboard Admin',
                    page: 'dashboard',
                    user: currentUser,
                    stats: statsResult[0],
                    logs: activities || []
                });
            });
        });
    });
};
