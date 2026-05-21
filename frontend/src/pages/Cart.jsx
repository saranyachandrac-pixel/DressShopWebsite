import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { getSavedPincode, savePincode } from '../hooks/useDeliveryDate';
import UserCoupons from '../components/UserCoupons';

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
const formatMoney = (value) => Number(value || 0).toFixed(2);
const formatPercent = (value) => Number(value || 0).toFixed(2);
const clampDiscountPercent = (value) => Math.min(Math.max(Number(value) || 0, 0), 100);
const digitsOnly = (value) => value.replace(/\D/g, '');
const CASH_ON_DELIVERY_CHARGE = 60;
const COUPON_STORAGE_KEY = 'dress_shop_coupon_code';
const MOBILE_NUMBER_LENGTH = 10;
const mobilePaymentFields = new Set(['upiPhone', 'billingPhone', 'codPhone']);
const normalizeMobileNumber = (value) => digitsOnly(value).slice(0, MOBILE_NUMBER_LENGTH);
const isValidMobileNumber = (value) => normalizeMobileNumber(value).length === MOBILE_NUMBER_LENGTH;
const mobileInputProps = {
  inputMode: 'numeric',
  maxLength: MOBILE_NUMBER_LENGTH,
  pattern: '\\d{10}'
};

function getCartItemTotals(item) {
  if (item.line_total != null) {
    return {
      discountPercent: item.discount_percent,
      discountAmount: item.discount_amount,
      lineTotal: item.line_total
    };
  }
  const price = Number(item.price) || 0;
  const quantity = Number(item.quantity) || 0;
  const discountPercent = clampDiscountPercent(item.product_discount ?? item.discount ?? item.discount_percent);
  const linePrice = price * quantity;
  const discountAmount = linePrice * discountPercent / 100;
  const lineTotal = linePrice - discountAmount;

  return { discountPercent, discountAmount, lineTotal };
}

export default function Cart() {
  const [items, setItems] = useState([]);
  const [previousMonth, setPreviousMonth] = useState({ month: '', items: [] });
  const [previousSelections, setPreviousSelections] = useState({});
  const [previousLoading, setPreviousLoading] = useState(true);
  const [addresses, setAddresses] = useState([]);
  const [address, setAddress] = useState(blankAddress);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [summary, setSummary] = useState({ productPrice: 0, discountAmount: 0, discountPercent: 0, priceAfterDiscount: 0, tax: 0, deliveryCharge: 0, total: 0 });
  const [couponCode, setCouponCode] = useState(() => localStorage.getItem(COUPON_STORAGE_KEY) || '');
  const [appliedCoupon, setAppliedCoupon] = useState(() => localStorage.getItem(COUPON_STORAGE_KEY) || '');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [paymentDetails, setPaymentDetails] = useState(blankPaymentDetails);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [deliveryInfo, setDeliveryInfo] = useState({ loading: false, error: '', date: '', codAvailable: true, pincode: '' });
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const { refreshCartCount } = useAuth();
  const cashOnDeliveryCharge = paymentMethod === 'Cash On Delivery' && Number(summary.priceAfterDiscount || 0) > 0 ? CASH_ON_DELIVERY_CHARGE : 0;
  const payableTotal = Number(summary.total || 0) + cashOnDeliveryCharge;

  useEffect(() => { refresh(); }, []);
  useEffect(() => { loadPreviousMonthItems(); }, []);
  useEffect(() => {
    checkCartDelivery();
  }, [selectedAddress, items.length]);

  function previousItemKey(item) {
    return `${item.product_id}:${item.selected_size || ''}`;
  }

  async function refresh() {
    const [cartRes, addressRes, summaryRes] = await Promise.all([
      api.get('/cart'),
      api.get('/addresses'),
      api.get('/orders/summary', { params: { couponCode: appliedCoupon } })
    ]);
    setItems(cartRes.data.items);
    setAddresses(addressRes.data);
    setSummary(summaryRes.data);
    if (addressRes.data[0]) setSelectedAddress(String(addressRes.data[0].id));
    try {
      const { data } = await api.get('/payment-methods');
      setSavedPaymentMethods(data);
    } catch (error) {
      setSavedPaymentMethods([]);
    }
    try {
      const { data } = await api.get('/wallet/balance');
      setWallet(data.wallet);
    } catch (error) {
      setWallet(null);
    }
  }

  async function loadPreviousMonthItems() {
    setPreviousLoading(true);
    try {
      const { data } = await api.get('/orders/previous-month-items');
      setPreviousMonth({ month: data.month || 'last month', items: data.items || [] });
      const defaults = {};
      (data.items || []).forEach((item) => {
        const key = previousItemKey(item);
        defaults[key] = { checked: false, quantity: Math.max(1, Number(item.ordered_quantity || 1)) };
      });
      setPreviousSelections(defaults);
    } catch (error) {
      setPreviousMonth({ month: 'last month', items: [] });
    } finally {
      setPreviousLoading(false);
    }
  }

  function togglePreviousItem(item, checked) {
    const key = previousItemKey(item);
    setPreviousSelections((current) => ({
      ...current,
      [key]: {
        checked,
        quantity: current[key]?.quantity || Math.max(1, Number(item.ordered_quantity || 1))
      }
    }));
  }

  function updatePreviousQuantity(item, quantity) {
    const key = previousItemKey(item);
    setPreviousSelections((current) => ({
      ...current,
      [key]: {
        checked: current[key]?.checked || false,
        quantity: Math.max(1, Number(quantity) || 1)
      }
    }));
  }

  async function addPreviousItemsToCart() {
    const selectedItems = previousMonth.items
      .filter((item) => previousSelections[previousItemKey(item)]?.checked)
      .map((item) => ({
        productId: item.product_id,
        quantity: previousSelections[previousItemKey(item)]?.quantity || 1,
        size: item.selected_size || ''
      }));

    if (!selectedItems.length) {
      setMessage('Select at least one previous month item.');
      return;
    }

    try {
      const { data } = await api.post('/cart/add-multiple', { items: selectedItems });
      setMessage(data.message || 'Previous month items added to cart.');
      await Promise.all([refresh(), refreshCartCount()]);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not add previous month items.');
    }
  }

  async function checkCartDelivery() {
    const selectedAddressDetails = addresses.find((x) => String(x.id) === String(selectedAddress));
    const pincode = selectedAddressDetails?.pincode || getSavedPincode();
    if (!items.length || !pincode) return;

    setDeliveryInfo((current) => ({ ...current, loading: true, error: '', pincode }));
    try {
      const checks = await Promise.all(items.map((item) => api.post('/delivery/check', {
        pincode,
        productId: item.product_id,
        qty: item.quantity
      }).then((res) => ({ item, delivery: res.data }))));

      const unavailable = checks.find((x) => !x.delivery.available);
      if (unavailable) {
        setDeliveryInfo({
          loading: false,
          error: `${unavailable.item.name} is not serviceable to ${pincode}. Remove it or change pincode.`,
          date: '',
          codAvailable: false,
          pincode
        });
        return;
      }

      savePincode(pincode);
      const longest = checks.map((x) => x.delivery).sort((a, b) => new Date(b.deliveryDate) - new Date(a.deliveryDate))[0];
      setDeliveryInfo({
        loading: false,
        error: '',
        date: longest.deliveryDate,
        codAvailable: checks.every((x) => x.delivery.codAvailable),
        pincode
      });
      if (paymentMethod === 'Cash On Delivery' && !checks.every((x) => x.delivery.codAvailable)) {
        setPaymentMethod('UPI');
      }
    } catch (error) {
      setDeliveryInfo({ loading: false, error: error.response?.data?.message || 'Could not check delivery.', date: '', codAvailable: false, pincode });
    }
  }

  async function updateQty(item, quantity) {
    try {
      await api.put(`/cart/${item.id}`, { quantity });
      await Promise.all([refresh(), refreshCartCount()]);
    } catch (error) {
      alert(error.response?.data?.message || 'Stock validation failed.');
    }
  }

  async function updateSize(item, size) {
    try {
      await api.put(`/cart/${item.id}`, { quantity: item.quantity, size });
      refresh();
    } catch (error) {
      alert(error.response?.data?.message || 'Could not update size.');
    }
  }

  async function removeItem(id) {
    await api.delete(`/cart/${id}`);
    await Promise.all([refresh(), refreshCartCount()]);
  }

  async function applyCoupon(codeOverride = couponCode) {
    setMessage('');
    try {
      const code = String(codeOverride || '').trim().toUpperCase();
      const { data } = await api.get('/orders/summary', { params: { couponCode: code } });
      setSummary(data);
      setAppliedCoupon(data.couponCode || code);
      setCouponCode(data.couponCode || code);
      localStorage.setItem(COUPON_STORAGE_KEY, data.couponCode || code);
      setMessage(`${data.couponCode || code} applied.`);
    } catch (error) {
      setAppliedCoupon('');
      setMessage(error.response?.data?.message || 'Could not apply coupon.');
    }
  }

  async function removeCoupon() {
    setAppliedCoupon('');
    setCouponCode('');
    localStorage.removeItem(COUPON_STORAGE_KEY);
    const { data } = await api.get('/orders/summary');
    setSummary(data);
    setMessage('');
  }

  async function saveAddress(e) {
    e.preventDefault();
    if (!isValidMobileNumber(address.phone)) {
      setMessage('Mobile number must be exactly 10 digits.');
      return;
    }
    const { data } = await api.post('/addresses', address);
    setSelectedAddress(String(data.id));
    setAddress(blankAddress);
    refresh();
  }

  function updatePaymentDetail(field, value) {
    if (mobilePaymentFields.has(field)) {
      setPaymentDetails({ ...paymentDetails, [field]: normalizeMobileNumber(value) });
      return;
    }
    if (field === 'cardNumber') {
      const grouped = digitsOnly(value).slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
      setPaymentDetails({ ...paymentDetails, [field]: grouped });
      return;
    }
    if (field === 'cvv') {
      setPaymentDetails({ ...paymentDetails, [field]: digitsOnly(value).slice(0, 4) });
      return;
    }
    if (field === 'expiry') {
      const digits = digitsOnly(value).slice(0, 4);
      const formatted = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
      setPaymentDetails({ ...paymentDetails, [field]: formatted });
      return;
    }
    setPaymentDetails({ ...paymentDetails, [field]: value });
  }

  function useSavedPayment(methodId) {
    const method = savedPaymentMethods.find((x) => String(x.id) === String(methodId));
    if (!method) return;

    if (method.type === 'UPI') {
      setPaymentDetails({
        ...paymentDetails,
        upiName: method.details.accountHolder || '',
        upiId: method.details.upiId || '',
        upiPhone: method.details.phone || ''
      });
      return;
    }

    setPaymentDetails({
      ...paymentDetails,
      cardName: method.details.cardholder || '',
      cardNumber: '',
      expiry: method.details.expiry || '',
      billingPhone: method.details.billingPhone || ''
    });
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
    if (!selectedAddress) return setMessage('Please select or add a delivery address.');
    if (deliveryInfo.error) return setMessage(deliveryInfo.error);
    const paymentError = validatePaymentDetails();
    if (paymentError) return setMessage(paymentError);
    try {
      const { data } = await api.post('/orders', { addressId: selectedAddress, paymentMethod, paymentDetails, couponCode: appliedCoupon });
      await refreshCartCount();
      navigate(`/orders/${data.id}`);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not place order.');
    }
  }

  return (
    <main className="split-page">
      <section>
        <p className="eyebrow">Cart list</p>
        <h1>Your bag</h1>
        {message && <div className="alert alert-warning">{message}</div>}
        <section className="previous-month-panel">
          <div className="section-title-row">
            <div>
              <h2>Buy again from last month</h2>
              <p className="helper-text">Previous Month Items {previousMonth.month ? `/ ${previousMonth.month}` : ''}</p>
            </div>
            <button className="btn btn-dark btn-sm" type="button" disabled={previousLoading || !previousMonth.items.length} onClick={addPreviousItemsToCart}>
              Add selected to cart
            </button>
          </div>
          {previousLoading && <p className="helper-text">Loading previous month items...</p>}
          {!previousLoading && !previousMonth.items.length && <p className="helper-text">No previous month ordered products found.</p>}
          {!previousLoading && !!previousMonth.items.length && (
            <div className="previous-month-list">
              {previousMonth.items.map((item) => {
                const key = previousItemKey(item);
                const selection = previousSelections[key] || {};
                return (
                  <label className={selection.checked ? 'previous-month-item selected' : 'previous-month-item'} key={key}>
                    <input type="checkbox" checked={!!selection.checked} onChange={(e) => togglePreviousItem(item, e.target.checked)} />
                    <img src={item.image} alt={item.name} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.brand} {item.selected_size ? `/ Size ${item.selected_size}` : ''}</small>
                      <small>Last ordered: {item.last_order_number || 'Previous month'}</small>
                    </span>
                    <b>Rs.{formatMoney(item.price)}</b>
                    <div className="previous-qty-control">
                      <button type="button" onClick={(e) => { e.preventDefault(); updatePreviousQuantity(item, (selection.quantity || 1) - 1); }}>-</button>
                      <input
                        type="number"
                        min="1"
                        value={selection.quantity || 1}
                        onChange={(e) => updatePreviousQuantity(item, e.target.value)}
                      />
                      <button type="button" onClick={(e) => { e.preventDefault(); updatePreviousQuantity(item, (selection.quantity || 1) + 1); }}>+</button>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>
        {!items.length && <p>Your cart is empty.</p>}
        {items.map((item) => {
          const { discountPercent, discountAmount, lineTotal } = getCartItemTotals(item);

          return (
            <div className="cart-item" key={item.id}>
              <img src={item.image} alt={item.name} />
              <div>
                <h3>{item.name}</h3>
                <p>{item.brand} / Stock {item.stock}{item.selected_color ? ` / ${item.selected_color}` : ''}</p>
                <div className="cart-item-size">
                  <label>{String(item.category || '').toLowerCase().includes('kids') ? 'Year:' : 'Size:'}</label>
                  <select value={item.selected_size || ''} onChange={(e) => updateSize(item, e.target.value)}>
                    <option value="">{String(item.category || '').toLowerCase().includes('kids') ? 'Select year' : 'Select size'}</option>
                    {(String(item.category || '').toLowerCase().includes('kids') ? ['1-2Y', '3-4Y', '5-6Y', '7-8Y', '9-10Y', '11-12Y'] : ['M', 'L', 'XL', 'XXL']).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <p className="cart-item-price">₹{formatMoney(item.price)} each</p>
                <p className="cart-item-discount">
                  Discount: {formatPercent(discountPercent)}% off (-₹{formatMoney(discountAmount)})
                </p>
                <strong className="cart-item-total">Item total: ₹{formatMoney(lineTotal)}</strong>
              </div>
              {item.isOnSale && (
                <p className="cart-item-discount">
                  Summer Sale limit: 1 qty per customer{item.bogoFreeQuantity ? ` / Buy 1 Get ${item.bogoFreeQuantity} free` : ''}
                </p>
              )}
              <div className="qty-box">
                <button onClick={() => updateQty(item, item.quantity - 1)} disabled={item.quantity <= 1}>-</button>
                <span>{item.quantity}</span>
                <button onClick={() => updateQty(item, item.quantity + 1)} disabled={item.isOnSale}>+</button>
                <button className="link-button" onClick={() => removeItem(item.id)}>Remove</button>
              </div>
            </div>
          );
        })}
      </section>

      <aside className="checkout-panel">
        <h2>Delivery location</h2>
        <select value={selectedAddress} onChange={(e) => setSelectedAddress(e.target.value)}>
          <option value="">Select existing address</option>
          {addresses.map((x) => <option value={x.id} key={x.id}>{x.full_name}, {x.city} - {x.pincode}</option>)}
        </select>
        <form className="stack-form compact" onSubmit={saveAddress}>
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
          <button className="btn btn-outline-dark btn-sm">Add address</button>
        </form>
        {deliveryInfo.loading && <p className="helper-text">Checking delivery for all items...</p>}
        {deliveryInfo.date && (
          <div className="delivery-summary">
            Delivery by {new Date(deliveryInfo.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} for all items
          </div>
        )}
        {deliveryInfo.error && <div className="alert alert-warning">{deliveryInfo.error}</div>}

        <h2>Payment</h2>
        <p className="helper-text">Choose how you want to pay, then fill in the details shown below.</p>
        <select value={paymentMethod} onChange={(e) => {
          setPaymentMethod(e.target.value);
          setPaymentDetails({ ...blankPaymentDetails });
          setMessage('');
        }}>
          {['UPI', 'Credit Card', 'Debit Card', 'Wallet', ...(deliveryInfo.codAvailable ? ['Cash On Delivery'] : [])].map((x) => <option key={x} value={x}>{x === 'Wallet' ? 'Pay Using Wallet' : x}</option>)}
        </select>
        {!deliveryInfo.codAvailable && deliveryInfo.pincode && <p className="helper-text">Cash On Delivery is not available for {deliveryInfo.pincode}.</p>}
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
                <label>
                  Use saved UPI
                  <select defaultValue="" onChange={(e) => useSavedPayment(e.target.value)}>
                    <option value="">Choose saved UPI</option>
                    {savedPaymentMethods.filter((method) => method.type === 'UPI').map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}
                  </select>
                </label>
              )}
              <label>
                Account holder name
                <input placeholder="Name linked with UPI" value={paymentDetails.upiName} onChange={(e) => updatePaymentDetail('upiName', e.target.value)} />
              </label>
              <label>
                UPI ID
                <input placeholder="example@bank" value={paymentDetails.upiId} onChange={(e) => updatePaymentDetail('upiId', e.target.value)} />
              </label>
              <label>
                UPI mobile number
                <input placeholder="10 digit mobile number" value={paymentDetails.upiPhone} onChange={(e) => updatePaymentDetail('upiPhone', e.target.value)} {...mobileInputProps} />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={paymentDetails.savePayment} onChange={(e) => updatePaymentDetail('savePayment', e.target.checked)} />
                Save this UPI for faster checkout next time.
              </label>
            </>
          )}
          {(paymentMethod === 'Credit Card' || paymentMethod === 'Debit Card') && (
            <>
              {savedPaymentMethods.some((method) => method.type === 'Card') && (
                <label>
                  Use saved card
                  <select defaultValue="" onChange={(e) => useSavedPayment(e.target.value)}>
                    <option value="">Choose saved card</option>
                    {savedPaymentMethods.filter((method) => method.type === 'Card').map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}
                  </select>
                </label>
              )}
              <label>
                Name on card
                <input placeholder="As printed on card" value={paymentDetails.cardName} onChange={(e) => updatePaymentDetail('cardName', e.target.value)} />
              </label>
              <label>
                Card number
                <input inputMode="numeric" placeholder="1234 5678 9012 3456" value={paymentDetails.cardNumber} onChange={(e) => updatePaymentDetail('cardNumber', e.target.value)} />
              </label>
              <div className="payment-row">
                <label>
                  Expiry
                  <input inputMode="numeric" placeholder="MM/YY" value={paymentDetails.expiry} onChange={(e) => updatePaymentDetail('expiry', e.target.value)} />
                </label>
                <label>
                  CVV
                  <input inputMode="numeric" type="password" placeholder="3 digits" value={paymentDetails.cvv} onChange={(e) => updatePaymentDetail('cvv', e.target.value)} />
                </label>
              </div>
              <label>
                Billing phone number
                <input placeholder="10 digit mobile number" value={paymentDetails.billingPhone} onChange={(e) => updatePaymentDetail('billingPhone', e.target.value)} {...mobileInputProps} />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={paymentDetails.savePayment} onChange={(e) => updatePaymentDetail('savePayment', e.target.checked)} />
                Save this card for faster checkout next time.
              </label>
              <p className="helper-text">For safety, the order will store only the card type, holder name, expiry, and last four digits.</p>
            </>
          )}
          {paymentMethod === 'Cash On Delivery' && (
            <>
              <label>
                Person paying on delivery
                <input placeholder="Receiver name" value={paymentDetails.codReceiver} onChange={(e) => updatePaymentDetail('codReceiver', e.target.value)} />
              </label>
              <label>
                Contact number
                <input placeholder="10 digit mobile number" value={paymentDetails.codPhone} onChange={(e) => updatePaymentDetail('codPhone', e.target.value)} {...mobileInputProps} />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={paymentDetails.codConfirmed} onChange={(e) => updatePaymentDetail('codConfirmed', e.target.checked)} />
                I will pay the full order amount when the dress is delivered.
              </label>
            </>
          )}
        </div>

        <h2>Price summary</h2>
        <UserCoupons
          cartTotal={Number(summary.productPrice || 0) - Number(summary.discountAmount || 0) + Number(summary.couponDiscountAmount || 0)}
          appliedCoupon={appliedCoupon}
          appliedDiscount={summary.couponDiscountAmount}
          onApply={applyCoupon}
          onRemove={removeCoupon}
        />
        <div className="summary-line"><span>Product price</span><strong>₹{formatMoney(summary.productPrice)}</strong></div>
        <div className="summary-line discount"><span>Discount ({formatPercent(summary.discountPercent)}%)</span><strong>-₹{formatMoney(summary.discountAmount)}</strong></div>
        {Number(summary.couponDiscountAmount || 0) > 0 && (
          <div className="summary-line discount"><span>Coupon {summary.couponCode}</span><strong>-₹{formatMoney(summary.couponDiscountAmount)}</strong></div>
        )}
        <div className="summary-line"><span>Subtotal</span><strong>₹{formatMoney(summary.priceAfterDiscount)}</strong></div>
        <div className="summary-line"><span>Tax</span><strong>₹{formatMoney(summary.tax)}</strong></div>
        <div className="summary-line"><span>Delivery</span><strong>{summary.deliveryCharge > 0 ? `₹${formatMoney(summary.deliveryCharge)}` : 'FREE'}</strong></div>
        {paymentMethod === 'Cash On Delivery' && (
          <div className="summary-line"><span>Cash on delivery charge</span><strong>₹{formatMoney(cashOnDeliveryCharge)}</strong></div>
        )}
        <div className="summary-line total"><span>Total</span><strong>₹{formatMoney(payableTotal)}</strong></div>
        <button className="btn btn-dark w-100" disabled={!items.length} onClick={placeOrder}>Buy now</button>
      </aside>
    </main>
  );
}
