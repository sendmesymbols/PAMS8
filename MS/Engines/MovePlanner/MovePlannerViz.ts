/**
 * MovePlannerViz.ts
 *
 * Pictures for the Move Planner, as SVG markup (all text escaped):
 *   timeDistance  the move graph (Staff Duties 14.1415): time across, km up; each serial is a band from its tail to its
 *                 head (the road it holds), halts flat, harbours long and flat, crossing waits marked X; night shaded
 *                 from last to first light, midnights dashed with M, M+1 ...; critical points named on the km scale.
 *   gantt         bars against the clock with the same night shading: the Mov & Assy matrix, trains, enemy formations.
 *   trainStrip    a train in its marshalling order (engines, brake van, AD, kitchen, stores, BKF / KF, MBFR / MBFU, mob
 *                 ramp, AD, engine), each wagon as long as its C units, loaded wagons showing what they carry.
 *   progress      DI: each corps' share concentrated by the end of each day.
 */

import Utils from '../../Support/utils';
import { MIN, dtg, hhmm, mDayLabel, mDayOf, localMin, DAY_MIN, type MvClock } from './MoveTime';
import type { StockType, TrainTimed } from './MoveRail';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));
const H = 3600000;

export const VIZ = {
  bg: '#14181d',
  panel: '#1b1f25',
  night: 'rgba(4,8,20,.62)',
  day: 'rgba(255,214,140,.07)',
  grid: 'rgba(255,255,255,.08)',
  axis: 'rgba(255,255,255,.35)',
  text: '#c3cbd3',
  strong: '#f1f3f6',
  red: '#e5484d',
  orange: '#ee8a1f',
  green: '#2fa862',
  accent: '#8ec1ea',
};

export interface TdSeries {
  id: string;
  name: string;
  color: string;
  head: [number, number][];
  tail: [number, number][];
  stops: { t0: number; t1: number; s: number; kind: string; label: string }[];
  lengthKm: number;
}

export interface TdOpts {
  w: number;
  h: number;
  clock: MvClock;
  t0: number;
  t1: number;
  series: TdSeries[];
  /** Night intervals [from, to] (UTC ms). */
  nights: [number, number][];
  /** Names on the km scale. */
  marks?: { km: number; name: string }[];
  conflicts?: { t: number; km: number; label: string }[];
  cursor?: number | null;
  /** The km scale's top (default: the longest series). */
  maxKm?: number;
  highlight?: string | null;
}

function niceStepH(spanH: number, px: number): number {
  const want = spanH / Math.max(2, px / 70);
  for (const s of [0.5, 1, 2, 3, 4, 6, 12, 24, 48]) if (s >= want) return s;
  return 96;
}
function niceStepKm(maxKm: number, px: number): number {
  const want = maxKm / Math.max(2, px / 40);
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]) if (s >= want) return s;
  return 1000;
}

function timeAxis(o: { clock: MvClock; t0: number; t1: number; x: (t: number) => number; top: number; bottom: number; left: number; right: number; nights: [number, number][] }): string {
  const { clock, t0, t1, x, top, bottom } = o;
  // day a warm tint, night darker (on a dark card a lighter night would read the wrong way round)
  let s = `<rect x="${o.left}" y="${top}" width="${o.right - o.left}" height="${bottom - top}" fill="${VIZ.day}"/>`;
  for (const [a, b] of o.nights) {
    const xa = Math.max(o.left, x(a)), xb = Math.min(o.right, x(b));
    if (xb > xa) s += `<rect x="${xa.toFixed(1)}" y="${top}" width="${(xb - xa).toFixed(1)}" height="${bottom - top}" fill="${VIZ.night}"/>`;
  }
  const step = niceStepH((t1 - t0) / H, o.right - o.left) * H;
  const first = clock.mDayMs + Math.ceil((t0 - clock.mDayMs) / step) * step;
  for (let t = first; t <= t1; t += step) {
    const xx = x(t);
    const mid = Math.round(localMin(clock, t)) % DAY_MIN === 0;
    s += `<line x1="${xx.toFixed(1)}" y1="${top}" x2="${xx.toFixed(1)}" y2="${bottom}" stroke="${mid ? 'rgba(255,255,255,.4)' : VIZ.grid}" ${mid ? 'stroke-dasharray="5 4"' : ''}/>`;
    if (step < 24 * H) s += `<text x="${xx.toFixed(1)}" y="${bottom + 14}" fill="${VIZ.text}" font-size="11" text-anchor="middle">${esc(hhmm(clock, t))}</text>`;
    if (mid) s += `<text x="${(xx + 4).toFixed(1)}" y="${top + 12}" fill="${VIZ.strong}" font-size="11.5" font-weight="700">${esc(mDayLabel(mDayOf(clock, t + 1)))}</text>`;
  }
  // the first day's label at the left edge
  s += `<text x="${(o.left + 4).toFixed(1)}" y="${top + 12}" fill="${VIZ.strong}" font-size="11.5" font-weight="700">${esc(mDayLabel(mDayOf(clock, t0)))}</text>`;
  return s;
}

/** The move graph (time across, distance up). */
export function timeDistance(o: TdOpts): string {
  const L = 54, Rr = 12, T = 8, B = 22;
  const w = Math.max(320, o.w), h = Math.max(160, o.h);
  const maxKm = o.maxKm ?? Math.max(1, ...o.series.map((x) => x.lengthKm));
  const span = Math.max(H, o.t1 - o.t0);
  const x = (t: number) => L + ((t - o.t0) / span) * (w - L - Rr);
  const y = (km: number) => h - B - (Math.max(-maxKm * 0.04, Math.min(maxKm * 1.02, km)) / maxKm) * (h - T - B);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Move graph">`;
  s += `<rect width="${w}" height="${h}" fill="${VIZ.bg}" rx="6"/>`;
  s += `<clipPath id="mvp-clip"><rect x="${L}" y="${T}" width="${w - L - Rr}" height="${h - T - B}"/></clipPath>`;
  s += timeAxis({ clock: o.clock, t0: o.t0, t1: o.t0 + span, x, top: T, bottom: h - B, left: L, right: w - Rr, nights: o.nights });
  const ks = niceStepKm(maxKm, h - T - B);
  for (let k = 0; k <= maxKm + 1e-6; k += ks) {
    const yy = y(k);
    s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${w - Rr}" y2="${yy.toFixed(1)}" stroke="${VIZ.grid}"/>`;
    s += `<text x="${L - 6}" y="${(yy + 4).toFixed(1)}" fill="${VIZ.text}" font-size="11" text-anchor="end">${k}</text>`;
  }
  s += `<text x="10" y="${T + 10}" fill="${VIZ.text}" font-size="11">km</text>`;
  for (const m of o.marks ?? []) {
    const yy = y(m.km);
    s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${w - Rr}" y2="${yy.toFixed(1)}" stroke="rgba(142,193,234,.35)" stroke-dasharray="2 4"/>`;
    s += `<text x="${L + 4}" y="${(yy - 3).toFixed(1)}" fill="${VIZ.accent}" font-size="10.5">${esc(m.name)}</text>`;
  }
  s += `<g clip-path="url(#mvp-clip)">`;
  for (const se of o.series) {
    const dim = o.highlight && o.highlight !== se.id;
    const op = dim ? 0.25 : 1;
    if (se.head.length && se.tail.length) {
      const pts = [...se.head.map(([t, k]) => `${x(t).toFixed(1)},${y(k).toFixed(1)}`), ...se.tail.slice().reverse().map(([t, k]) => `${x(t).toFixed(1)},${y(k).toFixed(1)}`)];
      s += `<polygon points="${pts.join(' ')}" fill="${esc(se.color)}" fill-opacity="${(0.26 * op).toFixed(2)}" stroke="none"/>`;
    }
    const line = (p: [number, number][]) => p.map(([t, k], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(k).toFixed(1)}`).join('');
    s += `<path d="${line(se.tail)}" fill="none" stroke="${esc(se.color)}" stroke-opacity="${(0.7 * op).toFixed(2)}" stroke-width="1.3" stroke-dasharray="4 3"/>`;
    s += `<path d="${line(se.head)}" fill="none" stroke="${esc(se.color)}" stroke-opacity="${op}" stroke-width="2.2"/>`;
    for (const st of se.stops) {
      if (st.kind === 'X' || st.t1 - st.t0 < MIN) continue;
      const yy = y(st.s / 1000);
      const col = st.kind === 'DLH' ? VIZ.orange : st.kind === 'DC' ? VIZ.accent : '#ffffff';
      s += `<line x1="${x(st.t0).toFixed(1)}" y1="${yy.toFixed(1)}" x2="${x(st.t1).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${col}" stroke-opacity="${op}" stroke-width="${st.kind === 'DLH' ? 4 : 3}" stroke-linecap="round"><title>${esc(`${se.name} ${st.label}`)}</title></line>`;
    }
  }
  for (const c of o.conflicts ?? []) {
    const cx = x(c.t), cy = y(c.km);
    s += `<g><title>${esc(c.label)}</title><path d="M${cx - 5} ${cy - 5} L${cx + 5} ${cy + 5} M${cx + 5} ${cy - 5} L${cx - 5} ${cy + 5}" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><path d="M${cx - 5} ${cy - 5} L${cx + 5} ${cy + 5} M${cx + 5} ${cy - 5} L${cx - 5} ${cy + 5}" stroke="${VIZ.red}" stroke-width="2.4" stroke-linecap="round"/></g>`;
  }
  s += `</g>`;
  if (o.cursor && o.cursor >= o.t0 && o.cursor <= o.t0 + span) {
    const cx = x(o.cursor);
    s += `<line x1="${cx.toFixed(1)}" y1="${T}" x2="${cx.toFixed(1)}" y2="${h - B}" stroke="${VIZ.accent}" stroke-width="1.5"/>`;
    s += `<rect x="${(cx - 34).toFixed(1)}" y="${T}" width="68" height="16" rx="3" fill="${VIZ.accent}"/><text x="${cx.toFixed(1)}" y="${T + 12}" fill="#14181d" font-size="11" font-weight="700" text-anchor="middle">${esc(dtg(o.clock, o.cursor))}</text>`;
  }
  s += `<line x1="${L}" y1="${h - B}" x2="${w - Rr}" y2="${h - B}" stroke="${VIZ.axis}"/><line x1="${L}" y1="${T}" x2="${L}" y2="${h - B}" stroke="${VIZ.axis}"/>`;
  return s + '</svg>';
}

export interface GanttRow {
  id: string;
  label: string;
  sub?: string;
  bars: { from: number; to: number; color: string; label?: string; hatch?: boolean; thin?: boolean }[];
  marks?: { t: number; label: string; color?: string }[];
}

/** Bars against the clock, night shaded (the matrix; trains; enemy formations). */
export function gantt(o: { w: number; clock: MvClock; t0: number; t1: number; rows: GanttRow[]; nights: [number, number][]; rowH?: number; cursor?: number | null; labelW?: number }): string {
  const rowH = o.rowH ?? 24;
  const LW = o.labelW ?? 150, Rr = 12, T = 18, B = 20;
  const w = Math.max(360, o.w), h = T + B + Math.max(1, o.rows.length) * rowH;
  const span = Math.max(H, o.t1 - o.t0);
  const x = (t: number) => LW + ((t - o.t0) / span) * (w - LW - Rr);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Matrix">`;
  s += `<rect width="${w}" height="${h}" fill="${VIZ.bg}" rx="6"/>`;
  s += `<defs><pattern id="mvp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="rgba(255,255,255,.25)"/></pattern></defs>`;
  s += timeAxis({ clock: o.clock, t0: o.t0, t1: o.t0 + span, x, top: T - 4, bottom: h - B, left: LW, right: w - Rr, nights: o.nights });
  o.rows.forEach((r, i) => {
    const y0 = T + i * rowH;
    if (i % 2) s += `<rect x="0" y="${y0}" width="${w}" height="${rowH}" fill="rgba(255,255,255,.025)"/>`;
    s += `<text x="8" y="${y0 + rowH / 2 + (r.sub ? -1 : 4)}" fill="${VIZ.strong}" font-size="12" font-weight="600">${esc(r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label)}</text>`;
    if (r.sub) s += `<text x="8" y="${y0 + rowH / 2 + 11}" fill="${VIZ.text}" font-size="10">${esc(r.sub)}</text>`;
    for (const b of r.bars) {
      if (!(b.to > b.from)) continue;
      const xa = Math.max(LW, x(b.from)), xb = Math.min(w - Rr, x(b.to));
      const bh = b.thin ? rowH * 0.28 : rowH * 0.6;
      const yy = y0 + (rowH - bh) / 2;
      s += `<g><title>${esc(`${r.label}${b.label ? ` · ${b.label}` : ''}: ${dtg(o.clock, b.from)} - ${dtg(o.clock, b.to)}`)}</title><rect x="${xa.toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.max(2, xb - xa).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${esc(b.color)}" fill-opacity="${b.thin ? 0.55 : 0.85}"/>${b.hatch ? `<rect x="${xa.toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.max(2, xb - xa).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#mvp-hatch)"/>` : ''}</g>`;
    }
    for (const m of r.marks ?? []) {
      const xx = x(m.t);
      s += `<g><title>${esc(`${r.label}: ${m.label} ${dtg(o.clock, m.t)}`)}</title><path d="M${xx.toFixed(1)} ${y0 + 3} l4 6 l-4 6 l-4 -6 z" fill="${esc(m.color ?? '#fff')}" stroke="#14181d"/></g>`;
    }
  });
  if (o.cursor && o.cursor >= o.t0 && o.cursor <= o.t0 + span) {
    const cx = x(o.cursor);
    s += `<line x1="${cx.toFixed(1)}" y1="${T - 4}" x2="${cx.toFixed(1)}" y2="${h - B}" stroke="${VIZ.accent}" stroke-width="1.5"/>`;
  }
  return s + '</svg>';
}

export const STOCK_COLOR: Record<StockType, string> = {
  Engine: '#5d6772',
  Brake: '#7f8893',
  MBFR: '#af7ac5',
  MBFU: '#d4ac0d',
  BKF: '#e8a33d',
  KF: '#40c0b0',
  C: '#60a8cf',
  TLR: '#6fae4a',
};

/** A train in its marshalling order for departure, each wagon as long as its C units. */
export function trainStrip(t: TrainTimed, stockC: Record<string, { c: number }>, kindLabel: (k: string) => string, w = 760): string {
  type Car = { type: StockType; role: string; title: string; n?: number };
  const cars: Car[] = [{ type: 'Engine', role: 'Eng', title: 'Engine' }, { type: 'Brake', role: 'Brk', title: 'Brake van' }];
  if (t.kind === 'vehicle') cars.push({ type: 'KF', role: 'AD', title: 'KF: AD (2 x 12.7 AA MG)' }, { type: 'C', role: 'Kit', title: 'Covered wagon: kitchen' }, { type: 'TLR', role: 'Crew', title: 'TLR: crews and baggage' });
  const order: StockType[] = ['TLR', 'C', 'BKF', 'KF', 'MBFR', 'MBFU'];
  for (const ty of order)
    for (const wg of t.wagons.filter((x) => x.type === ty)) {
      const what = wg.load.length ? wg.load.map((l) => `${l.n} x ${kindLabel(l.kind)}`).join(', ') : wg.pax ? `${wg.pax} pers` : wg.stores ? `${wg.stores} t stores` : '';
      cars.push({ type: ty, role: ty, title: `${ty}${what ? `: ${what}` : ''}`, n: wg.load.reduce((m, l) => m + l.n, 0) || undefined });
    }
  if (t.kind === 'vehicle') cars.push({ type: 'KF', role: 'Rmp', title: 'KF: mob ramp' }, { type: 'KF', role: 'AD', title: 'KF: AD (2 x 12.7 AA MG)' });
  cars.push({ type: 'Engine', role: 'Eng', title: 'Engine' });
  const units = cars.reduce((m, c) => m + Math.max(1, c.type === 'Engine' ? 2 : stockC[c.type]?.c ?? 1), 0);
  const unitW = Math.min(14, (w - 8) / units);
  const h = 34;
  let x = 4;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t.name)} make-up">`;
  s += `<line x1="2" y1="${h - 5}" x2="${w - 2}" y2="${h - 5}" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>`;
  for (const c of cars) {
    const cu = c.type === 'Engine' ? 2 : stockC[c.type]?.c ?? 1;
    const cw = Math.max(5, cu * unitW - 1.5);
    const col = STOCK_COLOR[c.type];
    s += `<g><title>${esc(c.title)}</title><rect x="${x.toFixed(1)}" y="6" width="${cw.toFixed(1)}" height="${h - 14}" rx="${c.type === 'Engine' ? 5 : 2}" fill="${col}" stroke="#14181d"/>`;
    // the label that fits: "MBFR×2", else "×2", else nothing
    const full = c.n && c.n > 1 ? `${c.role}×${c.n}` : c.role;
    const short = c.n && c.n > 1 ? `×${c.n}` : c.role;
    const fit = [full, short].find((tx) => tx.length * 5.6 + 3 <= cw);
    if (fit) s += `<text x="${(x + cw / 2).toFixed(1)}" y="${h / 2 + 2}" font-size="9" font-weight="700" fill="#14181d" text-anchor="middle">${esc(fit)}</text>`;
    s += `<circle cx="${(x + 3).toFixed(1)}" cy="${h - 5}" r="2" fill="#9aa3ad"/><circle cx="${(x + cw - 3).toFixed(1)}" cy="${h - 5}" r="2" fill="#9aa3ad"/></g>`;
    x += cw + 1.5;
  }
  return s + '</svg>';
}

/** DI progress: for each corps a row of days, each cell filled to the share concentrated by that day's end. */
export function progressChart(o: { corps: string[]; total: Record<string, number>; days: { day: number; pct: Record<string, number>; today: Record<string, string[]> }[]; colors: Record<string, string>; w: number }): string {
  const LW = 120, cw = Math.max(34, Math.min(70, (o.w - LW - 10) / Math.max(1, o.days.length))), rowH = 30, T = 22;
  const w = LW + cw * o.days.length + 10, h = T + rowH * o.corps.length + 6;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Progress by day">`;
  s += `<rect width="${w}" height="${h}" fill="${VIZ.bg}" rx="6"/>`;
  o.days.forEach((d, j) => {
    s += `<text x="${LW + j * cw + cw / 2}" y="15" fill="${VIZ.strong}" font-size="11.5" font-weight="700" text-anchor="middle">${esc(mDayLabel(d.day))}</text>`;
  });
  o.corps.forEach((c, i) => {
    const y0 = T + i * rowH;
    s += `<text x="8" y="${y0 + 13}" fill="${VIZ.strong}" font-size="12" font-weight="600">${esc(c)}</text><text x="8" y="${y0 + 25}" fill="${VIZ.text}" font-size="10">${o.total[c] ?? 0} units</text>`;
    o.days.forEach((d, j) => {
      const p = d.pct[c] ?? 0;
      const x0 = LW + j * cw + 2;
      const names = (d.today[c] ?? []).join(', ');
      s += `<g><title>${esc(`${c} ${mDayLabel(d.day)}: ${p}%${names ? ` (today: ${names})` : ''}`)}</title><rect x="${x0}" y="${y0 + 4}" width="${cw - 4}" height="${rowH - 8}" rx="3" fill="rgba(255,255,255,.06)"/>`;
      s += `<rect x="${x0}" y="${y0 + 4}" width="${((cw - 4) * p) / 100}" height="${rowH - 8}" rx="3" fill="${esc(o.colors[c] ?? VIZ.accent)}" fill-opacity="${d.today[c]?.length ? 0.95 : 0.55}"/>`;
      s += `<text x="${x0 + (cw - 4) / 2}" y="${y0 + rowH / 2 + 4}" fill="#fff" font-size="10.5" font-weight="700" text-anchor="middle">${p}%</text></g>`;
    });
  });
  return s + '</svg>';
}

/** Night intervals (last light to first light) at a place over a span, from a light book. */
export function nightsOver(light: { day(d: number, lat: number, lng: number): { first: number; last: number } }, clock: MvClock, t0: number, t1: number, at: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (let d = mDayOf(clock, t0) - 1; d <= mDayOf(clock, t1); d++) {
    const a = light.day(d, at[1], at[0]), b = light.day(d + 1, at[1], at[0]);
    if (Number.isFinite(a.last) && Number.isFinite(b.first)) out.push([a.last, b.first]);
  }
  return out;
}
