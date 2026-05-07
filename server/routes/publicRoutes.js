const express = require('express');
const fs = require('fs');
const path = require('path');
const { MapConfig } = require('../models/schemas');

const router = express.Router();

function loadMetaFallback() {
  try {
    const metaPath = path.join(__dirname, '..', 'uploads', 'maps', 'san-andreas.meta.json');
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return meta.leaflet_suggestion || null;
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  let config = null;
  try {
    const doc = await MapConfig.findOne().sort({ created_at: -1 }).lean();
    if (doc) {
      config = {
        map_image_path: doc.map_image_path,
        bounds: doc.bounds,
        min_zoom: doc.min_zoom,
        max_zoom: doc.max_zoom
      };
    }
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[publicRoutes]', e.message);
  }
  if (!config) config = loadMetaFallback();
  res.render('index', { config: config || {} });
});

module.exports = router;
