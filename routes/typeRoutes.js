const express = require('express');
const router = express.Router();
const typeController = require('../controllers/typeController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/upload'); // Import middleware upload

router.use(authMiddleware);

router.get('/', typeController.getAllTypes);

// Tambahkan 'upload.single('template')' untuk menangani upload file
router.post('/', upload.single('template'), typeController.createType);

router.delete('/:id', typeController.deleteType);

// Route baru untuk update schema
router.put('/:id/schema', typeController.updateSchema);

module.exports = router;