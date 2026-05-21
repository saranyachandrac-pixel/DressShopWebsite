const SALE_TYPES = new Set(['percentage', 'flat', 'bogo']);

function money(value) {
  return Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
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
  const originalPrice = money(product.originalPrice || product.price);
  const active = isSaleActive(product, now);
  const salePrice = calculateSalePrice({ ...product, originalPrice }, now);
  return {
    ...product,
    isOnSale: Boolean(active),
    saleScheduled: isSaleScheduled(product, now),
    saleConfigured: Boolean(product.isOnSale),
    originalPrice,
    salePrice,
    effectivePrice: active ? salePrice : money(product.price || originalPrice),
    saleDiscountPercent: saleDiscountPercent({ ...product, originalPrice }, now),
    salePurchaseLimit: active ? 1 : null,
    bogoFreeQuantity: active && product.saleType === 'bogo' ? 1 : 0,
    saleLabel: active && product.saleType === 'bogo' ? 'Buy 1 Get 1 Free' : null
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
