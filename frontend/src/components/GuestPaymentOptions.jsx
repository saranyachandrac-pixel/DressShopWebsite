import { Banknote, CreditCard, Smartphone } from 'lucide-react';

const paymentMethods = [
  {
    code: 'COD',
    title: 'Cash on Delivery',
    description: 'Pay cash when your order is delivered.',
    icon: Banknote
  },
  {
    code: 'UPI',
    title: 'UPI',
    description: 'Pay using any UPI app with your UPI ID.',
    icon: Smartphone
  },
  {
    code: 'CREDIT_CARD',
    title: 'Credit Card',
    description: 'Use a Visa, Mastercard or RuPay credit card.',
    icon: CreditCard
  },
  {
    code: 'DEBIT_CARD',
    title: 'Debit Card',
    description: 'Use a bank debit card for this payment.',
    icon: CreditCard
  }
];

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

export function validateGuestPayment(method, details = {}) {
  if (method === 'COD') return '';
  if (method === 'UPI') {
    return /^[\w.-]+@[\w.-]+$/.test(String(details.upiId || '').trim())
      ? ''
      : 'Enter a valid UPI ID, for example name@upi.';
  }
  if (method === 'CREDIT_CARD' || method === 'DEBIT_CARD') {
    if (digitsOnly(details.cardNumber).length < 13) return 'Enter a valid card number.';
    if (!String(details.cardHolder || '').trim()) return 'Enter the card holder name.';
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(String(details.expiry || '').trim())) return 'Enter expiry in MM/YY format.';
    if (digitsOnly(details.cvv).length < 3) return 'Enter a valid CVV.';
  }
  return '';
}

export default function GuestPaymentOptions({ method, details, onMethodChange, onDetailsChange, error }) {
  function update(field, value) {
    if (field === 'cardNumber') {
      const formatted = digitsOnly(value).slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
      onDetailsChange({ ...details, [field]: formatted });
      return;
    }
    if (field === 'expiry') {
      const digits = digitsOnly(value).slice(0, 4);
      onDetailsChange({ ...details, [field]: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits });
      return;
    }
    if (field === 'cvv') {
      onDetailsChange({ ...details, [field]: digitsOnly(value).slice(0, 4) });
      return;
    }
    onDetailsChange({ ...details, [field]: value });
  }

  return (
    <div className="guest-payment">
      <div className="guest-payment-grid" role="radiogroup" aria-label="Guest payment methods">
        {paymentMethods.map((option) => {
          const Icon = option.icon;
          const selected = method === option.code;
          return (
            <button
              key={option.code}
              type="button"
              className={selected ? 'guest-payment-card selected' : 'guest-payment-card'}
              onClick={() => onMethodChange(option.code)}
              role="radio"
              aria-checked={selected}
            >
              <span className="guest-payment-radio" aria-hidden="true">{selected && <span />}</span>
              <span className="guest-payment-icon"><Icon size={20} /></span>
              <span className="guest-payment-copy">
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="guest-payment-detail">
        {method === 'COD' && <p className="guest-payment-note">Pay cash when your order is delivered.</p>}

        {method === 'UPI' && (
          <label>
            UPI ID
            <input
              value={details.upiId || ''}
              onChange={(event) => update('upiId', event.target.value)}
              placeholder="name@upi"
              autoComplete="off"
            />
          </label>
        )}

        {(method === 'CREDIT_CARD' || method === 'DEBIT_CARD') && (
          <div className="guest-card-form">
            <label>
              Card Number
              <input
                inputMode="numeric"
                value={details.cardNumber || ''}
                onChange={(event) => update('cardNumber', event.target.value)}
                placeholder="1234 5678 9012 3456"
                autoComplete="cc-number"
              />
            </label>
            <label>
              Card Holder Name
              <input
                value={details.cardHolder || ''}
                onChange={(event) => update('cardHolder', event.target.value)}
                placeholder="Name on card"
                autoComplete="cc-name"
              />
            </label>
            <div className="guest-card-row">
              <label>
                Expiry MM/YY
                <input
                  inputMode="numeric"
                  value={details.expiry || ''}
                  onChange={(event) => update('expiry', event.target.value)}
                  placeholder="MM/YY"
                  autoComplete="cc-exp"
                />
              </label>
              <label>
                CVV
                <input
                  inputMode="numeric"
                  value={details.cvv || ''}
                  onChange={(event) => update('cvv', event.target.value)}
                  placeholder="123"
                  autoComplete="cc-csc"
                />
              </label>
            </div>
            <label className="guest-save-card">
              <input
                type="checkbox"
                checked={Boolean(details.saveCard)}
                onChange={(event) => update('saveCard', event.target.checked)}
              />
              Save card for faster checkout
            </label>
          </div>
        )}

        {error && <p className="guest-payment-error">{error}</p>}
      </div>
    </div>
  );
}
