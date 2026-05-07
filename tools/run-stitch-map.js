#!/usr/bin/env node
/**
 * Stitch map/exports tiles → server/public/maps/default-map.png and sync default-map-config.json.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const metaPath = path.join(root, 'server', 'public', 'maps', 'stitched.meta.json');

const env = {
  ...process.env,
  MINIMAP_INPUT_DIR: path.join(root, 'map', 'exports'),
  MINIMAP_OUTPUT_IMAGE: path.join(root, 'server', 'public', 'maps', 'default-map.png'),
  MINIMAP_OUTPUT_META: metaPath,
  ALLOW_PARTIAL: 'true'
};

const r = spawnSync(process.execPath, [path.join(__dirname, 'stitch-minimap.js')], {
  cwd: root,
  env,
  stdio: 'inherit'
});
if (r.status !== 0) process.exit(r.status ?? 1);

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const sug = meta.leaflet_suggestion;
const cfg = {
  map_image_path: '/public/maps/default-map.png',
  bounds: sug.bounds,
  min_zoom: sug.min_zoom,
  max_zoom: sug.max_zoom
};
fs.writeFileSync(
  path.join(root, 'server', 'public', 'maps', 'default-map-config.json'),
  `${JSON.stringify(cfg, null, 2)}\n`,
  'utf8'
);
console.log('Updated server/public/maps/default-map-config.json');
