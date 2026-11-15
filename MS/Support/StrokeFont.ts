import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";

/**
 * StrokeFont — capital letters drawn as map-unit strokes, so a symbol's lettering ("FDL", "GUN AREA") is part of its
 * geometry, scales with it and draws the same in 2D and 3D (no text symbol, no label engine).
 *
 * Glyphs sit in a box x -0.5..0.5, y -1..1 (y up, as map units are); `dr` is half the letter height in map units.
 * Shapes.ts draws its older acronyms letter by letter (createPL, createIGRings ...); this is the general form for new
 * symbols. Areas need the strokes as 2-point segments (closed minimally into rings, as Imp Gr does, because the 3D
 * tessellator collapses a ring that backtracks); lines take the strokes as paths.
 */
type Glyph = number[][][];

const GLYPHS: Record<string, Glyph> = {
  A: [[[-0.5, -1], [0, 1], [0.5, -1]], [[-0.27, -0.15], [0.27, -0.15]]],
  B: [[[-0.5, -1], [-0.5, 1], [0.2, 1], [0.45, 0.8], [0.45, 0.2], [0.2, 0], [-0.5, 0]], [[0.2, 0], [0.5, -0.25], [0.5, -0.75], [0.25, -1], [-0.5, -1]]],
  J: [[[0.5, 1], [0.5, -0.6], [0.25, -1], [-0.25, -1], [-0.5, -0.6]]],
  Q: [[[-0.25, 1], [0.25, 1], [0.5, 0.6], [0.5, -0.6], [0.25, -1], [-0.25, -1], [-0.5, -0.6], [-0.5, 0.6], [-0.25, 1]], [[0.1, -0.5], [0.55, -1.1]]],
  X: [[[-0.5, 1], [0.5, -1]], [[0.5, 1], [-0.5, -1]]],
  Y: [[[-0.5, 1], [0, 0], [0.5, 1]], [[0, 0], [0, -1]]],
  C: [[[0.5, 0.65], [0.25, 1], [-0.25, 1], [-0.5, 0.6], [-0.5, -0.6], [-0.25, -1], [0.25, -1], [0.5, -0.65]]],
  D: [[[-0.5, 1], [-0.5, -1], [0.1, -1], [0.5, -0.5], [0.5, 0.5], [0.1, 1], [-0.5, 1]]],
  E: [[[0.5, 1], [-0.5, 1], [-0.5, -1], [0.5, -1]], [[-0.5, 0], [0.3, 0]]],
  F: [[[0.5, 1], [-0.5, 1], [-0.5, -1]], [[-0.5, 0], [0.3, 0]]],
  G: [[[0.5, 0.65], [0.25, 1], [-0.25, 1], [-0.5, 0.6], [-0.5, -0.6], [-0.25, -1], [0.25, -1], [0.5, -0.6], [0.5, -0.1], [0.05, -0.1]]],
  H: [[[-0.5, 1], [-0.5, -1]], [[0.5, 1], [0.5, -1]], [[-0.5, 0], [0.5, 0]]],
  I: [[[0, 1], [0, -1]], [[-0.25, 1], [0.25, 1]], [[-0.25, -1], [0.25, -1]]],
  K: [[[-0.5, 1], [-0.5, -1]], [[0.5, 1], [-0.5, -0.15]], [[-0.15, 0.25], [0.5, -1]]],
  L: [[[-0.5, 1], [-0.5, -1], [0.5, -1]]],
  M: [[[-0.5, -1], [-0.5, 1], [0, 0], [0.5, 1], [0.5, -1]]],
  N: [[[-0.5, -1], [-0.5, 1], [0.5, -1], [0.5, 1]]],
  O: [[[-0.25, 1], [0.25, 1], [0.5, 0.6], [0.5, -0.6], [0.25, -1], [-0.25, -1], [-0.5, -0.6], [-0.5, 0.6], [-0.25, 1]]],
  P: [[[-0.5, -1], [-0.5, 1], [0.25, 1], [0.5, 0.75], [0.5, 0.25], [0.25, 0], [-0.5, 0]]],
  R: [[[-0.5, -1], [-0.5, 1], [0.25, 1], [0.5, 0.75], [0.5, 0.25], [0.25, 0], [-0.5, 0]], [[0, 0], [0.5, -1]]],
  S: [[[0.5, 0.7], [0.25, 1], [-0.25, 1], [-0.5, 0.7], [-0.5, 0.3], [-0.25, 0.05], [0.25, -0.05], [0.5, -0.3], [0.5, -0.7], [0.25, -1], [-0.25, -1], [-0.5, -0.7]]],
  T: [[[-0.5, 1], [0.5, 1]], [[0, 1], [0, -1]]],
  U: [[[-0.5, 1], [-0.5, -0.6], [-0.25, -1], [0.25, -1], [0.5, -0.6], [0.5, 1]]],
  V: [[[-0.5, 1], [0, -1], [0.5, 1]]],
  W: [[[-0.5, 1], [-0.25, -1], [0, 0.2], [0.25, -1], [0.5, 1]]],
  Z: [[[-0.5, 1], [0.5, 1], [-0.5, -1], [0.5, -1]]],
  '0': [[[-0.25, 1], [0.25, 1], [0.5, 0.6], [0.5, -0.6], [0.25, -1], [-0.25, -1], [-0.5, -0.6], [-0.5, 0.6], [-0.25, 1]]],
  '1': [[[-0.2, 0.7], [0.05, 1], [0.05, -1]], [[-0.25, -1], [0.35, -1]]],
  '2': [[[-0.5, 0.6], [-0.25, 1], [0.25, 1], [0.5, 0.6], [0.5, 0.25], [-0.5, -1], [0.5, -1]]],
  '3': [[[-0.5, 1], [0.5, 1], [0, 0.1], [0.35, 0.05], [0.5, -0.4], [0.3, -0.9], [-0.1, -1], [-0.5, -0.8]]],
  '4': [[[0.25, -1], [0.25, 1], [-0.5, -0.4], [0.5, -0.4]]],
  '5': [[[0.5, 1], [-0.45, 1], [-0.5, 0.1], [0.2, 0.15], [0.5, -0.2], [0.5, -0.7], [0.2, -1], [-0.5, -0.85]]],
  '6': [[[0.4, 1], [-0.1, 0.8], [-0.5, 0.1], [-0.5, -0.6], [-0.2, -1], [0.25, -1], [0.5, -0.65], [0.5, -0.2], [0.2, 0.05], [-0.2, 0.05], [-0.5, -0.25]]],
  '7': [[[-0.5, 1], [0.5, 1], [-0.1, -1]]],
  '8': [[[0, 0.05], [-0.4, 0.3], [-0.4, 0.75], [-0.15, 1], [0.15, 1], [0.4, 0.75], [0.4, 0.3], [0, 0.05], [-0.5, -0.3], [-0.5, -0.75], [-0.2, -1], [0.2, -1], [0.5, -0.75], [0.5, -0.3], [0, 0.05]]],
  '9': [[[0.5, 0.25], [0.2, -0.05], [-0.2, -0.05], [-0.5, 0.2], [-0.5, 0.65], [-0.2, 1], [0.2, 1], [0.5, 0.65], [0.5, -0.1], [0.1, -0.8], [-0.4, -1]]],
};

/** Width the glyph takes before the next one starts, in dr. */
const ADVANCE = 1.5;
const SPACE = 1.0;

/** Total width of `text` in map units at half-height `dr`. */
export function wordWidth(text: string, dr: number): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += ch === ' ' ? SPACE * dr : ADVANCE * dr;
  return Math.max(0, w - (ADVANCE - 1) * dr);
}

/**
 * Strokes of `text` centred on (cx, cy), letters `2 * dr` high, turned `angleRad` anticlockwise (map convention).
 * Unknown characters are left as a gap.
 */
export function wordStrokes(text: string, cx: number, cy: number, dr: number, sp: SpatialReference, angleRad = 0): Point[][] {
  const out: Point[][] = [];
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  let x = -wordWidth(text, dr) / 2 + dr / 2;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') { x += SPACE * dr; continue; }
    for (const stroke of GLYPHS[ch] ?? []) {
      out.push(stroke.map(([gx, gy]) => {
        const lx = x + gx * dr, ly = gy * dr;
        return new Point({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos, spatialReference: sp });
      }));
    }
    x += ADVANCE * dr;
  }
  return out;
}

/** The same strokes as 2-point segments [[x, y], [x, y]], for adding to a polygon as minimal rings. */
export function wordSegments(text: string, cx: number, cy: number, dr: number, sp: SpatialReference, angleRad = 0): number[][][] {
  const segs: number[][][] = [];
  for (const s of wordStrokes(text, cx, cy, dr, sp, angleRad)) {
    for (let i = 1; i < s.length; i++) segs.push([[s[i - 1].x, s[i - 1].y], [s[i].x, s[i].y]]);
  }
  return segs;
}

export default { wordStrokes, wordSegments, wordWidth };
