const db = require('../config/database');
const { generateSuratPDF } = require('../utils/pdfGenerator');
const { logActivity } = require('../utils/logger'); 
const path = require('path'); // [PENTING] Wajib ada untuk fitur download

// 1. Staff Membuat Draft Surat
exports.createDraft = async (req, res) => {
    const { letter_type_id, subject, content, urgency } = req.body;
    const userId = req.user.id; 
    const file = req.file; 

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // A. SIMPAN DATA SURAT
        const querySurat = `
            INSERT INTO letters 
            (letter_type_id, created_by_id, subject, content, urgency, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'draft', NOW(), NOW())
        `;
        
        const [result] = await connection.query(querySurat, [
            letter_type_id, userId, subject, content, urgency || 'biasa'
        ]);
        
        const letterId = result.insertId;

        // B. SIMPAN LAMPIRAN (JIKA ADA)
        if (file) {
            const queryAttach = `
                INSERT INTO attachments (letter_id, file_name, file_path, uploaded_at)
                VALUES (?, ?, ?, NOW())
            `;
            await connection.query(queryAttach, [letterId, file.originalname, file.filename]);
        }

        await connection.commit();

        const logDesc = file ? `Membuat draft surat: ${subject} (+Lampiran)` : `Membuat draft surat: ${subject}`;
        await logActivity(req, userId, 'CREATE_DRAFT', logDesc);

        res.status(201).json({
            message: 'Draft surat berhasil disimpan!',
            letter_id: letterId,
            has_attachment: !!file
        });

    } catch (error) {
        if(connection) await connection.rollback();
        console.error("Gagal buat draft:", error);
        res.status(500).json({ message: 'Gagal membuat surat', error: error.message });
    } finally {
        if(connection) connection.release();
    }
};

// 2. Staff Melihat Surat Sendiri
exports.getMyLetters = async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT 
                l.id, l.subject, l.status, l.created_at, 
                l.letter_number, l.pdf_path, 
                l.rejection_reason,
                t.name as type_name
            FROM letters l
            JOIN letter_types t ON l.letter_type_id = t.id
            WHERE l.created_by_id = ?
            ORDER BY l.created_at DESC
        `;
        const [rows] = await db.query(query, [userId]);
        res.json({ message: 'List surat berhasil diambil', data: rows });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// 3. Staff Mengirim Surat (Draft -> Pending)
exports.submitLetter = async (req, res) => {
    const { id } = req.params; 
    const userId = req.user.id;

    try {
        const query = `UPDATE letters SET status = 'pending', updated_at = NOW() 
                       WHERE id = ? AND created_by_id = ? AND status IN ('draft', 'rejected')`;
        
        const [result] = await db.query(query, [id, userId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Surat tidak ditemukan atau status bukan draft.' });
        }

        await logActivity(req, userId, 'SUBMIT_LETTER', `Mengajukan surat ID: ${id} ke Pimpinan`);
        res.json({ message: 'Surat berhasil diajukan ke Pimpinan!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 4. Pimpinan Melihat Surat Masuk (Pending)
exports.getPendingLetters = async (req, res) => {
    if (req.user.role !== 'pimpinan') {
        return res.status(403).json({ message: 'Akses Ditolak. Khusus Pimpinan.' });
    }

    try {
        const query = `
            SELECT l.id, l.subject, l.created_at, u.full_name as pengirim, t.name as jenis_surat
            FROM letters l
            JOIN users u ON l.created_by_id = u.id
            JOIN letter_types t ON l.letter_type_id = t.id
            WHERE l.status = 'pending'
            ORDER BY l.urgency DESC, l.created_at ASC
        `;
        const [rows] = await db.query(query);
        res.json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 5. Pimpinan Menyetujui Surat
exports.approveLetter = async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body; 
    const approverId = req.user.id;

    if (req.user.role !== 'pimpinan') return res.status(403).json({ message: 'Khusus Pimpinan.' });

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction(); 

        const queryLetter = `
            SELECT l.*, t.template_path, t.code_prefix, t.number_format 
            FROM letters l
            JOIN letter_types t ON l.letter_type_id = t.id
            WHERE l.id = ?
        `;
        const [letters] = await connection.query(queryLetter, [id]);
        
        if (letters.length === 0) throw new Error("Surat tidak ditemukan");
        const letter = letters[0];

        // --- Logika Penomoran ---
        const currentYear = new Date().getFullYear();
        const [seqs] = await connection.query(
            'SELECT * FROM numbering_sequences WHERE letter_type_id = ? AND year = ? FOR UPDATE', 
            [letter.letter_type_id, currentYear]
        );

        let nextNo = 1;
        if (seqs.length > 0) {
            nextNo = seqs[0].last_number + 1;
            await connection.query('UPDATE numbering_sequences SET last_number = ? WHERE id = ?', [nextNo, seqs[0].id]);
        } else {
            await connection.query('INSERT INTO numbering_sequences (letter_type_id, year, last_number) VALUES (?, ?, 1)', [letter.letter_type_id, currentYear]);
        }

        const urutan = String(nextNo).padStart(3, '0');
        const kode = letter.code_prefix || 'TIK';
        const tahun = currentYear;
        const romawiBulan = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
        const bulan = romawiBulan[new Date().getMonth() + 1];

        let format = letter.number_format || '{nomor}/TIK/{tahun}';
        let nomerSurat = format
            .replace('{nomor}', urutan)
            .replace('{kode}', kode)
            .replace('{bulan}', bulan)
            .replace('{tahun}', tahun);
            
        // Generate File PDF/Docx
        let kontenData = {};
        try { kontenData = JSON.parse(letter.content); } catch (e) { kontenData = { text: letter.content }; }
        
        const dataUntukDocx = {
            id: id,
            nomor: nomerSurat,
            isi: kontenData,
            templatePath: letter.template_path 
        };
        
        const namaFileFinal = await generateSuratPDF(dataUntukDocx);

        // Update Database
        await connection.query(
            `UPDATE letters SET status = 'approved', letter_number = ?, letter_date = NOW(), pdf_path = ?, updated_at = NOW() WHERE id = ?`,
            [nomerSurat, namaFileFinal, id]
        );

        await connection.query(
            `INSERT INTO approval_history (letter_id, actor_id, action, notes) VALUES (?, ?, 'approve', ?)`,
            [id, approverId, notes || 'Disetujui']
        );

        await connection.commit();
        await logActivity(req, approverId, 'APPROVE_LETTER', `Menyetujui surat No: ${nomerSurat}`);

        res.json({ message: 'Surat Disetujui!', nomor: nomerSurat, file: namaFileFinal });

    } catch (error) {
        if (connection) { try { await connection.rollback(); } catch (e) {} }
        console.error("Gagal Approve:", error);
        res.status(500).json({ message: 'Gagal approve', error: error.message });
    } finally {
        if (connection) { try { connection.release(); } catch (e) {} }
    }
};

// 6. Pimpinan Menolak Surat (Reject)
exports.rejectLetter = async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body; 
    const approverId = req.user.id;

    if (req.user.role !== 'pimpinan') return res.status(403).json({ message: 'Khusus Pimpinan.' });
    if (!reason) return res.status(400).json({ message: 'Alasan penolakan wajib diisi!' });

    try {
        await db.query(`UPDATE letters SET status = 'rejected', rejection_reason = ?, updated_at = NOW() WHERE id = ?`, [reason, id]);
        await db.query(`INSERT INTO approval_history (letter_id, actor_id, action, notes) VALUES (?, ?, 'reject', ?)`, [id, approverId, reason]);
        await logActivity(req, approverId, 'REJECT_LETTER', `Menolak surat ID: ${id}. Alasan: ${reason}`);

        res.json({ message: 'Surat telah ditolak.' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menolak surat', error: error.message });
    }
};

// 7. Admin Melihat Semua Arsip (Approved Only)
exports.getArchivedLetters = async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses Ditolak. Khusus Admin.' });

    try {
        const query = `
            SELECT 
                l.id, l.letter_number, l.subject, l.letter_date, l.pdf_path,
                u.full_name as pengirim, t.name as jenis_surat
            FROM letters l
            JOIN users u ON l.created_by_id = u.id
            JOIN letter_types t ON l.letter_type_id = t.id
            WHERE l.status = 'approved'
            ORDER BY l.letter_date DESC
        `;
        const [rows] = await db.query(query);
        res.json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 8. Pimpinan Melihat Riwayat Persetujuannya Sendiri
exports.getApprovalHistory = async (req, res) => {
    const userId = req.user.id;
    if (req.user.role !== 'pimpinan') return res.status(403).json({ message: 'Akses Ditolak.' });

    try {
        const query = `
            SELECT 
                h.id, h.action, h.notes, h.created_at as tanggal_proses,
                l.subject, IFNULL(l.letter_number, '-') as letter_number,
                u.full_name as pengirim, t.name as jenis_surat
            FROM approval_history h
            JOIN letters l ON h.letter_id = l.id
            JOIN users u ON l.created_by_id = u.id
            JOIN letter_types t ON l.letter_type_id = t.id
            WHERE h.actor_id = ?
            ORDER BY h.created_at DESC
        `;
        const [rows] = await db.query(query, [userId]);
        res.json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 9. Staff Menghapus Surat (Draft/Rejected)
exports.deleteLetter = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const checkQuery = `SELECT * FROM letters WHERE id = ? AND created_by_id = ?`;
        const [rows] = await db.query(checkQuery, [id, userId]);

        if (rows.length === 0) return res.status(404).json({ message: 'Surat tidak ditemukan atau bukan milik Anda.' });

        const surat = rows[0];
        if (surat.status === 'approved' || surat.status === 'pending') {
            return res.status(400).json({ message: 'Tidak dapat menghapus surat yang sedang diproses.' });
        }

        await db.query('DELETE FROM letters WHERE id = ?', [id]);
        await logActivity(req, userId, 'DELETE_LETTER', `Menghapus surat ID: ${id}`);

        res.json({ message: 'Surat berhasil dihapus.' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus', error: error.message });
    }
};

// 10. Ambil Detail Surat (Untuk Edit)
exports.getLetterDetail = async (req, res) => {
    const { id } = req.params;

    try {
        const query = `
            SELECT 
                l.*, 
                t.name as type_name, 
                u.full_name as user_name,
                a.file_name,
                a.file_path
            FROM letters l
            JOIN letter_types t ON l.letter_type_id = t.id
            JOIN users u ON l.created_by_id = u.id
            LEFT JOIN attachments a ON l.id = a.letter_id 
            WHERE l.id = ?
        `;

        const [rows] = await db.query(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Surat tidak ditemukan' });
        }

        res.json({ data: rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error server' });
    }
};

// 11. Update Isi Surat (Simpan Revisi & Handle Upload File Baru)
exports.updateLetter = async (req, res) => {
    const { id } = req.params;
    const { subject, content } = req.body;
    const userId = req.user.id;
    const file = req.file; // Ambil file baru jika ada

    try {
        // 1. Cek Surat
        const [cek] = await db.query("SELECT status FROM letters WHERE id = ? AND created_by_id = ?", [id, userId]);
        
        if (cek.length === 0) return res.status(404).json({ message: 'Surat tidak ditemukan.' });
        if (cek[0].status !== 'draft' && cek[0].status !== 'rejected') {
            return res.status(400).json({ message: 'Hanya surat Draft atau Ditolak yang bisa diedit.' });
        }

        // 2. Update Teks Surat
        const queryUpdate = `UPDATE letters SET subject = ?, content = ?, updated_at = NOW() WHERE id = ?`;
        await db.query(queryUpdate, [subject, content, id]);

        // 3. Handle Update File (Jika User Upload Baru)
        if (file) {
            // Cek apakah sudah ada attachment sebelumnya
            const [exist] = await db.query("SELECT id FROM attachments WHERE letter_id = ?", [id]);
            
            if (exist.length > 0) {
                // Update file yang ada
                await db.query(
                    `UPDATE attachments SET file_name = ?, file_path = ?, uploaded_at = NOW() WHERE letter_id = ?`,
                    [file.originalname, file.filename, id]
                );
            } else {
                // Insert baru
                await db.query(
                    `INSERT INTO attachments (letter_id, file_name, file_path, uploaded_at) VALUES (?, ?, ?, NOW())`,
                    [id, file.originalname, file.filename]
                );
            }
        }

        await logActivity(req, userId, 'EDIT_LETTER', `Melakukan revisi pada surat ID: ${id}`);
        res.json({ message: 'Perubahan berhasil disimpan!' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

// 12. [FUNGSI BARU] Download File (Untuk Tombol Unduh)
exports.downloadLetter = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Cari path file PDF hasil generate di database
        const [rows] = await db.query('SELECT pdf_path FROM letters WHERE id = ?', [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Surat tidak ditemukan.' });
        }

        const pdfFilename = rows[0].pdf_path;
        if (!pdfFilename) {
            return res.status(404).json({ message: 'File belum tersedia (Surat belum disetujui).' });
        }

        // Lokasi penyimpanan hasil generate PDF/DOCX (Sesuaikan dengan folder Anda)
        // Biasanya di public/surat/
        const filePath = path.join(__dirname, '../public/surat', pdfFilename);

        res.download(filePath, (err) => {
            if (err) {
                console.error("Gagal download:", err);
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Gagal mengunduh file. File fisik mungkin hilang.' });
                }
            }
        });

    } catch (error) {
        console.error("Error download:", error);
        res.status(500).json({ message: 'Terjadi kesalahan server.' });
    }
};