// routes/logRoutes.js
const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

// Hanya Admin yang boleh lihat log
router.get('/', logController.getLogs);

module.exports = router;