/**
 * CrossSectionChart.ts
 *
 * The cross-section as one SVG string (no DOM, so Node can test it): the ground's height along the line with the steep
 * stretches in red, the highest and lowest points marked and NO-GO stretches tinted; under it a band of the going for
 * the mover (GO / SLOW-GO / NO-GO, grey where not read), a row of the obstacles crossed or followed (a tick each, a
 * letter and a word where there is room: stops and water first, roads last), and (with a threat) a band of what the
 * threat sees; distance markers along the foot from A (the start) to B (the end); no-data stretches hatched across the
 * whole height with their reason. Colours from GroundGuideTokens' going colours.
 *
 * Also the distance words the panel, the map and the text share: `fmtCh` (a place along the line, to 10 m) and
 * `axisMarks` (the distance markers, each label different from the next).
 */

import { fmtAt, type LineEvent, type LineProfile, type ObstacleKind } from '../SiteScan/SiteLine';

const GO = '#2fa862', SLOW = '#ee8a1f', NOGO = '#e5484d', NONE = '#5d6772', SEEN = '#a78bfa', ACCENT = '#8ec1ea';
const LABEL = '#c3cbd3', SOFT = '#9aa3ad', RING = '#14181d';

export interface ChartLayout {
  W: number;
  H: number;
  padL: number;
  padR: number;
  plotTop: number;
  plotH: number;
  goingY: number;
  obstY: number;
  seenY: number;
  axisY: number;
  /** Chart x for a chainage. */
  x: (m: number) => number;
  /** Chart y for a height. */
  y: (e: number) => number;
  eMin: number;
  eMax: number;
  /** How many times the heights are stretched against the distances. */
  exaggeration: number;
}

export const KIND_GLYPH: Record<ObstacleKind, { c: string; s: string }> = {
  canal: { c: '#4aa8ff', s: 'W' }, drain: { c: '#4aa8ff', s: 'D' }, river: { c: '#4aa8ff', s: 'S' }, water: { c: '#4aa8ff', s: 'W' },
  marsh: { c: '#6fb3a8', s: 'M' }, rail: { c: '#d5dbe1', s: 'R' }, road: { c: '#f1d646', s: 'r' }, bridge: { c: '#f1d646', s: 'B' },
  footBridge: { c: '#c3cbd3', s: 'b' }, railBridge: { c: '#d5dbe1', s: 'B' }, ford: { c: '#4aa8ff', s: 'F' }, bua: { c: '#ff8a8d', s: 'U' },
  bund: { c: '#c79a5b', s: 'b' }, cutting: { c: '#c79a5b', s: 'c' }, cliff: { c: NOGO, s: 'C' }, wall: { c: '#c3cbd3', s: 'w' },
  dunes: { c: '#e6c27a', s: 'd' }, forest: { c: '#2fa862', s: 'T' }, nullah: { c: '#c79a5b', s: 'n' }, steep: { c: NOGO, s: '^' },
};

/** The event list's groups: water obstacles, routes (roads, railways and their bridges), the rest. */
export type EventGroup = 'water' | 'route' | 'other';
export const KIND_GROUP: Record<ObstacleKind, EventGroup> = {
  canal: 'water', drain: 'water', river: 'water', water: 'water', marsh: 'water', ford: 'water', nullah: 'water',
  road: 'route', bridge: 'route', footBridge: 'route', railBridge: 'route', rail: 'route',
  bua: 'other', bund: 'other', cutting: 'other', cliff: 'other', wall: 'other', dunes: 'other', forest: 'other', steep: 'other',
};

/** Does the event stop or slow the mover (NO-GO, SLOW-GO or a steep stretch)? */
export function isStop(e: Pick<LineEvent, 'kind' | 'going'>): boolean {
  return e.going === 'nogo' || e.going === 'slow' || e.kind === 'steep';
}

/** Which events get their letter and word first where the row is crowded: stops, then water, then the rest, roads last. */
function rank(e: LineEvent): number {
  if (e.going === 'nogo') return 0;
  if (e.going === 'slow' || e.kind === 'steep') return 1;
  if (KIND_GROUP[e.kind] === 'water') return 2;
  if (e.kind === 'road') return 4;
  return 3;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * A place along the line: metres (to 10 m) under 1 km, then kilometres with two decimals (10 m), so two obstacles
 * 300 m apart at 18 km do not both read "18 km".
 */
export const fmtCh = fmtAt;

/** Nice step for distance markers: 0.1 / 0.2 / 0.5 / 1 / 2 / 5 / 10 km... about `n` across. */
export function markerStep(lengthM: number, n = 8): number {
  const raw = lengthM / n;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const k of [1, 2, 5, 10]) if (k * p >= raw) return k * p;
  return 10 * p;
}

export interface AxisMarks {
  step: number;
  unit: 'm' | 'km';
  /** Markers from 0, each with its number in `unit` (no two alike). */
  marks: Array<{ m: number; label: string }>;
}

/** The distance markers of a line: metres for a line under 1 km (as `fmtCh` writes its end), else km with the decimals the step needs. */
export function axisMarks(lengthM: number, n = 8): AxisMarks {
  const step = markerStep(lengthM, n);
  const unit: 'm' | 'km' = Math.round(lengthM / 10) * 10 < 1000 ? 'm' : 'km';
  const dec = unit === 'm' || step >= 1000 ? 0 : 1;
  const marks: AxisMarks['marks'] = [];
  for (let i = 0; i * step <= lengthM + 1e-6; i++) {
    const m = i * step;
    marks.push({ m, label: unit === 'm' ? String(Math.round(m)) : (m / 1000).toFixed(dec) });
  }
  return { step, unit, marks };
}

/** Round heights for the grid lines: steps of 1 / 2 / 5 x 10^n, about `n` lines between `lo` and `hi`. */
export function niceTicks(lo: number, hi: number, n = 4): number[] {
  const raw = Math.max(1e-9, hi - lo) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * p;
  for (const k of [1, 2, 5, 10]) {
    if (k * p >= raw) {
      step = k * p;
      break;
    }
  }
  step = Math.max(1, step);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** The smallest height window shown (m): flatter ground than this is not blown up into hills. */
const MIN_WINDOW_M = 20;

export function layout(p: LineProfile, W: number, withSeen: boolean, plotH = 132): ChartLayout {
  const padL = 48, padR = 16, plotTop = 16;
  const goingY = plotTop + plotH + 8;
  const obstY = goingY + 18;
  const seenY = obstY + 38;
  const axisY = (withSeen ? seenY + 14 : obstY + 36) + 4;
  const H = axisY + 20;
  const lo = p.stats.minElev ?? 0, hi = p.stats.maxElev ?? 1;
  let eMin = lo, eMax = hi;
  if (eMax - eMin < MIN_WINDOW_M) {
    const mid = (lo + hi) / 2;
    eMin = mid - MIN_WINDOW_M / 2;
    eMax = mid + MIN_WINDOW_M / 2;
  }
  const pad = (eMax - eMin) * 0.1;
  eMin -= pad;
  eMax += pad;
  const L = Math.max(1, p.lengthM);
  const plotW = Math.max(1, W - padL - padR);
  return {
    W, H, padL, padR, plotTop, plotH, goingY, obstY, seenY, axisY,
    x: (m) => padL + (m / L) * plotW,
    y: (e) => plotTop + plotH - ((e - eMin) / (eMax - eMin)) * plotH,
    eMin, eMax,
    exaggeration: plotH / (eMax - eMin) / (plotW / L),
  };
}

/** "x250", "x12", "x1.5": two figures are enough. */
function timesWord(v: number): string {
  if (!(v > 0) || !Number.isFinite(v)) return '';
  if (v >= 100) return `x${Math.round(v / 10) * 10}`;
  if (v >= 10) return `x${Math.round(v)}`;
  return `x${v.toFixed(1)}`;
}

export interface ChartOpts {
  withSeen: boolean;
  /** Only these events are drawn in the obstacle row (the list's filter); all when absent. */
  show?: (e: LineEvent) => boolean;
  plotH?: number;
}

export function chartSvg(p: LineProfile, W: number, o: ChartOpts): { svg: string; L: ChartLayout } {
  const L = layout(p, W, o.withSeen, o.plotH);
  const { x, y } = L;
  const right = W - L.padR;
  const floor = L.plotTop + L.plotH;
  const f1 = (v: number) => v.toFixed(1);
  const parts: string[] = [];
  parts.push(`<defs><pattern id="xsHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#20262e"/><line x1="0" y1="0" x2="0" y2="6" stroke="#5d6772" stroke-width="2"/></pattern>` +
    `<linearGradient id="xsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.45"/><stop offset="100%" stop-color="${ACCENT}" stop-opacity="0.05"/></linearGradient></defs>`);
  // grid: round heights
  const ticks = niceTicks(L.eMin, L.eMax, 4);
  ticks.forEach((e, i) => {
    parts.push(`<line x1="${L.padL}" x2="${right}" y1="${f1(y(e))}" y2="${f1(y(e))}" stroke="rgba(255,255,255,.1)"/>`);
    parts.push(`<text x="${L.padL - 6}" y="${f1(y(e) + 4)}" text-anchor="end" font-size="11" fill="${LABEL}">${Math.round(e)}${i === ticks.length - 1 ? ' m' : ''}</text>`);
  });
  // NO-GO stretches tinted up through the plot, so the going reads against the ground's shape
  for (const st of p.nogo) {
    const x0 = x(st.fromM), x1 = Math.max(x0 + 1.5, x(st.toM));
    parts.push(`<rect x="${f1(x0)}" y="${L.plotTop}" width="${f1(x1 - x0)}" height="${L.plotH}" fill="${NOGO}" opacity="0.13"><title>NO-GO ${esc(st.why)}: ${fmtCh(st.fromM)} to ${fmtCh(st.toM)}</title></rect>`);
  }
  // no-data stretches across the full height
  for (const g of p.gaps) {
    const x0 = x(g.fromM), x1 = Math.max(x0 + 2, x(g.toM));
    parts.push(`<rect x="${f1(x0)}" y="${L.plotTop}" width="${f1(x1 - x0)}" height="${f1(L.obstY + 10 - L.plotTop)}" fill="url(#xsHatch)" opacity="0.85"><title>No data: ${g.what === 'both' ? 'height and ground class' : g.what === 'elev' ? 'height' : 'ground class'}, ${fmtCh(g.fromM)} to ${fmtCh(g.toM)}</title></rect>`);
  }
  // the ground: filled area and line, broken where the height is missing
  const segs: string[][] = [];
  let cur: string[] = [];
  let top: { m: number; e: number } | null = null, low: { m: number; e: number } | null = null;
  for (const s of p.samples) {
    if (!Number.isFinite(s.elev)) {
      if (cur.length) segs.push(cur);
      cur = [];
      continue;
    }
    cur.push(`${f1(x(s.m))},${f1(y(s.elev))}`);
    if (!top || s.elev > top.e) top = { m: s.m, e: s.elev };
    if (!low || s.elev < low.e) low = { m: s.m, e: s.elev };
  }
  if (cur.length) segs.push(cur);
  for (const sg of segs) {
    if (sg.length < 2) continue;
    const first = sg[0].split(',')[0], last = sg[sg.length - 1].split(',')[0];
    parts.push(`<path d="M ${first},${f1(floor)} L ${sg.join(' L ')} L ${last},${f1(floor)} Z" fill="url(#xsFill)"/>`);
    parts.push(`<path d="M ${sg.join(' L ')}" fill="none" stroke="${ACCENT}" stroke-width="1.8" stroke-linejoin="round"/>`);
  }
  // steep stretches over the line
  for (const st of p.steep) {
    const pts = p.samples.filter((s) => s.m >= st.fromM && s.m <= st.toM && Number.isFinite(s.elev)).map((s) => `${f1(x(s.m))},${f1(y(s.elev))}`);
    if (pts.length >= 2) parts.push(`<path d="M ${pts.join(' L ')}" fill="none" stroke="${NOGO}" stroke-width="3.2"><title>Steep ${esc(st.why)}</title></path>`);
  }
  // the highest and the lowest point, where the ground is not flat
  if (top && low && top.e - low.e >= 3) {
    const tag = (q: { m: number; e: number }, up: boolean) => {
      const cx = x(q.m), cy = y(q.e);
      const tx = Math.max(L.padL + 16, Math.min(right - 16, cx));
      parts.push(`<path d="${up ? `M ${f1(cx - 4)},${f1(cy - 9)} L ${f1(cx + 4)},${f1(cy - 9)} L ${f1(cx)},${f1(cy - 3)} Z` : `M ${f1(cx - 4)},${f1(cy + 9)} L ${f1(cx + 4)},${f1(cy + 9)} L ${f1(cx)},${f1(cy + 3)} Z`}" fill="#f1f3f6" stroke="${RING}" stroke-width="1"/>`);
      parts.push(`<text x="${f1(tx)}" y="${f1(up ? Math.max(L.plotTop + 9, cy - 12) : Math.min(floor - 3, cy + 20))}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#f1f3f6" stroke="${RING}" stroke-width="3" paint-order="stroke"><title>${up ? 'Highest' : 'Lowest'} point: ${Math.round(q.e)} m at ${fmtCh(q.m)}</title>${Math.round(q.e)}</text>`);
    };
    tag(top, true);
    tag(low, false);
  }
  // how much the heights are stretched
  const ve = timesWord(L.exaggeration);
  if (ve) parts.push(`<text x="${right - 2}" y="${L.plotTop - 4}" text-anchor="end" font-size="10.5" fill="${SOFT}"><title>The heights are drawn ${ve.slice(1)} times larger than the distances, so slopes look steeper than they are</title>Heights ${ve}</text>`);
  // going band
  parts.push(`<text x="${L.padL - 6}" y="${L.goingY + 10}" text-anchor="end" font-size="10.5" fill="${LABEL}">Going</text>`);
  for (const r of p.runs) {
    const x0 = x(r.fromM), x1 = Math.max(x0 + 0.8, x(r.toM));
    const c = r.going === 'go' ? GO : r.going === 'slow' ? SLOW : r.going === 'nogo' ? NOGO : NONE;
    parts.push(`<rect x="${f1(x0)}" y="${L.goingY}" width="${f1(x1 - x0)}" height="12" fill="${c}"/>`);
  }
  // obstacles: a tick each (a bar for a stretch along or in one); a letter and a word where there is room
  parts.push(`<text x="${L.padL - 6}" y="${L.obstY + 9}" text-anchor="end" font-size="10.5" fill="${LABEL}">Obs</text>`);
  const events = o.show ? p.events.filter(o.show) : p.events;
  for (const e of events) {
    const g = KIND_GLYPH[e.kind];
    const xm = x(e.m);
    if (e.mode !== 'cross') {
      const x0 = x(e.fromM), x1 = Math.max(x0 + 2, x(e.toM));
      parts.push(`<rect x="${f1(x0)}" y="${L.obstY + 2}" width="${f1(x1 - x0)}" height="4" fill="${g.c}" opacity="0.8"/>`);
    }
    parts.push(`<line x1="${f1(xm)}" x2="${f1(xm)}" y1="${L.obstY}" y2="${L.obstY + 8}" stroke="${g.c}" stroke-width="2"><title>${esc(e.label)} at ${fmtCh(e.m)}${e.going ? ` (${e.going === 'nogo' ? 'NO-GO' : e.going === 'slow' ? 'SLOW-GO' : 'GO'})` : ''}</title></line>`);
  }
  const byRank = events.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i);
  const letters: number[] = [];
  const words: Array<[number, number]> = [];
  for (const { e } of byRank) {
    const g = KIND_GLYPH[e.kind];
    const xm = x(e.m);
    if (letters.every((q) => Math.abs(q - xm) >= 9)) {
      letters.push(xm);
      parts.push(`<text x="${f1(xm)}" y="${L.obstY + 19}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${g.c}">${esc(g.s)}</text>`);
    }
    if (e.kind === 'steep') continue;
    // a word only where it does not run into one already written (about 5.9 px a letter at 10.5 px)
    const word = e.label.length > 18 ? e.label.slice(0, 17) + '…' : e.label;
    const w = word.length * 5.9;
    let x0 = xm - 3;
    if (x0 + w > right) x0 = right - w;
    if (x0 < L.padL) x0 = L.padL;
    if (words.every(([a, b]) => x0 > b + 8 || x0 + w < a - 8)) {
      words.push([x0, x0 + w]);
      const c = e.going === 'nogo' ? '#ff8a8d' : e.going === 'slow' ? '#ffb46b' : '#d5dbe1';
      parts.push(`<text x="${f1(x0)}" y="${L.obstY + 31}" font-size="10.5" fill="${c}">${esc(word)}</text>`);
    }
  }
  // what the threat sees (stretches of one answer drawn as one bar)
  if (o.withSeen) {
    parts.push(`<text x="${L.padL - 6}" y="${L.seenY + 8}" text-anchor="end" font-size="10.5" fill="${LABEL}">Seen</text>`);
    const state = (v: number | null) => (v === null ? 0 : v >= 0.5 ? 2 : 1);
    let i0 = 0;
    for (let i = 1; i <= p.samples.length; i++) {
      if (i < p.samples.length && state(p.samples[i].seen) === state(p.samples[i0].seen)) continue;
      const st = state(p.samples[i0].seen);
      const x0 = x(p.samples[i0].m), x1 = x(i < p.samples.length ? p.samples[i].m : p.lengthM);
      parts.push(`<rect x="${f1(x0)}" y="${L.seenY}" width="${f1(Math.max(0.6, x1 - x0))}" height="8" fill="${st === 0 ? NONE : st === 2 ? SEEN : 'rgba(167,139,250,.18)'}"/>`);
      i0 = i;
    }
  }
  // distance markers, from A (the start) to B (the end, with the line's length)
  const ax = axisMarks(p.lengthM);
  const endX = x(p.lengthM);
  parts.push(`<line x1="${L.padL}" x2="${right}" y1="${L.axisY - 4}" y2="${L.axisY - 4}" stroke="#5d6772"/>`);
  for (const mk of ax.marks) {
    const xm = x(mk.m);
    parts.push(`<line x1="${f1(xm)}" x2="${f1(xm)}" y1="${L.axisY - 4}" y2="${L.axisY + 2}" stroke="${SOFT}"/>`);
    if (mk.m > 0 && xm > endX - 58) continue; // the end label takes this room
    parts.push(`<text x="${f1(mk.m === 0 ? xm + 9 : xm)}" y="${L.axisY + 15}" text-anchor="${mk.m === 0 ? 'start' : 'middle'}" font-size="11" fill="${LABEL}">${mk.label}</text>`);
  }
  parts.push(`<line x1="${f1(endX)}" x2="${f1(endX)}" y1="${L.axisY - 4}" y2="${L.axisY + 2}" stroke="${SOFT}"/>`);
  parts.push(`<text x="${f1(endX - 9)}" y="${L.axisY + 15}" text-anchor="end" font-size="11" font-weight="700" fill="#f1f3f6">${fmtCh(p.lengthM)}</text>`);
  const badge = (cx: number, s: string, tip: string) =>
    `<g><title>${tip}</title><circle cx="${f1(cx)}" cy="${L.axisY + 11}" r="6.5" fill="${ACCENT}" stroke="${RING}" stroke-width="1"/><text x="${f1(cx)}" y="${L.axisY + 14.8}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${RING}">${s}</text></g>`;
  parts.push(badge(L.padL, 'A', 'A: where the line starts') + badge(endX, 'B', 'B: where the line ends'));
  // hover layer
  parts.push(`<g class="xs-hover" style="display:none;pointer-events:none"><line class="xs-hl" y1="${L.plotTop}" y2="${L.axisY - 4}" stroke="#ffc800" stroke-dasharray="3 3"/><circle class="xs-hd" r="4" fill="#ffc800" stroke="${RING}" stroke-width="1.5"/></g>`);
  return { svg: `<svg width="${W}" height="${L.H}" viewBox="0 0 ${W} ${L.H}" class="xs-svg" role="img" aria-label="Cross-section: height, going and obstacles along the line" style="display:block;max-width:100%;height:auto;cursor:crosshair">${parts.join('')}</svg>`, L };
}
