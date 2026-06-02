const pool = require('../config/db');
const { refundOrder } = require('../services/walletService');
const { reverseOrderCoins } = require('../services/superCoinService');

const CANCELLABLE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'PROCESSING', 'PLACED', 'PACKED']);
const BLOCKED_STATUSES = new Set(['SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']);
const FINAL_REFUND_STATUSES = new Set(['REFUNDED', 'REJECTED']);

async function ensureCancellationActionSchema(connection = pool) {
  await ensureColumn(connection, 'order_cancellations', 'admin_remarks', 'admin_remarks TEXT NULL');
  await connection.query('ALTER TABLE order_cancellations MODIFY admin_remarks TEXT NULL');
  await ensureColumn(connection, 'order_cancellations', 'action_by', 'action_by VARCHAR(100) NULL');
  await ensureColumn(connection, 'order_cancellations', 'action_date', 'action_date DATETIME NULL');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cancellation_action_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cancellation_id INT NOT NULL,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      old_refund_status VARCHAR(30),
      new_refund_status VARCHAR(30),
      admin_remarks TEXT,
      action_by VARCHAR(100),
      action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cancellation_action_logs_cancellation (cancellation_id),
      FOREIGN KEY (cancellation_id) REFERENCES order_cancellations(id) ON DELETE CASCADE
    )
  `);
}

async function ensureColumn(connection, table, column, definition) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

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
      await reverseOrderCoins(connection, {
        id: row.orderId,
        order_number: row.order_number,
        user_id: row.userId
      });
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
  await ensureCancellationActionSchema();
  const [rows] = await pool.execute(
    `SELECT oc.id AS cancellation_id,
            oc.order_id,
            oc.order_item_id,
            oc.product_id,
            oi.product_name,
            oc.user_id,
            COALESCE(u.name, CONCAT('Guest ', COALESCE(oc.guest_contact_value, 'Customer'))) AS customer_name,
            COALESCE(u.email, oc.guest_contact_value) AS customer_email,
            oc.guest_contact_type,
            oc.guest_contact_value,
            oc.cancel_reason,
            oc.refund_status,
            oc.cancelled_at,
            oc.admin_remarks,
            oc.action_by,
            oc.action_date
     FROM order_cancellations oc
     JOIN order_items oi ON oi.id = oc.order_item_id
     LEFT JOIN users u ON u.id = oc.user_id
     ORDER BY oc.cancelled_at DESC`
  );
  res.json(rows);
}

async function updateCancellation(req, res) {
  await ensureCancellationActionSchema();
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

async function actionCancellation(req, res) {
  await ensureCancellationActionSchema();
  const cancellationId = Number(req.params.id);
  const refundStatus = String(req.body.refund_status || req.body.refundStatus || '').trim().toUpperCase();
  const adminRemarks = String(req.body.admin_remarks || req.body.adminRemarks || '').trim();
  if (!cancellationId) return res.status(400).json({ message: 'Cancellation ID is required.' });
  if (!['REFUNDED', 'REJECTED'].includes(refundStatus)) {
    return res.status(400).json({ message: 'Refund status must be REFUNDED or REJECTED.' });
  }

  const actionBy = req.user?.name || req.user?.email || `Admin ${req.user?.id || ''}`.trim();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[cancellation]] = await connection.execute(
      `SELECT id, order_id, product_id, refund_status
       FROM order_cancellations
       WHERE id = ?
       FOR UPDATE`,
      [cancellationId]
    );
    if (!cancellation) {
      await connection.rollback();
      return res.status(404).json({ message: 'Cancellation not found.' });
    }
    const oldRefundStatus = String(cancellation.refund_status || '').toUpperCase();
    if (FINAL_REFUND_STATUSES.has(oldRefundStatus)) {
      await connection.rollback();
      return res.status(409).json({ message: `Refund already ${oldRefundStatus}.` });
    }

    await connection.execute(
      `UPDATE order_cancellations
       SET refund_status = ?,
           admin_remarks = ?,
           action_by = ?,
           action_date = NOW()
       WHERE id = ?`,
      [refundStatus, adminRemarks || null, actionBy, cancellationId]
    );
    await connection.execute(
      `INSERT INTO cancellation_action_logs
        (cancellation_id, order_id, product_id, old_refund_status, new_refund_status, admin_remarks, action_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cancellationId, cancellation.order_id, cancellation.product_id, oldRefundStatus || null, refundStatus, adminRemarks || null, actionBy]
    );
    await connection.commit();
    res.json({ message: refundStatus === 'REFUNDED' ? 'Refund approved.' : 'Refund rejected.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { actionCancellation, cancelOrderItem, listCancellations, updateCancellation };
