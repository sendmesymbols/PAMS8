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

export function groundRelief(g: GroundReading): HTMLElement {
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
    `Ground · ${g.terrain?.label ?? 'Relief'}`,
    svg,
    gauge,
    soft(
      g.slopeDeg !== null ? `${g.slopeApprox ? 'About ' : ''}${Math.round(g.slopeDeg)}° slope` : 'Slope not known',
      g.terrainChange ? ` · ${g.terrainChange.label} ${fmtDistance(g.terrainChange.distanceM)} ${g.terrainChange.compass}` : '',
      g.high ? ` · high ground ${g.high.aboveM !== null ? `+${g.high.aboveM} m ` : ''}${at(g.high)}` : '',
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
  if (g.high) c.append(chip(`▲ ${g.high.aboveM !== null ? `+${g.high.aboveM} m` : `${g.high.elevationM} m`} ${at(g.high)}`, '#ffd27a'));
  if (g.water[0]) c.append(chip(`${g.water[0].label} ${at(g.water[0])}`, '#4a90c8'));
  if (g.namedWater) c.append(chip(`${nameOf(g.namedWater)} ${at(g.namedWater)}`, '#4a90c8'));
  if (g.area) c.append(chip(nameOf(g.area), '#8fb35a'));
  return section('G', 'Ground', c);
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
  if (!x) return 'No road or track within 500 m';
  return [x.typeLabel, x.tier ? x.tierLabel : null, x.on ? 'here' : at(x), x.msr ? 'MSR' : null].filter(Boolean).join(' · ');
}

export function roadsShield(r: RoadsReading): HTMLElement {
  const rec = r.record;
  const rt = rec?.route;
  const id = rec?.number ?? rt?.number ?? null;
  const sign = el('div', 'ms-gx-sign');
  const sh = el('div', `ms-gx-shield${rt?.msr || r.route?.msr ? ' ms-msr' : ''}`, id ?? (r.route?.typeLabel.split(' ')[0] ?? 'Road'));
  const txt = el('div');
  txt.append(el('b', undefined, rt?.from && rt?.to ? `${rt.from} to ${rt.to}` : rec?.name ?? rt?.name ?? r.route?.typeLabel ?? 'No named road near'));
  txt.append(soft([rt?.km ? `${Math.round(rt.km)} km` : null, rec ? at(rec) : r.route ? (r.route.on ? 'here' : at(r.route)) : null, rec?.defence ? 'defence road' : null].filter(Boolean).join(' · ')));
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
  return section('R', 'Roads, Tracks & Rail', sign, chips.childElementCount ? chips : null, r.check ? soft(r.check.text) : null);
}

export function roadsVerdict(r: RoadsReading): HTMLElement {
  return section('R', 'Route for the Mode', checkBig(r.check) ?? soft('No rule for this mode on this route'), soft(routeLine(r)), r.record ? soft(`${r.record.number ?? r.record.name ?? 'Road'} ${at(r.record)}`) : null);
}

// ── O ────────────────────────────────────────────────────────────────────────
function obstacleTile(title: string, o: ObstacleHit | null): HTMLElement {
  const t = el('div', 'ms-gx-tile');
  if (o?.effect) t.style.borderColor = EFFECT[o.effect];
  t.append(el('small', undefined, title));
  if (o) t.append(el('b', undefined, o.label), el('span', undefined, `${at(o)}${o.effect ? ` · ${o.effect}` : ''}`));
  else t.append(el('span', undefined, 'None mapped near'));
  return t;
}

export function obstaclesTiles(o: ObstaclesReading): HTMLElement {
  const g = el('div', 'ms-gx-tiles');
  g.append(obstacleTile('Natural', o.natural), obstacleTile('Man-made', o.manMade));
  const extra = [o.wet ? `${o.wet} here` : null, o.closure ? `${o.closure.road} ${at(o.closure)}: ${o.closure.closed ? `closed (${o.closure.closed})` : `${o.closure.landslides} landslide sites`}` : null].filter(Boolean).join(' · ');
  return section('O', 'Obstacles', g, extra ? soft(extra) : null);
}

export function obstaclesGap(o: ObstaclesReading): HTMLElement {
  const c = o.canal;
  const r = o.reach;
  const W = 256;
  const H = 66;
  const gap = c && (c.widthM || c.depthM) ? { name: nameOf(c), at: at(c), w: c.widthM, d: c.depthM, b: c.bankM } : r && r.depthM ? { name: r.name ?? 'River reach', at: at(r), w: null, d: r.depthM, b: null } : null;
  if (!gap) return obstaclesTiles(o);
  const svg = sv('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cross-section of the gap' });
  // Banks, then a trapezoid channel scaled to the gap; the water fills two thirds of the depth.
  const top = 14;
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
  if (gap.w) svg.append(sv('line', { x1: x0, y1: 6, x2: x1, y2: 6, stroke: '#fff', 'stroke-width': 1 }), svText(W / 2 - 18, 10, `${gap.w} m wide`, { fill: '#fff', 'font-weight': 700 }));
  if (gap.d) svg.append(svText(x1 - 4, top + bank + dPx - 2, `${gap.d} m deep`, { fill: '#fff', 'text-anchor': 'end' }));
  if (gap.b) svg.append(svText(4, top + bank - 4, `banks ${gap.b} m`, { fill: '#e8ebee' }));
  const hit = o.manMade?.label?.toLowerCase().includes('canal') ? o.manMade : o.natural;
  return section('O', 'Obstacles · Gap', svg, soft(el('b', undefined, gap.name), ` · ${gap.at}`, hit?.effect ? ` · ${hit.effect} for the mode` : '', r && gap.w === null && r.currentMs ? ` · ${r.currentMs} m/s` : ''));
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
  if (b.border) {
    const near = b.border.distanceKm < 10;
    const v = el('span');
    const s = el('b', undefined, `${b.border.distanceKm < 10 ? b.border.distanceKm.toFixed(1) : Math.round(b.border.distanceKm)} km ${b.border.compass}`);
    if (near) s.style.color = '#ff8a8d';
    v.append(s, ` · ${b.border.kind}`);
    g.append(el('span', undefined, 'Border'), v);
  }
  row('Place', b.settlement ? `${b.settlement.sizeClass} · ${at(b.settlement)}` : null, b.settlement ? nameOf(b.settlement) : null);
  row('Buildings', b.density ? (b.density.code ? b.density.label : 'None mapped here') : null);
  return section('B', 'Built-Up Areas · Where', g);
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
    'Protected Sites & Services',
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
