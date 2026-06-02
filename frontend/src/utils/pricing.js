export function money(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

export function clampPercent(value) {
  return Math.min(Math.max(Number(value) || 0, 0), 100);
}

export function getProductPricing(product = {}) {
  const originalPrice = Number(
    product.original_price
    ?? product.mrp
    ?? product.originalPrice
    ?? product.price
    ?? product.selling_price
    ?? 0
  );
  const discountPercentage = clampPercent(
    product.discount_percentage
    ?? product.discountPercent
    ?? product.offer_percentage
    ?? product.discount_percent
    ?? product.saleDiscountPercent
    ?? product.discount
  );
  const explicitSellingPrice = Number(product.selling_price ?? product.effectivePrice ?? product.salePrice ?? 0);
  const rawPrice = Number(product.price || 0);
  const calculatedSellingPrice = discountPercentage > 0
    ? originalPrice * (1 - discountPercentage / 100)
    : rawPrice;
  const sellingPrice = explicitSellingPrice || calculatedSellingPrice || rawPrice || originalPrice;

  return {
    sellingPrice,
    originalPrice: originalPrice || sellingPrice,
    discountPercentage
  };
}
