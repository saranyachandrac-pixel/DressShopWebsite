const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const adminRouter = express.Router();
let productTypeColumnReady = false;
let managedProductTypesReady = false;
let managedCategoriesReady = false;

function normalizeGender(value) {
  return String(value || '').trim().toUpperCase();
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function ensureProductTypeColumn() {
  if (productTypeColumnReady) return;
  const [columns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'products'
       AND COLUMN_NAME IN ('product_type', 'productType')`
  );
  const columnSet = new Set(columns.map((row) => row.COLUMN_NAME));
  if (!columnSet.has('product_type')) {
    try {
      await pool.query('ALTER TABLE products ADD COLUMN product_type VARCHAR(80) NULL');
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  if (columnSet.has('productType')) {
    await pool.query("UPDATE products SET product_type = productType WHERE (product_type IS NULL OR product_type = '') AND COALESCE(productType, '') <> ''");
  }
  await pool.query(`
    UPDATE products
    SET product_type = CASE
      WHEN LOWER(name) REGEXP 't[ -]?shirt|tee' THEN 'T-Shirt'
      WHEN LOWER(name) LIKE '%shirt%' THEN 'Shirt'
      WHEN LOWER(name) LIKE '%hoodie%' THEN 'Hoodie'
      WHEN LOWER(name) LIKE '%jean%' THEN 'Jeans'
      WHEN LOWER(name) LIKE '%blazer%' THEN 'Blazer'
      WHEN LOWER(name) LIKE '%kurta%' THEN 'Kurta'
      WHEN LOWER(name) LIKE '%suit%' OR LOWER(name) LIKE '%sherwani%' THEN 'Suit'
      WHEN LOWER(name) LIKE '%short%' THEN 'Shorts'
      WHEN LOWER(name) LIKE '%trouser%' THEN 'Trousers'
      ELSE product_type
    END
    WHERE product_type IS NULL OR product_type = ''
  `);
  productTypeColumnReady = true;
}

async function ensureManagedProductTypes() {
  if (managedProductTypesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_product_types (
      id INT PRIMARY KEY AUTO_INCREMENT,
      gender VARCHAR(20) NOT NULL,
      category VARCHAR(120) NOT NULL,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_catalog_product_type (gender, category, slug)
    )
  `);
  managedProductTypesReady = true;
}

async function ensureManagedCategories() {
  if (managedCategoriesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      gender VARCHAR(20) NOT NULL,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_catalog_category (gender, slug)
    )
  `);
  managedCategoriesReady = true;
}

function categoryKey(row) {
  return [
    normalizeGender(row.gender_id || row.gender),
    String(row.name || '').trim().toLowerCase()
  ].join('|');
}

function managedCategoryId(row) {
  return `managed:${row.id}`;
}

function derivedCategoryId(row) {
  return `derived:${encodeURIComponent(row.gender_id)}:${encodeURIComponent(row.name)}`;
}

function parseCategoryId(id = '') {
  const value = String(id);
  if (value.startsWith('managed:')) return { source: 'managed', id: Number(value.slice('managed:'.length)) };
  if (value.startsWith('derived:')) {
    const [, gender = '', name = ''] = value.split(':');
    return { source: 'derived', gender: decodeURIComponent(gender), name: decodeURIComponent(name) };
  }
  return { source: 'derived', gender: '', name: value };
}

function productTypeKey(row) {
  return [
    normalizeGender(row.gender_id || row.gender),
    String(row.category_id || row.category || '').trim().toLowerCase(),
    String(row.name || '').trim().toLowerCase()
  ].join('|');
}

function managedProductTypeId(row) {
  return `managed:${row.id}`;
}

function derivedProductTypeId(row) {
  return `derived:${encodeURIComponent(row.gender_id)}:${encodeURIComponent(row.category_id)}:${encodeURIComponent(row.name)}`;
}

function parseProductTypeId(id = '') {
  const value = String(id);
  if (value.startsWith('managed:')) return { source: 'managed', id: Number(value.slice('managed:'.length)) };
  if (value.startsWith('derived:')) {
    const [, gender = '', category = '', name = ''] = value.split(':');
    return {
      source: 'derived',
      gender: decodeURIComponent(gender),
      category: decodeURIComponent(category),
      name: decodeURIComponent(name)
    };
  }
  return { source: 'derived', gender: '', category: '', name: value };
}

function normalizeStatus(value) {
  return String(value || 'ACTIVE').trim().toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
}

router.get('/genders', asyncHandler(async (req, res) => {
  const includeInactive = req.query.include_inactive === 'true';
  const [rows] = await pool.execute(
    `SELECT UPPER(gender) AS id,
            CASE UPPER(gender)
              WHEN 'MEN' THEN 'Men'
              WHEN 'WOMEN' THEN 'Women'
              WHEN 'KIDS' THEN 'Kids'
              ELSE gender
            END AS name,
            LOWER(gender) AS slug,
            'ACTIVE' AS status
     FROM products
     WHERE COALESCE(gender, '') <> ''
       ${includeInactive ? '' : 'AND COALESCE(is_active, TRUE) = TRUE'}
     GROUP BY UPPER(gender), gender
     ORDER BY FIELD(UPPER(gender), 'MEN', 'WOMEN', 'KIDS'), gender`
  );
  res.json({ genders: rows });
}));

router.get('/categories', asyncHandler(async (req, res) => {
  await ensureManagedCategories();
  const includeInactive = req.query.include_inactive === 'true';
  const gender = normalizeGender(req.query.gender || req.query.gender_id);
  const params = [];
  const where = [
    "COALESCE(category, '') <> ''",
    includeInactive ? '1 = 1' : 'COALESCE(is_active, TRUE) = TRUE'
  ];

  if (gender) {
    where.push('UPPER(gender) = ?');
    params.push(gender);
  }

  const [productRows] = await pool.execute(
    `SELECT category AS id,
            category AS name,
            UPPER(gender) AS gender_id,
            CASE UPPER(gender)
              WHEN 'MEN' THEN 'Men'
              WHEN 'WOMEN' THEN 'Women'
              WHEN 'KIDS' THEN 'Kids'
              ELSE gender
            END AS gender_name,
            LOWER(REPLACE(category, ' ', '-')) AS slug,
            'ACTIVE' AS status
     FROM products
     WHERE ${where.join(' AND ')}
     GROUP BY UPPER(gender), gender, category
     ORDER BY FIELD(UPPER(gender), 'MEN', 'WOMEN', 'KIDS'), category`,
    params
  );
  const managedWhere = [];
  const managedParams = [];
  if (gender) {
    managedWhere.push('gender = ?');
    managedParams.push(gender);
  }
  const [managedRows] = await pool.execute(
    `SELECT id,
            name,
            gender AS gender_id,
            CASE gender
              WHEN 'MEN' THEN 'Men'
              WHEN 'WOMEN' THEN 'Women'
              WHEN 'KIDS' THEN 'Kids'
              ELSE gender
            END AS gender_name,
            slug,
            status
     FROM catalog_categories
     ${managedWhere.length ? `WHERE ${managedWhere.join(' AND ')}` : ''}
     ORDER BY FIELD(gender, 'MEN', 'WOMEN', 'KIDS'), name`,
    managedParams
  );

  const managedByKey = new Map(managedRows.map((row) => [categoryKey(row), row]));
  const merged = [];
  for (const row of productRows) {
    const managed = managedByKey.get(categoryKey(row));
    if (managed?.status === 'INACTIVE') {
      if (includeInactive) merged.push({ ...managed, id: managedCategoryId(managed), source: 'managed' });
      continue;
    }
    if (managed) {
      if (includeInactive || managed.status === 'ACTIVE') {
        merged.push({ ...managed, id: includeInactive ? managedCategoryId(managed) : managed.name, source: 'managed' });
      }
      managedByKey.delete(categoryKey(row));
      continue;
    }
    merged.push({ ...row, id: includeInactive ? derivedCategoryId(row) : row.name, source: 'derived' });
  }
  for (const row of managedByKey.values()) {
    if (includeInactive || row.status === 'ACTIVE') {
      merged.push({ ...row, id: includeInactive ? managedCategoryId(row) : row.name, source: 'managed' });
    }
  }
  merged.sort((a, b) => (
    String(a.gender_id).localeCompare(String(b.gender_id))
    || String(a.name).localeCompare(String(b.name))
  ));
  res.json({ categories: merged });
}));

router.get('/product-types', asyncHandler(async (req, res) => {
  await ensureProductTypeColumn();
  await ensureManagedProductTypes();
  await ensureManagedCategories();
  const includeInactive = req.query.include_inactive === 'true';
  const gender = normalizeGender(req.query.gender || req.query.gender_id);
  const category = String(req.query.category || req.query.category_id || '').trim();
  const params = [];
  const where = [
    "COALESCE(product_type, '') <> ''",
    includeInactive ? '1 = 1' : 'COALESCE(is_active, TRUE) = TRUE'
  ];

  if (gender) {
    where.push('UPPER(gender) = ?');
    params.push(gender);
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }

  const [productRows] = await pool.execute(
    `SELECT product_type AS id,
            product_type AS name,
            UPPER(gender) AS gender_id,
            category AS category_id,
            CASE UPPER(gender)
              WHEN 'MEN' THEN 'Men'
              WHEN 'WOMEN' THEN 'Women'
              WHEN 'KIDS' THEN 'Kids'
              ELSE gender
            END AS gender_name,
            category AS category_name,
            LOWER(REPLACE(product_type, ' ', '-')) AS slug,
            'ACTIVE' AS status
     FROM products
     WHERE ${where.join(' AND ')}
       AND NOT EXISTS (
         SELECT 1
         FROM catalog_categories cc
         WHERE cc.gender = UPPER(products.gender)
           AND LOWER(cc.name) = LOWER(products.category)
           AND cc.status = 'INACTIVE'
       )
     GROUP BY UPPER(gender), gender, category, product_type
     ORDER BY FIELD(UPPER(gender), 'MEN', 'WOMEN', 'KIDS'), category, product_type`,
    params
  );
  const managedWhere = [];
  const managedParams = [];
  if (gender) {
    managedWhere.push('gender = ?');
    managedParams.push(gender);
  }
  if (category) {
    managedWhere.push('category = ?');
    managedParams.push(category);
  }
  const [managedRows] = await pool.execute(
    `SELECT id,
            name,
            gender AS gender_id,
            category AS category_id,
            CASE gender
              WHEN 'MEN' THEN 'Men'
              WHEN 'WOMEN' THEN 'Women'
              WHEN 'KIDS' THEN 'Kids'
              ELSE gender
            END AS gender_name,
            category AS category_name,
            slug,
            status
     FROM catalog_product_types
     ${managedWhere.length ? `WHERE ${managedWhere.join(' AND ')}` : ''}
     ORDER BY FIELD(gender, 'MEN', 'WOMEN', 'KIDS'), category, name`,
    managedParams
  );

  const managedByKey = new Map(managedRows.map((row) => [productTypeKey(row), row]));
  const merged = [];
  for (const row of productRows) {
    const managed = managedByKey.get(productTypeKey(row));
    if (managed?.status === 'INACTIVE') {
      if (includeInactive) merged.push({ ...managed, id: managedProductTypeId(managed), source: 'managed' });
      continue;
    }
    if (managed) {
      if (includeInactive || managed.status === 'ACTIVE') {
        merged.push({ ...managed, id: includeInactive ? managedProductTypeId(managed) : managed.name, source: 'managed' });
      }
      managedByKey.delete(productTypeKey(row));
      continue;
    }
    merged.push({ ...row, id: includeInactive ? derivedProductTypeId(row) : row.name, source: 'derived' });
  }
  for (const row of managedByKey.values()) {
    if (includeInactive || row.status === 'ACTIVE') {
      merged.push({ ...row, id: includeInactive ? managedProductTypeId(row) : row.name, source: 'managed' });
    }
  }
  merged.sort((a, b) => (
    String(a.gender_id).localeCompare(String(b.gender_id))
    || String(a.category_id).localeCompare(String(b.category_id))
    || String(a.name).localeCompare(String(b.name))
  ));
  res.json({ productTypes: merged });
}));

adminRouter.use(authenticate, requireAdmin);

adminRouter.post(['/genders', '/gender'], (req, res) => {
  res.status(410).json({ message: 'Catalog hierarchy is generated from existing products. Add or edit products to create values.' });
});

adminRouter.post('/categories', asyncHandler(async (req, res) => {
  await ensureManagedCategories();
  const gender = normalizeGender(req.body.gender_id || req.body.gender);
  const name = String(req.body.name || '').trim();
  const status = normalizeStatus(req.body.status);
  if (!gender) return res.status(400).json({ message: 'Gender is required.' });
  if (!name) return res.status(400).json({ message: 'Category name is required.' });
  await pool.execute(
    `INSERT INTO catalog_categories (gender, name, slug, status)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)`,
    [gender, name, slugify(name), status]
  );
  res.status(201).json({ message: 'Category saved.' });
}));

adminRouter.post('/product-types', asyncHandler(async (req, res) => {
  await ensureManagedProductTypes();
  const gender = normalizeGender(req.body.gender_id || req.body.gender);
  const category = String(req.body.category_id || req.body.category || '').trim();
  const name = String(req.body.name || '').trim();
  const status = normalizeStatus(req.body.status);
  if (!gender) return res.status(400).json({ message: 'Gender is required.' });
  if (!category) return res.status(400).json({ message: 'Category is required.' });
  if (!name) return res.status(400).json({ message: 'Product type name is required.' });

  await pool.execute(
    `INSERT INTO catalog_product_types (gender, category, name, slug, status)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)`,
    [gender, category, name, slugify(name), status]
  );
  res.status(201).json({ message: 'Product type saved.' });
}));

adminRouter.put(['/genders/:id', '/gender/:id'], (req, res) => {
  res.status(410).json({ message: 'Catalog hierarchy is generated from existing products. Edit products to change values.' });
});

adminRouter.put('/categories/:id', asyncHandler(async (req, res) => {
  await ensureManagedCategories();
  const parsed = parseCategoryId(req.params.id);
  const gender = normalizeGender(req.body.gender_id || req.body.gender || parsed.gender);
  const name = String(req.body.name || '').trim();
  const status = normalizeStatus(req.body.status);
  if (!gender) return res.status(400).json({ message: 'Gender is required.' });
  if (!name) return res.status(400).json({ message: 'Category name is required.' });

  if (parsed.source === 'managed' && parsed.id) {
    const [[oldRow]] = await pool.execute('SELECT gender, name FROM catalog_categories WHERE id = ?', [parsed.id]);
    const [result] = await pool.execute(
      'UPDATE catalog_categories SET gender = ?, name = ?, slug = ?, status = ? WHERE id = ?',
      [gender, name, slugify(name), status, parsed.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Category not found.' });
    if (oldRow) {
      await pool.execute(
        'UPDATE catalog_product_types SET gender = ?, category = ? WHERE gender = ? AND category = ?',
        [gender, name, oldRow.gender, oldRow.name]
      );
    }
  } else {
    await pool.execute(
      `UPDATE products
       SET category = ?
       WHERE UPPER(gender) = ? AND category = ?`,
      [name, gender, parsed.name]
    );
    await pool.execute(
      'UPDATE catalog_product_types SET category = ? WHERE gender = ? AND category = ?',
      [name, gender, parsed.name]
    );
    await pool.execute(
      `INSERT INTO catalog_categories (gender, name, slug, status)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)`,
      [gender, name, slugify(name), status]
    );
  }
  res.json({ message: 'Category updated.' });
}));

adminRouter.put('/product-types/:id', asyncHandler(async (req, res) => {
  await ensureManagedProductTypes();
  const parsed = parseProductTypeId(req.params.id);
  const gender = normalizeGender(req.body.gender_id || req.body.gender || parsed.gender);
  const category = String(req.body.category_id || req.body.category || parsed.category || '').trim();
  const name = String(req.body.name || '').trim();
  const status = normalizeStatus(req.body.status);
  if (!gender) return res.status(400).json({ message: 'Gender is required.' });
  if (!category) return res.status(400).json({ message: 'Category is required.' });
  if (!name) return res.status(400).json({ message: 'Product type name is required.' });

  if (parsed.source === 'managed' && parsed.id) {
    const [result] = await pool.execute(
      'UPDATE catalog_product_types SET gender = ?, category = ?, name = ?, slug = ?, status = ? WHERE id = ?',
      [gender, category, name, slugify(name), status, parsed.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Product type not found.' });
  } else {
    await pool.execute(
      `UPDATE products
       SET product_type = ?
       WHERE UPPER(gender) = ? AND category = ? AND product_type = ?`,
      [name, gender, category, parsed.name]
    );
    await pool.execute(
      `INSERT INTO catalog_product_types (gender, category, name, slug, status)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)`,
      [gender, category, name, slugify(name), status]
    );
  }
  res.json({ message: 'Product type updated.' });
}));

adminRouter.delete(['/genders/:id', '/gender/:id'], (req, res) => {
  res.status(410).json({ message: 'Catalog hierarchy is generated from existing products. Delete or edit products to remove values.' });
});

adminRouter.delete('/categories/:id', asyncHandler(async (req, res) => {
  await ensureManagedCategories();
  const parsed = parseCategoryId(req.params.id);
  if (parsed.source === 'managed' && parsed.id) {
    const [result] = await pool.execute("UPDATE catalog_categories SET status = 'INACTIVE' WHERE id = ?", [parsed.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Category not found.' });
  } else {
    await pool.execute(
      `INSERT INTO catalog_categories (gender, name, slug, status)
       VALUES (?, ?, ?, 'INACTIVE')
       ON DUPLICATE KEY UPDATE status = 'INACTIVE'`,
      [normalizeGender(parsed.gender), parsed.name, slugify(parsed.name)]
    );
  }
  res.json({ message: 'Category removed.' });
}));

adminRouter.delete('/product-types/:id', asyncHandler(async (req, res) => {
  await ensureManagedProductTypes();
  const parsed = parseProductTypeId(req.params.id);
  if (parsed.source === 'managed' && parsed.id) {
    const [result] = await pool.execute("UPDATE catalog_product_types SET status = 'INACTIVE' WHERE id = ?", [parsed.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Product type not found.' });
  } else {
    await pool.execute(
      `INSERT INTO catalog_product_types (gender, category, name, slug, status)
       VALUES (?, ?, ?, ?, 'INACTIVE')
       ON DUPLICATE KEY UPDATE status = 'INACTIVE'`,
      [normalizeGender(parsed.gender), parsed.category, parsed.name, slugify(parsed.name)]
    );
  }
  res.json({ message: 'Product type removed.' });
}));

module.exports = { router, adminRouter, slugify };
