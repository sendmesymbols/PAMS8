/**
 * TacArrowGeometry.ts
 *
 * Filled tactical arrows — the axis-of-advance / main-attack silhouette — as
 * pure geometry: a clicked spine plus a body width becomes a closed outline.
 *
 * Screen space only. Everything here is plain `{x, y}` in pixels, with no
 * fabric, no ArcGIS and no DOM, so the slide editor, present mode and the PPTX
 * exporter can all generate the same ring at their own scale.
 *
 * The map side already draws these (MS/Symbols/FreehandMainAttackArrow.ts and
 * friends), but that code is bound to ArcGIS Point/Polygon, GeoTools and a live
 * view. Re-deriving it in ~150 screen-space lines was the cheaper trade than
 * extracting a shared kernel out from under a dozen map symbol classes; if
 * those are ever refactored, this is the natural second consumer.
 */

import type { ArrowType } from './OverlayFabric';

export interface Pt {
  x: number;
  y: number;
}

export interface TacArrowSpec {
  /** Clicked spine, 2+ points, in pixels. */
  points: Pt[];
  /** Body thickness in pixels (the arrow's waist, not a stroke weight). */
  widthPx: number;
  /** Head length as a fraction of spine length. */
  headRatio?: number;
  /** Narrow the body toward the tail. */
  taper?: boolean;
  /** Draw a head at the last point. Default true. */
  headAtEnd?: boolean;
  /** Draw a head at the first point too — the two-headed attack arrow. */
  headAtStart?: boolean;
  /** Spine shape, sharing the thin arrow's vocabulary. */
  arrowType?: ArrowType;
}

export interface TacArrowOutline {
  /** Closed outline, ready for fabric.Path or pptx custGeom. */
  ring: Pt[];
  /** The same ring as an SVG path. */
  d: string;
}

/** Barb half-width as a multiple of the body's half-width. */
const HEAD_SPREAD = 2.2;
/** Body half-width at the tail when tapering, as a fraction of full width. */
const TAPER_MIN = 0.4;
/** Samples generated per spine segment — dense enough that joins read smooth. */
const SAMPLES_PER_SEGMENT = 24;
const ELBOW_FILLET_PX = 12;

const n2 = (v: number): number => Number(v.toFixed(2));

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Densify a polyline so offsetting it produces smooth sides rather than miter spikes. */
function densify(poly: Pt[], perSegment: number): Pt[] {
  if (poly.length < 2) return poly.slice();
  const out: Pt[] = [poly[0]];
  for (let i = 0; i < poly.length - 1; i++) {
    for (let s = 1; s <= perSegment; s++) out.push(lerp(poly[i], poly[i + 1], s / perSegment));
  }
  return out;
}

/**
 * Catmull-Rom through the clicked points, sampled — the same control-point
 * formula `buildCurvedArrowPath` uses, so a curved tacArrow follows exactly the
 * path a curved thin arrow would.
 */
function sampleCurved(points: Pt[], perSegment: number): Pt[] {
  const out: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    for (let s = 1; s <= perSegment; s++) {
      const t = s / perSegment;
      const u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * p2.y,
      });
    }
  }
  return out;
}

/** Orthogonal routing with rounded corners, matching `buildElbowArrowPath`. */
function sampleElbow(points: Pt[], perSegment: number): Pt[] {
  const ortho: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(b.x - a.x) > 0.5 && Math.abs(b.y - a.y) > 0.5) ortho.push({ x: b.x, y: a.y });
    ortho.push(b);
  }
  // Corner fillets keep the offset sides from kinking at 90° turns.
  const rounded: Pt[] = [ortho[0]];
  for (let i = 1; i < ortho.length - 1; i++) {
    const prev = ortho[i - 1];
    const cur = ortho[i];
    const next = ortho[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const r = Math.min(ELBOW_FILLET_PX, inLen / 2, outLen / 2);
    const a = { x: cur.x - ((cur.x - prev.x) / inLen) * r, y: cur.y - ((cur.y - prev.y) / inLen) * r };
    const b = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    rounded.push(a);
    for (let s = 1; s < 8; s++) {
      const t = s / 8;
      const u = 1 - t;
      rounded.push({
        x: u * u * a.x + 2 * u * t * cur.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * cur.y + t * t * b.y,
      });
    }
    rounded.push(b);
  }
  rounded.push(ortho[ortho.length - 1]);
  return densify(rounded, Math.max(2, Math.round(perSegment / 4)));
}

function sampleSpine(points: Pt[], type: ArrowType): Pt[] {
  if (type === 'curved') return sampleCurved(points, SAMPLES_PER_SEGMENT);
  if (type === 'elbow') return sampleElbow(points, SAMPLES_PER_SEGMENT);
  return densify(points, SAMPLES_PER_SEGMENT);
}

/** Cumulative arc length at each sample. */
function cumulative(poly: Pt[]): number[] {
  const acc = [0];
  for (let i = 1; i < poly.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  }
  return acc;
}

/** Unit normal (left of travel) at sample `i`. */
function normalAt(poly: Pt[], i: number): Pt {
  const a = poly[Math.max(0, i - 1)];
  const b = poly[Math.min(poly.length - 1, i + 1)];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/**
 * Build the closed outline. Returns null when the spine is degenerate (fewer
 * than two distinct points), which the callers treat as "nothing to draw".
 */
export function buildTacArrowOutline(spec: TacArrowSpec): TacArrowOutline | null {
  const pts = (spec.points ?? []).filter((p) => p && isFinite(p.x) && isFinite(p.y));
  if (pts.length < 2) return null;

  const poly = sampleSpine(pts, spec.arrowType ?? 'sharp');
  const acc = cumulative(poly);
  const total = acc[acc.length - 1];
  if (!(total > 1)) return null;

  const half = Math.max(1, spec.widthPx) / 2;
  const headAtEnd = spec.headAtEnd !== false;
  const headAtStart = !!spec.headAtStart;
  const heads = (headAtEnd ? 1 : 0) + (headAtStart ? 1 : 0);
  // Two heads share the spine, so neither may eat more than its half of it.
  const maxHead = heads > 1 ? total * 0.45 : total * 0.85;
  const rawHead = (spec.headRatio ?? 0.15) * total;
  // maxHead is the outer clamp, applied last: a short spine with a thick body
  // would otherwise take the `half * 1.5` floor, push the head base past the
  // tail, and collapse the outline to nothing.
  const headLen = Math.min(maxHead, Math.max(half * 1.5, rawHead));

  const startCut = headAtStart ? headLen : 0;
  const endCut = headAtEnd ? total - headLen : total;

  /** Index of the first sample at or past arc length `s`. */
  const indexAt = (s: number): number => {
    for (let i = 0; i < acc.length; i++) if (acc[i] >= s) return i;
    return acc.length - 1;
  };
  const iStart = indexAt(startCut);
  const iEnd = indexAt(endCut);

  // Body half-width at a sample: constant, or tapering from tail to head base.
  const bodyHalf = (i: number): number => {
    if (!spec.taper) return half;
    const span = Math.max(1e-6, acc[iEnd] - acc[iStart]);
    const t = Math.max(0, Math.min(1, (acc[i] - acc[iStart]) / span));
    // A two-headed arrow has no tail to taper from, so it swells in the middle
    // instead — narrow at both heads, full width at the waist.
    const f = heads > 1 ? 1 - Math.abs(t - 0.5) * 2 * (1 - TAPER_MIN) : TAPER_MIN + (1 - TAPER_MIN) * t;
    return half * f;
  };

  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = iStart; i <= iEnd; i++) {
    const nrm = normalAt(poly, i);
    const hw = bodyHalf(i);
    left.push({ x: poly[i].x + nrm.x * hw, y: poly[i].y + nrm.y * hw });
    right.push({ x: poly[i].x - nrm.x * hw, y: poly[i].y - nrm.y * hw });
  }
  if (!left.length || !right.length) return null;

  const barb = half * HEAD_SPREAD;
  const ring: Pt[] = [...left];

  if (headAtEnd) {
    const nrm = normalAt(poly, iEnd);
    const base = poly[iEnd];
    const tip = poly[poly.length - 1];
    ring.push({ x: base.x + nrm.x * barb, y: base.y + nrm.y * barb });
    ring.push(tip);
    ring.push({ x: base.x - nrm.x * barb, y: base.y - nrm.y * barb });
  }

  for (let i = right.length - 1; i >= 0; i--) ring.push(right[i]);

  if (headAtStart) {
    const nrm = normalAt(poly, iStart);
    const base = poly[iStart];
    const tip = poly[0];
    ring.push({ x: base.x - nrm.x * barb, y: base.y - nrm.y * barb });
    ring.push(tip);
    ring.push({ x: base.x + nrm.x * barb, y: base.y + nrm.y * barb });
  }

  let d = `M ${n2(ring[0].x)} ${n2(ring[0].y)}`;
  for (let i = 1; i < ring.length; i++) d += ` L ${n2(ring[i].x)} ${n2(ring[i].y)}`;
  d += ' Z';

  return { ring, d };
}

/** Axis-aligned bounds of an outline — used to place the fabric object. */
export function outlineBounds(ring: Pt[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}
