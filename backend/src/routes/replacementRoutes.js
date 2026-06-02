const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getDefaultReplacementDays, normalizeDays } = require('../services/replacementService');

const router = express.Router();
router.use(authenticate, requireAdmin);

const categoryLabels = {
  CASUAL: 'Casual',
  FORMAL: 'Formal',
  TRADITIONAL: 'Traditional',
  PARTY_WEAR: 'Party Wear',
  SUMMER_WEAR: 'Summer Wear'
};

function normalizeGender(value) {
  const gender = String(value || '').trim().toUpperCase();
  return ['MEN', 'WOMEN', 'KIDS'].includes(gender) ? gender : '';
}

function normalizeProductCategory(value) {
  const category = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  return Object.keys(categoryLabels).includes(category) ? category : '';
}

router.get('/replacement-settings', asyncHandler(async (req, res) => {
  const defaultReplacementDays = await getDefaultReplacementDays(pool);
  const [categories] = await pool.execute(
    `SELECT
       gender,
       product_category AS category,
       COALESCE(MAX(replacement_days), NULL) AS replacement_days,
       COUNT(*) AS product_count
     FROM products
     WHERE is_active = 1
       AND gender IN ('MEN', 'WOMEN', 'KIDS')
       AND product_category IN ('CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR')
     GROUP BY gender, product_category
     ORDER BY FIELD(gender, 'MEN', 'WOMEN', 'KIDS'), FIELD(product_category, 'CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR')`
  );
  res.json({
    defaultReplacementDays,
    categories: categories.map((category) => ({
      id: `${category.gender}:${category.category}`,
      gender: category.gender,
      category: category.category,
      label: categoryLabels[category.category] || category.category,
      replacement_days: category.replacement_days,
      product_count: Number(category.product_count || 0)
    }))
  });
}));

router.put('/replacement-settings', asyncHandler(async (req, res) => {
  const days = normalizeDays(req.body.defaultReplacementDays ?? req.body.default_replacement_days);
  if (days == null) return res.status(400).json({ message: 'Replacement days cannot be negative.' });

  await pool.execute(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ('default_replacement_days', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [String(days)]
  );
  res.json({ message: 'Default replacement days updated.', defaultReplacementDays: days });
}));

router.put('/products/:id/replacement', asyncHandler(async (req, res) => {
  const replacementDays = normalizeDays(req.body.replacementDays ?? req.body.replacement_days, null);
  if ((req.body.replacementDays ?? req.body.replacement_days) !== '' && (req.body.replacementDays ?? req.body.replacement_days) != null && replacementDays == null) {
    return res.status(400).json({ message: 'Replacement days cannot be negative.' });
  }

  const [result] = await pool.execute(
    `UPDATE products
     SET is_replacement_available = ?,
         replacement_days = ?,
         replacement_policy = ?
     WHERE id = ?`,
    [
      Boolean(req.body.isReplacementAvailable ?? req.body.is_replacement_available ?? true),
      replacementDays,
      req.body.replacementPolicy ?? req.body.replacement_policy ?? null,
      req.params.id
    ]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Product not found.' });
  res.json({ message: 'Product replacement settings updated.' });
}));

router.put('/replacement-settings/category', asyncHandler(async (req, res) => {
  const gender = normalizeGender(req.body.gender);
  const category = normalizeProductCategory(req.body.category);
  if (!gender || !category) return res.status(400).json({ message: 'Valid gender and category are required.' });

  const replacementDays = normalizeDays(req.body.replacementDays ?? req.body.replacement_days, null);
  if ((req.body.replacementDays ?? req.body.replacement_days) !== '' && (req.body.replacementDays ?? req.body.replacement_days) != null && replacementDays == null) {
    return res.status(400).json({ message: 'Replacement days cannot be negative.' });
  }

  const [result] = await pool.execute(
    `UPDATE products
     SET replacement_days = ?
     WHERE gender = ?
       AND product_category = ?
       AND is_active = 1`,
    [replacementDays, gender, category]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Category products not found.' });
  res.json({ message: 'Category replacement days updated.', updatedProducts: result.affectedRows });
}));

router.put('/categories/:id/replacement', asyncHandler(async (req, res) => {
  const replacementDays = normalizeDays(req.body.replacementDays ?? req.body.replacement_days, null);
  if ((req.body.replacementDays ?? req.body.replacement_days) !== '' && (req.body.replacementDays ?? req.body.replacement_days) != null && replacementDays == null) {
    return res.status(400).json({ message: 'Replacement days cannot be negative.' });
  }

  const [result] = await pool.execute(
    'UPDATE categories SET replacement_days = ? WHERE id = ?',
    [replacementDays, req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Category not found.' });
  res.json({ message: 'Category replacement days updated.' });
}));

module.exports = router;
