const mongoose = require('mongoose');
const { Property, Business, PropertyTransaction } = require('./schemas');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapPropertyRow(p) {
  if (!p) return null;
  const id = String(p._id);
  let business_name = null;
  let business_id = null;
  const bid = p.business_id;
  if (bid && typeof bid === 'object' && bid.name !== undefined) {
    business_name = bid.name;
    business_id = String(bid._id);
  } else if (bid) {
    business_id = String(bid);
  }
  let geojson = p.geojson;
  if (typeof geojson === 'string') geojson = JSON.parse(geojson);
  const { _id, business_id: _b, ...rest } = p;
  const residential_owners = Array.isArray(p.residential_owners) ? p.residential_owners : [];
  return {
    ...rest,
    id,
    business_id,
    business_name,
    residential_owners,
    hide_details_public: !!p.hide_details_public,
    geojson
  };
}

function normalizeResidentialOwners(type, ownersInput, ownerName, ownerType) {
  const fallbackName = ownerName != null ? String(ownerName).trim() : '';
  const fallbackOt = ownerType === 'Business' ? 'Business' : 'Individual';
  if (type !== 'Residential') {
    return {
      residential_owners: [],
      owner_name: fallbackName || 'Unknown',
      owner_type: fallbackOt
    };
  }
  let list = Array.isArray(ownersInput) ? ownersInput : [];
  list = list
    .filter((o) => o && String(o.name || '').trim())
    .map((o) => ({
      name: String(o.name).trim(),
      owner_type: o.owner_type === 'Business' ? 'Business' : 'Individual'
    }));
  if (list.length === 0 && fallbackName) {
    list = [{ name: fallbackName, owner_type: fallbackOt }];
  }
  if (list.length === 0) {
    list = [{ name: 'Unknown', owner_type: 'Individual' }];
  }
  const primary = list[0];
  return {
    residential_owners: list,
    owner_name: primary.name,
    owner_type: primary.owner_type
  };
}

function generateParcelId() {
  const p1 = Math.floor(1000 + Math.random() * 9000);
  const p2 = Math.floor(1000 + Math.random() * 9000);
  return `SA-${p1}-${p2}`;
}

const DEFAULT_TAX_RATES = {
  Residential: 1.1,
  Commercial: 1.25,
  Government: 0,
  'Vacant Land': 0.5
};

function defaultTaxRateForType(propertyType) {
  return DEFAULT_TAX_RATES[propertyType] ?? 0;
}

function calculateAnnualTax(assessedValue, taxRate) {
  return (Number(assessedValue) || 0) * ((Number(taxRate) || 0) / 100);
}

function toBusinessObjectId(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'object' && val._id) return val._id;
  const s = String(val);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

async function listPropertiesForMap(search = '') {
  const q = search.trim();
  let filter = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const matchingBusinesses = await Business.find({ name: rx }).select('_id').lean();
    const businessIds = matchingBusinesses.map((b) => b._id);
    filter = {
      $or: [
        { name: rx },
        { owner_name: rx },
        { parcel_id: rx },
        { address: rx },
        { notes: rx },
        { residential_owners: { $elemMatch: { name: rx } } },
        ...(businessIds.length ? [{ business_id: { $in: businessIds } }] : [])
      ]
    };
  }
  const rows = await Property.find(filter)
    .populate({ path: 'business_id', select: 'name' })
    .sort({ updated_at: -1 })
    .lean();
  return rows.map(mapPropertyRow);
}

async function getPropertyById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  try {
    const row = await Property.findById(id).populate({ path: 'business_id', select: 'name' }).lean();
    return row ? mapPropertyRow(row) : null;
  } catch {
    return null;
  }
}

async function createProperty(data) {
  const annualTax = calculateAnnualTax(data.assessed_value, data.tax_rate);
  const parcelId = data.parcel_id || generateParcelId();
  const own = normalizeResidentialOwners(
    data.type,
    data.residential_owners,
    data.owner_name,
    data.owner_type
  );
  const doc = await Property.create({
    parcel_id: parcelId,
    name: data.name,
    type: data.type,
    address: data.address,
    geojson: data.geojson,
    owner_type: own.owner_type,
    owner_name: own.owner_name,
    residential_owners: own.residential_owners,
    hide_details_public: !!data.hide_details_public,
    business_id: toBusinessObjectId(data.business_id),
    purchase_price: Number(data.purchase_price) || 0,
    purchase_date: data.purchase_date ? new Date(data.purchase_date) : null,
    assessed_value: Number(data.assessed_value) || 0,
    tax_zone: data.tax_zone || null,
    tax_rate: Number(data.tax_rate) || 0,
    annual_tax: annualTax,
    status: data.status,
    notes: data.notes ?? null,
    created_by: new mongoose.Types.ObjectId(data.created_by)
  });
  return { id: doc._id.toString(), parcel_id: parcelId, annual_tax: annualTax };
}

async function updateProperty(id, data) {
  const annualTax = calculateAnnualTax(data.assessed_value, data.tax_rate);
  const own = normalizeResidentialOwners(
    data.type,
    data.residential_owners,
    data.owner_name,
    data.owner_type
  );
  await Property.findByIdAndUpdate(id, {
    name: data.name,
    type: data.type,
    address: data.address,
    owner_type: own.owner_type,
    owner_name: own.owner_name,
    residential_owners: own.residential_owners,
    hide_details_public: !!data.hide_details_public,
    business_id: toBusinessObjectId(data.business_id),
    purchase_price: Number(data.purchase_price) || 0,
    purchase_date: data.purchase_date ? new Date(data.purchase_date) : null,
    assessed_value: Number(data.assessed_value) || 0,
    tax_zone: data.tax_zone || null,
    tax_rate: Number(data.tax_rate) || 0,
    annual_tax: annualTax,
    status: data.status,
    notes: data.notes ?? null
  });
}

async function updatePropertyGeojson(id, geojson) {
  await Property.findByIdAndUpdate(id, { geojson });
}

async function deleteProperty(id) {
  await PropertyTransaction.deleteMany({ property_id: id });
  await Property.findByIdAndDelete(id);
}

module.exports = {
  listPropertiesForMap,
  getPropertyById,
  createProperty,
  updateProperty,
  updatePropertyGeojson,
  deleteProperty,
  generateParcelId,
  calculateAnnualTax,
  DEFAULT_TAX_RATES,
  defaultTaxRateForType
};
