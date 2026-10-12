const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

router.get('/', verifyToken, requireRole('admin'), userController.getUsersPage);

router.registerGetUsersApi = (app) => {
    app.get('/api/users', verifyToken, userController.getUsersApi);
};

router.registerUserApiMutations = (app) => {
    app.post('/api/users', verifyToken, requireRole('admin'), userController.createUserApi);
    app.put('/api/users/:id', verifyToken, requireRole('admin'), userController.updateUserApi);
    app.put('/api/users/:id/status', verifyToken, requireRole('admin', 'kasubbag'), userController.updateUserStatusApi);
};

router.registerDeleteUserApi = (app) => {
    app.delete('/api/users/:id', verifyToken, requireRole('admin'), userController.deleteUserApi);
};

module.exports = router;
