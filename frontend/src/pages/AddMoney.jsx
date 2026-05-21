import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, CheckCircle2, CreditCard, Landmark, Smartphone, WalletCards } from 'lucide-react';
import api from '../services/api';

const paymentMethods = [
  { id: 'UPI', label: 'UPI', icon: Smartphone },
  { id: 'CREDIT_CARD', label: 'Credit Card', icon: CreditCard },
  { id: 'DEBIT_CARD', label: 'Debit Card', icon: CreditCard },
  { id: 'NET_BANKING', label: 'Net Banking', icon: Landmark },
  { id: 'WALLET', label: 'Wallets', icon: WalletCards }
];

const upiApps = ['GPay', 'PhonePe', 'Paytm'];
const banks = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank'];
const wallets = ['Paytm', 'Amazon Pay', 'Mobikwik'];

const initialDetails = {
  upiId: '',
  upiApp: '',
  cardNumber: '',
  cardHolder: '',
  expiry: '',
  cvv: '',
  saveCard: false,
  bank: '',
  wallet: ''
};

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export default function AddMoney() {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [details, setDetails] = useState(initialDetails);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState([]);
  const [selectedSavedMethod, setSelectedSavedMethod] = useState('');
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/payment-methods')
      .then(({ data }) => setSavedPaymentMethods(data || []))
      .catch(() => setSavedPaymentMethods([]));
  }, []);

  function update(name, value) {
    setDetails((current) => ({ ...current, [name]: value }));
  }

  function choosePaymentMethod(method) {
    setPaymentMethod(method);
    setSelectedSavedMethod('');
    setDetails(initialDetails);
  }

  function useSavedPayment(methodId) {
    setSelectedSavedMethod(methodId);
    const method = savedPaymentMethods.find((item) => String(item.id) === String(methodId));
    if (!method) return;

    if (method.type === 'UPI') {
      setPaymentMethod('UPI');
      setDetails((current) => ({ ...current, upiId: method.details?.upiId || '', upiApp: '' }));
      return;
    }

    setPaymentMethod(method.type === 'Card' && paymentMethod === 'DEBIT_CARD' ? 'DEBIT_CARD' : 'CREDIT_CARD');
    setDetails((current) => ({
      ...current,
      cardNumber: method.details?.maskedCardNumber || method.label || '',
      cardHolder: method.details?.cardholder || '',
      expiry: method.details?.expiry || `${method.details?.expiryMonth || ''}/${String(method.details?.expiryYear || '').slice(-2)}`.replace(/^\/$/, '')
    }));
  }

  function validate() {
    if (!amount || Number(amount) <= 0) return 'Amount empty iruka koodathu.';

    if (paymentMethod === 'UPI') {
      if (!/^[\w.-]+@[\w.-]+$/.test(details.upiId.trim())) return 'Valid UPI ID enter pannunga.';
    }

    if (paymentMethod === 'CREDIT_CARD' || paymentMethod === 'DEBIT_CARD') {
      const card = digits(details.cardNumber);
      const cvv = digits(details.cvv);
      if (!selectedSavedMethod && (card.length < 13 || card.length > 19)) return 'Valid card number enter pannunga.';
      if (!details.cardHolder.trim()) return 'Card holder name required.';
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(details.expiry.trim())) return 'Expiry MM/YY format la venum.';
      if (cvv.length < 3 || cvv.length > 4) return 'Valid CVV enter pannunga.';
    }

    if (paymentMethod === 'NET_BANKING' && !details.bank) return 'Bank select pannunga.';
    if (paymentMethod === 'WALLET' && !details.wallet) return 'Wallet select pannunga.';
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    const error = validate();
    if (error) {
      setToast({ type: 'error', text: error });
      return;
    }

    setSubmitting(true);
    setToast(null);
    try {
      const { data } = await api.post('/wallet/add-money', {
        amount,
        paymentMethod,
        paymentDetails: {
          upiId: details.upiId,
          upiApp: details.upiApp,
          cardLast4: digits(details.cardNumber).slice(-4),
          bank: details.bank,
          wallet: details.wallet,
          saveCard: details.saveCard,
          savedPaymentMethodId: selectedSavedMethod || null
        }
      });
      setAmount('');
      setDetails(initialDetails);
      setSelectedSavedMethod('');
      setToast({ type: 'success', text: `Money added successfully. Transaction ${data.transactionId}` });
    } catch (error) {
      setToast({ type: 'error', text: error.response?.data?.message || 'Payment failed. Try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  const cardSelected = paymentMethod === 'CREDIT_CARD' || paymentMethod === 'DEBIT_CARD';
  const savedUpiMethods = savedPaymentMethods.filter((method) => method.type === 'UPI');
  const savedCardMethods = savedPaymentMethods.filter((method) => method.type === 'Card');

  return (
    <main className="add-money-page">
      <section className="add-money-hero">
        <div>
          <p className="eyebrow">Wallet</p>
          <h1>Add money</h1>
          <p>Choose a payment method and top up your DressShop wallet instantly.</p>
        </div>
        <Link to="/wallet">Back to wallet</Link>
      </section>

      <form className="add-money-shell" onSubmit={submit}>
        <section className="payment-panel">
          {toast && (
            <div className={toast.type === 'success' ? 'wallet-toast success' : 'wallet-toast error'}>
              {toast.type === 'success' && <CheckCircle2 size={18} />}
              <span>{toast.text}</span>
            </div>
          )}

          <label className="amount-field">
            Amount
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Enter amount"
            />
          </label>

          <div className="payment-method-tabs">
            {paymentMethods.map(({ id, label, icon: Icon }) => (
              <button key={id} className={paymentMethod === id ? 'active' : ''} type="button" onClick={() => choosePaymentMethod(id)}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {paymentMethod === 'UPI' && (
            <div className="payment-detail-box">
              <label className="saved-method-select">
                Use Saved UPI
                <select value={selectedSavedMethod} onChange={(event) => useSavedPayment(event.target.value)}>
                  <option value="">Choose saved UPI</option>
                  {savedUpiMethods.map((method) => (
                    <option key={method.id} value={method.id}>{method.label}</option>
                  ))}
                </select>
              </label>
              <label>
                UPI ID
                <input value={details.upiId} onChange={(event) => update('upiId', event.target.value)} placeholder="name@bank" />
              </label>
              <div className="upi-app-row">
                {upiApps.map((app) => (
                  <button
                    key={app}
                    className={details.upiApp === app ? 'active' : ''}
                    type="button"
                    onClick={() => update('upiApp', app)}
                  >
                    {app}
                  </button>
                ))}
              </div>
            </div>
          )}

          {cardSelected && (
            <div className="payment-detail-box card-form-grid">
              <label className="saved-method-select full-row">
                Use Saved Card
                <select value={selectedSavedMethod} onChange={(event) => useSavedPayment(event.target.value)}>
                  <option value="">Choose saved card</option>
                  {savedCardMethods.map((method) => (
                    <option key={method.id} value={method.id}>{method.label}</option>
                  ))}
                </select>
              </label>
              <label className="full-row">
                Card Number
                <input inputMode="numeric" value={details.cardNumber} onChange={(event) => update('cardNumber', event.target.value)} placeholder="1234 5678 9012 3456" />
              </label>
              <label className="full-row">
                Card Holder Name
                <input value={details.cardHolder} onChange={(event) => update('cardHolder', event.target.value)} placeholder="Name on card" />
              </label>
              <label>
                Expiry
                <input value={details.expiry} onChange={(event) => update('expiry', event.target.value)} placeholder="MM/YY" />
              </label>
              <label>
                CVV
                <input inputMode="numeric" value={details.cvv} onChange={(event) => update('cvv', event.target.value)} placeholder="CVV" />
              </label>
              <label className="inline-check full-row">
                <input type="checkbox" checked={details.saveCard} onChange={(event) => update('saveCard', event.target.checked)} />
                Save this card for faster checkout
              </label>
            </div>
          )}

          {paymentMethod === 'NET_BANKING' && (
            <div className="payment-detail-box">
              <label>
                Select bank
                <select value={details.bank} onChange={(event) => update('bank', event.target.value)}>
                  <option value="">Choose your bank</option>
                  {banks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                </select>
              </label>
            </div>
          )}

          {paymentMethod === 'WALLET' && (
            <div className="wallet-provider-grid">
              {wallets.map((wallet) => (
                <button key={wallet} className={details.wallet === wallet ? 'active' : ''} type="button" onClick={() => update('wallet', wallet)}>
                  <WalletCards size={18} />
                  {wallet}
                </button>
              ))}
            </div>
          )}

          <button className="btn btn-dark wallet-pay-button" disabled={submitting} type="submit">
            {submitting ? 'Processing...' : 'Add money'}
          </button>
        </section>

        <aside className="payment-summary-card">
          <Building2 size={22} />
          <h2>Sandbox payment</h2>
          <p>Payments are simulated for development. Successful payments update wallet balance and transaction history.</p>
          <div className="summary-line"><span>Method</span><strong>{paymentMethods.find((item) => item.id === paymentMethod)?.label}</strong></div>
          <div className="summary-line total"><span>Amount</span><strong>Rs.{Number(amount || 0).toFixed(2)}</strong></div>
        </aside>
      </form>
    </main>
  );
}
