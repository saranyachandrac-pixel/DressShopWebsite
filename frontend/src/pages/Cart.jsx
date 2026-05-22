import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import UserCoupons from '../components/UserCoupons';

const formatMoney = (value) => Number(value || 0).toFixed(2);
const formatPercent = (value) => Number(value || 0).toFixed(2);
const clampDiscountPercent = (value) => Math.min(Math.max(Number(value) || 0, 0), 100);
const COUPON_STORAGE_KEY = 'dress_shop_coupon_code';

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
  const [summary, setSummary] = useState({ productPrice: 0, discountAmount: 0, discountPercent: 0, priceAfterDiscount: 0, tax: 0, deliveryCharge: 0, total: 0 });
  const [couponCode, setCouponCode] = useState(() => localStorage.getItem(COUPON_STORAGE_KEY) || '');
  const [appliedCoupon, setAppliedCoupon] = useState(() => localStorage.getItem(COUPON_STORAGE_KEY) || '');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const { refreshCartCount } = useAuth();

  useEffect(() => { refresh(); }, []);
  useEffect(() => { loadPreviousMonthItems(); }, []);

  function previousItemKey(item) {
    return `${item.product_id}:${item.selected_size || ''}`;
  }

  async function refresh() {
    const [cartRes, summaryRes] = await Promise.all([
      api.get('/cart'),
      api.get('/orders/summary', { params: { couponCode: appliedCoupon } })
    ]);
    setItems(cartRes.data.items);
    setSummary(summaryRes.data);
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

  function placeOrder() {
    if (!items.length) return;
    navigate('/checkout/cart', { state: { source: 'cart' } });
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
                <button onClick={() => updateQty(item, Number(item.quantity || 1) - 1)} disabled={Number(item.quantity || 1) <= 1}>-</button>
                <span>{Number(item.quantity || 1)}</span>
                <button onClick={() => updateQty(item, Number(item.quantity || 1) + 1)} disabled={item.isOnSale}>+</button>
                <button className="link-button" onClick={() => removeItem(item.id)}>Remove</button>
              </div>
            </div>
          );
        })}
      </section>

      <aside className="checkout-panel cart-summary-card">
        <h2>Order summary</h2>
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
        <div className="summary-line total"><span>Total amount</span><strong>₹{formatMoney(summary.total)}</strong></div>
        <button className="place-order-btn" disabled={!items.length} onClick={placeOrder}>Place Order</button>
      </aside>
    </main>
  );
}
