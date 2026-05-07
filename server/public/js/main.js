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

async function loadProperties(search = '') {
  featureGroup.clearLayers();
  const res = await fetch(`/api/properties?search=${encodeURIComponent(search)}`);
  const props = await res.json();
  props.forEach((p) => {
    const layer = L.geoJSON({ type: 'Feature', geometry: p.geojson }, { style: styleForProperty(p) }).addTo(featureGroup);
    layer.on('click', () => renderPanel(p));
  });
}

searchInput?.addEventListener('input', (e) => loadProperties(e.target.value));
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
