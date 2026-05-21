import api from './api';

function normalizeCartPayload(item = {}) {
  return {
    userId: item.userId,
    productId: item.productId || item.product_id || item.id,
    size: String(item.size || item.selected_size || '').trim(),
    color: String(item.color || item.selected_color || '').trim(),
    quantity: Math.max(1, Number(item.quantity || 1))
  };
}

export function addCartItem(item) {
  return api.post('/cart', normalizeCartPayload(item));
}

export function addCartItems(items = []) {
  return api.post('/cart/add-multiple', { items: items.map(normalizeCartPayload) });
}
