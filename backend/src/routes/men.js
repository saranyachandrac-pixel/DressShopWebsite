const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { menMenu, slugify } = require('../data/menCatalog');

const router = express.Router();

function normalizeProduct(product) {
  return {
    id: product.id,
    categoryId: product.category_id,
    category: product.category_name || product.category,
    categorySlug: product.category_slug,
    slug: product.slug,
    brand: product.brand,
    name: product.name,
    description: product.description,
    price: Number(product.price || 0),
    mrp: Number(product.mrp || product.originalPrice || product.price || 0),
    discount: Number(product.discount_percent ?? product.discount ?? 0),
    rating: Number(product.rating || 4.2),
    sizes: String(product.sizes || product.size || 'M,L,XL').split(',').map((size) => size.trim()).filter(Boolean),
    color: product.color,
    stock: Number(product.stock || 0),
    imageUrl: product.image_url || product.image
  };
}

router.get('/menu', asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, parent_id, name, slug, sort_order
     FROM categories
     WHERE gender = 'men' AND is_active = TRUE
     ORDER BY sort_order, name`
  );
  const bySlug = new Map(rows.map((row) => [row.slug, row]));

  const columns = menMenu.map((column) => column.map((section) => ({
    heading: section.heading,
    slug: bySlug.get(slugify(section.heading))?.slug,
    groups: section.groups?.map((group) => ({
      heading: group.heading,
      slug: bySlug.get(slugify(group.heading))?.slug,
      items: group.items.map((name) => bySlug.get(slugify(name))).filter(Boolean)
    })),
    items: section.items?.map((name) => bySlug.get(slugify(name))).filter(Boolean)
  })));

  res.json({ columns });
}));

router.get('/products/:categorySlug', asyncHandler(async (req, res) => {
  const [products] = await pool.execute(
    `SELECT p.*,
            c.name AS category_name,
            c.slug AS category_slug
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.gender = 'men'
       AND p.is_active = TRUE
       AND c.gender = 'men'
       AND c.slug = ?
     ORDER BY p.created_at DESC, p.id DESC`,
    [req.params.categorySlug]
  );

  res.json({ products: products.map(normalizeProduct) });
}));

module.exports = router;
