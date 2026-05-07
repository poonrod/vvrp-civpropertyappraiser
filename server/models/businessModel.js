const mongoose = require('mongoose');
const { Business } = require('./schemas');

function mapBusiness(b) {
  if (!b) return null;
  const o = b.toObject ? b.toObject() : b;
  return {
    id: String(o._id),
    name: o.name,
    license_id: o.license_id,
    type: o.type,
    ceo_name: o.ceo_name,
    created_at: o.created_at,
    updated_at: o.updated_at
  };
}

async function listBusinesses() {
  const rows = await Business.find().sort({ created_at: -1 }).lean();
  return rows.map(mapBusiness);
}

async function createBusiness(data) {
  const doc = await Business.create({
    name: data.name,
    license_id: data.license_id,
    type: data.type,
    ceo_name: data.ceo_name
  });
  return doc._id.toString();
}

async function getBusinessById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const row = await Business.findById(id).lean();
  return row ? mapBusiness(row) : null;
}

module.exports = { listBusinesses, createBusiness, getBusinessById };
