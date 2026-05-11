const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
const panel = document.getElementById('propertyPanel');
const legend = document.getElementById('legend');
const searchInput = document.getElementById('searchInput');
const user = window.SAPA_USER;
const defaultTaxRates = window.SAPA_TAX_RATES || {};
const taxPresets = window.SAPA_TAX_PRESETS || [];
const pricePerSqft = Number(window.SAPA_PRICE_PER_SQFT) || 0;

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

function ownersDetailHtml(p) {
  if (p.type === 'Residential' && Array.isArray(p.residential_owners) && p.residential_owners.length > 0) {
    return `<ul class="owner-list">${p.residential_owners
      .map(
        (o) =>
          `<li>${escapeHtml(o.name)} <span class="text-muted">(${escapeHtml(o.owner_type)})</span></li>`
      )
      .join('')}</ul>`;
  }
  let html = `<p class="detail"><strong>Owner</strong> ${escapeHtml(String(p.owner_name))} (${escapeHtml(String(p.owner_type))})</p>`;
  if (p.business_name) {
    html += `<p class="detail"><strong>Business</strong> ${escapeHtml(String(p.business_name))}</p>`;
  }
  return html;
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
    ${Number(p.square_footage || 0) > 0 ? `<p class="detail"><strong>Square footage</strong> ${Number(p.square_footage).toLocaleString()} sqft</p>` : ''}
    <div class="tax-detail-block">
      <p class="detail"><strong>${p.type === 'Commercial' ? 'Commercial Tax' : p.type === 'Residential' ? 'Residential Tax' : 'Property Tax'}</strong> <span class="tax-amount">$${Number(p.annual_tax || 0).toLocaleString()}<span class="tax-rate-badge">${Number(p.tax_rate || 0)}%</span></span></p>
      ${p.tax_zone ? `<p class="detail"><strong>Tax Zone</strong> ${escapeHtml(p.tax_zone)}</p>` : ''}
      ${Number(p.annual_tax) > 0 ? `<p class="detail tax-monthly"><strong>Yearly Tax</strong> $${Number(p.annual_tax).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>` : ''}
    </div>
    <p class="detail"><strong>Status</strong> ${escapeHtml(String(p.status))}</p>
    <p class="detail"><strong>Updated</strong> ${escapeHtml(String(p.updated_at || ''))}</p>
    ${saleBtn}
    ${transferBtn}
    ${txBtn}
    ${editBtn}
    ${deleteBtn}
    <button type="button" class="btn btn-panel btn-close-panel" id="closePanelBtn">Close</button>
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
        alert('Failed to delete property.');
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
      if (!buyer) { alert('Enter the buyer name'); return; }

      const isNonRes = p.type !== 'Residential';
      const buyerType = isNonRes ? (panel.querySelector('#saleBuyerType')?.value || 'Individual') : 'Individual';
      const bizName = isNonRes ? (panel.querySelector('#saleBizNameInput')?.value?.trim() || '') : '';
      const bizId = isNonRes ? (panel.querySelector('#saleBizIdInput')?.value || '') : '';

      if (buyerType === 'Business' && !bizName) { alert('Enter the business name'); return; }

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
        alert('Failed to record sale');
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
      if (!newOwner) { alert('Enter the new owner name'); return; }
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
        alert('Failed to transfer ownership');
      }
    });
  });
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
  featureGroup.clearLayers();
  props.forEach((p) => {
    if (!p || !p.geojson) return;
    const layer = L.geoJSON({ type: 'Feature', geometry: p.geojson }, { style: styleForProperty(p) }).addTo(featureGroup);
    layer.on('click', () => renderPanel(p));
  });
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
    alert('Invalid GeoJSON');
    return;
  }
  if (!geojson) { alert('Draw a property line first'); return; }

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
    if (!res.ok) { alert('Failed to update'); return; }
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
    if (!res.ok) { alert('Failed to save survey marker'); return; }
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
    if (!owners.length) { alert('Add at least one owner'); return; }
    payload.residential_owners = owners;
    payload.owner_name = owners[0].name;
    payload.owner_type = owners[0].owner_type;
  } else {
    payload.business_name = document.getElementById('reqBusinessName')?.value?.trim() || '';
    payload.owner_name = document.getElementById('reqOwnerName')?.value?.trim() || '';
    payload.owner_type = document.getElementById('reqOwnerType')?.value || 'Individual';
    if (!payload.owner_name) { alert('Enter the owner name'); return; }
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
      alert('Your property appraisal request has been submitted!');
      if (isStaff()) void loadWorkOrders();
    } else {
      const j = await r.json().catch(() => ({}));
      alert(j.error || 'Failed to submit request');
    }
  } catch {
    alert('Network error — please try again');
  }
});

syncReqTypeFields();
