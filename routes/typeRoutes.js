const express = require('express');
const router = express.Router();
const typeController = require('../controllers/typeController');
const { verifyToken } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

router.get('/', verifyToken, requireRole('admin'), typeController.getTypesPage);

module.exports = router;

module.exports.registerCreateType = (app, upload) => {
    app.post('/api/types', verifyToken, requireRole('admin'), upload.single('template_file'), typeController.createTypeWithTemplate);
};

module.exports.registerUpdateSchema = (app) => {
    app.put('/api/types/:id/schema', verifyToken, requireRole('admin'), typeController.updateSchemaActive);
};

module.exports.registerDeleteType = (app) => {
    app.delete('/api/types/:id', verifyToken, requireRole('admin'), typeController.deleteTypeActive);
};

module.exports.registerUpdateType = (app, upload) => {
    app.put('/api/types/:id', verifyToken, requireRole('admin'), upload.single('template_file'), typeController.updateTypeWithTemplate);
};
