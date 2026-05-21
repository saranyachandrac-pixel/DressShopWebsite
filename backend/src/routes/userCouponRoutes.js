const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { listAvailableCoupons, applyCoupon, removeCoupon } = require('../controllers/couponController');

const router = express.Router();

router.use(authenticate);
router.get('/available', asyncHandler(listAvailableCoupons));
router.post('/apply', asyncHandler(applyCoupon));
router.delete('/remove', asyncHandler(removeCoupon));

module.exports = router;
