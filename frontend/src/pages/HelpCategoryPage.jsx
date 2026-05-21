import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';

function title(slug = '') {
  return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export default function HelpCategoryPage() {
  const { slug } = useParams();
  const [articles, setArticles] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/help/articles', { params: { category: slug } })
      .then(({ data }) => {
        setArticles(data.articles || []);
        setMessage('');
      })
      .catch(() => setMessage('Could not load help articles.'));
  }, [slug]);

  return (
    <main className="help-page">
      <section className="help-section">
        <div className="breadcrumb-line">Help &gt; {articles[0]?.category_name || title(slug)}</div>
        <h1>{articles[0]?.category_name || title(slug)}</h1>
        {message && <div className="alert alert-warning">{message}</div>}
        <div className="help-article-list">
          {articles.map((article) => (
            <Link key={article.id} to={`/help/articles/${article.slug}`}>
              <strong>{article.title}</strong>
              <span>View article</span>
            </Link>
          ))}
          {!articles.length && !message && <p className="helper-text">No articles in this category yet.</p>}
        </div>
      </section>
    </main>
  );
}
