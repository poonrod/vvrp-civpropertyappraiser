const express = require('express');
const fs = require('fs');
const path = require('path');
const { MapConfig } = require('../models/schemas');

const router = express.Router();

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

/** Prefer stitched upload meta; then bundled default shipped with the app (deploy has no uploads/). */
function loadMetaFallback() {
  const candidates = [
    path.join(__dirname, '..', 'uploads', 'maps', 'san-andreas.meta.json'),
    path.join(__dirname, '..', 'public', 'maps', 'default-map-config.json')
  ];
  for (const metaPath of candidates) {
    try {
      if (!fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const cfg = normalizeMapConfig(meta);
      if (cfg) return cfg;
    } catch {
      /* try next */
    }
  }
  return null;
}

router.get('/', async (req, res) => {
  let config = null;
  try {
    const doc = await MapConfig.findOne().sort({ created_at: -1 }).lean();
    if (doc) {
      config = normalizeMapConfig({
        leaflet_suggestion: {
          map_image_path: doc.map_image_path,
          bounds: doc.bounds,
          min_zoom: doc.min_zoom,
          max_zoom: doc.max_zoom
        }
      });
    }
  } catch (e) {
    console.warn('[publicRoutes] MapConfig:', e.message);
  }
  if (!config) config = loadMetaFallback();
  res.render('index', { config: config || {} });
});

module.exports = router;
