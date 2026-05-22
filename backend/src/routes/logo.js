const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'logos');
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename(req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExtensions.has(ext) || !allowedMimeTypes.has(file.mimetype)) {
      return callback(new Error('Only jpg, jpeg, png, and webp logo files are allowed.'));
    }
    callback(null, true);
  }
});

function mapLogo(row) {
  if (!row) return null;
  return {
    id: row.id,
    logoUrl: row.logo_url,
    fileName: row.file_name,
    isActive: Boolean(row.is_active),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function logoUrl(req, fileName) {
  return `${req.protocol}://${req.get('host')}/uploads/logos/${fileName}`;
}

function deleteLogoFile(fileName) {
  if (!fileName) return;
  const filePath = path.join(uploadDir, path.basename(fileName));
  fs.promises.unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') console.error('Could not delete logo file:', error);
  });
}

router.get('/logo', asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, logo_url, file_name, is_active, created_by, created_at, updated_at
     FROM site_logos
     WHERE is_active = TRUE
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  );
  res.json({ logo: mapLogo(rows[0]) });
}));

router.post('/admin/logo', authenticate, requireAdmin, upload.single('logo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Logo image file is required.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [activeLogos] = await connection.execute('SELECT file_name FROM site_logos WHERE is_active = TRUE FOR UPDATE');
    await connection.execute('UPDATE site_logos SET is_active = FALSE WHERE is_active = TRUE');
    const url = logoUrl(req, req.file.filename);
    const [result] = await connection.execute(
      `INSERT INTO site_logos (logo_url, file_name, is_active, created_by)
       VALUES (?, ?, TRUE, ?)`,
      [url, req.file.filename, req.user.id]
    );
    await connection.commit();
    activeLogos.forEach((logo) => deleteLogoFile(logo.file_name));
    res.status(201).json({
      message: 'Logo uploaded successfully.',
      logo: mapLogo({ id: result.insertId, logo_url: url, file_name: req.file.filename, is_active: true, created_by: req.user.id })
    });
  } catch (error) {
    await connection.rollback();
    deleteLogoFile(req.file.filename);
    throw error;
  } finally {
    connection.release();
  }
}));

router.put('/admin/logo/:id', authenticate, requireAdmin, upload.single('logo'), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM site_logos WHERE id = ?', [req.params.id]);
  const existing = rows[0];
  if (!existing) {
    if (req.file) deleteLogoFile(req.file.filename);
    return res.status(404).json({ message: 'Logo not found.' });
  }

  const nextFileName = req.file?.filename || existing.file_name;
  const nextLogoUrl = req.file ? logoUrl(req, req.file.filename) : existing.logo_url;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [activeLogos] = await connection.execute(
      'SELECT id, file_name FROM site_logos WHERE is_active = TRUE AND id <> ? FOR UPDATE',
      [req.params.id]
    );
    await connection.execute('UPDATE site_logos SET is_active = FALSE WHERE id <> ?', [req.params.id]);
    await connection.execute(
      `UPDATE site_logos
       SET logo_url = ?, file_name = ?, is_active = TRUE, created_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextLogoUrl, nextFileName, req.user.id, req.params.id]
    );
    await connection.commit();
    activeLogos.forEach((logo) => deleteLogoFile(logo.file_name));
    if (req.file && existing.file_name !== req.file.filename) deleteLogoFile(existing.file_name);
    res.json({
      message: 'Logo updated successfully.',
      logo: mapLogo({ ...existing, logo_url: nextLogoUrl, file_name: nextFileName, is_active: true, created_by: req.user.id })
    });
  } catch (error) {
    await connection.rollback();
    if (req.file) deleteLogoFile(req.file.filename);
    throw error;
  } finally {
    connection.release();
  }
}));

router.delete('/admin/logo/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM site_logos WHERE id = ?', [req.params.id]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ message: 'Logo not found.' });

  await pool.execute('DELETE FROM site_logos WHERE id = ?', [req.params.id]);
  deleteLogoFile(existing.file_name);
  res.json({ message: 'Logo removed successfully.' });
}));

module.exports = router;
