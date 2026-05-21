import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import ProductCard from '../components/ProductCard';
import { useAuth } from '../context/AuthContext';
import { addCartItem } from '../services/cartApi';

export default function Wishlist() {
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const { refreshCartCount } = useAuth();

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const { data } = await api.get('/wishlist');
    setItems(data.items || []);
  }

  async function addToCart(product, size) {
    await addCartItem({ productId: product.id, quantity: 1, size: size || '', color: product.color || '' });
    setMessage(`${product.name} added to cart.`);
    refreshCartCount();
  }

  async function buyNow(product, size) {
    navigate(`/checkout/buy/${product.id}?size=${encodeURIComponent(size || '')}`);
  }

  async function removeFromWishlist(product) {
    await api.delete(`/wishlist/${product.id}`);
    setItems((current) => current.filter((item) => item.id !== product.id));
    setMessage(`${product.name} removed from wishlist.`);
  }

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">My Wishlist</p>
        <h1>Saved products</h1>
        <p className="helper-text">Products you like are saved here, so you can come back and buy them later.</p>
      </section>

      {message && <div className="alert alert-info">{message}</div>}
      {!items.length && (
        <section className="account-card">
          <p className="helper-text">Your wishlist is empty. Tap the heart on any product to save it here.</p>
        </section>
      )}
      {!!items.length && (
        <section className="product-grid">
          {items.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onAdd={addToCart}
              onBuy={buyNow}
              onWishlist={removeFromWishlist}
              wishlistSaved
            />
          ))}
        </section>
      )}
    </main>
  );
}
