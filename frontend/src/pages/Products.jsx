import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { addCartItem } from '../services/cartApi';
import { useAuth } from '../context/AuthContext';
import ProductCard from '../components/ProductCard';
import { SlidersHorizontal, X } from 'lucide-react';

export default function Products() {
  const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState({});
  const [query, setQuery] = useState({});
  const [sort, setSort] = useState('recommended');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [wishlistIds, setWishlistIds] = useState([]);
  const [loginPrompt, setLoginPrompt] = useState(null);
  const { user, refreshCartCount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { loadProducts(); }, [query]);
  useEffect(() => { loadWishlist(); }, [user]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const search = params.get('search') || '';
    if (search) setQuery((current) => ({ ...current, search }));
  }, [location.search]);

  async function loadProducts() {
    const { data } = await api.get('/products', { params: query });
    setProducts(data.products);
    setFilters(data.filters || {});
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
    if (!user) return navigate('/login');
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
      setLoginPrompt({ product, checkoutPath });
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

  function update(name, value) {
    setQuery((current) => ({ ...current, [name]: value || undefined }));
  }

  function clearFilters() {
    setQuery({});
    setSort('recommended');
    navigate('/', { replace: true });
  }

  function showSaleItems() {
    setQuery((current) => ({ ...current, onSale: 'true' }));
  }

  const colorOptions = ['Black', 'Pink', 'Red', 'Blue', 'Green', 'Yellow', 'White', 'Purple'];
  const categoryChips = ['Party Wear', 'Casual Dresses', 'Ethnic Wear', 'Summer Dresses', 'Office Wear'];
  const visibleProducts = [...products]
    .filter((product) => !query.color || String(product.color || '').toLowerCase().includes(String(query.color).toLowerCase()))
    .filter((product) => query.availability !== 'inStock' || Number(product.stock || 0) > 0)
    .sort((a, b) => {
      const priceA = Number(a.effectivePrice || a.salePrice || a.price || 0);
      const priceB = Number(b.effectivePrice || b.salePrice || b.price || 0);
      if (sort === 'priceLow') return priceA - priceB;
      if (sort === 'priceHigh') return priceB - priceA;
      if (sort === 'rating') return Number(b.averageRating || b.rating || 4.2) - Number(a.averageRating || a.rating || 4.2);
      if (sort === 'newest') return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      return 0;
    });

  const filterPanel = (
    <aside className="myntra-filter-sidebar">
      <div className="filter-heading-row">
        <h2>Filters</h2>
        <button type="button" onClick={clearFilters}>Clear All</button>
      </div>

      <label className="filter-search">
        Search
        <input
          value={query.search || ''}
          placeholder="Search dresses"
          onChange={(event) => update('search', event.target.value)}
        />
      </label>

      <div className="filter-group">
        <h3>Categories</h3>
        {(filters.categories || []).map((item) => (
          <label key={item}><input type="radio" name="category" checked={query.category === item} onChange={() => update('category', item)} /> {item}</label>
        ))}
      </div>

      <div className="filter-group">
        <h3>Brand</h3>
        {(filters.brands || []).map((item) => (
          <label key={item}><input type="radio" name="brand" checked={query.brand === item} onChange={() => update('brand', item)} /> {item}</label>
        ))}
      </div>

      <div className="filter-group">
        <h3>Size</h3>
        <div className="size-chip-grid">
          {(filters.sizes || []).map((item) => (
            <button key={item} className={query.size === item ? 'active' : ''} type="button" onClick={() => update('size', query.size === item ? '' : item)}>{item}</button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <h3>Price Range</h3>
        <div className="price-filter-row">
          <input type="number" value={query.minPrice || ''} placeholder="Min" onChange={(event) => update('minPrice', event.target.value)} />
          <input type="number" value={query.maxPrice || ''} placeholder="Max" onChange={(event) => update('maxPrice', event.target.value)} />
        </div>
      </div>

      <div className="filter-group">
        <h3>Discount</h3>
        {[
          ['10-30', '10% to 30%'],
          ['30-50', '30% to 50%'],
          ['50+', '50% and above']
        ].map(([value, label]) => (
          <label key={value}><input type="radio" name="discount" checked={query.saleRange === value} onChange={() => update('saleRange', value)} /> {label}</label>
        ))}
        <label><input type="checkbox" checked={query.onSale === 'true'} onChange={(event) => update('onSale', event.target.checked ? 'true' : '')} /> Sale items only</label>
      </div>

      <div className="filter-group">
        <h3>Color</h3>
        {colorOptions.map((item) => (
          <label key={item}><input type="radio" name="color" checked={query.color === item} onChange={() => update('color', item)} /> {item}</label>
        ))}
      </div>

      <div className="filter-group">
        <h3>Availability</h3>
        <label><input type="checkbox" checked={query.availability === 'inStock'} onChange={(event) => update('availability', event.target.checked ? 'inStock' : '')} /> In stock</label>
      </div>
    </aside>
  );

  return (
    <main className="myntra-page">
      <section className="hero-panel myntra-hero">
        <div>
          <p className="eyebrow">Big Fashion Festival</p>
          <h1>Trending Dresses | Up to 70% Off</h1>
          <p>Fresh party wear, casual dresses, ethnic edits, and everyday styles picked for a premium fashion scroll.</p>
          <button className="festival-cta" type="button" onClick={showSaleItems}>Shop Now</button>
        </div>
      </section>

      <section className="category-chip-row">
        {categoryChips.map((chip) => (
          <button key={chip} type="button" onClick={() => update('search', chip)}>{chip}</button>
        ))}
      </section>

      {message && <div className="alert alert-success">{message}</div>}
      {loginPrompt && (
        <div className="size-modal-overlay" onClick={() => setLoginPrompt(null)}>
          <div className="login-prompt-modal" onClick={(e) => e.stopPropagation()}>
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

      <section className="listing-shell">
        <div className={mobileFiltersOpen ? 'mobile-filter-layer open' : 'mobile-filter-layer'}>
          <div className="mobile-filter-head">
            <strong>Filters</strong>
            <button type="button" onClick={() => setMobileFiltersOpen(false)}><X size={20} /></button>
          </div>
          {filterPanel}
        </div>

        {filterPanel}

        <div className="listing-content">
          <div className="listing-topbar">
            <div>
              <div className="breadcrumb-line">Home &gt; Women &gt; Dresses</div>
              <h2>Dresses For Women <span>{visibleProducts.length} items</span></h2>
            </div>
            <div className="listing-controls">
              <button className="mobile-filter-button" type="button" onClick={() => setMobileFiltersOpen(true)}>
                <SlidersHorizontal size={18} /> Filters
              </button>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="recommended">Recommended</option>
                <option value="newest">Newest</option>
                <option value="priceLow">Price Low to High</option>
                <option value="priceHigh">Price High to Low</option>
                <option value="rating">Customer Rating</option>
              </select>
            </div>
          </div>

          <section className="product-grid myntra-product-grid">
            {visibleProducts.map((product) => (
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
        </div>
      </section>
    </main>
  );
}
