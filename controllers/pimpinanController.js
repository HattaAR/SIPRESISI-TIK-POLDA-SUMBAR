const db = require('../config/database').callbackPool;
const { logActivity } = require('../services/activityLogService');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const letterDecisionService = require('../services/letterDecisionService');

exports.getDashboard = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');
        const freshUser = userResult[0];

        const sqlStats = `
            SELECT
                SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) as rejected
            FROM letters
        `;

        db.query(sqlStats, (err, statRows) => {
            const stats = statRows[0] || { pending: 0, approved: 0, rejected: 0 };

            const sqlLetters = `
                SELECT l.*, u.full_name as staff_name, u.nrp, t.name as type_name
                FROM letters l
                JOIN users u ON l.user_id = u.id
                LEFT JOIN letter_types t ON l.type_id = t.id
                WHERE l.status = 'PENDING'
                ORDER BY l.created_at ASC
                LIMIT 10
            `;

            db.query(sqlLetters, (err, letterRows) => {
                res.render('pimpinan/dashboard', {
                    title: 'Dashboard Pimpinan',
                    page: 'dashboard',
                    user: freshUser,
                    stats: stats,
                    incoming: letterRows || []
                });
            });
        });
    });
};

exports.getDetail = (req, res) => {
    const id = req.query.id;

    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];

        const sqlSurat = `
            SELECT l.*, t.name as type_name, u.full_name as pengirim_name
            FROM letters l
            LEFT JOIN letter_types t ON l.type_id = t.id
            LEFT JOIN users u ON l.user_id = u.id
            WHERE l.id = ?
        `;

        db.query(sqlSurat, [id], (err2, letterResult) => {
            if(err2 || letterResult.length === 0) return res.redirect('/pimpinan/dashboard');

            const letter = letterResult[0];

            const sqlStaff = "SELECT * FROM users WHERE role IN ('staff', 'anggota', 'admin') AND is_active = 1 ORDER BY full_name ASC";

            db.query(sqlStaff, (err3, staffResult) => {
                const sqlDispo = `
                    SELECT d.*, u.full_name as receiver_name
                    FROM dispositions d
                    JOIN users u ON d.receiver_id = u.id
                    WHERE d.letter_id = ?
                    ORDER BY d.created_at DESC
                `;

                db.query(sqlDispo, [id], (err4, dispoResult) => {
                    res.render('pimpinan/detail', {
                        title: 'Detail Surat',
                        user: freshUser,
                        letter: letter,
                        subordinates: staffResult || [],
                        dispositions: dispoResult || [],
                        success_msg: req.query.success,
                        error_msg: req.query.error
                    });
                });
            });
        });
    });
};

exports.getHistory = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];

        db.query("SELECT * FROM letter_types", (err, types) => {
            if (err) return res.redirect('/pimpinan/dashboard');

            let sql = `
                SELECT l.id, l.letter_number, l.subject, l.created_at, l.origin_type, l.status, l.external_sender, l.pdf_path,
                       t.name as type_name,
                       u.full_name as pengirim, u.nrp,
                       MAX(d.status) as dispo_status,
                       MAX(d.receiver_id) as staff_id,
                       MAX(s.full_name) as staff_name,
                       (LENGTH(l.content_data) > 0 OR l.pdf_path IS NOT NULL) as ada_file
                FROM letters l
                LEFT JOIN letter_types t ON l.type_id = t.id
                LEFT JOIN users u ON l.user_id = u.id
                LEFT JOIN dispositions d ON l.id = d.letter_id
                LEFT JOIN users s ON d.receiver_id = s.id
                WHERE 1=1
            `;

            let params = [];
            const { type_id, letter_number, sender, status } = req.query;

            if (type_id) { sql += " AND l.type_id = ?"; params.push(type_id); }
            if (letter_number) { sql += " AND l.letter_number LIKE ?"; params.push(`%${letter_number}%`); }
            if (sender) {
                sql += " AND (u.full_name LIKE ? OR l.external_sender LIKE ?)";
                params.push(`%${sender}%`, `%${sender}%`);
            }
            if (status) { sql += " AND l.status = ?"; params.push(status); }

            sql += " GROUP BY l.id";

            sql += " ORDER BY l.created_at DESC";

            db.query(sql, params, (err, rows) => {
                if (err) {
                    console.error("Error History:", err);
                    return res.redirect('/pimpinan/dashboard');
                }

                res.render('pimpinan/history', {
                    title: 'Riwayat Surat',
                    page: 'history',
                    user: freshUser,
                    history: rows || [],
                    types: types || [],
                    query: req.query
                });
            });
        });
    });
};

exports.getReports = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];

        res.render('pimpinan/reports', {
            title: 'Laporan Bulanan',
            page: 'reports',
            user: freshUser
        });
    });
};

exports.getProfile = (req, res) => {
    if(req.user.role !== 'pimpinan') return res.redirect('/');
    db.query("SELECT * FROM users WHERE id = ?", [req.user.id], (err, results) => {
        if (err || results.length === 0) return res.redirect('/');

        res.render('pimpinan/profile', {
            title: 'Pengaturan Profil',
            page: 'profile',
            user: results[0],
            success_msg: '',
            error_msg: ''
        });
    });
};

exports.updateProfile = (req, res) => {
    const { full_name, nrp, position } = req.body;
    const userId = req.user.id;

    const sql = "UPDATE users SET full_name = ?, nrp = ?, position = ? WHERE id = ?";

    db.query(sql, [full_name, nrp, position, userId], (err, result) => {
        if (err) {
            console.error("Error Update Pimpinan:", err);
            return renderPimpinanProfile(res, req, '', 'Gagal update database.');
        }

        req.user.full_name = full_name;
        req.user.nrp = nrp;
        req.user.position = position;

       if (req.session) {
            req.session.user = req.user;

            req.session.save((err) => {
                if(err) console.error("Gagal simpan session:", err);
                renderPimpinanProfile(res, req, 'Data pimpinan berhasil diperbarui!', '');
            });
        } else {
             renderPimpinanProfile(res, req, 'Data pimpinan berhasil diperbarui!', '');
        }
    });
};

exports.updatePassword = async (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
    const userId = req.user.id;

    if (!old_password || !new_password) return renderPimpinanProfile(res, req, '', 'Password wajib diisi.');
    if (new_password.length < 6) return renderPimpinanProfile(res, req, '', 'Password min 6 karakter.');
    if (new_password !== confirm_password) return renderPimpinanProfile(res, req, '', 'Konfirmasi password beda.');

    db.query("SELECT * FROM users WHERE id = ?", [userId], async (err, results) => {
        if (err || results.length === 0) return renderPimpinanProfile(res, req, '', 'User tidak ditemukan.');

        const userInDb = results[0];
        const currentPass = userInDb.password || userInDb.password_hash;

        if (!currentPass) return renderPimpinanProfile(res, req, '', 'Data password database error.');

        const isMatch = await bcrypt.compare(old_password, currentPass);
        if (!isMatch) return renderPimpinanProfile(res, req, '', 'Password Lama Salah!');

        const newHash = await bcrypt.hash(new_password, 10);

        let updateSql = "UPDATE users SET password = ? WHERE id = ?";
        if(userInDb.password_hash) updateSql = "UPDATE users SET password_hash = ? WHERE id = ?";

        db.query(updateSql, [newHash, userId], (errUp) => {
            if(errUp) return renderPimpinanProfile(res, req, '', 'Gagal simpan password.');
            renderPimpinanProfile(res, req, 'Password Pimpinan Berhasil Diganti!', '');
        });
    });
};

function renderPimpinanProfile(res, req, success, error) {
    db.query("SELECT * FROM users WHERE id = ?", [req.user.id], (err, results) => {
        const userData = results && results.length > 0 ? results[0] : req.user;
        res.render('pimpinan/profile', {
            title: 'Profil Pimpinan',
            page: 'profile',
            user: userData,
            success_msg: success,
            error_msg: error
        });
    });
}

exports.createDisposition = (req, res) => {
    const { letter_id, receiver_id, notes } = req.body;
    const sender_id = req.user.id;

    if (!letter_id || !receiver_id) {
        return res.redirect(`/pimpinan/detail?id=${letter_id}&error=Data disposisi tidak lengkap`);
    }

    const sqlInsert = "INSERT INTO dispositions (letter_id, sender_id, receiver_id, instruction, status, created_at) VALUES (?, ?, ?, ?, 'PENDING', NOW())";

    db.query(sqlInsert, [letter_id, sender_id, receiver_id, notes], (err, result) => {
        if (err) {
            console.error(err);
            return res.redirect(`/pimpinan/detail?id=${letter_id}&error=Gagal mengirim disposisi`);
        }

        db.query("UPDATE letters SET status = 'DISPOSITION' WHERE id = ?", [letter_id], (errUpdate) => {
            if (errUpdate) {
                console.error(errUpdate);
                return res.redirect(`/pimpinan/detail?id=${letter_id}&error=Gagal update status surat`);
            }

            const sqlInfo = `
                SELECT 
                    (SELECT full_name FROM users WHERE id = ?) as staff_name,
                    (SELECT subject FROM letters WHERE id = ?) as letter_subject
            `;

            db.query(sqlInfo, [receiver_id, letter_id], (err2, results) => {
                let logMessage = `Memberi disposisi ke Staff ID: ${receiver_id}`;

                if (!err2 && results.length > 0) {
                    const staff = results[0].staff_name || 'Staff';
                    const subject = results[0].letter_subject || 'Surat';
                    logMessage = `Mendisposisikan surat "${subject}" kepada ${staff}`;
                }

                logActivity(sender_id, 'DISPOSITION', logMessage, req);

                res.redirect(`/pimpinan/detail?id=${letter_id}&success=Disposisi berhasil dikirim`);
            });
        });
    });
};

exports.approveLetter = (req, res) => {
    letterDecisionService.approveLetter(req, (error, result) => {
        if (error) return res.status(error.status).json({ message: error.message });
        res.json(result);
    });
};

exports.rejectLetter = (req, res) => {
    letterDecisionService.rejectLetter(req, (error, result) => {
        if (error) return res.status(error.status).json({ message: error.message });
        res.json(result);
    });
};

exports.getReportPdf = (req, res) => {
    const { month, year } = req.query;
    if (!month || !year) return res.status(400).send("Bulan dan Tahun wajib dipilih.");

    const sql = `
        SELECT l.*, u.full_name as pengirim, t.name as type_name 
        FROM letters l 
        JOIN users u ON l.user_id = u.id 
        JOIN letter_types t ON l.type_id = t.id 
        WHERE l.status = 'APPROVED' 
        AND MONTH(l.updated_at) = ? 
        AND YEAR(l.updated_at) = ?
        ORDER BY l.updated_at ASC
    `;

    db.query(sql, [month, year], (err, results) => {
        if (err) return res.status(500).send("Database Error");

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const filename = `Laporan_Surat_${month}-${year}.pdf`;

        res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
        res.setHeader('Content-type', 'application/pdf');

        doc.pipe(res);

        doc.fontSize(14).font('Helvetica-Bold').text('KEPOLISIAN NEGARA REPUBLIK INDONESIA', { align: 'center' });
        doc.fontSize(12).text('DAERAH SUMATERA BARAT', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(16).text('LAPORAN REKAPITULASI SURAT KELUAR', { align: 'center', underline: true });
        doc.fontSize(10).font('Helvetica').text(`Periode: Bulan ${month} Tahun ${year}`, { align: 'center' });
        doc.moveDown(2);

        const tableTop = 180;
        const col1 = 50; const col2 = 90; const col3 = 180; const col4 = 330; const col5 = 480;

        doc.moveTo(50, tableTop).lineTo(550, tableTop).stroke();
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('No', col1, tableTop + 5);
        doc.text('Tanggal', col2, tableTop + 5);
        doc.text('Nomor Surat', col3, tableTop + 5);
        doc.text('Perihal / Jenis', col4, tableTop + 5);
        doc.text('Staff Pengirim', col5, tableTop + 5);
        doc.moveTo(50, tableTop + 20).lineTo(550, tableTop + 20).stroke();

        let y = tableTop + 30;
        doc.font('Helvetica').fontSize(9);

        results.forEach((item, index) => {
            if (y > 700) { doc.addPage(); y = 50; }
            const tgl = new Date(item.updated_at).toLocaleDateString('id-ID');
            
            doc.text(index + 1, col1, y);
            doc.text(tgl, col2, y);
            doc.text(item.letter_number || '-', col3, y);
            doc.text(item.subject, col4, y, { width: 140 });
            doc.text(item.pengirim, col5, y);
            
            y += 30; 
            doc.moveTo(50, y - 10).lineTo(550, y - 10).dash(1, {space: 2}).stroke().undash();
        });

        const footerY = y + 50;
        if (footerY > 700) doc.addPage();

        doc.fontSize(10).font('Helvetica');
        doc.text(`Padang, ${new Date().toLocaleDateString('id-ID', {day:'numeric', month:'long', year:'numeric'})}`, 400, doc.y + 50);
        doc.text('Mengetahui,', 400);
        const jabatan = req.user.jabatan || 'KEPALA BIDANG TIK';
        doc.font('Helvetica-Bold').text(jabatan, 400);
        doc.moveDown(4);
        doc.text(`( ${req.user.name.toUpperCase()} )`, 400);
        
        doc.end();
    });
};
