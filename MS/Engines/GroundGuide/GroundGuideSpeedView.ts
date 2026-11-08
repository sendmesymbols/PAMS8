/**
 * GroundGuideSpeedView.ts
 *
 * T in GROTBC, Speed (`v.speed`, GroundGuideSpeed.ts) on the Ground Guide card and in the Ground Brief. Card styles,
 * one switch (`groundGuide.speed.card`), all kept so the owner can compare them live:
 *   line   S1  the speed now in large type, up / down a slope, the road with the time to reach it, a day's march;
 *   grid   S2  day / night x dry / after rain at the point, the one in force outlined;
 *   rose   S3  minutes to cover the range in eight directions, slope and ground taken along the way;
 *   modes  S4  foot / B truck / A tracked (and the symbol's mover) side by side;
 *   road   S5  a strip from here to the road: the cross-country leg, then the road speed.
 * The block sits right after the T block (or the going sections when T is off). DOM nodes and textContent only.
 */

import { registerBriefSection } from './GroundGuideBrief';
import { fmtDistance } from './GroundGuideEvaluator';
import { band, ensureGoingCss, roseFigure, seasonIcon, turnRose } from './GroundGuideGoingView';
import { compassNode, joinNodes } from './GroundGuideNorth';
import { fmtKmh, fmtMinutes, speedText, type GroundGuideSpeed, type SpeedDirection } from './GroundGuideSpeed';
import {
  ACCENT,
  ensureTokensCss,
  FONT,
  FS,
  FW,
  LINE,
  OWN_UNIT,
  ROAD,
  ROSE_C,
  ROSE_R,
  roseFrame,
  roseHub,
  roseKey,
  STEP_COLOR,
  STEP_TEXT,
  SURFACE,
  TEXT,
  wedgePath,
} from './GroundGuideTokens';
import type { GroundGuideVerdict } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-speed-style';

/** Sizes and colours from GroundGuideTokens.ts (2026-11-08 visual review); road shields in the road colours, not red. */
const CSS = `
.ms-ggs-head{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.ms-ggs-big{font-size:${FS.value}px;font-weight:${FW.bold};color:${TEXT.strong};font-variant-numeric:tabular-nums}
.ms-ggs-cat{display:inline;font:${FW.semi} ${FS.meta}px/1.3 ${FONT};color:${ACCENT}}
.ms-ggs-kv{display:grid;grid-template-columns:48px minmax(0,1fr);gap:5px 8px;align-items:start;margin-top:6px}
.ms-ggs-kv>.ms-ggs-k{color:${TEXT.label};font-size:${FS.meta}px;padding-top:1px}
.ms-ggs-shield{flex:none;display:inline-block;font:${FW.bold} ${FS.meta}px/1 ${FONT};padding:3px 5px;border-radius:3px;background:${ROAD.fairWeather};color:${ROAD.msrCasing};margin-right:5px}
.ms-ggs-shield.ms-aw{background:${ROAD.allWeather}}
.ms-ggs-shield.ms-msr{background:${ROAD.msr};color:${ROAD.msrCasing};box-shadow:0 0 0 1.5px ${ROAD.msrCasing},0 0 0 2.5px ${ROAD.msr}}
.ms-ggs-grid{display:grid;grid-template-columns:auto 1fr 1fr;gap:3px 4px;font-size:${FS.meta}px;align-items:center;margin-top:6px}
.ms-ggs-grid>.ms-ggs-h{font-size:${FS.meta}px;color:${TEXT.label};display:flex;gap:4px;justify-content:center;align-items:center}
.ms-ggs-grid>.ms-ggs-m{color:${TEXT.label};padding-right:6px;white-space:nowrap}
.ms-ggs-grid>.ms-ggs-c{text-align:center;padding:3px 0 2px;border-radius:3px;border-bottom:1px solid ${LINE.soft};font-size:${FS.body}px;font-weight:${FW.semi};color:${TEXT.main};font-variant-numeric:tabular-nums}
.ms-ggs-grid>.ms-ggs-c.ms-on{color:${TEXT.strong};font-weight:${FW.bold};border-bottom-color:transparent;box-shadow:inset 0 0 0 1.5px ${ACCENT}}
.ms-ggs-rose{display:flex;gap:10px;align-items:center}
.ms-ggs-rose>svg,.ms-ggs-rose>figure{flex:none}
.ms-ggs-rose>div{min-width:0}
.ms-ggs-modes{display:grid;gap:2px 12px;align-items:baseline}
.ms-ggs-modes>span{font-size:${FS.meta}px;color:${TEXT.label};white-space:nowrap}
.ms-ggs-modes>span.ms-me{color:${ACCENT};font-weight:${FW.semi}}
.ms-ggs-modes>b{font-size:${FS.value}px;font-weight:${FW.bold};color:${TEXT.main};font-variant-numeric:tabular-nums;white-space:nowrap}
.ms-ggs-modes>b.ms-me{color:${TEXT.strong}}
.ms-ggs-modes>b.ms-nogo{color:${STEP_TEXT.nogo}}
.ms-ggs-modes>b>small{font-size:${FS.meta}px;font-weight:${FW.regular};color:${TEXT.label};margin-left:2px}
.ms-ggs-way{display:flex;align-items:center;margin-top:20px}
.ms-ggs-way>.ms-dot{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid ${TEXT.strong};background:${OWN_UNIT}}
.ms-ggs-way>.ms-leg{flex:1;height:6px;border-radius:3px;margin:0 4px;position:relative}
.ms-ggs-way>.ms-leg>span{position:absolute;left:50%;top:-17px;transform:translateX(-50%);font-size:${FS.meta}px;color:${TEXT.label};white-space:nowrap}
.ms-ggs-way>.ms-xc{background:repeating-linear-gradient(90deg,${TEXT.label} 0 6px,transparent 6px 10px)}
.ms-ggs-way>.ms-rd{background:${ROAD.fairWeather}}
.ms-ggs-way>.ms-rd.ms-aw{background:${ROAD.allWeather}}
.ms-ggs-way>.ms-rd.ms-msr{background:${ROAD.msr};box-shadow:0 0 0 1.5px ${ROAD.msrCasing}}
`;

export function ensureSpeedCss(): void {
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

function when(s: GroundGuideSpeed): string {
  return `${s.season === 'wet' ? 'after rain' : 'dry'} · ${s.light}`;
}

function caption(s: GroundGuideSpeed, what = 'Speed'): string {
  return `${what} · ${s.short}`;
}

/** The vehicle category as a coloured word ("A Veh"), not an uppercase chip (item 13). */
function catChip(s: GroundGuideSpeed): HTMLElement | null {
  if (!s.cat) return null;
  const c = el('span', 'ms-ggs-cat', `${s.cat} Veh`);
  c.title = `${s.cat} vehicle`;
  return c;
}

export function speedHeadline(s: GroundGuideSpeed): HTMLElement {
  const h = el('div', 'ms-ggs-head');
  const big = el('span', 'ms-ggs-big', s.kmh === 0 ? 'NO-GO' : fmtKmh(s.kmh));
  if (s.kmh === 0) big.style.color = STEP_TEXT.nogo;
  h.append(big, el('span', 'ms-ggb-soft', `cross-country · ${when(s)}`));
  if (s.up !== null && s.down !== null) h.append(el('span', 'ms-ggb-soft', `· up ${s.up}, down ${s.down}`));
  const c = catChip(s);
  if (c) h.append(c);
  return h;
}

/** The road class as a CSS modifier (item 16): MSR white and cased, all-weather blue, else fair-weather violet. */
function roadClass(s: GroundGuideSpeed): string {
  return s.road?.msr ? ' ms-msr' : s.road?.allWeather ? ' ms-aw' : '';
}

function shield(s: GroundGuideSpeed): HTMLElement {
  return el('span', `ms-ggs-shield${roadClass(s)}`, s.road?.shield ?? 'Rd');
}

/** "1.2 km E · 18 min to reach · then 40 km/h (column)". */
function roadText(s: GroundGuideSpeed): string {
  const r = s.road!;
  const reach = r.reachMin === null ? 'no cross-country way from here' : r.reachMin === 0 ? 'on it' : `${fmtMinutes(r.reachMin)} to reach`;
  const how = s.roadMode === 'convoy' ? `${r.kmh} km/h in column${r.rateKmih !== null ? ` (${r.rateKmih} km in the hour)` : ''}` : `${r.kmh} km/h alone`;
  return `${r.name ? `${r.name} · ` : ''}${fmtDistance(r.distanceM)} ${r.compass} · ${reach} · then ${how}`;
}

function roadRow(s: GroundGuideSpeed): HTMLElement {
  const box = el('div');
  if (!s.road) {
    box.textContent = `No Rd it can use within ${fmtDistance(s.roadRadiusM)}`;
    return box;
  }
  box.append(shield(s), roadText(s));
  return box;
}

export function speedDayText(s: GroundGuideSpeed): string | null {
  const d = s.dayKm;
  if (!d) return null;
  const load = d.load === 'none' ? 'without' : 'with';
  return `${d.lo}–${d.hi} km in 24 h (${d.ground}, ${load} combat load)`;
}

export function speedGroundText(s: GroundGuideSpeed): string | null {
  const bits: string[] = [];
  if (s.ground) bits.push(s.ground.label);
  if (s.slopeDeg !== null) bits.push(`slope ${Math.round(s.slopeDeg)}°${s.slopeBand ? ` (${s.slopeBand})` : ''}`);
  if (s.elevM !== null && s.elevM >= 2500) bits.push(`${Math.round(s.elevM)} m up`);
  return bits.length ? bits.join(' · ') : null;
}

// ── the five styles ───────────────────────────────────────────────────────

function styleLine(s: GroundGuideSpeed): HTMLElement {
  const kv = el('div', 'ms-ggs-kv');
  kv.append(el('span', 'ms-ggs-k', 'Rd'), roadRow(s));
  const day = speedDayText(s);
  if (day) kv.append(el('span', 'ms-ggs-k', 'Day'), el('span', undefined, day));
  const g = speedGroundText(s);
  if (g) kv.append(el('span', 'ms-ggs-k', 'Here'), el('span', 'ms-ggb-soft', g));
  return band('T', caption(s), speedHeadline(s), kv);
}

/** Day / night x dry / after rain at the point (km/h), the cell in force outlined. */
export function speedGrid(s: GroundGuideSpeed): HTMLElement {
  const g = el('div', 'ms-ggs-grid');
  const hd = (season: 'dry' | 'wet', t: string) => {
    const c = el('span', 'ms-ggs-h');
    c.append(seasonIcon(season, 11), t);
    return c;
  };
  g.append(el('span'), hd('dry', 'Dry'), hd('wet', 'After Rain'));
  const cell = (v: number | null, on: boolean) => el('span', `ms-ggs-c${on ? ' ms-on' : ''}`, v === null ? '?' : v === 0 ? 'NO-GO' : String(v));
  const wet = s.season === 'wet';
  g.append(el('span', 'ms-ggs-m', 'Day'), cell(s.grid.dryDay, s.light === 'day' && !wet), cell(s.grid.wetDay, s.light === 'day' && wet));
  g.append(el('span', 'ms-ggs-m', 'Night'), cell(s.grid.dryNight, s.light === 'night' && !wet), cell(s.grid.wetNight, s.light === 'night' && wet));
  return g;
}

function styleGrid(s: GroundGuideSpeed): HTMLElement {
  const g = speedGrid(s);
  const head = el('div', 'ms-ggs-head');
  head.append(el('span', 'ms-ggb-soft', `km/h cross-country${s.up !== null ? ', uphill' : ''}`));
  const c = catChip(s);
  if (c) head.append(c);
  const road = el('div', 'ms-ggb-soft');
  road.style.marginTop = '6px';
  road.append(s.road ? `${s.road.shield}: ${roadText(s)}` : `No Rd within ${fmtDistance(s.roadRadiusM)}`);
  return band('T', caption(s), head, g, road);
}

/**
 * A way's colour on the going steps (item 12: colours only from the ladder). A ray carries its speed, not its going:
 * blocked is NO-GO, at least half the mover's best speed reads as GO, slower as SLOW-GO (slow ground or a slope).
 */
function rayColor(x: SpeedDirection, top: number): string {
  if (x.minutes === null || x.kmh <= 0) return STEP_COLOR.nogo;
  return top > 0 && x.kmh >= top * 0.5 ? STEP_COLOR.go : STEP_COLOR.slow;
}

/**
 * The T Time-to-X rose in the shared frame (item 12): eight wedges in map bearings, length by speed (longest = the
 * mover's best way), a blocked way red and as long as it goes before it is stopped. The group turns with the map
 * (`data-gv-rose`). Drawn at ROSE_PX on screen: `size` is kept for the callers but no longer used.
 */
export function speedRoseSvg(rays: SpeedDirection[], rangeM: number, size: number, northDeg: number): SVGElement {
  void size;
  const r0 = 9;
  const R = ROSE_R;
  const top = Math.max(1, ...rays.map((r) => r.kmh));
  const f = roseFrame(`Speed and minutes to cover ${fmtDistance(rangeM)}, by direction`);
  f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: r0 + (R - r0) / 2, fill: 'none', stroke: LINE.hair, 'stroke-dasharray': '2 3' });
  for (const x of rays) {
    // Open: length by speed. Blocked: a red wedge as long as the way goes before it is stopped.
    const k = x.minutes === null ? Math.max(0.1, x.reachM / Math.max(1, rangeM)) : x.kmh / top;
    const r = Math.max(r0 + 3, r0 + (R - r0) * Math.min(1, k));
    const w = f.add('path', { d: wedgePath(r0, r, x.bearingDeg - 20.5, x.bearingDeg + 20.5), fill: rayColor(x, top), stroke: SURFACE.ring, 'stroke-width': 0.8 });
    const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    tip.textContent =
      x.minutes === null
        ? `${x.compass}: blocked${x.blockedBy ? ` by ${x.blockedBy.toLowerCase()}` : ''} at ${fmtDistance(x.reachM)}`
        : `${x.compass}: ${fmtMinutes(x.minutes)} at ${x.kmh} km/h`;
    w.append(tip);
  }
  roseHub(f, r0 - 2);
  turnRose(f, northDeg);
  return f.svg;
}

/** The key under the Time-to-X rose: "Length = speed · colour = going". */
export function speedRoseKey(): HTMLElement {
  return roseKey('Length = speed · colour = going');
}

export function speedRoseLines(s: GroundGuideSpeed): HTMLElement {
  const box = el('div');
  const rays = s.rays ?? [];
  const open = rays.filter((r) => r.minutes !== null).sort((p, q) => p.minutes! - q.minutes!);
  const to = fmtDistance(s.rangeM);
  if (open.length) {
    // Each direction carries its arrow (exact bearing), which turns with the map.
    const fast = open[0];
    const slow = open[open.length - 1];
    const big = el('div', 'ms-ggs-big', `${fmtMinutes(fast.minutes!)} `);
    big.append(compassNode(fast.compass, fast.bearingDeg));
    box.append(big);
    const line = el('div', 'ms-ggb-soft', `fastest to ${to}; slowest `);
    line.append(compassNode(slow.compass, slow.bearingDeg), ` ${fmtMinutes(slow.minutes!)}`);
    box.append(line);
  } else box.append(el('div', 'ms-ggs-big', 'Blocked'));
  const shut = rays.filter((r) => r.minutes === null);
  if (shut.length) {
    const first = [...shut].sort((p, q) => p.reachM - q.reachM)[0];
    const line = el('div', 'ms-ggb-soft', 'Blocked ');
    line.append(joinNodes(shut.map((r) => compassNode(r.compass, r.bearingDeg)), ', '));
    if (first.blockedBy) line.append(` (${first.blockedBy.toLowerCase()} at ${fmtDistance(first.reachM)})`);
    box.append(line);
  }
  box.append(el('div', 'ms-ggb-soft', `${when(s)}${s.road ? ` · ${s.road.shield} ${fmtDistance(s.road.distanceM)} ${s.road.compass}` : ''}`));
  return box;
}

function styleRose(s: GroundGuideSpeed, northDeg: number): HTMLElement {
  if (!s.rays) return styleLine(s);
  const row = el('div', 'ms-ggs-rose');
  row.append(roseFigure(speedRoseSvg(s.rays, s.rangeM, 0, northDeg), speedRoseKey()), speedRoseLines(s));
  return band('T', `${caption(s)} · Time to ${fmtDistance(s.rangeM)}`, row);
}

/**
 * Foot / B Truck / A Tracks (and the symbol's mover) side by side, km/h now (item 11): a plain table, the mode over
 * its speed in bold, the symbol's own mover named in the accent colour. Nothing in it looks pressable.
 */
export function speedModeTiles(s: GroundGuideSpeed): HTMLElement {
  const t = el('div', 'ms-ggs-modes');
  const n = Math.max(1, Math.min(4, s.modes.length));
  t.style.gridTemplateColumns = `repeat(${n},minmax(0,1fr))`;
  t.style.gridTemplateRows = 'auto auto';
  t.style.gridAutoFlow = 'column';
  t.setAttribute('role', 'table');
  t.setAttribute('aria-label', `Cross-country speed by mode, ${when(s)}`);
  for (const m of s.modes) {
    const me = m.active ? ' ms-me' : '';
    const k = el('span', me || undefined, m.short);
    k.title = `${m.short}${m.cat ? ` (${m.cat} vehicle)` : ''}${m.active ? ', this symbol' : ''}: ${fmtKmh(m.kmh)} cross-country, ${when(s)}`;
    const v = el('b', `${m.kmh === 0 ? 'ms-nogo' : ''}${me}`.trim() || undefined);
    if (m.kmh === null) v.textContent = '?';
    else if (m.kmh === 0) v.textContent = 'NO-GO';
    else v.append(String(m.kmh), el('small', undefined, 'km/h'));
    t.append(k, v);
  }
  return t;
}

function styleModes(s: GroundGuideSpeed): HTMLElement {
  const tiles = speedModeTiles(s);
  const soft = el('div', 'ms-ggb-soft', `km/h cross-country · ${when(s)}`);
  soft.style.marginTop = '5px';
  return band('T', 'Speed · Who Moves How Fast', tiles, soft);
}

/** The strip from here to the road (cross-country leg, then the road speed) and its line under; null without a road. */
export function speedWay(s: GroundGuideSpeed): [HTMLElement, HTMLElement] | null {
  const r = s.road;
  if (!r) return null;
  const way = el('div', 'ms-ggs-way');
  const xc = el('span', 'ms-leg ms-xc');
  xc.append(el('span', undefined, r.reachMin === null ? `${fmtDistance(r.distanceM)} · NO-GO` : r.reachMin === 0 ? 'on the Rd' : `${fmtDistance(r.distanceM)} · ${fmtMinutes(r.reachMin)}`));
  const rd = el('span', `ms-leg ms-rd${roadClass(s)}`);
  rd.append(el('span', undefined, `${r.kmh} km/h${s.roadMode === 'convoy' ? ' column' : ''}`));
  const sh = shield(s);
  sh.style.marginRight = '0';
  way.append(el('span', 'ms-dot'), xc, sh, rd);
  const info = el('div', 'ms-ggb-soft');
  info.style.marginTop = '6px';
  info.textContent = `${r.msr ? 'MSR · ' : ''}${r.label}${r.allWeather ? '' : ' (fair-weather)'} · cross-country ${fmtKmh(s.kmh)} · ${when(s)}`;
  return [way, info];
}

function styleRoad(s: GroundGuideSpeed): HTMLElement {
  const w = speedWay(s);
  if (!w) return styleLine(s);
  return band('T', `${caption(s)} · To the Rd`, ...w);
}

/** "Speed · Foot" style caption, for the Detail card's tiles. */
export function speedCaption(s: GroundGuideSpeed, what = 'Speed'): string {
  return caption(s, what);
}

/** "dry · day", for the Detail card's lines. */
export function speedWhen(s: GroundGuideSpeed): string {
  return when(s);
}

export function speedSection(v: GroundGuideVerdict, northDeg = 0): HTMLElement | null {
  const s = v.speed;
  if (!s || v.verdict === 'unknown' || s.card === 'off') return null;
  ensureGoingCss();
  ensureSpeedCss();
  switch (s.card) {
    case 'grid': return styleGrid(s);
    case 'rose': return styleRose(s, northDeg);
    case 'modes': return styleModes(s);
    case 'road': return styleRoad(s);
    default: return styleLine(s);
  }
}

/**
 * Put the speed block in a card being built: right after the T block when there is one, else at `fallbackAt` (the
 * end of the going sections).
 */
export function decorateSpeed(v: GroundGuideVerdict, rows: HTMLElement[], fallbackAt: number, northDeg = 0): void {
  const sec = speedSection(v, northDeg);
  if (!sec) return;
  let at = -1;
  rows.forEach((r, i) => {
    if (r.querySelector(':scope > .ms-ggb-cap > .ms-gv-l[data-l="T"]') || r.classList.contains('ms-ggb-tcue')) at = i;
  });
  rows.splice(at >= 0 ? at + 1 : Math.min(fallbackAt, rows.length), 0, sec);
}

// The Ground Brief (G) under T, after the road line.
registerBriefSection({
  id: 'speed',
  letter: 'T',
  order: 16,
  title: 'Speed',
  render: (v) => {
    const s = v.speed;
    if (!s) return null;
    ensureGoingCss();
    ensureSpeedCss();
    const box = el('div');
    box.append(speedHeadline(s));
    const g = el('div', 'ms-ggs-grid');
    g.append(el('span'), el('span', 'ms-ggs-h', 'Dry'), el('span', 'ms-ggs-h', 'After Rain'));
    const cell = (x: number | null) => el('span', 'ms-ggs-c', x === null ? '?' : x === 0 ? 'NO-GO' : `${x}`);
    g.append(el('span', 'ms-ggs-m', 'Day'), cell(s.grid.dryDay), cell(s.grid.wetDay), el('span', 'ms-ggs-m', 'Night'), cell(s.grid.dryNight), cell(s.grid.wetNight));
    box.append(g);
    if (s.rays) {
      const row = el('div', 'ms-ggs-rose');
      row.style.marginTop = '8px';
      row.append(roseFigure(speedRoseSvg(s.rays, s.rangeM, 0, 0), speedRoseKey()), speedRoseLines(s));
      box.append(row);
    }
    const lines = speedText(s).slice(1); // the headline is above
    const ul = el('ul', 'ms-ggbr-list');
    for (const l of lines) ul.append(el('li', undefined, l.trim()));
    box.append(ul);
    return box;
  },
  text: (v) => (v.speed ? speedText(v.speed) : []),
});
