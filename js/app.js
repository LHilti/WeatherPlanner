import { ACTIVITIES, DEFAULT_CRITERIA, WEIGHT_LEVELS, customActivity, scoreSite } from './activities.js';
import { drivingRoute, estimateDrive, formatDrive, geocode, gridForBounds } from './geo.js';
import { LAYERS, SCORE_PALETTES, colorAt, gradientCss, gridIndex, renderHeat, sample } from './heat.js';
import { fetchWeather, isoDate, selectedDates, siteDays, WEATHER_EMOJI } from './weather.js';

// ---------- Einstellungen (im Browser gespeichert) ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorieren */ } },
};
const DEMO = new URLSearchParams(location.search).has('demo');
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const state = {
  center: { lat: 48.137, lon: 11.575, label: 'München' },
  activity: 'climbing',
  week: 0, friday: false, monday: false,
  weights: store.get('wp-weights', {}),
  view: { layer: 'score', palette: 'blueRed', min: 0, opacity: 0.6, ...store.get('wp-view', {}) },
  custom: { on: false, criteria: structuredClone(DEFAULT_CRITERIA), ...store.get('wp-custom', {}) },
  selected: null, // Ort der Wettervorschau: { site, title } (null = Standort)
  sites: [], centerSite: null, dates: [], step: 0.5, lonStep: 0.75,
  scoreIdx: null, // interpoliertes Score-Raster für Ranking der Gebiete
};
const saveView = () => store.set('wp-view', state.view);
const saveCustom = () => store.set('wp-custom', state.custom);

const map = L.map('map').setView([state.center.lat, state.center.lon], 7);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18, attribution: '© OpenStreetMap-Mitwirkende',
}).addTo(map);
const centerLayer = L.layerGroup().addTo(map);
let heatOverlay = null;

const status = (msg, err = false) => { $('status').textContent = msg; $('status').className = 'muted' + (err ? ' error' : ''); };
const fmtDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });

// ---------- Aktivität, Unterdisziplin, Bewertungsprofil ----------
const SUBDISC = { sport: '🧗 Sportklettern', trad: '🔩 Trad', alpine: '🏔️ Alpinklettern', boulder: '🪨 Bouldern', ferrata: '🪜 Klettersteig' };
const disciplineOn = new Set(Object.keys(SUBDISC));
/** Profil-Schlüssel: bei Klettern mit genau einer Unterdisziplin deren eigenes Profil. */
const profile = () => (state.activity === 'climbing' && disciplineOn.size === 1 ? `climbing:${[...disciplineOn][0]}` : state.activity);
/** Aktivität, nach der bewertet wird (eigener Filter ersetzt sie). */
const scorer = () => (state.custom.on ? customActivity(state.custom.criteria) : ACTIVITIES[profile()]);
const mults = () => (state.custom.on ? {} : state.weights[profile()] || {});
const scoreDays = (days) => scoreSite(scorer(), days, mults());
const scorePalette = () => SCORE_PALETTES[state.view.palette] ?? SCORE_PALETTES.blueRed;
const scoreRgb = (s) => colorAt(scorePalette().stops, s / 100);
/** Score als farbiges Kästchen (Textfarbe je nach Helligkeit). */
function badge(s) {
  const [r, g, b] = scoreRgb(s);
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  return `<span class="badge" style="background:rgb(${r},${g},${b});color:${light ? '#111' : '#fff'}">${s}</span>`;
}

for (const [k, a] of Object.entries(ACTIVITIES).filter(([, x]) => !x.parent)) {
  const b = document.createElement('button');
  b.dataset.v = k; b.textContent = `${a.icon} ${a.label}`;
  if (k === state.activity) b.classList.add('on');
  $('activity').append(b);
}
for (const [k, label] of Object.entries(SUBDISC)) {
  const b = document.createElement('button'); b.dataset.v = k; b.textContent = label; b.className = 'on';
  b.onclick = () => {
    if (disciplineOn.has(k) && disciplineOn.size === 1) return; // mindestens eine bleibt aktiv
    disciplineOn.has(k) ? disciplineOn.delete(k) : disciplineOn.add(k);
    b.classList.toggle('on', disciplineOn.has(k));
    profileChanged();
  };
  $('subdisc').append(b);
}
function profileChanged() {
  $('subdisc-box').hidden = state.activity !== 'climbing';
  const p = ACTIVITIES[profile()];
  $('hint').textContent = p.parent ? `Bewertung für ${p.label}: ${p.hint}` : p.hint;
  $('custom-note').hidden = !state.custom.on;
  buildWeights(); render(); renderSpots();
}
function seg(id, onPick) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...$(id).children].forEach((c) => c.classList.toggle('on', c === b));
    onPick(b.dataset.v);
  });
}
seg('activity', (v) => { state.activity = v; profileChanged(); });

// ---------- Reiter ----------
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('tab-plan').hidden = b.dataset.tab !== 'plan';
    $('tab-adv').hidden = b.dataset.tab !== 'adv';
  };
});

// ---------- Reiter „Erweitert“ ----------
for (const [k, l] of Object.entries(LAYERS)) $('layer').add(new Option(l.label, k, false, k === state.view.layer));
for (const [k, p] of Object.entries(SCORE_PALETTES)) $('palette').add(new Option(p.label, k, false, k === state.view.palette));
$('min').value = state.view.min; $('min-val').textContent = state.view.min;
$('opacity').value = Math.round(state.view.opacity * 100); $('opacity-val').textContent = Math.round(state.view.opacity * 100);
$('layer').onchange = (e) => { state.view.layer = e.target.value; saveView(); render(); };
$('palette').onchange = (e) => { state.view.palette = e.target.value; saveView(); render(); };
$('min').oninput = (e) => { state.view.min = +e.target.value; $('min-val').textContent = state.view.min; saveView(); render(); };
$('opacity').oninput = (e) => { state.view.opacity = +e.target.value / 100; $('opacity-val').textContent = e.target.value; saveView(); render(); };
$('custom-on').checked = state.custom.on;
$('custom-on').onchange = (e) => { state.custom.on = e.target.checked; saveCustom(); buildCriteria(); profileChanged(); };

const CRITERIA_UI = [
  { key: 'tmax', label: '🌡️ Höchsttemp.', fields: [['min', 'von', -30, 40], ['max', 'bis', -30, 45]], unit: '°C' },
  { key: 'precip', label: '💧 Niederschlag', fields: [['max', 'max.', 0, 50]], unit: 'mm/Tag' },
  { key: 'sun', label: '☀️ Sonne', fields: [['min', 'min.', 0, 15]], unit: 'h/Tag' },
  { key: 'gust', label: '💨 Böen', fields: [['max', 'max.', 0, 150]], unit: 'km/h' },
  { key: 'snow', label: '❄️ Neuschnee', fields: [['min', 'min.', 0, 100]], unit: 'cm/Tag' },
];
function buildCriteria() {
  const box = $('criteria'); box.replaceChildren();
  for (const c of CRITERIA_UI) {
    const crit = state.custom.criteria[c.key] ??= structuredClone(DEFAULT_CRITERIA[c.key]);
    const row = document.createElement('div'); row.className = 'crow';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = crit.on; cb.disabled = !state.custom.on;
    cb.onchange = () => { crit.on = cb.checked; changed(); };
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = c.label;
    const inputs = document.createElement('span');
    for (const [f, text, min, max] of c.fields) {
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = min; inp.max = max; inp.value = crit[f];
      inp.disabled = !state.custom.on || !crit.on; inp.title = text;
      inp.onchange = () => { crit[f] = +inp.value; changed(); };
      inputs.append(` ${text} `, inp);
    }
    const unit = document.createElement('span'); unit.className = 'muted'; unit.textContent = c.unit;
    row.append(cb, lbl, inputs, unit); box.append(row);
  }
  function changed() { saveCustom(); buildCriteria(); render(); }
}
buildCriteria();

$('weights-reset').onclick = () => { delete state.weights[profile()]; store.set('wp-weights', state.weights); buildWeights(); render(); };
function buildWeights() {
  const body = $('weights-body'); body.replaceChildren();
  if (state.custom.on) { body.innerHTML = '<div class="muted">Nicht aktiv, solange der eigene Wetterfilter eingeschaltet ist.</div>'; return; }
  const m = state.weights[profile()] || {};
  ACTIVITIES[profile()].factors.forEach((f) => {
    const row = document.createElement('div'); row.className = 'wrow';
    const sel = document.createElement('select');
    WEIGHT_LEVELS.forEach((l) => sel.add(new Option(l.label, l.value, false, l.value === (m[f.key] ?? 1))));
    sel.onchange = () => { (state.weights[profile()] ||= {})[f.key] = +sel.value; store.set('wp-weights', state.weights); render(); };
    row.innerHTML = `<span>${f.label}</span>`; row.append(sel); body.append(row);
  });
}

// ---------- Zeitraum, Standort ----------
$('week').onchange = (e) => { state.week = +e.target.value; load(); };
$('fri').onchange = (e) => { state.friday = e.target.checked; load(); };
$('mon').onchange = (e) => { state.monday = e.target.checked; load(); };

$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await geocode($('q').value.trim());
    const ul = $('results'); ul.replaceChildren();
    if (!res.length) { status('Kein Ort gefunden.', true); ul.hidden = true; return; }
    res.forEach((r) => {
      const li = document.createElement('li'); li.textContent = r.label;
      li.onclick = () => { ul.hidden = true; setCenter(r, true); };
      ul.append(li);
    });
    ul.hidden = false;
  } catch (err) { status(err.message, true); }
});
$('locate').onclick = () => {
  if (!navigator.geolocation) return status('Geolocation nicht verfügbar.', true);
  navigator.geolocation.getCurrentPosition(
    (p) => setCenter({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'Mein Standort' }, true),
    () => status('Standort konnte nicht ermittelt werden.', true));
};
map.on('contextmenu', (e) => setCenter({ lat: e.latlng.lat, lon: e.latlng.lng, label: `${e.latlng.lat.toFixed(2)}, ${e.latlng.lng.toFixed(2)}` }, false));

function setCenter(c, zoom) {
  state.center = c;
  state.selected = null;
  state.centerSite = null;
  drawCenter();
  if (zoom) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 7)); // löst über moveend das Nachladen aus
  load();
  renderSpots(); // Fahrzeiten in den Popups hängen vom Standort ab
}
function drawCenter() {
  centerLayer.clearLayers();
  const { lat, lon, label } = state.center;
  L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 })
    .bindTooltip(`Standort: ${label}`).addTo(centerLayer);
}

// ---------- Wetterdaten ----------
const siteCache = new Map(); // "lat,lon|start|end" → Wetterdaten eines Punkts
const range = () => `${state.dates[0]}|${state.dates[state.dates.length - 1]}`;
let loadId = 0;
let moveTimer;
map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(load, 500); });

async function load() {
  const id = ++loadId;
  const { center } = state;
  const dates = selectedDates({ weekOffset: state.week, friday: state.friday, monday: state.monday }).map(isoDate);
  state.dates = dates;
  $('dates').textContent = dates.map(fmtDay).join(' · ');
  $('center-label').textContent = `📍 ${center.label}`;

  const horizon = new Date(); horizon.setDate(horizon.getDate() + 15);
  if (dates[dates.length - 1] > isoDate(horizon)) { status('Der Zeitraum liegt außerhalb der 16-Tage-Vorhersage.', true); return; }

  const b = map.getBounds().pad(0.12); // etwas Rand, damit die Farbfläche den Ausschnitt ganz abdeckt
  const { points, step, lonStep } = gridForBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, 160);
  const key = (p) => `${p.lat},${p.lon}|${range()}`;
  const centerPoint = { lat: +center.lat.toFixed(3), lon: +center.lon.toFixed(3) };
  const missing = [...points, centerPoint].filter((p) => !siteCache.has(key(p)));
  if (missing.length) status(`Lade Wetter für ${missing.length} Orte …`);
  try {
    if (missing.length) {
      const fetched = await fetchWeather(missing, dates, { demo: DEMO });
      fetched.forEach((site, i) => siteCache.set(key(missing[i]), site));
    }
    if (id !== loadId) return; // veraltete Antwort
    state.sites = points.map((p) => siteCache.get(key(p))).filter(Boolean);
    state.centerSite = siteCache.get(key(centerPoint)) || null;
    state.step = step; state.lonStep = lonStep;
    status(`Wetter für ${state.sites.length} Rasterpunkte im Ausschnitt${DEMO ? ' (Demo-Daten)' : ''}.`);
    render();
  } catch (err) { if (id === loadId) status(err.message, true); }
}

/** Wetter genau an einem Ort (Gebiet oder Kartenklick), gecacht. */
async function pointWeather(lat, lon) {
  const p = { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
  const k = `${p.lat},${p.lon}|${range()}`;
  if (!siteCache.has(k)) {
    const [site] = await fetchWeather([p], state.dates, { demo: DEMO });
    siteCache.set(k, site);
  }
  return siteCache.get(k);
}

// ---------- Heatmap + Legende ----------
const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => { const d = L.DomUtil.create('div', 'map-legend'); L.DomEvent.disableClickPropagation(d); return d; };
legend.addTo(map);

function updateLegend(def, stops) {
  const el = legend.getContainer();
  const isScore = state.view.layer === 'score';
  const title = isScore ? `${state.custom.on ? '🎛️ Eigener Filter' : `${scorer().icon} ${scorer().label}`} – Wetter-Score` : def.label;
  const ends = isScore ? ['ungeeignet', 'top'] : [`${def.min} ${def.unit}`, `${def.max} ${def.unit}`];
  const extra = isScore && state.view.palette === 'blueRed' ? '<div class="muted">Blau = nass/ungeeignet · Rot = beste Bedingungen</div>' : '';
  el.innerHTML = `<div class="t">${esc(title)}</div><div class="bar" style="background:${gradientCss(stops)}"></div>`
    + `<div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>${extra}`
    + (isScore && state.view.min > 0 ? `<div class="muted">ausgeblendet: Score unter ${state.view.min}</div>` : '');
}

function render() {
  const def = LAYERS[state.view.layer] ?? LAYERS.score;
  const isScore = state.view.layer === 'score';
  const stops = isScore ? scorePalette().stops : def.stops;
  const perSite = state.sites.map((s) => {
    const days = siteDays(s, state.dates);
    return { site: s, days, ...scoreDays(days) };
  });
  state.scoreIdx = gridIndex(state.sites, perSite.map((x) => x.score), state.step, state.lonStep);
  const values = isScore ? perSite.map((x) => x.score) : perSite.map((x) => def.value(x.days));
  const idx = isScore ? state.scoreIdx : gridIndex(state.sites, values, state.step, state.lonStep);

  const heat = renderHeat(idx, { stops, min: def.min, max: def.max }, isScore ? (v) => v < state.view.min : () => false, 1);
  if (heat) {
    if (!heatOverlay) heatOverlay = L.imageOverlay(heat.url, heat.bounds, { className: 'heat-img', interactive: false }).addTo(map);
    else { heatOverlay.setUrl(heat.url); heatOverlay.setBounds(L.latLngBounds(heat.bounds)); }
    heatOverlay.setOpacity(state.view.opacity);
  }
  updateLegend(def, stops);
  renderTop(perSite);
  renderPreview();
}

// ---------- Beste Gebiete / Orte ----------
function renderTop(perSite) {
  const ol = $('top'); ol.replaceChildren();
  const bounds = map.getBounds();
  const spots = visibleSpots().filter((sp) => bounds.contains([sp.lat, sp.lon]));
  $('top-label').innerHTML = spots.length ? 'Beste Gebiete im Ausschnitt <span class="muted">(Score ≈ Farbfläche)</span>' : 'Beste Orte im Ausschnitt';
  let items;
  if (spots.length && state.scoreIdx) {
    items = spots.map((sp) => ({ sp, score: Math.round(sample(state.scoreIdx, sp.lat, sp.lon) ?? -1) }))
      .filter((x) => x.score >= 0).sort((a, b) => b.score - a.score || sizeOf(b.sp) - sizeOf(a.sp)).slice(0, 10);
    items.forEach(({ sp, score }) => {
      const li = document.createElement('li');
      li.innerHTML = `${badge(score)} ${esc(sp.n || 'Gebiet')} <span class="muted">· 🚗 ca. ${formatDrive(estimateDrive(state.center, sp))}</span>`;
      li.title = 'Score aus der Farbfläche geschätzt – genaues Wetter am Gebiet im Popup';
      li.onclick = () => {
        const m = markerOf.get(sp);
        if (m && spotLayer.zoomToShowLayer) spotLayer.zoomToShowLayer(m, () => m.openPopup());
        else if (m) { map.setView([sp.lat, sp.lon], Math.max(map.getZoom(), 11)); m.openPopup(); }
      };
      ol.append(li);
    });
  } else {
    items = [...perSite].sort((a, b) => b.score - a.score).slice(0, 8);
    items.forEach((x) => {
      const li = document.createElement('li');
      li.innerHTML = `${badge(x.score)} ${Math.round(x.site.elevation)} m · ${x.site.lat.toFixed(2)}, ${x.site.lon.toFixed(2)} <span class="muted">· 🚗 ca. ${formatDrive(estimateDrive(state.center, x.site))}</span>`;
      li.onclick = () => openPointPopup(L.latLng(x.site.lat, x.site.lon));
      ol.append(li);
    });
  }
  if (!items.length) ol.innerHTML = '<li class="muted" style="list-style:none">Noch keine Daten im Ausschnitt.</li>';
}

// ---------- Wetteranzeige ----------
/** Wetterblock (Score + Tagestabelle) für Popups. */
function weatherBlock(site) {
  const days = siteDays(site, state.dates);
  const { score, dayScores } = scoreDays(days);
  const [r, g, b] = scoreRgb(score);
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  const a = scorer();
  const rows = days.map((d, i) => `<tr>
      <td>${fmtDay(d.date)}</td><td>${WEATHER_EMOJI(d.code)}</td>
      <td>${Math.round(d.tMin)}…${Math.round(d.tMax)}°</td>
      <td>${d.precip.toFixed(1)} mm</td>
      <td>${d.snow > 0 ? `${d.snow.toFixed(0)} cm` : '–'}</td>
      <td>${Math.round(d.sun)} h</td>
      <td>${Math.round(d.gust)}</td>
      <td>${badge(dayScores[i])}</td></tr>`).join('');
  return `<div class="wx-head" style="background:rgb(${r},${g},${b});color:${light ? '#111' : '#fff'}">${a.icon} ${esc(a.label)}: ${score}/100</div>
    <div class="muted">Wetter auf ${Math.round(site.elevation)} m (Modellhöhe)</div>
    <table class="wx"><tr><th>Tag</th><th></th><th>Temp</th><th>Nied.</th><th>Schnee</th><th>Sonne</th><th>Böen</th><th>Score</th></tr>${rows}</table>`;
}

/** Popup mit Fahrzeit und Wetter: Schätzung/Ladehinweis sofort, dann Route und Wetter nachladen. */
function bindInfoPopup(layer, to, head, options) {
  let drive = estimateDrive(state.center, to); let wx = '<div class="muted">Lade Wetter …</div>';
  const html = () => `${head()}${driveHtml(drive, to)}${wx}`;
  layer.bindPopup(() => html(), { minWidth: 330, maxWidth: 380, ...options });
  layer.on('popupopen', async (e) => {
    const refresh = () => { if (e.popup.isOpen()) e.popup.setContent(html()); };
    const from = { ...state.center };
    drivingRoute(from, to).then((d) => { drive = d; refresh(); });
    try {
      const site = await pointWeather(to.lat, to.lon);
      wx = weatherBlock(site); refresh();
      state.selected = { site, title: to.n || 'ausgewählter Ort' }; renderPreview();
    } catch (err) { wx = `<div class="error">${esc(err.message)}</div>`; refresh(); }
  });
  return layer;
}
const driveHtml = (d, to) => {
  const { lat, lon, label } = state.center;
  const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${to.lat},${to.lon}&travelmode=driving`;
  return `<div class="drive">🚗 ${d.estimated ? 'ca. ' : ''}${formatDrive(d)} ab ${esc(label)}`
    + `${d.estimated ? ' <span class="muted">(Schätzung)</span>' : ''} · <a href="${gmaps}" target="_blank" rel="noopener">Route</a></div>`;
};

/** Klick irgendwo in die Karte: Wetter an diesem Punkt. */
function openPointPopup(latlng) {
  const to = { lat: latlng.lat, lon: latlng.lng };
  const holder = L.marker(latlng, { opacity: 0, interactive: false }); // unsichtbarer Träger für bindInfoPopup
  bindInfoPopup(holder, to, () => `<b>📍 ${to.lat.toFixed(3)}, ${to.lon.toFixed(3)}</b><br>`);
  holder.addTo(map).openPopup();
  holder.on('popupclose', () => map.removeLayer(holder));
}
map.on('click', (e) => openPointPopup(e.latlng));

function renderPreview() {
  const pick = state.selected?.site || state.centerSite;
  if (!pick) return;
  const days = siteDays(pick, state.dates);
  const { dayScores } = scoreDays(days);
  $('preview-title').textContent = `· ${state.selected ? state.selected.title : 'am Standort'}`;
  $('preview').innerHTML = days.map((d, i) => `<div class="day">
      <span class="sc">${badge(dayScores[i])}</span>
      <div class="d">${fmtDay(d.date)}</div>
      <div class="big">${WEATHER_EMOJI(d.code)}</div>
      ${Math.round(d.tMin)}…${Math.round(d.tMax)} °C<br>
      💧 ${d.precip.toFixed(1)} mm${d.snow > 0 ? `<br>❄ ${d.snow.toFixed(0)} cm` : ''}<br>
      ☀️ ${Math.round(d.sun)} h · 💨 ${Math.round(d.gust)} km/h</div>`).join('');
}

// ---------- Gebiete (Klettern, Eis, Ski, MTB) ----------
const SPOT_TYPES = {
  climb: { label: 'Klettergebiet', plural: 'Klettergebiete', icon: '🧗', color: '#d97706' },
  ice: { label: 'Eisklettergebiet', plural: 'Eisklettergebiete', icon: '🧊', color: '#0891b2' },
  ski: { label: 'Skigebiet', plural: 'Skigebiete', icon: '⛷️', color: '#0284c7' },
  mtb: { label: 'MTB-Gebiet', plural: 'MTB-Gebiete', icon: '🚵', color: '#16a34a' },
};
const ACTIVITY_SPOT = { climbing: 'climb', ice: 'ice', skiing: 'ski', mtb: 'mtb' }; // Wandern/Baden ohne Gebiete
const DISCIPLINES = { sport: 'Sportklettern', trad: 'Trad / Mobile Sicherung', alpine: 'Alpinklettern', boulder: 'Bouldern', ferrata: 'Klettersteig', ice: 'Eis/Mixed' };
let allSpots = [];
const markerOf = new Map();
const spotLayer = L.markerClusterGroup ? L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45 }).addTo(map) : L.layerGroup().addTo(map);

const placeCache = new Map();
/** Gebiete ohne Namen: Ortsname per Nominatim-Rückwärtssuche (nur beim Klick). */
function placeName(sp) {
  const key = `${sp.lat},${sp.lon}`;
  if (!placeCache.has(key)) {
    placeCache.set(key, fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=de&lat=${sp.lat}&lon=${sp.lon}`)
      .then((r) => r.json())
      .then((j) => { const a = j.address || {}; return a.hamlet || a.village || a.town || a.city || a.municipality || a.county || null; })
      .catch(() => null));
  }
  return placeCache.get(key);
}

function spotInfo(sp, T) {
  const osm = `https://www.openstreetmap.org/?mlat=${sp.lat}&mlon=${sp.lon}#map=13/${sp.lat}/${sp.lon}`;
  const wiki = sp.w ? ` · <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(sp.w.replaceAll(' ', '_'))}" target="_blank" rel="noopener">Wikipedia</a>` : '';
  const src = sp.note ? esc(sp.note) : sp.mp ? `Quelle: <a href="https://www.mountainproject.com/area/${sp.mp}" target="_blank" rel="noopener">Mountain Project</a>${sp.region ? ` · ${esc(sp.region)}` : ''}` : sp.o ? 'Quelle: OpenStreetMap' : 'Quelle: Wikipedia';
  const disc = sp.d?.length ? `<br>Disziplinen: ${sp.d.map((d) => DISCIPLINES[d] ?? d).join(', ')}` : '';
  const routes = sp.r ? `<br>Routen: ${sp.r}${sp.g ? ` · ${esc(sp.g)}` : ''}` : '';
  let more = '';
  if (sp.sub?.length) {
    more = `<details class="tours"><summary>${sp.sub.length} Sektoren an dieser Stelle</summary><ul>${sp.sub.map((x) =>
      `<li><a href="https://www.mountainproject.com/area/${x.mp}" target="_blank" rel="noopener">${esc(x.n)}</a> <span class="muted">(${x.r})</span></li>`).join('')}</ul></details>`;
  } else if (sp.tours?.length) {
    const bySeries = Map.groupBy(sp.tours, (t) => t.s);
    more = `<details class="tours"><summary>${sp.tours.length} Touren aus Auswahlführern</summary>${[...bySeries].map(([series, list]) =>
      `<div class="series">${esc(series)}</div><ul>${list.map((t) =>
        `<li>${esc(t.n)}${t.p ? ` <span class="muted">(${esc(t.p)})</span>` : ''}${t.g ? ` <span class="grade">${esc(t.g)}</span>` : ''}</li>`).join('')}</ul>`).join('')}</details>`;
  }
  return `<span class="muted">${T.label} · ${src}</span>${disc}${routes}${more}<div class="links"><a href="${osm}" target="_blank" rel="noopener">OpenStreetMap</a>${wiki}</div>`;
}

/** Geschätzte Gebietsgröße (Routen) für Pin-Größe und Filter. */
const sizeOf = (sp) => sp.r ?? (sp.tours ? sp.tours.length : sp.w || sp.note ? 30 : sp.d?.length ? 15 : 5);

function spotMarker(sp, T) {
  const est = sizeOf(sp);
  const px = est >= 100 ? 34 : est >= 20 ? 28 : 22;
  const m = L.marker([sp.lat, sp.lon], {
    icon: L.divIcon({ className: '', iconSize: [px, px], iconAnchor: [px / 2, px + 4], popupAnchor: [0, -px],
      html: `<div class="pin" style="background:${T.color};width:${px}px;height:${px}px"><span style="line-height:${px - 4}px;font-size:${Math.round(px / 2)}px">${T.icon}</span></div>` }),
    title: sp.n || T.label,
    zIndexOffset: Math.min(est, 1000),
  });
  let name = sp.n || `${T.label} (${sp.lat.toFixed(2)}, ${sp.lon.toFixed(2)})`;
  const to = { lat: sp.lat, lon: sp.lon, n: name };
  bindInfoPopup(m, to, () => `<b>${T.icon} ${esc(name)}</b><br>${spotInfo(sp, T)}`);
  if (!sp.n) {
    m.on('popupopen', async (e) => {
      const place = await placeName(sp);
      if (!place) return;
      name = `${T.label} bei ${place}`; to.n = name;
      const el = e.popup.getElement()?.querySelector('b'); if (el) el.textContent = `${T.icon} ${name}`;
    });
  }
  return m;
}

/** Gebiete, die zur gewählten Aktivität (und ggf. Unterdisziplin/Größe) passen. */
function visibleSpots() {
  const type = ACTIVITY_SPOT[state.activity];
  if (!type || !$('spots-on').checked) return [];
  return allSpots.filter((sp) => {
    if (type === 'ice') return sp.t === 'ice' || sp.d?.includes('ice');
    if (sp.t !== type) return false;
    if (type !== 'climb') return true;
    const d = sp.d?.filter((x) => x !== 'ice') ?? [];
    return (!d.length || d.some((x) => disciplineOn.has(x))) && sizeOf(sp) >= +$('min-routes').value; // ohne Angabe: immer zeigen
  });
}

function renderSpots() {
  spotLayer.clearLayers(); markerOf.clear();
  const type = ACTIVITY_SPOT[state.activity];
  $('size-filter').hidden = type !== 'climb';
  if (!type) { $('spot-count').textContent = 'Für diese Aktivität gibt es keine Gebiets-Pins – Klick in die Karte zeigt das Wetter an jedem Ort.'; renderTop([]); return; }
  const T = SPOT_TYPES[type];
  const shown = visibleSpots();
  spotLayer.addLayers(shown.map((sp) => { const m = spotMarker(sp, T); markerOf.set(sp, m); return m; }));
  $('spot-count').textContent = $('spots-on').checked ? `${shown.length} ${T.plural} angezeigt` : '';
  render();
}
$('spots-on').onchange = renderSpots;
$('min-routes').onchange = renderSpots;

async function loadSpots() {
  // data/spots.json wird von `npm run build:spots` aus allen Quellen zusammengeführt (ohne Dubletten)
  const list = await fetch('data/spots.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  allSpots = list.filter((sp) => SPOT_TYPES[sp.t]);
  renderSpots();
}

profileChanged();
drawCenter();
loadSpots();
load();
