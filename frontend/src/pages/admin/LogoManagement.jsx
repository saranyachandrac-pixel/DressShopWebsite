import { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import api from '../../services/api';

const maxLogoSize = 2 * 1024 * 1024;
const allowedLogoTypes = ['image/jpeg', 'image/png', 'image/webp'];
const allowedLogoExtensions = ['jpg', 'jpeg', 'png', 'webp'];

function validateLogoFile(file) {
  if (!file) return 'Choose a logo image first.';
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  if (!allowedLogoTypes.includes(file.type) || !allowedLogoExtensions.includes(extension)) {
    return 'Only jpg, jpeg, png, and webp images are allowed.';
  }
  if (file.size > maxLogoSize) return 'Logo image must be 2MB or less.';
  return '';
}

export default function LogoManagement() {
  const [activeLogo, setActiveLogo] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const isEditing = Boolean(activeLogo?.id);
  const canSave = Boolean(selectedFile) && !saving;

  const selectedFileSize = useMemo(() => {
    if (!selectedFile) return '';
    return `${(selectedFile.size / 1024).toFixed(1)} KB`;
  }, [selectedFile]);

  useEffect(() => { loadLogo(); }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  function showToast(type, text) {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 3500);
  }

  async function loadLogo() {
    try {
      const { data } = await api.get('/logo');
      setActiveLogo(data.logo || null);
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not load website logo.');
    }
  }

  function chooseFile(file) {
    const error = validateLogoFile(file);
    if (error) {
      setSelectedFile(null);
      showToast('error', error);
      return;
    }
    setSelectedFile(file);
    setToast(null);
  }

  async function saveLogo(event) {
    event.preventDefault();
    const error = validateLogoFile(selectedFile);
    if (error) {
      showToast('error', error);
      return;
    }

    const payload = new FormData();
    payload.append('logo', selectedFile);
    setSaving(true);
    try {
      const { data } = isEditing
        ? await api.put(`/admin/logo/${activeLogo.id}`, payload, { headers: { 'Content-Type': 'multipart/form-data' } })
        : await api.post('/admin/logo', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSelectedFile(null);
      setActiveLogo(data.logo || null);
      window.dispatchEvent(new Event('site-logo-updated'));
      showToast('success', data.message || 'Logo saved successfully.');
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not save logo.');
    } finally {
      setSaving(false);
    }
  }

  async function removeLogo() {
    if (!activeLogo?.id || !window.confirm('Remove the active website logo?')) return;
    setSaving(true);
    try {
      const { data } = await api.delete(`/admin/logo/${activeLogo.id}`);
      setActiveLogo(null);
      setSelectedFile(null);
      window.dispatchEvent(new Event('site-logo-updated'));
      showToast('success', data.message || 'Logo removed successfully.');
    } catch (error) {
      showToast('error', error.response?.data?.message || 'Could not remove logo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Logo Management</h1>
      <div className="admin-tabs">
        <a href="/admin">Products & orders</a>
        <a href="/admin/hubs">Hubs</a>
        <a href="/admin/sale">Sale</a>
        <a href="/admin/coupons">Coupons</a>
        <a href="/admin/help">Help Center</a>
        <a className="active" href="/admin/logo">Logo Management</a>
      </div>

      {toast && <div className={`admin-toast ${toast.type}`}>{toast.text}</div>}

      <section className="logo-admin-layout">
        <form className="admin-form logo-admin-form" onSubmit={saveLogo}>
          <div>
            <h2>{isEditing ? 'Edit website logo' : 'Add website logo'}</h2>
            <p className="helper-text">Upload jpg, jpeg, png, or webp. Maximum file size is 2MB.</p>
          </div>

          <label className="logo-upload-drop">
            <ImagePlus size={28} />
            <span>{selectedFile ? selectedFile.name : 'Choose logo image'}</span>
            {selectedFileSize && <small>{selectedFileSize}</small>}
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </label>

          {(previewUrl || activeLogo?.logoUrl) && (
            <div className="logo-preview-panel">
              <span>{previewUrl ? 'Selected preview' : 'Active logo'}</span>
              <img src={previewUrl || activeLogo.logoUrl} alt="Website logo preview" />
            </div>
          )}

          <div className="logo-action-row">
            <button className="btn btn-dark" type="submit" disabled={!canSave}>
              <Upload size={16} /> {saving ? 'Saving...' : isEditing ? 'Update logo' : 'Save logo'}
            </button>
            {activeLogo?.id && (
              <button className="btn btn-outline-danger" type="button" onClick={removeLogo} disabled={saving}>
                <Trash2 size={16} /> Remove logo
              </button>
            )}
          </div>
        </form>

        <section className="table-card logo-status-card">
          <h2>Current active logo</h2>
          {activeLogo ? (
            <>
              <div className="active-logo-frame">
                <img src={activeLogo.logoUrl} alt="Active website logo" />
              </div>
              <p><strong>File:</strong> {activeLogo.fileName}</p>
              <p><strong>Updated:</strong> {activeLogo.updatedAt ? new Date(activeLogo.updatedAt).toLocaleString() : '-'}</p>
            </>
          ) : (
            <p className="helper-text">No active logo exists. The navbar will show the default DressShop text logo.</p>
          )}
        </section>
      </section>
    </main>
  );
}
