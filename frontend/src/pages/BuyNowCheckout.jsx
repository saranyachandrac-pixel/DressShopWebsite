import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { getSavedPincode, savePincode } from '../hooks/useDeliveryDate';
import { useAuth } from '../context/AuthContext';
import UserCoupons from '../components/UserCoupons';
import SuperCoinApplyBox from '../components/SuperCoinApplyBox';

const blankAddress = { full_name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '', is_default: true };
const blankPaymentDetails = {
  upiId: '',
  upiName: '',
  upiPhone: '',
  cardName: '',
  cardNumber: '',
  expiry: '',
  cvv: '',
  billingPhone: '',
  codReceiver: '',
  codPhone: '',
  codConfirmed: false,
  savePayment: false
};
const CASH_ON_DELIVERY_CHARGE = 60;
const COUPON_STORAGE_KEY = 'dress_shop_coupon_code';
const MOBILE_NUMBER_LENGTH = 10;
const mobilePaymentFields = new Set(['upiPhone', 'billingPhone', 'codPhone']);
const mobileInputProps = { inputMode: 'numeric', maxLength: MOBILE_NUMBER_LENGTH, pattern: '\\d{10}' };
const formatMoney = (value) => Number(value || 0).toFixed(2);
const formatPercent = (value) => Number(value || 0).toFixed(2);
const digitsOnly = (value) => String(value || '').replace(/\D/g, '');
const normalizeMobileNumber = (value) => digitsOnly(value).slice(0, MOBILE_NUMBER_LENGTH);
const isValidMobileNumber = (value) => normalizeMobileNumber(value).length === MOBILE_NUMBER_LENGTH;

function AddressCard({ address, selected, onSelect }) {
  return (
    <button type="button" className={selected ? 'address-choice selected' : 'address-choice'} onClick={() => onSelect(String(address.id))}>
      <strong>{address.full_name}</strong>
      <span>{address.line1}{address.line2 ? `, ${address.line2}` : ''}</span>
      <span>{address.city}, {address.state} - {address.pincode}</span>
      <span>{address.phone}</span>
    </button>
  );
}

export default function BuyNowCheckout() {
  const { productId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { refreshCartCount } = useAuth();
  const size = searchParams.get('size') || '';
  const quantity = Math.max(1, Number(searchParams.get('quantity') || 1));
  const isCartPath = location.pathname === '/checkout/cart';
  const isMonthlyPath = location.pathname === '/checkout/buy-now';
  const savedMonthlyCheckout = (() => {
    try {
      return JSON.parse(localStorage.getItem('monthly_template_checkout') || '{}');
    } catch (error) {
      return {};
    }
  })();
  const checkoutSessionId = isMonthlyPath
    ? searchParams.get('session') || location.state?.checkoutSessionId || savedMonthlyCheckout.checkoutSessionId || ''
    : '';
  const source = isCartPath ? 'cart' : searchParams.get('source') || location.state?.source || (isMonthlyPath ? savedMonthlyCheckout.source : '') || '';
  const isCartCheckout = source === 'cart' || isCartPath;
  const isMonthlyTemplateCheckout = isMonthlyPath && source === 'monthly-template' && checkoutSessionId;
  const [item, setItem] = useState(null);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [address, setAddress] = useState(blankAddress);
  const [step, setStep] = useState('loading');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [paymentDetails, setPaymentDetails] = useState(blankPaymentDetails);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [deliveryInfo, setDeliveryInfo] = useState({ loading: false, error: '', result: null, pincode: '' });
  const [message, setMessage] = useState('');
  const [couponCode, setCouponCode] = useState(() => localStorage.getItem(COUPON_STORAGE_KEY) || '');
  const [appliedCoupon, setAppliedCoupon] = useState(() => localStorage.getItem(COUPON_STORAGE_KEY) || '');
  const [appliedSuperCoins, setAppliedSuperCoins] = useState(0);
  const payableTotal = useMemo(() => Number(summary?.total || 0), [summary]);

  useEffect(() => { refresh(); }, [location.pathname, productId, size, quantity, checkoutSessionId]);
  useEffect(() => {
    if (step === 'payment') refreshSummary(paymentMethod);
  }, [step, location.pathname, paymentMethod, productId, size, quantity, checkoutSessionId, appliedSuperCoins]);
  useEffect(() => { checkDelivery(); }, [selectedAddress, item?.product_id, items.length]);

  async function refresh() {
    setMessage('');
    if (!isCartCheckout && !isMonthlyTemplateCheckout && !productId) {
      localStorage.removeItem('monthly_template_checkout');
      setMessage('Checkout session missing. Please start Buy Now again.');
      setStep('error');
      return;
    }
    try {
      const [checkoutRes, cartRes, addressRes, paymentRes] = await Promise.all([
        isCartCheckout
          ? api.get('/orders/summary', { params: { paymentMethod, couponCode: appliedCoupon, superCoins: appliedSuperCoins } })
          : isMonthlyTemplateCheckout
            ? api.get(`/orders/monthly-template/summary/${checkoutSessionId}`, { params: { paymentMethod, couponCode: appliedCoupon, superCoins: appliedSuperCoins } })
            : api.get(`/orders/buy-now/summary/${productId}`, { params: { size, quantity, paymentMethod, couponCode: appliedCoupon, superCoins: appliedSuperCoins } }),
        isCartCheckout ? api.get('/cart') : Promise.resolve({ data: { items: [] } }),
        api.get('/addresses'),
        api.get('/payment-methods').catch(() => ({ data: [] }))
      ]);
      const checkoutItems = isCartCheckout ? (cartRes.data.items || []) : checkoutRes.data.items || (checkoutRes.data.item ? [checkoutRes.data.item] : []);
      setItems(checkoutItems);
      setItem(checkoutRes.data.item || checkoutItems[0] || null);
      setSummary(isCartCheckout ? checkoutRes.data : checkoutRes.data.summary);
      setAddresses(addressRes.data);
      setSavedPaymentMethods(paymentRes.data);
      api.get('/wallet/balance').then(({ data }) => setWallet(data.wallet)).catch(() => setWallet(null));
      const defaultAddress = addressRes.data.find((x) => x.is_default) || addressRes.data[0];
      if (defaultAddress) {
        setSelectedAddress(String(defaultAddress.id));
        setStep('payment');
      } else {
        setStep('address');
      }
    } catch (error) {
      if (isMonthlyTemplateCheckout && error.response?.status === 404) {
        localStorage.removeItem('monthly_template_checkout');
      }
      setMessage(error.response?.data?.message || 'Could not start fast checkout.');
      setStep('error');
    }
  }

  async function refreshSummary(nextPaymentMethod) {
    try {
      const { data } = isCartCheckout
        ? await api.get('/orders/summary', { params: { paymentMethod: nextPaymentMethod, couponCode: appliedCoupon, superCoins: appliedSuperCoins } })
        : isMonthlyTemplateCheckout
          ? await api.get(`/orders/monthly-template/summary/${checkoutSessionId}`, { params: { paymentMethod: nextPaymentMethod, couponCode: appliedCoupon, superCoins: appliedSuperCoins } })
          : await api.get(`/orders/buy-now/summary/${productId}`, { params: { size, quantity, paymentMethod: nextPaymentMethod, couponCode: appliedCoupon, superCoins: appliedSuperCoins } });
      setSummary(isCartCheckout ? data : data.summary);
      const checkoutItems = isCartCheckout ? items : data.items || (data.item ? [data.item] : []);
      setItems(checkoutItems);
      setItem(data.item || checkoutItems[0] || null);
    } catch (error) {
      if (isMonthlyTemplateCheckout && error.response?.status === 404) {
        localStorage.removeItem('monthly_template_checkout');
        setStep('error');
      }
      setMessage(error.response?.data?.message || 'Could not update order summary.');
    }
  }

  async function applyCoupon(codeOverride = couponCode) {
    setMessage('');
    try {
      const code = String(codeOverride || '').trim().toUpperCase();
      const { data } = isCartCheckout
        ? await api.get('/orders/summary', { params: { paymentMethod, couponCode: code, superCoins: appliedSuperCoins } })
        : isMonthlyTemplateCheckout
          ? await api.get(`/orders/monthly-template/summary/${checkoutSessionId}`, { params: { paymentMethod, couponCode: code, superCoins: appliedSuperCoins } })
          : await api.get(`/orders/buy-now/summary/${productId}`, { params: { size, quantity, paymentMethod, couponCode: code, superCoins: appliedSuperCoins } });
      const nextSummary = isCartCheckout ? data : data.summary;
      setSummary(nextSummary);
      const checkoutItems = isCartCheckout ? items : data.items || (data.item ? [data.item] : []);
      setItems(checkoutItems);
      setItem(data.item || checkoutItems[0] || null);
      setAppliedCoupon(nextSummary.couponCode || code);
      setCouponCode(nextSummary.couponCode || code);
      localStorage.setItem(COUPON_STORAGE_KEY, nextSummary.couponCode || code);
      setMessage(`${nextSummary.couponCode || code} applied.`);
    } catch (error) {
      setAppliedCoupon('');
      setMessage(error.response?.data?.message || 'Could not apply coupon.');
    }
  }

  async function removeCoupon() {
    setAppliedCoupon('');
    setCouponCode('');
    localStorage.removeItem(COUPON_STORAGE_KEY);
    const { data } = isCartCheckout
      ? await api.get('/orders/summary', { params: { paymentMethod, superCoins: appliedSuperCoins } })
      : isMonthlyTemplateCheckout
        ? await api.get(`/orders/monthly-template/summary/${checkoutSessionId}`, { params: { paymentMethod, superCoins: appliedSuperCoins } })
        : await api.get(`/orders/buy-now/summary/${productId}`, { params: { size, quantity, paymentMethod, superCoins: appliedSuperCoins } });
    setSummary(isCartCheckout ? data : data.summary);
    const checkoutItems = isCartCheckout ? items : data.items || (data.item ? [data.item] : []);
    setItems(checkoutItems);
    setItem(data.item || checkoutItems[0] || null);
    setMessage('');
  }

  function applySuperCoinDiscount(coins) {
    setAppliedSuperCoins(Number(coins || 0));
    setMessage(Number(coins || 0) > 0 ? 'Super Coins applied.' : '');
  }

  async function checkDelivery() {
    const selectedAddressDetails = addresses.find((x) => String(x.id) === String(selectedAddress));
    const pincode = selectedAddressDetails?.pincode || getSavedPincode();
    const deliveryItems = isCartCheckout || isMonthlyTemplateCheckout ? items : (item ? [item] : []);
    if (!deliveryItems.length || !pincode) return;

    setDeliveryInfo((current) => ({ ...current, loading: true, error: '', pincode }));
    try {
      const checks = await Promise.all(deliveryItems.map((checkoutItem) => api.post('/delivery/check', {
        pincode,
        productId: checkoutItem.product_id,
        qty: checkoutItem.quantity || quantity
      }).then((res) => ({ item: checkoutItem, delivery: res.data }))));
      const unavailable = checks.find((check) => !check.delivery.available);
      if (unavailable) {
        setDeliveryInfo({ loading: false, error: `${unavailable.item.name} is not serviceable to ${pincode}.`, result: null, pincode });
        return;
      }
      const data = checks.map((check) => check.delivery).sort((a, b) => new Date(b.deliveryDate) - new Date(a.deliveryDate))[0];
      data.codAvailable = checks.every((check) => check.delivery.codAvailable);
      savePincode(pincode);
      setDeliveryInfo({ loading: false, error: data.available ? '' : data.message, result: data, pincode });
      if (!data.codAvailable && paymentMethod === 'Cash On Delivery') {
        setPaymentMethod('UPI');
      }
    } catch (error) {
      setDeliveryInfo({ loading: false, error: error.response?.data?.message || 'Could not check delivery.', result: null, pincode });
    }
  }

  async function saveAddress(e) {
    e.preventDefault();
    if (!isValidMobileNumber(address.phone)) {
      setMessage('Mobile number must be exactly 10 digits.');
      return;
    }
    try {
      const { data } = await api.post('/addresses', address);
      const nextAddress = { ...address, id: data.id };
      setAddresses((current) => [nextAddress, ...current]);
      setSelectedAddress(String(data.id));
      setAddress(blankAddress);
      setStep('payment');
      setMessage('');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save address.');
    }
  }

  function updatePaymentDetail(field, value) {
    if (mobilePaymentFields.has(field)) {
      setPaymentDetails({ ...paymentDetails, [field]: normalizeMobileNumber(value) });
      return;
    }
    if (field === 'cardNumber') {
      setPaymentDetails({ ...paymentDetails, [field]: digitsOnly(value).slice(0, 16).replace(/(.{4})/g, '$1 ').trim() });
      return;
    }
    if (field === 'cvv') {
      setPaymentDetails({ ...paymentDetails, [field]: digitsOnly(value).slice(0, 4) });
      return;
    }
    if (field === 'expiry') {
      const digits = digitsOnly(value).slice(0, 4);
      setPaymentDetails({ ...paymentDetails, [field]: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits });
      return;
    }
    setPaymentDetails({ ...paymentDetails, [field]: value });
  }

  function useSavedPayment(methodId) {
    const method = savedPaymentMethods.find((x) => String(x.id) === String(methodId));
    if (!method) return;
    if (method.type === 'UPI') {
      setPaymentDetails({ ...paymentDetails, upiName: method.details.accountHolder || '', upiId: method.details.upiId || '', upiPhone: method.details.phone || '' });
      return;
    }
    setPaymentDetails({ ...paymentDetails, cardName: method.details.cardholder || '', cardNumber: '', expiry: method.details.expiry || '', billingPhone: method.details.billingPhone || '' });
  }

  function validatePaymentDetails() {
    if (paymentMethod === 'Wallet') {
      if (!wallet) return 'Could not load wallet balance.';
      if (Number(wallet.balance || 0) < payableTotal) return 'Insufficient wallet balance.';
      return '';
    }
    if (paymentMethod === 'UPI') {
      if (!paymentDetails.upiName.trim()) return 'Please enter the UPI account holder name.';
      if (!/^[\w.-]+@[\w.-]+$/.test(paymentDetails.upiId.trim())) return 'Please enter a valid UPI ID, for example name@bank.';
      if (!isValidMobileNumber(paymentDetails.upiPhone)) return 'Please enter a 10 digit phone number linked with the UPI account.';
    }
    if (paymentMethod === 'Credit Card' || paymentMethod === 'Debit Card') {
      if (!paymentDetails.cardName.trim()) return 'Please enter the name printed on the card.';
      if (digitsOnly(paymentDetails.cardNumber).length < 13) return 'Please enter a valid card number.';
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(paymentDetails.expiry)) return 'Please enter card expiry in MM/YY format.';
      if (paymentDetails.cvv.length < 3) return 'Please enter the CVV.';
      if (!isValidMobileNumber(paymentDetails.billingPhone)) return 'Please enter the 10 digit billing phone number.';
    }
    if (paymentMethod === 'Cash On Delivery') {
      if (!paymentDetails.codReceiver.trim()) return 'Please enter the name of the person who will pay on delivery.';
      if (!isValidMobileNumber(paymentDetails.codPhone)) return 'Please enter the 10 digit phone number for cash on delivery.';
      if (!paymentDetails.codConfirmed) return 'Please confirm that the total amount will be paid at delivery.';
    }
    return '';
  }

  async function placeOrder() {
    if (!selectedAddress) {
      setMessage('Please select or add a delivery address.');
      setStep('address');
      return;
    }
    if (deliveryInfo.error || deliveryInfo.result?.available === false) return setMessage(deliveryInfo.error || 'This product is not serviceable to your pincode.');
    const paymentError = validatePaymentDetails();
    if (paymentError) return setMessage(paymentError);
    try {
      const payload = isCartCheckout
        ? { addressId: selectedAddress, paymentMethod, paymentDetails, couponCode: appliedCoupon, superCoins: appliedSuperCoins }
        : isMonthlyTemplateCheckout
          ? { checkoutSessionId, addressId: selectedAddress, paymentMethod, paymentDetails, couponCode: appliedCoupon, superCoins: appliedSuperCoins }
          : { productId, addressId: selectedAddress, paymentMethod, paymentDetails, size, quantity, couponCode: appliedCoupon, superCoins: appliedSuperCoins };
      const { data } = await api.post(isCartCheckout ? '/orders' : isMonthlyTemplateCheckout ? '/orders/monthly-template/checkout' : '/orders/buy-now', payload);
      if (isMonthlyTemplateCheckout) localStorage.removeItem('monthly_template_checkout');
      if (isCartCheckout) await refreshCartCount();
      navigate(`/orders/${data.id}`);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not place order.');
    }
  }

  const selectedAddressDetails = addresses.find((x) => String(x.id) === String(selectedAddress));

  if (step === 'loading') return <main><p className="helper-text">Preparing fast checkout...</p></main>;

  if (step === 'error') {
    return (
      <main className="buy-now-page">
        <div className="alert alert-warning">{message || 'Checkout session missing. Please start checkout again.'}</div>
        <section className="checkout-section checkout-recovery">
          <h1>Start checkout again</h1>
          <p className="helper-text">Your previous checkout session is no longer active.</p>
          <div className="checkout-recovery-actions">
            <button className="btn btn-dark" type="button" onClick={() => navigate('/cart')}>Go to cart</button>
            <button className="btn btn-outline-dark" type="button" onClick={() => navigate('/monthly-template')}>Monthly template</button>
            <button className="continue-shop-btn" type="button" onClick={() => navigate('/')}>Continue shopping</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="buy-now-page">
      <section className="checkout-hero">
        <div>
          <p className="eyebrow">Fast checkout</p>
          <h1>{isCartCheckout ? 'Complete your cart order' : isMonthlyTemplateCheckout ? 'Buy selected dresses now' : 'Buy this dress now'}</h1>
          <p>{isCartCheckout ? 'Your bag, one address, one clear payment step.' : isMonthlyTemplateCheckout ? 'Selected monthly template items, one address, one clear payment step.' : 'One item, one address, one clear payment step.'}</p>
        </div>
      </section>

      {message && <div className="alert alert-warning">{message}</div>}

      <section className="buy-now-layout">
        <div className="checkout-workspace">
          {step === 'address' && (
            <section className="checkout-section">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Step 1</p>
                  <h2>Add delivery address</h2>
                </div>
              </div>
              {addresses.length > 0 && (
                <div className="address-grid">
                  {addresses.map((x) => <AddressCard key={x.id} address={x} selected={String(x.id) === selectedAddress} onSelect={setSelectedAddress} />)}
                </div>
              )}
              {selectedAddress && <button className="btn btn-dark" type="button" onClick={() => setStep('payment')}>Continue to payment</button>}
              <form className="stack-form address-form" onSubmit={saveAddress}>
                <h3>New address</h3>
                {['full_name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode'].map((field) => (
                  <input
                    key={field}
                    placeholder={field.replace('_', ' ')}
                    value={address[field]}
                    onChange={(e) => setAddress({ ...address, [field]: field === 'phone' ? normalizeMobileNumber(e.target.value) : e.target.value })}
                    required={field !== 'line2'}
                    {...(field === 'phone' ? mobileInputProps : {})}
                  />
                ))}
                <button className="btn btn-outline-dark">Save and continue</button>
              </form>
            </section>
          )}

          {step === 'payment' && (
            <section className="checkout-section">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Step 2</p>
                  <h2>Payment</h2>
                </div>
                <button className="link-button" type="button" onClick={() => setStep('address')}>Change address</button>
              </div>

              {selectedAddressDetails && (
                <div className="selected-address">
                  <span>Delivering to {selectedAddressDetails.pincode} <button className="link-button" type="button" onClick={() => setStep('address')}>Change</button></span>
                  <strong>{selectedAddressDetails.full_name}</strong>
                  <span>{selectedAddressDetails.line1}{selectedAddressDetails.line2 ? `, ${selectedAddressDetails.line2}` : ''}</span>
                  <span>{selectedAddressDetails.city}, {selectedAddressDetails.state} - {selectedAddressDetails.pincode}</span>
                  <span>{selectedAddressDetails.phone}</span>
                </div>
              )}
              {deliveryInfo.loading && <p className="helper-text">Checking delivery date...</p>}
              {deliveryInfo.result?.available && (
                <div className="delivery-summary">
                  Estimated delivery: {new Date(deliveryInfo.result.deliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' })}
                </div>
              )}
              {deliveryInfo.error && <div className="alert alert-warning">{deliveryInfo.error}</div>}

              <select value={paymentMethod} onChange={(e) => {
                setPaymentMethod(e.target.value);
                setPaymentDetails({ ...blankPaymentDetails });
                setMessage('');
              }}>
                {['UPI', 'Credit Card', 'Debit Card', 'Wallet', ...(deliveryInfo.result?.codAvailable !== false ? ['Cash On Delivery'] : [])].map((x) => <option key={x} value={x}>{x === 'Wallet' ? 'Pay Using Wallet' : x}</option>)}
              </select>
              {deliveryInfo.result?.codAvailable === false && <p className="helper-text">Cash On Delivery is not available for {deliveryInfo.pincode}.</p>}

              <div className="payment-box">
                {paymentMethod === 'Wallet' && (
                  <div className="payment-summary">
                    <p><strong>Wallet balance:</strong> Rs.{formatMoney(wallet?.balance)}</p>
                    {wallet && Number(wallet.balance || 0) < payableTotal && <p className="delivery-status error">Insufficient wallet balance.</p>}
                  </div>
                )}
                {paymentMethod === 'UPI' && (
                  <>
                    {savedPaymentMethods.some((method) => method.type === 'UPI') && (
                      <label>Use saved UPI<select defaultValue="" onChange={(e) => useSavedPayment(e.target.value)}><option value="">Choose saved UPI</option>{savedPaymentMethods.filter((method) => method.type === 'UPI').map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
                    )}
                    <label>Account holder name<input placeholder="Name linked with UPI" value={paymentDetails.upiName} onChange={(e) => updatePaymentDetail('upiName', e.target.value)} /></label>
                    <label>UPI ID<input placeholder="example@bank" value={paymentDetails.upiId} onChange={(e) => updatePaymentDetail('upiId', e.target.value)} /></label>
                    <label>UPI mobile number<input placeholder="10 digit mobile number" value={paymentDetails.upiPhone} onChange={(e) => updatePaymentDetail('upiPhone', e.target.value)} {...mobileInputProps} /></label>
                    <label className="checkbox-row"><input type="checkbox" checked={paymentDetails.savePayment} onChange={(e) => updatePaymentDetail('savePayment', e.target.checked)} />Save this UPI for faster checkout next time.</label>
                  </>
                )}
                {(paymentMethod === 'Credit Card' || paymentMethod === 'Debit Card') && (
                  <>
                    {savedPaymentMethods.some((method) => method.type === 'Card') && (
                      <label>Use saved card<select defaultValue="" onChange={(e) => useSavedPayment(e.target.value)}><option value="">Choose saved card</option>{savedPaymentMethods.filter((method) => method.type === 'Card').map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
                    )}
                    <label>Name on card<input placeholder="As printed on card" value={paymentDetails.cardName} onChange={(e) => updatePaymentDetail('cardName', e.target.value)} /></label>
                    <label>Card number<input inputMode="numeric" placeholder="1234 5678 9012 3456" value={paymentDetails.cardNumber} onChange={(e) => updatePaymentDetail('cardNumber', e.target.value)} /></label>
                    <div className="payment-row">
                      <label>Expiry<input inputMode="numeric" placeholder="MM/YY" value={paymentDetails.expiry} onChange={(e) => updatePaymentDetail('expiry', e.target.value)} /></label>
                      <label>CVV<input inputMode="numeric" type="password" placeholder="3 digits" value={paymentDetails.cvv} onChange={(e) => updatePaymentDetail('cvv', e.target.value)} /></label>
                    </div>
                    <label>Billing phone number<input placeholder="10 digit mobile number" value={paymentDetails.billingPhone} onChange={(e) => updatePaymentDetail('billingPhone', e.target.value)} {...mobileInputProps} /></label>
                    <label className="checkbox-row"><input type="checkbox" checked={paymentDetails.savePayment} onChange={(e) => updatePaymentDetail('savePayment', e.target.checked)} />Save this card for faster checkout next time.</label>
                  </>
                )}
                {paymentMethod === 'Cash On Delivery' && (
                  <>
                    <label>Person paying on delivery<input placeholder="Receiver name" value={paymentDetails.codReceiver} onChange={(e) => updatePaymentDetail('codReceiver', e.target.value)} /></label>
                    <label>Contact number<input placeholder="10 digit mobile number" value={paymentDetails.codPhone} onChange={(e) => updatePaymentDetail('codPhone', e.target.value)} {...mobileInputProps} /></label>
                    <label className="checkbox-row"><input type="checkbox" checked={paymentDetails.codConfirmed} onChange={(e) => updatePaymentDetail('codConfirmed', e.target.checked)} />I will pay the full order amount when the dress is delivered.</label>
                  </>
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="checkout-panel buy-now-summary">
          <h2>Order summary</h2>
          {(items.length ? items : item ? [item] : []).map((checkoutItem) => (
            <div className="buy-now-product" key={`${checkoutItem.product_id}-${checkoutItem.selected_size || checkoutItem.size || ''}`}>
              <img src={checkoutItem.image} alt={checkoutItem.name} />
              <div>
                <strong>{checkoutItem.name}</strong>
                <span>{checkoutItem.brand} / Qty {checkoutItem.quantity || quantity}</span>
                <span>{checkoutItem.selected_size || checkoutItem.size || size}</span>
                <span>Rs.{formatMoney(checkoutItem.price || checkoutItem.effectivePrice)} each / Rs.{formatMoney(checkoutItem.line_total || Number(checkoutItem.price || checkoutItem.effectivePrice || 0) * Number(checkoutItem.quantity || quantity))}</span>
                {checkoutItem.isOnSale && <span className="sale-limit-text">Summer Sale limit applied</span>}
              </div>
            </div>
          ))}
          <UserCoupons
            cartTotal={Number(summary?.productPrice || 0) - Number(summary?.discountAmount || 0) + Number(summary?.couponDiscountAmount || 0)}
            appliedCoupon={appliedCoupon}
            appliedDiscount={summary?.couponDiscountAmount}
            onApply={applyCoupon}
            onRemove={removeCoupon}
          />
          <SuperCoinApplyBox
            orderAmount={Number(summary?.totalBeforeCoins || summary?.total || 0)}
            appliedCoins={summary?.superCoinsRedeemed || appliedSuperCoins}
            appliedDiscount={summary?.superCoinDiscount}
            coinsToEarn={summary?.coinsToEarn}
            onApplied={applySuperCoinDiscount}
          />
          <div className="summary-line"><span>Product price</span><strong>Rs.{formatMoney(summary?.productPrice)}</strong></div>
          <div className="summary-line discount"><span>Discount ({formatPercent(summary?.discountPercent)}%)</span><strong>-Rs.{formatMoney(summary?.discountAmount)}</strong></div>
          {Number(summary?.couponDiscountAmount || 0) > 0 && (
            <div className="summary-line discount"><span>Coupon {summary?.couponCode}</span><strong>-Rs.{formatMoney(summary?.couponDiscountAmount)}</strong></div>
          )}
          {Number(summary?.superCoinDiscount || 0) > 0 && (
            <div className="summary-line discount"><span>Super Coins</span><strong>-Rs.{formatMoney(summary?.superCoinDiscount)}</strong></div>
          )}
          <div className="summary-line"><span>Subtotal</span><strong>Rs.{formatMoney(summary?.priceAfterDiscount)}</strong></div>
          <div className="summary-line"><span>Tax</span><strong>Rs.{formatMoney(summary?.tax)}</strong></div>
          <div className="summary-line"><span>Delivery</span><strong>{summary?.deliveryCharge > 0 ? `Rs.${formatMoney(summary.deliveryCharge)}` : 'FREE'}</strong></div>
          {paymentMethod === 'Cash On Delivery' && <div className="summary-line"><span>Cash on delivery charge</span><strong>Rs.{formatMoney(CASH_ON_DELIVERY_CHARGE)}</strong></div>}
          {Number(summary?.coinsToEarn || 0) > 0 && <div className="summary-line"><span>You will earn</span><strong>{summary.coinsToEarn} coins</strong></div>}
          <div className="summary-line total"><span>Total</span><strong>Rs.{formatMoney(payableTotal)}</strong></div>
          <button className="btn btn-dark w-100" disabled={step !== 'payment'} onClick={placeOrder}>Pay Rs.{formatMoney(payableTotal)}</button>
          <button className="continue-shop-btn" type="button" onClick={() => navigate('/')}>Continue To Shop</button>
        </aside>
      </section>
    </main>
  );
}
