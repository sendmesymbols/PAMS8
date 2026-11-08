/**
 * GroundGuideTrafficView.ts
 *
 * T (Trafficability) on the Ground Guide card, on top of the going engine (`v.going`, GroundGuideGoing.ts).
 *
 * The separate pieces (each its own switch):
 *   pill   a header pill when rain makes the going worse ("Rain: NO-GO"), or the season is wet;
 *   dual   a second going scale under Why, for the other season;
 *   road   a Road band (or Landing, for a helicopter): the nearest road the mode can use.
 *
 * Or T as ONE block (`traffic.block`), which then takes the place of the Cross-Country and Movement sections and the
 * Road band (styles compared in ground-guide-t-presentation.html):
 *   band      the going now in large type, then why (soil), the road out and how open the ground is;
 *   gauge     one GO to NO-GO bar with a sun (dry) and a drop (after rain) marker;
 *   calendar  twelve months coloured by the going they leave, rain bars above, this month outlined;
 *   tiles     foot / wheels / tracks (and the mode being placed), each with a dry and an after-rain bar;
 *   wayout    a line to the road coloured by the going crossed, ending in the road's shield and class;
 *   rose      the movement rose with the road marked on its rim;
 *   ticker    one slim strip under the header;
 *   tabs      Now / Rain / Road / Months, one at a time; T cycles them while drawing.
 * `traffic.where` puts the block right after Why, in GROTBC order (after the G sections, before B), or folds it to
 * one line that T opens.
 *
 * Built from DOM nodes and `textContent` only, in the card's own classes plus a few of its own (injected once).
 *
 * Visual review (user, 2026-11-08): colours, sizes and the gauge come from GroundGuideTokens.ts. A going word carries
 * its ladder colour and icon (item 1); GO / SLOW-GO / NO-GO as a scale is the shared gauge, never a row of boxes
 * (item 2); roads are drawn in their class colours, off red and green (item 16): MSR white on a dark casing with the
 * letters MSR, all-weather blue, fair-weather violet, track dashed grey. No tracked capitals (item 13), one type
 * scale (item 17), no text dimmed by opacity (item 18). Cross-country directions are "Open Dirs 6 of 8" (item 10).
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { registerBriefSection } from './GroundGuideBrief';
import { band, ensureGoingCss, roseSvg, seasonIcon } from './GroundGuideGoingView';
import { sentenceCase } from './GroundGuideLegend';
import { compassNode } from './GroundGuideNorth';
import {
  ACCENT,
  ensureTokensCss,
  FONT,
  FS,
  FW,
  gauge,
  LETTER_FG,
  LETTER_FILL,
  ladderIcon,
  LINE,
  ROAD,
  ROSE_C,
  ROSE_R,
  STEP_COLOR,
  STEP_TEXT,
  SURFACE,
  TEXT,
  TONE,
  toneIcon,
  type Tone,
} from './GroundGuideTokens';
import type { TrafficRoad, TrafficRoadRef } from './GroundGuideTrafficability';
import type { GoingStep, GroundGuideCardOptions, GroundGuideVerdict } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-traffic-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const WORD: Record<GoingStep, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO' };
const ORDER: Record<GoingStep, number> = { go: 0, slow: 1, nogo: 2 };
/** Going on the dark card: segments, bars and cells (the ladder's dot colours). */
const COLOR = STEP_COLOR;
/** A going step on the verdict ladder: its chip fill and icon (item 1). */
const STEP_TONE: Record<GoingStep, Tone> = { go: 'go', slow: 'slow', nogo: 'nogo' };
const STEPS: GoingStep[] = ['go', 'slow', 'nogo'];
const MONTH_LETTER = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT: Record<string, string> = {
  dismounted: 'Foot', wheeled: 'Wheels', tracked: 'Tracks', hls: 'Air', pack: 'Pack', gun: 'Guns', ad: 'AD',
  signals: 'Signals', amphibious: 'Amphib', generic: 'Gr', roadbound: 'Rd', rail: 'Rail', vessel: 'Vessel', oversnow: 'Snow',
};
/** Line icons for the mode tiles, on a 24-unit grid (as the Legend's). */
const MODE_ICON: Record<string, string[]> = {
  dismounted: ['M15 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M12 8l-2 6', 'M9 11l3-3 3 3 2 0', 'M10 14l-2 7', 'M10 14l3 3v4'],
  wheeled: ['M2 7h11v8H2z', 'M13 10h4l3 3v2h-7', 'M8 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z', 'M18 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'],
  tracked: ['M5 14h14a3 3 0 0 1 0 6H5a3 3 0 0 1 0-6z', 'M8 14l1.5-4h6l1 4', 'M15 11.5h6', 'M7 17h.01', 'M12 17h.01', 'M17 17h.01'],
  hls: ['M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z', 'M9 8v8', 'M15 8v8', 'M9 12h6'],
  _: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
};

const CSS = `
.ms-ggb-tdual{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;align-items:center;margin-top:6px}
.ms-ggb-tdual>span{color:${TEXT.label};font:${FW.regular} ${FS.meta}px/1.3 ${FONT};white-space:nowrap}
.ms-ggb-tpill{display:flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,.2);font-size:${FS.meta}px;white-space:nowrap}
/* A going word as a chip: the ladder's fill, its text colour and its icon (item 1). */
.ms-ggb-tstep{display:inline-flex;align-items:center;gap:3px;font:${FW.bold} ${FS.meta}px/1 ${FONT};padding:3px 6px 3px 4px;border-radius:3px;vertical-align:-2px;white-space:nowrap}
.ms-ggb-tstep>svg{flex:none}
${STEPS.map((s) => `.ms-ggb-tstep.ms-${s}{background:${TONE[STEP_TONE[s]].fill};color:${TONE[STEP_TONE[s]].fg}}`).join('')}
/* The other season's word in the ticker: an outline in the step's colour (dimmed by colour, never by opacity). */
${STEPS.map((s) => `.ms-ggb-tstep.ms-${s}.ms-ggb-tdim{background:none;color:${STEP_TEXT[s]};box-shadow:inset 0 0 0 1px ${STEP_COLOR[s]}}`).join('')}
.ms-ggb-thead{display:flex;align-items:center;gap:4px 6px;flex-wrap:wrap}
.ms-ggb-tbig{display:inline-flex;align-items:center;gap:5px;font-size:${FS.value}px;font-weight:${FW.bold};color:${TEXT.strong}}
.ms-ggb-tbig>svg{flex:none;width:.95em;height:.95em}
${STEPS.map((s) => `.ms-ggb-tbig.ms-${s},.ms-ggb-tw.ms-${s}{color:${STEP_TEXT[s]}}`).join('')}
.ms-ggb-tw{font-weight:${FW.semi}}
.ms-ggb-tkv{display:grid;grid-template-columns:48px minmax(0,1fr);gap:5px 8px;align-items:start;margin-top:6px}
.ms-ggb-tkv>.ms-ggb-tk{color:${TEXT.label};font-size:${FS.meta}px;padding-top:1px;display:flex;align-items:center;gap:3px}
.ms-ggb-tkv>.ms-ggb-tstep{justify-self:start}
.ms-ggb-troad{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
/* Road shields in the road's class colour (item 16): MSR white on a dark casing, all-weather blue, fair-weather violet, track dashed grey. */
.ms-ggb-tshield{flex:none;font:${FW.bold} ${FS.meta}px/1 ${FONT};padding:3px 5px;border-radius:3px;white-space:nowrap;color:${ROAD.msrCasing};background:${ROAD.allWeather}}
.ms-ggb-tshield.ms-msr{background:${ROAD.msr};box-shadow:inset 0 0 0 1.5px ${ROAD.msrCasing}}
.ms-ggb-tshield.ms-fw{background:${ROAD.fairWeather}}
.ms-ggb-tshield.ms-track{background:none;color:${TEXT.main};border:1.5px dashed ${ROAD.track};padding:1.5px 3.5px}
/* The road's class and weather: a plain line in sentence case (it was a small capital chip). */
.ms-ggb-ttag{display:block;margin-top:3px;font:${FW.regular} ${FS.meta}px/1.35 ${FONT};color:${TEXT.label}}
/* The going gauge with the season marks: a sun over the dry step, a drop over the step after rain. */
.ms-ggb-tsg{margin-top:6px}
.ms-ggb-tsg>.ms-gg-gz-bar{position:relative;height:26px}
.ms-ggb-tsg>.ms-gg-gz-bar>i.ms-on::after{display:none}
.ms-ggb-tsm{position:absolute;top:0;transform:translateX(-50%);display:flex;line-height:0}
.ms-ggb-tcal{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;margin-top:6px;align-items:end}
.ms-ggb-tcal>div{display:flex;flex-direction:column;align-items:center;gap:2px}
.ms-ggb-tcal b{display:block;width:100%;background:#4a90c8;border-radius:1px}
.ms-ggb-tcal i{display:block;width:100%;height:16px;border-radius:2px}
.ms-ggb-tcal i.ms-now{outline:1.5px solid ${TEXT.strong};outline-offset:1px}
.ms-ggb-tcal small{font:${FW.semi} ${FS.meta}px/1 ${FONT};color:${TEXT.label}}
/* Who can move here: flat columns, not pressable tiles (item 11); the mode being placed in the accent colour, its bars taller for the season now. */
.ms-ggb-ttiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(54px,1fr));gap:4px 0}
.ms-ggb-ttile{padding:3px 3px 2px;display:flex;flex-direction:column;align-items:center;gap:4px;color:${TEXT.label};border-left:1px solid ${LINE.soft}}
.ms-ggb-ttile:first-child{border-left:0}
.ms-ggb-ttile.ms-me{color:${ACCENT}}
.ms-ggb-ttile small{font-size:${FS.meta}px;color:${TEXT.label}}
.ms-ggb-ttile.ms-me small{color:${TEXT.main};font-weight:${FW.bold}}
.ms-ggb-ttile>span{display:flex;gap:2px;align-items:flex-end;height:10px}
.ms-ggb-ttile>span>i{display:block;width:16px;height:6px;border-radius:2px}
.ms-ggb-ttile>span>i.ms-now{height:10px}
.ms-ggb-tway{display:flex;align-items:center;margin-top:20px}
.ms-ggb-tway>.ms-dot{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid ${TEXT.strong};background:var(--pb-c,${TONE.chk.fill})}
.ms-ggb-tway>.ms-leg{flex:1;height:6px;border-radius:3px;margin:0 4px;position:relative}
.ms-ggb-tway>.ms-leg>span{position:absolute;left:50%;top:-18px;transform:translateX(-50%);font-size:${FS.meta}px;color:${TEXT.label};white-space:nowrap}
.ms-ggb-tway>.ms-end{flex:none;display:flex;flex-direction:column;align-items:center;gap:2px}
.ms-ggb-tway>.ms-end>small{font-size:${FS.meta}px;color:${TEXT.label}}
.ms-ggb-trose{display:flex;gap:10px;align-items:center}
.ms-ggb-trose>svg{flex:none}
.ms-ggb-ttick{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 11px;background:${SURFACE.ring};border-bottom:1px solid ${LINE.soft};font-size:${FS.meta}px}
.ms-ggb-ttick>.ms-t{font:${FW.bold} ${FS.meta}px/1 ${FONT};background:${LETTER_FILL};color:${LETTER_FG};border-radius:3px;padding:2px 4px}
.ms-ggb-ttick>.ms-sep{color:${LINE.ring}}
/* Now / Rain / Rd / Months: which page T is on, as a tab line (T turns it; nothing here is clicked). */
.ms-ggb-ttabs{display:flex;gap:3px;margin:1px 0 7px}
.ms-ggb-ttabs>span{flex:1;text-align:center;font:${FW.semi} ${FS.meta}px/1.2 ${FONT};padding:3px 0 4px;color:${TEXT.label};border-bottom:2px solid ${LINE.hair}}
.ms-ggb-ttabs>span.ms-on{color:${TEXT.main};font-weight:${FW.bold};border-bottom-color:${ACCENT}}
.ms-ggb-tcue{display:flex;align-items:center;gap:7px;color:${TEXT.label}}
.ms-ggb-tcue>.ms-grow{flex:1;min-width:0}
.ms-ggb-tkey{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:4px;
  font:${FW.bold} ${FS.meta}px/1 ${FONT};color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
.ms-ggb-tl{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;border-radius:4px;font:${FW.bold} ${FS.meta}px/1 ${FONT};color:${LETTER_FG};background:${LETTER_FILL}}
`;

export function ensureTrafficCss(): void {
  ensureTokensCss();
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

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * A going word as a chip: the ladder's fill and icon (item 1). `dim`: the other season in the ticker, drawn as an
 * outline in the step's colour on the ticker's own background (`cut`, for the mark in a filled icon).
 */
function step(s: GoingStep, dim = false): HTMLElement {
  const c = el('span', `ms-ggb-tstep ms-${s}${dim ? ' ms-ggb-tdim' : ''}`);
  c.append(dim ? ladderIcon(TONE[STEP_TONE[s]].icon, 12, SURFACE.ring) : toneIcon(STEP_TONE[s], 12), WORD[s]);
  return c;
}

/** The going in large type, in its colour with its icon (item 1). */
function bigWord(s: GoingStep): HTMLElement {
  const b = el('span', `ms-ggb-tbig ms-${s}`);
  b.append(ladderIcon(TONE[STEP_TONE[s]].icon, 16), WORD[s]);
  return b;
}

/** A going word in its colour inside running text. */
function word(s: GoingStep): HTMLElement {
  return el('span', `ms-ggb-tw ms-${s}`, WORD[s]);
}

function modeIcon(profile: string, size = 18): SVGElement {
  const svg = svgEl('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  });
  for (const d of MODE_ICON[profile] ?? MODE_ICON._) svg.append(svgEl('path', { d }));
  return svg;
}

/** The Why section the card built (`data-gg-why`; a stacked one's caption reads "Why"), when there is one. */
function whyOf(rows: HTMLElement[]): HTMLElement | null {
  const r = rows[0];
  return r && (r.dataset.ggWhy !== undefined || r.querySelector(':scope > .ms-ggb-cap')?.textContent === 'Why') ? r : null;
}

// ── what every block says ─────────────────────────────────────────────────

export interface TView {
  short: string;
  wet: boolean;
  dry: GoingStep;
  after: GoingStep;
  now: GoingStep;
  why: string;
  road: TrafficRoad | null;
}

function short(profile: string): string {
  return SHORT[profile] ?? profile;
}

/** The going at the point, dry and after rain (from `v.going`, else the verdict), and the season now. */
export function viewOf(v: GroundGuideVerdict): TView {
  const g = v.going;
  const pt = g?.point;
  const fromVerdict: GoingStep = v.verdict === 'ok' || v.verdict === 'near' ? 'go' : v.verdict === 'caution' ? 'slow' : 'nogo';
  const dry = pt?.dry ?? fromVerdict;
  const after = pt?.wet ?? dry;
  const wet = g?.season === 'wet';
  return { short: short(v.profile), wet, dry, after, now: wet ? after : dry, why: whyText(v), road: v.traffic?.road ?? null };
}

/** One line on why the going is what it is: the soil, its cone index against the vehicle's, or what limits it. */
export function whyText(v: GroundGuideVerdict): string {
  const g = v.going;
  const pt = g?.point;
  const soil = g?.soil;
  const name = soil ? `${soil.label} (${soil.mapped ? 'Mapped' : 'Modelled'})` : null;
  if (pt && ORDER[pt.wet] > ORDER[pt.dry]) {
    const ci = soil?.ciWet !== null && soil?.ciWet !== undefined && g?.vehicle ? `: cone index ${soil.ciWet}, needs ${g.vehicle.vci[1]} for GO` : '';
    return `${name ?? 'The Gr'}, ${(pt.limitWet ?? 'soft after rain').toLowerCase()}${ci}`;
  }
  if (pt && pt.dry !== 'go') return `${name ? `${name}: ` : ''}${pt.limitDry ?? 'limited by the Gr'}`;
  return name ? `${name}: firm enough dry and after rain` : v.reason ?? 'No soil data here';
}

/** A road's class (item 16): MSR, all-weather, fair-weather, or a track (an unnumbered fair-weather way: shield "Tr"). */
type RoadKind = 'msr' | 'aw' | 'fw' | 'track';

function roadKind(r: TrafficRoadRef): RoadKind {
  if (r.msr) return 'msr';
  if (r.allWeather) return 'aw';
  return r.shield === 'Tr' ? 'track' : 'fw';
}

/** The class under a way-out shield, the key to its colour. */
const ROAD_WORD: Record<RoadKind, string> = { msr: 'MSR', aw: 'All-weather', fw: 'Fair-weather', track: 'Tr' };
const ROAD_TITLE: Record<RoadKind, string> = { msr: 'Main supply route', aw: 'All-weather road', fw: 'Fair-weather road', track: 'Track' };

/** The road's shield in its class colour; an MSR carries the letters MSR (white on a dark casing). */
function shield(r: TrafficRoadRef): HTMLElement {
  const k = roadKind(r);
  const text = k === 'msr' ? (r.shield === 'Rd' || r.shield === 'Tr' ? 'MSR' : `MSR ${r.shield}`) : r.shield;
  const s = el('span', `ms-ggb-tshield ms-${k}`, text);
  s.title = ROAD_TITLE[k];
  return s;
}

/** The rim marker of a road on the movement rose, in the road's class colour. */
function roadMarker(r: TrafficRoadRef): Record<string, string | number> {
  switch (roadKind(r)) {
    case 'msr': return { fill: ROAD.msr, stroke: ROAD.msrCasing, 'stroke-width': 2 };
    case 'aw': return { fill: ROAD.allWeather, stroke: ROAD.msrCasing, 'stroke-width': 1.5 };
    case 'fw': return { fill: ROAD.fairWeather, stroke: ROAD.msrCasing, 'stroke-width': 1.5 };
    default: return { fill: SURFACE.ring, stroke: ROAD.track, 'stroke-width': 1.5, 'stroke-dasharray': '2 1.5' };
  }
}

/** The road out: shield, name and distance, its class tag, and an all-weather alternative. */
export function roadBlock(t: TView, compact = false): HTMLElement | null {
  const r = t.road;
  if (!r) return null;
  const box = el('div');
  if (!r.main) {
    box.append(el('span', undefined, r.text));
    return box;
  }
  const m = r.main;
  const row = el('div', 'ms-ggb-troad');
  const name = el('span');
  if (m.name) name.append(el('span', 'ms-ggb-b', m.name), ' · ');
  name.append(`${fmtDistance(m.distanceM)} ${m.compass}`);
  row.append(shield(m), name);
  box.append(row);
  if (!compact && m.tag) box.append(el('span', 'ms-ggb-ttag', sentenceCase(m.tag)));
  if (r.alt) {
    const a = r.alt;
    const alt = `${a.msr ? 'MSR ' : ''}${a.shield}${a.name ? ` ${a.name}` : ''} · ${fmtDistance(a.distanceM)} ${a.compass}`;
    box.append(el('div', 'ms-ggb-soft', t.wet ? `After rain use ${alt} (all-weather)` : `All-weather: ${alt}`));
  }
  if (r.crossCountry) box.append(el('div', 'ms-ggb-soft', `Or ${WORD[r.crossCountry]} Cross-Country`));
  return box;
}

/** The cross-country directions open to the mode, in the one form the Guide uses (item 10): "Open Dirs 6 of 8". */
function openDirs(m: NonNullable<NonNullable<GroundGuideVerdict['going']>['movement']>): string {
  return `Open Dirs ${m.open} of ${m.sectors.length} to ${fmtDistance(m.rangeM)}`;
}

export function moveText(v: GroundGuideVerdict): string | null {
  const m = v.going?.movement;
  if (!m) return null;
  const blocked = m.sectors.filter((x) => x.blockedBy && x.reachM < m.rangeM).sort((a, b) => a.reachM - b.reachM)[0];
  const base = openDirs(m);
  return blocked ? `${base} · ${blocked.compass} blocked at ${fmtDistance(blocked.reachM)} (${blocked.blockedBy!.toLowerCase()})` : base;
}

/** `moveText` as nodes: the blocked direction carries its arrow (exact bearing), which turns with the map. */
export function moveNode(v: GroundGuideVerdict): DocumentFragment | null {
  const m = v.going?.movement;
  if (!m) return null;
  const f = document.createDocumentFragment();
  const blocked = m.sectors.filter((x) => x.blockedBy && x.reachM < m.rangeM).sort((a, b) => a.reachM - b.reachM)[0];
  f.append(openDirs(m));
  if (blocked) f.append(' · ', compassNode(blocked.compass, blocked.bearingDeg), ` blocked at ${fmtDistance(blocked.reachM)} (${blocked.blockedBy!.toLowerCase()})`);
  return f;
}

/** "SLOW-GO  after rain" (or "GO  now, dry") and, in the dry season, what rain does. */
export function trafficHeadline(t: TView, what = ''): HTMLElement {
  const h = el('div', 'ms-ggb-thead');
  h.append(bigWord(t.now), el('span', 'ms-ggb-soft', `${what}${t.wet ? 'after rain' : 'now, dry'}`));
  if (!t.wet && t.after !== t.dry) h.append(el('span', 'ms-ggb-soft', '· after rain'), step(t.after));
  return h;
}

// ── the eight blocks ──────────────────────────────────────────────────────

function blockBand(v: GroundGuideVerdict, t: TView): HTMLElement {
  const kv = el('div', 'ms-ggb-tkv');
  kv.append(el('span', 'ms-ggb-tk', 'Why'), el('span', undefined, t.why));
  const road = roadBlock(t);
  if (road) kv.append(el('span', 'ms-ggb-tk', t.road!.caption === 'Landing' ? 'Land' : 'Rd'), road);
  const move = moveNode(v);
  if (move) {
    const span = el('span');
    span.append(move);
    kv.append(el('span', 'ms-ggb-tk', 'Move'), span);
  }
  return band('T', `Trafficability · ${t.short}`, trafficHeadline(t), kv);
}

/**
 * The shared going gauge (item 2) with the season marks: the step of the season now is lit, a sun stands over the
 * dry step and a drop over the step after rain (one mark, the season now, when rain changes nothing).
 */
function seasonGauge(t: TView): HTMLElement {
  const g = gauge(t.now);
  g.classList.add('ms-ggb-tsg');
  const bar = g.querySelector<HTMLElement>(':scope > .ms-gg-gz-bar');
  if (bar) {
    const mark = (s: GoingStep, season: 'dry' | 'wet') => {
      const m = el('span', 'ms-ggb-tsm');
      m.style.left = `${(((ORDER[s] * 2 + 1) / 6) * 100).toFixed(1)}%`;
      m.append(seasonIcon(season, 13));
      return m;
    };
    if (t.dry === t.after) bar.append(mark(t.now, t.wet ? 'wet' : 'dry'));
    else bar.append(mark(t.dry, 'dry'), mark(t.after, 'wet'));
  }
  const other = t.dry === t.after ? '' : t.wet ? `; dry ${WORD[t.dry]}` : `; after rain ${WORD[t.after]}`;
  g.setAttribute('aria-label', `Going: ${WORD[t.now]} ${t.wet ? 'after rain' : 'now, dry'}${other}`);
  return g;
}

export function blockGauge(_v: GroundGuideVerdict, t: TView): HTMLElement {
  return band('T', `Going · ${t.short}`, trafficHeadline(t), seasonGauge(t), el('div', 'ms-ggb-soft', t.why), roadBlock(t, true));
}

export function blockCalendar(v: GroundGuideVerdict, t: TView): HTMLElement {
  const c = v.going?.climate;
  if (!c) return band('T', `Going by Month · ${t.short}`, trafficHeadline(t), el('div', 'ms-ggb-soft', 'No climate data here'), roadBlock(t, true));
  const now = (v.going?.month ?? new Date().getMonth() + 1) - 1;
  const top = Math.max(...c.precMm, 1);
  const cal = el('div', 'ms-ggb-tcal');
  const wetMonths: string[] = [];
  c.precMm.forEach((mm, i) => {
    const wet = mm >= c.wetMm;
    if (wet && t.after !== t.dry) wetMonths.push(MONTH[i]);
    const d = el('div');
    const bar = el('b');
    bar.style.height = `${Math.max(2, Math.round((mm / top) * 14))}px`;
    const cell = el('i', i === now ? 'ms-now' : undefined);
    cell.style.background = COLOR[wet ? t.after : t.dry];
    cell.title = `${MONTH[i]}: ${Math.round(mm)} mm, ${WORD[wet ? t.after : t.dry]}`;
    d.append(bar, cell, el('small', undefined, MONTH_LETTER[i]));
    cal.append(d);
  });
  const note = wetMonths.length ? `${WORD[t.after]} in ${wetMonths.join(', ')} (wet months), ${WORD[t.dry]} the rest` : `${WORD[t.dry]} all year`;
  return band('T', `Going by Month · ${t.short}`, trafficHeadline(t), cal, el('div', 'ms-ggb-soft', `${note} · bars: rain`), roadBlock(t, true));
}

export function blockTiles(v: GroundGuideVerdict, t: TView): HTMLElement {
  const tiles = el('div', 'ms-ggb-ttiles');
  const modes = v.going?.modes?.length ? v.going.modes : [{ profile: v.profile, label: v.profileLabel, dry: t.dry, wet: t.after, active: true }];
  for (const m of modes) {
    const tile = el('div', `ms-ggb-ttile${m.active ? ' ms-me' : ''}`);
    tile.title = `${m.label}: dry ${WORD[m.dry]}, after rain ${WORD[m.wet]}`;
    const pair = el('span');
    [m.dry, m.wet].forEach((s, i) => {
      // Both bars keep their colour (each is a reading); the season now stands taller, as the lit step of a gauge.
      const b = el('i', t.wet === (i === 1) ? 'ms-now' : undefined);
      b.style.background = COLOR[s];
      pair.append(b);
    });
    tile.append(modeIcon(m.profile), el('small', undefined, short(m.profile)), pair);
    tiles.append(tile);
  }
  return band('T', 'Who Can Move Here', tiles, el('div', 'ms-ggb-soft', `Left bar dry, right bar after rain; the taller is now · ${t.why}`), roadBlock(t, true));
}

/**
 * The way out: the one road this mode can use to leave, the line to it coloured by the going crossed. Captioned
 * "Way Out to Rd" so it is not read as R's "Rds out" (roads crossing the circle) or the "Open Dirs" (item 10).
 */
export function blockWayOut(_v: GroundGuideVerdict, t: TView): HTMLElement {
  const m = t.road?.main;
  const caption = `Way Out to Rd · ${t.short}`;
  if (!m) return band('T', caption, trafficHeadline(t), roadBlock(t), el('div', 'ms-ggb-soft', t.why));
  const way = el('div', 'ms-ggb-tway');
  const leg = el('span', 'ms-leg');
  leg.style.background = COLOR[t.now];
  leg.append(el('span', undefined, `${fmtDistance(m.distanceM)} ${m.compass} · ${WORD[t.now]}`));
  const end = el('span', 'ms-end');
  const kind = roadKind(m);
  end.append(shield(m));
  if (kind === 'aw' || kind === 'fw') end.append(el('small', undefined, ROAD_WORD[kind])); // an MSR's or a track's shield already says it
  way.append(el('span', 'ms-dot'), leg, end);
  const info = el('div');
  info.style.marginTop = '6px';
  if (m.name) info.append(el('span', 'ms-ggb-b', m.name));
  if (m.tag) info.append(el('span', 'ms-ggb-ttag', sentenceCase(m.tag)));
  const alt = t.road?.alt
    ? el('div', 'ms-ggb-soft', `${t.wet ? 'After rain use' : 'All-weather:'} ${t.road.alt.msr ? 'MSR ' : ''}${t.road.alt.shield}${t.road.alt.name ? ` ${t.road.alt.name}` : ''} · ${fmtDistance(t.road.alt.distanceM)} ${t.road.alt.compass}`)
    : null;
  return band('T', caption, trafficHeadline(t), way, info.childElementCount ? info : null, alt, el('div', 'ms-ggb-soft', t.why));
}

function blockRose(v: GroundGuideVerdict, t: TView, northDeg: number): HTMLElement {
  const g = v.going;
  if (!g?.movement) return blockBand(v, t);
  const svg = roseSvg(g, 92, false, northDeg);
  const m = t.road?.main;
  const grp = svg.querySelector('[data-gv-rose]');
  if (m && grp) {
    // The road's marker sits on the rim in its map bearing, inside the group that turns with the map (the shared
    // 120-unit rose frame: centre ROSE_C, drawing radius ROSE_R).
    const c = ROSE_C;
    const a = (m.bearingDeg * Math.PI) / 180;
    const x = c + ROSE_R * Math.sin(a);
    const y = c - ROSE_R * Math.cos(a);
    grp.append(svgEl('rect', { x: x - 5, y: y - 5, width: 10, height: 10, rx: 2, ...roadMarker(m) }));
  }
  const text = el('div');
  const moveLine = el('div', 'ms-ggb-soft');
  moveLine.append(moveNode(v) ?? '');
  const head = el('div');
  head.append(bigWord(t.now));
  text.append(head, moveLine);
  if (m) {
    const r = el('div', 'ms-ggb-troad');
    r.style.marginTop = '4px';
    r.append(shield(m), el('span', undefined, `${fmtDistance(m.distanceM)} ${m.compass}`));
    text.append(r);
  } else if (t.road) text.append(el('div', undefined, t.road.text));
  const row = el('div', 'ms-ggb-trose');
  row.append(svg, text);
  return band('T', `Movement · ${t.short} · ${t.wet ? 'After Rain' : 'Dry'}`, row, el('div', 'ms-ggb-soft', t.why));
}

function blockTicker(_v: GroundGuideVerdict, t: TView): HTMLElement {
  const s = el('div', 'ms-ggb-ttick');
  s.append(el('span', 'ms-t', 'T'), seasonIcon('dry', 12), step(t.dry, t.wet), seasonIcon('wet', 12), step(t.after, !t.wet));
  const m = t.road?.main;
  if (m) s.append(el('span', 'ms-sep', '|'), shield(m), el('span', undefined, `${fmtDistance(m.distanceM)} ${m.compass}`));
  else if (t.road?.caption === 'Landing') s.append(el('span', 'ms-sep', '|'), el('span', undefined, t.road.text.split(' · ')[0]));
  return s;
}

function blockTabs(v: GroundGuideVerdict, t: TView): HTMLElement {
  const tab = v.traffic?.tab ?? 0;
  const tabs = el('div', 'ms-ggb-ttabs');
  ['Now', 'Rain', 'Rd', 'Months'].forEach((n, i) => tabs.append(el('span', i === tab ? 'ms-on' : undefined, n)));
  const body: Array<HTMLElement | null> = [];
  if (tab === 0) body.push(trafficHeadline(t), el('div', 'ms-ggb-soft', t.why));
  if (tab === 1) {
    const kv = el('div', 'ms-ggb-tkv');
    const k = (season: 'dry' | 'wet', label: string) => {
      const c = el('span', 'ms-ggb-tk');
      c.append(seasonIcon(season, 12), label);
      return c;
    };
    kv.append(k('dry', 'Dry'), step(t.dry), k('wet', 'Rain'), step(t.after));
    const soil = v.going?.soil;
    const veh = v.going?.vehicle;
    const ci = (n: number | null) => (n === null ? '?' : n >= 127 ? '127+' : String(n)); // the layer caps at 127
    body.push(kv, soil && veh ? el('div', 'ms-ggb-soft', `Cone index ${ci(soil.ciDry)} dry, ${ci(soil.ciWet)} after rain · ${t.short}: ${veh.vci[1]} for GO, ${veh.vci[0]} to move`) : el('div', 'ms-ggb-soft', t.why));
  }
  if (tab === 2) {
    const mv = moveNode(v);
    const line = mv ? el('div', 'ms-ggb-soft') : null;
    line?.append(mv!);
    body.push(roadBlock(t) ?? el('div', 'ms-ggb-soft', 'Rd line is off'), line);
  }
  if (tab === 3) {
    const cal = blockCalendar(v, t);
    cal.querySelector(':scope > .ms-ggb-cap')?.remove();
    body.push(...(Array.from(cal.children) as HTMLElement[]));
  }
  const cue = el('div', 'ms-ggb-soft ms-ggb-tcue');
  cue.style.marginTop = '6px';
  cue.append(el('span', 'ms-ggb-tkey', 'T'), 'Next tab');
  return band('T', `Trafficability · ${t.short}`, tabs, ...body, cue);
}

/** The one-line cue of a folded block: the going and the road, and the T key that opens it. */
function foldedCue(t: TView): HTMLElement {
  const s = el('div', 'ms-ggb-sec ms-ggb-tcue');
  const text = el('span', 'ms-grow');
  text.append(word(t.now));
  if (!t.wet && t.after !== t.dry) text.append(', after rain ', word(t.after));
  const m = t.road?.main;
  if (m) text.append(` · ${m.msr ? 'MSR ' : ''}${m.shield} ${fmtDistance(m.distanceM)} ${m.compass}`);
  s.append(el('span', 'ms-ggb-tl', 'T'), text, el('span', 'ms-ggb-tkey', 'T'));
  return s;
}

function block(v: GroundGuideVerdict, t: TView, northDeg: number): HTMLElement {
  switch (v.traffic!.block) {
    case 'gauge': return blockGauge(v, t);
    case 'calendar': return blockCalendar(v, t);
    case 'tiles': return blockTiles(v, t);
    case 'wayout': return blockWayOut(v, t);
    case 'rose': return blockRose(v, t, northDeg);
    case 'ticker': return blockTicker(v, t);
    case 'tabs': return blockTabs(v, t);
    default: return blockBand(v, t);
  }
}

/** The card sections to draw with a T block on: the Cross-Country and Movement sections are in the block. */
export function trafficCard(v: GroundGuideVerdict, card: GroundGuideCardOptions): GroundGuideCardOptions {
  const b = v.traffic?.block;
  return b && b !== 'off' && v.going ? { ...card, goingLines: false, movementRose: false } : card;
}

/**
 * Add T to a card being built: `rows` are its sections in order (Why first); `pills` the header's pill box, put on
 * `bar` when T adds the first pill; `roadAt` is the end of the going sections (GROTBC order). Does nothing when the
 * verdict carries no T.
 */
export function decorateTraffic(
  v: GroundGuideVerdict,
  bar: HTMLElement,
  pills: HTMLElement,
  rows: HTMLElement[],
  roadAt?: number,
  northDeg = 0,
): void {
  const t = v.traffic;
  if (!t || v.verdict === 'unknown') return;
  ensureTrafficCss();
  ensureGoingCss();
  const pt = v.going?.point;
  const wet = v.going?.season === 'wet';
  const why = whyOf(rows);
  if (t.pill && pt && (wet || ORDER[pt.wet] > ORDER[pt.dry])) {
    pills.appendChild(el('span', 'ms-ggb-tpill', wet ? `After Rain: ${WORD[pt.wet]}` : `Rain: ${WORD[pt.wet]}`));
    if (!pills.parentElement) bar.appendChild(pills);
  }
  if (t.dual && pt && why) {
    const other = el('div', 'ms-ggb-tdual');
    other.append(el('span', undefined, wet ? 'Dry' : 'After Rain'), gauge(wet ? pt.dry : pt.wet)); // the shared gauge (item 2)
    why.appendChild(other);
  }
  const afterWhy = why ? 1 : 0;
  const grotbc = roadAt ?? rows.length;
  if (t.block === 'off') {
    if (t.road) rows.splice(grotbc, 0, band('T', `${t.road.caption} · ${wet ? 'After Rain' : 'Dry'}`, el('div', undefined, t.road.text)));
    return;
  }
  const tv = viewOf(v);
  if (t.block === 'ticker') {
    rows.splice(0, 0, blockTicker(v, tv)); // a strip right under the header, wherever `where` says
    return;
  }
  const at = t.where === 'grotbc' ? grotbc : afterWhy;
  rows.splice(at, 0, t.where === 'folded' && !t.open ? foldedCue(tv) : block(v, tv, northDeg));
}

// The Ground Brief (G) lists the road line under T, after the going.
registerBriefSection({
  id: 'traffic-road',
  letter: 'T',
  order: 15,
  title: 'Rd for the Mode',
  render: (v) => (v.traffic?.road ? el('div', undefined, `${v.traffic.road.caption}: ${v.traffic.road.text}`) : null),
  text: (v) => (v.traffic?.road ? [`${v.traffic.road.caption}: ${v.traffic.road.text}`] : []),
});
