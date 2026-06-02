import { useEffect, useState } from 'react';
import { Building2, Pencil, Save, Trash2, X } from 'lucide-react';
import api from '../../services/api';
import AdminTabs from '../../components/AdminTabs';

const emptyForm = { companyName: '' };

export default function CompanyNameManagement() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { loadCompanySettings(); }, []);

  function showToast(type, text) {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 3500);
  }

  async function loadCompanySettings() {
    try {
      const { data } = await api.get('/company-settings');
      setSettings(data.settings || null);
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not load company name.');
    }
  }

  function editSettings() {
    setEditingId(String(settings.id));
    setForm({ companyName: settings.companyName || '' });
  }

  function resetForm() {
    setEditingId('');
    setForm(emptyForm);
  }

  async function saveCompanyName(event) {
    event.preventDefault();
    const companyName = form.companyName.trim();
    if (!companyName) {
      showToast('error', 'Company name is required.');
      return;
    }

    setSaving(true);
    try {
      const payload = { companyName };
      const { data } = editingId
        ? await api.put(`/admin/company-settings/${editingId}`, payload)
        : await api.post('/admin/company-settings', payload);
      setSettings(data.settings || null);
      resetForm();
      window.dispatchEvent(new Event('company-settings-updated'));
      showToast('success', data.message || 'Company name saved successfully.');
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not save company name.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteCompanyName() {
    if (!settings?.id || !window.confirm('Delete company name?')) return;
    setSaving(true);
    try {
      const { data } = await api.delete(`/admin/company-settings/${settings.id}`);
      setSettings(null);
      resetForm();
      window.dispatchEvent(new Event('company-settings-updated'));
      showToast('success', data.message || 'Company name deleted successfully.');
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not delete company name.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Company Name Management</h1>
      <AdminTabs />

      {toast && <div className={`admin-toast ${toast.type}`}>{toast.text}</div>}

      <section className="logo-admin-layout">
        <form className="admin-form logo-admin-form" onSubmit={saveCompanyName}>
          <div>
            <h2>{editingId ? 'Edit company name' : 'Add company name'}</h2>
            <p className="helper-text">This name displays beside the website logo in the header.</p>
          </div>

          <label>
            Company name
            <input
              value={form.companyName}
              placeholder="DressShop"
              maxLength="255"
              onChange={(event) => setForm({ companyName: event.target.value })}
              required
            />
          </label>

          <div className="logo-action-row">
            <button className="btn btn-dark" type="submit" disabled={saving}>
              <Save size={16} /> {saving ? 'Saving...' : editingId ? 'Save changes' : 'Save company name'}
            </button>
            {editingId && (
              <button className="btn btn-outline-dark" type="button" onClick={resetForm} disabled={saving}>
                <X size={16} /> Cancel
              </button>
            )}
          </div>
        </form>

        <section className="table-card logo-status-card">
          <h2>Current company name</h2>
          {settings ? (
            <>
              <div className="company-name-preview">
                <Building2 size={24} />
                <strong>{settings.companyName}</strong>
              </div>
              <p><strong>Updated:</strong> {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString() : '-'}</p>
              <div className="logo-action-row">
                <button className="btn btn-outline-dark" type="button" onClick={editSettings} disabled={saving}>
                  <Pencil size={16} /> Edit
                </button>
                <button className="btn btn-outline-danger" type="button" onClick={deleteCompanyName} disabled={saving}>
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            </>
          ) : (
            <p className="helper-text">No company name saved. Header will show default DressShop.</p>
          )}
        </section>
      </section>
    </main>
  );
}
