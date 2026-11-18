import test from 'node:test';
import assert from 'node:assert/strict';
import { avalancheHtml, bulletinUrl, fetchRatings, regionDanger } from '../js/avalanche.js';
import { inGeometry, regionFor } from '../scripts/avalanche-regions.mjs';

const ratings = { 'AT-07-14': 3, 'AT-07-14:high': 3, 'AT-07-14:low': 2, 'AT-07-14:am': 3, 'AT-07-14:pm': 3, 'CH-1231': 2, 'CH-1231:high': 2, 'CH-1231:low': 2, 'CH-1231:am': 1, 'CH-1231:pm': 2, AT: 3 };

test('regionDanger: exakte Region, Rückfall auf übergeordnete, nicht bis aufs Land', () => {
  assert.deepEqual(regionDanger(ratings, 'CH-1231'), { level: 2, high: 2, low: 2, am: 1, pm: 2, key: 'CH-1231' });
  assert.equal(regionDanger(ratings, 'AT-07-14-04').key, 'AT-07-14');
  assert.equal(regionDanger(ratings, 'AT-05-06'), null);
  assert.equal(regionDanger(null, 'CH-1231'), null);
});

test('avalancheHtml: Stufe, Höhen- bzw. Tageszeit-Unterschied, fehlender Bericht', () => {
  const h = avalancheHtml('AT-07-14', 'Kalkkögel', [
    { label: 'Heute', date: '2026-11-18', danger: regionDanger(ratings, 'AT-07-14') },
    { label: 'Morgen', date: '2026-11-19', danger: null },
  ]);
  assert.match(h, /3 erheblich/); assert.match(h, /oben 3 · unten 2/); assert.match(h, /kein Bericht/);
  assert.match(h, /avalanche\.report\/bulletin\/2026-11-18\?region=AT-07-14/);
  assert.match(avalancheHtml('CH-1231', 'Kandersteg', [{ label: 'Heute', date: 'x', danger: regionDanger(ratings, 'CH-1231') }]), /vorm\. 1 · nachm\. 2/);
  assert.match(bulletinUrl('FR-16', 'x'), /meteofrance/);
});

test('fetchRatings: lädt einmal je Datum, null bei 404', async () => {
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => ({ maxDangerRatings: { 'CH-1231': 2 } }) }; };
  assert.deepEqual(await fetchRatings('2099-01-01', ok), { 'CH-1231': 2 });
  await fetchRatings('2099-01-01', ok); assert.equal(calls, 1);
  assert.equal(await fetchRatings('2099-01-02', async () => ({ ok: false })), null);
});

test('Punkt-in-Polygon mit Loch und Rückfall auf nächste Region', () => {
  const sq = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];
  const geom = { type: 'Polygon', coordinates: [sq(10, 47, 1), sq(10.4, 47.4, 0.2)] };
  assert.ok(inGeometry(10.1, 47.1, geom)); assert.ok(!inGeometry(10.5, 47.5, geom)); assert.ok(!inGeometry(9, 47, geom));
  const f = [{ properties: { id: 'X-1' }, geometry: geom }];
  assert.equal(regionFor(47.1, 10.1, f).id, 'X-1');
  assert.equal(regionFor(47.02, 9.95, f).id, 'X-1'); // ~4 km daneben
  assert.equal(regionFor(47, 9.5, f), null);
});
