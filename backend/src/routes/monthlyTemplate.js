const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const monthlyTemplate = require('../controllers/monthlyTemplateController');

const router = express.Router();
router.use(authenticate);

router.get('/current', asyncHandler(monthlyTemplate.current));
router.get('/products', asyncHandler(monthlyTemplate.products));
router.post('/add-item', asyncHandler(monthlyTemplate.addItem));
router.put('/item/:id', asyncHandler(monthlyTemplate.updateItem));
router.delete('/item/:id', asyncHandler(monthlyTemplate.deleteItem));
router.post('/save', asyncHandler(monthlyTemplate.save));
router.post('/add-to-cart', asyncHandler(monthlyTemplate.addToCart));
router.post('/buy-now', asyncHandler(monthlyTemplate.buyNow));

module.exports = router;
