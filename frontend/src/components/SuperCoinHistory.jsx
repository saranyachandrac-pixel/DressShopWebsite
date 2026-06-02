import { Coins } from 'lucide-react';

const statusClass = {
  EARNED: 'success',
  REDEEMED: 'danger',
  EXPIRED: 'muted',
  REVERSED: 'warning'
};

export default function SuperCoinHistory({ transactions = [] }) {
  if (!transactions.length) return <p className="helper-text">No Super Coin transactions yet.</p>;

  return (
    <div className="table-card">
      <h2>Transaction history</h2>
      <table className="table align-middle">
        <thead>
          <tr>
            <th>Date</th>
            <th>Details</th>
            <th>Status</th>
            <th>Expiry</th>
            <th className="text-end">Coins</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>{new Date(transaction.created_at).toLocaleDateString('en-IN')}</td>
              <td>
                <div className="super-coin-row compact">
                  <span className="coin-icon"><Coins size={16} /></span>
                  <span>
                    <strong>{transaction.description || transaction.type}</strong>
                    {transaction.order_number && <small>Order {transaction.order_number}</small>}
                  </span>
                </div>
              </td>
              <td><span className={`coin-badge ${statusClass[transaction.status] || 'muted'}`}>{transaction.status}</span></td>
              <td>{transaction.expiry_date ? new Date(transaction.expiry_date).toLocaleDateString('en-IN') : '-'}</td>
              <td className="text-end"><strong>{transaction.type === 'REDEEMED' || transaction.type === 'EXPIRED' ? '-' : '+'}{transaction.coins}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
