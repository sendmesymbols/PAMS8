/**
 * PlanPhaseLine.ts — PURE. The phase lines of a phased attack (PH-I, PH-II ...), laid as the IE solution and the user's
 * traces draw them (28 Nov 2026: Soln Aprc Attk Appx-I, two phased-attack traces): a long line across the whole attack,
 * beyond each phase's objectives, square to the direction of advance (IC s66 para 8 h p 309: "an easily recognized
 * terrain feature normally perpendicular to the direction of advance ... used to control fires and unit movement and to
 * limit the advance of attacking elements"). Drawn with the Phase Line symbol as a curve through its CTRL_PTS
 * (DRAW_TYPE 2); on the ground PlanFit moves each control point onto the linear feature it can find (a road, track,
 * canal, drain, bund, railway), so the line turns with the feature.
 *
 * Labels: PH-I, PH-II ... (the traces' words); the time it is crossed and the time the phase is complete ride on the
 * line's ends (the 2525D DTG / EDTG amplifiers), from the H-hour sum (PlanAttack.attackTimes).
 *
 * No ArcGIS, no DOM; imports nothing but the recipe helpers, so PlanSolve can use it without a cycle.
 */
import type { DoctrineSet } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';

export interface XY { x: number; y: number }
interface Item { role: string; pts: XY[] }

const P = (x: number, y: number): XY => ({ x, y });
const centre = (pts: XY[]) => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const unit = (v: XY) => { const L = Math.hypot(v.x, v.y) || 1; return P(v.x / L, v.y / L); };
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
/** PH-I, PH-II ... as the traces write them. */
export const phaseLineLabel = (n: number) => `PH-${ROMAN[n - 1] ?? n}`;

/** Each phase's objectives by role: Ph 1 obj (a Div's OBJ A and B), Ph 2 obj2 (a Div's OBJ C), Ph 3 obj3. */
export const PHASE_OBJS: string[][] = [['obj', 'objS'], ['obj2', 'objC'], ['obj3']];
/** Each phase's axes by role (the line spans the next phase's axis so it is crossed). */
export const PHASE_AXES: string[][] = [['axis', 'axisS'], ['axis2', 'axisC'], ['axis3']];

/** The phase line's frame: its centre, the direction of advance it is square to, the unit across, its half-spans. */
export interface PhaseFrame { at: XY; d: XY; across: XY; s0: number; s1: number; n: number }

/**
 * The frame of phase line `n` from the solved items: square to the direction from this phase's objectives to the next
 * phase's (the line between them is the next phase's start: the traces' PH-I runs between the Ph 1 and Ph 2 objectives),
 * or for the last phase to its own direction of advance (from the previous phase's objectives, else from the FUP).
 * Laid `attack.phaseLine.beyondObjM` beyond the far edge of the phase's objectives; it reaches across this phase's and the
 * next phase's objectives and the next phase's axis, `attack.phaseLine.overlapM` more each side. Null when the phase has
 * no objective.
 */
export function phaseFrame(items: Item[], n: number, doc: DoctrineSet): PhaseFrame | null {
  const of = (roles: string[] | undefined) => (roles ? items.filter((i) => roles.includes(i.role) && i.pts.length) : []);
  const objs = of(PHASE_OBJS[n - 1]);
  if (!objs.length) return null;
  const here = centre(objs.flatMap((o) => o.pts));
  const next = of(PHASE_OBJS[n]);
  const prev = n > 1 ? of(PHASE_OBJS[n - 2]) : [];
  const fup = items.find((i) => i.role === 'fup' && i.pts.length);
  let d: XY;
  if (next.length) d = unit(P(centre(next.flatMap((o) => o.pts)).x - here.x, centre(next.flatMap((o) => o.pts)).y - here.y));
  else if (prev.length) { const c = centre(prev.flatMap((o) => o.pts)); d = unit(P(here.x - c.x, here.y - c.y)); }
  else if (fup) { const c = centre(fup.pts); d = unit(P(here.x - c.x, here.y - c.y)); }
  else d = P(0, 1);
  const across = P(d.y, -d.x);
  const corners = objs.flatMap((o) => o.pts);
  const far = Math.max(...corners.map((p) => (p.x - here.x) * d.x + (p.y - here.y) * d.y));
  const beyond = num(doc, 'attack.phaseLine.beyondObjM', 200);
  const at = P(here.x + d.x * (far + beyond), here.y + d.y * (far + beyond));
  const spanPts = [...corners, ...next.flatMap((o) => o.pts), ...of(PHASE_AXES[n]).flatMap((a) => a.pts)];
  const s = spanPts.map((p) => (p.x - at.x) * across.x + (p.y - at.y) * across.y);
  const over = num(doc, 'attack.phaseLine.overlapM', 400);
  return { at, d, across, s0: Math.min(...s) - over, s1: Math.max(...s) + over, n };
}

/**
 * The line's control points: `attack.phaseLine.points` of them evenly across the span, the middle on the frame's centre
 * and the ends drawn back `attack.phaseLine.bowM` (a curve bowed round the objective as the traces draw it; DRAW_TYPE 2
 * makes the Phase Line symbol a curve through them).
 */
export function phaseLinePts(fr: PhaseFrame, doc: DoctrineSet): XY[] {
  const k = Math.max(3, Math.round(num(doc, 'attack.phaseLine.points', 5)));
  const bow = num(doc, 'attack.phaseLine.bowM', 150);
  const mid = (fr.s0 + fr.s1) / 2, half = (fr.s1 - fr.s0) / 2 || 1;
  const out: XY[] = [];
  for (let i = 0; i < k; i++) {
    const s = fr.s0 + ((fr.s1 - fr.s0) * i) / (k - 1);
    const t = (s - mid) / half;
    const back = bow * t * t;
    out.push(P(fr.at.x + fr.across.x * s - fr.d.x * back, fr.at.y + fr.across.y * s - fr.d.y * back));
  }
  return out;
}

/** Phase line `n` laid by geometry (no ground); null when the phase has no objective. */
export function layPhaseLine(items: Item[], n: number, doc: DoctrineSet): XY[] | null {
  const fr = phaseFrame(items, n, doc);
  return fr ? phaseLinePts(fr, doc) : null;
}

// ── on the ground ────────────────────────────────────────────────────────────────────────────────────────────────
/** Road, track, railway, canal, distributary, drain, embankment, bund, hedgerow: an easily recognized line on the ground. */
export const PHASE_LINEAR = new Set([20, 21, 22, 24, 25, 28, 34, 35, 36, 37, 38, 46, 47]);

export interface PhaseOnGround { pts: XY[]; onFeature: number; read: number; movedM: number }

/**
 * Each control point walked along the direction of advance, within `attack.phaseLine.snapM` either way (never back onto
 * the objective: no nearer it than `attack.phaseLine.minBeyondM` beyond its far edge), to the nearest easily recognized
 * linear feature (`cls` reads the class grid at a plan point; null where not loaded): the line turns with the feature.
 * Points with no feature in reach keep the curve. `onFeature` of `read` points stand on one.
 */
export function phaseLineOnGround(fr: PhaseFrame, pts: XY[], items: Item[], cls: (p: XY) => number | null, doc: DoctrineSet): PhaseOnGround {
  const snap = num(doc, 'attack.phaseLine.snapM', 250);
  const minBeyond = num(doc, 'attack.phaseLine.minBeyondM', 100);
  const beyond = num(doc, 'attack.phaseLine.beyondObjM', 200);
  const objs = items.filter((i) => (PHASE_OBJS[fr.n - 1] ?? []).includes(i.role));
  const corners = objs.flatMap((o) => o.pts);
  // how far ahead of the frame's centre the objective's far edge lies at an across position (the edge, not the box centre)
  const farAt = (s: number) => {
    const half = 400;
    const near = corners.filter((p) => Math.abs((p.x - fr.at.x) * fr.across.x + (p.y - fr.at.y) * fr.across.y - s) <= half);
    return near.length ? Math.max(...near.map((p) => (p.x - fr.at.x) * fr.d.x + (p.y - fr.at.y) * fr.d.y)) : -Infinity;
  };
  let onFeature = 0, read = 0, moved = 0;
  const out = pts.slice();
  // traced from the middle outward: each point looks first where its inner neighbour found the feature, so the line
  // follows a road or canal across the attack even where the bow drew its ends back from it
  const mid = Math.floor((pts.length - 1) / 2);
  const order = [mid];
  for (let k = 1; k < pts.length; k++) { if (mid - k >= 0) order.push(mid - k); if (mid + k < pts.length) order.push(mid + k); }
  const found = new Map<number, number>();
  for (const i of order) {
    const p = pts[i];
    const inner = i === mid ? null : i < mid ? i + 1 : i - 1;
    const carry = inner !== null ? found.get(inner) ?? 0 : 0;
    const s = (p.x - fr.at.x) * fr.across.x + (p.y - fr.at.y) * fr.across.y;
    const lo = Math.max(-snap - beyond, farAt(s) + minBeyond - ((p.x - fr.at.x) * fr.d.x + (p.y - fr.at.y) * fr.d.y));
    let known = false, hit = false;
    for (let k = 0; k <= snap && !hit; k += 25) {
      for (const sg of k === 0 ? [0] : [1, -1]) {
        const t = carry + sg * k;
        if (t < lo) continue;
        const q = P(p.x + fr.d.x * t, p.y + fr.d.y * t);
        const c = cls(q);
        if (c === null) continue;
        known = true;
        if (PHASE_LINEAR.has(c)) { onFeature++; read++; moved = Math.max(moved, Math.abs(t)); found.set(i, t); out[i] = q; hit = true; break; }
      }
    }
    if (!hit && known) read++;
  }
  return { pts: out, onFeature, read, movedM: moved };
}

/** A check row (PlanSolve.Check, structurally). */
export interface PhaseRow { name: string; st: 'pass' | 'warn' | 'fail' | 'unchecked'; reason: string }

/**
 * Every phase line of a recipe laid on the ground: its control points onto the linear features in reach (the line turns
 * with them), with a row each. `slots` are the recipe's slots (those with rule.phaseLine), `items` the solved plan.
 */
export function phaseLinesOnGround(items: Item[], slots: { role: string; label?: string; rule?: Record<string, unknown> }[], cls: (p: XY) => number | null, doc: DoctrineSet): { paths: Record<string, XY[]>; rows: PhaseRow[] } {
  const paths: Record<string, XY[]> = {}, rows: PhaseRow[] = [];
  for (const s of slots) {
    const n = Number(s.rule?.phaseLine);
    if (!Number.isFinite(n) || n < 1) continue;
    const fr = phaseFrame(items, n, doc);
    if (!fr) continue;
    const pts = phaseLinePts(fr, doc);
    const og = phaseLineOnGround(fr, pts, items, cls, doc);
    const name = `${s.label || phaseLineLabel(n)} on the ground`;
    if (!og.read) { rows.push({ name, st: 'unchecked', reason: 'the ground along it is not loaded: laid as a curve beyond the objectives' }); continue; }
    paths[s.role] = og.pts;
    const need = Math.ceil(pts.length * 0.6);
    rows.push(og.onFeature >= need
      ? { name, st: 'pass', reason: `${og.onFeature} of ${pts.length} points on an easily recognized line (road, track, canal, drain, bund, railway), moved up to ${Math.round(og.movedM)} m, so the line turns with it (IC s66 para 8 h p 309: an easily recognized terrain feature, square to the direction of advance)` }
      : { name, st: 'warn', reason: `${og.onFeature} of ${pts.length} points on an easily recognized line within ${Math.round(num(doc, 'attack.phaseLine.snapM', 250))} m: name the line by features the Coys can recognise at night (IC s66 para 8 h p 309), or mark it` });
  }
  return { paths, rows };
}

// ── timings on the line (DTG at its start, EDTG at its end) ────────────────────────────────────────────────────────
/** Minutes from H as the traces write a time when no clock is set: H, H+2:40, H-0:30. */
export function hClock(min: number): string {
  const m = Math.round(min);
  if (m === 0) return 'H';
  const a = Math.abs(m);
  return `H${m < 0 ? '-' : '+'}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/** A phase's times: commencing (crossing its SL, or PH-n-1) and complete (its objectives fought through and reorganised). */
export interface PhaseTime { commMin: number; complMin: number }

/** The amplifiers a phase line carries: commencing at its start, completing by at its end. */
export function phaseLineAmp(t: PhaseTime | null): Record<string, string> {
  return t ? { DTG: `Comm ${hClock(t.commMin)}`, EDTG: `Compl by ${hClock(t.complMin)}` } : {};
}

/** What the H-hour sum gives a phase line (PlanAttack.HSum, structurally: no import, no cycle). */
interface HTimes {
  phase2?: { obj1At: number; h2At: number; obj2At: number };
  phase3?: { obj1At: number; h2At: number; obj2At: number };
  doneAt?: number; objAt: number;
}
/**
 * Each phase's commencing and completing times from the H-hour sum: phase 1 from H until Obj 1 is fought through;
 * phase 2 from H2 (crossing PH-I) until Obj 2 is fought through (the op's end, reorganised, when it is the last);
 * phase 3 from H3 to the op's end.
 */
export function phaseTimesOf(h: HTimes | null | undefined): PhaseTime[] {
  if (!h?.phase2) return [];
  const done = h.doneAt ?? h.phase2.obj2At;
  const out: PhaseTime[] = [{ commMin: 0, complMin: h.phase2.obj1At }];
  out.push({ commMin: h.phase2.h2At, complMin: h.phase3 ? h.phase3.obj1At : done });
  if (h.phase3) out.push({ commMin: h.phase3.h2At, complMin: done });
  return out;
}
/** The items with each phase line's times on it (a new array; the items passed in are not changed). */
export function withPhaseTimes<T extends { phase?: number; amp?: Record<string, string> }>(items: T[], h: HTimes | null | undefined): T[] {
  const t = phaseTimesOf(h);
  if (!t.length) return items;
  return items.map((it) => (it.phase && t[it.phase - 1] ? { ...it, amp: { ...(it.amp ?? {}), ...phaseLineAmp(t[it.phase - 1]) } } : it));
}
