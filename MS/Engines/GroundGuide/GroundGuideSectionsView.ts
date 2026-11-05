/**
 * GroundGuideSectionsView.ts
 *
 * The G, R (with road network density and the recorded road), O (obstacles), B (buildings, admin, places) and W sections of the Ground Guide card and Ground Brief, from `v.sections`
 * (GroundGuideSections.ts). `groundGuide.sections.style`:
 *   lines    each section as a few label / value rows (the default)
 *   compact  one line per section, behind its letter
 *   brief    nothing on the card; only the Ground Brief (G) shows them
 * DOM nodes and textContent only (feature names never become markup). CSS injected once.
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { registerBriefSection } from './GroundGuideBrief';
import { buildingsProtected, buildingsWhere, groundChips, groundRelief, obstaclesGap, obstaclesTiles, roadsShield, roadsVerdict, weatherIcons, weatherYear as weatherYearStrip } from './GroundGuideSectionsStyles';
import type { BuildingsReading, GroundGuideSections, GroundReading, ObstacleHit, ObstaclesReading, RoadRecord, RoadsReading, SectionPlace, WeatherReading } from './GroundGuideSections';
import type { GroundGuideVerdict } from './GroundGuideTypes';
import { roadDensityText, type RoadDensityReading } from './GroundGuideRoadDensity';
import { chipsNode, densityBrief, densityCardBlock, densityOneLine, densityRows, type RoadDensityLead } from './GroundGuideRoadDensityView';

const STYLE_ID = 'ms-ground-guide-sections-style';
/** Letter colours (doc 16 §4.1); W is a supplementary heading (GROTBC.md 7), in its own blue-grey. */
const LETTER: Record<'G' | 'R' | 'O' | 'B' | 'W', [string, string]> = {
  G: ['#8fb35a', '#1b1f25'],
  R: ['#c9a46b', '#1b1f25'],
  O: ['#7a5cc9', '#fff'],
  B: ['#9a8f86', '#1b1f25'],
  W: ['#4a7f95', '#fff'],
};
const CHECK: Record<string, [string, string]> = {
  ok: ['#1d3a2a', '#7ee0a5'],
  warn: ['#3a2a14', '#ffb766'],
  stop: ['#3d1c1e', '#ff8a8d'],
  unknown: ['#2e2a1c', '#ffd27a'],
};

const CSS = `
.ms-gs-cap{display:flex;align-items:center;gap:6px}
.ms-gs-l{display:inline-flex;align-items:center;justify-content:center;flex:none;width:15px;height:15px;border-radius:4px;font:800 10px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0}
.ms-gs-kv{display:grid;grid-template-columns:56px minmax(0,1fr);gap:3px 8px;font-size:11.5px;line-height:1.35}
.ms-gs-kv>.ms-gs-k{color:#9aa3ad;font-size:10.5px;padding-top:1px}
.ms-gs-kv>.ms-gs-v{min-width:0;color:#e8ebee}
.ms-gs-kv b{color:#fff;font-weight:600}
.ms-gs-kv .ms-gs-s{color:#9aa3ad}
.ms-gs-chip{display:inline-block;font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:3px 6px 2px;border-radius:999px;vertical-align:1px;margin-left:4px;white-space:nowrap}
.ms-gs-msr{background:#d64541;color:#fff}
.ms-gs-check{margin-top:4px;font-size:11px;border-radius:5px;padding:4px 7px;line-height:1.3}
.ms-gs-one{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;line-height:1.35}
.ms-gs-one+.ms-gs-one{margin-top:4px}
.ms-gs-one>span:last-child{min-width:0}
.ms-gs-one b{color:#fff;font-weight:600}
.ms-gs-src{color:#7f8994;font-size:10px;margin-top:4px}
`;

export function ensureSectionsCss(): void {
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

function letter(l: keyof typeof LETTER): HTMLElement {
  const b = el('span', 'ms-gs-l', l);
  b.style.background = LETTER[l][0];
  b.style.color = LETTER[l][1];
  return b;
}

function section(l: keyof typeof LETTER, caption: string, ...content: Array<Node | null>): HTMLElement {
  const sec = el('div', 'ms-ggb-sec');
  const cap = el('div', 'ms-ggb-cap ms-gs-cap');
  cap.append(letter(l), caption);
  sec.append(cap, ...content.filter((c): c is Node => c !== null));
  return sec;
}

/** Label / value rows; a row whose value is null is left out. */
function kv(rows: Array<[string, Node | string | null]>): HTMLElement | null {
  const g = el('div', 'ms-gs-kv');
  for (const [k, v] of rows) {
    if (v === null || v === '') continue;
    const val = el('div', 'ms-gs-v');
    val.append(v);
    g.append(el('div', 'ms-gs-k', k), val);
  }
  return g.childElementCount ? g : null;
}

function frag(...parts: Array<Node | string | null | false>): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const p of parts) if (p !== null && p !== false && p !== '') f.append(p);
  return f;
}

function b(text: string): HTMLElement {
  return el('b', undefined, text);
}

function soft(text: string): HTMLElement {
  return el('span', 'ms-gs-s', text);
}

function at(p: SectionPlace): string {
  return `${fmtDistance(p.distanceM)} ${p.compass}`;
}

/** "Kahan Nala (Stream)" / "Tube well"; the label is left out when the name already says it ("Pabbi Reserved Forest"). */
function nameOf(p: SectionPlace): string {
  return p.name ? (says(p) ? p.name : `${p.name} (${p.label})`) : p.label;
}

function says(p: SectionPlace): boolean {
  return !!p.name && p.name.toLowerCase().includes(p.label.toLowerCase().replace(/ \(.*\)$/, ''));
}

/** The soft kind after a bold name, unless the name already says it. */
function kindAfter(p: SectionPlace): string {
  return says(p) ? '' : ` ${p.label.toLowerCase()}`;
}

/** Months as runs: ["Dec", "Jan", "Feb"] -> "Dec to Feb"; ["Jul", "Aug", "Sep"] -> "Jul to Sep". */
export function monthRuns(ms: string[]): string {
  const ALL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!ms.length) return 'none';
  if (ms.length === 12) return 'all year';
  const on = ALL.map((m) => ms.includes(m));
  const start = on.findIndex((v, i) => v && !on[(i + 11) % 12]);
  const runs: string[] = [];
  for (let k = 0, i = start; k < 12; k++, i = (i + 1) % 12) {
    if (!on[i] || on[(i + 11) % 12]) continue;
    let j = i;
    while (on[(j + 1) % 12] && (j + 1) % 12 !== i) j = (j + 1) % 12;
    runs.push(i === j ? ALL[i] : `${ALL[i]} to ${ALL[j]}`);
  }
  return runs.join(', ');
}

// ── G ────────────────────────────────────────────────────────────────────────
function slopeText(g: GroundReading): string | null {
  if (g.slopeDeg === null) return null;
  return `${g.slopeApprox ? 'about ' : ''}${Math.round(g.slopeDeg)}° ${g.slopeBand}`;
}

function groundRows(g: GroundReading): Array<[string, Node | string | null]> {
  const relief = [g.elevationM !== null ? `${g.elevationM} m` : null, slopeText(g), g.landform].filter(Boolean) as string[];
  return [
    ['Terrain', g.terrain ? frag(b(g.terrain.label), g.terrainChange && soft(` · ${g.terrainChange.label} ${fmtDistance(g.terrainChange.distanceM)} ${g.terrainChange.compass}`)) : null],
    ['Relief', relief.length ? frag(b(relief[0]), relief.length > 1 && soft(` · ${relief.slice(1).join(' · ')}`)) : null],
    ['High', g.high ? frag(b(`${g.high.elevationM} m`), soft(` ${nameOf(g.high)} · ${at(g.high)}${g.high.aboveM !== null ? ` · ${g.high.aboveM} m above` : ''}`)) : null],
    ['Area', g.area ? frag(b(g.area.name ?? g.area.label), soft(`${g.area.name ? kindAfter(g.area) : ''} · ${at(g.area)}`)) : null],
    ['Water', g.water.length ? g.water.slice(0, 3).map((w) => `${w.label} ${at(w)}`).join(' · ') : null],
    ['River', g.namedWater ? frag(b(g.namedWater.name ?? g.namedWater.label), soft(`${g.namedWater.name ? kindAfter(g.namedWater) : ''} · ${at(g.namedWater)}`)) : null],
    ['Ridge', g.ridge ? frag(b(g.ridge.crestM !== null ? `Crest ${g.ridge.crestM} m` : 'Ridgeline'), soft(`${g.ridge.lengthKm !== null ? ` · ${g.ridge.lengthKm} km long` : ''} · ${fmtDistance(g.ridge.distanceM)} ${g.ridge.compass}`)) : null],
  ];
}

function groundOne(g: GroundReading): string {
  return [g.terrain?.label, g.elevationM !== null ? `${g.elevationM} m` : null, slopeText(g), g.landform].filter(Boolean).join(' · ') || 'No relief data';
}

// ── R ────────────────────────────────────────────────────────────────────────
function routeNode(r: NonNullable<RoadsReading['route']>): DocumentFragment {
  const f = frag(b(r.typeLabel));
  if (r.tier > 0 || [14, 15, 16, 17, 18, 19, 20, 21, 22].includes(r.type)) f.append(soft(` · ${r.tierLabel}`));
  if (!r.on) f.append(soft(` · ${fmtDistance(r.distanceM)} ${r.compass}`));
  if (r.msr) f.append(' ', el('span', 'ms-gs-chip ms-gs-msr', 'MSR'));
  return f;
}

function checkBox(c: RoadsReading['check']): HTMLElement | null {
  if (!c) return null;
  const d = el('div', 'ms-gs-check', c.text);
  d.style.background = CHECK[c.level][0];
  d.style.color = CHECK[c.level][1];
  return d;
}

/** The named road nearest the point: "N-75 · Murree to Muzaffarabad · 110 km · MSR". */
function namedRoad(rec: RoadRecord): Node | null {
  const rt = rec.route;
  const id = rec.number ?? rt?.number ?? rec.name ?? rt?.name;
  if (!id) return null;
  const between = rt?.from && rt?.to ? `${rt.from} to ${rt.to}` : rec.name && rec.name !== id ? rec.name : null;
  const f = frag(b(id), soft([between, rt?.km ? `${Math.round(rt.km)} km` : null, `${fmtDistance(rec.distanceM)} ${rec.compass}`].filter(Boolean).map((x) => ` · ${x}`).join('')));
  if (rt?.msr) f.append(' ', el('span', 'ms-gs-chip ms-gs-msr', 'MSR'));
  if (rec.defence) f.append(' ', el('span', 'ms-gs-chip ms-gs-msr', 'Defence road'));
  return f;
}

/** What is recorded on that road. Safety first: no record is said as "not recorded", never as "good" or "open". */
function recordText(rec: RoadRecord): string {
  const rt = rec.route;
  return [
    rec.loadCode ? `load ${rec.loadCode}` : rt?.load ? `class ${rt.load[0] === rt.load[1] ? rt.load[0] : `${rt.load[0]} to ${rt.load[1]}`}` : 'load class not recorded',
    rec.widthM ? `${rec.widthM} m wide` : null,
    `condition ${rec.condition ?? rt?.condition ?? 'not recorded'}`,
    rec.closed || rt?.closed ? `closed: ${rec.closed ?? rt?.closed}` : 'no closure recorded',
    rec.landslides ? `${rec.landslides} landslide site${rec.landslides > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');
}

function roadsRows(r: RoadsReading): Array<[string, Node | string | null]> {
  return [
    [r.route?.on ? 'Here' : 'Nearest', r.route ? routeNode(r.route) : 'No road or track within 500 m'],
    ['Road', r.record ? namedRoad(r.record) : null],
    ['Recorded', r.record ? recordText(r.record) : null],
    ['Crossing', r.crossing ? `${nameOf(r.crossing)} ${at(r.crossing)}` : null],
    ['Rail', r.rail ? `${nameOf(r.rail)} ${at(r.rail)}` : null],
    ['Air', r.air ? `${nameOf(r.air)} ${at(r.air)}` : null],
  ];
}

function roadsOne(r: RoadsReading, lead: RoadDensityLead, withDensity: boolean): string {
  const d = r.density;
  const dens = d && withDensity ? densityOneLine(d, lead) : null;
  if (!r.route) return ['No road or track within 500 m', dens].filter(Boolean).join(' · ');
  const x = r.route;
  return [x.on ? x.typeLabel : `${x.typeLabel} ${fmtDistance(x.distanceM)} ${x.compass}`, x.tier ? x.tierLabel : null, x.msr ? 'MSR' : null, dens].filter(Boolean).join(' · ');
}

// ── R: road network density (GroundGuideRoadDensityView, styles D1-D7) ───────
/** The density rows for the lines-style R grid: D1 rows, or a D2 chip row. */
function densityGridRows(s: GroundGuideSections, d: RoadDensityReading | null): Array<[string, Node | string | null]> {
  if (!d) return [];
  if (s.roadDensityStyle === 'rows') return densityRows(d, s.roadDensityLead);
  if (s.roadDensityStyle === 'chip') return [['Density', chipsNode(d, s.roadDensityLead)]];
  return [];
}

// ── B ────────────────────────────────────────────────────────────────────────
function buildingsRows(bd: BuildingsReading): Array<[string, Node | string | null]> {
  const dens = bd.density;
  return [
    ['Buildings', dens ? (dens.code === 0 ? 'None mapped here' : frag(b(dens.label), soft([bd.size, bd.height].filter(Boolean).map((x) => ` · ${x}`).join('')))) : null],
    ['Kacha huts', bd.huts ? (bd.huts.perKm2 || bd.huts.temporary ? `${bd.huts.perKm2 ? `about ${bd.huts.perKm2} per km²` : 'none mapped'}${bd.huts.temporary ? ' · temporary huts nearby' : ''}` : 'None mapped') : null],
    ['Services', bd.services.length ? bd.services.slice(0, 3).map((s) => `${s.label} ${at(s)}`).join(' · ') : null],
    ['Security', bd.security.length ? bd.security.map((s) => `${nameOf(s)} ${at(s)}`).join(' · ') : null],
    ['Place', bd.settlement ? frag(b(bd.settlement.name ?? bd.settlement.label), soft(` · ${bd.settlement.sizeClass}${bd.settlement.people ? `, about ${bd.settlement.people.toLocaleString('en-US')} people` : ''} · ${at(bd.settlement)}`)) : null],
    ['Landmarks', bd.landmarks.length ? bd.landmarks.map((s) => `${nameOf(s)} ${at(s)}`).join(' · ') : null],
    ['Utilities', bd.utilities.length ? bd.utilities.map((s) => `${nameOf(s)} ${at(s)}`).join(' · ') : null],
    ['Admin', bd.admin ? [bd.admin.tehsil && `Tehsil ${bd.admin.tehsil}`, bd.admin.district && `District ${bd.admin.district}`, bd.admin.province].filter(Boolean).join(' · ') : null],
    ['Sheet', bd.sheet ? [bd.sheet.s50k && `1:50k ${bd.sheet.s50k}`, bd.sheet.s250k && `1:250k ${bd.sheet.s250k}`].filter(Boolean).join(' · ') : null],
    ['Border', bd.border ? `${bd.border.kind} ${bd.border.distanceKm < 10 ? bd.border.distanceKm.toFixed(1) : Math.round(bd.border.distanceKm)} km ${bd.border.compass}` : null],
  ];
}

function buildingsOne(bd: BuildingsReading): string {
  return [
    bd.density ? (bd.density.code ? `Buildings ${bd.density.label.split(' (')[0].toLowerCase()}` : 'No buildings') : null,
    bd.huts?.perKm2 ? `${bd.huts.perKm2} huts per km²` : null,
    bd.services[0] ? `${bd.services[0].label} ${at(bd.services[0])}` : null,
    bd.admin?.tehsil ? `Tehsil ${bd.admin.tehsil}` : bd.admin?.district ? `District ${bd.admin.district}` : null,
  ].filter(Boolean).join(' · ');
}

// ── O ────────────────────────────────────────────────────────────────────────
const EFFECT: Record<'NO-GO' | 'SLOW-GO', [string, string]> = { 'NO-GO': ['#e5484d', '#fff'], 'SLOW-GO': ['#f0932b', '#1b1f25'] };

function obstacleNode(o: ObstacleHit): Node {
  const f = frag(b(o.label), soft(` · ${fmtDistance(o.distanceM)} ${o.compass}`));
  if (o.effect) {
    const c = el('span', 'ms-gs-chip', o.effect);
    c.style.background = EFFECT[o.effect][0];
    c.style.color = EFFECT[o.effect][1];
    f.append(' ', c);
  }
  return f;
}

function obstaclesRows(o: ObstaclesReading): Array<[string, Node | string | null]> {
  const c = o.canal;
  const r = o.reach;
  return [
    ['Natural', o.natural ? obstacleNode(o.natural) : 'None mapped near'],
    ['Man-made', o.manMade ? obstacleNode(o.manMade) : 'None mapped near'],
    ['Here', o.wet],
    ['Canal', c ? frag(b(nameOf(c)), soft([at(c), c.widthM ? `${c.widthM} m wide` : null, c.depthM ? `${c.depthM} m deep` : null, c.bankM ? `banks ${c.bankM} m` : null].filter(Boolean).map((x, i) => (i ? ` · ${x}` : ` ${x}`)).join(''))) : null],
    ['River', r ? frag(b(r.name ?? 'River reach'), soft([at(r), r.bed ? `bed ${r.bed.toLowerCase()}` : null, r.depthM ? `${r.depthM} m deep` : null, r.currentMs ? `${r.currentMs} m/s` : null].filter(Boolean).map((x) => ` · ${x}`).join(''))) : null],
    ['Dam', o.dam ? `${nameOf(o.dam)} ${at(o.dam)}` : null],
    ['Levee', o.levee ? `${nameOf(o.levee)} ${at(o.levee)}` : null],
    ['Closures', o.closure ? `${o.closure.road} ${fmtDistance(o.closure.distanceM)} ${o.closure.compass}: ${[o.closure.closed ? `closed (${o.closure.closed})` : null, o.closure.landslides ? `${o.closure.landslides} landslide site${o.closure.landslides > 1 ? 's' : ''}` : null].filter(Boolean).join(', ')}` : 'None recorded near'],
  ];
}

function obstaclesOne(o: ObstaclesReading): string {
  const hit = (h: ObstacleHit | null) => (h ? `${h.label} ${fmtDistance(h.distanceM)} ${h.compass}${h.effect ? ` (${h.effect})` : ''}` : null);
  return [o.wet ? `${o.wet} here` : null, hit(o.manMade), hit(o.natural)].filter(Boolean).join(' · ') || 'No obstacle mapped near';
}

// ── W ────────────────────────────────────────────────────────────────────────
function weatherMonth(w: WeatherReading): string {
  const t = w.tmax !== null && w.tmin !== null ? `${w.tmax}° / ${w.tmin}°` : null;
  return [t, `${w.precMm} mm rain`, w.windMs !== null ? `wind ${w.windMs} m/s` : null].filter(Boolean).join(' · ');
}

function weatherYear(w: WeatherReading): string {
  return [
    w.precYearMm !== null ? `${w.precYearMm} mm a year${w.monsoonPct !== null ? `, ${w.monsoonPct} % in the monsoon` : ''}` : null,
    w.frost.length ? `frost ${monthRuns(w.frost)}` : 'no frost',
    w.hot.length ? `40° and over ${monthRuns(w.hot)}` : null,
  ].filter(Boolean).join(' · ');
}

/** One-line R: D1 adds "road density dense" to the line, D2 a chip, D3-D6 their block under it, D7 nothing. */
function compactR(s: GroundGuideSections, r: RoadsReading, one: (l: keyof typeof LETTER, text: string, extra?: HTMLElement | null) => HTMLElement): HTMLElement {
  const d = r.density;
  const st = s.roadDensityStyle;
  const sec = one('R', roadsOne(r, s.roadDensityLead, st === 'rows'), checkBox(r.check));
  if (d && st === 'chip') {
    const line = sec.querySelector('.ms-gs-one > span:last-child');
    line?.append(' ', chipsNode(d, s.roadDensityLead));
  }
  const block = densityCardBlock(d, st, s.roadDensityLead);
  if (block) sec.append(block);
  return sec;
}

/** The card's G / R / B / W sections in GROTBC order, each null when off or empty. */
export function sectionsCard(v: GroundGuideVerdict): { g: HTMLElement | null; r: HTMLElement | null; o: HTMLElement | null; b: HTMLElement | null; w: HTMLElement | null } {
  const s: GroundGuideSections | null | undefined = v.sections;
  const none = { g: null, r: null, o: null, b: null, w: null };
  if (!s || v.verdict === 'unknown') return none;
  // Each section's style (sections.gStyle ... wStyle); `auto` follows sections.style: compact -> line, lines -> rows,
  // brief -> nothing on the card. The drawn styles are in GroundGuideSectionsStyles.ts.
  const st = s.styles ?? { g: 'auto', r: 'auto', o: 'auto', b: 'auto', w: 'auto' };
  const res = (x: string): string => (x === 'auto' ? (s.style === 'compact' ? 'line' : s.style === 'lines' ? 'rows' : 'off') : x);
  const sg = res(st.g);
  const sr = res(st.r);
  const so = res(st.o);
  const sb = res(st.b);
  const sw = res(st.w);
  if ([sg, sr, so, sb, sw].every((x) => x === 'off')) return none;
  ensureSectionsCss();
  const one = (l: keyof typeof LETTER, text: string, extra?: HTMLElement | null) => {
    const sec = el('div', 'ms-ggb-sec');
    const row = el('div', 'ms-gs-one');
    row.append(letter(l), el('span', undefined, text));
    sec.append(row);
    if (extra) sec.append(extra);
    return sec;
  };
  // R keeps the road-density hooks in every style (GroundGuideRoadDensityView.ts).
  const withDensity = (sec: HTMLElement): HTMLElement => {
    const d = s.roads ? densityCardBlock(s.roads.density, s.roadDensityStyle, s.roadDensityLead) : null;
    if (d) sec.append(d);
    return sec;
  };
  const g = s.ground;
  const r = s.roads;
  const o = s.obstacles;
  const b = s.buildings;
  const w = s.weather;
  return {
    g: !g || sg === 'off' ? null
      : sg === 'line' ? one('G', groundOne(g))
      : sg === 'relief' ? groundRelief(g)
      : sg === 'chips' ? groundChips(g)
      : section('G', 'Ground', kv(groundRows(g))),
    r: !r || sr === 'off' ? null
      : sr === 'line' ? compactR(s, r, one)
      : sr === 'shield' ? withDensity(roadsShield(r))
      : sr === 'verdict' ? withDensity(roadsVerdict(r))
      : section('R', 'Roads, Tracks & Rail', kv([...roadsRows(r), ...densityGridRows(s, r.density)]), densityCardBlock(r.density, s.roadDensityStyle, s.roadDensityLead), checkBox(r.check)),
    o: !o || so === 'off' ? null
      : so === 'line' ? one('O', obstaclesOne(o))
      : so === 'tiles' ? obstaclesTiles(o)
      : so === 'gap' ? obstaclesGap(o)
      : section('O', 'Obstacles', kv(obstaclesRows(o))),
    b: !b || sb === 'off' ? null
      : sb === 'line' ? one('B', buildingsOne(b) || 'No buildings or services mapped')
      : sb === 'where' ? buildingsWhere(b)
      : sb === 'protected' ? buildingsProtected(b)
      : section('B', 'Built-Up Areas · Buildings', kv(buildingsRows(b))),
    w: !w || sw === 'off' ? null
      : sw === 'line' ? one('W', `${w.monthName}: ${weatherMonth(w)}`)
      : sw === 'year' ? weatherYearStrip(w)
      : sw === 'icons' ? weatherIcons(w)
      : section('W', `Weather · ${w.monthName}`, kv([[w.monthName, weatherMonth(w)], ['Year', weatherYear(w)]])),
  };
}

// ── Copy as Text ─────────────────────────────────────────────────────────────
function rowsText(rows: Array<[string, Node | string | null]>): string[] {
  return rows.filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : (v as Node).textContent ?? ''}`);
}

/** Plain-text lines for the Ground Brief's Copy as Text and for hosts. */
export function sectionsText(s: GroundGuideSections): string[] {
  const out: string[] = [];
  if (s.ground) out.push('G Ground', ...rowsText(groundRows(s.ground)).map((l) => `  ${l}`));
  if (s.roads) {
    out.push('R Roads, Tracks & Rail', ...rowsText(roadsRows(s.roads)).map((l) => `  ${l}`));
    if (s.roads.check) out.push(`  For the mode: ${s.roads.check.text}`);
    if (s.roads.density) out.push(...roadDensityText(s.roads.density).map((l) => `  ${l}`));
  }
  if (s.obstacles) out.push('O Obstacles', ...rowsText(obstaclesRows(s.obstacles)).map((l) => `  ${l}`));
  if (s.buildings) out.push('B Buildings', ...rowsText(buildingsRows(s.buildings)).map((l) => `  ${l}`));
  if (s.weather) out.push(`W Weather (${s.weather.source})`, `  ${s.weather.monthName}: ${weatherMonth(s.weather)}`, `  Year: ${weatherYear(s.weather)}`);
  return out;
}

// ── Ground Brief ─────────────────────────────────────────────────────────────
registerBriefSection({
  id: 'ground-relief',
  letter: 'G',
  order: 1,
  title: 'Terrain, Relief & Water',
  render: (v) => (v.sections?.ground ? (ensureSectionsCss(), kv(groundRows(v.sections.ground))) : null),
  text: (v) => (v.sections?.ground ? rowsText(groundRows(v.sections.ground)) : []),
});
registerBriefSection({
  id: 'roads-here',
  letter: 'R',
  order: 1,
  title: 'Route Here & Nearby',
  render: (v) => {
    const r = v.sections?.roads;
    if (!r) return null;
    ensureSectionsCss();
    const w = el('div');
    const g = kv(roadsRows(r));
    if (g) w.append(g);
    const c = checkBox(r.check);
    if (c) w.append(c);
    return w;
  },
  text: (v) => {
    const r = v.sections?.roads;
    return r ? [...rowsText(roadsRows(r)), ...(r.check ? [`For the mode: ${r.check.text}`] : [])] : [];
  },
});
registerBriefSection({
  id: 'road-density',
  letter: 'R',
  order: 2,
  title: 'Road Network Density',
  render: (v) => {
    const d = v.sections?.roads?.density;
    if (!d) return null;
    ensureSectionsCss();
    return densityBrief(d, kv);
  },
  text: (v) => (v.sections?.roads?.density ? roadDensityText(v.sections.roads.density) : []),
});
registerBriefSection({
  id: 'obstacles',
  letter: 'O',
  order: 1,
  title: 'Obstacles: Natural, Man-Made, Temporary',
  render: (v) => (v.sections?.obstacles ? (ensureSectionsCss(), kv(obstaclesRows(v.sections.obstacles))) : null),
  text: (v) => (v.sections?.obstacles ? rowsText(obstaclesRows(v.sections.obstacles)) : []),
});
registerBriefSection({
  id: 'buildings',
  letter: 'B',
  order: 20,
  title: 'Buildings, Huts & Services',
  render: (v) => (v.sections?.buildings ? (ensureSectionsCss(), kv(buildingsRows(v.sections.buildings))) : null),
  text: (v) => (v.sections?.buildings ? rowsText(buildingsRows(v.sections.buildings)) : []),
});
registerBriefSection({
  id: 'weather',
  letter: 'T',
  order: 40,
  title: 'Weather (W)',
  render: (v) => {
    const w = v.sections?.weather;
    if (!w) return null;
    ensureSectionsCss();
    const box = el('div');
    const g = kv([[w.monthName, weatherMonth(w)], ['Year', weatherYear(w)], ['Wet', w.wet.length ? monthRuns(w.wet) : 'no wet month'], ['Fog', 'Not in the data: the climate normals carry no fog or visibility']]);
    if (g) box.append(g);
    box.append(el('div', 'ms-gs-src', `${w.source}; one cell is about 9 km, so hill tops run colder than shown`));
    return box;
  },
  text: (v) => (v.sections?.weather ? [`${v.sections.weather.monthName}: ${weatherMonth(v.sections.weather)}`, `Year: ${weatherYear(v.sections.weather)}`] : []),
});
