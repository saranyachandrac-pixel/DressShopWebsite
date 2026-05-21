const { mapSaleProduct } = require('../utils/sale');

function normalizeVariant(value) {
  return String(value || '').trim();
}

function normalizeSize(value, product = {}) {
  return normalizeVariant(value || product.size);
}

function normalizeColor(value, product = {}) {
  return normalizeVariant(value || product.color);
}

function cartVariantKey(item) {
  return [
    Number(item.productId || item.product_id),
    normalizeVariant(item.size || item.selected_size),
    normalizeVariant(item.color || item.selected_color)
  ].join(':');
}

async function customerAlreadyUsedSale(connection, productId, userId) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.user_id = ? AND oi.product_id = ? AND p.isOnSale = TRUE AND o.delivery_status NOT IN ('CANCELLED', 'REFUNDED')`,
    [userId, productId]
  );
  return Number(row.count) > 0;
}

function normalizeCartItems(items = []) {
  const merged = new Map();
  items.forEach((item) => {
    const productId = Number(item.productId || item.product_id);
    const quantity = Math.max(1, Number(item.quantity || 1));
    if (!Number.isInteger(productId) || productId < 1) return;
    const normalized = {
      productId,
      quantity: 0,
      size: normalizeVariant(item.size || item.selected_size),
      color: normalizeVariant(item.color || item.selected_color)
    };
    const key = cartVariantKey(normalized);
    const current = merged.get(key) || normalized;
    current.quantity += quantity;
    merged.set(key, current);
  });
  return [...merged.values()];
}

async function addCartItems(connection, userId, requestedItems = []) {
  const items = normalizeCartItems(requestedItems);
  if (!items.length) {
    const error = new Error('Select at least one item.');
    error.status = 400;
    throw error;
  }

  for (const item of items) {
    const [[rawProduct]] = await connection.execute('SELECT * FROM products WHERE id = ? FOR UPDATE', [item.productId]);
    const product = rawProduct ? mapSaleProduct(rawProduct) : null;
    if (!product) {
      const error = new Error(`Product ${item.productId} not found.`);
      error.status = 404;
      throw error;
    }

    if (product.isOnSale && await customerAlreadyUsedSale(connection, product.id, userId)) {
      const error = new Error(`${product.name} sale limit already reached.`);
      error.status = 400;
      throw error;
    }

    const allowedQty = product.isOnSale ? 1 : item.quantity;
    const requiredStock = allowedQty + Number(product.bogoFreeQuantity || 0);
    if (product.isOnSale && item.quantity > 1) {
      const error = new Error(`${product.name} is limited to 1 quantity per customer.`);
      error.status = 400;
      throw error;
    }
    if (product.stock < requiredStock) {
      const error = new Error(`${product.name} has only limited stock.`);
      error.status = 400;
      throw error;
    }
    const size = normalizeSize(item.size, product);
    const color = normalizeColor(item.color, product);

    await connection.execute(
      `INSERT INTO cart (user_id, product_id, size, color, quantity)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = LEAST(quantity + VALUES(quantity), ?)`,
      [userId, item.productId, size, color, allowedQty, product.isOnSale ? 1 : product.stock]
    );
  }

  return items.length;
}

module.exports = {
  addCartItems,
  normalizeCartItems,
  normalizeVariant,
  normalizeSize,
  normalizeColor
};
