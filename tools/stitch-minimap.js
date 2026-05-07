const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');
const inputDir = process.env.MINIMAP_INPUT_DIR || path.join(projectRoot, 'map', 'exported');
const outputImage = process.env.MINIMAP_OUTPUT_IMAGE || path.join(projectRoot, 'server', 'uploads', 'maps', 'san-andreas.png');
const outputMeta = process.env.MINIMAP_OUTPUT_META || path.join(projectRoot, 'server', 'uploads', 'maps', 'san-andreas.meta.json');
const allowPartial = process.env.ALLOW_PARTIAL === 'true';

/** GTA-style names: minimap_ROW_COL — top-left is 0_0, below is 1_0, to the right is 0_1 */
const colMin = 0;
const colMax = 7;
const rowMin = 0;
const rowMax = 8;

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function tileName(row, col) {
  return `minimap_${row}_${col}.png`;
}

function parseTileCoords(fileName) {
  const land = fileName.match(/^minimap_(\d+)_(\d+)\.png$/i);
  if (land) {
    return { row: Number(land[1]), col: Number(land[2]), kind: 'land' };
  }
  const sea = fileName.match(/^minimap_sea_(\d+)_(\d+)\.png$/i);
  if (sea) {
    return { row: Number(sea[1]), col: Number(sea[2]), kind: 'sea' };
  }
  return null;
}

async function ensureOutputDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function loadStitchOverrides() {
  const p = path.join(inputDir, 'stitch-overrides.json');
  if (!(await fileExists(p))) return {};
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return {};
  }
}

function applyPlacementOverride(basename, tile, overrides) {
  const o = overrides[basename];
  if (o && Number.isInteger(o.row) && Number.isInteger(o.col)) {
    return { ...tile, row: o.row, col: o.col, placement_note: `override from ${basename}` };
  }
  return tile;
}

/** Scan folder for minimap_*.png / minimap_sea_*.png; one tile per (row,col), land wins over sea */
async function tilesFromDirectory(overrides) {
  const dirEntries = await fs.readdir(inputDir);
  const bySlot = new Map();
  for (const entry of dirEntries) {
    if (!entry.toLowerCase().endsWith('.png')) continue;
    const parsed = parseTileCoords(entry);
    if (!parsed) continue;
    let tile = { ...parsed, filePath: path.join(inputDir, entry) };
    tile = applyPlacementOverride(entry, tile, overrides);
    const key = `${tile.row},${tile.col}`;
    const existing = bySlot.get(key);
    if (!existing || (existing.kind === 'sea' && tile.kind === 'land')) {
      bySlot.set(key, tile);
    }
  }
  return Array.from(bySlot.values());
}

async function main() {
  const overrides = await loadStitchOverrides();
  let files = [];
  const missing = [];
  let useFullGrid = true;

  for (let row = rowMin; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      const filePath = path.join(inputDir, tileName(row, col));
      if (!(await fileExists(filePath))) {
        missing.push(tileName(row, col));
      }
    }
  }

  if (missing.length > 0 && !allowPartial) {
    console.error(`Missing ${missing.length} required tile(s) in: ${inputDir}`);
    console.error('Example missing:', missing.slice(0, 10).join(', '));
    process.exit(1);
  }

  if (missing.length === 0) {
    for (let row = rowMin; row <= rowMax; row += 1) {
      for (let col = colMin; col <= colMax; col += 1) {
        const filePath = path.join(inputDir, tileName(row, col));
        files.push({ row, col, filePath, kind: 'land' });
      }
    }
  } else {
    files = await tilesFromDirectory(overrides);
    useFullGrid = false;
  }

  if (files.length === 0) {
    throw new Error(`No usable minimap tiles found in ${inputDir}`);
  }

  const probe = await sharp(files[0].filePath).metadata();
  const tileWidth = probe.width;
  const tileHeight = probe.height;

  if (!tileWidth || !tileHeight) {
    throw new Error('Unable to determine tile dimensions.');
  }

  const minRow = useFullGrid ? rowMin : Math.min(...files.map((f) => f.row));
  const maxRow = useFullGrid ? rowMax : Math.max(...files.map((f) => f.row));
  const minCol = useFullGrid ? colMin : Math.min(...files.map((f) => f.col));
  const maxCol = useFullGrid ? colMax : Math.max(...files.map((f) => f.col));

  const colCount = maxCol - minCol + 1;
  const rowCount = maxRow - minRow + 1;
  const canvasWidth = colCount * tileWidth;
  const canvasHeight = rowCount * tileHeight;

  const composites = files.map((tile) => ({
    input: tile.filePath,
    left: (tile.col - minCol) * tileWidth,
    top: (tile.row - minRow) * tileHeight
  }));

  await ensureOutputDir(outputImage);
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 }
    }
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputImage);

  const overridesPath = path.join(inputDir, 'stitch-overrides.json');
  const hasOverridesFile = await fileExists(overridesPath);
  const meta = {
    generated_at: new Date().toISOString(),
    source_directory: inputDir,
    output_image: outputImage,
    tile_naming: 'minimap_ROW_COL — row increases downward, col increases rightward; top-left is 0_0',
    stitch_overrides_file: hasOverridesFile ? overridesPath : null,
    tile_width: tileWidth,
    tile_height: tileHeight,
    mode: useFullGrid ? 'full' : 'partial',
    grid: {
      columns: colCount,
      rows: rowCount,
      min_row: minRow,
      max_row: maxRow,
      min_col: minCol,
      max_col: maxCol
    },
    source_tiles: files.map((f) => ({
      row: f.row,
      col: f.col,
      kind: f.kind || 'land',
      file: path.basename(f.filePath)
    })),
    leaflet_bounds: [[0, 0], [canvasHeight, canvasWidth]],
    leaflet_suggestion: {
      map_image_path: `/uploads/maps/${path.basename(outputImage)}`,
      bounds: [[0, 0], [canvasHeight, canvasWidth]],
      min_zoom: -1,
      max_zoom: 4
    }
  };

  await fs.writeFile(outputMeta, JSON.stringify(meta, null, 2), 'utf8');

  console.log('Map stitched successfully.');
  console.log(`Mode: ${useFullGrid ? 'full' : 'partial'}`);
  console.log(`Layout: row ↓ col → (0_0 top-left)`);
  console.log(`Output image: ${outputImage}`);
  console.log(`Output metadata: ${outputMeta}`);
  console.log(`Leaflet bounds: [[0, 0], [${canvasHeight}, ${canvasWidth}]]`);
}

main().catch((error) => {
  console.error('Failed to stitch minimap:', error.message);
  process.exit(1);
});
