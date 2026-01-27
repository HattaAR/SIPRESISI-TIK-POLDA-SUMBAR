const db = require('../config/database');

exports.logActivity = async (req, userId, action, description) => {
    try {
        // Ambil IP (menangani jika di balik proxy/lokal)
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '::1';
        const ua = req.headers['user-agent'] || '-';

        const query = `
            INSERT INTO activity_logs (user_id, action, description, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?)
        `;
        
        await db.query(query, [userId, action, description, ip, ua]);
        
    } catch (error) {
        console.error("Gagal mencatat log:", error);
    }
};