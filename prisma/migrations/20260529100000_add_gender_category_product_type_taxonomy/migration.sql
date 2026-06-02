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

ALTER TABLE products ADD COLUMN IF NOT EXISTS gender_id INT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type_id INT NULL;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS gender_id INT NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

CREATE INDEX idx_genders_status ON genders (status);
CREATE INDEX idx_product_types_status ON product_types (status);
CREATE INDEX idx_categories_gender_id ON categories (gender_id);
CREATE INDEX idx_products_taxonomy ON products (gender_id, category_id, product_type_id);
