const pool = require('../config/db');

function generateParcelId() {
  const p1 = Math.floor(1000 + Math.random() * 9000);
  const p2 = Math.floor(1000 + Math.random() * 9000);
  return `SA-${p1}-${p2}`;
}

function calculateAnnualTax(assessedValue, taxRate) {
  return (Number(assessedValue) || 0) * ((Number(taxRate) || 0) / 100);
}

async function listPropertiesForMap(search = '') {
  const like = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT p.*, b.name AS business_name
      FROM properties p
      LEFT JOIN businesses b ON p.business_id = b.id
      WHERE p.owner_name LIKE ? OR p.parcel_id LIKE ? OR p.address LIKE ? OR b.name LIKE ?
      ORDER BY p.updated_at DESC`,
    [like, like, like, like]
  );
  return rows;
}

async function getPropertyById(id) {
  const [rows] = await pool.execute('SELECT * FROM properties WHERE id = ?', [id]);
  return rows[0] || null;
}

async function createProperty(data) {
  const annualTax = calculateAnnualTax(data.assessed_value, data.tax_rate);
  const parcelId = data.parcel_id || generateParcelId();
  const [result] = await pool.execute(
    `INSERT INTO properties (parcel_id, name, type, address, geojson, owner_type, owner_name, business_id,
      purchase_price, purchase_date, assessed_value, tax_rate, annual_tax, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [parcelId, data.name, data.type, data.address, JSON.stringify(data.geojson), data.owner_type, data.owner_name,
      data.business_id || null, data.purchase_price || 0, data.purchase_date || null, data.assessed_value || 0,
      data.tax_rate || 0, annualTax, data.status, data.notes || null, data.created_by]
  );
  return { id: result.insertId, parcel_id: parcelId, annual_tax: annualTax };
}

async function updateProperty(id, data) {
  const annualTax = calculateAnnualTax(data.assessed_value, data.tax_rate);
  await pool.execute(
    `UPDATE properties SET name=?, type=?, address=?, owner_type=?, owner_name=?, business_id=?,
      purchase_price=?, purchase_date=?, assessed_value=?, tax_rate=?, annual_tax=?, status=?, notes=?, updated_at=NOW()
      WHERE id=?`,
    [data.name, data.type, data.address, data.owner_type, data.owner_name, data.business_id || null,
      data.purchase_price || 0, data.purchase_date || null, data.assessed_value || 0, data.tax_rate || 0,
      annualTax, data.status, data.notes || null, id]
  );
}

async function updatePropertyGeojson(id, geojson) {
  await pool.execute('UPDATE properties SET geojson = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(geojson), id]);
}

async function deleteProperty(id) {
  await pool.execute('DELETE FROM properties WHERE id = ?', [id]);
}

module.exports = {
  listPropertiesForMap,
  getPropertyById,
  createProperty,
  updateProperty,
  updatePropertyGeojson,
  deleteProperty,
  generateParcelId,
  calculateAnnualTax
};
