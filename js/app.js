import { ACTIVITIES, WEIGHT_LEVELS, scoreSite } from './activities.js';
import { buildGrid, geocode } from './geo.js';
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
  radius: 200,
  activity: 'climbing',
  week: 0, friday: false, monday: false,
  min: 50,
  weights: loadWeights(),
  selected: null, // Ort für die Wettervorschau (null = Standort)
  sites: [], dates: [], key: null,
};

const map = L.map('map').setView([state.center.lat, state.center.lon], 7);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18, attribution: '© OpenStreetMap-Mitwirkende',
}).addTo(map);
const layer = L.layerGroup().addTo(map);
const centerLayer = L.layerGroup().addTo(map);

const colorFor = (s) => `hsl(${Math.round((Math.min(100, s) / 100) * 130)} 75% ${s > 40 && s < 70 ? 48 : 42}%)`;
const stepFor = (r) => r / 5;
const status = (msg, err = false) => { $('status').textContent = msg; $('status').className = 'muted' + (err ? ' error' : ''); };
const fmtDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });

// ---------- UI ----------
for (const [k, a] of Object.entries(ACTIVITIES)) {
  const b = document.createElement('button');
  b.dataset.v = k; b.textContent = `${a.icon} ${a.label}`;
  if (k === state.activity) b.classList.add('on');
  $('activity').append(b);
}
$('hint').textContent = ACTIVITIES[state.activity].hint;

function seg(id, onPick) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...$(id).children].forEach((c) => c.classList.toggle('on', c === b));
    onPick(b.dataset.v);
  });
}
$('radius').oninput = (e) => { $('radius-val').textContent = e.target.value; };
$('radius').onchange = (e) => { state.radius = +e.target.value; state.selected = null; load(); };
seg('activity', (v) => { state.activity = v; $('hint').textContent = ACTIVITIES[v].hint; buildWeights(); render(); renderSpots(); });
$('weights-reset').onclick = () => { delete state.weights[state.activity]; saveWeights(); buildWeights(); render(); };

function buildWeights() {
  const body = $('weights-body'); body.replaceChildren();
  const mults = state.weights[state.activity] || {};
  ACTIVITIES[state.activity].factors.forEach((f) => {
    const row = document.createElement('div'); row.className = 'wrow';
    const sel = document.createElement('select');
    WEIGHT_LEVELS.forEach((l) => sel.add(new Option(l.label, l.value, false, l.value === (mults[f.key] ?? 1))));
    sel.onchange = () => {
      (state.weights[state.activity] ||= {})[f.key] = +sel.value;
      saveWeights(); render();
    };
    row.innerHTML = `<span>${f.label}</span>`; row.append(sel); body.append(row);
  });
}
buildWeights();
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
map.on('click', (e) => { state.selected = null; setCenter({ lat: e.latlng.lat, lon: e.latlng.lng, label: `${e.latlng.lat.toFixed(2)}, ${e.latlng.lng.toFixed(2)}` }, false); });

function setCenter(c, zoom) {
  state.center = c;
  state.selected = null;
  if (zoom) map.setView([c.lat, c.lon], state.radius > 200 ? 6 : 7);
  load();
}

// ---------- Daten laden ----------
let loadId = 0;
async function load() {
  const id = ++loadId;
  const { center, radius } = state;
  const dates = selectedDates({ weekOffset: state.week, friday: state.friday, monday: state.monday }).map(isoDate);
  state.dates = dates;
  $('dates').textContent = dates.map(fmtDay).join(' · ');
  $('center-label').textContent = `📍 ${center.label} · ${radius} km`;

  const horizon = new Date(); horizon.setDate(horizon.getDate() + 15);
  if (dates[dates.length - 1] > isoDate(horizon)) { status('Der Zeitraum liegt außerhalb der 16-Tage-Vorhersage.', true); return; }

  drawCenter();
  const points = buildGrid(center.lat, center.lon, radius, stepFor(radius));
  status(`Lade Wetter für ${points.length} Orte …`);
  try {
    const sites = await fetchWeather(points, dates, { demo: DEMO });
    if (id !== loadId) return; // veraltete Antwort
    state.sites = sites;
    status(`${sites.length} Orte geladen${DEMO ? ' (Demo-Daten)' : ''}.`);
    render();
  } catch (err) { if (id === loadId) status(err.message, true); }
}

function drawCenter() {
  centerLayer.clearLayers();
  const { lat, lon } = state.center;
  L.circle([lat, lon], { radius: state.radius * 1000, color: '#2563eb', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(centerLayer);
  L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(centerLayer);
}

// ---------- Darstellung ----------
function render() {
  layer.clearLayers();
  const scored = state.sites.map((s) => {
    const days = siteDays(s, state.dates);
    return { site: s, days, ...scoreSite(state.activity, days, state.weights[state.activity]) };
  });
  const cell = (stepFor(state.radius) * 1000) * 0.62;

  scored.filter((x) => x.score >= state.min).forEach((x) => {
    L.circle([x.site.lat, x.site.lon], {
      radius: cell, stroke: false, fillColor: colorFor(x.score), fillOpacity: 0.55,
    }).bindPopup(() => popup(x), { minWidth: 320 }).on('popupopen', () => setPreview(x, 'ausgewählter Ort')).addTo(layer);
  });

  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 8).filter((x) => x.score >= state.min);
  const ol = $('top'); ol.replaceChildren();
  if (!top.length) ol.innerHTML = '<li class="muted" style="list-style:none">Keine Orte über dem Mindest-Score – Slider senken oder anderen Zeitraum wählen.</li>';
  top.forEach((x, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<b style="color:${colorFor(x.score)}">${x.score}</b> ${Math.round(x.site.elevation)} m · ${x.site.lat.toFixed(2)}, ${x.site.lon.toFixed(2)}`;
    const m = L.marker([x.site.lat, x.site.lon], {
      icon: L.divIcon({ className: '', html: `<div class="rank">${i + 1}</div>`, iconSize: [22, 22] }),
    }).bindPopup(() => popup(x), { minWidth: 320 }).on('popupopen', () => setPreview(x, 'ausgewählter Ort')).addTo(layer);
    li.onclick = () => { map.setView([x.site.lat, x.site.lon], Math.max(map.getZoom(), 9)); m.openPopup(); };
    ol.append(li);
  });

  // Vorschau: ausgewählter Ort, sonst der Gitterpunkt am Standort
  const cur = state.selected ? scored.find((x) => x.site === state.selected.site) : null;
  const here = cur || scored.reduce((best, x) => (!best || d2(x.site, state.center) < d2(best.site, state.center) ? x : best), null);
  if (here) setPreview(here, cur ? 'ausgewählter Ort' : 'am Standort', !!cur);
}

const d2 = (a, c) => (a.lat - c.lat) ** 2 + (a.lon - c.lon) ** 2;

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

function popup(x) {
  const a = ACTIVITIES[state.activity];
  const rows = x.days.map((d, i) => `<tr>
      <td>${fmtDay(d.date)}</td><td>${WEATHER_EMOJI(d.code)}</td>
      <td>${Math.round(d.tMin)}…${Math.round(d.tMax)}°</td>
      <td>${d.precip.toFixed(1)} mm</td>
      <td>${d.snow > 0 ? d.snow.toFixed(0) + ' cm ❄' : '–'}</td>
      <td>${Math.round(d.gust)} km/h</td>
      <td><b style="color:${colorFor(x.dayScores[i])}">${x.dayScores[i]}</b></td></tr>`).join('');
  return `<div class="pop"><b>${a.icon} ${a.label}: Score ${x.score}/100</b><br>
    <span class="muted">${Math.round(x.site.elevation)} m ü. M. · ${x.site.lat.toFixed(2)}, ${x.site.lon.toFixed(2)}</span>
    <table><tr><th>Tag</th><th></th><th>Temp</th><th>Regen</th><th>Schnee</th><th>Böen</th><th>Score</th></tr>${rows}</table></div>`;
}

// ---------- Spots (Klettern / Ski / MTB) ----------
const SPOT_TYPES = {
  climb: { label: 'Klettergebiet', icon: '🧗', color: '#d97706' },
  ski: { label: 'Skigebiet', icon: '⛷️', color: '#0284c7' },
  mtb: { label: 'MTB-Gebiet', icon: '🚵', color: '#16a34a' },
};
const ACTIVITY_SPOT = { climbing: 'climb', skiing: 'ski', mtb: 'mtb' }; // Wandern/Baden haben keine Spots
const DISCIPLINES = { sport: 'Sportklettern', trad: 'Trad / Mobile Sicherung', alpine: 'Alpinklettern', boulder: 'Bouldern' };
const disciplineOn = new Set(Object.keys(DISCIPLINES));
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

function spotPopup(sp, name) {
  const T = SPOT_TYPES[sp.t];
  const osm = `https://www.openstreetmap.org/?mlat=${sp.lat}&mlon=${sp.lon}#map=13/${sp.lat}/${sp.lon}`;
  const wiki = sp.w ? ` · <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(sp.w.replaceAll(' ', '_'))}" target="_blank" rel="noopener">Wikipedia</a>` : '';
  const src = sp.note ? sp.note : sp.o ? 'Quelle: OpenStreetMap' : 'Quelle: Wikipedia';
  const disc = sp.d?.length ? `<br>Disziplinen: ${sp.d.map((d) => DISCIPLINES[d]).join(', ')}` : '';
  const routes = sp.r ? `<br>Routen: ${sp.r}` : '';
  return `<b>${T.icon} <span class="spot-name">${name}</span></b><br><span class="muted">${T.label} · ${src}</span>${disc}${routes}<br>`
    + `<a href="${osm}" target="_blank" rel="noopener">OpenStreetMap</a>${wiki}`;
}

function spotMarker(sp) {
  const T = SPOT_TYPES[sp.t];
  const fallback = `${T.label} (${sp.lat.toFixed(2)}, ${sp.lon.toFixed(2)})`;
  const m = L.marker([sp.lat, sp.lon], {
    icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 30], popupAnchor: [0, -28],
      html: `<div class="pin" style="background:${T.color}"><span>${T.icon}</span></div>` }),
    title: sp.n || T.label,
  });
  m.bindPopup(spotPopup(sp, sp.n || fallback));
  if (!sp.n) {
    m.on('popupopen', async () => {
      const place = await placeName(sp);
      if (place) m.getPopup().setContent(spotPopup(sp, `${T.label} bei ${place}`));
    });
  }
  return m;
}

function renderSpots() {
  spotLayer.clearLayers();
  const type = ACTIVITY_SPOT[state.activity];
  $('disciplines').hidden = type !== 'climb';
  if (!$('spots-on').checked || !type) { $('spot-count').textContent = type ? '' : 'Für diese Aktivität gibt es keine Spot-Pins.'; return; }
  const shown = allSpots.filter((sp) => sp.t === type
    && (type !== 'climb' || !sp.d?.length || sp.d.some((d) => disciplineOn.has(d)))); // ohne Angabe: immer zeigen
  spotLayer.addLayers(shown.map(spotMarker));
  $('spot-count').textContent = `${shown.length} ${SPOT_TYPES[type].label}e angezeigt`;
}

Object.entries(DISCIPLINES).forEach(([k, label]) => {
  const lab = document.createElement('label'); lab.className = 'inline';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
  cb.onchange = () => { cb.checked ? disciplineOn.add(k) : disciplineOn.delete(k); renderSpots(); };
  lab.append(cb, ` ${label}`); $('disciplines').append(lab);
});
$('spots-on').onchange = renderSpots;

async function loadSpots() {
  const files = ['data/scraped-spots.json', 'data/curated-spots.json', 'data/osm-spots.json'];
  const lists = await Promise.all(files.map((u) => fetch(u).then((r) => (r.ok ? r.json() : [])).catch(() => [])));
  allSpots = lists.flat().filter((sp) => SPOT_TYPES[sp.t]);
  renderSpots();
}
loadSpots();
load();
