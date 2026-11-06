// Geografie-Helfer und Geocoding (Open-Meteo Geocoding API, ohne API-Key).

const KM_PER_DEG = 111.32;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Gitterpunkte (Abstand stepKm) innerhalb des Kreises um das Zentrum. */
export function buildGrid(lat, lon, radiusKm, stepKm) {
  const points = [];
  const n = Math.ceil(radiusKm / stepKm);
  const dLat = stepKm / KM_PER_DEG;
  const dLon = stepKm / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180));
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const p = { lat: lat + i * dLat, lon: lon + j * dLon };
      if (Math.abs(p.lat) > 89) continue;
      if (haversineKm(lat, lon, p.lat, p.lon) <= radiusKm) points.push(p);
    }
  }
  return points;
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
