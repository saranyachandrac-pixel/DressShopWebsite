import axios from 'axios';
import { useMemo, useState } from 'react';
import { Check, Loader2, PackageCheck, ShieldCheck, Truck } from 'lucide-react';

const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function formatDate(value) {
  if (!value) return 'To be updated';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusText(value) {
  return String(value || '').replace(/_/g, ' ');
}

function trackingEventsFor(order) {
  return order?.tracking_events || [];
}

function canShowReturn(item) {
  const itemStatus = String(item.itemStatus || '').toUpperCase();
  const requestStatus = String(item.requestStatus || '').toUpperCase();
  const refundStatus = String(item.postDeliveryRefundStatus || '').toUpperCase();
  return Boolean(item.canReturn)
    && !['CANCELLED', 'RETURNED', 'REFUNDED'].includes(itemStatus)
    && !['PENDING', 'APPROVED', 'RETURN_PICKED_UP', 'RETURN_COMPLETED', 'REFUNDED'].includes(requestStatus)
    && !['PROCESSING', 'COMPLETED', 'REFUNDED'].includes(refundStatus);
}

function TrackingTimeline({ events = [] }) {
  return (
    <div className="order-tracking-timeline">
      {events.map((event) => (
        <div className={`order-tracking-event ${event.status}`} key={`${event.type}-${event.title}`}>
          <span className="order-tracking-dot" />
          <div>
            <div className="order-tracking-title-row">
              <strong>{event.title}</strong>
              {(event.date_time || event.event_date) && <small>{formatDateTime(event.date_time || event.event_date)}</small>}
            </div>
            {event.description && <p>{event.description}</p>}
            {event.refund && (event.refund.amount || event.refund.paymentMethod || event.refund.transactionId || event.refund.completedAt) && (
              <div className="refund-detail-grid">
                {event.refund.amount != null && <span>Refund amount: Rs.{formatMoney(event.refund.amount)}</span>}
                {event.refund.paymentMethod && <span>Method: {event.refund.paymentMethod}</span>}
                {event.refund.transactionId && <span>Transaction ID: {event.refund.transactionId}</span>}
                {event.refund.completedAt && <span>Completed: {formatDateTime(event.refund.completedAt)}</span>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GuestTrackOrder() {
  const [step, setStep] = useState('request');
  const [form, setForm] = useState({ contact: '', otp: '' });
  const [trackingToken, setTrackingToken] = useState('');
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [devOtp, setDevOtp] = useState('');
  const [activeAction, setActiveAction] = useState(null);
  const [actionForm, setActionForm] = useState({ reason: '' });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ type: '', message: '' });

  const client = useMemo(() => axios.create({ baseURL: apiBaseUrl }), []);

  function updateField(event) {
    if (event.target.name === 'contact') {
      setDevOtp('');
      setForm((current) => ({ ...current, contact: event.target.value, otp: '' }));
      return;
    }
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function showToast(type, message) {
    setToast({ type, message });
  }

  async function sendOtp(event) {
    event.preventDefault();
    const contact = form.contact.trim();
    if (!contact) {
      showToast('error', 'Email ID or mobile number is required.');
      return;
    }
    setLoading(true);
    setToast({ type: '', message: '' });
    try {
      const { data } = await client.post('/guest-orders/send-otp', { contact });
      setDevOtp(data.devOtp || data.developmentOtp || '');
      showToast('success', data.message || 'OTP sent successfully.');
      setStep('verify');
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not send OTP.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();
    const contact = form.contact.trim();
    if (!contact) {
      showToast('error', 'Email ID or mobile number is required.');
      return;
    }
    setLoading(true);
    setToast({ type: '', message: '' });
    try {
      const { data } = await client.post('/guest-orders/verify-otp', {
        contact,
        otp: form.otp
      });
      setTrackingToken(data.token);
      await loadOrders(data.token);
      setStep('orders');
      showToast('success', 'Orders unlocked.');
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not verify OTP.');
    } finally {
      setLoading(false);
    }
  }

  async function loadOrders(token = trackingToken) {
    const { data } = await client.get('/guest-orders/my-orders', {
      headers: { Authorization: `Bearer ${token}` }
    });
    setOrders(data.orders || []);
  }

  async function viewTracking(orderNumber) {
    setLoading(true);
    setToast({ type: '', message: '' });
    try {
      const { data } = await client.get(`/guest-orders/track/${encodeURIComponent(orderNumber)}`, {
        headers: { Authorization: `Bearer ${trackingToken}` }
      });
      setSelectedOrder(data);
      setActiveAction(null);
      setActionForm({ reason: '' });
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not load tracking details.');
    } finally {
      setLoading(false);
    }
  }

  function beginAction(type, item) {
    setActiveAction({ type, itemId: item.orderItemId });
    setActionForm({ reason: '' });
  }

  async function submitItemAction(event) {
    event.preventDefault();
    if (!selectedOrder || !activeAction) return;
    setLoading(true);
    setToast({ type: '', message: '' });
    try {
      const base = `/guest-orders/track/${encodeURIComponent(selectedOrder.orderNumber)}/items/${activeAction.itemId}`;
      if (activeAction.type === 'cancel') {
        await client.post(`${base}/cancel`, { reason: actionForm.reason }, { headers: { Authorization: `Bearer ${trackingToken}` } });
        showToast('success', 'Item cancelled successfully.');
      }
      if (activeAction.type === 'return') {
        await client.post(`${base}/return`, { reason: actionForm.reason }, { headers: { Authorization: `Bearer ${trackingToken}` } });
        showToast('success', 'Return request submitted.');
      }
      await viewTracking(selectedOrder.orderNumber);
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not save this action.');
    } finally {
      setLoading(false);
    }
  }

  const selectedTrackingEvents = trackingEventsFor(selectedOrder);
  const activeStep = selectedTrackingEvents?.find((item) => item.status === 'current')
    || selectedTrackingEvents?.filter((item) => item.status === 'completed').at(-1)
    || selectedOrder?.timeline?.find((item) => item.state === 'current')
    || selectedOrder?.timeline?.filter((item) => item.state === 'completed').at(-1);

  return (
    <main className="guest-track-page">
      <section className="guest-track-shell">
        <div className="guest-track-intro">
          <p className="eyebrow">Secure order tracking</p>
          <h1>Track your orders</h1>
          <p>Verify the email ID or mobile number used at guest checkout to see your previous orders.</p>
        </div>

        <div className="guest-track-card">
          {toast.message && <div className={`guest-toast ${toast.type}`}>{toast.message}</div>}

          {step === 'request' && (
            <form className="stack-form" onSubmit={sendOtp}>
              <div className="guest-track-card-head">
                <PackageCheck size={24} />
                <div>
                  <h2>Find your orders</h2>
                  <p>We will send a one-time password before showing order history.</p>
                </div>
              </div>
              <label>
                Email ID / Mobile Number
                <input name="contact" value={form.contact} onChange={updateField} placeholder="name@email.com or 9876543210" required />
              </label>
              <button className="continue-shop-btn" type="submit" disabled={loading}>
                {loading ? <Loader2 className="spin-icon" size={18} /> : <ShieldCheck size={18} />}
                Send OTP
              </button>
            </form>
          )}

          {step === 'verify' && (
            <form className="stack-form" onSubmit={verifyOtp}>
              <div className="guest-track-card-head">
                <ShieldCheck size={24} />
                <div>
                  <h2>Verify OTP</h2>
                  <p>OTP expires in 5 minutes. Maximum 5 wrong attempts are allowed.</p>
                </div>
              </div>
              <label>
                6 digit OTP
                <input name="otp" value={form.otp} onChange={updateField} inputMode="numeric" maxLength="6" placeholder="123456" required />
              </label>
              {devOtp && <p className="dev-otp">Development OTP: {devOtp}</p>}
              <button className="continue-shop-btn" type="submit" disabled={loading}>
                {loading ? <Loader2 className="spin-icon" size={18} /> : <Check size={18} />}
                Verify OTP
              </button>
              <button className="link-button" type="button" onClick={() => setStep('request')}>Change contact</button>
            </form>
          )}

          {step === 'orders' && (
            <div className="guest-orders-panel">
              <div className="guest-track-card-head">
                <PackageCheck size={24} />
                <div>
                  <h2>Your guest orders</h2>
                  <p>{orders.length} order{orders.length === 1 ? '' : 's'} found for this contact.</p>
                </div>
              </div>

              <div className="guest-order-list">
                {orders.map((order) => (
                  <article className="guest-order-card" key={order.orderNumber}>
                    <div>
                      <span>Order Number</span>
                      <strong>{order.orderNumber}</strong>
                    </div>
                    <div>
                      <span>Order Date</span>
                      <strong>{formatDate(order.orderDate)}</strong>
                    </div>
                    <div>
                      <span>Total Paid</span>
                      <strong>Rs.{formatMoney(order.totalPaid)}</strong>
                    </div>
                    <div>
                      <span>Payment</span>
                      <strong>{statusText(order.paymentStatus)}</strong>
                    </div>
                    <div>
                      <span>Delivery</span>
                      <strong>{statusText(order.deliveryStatus)}</strong>
                    </div>
                    <div>
                      <span>Expected Delivery</span>
                      <strong>{formatDate(order.expectedDeliveryDate)}</strong>
                    </div>
                    <button className="btn btn-dark" type="button" disabled={loading} onClick={() => viewTracking(order.orderNumber)}>
                      View Tracking
                    </button>
                  </article>
                ))}
              </div>

              {!orders.length && <p className="helper-text">No guest orders found for this verified contact.</p>}
            </div>
          )}

          {selectedOrder && (
            <div className="guest-tracking-result">
              <div className="guest-track-card-head">
                <Truck size={26} />
                <div>
                  <h2>{selectedOrder.orderNumber}</h2>
                  <p>{activeStep?.title || activeStep?.label || statusText(selectedOrder.deliveryStatus)}</p>
                </div>
              </div>

              <div className="guest-track-highlight">
                <span>Expected Delivery</span>
                <strong>{formatDate(selectedOrder.expectedDeliveryDate)}</strong>
              </div>

              <div className="guest-track-details">
                <div><span>Customer</span><strong>{selectedOrder.customerName}</strong></div>
                <div><span>Total Paid</span><strong>Rs.{formatMoney(selectedOrder.totalPaid)}</strong></div>
                <div><span>Payment</span><strong>{statusText(selectedOrder.paymentStatus)}</strong></div>
                <div><span>Delivery</span><strong>{statusText(selectedOrder.deliveryStatus)}</strong></div>
                <div><span>Delivery Hub</span><strong>{selectedOrder.deliveryHub || 'To be assigned'}</strong></div>
                <div><span>Courier Partner</span><strong>{selectedOrder.courierPartner || 'To be assigned'}</strong></div>
              </div>

              <section className="guest-tracked-products">
                <h3>Products</h3>
                {(selectedOrder.items || []).map((item) => (
                  <article className="guest-tracked-product-card" key={item.orderItemId}>
                    {item.image && <img src={item.image} alt={item.productName} />}
                    <div className="guest-tracked-product-main">
                      <strong>{item.productName}</strong>
                      {item.selectedSize && <small>Size: {item.selectedSize}</small>}
                      <div className="guest-product-meta">
                        <span className="qty-badge">Qty {item.quantity}</span>
                        <span>Each Rs.{formatMoney(item.eachAmount)}</span>
                        <span>Total Rs.{formatMoney(item.totalAmount)}</span>
                      </div>
                      {item.cancelReason && <p className="helper-text">Cancelled: {item.cancelReason}</p>}
                      {item.requestStatus && <p className="helper-text">{item.requestType}: {item.requestStatus}</p>}
                      <div className="guest-product-actions">
                        {item.canCancel && <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => beginAction('cancel', item)}>Cancel</button>}
                        {canShowReturn(item) && <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => beginAction('return', item)}>Return</button>}
                      </div>
                      {activeAction?.itemId === item.orderItemId && (
                        <form className="guest-item-action-form" onSubmit={submitItemAction}>
                          <label>
                            Reason
                            <textarea value={actionForm.reason} onChange={(event) => setActionForm({ ...actionForm, reason: event.target.value })} required />
                          </label>
                          <div className="guest-product-actions">
                            <button className="btn btn-dark btn-sm" type="submit" disabled={loading}>Save</button>
                            <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => setActiveAction(null)}>Close</button>
                          </div>
                        </form>
                      )}
                    </div>
                  </article>
                ))}
              </section>

              <TrackingTimeline events={selectedTrackingEvents} />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
