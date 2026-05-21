const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { mapSaleProduct } = require('../utils/sale');
const { addCartItems } = require('../services/cartService');

const router = express.Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const [items] = await pool.execute(
    `SELECT p.*,
            cart_rows.id AS id,
            cart_rows.quantity,
            cart_rows.size AS selected_size,
            cart_rows.color AS selected_color,
            p.id AS product_id, p.discount AS product_discount
     FROM (
       SELECT MIN(id) AS id, product_id, size, color, SUM(quantity) AS quantity, MAX(created_at) AS created_at
       FROM (
         SELECT c.id,
                c.product_id,
                COALESCE(NULLIF(c.size, ''), p.size, '') AS size,
                COALESCE(NULLIF(c.color, ''), p.color, '') AS color,
                c.quantity,
                c.created_at
         FROM cart c
         JOIN products p ON p.id = c.product_id
         WHERE c.user_id = ?
       ) normalized_cart
       GROUP BY product_id, size, color
     ) cart_rows
     JOIN products p ON p.id = cart_rows.product_id
     ORDER BY cart_rows.created_at DESC`,
    [req.user.id]
  );
  const saleAwareItems = items.map((item) => {
    const product = mapSaleProduct(item);
    const linePrice = Number(product.originalPrice) * Number(item.quantity);
    const lineTotal = Number(product.effectivePrice) * Number(item.quantity);
    return {
      ...item,
      ...product,
      price: product.effectivePrice,
      line_price: linePrice,
      discount_percent: product.saleDiscountPercent || Math.min(Math.max(Number(item.product_discount) || 0, 0), 100),
      discount_amount: linePrice - lineTotal,
      line_total: lineTotal
    };
  });
  res.json({ items: saleAwareItems, cartItems: saleAwareItems, itemCount: saleAwareItems.length });
}));

router.post('/', asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await addCartItems(connection, req.user.id, [req.body]);
    await connection.commit();
    res.status(201).json({ message: 'Product added to cart.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/add-multiple', asyncHandler(async (req, res) => {
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!requestedItems.length) return res.status(400).json({ message: 'Select at least one item.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const count = await addCartItems(connection, req.user.id, requestedItems);
    await connection.commit();
    res.status(201).json({ message: `${count} item${count === 1 ? '' : 's'} added to cart.` });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { quantity, size, color } = req.body;
  const qty = Math.max(1, Number(quantity));
  const [[item]] = await pool.execute(
    `SELECT c.id, p.* FROM cart c JOIN products p ON p.id = c.product_id WHERE c.id = ? AND c.user_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!item) return res.status(404).json({ message: 'Cart item not found.' });
  const product = mapSaleProduct(item);
  if (product.isOnSale && qty > 1) {
    return res.status(400).json({ message: 'Summer Sale items are limited to 1 quantity per customer.' });
  }
  if (qty + Number(product.bogoFreeQuantity || 0) > item.stock) return res.status(400).json({ message: 'Only limited stock is available.' });

  const updates = [];
  const values = [];
  updates.push('quantity = ?');
  values.push(qty);
  if (size !== undefined) {
    updates.push('size = ?');
    values.push(String(size || '').trim());
  }
  if (color !== undefined) {
    updates.push('color = ?');
    values.push(String(color || '').trim());
  }
  values.push(req.params.id);
  values.push(req.user.id);

  await pool.execute(`UPDATE cart SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, values);
  res.json({ message: 'Cart updated.' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await pool.execute('DELETE FROM cart WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Cart item removed.' });
}));

router.delete('/', asyncHandler(async (req, res) => {
  await pool.execute('DELETE FROM cart WHERE user_id = ?', [req.user.id]);
  res.json({ message: 'Cart cleared.' });
}));

module.exports = router;
