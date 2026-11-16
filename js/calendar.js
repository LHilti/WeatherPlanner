// Datumsbereich-Auswahl als Dropdown (wie bei Flugbuchungen): Klick-Klick oder Ziehen über die Tage.
// Rechenteile (datesBetween, monthGrid, presets) sind ohne DOM testbar.
import { addDays, isoDate, weekendStart } from './weather.js';

const parse = (iso) => new Date(iso + 'T00:00:00');

/** Alle ISO-Daten von a bis b (inklusive, Reihenfolge egal). */
export function datesBetween(a, b) {
  if (a > b) [a, b] = [b, a];
  const out = [];
  for (let d = parse(a); isoDate(d) <= b; d = addDays(d, 1)) out.push(isoDate(d));
  return out;
}

/** Wochen eines Monats (Montag zuerst) als Arrays von ISO-Daten bzw. null für Leerfelder. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Mo = 0
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => isoDate(new Date(year, month, i + 1)))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Schnellauswahl; alle auf das Vorhersagefenster [min, max] begrenzt (null = liegt ganz außerhalb). */
export function presets(today = new Date()) {
  const sat = weekendStart(today, 0);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return [
    { label: 'Nächstes Wochenende', from: isoDate(sat), to: isoDate(addDays(sat, 1)) },
    { label: 'Langes WE (Fr–Mo)', from: isoDate(addDays(sat, -1)), to: isoDate(addDays(sat, 2)) },
    { label: 'Übernächstes WE', from: isoDate(addDays(sat, 7)), to: isoDate(addDays(sat, 8)) },
    { label: 'Nächste 3 Tage', from: isoDate(t), to: isoDate(addDays(t, 2)) },
    { label: 'Nächste 7 Tage', from: isoDate(t), to: isoDate(addDays(t, 6)) },
  ];
}

/** Bereich auf [min, max] klemmen; null, wenn nichts übrig bleibt. */
export function clampRange({ from, to }, min, max) {
  if (from > to) [from, to] = [to, from];
  if (to < min || from > max) return null;
  return { from: from < min ? min : from, to: to > max ? max : to };
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const fmt = (iso, opts) => parse(iso).toLocaleDateString('de-DE', opts);
export const rangeLabel = ({ from, to }) => (from === to
  ? fmt(from, { weekday: 'short', day: 'numeric', month: 'short' })
  : `${fmt(from, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmt(to, { weekday: 'short', day: 'numeric', month: 'short' })}`);

/**
 * Baut den Kalender in `root` (Button + Dropdown). onChange({from, to}) wird beim Übernehmen aufgerufen.
 * min/max: auswählbarer Bereich (Vorhersagefenster).
 */
export function createRangePicker(root, { value, min, max, onChange }) {
  let range = { ...value };       // übernommener Bereich
  let draft = { ...value };       // Auswahl im offenen Dropdown
  let anchor = null;              // Starttag beim Ziehen / ersten Klick
  let dragging = false;
  let moved = false;

  root.innerHTML = `
    <button type="button" class="cal-btn" aria-haspopup="dialog" aria-expanded="false"></button>
    <div class="cal-pop" role="dialog" aria-label="Zeitraum wählen" hidden>
      <div class="cal-presets"></div>
      <div class="cal-months"></div>
      <div class="cal-foot"><span class="cal-sel muted"></span><span>
        <button type="button" class="cal-cancel">Abbrechen</button>
        <button type="button" class="cal-ok">Übernehmen</button></span></div>
      <div class="muted cal-hint">Ziehen oder Start- und Endtag anklicken · Vorhersage reicht bis ${fmt(max, { day: 'numeric', month: 'short' })}</div>
    </div>`;
  const btn = root.querySelector('.cal-btn');
  const pop = root.querySelector('.cal-pop');

  const months = [];
  for (let d = parse(min); isoDate(d) <= max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push([d.getFullYear(), d.getMonth()]);
  root.querySelector('.cal-months').innerHTML = months.map(([y, m]) => `
    <div class="cal-month"><div class="cal-title">${MONTHS[m]} ${y}</div>
      <div class="cal-grid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span class="cal-wd">${w}</span>`).join('')}
      ${monthGrid(y, m).flat().map((iso) => (iso
        ? `<button type="button" class="cal-day" data-d="${iso}" ${iso < min || iso > max ? 'disabled' : ''}>${parse(iso).getDate()}</button>`
        : '<span></span>')).join('')}</div></div>`).join('');

  const presetBox = root.querySelector('.cal-presets');
  for (const p of presets()) {
    const r = clampRange(p, min, max); if (!r) continue;
    const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label;
    b.onclick = () => { draft = r; anchor = null; paint(); };
    presetBox.append(b);
  }

  function paint() {
    btn.innerHTML = `📅 ${rangeLabel(range)} <span class="muted">(${datesBetween(range.from, range.to).length} Tage)</span> ▾`;
    root.querySelectorAll('.cal-day').forEach((el) => {
      const d = el.dataset.d;
      el.classList.toggle('in', d >= draft.from && d <= draft.to);
      el.classList.toggle('start', d === draft.from);
      el.classList.toggle('end', d === draft.to);
      el.classList.toggle('wkend', [0, 6].includes(parse(d).getDay()));
    });
    const n = datesBetween(draft.from, draft.to).length;
    root.querySelector('.cal-sel').textContent = anchor && !dragging ? 'Endtag wählen …' : `${rangeLabel(draft)} · ${n} ${n === 1 ? 'Tag' : 'Tage'}`;
  }
  // Schwebend über der Karte positionieren (die Seitenleiste würde das Dropdown sonst abschneiden)
  function place() {
    if (pop.hidden) return;
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(16, Math.min(r.left, innerWidth - w - 16))}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.maxHeight = `${Math.max(240, innerHeight - r.bottom - 22)}px`;
  }
  const open = (v) => {
    pop.hidden = !v; btn.setAttribute('aria-expanded', String(v));
    if (v) { draft = { ...range }; anchor = null; paint(); place(); }
  };
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  btn.onclick = () => open(pop.hidden);
  root.querySelector('.cal-cancel').onclick = () => open(false);
  root.querySelector('.cal-ok').onclick = () => { range = { ...draft }; open(false); paint(); onChange({ ...range }); };
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !root.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) open(false); });

  // Ziehen (Maus und Touch über Pointer-Events) bzw. Klick-Klick
  const dayAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest('.cal-day:not([disabled])')?.dataset.d;
  const grid = root.querySelector('.cal-months');
  grid.addEventListener('pointerdown', (e) => {
    const d = dayAt(e); if (!d) return;
    e.preventDefault();
    if (anchor) { draft = { from: anchor < d ? anchor : d, to: anchor < d ? d : anchor }; anchor = null; paint(); return; } // zweiter Klick
    anchor = d; dragging = true; moved = false; draft = { from: d, to: d }; paint();
  });
  grid.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const d = dayAt(e); if (!d) return;
    if (d !== anchor) moved = true;
    draft = { from: anchor < d ? anchor : d, to: anchor < d ? d : anchor }; paint();
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (moved) anchor = null; // gezogen: fertig; nur geklickt: auf Endtag warten
    paint();
  });

  paint();
  return { get value() { return { ...range }; } };
}
