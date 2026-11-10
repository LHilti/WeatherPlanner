// Geografie-Helfer und Geocoding (Open-Meteo Geocoding API, ohne API-Key).

const KM_PER_DEG = 111.32;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 4, 8]; // Gitterweite in Grad Breite
const LON_FACTOR = 1.5; // Längengrade sind in Europa ~1,5× „kürzer“ → annähernd quadratische Zellen

/**
 * Gitterpunkte für einen Kartenausschnitt. Die Punkte liegen auf einem festen, weltweiten Raster
 * (Vielfache der Schrittweite), damit beim Verschieben der Karte bereits geladene Punkte
 * wiederverwendet werden können. Die Schrittweite wird so gewählt, dass höchstens maxPoints entstehen.
 */
export function gridForBounds({ south, west, north, east }, maxPoints = 100) {
  south = Math.max(south, -85); north = Math.min(north, 85);
  let step = STEPS[STEPS.length - 1];
  for (const st of STEPS) {
    const n = (Math.floor(north / st) - Math.ceil(south / st) + 1)
      * (Math.floor(east / (st * LON_FACTOR)) - Math.ceil(west / (st * LON_FACTOR)) + 1);
    if (n <= maxPoints) { step = st; break; }
  }
  const lonStep = step * LON_FACTOR;
  const points = [];
  for (let i = Math.ceil(south / step); i <= Math.floor(north / step); i++) {
    for (let j = Math.ceil(west / lonStep); j <= Math.floor(east / lonStep); j++) {
      if (points.length >= maxPoints * 2) break; // Schutz bei extrem weitem Zoom
      points.push({ lat: +(i * step).toFixed(4), lon: +(j * lonStep).toFixed(4) });
    }
  }
  return { points, step, lonStep };
}

/** Grobe Schätzung ohne Routing: Straße ≈ 1,3 × Luftlinie, Schnitt ≈ 75 km/h. */
export function estimateDrive(from, to) {
  const km = haversineKm(from.lat, from.lon, to.lat, to.lon) * 1.3;
  return { km, min: (km / 75) * 60, estimated: true };
}

const routeCache = new Map();
/** Fahrstrecke/-zeit mit dem Auto über OSRM (öffentlicher Demo-Server, kein Key); bei Fehler Schätzung. */
export function drivingRoute(from, to) {
  const key = [from.lat, from.lon, to.lat, to.lon].map((v) => v.toFixed(3)).join(',');
  if (!routeCache.has(key)) {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    routeCache.set(key, fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((j) => {
        if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.code);
        return { km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60, estimated: false };
      })
      .catch(() => { routeCache.delete(key); return estimateDrive(from, to); }));
  }
  return routeCache.get(key);
}

export function formatDrive({ km, min }) {
  const m = Math.round(min / 5) * 5;
  const t = m < 60 ? `${Math.max(m, 5)} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${t} · ${Math.round(km)} km`;
}

export async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=de&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding fehlgeschlagen (${res.status})`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
  }));
}
