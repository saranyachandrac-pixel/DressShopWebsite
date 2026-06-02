import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import AdminTabs from '../components/AdminTabs';

const money = (value) => Number(value || 0).toFixed(2);

const emptySale = {
  saleType: 'percentage',
  saleValue: 50,
  saleStartDate: new Date().toISOString().slice(0, 10),
  saleEndDate: '2026-08-31',
  dedPermitNumber: '123456'
};

export default function AdminSalePage() {
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [sale, setSale] = useState(emptySale);
  const [preview, setPreview] = useState(null);
  const [csv, setCsv] = useState('productId,saleType,saleValue,startDate,endDate\n');
  const [message, setMessage] = useState('');

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    const { data } = await api.get('/products');
    setProducts(data.products || []);
  }

  const selectedProducts = useMemo(
    () => products.filter((product) => selected.includes(product.id)),
    [products, selected]
  );

  function toggleProduct(productId) {
    setSelected((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  }

  function updateSale(name, value) {
    setSale((current) => ({ ...current, [name]: value }));
  }

  async function previewSale() {
    setMessage('');
    try {
      const { data } = await api.post('/products/sale/preview', { ...sale, productIds: selected });
      setPreview(data);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not preview sale.');
    }
  }

  async function activateSale() {
    setMessage('');
    if (!selected.length) {
      setMessage('Select at least one product for the sale.');
      return;
    }
    try {
      const { data } = await api.post('/products/sale', { ...sale, productIds: selected });
      const startsLater = new Date(sale.saleStartDate) > new Date();
      setMessage(startsLater ? `Summer sale scheduled for ${sale.saleStartDate}. ${data.updated} product(s) updated.` : `Summer sale activated. ${data.updated} product(s) updated.`);
      await loadProducts();
      await previewSale();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not activate sale.');
    }
  }

  async function uploadCsv() {
    setMessage('');
    try {
      const { data } = await api.post('/products/sale/csv', { csv, dedPermitNumber: sale.dedPermitNumber });
      setMessage(data.message);
      await loadProducts();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not process CSV.');
    }
  }

  return (
    <main>
      <p className="eyebrow">Admin sale control</p>
      <h1>Summer Sale 2026</h1>
      <AdminTabs />
      {message && <div className="alert alert-info">{message}</div>}

      <section className="sale-admin-layout">
        <form className="admin-form" onSubmit={(event) => event.preventDefault()}>
          <h2>Sale settings</h2>
          <label>
            Sale type
            <select value={sale.saleType} onChange={(e) => updateSale('saleType', e.target.value)}>
              <option value="percentage">Percentage</option>
              <option value="flat">Flat Amount</option>
              <option value="bogo">Buy 1 Get 1 Free</option>
            </select>
          </label>
          <label>
            Sale value
            <input type="number" value={sale.saleValue} onChange={(e) => updateSale('saleValue', Number(e.target.value))} disabled={sale.saleType === 'bogo'} />
            {sale.saleType === 'bogo' && <span className="helper-text">BOGO gives one free item with one paid item. Customer limit remains 1 paid quantity.</span>}
          </label>
          <label>
            Start date
            <input type="date" value={sale.saleStartDate} onChange={(e) => updateSale('saleStartDate', e.target.value)} />
          </label>
          <label>
            End date
            <input type="date" value={sale.saleEndDate} onChange={(e) => updateSale('saleEndDate', e.target.value)} />
          </label>
          <label>
            DED Permit Number
            <input value={sale.dedPermitNumber} onChange={(e) => updateSale('dedPermitNumber', e.target.value)} required />
          </label>
          <div className="d-flex gap-2 flex-wrap">
            <button className="btn btn-outline-dark" type="button" onClick={previewSale}>Preview impact</button>
            <button className="btn btn-dark" type="button" onClick={activateSale}>Activate sale</button>
          </div>
        </form>

        <div className="table-card">
          <h2>Select products</h2>
          <table className="table align-middle">
            <tbody>{products.map((product) => (
              <tr key={product.id}>
                <td><input type="checkbox" checked={selected.includes(product.id)} onChange={() => toggleProduct(product.id)} /></td>
                <td>{product.name}<br /><small>{product.category} / Stock {product.stock}</small></td>
                <td>Rs.{money(product.originalPrice || product.price)}</td>
                <td>
                  {product.isOnSale ? 'On sale' : product.saleScheduled ? 'Scheduled' : product.saleConfigured ? 'Configured' : 'Regular'}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="table-card mt-4">
        <h2>Revenue impact preview</h2>
        <p className="helper-text">{selectedProducts.length} product(s) selected.</p>
        {preview ? (
          <>
            <div className="impact-grid">
              <div><span>Current revenue</span><strong>Rs.{money(preview.totals.currentRevenue)}</strong></div>
              <div><span>Sale revenue</span><strong>Rs.{money(preview.totals.saleRevenue)}</strong></div>
              <div><span>Impact</span><strong>Rs.{money(preview.totals.impact)}</strong></div>
            </div>
            {(preview.items || []).map((item) => (
              <div className="preview-line" key={item.id}>
                <span>{item.name}</span>
                <strong>Rs.{money(item.saleRevenue)}</strong>
                {item.warnings?.length > 0 && <small>{item.warnings.join(' ')}</small>}
              </div>
            ))}
          </>
        ) : (
          <p className="helper-text">Choose products and preview before activating.</p>
        )}
      </section>

      <section className="table-card mt-4">
        <h2>Bulk upload CSV</h2>
        <textarea className="csv-box" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <button className="btn btn-dark mt-3" type="button" onClick={uploadCsv}>Upload CSV</button>
      </section>
    </main>
  );
}
