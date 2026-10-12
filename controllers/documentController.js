const db = require('../config/database').callbackPool;
const path = require('path');
const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { isSafeUploadName, resolveUploadFile } = require('../utils/privateUploadPaths');

exports.authorizeDownload = (req, res, next) => {
    if (req.user.role !== 'staff') return next();

    db.query('SELECT user_id FROM letters WHERE id = ?', [req.params.id], (err, letters) => {
        if (err || letters.length === 0) return res.status(404).send('Surat tidak ditemukan');
        if (letters[0].user_id === req.user.id) return next();

        db.query('SELECT 1 FROM dispositions WHERE letter_id = ? AND receiver_id = ? LIMIT 1',
            [req.params.id, req.user.id], (dispositionErr, dispositions) => {
                if (dispositionErr) return res.status(404).send('Surat tidak ditemukan');
                if (dispositions.length === 0) return res.status(403).json({ message: 'Akses ditolak!' });
                next();
            });
    });
};

exports.downloadLetter = (req, res) => {
    const sql = `
        SELECT l.*, t.template_path 
        FROM letters l 
        LEFT JOIN letter_types t ON l.type_id = t.id 
        WHERE l.id = ?
    `;

    db.query(sql, [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).send("Surat tidak ditemukan");
        
        const surat = results[0];

        if (surat.origin_type === 'EXTERNAL') {
             if (!surat.content_data || surat.content_data.length === 0) {
                 return res.status(404).send("File PDF kosong di database.");
             }
             
             const pdfBuffer = Buffer.isBuffer(surat.content_data) 
                ? surat.content_data 
                : Buffer.from(surat.content_data);

             res.setHeader("Content-Type", "application/pdf");
             res.setHeader("Content-Disposition", "inline; filename=Surat_Masuk.pdf");
             return res.send(pdfBuffer);
        }

        if (!surat.template_path) return res.status(500).send("Template belum diatur.");

        const cleanFileName = surat.template_path.trim(); 
        if (!isSafeUploadName(cleanFileName)) return res.status(403).json({ message: 'Akses ditolak!' });
        const filePath = resolveUploadFile(cleanFileName);

        if (!filePath) {
            return res.status(500).send("File Template tidak ditemukan di server.");
        }

        try {
            const content = fs.readFileSync(filePath, 'binary');
            const zip = new PizZip(content);
            const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

            let cleanData = {};
            if (surat.content_data) {
                try {
                    let raw = surat.content_data.toString();
                    if (raw.trim().startsWith('{')) {
                        let parsed = JSON.parse(raw);
                        Object.keys(parsed).forEach(k => {
                            cleanData[k.replace(/[{}]/g, "").trim()] = parsed[k];
                        });
                    }
                } catch(e) { cleanData = {}; }
            }

            cleanData.nomor_surat = surat.letter_number || 'DRAFT';
            cleanData.tanggal_surat = new Date(surat.updated_at || surat.created_at).toLocaleDateString('id-ID', {day:'numeric', month:'long', year:'numeric'});

            doc.render(cleanData);
            const buf = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
            
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            res.setHeader("Content-Disposition", `attachment; filename=${cleanFileName}`);
            res.send(buf);

        } catch (e) {
            res.status(500).send("Gagal memproses dokumen: " + e.message);
        }
    });
};
