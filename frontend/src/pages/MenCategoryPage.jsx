import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import api from '../services/api';
import { getProductPricing } from '../utils/pricing';

function titleFromSlug(slug = '') {
  return slug.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function money(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

const placeholders = {
  women: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80',
  kids: 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=80',
  men: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80'
};

export default function MenCategoryPage() {
  const { slug } = useParams();
  const location = useLocation();
  const gender = location.pathname.startsWith('/women') ? 'women' : location.pathname.startsWith('/kids') ? 'kids' : 'men';
  const titleGender = gender.charAt(0).toUpperCase() + gender.slice(1);
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const title = useMemo(() => products[0]?.category || titleFromSlug(slug), [products, slug]);

  useEffect(() => {
    setStatus('loading');
    setError('');
    api.get(`/${gender}/products/${slug}`)
      .then(({ data }) => {
        const items = data.products || [];
        setProducts(items);
        setStatus(items.length ? 'ready' : 'empty');
      })
      .catch(() => {
        setProducts([]);
        setStatus('error');
        setError('Products load panna mudiyala. Backend/database check pannunga.');
      });
  }, [slug]);

  return (
    <main className="myntra-page men-category-page">
      <section className="men-category-header">
        <div>
          <div className="breadcrumb-line">Home &gt; {titleGender} &gt; {title}</div>
          <h1>{title}</h1>
          <p>Curated {titleGender} products from backend API and MySQL.</p>
        </div>
        <Link to={`/${gender}`} className="men-category-back">Back to {titleGender}</Link>
      </section>

      {status === 'loading' && (
        <section className="men-category-state">
          <span className="men-loading-spinner" />
          <p>Loading {title}...</p>
        </section>
      )}

      {status === 'error' && (
        <section className="men-category-state error">
          <h2>Something went wrong</h2>
          <p>{error}</p>
        </section>
      )}

      {status === 'empty' && (
        <section className="men-category-state">
          <h2>No products found</h2>
          <p>No products in this category yet.</p>
        </section>
      )}

      {status === 'ready' && (
        <section className="men-product-grid">
          {products.map((product) => {
            const { sellingPrice, originalPrice, discountPercentage } = getProductPricing(product);
            return (
              <article className="men-product-card" key={product.id}>
                <Link className="men-product-image" to={`/products/${product.id}`} style={{ backgroundImage: `url(${product.imageUrl || placeholders[gender] || placeholders.men})` }}>
                  {discountPercentage > 0 && <span>{money(discountPercentage)}% OFF</span>}
                </Link>
                <div className="men-product-body">
                  <div className="men-product-title-row">
                    <strong>{product.brand}</strong>
                    <span><Star size={13} fill="currentColor" /> {Number(product.rating || 4.2).toFixed(1)}</span>
                  </div>
                  <h2><Link to={`/products/${product.id}`}>{product.name}</Link></h2>
                  <p>{product.description}</p>
                  <div className="men-size-row">
                    {(product.sizes || []).map((size) => <small key={size}>{size}</small>)}
                  </div>
                  <div className="men-price-row">
                    <strong>Rs.{money(sellingPrice)}</strong>
                    {originalPrice > sellingPrice && <small>Rs.{money(originalPrice)}</small>}
                    {discountPercentage > 0 && <span>({money(discountPercentage)}% OFF)</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
