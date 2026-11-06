// Wetterdaten von Open-Meteo (kostenlos, kein API-Key): https://open-meteo.com

const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'rain_sum',
  'snowfall_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'sunshine_duration',
].join(',');
const BATCH = 50;

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Nächster Samstag (heute, falls Samstag); weekOffset 1 = das Wochenende danach. */
export function weekendStart(today = new Date(), weekOffset = 0) {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return addDays(base, (6 - base.getDay() + 7) % 7 + 7 * weekOffset);
}

/** Datumsliste für Wochenende ± Freitag/Montag. */
export function selectedDates({ today = new Date(), weekOffset = 0, friday = false, monday = false }) {
  const sat = weekendStart(today, weekOffset);
  const dates = [sat, addDays(sat, 1)];
  if (friday) dates.unshift(addDays(sat, -1));
  if (monday) dates.push(addDays(sat, 2));
  return dates;
}

function normalize(loc, lat, lon) {
  const d = loc.daily;
  const days = d.time.map((date, i) => ({
    date,
    code: d.weather_code[i],
    tMax: d.temperature_2m_max[i],
    tMin: d.temperature_2m_min[i],
    precip: d.precipitation_sum[i] ?? 0,
    rain: d.rain_sum[i] ?? 0,
    snow: d.snowfall_sum[i] ?? 0,
    pop: d.precipitation_probability_max[i],
    wind: d.wind_speed_10m_max[i],
    gust: d.wind_gusts_10m_max[i],
    sun: (d.sunshine_duration[i] ?? 0) / 3600,
    elevation: loc.elevation,
  }));
  return { lat, lon, elevation: loc.elevation, days };
}

/** Holt Tageswerte für alle Punkte; `dates` sind ISO-Strings, 2 Vortage werden für Bodenfeuchte mitgeladen. */
export async function fetchWeather(points, dates, { demo = false } = {}) {
  const start = isoDate(addDays(new Date(dates[0] + 'T00:00:00'), -2));
  const end = dates[dates.length - 1];
  const chunks = [];
  for (let i = 0; i < points.length; i += BATCH) chunks.push(points.slice(i, i + BATCH));

  const results = await Promise.all(chunks.map(async (chunk) => {
    if (demo) return chunk.map((p) => ({ ...demoLocation(p, start, end), _p: p }));
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${chunk.map((p) => p.lat.toFixed(3)).join(',')}`
      + `&longitude=${chunk.map((p) => p.lon.toFixed(3)).join(',')}`
      + `&daily=${DAILY}&timezone=auto&start_date=${start}&end_date=${end}`;
    const res = await fetch(url);
    if (res.status === 429) throw new Error('Open-Meteo-Limit erreicht – bitte kurz warten oder kleineren Umkreis wählen.');
    if (!res.ok) throw new Error(`Wetterabfrage fehlgeschlagen (${res.status})`);
    const json = await res.json();
    const arr = Array.isArray(json) ? json : [json];
    return arr.map((loc, i) => ({ ...loc, _p: chunk[i] }));
  }));

  return results.flat().map((loc) => normalize(loc, loc._p.lat, loc._p.lon));
}

/** Verknüpft Tageswerte der gewählten Tage mit „Niederschlag der 2 Vortage“. */
export function siteDays(site, dates) {
  return dates.map((date) => {
    const i = site.days.findIndex((d) => d.date === date);
    const prev = site.days.slice(Math.max(0, i - 2), i).reduce((s, d) => s + d.precip, 0);
    return { ...site.days[i], prevPrecip: prev };
  });
}

export const WEATHER_EMOJI = (code) => {
  if (code == null) return '·';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
};

// --- Demo-Daten (?demo=1): deterministische Fake-Wetterdaten zum Testen ohne Netzwerk ---
function demoLocation(p, start, end) {
  const rnd = (seed) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };
  const elevation = Math.round(200 + 2200 * rnd(p.lat * 12.9 + p.lon * 78.2) ** 2);
  const time = [];
  for (let d = new Date(start + 'T00:00:00'); isoDate(d) <= end; d = addDays(d, 1)) time.push(isoDate(d));
  const col = (f) => time.map((_, i) => f(i));
  const wet = (i) => rnd(Math.floor(p.lat * 3) * 7 + Math.floor(p.lon * 3) * 13 + i * 5) > 0.6;
  return {
    elevation,
    daily: {
      time,
      weather_code: col((i) => (wet(i) ? 61 : 1)),
      temperature_2m_max: col(() => 14 - elevation / 150 + 6 * rnd(p.lat)),
      temperature_2m_min: col(() => 6 - elevation / 150),
      precipitation_sum: col((i) => (wet(i) ? 8 * rnd(i + p.lon) : 0)),
      rain_sum: col((i) => (wet(i) && elevation < 1200 ? 6 * rnd(i + p.lon) : 0)),
      snowfall_sum: col((i) => (wet(i) && elevation >= 1200 ? 20 * rnd(i + p.lat) : 0)),
      precipitation_probability_max: col((i) => (wet(i) ? 80 : 10)),
      wind_speed_10m_max: col(() => 15),
      wind_gusts_10m_max: col(() => 30 + 20 * rnd(p.lon)),
      sunshine_duration: col((i) => (wet(i) ? 3600 : 8 * 3600)),
    },
  };
}
