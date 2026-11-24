/**
 * PlanWithdrawal -- a Bn withdrawal by night laid on the ground (IC s91-93 pp 481-491; IBB s72-76 pp 366-386).
 *
 * The frame of a withdrawal recipe points the way the Bn goes: y is the direction of withdrawal (the aim), the enemy lies
 * at -y, the old posn round the pivot (the Bn HQ). The rules as written: control points (Coy and Bn checkpoints and RVs,
 * the embussing point) on the routes back (IC s92 paras 7-8 pp 486-487); Coy embussing points about 1500-2000 m behind the
 * old posn on the Coy routes where parallel routes allow, else one Bn embussing point behind the Bn RV (IBB s75 para 19
 * p 383); a platoon of the depth Coys covers the Bn embussing point (IBB p 379); rear parties, a platoon from each
 * forward Coy with part of the weapons, stay to the time of abandonment (IC s92 para 13 p 488); the intermediate posn,
 * held by a Coy group, far enough back that the En must at least move En field artillery before the En can range the next posn,
 * behind a natural obstacle if available (IBB s74 para 4 e p 373; IC s91 para 3 p 482); part of the artillery
 * repositioned 5000-6000 m back before the posn is abandoned (IBB s76 para 5 p 385); the programme from last light to the
 * time of denial (IBB s75 para 11 pp 379-380).
 *
 * Pure: plan metres through the FitFrame onto the ground (PlanGround). Geometry only lays the control points by the
 * figures; on the ground the routes go round NO-GO on foot, the embussing points slide onto a track, the intermediate
 * posn is judged against En guns and the obstacles between, and the routes are read for En view.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, SolveResult, XY } from './PlanSolve';
import { solveRecipe } from './PlanSolve';
import type { FitFrame, FitLayoutInput, FitResult, FittedLayout, PlanGround } from './PlanFit';
import { toLocal, toWorld } from './PlanFit';

export interface WithdrawalFind {
  nudges: Record<string, XY>;
  geom: Record<string, { pts: XY[]; label?: string }>;
  /** The routes back on the ground (plan metres), by role. */
  paths: Record<string, XY[]>;
  rows: Check[];
  confirm: string[];
  /** The programme: minutes from last light (L); `denial` is the time the posn is denied to. */
  times: { label: string; atMin: number; src: string }[];
  /** Each route's length and night march time. */
  routes: { role: string; label: string; lengthM: number; min: number; seenPct: number | null }[];
}

const P = (x: number, y: number): XY => ({ x, y });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const rng = (doc: DoctrineSet, path: string, fb: [number, number]) => resolveRange(doc, doctrineAt(doc, path)) ?? fb;
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts: XY[]): XY => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const lenOf = (pts: XY[]) => { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; };
const WATER = new Set([4, 5, 20, 21, 22, 46]);
const ROADS = new Set([34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 50]);
export const hhmm = (min: number) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}${String(Math.round(((min % 60) + 60) % 60)).padStart(2, '0')}`;

/** Geometry at the aim: the new main posn at the aimed distance (the second click), the intermediate posn in between. */
export function withdrawalGeom(recipe: Recipe, doc: DoctrineSet, aimM: number | null): Record<string, { pts: XY[] }> {
  const g: Record<string, { pts: XY[] }> = {};
  const nm = recipe.slots.find((s) => s.role === 'newMain'), ip = recipe.slots.find((s) => s.role === 'intPosn');
  const d = Math.max(3000, aimM ?? num(doc, 'withdrawal.defaultNewMainM', 25000));
  const rect = (c: XY, w: number, h: number) => [P(c.x - w / 2, c.y + h / 2), P(c.x + w / 2, c.y + h / 2), P(c.x + w / 2, c.y - h / 2), P(c.x - w / 2, c.y - h / 2)];
  const sz = (s: typeof nm, fw: number, fh: number): [number, number] => { const r = s?.shape?.rect; const w = r ? resolveRange(doc, r.wM) : null, h = r ? resolveRange(doc, r.hM) : null; return [w ? (w[0] + w[1]) / 2 : fw, h ? (h[0] + h[1]) / 2 : fh]; };
  if (nm) { const [w, h] = sz(nm, 4500, 3000); g.newMain = { pts: rect(P(0, d), w, h) }; }
  if (ip) {
    const [w, h] = sz(ip, 1500, 700);
    const want = num(doc, 'withdrawal.intermediateMinM', 17200);
    const y = Math.min(want, Math.max(3000, d - 3000));
    g.intPosn = { pts: rect(P(0, y), w, h) };
  }
  return g;
}

export function findWithdrawal(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet, opts: { enFieldArtyM?: number | null; enFieldArtySrc?: string | null; threat?: XY | null; terrain?: 'plains' | 'obstacle' | 'desert' | 'mountain' } = {}): WithdrawalFind {
  const out: WithdrawalFind = { nudges: {}, geom: {}, paths: {}, rows: [], confirm: [], times: [], routes: [] };
  const item = (role: string) => res.items.find((i) => i.role === role);
  const kindOf = (role: string) => res.recipe.slots.find((s) => s.role === role)?.kind;
  const fwd = res.items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  if (!fwd.length) return out;
  const W = (p: XY) => toWorld(f, p);
  const clsAt = (p: XY) => { const w = W(p); return g.cls(w.x, w.y); };
  // the old posn's front (toward the enemy, -y) and the En observer: the threat marker, else 1500 m in front of it
  const frontY = Math.min(...fwd.flatMap((i) => i.pts.map((p) => p.y)));
  const enObs = opts.threat ? toLocal(f, opts.threat) : P(0, frontY - num(doc, 'withdrawal.hisStandoffM', 1500));

  // ── embussing points: 1500-2000 m behind the old posn on the Coy routes (IBB p 383), on a track where one is near ──
  const epBand = rng(doc, 'withdrawal.embussingBehindM', [1500, 2000]);
  const eps = res.items.filter((i) => /^ep[A-Z]$/.test(i.role));
  const epRoadM = num(doc, 'withdrawal.epRoadM', 300);
  const epWords: string[] = [];
  let epOnTrack = 0, epOff = 0;
  for (const ep of eps) {
    const coy = fwd.find((c) => c.label && ep.label?.endsWith(c.label.split(' ')[0])) ?? fwd[eps.indexOf(ep)] ?? fwd[0];
    const behind = ep.pts[0].y - centre(coy.pts).y;
    let at = ep.pts[0];
    const k0 = clsAt(at);
    if (k0 !== null && !ROADS.has(k0)) {
      // the nearest track within reach, keeping the distance behind the posn inside the band
      let best: XY | null = null, bd = Infinity;
      for (let dx = -epRoadM; dx <= epRoadM; dx += 30) for (let dy = -epRoadM; dy <= epRoadM; dy += 30) {
        const q = P(at.x + dx, at.y + dy), k = clsAt(q);
        if (k !== null && ROADS.has(k)) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = q; } }
      }
      if (best) { out.nudges[ep.role] = P(best.x - at.x, best.y - at.y); at = best; epOnTrack++; }
      else epOff++;
    } else if (k0 !== null) epOnTrack++;
    epWords.push(`${ep.label ?? ep.role} ${fmtM(behind)} behind ${coy.label ?? 'the Coy'}${k0 === null ? '' : ROADS.has(clsAt(at) ?? -1) ? ', on a track' : `, no track within ${fmtM(epRoadM)}`}`);
    if (behind < epBand[0] - 50 || behind > epBand[1] + 50) out.rows.push({ name: 'Embussing points', st: 'warn', reason: `${ep.label} ${fmtM(behind)} behind the old posn; IBB s75 para 19 p 383 wants ${fmtM(epBand[0])}-${fmtM(epBand[1])} on the Coy routes` });
  }
  if (eps.length) out.rows.push(epOff && !epOnTrack
    ? { name: 'Embussing points', st: 'warn', reason: `${epWords.join('; ')}: no track for the vehicles`, detail: { head: 'No track at the Coy embussing points', why: 'Coy embussing points save marching time only where parallel routes let the vehicles come up (IBB p 383 a); with none, one Bn embussing point behind the Bn RV (p 383 b).', fix: ['Use the Bn embussing point (EP) behind the Bn RV and bring the Bn RV well forward', 'Recce a track the map does not show'] } }
    : { name: 'Embussing points', st: 'pass', reason: `${epWords.join('; ')} (IBB s75 para 19 p 383: 1500-2000 m behind the old position on the Coy routes)` });

  // ── routes back on foot: Coy -> Coy RV -> embussing point, round NO-GO; En view along them ──────────────────────
  const night = num(doc, `attack.nightFootKmh.${opts.terrain ?? 'plains'}`, 3);
  const seenPctMax = num(doc, 'withdrawal.routeSeenPct', 30);
  const rts = res.items.filter((i) => /^rt[A-Z]$/.test(i.role) && i.pts.length >= 2);
  let seenAll = 0, seenN = 0, unknown = 0;
  for (const rt of rts) {
    const pts = rt.pts.map((p, i) => { const ep = eps.find((e) => e.role === `ep${rt.role.slice(2)}`); return i === rt.pts.length - 1 && ep && out.nudges[ep.role] ? P(p.x + out.nudges[ep.role].x, p.y + out.nudges[ep.role].y) : p; });
    const legs: XY[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const av = g.avenues?.(W(pts[i - 1]), W(pts[i]), 100, 'dismounted')?.[0]?.path;
      if (av && av.length > 2) legs.push(...av.slice(1, -1).map((w) => toLocal(f, w)));
      legs.push(pts[i]);
    }
    out.paths[rt.role] = legs;
    const L = lenOf(legs);
    let n = 0, seen = 0;
    if (g.sight) {
      const o = W(enObs);
      for (let d = 0; d <= L; d += 100) {
        let acc = 0, q = legs[0];
        for (let i = 1; i < legs.length; i++) { const s = dist(legs[i - 1], legs[i]); if (acc + s >= d) { const t = (d - acc) / (s || 1); q = P(legs[i - 1].x + (legs[i].x - legs[i - 1].x) * t, legs[i - 1].y + (legs[i].y - legs[i - 1].y) * t); break; } acc += s; q = legs[i]; }
        const w = W(q); const v = g.sight(o.x, o.y, 2, w.x, w.y, 1.7);
        if (v === null) unknown++; else { n++; if (v >= 0.5) seen++; }
      }
    }
    const pct = n ? Math.round((100 * seen) / n) : null;
    if (pct !== null) { seenAll += seen; seenN += n; }
    out.routes.push({ role: rt.role, label: rt.label || `Route ${rt.role.slice(2)}`, lengthM: Math.round(L), min: Math.round((L / 1000 / night) * 60), seenPct: pct });
  }
  if (rts.length) {
    const pct = seenN ? Math.round((100 * seenAll) / seenN) : null;
    out.rows.push(pct === null ? { name: 'Routes hidden', st: 'unchecked', reason: g.sight ? (unknown ? 'the ground along the routes is still loading' : 'no sight read') : 'no sight data' }
      : { name: 'Routes hidden', st: pct <= seenPctMax ? 'pass' : 'warn', reason: `${pct} % of the routes back in En view from ${opts.threat ? 'the threat marker' : `${fmtM(num(doc, 'withdrawal.hisStandoffM', 1500))} in front`} (wants ${seenPctMax} % or less)`,
        detail: pct <= seenPctMax ? undefined : { head: `${pct} % of the routes seen`, why: 'A clean break needs covered routes back (IC s92 para 3 p 485; IBB p 377: good covered lines of withdrawal); open ground the En sees invites fire on the thinning-out.', fix: ['Bend the routes into dead ground (a nullah, the far side of a bund)', 'Withdraw after last light; harassing fire to cover the noise', 'Rear parties hold until the companies are clear'] } });
    out.rows.push({ name: 'Routes', st: 'pass', reason: out.routes.map((r) => `${r.label} ${fmtM(r.lengthM)}, ${r.min} min by night`).join('; ') + ` (${night} km/h, IBB p 18)` });
  }

  // ── the intermediate posn: beyond En field artillery, behind an obstacle if there is one (IBB p 373; IC p 482) ──
  const ip = item('intPosn');
  if (ip && ip.pts.length >= 3) {
    const c = centre(ip.pts);
    const back = c.y - frontY;
    const arty = opts.enFieldArtyM ?? num(doc, 'withdrawal.intermediateMinM', 17200);
    const artySrc = opts.enFieldArtySrc ?? 'the En 105 mm IFG, 17.2 km (ORBAT weapons.json en-105-mm-ifg-lfg)';
    out.rows.push(back >= arty - 1
      ? { name: 'Intermediate posn', st: 'pass', reason: `${fmtM(back)} behind the old posn: the En must move En field artillery (${artySrc}) before the En can range it (IBB s74 para 4 e p 373)` }
      : { name: 'Intermediate posn', st: 'warn', reason: `${fmtM(back)} behind the old posn: inside the reach of En field artillery (${artySrc}); IBB s74 para 4 e p 373 wants the En to at least move En guns first`,
        detail: { head: `Intermediate posn ${fmtM(back)} back, En guns reach ${fmtM(arty)}`, why: 'The En guns in their present areas range it: no delay is forced on the En while the En attacks it.', fix: [`Put it ${fmtM(arty)} or more back`, 'Or make it a delaying posn for the covering troops only'] } });
    // an obstacle between: water across the way, from the old posn to the intermediate posn
    // the class grid sampled every 15 m (a canal or drain is one or two 30 m cells) on three lines across the posn's width,
    // then the mapped canals and rivers (the 1:50k lines) crossing the way back: the nearest to the intermediate posn counts
    const ipW = Math.max(...ip.pts.map((p) => p.x)) - Math.min(...ip.pts.map((p) => p.x));
    let water: number | null = null;
    for (const dx of [0, -ipW / 3, ipW / 3]) {
      for (let y = c.y - 400; y > frontY + 300; y -= 15) { const k = clsAt(P(c.x + dx, y)); if (k !== null && WATER.has(k)) { if (water === null || y > water) water = y; break; } }
    }
    let named: { y: number; name: string; wM: number | null } | null = null;
    const mov = (g.mov?.() ?? null) as unknown as { lines?: (x: number, y: number, r: number, kinds: Set<string>) => { kind: string; xy: [number, number][]; attrs?: Record<string, unknown> }[] } | null;
    if (mov?.lines) {
      const a = P(c.x, frontY + 300), b = P(c.x, c.y - 400);
      const mid = W(P(c.x, (a.y + b.y) / 2));
      const len = (b.y - a.y) * f.k;
      for (const l of mov.lines(mid.x, mid.y, len / 2 + 200, new Set(['canal', 'river'])) ?? []) {
        const pts = l.xy.map((q) => toLocal(f, { x: q[0], y: q[1] }));
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1], p1 = pts[i];
          if ((p0.x - c.x) * (p1.x - c.x) > 0 || p0.x === p1.x) continue;
          const y = p0.y + ((c.x - p0.x) / (p1.x - p0.x)) * (p1.y - p0.y);
          if (y <= a.y || y >= b.y) continue;
          const wRaw = Number(l.attrs?.w);
          const wM = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : null;
          // a mapped line counts when it is a river, or a canal recorded 10 m wide or more (a narrower or unrecorded one only by the class grid)
          if (l.kind !== 'river' && (wM === null || wM < 10)) continue;
          if (!named || y > named.y) named = { y, name: String(l.attrs?.n ?? (l.kind === 'river' ? 'a river' : 'a canal')), wM };
        }
      }
    }
    const known = clsAt(P(c.x, (frontY + c.y) / 2)) !== null;
    const obstY = named && (water === null || named.y >= water - 200) ? named.y : water;
    const obstWord = named && obstY === named.y ? `${named.name}${named.wM ? ` (${Math.round(named.wM)} m wide)` : ''}` : 'water';
    out.rows.push(!known ? { name: 'Behind an obstacle', st: 'unchecked', reason: 'the ground between is still loading' }
      : obstY !== null ? { name: 'Behind an obstacle', st: 'pass', reason: `${obstWord} ${fmtM(c.y - obstY)} in front of the intermediate posn (IC s91 para 3 e p 482: behind a natural obstacle, if available)` }
        : { name: 'Behind an obstacle', st: 'warn', reason: 'no water between the old posn and the intermediate posn (IC s91 para 3 e p 482: behind a natural obstacle, if available)', detail: { head: 'No obstacle in front of it', why: 'Without an obstacle the En closes on the intermediate posn without pause; it is held by a Coy group with less depth than a normal posn (IBB p 373 d).', fix: ['Move it behind the nearest canal, river or ditch', 'Demolitions and mines on the roads in front (IC s93 para 3 p 490)'] } });
    const clean = num(doc, 'withdrawal.cleanBreakMinM', 2000);
    const nm = item('newMain');
    if (nm && nm.pts.length >= 3) {
      const gap = Math.min(...nm.pts.map((p) => p.y)) - Math.max(...ip.pts.map((p) => p.y));
      out.rows.push({ name: 'New main posn', st: gap >= clean ? 'pass' : 'warn', reason: `${fmtM(centre(nm.pts).y - frontY)} behind the old posn, ${fmtM(gap)} beyond the intermediate posn${gap >= clean ? '' : ` (wants ${fmtM(clean)} for a clean break, E)`}; no posn is abandoned until the next is organised and at least partially manned (IBB s74 para 21 p 378)` });
    }
  }

  // ── artillery repositioned 5000-6000 m back before the posn is abandoned (IBB p 385) ─────────────────────────────
  const an = item('artyNew');
  if (an) {
    const band = rng(doc, 'withdrawal.artyRepositionM', [5000, 6000]);
    // 5000-6000 m back from the old gun area, taken at the Bn's rear (the reserve) when no gun area is on the plan
    const rear = res.items.filter((i) => kindOf(i.role) === 'res' || kindOf(i.role) === 'depth');
    const from = rear.length ? Math.max(...rear.map((i) => centre(i.pts).y)) : frontY;
    const back = centre(an.pts).y - from;
    out.rows.push({ name: 'Artillery', st: back >= band[0] - 50 && back <= band[1] + 50 ? 'pass' : 'warn', reason: `part of the artillery repositioned ${fmtM(back)} back from the old gun area (taken at the Bn's rear) to cover the last troops out (IBB s76 para 5 p 385: ${fmtM(band[0])}-${fmtM(band[1])}); the rest stays and increases its activity (para 6)` });
  }

  // ── rear parties and the covering platoon ───────────────────────────────────────────────────────────────────────
  const rps = res.items.filter((i) => /^rp[A-Z]$/.test(i.role));
  out.rows.push({ name: 'Rear parties', st: rps.length >= fwd.length ? 'pass' : 'warn', reason: `${rps.length} rear part${rps.length === 1 ? 'y' : 'ies'} for ${fwd.length} forward Coys: a platoon from each with part of the weapon section, under one commander, holding to the time of abandonment (IC s92 paras 13-14 pp 488-489)` });
  if (item('covPl')) out.rows.push({ name: 'Covering Pl', st: 'pass', reason: 'a platoon of the depth Coys covers the Bn embussing point and withdraws after the Bn has embussed (IBB s75 para 11 d, g pp 379-380)' });

  // ── the programme from last light (IBB s75 para 11 pp 379-380, the book's guide) ─────────────────────────────────
  const prog = (doctrineAt(doc, 'withdrawal.programmeMin') as Record<string, number>) ?? { echelons: 15, controlPoints: 105, depthWithdraw: 135, rearPartyIn: 165, denial: 180 };
  const src = 'IBB s75 para 11 pp 379-380';
  const T = (label: string, atMin: number) => out.times.push({ label, atMin, src });
  T('Last light', 0);
  T('Recce parties to the new main posn (by day, before)', -600);
  T('A and B echelons withdraw in small packets', prog.echelons);
  T('Checkpoints, RVs and embussing points manned; a Pl of the depth Coys covers the Bn EP', prog.controlPoints);
  T('Depth Coys and Bn HQ (less the CP) withdraw; rear parties take over from the forward Coys', prog.depthWithdraw);
  T('Rear parties in position', prog.rearPartyIn);
  T('Time of denial: Bn Comd hands over to the rear party Comd; mortars and CP withdraw; forward Coys begin to withdraw', prog.denial);
  const longest = Math.max(0, ...out.routes.map((r) => r.min));
  if (longest) T('Forward Coys clear of their embussing points', prog.denial + longest);
  T('Rear parties leave at the time of final abandonment (laid down by Bde); the covering Pl withdraws after the Bn has embussed', prog.denial + longest + 30);
  out.rows.push({ name: 'Timings', st: 'pass', reason: `the programme from last light: echelons L+${prog.echelons} min, control points manned L+${prog.controlPoints}, depth Coys out L+${prog.depthWithdraw}, rear parties in L+${prog.rearPartyIn}, denial L+${prog.denial}${longest ? `; the forward Coys clear their EPs L+${prog.denial + longest}` : ''} (${src}: a guide; Bde lays down the denial time, the no-move-before time and the clear-line time, s74 para 17 p 377)` });
  out.confirm.push('Routes back walked by day by the Coy / Pl Comds and memorised; Coy RVs and the Bn checkpoint recognisable at night (IC s91 para 5 b p 483)', 'Normal activity, wireless traffic and harassing fire kept up to the last (IC s91 paras 7-9 p 484); the line left intact to the end', 'Non-essential stores and personnel out soon after last light under the CQMH (IC s91 para 6 p 484)', 'Demolitions, nuisance mines and booby traps on the roads in front (IC s93 para 3 p 490); bridges to prepare', 'The intermediate posn: a complete Coy group under one commander, AT weapons and some armour if available (IBB s74 para 4 b-c p 373)');
  return out;
}

// ── geometry rows (PlanSolve) and the fitted layout (PlanFit) ────────────────────────────────────────────────────────

/** The rows the figures alone settle: embussing points, the intermediate posn's distance, the artillery, the rear parties. */
export function withdrawalGeometryRows(items: { role: string; label: string; pts: XY[] }[], recipe: Recipe, doc: DoctrineSet): { rows: Check[]; confirm: string[] } {
  const rows: Check[] = [];
  const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind;
  const fwd = items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  const item = (role: string) => items.find((i) => i.role === role);
  if (!fwd.length) return { rows, confirm: [] };
  const frontY = Math.min(...fwd.flatMap((i) => i.pts.map((p) => p.y)));
  const band = rng(doc, 'withdrawal.embussingBehindM', [1500, 2000]);
  const eps = items.filter((i) => /^ep[A-Z]$/.test(i.role));
  const behinds = eps.map((ep) => { const coy = fwd.find((c) => ep.label?.endsWith((c.label ?? '').split(' ')[0])) ?? fwd[eps.indexOf(ep)] ?? fwd[0]; return { ep, m: ep.pts[0].y - centre(coy.pts).y }; });
  if (behinds.length) rows.push({ name: 'Embussing points', st: behinds.every((b) => b.m >= band[0] - 50 && b.m <= band[1] + 50) ? 'pass' : 'warn', reason: `${behinds.map((b) => `${b.ep.label} ${fmtM(b.m)}`).join(', ')} behind the Coys (IBB s75 para 19 p 383: ${fmtM(band[0])}-${fmtM(band[1])} on the Coy routes; on a track: read with the terrain)` });
  const ip = item('intPosn');
  if (ip) {
    const back = centre(ip.pts).y - frontY, want = num(doc, 'withdrawal.intermediateMinM', 17200);
    rows.push({ name: 'Intermediate posn', st: back >= want - 1 ? 'pass' : 'warn', reason: `${fmtM(back)} behind the old posn: the En must move the field artillery (105 mm IFG ${fmtM(want)}, ORBAT) before ranging it (IBB s74 para 4 e p 373); held by a Coy group (IBB p 381)` });
    const nm = item('newMain');
    if (nm) { const gap = Math.min(...nm.pts.map((p) => p.y)) - Math.max(...ip.pts.map((p) => p.y)), clean = num(doc, 'withdrawal.cleanBreakMinM', 2000); rows.push({ name: 'New main posn', st: gap >= clean ? 'pass' : 'warn', reason: `${fmtM(centre(nm.pts).y - frontY)} back, ${fmtM(gap)} beyond the intermediate posn${gap >= clean ? '' : ` (wants ${fmtM(clean)}, E)`}; not abandoned until the next is organised and partly manned (IBB s74 para 21 p 378)` }); }
  }
  const an = item('artyNew');
  if (an) {
    const b2 = rng(doc, 'withdrawal.artyRepositionM', [5000, 6000]);
    const rear = items.filter((i) => kindOf(i.role) === 'res' || kindOf(i.role) === 'depth');
    const from = rear.length ? Math.max(...rear.map((i) => centre(i.pts).y)) : frontY;
    const back = centre(an.pts).y - from;
    rows.push({ name: 'Artillery', st: back >= b2[0] - 50 && back <= b2[1] + 50 ? 'pass' : 'warn', reason: `part of the artillery repositioned ${fmtM(back)} back from the old gun area (taken at the Bn rear) (IBB s76 para 5 p 385: ${fmtM(b2[0])}-${fmtM(b2[1])})` });
  }
  const rps = items.filter((i) => /^rp[A-Z]$/.test(i.role));
  rows.push({ name: 'Rear parties', st: rps.length >= fwd.length ? 'pass' : 'warn', reason: `${rps.length} for ${fwd.length} forward Coys: a platoon from each with part of the weapon section (IC s92 para 13 p 488)` });
  if (item('covPl')) rows.push({ name: 'Covering Pl', st: 'pass', reason: 'a platoon of the depth Coys covers the Bn embussing point (IBB s75 para 11 d p 379)' });
  const prog = (doctrineAt(doc, 'withdrawal.programmeMin') as Record<string, number>) ?? { echelons: 15, controlPoints: 105, depthWithdraw: 135, rearPartyIn: 165, denial: 180 };
  rows.push({ name: 'Timings', st: 'pass', reason: `from last light: echelons L+${prog.echelons} min, control points manned L+${prog.controlPoints}, depth Coys out L+${prog.depthWithdraw}, rear parties in L+${prog.rearPartyIn}, denial L+${prog.denial} (IBB s75 para 11 pp 379-380, a guide; the march to the EPs is read with the terrain)` });
  return { rows, confirm: ['Routes back walked by day; Coy RVs and the Bn checkpoint recognisable at night (IC s91 para 5 b p 483)', 'Normal activity and harassing fire kept up to the last; the line left intact to the end (IC s91 paras 7-9 p 484)', 'Demolitions and mines on the roads in front of the intermediate posn (IC s93 para 3 p 490)'] };
}

/**
 * A withdrawal fitted where it rests (PlanFit.fitLayout hands these over): the aim stretches the new main posn, the
 * click is the old posn's HQ. Without the ground the geometry stands, its ground rows grey.
 */
export function fitWithdrawal(inp: FitLayoutInput): FittedLayout | null {
  const { recipe, ctx, ground } = inp;
  const k = 1 / Math.cos(2 * Math.atan(Math.exp(inp.anchor.y / 6378137)) - Math.PI / 2);
  const aimM = inp.cursor ? Math.hypot(inp.cursor.x - inp.anchor.x, inp.cursor.y - inp.anchor.y) / k : null;
  const geom0 = withdrawalGeom(recipe, ctx.doc, aimM && aimM > 500 ? aimM : null);
  const opts = { ...inp.opts, geom: { ...geom0, ...(inp.opts.geom ?? {}) } };
  const base = solveRecipe(recipe, ctx, opts);
  const pivotItem = base.items.find((i) => i.id === base.pivotId);
  if (!pivotItem) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k, pivot: pivotItem.pts[0] };
  inp.begin?.();
  const known = ground.cls(inp.anchor.x, inp.anchor.y) !== null || Number.isFinite(ground.elev(inp.anchor.x, inp.anchor.y));
  const read = known ? findWithdrawal(base, frame, ground, ctx.doc, { enFieldArtyM: inp.enFieldArtyM ?? null, enFieldArtySrc: inp.enFieldArtySrc ?? null, threat: inp.threat ?? null, terrain: inp.terrain && inp.terrain !== 'auto' ? inp.terrain : 'plains' }) : null;
  const raw = read ? solveRecipe(recipe, ctx, { ...opts, nudges: { ...(inp.opts.nudges ?? {}), ...read.nudges }, geom: { ...opts.geom, ...read.geom }, paths: read.paths }) : base;
  // the ground's rows replace the geometry's of the same name
  const fresh = new Set((read?.rows ?? []).map((r) => r.name));
  const rows = read ? [...base.rows.filter((r) => !fresh.has(r.name)), ...read.rows] : base.rows;
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const fit: FitResult = {
    nudges: read?.nudges ?? {}, slides: [], killingGr: null, slots: {}, rows, approaches: [],
    score: Math.max(0, 100 - 25 * fails - 6 * warns), fails, warns,
    pending: ground.pending(), data: ground.dataLine(), from: inp.threat ?? null, fromAssumed: !inp.threat,
    paths: read?.paths,
    withdrawal: read ? { paths: read.paths, times: read.times, routes: read.routes, confirm: read.confirm } : undefined,
  };
  const res: SolveResult = {
    ...raw, mode: read ? 'terrain' : 'geometry', rows, slots: [],
    confirm: read ? [...read.confirm, ...base.confirm.filter((x) => !read.confirm.includes(x))] : base.confirm,
    assumptions: read ? [`Fitted to the ground: ${fit.data}.`, ...(inp.threat ? [] : ['No threat marked: the En observer is taken 1.5 km in front of the old posn.'])] : base.assumptions,
  };
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain: null, enemy: null, unit: null };
}

// ── Check my plan: a withdrawal built here, read as drawn ───────────────────────────────────────────────────────────

/** Check my plan for a withdrawal built here: its symbols by role, as drawn (nothing moved), read with the build's rows. */
export interface WithdrawalCheck { rows: Check[]; confirm: string[]; reading: Pick<WithdrawalFind, 'paths' | 'times' | 'routes' | 'confirm'>; pending: boolean; read: string[]; missing: string[] }
export function checkWithdrawal(inp: FitLayoutInput, drawn: Record<string, { pts: [number, number][] }>): WithdrawalCheck | null {
  const { recipe, ctx, ground } = inp;
  const hq = drawn.hq?.pts[0], nm = drawn.newMain?.pts, ip = drawn.intPosn?.pts;
  if (!hq) return null;
  // the frame: the HQ is the pivot, the plan faces the new main posn (the way of withdrawal), else the intermediate posn, else the bearing given
  const ctrW = (pts: [number, number][]) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] as [number, number];
  const aim = nm?.length ? ctrW(nm) : ip?.length ? ctrW(ip) : null;
  const bearing = aim ? Math.atan2(aim[0] - hq[0], aim[1] - hq[1]) : inp.bearing;
  const k = 1 / Math.cos(2 * Math.atan(Math.exp(hq[1] / 6378137)) - Math.PI / 2);
  const f: FitFrame = { anchor: { x: hq[0], y: hq[1] }, bearing, k, pivot: P(0, 0) };
  const items: SolveResult['items'] = [];
  for (const s of recipe.slots) {
    const d = drawn[s.role];
    if (!d?.pts.length) continue;
    items.push({ id: `chk-${s.role}`, role: s.role, key: s.sym, label: s.label ?? s.role, pts: d.pts.map((q) => toLocal(f, { x: q[0], y: q[1] })), geo: s.kind === 'point' ? 'Point' : s.kind === 'line' ? 'Line' : 'Area' } as SolveResult['items'][number]);
  }
  const base = { recipe, items } as SolveResult;
  inp.begin?.();
  const read = findWithdrawal(base, f, ground, ctx.doc, { enFieldArtyM: inp.enFieldArtyM ?? null, enFieldArtySrc: inp.enFieldArtySrc ?? null, threat: inp.threat ?? null, terrain: inp.terrain && inp.terrain !== 'auto' ? inp.terrain : 'plains' });
  const need = ['hq', 'fwdL', 'fwdR', 'rvA', 'rvB', 'bnRv', 'epA', 'epB', 'intPosn', 'newMain'];
  const names = (r: string) => recipe.slots.find((s) => s.role === r)?.label || r;
  return { rows: read.rows, confirm: read.confirm, reading: { paths: read.paths, times: read.times, routes: read.routes, confirm: read.confirm }, pending: ground.pending(), read: [...new Set(Object.keys(drawn).map(names))], missing: need.filter((r) => !drawn[r]).map(names) };
}
