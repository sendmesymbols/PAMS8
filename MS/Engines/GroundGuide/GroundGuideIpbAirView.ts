/**
 * GroundGuideIpbAirView.ts
 *
 * Tab 4 Air of the Extended View (IPB_Plan.md §6.4; Phase 6): the air avenues of approach, LZ / DZ and AD sites over the
 * area read (GroundGuideIpbAir.ts, worked out in GroundGuide.ts), as the answer strip, facts, tiles, the Gr Scope rail's
 * line 4 and Copy as Text. Shares the avenue cards' styles (GroundGuideIpbApchView.ts).
 */

import { fmtDistance } from './GroundGuideEvaluator';
import type { Fact, LetterAnswer } from './GroundGuideDetailSummary';
import { FONT } from './GroundGuideTokens';
import { ensureApchCss, wxTile } from './GroundGuideIpbApchView';
import type { GroundGuideOcoka, IpbAirView, IpbAirZone, IpbApchView, MercXY } from './GroundGuideTypes';

const SVGNS = 'http://www.w3.org/2000/svg';
const AIR_EN = '#ff7ad9';
const AIR_OWN = '#7fd6ff';
const AD = '#b8f070';
const OWN = '#8ec1ea';
const SEEN = '#e5484d';
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svgEl(tag: string, attrs: Record<string, string | number>, parent?: Element, text?: string): SVGElement {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}
function tile(caption: string, ...content: Array<Node | string | null | undefined | false>): HTMLElement {
  const sec = el('div', 'ms-ggb-sec');
  sec.append(el('div', 'ms-ggb-cap ms-ggd-cap', caption));
  for (const c of content) if (c) sec.append(c);
  return sec;
}
const note = (text: string): HTMLElement => el('div', 'ms-gx-note', text);
const km = (m: number): string => (m >= 10000 ? `${Math.round(m / 1000)} km` : fmtDistance(m));
const pc = (v: number): string => `${Math.round(v)}%`;
const airCol = (av: IpbAirView): string => (av.side === 'enemy' ? AIR_EN : AIR_OWN);
const sideWord = (av: IpbAirView): string => (av.side === 'enemy' ? 'En' : 'Own');
const seenWord = (z: IpbAirZone): string => (z.seenP === null ? 'Not judged' : z.seenP >= 0.5 ? 'In view' : z.seenP >= 0.2 ? 'May be seen' : 'Hidden');
const ft = (m: number): number => Math.round(m / 0.3048 / 5) * 5;
const dirs = (b: number[]): string => (b.length === 8 ? 'all round' : b.map((x) => COMPASS[Math.round(x / 45) % 8]).join(' '));

// ── answer, facts ───────────────────────────────────────────────────────────────────────────────────────────────────

export function airAnswer(o: GroundGuideOcoka): LetterAnswer {
  const v = o.ipbApch;
  const av = v?.air;
  if (v === undefined) return { label: 'Air Apchs, LZ / DZ, AD sites', parts: [{ text: 'Apchs Off' }], sub: 'The air reading follows the IPB area read (extended.ipb.apchs).', tone: null, tab: 'Off' };
  if (!v || !av) return { label: 'Air Apchs, LZ / DZ, AD sites', parts: [{ text: 'Working Out…' }], sub: 'Least-cost low-level ways, LZ / DZ and AD sites over the area read.', tone: null, tab: '…' };
  const r = av.routes[0];
  const label = av.side === 'enemy' ? `En air Apchs into own depth · ${av.bandLabel} flight` : `Own air Apchs to the Obj · ${av.bandLabel} flight`;
  if (!r) return { label, parts: [{ text: 'No Air Apch' }], sub: av.notes[0] ?? null, tone: null, tab: 'None' };
  const lz = av.lzs[0];
  return {
    label,
    parts: [{ text: `Air ${r.id} → ${r.to}`, tone: av.side === 'enemy' ? 'warn' : null }, { text: `${km(r.lengthM)} · ${av.observers ? `${pc(r.seenPct)} in view` : 'concealment not judged'}`, small: true }],
    sub: `${r.why}${lz ? `. ${lz.id}: ${lz.why}.` : ''}`,
    tone: av.side === 'enemy' ? 'warn' : null,
    tab: `${av.routes.length} · ${av.lzs.length} LZ`,
  };
}

export function airFacts(o: GroundGuideOcoka): Fact[] {
  const av = o.ipbApch?.air;
  if (!av) return [];
  const out: Fact[] = [];
  for (const r of av.routes.slice(0, 2)) out.push({ k: `Air ${r.id} → ${r.to}`, v: km(r.lengthM), sub: av.observers ? `${pc(r.seenPct)} in view${r.wires ? ` · ${r.wires} wires` : ''}` : 'concealment not judged', tone: r.rank === 1 && av.side === 'enemy' ? 'warn' : null });
  const lz = av.lzs[0];
  if (lz) out.push({ k: `${lz.id}${lz.existing ? ' · existing' : ''}`, v: seenWord(lz), tone: lz.seenP === null ? null : lz.seenP >= 0.5 ? 'nogo' : lz.seenP >= 0.2 ? 'slow' : 'go', sub: `slope ${lz.slopeDeg.toFixed(0)}°${lz.distObjM !== null ? ` · ${km(lz.distObjM)} from Obj` : ''}` });
  const dz = av.dzs[0];
  if (dz) out.push({ k: dz.id, v: seenWord(dz), sub: `${Math.round(dz.sideM)} m square · slope ${dz.slopeDeg.toFixed(0)}°` });
  const ad = av.ad[0];
  if (ad) out.push({ k: `${ad.id} · ${av.side === 'enemy' ? 'own' : 'en'} AD`, v: `sees ${km(ad.seenM)}`, sub: ad.kinds.length ? ad.kinds.map((k) => (k === 'long' ? 'long-range' : k)).join(', ') : `within ${km(av.adRangeM)}` });
  out.push({ k: 'Flight Band', v: av.bandLabel, sub: `${av.bandM[0]}-${av.bandM[1]} m (${ft(av.bandM[0])}-${ft(av.bandM[1])} ft) above obstacles` });
  return out.slice(0, 6);
}

// ── pictures ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The area read with the air avenues, LZ / DZ, AD sites and their reach, OPs and obstructions. */
function airPicture(o: GroundGuideOcoka, v: IpbApchView, av: IpbAirView, wpx = 380): SVGSVGElement {
  const pts: MercXY[] = [...v.frame, ...av.routes.flatMap((r) => r.line)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 10;
  const sc = (wpx - 2 * pad) / Math.max(1, x1 - x0);
  const hpx = Math.round(Math.min(420, Math.max(180, (y1 - y0) * sc + 2 * pad)));
  const s = Math.min(sc, (hpx - 2 * pad) / Math.max(1, y1 - y0));
  const ox = (wpx - (x1 - x0) * s) / 2, oy = (hpx - (y1 - y0) * s) / 2;
  const X = (p: MercXY): number => ox + (p[0] - x0) * s;
  const Y = (p: MercXY): number => oy + (y1 - p[1]) * s;
  const d = (ps: MercXY[], close = false): string => ps.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)} ${Y(p).toFixed(1)}`).join('') + (close ? 'Z' : '');
  const svg = svgEl('svg', { width: wpx, height: hpx, viewBox: `0 0 ${wpx} ${hpx}`, class: 'ms-gia-pic' }) as SVGSVGElement;
  svgEl('rect', { width: wpx, height: hpx, fill: '#11161b', rx: 8 }, svg);
  const clip = `ms-gai-clip-${Math.random().toString(36).slice(2, 8)}`;
  const defs = svgEl('defs', {}, svg);
  const cp = svgEl('clipPath', { id: clip }, defs);
  svgEl('rect', { width: wpx, height: hpx, rx: 8 }, cp);
  const g = svgEl('g', { 'clip-path': `url(#${clip})` }, svg);
  if (v.raster) {
    const [rx0, ry0, rx1, ry1] = v.raster.extent;
    svgEl('image', { href: v.raster.url, x: X([rx0, ry1]).toFixed(1), y: Y([rx0, ry1]).toFixed(1), width: ((rx1 - rx0) * s).toFixed(1), height: ((ry1 - ry0) * s).toFixed(1), preserveAspectRatio: 'none', opacity: 0.45 }, g);
  }
  if (v.frame.length === 4) svgEl('path', { d: d(v.frame, true), fill: 'none', stroke: '#e9edf1', 'stroke-opacity': 0.5, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, g);
  const col = airCol(av);
  const k = Math.cosh(((y0 + y1) / 2) / 6378137);
  for (const a of av.ad) svgEl('circle', { cx: X(a.at).toFixed(1), cy: Y(a.at).toFixed(1), r: (av.adRangeM * k * s).toFixed(1), fill: AD, 'fill-opacity': a.rank === 1 ? 0.07 : 0.035, stroke: AD, 'stroke-opacity': 0.55, 'stroke-width': 1, 'stroke-dasharray': '2 3' }, g);
  for (const o2 of av.obstructions) {
    const cx = X(o2.at), cy = Y(o2.at);
    svgEl('path', { d: `M${cx.toFixed(1)} ${(cy - 4).toFixed(1)}l2.6 6.5h-5.2z`, fill: '#ffd27a', stroke: '#0b0d10', 'stroke-width': 0.8 }, g);
  }
  for (const z of [...av.dzs, ...av.lzs]) svgEl('path', { d: d(z.ring, true), fill: col, 'fill-opacity': z.rank === 1 ? 0.35 : 0.18, stroke: col, 'stroke-width': z.rank === 1 ? 1.8 : 1.2, ...(z.kind === 'dz' ? { 'stroke-dasharray': '3 2' } : {}) }, g);
  for (const r of [...av.routes].reverse()) {
    if (r.line.length < 2) continue;
    svgEl('path', { d: d(r.line), fill: 'none', stroke: '#0b0d10', 'stroke-width': r.rank === 1 ? 4.6 : 3.6, 'stroke-opacity': 0.6, 'stroke-linejoin': 'round' }, g);
    svgEl('path', { d: d(r.line), fill: 'none', stroke: col, 'stroke-width': r.rank === 1 ? 2.4 : 1.6, 'stroke-linejoin': 'round', ...(r.rank === 1 ? {} : { 'stroke-dasharray': '6 4' }) }, g);
    const b = r.line[r.line.length - 1], a0 = r.line[Math.max(0, r.line.length - 3)];
    const ang = Math.atan2(Y(b) - Y(a0), X(b) - X(a0));
    const hx = X(b), hy = Y(b), hl = 8;
    svgEl('path', { d: `M${(hx - hl * Math.cos(ang - 0.5)).toFixed(1)} ${(hy - hl * Math.sin(ang - 0.5)).toFixed(1)}L${hx.toFixed(1)} ${hy.toFixed(1)}L${(hx - hl * Math.cos(ang + 0.5)).toFixed(1)} ${(hy - hl * Math.sin(ang + 0.5)).toFixed(1)}`, fill: 'none', stroke: col, 'stroke-width': r.rank === 1 ? 2.4 : 1.6 }, g);
  }
  for (const z of av.lzs) {
    if (!z.op) continue;
    svgEl('path', { d: d([z.op.at, z.at]), stroke: OWN, 'stroke-width': 1, 'stroke-dasharray': '2 2', fill: 'none' }, g);
    const cx = X(z.op.at), cy = Y(z.op.at);
    svgEl('path', { d: `M${cx.toFixed(1)} ${(cy - 6).toFixed(1)}l5.5 10h-11z`, fill: '#14181d', stroke: OWN, 'stroke-width': 1.4 }, g);
  }
  for (const a of av.ad) {
    const cx = X(a.at), cy = Y(a.at);
    svgEl('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: 7, fill: '#14181d', stroke: AD, 'stroke-width': 1.5 }, g);
    svgEl('path', { d: `M${(cx - 4).toFixed(1)} ${(cy + 2).toFixed(1)}h8M${(cx - 3).toFixed(1)} ${(cy + 2).toFixed(1)}a3 3 0 0 1 6 0`, fill: 'none', stroke: AD, 'stroke-width': 1.4 }, g);
  }
  // Labels: air avenues at 45 %, LZ / DZ ids, AD ids.
  const label = (at: MercXY, text: string, stroke: string, fill: string, dy = 0): void => {
    const cx = X(at), cy = Y(at) + dy;
    const w = text.length * 6.4 + 12;
    svgEl('rect', { x: (cx - w / 2).toFixed(1), y: (cy - 8).toFixed(1), width: w.toFixed(1), height: 16, rx: 8, fill, stroke, 'stroke-width': 1.2 }, g);
    svgEl('text', { x: cx.toFixed(1), y: (cy + 4).toFixed(1), 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 750, fill: '#fff', 'font-family': FONT }, g, text);
  };
  const darkA = av.side === 'enemy' ? '#4a1640' : '#173a4f';
  for (const r of av.routes) if (r.line.length >= 2) label(r.line[Math.min(r.line.length - 1, Math.floor(r.line.length * 0.45))], `Air ${r.id}`, col, darkA);
  for (const z of [...av.lzs.slice(0, 3), ...av.dzs.slice(0, 2)]) label(z.at, z.id, col, darkA, 13);
  for (const a of av.ad) label(a.at, a.id, AD, '#26331a', -15);
  // The spot and the threat's side.
  const sx = X(o.at), sy = Y(o.at);
  svgEl('rect', { x: (sx - 5).toFixed(1), y: (sy - 4).toFixed(1), width: 10, height: 8, rx: 1.5, fill: '#1d3f66', stroke: OWN, 'stroke-width': 1.5 }, g);
  if (v.frame.length === 4) {
    const s0 = v.side === 'enemy' ? [v.frame[0], v.frame[1]] : [v.frame[2], v.frame[3]];
    const mid: MercXY = [(s0[0][0] + s0[1][0]) / 2, (s0[0][1] + s0[1][1]) / 2];
    const tx = X(mid), ty = Y(mid);
    svgEl('rect', { x: (tx - 24).toFixed(1), y: (ty - 9).toFixed(1), width: 48, height: 18, rx: 9, fill: '#3a1416', stroke: '#ff6b6f', 'stroke-width': 1.2 }, g);
    svgEl('text', { x: tx.toFixed(1), y: (ty + 4).toFixed(1), 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 650, fill: '#ffd0d1', 'font-family': FONT }, g, 'Threat');
  }
  svgEl('text', { x: wpx - 14, y: 18, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, fill: '#fff', 'font-family': FONT }, svg, 'N↑');
  const kmPx = 1000 * k * s;
  const barKm = kmPx * 5 < wpx * 0.4 ? 5 : kmPx * 2 < wpx * 0.4 ? 2 : 1;
  svgEl('path', { d: `M12 ${hpx - 12}h${(barKm * kmPx).toFixed(1)}`, stroke: '#fff', 'stroke-width': 2.2 }, svg);
  svgEl('text', { x: (12 + (barKm * kmPx) / 2).toFixed(1), y: hpx - 17, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#fff', 'font-family': FONT }, svg, `${barKm} km`);
  return svg;
}

/** The flight profile of one air avenue: the ground, the highest obstacle beside it, the flight band above it, the stretches in view. */
function flightProfile(av: IpbAirView, r: IpbAirView['routes'][number], wpx = 420): SVGSVGElement {
  const H = 190, l = 44, rt = 10, t = 12, b = 28;
  const P = r.profile.filter((p) => p.groundM === p.groundM);
  const svg = svgEl('svg', { width: wpx, height: H, viewBox: `0 0 ${wpx} ${H}` }) as SVGSVGElement;
  if (P.length < 2) {
    svgEl('text', { x: wpx / 2, y: H / 2, 'text-anchor': 'middle', 'font-size': 12, fill: '#c3cbd3', 'font-family': FONT }, svg, 'No elevation along the way');
    return svg;
  }
  const col = airCol(av);
  const aMax = P[P.length - 1].alongM || 1;
  const zLo = Math.min(...P.map((p) => p.groundM)) - 10;
  const zHi = Math.max(...P.map((p) => (p.topM === p.topM ? p.topM : p.groundM))) + av.bandM[1] + 10;
  const X = (a: number): number => l + (a / aMax) * (wpx - l - rt);
  const Y = (z: number): number => t + (1 - (z - zLo) / Math.max(1, zHi - zLo)) * (H - t - b);
  svgEl('rect', { x: l, y: t, width: wpx - l - rt, height: H - t - b, fill: '#171b20', rx: 4 }, svg);
  const top = (p: (typeof P)[number]): number => (p.topM === p.topM ? p.topM : p.groundM);
  // The flight band above the highest obstacle.
  const band = P.map((p, i) => `${i ? 'L' : 'M'}${X(p.alongM).toFixed(1)} ${Y(top(p) + av.bandM[1]).toFixed(1)}`).join('') + [...P].reverse().map((p) => `L${X(p.alongM).toFixed(1)} ${Y(top(p) + av.bandM[0]).toFixed(1)}`).join('') + 'Z';
  svgEl('path', { d: band, fill: col, 'fill-opacity': 0.22, stroke: 'none' }, svg);
  // In view of the other side: the band's top in red.
  for (let i = 1; i < P.length; i++) {
    if (!P[i].seen || !P[i - 1].seen) continue;
    svgEl('path', { d: `M${X(P[i - 1].alongM).toFixed(1)} ${Y(top(P[i - 1]) + av.bandM[1]).toFixed(1)}L${X(P[i].alongM).toFixed(1)} ${Y(top(P[i]) + av.bandM[1]).toFixed(1)}`, stroke: SEEN, 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
  }
  // The ground and the obstacles on it.
  const ground = P.map((p, i) => `${i ? 'L' : 'M'}${X(p.alongM).toFixed(1)} ${Y(p.groundM).toFixed(1)}`).join('');
  svgEl('path', { d: `${ground}L${X(aMax).toFixed(1)} ${(H - b).toFixed(1)}L${l} ${(H - b).toFixed(1)}Z`, fill: '#4a525b', stroke: '#9aa3ad', 'stroke-width': 1 }, svg);
  svgEl('path', { d: P.map((p, i) => `${i ? 'L' : 'M'}${X(p.alongM).toFixed(1)} ${Y(top(p)).toFixed(1)}`).join(''), fill: 'none', stroke: '#ffd27a', 'stroke-width': 1, 'stroke-opacity': 0.8 }, svg);
  for (const p of P) if (p.crest) svgEl('path', { d: `M${X(p.alongM).toFixed(1)} ${(Y(p.groundM) - 3).toFixed(1)}v-7`, stroke: '#fff', 'stroke-width': 1.4 }, svg);
  // Axes.
  const stepKm = aMax > 20000 ? 5 : aMax > 8000 ? 2 : 1;
  for (let a = 0; a <= aMax; a += stepKm * 1000) {
    svgEl('path', { d: `M${X(a).toFixed(1)} ${H - b}v4`, stroke: '#9aa3ad' }, svg);
    svgEl('text', { x: X(a).toFixed(1), y: H - b + 15, 'text-anchor': 'middle', 'font-size': 10, fill: '#c3cbd3', 'font-family': FONT }, svg, `${a / 1000}`);
  }
  svgEl('text', { x: wpx - rt, y: H - 3, 'text-anchor': 'end', 'font-size': 10, fill: '#9aa3ad', 'font-family': FONT }, svg, `km along Air ${r.id} → ${r.to}`);
  for (const z of [zLo + 10, (zLo + zHi) / 2, zHi - 10]) svgEl('text', { x: l - 4, y: (Y(z) + 3.5).toFixed(1), 'text-anchor': 'end', 'font-size': 10, fill: '#c3cbd3', 'font-family': FONT }, svg, `${Math.round(z)} m`);
  return svg;
}

function zoneCards(av: IpbAirView, list: IpbAirZone[]): HTMLElement {
  const box = el('div', 'ms-gia-cards');
  for (const z of list) {
    const c = el('div', 'ms-gia-card');
    const h = el('div', 'ms-gia-h');
    const id = el('span', 'ms-gia-id', z.id);
    id.style.background = av.side === 'enemy' ? '#7a2a68' : '#1e5a7a';
    h.append(id, el('span', undefined, z.existing ?? `${Math.round(z.sideM)} m${z.lengthM !== z.sideM ? ` x ${Math.round(z.lengthM)} m` : ' square'}${z.points ? `, ${z.points} pts` : ''}`));
    const tag = el('span', 'ms-gia-tag', seenWord(z));
    if (z.seenP !== null && z.seenP >= 0.5) tag.style.background = 'rgba(229,72,77,.3)';
    else if (z.seenP !== null && z.seenP >= 0.2) tag.style.background = 'rgba(238,138,31,.3)';
    else if (z.seenP !== null) tag.style.background = 'rgba(62,224,122,.2)';
    h.append(tag);
    c.append(h, el('div', 'ms-gia-t', z.why));
    const chips = el('div', 'ms-gia-chips');
    chips.append(el('span', z.approaches.length ? 'ms-gia-chip ms-ok' : 'ms-gia-chip ms-no', z.approaches.length ? `Apch clear ${dirs(z.approaches)}` : 'No clear approach'));
    for (const w of z.caution) chips.append(el('span', 'ms-gia-chip ms-no', w));
    if (z.mountain) chips.append(el('span', 'ms-gia-chip', 'mountain rule (4°)'));
    c.append(chips);
    if (av.side === 'enemy' && z.kind === 'lz') c.append(el('div', 'ms-gia-t', z.op ? `OP over it: ${km(z.op.distM)} off, ${z.op.riseM >= 0 ? `${z.op.riseM} m higher` : `${-z.op.riseM} m lower`} (OoW Vol I p 63)` : 'No higher ground within 3 km sees it: watch it from closer, or patrol it'));
    box.append(c);
  }
  return box;
}

function adList(av: IpbAirView): HTMLElement {
  const box = el('div', 'ms-gia-cards');
  for (const a of av.ad) {
    const c = el('div', 'ms-gia-card');
    const h = el('div', 'ms-gia-h');
    const id = el('span', 'ms-gia-id', a.id);
    id.style.background = '#46601f';
    h.append(id, el('span', undefined, `sees ${km(a.seenM)}`), el('span', 'ms-gia-tag', `Air ${a.routes.join(', ')}`));
    c.append(h, el('div', 'ms-gia-t', a.why));
    const chips = el('div', 'ms-gia-chips');
    if (a.kinds.includes('long')) chips.append(el('span', 'ms-gia-chip ms-ok', `long-range ${km(a.longM)}`));
    if (a.kinds.includes('flank')) chips.append(el('span', 'ms-gia-chip ms-ok', `flank ${km(a.flankM)}`));
    if (a.kinds.includes('bottom')) chips.append(el('span', 'ms-gia-chip ms-ok', `bottom shot · ${a.bottom} crest${a.bottom > 1 ? 's' : ''}`));
    if (!a.kinds.length) chips.append(el('span', 'ms-gia-chip', 'sees it, no named shot'));
    c.append(chips);
    box.append(c);
  }
  return box;
}

// ── tiles ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function airTiles(o: GroundGuideOcoka): HTMLElement[] {
  ensureApchCss();
  const v = o.ipbApch;
  const av = v?.air;
  if (v === undefined) return [tile('Air', note('The IPB avenues are off (extended.ipb.apchs): the air reading follows their area.'))];
  if (!v || !av) return [tile('Air', note('Working out the air avenues, LZ / DZ and AD sites over the area read.'))];
  const out: HTMLElement[] = [];
  const key = el('div', 'ms-gia-key');
  const k = (c: string, t: string): void => {
    const s = el('span');
    const i = el('i');
    i.style.background = c;
    s.append(i, t);
    key.append(s);
  };
  k(airCol(av), `${sideWord(av)} air Apch / LZ`);
  k(AD, `${av.side === 'enemy' ? 'own' : 'en'} AD, ${km(av.adRangeM)}`);
  if (av.side === 'enemy') k(OWN, 'OP over an en LZ');
  k('#ffd27a', 'mast / tower');
  out.push(tile(`${sideWord(av)} Air Apchs, LZ / DZ, AD Sites`, airPicture(o, v, av), key));
  const r = av.routes[0];
  if (r) out.push(tile(`Flight Profile · Air ${r.id} · ${av.bandLabel}`, flightProfile(av, r), note(`Band: ${av.bandM[0]}-${av.bandM[1]} m above the highest obstacle (shaded); red where the other side may see an aircraft at its top${av.observers ? '' : ' (no other side\'s Posns: not judged)'}; yellow line: trees, buildings, masts; ticks: crests. Height exaggerated.`)));
  const rl = el('div', 'ms-gia-cards');
  for (const q of av.routes) {
    const c = el('div', q.rank === 1 ? 'ms-gia-card ms-main' : 'ms-gia-card');
    const h = el('div', 'ms-gia-h');
    const id = el('span', 'ms-gia-id', `Air ${q.id}`);
    id.style.background = av.side === 'enemy' ? '#7a2a68' : '#1e5a7a';
    h.append(id, el('span', undefined, `→ ${q.to}`), el('span', 'ms-gia-tag', km(q.lengthM)));
    c.append(h, el('div', 'ms-gia-t', q.why));
    if (q.obstructionsNear.length) c.append(el('div', 'ms-gia-t', `Near: ${q.obstructionsNear.slice(0, 4).map((x) => `${x.label} ${Math.round(x.heightM)} m`).join(', ')}`));
    rl.append(c);
  }
  if (!av.routes.length) rl.append(note(av.notes[0] ?? 'No air avenue.'));
  const rt = tile('Air Apchs Ranked', rl, note('Least cost: length, in view of the other side, near obstructions, across power lines, over built-up areas; cheaper in valleys and along rivers, canals, railways and main roads lying with the flight (book pp 5-6). Weights are a proposal.'));
  rt.classList.add('ms-ggd-brk');
  out.push(rt);
  const zl = tile(`LZ Ranked · ${av.lzPoints} x size ${av.lzClass} (${av.lpM} m) = ${av.lzSideM} m`, av.lzs.length ? zoneCards(av, av.lzs) : note(av.notes.find((n) => /No LZ/.test(n)) ?? 'No LZ in the zone.'), note(av.side === 'enemy' ? "The enemy's likely LZs behind own FDLs (OoW Vol I pp 61-63): heliborne forces seize dominating ground, defile crossings and depth localities. Watch them." : 'Near the objective, hidden from the enemy, existing helipads and airfields first.'));
  zl.classList.add('ms-ggd-brk');
  out.push(zl);
  if (av.dzs.length) out.push(tile(`DZ Ranked · ${Math.round(av.dzs[0].sideM)} m`, zoneCards(av, av.dzs), note('Personnel DZ for one jumper (DAFMAN 13-217, T); a stick needs it longer.')));
  if (av.ad.length) {
    const at = tile(`${av.side === 'enemy' ? 'Own' : 'En'} AD Sites · ${km(av.adRangeM)} Reach`, adList(av), note(`Long-range: the flight comes almost straight at the site. Flank: it passes across. Bottom: the site lies below a crest the flight crosses, so the aircraft shows against the sky (book p 6). Judged on the ground's line of sight to the bottom of the band.`));
    at.classList.add('ms-ggd-brk');
    out.push(at);
  }
  const wx = wxTile(v, 'air');
  if (wx) out.push(wx);
  const rows: Array<[string, string]> = [
    ['Band', `${av.bandLabel}: ${av.bandM[0]}-${av.bandM[1]} m (${ft(av.bandM[0])}-${ft(av.bandM[1])} ft) above the highest obstacle (FM 3-04.203, T)`],
    ['LZ', `${av.lzPoints} landing points of ${av.lpM} m (size ${av.lzClass}, FM 3-21.38, T); slope 7° (4° in mountains, MW p 256); approach 10 : 1`],
    ['Eyes', av.observers ? `${av.observers} of the other side's Posns judged` : "None in reach: concealment not judged"],
  ];
  for (const n of av.notes) rows.push(['Note', n]);
  rows.push(['Check', 'Flight heights and LZ sizes are US figures: confirm with Army Aviation; AD reach with AD.']);
  const ra = el('div', 'ms-gx-list');
  for (const [a, b] of rows) ra.append(el('div', undefined, a), el('div', undefined, b));
  out.push(tile('Read As', ra));
  const acts = el('div', 'ms-gia-acts');
  const b = el('button', 'ms-gia-btn ms-all', 'Air') as HTMLButtonElement;
  b.type = 'button';
  b.title = 'Air avenues (Low Level Transit Route), LZ, DZ, AD reach (SHORAD engagement zone), OPs over the enemy\'s LZs';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    b.dispatchEvent(new CustomEvent('ms-gg-ipb-create', { bubbles: true, detail: { kind: 'air' } }));
  });
  acts.append(b);
  out.push(tile('Create on Map', acts, note('Ordinary symbols, one undo step; making them again replaces them.')));
  return out;
}

// ── rail, text ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function airScopeRows(o: GroundGuideOcoka): Array<{ icon: 'avenue' | 'choke' | 'obs'; bold: string; rest: string }> {
  const av = o.ipbApch?.air;
  if (!av) return o.ipbApch === undefined ? [] : [{ icon: 'avenue', bold: 'Air', rest: 'working out…' }];
  const out: Array<{ icon: 'avenue' | 'choke' | 'obs'; bold: string; rest: string }> = [];
  const r = av.routes[0];
  out.push(r ? { icon: 'avenue', bold: `Air ${r.id} → ${r.to}`, rest: `${km(r.lengthM)}${av.observers ? ` · ${pc(r.seenPct)} in view` : ''}` } : { icon: 'avenue', bold: 'No Air Apch', rest: av.notes[0] ?? '' });
  const ad = av.ad[0];
  if (ad) out.push({ icon: 'obs', bold: `${ad.id} sees ${km(ad.seenM)}`, rest: ad.kinds.map((k) => (k === 'long' ? 'long-range' : k)).join(', ') || 'of the air Apchs' });
  return out;
}

export function airText(o: GroundGuideOcoka): string[] {
  const av = o.ipbApch?.air;
  if (!av) return [];
  const L = [`Air (book pp 5-6): ${av.side === 'enemy' ? 'enemy air avenues into own depth' : 'own air avenues to the objective'}, ${av.bandLabel} ${av.bandM[0]}-${av.bandM[1]} m above obstacles (FM 3-04.203, T).`];
  for (const r of av.routes) L.push(`  Air ${r.id} to ${r.to}: ${r.why}.`);
  for (const z of [...av.lzs, ...av.dzs]) L.push(`  ${z.id}: ${z.why}${z.caution.length ? `; ${z.caution.join('; ')}` : ''}${z.op ? `; OP ${km(z.op.distM)} off, ${z.op.riseM} m higher` : ''}.`);
  for (const a of av.ad) L.push(`  ${a.id}: ${a.why}.`);
  for (const n of av.notes) L.push(`  ${n}`);
  L.push('  Flight heights, LZ sizes and AD reach are public US figures: confirm with Army Aviation and AD.');
  return L;
}
