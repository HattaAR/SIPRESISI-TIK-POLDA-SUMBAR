const db = require('../config/database').callbackPool;

exports.getLetterDetail = (req, res) => {
    const sql = `
        SELECT l.*, u.full_name as user_name, u.nrp, t.name as type_name
        FROM letters l
        JOIN users u ON l.user_id = u.id
        LEFT JOIN letter_types t ON l.type_id = t.id
        WHERE l.id = ?
    `;

    db.query(sql, [req.params.id], (err, results) => {
        if(err || results.length === 0) return res.status(404).json({message: "Surat tidak ditemukan"});

        let letterData = results[0];
        const sendLetterDetail = () => {
            try {
                if (typeof letterData.content_data === 'string') {
                    letterData.content_data = JSON.parse(letterData.content_data);
                }
            } catch (e) {}

            res.json({ data: letterData });
        };

        if (req.user.role !== 'staff' || letterData.user_id === req.user.id) {
            return sendLetterDetail();
        }

        db.query('SELECT 1 FROM dispositions WHERE letter_id = ? AND receiver_id = ? LIMIT 1',
            [req.params.id, req.user.id], (dispositionErr, dispositions) => {
                if (dispositionErr) return res.status(404).json({message: "Surat tidak ditemukan"});
                if (dispositions.length === 0) return res.status(403).json({ message: 'Akses ditolak!' });

                sendLetterDetail();
            });
    });
};
