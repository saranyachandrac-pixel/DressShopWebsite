ALTER TABLE `products`
  ADD COLUMN IF NOT EXISTS `default_hub_id` CHAR(36) NULL;

CREATE TABLE IF NOT EXISTS `hubs` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `address` TEXT NOT NULL,
  `pincode` VARCHAR(6) NOT NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `hubs_code_key` (`code`)
);

CREATE TABLE IF NOT EXISTS `hub_pincodes` (
  `id` CHAR(36) NOT NULL,
  `hub_id` CHAR(36) NOT NULL,
  `pincode` VARCHAR(6) NOT NULL,
  `delivery_days` INT NOT NULL,
  `is_serviceable` BOOLEAN DEFAULT TRUE,
  `cod_available` BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (`id`),
  INDEX `idx_hub_pincodes_pincode` (`pincode`),
  UNIQUE KEY `unique_hub_pincode` (`hub_id`, `pincode`),
  CONSTRAINT `hub_pincodes_hub_id_fkey` FOREIGN KEY (`hub_id`) REFERENCES `hubs` (`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `hub_stocks` (
  `id` CHAR(36) NOT NULL,
  `hub_id` CHAR(36) NOT NULL,
  `product_id` INT NOT NULL,
  `variant_id` VARCHAR(100) NOT NULL DEFAULT '',
  `quantity` INT NOT NULL DEFAULT 0,
  `reserved_qty` INT NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_hub_product_variant` (`hub_id`, `product_id`, `variant_id`),
  CONSTRAINT `hub_stocks_hub_id_fkey` FOREIGN KEY (`hub_id`) REFERENCES `hubs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `hub_stocks_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
);
