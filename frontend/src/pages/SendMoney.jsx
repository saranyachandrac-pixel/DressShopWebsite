import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function SendMoney() {
  const [form, setForm] = useState({ receiver: '', amount: '', note: '' });
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!form.receiver.trim()) return setMessage('Receiver wallet number, email, or mobile is required.');
    if (Number(form.amount) <= 0) return setMessage('Amount must be greater than 0.');
    if (!window.confirm(`Send Rs.${Number(form.amount).toFixed(2)}?`)) return;
    try {
      await api.post('/wallet/send-money', form);
      setForm({ receiver: '', amount: '', note: '' });
      setMessage('Money sent successfully.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not send money.');
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card stack-form" onSubmit={submit}>
        <p className="eyebrow">Wallet</p>
        <h2>Send money</h2>
        {message && <div className="alert alert-info">{message}</div>}
        <label>Receiver<input placeholder="Wallet number, email, or mobile" value={form.receiver} onChange={(e) => setForm({ ...form, receiver: e.target.value })} required /></label>
        <label>Amount<input type="number" min="1" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
        <label>Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength="255" /></label>
        <button className="btn btn-dark">Send money</button>
        <Link to="/wallet">Back to wallet</Link>
      </form>
    </main>
  );
}
