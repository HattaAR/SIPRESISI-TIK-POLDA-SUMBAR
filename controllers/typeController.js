const db = require('../config/database');
const fs = require('fs');
const path = require('path');
const callbackDb = db.callbackPool;

exports.getTypesPage = (req, res) => {
    callbackDb.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');

        const freshUser = userResult[0];

        callbackDb.query("SELECT * FROM letter_types ORDER BY id ASC", (err, results) => {
            res.render('admin/types', {
                title: 'Jenis Surat',
                page: 'types',
                user: freshUser,
                types: results || []
            });
        });
    });
};

exports.createTypeWithTemplate = (req, res) => {
    const { name, code_prefix, form_schema, letter_number_format } = req.body;

    if (!req.file) {
        return res.status(400).json({ message: "Wajib upload file template .docx!" });
    }

    const fileName = Date.now() + '-' + req.file.originalname.replace(/\s+/g, '_');
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');

    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    try {
        fs.writeFileSync(path.join(uploadDir, fileName), req.file.buffer);

        const sql = "INSERT INTO letter_types (name, code_prefix, letter_number_format, form_schema, template_path) VALUES (?, ?, ?, ?, ?)";
        callbackDb.query(sql, [name, code_prefix, letter_number_format, form_schema, fileName], (err) => {
            if (err) return res.status(500).json({ message: "Gagal menyimpan ke database" });
            res.json({ message: "Sukses!" });
        });
    } catch (error) {
        res.status(500).json({ message: "Gagal menyimpan file ke server" });
    }
};

exports.updateTypeWithTemplate = (req, res) => {
    const { name, code_prefix, letter_number_format } = req.body;
    const typeId = req.params.id;

    let sql = "UPDATE letter_types SET name = ?, code_prefix = ?, letter_number_format = ? WHERE id = ?";
    let params = [name, code_prefix, letter_number_format, typeId];

    if (req.file) {
        const fileName = Date.now() + '-' + req.file.originalname.replace(/\s+/g, '_');
        const uploadDir = path.join(process.cwd(), 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        try {
            fs.writeFileSync(path.join(uploadDir, fileName), req.file.buffer);
            sql = "UPDATE letter_types SET name = ?, code_prefix = ?, letter_number_format = ?, template_path = ? WHERE id = ?";
            params = [name, code_prefix, letter_number_format, fileName, typeId];
        } catch (err) {
            return res.status(500).json({ message: "Gagal menyimpan file baru" });
        }
    }

    callbackDb.query(sql, params, (err) => {
        if (err) return res.status(500).json({ message: "Gagal update database" });
        res.json({ message: "Jenis surat berhasil diperbarui!" });
    });
};

exports.updateSchemaActive = (req, res) => {
    const schema = req.body && req.body.schema;
    let fields;
    try {
        if (typeof schema !== 'string') throw new Error('Invalid schema');
        fields = JSON.parse(schema);
    } catch (error) {
        return res.status(400).json({ message: "Schema tidak valid" });
    }

    if (!Array.isArray(fields) || !fields.every(field =>
        field !== null && typeof field === 'object' && !Array.isArray(field) &&
        Object.keys(field).length === 3 &&
        typeof field.label === 'string' && typeof field.key === 'string' &&
        ['text', 'textarea', 'date'].includes(field.type)
    )) {
        return res.status(400).json({ message: "Schema tidak valid" });
    }

    callbackDb.query("UPDATE letter_types SET form_schema = ? WHERE id = ?", [req.body.schema, req.params.id], (err) => {
        if(err) return res.status(500).json({message: "Gagal"});
        res.json({message: "Sukses"});
    });
};

exports.deleteTypeActive = (req, res) => {
    callbackDb.query("DELETE FROM letter_types WHERE id = ?", [req.params.id], (err) => {
        if(err) return res.status(500).json({message: "Gagal"});
        res.json({message: "Terhapus"});
    });
};

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

// 4. Update Schema Form 
exports.updateSchema = async (req, res) => {
    const { id } = req.params;
    const { schema } = req.body; 
    
    try {
        await db.query("UPDATE letter_types SET form_schema = ? WHERE id = ?", [schema, id]);
        res.json({ message: 'Schema updated' });
    } catch (error) {
        console.error("Gagal update schema:", error);
        res.status(500).json({ error: error.message });
    }
};
