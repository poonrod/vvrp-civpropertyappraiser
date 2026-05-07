const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const pool = require('../config/db');
const { listUsers, updateUserRole } = require('../models/userModel');
const { listPropertiesForMap } = require('../models/propertyModel');
const { listBusinesses } = require('../models/businessModel');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'maps') });

router.get('/', requireAuth, async (req, res) => {
  const props = await listPropertiesForMap('');
  const businesses = await listBusinesses();
  const [audit] = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 30');
  res.render('admin/dashboard', {
    stats: {
      totalProperties: props.length,
      totalValue: props.reduce((sum, p) => sum + Number(p.assessed_value || 0), 0),
      residentialCount: props.filter((p) => p.type === 'Residential').length,
      commercialCount: props.filter((p) => p.type === 'Commercial').length,
      totalBusinesses: businesses.length
    },
    recentProperties: props.slice(0, 10),
    audit
  });
});

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const users = await listUsers();
  const [logs] = await pool.query('SELECT ll.*, u.username FROM login_logs ll LEFT JOIN users u ON u.id = ll.user_id ORDER BY ll.created_at DESC LIMIT 100');
  res.render('admin/users', { users, logs });
});

router.post('/users/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  await updateUserRole(req.params.id, req.body.role);
  res.redirect('/admin/users');
});

router.post('/maps/upload', requireAuth, requireRole('admin'), upload.single('map_image'), async (req, res) => {
  const bounds = JSON.stringify(req.body.bounds ? JSON.parse(req.body.bounds) : [[0, 0], [1080, 1920]]);
  await pool.execute(
    'INSERT INTO map_configs (map_image_path, bounds, min_zoom, max_zoom, created_by) VALUES (?, ?, ?, ?, ?)',
    [`/uploads/maps/${path.basename(req.file.path)}`, bounds, Number(req.body.min_zoom || -3), Number(req.body.max_zoom || 3), req.session.user.id]
  );
  res.redirect('/admin');
});

router.post('/maps/reset', requireAuth, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM properties');
  res.redirect('/admin');
});

router.get('/export/sql', requireAuth, requireRole('admin'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM properties');
  res.setHeader('Content-Type', 'application/sql');
  res.setHeader('Content-Disposition', 'attachment; filename="properties_export.sql"');
  const values = rows.map((r) => `('${r.parcel_id}', '${r.name.replace(/'/g, "''")}')`).join(',\n');
  res.send(`INSERT INTO properties (parcel_id, name) VALUES\n${values};`);
});

router.post('/import/geojson', requireAuth, requireRole('admin'), express.json(), async (req, res) => {
  const features = req.body.features || [];
  for (const feature of features) {
    await pool.execute(
      `INSERT INTO properties (parcel_id, name, type, address, geojson, owner_type, owner_name, purchase_price, assessed_value, tax_rate, annual_tax, status, created_by)
       VALUES (?, ?, 'Vacant Land', 'Unknown', ?, 'Individual', 'Unknown', 0, 0, 0, 0, 'Owned', ?)`,
      [`IMP-${Date.now()}-${Math.floor(Math.random() * 9999)}`, feature.properties?.name || 'Imported Parcel', JSON.stringify(feature.geometry), req.session.user.id]
    );
  }
  res.json({ imported: features.length });
});

module.exports = router;
