/**
 * GroundGuideIpbTemplate.ts
 *
 * Situation templates (IPB_Plan.md §6.7, Phase 7; book s3 para 2 pp 22-23): a doctrinal template (the enemy's deployment
 * without terrain or weather, `MS/Data/IpbTemplates.json`) laid along the avenues of the area read, then each element
 * checked on its own mover's ground and moved to the nearest usable ground: "see the possible absurdities of tanks in
 * swamps and artillery on hilltops ... do not adjust known positions" (book p 23). Pure: no DOM, no view, no I/O (it runs
 * in Node: `node tools/ipb-test/template.mjs`).
 *
 *   - Placement: on an avenue (its rank), a distance back from the objective (`fromObjM`, an attack), beyond the enemy's
 *     FDL (`fromFdlM`, a defence), or from the avenue's first water crossing (`fromCrossingM`), with an offset across it;
 *     objectives at the position and the depth; crossing sites and bridgeheads at the first crossing. An avenue that is not
 *     there: beside the first, said so.
 *   - Judging: armour and mech on the IPB coding for that mover, dismounted on the dismounted coding, guns on the mech
 *     coding and never on a hilltop. More than a quarter of the footprint NO-GO: moved to the nearest ground within reach
 *     where it is usable (rings outward, the nearest first). Known enemy symbols take the place of an element of their kind
 *     within reach and are never moved. Outside the area read: placed, not judged.
 */

import type { OcokaGrid } from './GroundGuideOcoka';

export type TplMover = 'armour' | 'mech' | 'dismounted' | 'gun';
export interface TplElementSpec {
  id: string;
  label: string;
  role: string;
  mover: TplMover | null;
  place: { at?: 'objective' | 'depth' | 'firstCrossing'; aa?: number; fromObjM?: number; fromFdlM?: number; fromCrossingM?: number; acrossM?: number; boxM?: [number, number] };
  footM: number;
  key: string | null;
  ech?: string;
  basis: string;
  src?: string;
}
export interface TplSpec {
  id: string;
  label: string;
  side: string;
  kind: 'attack' | 'defence';
  fits: { readFor: 'defence' | 'attack'; hq: 'bde' | 'div'; terrain?: string };
  basis: string;
  src: string;
  text: string;
  elements: TplElementSpec[];
}
export interface TplRules {
  unusable: number;
  searchM: number;
  knownM: number;
  /** Guns are on a hill when in the upper share of the ground round them (that rises `hilltopRiseM` or more). */
  hilltopUpper: number;
  hilltopRiseM: number;
}

const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d);

export function tplRulesFrom(doc: any): TplRules {
  const M = doc?.movers ?? {};
  return { unusable: num(M.unusableShare?.value, 0.25), searchM: num(M.searchM?.value, 3000), knownM: num(M.knownM?.value, 1500), hilltopUpper: num(M.hilltop?.upper, 0.4), hilltopRiseM: num(M.hilltop?.riseM, 30) };
}
export function templatesFrom(doc: any): TplSpec[] {
  return Array.isArray(doc?.templates) ? (doc.templates as TplSpec[]) : [];
}
/** The template that fits the reading: by Read for and the HQ row, a mountain one in mountains; `want` names one. */
export function pickTemplate(doc: any, o: { readFor: 'defence' | 'attack'; hq: 'bde' | 'div'; mountain?: boolean; want?: string }): TplSpec | null {
  const all = templatesFrom(doc);
  if (o.want && o.want !== 'auto') return all.find((t) => t.id === o.want) ?? null;
  const fit = all.filter((t) => t.fits?.readFor === o.readFor && t.fits?.hq === o.hq && t.id !== 'strike-bh');
  const mtn = fit.find((t) => t.fits?.terrain === 'mountain');
  if (o.mountain && mtn) return mtn;
  return fit.find((t) => !t.fits?.terrain) ?? fit[0] ?? all.find((t) => t.fits?.readFor === o.readFor) ?? null;
}

/** An avenue in the coding's pixels, in the direction of movement, with the distance along it per point. */
export interface TplAa {
  id: string;
  rank: number;
  viable: boolean;
  pts: Array<[number, number]>;
  alongM: number[];
  narrows: Array<{ x: number; y: number; alongM: number; kind: string }>;
}
export interface TplArgs {
  grid: OcokaGrid;
  /** The coding's top-left in the grid and its size (pixels); every position here is in the coding's pixels. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** IPB codes per mover over the coding (GO 0, SLOW-GO 1, NO-GO 2, not assessed 3, not classed 4, no data 255). */
  codes: Partial<Record<'armour' | 'mech' | 'dismounted', Uint8Array>>;
  aas: TplAa[];
  objective: { x: number; y: number } | null;
  depth: { x: number; y: number } | null;
  /** The enemy's FDL on the leading avenue (a defence template). */
  fdl: { x: number; y: number } | null;
  known: Array<{ x: number; y: number; mover: TplMover | 'other'; label: string }>;
  template: TplSpec;
  rules: TplRules;
  res: number;
}
export type TplStatus = 'fixed' | 'ok' | 'moved' | 'known' | 'outside' | 'nowhere' | 'none';
export interface TplPlaced {
  id: string;
  label: string;
  role: string;
  mover: TplMover | null;
  key: string | null;
  ech: string | null;
  footM: number;
  basis: string;
  src: string | null;
  /** Where doctrine puts it (null when it has no place: no crossing); where it ends up. */
  doc: [number, number] | null;
  x: number;
  y: number;
  /** The direction of the avenue there (degrees, clockwise from up = north on a north-up grid). */
  dirDeg: number;
  status: TplStatus;
  movedM: number;
  nogoPct: number;
  why: string;
  /** A bridgehead's box (corners, coding pixels). */
  box?: Array<[number, number]>;
}
export interface TplResult {
  elements: TplPlaced[];
  moved: number;
  known: number;
  outside: number;
  notes: string[];
  ms: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const NOGO = 2;
const MOVER_WORD: Record<TplMover, string> = { armour: 'tanks', mech: 'mech', dismounted: 'inf', gun: 'guns' };

/** Lay a template along the avenues and check it on the ground. */
export function layTemplate(a: TplArgs): TplResult {
  const t0 = now();
  const { w, h, res } = a;
  const notes: string[] = [];
  const R = a.rules;
  const inBox = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const aas = [...a.aas].sort((p, q) => (p.viable === q.viable ? p.rank - q.rank : p.viable ? -1 : 1));
  // A point a distance along an avenue (extrapolated past its ends) and the direction there.
  const along = (aa: TplAa, m: number): { x: number; y: number; dx: number; dy: number } => {
    const P = aa.pts, A = aa.alongM;
    if (P.length < 2) return { x: P[0]?.[0] ?? 0, y: P[0]?.[1] ?? 0, dx: 0, dy: -1 };
    let i = 1;
    if (m <= A[0]) i = 1;
    else if (m >= A[A.length - 1]) i = P.length - 1;
    else while (i < P.length - 1 && A[i] < m) i++;
    const [x0, y0] = P[i - 1], [x1, y1] = P[i];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const dx = (x1 - x0) / L, dy = (y1 - y0) / L;
    const t = (m - A[i - 1]) / Math.max(1e-6, A[i] - A[i - 1]);
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, dx, dy };
  };
  // The distance along an avenue of the point on it nearest a place.
  const alongOfPoint = (aa: TplAa, x: number, y: number): number => {
    let best = Infinity, bm = aa.alongM[0] ?? 0;
    for (let i = 1; i < aa.pts.length; i++) {
      const [x0, y0] = aa.pts[i - 1], [x1, y1] = aa.pts[i];
      const dx = x1 - x0, dy = y1 - y0;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
      const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
      if (d < best) ((best = d), (bm = aa.alongM[i - 1] + (aa.alongM[i] - aa.alongM[i - 1]) * t));
    }
    return bm;
  };
  // The coding an element is judged on: its mover's, else the nearest kind there is (guns on the mech coding).
  const codeFor = (m: TplMover): Uint8Array | null => {
    if (m === 'gun') return a.codes.mech ?? a.codes.armour ?? a.codes.dismounted ?? null;
    return a.codes[m] ?? (m === 'mech' ? a.codes.armour : undefined) ?? a.codes.armour ?? a.codes.mech ?? a.codes.dismounted ?? null;
  };
  // NO-GO share of a footprint for a mover (null: nothing to judge by).
  const nogoShare = (m: TplMover, x: number, y: number, rPx: number): number | null => {
    const c = codeFor(m);
    if (!c) return null;
    const st = Math.max(1, Math.round(rPx / 6));
    let all = 0, bad = 0;
    for (let v = -rPx; v <= rPx; v += st)
      for (let u = -rPx; u <= rPx; u += st) {
        if (u * u + v * v > rPx * rPx) continue;
        const xx = Math.floor(x + u), yy = Math.floor(y + v);
        if (!inBox(xx, yy)) continue;
        const code = c[yy * w + xx];
        if (code === 255) continue;
        all++;
        if (code === NOGO) bad++;
      }
    return all ? bad / all : null;
  };
  const elevAt = (x: number, y: number): number => {
    const gx = Math.floor(x + a.ox), gy = Math.floor(y + a.oy);
    if (gx < 0 || gy < 0 || gx >= a.grid.w || gy >= a.grid.h) return NaN;
    return a.grid.elev[gy * a.grid.w + gx];
  };
  const hilltop = (x: number, y: number): boolean => {
    const e = elevAt(x, y);
    if (!(e === e)) return false;
    let hi = e, lo = e;
    for (const rM of [250, 500, 1000])
      for (let d = 0; d < 16; d++) {
        const ang = (d * Math.PI) / 8;
        const e2 = elevAt(x + (Math.cos(ang) * rM) / res, y + (Math.sin(ang) * rM) / res);
        if (e2 === e2) ((hi = Math.max(hi, e2)), (lo = Math.min(lo, e2)));
      }
    return hi - lo >= R.hilltopRiseM && e >= hi - R.hilltopUpper * (hi - lo);
  };
  const usable = (m: TplMover, x: number, y: number, rPx: number): { ok: boolean; share: number | null; top: boolean } => {
    const share = nogoShare(m, x, y, rPx);
    const top = m === 'gun' && hilltop(x, y);
    return { ok: (share === null || share <= R.unusable) && !top, share, top };
  };
  const compass = (dx: number, dy: number): string => COMPASS[Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 / 45) % 8];
  const firstCrossing = (aa: TplAa): { x: number; y: number; alongM: number } | null => {
    const c = aa.narrows.filter((n) => n.kind === 'crossing').sort((p, q) => p.alongM - q.alongM)[0];
    return c ? { x: c.x, y: c.y, alongM: c.alongM } : null;
  };
  const aaName = (aa: TplAa | undefined): string => (!aa ? 'Apch 1' : aa.id === 'axis' ? "the threat's axis" : `Apch ${aa.id}`);
  const used = new Set<number>();
  const out: TplPlaced[] = [];
  const missingAa = new Set<number>();
  for (const e of a.template.elements) {
    const base: Omit<TplPlaced, 'doc' | 'x' | 'y' | 'dirDeg' | 'status' | 'movedM' | 'nogoPct' | 'why'> = { id: e.id, label: e.label, role: e.role, mover: e.mover, key: e.key, ech: e.ech ?? null, footM: e.footM, basis: e.basis, src: e.src ?? null };
    const rPx = Math.max(1, e.footM / res);
    const P = e.place ?? {};
    // ── the doctrinal place ──
    let x = NaN, y = NaN, dir = 0, fixed = false, box: Array<[number, number]> | undefined;
    if (P.at === 'objective' || P.at === 'depth') {
      const p = P.at === 'objective' ? a.objective : a.depth;
      if (!p) {
        out.push({ ...base, doc: null, x: 0, y: 0, dirDeg: 0, status: 'none', movedM: 0, nogoPct: 0, why: P.at === 'objective' ? 'no objective in the reading' : 'no depth in the reading' });
        continue;
      }
      x = p.x;
      y = p.y;
      fixed = true;
    } else {
      const want = Math.max(1, P.aa ?? 1);
      let aa = aas[want - 1];
      let side = 0;
      if (!aa) {
        aa = aas[0];
        side = want - 1;
        if (aa) missingAa.add(want);
      }
      if (!aa) {
        out.push({ ...base, doc: null, x: 0, y: 0, dirDeg: 0, status: 'none', movedM: 0, nogoPct: 0, why: 'no avenue in the area read' });
        continue;
      }
      let m: number;
      if (P.at === 'firstCrossing' || P.fromCrossingM !== undefined) {
        const c = firstCrossing(aa);
        if (!c) {
          out.push({ ...base, doc: null, x: 0, y: 0, dirDeg: 0, status: 'none', movedM: 0, nogoPct: 0, why: `no water crossing on ${aaName(aa)}` });
          continue;
        }
        m = c.alongM + (P.fromCrossingM ?? 0);
        fixed = P.at === 'firstCrossing';
      } else if (P.fromFdlM !== undefined) {
        const f = a.fdl ?? a.objective;
        m = (f ? alongOfPoint(aa, f.x, f.y) : aa.alongM[0]) + P.fromFdlM;
      } else {
        const ob = a.objective;
        const end = aa.alongM[aa.alongM.length - 1] ?? 0;
        m = (ob ? alongOfPoint(aa, ob.x, ob.y) : end) - (P.fromObjM ?? 0);
      }
      const q = along(aa, m);
      // Right of the movement is (-dy, dx) on a y-down grid.
      const across = (P.acrossM ?? 0) / res + side * (Math.max(1500, e.footM * 3) / res);
      x = q.x - q.dy * across;
      y = q.y + q.dx * across;
      dir = ((Math.atan2(q.dx, -q.dy) * 180) / Math.PI + 360) % 360;
      if (P.boxM) {
        // A bridgehead: from the crossing, `boxM[1]` deep along the movement and `boxM[0]` wide.
        const hw = P.boxM[0] / 2 / res, dp = P.boxM[1] / res;
        const fx = q.dx, fy = q.dy, rx = -q.dy, ry = q.dx;
        box = [
          [x - rx * hw, y - ry * hw],
          [x + rx * hw, y + ry * hw],
          [x + rx * hw + fx * dp, y + ry * hw + fy * dp],
          [x - rx * hw + fx * dp, y - ry * hw + fy * dp],
        ];
      }
    }
    const doc: [number, number] = [x, y];
    if (fixed) {
      let nogoPct = 0;
      let why = e.role === 'objective' ? (P.at === 'depth' ? 'the depth (not moved)' : 'the position (not moved)') : 'at the crossing (not moved)';
      if (box && e.mover) {
        // The box's NO-GO share for its mover.
        const c = codeFor(e.mover);
        let all = 0, bad = 0;
        if (c) {
          const xs = box.map((p) => p[0]), ys = box.map((p) => p[1]);
          const st = Math.max(1, Math.round(rPx / 4));
          for (let yy = Math.floor(Math.min(...ys)); yy <= Math.max(...ys); yy += st)
            for (let xx = Math.floor(Math.min(...xs)); xx <= Math.max(...xs); xx += st) {
              if (!inBox(xx, yy) || !insidePoly(box, xx + 0.5, yy + 0.5)) continue;
              const code = c[yy * w + xx];
              if (code === 255) continue;
              all++;
              if (code === NOGO) bad++;
            }
        }
        nogoPct = all ? (100 * bad) / all : 0;
        why = all ? `bridgehead ${Math.round(nogoPct)} % NO-GO for ${MOVER_WORD[e.mover]}${nogoPct > 25 ? ': hard to expand, engineer effort' : ''}` : 'bridgehead outside the area read';
      }
      out.push({ ...base, doc, x, y, dirDeg: dir, status: 'fixed', movedM: 0, nogoPct, why, box });
      continue;
    }
    if (!inBox(x, y)) {
      out.push({ ...base, doc, x, y, dirDeg: dir, status: 'outside', movedM: 0, nogoPct: 0, why: 'outside the area read: placed, not judged' });
      continue;
    }
    // ── a known enemy symbol of its kind within reach takes its place ──
    if (e.mover) {
      const fits = (k: TplMover | 'other'): boolean => (e.mover === 'armour' ? k === 'armour' : e.mover === 'mech' ? k === 'mech' || k === 'armour' : e.mover === 'dismounted' ? k === 'dismounted' || k === 'mech' : k === 'gun');
      let bi = -1, bd = Infinity;
      a.known.forEach((k, i) => {
        if (used.has(i) || !fits(k.mover)) return;
        const d = Math.hypot(k.x - x, k.y - y) * res;
        if (d <= R.knownM && d < bd) ((bd = d), (bi = i));
      });
      if (bi >= 0) {
        used.add(bi);
        const k = a.known[bi];
        out.push({ ...base, doc, x: k.x, y: k.y, dirDeg: dir, status: 'known', movedM: Math.round(bd), nogoPct: 0, why: `known: ${k.label} ${Math.round(bd)} m off takes its place, not moved (book p 23)` });
        continue;
      }
    }
    if (!e.mover) {
      out.push({ ...base, doc, x, y, dirDeg: dir, status: 'ok', movedM: 0, nogoPct: 0, why: 'placed' });
      continue;
    }
    // ── its own ground ──
    const u = usable(e.mover, x, y, rPx);
    if (u.ok) {
      out.push({ ...base, doc, x, y, dirDeg: dir, status: 'ok', movedM: 0, nogoPct: Math.round(100 * (u.share ?? 0)), why: u.share === null ? 'not judged: no coding for its mover' : `usable for ${MOVER_WORD[e.mover]}` });
      continue;
    }
    const reason = u.top ? 'guns on a hilltop (in view)' : `${MOVER_WORD[e.mover]} on ${Math.round(100 * (u.share ?? 0))} % NO-GO`;
    const stepPx = Math.max(150, e.footM / 2) / res;
    let found: { x: number; y: number; d: number } | null = null;
    for (let r = stepPx; r * res <= R.searchM && !found; r += stepPx) {
      const n = Math.max(12, Math.min(48, Math.round((2 * Math.PI * r) / stepPx)));
      let best: { x: number; y: number; d: number } | null = null;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const cx = x + Math.cos(ang) * r, cy = y + Math.sin(ang) * r;
        if (!inBox(cx, cy)) continue;
        const v = usable(e.mover, cx, cy, rPx);
        if (!v.ok || v.share === null) continue;
        const d = Math.hypot(cx - x, cy - y);
        if (!best || d < best.d) best = { x: cx, y: cy, d };
      }
      found = best;
    }
    if (!found) {
      out.push({ ...base, doc, x, y, dirDeg: dir, status: 'nowhere', movedM: 0, nogoPct: Math.round(100 * (u.share ?? 0)), why: `${reason}: no usable ground within ${(R.searchM / 1000).toFixed(1)} km` });
      continue;
    }
    const mv = Math.round(found.d * res);
    out.push({ ...base, doc, x: found.x, y: found.y, dirDeg: dir, status: 'moved', movedM: mv, nogoPct: Math.round(100 * (u.share ?? 0)), why: `${reason}: moved ${mv >= 1000 ? `${(mv / 1000).toFixed(1)} km` : `${mv} m`} ${compass(found.x - x, found.y - y)}` });
  }
  for (const n of missingAa) notes.push(`No Apch ${n} in the area read: its elements are placed beside ${aaName(aas[0])}.`);
  return {
    elements: out,
    moved: out.filter((e) => e.status === 'moved').length,
    known: out.filter((e) => e.status === 'known').length,
    outside: out.filter((e) => e.status === 'outside').length,
    notes,
    ms: Math.round(now() - t0),
  };
}

function insidePoly(poly: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
