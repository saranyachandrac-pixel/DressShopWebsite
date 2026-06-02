import { useEffect, useState } from 'react';
import api from '../services/api';

const mobileDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

export default function GuestOtpVerify({ onVerified }) {
  const [type, setType] = useState('email');
  const [contact, setContact] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const [message, setMessage] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (timer <= 0) return undefined;
    const interval = setInterval(() => setTimer((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const payload = type === 'email'
    ? { type, email: contact.trim() }
    : { type, mobile: mobileDigits(contact) };

  async function sendOtp() {
    setLoading(true);
    setMessage('');
    setDevOtp('');
    try {
      const { data } = await api.post('/guest/send-otp', payload);
      setSent(true);
      setTimer(Number(data.resendAfter || 60));
      setDevOtp(data.otp || '');
      setMessage(data.message || 'OTP sent.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not send OTP.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setLoading(true);
    setMessage('');
    try {
      const { data } = await api.post('/guest/verify-otp', { ...payload, otp });
      setVerified(true);
      setMessage('Verified successfully.');
      onVerified(data);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Invalid OTP.');
    } finally {
      setLoading(false);
    }
  }

  function updateContact(value) {
    setContact(type === 'mobile' ? mobileDigits(value) : value);
    setSent(false);
    setVerified(false);
    setOtp('');
    setMessage('');
    setDevOtp('');
  }

  function switchType(nextType) {
    setType(nextType);
    updateContact('');
  }

  return (
    <section className="checkout-section">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Guest verification</p>
          <h2>Email or mobile OTP</h2>
        </div>
        {verified && <span className="stock">Verified</span>}
      </div>
      <div className="payment-options">
        <button type="button" className={type === 'email' ? 'active' : ''} onClick={() => switchType('email')}>Email ID</button>
        <button type="button" className={type === 'mobile' ? 'active' : ''} onClick={() => switchType('mobile')}>Mobile Number</button>
      </div>
      <label>
        {type === 'email' ? 'Email ID' : 'Mobile number'}
        <input
          type={type === 'email' ? 'email' : 'tel'}
          inputMode={type === 'email' ? 'email' : 'numeric'}
          maxLength={type === 'email' ? undefined : 10}
          value={contact}
          onChange={(event) => updateContact(event.target.value)}
          placeholder={type === 'email' ? 'guest@gmail.com' : '9876543210'}
          disabled={verified}
        />
      </label>
      <div className="checkout-actions">
        <button className="btn btn-dark" type="button" disabled={loading || verified || (sent && timer > 0)} onClick={sendOtp}>
          {sent && timer > 0 ? `Resend in ${timer}s` : 'Send OTP'}
        </button>
      </div>
      {sent && !verified && (
        <label>
          Enter OTP
          <input
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
          />
        </label>
      )}
      {devOtp && <p className="helper-text">Development OTP: {devOtp}</p>}
      {sent && !verified && (
        <button className="place-order-btn" type="button" disabled={loading || otp.length !== 6} onClick={verifyOtp}>
          Verify OTP
        </button>
      )}
      {message && <div className={verified ? 'alert alert-success' : 'alert alert-warning'}>{message}</div>}
    </section>
  );
}
