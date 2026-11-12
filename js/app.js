import { ACTIVITIES, WEIGHT_LEVELS, scoreSite } from './activities.js';
import { drivingRoute, estimateDrive, formatDrive, geocode, gridForBounds } from './geo.js';
import { fetchWeather, isoDate, selectedDates, siteDays, WEATHER_EMOJI } from './weather.js';

function loadWeights() {
  try { return JSON.parse(localStorage.getItem('wp-weights')) || {}; } catch { return {}; }
}
function saveWeights() {
  try { localStorage.setItem('wp-weights', JSON.stringify(state.weights)); } catch { /* ignorieren */ }
}
const DEMO = new URLSearchParams(location.search).has('demo');
const $ = (id) => document.getElementById(id);

const state = {
  center: { lat: 48.137, lon: 11.575, label: 'München' },
  activity: 'climbing',
  week: 0, friday: false, monday: false,
  min: 50,
  weights: loadWeights(),
  selected: null, // Ort für die Wettervorschau (null = Standort)
  sites: [], centerSite: null, dates: [], step: 0.5,
};

const map = L.map('map').setView([state.center.lat, state.center.lon], 7);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18, attribution: '© OpenStreetMap-Mitwirkende',
}).addTo(map);
const layer = L.layerGroup().addTo(map);
const centerLayer = L.layerGroup().addTo(map);

const colorFor = (s) => `hsl(${Math.round((Math.min(100, s) / 100) * 130)} 75% ${s > 40 && s < 70 ? 48 : 42}%)`;
const status = (msg, err = false) => { $('status').textContent = msg; $('status').className = 'muted' + (err ? ' error' : ''); };
const fmtDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });

// ---------- UI ----------
const SUBDISC = { sport: '🧗 Sportklettern', trad: '🔩 Trad', alpine: '🏔️ Alpinklettern', boulder: '🪨 Bouldern', ferrata: '🪜 Klettersteig' };
const disciplineOn = new Set(Object.keys(SUBDISC));
/** Bewertungsprofil: bei Klettern mit genau einer Unterdisziplin deren eigenes Profil. */
const profile = () => (state.activity === 'climbing' && disciplineOn.size === 1 ? `climbing:${[...disciplineOn][0]}` : state.activity);
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
$('weights-reset').onclick = () => { delete state.weights[profile()]; saveWeights(); buildWeights(); render(); };

function buildWeights() {
  const body = $('weights-body'); body.replaceChildren();
  const mults = state.weights[profile()] || {};
  ACTIVITIES[profile()].factors.forEach((f) => {
    const row = document.createElement('div'); row.className = 'wrow';
    const sel = document.createElement('select');
    WEIGHT_LEVELS.forEach((l) => sel.add(new Option(l.label, l.value, false, l.value === (mults[f.key] ?? 1))));
    sel.onchange = () => {
      (state.weights[profile()] ||= {})[f.key] = +sel.value;
      saveWeights(); render();
    };
    row.innerHTML = `<span>${f.label}</span>`; row.append(sel); body.append(row);
  });
}
$('week').onchange = (e) => { state.week = +e.target.value; load(); };
$('fri').onchange = (e) => { state.friday = e.target.checked; load(); };
$('mon').onchange = (e) => { state.monday = e.target.checked; load(); };
$('min').oninput = (e) => { state.min = +e.target.value; $('min-val').textContent = state.min; render(); };

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
  renderSpots(); // Fahrzeiten in den Spot-Popups hängen vom Standort ab
}

// ---------- Daten laden ----------
const siteCache = new Map(); // "lat,lon|start|end" → Wetterdaten eines Punkts
let loadId = 0;
let popupOpen = false;
let pendingRender = false;
map.on('popupopen', () => { popupOpen = true; });
map.on('popupclose', () => { popupOpen = false; if (pendingRender) { pendingRender = false; render(); } });
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

  const b = map.getBounds();
  const { points, step } = gridForBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
  const key = (p) => `${p.lat},${p.lon}|${dates[0]}|${dates[dates.length - 1]}`;
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
    state.step = step;
    status(`${state.sites.length} Orte im Kartenausschnitt${DEMO ? ' (Demo-Daten)' : ''}.`);
    if (popupOpen) pendingRender = true; else render(); // offenes Popup nicht wegrendern
  } catch (err) { if (id === loadId) status(err.message, true); }
}

function drawCenter() {
  centerLayer.clearLayers();
  const { lat, lon, label } = state.center;
  L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 })
    .bindTooltip(`Standort: ${label}`).addTo(centerLayer);
}

// ---------- Fahrzeit ----------
const driveHtml = (d, to) => {
  const { lat, lon, label } = state.center;
  const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${to.lat},${to.lon}&travelmode=driving`;
  return `<div class="drive">🚗 ${d.estimated ? 'ca. ' : ''}${formatDrive(d)} ab ${label}`
    + `${d.estimated ? ' <span class="muted">(Schätzung)</span>' : ''} · <a href="${gmaps}" target="_blank" rel="noopener">Route</a></div>`;
};

/** Popup mit Fahrzeit: zeigt sofort eine Schätzung und ersetzt sie durch die berechnete Route. */
function bindDrivePopup(marker, to, contentFn, options) {
  const from = { ...state.center };
  marker.bindPopup(() => contentFn(driveHtml(estimateDrive(from, to), to)), options);
  marker.on('popupopen', async (e) => {
    const d = await drivingRoute(from, to);
    if (!d.estimated && e.popup.isOpen()) e.popup.setContent(contentFn(driveHtml(d, to)));
  });
  return marker;
}

// ---------- Darstellung ----------
function render() {
  layer.clearLayers();
  const scored = state.sites.map((s) => {
    const days = siteDays(s, state.dates);
    return { site: s, days, ...scoreSite(profile(), days, state.weights[profile()]) };
  });
  const cell = state.step * 111320 * 0.6;

  scored.filter((x) => x.score >= state.min).forEach((x) => {
    bindDrivePopup(L.circle([x.site.lat, x.site.lon], {
      radius: cell, stroke: false, fillColor: colorFor(x.score), fillOpacity: 0.55,
    }), x.site, (drive) => popup(x, drive), { minWidth: 320 }).on('popupopen', () => setPreview(x, 'ausgewählter Ort')).addTo(layer);
  });

  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 8).filter((x) => x.score >= state.min);
  const ol = $('top'); ol.replaceChildren();
  if (!top.length) ol.innerHTML = '<li class="muted" style="list-style:none">Keine Orte über dem Mindest-Score – Slider senken oder anderen Zeitraum wählen.</li>';
  top.forEach((x, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<b style="color:${colorFor(x.score)}">${x.score}</b> ${Math.round(x.site.elevation)} m · 🚗 ca. ${formatDrive(estimateDrive(state.center, x.site))}`;
    const m = bindDrivePopup(L.marker([x.site.lat, x.site.lon], {
      icon: L.divIcon({ className: '', html: `<div class="rank">${i + 1}</div>`, iconSize: [22, 22] }),
    }), x.site, (drive) => popup(x, drive), { minWidth: 320 }).on('popupopen', () => setPreview(x, 'ausgewählter Ort')).addTo(layer);
    li.onclick = () => { map.setView([x.site.lat, x.site.lon], Math.max(map.getZoom(), 9)); m.openPopup(); };
    ol.append(li);
  });

  // Vorschau: ausgewählter Ort (auch außerhalb des Ausschnitts), sonst das Wetter am Standort
  const pick = state.selected?.site || state.centerSite;
  if (pick) {
    const days = siteDays(pick, state.dates);
    setPreview({ site: pick, days, ...scoreSite(profile(), days, state.weights[profile()]) },
      state.selected ? 'ausgewählter Ort' : 'am Standort', !!state.selected);
  }
}

function setPreview(x, title, keep = true) {
  if (keep) state.selected = x;
  $('preview-title').textContent = `· ${title}`;
  $('preview').innerHTML = x.days.map((d, i) => `<div class="day">
      <span class="sc" style="color:${colorFor(x.dayScores[i])}">${x.dayScores[i]}</span>
      <div class="d">${fmtDay(d.date)}</div>
      <div class="big">${WEATHER_EMOJI(d.code)}</div>
      ${Math.round(d.tMin)}…${Math.round(d.tMax)} °C<br>
      💧 ${d.precip.toFixed(1)} mm${d.snow > 0 ? `<br>❄ ${d.snow.toFixed(0)} cm` : ''}<br>
      💨 ${Math.round(d.gust)} km/h</div>`).join('');
}

function popup(x, drive = '') {
  const a = ACTIVITIES[profile()];
  const rows = x.days.map((d, i) => `<tr>
      <td>${fmtDay(d.date)}</td><td>${WEATHER_EMOJI(d.code)}</td>
      <td>${Math.round(d.tMin)}…${Math.round(d.tMax)}°</td>
      <td>${d.precip.toFixed(1)} mm</td>
      <td>${d.snow > 0 ? d.snow.toFixed(0) + ' cm ❄' : '–'}</td>
      <td>${Math.round(d.gust)} km/h</td>
      <td><b style="color:${colorFor(x.dayScores[i])}">${x.dayScores[i]}</b></td></tr>`).join('');
  return `<div class="pop"><b>${a.icon} ${a.label}: Score ${x.score}/100</b><br>
    <span class="muted">${Math.round(x.site.elevation)} m ü. M. · ${x.site.lat.toFixed(2)}, ${x.site.lon.toFixed(2)}</span>${drive}
    <table><tr><th>Tag</th><th></th><th>Temp</th><th>Regen</th><th>Schnee</th><th>Böen</th><th>Score</th></tr>${rows}</table></div>`;
}

// ---------- Spots (Klettern / Ski / MTB) ----------
const SPOT_TYPES = {
  climb: { label: 'Klettergebiet', icon: '🧗', color: '#d97706' },
  ski: { label: 'Skigebiet', icon: '⛷️', color: '#0284c7' },
  mtb: { label: 'MTB-Gebiet', icon: '🚵', color: '#16a34a' },
};
const ACTIVITY_SPOT = { climbing: 'climb', skiing: 'ski', mtb: 'mtb' }; // Wandern/Baden haben keine Spots
const DISCIPLINES = { sport: 'Sportklettern', trad: 'Trad / Mobile Sicherung', alpine: 'Alpinklettern', boulder: 'Bouldern', ferrata: 'Klettersteig' };
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let allSpots = [];
const spotLayer = L.markerClusterGroup ? L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45 }).addTo(map) : L.layerGroup().addTo(map);

const placeCache = new Map();
/** Spots ohne Namen: Ortsname per Nominatim-Rückwärtssuche (nur beim Klick, 1 Anfrage je Spot). */
async function placeName(sp) {
  const key = `${sp.lat},${sp.lon}`;
  if (!placeCache.has(key)) {
    placeCache.set(key, fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=de&lat=${sp.lat}&lon=${sp.lon}`)
      .then((r) => r.json())
      .then((j) => { const a = j.address || {}; return a.hamlet || a.village || a.town || a.city || a.municipality || a.county || null; })
      .catch(() => null));
  }
  return placeCache.get(key);
}

function spotPopup(sp, name, drive = '') {
  const T = SPOT_TYPES[sp.t];
  const osm = `https://www.openstreetmap.org/?mlat=${sp.lat}&mlon=${sp.lon}#map=13/${sp.lat}/${sp.lon}`;
  const wiki = sp.w ? ` · <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(sp.w.replaceAll(' ', '_'))}" target="_blank" rel="noopener">Wikipedia</a>` : '';
  const src = sp.note ? sp.note : sp.mp ? `Quelle: <a href="https://www.mountainproject.com/area/${sp.mp}" target="_blank" rel="noopener">Mountain Project</a>${sp.region ? ` · ${esc(sp.region)}` : ''}` : sp.o ? 'Quelle: OpenStreetMap' : 'Quelle: Wikipedia';
  const disc = sp.d?.length ? `<br>Disziplinen: ${sp.d.map((d) => DISCIPLINES[d]).join(', ')}` : '';
  const routes = sp.r ? `<br>Routen: ${sp.r}${sp.g ? ` · ${esc(sp.g)}` : ''}` : '';
  let tours = '';
  if (sp.sub?.length) {
    tours = `<details class="tours"><summary>${sp.sub.length} Sektoren an dieser Stelle</summary><ul>${sp.sub.map((x) =>
      `<li><a href="https://www.mountainproject.com/area/${x.mp}" target="_blank" rel="noopener">${esc(x.n)}</a> <span class="muted">(${x.r})</span></li>`).join('')}</ul></details>`;
  }
  if (!tours && sp.tours?.length) {
    const bySeries = Map.groupBy(sp.tours, (t) => t.s);
    tours = `<details class="tours"><summary>${sp.tours.length} Touren aus Auswahlführern</summary>${[...bySeries].map(([series, list]) =>
      `<div class="series">${esc(series)}</div><ul>${list.map((t) =>
        `<li>${esc(t.n)}${t.p ? ` <span class="muted">(${esc(t.p)})</span>` : ''}${t.g ? ` <span class="grade">${esc(t.g)}</span>` : ''}</li>`).join('')}</ul>`).join('')}</details>`;
  }
  return `<b>${T.icon} <span class="spot-name">${esc(name)}</span></b><br><span class="muted">${T.label} · ${src}</span>${disc}${routes}${drive}${tours}`
    + `<a href="${osm}" target="_blank" rel="noopener">OpenStreetMap</a>${wiki}`;
}

/** Geschätzte Gebietsgröße (Routen): echte Zahl aus OSM, sonst Näherung – Wikipedia-/kuratierte Gebiete sind meist bekannt und groß. */
// ohne Routenzahl: kuratierte/Wikipedia-Gebiete mittel (30), Tourenlisten nach Anzahl Touren
const sizeOf = (sp) => sp.r ?? (sp.tours ? sp.tours.length : sp.w || sp.note ? 30 : sp.d?.length ? 15 : 5);

function spotMarker(sp) {
  const T = SPOT_TYPES[sp.t];
  const est = sizeOf(sp);
  const px = est >= 100 ? 34 : est >= 20 ? 28 : 22;
  const fallback = `${T.label} (${sp.lat.toFixed(2)}, ${sp.lon.toFixed(2)})`;
  const m = L.marker([sp.lat, sp.lon], {
    icon: L.divIcon({ className: '', iconSize: [px, px], iconAnchor: [px / 2, px + 4], popupAnchor: [0, -px],
      html: `<div class="pin" style="background:${T.color};width:${px}px;height:${px}px"><span style="line-height:${px - 4}px;font-size:${Math.round(px / 2)}px">${T.icon}</span></div>` }),
    title: sp.n || T.label,
    zIndexOffset: Math.min(est, 1000),
  });
  let name = sp.n || fallback;
  bindDrivePopup(m, sp, (drive) => spotPopup(sp, name, drive), { minWidth: sp.tours ? 300 : 50, maxWidth: 360 });
  if (!sp.n) {
    m.on('popupopen', async (e) => {
      const place = await placeName(sp);
      if (!place) return;
      name = `${T.label} bei ${place}`;
      const el = e.popup.getElement()?.querySelector('.spot-name');
      if (el) el.textContent = name;
    });
  }
  return m;
}

function renderSpots() {
  spotLayer.clearLayers();
  const type = ACTIVITY_SPOT[state.activity];
  $('size-filter').hidden = type !== 'climb';
  if (!$('spots-on').checked || !type) { $('spot-count').textContent = type ? '' : 'Für diese Aktivität gibt es keine Spot-Pins.'; return; }
  const shown = allSpots.filter((sp) => sp.t === type
    && (type !== 'climb' || ((!sp.d?.length || sp.d.some((d) => disciplineOn.has(d))) && sizeOf(sp) >= +$('min-routes').value))); // ohne Disziplin-Angabe: immer zeigen
  spotLayer.addLayers(shown.map(spotMarker));
  $('spot-count').textContent = `${shown.length} ${SPOT_TYPES[type].label}e angezeigt`;
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
