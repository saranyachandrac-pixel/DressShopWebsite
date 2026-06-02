import { useEffect, useRef, useState } from 'react';
import { Bot, MessageCircle, Send, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const formatTime = (value) => value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

export default function ChatBot() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const conversationIdRef = useRef(null);

  useEffect(() => {
    if (!open || !user || isAdmin) return undefined;
    startConversation();
    const timer = window.setInterval(() => {
      if (conversationIdRef.current) loadMessages(conversationIdRef.current, false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [open, user, isAdmin]);

  useEffect(() => {
    conversationIdRef.current = conversation?.id || null;
  }, [conversation?.id]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  function openChat() {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (isAdmin) {
      navigate('/admin/chatbot');
      return;
    }
    setOpen(true);
  }

  async function startConversation() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/chatbot/start');
      setConversation(data.conversation);
      await loadMessages(data.conversation.id);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start chat.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(conversationId, showError = true) {
    try {
      const { data } = await api.get(`/chatbot/messages/${conversationId}`);
      setMessages(data.messages || []);
      setConversation(data.conversation || { id: conversationId });
    } catch (err) {
      if (showError) setError(err.response?.data?.message || 'Could not load messages.');
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;

    setSending(true);
    setError('');
    try {
      const { data } = await api.post('/chatbot/messages', {
        conversationId: conversation?.id,
        message
      });
      setDraft('');
      setConversation(data.conversation);
      setMessages(data.messages || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button className="chatbot-float-button" type="button" onClick={openChat} aria-label="Open chat support">
        <MessageCircle size={24} />
      </button>

      {open && !isAdmin && (
        <section className="chatbot-window" aria-label="Chat support">
          <header className="chatbot-head">
            <div>
              <span><Bot size={18} /></span>
              <div>
                <strong>DressShop Support</strong>
                <small>{conversation?.status === 'closed' ? 'Closed' : 'Online'}</small>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat"><X size={18} /></button>
          </header>

          <div className="chatbot-messages" ref={listRef}>
            {loading && <p className="chatbot-state">Loading chat...</p>}
            {!loading && !messages.length && (
              <div className="chat-message bot">
                <p>Hi! Ask about orders, payment, returns, delivery, or coupons.</p>
              </div>
            )}
            {messages.map((item) => (
              <div className={`chat-message ${item.senderType}`} key={item.id}>
                <p>{item.message}</p>
                <small>{item.senderType} · {formatTime(item.createdAt)}</small>
              </div>
            ))}
          </div>

          {error && <div className="chatbot-error">{error}</div>}

          <form className="chatbot-input-row" onSubmit={sendMessage}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type your message"
              disabled={sending || conversation?.status === 'closed'}
            />
            <button type="submit" disabled={sending || !draft.trim() || conversation?.status === 'closed'} aria-label="Send message">
              <Send size={18} />
            </button>
          </form>
        </section>
      )}
    </>
  );
}
