import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const labels = { men: 'MEN', women: 'WOMEN', kids: 'KIDS' };

export default function MegaMenu({ gender = 'men', open, mobile = false, onClose, onMouseEnter, onMouseLeave }) {
  const [categories, setCategories] = useState([]);
  const [loadedGender, setLoadedGender] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const label = labels[gender] || gender.toUpperCase();

  useEffect(() => {
    if (!open || (categories.length && loadedGender === gender)) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setCategories([]);
    api.get('/products/menu', { params: { gender } })
      .then(({ data }) => {
        if (cancelled) return;
        const groups = Object.entries(data || {}).map(([category, items]) => ({
          category,
          items: (items || []).map((item) => (
            typeof item === 'string'
              ? { type: item, label: item, category }
              : { ...item, category, type: item.type || item.label, label: item.label || item.type }
          ))
        }));
        setCategories(groups);
        setLoadedGender(gender);
      })
      .catch(() => {
        if (!cancelled) setError(`${label} menu load panna mudiyala.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, categories.length, loadedGender, gender, label]);

  useEffect(() => {
    function resetMenu() {
      setCategories([]);
      setLoadedGender('');
    }

    window.addEventListener('product-catalog-updated', resetMenu);
    return () => window.removeEventListener('product-catalog-updated', resetMenu);
  }, []);

  function toggle(category) {
    setExpanded((current) => ({ ...current, [category]: !(current[category] ?? true) }));
  }

  function listingUrl(category, item = null) {
    const params = new URLSearchParams({ gender, category });
    if (item?.category_id) params.set('category_id', item.category_id);
    if (item?.id) params.set('product_type_id', item.id);
    if (item?.type && !item?.id) params.set('type', item.type);
    return `/products?${params.toString()}`;
  }

  const content = (
    <>
      {loading && <p className="men-mega-state">Loading menu...</p>}
      {error && <p className="men-mega-state error">{error}</p>}
      {!loading && !error && categories.map((category) => {
        const isExpanded = expanded[category.category] ?? true;
        return (
          <div className="men-mega-column" key={category.category}>
            <div className="men-mega-section">
              <div className="men-mega-heading-row">
                <Link className="men-mega-heading" to={listingUrl(category.category, { category_id: category.items?.[0]?.category_id })} onClick={onClose}>
                  {category.category}
                </Link>
                {mobile && (
                  <button className="men-mega-toggle" type="button" onClick={() => toggle(category.category)} aria-label={`Toggle ${category.category}`}>
                    <ChevronDown size={16} className={isExpanded ? 'open' : ''} />
                  </button>
                )}
              </div>
              {(!mobile || isExpanded) && (
                <ul className="men-mega-list">
                  {(category.items || []).map((item) => (
                    <li key={item.type || item.label}>
                      <Link to={listingUrl(item.category || category.category, item)} onClick={onClose}>
                        {item.label || item.type}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
      {!loading && !error && !categories.length && <p className="men-mega-state">No {label} products found.</p>}
    </>
  );

  if (!open) return null;

  if (mobile) {
    return (
      <div className="men-mobile-panel">
        {content}
      </div>
    );
  }

  return (
    <div className="men-mega-wrap" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="men-mega-panel">{content}</div>
    </div>
  );
}
