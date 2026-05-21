import { useEffect, useState } from 'react';
import api from '../services/api';

const blankReview = { rating: 5, reviewText: '' };

export default function Reviews() {
  const [items, setItems] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [reviewForm, setReviewForm] = useState(blankReview);
  const [message, setMessage] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      const { data } = await api.get('/post-delivery/reviewable-items');
      setItems(data);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not load purchased products.');
    }
  }

  function openReview(item) {
    setActiveItem(item);
    setReviewForm({
      rating: Number(item.rating || 5),
      reviewText: item.review_text || ''
    });
  }

  async function submitReview(e) {
    e.preventDefault();
    try {
      if (activeItem.review_id) {
        await api.put(`/post-delivery/reviews/${activeItem.review_id}`, reviewForm);
        setMessage('Review updated successfully.');
      } else {
        await api.post(`/post-delivery/orders/${activeItem.order_id}/items/${activeItem.order_item_id}/review`, reviewForm);
        setMessage('Review submitted successfully.');
      }
      setActiveItem(null);
      setReviewForm(blankReview);
      await refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save review.');
    }
  }

  async function deleteReview(item) {
    await api.delete(`/post-delivery/reviews/${item.review_id}`);
    setMessage('Review deleted successfully.');
    await refresh();
  }

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">Review & Rating</p>
        <h1>Purchased products</h1>
        <p className="helper-text">Rate delivered products, write reviews, and manage your existing feedback.</p>
      </section>

      {message && <div className="alert alert-info">{message}</div>}

      <section className="account-card">
        {!items.length && <p className="helper-text">No delivered products are ready for review yet.</p>}
        <div className="review-list">
          {items.map((item) => (
            <div className="review-item" key={item.order_item_id}>
              <img src={item.image} alt={item.product_name} />
              <div>
                <strong>{item.product_name}</strong>
                <p>{item.order_number}{item.selected_size ? ` / Size ${item.selected_size}` : ''}</p>
                {item.review_id ? (
                  <p className="helper-text">
                    Rating: {item.rating}/5<br />
                    {item.review_text || 'No review text'}
                    {item.is_hidden ? ' / Hidden by admin' : ''}
                  </p>
                ) : (
                  <p className="helper-text">You have not reviewed this product yet.</p>
                )}
              </div>
              <div className="review-actions">
                <button className="btn btn-dark btn-sm" type="button" onClick={() => openReview(item)}>
                  {item.review_id ? 'Edit Review' : 'Add Rating'}
                </button>
                {item.review_id && (
                  <button className="btn btn-outline-dark btn-sm" type="button" onClick={() => deleteReview(item)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {activeItem && (
        <div className="size-modal-overlay" onClick={() => setActiveItem(null)}>
          <form className="login-prompt-modal stack-form" onSubmit={submitReview} onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">Product rating</p>
            <h2>{activeItem.product_name}</h2>
            <label>
              Rating
              <select value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: Number(e.target.value) })}>
                {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} star{rating > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <label>
              Review
              <textarea className="csv-box" value={reviewForm.reviewText} onChange={(e) => setReviewForm({ ...reviewForm, reviewText: e.target.value })} placeholder="Write your review" />
            </label>
            <div className="modal-actions">
              <button className="btn btn-outline-dark" type="button" onClick={() => setActiveItem(null)}>Close</button>
              <button className="btn btn-dark" type="submit">{activeItem.review_id ? 'Update review' : 'Submit rating'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
