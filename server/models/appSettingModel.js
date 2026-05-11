const { AppSetting } = require('./schemas');

async function getSetting(key) {
  const doc = await AppSetting.findOne({ key }).lean();
  return doc ? doc.value : null;
}

async function setSetting(key, value) {
  await AppSetting.findOneAndUpdate(
    { key },
    { key, value },
    { upsert: true, new: true }
  );
}

async function getSettings(keys) {
  const docs = await AppSetting.find({ key: { $in: keys } }).lean();
  const map = {};
  for (const d of docs) map[d.key] = d.value;
  return map;
}

module.exports = { getSetting, setSetting, getSettings };
