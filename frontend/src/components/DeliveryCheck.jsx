import { useEffect } from 'react';
import useDeliveryDate from '../hooks/useDeliveryDate';

function customerDeliveryText(result) {
  if (!result?.available) return '';
  if (result.estimatedDeliveryMinDays && result.estimatedDeliveryMaxDays) {
    const minDays = Number(result.estimatedDeliveryMinDays);
    const maxDays = Number(result.estimatedDeliveryMaxDays);
    return minDays === maxDays ? `${minDays} day delivery` : `${minDays}-${maxDays} days delivery`;
  }
  return result.deliveryText?.replace(/\s+from\s+.+$/i, '') || '';
}

function deliveryDateLabel(result) {
  const value = result?.estimatedDeliveryDate || result?.deliveryDate;
  return result?.estimatedDate || (value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' }) : '');
}

export default function DeliveryCheck({ productId, variantId = null, qty = 1, autoCheck = true, onResult }) {
  const { pincode, setPincode, loading, result, error, checkDelivery } = useDeliveryDate();

  async function runCheck() {
    const data = await checkDelivery({ productId, variantId, qty });
    if (onResult) onResult(data);
  }

  useEffect(() => {
    if (autoCheck && productId && pincode.length === 6) {
      runCheck();
    }
  }, [productId]);

  return (
    <section className="delivery-check">
      <div>
        <p className="eyebrow">Check Delivery</p>
        <h2>Delivery estimate</h2>
      </div>
      <div className="delivery-check-row">
        <input
          inputMode="numeric"
          maxLength="6"
          placeholder="Enter pincode"
          value={pincode}
          onBlur={() => pincode.length === 6 && runCheck()}
          onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button className="btn btn-dark" type="button" disabled={loading} onClick={runCheck}>
          {loading ? 'Checking...' : 'Check'}
        </button>
      </div>
      {loading && <p className="helper-text">Checking...</p>}
      {error && <p className="delivery-status error">{error}</p>}
      {result?.available && (
        <p className="delivery-status success">
          <span>Estimated delivery date: {deliveryDateLabel(result)}</span>
          {customerDeliveryText(result) ? <><br /><span>{customerDeliveryText(result)}</span></> : null}
        </p>
      )}
      {result && !result.available && (
        <p className="delivery-status error">
          Not deliverable to {result.pincode || pincode}. Check other pincodes.
        </p>
      )}
    </section>
  );
}
