const db = require('../config/database');
const fs = require('fs');
const path = require('path');

// 1. Ambil Semua Jenis Surat
exports.getAllTypes = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM letter_types ORDER BY id ASC");
        res.json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2. Tambah Jenis Surat & Upload Template
exports.createType = async (req, res) => {
    // Tambahkan number_format di sini
    const { name, code_prefix, number_format } = req.body; 
    const file = req.file;

    if (!name || !code_prefix) {
        return res.status(400).json({ message: 'Nama dan Kode Prefix wajib diisi!' });
    }

    try {
        let templatePath = null;
        if (file) templatePath = file.filename; 

        // Schema Default
        const defaultSchema = [
            { "label": "Kepada Yth", "type": "text", "key": "penerima" },
            { "label": "Di Tempat", "type": "text", "key": "tempat" }
        ];

        // Pakai format dari Admin, atau default jika kosong
        const formatFix = number_format || '{kode}/{nomor}/{bulan}/{tahun}';

        // UPDATE QUERY SQL
        const query = `INSERT INTO letter_types (name, code_prefix, template_path, form_schema, number_format) VALUES (?, ?, ?, ?, ?)`;
        
        await db.query(query, [
            name, 
            code_prefix, 
            templatePath, 
            JSON.stringify(defaultSchema),
            formatFix // Simpan format
        ]);

        res.status(201).json({ message: 'Jenis surat berhasil dibuat!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Gagal menambah data', error: error.message });
    }
};

// 3. Hapus Jenis Surat
exports.deleteType = async (req, res) => {
    const { id } = req.params;
    try {
        // Cek dulu file lamanya untuk dihapus dari folder
        const [rows] = await db.query("SELECT template_path FROM letter_types WHERE id = ?", [id]);
        
        if (rows.length > 0 && rows[0].template_path) {
            const filePath = path.join(__dirname, '../uploads/templates', rows[0].template_path);
            // Hapus file fisik jika ada
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await db.query("DELETE FROM letter_types WHERE id = ?", [id]);
        res.json({ message: 'Berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 4. Update Schema Form (INI YANG TADI MENYEBABKAN CRASH KARENA HILANG)
exports.updateSchema = async (req, res) => {
    const { id } = req.params;
    const { schema } = req.body; // String JSON
    
    try {
        await db.query("UPDATE letter_types SET form_schema = ? WHERE id = ?", [schema, id]);
        res.json({ message: 'Schema updated' });
    } catch (error) {
        console.error("Gagal update schema:", error);
        res.status(500).json({ error: error.message });
    }
};