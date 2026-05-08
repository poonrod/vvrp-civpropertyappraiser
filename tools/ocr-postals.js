/**
 * Scan the stitched minimap PNG for 3–4 digit postal labels (white-on-dark style maps).
 * Writes server/data/postals-ocr.json for the API to merge into /api/postals.
 *
 * Usage:
 *   npm run map:ocr-postals
 *   OCR_INPUT=path/to/map.png OCR_OUTPUT=path/to/out.json node tools/ocr-postals.js
 *
 * Env: OCR_TILE (default 2048), OCR_OVERLAP (default 224), OCR_MIN_CONF (default 55),
 *      OCR_PSM (default 6 single block), OCR_SCALE (default 1), OCR_STRICT_FOUR (default 1 — only 4-digit labels),
 *      OCR_MAX_TILES (optional limit for testing)
 */
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { createWorker, PSM } = require('tesseract.js');

const projectRoot = path.resolve(__dirname, '..');
const inputImage =
  process.env.OCR_INPUT || path.join(projectRoot, 'server', 'public', 'maps', 'default-map.png');
const outputJson =
  process.env.OCR_OUTPUT || path.join(projectRoot, 'server', 'data', 'postals-ocr.json');

const TILE = Math.max(512, Number(process.env.OCR_TILE || 2048));
const OVERLAP = Math.max(0, Number(process.env.OCR_OVERLAP || 224));
const MIN_CONF = Math.max(0, Number(process.env.OCR_MIN_CONF || 55));
const OCR_SCALE = Math.min(1, Math.max(0.25, Number(process.env.OCR_SCALE || 1)));
/** Default SINGLE_BLOCK: sparse/negate often returns nothing on white-on-dark postal maps */
const PSM_MODE = String(process.env.OCR_PSM || PSM.SINGLE_BLOCK);
const DEFAULT_ZOOM = Math.min(6, Math.max(1, Number(process.env.OCR_DEFAULT_ZOOM || 3)));
/** Limit tiles for a quick test pass (e.g. OCR_MAX_TILES=3) */
const MAX_TILES = Math.max(0, Number(process.env.OCR_MAX_TILES || 0));
/** Most GTA postal maps use 4 digits; set OCR_STRICT_FOUR=0 to allow 3-digit reads */
const STRICT_FOUR = process.env.OCR_STRICT_FOUR !== '0';

const POSTAL_RE = STRICT_FOUR ? /^\d{4}$/ : /^\d{3,4}$/;

function normCode(raw) {
  const cleaned = String(raw || '')
    .replace(/[“”"']/g, '')
    .replace(/\D/g, '');
  if (!POSTAL_RE.test(cleaned)) return null;
  return cleaned.padStart(4, '0');
}

function wordCenter(bbox) {
  if (!bbox) return null;
  const x0 = Number(bbox.x0 ?? bbox.left);
  const y0 = Number(bbox.y0 ?? bbox.top);
  const x1 = Number(bbox.x1 ?? bbox.right);
  const y1 = Number(bbox.y1 ?? bbox.bottom);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

function clusterDetections(raw) {
  const byCode = new Map();
  for (const d of raw) {
    const list = byCode.get(d.code) || [];
    list.push(d);
    byCode.set(d.code, list);
  }
  const out = [];
  const MERGE_PX = 90;
  for (const [code, list] of byCode) {
    const clusters = [];
    for (const d of list) {
      let placed = false;
      for (const c of clusters) {
        const rep = c[0];
        if (Math.hypot(d.x - rep.x, d.y - rep.y) < MERGE_PX) {
          c.push(d);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([d]);
    }
    for (const c of clusters) {
      let sumW = 0;
      let cx = 0;
      let cy = 0;
      let bestConf = 0;
      for (const d of c) {
        const w = Math.max(1, d.confidence || 1);
        cx += d.x * w;
        cy += d.y * w;
        sumW += w;
        bestConf = Math.max(bestConf, d.confidence || 0);
      }
      out.push({
        code: String(parseInt(code, 10)),
        y: cy / sumW,
        x: cx / sumW,
        zoom: DEFAULT_ZOOM,
        confidence: Math.round(bestConf)
      });
    }
  }
  out.sort((a, b) => Number(a.code) - Number(b.code));
  return out;
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const stat = await fs.stat(inputImage).catch(() => null);
  if (!stat || !stat.isFile()) {
    console.error(`OCR input not found: ${inputImage}\nRun npm run map:stitch first or set OCR_INPUT.`);
    process.exit(1);
  }

  const { width: W0, height: H0 } = await sharp(inputImage).metadata();
  if (!W0 || !H0) {
    console.error('Could not read image dimensions.');
    process.exit(1);
  }

  const width = Math.round(W0 * OCR_SCALE);
  const height = Math.round(H0 * OCR_SCALE);
  const invScale = W0 / width;

  console.log(`OCR source ${inputImage} (${W0}x${H0}), work size ${width}x${height}, tile ${TILE}px overlap ${OVERLAP}px`);
  console.log('Resizing working copy…');
  const workBuffer = await sharp(inputImage)
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .toBuffer();

  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && m.progress === 1) return;
      if (m.status === 'loading tesseract core') return;
      if (m.status === 'initializing tesseract') return;
      if (m.status === 'loading language traineddata') return;
      if (m.status === 'initializing api') return;
    }
  });

  await worker.setParameters({
    tessedit_pageseg_mode: PSM_MODE,
    user_defined_dpi: '144'
  });

  const step = Math.max(1, TILE - OVERLAP);
  const detections = [];
  let tileIndex = 0;
  const totalTiles =
    Math.ceil(Math.max(1, height - OVERLAP) / step) * Math.ceil(Math.max(1, width - OVERLAP) / step);

  let tilesDone = 0;
  outer: for (let ty = 0; ty < height; ty += step) {
    for (let tx = 0; tx < width; tx += step) {
      if (MAX_TILES && tilesDone >= MAX_TILES) break outer;
      const tw = Math.min(TILE, width - tx);
      const th = Math.min(TILE, height - ty);
      if (tw < 32 || th < 32) continue;

      tileIndex += 1;
      tilesDone += 1;
      process.stdout.write(`\rTile ${tileIndex}/${totalTiles} @ ${tx},${ty}`);

      const tileBuf = await sharp(workBuffer)
        .extract({ left: tx, top: ty, width: tw, height: th })
        .greyscale()
        .normalize()
        .png()
        .toBuffer();

      const {
        data: { words }
      } = await worker.recognize(tileBuf);

      const offsetX = tx * invScale;
      const offsetY = ty * invScale;
      const scaleW = invScale;
      for (const w of words || []) {
        const text = String(w.text || '').trim();
        const code = normCode(text);
        if (!code) continue;
        const conf = Number(w.confidence);
        if (conf < MIN_CONF) continue;
        const c = wordCenter(w.bbox);
        if (!c) continue;
        detections.push({
          code,
          x: offsetX + c.x * scaleW,
          y: offsetY + c.y * scaleW,
          confidence: conf
        });
      }
    }
  }

  await worker.terminate();
  process.stdout.write('\n');

  const postals = clusterDetections(detections);
  await ensureDir(outputJson);

  const payload = {
    description:
      'Generated by tools/ocr-postals.js — positions from OCR on the minimap image. Regenerate after re-stitching.',
    generated_at: new Date().toISOString(),
    source_image: path.relative(projectRoot, inputImage).replace(/\\/g, '/'),
    image_size: { width: W0, height: H0 },
    ocr_work_size: { width, height },
    tile: TILE,
    overlap: OVERLAP,
    min_confidence: MIN_CONF,
    strict_four_digit: STRICT_FOUR,
    postals
  };

  await fs.writeFile(outputJson, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${postals.length} postal entries to ${outputJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
