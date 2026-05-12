const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
const panel = document.getElementById('propertyPanel');
const legend = document.getElementById('legend');
const searchInput = document.getElementById('searchInput');
const user = window.SAPA_USER;
const defaultTaxRates = window.SAPA_TAX_RATES || {};
const taxPresets = window.SAPA_TAX_PRESETS || [];
const pricePerSqft = Number(window.SAPA_PRICE_PER_SQFT) || 0;
const enabledModules = window.SAPA_MODULES || {};

function isModuleEnabled(key) {
  return !!enabledModules[key];
}

const STAFF_ROLES = ['admin', 'appraiser', 'clerk'];
function isStaff() {
  return !!(user && STAFF_ROLES.includes(user.role));
}

function escapeHtml(s) {
  const el = document.createElement('div');
  el.textContent = s == null ? '' : String(s);
  return el.innerHTML;
}

/* ── Toast Notification System ─────────────────────── */
const toastContainer = document.getElementById('toastContainer');
const TOAST_ICONS = { success: '\u2714', error: '\u2718', info: '\u2139' };

function showToast(message, type = 'info', duration = 4000) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span class="toast__icon">${TOAST_ICONS[type] || ''}</span><span class="toast__message">${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  const dismiss = () => {
    toast.classList.add('toast--exiting');
    setTimeout(() => toast.remove(), 250);
  };
  toast.addEventListener('click', dismiss);
  if (duration > 0) setTimeout(dismiss, duration);
}

/* ── Debounce Utility ──────────────────────────────── */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ── Button Loading State ──────────────────────────── */
function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.classList.add('btn--loading');
    btn.disabled = true;
    btn._origText = btn.textContent;
  } else {
    btn.classList.remove('btn--loading');
    btn.disabled = false;
    if (btn._origText) btn.textContent = btn._origText;
  }
}

/* ── Inline Validation ─────────────────────────────── */
function setFieldError(el, message) {
  if (!el) return;
  el.classList.add('field-invalid');
  const existing = el.parentElement?.querySelector('.field-error-text');
  if (existing) existing.remove();
  if (message) {
    const span = document.createElement('span');
    span.className = 'field-error-text';
    span.textContent = message;
    el.insertAdjacentElement('afterend', span);
  }
}

function clearFieldError(el) {
  if (!el) return;
  el.classList.remove('field-invalid');
  el.parentElement?.querySelector('.field-error-text')?.remove();
}

function clearAllFieldErrors(form) {
  if (!form) return;
  form.querySelectorAll('.field-invalid').forEach((el) => clearFieldError(el));
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
    // Affine produces image-pixel-y (0=top). Flip to Leaflet lat (0=bottom).
    return L.latLng(mapExtents.latMax - py + nudgeLat, px + nudgeLng);
  }

  const dx = wxMax - wxMin;
  const dy = wyMax - wyMin;
  const tX = dx === 0 ? 0 : (wx - wxMin) / dx;
  const tY = dy === 0 ? 0 : (wy - wyMin) / dy;
  const lng = mapExtents.lngMin + tX * (mapExtents.lngMax - mapExtents.lngMin);
  // GTA5 Y increases north, Leaflet lat increases north — same direction, no flip
  const lat = mapExtents.latMin + tY * (mapExtents.latMax - mapExtents.latMin);
  return L.latLng(lat + nudgeLat, lng + nudgeLng);
}

function postalEntryToLatLng(p, calibration, globalNudge) {
  if (Number.isFinite(Number(p.y)) && Number.isFinite(Number(p.x))) {
    const gn = globalNudge || { lat: 0, lng: 0 };
    const mn = p.marker_nudge || {};
    // OCR y/x are image-pixel coords (y=0 at top). Flip y to Leaflet lat (0=bottom).
    return L.latLng(
      (mapExtents.latMax - Number(p.y)) + Number(mn.lat || 0) + Number(gn.lat || 0),
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
const taxRateInput = document.getElementById('taxRateInput');
const taxRateLabel = document.getElementById('taxRateLabel');
const taxRateHint = document.getElementById('taxRateHint');
const taxZoneSelect = document.getElementById('taxZoneSelect');
const sqftInput = document.getElementById('sqftInput');
const sqftHint = document.getElementById('sqftHint');
const assessedValueInput = document.getElementById('assessedValueInput');
const markSurveyBtn = document.getElementById('markSurveyBtn');
const workOrderSelect = document.getElementById('workOrderSelect');
const workOrderGroup = document.getElementById('workOrderGroup');
const ownerTypeSelect = document.getElementById('ownerTypeSelect');
const businessNameGroup = document.getElementById('businessNameGroup');
const businessNameInput = document.getElementById('businessNameInput');
const businessIdInput = document.getElementById('businessIdInput');
const businessSuggestions = document.getElementById('businessSuggestions');
let pendingWorkOrders = [];
let selectedWorkOrderId = null;
let bizSearchTimeout = null;

const taxPresetMap = new Map();
if (taxZoneSelect) {
  taxPresets.forEach((p) => {
    const name = p.name || '';
    taxPresetMap.set(name, p);
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    taxZoneSelect.appendChild(opt);
  });
}

function taxLabelForType(type) {
  if (type === 'Residential') return 'Residential Property Tax Rate';
  if (type === 'Commercial') return 'Commercial Property Tax Rate';
  return 'Property Tax Rate';
}

function rateFromPreset(presetName, propertyType) {
  const p = taxPresetMap.get(presetName);
  if (!p) return null;
  const map = {
    Residential: p.residential_rate,
    Commercial: p.commercial_rate,
    Government: p.government_rate,
    'Vacant Land': p.vacant_land_rate
  };
  return map[propertyType] ?? null;
}

function syncTaxRateUI(autoFill) {
  if (!propertyTypeSelect) return;
  const type = propertyTypeSelect.value;
  if (taxRateLabel) taxRateLabel.textContent = taxLabelForType(type);

  const zone = taxZoneSelect ? taxZoneSelect.value : '';
  const presetRate = zone ? rateFromPreset(zone, type) : null;
  const fallbackRate = defaultTaxRates[type];

  if (taxRateHint) {
    if (presetRate != null) {
      taxRateHint.textContent = `${zone}: ${presetRate}%`;
    } else if (fallbackRate != null) {
      taxRateHint.textContent = `Default: ${fallbackRate}%`;
    } else {
      taxRateHint.textContent = '';
    }
  }
  if (autoFill && taxRateInput) {
    const rate = presetRate != null ? presetRate : fallbackRate;
    if (rate != null) taxRateInput.value = rate;
  }
}

function syncSqftUI() {
  if (!sqftHint) return;
  if (pricePerSqft > 0) {
    sqftHint.textContent = `$${pricePerSqft}/sqft`;
  } else {
    sqftHint.textContent = '';
  }
}

function autoCalcAssessedValue() {
  if (!sqftInput || !assessedValueInput || pricePerSqft <= 0) return;
  const sqft = Number(sqftInput.value) || 0;
  if (sqft > 0) {
    assessedValueInput.value = (sqft * pricePerSqft).toFixed(2);
  }
}

function syncOwnerFieldsVisibility() {
  if (!propertyTypeSelect || !residentialOwnersBlock || !singleOwnerFields) return;
  const res = propertyTypeSelect.value === 'Residential';
  residentialOwnersBlock.classList.toggle('hidden', !res);
  singleOwnerFields.classList.toggle('hidden', res);
  if (res && coOwnersList && coOwnersList.children.length === 0) addCoOwnerRow();
  syncBusinessNameVisibility();
}

function syncBusinessNameVisibility() {
  if (!businessNameGroup || !ownerTypeSelect) return;
  const isBiz = ownerTypeSelect.value === 'Business';
  const isResidential = propertyTypeSelect?.value === 'Residential';
  businessNameGroup.classList.toggle('hidden', isResidential || !isBiz);
}

function clearBusinessSelection() {
  if (businessIdInput) businessIdInput.value = '';
  if (businessNameInput) businessNameInput.value = '';
  if (businessSuggestions) { businessSuggestions.innerHTML = ''; businessSuggestions.classList.add('hidden'); }
}

async function fetchBusinessSuggestions(query) {
  if (!query || query.length < 1) {
    if (businessSuggestions) { businessSuggestions.innerHTML = ''; businessSuggestions.classList.add('hidden'); }
    return;
  }
  try {
    const r = await fetch(`/api/businesses/search?q=${encodeURIComponent(query)}`, { credentials: 'same-origin' });
    if (!r.ok) return;
    const results = await r.json();
    if (!businessSuggestions) return;
    businessSuggestions.innerHTML = '';
    if (results.length === 0) {
      businessSuggestions.classList.add('hidden');
      return;
    }
    results.forEach((biz) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = biz.name;
      item.dataset.id = biz.id;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (businessNameInput) businessNameInput.value = biz.name;
        if (businessIdInput) businessIdInput.value = biz.id;
        businessSuggestions.innerHTML = '';
        businessSuggestions.classList.add('hidden');
      });
      businessSuggestions.appendChild(item);
    });
    businessSuggestions.classList.remove('hidden');
  } catch { /* ignore */ }
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
  if (taxZoneSelect) taxZoneSelect.value = '';
  addCoOwnerRow();
  syncOwnerFieldsVisibility();
  syncTaxRateUI(true);
  syncSqftUI();
  if (hideDetailsPublic) hideDetailsPublic.checked = false;
  if (workOrderSelect) workOrderSelect.value = '';
  selectedWorkOrderId = null;
  if (workOrderGroup) workOrderGroup.classList.toggle('hidden', !!editPropertyId?.value);
  if (markSurveyBtn) markSurveyBtn.classList.remove('hidden');
  clearBusinessSelection();
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
  setVal('square_footage', data.square_footage ?? '');
  setVal('tax_rate', data.tax_rate ?? '');
  if (taxZoneSelect) taxZoneSelect.value = data.tax_zone || '';
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
    if (data.owner_type === 'Business') {
      if (businessNameInput) businessNameInput.value = data.business_name || '';
      if (businessIdInput) businessIdInput.value = data.business_id || '';
    } else {
      clearBusinessSelection();
    }
  }
  syncOwnerFieldsVisibility();
  syncTaxRateUI(false);
  syncSqftUI();
  if (workOrderGroup) workOrderGroup.classList.add('hidden');
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
    square_footage: Number(fd.get('square_footage') || 0),
    tax_zone: taxZoneSelect ? taxZoneSelect.value || null : null,
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
    if (payload.owner_type === 'Business') {
      payload.business_name = businessNameInput?.value?.trim() || '';
      payload.business_id = businessIdInput?.value || '';
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

propertyTypeSelect?.addEventListener('change', () => {
  syncOwnerFieldsVisibility();
  syncTaxRateUI(true);
});
ownerTypeSelect?.addEventListener('change', () => {
  syncBusinessNameVisibility();
  if (ownerTypeSelect.value !== 'Business') clearBusinessSelection();
});
businessNameInput?.addEventListener('input', () => {
  if (businessIdInput) businessIdInput.value = '';
  clearTimeout(bizSearchTimeout);
  bizSearchTimeout = setTimeout(() => fetchBusinessSuggestions(businessNameInput.value.trim()), 250);
});
businessNameInput?.addEventListener('blur', () => {
  setTimeout(() => { if (businessSuggestions) businessSuggestions.classList.add('hidden'); }, 200);
});
businessNameInput?.addEventListener('focus', () => {
  if (businessNameInput.value.trim()) fetchBusinessSuggestions(businessNameInput.value.trim());
});
taxZoneSelect?.addEventListener('change', () => syncTaxRateUI(true));
document.getElementById('addCoOwner')?.addEventListener('click', () => addCoOwnerRow());
sqftInput?.addEventListener('input', () => autoCalcAssessedValue());

function styleForProperty(p) {
  if (p.status === 'Requires Survey') {
    return {
      color: '#e74c3c',
      weight: 2,
      dashArray: '6 4',
      fillColor: '#e87e73',
      fillOpacity: 0.45
    };
  }
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

function ownersGridCells(p) {
  if (p.type === 'Residential' && Array.isArray(p.residential_owners) && p.residential_owners.length > 0) {
    const names = p.residential_owners.map((o) =>
      `<span class="owner-chip"><span class="owner-chip__name">${escapeHtml(o.name)}</span><span class="owner-chip__type">${escapeHtml(o.owner_type)}</span></span>`
    ).join('');
    return `<div class="panel__info-cell panel__info-cell--wide"><span class="panel__cell-label">Owners (${p.residential_owners.length})</span><div class="owner-chips">${names}</div></div>`;
  }
  if (p.owner_type === 'Business' && p.business_name) {
    return `<div class="panel__info-cell"><span class="panel__cell-label">Business</span><span class="panel__cell-value panel__cell-value--biz">${escapeHtml(String(p.business_name))}</span></div>` +
      `<div class="panel__info-cell"><span class="panel__cell-label">Representative</span><span class="panel__cell-value">${escapeHtml(String(p.owner_name))}</span></div>`;
  }
  return `<div class="panel__info-cell panel__info-cell--wide"><span class="panel__cell-label">Owner</span><span class="panel__cell-value">${escapeHtml(String(p.owner_name))}</span></div>`;
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
  propertyModalTitle.textContent = data.status === 'Requires Survey' ? 'Complete survey' : 'Edit property';
  parcelDisplayRow?.classList.remove('hidden');
  if (parcelDisplay) parcelDisplay.textContent = data.parcel_id || '';
  propertyFormSubmit.textContent = 'Save changes';
  document.getElementById('geojsonInput').value = JSON.stringify(data.geojson);
  fillFormFromProperty(data);
  if (markSurveyBtn) markSurveyBtn.classList.add('hidden');
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

  const saleBtn =
    isStaff() && !hidden
      ? `<button type="button" class="btn btn-panel btn-sale" id="recordSaleBtn">Record Sale</button>`
      : '';

  const transferBtn =
    isStaff() && !hidden && p.type === 'Commercial'
      ? `<button type="button" class="btn btn-panel btn-transfer" id="transferOwnerBtn">Transfer Ownership</button>`
      : '';

  const deleteBtn =
    user && user.role === 'admin'
      ? `<button type="button" class="btn btn-panel btn-delete-prop" id="deletePropBtn">Delete Property</button>`
      : '';

  if (p.status === 'Requires Survey') {
    panel.innerHTML = `
    <div class="panel__inner">
    <div class="survey-banner">Requires Survey</div>
    <h3>${escapeHtml(p.name || 'Unmarked Parcel')}</h3>
    <p class="detail"><strong>Parcel</strong> ${escapeHtml(String(p.parcel_id))}</p>
    ${p.address ? `<p class="detail"><strong>Address</strong> ${escapeHtml(String(p.address))}</p>` : ''}
    ${p.notes ? `<p class="detail"><strong>Notes</strong> ${escapeHtml(String(p.notes))}</p>` : ''}
    <p class="detail"><strong>Created</strong> ${escapeHtml(String(p.updated_at || ''))}</p>
    <p class="survey-prompt">Click "Edit details" to complete this property's information.</p>
    ${editBtn}
    ${deleteBtn}
    <button type="button" class="btn btn-panel btn-close-panel" id="closePanelBtn">Close</button>
    </div>`;
  } else if (hidden) {
    panel.innerHTML = `
    <div class="panel__inner">
    <div class="panel-notice">Registered parcel — details are not published.</div>
    <h3>${escapeHtml(p.name)}</h3>
    <p class="detail"><strong>Parcel</strong> ${escapeHtml(String(p.parcel_id))}</p>
    <p class="detail"><strong>Address</strong> ${escapeHtml(String(p.address))}</p>
    <p class="detail"><strong>Type</strong> ${escapeHtml(String(p.type))}</p>
    <p class="detail"><strong>Status</strong> ${escapeHtml(String(p.status))}</p>
    ${editBtn}
    ${deleteBtn}
    <button type="button" class="btn btn-panel btn-close-panel" id="closePanelBtn">Close</button>
    </div>`;
  } else {
    const statusCls = p.status === 'For Sale' ? 'status--sale' : p.status === 'Foreclosed' ? 'status--danger' : p.status === 'Requires Survey' ? 'status--warn' : 'status--owned';
    const updatedDate = p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const purchaseDate = p.purchase_date ? new Date(p.purchase_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

    panel.innerHTML = `
    <div class="panel__inner panel--redesign">
      <button type="button" class="panel__close" id="closePanelBtn" title="Close">&times;</button>
      ${p.status === 'For Sale' ? `<div class="sale-banner">For Sale — Asking $${Number(p.purchase_price || 0).toLocaleString()}</div>` : ''}

      <div class="panel__header">
        <div class="panel__header-info">
          <h3 class="panel__title">${escapeHtml(p.name)}</h3>
          <div class="panel__meta">
            <span class="panel__badge ${statusCls}">${escapeHtml(p.status)}</span>
            <span class="panel__type-badge">${escapeHtml(p.type)}</span>
          </div>
        </div>
      </div>

      <div class="panel__info-grid">
        <div class="panel__info-cell"><span class="panel__cell-label">Parcel</span><span class="panel__cell-value">${escapeHtml(String(p.parcel_id))}</span></div>
        <div class="panel__info-cell"><span class="panel__cell-label">Address</span><span class="panel__cell-value">${escapeHtml(String(p.address))}</span></div>
        ${ownersGridCells(p)}
        <div class="panel__info-cell"><span class="panel__cell-label">Purchase Date</span><span class="panel__cell-value">${purchaseDate}</span></div>
        <div class="panel__info-cell"><span class="panel__cell-label">Purchase Price</span><span class="panel__cell-value panel__cell-value--money">$${Number(p.purchase_price || 0).toLocaleString()}</span></div>
        <div class="panel__info-cell"><span class="panel__cell-label">Assessed Value</span><span class="panel__cell-value panel__cell-value--money">$${Number(p.assessed_value || 0).toLocaleString()}</span></div>
        ${Number(p.square_footage || 0) > 0 ? `<div class="panel__info-cell"><span class="panel__cell-label">Sq Footage</span><span class="panel__cell-value">${Number(p.square_footage).toLocaleString()} sqft</span></div>` : ''}
        <div class="panel__info-cell"><span class="panel__cell-label">Updated</span><span class="panel__cell-value">${updatedDate}</span></div>
        <div class="panel__info-cell"><span class="panel__cell-label">Created</span><span class="panel__cell-value">${p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</span></div>
      </div>
      ${p.notes ? `<div class="panel__notes"><span class="panel__cell-label">Notes</span><p class="panel__notes-text">${escapeHtml(String(p.notes))}</p></div>` : ''}

      <div class="panel__tax-strip">
        <div class="panel__tax-left">
          <span class="panel__tax-amount">$${Number(p.annual_tax || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="panel__tax-period">/ year</span>
        </div>
        <div class="panel__tax-right">
          ${p.tax_zone ? `<span class="panel__tax-zone">${escapeHtml(p.tax_zone)}</span>` : ''}
          <span class="panel__tax-rate">${Number(p.tax_rate || 0)}%</span>
        </div>
      </div>

      <div class="panel__fees-area" id="panelFees"></div>

      <div class="panel__actions">
        ${editBtn}
        ${txBtn}
        ${saleBtn}
        ${transferBtn}
        ${deleteBtn}
      </div>

      <div class="panel__divider"></div>
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
  panel.querySelector('#closePanelBtn')?.addEventListener('click', () => panel.classList.add('hidden'));

  panel.querySelector('#deletePropBtn')?.addEventListener('click', () => {
    panel.querySelector('.panel-delete-confirm')?.remove();
    panel.querySelector('.panel__inner')?.insertAdjacentHTML('beforeend', `
      <div class="panel-delete-confirm">
        <div class="delete-confirm-box">
          <h4>Delete Property</h4>
          <p>Are you sure you want to permanently delete <strong>${escapeHtml(p.name)}</strong>?</p>
          <p class="delete-warning">This will also remove all transaction history. This action cannot be undone.</p>
          <div class="panel-inline-actions">
            <button type="button" class="btn btn-delete-confirm" id="confirmDeleteProp">Yes, Delete</button>
            <button type="button" class="btn btn-compact" id="cancelDeleteProp">Cancel</button>
          </div>
        </div>
      </div>
    `);
    panel.querySelector('#cancelDeleteProp')?.addEventListener('click', () => {
      panel.querySelector('.panel-delete-confirm')?.remove();
    });
    panel.querySelector('#confirmDeleteProp')?.addEventListener('click', async () => {
      const res = await fetch(`/api/properties/${encodeURIComponent(p.id)}`, {
        method: 'DELETE',
        headers: { 'CSRF-Token': csrfToken },
        credentials: 'same-origin'
      });
      if (res.ok) {
        panel.classList.add('hidden');
        featureGroup.eachLayer(layer => {
          if (layer.propertyId === p.id) featureGroup.removeLayer(layer);
        });
      } else {
        showToast('Failed to delete property', 'error');
        panel.querySelector('.panel-delete-confirm')?.remove();
      }
    });
  });

  panel.querySelector('#recordSaleBtn')?.addEventListener('click', () => {
    panel.querySelector('.panel-inline-form')?.remove();
    const isResMulti = p.type === 'Residential' && Array.isArray(p.residential_owners) && p.residential_owners.length > 1;
    const ownersList = isResMulti ? p.residential_owners : [];
    const isNonResidential = p.type !== 'Residential';

    const sellerHtml = isResMulti
      ? `<span class="field-label">Selling owner</span>
         <select id="saleSellerSelect">${ownersList.map((o) =>
           `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)} (${escapeHtml(o.owner_type)})</option>`
         ).join('')}</select>`
      : '';

    const buyerTypeHtml = isNonResidential
      ? `<span class="field-label">Buyer type</span>
         <select id="saleBuyerType">
           <option value="Individual">Individual</option>
           <option value="Business">Business</option>
         </select>
         <div id="saleBizNameGroup" class="hidden" style="position:relative;">
           <span class="field-label">Business name</span>
           <input type="text" id="saleBizNameInput" placeholder="Search business..." autocomplete="off" />
           <input type="hidden" id="saleBizIdInput" />
           <div id="saleBizSuggestions" class="autocomplete-list hidden"></div>
         </div>`
      : '';

    panel.querySelector('.panel__inner')?.insertAdjacentHTML('beforeend', `
      <div class="panel-inline-form">
        <h4>Record Sale</h4>
        ${sellerHtml}
        ${buyerTypeHtml}
        <span class="field-label">${isNonResidential ? 'Buyer (owner name / representative)' : 'Buyer'}</span>
        <input type="text" id="saleBuyerName" placeholder="Sold to (buyer name)" />
        <input type="number" id="salePrice" placeholder="Sale price" step="0.01" />
        <input type="text" id="saleNotes" placeholder="Notes (optional)" />
        <div class="panel-inline-actions">
          <button type="button" class="btn btn-primary btn-compact" id="confirmSale">Confirm Sale</button>
          <button type="button" class="btn btn-compact" id="cancelSale">Cancel</button>
        </div>
      </div>
    `);

    if (isNonResidential) {
      const saleBuyerType = panel.querySelector('#saleBuyerType');
      const saleBizNameGroup = panel.querySelector('#saleBizNameGroup');
      const saleBizNameInput = panel.querySelector('#saleBizNameInput');
      const saleBizIdInput = panel.querySelector('#saleBizIdInput');
      const saleBizSuggestions = panel.querySelector('#saleBizSuggestions');
      let saleBizTimeout;

      saleBuyerType.addEventListener('change', () => {
        const isBiz = saleBuyerType.value === 'Business';
        saleBizNameGroup.classList.toggle('hidden', !isBiz);
        if (!isBiz) {
          saleBizNameInput.value = '';
          saleBizIdInput.value = '';
          saleBizSuggestions.innerHTML = '';
          saleBizSuggestions.classList.add('hidden');
        }
      });

      async function fetchSaleBizSuggestions(query) {
        if (!query || query.length < 1) {
          saleBizSuggestions.innerHTML = '';
          saleBizSuggestions.classList.add('hidden');
          return;
        }
        try {
          const r = await fetch(`/api/businesses/search?q=${encodeURIComponent(query)}`, { credentials: 'same-origin' });
          if (!r.ok) return;
          const results = await r.json();
          saleBizSuggestions.innerHTML = '';
          if (results.length === 0) { saleBizSuggestions.classList.add('hidden'); return; }
          results.forEach((biz) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.textContent = biz.name;
            item.dataset.id = biz.id;
            item.addEventListener('mousedown', (e) => {
              e.preventDefault();
              saleBizNameInput.value = biz.name;
              saleBizIdInput.value = biz.id;
              saleBizSuggestions.innerHTML = '';
              saleBizSuggestions.classList.add('hidden');
            });
            saleBizSuggestions.appendChild(item);
          });
          saleBizSuggestions.classList.remove('hidden');
        } catch (_) { /* ignore */ }
      }

      saleBizNameInput.addEventListener('input', () => {
        saleBizIdInput.value = '';
        clearTimeout(saleBizTimeout);
        saleBizTimeout = setTimeout(() => fetchSaleBizSuggestions(saleBizNameInput.value.trim()), 250);
      });
      saleBizNameInput.addEventListener('blur', () => {
        setTimeout(() => saleBizSuggestions.classList.add('hidden'), 200);
      });
      saleBizNameInput.addEventListener('focus', () => {
        if (saleBizNameInput.value.trim()) fetchSaleBizSuggestions(saleBizNameInput.value.trim());
      });
    }

    panel.querySelector('#cancelSale')?.addEventListener('click', () => {
      panel.querySelector('.panel-inline-form')?.remove();
    });
    panel.querySelector('#confirmSale')?.addEventListener('click', async () => {
      const buyer = panel.querySelector('#saleBuyerName')?.value?.trim();
      const price = Number(panel.querySelector('#salePrice')?.value || 0);
      const notes = panel.querySelector('#saleNotes')?.value?.trim() || null;
      if (!buyer) { showToast('Enter the buyer name', 'error'); return; }

      const isNonRes = p.type !== 'Residential';
      const buyerType = isNonRes ? (panel.querySelector('#saleBuyerType')?.value || 'Individual') : 'Individual';
      const bizName = isNonRes ? (panel.querySelector('#saleBizNameInput')?.value?.trim() || '') : '';
      const bizId = isNonRes ? (panel.querySelector('#saleBizIdInput')?.value || '') : '';

      if (buyerType === 'Business' && !bizName) { showToast('Enter the business name', 'error'); return; }

      const seller = isResMulti
        ? (panel.querySelector('#saleSellerSelect')?.value || p.owner_name)
        : p.owner_name;

      const payload = {
        from_owner: seller,
        to_owner: buyerType === 'Business' ? bizName : buyer,
        sale_price: price,
        transfer_date: new Date().toISOString(),
        notes: notes ? `Sale: ${notes}` : 'Property sale',
        owner_type: buyerType
      };
      if (buyerType === 'Business') {
        payload.business_name = bizName;
        payload.business_id = bizId;
        payload.to_owner = buyer;
        payload.business_display = bizName;
      }

      const res = await fetch(`/api/properties/${encodeURIComponent(p.id)}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        panel.querySelector('.panel-inline-form')?.remove();
        loadProperties(searchInput?.value || '');
        const fresh = await fetch(`/api/properties/${encodeURIComponent(p.id)}`, { credentials: 'same-origin' });
        const updated = await fresh.json();
        if (updated && !updated.error) renderPanel(updated);
      } else {
        showToast('Failed to record sale', 'error');
      }
    });
  });

  panel.querySelector('#transferOwnerBtn')?.addEventListener('click', () => {
    panel.querySelector('.panel-inline-form')?.remove();
    panel.querySelector('.panel__inner')?.insertAdjacentHTML('beforeend', `
      <div class="panel-inline-form">
        <h4>Transfer Ownership</h4>
        <input type="text" id="transferNewOwner" placeholder="New owner name" />
        <select id="transferOwnerType"><option value="Individual">Individual</option><option value="Business">Business</option></select>
        <input type="text" id="transferNotes" placeholder="Notes (optional)" />
        <div class="panel-inline-actions">
          <button type="button" class="btn btn-primary btn-compact" id="confirmTransfer">Confirm Transfer</button>
          <button type="button" class="btn btn-compact" id="cancelTransfer">Cancel</button>
        </div>
      </div>
    `);
    panel.querySelector('#cancelTransfer')?.addEventListener('click', () => {
      panel.querySelector('.panel-inline-form')?.remove();
    });
    panel.querySelector('#confirmTransfer')?.addEventListener('click', async () => {
      const newOwner = panel.querySelector('#transferNewOwner')?.value?.trim();
      const ownerType = panel.querySelector('#transferOwnerType')?.value || 'Individual';
      const notes = panel.querySelector('#transferNotes')?.value?.trim() || null;
      if (!newOwner) { showToast('Enter the new owner name', 'error'); return; }
      const res = await fetch(`/api/properties/${encodeURIComponent(p.id)}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify({
          to_owner: newOwner,
          owner_type: ownerType,
          sale_price: 0,
          transfer_date: new Date().toISOString(),
          notes: notes ? `Transfer: ${notes}` : 'Ownership transfer'
        })
      });
      if (res.ok) {
        panel.querySelector('.panel-inline-form')?.remove();
        loadProperties(searchInput?.value || '');
        const fresh = await fetch(`/api/properties/${encodeURIComponent(p.id)}`, { credentials: 'same-origin' });
        const updated = await fresh.json();
        if (updated && !updated.error) renderPanel(updated);
      } else {
        showToast('Failed to transfer ownership', 'error');
      }
    });
  });

  // Load and render module-specific sections with tabbed layout
  if (p.id && !hidden) {
    const inner = panel.querySelector('.panel__inner');
    if (inner) {
      const moduleWrapper = document.createElement('div');
      moduleWrapper.className = 'panel-modules';
      inner.appendChild(moduleWrapper);

      loadModuleData(p.id).then((moduleData) => {
        renderFeesPreview(p, moduleData);
        const tempContainer = document.createElement('div');
        renderModuleSections(p, moduleData, tempContainer);
        const sections = tempContainer.querySelectorAll('.module-section');
        if (sections.length === 0) return;

        const groups = {};
        const groupOrder = ['finance', 'legal', 'property', 'records', 'admin'];
        const groupLabels = { finance: 'Finance', legal: 'Legal', property: 'Property', records: 'Records', admin: 'Admin' };
        const moduleGroupMap = {
          'Tax Ledger': 'finance', 'Mortgages': 'finance', 'Insurance': 'finance', 'HOA & Community Fees': 'finance',
          'Tax Exemptions': 'finance', 'Auctions': 'finance',
          'Liens & Warrants': 'legal', 'Foreclosure': 'legal', 'Zoning & Permits': 'legal',
          'Eminent Domain': 'legal', 'Code Enforcement': 'legal', 'Property Disputes': 'legal',
          'Photos': 'property', 'Inspections': 'property', 'Improvements': 'property',
          'Damage Reports': 'property', 'Utilities': 'property', 'Environmental Hazards': 'property',
          'Historical Landmark': 'property', 'Landmarks': 'property',
          'Leases': 'records', 'Staff Notes': 'records', 'Reminders': 'records',
          'Access Lists': 'records', 'Parking': 'records',
          'Parcel Split & Merge': 'admin'
        };

        sections.forEach((sec) => {
          const title = sec.querySelector('.module-section__title')?.textContent?.trim()?.replace(/\d+$/, '').trim() || 'Other';
          const group = moduleGroupMap[title] || 'records';
          if (!groups[group]) groups[group] = [];
          groups[group].push(sec);
        });

        let tabsHtml = '<div class="panel__module-tabs">';
        const activeGroups = groupOrder.filter((g) => groups[g]?.length);
        activeGroups.forEach((g, i) => {
          const count = groups[g].length;
          tabsHtml += `<button class="panel__module-tab${i === 0 ? ' panel__module-tab--active' : ''}" data-group="${g}">${groupLabels[g]}<span class="tab-count">${count}</span></button>`;
        });
        tabsHtml += '</div>';
        moduleWrapper.innerHTML = tabsHtml;

        activeGroups.forEach((g, i) => {
          const groupDiv = document.createElement('div');
          groupDiv.className = `panel__module-group panel-modules--grid${i === 0 ? ' panel__module-group--active' : ''}`;
          groupDiv.dataset.group = g;
          groups[g].forEach((sec) => groupDiv.appendChild(sec));
          moduleWrapper.appendChild(groupDiv);
        });

        moduleWrapper.querySelectorAll('.panel__module-tab').forEach((tab) => {
          tab.addEventListener('click', () => {
            moduleWrapper.querySelectorAll('.panel__module-tab').forEach((t) => t.classList.remove('panel__module-tab--active'));
            moduleWrapper.querySelectorAll('.panel__module-group').forEach((g) => g.classList.remove('panel__module-group--active'));
            tab.classList.add('panel__module-tab--active');
            moduleWrapper.querySelector(`.panel__module-group[data-group="${tab.dataset.group}"]`)?.classList.add('panel__module-group--active');
          });
        });
      });
    }
  }
}

let loadSeq = 0;
let postalDebounce;
let postalMarkerLayer = null;
let postalRectLayer = null;

function clearPostalMarkers() {
  if (postalMarkerLayer) { map.removeLayer(postalMarkerLayer); postalMarkerLayer = null; }
  if (postalRectLayer) { map.removeLayer(postalRectLayer); postalRectLayer = null; }
}

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
  allProperties = props;
  filteredProperties = applyFilters(allProperties);
  renderMapFromProperties(filteredProperties);
  if (q && filteredProperties.length > 0 && featureGroup.getLayers().length > 0) {
    try {
      const bounds = featureGroup.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.15), { maxZoom: 5 });
    } catch { /* ignore */ }
  }
}

async function maybeFlyToPostal(searchRaw) {
  const key = postalKeyFromQuery(searchRaw);
  if (!key) { clearPostalMarkers(); return; }
  await loadPostalIndex();
  const entry = postalByCode.get(key);
  if (!entry) { clearPostalMarkers(); return; }
  const cal = postalPayload.calibration || {};
  const gn = postalPayload.marker_nudge || { lat: 0, lng: 0 };
  const ll = postalEntryToLatLng(entry, cal, gn);
  if (!ll) { clearPostalMarkers(); return; }

  const zoom = Number(entry.zoom) || 2;
  map.setView(ll, zoom, { animate: true });

  clearPostalMarkers();

  const pulseIcon = L.divIcon({
    className: 'postal-pulse-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
  postalMarkerLayer = L.marker(ll, { icon: pulseIcon, interactive: false }).addTo(map);

  const spread = 120;
  const sw = L.latLng(ll.lat - spread, ll.lng - spread);
  const ne = L.latLng(ll.lat + spread, ll.lng + spread);
  postalRectLayer = L.rectangle([sw, ne], {
    color: '#2f80ed',
    weight: 2,
    fillColor: '#2f80ed',
    fillOpacity: 0.10,
    dashArray: '6 4',
    interactive: false
  }).addTo(map);
}

const debouncedSearch = debounce((v) => {
  void loadProperties(v);
  void maybeFlyToPostal(v);
}, 300);

searchInput?.addEventListener('input', (e) => {
  debouncedSearch(e.target.value);
});

document.getElementById('legendToggle')?.addEventListener('click', () => legend.classList.toggle('hidden'));

propertyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const gjEl = document.getElementById('geojsonInput');
  let geojson;
  try {
    geojson = JSON.parse(gjEl?.value || 'null');
  } catch {
    showToast('Invalid GeoJSON', 'error');
    return;
  }
  let payload;
  try {
    payload = buildPayloadFromForm(geojson);
  } catch (err) {
    showToast(err.message || 'Check the form', 'error');
    return;
  }

  const editingId = editPropertyId?.value?.trim();
  const headers = { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken };
  const url = editingId ? `/api/properties/${encodeURIComponent(editingId)}` : '/api/properties';
  const method = editingId ? 'PUT' : 'POST';

  setButtonLoading(propertyFormSubmit, true);
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(payload)
  });
  setButtonLoading(propertyFormSubmit, false);
  if (!res.ok) {
    let msg = 'Save failed';
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    showToast(msg, 'error');
    return;
  }

  showToast(editingId ? 'Property updated' : 'Property created', 'success');

  if (selectedWorkOrderId) {
    fetch(`/api/property-requests/${encodeURIComponent(selectedWorkOrderId)}/complete`, {
      method: 'PATCH',
      headers: { 'CSRF-Token': csrfToken },
      credentials: 'same-origin'
    }).catch(() => {});
    selectedWorkOrderId = null;
    void loadWorkOrders();
  }

  propertyModal?.classList.add('hidden');
  resetFormForNew();
  loadProperties(searchInput?.value || '');
});

document.getElementById('closeModal')?.addEventListener('click', () => {
  propertyModal?.classList.add('hidden');
  resetFormForNew();
});

document.getElementById('markSurveyBtn')?.addEventListener('click', async () => {
  const gjEl = document.getElementById('geojsonInput');
  let geojson;
  try {
    geojson = JSON.parse(gjEl?.value || 'null');
  } catch {
    showToast('Invalid GeoJSON', 'error');
    return;
  }
  if (!geojson) { showToast('Draw a property line first', 'error'); return; }

  const editingId = editPropertyId?.value?.trim();
  if (editingId) {
    const fd = new FormData(propertyForm);
    fd.set('status', 'Requires Survey');
    const payload = {
      name: fd.get('name') || 'Unmarked Parcel',
      type: fd.get('type') || 'Residential',
      address: fd.get('address') || 'TBD',
      owner_name: fd.get('owner_name') || 'TBD',
      owner_type: fd.get('owner_type') || 'Individual',
      status: 'Requires Survey',
      notes: fd.get('notes') || null,
      geojson
    };
    const res = await fetch(`/api/properties/${encodeURIComponent(editingId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    if (!res.ok) { showToast('Failed to update', 'error'); return; }
  } else {
    const payload = {
      name: propertyForm?.querySelector('[name="name"]')?.value?.trim() || 'Unmarked Parcel',
      type: propertyTypeSelect?.value || 'Residential',
      address: propertyForm?.querySelector('[name="address"]')?.value?.trim() || 'TBD',
      owner_name: 'TBD',
      owner_type: 'Individual',
      residential_owners: [],
      status: 'Requires Survey',
      notes: propertyForm?.querySelector('[name="notes"]')?.value?.trim() || null,
      geojson
    };
    const res = await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    if (!res.ok) { showToast('Failed to save survey marker', 'error'); return; }
  }
  propertyModal?.classList.add('hidden');
  resetFormForNew();
  loadProperties(searchInput?.value || '');
});

syncOwnerFieldsVisibility();
syncTaxRateUI(false);
syncSqftUI();
loadProperties();

async function loadWorkOrders() {
  if (!isStaff() || !workOrderSelect) return;
  try {
    const r = await fetch('/api/property-requests?status=pending', { credentials: 'same-origin' });
    if (!r.ok) return;
    pendingWorkOrders = await r.json();
  } catch { pendingWorkOrders = []; }
  workOrderSelect.innerHTML = '<option value="">— None —</option>';
  pendingWorkOrders.forEach((wo) => {
    const opt = document.createElement('option');
    opt.value = wo._id || wo.id;
    const label = `${wo.owner_name || 'Unknown'} - ${wo.postal || wo.address || 'N/A'}`;
    opt.textContent = label;
    workOrderSelect.appendChild(opt);
  });
}

workOrderSelect?.addEventListener('change', async () => {
  const id = workOrderSelect.value;
  if (!id) { selectedWorkOrderId = null; return; }
  const wo = pendingWorkOrders.find((w) => (w._id || w.id) === id);
  if (!wo) return;
  selectedWorkOrderId = id;

  const searchTerm = (wo.address || wo.postal || '').trim();
  if (searchTerm) {
    try {
      const r = await fetch(`/api/properties?search=${encodeURIComponent(searchTerm)}`, { credentials: 'same-origin' });
      if (r.ok) {
        const matches = await r.json();
        const match = Array.isArray(matches) ? matches.find((p) => {
          if (p.details_public_hidden) return false;
          const addr = (p.address || '').toLowerCase();
          return addr === searchTerm.toLowerCase();
        }) : null;
        if (match) {
          propertyModal?.classList.add('hidden');
          const propRes = await fetch(`/api/properties/${encodeURIComponent(match.id)}`, { credentials: 'same-origin' });
          const propData = await propRes.json().catch(() => null);
          if (propData && !propData.error) {
            editPropertyId.value = match.id;
            propertyModalTitle.textContent = 'Edit property (from work order)';
            parcelDisplayRow?.classList.remove('hidden');
            if (parcelDisplay) parcelDisplay.textContent = propData.parcel_id || '';
            propertyFormSubmit.textContent = 'Save changes';
            document.getElementById('geojsonInput').value = JSON.stringify(propData.geojson);
            fillFormFromProperty(propData);

            if (wo.type === 'Residential' && Array.isArray(wo.residential_owners) && wo.residential_owners.length > 0) {
              wo.residential_owners.forEach((o) => {
                const existing = collectCoOwners().some((e) => e.name.toLowerCase() === o.name.toLowerCase());
                if (!existing) addCoOwnerRow(o.name || '', o.owner_type || 'Individual');
              });
            } else if (wo.owner_name) {
              const existingNames = collectCoOwners().map((e) => e.name.toLowerCase());
              if (!existingNames.includes(wo.owner_name.toLowerCase()) &&
                  (propData.owner_name || '').toLowerCase() !== wo.owner_name.toLowerCase()) {
                if (propData.type === 'Residential') {
                  addCoOwnerRow(wo.owner_name, wo.owner_type || 'Individual');
                }
              }
            }

            if (workOrderGroup) workOrderGroup.classList.add('hidden');
            propertyModal.classList.remove('hidden');
            return;
          }
        }
      }
    } catch { /* fall through to new-property fill */ }
  }

  if (propertyTypeSelect) propertyTypeSelect.value = wo.type || 'Residential';
  syncOwnerFieldsVisibility();

  const setVal = (name, val) => {
    const el = propertyForm?.querySelector(`[name="${name}"]`);
    if (el) el.value = val ?? '';
  };
  setVal('address', wo.address || '');
  setVal('purchase_price', wo.purchase_price || '');
  setVal('square_footage', wo.square_footage || '');
  setVal('notes', wo.notes || '');

  if (wo.type === 'Residential' && Array.isArray(wo.residential_owners) && wo.residential_owners.length > 0) {
    if (coOwnersList) coOwnersList.innerHTML = '';
    wo.residential_owners.forEach((o) => addCoOwnerRow(o.name || '', o.owner_type || 'Individual'));
  } else {
    setVal('owner_name', wo.owner_name || '');
    setVal('owner_type', wo.owner_type || 'Individual');
  }
  autoCalcAssessedValue();
  syncTaxRateUI(true);
});

if (isStaff()) void loadWorkOrders();

/* ── Public Property Request Form ─────────────────── */
const requestModal = document.getElementById('requestModal');
const requestForm = document.getElementById('requestForm');
const reqTypeSelect = document.getElementById('reqTypeSelect');
const reqResidentialFields = document.getElementById('reqResidentialFields');
const reqCommercialFields = document.getElementById('reqCommercialFields');
const reqCoOwnersList = document.getElementById('reqCoOwnersList');

function addReqCoOwnerRow(name = '', ownerType = 'Individual') {
  if (!reqCoOwnersList) return;
  const row = document.createElement('div');
  row.className = 'co-owner-row';
  const nameIn = document.createElement('input');
  nameIn.type = 'text'; nameIn.placeholder = 'Owner name'; nameIn.value = name; nameIn.className = 'co-owner-name';
  const sel = document.createElement('select');
  sel.className = 'co-owner-type';
  ['Individual', 'Business'].forEach((t) => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t; if (t === ownerType) o.selected = true;
    sel.appendChild(o);
  });
  const rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'btn-remove-co'; rm.textContent = '×';
  rm.addEventListener('click', () => { if (reqCoOwnersList.children.length > 1) row.remove(); });
  row.append(nameIn, sel, rm);
  reqCoOwnersList.appendChild(row);
}

function syncReqTypeFields() {
  if (!reqTypeSelect) return;
  const isRes = reqTypeSelect.value === 'Residential';
  reqResidentialFields?.classList.toggle('hidden', !isRes);
  reqCommercialFields?.classList.toggle('hidden', isRes);
  if (isRes && reqCoOwnersList && reqCoOwnersList.children.length === 0) addReqCoOwnerRow();
}

reqTypeSelect?.addEventListener('change', syncReqTypeFields);
document.getElementById('reqAddCoOwner')?.addEventListener('click', () => addReqCoOwnerRow());

document.getElementById('openRequestForm')?.addEventListener('click', () => {
  requestForm?.reset();
  if (reqCoOwnersList) reqCoOwnersList.innerHTML = '';
  addReqCoOwnerRow();
  syncReqTypeFields();
  requestModal?.classList.remove('hidden');
});

document.getElementById('closeRequestModal')?.addEventListener('click', () => {
  requestModal?.classList.add('hidden');
});

requestForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = reqTypeSelect?.value || 'Residential';
  const payload = {
    type,
    discord_name: document.getElementById('reqDiscordName')?.value?.trim() || '',
    address: document.getElementById('reqAddress')?.value?.trim() || '',
    postal: document.getElementById('reqPostal')?.value?.trim() || '',
    purchase_price: Number(document.getElementById('reqPurchasePrice')?.value || 0),
    square_footage: Number(document.getElementById('reqSqft')?.value || 0),
    notes: document.getElementById('reqNotes')?.value?.trim() || null
  };

  if (type === 'Residential') {
    const owners = [];
    reqCoOwnersList?.querySelectorAll('.co-owner-row').forEach((row) => {
      const n = row.querySelector('.co-owner-name')?.value?.trim();
      const ot = row.querySelector('.co-owner-type')?.value || 'Individual';
      if (n) owners.push({ name: n, owner_type: ot });
    });
    if (!owners.length) { showToast('Add at least one owner', 'error'); return; }
    payload.residential_owners = owners;
    payload.owner_name = owners[0].name;
    payload.owner_type = owners[0].owner_type;
  } else {
    payload.business_name = document.getElementById('reqBusinessName')?.value?.trim() || '';
    payload.owner_name = document.getElementById('reqOwnerName')?.value?.trim() || '';
    payload.owner_type = document.getElementById('reqOwnerType')?.value || 'Individual';
    if (!payload.owner_name) { showToast('Enter the owner name', 'error'); return; }
  }

  try {
    const r = await fetch('/api/property-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    if (r.ok) {
      requestModal?.classList.add('hidden');
      showToast('Your property appraisal request has been submitted!', 'success');
      if (isStaff()) void loadWorkOrders();
    } else {
      const j = await r.json().catch(() => ({}));
      showToast(j.error || 'Failed to submit request', 'error');
    }
  } catch {
    showToast('Network error — please try again', 'error');
  }
});

syncReqTypeFields();

/* ── Fees Preview (above tabs) ────────────────────── */
function renderFeesPreview(p, moduleData) {
  const feesArea = document.getElementById('panelFees');
  if (!feesArea) return;
  const fees = [];
  if (moduleData.hoaFees?.length) {
    moduleData.hoaFees.forEach((h) => {
      fees.push({ label: h.association_name || 'HOA', amount: h.monthly_fee || 0, period: 'mo', status: h.status });
    });
  }
  if (moduleData.insurance?.length) {
    moduleData.insurance.forEach((ins) => {
      if (ins.status === 'Active') fees.push({ label: ins.provider || 'Insurance', amount: ins.premium || 0, period: 'mo', status: 'Active' });
    });
  }
  if (moduleData.mortgages?.length) {
    moduleData.mortgages.forEach((m) => {
      if (m.status === 'Active') fees.push({ label: m.lender || 'Mortgage', amount: m.monthly_payment || 0, period: 'mo', status: 'Active' });
    });
  }
  if (fees.length === 0) return;
  const totalMonthly = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  let html = `<div class="panel__fees-strip">
    <div class="panel__fees-header"><span class="panel__cell-label" style="margin:0">Additional Fees</span><span class="panel__fees-total">$${totalMonthly.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span class="panel__tax-period">/ mo</span></span></div>
    <div class="panel__fees-list">`;
  fees.forEach((f) => {
    const cls = f.status === 'Overdue' ? 'badge--danger' : f.status === 'Active' || f.status === 'Paid' || f.status === 'Current' ? 'badge--success' : 'badge--warning';
    html += `<div class="panel__fee-row"><span>${escapeHtml(f.label)}</span><span><span class="badge ${cls}" style="font-size:9px;margin-right:4px">${f.status}</span>$${Number(f.amount).toLocaleString()}/${f.period}</span></div>`;
  });
  html += '</div></div>';
  feesArea.innerHTML = html;
}

/* ── Module UI Helpers ─────────────────────────────── */

async function loadModuleData(propertyId) {
  const data = {};
  const fetches = [];

  if (isModuleEnabled('law_liens')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/liens`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.liens = d; }).catch(() => { data.liens = []; })
    );
  }
  if (isModuleEnabled('tax_ledger')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/tax-bills`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.taxBills = d; }).catch(() => { data.taxBills = []; })
    );
  }
  if (isModuleEnabled('leases')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/leases`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.leases = d; }).catch(() => { data.leases = []; })
    );
  }
  if (isModuleEnabled('photos')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/photos`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.photos = d; }).catch(() => { data.photos = []; })
    );
  }
  if (isModuleEnabled('staff_notes') && isStaff()) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/notes`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.staffNotes = d; }).catch(() => { data.staffNotes = []; })
    );
  }
  if (isModuleEnabled('mortgages')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/mortgages`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.mortgages = d; }).catch(() => { data.mortgages = []; })
    );
  }
  if (isModuleEnabled('insurance')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/insurance`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.insurance = d; }).catch(() => { data.insurance = []; })
    );
  }
  if (isModuleEnabled('tax_exemptions')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/exemptions`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.exemptions = d; }).catch(() => { data.exemptions = []; })
    );
  }
  if (isModuleEnabled('reminders') && isStaff()) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/reminders`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.reminders = d; }).catch(() => { data.reminders = []; })
    );
  }
  if (isModuleEnabled('hoa_fees')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/hoa`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.hoaFees = d; }).catch(() => { data.hoaFees = []; })
    );
  }
  if (isModuleEnabled('foreclosure')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/foreclosure`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.foreclosure = d; }).catch(() => { data.foreclosure = []; })
    );
  }
  if (isModuleEnabled('zoning_permits')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/zoning`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.zoningPermits = d; }).catch(() => { data.zoningPermits = []; })
    );
  }
  if (isModuleEnabled('code_enforcement')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/citations`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.citations = d; }).catch(() => { data.citations = []; })
    );
  }
  if (isModuleEnabled('inspections')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/inspections`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.inspections = d; }).catch(() => { data.inspections = []; })
    );
  }
  if (isModuleEnabled('improvements')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/improvements`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.improvements = d; }).catch(() => { data.improvements = []; })
    );
  }
  if (isModuleEnabled('damage_reports')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/damage-reports`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.damageReports = d; }).catch(() => { data.damageReports = []; })
    );
  }
  if (isModuleEnabled('utilities')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/utilities`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.utilities = d; }).catch(() => { data.utilities = []; })
    );
  }
  if (isModuleEnabled('environmental')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/environmental`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.environmental = d; }).catch(() => { data.environmental = []; })
    );
  }
  if (isModuleEnabled('landmarks')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/landmark`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.landmark = d; }).catch(() => { data.landmark = []; })
    );
  }
  if (isModuleEnabled('access_lists')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/access-list`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.accessList = d; }).catch(() => { data.accessList = []; })
    );
  }
  if (isModuleEnabled('parking')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/parking`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.parking = d; }).catch(() => { data.parking = []; })
    );
  }
  if (isModuleEnabled('property_disputes')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/disputes`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.disputes = d; }).catch(() => { data.disputes = []; })
    );
  }
  if (isModuleEnabled('eminent_domain')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/eminent-domain`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.eminentDomain = d; }).catch(() => { data.eminentDomain = []; })
    );
  }
  if (isModuleEnabled('auctions')) {
    fetches.push(
      fetch(`/api/modules/properties/${propertyId}/auctions`, { credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : []).then((d) => { data.auctions = d; }).catch(() => { data.auctions = []; })
    );
  }

  await Promise.all(fetches);
  return data;
}

function renderModuleSections(p, moduleData, container) {
  if (!container) return;

  // Photos
  if (isModuleEnabled('photos') && moduleData.photos) {
    const photos = moduleData.photos;
    let photoHtml = `<div class="module-section"><h4 class="module-section__title">Photos</h4>`;
    if (photos.length > 0) {
      photoHtml += `<div class="photo-gallery">`;
      photos.forEach((ph) => {
        photoHtml += `<div class="photo-thumb" data-photo-id="${ph._id}">
          <img src="/uploads/photos/thumb-${escapeHtml(ph.filename)}" alt="${escapeHtml(ph.caption || ph.original_name)}"
               onerror="this.src='/uploads/photos/${escapeHtml(ph.filename)}'" loading="lazy" />
          ${isStaff() ? `<button class="photo-delete-btn" data-id="${ph._id}" title="Delete">&times;</button>` : ''}
        </div>`;
      });
      photoHtml += `</div>`;
    } else {
      photoHtml += `<p class="module-empty">No photos</p>`;
    }
    if (isStaff()) {
      photoHtml += `<form class="photo-upload-form" data-property="${p.id}" enctype="multipart/form-data">
        <input type="file" name="photo" accept="image/*" class="photo-file-input" />
        <input type="text" name="caption" placeholder="Caption (optional)" class="photo-caption-input" />
        <button type="submit" class="btn btn-compact">Upload</button>
      </form>`;
    }
    photoHtml += `</div>`;
    container.insertAdjacentHTML('beforeend', photoHtml);

    container.querySelectorAll('.photo-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const r = await fetch(`/api/modules/photos/${id}`, { method: 'DELETE', headers: { 'CSRF-Token': csrfToken }, credentials: 'same-origin' });
        if (r.ok) { btn.closest('.photo-thumb')?.remove(); showToast('Photo deleted', 'success'); }
        else showToast('Failed to delete photo', 'error');
      });
    });

    container.querySelector('.photo-upload-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const r = await fetch(`/api/modules/properties/${p.id}/photos`, {
        method: 'POST', headers: { 'CSRF-Token': csrfToken }, credentials: 'same-origin', body: fd
      });
      if (r.ok) {
        showToast('Photo uploaded', 'success');
        const fresh = await fetch(`/api/properties/${encodeURIComponent(p.id)}`, { credentials: 'same-origin' });
        const updated = await fresh.json();
        if (updated && !updated.error) renderPanel(updated);
      } else showToast('Upload failed', 'error');
    });
  }

  // Liens
  if (isModuleEnabled('law_liens') && moduleData.liens) {
    const active = moduleData.liens.filter((l) => l.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Liens & Warrants ${active.length ? `<span class="badge badge--danger">${active.length}</span>` : ''}</h4>`;
    if (moduleData.liens.length > 0) {
      html += `<div class="module-list">`;
      moduleData.liens.forEach((l) => {
        html += `<div class="module-list-item ${l.status === 'Active' ? 'module-list-item--danger' : ''}">
          <span><strong>${escapeHtml(l.lien_type)}</strong> — $${Number(l.amount).toLocaleString()}</span>
          <span class="text-muted">${escapeHtml(l.description)}</span>
          <span class="badge badge--${l.status === 'Active' ? 'danger' : 'success'}">${l.status}</span>
          ${isStaff() && l.status === 'Active' ? `<button class="btn btn-compact resolve-lien-btn" data-id="${l._id}">Resolve</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No liens</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Lien</summary>
        <div class="module-form-body">
          <select class="lien-type-select"><option>Tax Lien</option><option>Court Order</option><option>Asset Freeze</option><option>Mechanics Lien</option><option>Other</option></select>
          <input type="number" class="lien-amount-input" placeholder="Amount ($)" step="0.01" />
          <input type="text" class="lien-desc-input" placeholder="Description" />
          <button class="btn btn-compact btn-primary add-lien-btn" data-property="${p.id}">Place Lien</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.resolve-lien-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/liens/${btn.dataset.id}/resolve`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin' });
        if (r.ok) { showToast('Lien resolved', 'success'); renderPanel(p); } else showToast('Failed to resolve lien', 'error');
      });
    });

    container.querySelector('.add-lien-btn')?.addEventListener('click', async () => {
      const sec = container.querySelector('.module-add-form');
      const type = sec.querySelector('.lien-type-select')?.value;
      const amount = sec.querySelector('.lien-amount-input')?.value;
      const desc = sec.querySelector('.lien-desc-input')?.value;
      const r = await fetch(`/api/modules/properties/${p.id}/liens`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ lien_type: type, amount, description: desc })
      });
      if (r.ok) { showToast('Lien placed', 'success'); renderPanel(p); } else showToast('Failed to place lien', 'error');
    });
  }

  // Tax Ledger
  if (isModuleEnabled('tax_ledger') && moduleData.taxBills) {
    const unpaid = moduleData.taxBills.filter((b) => b.status !== 'Paid');
    let html = `<div class="module-section"><h4 class="module-section__title">Tax Ledger ${unpaid.length ? `<span class="badge badge--warning">${unpaid.length} unpaid</span>` : ''}</h4>`;
    if (moduleData.taxBills.length > 0) {
      html += `<div class="module-list">`;
      moduleData.taxBills.forEach((b) => {
        const statusClass = b.status === 'Paid' ? 'success' : b.status === 'Overdue' ? 'danger' : 'warning';
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(b.period)}</strong> — $${Number(b.amount_due).toLocaleString()}</span>
          <span class="text-muted">Paid: $${Number(b.amount_paid).toLocaleString()} | Due: ${new Date(b.due_date).toLocaleDateString()}</span>
          <span class="badge badge--${statusClass}">${b.status}</span>
          ${isStaff() && b.status !== 'Paid' ? `<button class="btn btn-compact pay-tax-btn" data-id="${b._id}" data-remaining="${b.amount_due - b.amount_paid}">Record Payment</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No tax bills</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Create Bill</summary>
        <div class="module-form-body">
          <input type="text" class="tax-period-input" placeholder="Period (e.g. 2026-Q1)" />
          <input type="number" class="tax-amount-input" placeholder="Amount due ($)" step="0.01" />
          <input type="date" class="tax-due-input" />
          <button class="btn btn-compact btn-primary create-bill-btn" data-property="${p.id}">Create Bill</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.pay-tax-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const remaining = Number(btn.dataset.remaining);
        const amount = prompt(`Payment amount (max $${remaining}):`, remaining);
        if (!amount) return;
        const r = await fetch(`/api/modules/tax-bills/${btn.dataset.id}/payment`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ amount: Number(amount) })
        });
        if (r.ok) { showToast('Payment recorded', 'success'); renderPanel(p); } else showToast('Payment failed', 'error');
      });
    });

    container.querySelector('.create-bill-btn')?.addEventListener('click', async () => {
      const sec = container.querySelector('.module-add-form');
      const period = sec.querySelector('.tax-period-input')?.value;
      const amount_due = sec.querySelector('.tax-amount-input')?.value;
      const due_date = sec.querySelector('.tax-due-input')?.value;
      if (!period || !amount_due || !due_date) { showToast('Fill all fields', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/tax-bills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ period, amount_due, due_date })
      });
      if (r.ok) { showToast('Tax bill created', 'success'); renderPanel(p); } else { const j = await r.json().catch(() => ({})); showToast(j.error || 'Failed', 'error'); }
    });
  }

  // Leases
  if (isModuleEnabled('leases') && moduleData.leases) {
    const active = moduleData.leases.filter((l) => l.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Leases ${active.length ? `<span class="badge badge--info">${active.length} active</span>` : ''}</h4>`;
    if (moduleData.leases.length > 0) {
      html += `<div class="module-list">`;
      moduleData.leases.forEach((l) => {
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(l.tenant_name)}</strong> — $${Number(l.monthly_rent).toLocaleString()}/mo</span>
          <span class="text-muted">${new Date(l.start_date).toLocaleDateString()} ${l.end_date ? '→ ' + new Date(l.end_date).toLocaleDateString() : '(ongoing)'}</span>
          <span class="badge badge--${l.status === 'Active' ? 'info' : l.status === 'Expired' ? 'warning' : 'danger'}">${l.status}</span>
          ${isStaff() && l.status === 'Active' ? `<button class="btn btn-compact end-lease-btn" data-id="${l._id}">Terminate</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No leases</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Lease</summary>
        <div class="module-form-body">
          <input type="text" class="lease-tenant-input" placeholder="Tenant name" />
          <input type="number" class="lease-rent-input" placeholder="Monthly rent ($)" step="0.01" />
          <input type="date" class="lease-start-input" />
          <input type="date" class="lease-end-input" />
          <button class="btn btn-compact btn-primary add-lease-btn" data-property="${p.id}">Add Lease</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.end-lease-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/leases/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Terminated', end_date: new Date().toISOString() })
        });
        if (r.ok) { showToast('Lease terminated', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-lease-btn')?.addEventListener('click', async () => {
      const sec = container.querySelector('.module-add-form:last-of-type') || container.querySelector('.module-add-form');
      const tenant = container.querySelector('.lease-tenant-input')?.value;
      const rent = container.querySelector('.lease-rent-input')?.value;
      const start = container.querySelector('.lease-start-input')?.value;
      const end = container.querySelector('.lease-end-input')?.value;
      if (!tenant || !start) { showToast('Tenant name and start date required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/leases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ tenant_name: tenant, monthly_rent: rent, start_date: start, end_date: end || null })
      });
      if (r.ok) { showToast('Lease added', 'success'); renderPanel(p); } else showToast('Failed to add lease', 'error');
    });
  }

  // Staff Notes
  if (isModuleEnabled('staff_notes') && isStaff() && moduleData.staffNotes) {
    let html = `<div class="module-section"><h4 class="module-section__title">Staff Notes</h4>`;
    if (moduleData.staffNotes.length > 0) {
      html += `<div class="module-list">`;
      moduleData.staffNotes.forEach((n) => {
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(n.author?.username || 'Unknown')}</strong> <time class="text-muted">${new Date(n.created_at).toLocaleString()}</time></span>
          <span>${escapeHtml(n.text)}</span>
          <button class="btn btn-compact btn-danger delete-note-btn" data-id="${n._id}" title="Delete">&times;</button>
        </div>`;
      });
      html += `</div>`;
    }
    html += `<div class="note-add-row">
      <input type="text" class="note-text-input" placeholder="Add a note..." />
      <button class="btn btn-compact btn-primary add-note-btn" data-property="${p.id}">Add</button>
    </div></div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.delete-note-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/notes/${btn.dataset.id}`, { method: 'DELETE', headers: { 'CSRF-Token': csrfToken }, credentials: 'same-origin' });
        if (r.ok) { btn.closest('.module-list-item')?.remove(); showToast('Note deleted', 'success'); }
      });
    });

    container.querySelector('.add-note-btn')?.addEventListener('click', async () => {
      const input = container.querySelector('.note-text-input');
      const text = input?.value?.trim();
      if (!text) return;
      const r = await fetch(`/api/modules/properties/${p.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ text })
      });
      if (r.ok) { showToast('Note added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Mortgages
  if (isModuleEnabled('mortgages') && moduleData.mortgages) {
    const active = moduleData.mortgages.filter((m) => m.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Mortgages ${active.length ? `<span class="badge badge--info">${active.length}</span>` : ''}</h4>`;
    if (moduleData.mortgages.length > 0) {
      html += `<div class="module-list">`;
      moduleData.mortgages.forEach((m) => {
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(m.lender_name)}</strong> — $${Number(m.principal).toLocaleString()} at ${m.interest_rate}%</span>
          <span class="text-muted">Balance: $${Number(m.remaining_balance).toLocaleString()} | Payment: $${Number(m.monthly_payment).toLocaleString()}/mo</span>
          <span class="badge badge--${m.status === 'Active' ? 'info' : m.status === 'Paid Off' ? 'success' : 'danger'}">${m.status}</span>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No mortgages</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Mortgage</summary>
        <div class="module-form-body">
          <input type="text" class="mort-lender-input" placeholder="Lender name" />
          <input type="number" class="mort-principal-input" placeholder="Principal ($)" step="0.01" />
          <input type="number" class="mort-rate-input" placeholder="Interest rate (%)" step="0.01" />
          <input type="number" class="mort-payment-input" placeholder="Monthly payment ($)" step="0.01" />
          <input type="date" class="mort-start-input" />
          <button class="btn btn-compact btn-primary add-mort-btn" data-property="${p.id}">Add Mortgage</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelector('.add-mort-btn')?.addEventListener('click', async () => {
      const lender = container.querySelector('.mort-lender-input')?.value;
      const principal = container.querySelector('.mort-principal-input')?.value;
      const rate = container.querySelector('.mort-rate-input')?.value;
      const payment = container.querySelector('.mort-payment-input')?.value;
      const start = container.querySelector('.mort-start-input')?.value;
      if (!lender || !principal || !start) { showToast('Fill required fields', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/mortgages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ lender_name: lender, principal, interest_rate: rate, monthly_payment: payment, start_date: start })
      });
      if (r.ok) { showToast('Mortgage added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Insurance
  if (isModuleEnabled('insurance') && moduleData.insurance) {
    const active = moduleData.insurance.filter((i) => i.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Insurance ${active.length ? `<span class="badge badge--info">${active.length}</span>` : ''}</h4>`;
    if (moduleData.insurance.length > 0) {
      html += `<div class="module-list">`;
      moduleData.insurance.forEach((i) => {
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(i.provider_name)}</strong> — Coverage: $${Number(i.coverage_amount).toLocaleString()}</span>
          <span class="text-muted">Premium: $${Number(i.monthly_premium).toLocaleString()}/mo | ${i.policy_number ? '#' + escapeHtml(i.policy_number) : ''}</span>
          <span class="badge badge--${i.status === 'Active' ? 'info' : i.status === 'Claim Filed' ? 'warning' : 'danger'}">${i.status}</span>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No insurance policies</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Policy</summary>
        <div class="module-form-body">
          <input type="text" class="ins-provider-input" placeholder="Provider name" />
          <input type="text" class="ins-policy-input" placeholder="Policy number" />
          <input type="number" class="ins-coverage-input" placeholder="Coverage amount ($)" step="0.01" />
          <input type="number" class="ins-premium-input" placeholder="Monthly premium ($)" step="0.01" />
          <input type="date" class="ins-start-input" />
          <button class="btn btn-compact btn-primary add-ins-btn" data-property="${p.id}">Add Policy</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelector('.add-ins-btn')?.addEventListener('click', async () => {
      const provider = container.querySelector('.ins-provider-input')?.value;
      const policyNum = container.querySelector('.ins-policy-input')?.value;
      const coverage = container.querySelector('.ins-coverage-input')?.value;
      const premium = container.querySelector('.ins-premium-input')?.value;
      const start = container.querySelector('.ins-start-input')?.value;
      if (!provider || !start) { showToast('Fill required fields', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/insurance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ provider_name: provider, policy_number: policyNum, coverage_amount: coverage, monthly_premium: premium, start_date: start })
      });
      if (r.ok) { showToast('Policy added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Tax Exemptions
  if (isModuleEnabled('tax_exemptions') && moduleData.exemptions) {
    const active = moduleData.exemptions.filter((e) => e.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Tax Exemptions ${active.length ? `<span class="badge badge--success">${active.length} active</span>` : ''}</h4>`;
    if (moduleData.exemptions.length > 0) {
      html += `<div class="module-list">`;
      moduleData.exemptions.forEach((e) => {
        const statusClass = e.status === 'Active' ? 'success' : e.status === 'Pending' ? 'warning' : 'danger';
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(e.exemption_type)}</strong> — ${e.percentage != null ? e.percentage + '%' : '$' + Number(e.amount || 0).toLocaleString()}</span>
          <span class="text-muted">${e.start_date ? new Date(e.start_date).toLocaleDateString() : ''} ${e.end_date ? '→ ' + new Date(e.end_date).toLocaleDateString() : '(ongoing)'}</span>
          <span class="badge badge--${statusClass}">${e.status}</span>
          ${isStaff() && e.status === 'Active' ? `<button class="btn btn-compact revoke-exemption-btn" data-id="${e._id}">Revoke</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No exemptions</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Exemption</summary>
        <div class="module-form-body">
          <select class="exemp-type-select"><option>Homestead</option><option>Senior Citizen</option><option>Veteran</option><option>Disability</option><option>Agricultural</option><option>Religious</option><option>Other</option></select>
          <input type="number" class="exemp-pct-input" placeholder="Percentage (%)" step="0.01" />
          <input type="number" class="exemp-amt-input" placeholder="Or flat amount ($)" step="0.01" />
          <input type="date" class="exemp-start-input" />
          <input type="date" class="exemp-end-input" />
          <input type="text" class="exemp-desc-input" placeholder="Description" />
          <button class="btn btn-compact btn-primary add-exemption-btn" data-property="${p.id}">Add Exemption</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.revoke-exemption-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/exemptions/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Revoked' })
        });
        if (r.ok) { showToast('Exemption revoked', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-exemption-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('.exemp-type-select')?.value;
      const pct = container.querySelector('.exemp-pct-input')?.value;
      const amt = container.querySelector('.exemp-amt-input')?.value;
      const start = container.querySelector('.exemp-start-input')?.value;
      const end = container.querySelector('.exemp-end-input')?.value;
      const desc = container.querySelector('.exemp-desc-input')?.value;
      if (!type) { showToast('Select exemption type', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/exemptions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ exemption_type: type, percentage: pct || null, amount: amt || null, start_date: start || null, end_date: end || null, description: desc })
      });
      if (r.ok) { showToast('Exemption added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Reminders (staff only)
  if (isModuleEnabled('reminders') && isStaff() && moduleData.reminders) {
    const pending = moduleData.reminders.filter((r) => r.status === 'Pending' || r.status === 'Overdue');
    let html = `<div class="module-section"><h4 class="module-section__title">Reminders ${pending.length ? `<span class="badge badge--warning">${pending.length}</span>` : ''}</h4>`;
    if (moduleData.reminders.length > 0) {
      html += `<div class="module-list">`;
      moduleData.reminders.forEach((r) => {
        const statusClass = r.status === 'Completed' ? 'success' : r.status === 'Overdue' ? 'danger' : 'warning';
        html += `<div class="module-list-item ${r.status === 'Overdue' ? 'module-list-item--danger' : ''}">
          <span><strong>${escapeHtml(r.title)}</strong></span>
          <span class="text-muted">Due: ${r.due_date ? new Date(r.due_date).toLocaleDateString() : 'N/A'} ${r.created_by ? '| By: ' + escapeHtml(r.created_by) : ''}</span>
          ${r.notes ? `<span class="text-muted">${escapeHtml(r.notes)}</span>` : ''}
          <span class="badge badge--${statusClass}">${r.status}</span>
          ${r.status !== 'Completed' ? `<button class="btn btn-compact complete-reminder-btn" data-id="${r._id}">Complete</button>` : ''}
          <button class="btn btn-compact btn-danger delete-reminder-btn" data-id="${r._id}" title="Delete">&times;</button>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No reminders</p>`;
    }
    html += `<details class="module-add-form"><summary class="btn btn-compact">Add Reminder</summary>
      <div class="module-form-body">
        <input type="text" class="remind-title-input" placeholder="Reminder title" />
        <input type="date" class="remind-due-input" />
        <input type="text" class="remind-notes-input" placeholder="Notes (optional)" />
        <button class="btn btn-compact btn-primary add-reminder-btn" data-property="${p.id}">Add Reminder</button>
      </div></details>`;
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.complete-reminder-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/reminders/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Completed' })
        });
        if (r.ok) { showToast('Reminder completed', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelectorAll('.delete-reminder-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/reminders/${btn.dataset.id}`, {
          method: 'DELETE', headers: { 'CSRF-Token': csrfToken }, credentials: 'same-origin'
        });
        if (r.ok) { btn.closest('.module-list-item')?.remove(); showToast('Reminder deleted', 'success'); }
        else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-reminder-btn')?.addEventListener('click', async () => {
      const title = container.querySelector('.remind-title-input')?.value;
      const due = container.querySelector('.remind-due-input')?.value;
      const notes = container.querySelector('.remind-notes-input')?.value;
      if (!title) { showToast('Title required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/reminders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ title, due_date: due || null, notes: notes || null })
      });
      if (r.ok) { showToast('Reminder added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // HOA Fees
  if (isModuleEnabled('hoa_fees') && moduleData.hoaFees) {
    const overdue = moduleData.hoaFees.filter((h) => h.status === 'Overdue');
    let html = `<div class="module-section"><h4 class="module-section__title">HOA Fees ${overdue.length ? `<span class="badge badge--danger">${overdue.length} overdue</span>` : ''}</h4>`;
    if (moduleData.hoaFees.length > 0) {
      html += `<div class="module-list">`;
      moduleData.hoaFees.forEach((h) => {
        const statusClass = h.status === 'Paid' ? 'success' : h.status === 'Overdue' ? 'danger' : h.status === 'Current' ? 'info' : 'warning';
        html += `<div class="module-list-item ${h.status === 'Overdue' ? 'module-list-item--danger' : ''}">
          <span><strong>${escapeHtml(h.association_name || 'HOA')}</strong> — $${Number(h.monthly_fee || 0).toLocaleString()}/mo</span>
          <span class="text-muted">${h.due_date ? 'Due: ' + new Date(h.due_date).toLocaleDateString() : ''} ${h.balance != null ? '| Balance: $' + Number(h.balance).toLocaleString() : ''}</span>
          <span class="badge badge--${statusClass}">${h.status}</span>
          ${isStaff() && h.status === 'Overdue' ? `<button class="btn btn-compact pay-hoa-btn" data-id="${h._id}">Record Payment</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No HOA fees</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add HOA Fee</summary>
        <div class="module-form-body">
          <input type="text" class="hoa-assoc-input" placeholder="Association name" />
          <input type="number" class="hoa-fee-input" placeholder="Monthly fee ($)" step="0.01" />
          <input type="date" class="hoa-due-input" />
          <button class="btn btn-compact btn-primary add-hoa-btn" data-property="${p.id}">Add HOA Fee</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.pay-hoa-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/hoa/${btn.dataset.id}/payment`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Paid' })
        });
        if (r.ok) { showToast('Payment recorded', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-hoa-btn')?.addEventListener('click', async () => {
      const assoc = container.querySelector('.hoa-assoc-input')?.value;
      const fee = container.querySelector('.hoa-fee-input')?.value;
      const due = container.querySelector('.hoa-due-input')?.value;
      if (!assoc || !fee) { showToast('Association and fee required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/hoa`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ association_name: assoc, monthly_fee: fee, due_date: due || null })
      });
      if (r.ok) { showToast('HOA fee added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Foreclosure
  if (isModuleEnabled('foreclosure') && moduleData.foreclosure) {
    const active = moduleData.foreclosure.filter((f) => f.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Foreclosure ${active.length ? `<span class="badge badge--danger">${active.length} active</span>` : ''}</h4>`;
    if (moduleData.foreclosure.length > 0) {
      html += `<div class="module-list">`;
      moduleData.foreclosure.forEach((f) => {
        const statusClass = f.status === 'Active' ? 'danger' : f.status === 'Dismissed' ? 'success' : f.status === 'Completed' ? 'warning' : 'info';
        html += `<div class="module-list-item ${f.status === 'Active' ? 'module-list-item--danger' : ''}">
          <span><strong>${escapeHtml(f.lender || 'Unknown lender')}</strong> — Owed: $${Number(f.amount_owed || 0).toLocaleString()}</span>
          <span class="text-muted">Filed: ${f.filing_date ? new Date(f.filing_date).toLocaleDateString() : 'N/A'} ${f.sale_date ? '| Sale: ' + new Date(f.sale_date).toLocaleDateString() : ''}</span>
          <span class="badge badge--${statusClass}">${f.status}</span>
          ${isStaff() && f.status === 'Active' ? `<button class="btn btn-compact dismiss-foreclosure-btn" data-id="${f._id}">Dismiss</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No foreclosure records</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">File Foreclosure</summary>
        <div class="module-form-body">
          <input type="text" class="fc-lender-input" placeholder="Lender name" />
          <input type="number" class="fc-amount-input" placeholder="Amount owed ($)" step="0.01" />
          <input type="date" class="fc-filing-input" />
          <input type="date" class="fc-sale-input" />
          <button class="btn btn-compact btn-primary add-foreclosure-btn" data-property="${p.id}">File Foreclosure</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.dismiss-foreclosure-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/foreclosure/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Dismissed' })
        });
        if (r.ok) { showToast('Foreclosure dismissed', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-foreclosure-btn')?.addEventListener('click', async () => {
      const lender = container.querySelector('.fc-lender-input')?.value;
      const amount = container.querySelector('.fc-amount-input')?.value;
      const filing = container.querySelector('.fc-filing-input')?.value;
      const sale = container.querySelector('.fc-sale-input')?.value;
      if (!lender || !amount) { showToast('Lender and amount required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/foreclosure`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ lender, amount_owed: amount, filing_date: filing || null, sale_date: sale || null })
      });
      if (r.ok) { showToast('Foreclosure filed', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Zoning Permits
  if (isModuleEnabled('zoning_permits') && moduleData.zoningPermits) {
    const pending = moduleData.zoningPermits.filter((z) => z.status === 'Pending');
    let html = `<div class="module-section"><h4 class="module-section__title">Zoning & Permits ${pending.length ? `<span class="badge badge--warning">${pending.length} pending</span>` : ''}</h4>`;
    if (moduleData.zoningPermits.length > 0) {
      html += `<div class="module-list">`;
      moduleData.zoningPermits.forEach((z) => {
        const statusClass = z.status === 'Approved' ? 'success' : z.status === 'Denied' ? 'danger' : z.status === 'Expired' ? 'warning' : 'info';
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(z.permit_type)}</strong> ${z.permit_number ? '#' + escapeHtml(z.permit_number) : ''}</span>
          <span class="text-muted">${z.description ? escapeHtml(z.description) + ' | ' : ''}${z.issued_date ? 'Issued: ' + new Date(z.issued_date).toLocaleDateString() : ''}</span>
          <span class="badge badge--${statusClass}">${z.status}</span>
          ${isStaff() && z.status === 'Pending' ? `<button class="btn btn-compact approve-zoning-btn" data-id="${z._id}">Approve</button><button class="btn btn-compact btn-danger deny-zoning-btn" data-id="${z._id}">Deny</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No permits</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Permit</summary>
        <div class="module-form-body">
          <select class="zoning-type-select"><option>Building Permit</option><option>Zoning Variance</option><option>Conditional Use</option><option>Demolition</option><option>Renovation</option><option>Sign Permit</option><option>Other</option></select>
          <input type="text" class="zoning-number-input" placeholder="Permit number" />
          <input type="text" class="zoning-desc-input" placeholder="Description" />
          <input type="date" class="zoning-date-input" />
          <button class="btn btn-compact btn-primary add-zoning-btn" data-property="${p.id}">Add Permit</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.approve-zoning-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/zoning/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Approved' })
        });
        if (r.ok) { showToast('Permit approved', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelectorAll('.deny-zoning-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/zoning/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Denied' })
        });
        if (r.ok) { showToast('Permit denied', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-zoning-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('.zoning-type-select')?.value;
      const num = container.querySelector('.zoning-number-input')?.value;
      const desc = container.querySelector('.zoning-desc-input')?.value;
      const date = container.querySelector('.zoning-date-input')?.value;
      if (!type) { showToast('Select permit type', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/zoning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ permit_type: type, permit_number: num || null, description: desc || null, issued_date: date || null })
      });
      if (r.ok) { showToast('Permit added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Code Enforcement
  if (isModuleEnabled('code_enforcement') && moduleData.citations) {
    const open = moduleData.citations.filter((c) => c.status === 'Open');
    let html = `<div class="module-section"><h4 class="module-section__title">Code Enforcement ${open.length ? `<span class="badge badge--danger">${open.length} open</span>` : ''}</h4>`;
    if (moduleData.citations.length > 0) {
      html += `<div class="module-list">`;
      moduleData.citations.forEach((c) => {
        const statusClass = c.status === 'Resolved' ? 'success' : c.status === 'Appealed' ? 'warning' : 'danger';
        html += `<div class="module-list-item ${c.status === 'Open' ? 'module-list-item--danger' : ''}">
          <span><strong>${escapeHtml(c.violation_type)}</strong> ${c.citation_number ? '#' + escapeHtml(c.citation_number) : ''} ${c.fine_amount ? '— $' + Number(c.fine_amount).toLocaleString() : ''}</span>
          <span class="text-muted">${c.description ? escapeHtml(c.description) + ' | ' : ''}${c.date_issued ? 'Issued: ' + new Date(c.date_issued).toLocaleDateString() : ''}</span>
          <span class="badge badge--${statusClass}">${c.status}</span>
          ${isStaff() && c.status === 'Open' ? `<button class="btn btn-compact resolve-citation-btn" data-id="${c._id}">Resolve</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No citations</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Issue Citation</summary>
        <div class="module-form-body">
          <select class="cite-type-select"><option>Building Code</option><option>Fire Safety</option><option>Zoning Violation</option><option>Nuisance</option><option>Health Hazard</option><option>Overgrown Property</option><option>Other</option></select>
          <input type="text" class="cite-number-input" placeholder="Citation number" />
          <input type="number" class="cite-fine-input" placeholder="Fine amount ($)" step="0.01" />
          <input type="text" class="cite-desc-input" placeholder="Description" />
          <button class="btn btn-compact btn-primary add-citation-btn" data-property="${p.id}">Issue Citation</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.resolve-citation-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/citations/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Resolved' })
        });
        if (r.ok) { showToast('Citation resolved', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-citation-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('.cite-type-select')?.value;
      const num = container.querySelector('.cite-number-input')?.value;
      const fine = container.querySelector('.cite-fine-input')?.value;
      const desc = container.querySelector('.cite-desc-input')?.value;
      if (!type) { showToast('Select violation type', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/citations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ violation_type: type, citation_number: num || null, fine_amount: fine || null, description: desc || null })
      });
      if (r.ok) { showToast('Citation issued', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Inspections
  if (isModuleEnabled('inspections') && moduleData.inspections) {
    const all = moduleData.inspections;
    const scheduled = all.filter((i) => i.status === 'Scheduled' || i.status === 'Pending');
    let html = `<div class="module-section"><h4 class="module-section__title">Inspections ${scheduled.length ? `<span class="badge badge--info">${scheduled.length} upcoming</span>` : ''}</h4>`;
    if (all.length > 0) {
      const latest = all[0];
      const rest = all.slice(1);
      const statusClass = latest.status === 'Passed' ? 'success' : latest.status === 'Failed' ? 'danger' : latest.status === 'Scheduled' ? 'info' : 'warning';
      html += `<div class="module-list"><div class="module-list-item ${latest.status === 'Failed' ? 'module-list-item--danger' : ''}">
        <span><strong>${escapeHtml(latest.inspection_type)}</strong> ${latest.inspector ? '— ' + escapeHtml(latest.inspector) : ''}</span>
        <span class="text-muted">${latest.date ? new Date(latest.date).toLocaleDateString() : 'Not scheduled'} ${latest.notes ? '| ' + escapeHtml(latest.notes) : ''}</span>
        <span class="badge badge--${statusClass}">${latest.status}</span>
        ${isStaff() && (latest.status === 'Scheduled' || latest.status === 'Pending') ? `<button class="btn btn-compact pass-insp-btn" data-id="${latest._id}">Pass</button><button class="btn btn-compact btn-danger fail-insp-btn" data-id="${latest._id}">Fail</button>` : ''}
      </div></div>`;
      if (rest.length > 0) {
        html += `<details class="report-history"><summary class="btn btn-compact btn-history">View History (${rest.length})</summary><div class="module-list">`;
        rest.forEach((i) => {
          const sc = i.status === 'Passed' ? 'success' : i.status === 'Failed' ? 'danger' : i.status === 'Scheduled' ? 'info' : 'warning';
          html += `<div class="module-list-item ${i.status === 'Failed' ? 'module-list-item--danger' : ''}">
            <span><strong>${escapeHtml(i.inspection_type)}</strong> ${i.inspector ? '— ' + escapeHtml(i.inspector) : ''}</span>
            <span class="text-muted">${i.date ? new Date(i.date).toLocaleDateString() : '—'} ${i.notes ? '| ' + escapeHtml(i.notes) : ''}</span>
            <span class="badge badge--${sc}">${i.status}</span>
            ${isStaff() && (i.status === 'Scheduled' || i.status === 'Pending') ? `<button class="btn btn-compact pass-insp-btn" data-id="${i._id}">Pass</button><button class="btn btn-compact btn-danger fail-insp-btn" data-id="${i._id}">Fail</button>` : ''}
          </div>`;
        });
        html += '</div></details>';
      }
    } else {
      html += `<p class="module-empty">No inspections</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Schedule Inspection</summary>
        <div class="module-form-body">
          <select class="insp-type-select"><option>General</option><option>Fire Safety</option><option>Structural</option><option>Electrical</option><option>Plumbing</option><option>Health & Safety</option><option>Final Walkthrough</option><option>Other</option></select>
          <input type="text" class="insp-inspector-input" placeholder="Inspector name" />
          <input type="date" class="insp-date-input" />
          <input type="text" class="insp-notes-input" placeholder="Notes (optional)" />
          <button class="btn btn-compact btn-primary add-insp-btn" data-property="${p.id}">Schedule</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.pass-insp-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/inspections/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Passed' })
        });
        if (r.ok) { showToast('Inspection passed', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelectorAll('.fail-insp-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/inspections/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Failed' })
        });
        if (r.ok) { showToast('Inspection failed', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-insp-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('.insp-type-select')?.value;
      const inspector = container.querySelector('.insp-inspector-input')?.value;
      const date = container.querySelector('.insp-date-input')?.value;
      const notes = container.querySelector('.insp-notes-input')?.value;
      if (!type || !date) { showToast('Type and date required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/inspections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ inspection_type: type, inspector: inspector || null, date, notes: notes || null })
      });
      if (r.ok) { showToast('Inspection scheduled', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Improvements
  if (isModuleEnabled('improvements') && moduleData.improvements) {
    const inProgress = moduleData.improvements.filter((i) => i.status === 'In Progress' || i.status === 'Planned');
    let html = `<div class="module-section"><h4 class="module-section__title">Improvements ${inProgress.length ? `<span class="badge badge--info">${inProgress.length} active</span>` : ''}</h4>`;
    if (moduleData.improvements.length > 0) {
      html += `<div class="module-list">`;
      moduleData.improvements.forEach((i) => {
        const statusClass = i.status === 'Completed' ? 'success' : i.status === 'In Progress' ? 'info' : i.status === 'Planned' ? 'warning' : 'danger';
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(i.description)}</strong> ${i.cost ? '— $' + Number(i.cost).toLocaleString() : ''}</span>
          <span class="text-muted">${i.contractor ? escapeHtml(i.contractor) + ' | ' : ''}${i.date_completed ? 'Completed: ' + new Date(i.date_completed).toLocaleDateString() : ''}</span>
          <span class="badge badge--${statusClass}">${i.status}</span>
          ${isStaff() && i.status !== 'Completed' ? `<button class="btn btn-compact complete-improve-btn" data-id="${i._id}">Complete</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No improvements</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Improvement</summary>
        <div class="module-form-body">
          <input type="text" class="improve-desc-input" placeholder="Description" />
          <input type="number" class="improve-cost-input" placeholder="Cost ($)" step="0.01" />
          <input type="text" class="improve-contractor-input" placeholder="Contractor" />
          <select class="improve-status-select"><option>Planned</option><option>In Progress</option><option>Completed</option></select>
          <input type="date" class="improve-date-input" />
          <button class="btn btn-compact btn-primary add-improve-btn" data-property="${p.id}">Add Improvement</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.complete-improve-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/improvements/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Completed', date_completed: new Date().toISOString() })
        });
        if (r.ok) { showToast('Improvement completed', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-improve-btn')?.addEventListener('click', async () => {
      const desc = container.querySelector('.improve-desc-input')?.value;
      const cost = container.querySelector('.improve-cost-input')?.value;
      const contractor = container.querySelector('.improve-contractor-input')?.value;
      const status = container.querySelector('.improve-status-select')?.value;
      const date = container.querySelector('.improve-date-input')?.value;
      if (!desc) { showToast('Description required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/improvements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ description: desc, cost: cost || null, contractor: contractor || null, status: status || 'Planned', date_completed: date || null })
      });
      if (r.ok) { showToast('Improvement added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Damage Reports
  if (isModuleEnabled('damage_reports') && moduleData.damageReports) {
    const all = moduleData.damageReports;
    const unresolved = all.filter((d) => d.status !== 'Repaired');
    let html = `<div class="module-section"><h4 class="module-section__title">Damage Reports ${unresolved.length ? `<span class="badge badge--danger">${unresolved.length} unresolved</span>` : ''}</h4>`;
    if (all.length > 0) {
      const latest = all[0];
      const rest = all.slice(1);
      const statusClass = latest.status === 'Repaired' ? 'success' : latest.status === 'Under Review' ? 'warning' : 'danger';
      const sevClass = latest.severity === 'Severe' ? 'danger' : latest.severity === 'Moderate' ? 'warning' : 'info';
      html += `<div class="module-list"><div class="module-list-item ${latest.severity === 'Severe' ? 'module-list-item--danger' : ''}">
        <span><strong>${escapeHtml(latest.damage_type)}</strong> ${latest.estimated_cost ? '— Est. $' + Number(latest.estimated_cost).toLocaleString() : ''}</span>
        <span class="text-muted">${latest.description ? escapeHtml(latest.description) + ' | ' : ''}${latest.date_reported ? 'Reported: ' + new Date(latest.date_reported).toLocaleDateString() : ''}</span>
        <span class="badge badge--${sevClass}">${latest.severity || 'Unknown'}</span> <span class="badge badge--${statusClass}">${latest.status}</span>
        ${isStaff() && latest.status !== 'Repaired' ? `<button class="btn btn-compact repair-damage-btn" data-id="${latest._id}">Mark Repaired</button>` : ''}
      </div></div>`;
      if (rest.length > 0) {
        html += `<details class="report-history"><summary class="btn btn-compact btn-history">View History (${rest.length})</summary><div class="module-list">`;
        rest.forEach((d) => {
          const sc = d.status === 'Repaired' ? 'success' : d.status === 'Under Review' ? 'warning' : 'danger';
          const sv = d.severity === 'Severe' ? 'danger' : d.severity === 'Moderate' ? 'warning' : 'info';
          html += `<div class="module-list-item ${d.severity === 'Severe' ? 'module-list-item--danger' : ''}">
            <span><strong>${escapeHtml(d.damage_type)}</strong> ${d.estimated_cost ? '— Est. $' + Number(d.estimated_cost).toLocaleString() : ''}</span>
            <span class="text-muted">${d.date_reported ? new Date(d.date_reported).toLocaleDateString() : '—'}</span>
            <span class="badge badge--${sv}">${d.severity || '?'}</span> <span class="badge badge--${sc}">${d.status}</span>
            ${isStaff() && d.status !== 'Repaired' ? `<button class="btn btn-compact repair-damage-btn" data-id="${d._id}">Mark Repaired</button>` : ''}
          </div>`;
        });
        html += '</div></details>';
      }
    } else {
      html += `<p class="module-empty">No damage reports</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Report Damage</summary>
        <div class="module-form-body">
          <select class="dmg-type-select"><option>Structural</option><option>Water</option><option>Fire</option><option>Storm</option><option>Vandalism</option><option>Wear & Tear</option><option>Other</option></select>
          <select class="dmg-severity-select"><option>Minor</option><option>Moderate</option><option>Severe</option></select>
          <input type="number" class="dmg-cost-input" placeholder="Estimated cost ($)" step="0.01" />
          <input type="text" class="dmg-desc-input" placeholder="Description" />
          <button class="btn btn-compact btn-primary add-damage-btn" data-property="${p.id}">Report Damage</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.repair-damage-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/damage-reports/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Repaired' })
        });
        if (r.ok) { showToast('Marked as repaired', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-damage-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('.dmg-type-select')?.value;
      const severity = container.querySelector('.dmg-severity-select')?.value;
      const cost = container.querySelector('.dmg-cost-input')?.value;
      const desc = container.querySelector('.dmg-desc-input')?.value;
      if (!type) { showToast('Select damage type', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/damage-reports`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ damage_type: type, severity, estimated_cost: cost || null, description: desc || null })
      });
      if (r.ok) { showToast('Damage reported', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Utilities
  if (isModuleEnabled('utilities') && moduleData.utilities) {
    const active = moduleData.utilities.filter((u) => u.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Utilities ${active.length ? `<span class="badge badge--info">${active.length} active</span>` : ''}</h4>`;
    if (moduleData.utilities.length > 0) {
      html += `<div class="module-list">`;
      moduleData.utilities.forEach((u) => {
        const statusClass = u.status === 'Active' ? 'info' : u.status === 'Disconnected' ? 'danger' : 'warning';
        html += `<div class="module-list-item ${u.status === 'Disconnected' ? 'module-list-item--danger' : ''}">
          <span><strong>${escapeHtml(u.utility_type)}</strong> — ${escapeHtml(u.provider || 'Unknown provider')}</span>
          <span class="text-muted">${u.account_number ? 'Acct: ' + escapeHtml(u.account_number) + ' | ' : ''}${u.monthly_cost ? '$' + Number(u.monthly_cost).toLocaleString() + '/mo' : ''}</span>
          <span class="badge badge--${statusClass}">${u.status}</span>
          ${isStaff() && u.status === 'Active' ? `<button class="btn btn-compact disconnect-util-btn" data-id="${u._id}">Disconnect</button>` : ''}
          ${isStaff() && u.status === 'Disconnected' ? `<button class="btn btn-compact reconnect-util-btn" data-id="${u._id}">Reconnect</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No utilities</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Utility</summary>
        <div class="module-form-body">
          <select class="util-type-select"><option>Electric</option><option>Water</option><option>Gas</option><option>Sewer</option><option>Internet</option><option>Trash</option><option>Other</option></select>
          <input type="text" class="util-provider-input" placeholder="Provider name" />
          <input type="text" class="util-acct-input" placeholder="Account number" />
          <input type="number" class="util-cost-input" placeholder="Monthly cost ($)" step="0.01" />
          <button class="btn btn-compact btn-primary add-util-btn" data-property="${p.id}">Add Utility</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.disconnect-util-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/utilities/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Disconnected' })
        });
        if (r.ok) { showToast('Utility disconnected', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelectorAll('.reconnect-util-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/utilities/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Active' })
        });
        if (r.ok) { showToast('Utility reconnected', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-util-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('.util-type-select')?.value;
      const provider = container.querySelector('.util-provider-input')?.value;
      const acct = container.querySelector('.util-acct-input')?.value;
      const cost = container.querySelector('.util-cost-input')?.value;
      if (!type || !provider) { showToast('Type and provider required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/utilities`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ utility_type: type, provider, account_number: acct || null, monthly_cost: cost || null })
      });
      if (r.ok) { showToast('Utility added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Environmental
  if (isModuleEnabled('environmental') && moduleData.environmental) {
    const flagged = moduleData.environmental.filter((e) => e.status === 'Contaminated' || e.risk_level === 'High');
    let html = `<div class="module-section"><h4 class="module-section__title">Environmental ${flagged.length ? `<span class="badge badge--danger">${flagged.length} flagged</span>` : ''}</h4>`;
    if (moduleData.environmental.length > 0) {
      html += `<div class="module-list">`;
      moduleData.environmental.forEach((e) => {
        const statusClass = e.status === 'Clear' ? 'success' : e.status === 'Contaminated' ? 'danger' : 'warning';
        const riskClass = e.risk_level === 'High' ? 'danger' : e.risk_level === 'Medium' ? 'warning' : 'info';
        html += `<div class="module-list-item ${e.status === 'Contaminated' ? 'module-list-item--danger' : ''}">
          <span><strong>${escapeHtml(e.assessment_type)}</strong></span>
          <span class="text-muted">${e.description ? escapeHtml(e.description) + ' | ' : ''}${e.date ? new Date(e.date).toLocaleDateString() : ''}</span>
          <span class="badge badge--${statusClass}">${e.status}</span>
          ${e.risk_level ? `<span class="badge badge--${riskClass}">${e.risk_level} risk</span>` : ''}
          ${isStaff() && e.status === 'Under Review' ? `<button class="btn btn-compact clear-env-btn" data-id="${e._id}">Mark Clear</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No environmental records</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Assessment</summary>
        <div class="module-form-body">
          <select class="env-type-select"><option>Phase I ESA</option><option>Phase II ESA</option><option>Soil Test</option><option>Water Quality</option><option>Air Quality</option><option>Asbestos Survey</option><option>Lead Paint</option><option>Other</option></select>
          <select class="env-risk-select"><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select>
          <input type="text" class="env-desc-input" placeholder="Description" />
          <input type="date" class="env-date-input" />
          <button class="btn btn-compact btn-primary add-env-btn" data-property="${p.id}">Add Assessment</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.clear-env-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/environmental/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Clear' })
        });
        if (r.ok) { showToast('Assessment cleared', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-env-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('.env-type-select')?.value;
      const risk = container.querySelector('.env-risk-select')?.value;
      const desc = container.querySelector('.env-desc-input')?.value;
      const date = container.querySelector('.env-date-input')?.value;
      if (!type) { showToast('Select assessment type', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/environmental`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ assessment_type: type, risk_level: risk, description: desc || null, date: date || null })
      });
      if (r.ok) { showToast('Assessment added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Landmarks
  if (isModuleEnabled('landmarks') && moduleData.landmark) {
    const active = moduleData.landmark.filter((l) => l.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Landmark Designations ${active.length ? `<span class="badge badge--success">${active.length}</span>` : ''}</h4>`;
    if (moduleData.landmark.length > 0) {
      html += `<div class="module-list">`;
      moduleData.landmark.forEach((l) => {
        const statusClass = l.status === 'Active' ? 'success' : l.status === 'Pending' ? 'warning' : 'danger';
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(l.designation)}</strong> ${l.authority ? '— ' + escapeHtml(l.authority) : ''}</span>
          <span class="text-muted">${l.description ? escapeHtml(l.description) + ' | ' : ''}${l.date_designated ? 'Designated: ' + new Date(l.date_designated).toLocaleDateString() : ''}</span>
          <span class="badge badge--${statusClass}">${l.status}</span>
          ${isStaff() && l.status === 'Active' ? `<button class="btn btn-compact revoke-landmark-btn" data-id="${l._id}">Revoke</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No landmark designations</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Designation</summary>
        <div class="module-form-body">
          <input type="text" class="lm-desig-input" placeholder="Designation title" />
          <input type="text" class="lm-authority-input" placeholder="Designating authority" />
          <input type="text" class="lm-desc-input" placeholder="Description" />
          <input type="date" class="lm-date-input" />
          <button class="btn btn-compact btn-primary add-landmark-btn" data-property="${p.id}">Add Designation</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.revoke-landmark-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/landmark/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Revoked' })
        });
        if (r.ok) { showToast('Designation revoked', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-landmark-btn')?.addEventListener('click', async () => {
      const desig = container.querySelector('.lm-desig-input')?.value;
      const authority = container.querySelector('.lm-authority-input')?.value;
      const desc = container.querySelector('.lm-desc-input')?.value;
      const date = container.querySelector('.lm-date-input')?.value;
      if (!desig) { showToast('Designation title required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/landmark`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ designation: desig, authority: authority || null, description: desc || null, date_designated: date || null })
      });
      if (r.ok) { showToast('Designation added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Access Lists
  if (isModuleEnabled('access_lists') && moduleData.accessList) {
    const active = moduleData.accessList.filter((a) => a.status === 'Active');
    let html = `<div class="module-section"><h4 class="module-section__title">Access List ${active.length ? `<span class="badge badge--info">${active.length} active</span>` : ''}</h4>`;
    if (moduleData.accessList.length > 0) {
      html += `<div class="module-list">`;
      moduleData.accessList.forEach((a) => {
        const statusClass = a.status === 'Active' ? 'info' : 'danger';
        html += `<div class="module-list-item">
          <span><strong>${escapeHtml(a.person_name)}</strong> — ${escapeHtml(a.access_level || 'Standard')}</span>
          <span class="text-muted">${a.granted_date ? 'Granted: ' + new Date(a.granted_date).toLocaleDateString() : ''} ${a.notes ? '| ' + escapeHtml(a.notes) : ''}</span>
          <span class="badge badge--${statusClass}">${a.status}</span>
          ${isStaff() && a.status === 'Active' ? `<button class="btn btn-compact revoke-access-btn" data-id="${a._id}">Revoke</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No access entries</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Access Entry</summary>
        <div class="module-form-body">
          <input type="text" class="acl-name-input" placeholder="Person name" />
          <select class="acl-level-select"><option>Full Access</option><option>Restricted</option><option>Temporary</option><option>Emergency Only</option></select>
          <input type="text" class="acl-notes-input" placeholder="Notes (optional)" />
          <button class="btn btn-compact btn-primary add-access-btn" data-property="${p.id}">Add Entry</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.revoke-access-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/access-list/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Revoked' })
        });
        if (r.ok) { showToast('Access revoked', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-access-btn')?.addEventListener('click', async () => {
      const name = container.querySelector('.acl-name-input')?.value;
      const level = container.querySelector('.acl-level-select')?.value;
      const notes = container.querySelector('.acl-notes-input')?.value;
      if (!name) { showToast('Person name required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/access-list`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ person_name: name, access_level: level, notes: notes || null })
      });
      if (r.ok) { showToast('Access granted', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Parking
  if (isModuleEnabled('parking') && moduleData.parking) {
    const occupied = moduleData.parking.filter((pk) => pk.status === 'Occupied' || pk.status === 'Reserved');
    let html = `<div class="module-section"><h4 class="module-section__title">Parking ${occupied.length ? `<span class="badge badge--info">${occupied.length} in use</span>` : ''}</h4>`;
    if (moduleData.parking.length > 0) {
      html += `<div class="module-list">`;
      moduleData.parking.forEach((pk) => {
        const statusClass = pk.status === 'Available' ? 'success' : pk.status === 'Occupied' ? 'info' : pk.status === 'Reserved' ? 'warning' : 'danger';
        html += `<div class="module-list-item">
          <span><strong>Space ${escapeHtml(pk.space_number || '?')}</strong> — ${escapeHtml(pk.type || 'Standard')} ${pk.monthly_fee ? '| $' + Number(pk.monthly_fee).toLocaleString() + '/mo' : ''}</span>
          <span class="text-muted">${pk.assigned_to ? 'Assigned: ' + escapeHtml(pk.assigned_to) : 'Unassigned'}</span>
          <span class="badge badge--${statusClass}">${pk.status}</span>
          ${isStaff() && pk.status !== 'Available' ? `<button class="btn btn-compact release-parking-btn" data-id="${pk._id}">Release</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No parking spaces</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Add Parking Space</summary>
        <div class="module-form-body">
          <input type="text" class="park-number-input" placeholder="Space number" />
          <select class="park-type-select"><option>Standard</option><option>Reserved</option><option>Guest</option><option>Handicapped</option><option>Loading</option></select>
          <input type="text" class="park-assigned-input" placeholder="Assigned to (optional)" />
          <input type="number" class="park-fee-input" placeholder="Monthly fee ($)" step="0.01" />
          <button class="btn btn-compact btn-primary add-parking-btn" data-property="${p.id}">Add Space</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.release-parking-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/parking/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Available', assigned_to: null })
        });
        if (r.ok) { showToast('Space released', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-parking-btn')?.addEventListener('click', async () => {
      const num = container.querySelector('.park-number-input')?.value;
      const type = container.querySelector('.park-type-select')?.value;
      const assigned = container.querySelector('.park-assigned-input')?.value;
      const fee = container.querySelector('.park-fee-input')?.value;
      if (!num) { showToast('Space number required', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/parking`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ space_number: num, type, assigned_to: assigned || null, monthly_fee: fee || null })
      });
      if (r.ok) { showToast('Space added', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Property Disputes
  if (isModuleEnabled('property_disputes') && moduleData.disputes) {
    const open = moduleData.disputes.filter((d) => d.status === 'Open' || d.status === 'Escalated');
    let html = `<div class="module-section"><h4 class="module-section__title">Property Disputes ${open.length ? `<span class="badge badge--danger">${open.length} open</span>` : ''}</h4>`;
    if (moduleData.disputes.length > 0) {
      html += `<div class="module-list">`;
      moduleData.disputes.forEach((d) => {
        const statusClass = d.status === 'Resolved' ? 'success' : d.status === 'Escalated' ? 'danger' : d.status === 'Open' ? 'warning' : 'info';
        html += `<div class="module-list-item ${d.status === 'Escalated' ? 'module-list-item--danger' : ''}">
          <span><strong>${escapeHtml(d.dispute_type)}</strong> ${d.parties ? '— ' + escapeHtml(d.parties) : ''}</span>
          <span class="text-muted">${d.description ? escapeHtml(d.description) + ' | ' : ''}${d.filed_date ? 'Filed: ' + new Date(d.filed_date).toLocaleDateString() : ''}</span>
          <span class="badge badge--${statusClass}">${d.status}</span>
          ${isStaff() && d.status === 'Open' ? `<button class="btn btn-compact resolve-dispute-btn" data-id="${d._id}">Resolve</button><button class="btn btn-compact btn-danger escalate-dispute-btn" data-id="${d._id}">Escalate</button>` : ''}
          ${isStaff() && d.status === 'Escalated' ? `<button class="btn btn-compact resolve-dispute-btn" data-id="${d._id}">Resolve</button>` : ''}
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<p class="module-empty">No disputes</p>`;
    }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">File Dispute</summary>
        <div class="module-form-body">
          <select class="disp-type-select"><option>Boundary</option><option>Easement</option><option>Noise</option><option>Encroachment</option><option>Ownership</option><option>Nuisance</option><option>Other</option></select>
          <input type="text" class="disp-parties-input" placeholder="Parties involved" />
          <input type="text" class="disp-desc-input" placeholder="Description" />
          <button class="btn btn-compact btn-primary add-dispute-btn" data-property="${p.id}">File Dispute</button>
        </div></details>`;
    }
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.resolve-dispute-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/disputes/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Resolved' })
        });
        if (r.ok) { showToast('Dispute resolved', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelectorAll('.escalate-dispute-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/disputes/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Escalated' })
        });
        if (r.ok) { showToast('Dispute escalated', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });

    container.querySelector('.add-dispute-btn')?.addEventListener('click', async () => {
      const type = container.querySelector('.disp-type-select')?.value;
      const parties = container.querySelector('.disp-parties-input')?.value;
      const desc = container.querySelector('.disp-desc-input')?.value;
      if (!type) { showToast('Select dispute type', 'error'); return; }
      const r = await fetch(`/api/modules/properties/${p.id}/disputes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ dispute_type: type, parties: parties || null, description: desc || null })
      });
      if (r.ok) { showToast('Dispute filed', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Eminent Domain
  if (isModuleEnabled('eminent_domain') && moduleData.eminentDomain) {
    const items = Array.isArray(moduleData.eminentDomain) ? moduleData.eminentDomain : [];
    let html = `<div class="module-section"><h4 class="module-section__title">Eminent Domain ${items.length ? `<span class="badge badge--danger">${items.length}</span>` : ''}</h4>`;
    if (items.length > 0) {
      html += '<div class="module-list">';
      items.forEach((ed) => {
        const cls = ed.stage === 'Acquired' ? 'badge--danger' : ed.stage === 'Rejected' ? 'badge--success' : ed.stage === 'Council Vote' ? 'badge--warning' : 'badge--info';
        html += `<div class="module-list-item"><span><strong>${escapeHtml(ed.stage)}</strong> — ${escapeHtml(ed.reason || '')}</span>
          <span class="text-muted">Offered: $${Number(ed.offered_amount || 0).toLocaleString()} | Votes: ${ed.vote_yes || 0} Y / ${ed.vote_no || 0} N</span>
          <span class="badge ${cls}">${ed.stage}</span>
          ${isStaff() && user?.role === 'admin' && ed.stage !== 'Acquired' && ed.stage !== 'Rejected' ? `<button class="btn btn-compact advance-ed-btn" data-id="${ed._id}">Advance Stage</button>` : ''}
        </div>`;
      });
      html += '</div>';
    } else { html += '<p class="module-empty">No eminent domain cases</p>'; }
    if (isStaff() && user?.role === 'admin') {
      html += `<details class="module-add-form"><summary class="btn btn-compact">File ED Case</summary><div class="module-form-body">
        <textarea class="ed-reason-input" placeholder="Reason for acquisition" rows="2"></textarea>
        <input type="number" class="ed-offer-input" placeholder="Offered amount ($)" step="0.01" />
        <button class="btn btn-compact btn-primary add-ed-btn" data-property="${p.id}">File</button></div></details>`;
    }
    html += '</div>';
    container.insertAdjacentHTML('beforeend', html);
    container.querySelectorAll('.advance-ed-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/eminent-domain/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ advance: true })
        });
        if (r.ok) { showToast('Stage advanced', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });
    container.querySelector('.add-ed-btn')?.addEventListener('click', async () => {
      const r = await fetch(`/api/modules/properties/${p.id}/eminent-domain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ reason: container.querySelector('.ed-reason-input')?.value, offered_amount: container.querySelector('.ed-offer-input')?.value })
      });
      if (r.ok) { showToast('ED case filed', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Auctions
  if (isModuleEnabled('auctions') && moduleData.auctions) {
    const items = Array.isArray(moduleData.auctions) ? moduleData.auctions : [];
    const active = items.filter((a) => a.status === 'Active' || a.status === 'Open');
    let html = `<div class="module-section"><h4 class="module-section__title">Auctions ${active.length ? `<span class="badge badge--warning">${active.length} active</span>` : ''}</h4>`;
    if (items.length > 0) {
      html += '<div class="module-list">';
      items.forEach((a) => {
        const cls = a.status === 'Active' || a.status === 'Open' ? 'badge--warning' : a.status === 'Sold' ? 'badge--success' : a.status === 'Cancelled' ? 'badge--danger' : 'badge--info';
        const endDate = a.end_date ? new Date(a.end_date).toLocaleDateString() : '—';
        html += `<div class="module-list-item"><span>Starting: <strong>$${Number(a.starting_bid || 0).toLocaleString()}</strong> ${a.current_bid ? '| Current: $' + Number(a.current_bid).toLocaleString() : ''}</span>
          <span class="text-muted">Ends: ${endDate} | Bids: ${a.bid_count || 0}</span>
          <span class="badge ${cls}">${a.status}</span>
          ${isStaff() && (a.status === 'Active' || a.status === 'Open') ? `<button class="btn btn-compact cancel-auction-btn" data-id="${a._id}">Cancel</button>` : ''}
        </div>`;
      });
      html += '</div>';
    } else { html += '<p class="module-empty">No auctions</p>'; }
    if (isStaff()) {
      html += `<details class="module-add-form"><summary class="btn btn-compact">Create Auction</summary><div class="module-form-body">
        <input type="number" class="auc-start-input" placeholder="Starting bid ($)" step="0.01" />
        <input type="datetime-local" class="auc-end-input" />
        <textarea class="auc-desc-input" placeholder="Description (optional)" rows="2"></textarea>
        <button class="btn btn-compact btn-primary add-auc-btn" data-property="${p.id}">Create</button></div></details>`;
    }
    html += '</div>';
    container.insertAdjacentHTML('beforeend', html);
    container.querySelectorAll('.cancel-auction-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const r = await fetch(`/api/modules/auctions/${btn.dataset.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ status: 'Cancelled' })
        });
        if (r.ok) { showToast('Auction cancelled', 'success'); renderPanel(p); } else showToast('Failed', 'error');
      });
    });
    container.querySelector('.add-auc-btn')?.addEventListener('click', async () => {
      const r = await fetch(`/api/modules/properties/${p.id}/auctions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
        body: JSON.stringify({ starting_bid: container.querySelector('.auc-start-input')?.value, end_date: container.querySelector('.auc-end-input')?.value, description: container.querySelector('.auc-desc-input')?.value })
      });
      if (r.ok) { showToast('Auction created', 'success'); renderPanel(p); } else showToast('Failed', 'error');
    });
  }

  // Split & Merge
  if (isModuleEnabled('split_merge') && isStaff() && user?.role === 'admin') {
    let html = `<div class="module-section"><h4 class="module-section__title">Parcel Split & Merge</h4>`;
    html += `<div class="module-form-body">
      <details class="module-add-form" style="margin-bottom:8px"><summary class="btn btn-compact">Split This Parcel</summary>
        <div class="module-form-body" style="margin-top:8px">
          <input type="text" class="split-name-a" placeholder="Name for parcel A" />
          <input type="text" class="split-name-b" placeholder="Name for parcel B" />
          <input type="text" class="split-desc" placeholder="Dividing line description (optional)" />
          <button class="btn btn-compact btn-primary split-parcel-btn" data-property="${p.id}">Split</button>
        </div>
      </details>
      <details class="module-add-form"><summary class="btn btn-compact">Merge With Another</summary>
        <div class="module-form-body" style="margin-top:8px">
          <input type="text" class="merge-id-input" placeholder="Other property ID to merge with" />
          <input type="text" class="merge-name-input" placeholder="Name for merged parcel" />
          <button class="btn btn-compact btn-primary merge-parcel-btn" data-property="${p.id}">Merge</button>
        </div>
      </details>
    </div></div>`;
    container.insertAdjacentHTML('beforeend', html);

    container.querySelector('.split-parcel-btn')?.addEventListener('click', async () => {
      const nameA = container.querySelector('.split-name-a')?.value;
      const nameB = container.querySelector('.split-name-b')?.value;
      const desc = container.querySelector('.split-desc')?.value;
      if (!nameA || !nameB) { showToast('Enter names for both parcels', 'error'); return; }
      try {
        const r = await fetch(`/api/modules/properties/${p.id}/split`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ name_a: nameA, name_b: nameB, dividing_line: desc || '' })
        });
        if (r.ok) { showToast('Parcel split successfully', 'success'); loadProperties(); } else { const e = await r.json(); showToast(e.error || 'Split failed', 'error'); }
      } catch { showToast('Split failed', 'error'); }
    });

    container.querySelector('.merge-parcel-btn')?.addEventListener('click', async () => {
      const otherId = container.querySelector('.merge-id-input')?.value;
      const name = container.querySelector('.merge-name-input')?.value;
      if (!otherId) { showToast('Enter the other property ID', 'error'); return; }
      try {
        const r = await fetch('/api/modules/properties/merge', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
          body: JSON.stringify({ property_ids: [p.id, otherId], merged_name: name || '' })
        });
        if (r.ok) { showToast('Parcels merged successfully', 'success'); loadProperties(); } else { const e = await r.json(); showToast(e.error || 'Merge failed', 'error'); }
      } catch { showToast('Merge failed', 'error'); }
    });
  }
}

/* ── Modal Handling: Escape & Click-Outside ────────── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (propertyModal && !propertyModal.classList.contains('hidden')) {
      propertyModal.classList.add('hidden');
      resetFormForNew();
      return;
    }
    if (requestModal && !requestModal.classList.contains('hidden')) {
      requestModal.classList.add('hidden');
      return;
    }
    if (panel && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
    }
  }
});

propertyModal?.addEventListener('click', (e) => {
  if (e.target === propertyModal) {
    propertyModal.classList.add('hidden');
    resetFormForNew();
  }
});

requestModal?.addEventListener('click', (e) => {
  if (e.target === requestModal) {
    requestModal.classList.add('hidden');
  }
});

/* ── Map Module Layers ─────────────────────────────── */
let heatLayer = null;
let annotationLayer = null;
let districtLayer = null;

async function loadHeatmapLayer(layerType = 'value') {
  if (!isModuleEnabled('heatmaps') || typeof L.heatLayer !== 'function') return;
  try {
    const r = await fetch(`/api/modules/heatmap/data?layer=${layerType}`, { credentials: 'same-origin' });
    if (!r.ok) return;
    const points = await r.json();
    if (heatLayer) map.removeLayer(heatLayer);
    if (points.length === 0) return;
    const maxIntensity = Math.max(...points.map((p) => p[2]));
    heatLayer = L.heatLayer(points, {
      radius: 25, blur: 15, maxZoom: 3, max: maxIntensity || 1,
      gradient: { 0.2: '#2f80ed', 0.5: '#27ae60', 0.8: '#f2994a', 1.0: '#e74c3c' }
    }).addTo(map);
  } catch { /* heatmap optional */ }
}

async function loadAnnotations() {
  if (!isModuleEnabled('annotations')) return;
  try {
    const r = await fetch('/api/modules/annotations', { credentials: 'same-origin' });
    if (!r.ok) return;
    const annotations = await r.json();
    if (annotationLayer) map.removeLayer(annotationLayer);
    annotationLayer = L.layerGroup();
    for (const a of annotations) {
      if (!a.position?.lat || !a.position?.lng) continue;
      const marker = L.circleMarker([a.position.lat, a.position.lng], {
        radius: 6, fillColor: '#d4af37', fillOpacity: 0.8, color: '#fff', weight: 1
      });
      marker.bindPopup(`<strong>${escapeHtml(a.title)}</strong><br>${escapeHtml(a.description)}<br><em>${escapeHtml(a.category)}</em>`);
      annotationLayer.addLayer(marker);
    }
    annotationLayer.addTo(map);
  } catch { /* annotations optional */ }
}

async function loadDistricts() {
  if (!isModuleEnabled('districts')) return;
  try {
    const r = await fetch('/api/modules/districts', { credentials: 'same-origin' });
    if (!r.ok) return;
    const districts = await r.json();
    if (districtLayer) map.removeLayer(districtLayer);
    districtLayer = L.layerGroup();
    for (const d of districts) {
      if (!d.geojson) continue;
      const layer = L.geoJSON({ type: 'Feature', geometry: d.geojson }, {
        style: { color: d.color || '#3498db', weight: 2, fillOpacity: 0.08, dashArray: '8 4' }
      });
      layer.bindPopup(`<strong>${escapeHtml(d.name)}</strong><br>${escapeHtml(d.description)}`);
      districtLayer.addLayer(layer);
    }
    districtLayer.addTo(map);
  } catch { /* districts optional */ }
}

// Load map modules on startup
if (isModuleEnabled('annotations')) void loadAnnotations();
if (isModuleEnabled('districts')) void loadDistricts();

/* ── Advanced Filter System ────────────────────────── */
const filterBar = document.getElementById('filterBar');
const filterToggleBtn = document.getElementById('filterToggle');
const filterStatus = document.getElementById('filterStatus');
const filterZone = document.getElementById('filterZone');
const filterMinValue = document.getElementById('filterMinValue');
const filterMaxValue = document.getElementById('filterMaxValue');
const clearFiltersBtn = document.getElementById('clearFilters');

var allProperties = [];
var filteredProperties = [];

if (filterZone && taxPresets.length) {
  taxPresets.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.name || '';
    opt.textContent = p.name || '';
    filterZone.appendChild(opt);
  });
}

filterToggleBtn?.addEventListener('click', () => {
  filterBar?.classList.toggle('hidden');
  filterToggleBtn.classList.toggle('btn-active');
});

function getActiveFilters() {
  const types = [];
  document.querySelectorAll('.filter-type:checked').forEach((cb) => types.push(cb.value));
  return {
    types,
    status: filterStatus?.value || '',
    zone: filterZone?.value || '',
    minValue: filterMinValue?.value ? Number(filterMinValue.value) : null,
    maxValue: filterMaxValue?.value ? Number(filterMaxValue.value) : null
  };
}

function applyFilters(props) {
  const f = getActiveFilters();
  return props.filter((p) => {
    if (f.types.length && !f.types.includes(p.type)) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.zone && p.tax_zone !== f.zone) return false;
    const val = Number(p.assessed_value) || 0;
    if (f.minValue != null && val < f.minValue) return false;
    if (f.maxValue != null && val > f.maxValue) return false;
    return true;
  });
}

function renderMapFromProperties(props) {
  featureGroup.clearLayers();
  props.forEach((p) => {
    if (!p || !p.geojson) return;
    const layer = L.geoJSON({ type: 'Feature', geometry: p.geojson }, { style: styleForProperty(p) }).addTo(featureGroup);
    layer.on('click', () => renderPanel(p));
  });
  if (isModuleEnabled('map_labels') || localStorage.getItem('sapa_map_labels') === 'true') {
    renderMapLabels(props);
  }
}

function reapplyFilters() {
  filteredProperties = applyFilters(allProperties);
  renderMapFromProperties(filteredProperties);
  if (!document.getElementById('tableView')?.classList.contains('hidden')) {
    renderTable(filteredProperties);
  }
}

document.querySelectorAll('.filter-type').forEach((cb) => cb.addEventListener('change', reapplyFilters));
filterStatus?.addEventListener('change', reapplyFilters);
filterZone?.addEventListener('change', reapplyFilters);
filterMinValue?.addEventListener('input', debounce(reapplyFilters, 400));
filterMaxValue?.addEventListener('input', debounce(reapplyFilters, 400));

clearFiltersBtn?.addEventListener('click', () => {
  document.querySelectorAll('.filter-type').forEach((cb) => { cb.checked = true; });
  if (filterStatus) filterStatus.value = '';
  if (filterZone) filterZone.value = '';
  if (filterMinValue) filterMinValue.value = '';
  if (filterMaxValue) filterMaxValue.value = '';
  reapplyFilters();
});

const origLoadProperties = loadProperties;
loadProperties = async function (search = '') {
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
  allProperties = props;
  filteredProperties = applyFilters(props);
  renderMapFromProperties(filteredProperties);
  if (!document.getElementById('tableView')?.classList.contains('hidden')) {
    renderTable(filteredProperties);
  }
};

/* ── Map Labels ────────────────────────────────────── */
let labelLayer = null;

function renderMapLabels(props) {
  if (labelLayer) map.removeLayer(labelLayer);
  labelLayer = L.layerGroup();
  props.forEach((p) => {
    if (!p.geojson) return;
    try {
      const gj = L.geoJSON({ type: 'Feature', geometry: p.geojson });
      const center = gj.getBounds().getCenter();
      const text = p.name || p.parcel_id || '';
      if (!text) return;
      const display = text.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      const label = L.divIcon({
        className: 'map-label',
        html: `<span class="map-label-text">${escapeHtml(display)}</span>`,
        iconSize: [1, 1],
        iconAnchor: [0, 0]
      });
      L.marker(center, { icon: label, interactive: false, pane: 'tooltipPane' }).addTo(labelLayer);
    } catch { /* skip invalid geojson */ }
  });
  labelLayer.addTo(map);
}

/* ── Table View ────────────────────────────────────── */
const tableView = document.getElementById('tableView');
const viewToggleBtn = document.getElementById('viewToggle');
const propertyTableBody = document.getElementById('propertyTableBody');
const tableCount = document.getElementById('tableCount');
const tablePagination = document.getElementById('tablePagination');
const mapStage = document.querySelector('.map-stage');
let tableSort = { key: 'name', dir: 'asc' };
let tablePage = 1;
const TABLE_PAGE_SIZE = 50;

function setTableViewActive(active) {
  const drawToolbar = document.querySelector('.leaflet-draw');
  const zoomControl = document.querySelector('.leaflet-control-zoom');
  if (active) {
    tableView?.classList.remove('hidden');
    viewToggleBtn.textContent = 'Map';
    if (drawToolbar) drawToolbar.style.display = 'none';
    if (zoomControl) zoomControl.style.display = 'none';
    renderTable(filteredProperties);
  } else {
    tableView?.classList.add('hidden');
    viewToggleBtn.textContent = 'Table';
    if (drawToolbar) drawToolbar.style.display = '';
    if (zoomControl) zoomControl.style.display = '';
  }
}

viewToggleBtn?.addEventListener('click', () => {
  const isTableVisible = !tableView?.classList.contains('hidden');
  setTableViewActive(!isTableVisible);
});

document.getElementById('backToMapBtn')?.addEventListener('click', () => {
  setTableViewActive(false);
});

document.querySelectorAll('.property-table th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (tableSort.key === key) {
      tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      tableSort = { key, dir: 'asc' };
    }
    document.querySelectorAll('.property-table th').forEach((h) => {
      h.classList.remove('sorted-asc', 'sorted-desc');
    });
    th.classList.add(tableSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    renderTable(filteredProperties);
  });
});

function sortProperties(props, key, dir) {
  return [...props].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderTable(props) {
  if (!propertyTableBody) return;
  const sorted = sortProperties(props, tableSort.key, tableSort.dir);
  const totalPages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE_SIZE));
  if (tablePage > totalPages) tablePage = totalPages;
  const start = (tablePage - 1) * TABLE_PAGE_SIZE;
  const pageItems = sorted.slice(start, start + TABLE_PAGE_SIZE);

  if (tableCount) tableCount.textContent = `${sorted.length} properties`;

  let html = '';
  pageItems.forEach((p) => {
    const statusClass = p.status === 'For Sale' ? 'badge--warning' : p.status === 'Foreclosed' ? 'badge--danger' : p.status === 'Requires Survey' ? 'badge--info' : 'badge--success';
    html += `<tr data-pid="${p.id || p._id}">
      <td>${escapeHtml(p.parcel_id || '')}</td>
      <td>${escapeHtml(p.name || '')}</td>
      <td>${escapeHtml(p.address || '')}</td>
      <td>${escapeHtml(p.type || '')}</td>
      <td>${escapeHtml(p.owner_name || '')}</td>
      <td>$${(Number(p.assessed_value) || 0).toLocaleString()}</td>
      <td>$${(Number(p.annual_tax) || 0).toLocaleString()}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(p.status || '')}</span></td>
    </tr>`;
  });
  propertyTableBody.innerHTML = html;

  propertyTableBody.querySelectorAll('tr').forEach((row) => {
    row.addEventListener('click', () => {
      const pid = row.dataset.pid;
      const prop = allProperties.find((p) => (p.id || p._id) === pid);
      if (prop) renderPanel(prop);
    });
  });

  if (tablePagination) {
    let phtml = '';
    phtml += `<button ${tablePage <= 1 ? 'disabled' : ''} data-page="${tablePage - 1}">&lt;</button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (totalPages > 7 && Math.abs(i - tablePage) > 2 && i !== 1 && i !== totalPages) {
        if (i === 2 || i === totalPages - 1) phtml += '<span>…</span>';
        continue;
      }
      phtml += `<button data-page="${i}" class="${i === tablePage ? 'active' : ''}">${i}</button>`;
    }
    phtml += `<button ${tablePage >= totalPages ? 'disabled' : ''} data-page="${tablePage + 1}">&gt;</button>`;
    tablePagination.innerHTML = phtml;
    tablePagination.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tablePage = Number(btn.dataset.page);
        renderTable(filteredProperties);
      });
    });
  }
}

/* ── CSV Export ─────────────────────────────────────── */
document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
  const headers = ['Parcel ID', 'Name', 'Address', 'Type', 'Owner', 'Assessed Value', 'Annual Tax', 'Status', 'Zone'];
  const rows = filteredProperties.map((p) => [
    p.parcel_id || '', p.name || '', p.address || '', p.type || '',
    p.owner_name || '', p.assessed_value || 0, p.annual_tax || 0, p.status || '', p.tax_zone || ''
  ]);
  let csv = headers.join(',') + '\n';
  rows.forEach((r) => {
    csv += r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sapa-properties-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported', 'success');
});

/* ── Keyboard Shortcuts ────────────────────────────── */
const shortcutsOverlay = document.getElementById('shortcutsOverlay');

document.getElementById('shortcutsHelp')?.addEventListener('click', () => {
  shortcutsOverlay?.classList.toggle('hidden');
});

document.getElementById('closeShortcuts')?.addEventListener('click', () => {
  shortcutsOverlay?.classList.add('hidden');
});

shortcutsOverlay?.addEventListener('click', (e) => {
  if (e.target === shortcutsOverlay) shortcutsOverlay.classList.add('hidden');
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select, [contenteditable]')) return;

  switch (e.key.toLowerCase()) {
    case '/':
    case 's':
      e.preventDefault();
      searchInput?.focus();
      break;
    case 'n':
      if (isStaff() && propertyModal) {
        e.preventDefault();
        propertyModal.classList.remove('hidden');
      }
      break;
    case 'f':
      e.preventDefault();
      filterBar?.classList.toggle('hidden');
      filterToggleBtn?.classList.toggle('btn-active');
      break;
    case 't':
      e.preventDefault();
      viewToggleBtn?.click();
      break;
    case 'l':
      e.preventDefault();
      legend?.classList.toggle('hidden');
      break;
    case '?':
      e.preventDefault();
      shortcutsOverlay?.classList.toggle('hidden');
      break;
  }
});

/* ── Preference Persistence ────────────────────────── */
(function loadPreferences() {
  if (localStorage.getItem('sapa_filters_open') === 'true') {
    filterBar?.classList.remove('hidden');
    filterToggleBtn?.classList.add('btn-active');
  }
  const savedSort = localStorage.getItem('sapa_table_sort');
  if (savedSort) {
    try { tableSort = JSON.parse(savedSort); } catch { /* ignore */ }
  }
})();

window.addEventListener('beforeunload', () => {
  localStorage.setItem('sapa_filters_open', filterBar && !filterBar.classList.contains('hidden') ? 'true' : 'false');
  localStorage.setItem('sapa_table_sort', JSON.stringify(tableSort));
});

/* ── Bookmarks / Saved Views ───────────────────────── */
const bookmarkBtn = document.getElementById('bookmarkBtn');
const bookmarkOverlay = document.getElementById('bookmarkOverlay');
const bookmarkList = document.getElementById('bookmarkList');

if (isModuleEnabled('bookmarks')) {
  if (bookmarkBtn) bookmarkBtn.style.display = '';
}

bookmarkBtn?.addEventListener('click', async () => {
  bookmarkOverlay?.classList.remove('hidden');
  try {
    const r = await fetch('/api/modules/bookmarks', { credentials: 'same-origin' });
    if (!r.ok) throw new Error();
    const views = await r.json();
    if (!views.length) {
      bookmarkList.innerHTML = '<p class="module-empty">No saved views</p>';
    } else {
      bookmarkList.innerHTML = views.map((v) =>
        `<div class="module-list-item" style="cursor:pointer" data-lat="${v.center_lat}" data-lng="${v.center_lng}" data-zoom="${v.zoom}">
          <span><strong>${escapeHtml(v.name)}</strong></span>
          <span class="text-muted">Zoom: ${v.zoom}</span>
          <button class="btn btn-compact btn-danger delete-bookmark-btn" data-id="${v._id}" title="Delete">&times;</button>
        </div>`
      ).join('');
      bookmarkList.querySelectorAll('.module-list-item').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.delete-bookmark-btn')) return;
          map.setView([Number(el.dataset.lat), Number(el.dataset.lng)], Number(el.dataset.zoom));
          bookmarkOverlay?.classList.add('hidden');
        });
      });
      bookmarkList.querySelectorAll('.delete-bookmark-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const r = await fetch(`/api/modules/bookmarks/${btn.dataset.id}`, {
            method: 'DELETE', headers: { 'CSRF-Token': csrfToken }, credentials: 'same-origin'
          });
          if (r.ok) { btn.closest('.module-list-item')?.remove(); showToast('View deleted', 'success'); }
        });
      });
    }
  } catch { bookmarkList.innerHTML = '<p class="module-empty">Failed to load</p>'; }
});

document.getElementById('saveBookmarkBtn')?.addEventListener('click', async () => {
  const name = document.getElementById('bookmarkNameInput')?.value;
  if (!name) { showToast('Enter a name', 'error'); return; }
  const center = map.getCenter();
  const zoom = map.getZoom();
  const r = await fetch('/api/modules/bookmarks', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken }, credentials: 'same-origin',
    body: JSON.stringify({ name, center_lat: center.lat, center_lng: center.lng, zoom })
  });
  if (r.ok) { showToast('View saved', 'success'); document.getElementById('bookmarkNameInput').value = ''; bookmarkBtn?.click(); }
  else showToast('Failed', 'error');
});

document.getElementById('closeBookmark')?.addEventListener('click', () => bookmarkOverlay?.classList.add('hidden'));
bookmarkOverlay?.addEventListener('click', (e) => { if (e.target === bookmarkOverlay) bookmarkOverlay.classList.add('hidden'); });

/* ── Leaderboard ───────────────────────────────────── */
const leaderboardBtn = document.getElementById('leaderboardBtn');
const leaderboardOverlay = document.getElementById('leaderboardOverlay');
const leaderboardContent = document.getElementById('leaderboardContent');

if (isModuleEnabled('leaderboard') && isStaff()) {
  if (leaderboardBtn) leaderboardBtn.style.display = '';
}

leaderboardBtn?.addEventListener('click', async () => {
  leaderboardOverlay?.classList.remove('hidden');
  try {
    const r = await fetch('/api/modules/leaderboard/all-time', { credentials: 'same-origin' });
    if (!r.ok) throw new Error();
    const data = await r.json();
    if (!data.length) {
      leaderboardContent.innerHTML = '<p class="module-empty">No data yet</p>';
    } else {
      let html = '<div class="module-list">';
      data.forEach((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        html += `<div class="module-list-item">
          <span><strong>${medal} ${escapeHtml(s.username || s.user_id || 'Unknown')}</strong></span>
          <span class="text-muted">Properties: ${s.properties_surveyed || 0} | Edits: ${s.edits || 0} | Sales: ${s.sales_recorded || 0}</span>
        </div>`;
      });
      html += '</div>';
      leaderboardContent.innerHTML = html;
    }
  } catch { leaderboardContent.innerHTML = '<p class="module-empty">Failed to load</p>'; }
});

document.getElementById('closeLeaderboard')?.addEventListener('click', () => leaderboardOverlay?.classList.add('hidden'));
leaderboardOverlay?.addEventListener('click', (e) => { if (e.target === leaderboardOverlay) leaderboardOverlay.classList.add('hidden'); });

/* ── Gazette ───────────────────────────────────────── */
const gazetteBtn = document.getElementById('gazetteBtn');
const gazetteOverlay = document.getElementById('gazetteOverlay');
const gazetteContent = document.getElementById('gazetteContent');

if (isModuleEnabled('gazette')) {
  if (gazetteBtn) gazetteBtn.style.display = '';
}

gazetteBtn?.addEventListener('click', async () => {
  gazetteOverlay?.classList.remove('hidden');
  try {
    const r = await fetch('/api/modules/gazette', { credentials: 'same-origin' });
    if (!r.ok) throw new Error();
    const data = await r.json();
    let html = '<div style="font-size:13px;color:var(--text-muted)">';
    html += `<p><strong>Generated:</strong> ${data.generated_at ? new Date(data.generated_at).toLocaleDateString() : 'Now'}</p>`;
    if (data.summary) {
      html += `<div style="margin:12px 0"><strong>Summary</strong><p>${escapeHtml(data.summary)}</p></div>`;
    }
    if (data.recent_sales?.length) {
      html += '<div style="margin:12px 0"><strong>Recent Sales</strong><div class="module-list">';
      data.recent_sales.forEach((s) => {
        html += `<div class="module-list-item"><span>${escapeHtml(s.property_name || s.parcel_id || '?')} — $${Number(s.sale_price || 0).toLocaleString()}</span></div>`;
      });
      html += '</div></div>';
    }
    if (data.new_properties?.length) {
      html += '<div style="margin:12px 0"><strong>New Properties</strong><div class="module-list">';
      data.new_properties.forEach((p) => {
        html += `<div class="module-list-item"><span>${escapeHtml(p.name || p.parcel_id || '?')} — ${escapeHtml(p.type || '')}</span></div>`;
      });
      html += '</div></div>';
    }
    if (data.stats) {
      html += `<div style="margin:12px 0"><strong>Stats</strong><p>Total properties: ${data.stats.total || 0} | For sale: ${data.stats.for_sale || 0} | Avg value: $${Number(data.stats.avg_value || 0).toLocaleString()}</p></div>`;
    }
    html += '</div>';
    gazetteContent.innerHTML = html;
  } catch { gazetteContent.innerHTML = '<p class="module-empty">Failed to load gazette</p>'; }
});

document.getElementById('closeGazette')?.addEventListener('click', () => gazetteOverlay?.classList.add('hidden'));
gazetteOverlay?.addEventListener('click', (e) => { if (e.target === gazetteOverlay) gazetteOverlay.classList.add('hidden'); });

/* ── Seasonal Events Banner ────────────────────────── */
const seasonalBanner = document.getElementById('seasonalBanner');

if (isModuleEnabled('seasonal_events') && seasonalBanner) {
  (async () => {
    try {
      const r = await fetch('/api/modules/seasonal-events/active', { credentials: 'same-origin' });
      if (!r.ok) return;
      const events = await r.json();
      if (events.length > 0) {
        const ev = events[0];
        seasonalBanner.innerHTML = `<span class="seasonal-banner__text">${escapeHtml(ev.name)} — ${escapeHtml(ev.description || '')} ${ev.discount_percent ? '(' + ev.discount_percent + '% discount!)' : ''}</span>
          <button class="seasonal-banner__close" id="closeSeasonalBanner">&times;</button>`;
        seasonalBanner.classList.remove('hidden');
        document.getElementById('closeSeasonalBanner')?.addEventListener('click', () => seasonalBanner.classList.add('hidden'));
      }
    } catch { /* optional */ }
  })();
}

/* ── Market Analytics ──────────────────────────────── */
const analyticsBtn = document.getElementById('analyticsBtn');
const analyticsOverlay = document.getElementById('analyticsOverlay');
const analyticsContent = document.getElementById('analyticsContent');

if (isModuleEnabled('market_analytics') && isStaff()) {
  if (analyticsBtn) analyticsBtn.style.display = '';
}

analyticsBtn?.addEventListener('click', async () => {
  analyticsOverlay?.classList.remove('hidden');
  analyticsContent.innerHTML = '<p class="module-empty">Loading analytics...</p>';
  try {
    const [summaryRes, cyclesRes] = await Promise.all([
      fetch('/api/modules/analytics/summary', { credentials: 'same-origin' }),
      fetch('/api/modules/analytics/valuation-cycles', { credentials: 'same-origin' })
    ]);
    if (!summaryRes.ok) throw new Error();
    const summary = await summaryRes.json();
    const cycles = cyclesRes.ok ? await cyclesRes.json() : [];

    let html = '<div style="font-size:13px">';

    html += '<div class="analytics-grid">';
    html += `<div class="analytics-card"><div class="analytics-card__label">Total Properties</div><div class="analytics-card__value">${summary.total_properties || 0}</div></div>`;
    html += `<div class="analytics-card"><div class="analytics-card__label">Total Value</div><div class="analytics-card__value">$${Number(summary.total_value || 0).toLocaleString()}</div></div>`;
    html += `<div class="analytics-card"><div class="analytics-card__label">Avg Value</div><div class="analytics-card__value">$${Number(summary.avg_value || 0).toLocaleString()}</div></div>`;
    html += `<div class="analytics-card"><div class="analytics-card__label">For Sale</div><div class="analytics-card__value">${summary.for_sale || 0}</div></div>`;
    html += '</div>';

    if (summary.by_type && Object.keys(summary.by_type).length) {
      html += '<div style="margin:16px 0"><strong>By Type</strong><div class="module-list">';
      for (const [type, data] of Object.entries(summary.by_type)) {
        html += `<div class="module-list-item"><span><strong>${escapeHtml(type)}</strong> — ${data.count || 0} properties</span><span class="text-muted">Total: $${Number(data.total_value || 0).toLocaleString()} | Avg: $${Number(data.avg_value || 0).toLocaleString()}</span></div>`;
      }
      html += '</div></div>';
    }

    if (summary.by_zone && Object.keys(summary.by_zone).length) {
      html += '<div style="margin:16px 0"><strong>By Zone</strong><div class="module-list">';
      for (const [zone, data] of Object.entries(summary.by_zone)) {
        html += `<div class="module-list-item"><span><strong>${escapeHtml(zone)}</strong> — ${data.count || 0} properties</span><span class="text-muted">Total: $${Number(data.total_value || 0).toLocaleString()}</span></div>`;
      }
      html += '</div></div>';
    }

    if (cycles.length) {
      html += '<div style="margin:16px 0"><strong>Valuation Cycles</strong><div class="module-list">';
      cycles.forEach((c) => {
        const cls = c.status === 'Applied' ? 'badge--success' : c.status === 'Draft' ? 'badge--warning' : 'badge--info';
        html += `<div class="module-list-item"><span><strong>${escapeHtml(c.name || 'Untitled')}</strong> — ${c.multiplier || 1}x multiplier</span>
          <span class="text-muted">${c.effective_date ? new Date(c.effective_date).toLocaleDateString() : '—'} | ${c.properties_affected || 0} affected</span>
          <span class="badge ${cls}">${c.status}</span></div>`;
      });
      html += '</div></div>';
    }

    html += '</div>';
    analyticsContent.innerHTML = html;
  } catch { analyticsContent.innerHTML = '<p class="module-empty">Failed to load analytics</p>'; }
});

document.getElementById('closeAnalytics')?.addEventListener('click', () => analyticsOverlay?.classList.add('hidden'));
analyticsOverlay?.addEventListener('click', (e) => { if (e.target === analyticsOverlay) analyticsOverlay.classList.add('hidden'); });

/* ── Historical Timeline ───────────────────────────── */
const timelineBtn = document.getElementById('timelineBtn');
const timelineControl = document.getElementById('timelineControl');
const timelineSlider = document.getElementById('timelineSlider');
const timelineDateLabel = document.getElementById('timelineDate');
let timelineEvents = [];

if (isModuleEnabled('timeline')) {
  if (timelineBtn) timelineBtn.style.display = '';
}

timelineBtn?.addEventListener('click', async () => {
  timelineControl?.classList.toggle('hidden');
  if (!timelineControl?.classList.contains('hidden') && timelineEvents.length === 0) {
    try {
      const r = await fetch('/api/modules/timeline/events', { credentials: 'same-origin' });
      if (r.ok) {
        timelineEvents = await r.json();
        if (timelineEvents.length > 0) {
          timelineSlider.min = 0;
          timelineSlider.max = timelineEvents.length - 1;
          timelineSlider.value = timelineEvents.length - 1;
          updateTimelineDisplay(timelineEvents.length - 1);
        }
      }
    } catch { /* ignore */ }
  }
});

function updateTimelineDisplay(idx) {
  if (!timelineEvents.length) return;
  const ev = timelineEvents[idx];
  const d = ev.date || ev.transfer_date;
  timelineDateLabel.textContent = d ? new Date(d).toLocaleDateString() : `Event ${Number(idx) + 1}`;

  if (typeof allProperties !== 'undefined' && Array.isArray(allProperties)) {
    const cutoff = new Date(d || Date.now());
    const visible = allProperties.filter((p) => new Date(p.created_at || 0) <= cutoff);
    if (typeof renderMarkers === 'function') renderMarkers(visible);
    else if (typeof loadProperties === 'function') {
      filteredProperties = visible;
      renderMapLabels?.();
    }
  }
}

timelineSlider?.addEventListener('input', (e) => updateTimelineDisplay(Number(e.target.value)));
document.getElementById('timelineClose')?.addEventListener('click', () => {
  timelineControl?.classList.add('hidden');
  if (typeof loadProperties === 'function') loadProperties();
});

/* ── Proximity Search ──────────────────────────────── */
const proximityBtn = document.getElementById('proximityBtn');
const proximityOverlay = document.getElementById('proximityOverlay');
const proximityResults = document.getElementById('proximityResults');
let proximityCircle = null;

if (isModuleEnabled('proximity')) {
  if (proximityBtn) proximityBtn.style.display = '';
}

proximityBtn?.addEventListener('click', () => {
  proximityOverlay?.classList.remove('hidden');
  if (!selectedProperty) {
    proximityResults.innerHTML = '<p class="module-empty">Select a property on the map first</p>';
  }
});

document.getElementById('runProximityBtn')?.addEventListener('click', async () => {
  if (!selectedProperty) {
    showToast('Select a property first', 'error');
    return;
  }
  const radius = document.getElementById('proximityRadius')?.value || 500;
  proximityResults.innerHTML = '<p class="module-empty">Searching...</p>';
  try {
    const r = await fetch(`/api/modules/properties/${selectedProperty.id || selectedProperty._id}/nearby?radius=${radius}`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error();
    const nearby = await r.json();

    if (proximityCircle) { map.removeLayer(proximityCircle); proximityCircle = null; }

    if (selectedProperty.geojson?.coordinates?.[0]) {
      const coords = selectedProperty.geojson.coordinates[0];
      const center = coords.reduce((acc, c) => [acc[0] + c[1] / coords.length, acc[1] + c[0] / coords.length], [0, 0]);
      proximityCircle = L.circle(center, { radius: Number(radius), color: '#f1c40f', fillOpacity: 0.1, weight: 1 }).addTo(map);
    }

    if (!nearby.length) {
      proximityResults.innerHTML = '<p class="module-empty">No properties found within radius</p>';
    } else {
      let html = `<div class="module-list"><p class="text-muted" style="margin-bottom:8px">${nearby.length} properties within ${radius}m</p>`;
      nearby.forEach((p) => {
        html += `<div class="module-list-item proximity-result" data-id="${p._id}" style="cursor:pointer">
          <span><strong>${escapeHtml(p.name || p.parcel_id)}</strong></span>
          <span class="text-muted">${escapeHtml(p.address || '')} | ${Math.round(p.distance || 0)}m away</span>
        </div>`;
      });
      html += '</div>';
      proximityResults.innerHTML = html;
      proximityResults.querySelectorAll('.proximity-result').forEach((el) => {
        el.addEventListener('click', () => {
          const found = allProperties?.find((ap) => (ap.id || ap._id) === el.dataset.id);
          if (found) { renderPanel(found); proximityOverlay?.classList.add('hidden'); }
        });
      });
    }
  } catch { proximityResults.innerHTML = '<p class="module-empty">Search failed</p>'; }
});

document.getElementById('closeProximity')?.addEventListener('click', () => {
  proximityOverlay?.classList.add('hidden');
  if (proximityCircle) { map.removeLayer(proximityCircle); proximityCircle = null; }
});
proximityOverlay?.addEventListener('click', (e) => { if (e.target === proximityOverlay) proximityOverlay.classList.add('hidden'); });

/* ── District Surveying ────────────────────────────── */
const surveyDistrictBtn = document.getElementById('surveyDistrictBtn');
const districtModal = document.getElementById('districtModal');
let pendingDistrictGeoJSON = null;

if (isModuleEnabled('districts') && isStaff() && user?.role === 'admin') {
  if (surveyDistrictBtn) surveyDistrictBtn.style.display = '';
}

surveyDistrictBtn?.addEventListener('click', () => {
  const drawnLayers = [];
  featureGroup.eachLayer((l) => { if (l.editing) drawnLayers.push(l); });

  let lastDrawn = null;
  map.eachLayer((l) => {
    if (l instanceof L.Polygon && !(l instanceof L.Rectangle) && !featureGroup.hasLayer(l) && l.toGeoJSON) lastDrawn = l;
  });

  if (lastDrawn) {
    pendingDistrictGeoJSON = lastDrawn.toGeoJSON().geometry;
    districtModal?.classList.remove('hidden');
  } else {
    showToast('Draw a polygon on the map first using the draw tools, then click District again', 'info');
  }
});

document.getElementById('saveDistrictBtn')?.addEventListener('click', async () => {
  const name = document.getElementById('districtName')?.value?.trim();
  if (!name) { showToast('Enter a district name', 'error'); return; }
  if (!pendingDistrictGeoJSON) { showToast('No polygon drawn', 'error'); return; }
  try {
    const r = await fetch('/api/modules/districts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
      credentials: 'same-origin',
      body: JSON.stringify({
        name,
        description: document.getElementById('districtDesc')?.value || '',
        color: document.getElementById('districtColor')?.value || '#3498db',
        tax_multiplier: Number(document.getElementById('districtTaxMult')?.value) || 1.0,
        geojson: pendingDistrictGeoJSON
      })
    });
    if (r.ok) {
      showToast(`District "${name}" created`, 'success');
      districtModal?.classList.add('hidden');
      pendingDistrictGeoJSON = null;
      document.getElementById('districtName').value = '';
      document.getElementById('districtDesc').value = '';
      loadDistricts();
    } else {
      const err = await r.json().catch(() => ({}));
      showToast(err.error || 'Failed to save district', 'error');
    }
  } catch { showToast('Failed to save district', 'error'); }
});

document.getElementById('closeDistrictModal')?.addEventListener('click', () => {
  districtModal?.classList.add('hidden');
  pendingDistrictGeoJSON = null;
});
districtModal?.addEventListener('click', (e) => { if (e.target === districtModal) districtModal.classList.add('hidden'); });
