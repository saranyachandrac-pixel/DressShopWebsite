import { Fragment, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import AdminTabs from '../components/AdminTabs';

const formatMoney = (value) => Number(value || 0).toFixed(2);
const sections = [
  { label: 'All Guest Orders', status: '' },
  { label: 'Pending Orders', status: 'PLACED' },
  { label: 'Confirmed Orders', status: 'CONFIRMED' },
  { label: 'Packed Orders', status: 'PACKED' },
  { label: 'Shipped Orders', status: 'SHIPPED' },
  { label: 'Nearby Hub', status: 'REACHED_NEARBY_HUB' },
  { label: 'Out For Delivery', status: 'OUT_FOR_DELIVERY' },
  { label: 'Delivered Orders', status: 'DELIVERED' },
  { label: 'Cancelled Orders', status: 'CANCELLED' }
];
const orderStatuses = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'REACHED_NEARBY_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED'];
const paymentStatuses = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'];

function statusBadge(value) {
  const status = String(value || '').toLowerCase();
  return `status-badge ${status}`;
}

function firstImage(order) {
  return order.items?.find((item) => item.image)?.image || '';
}

function GuestOrderDetails({ order, onChange, onSave }) {
  if (!order) return null;
  return (
    <div className="admin-order-expanded">
      <div className="admin-order-grid">
        <section>
          <h3>Guest</h3>
          <p><strong>Name:</strong> {order.guest_name}</p>
          <p><strong>Email:</strong> {order.guest_email || '-'}</p>
          <p><strong>Mobile:</strong> {order.guest_mobile || '-'}</p>
          <p><strong>OTP verified:</strong> {order.otpVerifiedType || '-'}</p>
          <p><strong>Created:</strong> {new Date(order.created_at).toLocaleString()}</p>
        </section>
        <section>
          <h3>Delivery</h3>
          <p><strong>Address:</strong> {order.address}</p>
          <p><strong>Pincode:</strong> {order.pincode}</p>
          <label>Hub assigned<input value={order.delivery_hub_name || ''} onChange={(e) => onChange(order.id, { delivery_hub_name: e.target.value })} /></label>
          <div className="guest-order-inline-fields">
            <label>Min days<input type="number" min="0" value={order.estimated_delivery_min_days || ''} onChange={(e) => onChange(order.id, { estimated_delivery_min_days: e.target.value })} /></label>
            <label>Max days<input type="number" min="0" value={order.estimated_delivery_max_days || ''} onChange={(e) => onChange(order.id, { estimated_delivery_max_days: e.target.value })} /></label>
          </div>
          <label>Estimated date<input type="date" value={order.estimated_delivery_date?.slice?.(0, 10) || ''} onChange={(e) => onChange(order.id, { estimated_delivery_date: e.target.value })} /></label>
        </section>
        <section>
          <h3>Payment & Status</h3>
          <p><strong>Total:</strong> Rs.{formatMoney(order.total_amount)}</p>
          <p><strong>Method:</strong> {order.payment_method}</p>
          <label>Order status<select value={order.order_status} onChange={(e) => onChange(order.id, { order_status: e.target.value })}>{orderStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label>Payment status<select value={order.payment_status} onChange={(e) => onChange(order.id, { payment_status: e.target.value })}>{paymentStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <button className="btn btn-sm btn-dark" type="button" onClick={() => onSave(order)}>Save tracking/status</button>
        </section>
      </div>

      <h3>Products</h3>
      <div className="admin-order-items">
        {(order.items || []).map((item) => (
          <div className="admin-order-item" key={item.id}>
            {item.image && <img src={item.image} alt={item.product_name} />}
            <div>
              <strong>{item.product_name}</strong>
              <p>Product ID: {item.product_id}</p>
              <p>Qty: {item.quantity} / Price: Rs.{formatMoney(item.price)} / Total: Rs.{formatMoney(item.total_price)}</p>
            </div>
          </div>
        ))}
      </div>

      <h3>Order timeline</h3>
      <div className="guest-order-timeline">
        {orderStatuses.map((status) => (
          <span className={orderStatuses.indexOf(status) <= orderStatuses.indexOf(order.order_status) ? 'active' : ''} key={status}>{status}</span>
        ))}
      </div>
    </div>
  );
}

export default function AdminGuestOrders() {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({});
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 10 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});
  const [message, setMessage] = useState('');

  useEffect(() => { loadOrders(1); }, [status]);

  async function loadOrders(page = pagination.page, nextSearch = search) {
    const { data } = await api.get('/admin/guest-orders', {
      params: { page, limit: pagination.limit, search: nextSearch || undefined, status: status || undefined }
    });
    setOrders(data.orders || []);
    setSummary(data.summary || {});
    setPagination(data.pagination || { page, pages: 1, total: 0, limit: pagination.limit });
  }

  async function toggleDetails(orderId) {
    if (expandedId === orderId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(orderId);
    if (details[orderId]) return;
    const { data } = await api.get(`/admin/guest-orders/${orderId}`);
    setDetails((current) => ({ ...current, [orderId]: data }));
  }

  function updateLocalOrder(orderId, patch) {
    setOrders((current) => current.map((order) => Number(order.id) === Number(orderId) ? { ...order, ...patch } : order));
    setDetails((current) => ({
      ...current,
      [orderId]: current[orderId] ? { ...current[orderId], ...patch } : current[orderId]
    }));
  }

  async function saveOrder(order) {
    await api.patch(`/admin/guest-orders/${order.id}/status`, {
      order_status: order.order_status,
      payment_status: order.payment_status,
      delivery_hub_name: order.delivery_hub_name,
      estimated_delivery_min_days: order.estimated_delivery_min_days,
      estimated_delivery_max_days: order.estimated_delivery_max_days,
      estimated_delivery_date: order.estimated_delivery_date?.slice?.(0, 10) || order.estimated_delivery_date || null
    });
    setMessage('Guest order updated.');
    await loadOrders(pagination.page);
    const { data } = await api.get(`/admin/guest-orders/${order.id}`);
    setDetails((current) => ({ ...current, [order.id]: data }));
  }

  const activeOrders = useMemo(() => orders, [orders]);

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Guest Orders</h1>
      <AdminTabs />
      {message && <div className="alert alert-info">{message}</div>}

      <section className="admin-summary-grid">
        <div className="summary-card"><span>Total Guest Orders</span><strong>{summary.totalGuestOrders || 0}</strong></div>
        <div className="summary-card"><span>Pending Guest Orders</span><strong>{summary.pendingGuestOrders || 0}</strong></div>
        <div className="summary-card"><span>COD Orders</span><strong>{summary.codOrders || 0}</strong></div>
        <div className="summary-card"><span>Online Paid Orders</span><strong>{summary.onlinePaidOrders || 0}</strong></div>
      </section>

      <div className="admin-tabs admin-sub-tabs">
        {sections.map((section) => (
          <button className={status === section.status ? 'active' : ''} type="button" key={section.label} onClick={() => setStatus(section.status)}>
            {section.label}
          </button>
        ))}
      </div>

      <section className="table-card mt-4">
        <div className="section-title-row">
          <div>
            <h2>Guest checkout orders</h2>
            <p className="helper-text">{pagination.total || 0} guest orders found.</p>
          </div>
          <form className="admin-search-form" onSubmit={(e) => { e.preventDefault(); loadOrders(1); }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, mobile, order id" />
            <button className="btn btn-dark" type="submit">Search</button>
          </form>
        </div>
        <div className="responsive-table-wrap">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Guest Order ID</th>
                <th>Guest</th>
                <th>Products</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Delivery</th>
                <th>Created</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>{activeOrders.map((order) => {
              const detail = details[order.id] || order;
              return (
                <Fragment key={order.id}>
                  <tr>
                    <td><strong>{order.order_number || `#${order.id}`}</strong><br /><small>{order.otpVerifiedType || '-'}</small></td>
                    <td>{order.guest_name}<br /><small>{order.contact || '-'}</small></td>
                    <td>
                      <div className="guest-order-products-cell">
                        {firstImage(order) && <img src={firstImage(order)} alt={order.orderedProducts} />}
                        <span>{order.orderedProducts || '-'}</span>
                      </div>
                    </td>
                    <td>Rs.{formatMoney(order.total_amount)}</td>
                    <td>{order.payment_method}<br /><span className={statusBadge(order.payment_status)}>{order.payment_status}</span></td>
                    <td><span className={statusBadge(order.order_status)}>{order.order_status}</span></td>
                    <td>{order.address}<br /><small>{order.delivery_hub_name || 'No hub'} {order.deliveryEstimate ? `/ ${order.deliveryEstimate}` : ''}</small></td>
                    <td>{new Date(order.created_at).toLocaleString()}</td>
                    <td><button className="link-button" type="button" onClick={() => toggleDetails(order.id)}>{expandedId === order.id ? 'Hide' : 'View'}</button></td>
                  </tr>
                  {expandedId === order.id && (
                    <tr>
                      <td colSpan="9">
                        <GuestOrderDetails order={detail} onChange={updateLocalOrder} onSave={saveOrder} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table>
        </div>
        {!activeOrders.length && <p className="helper-text">No guest orders found.</p>}
        <div className="pagination-row">
          <button className="btn btn-outline-dark btn-sm" type="button" disabled={pagination.page <= 1} onClick={() => loadOrders(pagination.page - 1)}>Previous</button>
          <span>Page {pagination.page || 1} of {pagination.pages || 1}</span>
          <button className="btn btn-outline-dark btn-sm" type="button" disabled={pagination.page >= pagination.pages} onClick={() => loadOrders(pagination.page + 1)}>Next</button>
        </div>
      </section>
    </main>
  );
}
