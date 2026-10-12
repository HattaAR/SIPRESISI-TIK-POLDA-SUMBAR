const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const staffLetterDraftController = require('../controllers/staffLetterDraftController');

const router = express.Router();

router.get('/staff/create', verifyToken, requireRole('staff'), staffLetterDraftController.getStaffCreatePage);
router.post('/api/letters', verifyToken, staffLetterDraftController.createDraft);
router.post('/api/letters/update', verifyToken, staffLetterDraftController.updateDraft);
router.post('/api/letters/:id/send', verifyToken, staffLetterDraftController.sendLetter);
router.delete('/api/letters/:id', verifyToken, staffLetterDraftController.deleteLetter);

module.exports = router;
