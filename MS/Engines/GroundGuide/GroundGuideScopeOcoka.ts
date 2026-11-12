/**
 * GroundGuideScopeOcoka.ts
 *
 * What the Gr Scope rail draws in the Extended View (F; the OCOKA lens until 2026-11-12; user, 2026-11-11: "Do Gr
 * Scope next"): the map products for one spot, turned from Web Mercator into the rail's own frame, ground metres east / north of the spot it is centred
 * on. Pure: no DOM, no view, no I/O. The products themselves are worked out by `ocokaSight()` and `ocokaPlan()`
 * (GroundGuideOcokaRead); this file only moves them.
 */

import type { GroundGuideOcoka, MercXY } from './GroundGuideTypes';

export type XY = [number, number];

export interface ScopeOcokaScene {
  /** Where the reading was taken (the symbol, or the cursor for a line or area being drawn). */
  at: XY;
  /** The weapon's range the fan is drawn to, metres. */
  rangeM: number;
  /** The threat: its bearing from the spot, and its place when it is one (`distM` from the spot). */
  threat: { allRound: boolean; bearingDeg: number; at: XY | null; distM: number | null };
  /** The fire fan: its outline, and the dead and screened ground in it as one flat list of rings (x0, y0, x1, y1, ...). */
  fan: { outline: Float64Array; dead: Float64Array[]; screened: Float64Array[] } | null;
  /** Lines of sight from the spot to the ITG candidates. */
  lines: Array<{ to: XY; p: number; lostAt: XY | null }>;
  /** The threat's own view, when it is a place. */
  enemy: { at: XY; seesP: number; lostAt: XY | null; outline: Float64Array; seen: Float64Array[] } | null;
  /** Avenues of approach, the first the cheapest; null while they are still being worked out. */
  avenues: Array<{ path: Float64Array; fits: boolean; chokes: Array<{ at: XY; widthM: number; label: string }> }> | null;
  /** Where the avenues start, and whether that start is only assumed (a threat with a direction but no place). */
  from: XY | null;
  fromAssumed: boolean;
  /** A better position nearby for the same weapon. */
  better: { at: XY; distanceM: number; compass: string } | null;
}

/**
 * The reading's map products round `centre` (Web Mercator), as ground metres east / north of it. `threatAt` is the
 * threat's place when it has one. A reading without `sight` gives no fan; without `plan`, `avenues` is null.
 */
export function scopeOcokaScene(o: GroundGuideOcoka, centre: MercXY, threatAt: MercXY | null): ScopeOcokaScene {
  const k = Math.cosh(centre[1] / 6378137); // Web Mercator metres per ground metre here
  const xy = (m: MercXY): XY => [(m[0] - centre[0]) / k, (m[1] - centre[1]) / k];
  const flat = (ring: MercXY[]): Float64Array => {
    const out = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      out[i * 2] = (ring[i][0] - centre[0]) / k;
      out[i * 2 + 1] = (ring[i][1] - centre[1]) / k;
    }
    return out;
  };
  const s = o.sight ?? null;
  const p = o.plan ?? null;
  const at = xy(o.at);
  const tAt = !o.threat.allRound && o.threat.mode === 'point' && threatAt ? xy(threatAt) : null;
  return {
    at,
    rangeM: o.obstacle.rangeM,
    threat: { allRound: o.threat.allRound, bearingDeg: o.threat.bearingDeg, at: tAt, distM: tAt ? Math.hypot(tAt[0] - at[0], tAt[1] - at[1]) : null },
    fan: s ? { outline: flat(s.fan.outline), dead: s.fan.dead.map(flat), screened: s.fan.screened.map(flat) } : null,
    lines: s ? s.lines.map((l) => ({ to: xy(l.to), p: l.p, lostAt: l.blockAt ? xy(l.blockAt) : null })) : [],
    enemy: s?.enemy ? { at: xy(s.enemy.at), seesP: s.enemy.seesP, lostAt: s.enemy.blockAt ? xy(s.enemy.blockAt) : null, outline: flat(s.enemy.outline), seen: s.enemy.seen.map(flat) } : null,
    avenues: p ? p.avenues.map((a) => ({ path: flat(a.path), fits: a.fits, chokes: a.chokes.map((c) => ({ at: xy(c.at), widthM: c.widthM, label: c.label })) })) : null,
    from: p?.from ? xy(p.from) : null,
    fromAssumed: p?.fromAssumed ?? false,
    better: p?.better ? { at: xy(p.better.at), distanceM: p.better.distanceM, compass: p.better.compass } : null,
  };
}
