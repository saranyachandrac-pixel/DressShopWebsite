ALTER TABLE orders
  MODIFY user_id INT NULL,
  MODIFY address_id INT NULL,
  ADD COLUMN guest_name VARCHAR(100) NULL,
  ADD COLUMN guest_email VARCHAR(255) NULL,
  ADD COLUMN guest_mobile VARCHAR(20) NULL,
  ADD COLUMN payment_status VARCHAR(50) NULL,
  ADD COLUMN expected_delivery_date DATE NULL,
  ADD COLUMN delivery_hub_id CHAR(36) NULL,
  ADD COLUMN courier_partner VARCHAR(120) NULL,
  ADD COLUMN tracking_token VARCHAR(255) NULL,
  ADD COLUMN is_guest_order TINYINT(1) NOT NULL DEFAULT 0;

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
);

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
);

ALTER TABLE guest_orders
  ADD COLUMN order_number VARCHAR(100) NULL;

UPDATE orders
SET payment_status = COALESCE(payment_status, paid_status),
    expected_delivery_date = COALESCE(expected_delivery_date, estimated_delivery_date),
    delivery_hub_id = COALESCE(delivery_hub_id, selected_hub_id)
WHERE payment_status IS NULL
   OR expected_delivery_date IS NULL
   OR delivery_hub_id IS NULL;

ALTER TABLE order_cancellations
  MODIFY user_id INT NULL,
  ADD COLUMN guest_contact_type VARCHAR(20) NULL,
  ADD COLUMN guest_contact_value VARCHAR(150) NULL;

ALTER TABLE post_delivery_requests
  MODIFY user_id INT NULL,
  ADD COLUMN guest_contact_type VARCHAR(20) NULL,
  ADD COLUMN guest_contact_value VARCHAR(150) NULL;

ALTER TABLE product_reviews
  MODIFY user_id INT NULL,
  ADD COLUMN guest_contact_type VARCHAR(20) NULL,
  ADD COLUMN guest_contact_value VARCHAR(150) NULL;
