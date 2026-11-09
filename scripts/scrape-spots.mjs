#!/usr/bin/env node
// Scraper: holt Orte mit Koordinaten aus Wikipedia-Kategorien (MediaWiki-API, kein Key nötig)
// und schreibt data/scraped-spots.json. Aufruf: `npm run scrape`
// Händisch gepflegte Gebiete stehen separat in data/curated-spots.json und bleiben unberührt.
import { writeFile } from 'node:fs/promises';

export const CATEGORIES = [
  ...['Austria', 'Germany', 'Switzerland', 'Italy', 'France', 'Slovenia', 'Liechtenstein']
    .map((c) => ({ cat: `Ski_areas_and_resorts_in_${c}`, t: 'ski' })),
  ...['Germany', 'Austria', 'Switzerland', 'Italy', 'France', 'Slovenia', 'Czech_Republic']
    .map((c) => ({ cat: `Climbing_areas_of_${c}`, t: 'climb' })),
  ...['Austria', 'Switzerland', 'France', 'Italy', 'Germany', 'Europe']
    .map((c) => ({ cat: `Mountain_biking_in_${c}`, t: 'mtb' })),
  { cat: 'Mountain_biking_venues', t: 'mtb' },
];
// Eingrenzung auf Europa.
export const BBOX = { minLat: 34, maxLat: 72, minLon: -11, maxLon: 35 }; // Europa

/** Wandelt eine MediaWiki-Antwort (generator=categorymembers&prop=coordinates) in Spot-Objekte um. */
export function parsePages(json, t) {
  const pages = Object.values(json?.query?.pages ?? {});
  return pages
    .filter((p) => p.coordinates?.length && !/^List of /i.test(p.title))
    .map((p) => ({ n: p.title, lat: +p.coordinates[0].lat.toFixed(4), lon: +p.coordinates[0].lon.toFixed(4), t, w: p.title }))
    .filter((s) => s.lat >= BBOX.minLat && s.lat <= BBOX.maxLat && s.lon >= BBOX.minLon && s.lon <= BBOX.maxLon);
}

async function fetchCategory({ cat, t }) {
  const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&generator=categorymembers'
    + `&gcmtitle=Category:${cat}&gcmlimit=500&gcmtype=page&prop=coordinates&colimit=500`;
  const res = await fetch(url, { headers: { 'User-Agent': 'WeatherPlanner-scraper/0.1 (https://github.com/LHilti/WeatherPlanner)' } });
  if (!res.ok) throw new Error(`${cat}: HTTP ${res.status}`);
  return parsePages(await res.json(), t);
}

async function main() {
  const seen = new Map();
  for (const c of CATEGORIES) {
    try {
      const spots = await fetchCategory(c);
      spots.forEach((s) => seen.set(`${s.t}:${s.n}`, s));
      console.log(`${c.cat}: ${spots.length}`);
    } catch (e) { console.warn(`übersprungen – ${e.message}`); }
  }
  const out = [...seen.values()].sort((a, b) => a.t.localeCompare(b.t) || a.n.localeCompare(b.n));
  await writeFile(new URL('../data/scraped-spots.json', import.meta.url), JSON.stringify(out));
  console.log(`geschrieben: ${out.length} Spots`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
