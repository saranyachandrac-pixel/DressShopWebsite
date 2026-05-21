const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { listUserCoupons } = require('../controllers/couponController');

const router = express.Router();

router.use(authenticate);
router.get('/coupons', asyncHandler(listUserCoupons));

module.exports = router;
