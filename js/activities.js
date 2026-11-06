// Bewertungslogik: pro Aktivität und Tag ein Score 0–100.
// Alle Funktionen sind rein (keine DOM-/Netzwerk-Zugriffe) und damit testbar.

/** Trapez-Funktion: 0 bis a, steigt bis b, 1 bis c, fällt bis d, danach 0. */
export function ramp(x, [a, b, c, d]) {
  if (x == null || Number.isNaN(x)) return 0;
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}
/** 1 bei x <= good, linear fallend auf 0 bei x >= bad. */
export const falling = (x, good, bad) => (x == null ? 1 : x <= good ? 1 : x >= bad ? 0 : (bad - x) / (bad - good));
/** 0 bei x <= bad, linear steigend auf 1 bei x >= good. */
export const rising = (x, bad, good) => (x == null ? 0 : x >= good ? 1 : x <= bad ? 0 : (x - bad) / (good - bad));

/** Gewichtetes geometrisches Mittel: ein Faktor von 0 (z. B. Dauerregen) macht den Tag unbrauchbar. */
function combine(parts) {
  const active = parts.filter(([, w]) => w > 0);
  if (!active.length) return 0;
  const wSum = active.reduce((s, [, w]) => s + w, 0);
  const log = active.reduce((s, [f, w]) => s + w * Math.log(Math.max(f, 1e-6)), 0);
  return Math.round(100 * Math.exp(log / wSum));
}

/** Auswahl im Gewichtungs-Dropdown (Multiplikator auf das Standardgewicht eines Faktors). */
export const WEIGHT_LEVELS = [
  { value: 0, label: 'Ignorieren' },
  { value: 0.4, label: 'Gering' },
  { value: 1, label: 'Normal' },
  { value: 1.8, label: 'Wichtig' },
  { value: 3, label: 'Sehr wichtig' },
];

/**
 * Tageswerte (`d`):
 *  tMax, tMin (°C), precip (mm), rain (mm), snow (cm), pop (% Regenwahrscheinlichkeit),
 *  wind, gust (km/h), sun (Sonnenstunden), prevPrecip (mm in den 2 Tagen davor), elevation (m)
 *
 * Jede Aktivität besteht aus Faktoren (0–1) mit Standardgewicht `w`; die UI kann jeden Faktor
 * über einen Multiplikator (WEIGHT_LEVELS) stärker, schwächer oder gar nicht einfließen lassen.
 */
const act = (label, icon, hint, factors) => ({
  label, icon, hint, factors,
  scoreDay(d, mults = {}) {
    return combine(factors.map((f) => [f.fn(d), f.w * (mults[f.key] ?? 1)]));
  },
});

export const ACTIVITIES = {
  climbing: act('Klettern', '🧗',
    'Fels muss trocken sein: kaum Niederschlag (auch an den Vortagen), mäßige Temperaturen, wenig Wind.', [
      { key: 'dry', label: 'Trockenheit (Regen heute)', w: 3, fn: (d) => falling(d.precip, 0.2, 3) * (0.6 + 0.4 * falling(d.pop, 20, 70)) },
      { key: 'rock', label: 'Fels trocken (Regen Vortage)', w: 1.5, fn: (d) => 0.6 + 0.4 * falling(d.prevPrecip, 2, 15) },
      { key: 'temp', label: 'Temperatur', w: 1, fn: (d) => 0.3 + 0.7 * ramp(d.tMax, [-2, 8, 24, 34]) },
      { key: 'wind', label: 'Wind / Böen', w: 0.7, fn: (d) => falling(d.gust, 35, 70) },
      { key: 'sun', label: 'Sonne', w: 0.5, fn: (d) => 0.7 + 0.3 * rising(d.sun, 1, 6) },
    ]),
  skiing: act('Skifahren', '⛷️',
    'Höhenlage ab ~1000 m, kalt, Neuschnee, wenig Regen und Wind, möglichst Sonne.', [
      { key: 'elev', label: 'Höhenlage', w: 3, fn: (d) => rising(d.elevation, 600, 1500) },
      { key: 'cold', label: 'Kälte', w: 2, fn: (d) => ramp(d.tMax, [-Infinity, -Infinity, 1, 7]) },
      { key: 'snow', label: 'Neuschnee', w: 1.5, fn: (d) => 0.35 + 0.65 * rising(d.snow, 0, 15) },
      { key: 'rain', label: 'Kein Regen', w: 1.5, fn: (d) => falling(d.rain, 0.5, 6) },
      { key: 'wind', label: 'Wind / Böen', w: 0.8, fn: (d) => falling(d.gust, 40, 80) },
      { key: 'sun', label: 'Sonne', w: 0.8, fn: (d) => 0.6 + 0.4 * rising(d.sun, 1, 6) },
    ]),
  mtb: act('Mountainbiken', '🚵',
    'Möglichst kein Regen, Trails nicht aufgeweicht (Vortage!), angenehme Temperatur.', [
      { key: 'dry', label: 'Trockenheit (Regen heute)', w: 2.5, fn: (d) => falling(d.precip, 0.5, 6) * (0.7 + 0.3 * falling(d.pop, 30, 80)) },
      { key: 'trail', label: 'Trail-Zustand (Regen Vortage)', w: 1.5, fn: (d) => 0.5 + 0.5 * falling(d.prevPrecip, 3, 25) },
      { key: 'temp', label: 'Temperatur', w: 1.2, fn: (d) => ramp(d.tMax, [0, 9, 25, 34]) },
      { key: 'wind', label: 'Wind / Böen', w: 0.6, fn: (d) => falling(d.gust, 40, 80) },
      { key: 'sun', label: 'Sonne', w: 0.4, fn: (d) => 0.8 + 0.2 * rising(d.sun, 1, 6) },
    ]),
  hiking: act('Wandern', '🥾',
    'Trocken oder nur wenig Regen, nicht zu heiß, Sonne und Fernsicht sind ein Plus.', [
      { key: 'dry', label: 'Trockenheit', w: 2.5, fn: (d) => falling(d.precip, 1, 8) * (0.7 + 0.3 * falling(d.pop, 30, 80)) },
      { key: 'temp', label: 'Temperatur', w: 1.5, fn: (d) => ramp(d.tMax, [-2, 8, 22, 32]) },
      { key: 'wind', label: 'Wind / Böen', w: 0.8, fn: (d) => falling(d.gust, 35, 75) },
      { key: 'sun', label: 'Sonne', w: 1, fn: (d) => 0.6 + 0.4 * rising(d.sun, 1, 7) },
    ]),
  swimming: act('Baden / Seen', '🏊',
    'Warm (ab ~24 °C), sonnig, trocken und windarm.', [
      { key: 'temp', label: 'Wärme', w: 3, fn: (d) => ramp(d.tMax, [16, 25, 36, 45]) },
      { key: 'sun', label: 'Sonne', w: 1.5, fn: (d) => rising(d.sun, 2, 8) },
      { key: 'dry', label: 'Trockenheit', w: 1.5, fn: (d) => falling(d.precip, 0.5, 5) },
      { key: 'wind', label: 'Wind / Böen', w: 0.7, fn: (d) => falling(d.gust, 30, 60) },
    ]),
};

/**
 * Gesamtscore über mehrere Tage: Mittelwert, aber der schlechteste Tag zieht mit runter.
 * @param {string} activityKey
 * @param {object[]} days  Tageswerte (siehe oben)
 * @param {Object<string,number>} [mults]  Gewichts-Multiplikatoren je Faktor-Key
 */
export function scoreSite(activityKey, days, mults = {}) {
  const a = ACTIVITIES[activityKey];
  const dayScores = days.map((d) => a.scoreDay(d, mults));
  const mean = dayScores.reduce((x, y) => x + y, 0) / dayScores.length;
  const min = Math.min(...dayScores);
  return { score: Math.round(0.7 * mean + 0.3 * min), dayScores };
}
