const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { normalizeMobileNumber, isValidMobileNumber } = require('../utils/mobile');

const router = express.Router();
router.use(authenticate);

let defaultColumnReady = false;

async function ensureDefaultColumn() {
  if (defaultColumnReady) return;
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saved_payment_methods' AND COLUMN_NAME = 'is_default'`
  );
  if (!rows.length) {
    await pool.query('ALTER TABLE saved_payment_methods ADD COLUMN is_default BOOLEAN DEFAULT FALSE');
  }
  defaultColumnReady = true;
}

function digitsOnly(value = '') {
  return String(value).replace(/\D/g, '');
}

function parseMethod(row) {
  return {
    ...row,
    is_default: Boolean(row.is_default),
    details: JSON.parse(row.details || '{}')
  };
}

function cardType(cardNumber) {
  if (/^4/.test(cardNumber)) return 'Visa';
  if (/^5[1-5]/.test(cardNumber)) return 'Mastercard';
  if (/^3[47]/.test(cardNumber)) return 'American Express';
  if (/^6/.test(cardNumber)) return 'RuPay/Discover';
  return 'Card';
}

function sanitizePaymentMethod(body = {}) {
  const type = String(body.type || '').trim();

  if (type === 'UPI') {
    const upiId = String(body.upiId || '').trim();
    const accountHolder = String(body.accountHolder || '').trim();
    const phone = normalizeMobileNumber(body.phone || '');

    if (!accountHolder || !/^[\w.-]+@[\w.-]+$/.test(upiId) || !isValidMobileNumber(phone)) {
      return { error: 'Enter a valid UPI name, UPI ID, and 10 digit mobile number.' };
    }

    return {
      value: {
        type,
        label: `${upiId} - ${phone}`,
        details: { accountHolder, upiId, phone }
      }
    };
  }

  if (type === 'Card') {
    const cardholder = String(body.cardholder || '').trim();
    const cardNumber = digitsOnly(body.cardNumber || '');
    const expiry = String(body.expiry || '').trim();
    const billingPhone = normalizeMobileNumber(body.billingPhone || '');

    if (!cardholder || cardNumber.length < 13 || !/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry) || !isValidMobileNumber(billingPhone)) {
      return { error: 'Enter a valid card name, card number, expiry, and 10 digit billing phone.' };
    }

    return {
      value: {
        type,
        label: `**** **** **** ${cardNumber.slice(-4)}`,
        details: {
          cardholder,
          maskedCardNumber: `**** **** **** ${cardNumber.slice(-4)}`,
          cardType: cardType(cardNumber),
          lastFour: cardNumber.slice(-4),
          expiry,
          expiryMonth: expiry.slice(0, 2),
          expiryYear: `20${expiry.slice(3)}`,
          billingPhone
        }
      }
    };
  }

  return { error: 'Choose UPI or Card.' };
}

async function savePaymentMethod(userId, payload) {
  await ensureDefaultColumn();
  const sanitized = sanitizePaymentMethod(payload);
  if (sanitized.error) return sanitized;

  const { type, label, details } = sanitized.value;
  const makeDefault = Boolean(payload.isDefault);
  if (makeDefault) {
    await pool.execute('UPDATE saved_payment_methods SET is_default = FALSE WHERE user_id = ? AND type = ?', [userId, type]);
  }
  const [result] = await pool.execute(
    'INSERT INTO saved_payment_methods (user_id, type, label, details, is_default) VALUES (?, ?, ?, ?, ?)',
    [userId, type, label, JSON.stringify(details), makeDefault]
  );

  return { value: { id: result.insertId, type, label, details, is_default: makeDefault } };
}

router.get('/', asyncHandler(async (req, res) => {
  await ensureDefaultColumn();
  const [rows] = await pool.execute(
    'SELECT id, type, label, details, is_default, created_at FROM saved_payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
    [req.user.id]
  );
  res.json(rows.map(parseMethod));
}));

router.post('/', asyncHandler(async (req, res) => {
  const saved = await savePaymentMethod(req.user.id, req.body);
  if (saved.error) return res.status(400).json({ message: saved.error });
  res.status(201).json(saved.value);
}));

router.patch('/:id/default', asyncHandler(async (req, res) => {
  await ensureDefaultColumn();
  const [[method]] = await pool.execute('SELECT id, type FROM saved_payment_methods WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!method) return res.status(404).json({ message: 'Payment method not found.' });
  await pool.execute('UPDATE saved_payment_methods SET is_default = FALSE WHERE user_id = ? AND type = ?', [req.user.id, method.type]);
  await pool.execute('UPDATE saved_payment_methods SET is_default = TRUE WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Default payment method updated.' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await ensureDefaultColumn();
  await pool.execute('DELETE FROM saved_payment_methods WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Payment method removed.' });
}));

module.exports = { router, savePaymentMethod };
