import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import { addCartItem } from '../services/cartApi';
import { useAuth } from '../context/AuthContext';
import ProductPurchasePanel from '../components/ProductPurchasePanel';
import UserCoupons from '../components/UserCoupons';

function countdown(endDate) {
  if (!endDate) return '';
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return 'Offer ended';
  const minutes = Math.floor(diff / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return `Offer ends in ${days}d ${hours}h ${mins}m`;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, refreshCartCount } = useAuth();
  const [product, setProduct] = useState(null);
  const [timer, setTimer] = useState('');
  const [message, setMessage] = useState('');
  const [wishlistSaved, setWishlistSaved] = useState(false);
  const isKidsDress = String(product?.category || '').toLowerCase().includes('kids');
  const defaultSize = isKidsDress ? '5-6Y' : (product?.size || 'M');

  useEffect(() => {
    api.get(`/products/${id}`).then(({ data }) => setProduct(data));
  }, [id]);

  useEffect(() => {
    if (!product?.saleEndDate) return undefined;
    setTimer(countdown(product.saleEndDate));
    const interval = setInterval(() => setTimer(countdown(product.saleEndDate)), 60000);
    return () => clearInterval(interval);
  }, [product?.saleEndDate]);

  useEffect(() => {
    if (!user || !product?.id) {
      setWishlistSaved(false);
      return;
    }

    api.get('/wishlist')
      .then(({ data }) => {
        setWishlistSaved((data.items || []).some((item) => item.id === product.id));
      })
      .catch(() => setWishlistSaved(false));
  }, [user, product?.id]);

  const terms = useMemo(() => {
    if (!product?.isOnSale) return '';
    return `Offer valid till ${formatDate(product.saleEndDate)} or stock lasts`;
  }, [product]);

  async function addToCart(quantity = 1) {
    if (!user) return navigate('/login');
    try {
      await addCartItem({ productId: product.id, quantity, size: defaultSize, color: product.color || '' });
      setMessage(`${product.name} added to cart.`);
      refreshCartCount();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not add product to cart.');
    }
  }

  function buyNow(quantity = 1) {
    const checkoutPath = `/checkout/buy/${product.id}?size=${encodeURIComponent(defaultSize || '')}&quantity=${encodeURIComponent(quantity)}`;
    if (!user) return navigate(`/login?redirect=${encodeURIComponent(checkoutPath)}`);
    navigate(checkoutPath);
  }

  async function toggleWishlist() {
    if (!user) return navigate('/login');
    try {
      if (wishlistSaved) {
        await api.delete(`/wishlist/${product.id}`);
        setWishlistSaved(false);
        setMessage(`${product.name} removed from wishlist.`);
      } else {
        await api.post('/wishlist', { productId: product.id });
        setWishlistSaved(true);
        setMessage(`${product.name} saved to wishlist.`);
      }
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not update wishlist.');
    }
  }

  if (!product) return <main><p className="helper-text">Loading product...</p></main>;

  return (
    <main className="product-detail-page">
      {message && <div className="alert alert-success">{message}</div>}
      <section className="product-detail">
        <img src={product.image} alt={product.name} />
        <div className="product-detail-copy">
          <p className="eyebrow">{product.category} / {product.brand}</p>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <div className="meta-row"><span>{product.size}</span><span>{product.color}</span></div>
          {product.isOnSale && <div className="sale-countdown">{product.saleType === 'bogo' ? 'Buy 1 Get 1 Free' : timer}</div>}
          {product.isOnSale && <p className="sale-terms">Limit: maximum 1 quantity per customer. {product.saleType === 'bogo' ? 'One free item is included with one paid item.' : ''}</p>}
          {terms && <p className="sale-terms">{terms}</p>}
          <ProductPurchasePanel
            product={product}
            size={defaultSize}
            wishlistSaved={wishlistSaved}
            onAddToCart={addToCart}
            onBuyNow={buyNow}
            onToggleWishlist={toggleWishlist}
          />
          {user && (
            <div className="mt-4">
              <UserCoupons cartTotal={Number(product.effectivePrice || product.salePrice || product.price || 0)} />
            </div>
          )}
        </div>
      </section>
      <section className="account-card mt-4">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Customer reviews</p>
            <h2>Ratings & reviews</h2>
          </div>
          <strong>{product.reviewCount ? `${product.averageRating} / 5` : 'No ratings yet'}</strong>
        </div>
        {!product.reviews?.length && <p className="helper-text">No visible reviews yet.</p>}
        {!!product.reviews?.length && (
          <div className="payment-summary">
            {product.reviews.map((review) => (
              <div className="summary-line" key={review.id}>
                <span>
                  <strong>{'★'.repeat(Number(review.rating))}{'☆'.repeat(5 - Number(review.rating))}</strong>
                  <br />
                  {review.review_text || 'No review text'}
                  <br />
                  <small>{review.customer_name} / {new Date(review.created_at).toLocaleDateString()}</small>
                </span>
                <strong>{review.rating}/5</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
