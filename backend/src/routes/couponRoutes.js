const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  listCoupons,
  createCoupon,
  updateCoupon,
  updateCouponStatus,
  deleteCoupon
} = require('../controllers/couponController');

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get('/coupons', asyncHandler(listCoupons));
router.post('/coupons', asyncHandler(createCoupon));
router.put('/coupons/:id', asyncHandler(updateCoupon));
router.patch('/coupons/:id/status', asyncHandler(updateCouponStatus));
router.delete('/coupons/:id', asyncHandler(deleteCoupon));

module.exports = router;
