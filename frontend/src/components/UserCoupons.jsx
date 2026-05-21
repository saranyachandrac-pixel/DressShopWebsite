import { useEffect, useState } from 'react';
import api from '../services/api';

const formatMoney = (value) => Number(value || 0).toFixed(2);

export default function UserCoupons({
  cartTotal = 0,
  appliedCoupon = '',
  appliedDiscount = 0,
  onApply,
  onRemove
}) {
  const [coupons, setCoupons] = useState([]);
  const [manualCode, setManualCode] = useState('');
  const [localApplied, setLocalApplied] = useState('');
  const [localDiscount, setLocalDiscount] = useState(0);
  const [message, setMessage] = useState('');
  const shownAppliedCoupon = appliedCoupon || localApplied;
  const shownAppliedDiscount = appliedDiscount || localDiscount;

  useEffect(() => {
    loadCoupons();
  }, [cartTotal]);

  async function loadCoupons() {
    try {
      const { data } = await api.get('/coupons/available', { params: { cartTotal } });
      setCoupons(data);
    } catch (error) {
      setCoupons([]);
    }
  }

  async function applyCode(code) {
    const couponCode = String(code || '').trim().toUpperCase();
    if (!couponCode) {
      setMessage('Enter a coupon code.');
      return;
    }

    try {
      await api.post('/coupons/apply', { couponCode, cartTotal });
      setMessage('');
      if (onApply) {
        await onApply(couponCode);
      } else {
        const coupon = coupons.find((item) => item.coupon_code === couponCode);
        setLocalApplied(couponCode);
        setLocalDiscount(coupon?.discount_amount || 0);
        localStorage.setItem('dress_shop_coupon_code', couponCode);
      }
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not apply coupon.');
    }
  }

  async function removeCode() {
    await api.delete('/coupons/remove').catch(() => {});
    setManualCode('');
    setMessage('');
    if (onRemove) await onRemove();
    else {
      setLocalApplied('');
      setLocalDiscount(0);
      localStorage.removeItem('dress_shop_coupon_code');
    }
  }

  return (
    <section className="user-coupons">
      <div className="section-title-row">
        <div>
          <h2>Available Coupons</h2>
          <p className="helper-text">Apply an eligible coupon to reduce your payable amount.</p>
        </div>
      </div>

      {shownAppliedCoupon && (
        <div className="applied-coupon-card">
          <div>
            <span>Applied coupon</span>
            <strong>{shownAppliedCoupon}</strong>
            <small>Discount amount: Rs.{formatMoney(shownAppliedDiscount)}</small>
          </div>
          <button className="link-button danger" type="button" onClick={removeCode}>Remove coupon</button>
        </div>
      )}

      <div className="coupon-manual-row">
        <input placeholder="Enter coupon code" value={manualCode} onChange={(event) => setManualCode(event.target.value.toUpperCase())} />
        <button className="btn btn-dark" type="button" onClick={() => applyCode(manualCode)} disabled={Boolean(shownAppliedCoupon)}>Apply</button>
      </div>
      {message && <p className="delivery-status error">{message}</p>}

      <div className="user-coupon-grid">
        {coupons.map((coupon) => (
          <article className={coupon.eligible ? 'user-coupon-card' : 'user-coupon-card disabled'} key={coupon.id}>
            <span>{coupon.coupon_code}</span>
            <h3>{coupon.title}</h3>
            <p>{coupon.description || 'Checkout offer'}</p>
            <div className="coupon-meta">
              <small>Discount Rs.{formatMoney(coupon.discount_amount)}</small>
              <small>Min order Rs.{formatMoney(coupon.minimum_order)}</small>
              <small>Expires {new Date(coupon.expiry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</small>
            </div>
            {coupon.eligible ? (
              <button className="btn btn-dark btn-sm" type="button" onClick={() => applyCode(coupon.coupon_code)} disabled={Boolean(shownAppliedCoupon)}>
                Apply
              </button>
            ) : (
              <p className="helper-text">Add Rs.{formatMoney(coupon.addMoreAmount)} more to use</p>
            )}
          </article>
        ))}
        {!coupons.length && <p className="helper-text">No active coupons available right now.</p>}
      </div>
    </section>
  );
}
