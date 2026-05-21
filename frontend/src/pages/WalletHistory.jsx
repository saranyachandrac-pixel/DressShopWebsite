import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const money = (value) => Number(value || 0).toFixed(2);
const formatDate = (value) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function WalletHistory() {
  const [transactions, setTransactions] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => { loadHistory(); }, []);

  async function loadHistory() {
    try {
      const { data } = await api.get('/wallet/history');
      setTransactions(data.transactions || []);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not load wallet history.');
    }
  }

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">Wallet</p>
        <h1>Transaction history</h1>
        <Link to="/wallet">Back to wallet</Link>
      </section>
      {message && <div className="alert alert-warning">{message}</div>}
      <section className="table-card">
        <table className="table align-middle">
          <thead><tr><th>Type</th><th>Amount</th><th>Status</th><th>Note</th><th>Date</th></tr></thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td><strong className={['CREDIT', 'REFUND'].includes(transaction.transaction_type) ? 'text-success' : 'text-danger'}>{transaction.transaction_type}</strong></td>
                <td>Rs.{money(transaction.amount)}</td>
                <td>{transaction.status}</td>
                <td>{transaction.transaction_note}</td>
                <td>{formatDate(transaction.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!transactions.length && <p className="helper-text">No transactions yet.</p>}
      </section>
    </main>
  );
}
