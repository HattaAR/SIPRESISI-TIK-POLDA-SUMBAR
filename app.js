const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx');
const fs = require('fs');
const multer = require('multer');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const PDFDocument = require('pdfkit'); 

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

//upload(multer)
const storage = multer.memoryStorage();

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'
        ];

        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Hanya format PDF (Surat Masuk) dan DOCX (Template) yang diperbolehkan!'), false);
        }
    }
});

// KONEKSI DATABASE
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'db_sisk'
});

// HELPER LOG AKTIVITAS
const logActivity = (userId, actionName, descriptionText, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '::1';
    const sql = "INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)";
    db.query(sql, [userId, actionName, descriptionText, ip], (err) => {
        if (err) console.error(" Gagal mencatat log:", err);
    });
};

db.connect((err) => {
    if (err) {
        console.error(" Database Gagal Terhubung:", err);
    } else {
        console.log(" Database Terhubung (MySQL: db_sisk)!");
    }
});

// MIDDLEWARE
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// SECURITY CHECK
const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.redirect('/');

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rahasia_negara');
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/');
    }
};

// HELPER FUNCTION
function getRomanMonth() {
    const months = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
    return months[new Date().getMonth()];
}


// AUTH & HOME

app.get('/', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rahasia_negara');
            if (decoded.role === 'admin') return res.redirect('/admin/dashboard');
            if (decoded.role === 'staff') return res.redirect('/staff/dashboard');
            if (decoded.role === 'pimpinan') return res.redirect('/pimpinan/dashboard');
        } catch (e) {
            res.clearCookie('token');
        }
    }
    res.render('login', { title: 'Login - SIPRESISI TIK' });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database Error" });
        if (results.length === 0) return res.status(401).json({ message: "Username tidak ditemukan!" });

        const user = results[0];

        // CEK is_active (1 = Aktif, 0 = Nonaktif)
        if (user.is_active === 0) {
            return res.status(403).json({ message: "Akun Anda telah dinonaktifkan oleh Admin." });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ message: "Password Salah!" });

        const token = jwt.sign(
            { id: user.id, name: user.full_name, role: user.role, nrp: user.nrp },
            process.env.JWT_SECRET || 'rahasia_negara',
            { expiresIn: '1d' }
        );

        logActivity(user.id, 'LOGIN', `User ${user.username} berhasil login ke sistem`, req);

        res.cookie('token', token, { httpOnly: true });
        res.json({ message: "Login Berhasil", token, user });
    });
});

app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/');
});

// API AMBIL DAFTAR USER

app.get('/api/users', verifyToken, (req, res) => {
    const { role, status } = req.query;
    let sql = "SELECT id, full_name, nrp, role, status FROM users";
    let params = [];
    let conditions = [];

    if (role) {
        conditions.push("role = ?");
        params.push(role);
    }

    if (status) {
        conditions.push("status = ?");
        params.push(status);
    }

    if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY full_name ASC";

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("Gagal ambil data user:", err);
            return res.status(500).json([]);
        }
        res.json(results);
    });
});


// AREA STAFF


app.get('/staff/dashboard', verifyToken, (req, res) => {
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
});

app.get('/staff/create', verifyToken, (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');
        
        const freshUser = userResult[0];

        db.query("SELECT * FROM letter_types", (err, types) => {
            if (err) return res.redirect('/staff/dashboard');

            const editId = req.query.edit;

            if (editId) {
                const sql = "SELECT * FROM letters WHERE id = ? AND user_id = ?";
                
                db.query(sql, [editId, req.user.id], (err, results) => {
                    if (err || results.length === 0) return res.redirect('/staff/dashboard');
                    
                    const letter = results[0];
                    let content = {};
                    try { content = JSON.parse(letter.content_data); } catch(e) {}

                    res.render('staff/create', {
                        title: 'Perbaiki Surat',
                        page: 'create',
                        user: freshUser, 
                        types: types,
                        isEdit: true,       
                        letter: letter,     
                        content: content    
                    });
                });

            } else {
                res.render('staff/create', {
                    title: 'Buat Surat Baru',
                    page: 'create',
                    user: freshUser, 
                    types: types,
                    isEdit: false,
                    letter: null,
                    content: null
                });
            }
        }); 
    }); 
});

app.post('/api/letters', verifyToken, (req, res) => {
    const { type_id, subject, ...formData } = req.body;
    const userId = req.user.id;

    const insertSql = `
        INSERT INTO letters (user_id, type_id, letter_number, subject, content_data, status) 
        VALUES (?, ?, 'DRAFT', ?, ?, 'DRAFT')
    `;

    db.query(insertSql, [userId, type_id, subject, JSON.stringify(formData)], (err, result) => {
        if (err) return res.status(500).json({ message: "Gagal menyimpan surat" });
        
        logActivity(userId, 'CREATE_DRAFT', `Membuat draft surat: ${subject}`, req);
        
        res.json({ message: "Draft berhasil disimpan", number: "DRAFT" });
    });
});

app.post('/api/letters/:id/send', verifyToken, (req, res) => {
    const id = req.params.id;
    const userId = req.user.id;

    const sql = "UPDATE letters SET status = 'PENDING', updated_at = NOW() WHERE id = ? AND user_id = ?";
    
    db.query(sql, [id, userId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Terjadi kesalahan server." });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Gagal mengirim. Data tidak ditemukan." });
        }
        logActivity(userId, 'SUBMIT_LETTER', `Mengajukan surat ID: ${id} ke Pimpinan`, req);

        res.json({ message: "Surat berhasil dikirim ke Pimpinan!" });
    });
});

app.delete('/api/letters/:id', verifyToken, (req, res) => {
    const id = req.params.id;
    const userId = req.user.id;

    const sql = "DELETE FROM letters WHERE id = ? AND user_id = ? AND status IN ('DRAFT', 'REJECTED')";
    
    db.query(sql, [id, userId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Gagal menghapus data." });
        }
        if (result.affectedRows === 0) {
            return res.status(400).json({ message: "Hanya surat DRAFT atau DITOLAK yang bisa dihapus." });
        }
        logActivity(userId, 'DELETE_LETTER', `Menghapus surat ID: ${id}`, req);

        res.json({ message: "Surat berhasil dihapus permanen." });
    });
});






app.post('/api/letters/update', verifyToken, (req, res) => {
    const { id, type_id, subject, ...contentData } = req.body;

    const checkSql = "SELECT id FROM letters WHERE id = ? AND user_id = ?";
    db.query(checkSql, [id, req.user.id], (err, results) => {
        if (err || results.length === 0) return res.status(403).json({ message: "Akses ditolak" });

        const updateSql = `
            UPDATE letters 
            SET type_id = ?, subject = ?, content_data = ?, status = 'DRAFT', updated_at = NOW() 
            WHERE id = ?
        `;

        db.query(updateSql, [type_id, subject, JSON.stringify(contentData), id], (err) => {
            if (err) return res.status(500).json({ message: "Gagal menyimpan revisi" });
            res.json({ message: "Revisi berhasil disimpan!" });
        });
    });
});

app.get('/staff/archive', verifyToken, (req, res) => {
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
});

app.post('/staff/profile', verifyToken, async (req, res) => {
    const { full_name, nrp, job_title, password } = req.body;
    const userId = req.user.id;

    let sql, params;
    
    if (password && password.trim() !== "") {
        const hashedPassword = await bcrypt.hash(password, 10);
        sql = "UPDATE users SET full_name = ?, nrp = ?, job_title = ?, password = ? WHERE id = ?";
        params = [full_name, nrp, job_title, hashedPassword, userId];
    } else {
        sql = "UPDATE users SET full_name = ?, nrp = ?, job_title = ? WHERE id = ?";
        params = [full_name, nrp, job_title, userId];
    }

    db.query(sql, params, (err, result) => {
        if (err) {
            console.error(err);
            return res.redirect('/staff/profile?error=gagal_update');
        }

        req.user.full_name = full_name;
        req.user.nrp = nrp;
        req.user.job_title = job_title;

        if (req.session && req.session.user) {
            req.session.user.full_name = full_name;
            req.session.user.nrp = nrp;
            req.session.user.job_title = job_title;
            
            req.session.save((err) => {
                res.redirect('/staff/profile?status=success');
            });
        } else {
            res.redirect('/staff/profile?status=success');
        }
    });
});

app.get('/staff/profile', verifyToken, (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.redirect('/staff/dashboard');
        }

        if (!results || results.length === 0) {
            return res.redirect('/logout');
        }

        res.render('staff/profile', {
            title: 'Profil Saya',
            page: 'profile',
            user: results[0] 
        });
    });
});

app.post('/staff/profile/update', verifyToken, (req, res) => {
    const { full_name, nrp, position } = req.body; 
    const userId = req.user.id;

    if (!full_name) {
        return renderProfile(res, req, '', 'Nama Lengkap wajib diisi.');
    }
    const sql = "UPDATE users SET full_name = ?, nrp = ?, position= ? WHERE id = ?";
    
    db.query(sql, [full_name, nrp, position, userId], (err, result) => {
        if (err) {
            console.error("Error update profile:", err);
            return renderProfile(res, req, '', 'Gagal memperbarui database.');
        }
        req.user.full_name = full_name;
        req.user.nrp = nrp;
        req.user.position = position;
      
      if (req.session) {
            req.session.user = req.user; 
            req.session.save(() => {
                renderProfile(res, req, 'Profil berhasil diperbarui!', '');
            });
        } else {
            renderProfile(res, req, 'Profil berhasil diperbarui!', '');
        }
    });
});

app.post('/staff/profile/password', verifyToken, async (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
    const userId = req.user.id;

    if (!old_password || !new_password) {
        return renderProfile(res, req, '', 'Password lama dan baru wajib diisi.');
    }
    if (new_password.length < 6) {
        return renderProfile(res, req, '', 'Password baru minimal 6 karakter.');
    }
    if (new_password !== confirm_password) {
        return renderProfile(res, req, '', 'Konfirmasi password tidak cocok.');
    }

    db.query("SELECT * FROM users WHERE id = ?", [userId], async (err, results) => {
        if (err) {
            console.error(" Database Error (Select User):", err);
            return renderProfile(res, req, '', 'Terjadi kesalahan sistem database.');
        }

        if (results.length === 0) {
            console.error(" User ID tidak ditemukan:", userId);
            return renderProfile(res, req, '', 'User tidak ditemukan.');
        }

        const userInDb = results[0];
        const currentPasswordHash = userInDb.password || userInDb.password_hash;

        if (!currentPasswordHash) {
            console.error(" Kolom password kosong/tidak ditemukan di database!");
            return renderProfile(res, req, '', 'Data password user bermasalah.');
        }

        const isMatch = await bcrypt.compare(old_password, currentPasswordHash);
        if (!isMatch) {
            return renderProfile(res, req, '', 'Password Lama Salah!');
        }

        const newHash = await bcrypt.hash(new_password, 10);
        
        let updateSql = "UPDATE users SET password = ? WHERE id = ?";
        
        if (userInDb.password_hash) {
            updateSql = "UPDATE users SET password_hash = ? WHERE id = ?";
        }

        db.query(updateSql, [newHash, userId], (errUpdate) => {
            if (errUpdate) {
                console.error(" Gagal update password:", errUpdate);
                return renderProfile(res, req, '', 'Gagal menyimpan password baru.');
            }
            renderProfile(res, req, 'Password berhasil diganti! Silakan login ulang.', '');
        });
    });
});

function renderProfile(res, req, success, error) {
    db.query("SELECT * FROM users WHERE id = ?", [req.user.id], (err, results) => {
        const userData = results && results.length > 0 ? results[0] : req.user;
        res.render('staff/profile', { 
            title: 'Profil Saya', 
            page: 'profile', 
            user: userData,
            success_msg: success,
            error_msg: error
        });
    });
}

app.get('/staff/dispositions', verifyToken, (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if (err || userResult.length === 0) return res.redirect('/logout');
        
        const freshUser = userResult[0];
        const userId = req.user.id;

        const page = parseInt(req.query.page) || 1;
        const limit = 10; 
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let searchSql = "";
        let searchParams = [];

        if (search) {
            searchSql = "AND (l.subject LIKE ? OR l.letter_number LIKE ? OR u.full_name LIKE ?)";
            searchParams = [`%${search}%`, `%${search}%`, `%${search}%`];
        }

        const countSql = `
            SELECT COUNT(*) AS total 
            FROM dispositions d
            JOIN letters l ON d.letter_id = l.id
            JOIN users u ON d.sender_id = u.id
            WHERE d.receiver_id = ? ${searchSql}
        `;

        db.query(countSql, [userId, ...searchParams], (err, countResult) => {
            if (err) {
                console.error("Count Error:", err);
                return res.redirect('/dashboard');
            }

            const totalItems = countResult[0].total;
            const totalPages = Math.ceil(totalItems / limit);
            const sql = `
                SELECT d.*, 
                       l.subject, 
                       l.letter_number, 
                       l.external_sender, 
                       l.pdf_path,
                       u.full_name as pimpinan_name,
                       (LENGTH(l.content_data) > 0 OR l.pdf_path IS NOT NULL) as ada_file 
                FROM dispositions d
                JOIN letters l ON d.letter_id = l.id
                JOIN users u ON d.sender_id = u.id
                WHERE d.receiver_id = ? ${searchSql}
                ORDER BY d.created_at DESC
                LIMIT ? OFFSET ?
            `;

            db.query(sql, [userId, ...searchParams, limit, offset], (err, results) => {
                if (err) console.error("Data Error:", err);

                res.render('staff/disposition_inbox', {
                    title: 'Tugas Masuk',
                    user: freshUser, 
                    page: 'dispositions', 
                    tasks: results || [],
                    currentPage: page,
                    totalPages: totalPages,
                    totalItems: totalItems,
                    search: search
                });
            }); 
        }); 
    }); 
});

app.post('/api/dispositions/:id/complete', verifyToken, (req, res) => {
    const dispositionId = req.params.id;
    const userId = req.user.id;

    const sqlCheck = "SELECT * FROM dispositions WHERE id = ? AND receiver_id = ?";

    db.query(sqlCheck, [dispositionId, userId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ message: "Tugas tidak ditemukan atau akses ditolak." });
        }

        const letterId = results[0].letter_id;

        db.query("UPDATE dispositions SET status = 'COMPLETED' WHERE id = ?", [dispositionId], (err2) => {
            if (err2) return res.status(500).json({ message: "Database error saat update disposisi" });

            db.query("UPDATE letters SET status = 'COMPLETED' WHERE id = ?", [letterId], (err3) => {
                if (err3) {
                    console.error("Error Letter Status:", err3);
                    return res.status(500).json({ message: "Gagal update status surat utama" });
                }

                if (typeof logActivity === 'function') {
                    logActivity(userId, 'COMPLETE_TASK', `Menyelesaikan tugas disposisi (Letter ID: ${letterId})`, req);
                }

                res.json({ message: "Tugas berhasil diselesaikan! Status surat diperbarui." });
            });
        });
    });
});




// AREA ADMIN
app.get('/admin/dashboard', verifyToken, (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if (err || userResult.length === 0) return res.redirect('/logout');
        
        const currentUser = userResult[0]; 

        const sqlStats = `
            SELECT 
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
                    SELECT 
                        l.id as ref_id,
                        l.created_at as activity_time,
                        u.full_name as actor_name,
                        u.role as actor_role,
                        CASE 
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

                    SELECT 
                        d.id as ref_id,
                        d.created_at as activity_time,
                        sender.full_name as actor_name,
                        sender.role as actor_role,
                        CASE 
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
});

app.get('/admin/users', verifyToken, (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');
        
        const freshUser = userResult[0];

        db.query("SELECT * FROM users ORDER BY id DESC", (err, results) => {
            res.render('admin/users', { 
                title: 'Kelola User', 
                page: 'users', 
                user: freshUser, 
                users: results || [] 
            });
        });
    });
});

app.post('/api/users', verifyToken, async (req, res) => {
    const { full_name, username, nrp, password, role } = req.body;

    if (!full_name || !username || !password || !role) {
        return res.status(400).json({ message: "Data tidak lengkap" });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO users (full_name, username, nrp, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)";
        
        db.query(sql, [full_name, username, nrp, hash, role], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: "Username/NRP sudah digunakan" });
                return res.status(500).json({ message: "Error database" });
            }

            logActivity(req.user.id, 'CREATE_USER', `Menambahkan user baru: ${username} (${role})`, req);
            res.json({ message: "Sukses menambahkan user" });
        });
    } catch (e) {
        res.status(500).json({ message: "Server error saat hashing" });
    }
});

app.put('/api/users/:id', verifyToken, async (req, res) => {
    const { full_name, username, nrp, role, password } = req.body;
    const userId = req.params.id;

    if (!full_name || !username || !role) return res.status(400).json({ message: "Data tidak lengkap" });

    try {
        if (password && password.trim() !== "") {
            const hash = await bcrypt.hash(password, 10);
            const sql = "UPDATE users SET full_name=?, username=?, nrp=?, role=?, password_hash=? WHERE id=?";
            
            db.query(sql, [full_name, username, nrp, role, hash, userId], (err) => {
                if (err) return res.status(500).json({ message: "Gagal update database" });
                
                logActivity(req.user.id, 'UPDATE_USER', `Mengupdate data & password user ID: ${userId}`, req);
                res.json({ message: "Data user & password berhasil diperbarui!" });
            });
        } else {
            const sql = "UPDATE users SET full_name=?, username=?, nrp=?, role=? WHERE id=?";
            
            db.query(sql, [full_name, username, nrp, role, userId], (err) => {
                if (err) return res.status(500).json({ message: "Gagal update database" });

                logActivity(req.user.id, 'UPDATE_USER', `Mengupdate data user ID: ${userId}`, req);
                res.json({ message: "Data user berhasil diperbarui!" });
            });
        }
    } catch (error) {
        return res.status(500).json({ message: "Server Error" });
    }
});

app.put('/api/users/:id/status', verifyToken, (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'kasubbag') {
        return res.status(403).json({ message: "Akses ditolak!" });
    }

    const userId = req.params.id;
    const sql = "UPDATE users SET is_active = NOT is_active WHERE id = ?";

    db.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).json({ message: "Gagal update status" });
        if (result.affectedRows === 0) return res.status(404).json({ message: "User tidak ditemukan" });

        logActivity(req.user.id, 'UPDATE_USER_STATUS', `Mengubah status aktif user ID: ${userId}`, req);
        res.json({ message: "Status akun berhasil diubah!" });
    });
});

app.delete('/api/users/:id', verifyToken, (req, res) => {
    if (req.params.id == req.user.id) return res.status(400).json({ message: "Tidak bisa menghapus akun sendiri" });
    
    db.query("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Gagal hapus" });

        logActivity(req.user.id, 'DELETE_USER', `Menghapus user ID: ${req.params.id}`, req);
        res.json({ message: "User berhasil dihapus permanen" });
    });
});

app.get('/admin/types', verifyToken, (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');
        
        const freshUser = userResult[0];

        db.query("SELECT * FROM letter_types ORDER BY id ASC", (err, results) => {
            res.render('admin/types', { 
                title: 'Jenis Surat', 
                page: 'types', 
                user: freshUser, 
                types: results || [] 
            });
        });
    });
});

app.post('/api/types', verifyToken, upload.single('template_file'), (req, res) => {
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
        db.query(sql, [name, code_prefix, letter_number_format, form_schema, fileName], (err) => {
            if (err) return res.status(500).json({ message: "Gagal menyimpan ke database" });
            res.json({ message: "Sukses!" });
        });
    } catch (error) {
        res.status(500).json({ message: "Gagal menyimpan file ke server" });
    }
});

app.put('/api/types/:id/schema', verifyToken, (req, res) => {
    db.query("UPDATE letter_types SET form_schema = ? WHERE id = ?", [req.body.schema, req.params.id], (err) => {
        if(err) return res.status(500).json({message: "Gagal"});
        res.json({message: "Sukses"});
    });
});

app.delete('/api/types/:id', verifyToken, (req, res) => {
    db.query("DELETE FROM letter_types WHERE id = ?", [req.params.id], (err) => {
        if(err) return res.status(500).json({message: "Gagal"});
        res.json({message: "Terhapus"});
    });
});


app.put('/api/types/:id', verifyToken, upload.single('template_file'), (req, res) => {
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

    db.query(sql, params, (err) => {
        if (err) return res.status(500).json({ message: "Gagal update database" });
        res.json({ message: "Jenis surat berhasil diperbarui!" });
    });
});

app.get('/admin/logs', verifyToken, (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');
        
        const freshUser = userResult[0];
        const page = parseInt(req.query.page) || 1; 
        const limit = 100; 
        const offset = (page - 1) * limit; 

        db.query("SELECT COUNT(*) AS total FROM activity_logs", (err, countResult) => {
            if (err) {
                console.error(err);
                return res.status(500).send("Database Error");
            }

            const totalRecords = countResult[0].total;
            const totalPages = Math.ceil(totalRecords / limit);

            const sql = `
                SELECT l.*, u.full_name, u.role, u.nrp 
                FROM activity_logs l 
                JOIN users u ON l.user_id = u.id 
                ORDER BY l.created_at DESC 
                LIMIT ? OFFSET ?
            `;

            db.query(sql, [limit, offset], (err, results) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send("Database Error");
                }
                res.render('admin/logs', { 
                    title: 'Log Aktivitas', 
                    page: 'logs', 
                    user: freshUser, 
                    logs: results || [],
                    currentPage: page,
                    totalPages: totalPages,
                    totalRecords: totalRecords
                });
            });
        });
    });
});

app.get('/admin/archive', verifyToken, (req, res) => {
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
});

app.get('/admin/incoming-mail', verifyToken, (req, res) => {
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
});

app.post('/api/letters/incoming', verifyToken, upload.single('file_scan'), (req, res) => {
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ 
            message: "Gagal: File PDF tidak terdeteksi atau kosong. Pastikan form memiliki enctype='multipart/form-data'." 
        });
    }

    const { letter_number, external_sender, subject, letter_date, recipient } = req.body;
    
    const fileName = `surat_masuk_${Date.now()}.pdf`;

   
    const uploadPath = path.join(__dirname, 'public', 'uploads', fileName);

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
});


// AREA PIMPINAN
app.get('/pimpinan/dashboard', verifyToken, (req, res) => {
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
});


app.get('/pimpinan/detail', verifyToken, (req, res) => {
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
});

app.get('/pimpinan/history', verifyToken, (req, res) => {
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
});




app.get('/pimpinan/reports', verifyToken, (req, res) => {
    db.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, userResult) => {
        if(err || userResult.length === 0) return res.redirect('/logout');
        
        const freshUser = userResult[0]; 

        res.render('pimpinan/reports', {
            title: 'Laporan Bulanan',
            page: 'reports', 
            user: freshUser 
        });
    }); 
});

app.post('/pimpinan/profile/update', verifyToken, (req, res) => {
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
});

app.get('/pimpinan/profile', verifyToken, (req, res) => {
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
});

app.get('/api/letters/:id', verifyToken, (req, res) => {
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
        try {
            if (typeof letterData.content_data === 'string') {
                letterData.content_data = JSON.parse(letterData.content_data);
            }
        } catch (e) {}

        res.json({ data: letterData });
    });
});

app.post('/pimpinan/profile/password', verifyToken, async (req, res) => {
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
});

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

app.post('/api/letters/:id/approve', verifyToken, (req, res) => {
    const letterId = req.params.id;
    const dateNow = new Date();
    const year = dateNow.getFullYear();
    const romanMonths = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
    const romanMonth = romanMonths[dateNow.getMonth()];

    db.query("SELECT type_id FROM letters WHERE id = ?", [letterId], (err, resL) => {
        if (err || resL.length === 0) return res.status(404).json({ message: "Data surat tidak ditemukan" });
        const typeId = resL[0].type_id;

        db.query("SELECT code_prefix, letter_number_format FROM letter_types WHERE id = ?", [typeId], (err, resT) => {
            if (err) return res.status(500).json({ message: "Gagal mengambil tipe surat" });
            
            const prefix = resT[0].code_prefix || 'SRT';
            const format = resT[0].letter_number_format || '{nomor}/{kode}/{bulan}/{tahun}';
            
            const sqlGetAll = `
                SELECT letter_number 
                FROM letters 
                WHERE type_id = ? AND status = 'APPROVED' AND YEAR(updated_at) = ?
            `;
            
            db.query(sqlGetAll, [typeId, year], (err, rows) => {
                if (err) {
                    console.error("DB Error:", err);
                    return res.status(500).json({ message: "Gagal memproses nomor surat." });
                }

                let maxUrut = 0;

                rows.forEach(row => {
                    if (row.letter_number) {
                        const parts = row.letter_number.split('/');
                        
                        parts.forEach(part => {
                            if (/^\d+$/.test(part)) { 
                                const num = parseInt(part);
                                if (num !== year && num > maxUrut) {
                                    maxUrut = num;
                                }
                            }
                        });
                    }
                });

                const nextNum = maxUrut + 1;
                const noStr = String(nextNum).padStart(3, '0');

                let finalNumber = format
                    .replace('{nomor}', noStr)
                    .replace('{kode}', prefix)
                    .replace('{bulan}', romanMonth)
                    .replace('{tahun}', year);

                const updateSql = `
                    UPDATE letters 
                    SET status = 'APPROVED', 
                        letter_number = ?, 
                        updated_at = NOW(), 
                        pimpinan_note = 'Disetujui.'
                    WHERE id = ?
                `;
                
                db.query(updateSql, [finalNumber, letterId], (err) => {
                    if (err) {
                        console.error("DB Error Update:", err);
                        return res.status(500).json({ message: "Gagal menyimpan persetujuan." });
                    }
                    
                    logActivity(req.user.id, 'APPROVE_LETTER', `Menyetujui surat No: ${finalNumber}`, req);
                    res.json({ message: `Sukses! Nomor Terbit: ${finalNumber}` });
                });
            });
        });
    });
});

app.post('/api/letters/:id/reject', verifyToken, (req, res) => {
    const reason = req.body.reason;
    
    if (!reason) return res.status(400).json({ message: "Alasan penolakan wajib diisi!" });

    const sql = "UPDATE letters SET status = 'REJECTED', pimpinan_note = ?, updated_at = NOW() WHERE id = ?";
    
    db.query(sql, [reason, req.params.id], (err) => {
        if(err) {
            console.error(err); 
            return res.status(500).json({message: "Gagal menolak surat"});
        }
        
        logActivity(req.user.id, 'REJECT_LETTER', `Menolak surat ID: ${req.params.id}`, req);
        res.json({message: "Surat dikembalikan ke staff."});
    });
});

app.get('/pimpinan/report/pdf', verifyToken, (req, res) => {
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
});

app.post('/api/profile/update', verifyToken, (req, res) => {
    const { full_name, nrp, jabatan } = req.body;
    if (!full_name) return res.status(400).json({ message: "Nama tidak boleh kosong" });

    const sql = "UPDATE users SET full_name = ?, nrp = ?, jabatan = ? WHERE id = ?";
    db.query(sql, [full_name, nrp, jabatan, req.user.id], (err) => {
        if (err) return res.status(500).json({ message: "Gagal update database" });
        res.json({ message: "Profil berhasil diperbarui!" });
    });
});

app.post('/api/profile/password', verifyToken, async (req, res) => {
    const { old_pass, new_pass } = req.body;
    if (!old_pass || !new_pass) return res.status(400).json({ message: "Wajib diisi" });

    db.query("SELECT password_hash FROM users WHERE id = ?", [req.user.id], async (err, results) => {
        if (err || results.length === 0) return res.status(500).json({ message: "User error" });
        
        const isMatch = await bcrypt.compare(old_pass, results[0].password_hash);
        if (!isMatch) return res.status(401).json({ message: "Password Lama Salah" });

        const newHash = await bcrypt.hash(new_pass, 10);
        db.query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, req.user.id], (err) => {
            if (err) return res.status(500).json({ message: "Gagal" });
            res.json({ message: "Password berhasil diganti!" });
        });
    });
});

app.post('/pimpinan/disposition', verifyToken, (req, res) => {
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
});


//download surat
app.get('/download-surat/:id', verifyToken, (req, res) => {
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
        const filePath = path.join(process.cwd(), 'public', 'uploads', cleanFileName);

        if (!fs.existsSync(filePath)) {
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
});


// ERROR HANDLER & SERVER START


app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('<h1>500 - Server Error</h1>');
});

app.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(` Server SiPresisi Berjalan di Port ${PORT}`);
    console.log(`===========================================`);
});