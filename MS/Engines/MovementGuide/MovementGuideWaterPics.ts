/**
 * MovementGuideWaterPics.ts
 *
 * The Water card's pictures, shared by the cursor card (MovementGuideWaterCard) and the Water lenses of the Mov Detail
 * (MovementGuideWaterDetail). Pure SVG markup built from numbers, fixed strings and escaped names, so it is safe to set
 * as innerHTML. Colours from GroundGuideTokens.ts (the verdict ladder) plus a water blue and an earth brown.
 *
 *   fisheyeSection  the cross-section with a fisheye across it: the water and the banks get most of the width, the land
 *                   behind is squeezed to the edges, so a 70 m canal in a 1.5 km section still reads; the bed drawn at the
 *                   recorded depth (dashed with "?" when not known), crests flagged home / far, and a soldier (1.8 m)
 *                   and a tank (2.4 m) standing on the home bank to the picture's height scale
 *   planRadar       the obstacle from above, north up and turning with the map: the band across at its true bearing,
 *                   home half tinted green and far half red, the crossings where they are (to scale out to 1 km, then a
 *                   log band out to the search radius), the pointer
 *   gaugesPic       three tubes: depth against the wading depths, the step out against what a tank climbs, the width
 *                   (log scale) against a tank's gap, a full ditch and the division's bridge spans (IBB Annex Q)
 *   monthWheel      twelve months round a ring: the monsoon shaded, this month pointed, each ford / ferry's months in use
 *   alongStrip      the obstacle straightened: the crossings either way along it, with distances
 *   sourceDonut     how much of what the card says is measured, mapped, estimated, typical or unknown
 *   bankTowers      home and far bank side by side (above the water, above the land) against the tank's climb and a man
 *   annexTiles      the ten IBB Annex P types as silhouettes from the pamphlet's sketches, this one lit
 *   moverIcon       tank / truck / soldier glyphs for the going chips
 */

import Utils from '../../Support/utils';
import { STEP_COLOR, STEP_TEXT, SURFACE, TEXT, LINE } from '../GroundGuide/GroundGuideTokens';
import { worst, type Fig, type Going, type WaterReading, type WaterRules, type WaterTypeId, typeDef } from './MovementGuideWater';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));
const F = 'system-ui,Segoe UI,Arial,sans-serif';
export const WATER = { light: '#7cc8ff', mid: '#3a95d8', deep: '#164f86', line: '#9fd6ff' } as const;
export const EARTH = { top: '#4a4134', low: '#2a251e', line: '#cbb48a' } as const;
export const HOME = STEP_COLOR.go;
export const FAR = STEP_COLOR.nogo;
export const GO_C: Record<Going, string> = { go: STEP_COLOR.go, slow: STEP_COLOR.slow, nogo: STEP_COLOR.nogo };
export const GO_T: Record<Going, string> = { go: STEP_TEXT.go, slow: STEP_TEXT.slow, nogo: STEP_TEXT.nogo };
export const GO_W: Record<Going, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO' };

let uid = 0;
const id = (p: string) => `${p}${++uid}`;
const n1 = (v: number) => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
const t = (x: number, y: number, s: string, o: { size?: number; w?: number; fill?: string; anchor?: string; halo?: boolean; cls?: string; up?: boolean } = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${F}" font-size="${o.size ?? 11}" font-weight="${o.w ?? 600}" fill="${o.fill ?? TEXT.label}" text-anchor="${o.anchor ?? 'start'}"${o.halo ? ` stroke="${SURFACE.ring}" stroke-width="3" paint-order="stroke"` : ''}${o.up ? ` data-gv-upright="${x.toFixed(1)} ${y.toFixed(1)}"` : ''}>${esc(s)}</text>`;

/** A figure's value in words: "3 m", "1.5-3 m", "up to 5.2 m", "?". */
export function figWord(f: Fig, unit = 'm'): string {
  if (f.src === 'none' || f.v === null) return '?';
  if (f.lo !== null && f.hi !== null && f.lo !== f.hi) return f.lo <= 0 ? `≤${n1(f.hi)} ${unit}` : `${n1(f.lo)}-${n1(f.hi)} ${unit}`;
  return `${n1(f.v)} ${unit}`;
}
/** One letter for where a figure comes from (S sheet, R reach, M map class, E estimate, Y symbol, I IBB typical, ? unknown). */
export const SRC_LETTER: Record<Fig['src'], string> = { sheet: 'S', reach: 'R', map: 'M', est: 'E', symbol: 'Y', pamphlet: 'I', none: '?' };
export const SRC_COLOR: Record<Fig['src'], string> = { sheet: '#74dca3', reach: '#74dca3', map: '#8ec1ea', est: '#f1d646', symbol: '#8ec1ea', pamphlet: '#c3a6ff', none: '#7f8893' };

// ── glyphs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A soldier standing, feet at (x, y), `h` px tall. */
function soldier(x: number, y: number, h: number, c = '#e8ebee'): string {
  const s = h / 18;
  return `<g transform="translate(${x.toFixed(1)} ${(y - h).toFixed(1)}) scale(${s.toFixed(3)})" fill="${c}"><circle cx="0" cy="2" r="2"/><path d="M-2 4.5h4l1 6.5h-1.6l-.6-4v11h-1.5v-6.5h-.6v6.5h-1.5v-11l-.6 4h-1.6z"/><path d="M2.6 5.6l3.4-2.4.5.7-3.4 2.6z"/></g>`;
}
/** A tank side-on, tracks at (x, y), `h` px tall (hull + turret), facing right. */
function tank(x: number, y: number, h: number, c = '#e8ebee'): string {
  const s = h / 10;
  return `<g transform="translate(${x.toFixed(1)} ${(y - h).toFixed(1)}) scale(${s.toFixed(3)})" fill="${c}"><path d="M1 7.2h22l-2 2.8H3z"/><path d="M2.5 4.5h19l1.5 2.4H1z"/><path d="M8 1.6h7l1.6 2.9H7z"/><path d="M15.5 2.4h9v.9h-9z"/></g>`;
}
/** Mover glyphs (24 x 16 box) for the going chips. */
export function moverIcon(kind: 'tanks' | 'wheels' | 'foot', c: string, size = 22): string {
  const body =
    kind === 'tanks'
      ? '<path d="M2 11h19l-1.8 2.6H3.8z"/><path d="M3 8.4h17.4l1.3 2.2H1.7z"/><path d="M8 5.6h6.4l1.4 2.6H6.8z"/><path d="M14.8 6.3h8v.9h-8z"/>'
      : kind === 'wheels'
        ? '<path d="M2 4h11v7H2z"/><path d="M13 6.5h4.6l3 3V11H13z"/><circle cx="5.5" cy="12.5" r="2"/><circle cx="17" cy="12.5" r="2"/>'
        : '<circle cx="12" cy="2.6" r="2"/><path d="M10 5h4l1 6h-1.4l-.6-3.6v8.2h-1.4v-5h-.6v5H9.6V7.4L9 11H7.6z"/>';
  return `<svg width="${size}" height="${Math.round((size * 16) / 24)}" viewBox="0 0 24 16" aria-hidden="true" fill="${c}">${body}</svg>`;
}

// ── 1. the fisheye cross-section ───────────────────────────────────────────────────────────────────────────────────────

export function fisheyeSection(w: WaterReading, o: { width?: number; height?: number; figures?: boolean; labels?: boolean } = {}): string {
  const W = o.width ?? 330, H = o.height ?? 132;
  const s = w.section;
  const flip = w.homeSign === 1 ? -1 : 1; // home on the left
  const pts = s.d.map((d, i) => ({ x: d * flip, z: s.z[i] })).filter((p) => Number.isFinite(p.z)).sort((a, b) => a.x - b.x);
  if (pts.length < 3) return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Cross-section loading">${t(W / 2, H / 2, 'Heights loading…', { anchor: 'middle' })}</svg>`;
  const D = Math.max(...pts.map((p) => Math.abs(p.x)));
  const e = s.edges ? [Math.min(s.edges[0] * flip, s.edges[1] * flip), Math.max(s.edges[0] * flip, s.edges[1] * flip)] : [-10, 10];
  const Fo = Math.min(D * 0.9, Math.max(Math.abs(e[0]), Math.abs(e[1])) + 170); // the magnified middle
  const share = 0.64;
  const u = (x: number) => {
    const a = Math.abs(x);
    const v = a <= Fo ? (share * a) / Fo : share + ((1 - share) * (a - Fo)) / Math.max(1, D - Fo);
    return Math.sign(x) * v;
  };
  const L = 6, R = 6, T = o.labels === false ? 8 : 30, B = 20;
  const X = (x: number) => L + ((u(x) + 1) / 2) * (W - L - R);
  // Heights: the land, the crests, the water and the bed.
  const depth = worst(w.depth, w.purpose === 'cross' ? 'hi' : 'lo');
  const wz = s.waterZ;
  const bed = wz !== null && depth !== null ? wz - depth : null;
  let z0 = Math.min(...pts.map((p) => p.z), bed ?? Infinity, wz !== null ? wz - 1.5 : Infinity);
  let z1 = Math.max(...pts.map((p) => p.z));
  // At least ~7 m tall (no more than 12 px a metre), so the man and the tank stay to scale and fit.
  const minRange = Math.max(5, (H - T - B) / 12);
  if (z1 - z0 < minRange) {
    const m = (z0 + z1) / 2;
    z0 = m - minRange / 2;
    z1 = m + minRange / 2;
  }
  z1 += (z1 - z0) * 0.25; // room for the figures
  const Y = (z: number) => T + (1 - (z - z0) / (z1 - z0)) * (H - T - B);
  const pxPerM = (H - T - B) / (z1 - z0);
  const gid = id('wsg');
  const wid = id('wsw');
  // Ground: everything outside the water's edges; inside them the bed.
  const ground = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.z).toFixed(1)}`).join('');
  const out: string[] = [];
  out.push(`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${EARTH.top}"/><stop offset="1" stop-color="${EARTH.low}"/></linearGradient><linearGradient id="${wid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WATER.light}" stop-opacity=".9"/><stop offset=".45" stop-color="${WATER.mid}" stop-opacity=".85"/><stop offset="1" stop-color="${WATER.deep}" stop-opacity=".95"/></linearGradient></defs>`);
  // Home and far halves, faintly.
  out.push(`<rect x="${L}" y="${T - 4}" width="${(X(0) - L).toFixed(1)}" height="${H - T - B + 4}" fill="${HOME}" opacity=".07"/><rect x="${X(0).toFixed(1)}" y="${T - 4}" width="${(W - R - X(0)).toFixed(1)}" height="${H - T - B + 4}" fill="${FAR}" opacity=".07"/>`);
  out.push(`<path d="${ground}L${X(pts[pts.length - 1].x).toFixed(1)},${H - B}L${X(pts[0].x).toFixed(1)},${H - B}Z" fill="url(#${gid})"/>`);
  // Water: from the surface down to the bed (or a dashed, unknown bed a little below).
  if (wz !== null) {
    const xa = X(e[0]), xb = X(e[1]);
    const bz = bed ?? wz - 1.5;
    const by = Math.min(H - B - 1, Y(bz));
    const sy = Y(wz);
    const inset = Math.min(10, (xb - xa) * 0.18);
    out.push(`<path d="M${xa.toFixed(1)},${sy.toFixed(1)}L${xb.toFixed(1)},${sy.toFixed(1)}L${(xb - inset).toFixed(1)},${by.toFixed(1)}L${(xa + inset).toFixed(1)},${by.toFixed(1)}Z" fill="url(#${wid})"/>`);
    out.push(`<path d="M${xa.toFixed(1)},${sy.toFixed(1)}h${(xb - xa).toFixed(1)}" stroke="${WATER.line}" stroke-width="1.4"/>`);
    // Ripples on the surface.
    for (let x = xa + 6; x < xb - 6; x += 12) out.push(`<path d="M${x.toFixed(1)},${(sy + 4).toFixed(1)}q2.5,-2 5,0" stroke="#d6efff" stroke-width=".9" fill="none" opacity=".55"/>`);
    out.push(`<path d="M${(xa + inset).toFixed(1)},${by.toFixed(1)}h${(xb - xa - 2 * inset).toFixed(1)}" stroke="${bed === null ? '#d6efff' : '#0b2c4d'}" stroke-width="1.4" ${bed === null ? 'stroke-dasharray="3 3"' : ''}/>`);
    const xm = (xa + xb) / 2;
    if (o.labels !== false) {
      out.push(t(xm, Math.min(by - 3, sy + 15), figWord(w.width), { anchor: 'middle', size: 11.5, w: 750, fill: '#fff', halo: true }));
      if (bed !== null || w.depth.src !== 'none') out.push(t(xb + 3, (sy + by) / 2 + 4, `↕ ${figWord(w.depth)}`, { size: 10.5, w: 700, fill: WATER.line, halo: true }));
      else out.push(t(xb + 3, (sy + by) / 2 + 4, '↕ ?', { size: 10.5, w: 700, fill: WATER.line, halo: true }));
    }
  }
  out.push(`<path d="${ground}" fill="none" stroke="${EARTH.line}" stroke-width="1.6" stroke-linejoin="round"/>`);
  // Fisheye seams.
  for (const xs of [-Fo, Fo]) {
    if (Math.abs(xs) >= D) continue;
    const xx = X(xs);
    out.push(`<path d="M${xx.toFixed(1)},${T}v${(H - T - B).toFixed(1)}" stroke="${LINE.hair}" stroke-dasharray="2 4"/>`);
  }
  // Crest flags.
  const homeSide = w.homeSign === 1 ? 1 : 0;
  const flag = (side: 0 | 1, home: boolean) => {
    const c = s.crests[side];
    if (!c) return;
    const x = X(c[0] * flip), y = Y(c[1]);
    const col = home ? HOME : FAR;
    out.push(`<path d="M${x.toFixed(1)},${y.toFixed(1)}v-12" stroke="${col}" stroke-width="1.6"/><path d="M${x.toFixed(1)},${(y - 12).toFixed(1)}l${home ? 8 : -8},3l${home ? -8 : 8},3z" fill="${col}"/>`);
  };
  flag(homeSide as 0 | 1, true);
  flag((1 - homeSide) as 0 | 1, false);
  // Scale figures on the home crest (heights to the picture's scale; widths are not).
  if (o.figures !== false) {
    const c = s.crests[homeSide] ?? null;
    const fx = c ? X(c[0] * flip) : X(e[0]) - 14;
    const fy = c ? Y(c[1]) : Y(pts[0].z);
    const hs = 1.8 * pxPerM, ht = 2.4 * pxPerM;
    // Where the ground is at a screen x (the tank stands on the land behind the bank, not in the air).
    const scr = pts.map((p) => [X(p.x), Y(p.z)] as [number, number]);
    const groundAt = (x: number) => {
      for (let i = 0; i + 1 < scr.length; i++) if (scr[i][0] <= x && scr[i + 1][0] >= x) return scr[i][1] + ((scr[i + 1][1] - scr[i][1]) * (x - scr[i][0])) / Math.max(0.01, scr[i + 1][0] - scr[i][0]);
      return fy;
    };
    if (hs >= 7) {
      const tx = fx - 16 - ht * 2.4;
      if (tx > L) out.push(tank(tx, Math.max(groundAt(tx), groundAt(tx + ht * 2.4)) + 0.5, ht, '#c9d1d9'));
      out.push(soldier(fx - 5, fy, hs));
    }
  }
  // Labels: home / far with their bank heights.
  if (o.labels !== false) {
    const lab = (home: boolean) => {
      const b = home ? w.home : w.far;
      const f = b.aboveWater.src !== 'none' ? b.aboveWater : b.aboveLand;
      const x = home ? L + 2 : W - R - 2;
      return (
        t(x, 12, `${home ? 'HOME' : 'FAR'} ${b.dir}`, { size: 11.5, w: 750, fill: home ? STEP_TEXT.go : STEP_TEXT.nogo, anchor: home ? 'start' : 'end' }) +
        t(x, 25, `bank ${figWord(f)} · ${SRC_LETTER[f.src]}`, { size: 10.5, w: 600, fill: TEXT.label, anchor: home ? 'start' : 'end' })
      );
    };
    out.push(lab(true), lab(false));
    out.push(t(W / 2, H - 5, `fisheye: water and banks magnified · ${Math.round(D * 2)} m across · man and tank to height scale`, { size: 9.5, w: 400, fill: '#8a96a3', anchor: 'middle' }));
  }
  return `<svg class="mgv" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Cross-section: home bank left, far bank right">${out.join('')}</svg>`;
}

// ── 2. the plan radar ──────────────────────────────────────────────────────────────────────────────────────────────────

const XING_COLOR = (q: WaterReading['crossings'][number]) => (q.inUseNow === false ? '#6b7480' : q.tankable ? STEP_COLOR.go : q.tankable === false ? STEP_COLOR.slow : '#c3cbd3');
function xingGlyph(kind: string, x: number, y: number, c: string, s = 1): string {
  const T = `transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})"`;
  if (/bridge|viaduct/.test(kind)) return `<g ${T}><rect x="-6" y="-6" width="12" height="12" rx="2.5" fill="${SURFACE.ring}" stroke="${c}" stroke-width="1.6"/><path d="M-4 -2h8M-4 2h8" stroke="${c}" stroke-width="1.6"/></g>`;
  if (kind === 'ford') return `<g ${T}><circle r="6.2" fill="${SURFACE.ring}" stroke="${c}" stroke-width="1.6"/><path d="M-4 0q2-2.4 4 0t4 0" stroke="${c}" stroke-width="1.5" fill="none"/></g>`;
  if (kind === 'ferry' || kind === 'boat_bridge') return `<g ${T}><circle r="6.2" fill="${SURFACE.ring}" stroke="${c}" stroke-width="1.6"/><path d="M-4 -.5h8l-1.6 3h-4.8z" fill="${c}"/></g>`;
  return `<g ${T}><circle r="4.4" fill="${SURFACE.ring}" stroke="${c}" stroke-width="1.4"/></g>`;
}

export function planRadar(w: WaterReading, o: { size?: number; pointer?: [number, number] | null; km?: number } = {}): string {
  const S = o.size ?? 150;
  const C = 100, RR = 86, R1 = 52; // the ring, and the 1 km ring
  const km = Math.max(1.5, o.km ?? 5);
  const rOf = (m: number) => (m <= 1000 ? (m / 1000) * R1 : R1 + ((RR - 4 - R1) * Math.log(m / 1000)) / Math.log(km));
  const P = (m: number, brg: number): [number, number] => {
    const r = Math.min(RR - 3, rOf(m));
    const a = (brg * Math.PI) / 180;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };
  const cid = id('wpc');
  const out: string[] = [];
  out.push(`<defs><clipPath id="${cid}"><circle cx="${C}" cy="${C}" r="${RR}"/></clipPath></defs>`);
  out.push(`<circle cx="${C}" cy="${C}" r="${RR + 4}" fill="${SURFACE.ring}" stroke="${LINE.ring}" stroke-width="1.3"/>`);
  const g: string[] = [];
  // Home and far halves (home lies at bearing axis + 90 * homeSign).
  const nb = w.axisDeg + 90 * w.homeSign;
  const half = (brg: number, c: string, op: number) => {
    const a0 = ((brg - 90) * Math.PI) / 180, a1 = ((brg + 90) * Math.PI) / 180;
    return `<path d="M${(C + RR * Math.sin(a0)).toFixed(1)},${(C - RR * Math.cos(a0)).toFixed(1)}A${RR},${RR} 0 0 1 ${(C + RR * Math.sin(a1)).toFixed(1)},${(C - RR * Math.cos(a1)).toFixed(1)}Z" fill="${c}" opacity="${op}"/>`;
  };
  g.push(half(nb, HOME, 0.16), half(nb + 180, FAR, 0.13));
  // Rings: 250 m, 1 km (to scale), the log band.
  g.push(`<circle cx="${C}" cy="${C}" r="${(R1 / 4).toFixed(1)}" fill="none" stroke="${LINE.hair}" stroke-dasharray="2 3"/><circle cx="${C}" cy="${C}" r="${R1}" fill="none" stroke="${LINE.ring}" stroke-dasharray="3 3"/>`);
  // The obstacle band at its bearing (drawn a little wider than scale so it shows).
  const wm = worst(w.width, 'lo') ?? 20;
  const bw = Math.max(6, Math.min(26, (wm / 1000) * R1 * 2));
  g.push(`<g clip-path="url(#${cid})" transform="rotate(${w.axisDeg.toFixed(1)} ${C} ${C})"><rect x="${(C - bw / 2).toFixed(1)}" y="${C - RR}" width="${bw.toFixed(1)}" height="${RR * 2}" fill="${WATER.mid}" opacity=".85"/><path d="M${(C - bw / 2).toFixed(1)},${C - RR}v${RR * 2}M${(C + bw / 2).toFixed(1)},${C - RR}v${RR * 2}" stroke="${WATER.line}" stroke-width="1"/>`);
  for (let y = C - RR + 6; y < C + RR; y += 14) g.push(`<path d="M${(C - bw / 2 + 2).toFixed(1)},${y}l${(bw - 4).toFixed(1)},4" stroke="#d6efff" stroke-width=".8" opacity=".5"/>`);
  g.push('</g>');
  // H and F on their sides, upright.
  const [hx, hy] = P(650, nb), [fx, fy] = P(650, nb + 180);
  g.push(`<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="8" fill="${HOME}"/>${t(hx, hy + 4, 'H', { size: 11, w: 800, fill: '#fff', anchor: 'middle', up: true })}`);
  g.push(`<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="8" fill="${FAR}"/>${t(fx, fy + 4, 'F', { size: 11, w: 800, fill: '#fff', anchor: 'middle', up: true })}`);
  // Crossings where they are.
  for (const q of w.crossings.slice(0, 10)) {
    const brg = Math.atan2(q.x - w.at[0], q.y - w.at[1]) * (180 / Math.PI);
    const [x, y] = P(Math.max(30, q.distM), brg);
    g.push(xingGlyph(q.kind, x, y, XING_COLOR(q), 0.9));
  }
  // The pointer, if it is off the section's centre.
  if (o.pointer) {
    const dx = o.pointer[0] - w.at[0], dy = o.pointer[1] - w.at[1];
    const m = Math.hypot(dx, dy) * Math.cos(Math.atan(Math.sinh(w.at[1] / 6378137)));
    if (m > 8) {
      const [px, py] = P(m, (Math.atan2(dx, dy) * 180) / Math.PI);
      g.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="#fff" stroke="${SURFACE.ring}" stroke-width="2"/>`);
    }
  }
  g.push(`<circle cx="${C}" cy="${C}" r="3.2" fill="#fff"/>`);
  g.push(t(C, C - RR - 7 + 3, 'N', { size: 11, w: 750, fill: '#c9d1d9', anchor: 'middle', up: true }));
  out.push(`<g data-gv-rose="${C} ${C}">${g.join('')}</g>`);
  out.push(t(C, 196, `1 km ring · ${km} km rim`, { size: 10, w: 400, fill: '#8a96a3', anchor: 'middle' }));
  return `<svg class="mgv-r" viewBox="0 0 200 200" width="${S}" height="${S}" role="img" aria-label="The obstacle from above with its crossings">${out.join('')}</svg>`;
}

// ── 3. the gauges ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function gaugesPic(w: WaterReading, R: WaterRules, o: { width?: number; height?: number } = {}): string {
  const W = o.width ?? 330, H = o.height ?? 138;
  const T = 26, B = 22;
  const cw = W / 3;
  const out: string[] = [];
  const end: 'hi' | 'lo' = w.purpose === 'cross' ? 'hi' : 'lo';
  const tube = (i: number, title: string, sub: string) => {
    const x0 = i * cw;
    out.push(t(x0 + cw / 2, 12, title, { size: 11.5, w: 750, fill: TEXT.main, anchor: 'middle' }));
    out.push(t(x0 + cw / 2, H - 6, sub, { size: 10, w: 600, fill: TEXT.label, anchor: 'middle' }));
    return { x: x0 + cw / 2 - 11, w: 22 };
  };
  // Depth: 0 at the top (the surface), down.
  {
    const tb = tube(0, 'Depth', figWord(w.depth));
    const maxD = Math.max(2.5, (w.depth.hi ?? w.depth.v ?? 0) * 1.15);
    const Yd = (d: number) => T + (Math.min(d, maxD) / maxD) * (H - T - B);
    out.push(`<rect x="${tb.x}" y="${T}" width="${tb.w}" height="${H - T - B}" rx="4" fill="${SURFACE.ring}" stroke="${LINE.ring}"/>`);
    if (w.depth.src !== 'none') {
      const lo = w.depth.lo ?? w.depth.v!, hi = w.depth.hi ?? w.depth.v!;
      out.push(`<rect x="${tb.x + 2}" y="${T + 2}" width="${tb.w - 4}" height="${(Yd(lo) - T - 2).toFixed(1)}" rx="2.5" fill="${WATER.mid}"/>`);
      if (hi > lo) out.push(`<rect x="${tb.x + 2}" y="${Yd(lo).toFixed(1)}" width="${tb.w - 4}" height="${(Yd(hi) - Yd(lo)).toFixed(1)}" fill="${WATER.mid}" opacity=".45"/>`);
    } else out.push(t(tb.x + tb.w / 2, (T + H - B) / 2 + 5, '?', { size: 16, w: 800, fill: WATER.line, anchor: 'middle' }));
    const marks: Array<[number, string, string]> = [[R.ford.wheeledDepthM, 'wheels', '#c3cbd3'], [R.ford.footDepthM, 'foot', '#c3cbd3'], [R.ford.tankDepthM, 'tank', '#ffd27a']];
    let ly = -99;
    marks.forEach(([d, l, c], k) => {
      const y = Yd(d);
      out.push(`<path d="M${tb.x - 3},${y.toFixed(1)}h${tb.w + 6}" stroke="${c}" stroke-width="1.3" stroke-dasharray="${k === 2 ? '0' : '3 2'}"/>`);
      // Labels kept 10 px apart (the marks may sit close together near the surface), with a leader when moved.
      const lyy = Math.max(y + 3.5, ly + 10);
      if (lyy - (y + 3.5) > 1) out.push(`<path d="M${tb.x + tb.w + 3},${y.toFixed(1)}L${tb.x + tb.w + 6},${(lyy - 3.5).toFixed(1)}" stroke="${c}" stroke-width=".8"/>`);
      out.push(t(tb.x + tb.w + 7, lyy, `${l} ${n1(d)}`, { size: 9.5, w: 600, fill: c }));
      ly = lyy;
    });
  }
  // The step out (exit bank).
  {
    const exit = w.purpose === 'cross' ? w.far : w.home;
    const f = exit.aboveWater.src !== 'none' ? exit.aboveWater : exit.aboveLand;
    const tb = tube(1, 'Step out', `${w.purpose === 'cross' ? 'far' : 'home'} bank ${figWord(f)}`);
    const v = worst(f, end);
    const maxH = Math.max(3, (f.hi ?? f.v ?? 0) * 1.15, 2);
    const Yh = (h: number) => H - B - (Math.min(h, maxH) / maxH) * (H - T - B);
    out.push(`<rect x="${tb.x}" y="${T}" width="${tb.w}" height="${H - T - B}" rx="4" fill="${SURFACE.ring}" stroke="${LINE.ring}"/>`);
    if (v !== null) {
      const c = v > R.tank.stepM ? STEP_COLOR.nogo : STEP_COLOR.go;
      out.push(`<rect x="${tb.x + 2}" y="${Yh(v).toFixed(1)}" width="${tb.w - 4}" height="${(H - B - 2 - Yh(v)).toFixed(1)}" rx="2.5" fill="${EARTH.line}"/>`);
      if (f.lo !== null && f.hi !== null && f.hi > f.lo) out.push(`<rect x="${tb.x + 2}" y="${Yh(f.hi).toFixed(1)}" width="${tb.w - 4}" height="${(Yh(f.lo) - Yh(f.hi)).toFixed(1)}" fill="${EARTH.line}" opacity=".35"/>`);
      out.push(`<rect x="${tb.x - 1}" y="${(Yh(v) - 1.5).toFixed(1)}" width="${tb.w + 2}" height="3" fill="${c}"/>`);
    } else out.push(t(tb.x + tb.w / 2, (T + H - B) / 2 + 5, '?', { size: 16, w: 800, fill: EARTH.line, anchor: 'middle' }));
    const y9 = Yh(R.tank.stepM);
    out.push(`<path d="M${tb.x - 3},${y9.toFixed(1)}h${tb.w + 6}" stroke="#ffd27a" stroke-width="1.4"/>`);
    out.push(t(tb.x + tb.w + 6, y9 + 3.5, `tank climbs ${R.tank.stepM}`, { size: 9.5, w: 600, fill: '#ffd27a' }));
    const ym = Yh(1.8);
    if (ym > T + 4) out.push(soldier(tb.x - 9, H - B - 1, H - B - 1 - ym, '#8a96a3'));
  }
  // Width, log scale 1 m - 1 km.
  {
    const tb = tube(2, 'Width', figWord(w.width));
    const Yw = (m: number) => H - B - (Math.log10(Math.max(1, Math.min(1000, m))) / 3) * (H - T - B);
    out.push(`<rect x="${tb.x}" y="${T}" width="${tb.w}" height="${H - T - B}" rx="4" fill="${SURFACE.ring}" stroke="${LINE.ring}"/>`);
    const v = worst(w.width, end);
    if (v !== null) {
      out.push(`<rect x="${tb.x + 2}" y="${Yw(v).toFixed(1)}" width="${tb.w - 4}" height="${(H - B - 2 - Yw(v)).toFixed(1)}" rx="2.5" fill="${WATER.mid}"/>`);
      if (w.width.lo !== null && w.width.hi !== null && w.width.hi > w.width.lo) out.push(`<rect x="${tb.x + 2}" y="${Yw(w.width.hi).toFixed(1)}" width="${tb.w - 4}" height="${(Yw(Math.max(1, w.width.lo)) - Yw(w.width.hi)).toFixed(1)}" fill="${WATER.mid}" opacity=".4"/>`);
    }
    const spans = ((R.bridging?.spans ?? []) as Array<{ label: string; m: number }>).slice(0, 2);
    const marks: Array<[number, string, string]> = [[R.tank.gapM, 'tank gap', '#ffd27a'], [R.tank.fullDitchM, 'full ditch', STEP_TEXT.nogo], ...spans.map((s): [number, string, string] => [s.m, s.label.replace(/ \(.*\)/, ''), '#8ec1ea'])];
    let lastY = -99;
    for (const [m, l, c] of marks) {
      const y = Yw(m);
      out.push(`<path d="M${tb.x - 3},${y.toFixed(1)}h${tb.w + 6}" stroke="${c}" stroke-width="1.2"/>`);
      if (Math.abs(y - lastY) >= 9) out.push(t(tb.x + tb.w + 6, y + 3.5, `${l} ${n1(m)}`, { size: 9.5, w: 600, fill: c }));
      lastY = y;
    }
  }
  return `<svg class="mgv" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Depth, step out and width against what each mover can do">${out.join('')}</svg>`;
}

// ── 4. the month wheel ─────────────────────────────────────────────────────────────────────────────────────────────────

const MON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_IX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function monthsOf(s: string | null): number[] {
  if (!s) return [];
  const m = s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b\W*(?:-|to|–)\W*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (!m) return [];
  const a = MONTH_IX[m[1]], b = MONTH_IX[m[2]];
  const out: number[] = [];
  for (let k = a; ; k = (k % 12) + 1) {
    out.push(k);
    if (k === b || out.length > 12) break;
  }
  return out;
}

export function monthWheel(w: WaterReading, R: WaterRules, size = 132): string {
  const C = 60, r0 = 34, r1 = 50;
  const monsoon = new Set<number>(R.monsoonMonths ?? []);
  const P = (r: number, a: number) => `${(C + r * Math.sin(a)).toFixed(2)},${(C - r * Math.cos(a)).toFixed(2)}`;
  const seg = (k: number, ra: number, rb: number) => {
    const a0 = ((k - 1) / 12) * 2 * Math.PI + 0.02, a1 = (k / 12) * 2 * Math.PI - 0.02;
    return `M${P(rb, a0)}A${rb},${rb} 0 0 1 ${P(rb, a1)}L${P(ra, a1)}A${ra},${ra} 0 0 0 ${P(ra, a0)}Z`;
  };
  const out: string[] = [];
  for (let k = 1; k <= 12; k++) {
    const on = k === w.season.month;
    out.push(`<path d="${seg(k, r0, r1)}" fill="${monsoon.has(k) ? WATER.mid : '#3a4350'}" opacity="${on ? 1 : 0.75}" stroke="${on ? '#fff' : 'none'}" stroke-width="1.6"/>`);
    const a = ((k - 0.5) / 12) * 2 * Math.PI;
    const [x, y] = P((r0 + r1) / 2, a).split(',').map(Number);
    out.push(t(x, y + 3.5, MON[k - 1], { size: 9.5, w: on ? 800 : 600, fill: on ? '#fff' : TEXT.label, anchor: 'middle' }));
  }
  // Fords / ferries in use: thin arcs inside the ring.
  const used = w.crossings.filter((q) => (q.kind === 'ford' || q.kind === 'ferry' || q.kind === 'boat_bridge') && q.months).slice(0, 3);
  used.forEach((q, i) => {
    const r = r0 - 4 - i * 4.5;
    for (const k of monthsOf(q.months)) out.push(`<path d="${seg(k, r - 1.6, r + 1.6)}" fill="${q.kind === 'ford' ? '#d9b46a' : '#5fd4c0'}"/>`);
  });
  out.push(t(C, C - 2, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][w.season.month - 1], { size: 12, w: 800, fill: '#fff', anchor: 'middle' }));
  out.push(t(C, C + 11, w.season.wet ? 'monsoon' : 'dry', { size: 10, w: 600, fill: w.season.wet ? WATER.line : '#d9b46a', anchor: 'middle' }));
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="The months: monsoon shaded, this month outlined, fords and ferries in use">${out.join('')}</svg>`;
}

// ── 5. along the obstacle ──────────────────────────────────────────────────────────────────────────────────────────────

export function alongStrip(w: WaterReading, km: number, o: { width?: number } = {}): string {
  const W = o.width ?? 330, H = 58;
  const L = 14, R = 14, Y0 = 32;
  const span = Math.max(1, km) * 1000;
  const X = (m: number) => L + ((Math.max(-span, Math.min(span, m)) + span) / (2 * span)) * (W - L - R);
  const out: string[] = [];
  out.push(`<rect x="${L}" y="${Y0 - 5}" width="${W - L - R}" height="10" rx="5" fill="${WATER.mid}" opacity=".85"/>`);
  for (let k = -Math.floor(km); k <= Math.floor(km); k++) out.push(`<path d="M${X(k * 1000).toFixed(1)},${Y0 + 6}v4" stroke="${LINE.ring}"/>`);
  const fwd = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((w.axisDeg % 360) + 360) % 360) / 45) % 8];
  const back = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((((w.axisDeg + 180) % 360) + 360) % 360) / 45) % 8];
  out.push(t(L, H - 4, `◀ ${back}`, { size: 10, w: 600 }), t(W - R, H - 4, `${fwd} ▶`, { size: 10, w: 600, anchor: 'end' }), t(X(0), H - 4, `${km} km each way`, { size: 9.5, w: 400, fill: '#8a96a3', anchor: 'middle' }));
  out.push(`<path d="M${X(0).toFixed(1)},${Y0 - 12}v24" stroke="#fff" stroke-width="2"/>`);
  const placed: number[] = [];
  for (const q of w.crossings.slice(0, 12)) {
    const x = X(q.alongM);
    out.push(xingGlyph(q.kind, x, Y0, XING_COLOR(q), 1));
    if (placed.every((p) => Math.abs(p - x) > 34)) {
      out.push(t(x, Y0 - 11, `${n1(q.distM / 1000)} km`, { size: 9.5, w: 700, fill: XING_COLOR(q), anchor: 'middle' }));
      placed.push(x);
    }
  }
  if (!w.crossings.length) out.push(t(W / 2, Y0 - 11, 'no crossing recorded', { size: 10, w: 600, fill: STEP_TEXT.nogo, anchor: 'middle' }));
  return `<svg class="mgv" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Crossings along the obstacle">${out.join('')}</svg>`;
}

// ── 6. the sources donut ───────────────────────────────────────────────────────────────────────────────────────────────

export function sourceCounts(w: WaterReading): Array<{ key: string; label: string; n: number; c: string }> {
  const figs = [w.width, w.depth, w.current, w.home.aboveWater, w.home.aboveLand, w.far.aboveWater, w.far.aboveLand];
  const groups = [
    { key: 'meas', label: 'Sheet', srcs: ['sheet', 'reach'], c: '#74dca3' },
    { key: 'map', label: 'Map / symbol', srcs: ['map', 'symbol'], c: '#8ec1ea' },
    { key: 'est', label: 'Est. 30 m', srcs: ['est'], c: '#f1d646' },
    { key: 'ibb', label: 'IBB typical', srcs: ['pamphlet'], c: '#c3a6ff' },
    { key: 'unk', label: 'Unknown', srcs: ['none'], c: '#6b7480' },
  ];
  return groups.map((g) => ({ key: g.key, label: g.label, c: g.c, n: figs.filter((f) => g.srcs.includes(f.src)).length }));
}
export function sourceDonut(w: WaterReading, size = 96): string {
  const parts = sourceCounts(w);
  const total = parts.reduce((a, p) => a + p.n, 0) || 1;
  const C = 50, r = 38, sw = 14;
  const circ = 2 * Math.PI * r;
  let off = 0;
  const arcs = parts
    .filter((p) => p.n)
    .map((p) => {
      const len = (p.n / total) * circ;
      const s = `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${p.c}" stroke-width="${sw}" stroke-dasharray="${(len - 1.5).toFixed(2)} ${(circ - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${C} ${C})"/>`;
      off += len;
      return s;
    })
    .join('');
  const meas = parts[0].n;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Where the figures come from">${arcs}${t(C, C + 2, `${meas}/${total}`, { size: 17, w: 800, fill: '#fff', anchor: 'middle' })}${t(C, C + 15, 'from the sheet', { size: 9, w: 600, fill: TEXT.label, anchor: 'middle' })}</svg>`;
}

// ── 7. the bank towers ─────────────────────────────────────────────────────────────────────────────────────────────────

export function bankTowers(w: WaterReading, R: WaterRules, o: { width?: number; height?: number } = {}): string {
  const W = o.width ?? 330, H = o.height ?? 140;
  const T = 30, B = 24, L = 30;
  const figs = [w.home.aboveWater, w.home.aboveLand, w.far.aboveWater, w.far.aboveLand];
  const maxH = Math.max(3, ...figs.map((f) => f.hi ?? f.v ?? 0)) * 1.1;
  const Yh = (h: number) => H - B - (Math.min(h, maxH) / maxH) * (H - T - B);
  const out: string[] = [];
  // Grid every metre.
  for (let m = 0; m <= maxH; m += maxH > 8 ? 2 : 1) {
    out.push(`<path d="M${L},${Yh(m).toFixed(1)}H${W - 6}" stroke="${LINE.soft}"/>`);
    out.push(t(L - 4, Yh(m) + 3.5, `${m}`, { size: 9.5, w: 400, fill: '#8a96a3', anchor: 'end' }));
  }
  const groupW = (W - L - 16) / 2;
  const bar = (x: number, f: Fig, c: string, label: string) => {
    const bw = groupW * 0.3;
    if (f.src === 'none' || f.v === null) {
      out.push(`<rect x="${x.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - T - B}" rx="3" fill="none" stroke="${LINE.ring}" stroke-dasharray="3 3"/>${t(x + bw / 2, (T + H - B) / 2, '?', { size: 15, w: 800, fill: '#8a96a3', anchor: 'middle' })}`);
    } else {
      const lo = Math.max(0, f.lo ?? f.v), hi = f.hi ?? f.v;
      out.push(`<rect x="${x.toFixed(1)}" y="${Yh(lo).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - Yh(lo)).toFixed(1)}" rx="2" fill="${c}"/>`);
      if (hi > lo) out.push(`<rect x="${x.toFixed(1)}" y="${Yh(hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Yh(lo) - Yh(hi)).toFixed(1)}" fill="${c}" opacity=".35"/>`);
      out.push(`<circle cx="${(x + bw - 4).toFixed(1)}" cy="${(Yh(hi) - 7).toFixed(1)}" r="5.5" fill="${SRC_COLOR[f.src]}"/>${t(x + bw - 4, Yh(hi) - 4, SRC_LETTER[f.src], { size: 8, w: 800, fill: '#14181d', anchor: 'middle' })}`);
    }
    out.push(t(x + bw / 2, H - 8, label, { size: 9.5, w: 600, anchor: 'middle' }));
  };
  const g = (k: number, b: WaterReading['home'], home: boolean) => {
    const x0 = L + 10 + k * groupW;
    bar(x0, b.aboveWater, home ? '#3f9d63' : '#c2474c', 'water');
    bar(x0 + groupW * 0.36, b.aboveLand, EARTH.line, 'land');
    out.push(t(x0 + groupW * 0.33, 13, `${home ? 'HOME' : 'FAR'} ${b.dir}`, { size: 11.5, w: 750, fill: home ? STEP_TEXT.go : STEP_TEXT.nogo, anchor: 'middle' }));
    if (b.marshM) out.push(t(x0 + groupW * 0.33, 25, `marsh ${b.marshM} m`, { size: 9.5, w: 600, fill: '#8ec1ea', anchor: 'middle' }));
    else if (b.bund) out.push(t(x0 + groupW * 0.33, 25, b.bund.toLowerCase(), { size: 9.5, w: 600, fill: TEXT.label, anchor: 'middle' }));
  };
  g(0, w.home, true);
  g(1, w.far, false);
  const y9 = Yh(R.tank.stepM);
  out.push(`<path d="M${L},${y9.toFixed(1)}H${W - 6}" stroke="#ffd27a" stroke-width="1.4" stroke-dasharray="5 3"/>${t(W - 6, y9 - 3, `tank climbs ${R.tank.stepM} m`, { size: 9.5, w: 700, fill: '#ffd27a', anchor: 'end' })}`);
  const ym = Yh(1.8);
  out.push(soldier(L + 4, H - B, H - B - ym, '#8a96a3'));
  return `<svg class="mgv" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Home and far bank heights">${out.join('')}</svg>`;
}

// ── 8. the ten Annex P types ───────────────────────────────────────────────────────────────────────────────────────────

/** The pamphlet's sketches as silhouettes in a 60 x 30 box: the ground line (home bank on the left), the water. */
const SIL: Record<WaterTypeId, { g: string; w: Array<[number, number, number, number]>; dry?: boolean }> = {
  dammedRiver: { g: 'M0 13L9 13L13 19L47 19L51 13L60 13', w: [[27, 17, 7, 2]] },
  undammedRiver: { g: 'M0 11L3 9L6 11L9 11L13 21L47 21L51 11L54 11L57 9L60 11', w: [[11, 14, 38, 7]] },
  irrigationCanal: { g: 'M0 19L11 19L15 8L22 8L24 14L36 14L38 8L45 8L49 19L60 19', w: [[23, 10, 14, 4]] },
  distributary: { g: 'M0 17L18 17L21 12L25 12L27 17L33 17L35 12L39 12L42 17L60 17', w: [[27, 14, 6, 3]] },
  linkCanal: { g: 'M0 16L7 16L11 5L16 5L18 16L22 16L24 26L36 26L38 16L42 16L44 5L49 5L53 16L60 16', w: [[23, 21, 14, 5]] },
  feederCanal: { g: 'M0 16L11 16L14 9L19 9L22 23L38 23L41 9L46 9L49 16L60 16', w: [[21, 15, 18, 8]] },
  twinCanal: { g: 'M0 16L5 16L7 9L11 9L13 21L23 21L25 9L35 9L37 21L47 21L49 9L53 9L55 16L60 16', w: [[13, 15, 10, 6], [37, 15, 10, 6]] },
  drain: { g: 'M0 14L13 14L15 11L19 11L22 25L38 25L41 11L45 11L47 14L60 14', w: [[23, 23, 14, 2]], dry: true },
  atDitch: { g: 'M0 16L7 16L11 6L18 6L22 16L24 16L27 25L39 25L42 16L60 16', w: [[27, 23, 12, 2]] },
  defenceDrain: { g: 'M0 16L5 16L8 4L19 4L22 16L23 16L26 26L46 26L49 16L60 16', w: [[26, 21, 20, 5]] },
  doubleDitch: { g: 'M0 16L3 16L5 5L12 5L14 16L15 25L27 25L29 14L33 14L35 25L50 25L52 16L60 16', w: [[15, 22, 12, 3], [35, 22, 15, 3]] },
  stream: { g: 'M0 14L20 14L24 21L36 21L40 14L60 14', w: [[24, 17, 12, 4]] },
  nala: { g: 'M0 12L15 12L18 22L42 22L45 12L60 12', w: [], dry: true },
  lake: { g: 'M0 12L6 12L10 21L50 21L54 12L60 12', w: [[9, 13, 42, 8]] },
};
export function silhouette(type: WaterTypeId, wpx = 60, hpx = 30, on = true): string {
  const s = SIL[type];
  const gid = id('wsl');
  const water = s.w.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${on ? WATER.mid : '#4b5866'}"/>`).join('');
  return `<svg viewBox="0 0 60 30" width="${wpx}" height="${hpx}" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${on ? EARTH.top : '#3a3f46'}"/><stop offset="1" stop-color="${on ? EARTH.low : '#262a30'}"/></linearGradient></defs><path d="${s.g}L60 30L0 30Z" fill="url(#${gid})"/>${water}<path d="${s.g}" fill="none" stroke="${on ? EARTH.line : '#6b7480'}" stroke-width="1.2" stroke-linejoin="round"/>${s.dry ? `<path d="M24 24h12" stroke="${on ? '#d9b46a' : '#6b7480'}" stroke-width="1" stroke-dasharray="1 2"/>` : ''}</svg>`;
}

export function annexTiles(R: WaterRules, lit: WaterTypeId): string {
  const order: WaterTypeId[] = ['dammedRiver', 'undammedRiver', 'irrigationCanal', 'linkCanal', 'feederCanal', 'twinCanal', 'drain', 'atDitch', 'defenceDrain', 'doubleDitch'];
  const litAnnex = typeDef(R, lit).annex;
  return `<div class="mgw-tiles">${order
    .map((ty) => {
      const d = typeDef(R, ty);
      const on = ty === lit || (lit === 'distributary' && ty === 'irrigationCanal');
      return `<div class="mgw-tile${on ? ' on' : ''}" title="${esc(`IBB Annex P ${d.annex}: ${d.label}`)}"><span class="mgw-tn">${d.annex}</span>${silhouette(ty, 54, 27, on)}<span class="mgw-tl">${esc(String(d.label).replace(/ canal$/i, '').replace('Anti-tank', 'AT'))}</span></div>`;
    })
    .join('')}</div>${litAnnex ? '' : `<div class="mgd-in" style="margin-top:4px">${esc(typeDef(R, lit).label)}: not one of the ten Annex P types.</div>`}`;
}

/** The CSS the tiles and chips need (added once by the cards). */
export const WATER_PICS_CSS = `
.mgw-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
.mgw-tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;padding:4px 2px 3px;border-radius:7px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);color:#8a96a3}
.mgw-tile.on{background:rgba(58,149,216,.16);border-color:${WATER.mid};color:#fff;box-shadow:0 0 0 1px ${WATER.mid} inset}
.mgw-tn{position:absolute;left:4px;top:2px;font:800 10.5px/1 ${F}}
.mgw-tile.on .mgw-tn{color:${WATER.line}}
.mgw-tl{font:600 10px/1.15 ${F};text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mgw-movers{display:flex;gap:6px;flex-wrap:wrap}
.mgw-mv{display:flex;align-items:center;gap:6px;padding:4px 9px 4px 6px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);min-width:0}
.mgw-mv b{font:800 13px/1.1 ${F}}
.mgw-mv span{display:block;font:400 11px/1.25 ${F};color:#c3cbd3;max-width:210px}
.mgw-src{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;font:800 9px/1 ${F};color:#14181d;margin-left:5px;vertical-align:1px}
.mgw-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.mgw-key{display:flex;flex-wrap:wrap;gap:3px 10px;font:400 11.5px/1.3 ${F};color:#c3cbd3;margin-top:4px}
.mgw-key i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
`;

/** Mover chips: glyph, verdict word in its colour, the reason under it. */
export function moverChips(w: WaterReading, compact = false): string {
  const row = (k: 'tanks' | 'wheels' | 'foot', name: string) => {
    const v = w.verdict[k];
    return `<div class="mgw-mv" style="border-color:${GO_C[v.v]}66">${moverIcon(k, GO_C[v.v])}<div><b style="color:${GO_T[v.v]}">${esc(name)} ${GO_W[v.v]}</b>${compact ? '' : `<span>${esc(v.why)}</span>`}</div></div>`;
  };
  return `<div class="mgw-movers">${row('tanks', 'Tanks')}${row('wheels', 'Wheels')}${row('foot', 'Foot')}</div>`;
}
