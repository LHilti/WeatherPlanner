import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYERS, SCORE_PALETTES, colorAt, gridIndex, sample } from '../js/heat.js';

const sites = [{ lat: 47, lon: 10.5 }, { lat: 47, lon: 11.25 }, { lat: 47.5, lon: 10.5 }, { lat: 47.5, lon: 11.25 }];

test('gridIndex + sample: bilinear zwischen vier Rasterpunkten', () => {
  const idx = gridIndex(sites, [0, 100, 0, 100], 0.5, 0.75);
  assert.equal(sample(idx, 47, 10.5), 0);
  assert.equal(sample(idx, 47.5, 11.25), 100);
  assert.ok(Math.abs(sample(idx, 47.25, 10.875) - 50) < 1e-6);
});

test('sample: fehlende Ecke wird ausgelassen, außerhalb → null', () => {
  const idx = gridIndex(sites, [0, null, 0, 100], 0.5, 0.75);
  const v = sample(idx, 47.25, 10.875);
  assert.ok(v > 0 && v < 100);
  assert.equal(sample(idx, 40, 5), null);
});

test('colorAt: Endpunkte und Mitte der Blau-Rot-Skala', () => {
  const st = SCORE_PALETTES.blueRed.stops;
  assert.deepEqual(colorAt(st, 0), [0x1e, 0x4e, 0x9c]);
  assert.deepEqual(colorAt(st, 1), [0xc8, 0x1e, 0x1e]);
  assert.deepEqual(colorAt(st, 0.5), [0xf4, 0xe2, 0x7c]);
  assert.deepEqual(colorAt(st, 2), colorAt(st, 1)); // geklemmt
});

test('LAYERS: Wettergrößen über mehrere Tage', () => {
  const days = [{ tMax: 10, precip: 2, sun: 4, gust: 30, snow: 0 }, { tMax: 20, precip: 3, sun: 8, gust: 50, snow: 5 }];
  assert.equal(LAYERS.tmax.value(days), 15);
  assert.equal(LAYERS.precip.value(days), 5);
  assert.equal(LAYERS.sun.value(days), 6);
  assert.equal(LAYERS.gust.value(days), 50);
  assert.equal(LAYERS.snow.value(days), 5);
});
