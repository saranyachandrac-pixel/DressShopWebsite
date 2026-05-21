CREATE TABLE IF NOT EXISTS monthly_purchase_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  month INT NOT NULL,
  year INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_month_template (user_id, month, year),
  CONSTRAINT fk_monthly_templates_user
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
  INDEX idx_monthly_template_items_product (product_id),
  CONSTRAINT fk_monthly_template_items_template
    FOREIGN KEY (template_id) REFERENCES monthly_purchase_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_monthly_template_items_product
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
  CONSTRAINT fk_monthly_checkout_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_monthly_checkout_sessions_template
    FOREIGN KEY (template_id) REFERENCES monthly_purchase_templates(id) ON DELETE CASCADE
);

ALTER TABLE orders
  ADD COLUMN order_source VARCHAR(50) NOT NULL DEFAULT 'cart';
