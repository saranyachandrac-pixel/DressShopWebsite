const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { money } = require('../utils/format');
const { mapSaleProduct } = require('../utils/sale');
const { sendGuestOtp } = require('../services/mail');
const { reserveHubStock, validatePincode } = require('../controllers/deliveryController');

const router = express.Router();
const OTP_EXPIRY_MINUTES = 5;
const OTP_RESEND_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;
const TOKEN_EXPIRY_MINUTES = 30;

let guestTablesReady = false;

async function ensureGuestTables(connection = pool) {
  if (guestTablesReady) return;
  await connection.query(`
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
  await connection.query(`
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
      payment_details TEXT NULL,
      payment_status VARCHAR(50) NOT NULL,
      order_status VARCHAR(50) NOT NULL,
      order_number VARCHAR(100) NULL,
      verification_type VARCHAR(20) NULL,
      delivery_hub_id VARCHAR(80) NULL,
      delivery_hub_name VARCHAR(255) NULL,
      estimated_delivery_date DATE NULL,
      estimated_delivery_min_days INT NULL,
      estimated_delivery_max_days INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await connection.query(`
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
    const [rows] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guest_orders' AND COLUMN_NAME = ?`,
      [column]
    );
    if (!rows.length) await connection.query(`ALTER TABLE guest_orders ADD COLUMN ${definition}`);
  }
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
  await connection.query('ALTER TABLE orders MODIFY user_id INT NULL');
  await connection.query('ALTER TABLE orders MODIFY address_id INT NULL');
  guestTablesReady = true;
}

function normalizeType(value) {
  const type = String(value || '').trim().toLowerCase();
  return type === 'email' || type === 'mobile' ? type : '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function validateContact(body = {}) {
  const type = normalizeType(body.type);
  if (!type) return { error: 'Choose Email or Mobile OTP verification.' };
  if (type === 'email') {
    const email = normalizeEmail(body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
    return { type, email, mobile: null };
  }
  const mobile = normalizeMobile(body.mobile);
  if (!/^[6-9]\d{9}$/.test(mobile)) return { error: 'Enter a valid Indian mobile number.' };
  return { type, email: null, mobile };
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function devOtpPayload(otp) {
  return process.env.NODE_ENV === 'production' ? {} : { otp };
}

async function sendMobileOtp(mobile, otp) {
  if (process.env.SMS_PROVIDER_URL && process.env.SMS_API_KEY) {
    console.log(`SMS provider is configured for ${mobile}, but provider integration is not customized in this project.`);
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Guest mobile OTP for ${mobile}: ${otp}`);
  }
}

function contactWhere(contact) {
  if (contact.type === 'email') return { sql: 'verification_type = ? AND email = ?', params: [contact.type, contact.email] };
  return { sql: 'verification_type = ? AND mobile = ?', params: [contact.type, contact.mobile] };
}

router.post('/send-otp', asyncHandler(async (req, res) => {
  await ensureGuestTables();
  const contact = validateContact(req.body);
  if (contact.error) return res.status(400).json({ message: contact.error });

  const where = contactWhere(contact);
  const [recentRows] = await pool.execute(
    `SELECT id, created_at
     FROM guest_otps
     WHERE ${where.sql} AND verified = 0
     ORDER BY created_at DESC
     LIMIT 1`,
    where.params
  );
  const recent = recentRows[0];
  if (recent) {
    const elapsedSeconds = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsedSeconds < OTP_RESEND_SECONDS) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil(OTP_RESEND_SECONDS - elapsedSeconds)} seconds before resending OTP.`,
        retryAfter: Math.ceil(OTP_RESEND_SECONDS - elapsedSeconds)
      });
    }
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  await pool.execute(
    `INSERT INTO guest_otps (verification_type, email, mobile, otp_hash, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [contact.type, contact.email, contact.mobile, otpHash, OTP_EXPIRY_MINUTES]
  );

  if (contact.type === 'email') await sendGuestOtp(contact.email, otp);
  else await sendMobileOtp(contact.mobile, otp);

  res.status(201).json({
    message: 'OTP sent successfully.',
    resendAfter: OTP_RESEND_SECONDS,
    expiresIn: OTP_EXPIRY_MINUTES * 60,
    ...devOtpPayload(otp)
  });
}));

router.post('/verify-otp', asyncHandler(async (req, res) => {
  await ensureGuestTables();
  const contact = validateContact(req.body);
  if (contact.error) return res.status(400).json({ message: contact.error });
  const otp = String(req.body.otp || '').trim();
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ message: 'Enter the 6 digit OTP.' });

  const where = contactWhere(contact);
  const [rows] = await pool.execute(
    `SELECT *
     FROM guest_otps
     WHERE ${where.sql} AND verified = 0
     ORDER BY created_at DESC
     LIMIT 1`,
    where.params
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ message: 'OTP not found. Please request a new OTP.' });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ message: 'OTP expired. Please request a new OTP.' });
  }
  if (Number(row.attempts || 0) >= MAX_OTP_ATTEMPTS) {
    return res.status(429).json({ message: 'Maximum OTP attempts reached. Please request a new OTP.' });
  }

  const valid = await bcrypt.compare(otp, row.otp_hash);
  if (!valid) {
    await pool.execute('UPDATE guest_otps SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    return res.status(400).json({ message: 'Invalid OTP.' });
  }

  const guestToken = crypto.randomBytes(32).toString('hex');
  await pool.execute(
    `UPDATE guest_otps
     SET verified = 1, guest_token = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
     WHERE id = ?`,
    [guestToken, TOKEN_EXPIRY_MINUTES, row.id]
  );

  res.json({
    message: 'OTP verified successfully.',
    guestToken,
    type: contact.type,
    email: contact.email,
    mobile: contact.mobile,
    expiresIn: TOKEN_EXPIRY_MINUTES * 60
  });
}));

async function getVerifiedGuest(connection, guestToken) {
  const token = String(guestToken || '').trim();
  if (!token) return null;
  const [[guest]] = await connection.execute(
    `SELECT *
     FROM guest_otps
     WHERE guest_token = ? AND verified = 1 AND expires_at > NOW()
     ORDER BY updated_at DESC
     LIMIT 1
     FOR UPDATE`,
    [token]
  );
  return guest || null;
}

function normalizeCartItems(items = []) {
  return items
    .map((item) => ({
      productId: Number(item.productId || item.product_id || item.id),
      quantity: Math.max(1, Number(item.quantity || 1)),
      size: String(item.size || item.selected_size || '').trim()
    }))
    .filter((item) => item.productId && item.quantity > 0);
}

function digitsOnly(value = '') {
  return String(value).replace(/\D/g, '');
}

function normalizePaymentMethod(value = '') {
  const method = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (method === 'CASH_ON_DELIVERY') return 'COD';
  return ['COD', 'UPI', 'CREDIT_CARD', 'DEBIT_CARD'].includes(method) ? method : '';
}

function validatePayment(method, details = {}) {
  if (method === 'COD') return '';
  if (method === 'UPI') {
    return /^[\w.-]+@[\w.-]+$/.test(String(details.upiId || '').trim())
      ? ''
      : 'Enter a valid UPI ID.';
  }
  if (method === 'CREDIT_CARD' || method === 'DEBIT_CARD') {
    if (digitsOnly(details.cardNumber).length < 13) return 'Enter a valid card number.';
    if (!String(details.cardHolder || '').trim()) return 'Enter the card holder name.';
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(String(details.expiry || '').trim())) return 'Enter expiry in MM/YY format.';
    if (digitsOnly(details.cvv).length < 3) return 'Enter a valid CVV.';
  }
  return '';
}

function guestSummary(items) {
  const productPrice = money(items.reduce((sum, item) => sum + Number(item.originalPrice || item.price) * item.quantity, 0));
  const discountAmount = money(items.reduce((sum, item) => sum + (Number(item.originalPrice || item.price) - Number(item.effectivePrice || item.price)) * item.quantity, 0));
  const subtotal = money(productPrice - discountAmount);
  const tax = money(subtotal * 0.05);
  const deliveryCharge = subtotal > 1999 || subtotal === 0 ? 0 : 99;
  const total = money(subtotal + tax + deliveryCharge);
  return { productPrice, discountAmount, subtotal, tax, deliveryCharge, total };
}

async function guestItemPolicyDays(connection, product) {
  if (Number(product.is_replacement_available) === 0) return 0;
  const productDays = Number(product.replacement_days || 0);
  if (productDays > 0) return productDays;
  const [[setting]] = await connection.execute(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'default_replacement_days' LIMIT 1"
  );
  const defaultDays = Number(setting?.setting_value || 7);
  return Math.max(0, Number.isFinite(defaultDays) ? defaultDays : 7);
}

async function generateGuestOrderNumber(connection) {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [[countRow]] = await connection.execute(
      `SELECT COUNT(*) AS count
       FROM orders
       WHERE order_number LIKE ?`,
      [`ORD${datePart}%`]
    );
    const sequence = String(Number(countRow.count || 0) + attempt + 1).padStart(4, '0');
    const nextOrderNumber = `ORD${datePart}${sequence}`;
    const [[existing]] = await connection.execute(
      `SELECT order_number FROM orders WHERE order_number = ?
       UNION
       SELECT order_number FROM guest_orders WHERE order_number = ?
       LIMIT 1`,
      [nextOrderNumber, nextOrderNumber]
    );
    if (!existing) return nextOrderNumber;
  }

  return `ORD${datePart}${Date.now().toString().slice(-6)}`;
}

router.post('/orders', asyncHandler(async (req, res) => {
  await ensureGuestTables();
  const { guestToken, guestName, address, pincode, paymentMethod } = req.body;
  const cartItems = normalizeCartItems(req.body.cartItems);
  const name = String(guestName || '').trim();
  const addressText = String(address || '').trim();
  const normalizedPincode = String(pincode || '').trim();
  const normalizedPayment = normalizePaymentMethod(paymentMethod) || 'COD';
  const paymentError = validatePayment(normalizedPayment, req.body.paymentDetails || {});

  if (!name) return res.status(400).json({ message: 'Guest name is required.' });
  if (!addressText) return res.status(400).json({ message: 'Address is required.' });
  if (!validatePincode(normalizedPincode)) return res.status(400).json({ message: 'Enter a valid 6 digit pincode.' });
  if (paymentError) return res.status(400).json({ message: paymentError });
  if (!cartItems.length) return res.status(400).json({ message: 'Cart is empty.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const guest = await getVerifiedGuest(connection, guestToken);
    if (!guest) {
      await connection.rollback();
      return res.status(401).json({ message: 'Guest OTP verification expired. Please verify again.' });
    }

    const productIds = [...new Set(cartItems.map((item) => item.productId))];
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await connection.execute(`SELECT * FROM products WHERE id IN (${placeholders}) FOR UPDATE`, productIds);
    const productById = new Map(products.map((product) => [Number(product.id), product]));
    const items = [];

    for (const cartItem of cartItems) {
      const rawProduct = productById.get(cartItem.productId);
      if (!rawProduct) {
        await connection.rollback();
        return res.status(404).json({ message: 'One of the products is no longer available.' });
      }
      const item = mapSaleProduct({
        ...rawProduct,
        product_id: rawProduct.id,
        quantity: cartItem.quantity,
        selected_size: cartItem.size || rawProduct.size || ''
      });
      if (Number(item.stock || 0) < cartItem.quantity) {
        await connection.rollback();
        return res.status(400).json({ message: `${item.name} has only ${item.stock} item(s) in stock.` });
      }
      items.push(item);
    }

    const reserveResults = [];
    for (const item of items) {
      const qty = item.quantity + Number(item.bogoFreeQuantity || 0);
      const reserveResult = await reserveHubStock(connection, {
        pincode: normalizedPincode,
        productId: item.product_id,
        qty
      });
      if (reserveResult.error) {
        await connection.rollback();
        return res.status(400).json({ message: `${item.name}: ${reserveResult.error}` });
      }
      reserveResults.push(reserveResult);
      const [stockUpdate] = await connection.execute(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        [qty, item.product_id, qty]
      );
      if (!stockUpdate.affectedRows) {
        await connection.rollback();
        return res.status(400).json({ message: `${item.name} does not have enough stock.` });
      }
    }

    const summary = guestSummary(items);
    const paymentStatus = normalizedPayment === 'COD' ? 'PENDING' : 'PAID';
    const slowestHub = reserveResults
      .map((reserveResult) => reserveResult.hub)
      .sort((a, b) => Number(b.deliveryDaysMax || 0) - Number(a.deliveryDaysMax || 0))[0];
    const estimate = slowestHub?.estimate || {};
    const nextOrderNumber = await generateGuestOrderNumber(connection);
    const [orderResult] = await connection.execute(
      `INSERT INTO guest_orders
        (guest_token, guest_email, guest_mobile, guest_name, address, pincode, total_amount, payment_method, payment_details, payment_status, order_status, order_number, verification_type, delivery_hub_id, delivery_hub_name, estimated_delivery_date, estimated_delivery_min_days, estimated_delivery_max_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLACED', ?, ?, ?, ?, ?, ?, ?)`,
      [
        guestToken,
        guest.email,
        guest.mobile,
        name,
        addressText,
        normalizedPincode,
        summary.total,
        normalizedPayment,
        JSON.stringify(req.body.paymentDetails || {}),
        paymentStatus,
        nextOrderNumber,
        guest.verification_type,
        slowestHub?.hubId || null,
        slowestHub?.hubName || null,
        estimate.estimatedDeliveryDate || null,
        estimate.estimatedDeliveryMinDays || slowestHub?.deliveryDaysMin || null,
        estimate.estimatedDeliveryMaxDays || slowestHub?.deliveryDaysMax || null
      ]
    );
    const [trackingOrderResult] = await connection.execute(
      `INSERT INTO orders
        (order_number, user_id, address_id, total_amount, payment_method, payment_details, paid_status, payment_status, delivery_status, selected_hub_id, delivery_hub_id, delivery_pincode, estimated_delivery_min_days, estimated_delivery_max_days, estimated_delivery_date, expected_delivery_date, guest_name, guest_email, guest_mobile, courier_partner, is_guest_order, stock_deducted, order_source)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 'PLACED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'guest_checkout')`,
      [
        nextOrderNumber,
        summary.total,
        normalizedPayment,
        JSON.stringify(req.body.paymentDetails || {}),
        paymentStatus,
        paymentStatus,
        slowestHub?.hubId || null,
        slowestHub?.hubId || null,
        normalizedPincode,
        estimate.estimatedDeliveryMinDays || slowestHub?.deliveryDaysMin || null,
        estimate.estimatedDeliveryMaxDays || slowestHub?.deliveryDaysMax || null,
        estimate.estimatedDeliveryDate || null,
        estimate.estimatedDeliveryDate || null,
        name,
        guest.email,
        guest.mobile,
        'DressShop Delivery'
      ]
    );

    for (const item of items) {
      await connection.execute(
        `INSERT INTO guest_order_items (guest_order_id, product_id, product_name, quantity, price, total_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderResult.insertId, item.product_id, item.name, item.quantity, item.effectivePrice, money(Number(item.effectivePrice || 0) * item.quantity)]
      );
      await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, stock_quantity, return_days, replacement_days, selected_size, image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackingOrderResult.insertId,
          item.product_id,
          item.name,
          item.effectivePrice,
          item.quantity,
          item.quantity + Number(item.bogoFreeQuantity || 0),
          await guestItemPolicyDays(connection, productById.get(Number(item.product_id)) || item),
          await guestItemPolicyDays(connection, productById.get(Number(item.product_id)) || item),
          item.selected_size || null,
          item.image_url || item.image || null
        ]
      );
    }
    await connection.execute(
      `INSERT INTO order_tracking (order_id, delivery_hub_id, delivery_hub_name, delivery_pincode, estimated_delivery_date, estimated_delivery_min_days, estimated_delivery_max_days)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        trackingOrderResult.insertId,
        slowestHub?.hubId || null,
        slowestHub?.hubName || null,
        normalizedPincode,
        estimate.estimatedDeliveryDate || null,
        estimate.estimatedDeliveryMinDays || slowestHub?.deliveryDaysMin || null,
        estimate.estimatedDeliveryMaxDays || slowestHub?.deliveryDaysMax || null
      ]
    );

    await connection.execute('UPDATE guest_otps SET verified = 0, guest_token = NULL WHERE id = ?', [guest.id]);
    await connection.commit();
    res.status(201).json({
      success: true,
      id: orderResult.insertId,
      orderNumber: nextOrderNumber,
      order_number: nextOrderNumber,
      total: summary.total,
      totalPaid: summary.total,
      order: {
        id: orderResult.insertId,
        orderNumber: nextOrderNumber,
        order_number: nextOrderNumber,
        totalPaid: summary.total
      },
      paymentStatus,
      message: 'Guest order placed successfully.'
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

module.exports = router;
