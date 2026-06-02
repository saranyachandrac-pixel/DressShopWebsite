import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins } from 'lucide-react';
import { getSuperCoinBalance, getSuperCoinHistory } from '../services/superCoinApi';
import SuperCoinHistory from '../components/SuperCoinHistory';
import { useAuth } from '../context/AuthContext';

export default function SuperCoinWallet() {
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState(null);
  const [expiring, setExpiring] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (authLoading) return undefined;
    setWallet(null);
    setTransactions([]);
    setExpiring(null);
    if (user?.role === 'ADMIN') {
      navigate('/admin/dashboard', { replace: true });
      return undefined;
    }
    if (user?.role !== 'USER') return undefined;

    let cancelled = false;
    getSuperCoinHistory()
      .then(({ data }) => {
        if (cancelled) return;
        setWallet(data.wallet);
        setTransactions(data.transactions || []);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.response?.data?.message || 'Could not load Super Coins.');
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, authLoading, navigate]);

  useEffect(() => {
    if (authLoading || user?.role !== 'USER') return undefined;
    let cancelled = false;
    getSuperCoinBalance()
      .then(({ data }) => {
        if (!cancelled) setExpiring(data.expiring);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, authLoading]);

  return (
    <main className="super-coin-page">
      <section className="checkout-hero super-coin-hero">
        <div>
          <p className="eyebrow">Rewards wallet</p>
          <h1>Super Coins</h1>
          <p>Earn on orders, redeem at checkout, and track every coin from one place.</p>
        </div>
      </section>
      {message && <div className="alert alert-warning">{message}</div>}
      <section className="super-coin-stats">
        <div className="super-coin-balance-card">
          <span className="coin-icon large"><Coins size={28} /></span>
          <small>Current balance</small>
          <strong>{wallet?.balance || 0}</strong>
        </div>
        <div><small>Total earned</small><strong>{wallet?.total_earned || 0}</strong></div>
        <div><small>Total redeemed</small><strong>{wallet?.total_redeemed || 0}</strong></div>
        <div><small>Expired coins</small><strong>{wallet?.total_expired || 0}</strong></div>
        <div><small>Expiring soon</small><strong>{expiring?.coins || 0}</strong>{expiring?.next_expiry_date && <span>{new Date(expiring.next_expiry_date).toLocaleDateString('en-IN')}</span>}</div>
      </section>
      <SuperCoinHistory transactions={transactions} />
    </main>
  );
}
