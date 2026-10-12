const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx');
const fs = require('fs');
const upload = require('./middleware/uploadMiddleware');

dotenv.config();
require('./config/auth');

const db = require('./config/database').callbackPool;
const { verifyToken } = require('./middleware/authMiddleware');
const { csrfProtection } = require('./middleware/csrfMiddleware');
const { logActivity } = require('./services/activityLogService');
const authRoutes = require('./routes/authRoutes');
const logRoutes = require('./routes/logRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const typeRoutes = require('./routes/typeRoutes');
const archiveRoutes = require('./routes/archiveRoutes');
const incomingMailRoutes = require('./routes/incomingMailRoutes');
const profileRoutes = require('./routes/profileRoutes');
const staffRoutes = require('./routes/staffRoutes');
const dispositionRoutes = require('./routes/dispositionRoutes');
const staffLetterDraftRoutes = require('./routes/staffLetterDraftRoutes');
const letterDetailRoutes = require('./routes/letterDetailRoutes');
const pimpinanRoutes = require('./routes/pimpinanRoutes');
const { letterDecisionRouter } = require('./routes/pimpinanRoutes');
const documentRoutes = require('./routes/documentRoutes');
const privateUploadRoutes = require('./routes/privateUploadRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use(csrfProtection);
app.use('/uploads', privateUploadRoutes);
// Only UI assets are public; uploaded/generated documents must not fall through here.
for (const directory of ['css', 'js', 'images']) {
    app.use('/' + directory, express.static(path.join(__dirname, 'public', directory)));
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// HELPER FUNCTION
function getRomanMonth() {
    const months = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
    return months[new Date().getMonth()];
}


// AUTH & HOME

app.use('/', authRoutes);

// API AMBIL DAFTAR USER

userRoutes.registerGetUsersApi(app);


// AREA STAFF

app.use('/staff', staffRoutes);

app.use('/', staffLetterDraftRoutes);






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

app.use('/staff/profile', profileRoutes);

app.use('/', dispositionRoutes);




// AREA ADMIN
app.use('/admin', adminRoutes);

app.use('/admin/users', userRoutes);

userRoutes.registerUserApiMutations(app);

userRoutes.registerDeleteUserApi(app);

app.use('/admin/types', typeRoutes);

typeRoutes.registerCreateType(app, upload);

typeRoutes.registerUpdateSchema(app);

typeRoutes.registerDeleteType(app);


typeRoutes.registerUpdateType(app, upload);

app.use('/admin/logs', logRoutes);

app.use('/admin/archive', archiveRoutes);

app.use('/admin/incoming-mail', incomingMailRoutes);

incomingMailRoutes.registerIncomingMailPost(app, upload);


// AREA PIMPINAN
app.use('/pimpinan', pimpinanRoutes);

app.use('/', letterDetailRoutes);

app.use('/api/letters', letterDecisionRouter);

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

//download surat
app.use(documentRoutes);


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
