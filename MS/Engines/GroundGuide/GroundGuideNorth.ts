/**
 * GroundGuideNorth.ts
 *
 * Where north points on screen, and every picture that turns with it. The map can be rotated (2D `view.rotation`)
 * or the camera turned (3D `camera.heading`); `northDeg` is where north now points on screen, in degrees clockwise
 * from straight up (`screenNorth(view)` is the one formula). Every rose, dial, direction arrow and round map on the
 * cursor card and in the Ground Detail is built in map bearings (north up) and tagged, and one pass turns them all
 * in place, so the pictures agree with the map under them without a rebuild. Two mechanisms, both driven from
 * `setNorth` on the card:
 *   CSS (instant, no walk): `setNorthVar(root, northDeg)` sets `--gg-north` on the card root, and
 *     - `.ms-gg-arrow` (a direction arrow from `dirArrow`, with its own `--gg-b` bearing) turns by north + bearing,
 *     - `.ms-gg-turn` (a picture drawn north up) turns by north,
 *     - `.ms-gg-up` (a letter inside a turned rose) counter-turns so it stays readable;
 *   attributes (`orientNorth(root, northDeg)`):
 *     - `[data-gv-rose="c"]` or `"cx cy"`: an SVG group that rotates about that centre (the roses),
 *     - `[data-gv-upright="x y"]`: a child of a rose that counter-rotates about (x, y),
 *     - `[data-pb-dial="bearing"]`: the cursor card's compass dial (`dial`): the ring turns, N stays upright, the
 *       needle keeps pointing at the feature,
 *     - `canvas[data-gv-canvas]`: a round canvas map repainted by the painter registered with `registerCanvas`
 *       (a repainted canvas keeps its north tick and letter upright; `.ms-gg-turn` is inert on it).
 * Text that names a direction ("1.2 km NE", "faces NE") carries an arrow beside it: `whereNode` / `compassNode`
 * where the bearing is known, and `arrowCompass(root)` after a build for every compass point the text still has
 * alone, so a direction is never a word alone on a rotated map. DOM nodes and textContent only.
 */
import { fmtDistance } from './GroundGuideEvaluator';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'ms-ground-guide-north-style';
const VAR = '--gg-north';

const CSS = `
.ms-gg-arrow{display:inline-block;width:11px;height:11px;vertical-align:-1px;margin-left:3px;flex:none;overflow:visible}
.ms-gg-arrow path{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transform-origin:6px 6px;transform:rotate(calc(var(${VAR},0deg) + var(--gg-b,0deg)))}
b>.ms-gg-arrow path,.ms-ggb-big>.ms-gg-arrow path,.ms-ggs-big>.ms-gg-arrow path{stroke-width:2.1}
.ms-gg-turn:not([data-gv-canvas]){transform:rotate(var(${VAR},0deg))}
.ms-gg-up{transform-box:fill-box;transform-origin:center;transform:rotate(calc(-1 * var(${VAR},0deg)))}
`;

export function ensureNorthCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Where north points on screen for this view, degrees clockwise from up: the 2D rotation, or the opposite of the 3D camera heading. */
export function screenNorth(view: { type?: string; rotation?: number; camera?: { heading?: number } | null } | null | undefined): number {
  if (!view) return 0;
  const n = view.type === '3d' ? -(view.camera?.heading ?? 0) : (view.rotation ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Set the on-screen north on a card root: everything under it that turns by CSS (`.ms-gg-arrow`, `.ms-gg-turn`, `.ms-gg-up`) follows at once. */
export function setNorthVar(root: Element | null | undefined, northDeg: number): void {
  const el = root as HTMLElement | null | undefined;
  if (!el?.style) return;
  ensureNorthCss();
  el.style.setProperty(VAR, `${Math.round(northDeg * 10) / 10}deg`);
}

const POINTS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/** The bearing of a compass point ("NE" -> 45); null for anything else. */
export function compassBearing(compass: string | null | undefined): number | null {
  if (!compass) return null;
  const b = POINTS[compass.trim().toUpperCase()];
  return b === undefined ? null : b;
}

function bearingOf(bearing: number | string | null | undefined): number | null {
  if (typeof bearing === 'number') return Number.isFinite(bearing) ? ((bearing % 360) + 360) % 360 : null;
  return compassBearing(bearing);
}

/**
 * A small arrow that points along `bearing` (degrees clockwise from north, or a compass point) on the map as it is
 * on screen: it turns with the card's `--gg-north`. It inherits the text colour beside it. `northDeg` only matters
 * for a host that never sets the variable (the arrow is then fixed at that north).
 */
export function dirArrow(bearing: number | string | null | undefined, northDeg = 0): SVGElement | null {
  const b = bearingOf(bearing);
  if (b === null) return null;
  ensureNorthCss();
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ms-gg-arrow');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true'); // the text beside it already names the direction
  svg.dataset.gvArrow = String(Math.round(b));
  svg.style.setProperty('--gg-b', `${Math.round(b + northDeg)}deg`);
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = `${String(Math.round(b)).padStart(3, '0')}°`;
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M6 10.6V1.9M2.7 5.2L6 1.9l3.3 3.3');
  svg.append(title, p);
  return svg;
}

/** "1.2 km NE" with its arrow: the text, then `dirArrow` (by the exact bearing when given, else the compass point). */
export function whereNode(distanceM: number, compass: string, bearingDeg?: number | null): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(`${fmtDistance(distanceM)} ${compass}`);
  const a = dirArrow(bearingDeg ?? compass);
  if (a) f.append(a);
  return f;
}

/** A compass word with its arrow ("NE" + arrow): for a direction given without a distance. */
export function compassNode(compass: string, bearingDeg?: number | null): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(compass);
  const a = dirArrow(bearingDeg ?? compass);
  if (a) f.append(a);
  return f;
}

/** Nodes joined by a separator (" · " by default), empties left out. */
export function joinNodes(parts: Array<Node | string | null | undefined | false>, sep = ' · '): DocumentFragment {
  const f = document.createDocumentFragment();
  let first = true;
  for (const p of parts) {
    if (p === null || p === undefined || p === false || p === '') continue;
    if (!first) f.append(sep);
    f.append(p);
    first = false;
  }
  return f;
}

// ── arrows for the compass points the text names ───────────────────────────
/** A compass point after a distance ("1.2 km NE"), after "faces" / "Faces", or after "to the"; never one that starts a road number or a grid figure. */
const COMPASS_RE = /(\d[\d.,]*\s?(?:m|km)\s+|\b[Ff]aces\s+|\bto the\s+)(NNE|NNW|ENE|ESE|SSE|SSW|WNW|WSW|NE|NW|SE|SW|N|E|S|W)(?![-\w])/g;

/**
 * Put an arrow after every compass point the text under `root` names alone (see `COMPASS_RE`), skipping SVG, titles
 * and anything already carrying one. Run once after a card or tab is built; the arrows then turn with `--gg-north`.
 */
export function arrowCompass(root: ParentNode | null | undefined): void {
  if (!root) return;
  ensureNorthCss();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const parent = t.parentElement;
    if (!parent || parent.closest('svg,script,style,title,[data-gg-noarrow]')) continue;
    let node: Text = t;
    for (let guard = 0; guard < 16; guard++) {
      const s = node.data;
      COMPASS_RE.lastIndex = 0;
      const m = COMPASS_RE.exec(s);
      if (!m) break;
      const end = m.index + m[0].length;
      const a = dirArrow(m[2]);
      if (!a) break;
      if (end === s.length) {
        // The text ends on the point: an arrow built with it (whereNode, compassNode) may already follow.
        const next = node.nextSibling as Element | null;
        if (next && next.nodeType === 1 && next.classList?.contains('ms-gg-arrow')) break;
        node.after(a);
        break;
      }
      const rest = node.splitText(end);
      node.after(a);
      node = rest;
    }
  }
}

// ── the cursor card's compass dial ─────────────────────────────────────────
/**
 * A small compass for the view as it is on screen. `northDeg` is where north points on screen (clockwise from up):
 * the ring turns to it, with N kept upright, and the needle points `bearingDeg` (clockwise from north) from there,
 * so it still points at the feature when the map is rotated.
 */
export function dial(bearingDeg: number, color: string, northDeg: number): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '44');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('aria-hidden', 'true'); // the row's text already gives the distance and compass point
  svg.dataset.pbDial = String(Math.round(bearingDeg));
  const add = (parent: Element, tag: string, attrs: Record<string, string>, text?: string): SVGElement => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    parent.appendChild(e);
    return e as SVGElement;
  };
  const ring = add(svg, 'g', { 'data-pb-ring': '' });
  add(ring, 'circle', { cx: '22', cy: '22', r: '20.5', fill: 'rgba(255,255,255,.06)', stroke: 'rgba(255,255,255,.3)', 'stroke-width': '1.5' });
  add(ring, 'text', { x: '22', y: '12', 'text-anchor': 'middle', 'font-size': '11', fill: '#9aa3ad', 'font-family': 'system-ui,Segoe UI,Arial,sans-serif', 'data-pb-n': '' }, 'N');
  for (const [x1, y1, x2, y2] of [[41.5, 22, 37.5, 22], [22, 41.5, 22, 37.5], [2.5, 22, 6.5, 22]]) {
    add(ring, 'line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), stroke: '#9aa3ad', 'stroke-width': '1.5' });
  }
  add(svg, 'polygon', {
    points: '22,14 27.5,30 22,26 16.5,30',
    fill: color,
    stroke: color,
    'stroke-width': '1.5',
    'stroke-linejoin': 'round',
    'data-pb-needle': '',
  });
  orientDial(svg, northDeg);
  return svg;
}

/** Turn an existing dial to a new on-screen north, without rebuilding it. */
export function orientDial(svg: Element, northDeg: number): void {
  const north = Math.round(northDeg);
  const bearing = Number(svg.getAttribute('data-pb-dial')) || 0;
  svg.querySelector('[data-pb-ring]')?.setAttribute('transform', `rotate(${north} 22 22)`);
  svg.querySelector('[data-pb-n]')?.setAttribute('transform', `rotate(${-north} 22 8)`); // keep the letter upright, turning about its own centre so it stays on the north line
  svg.querySelector('[data-pb-needle]')?.setAttribute('transform', `rotate(${north + bearing} 22 22)`);
}

// ── canvases ───────────────────────────────────────────────────────────────
type PaintedCanvas = HTMLCanvasElement & { __ggPaint?: (northDeg: number) => void };

/**
 * A canvas map that must be repainted when north moves: `paint(northDeg)` draws it whole. The painter lives on the
 * element (not in a module map), so a second instance of this module (Vite HMR, two bundles) still finds it.
 */
export function registerCanvas(cv: HTMLCanvasElement, paint: (northDeg: number) => void): void {
  cv.dataset.gvCanvas = '';
  (cv as PaintedCanvas).__ggPaint = paint;
}

// ── the one pass ───────────────────────────────────────────────────────────
/** Turn every rose, arrow, dial, picture and canvas under `root` (itself included) to the map's north, with no rebuild. */
export function orientNorth(root: ParentNode | null | undefined, northDeg: number): void {
  if (!root) return;
  const n = Math.round(northDeg * 10) / 10;
  const self = root as Element;
  // The CSS variable goes on the outermost element that carries it, never on a part inside a card: a value stamped on
  // a card body would shadow the root's later value for every arrow inside (seen on 2026-11-07).
  const carrier = (typeof self.closest === 'function' ? self.parentElement?.closest<HTMLElement>(`[style*="${VAR}"]`) : null) ?? self;
  setNorthVar(carrier, n);
  const all = <T extends Element>(sel: string): T[] => {
    const out = Array.from(root.querySelectorAll<T>(sel));
    if (typeof self.matches === 'function' && self.matches(sel)) out.unshift(self as unknown as T);
    return out;
  };
  for (const g of all('[data-gv-rose]')) {
    const [cx, cy] = (g.getAttribute('data-gv-rose') ?? '0').split(/\s+/);
    g.setAttribute('transform', `rotate(${n} ${cx} ${cy ?? cx})`);
    g.querySelectorAll('[data-gv-upright]').forEach((u) => {
      const [x, y] = (u.getAttribute('data-gv-upright') ?? '0 0').split(/\s+/);
      u.setAttribute('transform', `rotate(${-n} ${x} ${y ?? x})`);
    });
  }
  for (const d of all('[data-pb-dial]')) orientDial(d, n);
  for (const cv of all<PaintedCanvas>('canvas[data-gv-canvas]')) cv.__ggPaint?.(n);
}
