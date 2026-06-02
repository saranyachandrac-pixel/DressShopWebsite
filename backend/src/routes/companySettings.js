const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function mapCompanySettings(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.company_name,
    logoUrl: row.logo_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getCurrentSettings() {
  const [rows] = await pool.execute(
    `SELECT id, company_name, logo_url, created_at, updated_at
     FROM company_settings
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

router.get('/company-settings', asyncHandler(async (req, res) => {
  const settings = await getCurrentSettings();
  res.json({ settings: mapCompanySettings(settings) });
}));

router.post('/admin/company-settings', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const companyName = String(req.body.companyName || req.body.company_name || '').trim();
  if (!companyName) return res.status(400).json({ message: 'Company name is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('DELETE FROM company_settings');
    const [result] = await connection.execute(
      'INSERT INTO company_settings (company_name, logo_url) VALUES (?, ?)',
      [companyName, req.body.logoUrl || req.body.logo_url || null]
    );
    const [rows] = await connection.execute('SELECT * FROM company_settings WHERE id = ?', [result.insertId]);
    await connection.commit();
    return res.status(201).json({ message: 'Company name saved successfully.', settings: mapCompanySettings(rows[0]) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.put('/admin/company-settings/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const companyName = String(req.body.companyName || req.body.company_name || '').trim();
  if (!companyName) return res.status(400).json({ message: 'Company name is required.' });

  const [existing] = await pool.execute('SELECT id FROM company_settings WHERE id = ?', [req.params.id]);
  if (!existing.length) return res.status(404).json({ message: 'Company settings not found.' });

  await pool.execute(
    'UPDATE company_settings SET company_name = ?, logo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [companyName, req.body.logoUrl || req.body.logo_url || null, req.params.id]
  );
  const [rows] = await pool.execute('SELECT * FROM company_settings WHERE id = ?', [req.params.id]);
  res.json({ message: 'Company name updated successfully.', settings: mapCompanySettings(rows[0]) });
}));

router.delete('/admin/company-settings/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const [result] = await pool.execute('DELETE FROM company_settings WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Company settings not found.' });
  res.json({ message: 'Company name deleted successfully.' });
}));

module.exports = router;
