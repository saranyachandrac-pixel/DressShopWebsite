import { useEffect, useState } from 'react';
import api from '../services/api';

const blank = { categoryId: '', title: '', slug: '', content: '', isPopular: false, isActive: true };

export default function AdminHelpCenter() {
  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const [categoryRes, articleRes] = await Promise.all([
      api.get('/help/categories'),
      api.get('/admin/help/articles')
    ]);
    setCategories(categoryRes.data.categories || []);
    setArticles(articleRes.data.articles || []);
  }

  async function save(event) {
    event.preventDefault();
    setMessage('');
    try {
      if (editingId) await api.put(`/admin/help/articles/${editingId}`, form);
      else await api.post('/admin/help/articles', form);
      setForm(blank);
      setEditingId(null);
      setMessage('Article saved.');
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save article.');
    }
  }

  async function remove(id) {
    if (!confirm('Delete this article?')) return;
    await api.delete(`/admin/help/articles/${id}`);
    refresh();
  }

  function edit(article) {
    setEditingId(article.id);
    setForm({
      categoryId: article.category_id,
      title: article.title,
      slug: article.slug,
      content: article.content,
      isPopular: Boolean(article.is_popular),
      isActive: Boolean(article.is_active)
    });
  }

  return (
    <main className="help-page">
      <p className="eyebrow">Admin</p>
      <h1>Help Center articles</h1>
      <div className="admin-tabs">
        <a href="/admin">Products & orders</a>
        <a href="/admin/hubs">Hubs</a>
        <a href="/admin/sale">Sale</a>
        <a href="/admin/coupons">Coupons</a>
        <a href="/admin/logo">Logo Management</a>
        <a className="active" href="/admin/help">Articles</a>
        <a href="/admin/help/tickets">Tickets</a>
      </div>
      {message && <div className="alert alert-info">{message}</div>}
      <section className="admin-layout">
        <form className="admin-form" onSubmit={save}>
          <h2>{editingId ? 'Edit article' : 'Add article'}</h2>
          <label>Category<select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required><option value="">Choose category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          <label>Slug<input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto from title if empty" /></label>
          <label>Answer content<textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required /></label>
          <label className="inline-check"><input type="checkbox" checked={form.isPopular} onChange={(e) => setForm({ ...form, isPopular: e.target.checked })} /> Popular article</label>
          <label className="inline-check"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
          <button className="btn btn-dark">Save article</button>
        </form>
        <div className="table-card">
          <h2>Articles</h2>
          <table className="table align-middle">
            <tbody>{articles.map((article) => (
              <tr key={article.id}>
                <td><strong>{article.title}</strong><br /><small>{article.category_name}</small></td>
                <td>{article.is_popular ? 'Popular' : 'Standard'}</td>
                <td>{article.is_active ? 'Active' : 'Hidden'}</td>
                <td><button className="link-button" type="button" onClick={() => edit(article)}>Edit</button></td>
                <td><button className="link-button danger" type="button" onClick={() => remove(article.id)}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
