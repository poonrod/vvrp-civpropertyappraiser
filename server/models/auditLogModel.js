const mongoose = require('mongoose');
const { AuditLog } = require('./schemas');

async function createAuditLog({ userId, action, tableName, recordId, oldData, newData }) {
  await AuditLog.create({
    user_id: new mongoose.Types.ObjectId(userId),
    action,
    table_name: tableName,
    record_id: recordId,
    old_data: oldData ?? null,
    new_data: newData ?? null
  });
}

module.exports = { createAuditLog };
