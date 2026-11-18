// Lawinenlage (EAWS): höchste Gefahrenstufe je Mikroregion aus den täglichen „ratings“ aller
// europäischen Lawinenwarndienste. Quelle: https://static.avalanche.report/eaws_bulletins/ (CC BY 4.0)

export const LEVELS = {
  1: { label: 'gering', color: '#ccff66' },
  2: { label: 'mäßig', color: '#ffff00' },
  3: { label: 'erheblich', color: '#ff9900' },
  4: { label: 'groß', color: '#ff0000' },
  5: { label: 'sehr groß', color: '#a00000' },
};

const cache = new Map();
/** Gefahrenstufen aller Regionen für ein Datum (ISO); null, wenn (noch) nichts veröffentlicht ist. */
export function fetchRatings(date, fetchFn = fetch) {
  if (!cache.has(date)) {
    cache.set(date, fetchFn(`https://static.avalanche.report/eaws_bulletins/${date}/${date}.ratings.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.maxDangerRatings ?? null)
      .catch(() => { cache.delete(date); return null; }));
  }
  return cache.get(date);
}

/**
 * Stufe einer Region aus den ratings: max, getrennt nach Höhe (high/low) und Tageszeit (am/pm), falls abweichend.
 * Untergeordnete Regions-IDs fallen auf die übergeordnete zurück (z. B. AT-07-14-04 → AT-07-14).
 */
export function regionDanger(ratings, id) {
  if (!ratings || !id) return null;
  let key = id;
  while (key && ratings[key] == null) key = key.includes('-') ? key.slice(0, key.lastIndexOf('-')) : '';
  if (!key || key.split('-').length < 2) return null; // nicht bis auf Land/Provider hochgehen
  const v = (s) => ratings[`${key}${s}`] ?? null;
  return { level: v(''), high: v(':high'), low: v(':low'), am: v(':am'), pm: v(':pm'), key };
}

/** Link zum Lagebericht des zuständigen Warndienstes. */
export function bulletinUrl(id, date) {
  if (/^(AT-07|IT-32-BZ|IT-32-TN)/.test(id)) return `https://avalanche.report/bulletin/${date}?region=${id}`;
  if (id.startsWith('CH')) return 'https://www.slf.ch/de/lawinenbulletin-und-schneesituation/';
  if (id.startsWith('DE-BY')) return 'https://www.lawinenwarndienst.bayern.de/';
  if (id.startsWith('NO')) return 'https://www.varsom.no/snoskredvarsling/';
  if (id.startsWith('FR')) return 'https://meteofrance.com/meteo-montagne';
  return 'https://www.avalanches.org/';
}

const badge = (n) => (n ? `<span class="av-badge" style="background:${LEVELS[n].color};color:${n >= 4 ? '#fff' : '#111'}">${n} ${LEVELS[n].label}</span>` : '–');

/** HTML-Block für ein Popup. days: [{date, label}] (heute, morgen). */
export function avalancheHtml(region, regionName, days) {
  const rows = days.map(({ label, date, danger }) => {
    if (!danger?.level) return `<tr><td>${label}</td><td class="muted" colspan="2">kein Bericht veröffentlicht</td></tr>`;
    const split = danger.high && danger.low && danger.high !== danger.low
      ? `<span class="muted">oben ${danger.high} · unten ${danger.low}</span>`
      : danger.am && danger.pm && danger.am !== danger.pm ? `<span class="muted">vorm. ${danger.am} · nachm. ${danger.pm}</span>` : '';
    return `<tr><td>${label}</td><td>${badge(danger.level)}</td><td>${split}</td></tr>`;
  }).join('');
  const date = days.find((d) => d.danger?.level)?.date ?? days[0].date;
  return `<div class="av"><div class="av-t">🏔️ Lawinenlage · ${regionName}</div><table class="av-tab">${rows}</table>
    <div class="muted">Lageberichte gelten nur für heute/morgen – vor der Tour neu prüfen. <a href="${bulletinUrl(region, date)}" target="_blank" rel="noopener">Lagebericht öffnen</a></div></div>`;
}
