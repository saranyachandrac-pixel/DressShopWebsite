const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { signToken, authenticate } = require('../middleware/auth');
const { sendPasswordReset } = require('../services/mail');
const { normalizeMobileNumber, isValidMobileNumber } = require('../utils/mobile');
const { createWalletForUser } = require('../services/walletService');

const router = express.Router();

router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ message: 'Name, valid email and password of 6+ characters are required.' });
  }

  const hashed = await bcrypt.hash(password, 10);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email.toLowerCase(), hashed, 'USER']
    );
    await createWalletForUser(connection, result.insertId);
    await connection.commit();
    const user = { id: result.insertId, name, email: email.toLowerCase(), mobile: null, role: 'USER' };
    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Email already exists.' });
    }
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const userId = String(email || '').trim().toLowerCase();
  const loginPassword = String(password || '').trim();

  if (!userId || !loginPassword) {
    return res.status(400).json({ message: 'User ID/email and password are required.' });
  }

  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [userId]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(loginPassword, user.password))) {
    return res.status(401).json({ message: 'Invalid login credentials.' });
  }

  const safeUser = { id: user.id, name: user.name, email: user.email, mobile: user.mobile, role: user.role };
  res.json({ token: signToken(safeUser), user: safeUser });
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required.' });

  const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (rows.length) {
    const temporaryPassword = crypto.randomBytes(4).toString('hex');
    const hashed = await bcrypt.hash(temporaryPassword, 10);
    await pool.execute('UPDATE users SET password = ? WHERE email = ?', [hashed, email.toLowerCase()]);
    await sendPasswordReset(email.toLowerCase(), temporaryPassword);
  }

  res.json({ message: 'If the account exists, a reset email has been sent.' });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, name, email, mobile, role, created_at FROM users WHERE id = ?', [req.user.id]);
  res.json(rows[0]);
}));

router.put('/me', authenticate, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const mobile = normalizeMobileNumber(req.body.mobile || '');

  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required.' });
  }
  if (mobile && !isValidMobileNumber(mobile)) {
    return res.status(400).json({ message: 'Mobile number must be exactly 10 digits.' });
  }

  try {
    await pool.execute(
      'UPDATE users SET name = ?, email = ?, mobile = ? WHERE id = ?',
      [name, email, mobile || null, req.user.id]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Email already exists.' });
    }
    throw error;
  }

  const [rows] = await pool.execute('SELECT id, name, email, mobile, role, created_at FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  res.json({ token: signToken(user), user });
}));

module.exports = router;
