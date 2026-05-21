import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../services/api';

const money = (value) => Number(value || 0).toFixed(2);
const formatDate = (value) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function WalletDashboard() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadWallet(); }, []);

  async function loadWallet() {
    setLoading(true);
    try {
      const { data } = await api.get('/wallet/balance');
      setWallet(data.wallet);
      setTransactions(data.recentTransactions || []);
      setMessage('');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not load wallet.');
    } finally {
      setLoading(false);
    }
  }

  async function createWallet() {
    setMessage('');
    try {
      await api.post('/wallet/create');
      await loadWallet();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not create wallet.');
    }
  }

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">My Wallet</p>
        <h1>Wallet dashboard</h1>
      </section>
      {message && <div className="alert alert-warning">{message}</div>}
      {loading && <p className="helper-text">Loading wallet...</p>}
      {wallet && (
        <section className="account-card">
          <div className="section-title-row">
            <div>
              <p className="helper-text">Wallet number</p>
              <h2>{wallet.walletNumber}</h2>
            </div>
            <span className="sale-limit-text">{wallet.status}</span>
          </div>
          <strong className="big-price">Rs.{money(wallet.balance)}</strong>
          <div className="modal-actions mt-3">
            <Link className="btn btn-dark" to="/wallet/add-money">Add money</Link>
            <Link className="btn btn-outline-dark" to="/wallet/send-money">Send money</Link>
            <Link className="link-button" to="/wallet/history">View history</Link>
          </div>
        </section>
      )}
      {!loading && !wallet && (
        <section className="account-card">
          <h2>Wallet not visible yet</h2>
          <p className="helper-text">Create or refresh your wallet to show your wallet number and balance.</p>
          <div className="modal-actions mt-3">
            <button className="btn btn-dark" type="button" onClick={createWallet}>Create wallet</button>
            <button className="btn btn-outline-dark" type="button" onClick={loadWallet}>Refresh</button>
          </div>
        </section>
      )}
      <section className="account-card">
        <h2>Recent transactions</h2>
        {!transactions.length && <p className="helper-text">No wallet transactions yet.</p>}
        <div className="payment-summary">
          {transactions.map((transaction) => (
            <div className="summary-line" key={transaction.id}>
              <span>{transaction.transaction_type} - {transaction.transaction_note || 'Wallet transaction'}<br /><small>{formatDate(transaction.created_at)}</small></span>
              <strong>Rs.{money(transaction.amount)}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
