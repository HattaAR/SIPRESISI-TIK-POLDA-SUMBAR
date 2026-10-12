const db = require('../config/database').callbackPool;

const logActivityInTransaction = (connection, userId, actionName, descriptionText, req, callback) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '::1';
    const sql = "INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)";
    connection.query(sql, [userId, actionName, descriptionText, ip], callback);
};

const logActivity = (userId, actionName, descriptionText, req) => {
    logActivityInTransaction(db, userId, actionName, descriptionText, req, (err) => {
        if (err) console.error(" Gagal mencatat log:", err);
    });
};

module.exports = { logActivity, logActivityInTransaction };
