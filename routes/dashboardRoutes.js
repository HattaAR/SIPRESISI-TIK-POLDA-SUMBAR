const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

// Pastikan di sini memanggil .getStats (Sesuai dengan nama di Controller)
router.get('/stats', dashboardController.getStats);

module.exports = router;