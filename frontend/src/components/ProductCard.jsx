import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Star } from 'lucide-react';
import { getProductPricing, money } from '../utils/pricing';

const placeholders = {
  women: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80',
  kids: 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=80',
  men: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
  unisex: 'https://images.unsplash.com/photo-1523381294911-8d3cead13475?auto=format&fit=crop&w=900&q=80'
};

function productImage(product) {
  const dbImage = product.image_url || product.image || product.imageUrl;
  if (dbImage) return dbImage;
  const gender = String(product.gender || '').toLowerCase();
  return placeholders[gender] || placeholders.unisex;
}

export default function ProductCard({ product, onAdd, onBuy, onWishlist, wishlistSaved = false }) {
  const out = product.stock <= 0;
  const [showSizeModal, setShowSizeModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const isKidsDress = String(product.category || '').toLowerCase().includes('kids');
  const selectionLabel = isKidsDress ? 'Year' : 'Size';
  const selectionOptions = isKidsDress
    ? ['1-2Y', '3-4Y', '5-6Y', '7-8Y', '9-10Y', '11-12Y']
    : ['M', 'L', 'XL', 'XXL'];

  const isOnSale = Boolean(product.isOnSale);
  const { sellingPrice, originalPrice, discountPercentage } = getProductPricing(product);
  const showDiscount = discountPercentage > 0 && originalPrice > sellingPrice;
  const discountText = product.saleType === 'percentage'
    ? `Save ${money(product.saleValue).replace(/\.00$/, '')}%`
    : product.saleType === 'flat'
      ? `Save Rs.${money(product.saleValue).replace(/\.00$/, '')}`
      : product.saleType === 'bogo'
        ? 'Buy 1 Get 1 Free'
        : `${money(discountPercentage).replace(/\.00$/, '')}% off`;

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
        <div className="product-image" style={{ backgroundImage: `url(${productImage(product)})` }}>
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
              <strong className={showDiscount || isOnSale ? 'sale-price' : ''}>Rs.{money(sellingPrice)}</strong>
              {(showDiscount || isOnSale) && <span className="discount-badge">{discountText}</span>}
              {isOnSale && <span className="sale-limit-text">Limit 1 qty per customer</span>}
              {showDiscount && (
                <small className="original-price">Rs.{money(originalPrice)}</small>
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
