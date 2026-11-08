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
import { compassNode } from './GroundGuideNorth';
import { POPULATION_CLASSES, populationClass } from './GroundGuidePopulation';
import {
  ACCENT,
  ensureTokensCss,
  FONT,
  FS,
  FW,
  LETTER_FG,
  LETTER_FILL,
  LINE,
  ROSE_C,
  ROSE_R,
  roseFrame,
  roseKey,
  ruler,
  SURFACE,
  TEXT,
} from './GroundGuideTokens';
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

/**
 * Card CSS, appended to the badge's own. People are drawn on a neutral sequential ramp (POPULATION_CLASSES: taupe for
 * few up to warm light for many), never red / green. Sizes and text colours from GroundGuideTokens.ts (2026-11-08
 * visual review): five type steps, labels in TEXT.label, no uppercase chips, no text faded with opacity.
 */
export const POPULATION_CSS = `
.ms-ggp-cap{display:flex;align-items:center;gap:6px}
.ms-ggp-b{display:inline-flex;align-items:center;justify-content:center;flex:none;width:17px;height:17px;border-radius:4px;font:${FW.bold} ${FS.meta}px/1 ${FONT};color:${LETTER_FG};background:${LETTER_FILL}}
.ms-ggp-ln{display:grid;grid-template-columns:62px minmax(0,1fr);gap:0 8px;align-items:baseline;line-height:1.35}
.ms-ggp-ln+.ms-ggp-ln{margin-top:2px}
.ms-ggp-k{font-size:${FS.meta}px;color:${TEXT.label}}
.ms-ggp-v{color:${TEXT.main};min-width:0;overflow-wrap:anywhere}
.ms-ggp-v b,.ms-ggp-strong{color:${TEXT.strong};font-weight:${FW.semi}}
.ms-ggp-chip{display:inline-flex;align-items:baseline;gap:5px;font-weight:${FW.semi};color:${TEXT.main};white-space:nowrap}
.ms-ggp-chip>i{flex:none;display:inline-block;width:10px;height:10px;border-radius:2px;box-shadow:0 0 0 1px ${LINE.ring};align-self:center}
.ms-ggp-two{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;margin-bottom:4px}
.ms-ggp-fig{margin:0;width:132px;display:flex;flex-direction:column;align-items:center}
.ms-ggp-fig>.ms-gg-rkey{margin-top:2px;max-width:132px}
.ms-ggp-list{display:grid;grid-template-columns:auto 1fr;gap:1px 8px;font-size:${FS.meta}px;font-variant-numeric:tabular-nums}
.ms-ggp-list>span{color:${TEXT.label}}
.ms-ggp-list>b{color:${TEXT.strong};font-weight:${FW.semi};text-align:right}
.ms-ggp-list>.ms-ggp-chip{justify-self:end;color:${TEXT.main}}
.ms-ggp-big{font-size:${FS.title}px;font-weight:${FW.bold};color:${TEXT.strong};font-variant-numeric:tabular-nums;line-height:1.1}
.ms-ggp-age{display:flex;height:9px;border-radius:2px;overflow:hidden;margin:6px 0 3px}
.ms-ggp-age>i{display:block;height:100%}
.ms-ggp-agel{display:flex;justify-content:space-between;flex-wrap:wrap;font-size:${FS.meta}px;color:${TEXT.label};gap:2px 6px}
.ms-ggp-agel b{color:${TEXT.strong};font-weight:${FW.semi}}
.ms-ggp-bars{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;align-items:end;height:46px;margin-top:4px}
.ms-ggp-bars>i{display:block;border-radius:2px 2px 0 0;min-height:2px}
.ms-ggp-barl{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;font-size:${FS.meta}px;color:${TEXT.label};text-align:center;margin-top:2px;white-space:nowrap}
.ms-ggp-icons{display:flex;gap:2px;margin:4px 0 3px}
.ms-ggp-icons svg{flex:none}
.ms-ggp-cmp{display:grid;grid-template-columns:minmax(0,104px) 1fr 54px;gap:3px 8px;align-items:center;font-size:${FS.meta}px;margin-top:3px}
.ms-ggp-cmp>span:nth-child(3n+1){color:${TEXT.label}}
.ms-ggp-cmp i{display:block;height:7px;border-radius:2px;box-shadow:0 0 0 1px ${LINE.soft}}
.ms-ggp-cmp b{text-align:right;font-weight:${FW.semi};color:${TEXT.main};font-variant-numeric:tabular-nums}
.ms-ggp-places{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:1px 8px;font-size:${FS.meta}px;font-variant-numeric:tabular-nums;margin-top:2px;color:${TEXT.main}}
.ms-ggp-places>span:nth-child(3n+2),.ms-ggp-places>span:nth-child(3n){text-align:right;color:${TEXT.label}}
.ms-ggp-places small{font-size:${FS.meta}px;color:${TEXT.label}}
.ms-ggp-src{font-size:${FS.meta}px;line-height:1.35;color:${TEXT.soft};margin-top:5px}
.ms-ggp-flag{display:flex;align-items:center;gap:5px;padding:1px 8px 1px 6px;border-radius:999px;font:${FW.bold} ${FS.meta}px/1.5 ${FONT};white-space:nowrap;background:#f0e2c8;color:${SURFACE.card}}
.ms-ggp-flag svg{flex:none}
.ms-ggp-civ{display:flex;gap:7px;align-items:flex-start;padding:7px 11px;background:rgba(240,226,200,.09);border-top:1px solid rgba(240,226,200,.3);color:#f0e2c8;font-size:${FS.meta}px;line-height:1.35}
.ms-ggp-civ svg{flex:none;margin-top:1px}
.ms-ggp-key{position:absolute;left:12px;bottom:30px;z-index:20;pointer-events:none;width:240px;box-sizing:border-box;padding:8px 10px 9px;border-radius:10px;
  background:rgba(27,31,37,.94);border:1px solid ${LINE.ring};box-shadow:0 2px 10px rgba(0,0,0,.35);font:${FW.regular} ${FS.meta}px/1.35 ${FONT};color:${TEXT.main}}
.ms-ggp-key b{font-size:${FS.body}px;font-weight:${FW.semi}}
.ms-ggp-keyg{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-top:6px}
.ms-ggp-keyg>div{display:flex;align-items:center;gap:6px}
.ms-ggp-keyg i{flex:none;width:16px;height:10px;border-radius:2px;box-shadow:0 0 0 1px ${LINE.ring}}
.ms-ggp-keyg small{display:block;color:${TEXT.label};font-size:${FS.meta}px}
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

/** "Dense Rural" → "Dense rural": a class name as a label in sentence case (item 13). */
function classWord(c: GroundGuidePopulationClass): string {
  return c.label.replace(/(\s)([A-Z])(?=[a-z])/g, (_m, sp: string, a: string) => sp + a.toLowerCase());
}

/** The density class as a swatch and its word (item 13: no uppercase chip); the swatch keeps the map layer's colour. */
export function populationChip(c: GroundGuidePopulationClass): HTMLElement {
  const x = el('span', 'ms-ggp-chip');
  const sw = el('i');
  sw.style.background = c.color;
  x.append(sw, classWord(c));
  return x;
}

export function populationLine(k: string, ...v: Array<Node | string>): HTMLElement {
  const d = el('div', 'ms-ggp-ln');
  const vv = el('span', 'ms-ggp-v');
  vv.append(...v);
  d.append(el('span', 'ms-ggp-k', k), vv);
  return d;
}

export function placeKind(p: GroundGuidePopulationPlace): string {
  return titleCase(p.kindLabel);
}

export function nearestLine(r: GroundGuidePopulationReading): HTMLElement {
  const p = r.places[0];
  if (!p) return populationLine('Nearest', el('span', 'ms-ggb-soft', r.pending ? 'Loading places' : 'No named place within 10 km'));
  const who = p.people ? `${placeKind(p)}, ${shortPeople(p.people)}` : placeKind(p);
  return populationLine('Nearest', el('b', undefined, p.name), ` (${who}) · ${fmtDistance(p.distanceM)} ${p.compass}`);
}

export function countLine(r: GroundGuidePopulationReading): HTMLElement {
  return populationLine('People', el('b', undefined, fmtPeople(r.people)), ` within ${km(r.radiusKm)} · `, populationChip(r.cls));
}

/**
 * The density band as a read-only ruler (item 11): Empty … Urban along a line, a pointer at this class, its word bold.
 * `value`: an optional line under it (e.g. "320 per km²").
 */
export function densityScale(c: GroundGuidePopulationClass, value?: string | Node): HTMLElement {
  ensureTokensCss();
  const bands = POPULATION_CLASSES.map((x) => (x.key === 'denseRural' ? 'Dense' : x.label));
  // No label line over it: the band words say what it is, and the Detail tile must not grow.
  const r = ruler(bands, POPULATION_CLASSES.indexOf(c), value === undefined ? {} : { value });
  r.setAttribute('aria-label', `Density: ${classWord(c)}`);
  return r;
}

/** The key under the people rings: "Rings 1 · 3 · 5 km · lighter = more people". */
export function radarKey(): HTMLElement {
  return roseKey('Rings 1 · 3 · 5 km · lighter = more people');
}

/** The key under the people rose: "Length = people · lighter = denser". */
export function populationRoseKey(): HTMLElement {
  return roseKey('Length = people · lighter = denser');
}

/** A round picture with its key under it, as one figure (item 12). */
function figure(pic: Element, key: Element): HTMLElement {
  const f = el('figure', 'ms-ggp-fig');
  f.append(pic, key);
  return f;
}

/**
 * Rings at 1, 3 and 5 km shaded by the density in each band (the neutral people ramp), places as dots at their bearing,
 * in the shared frame (item 12). The group turns with the map (data-gv-rose), the N stays upright. Drawn at ROSE_PX:
 * `size` is kept for the callers but no longer used.
 */
export function radar(r: GroundGuidePopulationReading, size: number): SVGSVGElement {
  void size;
  const f = roseFrame(`People within 1, 3 and 5 km, and the places round the point`);
  const k = ROSE_R / 5; // frame units per km
  const ring = (km: number) => r.rings.find((x) => x.km === km)?.people ?? 0;
  const band = (a: number, b: number) => (ring(b) - (a ? ring(a) : 0)) / (Math.PI * (b * b - a * a));
  for (const [outer, inner] of [[5, 3], [3, 1], [1, 0]] as const) {
    f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: (outer * k).toFixed(2), fill: populationClass(band(inner, outer)).color, stroke: LINE.ring, 'stroke-width': 0.9 });
  }
  for (const p of r.places) {
    if (p.distanceM > 5000) continue;
    const d = (p.distanceM / 1000) * k;
    const a = (p.bearingDeg * Math.PI) / 180;
    const rad = Math.max(1.8, Math.min(5.5, Math.sqrt(p.people ?? 100) / 11));
    const dot = f.add('circle', { cx: (ROSE_C + Math.sin(a) * d).toFixed(2), cy: (ROSE_C - Math.cos(a) * d).toFixed(2), r: rad.toFixed(2), fill: SURFACE.card, stroke: TEXT.strong, 'stroke-width': 1 });
    const tip = document.createElementNS(SVG_NS, 'title');
    tip.textContent = `${p.name}: ${fmtDistance(p.distanceM)} ${p.compass}`;
    dot.append(tip);
  }
  f.add('path', { d: `M${ROSE_C - 4} ${ROSE_C}H${ROSE_C + 4}M${ROSE_C} ${ROSE_C - 4}V${ROSE_C + 4}`, stroke: TEXT.strong, 'stroke-width': 1.6 });
  return f.svg;
}

export function ringList(r: GroundGuidePopulationReading, kms: number[]): HTMLElement {
  const l = el('div', 'ms-ggp-list');
  for (const k of kms) {
    const x = r.rings.find((y) => y.km === k);
    if (x) l.append(el('span', undefined, `Within ${km(k)}`), el('b', undefined, fmtPeople(x.people)));
  }
  return l;
}

export function ageBar(people: number, a: NonNullable<GroundGuidePopulationReading['ages']>): HTMLElement[] {
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
      list.append(el('span', undefined, 'Density'), populationChip(r.cls));
      two.append(figure(radar(r, 0), radarKey()), list);
      return [two, nearestLine(r)];
    }
    case 'ages': {
      const two = el('div', 'ms-ggp-two');
      const big = el('div');
      big.append(el('div', 'ms-ggp-big', shortPeople(r.people)), el('div', 'ms-ggb-soft', `Within ${km(r.radiusKm)}`));
      const right = el('div');
      right.append(populationChip(r.cls));
      if (r.ages && r.people > 0) {
        right.append(' ', el('span', 'ms-ggb-soft', `Males 15 to 49: ${shortPeople(r.ages.males15_49)}`), ...ageBar(r.people, r.ages));
      } else right.append(el('div', 'ms-ggb-soft', r.people > 0 ? 'No age data' : `No people mapped within ${km(r.radiusKm)}`));
      two.append(big, right);
      return [two, nearestLine(r)];
    }
    case 'rose':
      return [populationRose(r), nearestLine(r)];
    case 'minimap':
      return [populationMinimap(r), nearestLine(r)];
    case 'profile':
      return [...populationProfile(r), nearestLine(r)];
    case 'icons':
      return [...populationIcons(r), nearestLine(r)];
    case 'compare':
      return [countLine(r), ...populationCompare(r)];
    case 'block':
      return populationBlockRows(r, 4);
    default:
      return [];
  }
}

/** Eight petals, one per compass sector, sized by the people in it, coloured by its density. */
export function populationRose(r: GroundGuidePopulationReading): HTMLElement {
  const two = el('div', 'ms-ggp-two');
  // Petals by compass sector in the shared frame (item 12): the group turns with the map (data-gv-rose), the N stays upright.
  const f = roseFrame(`People by direction within ${km(r.radiusKm)}`);
  const max = Math.max(...r.sectors, 1);
  const sectorArea = (Math.PI * r.radiusKm * r.radiusKm) / 8;
  const dirs8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  r.sectors.forEach((p, i) => {
    const len = 8 + (ROSE_R - 8) * Math.sqrt(p / max);
    const a0 = ((i * 45 - 20) * Math.PI) / 180;
    const a1 = ((i * 45 + 20) * Math.PI) / 180;
    const x0 = ROSE_C + Math.sin(a0) * len, y0 = ROSE_C - Math.cos(a0) * len, x1 = ROSE_C + Math.sin(a1) * len, y1 = ROSE_C - Math.cos(a1) * len;
    const petal = f.add('path', {
      d: `M${ROSE_C} ${ROSE_C}L${x0.toFixed(2)} ${y0.toFixed(2)}A${len.toFixed(2)} ${len.toFixed(2)} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`,
      fill: populationClass(p / sectorArea).color,
      stroke: SURFACE.ring,
      'stroke-width': 1,
    });
    const tip = document.createElementNS(SVG_NS, 'title');
    tip.textContent = `${dirs8[i]}: ${fmtPeople(p)} people`;
    petal.append(tip);
  });
  f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: 2.8, fill: TEXT.strong });
  const root = figure(f.svg, populationRoseKey());
  const order = r.sectors.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const list = el('div', 'ms-ggp-list');
  list.append(el('span', undefined, `Within ${km(r.radiusKm)}`), el('b', undefined, fmtPeople(r.people)));
  if (r.people > 0) {
    // The sector's compass point with its arrow (sector i is centred on i × 45°), which turns with the map.
    const most = el('b');
    most.append(compassNode(dirs[order[0].i], order[0].i * 45), ` · ${shortPeople(order[0].p)}`);
    const least = el('b');
    least.append(compassNode(dirs[order[7].i], order[7].i * 45), ` · ${shortPeople(order[7].p)}`);
    list.append(el('span', undefined, 'Most People'), most);
    list.append(el('span', undefined, 'Fewest'), least);
  }
  list.append(el('span', undefined, 'Density'), populationChip(r.cls));
  two.append(root, list);
  return two;
}

let clipSeq = 0;

/** The 1 km cells round the cursor (11 × 11 km) as a small heat map, with the radius ring. */
export function populationMinimap(r: GroundGuidePopulationReading): HTMLElement {
  const two = el('div', 'ms-ggp-two');
  const n = r.grid.size;
  const px = 8;
  const c = (n * px) / 2;
  const root = svg(n * px, n * px, `0 0 ${n * px} ${n * px}`);
  // Round, so it can turn with the map (data-gv-rose) without its corners swinging out; N marks the top of the grid.
  const clip = `ms-ggp-clip-${++clipSeq}`;
  add(add(add(root, 'defs', {}), 'clipPath', { id: clip }), 'circle', { cx: c, cy: c, r: c });
  const s = add(add(root, 'g', { 'clip-path': `url(#${clip})` }), 'g', { 'data-gv-rose': c });
  add(s, 'rect', { width: n * px, height: n * px, fill: SURFACE.head });
  r.grid.perKm2.forEach((v, i) => {
    if (v < 1) return;
    add(s, 'rect', { x: (i % n) * px, y: Math.floor(i / n) * px, width: px - 0.5, height: px - 0.5, fill: populationClass(v).color });
  });
  const rr = Math.min(c - 1, (r.radiusKm / r.grid.cellKm) * px);
  add(s, 'circle', { cx: c, cy: c, r: rr.toFixed(1), fill: 'none', stroke: ACCENT, 'stroke-width': 1.4, 'stroke-dasharray': '3 2' });
  add(s, 'path', { d: `M${c - 4} ${c}H${c + 4}M${c} ${c - 4}V${c + 4}`, stroke: TEXT.strong, 'stroke-width': 1.6 });
  add(
    s,
    'text',
    {
      x: c,
      y: 10,
      class: 'ms-gg-up',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 11,
      'font-weight': FW.bold,
      fill: TEXT.strong,
      stroke: SURFACE.ring,
      'stroke-width': 2.5,
      'paint-order': 'stroke',
      'font-family': FONT,
    },
    'N',
  );
  add(root, 'circle', { cx: c, cy: c, r: c - 0.6, fill: 'none', stroke: LINE.ring });
  const list = el('div', 'ms-ggp-list');
  list.append(el('span', undefined, `Within ${km(r.radiusKm)}`), el('b', undefined, fmtPeople(r.people)));
  const here = r.grid.perKm2[Math.floor((n * n) / 2)];
  list.append(el('span', undefined, 'This Cell'), el('b', undefined, here >= 0 ? `${fmtPeople(here)} / km²` : 'None Mapped'));
  list.append(el('span', undefined, 'Density'), populationChip(r.cls));
  two.append(root, list);
  return two;
}

/** Density in distance bands out from the point: how fast it fills up going out. */
export function populationProfile(r: GroundGuidePopulationReading): HTMLElement[] {
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
export function populationIcons(r: GroundGuidePopulationReading): HTMLElement[] {
  const lit = Math.max(0, Math.min(10, Math.round(Math.log10(1 + r.perKm2) * 2.5)));
  const row = el('div', 'ms-ggp-icons');
  for (let i = 0; i < 10; i++) row.appendChild(personIcon(i < lit ? r.cls.color : 'rgba(255,255,255,.12)'));
  const head = el('div');
  head.append(el('span', 'ms-ggb-b', `${fmtPeople(r.people)} People`), ` within ${km(r.radiusKm)} · `, populationChip(r.cls));
  return [head, row, el('div', 'ms-ggb-soft', `${fmtPeople(r.perKm2)} per km² · each figure is a step of about 2.5 times`)];
}

/** This area against the province's average and the density its typical resident lives at. */
export function populationCompare(r: GroundGuidePopulationReading): HTMLElement[] {
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

/** The named places nearest, as a name / people / distance grid, or a soft line when none is named. */
export function populationPlaces(r: GroundGuidePopulationReading, maxPlaces: number): HTMLElement {
  const list = r.places.slice(0, maxPlaces);
  if (!list.length) return el('span', 'ms-ggb-soft', r.pending ? 'Loading places' : 'None named within 10 km');
  const g = el('div', 'ms-ggp-places');
  for (const p of list) {
    const n = el('span');
    n.append(`${p.name} `, el('small', undefined, placeKind(p)));
    g.append(n, el('span', undefined, p.people ? shortPeople(p.people) : '—'), el('span', undefined, `${fmtDistance(p.distanceM)} ${p.compass}`));
  }
  return g;
}

/** The full block; `maxPlaces` named places. Used by the `block` card style and by the Ground Brief. */
export function populationBlockRows(r: GroundGuidePopulationReading, maxPlaces: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  const two = el('div', 'ms-ggp-two');
  two.append(figure(radar(r, 0), radarKey()), ringList(r, [1, 2, 3, 5, 10]));
  out.push(two);
  const d = populationLine('Density', populationChip(r.cls), ` ${fmtPeople(r.perKm2)} per km² within ${km(r.radiusKm)}`);
  out.push(d);
  if (r.ages && r.people > 0) {
    const a = el('div');
    a.append(...ageBar(r.people, r.ages));
    out.push(populationLine('Age', a), populationLine('Males 15–49', `${fmtPeople(r.ages.males15_49)} within ${km(r.radiusKm)}`));
  }
  out.push(populationLine('Places', populationPlaces(r, maxPlaces)));
  if (r.province) out.push(...populationCompare(r));
  out.push(el('div', 'ms-ggp-src', populationSourceLine(r)));
  return out;
}

export function populationSourceLine(r: GroundGuidePopulationReading): string {
  const rel = r.source.released ? `, released ${r.source.released.slice(0, 10)}` : '';
  return `${r.source.label}${rel}. Modelled from buildings, not a census; people where they live.`;
}

// ── public ────────────────────────────────────────────────────────────────

/** The card's B row in the chosen style; null for `off` or no reading. */
export function populationSection(p: GroundGuidePopulation | null | undefined): HTMLElement | null {
  if (!p || p.style === 'off') return null;
  const s = el('div', 'ms-ggb-sec');
  const cap = el('div', 'ms-ggb-cap ms-ggp-cap');
  cap.append(el('span', 'ms-ggp-b', 'B'), p.style === 'block' ? 'Civil Considerations' : 'BUAs · People');
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
  s.append(...populationBlockRows(r, 8));
  return s;
}

/** The same as plain text lines, for Copy as Text. */
export function populationBriefText(r: GroundGuidePopulationReading): string[] {
  const out = [
    `B  BUAs · CIVIL CONSIDERATIONS (${r.source.label})`,
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
  out.push(`   Source:     ${populationSourceLine(r)}`);
  return out;
}

const STYLE_ID = 'ms-ground-guide-population-style';

/** Put the population CSS on the page once (the card, the brief and the map key all use it). */
export function ensurePopulationCss(): void {
  ensureTokensCss();
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
  title: 'BUAs · Civil Considerations',
  render: (v) => {
    if (!v.population?.reading) return null;
    ensurePopulationCss();
    return populationBriefSection(v.population.reading);
  },
  text: (v) => (v.population?.reading ? populationBriefText(v.population.reading).slice(1).map((l) => l.trim()) : []),
});
