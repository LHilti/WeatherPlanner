#!/usr/bin/env node
// Lawinenregionen (EAWS-Mikroregionen) für Eisklettergebiete bestimmen.
// `npm run fetch:eaws` lädt die Regionsgrenzen (GeoJSON) und die deutschen Regionsnamen nach data/.cache/eaws;
// `npm run build:spots` ordnet dann jedem Eis-Spot per Punkt-in-Polygon seine Region zu (Felder ar, arn).
// Quelle: EAWS, https://regions.avalanches.org (CC BY 4.0)
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { haversineKm } from '../js/geo.js';

export const PROVIDERS = ['AD', 'AT-02', 'AT-05', 'AT-06', 'AT-07', 'AT-08', 'CH', 'DE-BY', 'FR', 'IT-21', 'IT-23', 'IT-25',
  'IT-32-BZ', 'IT-32-TN', 'IT-34', 'IT-36', 'NO', 'PL', 'SI', 'ES-CT-L'];
const CACHE = new URL('../data/.cache/eaws/', import.meta.url);

/** Strahl-Test für einen Ring [[lon, lat], …]. */
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Punkt in (Multi-)Polygon, Löcher berücksichtigt. */
export function inGeometry(lon, lat, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)));
}

/** Region für einen Punkt: enthaltendes Polygon, sonst nächstgelegene Region (Eckpunkte) bis maxKm. */
export function regionFor(lat, lon, features, maxKm = 8) {
  const hit = features.find((f) => inGeometry(lon, lat, f.geometry));
  if (hit) return { id: hit.properties.id, km: 0 };
  let best = null;
  for (const f of features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const [x, y] of poly[0]) {
      if (Math.abs(y - lat) > 0.2 || Math.abs(x - lon) > 0.3) continue;
      const d = haversineKm(lat, lon, y, x);
      if (!best || d < best.km) best = { id: f.properties.id, km: d };
    }
  }
  return best && best.km <= maxKm ? best : null;
}

/** Alle gecachten Regionen laden (nur aktuell gültige, ohne end_date). */
export async function loadRegions() {
  let files; try { files = await readdir(CACHE); } catch { return null; }
  const features = []; let names = {};
  for (const f of files) {
    const j = JSON.parse(await readFile(new URL(f, CACHE), 'utf8'));
    if (f === 'names-de.json') names = j;
    else if (f.endsWith('.geojson')) features.push(...j.features.filter((x) => !x.properties.end_date));
  }
  return features.length ? { features, names } : null;
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
  await writeFile(new URL('names-de.json', CACHE), JSON.stringify(await get('https://regions.avalanches.org/micro-regions_names/de.json')));
  for (const p of PROVIDERS) {
    try {
      const j = await get(`https://regions.avalanches.org/micro-regions/${p}_micro-regions.geojson.json`);
      j.features = j.features.filter((x) => !x.properties.end_date);
      await writeFile(new URL(`${p}.geojson`, CACHE), JSON.stringify(j));
      console.log(`${p}: ${j.features.length} Regionen`);
    } catch (e) { console.warn(`übersprungen – ${e.message}`); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
