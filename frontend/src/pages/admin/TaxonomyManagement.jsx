import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import AdminTabs from '../../components/AdminTabs';

const emptyProductTypeForm = { gender_id: '', category_id: '', name: '', status: 'ACTIVE' };
const emptyCategoryForm = { gender_id: '', name: '', status: 'ACTIVE' };

const config = {
  genders: {
    title: 'Gender management',
    endpoint: '/admin/genders',
    listKey: 'genders',
    publicEndpoint: '/genders',
    deleteLabel: 'Deactivate gender'
  },
  categories: {
    title: 'Category management',
    endpoint: '/admin/categories',
    listKey: 'categories',
    publicEndpoint: '/categories',
    deleteLabel: 'Deactivate category'
  },
  productTypes: {
    title: 'Product type management',
    endpoint: '/admin/product-types',
    listKey: 'productTypes',
    publicEndpoint: '/product-types',
    deleteLabel: 'Deactivate product type'
  }
};

export default function TaxonomyManagement({ mode = 'genders' }) {
  const page = config[mode] || config.genders;
  const [rows, setRows] = useState([]);
  const [genders, setGenders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(mode === 'categories' ? emptyCategoryForm : emptyProductTypeForm);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setForm(mode === 'categories' ? emptyCategoryForm : emptyProductTypeForm);
    setEditingId(null);
    refresh();
  }, [mode]);

  async function refresh() {
    const [rowRes, genderRes, categoryRes] = await Promise.all([
      api.get(page.publicEndpoint, { params: { include_inactive: 'true' } }),
      api.get('/genders', { params: { include_inactive: 'true' } }),
      api.get('/categories', { params: { include_inactive: 'true' } })
    ]);
    setRows(rowRes.data[page.listKey] || []);
    setGenders(genderRes.data.genders || []);
    setCategories(categoryRes.data.categories || []);
    setMessage(mode === 'productTypes'
      ? 'Product types can be added here. Existing product-derived types can be renamed or hidden without deleting products.'
      : mode === 'categories'
        ? 'Categories can be added here. Existing product-derived categories can be renamed or hidden without deleting products.'
        : 'Values are generated from existing products. Add or edit products to change this list.');
  }

  async function saveManagedRecord(event) {
    event.preventDefault();
    setMessage('');
    try {
      const url = editingId ? `${page.endpoint}/${encodeURIComponent(editingId)}` : page.endpoint;
      const { data } = editingId ? await api.put(url, form) : await api.post(url, form);
      setForm(mode === 'categories' ? emptyCategoryForm : emptyProductTypeForm);
      setEditingId(null);
      setMessage(data?.message || 'Saved.');
      window.dispatchEvent(new Event('product-catalog-updated'));
      await refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save record.');
    }
  }

  function editManagedRecord(row) {
    setEditingId(row.id);
    setForm({
      gender_id: row.gender_id || '',
      ...(mode === 'productTypes' ? { category_id: row.category_id || '' } : {}),
      name: row.name || '',
      status: row.status || 'ACTIVE'
    });
  }

  async function removeManagedRecord(row) {
    if (!confirm(`Remove ${row.name}?`)) return;
    try {
      const { data } = await api.delete(`${page.endpoint}/${encodeURIComponent(row.id)}`);
      setMessage(data?.message || 'Removed.');
      window.dispatchEvent(new Event('product-catalog-updated'));
      await refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not remove record.');
    }
  }

  const scopedCategories = useMemo(() => (
    categories.filter((category) => String(category.gender_id) === String(form.gender_id))
  ), [categories, form.gender_id]);

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>{page.title}</h1>
      <AdminTabs />
      {message && <div className="alert alert-info">{message}</div>}

      <section className={mode !== 'genders' ? 'admin-layout' : ''}>
        {mode !== 'genders' && (
          <form className="admin-form" onSubmit={saveManagedRecord}>
            <h2>{editingId ? 'Edit' : 'Add'} {mode === 'productTypes' ? 'product type' : 'category'}</h2>
            <label>
              Gender
              <select
                value={form.gender_id || ''}
                onChange={(event) => setForm({ ...form, gender_id: event.target.value, category_id: '' })}
                required
              >
                <option value="">Choose gender</option>
                {genders.map((gender) => <option key={gender.id} value={gender.id}>{gender.name}</option>)}
              </select>
            </label>
            {mode === 'productTypes' && (
              <label>
                Category
                <select
                  value={form.category_id || ''}
                  onChange={(event) => setForm({ ...form, category_id: event.target.value })}
                  disabled={!form.gender_id}
                  required
                >
                  <option value="">Choose category</option>
                  {scopedCategories.map((category) => <option key={`${category.gender_id}-${category.name}`} value={category.name}>{category.name}</option>)}
                </select>
              </label>
            )}
            <label>
              {mode === 'productTypes' ? 'Product type' : 'Category'}
              <input value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
            <label>
              Status
              <select value={form.status || 'ACTIVE'} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <div className="modal-actions">
              <button className="btn btn-dark" type="submit">{editingId ? 'Update' : 'Add'} {mode === 'productTypes' ? 'product type' : 'category'}</button>
              {editingId && <button className="btn btn-outline-dark" type="button" onClick={() => { setEditingId(null); setForm(mode === 'categories' ? emptyCategoryForm : emptyProductTypeForm); }}>Cancel</button>}
            </div>
          </form>
        )}
        <div className="table-card">
          <h2>Records</h2>
          <table className="table align-middle">
            <thead>
              <tr>
                {mode !== 'genders' && <th>Gender</th>}
                {mode === 'productTypes' && <th>Category</th>}
                <th>Name</th>
                <th>Status</th>
                {mode !== 'genders' && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {mode !== 'genders' && <td>{row.gender_name || genders.find((gender) => String(gender.id) === String(row.gender_id))?.name}</td>}
                  {mode === 'productTypes' && <td>{row.category_name || categories.find((category) => String(category.id) === String(row.category_id))?.name}</td>}
                  <td>{row.name}</td>
                  <td>{row.status}</td>
                  {mode !== 'genders' && (
                    <td>
                      <div className="table-action-row">
                        <button className="link-button" type="button" onClick={() => editManagedRecord(row)}>Edit</button>
                        <button className="link-button danger" type="button" onClick={() => removeManagedRecord(row)}>Remove</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="helper-text">No records found. Add products with gender, category, and product type values.</p>}
        </div>
      </section>
    </main>
  );
}
