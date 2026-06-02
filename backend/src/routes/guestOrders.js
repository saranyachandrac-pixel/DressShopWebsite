const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { sendGuestOtp } = require('../services/mail');
const { buildTrackingEvents } = require('../utils/trackingEvents');

const router = express.Router();
const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;
const TRACKING_TOKEN_MINUTES = 15;
const TRACKING_JWT_AUDIENCE = 'guest-order-tracking';
const OTP_PURPOSE = 'GUEST_ORDER_TRACKING';
const GENERIC_OTP_MESSAGE = 'If orders exist for this contact, OTP has been sent.';

let schemaReady = false;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function normalizeOrderNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function contactParts(value) {
  const raw = String(value || '').trim();
  const email = normalizeEmail(raw);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { type: 'email', value: email };

  const mobile = normalizeMobile(raw);
  if (/^[6-9]\d{9}$/.test(mobile)) return { type: 'mobile', value: mobile };

  return null;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function devOtpPayload(otp) {
  return process.env.NODE_ENV === 'production' ? {} : { devOtp: otp };
}

async function ensureGuestOrderTrackingSchema(connection = pool) {
  if (schemaReady) return;

  const orderColumns = [
    ['guest_name', 'guest_name VARCHAR(100) NULL'],
    ['guest_email', 'guest_email VARCHAR(255) NULL'],
    ['guest_mobile', 'guest_mobile VARCHAR(20) NULL'],
    ['payment_status', 'payment_status VARCHAR(50) NULL'],
    ['expected_delivery_date', 'expected_delivery_date DATE NULL'],
    ['delivery_hub_id', 'delivery_hub_id CHAR(36) NULL'],
    ['courier_partner', 'courier_partner VARCHAR(120) NULL'],
    ['tracking_token', 'tracking_token VARCHAR(255) NULL'],
    ['is_guest_order', 'is_guest_order TINYINT(1) NOT NULL DEFAULT 0']
  ];

  for (const [column, definition] of orderColumns) {
    const [rows] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = ?`,
      [column]
    );
    if (!rows.length) await connection.query(`ALTER TABLE orders ADD COLUMN ${definition}`);
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS guest_tracking_otps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contact VARCHAR(150) NOT NULL,
      contact_type ENUM('email','mobile') NOT NULL,
      purpose VARCHAR(50) NOT NULL DEFAULT 'GUEST_ORDER_TRACKING',
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT DEFAULT 0,
      verified_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_guest_tracking_otps_contact (contact_type, contact, purpose, created_at)
    )
  `);
  const [purposeRows] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guest_tracking_otps' AND COLUMN_NAME = 'purpose'`
  );
  if (!purposeRows.length) {
    await connection.query("ALTER TABLE guest_tracking_otps ADD COLUMN purpose VARCHAR(50) NOT NULL DEFAULT 'GUEST_ORDER_TRACKING' AFTER contact_type");
  }
  await connection.query('ALTER TABLE order_cancellations MODIFY user_id INT NULL');
  await connection.query('ALTER TABLE post_delivery_requests MODIFY user_id INT NULL');
  await connection.query('ALTER TABLE product_reviews MODIFY user_id INT NULL');
  await ensureColumn(connection, 'order_cancellations', 'guest_contact_type', 'guest_contact_type VARCHAR(20) NULL');
  await ensureColumn(connection, 'order_cancellations', 'guest_contact_value', 'guest_contact_value VARCHAR(150) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'guest_contact_type', 'guest_contact_type VARCHAR(20) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'guest_contact_value', 'guest_contact_value VARCHAR(150) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_amount', 'refund_amount DECIMAL(10,2) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_payment_method', 'refund_payment_method VARCHAR(80) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_transaction_id', 'refund_transaction_id VARCHAR(120) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_processing_at', 'refund_processing_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_completed_at', 'refund_completed_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'return_picked_up_at', 'return_picked_up_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'return_completed_at', 'return_completed_at DATETIME NULL');
  await ensureColumn(connection, 'product_reviews', 'guest_contact_type', 'guest_contact_type VARCHAR(20) NULL');
  await ensureColumn(connection, 'product_reviews', 'guest_contact_value', 'guest_contact_value VARCHAR(150) NULL');

  schemaReady = true;
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

async function sendMobileOtp(mobile, otp) {
  if (process.env.SMS_PROVIDER_URL && process.env.SMS_API_KEY) {
    console.log(`SMS provider is configured for ${mobile}, but provider integration is not customized in this project.`);
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Guest order tracking mobile OTP for ${mobile}: ${otp}`);
  }
}

function orderContactWhere(contact) {
  if (contact.type === 'email') {
    return { sql: 'LOWER(o.guest_email) = ?', params: [contact.value] };
  }
  return { sql: "(o.guest_mobile = ? OR RIGHT(COALESCE(o.guest_mobile, ''), 10) = ?)", params: [contact.value, contact.value] };
}

async function guestOrderCountByContact(connection, contact) {
  const where = orderContactWhere(contact);
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM orders o
     WHERE o.is_guest_order = 1 AND ${where.sql}`,
    where.params
  );
  return Number(row?.count || 0);
}

async function listGuestOrdersByContact(connection, contact) {
  const where = orderContactWhere(contact);
  const [orders] = await connection.execute(
    `SELECT o.order_number,
            o.created_at,
            o.total_amount,
            o.payment_status,
            o.paid_status,
            o.delivery_status,
            o.expected_delivery_date,
            o.estimated_delivery_date,
            ot.estimated_delivery_date AS tracking_estimated_delivery_date
     FROM orders o
     LEFT JOIN order_tracking ot ON ot.order_id = o.id
     WHERE o.is_guest_order = 1 AND ${where.sql}
     ORDER BY o.created_at DESC`,
    where.params
  );

  return orders.map((order) => ({
    orderNumber: order.order_number,
    orderDate: order.created_at,
    totalPaid: Number(order.total_amount || 0),
    paymentStatus: order.payment_status || order.paid_status || 'PENDING',
    deliveryStatus: order.delivery_status || 'PLACED',
    expectedDeliveryDate: order.expected_delivery_date || order.tracking_estimated_delivery_date || order.estimated_delivery_date || null
  }));
}

async function findGuestOrderForContact(connection, orderNumber, contact) {
  const where = orderContactWhere(contact);
  const [[order]] = await connection.execute(
    `SELECT o.*,
            ot.delivery_hub_id AS tracking_delivery_hub_id,
            ot.delivery_hub_name,
            ot.estimated_delivery_date AS tracking_estimated_delivery_date
     FROM orders o
     LEFT JOIN order_tracking ot ON ot.order_id = o.id
     WHERE o.is_guest_order = 1
       AND UPPER(o.order_number) = ?
       AND ${where.sql}
     LIMIT 1`,
    [normalizeOrderNumber(orderNumber), ...where.params]
  );
  return order || null;
}

function addDays(dateValue, days) {
  const date = new Date(dateValue);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function itemActionFlags(order, item) {
  const deliveryStatus = String(order.delivery_status || '').toUpperCase();
  const itemStatus = String(item.item_status || 'ACTIVE').toUpperCase();
  const deliveredAt = order.delivered_at || order.delivered_on || null;
  const returnDays = Math.max(0, Number(item.return_days || item.replacement_days || 0));
  const returnWindowEndsAt = deliveredAt && returnDays > 0 ? addDays(deliveredAt, returnDays) : null;
  const itemBlocked = ['CANCELLED', 'RETURNED', 'REFUNDED'].includes(itemStatus);
  const requestStatus = String(item.request_status || '').toUpperCase();
  const refundStatus = String(item.post_delivery_refund_status || '').toUpperCase();
  const hasBlockingRequest = Boolean(item.post_delivery_request_id) && requestStatus !== 'REJECTED';
  const hasClosedRefund = ['PROCESSING', 'COMPLETED', 'REFUNDED'].includes(refundStatus) || ['REFUNDED', 'RETURN_COMPLETED'].includes(requestStatus);
  return {
    canCancel: ['PLACED', 'CONFIRMED', 'PROCESSING'].includes(deliveryStatus) && !itemBlocked,
    canReturn: deliveryStatus === 'DELIVERED'
      && !itemBlocked
      && returnDays > 0
      && returnWindowEndsAt
      && returnWindowEndsAt >= new Date()
      && !hasBlockingRequest
      && !hasClosedRefund,
    returnWindowEndsAt: returnWindowEndsAt ? returnWindowEndsAt.toISOString() : null
  };
}

async function getGuestOrderItems(connection, orderId, order) {
  const [items] = await connection.execute(
    `SELECT oi.id AS order_item_id,
            oi.product_id,
            oi.product_name,
            oi.quantity,
            oi.price,
            oi.selected_size,
            oi.image AS item_image,
            oi.item_status,
            oi.return_days,
            oi.replacement_days,
            p.name AS current_product_name,
            p.image AS product_image,
            p.image_url,
            oc.id AS cancellation_id,
            oc.cancel_reason,
            oc.refund_status,
            oc.cancelled_at,
            pdr.id AS post_delivery_request_id,
            pdr.request_type,
            pdr.request_reason,
            pdr.request_status,
            pdr.refund_status AS post_delivery_refund_status,
            pdr.refund_amount,
            pdr.refund_payment_method,
            pdr.refund_transaction_id,
            pdr.refund_processing_at,
            pdr.refund_completed_at,
            pdr.return_picked_up_at,
            pdr.return_completed_at,
            pdr.requested_at,
            pdr.updated_at
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN order_cancellations oc ON oc.order_item_id = oi.id
     LEFT JOIN post_delivery_requests pdr ON pdr.order_item_id = oi.id
     WHERE oi.order_id = ?
     ORDER BY oi.id`,
    [orderId]
  );

  return items.map((item) => ({
    orderItemId: item.order_item_id,
    productId: item.product_id,
    productName: item.product_name || item.current_product_name,
    image: item.item_image || item.image_url || item.product_image || '',
    quantity: Number(item.quantity || 0),
    eachAmount: Number(item.price || 0),
    totalAmount: Number(item.price || 0) * Number(item.quantity || 0),
    selectedSize: item.selected_size || '',
    itemStatus: item.item_status || 'ACTIVE',
    cancellationId: item.cancellation_id || null,
    cancelReason: item.cancel_reason || '',
    refundStatus: item.refund_status || '',
    cancelledAt: item.cancelled_at || null,
    postDeliveryRequestId: item.post_delivery_request_id || null,
    requestType: item.request_type || '',
    requestReason: item.request_reason || '',
    requestStatus: item.request_status || '',
    postDeliveryRefundStatus: item.post_delivery_refund_status || '',
    refundAmount: item.refund_amount == null ? null : Number(item.refund_amount),
    refundPaymentMethod: item.refund_payment_method || '',
    refundTransactionId: item.refund_transaction_id || '',
    refundProcessingAt: item.refund_processing_at || null,
    refundCompletedAt: item.refund_completed_at || null,
    returnPickedUpAt: item.return_picked_up_at || null,
    returnCompletedAt: item.return_completed_at || null,
    requestedAt: item.requested_at || null,
    updatedAt: item.updated_at || null,
    request_type: item.request_type || '',
    cancellation_id: item.cancellation_id || null,
    cancel_reason: item.cancel_reason || '',
    refund_status: item.refund_status || '',
    cancelled_at: item.cancelled_at || null,
    request_reason: item.request_reason || '',
    request_status: item.request_status || '',
    post_delivery_refund_status: item.post_delivery_refund_status || '',
    refund_amount: item.refund_amount == null ? null : Number(item.refund_amount),
    refund_payment_method: item.refund_payment_method || '',
    refund_transaction_id: item.refund_transaction_id || '',
    refund_processing_at: item.refund_processing_at || null,
    refund_completed_at: item.refund_completed_at || null,
    return_picked_up_at: item.return_picked_up_at || null,
    return_completed_at: item.return_completed_at || null,
    requested_at: item.requested_at || null,
    updated_at: item.updated_at || null,
    replacementDays: Number(item.replacement_days || 0),
    ...itemActionFlags(order, item)
  }));
}

function statusSteps(status) {
  const normalized = String(status || '').toUpperCase();
  const regular = ['ORDER_CONFIRMED', 'PACKED', 'SHIPPED', 'REACHED_NEARBY_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  const terminal = ['CANCELLED', 'RETURNED'];
  if (terminal.includes(normalized)) {
    return [...regular.slice(0, 1), normalized].map((step) => ({ key: step, label: labelForStep(step), state: 'completed' }));
  }

  const aliases = {
    PLACED: 'ORDER_CONFIRMED',
    CONFIRMED: 'ORDER_CONFIRMED',
    ORDER_CONFIRMED: 'ORDER_CONFIRMED',
    PACKED: 'PACKED',
    SHIPPED: 'SHIPPED',
    REACHED_NEARBY_HUB: 'REACHED_NEARBY_HUB',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED'
  };
  const active = aliases[normalized] || 'ORDER_CONFIRMED';
  const activeIndex = regular.indexOf(active);

  return regular.map((step, index) => ({
    key: step,
    label: labelForStep(step),
    state: index < activeIndex ? 'completed' : index === activeIndex ? 'current' : 'pending'
  }));
}

function labelForStep(step) {
  return {
    ORDER_CONFIRMED: 'Order Confirmed',
    PACKED: 'Packed',
    SHIPPED: 'Shipped',
    REACHED_NEARBY_HUB: 'Reached Nearby Hub',
    OUT_FOR_DELIVERY: 'Out For Delivery',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    RETURNED: 'Returned'
  }[step] || step;
}

function safeTrackingOrder(order) {
  const deliveryStatus = order.delivery_status || 'PLACED';
  return {
    orderNumber: order.order_number,
    orderDate: order.created_at,
    customerName: order.guest_name || 'Guest Customer',
    totalPaid: Number(order.total_amount || 0),
    paymentStatus: order.payment_status || order.paid_status || 'PENDING',
    deliveryStatus,
    expectedDeliveryDate: order.expected_delivery_date || order.tracking_estimated_delivery_date || order.estimated_delivery_date || null,
    deliveryHub: order.delivery_hub_name || order.delivery_hub_id || order.tracking_delivery_hub_id || order.selected_hub_id || '',
    courierPartner: order.courier_partner || 'DressShop Delivery',
    timeline: statusSteps(deliveryStatus),
    tracking_events: buildTrackingEvents(order, order.items || []),
    items: order.items || []
  };
}

async function loadOwnedGuestOrderWithItem(connection, { orderNumber, itemId, contact, lock = true }) {
  const where = orderContactWhere(contact);
  const [[row]] = await connection.execute(
    `SELECT o.*,
            oi.id AS order_item_id,
            oi.product_id,
            oi.product_name,
            oi.price,
            oi.image,
            oi.item_status,
            oi.return_days,
            oi.replacement_days
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.is_guest_order = 1
       AND UPPER(o.order_number) = ?
       AND oi.id = ?
       AND ${where.sql}
     ${lock ? 'FOR UPDATE' : ''}`,
    [normalizeOrderNumber(orderNumber), Number(itemId), ...where.params]
  );
  return row || null;
}

function trackingTokenFromRequest(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function verifyTrackingToken(req, res) {
  const token = trackingTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ message: 'Guest tracking token is required.' });
    return null;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret', { audience: TRACKING_JWT_AUDIENCE });
    if (payload.purpose !== TRACKING_JWT_AUDIENCE || !payload.contact || !payload.contactType) {
      res.status(401).json({ message: 'Invalid or expired guest tracking token.' });
      return null;
    }
    return { type: payload.contactType, value: payload.contact };
  } catch {
    res.status(401).json({ message: 'Invalid or expired guest tracking token.' });
    return null;
  }
}

router.post('/send-otp', asyncHandler(async (req, res) => {
  await ensureGuestOrderTrackingSchema();
  const rawContact = String(req.body.contact || '').trim();
  if (!rawContact) return res.status(400).json({ message: 'Email ID or mobile number is required.' });
  const contact = contactParts(rawContact);
  if (!contact) return res.status(400).json({ message: 'Enter a valid email ID or mobile number.' });

  const orderCount = await guestOrderCountByContact(pool, contact);
  if (orderCount < 1) {
    return res.status(200).json({ message: GENERIC_OTP_MESSAGE });
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  await pool.execute(
    `INSERT INTO guest_tracking_otps (contact, contact_type, purpose, otp_hash, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [contact.value, contact.type, OTP_PURPOSE, otpHash, OTP_EXPIRY_MINUTES]
  );

  if (contact.type === 'email') await sendGuestOtp(contact.value, otp);
  else await sendMobileOtp(contact.value, otp);

  res.status(201).json({
    success: true,
    message: 'OTP sent successfully.',
    expiresIn: OTP_EXPIRY_MINUTES * 60,
    ...devOtpPayload(otp)
  });
}));

router.post('/verify-otp', asyncHandler(async (req, res) => {
  await ensureGuestOrderTrackingSchema();
  const rawContact = String(req.body.contact || '').trim();
  if (!rawContact) return res.status(400).json({ message: 'Email ID or mobile number is required.' });
  const contact = contactParts(rawContact);
  const otp = String(req.body.otp || '').trim();
  if (!contact) return res.status(400).json({ message: 'Enter a valid email ID or mobile number.' });
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ message: 'Enter the 6 digit OTP.' });

  const [[otpRow]] = await pool.execute(
    `SELECT *
     FROM guest_tracking_otps
     WHERE contact_type = ? AND contact = ? AND purpose = ? AND verified_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [contact.type, contact.value, OTP_PURPOSE]
  );

  if (!otpRow) return res.status(404).json({ message: 'OTP not found. Please request a new OTP.' });
  if (new Date(otpRow.expires_at).getTime() < Date.now()) return res.status(400).json({ message: 'OTP expired. Please request a new OTP.' });
  if (Number(otpRow.attempts || 0) >= MAX_OTP_ATTEMPTS) return res.status(429).json({ message: 'Maximum OTP attempts reached. Please request a new OTP.' });

  const valid = await bcrypt.compare(otp, otpRow.otp_hash);
  if (!valid) {
    await pool.execute('UPDATE guest_tracking_otps SET attempts = attempts + 1 WHERE id = ?', [otpRow.id]);
    return res.status(400).json({ message: 'Invalid OTP.' });
  }

  await pool.execute('UPDATE guest_tracking_otps SET verified_at = NOW() WHERE id = ?', [otpRow.id]);
  const token = jwt.sign(
    { contact: contact.value, contactType: contact.type, purpose: TRACKING_JWT_AUDIENCE },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: `${TRACKING_TOKEN_MINUTES}m`, audience: TRACKING_JWT_AUDIENCE }
  );

  res.json({ message: 'OTP verified successfully.', token, expiresIn: TRACKING_TOKEN_MINUTES * 60 });
}));

router.get('/my-orders', asyncHandler(async (req, res) => {
  await ensureGuestOrderTrackingSchema();
  const contact = verifyTrackingToken(req, res);
  if (!contact) return;

  const orders = await listGuestOrdersByContact(pool, contact);
  res.json({ orders });
}));

router.get('/track/:orderNumber', asyncHandler(async (req, res) => {
  await ensureGuestOrderTrackingSchema();
  const contact = verifyTrackingToken(req, res);
  if (!contact) return;

  const order = await findGuestOrderForContact(pool, req.params.orderNumber, contact);
  if (!order) return res.status(404).json({ message: 'Order not found for this contact.' });
  order.items = await getGuestOrderItems(pool, order.id, order);

  res.json(safeTrackingOrder(order));
}));

router.post('/track/:orderNumber/items/:itemId/cancel', asyncHandler(async (req, res) => {
  await ensureGuestOrderTrackingSchema();
  const contact = verifyTrackingToken(req, res);
  if (!contact) return;

  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Cancellation reason is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await loadOwnedGuestOrderWithItem(connection, {
      orderNumber: req.params.orderNumber,
      itemId: req.params.itemId,
      contact
    });
    if (!row) {
      await connection.rollback();
      return res.status(404).json({ message: 'Order item not found.' });
    }

    const deliveryStatus = String(row.delivery_status || '').toUpperCase();
    if (!['PLACED', 'CONFIRMED', 'PROCESSING'].includes(deliveryStatus)) {
      await connection.rollback();
      return res.status(400).json({ message: 'This order can no longer be cancelled.' });
    }
    if (String(row.item_status || 'ACTIVE').toUpperCase() === 'CANCELLED') {
      await connection.rollback();
      return res.status(400).json({ message: 'This item is already cancelled.' });
    }

    const refundStatus = row.paid_status === 'PAID' ? 'PENDING' : 'NOT_REQUIRED';
    await connection.execute(
      `INSERT INTO order_cancellations (order_id, order_item_id, product_id, user_id, cancel_reason, refund_status, guest_contact_type, guest_contact_value)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      [row.id, row.order_item_id, row.product_id, reason, refundStatus, contact.type, contact.value]
    );
    await connection.execute('UPDATE order_items SET item_status = ? WHERE id = ?', ['CANCELLED', row.order_item_id]);

    const [[remaining]] = await connection.execute(
      `SELECT COUNT(*) AS count
       FROM order_items
       WHERE order_id = ? AND COALESCE(item_status, 'ACTIVE') <> 'CANCELLED'`,
      [row.id]
    );
    if (Number(remaining.count) === 0) {
      await connection.execute('UPDATE orders SET delivery_status = ? WHERE id = ?', ['CANCELLED', row.id]);
    }

    await connection.commit();
    res.status(201).json({ message: 'Item cancelled successfully.' });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This item is already cancelled.' });
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/track/:orderNumber/items/:itemId/return', asyncHandler(async (req, res) => {
  await ensureGuestOrderTrackingSchema();
  const contact = verifyTrackingToken(req, res);
  if (!contact) return;

  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Return reason is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await loadOwnedGuestOrderWithItem(connection, {
      orderNumber: req.params.orderNumber,
      itemId: req.params.itemId,
      contact
    });
    if (!row) {
      await connection.rollback();
      return res.status(404).json({ message: 'Order item not found.' });
    }
    if (String(row.delivery_status || '').toUpperCase() !== 'DELIVERED') {
      await connection.rollback();
      return res.status(400).json({ message: 'Return is available only after delivery.' });
    }
    if (String(row.item_status || 'ACTIVE').toUpperCase() === 'CANCELLED') {
      await connection.rollback();
      return res.status(400).json({ message: 'Cancelled items cannot be returned.' });
    }

    const deliveredAt = row.delivered_at || row.delivered_on;
    const replacementDays = Math.max(0, Number(row.replacement_days || 0));
    const endsAt = deliveredAt && replacementDays > 0 ? addDays(deliveredAt, replacementDays) : null;
    if (!endsAt || endsAt < new Date()) {
      await connection.rollback();
      return res.status(400).json({ message: 'Return period has expired for this item.' });
    }

    await connection.execute(
      `INSERT INTO post_delivery_requests (order_id, order_item_id, product_id, user_id, request_type, request_reason, guest_contact_type, guest_contact_value)
       VALUES (?, ?, ?, NULL, 'RETURN', ?, ?, ?)`,
      [row.id, row.order_item_id, row.product_id, reason, contact.type, contact.value]
    );
    await connection.commit();
    res.status(201).json({ message: 'Return request submitted successfully.' });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A request already exists for this item.' });
    throw error;
  } finally {
    connection.release();
  }
}));

module.exports = router;
