import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, Search } from 'lucide-react';
import api from '../services/api';

export default function HelpCenterHome() {
  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/help/categories'),
      api.get('/help/articles', { params: { popular: 'true' } })
    ]).then(([categoryRes, articleRes]) => {
      setCategories(categoryRes.data.categories || []);
      setArticles(articleRes.data.articles || []);
    }).catch(() => {
      setCategories([]);
      setArticles([]);
    });
  }, []);

  const visibleArticles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter((article) => `${article.title} ${article.content}`.toLowerCase().includes(q));
  }, [articles, search]);

  return (
    <main className="help-page">
      <section className="help-hero">
        <LifeBuoy size={34} />
        <h1>Help Center</h1>
        <label className="help-search">
          <Search size={20} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="How can we help you?" />
        </label>
      </section>

      <section className="help-action-row">
        <Link to="/help/raise-ticket">Raise support ticket</Link>
        <Link to="/help/my-tickets">My tickets</Link>
      </section>

      <section className="help-section">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Popular topics</p>
            <h2>Quick answers</h2>
          </div>
        </div>
        <div className="help-article-list">
          {visibleArticles.map((article) => (
            <Link key={article.id} to={`/help/articles/${article.slug}`}>
              <strong>{article.title}</strong>
              <span>{article.category_name}</span>
            </Link>
          ))}
          {!visibleArticles.length && <p className="helper-text">No matching help articles.</p>}
        </div>
      </section>

      <section className="help-section">
        <p className="eyebrow">Categories</p>
        <div className="help-category-grid">
          {categories.map((category) => (
            <Link key={category.id} to={`/help/category/${category.slug}`}>
              <h2>{category.name}</h2>
              <p>{category.description}</p>
              <span>{category.article_count} articles</span>
            </Link>
          ))}
          <Link to="/help/raise-ticket">
            <h2>Contact Support</h2>
            <p>Raise a ticket with order details and an image.</p>
            <span>Open form</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
