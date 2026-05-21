const pool = require('../config/db');
const { money } = require('../utils/format');

function normalizeCouponCode(value = '') {
  return String(value).trim().toUpperCase();
}

function couponStatus(row) {
  if (!row) return 'Disabled';
  if (String(row.status).toUpperCase() !== 'ACTIVE') return 'Disabled';
  if (row.expiry_date && new Date(row.expiry_date).getTime() < Date.now()) return 'Expired';
  return 'Active';
}

function mapCoupon(row) {
  return {
    ...row,
    displayStatus: couponStatus(row)
  };
}

function mapAvailableCoupon(row, cartTotal = 0) {
  const minimumOrder = Number(row.minimum_order || 0);
  const total = Number(cartTotal || 0);
  return {
    id: row.id,
    coupon_code: row.coupon_code,
    title: row.title,
    description: row.description,
    discount_amount: Number(row.discount_amount || 0),
    minimum_order: minimumOrder,
    expiry_date: row.expiry_date,
    eligible: total >= minimumOrder,
    addMoreAmount: Math.max(0, minimumOrder - total)
  };
}

function validateCouponPayload(body = {}) {
  const couponCode = normalizeCouponCode(body.coupon_code || body.couponCode);
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const discountAmount = money(body.discount_amount ?? body.discountAmount);
  const minimumOrder = money(body.minimum_order ?? body.minimumOrder);
  const expiryDate = body.expiry_date || body.expiryDate;
  const status = String(body.status || 'ACTIVE').toUpperCase() === 'DISABLED' ? 'DISABLED' : 'ACTIVE';

  if (!couponCode || !title || discountAmount <= 0 || minimumOrder < 0 || !expiryDate) {
    return { error: 'Coupon code, title, discount amount, minimum order, and expiry date are required.' };
  }

  return {
    value: {
      couponCode,
      title,
      description,
      discountAmount,
      minimumOrder,
      expiryDate: new Date(expiryDate),
      status
    }
  };
}

async function validateCouponForOrder(connection, couponCode, orderSubtotal) {
  const code = normalizeCouponCode(couponCode);
  if (!code) return { coupon: null, discountAmount: 0 };

  const [[coupon]] = await connection.execute('SELECT * FROM coupons WHERE coupon_code = ?', [code]);
  if (!coupon) return { error: 'Coupon not found.' };
  if (couponStatus(coupon) !== 'Active') return { error: 'Coupon is not active.' };
  if (Number(orderSubtotal || 0) < Number(coupon.minimum_order || 0)) {
    return { error: `Minimum order for ${coupon.coupon_code} is Rs.${Number(coupon.minimum_order).toFixed(2)}.` };
  }

  const discountAmount = Math.min(Number(coupon.discount_amount || 0), Number(orderSubtotal || 0));
  return { coupon, discountAmount: money(discountAmount) };
}

async function listAvailableCoupons(req, res) {
  const cartTotal = Number(req.query.cartTotal || 0);
  const [rows] = await pool.execute(
    `SELECT *
     FROM coupons
     WHERE status = 'ACTIVE'
       AND expiry_date >= NOW()
     ORDER BY minimum_order ASC, discount_amount DESC`
  );
  res.json(rows.map((row) => mapAvailableCoupon(row, cartTotal)));
}

async function applyCoupon(req, res) {
  const cartTotal = Number(req.body.cartTotal || 0);
  const result = await validateCouponForOrder(pool, req.body.couponCode, cartTotal);
  if (result.error) return res.status(400).json({ message: result.error });
  res.json({
    coupon: mapAvailableCoupon(result.coupon, cartTotal),
    couponCode: result.coupon.coupon_code,
    discountAmount: result.discountAmount,
    payableAfterDiscount: money(cartTotal - result.discountAmount)
  });
}

async function removeCoupon(req, res) {
  res.json({ message: 'Coupon removed.' });
}

async function listUserCoupons(req, res) {
  const userId = req.user.id;
  const [available] = await pool.execute(
    `SELECT c.*
     FROM coupons c
     LEFT JOIN coupon_usages cu ON cu.coupon_id = c.id AND cu.user_id = ?
     WHERE c.status = 'ACTIVE'
       AND c.expiry_date >= NOW()
       AND cu.id IS NULL
     ORDER BY c.minimum_order ASC, c.discount_amount DESC`,
    [userId]
  );

  const [used] = await pool.execute(
    `SELECT c.*,
            cu.order_id,
            cu.used_at,
            COALESCE(o.coupon_discount_amount, o.discount_amount, c.discount_amount) AS used_discount_amount
     FROM coupon_usages cu
     JOIN coupons c ON c.id = cu.coupon_id
     JOIN orders o ON o.id = cu.order_id
     WHERE cu.user_id = ?
     ORDER BY cu.used_at DESC`,
    [userId]
  );

  const [expired] = await pool.execute(
    `SELECT *
     FROM coupons
     WHERE expiry_date < NOW()
        OR status <> 'ACTIVE'
     ORDER BY expiry_date DESC`
  );

  res.json({
    available: available.map((row) => ({ ...mapAvailableCoupon(row), status: couponStatus(row) })),
    used: used.map((row) => ({
      ...mapAvailableCoupon(row),
      status: couponStatus(row),
      orderId: row.order_id,
      usedDate: row.used_at,
      usedDiscountAmount: Number(row.used_discount_amount || 0)
    })),
    expired: expired.map((row) => ({ ...mapAvailableCoupon(row), status: couponStatus(row) }))
  });
}

async function listCoupons(req, res) {
  const [rows] = await pool.execute('SELECT * FROM coupons ORDER BY created_at DESC');
  res.json(rows.map(mapCoupon));
}

async function createCoupon(req, res) {
  const validation = validateCouponPayload(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const { couponCode, title, description, discountAmount, minimumOrder, expiryDate, status } = validation.value;
  await pool.execute(
    `INSERT INTO coupons (coupon_code, title, description, discount_amount, minimum_order, expiry_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [couponCode, title, description, discountAmount, minimumOrder, expiryDate, status]
  );
  res.status(201).json({ message: 'Coupon created.' });
}

async function updateCoupon(req, res) {
  const validation = validateCouponPayload(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const { couponCode, title, description, discountAmount, minimumOrder, expiryDate, status } = validation.value;
  const [result] = await pool.execute(
    `UPDATE coupons
     SET coupon_code = ?, title = ?, description = ?, discount_amount = ?, minimum_order = ?, expiry_date = ?, status = ?
     WHERE id = ?`,
    [couponCode, title, description, discountAmount, minimumOrder, expiryDate, status, req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Coupon not found.' });
  res.json({ message: 'Coupon updated.' });
}

async function updateCouponStatus(req, res) {
  const status = String(req.body.status || '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'DISABLED';
  const [result] = await pool.execute('UPDATE coupons SET status = ? WHERE id = ?', [status, req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Coupon not found.' });
  res.json({ message: 'Coupon status updated.' });
}

async function deleteCoupon(req, res) {
  const [result] = await pool.execute('DELETE FROM coupons WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Coupon not found.' });
  res.json({ message: 'Coupon deleted.' });
}

module.exports = {
  listCoupons,
  createCoupon,
  updateCoupon,
  updateCouponStatus,
  deleteCoupon,
  listAvailableCoupons,
  applyCoupon,
  removeCoupon,
  listUserCoupons,
  validateCouponForOrder,
  normalizeCouponCode,
  couponStatus
};
