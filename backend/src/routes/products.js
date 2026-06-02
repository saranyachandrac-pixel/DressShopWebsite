const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { calculateSalePrice, mapSaleProduct, saleDiscountPercent, validateSalePayload } = require('../utils/sale');
const { getProductReplacementPolicy } = require('../services/replacementService');

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

function discountFromBody(body = {}, fallback = 0) {
  const value = body.discount_percentage ?? body.discountPercent ?? body.offer_percentage ?? body.discount_percent ?? fallback;
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    const error = new Error('Discount percentage must be between 0 and 100.');
    error.status = 400;
    throw error;
  }
  return Math.round(number * 100) / 100;
}

function normalizeGender(value) {
  const gender = String(value || '').trim().toLowerCase();
  const map = { men: 'MEN', women: 'WOMEN', kids: 'KIDS', unisex: 'UNISEX' };
  return map[gender] || '';
}

const womenCategoryKeys = {
  CASUAL: 'casual',
  FORMAL: 'formal',
  TRADITIONAL: 'traditional',
  PARTY_WEAR: 'partyWear',
  SUMMER_WEAR: 'summerWear'
};

const menCategoryKeys = {
  CASUAL: 'casual',
  FORMAL: 'formal',
  TRADITIONAL: 'traditional',
  PARTY_WEAR: 'partyWear',
  SUMMER_WEAR: 'summerWear'
};

const kidsCategoryKeys = {
  CASUAL: 'casual',
  FORMAL: 'formal',
  SCHOOL_WEAR: 'schoolWear',
  TRADITIONAL: 'traditional',
  PARTY_WEAR: 'partyWear',
  SUMMER_WEAR: 'summerWear'
};

const categoryLabels = {
  CASUAL: 'Casual',
  FORMAL: 'Formal',
  SCHOOL_WEAR: 'School Wear',
  TRADITIONAL: 'Traditional',
  PARTY_WEAR: 'Party Wear',
  SUMMER_WEAR: 'Summer Wear'
};
const allowedProductCategories = ['CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR'];
const menuCategoryKeysByGender = {
  MEN: ['CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR'],
  WOMEN: ['CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR'],
  KIDS: ['CASUAL', 'SCHOOL_WEAR', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR']
};
const productTypeOptions = ['Top', 'T-Shirt', 'Shirt', 'Hoodie', 'Jeans', 'Blazer', 'Kurta', 'Kurti', 'Suit', 'Shorts', 'Trousers', 'Saree', 'Lehenga', 'Gown', 'Dress', 'Frock'];
let productTypeColumnReady = false;
let managedProductTypesReady = false;
let managedCategoriesReady = false;
const productMenuCategoryExpr = "COALESCE(NULLIF(p.category, ''), REPLACE(p.product_category, '_', ' '))";

function categorySlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-');
}

function normalizeProductCategory(value) {
  const key = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (allowedProductCategories.includes(key)) return key;
  if (key === 'SCHOOL_WEAR') return 'SCHOOL_WEAR';
  return '';
}

function menuCategoryKeyForGender(gender, categoryKey) {
  if (gender === 'KIDS' && categoryKey === 'FORMAL') return 'SCHOOL_WEAR';
  return categoryKey;
}

function normalizeProductCategoryOrDefault(value) {
  return normalizeProductCategory(value) || 'CASUAL';
}

function categoryLabelFromKey(key) {
  return categoryLabels[key] || categoryLabels.CASUAL;
}

function genderCategoryColumn(gender) {
  const normalized = String(gender || '').toUpperCase();
  if (normalized === 'MEN') return 'men_category';
  if (normalized === 'WOMEN') return 'women_category';
  if (normalized === 'KIDS') return 'kids_category';
  return null;
}

async function ensureProductTypeColumn() {
  if (productTypeColumnReady) return;
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'products'
       AND COLUMN_NAME IN ('product_type', 'productType')`
  );
  const columnSet = new Set(rows.map((row) => row.COLUMN_NAME));
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
  await pool.query("UPDATE products SET product_type = 'T-Shirt' WHERE LOWER(name) LIKE '%t-shirt%'");
  await pool.query("UPDATE products SET product_type = 'Shirt' WHERE LOWER(name) LIKE '%shirt%' AND LOWER(name) NOT LIKE '%t-shirt%'");
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

function normalizeProductType(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.toLowerCase().replace(/[\s_-]+/g, '');
  const option = productTypeOptions.find((item) => item.toLowerCase().replace(/[\s_-]+/g, '') === compact);
  if (option) return option;
  if (compact === 'trouser') return 'Trousers';
  return raw.replace(/\s+/g, ' ');
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || '').trim());
}

async function taxonomySelection({ gender_id, category_id, product_type_id, gender, category, product_type, productType, name }) {
  let genderRow = null;
  let categoryRow = null;
  let typeRow = null;

  if (gender_id) {
    [[genderRow]] = await pool.execute('SELECT id, name, slug FROM genders WHERE id = ?', [gender_id]);
  } else {
    const normalizedGender = normalizeGender(gender);
    if (normalizedGender) {
      [[genderRow]] = await pool.execute('SELECT id, name, slug FROM genders WHERE UPPER(name) = ?', [normalizedGender]);
    }
  }
  if (!genderRow) {
    const error = new Error('Gender is required.');
    error.status = 400;
    throw error;
  }

  if (category_id) {
    [[categoryRow]] = await pool.execute(
      'SELECT id, gender_id, name, slug FROM categories WHERE id = ? AND gender_id = ?',
      [category_id, genderRow.id]
    );
  } else {
    const normalizedCategory = categoryLabelFromKey(normalizeProductCategoryOrDefault(category));
    [[categoryRow]] = await pool.execute(
      'SELECT id, gender_id, name, slug FROM categories WHERE gender_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      [genderRow.id, normalizedCategory]
    );
  }
  if (!categoryRow) {
    const error = new Error('Category is required for selected gender.');
    error.status = 400;
    throw error;
  }

  if (product_type_id) {
    [[typeRow]] = await pool.execute(
      'SELECT id, gender_id, category_id, name, slug FROM product_types WHERE id = ? AND gender_id = ? AND category_id = ?',
      [product_type_id, genderRow.id, categoryRow.id]
    );
  } else {
    const selectedType = normalizeProductType(product_type || productType) || inferProductType(name);
    [[typeRow]] = await pool.execute(
      'SELECT id, gender_id, category_id, name, slug FROM product_types WHERE gender_id = ? AND category_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      [genderRow.id, categoryRow.id, selectedType]
    );
  }
  if (!typeRow) {
    const error = new Error('Product type is required for selected gender and category.');
    error.status = 400;
    throw error;
  }

  return {
    genderId: genderRow.id,
    categoryId: categoryRow.id,
    productTypeId: typeRow.id,
    genderName: String(genderRow.name || '').toUpperCase(),
    categoryName: categoryRow.name,
    categoryKey: normalizeProductCategory(categoryRow.name) || String(categoryRow.name || '').toUpperCase().replace(/\s+/g, '_'),
    productTypeName: typeRow.name
  };
}

function categoryKeyFromLabel(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function productSelectionFromBody(body = {}) {
  const productGender = normalizeGender(body.gender) || String(body.gender || '').trim().toUpperCase();
  const displayCategory = String(body.category || '').trim();
  const productType = normalizeProductType(body.product_type || body.productType) || inferProductType(body.name);

  if (!productGender) {
    const error = new Error('Gender is required.');
    error.status = 400;
    throw error;
  }
  if (!displayCategory) {
    const error = new Error('Category is required.');
    error.status = 400;
    throw error;
  }
  if (!productType) {
    const error = new Error('Product type is required.');
    error.status = 400;
    throw error;
  }

  return {
    genderId: body.gender_id || null,
    categoryId: body.category_id || null,
    productTypeId: body.product_type_id || null,
    genderName: productGender,
    categoryName: displayCategory,
    categoryKey: categoryKeyFromLabel(displayCategory),
    productTypeName: productType
  };
}

function inferProductType(name = '') {
  const value = String(name || '').toLowerCase();
  const rules = [
    [/saree/, 'Saree'],
    [/lehenga/, 'Lehenga'],
    [/gown/, 'Gown'],
    [/frock/, 'Frock'],
    [/dress/, 'Dress'],
    [/\btop\b/, 'Top'],
    [/kurti/, 'Kurti'],
    [/t\s*-?\s*shirt|tee\b/, 'T-Shirt'],
    [/shirt/, 'Shirt'],
    [/hoodie/, 'Hoodie'],
    [/jeans?/, 'Jeans'],
    [/blazer/, 'Blazer'],
    [/kurta/, 'Kurta'],
    [/suit|sherwani/, 'Suit'],
    [/shorts?/, 'Shorts'],
    [/trousers?|trouser/, 'Trousers']
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] || '';
}

function isCategoryLikeType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.values(categoryLabels).some((label) => label.toLowerCase() === normalized);
}

function productTypeFromProduct(product = {}) {
  return normalizeProductType(product.product_type) || inferProductType(product.name) || normalizeProductType(product.category);
}

function productSearchWhere(alias = 'p') {
  return `(${alias}.name LIKE ? OR ${alias}.product_type LIKE ? OR ${alias}.brand LIKE ? OR ${alias}.category LIKE ? OR ${alias}.product_category LIKE ? OR ${alias}.gender LIKE ? OR ${alias}.description LIKE ?)`;
}

function productSearchParams(search) {
  const term = `%${search}%`;
  return [term, term, term, term, term, term, term];
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
  await ensureProductTypeColumn();
  await disableExpiredSales();
  const { category, brand, size, color, minPrice, maxPrice, search, keyword, type, product_type, onSale, saleRange, gender, gender_id, category_id, product_type_id } = req.query;
  const where = [];
  const params = [];
  const normalizedGender = String(gender || '').trim().toLowerCase();

  if (gender_id && isNumericId(gender_id)) {
    where.push('p.gender_id = ?');
    params.push(Number(gender_id));
  } else if (gender_id) {
    where.push('UPPER(p.gender) = ?');
    params.push(normalizeGender(gender_id));
  } else if (!normalizedGender) {
    where.push("p.is_active = 1 AND p.gender IS NOT NULL AND p.category IS NOT NULL AND COALESCE(p.product_type, '') <> ''");
  } else if (normalizedGender === 'all') {
    // Admin/product management view: no gender filter.
  } else if (normalizedGender === 'women') {
    where.push(`(
      LOWER(p.gender) = 'women'
      OR p.category = 'Women'
      OR p.category_id IN (SELECT id FROM categories WHERE name = 'Women' OR gender = 'women')
    ) AND LOWER(COALESCE(p.gender, 'women')) NOT IN ('men', 'kids', 'unisex')`);
  } else if (['men', 'kids'].includes(normalizedGender)) {
    where.push('LOWER(gender) = ?');
    params.push(normalizedGender);
  } else {
    where.push('(gender IS NULL OR LOWER(gender) <> ?)');
    params.push('men');
  }
  if (category_id && isNumericId(category_id)) {
    where.push('p.category_id = ?');
    params.push(Number(category_id));
  } else if (category_id) {
    where.push('p.category = ?');
    params.push(category_id);
  } else if (category) {
    const productCategory = normalizeProductCategory(category);
    const genderColumn = genderCategoryColumn(normalizeGender(normalizedGender));
    const menuCategoryKey = menuCategoryKeyForGender(normalizeGender(normalizedGender), productCategory);
    if (genderColumn && menuCategoryKey === 'SCHOOL_WEAR') {
      where.push(`(p.category = ? OR p.product_category = ? OR p.${genderColumn} = 'FORMAL' OR p.${genderColumn} = 'SCHOOL_WEAR')`);
      params.push(category, productCategory || category);
    } else if (genderColumn && productCategory) {
      where.push(`(p.category = ? OR p.product_category = ? OR p.${genderColumn} = ?)`);
      params.push(category, productCategory, productCategory);
    } else {
      where.push('(p.category = ? OR p.product_category = ?)');
      params.push(category, productCategory || category);
    }
  }
  if (brand) { where.push('brand = ?'); params.push(brand); }
  if (size) { where.push('size = ?'); params.push(size); }
  if (color) { where.push('color = ?'); params.push(color); }
  if (minPrice) { where.push('price >= ?'); params.push(Number(minPrice)); }
  if (maxPrice) { where.push('price <= ?'); params.push(Number(maxPrice)); }
  if (product_type_id && isNumericId(product_type_id)) {
    where.push('p.product_type_id = ?');
    params.push(Number(product_type_id));
  } else if (product_type_id) {
    where.push('LOWER(p.product_type) = LOWER(?)');
    params.push(product_type_id);
  } else {
    const selectedType = normalizeProductType(type || product_type);
    if (selectedType) {
    where.push('LOWER(p.product_type) = LOWER(?)');
    params.push(selectedType);
    }
  }
  if (search || keyword) { where.push(productSearchWhere('p')); params.push(...productSearchParams(search || keyword)); }
  if (onSale === 'true') {
    where.push('isOnSale = TRUE AND stock > 0 AND (saleEndDate IS NULL OR saleEndDate >= CURDATE())');
  }

  const sql = `SELECT p.* FROM products p ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
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

  const filterScope = normalizedGender === 'women'
    ? `((LOWER(gender) = 'women' OR category = 'Women' OR category_id IN (SELECT id FROM categories WHERE name = 'Women' OR gender = 'women')) AND LOWER(COALESCE(gender, 'women')) NOT IN ('men', 'kids', 'unisex'))`
    : ['men', 'kids'].includes(normalizedGender)
      ? `LOWER(gender) = ${pool.escape(normalizedGender)}`
      : normalizedGender === 'all'
        ? '1 = 1'
        : `is_active = 1 AND gender IS NOT NULL AND category IS NOT NULL AND COALESCE(product_type, '') <> ''`;
  const [categories] = await pool.query(`SELECT DISTINCT category FROM products WHERE ${filterScope} AND category IS NOT NULL ORDER BY category`);
  const [brands] = await pool.query(`SELECT DISTINCT brand FROM products WHERE ${filterScope} AND brand IS NOT NULL ORDER BY brand`);
  const [sizes] = await pool.query(`SELECT DISTINCT size FROM products WHERE ${filterScope} AND size IS NOT NULL ORDER BY size`);
  const [colors] = await pool.query(`SELECT DISTINCT color FROM products WHERE ${filterScope} AND color IS NOT NULL AND color <> "" ORDER BY color`);

  res.json({
    products: filteredProducts,
    filters: {
      categories: categories.map((item) => item.category),
      brands: brands.map((item) => item.brand),
      sizes: sizes.map((item) => item.size),
      colors: colors.map((item) => item.color)
    }
  });
}));

router.get('/home', asyncHandler(async (req, res) => {
  await ensureProductTypeColumn();
  await disableExpiredSales();
  const { category, brand, size, color, minPrice, maxPrice, search, keyword, type, product_type, onSale, saleRange, gender_id, category_id, product_type_id } = req.query;
  const where = [
    'is_active = 1',
    'gender IS NOT NULL',
    'category IS NOT NULL',
    "COALESCE(product_type, '') <> ''"
  ];
  const params = [];
  const productCategory = normalizeProductCategory(category);

  if (gender_id && isNumericId(gender_id)) {
    where.push('gender_id = ?');
    params.push(Number(gender_id));
  } else if (gender_id) {
    where.push('UPPER(gender) = ?');
    params.push(normalizeGender(gender_id));
  }
  if (category_id && isNumericId(category_id)) {
    where.push('category_id = ?');
    params.push(Number(category_id));
  } else if (category_id) {
    where.push('category = ?');
    params.push(category_id);
  } else if (category) {
    if (!productCategory) {
      return res.json({ products: [], filters: { categories: Object.values(categoryLabels), brands: [], sizes: [], colors: [] } });
    }
    where.push('product_category = ?');
    params.push(productCategory);
  }
  if (brand) { where.push('brand = ?'); params.push(brand); }
  if (size) { where.push('size = ?'); params.push(size); }
  if (color) { where.push('color = ?'); params.push(color); }
  if (minPrice) { where.push('price >= ?'); params.push(Number(minPrice)); }
  if (maxPrice) { where.push('price <= ?'); params.push(Number(maxPrice)); }
  if (product_type_id && isNumericId(product_type_id)) {
    where.push('product_type_id = ?');
    params.push(Number(product_type_id));
  } else if (product_type_id) {
    where.push('LOWER(product_type) = LOWER(?)');
    params.push(product_type_id);
  } else {
    const selectedType = normalizeProductType(type || product_type);
    if (selectedType) {
    where.push('LOWER(product_type) = LOWER(?)');
    params.push(selectedType);
    }
  }
  if (search || keyword) { where.push(productSearchWhere('products')); params.push(...productSearchParams(search || keyword)); }
  if (onSale === 'true') {
    where.push('isOnSale = TRUE AND stock > 0 AND (saleEndDate IS NULL OR saleEndDate >= CURDATE())');
  }

  const [rows] = await pool.execute(
    `SELECT *
     FROM products
     WHERE ${where.join(' AND ')}
     ORDER BY FIELD(gender, 'MEN', 'WOMEN', 'KIDS'), category, product_type, id`,
    params
  );
  const mappedProducts = rows.map((product) => mapSaleProduct({ ...product, image: product.image_url || product.image }));
  const products = saleRange
    ? mappedProducts.filter((product) => {
      const percent = Number(product.saleDiscountPercent) || 0;
      if (saleRange === '10-30') return percent >= 10 && percent < 30;
      if (saleRange === '30-50') return percent >= 30 && percent < 50;
      if (saleRange === '50+') return percent >= 50;
      return true;
    })
    : mappedProducts;

  const filterScope = `is_active = 1 AND gender IS NOT NULL AND category IS NOT NULL AND COALESCE(product_type, '') <> ''`;
  const [brands] = await pool.query(`SELECT DISTINCT brand FROM products WHERE ${filterScope} AND brand IS NOT NULL ORDER BY brand`);
  const [sizes] = await pool.query(`SELECT DISTINCT size FROM products WHERE ${filterScope} AND size IS NOT NULL ORDER BY size`);
  const [colors] = await pool.query(`SELECT DISTINCT color FROM products WHERE ${filterScope} AND color IS NOT NULL AND color <> "" ORDER BY color`);

  res.json({
    products,
    filters: {
      categories: Object.values(categoryLabels),
      brands: brands.map((item) => item.brand),
      sizes: sizes.map((item) => item.size),
      colors: colors.map((item) => item.color)
    }
  });
}));

router.get('/women', asyncHandler(async (req, res) => {
  await disableExpiredSales();
  const [rows] = await pool.execute(
    `SELECT *
     FROM products
     WHERE is_active = 1
       AND gender = 'WOMEN'
       AND product_category IN ('CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR')
       AND women_category IN ('CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR')
     ORDER BY FIELD(women_category, 'CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR'), created_at DESC, id DESC`
  );

  const grouped = Object.values(womenCategoryKeys).reduce((acc, key) => ({ ...acc, [key]: [] }), {});
  for (const product of rows) {
    const key = womenCategoryKeys[product.women_category];
    if (!key || String(product.gender).toUpperCase() !== 'WOMEN') continue;
    grouped[key].push(mapSaleProduct(product));
  }
  res.json(grouped);
}));

router.get('/men', asyncHandler(async (req, res) => {
  await disableExpiredSales();
  const [rows] = await pool.execute(
    `SELECT *
     FROM products
     WHERE is_active = 1
       AND gender = 'MEN'
       AND product_category IN ('CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR')
       AND men_category IN ('CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR')
     ORDER BY FIELD(men_category, 'CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR'), created_at DESC, id DESC`
  );

  const grouped = Object.values(menCategoryKeys).reduce((acc, key) => ({ ...acc, [key]: [] }), {});
  for (const product of rows) {
    const key = menCategoryKeys[product.men_category];
    if (!key || String(product.gender).toUpperCase() !== 'MEN') continue;
    grouped[key].push(mapSaleProduct({ ...product, image: product.image_url || product.image }));
  }
  res.json(grouped);
}));

router.get('/kids', asyncHandler(async (req, res) => {
  await disableExpiredSales();
  const [rows] = await pool.execute(
    `SELECT *
     FROM products
     WHERE is_active = 1
       AND gender = 'KIDS'
       AND product_category IN ('CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR')
       AND kids_category IN ('CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR')
     ORDER BY FIELD(kids_category, 'CASUAL', 'FORMAL', 'TRADITIONAL', 'PARTY_WEAR', 'SUMMER_WEAR'), created_at DESC, id DESC`
  );

  const grouped = Object.values(kidsCategoryKeys).reduce((acc, key) => ({ ...acc, [key]: [] }), {});
  for (const product of rows) {
    const key = kidsCategoryKeys[product.kids_category];
    if (!key || String(product.gender).toUpperCase() !== 'KIDS') continue;
    grouped[key].push(mapSaleProduct({ ...product, image: product.image_url || product.image }));
  }
  res.json(grouped);
}));

router.get('/mega-menu', asyncHandler(async (req, res) => {
  await ensureProductTypeColumn();
  await ensureManagedProductTypes();
  await ensureManagedCategories();
  const gender = normalizeGender(req.query.gender || 'men');
  if (!gender) return res.json([]);

  const [rows] = await pool.execute(
    `SELECT ${productMenuCategoryExpr} AS category,
            p.product_type
     FROM products p
     WHERE COALESCE(p.is_active, 1) = 1
       AND UPPER(p.gender) = ?
       AND COALESCE(NULLIF(p.category, ''), NULLIF(p.product_category, '')) IS NOT NULL
       AND COALESCE(p.product_type, '') <> ''
       AND NOT EXISTS (
         SELECT 1
         FROM catalog_categories cc
         WHERE cc.gender = UPPER(p.gender)
           AND LOWER(cc.name) = LOWER(${productMenuCategoryExpr})
           AND cc.status = 'INACTIVE'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM catalog_product_types cpt
         WHERE cpt.gender = UPPER(p.gender)
           AND cpt.category = ${productMenuCategoryExpr}
           AND LOWER(cpt.name) = LOWER(p.product_type)
           AND cpt.status = 'INACTIVE'
       )
     GROUP BY ${productMenuCategoryExpr}, p.product_type
     ORDER BY ${productMenuCategoryExpr}, p.product_type`,
    [gender]
  );

  const byCategory = new Map();

  for (const row of rows) {
    const category = row.category;
    if (!category) continue;
    if (!byCategory.has(category)) {
      byCategory.set(category, {
        category: row.category,
        categorySlug: categorySlug(row.category),
        items: []
      });
    }
    byCategory.get(category).items.push({
      type: row.product_type,
      label: row.product_type,
      category: row.category
    });
  }

  res.json([...byCategory.values()]);
}));

router.get('/menu', asyncHandler(async (req, res) => {
  await ensureProductTypeColumn();
  await ensureManagedProductTypes();
  await ensureManagedCategories();
  const gender = normalizeGender(req.query.gender || 'men');
  if (!gender) return res.status(400).json({ message: 'Valid gender is required.' });

  const [rows] = await pool.execute(
    `SELECT ${productMenuCategoryExpr} AS category,
            p.product_type
     FROM products p
     WHERE UPPER(p.gender) = ?
       AND COALESCE(p.is_active, 1) = 1
       AND COALESCE(NULLIF(p.category, ''), NULLIF(p.product_category, '')) IS NOT NULL
       AND COALESCE(p.product_type, '') <> ''
       AND NOT EXISTS (
         SELECT 1
         FROM catalog_categories cc
         WHERE cc.gender = UPPER(p.gender)
           AND LOWER(cc.name) = LOWER(${productMenuCategoryExpr})
           AND cc.status = 'INACTIVE'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM catalog_product_types cpt
         WHERE cpt.gender = UPPER(p.gender)
           AND cpt.category = ${productMenuCategoryExpr}
           AND LOWER(cpt.name) = LOWER(p.product_type)
           AND cpt.status = 'INACTIVE'
       )
     GROUP BY ${productMenuCategoryExpr}, p.product_type
     ORDER BY ${productMenuCategoryExpr}, p.product_type`,
    [gender]
  );

  const menu = {};
  for (const row of rows) {
    if (!row.category || !row.product_type) continue;
    if (!menu[row.category]) menu[row.category] = [];
    menu[row.category].push({
      label: row.product_type,
      type: row.product_type
    });
  }

  res.json(menu);
}));

router.get('/search', asyncHandler(async (req, res) => {
  await ensureProductTypeColumn();
  await disableExpiredSales();
  const search = String(req.query.q || req.query.search || '').trim();
  const where = ['p.is_active = 1'];
  const params = [];

  if (search) {
    where.push(productSearchWhere('p'));
    params.push(...productSearchParams(search));
  }

  const [rows] = await pool.execute(
    `SELECT p.*
     FROM products p
     WHERE ${where.join(' AND ')}
     ORDER BY p.created_at DESC, p.id DESC`,
    params
  );

  res.json({ products: rows.map((product) => mapSaleProduct(product)) });
}));

router.get('/:id/replacement-policy', asyncHandler(async (req, res) => {
  const policy = await getProductReplacementPolicy(pool, req.params.id);
  if (!policy) return res.status(404).json({ message: 'Product not found.' });
  res.json(policy);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  await disableExpiredSales();
  const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ message: 'Product not found.' });
  const product = rows[0];
  const [reviewColumns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_reviews'`
  );
  const reviewColumnSet = new Set(reviewColumns.map((row) => row.COLUMN_NAME));
  const visibilityFilter = reviewColumnSet.has('is_hidden') ? 'AND COALESCE(pr.is_hidden, FALSE) = FALSE' : '';
  const statusFilter = reviewColumnSet.has('status') ? "AND (pr.status = 'APPROVED' OR pr.status IS NULL OR pr.status = '')" : '';
  const reviewTextExpr = reviewColumnSet.has('review')
    ? 'COALESCE(pr.review_text, pr.review)'
    : 'pr.review_text';
  const [reviews] = await pool.execute(
    `SELECT pr.id,
            pr.product_id,
            pr.user_id,
            pr.rating,
            ${reviewTextExpr} AS review_text,
            ${reviewTextExpr} AS review,
            pr.created_at,
            COALESCE(u.name, CONCAT('Guest ', COALESCE(pr.guest_contact_value, 'Customer'))) AS customer_name,
            COALESCE(u.name, CONCAT('Guest ', COALESCE(pr.guest_contact_value, 'Customer'))) AS user_name
     FROM product_reviews pr
     LEFT JOIN order_items oi ON oi.id = pr.order_item_id
     LEFT JOIN users u ON u.id = pr.user_id
     WHERE (
         pr.product_id = ?
         OR LOWER(COALESCE(oi.product_name, '')) = LOWER(?)
       )
       ${visibilityFilter}
       ${statusFilter}
     ORDER BY pr.created_at DESC`,
    [req.params.id, product.name || '']
  );
  const averageRating = reviews.length
    ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length
    : 0;
  res.json({
    ...mapSaleProduct(product),
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
  await ensureProductTypeColumn();
  const {
    name,
    description,
    category,
    product_type,
    brand,
    size,
    color,
    gender,
    price,
    discount = 0,
    stock,
    image,
    costPrice = 0,
    originalPrice,
    is_replacement_available = true,
    isReplacementAvailable = true,
    replacement_days = null,
    replacementDays = null,
    replacement_policy = null,
    replacementPolicy = null
  } = req.body;
  if (!name || price == null || stock == null) {
    return res.status(400).json({ message: 'Name, price and stock are required.' });
  }
  const taxonomy = productSelectionFromBody({ ...req.body, name });
  const productGender = taxonomy.genderName;
  const productCategory = taxonomy.categoryKey;
  const displayCategory = taxonomy.categoryName;
  const productDiscount = discountFromBody(req.body, discount);
  const productType = taxonomy.productTypeName;
  const productImage = image || req.body.image_url || '';
  const menCategory = productGender === 'MEN' ? productCategory : null;
  const womenCategory = productGender === 'WOMEN' ? productCategory : null;
  const kidsCategory = productGender === 'KIDS' ? productCategory : null;
  const normalizedReplacementDays = replacementDays === '' || replacement_days === '' ? null : replacementDays ?? replacement_days;
  if (normalizedReplacementDays != null && Number(normalizedReplacementDays) < 0) {
    return res.status(400).json({ message: 'Replacement days cannot be negative.' });
  }

  const [result] = await pool.execute(
    `INSERT INTO products
       (name, description, gender_id, category_id, product_type_id, category, product_category, product_type, men_category, women_category, kids_category, brand, size, sizes, color, gender, price, mrp, discount, discount_percent, costPrice, originalPrice, stock, image, image_url, is_active, is_replacement_available, replacement_days, replacement_policy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?)`,
    [
      name,
      description,
      taxonomy.genderId,
      taxonomy.categoryId,
      taxonomy.productTypeId,
      displayCategory,
      productCategory,
      productType,
      menCategory,
      womenCategory,
      kidsCategory,
      brand,
      size,
      size,
      color,
      productGender,
      Number(price),
      Number(originalPrice || price),
      productDiscount,
      productDiscount,
      Number(costPrice),
      Number(originalPrice || price),
      Number(stock),
      productImage,
      productImage,
      Boolean(isReplacementAvailable ?? is_replacement_available),
      normalizedReplacementDays,
      replacementPolicy ?? replacement_policy
    ]
  );
  res.status(201).json({ id: result.insertId, message: 'Product created.' });
}));

router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  await ensureProductTypeColumn();
  const {
    name,
    description,
    category,
    product_type,
    brand,
    size,
    color,
    gender,
    price,
    discount = 0,
    stock,
    image,
    costPrice = 0,
    originalPrice,
    is_replacement_available = true,
    isReplacementAvailable = true,
    replacement_days = null,
    replacementDays = null,
    replacement_policy = null,
    replacementPolicy = null
  } = req.body;
  const taxonomy = productSelectionFromBody({ ...req.body, name });
  const productGender = taxonomy.genderName;
  const productCategory = taxonomy.categoryKey;
  const displayCategory = taxonomy.categoryName;
  const productDiscount = discountFromBody(req.body, discount);
  const productType = taxonomy.productTypeName;
  const productImage = image || req.body.image_url || '';
  const menCategory = productGender === 'MEN' ? productCategory : null;
  const womenCategory = productGender === 'WOMEN' ? productCategory : null;
  const kidsCategory = productGender === 'KIDS' ? productCategory : null;
  const normalizedReplacementDays = replacementDays === '' || replacement_days === '' ? null : replacementDays ?? replacement_days;
  if (normalizedReplacementDays != null && Number(normalizedReplacementDays) < 0) {
    return res.status(400).json({ message: 'Replacement days cannot be negative.' });
  }
  await pool.execute(
    `UPDATE products
     SET name=?,
         description=?,
         gender_id=?,
         category_id=?,
         product_type_id=?,
         category=?,
         product_category=?,
         product_type=?,
         men_category=?,
         women_category=?,
         kids_category=?,
         brand=?,
         size=?,
         sizes=?,
         color=?,
         gender=?,
         price=?,
         mrp=?,
         discount=?,
         discount_percent=?,
         costPrice=?,
         originalPrice=?,
         stock=?,
         image=?,
         image_url=?,
         is_active=TRUE,
         is_replacement_available=?,
         replacement_days=?,
         replacement_policy=?
     WHERE id=?`,
    [
      name,
      description,
      taxonomy.genderId,
      taxonomy.categoryId,
      taxonomy.productTypeId,
      displayCategory,
      productCategory,
      productType,
      menCategory,
      womenCategory,
      kidsCategory,
      brand,
      size,
      size,
      color,
      productGender,
      Number(price),
      Number(originalPrice || price),
      productDiscount,
      productDiscount,
      Number(costPrice),
      Number(originalPrice || price),
      Number(stock),
      productImage,
      productImage,
      Boolean(isReplacementAvailable ?? is_replacement_available),
      normalizedReplacementDays,
      replacementPolicy ?? replacement_policy,
      req.params.id
    ]
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
