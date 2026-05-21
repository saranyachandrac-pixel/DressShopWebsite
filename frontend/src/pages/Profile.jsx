import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const digitsOnly = (value) => value.replace(/\D/g, '');
const normalizeMobileNumber = (value) => digitsOnly(value).slice(0, 10);

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', mobile: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    setForm({ name: user?.name || '', email: user?.email || '', mobile: user?.mobile || '' });
  }, [user]);

  async function submit(e) {
    e.preventDefault();
    setMessage('');

    if (form.mobile && form.mobile.length !== 10) {
      setMessage('Mobile number must be exactly 10 digits.');
      return;
    }

    try {
      await updateUser(form);
      setMessage('Profile updated.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not update profile.');
    }
  }

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">My profile</p>
        <h1>Account details</h1>
        <p className="helper-text">Update the name shown in the menu, your login email, and your mobile number.</p>
      </section>
      <section className="account-card">
        {message && <div className="alert alert-info">{message}</div>}
        <form className="stack-form" onSubmit={submit}>
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Email id
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label>
            Mobile number
            <input inputMode="numeric" maxLength="10" pattern="\d{10}" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: normalizeMobileNumber(e.target.value) })} placeholder="10 digit mobile number" />
          </label>
          <button className="btn btn-dark">Update profile</button>
        </form>
      </section>
    </main>
  );
}
