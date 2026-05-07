const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const postalsPath = path.join(__dirname, '..', 'data', 'postals.json');
const postalsOcrPath = path.join(__dirname, '..', 'data', 'postals-ocr.json');
const newPostalsPath = path.join(__dirname, '..', 'data', 'new-postals.json');

/** Matches client worldToMapSimple defaults when postals.json has no calibration */
const DEFAULT_CALIBRATION = {
  worldMinX: -4000,
  worldMaxX: 4500,
  worldMinY: -4000,
  worldMaxY: 8000
};

function normalizePostalKey(code) {
  const d = String(code || '').replace(/\D/g, '');
  if (!d || d.length < 3) return null;
  if (d.length > 4) return null;
  return d.padStart(4, '0');
}

function displayCode(paddedKey) {
  return String(parseInt(paddedKey, 10));
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** DevBlocky nearest-postal format: [{ x, y, code }] — GTA world coords */
function loadBulkWorldPostals() {
  const j = loadJson(newPostalsPath);
  if (!Array.isArray(j)) return [];
  const out = [];
  for (const row of j) {
    const wx = Number(row.x);
    const wy = Number(row.y);
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
    const k = normalizePostalKey(row.code);
    if (!k) continue;
    out.push({ code: row.code, worldX: wx, worldY: wy });
  }
  return out;
}

/**
 * 1) Bulk world coords from new-postals.json (all standard codes)
 * 2) server/data/postals.json entries override / extend
 * 3) OCR y/x override when present (label-true positions on the PNG)
 */
function mergePostalSources(baseConfig, bulkList, manualList, ocrData) {
  const merged = new Map();

  for (const p of bulkList) {
    const k = normalizePostalKey(p.code);
    if (!k) continue;
    merged.set(k, {
      code: displayCode(k),
      worldX: p.worldX,
      worldY: p.worldY,
      zoom: 3
    });
  }

  for (const p of manualList) {
    const k = normalizePostalKey(p.code);
    if (!k) continue;
    const prev = merged.get(k) || {};
    merged.set(k, { ...prev, ...p, code: displayCode(k) });
  }

  if (ocrData && Array.isArray(ocrData.postals)) {
    for (const p of ocrData.postals) {
      const k = normalizePostalKey(p.code);
      if (!k) continue;
      if (!Number.isFinite(Number(p.y)) || !Number.isFinite(Number(p.x))) continue;
      const prev = merged.get(k) || {};
      merged.set(k, {
        ...prev,
        code: displayCode(k),
        y: Number(p.y),
        x: Number(p.x),
        zoom: Number.isFinite(Number(p.zoom)) ? Number(p.zoom) : prev.zoom || 3,
        ocrConfidence: p.confidence,
        positionSource: 'ocr'
      });
    }
  }

  const mn = baseConfig.marker_nudge;
  const marker_nudge = {
    lat: Number.isFinite(Number(mn?.lat)) ? Number(mn.lat) : 0,
    lng: Number.isFinite(Number(mn?.lng)) ? Number(mn.lng) : 0
  };

  return {
    description: baseConfig.description,
    calibration: baseConfig.calibration || DEFAULT_CALIBRATION,
    bulk_world_count: bulkList.length,
    ocr_generated_at: ocrData?.generated_at || null,
    marker_nudge,
    postals: Array.from(merged.values()).sort((a, b) => Number(a.code) - Number(b.code))
  };
}

router.get('/', (req, res) => {
  try {
    const fileBase = loadJson(postalsPath);
    const baseConfig = fileBase || {
      postals: [],
      description:
        'Postal list: server/data/new-postals.json (world coords) + optional postals.json overrides + optional postals-ocr.json',
      calibration: null
    };
    const bulk = loadBulkWorldPostals();
    const ocrData = loadJson(postalsOcrPath);
    const manualList = baseConfig.postals || [];
    const ocrCount = Array.isArray(ocrData?.postals) ? ocrData.postals.length : 0;

    if (bulk.length === 0 && manualList.length === 0 && ocrCount === 0) {
      return res.json({
        postals: [],
        description:
          'Add server/data/new-postals.json (copy from DevBlocky/nearest-postal) or entries in postals.json',
        calibration: baseConfig.calibration || DEFAULT_CALIBRATION
      });
    }

    return res.json(mergePostalSources(baseConfig, bulk, manualList, ocrData));
  } catch (e) {
    return res.status(500).json({ error: 'Invalid postals data' });
  }
});

module.exports = router;
