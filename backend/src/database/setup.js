const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { flattenCategories, productSeeds } = require('../data/menCatalog');
require('dotenv').config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'ebaPass',
  multipleStatements: true
};

async function ensureColumn(connection, table, column, definition) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );

  if (!rows.length) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  }
}

async function ensureIndex(connection, table, index, definition) {
  const [rows] = await connection.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );

  if (!rows.length) {
    await connection.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
  }
}

async function dropIndexIfExists(connection, table, index) {
  const [rows] = await connection.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );

  if (rows.length) {
    await connection.query(`ALTER TABLE \`${table}\` DROP INDEX \`${index}\``);
  }
}

async function mergeDuplicateCartVariants(connection) {
  await mergeDuplicateCartRows(connection);
  await dropIndexIfExists(connection, 'cart', 'unique_cart_variant');
  await connection.query(`
    UPDATE cart c
    JOIN products p ON p.id = c.product_id
    SET c.size = COALESCE(NULLIF(c.size, ''), p.size, ''),
        c.color = COALESCE(NULLIF(c.color, ''), p.color, '')
  `);
  await mergeDuplicateCartRows(connection);
}

async function mergeDuplicateCartRows(connection) {
  await connection.query('DROP TEMPORARY TABLE IF EXISTS cart_variant_duplicates');
  await connection.query(`
    CREATE TEMPORARY TABLE cart_variant_duplicates AS
    SELECT MIN(id) AS keep_id,
           user_id,
           product_id,
           COALESCE(size, '') AS size,
           COALESCE(color, '') AS color,
           SUM(quantity) AS total_quantity,
           COUNT(*) AS row_count
    FROM cart
    GROUP BY user_id, product_id, COALESCE(size, ''), COALESCE(color, '')
    HAVING COUNT(*) > 1
  `);
  await connection.query(`
    UPDATE cart c
    JOIN cart_variant_duplicates d ON c.id = d.keep_id
    SET c.quantity = d.total_quantity
  `);
  await connection.query(`
    DELETE c
    FROM cart c
    JOIN cart_variant_duplicates d
      ON c.user_id = d.user_id
     AND c.product_id = d.product_id
     AND COALESCE(c.size, '') = d.size
     AND COALESCE(c.color, '') = d.color
     AND c.id <> d.keep_id
  `);
  await connection.query('DROP TEMPORARY TABLE IF EXISTS cart_variant_duplicates');
}

async function seedCatalog(connection, gender = 'men') {
  const categories = flattenCategories(gender);
  const idBySlug = {};

  for (const category of categories.filter((item) => !item.parentSlug)) {
    await connection.execute(
      `INSERT INTO categories (parent_id, gender, name, slug, sort_order, is_active)
       VALUES (NULL, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order), is_active = TRUE`,
      [gender, category.name, category.slug, category.sortOrder]
    );
    const [[row]] = await connection.execute('SELECT id FROM categories WHERE gender = ? AND slug = ?', [gender, category.slug]);
    idBySlug[category.slug] = row.id;
  }

  for (const category of categories.filter((item) => item.parentSlug)) {
    await connection.execute(
      `INSERT INTO categories (parent_id, gender, name, slug, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), sort_order = VALUES(sort_order), is_active = TRUE`,
      [idBySlug[category.parentSlug] || null, gender, category.name, category.slug, category.sortOrder]
    );
    const [[row]] = await connection.execute('SELECT id FROM categories WHERE gender = ? AND slug = ?', [gender, category.slug]);
    idBySlug[category.slug] = row.id;
  }

  for (const [index, category] of categories.filter((item) => item.isLeaf).entries()) {
    const categoryId = idBySlug[category.slug];
    if (!categoryId) continue;

    for (const product of productSeeds(category, index, gender)) {
      await connection.execute(
        `INSERT INTO products
          (category_id, gender, name, slug, brand, price, mrp, originalPrice, discount_percent, discount, image_url, image, sizes, size, color, stock, rating, description, is_active, category, product_category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, NULL)
         ON DUPLICATE KEY UPDATE
          category_id = VALUES(category_id),
          brand = VALUES(brand),
          name = VALUES(name),
          price = VALUES(price),
          mrp = VALUES(mrp),
          originalPrice = VALUES(originalPrice),
          discount_percent = VALUES(discount_percent),
          discount = VALUES(discount),
          image_url = VALUES(image_url),
          image = VALUES(image),
          sizes = VALUES(sizes),
          size = VALUES(size),
          color = VALUES(color),
          stock = VALUES(stock),
          rating = VALUES(rating),
          description = VALUES(description),
          is_active = TRUE,
          category = VALUES(category),
          product_category = VALUES(product_category)`,
        [
          categoryId,
          gender,
          product.name,
          product.slug,
          product.brand,
          product.price,
          product.mrp,
          product.mrp,
          product.discount,
          product.discount,
          product.imageUrl,
          product.imageUrl,
          product.sizes,
          product.sizes.split(',')[1] || 'M',
          product.color,
          product.stock,
          product.rating,
          product.description,
          category.name
        ]
      );
    }
  }
}

async function seedMenCatalog(connection) {
  await seedCatalog(connection, 'men');
  await seedCatalog(connection, 'women');
  await seedCatalog(connection, 'kids');
}

const categoryLabels = {
  CASUAL: 'Casual',
  FORMAL: 'Formal',
  TRADITIONAL: 'Traditional',
  PARTY_WEAR: 'Party Wear',
  SUMMER_WEAR: 'Summer Wear'
};

const defaultTaxonomy = {
  Men: {
    Casual: ['Shirt', 'T-Shirt', 'Jeans', 'Shorts', 'Hoodie'],
    Formal: ['Shirt', 'Blazer', 'Trousers'],
    Traditional: ['Kurta', 'Sherwani', 'Suit'],
    'Party Wear': ['Shirt', 'Blazer', 'Suit'],
    'Summer Wear': ['Shirt', 'T-Shirt', 'Shorts']
  },
  Women: {
    Casual: ['Top', 'T-Shirt', 'Jeans', 'Dress', 'Kurti'],
    Formal: ['Shirt', 'Blazer', 'Skirt', 'Trousers'],
    Traditional: ['Saree', 'Kurta', 'Kurti', 'Lehenga'],
    'Party Wear': ['Dress', 'Gown', 'Saree', 'Skirt'],
    'Summer Wear': ['Dress', 'Top', 'Skirt', 'Shorts']
  },
  Kids: {
    Boys: ['Shirt', 'T-Shirt', 'Jeans', 'Shorts', 'Blazer', 'Suit'],
    Girls: ['Dress', 'Top', 'Skirt', 'Shorts', 'Frock'],
    'Baby Wear': ['T-Shirt', 'Shorts', 'Frock'],
    Casual: ['T-Shirt', 'Jeans', 'Dress', 'Shorts', 'Hoodie'],
    'Party Wear': ['Dress', 'Suit', 'Blazer', 'Frock', 'Kurta', 'Lehenga']
  }
};

function taxonomySlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferTaxonomyProductType(name = '') {
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
    [/trousers?|trouser/, 'Trousers'],
    [/skirt/, 'Skirt']
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] || 'Shirt';
}

async function seedGenderCategoryProductTypes(connection) {
  for (const [genderName, categories] of Object.entries(defaultTaxonomy)) {
    const genderSlug = taxonomySlug(genderName);
    await connection.execute(
      `INSERT INTO genders (name, slug, status)
       VALUES (?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE name = VALUES(name), status = 'ACTIVE'`,
      [genderName, genderSlug]
    );
    const [[genderRow]] = await connection.execute('SELECT id FROM genders WHERE slug = ?', [genderSlug]);

    for (const [categoryName, types] of Object.entries(categories)) {
      const categorySlug = taxonomySlug(categoryName);
      await connection.execute(
        `INSERT INTO categories (gender_id, gender, name, slug, status, is_active)
         VALUES (?, ?, ?, ?, 'ACTIVE', TRUE)
         ON DUPLICATE KEY UPDATE gender_id = VALUES(gender_id), gender = VALUES(gender), name = VALUES(name), status = 'ACTIVE', is_active = TRUE`,
        [genderRow.id, genderSlug, categoryName, categorySlug]
      );
      const [[categoryRow]] = await connection.execute(
        'SELECT id FROM categories WHERE gender_id = ? AND slug = ? LIMIT 1',
        [genderRow.id, categorySlug]
      );

      for (const typeName of types) {
        await connection.execute(
          `INSERT INTO product_types (gender_id, category_id, name, slug, status)
           VALUES (?, ?, ?, ?, 'ACTIVE')
           ON DUPLICATE KEY UPDATE name = VALUES(name), status = 'ACTIVE'`,
          [genderRow.id, categoryRow.id, typeName, taxonomySlug(typeName)]
        );
      }
    }
  }
}

async function migrateProductsToTaxonomy(connection) {
  await connection.query(`
    UPDATE products
    SET gender = CASE
      WHEN UPPER(COALESCE(gender, '')) = 'MEN' THEN 'MEN'
      WHEN UPPER(COALESCE(gender, '')) = 'WOMEN' THEN 'WOMEN'
      WHEN UPPER(COALESCE(gender, '')) = 'KIDS' THEN 'KIDS'
      ELSE gender
    END
  `);
  await connection.query(`
    UPDATE products p
    JOIN genders g ON UPPER(g.name) = UPPER(p.gender)
    SET p.gender_id = g.id
    WHERE p.gender_id IS NULL
  `);
  await connection.query(`
    UPDATE products p
    JOIN genders g ON g.id = p.gender_id
    SET p.category = CASE
          WHEN UPPER(g.name) = 'KIDS' AND (LOWER(p.name) LIKE '%frock%' OR LOWER(p.name) LIKE '%dress%' OR LOWER(p.name) LIKE '%lehenga%') THEN 'Girls'
          WHEN UPPER(g.name) = 'KIDS' AND UPPER(COALESCE(p.product_category, '')) IN ('FORMAL', 'TRADITIONAL') THEN 'Boys'
          WHEN UPPER(g.name) = 'KIDS' AND UPPER(COALESCE(p.product_category, '')) = 'PARTY_WEAR' THEN 'Party Wear'
          WHEN UPPER(g.name) = 'KIDS' AND UPPER(COALESCE(p.product_category, '')) = 'SUMMER_WEAR' THEN 'Casual'
          ELSE p.category
        END
    WHERE UPPER(g.name) = 'KIDS'
  `);
  await connection.query(`
    UPDATE products p
    JOIN genders g ON g.id = p.gender_id
    JOIN categories c
      ON c.gender_id = g.id
     AND LOWER(c.name) = LOWER(COALESCE(NULLIF(p.category, ''), NULLIF(REPLACE(p.product_category, '_', ' '), ''), 'Casual'))
    SET p.category_id = c.id,
        p.category = c.name,
        p.product_category = UPPER(REPLACE(c.name, ' ', '_')),
        p.men_category = IF(UPPER(g.name) = 'MEN', UPPER(REPLACE(c.name, ' ', '_')), NULL),
        p.women_category = IF(UPPER(g.name) = 'WOMEN', UPPER(REPLACE(c.name, ' ', '_')), NULL),
        p.kids_category = IF(UPPER(g.name) = 'KIDS', UPPER(REPLACE(c.name, ' ', '_')), NULL)
    WHERE p.category_id IS NULL
      AND p.gender_id IS NOT NULL
  `);
  await connection.query(`
    UPDATE products p
    JOIN genders g ON g.id = p.gender_id
    JOIN categories c ON c.id = p.category_id
    JOIN product_types pt
      ON pt.gender_id = g.id
     AND pt.category_id = c.id
     AND LOWER(pt.name) = LOWER(COALESCE(NULLIF(p.product_type, ''), '${inferTaxonomyProductType('shirt')}'))
    SET p.product_type_id = pt.id,
        p.product_type = pt.name
    WHERE p.product_type_id IS NULL
  `);
  const [productsWithoutType] = await connection.execute(`
    SELECT p.id, p.name, p.gender_id, p.category_id
    FROM products p
    WHERE p.gender_id IS NOT NULL
      AND p.category_id IS NOT NULL
      AND p.product_type_id IS NULL
  `);
  for (const product of productsWithoutType) {
    const inferredType = inferTaxonomyProductType(product.name);
    const [[typeRow]] = await connection.execute(
      `SELECT id, name
       FROM product_types
       WHERE gender_id = ? AND category_id = ? AND LOWER(name) = LOWER(?)
       LIMIT 1`,
      [product.gender_id, product.category_id, inferredType]
    );
    if (!typeRow) continue;
    await connection.execute(
      'UPDATE products SET product_type_id = ?, product_type = ? WHERE id = ?',
      [typeRow.id, typeRow.name, product.id]
    );
  }
}

const curatedMenProducts = [
  ['CASUAL', 'Men Casual Denim Shirt', 'Roadster', 1199, 1899, 'M', 'Denim Blue', 'https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=900&q=80'],
  ['CASUAL', 'Men Graphic T-Shirt', 'HRX', 699, 1099, 'L', 'Black', 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=900&q=80'],
  ['CASUAL', 'Men Casual Hoodie', 'DressShop', 1499, 2299, 'XL', 'Charcoal', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Men Office Blazer', 'Louis Philippe', 3999, 5999, 'L', 'Navy', 'https://images.unsplash.com/photo-1617137968427-85924c800a22?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Men Formal White Shirt', 'Van Heusen', 1299, 1999, 'M', 'White', 'https://images.unsplash.com/photo-1593032465175-481ac7f401a0?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Men Slim Fit Formal Trouser', 'Arrow', 1599, 2499, 'M', 'Grey', 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Men Silk Kurta', 'Manyavar', 1799, 2799, 'L', 'Cream', 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Men Sherwani Set', 'Ethnix', 5999, 8999, 'L', 'Maroon', 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Men Dhoti Kurta', 'Sojanya', 2299, 3499, 'M', 'Ivory', 'https://images.unsplash.com/photo-1617127365659-c47fa864d8bc?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Men Party Blazer', 'Blackberrys', 3499, 5299, 'L', 'Black', 'https://images.unsplash.com/photo-1492447166138-50c3889fccb1?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Men Velvet Suit', 'Raymond', 6499, 9499, 'L', 'Wine', 'https://images.unsplash.com/photo-1520975954732-35dd22299614?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Men Designer Black Shirt', 'DressShop', 1699, 2599, 'M', 'Black', 'https://images.unsplash.com/photo-1506629905607-d9c297d9bf95?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Men Linen Shirt', 'Mast & Harbour', 1399, 2199, 'M', 'Sky Blue', 'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Men Cotton Shorts Set', 'HIGHLANDER', 1199, 1899, 'L', 'Olive', 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Men Sleeveless Summer T-Shirt', 'HRX', 599, 999, 'M', 'White', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80']
];

const curatedKidsProducts = [
  ['CASUAL', 'Kids Casual T-Shirt', 'YK Kids', 499, 799, '5-6Y', 'Yellow', 'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=900&q=80'],
  ['CASUAL', 'Kids Denim Shorts Set', 'Tiny Tara', 899, 1399, '6-7Y', 'Denim Blue', 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=80'],
  ['CASUAL', 'Kids Cartoon Hoodie', 'LilPicks', 999, 1599, '7-8Y', 'Red', 'https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Kids Formal Shirt', 'Cherry Crumble', 799, 1299, '6-7Y', 'White', 'https://images.unsplash.com/photo-1471286174890-9c112ffca5b4?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Kids Party Blazer Set', 'DressShop', 1899, 2899, '7-8Y', 'Navy', 'https://images.unsplash.com/photo-1514090458221-65bb69cf63e6?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Kids Formal Frock', 'Tiny Tara', 1299, 1999, '5-6Y', 'Pink', 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Kids Kurta Pajama', 'Sojanya Kids', 1199, 1899, '6-7Y', 'Cream', 'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Kids Lehenga Choli', 'Tiny Tara', 1999, 3099, '7-8Y', 'Maroon', 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Kids Ethnic Sherwani', 'DressShop', 2499, 3799, '8-9Y', 'Gold', 'https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Kids Sequin Party Dress', 'Cherry Crumble', 1599, 2499, '6-7Y', 'Silver', 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Kids Bow Tie Suit', 'YK Kids', 2199, 3299, '7-8Y', 'Black', 'https://images.unsplash.com/photo-1514090458221-65bb69cf63e6?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Kids Birthday Gown', 'Tiny Tara', 1799, 2699, '5-6Y', 'Rose Pink', 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Kids Cotton Summer Dress', 'LilPicks', 899, 1399, '5-6Y', 'Mint', 'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Kids Sleeveless Top Set', 'YK Kids', 699, 1099, '6-7Y', 'Sky Blue', 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Kids Linen Shorts Set', 'DressShop', 999, 1599, '7-8Y', 'Beige', 'https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=900&q=80']
];

const curatedWomenProducts = [
  ['CASUAL', 'Floral Casual Top', 'DressShop', 899, 1299, 'M', 'Rose', 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80'],
  ['CASUAL', 'Denim Casual Dress', 'DressBerry', 1499, 2199, 'M', 'Denim Blue', 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80'],
  ['CASUAL', 'Cotton Kurti Casual', 'Anouk', 999, 1599, 'L', 'Peach', 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Women Office Blazer', 'Tokyo Talkies', 2499, 3499, 'M', 'Black', 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Formal Shirt Dress', 'DressBerry', 1699, 2499, 'M', 'White', 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=900&q=80'],
  ['FORMAL', 'Pencil Skirt Set', 'Sangria', 1899, 2799, 'L', 'Navy', 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Silk Saree', 'Anouk', 2999, 4599, 'Free Size', 'Maroon', 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Anarkali Kurti', 'Sangria', 1799, 2699, 'M', 'Indigo', 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?auto=format&fit=crop&w=900&q=80'],
  ['TRADITIONAL', 'Lehenga Choli', 'DressShop', 3999, 5999, 'M', 'Pink', 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Sequin Party Dress', 'Tokyo Talkies', 2199, 3299, 'M', 'Silver', 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Velvet Gown', 'DressBerry', 3499, 4999, 'L', 'Wine', 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=900&q=80'],
  ['PARTY_WEAR', 'Designer Party Saree', 'Sangria', 3199, 4799, 'Free Size', 'Gold', 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Cotton Summer Dress', 'DressShop', 1199, 1799, 'M', 'Yellow', 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Linen Co-ord Set', 'Anouk', 1999, 2999, 'M', 'Ivory', 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80'],
  ['SUMMER_WEAR', 'Sleeveless Maxi Dress', 'DressBerry', 1599, 2399, 'L', 'Teal', 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=900&q=80']
];

function womenCategoryLabel(value) {
  return categoryLabels[value] || value;
}

function menCategoryLabel(value) {
  return categoryLabels[value] || value;
}

function kidsCategoryLabel(value) {
  return categoryLabels[value] || value;
}

async function seedCuratedMenProducts(connection) {
  await connection.execute("DELETE FROM products WHERE UPPER(COALESCE(gender, '')) = 'MEN'");

  for (const [index, product] of curatedMenProducts.entries()) {
    const [menCategory, name, brand, price, mrp, size, color, imageUrl] = product;
    const slug = `men-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
    const discount = Math.round(((mrp - price) / mrp) * 100);
    await connection.execute(
      `INSERT INTO products
        (gender, product_category, men_category, category, name, slug, brand, price, mrp, originalPrice, discount_percent, discount, image_url, image, sizes, size, color, stock, rating, description, is_active)
       VALUES ('MEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
        gender = 'MEN',
        product_category = VALUES(product_category),
        men_category = VALUES(men_category),
        category = VALUES(category),
        name = VALUES(name),
        brand = VALUES(brand),
        price = VALUES(price),
        mrp = VALUES(mrp),
        originalPrice = VALUES(originalPrice),
        discount_percent = VALUES(discount_percent),
        discount = VALUES(discount),
        image_url = VALUES(image_url),
        image = VALUES(image),
        sizes = VALUES(sizes),
        size = VALUES(size),
        color = VALUES(color),
        stock = VALUES(stock),
        rating = VALUES(rating),
        description = VALUES(description),
        is_active = TRUE`,
      [
        menCategory,
        menCategory,
        menCategoryLabel(menCategory),
        name,
        slug,
        brand,
        price,
        mrp,
        mrp,
        discount,
        discount,
        imageUrl,
        imageUrl,
        'S,M,L,XL',
        size,
        color,
        20 + index,
        Number((4.1 + (index % 5) / 10).toFixed(1)),
        `${name} for ${menCategoryLabel(menCategory).toLowerCase()} men styling.`
      ]
    );
  }
}

async function seedCuratedKidsProducts(connection) {
  await connection.execute("DELETE FROM products WHERE UPPER(COALESCE(gender, '')) = 'KIDS'");

  for (const [index, product] of curatedKidsProducts.entries()) {
    const [kidsCategory, name, brand, price, mrp, size, color, imageUrl] = product;
    const slug = `kids-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
    const discount = Math.round(((mrp - price) / mrp) * 100);
    await connection.execute(
      `INSERT INTO products
        (gender, product_category, kids_category, category, name, slug, brand, price, mrp, originalPrice, discount_percent, discount, image_url, image, sizes, size, color, stock, rating, description, is_active)
       VALUES ('KIDS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
        gender = 'KIDS',
        product_category = VALUES(product_category),
        kids_category = VALUES(kids_category),
        category = VALUES(category),
        name = VALUES(name),
        brand = VALUES(brand),
        price = VALUES(price),
        mrp = VALUES(mrp),
        originalPrice = VALUES(originalPrice),
        discount_percent = VALUES(discount_percent),
        discount = VALUES(discount),
        image_url = VALUES(image_url),
        image = VALUES(image),
        sizes = VALUES(sizes),
        size = VALUES(size),
        color = VALUES(color),
        stock = VALUES(stock),
        rating = VALUES(rating),
        description = VALUES(description),
        is_active = TRUE`,
      [
        kidsCategory,
        kidsCategory,
        kidsCategoryLabel(kidsCategory),
        name,
        slug,
        brand,
        price,
        mrp,
        mrp,
        discount,
        discount,
        imageUrl,
        imageUrl,
        '2-3Y,4-5Y,5-6Y,6-7Y,7-8Y,8-9Y',
        size,
        color,
        25 + index,
        Number((4.2 + (index % 5) / 10).toFixed(1)),
        `${name} for ${kidsCategoryLabel(kidsCategory).toLowerCase()} kids styling.`
      ]
    );
  }
}

async function seedCuratedWomenProducts(connection) {
  for (const [index, product] of curatedWomenProducts.entries()) {
    const [womenCategory, name, brand, price, mrp, size, color, imageUrl] = product;
    const slug = `women-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
    const discount = Math.round(((mrp - price) / mrp) * 100);
    await connection.execute(
      `INSERT INTO products
        (gender, product_category, women_category, category, name, slug, brand, price, mrp, originalPrice, discount_percent, discount, image_url, image, sizes, size, color, stock, rating, description, is_active)
       VALUES ('WOMEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
        gender = 'WOMEN',
        product_category = VALUES(product_category),
        women_category = VALUES(women_category),
        category = VALUES(category),
        name = VALUES(name),
        brand = VALUES(brand),
        price = VALUES(price),
        mrp = VALUES(mrp),
        originalPrice = VALUES(originalPrice),
        discount_percent = VALUES(discount_percent),
        discount = VALUES(discount),
        image_url = VALUES(image_url),
        image = VALUES(image),
        sizes = VALUES(sizes),
        size = VALUES(size),
        color = VALUES(color),
        stock = VALUES(stock),
        rating = VALUES(rating),
        description = VALUES(description),
        is_active = TRUE`,
      [
        womenCategory,
        womenCategory,
        womenCategoryLabel(womenCategory),
        name,
        slug,
        brand,
        price,
        mrp,
        mrp,
        discount,
        discount,
        imageUrl,
        imageUrl,
        size === 'Free Size' ? 'Free Size' : 'S,M,L,XL',
        size,
        color,
        18 + index,
        Number((4.2 + (index % 5) / 10).toFixed(1)),
        `${name} for ${womenCategoryLabel(womenCategory).toLowerCase()} women styling.`
      ]
    );
  }
}

async function setup() {
  const database = process.env.DB_NAME || 'dress_shop';
  const root = await mysql.createConnection(config);
  await root.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  await root.end();

  const connection = await mysql.createConnection({ ...config, database });

  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      mobile VARCHAR(30),
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'USER',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INT PRIMARY KEY AUTO_INCREMENT,
      gender_id INT NULL,
      category_id INT NULL,
      product_type_id INT NULL,
      gender VARCHAR(20) NULL,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NULL,
      description TEXT,
      category VARCHAR(100),
      product_category VARCHAR(50) NULL,
      brand VARCHAR(100),
      size VARCHAR(50),
      color VARCHAR(50),
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      mrp DECIMAL(10,2) NULL,
      discount_percent DECIMAL(10,2) DEFAULT 0,
      discount DECIMAL(10,2) DEFAULT 0,
      costPrice DECIMAL(10,2) DEFAULT 0,
      originalPrice DECIMAL(10,2) NOT NULL DEFAULT 0,
      isOnSale BOOLEAN DEFAULT FALSE,
      saleType ENUM('percentage', 'flat', 'bogo') NULL,
      saleValue DECIMAL(10,2) NULL,
      saleStartDate DATE NULL,
      saleEndDate DATE NULL,
      dedPermitNumber VARCHAR(100) NULL,
      stock INT NOT NULL DEFAULT 0,
      image_url VARCHAR(500),
      image VARCHAR(500),
      sizes VARCHAR(255),
      rating DECIMAL(3,2) DEFAULT 4.2,
      is_replacement_available TINYINT(1) DEFAULT 1,
      replacement_days INT DEFAULT NULL,
      replacement_policy TEXT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      parent_id INT NULL,
      gender_id INT NULL,
      gender VARCHAR(20) NOT NULL,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      replacement_days INT DEFAULT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS genders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

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
    );

    CREATE TABLE IF NOT EXISTS cart (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_cart_item (user_id, product_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS monthly_purchase_templates (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      month INT NOT NULL,
      year INT NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_month_template (user_id, month, year),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS monthly_purchase_template_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      template_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit VARCHAR(30) NOT NULL DEFAULT 'pcs',
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      is_selected BOOLEAN NOT NULL DEFAULT FALSE,
      line_total DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_monthly_template_product (template_id, product_id),
      FOREIGN KEY (template_id) REFERENCES monthly_purchase_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS monthly_template_checkout_sessions (
      id CHAR(36) PRIMARY KEY,
      user_id INT NOT NULL,
      template_id INT NOT NULL,
      items_json JSON NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES monthly_purchase_templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      line1 VARCHAR(255) NOT NULL,
      line2 VARCHAR(255),
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      pincode VARCHAR(20) NOT NULL,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_number VARCHAR(100) UNIQUE NOT NULL,
      user_id INT NOT NULL,
      address_id INT NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      payment_method VARCHAR(100) NOT NULL,
      paid_status VARCHAR(50) NOT NULL,
      delivery_status VARCHAR(50) NOT NULL DEFAULT 'PLACED',
      stock_deducted BOOLEAN DEFAULT FALSE,
      delivered_on DATETIME,
      delivered_at DATETIME NULL,
      super_coin_awarded TINYINT(1) NOT NULL DEFAULT 0,
      super_coin_eligible_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (address_id) REFERENCES addresses(id)
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INT PRIMARY KEY AUTO_INCREMENT,
      coupon_code VARCHAR(50) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      minimum_order DECIMAL(10,2) NOT NULL DEFAULT 0,
      expiry_date DATETIME NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      used_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      quantity INT NOT NULL,
      stock_quantity INT NOT NULL DEFAULT 1,
      return_days INT NOT NULL DEFAULT 0,
      replacement_days INT NOT NULL DEFAULT 0,
      selected_size VARCHAR(50),
      item_status VARCHAR(50) DEFAULT 'ACTIVE',
      image VARCHAR(500),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_cancellations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      order_item_id INT NOT NULL,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      cancel_reason VARCHAR(500) NOT NULL,
      refund_status VARCHAR(50) DEFAULT 'PENDING',
      admin_remarks TEXT NULL,
      action_by VARCHAR(100) NULL,
      action_date DATETIME NULL,
      cancelled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_cancelled_order_item (order_item_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_delivery_requests (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      order_item_id INT NOT NULL,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      request_type VARCHAR(50) NOT NULL,
      request_reason VARCHAR(500) NOT NULL,
      request_status VARCHAR(50) DEFAULT 'PENDING',
      refund_status VARCHAR(50) DEFAULT 'PENDING',
      refund_amount DECIMAL(10,2) NULL,
      refund_payment_method VARCHAR(80) NULL,
      refund_transaction_id VARCHAR(120) NULL,
      refund_processing_at DATETIME NULL,
      refund_completed_at DATETIME NULL,
      return_picked_up_at DATETIME NULL,
      return_completed_at DATETIME NULL,
      admin_remarks VARCHAR(255),
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_post_delivery_order_item (order_item_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_reviews (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      order_item_id INT NOT NULL,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      rating INT NOT NULL,
      review_text TEXT,
      is_hidden BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_review_order_item (order_item_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS super_coin_rules (
      id INT PRIMARY KEY AUTO_INCREMENT,
      rule_name VARCHAR(120) NOT NULL,
      coins_per_amount INT NOT NULL DEFAULT 1,
      amount_unit DECIMAL(10,2) NOT NULL DEFAULT 100.00,
      first_order_bonus INT NOT NULL DEFAULT 0,
      review_bonus INT NOT NULL DEFAULT 0,
      referral_bonus INT NOT NULL DEFAULT 0,
      max_redeem_percentage DECIMAL(5,2) NOT NULL DEFAULT 10.00,
      coin_value_in_rupees DECIMAL(10,2) NOT NULL DEFAULT 1.00,
      expiry_days INT NOT NULL DEFAULT 365,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS super_coin_wallets (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL UNIQUE,
      balance INT NOT NULL DEFAULT 0,
      total_earned INT NOT NULL DEFAULT 0,
      total_redeemed INT NOT NULL DEFAULT 0,
      total_expired INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS super_coin_transactions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      order_id INT NULL,
      type VARCHAR(30) NOT NULL,
      coins INT NOT NULL,
      rupee_value DECIMAL(10,2) NOT NULL DEFAULT 0,
      description VARCHAR(500),
      expiry_date DATE NULL,
      status VARCHAR(30) NOT NULL,
      reward_type VARCHAR(50) NULL,
      reference_type VARCHAR(50) NULL,
      reference_id INT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_super_coin_transactions_user (user_id),
      INDEX idx_super_coin_transactions_order (order_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_super_coin_details (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL UNIQUE,
      user_id INT NOT NULL,
      coins_redeemed INT NOT NULL DEFAULT 0,
      redeem_value DECIMAL(10,2) NOT NULL DEFAULT 0,
      coins_to_earn INT NOT NULL DEFAULT 0,
      earn_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      earned_at DATETIME NULL,
      reversed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_super_coin_details_user (user_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pending_super_coin_rewards (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      coins INT NOT NULL,
      reward_type VARCHAR(50) NOT NULL,
      reference_type VARCHAR(50) NOT NULL,
      reference_id INT NOT NULL,
      eligible_at DATETIME NOT NULL,
      status ENUM('PENDING','CREDITED','CANCELLED') NOT NULL DEFAULT 'PENDING',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      credited_at DATETIME NULL,
      UNIQUE KEY unique_pending_reward (reward_type, reference_type, reference_id),
      INDEX idx_pending_rewards_status_date (status, eligible_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_payment_methods (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      type VARCHAR(30) NOT NULL,
      label VARCHAR(255) NOT NULL,
      details TEXT NOT NULL,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wishlists (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_wishlist_item (user_id, product_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL UNIQUE,
      wallet_number VARCHAR(50) UNIQUE,
      balance DECIMAL(10,2) DEFAULT 0,
      wallet_status VARCHAR(50) DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NULL,
      sender_id INT NULL,
      receiver_id INT NULL,
      wallet_id INT,
      transaction_type VARCHAR(50),
      amount DECIMAL(10,2),
      payment_method VARCHAR(50),
      transaction_id VARCHAR(100),
      payment_status VARCHAR(50),
      status VARCHAR(50),
      transaction_note VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_logos (
      id INT PRIMARY KEY AUTO_INCREMENT,
      logo_url VARCHAR(500) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS company_settings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      company_name VARCHAR(255) NOT NULL,
      logo_url VARCHAR(500) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chatbot_conversations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      status ENUM('open','closed') NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_chatbot_conversations_user_status (user_id, status),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chatbot_messages (
      id INT PRIMARY KEY AUTO_INCREMENT,
      conversation_id INT NOT NULL,
      sender_type ENUM('user','admin','bot') NOT NULL,
      sender_id INT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_chatbot_messages_conversation (conversation_id, created_at),
      FOREIGN KEY (conversation_id) REFERENCES chatbot_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS hubs (
      id CHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      hub_code VARCHAR(50),
      code VARCHAR(50) NOT NULL UNIQUE,
      address TEXT NOT NULL,
      area VARCHAR(150),
      city VARCHAR(100) NOT NULL DEFAULT '',
      state VARCHAR(100),
      pincode VARCHAR(6) NOT NULL,
      latitude DECIMAL(10,7),
      longitude DECIMAL(10,7),
      status VARCHAR(20) DEFAULT 'ACTIVE',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hub_pincodes (
      id CHAR(36) PRIMARY KEY,
      hub_id CHAR(36) NOT NULL,
      pincode VARCHAR(6) NOT NULL,
      delivery_days INT NOT NULL,
      delivery_days_min INT,
      delivery_days_max INT,
      is_primary BOOLEAN DEFAULT TRUE,
      is_serviceable BOOLEAN DEFAULT TRUE,
      cod_available BOOLEAN DEFAULT TRUE,
      INDEX idx_hub_pincodes_pincode (pincode),
      UNIQUE KEY unique_hub_pincode (hub_id, pincode),
      FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hub_stocks (
      id CHAR(36) PRIMARY KEY,
      hub_id CHAR(36) NOT NULL,
      product_id INT NOT NULL,
      variant_id VARCHAR(100) NOT NULL DEFAULT '',
      quantity INT NOT NULL DEFAULT 0,
      reserved_qty INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_hub_product_variant (hub_id, product_id, variant_id),
      FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hub_inventory (
      id CHAR(36) PRIMARY KEY,
      hub_id CHAR(36) NOT NULL,
      product_id INT NOT NULL,
      variant_id VARCHAR(100) NOT NULL DEFAULT '',
      stock_qty INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_hub_inventory_product_variant (hub_id, product_id, variant_id),
      FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_tracking (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      delivery_hub_id CHAR(36) NULL,
      delivery_hub_name VARCHAR(255) NULL,
      delivery_pincode VARCHAR(6) NULL,
      estimated_delivery_date DATE NULL,
      estimated_delivery_min_days INT NULL,
      estimated_delivery_max_days INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_order_tracking_order (order_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS coupon_usages (
      id INT PRIMARY KEY AUTO_INCREMENT,
      coupon_id INT NOT NULL,
      user_id INT NOT NULL,
      order_id INT NOT NULL,
      used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS help_categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      description VARCHAR(255),
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS help_articles (
      id INT PRIMARY KEY AUTO_INCREMENT,
      category_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(280) NOT NULL UNIQUE,
      content TEXT NOT NULL,
      is_popular BOOLEAN DEFAULT FALSE,
      helpful_yes INT NOT NULL DEFAULT 0,
      helpful_no INT NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES help_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INT PRIMARY KEY AUTO_INCREMENT,
      ticket_no VARCHAR(40) UNIQUE,
      user_id INT NOT NULL,
      order_id INT NULL,
      issue_type VARCHAR(120) NOT NULL,
      ticket_type VARCHAR(100),
      subject VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      image_url VARCHAR(500),
      status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS support_ticket_replies (
      id INT PRIMARY KEY AUTO_INCREMENT,
      ticket_id INT NOT NULL,
      sender_type VARCHAR(20) NOT NULL DEFAULT 'user',
      sender_id INT NULL,
      user_id INT NOT NULL,
      message TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(100) UNIQUE NOT NULL,
      setting_value VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS guest_otps (
      id INT PRIMARY KEY AUTO_INCREMENT,
      verification_type ENUM('email','mobile') NOT NULL,
      email VARCHAR(255) NULL,
      mobile VARCHAR(20) NULL,
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      verified TINYINT(1) NOT NULL DEFAULT 0,
      guest_token VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_guest_otps_lookup (verification_type, email, mobile),
      INDEX idx_guest_otps_token (guest_token)
    );

    CREATE TABLE IF NOT EXISTS guest_orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      guest_token VARCHAR(255),
      guest_email VARCHAR(255) NULL,
      guest_mobile VARCHAR(20) NULL,
      guest_name VARCHAR(100) NOT NULL,
      address TEXT NOT NULL,
      pincode VARCHAR(10) NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      payment_method VARCHAR(50) NOT NULL,
      payment_details TEXT NULL,
      payment_status VARCHAR(50) NOT NULL,
      order_status VARCHAR(50) NOT NULL,
      order_number VARCHAR(100) NULL,
      verification_type VARCHAR(20) NULL,
      delivery_hub_id VARCHAR(80) NULL,
      delivery_hub_name VARCHAR(255) NULL,
      estimated_delivery_date DATE NULL,
      estimated_delivery_min_days INT NULL,
      estimated_delivery_max_days INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS guest_order_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      guest_order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      quantity INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      total_price DECIMAL(10,2) NOT NULL,
      FOREIGN KEY (guest_order_id) REFERENCES guest_orders(id) ON DELETE CASCADE
    );
  `);

  await ensureColumn(connection, 'users', 'mobile', 'mobile VARCHAR(30)');
  await ensureColumn(connection, 'orders', 'order_number', 'order_number VARCHAR(50) UNIQUE');
  await ensureColumn(connection, 'cart', 'size', 'size VARCHAR(50)');
  await ensureColumn(connection, 'cart', 'color', "color VARCHAR(50) NOT NULL DEFAULT ''");
  await ensureColumn(connection, 'monthly_purchase_templates', 'total_amount', 'total_amount DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'monthly_purchase_templates', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await ensureColumn(connection, 'monthly_purchase_template_items', 'unit', "unit VARCHAR(30) NOT NULL DEFAULT 'pcs'");
  await ensureColumn(connection, 'monthly_purchase_template_items', 'amount', 'amount DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'monthly_purchase_template_items', 'is_selected', 'is_selected BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureColumn(connection, 'monthly_purchase_template_items', 'line_total', 'line_total DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'monthly_template_checkout_sessions', 'status', "status VARCHAR(30) NOT NULL DEFAULT 'OPEN'");
  await ensureColumn(connection, 'orders', 'order_source', "order_source VARCHAR(50) NOT NULL DEFAULT 'cart'");
  await ensureColumn(connection, 'orders', 'super_coin_discount', 'super_coin_discount DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'orders', 'super_coins_redeemed', 'super_coins_redeemed INT NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'orders', 'super_coins_earned', 'super_coins_earned INT NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'products', 'discount', 'discount DECIMAL(10,2) DEFAULT 0');
  await ensureColumn(connection, 'products', 'gender_id', 'gender_id INT NULL');
  await ensureColumn(connection, 'products', 'category_id', 'category_id INT NULL');
  await ensureColumn(connection, 'products', 'product_type_id', 'product_type_id INT NULL');
  await ensureColumn(connection, 'products', 'gender', 'gender VARCHAR(20) NULL');
  await ensureColumn(connection, 'products', 'product_category', 'product_category VARCHAR(50) NULL');
  await ensureColumn(connection, 'products', 'product_type', 'product_type VARCHAR(80) NULL');
  await ensureColumn(connection, 'products', 'men_category', 'men_category VARCHAR(50) NULL');
  await ensureColumn(connection, 'products', 'women_category', 'women_category VARCHAR(50) NULL');
  await ensureColumn(connection, 'products', 'kids_category', 'kids_category VARCHAR(50) NULL');
  await ensureColumn(connection, 'products', 'slug', 'slug VARCHAR(255) NULL');
  await ensureColumn(connection, 'products', 'mrp', 'mrp DECIMAL(10,2) NULL');
  await ensureColumn(connection, 'products', 'discount_percent', 'discount_percent DECIMAL(10,2) DEFAULT 0');
  await ensureColumn(connection, 'products', 'image_url', 'image_url VARCHAR(500)');
  await ensureColumn(connection, 'products', 'sizes', 'sizes VARCHAR(255)');
  await ensureColumn(connection, 'products', 'rating', 'rating DECIMAL(3,2) DEFAULT 4.2');
  await ensureColumn(connection, 'products', 'is_replacement_available', 'is_replacement_available TINYINT(1) DEFAULT 1');
  await ensureColumn(connection, 'products', 'replacement_days', 'replacement_days INT DEFAULT NULL');
  await ensureColumn(connection, 'products', 'replacement_policy', 'replacement_policy TEXT NULL');
  await ensureColumn(connection, 'products', 'is_active', 'is_active BOOLEAN DEFAULT TRUE');
  await ensureColumn(connection, 'categories', 'gender_id', 'gender_id INT NULL');
  await ensureColumn(connection, 'categories', 'status', "status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'");
  await ensureColumn(connection, 'categories', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await ensureColumn(connection, 'categories', 'replacement_days', 'replacement_days INT DEFAULT NULL');
  await ensureColumn(connection, 'addresses', 'is_default', 'is_default BOOLEAN DEFAULT FALSE');
  await ensureColumn(connection, 'orders', 'delivered_on', 'delivered_on DATETIME');
  await ensureColumn(connection, 'orders', 'delivered_at', 'delivered_at DATETIME NULL');
  await ensureColumn(connection, 'orders', 'super_coin_awarded', 'super_coin_awarded TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'orders', 'super_coin_eligible_at', 'super_coin_eligible_at DATETIME NULL');
  await ensureColumn(connection, 'orders', 'stock_deducted', 'stock_deducted BOOLEAN DEFAULT FALSE');
  await ensureColumn(connection, 'orders', 'payment_details', 'payment_details TEXT');
  await ensureColumn(connection, 'orders', 'coupon_id', 'coupon_id INT NULL');
  await ensureColumn(connection, 'orders', 'coupon_code', 'coupon_code VARCHAR(50) NULL');
  await ensureColumn(connection, 'orders', 'discount_amount', 'discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'orders', 'coupon_discount_amount', 'coupon_discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'order_items', 'image', 'image VARCHAR(500)');
  await ensureColumn(connection, 'order_items', 'selected_size', 'selected_size VARCHAR(50)');
  await ensureColumn(connection, 'order_items', 'stock_quantity', 'stock_quantity INT NOT NULL DEFAULT 1');
  await ensureColumn(connection, 'order_items', 'return_days', 'return_days INT NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'order_items', 'replacement_days', 'replacement_days INT NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'order_items', 'item_status', "item_status VARCHAR(50) DEFAULT 'ACTIVE'");
  await ensureColumn(connection, 'order_cancellations', 'admin_remarks', 'admin_remarks TEXT NULL');
  await connection.query('ALTER TABLE order_cancellations MODIFY admin_remarks TEXT NULL');
  await ensureColumn(connection, 'order_cancellations', 'action_by', 'action_by VARCHAR(100) NULL');
  await ensureColumn(connection, 'order_cancellations', 'action_date', 'action_date DATETIME NULL');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cancellation_action_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cancellation_id INT NOT NULL,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      old_refund_status VARCHAR(30),
      new_refund_status VARCHAR(30),
      admin_remarks TEXT,
      action_by VARCHAR(100),
      action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cancellation_action_logs_cancellation (cancellation_id),
      FOREIGN KEY (cancellation_id) REFERENCES order_cancellations(id) ON DELETE CASCADE
    )
  `);
  await ensureColumn(connection, 'post_delivery_requests', 'refund_amount', 'refund_amount DECIMAL(10,2) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_payment_method', 'refund_payment_method VARCHAR(80) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_transaction_id', 'refund_transaction_id VARCHAR(120) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_processing_at', 'refund_processing_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_completed_at', 'refund_completed_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'return_picked_up_at', 'return_picked_up_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'return_completed_at', 'return_completed_at DATETIME NULL');
  await ensureColumn(connection, 'super_coin_transactions', 'reward_type', 'reward_type VARCHAR(50) NULL');
  await ensureColumn(connection, 'super_coin_transactions', 'reference_type', 'reference_type VARCHAR(50) NULL');
  await ensureColumn(connection, 'super_coin_transactions', 'reference_id', 'reference_id INT NULL');
  await ensureColumn(connection, 'saved_payment_methods', 'is_default', 'is_default BOOLEAN DEFAULT FALSE');
  await ensureColumn(connection, 'products', 'costPrice', 'costPrice DECIMAL(10,2) DEFAULT 0');
  await ensureColumn(connection, 'products', 'originalPrice', 'originalPrice DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'products', 'isOnSale', 'isOnSale BOOLEAN DEFAULT FALSE');
  await ensureColumn(connection, 'products', 'saleType', "saleType ENUM('percentage', 'flat', 'bogo') NULL");
  await ensureColumn(connection, 'products', 'saleValue', 'saleValue DECIMAL(10,2) NULL');
  await ensureColumn(connection, 'products', 'saleStartDate', 'saleStartDate DATE NULL');
  await ensureColumn(connection, 'products', 'saleEndDate', 'saleEndDate DATE NULL');
  await ensureColumn(connection, 'products', 'dedPermitNumber', 'dedPermitNumber VARCHAR(100) NULL');
  await ensureColumn(connection, 'products', 'default_hub_id', 'default_hub_id CHAR(36) NULL');
  await ensureColumn(connection, 'hubs', 'area', 'area VARCHAR(150)');
  await ensureColumn(connection, 'hubs', 'city', "city VARCHAR(100) NOT NULL DEFAULT ''");
  await ensureColumn(connection, 'hubs', 'hub_code', 'hub_code VARCHAR(50)');
  await ensureColumn(connection, 'hubs', 'state', 'state VARCHAR(100)');
  await ensureColumn(connection, 'hubs', 'latitude', 'latitude DECIMAL(10,7)');
  await ensureColumn(connection, 'hubs', 'longitude', 'longitude DECIMAL(10,7)');
  await ensureColumn(connection, 'hubs', 'status', "status VARCHAR(20) DEFAULT 'ACTIVE'");
  await ensureColumn(connection, 'hub_pincodes', 'delivery_days_min', 'delivery_days_min INT');
  await ensureColumn(connection, 'hub_pincodes', 'delivery_days_max', 'delivery_days_max INT');
  await ensureColumn(connection, 'hub_pincodes', 'is_primary', 'is_primary BOOLEAN DEFAULT TRUE');
  await ensureColumn(connection, 'orders', 'selected_hub_id', 'selected_hub_id CHAR(36) NULL');
  await ensureColumn(connection, 'orders', 'delivery_pincode', 'delivery_pincode VARCHAR(6) NULL');
  await ensureColumn(connection, 'orders', 'estimated_delivery_min_days', 'estimated_delivery_min_days INT NULL');
  await ensureColumn(connection, 'orders', 'estimated_delivery_max_days', 'estimated_delivery_max_days INT NULL');
  await ensureColumn(connection, 'orders', 'estimated_delivery_date', 'estimated_delivery_date DATE NULL');
  await ensureColumn(connection, 'orders', 'guest_name', 'guest_name VARCHAR(100) NULL');
  await ensureColumn(connection, 'orders', 'guest_email', 'guest_email VARCHAR(255) NULL');
  await ensureColumn(connection, 'orders', 'guest_mobile', 'guest_mobile VARCHAR(20) NULL');
  await ensureColumn(connection, 'orders', 'payment_status', 'payment_status VARCHAR(50) NULL');
  await ensureColumn(connection, 'orders', 'expected_delivery_date', 'expected_delivery_date DATE NULL');
  await ensureColumn(connection, 'orders', 'delivery_hub_id', 'delivery_hub_id CHAR(36) NULL');
  await ensureColumn(connection, 'orders', 'courier_partner', 'courier_partner VARCHAR(120) NULL');
  await ensureColumn(connection, 'orders', 'tracking_token', 'tracking_token VARCHAR(255) NULL');
  await ensureColumn(connection, 'orders', 'is_guest_order', 'is_guest_order TINYINT(1) NOT NULL DEFAULT 0');
  await connection.query('ALTER TABLE orders MODIFY user_id INT NULL');
  await connection.query('ALTER TABLE orders MODIFY address_id INT NULL');
  await ensureColumn(connection, 'order_tracking', 'delivery_hub_id', 'delivery_hub_id CHAR(36) NULL');
  await ensureColumn(connection, 'order_tracking', 'delivery_hub_name', 'delivery_hub_name VARCHAR(255) NULL');
  await ensureColumn(connection, 'order_tracking', 'delivery_pincode', 'delivery_pincode VARCHAR(6) NULL');
  await ensureColumn(connection, 'order_tracking', 'estimated_delivery_date', 'estimated_delivery_date DATE NULL');
  await ensureColumn(connection, 'order_tracking', 'estimated_delivery_min_days', 'estimated_delivery_min_days INT NULL');
  await ensureColumn(connection, 'order_tracking', 'estimated_delivery_max_days', 'estimated_delivery_max_days INT NULL');
  await ensureColumn(connection, 'wallets', 'wallet_status', "wallet_status VARCHAR(50) DEFAULT 'ACTIVE'");
  await ensureColumn(connection, 'wallet_transactions', 'user_id', 'user_id INT NULL');
  await ensureColumn(connection, 'wallet_transactions', 'payment_method', 'payment_method VARCHAR(50)');
  await ensureColumn(connection, 'wallet_transactions', 'transaction_id', 'transaction_id VARCHAR(100)');
  await ensureColumn(connection, 'wallet_transactions', 'payment_status', 'payment_status VARCHAR(50)');
  await ensureColumn(connection, 'support_tickets', 'subject', 'subject VARCHAR(255) NOT NULL DEFAULT "Support request"');
  await ensureColumn(connection, 'support_tickets', 'ticket_no', 'ticket_no VARCHAR(40) UNIQUE');
  await ensureColumn(connection, 'support_tickets', 'ticket_type', 'ticket_type VARCHAR(100)');
  await ensureColumn(connection, 'support_ticket_replies', 'sender_type', "sender_type VARCHAR(20) NOT NULL DEFAULT 'user'");
  await ensureColumn(connection, 'support_ticket_replies', 'sender_id', 'sender_id INT NULL');
  await ensureColumn(connection, 'site_logos', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await ensureColumn(connection, 'company_settings', 'logo_url', 'logo_url VARCHAR(500) NULL');
  await ensureColumn(connection, 'company_settings', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await ensureColumn(connection, 'chatbot_conversations', 'updated_at', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await ensureColumn(connection, 'chatbot_messages', 'is_read', 'is_read BOOLEAN DEFAULT FALSE');
  await ensureColumn(connection, 'guest_orders', 'order_number', 'order_number VARCHAR(100) NULL');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS guest_order_otps (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      contact_type ENUM('email','mobile') NOT NULL,
      contact_value VARCHAR(255) NOT NULL,
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      verified_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_guest_order_otps_order_contact (order_id, contact_type, contact_value, created_at),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS guest_tracking_otps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contact VARCHAR(150) NOT NULL,
      contact_type ENUM('email','mobile') NOT NULL,
      purpose VARCHAR(50) NOT NULL DEFAULT 'GUEST_ORDER_TRACKING',
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT DEFAULT 0,
      verified_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_guest_tracking_otps_contact (contact_type, contact, purpose, created_at)
    )
  `);
  await ensureColumn(connection, 'guest_tracking_otps', 'purpose', "purpose VARCHAR(50) NOT NULL DEFAULT 'GUEST_ORDER_TRACKING'");
  await ensureIndex(connection, 'chatbot_conversations', 'idx_chatbot_conversations_user_status', 'INDEX idx_chatbot_conversations_user_status (user_id, status)');
  await ensureIndex(connection, 'chatbot_messages', 'idx_chatbot_messages_conversation', 'INDEX idx_chatbot_messages_conversation (conversation_id, created_at)');
  await connection.query("UPDATE support_tickets SET ticket_no = CONCAT('TKT', LPAD(id, 6, '0')) WHERE ticket_no IS NULL OR ticket_no = ''");
  await connection.query("UPDATE support_tickets SET ticket_type = issue_type WHERE ticket_type IS NULL OR ticket_type = ''");
  await connection.query("UPDATE support_ticket_replies SET sender_type = IF(is_admin, 'admin', 'user') WHERE sender_type IS NULL OR sender_type = ''");
  await connection.query('UPDATE support_ticket_replies SET sender_id = COALESCE(sender_id, user_id) WHERE sender_id IS NULL');
  await connection.query('ALTER TABLE order_cancellations MODIFY user_id INT NULL');
  await connection.query('ALTER TABLE post_delivery_requests MODIFY user_id INT NULL');
  await connection.query('ALTER TABLE product_reviews MODIFY user_id INT NULL');
  await ensureColumn(connection, 'order_cancellations', 'guest_contact_type', 'guest_contact_type VARCHAR(20) NULL');
  await ensureColumn(connection, 'order_cancellations', 'guest_contact_value', 'guest_contact_value VARCHAR(150) NULL');
  await ensureColumn(connection, 'order_cancellations', 'admin_remarks', 'admin_remarks TEXT NULL');
  await connection.query('ALTER TABLE order_cancellations MODIFY admin_remarks TEXT NULL');
  await ensureColumn(connection, 'order_cancellations', 'action_by', 'action_by VARCHAR(100) NULL');
  await ensureColumn(connection, 'order_cancellations', 'action_date', 'action_date DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'guest_contact_type', 'guest_contact_type VARCHAR(20) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'guest_contact_value', 'guest_contact_value VARCHAR(150) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_amount', 'refund_amount DECIMAL(10,2) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_payment_method', 'refund_payment_method VARCHAR(80) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_transaction_id', 'refund_transaction_id VARCHAR(120) NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_processing_at', 'refund_processing_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'refund_completed_at', 'refund_completed_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'return_picked_up_at', 'return_picked_up_at DATETIME NULL');
  await ensureColumn(connection, 'post_delivery_requests', 'return_completed_at', 'return_completed_at DATETIME NULL');
  await ensureColumn(connection, 'product_reviews', 'guest_contact_type', 'guest_contact_type VARCHAR(20) NULL');
  await ensureColumn(connection, 'product_reviews', 'guest_contact_value', 'guest_contact_value VARCHAR(150) NULL');
  await ensureIndex(connection, 'categories', 'unique_gender_slug', 'UNIQUE KEY unique_gender_slug (gender, slug)');
  await ensureIndex(connection, 'categories', 'idx_categories_gender_id', 'INDEX idx_categories_gender_id (gender_id)');
  await ensureIndex(connection, 'categories', 'unique_category_gender_id_slug', 'UNIQUE KEY unique_category_gender_id_slug (gender_id, slug)');
  await ensureIndex(connection, 'genders', 'idx_genders_status', 'INDEX idx_genders_status (status)');
  await ensureIndex(connection, 'product_types', 'idx_product_types_status', 'INDEX idx_product_types_status (status)');
  await connection.query("UPDATE cart SET size = COALESCE(size, ''), color = COALESCE(color, '')");
  await mergeDuplicateCartVariants(connection);
  await ensureIndex(connection, 'cart', 'idx_cart_user_id', 'INDEX idx_cart_user_id (user_id)');
  await ensureIndex(connection, 'cart', 'idx_cart_product_id', 'INDEX idx_cart_product_id (product_id)');
  await ensureIndex(connection, 'cart', 'unique_cart_variant', 'UNIQUE KEY unique_cart_variant (user_id, product_id, size, color)');
  await dropIndexIfExists(connection, 'cart', 'unique_cart_item');
  await ensureIndex(connection, 'products', 'unique_product_slug', 'UNIQUE KEY unique_product_slug (slug)');
  await ensureIndex(connection, 'products', 'idx_products_gender_category', 'INDEX idx_products_gender_category (gender, category_id)');
  await ensureIndex(connection, 'products', 'idx_products_taxonomy', 'INDEX idx_products_taxonomy (gender_id, category_id, product_type_id)');
  await connection.query('UPDATE products SET originalPrice = price WHERE originalPrice = 0 OR originalPrice IS NULL');
  await connection.query('UPDATE products SET mrp = COALESCE(mrp, originalPrice, price), image_url = COALESCE(image_url, image), sizes = COALESCE(sizes, size), is_active = COALESCE(is_active, TRUE)');
  await connection.query(`
    UPDATE products
    SET gender = UPPER(gender),
        product_category = COALESCE(product_category, men_category, women_category, kids_category)
    WHERE gender IS NOT NULL
  `);
  await connection.query("UPDATE hubs SET city = SUBSTRING_INDEX(address, ', ', -1) WHERE city = '' OR city IS NULL");
  await connection.query("UPDATE hubs SET hub_code = code WHERE hub_code IS NULL OR hub_code = ''");
  await connection.query("UPDATE hubs SET status = IF(is_active, 'ACTIVE', 'INACTIVE') WHERE status IS NULL OR status = ''");
  await connection.query('UPDATE hub_pincodes SET delivery_days_min = COALESCE(delivery_days_min, delivery_days), delivery_days_max = COALESCE(delivery_days_max, delivery_days) WHERE delivery_days_min IS NULL OR delivery_days_max IS NULL');
  await connection.query('UPDATE order_items SET stock_quantity = quantity WHERE stock_quantity IS NULL OR stock_quantity < 1');
  await connection.query(`
    INSERT INTO products (id, name, slug, description, category, brand, price, originalPrice, stock, image, image_url, is_active)
    SELECT oi.product_id,
           MAX(oi.product_name),
           CONCAT('archived-order-product-', oi.product_id),
           'Archived product snapshot restored for order review.',
           'Archived',
           'DressShop',
           MAX(COALESCE(oi.price, 0)),
           MAX(COALESCE(oi.price, 0)),
           0,
           MAX(oi.image),
           MAX(oi.image),
           FALSE
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE p.id IS NULL AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
  `);
  await connection.query('UPDATE orders SET delivered_at = COALESCE(delivered_at, delivered_on) WHERE delivered_at IS NULL AND delivered_on IS NOT NULL');
  await connection.query(`
    UPDATE orders
    SET delivered_at = COALESCE(delivered_at, delivered_on, NOW()),
        delivered_on = COALESCE(delivered_on, delivered_at, NOW())
    WHERE is_guest_order = 1
      AND delivery_status = 'DELIVERED'
      AND delivered_at IS NULL
      AND delivered_on IS NULL
  `);
  await connection.query(`
    INSERT INTO wallets (user_id, wallet_number, balance, wallet_status)
    SELECT id, CONCAT('WLT', LPAD(id, 8, '0')), 0, 'ACTIVE'
    FROM users
    WHERE id NOT IN (SELECT user_id FROM wallets)
  `);

  const [[legacyStockMigration]] = await connection.execute(
    'SELECT setting_value FROM system_settings WHERE setting_key = ?',
    ['legacy_order_stock_reconciled']
  );
  if (!legacyStockMigration) {
    await connection.query(`
      UPDATE orders
      SET stock_deducted = TRUE
      WHERE stock_deducted = FALSE
        AND id IN (SELECT DISTINCT order_id FROM order_items)
    `);
    await connection.execute(
      'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
      ['legacy_order_stock_reconciled', 'true']
    );
  }

  const adminHash = await bcrypt.hash('adm@123', 10);
  await connection.execute(
    `INSERT INTO users (name, email, password, role)
     VALUES ('Admin', 'admin', ?, 'ADMIN')
     ON DUPLICATE KEY UPDATE name = 'Admin', password = VALUES(password), role = 'ADMIN'`,
    [adminHash]
  );

  await connection.execute(
    `INSERT INTO coupons (coupon_code, title, description, discount_amount, minimum_order, expiry_date, status)
     VALUES ('STYLE500', 'Premium style reward', 'Extra Rs.500 off on orders above Rs.2999', 500, 2999, DATE_ADD(NOW(), INTERVAL 90 DAY), 'ACTIVE')
     ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description)`
  );

  await connection.execute(
    `INSERT INTO super_coin_rules
      (rule_name, coins_per_amount, amount_unit, first_order_bonus, review_bonus, referral_bonus, max_redeem_percentage, coin_value_in_rupees, expiry_days, is_active)
     SELECT 'Default Super Coin Rule', 2, 100.00, 50, 10, 100, 10.00, 1.00, 365, TRUE
     WHERE NOT EXISTS (SELECT 1 FROM super_coin_rules)`
  );

  await connection.execute(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ('default_replacement_days', '7')
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`
  );
  await connection.query(`
    UPDATE order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    SET oi.return_days = CASE
          WHEN COALESCE(p.is_replacement_available, 1) = 0 THEN 0
          ELSE COALESCE(NULLIF(p.replacement_days, 0), (SELECT CAST(setting_value AS UNSIGNED) FROM app_settings WHERE setting_key = 'default_replacement_days' LIMIT 1), 7)
        END,
        oi.replacement_days = CASE
          WHEN COALESCE(p.is_replacement_available, 1) = 0 THEN 0
          ELSE COALESCE(NULLIF(p.replacement_days, 0), (SELECT CAST(setting_value AS UNSIGNED) FROM app_settings WHERE setting_key = 'default_replacement_days' LIMIT 1), 7)
        END
    WHERE o.is_guest_order = 1
      AND (COALESCE(oi.return_days, 0) = 0 OR COALESCE(oi.replacement_days, 0) = 0)
  `);

  await seedMenCatalog(connection);
  await connection.execute("DELETE FROM products WHERE UPPER(COALESCE(gender, '')) NOT IN ('MEN', 'WOMEN', 'KIDS')");
  await connection.execute("DELETE FROM products WHERE UPPER(COALESCE(gender, '')) IN ('MEN', 'WOMEN', 'KIDS')");
  await seedCuratedMenProducts(connection);
  await seedCuratedKidsProducts(connection);
  await seedCuratedWomenProducts(connection);
  await connection.query(`
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
  await connection.query("UPDATE products SET product_type = 'T-Shirt' WHERE LOWER(name) LIKE '%t-shirt%'");
  await connection.query("UPDATE products SET product_type = 'Shirt' WHERE LOWER(name) LIKE '%shirt%' AND LOWER(name) NOT LIKE '%t-shirt%'");
  await seedGenderCategoryProductTypes(connection);
  await migrateProductsToTaxonomy(connection);
  await connection.query(`
    INSERT INTO products (id, name, slug, description, category, brand, price, originalPrice, stock, image, image_url, is_active)
    SELECT oi.product_id,
           MAX(oi.product_name),
           CONCAT('archived-order-product-', oi.product_id),
           'Archived product snapshot restored for order review.',
           'Archived',
           'DressShop',
           MAX(COALESCE(oi.price, 0)),
           MAX(COALESCE(oi.price, 0)),
           0,
           MAX(oi.image),
           MAX(oi.image),
           FALSE
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE p.id IS NULL AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
  `);
  await connection.query(`
    INSERT INTO help_categories (name, slug, description, sort_order, is_active) VALUES
    ('Orders', 'orders', 'Track, modify and understand your orders.', 10, TRUE),
    ('Delivery', 'delivery', 'Shipping timelines, hubs and delivery support.', 20, TRUE),
    ('Returns', 'returns', 'Return pickup, eligibility and process.', 30, TRUE),
    ('Refunds', 'refunds', 'Refund timelines and payment reversals.', 40, TRUE),
    ('Payments', 'payments', 'Cards, UPI, COD and payment failures.', 50, TRUE),
    ('Wallet', 'wallet', 'DressShop wallet balance, add money and transfers.', 60, TRUE),
    ('Coupons', 'coupons', 'Coupon use, eligibility and discounts.', 70, TRUE),
    ('Account', 'account', 'Login, profile and saved details.', 80, TRUE),
    ('Product Issues', 'product-issues', 'Damaged, wrong or missing products.', 90, TRUE),
    ('Cancellation', 'cancellation', 'Cancel orders and cancellation refunds.', 100, TRUE)
    ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), sort_order = VALUES(sort_order), is_active = TRUE
  `);

  await connection.query(`
    INSERT INTO help_articles (category_id, title, slug, content, is_popular, is_active)
    SELECT c.id, seed.title, seed.slug, seed.content, seed.is_popular, TRUE
    FROM (
      SELECT 'orders' category_slug, 'How do I track my order?' title, 'how-do-i-track-my-order' slug, 'Open My Orders from your profile. Select an order to see its current delivery status, payment status, items and tracking estimate.' content, TRUE is_popular
      UNION ALL SELECT 'orders', 'Where can I see my order number?', 'where-can-i-see-my-order-number', 'After placing an order, the order number is shown on the success page and in My Orders. Guest users can verify with email or mobile OTP and view order numbers from Track Order.', FALSE
      UNION ALL SELECT 'orders', 'Can I place an order without creating an account?', 'can-i-place-an-order-without-creating-an-account', 'Yes. Use guest checkout, enter your delivery details, verify OTP when required and complete payment. You can later track guest orders using the same email or mobile number.', FALSE
      UNION ALL SELECT 'orders', 'Why is my order split into multiple items?', 'why-is-my-order-split-into-multiple-items', 'Orders may contain products from different hubs or stock batches. Each product can have its own delivery, cancellation, return and refund status while sharing the same order number.', FALSE
      UNION ALL SELECT 'delivery', 'When will my order be delivered?', 'when-will-my-order-be-delivered', 'Delivery dates depend on your pincode, nearest hub and product stock. The estimated delivery window is shown during checkout and in order details.', TRUE
      UNION ALL SELECT 'delivery', 'How do I check if delivery is available for my pincode?', 'how-do-i-check-if-delivery-is-available-for-my-pincode', 'Enter your pincode on the product page or checkout page. DressShop checks hub coverage, delivery days and COD availability before allowing checkout.', FALSE
      UNION ALL SELECT 'delivery', 'What does Reached Nearby Hub mean?', 'what-does-reached-nearby-hub-mean', 'Reached Nearby Hub means your package has arrived at the delivery hub closest to your address. The next usual step is Out For Delivery.', FALSE
      UNION ALL SELECT 'delivery', 'Can I change delivery date after shipping?', 'can-i-change-delivery-date-after-shipping', 'Delivery date changes are not always possible after shipping. If the courier partner supports rescheduling, the delivery team may contact you before delivery.', FALSE
      UNION ALL SELECT 'returns', 'How do I return a product?', 'how-do-i-return-a-product', 'Go to Orders, open the delivered order and raise a post-delivery request for eligible items. Our team reviews the request and updates the status.', TRUE
      UNION ALL SELECT 'returns', 'Why is the Return button not showing?', 'why-is-the-return-button-not-showing', 'The Return button is shown only after delivery and only within the return/replacement period. It is hidden when the product is already returned, refunded, cancelled or outside the eligible window.', FALSE
      UNION ALL SELECT 'returns', 'What should I keep ready for return pickup?', 'what-should-i-keep-ready-for-return-pickup', 'Keep the product unused, with tags, invoice, brand packaging and any accessories or free gifts. The pickup partner may reject return pickup if required items are missing.', FALSE
      UNION ALL SELECT 'returns', 'Can I return only one product from an order?', 'can-i-return-only-one-product-from-an-order', 'Yes. If the item is eligible, you can raise return for a single product from the order details page. Other products in the same order will not be affected.', FALSE
      UNION ALL SELECT 'refunds', 'When will I get my refund?', 'when-will-i-get-my-refund', 'Refunds are processed after cancellation or return approval. Wallet payments are refunded back to wallet when applicable.', TRUE
      UNION ALL SELECT 'refunds', 'How can I check refund status?', 'how-can-i-check-refund-status', 'Open the order tracking page. For returned or cancelled prepaid orders, the timeline shows Refund Processing and Refund Completed when the admin updates the refund action.', FALSE
      UNION ALL SELECT 'refunds', 'Do COD orders get refund steps?', 'do-cod-orders-get-refund-steps', 'COD orders do not show refund processing steps if no payment was collected online. Cancelled COD orders show cancellation completion only.', FALSE
      UNION ALL SELECT 'refunds', 'Why is my refund rejected?', 'why-is-my-refund-rejected', 'A refund can be rejected if the cancellation or return is not eligible, product checks fail, or payment was not captured. Check Admin remarks or raise a support ticket for clarification.', FALSE
      UNION ALL SELECT 'payments', 'What should I do if payment fails?', 'what-should-i-do-if-payment-fails', 'If money was deducted for a failed payment, wait for bank reversal. You can also raise a support ticket with payment reference details.', TRUE
      UNION ALL SELECT 'payments', 'Which payment methods are supported?', 'which-payment-methods-are-supported', 'DressShop supports available methods such as UPI, card, wallet and Cash on Delivery based on pincode and checkout eligibility.', FALSE
      UNION ALL SELECT 'payments', 'Why is Cash on Delivery not available?', 'why-is-cash-on-delivery-not-available', 'COD availability depends on the delivery hub and pincode. If COD is unavailable for your location, choose an online payment method.', FALSE
      UNION ALL SELECT 'payments', 'Is my saved payment information secure?', 'is-my-saved-payment-information-secure', 'Saved payment details are shown in masked form where applicable. Do not share OTP, CVV or wallet credentials with anyone.', FALSE
      UNION ALL SELECT 'wallet', 'How do I add money to wallet?', 'how-do-i-add-money-to-wallet', 'Open Wallet, choose Add money, select a payment method and complete the sandbox payment flow. The wallet balance updates after success.', TRUE
      UNION ALL SELECT 'wallet', 'Can I use wallet balance for orders?', 'can-i-use-wallet-balance-for-orders', 'Yes. If your wallet has enough balance, choose Wallet at checkout. The order amount is deducted after successful payment.', FALSE
      UNION ALL SELECT 'wallet', 'Where can I see wallet transactions?', 'where-can-i-see-wallet-transactions', 'Open Wallet History to see credits, debits, refunds and transfer records linked to your DressShop wallet.', FALSE
      UNION ALL SELECT 'wallet', 'What happens to wallet payment after cancellation?', 'what-happens-to-wallet-payment-after-cancellation', 'Eligible wallet-paid cancelled orders are refunded back to the wallet once the refund is approved or processed.', FALSE
      UNION ALL SELECT 'coupons', 'Why is my coupon not applying?', 'why-is-my-coupon-not-applying', 'Coupons may require a minimum order value, active expiry date and eligible cart total. Check coupon details before applying.', FALSE
      UNION ALL SELECT 'coupons', 'Can I use more than one coupon on an order?', 'can-i-use-more-than-one-coupon-on-an-order', 'Only one coupon can be applied to an order at a time unless a special promotion says otherwise.', FALSE
      UNION ALL SELECT 'coupons', 'Why did my coupon discount change?', 'why-did-my-coupon-discount-change', 'Coupon discount can change if cart items, quantity, sale price, minimum order value or eligibility changes before payment.', FALSE
      UNION ALL SELECT 'coupons', 'Will my coupon come back if I cancel?', 'will-my-coupon-come-back-if-i-cancel', 'Coupon restoration depends on the coupon rule and cancellation status. Some coupons may not be reusable after order placement.', FALSE
      UNION ALL SELECT 'account', 'How do I update my profile?', 'how-do-i-update-my-profile', 'Open Profile from the account menu, update your name, email or mobile number and save the changes.', FALSE
      UNION ALL SELECT 'account', 'How do I manage delivery addresses?', 'how-do-i-manage-delivery-addresses', 'Go to Address Book from your profile. You can add, update and choose delivery addresses before checkout.', FALSE
      UNION ALL SELECT 'account', 'How do I view my saved payment methods?', 'how-do-i-view-my-saved-payment-methods', 'Open Payment Methods or Saved Payments from your account menu to view saved UPI IDs and cards.', FALSE
      UNION ALL SELECT 'account', 'I forgot my password. What should I do?', 'i-forgot-my-password-what-should-i-do', 'Use the login page password recovery option if available, or contact support with your registered email or mobile number for account help.', FALSE
      UNION ALL SELECT 'product-issues', 'I received a damaged or wrong product', 'i-received-a-damaged-or-wrong-product', 'Raise a ticket with order number, issue type, message and a clear image. Our support team will review it.', FALSE
      UNION ALL SELECT 'product-issues', 'What should I do if an item is missing from my package?', 'what-should-i-do-if-an-item-is-missing-from-my-package', 'Please check all packaging once. If the item is still missing, raise a support ticket with your order number, package photo and the missing product name. Our team will verify the packing record and update you.', FALSE
      UNION ALL SELECT 'product-issues', 'The product size or color is different from what I ordered', 'the-product-size-or-color-is-different-from-what-i-ordered', 'Open your order details and raise a product issue ticket with a clear photo of the product, tag, invoice and package label. If eligible, support will guide you with replacement or return steps.', FALSE
      UNION ALL SELECT 'product-issues', 'The product quality is not as expected', 'the-product-quality-is-not-as-expected', 'If the product has stitching, fabric, stain or quality concerns, submit a ticket with close-up photos and a short description. The support team will review it based on the return/replacement policy.', FALSE
      UNION ALL SELECT 'product-issues', 'I received a used or opened product', 'i-received-a-used-or-opened-product', 'Please do not use the item. Take photos of the opened package, tags and product condition, then raise a support ticket from Help Center. Our team will investigate and help with the next action.', FALSE
      UNION ALL SELECT 'product-issues', 'Product image and received item look different', 'product-image-and-received-item-look-different', 'Slight color variation can happen due to lighting and screen settings. For major design, color or pattern differences, raise a ticket with product photos so support can verify it.', FALSE
      UNION ALL SELECT 'cancellation', 'Can I cancel my order?', 'can-i-cancel-my-order', 'Orders can be cancelled before they are delivered. Refund eligibility depends on payment method and current order status.', FALSE
      UNION ALL SELECT 'cancellation', 'How do I cancel one item from my order?', 'how-do-i-cancel-one-item-from-my-order', 'Open the order details page and use Cancel item for the eligible product. Cancellation is allowed only before blocked delivery stages such as shipped or delivered.', FALSE
      UNION ALL SELECT 'cancellation', 'Why is the Cancel button hidden?', 'why-is-the-cancel-button-hidden', 'Cancel is hidden when the order has shipped, delivered, already cancelled, refunded or crossed the allowed cancellation stage.', FALSE
      UNION ALL SELECT 'cancellation', 'How will I know cancellation refund is approved?', 'how-will-i-know-cancellation-refund-is-approved', 'In order tracking, prepaid cancelled orders show Refund Processing and Refund Completed after admin approval. COD cancellations do not require refund processing.', FALSE
    ) seed
    JOIN help_categories c ON c.slug = seed.category_slug
    ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), is_popular = VALUES(is_popular), is_active = TRUE
  `);

  const [[{ count }]] = await connection.query('SELECT COUNT(*) AS count FROM products');
  if (!count) {
    await connection.query(`
      INSERT INTO products (name, description, category, brand, size, color, price, costPrice, originalPrice, stock, image, isOnSale, saleType, saleValue, saleStartDate, saleEndDate, dedPermitNumber) VALUES
      ('Part Wear - Kids Dress', 'Bright party wear dress for summer events.', 'Kids dress', 'Tiny Tara', '5-6Y', 'Rose Pink', 1899.00, 900.00, 1899.00, 18, 'https://images.unsplash.com/photo-1596783074918-c84cb06531ca?auto=format&fit=crop&w=900&q=80', TRUE, 'percentage', 50, '2026-06-01', '2026-08-31', '123456'),
      ('Silk Cotton Frock', 'Soft silk cotton frock with breathable lining.', 'Kids dress', 'Little Loom', '7-8Y', 'Mint', 1499.00, 780.00, 1499.00, 15, 'https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?auto=format&fit=crop&w=900&q=80', TRUE, 'percentage', 30, '2026-06-01', '2026-08-31', '123456'),
      ('Silk Anarkali Set', 'Flowing silk anarkali set for festive evenings.', 'Traditional dress', 'RangRoot', 'M', 'Indigo', 2499.00, 1300.00, 2499.00, 9, 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?auto=format&fit=crop&w=900&q=80', TRUE, 'flat', 500, '2026-06-01', '2026-08-31', '123456'),
      ('Kanchipuram Silk Saree', 'Rich traditional silk saree with temple border.', 'Traditional dress', 'Anika Weaves', 'Free Size', 'Maroon', 3499.00, 2100.00, 3499.00, 12, 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=80', FALSE, NULL, NULL, NULL, NULL, NULL),
      ('Embroidered Gown', 'Evening gown with delicate embroidery.', 'Traditional dress', 'Vastra Lane', 'L', 'Bottle Green', 2599.00, 1500.00, 2599.00, 0, 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=900&q=80', FALSE, NULL, NULL, NULL, NULL, NULL)
    `);
  }

  await connection.query(`
    INSERT INTO hubs (id, name, hub_code, code, address, area, city, state, pincode, latitude, longitude, status, is_active) VALUES
    (UUID(), 'Delhi Central Hub', 'DEL01', 'DEL01', 'Connaught Place distribution center', 'Connaught Place', 'New Delhi', 'Delhi', '110001', 28.6328000, 77.2197000, 'ACTIVE', TRUE),
    (UUID(), 'Mumbai Warehouse', 'MUM01', 'MUM01', 'Fort fulfilment warehouse', 'Fort', 'Mumbai', 'Maharashtra', '400001', 18.9388000, 72.8354000, 'ACTIVE', TRUE),
    (UUID(), 'Bangalore Hub', 'BLR01', 'BLR01', 'MG Road sorting hub', 'MG Road', 'Bengaluru', 'Karnataka', '560001', 12.9716000, 77.5946000, 'ACTIVE', TRUE),
    (UUID(), 'Tiruchirappalli Hub', 'TPJ001', 'TPJ001', 'Tiruchirappalli fulfilment hub', 'Cantonment', 'Tiruchirappalli', 'Tamil Nadu', '620002', 10.8265000, 78.6928000, 'ACTIVE', TRUE),
    (UUID(), 'Coimbatore Hub', 'CBE001', 'CBE001', 'Coimbatore regional hub', 'Gandhipuram', 'Coimbatore', 'Tamil Nadu', '641006', 11.0742000, 76.9996000, 'ACTIVE', TRUE)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      hub_code = VALUES(hub_code),
      address = VALUES(address),
      area = VALUES(area),
      city = VALUES(city),
      state = VALUES(state),
      pincode = VALUES(pincode),
      latitude = VALUES(latitude),
      longitude = VALUES(longitude),
      status = VALUES(status),
      is_active = VALUES(is_active)
  `);

  const [seedHubs] = await connection.query('SELECT id, code FROM hubs WHERE code IN ("DEL01", "MUM01", "BLR01", "TPJ001", "CBE001")');
  const hubByCode = Object.fromEntries(seedHubs.map((hub) => [hub.code, hub.id]));
  const seedPincodes = [
    ['TPJ001', '620002', 2, 3, true],
    ['CBE001', '641006', 2, 3, true],
    ['DEL01', '110001', 2, 3, true],
    ['DEL01', '110002', 2, 3, true],
    ['DEL01', '201301', 3, 4, true],
    ['DEL01', '122001', 3, 4, true],
    ['MUM01', '400001', 2, 3, true],
    ['BLR01', '560001', 2, 3, true]
  ];

  for (const [hubCode, pincode, minDays, maxDays, codAvailable] of seedPincodes) {
    if (!hubByCode[hubCode]) continue;
    await connection.execute(
      `INSERT INTO hub_pincodes (id, hub_id, pincode, delivery_days, delivery_days_min, delivery_days_max, is_primary, is_serviceable, cod_available)
       VALUES (UUID(), ?, ?, ?, ?, ?, TRUE, TRUE, ?)
       ON DUPLICATE KEY UPDATE delivery_days = VALUES(delivery_days), delivery_days_min = VALUES(delivery_days_min), delivery_days_max = VALUES(delivery_days_max), is_primary = TRUE, is_serviceable = TRUE, cod_available = VALUES(cod_available)`,
      [hubByCode[hubCode], pincode, maxDays, minDays, maxDays, codAvailable]
    );
  }

  const [products] = await connection.query('SELECT id, stock FROM products');
  if (hubByCode.TPJ001) {
    await connection.execute('UPDATE products SET default_hub_id = COALESCE(default_hub_id, ?)', [hubByCode.TPJ001]);
  }

  const inventorySeedOrder = ['TPJ001', 'CBE001', 'DEL01', 'MUM01', 'BLR01'];
  for (const hubCode of inventorySeedOrder) {
    const hubId = hubByCode[hubCode];
    if (!hubId) continue;

    for (const product of products) {
      const baseStock = Number(product.stock || 0);
      const stockQty = hubCode === 'TPJ001' ? baseStock : Math.max(0, Math.floor(baseStock / 2));
      await connection.execute(
        `INSERT INTO hub_stocks (id, hub_id, product_id, variant_id, quantity, reserved_qty)
         VALUES (UUID(), ?, ?, '', ?, 0)
         ON DUPLICATE KEY UPDATE quantity = GREATEST(quantity, VALUES(quantity))`,
        [hubId, product.id, stockQty]
      );
      await connection.execute(
        `INSERT INTO hub_inventory (id, hub_id, product_id, variant_id, stock_qty)
         VALUES (UUID(), ?, ?, '', ?)
         ON DUPLICATE KEY UPDATE stock_qty = GREATEST(stock_qty, VALUES(stock_qty))`,
        [hubId, product.id, stockQty]
      );
    }
  }

  await connection.end();
  console.log(`Database '${database}' is ready.`);
}

setup().catch((error) => {
  console.error(error);
  process.exit(1);
});
