const express = require('express');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const { AuditLog, LoginLog, Property, PropertyTransaction, District } = require('../models/schemas');
const { listUsers, updateUserRole } = require('../models/userModel');
const { listPropertiesForMap, createProperty, bulkRecalcAssessedValues } = require('../models/propertyModel');
const { listBusinesses } = require('../models/businessModel');
const {
  listTaxPresets,
  createTaxPreset,
  updateTaxPreset,
  deleteTaxPreset
} = require('../models/taxPresetModel');
const { getSetting, setSetting, getSettings } = require('../models/appSettingModel');
const { invalidateModuleCache, requireModule } = require('../middleware/moduleMiddleware');
const { MODULE_DEFINITIONS, MODULE_CATEGORIES, getDefaultModules } = require('../config/moduleDefinitions');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const props = await listPropertiesForMap('');
  const businesses = await listBusinesses();
  const audit = await AuditLog.find().sort({ created_at: -1 }).limit(30).lean();
  const residentialProps = props.filter((p) => p.type === 'Residential');
  const commercialProps = props.filter((p) => p.type === 'Commercial');
  const residentialTaxRevenue = residentialProps.reduce((sum, p) => sum + Number(p.annual_tax || 0), 0);
  const commercialTaxRevenue = commercialProps.reduce((sum, p) => sum + Number(p.annual_tax || 0), 0);
  const totalTaxRevenue = props.reduce((sum, p) => sum + Number(p.annual_tax || 0), 0);

  res.render('admin/dashboard', {
    stats: {
      totalProperties: props.length,
      totalValue: props.reduce((sum, p) => sum + Number(p.assessed_value || 0), 0),
      residentialCount: residentialProps.length,
      commercialCount: commercialProps.length,
      totalBusinesses: businesses.length,
      residentialTaxRevenue,
      commercialTaxRevenue,
      totalTaxRevenue
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
    square_footage: r.square_footage || 0,
    tax_zone: r.tax_zone || null,
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

router.get('/settings', requireAuth, requireRole('admin'), async (req, res) => {
  const presets = await listTaxPresets();
  const settings = await getSettings(['price_per_sqft', 'discord_webhook_url']);
  const storedModules = await getSetting('modules');
  const defaults = getDefaultModules();
  const moduleStates = { ...defaults, ...(storedModules && typeof storedModules === 'object' ? storedModules : {}) };
  const districts = moduleStates.districts ? await District.find().sort({ name: 1 }).lean() : [];
  res.render('admin/settings', {
    presets,
    error: req.query.error || null,
    pricePerSqft: settings.price_per_sqft || 0,
    discordWebhookUrl: settings.discord_webhook_url || '',
    moduleDefinitions: MODULE_DEFINITIONS,
    moduleCategories: MODULE_CATEGORIES,
    moduleStates,
    districts
  });
});

router.post('/settings/modules/toggle', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { key, enabled } = req.body;
    if (!key || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const valid = MODULE_DEFINITIONS.some((m) => m.key === key);
    if (!valid) return res.status(400).json({ error: 'Unknown module key' });
    const stored = await getSetting('modules');
    const defaults = getDefaultModules();
    const current = { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
    current[key] = enabled;
    await setSetting('modules', current);
    invalidateModuleCache();
    return res.json({ ok: true, key, enabled });
  } catch (e) {
    console.error('[admin] module toggle error:', e);
    return res.status(500).json({ error: 'Failed to toggle module' });
  }
});

router.post('/settings/general', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const newPrice = Number(req.body.price_per_sqft) || 0;
    const oldPrice = Number(await getSetting('price_per_sqft')) || 0;
    await setSetting('price_per_sqft', newPrice);
    await setSetting('discord_webhook_url', String(req.body.discord_webhook_url || '').trim());
    if (newPrice > 0 && newPrice !== oldPrice) {
      const count = await bulkRecalcAssessedValues(newPrice);
      console.log(`[admin] Recalculated assessed values for ${count} properties at $${newPrice}/sqft`);
    }
  } catch (e) {
    console.error(e);
  }
  res.redirect('/admin/settings');
});

router.post('/settings/tax-presets', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await createTaxPreset(req.body);
  } catch (e) {
    if (e.code === 11000) {
      return res.redirect('/admin/settings?error=duplicate');
    }
    console.error(e);
  }
  res.redirect('/admin/settings');
});

router.post('/settings/tax-presets/:id/update', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await updateTaxPreset(req.params.id, req.body);
  } catch (e) {
    console.error(e);
  }
  res.redirect('/admin/settings');
});

router.post('/settings/tax-presets/:id/delete', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await deleteTaxPreset(req.params.id);
  } catch (e) {
    console.error(e);
  }
  res.redirect('/admin/settings');
});

router.get('/webhooks', requireAuth, requireRole('admin'), requireModule('webhook_events'), (req, res) => {
  res.render('admin/webhooks', { user: req.session.user, csrfToken: req.csrfToken() });
});

router.get('/audit-digest', requireAuth, requireRole('admin'), requireModule('audit_digest'), (req, res) => {
  res.render('admin/audit-digest', { user: req.session.user, csrfToken: req.csrfToken() });
});

router.get('/integrations', requireAuth, requireRole('admin'), (req, res) => {
  res.render('admin/integrations', { user: req.session.user, modules: res.locals.modules || {} });
});

module.exports = router;
