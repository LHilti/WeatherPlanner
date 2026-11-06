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
  const wSum = parts.reduce((s, [, w]) => s + w, 0);
  const log = parts.reduce((s, [f, w]) => s + w * Math.log(Math.max(f, 1e-6)), 0);
  return Math.round(100 * Math.exp(log / wSum));
}

/**
 * Tageswerte (`day`):
 *  tMax, tMin (°C), precip (mm), rain (mm), snow (cm), pop (% Regenwahrscheinlichkeit),
 *  wind, gust (km/h), sun (Sonnenstunden), prevPrecip (mm in den 2 Tagen davor), elevation (m)
 */
export const ACTIVITIES = {
  climbing: {
    label: 'Klettern',
    icon: '🧗',
    hint: 'Fels muss trocken sein: kaum Niederschlag (auch an den Vortagen), mäßige Temperaturen, wenig Wind.',
    scoreDay(d) {
      const dry = falling(d.precip, 0.2, 3) * (0.6 + 0.4 * falling(d.pop, 20, 70));
      const rockDry = 0.6 + 0.4 * falling(d.prevPrecip, 2, 15);
      return combine([
        [dry, 3],
        [rockDry, 1.5],
        [0.3 + 0.7 * ramp(d.tMax, [-2, 8, 24, 34]), 1],
        [falling(d.gust, 35, 70), 0.7],
        [0.7 + 0.3 * rising(d.sun, 1, 6), 0.5],
      ]);
    },
  },
  skiing: {
    label: 'Skifahren',
    icon: '⛷️',
    hint: 'Höhenlage ab ~1000 m, kalt, Neuschnee, wenig Regen und Wind, möglichst Sonne.',
    scoreDay(d) {
      const snowFun = 0.35 + 0.4 * rising(d.snow, 0, 15) + 0.25 * rising(d.sun, 1, 6);
      return combine([
        [rising(d.elevation, 600, 1500), 3],
        [ramp(d.tMax, [-Infinity, -Infinity, 1, 7]), 2],
        [falling(d.rain, 0.5, 6), 1.5],
        [falling(d.gust, 40, 80), 0.8],
        [snowFun, 1.5],
      ]);
    },
  },
  mtb: {
    label: 'Mountainbiken',
    icon: '🚵',
    hint: 'Möglichst kein Regen, Trails nicht aufgeweicht (Vortage!), angenehme Temperatur.',
    scoreDay(d) {
      const dry = falling(d.precip, 0.5, 6) * (0.7 + 0.3 * falling(d.pop, 30, 80));
      return combine([
        [dry, 2.5],
        [0.5 + 0.5 * falling(d.prevPrecip, 3, 25), 1.5],
        [ramp(d.tMax, [0, 9, 25, 34]), 1.2],
        [falling(d.gust, 40, 80), 0.6],
        [0.8 + 0.2 * rising(d.sun, 1, 6), 0.4],
      ]);
    },
  },
  hiking: {
    label: 'Wandern',
    icon: '🥾',
    hint: 'Trocken oder nur wenig Regen, nicht zu heiß, Sonne und Fernsicht sind ein Plus.',
    scoreDay(d) {
      return combine([
        [falling(d.precip, 1, 8) * (0.7 + 0.3 * falling(d.pop, 30, 80)), 2.5],
        [ramp(d.tMax, [-2, 8, 22, 32]), 1.5],
        [falling(d.gust, 35, 75), 0.8],
        [0.6 + 0.4 * rising(d.sun, 1, 7), 1],
      ]);
    },
  },
  swimming: {
    label: 'Baden / Seen',
    icon: '🏊',
    hint: 'Warm (ab ~24 °C), sonnig, trocken und windarm.',
    scoreDay(d) {
      return combine([
        [ramp(d.tMax, [16, 25, 36, 45]), 3],
        [rising(d.sun, 2, 8), 1.5],
        [falling(d.precip, 0.5, 5), 1.5],
        [falling(d.gust, 30, 60), 0.7],
      ]);
    },
  },
};

/**
 * Gesamtscore über mehrere Tage: Mittelwert, aber der schlechteste Tag zieht mit runter.
 * @param {string} activityKey
 * @param {object[]} days  Tageswerte (siehe oben)
 * @returns {{score:number, dayScores:number[]}}
 */
export function scoreSite(activityKey, days) {
  const act = ACTIVITIES[activityKey];
  const dayScores = days.map((d) => act.scoreDay(d));
  const mean = dayScores.reduce((a, b) => a + b, 0) / dayScores.length;
  const min = Math.min(...dayScores);
  return { score: Math.round(0.7 * mean + 0.3 * min), dayScores };
}
