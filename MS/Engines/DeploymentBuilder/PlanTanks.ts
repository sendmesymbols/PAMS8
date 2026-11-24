/**
 * PlanTanks.ts — PURE. Tanks with the Bn attack: tank FUPs for armour-heavy attacks (PlanBuilder_Plan.md §9.2).
 *
 * IBB S44 para 16 a (pp 213-216): his ATGMs reach 1500-3500 m and stand 500-1000 m deep, so the tanks form up 2500-3000
 * m out and a common FUP with the infantry is no longer feasible. Two ways to use them:
 * - **Fire sp** (infantry heavy, the fire support role, option a): the Sqn waits at FUP (Tks) out of his ATGM and NVD
 *   reach and moves to fire positions by the BOF so as to arrive as the assaulting infantry come as close to the Obj;
 *   at night its main gun reaches 800 m with NVD, 1600 m with registration.
 * - **Close sp** (armour heavy, S42 p187): the Sqn less a troop from FUP (Tks) on its own axis converging on the Obj
 *   (p186: the same or converging axes, arriving together), timed to reach the infantry's assault line (150/250 m out)
 *   as they do, then rushing the Obj to arrive just before or with them; the rear troop covers by observed fire from a
 *   flank (p188 c), 1500 m out (p215 b).
 * Who leads (S35 para 7 b pp 145-146): his fields of fire along the approach: open tank country the tanks; 400-500 m or
 * less the infantry; 100-200 m or less the infantry with a troop at most.
 *
 * Figures: PlanDoctrine `attack.tanks`, `attack.tankFupFromObjM`. No ArcGIS, no DOM.
 */
import type { DoctrineSet, Recipe, RecipeSlot } from './PlanRecipes';
import { doctrineAt, footprints, resolveRange } from './PlanRecipes';
import type { Check, CheckState, SolveResult, XY } from './PlanSolve';
import { toLocal, toWorld, type FitFrame, type PlanGround } from './PlanFit';
import { hRelText, simplify, type HSum, type HStep } from './PlanAttack';
import { boxGap, boxOf, type Box } from './PlanPhase';

export type TankMode = 'none' | 'fire' | 'close';
export const TANK_MODES: readonly TankMode[] = ['none', 'fire', 'close'];

const P = (x: number, y: number): XY => ({ x, y });
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts: XY[]) => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const unit = (v: XY) => { const L = Math.hypot(v.x, v.y) || 1; return P(v.x / L, v.y / L); };
const lenOf = (pts: XY[]) => pts.slice(1).reduce((a, p, i) => a + dist(pts[i], p), 0);
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const rng = (doc: DoctrineSet, path: string, fb: [number, number]): [number, number] => resolveRange(doc, doctrineAt(doc, path)) ?? fb;
const fromRecipe = (p: [number, number]): XY => P(p[0], -p[1]);
const toRecipe = (p: XY): [number, number] => [Math.round(p.x), Math.round(-p.y)];
const WATER = new Set([4, 5, 20, 21, 22, 46]);

/** Where the axis enters the objective: back from its head along its last leg until outside the box. */
export function entryOf(axis: XY[], ob: Box): { E: XY; u: XY } {
  const head = axis[axis.length - 1], prev = axis[Math.max(0, axis.length - 2)];
  const u = unit(P(head.x - prev.x, head.y - prev.y));
  let E = head;
  for (let t = 0; t <= 4000 && boxGap(ob, E) === 0; t += 10) E = P(head.x - u.x * t, head.y - u.y * t);
  return { E, u };
}

/** A point beside the BOF for the tanks' fire posns: 250 m off its centre, on the side away from the infantry's axis. */
function besideBof(bofMid: XY, objC: XY, E: XY, u: XY): XY {
  const bu = unit(P(objC.x - bofMid.x, objC.y - bofMid.y)), bn = P(bu.y, -bu.x);
  const a = P(bofMid.x + bn.x * 250, bofMid.y + bn.y * 250), b = P(bofMid.x - bn.x * 250, bofMid.y - bn.y * 250);
  const offAxis = (p: XY) => Math.abs((p.x - E.x) * u.y - (p.y - E.y) * u.x);
  return offAxis(a) >= offAxis(b) ? a : b;
}

/**
 * The attack with a tank Sqn: FUP (Tks) 2500-3000 m out on the infantry's axis line, aside of it away from the BOF, the
 * Sqn there; Close sp adds the tanks' axis converging on the Obj and the rear troop on the BOF's flank; Fire sp adds the
 * Sqn's fire posns by the BOF (planned). New recipe (id `-tkf` / `-tkc`); the one passed in is not changed.
 */
export function withTanks(r: Recipe, doc: DoctrineSet, mode: TankMode, sqn?: Recipe['tankSqn'] | null): Recipe {
  if (mode === 'none' || r.task !== 'attack' || r.tanks) return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const S = (role: string) => out.slots.find((s) => s.role === role);
  const obj = S('obj'), axis = S('axis'), bof = S('bof');
  const rect = obj?.shape?.rect;
  if (!obj || !rect || !axis?.shape?.pts?.length) return r;
  const midOf = (v: unknown, fb: number) => { const x = resolveRange(doc, v); return x ? (x[0] + x[1]) / 2 : fb; };
  const o1: Box = { c: fromRecipe([rect.acrossM, rect.backM]), w: midOf(rect.wM, 1500), h: midOf(rect.hM, 700) };
  const { E, u } = entryOf(axis.shape.pts.map(fromRecipe), o1);
  const n = P(u.y, -u.x);
  // where the BOF sits (its base line), not the point it fires toward
  const bofP = bof?.shape?.base ? centre(bof.shape.base.map(fromRecipe)) : bof?.shape?.ctrl ? fromRecipe(bof.shape.ctrl) : null;
  const bofSide = bofP ? Math.sign((bofP.x - E.x) * n.x + (bofP.y - E.y) * n.y) || 1 : 1;
  const back = num(doc, 'attack.tankFupFromObjM', 2750), aside = -bofSide * num(doc, 'attack.tanks.fupAsideM', 300);
  const F = P(E.x - u.x * back + n.x * aside, E.y - u.y * back + n.y * aside);
  const fu = unit(P(E.x - F.x, E.y - F.y)), fn = P(fu.y, -fu.x);
  const add = (s: RecipeSlot) => out.slots.push(s);
  add({ role: 'tkFup', kind: 'area', sym: '25140302', label: 'FUP (Tks)', order: 2, shape: { pts: [P(F.x - fn.x * 200, F.y - fn.y * 200), P(F.x + fn.x * 200, F.y + fn.y * 200)].map(toRecipe) }, terrainRule: { unseenFrom: 'threat', notIn: ['noGo', 'water'] } });
  add({ role: 'tkSqn', kind: 'point', sym: '10120500', label: mode === 'close' ? 'A Sqn (-)' : 'A Sqn', echelon: '15', order: 3, shape: { at: toRecipe(P(F.x - fu.x * 150, F.y - fu.y * 150)) } });
  // the Sqn's Assy area behind FUP (Tks) (MIB p 118: the tanks wait in assembly areas; a harbour lies in the rear, out of
  // contact and out of the En field artillery, MIB p 65), off the infantry's axis: hidden, by a track, the move up timed in the H-hour sum
  const hb = num(doc, 'attack.tanks.harbourBehindFupM', 2000);
  const H = P(F.x - fu.x * hb + fn.x * 150 * Math.sign(aside || 1), F.y - fu.y * hb + fn.y * 150 * Math.sign(aside || 1));
  add({ role: 'tkHarbour', kind: 'area', sym: '25150200', label: 'Sqn Assy Area', order: 2, shape: { rect: { acrossM: Math.round(H.x), backM: Math.round(-H.y), wM: 500, hM: 400 } }, terrainRule: { unseenFrom: 'threat', notIn: ['noGo', 'water'], prefer: ['roadAccess'] } });
  if (mode === 'close') {
    // the tanks' own axis converging on where the infantry enter the Obj (IBB p186), and the rear troop on the BOF's flank
    add({ role: 'tkAxis', kind: 'area', sym: '25151403', label: 'Tks', order: 3, shape: { pts: [P(F.x + fu.x * 150, F.y + fu.y * 150), P(E.x + fu.x * 100, E.y + fu.y * 100)].map(toRecipe), widthM: 300 } });
    const rr = num(doc, 'attack.tanks.rearTroopFromObjM', 1500);
    add({ role: 'tkRear', kind: 'point', sym: '10120500', label: 'Tk Tp', echelon: '14', order: 4, shape: { at: toRecipe(P(E.x - u.x * rr * Math.SQRT1_2 + n.x * bofSide * rr * Math.SQRT1_2, E.y - u.y * rr * Math.SQRT1_2 + n.y * bofSide * rr * Math.SQRT1_2)) } });
  } else if (bofP) {
    add({ role: 'tkFire', kind: 'point', sym: '10120500', label: 'A Sqn (fire)', echelon: '15', order: 4, planned: true, shape: { at: toRecipe(besideBof(bofP, o1.c, E, u)) } });
  }
  out.id = `${r.id}-tk${mode === 'close' ? 'c' : 'f'}`;
  out.name = `${r.name}, tanks in ${mode === 'close' ? 'close' : 'fire'} sp`;
  out.tanks = mode;
  if (sqn) out.tankSqn = { ...sqn };
  out.note = `${r.note ?? ''} Tanks (PlanTanks, ${mode === 'close' ? 'close sp, armour heavy' : 'fire sp, infantry heavy'}): FUP (Tks) ${fmtM(back)} from the Obj (IBB p214: out of the En ATGMs' reach, no common FUP), ${fmtM(Math.abs(aside))} aside of the infantry's axis; the Sqn Assy area ${fmtM(hb)} behind FUP (Tks) (E; MIB p 118), its move up in the H-hour sum.`.trim();
  return out;
}

// ── tanks grouped to a defence ───────────────────────────────────────────────────────────────────────────────────

/** The sub-unit boxes of a recipe's footprint slots as the validator reads them (plan metres, y back). */
const footBoxes = (doc: DoctrineSet, r: Recipe) => footprints(doc, r);

/**
 * `n` tank units (1-3) grouped to a defence: Sqns to a Bn defence, Tps (3 tanks) to a Coy defence. Each leaguer (MIB p 68:
 * an armoured sub-unit close to the FDLs, dispersed and under cover by day; not a harbour, which is in the rear) stands
 * beside the reserve (half its width and 350 m off its centre: 1100 m for a Bn's Coy, 650 m for a Coy's Pl; alternate
 * sides), or 500 m behind the rear posn where the layout holds no reserve. They are the plan's counter-penetration force
 * at the tank rate (PlanWhatIf), counted in the force, and their guns count as AT at `atFramework.tankGunEffM` (E: the
 * range is printed only for the Al-Zarrar). New recipe (`-tkd1`...); the one passed in is not changed.
 */
export function withDefTanks(r: Recipe, doc: DoctrineSet, n: number, sqn?: Recipe['tankSqn'] | null): Recipe {
  const k = Math.max(0, Math.min(3, Math.round(n)));
  const unitWord: 'Sqn' | 'Tp' = r.echelon === '15' ? 'Tp' : 'Sqn';
  if (!k || r.task !== 'defence' || (r.echelon !== '16' && r.echelon !== '15') || r.defTanks) return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const fp = footBoxes(doc, r);
  const res = fp.find((b) => b.kind === 'res');
  const rear = fp.length ? Math.max(...fp.map((b) => b.y + b.h / 2)) : 0;
  const back = res ? res.y : rear + 500, across0 = res ? res.x : 0, off = res ? Math.round(res.w / 2 + 350) : 900;
  for (let i = 0; i < k; i++) {
    const sign = i % 2 === 0 ? 1 : -1, reach = off + (res ? res.w + 100 : 1200) * Math.floor(i / 2);
    out.slots.push({ role: i ? `tkSqn${i + 1}` : 'tkSqn', kind: 'point', sym: '10120500', label: `${'ABC'[i]} ${unitWord}`, echelon: unitWord === 'Tp' ? '14' : '15', order: 8, shape: { at: [Math.round(across0 + sign * reach), Math.round(back)] } });
  }
  out.id = `${r.id}-tkd${k}`;
  out.name = `${r.name}, ${k} tank ${unitWord}${k > 1 ? 's' : ''}`;
  out.defTanks = k;
  out.defTanksUnit = unitWord;
  if (sqn) out.tankSqn = { ...sqn };
  out.note = `${r.note ?? ''} ${k} tank ${unitWord}${k > 1 ? 's' : ''} (PlanTanks.withDefTanks): leaguer${k > 1 ? 's' : ''} (MIB p 68) ${res ? `beside the reserve, ${off} m off its centre` : '500 m behind the rear posn (no reserve in this layout)'}; the ${unitWord === 'Tp' ? 'Coy' : 'Bn'}'s counter-penetration force at the tank rate (E).`.trim();
  return out;
}

/** The tank Sqns of a built defence: their items (roles tkSqn, tkSqn2 ...) in plan metres. */
const sqnItems = (items: { role: string; label: string; pts: XY[] }[]) => items.filter((i) => /^tkSqn\d*$/.test(i.role) && i.pts.length);

/**
 * The rows for tank Sqns grouped to a defence. Without the ground one row, not checked: the leaguers' ground. On the
 * ground, each leaguer: tracks go there (not NO-GO) and it is not in his view from where he starts (a hull 2.3 m up).
 */
export function defTankRows(items: { role: string; label: string; pts: XY[] }[], recipe: Recipe, f: FitFrame | null, g: PlanGround | null, doc: DoctrineSet, from: XY | null): Check[] {
  const sq = sqnItems(items);
  if (!sq.length) return [];
  const s = recipe.tankSqn, tp = recipe.defTanksUnit === 'Tp';
  const what = `${sq.length} tank ${tp ? 'Tp' : 'Sqn'}${sq.length > 1 ? 's' : ''}${s ? ` of ${tp ? s.tpTanks : s.tanks} tanks (ORBAT, ${s.src})` : ''}`;
  const guns = `their guns count as AT at ${(num(doc, 'atFramework.tankGunEffM', 2500) / 1000).toFixed(1)} km (E: the range is printed only for the Al-Zarrar; Tank AT cover row)`;
  if (!f || !g) return [{ name: tp ? 'Tank Tps' : 'Tank Sqns', st: 'unchecked', reason: `${what} beside the reserve, the ${tp ? 'Coy' : 'Bn'}'s counter-penetration force at the tank rate; the leaguers' ground needs terrain data; ${guns}` }];
  const track = g.going('tracked');
  const W = (p: XY) => toWorld(f, p);
  const parts: string[] = [];
  let worst: CheckState = 'pass';
  for (const q of sq) {
    const c = q.pts[0], w = W(c), cls = g.cls(w.x, w.y);
    const bad = cls !== null && (track.nogo.has(cls) || WATER.has(cls));
    let seen: number | null = null;
    if (from && g.sight) {
      const ps = [P(0, 0), P(-150, 0), P(150, 0), P(0, 150), P(0, -150)].map((d) => { const b = W(P(c.x + d.x, c.y + d.y)); return g.sight!(from.x, from.y, 2, b.x, b.y, 2.3); }).filter((p): p is number => p !== null);
      seen = ps.length >= 3 ? ps.filter((p) => p >= 0.5).length / ps.length : null;
    }
    const st: CheckState = cls === null ? 'unchecked' : bad ? 'fail' : seen !== null && seen >= 0.5 ? 'warn' : 'pass';
    if (st === 'fail') worst = 'fail'; else if (st === 'warn' && worst !== 'fail') worst = 'warn'; else if (st === 'unchecked' && worst === 'pass') worst = 'unchecked';
    parts.push(`${q.label}: ${cls === null ? 'ground not loaded' : bad ? 'NO-GO for tracks (move it by hand)' : 'tracks go'}${seen === null ? '' : seen >= 0.5 ? `, ${Math.round(seen * 100)} % likely in the En's view: hull down or move it` : ', hidden from where the En starts'}`);
  }
  return [{ name: 'Tank leaguer', st: worst, reason: `${what}: ${parts.join('; ')}; ${guns}` }];
}

// ── on the ground ────────────────────────────────────────────────────────────────────────────────────────────────
export interface TankFind {
  nudges: Record<string, XY>;
  /** Fire sp: the Sqn's way on tracks from FUP (Tks) to its fire posns (plan metres); Close sp: null (its axis is laid by PlanFit). */
  route: XY[] | null;
  rows: Check[];
  /** His fields of fire from the Obj along the infantry's approach, metres; null when not read. */
  fieldM: number | null;
}

/**
 * FUP (Tks) on the ground (2500-3000 m out, up to 600 m either side, hidden from the Obj for a hull 2.3 m up, tracks
 * going), the fire posns following the BOF, the Sqn's way on tracks to them, and who leads from his fields of fire.
 */
export function findTankSpots(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet, mode: TankMode): TankFind | null {
  const item = (role: string) => res.items.find((i) => i.role === role);
  const obj = item('obj'), axis = item('axis'), fup = item('tkFup');
  if (mode === 'none' || !obj || !axis || !fup) return null;
  const out: TankFind = { nudges: {}, route: null, rows: [], fieldM: null };
  const o1 = boxOf(obj.pts);
  const { E, u } = entryOf(axis.pts, o1);
  const n = P(u.y, -u.x);
  const W = (p: XY) => toWorld(f, p);
  const track = g.going('tracked');
  const badTk = (p: XY) => { const w = W(p); const c = g.cls(w.x, w.y); return c !== null && (track.nogo.has(c) || WATER.has(c)); };
  const seenFrom = (from: XY, to: XY[], tgt: number) => {
    if (!g.sight) return null;
    const a = W(from);
    const ps = to.map((p) => { const b = W(p); return g.sight!(a.x, a.y, 2, b.x, b.y, tgt); }).filter((p): p is number => p !== null);
    return ps.length >= 2 ? ps.filter((p) => p >= 0.5).length / ps.length : null;
  };
  // ── FUP (Tks) ──
  const band = rng(doc, 'attack.tankFupFromObjM', [2500, 3000]);
  const F0 = centre(fup.pts);
  const lat0 = (F0.x - E.x) * n.x + (F0.y - E.y) * n.y;
  const reach = num(doc, 'attack.tanks.fupSearchAsideM', 600);
  let best: { F: XY; cost: number; seen: number | null; nogo: number } | null = null;
  for (const d of [band[0], (band[0] + band[1]) / 2, band[1]]) for (let lat = -reach; lat <= reach; lat += 200) {
    const F = P(E.x - u.x * d + n.x * lat, E.y - u.y * d + n.y * lat);
    const fu = unit(P(E.x - F.x, E.y - F.y)), fn = P(fu.y, -fu.x);
    const cells = [F, P(F.x - fn.x * 200, F.y - fn.y * 200), P(F.x + fn.x * 200, F.y + fn.y * 200)];
    const nogo = cells.filter(badTk).length;
    if (nogo >= 2) continue;
    const seen = seenFrom(E, cells, 2.3);
    const cost = (seen ?? 0.5) * 10 + nogo * 4 + Math.abs(lat - lat0) / 400 + Math.abs(d - (band[0] + band[1]) / 2) / 500;
    if (!best || cost < best.cost) best = { F, cost, seen, nogo };
  }
  const F1 = best?.F ?? F0;
  if (best && dist(F1, F0) > 1) { const d = P(F1.x - F0.x, F1.y - F0.y); out.nudges.tkFup = d; out.nudges.tkSqn = d; }
  const gapF = boxGap(o1, F1);
  out.rows.push(!best
    ? { name: 'Tank FUP', st: 'warn', reason: `no ground 2.5-3 km out where tracks go: FUP (Tks) left ${fmtM(gapF)} out, recce one` }
    : { name: 'Tank FUP', st: best.seen === null ? 'unchecked' : best.seen < 0.5 && !best.nogo ? 'pass' : 'warn', reason: `${fmtM(gapF)} from the Obj (IBB p214: ${fmtM(band[0])}-${fmtM(band[1])}, outside the En ATGMs' reach; no common FUP with the infantry), ${best.seen === null ? 'its view from the Obj not read' : best.seen < 0.5 ? 'likely hidden from the Obj' : `${Math.round(best.seen * 100)} % likely seen from the Obj: hull down or smoke (IBB p215)`}${best.nogo ? ', part of it NO-GO for tracks' : ''}` });
  // ── Fire sp: the fire posns follow the BOF; the Sqn's way to them on tracks ──
  const bof = item('bof'), fire = item('tkFire');
  if (mode === 'fire' && bof && fire) {
    const bm = bof.base?.mid ?? bof.pts[0];
    const want = besideBof(bm, o1.c, E, u);
    if (dist(want, fire.pts[0]) > 1) out.nudges.tkFire = P(want.x - fire.pts[0].x, want.y - fire.pts[0].y);
    const p = g.avenues?.(W(F1), W(want), 400, 'tracked')?.[0]?.path;
    out.route = simplify(p && p.length >= 2 ? [F1, ...p.slice(1, -1).map((q) => toLocal(f, q)), want] : [F1, want], num(doc, 'attack.routeToleranceM', 75));
  }
  // ── who leads: his fields of fire from the Obj along the infantry's approach (a hull 2.3 m up) ──
  const open = num(doc, 'attack.tanks.whoLeads.openM', 500), close = num(doc, 'attack.tanks.whoLeads.closeM', 200);
  const runMin = num(doc, 'attack.counter.deadRunM', 100);
  if (g.sight) {
    const a = W(E);
    let run = 0, field: number | null = null, read = 0;
    for (let t = 25; t <= 1500; t += 25) {
      const b = W(P(E.x - u.x * t, E.y - u.y * t));
      const v = g.sight(a.x, a.y, 2, b.x, b.y, 2.3);
      if (v === null) continue;
      read++;
      if (v >= 0.5) run = 0;
      else if (++run * 25 >= runMin) { field = t - (run - 1) * 25; break; }
    }
    if (read >= 10) out.fieldM = field ?? 1500;
  }
  const fm = out.fieldM;
  const lead = fm === null ? null : fm > open ? 'tanks' : fm > close ? 'infantry' : 'troop';
  const st: CheckState = lead === null ? 'unchecked' : lead === 'troop' && mode === 'close' ? 'warn' : 'pass';
  const field = fm === null ? '' : fm >= 1500 ? 'the En fields of fire along the approach run 1.5 km or more' : `the En fields of fire along the approach end ${fmtM(fm)} out`;
  out.rows.push({
    name: 'Who leads', st,
    reason: lead === null ? 'the En fields of fire along the approach not read (no sight data)'
      : lead === 'tanks' ? `${field}: open tank country, the tanks may lead (IBB S35 p145)${mode === 'fire' ? '; Close sp would use them so' : ''}`
      : lead === 'infantry' ? `${field} (${open} m or less): the infantry leads, the tanks behind them (IBB S35 p145)`
      : `${field} (${close} m or less): very close country, the infantry leads with a troop of tanks at most, the Sqn less a troop behind (IBB S35 p146)${mode === 'close' ? ': Close sp is a risk here' : ''}`,
  });
  // by the En and the ground too (MIB s20 p 117), and the grouping (MIB s7 pp 24, 26)
  out.rows[out.rows.length - 1].reason += '. By the En and the ground (MIB p 117): the tanks lead against light resistance, wire, AP mines, entrenched infantry and armour; tanks and infantry together in woods, fortified areas, BUA, against AT defences and in low visibility; the mech infantry with the engineers against emplaced AT weapons, water, heavy woods, towns and broken ground. Grouping (MIB pp 24, 26): tank heavy for a counter-attack and where the going and fields of fire suit tanks, infantry heavy against AT defences and obstacles, balanced against a mech En';
  return out;
}

/** Along a polyline: metres on GO and SLOW-GO for tracks, and whether it crosses NO-GO (unknown counted GO). */
function trackWalk(pts: XY[], f: FitFrame | null, g: PlanGround | null) {
  const L = lenOf(pts);
  if (!f || !g) return { goM: L, slowM: 0, nogo: false, known: 0 };
  const tr = g.going('tracked');
  let goM = 0, slowM = 0, nogo = false, known = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]), k = Math.max(1, Math.ceil(seg / 50));
    for (let s = 0; s < k; s++) {
      const t = (s + 0.5) / k;
      const w = toWorld(f, P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t));
      const c = g.cls(w.x, w.y);
      if (c !== null) known++;
      if (c !== null && (tr.nogo.has(c) || WATER.has(c))) nogo = true;
      if (c !== null && tr.caution.has(c)) slowM += seg / k; else goM += seg / k;
    }
  }
  return { goM, slowM, nogo, known };
}

/** The going on tracks along a tank axis as a check row (Check my plan reads a drawn tank axis so). */
export function tankGoingRow(pts: XY[], f: FitFrame, g: PlanGround): Check {
  const w = trackWalk(pts, f, g);
  const slowPct = Math.round((100 * w.slowM) / Math.max(1, w.goM + w.slowM));
  return {
    name: 'Tank going', st: !w.known ? 'unchecked' : w.nogo ? 'fail' : slowPct > 50 ? 'warn' : 'pass',
    reason: !w.known ? 'no ground data along the axis of the tanks' : w.nogo ? 'the axis of the tanks crosses NO-GO for tracks: turn it, bridge it, or fight infantry heavy' : `the axis of the tanks: ${slowPct} % SLOW-GO for tracks`,
  };
}

/**
 * The tanks in the H-hour sum (steps added in time order, `h.tanks` set) and their rows: Tank timing, Tank going, and
 * for Fire sp Tank fire range. Close sp: the Sqn (-) leaves FUP (Tks) to reach the infantry's assault line as they do
 * and rushes the Obj; Fire sp: to the fire posns as the infantry come as close to the Obj (option a; at H at the
 * latest). Without the ground, straight lines at the GO rate.
 */
export function addTankTimes(h: HSum, res: SolveResult, f: FitFrame | null, g: PlanGround | null, doc: DoctrineSet, night: boolean, mode: TankMode, route: XY[] | null): Check[] {
  const item = (role: string) => res.items.find((i) => i.role === role);
  const obj = item('obj'), fup = item('tkFup');
  if (mode === 'none' || !obj || !fup) return [];
  const o1 = boxOf(obj.pts);
  const F = centre(fup.pts);
  const kmh = num(doc, `attack.tanks.moveKmh.${night ? 'night' : 'day'}`, night ? 8 : 16);
  // the Sqn's move from its Assy area to FUP (Tks): on tracks at the tank rate, before the FUP is left
  const harbour = item('tkHarbour');
  const harbourMove = harbour ? (() => { const w = trackWalk([centre(harbour.pts), F], f, g); return { w, min: Math.round(((w.goM + w.slowM) / 1000 / kmh) * 60) }; })() : null;
  const slowFactor = (() => { const r = doctrineAt(doc, 'moves.tankKmh') as { go?: number; slow?: number } | undefined; return r?.go && r?.slow ? r.go / r.slow : 1.5; })();
  const pace = h.paceMinPer100m;
  const infAt = (m: number) => h.objAt - Math.round((m / 100) * pace);
  const rows: Check[] = [];
  const steps: HStep[] = [];
  // the Sqn from the ORBAT: its tanks in the timing's words (Close sp sends the Sqn less the Tp left on the BOF's flank)
  const sq = res.recipe.tankSqn;
  const sqnWord = !sq ? 'the Sqn' : mode === 'close' ? `the Sqn (-), ${Math.max(0, sq.tanks - sq.tpTanks)} of its ${sq.tanks} tanks,` : `the Sqn of ${sq.tanks} tanks`;
  const minOf =(w: ReturnType<typeof trackWalk>) => Math.round(((w.goM + w.slowM * slowFactor) / 1000 / kmh) * 60);
  const goingRow = (w: ReturnType<typeof trackWalk>, what: string): Check => ({
    name: 'Tank going', st: !w.known ? 'unchecked' : w.nogo ? 'fail' : w.slowM / Math.max(1, w.goM + w.slowM) > 0.5 ? 'warn' : 'pass',
    reason: !w.known ? 'no ground data along the tanks\' way' : w.nogo ? `${what} crosses NO-GO for tracks: turn it, bridge it, or fight infantry heavy` : `${what}: ${Math.round((100 * w.slowM) / Math.max(1, w.goM + w.slowM))} % SLOW-GO for tracks`,
  });
  if (mode === 'close') {
    const ax = item('tkAxis');
    if (!ax) return [];
    const rush = num(doc, 'attack.tanks.rushFromM', 250);
    // along FUP (Tks) and the tanks' axis to the point `rush` m from the Obj
    const path = [F, ...ax.pts];
    const toLine: XY[] = [path[0]];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], k = Math.max(1, Math.ceil(dist(a, b) / 10));
      let hit = false;
      for (let s = 1; s <= k; s++) { const p = P(a.x + ((b.x - a.x) * s) / k, a.y + ((b.y - a.y) * s) / k); if (boxGap(o1, p) <= rush) { toLine.push(p); hit = true; break; } }
      if (hit) break;
      toLine.push(b);
    }
    const w = trackWalk(toLine, f, g);
    const travel = minOf(w);
    const tAl = infAt(rush);
    const leave = tAl - travel;
    // at the assault line with the infantry, the tanks fire them on after the artillery lifts (IBB p187 b(2)), then rush
    // to be on the Obj just before them (aheadMin, E)
    const rushMin = Math.max(1, Math.round((rush / 1000 / num(doc, 'attack.tanks.rushKmh', 15)) * 60));
    const onObj = Math.max(tAl + rushMin, h.objAt - Math.round(num(doc, 'attack.tanks.aheadMin', 1)));
    const tRush = onObj - rushMin;
    if (harbourMove) steps.push({ label: 'Sqn leaves its Assy area for FUP (Tks)', distM: Math.round(harbourMove.w.goM + harbourMove.w.slowM), min: harbourMove.min, at: leave - harbourMove.min - 10 });
    steps.push({ label: `Tanks leave FUP (Tks)${night ? ' (night)' : ''}`, distM: Math.round(w.goM + w.slowM), min: travel, at: leave });
    if (tRush > tAl) steps.push({ label: 'Tanks at the assault line, firing the infantry on', distM: 0, min: tRush - tAl, at: tAl });
    steps.push({ label: 'Tanks rush the Obj', distM: rush, min: rushMin, at: tRush });
    h.tanks = { mode, leaveAt: leave, atAt: tAl, onObjAt: onObj, lengthM: Math.round(w.goM + w.slowM) };
    rows.push({ name: 'Tank timing', st: onObj <= h.objAt + 1 ? 'pass' : 'warn', reason: `${sqnWord} leaves FUP (Tks) ${hRelText(leave)}, ${fmtM(w.goM + w.slowM)} in ${travel} min${night ? ' by night' : ''} to the infantry's assault line ${rush} m out as they reach it (${hRelText(tAl)}), fires them on from there and rushes the Obj, on it ${hRelText(onObj)}, the infantry ${hRelText(h.objAt)} (IBB p187: just before or with them)${leave < 0 ? '; it moves before H: cover its noise with the deception plan (IBB p215)' : ''}` });
    rows.push(goingRow(trackWalk(path, f, g), 'the tanks\' axis'));
  } else {
    const fire = item('tkFire');
    if (!fire) return [];
    const Pf = fire.pts[0];
    const dF = boxGap(o1, Pf);
    const path = route && route.length >= 2 ? route : [F, Pf];
    const w = trackWalk(path, f, g);
    const travel = minOf(w);
    // option a: at the fire posns as the infantry come as close to the Obj; fire posns farther out than the SL (the
    // infantry are not yet closing before H) are manned at H, never before it
    const tF = Math.max(0, infAt(dF));
    const leave = tF - travel;
    if (harbourMove) steps.push({ label: 'Sqn leaves its Assy area for FUP (Tks)', distM: Math.round(harbourMove.w.goM + harbourMove.w.slowM), min: harbourMove.min, at: (() => { const first = steps[0]?.at; return (first ?? 0) - harbourMove.min - 10; })() });
    steps.push({ label: `Tanks leave FUP (Tks) for the fire posns${night ? ' (night)' : ''}`, distM: Math.round(w.goM + w.slowM), min: travel, at: leave });
    steps.push({ label: `Tanks firing from ${fmtM(dF)} out`, distM: 0, min: Math.max(0, h.objAt - tF), at: tF });
    h.tanks = { mode, leaveAt: leave, atAt: tF, onObjAt: null, lengthM: Math.round(w.goM + w.slowM) };
    rows.push({ name: 'Tank timing', st: 'pass', reason: `${sqnWord} leaves FUP (Tks) ${hRelText(leave)}, ${fmtM(w.goM + w.slowM)} in ${travel} min${night ? ' by night' : ''}, at its fire posns ${hRelText(tF)} as the infantry come ${fmtM(dF)} from the Obj (IBB p214 option a), shooting them on until they are on it ${hRelText(h.objAt)}${leave < 0 ? '; it moves before H: cover its noise with the deception plan (IBB p215)' : ''}` });
    const nightM = num(doc, 'attack.tanks.nightFireM', 800), regM = num(doc, 'attack.tanks.registeredFireM', 1600);
    rows.push({
      name: 'Tank fire range', st: dF <= (night ? nightM : regM) ? 'pass' : 'warn',
      reason: night
        ? dF <= nightM ? `${fmtM(dF)} to the Obj: inside the main gun's night range with NVD (${nightM} m, IBB p214)` : dF <= regM ? `${fmtM(dF)} to the Obj: beyond the night range with NVD (${nightM} m); register the targets by day to reach ${fmtM(regM)} (IBB p214)` : `${fmtM(dF)} to the Obj: beyond even the registered night range (${fmtM(regM)}, IBB p214): fire posns nearer, or by day`
        : dF <= regM ? `${fmtM(dF)} to the Obj (by day; ${fmtM(regM)} the planning reach, IBB p214)` : `${fmtM(dF)} to the Obj: further than ${fmtM(regM)} (IBB p214): fire posns nearer`,
    });
    rows.push(goingRow(w, 'the Sqn\'s way to its fire posns'));
  }
  // called again on the same sum (a re-fit): the tanks' earlier steps are replaced, never doubled
  h.steps = [...h.steps.filter((x) => !/^Tanks /.test(x.label) && !/^Sqn leaves its (harbour|Assy area)/.test(x.label)), ...steps].sort((a, b) => a.at - b.at);
  return rows;
}

/**
 * FUP (Tks) against the En anti-tank guided missiles: the tanks form up out of their reach (IBB S44 para 16 a p 213:
 * the En ATGMs reach 1500-3500 m, so the tank FUP is 2500-3000 m out). `enAtgmM` is the longest ATGM range of the En
 * unit's weapons (ORBAT), `src` names it; null: no row (the Tank FUP row's IBB p 214 band stands).
 */
export function tankFupVsEnAtgm(res: SolveResult, doc: DoctrineSet, enAtgmM: number | null, src: string | null): Check | null {
  const obj = res.items.find((i) => i.role === 'obj'), fup = res.items.find((i) => i.role === 'tkFup');
  if (!obj || !fup) return null;
  // no En ATGM range from the ORBAT: the Tank FUP row's band (IBB p 214: 2500-3000 m, the En ATGMs reach 1500-3500 m) stands alone
  if (enAtgmM === null || !Number.isFinite(enAtgmM)) return null;
  const gap = boxGap(boxOf(obj.pts), centre(fup.pts));
  const reach = enAtgmM;
  const what = src ?? 'the En ATGMs (ORBAT)';
  const margin = num(doc, 'attack.tanks.atgmMarginM', 300);
  return gap >= reach + margin
    ? { name: 'FUP (Tks) vs En ATGM', st: 'pass', reason: `${fmtM(gap)} from the Obj: beyond ${what} (${fmtM(reach)}) by ${fmtM(gap - reach)} (IBB S44 para 16 a p 213: the tanks form up out of the En ATGMs' reach)` }
    : { name: 'FUP (Tks) vs En ATGM', st: gap >= reach ? 'warn' : 'fail', reason: `${fmtM(gap)} from the Obj: ${gap >= reach ? 'only just beyond' : 'inside'} the reach of ${what} (${fmtM(reach)})`,
      detail: { head: `FUP (Tks) ${gap >= reach ? 'just beyond' : 'inside'} the En ATGM reach`, why: 'Tanks forming up within the En ATGM reach are engaged before they move (IBB p 213-214: the FUP distance is set by the En anti-tank weapons).', fix: [`Move FUP (Tks) back to ${fmtM(reach + margin)} or more`, 'Hull-down ground or a crest between (IBB p 215)', 'Smoke on the Obj while the tanks form up'] } };
}
