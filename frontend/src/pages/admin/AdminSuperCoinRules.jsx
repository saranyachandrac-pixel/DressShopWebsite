import { useEffect, useState } from 'react';
import api from '../../services/api';

const emptyRule = {
  rule_name: 'Default Super Coin Rule',
  coins_per_amount: 2,
  amount_unit: 100,
  first_order_bonus: 50,
  review_bonus: 10,
  referral_bonus: 100,
  max_redeem_percentage: 10,
  coin_value_in_rupees: 1,
  expiry_days: 365,
  is_active: true
};

export default function AdminSuperCoinRules() {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState(emptyRule);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const { data } = await api.get('/admin/super-coins/rules');
    setRules(data);
  }

  async function saveRule(event) {
    event.preventDefault();
    setMessage('');
    try {
      if (editingId) await api.put(`/admin/super-coins/rules/${editingId}`, form);
      else await api.post('/admin/super-coins/rules', form);
      setForm(emptyRule);
      setEditingId(null);
      setMessage('Super Coin rule saved.');
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save rule.');
    }
  }

  function edit(rule) {
    setEditingId(rule.id);
    setForm({ ...rule, is_active: Boolean(rule.is_active) });
  }

  return (
    <section className="admin-layout">
      <form className="admin-form" onSubmit={saveRule}>
        <h2>{editingId ? 'Edit rule' : 'Create rule'}</h2>
        {Object.keys(emptyRule).filter((key) => key !== 'is_active').map((key) => (
          <label key={key}>
            {key.replaceAll('_', ' ')}
            <input
              type={key === 'rule_name' ? 'text' : 'number'}
              step={key.includes('percentage') || key.includes('rupees') || key.includes('unit') ? '0.01' : '1'}
              value={form[key] ?? ''}
              onChange={(event) => setForm({ ...form, [key]: key === 'rule_name' ? event.target.value : Number(event.target.value) })}
            />
          </label>
        ))}
        <label className="checkbox-row">
          <input type="checkbox" checked={Boolean(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
          Active rule
        </label>
        <button className="btn btn-dark">{editingId ? 'Update rule' : 'Create rule'}</button>
        {message && <p className="helper-text">{message}</p>}
      </form>
      <div className="table-card">
        <h2>Rules</h2>
        <table className="table align-middle">
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td><strong>{rule.rule_name}</strong><br /><small>{rule.coins_per_amount} coins per Rs.{rule.amount_unit}</small></td>
                <td>Max redeem {rule.max_redeem_percentage}%</td>
                <td>{rule.expiry_days} days</td>
                <td><span className={`coin-badge ${rule.is_active ? 'success' : 'muted'}`}>{rule.is_active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                <td><button className="btn btn-sm btn-outline-dark" type="button" onClick={() => edit(rule)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
