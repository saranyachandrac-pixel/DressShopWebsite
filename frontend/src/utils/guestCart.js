const CART_KEY = 'dress_shop_guest_cart';
const BUY_NOW_KEY = 'dress_shop_guest_buy_now';
export const GUEST_CART_EVENT = 'guest-cart-updated';

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(GUEST_CART_EVENT));
}

export function getGuestCart() {
  return readJson(CART_KEY, []);
}

export function getGuestCartCount() {
  return getGuestCart().length;
}

export function addGuestCartItem(product, options = {}) {
  const productId = Number(product.id || product.product_id || options.productId);
  if (!productId) return [];
  const size = String(options.size || product.selected_size || product.size || '').trim();
  const color = String(options.color || product.selected_color || product.color || '').trim();
  const quantity = Math.max(1, Number(options.quantity || 1));
  const key = `${productId}:${size}:${color}`;
  const items = getGuestCart();
  const existing = items.find((item) => item.key === key);
  if (existing) {
    existing.quantity = Math.min(Number(product.stock || existing.stock || 999), Number(existing.quantity || 1) + quantity);
  } else {
    items.unshift({
      key,
      productId,
      id: productId,
      name: product.name,
      brand: product.brand,
      category: product.category,
      image: product.image_url || product.image || product.imageUrl,
      price: product.price,
      selling_price: product.selling_price,
      effectivePrice: product.effectivePrice,
      originalPrice: product.originalPrice,
      original_price: product.original_price,
      mrp: product.mrp,
      discount: product.discount,
      discount_percentage: product.discount_percentage,
      discount_percent: product.discount_percent,
      stock: product.stock,
      size,
      selected_size: size,
      color,
      selected_color: color,
      quantity
    });
  }
  writeCart(items);
  return items;
}

export function updateGuestCartItem(key, patch = {}) {
  const items = getGuestCart().map((item) => {
    if (item.key !== key) return item;
    return {
      ...item,
      ...patch,
      quantity: Math.max(1, Number(patch.quantity ?? item.quantity ?? 1))
    };
  });
  writeCart(items);
  return items;
}

export function removeGuestCartItem(key) {
  const items = getGuestCart().filter((item) => item.key !== key);
  writeCart(items);
  return items;
}

export function clearGuestCart() {
  writeCart([]);
}

export function setGuestBuyNowItem(product, options = {}) {
  const productId = Number(product.id || product.product_id || options.productId);
  if (!productId) return null;
  const size = String(options.size || product.selected_size || product.size || '').trim();
  const color = String(options.color || product.selected_color || product.color || '').trim();
  const buyNowItem = {
    key: `${productId}:${size}:${color}`,
    productId,
    id: productId,
    name: product.name,
    brand: product.brand,
    category: product.category,
    image: product.image_url || product.image || product.imageUrl,
    price: product.price,
    selling_price: product.selling_price,
    effectivePrice: product.effectivePrice,
    originalPrice: product.originalPrice,
    original_price: product.original_price,
    mrp: product.mrp,
    discount: product.discount,
    discount_percentage: product.discount_percentage,
    discount_percent: product.discount_percent,
    stock: product.stock,
    size,
    selected_size: size,
    color,
    selected_color: color,
    quantity: Math.max(1, Number(options.quantity || 1))
  };
  localStorage.setItem(BUY_NOW_KEY, JSON.stringify(buyNowItem));
  return buyNowItem;
}

export function getGuestBuyNowItem() {
  return readJson(BUY_NOW_KEY, null);
}

export function clearGuestBuyNowItem() {
  localStorage.removeItem(BUY_NOW_KEY);
}
