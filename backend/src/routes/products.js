const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { calculateSalePrice, mapSaleProduct, saleDiscountPercent, validateSalePayload } = require('../utils/sale');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'products');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename(req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!file.mimetype.startsWith('image/')) {
      return callback(new Error('Only image files are allowed.'));
    }
    callback(null, true);
  }
});

function discountPercent(value) {
  return Math.min(Math.max(Number(value) || 0, 0), 100);
}

async function disableExpiredSales() {
  await pool.execute(
    `UPDATE products
     SET isOnSale = FALSE, saleType = NULL, saleValue = NULL, saleStartDate = NULL, saleEndDate = NULL
     WHERE (saleEndDate IS NOT NULL AND saleEndDate < CURDATE()) OR stock <= 0`
  );
}

function csvRows(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

// Lightweight cron replacement: keep sale flags clean without adding another runtime dependency.
setInterval(() => {
  disableExpiredSales().catch((error) => console.error('Sale cleanup failed:', error));
}, 60 * 60 * 1000);
disableExpiredSales().catch((error) => console.error('Sale cleanup failed:', error));

router.get('/', asyncHandler(async (req, res) => {
  await disableExpiredSales();
  const { category, brand, size, minPrice, maxPrice, search, onSale, saleRange } = req.query;
  const where = [];
  const params = [];

  where.push('(gender IS NULL OR gender <> ?)');
  params.push('men');
  if (category) { where.push('category = ?'); params.push(category); }
  if (brand) { where.push('brand = ?'); params.push(brand); }
  if (size) { where.push('size = ?'); params.push(size); }
  if (minPrice) { where.push('price >= ?'); params.push(Number(minPrice)); }
  if (maxPrice) { where.push('price <= ?'); params.push(Number(maxPrice)); }
  if (search) { where.push('(name LIKE ? OR description LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (onSale === 'true') {
    where.push('isOnSale = TRUE AND stock > 0 AND (saleEndDate IS NULL OR saleEndDate >= CURDATE())');
  }

  const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
  const [products] = await pool.execute(sql, params);
  const mappedProducts = products.map((product) => mapSaleProduct(product));
  const filteredProducts = saleRange
    ? mappedProducts.filter((product) => {
      const percent = Number(product.saleDiscountPercent) || 0;
      if (saleRange === '10-30') return percent >= 10 && percent < 30;
      if (saleRange === '30-50') return percent >= 30 && percent < 50;
      if (saleRange === '50+') return percent >= 50;
      return true;
    })
    : mappedProducts;

  const [categories] = await pool.query('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category');
  const [brands] = await pool.query('SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL ORDER BY brand');
  const [sizes] = await pool.query('SELECT DISTINCT size FROM products WHERE size IS NOT NULL ORDER BY size');

  res.json({
    products: filteredProducts,
    filters: {
      categories: categories.map((item) => item.category),
      brands: brands.map((item) => item.brand),
      sizes: sizes.map((item) => item.size)
    }
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  await disableExpiredSales();
  const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ message: 'Product not found.' });
  const [reviews] = await pool.execute(
    `SELECT pr.id,
            pr.rating,
            pr.review_text,
            pr.created_at,
            u.name AS customer_name
     FROM product_reviews pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.product_id = ? AND pr.is_hidden = FALSE
     ORDER BY pr.created_at DESC`,
    [req.params.id]
  );
  const averageRating = reviews.length
    ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length
    : 0;
  res.json({
    ...mapSaleProduct(rows[0]),
    reviews,
    averageRating: Number(averageRating.toFixed(1)),
    reviewCount: reviews.length
  });
}));

router.post('/upload-image', authenticate, requireAdmin, upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Image file is required.' });
  const imageUrl = `${req.protocol}://${req.get('host')}/uploads/products/${req.file.filename}`;
  res.status(201).json({ image: imageUrl });
}));

router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, category, brand, size, color, price, discount = 0, stock, image, costPrice = 0, originalPrice } = req.body;
  if (!name || price == null || stock == null) {
    return res.status(400).json({ message: 'Name, price and stock are required.' });
  }

  const [result] = await pool.execute(
    `INSERT INTO products (name, description, category, brand, size, color, price, discount, costPrice, originalPrice, stock, image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, description, category, brand, size, color, Number(price), discountPercent(discount), Number(costPrice), Number(originalPrice || price), Number(stock), image]
  );
  res.status(201).json({ id: result.insertId, message: 'Product created.' });
}));

router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, category, brand, size, color, price, discount = 0, stock, image, costPrice = 0, originalPrice } = req.body;
  await pool.execute(
    `UPDATE products SET name=?, description=?, category=?, brand=?, size=?, color=?, price=?, discount=?, costPrice=?, originalPrice=?, stock=?, image=? WHERE id=?`,
    [name, description, category, brand, size, color, Number(price), discountPercent(discount), Number(costPrice), Number(originalPrice || price), Number(stock), image, req.params.id]
  );
  res.json({ message: 'Product updated.' });
}));

router.post('/sale', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { productIds = [], saleType, saleValue, saleStartDate, saleEndDate, dedPermitNumber } = req.body;
  if (!Array.isArray(productIds) || !productIds.length) {
    return res.status(400).json({ message: 'Select at least one product for the sale.' });
  }

  const placeholders = productIds.map(() => '?').join(',');
  const [products] = await pool.execute(`SELECT * FROM products WHERE id IN (${placeholders})`, productIds);
  const invalid = products
    .map((product) => ({ product, validation: validateSalePayload({ saleType, saleValue, saleStartDate, saleEndDate, dedPermitNumber }, product) }))
    .find(({ validation }) => validation.errors.length);
  if (invalid) return res.status(400).json({ message: `${invalid.product.name}: ${invalid.validation.errors.join(' ')}` });

  await pool.execute(
    `UPDATE products
     SET isOnSale = TRUE, saleType = ?, saleValue = ?, saleStartDate = ?, saleEndDate = ?, dedPermitNumber = ?
     WHERE id IN (${placeholders}) AND stock > 0`,
    [saleType, Number(saleValue), saleStartDate || null, saleEndDate || null, String(dedPermitNumber).trim(), ...productIds]
  );
  res.json({ message: 'Summer sale activated.', updated: products.length });
}));

router.post('/sale/preview', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { productIds = [], saleType, saleValue, saleStartDate, saleEndDate, dedPermitNumber } = req.body;
  if (!Array.isArray(productIds) || !productIds.length) return res.json({ items: [], totals: { currentRevenue: 0, saleRevenue: 0, impact: 0 } });

  const placeholders = productIds.map(() => '?').join(',');
  const [products] = await pool.execute(`SELECT * FROM products WHERE id IN (${placeholders})`, productIds);
  const items = products.map((product) => {
    const validation = validateSalePayload({ saleType, saleValue, saleStartDate, saleEndDate, dedPermitNumber }, product);
    const previewDate = saleStartDate ? new Date(saleStartDate) : new Date();
    const candidate = mapSaleProduct({ ...product, isOnSale: true, saleType, saleValue, saleStartDate, saleEndDate }, previewDate);
    const currentRevenue = Number(product.originalPrice || product.price) * Number(product.stock || 0);
    const saleRevenue = calculateSalePrice(candidate, previewDate) * Number(product.stock || 0);
    return {
      id: product.id,
      name: product.name,
      stock: product.stock,
      currentRevenue,
      saleRevenue,
      impact: saleRevenue - currentRevenue,
      saleDiscountPercent: saleDiscountPercent(candidate, previewDate),
      warnings: validation.errors
    };
  });
  const totals = items.reduce((sum, item) => ({
    currentRevenue: sum.currentRevenue + item.currentRevenue,
    saleRevenue: sum.saleRevenue + item.saleRevenue,
    impact: sum.impact + item.impact
  }), { currentRevenue: 0, saleRevenue: 0, impact: 0 });
  res.json({ items, totals });
}));

router.post('/sale/csv', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { csv, dedPermitNumber } = req.body;
  if (!dedPermitNumber) return res.status(400).json({ message: 'DED Permit Number is mandatory for UAE compliance.' });
  const rows = csvRows(csv);
  const bodyRows = rows[0]?.[0] === 'productId' ? rows.slice(1) : rows;
  const results = [];

  for (const [productId, saleType, saleValue, saleStartDate, saleEndDate] of bodyRows) {
    const [[product]] = await pool.execute('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) {
      results.push({ productId, status: 'skipped', message: 'Product not found.' });
      continue;
    }
    const validation = validateSalePayload({ saleType, saleValue, saleStartDate, saleEndDate, dedPermitNumber }, product);
    if (validation.errors.length) {
      results.push({ productId, status: 'skipped', message: validation.errors.join(' ') });
      continue;
    }
    await pool.execute(
      `UPDATE products SET isOnSale = TRUE, saleType = ?, saleValue = ?, saleStartDate = ?, saleEndDate = ?, dedPermitNumber = ? WHERE id = ? AND stock > 0`,
      [saleType, Number(saleValue), saleStartDate || null, saleEndDate || null, dedPermitNumber, productId]
    );
    results.push({ productId, status: 'updated' });
  }

  res.json({ message: 'CSV sale upload processed.', results });
}));

router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  await pool.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.json({ message: 'Product deleted.' });
}));

module.exports = router;
