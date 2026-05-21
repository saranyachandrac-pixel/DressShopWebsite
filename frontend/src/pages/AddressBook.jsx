import { useEffect, useState } from 'react';
import api from '../services/api';

const blankAddress = {
  full_name: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
  is_default: false
};

const digitsOnly = (value) => value.replace(/\D/g, '');

export default function AddressBook() {
  const [addresses, setAddresses] = useState([]);
  const [form, setForm] = useState(blankAddress);
  const [message, setMessage] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const { data } = await api.get('/addresses');
    setAddresses(data);
  }

  function update(field, value) {
    if (field === 'phone') value = digitsOnly(value).slice(0, 10);
    if (field === 'pincode') value = digitsOnly(value).slice(0, 6);
    setForm({ ...form, [field]: value });
  }

  async function save(e) {
    e.preventDefault();
    setMessage('');
    try {
      await api.post('/addresses', form);
      setForm(blankAddress);
      setMessage('Address saved.');
      await refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save address.');
    }
  }

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">Address Book</p>
        <h1>Delivery addresses</h1>
        <p className="helper-text">Manage delivery details used during checkout.</p>
      </section>

      <section className="account-grid">
        <div className="account-card">
          <h2>Add address</h2>
          {message && <div className="alert alert-info">{message}</div>}
          <form className="stack-form" onSubmit={save}>
            <label>Full name<input value={form.full_name} onChange={(e) => update('full_name', e.target.value)} required /></label>
            <label>Phone<input inputMode="numeric" maxLength="10" pattern="\d{10}" value={form.phone} onChange={(e) => update('phone', e.target.value)} required /></label>
            <label>Address line 1<input value={form.line1} onChange={(e) => update('line1', e.target.value)} required /></label>
            <label>Address line 2<input value={form.line2} onChange={(e) => update('line2', e.target.value)} /></label>
            <label>City<input value={form.city} onChange={(e) => update('city', e.target.value)} required /></label>
            <label>State<input value={form.state} onChange={(e) => update('state', e.target.value)} required /></label>
            <label>Pincode<input inputMode="numeric" maxLength="6" value={form.pincode} onChange={(e) => update('pincode', e.target.value)} required /></label>
            <label className="inline-check"><input type="checkbox" checked={form.is_default} onChange={(e) => update('is_default', e.target.checked)} /> Set as default address</label>
            <button className="btn btn-dark">Save address</button>
          </form>
        </div>

        <div className="account-card">
          <h2>Saved addresses</h2>
          {!addresses.length && <p className="helper-text">No saved addresses yet.</p>}
          <div className="saved-payment-list">
            {addresses.map((address) => (
              <div className="saved-payment-item enhanced" key={address.id}>
                <div>
                  <strong>{address.full_name}</strong>
                  <p>{address.line1} {address.line2}<br />{address.city}, {address.state} - {address.pincode}<br />{address.phone}</p>
                  {address.is_default ? <span className="default-pill">Default</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
