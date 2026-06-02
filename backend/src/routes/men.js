const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { genderMenus, slugify } = require('../data/menCatalog');
const { mapSaleProduct } = require('../utils/sale');

const router = express.Router();

function genderFromRequest(req) {
  const segment = String(req.baseUrl || '').split('/').filter(Boolean).pop();
  return ['men', 'women', 'kids'].includes(segment) ? segment : 'men';
}

function normalizeProduct(product) {
  const pricedProduct = mapSaleProduct(product);
  return {
    ...pricedProduct,
    id: pricedProduct.id,
    categoryId: pricedProduct.category_id,
    category: product.category_name || pricedProduct.category,
    categorySlug: product.category_slug,
    slug: pricedProduct.slug,
    brand: pricedProduct.brand,
    name: pricedProduct.name,
    description: pricedProduct.description,
    price: Number(pricedProduct.price || 0),
    selling_price: Number(pricedProduct.selling_price || pricedProduct.price || 0),
    original_price: Number(pricedProduct.original_price || pricedProduct.mrp || 0),
    mrp: Number(pricedProduct.mrp || pricedProduct.original_price || 0),
    discount: Number(pricedProduct.discount_percentage || 0),
    discount_percentage: Number(pricedProduct.discount_percentage || 0),
    rating: Number(pricedProduct.rating || 4.2),
    sizes: String(pricedProduct.sizes || pricedProduct.size || 'M,L,XL').split(',').map((size) => size.trim()).filter(Boolean),
    color: pricedProduct.color,
    stock: Number(pricedProduct.stock || 0),
    imageUrl: pricedProduct.imageUrl
  };
}

router.get('/menu', asyncHandler(async (req, res) => {
  const gender = genderFromRequest(req);
  const menu = genderMenus[gender] || genderMenus.men;
  const [rows] = await pool.execute(
    `SELECT id, parent_id, name, slug, sort_order
     FROM categories
     WHERE gender = ? AND is_active = TRUE
     ORDER BY sort_order, name`
    ,
    [gender]
  );
  const bySlug = new Map(rows.map((row) => [row.slug, row]));

  const columns = menu.map((column) => column.map((section) => ({
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
  const gender = genderFromRequest(req);
  const [products] = await pool.execute(
    `SELECT p.*,
            c.name AS category_name,
            c.slug AS category_slug
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE LOWER(p.gender) = ?
       AND p.is_active = TRUE
       AND LOWER(c.gender) = ?
       AND c.slug = ?
     ORDER BY p.created_at DESC, p.id DESC`,
    [gender, gender, req.params.categorySlug]
  );

  res.json({ products: products.map(normalizeProduct) });
}));

module.exports = router;
