import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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

export default function OrderDetail() {
  const [order, setOrder] = useState(null);
  const [cancelItem, setCancelItem] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [postDeliveryItem, setPostDeliveryItem] = useState(null);
  const [postDeliveryForm, setPostDeliveryForm] = useState({ requestType: 'RETURN', reason: '' });
  const [reviewItem, setReviewItem] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 5, reviewText: '' });
  const [message, setMessage] = useState('');
  const { id } = useParams();

  useEffect(() => { loadOrder(); }, [id]);

  async function loadOrder() {
    const { data } = await api.get(`/orders/${id}`);
    setOrder(data);
  }

  function canCancel(item) {
    const orderStatus = String(order.delivery_status || '').toUpperCase();
    const itemStatus = String(item.item_status || 'ACTIVE').toUpperCase();
    return ['PENDING', 'CONFIRMED', 'PROCESSING', 'PLACED', 'PACKED'].includes(orderStatus) && itemStatus !== 'CANCELLED';
  }

  function canPostDeliveryRequest(item) {
    return order.delivery_status === 'DELIVERED' && !item.post_delivery_request_id && String(item.item_status || 'ACTIVE') !== 'CANCELLED';
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
      await api.post(`/post-delivery/orders/${order.id}/items/${postDeliveryItem.id}/request`, postDeliveryForm);
      setMessage('Return/cancel request submitted successfully.');
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
      await api.post(`/post-delivery/orders/${order.id}/items/${reviewItem.id}/review`, reviewForm);
      setMessage('Review submitted successfully.');
      setReviewItem(null);
      setReviewForm({ rating: 5, reviewText: '' });
      await loadOrder();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not submit review.');
    }
  }

  if (!order) return <main>Loading...</main>;
  const paymentDetails = getPaymentDetails(order);

  return (
    <main className="split-page">
      <section>
        {message && <div className="alert alert-info">{message}</div>}
        <p className="eyebrow">Tracking status</p>
        <h1>{order.order_number}</h1>
        <div className="tracking-card">
          {['PLACED', 'PACKED', 'SHIPPED', 'DELIVERED'].map((step) => <span className={step === order.delivery_status ? 'active' : ''} key={step}>{step}</span>)}
        </div>
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
              <strong>Rs.{Number(item.price).toFixed(2)}</strong>
            </div>
            {canCancel(item) && (
              <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => setCancelItem(item)}>
                Cancel item
              </button>
            )}
            {canPostDeliveryRequest(item) && (
              <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => setPostDeliveryItem(item)}>
                Return / Cancel Request
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
                <option value="RETURN">Return</option>
                <option value="CANCEL">Cancel</option>
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
