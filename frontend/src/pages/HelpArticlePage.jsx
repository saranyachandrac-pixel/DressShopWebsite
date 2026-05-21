import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';

export default function HelpArticlePage() {
  const { slug } = useParams();
  const [article, setArticle] = useState(null);
  const [related, setRelated] = useState([]);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    api.get(`/help/articles/${slug}`)
      .then(({ data }) => {
        setArticle(data.article);
        setRelated(data.related || []);
        setFeedback('');
      })
      .catch(() => setArticle(null));
  }, [slug]);

  async function vote(helpful) {
    await api.post(`/help/articles/${slug}/helpful`, { helpful });
    setFeedback('Thanks for your feedback.');
  }

  if (!article) return <main className="help-page"><p className="helper-text">Loading article...</p></main>;

  return (
    <main className="help-page">
      <article className="help-article-detail">
        <div className="breadcrumb-line">Help &gt; {article.category_name}</div>
        <h1>{article.title}</h1>
        <p>{article.content}</p>
        <div className="helpful-box">
          <strong>Was this helpful?</strong>
          <button type="button" onClick={() => vote(true)}>Yes</button>
          <button type="button" onClick={() => vote(false)}>No</button>
          {feedback && <span>{feedback}</span>}
        </div>
      </article>
      <section className="help-section">
        <h2>Related articles</h2>
        <div className="help-article-list">
          {related.map((item) => <Link key={item.id} to={`/help/articles/${item.slug}`}>{item.title}</Link>)}
          {!related.length && <p className="helper-text">No related articles yet.</p>}
        </div>
      </section>
    </main>
  );
}
