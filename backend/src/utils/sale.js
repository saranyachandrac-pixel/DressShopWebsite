const SALE_TYPES = new Set(['percentage', 'flat', 'bogo']);

function money(value) {
  return Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
}

function clampPercent(value) {
  return Math.min(Math.max(Number(value) || 0, 0), 100);
}

function firstMoney(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      const amount = money(value);
      if (amount > 0) return amount;
    }
  }
  return 0;
}

function toDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSaleActive(product, now = new Date()) {
  if (!product?.isOnSale || Number(product.stock) <= 0) return false;
  const end = toDateOnly(product.saleEndDate);
  const today = toDateOnly(now);
  if (end && today > end) return false;
  return true;
}

function isSaleScheduled(product, now = new Date()) {
  if (!product?.isOnSale || Number(product.stock) <= 0) return false;
  const start = toDateOnly(product.saleStartDate);
  const today = toDateOnly(now);
  return Boolean(start && today < start);
}

function calculateSalePrice(product, now = new Date()) {
  const originalPrice = money(product.originalPrice || product.price);
  if (!isSaleActive(product, now)) return originalPrice;

  const saleValue = Number(product.saleValue) || 0;
  if (product.saleType === 'percentage') {
    return money(originalPrice * (1 - saleValue / 100));
  }
  if (product.saleType === 'flat') {
    return money(originalPrice - saleValue);
  }

  // BOGO keeps the paid unit price unchanged; checkout grants one free unit.
  return originalPrice;
}

function saleDiscountPercent(product, now = new Date()) {
  const originalPrice = money(product.originalPrice || product.price);
  const salePrice = calculateSalePrice(product, now);
  if (!isSaleActive(product, now) || !originalPrice) return 0;
  if (product.saleType === 'bogo') return 50;
  return money(((originalPrice - salePrice) / originalPrice) * 100);
}

function mapSaleProduct(product, now = new Date()) {
  const discountPercentage = clampPercent(
    product.discount_percentage
      ?? product.discountPercent
      ?? product.offer_percentage
      ?? product.discount_percent
      ?? product.discount
  );
  const explicitSellingPrice = firstMoney(product.selling_price);
  const rawPrice = money(product.price);
  const originalPrice = discountPercentage > 0 && rawPrice > 0 && !explicitSellingPrice
    ? rawPrice
    : firstMoney(
      product.original_price,
      product.mrp,
      product.originalPrice,
      product.price,
      product.selling_price
    );
  const discountedPrice = discountPercentage > 0
    ? money(originalPrice * (1 - discountPercentage / 100))
    : 0;
  const databaseSellingPrice = explicitSellingPrice
    || (rawPrice > 0 && (!originalPrice || rawPrice < originalPrice) ? rawPrice : 0);
  const regularSellingPrice = databaseSellingPrice || discountedPrice || rawPrice || originalPrice;
  const active = isSaleActive(product, now);
  const salePrice = calculateSalePrice({ ...product, originalPrice }, now);
  const effectivePrice = active ? salePrice : regularSellingPrice;
  const effectiveDiscountPercentage = active
    ? saleDiscountPercent({ ...product, originalPrice }, now)
    : discountPercentage;

  return {
    ...product,
    isOnSale: Boolean(active),
    saleScheduled: isSaleScheduled(product, now),
    saleConfigured: Boolean(product.isOnSale),
    originalPrice,
    original_price: originalPrice,
    mrp: originalPrice,
    salePrice,
    selling_price: effectivePrice,
    effectivePrice,
    price: effectivePrice,
    discount: effectiveDiscountPercentage,
    discount_percent: effectiveDiscountPercentage,
    discount_percentage: effectiveDiscountPercentage,
    discountPercent: effectiveDiscountPercentage,
    offer_percentage: effectiveDiscountPercentage,
    saleDiscountPercent: effectiveDiscountPercentage,
    salePurchaseLimit: active ? 1 : null,
    bogoFreeQuantity: active && product.saleType === 'bogo' ? 1 : 0,
    saleLabel: active && product.saleType === 'bogo' ? 'Buy 1 Get 1 Free' : null,
    image: product.image_url || product.image,
    imageUrl: product.image_url || product.image,
    is_active: product.is_active ?? product.isActive ?? true,
    status: product.status || (product.is_active === 0 || product.isActive === false ? 'inactive' : 'active')
  };
}

function validateSalePayload(payload, product = {}) {
  const errors = [];
  const saleType = payload.saleType || product.saleType;
  const saleValue = Number(payload.saleValue);
  const saleStartDate = payload.saleStartDate || product.saleStartDate;
  const saleEndDate = payload.saleEndDate || product.saleEndDate;
  const dedPermitNumber = String(payload.dedPermitNumber || product.dedPermitNumber || '').trim();
  const originalPrice = money(payload.originalPrice || product.originalPrice || product.price);
  const costPrice = money(payload.costPrice || product.costPrice || 0);

  if (!dedPermitNumber) errors.push('DED Permit Number is mandatory for UAE compliance.');
  if (!SALE_TYPES.has(saleType)) errors.push('Sale type must be percentage, flat, or bogo.');
  if (saleType === 'percentage' && (saleValue < 1 || saleValue > 90)) {
    errors.push('Percentage sale value must be between 1 and 90.');
  }
  if (saleType === 'flat' && (saleValue <= 0 || saleValue >= originalPrice)) {
    errors.push('Flat sale value must be greater than 0 and less than original price.');
  }
  if (saleStartDate && saleEndDate && toDateOnly(saleEndDate) <= toDateOnly(saleStartDate)) {
    errors.push('Sale end date must be after sale start date.');
  }

  const salePrice = calculateSalePrice({
    ...product,
    ...payload,
    isOnSale: true,
    originalPrice,
    stock: Number(product.stock) || 1
  }, toDateOnly(saleStartDate) || new Date());
  if (costPrice > 0 && salePrice < costPrice) {
    errors.push(`Sale price ${salePrice.toFixed(2)} is below cost price ${costPrice.toFixed(2)}.`);
  }

  return { errors, salePrice };
}

module.exports = {
  SALE_TYPES,
  calculateSalePrice,
  isSaleActive,
  isSaleScheduled,
  mapSaleProduct,
  saleDiscountPercent,
  validateSalePayload
};
