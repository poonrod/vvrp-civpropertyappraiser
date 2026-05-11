const { PropertyRequest } = require('./schemas');

async function createRequest(data) {
  return PropertyRequest.create({
    type: data.type,
    owner_name: String(data.owner_name || '').trim() || 'Unknown',
    owner_type: data.owner_type === 'Business' ? 'Business' : 'Individual',
    business_name: data.business_name ? String(data.business_name).trim() : null,
    address: String(data.address || '').trim(),
    postal: String(data.postal || '').trim(),
    purchase_price: Number(data.purchase_price) || 0,
    square_footage: Number(data.square_footage) || 0,
    residential_owners: Array.isArray(data.residential_owners)
      ? data.residential_owners.filter((o) => o && String(o.name || '').trim()).map((o) => ({
          name: String(o.name).trim(),
          owner_type: o.owner_type === 'Business' ? 'Business' : 'Individual'
        }))
      : [],
    notes: data.notes ? String(data.notes).trim() : null,
    discord_name: String(data.discord_name || '').trim(),
    status: 'pending'
  });
}

async function listPendingRequests() {
  return PropertyRequest.find({ status: 'pending' }).sort({ created_at: -1 }).lean();
}

async function listAllRequests() {
  return PropertyRequest.find().sort({ created_at: -1 }).lean();
}

async function markCompleted(id) {
  return PropertyRequest.findByIdAndUpdate(id, { status: 'completed' }, { new: true });
}

module.exports = { createRequest, listPendingRequests, listAllRequests, markCompleted };
