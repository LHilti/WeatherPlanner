import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITIES, scoreSite } from '../js/activities.js';
import { estimateDrive, formatDrive, gridForBounds } from '../js/geo.js';
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

test('gridForBounds: Punkte im Ausschnitt, auf festem Raster, begrenzt', () => {
  const b = { south: 46.3, west: 9.1, north: 49.2, east: 14.4 };
  const { points, step, lonStep } = gridForBounds(b, 100);
  assert.ok(points.length > 20 && points.length <= 100, `n=${points.length}`);
  assert.ok(points.every((p) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east));
  assert.ok(points.every((p) => Math.abs(p.lat / step - Math.round(p.lat / step)) < 1e-6));
  // Verschobener Ausschnitt teilt sich Punkte mit dem alten (Cache-Wiederverwendung)
  const moved = gridForBounds({ ...b, west: 9.6, east: 14.9 }, 100);
  assert.equal(moved.step, step); assert.equal(moved.lonStep, lonStep);
  const keys = new Set(points.map((p) => `${p.lat},${p.lon}`));
  assert.ok(moved.points.filter((p) => keys.has(`${p.lat},${p.lon}`)).length > points.length / 2);
  // Weit herausgezoomt: gröberes Raster statt mehr Punkte
  assert.ok(gridForBounds({ south: 35, west: -10, north: 70, east: 40 }, 100).points.length <= 100);
});

test('estimateDrive / formatDrive: München → Innsbruck grob plausibel', () => {
  const d = estimateDrive({ lat: 48.137, lon: 11.575 }, { lat: 47.269, lon: 11.404 });
  assert.ok(d.km > 110 && d.km < 150, `km=${d.km}`);
  assert.ok(d.min > 80 && d.min < 130, `min=${d.min}`);
  assert.equal(formatDrive({ km: 187.4, min: 133 }), '2 h 15 min · 187 km');
  assert.equal(formatDrive({ km: 30, min: 28 }), '30 min · 30 km');
});

test('selectedDates: Wochenende ± Fr/Mo', () => {
  const wed = new Date(2026, 10, 4); // Mi 4.11.2026
  assert.deepEqual(selectedDates({ today: wed }).map(isoDate), ['2026-11-07', '2026-11-08']);
  assert.deepEqual(selectedDates({ today: wed, friday: true, monday: true }).map(isoDate),
    ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
});

test('Gewichtung: Faktor auf "Ignorieren" blendet Regen aus, höhere Gewichtung verschärft ihn', () => {
  const wet = { ...base, precip: 6, pop: 90 };
  const normal = ACTIVITIES.climbing.scoreDay(wet);
  assert.ok(ACTIVITIES.climbing.scoreDay(wet, { dry: 0 }) > normal);
  assert.ok(ACTIVITIES.climbing.scoreDay(wet, { dry: 3 }) <= normal);
  assert.equal(ACTIVITIES.climbing.scoreDay(wet, { dry: 0, rock: 0, temp: 0, wind: 0, sun: 0 }), 0);
});
