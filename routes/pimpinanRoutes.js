const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const pimpinanController = require('../controllers/pimpinanController');

const router = express.Router();
const letterDecisionRouter = express.Router();

router.get('/dashboard', verifyToken, requireRole('pimpinan'), pimpinanController.getDashboard);
router.get('/detail', verifyToken, requireRole('pimpinan'), pimpinanController.getDetail);
router.get('/history', verifyToken, requireRole('pimpinan'), pimpinanController.getHistory);
router.get('/reports', verifyToken, requireRole('pimpinan'), pimpinanController.getReports);
router.get('/report/pdf', verifyToken, requireRole('pimpinan'), pimpinanController.getReportPdf);
router.get('/profile', verifyToken, requireRole('pimpinan'), pimpinanController.getProfile);
router.post('/profile/update', verifyToken, pimpinanController.updateProfile);
router.post('/profile/password', verifyToken, pimpinanController.updatePassword);
router.post('/disposition', verifyToken, requireRole('pimpinan'), pimpinanController.createDisposition);

letterDecisionRouter.post('/:id/approve', verifyToken, requireRole('pimpinan'), pimpinanController.approveLetter);
letterDecisionRouter.post('/:id/reject', verifyToken, requireRole('pimpinan'), pimpinanController.rejectLetter);

module.exports = router;
module.exports.letterDecisionRouter = letterDecisionRouter;
