/**
 * GroundGuideIpbApchView.ts
 *
 * The Extended View's tab 3 when the IPB avenues are on (`extended.ipb.apchs`; IPB_Plan.md §5, §6.2; mockup
 * ground-guide-ipb-options.html, tab 3 page 1): the answer strip, the facts, and the tiles
 *   - Gr Overlay, Mob Corridors & Apchs: the area read, north up, the book's coding under the avenues drawn as the MS
 *     attack arrows (the best going solid with the inner line, the others dashed), the corridors inside them, the
 *     narrows, the crossovers, the spot and the threat's side;
 *   - Width Along Each Apch: the free width across each avenue down the area against the doctrine's corridor width (one
 *     and two side by side), the narrows as amber dots;
 *   - Apchs: each avenue as a card (what it is, why it ranks, its narrows), lone corridors, crossovers;
 *   - Read As: the HQ row, the corridor width and spacing with their source, the area, the mover, the coding.
 * Also the rail's line 3 words and the Copy as Text paragraph. DOM nodes and textContent only.
 */

import { fmtDistance } from './GroundGuideEvaluator';
import type { Fact, LetterAnswer } from './GroundGuideDetailSummary';
import { FONT } from './GroundGuideTokens';
import { hPlus } from './GroundGuideIpbDecision';
import { sunAltitude } from './GroundGuideOcoka';
import type { GroundGuideOcoka, IpbApchAa, IpbApchView, IpbDecisionView, MercXY } from './GroundGuideTypes';

const ENEMY = '#ff5a60';
const OWN = '#8ec1ea';
const LONE = '#aab2ba';
const NARROWS = '#ffb02e';
const SHADES_EN = ['#ff5a60', '#ff8a8d', '#ffc3c5', '#e9aab6', '#d98892', '#f0b8a0'];
const SHADES_OWN = ['#8ec1ea', '#b5d8f2', '#d6e9f8', '#9fb7d9', '#7fa6cf', '#c9d8ea'];
const SVGNS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'ms-ground-guide-ipb-apch-style';
const CSS = `
.ms-gia-pic{display:block;border-radius:8px;background:#11161b}
.ms-gia-cards{display:grid;gap:7px}
.ms-gia-card{padding:8px 10px 9px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09)}
.ms-gia-card.ms-main{background:rgba(255,90,96,.08);border-color:rgba(255,90,96,.5)}
.ms-gia-card.ms-own.ms-main{background:rgba(142,193,234,.09);border-color:rgba(142,193,234,.5)}
.ms-gia-h{display:flex;align-items:center;gap:8px;font:750 14.5px/1.3 ${FONT};color:#f1f3f6}
.ms-gia-id{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;padding:0 7px;border-radius:11px;font:800 13px/1 ${FONT};color:#fff}
.ms-gia-tag{margin-left:auto;padding:1px 8px;border-radius:9px;font:700 11.5px/1.5 ${FONT};background:rgba(255,255,255,.09);color:#e6eaee;white-space:nowrap}
.ms-gia-t{font:400 12.5px/1.4 ${FONT};color:#c3cbd3;margin-top:3px}
.ms-gia-chips{display:flex;flex-wrap:wrap;gap:4px 5px;margin-top:5px}
.ms-gia-chip{padding:1px 7px;border-radius:9px;font:650 12px/1.5 ${FONT};background:rgba(255,255,255,.08);color:#e6eaee;white-space:nowrap}
.ms-gia-chip.ms-ok{background:rgba(62,224,122,.15);color:#8ff0b3}
.ms-gia-chip.ms-no{background:rgba(238,138,31,.18);color:#ffc98a}
.ms-gia-nr{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 9px;margin-top:5px;font:400 12.5px/1.4 ${FONT};color:#e6eaee}
.ms-gia-nr>b{color:${NARROWS};font-weight:700}
.ms-gia-key{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font:600 12px/1.4 ${FONT};color:#c3cbd3}
.ms-gia-key i{display:inline-block;width:14px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.ms-gia-acts{display:flex;flex-wrap:wrap;gap:6px}
.ms-gia-btn{padding:5px 11px;border-radius:7px;border:1px solid rgba(142,193,234,.55);background:rgba(142,193,234,.12);color:#e6f1fb;font:650 12.5px/1.3 ${FONT};cursor:pointer}
.ms-gia-btn:hover{background:rgba(142,193,234,.24)}
.ms-gia-btn.ms-all{border-color:#8ec1ea;background:rgba(142,193,234,.28);color:#fff}
table.ms-gia-pf{border-collapse:collapse;font:400 11.5px/1.15 ${FONT};color:#e6eaee}
table.ms-gia-pf th{font-weight:650;color:#c3cbd3;padding:0 1px;text-align:center}
table.ms-gia-pf th.ms-g{border-bottom:1px solid rgba(255,255,255,.18);color:#f1f3f6}
table.ms-gia-pf td{padding:0 1px;text-align:center;border-bottom:1px solid rgba(255,255,255,.06)}
table.ms-gia-pf td.ms-f{text-align:left;white-space:nowrap;padding-right:6px;color:#e8ebee;cursor:help}
table.ms-gia-pf tr.ms-tot td{border-top:1px solid rgba(255,255,255,.2);border-bottom:0;font-weight:750;color:#fff;padding-top:4px}
.ms-sg{width:19px;height:14px;margin:0;padding:0;border-radius:4px;font:800 12px/1 ${FONT};cursor:pointer;background:transparent;border:1px dashed rgba(255,255,255,.35);color:#c3cbd3}
.ms-sg.ms-p{color:#8ff0b3;border-color:rgba(62,224,122,.6)}
.ms-sg.ms-m{color:#ffb0b3;border-color:rgba(255,90,96,.6)}
.ms-sg.ms-u{color:#9aa3ad}
.ms-sg.ms-mine{border-style:solid;background:rgba(255,255,255,.08)}
.ms-gia-wx{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:3px 8px;align-items:center;font:400 12px/1.3 ${FONT};color:#e6eaee}
.ms-gia-wxm>b{font-weight:650;color:#f1f3f6}
.ms-gia-wxm>span{color:#9aa3ad}
.ms-gia-wxv{color:#c3cbd3;text-align:right;white-space:nowrap;font-size:11.5px}
.ms-gia-wxs{padding:1px 7px;border-radius:8px;font:700 11px/1.4 ${FONT};color:#fff;text-align:center;min-width:44px}
table.ms-gia-dt{border-collapse:collapse;width:100%;font:400 12px/1.3 ${FONT};color:#e6eaee}
table.ms-gia-dt th{font-weight:650;color:#c3cbd3;text-align:left;padding:2px 4px;border-bottom:1px solid rgba(255,255,255,.16)}
table.ms-gia-dt td{padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}
table.ms-gia-dt td.ms-dp{font-weight:750;color:#ffd27a;white-space:nowrap}
`;
/** The avenue cards' styles (the air tab shares them). */
export function ensureApchCss(): void {
  ensureCss();
}
function ensureCss(): void {
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
const pc = (v: number): string => `${Math.round(v)}%`;
const km = (m: number): string => (m >= 10000 ? `${Math.round(m / 1000)} km` : fmtDistance(m));

const viableOf = (v: IpbApchView): IpbApchAa[] => v.aas.filter((a) => a.viable);
const loneOf = (v: IpbApchView): IpbApchAa[] => v.aas.filter((a) => !a.viable);
const sideWord = (v: IpbApchView): string => (v.side === 'enemy' ? 'En' : 'Own');
const colourOf = (v: IpbApchView, a: IpbApchAa): string => (!a.viable ? LONE : (v.side === 'enemy' ? SHADES_EN : SHADES_OWN)[Math.max(0, a.rank - 1) % 6]);
const narrowsWord = (n: IpbApchAa['narrows'][number]): string => (n.kind === 'crossing' ? `Br / ford ${fmtDistance(n.widthM)}` : n.kind === 'slow' ? `SLOW-GO ${fmtDistance(n.widthM)}` : `Gap ${fmtDistance(n.widthM)}`);
/** What an avenue is, in a line. */
function aaLine(v: IpbApchView, a: IpbApchAa): string {
  if (a.onto) {
    const room = a.twoPct >= 60 ? (a.open ? `room for 3+ ${v.mcFor} corridors` : `2 ${v.mcFor} corridors side by side`) : a.onePct >= 60 ? `1 ${v.mcFor} corridor: tight` : `narrower than a ${v.mcFor} corridor`;
    if (a.onto === 'turn') return `${room} · ${pc(a.goPct)} GO · ${km(a.lengthM)} round the Obj to ${v.objective?.turn?.label ?? 'the MSR choke'}`;
    return `${room} · ${pc(a.goPct)} GO · ${km(a.lengthM)} to the Obj, FUP ${km(v.objective?.fupM ?? 0)} short${a.assaultNogoPct ? ` · assault ${pc(a.assaultNogoPct)} NO-GO` : ''}`;
  }
  const room = !a.viable ? `1 ${v.mcFor} corridor (lone)` : a.open ? `room for 3+ ${v.mcFor} corridors` : `2 ${v.mcFor} corridors side by side`;
  return `${room} · ${pc(a.goPct)} GO · ${km(a.lengthM)}${a.stopped ? ` · stops ${km(a.endM)} in` : ''}`;
}
/** Its role in a word: the best going (drawn as the main attack), a supporting one, or a lone corridor; onto the Obj, how it comes on. */
function aaRole(a: IpbApchAa): string {
  if (a.onto) return `${a.ontoLabel ?? a.onto}${a.main ? ' · best' : ''}`;
  return !a.viable ? 'lone corridor' : a.main ? 'best going' : 'supporting';
}
/** Where the approaches end, in a line (the Read As row, the answer's sub-line, Copy as Text). */
function endLine(v: IpbApchView): string {
  const o = v.objective;
  if (!o || v.apchEnd === 'through') return "Through the area read (the book's avenues, regardless of objectives; Y for onto the Obj)";
  const size = `${fmtDistance(o.frontageM)} frontage${o.depthM >= 1 ? ` x ${fmtDistance(o.depthM)}` : ''}`;
  return `Onto the Obj, ${o.label}: ${size}${o.assumed ? ' (taken, no echelon)' : ' (by echelon)'}; frontal, Lt and Rt flanking, each from an FUP ${km(o.fupM)} short${o.turn ? `; turning round it to ${o.turn.label}, ${km(o.turn.behindM)} behind` : ''}${o.from ? `, setting out from ${o.source === 'posn' ? 'the Threat marker' : 'your symbol'}` : ''}${v.apchEnd === 'both' ? '; with the avenues through the area' : ''}`;
}

// ── answer, facts ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The answer strip for tab 3 with the IPB avenues on. */
export function apchAnswer(o: GroundGuideOcoka): LetterAnswer {
  const v = o.ipbApch;
  if (!v) return { label: 'Apchs (IPB) over the area read', parts: [{ text: 'Working Out…' }], sub: 'The area round the spot is coded by the book and its corridors traced, once per area.', tone: null, tab: '…' };
  const onto = v.apchEnd !== 'through' && !!v.objective;
  const label = `${sideWord(v)} Apchs ${onto ? `onto ${v.objective!.label}` : `for a ${v.aaFor}`} · ${v.hqLabel}${v.forEch ? ` (your ${v.forEch})` : ''}`;
  const vi = viableOf(v);
  if (!v.aas.length || !vi.length) {
    const lone = loneOf(v);
    return {
      label,
      parts: [{ text: lone.length ? `No Apch, ${lone.length} Lone Corridor${lone.length > 1 ? 's' : ''}` : 'No Apch', tone: v.side === 'enemy' ? 'go' : 'nogo' }],
      sub: v.notes[0] ?? `No two ${v.mcFor} corridors side by side through the area.`,
      tone: v.side === 'enemy' ? 'go' : 'nogo',
      tab: 'None',
    };
  }
  const best = vi[0];
  const parts = [{ text: `${vi.length} Apch${vi.length > 1 ? 's' : ''}`, tone: 'warn' as const }, { text: `${best.id} best going`, small: true }];
  const sub = vi.map((a) => `${a.id}: ${a.open ? '3+' : '2'} corridors, ${pc(a.goPct)} GO${a.narrows.length ? `, narrows ${fmtDistance(a.narrows[0].widthM)}` : ''}`).join('. ') + (loneOf(v).length ? `. ${loneOf(v).map((a) => `${a.id}1`).join(', ')} lone.` : '.');
  return { label, parts, sub, tone: 'warn', tab: `${vi.length} Apch${vi.length > 1 ? 's' : ''}` };
}

export function apchFacts(o: GroundGuideOcoka): Fact[] {
  const v = o.ipbApch;
  if (!v) return [];
  const out: Fact[] = [];
  const all = v.aas.flatMap((a) => a.narrows.map((n) => ({ a, n }))).sort((p, q) => p.n.widthM - q.n.widthM);
  const nar = all[0];
  if (nar) out.push({ k: 'Narrowest', v: fmtDistance(nar.n.widthM), tone: nar.n.widthM < v.mcWidthM / 2 ? 'nogo' : 'slow', sub: `${narrowsWord(nar.n).replace(/ \d.*$/, '')} on ${nar.a.id}, ${km(nar.n.alongM)} in` });
  else if (v.aas.length) out.push({ k: 'Narrowest', v: 'No narrows', tone: v.side === 'enemy' ? 'nogo' : 'go', sub: `${v.mcFor} corridor fits all the way` });
  const cross = all.filter((x) => x.n.kind === 'crossing').length;
  if (v.aas.length) out.push({ k: 'Crossings', v: String(cross), sub: cross ? 'bridges / fords on the Apchs' : 'none on the Apchs' });
  const vi = viableOf(v);
  if (vi.length) out.push({ k: 'Corridors', v: `${vi.reduce((t, a) => t + (a.open ? 3 : 2), 0)}${vi.some((a) => a.open) ? '+' : ''}`, sub: `${v.mcFor}, ${fmtDistance(v.mcWidthM)} each` });
  out.push({ k: 'Area Read', v: `${v.frameKm[0]} x ${v.frameKm[1]} km`, sub: `${v.hqLabel}${v.forEch ? ` for your ${v.forEch}` : ''} · facing ${v.side === 'enemy' ? 'the threat' : 'toward it'}` });
  const lines = Math.max(0, ...v.aas.map((a) => a.waterLines));
  if (lines) out.push({ k: 'Water Lines', v: String(lines), sub: 'crossed; width not recorded' });
  if (v.crossovers.length) out.push({ k: 'Crossover', v: v.crossovers.map((x) => x.id).join(', '), sub: v.crossovers.map((x) => `${x.a}-${x.b}`).join(', ') });
  return out.slice(0, 6);
}

// ── tiles ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The area read, north up: coding, avenues as attack arrows, corridors, narrows, crossovers, the spot and the threat's side. */
function areaPicture(o: GroundGuideOcoka, v: IpbApchView, wpx = 380): SVGSVGElement {
  const pts: MercXY[] = [...v.frame, ...v.aas.flatMap((a) => a.line)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 10;
  const sc = (wpx - 2 * pad) / Math.max(1, x1 - x0);
  const hpx = Math.round(Math.min(420, Math.max(180, (y1 - y0) * sc + 2 * pad)));
  const sc2 = Math.min(sc, (hpx - 2 * pad) / Math.max(1, y1 - y0));
  const ox = (wpx - (x1 - x0) * sc2) / 2, oy = (hpx - (y1 - y0) * sc2) / 2;
  const X = (p: MercXY): number => ox + (p[0] - x0) * sc2;
  const Y = (p: MercXY): number => oy + (y1 - p[1]) * sc2;
  const d = (ps: MercXY[], close = false): string => ps.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)} ${Y(p).toFixed(1)}`).join('') + (close ? 'Z' : '');
  const svg = svgEl('svg', { width: wpx, height: hpx, viewBox: `0 0 ${wpx} ${hpx}`, class: 'ms-gia-pic' }) as SVGSVGElement;
  svgEl('rect', { width: wpx, height: hpx, fill: '#11161b', rx: 8 }, svg);
  if (v.raster) {
    const [rx0, ry0, rx1, ry1] = v.raster.extent;
    svgEl('image', { href: v.raster.url, x: X([rx0, ry1]).toFixed(1), y: Y([rx0, ry1]).toFixed(1), width: ((rx1 - rx0) * sc2).toFixed(1), height: ((ry1 - ry0) * sc2).toFixed(1), preserveAspectRatio: 'none', opacity: 0.9 }, svg);
  }
  if (v.frame.length === 4) svgEl('path', { d: d(v.frame, true), fill: 'none', stroke: '#e9edf1', 'stroke-opacity': 0.55, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, svg);
  for (const a of [...v.aas].reverse()) {
    const col = colourOf(v, a);
    if (!a.viable || !a.arrow.stroke.length) {
      svgEl('path', { d: d(a.line), fill: 'none', stroke: LONE, 'stroke-width': 1.4, 'stroke-dasharray': '5 3' }, svg);
      continue;
    }
    svgEl('path', { d: d(a.arrow.fill, true), fill: col, 'fill-opacity': a.main ? 0.2 : 0.12 }, svg);
    svgEl('path', { d: d(a.arrow.stroke), fill: 'none', stroke: '#0b0d10', 'stroke-width': a.main ? 4 : 3.2, 'stroke-opacity': 0.55, 'stroke-linejoin': 'round' }, svg);
    svgEl('path', { d: d(a.arrow.stroke), fill: 'none', stroke: col, 'stroke-width': a.main ? 2.2 : 1.6, 'stroke-linejoin': 'round', ...(a.main ? {} : { 'stroke-dasharray': '7 4' }) }, svg);
    if (a.arrow.inner.length) svgEl('path', { d: d(a.arrow.inner), fill: 'none', stroke: col, 'stroke-width': 1.6 }, svg);
  }
  for (const m of v.mcs) if (m.aa) svgEl('path', { d: d(m.line), fill: 'none', stroke: '#fff', 'stroke-opacity': 0.75, 'stroke-width': 1, 'stroke-dasharray': '1.5 3.5', 'stroke-linecap': 'round' }, svg);
  for (const x of v.crossovers) svgEl('path', { d: d([x.from, x.to]), fill: 'none', stroke: '#e9edf1', 'stroke-width': 1.5, 'stroke-dasharray': '5 3' }, svg);
  for (const a of v.aas)
    for (const n of a.narrows) {
      const cx = X(n.at), cy = Y(n.at);
      svgEl('path', { d: `M${cx.toFixed(1)} ${(cy - 5).toFixed(1)}L${(cx + 5).toFixed(1)} ${cy.toFixed(1)}L${cx.toFixed(1)} ${(cy + 5).toFixed(1)}L${(cx - 5).toFixed(1)} ${cy.toFixed(1)}Z`, fill: NARROWS, stroke: '#0b0d10', 'stroke-width': 1.2 }, svg);
    }
  // Avenue letters at a third of the way.
  for (const a of v.aas) {
    if (!a.line.length) continue;
    const p = a.line[Math.min(a.line.length - 1, Math.floor(a.line.length * 0.3))];
    const cx = X(p), cy = Y(p);
    const text = a.viable ? a.id : `${a.id}1`;
    const w = text.length * 7 + 14;
    svgEl('rect', { x: (cx - w / 2).toFixed(1), y: (cy - 9).toFixed(1), width: w, height: 18, rx: 9, fill: a.viable ? (v.side === 'enemy' ? '#5a1d22' : '#1d3f66') : '#2a3038', stroke: colourOf(v, a), 'stroke-width': 1.3 }, svg);
    svgEl('text', { x: cx.toFixed(1), y: (cy + 4.2).toFixed(1), 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 800, fill: '#fff', 'font-family': FONT }, svg, text);
  }
  // The spot (the symbol being placed, or the rail's spot) and the threat's side.
  const sx = X(o.at), sy = Y(o.at);
  svgEl('rect', { x: (sx - 5).toFixed(1), y: (sy - 4).toFixed(1), width: 10, height: 8, rx: 1.5, fill: '#1d3f66', stroke: '#8ec1ea', 'stroke-width': 1.5 }, svg);
  if (v.frame.length === 4) {
    const s0 = v.side === 'enemy' ? [v.frame[0], v.frame[1]] : [v.frame[2], v.frame[3]];
    const mid: MercXY = [(s0[0][0] + s0[1][0]) / 2, (s0[0][1] + s0[1][1]) / 2];
    const tx = X(mid), ty = Y(mid);
    svgEl('rect', { x: (tx - 24).toFixed(1), y: (ty - 9).toFixed(1), width: 48, height: 18, rx: 9, fill: '#3a1416', stroke: '#ff6b6f', 'stroke-width': 1.2 }, svg);
    svgEl('text', { x: tx.toFixed(1), y: (ty + 4).toFixed(1), 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 650, fill: '#ffd0d1', 'font-family': FONT }, svg, 'Threat');
  }
  // North and a scale.
  svgEl('text', { x: wpx - 14, y: 18, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, fill: '#fff', 'font-family': FONT }, svg, 'N↑');
  const kmPx = (1000 * Math.cosh(((y0 + y1) / 2) / 6378137)) * sc2;
  const barKm = kmPx * 5 < wpx * 0.4 ? 5 : kmPx * 2 < wpx * 0.4 ? 2 : 1;
  svgEl('path', { d: `M12 ${hpx - 12}h${(barKm * kmPx).toFixed(1)}`, stroke: '#fff', 'stroke-width': 2.2 }, svg);
  svgEl('text', { x: (12 + (barKm * kmPx) / 2).toFixed(1), y: hpx - 17, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#fff', 'font-family': FONT }, svg, `${barKm} km`);
  return svg;
}

/** Free width across each avenue down the area, against one and two corridor widths. */
function widthChart(v: IpbApchView, wpx = 380): SVGSVGElement {
  const H = 214, l = 42, r = 12, t = 14, b = 34;
  const aas = v.aas.filter((a) => a.widthM.length > 1);
  const maxAlong = Math.max(1, ...aas.map((a) => a.alongM[a.alongM.length - 1]), v.frameKm[1] * 1000);
  const top = Math.min(Math.max(3 * v.mcWidthM, ...aas.map((a) => Math.min(a.medianWidthM * 1.3, 4 * v.mcWidthM))), 5 * v.mcWidthM);
  const X = (m: number): number => l + (m / maxAlong) * (wpx - l - r);
  const Y = (w: number): number => t + (1 - Math.min(w, top) / top) * (H - t - b);
  const svg = svgEl('svg', { width: wpx, height: H, viewBox: `0 0 ${wpx} ${H}` }) as SVGSVGElement;
  svgEl('rect', { x: l, y: t, width: wpx - l - r, height: H - t - b, fill: '#171b20', rx: 4 }, svg);
  svgEl('rect', { x: l, y: Y(v.mcWidthM), width: wpx - l - r, height: Y(0) - Y(v.mcWidthM), fill: 'rgba(229,72,77,.08)' }, svg);
  for (const w of [0, v.mcWidthM, 2 * v.mcWidthM, top]) {
    svgEl('path', { d: `M${l} ${Y(w).toFixed(1)}H${wpx - r}`, stroke: 'rgba(255,255,255,.08)' }, svg);
    svgEl('text', { x: l - 5, y: (Y(w) + 4).toFixed(1), 'font-size': 10.5, fill: '#c3cbd3', 'text-anchor': 'end', 'font-family': FONT }, svg, w ? (w >= 1000 ? `${(w / 1000).toFixed(w % 1000 ? 1 : 0)} km` : `${Math.round(w)} m`) : '0');
  }
  svgEl('path', { d: `M${l} ${Y(v.mcWidthM).toFixed(1)}H${wpx - r}`, stroke: OWN, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }, svg);
  svgEl('path', { d: `M${l} ${Y(2 * v.mcWidthM).toFixed(1)}H${wpx - r}`, stroke: OWN, 'stroke-width': 1, 'stroke-dasharray': '2 4', 'stroke-opacity': 0.8 }, svg);
  svgEl('text', { x: l + 5, y: (Y(v.mcWidthM) + 13).toFixed(1), 'font-size': 10.5, fill: '#bfe0ff', 'font-family': FONT }, svg, `${v.mcFor} corridor ${fmtDistance(v.mcWidthM)} · book p 12, ATP T4-2`);
  svgEl('text', { x: l + 5, y: (Y(2 * v.mcWidthM) - 4).toFixed(1), 'font-size': 10.5, fill: '#bfe0ff', 'font-family': FONT }, svg, 'two side by side: an Apch');
  for (const a of [...aas].reverse()) {
    const col = colourOf(v, a);
    const dd = a.alongM.map((m, i) => `${i ? 'L' : 'M'}${X(m).toFixed(1)} ${Y(a.widthM[i]).toFixed(1)}`).join('');
    svgEl('path', { d: dd, fill: 'none', stroke: col, 'stroke-width': a.main ? 2.2 : 1.6, ...(a.viable && !a.main ? { 'stroke-dasharray': '6 3' } : {}), ...(a.viable ? {} : { 'stroke-dasharray': '2 3' }) }, svg);
    for (const n of a.narrows) svgEl('circle', { cx: X(n.alongM).toFixed(1), cy: Y(n.widthM).toFixed(1), r: 3.6, fill: NARROWS, stroke: '#0b0d10', 'stroke-width': 1.2 }, svg);
    svgEl('text', { x: (X(a.alongM[0]) + 4).toFixed(1), y: (Y(a.widthM[0]) - 5).toFixed(1), 'font-size': 11, 'font-weight': 700, fill: col, 'font-family': FONT }, svg, a.viable ? a.id : `${a.id}1`);
  }
  const step = maxAlong > 40000 ? 10000 : maxAlong > 15000 ? 5000 : 2000;
  for (let m = 0; m <= maxAlong; m += step) svgEl('text', { x: X(m).toFixed(1), y: H - b + 15, 'font-size': 10.5, fill: '#c3cbd3', 'text-anchor': 'middle', 'font-family': FONT }, svg, `${m / 1000}`);
  svgEl('text', { x: (l + wpx - r) / 2, y: H - 4, 'font-size': 10.5, fill: '#c3cbd3', 'text-anchor': 'middle', 'font-family': FONT }, svg, `km from the ${v.side === 'enemy' ? "threat's" : 'own'} edge of the area →`);
  return svg;
}

function aaCards(v: IpbApchView): HTMLElement {
  const box = el('div', 'ms-gia-cards ms-ggd-split');
  for (const a of v.aas) {
    const card = el('div', `ms-gia-card${a.main ? ' ms-main' : ''}${v.side === 'own' ? ' ms-own' : ''}`);
    const h = el('div', 'ms-gia-h');
    const id = el('span', 'ms-gia-id', a.viable ? a.id : `${a.id}1`);
    id.style.background = a.viable ? (v.side === 'enemy' ? '#5a1d22' : '#1d3f66') : '#2a3038';
    id.style.border = `1.5px solid ${colourOf(v, a)}`;
    h.append(id, el('span', undefined, a.viable ? `Apch ${a.id}${a.onto ? ` · ${a.ontoLabel ?? a.onto}` : ''}` : `Lone corridor ${a.id}1`), el('span', 'ms-gia-tag', a.onto ? (a.main ? 'best' : a.onto === 'frontal' ? 'frontal' : a.onto === 'turn' ? 'turning' : 'flank') : aaRole(a)));
    card.append(h, el('div', 'ms-gia-t', aaLine(v, a)));
    const chips = el('div', 'ms-gia-chips');
    const chip = (text: string, ok: boolean | null) => chips.append(el('span', `ms-gia-chip${ok === true ? ' ms-ok' : ok === false ? ' ms-no' : ''}`, text));
    if (a.onto) chip(a.onto === 'frontal' ? (v.side === 'own' ? 'frontal: dangerous' : 'frontal: most of your fire') : a.onto === 'turn' ? (v.side === 'own' ? 'turning: blocks his MSR' : 'turning: cuts your MSR') : 'from a flank', a.onto !== 'frontal');
    else chip(a.stopped ? `stops ${pc(a.coverPct)} in` : 'runs the whole area', !a.stopped);
    chip(`median ${km(a.medianWidthM)} wide`, a.medianWidthM >= 2 * v.mcWidthM);
    chip(a.narrows.length ? `${a.narrows.length} narrows` : 'no narrows', a.narrows.length === 0);
    if (a.waterLines) chip(`${a.waterLines} water line${a.waterLines > 1 ? 's' : ''}`, null);
    card.append(chips);
    if (a.narrows.length) {
      const nr = el('div', 'ms-gia-nr');
      for (const n of a.narrows.slice(0, 4)) nr.append(el('b', undefined, narrowsWord(n)), el('span', undefined, `${km(n.alongM)} in${n.widthM < v.mcWidthM / 2 ? ' · under half a corridor' : ''}`));
      card.append(nr);
    }
    box.append(card);
  }
  if (v.crossovers.length) box.append(note(`Crossover ${v.crossovers.map((x) => `${x.id}: ${x.a} to ${x.b}, ${km(x.alongM)} in (joined ${km(x.depthM)})`).join('; ')}.`));
  return box;
}

/** The tiles of tab 3 with the IPB avenues on (the straight ways out follow from the Extended View itself). */
export function apchTiles(o: GroundGuideOcoka): HTMLElement[] {
  ensureCss();
  const v = o.ipbApch;
  if (!v) return [tile('Apchs (IPB)', note('Working out the corridors and avenues over the area round the spot: the area is coded by the book first, once per area.'))];
  const out: HTMLElement[] = [];
  if (v.aas.length) {
    const key = el('div', 'ms-gia-key');
    const k = (style: string, text: string) => {
      const s = el('span');
      const i = el('i');
      i.setAttribute('style', style);
      s.append(i, text);
      key.append(s);
    };
    k('background:repeating-linear-gradient(45deg,#ff8a8d 0 1.5px,rgba(185,43,49,.45) 1.5px 5px)', 'NO-GO');
    k('background:repeating-linear-gradient(45deg,#ffb46b 0 1.5px,rgba(238,138,31,.2) 1.5px 5px)', 'SLOW-GO');
    k(`background:${v.side === 'enemy' ? 'rgba(255,90,96,.45)' : 'rgba(142,193,234,.45)'};border:1px solid ${v.side === 'enemy' ? ENEMY : OWN}`, 'Apch');
    k('border-top:2px dotted #fff;height:0;width:16px', 'corridor');
    k(`background:${NARROWS};transform:rotate(45deg);width:9px;height:9px`, 'narrows');
    out.push(tile(`Gr Overlay, Mob Corridors & Apchs · ${v.frameKm[0]} x ${v.frameKm[1]} km`, areaPicture(o, v), key));
    out.push(tile('Width Along Each Apch', widthChart(v), note(`Under the blue line a ${v.mcFor} cannot pass deployed; above the dotted one two corridors fit side by side. Amber dots: narrows.`)));
    const ontoOn = v.apchEnd !== 'through' && !!v.objective;
    const cards = tile(
      ontoOn ? `Apchs · ${viableOf(v).length} onto ${v.objective!.label}` : `Apchs · ${viableOf(v).length} for a ${v.aaFor}${loneOf(v).length ? ` · ${loneOf(v).length} lone` : ''}`,
      aaCards(v),
      note(
        ontoOn
          ? `Each ends on the Obj's frontage (${fmtDistance(v.objective!.frontageM)} by echelon), not its middle, from an FUP ${km(v.objective!.fupM)} short (IBB pp 173-174). Flanks first, then the going and cost (a proposal): a frontal attack is dangerous with a small chance of success (OoW Vol II s6). Y for the avenues through the area.`
          : 'Ranked on the going until the proforma: how far through the area, GO, room, narrows, cost (a proposal). The commander judges the most likely and most dangerous.',
      ),
    );
    cards.classList.add('ms-ggd-brk');
    out.push(cards);
    const pf = proformaTile(v);
    if (pf) out.push(pf);
    else if (v.proforma === null) out.push(tile('Proforma · Relative Merits of Apchs', note('Being worked out.')));
    out.push(createTile(v));
  } else out.push(tile('Apchs (IPB)', note(v.notes.join(' ') || 'No corridor through the area.')));
  const wxm = wxTile(v, 'mnvr');
  if (wxm) out.push(wxm);
  const rows: Array<[string, string]> = [
    ['Whose', v.side === 'enemy' ? "The en's options against you (X for yours)" : "Your options against the threat (X for the en's)"],
    ['Apchs end', endLine(v)],
    ['Read as', `${v.hqLabel}${v.forEch ? ` for your ${v.forEch}` : ''}: ${v.aaFor} Apchs of ${v.mcFor} corridors (book p 7)`],
    ['Corridor', `${fmtDistance(v.mcWidthM)} wide; corridors of one Apch at most ${km(v.spacingM)} apart (book p 12, ATP T4-2)`],
    ['Area', `${v.frameKm[0]} x ${v.frameKm[1]} km facing the threat${v.threatAssumed ? ' (a direction only: drag the Threat marker for a place)' : ''}`],
    ['Mover', `${v.mover === 'armour' ? 'Armour' : v.mover === 'mech' ? 'Mechanized' : 'Dismounted'}, moving ${Math.round(v.axisDeg)}°`],
    ['Coding', v.codingText.replace(/^IPB coding \([^)]*\):\s*/, '')],
  ];
  if (v.hqNote) rows.push(['Note', v.hqNote]);
  const list = el('div', 'ms-gx-list');
  for (const [a, b] of rows) list.append(el('div', undefined, a), el('div', undefined, b));
  out.push(tile('Read As', list, note('NO-GO does not mean impassable; the coding is for movement deployed, not along roads (book). Check on the ground.')));
  return out;
}

/**
 * Create on Map (IPB_Plan.md §6.8): the coding, the corridors and the avenues as ordinary symbols. Each button sends a
 * `ms-gg-ipb-create` event up through the card; the Ground Guide that owns the card makes the symbols.
 */
function createTile(v: IpbApchView): HTMLElement {
  const acts = el('div', 'ms-gia-acts');
  const btn = (kind: 'coo' | 'corridors' | 'apchs' | 'all', text: string, title: string): void => {
    const b = el('button', kind === 'all' ? 'ms-gia-btn ms-all' : 'ms-gia-btn', text) as HTMLButtonElement;
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      b.dispatchEvent(new CustomEvent('ms-gg-ipb-create', { bubbles: true, detail: { kind } }));
    });
    acts.append(b);
  };
  const side = v.side === 'enemy' ? 'En' : 'Own';
  btn('coo', 'COO', 'NO-GO and SLOW-GO areas of the area read (No Go Area, Slow Go Area)');
  btn('corridors', 'Mob Corridors', `The ${v.mcFor} corridors (Mob Corridors, ${v.mcFor} echelon)`);
  btn('apchs', `${side} Apchs`, `The avenues as attack arrows (Main Attk for the best going, Sp Attk for the others)`);
  btn('all', 'All three', 'COO, corridors and avenues together');
  return tile('Create on Map', acts, note('Ordinary symbols: saved with the plan, exported, edited like any other. Making one again replaces it; Ctrl+Z undoes it in one step.'));
}

// ── fire on the avenues (tab 1) ─────────────────────────────────────────────────────────────────────────────────────

const FIRE_COL: Record<'c' | 's' | 'd' | 'o', string> = { c: '#2fa862', d: '#e5484d', s: '#ee8a1f', o: '#2a3038' };
const FIRE_WORD: Record<'c' | 's' | 'd' | 'o', string> = { c: 'under fire', d: 'dead Gr', s: 'screened', o: 'out of range' };
const posnWord = (v: IpbApchView): string => (v.fire?.posnSide === 'enemy' ? 'en' : 'own');

/** The fire facts for tab 1: how much of each avenue is under fire. */
export function fireFacts(o: GroundGuideOcoka): Fact[] {
  const v = o.ipbApch;
  const f = v?.fire;
  if (!v || !f) return [];
  if (!f.posns.length) return [{ k: 'Apchs Under Fire', v: 'No Posns', sub: `no ${posnWord(v)} Posns in the area read` }];
  const vi = f.lines.filter((l) => v.aas.find((a) => a.id === l.id)?.viable);
  if (!vi.length) return [];
  const worst = [...vi].sort((p, q) => p.coveredPct - q.coveredPct)[0];
  // Every avenue wholly out of range: say how near the nearest Posn comes and how far it reaches.
  const allOut = vi.every((l) => l.outPct >= 99.5);
  const near = allOut ? [...vi].filter((l) => l.nearestM != null).sort((p, q) => p.nearestM! - q.nearestM!)[0] : null;
  const np = near && near.nearestPosn != null ? f.posns[near.nearestPosn] : null;
  const sub = near && np ? `out of reach: ${np.label} ${fmtDistance(np.effM)}, nearest Apch ${near.id} ${fmtDistance(near.nearestM!)} away` : `from ${f.posns.length} ${posnWord(v)} Posn${f.posns.length > 1 ? 's' : ''}`;
  return [{ k: 'Apchs Under Fire', v: vi.map((l) => `${l.id} ${Math.round(l.coveredPct)}%`).join(' · '), tone: worst.coveredPct < 30 ? 'nogo' : worst.coveredPct < 60 ? 'slow' : 'go', sub }];
}

/**
 * Why an avenue lies wholly out of range: the nearest Posn, how far it reaches and how near the avenue passes (user,
 * 2026-11-14: "Coverage Along Each Apch is always out of range? is it a bug?"). Null when any of it is in range.
 */
function outOfReach(f: NonNullable<IpbApchView['fire']>, L: NonNullable<IpbApchView['fire']>['lines'][number]): string | null {
  if (L.outPct < 99.5 || L.nearestM == null || L.nearestPosn == null) return null;
  const p = f.posns[L.nearestPosn];
  return p ? `out of range: ${fmtDistance(L.nearestM)} from ${p.label}, reach ${fmtDistance(p.effM)}` : null;
}

/** Coverage along each avenue: a ribbon per avenue, coloured by fire along it, with its worst gap named. */
function fireRibbons(v: IpbApchView, wpx = 360): SVGSVGElement {
  const f = v.fire!;
  const lines = f.lines.filter((l) => l.segs.length);
  const row = 44, l = 78, r = 10;
  const maxAlong = Math.max(1, ...lines.map((x) => x.endM));
  const X = (m: number): number => l + (m / maxAlong) * (wpx - l - r);
  const H = lines.length * row + 30;
  const svg = svgEl('svg', { width: wpx, height: H, viewBox: `0 0 ${wpx} ${H}` }) as SVGSVGElement;
  lines.forEach((L, i) => {
    const y = 8 + i * row;
    const aa = v.aas.find((a) => a.id === L.id);
    svgEl('text', { x: 0, y: y + 13, 'font-size': 12.5, 'font-weight': 750, fill: '#fff', 'font-family': FONT }, svg, aa?.viable ? `Apch ${L.id}` : `${L.id}1 lone`);
    svgEl('text', { x: 0, y: y + 28, 'font-size': 11, fill: '#c3cbd3', 'font-family': FONT }, svg, `${Math.round(L.coveredPct)}% under fire`);
    for (const sg of L.segs) {
      const x0 = X(sg.fromM), x1 = Math.max(x0 + 1, X(sg.toM + 100));
      svgEl('rect', { x: x0.toFixed(1), y: y + 3, width: (x1 - x0).toFixed(1), height: 17, rx: 2, fill: FIRE_COL[sg.state], 'fill-opacity': sg.state === 'o' ? 1 : 0.85 }, svg);
    }
    const g = [...L.gaps].sort((p, q) => (p.kind === 'd' ? -1 : 0) - (q.kind === 'd' ? -1 : 0) || q.toM - q.fromM - (p.toM - p.fromM))[0];
    const why = outOfReach(f, L);
    if (why) svgEl('text', { x: l, y: y + 34, 'font-size': 10.5, fill: '#c3cbd3', 'font-family': FONT }, svg, why);
    else if (g) svgEl('text', { x: ((X(g.fromM) + X(g.toM)) / 2).toFixed(1), y: y + 34, 'font-size': 10.5, fill: g.kind === 'd' ? '#ff8a8d' : g.kind === 's' ? '#ffc98a' : '#9aa3ad', 'text-anchor': 'middle', 'font-family': FONT }, svg, `${FIRE_WORD[g.kind]} ${km(g.fromM)}–${km(g.toM)}`);
  });
  const step = maxAlong > 30000 ? 10000 : maxAlong > 12000 ? 5000 : 2000;
  for (let m = 0; m <= maxAlong; m += step) svgEl('text', { x: X(m).toFixed(1), y: H - 6, 'font-size': 10.5, fill: '#9aa3ad', 'text-anchor': 'middle', 'font-family': FONT }, svg, `${m / 1000}`);
  return svg;
}

/** The area with the avenues coloured by fire, the Posns' ranges and the killing area candidates, north up. */
function firePicture(o: GroundGuideOcoka, v: IpbApchView, wpx = 380): SVGSVGElement {
  const f = v.fire!;
  const pts: MercXY[] = [...v.frame, ...f.posns.map((p) => p.at)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 10;
  const sc0 = (wpx - 2 * pad) / Math.max(1, x1 - x0);
  const hpx = Math.round(Math.min(420, Math.max(180, (y1 - y0) * sc0 + 2 * pad)));
  const sc = Math.min(sc0, (hpx - 2 * pad) / Math.max(1, y1 - y0));
  const ox = (wpx - (x1 - x0) * sc) / 2, oy = (hpx - (y1 - y0) * sc) / 2;
  const X = (p: MercXY): number => ox + (p[0] - x0) * sc;
  const Y = (p: MercXY): number => oy + (y1 - p[1]) * sc;
  const d = (ps: MercXY[], close = false): string => ps.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)} ${Y(p).toFixed(1)}`).join('') + (close ? 'Z' : '');
  const svg = svgEl('svg', { width: wpx, height: hpx, viewBox: `0 0 ${wpx} ${hpx}`, class: 'ms-gia-pic' }) as SVGSVGElement;
  svgEl('rect', { width: wpx, height: hpx, fill: '#11161b', rx: 8 }, svg);
  if (v.raster) {
    const [rx0, ry0, rx1, ry1] = v.raster.extent;
    svgEl('image', { href: v.raster.url, x: X([rx0, ry1]).toFixed(1), y: Y([rx0, ry1]).toFixed(1), width: ((rx1 - rx0) * sc).toFixed(1), height: ((ry1 - ry0) * sc).toFixed(1), preserveAspectRatio: 'none', opacity: 0.55 }, svg);
  }
  if (v.frame.length === 4) svgEl('path', { d: d(v.frame, true), fill: 'none', stroke: '#e9edf1', 'stroke-opacity': 0.5, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, svg);
  const kpx = Math.cosh(((y0 + y1) / 2) / 6378137) * sc;
  for (const p of f.posns) svgEl('circle', { cx: X(p.at).toFixed(1), cy: Y(p.at).toFixed(1), r: (p.effM * kpx).toFixed(1), fill: '#ffd23f', 'fill-opacity': 0.05, stroke: '#ffd23f', 'stroke-opacity': 0.7, 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
  for (const L of f.lines)
    for (const sg of L.segs) {
      if (sg.line.length < 2) continue;
      svgEl('path', { d: d(sg.line), fill: 'none', stroke: '#0b0d10', 'stroke-width': 6, 'stroke-opacity': 0.6, 'stroke-linecap': 'round' }, svg);
      svgEl('path', { d: d(sg.line), fill: 'none', stroke: FIRE_COL[sg.state] === '#2a3038' ? '#5d6772' : FIRE_COL[sg.state], 'stroke-width': 3.6, 'stroke-linecap': 'round' }, svg);
    }
  for (const p of f.posns) {
    const cx = X(p.at), cy = Y(p.at);
    svgEl('rect', { x: (cx - 5).toFixed(1), y: (cy - 4).toFixed(1), width: 10, height: 8, rx: 1.5, fill: p.spot ? '#1d3f66' : '#2a3038', stroke: posnWord(v) === 'own' ? '#8ec1ea' : '#ff6b6f', 'stroke-width': 1.5 }, svg);
  }
  f.killing.forEach((k, i) => {
    const cx = X(k.at), cy = Y(k.at);
    svgEl('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: 8, fill: '#14181d', stroke: '#8ec1ea', 'stroke-width': 1.6 }, svg);
    svgEl('text', { x: cx.toFixed(1), y: (cy + 3.6).toFixed(1), 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 800, fill: '#cfe7fb', 'font-family': FONT }, svg, `${i + 1}`);
  });
  for (const a of v.aas) {
    if (!a.line.length) continue;
    const p = a.line[Math.min(a.line.length - 1, Math.floor(a.line.length * 0.15))];
    svgEl('text', { x: X(p).toFixed(1), y: (Y(p) - 7).toFixed(1), 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 800, fill: '#fff', stroke: '#0b0d10', 'stroke-width': 2.6, 'paint-order': 'stroke', 'font-family': FONT }, svg, a.viable ? a.id : `${a.id}1`);
  }
  svgEl('text', { x: wpx - 14, y: 18, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, fill: '#fff', 'font-family': FONT }, svg, 'N↑');
  void o;
  return svg;
}

/** Tab 1's tiles for the fire on the avenues (they come first; the Posn's own tiles follow). */
export function fireTiles(o: GroundGuideOcoka): HTMLElement[] {
  ensureCss();
  const v = o.ipbApch;
  const f = v?.fire;
  if (!v || !f) return [];
  const side = posnWord(v);
  if (!f.posns.length)
    return [tile('Fire on the Apchs', note(`No ${side} Posns in the area read (${v.frameKm[0]} x ${v.frameKm[1]} km): place them, or place this symbol, and the fire on each avenue, its gaps and the killing areas follow.`))];
  const out: HTMLElement[] = [];
  const key = el('div', 'ms-gia-key');
  for (const st of ['c', 'd', 's', 'o'] as const) {
    const s2 = el('span');
    const i = el('i');
    i.style.background = st === 'o' ? '#5d6772' : FIRE_COL[st];
    s2.append(i, FIRE_WORD[st]);
    key.append(s2);
  }
  out.push(tile(`Fire Corridors & Killing Areas · ${f.posns.length} ${side} Posn${f.posns.length > 1 ? 's' : ''}`, firePicture(o, v), key));
  const lone = f.posns.length === 1 && f.posns[0].spot;
  const allOut = f.lines.every((l) => l.outPct >= 99.5);
  const why = allOut
    ? `Out of range all along: ${lone ? `the only ${side} Posn is this symbol` : `the ${side} Posns do not reach`}${f.posns.some((p) => p.assumed) ? ' (no range in the catalogue for it: small arms, 300 m)' : ''}. ${side === 'own' ? 'Place own Posns, ATGMs and tanks along the Apchs' : 'Place the en Posns you know of'} and the fire on each Apch follows. `
    : '';
  out.push(tile('Coverage Along Each Apch', fireRibbons(v), note(`${why}A gap is where to put mines, a DF task or an OP. Under fire: inside a weapon's effective range with an even chance or better of being seen.`)));
  const list = el('div', 'ms-gx-list');
  f.killing.forEach((k, i) => list.append(el('div', undefined, `${i + 1} · ${k.on}`), el('div', undefined, `${k.text}, ${km(k.alongM)} in`)));
  if (!f.killing.length) list.append(el('div', undefined, 'None'), el('div', undefined, 'No narrows under fire and no km under fire on any avenue'));
  const ka = tile('Killing Area Candidates', list, note('Where an avenue narrows under observed fire, or runs a km or more under it (OoW Vol I pp 42-45). Obstacles must not mask own fire or block own counter-attack routes. The commander designates engagement areas.'));
  out.push(ka);
  const wxf = wxTile(v, 'fire');
  if (wxf) out.push(wxf);
  return out;
}

/** The rail's line 1 words for the fire on the avenues. */
export function fireScopeRows(o: GroundGuideOcoka): Array<{ icon: 'fan' | 'dead'; bold: string; rest: string }> {
  const v = o.ipbApch;
  const f = v?.fire;
  if (!v || !f || !f.posns.length) return [];
  const vi = f.lines.filter((l) => v.aas.find((a) => a.id === l.id)?.viable);
  if (!vi.length) return [];
  const worst = [...vi].sort((p, q) => p.coveredPct - q.coveredPct)[0];
  const g = worst.gaps.find((q) => q.kind === 'd') ?? worst.gaps[0];
  return [{ icon: g?.kind === 'd' ? 'dead' : 'fan', bold: `Apch ${worst.id} ${Math.round(worst.coveredPct)}% under fire`, rest: g ? `${FIRE_WORD[g.kind]} ${km(g.fromM)}–${km(g.toM)}` : 'no gap' }];
}

/** The Copy as Text lines for the fire on the avenues. */
export function fireText(o: GroundGuideOcoka): string[] {
  const v = o.ipbApch;
  const f = v?.fire;
  if (!v || !f) return [];
  if (!f.posns.length) return [`Fire on the avenues: no ${posnWord(v)} Posns in the area read.`];
  const L = [`Fire on the ${v.side === 'enemy' ? 'enemy' : 'own'} avenues from ${f.posns.length} ${posnWord(v)} Posn${f.posns.length > 1 ? 's' : ''} (effective ranges from the catalogue; sight a chance from 30 m elevation and the map):`];
  for (const l of f.lines) {
    const why = outOfReach(f, l);
    L.push(`  ${l.id}: ${why ? `${why}.` : `${Math.round(l.coveredPct)}% under fire, ${Math.round(l.deadPct)}% dead, ${Math.round(l.screenedPct)}% screened, ${Math.round(l.outPct)}% out of range;`} may be watched ${Math.round(l.seenPct)}%.${!why && l.gaps.length ? ` Gaps: ${l.gaps.map((g) => `${FIRE_WORD[g.kind]} ${km(g.fromM)}-${km(g.toM)}`).join(', ')}.` : ''}`);
  }
  if (f.killing.length) L.push(`  Killing area candidates: ${f.killing.map((k, i) => `${i + 1} on ${k.on}: ${k.text}, ${km(k.alongM)} in`).join('; ')}.`);
  return L;
}

// ── proforma (tab 3) ────────────────────────────────────────────────────────────────────────────────────────────────

/** The proforma for the relative merits of avenues (book p 21): two groups, signs suggested from the reading, yours on a click. */
function proformaTile(v: IpbApchView): HTMLElement | null {
  const p = v.proforma;
  if (!p || !p.groups.length) return null;
  const t = el('table', 'ms-gia-pf');
  const h1 = el('tr');
  h1.append(el('th'));
  p.groups.forEach((g) => {
    const th = el('th', 'ms-g', g.head);
    th.setAttribute('colspan', String(Math.max(1, g.ids.length)));
    th.title = g.side === 'enemy' ? "The enemy's avenues" : 'Own avenues';
    h1.append(th);
  });
  if (p.pending) h1.append(el('th', 'ms-g', p.groups.length < 2 ? (v.side === 'enemy' ? 'Own: …' : 'En: …') : ''));
  t.append(h1);
  const h2 = el('tr');
  h2.append(el('th'));
  p.groups.forEach((g) => g.ids.forEach((id) => h2.append(el('th', undefined, id))));
  t.append(h2);
  for (const r of p.rows) {
    const tr = el('tr');
    const lab = el('td', 'ms-f', r.short);
    lab.title = `${r.label}: ${r.basis}`;
    tr.append(lab);
    r.cells.forEach((cells, gi) =>
      cells.forEach((c) => {
        const td = el('td');
        const b = el('button', `ms-sg ${c.sign === '+' ? 'ms-p' : c.sign === '−' ? 'ms-m' : 'ms-u'}${c.user ? ' ms-mine' : ''}`, c.sign) as HTMLButtonElement;
        b.type = 'button';
        b.title = `${c.value}${c.user ? ' · your sign' : c.suggested !== '?' ? ' · suggested' : ''} · click to change`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          b.dispatchEvent(new CustomEvent('ms-gg-ipb-pf', { bubbles: true, detail: { g: gi, id: c.id, row: r.key } }));
        });
        td.append(b);
        tr.append(td);
      }),
    );
    t.append(tr);
  }
  const tot = el('tr', 'ms-tot');
  tot.append(el('td', 'ms-f', 'Total'));
  p.totals.forEach((ts) => ts.forEach((x) => tot.append(el('td', undefined, x > 0 ? `+${x}` : String(x)))));
  t.append(tot);
  const lead = p.groups.map((g, i) => (p.lead[i] ? `${g.head}: ${p.lead[i]!.id} (+${p.lead[i]!.total})` : null)).filter(Boolean).join(' · ');
  const box = el('div');
  box.append(t);
  // The key goes on the caption's hover: the table must fit the band with its totals.
  const sec = tile(`Proforma · Relative Merits${lead ? ` · ${lead}` : ''}`, box);
  (sec.firstElementChild as HTMLElement).title = `Dashed: suggested from the reading (at or better than the group's median: +) · solid: yours (click: +, −, ?, back) · ?: you judge · hover a row or a sign for what was measured. ${p.note}`;
  return sec;
}

/** The Copy as Text lines for the proforma. */
export function proformaText(o: GroundGuideOcoka): string[] {
  const p = o.ipbApch?.proforma;
  if (!p || !p.groups.length) return [];
  const L = ['Proforma for the relative merits of avenues (book p 21):'];
  p.groups.forEach((g, gi) => {
    L.push(`  ${g.head} (${g.side === 'enemy' ? "the enemy's" : 'own'} avenues ${g.ids.join(', ')}):`);
    for (const r of p.rows) L.push(`    ${r.label}: ${r.cells[gi].map((c) => `${c.id} ${c.sign}${c.user ? '' : c.sign === '?' ? '' : ' (sug)'} [${c.value || '-'}]`).join(', ')}`);
    L.push(`    Total: ${g.ids.map((id, k) => `${id} ${p.totals[gi][k] > 0 ? '+' : ''}${p.totals[gi][k]}`).join(', ')}${p.lead[gi] ? `; ${p.lead[gi]!.id} leads` : ''}.`);
  });
  L.push(`  ${p.note}`);
  return L;
}

// ── weather (Annex A) ───────────────────────────────────────────────────────────────────────────────────────────────

const WX_COL: Record<'go' | 'marg' | 'unfav' | 'met' | 'na', string> = { go: '#2fa862', marg: '#e8c547', unfav: '#e5484d', met: '#5d6772', na: '#3a4048' };
const WX_WORD: Record<'go' | 'marg' | 'unfav' | 'met' | 'na', string> = { go: 'GO', marg: 'Marginal', unfav: 'Unfav', met: 'Met', na: 'n.a.' };
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Annex A rows for one use: fire (anti-tank, fire support, recce) or manoeuvre (tracked, dismounted, NBC). */
export function wxTile(v: IpbApchView | null | undefined, use: 'fire' | 'mnvr' | 'air'): HTMLElement | null {
  ensureCss();
  const w = v?.wx;
  if (!w) return null;
  const re = use === 'fire' ? /weapon positioning|Fire Sp|Int \(/ : use === 'air' ? /^Airborne$|^Avn|^AD$/ : /Mnvr - mob|NBC/;
  const rows = w.rows.filter((r) => re.test(r.mission));
  if (!rows.length) return null;
  const g = el('div', 'ms-gia-wx');
  for (const r of rows) {
    const m = el('div', 'ms-gia-wxm');
    m.append(el('b', undefined, r.mission.replace(/^Mnvr - /, '').replace(/^Fire Sp /, 'Fire Sp ')), el('span', undefined, ` · ${r.element}`));
    m.title = `GO ${r.go} · marginal ${r.marginal}`;
    const chip = el('span', 'ms-gia-wxs', WX_WORD[r.status]);
    chip.style.background = WX_COL[r.status];
    if (r.status === 'marg') chip.style.color = '#14181d';
    g.append(m, el('span', 'ms-gia-wxv', r.value), chip);
  }
  return tile(
    `Wx for ${use === 'fire' ? 'Fire' : use === 'air' ? 'Air' : 'Mnvr'} · ${MONTH[w.month - 1]}`,
    g,
    note(`Annex A (book pp 19-20) from the month's means: visibility from the nearest stations${w.stationKm != null ? ` (${Math.round(w.stationKm)} km off${w.stationKm > 100 ? ': a guess' : ''})` : ''}, temperature and wind from WorldClim. Daily means, not the hour. Ceiling, cloud, humidity and stability: get from Met.`),
  );
}

// ── decision (tab 5) ────────────────────────────────────────────────────────────────────────────────────────────────

const whereDp = (d: IpbDecisionView['dps'][number]): string => (d.beforeH ? 'before H, on the plan' : d.inArea ? `on ${d.aa} in the area` : `on ${d.aa}, ${km(d.beyondM)} beyond the area`);
const clock = (dv: IpbDecisionView, h: number): string => {
  if (!dv.hHour) return hPlus(h);
  const [hh, mm] = dv.hHour.split(':').map(Number);
  const t = (((hh * 60 + mm + Math.round(h * 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}${String(t % 60).padStart(2, '0')} (${hPlus(h)})`;
};

export function decisionAnswer(o: GroundGuideOcoka): LetterAnswer {
  const v = o.ipbApch;
  const dv = v?.decision;
  if (!v || !dv) return { label: 'Decision support over the area read', parts: [{ text: v === undefined ? 'Apchs Off' : 'Working Out…' }], sub: 'NAIs, TAIs and decision points follow the avenues.', tone: null, tab: '…' };
  if (v.side !== 'enemy') {
    const best = [...dv.profiles].filter((p) => p.viable).sort((p, q) => p.endH[0] - q.endH[0])[0];
    return { label: 'Time over own Apchs · IPB', parts: [{ text: best ? `${best.aa} ${hPlus(best.endH[0])}` : 'None' }, { text: 'to cross the area', small: true }], sub: dv.notes[0] ?? null, tone: null, tab: best ? hPlus(best.endH[0]) : 'None' };
  }
  const d = dv.dps[0];
  const t = dv.tais[0];
  if (!d) return { label: `Decisions for the en Apchs · ${dv.fromThreat ? 'from the Threat marker' : "from the area's edge"}`, parts: [{ text: 'No DP', tone: null }], sub: dv.notes[0] ?? 'No TAI on the avenues.', tone: null, tab: 'No DP' };
  return {
    label: `Decisions for the en Apchs · ${dv.fromThreat ? 'from the Threat marker' : "from the area's edge"}`,
    parts: [{ text: `${d.id} ${clock(dv, d.earliestH)}`, tone: 'warn' }, { text: whereDp(d), small: true }],
    sub: t ? `${t.id} on ${t.aa}: ${t.why.split(':')[0]}; en there ${hPlus(t.earliestH)} at the earliest, ${hPlus(t.latestH)} at the latest.` : (dv.notes[0] ?? null),
    tone: 'warn',
    tab: `${dv.dps.length} DP${dv.dps.length > 1 ? 's' : ''}`,
  };
}

export function decisionFacts(o: GroundGuideOcoka): Fact[] {
  const dv = o.ipbApch?.decision;
  if (!dv) return [];
  const out: Fact[] = [];
  for (const t of dv.tais.slice(0, 2)) out.push({ k: t.id, v: hPlus(t.earliestH), sub: `${t.why.split(':')[0]} on ${t.aa}` });
  const c = dv.dps.find((d) => d.kind === 'catk');
  if (c) out.push({ k: `${c.id} · CATK`, v: hPlus(c.earliestH), tone: 'warn', sub: `${dv.catk?.label} ${dv.catk?.min} min before the depth` });
  out.push({ k: 'NAIs', v: String(dv.nais.length), sub: 'entries, narrows, crossings, crossovers' });
  out.push({ k: 'Rates', v: `${dv.rates.go[0]} / ${dv.rates.slow[0]} km/h`, sub: `GO / SLOW-GO by day (book p 18), ${dv.rates.mover}` });
  out.push({ k: 'Times From', v: dv.fromThreat ? 'Threat marker' : "Area's edge", sub: dv.hHour ? `H ${dv.hHour}` : 'as H+' });
  return out.slice(0, 6);
}

/** The time ladder: each avenue's earliest (solid) and latest (dashed) times down its length; NAIs, TAIs, DPs on it. */
function timeLadder(v: IpbApchView, dv: IpbDecisionView, wpx = 420): SVGSVGElement {
  const H = 250, l = 46, r = 14, t = 14, b = 34;
  const tMin = Math.min(0, ...dv.dps.map((d) => d.earliestH));
  const tMax = Math.max(0.5, ...dv.profiles.map((p) => p.endH[1]));
  const aMin = Math.min(...dv.profiles.map((p) => p.pts[0]?.[0] ?? 0), ...dv.dps.map((d) => d.alongM));
  const aMax = Math.max(...dv.profiles.map((p) => p.pts[p.pts.length - 1]?.[0] ?? 1));
  const X = (h: number): number => l + ((h - tMin) / Math.max(0.1, tMax - tMin)) * (wpx - l - r);
  const Y = (m: number): number => t + ((m - aMin) / Math.max(1, aMax - aMin)) * (H - t - b);
  const svg = svgEl('svg', { width: wpx, height: H, viewBox: `0 0 ${wpx} ${H}` }) as SVGSVGElement;
  svgEl('rect', { x: l, y: t, width: wpx - l - r, height: H - t - b, fill: '#171b20', rx: 4 }, svg);
  // Night columns when H hour is set (sun 6° or more below the horizon at the area's middle, today).
  if (dv.hHour && v.frame.length) {
    const xs = v.frame.map((p) => p[0]), ys = v.frame.map((p) => p[1]);
    const lon = (((Math.min(...xs) + Math.max(...xs)) / 2) / 20037508.34) * 180;
    const lat = (Math.atan(Math.sinh((((Math.min(...ys) + Math.max(...ys)) / 2) / 20037508.34) * Math.PI)) * 180) / Math.PI;
    const [hh, mm] = dv.hHour.split(':').map(Number);
    const d0 = new Date();
    d0.setHours(hh, mm, 0, 0);
    for (let h = tMin; h < tMax; h += 0.25) {
      const alt = sunAltitude(new Date(d0.getTime() + h * 3600e3), lat, lon);
      if (alt < -6) svgEl('rect', { x: X(h).toFixed(1), y: t, width: Math.max(1, X(h + 0.25) - X(h)).toFixed(1), height: H - t - b, fill: '#4b5d8f', 'fill-opacity': 0.18 }, svg);
    }
  }
  // The area read: where the avenues lie (below their starts).
  const a0 = Math.min(...v.aas.map((a) => a.startM)), a1 = Math.max(...v.aas.map((a) => a.endM));
  svgEl('rect', { x: l, y: Y(a0).toFixed(1), width: wpx - l - r, height: Math.max(1, Y(a1) - Y(a0)).toFixed(1), fill: 'rgba(142,193,234,.05)' }, svg);
  svgEl('text', { x: wpx - r - 4, y: (Y(a0) + 12).toFixed(1), 'font-size': 10.5, fill: '#9fc3e0', 'text-anchor': 'end', 'font-family': FONT }, svg, 'area read');
  for (let h = Math.ceil(tMin); h <= tMax; h++) {
    svgEl('path', { d: `M${X(h).toFixed(1)} ${t}V${H - b}`, stroke: `rgba(255,255,255,${h === 0 ? 0.25 : 0.08})` }, svg);
    svgEl('text', { x: X(h).toFixed(1), y: H - b + 14, 'font-size': 10.5, fill: '#c3cbd3', 'text-anchor': 'middle', 'font-family': FONT }, svg, h === 0 ? 'H' : `${h > 0 ? '+' : ''}${h}`);
  }
  const kmStep = aMax - aMin > 60000 ? 20000 : aMax - aMin > 25000 ? 10000 : 5000;
  for (let m = Math.ceil(aMin / kmStep) * kmStep; m <= aMax; m += kmStep) svgEl('text', { x: l - 5, y: (Y(m) + 4).toFixed(1), 'font-size': 10.5, fill: '#c3cbd3', 'text-anchor': 'end', 'font-family': FONT }, svg, `${Math.round(m / 1000)}`);
  svgEl('text', { x: 2, y: t + 8, 'font-size': 10, fill: '#9aa3ad', 'font-family': FONT }, svg, 'km');
  svgEl('text', { x: (l + wpx - r) / 2, y: H - 4, 'font-size': 10.5, fill: '#c3cbd3', 'text-anchor': 'middle', 'font-family': FONT }, svg, `hours from ${dv.fromThreat ? 'the en leaving the Threat marker' : 'the en reaching the area'} · IPB`);
  for (const p of [...dv.profiles].reverse()) {
    const aa = v.aas.find((x) => x.id === p.aa);
    const col = aa ? colourOf(v, aa) : LONE;
    const dE = p.pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[1]).toFixed(1)} ${Y(q[0]).toFixed(1)}`).join('');
    const dL = p.pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[2]).toFixed(1)} ${Y(q[0]).toFixed(1)}`).join('');
    svgEl('path', { d: dL, fill: 'none', stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.8 }, svg);
    svgEl('path', { d: dE, fill: 'none', stroke: col, 'stroke-width': p.main ? 2.4 : 1.8 }, svg);
    const last = p.pts[p.pts.length - 1];
    if (last) svgEl('text', { x: (X(last[1]) + 4).toFixed(1), y: (Y(last[0]) - 3).toFixed(1), 'font-size': 11, 'font-weight': 750, fill: col, 'font-family': FONT }, svg, p.viable ? p.aa : `${p.aa}1`);
  }
  for (const n of dv.nais) if (!n.tai) svgEl('circle', { cx: X(n.earliestH).toFixed(1), cy: Y(n.alongM).toFixed(1), r: 3.4, fill: '#14181d', stroke: '#e8ebee', 'stroke-width': 1.4 }, svg);
  for (const tt of dv.tais) {
    const x = X(tt.earliestH), y = Y(tt.alongM);
    svgEl('rect', { x: (x - 4.5).toFixed(1), y: (y - 4.5).toFixed(1), width: 9, height: 9, fill: '#14181d', stroke: '#ffd27a', 'stroke-width': 1.8 }, svg);
    svgEl('text', { x: (x + 7).toFixed(1), y: (y + 4).toFixed(1), 'font-size': 10.5, fill: '#ffd27a', 'font-family': FONT }, svg, tt.id);
  }
  for (const d of dv.dps) {
    const x = X(d.earliestH), y = Y(d.alongM);
    const col = d.kind === 'catk' ? '#8ec1ea' : '#ffd27a';
    svgEl('path', { d: `M${x.toFixed(1)} ${(y - 8).toFixed(1)}l2.4 5.4h5.9l-4.7 3.6 1.8 5.8-5.4-3.4-5.4 3.4 1.8-5.8-4.7-3.6h5.9z`, fill: '#14181d', stroke: col, 'stroke-width': 1.5 }, svg);
    svgEl('text', { x: (x - 9).toFixed(1), y: (y + 4).toFixed(1), 'font-size': 10.5, 'font-weight': 700, fill: col, 'text-anchor': 'end', 'font-family': FONT }, svg, d.id);
  }
  return svg;
}

/** The area with the avenues, NAIs, TAIs and DPs (a DP beyond the area sits at its edge with its distance). */
function decisionPicture(o: GroundGuideOcoka, v: IpbApchView, dv: IpbDecisionView, wpx = 380): SVGSVGElement {
  const pts: MercXY[] = [...v.frame, ...dv.dps.map((d) => d.at)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 14;
  const sc0 = (wpx - 2 * pad) / Math.max(1, x1 - x0);
  const hpx = Math.round(Math.min(400, Math.max(180, (y1 - y0) * sc0 + 2 * pad)));
  const sc = Math.min(sc0, (hpx - 2 * pad) / Math.max(1, y1 - y0));
  const ox = (wpx - (x1 - x0) * sc) / 2, oy = (hpx - (y1 - y0) * sc) / 2;
  const X = (p: MercXY): number => ox + (p[0] - x0) * sc;
  const Y = (p: MercXY): number => oy + (y1 - p[1]) * sc;
  const d = (ps: MercXY[], close = false): string => ps.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)} ${Y(p).toFixed(1)}`).join('') + (close ? 'Z' : '');
  const svg = svgEl('svg', { width: wpx, height: hpx, viewBox: `0 0 ${wpx} ${hpx}`, class: 'ms-gia-pic' }) as SVGSVGElement;
  svgEl('rect', { width: wpx, height: hpx, fill: '#11161b', rx: 8 }, svg);
  if (v.frame.length === 4) svgEl('path', { d: d(v.frame, true), fill: 'rgba(142,193,234,.04)', stroke: '#e9edf1', 'stroke-opacity': 0.5, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, svg);
  for (const a of [...v.aas].reverse()) {
    if (!a.viable || !a.arrow.stroke.length) continue;
    const col = colourOf(v, a);
    svgEl('path', { d: d(a.arrow.fill, true), fill: col, 'fill-opacity': 0.08 }, svg);
    svgEl('path', { d: d(a.arrow.stroke), fill: 'none', stroke: col, 'stroke-width': 1.2, 'stroke-opacity': 0.7, ...(a.main ? {} : { 'stroke-dasharray': '6 4' }) }, svg);
  }
  const kpx = Math.cosh(((y0 + y1) / 2) / 6378137) * sc;
  const rr = Math.max(3.5, Math.max(300, v.mcWidthM / 2) * kpx);
  for (const n of dv.nais) svgEl('circle', { cx: X(n.at).toFixed(1), cy: Y(n.at).toFixed(1), r: rr.toFixed(1), fill: 'rgba(232,235,238,.06)', stroke: '#e8ebee', 'stroke-width': 1.1, 'stroke-dasharray': '3 2' }, svg);
  for (const t of dv.tais) svgEl('rect', { x: (X(t.at) - 5).toFixed(1), y: (Y(t.at) - 4).toFixed(1), width: 10, height: 8, rx: 1, fill: 'rgba(255,210,122,.18)', stroke: '#ffd27a', 'stroke-width': 1.6, transform: `rotate(${(t.dirDeg - 90).toFixed(0)} ${X(t.at).toFixed(1)} ${Y(t.at).toFixed(1)})` }, svg);
  for (const dp of dv.dps) {
    const x = X(dp.at), y = Y(dp.at);
    const col = dp.kind === 'catk' ? '#8ec1ea' : '#ffd27a';
    svgEl('path', { d: `M${x.toFixed(1)} ${(y - 8).toFixed(1)}l2.4 5.4h5.9l-4.7 3.6 1.8 5.8-5.4-3.4-5.4 3.4 1.8-5.8-4.7-3.6h5.9z`, fill: '#14181d', stroke: col, 'stroke-width': 1.5 }, svg);
    svgEl('text', { x: (x + 9).toFixed(1), y: (y + 4).toFixed(1), 'font-size': 10.5, 'font-weight': 700, fill: col, stroke: '#0b0d10', 'stroke-width': 2.4, 'paint-order': 'stroke', 'font-family': FONT }, svg, `${dp.id}${dp.inArea ? '' : dp.beforeH ? ' before H' : ` ${Math.round(dp.beyondM / 1000)} km out`}`);
  }
  const sx = X(o.at), sy = Y(o.at);
  svgEl('rect', { x: (sx - 5).toFixed(1), y: (sy - 4).toFixed(1), width: 10, height: 8, rx: 1.5, fill: '#1d3f66', stroke: '#8ec1ea', 'stroke-width': 1.5 }, svg);
  svgEl('text', { x: wpx - 14, y: 18, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, fill: '#fff', 'font-family': FONT }, svg, 'N↑');
  return svg;
}

function table(head: string[], rows: string[][]): HTMLElement {
  const t = el('table', 'ms-gia-dt');
  const h = el('tr');
  for (const x of head) h.append(el('th', undefined, x));
  t.append(h);
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((x, i) => tr.append(el('td', i === 0 ? 'ms-dp' : undefined, x)));
    t.append(tr);
  }
  return t;
}

/** Tab 5's tiles: the time ladder, the decision support picture, the decisions, the event matrix, the rates, Create on Map. */
export function decisionTiles(o: GroundGuideOcoka): HTMLElement[] {
  ensureCss();
  const v = o.ipbApch;
  const dv = v?.decision;
  if (v === undefined) return [tile('Decision', note('The IPB avenues are off (extended.ipb.apchs): decision support follows them.'))];
  if (!v || !dv) return [tile('Decision', note('Working out the times along the avenues, the NAIs, TAIs and decision points.'))];
  const out: HTMLElement[] = [];
  out.push(tile(`Time Ladder · ${v.side === 'enemy' ? 'En' : 'Own'} Along Each Apch`, timeLadder(v, dv), note(`Solid: earliest (day rates, unassessed Gr as GO). Dashed: latest (night rates, unassessed Gr as SLOW-GO). ${dv.hHour ? 'Shaded: night. ' : ''}Stars: decision points; squares: TAIs; rings: NAIs.`)));
  if (v.side === 'enemy') {
    out.push(tile('Decision Support · In the Area', decisionPicture(o, v, dv), note('A star beyond the area is placed on the way in from the Threat marker (or at the edge) with its distance.')));
    const dec = table(['DP', 'When · where', 'Decision (yours)'], dv.dps.map((d) => [d.id, `${clock(dv, d.earliestH)} · ${whereDp(d)}`, d.decision]));
    if (!dv.dps.length) dec.append(el('tr'));
    const dt = tile('Decisions', dv.dps.length ? dec : note(dv.notes[0] ?? 'No decision point.'), note(`A DP is where and when a decision falls due: ${2 + (dv.dps[0] ? 0 : 0)} h before a TAI (book p 30)${dv.catk ? `, and the counter-attack ${dv.catk.min} min before the depth localities (OoW Vol I p 54)` : ''}. The decision is the commander's.`));
    dt.classList.add('ms-ggd-brk');
    out.push(dt);
    const em = tile('Event Matrix', table(['NAI', 'Apch · what shows', 'Earliest', 'Latest'], dv.nais.map((n) => [`${n.n}${n.tai ? ` · ${n.tai}` : ''}`, `${n.aa}: ${n.shows}${n.widthM ? ` (${Math.round(n.widthM)} m)` : ''}`, hPlus(n.earliestH), hPlus(n.latestH)])), note('NAIs sit where the enemy will show himself (book pp 23-28).'));
    em.classList.add('ms-ggd-brk');
    out.push(em);
  }
  const rt = el('div', 'ms-gx-list');
  const rows: Array<[string, string]> = [
    ['Rates', `${dv.rates.mover === 'dismounted' ? 'Foot' : 'Vehicles'}: GO ${dv.rates.go[0]} / ${dv.rates.go[1]}, SLOW-GO ${dv.rates.slow[0]} / ${dv.rates.slow[1]}, NO-GO ${dv.rates.nogo[0]} / ${dv.rates.nogo[1]} km/h, day / night (book p 18)`],
    ['From', dv.fromThreat ? 'The Threat marker\'s place: the way in at GO' : "The area's edge (the threat is only a direction): drag the Threat marker to the en's assembly area for times from his start"],
    ['DP lead', `2 h (book p 30)${o.ipbApch ? '' : ''}`],
  ];
  for (const n of dv.notes) rows.push(['Note', n]);
  for (const [a, b] of rows) rt.append(el('div', undefined, a), el('div', undefined, b));
  out.push(tile('Rates & Times', rt));
  if (v.side === 'enemy' && (dv.nais.length || dv.dps.length)) {
    const acts = el('div', 'ms-gia-acts');
    const btn = (kind: 'event' | 'dst' | 'decision', text: string, title: string): void => {
      const b = el('button', kind === 'decision' ? 'ms-gia-btn ms-all' : 'ms-gia-btn', text) as HTMLButtonElement;
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        b.dispatchEvent(new CustomEvent('ms-gg-ipb-create', { bubbles: true, detail: { kind } }));
      });
      acts.append(b);
    };
    btn('event', 'NAIs', 'The NAIs as Named Area of Interest symbols');
    btn('dst', 'TAIs & DPs', 'The TAIs and decision points (Tgt Area of Interest, Decision Pt)');
    btn('decision', 'Both', 'Event template and decision support together');
    out.push(tile('Create on Map', acts, note('Ordinary symbols, one undo step; making them again replaces them.')));
  }
  return out;
}

export function decisionScopeRows(o: GroundGuideOcoka): Array<{ icon: 'avenue' | 'choke'; bold: string; rest: string }> {
  const dv = o.ipbApch?.decision;
  if (!dv) return [];
  if (o.ipbApch?.side !== 'enemy') {
    const best = [...dv.profiles].filter((p) => p.viable).sort((p, q) => p.endH[0] - q.endH[0])[0];
    return best ? [{ icon: 'avenue', bold: `${best.aa} ${hPlus(best.endH[0])}`, rest: 'to cross the area' }] : [];
  }
  const out: Array<{ icon: 'avenue' | 'choke'; bold: string; rest: string }> = [];
  const d = dv.dps[0];
  if (d) out.push({ icon: 'choke', bold: `${d.id} ${hPlus(d.earliestH)}`, rest: whereDp(d) });
  const t = dv.tais[0];
  if (t) out.push({ icon: 'avenue', bold: `${t.id} ${hPlus(t.earliestH)}`, rest: `${t.why.split(':')[0]} on ${t.aa}` });
  if (!out.length) out.push({ icon: 'avenue', bold: 'No DP', rest: dv.notes[0] ?? 'no TAI' });
  return out;
}

export function decisionText(o: GroundGuideOcoka): string[] {
  const v = o.ipbApch;
  const dv = v?.decision;
  if (!v || !dv) return [];
  const L = [`Times at the book's rates (p 18; ${dv.rates.mover}: GO ${dv.rates.go.join('/')}, SLOW-GO ${dv.rates.slow.join('/')} km/h day/night), from ${dv.fromThreat ? 'the Threat marker' : "the area's edge"}${dv.hHour ? `, H ${dv.hHour}` : ''}; earliest = day, unassessed as GO; latest = night, unassessed as SLOW-GO.`];
  for (const p of dv.profiles) L.push(`  ${p.aa}: enters ${hPlus(p.startH[0])} (latest ${hPlus(p.startH[1])}), through the area ${hPlus(p.endH[0])} (latest ${hPlus(p.endH[1])}).`);
  if (v.side === 'enemy') {
    for (const n of dv.nais) L.push(`  NAI ${n.n}${n.tai ? ` (${n.tai})` : ''} on ${n.aa}: ${n.shows}; ${hPlus(n.earliestH)} to ${hPlus(n.latestH)}.`);
    for (const t of dv.tais) L.push(`  ${t.id} on ${t.aa}: ${t.why}; ${hPlus(t.earliestH)} at the earliest.`);
    for (const d of dv.dps) L.push(`  ${d.id} ${clock(dv, d.earliestH)}, ${whereDp(d)}: ${d.decision}.`);
  }
  for (const n of dv.notes) L.push(`  ${n}`);
  return L;
}

// ── rail, text ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The rail's line 3 words with the IPB avenues on: the best avenue, then its narrows (or the note). */
export function apchScopeRows(o: GroundGuideOcoka): Array<{ icon: 'avenue' | 'choke'; bold: string; rest: string }> {
  const v = o.ipbApch;
  if (!v) return [{ icon: 'avenue', bold: 'Apchs', rest: 'working out the area…' }];
  const vi = viableOf(v);
  if (!vi.length) return [{ icon: 'avenue', bold: 'No Apch', rest: v.notes[0] ?? `for a ${v.aaFor}` }];
  const a = vi[0];
  const rows: Array<{ icon: 'avenue' | 'choke'; bold: string; rest: string }> = [{ icon: 'avenue', bold: `Apch ${a.id} best going`, rest: `${vi.length} for a ${v.aaFor} · ${pc(a.goPct)} GO` }];
  const n = vi.flatMap((x) => x.narrows.map((q) => ({ x, q }))).sort((p, q) => p.q.widthM - q.q.widthM)[0];
  if (n) rows.push({ icon: 'choke', bold: narrowsWord(n.q), rest: `on ${n.x.id}, ${km(n.q.alongM)} in` });
  return rows;
}

/** The Copy as Text paragraph for the IPB avenues. */
export function apchText(o: GroundGuideOcoka): string[] {
  const v = o.ipbApch;
  if (!v) return ['IPB avenues: being worked out over the area read.'];
  const L: string[] = [];
  L.push(`IPB ${v.side === 'enemy' ? 'enemy' : 'own'} avenues for a ${v.aaFor} (${v.hqLabel}: ${v.mcFor} corridors ${fmtDistance(v.mcWidthM)}, at most ${km(v.spacingM)} apart; book pp 7, 12; ATP T4-2). Area ${v.frameKm[0]} x ${v.frameKm[1]} km, ${v.mover}, moving ${Math.round(v.axisDeg)}°.`);
  L.push(`Apchs end: ${endLine(v)}.`);
  for (const a of v.aas) {
    L.push(`${a.viable ? `Apch ${a.id}` : `Lone corridor ${a.id}1`} (${aaRole(a)}): ${aaLine(v, a)}; median ${km(a.medianWidthM)} wide.`);
    for (const n of a.narrows) L.push(`  Narrows: ${narrowsWord(n)}, ${km(n.alongM)} in.`);
  }
  for (const x of v.crossovers) L.push(`Crossover ${x.id}: ${x.a} to ${x.b}, ${km(x.alongM)} in.`);
  for (const n of v.notes) L.push(n);
  L.push('Ranked on the going (a proposal). NO-GO does not mean impassable. Check on the ground.');
  L.push(...proformaText(o));
  return L;
}
