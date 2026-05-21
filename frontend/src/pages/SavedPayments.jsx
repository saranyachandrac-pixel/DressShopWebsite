import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';

const blankForm = {
  type: 'UPI',
  accountHolder: '',
  upiId: '',
  phone: '',
  cardholder: '',
  cardNumber: '',
  expiry: '',
  billingPhone: '',
  isDefault: false
};

const digitsOnly = (value) => value.replace(/\D/g, '');
const mobile = (value) => digitsOnly(value).slice(0, 10);
const upiPattern = /^[\w.-]+@[\w.-]+$/;

export default function SavedPayments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'all';
  const [methods, setMethods] = useState([]);
  const [form, setForm] = useState(blankForm);
  const [message, setMessage] = useState('');

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (tab === 'upi') setForm((current) => ({ ...current, type: 'UPI' }));
    if (tab === 'cards') setForm((current) => ({ ...current, type: 'Card' }));
  }, [tab]);

  async function refresh() {
    const { data } = await api.get('/payment-methods');
    setMethods(data);
  }

  function update(field, value) {
    if (field === 'phone' || field === 'billingPhone') value = mobile(value);
    if (field === 'cardNumber') value = digitsOnly(value).slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
    if (field === 'expiry') {
      const digits = digitsOnly(value).slice(0, 4);
      value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    }
    setForm({ ...form, [field]: value });
  }

  async function save(e) {
    e.preventDefault();
    setMessage('');
    if (form.type === 'UPI' && !upiPattern.test(form.upiId.trim())) {
      setMessage('Enter a valid UPI ID like name@bank.');
      return;
    }
    try {
      await api.post('/payment-methods', form);
      setForm({ ...blankForm, type: form.type });
      setMessage(`${form.type === 'UPI' ? 'UPI ID' : 'Card'} saved.`);
      await refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save payment method.');
    }
  }

  async function remove(id) {
    await api.delete(`/payment-methods/${id}`);
    await refresh();
  }

  async function setDefault(id) {
    await api.patch(`/payment-methods/${id}/default`);
    await refresh();
  }

  const visibleMethods = useMemo(() => methods.filter((method) => {
    if (tab === 'upi') return method.type === 'UPI';
    if (tab === 'cards') return method.type === 'Card';
    return true;
  }), [methods, tab]);

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">Payment Methods</p>
        <h1>Saved UPI IDs & Cards</h1>
        <p className="helper-text">Cards store only safe display details. CVV is never saved.</p>
      </section>

      <div className="account-tabs">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setSearchParams({})} type="button">All</button>
        <button className={tab === 'upi' ? 'active' : ''} onClick={() => setSearchParams({ tab: 'upi' })} type="button">Saved UPI IDs</button>
        <button className={tab === 'cards' ? 'active' : ''} onClick={() => setSearchParams({ tab: 'cards' })} type="button">Saved Cards</button>
      </div>

      <section className="account-grid">
        <div className="account-card">
          <h2>Add payment method</h2>
          {message && <div className="alert alert-info">{message}</div>}
          <form className="stack-form" onSubmit={save}>
            <label>
              Payment type
              <select value={form.type} onChange={(e) => setForm({ ...blankForm, type: e.target.value })}>
                <option>UPI</option>
                <option>Card</option>
              </select>
            </label>
            {form.type === 'UPI' ? (
              <>
                <label>Account holder name<input value={form.accountHolder} onChange={(e) => update('accountHolder', e.target.value)} required /></label>
                <label>UPI ID<input placeholder="example@bank" value={form.upiId} onChange={(e) => update('upiId', e.target.value)} required /></label>
                <label>Mobile number<input inputMode="numeric" maxLength="10" pattern="\d{10}" value={form.phone} onChange={(e) => update('phone', e.target.value)} required /></label>
              </>
            ) : (
              <>
                <label>Name on card<input value={form.cardholder} onChange={(e) => update('cardholder', e.target.value)} required /></label>
                <label>Card number<input inputMode="numeric" value={form.cardNumber} onChange={(e) => update('cardNumber', e.target.value)} required /></label>
                <label>Expiry<input inputMode="numeric" placeholder="MM/YY" value={form.expiry} onChange={(e) => update('expiry', e.target.value)} required /></label>
                <label>Billing phone<input inputMode="numeric" maxLength="10" pattern="\d{10}" value={form.billingPhone} onChange={(e) => update('billingPhone', e.target.value)} required /></label>
              </>
            )}
            <label className="inline-check">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => update('isDefault', e.target.checked)} />
              Set as default {form.type}
            </label>
            <button className="btn btn-dark">Save payment details</button>
          </form>
        </div>

        <div className="account-card">
          <h2>{tab === 'upi' ? 'Saved UPI IDs' : tab === 'cards' ? 'Saved Cards' : 'Saved methods'}</h2>
          {!visibleMethods.length && <p className="helper-text">No saved payment methods yet.</p>}
          <div className="saved-payment-list">
            {visibleMethods.map((method) => (
              <div className="saved-payment-item enhanced" key={method.id}>
                <div>
                  <strong>{method.type === 'UPI' ? method.details.upiId : method.details.maskedCardNumber || method.label}</strong>
                  <p>
                    {method.type === 'UPI'
                      ? `${method.details.accountHolder} / ${method.details.phone}`
                      : `${method.details.cardholder} / ${method.details.cardType || 'Card'} / Exp ${method.details.expiryMonth || method.details.expiry?.slice(0, 2)}/${method.details.expiryYear || `20${method.details.expiry?.slice(3) || ''}`}`}
                  </p>
                  {method.is_default && <span className="default-pill">Default</span>}
                </div>
                <div className="payment-actions">
                  {!method.is_default && <button className="link-button" onClick={() => setDefault(method.id)} type="button">Set default</button>}
                  <button className="link-button danger" onClick={() => remove(method.id)} type="button">Remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
