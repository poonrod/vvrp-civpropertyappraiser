const geojsonValidation = require('geojson-validation');
const { validationResult } = require('express-validator');
const {
  listPropertiesForMap,
  createProperty,
  updateProperty,
  updatePropertyGeojson,
  deleteProperty,
  getPropertyById,
  calculateAnnualTax
} = require('../models/propertyModel');
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
    rows.forEach((r) => {
      if (typeof r.geojson === 'string') r.geojson = JSON.parse(r.geojson);
    });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not list properties' });
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
    await updateProperty(req.params.id, req.body);
    await safeAudit(() =>
      createAuditLog({
        userId: req.session.user.id,
        action: 'UPDATE',
        tableName: 'properties',
        recordId: req.params.id,
        oldData: current,
        newData: req.body
      })
    );
    res.json({ success: true, annual_tax: calculateAnnualTax(req.body.assessed_value, req.body.tax_rate) });
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

    await updateProperty(property.id, {
      ...property,
      owner_name: req.body.to_owner,
      owner_type: req.body.owner_type || property.owner_type
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
  doc.text(`Owner: ${property.owner_name} (${property.owner_type})`);
  doc.text(`Purchase Price: $${Number(property.purchase_price || 0).toLocaleString()}`);
  doc.text(`Assessed Value: $${Number(property.assessed_value || 0).toLocaleString()}`);
  doc.text(`Annual Tax: $${Number(property.annual_tax || 0).toLocaleString()}`);
  doc.text(`Status: ${property.status}`);
  doc.moveDown();
  doc.text(`Last Updated: ${property.updated_at}`);
  doc.end();
}

module.exports = { listProperties, create, update, updateGeo, remove, transfer, transactions, exportCsv, exportPdf };
