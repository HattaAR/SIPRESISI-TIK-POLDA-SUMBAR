const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

router.get('/', verifyToken, requireRole('staff'), profileController.getStaffProfilePage);
router.post('/update', verifyToken, profileController.updateStaffProfile);
router.post('/password', verifyToken, profileController.updateStaffPassword);

module.exports = router;
