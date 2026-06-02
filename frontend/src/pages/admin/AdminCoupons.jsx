import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import AdminTabs from '../../components/AdminTabs';

const emptyCoupon = {
  coupon_code: '',
  title: '',
  description: '',
  discount_amount: '',
  minimum_order: '',
  expiry_date: '',
  status: 'ACTIVE'
};

const formatMoney = (value) => Number(value || 0).toFixed(2);
const toLocalInputDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'active';
  if (normalized === 'expired') return 'expired';
  return 'disabled';
}

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState([]);
  const [form, setForm] = useState(emptyCoupon);
  const [editingId, setEditingId] = useState('');
  const [message, setMessage] = useState('');
  const activeCoupon = useMemo(() => coupons.find((coupon) => String(coupon.id) === String(editingId)), [coupons, editingId]);

  useEffect(() => { loadCoupons(); }, []);

  async function loadCoupons() {
    const { data } = await api.get('/admin/coupons');
    setCoupons(data);
  }

  function resetForm() {
    setForm(emptyCoupon);
    setEditingId('');
  }

  function editCoupon(coupon) {
    setEditingId(String(coupon.id));
    setForm({
      coupon_code: coupon.coupon_code,
      title: coupon.title,
      description: coupon.description || '',
      discount_amount: coupon.discount_amount,
      minimum_order: coupon.minimum_order,
      expiry_date: toLocalInputDate(coupon.expiry_date),
      status: coupon.status || 'ACTIVE'
    });
  }

  async function saveCoupon(event) {
    event.preventDefault();
    setMessage('');
    try {
      const payload = {
        ...form,
        coupon_code: form.coupon_code.toUpperCase(),
        expiry_date: form.expiry_date
      };
      if (editingId) await api.put(`/admin/coupons/${editingId}`, payload);
      else await api.post('/admin/coupons', payload);
      setMessage(editingId ? 'Coupon updated.' : 'Coupon created.');
      resetForm();
      await loadCoupons();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save coupon.');
    }
  }

  async function toggleStatus(coupon) {
    const nextStatus = String(coupon.status).toUpperCase() === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await api.patch(`/admin/coupons/${coupon.id}/status`, { status: nextStatus });
    await loadCoupons();
  }

  async function deleteCoupon(coupon) {
    if (!window.confirm(`Delete coupon ${coupon.coupon_code}?`)) return;
    await api.delete(`/admin/coupons/${coupon.id}`);
    if (String(coupon.id) === editingId) resetForm();
    await loadCoupons();
  }

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Coupon Control</h1>
      {message && <div className="alert alert-info">{message}</div>}
      <AdminTabs />

      <section className="coupon-admin-layout">
        <form className="admin-form coupon-edit-panel" onSubmit={saveCoupon}>
          <div>
            <h2>{editingId ? 'Edit coupon' : 'Create coupon'}</h2>
            <p className="helper-text">{activeCoupon ? `Editing ${activeCoupon.coupon_code}` : 'Create discounts for checkout.'}</p>
          </div>
          <label>Coupon code<input value={form.coupon_code} onChange={(e) => setForm({ ...form, coupon_code: e.target.value.toUpperCase() })} required /></label>
          <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          <div className="coupon-form-grid">
            <label>Discount amount<input type="number" min="0" step="0.01" value={form.discount_amount} onChange={(e) => setForm({ ...form, discount_amount: e.target.value })} required /></label>
            <label>Minimum order<input type="number" min="0" step="0.01" value={form.minimum_order} onChange={(e) => setForm({ ...form, minimum_order: e.target.value })} required /></label>
          </div>
          <label>Expiry date<input type="datetime-local" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} required /></label>
          <label>Description<textarea className="csv-box coupon-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></label>
          <div className="coupon-action-row">
            <button className="btn btn-dark">{editingId ? 'Save changes' : 'Save coupon'}</button>
            <button className="btn btn-outline-dark" type="button" onClick={resetForm}>Cancel</button>
          </div>
        </form>

        <div className="table-card coupon-table-card">
          <div className="section-title-row">
            <div>
              <h2>Coupon list</h2>
              <p className="helper-text">Expired coupons are shown automatically based on expiry date.</p>
            </div>
          </div>
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Coupon code</th>
                <th>Title</th>
                <th>Description</th>
                <th>Discount amount</th>
                <th>Minimum order</th>
                <th>Expiry date/time</th>
                <th>Status</th>
                <th>Used count</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => {
                const displayStatus = coupon.displayStatus || coupon.status;
                return (
                  <tr key={coupon.id}>
                    <td><strong>{coupon.coupon_code}</strong></td>
                    <td>{coupon.title}</td>
                    <td className="coupon-description-cell">{coupon.description || '-'}</td>
                    <td>Rs.{formatMoney(coupon.discount_amount)}</td>
                    <td>Rs.{formatMoney(coupon.minimum_order)}</td>
                    <td>{new Date(coupon.expiry_date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td><span className={`coupon-status ${statusClass(displayStatus)}`}>{displayStatus}</span></td>
                    <td>{coupon.used_count}</td>
                    <td>
                      <div className="coupon-row-actions">
                        <button className="link-button" type="button" onClick={() => editCoupon(coupon)}>Edit</button>
                        <button className="link-button" type="button" onClick={() => toggleStatus(coupon)}>{String(coupon.status).toUpperCase() === 'ACTIVE' ? 'Disable' : 'Enable'}</button>
                        <button className="link-button danger" type="button" onClick={() => deleteCoupon(coupon)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!coupons.length && <tr><td colSpan="9">No coupons yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
