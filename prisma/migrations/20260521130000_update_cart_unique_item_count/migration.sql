ALTER TABLE cart
  ADD COLUMN color VARCHAR(50) NOT NULL DEFAULT '';

UPDATE cart
SET size = COALESCE(size, ''),
    color = COALESCE(color, '');

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
HAVING COUNT(*) > 1;

UPDATE cart c
JOIN cart_variant_duplicates d ON c.id = d.keep_id
SET c.quantity = d.total_quantity;

DELETE c
FROM cart c
JOIN cart_variant_duplicates d
  ON c.user_id = d.user_id
 AND c.product_id = d.product_id
 AND COALESCE(c.size, '') = d.size
 AND COALESCE(c.color, '') = d.color
 AND c.id <> d.keep_id;

DROP TEMPORARY TABLE cart_variant_duplicates;

ALTER TABLE cart
  DROP INDEX unique_cart_variant;

UPDATE cart c
JOIN products p ON p.id = c.product_id
SET c.size = COALESCE(NULLIF(c.size, ''), p.size, ''),
    c.color = COALESCE(NULLIF(c.color, ''), p.color, '');

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
HAVING COUNT(*) > 1;

UPDATE cart c
JOIN cart_variant_duplicates d ON c.id = d.keep_id
SET c.quantity = d.total_quantity;

DELETE c
FROM cart c
JOIN cart_variant_duplicates d
  ON c.user_id = d.user_id
 AND c.product_id = d.product_id
 AND COALESCE(c.size, '') = d.size
 AND COALESCE(c.color, '') = d.color
 AND c.id <> d.keep_id;

DROP TEMPORARY TABLE cart_variant_duplicates;

ALTER TABLE cart
  ADD INDEX idx_cart_user_id (user_id);

ALTER TABLE cart
  ADD INDEX idx_cart_product_id (product_id);

ALTER TABLE cart
  ADD UNIQUE KEY unique_cart_variant (user_id, product_id, size, color);

ALTER TABLE cart
  DROP INDEX unique_cart_item;
