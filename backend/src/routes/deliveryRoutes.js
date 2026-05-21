const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { checkDelivery } = require('../controllers/deliveryController');

const router = express.Router();

router.post('/check', asyncHandler(checkDelivery));
router.get('/estimate', asyncHandler(checkDelivery));

module.exports = router;
