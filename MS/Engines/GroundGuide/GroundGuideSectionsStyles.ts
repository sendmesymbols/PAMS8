/**
 * GroundGuideSectionsStyles.ts
 *
 * The drawn card styles of the G, R, O, B and W sections (2026-11-06), one switch each
 * (`groundGuide.sections.gStyle` ... `wStyle`). Every style is kept so the owner can compare them live;
 * ground-guide-sections-options.html renders these same functions side by side. The `line` and `rows` looks live in
 * GroundGuideSectionsView.ts.
 *   G relief   a cross-section of the slope with the point on it, the slope band gauge and the high ground
 *   G chips    terrain type, slope band, landform, water and high ground as chips
 *   R shield   the road as a sign: number, name, from - to, length, then what is recorded on it
 *   R verdict  the check for the mode in large type, the route under it
 *   O tiles    natural beside man-made obstacle, each bordered by what it means for the mode
 *   O gap      the nearest canal or river reach drawn to its width, depth and bank height
 *   B where    tehsil, district, province, map sheet and border first; then the place and buildings
 *   B protected protected sites (worship, graves) and services (health, schools) first: no-strike and collateral
 *   W year     twelve months: temperature range bars and rain, this month outlined, frost and heat marked
 *   W icons    the month's temperature, rain and wind as large figures
 * DOM nodes and textContent only. CSS injected once.
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { compassBearing, whereNode } from './GroundGuideNorth';
import type { BuildingsReading, GroundReading, ObstacleHit, ObstaclesReading, RoadsReading, SectionPlace, WeatherReading } from './GroundGuideSections';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'ms-ground-guide-sections-styles';
const LETTER: Record<'G' | 'R' | 'O' | 'B' | 'W', [string, string]> = {
  G: ['#8fb35a', '#1b1f25'],
  R: ['#c9a46b', '#1b1f25'],
  O: ['#7a5cc9', '#fff'],
  B: ['#9a8f86', '#1b1f25'],
  W: ['#4a7f95', '#fff'],
};
const CHECK: Record<string, [string, string, string]> = {
  ok: ['#1d3a2a', '#7ee0a5', 'Suits the mode'],
  warn: ['#3a2a14', '#ffb766', 'Limited'],
  stop: ['#3d1c1e', '#ff8a8d', 'Does not suit the mode'],
  unknown: ['#2e2a1c', '#ffd27a', 'Check first'],
};
const EFFECT: Record<string, string> = { 'NO-GO': '#e5484d', 'SLOW-GO': '#f0932b' };
/** Terrain type colours (`terrain` codes 1-9): land greens and browns, water blues, built-up grey, snow white. */
const TERRAIN: Record<number, string> = { 1: '#9cc45a', 2: '#c9a46b', 3: '#8a8f98', 4: '#4aa3a0', 5: '#4a90c8', 6: '#e0c070', 7: '#a07850', 8: '#9a8f86', 9: '#e8f0f8' };
const BANDS = ['Level', 'Gentle', 'Sloping', 'Moderate', 'Steep'];
const BAND_COL = ['#2fa862', '#7fc35a', '#d9c54a', '#f0932b', '#e5484d'];
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
/** Labels of protected kinds (features/index.json), for the B protected style. */
const PROTECTED = /^(Mosque|Tomb|Temple|Church|Eidgah|Graveyard \/ grave|Hospital|Basic health unit|Dispensary|School \/ college)$/;

const CSS = `
.ms-gx-cap{display:flex;align-items:center;gap:6px}
.ms-gx-l{display:inline-flex;align-items:center;justify-content:center;flex:none;width:15px;height:15px;border-radius:4px;font:800 10px/1 system-ui,Segoe UI,Arial,sans-serif}
.ms-gx-soft{color:#9aa3ad;font-size:11px;line-height:1.35;margin-top:4px}
.ms-gx-soft b{color:#e8ebee;font-weight:600}
.ms-gx-chips{display:flex;flex-wrap:wrap;gap:4px}
.ms-gx-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:1;padding:4px 7px;border-radius:999px;background:rgba(255,255,255,.07);color:#e8ebee;white-space:nowrap}
.ms-gx-chip i{display:inline-block;width:8px;height:8px;border-radius:2px}
.ms-gx-gauge{display:grid;grid-template-columns:repeat(5,1fr);gap:2px;margin-top:5px}
.ms-gx-gauge>span{font:700 8.5px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.03em;text-align:center;padding:4px 0 3px;border-radius:2px;background:rgba(255,255,255,.06);color:#6b737c}
.ms-gx-sign{display:flex;gap:9px;align-items:flex-start}
.ms-gx-shield{flex:none;min-width:44px;text-align:center;font:800 13px/1 system-ui,Segoe UI,Arial,sans-serif;padding:7px 6px;border-radius:6px 6px 14px 14px;background:#f3f5f7;color:#1b1f25;border:2px solid #1b1f25;box-shadow:0 0 0 1.5px #f3f5f7}
.ms-gx-shield.ms-msr{background:#d64541;color:#fff;box-shadow:0 0 0 1.5px #d64541}
.ms-gx-sign b{display:block;color:#fff;font-size:12.5px;line-height:1.25}
.ms-gx-big{border-radius:7px;padding:7px 9px}
.ms-gx-big b{display:block;font-size:14px;letter-spacing:.02em;text-transform:uppercase}
.ms-gx-big span{display:block;font-size:11.5px;margin-top:2px;opacity:.95}
.ms-gx-tiles{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.ms-gx-tile{border-radius:6px;padding:5px 7px;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);min-width:0}
.ms-gx-tile small{display:block;font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#9aa3ad;margin-bottom:3px}
.ms-gx-tile b{display:block;color:#fff;font-size:11.5px;line-height:1.25}
.ms-gx-tile span{display:block;color:#c3cbd3;font-size:10.5px;margin-top:2px}
.ms-gx-where{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 8px;font-size:11.5px;line-height:1.35}
.ms-gx-where>span:nth-child(odd){color:#9aa3ad;font-size:10.5px}
.ms-gx-where b{color:#fff;font-weight:600}
.ms-gx-list{margin:0;padding:0;list-style:none;font-size:11.5px;line-height:1.45}
.ms-gx-list li{display:flex;justify-content:space-between;gap:8px}
.ms-gx-list li span:last-child{color:#9aa3ad;white-space:nowrap}
.ms-gx-icons{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;text-align:center}
.ms-gx-icons>div{border-radius:6px;background:rgba(255,255,255,.05);padding:5px 2px}
.ms-gx-icons b{display:block;color:#fff;font-size:15px;line-height:1.1;font-variant-numeric:tabular-nums}
.ms-gx-icons small{display:block;color:#9aa3ad;font-size:10px;margin-top:2px}
.ms-gx-ob{padding:6px 8px 7px 9px}
.ms-gx-ob small{display:flex;align-items:center;gap:5px;margin-bottom:4px}
.ms-gx-ob svg.ms-gx-ic{width:15px;height:15px;flex:none}
.ms-gx-ob .ms-gx-at{display:block;color:#c3cbd3;font-size:10.5px;margin-top:2px}
.ms-gx-nat{border:1px solid rgba(156,207,106,.4);border-left:3px solid #9ccf6a;border-radius:10px;background:linear-gradient(135deg,rgba(156,207,106,.15),rgba(156,207,106,.03))}
.ms-gx-nat small{color:#b7dc8f}
.ms-gx-man{border:1px solid rgba(159,180,207,.4);border-left:3px solid #9fb4cf;border-radius:3px;background:repeating-linear-gradient(135deg,rgba(159,180,207,.1) 0 5px,rgba(159,180,207,.03) 5px 10px)}
.ms-gx-man small{color:#c9d7ea}
.ms-gx-eff{display:inline-block;margin-top:5px;font:700 9.5px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;padding:3px 6px;border-radius:4px}
.ms-gx-obg{padding:6px 8px 7px;margin-top:6px}
.ms-gx-obg:first-child{margin-top:0}
.ms-gx-obh{display:flex;align-items:center;gap:6px;font:700 10px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px}
.ms-gx-obh svg{width:15px;height:15px}
.ms-gx-nat .ms-gx-obh{color:#b7dc8f}
.ms-gx-man .ms-gx-obh{color:#c9d7ea}
.ms-gx-obr{display:grid;grid-template-columns:16px 66px minmax(0,1fr);gap:0 6px;align-items:start;font-size:11.5px;line-height:1.4;padding:3px 0}
.ms-gx-obr+.ms-gx-obr{border-top:1px solid rgba(255,255,255,.07)}
.ms-gx-obr>svg{width:14px;height:14px;margin-top:1px}
.ms-gx-obr>.k{color:#9aa3ad;font-size:10.5px;padding-top:1px}
.ms-gx-obr>.v{min-width:0;color:#e8ebee;overflow-wrap:anywhere}
.ms-gx-obr.ms-none>.v{color:#7d8792}
.ms-gx-obdial{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.ms-gx-obkey{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#c3cbd3}
.ms-gx-obkey span{display:inline-flex;align-items:center;gap:6px}
.ms-gx-obkey i{display:inline-block;width:10px;height:10px;box-sizing:border-box}
`;

function ensureCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function sv(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function svText(x: number, y: number, text: string, attrs: Record<string, string | number> = {}): SVGElement {
  const t = sv('text', { x, y, fill: '#c3cbd3', 'font-size': 9, 'font-family': 'system-ui, Segoe UI, Arial, sans-serif', ...attrs });
  t.textContent = text;
  return t;
}

function section(l: keyof typeof LETTER, caption: string, ...content: Array<Node | null>): HTMLElement {
  ensureCss();
  const sec = el('div', 'ms-ggb-sec');
  const cap = el('div', 'ms-ggb-cap ms-gx-cap');
  const b = el('span', 'ms-gx-l', l);
  b.style.background = LETTER[l][0];
  b.style.color = LETTER[l][1];
  cap.append(b, caption);
  sec.append(cap, ...content.filter((c): c is Node => c !== null));
  return sec;
}

function at(p: { distanceM: number; compass: string }): string {
  return `${fmtDistance(p.distanceM)} ${p.compass}`;
}

function nameOf(p: SectionPlace): string {
  return p.name ?? p.label;
}

function soft(...parts: Array<string | Node | null | false>): HTMLElement {
  const d = el('div', 'ms-gx-soft');
  for (const p of parts) if (p) d.append(p);
  return d;
}

function chip(text: string, color?: string): HTMLElement {
  const c = el('span', 'ms-gx-chip');
  if (color) {
    const i = el('i');
    i.style.background = color;
    c.append(i);
  }
  c.append(text);
  return c;
}

// ── G ────────────────────────────────────────────────────────────────────────
/** Where each landform sits on the drawn slope (x, 0-1 along it). */
const LANDFORM_X: Record<string, number> = { 'Valley floor': 0.08, 'Lower slope': 0.3, 'Mid-slope': 0.5, 'Upper slope': 0.68, 'Crest / ridge': 0.84 };

function bandIndex(g: GroundReading): number {
  return g.slopeBand ? Math.max(0, BANDS.indexOf(g.slopeBand)) : -1;
}

/** The military crest in words, with where the point is on the slope (card rows, relief style, Brief). */
export function crestText(g: GroundReading): { lead: string; rest: string } | null {
  const c = g.crest;
  if (!c) return null;
  const top = c.topDistanceM > 0 ? `top ${fmtDistance(c.topDistanceM)} ${c.topCompass}` : 'top here';
  const foot = `foot ${fmtDistance(c.footDistanceM)} ${c.faces}`;
  if (c.where === 'on') return { lead: 'Here', rest: `you see down to the ${foot} · ${top} · drop ${c.dropM} m` };
  if (c.where === 'above') return { lead: `${fmtDistance(c.distanceM)} ${c.compass}, below you`, rest: `from here the slope below is partly hidden (dead Gr) · ${foot} · drop ${c.dropM} m` };
  return { lead: `${fmtDistance(c.distanceM)} ${c.compass}, above you`, rest: `the ${foot} is in view · ${top} · drop ${c.dropM} m` };
}

/** "Dune lines every 280 m · running NNW–SSE · move along them, not across" (1:50k dune lines). */
export function dunesText(g: GroundReading): { lead: string; rest: string } | null {
  const d = g.dunes;
  if (!d) return null;
  const lead = d.star ? 'Star dunes' : d.spacingM ? `Dune lines every ${d.spacingM} m` : 'Dune field';
  const rest = [
    !d.inField ? `${fmtDistance(d.distanceM)} ${d.compass}` : null,
    d.axis ? `running ${d.axis}` : d.star ? 'high and irregular' : 'no single Dir',
    d.axis ? 'move along them, not across' : 'slow going for vehicles',
  ];
  return { lead, rest: rest.filter(Boolean).join(' · ') };
}

/**
 * The real slope (2026-11-06): the DEM profile from the top of the slope to its foot along the way it faces, with the
 * point, the military crest (MC) and the dead ground between them shaded. Heights are stretched to fit.
 */
function crestProfile(g: GroundReading): SVGElement | null {
  const c = g.crest;
  if (!c || c.profile.length < 3) return null;
  const W = 256;
  const H = 70;
  const p = c.profile;
  const lo = Math.min(...p);
  const hi = Math.max(...p);
  const X = (i: number) => 6 + (i / (p.length - 1)) * (W - 12);
  const Y = (e: number) => 14 + (1 - (e - lo) / Math.max(1, hi - lo)) * (H - 28);
  const svg = sv('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'The slope from its top to its foot, with the military crest' });
  let d = '';
  p.forEach((e, i) => (d += `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(e).toFixed(1)} `));
  const tcol = g.terrain ? TERRAIN[g.terrain.code] ?? '#8a8f98' : '#8a8f98';
  svg.append(sv('path', { d: `${d} L ${X(p.length - 1)} ${H - 12} L ${X(0)} ${H - 12} Z`, fill: tcol, 'fill-opacity': 0.25 }));
  // Dead ground seen from the point when it is above the military crest: the stretch between them.
  if (c.where === 'above') {
    let dd = '';
    for (let i = c.iP; i <= c.iM; i++) dd += `${i === c.iP ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(p[i]).toFixed(1)} `;
    svg.append(sv('path', { d: dd, fill: 'none', stroke: '#ff8a8d', 'stroke-width': 4, 'stroke-opacity': 0.55 }));
  }
  svg.append(sv('path', { d, fill: 'none', stroke: tcol, 'stroke-width': 2 }));
  const mx = X(c.iM);
  const my = Y(p[c.iM]);
  svg.append(sv('line', { x1: mx, y1: my - 12, x2: mx, y2: my + 2, stroke: '#ffd27a', 'stroke-width': 1.4, 'stroke-dasharray': '2 2' }), svText(mx, my - 14, 'MC', { fill: '#ffd27a', 'font-weight': 700, 'font-size': 9, 'text-anchor': 'middle' }));
  const px = X(c.iP);
  const py = Y(p[c.iP]);
  svg.append(sv('circle', { cx: px, cy: py, r: 4.5, fill: '#fff', stroke: '#1b1f25', 'stroke-width': 1.5 }));
  svg.append(svText(4, 9, `Top ${p[0]} m`, { 'font-size': 8.5, fill: '#9aa3ad' }), svText(W - 4, H - 1, `Foot ${p[p.length - 1]} m · faces ${c.faces} →`, { 'font-size': 8.5, fill: '#9aa3ad', 'text-anchor': 'end' }));
  svg.append(svText(4, H - 1, `${fmtDistance(c.stepM * (p.length - 1))} of slope`, { 'font-size': 8.5, fill: '#9aa3ad' }));
  return svg;
}

export function groundRelief(g: GroundReading): HTMLElement {
  const real = crestProfile(g);
  if (real) {
    const ct = crestText(g);
    const dn = dunesText(g);
    return section(
      'G',
      `Gr · ${g.terrain?.label ?? 'Relief'}`,
      real,
      soft(
        [
          g.slopeDeg !== null ? `${g.slopeApprox ? 'About ' : ''}${Math.round(g.slopeDeg)}° slope` : null,
          g.aspect ? `faces ${g.aspect.compass}` : null,
          ct ? (g.crest?.where === 'on' ? 'on the military crest' : `military crest ${ct.lead}`) : null,
          g.rough ? `${g.rough.label.toLowerCase()} surface` : null,
          dn ? dn.lead.toLowerCase() : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    );
  }
  const W = 256;
  const H = 62;
  const svg = sv('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Where the point sits on the slope' });
  const flat = !g.landform || !(g.landform in LANDFORM_X);
  // A schematic ground line: valley floor, a rise to a crest, a short fall beyond.
  const base = H - 10;
  const y = (t: number) => (flat ? base - 8 : base - 40 * Math.sin(Math.min(1, t / 0.84) * (Math.PI / 2)) ** 1.6 + (t > 0.84 ? (t - 0.84) * 60 : 0));
  let d = '';
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    d += `${i ? 'L' : 'M'} ${(t * (W - 20) + 4).toFixed(1)} ${y(t).toFixed(1)} `;
  }
  const tcol = g.terrain ? TERRAIN[g.terrain.code] ?? '#8a8f98' : '#8a8f98';
  svg.append(sv('path', { d: `${d} L ${W - 16} ${H} L 4 ${H} Z`, fill: tcol, 'fill-opacity': 0.28 }), sv('path', { d, fill: 'none', stroke: tcol, 'stroke-width': 2 }));
  const tx = flat ? 0.5 : LANDFORM_X[g.landform!];
  const px = tx * (W - 20) + 4;
  const py = y(tx);
  svg.append(sv('line', { x1: px, y1: py, x2: px, y2: py - 14, stroke: '#fff', 'stroke-width': 1.2 }), sv('circle', { cx: px, cy: py, r: 4.5, fill: '#fff', stroke: '#1b1f25', 'stroke-width': 1.5 }));
  // The point's height beside its marker (on the left when the marker is on the right half), the high ground top left.
  if (g.elevationM !== null) {
    const right = px > W / 2;
    svg.append(svText(right ? px - 5 : px + 5, py - 16, `${g.elevationM} m`, { fill: '#fff', 'font-weight': 700, 'font-size': 10, 'text-anchor': right ? 'end' : 'start' }));
  }
  if (g.high) svg.append(svText(4, 10, `▲ ${g.high.elevationM} m · ${g.high.compass}`, { fill: '#ffd27a' }));
  svg.append(svText(4, H - 1, g.landform ?? 'Landform not mapped', { 'font-size': 8.5, fill: '#9aa3ad' }));
  const gauge = el('div', 'ms-gx-gauge');
  const bi = bandIndex(g);
  BANDS.forEach((b, i) => {
    const s = el('span', undefined, b);
    if (i === bi) {
      s.style.background = BAND_COL[i];
      s.style.color = i >= 2 && i <= 3 ? '#1b1f25' : '#fff';
    }
    gauge.append(s);
  });
  return section(
    'G',
    `Gr · ${g.terrain?.label ?? 'Relief'}`,
    svg,
    gauge,
    soft(
      g.slopeDeg !== null ? `${g.slopeApprox ? 'About ' : ''}${Math.round(g.slopeDeg)}° slope` : 'Slope not known',
      g.terrainChange ? ` · ${g.terrainChange.label} ${fmtDistance(g.terrainChange.distanceM)} ${g.terrainChange.compass}` : '',
      g.high ? ` · high Gr ${g.high.aboveM !== null ? `+${g.high.aboveM} m ` : ''}${at(g.high)}` : '',
    ),
  );
}

export function groundChips(g: GroundReading): HTMLElement {
  const c = el('div', 'ms-gx-chips');
  if (g.terrain) c.append(chip(g.terrain.label, TERRAIN[g.terrain.code]));
  if (g.elevationM !== null) c.append(chip(`${g.elevationM} m`));
  const bi = bandIndex(g);
  if (bi >= 0) c.append(chip(`${Math.round(g.slopeDeg ?? 0)}° ${BANDS[bi]}`, BAND_COL[bi]));
  if (g.landform) c.append(chip(g.landform));
  if (g.aspect) c.append(chip(`Faces ${g.aspect.compass}`));
  if (g.crest) c.append(chip(g.crest.where === 'on' ? 'On the military crest' : `MC ${fmtDistance(g.crest.distanceM)} ${g.crest.compass}`, '#ffd27a'));
  if (g.rough && g.rough.level >= 2) c.append(chip(g.rough.label, '#c9a46b'));
  if (g.dunes) c.append(chip(dunesText(g)?.lead ?? 'Dunes', '#d8b26a'));
  if (g.groundSym?.[0]) c.append(chip(`${g.groundSym[0].label} ${at(g.groundSym[0])}`, '#9a8f86'));
  if (g.high) c.append(chip(`▲ ${g.high.aboveM !== null ? `+${g.high.aboveM} m` : `${g.high.elevationM} m`} ${at(g.high)}`, '#ffd27a'));
  if (g.water[0]) c.append(chip(`${g.water[0].label} ${at(g.water[0])}`, '#4a90c8'));
  if (g.namedWater) c.append(chip(`${nameOf(g.namedWater)} ${at(g.namedWater)}`, '#4a90c8'));
  if (g.area) c.append(chip(nameOf(g.area), '#8fb35a'));
  return section('G', 'Gr', c);
}

// ── R ────────────────────────────────────────────────────────────────────────
function checkBig(c: RoadsReading['check']): HTMLElement | null {
  if (!c) return null;
  const [bg, fg, head] = CHECK[c.level];
  const d = el('div', 'ms-gx-big');
  d.style.background = bg;
  d.style.color = fg;
  d.append(el('b', undefined, head), el('span', undefined, c.text));
  return d;
}

function routeLine(r: RoadsReading): string {
  const x = r.route;
  if (!x) return 'No Rd or Tr within 500 m';
  return [x.typeLabel, x.tier ? x.tierLabel : null, x.on ? 'here' : at(x), x.msr ? 'MSR' : null].filter(Boolean).join(' · ');
}

export function roadsShield(r: RoadsReading): HTMLElement {
  const rec = r.record;
  const rt = rec?.route;
  const id = rec?.number ?? rt?.number ?? null;
  const sign = el('div', 'ms-gx-sign');
  const sh = el('div', `ms-gx-shield${rt?.msr || r.route?.msr ? ' ms-msr' : ''}`, id ?? (r.route?.typeLabel.split(' ')[0] ?? 'Rd'));
  const txt = el('div');
  txt.append(el('b', undefined, rt?.from && rt?.to ? `${rt.from} to ${rt.to}` : rec?.name ?? rt?.name ?? r.route?.typeLabel ?? 'No named Rd near'));
  txt.append(soft([rt?.km ? `${Math.round(rt.km)} km` : null, rec ? at(rec) : r.route ? (r.route.on ? 'here' : at(r.route)) : null, rec?.defence ? 'defence Rd' : null].filter(Boolean).join(' · ')));
  sign.append(sh, txt);
  const chips = el('div', 'ms-gx-chips');
  chips.style.marginTop = '6px';
  if (rec) {
    chips.append(
      chip(rec.loadCode ? `Load ${rec.loadCode}` : rt?.load ? `Class ${rt.load[0]}` : 'Load not recorded', rec.loadCode || rt?.load ? '#c9a46b' : '#6b737c'),
      chip(`Condition ${rec.condition ?? rt?.condition ?? 'not recorded'}`, rec.condition || rt?.condition ? '#7ee0a5' : '#6b737c'),
      chip(rec.closed ?? rt?.closed ? `Closed: ${rec.closed ?? rt?.closed}` : 'No closure recorded', rec.closed ?? rt?.closed ? '#e5484d' : '#6b737c'),
    );
    if (rec.widthM) chips.append(chip(`${rec.widthM} m wide`));
    if (rec.landslides) chips.append(chip(`${rec.landslides} landslide sites`, '#e5484d'));
  }
  return section('R', 'Rds, Trs & Rail', sign, chips.childElementCount ? chips : null, r.check ? soft(r.check.text) : null);
}

export function roadsVerdict(r: RoadsReading): HTMLElement {
  return section('R', 'Route for the Mode', checkBig(r.check) ?? soft('No rule for this mode on this route'), soft(routeLine(r)), r.record ? soft(`${r.record.number ?? r.record.name ?? 'Rd'} ${at(r.record)}`) : null);
}

// ── O ────────────────────────────────────────────────────────────────────────
/** Natural (green, rounded) and man-made (steel, square, hatched) obstacles are told apart by colour, shape and icon. */
const OB_COLOR = { natural: '#9ccf6a', man_made: '#9fb4cf' } as const;
type ObKind = keyof typeof OB_COLOR;
type ObIcon = 'water' | 'slope' | 'tree' | 'snow' | 'built' | 'line' | 'rail' | 'dam' | 'closure' | 'crop' | 'fence' | 'hill';
const OB_PATH: Record<ObIcon, string> = {
  water: 'M1.5 6.5q2.1-2 4.2 0t4.2 0 4.2 0M1.5 10.5q2.1-2 4.2 0t4.2 0 4.2 0',
  slope: 'M1 14 6 5l3 4 2-3 4 8z',
  hill: 'M1 13c2.5-6 4-8 7-8s4.5 2 7 8z',
  tree: 'M8 1.5 3.2 9h3.3l-2.3 3.6h7.6L9.5 9h3.3zM8 12.6V15',
  snow: 'M8 1v14M2 4.5l12 7M2 11.5l12-7',
  built: 'M2 15V7l4-3v11M6 15V5l8 2v8M9 9.5h2M9 12h2',
  line: 'M8 1v14M4 4h8M5 8h6M3 15l5-11 5 11',
  rail: 'M5 1 3 15M11 1l2 14M3.8 4.5h8.4M3.4 8h9.2M3 11.5h10',
  dam: 'M2 4h12v3H2zM3 7l1 8h8l1-8M6 10h4',
  closure: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13M3.5 8h9',
  crop: 'M8 15V5M8 8C5 8 4 6 4 4c2 0 4 1 4 4m0 2c3 0 4-2 4-4-2 0-4 1-4 4M3 15h10',
  fence: 'M3 3v12M8 3v12M13 3v12M1.5 6.5h13M1.5 11h13',
};
const ICON_RULES: Array<[RegExp, ObIcon]> = [
  [/closure|closed|landslide/i, 'closure'],
  [/\bdam\b|barrage|headworks|levee|bund|weir/i, 'dam'],
  [/snow|glacier|\bice\b|frost/i, 'snow'],
  [/power|pipeline|pylon|\bkv\b/i, 'line'],
  [/rail/i, 'rail'],
  [/crop|irrigat|orchard|plantation|field/i, 'crop'],
  [/nullah|nala|river|stream|canal|water|lake|marsh|swamp|flood|wet|bank|drain|channel|pond|tank/i, 'water'],
  [/forest|tree|wood|scrub|jungle|bush/i, 'tree'],
  [/slope|cliff|ravine|gully|escarp|rock|ridge|steep|boulder|scree/i, 'slope'],
  [/dune|sand|hill|mound|knoll/i, 'hill'],
  [/built|town|village|house|wall|fence|urban|settle/i, 'built'],
];

function obIcon(k: ObIcon, kind: ObKind): SVGElement {
  const colour = OB_COLOR[kind];
  const solid = k === 'slope' || k === 'hill';
  const svg = sv('svg', { class: 'ms-gx-ic', viewBox: '0 0 16 16', 'aria-hidden': 'true' });
  svg.append(sv('path', { d: OB_PATH[k], fill: solid ? colour : 'none', 'fill-opacity': 0.35, stroke: colour, 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}

/** A small line icon for an obstacle, picked from its words; the kind's own icon (slope / fence) when nothing matches. */
export function obstacleIcon(text: string, kind: ObKind): SVGElement {
  return obIcon(ICON_RULES.find(([re]) => re.test(text))?.[1] ?? (kind === 'natural' ? 'slope' : 'fence'), kind);
}

function effectChip(effect: 'NO-GO' | 'SLOW-GO'): HTMLElement {
  const c = el('span', 'ms-gx-eff', `${effect} for the mode`);
  c.style.background = EFFECT[effect];
  c.style.color = effect === 'SLOW-GO' ? '#1b1f25' : '#fff';
  return c;
}

function obstacleTile(kind: ObKind, o: ObstacleHit | null): HTMLElement {
  const t = el('div', `ms-gx-tile ms-gx-ob ${kind === 'natural' ? 'ms-gx-nat' : 'ms-gx-man'}`);
  const head = el('small');
  head.append(obstacleIcon(o?.label ?? '', kind), kind === 'natural' ? 'Natural' : 'Man-made');
  t.append(head);
  if (o) {
    const where = el('span', 'ms-gx-at');
    where.append(whereNode(o.distanceM, o.compass));
    t.append(el('b', undefined, o.label), where);
    if (o.effect) t.append(effectChip(o.effect));
  } else t.append(el('span', undefined, 'None mapped near'));
  return t;
}

export function obstaclesTiles(o: ObstaclesReading): HTMLElement {
  const g = el('div', 'ms-gx-tiles');
  g.append(obstacleTile('natural', o.natural), obstacleTile('man_made', o.manMade));
  const extra = [o.wet ? `${o.wet} here` : null, o.closure ? `${o.closure.road} ${at(o.closure)}: ${o.closure.closed ? `closed (${o.closure.closed})` : `${o.closure.landslides} landslide sites`}` : null].filter(Boolean).join(' · ');
  return section('O', 'Obs', g, extra ? soft(extra) : null);
}

/** Which of the O rows (GroundGuideSectionsView.obstaclesRows) are nature's, and the icon a row takes when fixed. */
const NATURAL_ROWS = new Set(['Natural', 'Here', 'River', 'Bank', 'Flood', 'Snow']);
const ROW_ICON: Record<string, ObIcon> = { Here: 'water', River: 'water', Bank: 'water', Flood: 'water', Snow: 'snow', Canal: 'water', 'Canal Xing': 'water', Lines: 'line', Dam: 'dam', Levee: 'dam', Closures: 'closure' };

/**
 * Obstacles Near in two groups, Natural (green, rounded) and Man-made (steel, hatched), each row with its icon.
 * `rows` are the O rows; an empty row is left out, a "None ..." row is shown muted.
 */
export function obstaclesNear(rows: Array<[string, Node | string | null]>, o: ObstaclesReading): HTMLElement {
  const box = el('div');
  for (const kind of ['natural', 'man_made'] as const) {
    const mine = rows.filter(([k, v]) => v !== null && v !== '' && NATURAL_ROWS.has(k) === (kind === 'natural'));
    if (!mine.length) continue;
    const g = el('div', `ms-gx-obg ${kind === 'natural' ? 'ms-gx-nat' : 'ms-gx-man'}`);
    const head = el('div', 'ms-gx-obh');
    head.append(obIcon(kind === 'natural' ? 'slope' : 'fence', kind), kind === 'natural' ? 'Natural' : 'Man-made');
    g.append(head);
    for (const [k, v] of mine) {
      const text = typeof v === 'string' ? v : (v as Node).textContent ?? '';
      const r = el('div', `ms-gx-obr${/^None (mapped|recorded)/.test(text) ? ' ms-none' : ''}`);
      const hit = k === 'Natural' ? o.natural : k === 'Man-made' ? o.manMade : null;
      const val = el('span', 'v');
      val.append(v as Node | string);
      r.append(ROW_ICON[k] ? obIcon(ROW_ICON[k], kind) : obstacleIcon(hit?.label ?? text, kind), el('span', 'k', k), val);
      g.append(r);
    }
    box.append(g);
  }
  return box;
}

/**
 * Obstacles Round It: each obstacle the reading names, plotted at its distance and compass point round the point
 * (natural a green circle, man-made a steel square, a red edge where it stops the mode). The plot turns with the map
 * (`data-gv-rose`); its N stays upright (`data-gv-upright`). Null when nothing has a place.
 */
export function obstaclesDial(o: ObstaclesReading, size = 132): HTMLElement | null {
  type Mark = { kind: ObKind; label: string; distanceM: number; compass: string; stop: boolean };
  const marks: Mark[] = [];
  const put = (kind: ObKind, label: string | null | undefined, p: { distanceM: number; compass: string } | null | undefined, stop = false) => {
    if (p && label && compassBearing(p.compass) !== null && Number.isFinite(p.distanceM)) marks.push({ kind, label, distanceM: p.distanceM, compass: p.compass, stop });
  };
  put('natural', o.natural?.label, o.natural, o.natural?.effect === 'NO-GO');
  put('man_made', o.manMade?.label, o.manMade, o.manMade?.effect === 'NO-GO');
  put('man_made', o.canal ? nameOf(o.canal) : null, o.canal);
  put('natural', o.reach ? o.reach.name ?? 'River reach' : null, o.reach);
  put('man_made', o.dam ? nameOf(o.dam) : null, o.dam);
  put('man_made', o.levee ? nameOf(o.levee) : null, o.levee);
  for (const l of o.lines ?? []) put('man_made', l.label, l);
  for (const w of o.canalWorks ?? []) put('man_made', nameOf(w), w);
  put('man_made', o.closure ? `${o.closure.road} closure` : null, o.closure, true);
  if (!marks.length) return null;
  const far = Math.max(...marks.map((m) => m.distanceM));
  const range = [500, 1000, 2000, 3000, 5000, 10000, 20000, 50000].find((r) => r >= far) ?? Math.ceil(far / 10000) * 10000;
  const c = size / 2;
  const R = c - 13;
  const P = (deg: number, r: number): [number, number] => [c + r * Math.sin((deg * Math.PI) / 180), c - r * Math.cos((deg * Math.PI) / 180)];
  const svg = sv('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': 'Obstacles round the point' });
  const g = sv('g', { 'data-gv-rose': c });
  g.append(
    sv('circle', { cx: c, cy: c, r: R, fill: 'rgba(255,255,255,.035)', stroke: 'rgba(255,255,255,.22)' }),
    sv('circle', { cx: c, cy: c, r: R / 2, fill: 'none', stroke: 'rgba(255,255,255,.13)', 'stroke-dasharray': '2 3' }),
  );
  for (const d of [0, 90, 180, 270]) {
    const [x1, y1] = P(d, R - 4);
    const [x2, y2] = P(d, R);
    g.append(sv('line', { x1, y1, x2, y2, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 1.2 }));
  }
  const [nx, ny] = P(0, R + 7);
  g.append(svText(nx, ny, 'N', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 10, 'font-weight': 700, fill: '#fff', 'data-gv-upright': `${nx.toFixed(1)} ${ny.toFixed(1)}` }));
  // Farthest first, so a near mark is drawn over a far one.
  for (const m of [...marks].sort((x, y) => y.distanceM - x.distanceM)) {
    const [x, y] = P(compassBearing(m.compass)!, Math.max(7, (Math.min(m.distanceM, range) / range) * R));
    const col = OB_COLOR[m.kind];
    const edge = { stroke: m.stop ? '#ff5a5f' : '#1b1f25', 'stroke-width': m.stop ? 2 : 1.2 };
    const mk = m.kind === 'natural' ? sv('circle', { cx: x, cy: y, r: 4.6, fill: col, ...edge }) : sv('rect', { x: x - 4.2, y: y - 4.2, width: 8.4, height: 8.4, rx: 1, fill: col, ...edge });
    const tip = sv('title', {});
    tip.textContent = `${m.label} · ${fmtDistance(m.distanceM)} ${m.compass}`;
    mk.append(tip);
    g.append(mk);
  }
  g.append(sv('circle', { cx: c, cy: c, r: 3.2, fill: '#fff', stroke: '#1b1f25', 'stroke-width': 1.2 }));
  svg.append(g);
  const key = el('div', 'ms-gx-obkey');
  const item = (swatch: string, text: string) => {
    const s = el('span');
    const i = el('i');
    i.style.cssText = swatch;
    s.append(i, text);
    return s;
  };
  const nNat = marks.filter((m) => m.kind === 'natural').length;
  key.append(item(`background:${OB_COLOR.natural};border-radius:50%`, `Natural · ${nNat}`), item(`background:${OB_COLOR.man_made};border-radius:2px`, `Man-made · ${marks.length - nNat}`));
  if (marks.some((m) => m.stop)) key.append(item('border:2px solid #ff5a5f;border-radius:50%', 'Stops the mode'));
  key.append(el('span', undefined, `Rings ${fmtDistance(range / 2)} · ${fmtDistance(range)}`));
  const row = el('div', 'ms-gx-obdial');
  row.append(svg, key);
  return section('O', `Obs Round It · ${fmtDistance(range)}`, row);
}

export function obstaclesGap(o: ObstaclesReading): HTMLElement {
  const c = o.canal;
  const r = o.reach;
  const W = 256;
  const H = 80;
  const gap = c && (c.widthM || c.depthM) ? { name: nameOf(c), at: at(c), w: c.widthM, d: c.depthM, b: c.bankM } : r && r.depthM ? { name: r.name ?? 'River reach', at: at(r), w: null, d: r.depthM, b: null } : null;
  if (!gap) return obstaclesTiles(o);
  const svg = sv('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cross-section of the gap' });
  // Banks, then a trapezoid channel scaled to the gap; the water fills two thirds of the depth. The width is a
  // dimension line with end ticks over the gap and its label above the line, never on it (user, 2026-11-08: the line
  // ran through "15.7 m wide").
  const top = 28;
  const bank = gap.b ? Math.min(14, 4 + gap.b) : 4;
  const dPx = Math.min(36, 10 + (gap.d ?? 2) * 4);
  const wPx = Math.min(170, 50 + (gap.w ?? 10) * 1.4);
  const x0 = (W - wPx) / 2;
  const x1 = x0 + wPx;
  const g0 = top + bank;
  svg.append(
    sv('path', { d: `M 0 ${g0} L ${x0 - 14} ${g0} L ${x0 - 8} ${top} L ${x0} ${top} L ${x0 + 12} ${top + bank + dPx} L ${x1 - 12} ${top + bank + dPx} L ${x1} ${top} L ${x1 + 8} ${top} L ${x1 + 14} ${g0} L ${W} ${g0} L ${W} ${H} L 0 ${H} Z`, fill: '#8a6d4a', 'fill-opacity': 0.55 }),
    sv('path', { d: `M ${x0 + 12 * (1 / 3) + 4} ${top + bank + dPx / 3} L ${x1 - 4 - 12 / 3} ${top + bank + dPx / 3} L ${x1 - 12} ${top + bank + dPx} L ${x0 + 12} ${top + bank + dPx} Z`, fill: '#4a90c8', 'fill-opacity': 0.8 }),
  );
  if (gap.w) {
    svg.append(
      sv('line', { x1: x0, y1: 21, x2: x1, y2: 21, stroke: '#fff', 'stroke-width': 1 }),
      sv('line', { x1: x0, y1: 17, x2: x0, y2: 25, stroke: '#fff', 'stroke-width': 1 }),
      sv('line', { x1: x1, y1: 17, x2: x1, y2: 25, stroke: '#fff', 'stroke-width': 1 }),
      svText(W / 2, 13, `${gap.w} m wide`, { fill: '#fff', 'font-weight': 700, 'text-anchor': 'middle' }),
    );
  }
  if (gap.d) svg.append(svText(x1 - 4, top + bank + dPx - 2, `${gap.d} m deep`, { fill: '#fff', 'text-anchor': 'end' }));
  if (gap.b) svg.append(svText(4, top + bank - 4, `banks ${gap.b} m`, { fill: '#e8ebee' }));
  const hit = o.manMade?.label?.toLowerCase().includes('canal') ? o.manMade : o.natural;
  return section('O', 'Obs · Gap', svg, soft(el('b', undefined, gap.name), ` · ${gap.at}`, hit?.effect ? ` · ${hit.effect} for the mode` : '', r && gap.w === null && r.currentMs ? ` · ${r.currentMs} m/s` : ''));
}

// ── B ────────────────────────────────────────────────────────────────────────
export function buildingsWhere(b: BuildingsReading): HTMLElement {
  const g = el('div', 'ms-gx-where');
  const row = (k: string, v: string | null, strong?: string | null) => {
    if (!v && !strong) return;
    const val = el('span');
    if (strong) val.append(el('b', undefined, strong));
    if (v) val.append(strong ? ` · ${v}` : v);
    g.append(el('span', undefined, k), val);
  };
  row('Tehsil', [b.admin?.district ? `District ${b.admin.district}` : null, b.admin?.province].filter(Boolean).join(' · ') || null, b.admin?.tehsil ?? null);
  row('Sheet', b.sheet?.s250k ? `1:250k ${b.sheet.s250k}` : null, b.sheet?.s50k ? `1:50k ${b.sheet.s50k}` : null);
  row('Grid', b.sheet?.grid ? `zone ${b.sheet.grid.zone} · ${b.sheet.grid.e.toLocaleString('en-US')} E ${b.sheet.grid.n.toLocaleString('en-US')} N` : null, b.sheet?.grid ? `GR ${b.sheet.grid.ref}` : null);
  if (b.country && b.country !== 'Pakistan') row('Country', null, b.country);
  if (b.border) {
    const near = b.border.distanceKm < 10;
    const v = el('span');
    const s = el('b', undefined, `${b.border.distanceKm < 10 ? b.border.distanceKm.toFixed(1) : Math.round(b.border.distanceKm)} km ${b.border.compass}`);
    if (near) s.style.color = '#ff8a8d';
    v.append(s, ` · ${b.border.kind}`);
    g.append(el('span', undefined, 'Border'), v);
  }
  row('Place', b.settlement ? `${b.settlement.sizeClass} · ${at(b.settlement)}` : null, b.settlement ? nameOf(b.settlement) : null);
  row('Bldgs', b.density ? (b.density.code ? b.density.label : 'None mapped here') : null);
  return section('B', 'BUAs · Where', g);
}

export function buildingsProtected(b: BuildingsReading): HTMLElement {
  const items = [...b.landmarks, ...b.services].filter((p) => PROTECTED.test(p.label)).sort((p, q) => p.distanceM - q.distanceM);
  const list = el('ul', 'ms-gx-list');
  for (const p of items.slice(0, 5)) {
    const li = el('li');
    li.append(el('span', undefined, p.name ? `${p.name} (${p.label})` : p.label), el('span', undefined, at(p)));
    list.append(li);
  }
  return section(
    'B',
    'Protected Sites & Svcs',
    items.length ? list : soft('No protected site or service mapped near'),
    soft('Worship, graves, health and schools: no-strike and collateral checks.'),
    b.settlement ? soft(el('b', undefined, nameOf(b.settlement)), ` · ${b.settlement.sizeClass}${b.settlement.people ? `, about ${b.settlement.people.toLocaleString('en-US')} people` : ''} · ${at(b.settlement)}`) : null,
  );
}

// ── W ────────────────────────────────────────────────────────────────────────
export function weatherYear(w: WeatherReading): HTMLElement {
  const W = 256;
  const H = 76;
  const svg = sv('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Temperature range and rain by month' });
  const tmaxs = w.months.tmax.filter((v): v is number => v !== null);
  const tmins = w.months.tmin.filter((v): v is number => v !== null);
  const hi = Math.max(...tmaxs, 0);
  const lo = Math.min(...tmins, 0);
  const pMax = Math.max(...w.months.prec, 1);
  const col = W / 12;
  const ty = (t: number) => 4 + ((hi - t) / Math.max(1, hi - lo)) * 34;
  if (lo < 0) svg.append(sv('line', { x1: 0, y1: ty(0), x2: W, y2: ty(0), stroke: '#8cc4ff', 'stroke-dasharray': '2 3', 'stroke-width': 0.8 }));
  for (let m = 0; m < 12; m++) {
    const x = m * col + col / 2;
    const mx = w.months.tmax[m];
    const mn = w.months.tmin[m];
    if (mx !== null && mn !== null) {
      const hot = w.hot.length && mx >= 40;
      svg.append(sv('rect', { x: x - 4, y: ty(mx), width: 8, height: Math.max(2, ty(mn) - ty(mx)), rx: 2, fill: hot ? '#e5484d' : mn < 0 ? '#8cc4ff' : '#f0b04b' }));
    }
    const ph = (w.months.prec[m] / pMax) * 18;
    svg.append(sv('rect', { x: x - 4, y: 58 - ph, width: 8, height: Math.max(0.5, ph), fill: '#4a90c8' }));
    const lbl = svText(x, 70, MONTHS[m], { 'text-anchor': 'middle', 'font-size': 8.5, fill: m === w.month - 1 ? '#fff' : '#7f8994', 'font-weight': m === w.month - 1 ? 700 : 400 });
    svg.append(lbl);
    if (m === w.month - 1) svg.append(sv('rect', { x: x - col / 2 + 1, y: 1, width: col - 2, height: 72, rx: 3, fill: 'none', stroke: '#fff', 'stroke-width': 1 }));
  }
  return section(
    'W',
    `Weather · ${w.monthName}`,
    svg,
    soft(
      el('b', undefined, `${w.monthName}: ${w.tmax ?? '?'}° / ${w.tmin ?? '?'}° · ${w.precMm} mm`),
      w.precYearMm !== null ? ` · ${w.precYearMm} mm a year` : '',
      w.frost.length ? ` · frost ${w.frost.length} months` : ' · no frost',
      w.hot.length ? ` · 40°+ ${w.hot.length} months` : '',
    ),
  );
}

export function weatherIcons(w: WeatherReading): HTMLElement {
  const g = el('div', 'ms-gx-icons');
  const box = (big: string, small: string) => {
    const d = el('div');
    d.append(el('b', undefined, big), el('small', undefined, small));
    return d;
  };
  g.append(box(`${w.tmax ?? '?'}° / ${w.tmin ?? '?'}°`, 'High / low'), box(`${w.precMm} mm`, 'Rain'), box(w.windMs !== null ? `${w.windMs} m/s` : 'n/a', 'Wind'));
  return section(
    'W',
    `Weather · ${w.monthName}`,
    g,
    soft(w.frost.length ? `Frost in ${w.frost.join(', ')}` : 'No frost month', w.hot.length ? ` · 40°+ in ${w.hot.join(', ')}` : '', w.monsoonPct !== null ? ` · ${w.monsoonPct} % of the rain in the monsoon` : ''),
  );
}
