import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const COUPON_STORAGE_KEY = 'dress_shop_coupon_code';
const formatMoney = (value) => Number(value || 0).toFixed(2);

function CouponCard({ coupon, type, onApply, onCopy }) {
  return (
    <article className={type === 'expired' ? 'account-coupon-card muted' : 'account-coupon-card'}>
      <div className="account-coupon-code">{coupon.coupon_code}</div>
      <h2>{coupon.title}</h2>
      <p>{coupon.description || 'Checkout offer'}</p>
      <div className="account-coupon-meta">
        <span>Discount Rs.{formatMoney(coupon.discount_amount)}</span>
        <span>Minimum order Rs.{formatMoney(coupon.minimum_order)}</span>
        <span>Expires {new Date(coupon.expiry_date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <span>Status {coupon.status}</span>
        {type === 'used' && <span>Order #{coupon.orderId}</span>}
        {type === 'used' && <span>Used {new Date(coupon.usedDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
        {type === 'used' && <span>Saved Rs.{formatMoney(coupon.usedDiscountAmount)}</span>}
      </div>
      {type === 'available' && (
        <div className="account-coupon-actions">
          <button className="btn btn-dark btn-sm" type="button" onClick={() => onApply(coupon.coupon_code)}>Apply</button>
          <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => onCopy(coupon.coupon_code)}>Copy Code</button>
        </div>
      )}
      {type === 'expired' && <button className="btn btn-outline-secondary btn-sm" type="button" disabled>Apply disabled</button>}
    </article>
  );
}

export default function AccountCoupons() {
  const [couponGroups, setCouponGroups] = useState({ available: [], used: [], expired: [] });
  const [activeTab, setActiveTab] = useState('available');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  useEffect(() => { loadCoupons(); }, []);

  async function loadCoupons() {
    const { data } = await api.get('/user/coupons');
    setCouponGroups({
      available: data.available || [],
      used: data.used || [],
      expired: data.expired || []
    });
  }

  const tabs = useMemo(() => ([
    ['available', 'Available Coupons', couponGroups.available.length],
    ['used', 'Used Coupons', couponGroups.used.length],
    ['expired', 'Expired Coupons', couponGroups.expired.length]
  ]), [couponGroups]);

  function applyCoupon(code) {
    localStorage.setItem(COUPON_STORAGE_KEY, code);
    setMessage(`${code} selected. It will auto apply in checkout.`);
    navigate('/cart');
  }

  async function copyCoupon(code) {
    await navigator.clipboard?.writeText(code);
    localStorage.setItem(COUPON_STORAGE_KEY, code);
    setMessage(`${code} copied and saved for checkout.`);
  }

  const emptyText = {
    available: 'No available coupons',
    used: 'No used coupons',
    expired: 'No expired coupons'
  };

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">Coupons</p>
        <h1>My coupons</h1>
        <p className="helper-text">Browse available, used, and expired coupons linked to your account.</p>
      </section>
      {message && <div className="alert alert-info">{message}</div>}

      <div className="account-tabs">
        {tabs.map(([id, label, count]) => (
          <button key={id} className={activeTab === id ? 'active' : ''} type="button" onClick={() => setActiveTab(id)}>
            {label} ({count})
          </button>
        ))}
      </div>

      <section className="account-coupon-grid">
        {couponGroups[activeTab].map((coupon) => (
          <CouponCard
            key={`${activeTab}-${coupon.id}-${coupon.orderId || ''}`}
            coupon={coupon}
            type={activeTab}
            onApply={applyCoupon}
            onCopy={copyCoupon}
          />
        ))}
        {!couponGroups[activeTab].length && <p className="helper-text">{emptyText[activeTab]}</p>}
      </section>
    </main>
  );
}
