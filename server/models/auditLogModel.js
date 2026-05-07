const pool = require('../config/db');

async function createAuditLog({ userId, action, tableName, recordId, oldData, newData }) {
  await pool.execute(
    `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, action, tableName, recordId, oldData ? JSON.stringify(oldData) : null, newData ? JSON.stringify(newData) : null]
  );
}

module.exports = { createAuditLog };
