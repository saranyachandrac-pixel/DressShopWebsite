import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import api from '../services/api';

function titleFromSlug(slug = '') {
  return slug.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function money(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

export default function MenCategoryPage() {
  const { slug } = useParams();
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const title = useMemo(() => products[0]?.category || titleFromSlug(slug), [products, slug]);

  useEffect(() => {
    setStatus('loading');
    setError('');
    api.get(`/men/products/${slug}`)
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
          <div className="breadcrumb-line">Home &gt; Men &gt; {title}</div>
          <h1>{title}</h1>
          <p>Curated MEN products from backend API and MySQL.</p>
        </div>
        <Link to="/" className="men-category-back">Back to shop</Link>
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
          <p>{title} category la products illa.</p>
        </section>
      )}

      {status === 'ready' && (
        <section className="men-product-grid">
          {products.map((product) => (
            <article className="men-product-card" key={product.id}>
              <Link className="men-product-image" to={`/products/${product.id}`} style={{ backgroundImage: `url(${product.imageUrl})` }}>
                <span>{product.discount}% OFF</span>
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
                  <strong>Rs.{money(product.price)}</strong>
                  <small>Rs.{money(product.mrp)}</small>
                  <span>({product.discount}% OFF)</span>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
