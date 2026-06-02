import { useEffect, useState } from 'react';
import { Send, XCircle } from 'lucide-react';
import api from '../../services/api';
import AdminTabs from '../../components/AdminTabs';

const formatDate = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

export default function AdminChatbotSupport() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => {
    if (!selected?.id) return undefined;
    const timer = window.setInterval(() => loadMessages(selected.id, false), 5000);
    return () => window.clearInterval(timer);
  }, [selected?.id]);

  async function loadConversations() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/admin/chatbot/conversations');
      setConversations(data.conversations || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load chatbot conversations.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(conversationId, showError = true) {
    try {
      const { data } = await api.get(`/admin/chatbot/conversations/${conversationId}/messages`);
      setSelected(data.conversation);
      setMessages(data.messages || []);
      await loadConversations();
    } catch (err) {
      if (showError) setError(err.response?.data?.message || 'Could not load messages.');
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    const message = reply.trim();
    if (!selected?.id || !message) return;

    setSending(true);
    setError('');
    try {
      await api.post('/admin/chatbot/reply', { conversationId: selected.id, message });
      setReply('');
      setToast('Reply sent.');
      await loadMessages(selected.id);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send reply.');
    } finally {
      setSending(false);
    }
  }

  async function closeConversation() {
    if (!selected?.id || !window.confirm('Close this chatbot conversation?')) return;
    setSending(true);
    try {
      const { data } = await api.put(`/admin/chatbot/conversations/${selected.id}/close`);
      setToast(data.message || 'Conversation closed.');
      await loadMessages(selected.id);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not close conversation.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="admin-chatbot-page">
      <p className="eyebrow">Admin dashboard</p>
      <h1>Chatbot Support</h1>
      <AdminTabs />

      {toast && <div className="alert alert-success">{toast}</div>}
      {error && <div className="alert alert-warning">{error}</div>}

      <section className="admin-chatbot-layout">
        <aside className="chatbot-conversation-list">
          <h2>Conversations</h2>
          {loading && <p className="helper-text">Loading conversations...</p>}
          {!loading && !conversations.length && <p className="helper-text">No chatbot conversations yet.</p>}
          {conversations.map((conversation) => (
            <button
              className={selected?.id === conversation.id ? 'active' : ''}
              key={conversation.id}
              type="button"
              onClick={() => loadMessages(conversation.id)}
            >
              <strong>{conversation.userName}</strong>
              <span>{conversation.lastMessage || 'No messages yet'}</span>
              <small>{conversation.status} · {formatDate(conversation.updatedAt)}{conversation.unreadCount > 0 ? ` · ${conversation.unreadCount} unread` : ''}</small>
            </button>
          ))}
        </aside>

        <section className="admin-chatbot-thread">
          {!selected && <p className="helper-text">Select a conversation to view messages.</p>}
          {selected && (
            <>
              <header>
                <div>
                  <h2>{selected.user_name || selected.userName || 'Customer'}</h2>
                  <p>{selected.user_email || selected.userEmail || ''} · {selected.status}</p>
                </div>
                <button className="btn btn-outline-danger" type="button" onClick={closeConversation} disabled={sending || selected.status === 'closed'}>
                  <XCircle size={16} /> Close
                </button>
              </header>

              <div className="admin-chatbot-messages">
                {messages.map((item) => (
                  <div className={`chat-message ${item.senderType}`} key={item.id}>
                    <p>{item.message}</p>
                    <small>{item.senderType} · {formatDate(item.createdAt)}</small>
                  </div>
                ))}
              </div>

              <form className="admin-chatbot-reply" onSubmit={sendReply}>
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Type admin reply" disabled={selected.status === 'closed'} />
                <button className="btn btn-dark" type="submit" disabled={sending || !reply.trim() || selected.status === 'closed'}>
                  <Send size={16} /> {sending ? 'Sending...' : 'Send reply'}
                </button>
              </form>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
