const geojsonValidation = require('geojson-validation');
const { validationResult } = require('express-validator');
const {
  listPropertiesForMap,
  createProperty,
  updateProperty,
  updatePropertyGeojson,
  deleteProperty,
  getPropertyById,
  calculateAnnualTax,
  DEFAULT_TAX_RATES
} = require('../models/propertyModel');

const STAFF_ROLES = ['admin', 'appraiser', 'clerk'];

function isStaff(user) {
  return !!(user && STAFF_ROLES.includes(user.role));
}

/** Strip appraiser-only fields for parcels marked hidden from the public. */
function applyPropertyVisibility(row, user) {
  if (!row) return row;
  if (isStaff(user) || !row.hide_details_public) {
    return { ...row, details_public_hidden: false };
  }
  return {
    id: row.id,
    name: row.name,
    parcel_id: row.parcel_id,
    address: row.address,
    type: row.type,
    status: row.status,
    geojson: row.geojson,
    updated_at: row.updated_at,
    hide_details_public: true,
    details_public_hidden: true
  };
}
const { createTransaction, getTransactionsByProperty } = require('../models/transactionModel');
const { createAuditLog } = require('../models/auditLogModel');
const { stringify } = require('csv-stringify/sync');
const PDFDocument = require('pdfkit');

async function safeAudit(run) {
  try {
    await run();
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

async function listProperties(req, res) {
  try {
    const rows = await listPropertiesForMap(req.query.search || '');
    const user = req.session.user || null;
    const out = rows.map((r) => {
      if (typeof r.geojson === 'string') r.geojson = JSON.parse(r.geojson);
      return applyPropertyVisibility(r, user);
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not list properties' });
  }
}

async function getOne(req, res) {
  try {
    const row = await getPropertyById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (typeof row.geojson === 'string') row.geojson = JSON.parse(row.geojson);
    const user = req.session.user || null;
    res.json(applyPropertyVisibility(row, user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load property' });
  }
}

async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (!geojsonValidation.valid(req.body.geojson)) return res.status(400).json({ error: 'Invalid GeoJSON' });

  try {
    const created = await createProperty({ ...req.body, created_by: req.session.user.id });
    await safeAudit(() =>
      createAuditLog({
        userId: req.session.user.id,
        action: 'CREATE',
        tableName: 'properties',
        recordId: created.id,
        oldData: null,
        newData: { ...req.body, parcel_id: created.parcel_id, annual_tax: created.annual_tax }
      })
    );
    res.status(201).json(created);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Duplicate parcel_id or unique constraint violation' });
    }
    if (e.name === 'ValidationError') {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: 'Could not create property' });
  }
}

async function update(req, res) {
  const current = await getPropertyById(req.params.id);
  if (!current) return res.status(404).json({ error: 'Not found' });
  try {
    const payload = { ...req.body, geojson: current.geojson };
    await updateProperty(req.params.id, payload);
    await safeAudit(() =>
      createAuditLog({
        userId: req.session.user.id,
        action: 'UPDATE',
        tableName: 'properties',
        recordId: req.params.id,
        oldData: current,
        newData: payload
      })
    );
    res.json({
      success: true,
      annual_tax: calculateAnnualTax(req.body.assessed_value, req.body.tax_rate)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update property' });
  }
}

async function updateGeo(req, res) {
  if (!geojsonValidation.valid(req.body.geojson)) return res.status(400).json({ error: 'Invalid GeoJSON' });
  try {
    await updatePropertyGeojson(req.params.id, req.body.geojson);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update geometry' });
  }
}

async function remove(req, res) {
  const current = await getPropertyById(req.params.id);
  if (!current) return res.status(404).json({ error: 'Not found' });
  try {
    await deleteProperty(req.params.id);
    await safeAudit(() =>
      createAuditLog({
        userId: req.session.user.id,
        action: 'DELETE',
        tableName: 'properties',
        recordId: req.params.id,
        oldData: current,
        newData: null
      })
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete property' });
  }
}

async function transfer(req, res) {
  const property = await getPropertyById(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property missing' });

  try {
    await createTransaction({
      property_id: property.id,
      from_owner: property.owner_name,
      to_owner: req.body.to_owner,
      sale_price: req.body.sale_price,
      transfer_date: req.body.transfer_date,
      notes: req.body.notes,
      created_by: req.session.user.id
    });

    let residential_owners = property.residential_owners || [];
    if (
      property.type === 'Residential' &&
      Array.isArray(residential_owners) &&
      residential_owners.length > 0
    ) {
      residential_owners = residential_owners.map((o, i) =>
        i === 0 ? { ...o, name: req.body.to_owner } : o
      );
    }

    await updateProperty(property.id, {
      ...property,
      owner_name: req.body.to_owner,
      owner_type: req.body.owner_type || property.owner_type,
      residential_owners
    });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not record transfer' });
  }
}

async function transactions(req, res) {
  try {
    const rows = await getTransactionsByProperty(req.params.id);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load transactions' });
  }
}

async function exportCsv(req, res) {
  const rows = await listPropertiesForMap(req.query.search || '');
  const csv = stringify(rows, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="properties.csv"');
  res.send(csv);
}

async function exportPdf(req, res) {
  const property = await getPropertyById(req.params.id);
  if (!property) return res.status(404).send('Not found');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${property.parcel_id}.pdf"`);
  const doc = new PDFDocument();
  doc.pipe(res);
  doc.fontSize(18).text('San Andreas Property Appraiser');
  doc.moveDown();
  doc.fontSize(12).text(`Property Name: ${property.name}`);
  doc.text(`Parcel ID: ${property.parcel_id}`);
  doc.text(`Address: ${property.address}`);
  if (
    property.type === 'Residential' &&
    Array.isArray(property.residential_owners) &&
    property.residential_owners.length > 0
  ) {
    doc.text('Owners:');
    property.residential_owners.forEach((o, i) => {
      doc.text(`  ${i + 1}. ${o.name} (${o.owner_type})`);
    });
  } else {
    doc.text(`Owner: ${property.owner_name} (${property.owner_type})`);
  }
  doc.text(`Purchase Price: $${Number(property.purchase_price || 0).toLocaleString()}`);
  doc.text(`Assessed Value: $${Number(property.assessed_value || 0).toLocaleString()}`);
  if (property.tax_zone) {
    doc.text(`Tax Zone: ${property.tax_zone}`);
  }
  const taxLabel = property.type === 'Residential' ? 'Residential Property Tax'
    : property.type === 'Commercial' ? 'Commercial Property Tax'
    : 'Annual Property Tax';
  doc.text(`${taxLabel}: $${Number(property.annual_tax || 0).toLocaleString()} (${Number(property.tax_rate || 0)}%)`);
  const monthlyTax = Number(property.annual_tax || 0) / 12;
  if (monthlyTax > 0) {
    doc.text(`Monthly Tax: $${monthlyTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }
  doc.text(`Status: ${property.status}`);
  doc.moveDown();
  doc.text(`Last Updated: ${property.updated_at}`);
  doc.end();
}

function taxRates(_req, res) {
  res.json(DEFAULT_TAX_RATES);
}

module.exports = {
  listProperties,
  getOne,
  create,
  update,
  updateGeo,
  remove,
  transfer,
  transactions,
  exportCsv,
  exportPdf,
  taxRates
};
