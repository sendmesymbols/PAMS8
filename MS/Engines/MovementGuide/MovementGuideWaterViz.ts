/**
 * MovementGuideWaterViz.ts
 *
 * The Water card's pictures, SVG strings sized for one column of the Mov Detail (about 290 px), in the manner of
 * MovementGuideViz.ts:
 *   waterSection  the cross-section from 30 m ground, home bank on the left and far bank on the right (whichever side
 *                 of the obstacle that is), the water, each crest's height with where the figure comes from
 *   axisStrip     an axis's obstacles in order from its start, coloured by the tank verdict
 *   reachStrip    the reach's stations: width as bars, home / far bank heights as lines, narrowest and lowest marked
 */

import Utils from '../../Support/utils';
import { VZ } from './MovementGuideViz';
import { SRC_WORD, type AxisReading, type Fig, type Going, type ReachReading, type WaterReading } from './MovementGuideWater';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));
export const GOING_C: Record<Going, string> = { go: VZ.green, slow: VZ.yellow, nogo: VZ.red };
export const GOING_W: Record<Going, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO' };

/** "3 m (Sheet)", "1.5-3 m (IBB typical)", "?" */
export function figText(f: Fig, unit = 'm'): string {
  if (f.src === 'none' || f.v === null) return '?';
  const r = (v: number) => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  const body = f.lo !== null && f.hi !== null && f.lo !== f.hi ? (f.lo <= 0 ? `up to ${r(f.hi)}` : `${r(f.lo)}-${r(f.hi)}`) : r(f.v);
  return `${body} ${unit}`;
}
export const srcText = (f: Fig): string => (f.src === 'none' ? 'Unknown' : `${SRC_WORD[f.src]}${f.note ? `, ${f.note}` : ''}`);

export function waterSection(w: WaterReading, width = 290, height = 150): string {
  const s = w.section;
  // Home on the left: flip the distances when home is on the right of the obstacle's direction.
  const flip = w.homeSign === 1 ? -1 : 1;
  const pts = s.d.map((d, i) => ({ x: d * flip, z: s.z[i] })).filter((p) => Number.isFinite(p.z));
  if (pts.length < 3) return `<div class="mgd-in">Heights still loading…</div>`;
  pts.sort((a, b) => a.x - b.x);
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let z0 = Math.min(...zs), z1 = Math.max(...zs);
  if (s.waterZ !== null) z0 = Math.min(z0, s.waterZ - 1);
  if (z1 - z0 < 6) {
    const m = (z0 + z1) / 2;
    z0 = m - 3;
    z1 = m + 3;
  }
  const L = 8, Rr = 8, T = 30, B = 22;
  const X = (x: number) => L + ((x - x0) / Math.max(1, x1 - x0)) * (width - L - Rr);
  const Y = (z: number) => T + (1 - (z - z0) / Math.max(0.1, z1 - z0)) * (height - T - B);
  const ground = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.z).toFixed(1)}`).join('');
  const fill = `${ground}L${X(x1).toFixed(1)},${height - B}L${X(x0).toFixed(1)},${height - B}Z`;
  let water = '';
  if (s.edges && s.waterZ !== null) {
    const ea = Math.min(s.edges[0] * flip, s.edges[1] * flip), eb = Math.max(s.edges[0] * flip, s.edges[1] * flip);
    water = `<rect x="${X(ea).toFixed(1)}" y="${Y(s.waterZ).toFixed(1)}" width="${Math.max(2, X(eb) - X(ea)).toFixed(1)}" height="${Math.max(2, height - B - Y(s.waterZ)).toFixed(1)}" fill="${VZ.cyan}" opacity=".45"/>`;
  } else water = `<line x1="${X(0)}" y1="${T}" x2="${X(0)}" y2="${height - B}" stroke="${VZ.cyan}" stroke-width="3" opacity=".6"/>`;
  // Crest labels: home left (green), far right (red).
  const homeSide = w.homeSign === 1 ? 1 : 0;
  const crest = (side: 0 | 1) => s.crests[side];
  const lab = (side: 0 | 1, home: boolean) => {
    const c = crest(side);
    const b = home ? w.home : w.far;
    const f = b.aboveWater.src !== 'none' ? b.aboveWater : b.aboveLand;
    const tx = home ? L + 2 : width - Rr - 2;
    const anchor = home ? 'start' : 'end';
    const dot = c ? `<circle cx="${X(c[0] * flip).toFixed(1)}" cy="${Y(c[1]).toFixed(1)}" r="3.5" fill="${home ? VZ.green : VZ.red}"/>` : '';
    return `${dot}<text x="${tx}" y="12" text-anchor="${anchor}" font-size="11.5" font-weight="700" fill="${home ? VZ.green : VZ.red}">${home ? 'HOME' : 'FAR'} ${esc(b.dir)} · ${esc(figText(f))}</text><text x="${tx}" y="24" text-anchor="${anchor}" font-size="10" fill="${VZ.ink}">${esc(f === b.aboveWater ? 'above water' : 'above land')} · ${esc(SRC_WORD[f.src])}</text>`;
  };
  // The width inside the water (clear of the scale along the foot).
  const wy = s.waterZ !== null ? Math.min(height - B - 4, Y(s.waterZ) + 14) : height - B - 4;
  const widthLbl = `<text x="${X(0).toFixed(1)}" y="${wy.toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" stroke="#14181d" stroke-width="3" paint-order="stroke">${esc(figText(w.width))} wide</text>`;
  const scale = `<text x="${width - Rr}" y="${height - 6}" text-anchor="end" font-size="9.5" fill="${VZ.grey}">${Math.round(x1 - x0)} m across · ${Math.round(z1 - z0)} m tall</text>`;
  return `<svg class="mgv" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Cross-section of the water obstacle"><path d="${fill}" fill="rgba(255,255,255,.07)"/>${water}<path d="${ground}" fill="none" stroke="${VZ.ink}" stroke-width="1.6"/>${lab(homeSide as 0 | 1, true)}${lab((1 - homeSide) as 0 | 1, false)}${widthLbl}${scale}</svg>`;
}

export function axisStrip(a: AxisReading, chosen: number, width = 290): string {
  const h = 54;
  const L = 10, Rr = 10;
  const len = Math.max(1, a.lengthM);
  const X = (m: number) => L + (m / len) * (width - L - Rr);
  const marks = a.obstacles
    .map((o, i) => {
      const c = GOING_C[o.reading.verdict.tanks.v];
      const sel = i === chosen;
      return `<g data-choose="${i}" style="cursor:pointer"><rect x="${(X(o.chainM) - 7).toFixed(1)}" y="14" width="14" height="22" rx="3" fill="${c}" opacity="${sel ? 1 : 0.6}" stroke="${sel ? '#fff' : 'none'}" stroke-width="1.5"/><text x="${X(o.chainM).toFixed(1)}" y="29" text-anchor="middle" font-size="11" font-weight="700" fill="#14181d">${i + 1}</text></g>`;
    })
    .join('');
  return `<svg class="mgv" viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Obstacles along the axis"><line x1="${L}" y1="25" x2="${width - Rr}" y2="25" stroke="${VZ.ink}" stroke-width="2"/><text x="${L}" y="50" font-size="10" fill="${VZ.green}">Home (start)</text><text x="${width - Rr}" y="50" text-anchor="end" font-size="10" fill="${VZ.grey}">${(a.lengthM / 1000).toFixed(1)} km</text>${marks}</svg>`;
}

export function reachStrip(r: ReachReading, width = 290, height = 120): string {
  const st = r.stations;
  if (st.length < 2) return '';
  const L = 26, Rr = 8, T = 10, B = 20;
  const maxW = Math.max(10, ...st.map((s) => s.widthM ?? 0));
  const maxB = Math.max(2, ...st.map((s) => Math.max(s.homeM ?? 0, s.farM ?? 0)));
  const X = (i: number) => L + (i / (st.length - 1)) * (width - L - Rr);
  const Yb = (v: number) => T + (1 - v / maxB) * (height - T - B);
  const bw = Math.max(3, ((width - L - Rr) / st.length) * 0.5);
  const bars = st.map((s, i) => (s.widthM !== null ? `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(height - B - ((s.widthM / maxW) * (height - T - B)) / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${(((s.widthM / maxW) * (height - T - B)) / 2).toFixed(1)}" fill="${VZ.cyan}" opacity=".35"/>` : '')).join('');
  const line = (k: 'homeM' | 'farM', c: string) => {
    const p = st.map((s, i) => (s[k] !== null ? `${X(i).toFixed(1)},${Yb(s[k]!).toFixed(1)}` : null)).filter(Boolean);
    return p.length >= 2 ? `<polyline points="${p.join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>` : '';
  };
  const tag = (i: number | null, t: string) => (i === null ? '' : `<text x="${X(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${VZ.orange}">${t}</text>`);
  const xing = st.map((s, i) => (s.crossing ? `<text x="${X(i).toFixed(1)}" y="${T + 9}" text-anchor="middle" font-size="10" fill="${VZ.green}">B</text>` : '')).join('');
  return `<svg class="mgv" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Along the reach"><text x="2" y="${T + 8}" font-size="9.5" fill="${VZ.grey}">${Math.round(maxB)} m</text>${bars}${line('homeM', VZ.green)}${line('farM', VZ.red)}${xing}${tag(r.narrowest, 'N')}${tag(r.lowestFar, r.lowestFar === r.narrowest ? '' : 'L')}<text x="${width - Rr}" y="${height - 6}" text-anchor="end" font-size="9.5" fill="${VZ.grey}">${(r.lengthM / 1000).toFixed(1)} km</text></svg>`;
}
