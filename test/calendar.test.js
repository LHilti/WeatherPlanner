import test from 'node:test';
import assert from 'node:assert/strict';
import { clampRange, datesBetween, monthGrid, presets } from '../js/calendar.js';

test('datesBetween: inklusiv, Reihenfolge egal, über Monatsgrenze', () => {
  assert.deepEqual(datesBetween('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(datesBetween('2026-12-02', '2026-11-30'), ['2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(datesBetween('2026-11-21', '2026-11-21'), ['2026-11-21']);
});

test('monthGrid: November 2026 beginnt am Sonntag, Montag zuerst', () => {
  const g = monthGrid(2026, 10);
  assert.deepEqual(g[0], [null, null, null, null, null, null, '2026-11-01']);
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g.flat().filter(Boolean).length, 30);
});

test('presets: nächstes Wochenende ab Mittwoch, langes WE Fr–Mo', () => {
  const p = presets(new Date(2026, 10, 18)); // Mi 18.11.2026
  assert.deepEqual([p[0].from, p[0].to], ['2026-11-21', '2026-11-22']);
  assert.deepEqual([p[1].from, p[1].to], ['2026-11-20', '2026-11-23']);
  assert.deepEqual([p[2].from, p[2].to], ['2026-11-28', '2026-11-29']);
});

test('clampRange: auf Vorhersagefenster begrenzen', () => {
  assert.deepEqual(clampRange({ from: '2026-11-28', to: '2026-12-05' }, '2026-11-16', '2026-12-01'), { from: '2026-11-28', to: '2026-12-01' });
  assert.equal(clampRange({ from: '2026-12-10', to: '2026-12-11' }, '2026-11-16', '2026-12-01'), null);
});
