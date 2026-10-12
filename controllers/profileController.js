const db = require('../config/database').callbackPool;
const bcrypt = require('bcryptjs');

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

exports.getStaffProfilePage = (req, res) => {
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
};

exports.updateStaffProfile = (req, res) => {
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
};

exports.updateStaffPassword = async (req, res) => {
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
};
