import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';

function getPaymentDetails(order) {
  if (!order.payment_details) return null;
  if (typeof order.payment_details === 'object') return order.payment_details;
  try {
    return JSON.parse(order.payment_details);
  } catch {
    return null;
  }
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB');
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function trackingEventsFor(order) {
  return order?.tracking_events || [];
}

function canShowReturn(item) {
  const itemStatus = String(item.item_status || '').toUpperCase();
  const requestStatus = String(item.request_status || '').toUpperCase();
  const refundStatus = String(item.post_delivery_refund_status || '').toUpperCase();
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

export default function OrderDetail() {
  const [order, setOrder] = useState(null);
  const [cancelItem, setCancelItem] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [postDeliveryItem, setPostDeliveryItem] = useState(null);
  const [postDeliveryForm, setPostDeliveryForm] = useState({ requestType: 'RETURN', reason: '' });
  const [reviewItem, setReviewItem] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 5, reviewText: '' });
  const [replacementEligibility, setReplacementEligibility] = useState({});
  const [message, setMessage] = useState('');
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => { loadOrder(); }, [id]);

  async function loadOrder() {
    const [{ data }, eligibilityRes] = await Promise.all([
      api.get(`/orders/${id}`),
      api.get(`/orders/${id}/replacement-eligibility`).catch(() => ({ data: { items: [] } }))
    ]);
    setOrder(data);
    setReplacementEligibility(Object.fromEntries((eligibilityRes.data.items || []).map((item) => [item.orderItemId, item])));
  }

  function canCancel(item) {
    return Boolean(item.canCancel);
  }

  function canPostDeliveryRequest(item) {
    return canShowReturn(item);
  }

  function canReplace(item) {
    return Boolean(item.canReplace);
  }

  function canReview(item) {
    return order.delivery_status === 'DELIVERED' && !item.review_id && String(item.item_status || 'ACTIVE') !== 'CANCELLED';
  }

  async function submitCancellation(e) {
    e.preventDefault();
    if (!cancelReason.trim()) return setMessage('Cancellation reason is required.');
    try {
      await api.post(`/cancellations/orders/${order.id}/items/${cancelItem.id}`, { reason: cancelReason });
      setMessage('Item cancelled successfully.');
      setCancelItem(null);
      setCancelReason('');
      await loadOrder();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not cancel item.');
    }
  }

  async function submitPostDeliveryRequest(e) {
    e.preventDefault();
    if (!postDeliveryForm.reason.trim()) return setMessage('Request reason is required.');
    try {
      const { data } = await api.post(`/post-delivery/orders/${order.id}/items/${postDeliveryItem.id}/request`, postDeliveryForm);
      setMessage(data.message || 'Request submitted successfully.');
      setPostDeliveryItem(null);
      setPostDeliveryForm({ requestType: 'RETURN', reason: '' });
      await loadOrder();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not submit request.');
    }
  }

  async function submitReview(e) {
    e.preventDefault();
    try {
      const { data } = await api.post(`/post-delivery/orders/${order.id}/items/${reviewItem.id}/review`, reviewForm);
      setMessage(data.message || 'Review submitted successfully.');
      setReviewItem(null);
      setReviewForm({ rating: 5, reviewText: '' });
      await loadOrder();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not submit review.');
    }
  }

  if (!order) return <main>Loading...</main>;
  const paymentDetails = getPaymentDetails(order);
  const isDelivered = String(order.delivery_status || '').toUpperCase() === 'DELIVERED';
  const superCoinEligibleAt = order.superCoinEligibleAt || order.super_coin_eligible_at;
  const superCoinAwarded = Boolean(order.superCoinAwarded || order.super_coin_awarded);

  return (
    <main className="split-page">
      <section>
        {message && <div className="alert alert-info">{message}</div>}
        <p className="eyebrow">Tracking status</p>
        <h1>{order.order_number}</h1>
        <TrackingTimeline events={trackingEventsFor(order)} />
        {order.items.map((item) => (
          <div className="cart-item" key={item.id}>
            <img src={item.image} alt={item.product_name} />
            <div>
              <h3>{item.product_name}</h3>
              <p>Qty {item.quantity}</p>
              <p>Status: {item.item_status || 'ACTIVE'}</p>
              {item.cancel_reason && <p className="helper-text">Cancel reason: {item.cancel_reason} / Refund: {item.refund_status}</p>}
              {item.post_delivery_request_id && (
                <p className="helper-text">
                  {item.request_type} request: {item.request_status} / Refund: {item.post_delivery_refund_status}
                </p>
              )}
              {item.review_id && <p className="helper-text">Your rating: {'★'.repeat(Number(item.rating || 0))} {item.review_text}</p>}
              {replacementEligibility[item.id] && (
                <p className={replacementEligibility[item.id].allowed ? 'replacement-valid-text' : 'helper-text'}>
                  {replacementEligibility[item.id].allowed
                    ? `Replacement valid until ${new Date(replacementEligibility[item.id].replacementLastDate).toLocaleDateString('en-GB')}`
                    : replacementEligibility[item.id].message}
                </p>
              )}
              {item.canReturn && item.returnWindowEndsAt && <p className="helper-text">Return valid until {formatDate(item.returnWindowEndsAt)}</p>}
              {item.canReplace && item.replacementWindowEndsAt && <p className="helper-text">Replacement valid until {formatDate(item.replacementWindowEndsAt)}</p>}
              <strong>Rs.{Number(item.price).toFixed(2)}</strong>
            </div>
            {canCancel(item) && (
              <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => setCancelItem(item)}>
                Cancel item
              </button>
            )}
            {canPostDeliveryRequest(item) && (
              <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => setPostDeliveryItem(item)}>
                Return
              </button>
            )}
            {canReplace(item) && (
              <button className="btn btn-dark btn-sm" type="button" onClick={() => {
                setPostDeliveryItem(item);
                setPostDeliveryForm({ requestType: 'REPLACEMENT', reason: '' });
              }}>
                Replace
              </button>
            )}
            {canReview(item) && (
              <button className="btn btn-dark btn-sm" type="button" onClick={() => setReviewItem(item)}>
                Rate product
              </button>
            )}
          </div>
        ))}
      </section>
      <aside className="checkout-panel">
        <h2>Address</h2>
        <p>{order.full_name}</p><p>{order.phone}</p><p>{order.line1} {order.line2}</p><p>{order.city}, {order.state} - {order.pincode}</p>
        <h2>Payment</h2>
        <p>{order.payment_method} / {order.paid_status}</p>
        {paymentDetails && (
          <div className="payment-summary">
            {order.payment_method === 'UPI' && (
              <>
                <p><strong>Account holder:</strong> {paymentDetails.accountHolder}</p>
                <p><strong>UPI ID:</strong> {paymentDetails.upiId}</p>
                <p><strong>Mobile:</strong> {paymentDetails.phone}</p>
              </>
            )}
            {(order.payment_method === 'Credit Card' || order.payment_method === 'Debit Card') && (
              <>
                <p><strong>Cardholder:</strong> {paymentDetails.cardholder}</p>
                <p><strong>Card:</strong> **** **** **** {paymentDetails.lastFour}</p>
                <p><strong>Expiry:</strong> {paymentDetails.expiry}</p>
                <p><strong>Billing phone:</strong> {paymentDetails.billingPhone}</p>
              </>
            )}
            {order.payment_method === 'Cash On Delivery' && (
              <>
                <p><strong>Paying on delivery:</strong> {paymentDetails.receiver}</p>
                <p><strong>Contact:</strong> {paymentDetails.phone}</p>
                {Number(paymentDetails.cashOnDeliveryCharge || 0) > 0 && (
                  <p><strong>Cash on delivery charge:</strong> Rs.{Number(paymentDetails.cashOnDeliveryCharge).toFixed(2)}</p>
                )}
              </>
            )}
          </div>
        )}
        <h2>Total</h2>
        <strong className="big-price">Rs.{Number(order.total_amount).toFixed(2)}</strong>
        {isDelivered && (
          <div className="alert alert-info">
            {superCoinAwarded
              ? 'Super Coins credited after delivery.'
              : superCoinEligibleAt
                ? `Super Coins will be credited after replacement period ends on ${formatDate(superCoinEligibleAt)}.`
                : 'Super Coins credited after delivery.'}
          </div>
        )}
        <button className="continue-shop-btn" type="button" onClick={() => navigate('/')}>Continue To Shop</button>
      </aside>
      {cancelItem && (
        <div className="size-modal-overlay" onClick={() => setCancelItem(null)}>
          <form className="login-prompt-modal stack-form" onSubmit={submitCancellation} onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">Cancel item</p>
            <h2>{cancelItem.product_name}</h2>
            <label>
              Cancellation reason
              <textarea
                className="csv-box"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Tell us why you want to cancel this item"
                required
              />
            </label>
            <div className="modal-actions">
              <button className="btn btn-outline-dark" type="button" onClick={() => setCancelItem(null)}>Close</button>
              <button className="btn btn-dark" type="submit">Submit cancellation</button>
            </div>
          </form>
        </div>
      )}
      {postDeliveryItem && (
        <div className="size-modal-overlay" onClick={() => setPostDeliveryItem(null)}>
          <form className="login-prompt-modal stack-form" onSubmit={submitPostDeliveryRequest} onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">After delivery</p>
            <h2>{postDeliveryItem.product_name}</h2>
            <label>
              Request type
              <select value={postDeliveryForm.requestType} onChange={(e) => setPostDeliveryForm({ ...postDeliveryForm, requestType: e.target.value })}>
                {postDeliveryItem.canReturn && <option value="RETURN">Return</option>}
                {postDeliveryItem.canReplace && <option value="REPLACEMENT">Replacement</option>}
              </select>
            </label>
            <label>
              Reason
              <textarea className="csv-box" value={postDeliveryForm.reason} onChange={(e) => setPostDeliveryForm({ ...postDeliveryForm, reason: e.target.value })} required />
            </label>
            <div className="modal-actions">
              <button className="btn btn-outline-dark" type="button" onClick={() => setPostDeliveryItem(null)}>Close</button>
              <button className="btn btn-dark" type="submit">Submit request</button>
            </div>
          </form>
        </div>
      )}
      {reviewItem && (
        <div className="size-modal-overlay" onClick={() => setReviewItem(null)}>
          <form className="login-prompt-modal stack-form" onSubmit={submitReview} onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">Product rating</p>
            <h2>{reviewItem.product_name}</h2>
            <label>
              Rating
              <select value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: Number(e.target.value) })}>
                {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} star{rating > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <label>
              Review
              <textarea className="csv-box" value={reviewForm.reviewText} onChange={(e) => setReviewForm({ ...reviewForm, reviewText: e.target.value })} placeholder="Write your review" />
            </label>
            <div className="modal-actions">
              <button className="btn btn-outline-dark" type="button" onClick={() => setReviewItem(null)}>Close</button>
              <button className="btn btn-dark" type="submit">Submit rating</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
