import { useEffect, useState } from 'react';
import api from '../services/api';
import AdminTabs from '../components/AdminTabs';

const formatDate = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const statusOptions = ['OPEN', 'ANSWERED', 'IN_PROGRESS', 'RESOLVED'];

export default function AdminTickets() {
  const [tickets, setTickets] = useState([]);
  const [replyText, setReplyText] = useState({});
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/admin/help/tickets');
      setTickets(data.tickets || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load support tickets.');
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id, status) {
    try {
      await api.put(`/admin/help/tickets/${id}/status`, { status });
      setToast('Ticket status updated.');
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update status.');
    }
  }

  async function sendResponse(id) {
    const text = String(replyText[id] || '').trim();
    if (!text) {
      setError('Reply message is required.');
      return;
    }
    setSendingId(id);
    setError('');
    try {
      await api.post(`/admin/help/tickets/${id}/reply`, { message: text });
      setReplyText((current) => ({ ...current, [id]: '' }));
      setToast('Admin response sent.');
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send response.');
    } finally {
      setSendingId(null);
    }
  }

  return (
    <main className="help-page admin-ticket-page">
      <p className="eyebrow">Admin</p>
      <h1>Support tickets</h1>
      <AdminTabs />
      {toast && <div className="alert alert-success">{toast}</div>}
      {error && <div className="alert alert-warning">{error}</div>}
      {loading && <section className="help-section"><p className="helper-text">Loading support tickets...</p></section>}
      {!loading && !tickets.length && <section className="help-section"><p className="helper-text">No user tickets yet.</p></section>}
      {!loading && !!tickets.length && (
        <section className="admin-ticket-table-card">
          <div className="admin-ticket-grid admin-ticket-head">
            <span>Ticket ID</span>
            <span>Customer name</span>
            <span>Customer email</span>
            <span>Order ID</span>
            <span>Issue</span>
            <span>Message</span>
            <span>Status</span>
            <span>Admin Response</span>
          </div>
          {tickets.map((ticket) => {
            const adminReplies = (ticket.replies || []).filter((reply) => reply?.sender_type === 'admin' || reply?.is_admin);
            return (
              <article className="admin-ticket-row" key={ticket.id}>
                <div className="admin-ticket-grid">
                  <div className="admin-ticket-cell" data-label="Ticket ID"><strong>{ticket.ticket_no || `#${ticket.id}`}</strong><small>#{ticket.id}</small></div>
                  <div className="admin-ticket-cell" data-label="Customer name">{ticket.customer_name}</div>
                  <div className="admin-ticket-cell" data-label="Customer email">{ticket.customer_email}</div>
                  <div className="admin-ticket-cell order-number-cell" data-label="Order ID">{ticket.order_number || ticket.order_id || '-'}</div>
                  <div className="admin-ticket-cell" data-label="Issue">{ticket.issue_type}<small>{ticket.subject}</small></div>
                  <div className="admin-ticket-cell ticket-message-cell" data-label="Message">{ticket.message}</div>
                  <div className="admin-ticket-cell" data-label="Status">
                    <select className="ticket-status-select" value={ticket.status} onChange={(event) => updateStatus(ticket.id, event.target.value)}>
                      {statusOptions.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div className="admin-ticket-cell admin-response-cell" data-label="Admin Response">
                    {!adminReplies.length && <span className="helper-text">No admin response yet.</span>}
                    {adminReplies.map((reply) => (
                      <div className="admin-response-box" key={reply.id}>
                        <strong>Admin Response</strong>
                        <p>{reply.message}</p>
                        <small>{formatDate(reply.created_at)}</small>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="admin-ticket-reply-row">
                  <textarea
                    className="admin-ticket-textarea"
                    value={replyText[ticket.id] || ''}
                    onChange={(event) => setReplyText({ ...replyText, [ticket.id]: event.target.value })}
                    placeholder="Type admin response"
                  />
                  <button className="btn btn-dark" type="button" disabled={sendingId === ticket.id} onClick={() => sendResponse(ticket.id)}>
                    {sendingId === ticket.id ? 'Sending...' : 'Send Response'}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
