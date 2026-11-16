// Heatmap: Werte auf dem Wetter-Raster → Farbfläche (Canvas als Bild-Overlay), Interpolation, Farbskalen.
// Rein rechnende Teile sind ohne DOM nutzbar (Tests).

/**
 * Index über ein reguläres Raster (Punkte liegen auf Vielfachen von step/lonStep, siehe gridForBounds).
 * values: Array gleicher Länge wie sites (Zahl oder null).
 */
export function gridIndex(sites, values, step, lonStep) {
  const cells = new Map();
  let i0 = Infinity; let i1 = -Infinity; let j0 = Infinity; let j1 = -Infinity;
  sites.forEach((s, k) => {
    const i = Math.round(s.lat / step); const j = Math.round(s.lon / lonStep);
    cells.set(`${i},${j}`, values[k]);
    i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
  });
  return { cells, step, lonStep, i0, i1, j0, j1 };
}

/** Bilinear interpolierter Wert an (lat, lon); null außerhalb oder ohne Daten. Fehlende Ecken werden ausgelassen. */
export function sample(idx, lat, lon) {
  const fi = lat / idx.step; const fj = lon / idx.lonStep;
  const i = Math.floor(fi); const j = Math.floor(fj);
  const di = fi - i; const dj = fj - j;
  let sum = 0; let wsum = 0;
  for (const [ii, jj, w] of [[i, j, (1 - di) * (1 - dj)], [i + 1, j, di * (1 - dj)], [i, j + 1, (1 - di) * dj], [i + 1, j + 1, di * dj]]) {
    const v = idx.cells.get(`${ii},${jj}`);
    if (v != null && w > 0) { sum += v * w; wsum += w; }
  }
  if (wsum < 1e-9) { const v = idx.cells.get(`${Math.round(fi)},${Math.round(fj)}`); return v ?? null; } // Randzone: nächster Punkt
  return sum / wsum;
}

// ---------- Farbskalen ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Farbe für t ∈ [0,1] aus Stützstellen [[pos, '#rrggbb'], …]. */
export function colorAt(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let k = 1; k < stops.length; k++) {
    const [p1, c1] = stops[k];
    if (t <= p1) {
      const [p0, c0] = stops[k - 1];
      const u = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      const a = hex(c0); const b = hex(c1);
      return a.map((v, n) => Math.round(v + (b[n] - v) * u));
    }
  }
  return hex(stops[stops.length - 1][1]);
}
const css = (rgb) => `rgb(${rgb.join(',')})`;

/** Farbskalen für den Score (0 = schlecht … 100 = gut). */
export const SCORE_PALETTES = {
  blueRed: { label: 'Blau → Rot (nass/schlecht → gut)', stops: [[0, '#1e4e9c'], [0.25, '#4f9bd9'], [0.5, '#f4e27c'], [0.75, '#f39a3b'], [1, '#c81e1e']] },
  traffic: { label: 'Ampel (rot → gelb → grün)', stops: [[0, '#c62828'], [0.5, '#f2d43c'], [1, '#2e9d43']] },
  viridis: { label: 'Viridis (farbenblind-freundlich)', stops: [[0, '#440154'], [0.25, '#3b528b'], [0.5, '#21918c'], [0.75, '#5ec962'], [1, '#fde725']] },
};

/**
 * Darstellbare Layer. value(days) bekommt die Tageswerte der gewählten Tage eines Rasterpunkts.
 * Score-Layer wird in app.js gesetzt (hängt von Aktivität/Filter ab).
 */
export const LAYERS = {
  score: { label: 'Aktivitäts-Score', unit: '/100', min: 0, max: 100 },
  tmax: { label: 'Höchsttemperatur (Ø)', unit: '°C', min: -15, max: 35,
    stops: [[0, '#2b3a8f'], [0.3, '#5aa0e0'], [0.45, '#e9f2f7'], [0.6, '#f6d36b'], [0.8, '#ef7d2f'], [1, '#b2182b']],
    value: (days) => avg(days.map((d) => d.tMax)) },
  precip: { label: 'Niederschlag (Summe)', unit: 'mm', min: 0, max: 30,
    stops: [[0, '#f7fbff'], [0.15, '#c6dbef'], [0.4, '#6baed6'], [0.7, '#2171b5'], [1, '#08306b']],
    value: (days) => days.reduce((s, d) => s + d.precip, 0) },
  sun: { label: 'Sonnenstunden (Ø pro Tag)', unit: 'h', min: 0, max: 10,
    stops: [[0, '#6b6b7a'], [0.4, '#b9b38a'], [0.7, '#f5d33f'], [1, '#ff9f1c']],
    value: (days) => avg(days.map((d) => d.sun)) },
  gust: { label: 'Windböen (Maximum)', unit: 'km/h', min: 0, max: 100,
    stops: [[0, '#f2f0f7'], [0.35, '#bcbddc'], [0.65, '#807dba'], [1, '#3f007d']],
    value: (days) => Math.max(...days.map((d) => d.gust ?? 0)) },
  snow: { label: 'Neuschnee (Summe)', unit: 'cm', min: 0, max: 50,
    stops: [[0, '#f4f9fb'], [0.2, '#bfe3f0'], [0.55, '#55b1d8'], [1, '#155a8a']],
    value: (days) => days.reduce((s, d) => s + d.snow, 0) },
};
function avg(a) { return a.reduce((s, v) => s + v, 0) / a.length; }

/**
 * Zeichnet das Raster als Canvas mit eigener bilinearer Interpolation (mehrere Pixel je Rasterzelle)
 * → weiche Farbfläche unabhängig vom Browser. Liefert { url, bounds } für L.imageOverlay oder null.
 * hide(v) → true: Pixel transparent (z. B. unter dem Mindest-Score).
 */
export function renderHeat(idx, { stops, min, max }, hide = () => false, opacity = 1, targetPx = 480) {
  if (!Number.isFinite(idx.i0)) return null;
  const cols = idx.j1 - idx.j0 + 1; const rows = idx.i1 - idx.i0 + 1;
  const k = Math.max(1, Math.min(32, Math.ceil(targetPx / Math.max(cols, rows))));
  const w = cols * k; const h = rows * k;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); const img = ctx.createImageData(w, h);
  const south = (idx.i0 - 0.5) * idx.step; const west = (idx.j0 - 0.5) * idx.lonStep;
  for (let y = 0; y < h; y++) {
    const lat = south + ((h - y - 0.5) / k) * idx.step;
    for (let x = 0; x < w; x++) {
      const v = sample(idx, lat, west + ((x + 0.5) / k) * idx.lonStep);
      if (v == null || hide(v)) continue; // transparent
      const [r, g, b] = colorAt(stops, (v - min) / (max - min));
      const p = (y * w + x) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = Math.round(255 * opacity);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), bounds: [[south, west], [(idx.i1 + 0.5) * idx.step, (idx.j1 + 0.5) * idx.lonStep]] };
}

/** CSS-Verlauf für die Legende. */
export const gradientCss = (stops) => `linear-gradient(90deg, ${stops.map(([p, c]) => `${c} ${Math.round(p * 100)}%`).join(', ')})`;
export const colorCss = (stops, t) => css(colorAt(stops, t));
