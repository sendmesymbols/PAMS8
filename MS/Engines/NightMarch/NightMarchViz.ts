/**
 * NightMarchViz.ts
 *
 * The Night March chart's pictures (user, 2026-11-11: "visually appealing, creative visualization techniques"):
 *   compassDial   the leg's bearing on a compass rose with its drift cone (3° each side, how far off a column ends), the
 *                 legs already laid as faint numbered spokes, magnetic north and the objective on the rim; turns with
 *                 the map like every rose (GroundGuideNorth);
 *   paceCord      the pace cord: one bead for each 100 m (120 paces), a big knot every 500 m, the part already walked lit;
 *   objRuler      how far from the objective, against the enemy's night sights and thermal, and the FUP distance wanted;
 *   legRibbon     the legs in proportion, the one in hand lit;
 *   stripMap      the route unrolled into a strip: legs, bearings, lamps, check points, halts, obstacles, skylines,
 *                 the ground hidden from and seen by the objective, the enemy's sight zones, the profile, the FUP;
 *   pocketCard    the card a guide carries for one leg: bearing, paces, cord, time, the landmark it ends on;
 *   traceMap      the real shape of the route, north up and turning with the map, with the FUP and the rings;
 *   fupPlan       the FUP marking layout drawn axis-up: tape, places, SL, lamps shaded to the rear, guides, the axis
 *                 tape, the column coming in, and a gauge of the distance to the objective;
 *   timeDistance  the march against the clock: legs as slopes, halts and the FUP as flats, the night's light behind.
 * Colours from GroundGuideTokens.ts: red / green / orange for verdicts only, violet the enemy, the warm token the lamps,
 * the accent the route. SVG text never under 10.5 px. DOM nodes and textContent only.
 */

import { ACCENT, FONT, LINE, OTHER_UNIT, STEP_COLOR, SURFACE, TEXT } from '../GroundGuide/GroundGuideTokens';
import { plDist, type MercXY } from '../PlatoonGuide/PlatoonGuideRead';
import { clock, hRel, toMils, type NightMarchChart, type NmLeg, type NmTone } from './NightMarchRead';
import { brgText, deg3, dist, dur, num, type NightMarchBrief, type NmUnits } from './NightMarchText';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const LAMP = TEXT.warn;
export const TONE_COL: Record<NmTone, string> = { ok: STEP_COLOR.go, warn: STEP_COLOR.slow, bad: STEP_COLOR.nogo };

type Attrs = Record<string, string | number>;
let uid = 0;
/** A document-unique id (a gradient or clip inside a hidden card must not be the one another picture points at). */
const nextId = (p: string): string => `${p}-${++uid}`;
export function S(tag: string, attrs: Attrs, parent?: Element | null, text?: string): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e as SVGElement;
}
function svgBox(w: number, h: number, label: string, cls?: string): SVGSVGElement {
  const s = S('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label }) as SVGSVGElement;
  if (cls) s.setAttribute('class', cls);
  s.style.display = 'block';
  return s;
}
const P = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
};
const f1 = (n: number) => n.toFixed(1);
const txt = (parent: Element, x: number, y: number, t: string, o: Attrs = {}) =>
  S('text', { x: f1(x), y: f1(y), 'font-family': FONT, 'font-size': 11, fill: TEXT.label, ...o }, parent, t);

// ── compass dial ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DialOpts {
  px: number;
  bearing: number | null;
  prev?: number[];
  /** GMA in degrees, east positive: magnetic north is drawn that far east of grid north. */
  gmaDeg?: number | null;
  objBrg?: number | null;
  color?: string;
  /** Drift each side of the bearing, degrees (the cone). */
  driftDeg?: number;
  label?: string;
}

/** The compass rose for a leg, drawn north up in a group that turns with the map (`data-gv-rose`). */
export function compassDial(o: DialOpts): SVGSVGElement {
  const W = 140, C = 70, R = 62;
  const svg = S('svg', { width: o.px, height: o.px, viewBox: `0 0 ${W} ${W}`, role: 'img', 'aria-label': o.label ?? 'Compass' }) as SVGSVGElement;
  svg.style.display = 'block';
  const defs = S('defs', {}, svg);
  const gid = nextId('nm-dial-g');
  const grad = S('radialGradient', { id: gid, cx: '50%', cy: '45%', r: '60%' }, defs);
  S('stop', { offset: '0%', 'stop-color': '#2a313b' }, grad);
  S('stop', { offset: '100%', 'stop-color': SURFACE.ring }, grad);
  S('circle', { cx: C, cy: C, r: R + 5, fill: `url(#${gid})`, stroke: LINE.ring, 'stroke-width': 1.4 }, svg);
  const g = S('g', { 'data-gv-rose': `${C} ${C}` }, svg);
  // Ticks every 5°, longer every 30°, the cardinals longest.
  for (let d = 0; d < 360; d += 5) {
    const big = d % 90 === 0, mid = d % 30 === 0;
    const [x1, y1] = P(C, C, R, d), [x2, y2] = P(C, C, R - (big ? 9 : mid ? 6 : 3), d);
    S('line', { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), stroke: big ? '#e4e8ec' : mid ? '#9aa3ad' : '#5d6772', 'stroke-width': big ? 1.8 : 1 }, g);
  }
  for (const [d, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as Array<[number, string]>) {
    const [x, y] = P(C, C, R - 17, d);
    S('text', { x: f1(x), y: f1(y), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': FONT, 'font-size': d === 0 ? 13 : 11, 'font-weight': 750, fill: d === 0 ? '#ffffff' : '#9aa3ad', 'data-gv-upright': `${f1(x)} ${f1(y)}` }, g, t);
  }
  // Magnetic north: a small violet-free tick (the warm token is the lamps; MN is white, dashed).
  if (o.gmaDeg !== null && o.gmaDeg !== undefined && Math.abs(o.gmaDeg) >= 0.5) {
    const [x1, y1] = P(C, C, R + 4, o.gmaDeg), [x2, y2] = P(C, C, R - 12, o.gmaDeg);
    S('line', { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), stroke: '#ffffff', 'stroke-width': 1.4, 'stroke-dasharray': '2 2' }, g);
  }
  // Legs already laid: faint spokes with their numbers.
  (o.prev ?? []).forEach((b, i) => {
    const [x, y] = P(C, C, R - 24, b);
    S('line', { x1: C, y1: C, x2: f1(x), y2: f1(y), stroke: 'rgba(142,193,234,.35)', 'stroke-width': 2, 'stroke-linecap': 'round' }, g);
    const [tx, ty] = P(C, C, R - 30, b + 9);
    S('text', { x: f1(tx), y: f1(ty), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': FONT, 'font-size': 10.5, 'font-weight': 600, fill: 'rgba(195,203,211,.75)', 'data-gv-upright': `${f1(tx)} ${f1(ty)}` }, g, String(i + 1));
  });
  // The objective on the rim.
  if (o.objBrg !== null && o.objBrg !== undefined) {
    const [x, y] = P(C, C, R + 1, o.objBrg);
    S('path', { d: `M${f1(x)} ${f1(y - 6)}L${f1(x + 6)} ${f1(y)}L${f1(x)} ${f1(y + 6)}L${f1(x - 6)} ${f1(y)}Z`, fill: OTHER_UNIT, stroke: '#14181d', 'stroke-width': 1.3 }, g);
  }
  // The drift cone and the needle.
  if (o.bearing !== null) {
    const col = o.color ?? ACCENT;
    const dd = o.driftDeg ?? 3;
    const [ax, ay] = P(C, C, R - 2, o.bearing - dd), [bx, by] = P(C, C, R - 2, o.bearing + dd);
    S('path', { d: `M${C} ${C}L${f1(ax)} ${f1(ay)}A${R - 2} ${R - 2} 0 0 1 ${f1(bx)} ${f1(by)}Z`, fill: col, 'fill-opacity': 0.22 }, g);
    const [tx, ty] = P(C, C, R - 4, o.bearing);
    const [lx, ly] = P(C, C, 9, o.bearing - 90), [rx, ry] = P(C, C, 9, o.bearing + 90);
    const [kx, ky] = P(C, C, 16, o.bearing + 180);
    S('path', { d: `M${f1(tx)} ${f1(ty)}L${f1(rx)} ${f1(ry)}L${f1(kx)} ${f1(ky)}L${f1(lx)} ${f1(ly)}Z`, fill: col, stroke: '#14181d', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, g);
  }
  S('circle', { cx: C, cy: C, r: 5, fill: SURFACE.card, stroke: '#e4e8ec', 'stroke-width': 1.6 }, svg);
  return svg;
}

// ── the pace cord ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One bead for each 100 m (120 paces), a bigger knot every 500 m; a long leg packs 500 m to a bead (said in the label).
 * `doneM` lights the beads already walked (the pointer on a leg).
 */
export function paceCord(distM: number, width: number, opts: { doneM?: number | null; color?: string } = {}): SVGSVGElement {
  const H = 18;
  const svg = svgBox(width, H, `Pace cord ${num(distM)} m`);
  const per = distM > 2400 ? 500 : 100;
  const beads = Math.max(1, Math.ceil(distM / per));
  const step = Math.min(14, (width - 8) / beads);
  S('line', { x1: 2, y1: H / 2, x2: f1(Math.min(width - 2, 6 + step * beads)), y2: H / 2, stroke: '#5d6772', 'stroke-width': 1.4 }, svg);
  const col = opts.color ?? ACCENT;
  for (let i = 0; i < beads; i++) {
    const endM = Math.min(distM, (i + 1) * per);
    const part = (endM - i * per) / per;
    const knot = per === 100 && (i + 1) % 5 === 0;
    const r = (knot ? 5.2 : 3.6) * (0.55 + 0.45 * part);
    const lit = opts.doneM !== null && opts.doneM !== undefined ? opts.doneM >= endM - 1 : true;
    const x = 6 + step * i + step / 2 - 2;
    S('circle', { cx: f1(x), cy: H / 2, r: f1(r), fill: lit ? col : '#3a434e', stroke: '#14181d', 'stroke-width': 1, opacity: lit ? 1 : 0.85 }, svg);
  }
  if (per === 500) svg.setAttribute('aria-label', `Pace cord, one bead per 500 m: ${num(distM)} m`);
  return svg;
}

// ── distance to the objective against the enemy's sights ────────────────────────────────────────────────────────────

export function objRuler(distM: number | null, R: { nightM: number; thermalM: number; minM: number; wantM: number }, width: number): SVGSVGElement {
  const H = 34;
  const svg = svgBox(width, H, distM === null ? 'No objective set' : `Objective ${dist(distM)}`);
  const max = Math.max(R.thermalM * 1.25, (distM ?? 0) * 1.08);
  const X = (m: number) => 4 + ((width - 8) * Math.min(max, Math.max(0, m))) / max;
  S('rect', { x: X(0), y: 6, width: f1(X(max) - X(0)), height: 10, rx: 3, fill: '#2b323b' }, svg);
  S('rect', { x: X(0), y: 6, width: f1(X(R.thermalM) - X(0)), height: 10, rx: 3, fill: OTHER_UNIT, 'fill-opacity': 0.25 }, svg);
  S('rect', { x: X(0), y: 6, width: f1(X(R.nightM) - X(0)), height: 10, rx: 3, fill: OTHER_UNIT, 'fill-opacity': 0.75 }, svg);
  // The FUP band: from the minimum (orange) to the distance wanted (green beyond).
  S('rect', { x: f1(X(R.minM)), y: 17.5, width: f1(X(R.wantM) - X(R.minM)), height: 3, fill: STEP_COLOR.slow }, svg);
  S('rect', { x: f1(X(R.wantM)), y: 17.5, width: f1(X(max) - X(R.wantM)), height: 3, fill: STEP_COLOR.go, opacity: 0.8 }, svg);
  txt(svg, X(0), 31, 'Obj', { 'font-size': 10.5, 'font-weight': 700, fill: '#e4e8ec' });
  txt(svg, X(R.nightM), 31, `${(R.nightM / 1000).toFixed(1)} km night`, { 'font-size': 10.5, 'text-anchor': 'middle' });
  txt(svg, Math.min(X(R.thermalM), width - 40), 31, `${(R.thermalM / 1000).toFixed(0)} km thermal`, { 'font-size': 10.5, 'text-anchor': 'middle' });
  if (distM !== null) {
    const x = X(distM);
    S('path', { d: `M${f1(x)} 1L${f1(x + 5)} 7L${f1(x)} 21L${f1(x - 5)} 7Z`, fill: '#ffffff', stroke: '#14181d', 'stroke-width': 1.4 }, svg);
  }
  return svg;
}

export function legRibbon(lengths: number[], current: number, width: number, tones?: NmTone[]): SVGSVGElement {
  const H = 10;
  const svg = svgBox(width, H, 'Legs');
  const tot = lengths.reduce((a, b) => a + b, 0) || 1;
  let x = 0;
  lengths.forEach((L, i) => {
    const w = Math.max(2, ((width - lengths.length) * L) / tot);
    const on = i === current;
    S('rect', { x: f1(x), y: on ? 0 : 2, width: f1(w), height: on ? H : H - 4, rx: 2, fill: on ? ACCENT : tones?.[i] && tones[i] !== 'ok' ? TONE_COL[tones[i]] : '#4a5562', opacity: on ? 1 : 0.8 }, svg);
    x += w + 1;
  });
  return svg;
}

// ── the strip ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The route unrolled: SP left, FUP right, everything the chart knows placed by its distance from the SP. */
export function stripMap(b: NightMarchBrief, width: number, height: number): SVGSVGElement {
  const C = b.chart;
  const svg = svgBox(width, height, 'Strip of the route', 'ms-nm-strip');
  const L = Math.max(1, C.lengthM);
  const padL = 34, padR = 92;
  const X = (m: number) => padL + ((width - padL - padR) * Math.max(0, Math.min(L, m))) / L;
  const top = 18;
  const lineY = Math.round(top + 66);
  // Under the line: halts, then the turns' times and landmarks, then the profile.
  const profTop = lineY + 64, profBot = height - 28;
  const hasProf = !!b.profile && b.profile.length > 2 && profBot - profTop > 24;

  // Sight zones behind everything.
  if (C.sights) {
    for (const [ring, op, word] of [[C.sights.thermal, 0.1, 'thermal'], [C.sights.night, 0.26, 'night sights']] as const) {
      if (ring.enterAtM === null) continue;
      const x0 = X(ring.enterAtM);
      S('rect', { x: f1(x0), y: top, width: f1(X(L) - x0 + 60), height: height - top - 18, fill: OTHER_UNIT, 'fill-opacity': op }, svg);
      txt(svg, x0 + 4, top + 11, `Inside ${word} from ${dist(ring.enterAtM)}`, { 'font-size': 10.5, fill: '#cfc2ff' });
    }
  }
  // Distance axis with paces and (H set) clock times.
  const stepM = L > 6000 ? 1000 : L > 2500 ? 500 : 250;
  for (let m = 0; m <= L + 1; m += stepM) {
    const x = X(m);
    S('line', { x1: f1(x), y1: height - 22, x2: f1(x), y2: height - 17, stroke: '#7f8893', 'stroke-width': 1 }, svg);
    if (m === 0 || (X(m) - X(m - stepM) > 64 && m < L - stepM / 3)) txt(svg, x, height - 5, m === 0 ? 'SP' : `${dist(m)} · ${num((m / 100) * 120)} p`, { 'font-size': 10.5, 'text-anchor': m === 0 ? 'start' : 'middle' });
  }
  S('line', { x1: X(0), y1: height - 19.5, x2: X(L), y2: height - 19.5, stroke: '#5d6772', 'stroke-width': 1 }, svg);

  // The profile under the line; on a short band, a faint silhouette behind the whole strip instead.
  const prof = (b.profile ?? []).filter((p) => Number.isFinite(p.elev));
  if (prof.length > 2) {
    const ghost = !hasProf;
    const pt = ghost ? top + 14 : profTop, pb = ghost ? height - 24 : profBot;
    const lo = Math.min(...prof.map((p) => p.elev)), hi = Math.max(...prof.map((p) => p.elev));
    const span = Math.max(20, hi - lo);
    const Y = (e: number) => pb - ((pb - pt) * (e - lo)) / span;
    const d = prof.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.chainM))} ${f1(Y(p.elev))}`).join('');
    S('path', { d: `${d}L${f1(X(prof[prof.length - 1].chainM))} ${pb}L${f1(X(prof[0].chainM))} ${pb}Z`, fill: '#4a5562', 'fill-opacity': ghost ? 0.22 : 0.35 }, svg);
    S('path', { d, fill: 'none', stroke: '#9aa3ad', 'stroke-width': 1.4, 'stroke-opacity': ghost ? 0.45 : 1 }, svg);
    txt(svg, 2, pt + 8, `${Math.round(hi)} m`, { 'font-size': 10.5 });
    txt(svg, 2, pb, `${Math.round(lo)} m`, { 'font-size': 10.5 });
  }

  // Stretches along the line: hidden from the Obj (green), seen (red), skylines (violet dashes).
  const band = (fromM: number, toM: number, y: number, col: string, dash?: string) =>
    S('line', { x1: f1(X(fromM)), y1: y, x2: f1(Math.max(X(toM), X(fromM) + 3)), y2: y, stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round', ...(dash ? { 'stroke-dasharray': dash } : {}) }, svg);
  for (const s of C.dead) band(s.fromM, s.toM, lineY + 9, STEP_COLOR.go);
  for (const s of C.exposed) band(s.fromM, s.toM, lineY + 9, STEP_COLOR.nogo);
  for (const s of C.skyline) band(s.fromM - 20, s.toM + 20, lineY - 9, OTHER_UNIT, '3 3');

  // The route line, the legs' bearings above it.
  S('line', { x1: X(0), y1: lineY, x2: X(L), y2: lineY, stroke: '#14181d', 'stroke-width': 9, 'stroke-linecap': 'round' }, svg);
  S('line', { x1: X(0), y1: lineY, x2: X(L), y2: lineY, stroke: ACCENT, 'stroke-width': 4.5, 'stroke-linecap': 'round' }, svg);
  const T = C.timing;
  for (const lg of C.legs) {
    const x0 = X(lg.cumM - lg.distM), x1 = X(lg.cumM);
    const mid = (x0 + x1) / 2;
    const room = x1 - x0;
    if (room >= 30) {
      const g = S('g', {}, svg);
      const cy = lineY - 34;
      S('circle', { cx: f1(mid), cy, r: 13, fill: SURFACE.ring, stroke: TONE_COL[lg.tone], 'stroke-width': 1.6 }, g);
      const brg = lg.magDeg ?? lg.bearingDeg;
      const [tx, ty] = P(mid, cy, 10, brg), [kx, ky] = P(mid, cy, 6, brg + 180), [lx, ly] = P(mid, cy, 4, brg - 90), [rx, ry] = P(mid, cy, 4, brg + 90);
      S('path', { d: `M${f1(tx)} ${f1(ty)}L${f1(rx)} ${f1(ry)}L${f1(kx)} ${f1(ky)}L${f1(lx)} ${f1(ly)}Z`, fill: ACCENT }, g);
      if (room >= 92) {
        txt(svg, mid + 18, cy - 2, `${deg3(brg)}${lg.magDeg === null ? ' G' : ' M'}`, { 'font-size': 13, 'font-weight': 750, fill: '#ffffff' });
        txt(svg, mid + 18, cy + 11, `${num(lg.paces)} p · ${dur(lg.minNight)}`, { 'font-size': 10.5 });
      } else if (room >= 54) txt(svg, mid, cy - 17, deg3(brg), { 'font-size': 10.5, 'text-anchor': 'middle', fill: '#ffffff', 'font-weight': 700 });
    }
  }
  // Points on the line.
  for (const l of C.lights) {
    if (l.kind !== 'route' && l.kind !== 'turn' && l.kind !== 'sp') continue;
    const m = chainOf(C, [l.x, l.y]);
    if (m === null) continue;
    S('circle', { cx: f1(X(m)), cy: lineY - 0.5, r: 2.6, fill: LAMP, stroke: '#14181d', 'stroke-width': 0.8 }, svg);
  }
  for (const lg of C.legs)
    for (const c of lg.checkPts) {
      const x = X(lg.cumM - lg.distM + c.atM);
      S('path', { d: `M${f1(x)} ${lineY - 7}V${lineY + 7}`, stroke: '#ffffff', 'stroke-width': 2 }, svg);
    }
  for (const h of T.halts) {
    const x = X(h.chainM);
    S('rect', { x: f1(x - 8), y: lineY + 13, width: 16, height: 14, rx: 3, fill: LAMP, stroke: '#14181d', 'stroke-width': 1 }, svg);
    txt(svg, x, lineY + 24, 'H', { 'font-size': 10.5, 'font-weight': 750, fill: '#14181d', 'text-anchor': 'middle' });
  }
  for (const ob of C.obstacles) {
    const x = X(ob.chainM);
    S('path', { d: `M${f1(x - 5)} ${lineY - 5}L${f1(x + 5)} ${lineY + 5}M${f1(x + 5)} ${lineY - 5}L${f1(x - 5)} ${lineY + 5}`, stroke: STEP_COLOR.nogo, 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
  }
  // Turns with their landmark and time.
  for (const lg of C.legs) {
    if (lg.toFup) continue;
    const x = X(lg.cumM);
    S('circle', { cx: f1(x), cy: lineY, r: 9, fill: TONE_COL[lg.tone] === STEP_COLOR.go ? ACCENT : TONE_COL[lg.tone], stroke: '#14181d', 'stroke-width': 1.5 }, svg);
    txt(svg, x, lineY + 3.8, String(lg.i), { 'font-size': 10.5, 'font-weight': 750, fill: '#14181d', 'text-anchor': 'middle' });
    const when = T.hHourMin !== null ? clock(T.hHourMin - T.leaveBeforeH + lg.endMin) : hRel(-T.leaveBeforeH + lg.endMin);
    const lm = lg.landmark ? lg.landmark.label : 'no landmark';
    txt(svg, x, lineY + 42, when, { 'font-size': 10.5, 'text-anchor': 'middle', fill: '#e4e8ec' });
    txt(svg, x, lineY + 55, lm.length > 16 ? `${lm.slice(0, 15)}…` : lm, { 'font-size': 10.5, 'text-anchor': 'middle', fill: lg.landmark ? TEXT.label : STEP_COLOR.slow });
  }
  // SP and the FUP block, the objective beyond.
  S('circle', { cx: X(0), cy: lineY, r: 10, fill: '#f1f3f6', stroke: '#14181d', 'stroke-width': 1.5 }, svg);
  txt(svg, X(0), lineY + 3.6, 'SP', { 'font-size': 10.5, 'font-weight': 750, fill: '#14181d', 'text-anchor': 'middle' });
  const fx = X(L);
  S('rect', { x: f1(fx - 2), y: lineY - 16, width: 30, height: 32, rx: 3, fill: TONE_COL[C.fup.tone], 'fill-opacity': 0.25, stroke: '#f1f3f6', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
  S('line', { x1: f1(fx + 28), y1: lineY - 16, x2: f1(fx + 28), y2: lineY + 16, stroke: '#ffffff', 'stroke-width': 3.5 }, svg);
  txt(svg, fx + 13, lineY + 4, 'FUP', { 'font-size': 10.5, 'font-weight': 750, fill: '#ffffff', 'text-anchor': 'middle' });
  txt(svg, fx + 30, lineY - 21, 'SL', { 'font-size': 10.5, 'font-weight': 750, fill: '#ffffff', 'text-anchor': 'middle' });
  if (C.objective && C.fup.distToObjM !== null) {
    S('path', { d: `M${f1(fx + 32)} ${lineY}H${f1(width - 22)}`, stroke: '#ffffff', 'stroke-width': 1.4, 'stroke-dasharray': '2 3' }, svg);
    const ox = width - 14;
    S('path', { d: `M${ox} ${lineY - 9}L${ox + 9} ${lineY}L${ox} ${lineY + 9}L${ox - 9} ${lineY}Z`, fill: STEP_COLOR.nogo, stroke: '#14181d', 'stroke-width': 1.4 }, svg);
    txt(svg, (fx + 32 + ox) / 2, lineY - 6, dist(C.fup.distToObjM), { 'font-size': 10.5, 'text-anchor': 'middle', fill: TONE_COL[C.fup.tone] === STEP_COLOR.go ? '#e4e8ec' : TONE_COL[C.fup.tone] });
    txt(svg, ox, lineY + 22, 'Obj', { 'font-size': 10.5, 'text-anchor': 'middle', fill: '#e4e8ec', 'font-weight': 700 });
  }
  return svg;
}

/** Metres from the SP of a point on the route (null when it is not on it). */
export function chainOf(C: NightMarchChart, p: MercXY): number | null {
  for (const lg of C.legs) {
    const d = plDist(lg.from, p) + plDist(p, lg.to) - lg.distM;
    if (d < 2) return lg.cumM - lg.distM + plDist(lg.from, p);
  }
  return null;
}

// ── a pocket card for one leg ────────────────────────────────────────────────────────────────────────────────────────

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function pocketCard(lg: NmLeg, b: NightMarchBrief, cardH: number): HTMLElement {
  const C = b.chart;
  const T = C.timing;
  const card = h('div', 'ms-nm-pc');
  card.dataset.tone = lg.tone;
  const head = h('div', 'ms-nm-pc-h');
  head.append(h('span', 'ms-nm-pc-no', lg.toFup ? `Leg ${lg.i} · to FUP` : `Leg ${lg.i}`));
  const when = T.hHourMin !== null ? `${clock(T.hHourMin - T.leaveBeforeH + lg.startMin)}–${clock(T.hHourMin - T.leaveBeforeH + lg.endMin)}` : `${hRel(-T.leaveBeforeH + lg.startMin)}`;
  head.append(h('span', 'ms-nm-pc-t', when));
  card.append(head);
  const top = h('div', 'ms-nm-pc-top');
  const dialPx = Math.max(84, Math.min(118, cardH - 196));
  top.append(compassDial({ px: dialPx, bearing: lg.bearingDeg, gmaDeg: b.gmaDeg, driftDeg: 3, color: ACCENT, label: `Leg ${lg.i} bearing` }));
  const nums = h('div', 'ms-nm-pc-nums');
  const main = lg.magDeg ?? lg.bearingDeg;
  const big = h('div', 'ms-nm-pc-brg', b.units === 'mils' ? `${String(toMils(main)).padStart(4, '0')}` : deg3(main));
  big.append(h('small', undefined, b.units === 'mils' ? ` mils ${lg.magDeg === null ? 'G' : 'M'}` : lg.magDeg === null ? ' G' : ' M'));
  nums.append(big);
  if (lg.magDeg !== null) nums.append(h('div', 'ms-nm-pc-sub', `grid ${deg3(lg.bearingDeg)}${b.units !== 'deg' ? ` · ${toMils(main)} mils` : ''}`));
  else if (b.units === 'both') nums.append(h('div', 'ms-nm-pc-sub', `${toMils(main)} mils G`));
  const pc = h('div', 'ms-nm-pc-paces', num(lg.paces));
  pc.append(h('small', undefined, ' paces'));
  nums.append(pc, h('div', 'ms-nm-pc-sub', `${dist(lg.distM)} · ${dur(lg.minNight)}${lg.climbM >= 10 ? ` · ↑${lg.climbM} m` : ''}`));
  top.append(nums);
  card.append(top);
  const cord = h('div', 'ms-nm-pc-cord');
  cord.append(paceCord(lg.distM, 190));
  card.append(cord);
  const ends = h('div', 'ms-nm-pc-ends');
  if (lg.toFup) ends.append(h('b', undefined, 'FUP'), ` · axis ${C.fup.axisMagDeg !== null ? `${deg3(C.fup.axisMagDeg)} M` : `${deg3(C.fup.axisDeg)} G`}`);
  else if (lg.landmark) ends.append('Ends on ', h('b', undefined, `${lg.landmark.label}${lg.landmark.name ? ` ${lg.landmark.name}` : ''}`), lg.landmark.distM > 15 ? ` ${dist(lg.landmark.distM)} ${lg.landmark.dir}` : '');
  else ends.append(h('b', undefined, 'No landmark'), ': guide + light');
  card.append(ends);
  const tot = h('div', 'ms-nm-pc-tot', `Total ${num(lg.cumPaces)} p · ${dist(lg.cumM)}`);
  card.append(tot);
  if (lg.notes.length) {
    const n = h('div', 'ms-nm-pc-note');
    n.textContent = lg.notes.slice(0, 2).join(' · ');
    card.append(n);
  }
  return card;
}

// ── the trace: the route's real shape, north up, turning with the map ───────────────────────────────────────────────

export function traceMap(b: NightMarchBrief, width: number, height: number): SVGSVGElement {
  const C = b.chart;
  const svg = svgBox(width, height, 'Trace of the route', 'ms-nm-trace');
  const pts: MercXY[] = [...C.path, ...C.fup.corners, C.fup.axisEnd];
  if (C.objective) pts.push(C.objective);
  // Fit the bounding box (a rotated map may clip a corner; the north arrow still says where north is).
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const cx0 = (bx0 + bx1) / 2, cy0 = (by0 + by1) / 2;
  const rad = Math.max(1, Math.hypot(bx1 - bx0, by1 - by0) / 2);
  const cx = width / 2, cy = height / 2;
  const k = Math.min((width - 60) / Math.max(1, bx1 - bx0), (height - 50) / Math.max(1, by1 - by0));
  const X = (p: MercXY) => cx + (p[0] - cx0) * k;
  const Y = (p: MercXY) => cy - (p[1] - cy0) * k;
  const scale = Math.cos(2 * Math.atan(Math.exp(cy0 / 6378137)) - Math.PI / 2); // ground metres per mercator unit
  const cid = nextId('nm-trace-clip');
  const clip = S('clipPath', { id: cid }, S('defs', {}, svg));
  S('rect', { x: 0, y: 0, width, height, rx: 8 }, clip);
  S('rect', { x: 0, y: 0, width, height, rx: 8, fill: SURFACE.ring }, svg);
  const g = S('g', { 'data-gv-rose': `${f1(cx)} ${f1(cy)}` }, S('g', { 'clip-path': `url(#${cid})` }, svg));
  // Grid every 1 km (ground), faint.
  const kmU = 1000 / scale;
  const gx0 = Math.floor((cx0 - rad * 1.6) / kmU) * kmU, gy0 = Math.floor((cy0 - rad * 1.6) / kmU) * kmU;
  for (let x = gx0; x < cx0 + rad * 1.6; x += kmU) S('line', { x1: f1(X([x, 0])), y1: f1(cy - rad * 1.7 * k), x2: f1(X([x, 0])), y2: f1(cy + rad * 1.7 * k), stroke: 'rgba(255,255,255,.05)', 'stroke-width': 1 }, g);
  for (let y = gy0; y < cy0 + rad * 1.6; y += kmU) S('line', { x1: f1(cx - rad * 1.7 * k), y1: f1(Y([0, y])), x2: f1(cx + rad * 1.7 * k), y2: f1(Y([0, y])), stroke: 'rgba(255,255,255,.05)', 'stroke-width': 1 }, g);
  if (C.objective && C.sights) {
    for (const [r, op, dash] of [[C.sights.thermal.radiusM, 0.06, '5 4'], [C.sights.night.radiusM, 0.16, '4 3']] as const) {
      const rr = (r / scale) * k;
      S('circle', { cx: f1(X(C.objective)), cy: f1(Y(C.objective)), r: f1(rr), fill: OTHER_UNIT, 'fill-opacity': op, stroke: OTHER_UNIT, 'stroke-width': 1.3, 'stroke-dasharray': dash }, g);
    }
  }
  const poly = (ps: MercXY[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p))} ${f1(Y(p))}`).join('');
  S('path', { d: poly(C.path), fill: 'none', stroke: '#14181d', 'stroke-width': 8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
  S('path', { d: poly(C.path), fill: 'none', stroke: ACCENT, 'stroke-width': 3.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
  const F = C.fup;
  S('path', { d: `${poly(F.corners)}Z`, fill: TONE_COL[F.tone], 'fill-opacity': 0.22, stroke: '#ffffff', 'stroke-width': 1.3, 'stroke-dasharray': '4 3' }, g);
  S('path', { d: poly([F.sl[0], F.sl[1]]), stroke: '#ffffff', 'stroke-width': 3.5 }, g);
  const slMid: MercXY = [(F.sl[0][0] + F.sl[1][0]) / 2, (F.sl[0][1] + F.sl[1][1]) / 2];
  if (C.objective) S('path', { d: poly([slMid, C.objective]), stroke: '#ffffff', 'stroke-width': 1.3, 'stroke-dasharray': '2 3', fill: 'none' }, g);
  for (const l of C.lights) S('circle', { cx: f1(X([l.x, l.y])), cy: f1(Y([l.x, l.y])), r: 2.6, fill: LAMP, stroke: '#14181d', 'stroke-width': 0.8 }, g);
  for (const lg of C.legs) {
    const mx = (X(lg.from) + X(lg.to)) / 2, my = (Y(lg.from) + Y(lg.to)) / 2;
    const segPx = Math.hypot(X(lg.to) - X(lg.from), Y(lg.to) - Y(lg.from));
    if (segPx > 40) {
      const t = segPx > 90 ? `${deg3(lg.magDeg ?? lg.bearingDeg)} · ${num(lg.paces)} p` : deg3(lg.magDeg ?? lg.bearingDeg);
      const w = t.length * 6.4 + 10;
      const lab = S('g', { 'data-gv-upright': `${f1(mx)} ${f1(my)}` }, g);
      S('rect', { x: f1(mx - w / 2), y: f1(my - 9), width: f1(w), height: 18, rx: 5, fill: '#14181d', 'fill-opacity': 0.9, stroke: TONE_COL[lg.tone] === STEP_COLOR.go ? ACCENT : TONE_COL[lg.tone], 'stroke-width': 1 }, lab);
      txt(lab, mx, my + 4, t, { 'font-size': 10.5, 'font-weight': 700, fill: '#ffffff', 'text-anchor': 'middle' });
    }
    if (!lg.toFup) {
      const x = X(lg.to), y = Y(lg.to);
      const n = S('g', { 'data-gv-upright': `${f1(x)} ${f1(y)}` }, g);
      S('circle', { cx: f1(x), cy: f1(y), r: 8.5, fill: lg.tone === 'ok' ? ACCENT : TONE_COL[lg.tone], stroke: '#14181d', 'stroke-width': 1.4 }, n);
      txt(n, x, y + 3.7, String(lg.i), { 'font-size': 10.5, 'font-weight': 750, fill: '#14181d', 'text-anchor': 'middle' });
    }
  }
  const sp = C.path[0];
  const spg = S('g', { 'data-gv-upright': `${f1(X(sp))} ${f1(Y(sp))}` }, g);
  S('circle', { cx: f1(X(sp)), cy: f1(Y(sp)), r: 10, fill: '#f1f3f6', stroke: '#14181d', 'stroke-width': 1.4 }, spg);
  txt(spg, X(sp), Y(sp) + 3.7, 'SP', { 'font-size': 10.5, 'font-weight': 750, fill: '#14181d', 'text-anchor': 'middle' });
  if (C.objective) {
    const ox = X(C.objective), oy = Y(C.objective);
    const og = S('g', { 'data-gv-upright': `${f1(ox)} ${f1(oy)}` }, g);
    S('path', { d: `M${f1(ox)} ${f1(oy - 10)}L${f1(ox + 10)} ${f1(oy)}L${f1(ox)} ${f1(oy + 10)}L${f1(ox - 10)} ${f1(oy)}Z`, fill: STEP_COLOR.nogo, stroke: '#14181d', 'stroke-width': 1.4 }, og);
    txt(og, ox, oy + 24, 'Obj', { 'font-size': 10.5, 'font-weight': 700, fill: '#ffffff', 'text-anchor': 'middle' });
  }
  // North arrow (turns with the map) and a scale bar (fixed).
  const na = S('g', { 'data-gv-rose': `${width - 22} 24` }, svg);
  S('path', { d: `M${width - 22} 10L${width - 16} 30L${width - 22} 26L${width - 28} 30Z`, fill: '#ffffff', stroke: '#14181d', 'stroke-width': 1 }, na);
  txt(svg, width - 22, 43, 'N', { 'font-size': 10.5, 'font-weight': 750, fill: '#ffffff', 'text-anchor': 'middle' });
  const barM = [100, 250, 500, 1000, 2000, 5000].find((m) => (m / scale) * k > 60) ?? 5000;
  const bw = (barM / scale) * k;
  S('path', { d: `M12 ${height - 14}h${f1(bw)}M12 ${height - 18}v8M${f1(12 + bw)} ${height - 18}v8`, stroke: '#ffffff', 'stroke-width': 1.6 }, svg);
  txt(svg, 12 + bw / 2, height - 20, dist(barM), { 'font-size': 10.5, 'text-anchor': 'middle', fill: '#e4e8ec' });
  return svg;
}

// ── the FUP marking layout, axis up ─────────────────────────────────────────────────────────────────────────────────

export function fupPlan(b: NightMarchBrief, width: number, height: number): SVGSVGElement {
  const C = b.chart;
  const F = C.fup;
  const svg = svgBox(width, height, 'FUP marking layout', 'ms-nm-fup');
  S('rect', { x: 0, y: 0, width, height, rx: 8, fill: SURFACE.ring }, svg);
  const gaugeW = 64;
  const W = width - gaugeW - 10;
  // Local frame in metres: x across (right +), y along the axis (forward +). Shown: from the column coming in, below the
  // FUP, to the end of the axis tape.
  const inM = Math.min(F.depthM * 0.6, 90);
  const y0 = -F.depthM / 2 - inM, y1 = F.depthM / 2 + C.stores.axisTapeM + 22;
  const x0 = -F.frontM / 2 - 30, x1 = F.frontM / 2 + 30;
  const k = Math.min((W - 150) / (x1 - x0), (height - 34) / (y1 - y0));
  const ox = 10 + (W - (x1 - x0) * k) / 2 - x0 * k, oy = 20 + (height - 34 - (y1 - y0) * k) / 2 + y1 * k;
  const X = (x: number) => ox + x * k, Y = (y: number) => oy - y * k;
  // The column coming in on the last leg.
  const lastLeg = C.legs[C.legs.length - 1];
  const inAng = lastLeg ? ((lastLeg.bearingDeg - F.axisDeg + 540) % 360) - 180 : 0;
  const ia = (inAng * Math.PI) / 180;
  const ex = 0, ey = -F.depthM / 2;
  const sx = ex - Math.sin(ia) * inM, sy = ey - Math.cos(ia) * inM;
  S('path', { d: `M${f1(X(sx))} ${f1(Y(sy))}L${f1(X(ex))} ${f1(Y(ey))}`, stroke: '#14181d', 'stroke-width': 9, 'stroke-linecap': 'round' }, svg);
  S('path', { d: `M${f1(X(sx))} ${f1(Y(sy))}L${f1(X(ex))} ${f1(Y(ey))}`, stroke: ACCENT, 'stroke-width': 4, 'stroke-linecap': 'round' }, svg);
  for (let m = 25; m < inM - 10; m += 30) {
    const t = m / inM;
    S('circle', { cx: f1(X(sx + (ex - sx) * t)), cy: f1(Y(sy + (ey - sy) * t)), r: 2.4, fill: '#e4e8ec' }, svg);
  }
  txt(svg, X(sx) + 8, Y(sy) - 2, 'column in', { 'font-size': 10.5 });
  // The FUP tape and the places in it.
  S('rect', { x: f1(X(-F.frontM / 2)), y: f1(Y(F.depthM / 2)), width: f1(F.frontM * k), height: f1(F.depthM * k), fill: TONE_COL[F.tone], 'fill-opacity': 0.12, stroke: '#ffffff', 'stroke-width': 1.6, 'stroke-dasharray': '6 4' }, svg);
  for (const s of F.slots) {
    // Slot centre in local metres: recompute from the slot's corners relative to the FUP centre.
    const local = (p: MercXY) => {
      const dx = (p[0] - F.centre[0]) * Math.cos(2 * Math.atan(Math.exp(F.centre[1] / 6378137)) - Math.PI / 2);
      const dy = (p[1] - F.centre[1]) * Math.cos(2 * Math.atan(Math.exp(F.centre[1] / 6378137)) - Math.PI / 2);
      const a = (F.axisDeg * Math.PI) / 180;
      return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
    };
    const cs = s.corners.map(local);
    const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
    const rx0 = Math.min(...xs), rx1 = Math.max(...xs), ry0 = Math.min(...ys), ry1 = Math.max(...ys);
    S('rect', { x: f1(X(rx0)), y: f1(Y(ry1)), width: f1((rx1 - rx0) * k), height: f1((ry1 - ry0) * k), rx: 4, fill: s.hq ? 'rgba(255,255,255,.18)' : 'rgba(142,193,234,.16)', stroke: s.hq ? '#e4e8ec' : ACCENT, 'stroke-width': 1.2 }, svg);
    const wPx = (rx1 - rx0) * k;
    const label = s.hq && wPx < s.label.length * 6.5 + 6 ? 'HQ' : s.label;
    if (wPx >= label.length * 6 + 4) txt(svg, X((rx0 + rx1) / 2), Y((ry0 + ry1) / 2) + 4, label, { 'font-size': s.hq ? 10.5 : 12, 'font-weight': 700, fill: '#ffffff', 'text-anchor': 'middle' });
    // A guide at each place (a small figure: head and body), when the place is big enough to hold it beside the label.
    if (!s.hq && wPx >= label.length * 7 + 26) {
      const gx = X(rx0) + 7, gy = Y(ry0) - 7;
      S('circle', { cx: f1(gx), cy: f1(gy - 4), r: 2.2, fill: '#e4e8ec' }, svg);
      S('path', { d: `M${f1(gx)} ${f1(gy - 1.5)}v5`, stroke: '#e4e8ec', 'stroke-width': 2 }, svg);
    }
  }
  // The SL tape and the axis tape.
  S('line', { x1: f1(X(-F.frontM / 2)), y1: f1(Y(F.depthM / 2)), x2: f1(X(F.frontM / 2)), y2: f1(Y(F.depthM / 2)), stroke: '#ffffff', 'stroke-width': 4.5 }, svg);
  txt(svg, X(F.frontM / 2) + 8, Y(F.depthM / 2) + 4, F.slFeature ? `SL · ${F.slFeature}` : 'SL (taped)', { 'font-size': 12, 'font-weight': 750, fill: '#ffffff' });
  S('line', { x1: f1(X(0)), y1: f1(Y(F.depthM / 2)), x2: f1(X(0)), y2: f1(Y(F.depthM / 2 + C.stores.axisTapeM)), stroke: '#ffffff', 'stroke-width': 1.8, 'stroke-dasharray': '5 4' }, svg);
  txt(svg, X(0) + 8, Y(F.depthM / 2 + C.stores.axisTapeM * 0.55), `axis ${F.axisMagDeg !== null ? `${deg3(F.axisMagDeg)} M` : `${deg3(F.axisDeg)} G`}`, { 'font-size': 11, fill: '#e4e8ec' });
  S('path', { d: `M${f1(X(0))} ${f1(Y(F.depthM / 2 + C.stores.axisTapeM + 22))}l-6 10h12z`, fill: STEP_COLOR.nogo }, svg);
  txt(svg, X(0), 14, C.objective && F.distToObjM !== null ? `Obj ${dist(F.distToObjM)}` : 'Axis', { 'font-size': 12, 'font-weight': 750, fill: '#ffffff', 'text-anchor': 'middle' });
  // Dimensions.
  const dy = Y(-F.depthM / 2) + 16;
  S('path', { d: `M${f1(X(-F.frontM / 2))} ${f1(dy)}H${f1(X(F.frontM / 2))}M${f1(X(-F.frontM / 2))} ${f1(dy - 4)}v8M${f1(X(F.frontM / 2))} ${f1(dy - 4)}v8`, stroke: '#9aa3ad', 'stroke-width': 1 }, svg);
  txt(svg, X(F.frontM / 4), dy + 13, `${Math.round(F.frontM)} m`, { 'font-size': 10.5, 'text-anchor': 'middle' });
  const dx = X(-F.frontM / 2) - 14;
  S('path', { d: `M${f1(dx)} ${f1(Y(-F.depthM / 2))}V${f1(Y(F.depthM / 2))}M${f1(dx - 4)} ${f1(Y(-F.depthM / 2))}h8M${f1(dx - 4)} ${f1(Y(F.depthM / 2))}h8`, stroke: '#9aa3ad', 'stroke-width': 1 }, svg);
  txt(svg, dx - 6, Y(0) + 4, `${Math.round(F.depthM)} m`, { 'font-size': 10.5, 'text-anchor': 'end' });
  // Lamps, each with its shade toward the enemy (a dark half facing up).
  const lampAt = (x: number, y: number, label?: string) => {
    S('circle', { cx: f1(X(x)), cy: f1(Y(y)), r: 6, fill: LAMP, stroke: '#14181d', 'stroke-width': 1.2 }, svg);
    S('path', { d: `M${f1(X(x) - 8)} ${f1(Y(y))}A8 8 0 0 1 ${f1(X(x) + 8)} ${f1(Y(y))}`, fill: 'none', stroke: '#14181d', 'stroke-width': 3 }, svg);
    if (label) txt(svg, X(x) - 10, Y(y) + 4, label, { 'font-size': 10.5, 'text-anchor': 'end' });
  };
  lampAt(-F.frontM / 2, F.depthM / 2);
  lampAt(F.frontM / 2, F.depthM / 2);
  lampAt(-F.frontM / 2, -F.depthM / 2);
  lampAt(F.frontM / 2, -F.depthM / 2);
  lampAt(0, -F.depthM / 2);
  lampAt(0, F.depthM / 2 + C.stores.axisTapeM);
  txt(svg, X(0) - 10, Y(-F.depthM / 2) + 18, 'entry · guide', { 'font-size': 10.5, 'text-anchor': 'end' });
  // A small north arrow: where north lies in this axis-up drawing.
  const nd = ((-F.axisDeg % 360) + 360) % 360;
  const na = S('g', { transform: `rotate(${f1(nd)} ${W - 14} 30)` }, svg);
  S('path', { d: `M${W - 14} 16L${W - 8} 36L${W - 14} 32L${W - 20} 36Z`, fill: '#ffffff', stroke: '#14181d', 'stroke-width': 1 }, na);
  txt(svg, W - 14, 52, 'N', { 'font-size': 10.5, 'font-weight': 750, fill: '#ffffff', 'text-anchor': 'middle' });
  // The gauge: SL to the objective against the enemy's sights and the distance wanted.
  const gx = width - gaugeW + 8;
  const top = 20, bot = height - 24;
  const max = Math.max(C.sights?.thermal.radiusM ?? 4000, (F.distToObjM ?? 0) * 1.1);
  const GY = (m: number) => top + ((bot - top) * Math.min(max, m)) / max; // 0 at the Obj (top)
  S('rect', { x: gx, y: top, width: 14, height: bot - top, rx: 3, fill: '#2b323b' }, svg);
  if (C.sights) {
    S('rect', { x: gx, y: top, width: 14, height: f1(GY(C.sights.thermal.radiusM) - top), rx: 3, fill: OTHER_UNIT, 'fill-opacity': 0.25 }, svg);
    S('rect', { x: gx, y: top, width: 14, height: f1(GY(C.sights.night.radiusM) - top), rx: 3, fill: OTHER_UNIT, 'fill-opacity': 0.75 }, svg);
  }
  txt(svg, gx + 7, top - 6, 'Obj', { 'font-size': 10.5, 'font-weight': 700, fill: '#e4e8ec', 'text-anchor': 'middle' });
  if (F.distToObjM !== null) {
    const y = GY(F.distToObjM);
    S('path', { d: `M${gx - 6} ${f1(y)}l-7 -6v12z`, fill: TONE_COL[F.tone] }, svg);
    S('line', { x1: gx - 2, y1: f1(y), x2: gx + 16, y2: f1(y), stroke: '#ffffff', 'stroke-width': 2 }, svg);
    txt(svg, gx + 20, y + 4, dist(F.distToObjM), { 'font-size': 10.5, fill: '#ffffff', 'font-weight': 700 });
  }
  if (C.sights) txt(svg, gx + 20, GY(C.sights.night.radiusM) + 4, 'night', { 'font-size': 10.5, fill: '#cfc2ff' });
  return svg;
}

// ── the march against the clock ─────────────────────────────────────────────────────────────────────────────────────

const LIGHT_FILL: Record<string, string> = { day: '#5b6b7c', twilight: '#3d4a5a', moonlight: '#2c3a4f', starlight: '#161b22' };

export function timeDistance(b: NightMarchBrief, width: number, height: number): SVGSVGElement {
  const C = b.chart;
  const T = C.timing;
  const svg = svgBox(width, height, 'The march against the clock', 'ms-nm-td');
  const padL = 46, padR = 16, padT = 16, padB = 40;
  const total = Math.max(10, T.leaveBeforeH);
  const X = (min: number) => padL + ((width - padL - padR) * Math.max(0, Math.min(total, min))) / total;
  const Y = (m: number) => height - padB - ((height - padB - padT) * Math.max(0, Math.min(C.lengthM, m))) / Math.max(1, C.lengthM);
  // The light behind, when H is set.
  if (b.lightBand?.length) {
    const lb = b.lightBand;
    for (let i = 0; i < lb.length; i++) {
      const a = lb[i].min, z = i + 1 < lb.length ? lb[i + 1].min : total;
      S('rect', { x: f1(X(a)), y: padT, width: f1(Math.max(0, X(z) - X(a)) + 0.5), height: height - padT - padB, fill: LIGHT_FILL[lb[i].level] ?? '#161b22' }, svg);
    }
  } else S('rect', { x: padL, y: padT, width: width - padL - padR, height: height - padT - padB, fill: '#161b22' }, svg);
  // Grid: time every 30 min, distance by legs.
  for (let m = 0; m <= total; m += total > 300 ? 60 : 30) {
    S('line', { x1: f1(X(m)), y1: padT, x2: f1(X(m)), y2: height - padB, stroke: 'rgba(255,255,255,.07)' }, svg);
    const lab = T.hHourMin !== null ? clock(T.hHourMin - total + m) : hRel(m - total);
    txt(svg, X(m), height - padB + 15, lab, { 'font-size': 10.5, 'text-anchor': 'middle' });
  }
  for (const lg of C.legs) {
    S('line', { x1: padL, y1: f1(Y(lg.cumM)), x2: width - padR, y2: f1(Y(lg.cumM)), stroke: 'rgba(255,255,255,.07)' }, svg);
    txt(svg, padL - 6, Y(lg.cumM) + 4, lg.toFup ? 'FUP' : `T${lg.i}`, { 'font-size': 10.5, 'text-anchor': 'end', fill: lg.toFup ? '#ffffff' : TEXT.label });
  }
  txt(svg, padL - 6, Y(0) + 4, 'SP', { 'font-size': 10.5, 'text-anchor': 'end', fill: '#ffffff' });
  // The march line: legs as slopes, halts flat, then the FUP wait to H.
  const pts: Array<[number, number]> = [[0, 0]];
  for (const lg of C.legs) {
    const hs = T.halts.filter((h) => h.atMin >= lg.startMin - 0.5 && h.atMin < lg.endMin);
    for (const h of hs) {
      pts.push([h.atMin, h.chainM]);
      pts.push([h.atMin + h.min, h.chainM]);
    }
    pts.push([lg.endMin, lg.cumM]);
  }
  pts.push([total, C.lengthM]);
  const d = pts.map(([t, m], i) => `${i ? 'L' : 'M'}${f1(X(t))} ${f1(Y(m))}`).join('');
  S('path', { d, fill: 'none', stroke: '#14181d', 'stroke-width': 7, 'stroke-linejoin': 'round' }, svg);
  S('path', { d, fill: 'none', stroke: ACCENT, 'stroke-width': 3.2, 'stroke-linejoin': 'round' }, svg);
  for (const h of T.halts) {
    S('rect', { x: f1(X(h.atMin)), y: f1(Y(h.chainM) - 7), width: f1(Math.max(6, X(h.atMin + h.min) - X(h.atMin))), height: 14, rx: 3, fill: LAMP, 'fill-opacity': 0.85 }, svg);
  }
  // Sight zones on the distance axis.
  if (C.sights?.night.enterAtM !== null && C.sights?.night.enterAtM !== undefined) {
    S('rect', { x: width - padR - 6, y: f1(Y(C.lengthM)), width: 6, height: f1(Y(C.sights.night.enterAtM) - Y(C.lengthM)), fill: OTHER_UNIT }, svg);
  }
  // Leave SP, in the FUP, H.
  const mark = (min: number, label: string, col: string, row: number, anchor: 'start' | 'end') => {
    S('line', { x1: f1(X(min)), y1: padT, x2: f1(X(min)), y2: height - padB, stroke: col, 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }, svg);
    txt(svg, X(min) + (anchor === 'end' ? -4 : 4), padT + 12 + row * 14, label, { 'font-size': 11, 'font-weight': 750, fill: col, 'text-anchor': anchor });
  };
  mark(0, `Leave SP ${T.leaveSp ?? hRel(-total)}`, '#ffffff', 0, 'start');
  mark(T.marchMin, `In FUP ${T.arriveFup ?? hRel(-T.fupMin)}`, '#ffffff', 1, 'end');
  mark(total, `H ${T.h ?? ''}`.trim(), STEP_COLOR.nogo, 0, 'end');
  if (b.lightBand?.length) {
    const lv = Array.from(new Set(b.lightBand.map((x) => x.level)));
    let x = padL;
    for (const l of lv) {
      S('rect', { x, y: height - 14, width: 12, height: 10, rx: 2, fill: LIGHT_FILL[l], stroke: '#7f8893', 'stroke-width': 0.8 }, svg);
      txt(svg, x + 16, height - 5, l === 'starlight' ? 'dark' : l, { 'font-size': 10.5 });
      x += 22 + (l.length + 1) * 6.4;
    }
  }
  return svg;
}

export { brgText };
export type { NmUnits };
