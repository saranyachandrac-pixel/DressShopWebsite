import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';

const emptyHub = { name: '', code: '', address: '', area: '', city: '', state: '', pincode: '', latitude: '', longitude: '', isActive: true };
const emptyPincode = { hubId: '', pincode: '', deliveryDaysMin: '2', deliveryDaysMax: '3', codAvailable: true, isPrimary: true };

export default function HubManagement() {
  const [hubs, setHubs] = useState([]);
  const [pincodes, setPincodes] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [stockDrafts, setStockDrafts] = useState({});
  const [form, setForm] = useState(emptyHub);
  const [pincodeForm, setPincodeForm] = useState(emptyPincode);
  const [editingId, setEditingId] = useState('');
  const [selectedHubId, setSelectedHubId] = useState('');
  const [csv, setCsv] = useState('hubCode,pincode,deliveryDaysMin,deliveryDaysMax,codAvailable\nTPJ001,620002,2,3,true');
  const [csvResults, setCsvResults] = useState([]);
  const [message, setMessage] = useState('');
  const selectedHub = useMemo(() => hubs.find((hub) => hub.id === selectedHubId), [hubs, selectedHubId]);
  const hubCodes = useMemo(() => hubs.map((hub) => hub.code).filter(Boolean), [hubs]);

  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (selectedHubId) loadStocks(selectedHubId); }, [selectedHubId]);

  async function refresh() {
    const [hubRes, pincodeRes] = await Promise.all([
      api.get('/admin/hubs'),
      api.get('/admin/hub-pincodes')
    ]);
    setHubs(hubRes.data);
    setPincodes(pincodeRes.data);
    if (!selectedHubId && hubRes.data[0]) setSelectedHubId(hubRes.data[0].id);
    if (!pincodeForm.hubId && hubRes.data[0]) setPincodeForm((current) => ({ ...current, hubId: hubRes.data[0].id }));
  }

  async function loadStocks(hubId) {
    const { data } = await api.get('/admin/hub-stocks', { params: { hubId } });
    setStocks(data);
    setStockDrafts(Object.fromEntries(data.map((product) => [product.productId, String(product.quantity || 0)])));
  }

  async function saveHub(e) {
    e.preventDefault();
    setMessage('');
    try {
      if (editingId) await api.put(`/admin/hubs/${editingId}`, form);
      else await api.post('/admin/hubs', form);
      setForm(emptyHub);
      setEditingId('');
      setMessage('Hub saved.');
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save hub.');
    }
  }

  function editHub(hub) {
    setEditingId(hub.id);
    setForm({
      name: hub.name,
      code: hub.code,
      address: hub.address,
      area: hub.area || '',
      city: hub.city || '',
      state: hub.state || '',
      pincode: hub.pincode,
      latitude: hub.latitude || '',
      longitude: hub.longitude || '',
      isActive: Boolean(hub.is_active)
    });
  }

  async function savePincodeMapping(event) {
    event.preventDefault();
    setMessage('');
    try {
      await api.post('/admin/hub-pincodes', pincodeForm);
      setMessage('Hub pincode mapping saved.');
      setPincodeForm({ ...emptyPincode, hubId: pincodeForm.hubId });
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not save pincode mapping.');
    }
  }

  async function uploadCsv() {
    setMessage('');
    setCsvResults([]);
    try {
      const { data } = await api.post('/admin/hub-pincodes/bulk-upload', { csv });
      const updated = data.summary?.updated || data.results.filter((row) => row.status === 'updated').length;
      const skipped = data.summary?.skipped || data.results.filter((row) => row.status === 'skipped').length;
      setCsvResults(data.results || []);
      setMessage(`${data.message} ${updated} row(s) updated${skipped ? `, ${skipped} skipped` : ''}.`);
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not upload CSV.');
    }
  }

  async function updateStock(product, quantity) {
    try {
      await api.post('/admin/hub-stocks/update', {
        hubId: selectedHubId,
        productId: product.productId,
        quantity: Math.max(0, Number(quantity || 0))
      });
      setMessage(`${product.name} stock updated for ${selectedHub?.code || 'selected hub'}.`);
      await loadStocks(selectedHubId);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Could not update stock.');
    }
  }

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Hub Management</h1>
      {message && <div className="alert alert-info">{message}</div>}
      <div className="admin-tabs">
        <a href="/admin">Products & orders</a>
        <a className="active" href="/admin/hubs">Hubs</a>
        <a href="/admin/sale">Sale</a>
        <a href="/admin/coupons">Coupons</a>
        <a href="/admin/logo">Logo Management</a>
      </div>

      <section className="hub-admin-layout">
        <form className="admin-form" onSubmit={saveHub}>
          <h2>{editingId ? 'Edit hub' : 'Add hub'}</h2>
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required /></label>
          <label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required /></label>
          <label>Area<input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="Area or locality" /></label>
          <label>City<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required /></label>
          <label>State<input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></label>
          <label>Pincode<input inputMode="numeric" maxLength="6" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} required /></label>
          <label>Latitude<input type="number" step="0.0000001" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></label>
          <label>Longitude<input type="number" step="0.0000001" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Active hub</label>
          <button className="btn btn-dark">{editingId ? 'Update hub' : 'Add hub'}</button>
        </form>

        <div className="table-card">
          <h2>Hubs</h2>
          <table className="table align-middle">
            <thead><tr><th>Hub</th><th>Address</th><th>Pincode</th><th>Mapped</th><th>Status</th><th></th></tr></thead>
            <tbody>{hubs.map((hub) => (
              <tr key={hub.id}>
                <td><strong>{hub.name}</strong><br /><small>{hub.code}</small></td>
                <td>{hub.address}<br /><small>{[hub.area, hub.city].filter(Boolean).join(', ')}</small></td>
                <td>{hub.pincode}</td>
                <td>{hub.pincodeCount}</td>
                <td>{hub.is_active ? 'Active' : 'Inactive'}</td>
                <td><button className="link-button" type="button" onClick={() => editHub(hub)}>Edit</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="hub-delivery-layout mt-4">
        <div className="pincode-admin-stack">
          <form className="admin-form pincode-mapping-form" onSubmit={savePincodeMapping}>
            <div>
              <h2>Pincode mapping</h2>
              <p className="helper-text">Map a delivery pincode to a hub and define the delivery day range.</p>
            </div>
            <div className="pincode-field-grid">
              <label className="full-row">Hub
                <select value={pincodeForm.hubId} onChange={(e) => setPincodeForm({ ...pincodeForm, hubId: e.target.value })}>
                  {hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.code} - {hub.city || hub.name}</option>)}
                </select>
              </label>
              <label>Pincode<input inputMode="numeric" maxLength="6" value={pincodeForm.pincode} onChange={(e) => setPincodeForm({ ...pincodeForm, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} required /></label>
              <label>Min days<input type="number" min="0" value={pincodeForm.deliveryDaysMin} onChange={(e) => setPincodeForm({ ...pincodeForm, deliveryDaysMin: e.target.value })} required /></label>
              <label>Max days<input type="number" min="0" value={pincodeForm.deliveryDaysMax} onChange={(e) => setPincodeForm({ ...pincodeForm, deliveryDaysMax: e.target.value })} required /></label>
              <label className="checkbox-row pincode-check"><input type="checkbox" checked={pincodeForm.codAvailable} onChange={(e) => setPincodeForm({ ...pincodeForm, codAvailable: e.target.checked })} />COD available</label>
            </div>
            <div className="form-action-row">
              <button className="btn btn-dark">Save mapping</button>
            </div>
          </form>

          <div className="admin-form pincode-csv-panel">
            <div>
              <h2>Pincode CSV</h2>
              <p className="helper-text">
                Format: hubCode,pincode,deliveryDaysMin,deliveryDaysMax,codAvailable. Existing hub codes: {hubCodes.length ? hubCodes.join(', ') : 'No hubs yet'}.
              </p>
            </div>
            <textarea className="csv-box" value={csv} onChange={(e) => setCsv(e.target.value)} />
            <div className="form-action-row">
              <button className="btn btn-dark" type="button" onClick={uploadCsv}>Upload CSV</button>
            </div>
            {!!csvResults.length && (
              <div className="pincode-list compact">
                {csvResults.slice(0, 8).map((row, index) => (
                  <span key={`${row.hubCode || 'row'}-${row.pincode || index}-${index}`}>
                    {row.status === 'updated' ? 'Updated' : 'Skipped'}: {row.hubCode || 'Missing hub'} / {row.pincode || 'Missing pincode'}
                    {row.message ? ` - ${row.message}` : ''}
                  </span>
                ))}
              </div>
            )}
            <div className="pincode-list compact">
              {pincodes.slice(0, 8).map((row) => (
                <span key={row.id}>{row.hubCode} / {row.pincode} / {row.delivery_days_min || row.delivery_days}-{row.delivery_days_max || row.delivery_days} day(s)</span>
              ))}
            </div>
          </div>
        </div>

        <div className="table-card hub-stock-card">
          <div className="section-title-row">
            <h2>Hub stock</h2>
            <select value={selectedHubId} onChange={(e) => setSelectedHubId(e.target.value)}>
              {hubs.map((hub) => (
                <option key={hub.id} value={hub.id}>
                  {hub.code} - {hub.city || hub.name} - {hub.pincode}
                </option>
              ))}
            </select>
          </div>
          {selectedHub && (
            <p className="helper-text">
              Maintain product stock for {selectedHub.name}, {selectedHub.city} - {selectedHub.pincode}. Reserved quantity is orders placed but not shipped.
            </p>
          )}
          <table className="table align-middle">
            <thead><tr><th>Product</th><th>Branch pincode</th><th>Available qty</th><th>Reserved</th><th>Update</th></tr></thead>
            <tbody>{stocks.map((product) => (
              <tr key={product.productId}>
                <td><strong>{product.name}</strong><br /><small>{product.brand} / {product.size}</small></td>
                <td>{selectedHub?.pincode}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={stockDrafts[product.productId] ?? ''}
                    onChange={(e) => setStockDrafts({ ...stockDrafts, [product.productId]: e.target.value })}
                  />
                </td>
                <td>{product.reservedQty}</td>
                <td>
                  <button className="btn btn-dark btn-sm" type="button" onClick={() => updateStock(product, stockDrafts[product.productId])}>
                    Save
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
