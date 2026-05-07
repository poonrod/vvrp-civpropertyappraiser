const express = require('express');
const fs = require('fs');
const path = require('path');

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

router.get('/', (req, res) => {
  let config = {};
  try {
    config = loadBundledMapConfig();
  } catch (e) {
    console.error('[publicRoutes] Bundled map config missing or invalid:', e.message);
  }
  res.render('index', { config });
});

module.exports = router;
