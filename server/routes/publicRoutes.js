const express = require('express');
const fs = require('fs');
const path = require('path');
const { DEFAULT_TAX_RATES } = require('../models/propertyModel');
const { listTaxPresets } = require('../models/taxPresetModel');
const { getSetting } = require('../models/appSettingModel');

const router = express.Router();

const BUNDLED_MAP_CONFIG = path.join(__dirname, '..', 'public', 'maps', 'default-map-config.json');

function normalizeMapConfig(raw) {
  if (!raw) return null;
  const src = raw.leaflet_suggestion || raw;
  if (!src.map_image_path || !src.bounds) return null;
  return {
    map_image_path: src.map_image_path,
    bounds: src.bounds,
    min_zoom: Number(src.min_zoom ?? -3),
    max_zoom: Number(src.max_zoom ?? 3)
  };
}

function loadBundledMapConfig() {
  const meta = JSON.parse(fs.readFileSync(BUNDLED_MAP_CONFIG, 'utf8'));
  const cfg = normalizeMapConfig(meta);
  if (!cfg) throw new Error('Invalid default-map-config.json');
  return cfg;
}

router.get('/', async (req, res) => {
  let config = {};
  try {
    config = loadBundledMapConfig();
  } catch (e) {
    console.error('[publicRoutes] Bundled map config missing or invalid:', e.message);
  }
  let taxPresets = [];
  let pricePerSqft = 0;
  try {
    taxPresets = await listTaxPresets();
  } catch (e) {
    console.error('[publicRoutes] Could not load tax presets:', e.message);
  }
  try {
    pricePerSqft = Number(await getSetting('price_per_sqft')) || 0;
  } catch (e) {
    console.error('[publicRoutes] Could not load price_per_sqft:', e.message);
  }
  res.render('index', { config, taxRates: DEFAULT_TAX_RATES, taxPresets, pricePerSqft });
});

module.exports = router;
