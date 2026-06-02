ALTER TABLE order_cancellations
  MODIFY admin_remarks TEXT NULL,
  ADD COLUMN action_by VARCHAR(100) NULL,
  ADD COLUMN action_date DATETIME NULL;

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
);
