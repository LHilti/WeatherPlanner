import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITIES, scoreSite } from '../js/activities.js';
import { buildGrid, haversineKm } from '../js/geo.js';
import { selectedDates, isoDate } from '../js/weather.js';

const base = { tMax: 18, tMin: 8, precip: 0, rain: 0, snow: 0, pop: 5, wind: 10, gust: 20, sun: 8, prevPrecip: 0, elevation: 500 };

test('Klettern: trocken schlägt nass', () => {
  const dry = ACTIVITIES.climbing.scoreDay(base);
  const wet = ACTIVITIES.climbing.scoreDay({ ...base, precip: 8, pop: 90 });
  assert.ok(dry > 80, `dry=${dry}`);
  assert.ok(wet < 15, `wet=${wet}`);
});

test('Klettern: nasser Vortag drückt den Score', () => {
  assert.ok(ACTIVITIES.climbing.scoreDay({ ...base, prevPrecip: 20 }) < ACTIVITIES.climbing.scoreDay(base));
});

test('Skifahren: Neuschnee in der Höhe ist top, Tal ohne Schnee nicht', () => {
  const alpine = { ...base, elevation: 2000, tMax: -3, tMin: -9, snow: 20 };
  assert.ok(ACTIVITIES.skiing.scoreDay(alpine) > 80);
  assert.ok(ACTIVITIES.skiing.scoreDay({ ...alpine, elevation: 300, snow: 0, tMax: 12 }) < 5);
});

test('Mountainbiken: Regen an den Vortagen schadet', () => {
  assert.ok(ACTIVITIES.mtb.scoreDay({ ...base, prevPrecip: 30 }) < ACTIVITIES.mtb.scoreDay(base));
});

test('Baden: heiß und sonnig gut, kalt schlecht', () => {
  assert.ok(ACTIVITIES.swimming.scoreDay({ ...base, tMax: 31 }) > 80);
  assert.ok(ACTIVITIES.swimming.scoreDay({ ...base, tMax: 12 }) < 5);
});

test('scoreSite: schlechtester Tag zieht den Gesamtscore runter', () => {
  const good = scoreSite('climbing', [base, base]).score;
  const mixed = scoreSite('climbing', [base, { ...base, precip: 10, pop: 95 }]).score;
  assert.ok(mixed < good - 30);
});

test('buildGrid: Punkte liegen im Radius', () => {
  const pts = buildGrid(48, 11, 200, 40);
  assert.ok(pts.length > 20);
  assert.ok(pts.every((p) => haversineKm(48, 11, p.lat, p.lon) <= 200.001));
});

test('selectedDates: Wochenende ± Fr/Mo', () => {
  const wed = new Date(2026, 10, 4); // Mi 4.11.2026
  assert.deepEqual(selectedDates({ today: wed }).map(isoDate), ['2026-11-07', '2026-11-08']);
  assert.deepEqual(selectedDates({ today: wed, friday: true, monday: true }).map(isoDate),
    ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
});
