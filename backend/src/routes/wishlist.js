const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT w.id AS wishlist_id, w.created_at AS saved_at, p.*
     FROM wishlists w
     JOIN products p ON p.id = w.product_id
     WHERE w.user_id = ?
     ORDER BY w.created_at DESC`,
    [req.user.id]
  );
  res.json({ items });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { productId } = req.body;
  const [[product]] = await pool.execute('SELECT id FROM products WHERE id = ?', [productId]);
  if (!product) return res.status(404).json({ message: 'Product not found.' });

  await pool.execute(
    `INSERT INTO wishlists (user_id, product_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE created_at = created_at`,
    [req.user.id, productId]
  );
  res.status(201).json({ message: 'Product saved to wishlist.' });
}));

router.delete('/:productId', asyncHandler(async (req, res) => {
  await pool.execute('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?', [req.user.id, req.params.productId]);
  res.json({ message: 'Product removed from wishlist.' });
}));

module.exports = router;
