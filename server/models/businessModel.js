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

async function searchBusinesses(query) {
  if (!query || !query.trim()) return [];
  const rx = new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const rows = await Business.find({ name: rx }).sort({ name: 1 }).limit(15).lean();
  return rows.map(mapBusiness);
}

async function findOrCreateByName(name) {
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  const existing = await Business.findOne({ name: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
  if (existing) return existing._id.toString();
  const doc = await Business.create({ name: trimmed });
  return doc._id.toString();
}

module.exports = { listBusinesses, createBusiness, getBusinessById, searchBusinesses, findOrCreateByName };
