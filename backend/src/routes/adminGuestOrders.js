const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin);

const ORDER_STATUSES = new Set(['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'REACHED_NEARBY_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED']);
const PAYMENT_STATUSES = new Set(['PENDING', 'PAID', 'FAILED', 'REFUNDED']);
let adminGuestTablesReady = false;

async function ensureGuestOrderTables() {
  if (adminGuestTablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_otps (
      id INT PRIMARY KEY AUTO_INCREMENT,
      verification_type ENUM('email','mobile') NOT NULL,
      email VARCHAR(255) NULL,
      mobile VARCHAR(20) NULL,
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      verified TINYINT(1) NOT NULL DEFAULT 0,
      guest_token VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_guest_otps_lookup (verification_type, email, mobile),
      INDEX idx_guest_otps_token (guest_token)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      guest_token VARCHAR(255),
      guest_email VARCHAR(255) NULL,
      guest_mobile VARCHAR(20) NULL,
      guest_name VARCHAR(100) NOT NULL,
      address TEXT NOT NULL,
      pincode VARCHAR(10) NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      payment_method VARCHAR(50) NOT NULL,
      payment_status VARCHAR(50) NOT NULL,
      order_status VARCHAR(50) NOT NULL,
      order_number VARCHAR(100) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_order_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      guest_order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      quantity INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      total_price DECIMAL(10,2) NOT NULL,
      FOREIGN KEY (guest_order_id) REFERENCES guest_orders(id) ON DELETE CASCADE
    )
  `);
  const columns = [
    ['payment_details', 'payment_details TEXT NULL'],
    ['order_number', 'order_number VARCHAR(100) NULL'],
    ['verification_type', 'verification_type VARCHAR(20) NULL'],
    ['delivery_hub_id', 'delivery_hub_id VARCHAR(80) NULL'],
    ['delivery_hub_name', 'delivery_hub_name VARCHAR(255) NULL'],
    ['estimated_delivery_date', 'estimated_delivery_date DATE NULL'],
    ['estimated_delivery_min_days', 'estimated_delivery_min_days INT NULL'],
    ['estimated_delivery_max_days', 'estimated_delivery_max_days INT NULL']
  ];
  for (const [column, definition] of columns) {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guest_orders' AND COLUMN_NAME = ?`,
      [column]
    );
    if (!rows.length) await pool.query(`ALTER TABLE guest_orders ADD COLUMN ${definition}`);
  }
  adminGuestTablesReady = true;
}

function statusFilter(value = '') {
  const normalized = String(value || '').trim().toUpperCase();
  return ORDER_STATUSES.has(normalized) ? normalized : '';
}

function mapOrder(row, items = []) {
  return {
    ...row,
    items,
    orderedProducts: items.map((item) => item.product_name).join(', '),
    contact: row.guest_email || row.guest_mobile || '',
    otpVerifiedType: row.verification_type || (row.guest_email ? 'email' : row.guest_mobile ? 'mobile' : ''),
    deliveryEstimate: row.estimated_delivery_min_days && row.estimated_delivery_max_days
      ? `${row.estimated_delivery_min_days}-${row.estimated_delivery_max_days} days`
      : ''
  };
}

async function orderItemsFor(connection, orderIds) {
  if (!orderIds.length) return new Map();
  const placeholders = orderIds.map(() => '?').join(',');
  const [items] = await connection.execute(
    `SELECT goi.*, p.image, p.image_url
     FROM guest_order_items goi
     LEFT JOIN products p ON p.id = goi.product_id
     WHERE goi.guest_order_id IN (${placeholders})
     ORDER BY goi.id`,
    orderIds
  );
  const byOrder = new Map();
  for (const item of items) {
    const list = byOrder.get(Number(item.guest_order_id)) || [];
    list.push({ ...item, image: item.image_url || item.image });
    byOrder.set(Number(item.guest_order_id), list);
  }
  return byOrder;
}

router.get('/', asyncHandler(async (req, res) => {
  await ensureGuestOrderTables();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(5, Number(req.query.limit || 10)));
  const offset = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const status = statusFilter(req.query.status);
  const where = [];
  const params = [];

  if (status) {
    where.push('go.order_status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(go.guest_name LIKE ? OR go.guest_email LIKE ? OR go.guest_mobile LIKE ? OR CAST(go.id AS CHAR) LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS count FROM guest_orders go ${whereSql}`, params);
  const [orders] = await pool.execute(
    `SELECT go.*
     FROM guest_orders go
     ${whereSql}
     ORDER BY go.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const itemsByOrder = await orderItemsFor(pool, orders.map((order) => Number(order.id)));
  const [[summary]] = await pool.execute(`
    SELECT COUNT(*) AS totalGuestOrders,
           SUM(order_status = 'PLACED') AS pendingGuestOrders,
           SUM(payment_method = 'COD') AS codOrders,
           SUM(payment_method <> 'COD' AND payment_status = 'PAID') AS onlinePaidOrders
    FROM guest_orders
  `);

  res.json({
    orders: orders.map((order) => mapOrder(order, itemsByOrder.get(Number(order.id)) || [])),
    pagination: { page, limit, total: Number(countRow.count || 0), pages: Math.ceil(Number(countRow.count || 0) / limit) },
    summary: {
      totalGuestOrders: Number(summary.totalGuestOrders || 0),
      pendingGuestOrders: Number(summary.pendingGuestOrders || 0),
      codOrders: Number(summary.codOrders || 0),
      onlinePaidOrders: Number(summary.onlinePaidOrders || 0)
    }
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  await ensureGuestOrderTables();
  const [[order]] = await pool.execute('SELECT * FROM guest_orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ message: 'Guest order not found.' });
  const itemsByOrder = await orderItemsFor(pool, [Number(order.id)]);
  res.json(mapOrder(order, itemsByOrder.get(Number(order.id)) || []));
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  await ensureGuestOrderTables();
  const orderStatus = statusFilter(req.body.orderStatus || req.body.order_status);
  const paymentStatus = String(req.body.paymentStatus || req.body.payment_status || '').trim().toUpperCase();
  const hubId = req.body.deliveryHubId ?? req.body.delivery_hub_id;
  const hubName = req.body.deliveryHubName ?? req.body.delivery_hub_name;
  const minDays = req.body.estimatedDeliveryMinDays ?? req.body.estimated_delivery_min_days;
  const maxDays = req.body.estimatedDeliveryMaxDays ?? req.body.estimated_delivery_max_days;
  const estimateDate = req.body.estimatedDeliveryDate ?? req.body.estimated_delivery_date;
  const updates = [];
  const params = [];

  if (orderStatus) {
    updates.push('order_status = ?');
    params.push(orderStatus);
  }
  if (paymentStatus) {
    if (!PAYMENT_STATUSES.has(paymentStatus)) return res.status(400).json({ message: 'Invalid payment status.' });
    updates.push('payment_status = ?');
    params.push(paymentStatus);
  }
  if (hubId !== undefined) {
    updates.push('delivery_hub_id = ?');
    params.push(hubId || null);
  }
  if (hubName !== undefined) {
    updates.push('delivery_hub_name = ?');
    params.push(hubName || null);
  }
  if (minDays !== undefined) {
    updates.push('estimated_delivery_min_days = ?');
    params.push(minDays || null);
  }
  if (maxDays !== undefined) {
    updates.push('estimated_delivery_max_days = ?');
    params.push(maxDays || null);
  }
  if (estimateDate !== undefined) {
    updates.push('estimated_delivery_date = ?');
    params.push(estimateDate || null);
  }

  if (!updates.length) return res.status(400).json({ message: 'No guest order updates provided.' });
  params.push(req.params.id);
  const [result] = await pool.execute(`UPDATE guest_orders SET ${updates.join(', ')} WHERE id = ?`, params);
  if (!result.affectedRows) return res.status(404).json({ message: 'Guest order not found.' });
  const [[guestOrder]] = await pool.execute('SELECT order_number FROM guest_orders WHERE id = ?', [req.params.id]);
  if (guestOrder?.order_number) {
    const trackingUpdates = [];
    const trackingParams = [];
    if (orderStatus) {
      trackingUpdates.push('delivery_status = ?');
      trackingParams.push(orderStatus);
      if (orderStatus === 'DELIVERED') {
        trackingUpdates.push('delivered_at = COALESCE(delivered_at, NOW())', 'delivered_on = COALESCE(delivered_on, NOW())');
      }
    }
    if (paymentStatus) {
      trackingUpdates.push('paid_status = ?', 'payment_status = ?');
      trackingParams.push(paymentStatus, paymentStatus);
    }
    if (hubId !== undefined) {
      trackingUpdates.push('delivery_hub_id = ?', 'selected_hub_id = ?');
      trackingParams.push(hubId || null, hubId || null);
    }
    if (estimateDate !== undefined) {
      trackingUpdates.push('estimated_delivery_date = ?', 'expected_delivery_date = ?');
      trackingParams.push(estimateDate || null, estimateDate || null);
    }
    if (trackingUpdates.length) {
      trackingParams.push(guestOrder.order_number);
      await pool.execute(`UPDATE orders SET ${trackingUpdates.join(', ')} WHERE order_number = ? AND is_guest_order = 1`, trackingParams);
    }
  }
  res.json({ message: 'Guest order updated.' });
}));

module.exports = router;
