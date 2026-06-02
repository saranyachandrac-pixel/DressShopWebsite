const DEFAULT_RETURN_PERIOD_DAYS = Number(process.env.SUPER_COIN_RETURN_PERIOD_DAYS || 7);
let rewardSchemaReady = false;

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function positiveInt(value) {
  return Math.max(0, Math.floor(Number(value || 0)));
}

async function getActiveRule(connection) {
  const [[rule]] = await connection.execute(
    `SELECT *
     FROM super_coin_rules
     WHERE is_active = TRUE
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  );
  return rule || {
    id: null,
    rule_name: 'Default Super Coin Rule',
    coins_per_amount: 2,
    amount_unit: 100,
    first_order_bonus: 50,
    review_bonus: 10,
    referral_bonus: 100,
    max_redeem_percentage: 10,
    coin_value_in_rupees: 1,
    expiry_days: 365,
    is_active: true
  };
}

async function ensureRewardSchema(connection) {
  if (rewardSchemaReady) return;
  const columns = [
    ['orders', 'delivered_at', 'delivered_at DATETIME NULL'],
    ['orders', 'super_coin_awarded', 'super_coin_awarded TINYINT(1) NOT NULL DEFAULT 0'],
    ['orders', 'super_coin_eligible_at', 'super_coin_eligible_at DATETIME NULL'],
    ['order_items', 'return_days', 'return_days INT NOT NULL DEFAULT 0'],
    ['order_items', 'replacement_days', 'replacement_days INT NOT NULL DEFAULT 0'],
    ['super_coin_transactions', 'reward_type', 'reward_type VARCHAR(50) NULL'],
    ['super_coin_transactions', 'reference_type', 'reference_type VARCHAR(50) NULL'],
    ['super_coin_transactions', 'reference_id', 'reference_id INT NULL']
  ];
  for (const [table, column, definition] of columns) {
    const [rows] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (!rows.length) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  }
  await connection.query(`
    CREATE TABLE IF NOT EXISTS pending_super_coin_rewards (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      coins INT NOT NULL,
      reward_type VARCHAR(50) NOT NULL,
      reference_type VARCHAR(50) NOT NULL,
      reference_id INT NOT NULL,
      eligible_at DATETIME NOT NULL,
      status ENUM('PENDING','CREDITED','CANCELLED') NOT NULL DEFAULT 'PENDING',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      credited_at DATETIME NULL,
      UNIQUE KEY unique_pending_reward (reward_type, reference_type, reference_id),
      INDEX idx_pending_rewards_status_date (status, eligible_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await connection.query('UPDATE orders SET delivered_at = COALESCE(delivered_at, delivered_on) WHERE delivered_at IS NULL AND delivered_on IS NOT NULL');
  rewardSchemaReady = true;
}

async function getWallet(connection, userId, lock = false) {
  const [[existing]] = await connection.execute(
    `SELECT * FROM super_coin_wallets WHERE user_id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [userId]
  );
  if (existing) return existing;

  await connection.execute('INSERT INTO super_coin_wallets (user_id) VALUES (?)', [userId]);
  const [[wallet]] = await connection.execute(
    `SELECT * FROM super_coin_wallets WHERE user_id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [userId]
  );
  return wallet;
}

async function hasActivePostDeliveryRequest(connection, { orderId = null, orderItemId = null }) {
  const where = [];
  const params = [];
  if (orderId) {
    where.push('order_id = ?');
    params.push(orderId);
  }
  if (orderItemId) {
    where.push('order_item_id = ?');
    params.push(orderItemId);
  }
  if (!where.length) return false;
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM post_delivery_requests
     WHERE ${where.join(' AND ')}
       AND request_status IN ('PENDING', 'APPROVED')
       AND COALESCE(refund_status, 'PENDING') <> 'REFUNDED'`,
    params
  );
  return Number(row.count || 0) > 0;
}

function addDays(dateValue, days) {
  const date = new Date(dateValue);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function mysqlDateTime(date) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

async function creditReward(connection, { userId, orderId = null, coins, rewardType, referenceType, referenceId, description }) {
  await ensureRewardSchema(connection);
  const [[existing]] = await connection.execute(
    `SELECT id FROM super_coin_transactions
     WHERE reward_type = ? AND reference_type = ? AND reference_id = ?
     LIMIT 1`,
    [rewardType, referenceType, referenceId]
  );
  if (existing || Number(coins || 0) <= 0) return { skipped: true };

  const rule = await getActiveRule(connection);
  const wallet = await getWallet(connection, userId, true);
  const safeCoins = positiveInt(coins);
  await connection.execute(
    `UPDATE super_coin_wallets
     SET balance = balance + ?,
         total_earned = total_earned + ?
     WHERE id = ?`,
    [safeCoins, safeCoins, wallet.id]
  );
  await connection.execute(
    `INSERT INTO super_coin_transactions
      (user_id, order_id, type, coins, rupee_value, description, expiry_date, status, reward_type, reference_type, reference_id)
     VALUES (?, ?, 'EARNED', ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), 'EARNED', ?, ?, ?)`,
    [
      userId,
      orderId,
      safeCoins,
      money(safeCoins * Number(rule.coin_value_in_rupees || 1)),
      description,
      Number(rule.expiry_days || 365),
      rewardType,
      referenceType,
      referenceId
    ]
  );
  return { credited: true, coins: safeCoins };
}

async function createPendingReward(connection, { userId, coins, rewardType, referenceType, referenceId, eligibleAt }) {
  await ensureRewardSchema(connection);
  if (Number(coins || 0) <= 0 || !eligibleAt) return { skipped: true };
  await connection.execute(
    `INSERT INTO pending_super_coin_rewards (user_id, coins, reward_type, reference_type, reference_id, eligible_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
     ON DUPLICATE KEY UPDATE
       coins = VALUES(coins),
       eligible_at = VALUES(eligible_at),
       status = IF(status = 'CREDITED', status, 'PENDING')`,
    [userId, positiveInt(coins), rewardType, referenceType, referenceId, mysqlDateTime(eligibleAt)]
  );
  return { pending: true };
}

async function getMaxReplacementDays(connection, orderId) {
  const [[row]] = await connection.execute(
    `SELECT COALESCE(MAX(GREATEST(COALESCE(return_days, 0), COALESCE(replacement_days, 0))), 0) AS max_days
     FROM order_items
     WHERE order_id = ?`,
    [orderId]
  );
  return Number(row.max_days || 0);
}

async function handleDeliveredOrderSuperCoins(connection, orderId, deliveredAt = new Date()) {
  await ensureRewardSchema(connection);
  const [[order]] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  if (!order || order.delivery_status !== 'DELIVERED') return { skipped: true };
  const maxDays = await getMaxReplacementDays(connection, orderId);
  const eligibleAt = addDays(deliveredAt, maxDays);
  await connection.execute(
    `UPDATE orders
     SET delivered_at = COALESCE(delivered_at, ?),
         delivered_on = COALESCE(delivered_on, ?),
         super_coin_eligible_at = ?
     WHERE id = ?`,
    [mysqlDateTime(deliveredAt), mysqlDateTime(deliveredAt), mysqlDateTime(eligibleAt), orderId]
  );

  if (maxDays > 0 && eligibleAt > new Date()) {
    await createPendingOrderSuperCoinReward(connection, orderId, eligibleAt);
    return { pending: true, eligibleAt };
  }
  return awardOrderSuperCoins(connection, orderId);
}

async function createPendingOrderSuperCoinReward(connection, orderId, eligibleAt) {
  await ensureRewardSchema(connection);
  const [[detail]] = await connection.execute(
    `SELECT oscd.*, o.user_id
     FROM order_super_coin_details oscd
     JOIN orders o ON o.id = oscd.order_id
     WHERE oscd.order_id = ?`,
    [orderId]
  );
  if (!detail) return { skipped: true };
  return createPendingReward(connection, {
    userId: detail.user_id,
    coins: detail.coins_to_earn,
    rewardType: 'ORDER_DELIVERED',
    referenceType: 'ORDER',
    referenceId: orderId,
    eligibleAt
  });
}

async function awardOrderSuperCoins(connection, orderId) {
  await ensureRewardSchema(connection);
  const [[detail]] = await connection.execute(
    `SELECT oscd.*, o.order_number, o.delivery_status, o.paid_status, o.super_coin_awarded
     FROM order_super_coin_details oscd
     JOIN orders o ON o.id = oscd.order_id
     WHERE oscd.order_id = ?
     FOR UPDATE`,
    [orderId]
  );
  if (!detail || detail.delivery_status !== 'DELIVERED' || Number(detail.super_coin_awarded || 0) === 1) return { skipped: true };
  if (detail.earn_status === 'EARNED') {
    await connection.execute('UPDATE orders SET super_coin_awarded = 1 WHERE id = ?', [orderId]);
    return { skipped: true };
  }
  if (detail.paid_status === 'REFUNDED') return { skipped: true };
  if (await hasActivePostDeliveryRequest(connection, { orderId })) return { skipped: true };

  const result = await creditReward(connection, {
    userId: detail.user_id,
    orderId,
    coins: detail.coins_to_earn,
    rewardType: 'ORDER_DELIVERED',
    referenceType: 'ORDER',
    referenceId: orderId,
    description: `Earned from delivered order ${detail.order_number || orderId}`
  });
  if (result.credited) {
    await connection.execute(
      `UPDATE order_super_coin_details SET earn_status = 'EARNED', earned_at = NOW() WHERE order_id = ?`,
      [orderId]
    );
    await connection.execute(
      'UPDATE orders SET super_coin_awarded = 1, super_coins_earned = ? WHERE id = ?',
      [result.coins, orderId]
    );
  }
  return result;
}

async function awardReviewBonus(connection, reviewId) {
  await ensureRewardSchema(connection);
  const [[review]] = await connection.execute(
    `SELECT pr.*, o.delivery_status, o.delivered_at, o.delivered_on, o.paid_status, oi.replacement_days, oi.return_days
     FROM product_reviews pr
     JOIN orders o ON o.id = pr.order_id
     JOIN order_items oi ON oi.id = pr.order_item_id
     WHERE pr.id = ?
     FOR UPDATE`,
    [reviewId]
  );
  if (!review || review.delivery_status !== 'DELIVERED' || review.paid_status === 'REFUNDED') return { skipped: true };
  if (await hasActivePostDeliveryRequest(connection, { orderItemId: review.order_item_id })) return { skipped: true };
  const rule = await getActiveRule(connection);
  const coins = Number(rule.review_bonus || 5) || 5;
  const days = Math.max(Number(review.replacement_days || 0), Number(review.return_days || 0));
  const deliveredAt = review.delivered_at || review.delivered_on || new Date();
  const eligibleAt = addDays(deliveredAt, days);
  if (days > 0 && eligibleAt > new Date()) {
    return createPendingReward(connection, {
      userId: review.user_id,
      coins,
      rewardType: 'REVIEW_BONUS',
      referenceType: 'ORDER_ITEM',
      referenceId: review.order_item_id,
      eligibleAt
    });
  }
  return creditReward(connection, {
    userId: review.user_id,
    orderId: review.order_id,
    coins,
    rewardType: 'REVIEW_BONUS',
    referenceType: 'ORDER_ITEM',
    referenceId: review.order_item_id,
    description: 'Review bonus'
  });
}

async function processPendingSuperCoinRewards(connection) {
  await ensureRewardSchema(connection);
  const [pending] = await connection.execute(
    `SELECT * FROM pending_super_coin_rewards
     WHERE status = 'PENDING' AND eligible_at <= NOW()
     ORDER BY eligible_at ASC
     LIMIT 100`
  );
  let credited = 0;
  for (const reward of pending) {
    let result = { skipped: true };
    if (reward.reward_type === 'ORDER_DELIVERED' && reward.reference_type === 'ORDER') {
      result = await awardOrderSuperCoins(connection, reward.reference_id);
    } else if (reward.reward_type === 'REVIEW_BONUS' && reward.reference_type === 'ORDER_ITEM') {
      const [[review]] = await connection.execute(
        'SELECT id FROM product_reviews WHERE order_item_id = ? ORDER BY id DESC LIMIT 1',
        [reward.reference_id]
      );
      if (review) result = await awardReviewBonus(connection, review.id);
    }
    if (result.credited) {
      credited += 1;
      await connection.execute(
        "UPDATE pending_super_coin_rewards SET status = 'CREDITED', credited_at = NOW() WHERE id = ?",
        [reward.id]
      );
    }
  }
  return { processed: pending.length, credited };
}

async function expireUserCoins(connection, userId) {
  const wallet = await getWallet(connection, userId, true);
  const [[earnedExpired]] = await connection.execute(
    `SELECT COALESCE(SUM(coins), 0) AS coins
     FROM super_coin_transactions
     WHERE user_id = ?
       AND status = 'EARNED'
       AND expiry_date IS NOT NULL
       AND expiry_date < CURDATE()`,
    [userId]
  );
  const expiredAlready = Number(wallet.total_expired || 0);
  const redeemBuffer = Number(wallet.total_redeemed || 0);
  const coinsToExpire = Math.min(Number(wallet.balance || 0), Math.max(0, Number(earnedExpired.coins || 0) - expiredAlready - redeemBuffer));
  if (coinsToExpire <= 0) return wallet;

  await connection.execute(
    `UPDATE super_coin_wallets
     SET balance = GREATEST(balance - ?, 0),
         total_expired = total_expired + ?
     WHERE user_id = ?`,
    [coinsToExpire, coinsToExpire, userId]
  );
  await connection.execute(
    `INSERT INTO super_coin_transactions (user_id, type, coins, rupee_value, description, status)
     VALUES (?, 'EXPIRED', ?, 0, 'Expired Super Coins', 'EXPIRED')`,
    [userId, coinsToExpire]
  );
  return getWallet(connection, userId, true);
}

function estimateEarnCoins(rule, orderAmount, hasPreviousOrders = true) {
  const unit = Number(rule.amount_unit || 100) || 100;
  const perUnit = Number(rule.coins_per_amount || 0);
  const base = Math.floor((Number(orderAmount || 0) / unit) * perUnit);
  return Math.max(0, base + (hasPreviousOrders ? 0 : Number(rule.first_order_bonus || 0)));
}

async function getEarnEstimate(connection, userId, orderAmount) {
  const rule = await getActiveRule(connection);
  const [[orders]] = await connection.execute('SELECT COUNT(*) AS count FROM orders WHERE user_id = ?', [userId]);
  return {
    coins: estimateEarnCoins(rule, orderAmount, Number(orders.count || 0) > 0),
    rule
  };
}

async function validateRedemption(connection, userId, orderAmount, requestedCoins) {
  const rule = await getActiveRule(connection);
  await expireUserCoins(connection, userId);
  const wallet = await getWallet(connection, userId, true);
  const coins = positiveInt(requestedCoins);
  const coinValue = Number(rule.coin_value_in_rupees || 1) || 1;
  const maxByPercent = Math.floor((money(orderAmount) * Number(rule.max_redeem_percentage || 0)) / 100 / coinValue);
  const maxRedeemableCoins = Math.max(0, Math.min(Number(wallet.balance || 0), maxByPercent));

  if (coins <= 0) {
    return { coins: 0, value: 0, wallet, rule, maxRedeemableCoins };
  }
  if (coins > Number(wallet.balance || 0)) return { error: 'You do not have enough Super Coins.' };
  if (coins > maxRedeemableCoins) return { error: `You can redeem up to ${maxRedeemableCoins} Super Coins for this order.` };

  return {
    coins,
    value: money(coins * coinValue),
    wallet,
    rule,
    maxRedeemableCoins
  };
}

async function redeemForOrder(connection, userId, orderId, orderNumber, orderAmount, requestedCoins) {
  const redemption = await validateRedemption(connection, userId, orderAmount, requestedCoins);
  if (redemption.error || redemption.coins <= 0) return redemption;

  await connection.execute(
    `UPDATE super_coin_wallets
     SET balance = balance - ?,
         total_redeemed = total_redeemed + ?
     WHERE user_id = ?`,
    [redemption.coins, redemption.coins, userId]
  );
  await connection.execute(
    `INSERT INTO super_coin_transactions (user_id, order_id, type, coins, rupee_value, description, status)
     VALUES (?, ?, 'REDEEMED', ?, ?, ?, 'REDEEMED')`,
    [userId, orderId, redemption.coins, redemption.value, `Redeemed on order ${orderNumber || orderId}`]
  );
  return redemption;
}

async function createOrderDetail(connection, { orderId, userId, coinsRedeemed, redeemValue, coinsToEarn }) {
  await connection.execute(
    `INSERT INTO order_super_coin_details
      (order_id, user_id, coins_redeemed, redeem_value, coins_to_earn, earn_status)
     VALUES (?, ?, ?, ?, ?, 'PENDING')
     ON DUPLICATE KEY UPDATE
       coins_redeemed = VALUES(coins_redeemed),
       redeem_value = VALUES(redeem_value),
       coins_to_earn = VALUES(coins_to_earn)`,
    [orderId, userId, positiveInt(coinsRedeemed), money(redeemValue), positiveInt(coinsToEarn)]
  );
}

async function markOrderEligible(connection, orderId) {
  await connection.execute(
    `UPDATE order_super_coin_details
     SET earn_status = 'ELIGIBLE'
     WHERE order_id = ? AND earn_status = 'PENDING'`,
    [orderId]
  );
}

async function creditMaturedOrderCoins(connection, orderId = null) {
  await ensureRewardSchema(connection);
  if (orderId) return awardOrderSuperCoins(connection, orderId);
  return processPendingSuperCoinRewards(connection);
}

async function reverseOrderCoins(connection, order) {
  const [[detail]] = await connection.execute(
    'SELECT * FROM order_super_coin_details WHERE order_id = ? FOR UPDATE',
    [order.id || order.order_id || order.orderId]
  );
  if (!detail) return { skipped: true };

  if (Number(detail.coins_redeemed || 0) > 0) {
    const [[existingRedeemReverse]] = await connection.execute(
      `SELECT id FROM super_coin_transactions
       WHERE order_id = ? AND user_id = ? AND type = 'REVERSED' AND description LIKE 'Refunded redeemed%'
       LIMIT 1`,
      [detail.order_id, detail.user_id]
    );
    if (!existingRedeemReverse) {
      await getWallet(connection, detail.user_id, true);
      await connection.execute(
        `UPDATE super_coin_wallets
         SET balance = balance + ?,
             total_redeemed = GREATEST(total_redeemed - ?, 0)
         WHERE user_id = ?`,
        [detail.coins_redeemed, detail.coins_redeemed, detail.user_id]
      );
      await connection.execute(
        `INSERT INTO super_coin_transactions (user_id, order_id, type, coins, rupee_value, description, status)
         VALUES (?, ?, 'REVERSED', ?, ?, ?, 'REVERSED')`,
        [detail.user_id, detail.order_id, detail.coins_redeemed, detail.redeem_value, `Refunded redeemed Super Coins for order ${order.order_number || detail.order_id}`]
      );
    }
  }

  if (detail.earn_status === 'EARNED') {
    const [[existingEarnReverse]] = await connection.execute(
      `SELECT id FROM super_coin_transactions
       WHERE order_id = ? AND user_id = ? AND type = 'REVERSED' AND description LIKE 'Reversed earned%'
       LIMIT 1`,
      [detail.order_id, detail.user_id]
    );
    if (!existingEarnReverse) {
      await getWallet(connection, detail.user_id, true);
      await connection.execute(
        `UPDATE super_coin_wallets
         SET balance = GREATEST(balance - ?, 0)
         WHERE user_id = ?`,
        [detail.coins_to_earn, detail.user_id]
      );
      await connection.execute(
        `INSERT INTO super_coin_transactions (user_id, order_id, type, coins, rupee_value, description, status)
         VALUES (?, ?, 'REVERSED', ?, ?, ?, 'REVERSED')`,
        [detail.user_id, detail.order_id, detail.coins_to_earn, detail.coins_to_earn, `Reversed earned Super Coins for order ${order.order_number || detail.order_id}`]
      );
    }
  }

  await connection.execute(
    `UPDATE order_super_coin_details
     SET earn_status = 'REVERSED',
         reversed_at = NOW()
     WHERE id = ? AND earn_status <> 'REVERSED'`,
    [detail.id]
  );
  return { reversed: true };
}

module.exports = {
  money,
  getActiveRule,
  getWallet,
  expireUserCoins,
  estimateEarnCoins,
  getEarnEstimate,
  validateRedemption,
  redeemForOrder,
  createOrderDetail,
  markOrderEligible,
  creditMaturedOrderCoins,
  ensureRewardSchema,
  handleDeliveredOrderSuperCoins,
  awardOrderSuperCoins,
  createPendingOrderSuperCoinReward,
  processPendingSuperCoinRewards,
  awardReviewBonus,
  reverseOrderCoins
};
