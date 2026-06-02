const DEFAULT_REPLACEMENT_DAYS = 7;

function normalizeDays(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0) return null;
  return days;
}

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

async function getDefaultReplacementDays(connection) {
  const [[setting]] = await connection.execute(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    ['default_replacement_days']
  );
  const days = normalizeDays(setting?.setting_value, DEFAULT_REPLACEMENT_DAYS);
  return days == null ? DEFAULT_REPLACEMENT_DAYS : days;
}

async function getProductReplacementPolicy(connection, productId) {
  const [[product]] = await connection.execute(
    `SELECT p.id,
            p.name,
            p.category,
            p.category_id,
            p.is_replacement_available,
            p.replacement_days AS product_replacement_days,
            p.replacement_policy,
            c.replacement_days AS category_replacement_days
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id OR (p.category_id IS NULL AND c.name = p.category)
     WHERE p.id = ?`,
    [productId]
  );
  if (!product) return null;

  const defaultDays = await getDefaultReplacementDays(connection);
  const replacementDays = product.product_replacement_days != null
    ? Number(product.product_replacement_days)
    : product.category_replacement_days != null
      ? Number(product.category_replacement_days)
      : defaultDays;

  return {
    productId: product.id,
    productName: product.name,
    category: product.category,
    isReplacementAvailable: Boolean(product.is_replacement_available),
    replacementDays,
    replacementPolicy: product.replacement_policy || '',
    source: product.product_replacement_days != null ? 'product' : product.category_replacement_days != null ? 'category' : 'default'
  };
}

async function getOrderReplacementEligibility(connection, { orderId, userId, isAdmin = false }) {
  const [items] = await connection.execute(
    `SELECT o.id AS order_id,
            o.user_id,
            o.delivery_status,
            o.delivered_on,
            oi.id AS order_item_id,
            oi.product_id,
            oi.product_name,
            oi.item_status,
            p.is_replacement_available,
            p.replacement_days AS product_replacement_days,
            p.replacement_policy,
            c.replacement_days AS category_replacement_days,
            pdr_any.id AS existing_request_id,
            pdr.id AS replacement_request_id,
            pdr.request_status AS replacement_request_status
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id OR (p.category_id IS NULL AND c.name = p.category)
     LEFT JOIN post_delivery_requests pdr
       ON pdr.order_item_id = oi.id
      AND pdr.request_type = 'REPLACEMENT'
     LEFT JOIN post_delivery_requests pdr_any
       ON pdr_any.order_item_id = oi.id
     WHERE o.id = ? ${isAdmin ? '' : 'AND o.user_id = ?'}`,
    isAdmin ? [orderId] : [orderId, userId]
  );
  if (!items.length) return null;

  const defaultDays = await getDefaultReplacementDays(connection);
  const now = new Date();

  return {
    orderId: items[0].order_id,
    items: items.map((item) => {
      const replacementDays = item.product_replacement_days != null
        ? Number(item.product_replacement_days)
        : item.category_replacement_days != null
          ? Number(item.category_replacement_days)
          : defaultDays;
      const deliveredOn = item.delivered_on ? new Date(item.delivered_on) : null;
      const lastDate = deliveredOn ? new Date(deliveredOn.getTime() + replacementDays * 24 * 60 * 60 * 1000) : null;
      const alreadyReplaced = Boolean(item.replacement_request_id);
      const hasExistingRequest = Boolean(item.existing_request_id);
      const allowed = item.delivery_status === 'DELIVERED'
        && Boolean(item.is_replacement_available)
        && String(item.item_status || 'ACTIVE') !== 'CANCELLED'
        && deliveredOn
        && lastDate
        && now <= lastDate
        && !hasExistingRequest;

      return {
        orderItemId: item.order_item_id,
        productId: item.product_id,
        productName: item.product_name,
        isReplacementAvailable: Boolean(item.is_replacement_available),
        replacementDays,
        replacementPolicy: item.replacement_policy || '',
        deliveredOn: formatDate(item.delivered_on),
        replacementLastDate: formatDate(lastDate),
        replacementRequestId: item.replacement_request_id,
        replacementRequestStatus: item.replacement_request_status,
        alreadyReplaced,
        hasExistingRequest,
        allowed: Boolean(allowed),
        message: allowed
          ? `Replacement valid until ${formatDate(lastDate)}`
          : item.delivery_status !== 'DELIVERED'
            ? 'Replacement available after delivery'
            : !item.is_replacement_available
              ? 'Replacement not available for this product'
            : hasExistingRequest
                ? 'A post-delivery request already exists for this item'
                : 'Replacement window closed'
      };
    })
  };
}

module.exports = {
  DEFAULT_REPLACEMENT_DAYS,
  normalizeDays,
  getDefaultReplacementDays,
  getProductReplacementPolicy,
  getOrderReplacementEligibility
};
