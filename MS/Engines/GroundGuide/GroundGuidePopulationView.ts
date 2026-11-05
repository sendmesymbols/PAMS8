/**
 * GroundGuidePopulationView.ts
 *
 * How the Ground Guide shows the people round the cursor (B in GROTBC, civil considerations). One row on the
 * card in the style chosen by `groundGuide.population.card`, a civil flag (header pill + strip) for the unit types
 * where people change the plan, the full Civil Considerations block for the Ground Brief, the same as plain text for
 * Copy as Text, and the key of the People map layer. Every style is kept so the owner can compare them live;
 * ground-guide-population-options.html shows them side by side.
 *
 * Built from DOM nodes and `textContent` only (place names come from the bundle). Figures are WorldPop estimates
 * and each view says so.
 */

import { registerBriefSection } from './GroundGuideBrief';
import { fmtDistance, titleCase } from './GroundGuideEvaluator';
import { POPULATION_CLASSES, populationClass } from './GroundGuidePopulation';
import type {
  GroundGuidePopulation,
  GroundGuidePopulationCardStyle,
  GroundGuidePopulationClass,
  GroundGuidePopulationPlace,
  GroundGuidePopulationReading,
} from './GroundGuideTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Card styles in the order the settings list them, with what each is called there. */
export const POPULATION_CARD_STYLES: ReadonlyArray<{ value: GroundGuidePopulationCardStyle; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'line', label: 'A · One Line' },
  { value: 'scale', label: 'B · Density Scale' },
  { value: 'rings', label: 'C · Range Rings' },
  { value: 'ages', label: 'D · Who Lives Here' },
  { value: 'rose', label: 'F · People Rose' },
  { value: 'minimap', label: 'G · Mini Heat Map' },
  { value: 'profile', label: 'H · Distance Profile' },
  { value: 'icons', label: 'I · People Icons' },
  { value: 'compare', label: 'J · Versus the Province' },
  { value: 'block', label: 'K · Full Civil Block' },
];

/** Card CSS, appended to the badge's own. B-family colours: taupe for few people up to warm light for many. */
export const POPULATION_CSS = `
.ms-ggp-cap{display:flex;align-items:center;gap:6px}
.ms-ggp-b{display:inline-flex;align-items:center;justify-content:center;flex:none;width:15px;height:15px;border-radius:4px;font:800 10px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0;color:#1b1f25;background:#9a8f86}
.ms-ggp-ln{display:grid;grid-template-columns:58px 1fr;gap:0 8px;align-items:baseline;line-height:1.35}
.ms-ggp-ln+.ms-ggp-ln{margin-top:2px}
.ms-ggp-k{font-size:10.5px;color:#9aa3ad}
.ms-ggp-v{color:#f3f5f7;min-width:0;overflow-wrap:anywhere}
.ms-ggp-v b,.ms-ggp-strong{color:#fff;font-weight:600}
.ms-ggp-chip{display:inline-block;font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:3px 6px 2px;border-radius:999px;vertical-align:1px;color:#1b1f25;white-space:nowrap}
.ms-ggp-chip.ms-dk{color:#fff}
.ms-ggp-scale{display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-top:6px}
.ms-ggp-scale>span{font:700 8.5px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.03em;text-align:center;padding:4px 0 3px;border-radius:2px;background:rgba(255,255,255,.06);color:#6b737c;white-space:nowrap;overflow:hidden}
.ms-ggp-scale>span.ms-on{color:#1b1f25;box-shadow:0 0 0 1.5px #fff inset}
.ms-ggp-scale>span.ms-on.ms-dk{color:#fff}
.ms-ggp-two{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;margin-bottom:4px}
.ms-ggp-list{display:grid;grid-template-columns:auto 1fr;gap:1px 8px;font-size:11px;font-variant-numeric:tabular-nums}
.ms-ggp-list>span{color:#9aa3ad}
.ms-ggp-list>b{color:#fff;font-weight:600;text-align:right}
.ms-ggp-list>.ms-ggp-chip{justify-self:end}
.ms-ggp-big{font-size:18px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;line-height:1.1}
.ms-ggp-age{display:flex;height:9px;border-radius:2px;overflow:hidden;margin:6px 0 3px}
.ms-ggp-age>i{display:block;height:100%}
.ms-ggp-agel{display:flex;justify-content:space-between;font-size:10px;color:#9aa3ad;gap:6px}
.ms-ggp-agel b{color:#fff;font-weight:600}
.ms-ggp-bars{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;align-items:end;height:46px;margin-top:4px}
.ms-ggp-bars>i{display:block;border-radius:2px 2px 0 0;min-height:2px}
.ms-ggp-barl{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;font-size:9px;color:#9aa3ad;text-align:center;margin-top:2px}
.ms-ggp-icons{display:flex;gap:2px;margin:4px 0 3px}
.ms-ggp-icons svg{flex:none}
.ms-ggp-cmp{display:grid;grid-template-columns:96px 1fr 50px;gap:3px 8px;align-items:center;font-size:11px;margin-top:3px}
.ms-ggp-cmp>span:first-child{color:#9aa3ad}
.ms-ggp-cmp i{display:block;height:7px;border-radius:2px}
.ms-ggp-cmp b{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.ms-ggp-places{display:grid;grid-template-columns:1fr auto auto;gap:1px 8px;font-size:11px;font-variant-numeric:tabular-nums;margin-top:2px}
.ms-ggp-places>span:nth-child(3n+2),.ms-ggp-places>span:nth-child(3n){text-align:right;color:#c3cbd3}
.ms-ggp-places small{color:#9aa3ad}
.ms-ggp-src{font-size:10px;color:#8b95a0;margin-top:5px}
.ms-ggp-flag{display:flex;align-items:center;gap:5px;padding:1px 8px 1px 6px;border-radius:999px;font-size:11.5px;white-space:nowrap;background:#f0e2c8;color:#1b1f25;font-weight:700}
.ms-ggp-flag svg{flex:none}
.ms-ggp-civ{display:flex;gap:7px;align-items:flex-start;padding:7px 11px;background:rgba(240,226,200,.09);border-top:1px solid rgba(240,226,200,.3);color:#f0e2c8;font-size:11.5px}
.ms-ggp-civ svg{flex:none;margin-top:1px}
.ms-ggp-key{position:absolute;left:12px;bottom:30px;z-index:20;pointer-events:none;width:230px;box-sizing:border-box;padding:8px 10px 9px;border-radius:10px;
  background:rgba(27,31,37,.92);border:1px solid #39414b;box-shadow:0 2px 10px rgba(0,0,0,.35);font:400 11px/1.35 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7}
.ms-ggp-key b{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase}
.ms-ggp-keyg{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-top:6px}
.ms-ggp-keyg>div{display:flex;align-items:center;gap:6px}
.ms-ggp-keyg i{flex:none;width:16px;height:10px;border-radius:2px}
.ms-ggp-keyg small{display:block;color:#9aa3ad;font-size:9.5px}
`;

const CLASS_NOTE: Record<GroundGuidePopulationClass['key'], string> = {
  empty: 'under 1',
  sparse: '1 to 50',
  rural: '50 to 250',
  denseRural: '250 to 1,000',
  town: '1,000 to 5,000',
  urban: '5,000 and over',
};

const AGE_COLORS = { under15: '#cdbca7', mid: '#7d7168', over65: '#f0e2c8' };

// ── small helpers ─────────────────────────────────────────────────────────

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg(w: number, h: number, viewBox: string, label?: string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('width', String(w));
  s.setAttribute('height', String(h));
  s.setAttribute('viewBox', viewBox);
  if (label) {
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', label);
  } else s.setAttribute('aria-hidden', 'true');
  return s;
}

function add(parent: Element, tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e as SVGElement;
}

/** Estimates are rounded so they do not look like a count: to 10 under 1,000, to 100 under 100,000, else to 1,000. */
function rounded(n: number): number {
  return n < 1000 ? Math.round(n / 10) * 10 : n < 100000 ? Math.round(n / 100) * 100 : Math.round(n / 1000) * 1000;
}

export function fmtPeople(n: number): string {
  return rounded(n).toLocaleString('en-US');
}

function shortPeople(n: number): string {
  const r = rounded(n);
  if (r >= 1e6) return `${(r / 1e6).toFixed(r >= 1e7 ? 0 : 1)} M`;
  if (r >= 10000) return `${Math.round(r / 1000)}k`;
  if (r >= 1000) return `${(r / 1000).toFixed(1)}k`;
  return String(r);
}

/** A whole radius reads "5 km", not "5.0 km" (the units setting still applies). */
function km(n: number): string {
  return fmtDistance(n * 1000).replace(/\.0(?=\s)/, '');
}

function chip(c: GroundGuidePopulationClass): HTMLElement {
  const x = el('span', `ms-ggp-chip${c.dark ? ' ms-dk' : ''}`, c.label);
  x.style.background = c.color;
  return x;
}

function ln(k: string, ...v: Array<Node | string>): HTMLElement {
  const d = el('div', 'ms-ggp-ln');
  const vv = el('span', 'ms-ggp-v');
  vv.append(...v);
  d.append(el('span', 'ms-ggp-k', k), vv);
  return d;
}

function placeKind(p: GroundGuidePopulationPlace): string {
  return titleCase(p.kindLabel);
}

function nearestLine(r: GroundGuidePopulationReading): HTMLElement {
  const p = r.places[0];
  if (!p) return ln('Nearest', el('span', 'ms-ggb-soft', r.pending ? 'Loading places' : 'No named place within 10 km'));
  const who = p.people ? `${placeKind(p)}, ${shortPeople(p.people)}` : placeKind(p);
  return ln('Nearest', el('b', undefined, p.name), ` (${who}) · ${fmtDistance(p.distanceM)} ${p.compass}`);
}

function countLine(r: GroundGuidePopulationReading): HTMLElement {
  return ln('People', el('b', undefined, fmtPeople(r.people)), ` within ${km(r.radiusKm)} · `, chip(r.cls));
}

/** Six-step density scale with the class lit. */
function densityScale(c: GroundGuidePopulationClass): HTMLElement {
  const s = el('div', 'ms-ggp-scale');
  for (const x of POPULATION_CLASSES) {
    const o = el('span', x === c ? `ms-on${x.dark ? ' ms-dk' : ''}` : undefined, x.key === 'denseRural' ? 'Dense' : x.label);
    if (x === c) o.style.background = x.color;
    s.appendChild(o);
  }
  return s;
}

/** Rings at 1, 3 and 5 km shaded by the density in each band, places as dots at their bearing. */
function radar(r: GroundGuidePopulationReading, size: number): SVGSVGElement {
  const s = svg(size, size, '-50 -50 100 100');
  const ring = (k: number) => r.rings.find((x) => x.km === k)?.people ?? 0;
  const band = (a: number, b: number) => (ring(b) - (a ? ring(a) : 0)) / (Math.PI * (b * b - a * a));
  for (const [outer, inner] of [[5, 3], [3, 1], [1, 0]] as const) {
    add(s, 'circle', { r: outer * 9, fill: populationClass(band(inner, outer)).color, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 0.8 });
  }
  for (const p of r.places) {
    if (p.distanceM > 5000) continue;
    const d = (p.distanceM / 1000) * 9;
    const a = (p.bearingDeg * Math.PI) / 180;
    const rad = Math.max(1.6, Math.min(5, Math.sqrt(p.people ?? 100) / 12));
    add(s, 'circle', { cx: (Math.sin(a) * d).toFixed(1), cy: (-Math.cos(a) * d).toFixed(1), r: rad.toFixed(1), fill: '#1b1f25', stroke: '#fff', 'stroke-width': 0.9 });
  }
  add(s, 'path', { d: 'M-4 0H4M0-4V4', stroke: '#fff', 'stroke-width': 1.6 });
  add(s, 'text', { x: 0, y: -46.5, 'text-anchor': 'middle', 'font-size': 8, fill: '#cfd5db', 'font-family': 'system-ui' }, 'N');
  return s;
}

function ringList(r: GroundGuidePopulationReading, kms: number[]): HTMLElement {
  const l = el('div', 'ms-ggp-list');
  for (const k of kms) {
    const x = r.rings.find((y) => y.km === k);
    if (x) l.append(el('span', undefined, `Within ${km(k)}`), el('b', undefined, fmtPeople(x.people)));
  }
  return l;
}

function ageBar(people: number, a: NonNullable<GroundGuidePopulationReading['ages']>): HTMLElement[] {
  const t = people || 1;
  const mid = Math.max(0, t - a.under15 - a.over65);
  const bar = el('div', 'ms-ggp-age');
  for (const [v, c] of [[a.under15, AGE_COLORS.under15], [mid, AGE_COLORS.mid], [a.over65, AGE_COLORS.over65]] as const) {
    const i = el('i');
    i.style.width = `${((100 * v) / t).toFixed(1)}%`;
    i.style.background = c;
    bar.appendChild(i);
  }
  const legend = el('div', 'ms-ggp-agel');
  for (const [name, v] of [['Under 15', a.under15], ['15 to 64', mid], ['65+', a.over65]] as const) {
    const s = el('span', undefined, `${name} `);
    s.appendChild(el('b', undefined, `${Math.round((100 * v) / t)}%`));
    legend.appendChild(s);
  }
  return [bar, legend];
}

/** Bars on a log scale, so a village and a city both show. */
function logShare(v: number, max: number): number {
  return max <= 0 ? 0 : Math.log10(1 + Math.max(0, v)) / Math.log10(1 + max);
}

function personIcon(color: string): SVGSVGElement {
  const s = svg(19, 22, '0 0 24 28');
  add(s, 'circle', { cx: 12, cy: 6, r: 5, fill: color });
  add(s, 'path', { d: 'M3 27v-6a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7v6z', fill: color });
  return s;
}

const USERS_PATHS = ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'];
function usersIcon(size: number): SVGSVGElement {
  const s = svg(size, size, '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  for (const d of USERS_PATHS) add(s, 'path', { d });
  return s;
}

// ── card styles ───────────────────────────────────────────────────────────

function body(r: GroundGuidePopulationReading, style: GroundGuidePopulationCardStyle): Array<Node | string> {
  switch (style) {
    case 'line':
      return [countLine(r), nearestLine(r)];
    case 'scale': {
      const head = el('div');
      head.append(el('span', 'ms-ggb-b', r.cls.label), ` · ${fmtPeople(r.people)} within ${km(r.radiusKm)} · ${fmtPeople(r.perKm2)} per km²`);
      return [head, densityScale(r.cls), nearestLine(r)];
    }
    case 'rings': {
      const two = el('div', 'ms-ggp-two');
      const list = ringList(r, [1, 3, 5]);
      list.append(el('span', undefined, 'Density'), chip(r.cls));
      two.append(radar(r, 84), list);
      return [two, nearestLine(r)];
    }
    case 'ages': {
      const two = el('div', 'ms-ggp-two');
      const big = el('div');
      big.append(el('div', 'ms-ggp-big', shortPeople(r.people)), el('div', 'ms-ggb-soft', `Within ${km(r.radiusKm)}`));
      const right = el('div');
      right.append(chip(r.cls));
      if (r.ages && r.people > 0) {
        right.append(' ', el('span', 'ms-ggb-soft', `Males 15 to 49: ${shortPeople(r.ages.males15_49)}`), ...ageBar(r.people, r.ages));
      } else right.append(el('div', 'ms-ggb-soft', r.people > 0 ? 'No age data' : `No people mapped within ${km(r.radiusKm)}`));
      two.append(big, right);
      return [two, nearestLine(r)];
    }
    case 'rose':
      return [rose(r), nearestLine(r)];
    case 'minimap':
      return [minimap(r), nearestLine(r)];
    case 'profile':
      return [...profile(r), nearestLine(r)];
    case 'icons':
      return [...icons(r), nearestLine(r)];
    case 'compare':
      return [countLine(r), ...compare(r)];
    case 'block':
      return blockRows(r, 4);
    default:
      return [];
  }
}

/** Eight petals, one per compass sector, sized by the people in it, coloured by its density. */
function rose(r: GroundGuidePopulationReading): HTMLElement {
  const two = el('div', 'ms-ggp-two');
  const s = svg(84, 84, '-50 -50 100 100');
  add(s, 'circle', { r: 44, fill: 'rgba(255,255,255,.04)', stroke: 'rgba(255,255,255,.25)', 'stroke-width': 0.8, 'stroke-dasharray': '2 2' });
  const max = Math.max(...r.sectors, 1);
  const sectorArea = (Math.PI * r.radiusKm * r.radiusKm) / 8;
  r.sectors.forEach((p, i) => {
    const len = 8 + 36 * Math.sqrt(p / max);
    const a0 = ((i * 45 - 20) * Math.PI) / 180;
    const a1 = ((i * 45 + 20) * Math.PI) / 180;
    const x0 = Math.sin(a0) * len, y0 = -Math.cos(a0) * len, x1 = Math.sin(a1) * len, y1 = -Math.cos(a1) * len;
    add(s, 'path', {
      d: `M0 0L${x0.toFixed(1)} ${y0.toFixed(1)}A${len.toFixed(1)} ${len.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`,
      fill: populationClass(p / sectorArea).color,
      stroke: 'rgba(15,19,24,.8)',
      'stroke-width': 1,
    });
  });
  add(s, 'circle', { r: 2.6, fill: '#fff' });
  add(s, 'text', { x: 0, y: -45.5, 'text-anchor': 'middle', 'font-size': 8, fill: '#cfd5db', 'font-family': 'system-ui' }, 'N');
  const order = r.sectors.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const list = el('div', 'ms-ggp-list');
  list.append(el('span', undefined, `Within ${km(r.radiusKm)}`), el('b', undefined, fmtPeople(r.people)));
  if (r.people > 0) {
    list.append(el('span', undefined, 'Most People'), el('b', undefined, `${dirs[order[0].i]} · ${shortPeople(order[0].p)}`));
    list.append(el('span', undefined, 'Fewest'), el('b', undefined, `${dirs[order[7].i]} · ${shortPeople(order[7].p)}`));
  }
  list.append(el('span', undefined, 'Density'), chip(r.cls));
  two.append(s, list);
  return two;
}

/** The 1 km cells round the cursor (11 × 11 km) as a small heat map, with the radius ring. */
function minimap(r: GroundGuidePopulationReading): HTMLElement {
  const two = el('div', 'ms-ggp-two');
  const n = r.grid.size;
  const px = 8;
  const s = svg(n * px, n * px, `0 0 ${n * px} ${n * px}`);
  add(s, 'rect', { width: n * px, height: n * px, fill: '#2a3026' });
  r.grid.perKm2.forEach((v, i) => {
    if (v < 1) return;
    add(s, 'rect', { x: (i % n) * px, y: Math.floor(i / n) * px, width: px - 0.5, height: px - 0.5, fill: populationClass(v).color });
  });
  const c = (n * px) / 2;
  const rr = Math.min(c - 1, (r.radiusKm / r.grid.cellKm) * px);
  add(s, 'circle', { cx: c, cy: c, r: rr.toFixed(1), fill: 'none', stroke: '#8ec1ea', 'stroke-width': 1.4, 'stroke-dasharray': '3 2' });
  add(s, 'path', { d: `M${c - 4} ${c}H${c + 4}M${c} ${c - 4}V${c + 4}`, stroke: '#fff', 'stroke-width': 1.6 });
  const list = el('div', 'ms-ggp-list');
  list.append(el('span', undefined, `Within ${km(r.radiusKm)}`), el('b', undefined, fmtPeople(r.people)));
  const here = r.grid.perKm2[Math.floor((n * n) / 2)];
  list.append(el('span', undefined, 'This Cell'), el('b', undefined, here >= 0 ? `${fmtPeople(here)} / km²` : 'None Mapped'));
  list.append(el('span', undefined, 'Density'), chip(r.cls));
  two.append(s, list);
  return two;
}

/** Density in distance bands out from the point: how fast it fills up going out. */
function profile(r: GroundGuidePopulationReading): HTMLElement[] {
  const max = Math.max(...r.bands.map((b) => b.perKm2), 1);
  const bars = el('div', 'ms-ggp-bars');
  const labels = el('div', 'ms-ggp-barl');
  for (const b of r.bands) {
    const i = el('i');
    i.style.height = `${Math.max(4, Math.round(100 * logShare(b.perKm2, max)))}%`;
    i.style.background = populationClass(b.perKm2).color;
    i.title = `${b.fromKm} to ${b.toKm} km: ${fmtPeople(b.perKm2)} per km²`;
    bars.appendChild(i);
    labels.appendChild(el('span', undefined, `${b.fromKm}–${b.toKm}`));
  }
  const busiest = r.bands.reduce((a, b) => (b.perKm2 > a.perKm2 ? b : a), r.bands[0]);
  const head = el('div');
  head.append(el('span', 'ms-ggb-b', r.cls.label), ` · ${fmtPeople(r.people)} within ${km(r.radiusKm)}`);
  const note = el('div', 'ms-ggb-soft', busiest.perKm2 >= 1 ? `Busiest ${busiest.fromKm} to ${busiest.toKm} km out (${fmtPeople(busiest.perKm2)} per km²) · km from here` : 'Nobody mapped within 10 km');
  return [head, bars, labels, note];
}

/** Ten person icons, as many lit as the density (log scale: all ten at 10,000 per km²). */
function icons(r: GroundGuidePopulationReading): HTMLElement[] {
  const lit = Math.max(0, Math.min(10, Math.round(Math.log10(1 + r.perKm2) * 2.5)));
  const row = el('div', 'ms-ggp-icons');
  for (let i = 0; i < 10; i++) row.appendChild(personIcon(i < lit ? r.cls.color : 'rgba(255,255,255,.12)'));
  const head = el('div');
  head.append(el('span', 'ms-ggb-b', `${fmtPeople(r.people)} People`), ` within ${km(r.radiusKm)} · `, chip(r.cls));
  return [head, row, el('div', 'ms-ggb-soft', `${fmtPeople(r.perKm2)} per km² · each figure is a step of about 2.5 times`)];
}

/** This area against the province's average and the density its typical resident lives at. */
function compare(r: GroundGuidePopulationReading): HTMLElement[] {
  const p = r.province;
  if (!p) return [el('div', 'ms-ggb-soft', r.pending ? 'Loading places' : 'No province comparison here')];
  const rows: Array<[string, number]> = [[`This Area (${km(r.radiusKm)})`, r.perKm2], [`${p.name} Average`, p.perKm2], ['Typical Resident', p.typicalPerKm2]];
  const max = Math.max(...rows.map((x) => x[1]), 1);
  const g = el('div', 'ms-ggp-cmp');
  for (const [name, v] of rows) {
    const i = el('i');
    i.style.width = `${Math.max(2, Math.round(100 * logShare(v, max)))}%`;
    i.style.background = populationClass(v).color;
    const w = el('span');
    w.appendChild(i);
    g.append(el('span', undefined, name), w, el('b', undefined, fmtPeople(v)));
  }
  const ratio = p.perKm2 > 0 ? r.perKm2 / p.perKm2 : 0;
  const say = ratio >= 1.5 ? `${ratio.toFixed(ratio >= 10 ? 0 : 1)} times the ${p.name} average` : ratio > 0.67 ? `About the ${p.name} average` : `Quieter than the ${p.name} average`;
  return [g, el('div', 'ms-ggb-soft', `${say} · per km², 2020 province figures`)];
}

/** The full block; `maxPlaces` named places. Used by the `block` card style and by the Ground Brief. */
function blockRows(r: GroundGuidePopulationReading, maxPlaces: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  const two = el('div', 'ms-ggp-two');
  two.append(radar(r, 84), ringList(r, [1, 2, 3, 5, 10]));
  out.push(two);
  const d = ln('Density', chip(r.cls), ` ${fmtPeople(r.perKm2)} per km² within ${km(r.radiusKm)}`);
  out.push(d);
  if (r.ages && r.people > 0) {
    const a = el('div');
    a.append(...ageBar(r.people, r.ages));
    out.push(ln('Age', a), ln('Males 15–49', `${fmtPeople(r.ages.males15_49)} within ${km(r.radiusKm)}`));
  }
  const list = r.places.slice(0, maxPlaces);
  if (list.length) {
    const g = el('div', 'ms-ggp-places');
    for (const p of list) {
      const n = el('span');
      n.append(`${p.name} `, el('small', undefined, placeKind(p)));
      g.append(n, el('span', undefined, p.people ? shortPeople(p.people) : '—'), el('span', undefined, `${fmtDistance(p.distanceM)} ${p.compass}`));
    }
    out.push(ln('Places', g));
  } else out.push(ln('Places', el('span', 'ms-ggb-soft', r.pending ? 'Loading places' : 'None named within 10 km')));
  if (r.province) out.push(...compare(r));
  out.push(el('div', 'ms-ggp-src', sourceLine(r)));
  return out;
}

function sourceLine(r: GroundGuidePopulationReading): string {
  const rel = r.source.released ? `, released ${r.source.released.slice(0, 10)}` : '';
  return `${r.source.label}${rel}. Modelled from buildings, not a census; people where they live.`;
}

// ── public ────────────────────────────────────────────────────────────────

/** The card's B row in the chosen style; null for `off` or no reading. */
export function populationSection(p: GroundGuidePopulation | null | undefined): HTMLElement | null {
  if (!p || p.style === 'off') return null;
  const s = el('div', 'ms-ggb-sec');
  const cap = el('div', 'ms-ggb-cap ms-ggp-cap');
  cap.append(el('span', 'ms-ggp-b', 'B'), p.style === 'block' ? 'Civil Considerations' : 'Built-Up Areas · People');
  s.append(cap, ...body(p.reading, p.style));
  if (p.style !== 'block') s.appendChild(el('div', 'ms-ggb-soft', p.reading.source.label));
  return s;
}

/** Header pill when the civil flag is up. */
export function populationFlagPill(p: GroundGuidePopulation | null | undefined): HTMLElement | null {
  if (!p?.flag) return null;
  const f = el('span', 'ms-ggp-flag');
  f.append(usersIcon(13), `${shortPeople(p.flag.people)} ≤ ${km(p.flag.km)}`);
  return f;
}

/** Strip under the card when the civil flag is up. */
export function populationFlagStrip(p: GroundGuidePopulation | null | undefined): HTMLElement | null {
  if (!p?.flag) return null;
  const s = el('div', 'ms-ggp-civ');
  s.append(usersIcon(14), el('span', undefined, `${p.flag.message} (${p.reading.source.label}).`));
  return s;
}

/** For a screen reader: the flag, when it is up. */
export function populationSpoken(p: GroundGuidePopulation | null | undefined): string {
  return p?.flag ? `${fmtPeople(p.flag.people)} people within ${km(p.flag.km)}` : '';
}

/** B · Built-Up Areas · Civil Considerations, for the Ground Brief: every figure, eight named places, sources. */
export function populationBriefSection(r: GroundGuidePopulationReading): HTMLElement {
  const s = el('div');
  s.append(...blockRows(r, 8));
  return s;
}

/** The same as plain text lines, for Copy as Text. */
export function populationBriefText(r: GroundGuidePopulationReading): string[] {
  const out = [
    `B  BUILT-UP AREAS · CIVIL CONSIDERATIONS (${r.source.label})`,
    `   People:     ${r.rings.filter((x) => x.km !== 2).map((x) => `${fmtPeople(x.people)} within ${km(x.km)}`).join(' · ')}`,
    `   Density:    ${r.cls.label}, ${fmtPeople(r.perKm2)} per km² within ${km(r.radiusKm)}`,
  ];
  if (r.ages && r.people > 0) {
    const t = r.people;
    out.push(
      `   Age:        Under 15 ${Math.round((100 * r.ages.under15) / t)}% · 15 to 64 ${Math.round((100 * (t - r.ages.under15 - r.ages.over65)) / t)}% · 65+ ${Math.round((100 * r.ages.over65) / t)}% · Males 15 to 49 ${fmtPeople(r.ages.males15_49)}`,
    );
  }
  out.push(
    `   Places:     ${r.places.length ? r.places.slice(0, 5).map((p) => `${p.name} (${placeKind(p)}${p.people ? `, ${fmtPeople(p.people)}` : ''}) ${fmtDistance(p.distanceM)} ${p.compass}`).join('; ') : 'None named within 10 km'}`,
  );
  if (r.province) out.push(`   Province:   ${r.province.name} average ${fmtPeople(r.province.perKm2)} per km²; typical resident ${fmtPeople(r.province.typicalPerKm2)} per km² (2020)`);
  out.push(`   Source:     ${sourceLine(r)}`);
  return out;
}

const STYLE_ID = 'ms-ground-guide-population-style';

/** Put the population CSS on the page once (the card, the brief and the map key all use it). */
export function ensurePopulationCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = POPULATION_CSS;
  document.head.appendChild(style);
}

/** What the card shows of the population row, so the guide redraws the card only when it changes. */
export function populationKey(p: GroundGuidePopulation | null | undefined): string {
  if (!p) return '';
  const r = p.reading;
  const near = r.places[0];
  return [
    p.style, r.radiusKm, r.cls.key, Math.round(r.people / 10), r.rings.map((x) => Math.round(x.people / 10)).join(','),
    near ? `${near.name}${Math.round(near.distanceM / 50)}` : '', r.pending ? 1 : 0, p.flag ? p.flag.people : '',
  ].join(';');
}

/** Key of the People map layer (the six classes); absolutely placed in the view's container. */
export function populationKeyElement(year: string): HTMLElement {
  const k = el('div', 'ms-ggp-key');
  k.append(el('b', undefined, 'People'), el('span', 'ms-ggb-soft', ` · WorldPop ${year} Estimate, per km²`));
  const g = el('div', 'ms-ggp-keyg');
  for (const c of POPULATION_CLASSES) {
    const d = el('div');
    const i = el('i');
    i.style.background = c.color;
    const t = el('span', undefined, c.label);
    t.appendChild(el('small', undefined, CLASS_NOTE[c.key]));
    d.append(i, t);
    g.appendChild(d);
  }
  k.appendChild(g);
  return k;
}

// The Ground Brief (G key) draws this under B, after anything else B carries.
registerBriefSection({
  id: 'population',
  letter: 'B',
  order: 10,
  title: 'Built-Up Areas · Civil Considerations',
  render: (v) => {
    if (!v.population?.reading) return null;
    ensurePopulationCss();
    return populationBriefSection(v.population.reading);
  },
  text: (v) => (v.population?.reading ? populationBriefText(v.population.reading).slice(1).map((l) => l.trim()) : []),
});
