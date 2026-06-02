import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import GuestOtpVerify from '../components/GuestOtpVerify';
import GuestPaymentOptions, { validateGuestPayment } from '../components/GuestPaymentOptions';
import { clearGuestBuyNowItem, clearGuestCart, getGuestBuyNowItem, getGuestCart } from '../utils/guestCart';
import { getProductPricing } from '../utils/pricing';
import '../styles/guestCheckout.css';

const formatMoney = (value) => Number(value || 0).toFixed(2);
const blankAddress = { guestName: '', line1: '', line2: '', city: '', state: '', pincode: '' };
const blankPaymentDetails = { upiId: '', cardNumber: '', cardHolder: '', expiry: '', cvv: '', saveCard: false };

function itemPrice(item) {
  const { sellingPrice, originalPrice } = getProductPricing(item);
  return {
    sellingPrice: Number(sellingPrice || 0),
    originalPrice: Number(originalPrice || sellingPrice || 0)
  };
}

function summaryFor(items = []) {
  const productPrice = items.reduce((sum, item) => sum + itemPrice(item).originalPrice * Number(item.quantity || 1), 0);
  const subtotal = items.reduce((sum, item) => sum + itemPrice(item).sellingPrice * Number(item.quantity || 1), 0);
  const discountAmount = productPrice - subtotal;
  const tax = subtotal * 0.05;
  const deliveryCharge = subtotal > 1999 || subtotal === 0 ? 0 : 99;
  return { productPrice, discountAmount, subtotal, tax, deliveryCharge, total: subtotal + tax + deliveryCharge };
}

export default function GuestCheckout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const source = searchParams.get('source') || 'cart';
  const [items, setItems] = useState([]);
  const [verifiedGuest, setVerifiedGuest] = useState(null);
  const [address, setAddress] = useState(blankAddress);
  const [paymentMethod, setPaymentMethod] = useState('COD');
  const [paymentDetails, setPaymentDetails] = useState(blankPaymentDetails);
  const [step, setStep] = useState('verify');
  const [message, setMessage] = useState('');
  const [order, setOrder] = useState(null);
  const summary = useMemo(() => summaryFor(items), [items]);
  const paymentError = useMemo(() => validateGuestPayment(paymentMethod, paymentDetails), [paymentMethod, paymentDetails]);

  useEffect(() => {
    const checkoutItems = source === 'buy-now' ? [getGuestBuyNowItem()].filter(Boolean) : getGuestCart();
    setItems(checkoutItems);
    if (!checkoutItems.length) {
      setMessage('Your guest cart is empty.');
      setStep('empty');
    }
  }, [source]);

  function onVerified(data) {
    setVerifiedGuest(data);
    setStep('address');
  }

  function addressText() {
    return [address.line1, address.line2, address.city, address.state].filter(Boolean).join(', ');
  }

  function continueToPayment(event) {
    event.preventDefault();
    if (!verifiedGuest?.guestToken) return setMessage('Please verify OTP before checkout.');
    if (!address.guestName.trim() || !address.line1.trim() || !address.city.trim() || !address.state.trim() || !/^[1-9]\d{5}$/.test(address.pincode)) {
      return setMessage('Enter name, full address, city, state and valid pincode.');
    }
    setMessage('');
    setStep('payment');
  }

  async function placeOrder() {
    if (!verifiedGuest?.guestToken) return setMessage('Please verify OTP before placing order.');
    if (paymentError) return setMessage(paymentError);
    try {
      const { data } = await api.post('/guest/orders', {
        guestToken: verifiedGuest.guestToken,
        guestName: address.guestName,
        address: addressText(),
        pincode: address.pincode,
        paymentMethod,
        paymentDetails,
        cartItems: items.map((item) => ({
          productId: item.productId || item.id,
          quantity: item.quantity,
          size: item.selected_size || item.size || ''
        }))
      });
      const placedOrder = data.order || data;
      const orderNumber = placedOrder.orderNumber || placedOrder.order_number || data.orderNumber || data.order_number || '';
      const nextOrder = {
        ...placedOrder,
        orderNumber,
        totalPaid: placedOrder.totalPaid ?? data.totalPaid ?? data.total
      };
      setOrder(nextOrder);
      if (orderNumber) {
        localStorage.setItem('guest_last_order_number', orderNumber);
        localStorage.setItem('guest_last_order', JSON.stringify(nextOrder));
      }
      clearGuestBuyNowItem();
      if (source !== 'buy-now') clearGuestCart();
      window.dispatchEvent(new Event('guest-cart-updated'));
      setStep('success');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not place guest order.');
    }
  }

  if (step === 'empty') {
    return (
      <main className="buy-now-page">
        <div className="alert alert-warning">{message}</div>
        <button className="btn btn-dark" type="button" onClick={() => navigate('/')}>Continue shopping</button>
      </main>
    );
  }

  return (
    <main className="buy-now-page">
      <section className="checkout-hero">
        <div>
          <p className="eyebrow">Guest checkout</p>
          <h1>Verify once, checkout fast</h1>
          <p>Browse and buy without login. OTP verification is required before placing the order.</p>
        </div>
      </section>

      {message && <div className="alert alert-warning">{message}</div>}
      {step === 'verify' && <GuestOtpVerify onVerified={onVerified} />}

      {step === 'address' && (
        <section className="checkout-section">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Step 4</p>
              <h2>Delivery address</h2>
            </div>
            <span className="stock">OTP verified</span>
          </div>
          <form className="address-form" onSubmit={continueToPayment}>
            <label>Full name<input value={address.guestName} onChange={(e) => setAddress({ ...address, guestName: e.target.value })} /></label>
            <label>Address line 1<input value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} /></label>
            <label>Address line 2<input value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} /></label>
            <label>City<input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} /></label>
            <label>State<input value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} /></label>
            <label>Pincode<input inputMode="numeric" maxLength={6} value={address.pincode} onChange={(e) => setAddress({ ...address, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
          </form>
        </section>
      )}

      {step === 'payment' && (
        <section className="checkout-section">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Step 5</p>
              <h2>Payment</h2>
            </div>
          </div>
          <GuestPaymentOptions
            method={paymentMethod}
            details={paymentDetails}
            onMethodChange={(method) => {
              setPaymentMethod(method);
              setMessage('');
            }}
            onDetailsChange={(details) => {
              setPaymentDetails(details);
              setMessage('');
            }}
            error={paymentError}
          />
        </section>
      )}

      {step === 'success' && (
        <section className="checkout-section">
          <p className="eyebrow">Order success</p>
          <h2>Guest order placed</h2>
          <p>Order Number: {order?.orderNumber || order?.order_number}</p>
          <p>Total paid: Rs.{formatMoney(order?.totalPaid ?? order?.total)}</p>
          <button
            className="btn btn-outline-dark"
            type="button"
            onClick={() => navigate('/guest-track-order')}
          >
            Track order
          </button>
          <button className="btn btn-dark" type="button" onClick={() => navigate('/')}>Continue shopping</button>
        </section>
      )}

      <aside className="checkout-panel cart-summary-card">
        <h2>Order summary</h2>
        {items.map((item) => (
          <div className="summary-line" key={item.key || item.id}>
            <span>{item.name} x {item.quantity}</span>
            <strong>Rs.{formatMoney(itemPrice(item).sellingPrice * Number(item.quantity || 1))}</strong>
          </div>
        ))}
        <div className="summary-line"><span>Product price</span><strong>Rs.{formatMoney(summary.productPrice)}</strong></div>
        <div className="summary-line discount"><span>Discount</span><strong>-Rs.{formatMoney(summary.discountAmount)}</strong></div>
        <div className="summary-line"><span>Subtotal</span><strong>Rs.{formatMoney(summary.subtotal)}</strong></div>
        <div className="summary-line"><span>Tax</span><strong>Rs.{formatMoney(summary.tax)}</strong></div>
        <div className="summary-line"><span>Delivery</span><strong>{summary.deliveryCharge ? `Rs.${formatMoney(summary.deliveryCharge)}` : 'FREE'}</strong></div>
        <div className="summary-line total"><span>Total amount</span><strong>Rs.{formatMoney(summary.total)}</strong></div>
        {step === 'address' && (
          <button className="place-order-btn guest-summary-payment-btn" type="button" onClick={continueToPayment}>
            Continue to payment
          </button>
        )}
        {step === 'payment' && (
          <button className="place-order-btn guest-summary-payment-btn" type="button" disabled={Boolean(paymentError)} onClick={placeOrder}>
            Place guest order
          </button>
        )}
      </aside>
    </main>
  );
}
