import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';

const STORAGE_KEY = 'dress_shop_pincode';
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

export function getSavedPincode() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function savePincode(pincode) {
  if (PINCODE_REGEX.test(pincode)) {
    localStorage.setItem(STORAGE_KEY, pincode);
  }
}

export default function useDeliveryDate(initialPincode = getSavedPincode()) {
  const [pincode, setPincode] = useState(initialPincode || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const checkDelivery = useCallback(async ({ productId, variantId = null, qty = 1, nextPincode = pincode }) => {
    const normalizedPincode = String(nextPincode || '').trim();
    if (!PINCODE_REGEX.test(normalizedPincode)) {
      setResult(null);
      setError('Enter a valid 6 digit pincode.');
      return null;
    }

    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/delivery/estimate', {
        params: {
          pincode: normalizedPincode,
          productId,
          variantId,
          qty
        }
      });
      savePincode(normalizedPincode);
      setPincode(normalizedPincode);
      setResult(data);
      return data;
    } catch (err) {
      const message = err.response?.data?.message || 'Could not check delivery.';
      setResult(null);
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [pincode]);

  useEffect(() => {
    const saved = getSavedPincode();
    if (saved && saved !== pincode) setPincode(saved);
  }, []);

  return {
    pincode,
    setPincode,
    loading,
    result,
    error,
    checkDelivery
  };
}
