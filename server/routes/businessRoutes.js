const express = require('express');
const controller = require('../controllers/businessController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', controller.list);
router.post('/', requireAuth, requireRole('admin', 'appraiser', 'clerk'), controller.create);
router.get('/:id', controller.profile);

module.exports = router;
