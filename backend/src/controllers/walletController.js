const pool = require('../config/db');
const {
  addMoney,
  createWalletForUser,
  getWalletDashboard,
  getWalletForUser,
  payOrder,
  refundOrder,
  sendMoney
} = require('../services/walletService');

async function createWallet(req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const wallet = await createWalletForUser(connection, req.user.id);
    await connection.commit();
    res.status(201).json({ wallet });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getBalance(req, res) {
  const { wallet, transactions } = await getWalletDashboard(pool, req.user.id, 5);
  res.json({
    wallet: {
      id: wallet.id,
      walletNumber: wallet.wallet_number,
      balance: Number(wallet.balance || 0),
      status: wallet.wallet_status,
      createdAt: wallet.created_at
    },
    recentTransactions: transactions
  });
}

async function addWalletMoney(req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await addMoney(connection, req.user.id, req.body.amount, {
      paymentMethod: req.body.paymentMethod,
      simulateFailure: req.body.simulateFailure
    }, `Money added via ${req.body.paymentMethod || 'payment method'}`);
    if (result.error) {
      await connection.rollback();
      return res.status(400).json({ message: result.error });
    }
    const wallet = await getWalletForUser(connection, req.user.id);
    await connection.commit();
    res.json({ message: 'Money added to wallet.', wallet, transactionId: result.transactionId });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sendWalletMoney(req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await sendMoney(connection, req.user.id, req.body.receiver, req.body.amount, req.body.note);
    if (result.error) {
      await connection.rollback();
      return res.status(400).json({ message: result.error });
    }
    await connection.commit();
    res.json({ message: 'Money sent successfully.', receiver: result.receiver });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getHistory(req, res) {
  const wallet = await getWalletForUser(pool, req.user.id);
  const [transactions] = await pool.execute(
    `SELECT wt.*, su.email AS sender_email, ru.email AS receiver_email
     FROM wallet_transactions wt
     LEFT JOIN users su ON su.id = wt.sender_id
     LEFT JOIN users ru ON ru.id = wt.receiver_id
     WHERE wt.wallet_id = ?
     ORDER BY wt.created_at DESC`,
    [wallet.id]
  );
  res.json({ wallet, transactions });
}

async function payExistingOrder(req, res) {
  const orderId = Number(req.body.orderId);
  if (!orderId) return res.status(400).json({ message: 'orderId is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.execute(
      `SELECT * FROM orders
       WHERE id = ? AND user_id = ? AND paid_status <> 'PAID'
       FOR UPDATE`,
      [orderId, req.user.id]
    );
    if (!order) {
      await connection.rollback();
      return res.status(404).json({ message: 'Payable order not found.' });
    }

    const result = await payOrder(connection, req.user.id, order.id, order.order_number, order.total_amount);
    if (result.error) {
      await connection.rollback();
      return res.status(400).json({ message: result.error });
    }
    await connection.execute(
      `UPDATE orders SET payment_method = 'Wallet', paid_status = 'PAID', payment_details = ? WHERE id = ?`,
      [JSON.stringify({ walletPayment: true }), order.id]
    );
    await connection.commit();
    res.json({ message: 'Order paid using wallet.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function refundWalletPayment(req, res) {
  const orderId = Number(req.body.orderId);
  if (!orderId) return res.status(400).json({ message: 'orderId is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!order) {
      await connection.rollback();
      return res.status(404).json({ message: 'Order not found.' });
    }

    const result = await refundOrder(connection, order);
    if (result.error) {
      await connection.rollback();
      return res.status(400).json({ message: result.error });
    }
    await connection.execute(
      `UPDATE orders SET paid_status = 'REFUNDED', delivery_status = 'REFUNDED' WHERE id = ?`,
      [order.id]
    );
    await connection.commit();
    res.json({ message: result.skipped ? 'Refund already processed or not required.' : 'Refund processed to wallet.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  createWallet,
  getBalance,
  addWalletMoney,
  sendWalletMoney,
  getHistory,
  payExistingOrder,
  refundWalletPayment
};
