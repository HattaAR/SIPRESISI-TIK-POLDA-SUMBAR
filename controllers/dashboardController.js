const db = require('../config/database');

exports.getStats = async (req, res) => {
    // Ambil identitas user dari token login
    const role = req.user.role; 
    const userId = req.user.id;
    
    try {
        let query = "";
        let params = [];

        // ============================================================
        // SKENARIO 1: JIKA YANG LOGIN ADALAH STAFF
        // ============================================================
        if (role === 'staff') {
            // Hitung surat milik DIA SENDIRI (created_by_id = userId)
            query = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
                FROM letters WHERE created_by_id = ?
            `;
            params = [userId];
        
        // ============================================================
        // SKENARIO 2: JIKA YANG LOGIN ADALAH PIMPINAN
        // ============================================================
        } else if (role === 'pimpinan') {
            // 1. Pending: Hitung SEMUA surat status 'pending' dari SIAPAPUN (Global)
            // 2. Approved/Rejected: Hitung dari tabel HISTORY (yang pernah dia klik)
            query = `
                SELECT 
                    (SELECT COUNT(*) FROM letters WHERE status = 'pending') as pending,
                    (SELECT COUNT(*) FROM approval_history WHERE actor_id = ? AND action = 'approve') as approved,
                    (SELECT COUNT(*) FROM approval_history WHERE actor_id = ? AND action = 'reject') as rejected
            `;
            // Params harus dua kali userId karena ada dua tanda tanya (?) di query history
            params = [userId, userId];
        
        // ============================================================
        // SKENARIO 3: JIKA YANG LOGIN ADALAH ADMIN
        // ============================================================
        } else {
            // Hitung Data Master Sistem
            query = `
                SELECT 
                    (SELECT COUNT(*) FROM users WHERE is_active = 1) as total_user,
                    (SELECT COUNT(*) FROM letter_types) as total_jenis,
                    (SELECT COUNT(*) FROM letters) as total_surat,
                    (SELECT COUNT(*) FROM letters WHERE status = 'approved') as total_arsip
            `;
            params = [];
        }

        // Eksekusi Query
        const [rows] = await db.query(query, params);
        
        // Cegah error jika hasil kosong
        const stats = rows[0] || {};
        
        // Kirim data ke frontend
        res.json({ data: stats });

    } catch (error) {
        console.error("Error Dashboard Stats:", error);
        res.status(500).json({ message: 'Gagal mengambil statistik dashboard' });
    }
};