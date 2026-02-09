const db = require('../config/database');

exports.getLogs = async (req, res) => {
    try {
       
        const query = `
            SELECT l.*, u.full_name, u.role 
            FROM activity_logs l
            LEFT JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC
            LIMIT 100
        `;
        const [rows] = await db.query(query);
        res.json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};