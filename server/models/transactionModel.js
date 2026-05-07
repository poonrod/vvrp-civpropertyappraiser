const pool = require('../config/db');

async function createTransaction(data) {
  const [result] = await pool.execute(
    `INSERT INTO property_transactions (property_id, from_owner, to_owner, sale_price, transfer_date, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.property_id, data.from_owner, data.to_owner, data.sale_price, data.transfer_date, data.notes || null, data.created_by]
  );
  return result.insertId;
}

async function getTransactionsByProperty(propertyId) {
  const [rows] = await pool.execute(
    'SELECT pt.*, u.username AS created_by_name FROM property_transactions pt LEFT JOIN users u ON u.id = pt.created_by WHERE property_id = ? ORDER BY transfer_date DESC',
    [propertyId]
  );
  return rows;
}

module.exports = { createTransaction, getTransactionsByProperty };
