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

ALTER TABLE orders
  ADD COLUMN super_coin_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN super_coins_redeemed INT NOT NULL DEFAULT 0,
  ADD COLUMN super_coins_earned INT NOT NULL DEFAULT 0;

INSERT INTO super_coin_rules
  (rule_name, coins_per_amount, amount_unit, first_order_bonus, review_bonus, referral_bonus, max_redeem_percentage, coin_value_in_rupees, expiry_days, is_active)
VALUES
  ('Default Super Coin Rule', 2, 100.00, 50, 10, 100, 10.00, 1.00, 365, TRUE);
