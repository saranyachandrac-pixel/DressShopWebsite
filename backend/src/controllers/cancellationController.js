const pool = require('../config/db');
const { refundOrder } = require('../services/walletService');

const CANCELLABLE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'PROCESSING', 'PLACED', 'PACKED']);
const BLOCKED_STATUSES = new Set(['SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']);

async function cancelOrderItem(req, res) {
  const orderId = Number(req.params.orderId);
  const itemId = Number(req.params.itemId);
  const reason = String(req.body.reason || '').trim();

  if (!orderId || !itemId) return res.status(400).json({ message: 'Order and item are required.' });
  if (!reason) return res.status(400).json({ message: 'Cancellation reason is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [[row]] = await connection.execute(
      `SELECT o.id AS orderId,
              o.user_id AS userId,
              o.order_number,
              o.delivery_status,
              o.payment_method,
              o.paid_status,
              o.total_amount,
              oi.id AS itemId,
              oi.product_id,
              oi.product_name,
              oi.item_status
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = ? AND oi.id = ? AND o.user_id = ?
       FOR UPDATE`,
      [orderId, itemId, req.user.id]
    );

    if (!row) {
      await connection.rollback();
      return res.status(404).json({ message: 'Order item not found.' });
    }
    if (BLOCKED_STATUSES.has(row.delivery_status) || !CANCELLABLE_STATUSES.has(row.delivery_status)) {
      await connection.rollback();
      return res.status(400).json({ message: 'This order can no longer be cancelled.' });
    }
    if (row.item_status === 'CANCELLED') {
      await connection.rollback();
      return res.status(400).json({ message: 'This item is already cancelled.' });
    }

    const refundStatus = row.paid_status === 'PAID' ? 'PENDING' : 'NOT_REQUIRED';
    await connection.execute(
      `INSERT INTO order_cancellations (order_id, order_item_id, product_id, user_id, cancel_reason, refund_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.orderId, row.itemId, row.product_id, row.userId, reason, refundStatus]
    );
    await connection.execute('UPDATE order_items SET item_status = ? WHERE id = ?', ['CANCELLED', row.itemId]);

    const [[remaining]] = await connection.execute(
      `SELECT COUNT(*) AS count
       FROM order_items
       WHERE order_id = ? AND COALESCE(item_status, 'ACTIVE') <> 'CANCELLED'`,
      [row.orderId]
    );

    let nextRefundStatus = refundStatus;
    if (Number(remaining.count) === 0) {
      let nextPaidStatus = row.paid_status;
      if (row.payment_method === 'Wallet' && row.paid_status === 'PAID') {
        const refund = await refundOrder(connection, {
          id: row.orderId,
          order_number: row.order_number,
          user_id: row.userId,
          total_amount: row.total_amount,
          payment_method: row.payment_method
        });
        if (refund.error) {
          await connection.rollback();
          return res.status(400).json({ message: refund.error });
        }
        nextRefundStatus = 'REFUNDED';
        nextPaidStatus = 'REFUNDED';
      }

      await connection.execute(
        'UPDATE orders SET delivery_status = ?, paid_status = ? WHERE id = ?',
        ['CANCELLED', nextPaidStatus, row.orderId]
      );
      await connection.execute(
        'UPDATE order_cancellations SET refund_status = ? WHERE order_id = ?',
        [nextRefundStatus, row.orderId]
      );
    }

    await connection.commit();
    res.status(201).json({ message: 'Item cancelled successfully.' });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This item is already cancelled.' });
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function listCancellations(req, res) {
  const [rows] = await pool.execute(
    `SELECT oc.id AS cancellation_id,
            oc.order_id,
            oc.order_item_id,
            oc.product_id,
            oi.product_name,
            oc.user_id,
            u.name AS customer_name,
            u.email AS customer_email,
            oc.cancel_reason,
            oc.refund_status,
            oc.cancelled_at,
            oc.admin_remarks
     FROM order_cancellations oc
     JOIN order_items oi ON oi.id = oc.order_item_id
     JOIN users u ON u.id = oc.user_id
     ORDER BY oc.cancelled_at DESC`
  );
  res.json(rows);
}

async function updateCancellation(req, res) {
  const refundStatus = req.body.refundStatus ? String(req.body.refundStatus).trim().toUpperCase() : null;
  const adminRemarks = req.body.adminRemarks == null ? null : String(req.body.adminRemarks).trim();
  await pool.execute(
    `UPDATE order_cancellations
     SET refund_status = COALESCE(?, refund_status),
         admin_remarks = COALESCE(?, admin_remarks)
     WHERE id = ?`,
    [refundStatus, adminRemarks, req.params.id]
  );
  res.json({ message: 'Cancellation updated.' });
}

module.exports = { cancelOrderItem, listCancellations, updateCancellation };
