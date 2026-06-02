import { useEffect, useState } from 'react';
import api from '../../services/api';

export default function AdminSuperCoinUsers() {
  const [users, setUsers] = useState([]);
  const [adjustment, setAdjustment] = useState({ userId: '', type: 'ADD', coins: '', reason: '' });
  const [message, setMessage] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const { data } = await api.get('/admin/super-coins/users');
    setUsers(data);
  }

  async function adjust(event) {
    event.preventDefault();
    setMessage('');
    try {
      await api.post('/admin/super-coins/manual-adjust', adjustment);
      setAdjustment({ userId: '', type: 'ADD', coins: '', reason: '' });
      setMessage('Manual adjustment saved.');
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save adjustment.');
    }
  }

  return (
    <section className="admin-layout">
      <form className="admin-form" onSubmit={adjust}>
        <h2>Manual adjustment</h2>
        <label>User<select value={adjustment.userId} onChange={(event) => setAdjustment({ ...adjustment, userId: event.target.value })} required><option value="">Choose user</option>{users.map((user) => <option value={user.user_id} key={user.user_id}>{user.name} / {user.email}</option>)}</select></label>
        <label>Type<select value={adjustment.type} onChange={(event) => setAdjustment({ ...adjustment, type: event.target.value })}><option value="ADD">Add coins</option><option value="DEDUCT">Deduct coins</option></select></label>
        <label>Coins<input type="number" min="1" value={adjustment.coins} onChange={(event) => setAdjustment({ ...adjustment, coins: Number(event.target.value) })} required /></label>
        <label>Reason<input value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} required /></label>
        <button className="btn btn-dark">Save adjustment</button>
        {message && <p className="helper-text">{message}</p>}
      </form>
      <div className="table-card">
        <h2>User balances</h2>
        <table className="table align-middle">
          <thead><tr><th>User</th><th>Balance</th><th>Earned</th><th>Redeemed</th><th>Expired</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.user_id}>
                <td><strong>{user.name}</strong><br /><small>{user.email}</small></td>
                <td>{user.balance}</td>
                <td>{user.total_earned}</td>
                <td>{user.total_redeemed}</td>
                <td>{user.total_expired}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
