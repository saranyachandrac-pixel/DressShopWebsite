import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { addCartItem } from '../services/cartApi';
import { useAuth } from '../context/AuthContext';
import ProductCard from '../components/ProductCard';
import { addGuestCartItem, setGuestBuyNowItem } from '../utils/guestCart';

export default function MenProducts() {
  const [products, setProducts] = useState([]);
  const emptyCategoryGroups = { casual: [], formal: [], traditional: [], partyWear: [], summerWear: [] };
  const [categoryGroups, setCategoryGroups] = useState(emptyCategoryGroups);
  const [activeCategory, setActiveCategory] = useState('all');
  const [sort, setSort] = useState('recommended');
  const [message, setMessage] = useState('');
  const [wishlistIds, setWishlistIds] = useState([]);
  const [loginPrompt, setLoginPrompt] = useState(null);
  const { user, refreshCartCount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const gender = location.pathname.startsWith('/women') ? 'women' : location.pathname.startsWith('/kids') ? 'kids' : 'men';
  const title = gender.charAt(0).toUpperCase() + gender.slice(1);

  useEffect(() => {
    setActiveCategory('all');
    loadProducts();
  }, [gender]);
  useEffect(() => {
    window.addEventListener('product-catalog-updated', loadProducts);
    return () => window.removeEventListener('product-catalog-updated', loadProducts);
  }, [gender]);
  useEffect(() => { loadWishlist(); }, [user]);

  async function loadProducts() {
    setProducts([]);
    setCategoryGroups(emptyCategoryGroups);
    if (gender === 'women' || gender === 'men' || gender === 'kids') {
      const { data } = await api.get(`/products/${gender}`);
      const allowedGender = gender.toUpperCase();
      setCategoryGroups({ ...emptyCategoryGroups, ...(data || {}) });
      setProducts(Object.values(data || {}).flat().filter((product) => String(product.gender || '').toUpperCase() === allowedGender));
      return;
    }
    const { data } = await api.get('/products', { params: { gender } });
    const items = data.products || [];
    setProducts(items);
  }

  async function loadWishlist() {
    if (!user) {
      setWishlistIds([]);
      return;
    }
    try {
      const { data } = await api.get('/wishlist');
      setWishlistIds((data.items || []).map((item) => item.id));
    } catch (error) {
      setWishlistIds([]);
    }
  }

  async function addToCart(product, size) {
    if (!user) {
      addGuestCartItem(product, { quantity: 1, size: size || '', color: product.color || '' });
      setMessage(`${product.name} added to guest bag.`);
      refreshCartCount();
      return;
    }
    try {
      await addCartItem({ productId: product.id, quantity: 1, size: size || '', color: product.color || '' });
      setMessage(`${product.name} added to cart.`);
      refreshCartCount();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not add product to cart.');
    }
  }

  async function buyNow(product, size) {
    const checkoutPath = `/checkout/buy/${product.id}?size=${encodeURIComponent(size || '')}`;
    if (!user) {
      setGuestBuyNowItem(product, { quantity: 1, size: size || '', color: product.color || '' });
      navigate('/guest-checkout?source=buy-now');
      return;
    }
    navigate(checkoutPath);
  }

  async function saveToWishlist(product) {
    if (!user) return navigate('/login');
    await api.post('/wishlist', { productId: product.id });
    setWishlistIds((current) => current.includes(product.id) ? current : [...current, product.id]);
    setMessage(`${product.name} saved to wishlist.`);
  }

  const visibleProducts = useMemo(() => [...products].filter((product) => {
    const productGender = String(product.gender || '').toUpperCase();
    if (gender === 'women') return productGender === 'WOMEN';
    if (gender === 'men') return productGender === 'MEN';
    if (gender === 'kids') return productGender === 'KIDS';
    return true;
  }).sort((a, b) => {
    const priceA = Number(a.effectivePrice || a.salePrice || a.price || 0);
    const priceB = Number(b.effectivePrice || b.salePrice || b.price || 0);
    if (sort === 'priceLow') return priceA - priceB;
    if (sort === 'priceHigh') return priceB - priceA;
    if (sort === 'rating') return Number(b.averageRating || b.rating || 4.2) - Number(a.averageRating || a.rating || 4.2);
    if (sort === 'newest') return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    return 0;
  }), [products, sort, gender]);

  const categoryTabs = [
    ['all', 'All'],
    ['casual', 'Casual'],
    ['formal', 'Formal'],
    ['traditional', 'Traditional'],
    ['partyWear', 'Party Wear'],
    ['summerWear', 'Summer Wear']
  ];

  const categorySections = [
    ['casual', 'Casual'],
    ['formal', 'Formal'],
    ['traditional', 'Traditional'],
    ['partyWear', 'Party Wear'],
    ['summerWear', 'Summer Wear']
  ].filter(([key]) => activeCategory === 'all' || activeCategory === key);

  function renderProductGrid(items) {
    return (
      <section className="product-grid myntra-product-grid">
        {items.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onAdd={addToCart}
            onBuy={buyNow}
            onWishlist={saveToWishlist}
            wishlistSaved={wishlistIds.includes(product.id)}
          />
        ))}
      </section>
    );
  }

  return (
    <main className="myntra-page men-products-page">
      <section className="men-category-header">
        <div>
          <div className="breadcrumb-line">Home &gt; {title}</div>
          <h1>{title} Products</h1>
          <p>All {title.toLowerCase()} products from the product catalog.</p>
        </div>
      </section>

      {message && <div className="alert alert-success">{message}</div>}
      {loginPrompt && (
        <div className="size-modal-overlay" onClick={() => setLoginPrompt(null)}>
          <div className="login-prompt-modal" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Login required</p>
            <h2>Continue your fast checkout</h2>
            <p className="helper-text">Login first, then we will bring you back to buy {loginPrompt.product.name}.</p>
            <div className="modal-actions">
              <button className="btn btn-outline-dark" type="button" onClick={() => setLoginPrompt(null)}>Cancel</button>
              <button className="btn btn-dark" type="button" onClick={() => navigate(`/login?redirect=${encodeURIComponent(loginPrompt.checkoutPath)}`)}>Login and continue</button>
            </div>
          </div>
        </div>
      )}

      <section className="listing-shell men-listing-shell">
        <div className="listing-content">
          <div className="listing-topbar">
            <div>
              <h2>{title} Collection <span>{visibleProducts.length} items</span></h2>
            </div>
            <div className="listing-controls">
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="recommended">Recommended</option>
                <option value="newest">Newest</option>
                <option value="priceLow">Price Low to High</option>
                <option value="priceHigh">Price High to Low</option>
                <option value="rating">Customer Rating</option>
              </select>
            </div>
          </div>

          {(gender === 'women' || gender === 'men' || gender === 'kids') && (
            <div className="women-category-tabs">
              {categoryTabs.map(([key, label]) => (
                <button key={key} type="button" className={activeCategory === key ? 'active' : ''} onClick={() => setActiveCategory(key)}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {!visibleProducts.length && (
            <section className="men-category-state">
              <h2>No {title.toLowerCase()} products found</h2>
              <p>Add products with gender set to {gender} to show them here.</p>
            </section>
          )}

          {(gender === 'women' || gender === 'men' || gender === 'kids') && categorySections.map(([key, label]) => {
            const expectedGender = gender.toUpperCase();
            const items = (categoryGroups[key] || []).filter((product) => String(product.gender || '').toUpperCase() === expectedGender);
            if (!items.length) return null;
            return (
              <section className="women-category-section" key={key}>
                <div className="section-title-row">
                  <div>
                    <p className="eyebrow">{label}</p>
                    <h2>{label} {title} Styles</h2>
                  </div>
                  <strong>{items.length} items</strong>
                </div>
                {renderProductGrid(items)}
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
