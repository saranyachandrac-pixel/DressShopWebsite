import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus, Save, ShoppingBag, Trash2, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { monthlyTemplateApi } from '../services/monthlyTemplateApi';

const formatMoney = (value) => Number(value || 0).toFixed(2);
const monthBadge = () => new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });

export default function MonthlyPurchaseTemplate() {
  const { isAdmin, refreshCartCount } = useAuth();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');

  const selectedItems = useMemo(() => items.filter((item) => item.is_selected), [items]);
  const selectedTotal = useMemo(() => selectedItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0), [selectedItems]);
  const masterTotal = useMemo(() => items.reduce((sum, item) => sum + Number(item.line_total || 0), 0), [items]);

  useEffect(() => { loadPage(); }, []);

  if (isAdmin) return <Navigate to="/admin" replace />;

  async function loadPage() {
    setLoading(true);
    setMessage('');
    try {
      const [templateRes, productsRes] = await Promise.all([
        monthlyTemplateApi.current(),
        monthlyTemplateApi.products()
      ]);
      setTemplate(templateRes.data.template);
      setItems(templateRes.data.items || []);
      setProducts(productsRes.data.products || []);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not load monthly purchase template.');
    } finally {
      setLoading(false);
    }
  }

  function applyPayload(data) {
    setTemplate(data.template);
    setItems(data.items || []);
  }

  async function addItem() {
    if (!selectedProductId) {
      setMessage('Choose a product first.');
      return;
    }
    const product = products.find((item) => String(item.id) === String(selectedProductId));
    try {
      const { data } = await monthlyTemplateApi.addItem({
        productId: selectedProductId,
        quantity: 1,
        unit: product?.size || 'pcs',
        amount: product?.price || 0
      });
      applyPayload(data);
      setSelectedProductId('');
      setMessage(data.message || 'Item added.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not add item.');
    }
  }

  async function updateItem(item, patch) {
    const next = {
      quantity: patch.quantity ?? item.quantity,
      unit: patch.unit ?? item.unit,
      amount: patch.amount ?? item.amount,
      is_selected: patch.is_selected ?? item.is_selected
    };
    setItems((current) => current.map((row) => (
      row.id === item.id
        ? { ...row, ...next, line_total: Number(next.quantity || 1) * Number(next.amount || 0) }
        : row
    )));
    setSavingId(item.id);
    try {
      const { data } = await monthlyTemplateApi.updateItem(item.id, next);
      applyPayload(data);
      setMessage('');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not update item.');
      loadPage();
    } finally {
      setSavingId('');
    }
  }

  async function deleteItem(id) {
    try {
      const { data } = await monthlyTemplateApi.deleteItem(id);
      applyPayload(data);
      setMessage(data.message || 'Item removed.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not remove item.');
    }
  }

  async function saveTemplate() {
    try {
      const { data } = await monthlyTemplateApi.save();
      applyPayload(data);
      setMessage(data.message || 'Template saved.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save template.');
    }
  }

  async function addToCart() {
    try {
      const { data } = await monthlyTemplateApi.addToCart();
      await refreshCartCount();
      setMessage(data.message || 'Selected items added to cart.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not add selected items to cart.');
    }
  }

  async function buyNow() {
    if (!selectedItems.length) {
      setMessage('Select at least one item for Buy Now.');
      return;
    }
    try {
      const { data } = await monthlyTemplateApi.buyNow();
      const checkoutPayload = {
        checkoutSessionId: data.checkoutSessionId,
        source: 'monthly-template',
        items: data.items || selectedItems
      };
      localStorage.setItem('monthly_template_checkout', JSON.stringify(checkoutPayload));
      navigate('/checkout/buy-now', { state: checkoutPayload });
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not start checkout.');
    }
  }

  return (
    <main className="monthly-template-page">
      <section className="monthly-template-header">
        <div>
          <span className="month-badge">{template?.monthLabel || monthBadge()}</span>
          <h1>Monthly Purchase Template</h1>
        </div>
        <div className="monthly-template-metrics">
          <div className="monthly-stat-card">
            <span>Selected count</span>
            <strong>{selectedItems.length}</strong>
          </div>
          <div className="monthly-stat-card">
            <span>Selected estimate total</span>
            <strong>Rs.{formatMoney(selectedTotal)}</strong>
          </div>
        </div>
      </section>

      {message && <div className="alert alert-warning">{message}</div>}

      <section className="monthly-template-toolbar">
        <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
          <option value="">Select product</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} / {product.brand || product.category || 'Dress'} / Rs.{formatMoney(product.price)}
            </option>
          ))}
        </select>
        <button className="btn btn-dark" type="button" onClick={addItem}>
          <Plus size={18} />
          Add Item
        </button>
      </section>

      <section className="monthly-table-card">
        {loading && <p className="helper-text">Loading monthly template...</p>}
        {!loading && !items.length && <p className="helper-text">No products in this month template yet.</p>}
        {!!items.length && (
          <div className="monthly-template-table">
            <div className="monthly-template-row monthly-template-head">
              <span>Select</span>
              <span>Product</span>
              <span>Brand / Category</span>
              <span>Quantity</span>
              <span>Unit</span>
              <span>Amount</span>
              <span>Line total</span>
              <span>Delete</span>
            </div>
            {items.map((item) => (
              <div className="monthly-template-row" key={item.id}>
                <label className="monthly-check">
                  <input
                    type="checkbox"
                    checked={!!item.is_selected}
                    onChange={(event) => updateItem(item, { is_selected: event.target.checked })}
                  />
                </label>
                <div className="monthly-product-name">
                  <strong>{item.name}</strong>
                  <small>Stock {item.stock}</small>
                </div>
                <span>{item.brand || 'DressShop'} / {item.category || 'Dress'}</span>
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(event) => updateItem(item, { quantity: event.target.value })}
                />
                <input
                  value={item.unit || 'pcs'}
                  onChange={(event) => updateItem(item, { unit: event.target.value })}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.amount}
                  onChange={(event) => updateItem(item, { amount: event.target.value })}
                />
                <strong>Rs.{formatMoney(item.line_total)}</strong>
                <button className="icon-button danger" type="button" onClick={() => deleteItem(item.id)} aria-label={`Delete ${item.name}`}>
                  <Trash2 size={18} />
                </button>
                {savingId === item.id && <small className="monthly-saving">Saving...</small>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="monthly-template-footer">
        <div className="monthly-total-strip">
          <span>Master total <strong>Rs.{formatMoney(masterTotal)}</strong></span>
          <span>Selected this month total <strong>Rs.{formatMoney(selectedTotal)}</strong></span>
        </div>
        <div className="monthly-action-row">
          <button className="btn btn-dark" type="button" disabled={!selectedItems.length} onClick={buyNow}>
            <Zap size={18} />
            Buy Now
          </button>
          <button className="btn btn-outline-dark" type="button" disabled={!selectedItems.length} onClick={addToCart}>
            <ShoppingBag size={18} />
            Add to Cart
          </button>
          <button className="btn btn-outline-dark" type="button" disabled={!items.length} onClick={saveTemplate}>
            <Save size={18} />
            Save Current Month Template
          </button>
        </div>
      </section>
    </main>
  );
}
