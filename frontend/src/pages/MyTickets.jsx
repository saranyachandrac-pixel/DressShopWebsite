import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const formatDate = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const statusClass = (status = '') => status.toLowerCase().replace(/_/g, '-');

export default function MyTickets() {
  const [tickets, setTickets] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/help/my-tickets')
      .then(({ data }) => {
        setTickets(data.tickets || []);
        setMessage('');
      })
      .catch((error) => setMessage(error.response?.data?.message || 'Could not load tickets.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="help-page">
      <section className="help-section">
        <div className="section-title-row tickets-page-header">
          <div>
            <p className="eyebrow">Support</p>
            <h1>My tickets</h1>
          </div>
          <Link className="btn btn-dark" to="/help/raise-ticket">Raise ticket</Link>
        </div>
        {message && <div className="alert alert-warning">{message}</div>}
        {loading && <p className="helper-text">Loading tickets...</p>}
        <div className="ticket-list">
          {!loading && tickets.map((ticket) => {
            const adminReplies = (ticket.replies || []).filter((reply) => reply?.sender_type === 'admin' || reply?.is_admin);
            return (
              <article className="ticket-card" key={ticket.id}>
                <div className="section-title-row">
                  <div>
                    <strong>{ticket.ticket_no || `#${ticket.id}`} {ticket.subject}</strong>
                    <p>{ticket.issue_type} {ticket.order_number ? `/ ${ticket.order_number}` : ''}</p>
                  </div>
                  <span className={`ticket-status ${statusClass(ticket.status)}`}>{ticket.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="ticket-message-block">
                  <span>Message</span>
                  <p>{ticket.message}</p>
                </div>
                {ticket.image_url && <img src={ticket.image_url} alt="Ticket attachment" />}
                {!!adminReplies.length && (
                  <div className="ticket-admin-responses">
                    <h2>Admin Response</h2>
                    {adminReplies.map((reply) => (
                      <div className="admin-response-box" key={reply.id}>
                        <p>{reply.message}</p>
                        <small>{formatDate(reply.created_at)}</small>
                      </div>
                    ))}
                  </div>
                )}
                {!!ticket.replies?.filter(Boolean).length && (
                  <div className="ticket-replies">
                    <strong>Conversation</strong>
                    {ticket.replies.filter(Boolean).map((reply) => (
                      <p key={reply.id}>
                        <strong>{reply.sender_type === 'admin' || reply.is_admin ? 'Support' : 'You'}:</strong> {reply.message}
                        <small>{formatDate(reply.created_at)}</small>
                      </p>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
          {!loading && !tickets.length && !message && <p className="helper-text">No tickets yet.</p>}
        </div>
      </section>
    </main>
  );
}
