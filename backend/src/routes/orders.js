const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { orderNumber, money } = require('../utils/format');
const { normalizeMobileNumber, isValidMobileNumber } = require('../utils/mobile');
const { savePaymentMethod } = require('./paymentMethods');
const { mapSaleProduct } = require('../utils/sale');
const { reserveHubStock } = require('../controllers/deliveryController');
const { validateCouponForOrder, normalizeCouponCode } = require('../controllers/couponController');
const { payOrder, refundOrder } = require('../services/walletService');

const router = express.Router();
router.use(authenticate);
const CASH_ON_DELIVERY_CHARGE = 60;
const RESTORE_STOCK_STATUSES = new Set(['CANCELLED', 'REFUNDED']);

async function getCartItems(connection, userId) {
  const [items] = await connection.execute(
    `SELECT c.product_id, c.quantity, c.size AS selected_size, p.*
     FROM cart c
     JOIN products p ON p.id = c.product_id
     WHERE c.user_id = ?
     FOR UPDATE`,
    [userId]
  );
  return items;
}

async function getMonthlyCheckoutSession(connection, userId, sessionId) {
  const [[session]] = await connection.execute(
    `SELECT *
     FROM monthly_template_checkout_sessions
     WHERE id = ? AND user_id = ? AND status = 'OPEN' AND expires_at > NOW()`,
    [sessionId, userId]
  );
  if (!session) return null;

  const rawItems = typeof session.items_json === 'string' ? JSON.parse(session.items_json || '[]') : session.items_json;
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) return { ...session, items: [] };

  const productIds = items.map((item) => Number(item.product_id || item.productId)).filter(Boolean);
  const placeholders = productIds.map(() => '?').join(',');
  const [products] = await connection.execute(`SELECT * FROM products WHERE id IN (${placeholders})`, productIds);
  const productById = new Map(products.map((product) => [Number(product.id), product]));

  return {
    ...session,
    items: items.map((item) => {
      const productId = Number(item.product_id || item.productId);
      const product = productById.get(productId) || {};
      const price = Number(item.price ?? item.amount ?? product.price ?? 0);
      const quantity = Math.max(1, Number(item.quantity || 1));
      return {
        ...product,
        ...item,
        product_id: productId,
        quantity,
        selected_size: item.selected_size || item.size || product.size || '',
        price,
        originalPrice: price,
        effectivePrice: price,
        isOnSale: false,
        discount: 0,
        discount_percent: 0,
        line_total: money(price * quantity),
        image: item.image || product.image_url || product.image
      };
    })
  };
}

async function calculateSummary(items, paymentMethod = '', couponCode = '', connection = pool) {
  const saleAwareItems = items.map((item) => mapSaleProduct(item));
  const productPrice = money(saleAwareItems.reduce((sum, item) => sum + Number(item.originalPrice || item.price) * item.quantity, 0));
  const discountAmount = money(saleAwareItems.reduce((sum, item) => {
    const originalPrice = Number(item.originalPrice || item.price) || 0;
    const effectivePrice = Number(item.effectivePrice || item.price) || 0;
    return sum + (originalPrice - effectivePrice) * item.quantity;
  }, 0));
  const discountPercent = productPrice > 0 ? money((discountAmount / productPrice) * 100) : 0;
  const subtotalBeforeCoupon = money(productPrice - discountAmount);
  const couponResult = await validateCouponForOrder(connection, couponCode, subtotalBeforeCoupon);
  if (couponResult.error) {
    const error = new Error(couponResult.error);
    error.status = 400;
    throw error;
  }
  const couponDiscountAmount = money(couponResult.discountAmount || 0);
  const priceAfterDiscount = money(subtotalBeforeCoupon - couponDiscountAmount);
  const tax = money(priceAfterDiscount * 0.05);
  const deliveryCharge = priceAfterDiscount > 1999 || priceAfterDiscount === 0 ? 0 : 99;
  const cashOnDeliveryCharge = paymentMethod === 'Cash On Delivery' && priceAfterDiscount > 0 ? CASH_ON_DELIVERY_CHARGE : 0;
  const total = money(priceAfterDiscount + tax + deliveryCharge + cashOnDeliveryCharge);
  return {
    productPrice,
    discountAmount,
    discountPercent,
    couponDiscountAmount,
    couponCode: couponResult.coupon?.coupon_code || '',
    couponId: couponResult.coupon?.id || null,
    priceAfterDiscount,
    tax,
    deliveryCharge,
    cashOnDeliveryCharge,
    total
  };
}

async function assertOrderItemsAvailable(connection, items, userId) {
  const unavailable = items.find((item) => item.stock < item.quantity);
  if (unavailable) {
    return `${unavailable.name} has only ${unavailable.stock} item(s) in stock.`;
  }

  const saleLimitItem = items.find((item) => item.isOnSale && item.quantity > 1);
  if (saleLimitItem) {
    return 'Summer Sale items are limited to 1 quantity per customer.';
  }

  for (const item of items.filter((cartItem) => cartItem.isOnSale)) {
    const [[existingSaleOrder]] = await connection.execute(
      `SELECT COUNT(*) AS count
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id = ? AND oi.product_id = ? AND o.delivery_status NOT IN ('CANCELLED', 'REFUNDED')`,
      [userId, item.product_id]
    );
    if (Number(existingSaleOrder.count) > 0) {
      return 'Summer Sale limit reached: maximum 1 quantity per customer.';
    }
  }

  const bogoUnavailable = items.find((item) => item.quantity + Number(item.bogoFreeQuantity || 0) > item.stock);
  if (bogoUnavailable) {
    return `${bogoUnavailable.name} does not have enough stock for the free BOGO item.`;
  }

  return '';
}

function getStockQuantity(item) {
  return Number(item.stock_quantity || item.quantity || 0);
}

async function saveOrderTracking(connection, orderId, pincode, hub) {
  const estimate = hub?.estimate || {};
  await connection.execute(
    `INSERT INTO order_tracking (order_id, delivery_hub_id, delivery_hub_name, delivery_pincode, estimated_delivery_date, estimated_delivery_min_days, estimated_delivery_max_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       delivery_hub_id = VALUES(delivery_hub_id),
       delivery_hub_name = VALUES(delivery_hub_name),
       delivery_pincode = VALUES(delivery_pincode),
       estimated_delivery_date = VALUES(estimated_delivery_date),
       estimated_delivery_min_days = VALUES(estimated_delivery_min_days),
       estimated_delivery_max_days = VALUES(estimated_delivery_max_days)`,
    [
      orderId,
      hub?.hubId || null,
      hub?.hubName || estimate.deliveryHubName || null,
      pincode,
      estimate.estimatedDeliveryDate || null,
      estimate.estimatedDeliveryMinDays || hub?.deliveryDaysMin || null,
      estimate.estimatedDeliveryMaxDays || hub?.deliveryDaysMax || null
    ]
  );
}

async function deductDeliveredStock(connection, orderId) {
  const [items] = await connection.execute(
    'SELECT product_id, product_name, quantity, stock_quantity FROM order_items WHERE order_id = ?',
    [orderId]
  );

  for (const item of items) {
    const stockQuantity = getStockQuantity(item);
    const [result] = await connection.execute(
      'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
      [stockQuantity, item.product_id, stockQuantity]
    );
    if (!result.affectedRows) {
      return `${item.product_name} does not have enough stock to mark this order as delivered.`;
    }
  }

  return '';
}

async function restoreDeliveredStock(connection, orderId) {
  const [items] = await connection.execute(
    'SELECT product_id, quantity, stock_quantity FROM order_items WHERE order_id = ?',
    [orderId]
  );

  for (const item of items) {
    const stockQuantity = getStockQuantity(item);
    await connection.execute(
      'UPDATE products SET stock = stock + ? WHERE id = ?',
      [stockQuantity, item.product_id]
    );
  }
}

function digitsOnly(value = '') {
  return String(value).replace(/\D/g, '');
}

function sanitizePaymentDetails(paymentMethod, details = {}) {
  if (paymentMethod === 'UPI') {
    const upiId = String(details.upiId || '').trim();
    const accountHolder = String(details.upiName || '').trim();
    const phone = normalizeMobileNumber(details.upiPhone);
    if (!accountHolder || !/^[\w.-]+@[\w.-]+$/.test(upiId) || !isValidMobileNumber(phone)) {
      return { error: 'Please enter valid UPI payment details.' };
    }
    return {
      value: {
        accountHolder,
        upiId,
        phone
      },
      savePayload: { type: 'UPI', accountHolder, upiId, phone }
    };
  }

  if (paymentMethod === 'Credit Card' || paymentMethod === 'Debit Card') {
    const cardNumber = digitsOnly(details.cardNumber);
    const expiry = String(details.expiry || '').trim();
    const cardholder = String(details.cardName || '').trim();
    const cvv = digitsOnly(details.cvv);
    const billingPhone = normalizeMobileNumber(details.billingPhone);

    if (!cardholder || cardNumber.length < 13 || !/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry) || cvv.length < 3 || !isValidMobileNumber(billingPhone)) {
      return { error: 'Please enter valid card payment details.' };
    }

    return {
      value: {
        cardholder,
        cardType: paymentMethod,
        lastFour: cardNumber.slice(-4),
        expiry,
        billingPhone
      },
      savePayload: { type: 'Card', cardholder, cardNumber, expiry, billingPhone }
    };
  }

  if (paymentMethod === 'Cash On Delivery') {
    const receiver = String(details.codReceiver || '').trim();
    const phone = normalizeMobileNumber(details.codPhone);
    if (!receiver || !isValidMobileNumber(phone) || !details.codConfirmed) {
      return { error: 'Please confirm the cash on delivery details.' };
    }
    return {
      value: {
        receiver,
        phone,
        confirmed: true,
        cashOnDeliveryCharge: CASH_ON_DELIVERY_CHARGE
      }
    };
  }

  if (paymentMethod === 'Wallet') {
    return {
      value: {
        walletPayment: true
      }
    };
  }

  return { error: 'Please select a valid payment method.' };
}

router.get('/summary', asyncHandler(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT c.quantity, p.* FROM cart c JOIN products p ON p.id = c.product_id WHERE c.user_id = ?`,
    [req.user.id]
  );
  res.json(await calculateSummary(items, req.query.paymentMethod, req.query.couponCode));
}));

router.get('/buy-now/summary/:productId', asyncHandler(async (req, res) => {
  const qty = Math.max(1, Number(req.query.quantity || 1));
  const [[rawProduct]] = await pool.execute(
    'SELECT p.*, p.id AS product_id FROM products p WHERE p.id = ?',
    [req.params.productId]
  );
  const product = rawProduct ? mapSaleProduct({
    ...rawProduct,
    quantity: qty,
    selected_size: req.query.size || rawProduct.size || ''
  }) : null;
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  if (product.isOnSale && qty > 1) return res.status(400).json({ message: 'Summer Sale items are limited to 1 quantity per customer.' });
  if (product.stock < qty) return res.status(400).json({ message: 'Requested quantity is not in stock.' });
  if (product.isOnSale && product.stock < 1 + Number(product.bogoFreeQuantity || 0)) {
    return res.status(400).json({ message: `${product.name} does not have enough stock for the free BOGO item.` });
  }
  if (product.isOnSale) {
    const [[existingSaleOrder]] = await pool.execute(
      `SELECT COUNT(*) AS count
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id = ? AND oi.product_id = ? AND o.delivery_status NOT IN ('CANCELLED', 'REFUNDED')`,
      [req.user.id, product.product_id]
    );
    if (Number(existingSaleOrder.count) > 0) {
      return res.status(400).json({ message: 'Summer Sale limit reached: maximum 1 quantity per customer.' });
    }
  }
  res.json({ item: product, summary: await calculateSummary([product], req.query.paymentMethod, req.query.couponCode) });
}));

router.post('/buy-now', asyncHandler(async (req, res) => {
  const { productId, addressId, paymentMethod, paymentDetails, size } = req.body;
  const couponCode = normalizeCouponCode(req.body.couponCode);
  const qty = Math.max(1, Number(req.body.quantity || 1));
  if (!productId || !addressId || !paymentMethod) {
    return res.status(400).json({ message: 'Product, address, and payment method are required.' });
  }
  const sanitizedPayment = sanitizePaymentDetails(paymentMethod, paymentDetails);
  if (sanitizedPayment.error) {
    return res.status(400).json({ message: sanitizedPayment.error });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [[address]] = await connection.execute('SELECT id, pincode FROM addresses WHERE id = ? AND user_id = ?', [addressId, req.user.id]);
    if (!address) {
      await connection.rollback();
      return res.status(404).json({ message: 'Delivery address not found.' });
    }

    const [[rawProduct]] = await connection.execute(
      'SELECT p.*, p.id AS product_id FROM products p WHERE p.id = ? FOR UPDATE',
      [productId]
    );
    const item = rawProduct ? mapSaleProduct({
      ...rawProduct,
      quantity: qty,
      selected_size: size || rawProduct.size || ''
    }) : null;
    if (!item) {
      await connection.rollback();
      return res.status(404).json({ message: 'Product not found.' });
    }

    const availabilityError = await assertOrderItemsAvailable(connection, [item], req.user.id);
    if (availabilityError) {
      await connection.rollback();
      return res.status(400).json({ message: availabilityError });
    }

    const reserveResult = await reserveHubStock(connection, {
      pincode: address.pincode,
      productId: item.product_id,
      qty: item.quantity + Number(item.bogoFreeQuantity || 0)
    });
    if (reserveResult.error) {
      await connection.rollback();
      return res.status(400).json({ message: reserveResult.error });
    }
    if (paymentMethod === 'Cash On Delivery' && !reserveResult.hub.codAvailable) {
      await connection.rollback();
      return res.status(400).json({ message: 'Cash On Delivery is not available for this pincode.' });
    }

    const summary = await calculateSummary([item], paymentMethod, couponCode, connection);
    const { total } = summary;
    const paidStatus = paymentMethod === 'Cash On Delivery' ? 'PENDING' : 'PAID';
    const nextOrderNumber = orderNumber();

    const estimate = reserveResult.hub.estimate || {};
    const [orderResult] = await connection.execute(
      `INSERT INTO orders (order_number, user_id, address_id, total_amount, payment_method, payment_details, paid_status, delivery_status, selected_hub_id, delivery_pincode, estimated_delivery_min_days, estimated_delivery_max_days, estimated_delivery_date, coupon_id, coupon_code, discount_amount, coupon_discount_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PLACED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextOrderNumber,
        req.user.id,
        addressId,
        total,
        paymentMethod,
        JSON.stringify(sanitizedPayment.value),
        paidStatus,
        reserveResult.hub.hubId,
        address.pincode,
        estimate.estimatedDeliveryMinDays || reserveResult.hub.deliveryDaysMin || null,
        estimate.estimatedDeliveryMaxDays || reserveResult.hub.deliveryDaysMax || null,
        estimate.estimatedDeliveryDate || null,
        summary.couponId,
        summary.couponCode || null,
        summary.couponDiscountAmount,
        summary.couponDiscountAmount
      ]
    );
    if (summary.couponId) {
      await connection.execute('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [summary.couponId]);
      await connection.execute('INSERT INTO coupon_usages (coupon_id, user_id, order_id) VALUES (?, ?, ?)', [summary.couponId, req.user.id, orderResult.insertId]);
    }

    if (paymentMethod === 'Wallet') {
      const walletPayment = await payOrder(connection, req.user.id, orderResult.insertId, nextOrderNumber, total);
      if (walletPayment.error) {
        await connection.rollback();
        return res.status(400).json({ message: walletPayment.error });
      }
    }

    if (paymentDetails?.savePayment && sanitizedPayment.savePayload) {
      await savePaymentMethod(req.user.id, sanitizedPayment.savePayload);
    }

    const freeQuantity = Number(item.bogoFreeQuantity || 0);
    await connection.execute(
      `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, stock_quantity, selected_size, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderResult.insertId, item.product_id, item.name, item.effectivePrice, item.quantity, item.quantity + freeQuantity, item.selected_size || null, item.image]
    );
    await saveOrderTracking(connection, orderResult.insertId, address.pincode, reserveResult.hub);

    await connection.commit();
    res.status(201).json({ id: orderResult.insertId, total, paidStatus, message: 'Order placed successfully.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.get('/monthly-template/summary/:sessionId', asyncHandler(async (req, res) => {
  const session = await getMonthlyCheckoutSession(pool, req.user.id, req.params.sessionId);
  if (!session || !session.items.length) return res.status(404).json({ message: 'Checkout session not found or expired.' });
  res.json({
    source: 'monthly-template',
    sessionId: session.id,
    items: session.items,
    summary: await calculateSummary(session.items, req.query.paymentMethod, req.query.couponCode)
  });
}));

router.post('/monthly-template/checkout', asyncHandler(async (req, res) => {
  const { checkoutSessionId, addressId, paymentMethod, paymentDetails } = req.body;
  const couponCode = normalizeCouponCode(req.body.couponCode);
  if (!checkoutSessionId || !addressId || !paymentMethod) {
    return res.status(400).json({ message: 'Checkout session, address, and payment method are required.' });
  }
  const sanitizedPayment = sanitizePaymentDetails(paymentMethod, paymentDetails);
  if (sanitizedPayment.error) {
    return res.status(400).json({ message: sanitizedPayment.error });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const session = await getMonthlyCheckoutSession(connection, req.user.id, checkoutSessionId);
    if (!session || !session.items.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Checkout session not found or expired.' });
    }

    const [[address]] = await connection.execute('SELECT id, pincode FROM addresses WHERE id = ? AND user_id = ?', [addressId, req.user.id]);
    if (!address) {
      await connection.rollback();
      return res.status(404).json({ message: 'Delivery address not found.' });
    }

    const availabilityError = await assertOrderItemsAvailable(connection, session.items, req.user.id);
    if (availabilityError) {
      await connection.rollback();
      return res.status(400).json({ message: availabilityError });
    }

    const reserveResults = [];
    for (const item of session.items) {
      const reserveResult = await reserveHubStock(connection, {
        pincode: address.pincode,
        productId: item.product_id,
        qty: item.quantity
      });
      if (reserveResult.error) {
        await connection.rollback();
        return res.status(400).json({ message: `${item.name}: ${reserveResult.error}` });
      }
      if (paymentMethod === 'Cash On Delivery' && !reserveResult.hub.codAvailable) {
        await connection.rollback();
        return res.status(400).json({ message: 'Cash On Delivery is not available for this pincode.' });
      }
      reserveResults.push(reserveResult);
    }

    const summary = await calculateSummary(session.items, paymentMethod, couponCode, connection);
    const paidStatus = paymentMethod === 'Cash On Delivery' ? 'PENDING' : 'PAID';
    const nextOrderNumber = orderNumber();
    const slowestReserve = reserveResults
      .map((reserveResult) => reserveResult.hub)
      .sort((a, b) => Number(b.deliveryDaysMax || 0) - Number(a.deliveryDaysMax || 0))[0];
    const estimate = slowestReserve?.estimate || {};

    const [orderResult] = await connection.execute(
      `INSERT INTO orders (order_number, user_id, address_id, total_amount, payment_method, payment_details, paid_status, delivery_status, selected_hub_id, delivery_pincode, estimated_delivery_min_days, estimated_delivery_max_days, estimated_delivery_date, coupon_id, coupon_code, discount_amount, coupon_discount_amount, order_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PLACED', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'monthly_template')`,
      [
        nextOrderNumber,
        req.user.id,
        addressId,
        summary.total,
        paymentMethod,
        JSON.stringify(sanitizedPayment.value),
        paidStatus,
        slowestReserve?.hubId || null,
        address.pincode,
        estimate.estimatedDeliveryMinDays || slowestReserve?.deliveryDaysMin || null,
        estimate.estimatedDeliveryMaxDays || slowestReserve?.deliveryDaysMax || null,
        estimate.estimatedDeliveryDate || null,
        summary.couponId,
        summary.couponCode || null,
        summary.couponDiscountAmount,
        summary.couponDiscountAmount
      ]
    );

    if (summary.couponId) {
      await connection.execute('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [summary.couponId]);
      await connection.execute('INSERT INTO coupon_usages (coupon_id, user_id, order_id) VALUES (?, ?, ?)', [summary.couponId, req.user.id, orderResult.insertId]);
    }

    if (paymentMethod === 'Wallet') {
      const walletPayment = await payOrder(connection, req.user.id, orderResult.insertId, nextOrderNumber, summary.total);
      if (walletPayment.error) {
        await connection.rollback();
        return res.status(400).json({ message: walletPayment.error });
      }
    }

    if (paymentDetails?.savePayment && sanitizedPayment.savePayload) {
      await savePaymentMethod(req.user.id, sanitizedPayment.savePayload);
    }

    for (const item of session.items) {
      await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, stock_quantity, selected_size, image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderResult.insertId, item.product_id, item.name, item.price, item.quantity, item.quantity, item.selected_size || null, item.image]
      );
    }
    await saveOrderTracking(connection, orderResult.insertId, address.pincode, slowestReserve);
    await connection.execute("UPDATE monthly_template_checkout_sessions SET status = 'ORDERED' WHERE id = ? AND user_id = ?", [checkoutSessionId, req.user.id]);

    await connection.commit();
    res.status(201).json({ id: orderResult.insertId, total: summary.total, paidStatus, message: 'Order placed successfully.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post(['/', '/create'], asyncHandler(async (req, res) => {
  const { addressId, paymentMethod, paymentDetails } = req.body;
  const couponCode = normalizeCouponCode(req.body.couponCode);
  if (!addressId || !paymentMethod) {
    return res.status(400).json({ message: 'Address and payment method are required.' });
  }
  const sanitizedPayment = sanitizePaymentDetails(paymentMethod, paymentDetails);
  if (sanitizedPayment.error) {
    return res.status(400).json({ message: sanitizedPayment.error });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [[address]] = await connection.execute('SELECT id, pincode FROM addresses WHERE id = ? AND user_id = ?', [addressId, req.user.id]);
    if (!address) {
      await connection.rollback();
      return res.status(404).json({ message: 'Delivery address not found.' });
    }

    const items = (await getCartItems(connection, req.user.id)).map((item) => mapSaleProduct(item));
    if (!items.length) {
      await connection.rollback();
      return res.status(400).json({ message: 'Cart is empty.' });
    }

    const availabilityError = await assertOrderItemsAvailable(connection, items, req.user.id);
    if (availabilityError) {
      await connection.rollback();
      return res.status(400).json({ message: availabilityError });
    }

    const reserveResults = [];
    for (const item of items) {
      const reserveResult = await reserveHubStock(connection, {
        pincode: address.pincode,
        productId: item.product_id,
        qty: item.quantity + Number(item.bogoFreeQuantity || 0)
      });
      if (reserveResult.error) {
        await connection.rollback();
        return res.status(400).json({ message: `${item.name}: ${reserveResult.error}` });
      }
      if (paymentMethod === 'Cash On Delivery' && !reserveResult.hub.codAvailable) {
        await connection.rollback();
        return res.status(400).json({ message: 'Cash On Delivery is not available for this pincode.' });
      }
      reserveResults.push(reserveResult);
    }

    const summary = await calculateSummary(items, paymentMethod, couponCode, connection);
    const { total } = summary;
    const paidStatus = paymentMethod === 'Cash On Delivery' ? 'PENDING' : 'PAID';
    const nextOrderNumber = orderNumber();

    const slowestReserve = reserveResults
      .map((reserveResult) => reserveResult.hub)
      .sort((a, b) => Number(b.deliveryDaysMax || 0) - Number(a.deliveryDaysMax || 0))[0];
    const slowestEstimate = slowestReserve?.estimate || {};
    const [orderResult] = await connection.execute(
      `INSERT INTO orders (order_number, user_id, address_id, total_amount, payment_method, payment_details, paid_status, delivery_status, selected_hub_id, delivery_pincode, estimated_delivery_min_days, estimated_delivery_max_days, estimated_delivery_date, coupon_id, coupon_code, discount_amount, coupon_discount_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PLACED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextOrderNumber,
        req.user.id,
        addressId,
        total,
        paymentMethod,
        JSON.stringify(sanitizedPayment.value),
        paidStatus,
        slowestReserve?.hubId || null,
        address.pincode,
        slowestEstimate.estimatedDeliveryMinDays || slowestReserve?.deliveryDaysMin || null,
        slowestEstimate.estimatedDeliveryMaxDays || slowestReserve?.deliveryDaysMax || null,
        slowestEstimate.estimatedDeliveryDate || null,
        summary.couponId,
        summary.couponCode || null,
        summary.couponDiscountAmount,
        summary.couponDiscountAmount
      ]
    );
    if (summary.couponId) {
      await connection.execute('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [summary.couponId]);
      await connection.execute('INSERT INTO coupon_usages (coupon_id, user_id, order_id) VALUES (?, ?, ?)', [summary.couponId, req.user.id, orderResult.insertId]);
    }

    if (paymentMethod === 'Wallet') {
      const walletPayment = await payOrder(connection, req.user.id, orderResult.insertId, nextOrderNumber, total);
      if (walletPayment.error) {
        await connection.rollback();
        return res.status(400).json({ message: walletPayment.error });
      }
    }

    if (paymentDetails?.savePayment && sanitizedPayment.savePayload) {
      await savePaymentMethod(req.user.id, sanitizedPayment.savePayload);
    }

    for (const item of items) {
      const freeQuantity = Number(item.bogoFreeQuantity || 0);
      await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, stock_quantity, selected_size, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderResult.insertId, item.product_id, item.name, item.effectivePrice, item.quantity, item.quantity + freeQuantity, item.selected_size || null, item.image]
      );
    }
    await saveOrderTracking(connection, orderResult.insertId, address.pincode, slowestReserve);

    await connection.execute('DELETE FROM cart WHERE user_id = ?', [req.user.id]);
    await connection.commit();
    res.status(201).json({ id: orderResult.insertId, total, paidStatus, message: 'Order placed successfully.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.get('/', asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'ADMIN';
  const [orders] = await pool.execute(
    `SELECT o.*, a.full_name, a.city, a.state,
            o.delivery_status AS status,
            o.paid_status AS paymentStatus,
            o.delivery_status AS deliveryStatus,
            (
              SELECT pdr.request_status
              FROM post_delivery_requests pdr
              WHERE pdr.order_id = o.id
              ORDER BY pdr.updated_at DESC
              LIMIT 1
            ) AS returnStatus,
            (
              SELECT oc.refund_status
              FROM order_cancellations oc
              WHERE oc.order_id = o.id
              ORDER BY oc.cancelled_at DESC
              LIMIT 1
            ) AS cancelStatus
     FROM orders o JOIN addresses a ON a.id = o.address_id
     ${isAdmin ? '' : 'WHERE o.user_id = ?'}
     ORDER BY o.created_at DESC`,
    isAdmin ? [] : [req.user.id]
  );
  res.json(orders);
}));

router.get('/previous-month-items', asyncHandler(async (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const formatDate = (value) => value.toISOString().slice(0, 19).replace('T', ' ');

  const [items] = await pool.execute(
    `SELECT p.id AS product_id,
            p.name,
            p.brand,
            p.price,
            p.discount,
            p.discount_percent,
            p.stock,
            p.image,
            p.image_url,
            p.category,
            p.size,
            p.sizes,
            COALESCE(NULLIF(oi.selected_size, ''), p.size, '') AS selected_size,
            SUM(oi.quantity) AS ordered_quantity,
            MAX(o.created_at) AS last_ordered_at,
            MAX(o.order_number) AS last_order_number
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE o.user_id = ?
       AND o.created_at >= ?
       AND o.created_at < ?
       AND o.delivery_status NOT IN ('CANCELLED', 'REFUNDED')
       AND COALESCE(oi.item_status, 'ACTIVE') <> 'CANCELLED'
       AND COALESCE(p.is_active, TRUE) = TRUE
     GROUP BY p.id, selected_size
     ORDER BY last_ordered_at DESC`,
    [req.user.id, formatDate(start), formatDate(end)]
  );

  res.json({
    month: start.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    startDate: start.toISOString().slice(0, 10),
    endDate: new Date(end.getTime() - 1).toISOString().slice(0, 10),
    items: items.map((item) => ({
      ...item,
      image: item.image_url || item.image,
      ordered_quantity: Number(item.ordered_quantity || 0)
    }))
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'ADMIN';
  const [[order]] = await pool.execute(
    `SELECT o.*, a.full_name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode,
            ot.delivery_hub_id,
            ot.delivery_hub_name,
            ot.estimated_delivery_date AS tracking_estimated_delivery_date
     FROM orders o
     JOIN addresses a ON a.id = o.address_id
     LEFT JOIN order_tracking ot ON ot.order_id = o.id
     WHERE o.id = ? ${isAdmin ? '' : 'AND o.user_id = ?'}`,
    isAdmin ? [req.params.id] : [req.params.id, req.user.id]
  );
  if (!order) return res.status(404).json({ message: 'Order not found.' });

  const [items] = await pool.execute(
    `SELECT oi.*,
            oc.id AS cancellation_id,
            oc.cancel_reason,
            oc.refund_status,
            oc.cancelled_at,
            oc.admin_remarks,
            pdr.id AS post_delivery_request_id,
            pdr.request_type,
            pdr.request_reason,
            pdr.request_status,
            pdr.refund_status AS post_delivery_refund_status,
            pr.id AS review_id,
            pr.rating,
            pr.review_text,
            pr.is_hidden AS review_hidden
     FROM order_items oi
     LEFT JOIN order_cancellations oc ON oc.order_item_id = oi.id
     LEFT JOIN post_delivery_requests pdr ON pdr.order_item_id = oi.id
     LEFT JOIN product_reviews pr ON pr.order_item_id = oi.id
     WHERE oi.order_id = ?`,
    [req.params.id]
  );
  res.json({ ...order, items });
}));

router.patch('/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { delivery_status, paid_status } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [[order]] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!order) {
      await connection.rollback();
      return res.status(404).json({ message: 'Order not found.' });
    }

    let stockDeducted = Boolean(order.stock_deducted);
    let deliveredOn = order.delivered_on;
    const nextDeliveryStatus = delivery_status || order.delivery_status;

    if (nextDeliveryStatus === 'DELIVERED' && !stockDeducted) {
      const stockError = await deductDeliveredStock(connection, order.id);
      if (stockError) {
        await connection.rollback();
        return res.status(400).json({ message: stockError });
      }
      stockDeducted = true;
      deliveredOn = new Date();
    }

    if (RESTORE_STOCK_STATUSES.has(nextDeliveryStatus) && stockDeducted) {
      await restoreDeliveredStock(connection, order.id);
      stockDeducted = false;
      deliveredOn = null;
    }

    let nextPaidStatus = paid_status || null;
    if (RESTORE_STOCK_STATUSES.has(nextDeliveryStatus) && order.payment_method === 'Wallet' && order.paid_status === 'PAID') {
      const refund = await refundOrder(connection, order);
      if (refund.error) {
        await connection.rollback();
        return res.status(400).json({ message: refund.error });
      }
      nextPaidStatus = 'REFUNDED';
    }

    await connection.execute(
      `UPDATE orders
       SET delivery_status = ?,
           paid_status = COALESCE(?, paid_status),
           delivered_on = ?,
           stock_deducted = ?
       WHERE id = ?`,
      [nextDeliveryStatus, nextPaidStatus, deliveredOn, stockDeducted, order.id]
    );

    await connection.commit();
    res.json({ message: 'Order status updated.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

module.exports = router;
