const pool = require('../config/db');

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

function normalizeBool(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

function csvRows(text = '') {
  return String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

function normalizeCsvHeader(value = '') {
  return String(value).replace(/^\uFEFF/, '').trim().toLowerCase();
}

function validateHubPayload(body = {}) {
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim().toUpperCase();
  const address = String(body.address || '').trim();
  const area = String(body.area || '').trim();
  const city = String(body.city || '').trim();
  const state = String(body.state || '').trim();
  const pincode = String(body.pincode || '').trim();
  const latitude = body.latitude === '' || body.latitude == null ? null : Number(body.latitude);
  const longitude = body.longitude === '' || body.longitude == null ? null : Number(body.longitude);

  if (!name || !code || !address || !city || !PINCODE_REGEX.test(pincode)) {
    return { error: 'Name, code, address, city, and valid 6 digit pincode are required.' };
  }
  if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) {
    return { error: 'Latitude and longitude must be valid numbers.' };
  }

  return {
    value: {
      name,
      code,
      address,
      area,
      city,
      state,
      pincode,
      latitude,
      longitude,
      isActive: normalizeBool(body.isActive, true)
    }
  };
}

const listHubs = async (req, res) => {
  const [hubs] = await pool.execute(
    `SELECT h.*,
            COUNT(DISTINCT hp.id) AS pincodeCount,
            COUNT(DISTINCT hs.id) AS stockRows
     FROM hubs h
     LEFT JOIN hub_pincodes hp ON hp.hub_id = h.id
     LEFT JOIN hub_stocks hs ON hs.hub_id = h.id
     GROUP BY h.id
     ORDER BY h.created_at DESC`
  );
  res.json(hubs);
};

const createHub = async (req, res) => {
  const validation = validateHubPayload(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });

  const id = req.body.id || null;
  const hubId = id || undefined;
  const { name, code, address, area, city, state, pincode, latitude, longitude, isActive } = validation.value;
  if (hubId) {
    await pool.execute(
      'INSERT INTO hubs (id, name, hub_code, code, address, area, city, state, pincode, latitude, longitude, status, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [hubId, name, code, code, address, area, city, state, pincode, latitude, longitude, isActive ? 'ACTIVE' : 'INACTIVE', isActive]
    );
  } else {
    await pool.execute(
      'INSERT INTO hubs (id, name, hub_code, code, address, area, city, state, pincode, latitude, longitude, status, is_active) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, code, code, address, area, city, state, pincode, latitude, longitude, isActive ? 'ACTIVE' : 'INACTIVE', isActive]
    );
  }
  res.status(201).json({ message: 'Hub created.' });
};

const updateHub = async (req, res) => {
  const validation = validateHubPayload(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });

  const { name, code, address, area, city, state, pincode, latitude, longitude, isActive } = validation.value;
  const [result] = await pool.execute(
    'UPDATE hubs SET name = ?, hub_code = ?, code = ?, address = ?, area = ?, city = ?, state = ?, pincode = ?, latitude = ?, longitude = ?, status = ?, is_active = ? WHERE id = ?',
    [name, code, code, address, area, city, state, pincode, latitude, longitude, isActive ? 'ACTIVE' : 'INACTIVE', isActive, req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Hub not found.' });
  res.json({ message: 'Hub updated.' });
};

const deleteHub = async (req, res) => {
  const [result] = await pool.execute('DELETE FROM hubs WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Hub not found.' });
  res.json({ message: 'Hub deleted.' });
};

const listHubPincodes = async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT hp.*, h.name AS hubName, h.code AS hubCode
     FROM hub_pincodes hp
     JOIN hubs h ON h.id = hp.hub_id
     ORDER BY hp.pincode ASC, h.code ASC`
  );
  res.json(rows);
};

const bulkUploadPincodes = async (req, res) => {
  const csv = req.file ? req.file.buffer.toString('utf8') : req.body.csv;
  const rows = csvRows(csv);
  const bodyRows = normalizeCsvHeader(rows[0]?.[0]) === 'hubcode' ? rows.slice(1) : rows;
  const results = [];

  for (const [hubCode, pincode, deliveryDaysMin, deliveryDaysMax = deliveryDaysMin, codAvailable = 'true'] of bodyRows) {
    const normalizedCode = String(hubCode || '').trim().toUpperCase();
    const normalizedPincode = String(pincode || '').trim();
    const minDays = Number(deliveryDaysMin);
    const maxDays = Number(deliveryDaysMax);

    if (!normalizedCode || !PINCODE_REGEX.test(normalizedPincode) || !Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 0 || maxDays < minDays) {
      results.push({ hubCode, pincode, status: 'skipped', message: 'Invalid hubCode, pincode, or delivery days.' });
      continue;
    }

    const [[hub]] = await pool.execute('SELECT id FROM hubs WHERE code = ?', [normalizedCode]);
    if (!hub) {
      results.push({ hubCode: normalizedCode, pincode: normalizedPincode, status: 'skipped', message: 'Hub not found.' });
      continue;
    }

    await pool.execute(
      `INSERT INTO hub_pincodes (id, hub_id, pincode, delivery_days, delivery_days_min, delivery_days_max, is_primary, is_serviceable, cod_available)
       VALUES (UUID(), ?, ?, ?, ?, ?, TRUE, TRUE, ?)
       ON DUPLICATE KEY UPDATE delivery_days = VALUES(delivery_days), delivery_days_min = VALUES(delivery_days_min), delivery_days_max = VALUES(delivery_days_max), is_primary = TRUE, is_serviceable = TRUE, cod_available = VALUES(cod_available)`,
      [hub.id, normalizedPincode, maxDays, minDays, maxDays, normalizeBool(codAvailable, true)]
    );
    results.push({ hubCode: normalizedCode, pincode: normalizedPincode, status: 'updated' });
  }

  const summary = results.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});

  res.json({ message: 'Pincode CSV processed.', results, summary });
};

const saveHubPincode = async (req, res) => {
  const hubId = String(req.body.hubId || '').trim();
  const pincode = String(req.body.pincode || '').trim();
  const minDays = Number(req.body.deliveryDaysMin ?? req.body.delivery_days_min ?? req.body.deliveryDays ?? 0);
  const maxDays = Number(req.body.deliveryDaysMax ?? req.body.delivery_days_max ?? req.body.deliveryDays ?? minDays);

  if (!hubId || !PINCODE_REGEX.test(pincode) || !Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 0 || maxDays < minDays) {
    return res.status(400).json({ message: 'Hub, pincode, and valid min/max delivery days are required.' });
  }

  await pool.execute(
    `INSERT INTO hub_pincodes (id, hub_id, pincode, delivery_days, delivery_days_min, delivery_days_max, is_primary, is_serviceable, cod_available)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, TRUE, ?)
     ON DUPLICATE KEY UPDATE delivery_days = VALUES(delivery_days), delivery_days_min = VALUES(delivery_days_min), delivery_days_max = VALUES(delivery_days_max), is_primary = VALUES(is_primary), is_serviceable = TRUE, cod_available = VALUES(cod_available)`,
    [hubId, pincode, maxDays, minDays, maxDays, normalizeBool(req.body.isPrimary, true), normalizeBool(req.body.codAvailable, true)]
  );

  res.json({ message: 'Hub pincode mapping saved.' });
};

const listHubStocks = async (req, res) => {
  const hubId = req.query.hubId || '';
  if (!hubId) return res.status(400).json({ message: 'hubId is required.' });

  const [products] = await pool.execute(
    `SELECT p.id AS productId,
            p.name,
            p.brand,
            p.size,
            p.stock AS productStock,
            COALESCE(hi.stock_qty, hs.quantity, 0) AS quantity,
            COALESCE(hs.reserved_qty, 0) AS reservedQty,
            COALESCE(hi.updated_at, hs.updated_at) AS updatedAt
     FROM products p
     LEFT JOIN hub_stocks hs ON hs.product_id = p.id AND hs.hub_id = ? AND (hs.variant_id IS NULL OR hs.variant_id = '')
     LEFT JOIN hub_inventory hi ON hi.product_id = p.id AND hi.hub_id = ? AND (hi.variant_id IS NULL OR hi.variant_id = '')
     ORDER BY p.name ASC`,
    [hubId, hubId]
  );
  res.json(products);
};

const updateHubStock = async (req, res) => {
  const hubId = String(req.body.hubId || '').trim();
  const productId = Number(req.body.productId);
  const variantId = req.body.variantId ? String(req.body.variantId).trim() : '';
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const reservedQty = req.body.reservedQty == null ? null : Math.max(0, Number(req.body.reservedQty || 0));

  if (!hubId || !productId || !Number.isFinite(quantity)) {
    return res.status(400).json({ message: 'hubId, productId, and quantity are required.' });
  }

  await pool.execute(
    `INSERT INTO hub_stocks (id, hub_id, product_id, variant_id, quantity, reserved_qty)
     VALUES (UUID(), ?, ?, ?, ?, COALESCE(?, 0))
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), reserved_qty = COALESCE(VALUES(reserved_qty), reserved_qty)`,
    [hubId, productId, variantId, quantity, reservedQty]
  );
  await pool.execute(
    `INSERT INTO hub_inventory (id, hub_id, product_id, variant_id, stock_qty)
     VALUES (UUID(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stock_qty = VALUES(stock_qty)`,
    [hubId, productId, variantId, quantity]
  );

  res.json({ message: 'Hub stock updated.' });
};

module.exports = {
  listHubs,
  createHub,
  updateHub,
  deleteHub,
  listHubPincodes,
  saveHubPincode,
  bulkUploadPincodes,
  listHubStocks,
  updateHubStock
};
