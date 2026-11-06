import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePages } from '../scripts/scrape-spots.mjs';

test('parsePages: übernimmt Seiten mit Koordinaten, ignoriert Listen und Seiten ohne Koordinaten', () => {
  const json = { query: { pages: {
    1: { title: 'Ischgl', coordinates: [{ lat: 47.01305556, lon: 10.28805556 }] },
    2: { title: 'Hochrindl' },
    3: { title: 'List of ski resorts in the German Alps' },
    4: { title: 'Far away', coordinates: [{ lat: 40, lon: -100 }] },
  } } };
  assert.deepEqual(parsePages(json, 'ski'), [{ n: 'Ischgl', lat: 47.0131, lon: 10.2881, t: 'ski', w: 'Ischgl' }]);
  assert.deepEqual(parsePages({ batchcomplete: '' }, 'mtb'), []);
});
