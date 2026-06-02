UPDATE products
SET gender = UPPER(gender)
WHERE gender IS NOT NULL;

ALTER TABLE products
  MODIFY COLUMN gender ENUM('MEN','WOMEN','KIDS','UNISEX') NULL,
  ADD COLUMN IF NOT EXISTS product_category VARCHAR(50) NULL;

UPDATE products
SET product_category = COALESCE(product_category, men_category, women_category, kids_category)
WHERE product_category IS NULL;
