import { useEffect, useState } from 'react';
import api from '../../services/api';

export default function AdminSuperCoinTransactions() {
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/admin/super-coins/transactions').then(({ data }) => setTransactions(data)).catch(() => setTransactions([]));
  }, []);

  return (
    <div className="table-card">
      <h2>Coin transaction report</h2>
      <table className="table align-middle">
        <thead><tr><th>Date</th><th>User</th><th>Order</th><th>Status</th><th>Reason</th><th className="text-end">Coins</th></tr></thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>{new Date(transaction.created_at).toLocaleString('en-IN')}</td>
              <td><strong>{transaction.customer_name}</strong><br /><small>{transaction.customer_email}</small></td>
              <td>{transaction.order_number || '-'}</td>
              <td><span className="coin-badge muted">{transaction.status}</span></td>
              <td>{transaction.description}{transaction.admin_name ? ` / ${transaction.admin_name}` : ''}</td>
              <td className="text-end"><strong>{transaction.coins}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
