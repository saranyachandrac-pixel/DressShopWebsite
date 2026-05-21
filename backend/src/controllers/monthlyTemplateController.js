const pool = require('../config/db');
const { mapSaleProduct } = require('../utils/sale');
const crypto = require('crypto');
const { addCartItems } = require('../services/cartService');

const monthName = (month) => new Date(2000, month - 1, 1).toLocaleString('en-IN', { month: 'long' });
const money = (value) => Number((Number(value) || 0).toFixed(2));

function currentMonthParts() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function itemLineTotal(quantity, amount) {
  return money(Math.max(1, Number(quantity) || 1) * Math.max(0, Number(amount) || 0));
}

function assertCustomer(req, res) {
  if (req.user?.role === 'ADMIN') {
    res.status(403).json({ message: 'Monthly templates are available for customers only.' });
    return false;
  }
  return true;
}

async function getOrCreateCurrentTemplate(connection, userId) {
  const { month, year } = currentMonthParts();
  const [[existing]] = await connection.execute(
    'SELECT * FROM monthly_purchase_templates WHERE user_id = ? AND month = ? AND year = ?',
    [userId, month, year]
  );
  if (existing) return existing;

  const [result] = await connection.execute(
    'INSERT INTO monthly_purchase_templates (user_id, month, year, total_amount) VALUES (?, ?, ?, 0)',
    [userId, month, year]
  );
  const templateId = result.insertId;

  const [[previous]] = await connection.execute(
    `SELECT *
     FROM monthly_purchase_templates
     WHERE user_id = ? AND (year < ? OR (year = ? AND month < ?))
     ORDER BY year DESC, month DESC
     LIMIT 1`,
    [userId, year, year, month]
  );

  if (previous) {
    await connection.execute(
      `INSERT INTO monthly_purchase_template_items
        (template_id, product_id, quantity, unit, amount, is_selected, line_total)
       SELECT ?, product_id, quantity, unit, amount, FALSE, line_total
       FROM monthly_purchase_template_items
       WHERE template_id = ?`,
      [templateId, previous.id]
    );
  }

  const [[created]] = await connection.execute('SELECT * FROM monthly_purchase_templates WHERE id = ?', [templateId]);
  return created;
}

async function getTemplateWithItems(connection, userId) {
  const template = await getOrCreateCurrentTemplate(connection, userId);
  const [items] = await connection.execute(
    `SELECT mtpi.*,
            p.name,
            p.brand,
            p.category,
            p.size,
            p.stock,
            p.image,
            p.image_url,
            p.price,
            p.originalPrice,
            p.discount,
            p.discount_percent,
            p.isOnSale,
            p.saleType,
            p.saleValue,
            p.saleStartDate,
            p.saleEndDate
     FROM monthly_purchase_template_items mtpi
     JOIN products p ON p.id = mtpi.product_id
     WHERE mtpi.template_id = ?
     ORDER BY mtpi.created_at DESC, mtpi.id DESC`,
    [template.id]
  );
  const mappedItems = items.map((item) => {
    const product = mapSaleProduct({ ...item, id: item.product_id });
    return {
      ...item,
      image: item.image_url || item.image,
      amount: Number(item.amount),
      quantity: Number(item.quantity),
      line_total: Number(item.line_total),
      is_selected: Boolean(item.is_selected),
      effectivePrice: product.effectivePrice
    };
  });
  const masterTotal = money(mappedItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0));
  const selectedTotal = money(mappedItems.filter((item) => item.is_selected).reduce((sum, item) => sum + Number(item.line_total || 0), 0));
  return {
    template: {
      ...template,
      monthLabel: `${monthName(template.month)} ${template.year}`,
      total_amount: Number(template.total_amount || selectedTotal)
    },
    items: mappedItems,
    totals: {
      masterTotal,
      selectedTotal,
      selectedCount: mappedItems.filter((item) => item.is_selected).length
    }
  };
}

async function selectedTemplateItems(connection, userId) {
  const template = await getOrCreateCurrentTemplate(connection, userId);
  const [items] = await connection.execute(
    `SELECT mtpi.*,
            p.stock,
            p.name,
            p.brand,
            p.category,
            p.size,
            p.color,
            p.image,
            p.image_url,
            p.price
     FROM monthly_purchase_template_items mtpi
     JOIN products p ON p.id = mtpi.product_id
     WHERE mtpi.template_id = ? AND mtpi.is_selected = TRUE`,
    [template.id]
  );
  return { template, items };
}

async function current(req, res) {
  if (!assertCustomer(req, res)) return;
  const connection = await pool.getConnection();
  try {
    const payload = await getTemplateWithItems(connection, req.user.id);
    res.json(payload);
  } finally {
    connection.release();
  }
}

async function products(req, res) {
  if (!assertCustomer(req, res)) return;
  const [rows] = await pool.execute(
    `SELECT id, name, brand, category, size, stock, price, originalPrice, discount, discount_percent,
            image, image_url, isOnSale, saleType, saleValue, saleStartDate, saleEndDate
     FROM products
     WHERE COALESCE(is_active, TRUE) = TRUE AND stock > 0
     ORDER BY name ASC`
  );
  res.json({
    products: rows.map((row) => {
      const product = mapSaleProduct(row);
      return {
        ...row,
        image: row.image_url || row.image,
        price: Number(product.effectivePrice || row.price || 0),
        originalPrice: Number(product.originalPrice || row.originalPrice || row.price || 0)
      };
    })
  });
}

async function addItem(req, res) {
  if (!assertCustomer(req, res)) return;
  const productId = Number(req.body.productId || req.body.product_id);
  const quantity = Math.max(1, Number(req.body.quantity || 1));
  const unit = String(req.body.unit || 'pcs').trim() || 'pcs';
  if (!productId) return res.status(400).json({ message: 'Product is required.' });

  const connection = await pool.getConnection();
  try {
    const template = await getOrCreateCurrentTemplate(connection, req.user.id);
    const [[rawProduct]] = await connection.execute('SELECT * FROM products WHERE id = ? AND COALESCE(is_active, TRUE) = TRUE', [productId]);
    if (!rawProduct) return res.status(404).json({ message: 'Product not found.' });
    const product = mapSaleProduct(rawProduct);
    const amount = money(req.body.amount ?? product.effectivePrice ?? rawProduct.price);
    const lineTotal = itemLineTotal(quantity, amount);

    await connection.execute(
      `INSERT INTO monthly_purchase_template_items (template_id, product_id, quantity, unit, amount, is_selected, line_total)
       VALUES (?, ?, ?, ?, ?, TRUE, ?)
       ON DUPLICATE KEY UPDATE
         quantity = quantity + VALUES(quantity),
         unit = VALUES(unit),
         amount = VALUES(amount),
         is_selected = TRUE,
         line_total = quantity * amount`,
      [template.id, productId, quantity, unit, amount, lineTotal]
    );
    const payload = await getTemplateWithItems(connection, req.user.id);
    res.status(201).json({ message: 'Item added to monthly template.', ...payload });
  } finally {
    connection.release();
  }
}

async function updateItem(req, res) {
  if (!assertCustomer(req, res)) return;
  const itemId = Number(req.params.id);
  const quantity = Math.max(1, Number(req.body.quantity || 1));
  const amount = money(req.body.amount);
  const unit = String(req.body.unit || 'pcs').trim() || 'pcs';
  const isSelected = Boolean(req.body.is_selected ?? req.body.isSelected);
  const lineTotal = itemLineTotal(quantity, amount);

  const connection = await pool.getConnection();
  try {
    const template = await getOrCreateCurrentTemplate(connection, req.user.id);
    const [result] = await connection.execute(
      `UPDATE monthly_purchase_template_items
       SET quantity = ?, unit = ?, amount = ?, is_selected = ?, line_total = ?
       WHERE id = ? AND template_id = ?`,
      [quantity, unit, amount, isSelected, lineTotal, itemId, template.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Template item not found.' });
    const payload = await getTemplateWithItems(connection, req.user.id);
    res.json({ message: 'Template item updated.', ...payload });
  } finally {
    connection.release();
  }
}

async function deleteItem(req, res) {
  if (!assertCustomer(req, res)) return;
  const connection = await pool.getConnection();
  try {
    const template = await getOrCreateCurrentTemplate(connection, req.user.id);
    await connection.execute('DELETE FROM monthly_purchase_template_items WHERE id = ? AND template_id = ?', [req.params.id, template.id]);
    const payload = await getTemplateWithItems(connection, req.user.id);
    res.json({ message: 'Template item removed.', ...payload });
  } finally {
    connection.release();
  }
}

async function save(req, res) {
  if (!assertCustomer(req, res)) return;
  const connection = await pool.getConnection();
  try {
    const payload = await getTemplateWithItems(connection, req.user.id);
    await connection.execute(
      'UPDATE monthly_purchase_templates SET total_amount = ? WHERE id = ?',
      [payload.totals.selectedTotal, payload.template.id]
    );
    res.json({ message: 'Current month template saved.', ...payload });
  } finally {
    connection.release();
  }
}

async function addSelectedToCart(connection, userId) {
  const { items } = await selectedTemplateItems(connection, userId);
  if (!items.length) {
    const error = new Error('Select at least one monthly template item.');
    error.status = 400;
    throw error;
  }

  return addCartItems(connection, userId, items.map((item) => ({
    productId: item.product_id,
    quantity: item.quantity,
    size: item.unit || item.size || '',
    color: item.color || ''
  })));
}

async function addToCart(req, res) {
  if (!assertCustomer(req, res)) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const count = await addSelectedToCart(connection, req.user.id);
    await connection.commit();
    res.status(201).json({ message: `${count} selected item${count === 1 ? '' : 's'} added to cart.`, count });
  } catch (error) {
    await connection.rollback();
    res.status(error.status || 500).json({ message: error.message || 'Could not add items to cart.' });
  } finally {
    connection.release();
  }
}

async function buyNow(req, res) {
  if (!assertCustomer(req, res)) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { template, items } = await selectedTemplateItems(connection, req.user.id);
    if (!items.length) {
      await connection.rollback();
      return res.status(400).json({ message: 'Select at least one monthly template item.' });
    }

    const checkoutItems = items.map((item) => {
      const quantity = Math.max(1, Number(item.quantity || 1));
      if (Number(item.stock || 0) < quantity) {
        const error = new Error(`${item.name} has only limited stock.`);
        error.status = 400;
        throw error;
      }
      const amount = money(item.amount);
      return {
        templateItemId: item.id,
        product_id: item.product_id,
        productId: item.product_id,
        name: item.name,
        brand: item.brand,
        category: item.category,
        quantity,
        size: item.unit || item.size || '',
        selected_size: item.unit || item.size || '',
        color: item.color || '',
        selected_color: item.color || '',
        price: amount,
        amount,
        image: item.image_url || item.image,
        line_total: itemLineTotal(quantity, amount)
      };
    });

    const checkoutSessionId = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO monthly_template_checkout_sessions (id, user_id, template_id, items_json, total_amount, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 2 HOUR))`,
      [
        checkoutSessionId,
        req.user.id,
        template.id,
        JSON.stringify(checkoutItems),
        money(checkoutItems.reduce((sum, item) => sum + item.line_total, 0))
      ]
    );
    await connection.commit();
    res.status(201).json({
      message: `${checkoutItems.length} selected item${checkoutItems.length === 1 ? '' : 's'} ready for checkout.`,
      checkoutSessionId,
      checkoutUrl: `/checkout/buy-now?session=${checkoutSessionId}&source=monthly-template`,
      items: checkoutItems
    });
  } catch (error) {
    await connection.rollback();
    res.status(error.status || 500).json({ message: error.message || 'Could not start checkout.' });
  } finally {
    connection.release();
  }
}

module.exports = {
  current,
  products,
  addItem,
  updateItem,
  deleteItem,
  save,
  addToCart,
  buyNow
};
