import api from './api';

export const monthlyTemplateApi = {
  current: () => api.get('/monthly-template/current'),
  products: () => api.get('/monthly-template/products'),
  addItem: (payload) => api.post('/monthly-template/add-item', payload),
  updateItem: (id, payload) => api.put(`/monthly-template/item/${id}`, payload),
  deleteItem: (id) => api.delete(`/monthly-template/item/${id}`),
  save: () => api.post('/monthly-template/save'),
  addToCart: () => api.post('/monthly-template/add-to-cart'),
  buyNow: () => api.post('/monthly-template/buy-now')
};
