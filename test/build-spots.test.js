import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dedupeAgainstMp, dedupeMirrors, dedupeOsm, mergeSamePosition, mpCrags, sameName } from '../scripts/build-spots.mjs';
import { parseCsv } from '../scripts/import-tours.mjs';

const row = (o) => ({ ID: '1', Name: '', 'Pfad (Region)': '', Ebene: '1', Typ: 'Gebiet', Breitengrad: '47', 'Längengrad': '11',
  'Routen gesamt': '0', Trad: '0', Sport: '0', Toprope: '0', Boulder: '0', 'Eis/Mixed': '0', 'MP-Subtyp': '', 'Grad-Spanne Seil': '', 'Grad-Spanne Boulder': '', ...o });

test('mpCrags: Gebiet mit nur Sektoren wird ein Pin, Regionen nie, Sektor direkt unter Region schon', () => {
  const rows = [
    row({ ID: '1', Name: 'Tirol', 'Pfad (Region)': 'Austria', Ebene: '1', 'Routen gesamt': '60' }),
    row({ ID: '2', Name: 'Martinswand', 'Pfad (Region)': 'Austria > Tirol', Ebene: '2', 'Routen gesamt': '50', Sport: '50', Breitengrad: '47.27', 'Längengrad': '11.31' }),
    row({ ID: '3', Name: 'Sektor A', 'Pfad (Region)': 'Austria > Tirol > Martinswand', Ebene: '3', Typ: 'Sektor/Fels', 'Routen gesamt': '30' }),
    row({ ID: '4', Name: 'Sektor B', 'Pfad (Region)': 'Austria > Tirol > Martinswand', Ebene: '3', Typ: 'Sektor/Fels', 'Routen gesamt': '20' }),
    row({ ID: '5', Name: 'Einzelfels', 'Pfad (Region)': 'Austria > Tirol', Ebene: '2', Typ: 'Sektor/Fels', 'Routen gesamt': '10', Trad: '10' }),
    row({ ID: '6', Name: 'Leer', 'Pfad (Region)': 'Austria > Tirol', Ebene: '2', Typ: 'Sektor/Fels', 'Routen gesamt': '0' }),
  ];
  const c = mpCrags(rows).sort((a, b) => a.n.localeCompare(b.n));
  assert.deepEqual(c.map((x) => [x.n, x.r, x.d]), [['Einzelfels', 10, ['trad']], ['Martinswand', 50, ['sport']]]);
});

test('mergeSamePosition: gleiche Koordinaten → ein Pin mit Summe', () => {
  const m = mergeSamePosition([
    { n: 'A', lat: 47.1, lon: 11.1, t: 'climb', r: 5, mp: '1' },
    { n: 'B', lat: 47.1, lon: 11.1, t: 'climb', r: 7, mp: '2', d: ['sport'] },
    { n: 'C', lat: 48, lon: 11, t: 'climb', r: 1, mp: '3' },
  ]);
  assert.equal(m.length, 2);
  assert.equal(m[0].n, 'B / A'); assert.equal(m[0].r, 12); assert.equal(m[0].sub.length, 2);
});

test('sameName: Alias, Akzente, markante Wörter', () => {
  assert.ok(sameName('Céüse', 'Ceuse'));
  assert.ok(sameName('Verdon Gorge', 'Gorge du Verdon'));
  assert.ok(sameName('Frankenjura (Pottenstein)', 'Frankenjura'));
  assert.ok(!sameName('Hohe Wand', 'Hohe Munde'));
  assert.ok(sameName('Hohe Wand (mountain)', 'Hohe Wand'));
  assert.ok(sameName('Arco', 'Arco and Surrounding Area'));
});

test('dedupeAgainstMp: Dublette fällt weg, Wikipedia-Link wandert zum MP-Pin; Tourenlisten bleiben', () => {
  const mpSpots = [{ n: 'Buoux', lat: 43.83, lon: 5.37, t: 'climb', r: 300 }];
  const { kept, dropped } = dedupeAgainstMp([
    { n: 'Buoux', lat: 43.8319, lon: 5.3783, t: 'climb', w: 'Buoux' },
    { n: 'Sarcatal (Arco)', lat: 45.97, lon: 10.93, t: 'climb', tours: [{}] },
    { n: 'Kitzbühel', lat: 47.4, lon: 12.4, t: 'ski' },
  ], [{ n: 'Buoux', lat: 43.83, lon: 5.37 }], mpSpots);
  assert.equal(dropped.length, 1); assert.equal(kept.length, 2); assert.equal(mpSpots[0].w, 'Buoux');
});

test('dedupeOsm: OSM-Fels < 1 km neben MP-Crag fällt weg', () => {
  const out = dedupeOsm([{ n: 'x', lat: 47.001, lon: 11.001, t: 'climb' }, { n: 'y', lat: 47.2, lon: 11, t: 'climb' }],
    [{ n: 'm', lat: 47, lon: 11, t: 'climb' }]);
  assert.deepEqual(out.map((o) => o.n), ['y']);
});

test('echte MP-Daten: Felsebene liefert sinnvolle Anzahl, keine Regionen-Pins', async () => {
  const rows = parseCsv(await readFile(new URL('../data/sources/mountainproject-europa.csv', import.meta.url), 'utf8'));
  const crags = mpCrags(rows);
  assert.ok(crags.length > 1500 && crags.length < 4000, `n=${crags.length}`);
  assert.ok(!crags.some((c) => ['Frankenjura', 'Tirol', 'Germany'].includes(c.n)));
  assert.ok(crags.filter((c) => c.d?.includes('ferrata')).every((c) => /ferrata|klettersteig|\bVF\b/i.test(c.n)));
  assert.ok(crags.every((c) => c.r > 0 && Number.isFinite(c.lat) && Number.isFinite(c.lon)));
});

test('dedupeMirrors: gleichnamiger Eis-Spiegelordner < 1 km fällt weg', () => {
  const out = dedupeMirrors([
    { n: 'Index', lat: 45.9688, lon: 6.8726, r: 3, region: 'France > .Snow, Ice and Mixed > Mont Blanc Range', d: ['alpine'] },
    { n: 'Index', lat: 45.9731, lon: 6.8737, r: 5, region: 'France > 04 Northern Alps > Chamonix', d: ['sport'] },
    { n: 'Index', lat: 46.5, lon: 7, r: 2, region: 'Switzerland' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].d.sort(), ['alpine', 'sport']); assert.match(out[0].region, /Chamonix/);
});

test('dedupeAgainstMp: Region gleichen Namens ohne nahen Pin führt nicht zusammen; Attribute nur bis 3 km', () => {
  const mpSpots = [{ n: 'Sobrio', lat: 46.40, lon: 8.95, t: 'climb', r: 10 }];
  const nodes = [{ n: 'Ticino', lat: 46.3, lon: 8.9 }, { n: 'Sobrio', lat: 46.40, lon: 8.95 }];
  const a = dedupeAgainstMp([{ n: 'Ticino (Chironico)', lat: 46.43, lon: 8.87, t: 'climb', d: ['boulder'] }], nodes, mpSpots);
  assert.equal(a.kept.length, 0); // Sobrio ~7 km entfernt → abgedeckt
  assert.equal(mpSpots[0].d, undefined); // aber > 3 km → keine Übernahme der Disziplin
  const b = dedupeAgainstMp([{ n: 'Ticino (Chironico)', lat: 46.6, lon: 8.6, t: 'climb' }], nodes, mpSpots);
  assert.equal(b.kept.length, 1); // kein MP-Pin in 8 km → bleibt
});

test('echte MP-Daten: keine Bundesland-Sammelpins für Klettersteige', async () => {
  const rows = parseCsv(await readFile(new URL('../data/sources/mountainproject-europa.csv', import.meta.url), 'utf8'));
  const c = mpCrags(rows);
  assert.ok(!c.some((x) => /\* Via Ferrata$/.test(x.region) && /Steiermark|Tirol|Kärnten|Salzburg/.test(x.n)));
});
