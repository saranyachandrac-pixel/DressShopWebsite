const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { normalizeMobileNumber, isValidMobileNumber } = require('../utils/mobile');

const router = express.Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const [addresses] = await pool.execute('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC', [req.user.id]);
  res.json(addresses);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { full_name, phone, line1, line2, city, state, pincode, is_default } = req.body;
  if (!full_name || !phone || !line1 || !city || !state || !pincode) {
    return res.status(400).json({ message: 'Complete delivery address is required.' });
  }
  if (!isValidMobileNumber(phone)) {
    return res.status(400).json({ message: 'Mobile number must be exactly 10 digits.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (is_default) await connection.execute('UPDATE addresses SET is_default = FALSE WHERE user_id = ?', [req.user.id]);
    const [result] = await connection.execute(
      `INSERT INTO addresses (user_id, full_name, phone, line1, line2, city, state, pincode, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, full_name, normalizeMobileNumber(phone), line1, line2 || null, city, state, pincode, Boolean(is_default)]
    );
    await connection.commit();
    res.status(201).json({ id: result.insertId, message: 'Address saved.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

module.exports = router;
