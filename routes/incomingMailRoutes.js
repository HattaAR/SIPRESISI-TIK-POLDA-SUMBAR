const express = require('express');
const router = express.Router();
const incomingMailController = require('../controllers/incomingMailController');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

router.get('/', verifyToken, requireRole('admin'), incomingMailController.getIncomingMailPage);

const registerIncomingMailPost = (app, upload) => {
    app.post('/api/letters/incoming', verifyToken, upload.single('file_scan'), incomingMailController.registerIncomingMail);
};

module.exports = router;
module.exports.registerIncomingMailPost = registerIncomingMailPost;
