/**
 * PlatoonGuideRadar.ts
 *
 * The bubble radar: one round picture of everything the Platoon Guide read round a point (user, 2026-11-11: "make it
 * visually appealing and use creative visualization techniques", for the cursor card as well as the Pl Detail).
 *
 *   - inside the dashed bubble ring, to true scale: what a man standing here sees (faint green), ground screened by
 *     crops, trees and buildings (amber) and dead ground (red), straight from the visibility rays;
 *   - round the rim, eight arcs: the way out on foot (outer, thick) and for vehicles (inner, thin) in the going colours;
 *   - glyphs where things are: water (drop), likely mine / IED (diamond), ambush (triangle), vulnerable point and road
 *     block, ground that looks down on you (violet chevron), landing ground (H), hospital (cross), help (square), the
 *     nearest BUA (house), the patrol base (star) and the OP;
 *   - beyond the bubble the scale turns logarithmic in the band outside the ring, so a hospital 9 km away still shows
 *     its direction without crushing the bubble; the band is labelled.
 * North up, and the whole picture turns with the map (GroundGuideNorth `data-gv-rose`); letters stay upright. Colours
 * from GroundGuideTokens.ts only. Pure SVG markup built from numbers and fixed strings (no names inside), so it is safe.
 */

import { LINE, STEP_COLOR, SURFACE } from '../GroundGuide/GroundGuideTokens';
import type { PlGoing, PlReading, PlSpot } from './PlatoonGuideRead';

const SVG_NS = 'http://www.w3.org/2000/svg';
const C = 100;
/** The bubble ring, the rim the glyphs may reach, and the way-out arcs, in picture units (200 x 200). */
const R_BUB = 58;
const R_RIM = 84;
const R_ARC0 = 88, R_ARC1 = 97;
const R_VEH0 = 85.5, R_VEH1 = 87;
/** The far band's scale: the rim is this many bubble radii away. */
const FAR_RATIO = 40;

export const GLYPH_COLOR = {
  water: '#4fb3ff',
  mine: STEP_COLOR.nogo,
  ambush: STEP_COLOR.nogo,
  vp: STEP_COLOR.slow,
  block: STEP_COLOR.nogo,
  overlook: '#c084fc',
  hls: '#d48bff',
  hospital: '#ff5c63',
  help: '#5aa9ff',
  bua: '#e2c79a',
  harbour: '#4ade80',
  op: '#a5b4fc',
  cover: '#c4a484',
  km: '#f5f5f5',
  relay: '#8c9eff',
} as const;

export type GlyphKind = keyof typeof GLYPH_COLOR;

/** The short word under a glyph on the map and beside it in the halo (user, 2026-11-13: "2-3 chars can tell users about
 *  it on map"), and what it stands for in the keys. */
export const GLYPH_CODE: Record<GlyphKind, string> = {
  water: 'Wtr',
  mine: 'IED',
  ambush: 'Amb',
  vp: 'VP',
  block: 'RB',
  overlook: 'HG',
  hls: 'HLS',
  hospital: 'Hosp',
  help: 'Help',
  bua: 'BUA',
  harbour: 'PB',
  op: 'OP',
  cover: 'Cov',
  km: 'KM',
  relay: 'RL',
};
export const GLYPH_WORD: Record<GlyphKind, string> = {
  water: 'water',
  mine: 'likely mine / IED',
  ambush: 'likely ambush',
  vp: 'vulnerable point',
  block: 'likely Rd block',
  overlook: 'high Gr looking down',
  hls: 'landing Gr',
  hospital: 'hospital, BHU',
  help: 'help: post, police, fort',
  bua: 'nearest BUA',
  harbour: 'patrol base',
  op: 'OP site',
  cover: 'better cover',
  km: 'KM stone',
  relay: 'relay Gr',
};
/** The short word for a place of help, by its kind (Pol police station, BOP border post, Cantt cantonment...). */
export function helpCode(kind: string | undefined): string {
  return ({ police_station: 'Pol', post: 'Post', border_post: 'BOP', fort: 'Fort', cantonment: 'Cantt', watch_tower: 'Twr' } as Record<string, string>)[kind ?? ''] ?? 'Help';
}

function add(parent: Element, tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e as SVGElement;
}
function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}
function arc(r0: number, r1: number, a0: number, a1: number): string {
  const P = (r: number, a: number) => polar(r, a).map((v) => v.toFixed(2)).join(' ');
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${P(r0, a0)} L${P(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${P(r1, a1)} L${P(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${P(r0, a0)}Z`;
}
/** Picture radius for a ground distance: linear inside the bubble, logarithmic in the band outside it. */
function radiusOf(distM: number, bubbleM: number): number {
  if (distM <= bubbleM) return (distM / bubbleM) * R_BUB;
  const t = Math.min(1, Math.log(distM / bubbleM) / Math.log(FAR_RATIO));
  return R_BUB + 3 + t * (R_RIM - R_BUB - 5);
}

/** The radar glyph for a danger kind from the road scan; null for kinds the radar does not draw. */
export function dangerGlyph(kind: string): keyof typeof GLYPH_COLOR | null {
  return kind === 'mine' ? 'mine' : kind === 'ambush' ? 'ambush' : kind === 'block' ? 'block' : kind === 'vp' ? 'vp' : kind === 'overlooked' || kind === 'rooftops' ? 'overlook' : null;
}

/** A glyph centred at (x, y), `s` its half size. Shapes only: the meaning is in the key and the card beside it. */
export function glyph(g: Element, kind: keyof typeof GLYPH_COLOR, x: number, y: number, s = 4.6): void {
  const col = GLYPH_COLOR[kind];
  const stroke = { stroke: SURFACE.ring, 'stroke-width': 1.1, 'stroke-linejoin': 'round' };
  const up = { 'data-gv-upright': `${x.toFixed(2)} ${y.toFixed(2)}` };
  switch (kind) {
    case 'water':
      add(g, 'path', { d: `M${x} ${y - s * 1.25} C${x + s * 0.2} ${y - s * 0.6} ${x + s} ${y - s * 0.1} ${x + s} ${y + s * 0.45} A${s} ${s} 0 0 1 ${x - s} ${y + s * 0.45} C${x - s} ${y - s * 0.1} ${x - s * 0.2} ${y - s * 0.6} ${x} ${y - s * 1.25}Z`, fill: col, ...stroke, ...up });
      break;
    case 'mine':
      add(g, 'path', { d: `M${x} ${y - s * 1.15}L${x + s * 1.15} ${y}L${x} ${y + s * 1.15}L${x - s * 1.15} ${y}Z`, fill: col, ...stroke, ...up });
      break;
    case 'ambush':
      add(g, 'path', { d: `M${x} ${y - s * 1.2}L${x + s * 1.1} ${y + s * 0.85}L${x - s * 1.1} ${y + s * 0.85}Z`, fill: col, ...stroke, ...up });
      break;
    case 'block':
      add(g, 'rect', { x: x - s, y: y - s, width: s * 2, height: s * 2, rx: 1, fill: col, ...stroke, ...up });
      break;
    case 'vp':
      add(g, 'circle', { cx: x, cy: y, r: s * 0.95, fill: col, ...stroke });
      break;
    case 'overlook':
      add(g, 'path', { d: `M${x - s * 1.1} ${y + s * 0.5}L${x} ${y - s * 0.7}L${x + s * 1.1} ${y + s * 0.5}`, fill: 'none', stroke: col, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...up });
      break;
    case 'hls':
      add(g, 'circle', { cx: x, cy: y, r: s * 1.2, fill: SURFACE.ring, stroke: col, 'stroke-width': 1.6 });
      add(g, 'text', { x, y: y + 0.4, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': s * 1.7, 'font-weight': 800, fill: col, 'font-family': 'system-ui,Segoe UI,Arial,sans-serif', ...up }, 'H');
      break;
    case 'hospital':
      add(g, 'rect', { x: x - s * 1.1, y: y - s * 1.1, width: s * 2.2, height: s * 2.2, rx: 1.5, fill: '#ffffff', ...stroke, ...up });
      add(g, 'path', { d: `M${x} ${y - s * 0.7}V${y + s * 0.7}M${x - s * 0.7} ${y}H${x + s * 0.7}`, stroke: col, 'stroke-width': 2, 'stroke-linecap': 'round', ...up });
      break;
    case 'help': {
      // A lifebuoy: the help sign everyone reads.
      const rr = s * 0.82, w = s * 0.62, c = 2 * Math.PI * rr;
      add(g, 'circle', { cx: x, cy: y, r: rr + w / 2 + 0.6, fill: SURFACE.ring });
      add(g, 'circle', { cx: x, cy: y, r: rr, fill: 'none', stroke: '#ffffff', 'stroke-width': w });
      add(g, 'circle', { cx: x, cy: y, r: rr, fill: 'none', stroke: col, 'stroke-width': w, 'stroke-dasharray': `${(c / 8).toFixed(2)} ${(c / 8).toFixed(2)}`, transform: `rotate(-22.5 ${x} ${y})` });
      break;
    }
    case 'bua':
      // A small building: walls, a pitched roof and a door.
      add(g, 'path', { d: `M${x - s} ${y + s * 0.95}V${y - s * 0.05}L${x} ${y - s * 1.1}L${x + s} ${y - s * 0.05}V${y + s * 0.95}Z`, fill: col, ...stroke, ...up });
      add(g, 'rect', { x: x - s * 0.24, y: y + s * 0.3, width: s * 0.48, height: s * 0.65, fill: SURFACE.ring, ...up });
      break;
    case 'cover':
      // A bank or wall to get behind: a mound on its base line.
      add(g, 'path', { d: `M${x - s * 1.2} ${y + s * 0.7}C${x - s * 0.8} ${y - s * 1.1} ${x + s * 0.8} ${y - s * 1.1} ${x + s * 1.2} ${y + s * 0.7}Z`, fill: col, ...stroke, ...up });
      break;
    case 'km':
      // A KM stone: white, round topped, its top band coloured.
      add(g, 'path', { d: `M${x - s * 0.8} ${y + s}V${y - s * 0.2}A${s * 0.8} ${s * 0.8} 0 0 1 ${x + s * 0.8} ${y - s * 0.2}V${y + s}Z`, fill: col, ...stroke, ...up });
      add(g, 'path', { d: `M${x - s * 0.8} ${y - s * 0.2}A${s * 0.8} ${s * 0.8} 0 0 1 ${x + s * 0.8} ${y - s * 0.2}Z`, fill: '#ffb300', ...up });
      break;
    case 'relay':
      // A mast with its waves.
      add(g, 'path', { d: `M${x} ${y - s * 0.5}L${x - s * 0.6} ${y + s * 1.05}M${x} ${y - s * 0.5}L${x + s * 0.6} ${y + s * 1.05}M${x - s * 0.35} ${y + s * 0.4}H${x + s * 0.35}`, stroke: col, 'stroke-width': 1.5, 'stroke-linecap': 'round', fill: 'none', ...up });
      add(g, 'path', { d: `M${x - s * 0.75} ${y - s * 1.05}A${s} ${s} 0 0 0 ${x - s * 0.75} ${y + s * 0.05}M${x + s * 0.75} ${y - s * 1.05}A${s} ${s} 0 0 1 ${x + s * 0.75} ${y + s * 0.05}`, stroke: col, 'stroke-width': 1.3, 'stroke-linecap': 'round', fill: 'none', ...up });
      add(g, 'circle', { cx: x, cy: y - s * 0.55, r: s * 0.26, fill: col, ...up });
      break;
    case 'harbour': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? s * 0.55 : s * 1.3;
        const a = (i * 36 * Math.PI) / 180;
        pts.push(`${(x + rr * Math.sin(a)).toFixed(2)} ${(y - rr * Math.cos(a)).toFixed(2)}`);
      }
      add(g, 'path', { d: `M${pts.join('L')}Z`, fill: col, ...stroke, ...up });
      break;
    }
    case 'op':
      add(g, 'path', { d: `M${x} ${y - s * 1.3}L${x + s * 1.1} ${y + s * 0.8}L${x - s * 1.1} ${y + s * 0.8}Z`, fill: 'none', stroke: col, 'stroke-width': 1.8, 'stroke-linejoin': 'round', ...up });
      add(g, 'circle', { cx: x, cy: y + s * 0.1, r: s * 0.32, fill: col, ...up });
      break;
  }
}

export interface RadarOpts {
  /** On-screen size, px. */
  px: number;
  /** Write the bubble's and the far band's distances. */
  scale?: boolean;
  /** Draw the dead / screened ground (when the full reading has it). */
  sight?: boolean;
  /** Accessible name. */
  label?: string;
}

const GOING_FILL = (g: PlGoing) => (g === 'unknown' ? '#3a434e' : STEP_COLOR[g]);

/** The bubble radar for a reading (see the file header). */
export function plRadar(r: PlReading, o: RadarOpts): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(o.px));
  svg.setAttribute('height', String(o.px));
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', o.label ?? 'Round the point: way out, sight, water, dangers, casevac, help');
  svg.classList.add('ms-pl-radar');
  const defs = add(svg, 'defs', {});
  const grad = add(defs, 'radialGradient', { id: `plr-bg-${o.px}`, cx: '50%', cy: '50%', r: '50%' });
  add(grad, 'stop', { offset: '0%', 'stop-color': '#26313c' });
  add(grad, 'stop', { offset: '100%', 'stop-color': SURFACE.ring });
  add(svg, 'circle', { cx: C, cy: C, r: R_ARC1 + 2, fill: `url(#plr-bg-${o.px})`, stroke: LINE.ring, 'stroke-width': 1 });
  const g = add(svg, 'g', { 'data-gv-rose': `${C} ${C}` });

  // Sight inside the bubble, to true scale.
  const S = r.see;
  if (S && o.sight !== false) {
    const k = R_BUB / Math.max(1, Math.min(S.radiusM, r.radiusM));
    const half = 180 / S.rays.length + 0.4;
    const fill = ['', '#2fa862', '#ffb300', '#ff4d55'];
    const op = [0, 0.22, 0.42, 0.55];
    for (const ray of S.rays) {
      let i = 0;
      while (i < ray.states.length) {
        const st = ray.states[i];
        let j = i;
        while (j + 1 < ray.states.length && ray.states[j + 1] === st) j++;
        const r0 = Math.min(R_BUB, i * S.stepM * k), r1 = Math.min(R_BUB, (j + 1) * S.stepM * k);
        if (st && r1 > r0) add(g, 'path', { d: arc(r0, r1, ray.bearingDeg - half, ray.bearingDeg + half), fill: fill[st], 'fill-opacity': op[st] });
        i = j + 1;
      }
    }
  }
  // Rings: the bubble (dashed) and a faint half ring; the far band under the rim.
  add(g, 'circle', { cx: C, cy: C, r: R_BUB / 2, fill: 'none', stroke: 'rgba(255,255,255,.12)' });
  add(g, 'circle', { cx: C, cy: C, r: R_BUB, fill: 'none', stroke: 'rgba(255,255,255,.55)', 'stroke-dasharray': '3 3', 'stroke-width': 1.2 });
  add(g, 'circle', { cx: C, cy: C, r: R_RIM, fill: 'none', stroke: 'rgba(255,255,255,.1)' });
  for (let a = 0; a < 360; a += 30) {
    const [x0, y0] = polar(R_BUB + 2, a), [x1, y1] = polar(R_RIM, a);
    add(g, 'line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: 'rgba(255,255,255,.07)' });
  }

  // The way out: eight arcs round the rim, foot (outer) and vehicles (inner).
  for (const d of r.here.waysOut.dirs) {
    add(g, 'path', { d: arc(R_ARC0, R_ARC1, d.bearingDeg - 19.5, d.bearingDeg + 19.5), fill: GOING_FILL(d.foot) });
    add(g, 'path', { d: arc(R_VEH0, R_VEH1, d.bearingDeg - 19.5, d.bearingDeg + 19.5), fill: GOING_FILL(d.veh), 'fill-opacity': 0.85 });
  }

  // Glyphs, the far ones first so the near ones sit on top.
  const marks: Array<{ s: PlSpot; kind: keyof typeof GLYPH_COLOR }> = [];
  const push = (s: PlSpot | null | undefined, kind: keyof typeof GLYPH_COLOR) => {
    if (s) marks.push({ s, kind });
  };
  const H = r.here;
  push(H.medical.hospital, 'hospital');
  push(r.help.friends[0], 'help');
  push(r.people.bua, 'bua');
  push(H.hls.ground && H.hls.ground.distM > 15 ? H.hls.ground : null, 'hls');
  push(H.water.nearest, 'water');
  if (H.water.perennial && H.water.perennial !== H.water.nearest) push(H.water.perennial, 'water');
  push(r.stop?.harbour, 'harbour');
  push(r.stop?.op, 'op');
  for (const ov of S?.overlook ?? []) push(ov, 'overlook');
  for (const sp of r.danger?.spots ?? []) {
    const kind = sp.kind === 'mine' ? 'mine' : sp.kind === 'ambush' ? 'ambush' : sp.kind === 'block' ? 'block' : sp.kind === 'vp' ? 'vp' : null;
    if (kind) push(sp, kind);
  }
  marks.sort((a, b) => b.s.distM - a.s.distM);
  for (const m of marks) {
    const [x, y] = polar(radiusOf(m.s.distM, r.radiusM), m.s.bearingDeg);
    glyph(g, m.kind, x, y, m.kind === 'vp' ? 3.8 : 4.6);
  }

  // N kept upright, and the scale words.
  const [nx, ny] = polar(R_ARC1 - 4.5, 0);
  add(g, 'circle', { cx: nx, cy: ny, r: 6.5, fill: SURFACE.ring, stroke: 'rgba(255,255,255,.6)', 'stroke-width': 1 });
  add(g, 'text', { x: nx, y: ny + 0.3, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 9, 'font-weight': 800, fill: '#ffffff', 'font-family': 'system-ui,Segoe UI,Arial,sans-serif', 'data-gv-upright': `${nx.toFixed(2)} ${ny.toFixed(2)}` }, 'N');
  if (o.scale) {
    const word = (m: number) => (m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${m} m`);
    const [bx, by] = polar(R_BUB - 1, 135);
    add(svg, 'text', { x: bx, y: by + 9, 'text-anchor': 'middle', 'font-size': 8.5, fill: '#c3cbd3', 'font-family': 'system-ui,Segoe UI,Arial,sans-serif' }, word(r.radiusM));
    const [fx, fy] = polar(R_RIM - 2, 135);
    add(svg, 'text', { x: fx + 2, y: fy + 9, 'text-anchor': 'middle', 'font-size': 8, fill: '#9aa3ad', 'font-family': 'system-ui,Segoe UI,Arial,sans-serif' }, word(r.radiusM * FAR_RATIO));
  }
  // The point itself, with a soft halo.
  add(svg, 'circle', { cx: C, cy: C, r: 7, fill: 'rgba(66,165,245,.25)' });
  add(svg, 'circle', { cx: C, cy: C, r: 3.6, fill: '#42a5f5', stroke: '#ffffff', 'stroke-width': 1.4 });
  return svg;
}

/** The radar's glyphs, in the order of its key (each with its map word, GLYPH_CODE, and meaning, GLYPH_WORD). */
export const RADAR_KEY: GlyphKind[] = ['water', 'mine', 'ambush', 'vp', 'overlook', 'hls', 'hospital', 'help', 'bua', 'harbour', 'op'];

/** One small glyph as its own SVG (for keys and stat tiles). */
export function glyphIcon(kind: keyof typeof GLYPH_COLOR, px = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  glyph(svg, kind, 8, 8.6, 5.2);
  return svg;
}
