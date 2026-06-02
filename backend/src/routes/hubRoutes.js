const express = require('express');
const multer = require('multer');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  listHubs,
  createHub,
  updateHub,
  deleteHub,
  listHubPincodes,
  saveHubPincode,
  bulkUploadPincodes,
  listHubStocks,
  listHubStockProducts,
  updateHubStock
} = require('../controllers/hubController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.use(authenticate, requireAdmin);

router.get('/hubs', asyncHandler(listHubs));
router.post('/hubs', asyncHandler(createHub));
router.put('/hubs/:id', asyncHandler(updateHub));
router.delete('/hubs/:id', asyncHandler(deleteHub));
router.get('/hub-pincodes', asyncHandler(listHubPincodes));
router.post('/hub-pincodes', asyncHandler(saveHubPincode));
router.post('/hub-pincodes/bulk-upload', upload.single('file'), asyncHandler(bulkUploadPincodes));
router.get('/hub-stocks', asyncHandler(listHubStocks));
router.get('/hub-stock/products', asyncHandler(listHubStockProducts));
router.post('/hub-stocks/update', asyncHandler(updateHubStock));

module.exports = router;
