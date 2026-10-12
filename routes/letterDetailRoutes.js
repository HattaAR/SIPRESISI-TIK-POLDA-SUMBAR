const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const letterDetailController = require('../controllers/letterDetailController');

const router = express.Router();

router.get('/api/letters/:id', verifyToken, requireRole('admin', 'pimpinan', 'staff'), letterDetailController.getLetterDetail);

module.exports = router;
