const express = require('express');
const router = express.Router();
const archiveController = require('../controllers/archiveController');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

router.get('/', verifyToken, requireRole('admin'), archiveController.getAdminArchive);

module.exports = router;
