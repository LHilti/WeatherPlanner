#!/usr/bin/env node
// OSM-Scraper (Overpass-API): Klettergebiete (inkl. Disziplinen) und Skigebiete in ganz Europa.
// Aufruf: `npm run scrape:osm`  (braucht Netzwerk, dauert je nach Server 10–40 Min.)
//   --types=climb,ski   welche Typen (Standard: beide)
//   --step=5            Kachelgröße in Grad (kleiner = zuverlässiger, aber mehr Anfragen)
// Ergebnis: data/osm-spots.json. Zwischenstände je Kachel liegen in data/.cache und machen den
// Lauf fortsetzbar (bei Abbruch einfach erneut starten). Daten © OpenStreetMap-Mitwirkende (ODbL).
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const EUROPE = { south: 34, west: -11, north: 72, east: 35 };
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = 'WeatherPlanner-scraper/0.1 (https://github.com/LHilti/WeatherPlanner)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Kachelliste (south, west, north, east) über die Bounding Box. */
export function tiles(bbox = EUROPE, step = 5) {
  const out = [];
  for (let s = bbox.south; s < bbox.north; s += step)
    for (let w = bbox.west; w < bbox.east; w += step)
      out.push([s, w, Math.min(s + step, bbox.north), Math.min(w + step, bbox.east)]);
  return out;
}

export function buildQuery([s, w, n, e], types) {
  const box = `(${s},${w},${n},${e})`;
  const parts = [];
  if (types.includes('climb')) {
    // Fels/Gebiet/Boulder mit sport=climbing, aber keine Kletterhallen
    parts.push(`nwr["sport"="climbing"]["climbing"~"^(crag|area|boulder)$"]["leisure"!="sports_centre"]["indoor"!="yes"]${box};`);
    parts.push(`nwr["natural"="cliff"]["sport"="climbing"]${box};`);
  }
  if (types.includes('ski')) parts.push(`nwr["landuse"="winter_sports"]["name"]${box};`);
  return `[out:json][timeout:180];(${parts.join('')});out center tags;`;
}

const yes = (v) => v === 'yes' || v === 'true' || v === '1';

/** Disziplinen aus OSM-Tags: sport | trad | alpine | boulder */
export function disciplines(tags) {
  const d = [];
  if (yes(tags['climbing:sport'])) d.push('sport');
  if (yes(tags['climbing:traditional'])) d.push('trad');
  if (yes(tags['climbing:multipitch']) || yes(tags['climbing:mixed']) || yes(tags['climbing:ice']) || tags.climbing === 'area' && +tags['climbing:pitches'] >= 3) d.push('alpine');
  if (yes(tags['climbing:boulder']) || tags.climbing === 'boulder') d.push('boulder');
  return d;
}

/** Name aus mehreren Tag-Varianten; leer, wenn OSM keinen Namen kennt (die App löst das dann per Ortssuche auf). */
export function pickName(tags) {
  return tags.name || tags['name:de'] || tags['name:en'] || tags.loc_name || tags.alt_name || tags.official_name || tags.ref || '';
}

/** Overpass-Antwort → Spot-Objekte. */
export function parseOverpass(json, type) {
  return (json.elements ?? []).flatMap((el) => {
    const lat = el.lat ?? el.center?.lat; const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) return [];
    const tags = el.tags ?? {};
    const spot = { n: pickName(tags), lat: +lat.toFixed(4), lon: +lon.toFixed(4), t: type, o: `${el.type[0]}${el.id}` };
    if (type === 'climb') {
      const d = disciplines(tags); if (d.length) spot.d = d;
      const r = parseInt(tags['climbing:routes'] ?? tags['climbing:sport:routes'] ?? '', 10); if (r > 0) spot.r = r;
    }
    return [spot];
  });
}

/** Doppelte (Fels + Gebiet am selben Ort) auf ~1,5-km-Raster zusammenfassen; Informativstes gewinnt. */
export function dedupe(spots, cell = 0.015) {
  const score = (s) => (s.n ? 4 : 0) + (s.d?.length ?? 0) + (s.r ? 2 : 0);
  const best = new Map();
  for (const s of spots) {
    const k = `${s.t}:${Math.round(s.lat / cell)}:${Math.round(s.lon / cell)}`;
    const cur = best.get(k);
    if (!cur) { best.set(k, { ...s }); continue; }
    const winner = score(s) > score(cur) ? { ...s } : cur;
    const d = [...new Set([...(cur.d ?? []), ...(s.d ?? [])])];
    if (d.length) winner.d = d;
    if (!winner.n) winner.n = cur.n || s.n;
    best.set(k, winner);
  }
  return [...best.values()];
}

async function overpass(query, attempt = 0) {
  const url = MIRRORS[attempt % MIRRORS.length];
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` });
    if (res.status === 429 || res.status === 504) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt >= 8) throw e;
    const wait = Math.min(120_000, 5000 * 2 ** Math.floor(attempt / MIRRORS.length));
    console.warn(`  ${url}: ${e.message} – neuer Versuch in ${wait / 1000}s`);
    await sleep(wait);
    return overpass(query, attempt + 1);
  }
}

async function main() {
  const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
  const types = arg('types', 'climb,ski').split(',');
  const step = +arg('step', 5);
  const cacheDir = new URL('../data/.cache/', import.meta.url);
  await mkdir(cacheDir, { recursive: true });
  const all = [];
  const list = tiles(EUROPE, step);
  for (const [i, tile] of list.entries()) {
    for (const type of types) {
      const file = new URL(`${type}_${tile.join('_')}.json`, cacheDir);
      let spots;
      try { spots = JSON.parse(await readFile(file, 'utf8')); } catch {
        spots = parseOverpass(await overpass(buildQuery(tile, [type])), type);
        await writeFile(file, JSON.stringify(spots));
        await sleep(2000); // höflich bleiben
      }
      all.push(...spots);
      console.log(`[${i + 1}/${list.length}] ${type} ${tile.join(',')}: ${spots.length}`);
    }
  }
  const out = dedupe(all).sort((a, b) => a.t.localeCompare(b.t) || a.lat - b.lat);
  await writeFile(new URL('../data/osm-spots.json', import.meta.url), JSON.stringify(out));
  console.log(`geschrieben: ${out.length} Spots (${out.filter((s) => !s.n).length} ohne Namen)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
