import { Fragment, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../services/api';
import AdminTabs from '../components/AdminTabs';

const formatMoney = (value) => Number(value || 0).toFixed(2);

const orderSections = [
  { path: '/admin/orders', label: 'All Orders', view: 'orders' },
  { path: '/admin/orders/cancelled', label: 'Cancelled Products', view: 'cancelled' },
  { path: '/admin/orders/returns', label: 'Post Delivery Returns', view: 'returns' },
  { path: '/admin/orders/reviews', label: 'Ratings & Reviews', view: 'reviews' }
];

function getPaymentDetails(order) {
  if (!order?.payment_details) return null;
  if (typeof order.payment_details === 'object') return order.payment_details;
  try {
    return JSON.parse(order.payment_details);
  } catch {
    return null;
  }
}

function AdminOrderDetails({ order }) {
  if (!order) return null;
  const paymentDetails = getPaymentDetails(order);

  return (
    <div className="admin-order-expanded">
      <div className="admin-order-grid">
        <section>
          <h3>Order</h3>
          <p><strong>Order ID:</strong> {order.id}</p>
          <p><strong>Order no:</strong> {order.order_number}</p>
          <p><strong>Date:</strong> {new Date(order.created_at).toLocaleString()}</p>
          <p><strong>Total:</strong> Rs.{formatMoney(order.total_amount)}</p>
          <p><strong>Paid:</strong> {order.paid_status}</p>
          <p><strong>Delivery:</strong> {order.delivery_status}</p>
          {order.delivered_on && <p><strong>Delivered on:</strong> {new Date(order.delivered_on).toLocaleString()}</p>}
        </section>
        <section>
          <h3>Customer & Address</h3>
          <p><strong>Name:</strong> {order.full_name}</p>
          <p><strong>Mobile:</strong> {order.phone}</p>
          <p><strong>Address:</strong> {order.line1} {order.line2}</p>
          <p><strong>City:</strong> {order.city}</p>
          <p><strong>State:</strong> {order.state}</p>
          <p><strong>Pincode:</strong> {order.pincode}</p>
        </section>
        <section>
          <h3>Payment</h3>
          <p><strong>Method:</strong> {order.payment_method}</p>
          {paymentDetails && (
            <>
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
                  <p><strong>Receiver:</strong> {paymentDetails.receiver}</p>
                  <p><strong>Contact:</strong> {paymentDetails.phone}</p>
                  {Number(paymentDetails.cashOnDeliveryCharge || 0) > 0 && <p><strong>COD charge:</strong> Rs.{formatMoney(paymentDetails.cashOnDeliveryCharge)}</p>}
                </>
              )}
            </>
          )}
        </section>
      </div>

      <h3>Items</h3>
      <div className="admin-order-items">
        {(order.items || []).map((item) => (
          <div className="admin-order-item" key={item.id}>
            {item.image && <img src={item.image} alt={item.product_name} />}
            <div>
              <strong>{item.product_name}</strong>
              <p>Product ID: {item.product_id}</p>
              {item.selected_size && <p>Size/Year: {item.selected_size}</p>}
              <p>Qty: {item.quantity} / Price: Rs.{formatMoney(item.price)} / Line total: Rs.{formatMoney(Number(item.price) * Number(item.quantity))}</p>
              <p>Status: {item.item_status || 'ACTIVE'}</p>
              {item.cancel_reason && <p>Cancel reason: {item.cancel_reason} / Refund: {item.refund_status}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminOrders() {
  const location = useLocation();
  const activeSection = orderSections.find((section) => location.pathname === section.path)?.view || 'orders';
  const [orders, setOrders] = useState([]);
  const [cancellations, setCancellations] = useState([]);
  const [postDeliveryRequests, setPostDeliveryRequests] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState({});
  const [loadingOrderId, setLoadingOrderId] = useState(null);
  const [cancellationRemarks, setCancellationRemarks] = useState({});
  const [message, setMessage] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const [orderRes, cancellationRes, postDeliveryRes, reviewRes] = await Promise.all([
      api.get('/orders'),
      api.get('/cancellations').catch(() => ({ data: [] })),
      api.get('/post-delivery/requests').catch(() => ({ data: [] })),
      api.get('/post-delivery/reviews').catch(() => ({ data: [] }))
    ]);
    setOrders(orderRes.data);
    setCancellations(cancellationRes.data);
    setPostDeliveryRequests(postDeliveryRes.data);
    setReviews(reviewRes.data);
  }

  async function updateOrder(id, delivery_status) {
    await api.patch(`/orders/${id}/status`, { delivery_status });
    await refresh();
    if (expandedOrderId === id) {
      const { data } = await api.get(`/orders/${id}`);
      setOrderDetails((current) => ({ ...current, [id]: data }));
    }
  }

  async function updatePostDeliveryRequest(id, requestStatus, refundStatus = null, needsRefundDetails = false) {
    const adminRemarks = window.prompt('Admin remarks', '') || '';
    const payload = { requestStatus, refundStatus, adminRemarks };
    if (needsRefundDetails) {
      const refundAmount = window.prompt('Refund amount', '') || '';
      const refundPaymentMethod = window.prompt('Refund payment method', 'Original payment method') || '';
      const refundTransactionId = window.prompt('Refund transaction ID', '') || '';
      payload.refundAmount = refundAmount;
      payload.refundPaymentMethod = refundPaymentMethod;
      payload.refundTransactionId = refundTransactionId;
    }
    await api.patch(`/post-delivery/requests/${id}`, payload);
    await refresh();
  }

  async function toggleReview(review) {
    await api.patch(`/post-delivery/reviews/${review.id}/visibility`, { hidden: !review.is_hidden });
    await refresh();
  }

  async function updateCancellationAction(row, refundStatus) {
    try {
      const { data } = await api.put(`/admin/cancellations/${row.cancellation_id}/action`, {
        refund_status: refundStatus,
        admin_remarks: cancellationRemarks[row.cancellation_id] || ''
      });
      setMessage(data.message || 'Cancellation action saved.');
      setCancellationRemarks((current) => ({ ...current, [row.cancellation_id]: '' }));
      await refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not update cancellation action.');
    }
  }

  function refundBadge(status) {
    const normalized = String(status || 'PENDING').toLowerCase();
    const className = normalized === 'refunded' ? 'refund-approved' : normalized === 'rejected' ? 'refund-rejected' : normalized;
    return <span className={`status-badge ${className}`}>{String(status || 'PENDING').toUpperCase()}</span>;
  }

  async function toggleOrder(orderId) {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }

    setExpandedOrderId(orderId);
    if (orderDetails[orderId]) return;

    setLoadingOrderId(orderId);
    try {
      const { data } = await api.get(`/orders/${orderId}`);
      setOrderDetails((current) => ({ ...current, [orderId]: data }));
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not load order details.');
    } finally {
      setLoadingOrderId(null);
    }
  }

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Order management</h1>
      <AdminTabs />
      <div className="admin-tabs admin-sub-tabs">
        {orderSections.map((section) => (
          <Link className={activeSection === section.view ? 'active' : ''} to={section.path} key={section.path}>
            {section.label}
          </Link>
        ))}
      </div>
      {message && <div className="alert alert-info">{message}</div>}

      {activeSection === 'orders' && (
        <section className="table-card mt-4">
          <h2>Orders</h2>
          <table className="table align-middle">
            <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Paid</th><th>Status</th><th>Update</th><th>Details</th></tr></thead>
            <tbody>{orders.map((order) => (
              <Fragment key={order.id}>
                <tr>
                  <td>
                    <strong>{order.order_number}</strong><br />
                    <small>ID: {order.id}</small>
                  </td>
                  <td>{order.full_name}</td>
                  <td>Rs.{formatMoney(order.total_amount)}</td>
                  <td>{order.paid_status}</td>
                  <td>{order.delivery_status}</td>
                  <td><select value={order.delivery_status} onChange={(e) => updateOrder(order.id, e.target.value)}>{['PLACED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'].map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td><button className="link-button" onClick={() => toggleOrder(order.id)} type="button">{expandedOrderId === order.id ? 'Hide' : 'View'}</button></td>
                </tr>
                {expandedOrderId === order.id && (
                  <tr>
                    <td colSpan="7">
                      {loadingOrderId === order.id ? (
                        <p className="helper-text">Loading order details...</p>
                      ) : (
                        <AdminOrderDetails order={orderDetails[order.id]} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        </section>
      )}

      {activeSection === 'cancelled' && (
        <section className="table-card mt-4">
          <h2>Cancelled products</h2>
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Cancellation ID</th>
                <th>Order ID</th>
                <th>Product</th>
                <th>User</th>
                <th>Reason</th>
                <th>Refund</th>
                <th>Cancelled date</th>
                <th>Admin remarks</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>{cancellations.map((row) => (
              <tr key={row.cancellation_id}>
                <td>{row.cancellation_id}</td>
                <td>{row.order_id}</td>
                <td>{row.product_name}<br /><small>Product ID: {row.product_id}</small></td>
                <td>{row.customer_name}<br /><small>ID: {row.user_id} / {row.customer_email}</small></td>
                <td>{row.cancel_reason}</td>
                <td>{refundBadge(row.refund_status)}</td>
                <td>{new Date(row.cancelled_at).toLocaleString()}</td>
                <td>
                  {row.admin_remarks || '-'}<br />
                  {row.action_by && <small>By {row.action_by}</small>}<br />
                  {row.action_date && <small>{new Date(row.action_date).toLocaleString()}</small>}
                </td>
                <td>
                  {String(row.refund_status || '').toUpperCase() === 'PENDING' ? (
                    <div className="admin-action-stack">
                      <textarea
                        value={cancellationRemarks[row.cancellation_id] || ''}
                        onChange={(event) => setCancellationRemarks((current) => ({ ...current, [row.cancellation_id]: event.target.value }))}
                        placeholder="Admin remarks"
                      />
                      <div className="admin-action-buttons">
                        <button className="btn btn-dark btn-sm" type="button" onClick={() => updateCancellationAction(row, 'REFUNDED')}>
                          Approve Refund
                        </button>
                        <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => updateCancellationAction(row, 'REJECTED')}>
                          Reject Refund
                        </button>
                      </div>
                    </div>
                  ) : (
                    refundBadge(row.refund_status)
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!cancellations.length && <p className="helper-text">No cancelled items yet.</p>}
        </section>
      )}

      {activeSection === 'returns' && (
        <section className="table-card mt-4">
          <h2>Post-delivery returns</h2>
          <table className="table align-middle">
            <thead><tr><th>ID</th><th>Order</th><th>Product</th><th>Customer</th><th>Type</th><th>Reason</th><th>Status</th><th>Refund</th><th>Actions</th></tr></thead>
            <tbody>{postDeliveryRequests.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.order_id}</td>
                <td>{row.product_name}<br /><small>Product ID: {row.product_id}</small></td>
                <td>{row.customer_name}<br /><small>{row.customer_email}</small></td>
                <td>{row.request_type}</td>
                <td>{row.request_reason}</td>
                <td>
                  {row.request_status}<br />
                  {row.return_picked_up_at && <small>Picked: {new Date(row.return_picked_up_at).toLocaleString()}</small>}<br />
                  {row.return_completed_at && <small>Completed: {new Date(row.return_completed_at).toLocaleString()}</small>}
                  <small>{row.admin_remarks || ''}</small>
                </td>
                <td>
                  {row.refund_status}<br />
                  {row.refund_amount != null && <small>Rs.{formatMoney(row.refund_amount)}</small>}<br />
                  {row.refund_payment_method && <small>{row.refund_payment_method}</small>}<br />
                  {row.refund_transaction_id && <small>Txn: {row.refund_transaction_id}</small>}<br />
                  {row.refund_completed_at && <small>Paid: {new Date(row.refund_completed_at).toLocaleString()}</small>}
                </td>
                <td>
                  <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, 'APPROVED')}>Approve</button>
                  <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, 'REJECTED')}>Reject</button>
                  <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, 'RETURN_PICKED_UP')}>Picked Up</button>
                  <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, 'RETURN_COMPLETED')}>Return Completed</button>
                  <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, row.request_status, 'PROCESSING', true)}>Refund Processing</button>
                  <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, 'REFUNDED', 'COMPLETED', true)}>Refund Completed</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!postDeliveryRequests.length && <p className="helper-text">No post-delivery requests yet.</p>}
        </section>
      )}

      {activeSection === 'reviews' && (
        <section className="table-card mt-4">
          <h2>Ratings & reviews</h2>
          <table className="table align-middle">
            <thead><tr><th>ID</th><th>Product</th><th>Customer</th><th>Order</th><th>Rating</th><th>Review</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{reviews.map((review) => (
              <tr key={review.id}>
                <td>{review.id}</td>
                <td>{review.product_name}<br /><small>Product ID: {review.product_id}</small></td>
                <td>{review.customer_name}<br /><small>{review.customer_email}</small></td>
                <td>{review.order_number}</td>
                <td>{`${Number(review.rating) || 0}/5`}</td>
                <td>{review.review_text || '-'}</td>
                <td>{review.is_hidden ? 'Hidden' : 'Visible'}</td>
                <td><button className="link-button" type="button" onClick={() => toggleReview(review)}>{review.is_hidden ? 'Unhide' : 'Hide'}</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!reviews.length && <p className="helper-text">No reviews yet.</p>}
        </section>
      )}
    </main>
  );
}
