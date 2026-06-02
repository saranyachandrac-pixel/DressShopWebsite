const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { actionCancellation } = require('../controllers/cancellationController');

const router = express.Router();

router.use(authenticate, requireAdmin);
router.put('/:id/action', asyncHandler(actionCancellation));

module.exports = router;
