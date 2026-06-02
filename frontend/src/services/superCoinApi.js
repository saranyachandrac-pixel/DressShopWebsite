import api from './api';

export function getSuperCoinBalance() {
  return api.get('/super-coins/balance');
}

export function getSuperCoinHistory() {
  return api.get('/super-coins/history');
}

export function applySuperCoins(payload) {
  return api.post('/super-coins/apply', payload);
}

export function removeSuperCoins() {
  return api.post('/super-coins/remove');
}

export function estimateSuperCoins(productId, params = {}) {
  return api.get(`/super-coins/estimate/${productId}`, { params });
}
