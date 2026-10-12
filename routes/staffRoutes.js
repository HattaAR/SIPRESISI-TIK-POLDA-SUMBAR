const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

router.get('/dashboard', verifyToken, requireRole('staff'), staffController.getStaffDashboard);
router.get('/archive', verifyToken, requireRole('staff'), staffController.getStaffArchive);

module.exports = router;
