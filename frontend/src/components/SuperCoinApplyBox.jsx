import { useEffect, useMemo, useState } from 'react';
import { Coins } from 'lucide-react';
import { applySuperCoins, getSuperCoinBalance, removeSuperCoins } from '../services/superCoinApi';

const formatMoney = (value) => Number(value || 0).toFixed(2);

export default function SuperCoinApplyBox({ orderAmount, appliedCoins, appliedDiscount, coinsToEarn, onApplied }) {
  const [wallet, setWallet] = useState(null);
  const [coins, setCoins] = useState(appliedCoins || '');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const available = Number(wallet?.balance || 0);
  const savingsText = useMemo(() => Number(appliedDiscount || 0) > 0 ? `You saved Rs.${formatMoney(appliedDiscount)} using Super Coins` : '', [appliedDiscount]);

  useEffect(() => {
    getSuperCoinBalance()
      .then(({ data }) => setWallet(data.wallet))
      .catch(() => setWallet(null));
  }, []);

  useEffect(() => {
    setCoins(appliedCoins || '');
  }, [appliedCoins]);

  async function applyCoins() {
    setMessage('');
    setLoading(true);
    try {
      const { data } = await applySuperCoins({ orderAmount, coins: Number(coins || 0) });
      onApplied?.(data.coins, data.discount);
      setMessage(data.message);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not apply Super Coins.');
    } finally {
      setLoading(false);
    }
  }

  async function clearCoins() {
    await removeSuperCoins().catch(() => null);
    setCoins('');
    setMessage('');
    onApplied?.(0, 0);
  }

  return (
    <div className="super-coin-apply">
      <div className="super-coin-row">
        <span className="coin-icon"><Coins size={18} /></span>
        <div>
          <strong>Super Coins</strong>
          <small>{available} available / 1 coin = Rs.1</small>
        </div>
      </div>
      <div className="super-coin-input-row">
        <input
          type="number"
          min="0"
          max={available}
          value={coins}
          onChange={(event) => setCoins(event.target.value)}
          placeholder="Coins to redeem"
        />
        <button className="btn btn-outline-dark" type="button" onClick={applyCoins} disabled={loading || available <= 0}>Apply</button>
        {Number(appliedCoins || 0) > 0 && <button className="link-button" type="button" onClick={clearCoins}>Remove</button>}
      </div>
      {savingsText && <p className="super-coin-success">{savingsText}</p>}
      {Number(coinsToEarn || 0) > 0 && <p className="helper-text">You will earn {coinsToEarn} coins after delivery.</p>}
      {message && <p className="helper-text">{message}</p>}
    </div>
  );
}
