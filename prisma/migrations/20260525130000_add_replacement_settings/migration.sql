ALTER TABLE products
  ADD COLUMN is_replacement_available TINYINT(1) DEFAULT 1,
  ADD COLUMN replacement_days INT DEFAULT NULL,
  ADD COLUMN replacement_policy TEXT NULL;

ALTER TABLE categories
  ADD COLUMN replacement_days INT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS app_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('default_replacement_days', '7')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
