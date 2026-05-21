import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Star } from 'lucide-react';

const money = (value) => Number(value || 0).toFixed(2);

export default function ProductCard({ product, onAdd, onBuy, onWishlist, wishlistSaved = false }) {
  const out = product.stock <= 0;
  const [showSizeModal, setShowSizeModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const isKidsDress = String(product.category || '').toLowerCase().includes('kids');
  const selectionLabel = isKidsDress ? 'Year' : 'Size';
  const selectionOptions = isKidsDress
    ? ['1-2Y', '3-4Y', '5-6Y', '7-8Y', '9-10Y', '11-12Y']
    : ['M', 'L', 'XL', 'XXL'];

  const discountPercent = Math.min(Math.max(Number(product.discount) || 0, 0), 100);
  const isOnSale = Boolean(product.isOnSale);
  const originalPrice = Number(product.originalPrice || product.price || 0);
  const salePrice = Number(product.salePrice || product.effectivePrice || product.price || 0);
  const discountedPrice = isOnSale ? salePrice : Number(product.price) * (1 - discountPercent / 100);
  const discountText = product.saleType === 'percentage'
    ? `Save ${money(product.saleValue).replace(/\.00$/, '')}%`
    : product.saleType === 'flat'
      ? `Save Rs.${money(product.saleValue).replace(/\.00$/, '')}`
      : 'Buy 1 Get 1 Free';

  function handleAddClick() {
    setPendingAction('add');
    setShowSizeModal(true);
  }

  function handleBuyClick() {
    setPendingAction('buy');
    setShowSizeModal(true);
  }

  function handleSizeSelect(size) {
    if (pendingAction === 'add') onAdd(product, size);
    if (pendingAction === 'buy') onBuy(product, size);
    setShowSizeModal(false);
    setPendingAction(null);
  }

  function handleModalClose() {
    setShowSizeModal(false);
    setPendingAction(null);
  }

  return (
    <>
      <article className="product-card">
        <div className="product-image" style={{ backgroundImage: `url(${product.image})` }}>
          <span className={isOnSale ? 'sale-badge' : 'sale-badge trending'}>{isOnSale ? 'SALE' : 'TRENDING'}</span>
          {onWishlist && (
            <button
              className={wishlistSaved ? 'wishlist-button saved' : 'wishlist-button'}
              type="button"
              onClick={() => onWishlist(product)}
              aria-label={wishlistSaved ? 'Saved in wishlist' : 'Save to wishlist'}
              title={wishlistSaved ? 'Saved in wishlist' : 'Save to wishlist'}
            >
              <Heart size={18} fill={wishlistSaved ? 'currentColor' : 'none'} />
            </button>
          )}
          <div className="hover-bag-actions">
            <button disabled={out} onClick={handleAddClick} type="button">{out ? 'Out of Stock' : 'Add to Bag'}</button>
          </div>
        </div>
        <div className="product-card-body">
          <div className="product-title-row">
            <strong>{product.brand}</strong>
            <span className="rating-badge"><Star size={13} fill="currentColor" /> {Number(product.averageRating || product.rating || 4.3).toFixed(1)}</span>
          </div>
          <h3><Link to={`/products/${product.id}`}>{product.name}</Link></h3>
          <p>{product.description}</p>
          <div className="meta-row"><span>{product.category}</span><span>{product.size}</span><span>{product.color}</span></div>
          <div className="price-row">
            <div className="price-section">
              <strong className={isOnSale ? 'sale-price' : ''}>Rs.{money(discountedPrice)}</strong>
              {isOnSale && <span className="discount-badge">{discountText}</span>}
              {isOnSale && <span className="sale-limit-text">Limit 1 qty per customer</span>}
              {!isOnSale && discountPercent > 0 && <span className="discount-badge">{discountPercent.toFixed(2)}% off</span>}
              {(isOnSale || discountPercent > 0) && (
                <small className="original-price">Rs.{money(isOnSale ? originalPrice : product.price)}</small>
              )}
            </div>
            <div className="card-action-row">
              <button className="quick-buy-button" disabled={out} onClick={handleBuyClick}>{out ? 'Out' : 'Buy'}</button>
            </div>
          </div>
          <span className={out ? 'stock out' : 'stock'}>{out ? 'Out of stock' : `${product.stock} in stock`}</span>
        </div>
      </article>

      {showSizeModal && (
        <div className="size-modal-overlay" onClick={handleModalClose}>
          <div className="size-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Select {selectionLabel}</h3>
            <div className="size-options">
              {selectionOptions.map((size) => (
                <button key={size} className="size-option" onClick={() => handleSizeSelect(size)}>
                  {size}
                </button>
              ))}
            </div>
            <button className="btn btn-outline-dark" onClick={handleModalClose}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
