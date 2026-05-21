const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  createPostDeliveryRequest,
  createReview,
  deleteMyReview,
  listMyReviews,
  listReviewableItems,
  listRequests,
  listReviews,
  toggleReviewVisibility,
  updateMyReview,
  updateRequest
} = require('../controllers/postDeliveryController');

const router = express.Router();
router.use(authenticate);

router.post('/orders/:orderId/items/:itemId/request', asyncHandler(createPostDeliveryRequest));
router.post('/orders/:orderId/items/:itemId/review', asyncHandler(createReview));
router.get('/reviewable-items', asyncHandler(listReviewableItems));
router.get('/my-reviews', asyncHandler(listMyReviews));
router.put('/reviews/:id', asyncHandler(updateMyReview));
router.delete('/reviews/:id', asyncHandler(deleteMyReview));
router.get('/requests', requireAdmin, asyncHandler(listRequests));
router.patch('/requests/:id', requireAdmin, asyncHandler(updateRequest));
router.get('/reviews', requireAdmin, asyncHandler(listReviews));
router.patch('/reviews/:id/visibility', requireAdmin, asyncHandler(toggleReviewVisibility));

module.exports = router;
