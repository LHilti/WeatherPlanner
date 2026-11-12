#!/usr/bin/env node
// Führt alle Spot-Quellen zu data/spots.json zusammen (diese Datei lädt die App):
//   scraped-spots.json (Wikipedia), curated-spots.json (kuratiert), tour-spots.json (Auswahlführer),
//   sources/mountainproject-europa.csv (Mountain Project, Export), osm-spots.json (OSM, falls vorhanden)
// Doppelte Klettergebiete werden zusammengeführt. Aufruf: `npm run build:spots`
import { readFile, writeFile } from 'node:fs/promises';
import { parseCsv } from './import-tours.mjs';
import { haversineKm } from '../js/geo.js';

// ---------- Mountain Project ----------

const num = (v) => (v === '' || v == null ? 0 : Number(v));

/** Baum aus der flachen MP-Liste (Eltern über „Pfad (Region)“ + Name). */
export function mpTree(rows) {
  const byKey = new Map();
  const keyOf = (r) => (r['Pfad (Region)'] ? `${r['Pfad (Region)']} > ${r.Name}` : r.Name);
  for (const r of rows) {
    const k = keyOf(r);
    if (!byKey.has(k)) byKey.set(k, { ...r, key: k, children: [] }); // seltene Namensdubletten: erster gewinnt
  }
  for (const node of byKey.values()) {
    const parent = byKey.get(node['Pfad (Region)']);
    if (parent && parent !== node) { node.parent = parent; parent.children.push(node); }
  }
  return byKey;
}

/** Disziplinen aus MP-Zählern. */
export function mpDisciplines(r) {
  const d = [];
  if (num(r.Sport) > 0 || (num(r.Toprope) > 0 && !num(r.Trad))) d.push('sport');
  if (num(r.Trad) > 0) d.push('trad');
  if (num(r['Eis/Mixed']) > 0 || r['MP-Subtyp'] === 'MOUNT') d.push('alpine');
  if (num(r.Boulder) > 0) d.push('boulder');
  return d;
}

/**
 * Felsebene wählen (≈ „Crag“ bei theCrag): ein Gebiet, dessen Kinder alle Sektoren sind, wird ein Pin;
 * Sektoren direkt unter einer Region werden selbst ein Pin. Regionen (Ebene 1, Sammelordner) nie.
 */
export function mpCrags(rows) {
  const tree = mpTree(rows);
  const crags = new Set();
  for (const n of tree.values()) {
    if (n.children.length) continue; // nur von Blättern aus nach oben
    if (/archive/i.test(n.key)) continue;
    const p = n.parent;
    const parentIsCrag = p && Number(p.Ebene) >= 2 && p.children.every((c) => !c.children.length);
    crags.add(parentIsCrag ? p : n);
  }
  return [...crags]
    .filter((c) => num(c['Routen gesamt']) > 0)
    .map((c) => {
      const spot = {
        n: c.Name, lat: +Number(c.Breitengrad).toFixed(4), lon: +Number(c['Längengrad']).toFixed(4), t: 'climb',
        r: num(c['Routen gesamt']), mp: c.ID, region: c['Pfad (Region)'],
      };
      const ferrata = /via ferrata|klettersteig/i.test(`${c['Pfad (Region)']} > ${c.Name}`) || /^VF /.test(c.Name);
      const d = ferrata ? ['ferrata'] : mpDisciplines(c); if (d.length) spot.d = d;
      // Klettersteig-Einträge heißen bei MP oft nur wie die Region („Tirol“, „Via Ferrata“) → lesbarer Name
      if (ferrata) {
        if (/^[*z. ]*via ferrata$/i.test(c.Name)) spot.n = `Klettersteige ${c['Pfad (Region)'].split(' > ').pop()}`; // generischer Ordner
        else if (/\* Via Ferrata$/.test(c['Pfad (Region)'])) spot.n = `Klettersteige ${c.Name}`; // Bundesland-Ordner (AT)
        else if (!/ferrata|klettersteig|\bVF\b/i.test(c.Name)) spot.n = `${c.Name} (Klettersteig)`;
      }
      const g = [c['Grad-Spanne Seil'], c['Grad-Spanne Boulder'] && `Boulder ${c['Grad-Spanne Boulder']}`].filter(Boolean).join(' · ');
      if (g) spot.g = g;
      return spot;
    });
}

/** Mehrere Crags mit identischer Position (MP vererbt Koordinaten) zu einem Pin zusammenfassen. */
export function mergeSamePosition(spots) {
  const groups = new Map();
  for (const s of spots) {
    const k = `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    g.sort((a, b) => b.r - a.r);
    return {
      ...g[0],
      n: g.length > 3 ? `${g[0].n} (+${g.length - 1} weitere)` : g.map((s) => s.n).join(' / '),
      r: g.reduce((n, s) => n + s.r, 0),
      d: [...new Set(g.flatMap((s) => s.d ?? []))],
      sub: g.map((s) => ({ n: s.n, r: s.r, mp: s.mp })),
    };
  });
}

// ---------- Dubletten zwischen Quellen ----------

const ALIASES = {
  'saxon switzerland climbing region': 'elbsandstein',
  'falkenstein (saxon switzerland)': 'falkenstein',
  'fontainebleau rock climbing': 'fontainebleau',
  'fontainebleau (bleau nord)': 'fontainebleau',
  'verdon gorge': 'verdon',
  'frankenjura (pottenstein)': 'frankenjura',
  'calanques (marseille)': 'calanques',
  'cresciano (tessin)': 'cresciano',
  'blautal / schwabische alb': 'schwabische alb',
};

export function normName(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').trim();
}
const STOP = new Set(['de', 'la', 'le', 'les', 'del', 'di', 'du', 'des', 'the', 'and', 'und', 'am', 'im', 'bei', 'climbing', 'region', 'area', 'rock', 'gorge', 'gorges', 'crag', 'sector', 'klettergebiet']);
const tokens = (s) => normName(s).replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));

/** Gleiche Gegend? Namen teilen ein markantes Wort bzw. Alias passt. */
export function sameName(a, b) {
  const na = ALIASES[normName(a)] ?? normName(a); const nb = ALIASES[normName(b)] ?? normName(b);
  if (na === nb) return true;
  const ta = tokens(na); const tb = new Set(tokens(nb));
  return ta.length > 0 && ta.some((t) => tb.has(t) && t.length >= 5);
}

/**
 * Kuratierte/Wikipedia-Klettergebiete, die Mountain Project bereits (genauer) abdeckt, entfallen.
 * Abgleich gegen alle MP-Knoten (auch Regionen wie „Frankenjura“), Namen + max. 30 km Abstand.
 * Disziplinen und Wikipedia-Link gehen auf den nächstgelegenen MP-Pin über.
 */
export function dedupeAgainstMp(spots, mpNodes, mpSpots, maxKm = 30) {
  const kept = []; const dropped = [];
  for (const s of spots) {
    if (s.t !== 'climb' || s.tours) { kept.push(s); continue; }
    const match = mpNodes.find((m) => sameName(s.n, m.n) && haversineKm(s.lat, s.lon, m.lat, m.lon) <= maxKm);
    if (!match) { kept.push(s); continue; }
    const near = mpSpots.reduce((best, m) => {
      const d = haversineKm(s.lat, s.lon, m.lat, m.lon);
      return !best || d < best.d ? { m, d } : best;
    }, null);
    if (near && near.d <= maxKm) {
      if (s.w && !near.m.w) near.m.w = s.w;
      if (s.d) near.m.d = [...new Set([...(near.m.d ?? []), ...s.d])];
    }
    dropped.push({ n: s.n, matched: match.n, region: match.region });
  }
  return { kept, dropped };
}

/** OSM-Felsen, die näher als 1 km an einem MP-Crag liegen, sind Dubletten. */
export function dedupeOsm(osm, mpSpots, maxKm = 1) {
  const cell = (lat, lon) => `${Math.round(lat * 50)},${Math.round(lon * 50)}`;
  const grid = new Map();
  for (const m of mpSpots) {
    const k = cell(m.lat, m.lon); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(m);
  }
  return osm.filter((o) => {
    if (o.t !== 'climb') return true;
    const [ci, cj] = cell(o.lat, o.lon).split(',').map(Number);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const m of grid.get(`${ci + i},${cj + j}`) ?? []) {
        if (haversineKm(o.lat, o.lon, m.lat, m.lon) <= maxKm) { if (o.d) m.d = [...new Set([...(m.d ?? []), ...o.d])]; return false; }
      }
    }
    return true;
  });
}

async function main() {
  const data = new URL('../data/', import.meta.url);
  const json = async (f, d = []) => { try { return JSON.parse(await readFile(new URL(f, data), 'utf8')); } catch { return d; } };
  const rows = parseCsv(await readFile(new URL('sources/mountainproject-europa.csv', data), 'utf8'));
  const mpSpots = mergeSamePosition(mpCrags(rows));
  const mpNodes = rows.filter((r) => num(r['Routen gesamt']) > 0)
    .map((r) => ({ n: r.Name, lat: +r.Breitengrad, lon: +r['Längengrad'], region: r['Pfad (Region)'] }));

  const others = [...await json('scraped-spots.json'), ...await json('curated-spots.json'), ...await json('tour-spots.json')];
  const { kept, dropped } = dedupeAgainstMp(others, mpNodes, mpSpots);
  const osm = dedupeOsm(await json('osm-spots.json'), mpSpots);

  const all = [...kept, ...mpSpots, ...osm];
  await writeFile(new URL('spots.json', data), JSON.stringify(all));
  const by = (t) => all.filter((s) => s.t === t).length;
  console.log(`MP: ${rows.length} Einträge → ${mpSpots.length} Kletter-Pins`);
  console.log(`zusammengeführt (kuratiert/Wikipedia ⊂ MP): ${dropped.length}`);
  dropped.forEach((d) => console.log(`  ${d.n}  →  ${d.matched} [${d.region}]`));
  console.log(`spots.json: ${all.length} (Klettern ${by('climb')}, Ski ${by('ski')}, MTB ${by('mtb')}, OSM ${osm.length})`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
