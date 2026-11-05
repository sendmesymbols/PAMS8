/**
 * GroundGuideSampling.ts
 *
 * Turns an Esri geometry into Web Mercator sample points for the Ground Guide
 * Guide. Dependency-free on purpose (reads plain geometry properties), so the
 * hot path allocates only small arrays and the logic is testable in Node.
 *
 * Rules (see MS/Docs/15-ground-guide.md, "Sampling rules"):
 *   point    one sample
 *   polyline every vertex + points along each segment every `stepM`
 *   polygon  ring vertices + edges as above, plus an interior grid
 * The step widens so a geometry never exceeds `maxSamples`.
 */

import { lngLatToMercator, mercatorToLngLat } from './TerrainTileCache';

export type XY = [number, number];

export interface MercShape {
  kind: 'point' | 'line' | 'area';
  /** point: one ring of points. line: paths. area: rings. All Web Mercator metres. */
  parts: XY[][];
}

function srKind(geometry: any): 'merc' | 'wgs84' | null {
  const sr = geometry?.spatialReference;
  if (!sr) return null;
  if (sr.isWebMercator === true) return 'merc';
  if (sr.isWGS84 === true) return 'wgs84';
  const wkid = sr.wkid ?? sr.latestWkid;
  if (wkid === 102100 || wkid === 3857 || wkid === 102113 || wkid === 3785) return 'merc';
  if (wkid === 4326) return 'wgs84';
  return null;
}

/** A Web Mercator position in the coordinates of `geometry`'s own spatial reference, or null when that is not Mercator or WGS84. */
export function fromMercatorXY(geometry: any, xy: XY): XY | null {
  const k = srKind(geometry);
  if (k === 'merc') return [xy[0], xy[1]];
  if (k === 'wgs84') return mercatorToLngLat(xy[0], xy[1]);
  return null;
}

/** Geometry → Web Mercator parts, or null for unsupported geometry / spatial reference. */
export function toMercatorShape(geometry: any): MercShape | null {
  if (!geometry) return null;
  const k = srKind(geometry);
  if (!k) return null;
  const conv = (x: number, y: number): XY => (k === 'merc' ? [x, y] : lngLatToMercator(x, y));
  const ring = (pts: ArrayLike<number>[]): XY[] => {
    const out: XY[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push(conv(p[0], p[1]));
    }
    return out;
  };

  switch (geometry.type) {
    case 'point': {
      if (!Number.isFinite(geometry.x) || !Number.isFinite(geometry.y)) return null;
      return { kind: 'point', parts: [[conv(geometry.x, geometry.y)]] };
    }
    case 'multipoint':
      return { kind: 'point', parts: [ring(geometry.points ?? [])] };
    case 'polyline':
      return { kind: 'line', parts: (geometry.paths ?? []).map(ring).filter((r: XY[]) => r.length > 0) };
    case 'polygon':
      return { kind: 'area', parts: (geometry.rings ?? []).map(ring).filter((r: XY[]) => r.length > 0) };
    default:
      return null;
  }
}

function pathLength(path: XY[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  if (closed && path.length > 2) {
    len += Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]);
  }
  return len;
}

function pushPath(out: XY[], path: XY[], step: number, closed: boolean): void {
  const n = path.length;
  for (let i = 0; i < n; i++) {
    out.push(path[i]);
    const next = i + 1 < n ? path[i + 1] : closed && n > 2 ? path[0] : null;
    if (!next) continue;
    const dx = next[0] - path[i][0];
    const dy = next[1] - path[i][1];
    const segs = Math.floor(Math.hypot(dx, dy) / step);
    for (let s = 1; s <= segs; s++) {
      const t = s / (segs + 1);
      out.push([path[i][0] + dx * t, path[i][1] + dy * t]);
    }
  }
}

/** Even-odd point-in-polygon across all rings (holes included). */
export function pointInRings(x: number, y: number, rings: XY[][]): boolean {
  // Indexed access, not destructuring: this is the innermost loop of the
  // per-mouse-move sampler and array destructuring costs ~10x in V8.
  let inside = false;
  for (let k = 0; k < rings.length; k++) {
    const r = rings[k];
    const n = r.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const pi = r[i];
      const pj = r[j];
      const yi = pi[1];
      const yj = pj[1];
      if (yi > y !== yj > y) {
        const xi = pi[0];
        if (x < ((pj[0] - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Sample points for a shape. `stepM` is in Web Mercator units (one tile pixel
 * at the sampling zoom); the effective step grows to respect `maxSamples`.
 */
export function samplePoints(shape: MercShape, stepM: number, maxSamples: number): XY[] {
  const step0 = Math.max(stepM, 1e-6);

  if (shape.kind === 'point') {
    const pts = shape.parts.flat();
    if (pts.length <= maxSamples) return pts;
    const stride = Math.ceil(pts.length / maxSamples);
    return pts.filter((_, i) => i % stride === 0);
  }

  const closed = shape.kind === 'area';
  const boundaryBudget = shape.kind === 'area' ? Math.max(8, Math.floor(maxSamples / 2)) : maxSamples;

  let totalLen = 0;
  let vertexCount = 0;
  for (const p of shape.parts) {
    totalLen += pathLength(p, closed);
    vertexCount += p.length;
  }
  // Vertices alone over budget → stride them; otherwise widen the step.
  const stride = vertexCount > boundaryBudget ? Math.ceil(vertexCount / boundaryBudget) : 1;
  const step = Math.max(step0, totalLen / Math.max(1, boundaryBudget - Math.min(vertexCount, boundaryBudget)));

  const out: XY[] = [];
  for (const p of shape.parts) {
    const path = stride > 1 ? p.filter((_, i) => i % stride === 0) : p;
    pushPath(out, path, step, closed);
  }

  if (shape.kind === 'area') {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of shape.parts) {
      for (let i = 0; i < p.length; i++) {
        const x = p[i][0];
        const y = p[i][1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w > 0 && h > 0) {
      const interiorBudget = Math.max(4, maxSamples - out.length);
      const cell = Math.max(step0, Math.sqrt((w * h) / interiorBudget));
      for (let y = minY + cell / 2; y < maxY; y += cell) {
        for (let x = minX + cell / 2; x < maxX; x += cell) {
          if (pointInRings(x, y, shape.parts)) out.push([x, y]);
        }
      }
    }
    // A shape smaller than one cell still gets its centre sampled.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    if (pointInRings(cx, cy, shape.parts)) out.push([cx, cy]);
  }

  if (out.length > maxSamples) {
    const s = Math.ceil(out.length / maxSamples);
    return out.filter((_, i) => i % s === 0);
  }
  return out;
}

/**
 * The edges of a line or area as ordered point runs, one per part (a ring is closed by repeating its first
 * point). Spaced `stepM` apart, widened so the total stays under `maxPoints`. Used to find which stretches of
 * a shape lie in no-go ground; empty for a point.
 */
export function boundaryPaths(shape: MercShape, stepM: number, maxPoints: number): XY[][] {
  if (shape.kind === 'point') return [];
  const closed = shape.kind === 'area';
  let totalLen = 0;
  for (const p of shape.parts) totalLen += pathLength(p, closed);
  const step = Math.max(stepM, 1e-6, totalLen / Math.max(1, maxPoints));
  return shape.parts
    .filter((p) => p.length > 0)
    .map((p) => {
      const out: XY[] = [];
      pushPath(out, p, step, closed);
      if (closed && out.length > 2) out.push(out[0]);
      return out;
    });
}

/** True when (x, y) is within `tol` of an edge of any ring / path. */
export function nearEdges(x: number, y: number, parts: XY[][], closed: boolean, tol: number): boolean {
  const t2 = tol * tol;
  for (const path of parts) {
    const n = path.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = path[i];
      const b = path[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
      const ex = a[0] + dx * t - x;
      const ey = a[1] + dy * t - y;
      if (ex * ex + ey * ey <= t2) return true;
    }
  }
  return false;
}
