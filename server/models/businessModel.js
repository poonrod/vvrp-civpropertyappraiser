const pool = require('../config/db');

async function listBusinesses() {
  const [rows] = await pool.query('SELECT * FROM businesses ORDER BY created_at DESC');
  return rows;
}

async function createBusiness(data) {
  const [result] = await pool.execute(
    'INSERT INTO businesses (name, license_id, type, ceo_name) VALUES (?, ?, ?, ?)',
    [data.name, data.license_id, data.type, data.ceo_name]
  );
  return result.insertId;
}

async function getBusinessById(id) {
  const [rows] = await pool.execute('SELECT * FROM businesses WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports = { listBusinesses, createBusiness, getBusinessById };
