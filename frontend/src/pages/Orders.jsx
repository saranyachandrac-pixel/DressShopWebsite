import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  useEffect(() => { api.get('/orders').then(({ data }) => setOrders(data)); }, []);

  return (
    <main>
      <p className="eyebrow">Order details</p>
      <h1>Orders</h1>
      <div className="table-card">
        <table className="table align-middle">
          <thead><tr><th>Order no</th><th>Date</th><th>Total</th><th>Paid</th><th>Delivery</th><th></th></tr></thead>
          <tbody>{orders.map((order) => (
            <tr key={order.id}>
              <td>{order.order_number}</td>
              <td>{new Date(order.created_at).toLocaleString()}</td>
              <td>₹{Number(order.total_amount).toFixed(2)}</td>
              <td>{order.paid_status}</td>
              <td>{order.delivery_status}</td>
              <td><Link to={`/orders/${order.id}`}>Track</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </main>
  );
}
