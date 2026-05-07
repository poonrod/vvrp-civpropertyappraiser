const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
const mapEl = document.getElementById('map');
const panel = document.getElementById('propertyPanel');
const legend = document.getElementById('legend');
const searchInput = document.getElementById('searchInput');
const user = window.SAPA_USER;

const map = L.map('map', { crs: L.CRS.Simple, minZoom: window.SAPA_CONFIG.min_zoom || -3, maxZoom: window.SAPA_CONFIG.max_zoom || 3 });
const bounds = window.SAPA_CONFIG.bounds || [[0, 0], [1080, 1920]];
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
    ${p.status === 'For Sale' ? `<div class="sale-banner">For Sale - Asking: $${Number(p.purchase_price || 0).toLocaleString()}</div>` : ''}
    <h3>${p.name}</h3>
    <p><b>Parcel:</b> ${p.parcel_id}</p>
    <p><b>Address:</b> ${p.address}</p>
    <p><b>Owner:</b> ${p.owner_name} (${p.owner_type})</p>
    <p><b>Purchase Date:</b> ${p.purchase_date || 'N/A'}</p>
    <p><b>Purchase Price:</b> $${Number(p.purchase_price || 0).toLocaleString()}</p>
    <p><b>Assessed Value:</b> $${Number(p.assessed_value || 0).toLocaleString()}</p>
    <p><b>Annual Tax:</b> $${Number(p.annual_tax || 0).toLocaleString()}</p>
    <p><b>Status:</b> ${p.status}</p>
    <p><b>Last Updated:</b> ${p.updated_at}</p>
    <button id="txBtn">View Transaction History</button>
  `;
  panel.querySelector('#txBtn').addEventListener('click', async () => {
    const r = await fetch(`/api/properties/${p.id}/transactions`);
    const tx = await r.json();
    const timeline = tx.map((t) => `<li>${t.transfer_date}: ${t.from_owner} -> ${t.to_owner} ($${Number(t.sale_price).toLocaleString()})</li>`).join('');
    panel.innerHTML += `<h4>Timeline</h4><ul>${timeline || '<li>No records</li>'}</ul>`;
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
