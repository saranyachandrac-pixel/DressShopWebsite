import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [message, setMessage] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  async function submit(e) {
    e.preventDefault();
    setMessage('');
    try {
      const user = await login(form.email, form.password);
      const redirect = searchParams.get('redirect');
      navigate(redirect || (user.role === 'ADMIN' ? '/admin' : '/'));
    } catch (error) {
      setMessage(error.response?.data?.message || error.message || 'Login failed.');
    }
  }

  async function forgot(e) {
    e.preventDefault();
    const { data } = await api.post('/auth/forgot-password', { email: resetEmail });
    setMessage(data.message);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Welcome back</p>
        <h1>Login</h1>
        {message && <div className="alert alert-info">{message}</div>}
        <form onSubmit={submit} className="stack-form">
          <input placeholder="Email or admin" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <div className="password-wrapper">
            <input
              placeholder="Password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
          <button className="btn btn-dark">Login</button>
        </form>
        <p className="mt-3">New here? <Link to="/register">Create account</Link></p>
        <form onSubmit={forgot} className="forgot-box">
          <strong>Forgot password?</strong>
          <input placeholder="Email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
          <button className="btn btn-outline-dark btn-sm">Send reset</button>
        </form>
      </section>
    </main>
  );
}
