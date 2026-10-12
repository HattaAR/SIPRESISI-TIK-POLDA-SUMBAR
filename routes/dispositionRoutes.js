const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const dispositionController = require('../controllers/dispositionController');

const router = express.Router();

router.get('/staff/dispositions', verifyToken, requireRole('staff'), dispositionController.getStaffDispositions);
router.post('/api/dispositions/:id/complete', verifyToken, dispositionController.completeStaffDisposition);

module.exports = router;
