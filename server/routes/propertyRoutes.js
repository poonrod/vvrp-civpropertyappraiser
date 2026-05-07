const express = require('express');
const { body } = require('express-validator');
const controller = require('../controllers/propertyController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', controller.listProperties);
router.get('/export/csv', controller.exportCsv);
router.get('/:id/transactions', controller.transactions);
router.get('/:id/export/pdf', controller.exportPdf);
router.post('/', requireAuth, requireRole('admin', 'appraiser'), [body('name').notEmpty(), body('address').notEmpty()], controller.create);
router.put('/:id', requireAuth, requireRole('admin', 'appraiser', 'clerk'), controller.update);
router.patch('/:id/geojson', requireAuth, requireRole('admin', 'appraiser'), controller.updateGeo);
router.delete('/:id', requireAuth, requireRole('admin', 'appraiser'), controller.remove);
router.post('/:id/transfer', requireAuth, requireRole('admin', 'appraiser', 'clerk'), controller.transfer);

module.exports = router;
