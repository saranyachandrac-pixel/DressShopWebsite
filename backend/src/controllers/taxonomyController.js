const pool = require('../config/db');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeStatus(value) {
  return String(value || 'ACTIVE').trim().toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
}

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  }
}

async function ensureTaxonomySchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS genders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      parent_id INT NULL,
      gender_id INT NULL,
      gender VARCHAR(20) NOT NULL DEFAULT '',
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      replacement_days INT DEFAULT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await ensureColumn('categories', 'gender_id', 'gender_id INT NULL');
  await ensureColumn('categories', 'gender', "gender VARCHAR(20) NOT NULL DEFAULT ''");
  await ensureColumn('categories', 'status', "status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'");
  await ensureColumn('categories', 'is_active', 'is_active BOOLEAN DEFAULT TRUE');
  await ensureColumn('categories', 'sort_order', 'sort_order INT NOT NULL DEFAULT 0');
  await ensureColumn('categories', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_types (
      id INT PRIMARY KEY AUTO_INCREMENT,
      gender_id INT NOT NULL,
      category_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_product_type_scope (gender_id, category_id, slug),
      INDEX idx_product_types_gender_category (gender_id, category_id)
    )
  `);
}

async function listGenders(req, res) {
  await ensureTaxonomySchema();
  const includeInactive = req.query.include_inactive === 'true';
  console.log(`[taxonomy] GET /api/genders include_inactive=${includeInactive}`);
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
       ${includeInactive ? '' : 'AND COALESCE(is_active, 1) = 1'}
     GROUP BY UPPER(gender), gender
     ORDER BY FIELD(UPPER(gender), 'MEN', 'WOMEN', 'KIDS'), gender`
  );
  res.json({ genders: rows });
}

async function createGender(req, res) {
  await ensureTaxonomySchema();
  console.log('[taxonomy] POST /api/admin/genders body:', {
    name: req.body?.name,
    status: req.body?.status
  });

  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Gender name is required.' });

  const slug = slugify(req.body.slug || name);
  const status = normalizeStatus(req.body.status);
  const [result] = await pool.execute(
    `INSERT INTO genders (name, slug, status)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)`,
    [name, slug, status]
  );

  const [[gender]] = await pool.execute('SELECT id, name, slug, status FROM genders WHERE slug = ?', [slug]);
  res.status(201).json({
    gender: gender || { id: result.insertId, name, slug, status },
    message: 'Gender saved successfully.'
  });
}

async function updateGender(req, res) {
  await ensureTaxonomySchema();
  console.log(`[taxonomy] PUT /api/admin/genders/${req.params.id}`);
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Gender name is required.' });

  const slug = slugify(req.body.slug || name);
  const status = normalizeStatus(req.body.status);
  const [result] = await pool.execute(
    'UPDATE genders SET name = ?, slug = ?, status = ? WHERE id = ?',
    [name, slug, status, req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Gender not found.' });
  res.json({ message: 'Gender updated successfully.' });
}

async function deleteGender(req, res) {
  await ensureTaxonomySchema();
  console.log(`[taxonomy] DELETE /api/admin/genders/${req.params.id}`);
  const [result] = await pool.execute("UPDATE genders SET status = 'INACTIVE' WHERE id = ?", [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Gender not found.' });
  res.json({ message: 'Gender deactivated successfully.' });
}

module.exports = {
  createGender,
  deleteGender,
  ensureTaxonomySchema,
  listGenders,
  normalizeStatus,
  slugify,
  updateGender
};
