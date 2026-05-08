const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
const panel = document.getElementById('propertyPanel');
const legend = document.getElementById('legend');
const searchInput = document.getElementById('searchInput');
const user = window.SAPA_USER;

const STAFF_ROLES = ['admin', 'appraiser', 'clerk'];
function isStaff() {
  return !!(user && STAFF_ROLES.includes(user.role));
}

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
    const r = await fetch('/api/postals', { credentials: 'same-origin' });
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

const propertyModal = document.getElementById('propertyModal');
const propertyForm = document.getElementById('propertyForm');
const propertyTypeSelect = document.getElementById('propertyTypeSelect');
const residentialOwnersBlock = document.getElementById('residentialOwnersBlock');
const singleOwnerFields = document.getElementById('singleOwnerFields');
const coOwnersList = document.getElementById('coOwnersList');
const editPropertyId = document.getElementById('editPropertyId');
const propertyModalTitle = document.getElementById('propertyModalTitle');
const parcelDisplayRow = document.getElementById('parcelDisplayRow');
const parcelDisplay = document.getElementById('parcelDisplay');
const hideDetailsPublic = document.getElementById('hideDetailsPublic');
const propertyFormSubmit = document.getElementById('propertyFormSubmit');

function syncOwnerFieldsVisibility() {
  if (!propertyTypeSelect || !residentialOwnersBlock || !singleOwnerFields) return;
  const res = propertyTypeSelect.value === 'Residential';
  residentialOwnersBlock.classList.toggle('hidden', !res);
  singleOwnerFields.classList.toggle('hidden', res);
  if (res && coOwnersList && coOwnersList.children.length === 0) addCoOwnerRow();
}

function addCoOwnerRow(name = '', ownerType = 'Individual') {
  if (!coOwnersList) return;
  const row = document.createElement('div');
  row.className = 'co-owner-row';
  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.placeholder = 'Owner name';
  nameIn.value = name;
  nameIn.className = 'co-owner-name';
  const sel = document.createElement('select');
  sel.className = 'co-owner-type';
  ['Individual', 'Business'].forEach((t) => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    if (t === ownerType) o.selected = true;
    sel.appendChild(o);
  });
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'btn-remove-co';
  rm.setAttribute('aria-label', 'Remove owner');
  rm.textContent = '×';
  rm.addEventListener('click', () => {
    if (coOwnersList.children.length > 1) row.remove();
  });
  row.append(nameIn, sel, rm);
  coOwnersList.appendChild(row);
}

function collectCoOwners() {
  if (!coOwnersList) return [];
  const out = [];
  coOwnersList.querySelectorAll('.co-owner-row').forEach((row) => {
    const name = row.querySelector('.co-owner-name')?.value?.trim();
    const owner_type = row.querySelector('.co-owner-type')?.value || 'Individual';
    if (name) out.push({ name, owner_type });
  });
  return out;
}

function resetFormForNew() {
  if (!propertyForm) return;
  propertyForm.reset();
  if (editPropertyId) editPropertyId.value = '';
  if (propertyModalTitle) propertyModalTitle.textContent = 'New property';
  if (parcelDisplayRow) parcelDisplayRow.classList.add('hidden');
  if (propertyFormSubmit) propertyFormSubmit.textContent = 'Save property';
  if (coOwnersList) coOwnersList.innerHTML = '';
  if (propertyTypeSelect) propertyTypeSelect.value = 'Residential';
  addCoOwnerRow();
  syncOwnerFieldsVisibility();
  if (hideDetailsPublic) hideDetailsPublic.checked = false;
}

function fillFormFromProperty(data) {
  if (!propertyForm) return;
  const setVal = (fieldName, val) => {
    const el = propertyForm.querySelector(`[name="${fieldName}"]`);
    if (el) el.value = val ?? '';
  };
  setVal('name', data.name || '');
  setVal('address', data.address || '');
  propertyTypeSelect.value = data.type || 'Residential';
  setVal('purchase_price', data.purchase_price ?? '');
  setVal('purchase_date', data.purchase_date ? String(data.purchase_date).slice(0, 10) : '');
  setVal('assessed_value', data.assessed_value ?? '');
  setVal('tax_rate', data.tax_rate ?? '');
  setVal('status', data.status || 'Owned');
  setVal('notes', data.notes ?? '');
  if (hideDetailsPublic) hideDetailsPublic.checked = !!data.hide_details_public;

  if (coOwnersList) coOwnersList.innerHTML = '';
  if (data.type === 'Residential') {
    const owners = Array.isArray(data.residential_owners) ? data.residential_owners : [];
    if (owners.length) owners.forEach((o) => addCoOwnerRow(o.name || '', o.owner_type || 'Individual'));
    else addCoOwnerRow(data.owner_name || '', data.owner_type || 'Individual');
  } else {
    setVal('owner_name', data.owner_name || '');
    setVal('owner_type', data.owner_type || 'Individual');
  }
  syncOwnerFieldsVisibility();
}

function buildPayloadFromForm(geojson) {
  const fd = new FormData(propertyForm);
  const type = propertyTypeSelect.value;
  const payload = {
    name: fd.get('name'),
    type,
    address: fd.get('address'),
    purchase_price: Number(fd.get('purchase_price') || 0),
    purchase_date: fd.get('purchase_date') || null,
    assessed_value: Number(fd.get('assessed_value') || 0),
    tax_rate: Number(fd.get('tax_rate') || 0),
    status: fd.get('status'),
    notes: fd.get('notes') || null,
    hide_details_public: !!(hideDetailsPublic && hideDetailsPublic.checked),
    geojson
  };
  if (type === 'Residential') {
    payload.residential_owners = collectCoOwners();
    if (!payload.residential_owners.length) {
      throw new Error('Add at least one owner');
    }
    payload.owner_name = payload.residential_owners[0].name;
    payload.owner_type = payload.residential_owners[0].owner_type;
  } else {
    payload.residential_owners = [];
    payload.owner_name = fd.get('owner_name');
    payload.owner_type = fd.get('owner_type');
    if (!String(payload.owner_name || '').trim()) {
      throw new Error('Owner name required');
    }
  }
  return payload;
}

if (user && (user.role === 'admin' || user.role === 'appraiser')) {
  const drawControl = new L.Control.Draw({
    edit: { featureGroup, remove: true },
    draw: { polygon: true, polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false }
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    const geo = e.layer.toGeoJSON().geometry;
    const gj = document.getElementById('geojsonInput');
    if (gj) gj.value = JSON.stringify(geo);
    resetFormForNew();
    propertyModal?.classList.remove('hidden');
  });
}

propertyTypeSelect?.addEventListener('change', syncOwnerFieldsVisibility);
document.getElementById('addCoOwner')?.addEventListener('click', () => addCoOwnerRow());

function styleForProperty(p) {
  const fillMap = { Residential: '#2f80ed', Commercial: '#f2994a', Government: '#27ae60', 'Vacant Land': '#7b8794' };
  const color = p.status === 'Foreclosed' ? '#d64545' : p.status === 'For Sale' ? '#f0b429' : '#1f2933';
  const hiddenPublic = p.details_public_hidden && !isStaff();
  return {
    color,
    weight: 2,
    fillColor: fillMap[p.type] || '#7b8794',
    fillOpacity: hiddenPublic ? 0.28 : 0.5
  };
}

function ownersDetailHtml(p) {
  if (p.type === 'Residential' && Array.isArray(p.residential_owners) && p.residential_owners.length > 0) {
    return `<ul class="owner-list">${p.residential_owners
      .map(
        (o) =>
          `<li>${escapeHtml(o.name)} <span class="text-muted">(${escapeHtml(o.owner_type)})</span></li>`
      )
      .join('')}</ul>`;
  }
  return `<p class="detail"><strong>Owner</strong> ${escapeHtml(String(p.owner_name))} (${escapeHtml(String(p.owner_type))})</p>`;
}

async function openEditModal(propertyId) {
  if (!isStaff() || !propertyModal || !propertyForm) return;
  let res;
  try {
    res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}`, { credentials: 'same-origin' });
  } catch (e) {
    console.error(e);
    return;
  }
  const data = await res.json().catch(() => null);
  if (!data || data.error || data.details_public_hidden) return;

  editPropertyId.value = propertyId;
  propertyModalTitle.textContent = 'Edit property';
  parcelDisplayRow?.classList.remove('hidden');
  if (parcelDisplay) parcelDisplay.textContent = data.parcel_id || '';
  propertyFormSubmit.textContent = 'Save changes';
  document.getElementById('geojsonInput').value = JSON.stringify(data.geojson);
  fillFormFromProperty(data);
  propertyModal.classList.remove('hidden');
}

function renderPanel(p) {
  panel.classList.remove('hidden');
  const hidden = !!p.details_public_hidden;

  const editBtn =
    isStaff() && !hidden
      ? `<button type="button" class="btn btn-primary btn-panel" id="editPropertyBtn">Edit details</button>`
      : '';

  const txBtn = hidden
    ? ''
    : `<button type="button" class="btn btn-primary btn-panel" id="txBtn">Transaction history</button>`;

  if (hidden) {
    panel.innerHTML = `
    <div class="panel__inner">
    <div class="panel-notice">Registered parcel — details are not published.</div>
    <h3>${escapeHtml(p.name)}</h3>
    <p class="detail"><strong>Parcel</strong> ${escapeHtml(String(p.parcel_id))}</p>
    <p class="detail"><strong>Address</strong> ${escapeHtml(String(p.address))}</p>
    <p class="detail"><strong>Type</strong> ${escapeHtml(String(p.type))}</p>
    <p class="detail"><strong>Status</strong> ${escapeHtml(String(p.status))}</p>
    ${editBtn}
    </div>`;
  } else {
    panel.innerHTML = `
    <div class="panel__inner">
    ${p.status === 'For Sale' ? `<div class="sale-banner">For sale — asking $${Number(p.purchase_price || 0).toLocaleString()}</div>` : ''}
    <h3>${escapeHtml(p.name)}</h3>
    <p class="detail"><strong>Parcel</strong> ${escapeHtml(String(p.parcel_id))}</p>
    <p class="detail"><strong>Address</strong> ${escapeHtml(String(p.address))}</p>
    ${ownersDetailHtml(p)}
    <p class="detail"><strong>Purchase date</strong> ${p.purchase_date ? escapeHtml(String(p.purchase_date)) : '—'}</p>
    <p class="detail"><strong>Purchase price</strong> $${Number(p.purchase_price || 0).toLocaleString()}</p>
    <p class="detail"><strong>Assessed value</strong> $${Number(p.assessed_value || 0).toLocaleString()}</p>
    <p class="detail"><strong>Annual tax</strong> $${Number(p.annual_tax || 0).toLocaleString()}</p>
    <p class="detail"><strong>Status</strong> ${escapeHtml(String(p.status))}</p>
    <p class="detail"><strong>Updated</strong> ${escapeHtml(String(p.updated_at || ''))}</p>
    ${txBtn}
    ${editBtn}
    </div>`;
  }

  panel.querySelector('#txBtn')?.addEventListener('click', async () => {
    panel.querySelector('.panel-timeline')?.remove();
    const r = await fetch(`/api/properties/${p.id}/transactions`, { credentials: 'same-origin' });
    const tx = await r.json();
    const timeline = Array.isArray(tx)
      ? tx
          .map(
            (t) =>
              `<li><time>${escapeHtml(String(t.transfer_date))}</time> · ${escapeHtml(String(t.from_owner))} → ${escapeHtml(String(t.to_owner))} · $${Number(t.sale_price).toLocaleString()}</li>`
          )
          .join('')
      : '';
    panel
      .querySelector('.panel__inner')
      ?.insertAdjacentHTML(
        'beforeend',
        `<div class="panel-timeline"><h4 style="margin:20px 0 10px;font-size:15px">Transactions</h4><ul>${timeline || '<li>No records</li>'}</ul></div>`
      );
  });

  panel.querySelector('#editPropertyBtn')?.addEventListener('click', () => openEditModal(p.id));
}

let loadSeq = 0;
let postalDebounce;

async function loadProperties(search = '') {
  const seq = ++loadSeq;
  const q = search.trim();
  const url = `/api/properties?search=${encodeURIComponent(q)}`;
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
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

  // Neighborhood frame (~6.5% of map extent each side, minimum px-ish span) — stay zoomed out vs street-level.
  const latSpan = mapExtents.latMax - mapExtents.latMin;
  const lngSpan = mapExtents.lngMax - mapExtents.lngMin;
  const frac = 0.065;
  const padLat = Math.max(latSpan * frac, 420);
  const padLng = Math.max(lngSpan * frac, 560);

  const r0 = ll.lat - padLat;
  const r1 = ll.lat + padLat;
  const c0 = ll.lng - padLng;
  const c1 = ll.lng + padLng;
  const lowLat = Math.min(r0, r1);
  const highLat = Math.max(r0, r1);
  const lowLng = Math.min(c0, c1);
  const highLng = Math.max(c0, c1);

  const sw = L.latLng(
    Math.max(mapExtents.latMin, lowLat),
    Math.max(mapExtents.lngMin, lowLng)
  );
  const ne = L.latLng(
    Math.min(mapExtents.latMax, highLat),
    Math.min(mapExtents.lngMax, highLng)
  );
  const area = L.latLngBounds(sw, ne);

  const cfgMin = Number(window.SAPA_CONFIG.min_zoom);
  const cfgMax = Number(window.SAPA_CONFIG.max_zoom);
  const minZ = Number.isFinite(cfgMin) ? cfgMin : -2;
  const maxZ = Number.isFinite(cfgMax) ? cfgMax : 4;
  /** Never zoom in past ~district level for postals; prefer -1 when map allows (wide neighborhood). */
  const postalMaxZoom = Math.min(maxZ, Math.max(minZ, -1));

  map.fitBounds(area, {
    padding: [52, 52],
    maxZoom: postalMaxZoom,
    animate: true
  });
}

searchInput?.addEventListener('input', (e) => {
  const v = e.target.value;
  void loadProperties(v);
  clearTimeout(postalDebounce);
  postalDebounce = setTimeout(() => void maybeFlyToPostal(v), 320);
});

document.getElementById('legendToggle')?.addEventListener('click', () => legend.classList.toggle('hidden'));

propertyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const gjEl = document.getElementById('geojsonInput');
  let geojson;
  try {
    geojson = JSON.parse(gjEl?.value || 'null');
  } catch {
    alert('Invalid GeoJSON');
    return;
  }
  let payload;
  try {
    payload = buildPayloadFromForm(geojson);
  } catch (err) {
    alert(err.message || 'Check the form');
    return;
  }

  const editingId = editPropertyId?.value?.trim();
  const headers = { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken };
  const url = editingId ? `/api/properties/${encodeURIComponent(editingId)}` : '/api/properties';
  const method = editingId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    let msg = 'Save failed';
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    alert(msg);
    return;
  }
  propertyModal?.classList.add('hidden');
  resetFormForNew();
  loadProperties(searchInput?.value || '');
});

document.getElementById('closeModal')?.addEventListener('click', () => {
  propertyModal?.classList.add('hidden');
  resetFormForNew();
});

syncOwnerFieldsVisibility();
loadProperties();
