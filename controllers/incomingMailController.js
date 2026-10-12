const db = require('../config/database').callbackPool;
const path = require('path');
const fs = require('fs');
const { logActivity } = require('../services/activityLogService');

exports.getIncomingMailPage = (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if (err || userResult.length === 0) return res.redirect('/logout');

        db.query("SELECT id, full_name FROM users WHERE role = 'Pimpinan'", (err2, leaders) => {
            res.render('admin/entry_surat', {
                title: 'Registrasi Surat Masuk',
                user: userResult[0],
                leaders: leaders,
                page: 'incoming'
            });
        });
    });
};

exports.registerIncomingMail = (req, res) => {
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ 
            message: "Gagal: File PDF tidak terdeteksi atau kosong. Pastikan form memiliki enctype='multipart/form-data'." 
        });
    }

    const { letter_number, external_sender, subject, letter_date, recipient } = req.body;
    
    const fileName = `surat_masuk_${Date.now()}${req.file.validatedExtension}`;

   
    const uploadPath = path.join(__dirname, '..', 'public', 'uploads', fileName);

    try {
        
        fs.writeFileSync(uploadPath, req.file.buffer);
    } catch (error) {
        console.error("Gagal menyimpan file fisik:", error);
        return res.status(500).json({ message: "Gagal menyimpan file PDF ke folder server." });
    }

    
    const sql = `
        INSERT INTO letters 
        (user_id, type_id, letter_number, external_sender, recipient, subject, letter_date, origin_type, status, pdf_path)
        VALUES (?, NULL, ?, ?, ?, ?, ?, 'EXTERNAL', 'APPROVED', ?)
    `;

    
    db.query(sql, [req.user.id, letter_number, external_sender, recipient, subject, letter_date, fileName], (err) => {
        if (err) {
            console.error("Database Error Detail:", err);
            
            
            if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);

            return res.status(500).json({ message: "Gagal menyimpan ke database: " + err.message });
        }

        if (typeof logActivity === 'function') {
            logActivity(req.user.id, 'REGISTER_MAIL', `Mendaftarkan Surat Masuk dari ${external_sender}`, req);
        }
        
        res.status(200).json({ message: "Surat masuk berhasil diregistrasi!" });
    });
};
