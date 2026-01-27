const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

// Kunci semua route ini hanya untuk ADMIN
router.use(authMiddleware); 
// (Tips: Di middleware nanti Anda bisa tambahkan cek if(req.user.role !== 'admin')...)

router.get('/', userController.getAllUsers);
router.post('/', userController.createUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;