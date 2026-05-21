const crypto = require('crypto');

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function assertPositiveAmount(amount) {
  const normalized = money(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return { error: 'Amount must be greater than 0.' };
  }
  return { amount: normalized };
}

function walletNumberForUser(userId) {
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `WLT${String(userId).padStart(8, '0')}${suffix}`;
}

async function createWalletForUser(connection, userId) {
  const [[existing]] = await connection.execute('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  if (existing) return existing;

  const walletNumber = walletNumberForUser(userId);
  await connection.execute(
    'INSERT INTO wallets (user_id, wallet_number, balance, wallet_status) VALUES (?, ?, 0, ?)',
    [userId, walletNumber, 'ACTIVE']
  );
  const [[wallet]] = await connection.execute('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  return wallet;
}

async function getWalletForUser(connection, userId, lock = false) {
  const [[wallet]] = await connection.execute(
    `SELECT * FROM wallets WHERE user_id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [userId]
  );
  return wallet || createWalletForUser(connection, userId);
}

async function getWalletDashboard(connection, userId, limit = 5) {
  const wallet = await getWalletForUser(connection, userId);
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 50);
  const [transactions] = await connection.execute(
    `SELECT wt.*, su.email AS sender_email, ru.email AS receiver_email
     FROM wallet_transactions wt
     LEFT JOIN users su ON su.id = wt.sender_id
     LEFT JOIN users ru ON ru.id = wt.receiver_id
     WHERE wt.wallet_id = ?
     ORDER BY wt.created_at DESC
     LIMIT ${safeLimit}`,
    [wallet.id]
  );
  return { wallet, transactions };
}

function transactionId(prefix = 'TXN') {
  return `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function addMoney(connection, userId, amount, payment = {}, note = 'Money added to wallet') {
  const validation = assertPositiveAmount(amount);
  if (validation.error) return { error: validation.error };

  const method = String(payment.paymentMethod || '').trim();
  if (!method) return { error: 'Payment method is required.' };
  if (payment.simulateFailure) return { error: 'Sandbox payment failed. Try another payment method.' };

  const wallet = await getWalletForUser(connection, userId, true);
  if (wallet.wallet_status !== 'ACTIVE') return { error: 'Wallet is not active.' };

  const id = transactionId('WAL');
  await connection.execute('UPDATE wallets SET balance = balance + ? WHERE id = ?', [validation.amount, wallet.id]);
  await connection.execute(
    `INSERT INTO wallet_transactions
      (user_id, sender_id, receiver_id, wallet_id, transaction_type, amount, payment_method, transaction_id, payment_status, status, transaction_note)
     VALUES (?, NULL, ?, ?, 'CREDIT', ?, ?, ?, 'SUCCESS', 'SUCCESS', ?)`,
    [userId, userId, wallet.id, validation.amount, method, id, note]
  );
  return { amount: validation.amount, transactionId: id };
}

async function sendMoney(connection, senderId, receiverIdentifier, amount, note = '') {
  const validation = assertPositiveAmount(amount);
  if (validation.error) return { error: validation.error };

  const identifier = String(receiverIdentifier || '').trim();
  if (!identifier) return { error: 'Receiver wallet number, email, or mobile is required.' };

  const [[receiver]] = await connection.execute(
    `SELECT u.id, u.email, u.mobile, w.wallet_number
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     WHERE w.wallet_number = ? OR u.email = ? OR u.mobile = ?
     LIMIT 1`,
    [identifier, identifier.toLowerCase(), identifier]
  );
  if (!receiver) return { error: 'Receiver not found.' };
  if (receiver.id === senderId) return { error: 'You cannot send money to your own wallet.' };

  const senderWallet = await getWalletForUser(connection, senderId, true);
  const receiverWallet = await getWalletForUser(connection, receiver.id, true);
  if (senderWallet.wallet_status !== 'ACTIVE' || receiverWallet.wallet_status !== 'ACTIVE') {
    return { error: 'Sender or receiver wallet is not active.' };
  }
  if (Number(senderWallet.balance) < validation.amount) {
    await connection.execute(
      `INSERT INTO wallet_transactions (sender_id, receiver_id, wallet_id, transaction_type, amount, status, transaction_note)
       VALUES (?, ?, ?, 'FAILED', ?, 'FAILED', ?)`,
      [senderId, receiver.id, senderWallet.id, validation.amount, 'Insufficient wallet balance']
    );
    return { error: 'Insufficient wallet balance.' };
  }

  await connection.execute('UPDATE wallets SET balance = balance - ? WHERE id = ?', [validation.amount, senderWallet.id]);
  await connection.execute('UPDATE wallets SET balance = balance + ? WHERE id = ?', [validation.amount, receiverWallet.id]);
  await connection.execute(
    `INSERT INTO wallet_transactions (sender_id, receiver_id, wallet_id, transaction_type, amount, status, transaction_note)
     VALUES (?, ?, ?, 'DEBIT', ?, 'SUCCESS', ?)`,
    [senderId, receiver.id, senderWallet.id, validation.amount, note || `Sent to ${identifier}`]
  );
  await connection.execute(
    `INSERT INTO wallet_transactions (sender_id, receiver_id, wallet_id, transaction_type, amount, status, transaction_note)
     VALUES (?, ?, ?, 'CREDIT', ?, 'SUCCESS', ?)`,
    [senderId, receiver.id, receiverWallet.id, validation.amount, note || 'Received wallet transfer']
  );

  return { amount: validation.amount, receiver };
}

async function payOrder(connection, userId, orderId, orderNumber, amount) {
  const validation = assertPositiveAmount(amount);
  if (validation.error) return { error: validation.error };

  const wallet = await getWalletForUser(connection, userId, true);
  if (wallet.wallet_status !== 'ACTIVE') return { error: 'Wallet is not active.' };
  if (Number(wallet.balance) < validation.amount) {
    await connection.execute(
      `INSERT INTO wallet_transactions (sender_id, receiver_id, wallet_id, transaction_type, amount, status, transaction_note)
       VALUES (?, NULL, ?, 'FAILED', ?, 'FAILED', ?)`,
      [userId, wallet.id, validation.amount, `Insufficient balance for order ${orderNumber || orderId}`]
    );
    return { error: 'Insufficient wallet balance.' };
  }

  await connection.execute('UPDATE wallets SET balance = balance - ? WHERE id = ?', [validation.amount, wallet.id]);
  await connection.execute(
    `INSERT INTO wallet_transactions (sender_id, receiver_id, wallet_id, transaction_type, amount, status, transaction_note)
     VALUES (?, NULL, ?, 'PAYMENT', ?, 'SUCCESS', ?)`,
    [userId, wallet.id, validation.amount, `Wallet payment for order ${orderNumber || orderId}`]
  );
  return { amount: validation.amount };
}

async function refundOrder(connection, order) {
  const amount = money(order.total_amount);
  if (amount <= 0) return { error: 'Refund amount must be greater than 0.' };
  if (order.payment_method !== 'Wallet') return { skipped: true };

  const wallet = await getWalletForUser(connection, order.user_id, true);
  const note = `Wallet refund for order ${order.order_number || order.id}`;
  const [[existingRefund]] = await connection.execute(
    `SELECT id FROM wallet_transactions
     WHERE wallet_id = ? AND transaction_type = 'REFUND' AND transaction_note = ?
     LIMIT 1`,
    [wallet.id, note]
  );
  if (existingRefund) return { skipped: true };

  await connection.execute('UPDATE wallets SET balance = balance + ? WHERE id = ?', [amount, wallet.id]);
  await connection.execute(
    `INSERT INTO wallet_transactions (sender_id, receiver_id, wallet_id, transaction_type, amount, status, transaction_note)
     VALUES (NULL, ?, ?, 'REFUND', ?, 'SUCCESS', ?)`,
    [order.user_id, wallet.id, amount, note]
  );
  return { amount };
}

module.exports = {
  createWalletForUser,
  getWalletForUser,
  getWalletDashboard,
  addMoney,
  sendMoney,
  payOrder,
  refundOrder,
  assertPositiveAmount
};
