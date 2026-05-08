const express = require('express');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const { AuditLog, LoginLog, Property, PropertyTransaction } = require('../models/schemas');
const { listUsers, updateUserRole } = require('../models/userModel');
const { listPropertiesForMap, createProperty } = require('../models/propertyModel');
const { listBusinesses } = require('../models/businessModel');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const props = await listPropertiesForMap('');
  const businesses = await listBusinesses();
  const audit = await AuditLog.find().sort({ created_at: -1 }).limit(30).lean();
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
  const raw = await LoginLog.find().sort({ created_at: -1 }).limit(100).populate('user_id', 'username').lean();
  const logs = raw.map((l) => ({
    ...l,
    username: l.user_id && l.user_id.username ? l.user_id.username : null
  }));
  res.render('admin/users', { users, logs });
});

router.post('/users/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  await updateUserRole(req.params.id, req.body.role);
  res.redirect('/admin/users');
});

router.post('/maps/reset', requireAuth, requireRole('admin'), async (req, res) => {
  await PropertyTransaction.deleteMany({});
  await Property.deleteMany({});
  res.redirect('/admin');
});

router.get('/export/json', requireAuth, requireRole('admin'), async (req, res) => {
  const rows = await Property.find().lean();
  const out = rows.map((r) => ({
    parcel_id: r.parcel_id,
    name: r.name,
    type: r.type,
    address: r.address,
    geojson: r.geojson,
    owner_type: r.owner_type,
    owner_name: r.owner_name,
    residential_owners: r.residential_owners || [],
    hide_details_public: !!r.hide_details_public,
    business_id: r.business_id ? String(r.business_id) : null,
    purchase_price: r.purchase_price,
    purchase_date: r.purchase_date,
    assessed_value: r.assessed_value,
    tax_rate: r.tax_rate,
    annual_tax: r.annual_tax,
    status: r.status,
    notes: r.notes
  }));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="properties_export.json"');
  res.send(JSON.stringify(out, null, 2));
});

router.post('/import/geojson', requireAuth, requireRole('admin'), express.json(), async (req, res) => {
  const features = req.body.features || [];
  for (const feature of features) {
    await createProperty({
      parcel_id: `IMP-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      name: feature.properties?.name || 'Imported Parcel',
      type: 'Vacant Land',
      address: 'Unknown',
      geojson: feature.geometry,
      owner_type: 'Individual',
      owner_name: 'Unknown',
      purchase_price: 0,
      assessed_value: 0,
      tax_rate: 0,
      status: 'Owned',
      created_by: req.session.user.id
    });
  }
  res.json({ imported: features.length });
});

module.exports = router;
