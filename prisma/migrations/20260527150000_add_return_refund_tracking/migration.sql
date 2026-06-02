ALTER TABLE post_delivery_requests
  ADD COLUMN refund_amount DECIMAL(10,2) NULL,
  ADD COLUMN refund_payment_method VARCHAR(80) NULL,
  ADD COLUMN refund_transaction_id VARCHAR(120) NULL,
  ADD COLUMN refund_processing_at DATETIME NULL,
  ADD COLUMN refund_completed_at DATETIME NULL,
  ADD COLUMN return_picked_up_at DATETIME NULL,
  ADD COLUMN return_completed_at DATETIME NULL;
