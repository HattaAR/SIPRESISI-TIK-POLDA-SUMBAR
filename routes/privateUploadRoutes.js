const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { getPrivateUpload } = require('../controllers/privateUploadController');

const router = express.Router();
router.use(verifyToken, requireRole('admin', 'staff', 'pimpinan'));
router.get('/:filename', getPrivateUpload);
// No fallback to express.static for unknown files, subdirectories or traversal attempts.
router.use((req, res) => res.status(404).send('File tidak ditemukan'));

module.exports = router;
