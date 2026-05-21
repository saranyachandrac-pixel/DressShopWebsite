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

async function seedMenCatalog(connection) {
  const categories = flattenCategories();
  const idBySlug = {};

  for (const category of categories.filter((item) => !item.parentSlug)) {
    await connection.execute(
      `INSERT INTO categories (parent_id, gender, name, slug, sort_order, is_active)
       VALUES (NULL, 'men', ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order), is_active = TRUE`,
      [category.name, category.slug, category.sortOrder]
    );
    const [[row]] = await connection.execute('SELECT id FROM categories WHERE gender = ? AND slug = ?', ['men', category.slug]);
    idBySlug[category.slug] = row.id;
  }

  for (const category of categories.filter((item) => item.parentSlug)) {
    await connection.execute(
      `INSERT INTO categories (parent_id, gender, name, slug, sort_order, is_active)
       VALUES (?, 'men', ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), sort_order = VALUES(sort_order), is_active = TRUE`,
      [idBySlug[category.parentSlug] || null, category.name, category.slug, category.sortOrder]
    );
    const [[row]] = await connection.execute('SELECT id FROM categories WHERE gender = ? AND slug = ?', ['men', category.slug]);
    idBySlug[category.slug] = row.id;
  }

  for (const [index, category] of categories.filter((item) => item.isLeaf).entries()) {
    const categoryId = idBySlug[category.slug];
    if (!categoryId) continue;

    for (const product of productSeeds(category, index)) {
      await connection.execute(
        `INSERT INTO products
          (category_id, gender, name, slug, brand, price, mrp, originalPrice, discount_percent, discount, image_url, image, sizes, size, color, stock, rating, description, is_active, category)
         VALUES (?, 'men', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
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
          category = VALUES(category)`,
        [
          categoryId,
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
      category_id INT NULL,
      gender VARCHAR(20) NULL,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NULL,
      description TEXT,
      category VARCHAR(100),
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
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      parent_id INT NULL,
      gender VARCHAR(20) NOT NULL,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
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
      admin_remarks VARCHAR(255),
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
  `);

  await ensureColumn(connection, 'users', 'mobile', 'mobile VARCHAR(30)');
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
  await ensureColumn(connection, 'products', 'discount', 'discount DECIMAL(10,2) DEFAULT 0');
  await ensureColumn(connection, 'products', 'category_id', 'category_id INT NULL');
  await ensureColumn(connection, 'products', 'gender', 'gender VARCHAR(20) NULL');
  await ensureColumn(connection, 'products', 'slug', 'slug VARCHAR(255) NULL');
  await ensureColumn(connection, 'products', 'mrp', 'mrp DECIMAL(10,2) NULL');
  await ensureColumn(connection, 'products', 'discount_percent', 'discount_percent DECIMAL(10,2) DEFAULT 0');
  await ensureColumn(connection, 'products', 'image_url', 'image_url VARCHAR(500)');
  await ensureColumn(connection, 'products', 'sizes', 'sizes VARCHAR(255)');
  await ensureColumn(connection, 'products', 'rating', 'rating DECIMAL(3,2) DEFAULT 4.2');
  await ensureColumn(connection, 'products', 'is_active', 'is_active BOOLEAN DEFAULT TRUE');
  await ensureColumn(connection, 'addresses', 'is_default', 'is_default BOOLEAN DEFAULT FALSE');
  await ensureColumn(connection, 'orders', 'delivered_on', 'delivered_on DATETIME');
  await ensureColumn(connection, 'orders', 'stock_deducted', 'stock_deducted BOOLEAN DEFAULT FALSE');
  await ensureColumn(connection, 'orders', 'payment_details', 'payment_details TEXT');
  await ensureColumn(connection, 'orders', 'coupon_id', 'coupon_id INT NULL');
  await ensureColumn(connection, 'orders', 'coupon_code', 'coupon_code VARCHAR(50) NULL');
  await ensureColumn(connection, 'orders', 'discount_amount', 'discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'orders', 'coupon_discount_amount', 'coupon_discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0');
  await ensureColumn(connection, 'order_items', 'image', 'image VARCHAR(500)');
  await ensureColumn(connection, 'order_items', 'selected_size', 'selected_size VARCHAR(50)');
  await ensureColumn(connection, 'order_items', 'stock_quantity', 'stock_quantity INT NOT NULL DEFAULT 1');
  await ensureColumn(connection, 'order_items', 'item_status', "item_status VARCHAR(50) DEFAULT 'ACTIVE'");
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
  await connection.query("UPDATE support_tickets SET ticket_no = CONCAT('TKT', LPAD(id, 6, '0')) WHERE ticket_no IS NULL OR ticket_no = ''");
  await connection.query("UPDATE support_tickets SET ticket_type = issue_type WHERE ticket_type IS NULL OR ticket_type = ''");
  await connection.query("UPDATE support_ticket_replies SET sender_type = IF(is_admin, 'admin', 'user') WHERE sender_type IS NULL OR sender_type = ''");
  await connection.query('UPDATE support_ticket_replies SET sender_id = COALESCE(sender_id, user_id) WHERE sender_id IS NULL');
  await ensureIndex(connection, 'categories', 'unique_gender_slug', 'UNIQUE KEY unique_gender_slug (gender, slug)');
  await connection.query("UPDATE cart SET size = COALESCE(size, ''), color = COALESCE(color, '')");
  await mergeDuplicateCartVariants(connection);
  await ensureIndex(connection, 'cart', 'idx_cart_user_id', 'INDEX idx_cart_user_id (user_id)');
  await ensureIndex(connection, 'cart', 'idx_cart_product_id', 'INDEX idx_cart_product_id (product_id)');
  await ensureIndex(connection, 'cart', 'unique_cart_variant', 'UNIQUE KEY unique_cart_variant (user_id, product_id, size, color)');
  await dropIndexIfExists(connection, 'cart', 'unique_cart_item');
  await ensureIndex(connection, 'products', 'unique_product_slug', 'UNIQUE KEY unique_product_slug (slug)');
  await ensureIndex(connection, 'products', 'idx_products_gender_category', 'INDEX idx_products_gender_category (gender, category_id)');
  await connection.query('UPDATE products SET originalPrice = price WHERE originalPrice = 0 OR originalPrice IS NULL');
  await connection.query('UPDATE products SET mrp = COALESCE(mrp, originalPrice, price), image_url = COALESCE(image_url, image), sizes = COALESCE(sizes, size), is_active = COALESCE(is_active, TRUE)');
  await connection.query("UPDATE hubs SET city = SUBSTRING_INDEX(address, ', ', -1) WHERE city = '' OR city IS NULL");
  await connection.query("UPDATE hubs SET hub_code = code WHERE hub_code IS NULL OR hub_code = ''");
  await connection.query("UPDATE hubs SET status = IF(is_active, 'ACTIVE', 'INACTIVE') WHERE status IS NULL OR status = ''");
  await connection.query('UPDATE hub_pincodes SET delivery_days_min = COALESCE(delivery_days_min, delivery_days), delivery_days_max = COALESCE(delivery_days_max, delivery_days) WHERE delivery_days_min IS NULL OR delivery_days_max IS NULL');
  await connection.query('UPDATE order_items SET stock_quantity = quantity WHERE stock_quantity IS NULL OR stock_quantity < 1');
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

  await seedMenCatalog(connection);
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
      UNION ALL SELECT 'delivery', 'When will my order be delivered?', 'when-will-my-order-be-delivered', 'Delivery dates depend on your pincode, nearest hub and product stock. The estimated delivery window is shown during checkout and in order details.', TRUE
      UNION ALL SELECT 'returns', 'How do I return a product?', 'how-do-i-return-a-product', 'Go to Orders, open the delivered order and raise a post-delivery request for eligible items. Our team reviews the request and updates the status.', TRUE
      UNION ALL SELECT 'refunds', 'When will I get my refund?', 'when-will-i-get-my-refund', 'Refunds are processed after cancellation or return approval. Wallet payments are refunded back to wallet when applicable.', TRUE
      UNION ALL SELECT 'payments', 'What should I do if payment fails?', 'what-should-i-do-if-payment-fails', 'If money was deducted for a failed payment, wait for bank reversal. You can also raise a support ticket with payment reference details.', TRUE
      UNION ALL SELECT 'wallet', 'How do I add money to wallet?', 'how-do-i-add-money-to-wallet', 'Open Wallet, choose Add money, select a payment method and complete the sandbox payment flow. The wallet balance updates after success.', TRUE
      UNION ALL SELECT 'coupons', 'Why is my coupon not applying?', 'why-is-my-coupon-not-applying', 'Coupons may require a minimum order value, active expiry date and eligible cart total. Check coupon details before applying.', FALSE
      UNION ALL SELECT 'account', 'How do I update my profile?', 'how-do-i-update-my-profile', 'Open Profile from the account menu, update your name, email or mobile number and save the changes.', FALSE
      UNION ALL SELECT 'product-issues', 'I received a damaged or wrong product', 'i-received-a-damaged-or-wrong-product', 'Raise a ticket with order number, issue type, message and a clear image. Our support team will review it.', FALSE
      UNION ALL SELECT 'cancellation', 'Can I cancel my order?', 'can-i-cancel-my-order', 'Orders can be cancelled before they are delivered. Refund eligibility depends on payment method and current order status.', FALSE
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
