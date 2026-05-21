const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { cancelOrderItem, listCancellations, updateCancellation } = require('../controllers/cancellationController');

const router = express.Router();

router.use(authenticate);
router.post('/orders/:orderId/items/:itemId', asyncHandler(cancelOrderItem));
router.get('/', requireAdmin, asyncHandler(listCancellations));
router.patch('/:id', requireAdmin, asyncHandler(updateCancellation));

module.exports = router;
