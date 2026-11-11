/**
 * MovementGuideViz.ts
 *
 * The Mov Detail's pictures, as SVG strings sized for one column of the card (about 290 px wide). Pure: they take the
 * cards' results and draw them; labels are escaped. Colours follow the danger bands (red 70+, orange 50+, yellow 30+).
 *
 *   routeProfile   the route as a strip: the ground's height along it, the danger bands, and what the card adds
 *                  (pickets' reach and gaps, bounds, mine diamonds, ambush and block sites)
 *   cordonRing     the cordon as a ring of platoon sectors coloured by company, rooftop sectors dotted, road blocks
 *                  on the outer ring where the exits lie, the men in the middle
 *   manpowerBar    the cordon's men split: on the line, rooftops, side roads, road blocks
 *   convoyChart    time against distance: each packet a band through the bounds, halts flat, dangers shaded
 *   patrolProfile  the route out's height with leg ends numbered, skylines and exposed stretches tinted
 *   legRose        the legs' bearings as a rose (long legs long)
 *   ambushSketch   the layout from above: road straightened, killing zone, fire group, stops, arm, meeting point
 *   blockSketch    the block with the approach and each flanking position's share of it
 *   infilBand      the band either side of the line, the lanes across it, the posts
 *   gauge          a ring gauge for a percentage
 */

import Utils from '../../Support/utils';
import type { RouteReading, Stretch, MercXY } from './MovementGuideScan';
import { bearingOf, groundDist } from './MovementGuideScan';
import type { CordonLayout, ConvoyPlan, AmbushSite, BlockSite, InfilReading } from './MovementGuidePlans';
import type { CordonReading } from './MovementGuideScan';
import type { PatrolCard } from '../PlatoonGuide/PlatoonGuideRead';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));
export const VZ = {
  red: '#e5484d',
  orange: '#f28c28',
  yellow: '#f5c518',
  green: '#3fb27f',
  blue: '#4d8fd6',
  cyan: '#22d3ee',
  violet: '#a78bfa',
  grey: '#8a96a3',
  ink: '#c3cbd3',
  faint: 'rgba(255,255,255,.1)',
  bg: '#20262e',
};
export const band = (v: number): string => (v >= 70 ? VZ.red : v >= 50 ? VZ.orange : v >= 30 ? VZ.yellow : VZ.grey);
const COY = ['#4d8fd6', '#3fb27f', '#a78bfa', '#22d3ee', '#f5c518', '#f28c28', '#e879a6', '#9bd56b'];
const W = 290;
const svg = (h: number, body: string, label: string): string =>
  `<svg class="mgv" viewBox="0 0 ${W} ${h}" width="100%" height="${h}" role="img" aria-label="${esc(label)}" style="display:block;max-width:${W}px;overflow:visible">${body}</svg>`;
const t = (x: number, y: number, s: string, o: { a?: 'start' | 'middle' | 'end'; c?: string; sz?: number; w?: number } = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${o.c ?? VZ.ink}" font-size="${o.sz ?? 10}" font-weight="${o.w ?? 400}" text-anchor="${o.a ?? 'start'}" font-family="system-ui,Segoe UI,Arial,sans-serif">${esc(s)}</text>`;

// ── route profile ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ProfileOverlay {
  /** Picket reach bars (above the profile), one row per side. */
  pickets?: Array<{ from: number; to: number; side: 'L' | 'R'; n: number }>;
  gaps?: Array<{ fromM: number; toM: number }>;
  bounds?: Array<{ toM: number; n: number }>;
  marks?: Array<{ m: number; label: string; c: string; shape?: 'diamond' | 'pin' | 'square' }>;
  highlight?: { fromM: number; toM: number } | null;
}
export function routeProfile(r: RouteReading, o: ProfileOverlay = {}): string {
  const st = r.stations;
  if (st.length < 2) return '';
  const L = Math.max(1, r.lengthM);
  const padL = 26, padR = 6;
  const x = (m: number) => padL + ((W - padL - padR) * m) / L;
  const top = o.pickets?.length ? 26 : 8;
  const ph = 54;
  const bandY = top + ph + 6;
  const h = bandY + 16 + 16;
  let lo = Infinity, hi = -Infinity;
  for (const s of st) if (s.elev === s.elev) {
    lo = Math.min(lo, s.elev);
    hi = Math.max(hi, s.elev);
  }
  if (!(hi > lo)) {
    lo = (lo === Infinity ? 0 : lo) - 5;
    hi = lo + 10;
  }
  const span = hi - lo;
  const y = (e: number) => top + ph - ((e - lo) / span) * ph;
  let body = '';
  // Grid.
  for (let i = 0; i <= 4; i++) {
    const gx = x((L * i) / 4);
    body += `<line x1="${gx}" y1="${top}" x2="${gx}" y2="${bandY + 12}" stroke="${VZ.faint}"/>`;
  }
  if (o.highlight) body += `<rect x="${x(o.highlight.fromM)}" y="${top}" width="${Math.max(2, x(o.highlight.toM) - x(o.highlight.fromM))}" height="${bandY + 12 - top}" fill="rgba(77,143,214,.18)"/>`;
  // Height profile.
  const pts = st.filter((s) => s.elev === s.elev).map((s) => `${x(s.chainM).toFixed(1)},${y(s.elev).toFixed(1)}`);
  if (pts.length >= 2) {
    body += `<defs><linearGradient id="mgv-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b7a99" stop-opacity=".55"/><stop offset="1" stop-color="#5b7a99" stop-opacity=".05"/></linearGradient></defs>`;
    body += `<polygon points="${x(0)},${top + ph} ${pts.join(' ')} ${x(L)},${top + ph}" fill="url(#mgv-g)"/>`;
    body += `<polyline points="${pts.join(' ')}" fill="none" stroke="#9fb6cc" stroke-width="1.4"/>`;
  }
  body += t(padL - 3, top + 4, `${Math.round(hi)}`, { a: 'end', sz: 9 }) + t(padL - 3, top + ph, `${Math.round(lo)}`, { a: 'end', sz: 9 });
  // Danger band: worst score per station.
  const worst = new Float32Array(st.length);
  for (const s of r.stretches) for (const q of st) if (q.chainM >= s.fromM && q.chainM <= s.toM && s.score > worst[q.i]) worst[q.i] = s.score;
  body += `<rect x="${x(0)}" y="${bandY}" width="${x(L) - x(0)}" height="10" rx="2" fill="#2b313a"/>`;
  let i0 = 0;
  for (let i = 1; i <= st.length; i++) {
    if (i < st.length && band(worst[i]) === band(worst[i0])) continue;
    if (worst[i0] >= 30) body += `<rect x="${x(st[i0].chainM)}" y="${bandY}" width="${Math.max(1.5, x(st[Math.min(i, st.length - 1)].chainM) - x(st[i0].chainM))}" height="10" fill="${band(worst[i0])}"/>`;
    i0 = i;
  }
  for (const g of o.gaps ?? []) body += `<rect x="${x(g.fromM)}" y="${top - 6}" width="${Math.max(2, x(g.toM) - x(g.fromM))}" height="3" fill="${VZ.grey}" opacity=".7"/>`;
  // Pickets: two rows of reach bars (L above R).
  for (const p of o.pickets ?? []) {
    const ry = p.side === 'L' ? 6 : 14;
    body += `<rect x="${x(p.from)}" y="${ry}" width="${Math.max(2, x(p.to) - x(p.from))}" height="6" rx="3" fill="${VZ.blue}" opacity=".75"><title>P${p.n} ${p.side}</title></rect>`;
  }
  if (o.pickets?.length) body += t(2, 12, 'L', { sz: 8 }) + t(2, 20, 'R', { sz: 8 });
  for (const b of o.bounds ?? []) {
    const bx = x(b.toM);
    body += `<line x1="${bx}" y1="${top}" x2="${bx}" y2="${bandY + 10}" stroke="${VZ.cyan}" stroke-dasharray="3 3"/>` + t(bx, top - 1, `B${b.n}`, { a: 'middle', c: VZ.cyan, sz: 9, w: 700 });
  }
  for (const k of o.marks ?? []) {
    const mx = x(k.m);
    const my = bandY + 5;
    if (k.shape === 'diamond') body += `<path d="M${mx} ${my - 6} L${mx + 6} ${my} L${mx} ${my + 6} L${mx - 6} ${my} Z" fill="${k.c}" stroke="#14181d"/>`;
    else if (k.shape === 'square') body += `<rect x="${mx - 5}" y="${my - 5}" width="10" height="10" rx="2" fill="${k.c}" stroke="#14181d"/>`;
    else body += `<circle cx="${mx}" cy="${my}" r="5.5" fill="${k.c}" stroke="#14181d"/>`;
    if (k.label) body += t(mx, my + 3.2, k.label, { a: 'middle', c: '#14181d', sz: 7.5, w: 800 });
  }
  body += t(x(0), h - 2, '0', { sz: 9 }) + t(x(L / 2), h - 2, `${(L / 2000).toFixed(1)}`, { a: 'middle', sz: 9 }) + t(x(L), h - 2, `${(L / 1000).toFixed(1)} km`, { a: 'end', sz: 9 });
  return svg(h, body, 'Route profile with dangers');
}

// ── cordon ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function cordonRing(c: CordonReading, y: CordonLayout): string {
  const h = 246;
  const cx = W / 2, cy = 102, r0 = 58, r1 = 76, rOut = 92;
  const ring = c.ring;
  const ctr: MercXY = ring.reduce((a, q) => [a[0] + q[0] / ring.length, a[1] + q[1] / ring.length], [0, 0]) as MercXY;
  const ang = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const arc = (a0: number, a1: number, ri: number, ro: number) => {
    const p = (a: number, rr: number) => `${(cx + rr * Math.cos(ang(a))).toFixed(1)} ${(cy + rr * Math.sin(ang(a))).toFixed(1)}`;
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M${p(a0, ro)} A${ro} ${ro} 0 ${large} 1 ${p(a1, ro)} L${p(a1, ri)} A${ri} ${ri} 0 ${large} 0 ${p(a0, ri)} Z`;
  };
  let body = `<circle cx="${cx}" cy="${cy}" r="${rOut}" fill="none" stroke="${VZ.red}" stroke-opacity=".55" stroke-dasharray="4 4"/>`;
  body += `<circle cx="${cx}" cy="${cy}" r="${r0 - 4}" fill="rgba(255,255,255,.03)"/>`;
  if (c.urban && y.sectors.length) {
    const n = y.sectors.length;
    // Sector bearings from the centre, in ring order; draw each as its share of the circle.
    y.sectors.forEach((s, i) => {
      const a0 = (360 * i) / n, a1 = (360 * (i + 1)) / n - (n > 1 ? Math.min(2, 120 / n) : 0);
      const coy = Math.floor(i / 3);
      body += `<path d="${arc(a0, a1, r0, r1)}" fill="${COY[coy % COY.length]}" opacity="${0.55 + 0.15 * (i % 3)}"><title>${esc(s.label)}: ${s.men} men</title></path>`;
      if (s.rooftop) {
        const am = (a0 + a1) / 2;
        body += `<circle cx="${cx + (r1 + 5) * Math.cos(ang(am))}" cy="${cy + (r1 + 5) * Math.sin(ang(am))}" r="2.2" fill="${VZ.violet}"/>`;
      }
    });
  } else {
    body += `<circle cx="${cx}" cy="${cy}" r="${(r0 + r1) / 2}" fill="none" stroke="${VZ.green}" stroke-width="${r1 - r0}" stroke-opacity=".25"/>`;
    for (const e of c.escapes) {
      const b = bearingOf(ctr, [e.x, e.y]);
      body += `<circle cx="${cx + ((r0 + r1) / 2) * Math.cos(ang(b))}" cy="${cy + ((r0 + r1) / 2) * Math.sin(ang(b))}" r="5" fill="${VZ.orange}" stroke="#14181d"><title>${esc(e.why)}</title></circle>`;
    }
  }
  for (const p of c.exits) {
    const b = bearingOf(ctr, p);
    const px = cx + rOut * Math.cos(ang(b)), py = cy + rOut * Math.sin(ang(b));
    body += `<rect x="${px - 6}" y="${py - 6}" width="12" height="12" rx="2" fill="${VZ.red}" stroke="#14181d"/>` + t(px, py + 3, 'RB', { a: 'middle', c: '#fff', sz: 6.5, w: 800 });
  }
  for (const p of c.sideRoads) {
    const b = bearingOf(ctr, p);
    const px = cx + r1 * Math.cos(ang(b)), py = cy + r1 * Math.sin(ang(b));
    body += `<path d="M${px - 4} ${py - 4} L${px + 4} ${py + 4} M${px + 4} ${py - 4} L${px - 4} ${py + 4}" stroke="${VZ.orange}" stroke-width="2"/>`;
  }
  body += t(cx, cy - 4, `${c.totalMen.toLocaleString('en')}`, { a: 'middle', c: '#fff', sz: 20, w: 750 }) + t(cx, cy + 12, 'men', { a: 'middle', sz: 10 });
  body += t(cx, cy - rOut - 4, 'N', { a: 'middle', sz: 9, w: 700 });
  if (c.urban) body += t(4, 206, `${y.companies} Coy · ${y.sectors.length} Pl`, { sz: 10 });
  body += t(W - 4, 206, `${c.exits.length} RB · ${c.sideRoads.length} side Rd`, { a: 'end', sz: 10 });
  // The men split, as a bar under the ring (one picture, so it scales as one).
  body += `<g transform="translate(0 214)">${manpowerBody(c)}</g>`;
  return svg(h, body, 'Cordon sectors and men');
}

export function manpowerBar(c: CordonReading): string {
  return svg(30, manpowerBody(c), 'Manpower split');
}
function manpowerBody(c: CordonReading): string {
  const parts = c.urban
    ? [
        { k: 'Line', v: c.inner.perimeterMen, c: VZ.blue },
        { k: 'Roofs', v: c.inner.rooftopMen, c: VZ.violet },
        { k: 'Side Rds', v: c.inner.sideRoadMen, c: VZ.orange },
        { k: 'Rd blocks', v: c.outerCordon.men, c: VZ.red },
      ]
    : [
        { k: 'Escape routes', v: c.inner.men, c: VZ.green },
        { k: 'Rd blocks', v: c.outerCordon.men, c: VZ.red },
      ];
  const tot = Math.max(1, parts.reduce((a, p) => a + p.v, 0));
  let x = 0;
  let body = '';
  let lx = 0;
  for (const p of parts) {
    const w = (W * p.v) / tot;
    if (w > 0) body += `<rect x="${x}" y="0" width="${Math.max(0, w - 1)}" height="12" fill="${p.c}"/>`;
    x += w;
    body += `<rect x="${lx}" y="19" width="8" height="8" rx="2" fill="${p.c}"/>` + t(lx + 11, 26.5, `${p.k} ${p.v.toLocaleString('en')}`, { sz: 9.5 });
    lx += 72;
  }
  return body;
}

// ── convoy ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function convoyChart(r: RouteReading, c: ConvoyPlan, speedKmh: number): string {
  const h = 190;
  const padL = 30, padB = 16, top = 8;
  const t0 = c.packets[0].spMin;
  const t1 = Math.max(...c.packets.map((p) => p.rpMin));
  const span = Math.max(1, t1 - t0);
  const L = Math.max(1, c.lengthM);
  const x = (min: number) => padL + ((W - padL - 4) * (min - t0)) / span;
  const y = (m: number) => top + ((h - padB - top) * m) / L;
  let body = '';
  // Dangers along the route as shaded rows.
  // The worst dangers only (70+: ambush, block, vulnerable points), merged, so the packets stay readable.
  const hot = r.stretches.filter((s) => s.score >= 70 && ['vp', 'ambush', 'mine', 'block'].includes(s.kind)).sort((a, b) => a.fromM - b.fromM);
  const merged: Array<[number, number]> = [];
  for (const s of hot) {
    const last = merged[merged.length - 1];
    if (last && s.fromM <= last[1] + 100) last[1] = Math.max(last[1], s.toM);
    else merged.push([s.fromM, s.toM]);
  }
  for (const [a, b] of merged) body += `<rect x="${padL}" y="${y(a)}" width="${W - padL - 4}" height="${Math.max(1.5, y(b) - y(a))}" fill="${VZ.red}" opacity=".1"/>`;
  for (const b of c.bounds) {
    body += `<line x1="${padL}" y1="${y(b.toM)}" x2="${W - 4}" y2="${y(b.toM)}" stroke="${VZ.cyan}" stroke-opacity=".5" stroke-dasharray="3 3"/>` + t(padL - 3, y(b.toM) + 3, `B${b.n}`, { a: 'end', c: VZ.cyan, sz: 9 });
  }
  const mpm = (speedKmh * 1000) / 60;
  c.packets.forEach((p, i) => {
    const head = `${x(p.spMin)},${y(0)} ${x(p.spMin + L / mpm)},${y(L)}`;
    const tail = `${x(p.spMin + p.passMin + L / mpm)},${y(L)} ${x(p.spMin + p.passMin)},${y(0)}`;
    body += `<polygon points="${head} ${tail}" fill="${COY[i % COY.length]}" opacity=".7"><title>Packet ${p.n}: ${p.vehicles} veh</title></polygon>`;
  });
  body += `<line x1="${padL}" y1="${h - padB}" x2="${W - 4}" y2="${h - padB}" stroke="${VZ.faint}"/>`;
  const hh = (m: number) => {
    const v = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}${String(v % 60).padStart(2, '0')}`;
  };
  body += t(padL, h - 3, hh(t0), { sz: 9 }) + t(W - 4, h - 3, hh(t1), { a: 'end', sz: 9 }) + t(padL - 3, top + 6, 'SP', { a: 'end', sz: 9, c: VZ.green }) + t(padL - 3, h - padB, 'RP', { a: 'end', sz: 9, c: VZ.green });
  return svg(h, body, 'Convoy time-distance chart');
}

// ── patrol ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function patrolProfile(c: PatrolCard, elevAt: (p: MercXY) => number): string {
  const h = 130;
  const padL = 26, top = 18, ph = 80;
  // Points along the legs every ~40 m.
  const pts: Array<{ m: number; e: number }> = [];
  let acc = 0;
  for (const l of c.legs) {
    const n = Math.max(1, Math.ceil(l.distM / 40));
    for (let k = 0; k <= n; k++) {
      if (k === 0 && pts.length) continue;
      const tt = k / n;
      const p: MercXY = [l.from[0] + (l.to[0] - l.from[0]) * tt, l.from[1] + (l.to[1] - l.from[1]) * tt];
      pts.push({ m: acc + l.distM * tt, e: elevAt(p) });
    }
    acc += l.distM;
  }
  const L = Math.max(1, acc);
  const good = pts.filter((p) => p.e === p.e);
  if (good.length < 2) return '';
  let lo = Math.min(...good.map((p) => p.e)), hi = Math.max(...good.map((p) => p.e));
  if (hi - lo < 10) hi = lo + 10;
  const x = (m: number) => padL + ((W - padL - 6) * m) / L;
  const y = (e: number) => top + ph - ((e - lo) / (hi - lo)) * ph;
  let body = '';
  for (const s of c.exposed) body += `<rect x="${x(s.fromM)}" y="${top}" width="${Math.max(2, x(s.toM) - x(s.fromM))}" height="${ph}" fill="${VZ.orange}" opacity=".15"/>`;
  for (const s of c.skyline) body += `<rect x="${x(s.fromM)}" y="${top}" width="${Math.max(2, x(s.toM) - x(s.fromM))}" height="${ph}" fill="${VZ.red}" opacity=".18"/>`;
  const line = good.map((p) => `${x(p.m).toFixed(1)},${y(p.e).toFixed(1)}`).join(' ');
  body += `<defs><linearGradient id="mgv-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${VZ.cyan}" stop-opacity=".45"/><stop offset="1" stop-color="${VZ.cyan}" stop-opacity=".03"/></linearGradient></defs>`;
  body += `<polygon points="${x(0)},${top + ph} ${line} ${x(L)},${top + ph}" fill="url(#mgv-p)"/><polyline points="${line}" fill="none" stroke="${VZ.cyan}" stroke-width="1.6"/>`;
  let m = 0;
  for (const l of c.legs) {
    m += l.distM;
    const e = elevAt(l.to);
    const yy = e === e ? y(e) : top + ph / 2;
    body += `<circle cx="${x(m)}" cy="${yy}" r="6.5" fill="#14181d" stroke="${VZ.cyan}" stroke-width="1.5"/>` + t(x(m), yy + 3, String(l.i + 1), { a: 'middle', c: '#fff', sz: 8, w: 700 });
  }
  if (c.fmp) body += `<line x1="${x(c.fmp.chainM)}" y1="${top - 4}" x2="${x(c.fmp.chainM)}" y2="${top + ph}" stroke="${VZ.violet}" stroke-dasharray="3 2"/>` + t(x(c.fmp.chainM), top - 6, 'FMP', { a: 'middle', c: VZ.violet, sz: 9, w: 700 });
  body += t(padL - 3, top + 4, `${Math.round(hi)}`, { a: 'end', sz: 9 }) + t(padL - 3, top + ph, `${Math.round(lo)}`, { a: 'end', sz: 9 });
  body += t(x(0), h - 3, 'Start', { sz: 9 }) + t(x(L), h - 3, `Obj · ${(L / 1000).toFixed(2)} km`, { a: 'end', sz: 9 });
  body += `<rect x="${W - 112}" y="2" width="8" height="8" fill="${VZ.red}" opacity=".5"/>` + t(W - 101, 9.5, 'skyline', { sz: 9 }) + `<rect x="${W - 60}" y="2" width="8" height="8" fill="${VZ.orange}" opacity=".5"/>` + t(W - 49, 9.5, 'exposed', { sz: 9 });
  return svg(h, body, 'Patrol height profile');
}

export function legRose(c: PatrolCard): string {
  const h = 150;
  const cx = W / 2, cy = 76, R = 62;
  const maxD = Math.max(1, ...c.legs.map((l) => l.distM));
  let body = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${VZ.faint}"/><circle cx="${cx}" cy="${cy}" r="${R / 2}" fill="none" stroke="${VZ.faint}"/>`;
  for (const [a, s] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as Array<[number, string]>) {
    const rad = ((a - 90) * Math.PI) / 180;
    body += t(cx + (R + 9) * Math.cos(rad), cy + (R + 9) * Math.sin(rad) + 3, s, { a: 'middle', sz: 9, w: 700 });
  }
  for (const l of c.legs) {
    const rad = ((l.bearingDeg - 90) * Math.PI) / 180;
    const rr = 10 + ((R - 10) * l.distM) / maxD;
    const ex = cx + rr * Math.cos(rad), ey = cy + rr * Math.sin(rad);
    body += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${VZ.cyan}" stroke-width="3" stroke-linecap="round" opacity=".8"/>`;
    body += t(ex + 7 * Math.cos(rad), ey + 7 * Math.sin(rad) + 3, String(l.i + 1), { a: 'middle', sz: 8.5, c: '#fff' });
  }
  body += `<circle cx="${cx}" cy="${cy}" r="3" fill="#fff"/>`;
  return svg(h, body, 'Leg bearings');
}

// ── ambush / road block sketches ─────────────────────────────────────────────────────────────────────────────────────

export function ambushSketch(s: AmbushSite, kzM: number): string {
  const h = 176;
  const side = s.layout.side === 'L' ? -1 : 1; // L = above the road in the sketch
  // The road sits on the far side from the fire group, so the group, its withdrawal and the MP have room.
  const y0 = side < 0 ? 114 : 40;
  const sx = (m: number) => 20 + ((W - 40) * (m + 400)) / 800; // -400..+400 m along the road
  const kz0 = sx(-kzM / 2), kz1 = sx(kzM / 2);
  let body = `<rect x="0" y="${y0 - 5}" width="${W}" height="10" fill="#3a424d"/><line x1="0" y1="${y0}" x2="${W}" y2="${y0}" stroke="#8a96a3" stroke-dasharray="6 6"/>`;
  body += `<rect x="${kz0}" y="${y0 - 9}" width="${kz1 - kz0}" height="18" rx="3" fill="${VZ.red}" opacity=".45"/>` + t((kz0 + kz1) / 2, y0 + 3.5, 'KILLING ZONE', { a: 'middle', c: '#fff', sz: 8, w: 800 });
  // The target comes from the left.
  body += `<path d="M6 ${y0} l12 0 m-5 -4 l5 4 l-5 4" stroke="${VZ.ink}" fill="none" stroke-width="1.5"/>`;
  const fy = y0 + side * 32;
  body += `<rect x="${kz0}" y="${fy - 4}" width="${kz1 - kz0}" height="8" rx="4" fill="${VZ.blue}"/>` + t((kz0 + kz1) / 2, fy + side * 14 + (side < 0 ? 0 : 4), 'Fire group', { a: 'middle', c: VZ.blue, sz: 9.5, w: 700 });
  for (let i = 0; i < 6; i++) {
    const ax = kz0 + ((kz1 - kz0) * (i + 0.5)) / 6;
    body += `<line x1="${ax}" y1="${fy - side * 5}" x2="${ax}" y2="${y0 + side * 10}" stroke="${VZ.blue}" stroke-width="1" opacity=".6"/>`;
  }
  const st0 = sx(-kzM / 2 - 100), st1 = sx(kzM / 2 + 100);
  for (const [sxx, n] of [[st0, 1], [st1, 2]] as Array<[number, number]>) body += `<rect x="${sxx - 9}" y="${y0 + side * 18 - 7}" width="18" height="14" rx="3" fill="${VZ.blue}" stroke="#14181d"/>` + t(sxx, y0 + side * 18 + 3.5, `S${n}`, { a: 'middle', c: '#fff', sz: 8, w: 800 });
  if (s.layout.shape === 'L') body += `<rect x="${kz1 + 8}" y="${Math.min(y0, fy) - 2}" width="7" height="${Math.abs(fy - y0) + 4}" rx="3" fill="${VZ.blue}" opacity=".85"/>`;
  if (s.layout.shape === 'V') body += `<rect x="${kz0}" y="${y0 - side * 32 - 4}" width="${kz1 - kz0}" height="8" rx="4" fill="${VZ.blue}" opacity=".55"/>`;
  const mx = (kz0 + kz1) / 2, my = y0 + side * 62;
  body += `<path d="M${mx} ${fy + side * 6} L${mx} ${my - side * 8}" stroke="${VZ.green}" stroke-dasharray="4 3" stroke-width="1.5" marker-end=""/>`;
  body += `<rect x="${mx - 12}" y="${my - 8}" width="24" height="16" rx="3" fill="${VZ.green}" stroke="#14181d"/>` + t(mx, my + 3.5, 'MP', { a: 'middle', c: '#fff', sz: 8.5, w: 800 });
  body += t(mx + 18, my + 3.5, `${s.layout.meetingM} m back · ${s.layout.withdrawalCoverPct} % in cover`, { sz: 9.5 });
  body += t(W - 2, side < 0 ? h - 4 : 12, `${s.layout.shape === 'line' ? 'Line' : s.layout.shape} layout`, { a: 'end', sz: 10, w: 700, c: '#fff' });
  return svg(h, body, 'Ambush layout sketch');
}

export function blockSketch(s: BlockSite, approachM: number): string {
  const h = 150;
  const y0 = 75;
  const bx = W - 50;
  const sx = (m: number) => 14 + ((bx - 14) * m) / approachM;
  let body = `<rect x="0" y="${y0 - 5}" width="${W}" height="10" fill="#3a424d"/>`;
  body += `<rect x="14" y="${y0 - 9}" width="${bx - 14}" height="18" fill="${VZ.red}" opacity=".18"/>` + t((14 + bx) / 2, y0 + 22, `approach ${approachM} m`, { a: 'middle', sz: 9.5 });
  body += `<path d="M14 ${y0} l14 0 m-5 -4 l5 4 l-5 4" stroke="${VZ.red}" fill="none" stroke-width="1.6"/>`;
  body += `<rect x="${bx}" y="${y0 - 14}" width="10" height="28" rx="2" fill="${VZ.red}" stroke="#14181d"/>` + t(bx + 5, y0 - 18, 'BLOCK', { a: 'middle', c: '#fff', sz: 8.5, w: 800 });
  s.positions.forEach((p, i) => {
    const py = y0 + (p.side === 'L' ? -1 : 1) * (22 + Math.min(40, p.offM / 12));
    const px = bx - 30 - i * 26;
    const reach = sx(approachM * (1 - p.seesPct / 100));
    body += `<path d="M${px} ${py} L${reach} ${y0 - 6} L${sx(0)} ${y0 + 6} Z" fill="${VZ.blue}" opacity=".18"/>`;
    body += `<path d="M${px} ${py - 7} L${px + 7} ${py} L${px} ${py + 7} L${px - 7} ${py} Z" fill="${VZ.blue}" stroke="#14181d"/>` + t(px, py + (p.side === 'L' ? -10 : 17), `A${i + 1} ${p.seesPct} %`, { a: 'middle', sz: 9.5, c: '#fff', w: 700 });
  });
  const ok = s.parts.filter((q) => q.ok).length;
  body += t(4, 12, `${ok}/${s.parts.length} rules met · score ${s.score}`, { sz: 10, w: 700, c: '#fff' });
  return svg(h, body, 'Road block sketch');
}

// ── infiltration ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function infilBand(q: InfilReading, line: MercXY[], enemySide: -1 | 1): string {
  const h = 170;
  const yl = 85;
  // Straighten the line: position along it (x) and offset from it (y).
  let total = 0;
  const cum = [0];
  for (let i = 0; i + 1 < line.length; i++) cum.push((total += groundDist(line[i], line[i + 1])));
  const L = Math.max(1, total);
  const proj = (p: MercXY): [number, number] => {
    let best = Infinity, bm = 0, bo = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const qx = a[0] + tt * dx, qy = a[1] + tt * dy;
      const d = Math.hypot(p[0] - qx, p[1] - qy);
      if (d < best) {
        best = d;
        const cr = dx * (p[1] - a[1]) - dy * (p[0] - a[0]);
        bm = cum[i] + groundDist(a, [qx, qy]);
        bo = groundDist([qx, qy], p) * (cr > 0 ? -1 : 1); // left = -1
      }
    }
    return [bm, bo];
  };
  const bandM = Math.max(1, ...q.lanes.flatMap((l) => l.path.map((p) => Math.abs(proj(p)[1]))), 500);
  const x = (m: number) => 14 + ((W - 28) * m) / L;
  const y = (o: number) => yl + (o * enemySide < 0 ? 1 : -1) * Math.min(1, Math.abs(o) / bandM) * 66; // enemy above
  let body = `<rect x="0" y="${yl - 70}" width="${W}" height="70" fill="${VZ.red}" opacity=".08"/><rect x="0" y="${yl}" width="${W}" height="70" fill="${VZ.blue}" opacity=".08"/>`;
  body += t(4, yl - 60, 'ENEMY SIDE', { sz: 8.5, c: VZ.red, w: 700 }) + t(4, yl + 66, 'OWN SIDE', { sz: 8.5, c: VZ.blue, w: 700 });
  body += `<line x1="0" y1="${yl}" x2="${W}" y2="${yl}" stroke="#fff" stroke-width="2"/>`;
  for (const l of q.lanes) {
    const pts = l.path.map((p) => {
      const [m, o] = proj(p);
      return `${x(m).toFixed(1)},${y(o).toFixed(1)}`;
    });
    body += `<polyline points="${pts.join(' ')}" fill="none" stroke="${VZ.red}" stroke-width="2.4" stroke-dasharray="5 3"/>`;
    const [m0] = proj(l.path[Math.floor(l.path.length / 2)]);
    body += `<circle cx="${x(m0)}" cy="${yl}" r="7" fill="${VZ.red}" stroke="#14181d"/>` + t(x(m0), yl + 3, `L${l.n}`, { a: 'middle', c: '#fff', sz: 7.5, w: 800 });
  }
  for (const p of q.posts) {
    const [m, o] = proj([p.x, p.y]);
    const c = p.source === 'new' ? VZ.blue : VZ.grey;
    body += `<rect x="${x(m) - 5}" y="${y(o) - 5}" width="10" height="10" rx="2" fill="${c}" stroke="#14181d"><title>${esc(p.name ?? 'post')}</title></rect>`;
  }
  body += t(14, h - 2, '0', { sz: 9 }) + t(W - 14, h - 2, `${(L / 1000).toFixed(1)} km along the line`, { a: 'end', sz: 9 });
  return svg(h, body, 'Infiltration band');
}

export function gauge(pct: number, label: string, colour: string, size = 64): string {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  return `<svg viewBox="0 0 ${size} ${size + 14}" width="${size}" height="${size + 14}" role="img" aria-label="${esc(label)} ${Math.round(v)} %"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#2b313a" stroke-width="7"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${colour}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${((c * v) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>${t(size / 2, size / 2 + 4, `${Math.round(v)}%`, { a: 'middle', c: '#fff', sz: 13, w: 750 })}${t(size / 2, size + 11, label, { a: 'middle', sz: 9 })}</svg>`;
}

/** Small marks for a profile from stretches of given kinds. */
export function stretchMarks(st: Stretch[], kinds: string[], shape: 'diamond' | 'pin' | 'square'): ProfileOverlay['marks'] {
  return st.filter((s) => kinds.includes(s.kind) && s.score >= 50).map((s) => ({ m: s.chainM, label: '', c: band(s.score), shape }));
}
