const pool = require('../config/db');
const { refundOrder } = require('../services/walletService');
const { awardReviewBonus, reverseOrderCoins } = require('../services/superCoinService');
const { getOrderReplacementEligibility } = require('../services/replacementService');

function addDays(dateValue, days) {
  const date = new Date(dateValue);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

async function assertDeliveredItem(connection, { orderId, itemId, userId }) {
  const [[row]] = await connection.execute(
    `SELECT o.id AS orderId,
            o.user_id AS userId,
            o.order_number,
            o.delivery_status,
            o.payment_method,
            o.paid_status,
            o.total_amount,
            o.delivered_at,
            o.delivered_on,
            oi.id AS itemId,
            oi.product_id,
            oi.product_name,
            oi.price,
            oi.image,
            oi.item_status,
            oi.return_days,
            oi.replacement_days
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id = ? AND oi.id = ? AND o.user_id = ?
     FOR UPDATE`,
    [orderId, itemId, userId]
  );
  if (!row) return { error: 'Delivered order item not found.' };
  if (row.delivery_status !== 'DELIVERED') return { error: 'Return/replacement request is available only after delivery.' };
  if (row.item_status === 'CANCELLED') return { error: 'Cancelled items cannot be requested again.' };
  return { item: row };
}

async function ensureReviewProductExists(connection, item) {
  const productId = Number(item.product_id);
  if (!productId) return { error: 'Product reference is missing for this order item.' };

  const [[product]] = await connection.execute('SELECT id FROM products WHERE id = ?', [productId]);
  if (product) return {};

  const productName = item.product_name || 'Archived order item';
  const price = Number(item.price || 0);
  const image = item.image || null;
  await connection.execute(
    `INSERT INTO products
       (id, name, slug, description, category, brand, price, originalPrice, stock, image, image_url, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, FALSE)`,
    [
      productId,
      productName,
      `archived-order-product-${productId}`,
      'Archived product snapshot restored for order review.',
      'Archived',
      'DressShop',
      price,
      price,
      image,
      image
    ]
  );
  return {};
}

async function reviewProductId(connection, item) {
  const [[activeProduct]] = await connection.execute(
    `SELECT id
     FROM products
     WHERE is_active = TRUE
       AND LOWER(name) = LOWER(?)
     ORDER BY id DESC
     LIMIT 1`,
    [item.product_name || '']
  );
  return activeProduct?.id || item.product_id;
}

async function createPostDeliveryRequest(req, res) {
  const orderId = Number(req.params.orderId);
  const itemId = Number(req.params.itemId);
  const requestType = String(req.body.requestType || 'RETURN').trim().toUpperCase();
  const reason = String(req.body.reason || '').trim();
  if (!['RETURN', 'REPLACEMENT'].includes(requestType)) return res.status(400).json({ message: 'Request type must be RETURN or REPLACEMENT.' });
  if (!reason) return res.status(400).json({ message: 'Request reason is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const check = await assertDeliveredItem(connection, { orderId, itemId, userId: req.user.id });
    if (check.error) {
      await connection.rollback();
      return res.status(400).json({ message: check.error });
    }
    const deliveredAt = check.item.delivered_at || check.item.delivered_on;
    const returnDays = Math.max(0, Number(check.item.return_days || 0));
    const replacementDays = Math.max(0, Number(check.item.replacement_days || 0));
    if (requestType === 'RETURN') {
      const endsAt = deliveredAt && returnDays > 0 ? addDays(deliveredAt, returnDays) : null;
      if (!endsAt || endsAt < new Date()) {
        await connection.rollback();
        return res.status(400).json({ message: 'Return is not available for this item.' });
      }
    }
    if (requestType === 'REPLACEMENT') {
      const endsAt = deliveredAt && replacementDays > 0 ? addDays(deliveredAt, replacementDays) : null;
      if (!endsAt || endsAt < new Date()) {
        await connection.rollback();
        return res.status(400).json({ message: 'Replacement is not available for this item.' });
      }
      const eligibility = await getOrderReplacementEligibility(connection, { orderId, userId: req.user.id });
      const itemEligibility = eligibility?.items?.find((item) => Number(item.orderItemId) === itemId);
      if (!itemEligibility?.allowed) {
        await connection.rollback();
        return res.status(400).json({ message: itemEligibility?.message || 'Replacement is not available for this item.' });
      }
    }

    await connection.execute(
      `INSERT INTO post_delivery_requests (order_id, order_item_id, product_id, user_id, request_type, request_reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [check.item.orderId, check.item.itemId, check.item.product_id, req.user.id, requestType, reason]
    );
    await connection.commit();
    res.status(201).json({ message: 'Request submitted successfully.' });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A request already exists for this item.' });
    throw error;
  } finally {
    connection.release();
  }
}

async function createReview(req, res) {
  const orderId = Number(req.params.orderId);
  const itemId = Number(req.params.itemId);
  const rating = Number(req.body.rating);
  const reviewText = String(req.body.reviewText || '').trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating must be between 1 and 5.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const check = await assertDeliveredItem(connection, { orderId, itemId, userId: req.user.id });
    if (check.error) {
      await connection.rollback();
      return res.status(400).json({ message: check.error });
    }
    const productCheck = await ensureReviewProductExists(connection, check.item);
    if (productCheck.error) {
      await connection.rollback();
      return res.status(400).json({ message: productCheck.error });
    }
    const productId = await reviewProductId(connection, check.item);
    const [reviewResult] = await connection.execute(
      `INSERT INTO product_reviews (order_id, order_item_id, product_id, user_id, rating, review_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [check.item.orderId, check.item.itemId, productId, req.user.id, rating, reviewText || null]
    );
    const bonus = await awardReviewBonus(connection, reviewResult.insertId);
    await connection.commit();
    const message = bonus.credited
      ? 'Review submitted. Bonus Super Coins credited.'
      : bonus.pending
        ? 'Review submitted. Bonus Super Coins will be credited after replacement period.'
        : 'Review submitted successfully.';
    res.status(201).json({ message, bonus });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'You already reviewed this item.' });
    throw error;
  } finally {
    connection.release();
  }
}

async function listMyReviews(req, res) {
  const [rows] = await pool.execute(
    `SELECT pr.*, p.name AS product_name, p.image, o.order_number
     FROM product_reviews pr
     JOIN products p ON p.id = pr.product_id
     JOIN orders o ON o.id = pr.order_id
     WHERE pr.user_id = ?
     ORDER BY pr.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}

async function listReviewableItems(req, res) {
  const [rows] = await pool.execute(
    `SELECT o.id AS order_id,
            o.order_number,
            o.delivery_status,
            oi.id AS order_item_id,
            oi.product_id,
            oi.product_name,
            oi.image,
            oi.selected_size,
            oi.item_status,
            pr.id AS review_id,
            pr.rating,
            pr.review_text,
            pr.is_hidden,
            pr.created_at AS reviewed_at
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN product_reviews pr ON pr.order_item_id = oi.id
     WHERE o.user_id = ? AND o.delivery_status = 'DELIVERED' AND COALESCE(oi.item_status, 'ACTIVE') <> 'CANCELLED'
     ORDER BY o.created_at DESC, oi.id DESC`,
    [req.user.id]
  );
  res.json(rows);
}

async function updateMyReview(req, res) {
  const rating = Number(req.body.rating);
  const reviewText = String(req.body.reviewText || '').trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
  const [result] = await pool.execute(
    `UPDATE product_reviews
     SET rating = ?, review_text = ?
     WHERE id = ? AND user_id = ?`,
    [rating, reviewText || null, req.params.id, req.user.id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Review not found.' });
  res.json({ message: 'Review updated successfully.' });
}

async function deleteMyReview(req, res) {
  const [result] = await pool.execute('DELETE FROM product_reviews WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Review not found.' });
  res.json({ message: 'Review deleted successfully.' });
}

async function listRequests(req, res) {
  const [rows] = await pool.execute(
    `SELECT pdr.id,
            pdr.order_id,
            pdr.order_item_id,
            pdr.product_id,
            oi.product_name,
            pdr.user_id,
            COALESCE(u.name, CONCAT('Guest ', COALESCE(pdr.guest_contact_value, 'Customer'))) AS customer_name,
            COALESCE(u.email, pdr.guest_contact_value) AS customer_email,
            pdr.guest_contact_type,
            pdr.guest_contact_value,
            pdr.request_type,
            pdr.request_reason,
            pdr.request_status,
            pdr.refund_status,
            pdr.refund_amount,
            pdr.refund_payment_method,
            pdr.refund_transaction_id,
            pdr.refund_processing_at,
            pdr.refund_completed_at,
            pdr.return_picked_up_at,
            pdr.return_completed_at,
            pdr.requested_at,
            pdr.updated_at,
            pdr.admin_remarks
     FROM post_delivery_requests pdr
     JOIN order_items oi ON oi.id = pdr.order_item_id
     LEFT JOIN users u ON u.id = pdr.user_id
     ORDER BY pdr.requested_at DESC`
  );
  res.json(rows);
}

async function updateRequest(req, res) {
  const requestId = Number(req.params.id);
  const requestStatus = String(req.body.requestStatus || '').trim().toUpperCase();
  const refundStatus = req.body.refundStatus ? String(req.body.refundStatus).trim().toUpperCase() : null;
  const adminRemarks = req.body.adminRemarks == null ? null : String(req.body.adminRemarks).trim();
  const refundAmount = req.body.refundAmount === '' || req.body.refundAmount == null ? null : Number(req.body.refundAmount);
  const refundPaymentMethod = req.body.refundPaymentMethod == null ? null : String(req.body.refundPaymentMethod).trim();
  const refundTransactionId = req.body.refundTransactionId == null ? null : String(req.body.refundTransactionId).trim();
  if (!['APPROVED', 'REJECTED', 'REFUNDED', 'PENDING', 'RETURN_PICKED_UP', 'RETURN_COMPLETED'].includes(requestStatus)) {
    return res.status(400).json({ message: 'Invalid request status.' });
  }
  if (refundStatus && !['PENDING', 'PROCESSING', 'COMPLETED', 'REFUNDED', 'NOT_REQUIRED'].includes(refundStatus)) {
    return res.status(400).json({ message: 'Invalid refund status.' });
  }
  if (refundAmount != null && (!Number.isFinite(refundAmount) || refundAmount < 0)) {
    return res.status(400).json({ message: 'Refund amount must be a valid number.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[request]] = await connection.execute(
      `SELECT pdr.*, o.order_number, o.payment_method, o.paid_status, o.total_amount
       FROM post_delivery_requests pdr
       JOIN orders o ON o.id = pdr.order_id
       WHERE pdr.id = ?
       FOR UPDATE`,
      [requestId]
    );
    if (!request) {
      await connection.rollback();
      return res.status(404).json({ message: 'Request not found.' });
    }

    let nextRefundStatus = refundStatus || request.refund_status;
    if (requestStatus === 'REFUNDED' || refundStatus === 'REFUNDED' || refundStatus === 'COMPLETED') {
      if (request.payment_method === 'Wallet' && request.paid_status === 'PAID') {
        const refund = await refundOrder(connection, request);
        if (refund.error) {
          await connection.rollback();
          return res.status(400).json({ message: refund.error });
        }
      }
      await reverseOrderCoins(connection, {
        id: request.order_id,
        order_number: request.order_number,
        user_id: request.user_id
      });
      nextRefundStatus = refundStatus === 'COMPLETED' ? 'COMPLETED' : 'REFUNDED';
    }

    await connection.execute(
      `UPDATE post_delivery_requests
       SET request_status = ?,
           refund_status = ?,
           admin_remarks = COALESCE(?, admin_remarks),
           return_picked_up_at = CASE WHEN ? = 'RETURN_PICKED_UP' AND return_picked_up_at IS NULL THEN NOW() ELSE return_picked_up_at END,
           return_completed_at = CASE WHEN ? IN ('RETURN_COMPLETED', 'REFUNDED') AND return_completed_at IS NULL THEN NOW() ELSE return_completed_at END,
           refund_processing_at = CASE WHEN ? = 'PROCESSING' AND refund_processing_at IS NULL THEN NOW() ELSE refund_processing_at END,
           refund_completed_at = CASE WHEN ? IN ('COMPLETED', 'REFUNDED') AND refund_completed_at IS NULL THEN NOW() ELSE refund_completed_at END,
           refund_amount = COALESCE(?, refund_amount),
           refund_payment_method = COALESCE(?, refund_payment_method),
           refund_transaction_id = COALESCE(?, refund_transaction_id)
       WHERE id = ?`,
      [
        requestStatus,
        nextRefundStatus,
        adminRemarks,
        requestStatus,
        requestStatus,
        nextRefundStatus,
        nextRefundStatus,
        refundAmount,
        refundPaymentMethod || null,
        refundTransactionId || null,
        requestId
      ]
    );
    await connection.commit();
    res.json({ message: 'Request updated.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listReviews(req, res) {
  const [rows] = await pool.execute(
    `SELECT pr.*, p.name AS product_name,
            COALESCE(u.name, CONCAT('Guest ', COALESCE(pr.guest_contact_value, 'Customer'))) AS customer_name,
            COALESCE(u.email, pr.guest_contact_value) AS customer_email,
            o.order_number
     FROM product_reviews pr
     JOIN products p ON p.id = pr.product_id
     LEFT JOIN users u ON u.id = pr.user_id
     JOIN orders o ON o.id = pr.order_id
     ORDER BY pr.created_at DESC`
  );
  res.json(rows);
}

async function toggleReviewVisibility(req, res) {
  await pool.execute('UPDATE product_reviews SET is_hidden = ? WHERE id = ?', [Boolean(req.body.hidden), req.params.id]);
  res.json({ message: Boolean(req.body.hidden) ? 'Review hidden.' : 'Review visible.' });
}

module.exports = {
  createPostDeliveryRequest,
  createReview,
  deleteMyReview,
  listMyReviews,
  listReviewableItems,
  listRequests,
  updateRequest,
  updateMyReview,
  listReviews,
  toggleReviewVisibility
};
