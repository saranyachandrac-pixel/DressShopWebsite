const pool = require('../config/db');
const { estimateDeliveryDate, formatDateOnly } = require('../utils/dateHelper');

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const DEFAULT_MIN_DAYS = 4;
const DEFAULT_MAX_DAYS = 7;

const PINCODE_COORDS = {
  110001: { latitude: 28.6328, longitude: 77.2197 },
  400001: { latitude: 18.9388, longitude: 72.8354 },
  560001: { latitude: 12.9716, longitude: 77.5946 },
  620002: { latitude: 10.8265, longitude: 78.6928 },
  641006: { latitude: 11.0742, longitude: 76.9996 }
};

function normalizeDeliveryPayload(payload = {}) {
  return {
    pincode: String(payload.pincode || '').trim(),
    productId: Number(payload.productId),
    variantId: payload.variantId ? String(payload.variantId).trim() : '',
    qty: Math.max(1, Number(payload.qty || payload.quantity || 1))
  };
}

function validatePincode(pincode) {
  return PINCODE_REGEX.test(pincode);
}

function haversineKm(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const lat1 = Number(a.latitude);
  const lon1 = Number(a.longitude);
  const lat2 = Number(b.latitude);
  const lon2 = Number(b.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const toRad = (value) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pincodeDistance(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0));
}

function formatEstimateDate(value) {
  return new Date(value).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short'
  });
}

function hubDisplayName(hub) {
  return String(hub?.hubName || hub?.name || '').replace(/\s+Hub$/i, '').trim() || 'Selected';
}

function deliveryText(minDays, maxDays, hub) {
  const range = minDays === maxDays ? `${minDays} day` : `${minDays}-${maxDays} days`;
  const name = String(hub?.hubName || '').trim();
  const fromName = /(hub|warehouse)$/i.test(name) ? name : `${hubDisplayName(hub)} Hub`;
  return `${range} delivery from ${fromName}`;
}

function mapSelectedHub(hub) {
  return {
    id: hub.hubId,
    name: hub.hubName,
    code: hub.hubCode,
    city: hub.city
  };
}

function normalizeCandidate(row, targetCoords, pincode) {
  const hubCoords = { latitude: row.latitude, longitude: row.longitude };
  const geoDistance = haversineKm(targetCoords, hubCoords);
  return {
    ...row,
    deliveryDaysMin: Number(row.deliveryDaysMin || row.deliveryDays || DEFAULT_MIN_DAYS),
    deliveryDaysMax: Number(row.deliveryDaysMax || row.deliveryDays || DEFAULT_MAX_DAYS),
    distanceKm: Number.isFinite(geoDistance) ? geoDistance : null,
    sortDistance: Number.isFinite(geoDistance) ? geoDistance : pincodeDistance(pincode, row.hubPincode),
    availableQty: Number(row.availableQty || 0)
  };
}

async function getMappedCandidates(connection, normalized, lock = false) {
  const params = [normalized.productId, normalized.variantId, normalized.variantId, normalized.pincode];
  const [rows] = await connection.execute(
    `SELECT h.id AS hubId,
            h.name AS hubName,
            COALESCE(h.hub_code, h.code) AS hubCode,
            h.city,
            h.pincode AS hubPincode,
            h.latitude,
            h.longitude,
            hp.delivery_days AS deliveryDays,
            COALESCE(hp.delivery_days_min, hp.delivery_days) AS deliveryDaysMin,
            COALESCE(hp.delivery_days_max, hp.delivery_days) AS deliveryDaysMax,
            hp.cod_available AS codAvailable,
            hp.is_primary AS isPrimary,
            hs.id AS stockId,
            COALESCE(hi.id, '') AS inventoryId,
            COALESCE(hi.stock_qty, hs.quantity - hs.reserved_qty, 0) AS availableQty
     FROM hub_pincodes hp
     JOIN hubs h ON h.id = hp.hub_id
     LEFT JOIN hub_stocks hs
       ON hs.hub_id = h.id
      AND hs.product_id = ?
      AND ((? = '' AND (hs.variant_id IS NULL OR hs.variant_id = '')) OR hs.variant_id = ?)
     LEFT JOIN hub_inventory hi
       ON hi.hub_id = h.id
      AND hi.product_id = ?
      AND ((? = '' AND (hi.variant_id IS NULL OR hi.variant_id = '')) OR hi.variant_id = ?)
     WHERE hp.pincode = ?
       AND hp.is_serviceable = TRUE
       AND COALESCE(h.status, IF(h.is_active, 'ACTIVE', 'INACTIVE')) = 'ACTIVE'
     ORDER BY hp.is_primary DESC, hp.delivery_days_min ASC, hp.delivery_days ASC, h.name ASC
     ${lock ? 'FOR UPDATE' : ''}`,
    [...params.slice(0, 3), ...params.slice(0, 3), normalized.pincode]
  );
  return rows.map((row) => normalizeCandidate(row, PINCODE_COORDS[normalized.pincode], normalized.pincode));
}

async function getAllHubCandidates(connection, normalized, lock = false) {
  const params = [normalized.productId, normalized.variantId, normalized.variantId];
  const [rows] = await connection.execute(
    `SELECT h.id AS hubId,
            h.name AS hubName,
            COALESCE(h.hub_code, h.code) AS hubCode,
            h.city,
            h.pincode AS hubPincode,
            h.latitude,
            h.longitude,
            ${DEFAULT_MIN_DAYS} AS deliveryDaysMin,
            ${DEFAULT_MAX_DAYS} AS deliveryDaysMax,
            TRUE AS codAvailable,
            hs.id AS stockId,
            COALESCE(hi.id, '') AS inventoryId,
            COALESCE(hi.stock_qty, hs.quantity - hs.reserved_qty, 0) AS availableQty
     FROM hubs h
     LEFT JOIN hub_stocks hs
       ON hs.hub_id = h.id
      AND hs.product_id = ?
      AND ((? = '' AND (hs.variant_id IS NULL OR hs.variant_id = '')) OR hs.variant_id = ?)
     LEFT JOIN hub_inventory hi
       ON hi.hub_id = h.id
      AND hi.product_id = ?
      AND ((? = '' AND (hi.variant_id IS NULL OR hi.variant_id = '')) OR hi.variant_id = ?)
     WHERE COALESCE(h.status, IF(h.is_active, 'ACTIVE', 'INACTIVE')) = 'ACTIVE'
     ${lock ? 'FOR UPDATE' : ''}`,
    [...params, ...params]
  );

  const targetCoords = PINCODE_COORDS[normalized.pincode];
  return rows
    .map((row) => normalizeCandidate(row, targetCoords, normalized.pincode))
    .sort((a, b) => a.sortDistance - b.sortDistance || a.hubName.localeCompare(b.hubName));
}

function chooseCandidate(candidates, qty) {
  return candidates.find((hub) => hub.availableQty >= qty) || null;
}

function addFallbackDays(candidate, nearestHub) {
  if (!nearestHub || candidate.hubId === nearestHub.hubId) {
    return candidate;
  }

  const distance = Number(candidate.distanceKm || candidate.sortDistance || 0);
  const extraDays = Math.max(1, Math.min(5, Math.ceil(distance / 600)));
  return {
    ...candidate,
    deliveryDaysMin: Number(candidate.deliveryDaysMin) + extraDays,
    deliveryDaysMax: Number(candidate.deliveryDaysMax) + extraDays
  };
}

async function selectDeliveryHub(connection, normalized, lock = false) {
  const mappedCandidates = await getMappedCandidates(connection, normalized, lock);
  const allCandidates = await getAllHubCandidates(connection, normalized, lock);
  const nearestHub = mappedCandidates[0] || allCandidates[0] || null;

  let selectedHub = chooseCandidate(mappedCandidates, normalized.qty);
  let fallbackUsed = false;

  if (!selectedHub) {
    const mappedIds = new Set(mappedCandidates.map((hub) => hub.hubId));
    const fallbackCandidates = allCandidates.filter((hub) => !mappedIds.has(hub.hubId));
    selectedHub = chooseCandidate(fallbackCandidates, normalized.qty);
    fallbackUsed = Boolean(selectedHub && nearestHub && selectedHub.hubId !== nearestHub.hubId);
  }

  if (!selectedHub) {
    return { selectedHub: null, nearestHub, fallbackUsed: false };
  }

  return {
    selectedHub: fallbackUsed ? addFallbackDays(selectedHub, nearestHub) : selectedHub,
    nearestHub,
    fallbackUsed
  };
}

function buildEstimateBody(normalized, selectedHub, nearestHub, fallbackUsed) {
  const maxDate = estimateDeliveryDate(selectedHub.deliveryDaysMax);
  const minDays = Number(selectedHub.deliveryDaysMin);
  const maxDays = Number(selectedHub.deliveryDaysMax);
  const stockAvailableForPincode = Boolean(nearestHub && selectedHub.hubId === nearestHub.hubId);
  const body = {
    available: true,
    pincode: normalized.pincode,
    selectedHub: mapSelectedHub(selectedHub),
    stockAvailable: true,
    stockAvailableForPincode,
    deliveryHubId: selectedHub.hubId,
    deliveryHubName: selectedHub.hubName,
    deliveryText: deliveryText(minDays, maxDays, selectedHub),
    estimatedDate: formatEstimateDate(maxDate),
    estimatedDeliveryDate: formatDateOnly(maxDate),
    estimatedDays: maxDays,
    deliveryDate: formatDateOnly(maxDate),
    estimatedDeliveryMinDays: minDays,
    estimatedDeliveryMaxDays: maxDays,
    deliveryDays: maxDays,
    codAvailable: Boolean(selectedHub.codAvailable),
    fallbackUsed,
    fallback: fallbackUsed,
    hubId: selectedHub.hubId,
    hubName: selectedHub.hubName,
    hubCode: selectedHub.hubCode,
    message: deliveryText(minDays, maxDays, selectedHub)
  };

  if (fallbackUsed && nearestHub) {
    body.nearestHub = hubDisplayName(nearestHub);
  }

  return body;
}

async function getDeliveryEstimate(payload, connection = pool) {
  const normalized = normalizeDeliveryPayload(payload);

  if (!validatePincode(normalized.pincode)) {
    return { status: 400, body: { available: false, message: 'Enter a valid 6 digit pincode.' } };
  }
  if (!normalized.productId || normalized.qty < 1) {
    return { status: 400, body: { available: false, message: 'Product and quantity are required.' } };
  }

  const { selectedHub, nearestHub, fallbackUsed } = await selectDeliveryHub(connection, normalized);
  if (!selectedHub) {
    return {
      status: 200,
      body: {
        available: false,
        pincode: normalized.pincode,
        stockAvailable: false,
        stockAvailableForPincode: false,
        deliveryHubId: null,
        deliveryHubName: null,
        estimatedDeliveryDate: null,
        estimatedDays: null,
        nearestHub: nearestHub ? hubDisplayName(nearestHub) : null,
        message: `Not deliverable to ${normalized.pincode}`,
        detail: 'No mapped or nearby hub has enough stock.'
      }
    };
  }

  return {
    status: 200,
    body: buildEstimateBody(normalized, selectedHub, nearestHub, fallbackUsed)
  };
}

async function reserveHubStock(connection, payload) {
  const normalized = normalizeDeliveryPayload(payload);
  if (!validatePincode(normalized.pincode)) {
    return { error: 'Enter a valid 6 digit pincode.' };
  }

  const { selectedHub, nearestHub, fallbackUsed } = await selectDeliveryHub(connection, normalized, true);
  if (!selectedHub) {
    return { error: 'Out of stock for your pincode.' };
  }

  if (selectedHub.stockId) {
    const [result] = await connection.execute(
      'UPDATE hub_stocks SET reserved_qty = reserved_qty + ? WHERE id = ? AND (quantity - reserved_qty) >= ?',
      [normalized.qty, selectedHub.stockId, normalized.qty]
    );
    if (!result.affectedRows) return { error: 'Out of stock for your pincode.' };
  }

  if (selectedHub.inventoryId) {
    await connection.execute(
      'UPDATE hub_inventory SET stock_qty = GREATEST(0, stock_qty - ?) WHERE id = ?',
      [normalized.qty, selectedHub.inventoryId]
    );
  }

  return {
    hub: {
      ...selectedHub,
      nearestHub,
      fallbackUsed,
      estimate: buildEstimateBody(normalized, selectedHub, nearestHub, fallbackUsed)
    }
  };
}

const checkDelivery = async (req, res) => {
  const estimate = await getDeliveryEstimate(req.method === 'GET' ? req.query : req.body);
  res.status(estimate.status).json(estimate.body);
};

module.exports = {
  checkDelivery,
  getDeliveryEstimate,
  reserveHubStock,
  validatePincode
};
