import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { areaOf, buildSpots, inRanges, parseCsv, splitGlued } from '../scripts/import-tours.mjs';

const cfg = {
  areas: { Wettersteingebirge: [47.42, 11.1], 'Sarcatal (Arco)': [45.97, 10.93], 'Mont-Blanc-Gruppe': [45.88, 6.93] },
  aliases: { Wetterstein: 'Wettersteingebirge' },
  prefixAliases: { Sarcatal: 'Sarcatal (Arco)' },
  byNumber: { 'Im extremen Fels': { '5-15,102': 'Mont-Blanc-Gruppe' } },
};

test('parseCsv: BOM, CRLF, Anführungszeichen und ; im Feld', () => {
  const rows = parseCsv('\uFEFFSerie;Nr;Tour\r\n"A";"1";"Wolfebnerspitze ""Baderführe"""\r\n"B";"2";"x; y"\r\n');
  assert.deepEqual(rows, [{ Serie: 'A', Nr: '1', Tour: 'Wolfebnerspitze "Baderführe"' }, { Serie: 'B', Nr: '2', Tour: 'x; y' }]);
});

test('inRanges / areaOf: Alias, Präfix, Nummernbereich', () => {
  assert.ok(inRanges('1-4,101', '3')); assert.ok(inRanges('1-4,101', '101')); assert.ok(!inRanges('1-4,101', '5'));
  assert.ok(inRanges('99-100', '99a'));
  assert.equal(areaOf({ Gebiet: 'Wetterstein' }, cfg), 'Wettersteingebirge');
  assert.equal(areaOf({ Gebiet: 'Sarcatal / Monte Brento' }, cfg), 'Sarcatal (Arco)');
  assert.equal(areaOf({ Gebiet: '', Serie: 'Im extremen Fels', Nr: '10' }, cfg), 'Mont-Blanc-Gruppe');
  assert.equal(areaOf({ Gebiet: 'Unbekannt' }, cfg), null);
});

test('splitGlued trennt Routenname und Berg', () => {
  assert.equal(splitGlued('MärmelibahnEiger'), 'Märmelibahn – Eiger');
  assert.equal(splitGlued('HaZo FantasticaSonneck'), 'HaZo Fantastica – Sonneck');
  assert.equal(splitGlued('Freier als Paul PreußGroßer Bratschenkopf'), 'Freier als Paul Preuß – Großer Bratschenkopf');
});

test('buildSpots: bündelt je Gebiet, Klettersteige getrennt', () => {
  const { spots, unmatched } = buildSpots([
    { Serie: 'Alpin Nordalpen', Nr: '1', Tour: 'Zwölferkante', Gebiet: 'Wettersteingebirge', Schwierigkeit: '4', Gipfel: '' },
    { Serie: 'Im extremen Fels', Nr: '38', Tour: 'X', Gebiet: 'Wetterstein', Schwierigkeit: '', Bewertung_Buch: 'VI', Gipfel: '' },
    { Serie: 'Klettersteige', Nr: '5', Tour: 'Steig', Gebiet: 'Wettersteingebirge', Schwierigkeit: 'Schwierig', Gipfel: 'Alpspitze' },
    { Serie: 'Longlines', Nr: '9', Tour: 'Y', Gebiet: 'Nirgendwo', Schwierigkeit: '' },
  ], cfg);
  assert.equal(spots.length, 2); assert.equal(unmatched.length, 1);
  assert.equal(spots[0].tours.length, 2); assert.deepEqual(spots[0].d, ['alpine']);
  assert.equal(spots[0].tours[1].g, 'VI');
  assert.deepEqual(spots[1].d, ['ferrata']); assert.equal(spots[1].tours[0].p, 'Alpspitze');
});

test('echte Daten: alle Touren der CSV sind einem Gebiet zugeordnet', async () => {
  const src = new URL('../data/sources/', import.meta.url);
  const rows = parseCsv(await readFile(new URL('klettertouren.csv', src), 'utf8'));
  const { spots, unmatched } = buildSpots(rows, JSON.parse(await readFile(new URL('tour-areas.json', src), 'utf8')));
  assert.equal(rows.length, 585);
  assert.deepEqual(unmatched, []);
  assert.equal(spots.reduce((n, s) => n + s.tours.length, 0), 585);
});
