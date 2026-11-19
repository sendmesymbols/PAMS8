/**
 * PlanWhatIf.ts — PURE. Alternates, supplementary and counter-penetration posns on the ground, the routes to them on
 * foot, and the trigger table: who moves where when the enemy shells a posn, comes up a secondary approach or
 * penetrates on the main one, how long it takes, and whether that is before the enemy gets there
 * (PlanBuilder_Plan.md Phase 4). No ArcGIS, no DOM: the ground comes through PlanFit's `PlanGround`.
 *
 * Times: on foot over GO / SLOW-GO at the IPB rates (p 18, PlanDoctrine `moves`), a shelled move half as long again
 * (E); the enemy's lead tanks along the approach at the IPB vehicle rates. A route that would cross NO-GO on foot is
 * taken round it (a waypoint either side, up to `moves.detourMaxM` off the line); with none it is reported, never
 * drawn through. What the ground cannot answer (no sight data, ground still loading) stays "unchecked".
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckDetail, CheckState, XY } from './PlanSolve';
import { addNudges, mergeChecks, toLocal, toWorld, type FitFrame, type FitLayoutInput, type FittedLayout, type PlanGround } from './PlanFit';
import { solveRecipe } from './PlanSolve';
import { enemyFupM, enemyKmh, enemyMover, enemyProfile, footKmh, type EnemySpec, type TerrainKind } from './PlanContext';

export interface Route {
  /** Plan metres, start to end (the straight line, or with one waypoint round NO-GO). */
  pts: XY[];
  lengthM: number;
  /** Minutes on foot (and settling in). */
  min: number;
  /** Share of the route on SLOW-GO, %. */
  slowPct: number;
  /** Share of the route hidden from the enemy's start (null: not known). */
  coveredPct: number | null;
  detour: boolean;
  /** Moved in the unit's APCs (ORBAT), on tracked going at the vehicle rates. */
  mounted?: boolean;
  /** No way round NO-GO within the detour limit: the move is reported, not drawn. */
  blocked: boolean;
}

export interface Trigger {
  id: string;
  trigger: string;
  who: string;
  from: string;
  to: string;
  route: Route | null;
  /** Own move, minutes. */
  min: number | null;
  /** The enemy's lead tanks to the place, minutes from his start (null: no approach known). */
  enemyMin: number | null;
  st: CheckState;
  reason: string;
  /** Who keeps the ground under fire while the move is made. */
  coveredBy: string;
}

export interface SupPosn {
  /** The approach it faces. */
  apch: string;
  label: string;
  /** Plan metres. */
  centre: XY;
  w: number;
  h: number;
  /** Turned to face the approach, degrees clockwise from the plan's front. */
  turnDeg: number;
}

export interface WhatIfResult {
  triggers: Trigger[];
  sups: SupPosn[];
  /** C Pen posn astride the main approach behind the FDL, plan metres. */
  cpen: XY | null;
  /** Minutes for the enemy's lead tanks from his start to the FDL on the main approach. */
  enemyToFdlMin: number | null;
  /** The enemy's start: the threat marker, or assumed. */
  enemyStartAssumed: boolean;
  /**
   * When the threat marker lies nearer the FDL than his FUP (IBB p201 infantry 1000-1200 m, p214 tanks 2500-3000 m):
   * how far out it lies along the main approach and the FUP distance his times start from instead. Null otherwise.
   */
  enemyFromFup: { markerM: number; fupM: number } | null;
  /** His infantry pay the climb (mountains, MW p 81). */
  enemyClimbs: boolean;
  /** Who he is and how fast he comes (for the why and the fixes): his type, set by the user or the default, his rates. */
  enemyInfo: { type: string; source: string; go: number; slow: number; tracked: boolean } | null;
  /** The own moves: on foot at this rate (the ground's), or mounted (an APC unit). */
  ownGo: number;
  ownMounted: boolean;
  /** What leads his move ("lead tanks", "leading infantry"), for the wording. */
  mover: string;
}

const P = (x: number, y: number): XY => ({ x, y });
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };

/** A route on foot between two plan-metre points, round NO-GO when it must be. */
export function routeOnFoot(g: PlanGround, f: FitFrame, doc: DoctrineSet, a: XY, b: XY, from: XY | null, shelled = false, kind: TerrainKind = 'plains', mounted = false): Route {
  const foot = g.going(mounted ? 'tracked' : 'dismounted');
  // the ground's foot rates (IPB p 18 plains; IBB p 18 desert; MW p 81 mountains, + time per 300 m of climb)
  const { go, slow } = mounted ? { go: num(doc, 'moves.tankKmh.go', 24), slow: num(doc, 'moves.tankKmh.slow', 16) } : footKmh(doc, kind);
  const climbMin = !mounted && kind === 'mountain' ? num(doc, 'terrain.kinds.mountain.ascentMinPer300m', 45) / 300 : 0;
  const settle = num(doc, 'cpen.settleMin', 5);
  const detourMax = num(doc, 'moves.detourMaxM', 1500);
  /**
   * Walk a polyline: metres on GO and SLOW-GO, whether it crosses NO-GO, whether the ground was known. `found`: a way
   * the ground search found (findAvenue): its own points decide NO-GO; a sample between two of them that clips NO-GO
   * at a bend (a river bank, a cliff edge) counts as SLOW-GO, not as a crossing.
   */
  const walk = (pts: XY[], found = false) => {
    let goM = 0, slowM = 0, blocked = false, known = 0, n = 0, climbM = 0, lastE = NaN;
    if (found) for (const p of pts) { const w = toWorld(f, p); const c = g.cls(w.x, w.y); if (c !== null && foot.nogo.has(c)) blocked = true; }
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const steps = Math.max(1, Math.ceil(L / 50));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const w = toWorld(f, P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t));
        const c = g.cls(w.x, w.y);
        if (climbMin) { const e = g.elev(w.x, w.y); if (Number.isFinite(e)) { if (Number.isFinite(lastE) && e > lastE) climbM += e - lastE; lastE = e; } }
        n++;
        const d = L / steps;
        if (c === null) { goM += d; continue; }
        known++;
        if (foot.nogo.has(c)) { if (found) slowM += d; else blocked = true; }
        else if (foot.caution.has(c)) slowM += d;
        else goM += d;
      }
    }
    return { goM, slowM, blocked, known: n ? known / n : 0, climbM };
  };
  const minutes = (w: { goM: number; slowM: number; climbM: number }) => (((w.goM / 1000) / go + (w.slowM / 1000) / slow) * 60 + w.climbM * climbMin) * (shelled ? num(doc, 'moves.underFireFactor', 1.5) : 1) + settle;
  let pts = [a, b];
  let w = walk(pts);
  let detour = false;
  if (w.blocked) {
    // one waypoint either side of the middle, further out each try; the shortest clear one wins
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    let best: { pts: XY[]; w: ReturnType<typeof walk>; m: number } | null = null;
    for (const off of [300, 600, 1000, detourMax]) {
      if (off > detourMax) continue;
      for (const sgn of [1, -1]) {
        const c = [a, P(mx + nx * off * sgn, my + ny * off * sgn), b];
        const cw = walk(c);
        if (cw.blocked) continue;
        const m = minutes(cw);
        if (!best || m < best.m) best = { pts: c, w: cw, m };
      }
      if (best) break;
    }
    if (best) { pts = best.pts; w = best.w; detour = true; }
    // in broken ground (hills, nullahs) no short detour gets round: the least-cost way on the ground, as his approach
    // is found (findAvenue), kept when it starts and ends where the move does and is quicker than any detour
    const av = g.avenues?.(toWorld(f, a), toWorld(f, b), num(doc, 'moves.routeWidthM', 100), mounted ? 'tracked' : 'dismounted')?.[0]?.path;
    if (av && av.length >= 2) {
      const loc = av.map((p) => toLocal(f, p));
      const ends = Math.hypot(loc[0].x - a.x, loc[0].y - a.y) <= 150 && Math.hypot(loc[loc.length - 1].x - b.x, loc[loc.length - 1].y - b.y) <= 150;
      if (ends) {
        const way = [a, ...loc.slice(1, -1), b];
        const ww = walk(way, true);
        if (!ww.blocked && (w.blocked || minutes(ww) < minutes(w))) { pts = way; w = ww; detour = true; }
      }
    }
  }
  const lengthM = w.goM + w.slowM;
  // hidden from the enemy's start: an observer there, 3 m up, looking for men
  let coveredPct: number | null = null;
  if (from && g.sight) {
    let seen = 0, k = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const steps = Math.max(1, Math.ceil(L / 200));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = toWorld(f, P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t));
        const v = g.sight(from.x, from.y, 3, p.x, p.y, 1.7);
        if (v === null) continue;
        k++;
        if (v >= 0.5) seen++;
      }
    }
    coveredPct = k ? Math.round((100 * (k - seen)) / k) : null;
  }
  return { pts, lengthM, min: Math.round(minutes(w)), slowPct: lengthM ? Math.round((100 * w.slowM) / lengthM) : 0, coveredPct, detour, blocked: w.blocked, mounted };
}

/** Along an approach (world path from his start) to the point nearest a plan-metre place: ground metres and its index. */
export function runTo(f: FitFrame, path: XY[], to: XY): { m: number; i: number } {
  let best = Infinity, at = 0, bi = 0, run = 0;
  for (let i = 0; i < path.length; i++) {
    if (i) run += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) / f.k;
    const l = toLocal(f, path[i]);
    const d = Math.hypot(l.x - to.x, l.y - to.y);
    if (d < best) { best = d; at = run; bi = i; }
  }
  return { m: at, i: bi };
}

export interface EnemyTimeOpts {
  /** The ground: his infantry pay the climb on foot in the mountains (MW p 81), as the own moves do. */
  g?: PlanGround | null;
  /** Ground metres added before the path's start: his start set back to his FUP when the threat marker is nearer the FDL. */
  padM?: number;
}

/**
 * The enemy's leading element along an approach (world path from his start) to a plan-metre place: minutes. Infantry
 * at the ground's foot rates, Mech / Armd at the IPB vehicle rates (p 18); in the mountains his infantry also pay
 * 30-60 min per 300 m of ascent (MW p 81), the same figure the own moves pay (`routeOnFoot`).
 */
export function enemyMinutesTo(f: FitFrame, doc: DoctrineSet, path: XY[], goPct: number, to: XY, en: EnemySpec | null = null, kind: TerrainKind = 'plains', opts: EnemyTimeOpts = {}): number {
  if (path.length < 2) return NaN;
  const { m: bestAt, i: bestI } = runTo(f, path, to);
  const type = en?.type ?? 'mech';
  const { go, slow } = enemyKmh(doc, type, kind);
  const share = Math.max(0, Math.min(100, goPct)) / 100;
  let min = ((bestAt + Math.max(0, opts.padM ?? 0)) / 1000) * (share / go + (1 - share) / slow) * 60;
  if (opts.g && kind === 'mountain' && enemyProfile(doc, type) === 'dismounted') {
    // the climb along his way to that point, every 50 m (as routeOnFoot measures the own moves)
    let climb = 0, lastE = NaN;
    for (let i = 1; i <= bestI; i++) {
      const a = path[i - 1], b = path[i], k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / f.k / 50));
      for (let s = i === 1 ? 0 : 1; s <= k; s++) {
        const e = opts.g.elev(a.x + ((b.x - a.x) * s) / k, a.y + ((b.y - a.y) * s) / k);
        if (!Number.isFinite(e)) continue;
        if (Number.isFinite(lastE) && e > lastE) climb += e - lastE;
        lastE = e;
      }
    }
    min += (climb * num(doc, 'terrain.kinds.mountain.ascentMinPer300m', 45)) / 300;
  }
  return Math.round(min);
}

/** The verdict on a move against the enemy's arrival (PlanDoctrine moves.margin). */
export function verdict(doc: DoctrineSet, min: number | null, enemyMin: number | null, blocked: boolean, mover = 'lead tanks'): { st: CheckState; reason: string } {
  if (blocked) return { st: 'fail', reason: 'no route on foot round the NO-GO ground: find a crossing or move the posn' };
  if (min === null) return { st: 'unchecked', reason: 'the ground for the route is not loaded' };
  if (enemyMin === null || !Number.isFinite(enemyMin)) return { st: 'unchecked', reason: `${min} min; the enemy's time there is not known (no approach found)` };
  const k = num(doc, 'moves.margin.warnBelow', 2);
  if (enemyMin >= k * min) return { st: 'pass', reason: `${min} min against the enemy's ${enemyMin} min` };
  if (enemyMin > min) return { st: 'warn', reason: `${min} min against the enemy's ${enemyMin} min: little to spare, trigger it early` };
  return { st: 'fail', reason: `${min} min, but the enemy's ${mover} are there in ${enemyMin} min: the move must start before he does` };
}

/**
 * The what-if of a fitted defence: shelled forward posns to their alternates, the reserve to a supplementary posn
 * facing each secondary approach and to the C Pen posn astride the main one, each with its route, time and margin.
 */
export function whatIf(fl: FittedLayout, ground: PlanGround, doc: DoctrineSet, threat: XY | null): WhatIfResult {
  const res = fl.raw, f = fl.frame, fit = fl.fit;
  const en = fl.enemy ?? null, kind: TerrainKind = fl.terrain?.kind ?? 'plains';
  const mover = enemyMover(doc, en?.type ?? 'mech');
  const enType = en?.type ?? 'mech';
  const enRate = enemyKmh(doc, enType, kind);
  const out: WhatIfResult = {
    triggers: [], sups: [], cpen: null, enemyToFdlMin: null, enemyStartAssumed: fit.fromAssumed, enemyFromFup: null, enemyClimbs: false, mover,
    enemyInfo: { type: enType, source: en?.source ?? 'default', go: enRate.go, slow: enRate.slow, tracked: enemyProfile(doc, enType) !== 'dismounted' },
    ownGo: footKmh(doc, kind).go, ownMounted: !!fl.unit?.mounted,
  };
  if (fl.recipe.task === 'attack') return out;
  out.enemyClimbs = kind === 'mountain' && enemyProfile(doc, en?.type ?? 'mech') === 'dismounted';
  let from = fit.from ?? threat;
  const slot = (role: string) => res.slots.find((s) => s.role === role);
  const kindOf = (role: string) => fl.recipe.slots.find((s) => s.role === role)?.kind ?? '';
  const fwd = res.slots.filter((s) => kindOf(s.role) === 'fwd' && s.turnDeg === 0);
  const resSlot = res.slots.find((s) => kindOf(s.role) === 'res') ?? res.slots.find((s) => kindOf(s.role) === 'depth');
  const frontY = fwd.length ? Math.max(...fwd.map((s) => s.centre.y + s.hM / 2)) : 0;
  const main = fit.approaches.find((a) => a.main) ?? null;
  const fdlPoint = (a: typeof main) => {
    if (!a) return null;
    let best: XY | null = null, bd = Infinity;
    for (const w of a.path) { const l = toLocal(f, w); const d = Math.abs(l.y - frontY); if (d < bd) { bd = d; best = l; } }
    return best;
  };
  // his clock starts no nearer the FDL than his FUP (IBB p201 infantry 1000-1200 m, p214 tanks 2500-3000 m): a threat
  // marker inside it gives the way he comes, not where he starts; his way is set back to his FUP along it
  const fupM = enemyFupM(doc, en?.type ?? 'mech')[0];
  const eOpts = (a: (typeof fit.approaches)[number]): EnemyTimeOpts => {
    const at = fdlPoint(a);
    const pad = at ? Math.max(0, fupM - runTo(f, a.path, at).m) : 0;
    return { g: ground, padM: pad };
  };
  if (main) {
    const at = fdlPoint(main);
    if (at) {
      const pad = eOpts(main).padM ?? 0;
      if (pad > 0) out.enemyFromFup = { markerM: Math.round(fupM - pad), fupM: Math.round(fupM) };
      out.enemyToFdlMin = enemyMinutesTo(f, doc, main.path, main.goPct, at, en, kind, eOpts(main));
    }
    // who watches the moves: the enemy on the main approach 2.5 km out from the FDL (where he deploys), not his
    // start far back (which is often beyond the sight grid)
    let obs: XY | null = null, od = Infinity;
    for (const w of main.path) { const l = toLocal(f, w); const d = Math.abs(l.y - (frontY + 2500)); if (d < od) { od = d; obs = w; } }
    if (obs && od < 600) from = obs;
  }

  // 1. heavy shelling on a forward posn: to its alternate (computed by the solver), covered by its neighbours
  for (const alt of res.alternates) {
    const s = slot(alt.of);
    if (!s) continue;
    const r = routeOnFoot(ground, f, doc, s.centre, alt.centre, from, true, kind);
    const apch = fit.approaches.filter((a) => a.coveredBy.includes(alt.of));
    const others = apch.flatMap((a) => a.coveredBy).filter((x) => x !== alt.of);
    const cov = [...new Set(others)].map((x) => slot(x)?.label ?? x);
    const enemy = main ? enemyMinutesTo(f, doc, main.path, main.goPct, alt.centre, en, kind, eOpts(main)) : null;
    const v = verdict(doc, r.min, enemy, r.blocked, mover);
    out.triggers.push({
      id: `shell-${alt.of}`, trigger: `Heavy shelling on ${s.label}`, who: s.label, from: s.label, to: alt.label, route: r, min: r.blocked ? null : r.min,
      enemyMin: enemy, st: v.st, reason: v.reason, coveredBy: cov.length ? `${cov.join(', ')} (its approach stays under their fire)` : 'DF on its killing ground: no other posn covers its approach',
    });
  }

  // 2. a secondary approach: a supplementary posn facing it, where it closes on the FDL, manned by the reserve
  const w = (resSlot?.wM ?? 1500) * 0.7, h = (resSlot?.hM ?? 700) * 0.7;
  for (const a of fit.approaches.filter((x) => !x.main)) {
    const at = fdlPoint(a);
    if (!at) continue;
    // set back from where the approach crosses the FDL line, toward the plan's centre, facing up the approach
    const back = 500;
    const c = P(at.x * 0.85, frontY - h / 2 - back);
    const ahead = a.path.map((p) => toLocal(f, p)).find((l) => l.y > frontY + 300) ?? P(at.x, frontY + 1000);
    const turn = Math.round((Math.atan2(ahead.x - c.x, ahead.y - c.y) * 180) / Math.PI);
    const sup: SupPosn = { apch: a.id, label: `Sup ${out.sups.length + 1}`, centre: c, w, h, turnDeg: turn };
    out.sups.push(sup);
    const enemy = enemyMinutesTo(f, doc, a.path, a.goPct, at, en, kind, eOpts(a));
    const covered = a.coveredBy.length ? `${a.coveredBy.map((x) => slot(x)?.label ?? x).join(', ')} meanwhile` : 'DF on the approach meanwhile: no posn covers it yet';
    if (resSlot) {
      const r = routeOnFoot(ground, f, doc, resSlot.centre, c, from, false, kind, !!fl.unit?.mounted);
      const v = verdict(doc, r.min, enemy, r.blocked, mover);
      out.triggers.push({
        id: `sup-${a.id}`, trigger: `Enemy on ${a.id} (secondary)`, who: resSlot.label, from: resSlot.label, to: sup.label, route: r, min: r.blocked ? null : r.min,
        enemyMin: enemy, st: v.st, reason: v.reason, coveredBy: covered,
      });
    }
    // the first tank unit grouped to the plan can switch to this Sup posn too (the others stay for the main approach)
    const q = res.items.find((i) => /^tkSqn\d*$/.test(i.role) && i.pts.length);
    if (q) {
      const r = routeOnFoot(ground, f, doc, q.pts[0], c, from, false, kind, true);
      const v = verdict(doc, r.min, enemy, r.blocked, mover);
      out.triggers.push({
        id: `tk-sup-${a.id}`, trigger: `Enemy on ${a.id} (secondary)`, who: q.label, from: q.label, to: sup.label, route: r, min: r.blocked ? null : r.min,
        enemyMin: enemy, st: v.st, reason: v.reason, coveredBy: covered,
      });
    }
  }

  // 3. penetration on the main approach: the reserve, and any tank Sqn grouped to the Bn (PlanTanks.withDefTanks), to a
  // C Pen posn astride it, 400 m (Bn) behind the FDL; the Sqns go on tracks at the tank rate
  const sqns = res.items.filter((i) => /^tkSqn\d*$/.test(i.role) && i.pts.length);
  if (main && (resSlot || sqns.length)) {
    const behind = num(doc, fl.recipe.echelon === '16' ? 'cpen.behindFwdM.bn' : 'cpen.behindFwdM.coy', 400);
    const pts = main.path.map((p) => toLocal(f, p));
    let cp: XY | null = null, bd = Infinity;
    for (const l of pts) { const d = Math.abs(l.y - (frontY - behind - 350)); if (d < bd) { bd = d; cp = l; } }
    if (!(cp && bd < 400) && pts.length >= 2) {
      // the approach ends at the FDL (where the enemy closes): his penetration carries on along its last leg into the depth
      const near = (y: number) => pts.reduce((b, l) => (Math.abs(l.y - y) < Math.abs(b.y - y) ? l : b), pts[0]);
      const cross = near(frontY), ahead = near(frontY + 1000);
      const L = Math.hypot(cross.x - ahead.x, cross.y - ahead.y);
      if (L > 50 && Math.abs(cross.y - frontY) < 300) {
        const d = behind + 350;
        cp = P(cross.x + ((cross.x - ahead.x) / L) * d, cross.y + ((cross.y - ahead.y) / L) * d);
        bd = 0;
      }
    }
    const want = num(doc, 'cpen.coyMin', 30);
    if (cp && bd < 400) {
      out.cpen = cp;
      const enemy = enemyMinutesTo(f, doc, main.path, main.goPct, cp, en, kind, eOpts(main));
      if (resSlot) {
        const r = routeOnFoot(ground, f, doc, resSlot.centre, cp, from, false, kind, !!fl.unit?.mounted);
        const v = verdict(doc, r.min, enemy, r.blocked, mover);
        out.triggers.push({
          id: 'cpen-main', trigger: `Penetration on ${main.id} (main)`, who: resSlot.label, from: resSlot.label, to: 'C Pen posn', route: r, min: r.blocked ? null : r.min,
          enemyMin: enemy, st: v.st === 'pass' && r.min > want ? 'warn' : v.st,
          reason: `${v.reason}${r.min > want ? `; over the ${want} min a Coy C-attk wants (IBB)` : ''}`,
          coveredBy: `${fwd.map((s) => s.label).join(', ')} hold the shoulders`,
        });
      }
      for (const q of sqns) {
        const r = routeOnFoot(ground, f, doc, q.pts[0], cp, from, false, kind, true);
        const v = verdict(doc, r.min, enemy, r.blocked, mover);
        out.triggers.push({
          id: `tk-cpen-${q.role}`, trigger: `Penetration on ${main.id} (main)`, who: q.label, from: q.label, to: 'C Pen posn', route: r, min: r.blocked ? null : r.min,
          enemyMin: enemy, st: v.st === 'pass' && r.min > want ? 'warn' : v.st,
          reason: `${v.reason}${r.min > want ? `; over the ${want} min a C-attk wants (IBB)` : ''}`,
          coveredBy: `${fwd.map((s) => s.label).join(', ')} hold the shoulders`,
        });
      }
    } else {
      // the main approach does not run through the plan's depth: say so
      const none = (who: string, id: string): Trigger => ({ id, trigger: `Penetration on ${main.id} (main)`, who, from: who, to: 'C Pen posn', route: null, min: null, enemyMin: null, st: 'unchecked', reason: 'the main approach does not run through the plan\'s depth here: site the C Pen posn on the ground', coveredBy: '' });
      if (resSlot) out.triggers.push(none(resSlot.label, 'cpen-main'));
      for (const q of sqns) out.triggers.push(none(q.label, `tk-cpen-${q.role}`));
    }
  }
  return out;
}

const ORDER: CheckState[] = ['fail', 'warn', 'unchecked', 'pass'];

/** Where the enemy's times start from and whether he climbs, in words (the Moves row, the trigger table). */
export function enemyStartWords(w: WhatIfResult): string {
  const start = w.enemyStartAssumed ? 'an assumed start 5 km out'
    : w.enemyFromFup ? `his FUP ${fmtM(w.enemyFromFup.fupM)} out (the threat marker lies ${fmtM(w.enemyFromFup.markerM)} in front of the FDL, inside his FUP distance: IBB p201, p214)`
    : 'the threat marker';
  return `${start}${w.enemyClimbs ? '; his infantry pay the climb as yours do (MW p 81)' : ''}`;
}

/** A move in words: who goes where, on what trigger. */
const kindOfTrigger = (t: Trigger) => (t.id.startsWith('shell-') ? 'shell' : t.id.startsWith('sup-') || t.id.startsWith('tk-sup-') ? 'sup' : 'cpen');
const moveWords = (t: Trigger) => kindOfTrigger(t) === 'shell' ? `${t.who} to its alternate, when shelled`
  : kindOfTrigger(t) === 'sup' ? `${t.who} to ${t.to}, ${t.trigger.replace(/^Enemy on /, 'enemy on ')}`
  : `${t.who} to the C Pen posn, ${t.trigger.replace(/^Penetration on /, 'penetration on ')}`;
const VERDICT: Record<CheckState, string> = { pass: 'in time', warn: 'little to spare', fail: 'too late', unchecked: 'not timed' };

/**
 * The cause and the fixes for a set of moves (the plan's or the reserve's): honest about the times, each fix tied to
 * what made the move late (his speed against a move on foot, a long way, no route, a start that is only assumed).
 */
function movesDetail(w: WhatIfResult, moves: Trigger[], head: string): CheckDetail {
  const items = moves.map((t) => `${moveWords(t)}: ${t.min === null ? (t.route?.blocked ? 'no route on foot' : 'not timed') : `${t.min} min ${t.route?.mounted ? 'mounted' : 'on foot'}`}, his ${w.mover} ${t.enemyMin ?? '-'} min (${VERDICT[t.st]})`);
  // the card's short forms
  const dest = (t: Trigger) => (kindOfTrigger(t) === 'shell' ? 'alt (shelled)' : kindOfTrigger(t) === 'sup' ? t.to : 'C Pen');
  const short = moves.map((t) => `${t.who} → ${dest(t)}: ${t.min === null ? (t.route?.blocked ? 'no route' : 'not timed') : `${t.min} vs ${t.enemyMin ?? '-'} min`}`);
  const late = moves.filter((t) => t.st === 'fail' || t.st === 'warn');
  if (!late.length) return { head, items, short };
  const timed = late.filter((t) => t.min !== null && t.enemyMin !== null);
  const noRoute = late.filter((t) => t.route?.blocked);
  const e = w.enemyInfo, shelled = timed.some((t) => kindOfTrigger(t) === 'shell'), reserve = timed.some((t) => kindOfTrigger(t) !== 'shell');
  const why: string[] = [];
  if (timed.length) {
    why.push(`His ${w.mover} come ${e ? (e.tracked ? `at ${e.go} km/h on GO (IPB p 18)` : `on foot at ${e.go} km/h`) : ''} from ${enemyStartWords(w)}, and the clock starts when he moves`);
    why.push(`${w.ownMounted ? 'Your moves go mounted' : `your Coys move on foot at ${w.ownGo} km/h`}${shelled ? ', half as long again under shelling (+5 min to settle)' : ''}`);
  }
  if (noRoute.length) why.push(`${noRoute.map(moveWords).join(', ')}: no way on foot round the NO-GO`);
  const fix: string[] = [];
  if (shelled) fix.push('Start the move on the first shelling, before he leaves his start: write it into the orders as a trigger');
  if (reserve) fix.push('Commit the reserve on the first sign of his main effort, or pre-position it at the C Pen posn');
  if (timed.length && e?.tracked && !w.ownMounted) fix.push('Mount the Bn: an MIB or ABIB type (Type) moves at vehicle speed');
  if (reserve) fix.push('J moves the reserve nearer the main approach');
  if (timed.some((t) => kindOfTrigger(t) === 'shell' && (t.route?.lengthM ?? 0) > 1000)) fix.push('Site the alternate nearer when you place it: a shorter move');
  if (timed.length && e?.source === 'default' && e.tracked) fix.push('If he is infantry here, set En type: Inf in the Enemy step');
  if (timed.length && w.enemyStartAssumed) fix.push('Mark the threat where he really starts, for real times');
  else if (timed.length && !w.enemyFromFup && w.enemyToFdlMin !== null && w.enemyToFdlMin < 30) fix.push('If the Threat marker only shows his direction, drag it to where he starts');
  if (noRoute.length) fix.push('Find a crossing, or end the move on this side of the NO-GO');
  const sentence = why.map((x, i) => (i ? x : x.charAt(0).toUpperCase() + x.slice(1))).join('; ');
  const whyShort = timed.length
    ? `His ${w.mover} at ${e?.go ?? '-'} km/h${e && !e.tracked ? ' on foot' : ''} beat ${w.ownMounted ? 'your mounted moves' : `Coys on foot at ${w.ownGo} km/h`}${shelled ? ' under shelling' : ''}`
    : 'No way on foot round the NO-GO';
  return { head, items, why: `${sentence}.`, fix, short, whyShort };
}

/**
 * Tank AT cover: tank units grouped to the plan (items tkSqn, tkSqn2 ...) fire their guns from the C Pen posn on the main
 * approach and the Sup posn on a secondary one. For each approach, how far beyond the FDL its path stays within the tank
 * gun's effective range (`atFramework.tankGunEffM`, E: printed only for the Al-Zarrar) of that posn; it counts as covered
 * by the guns when that is `atFramework.tankCoverMinM` or more. Null: no tank unit, no approach found.
 */
export function tankCoverRow(res: { items: { role: string }[]; slots: { role: string; centre: XY; hM: number; turnDeg: number }[] }, recipe: Recipe, w: WhatIfResult, fit: { approaches: { id: string; main: boolean; path: XY[] }[] }, f: FitFrame, doc: DoctrineSet): Check | null {
  if (!res.items.some((i) => /^tkSqn\d*$/.test(i.role)) || !fit.approaches.length) return null;
  const gun = num(doc, 'atFramework.tankGunEffM', 2500), min = num(doc, 'atFramework.tankCoverMinM', 500);
  const fwd = res.slots.filter((s) => recipe.slots.find((x) => x.role === s.role)?.kind === 'fwd' && s.turnDeg === 0);
  const frontY = fwd.length ? Math.max(...fwd.map((s) => s.centre.y + s.hM / 2)) : 0;
  const parts: string[] = [];
  let worst: CheckState = 'pass';
  for (const a of fit.approaches) {
    const sup = w.sups.find((s) => s.apch === a.id);
    const at = a.main ? w.cpen : sup?.centre ?? null;
    const name = `${a.id}${a.main ? ' (main)' : ''}`;
    if (!at) { parts.push(`${name}: no C Pen or Sup posn to fire from`); if (worst === 'pass') worst = 'warn'; continue; }
    let reach = 0;
    for (const p of a.path) { const l = toLocal(f, p); if (l.y >= frontY && Math.hypot(l.x - at.x, l.y - at.y) <= gun) reach = Math.max(reach, l.y - frontY); }
    reach = Math.round(reach / 10) * 10;
    const from = a.main ? 'the C Pen posn' : sup!.label;
    parts.push(`${name}: ${reach >= min ? `under their guns ${reach} m beyond the FDL from ${from}` : reach > 0 ? `only ${reach} m beyond the FDL under their guns from ${from}` : `out of their gun range from ${from}`}`);
    if (reach < min) worst = 'warn';
  }
  return { name: 'Tank AT cover', st: worst, reason: `${parts.join('; ')} (tank gun ${fmtM(gun)} effective, E: SO's Hbk Sec 1 prints a gun range only for the Al-Zarrar; ${fmtM(min)} beyond the FDL wanted). Tanks in defence counter-attack and counter penetration, and lend weight to the AT layout only where it is absolutely inescapable (IC s105 para 21c p 555; kept concentrated, inside the main defences only by exception: OoW I s6 para 1 p 22): this is their reach once there, not a post for them` };
}

/** The plan row: how many moves are well before the enemy, which ones he wins, why and what fixes it. Null with no triggers. */
export function movesRow(w: WhatIfResult): Check | null {
  if (!w.triggers.length) return null;
  const worst = ORDER.find((s) => w.triggers.some((t) => t.st === s)) ?? 'unchecked';
  const ok = w.triggers.filter((t) => t.st === 'pass').length;
  const bad = w.triggers.filter((t) => t.st === 'fail');
  return {
    name: 'Moves in time', st: worst,
    reason: `${ok} of ${w.triggers.length} moves in time${bad.length ? `; ${bad.map((t) => `${moveWords(t)}: ${t.min === null ? 'no route on foot' : `${t.min} min against his ${t.enemyMin ?? '-'} min`}`).join('; ')}` : ''}; his times from ${enemyStartWords(w)} (trigger table)`,
    detail: movesDetail(w, w.triggers, `${ok} of ${w.triggers.length} in time`),
  };
}

/** The reserve's own check: its moves (Sup, C Pen) against the enemy, so J can move it nearer when it is too slow. */
export function reserveMovesCheck(w: WhatIfResult, resLabel: string): Check | null {
  const mine = w.triggers.filter((t) => !t.id.startsWith('shell-') && t.who === resLabel);
  if (!mine.length) return null;
  const st = ORDER.find((x) => mine.some((t) => t.st === x)) ?? 'unchecked';
  return {
    name: 'Moves in time', st,
    reason: mine.map((t) => `${t.to} ${t.min ?? '-'} against ${t.enemyMin ?? '-'} min`).join(', ') + (st === 'fail' ? ": too far back for the enemy's pace: J moves it nearer; where no spot is in time, mount it, pre-position it or occupy the C Pen posn before he commits" : ''),
    detail: movesDetail(w, mine, `${resLabel}: ${mine.filter((t) => t.st === 'pass').length} of ${mine.length} in time`),
  };
}

/** Trigger table as text rows (Copy as Text). */
export function triggerLines(w: WhatIfResult): string[] {
  const word: Record<CheckState, string> = { pass: 'Pass', warn: 'Warn', fail: 'Fail', unchecked: 'Not checked' };
  const L: string[] = [];
  if (w.enemyToFdlMin !== null) L.push(`  Enemy's ${w.mover} to the FDL on the main approach: about ${w.enemyToFdlMin} min from ${enemyStartWords(w)}.`);
  for (const t of w.triggers) {
    const r = t.route;
    const route = r ? `${fmtM(r.lengthM)}${r.detour ? ' round NO-GO' : ''}${r.coveredPct !== null ? `, ${r.coveredPct} % hidden` : ''}${r.slowPct ? `, ${r.slowPct} % SLOW-GO` : ''}` : '-';
    L.push(`  ${t.trigger}: ${t.who} ${t.from === t.who ? '' : `${t.from} `}-> ${t.to}; ${route}; ${t.min ?? '-'} min, enemy ${t.enemyMin ?? '-'} min [${word[t.st]}]. Covered by ${t.coveredBy || '-'}.`);
  }
  return L;
}

// ── fit and moves together (the Build tab and the Node checks) ─────────────────────────────────────────────────────

export type FittedWithMoves = FittedLayout & { whatIf: WhatIfResult };

/**
 * A fitted layout with its what-if: the supplementary and C Pen posns added to the plan (planned, with the alternates'
 * hidden / shown / none), the trigger table, and a "Moves in time" row in its checks (counted in Auto's ranking).
 */
export function withMoves(fl: FittedLayout, inp: FitLayoutInput): FittedWithMoves {
  const w = whatIf(fl, inp.ground, inp.ctx.doc, inp.threat ?? null);
  if (fl.recipe.task === 'attack') return { ...fl, whatIf: w };
  const resSlot = fl.raw.slots.find((s) => fl.recipe.slots.find((x) => x.role === s.role)?.kind === 'res');
  // keep the new posns clear of the others: step back 300 m at a time
  const boxes = fl.raw.slots.map((s) => ({ c: s.centre, w: s.wM, h: s.hM }));
  const clear = (c: XY, ww: number, hh: number) => !boxes.some((b) => Math.abs(b.c.x - c.x) < (b.w + ww) / 2 + 50 && Math.abs(b.c.y - c.y) < (b.h + hh) / 2 + 50);
  for (const s of w.sups) for (let i = 0; i < 4 && !clear(s.centre, s.w, s.h); i++) s.centre = P(s.centre.x, s.centre.y - 300);
  const extra = [
    ...w.sups.map((s) => ({ role: 'sup', key: '25151200', label: s.label, centre: s.centre, w: s.w, h: s.h, turnDeg: s.turnDeg })),
    ...(w.cpen ? [{ role: 'cpenPosn', key: '25151201', label: 'C Pen', centre: w.cpen, w: (resSlot?.wM ?? 1500) * 0.5, h: (resSlot?.hM ?? 700) * 0.5, turnDeg: 0 }] : []),
  ];
  // the alternates' own ground: an alternate on NO-GO is no alternate
  const foot = inp.ground.going('dismounted');
  for (const t of w.triggers.filter((x) => x.id.startsWith('shell-'))) {
    const alt = fl.raw.alternates.find((a) => `shell-${a.of}` === t.id);
    if (!alt) continue;
    const p = toWorld(fl.frame, alt.centre);
    const c = inp.ground.cls(p.x, p.y);
    if (c !== null && foot.nogo.has(c)) { t.st = 'fail'; t.reason = `${alt.label} sits on ${inp.ground.label(c)} (NO-GO on foot): site it on the ground`; }
  }
  const raw = extra.length && inp.opts.alternates !== 'none'
    ? solveRecipe(fl.recipe, inp.ctx, { ...inp.opts, nudges: addNudges(fl.manual, fl.fit.nudges), placed: fl.fit.killingGr ? { killingGr: fl.fit.killingGr } : undefined, extraPosns: extra, outlines: fl.fit.outlines, paths: fl.fit.paths, extraPoints: fl.fit.atExtras, mountedReserve: !!fl.unit?.mounted, reserveKmh: fl.terrain?.kind === 'desert' || fl.terrain?.kind === 'mountain' ? footKmh(inp.ctx.doc, fl.terrain.kind).go : undefined })
    : fl.raw;
  const merged = mergeChecks(raw, fl.fit);
  // the fitted rows as fitLayout left them (the enemy force, the ground, AT cover come with them): the planned posns
  // added here change no geometry row
  const rows = [...fl.res.rows];
  const mr = movesRow(w);
  if (mr) rows.push(mr);
  // tank units grouped to it: their guns on each approach from the C Pen or Sup posn
  const tc = fl.recipe.defTanks ? tankCoverRow(fl.raw, fl.recipe, w, fl.fit, fl.frame, inp.ctx.doc) : null;
  if (tc) rows.push(tc);
  // the reserve carries its own moves' verdict, so J can move it nearer where it must go when it is too slow
  const resS = fl.raw.slots.find((s) => fl.recipe.slots.find((x) => x.role === s.role)?.kind === 'res');
  const rc = resS ? reserveMovesCheck(w, resS.label) : null;
  const sl = rc ? merged.slots.find((s) => s.role === resS!.role) : null;
  if (rc && sl) {
    sl.checks = [...sl.checks, rc];
    sl.st = sl.checks.some((c) => c.st === 'fail') ? 'fail' : sl.checks.some((c) => c.st === 'warn') ? 'warn' : sl.checks.some((c) => c.st === 'unchecked') ? 'unchecked' : 'pass';
  }
  const all = [...rows, ...merged.slots.flatMap((s) => s.checks)];
  const fit = { ...fl.fit, fails: all.filter((c) => c.st === 'fail').length, warns: all.filter((c) => c.st === 'warn').length };
  const res = { ...fl.res, items: raw.items, rows, slots: merged.slots };
  return { ...fl, raw, res, fit, whatIf: w };
}
