import { Fragment, useEffect, useState } from 'react';
import api from '../services/api';

const emptyProduct = { name: '', description: '', category: 'Traditional dress', brand: '', size: '', color: '', price: '', discount: '', stock: '', image: '' };
const formatMoney = (value) => Number(value || 0).toFixed(2);

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

export default function Admin() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(emptyProduct);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState({});
  const [loadingOrderId, setLoadingOrderId] = useState(null);
  const [cancellations, setCancellations] = useState([]);
  const [postDeliveryRequests, setPostDeliveryRequests] = useState([]);
  const [reviews, setReviews] = useState([]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const [productRes, orderRes, cancellationRes, postDeliveryRes, reviewRes] = await Promise.all([
      api.get('/products'),
      api.get('/orders'),
      api.get('/cancellations').catch(() => ({ data: [] })),
      api.get('/post-delivery/requests').catch(() => ({ data: [] })),
      api.get('/post-delivery/reviews').catch(() => ({ data: [] }))
    ]);
    setProducts(productRes.data.products);
    setOrders(orderRes.data);
    setCancellations(cancellationRes.data);
    setPostDeliveryRequests(postDeliveryRes.data);
    setReviews(reviewRes.data);
  }

  async function saveProduct(e) {
    e.preventDefault();
    setMessage('');
    try {
      if (editingId) await api.put(`/products/${editingId}`, form);
      else await api.post('/products', form);
      setForm(emptyProduct);
      setEditingId(null);
      setMessage('Product saved.');
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save product.');
    }
  }

  function edit(product) {
    setEditingId(product.id);
    setForm({ ...product, price: Number(product.price), stock: Number(product.stock) });
  }

  async function remove(id) {
    if (!confirm('Delete this product?')) return;
    await api.delete(`/products/${id}`);
    refresh();
  }

  async function updateOrder(id, delivery_status) {
    await api.patch(`/orders/${id}/status`, { delivery_status });
    await refresh();
    if (expandedOrderId === id) {
      const { data } = await api.get(`/orders/${id}`);
      setOrderDetails((current) => ({ ...current, [id]: data }));
    }
  }

  async function updatePostDeliveryRequest(id, requestStatus, refundStatus = null) {
    const adminRemarks = window.prompt('Admin remarks', '') || '';
    await api.patch(`/post-delivery/requests/${id}`, { requestStatus, refundStatus, adminRemarks });
    await refresh();
  }

  async function toggleReview(review) {
    await api.patch(`/post-delivery/reviews/${review.id}/visibility`, { hidden: !review.is_hidden });
    await refresh();
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

  async function uploadImage(file) {
    if (!file) return;
    setMessage('');
    setUploading(true);
    try {
      const payload = new FormData();
      payload.append('image', file);
      const { data } = await api.post('/products/upload-image', payload, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setForm((current) => ({ ...current, image: data.image }));
      setMessage('Image uploaded. Save the product to keep it.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not upload image.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Product and order management</h1>
      <div className="admin-tabs">
        <a className="active" href="/admin">Products & orders</a>
        <a href="/admin/hubs">Hubs</a>
        <a href="/admin/sale">Sale</a>
        <a href="/admin/coupons">Coupons</a>
        <a href="/admin/help">Help Center</a>
      </div>
      {message && <div className="alert alert-info">{message}</div>}
      <section className="admin-layout">
        <form className="admin-form" onSubmit={saveProduct}>
          <h2>{editingId ? 'Edit product' : 'Add product'}</h2>
          {Object.keys(emptyProduct).filter((key) => key !== 'image').map((key) => (
            <label key={key}>
              {key === 'discount' ? 'Discount %' : key.replace('_', ' ')}
              <input
                type={['price', 'discount', 'stock'].includes(key) ? 'number' : 'text'}
                placeholder={key === 'discount' ? 'discount %' : key}
                value={form[key] || ''}
                onChange={(e) => setForm({ ...form, [key]: ['price', 'discount', 'stock'].includes(key) ? Number(e.target.value) : e.target.value })}
                required={['name', 'price', 'stock'].includes(key)}
              />
            </label>
          ))}
          <div className="admin-image-control">
            <label>
              Product image URL
              <input
                placeholder="Paste image URL or upload below"
                value={form.image || ''}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
              />
            </label>
            <label>
              Upload product image
              <input type="file" accept="image/*" onChange={(e) => uploadImage(e.target.files?.[0])} />
            </label>
            {uploading && <p className="helper-text">Uploading image...</p>}
            {form.image && <img className="admin-image-preview" src={form.image} alt="Product preview" />}
          </div>
          <button className="btn btn-dark">{editingId ? 'Update' : 'Add'} product</button>
        </form>
        <div className="table-card">
          <h2>Products</h2>
          <table className="table align-middle">
            <tbody>{products.map((product) => (
              <tr key={product.id}>
                <td>
                  <div className="admin-product-cell">
                    {product.image && <img src={product.image} alt={product.name} />}
                    <span>{product.name}<br /><small>{product.brand} / {product.size}</small></span>
                  </div>
                </td>
                <td>Rs.{formatMoney(product.price)}</td>
                <td>{product.discount ? `${formatMoney(product.discount)}% off` : 'No discount'}</td>
                <td>Stock {product.stock}</td>
                <td><button className="link-button" onClick={() => edit(product)}>Edit</button></td>
                <td><button className="link-button danger" onClick={() => remove(product.id)}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
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
      <section className="table-card mt-4">
        <h2>Cancelled products/orders</h2>
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
            </tr>
          </thead>
          <tbody>{cancellations.map((row) => (
            <tr key={row.cancellation_id}>
              <td>{row.cancellation_id}</td>
              <td>{row.order_id}</td>
              <td>{row.product_name}<br /><small>Product ID: {row.product_id}</small></td>
              <td>{row.customer_name}<br /><small>ID: {row.user_id} / {row.customer_email}</small></td>
              <td>{row.cancel_reason}</td>
              <td>{row.refund_status}</td>
              <td>{new Date(row.cancelled_at).toLocaleString()}</td>
              <td>{row.admin_remarks || '-'}</td>
            </tr>
          ))}</tbody>
        </table>
        {!cancellations.length && <p className="helper-text">No cancelled items yet.</p>}
      </section>
      <section className="table-card mt-4">
        <h2>Post-delivery return/cancel requests</h2>
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
              <td>{row.request_status}<br /><small>{row.admin_remarks || ''}</small></td>
              <td>{row.refund_status}</td>
              <td>
                <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, 'APPROVED')}>Approve</button>
                <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, 'REJECTED')}>Reject</button>
                <button className="link-button" type="button" onClick={() => updatePostDeliveryRequest(row.id, 'REFUNDED', 'REFUNDED')}>Refund</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {!postDeliveryRequests.length && <p className="helper-text">No post-delivery requests yet.</p>}
      </section>
      <section className="table-card mt-4">
        <h2>Product ratings and reviews</h2>
        <table className="table align-middle">
          <thead><tr><th>ID</th><th>Product</th><th>Customer</th><th>Order</th><th>Rating</th><th>Review</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{reviews.map((review) => (
            <tr key={review.id}>
              <td>{review.id}</td>
              <td>{review.product_name}<br /><small>Product ID: {review.product_id}</small></td>
              <td>{review.customer_name}<br /><small>{review.customer_email}</small></td>
              <td>{review.order_number}</td>
              <td>{'★'.repeat(Number(review.rating))}</td>
              <td>{review.review_text || '-'}</td>
              <td>{review.is_hidden ? 'Hidden' : 'Visible'}</td>
              <td><button className="link-button" type="button" onClick={() => toggleReview(review)}>{review.is_hidden ? 'Unhide' : 'Hide'}</button></td>
            </tr>
          ))}</tbody>
        </table>
        {!reviews.length && <p className="helper-text">No reviews yet.</p>}
      </section>
    </main>
  );
}
