import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, dedupe, disciplines, parseOverpass, pickName, tiles } from '../scripts/scrape-osm.mjs';

test('tiles deckt Europa lückenlos ab', () => {
  const t = tiles({ south: 34, west: -11, north: 72, east: 35 }, 5);
  assert.equal(t.length, 8 * 10);
  assert.deepEqual(t[0], [34, -11, 39, -6]);
});

test('buildQuery: schließt Kletterhallen aus und enthält Bounding Box', () => {
  const q = buildQuery([47, 10, 52, 15], ['climb']);
  assert.match(q, /"leisure"!="sports_centre"/);
  assert.match(q, /\(47,10,52,15\)/);
  assert.doesNotMatch(q, /winter_sports/);
});

test('disciplines: Sport, Trad, Alpin, Bouldern aus OSM-Tags', () => {
  assert.deepEqual(disciplines({ 'climbing:sport': 'yes', 'climbing:traditional': 'yes' }), ['sport', 'trad']);
  assert.deepEqual(disciplines({ 'climbing:multipitch': 'yes' }), ['alpine']);
  assert.deepEqual(disciplines({ climbing: 'boulder' }), ['boulder']);
  assert.deepEqual(disciplines({}), []);
});

test('pickName: Fallbacks, leer wenn kein Name', () => {
  assert.equal(pickName({ 'name:de': 'Schleierfall' }), 'Schleierfall');
  assert.equal(pickName({ climbing: 'crag' }), '');
});

test('parseOverpass: Knoten und Ways (center) inkl. Disziplin und Routenzahl', () => {
  const json = { elements: [
    { type: 'node', id: 1, lat: 47.5, lon: 11.2, tags: { name: 'Kochelfels', 'climbing:sport': 'yes', 'climbing:routes': '42' } },
    { type: 'way', id: 2, center: { lat: 48.1, lon: 11.6 }, tags: { climbing: 'crag' } },
    { type: 'relation', id: 3, tags: {} },
  ] };
  assert.deepEqual(parseOverpass(json, 'climb'), [
    { n: 'Kochelfels', lat: 47.5, lon: 11.2, t: 'climb', o: 'n1', d: ['sport'], r: 42 },
    { n: '', lat: 48.1, lon: 11.6, t: 'climb', o: 'w2' },
  ]);
});

test('dedupe: nahe Duplikate werden zusammengeführt, Name und Disziplinen bleiben erhalten', () => {
  const out = dedupe([
    { n: '', lat: 47.5, lon: 11.2, t: 'climb', d: ['sport'] },
    { n: 'Kochelfels', lat: 47.5005, lon: 11.2005, t: 'climb', d: ['trad'] },
    { n: 'Woanders', lat: 49, lon: 12, t: 'climb' },
  ]);
  assert.equal(out.length, 2);
  const m = out.find((s) => s.n === 'Kochelfels');
  assert.deepEqual(m.d.sort(), ['sport', 'trad']);
});
