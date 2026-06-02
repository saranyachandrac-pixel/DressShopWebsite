import { useEffect, useState } from 'react';
import api from '../services/api';
import AdminTabs from '../components/AdminTabs';

const emptyProduct = {
  name: '',
  description: '',
  category: '',
  product_type: '',
  gender: '',
  brand: '',
  size: '',
  color: '',
  price: '',
  discount_percentage: '',
  stock: '',
  image: '',
  is_replacement_available: true,
  replacement_days: '',
  replacement_policy: ''
};

const formatMoney = (value) => Number(value || 0).toFixed(2);

export default function Admin() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyProduct);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [replacementSettings, setReplacementSettings] = useState({ defaultReplacementDays: 7, categories: [] });
  const [categoryReplacementDays, setCategoryReplacementDays] = useState({});
  const [genders, setGenders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [productTypes, setProductTypes] = useState([]);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    setForm((current) => {
      if (!current.gender) return current;
      const categoryStillValid = categories.some((category) => (
        String(category.name) === String(current.category) && String(category.gender_id) === String(current.gender)
      ));
      return categoryStillValid ? current : { ...current, category: '', product_type: '' };
    });
  }, [form.gender, categories]);
  useEffect(() => {
    setForm((current) => {
      if (!current.category) return current;
      const typeStillValid = productTypes.some((type) => (
        String(type.name) === String(current.product_type)
        && String(type.category_id) === String(current.category)
        && String(type.gender_id) === String(current.gender)
      ));
      return typeStillValid ? current : { ...current, product_type: '' };
    });
  }, [form.category, productTypes]);

  async function refresh() {
    try {
      const [productRes, settingsRes, genderRes, categoryRes, typeRes] = await Promise.all([
        api.get('/products', { params: { gender: 'all' } }),
        api.get('/admin/replacement-settings').catch(() => ({ data: { defaultReplacementDays: 7, categories: [] } })),
        api.get('/genders', { params: { include_inactive: 'true' } }),
        api.get('/categories', { params: { include_inactive: 'true' } }),
        api.get('/product-types')
      ]);
      setProducts(productRes.data.products || []);
      setReplacementSettings(settingsRes.data);
      setCategoryReplacementDays(Object.fromEntries((settingsRes.data.categories || []).map((category) => [category.id, category.replacement_days ?? ''])));
      setGenders(genderRes.data.genders || []);
      setCategories(categoryRes.data.categories || []);
      setProductTypes(typeRes.data.productTypes || []);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Product management data load panna mudiyala.');
    }
  }

  async function saveProduct(e) {
    e.preventDefault();
    setMessage('');
    try {
      if (editingId) await api.put(`/admin/products/${editingId}`, form);
      else await api.post('/admin/products', form);
      setForm(emptyProduct);
      setEditingId(null);
      setMessage('Product saved.');
      window.dispatchEvent(new Event('product-catalog-updated'));
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save product.');
    }
  }

  function edit(product) {
    const discountPercentage = product.discount_percentage
      ?? product.discountPercent
      ?? product.offer_percentage
      ?? product.discount_percent
      ?? product.discount
      ?? 0;
    setEditingId(product.id);
    setForm({
      ...product,
      price: Number(product.original_price ?? product.mrp ?? product.originalPrice ?? product.price),
      product_type: product.product_type || product.productType || 'Shirt',
      category: product.category || '',
      stock: Number(product.stock),
      discount_percentage: Number(discountPercentage),
      gender: String(product.gender || '').toUpperCase(),
      is_replacement_available: Boolean(product.is_replacement_available),
      replacement_days: product.replacement_days ?? '',
      replacement_policy: product.replacement_policy || ''
    });
  }

  async function remove(id) {
    if (!confirm('Delete this product?')) return;
    await api.delete(`/admin/products/${id}`);
    refresh();
  }

  async function uploadImage(file) {
    if (!file) return;
    setMessage('');
    setUploading(true);
    try {
      const payload = new FormData();
      payload.append('image', file);
      const { data } = await api.post('/admin/products/upload-image', payload, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setForm((current) => ({ ...current, image: data.image }));
      setMessage('Image uploaded. Save the product to keep it.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not upload image.');
    } finally {
      setUploading(false);
    }
  }

  async function saveDefaultReplacementDays(event) {
    event.preventDefault();
    const days = Number(replacementSettings.defaultReplacementDays);
    if (!Number.isInteger(days) || days < 0) return setMessage('Replacement days cannot be negative.');
    await api.put('/admin/replacement-settings', { defaultReplacementDays: days });
    setMessage('Default replacement days updated.');
    await refresh();
  }

  async function saveCategoryReplacementDays(category) {
    const rawDays = categoryReplacementDays[category.id];
    const days = rawDays === '' ? null : Number(rawDays);
    if (days != null && (!Number.isInteger(days) || days < 0)) return setMessage('Replacement days cannot be negative.');
    await api.put('/admin/replacement-settings/category', {
      gender: category.gender,
      category: category.category,
      replacement_days: days
    });
    setMessage('Category replacement days updated.');
    await refresh();
  }

  const formCategories = categories.filter((category) => String(category.gender_id) === String(form.gender));
  const formProductTypes = productTypes.filter((type) => (
    String(type.gender_id) === String(form.gender) && String(type.category_id) === String(form.category)
  ));

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Product management</h1>
      <AdminTabs />
      {message && <div className="alert alert-info">{message}</div>}
      <section className="admin-layout">
        <form className="admin-form" onSubmit={saveProduct}>
          <h2>{editingId ? 'Edit product' : 'Add product'}</h2>
          <label>
            Gender
            <select value={form.gender || ''} onChange={(e) => setForm({ ...form, gender: e.target.value, category: '', product_type: '' })} required>
              <option value="">Choose gender</option>
              {genders.map((gender) => <option key={gender.id} value={gender.id}>{gender.name}</option>)}
            </select>
          </label>
          <label>
            Category
            <select value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value, product_type: '' })} required disabled={!form.gender}>
              <option value="">Choose category</option>
              {formCategories.map((category) => <option key={`${category.gender_id}-${category.name}`} value={category.name}>{category.name}</option>)}
            </select>
          </label>
          <label>
            Product type
            <select value={form.product_type || ''} onChange={(e) => setForm({ ...form, product_type: e.target.value })} required disabled={!form.category}>
              <option value="">Choose product type</option>
              {formProductTypes.map((type) => <option key={`${type.gender_id}-${type.category_id}-${type.name}`} value={type.name}>{type.name}</option>)}
            </select>
          </label>
          {Object.keys(emptyProduct).filter((key) => !['image', 'gender', 'category', 'product_type', 'discount_percentage', 'is_replacement_available', 'replacement_days', 'replacement_policy'].includes(key)).map((key) => (
            <label key={key}>
              {key.replace('_', ' ')}
              <input
                type={['price', 'stock'].includes(key) ? 'number' : 'text'}
                placeholder={key}
                value={form[key] || ''}
                onChange={(e) => setForm({ ...form, [key]: ['price', 'stock'].includes(key) ? Number(e.target.value) : e.target.value })}
                required={['name', 'price', 'stock'].includes(key)}
              />
            </label>
          ))}
          <label>
            Discount %
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="discount percentage"
              value={form.discount_percentage ?? ''}
              onChange={(e) => setForm({ ...form, discount_percentage: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(form.is_replacement_available)}
              onChange={(e) => setForm({ ...form, is_replacement_available: e.target.checked })}
            />
            Replacement available
          </label>
          <label>
            Replacement days
            <input
              type="number"
              min="0"
              placeholder="Leave blank to use category/default"
              value={form.replacement_days ?? ''}
              onChange={(e) => setForm({ ...form, replacement_days: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </label>
          <label>
            Replacement policy
            <textarea
              className="csv-box"
              placeholder="Policy text shown to customers"
              value={form.replacement_policy || ''}
              onChange={(e) => setForm({ ...form, replacement_policy: e.target.value })}
            />
          </label>
          <div className="admin-image-control">
            <label>
              Product image URL
              <input
                placeholder="Paste image URL or upload below"
                value={form.image || ''}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
              />
            </label>
            <label>
              Upload product image
              <input type="file" accept="image/*" onChange={(e) => uploadImage(e.target.files?.[0])} />
            </label>
            {uploading && <p className="helper-text">Uploading image...</p>}
            {form.image && <img className="admin-image-preview" src={form.image} alt="Product preview" />}
          </div>
          <button className="btn btn-dark">{editingId ? 'Update' : 'Add'} product</button>
        </form>
        <div className="table-card">
          <h2>Products</h2>
          <table className="table align-middle">
            <tbody>{products.map((product) => (
              <tr key={product.id}>
                <td>
                  <div className="admin-product-cell">
                    {product.image && <img src={product.image} alt={product.name} />}
                    <span>{product.name}<br /><small>{product.brand} / {product.size}</small></span>
                  </div>
                </td>
                <td>Rs.{formatMoney(product.price)}</td>
                <td>{Number(product.discount_percentage || 0) > 0 ? `${formatMoney(product.discount_percentage)}% off` : 'No discount'}</td>
                <td>Stock {product.stock}</td>
                <td><button className="link-button" onClick={() => edit(product)}>Edit</button></td>
                <td><button className="link-button danger" onClick={() => remove(product.id)}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="table-card mt-4">
        <h2>Replacement settings</h2>
        <form className="replacement-settings-row" onSubmit={saveDefaultReplacementDays}>
          <label>
            Default replacement days
            <input
              type="number"
              min="0"
              value={replacementSettings.defaultReplacementDays}
              onChange={(e) => setReplacementSettings({ ...replacementSettings, defaultReplacementDays: Number(e.target.value) })}
            />
          </label>
          <button className="btn btn-dark" type="submit">Save default</button>
        </form>
        <table className="table align-middle">
          <thead><tr><th>Gender</th><th>Category</th><th>Product Count</th><th>Replacement days</th><th>Action</th></tr></thead>
          <tbody>{replacementSettings.categories.map((category) => (
            <tr key={category.id}>
              <td>{category.gender}</td>
              <td>{category.label}</td>
              <td>{category.product_count}</td>
              <td>
                <input
                  type="number"
                  min="0"
                  placeholder="Default"
                  value={categoryReplacementDays[category.id] ?? ''}
                  onChange={(e) => setCategoryReplacementDays({ ...categoryReplacementDays, [category.id]: e.target.value === '' ? '' : Number(e.target.value) })}
                />
              </td>
              <td><button className="btn btn-sm btn-outline-dark" type="button" onClick={() => saveCategoryReplacementDays(category)}>Save</button></td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </main>
  );
}
