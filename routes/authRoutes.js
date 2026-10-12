const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { loginRateLimiter } = require('../middleware/loginRateLimiter');

const noStore = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
};

router.get('/', noStore, authController.showLogin);
router.post('/api/auth/login', noStore, loginRateLimiter, authController.login);
router.get('/logout', noStore, authController.logout);

module.exports = router;
