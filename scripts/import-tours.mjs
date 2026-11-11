#!/usr/bin/env node
// Importiert die Tourenliste data/sources/klettertouren.csv (Auswahlführer, ohne Koordinaten) und
// bündelt sie über data/sources/tour-areas.json zu Gebirgsgruppen → data/tour-spots.json.
// Aufruf: `npm run import:tours`
import { readFile, writeFile } from 'node:fs/promises';

/** Minimaler CSV-Parser für ;-getrennte Felder in Anführungszeichen ("" = Anführungszeichen). */
export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const split = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ';') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

/** "1-4,101" → enthält n? (Nummern wie "99a" zählen als 99) */
export function inRanges(spec, nr) {
  const n = parseInt(nr, 10);
  return spec.split(',').some((part) => {
    const [a, b = a] = part.split('-').map(Number);
    return n >= a && n <= b;
  });
}

/** Gebirgsgruppe einer Tour: erst Gebiet-Spalte (mit Aliassen), sonst Zuordnung über Serie + Nummer. */
export function areaOf(row, cfg) {
  const g = row.Gebiet;
  if (g) {
    if (cfg.areas[g]) return g;
    if (cfg.aliases[g]) return cfg.aliases[g];
    const pre = Object.keys(cfg.prefixAliases).find((p) => g.startsWith(p));
    if (pre) return cfg.prefixAliases[pre];
    return null;
  }
  const spec = Object.entries(cfg.byNumber[row.Serie] ?? {}).find(([s]) => inRanges(s, row.Nr));
  return spec ? spec[1] : null;
}

/** In „Moderne Zeiten“/„Longlines“ kleben Routenname und Berg zusammen („MärmelibahnEiger“) → an der letzten Klein→Groß-Grenze trennen. */
export function splitGlued(name) {
  const m = [...name.matchAll(/[a-zà-ÿß0-9…](?=[A-ZÄÖÜ])/g)].pop();
  return m ? `${name.slice(0, m.index + 1)} – ${name.slice(m.index + 1)}` : name;
}
const GLUED = new Set(['Moderne Zeiten', 'Longlines']);

/** Touren → Spots je Gebirgsgruppe; Klettersteige als eigene Spots (Disziplin „ferrata“). */
export function buildSpots(rows, cfg) {
  const groups = new Map(); const unmatched = [];
  for (const row of rows) {
    const area = areaOf(row, cfg);
    if (!area || !cfg.areas[area]) { unmatched.push(row); continue; }
    const ferrata = row.Serie === 'Klettersteige';
    const key = `${area}|${ferrata}`;
    if (!groups.has(key)) {
      const [lat, lon] = cfg.areas[area];
      // Klettersteig-Pin leicht versetzt, damit er nicht exakt auf dem Kletter-Pin liegt
      groups.set(key, { n: area, lat: ferrata ? +(lat + 0.02).toFixed(4) : lat, lon: ferrata ? +(lon + 0.03).toFixed(4) : lon,
        t: 'climb', d: [ferrata ? 'ferrata' : 'alpine'], note: 'Tourenliste aus Auswahlführern, Lage = Gebirgsgruppe', tours: [] });
    }
    const tour = { n: GLUED.has(row.Serie) ? splitGlued(row.Tour) : row.Tour, s: row.Serie };
    const grade = row.Schwierigkeit || row.Bewertung_Buch; if (grade) tour.g = grade;
    if (row.Gipfel) tour.p = row.Gipfel;
    groups.get(key).tours.push(tour);
  }
  return { spots: [...groups.values()].sort((a, b) => b.tours.length - a.tours.length), unmatched };
}

async function main() {
  const src = new URL('../data/sources/', import.meta.url);
  const rows = parseCsv(await readFile(new URL('klettertouren.csv', src), 'utf8'));
  const cfg = JSON.parse(await readFile(new URL('tour-areas.json', src), 'utf8'));
  const { spots, unmatched } = buildSpots(rows, cfg);
  await writeFile(new URL('../data/tour-spots.json', import.meta.url), JSON.stringify(spots));
  console.log(`${rows.length} Touren → ${spots.length} Spots (${rows.length - unmatched.length} zugeordnet)`);
  unmatched.forEach((r) => console.warn(`  nicht zugeordnet: ${r.Serie} ${r.Nr} ${r.Tour} [${r.Gebiet}]`));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
