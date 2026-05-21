import { useEffect, useMemo, useState } from 'react';
import { Heart, Minus, Package, Plus, ShoppingCart, Star, Truck, Zap } from 'lucide-react';
import useDeliveryDate, { getSavedPincode } from '../hooks/useDeliveryDate';

const money = (value) => Number(value || 0).toFixed(0);
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

function formatDeliveryDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

function customerDeliveryText(result) {
  if (!result?.available) return 'Check delivery date';
  if (result.estimatedDeliveryMinDays && result.estimatedDeliveryMaxDays) {
    const minDays = Number(result.estimatedDeliveryMinDays);
    const maxDays = Number(result.estimatedDeliveryMaxDays);
    return minDays === maxDays ? `${minDays} day delivery` : `${minDays}-${maxDays} days delivery`;
  }
  return result.deliveryText?.replace(/\s+from\s+.+$/i, '') || result.message?.replace(/\s+from\s+.+$/i, '') || `Delivery by ${formatDeliveryDate(result.deliveryDate)}`;
}

function estimateDateLabel(result) {
  return result?.estimatedDate || formatDeliveryDate(result?.estimatedDeliveryDate || result?.deliveryDate);
}

export default function ProductPurchasePanel({
  product,
  size,
  wishlistSaved = false,
  onAddToCart,
  onBuyNow,
  onToggleWishlist,
}) {
  const { pincode, setPincode, loading, result, error, checkDelivery } = useDeliveryDate();
  const [localMessage, setLocalMessage] = useState('');
  const [quantity, setQuantity] = useState(1);

  const outOfStock = Number(product?.stock || 0) <= 0;
  const maxQuantity = product?.isOnSale ? 1 : Math.max(1, Number(product?.stock || 1));
  const price = Number(
    product?.isOnSale
      ? product?.salePrice ?? product?.effectivePrice ?? product?.price ?? 0
      : product?.effectivePrice ?? product?.price ?? 0
  );
  const oldPrice = Number(product?.originalPrice || product?.price || 0);
  const showOldPrice = product?.isOnSale || oldPrice > price;
  const rating = product?.rating || product?.averageRating || 5;
  const deliveryLabel = result?.available
    ? customerDeliveryText(result)
    : 'Check delivery date';

  const details = useMemo(() => ([
    product?.brand,
    product?.category,
    size || product?.size,
    product?.color,
  ].filter(Boolean)), [product, size]);

  useEffect(() => {
    const savedPincode = getSavedPincode();
    if (product?.id && savedPincode?.length === 6) {
      checkDelivery({ productId: product.id, qty: quantity, nextPincode: savedPincode });
    }
  }, [product?.id]);

  useEffect(() => {
    setQuantity((current) => Math.min(Math.max(1, current), maxQuantity));
  }, [maxQuantity]);

  function updateQuantity(nextQuantity) {
    setQuantity(Math.min(Math.max(1, Number(nextQuantity) || 1), maxQuantity));
    setLocalMessage('');
  }

  function handlePincodeChange(event) {
    const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 6);
    setPincode(digitsOnly);
    setLocalMessage('');
  }

  async function checkPincode(nextPincode = pincode) {
    const normalizedPincode = String(nextPincode || '').trim();
    if (!PINCODE_REGEX.test(normalizedPincode)) {
      setLocalMessage('Enter a valid 6 digit pincode');
      return;
    }

    setLocalMessage('');
    await checkDelivery({ productId: product.id, qty: quantity, nextPincode: normalizedPincode });
  }

  async function useSavedPincode() {
    const savedPincode = getSavedPincode();
    if (!savedPincode) {
      setLocalMessage('Enter a valid 6 digit pincode');
      return;
    }

    setPincode(savedPincode);
    setLocalMessage('');
    await checkDelivery({ productId: product.id, qty: quantity, nextPincode: savedPincode });
  }

  return (
    <section className="w-full rounded-3xl border border-stone-200/80 bg-white/90 p-4 shadow-[0_18px_45px_rgba(32,22,15,0.12)] sm:p-5 lg:max-w-xl">
      <div className="flex flex-wrap gap-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-extrabold text-amber-700 ring-1 ring-amber-100">
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
          {rating}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-extrabold text-emerald-700 ring-1 ring-emerald-100">
          <Package className="h-4 w-4" aria-hidden="true" />
          {product.stock} in stock
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-sm font-extrabold text-sky-700 ring-1 ring-sky-100">
          <Truck className="h-4 w-4" aria-hidden="true" />
          {deliveryLabel}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <strong className="text-4xl font-black leading-none text-stone-950 sm:text-5xl">
          ₹{money(price * quantity)}
        </strong>
        {showOldPrice && (
          <span className="pb-1 text-lg font-bold text-stone-400 line-through">
            ₹{money(oldPrice * quantity)}
          </span>
        )}
        {quantity > 1 && (
          <span className="pb-1 text-sm font-bold text-stone-500">
            ₹{money(price)} each
          </span>
        )}
      </div>

      {!!details.length && (
        <div className="mt-4 flex flex-wrap gap-2">
          {details.map((detail) => (
            <span key={detail} className="rounded-full bg-stone-100 px-3 py-1.5 text-sm font-bold text-stone-600">
              {detail}
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3">
        <div>
          <p className="m-0 text-sm font-black text-stone-950">Quantity</p>
          <p className="m-0 text-xs font-semibold text-stone-500">
            {product?.isOnSale ? 'Sale products are limited to 1' : `Choose up to ${maxQuantity}`}
          </p>
        </div>
        <div className="inline-flex h-11 items-center rounded-xl border border-stone-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => updateQuantity(quantity - 1)}
            disabled={outOfStock || quantity <= 1}
            className="grid h-11 w-11 place-items-center rounded-l-xl text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-300"
            aria-label="Decrease quantity"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <input
            aria-label="Quantity"
            type="number"
            min="1"
            max={maxQuantity}
            value={quantity}
            onChange={(e) => updateQuantity(e.target.value)}
            disabled={outOfStock}
            className="h-11 w-16 border-x border-stone-200 bg-white p-0 text-center text-base font-black text-stone-950 outline-none"
          />
          <button
            type="button"
            onClick={() => updateQuantity(quantity + 1)}
            disabled={outOfStock || quantity >= maxQuantity}
            className="grid h-11 w-11 place-items-center rounded-r-xl text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-300"
            aria-label="Increase quantity"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50/80 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-black text-stone-950">Delivery estimate</h2>
            <p className="m-0 mt-1 text-sm font-semibold text-stone-500">
              Check availability by pincode
            </p>
          </div>
          <button
            type="button"
            onClick={() => checkPincode()}
            disabled={loading}
            className="shrink-0 rounded-xl bg-stone-950 px-3.5 py-2 text-sm font-black text-white shadow-sm transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2"
          >
            {loading ? 'Checking...' : 'Check PIN'}
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            aria-label="Pincode"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{6}"
            placeholder="Enter pincode"
            value={pincode}
            onChange={handlePincodeChange}
            className="h-12 rounded-xl border border-stone-200 bg-white px-4 text-base font-bold text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
          <button
            type="button"
            onClick={useSavedPincode}
            className="h-12 rounded-xl border border-stone-200 bg-white px-4 text-sm font-black text-stone-800 shadow-sm transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-300"
          >
            Use Saved
          </button>
        </div>

        {(localMessage || error || result) && (
          <div className={`mt-3 rounded-xl px-3 py-2 text-sm font-extrabold ${
            !localMessage && !error && result?.available
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                : 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
          }`}>
            {localMessage || error?.replace(/\.$/, '') || (
              result.available
                ? (
                  <div className="grid gap-1.5">
                    <span className="inline-flex items-center gap-2">
                      <Zap className="h-4 w-4" aria-hidden="true" />
                      Estimated delivery date: {estimateDateLabel(result)}
                    </span>
                  </div>
                )
                : result.message
            )}
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onAddToCart(quantity)}
          disabled={outOfStock}
          className="inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-base font-black text-white shadow-[0_12px_24px_rgba(5,150,105,0.25)] transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200"
        >
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          {outOfStock ? 'Out of stock' : '+ Add to cart'}
        </button>
        <button
          type="button"
          onClick={() => onBuyNow(quantity)}
          disabled={outOfStock}
          className="inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-3 text-base font-black text-white shadow-[0_12px_24px_rgba(32,22,15,0.2)] transition hover:bg-stone-800 focus:outline-none focus:ring-4 focus:ring-stone-200"
        >
          Buy Now
        </button>
        <button
          type="button"
          onClick={onToggleWishlist}
          className="inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-2xl bg-pink-500 px-5 py-3 text-base font-black text-white shadow-[0_12px_24px_rgba(236,72,153,0.22)] transition hover:bg-pink-600 focus:outline-none focus:ring-4 focus:ring-pink-200"
        >
          <Heart className="h-5 w-5 fill-white" aria-hidden="true" />
          {wishlistSaved ? 'Wishlisted' : 'Wishlist'}
        </button>
      </div>
    </section>
  );
}
