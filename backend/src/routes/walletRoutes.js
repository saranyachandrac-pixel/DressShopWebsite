const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  addWalletMoney,
  createWallet,
  getBalance,
  getHistory,
  payExistingOrder,
  refundWalletPayment,
  sendWalletMoney
} = require('../controllers/walletController');

const router = express.Router();

router.use(authenticate);

router.post('/create', asyncHandler(createWallet));
router.get('/balance', asyncHandler(getBalance));
router.post('/add-money', asyncHandler(addWalletMoney));
router.post('/send-money', asyncHandler(sendWalletMoney));
router.get('/history', asyncHandler(getHistory));
router.post('/pay-order', asyncHandler(payExistingOrder));
router.post('/refund', requireAdmin, asyncHandler(refundWalletPayment));

module.exports = router;
