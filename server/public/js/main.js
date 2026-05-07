const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
const panel = document.getElementById('propertyPanel');
const legend = document.getElementById('legend');
const searchInput = document.getElementById('searchInput');
const user = window.SAPA_USER;

function escapeHtml(s) {
  const el = document.createElement('div');
  el.textContent = s == null ? '' : String(s);
  return el.innerHTML;
}

const bounds = window.SAPA_CONFIG.bounds || [[0, 0], [1080, 1920]];
const mapBounds = L.latLngBounds(bounds);

/** Leaflet CRS.Simple extents from map corners */
function boundsExtents(bb) {
  const sw = bb[0];
  const ne = bb[1];
  return {
    latMin: Math.min(sw[0], ne[0]),
    latMax: Math.max(sw[0], ne[0]),
    lngMin: Math.min(sw[1], ne[1]),
    lngMax: Math.max(sw[1], ne[1])
  };
}

const mapExtents = boundsExtents(bounds);

/**
 * Map GTA-style world X/Y to Leaflet Simple lat/lng using bundled calibration (same idea as server/data/postals.json).
 */
function worldToLatLng(wx, wy, calibration) {
  const cal = calibration || {};
  const wxMin = Number(cal.worldMinX ?? -4000);
  const wxMax = Number(cal.worldMaxX ?? 4500);
  const wyMin = Number(cal.worldMinY ?? -4000);
  const wyMax = Number(cal.worldMaxY ?? 8000);
  const nudgeLat = Number(cal.worldLabelNudgeLat || 0);
  const nudgeLng = Number(cal.worldLabelNudgeLng || 0);

  if (
    cal.affine &&
    Array.isArray(cal.affine.px) &&
    cal.affine.px.length >= 3 &&
    Array.isArray(cal.affine.py) &&
    cal.affine.py.length >= 3
  ) {
    const px =
      cal.affine.px[0] * wx + cal.affine.px[1] * wy + cal.affine.px[2];
    const py =
      cal.affine.py[0] * wx + cal.affine.py[1] * wy + cal.affine.py[2];
    return L.latLng(py + nudgeLat, px + nudgeLng);
  }

  const dx = wxMax - wxMin;
  const dy = wyMax - wyMin;
  const tX = dx === 0 ? 0 : (wx - wxMin) / dx;
  const tY = dy === 0 ? 0 : (wy - wyMin) / dy;
  const lng = mapExtents.lngMin + tX * (mapExtents.lngMax - mapExtents.lngMin);
  const lat = mapExtents.latMax - tY * (mapExtents.latMax - mapExtents.latMin);
  return L.latLng(lat + nudgeLat, lng + nudgeLng);
}

function postalEntryToLatLng(p, calibration, globalNudge) {
  if (Number.isFinite(Number(p.y)) && Number.isFinite(Number(p.x))) {
    const gn = globalNudge || { lat: 0, lng: 0 };
    const mn = p.marker_nudge || {};
    return L.latLng(
      Number(p.y) + Number(mn.lat || 0) + Number(gn.lat || 0),
      Number(p.x) + Number(mn.lng || 0) + Number(gn.lng || 0)
    );
  }
  if (Number.isFinite(Number(p.worldX)) && Number.isFinite(Number(p.worldY))) {
    const ll = worldToLatLng(Number(p.worldX), Number(p.worldY), calibration);
    const mn = p.marker_nudge || {};
    return L.latLng(ll.lat + Number(mn.lat || 0), ll.lng + Number(mn.lng || 0));
  }
  return null;
}

let postalPayload = null;
let postalByCode = new Map();

async function loadPostalIndex() {
  if (postalPayload) return postalPayload;
  try {
    const r = await fetch('/api/postals');
    if (!r.ok) throw new Error(String(r.status));
    postalPayload = await r.json();
    if (!postalPayload || typeof postalPayload !== 'object') {
      postalPayload = { postals: [], calibration: {} };
    }
    if (!Array.isArray(postalPayload.postals)) postalPayload.postals = [];
  } catch {
    postalPayload = { postals: [], calibration: {} };
  }
  postalByCode = new Map();
  const list = postalPayload.postals;
  for (const p of list) {
    const raw = String(p.code ?? '').replace(/\D/g, '');
    if (raw.length < 3 || raw.length > 4) continue;
    const key = raw.padStart(4, '0');
    postalByCode.set(key, p);
  }
  return postalPayload;
}

/** If the query is only digits/spaces (3–4 digit postal), return normalized lookup key */
function postalKeyFromQuery(q) {
  const t = q.trim();
  if (!t) return null;
  if (/[^\d\s]/.test(t)) return null;
  const d = t.replace(/\D/g, '');
  if (d.length < 3 || d.length > 4) return null;
  return d.padStart(4, '0');
}

const map = L.map('map', {
  crs: L.CRS.Simple,
  minZoom: window.SAPA_CONFIG.min_zoom || -3,
  maxZoom: window.SAPA_CONFIG.max_zoom || 3,
  maxBounds: mapBounds,
  maxBoundsViscosity: 1
});

if (window.SAPA_CONFIG.map_image_path) {
  L.imageOverlay(window.SAPA_CONFIG.map_image_path, bounds).addTo(map);
}
map.fitBounds(bounds);

void loadPostalIndex();

const featureGroup = new L.FeatureGroup().addTo(map);
if (user && (user.role === 'admin' || user.role === 'appraiser')) {
  const drawControl = new L.Control.Draw({
    edit: { featureGroup, remove: true },
    draw: { polygon: true, polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false }
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    const geo = e.layer.toGeoJSON().geometry;
    document.getElementById('geojsonInput').value = JSON.stringify(geo);
    document.getElementById('propertyModal')?.classList.remove('hidden');
  });
}

function styleForProperty(p) {
  const fillMap = { Residential: '#2f80ed', Commercial: '#f2994a', Government: '#27ae60', 'Vacant Land': '#7b8794' };
  const color = p.status === 'Foreclosed' ? '#d64545' : p.status === 'For Sale' ? '#f0b429' : '#1f2933';
  return { color, weight: 2, fillColor: fillMap[p.type] || '#7b8794', fillOpacity: 0.5 };
}

function renderPanel(p) {
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="panel__inner">
    ${p.status === 'For Sale' ? `<div class="sale-banner">For sale — asking $${Number(p.purchase_price || 0).toLocaleString()}</div>` : ''}
    <h3>${escapeHtml(p.name)}</h3>
    <p class="detail"><strong>Parcel</strong> ${escapeHtml(String(p.parcel_id))}</p>
    <p class="detail"><strong>Address</strong> ${escapeHtml(String(p.address))}</p>
    <p class="detail"><strong>Owner</strong> ${escapeHtml(String(p.owner_name))} (${escapeHtml(String(p.owner_type))})</p>
    <p class="detail"><strong>Purchase date</strong> ${p.purchase_date ? escapeHtml(String(p.purchase_date)) : '—'}</p>
    <p class="detail"><strong>Purchase price</strong> $${Number(p.purchase_price || 0).toLocaleString()}</p>
    <p class="detail"><strong>Assessed value</strong> $${Number(p.assessed_value || 0).toLocaleString()}</p>
    <p class="detail"><strong>Annual tax</strong> $${Number(p.annual_tax || 0).toLocaleString()}</p>
    <p class="detail"><strong>Status</strong> ${escapeHtml(String(p.status))}</p>
    <p class="detail"><strong>Updated</strong> ${escapeHtml(String(p.updated_at || ''))}</p>
    <button type="button" class="btn btn-primary btn-panel" id="txBtn">Transaction history</button>
    </div>
  `;
  panel.querySelector('#txBtn').addEventListener('click', async () => {
    panel.querySelector('.panel-timeline')?.remove();
    const r = await fetch(`/api/properties/${p.id}/transactions`);
    const tx = await r.json();
    const timeline = tx
      .map(
        (t) =>
          `<li><time>${escapeHtml(String(t.transfer_date))}</time> · ${escapeHtml(String(t.from_owner))} → ${escapeHtml(String(t.to_owner))} · $${Number(t.sale_price).toLocaleString()}</li>`
      )
      .join('');
    panel
      .querySelector('.panel__inner')
      ?.insertAdjacentHTML(
        'beforeend',
        `<div class="panel-timeline"><h4 style="margin:20px 0 10px;font-size:15px">Transactions</h4><ul>${timeline || '<li>No records</li>'}</ul></div>`
      );
  });
}

let loadSeq = 0;
let searchDebounce;

async function loadProperties(search = '') {
  const seq = ++loadSeq;
  const q = search.trim();
  const url = `/api/properties?search=${encodeURIComponent(q)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error(e);
    return;
  }
  let props;
  try {
    props = await res.json();
  } catch {
    return;
  }
  if (seq !== loadSeq) return;
  if (!Array.isArray(props)) {
    console.error('Properties API returned non-array', props);
    return;
  }
  featureGroup.clearLayers();
  props.forEach((p) => {
    if (!p || !p.geojson) return;
    const layer = L.geoJSON({ type: 'Feature', geometry: p.geojson }, { style: styleForProperty(p) }).addTo(featureGroup);
    layer.on('click', () => renderPanel(p));
  });
}

async function maybeFlyToPostal(searchRaw) {
  const key = postalKeyFromQuery(searchRaw);
  if (!key) return;
  await loadPostalIndex();
  const entry = postalByCode.get(key);
  if (!entry) return;
  const cal = postalPayload.calibration || {};
  const gn = postalPayload.marker_nudge || { lat: 0, lng: 0 };
  const ll = postalEntryToLatLng(entry, cal, gn);
  if (!ll) return;
  map.setView(ll, Number(entry.zoom) || 2);
}

searchInput?.addEventListener('input', (e) => {
  const v = e.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    void maybeFlyToPostal(v);
    void loadProperties(v);
  }, 200);
});
document.getElementById('legendToggle')?.addEventListener('click', () => legend.classList.toggle('hidden'));

const form = document.getElementById('propertyForm');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.geojson = JSON.parse(document.getElementById('geojsonInput').value);
  payload.tax_rate = Number(payload.tax_rate || 0);
  payload.assessed_value = Number(payload.assessed_value || 0);
  payload.purchase_price = Number(payload.purchase_price || 0);

  await fetch('/api/properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
    body: JSON.stringify(payload)
  });
  form.closest('.modal').classList.add('hidden');
  form.reset();
  loadProperties();
});

document.getElementById('closeModal')?.addEventListener('click', () => document.getElementById('propertyModal').classList.add('hidden'));
loadProperties();
