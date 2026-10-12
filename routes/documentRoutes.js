const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const documentController = require('../controllers/documentController');

const router = express.Router();

router.get('/download-surat/:id', verifyToken, requireRole('admin', 'staff', 'pimpinan'), documentController.authorizeDownload, documentController.downloadLetter);

module.exports = router;
