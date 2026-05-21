import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function getTicketTypeFromOrder(order) {
  if (!order) return 'Order Issue';
  const paymentStatus = normalizeStatus(order.paymentStatus || order.payment_status || order.paid_status);
  const status = normalizeStatus(order.status || order.delivery_status);
  const deliveryStatus = normalizeStatus(order.deliveryStatus || order.delivery_status);
  const returnStatus = normalizeStatus(order.returnStatus || order.return_status || order.request_status);
  const cancelStatus = normalizeStatus(order.cancelStatus || order.cancel_status);

  if (['FAILED', 'PENDING'].includes(paymentStatus)) return 'Payment Issue';
  if (status === 'CANCELLED') return 'Cancellation Issue';
  if (['REQUESTED', 'APPROVED', 'PENDING'].includes(cancelStatus)) return 'Cancellation Issue';
  if (['REQUESTED', 'APPROVED'].includes(returnStatus)) return 'Return Issue';
  if (['DELAYED', 'SHIPPED', 'OUT_FOR_DELIVERY'].includes(deliveryStatus)) return 'Delivery Issue';
  if (status === 'DELIVERED' || deliveryStatus === 'DELIVERED') return 'Product Issue';
  return 'Order Issue';
}

export default function RaiseTicket() {
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [form, setForm] = useState({ orderId: '', issueType: 'Order Issue', subject: '', message: '', image: null });
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/orders').then(({ data }) => setOrders(data || [])).catch(() => setOrders([]));
  }, []);

  function handleOrderChange(event) {
    const orderId = event.target.value;
    const order = orders.find((item) => String(item.id) === String(orderId)) || null;
    setSelectedOrder(order);
    setForm((current) => ({
      ...current,
      orderId,
      issueType: getTicketTypeFromOrder(order)
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (value) payload.append(key, value);
    });
    try {
      await api.post('/help/tickets', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSelectedOrder(null);
      setForm({ orderId: '', issueType: 'Order Issue', subject: '', message: '', image: null });
      setMessage('Ticket raised successfully.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not raise ticket.');
    }
  }

  return (
    <main className="help-page">
      <section className="help-section">
        <p className="eyebrow">Contact support</p>
        <h1>Raise ticket</h1>
        {message && <div className="alert alert-info">{message}</div>}
        <form className="help-ticket-form" onSubmit={submit}>
          <label>Order select option
            <select value={form.orderId} onChange={handleOrderChange}>
              <option value="">No order selected</option>
              {orders.map((order) => <option key={order.id} value={order.id}>{order.order_number} - Rs.{Number(order.total_amount || 0).toFixed(2)}</option>)}
            </select>
          </label>
          {selectedOrder && (
            <div className="selected-order-summary">
              <span>Status: {selectedOrder.status || selectedOrder.delivery_status || '-'}</span>
              <span>Payment: {selectedOrder.paymentStatus || selectedOrder.paid_status || '-'}</span>
              <span>Delivery: {selectedOrder.deliveryStatus || selectedOrder.delivery_status || '-'}</span>
            </div>
          )}
          <label>Ticket type
            <input value={form.issueType} readOnly />
          </label>
          <label>Subject<input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Short issue title" /></label>
          <label>Message<textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required /></label>
          <label>Image upload<input type="file" accept="image/*" onChange={(e) => setForm({ ...form, image: e.target.files?.[0] || null })} /></label>
          <button className="btn btn-dark">Submit ticket</button>
        </form>
        <Link to="/help/my-tickets">View my tickets</Link>
      </section>
    </main>
  );
}
