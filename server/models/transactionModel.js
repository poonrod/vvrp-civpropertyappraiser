const mongoose = require('mongoose');
const { PropertyTransaction } = require('./schemas');

async function createTransaction(data) {
  const doc = await PropertyTransaction.create({
    property_id: new mongoose.Types.ObjectId(data.property_id),
    from_owner: data.from_owner,
    to_owner: data.to_owner,
    sale_price: Number(data.sale_price) || 0,
    transfer_date: new Date(data.transfer_date),
    notes: data.notes || null,
    created_by: new mongoose.Types.ObjectId(data.created_by)
  });
  return doc._id.toString();
}

async function getTransactionsByProperty(propertyId) {
  const rows = await PropertyTransaction.find({ property_id: propertyId })
    .populate('created_by', 'username')
    .sort({ transfer_date: -1 })
    .lean();
  return rows.map((r) => {
    const created = r.created_by;
    return {
      ...r,
      id: String(r._id),
      property_id: String(r.property_id),
      created_by: created && created._id ? String(created._id) : r.created_by,
      created_by_name: created && created.username ? created.username : null
    };
  });
}

module.exports = { createTransaction, getTransactionsByProperty };
