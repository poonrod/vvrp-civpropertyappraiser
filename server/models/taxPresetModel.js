const { TaxPreset } = require('./schemas');

async function listTaxPresets() {
  return TaxPreset.find().sort({ name: 1 }).lean();
}

async function getTaxPresetById(id) {
  return TaxPreset.findById(id).lean();
}

async function getTaxPresetByName(name) {
  return TaxPreset.findOne({ name }).lean();
}

async function createTaxPreset(data) {
  return TaxPreset.create({
    name: String(data.name).trim(),
    residential_rate: Number(data.residential_rate) || 0,
    commercial_rate: Number(data.commercial_rate) || 0,
    government_rate: Number(data.government_rate) || 0,
    vacant_land_rate: Number(data.vacant_land_rate) || 0
  });
}

async function updateTaxPreset(id, data) {
  return TaxPreset.findByIdAndUpdate(
    id,
    {
      name: String(data.name).trim(),
      residential_rate: Number(data.residential_rate) || 0,
      commercial_rate: Number(data.commercial_rate) || 0,
      government_rate: Number(data.government_rate) || 0,
      vacant_land_rate: Number(data.vacant_land_rate) || 0
    },
    { new: true }
  );
}

async function deleteTaxPreset(id) {
  return TaxPreset.findByIdAndDelete(id);
}

function rateForPropertyType(preset, propertyType) {
  if (!preset) return 0;
  const map = {
    Residential: preset.residential_rate,
    Commercial: preset.commercial_rate,
    Government: preset.government_rate,
    'Vacant Land': preset.vacant_land_rate
  };
  return map[propertyType] ?? 0;
}

module.exports = {
  listTaxPresets,
  getTaxPresetById,
  getTaxPresetByName,
  createTaxPreset,
  updateTaxPreset,
  deleteTaxPreset,
  rateForPropertyType
};
