import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [message, setMessage] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    try {
      await register(form);
      navigate('/');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Registration failed.');
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Start shopping</p>
        <h1>Create account</h1>
        {message && <div className="alert alert-danger">{message}</div>}
        <form onSubmit={submit} className="stack-form">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input placeholder="Password" type="password" minLength="6" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <button className="btn btn-dark">Register</button>
        </form>
        <p className="mt-3">Already registered? <Link to="/login">Login</Link></p>
      </section>
    </main>
  );
}
