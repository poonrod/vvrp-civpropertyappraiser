/**
 * Fit calibration.affine (world X,Y -> Leaflet lng,lat) from DevBlocky world coords + OCR label positions.
 * Run: node tools/fit-postal-affine.js
 * Optional: POSTAL_FIT_EXCLUDE=2051,2055 (comma-separated display codes to drop as bad OCR/world pairs)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const newPostalsPath = path.join(root, 'server', 'data', 'new-postals.json');
const ocrPath = path.join(root, 'server', 'data', 'postals-ocr.json');
/** Comma-separated display codes (e.g. 2051,2055) to drop — bad OCR/world pairs skew the fit */
const excludeCodes = new Set(
  String(process.env.POSTAL_FIT_EXCLUDE || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
);

function normalizeKey(code) {
  const d = String(code || '').replace(/\D/g, '');
  if (!d || d.length < 3 || d.length > 4) return null;
  return d.padStart(4, '0');
}

/** Solve 3x3 linear system (Gaussian elimination) */
function solve3(A, b) {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]]
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    if (Math.abs(div) < 1e-12) throw new Error('Singular matrix');
    for (let c = col; c < 4; c++) M[col][c] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

/** Least squares: target ~ beta0*wx + beta1*wy + beta2 */
function fitPlane(points) {
  let XtX = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const Xtz = [0, 0, 0];
  for (const { wx, wy, z } of points) {
    const row = [wx, wy, 1];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) XtX[j][k] += row[j] * row[k];
      Xtz[j] += row[j] * z;
    }
  }
  return solve3(XtX, Xtz);
}

function main() {
  const bulk = JSON.parse(fs.readFileSync(newPostalsPath, 'utf8'));
  const ocrData = JSON.parse(fs.readFileSync(ocrPath, 'utf8'));
  if (!Array.isArray(bulk) || !ocrData?.postals) {
    console.error('Missing bulk or OCR data');
    process.exit(1);
  }

  const worldByKey = new Map();
  for (const row of bulk) {
    const k = normalizeKey(row.code);
    if (!k) continue;
    worldByKey.set(k, { wx: Number(row.x), wy: Number(row.y) });
  }

  const pairs = [];
  for (const o of ocrData.postals) {
    const k = normalizeKey(o.code);
    if (!k) continue;
    const disp = String(parseInt(k, 10));
    if (excludeCodes.has(disp)) continue;
    const w = worldByKey.get(k);
    if (!w || !Number.isFinite(w.wx) || !Number.isFinite(w.wy)) continue;
    const lng = Number(o.x);
    const lat = Number(o.y);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    pairs.push({ wx: w.wx, wy: w.wy, lng, lat, code: disp });
  }

  if (pairs.length < 6) {
    console.error(`Need at least 6 matched OCR+world postals, got ${pairs.length}`);
    process.exit(1);
  }
  if (excludeCodes.size) {
    console.log(`Excluding codes from fit: ${[...excludeCodes].join(', ')}`);
  }

  const px = fitPlane(pairs.map((p) => ({ wx: p.wx, wy: p.wy, z: p.lng })));
  const py = fitPlane(pairs.map((p) => ({ wx: p.wx, wy: p.wy, z: p.lat })));

  let maxLngErr = 0;
  let maxLatErr = 0;
  let sumSq = 0;
  for (const p of pairs) {
    const plng = px[0] * p.wx + px[1] * p.wy + px[2];
    const plat = py[0] * p.wx + py[1] * p.wy + py[2];
    const el = Math.abs(plng - p.lng);
    const ea = Math.abs(plat - p.lat);
    maxLngErr = Math.max(maxLngErr, el);
    maxLatErr = Math.max(maxLatErr, ea);
    sumSq += el * el + ea * ea;
  }

  console.log(`Fitted affine using ${pairs.length} world↔OCR pairs.`);
  console.log(`Max error (lng px): ${maxLngErr.toFixed(2)}, (lat px): ${maxLatErr.toFixed(2)}`);
  console.log(`RMS per axis ~ ${Math.sqrt(sumSq / (2 * pairs.length)).toFixed(2)} px`);

  const affine = { px, py };
  const outPath = path.join(root, 'server', 'data', 'postal-calibration-fit.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        description:
          'Least-squares affine from tools/fit-postal-affine.js — paste into postals.json calibration',
        pair_count: pairs.length,
        affine,
        world_bounds_note:
          'When affine is set, worldMin/Max are ignored for projection; keep for documentation.',
        max_error_lng: maxLngErr,
        max_error_lat: maxLatErr
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`Wrote ${path.relative(root, outPath)}`);
  console.log('\nPaste into server/data/postals.json under calibration:\n');
  console.log(JSON.stringify({ affine: { px, py }, worldLabelNudgeLat: 0, worldLabelNudgeLng: 0 }, null, 2));
}

main();
