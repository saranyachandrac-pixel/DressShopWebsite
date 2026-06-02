const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  creditMaturedOrderCoins,
  estimateEarnCoins,
  expireUserCoins,
  getActiveRule,
  getEarnEstimate,
  getWallet,
  money,
  processPendingSuperCoinRewards,
  validateRedemption
} = require('../services/superCoinService');
const { mapSaleProduct } = require('../utils/sale');

const router = express.Router();
const adminRouter = express.Router();

function requireUser(req, res, next) {
  if (req.user?.role !== 'USER') {
    return res.status(403).json({ message: 'User access required.' });
  }
  next();
}

router.use(authenticate, requireUser);
adminRouter.use(authenticate, requireAdmin);

router.get('/balance', asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await creditMaturedOrderCoins(connection);
    await expireUserCoins(connection, req.user.id);
    const wallet = await getWallet(connection, req.user.id, true);
    const [[expiring]] = await connection.execute(
      `SELECT COALESCE(SUM(coins), 0) AS coins, MIN(expiry_date) AS next_expiry_date
       FROM super_coin_transactions
       WHERE user_id = ?
         AND status = 'EARNED'
         AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`,
      [req.user.id]
    );
    await connection.commit();
    res.json({ wallet, expiring });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.get('/history', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 200);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await creditMaturedOrderCoins(connection);
    await expireUserCoins(connection, req.user.id);
    const wallet = await getWallet(connection, req.user.id, true);
    const [transactions] = await connection.execute(
      `SELECT sct.*, o.order_number
       FROM super_coin_transactions sct
       LEFT JOIN orders o ON o.id = sct.order_id
       WHERE sct.user_id = ?
       ORDER BY sct.created_at DESC
       LIMIT ${limit}`,
      [req.user.id]
    );
    await connection.commit();
    res.json({ wallet, transactions });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/apply', asyncHandler(async (req, res) => {
  const orderAmount = money(req.body.orderAmount);
  const coins = Number(req.body.coins || 0);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await validateRedemption(connection, req.user.id, orderAmount, coins);
    if (result.error) {
      await connection.rollback();
      return res.status(400).json({ message: result.error });
    }
    await connection.commit();
    res.json({
      coins: result.coins,
      discount: result.value,
      maxRedeemableCoins: result.maxRedeemableCoins,
      message: result.coins > 0 ? `Applied ${result.coins} Super Coins.` : 'No Super Coins applied.'
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/remove', asyncHandler(async (req, res) => {
  res.json({ coins: 0, discount: 0, message: 'Super Coins removed.' });
}));

router.get('/estimate/:productId', asyncHandler(async (req, res) => {
  const qty = Math.max(1, Number(req.query.quantity || 1));
  const [[rawProduct]] = await pool.execute('SELECT p.*, p.id AS product_id FROM products p WHERE p.id = ?', [req.params.productId]);
  if (!rawProduct) return res.status(404).json({ message: 'Product not found.' });
  const product = mapSaleProduct({ ...rawProduct, quantity: qty });
  const lineTotal = money(Number(product.effectivePrice || product.price || 0) * qty);
  const estimate = await getEarnEstimate(pool, req.user.id, lineTotal);
  res.json({ coins: estimate.coins, rule: estimate.rule });
}));

adminRouter.get('/rules', asyncHandler(async (req, res) => {
  const [rules] = await pool.execute('SELECT * FROM super_coin_rules ORDER BY updated_at DESC, id DESC');
  res.json(rules);
}));

adminRouter.post('/rules', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const [result] = await pool.execute(
    `INSERT INTO super_coin_rules
      (rule_name, coins_per_amount, amount_unit, first_order_bonus, review_bonus, referral_bonus, max_redeem_percentage, coin_value_in_rupees, expiry_days, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(body.rule_name || body.ruleName || 'Super Coin Rule').trim(),
      Number(body.coins_per_amount || body.coinsPerAmount || 0),
      money(body.amount_unit || body.amountUnit || 100),
      Number(body.first_order_bonus || body.firstOrderBonus || 0),
      Number(body.review_bonus || body.reviewBonus || 0),
      Number(body.referral_bonus || body.referralBonus || 0),
      money(body.max_redeem_percentage || body.maxRedeemPercentage || 0),
      money(body.coin_value_in_rupees || body.coinValueInRupees || 1),
      Number(body.expiry_days || body.expiryDays || 365),
      Boolean(body.is_active ?? body.isActive ?? true)
    ]
  );
  res.status(201).json({ id: result.insertId, message: 'Super Coin rule created.' });
}));

adminRouter.put('/rules/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const [result] = await pool.execute(
    `UPDATE super_coin_rules
     SET rule_name = ?,
         coins_per_amount = ?,
         amount_unit = ?,
         first_order_bonus = ?,
         review_bonus = ?,
         referral_bonus = ?,
         max_redeem_percentage = ?,
         coin_value_in_rupees = ?,
         expiry_days = ?,
         is_active = ?
     WHERE id = ?`,
    [
      String(body.rule_name || body.ruleName || 'Super Coin Rule').trim(),
      Number(body.coins_per_amount || body.coinsPerAmount || 0),
      money(body.amount_unit || body.amountUnit || 100),
      Number(body.first_order_bonus || body.firstOrderBonus || 0),
      Number(body.review_bonus || body.reviewBonus || 0),
      Number(body.referral_bonus || body.referralBonus || 0),
      money(body.max_redeem_percentage || body.maxRedeemPercentage || 0),
      money(body.coin_value_in_rupees || body.coinValueInRupees || 1),
      Number(body.expiry_days || body.expiryDays || 365),
      Boolean(body.is_active ?? body.isActive),
      req.params.id
    ]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Rule not found.' });
  res.json({ message: 'Super Coin rule updated.' });
}));

adminRouter.get('/users', asyncHandler(async (req, res) => {
  const [users] = await pool.execute(
    `SELECT u.id AS user_id, u.name, u.email, scw.balance, scw.total_earned, scw.total_redeemed, scw.total_expired, scw.updated_at
     FROM super_coin_wallets scw
     JOIN users u ON u.id = scw.user_id
     ORDER BY scw.balance DESC, u.name ASC`
  );
  res.json(users);
}));

adminRouter.get('/transactions', asyncHandler(async (req, res) => {
  const [transactions] = await pool.execute(
    `SELECT sct.*, u.name AS customer_name, u.email AS customer_email, o.order_number, au.name AS admin_name
     FROM super_coin_transactions sct
     JOIN users u ON u.id = sct.user_id
     LEFT JOIN orders o ON o.id = sct.order_id
     LEFT JOIN users au ON au.id = sct.created_by
     ORDER BY sct.created_at DESC
     LIMIT 500`
  );
  res.json(transactions);
}));

adminRouter.post('/process-pending', asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await processPendingSuperCoinRewards(connection);
    await connection.commit();
    res.json({ message: 'Pending Super Coin rewards processed.', ...result });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

adminRouter.get('/dashboard', asyncHandler(async (req, res) => {
  const [[summary]] = await pool.execute(
    `SELECT
       COALESCE(SUM(total_earned), 0) AS totalCoinsIssued,
       COALESCE(SUM(total_redeemed), 0) AS totalCoinsRedeemed,
       COALESCE(SUM(total_expired), 0) AS totalExpiredCoins,
       COALESCE(SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END), 0) AS activeUsersWithCoins
     FROM super_coin_wallets`
  );
  const rule = await getActiveRule(pool);
  res.json({ summary, rule });
}));

adminRouter.post('/manual-adjust', asyncHandler(async (req, res) => {
  const userId = Number(req.body.userId || req.body.user_id);
  const adjustmentType = String(req.body.type || 'ADD').trim().toUpperCase();
  const coins = Math.max(1, Math.floor(Number(req.body.coins || 0)));
  const reason = String(req.body.reason || '').trim();
  if (!userId || !['ADD', 'DEDUCT'].includes(adjustmentType)) return res.status(400).json({ message: 'Valid user and adjustment type are required.' });
  if (!reason) return res.status(400).json({ message: 'Reason is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const wallet = await getWallet(connection, userId, true);
    if (adjustmentType === 'DEDUCT' && Number(wallet.balance || 0) < coins) {
      await connection.rollback();
      return res.status(400).json({ message: 'User does not have enough Super Coins.' });
    }
    const rule = await getActiveRule(connection);
    const status = adjustmentType === 'ADD' ? 'EARNED' : 'REVERSED';
    const type = adjustmentType === 'ADD' ? 'EARNED' : 'REVERSED';
    await connection.execute(
      `UPDATE super_coin_wallets
       SET balance = balance ${adjustmentType === 'ADD' ? '+' : '-'} ?,
           total_earned = total_earned + ?
       WHERE user_id = ?`,
      [coins, adjustmentType === 'ADD' ? coins : 0, userId]
    );
    await connection.execute(
      `INSERT INTO super_coin_transactions (user_id, type, coins, rupee_value, description, expiry_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ${adjustmentType === 'ADD' ? 'DATE_ADD(CURDATE(), INTERVAL ? DAY)' : 'NULL'}, ?, ?)`,
      adjustmentType === 'ADD'
        ? [userId, type, coins, money(coins * Number(rule.coin_value_in_rupees || 1)), reason, Number(rule.expiry_days || 365), status, req.user.id]
        : [userId, type, coins, money(coins * Number(rule.coin_value_in_rupees || 1)), reason, status, req.user.id]
    );
    await connection.commit();
    res.status(201).json({ message: 'Manual Super Coin adjustment saved.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

module.exports = { router, adminRouter, estimateEarnCoins };
