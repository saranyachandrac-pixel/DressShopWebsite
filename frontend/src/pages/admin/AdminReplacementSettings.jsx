import { useEffect, useState } from 'react';
import AdminTabs from '../../components/AdminTabs';
import api from '../../services/api';

export default function AdminReplacementSettings() {
  const [settings, setSettings] = useState({ defaultReplacementDays: 7, categories: [] });
  const [categoryDays, setCategoryDays] = useState({});
  const [message, setMessage] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setSettings((current) => ({ ...current, categories: [] }));
    setCategoryDays({});
    const { data } = await api.get('/admin/replacement-settings');
    setSettings(data);
    setCategoryDays(Object.fromEntries((data.categories || []).map((category) => [category.id, category.replacement_days ?? ''])));
  }

  async function saveDefault(event) {
    event.preventDefault();
    const days = Number(settings.defaultReplacementDays);
    if (!Number.isInteger(days) || days < 0) return setMessage('Replacement days cannot be negative.');
    await api.put('/admin/replacement-settings', { defaultReplacementDays: days });
    setMessage('Default replacement days updated.');
    refresh();
  }

  async function saveCategory(category) {
    const rawDays = categoryDays[category.id];
    const days = rawDays === '' ? null : Number(rawDays);
    if (days != null && (!Number.isInteger(days) || days < 0)) return setMessage('Replacement days cannot be negative.');
    await api.put('/admin/replacement-settings/category', {
      gender: category.gender,
      category: category.category,
      replacement_days: days
    });
    setMessage('Category replacement days updated.');
    refresh();
  }

  return (
    <main>
      <p className="eyebrow">Admin settings</p>
      <h1>Replacement settings</h1>
      <AdminTabs />
      {message && <div className="alert alert-info">{message}</div>}
      <section className="table-card">
        <form className="replacement-settings-row" onSubmit={saveDefault}>
          <label>
            Default replacement days
            <input type="number" min="0" value={settings.defaultReplacementDays} onChange={(e) => setSettings({ ...settings, defaultReplacementDays: Number(e.target.value) })} />
          </label>
          <button className="btn btn-dark" type="submit">Save default</button>
        </form>
        <table className="table align-middle">
          <thead><tr><th>Gender</th><th>Category</th><th>Product Count</th><th>Replacement days</th><th>Action</th></tr></thead>
          <tbody>{settings.categories.map((category) => (
            <tr key={category.id}>
              <td>{category.gender}</td>
              <td>{category.label}</td>
              <td>{category.product_count}</td>
              <td>
                <input type="number" min="0" placeholder="Default" value={categoryDays[category.id] ?? ''} onChange={(e) => setCategoryDays({ ...categoryDays, [category.id]: e.target.value === '' ? '' : Number(e.target.value) })} />
              </td>
              <td><button className="btn btn-sm btn-outline-dark" type="button" onClick={() => saveCategory(category)}>Save</button></td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </main>
  );
}
