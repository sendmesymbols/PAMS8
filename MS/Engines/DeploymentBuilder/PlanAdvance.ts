/**
 * PlanAdvance.ts — PURE. An advance to contact: an Armd Bde leading an Armd Div's advance (OoW Vol II s4 pp 9-11,
 * Fig 2 p 9; PlanDoctrine `advance`). The recipe lays the echelons along the axis from the SP (the click; the aim is
 * the direction of advance): covering troops ahead, flank guards out, the Advance Guard (Van Gd, Main Gd), the Main
 * Body behind.
 *
 * - geometry rows: how far each echelon stands from the head against Fig 2 (read off a highlighted scan: uncertain);
 * - on the ground: the axis routed for tracks over the bundle's going (PlanGround.avenues), its share on roads and
 *   their classes, the going along it (NO-GO share and longest stretch), each water feature it crosses and how (the
 *   bundle's bridge classes: tanks need Cl 60), report lines laid on the water ahead with the bounds between them, and
 *   the flank guards' ground;
 * - Check my plan reads the same rows off the drawn symbols (the axis and report lines as drawn).
 *
 * No ArcGIS, no DOM, so Node can test it.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckState, PlanItem, XY } from './PlanSolve';
import { solveRecipe } from './PlanSolve';
import { toLocal, toWorld, type FitFrame, type FitLayoutInput, type FitResult, type FittedLayout, type PlanGround } from './PlanFit';
import type { OrbatSet } from './PlanOrbat';
import { mkPath, type LngLat } from '../MovePlanner/MoveGeo';
import { clearAt, densityFor, dueAt, roadRulesFrom, simulate, speedFor, type MvRoadRules, type MvSerialIn } from '../MovePlanner/MoveRoad';
import { atLocal, clockFrom, LightBook, todayIn } from '../MovePlanner/MoveTime';
import { mercToLngLat } from '../MovementGuide/MovementGuideScan';

type MercXY = [number, number];
export type AdvDrawn = Record<string, { pts: MercXY[] }>;

const kOf = (y: number) => 1 / Math.cos(2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2);
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const fmtM = (m: number) => (Math.abs(m) >= 1000 ? km(m) : `${Math.round(m / 10) * 10} m`);
const SRC = 'OoW Vol II Fig 2 p 9, read off a highlighted scan: uncertain';

/** The figures, PlanDoctrine.advance. */
export function advanceFigures(doc: DoctrineSet) {
  const r = (p: string, fb: [number, number]) => resolveRange(doc, doctrineAt(doc, `advance.${p}`)) ?? fb;
  return {
    ctps: r('ctpsAheadM', [4000, 8000]),
    van: r('vanGdM', [3500, 3500])[0],
    main: r('mainGdM', [3000, 3000])[0],
    flank: r('flankOutM', [6000, 6000])[0],
    body: r('mainBodyBackM', [8000, 8000])[0],
    nogoWarn: r('axisNogoWarn', [0.1, 0.1])[0],
    run: r('axisNogoRunM', [200, 500]),
    detour: r('axisDetourWarn', [1.5, 1.5])[0],
    rlApart: r('rlApartM', [1000, 1000])[0],
  };
}

const centre = (pts: XY[]): XY => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

/**
 * The echelons' distances from the head (plan metres, y in the direction of advance): covering troops ahead, the Van
 * Gd and Main Gd within the Advance Guard, the Main Body back, the flank guards out. Warn outside Fig 2's figures (the
 * single figures with a quarter either way, E).
 */
export function advanceRows(items: { role: string; pts: XY[] }[], doc: DoctrineSet): Check[] {
  const F = advanceFigures(doc);
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const head = at('sp');
  if (!head) return [];
  const rows: Check[] = [];
  const near = (v: number, want: number) => v >= want * 0.75 && v <= want * 1.25;
  const ct = at('ctps');
  if (ct) {
    const d = ct.y - head.y;
    rows.push({ name: 'Covering troops', st: d >= F.ctps[0] - 1 && d <= F.ctps[1] + 1 ? 'pass' : 'warn', reason: `${fmtM(d)} ahead of the Van Gd's head; Fig 2: ${km(F.ctps[0])}-${km(F.ctps[1])} (${SRC}). Mobile troops: the Recce Regt and / or a LAT Bn, to recce and seize bridges and defiles ahead (s4 para 2)` });
  }
  const v = at('vanGd'), m = at('mainGd');
  if (v || m) {
    const dv = v ? head.y - v.y : null, dm = m ? head.y - m.y : null;
    const ok = (dv === null || (dv >= 0 && dv <= F.van * 1.2)) && (dm === null || (dm >= F.van * 0.8 && dm <= (F.van + F.main) * 1.2));
    rows.push({ name: 'Advance Guard', st: ok ? 'pass' : 'warn', reason: `an Armr Regt group (s4 para 3b): ${dv !== null ? `the Van Gd ${fmtM(dv)} behind the head` : 'no Van Gd'}${dm !== null ? `, the Main Gd ${fmtM(dm)}` : ''}; Fig 2: the Van Gd about ${km(F.van)} deep, the Main Gd about ${km(F.main)} behind it (${SRC})` });
  }
  const b = at('mainBody');
  if (b) {
    const d = head.y - b.y;
    rows.push({ name: 'Main Body', st: near(d, F.body) ? 'pass' : 'warn', reason: `${fmtM(d)} behind the head; Fig 2: about ${km(F.body)} (15-20 km for the Armd Div; ${SRC}). Not committed against minor opposition (s4 para 4)` });
  }
  const fl = ['flankL', 'flankR'].map(at).filter((p): p is XY => !!p);
  if (fl.length) {
    const outs = fl.map((p) => Math.abs(p.x - head.x));
    rows.push({ name: 'Flank guards', st: fl.length === 2 && outs.every((o) => near(o, F.flank)) ? 'pass' : 'warn', reason: `${outs.map(fmtM).join(' and ')} out from the axis${fl.length < 2 ? ' (one flank only)' : ''}; Fig 2: about ${km(F.flank)} (${SRC})` });
  }
  return rows;
}

// ── the axis on the ground ────────────────────────────────────────────────────────────────────────────────────────

/** Water the axis crosses (rules.json classes): permanent water, seasonal water, canal, distributary, drain, stream. */
const WET = new Set([4, 5, 20, 21, 22, 46]);
/** The water a report line is set on: permanent water, canal, distributary, perennial stream (not drains). */
const RL_WATER = new Set([4, 20, 21, 46]);
/** How the axis crosses (rules.json crossing classes), for tracks: its word and verdict. */
const CROSSING: Record<number, { word: string; st: CheckState }> = {
  39: { word: 'a Cl 60+ bridge', st: 'pass' },
  40: { word: 'a Cl 50-59 bridge (the Al-Zarrar crosses; the Al-Khalid and T-80UD need Cl 60)', st: 'warn' },
  41: { word: 'a bridge below Cl 50 (no tank crosses)', st: 'fail' },
  42: { word: 'a bridge of unrecorded class (recce it before the tanks)', st: 'warn' },
  43: { word: 'a railway bridge', st: 'fail' },
  44: { word: 'a foot bridge', st: 'fail' },
  45: { word: 'a ford / ferry', st: 'warn' },
};
const ROAD: Record<number, string> = { 34: 'Cl 60+', 35: 'Cl 50-59', 36: 'below Cl 50', 37: 'class not recorded', 38: 'unmetalled' };
const worse = (a: CheckState, b: CheckState): CheckState => (['pass', 'unchecked', 'warn', 'fail'].indexOf(b) > ['pass', 'unchecked', 'warn', 'fail'].indexOf(a) ? b : a);

/** Points every `step` metres along a polyline (plan metres), with their distance along it. */
function walk(path: XY[], step: number): { p: XY; s: number; dir: XY }[] {
  const out: { p: XY; s: number; dir: XY }[] = [];
  let s0 = 0, next = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (!L) continue;
    const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    // evenly spaced along the whole line, across the bends
    for (; next <= s0 + L; next += step) { const t = next - s0; out.push({ p: { x: a.x + dir.x * t, y: a.y + dir.y * t }, s: next, dir }); }
    s0 += L;
  }
  return out;
}

/** A polyline simplified to within `tolM` of itself (Douglas-Peucker), for the axis arrow's control points. */
function simplify(path: XY[], tolM: number): XY[] {
  if (path.length <= 2) return path;
  const a = path[0], b = path[path.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y);
  let far = 0, at = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    const d = L ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L : Math.hypot(p.x - a.x, p.y - a.y);
    if (d > far) { far = d; at = i; }
  }
  if (far <= tolM) return [a, b];
  return [...simplify(path.slice(0, at + 1), tolM).slice(0, -1), ...simplify(path.slice(at), tolM)];
}

/** The point of a polyline nearest `p`: the leg it is on (`i` its start), the point, its distance along the line. */
function project(path: XY[], p: XY): { i: number; q: XY; s: number } {
  let best = { i: 0, q: path[0], s: 0 }, bd = Infinity, s0 = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) { bd = d; best = { i, q, s: s0 + t * L }; }
    s0 += L;
  }
  return best;
}

const lenOf = (path: XY[]) => path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);

/** The axis as laid: the Main Body through the SP to the covering troops (plan metres), and how far along it the SP is. */
export interface AdvAxis { path: XY[]; spAt: number; routed: boolean; pending: boolean }

/**
 * The axis on the ground: the least-cost way for tracks over the bundle's going (PlanGround.avenues: NO-GO avoided,
 * SLOW-GO dear), from the Main Body to the SP and from the SP to the covering troops; straight where no way is found
 * (outside the bundle's grid, or still loading). It is not a road route: the Move Planner's is.
 */
export function routeAxis(items: { role: string; pts: XY[] }[], f: FitFrame, g: PlanGround): AdvAxis {
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const sp = at('sp')!, ct = at('ctps') ?? { x: sp.x, y: sp.y + 6000 }, mb = at('mainBody') ?? { x: sp.x, y: sp.y - 8000 };
  let pending = false;
  const leg = (a: XY, b: XY): { pts: XY[]; routed: boolean } => {
    if (!g.avenues) return { pts: [a, b], routed: false };
    const A = toWorld(f, a), B = toWorld(f, b);
    const r = g.avenues(A, B, 400, 'tracked');
    if (r === null) { pending = pending || g.pending(); return { pts: [a, b], routed: false }; }
    const p = r[0]?.path;
    if (!p || p.length < 2) return { pts: [a, b], routed: false };
    const loc = p.map((w) => toLocal(f, w));
    // from `a` to `b`, whichever way the reader gave it
    if (Math.hypot(loc[0].x - a.x, loc[0].y - a.y) > Math.hypot(loc[loc.length - 1].x - a.x, loc[loc.length - 1].y - a.y)) loc.reverse();
    return { pts: [a, ...loc.slice(1, -1), b], routed: true };
  };
  const rear = leg(mb, sp), fwd = leg(sp, ct);
  return { path: [...rear.pts, ...fwd.pts.slice(1)], spAt: lenOf(rear.pts), routed: rear.routed && fwd.routed, pending };
}

/** The water features the axis crosses, in order: where along it, the water, how it is crossed. */
export interface AxisCrossing { s: number; at: XY; dir: XY; water: number | null; how: number | null; lengthM: number }

/** Read the classes along the axis: the NO-GO run, the road share, the water crossed (one feature per wet stretch). */
function readAxis(axis: AdvAxis, f: FitFrame, g: PlanGround) {
  const STEP = 20;
  const tracked = g.going('tracked');
  const pts = walk(axis.path, STEP);
  let n = 0, bad = 0, run = 0, worst = 0, worstAt = 0;
  const roads = new Map<number, number>();
  const xs: AxisCrossing[] = [];
  let cur: AxisCrossing | null = null, gap = 0;
  for (const q of pts) {
    const w = toWorld(f, q.p);
    const c = g.cls(w.x, w.y);
    if (c === null) continue;
    n++;
    const no = tracked.nogo.has(c);
    if (no) bad++;
    run = no ? run + STEP : 0;
    if (run > worst) { worst = run; worstAt = q.s - run / 2 - axis.spAt; }
    if (ROAD[c]) roads.set(c, (roads.get(c) ?? 0) + STEP);
    // a wet stretch or a crossing on it, joined across gaps under 60 m
    const wet = WET.has(c), how = CROSSING[c] ? c : null;
    if (wet || how !== null) {
      if (!cur) { cur = { s: q.s, at: q.p, dir: q.dir, water: wet ? c : null, how, lengthM: 0 }; xs.push(cur); }
      cur.lengthM = q.s - cur.s + STEP;
      if (wet && (cur.water === null || RL_WATER.has(c))) cur.water = c;
      if (how !== null && (cur.how === null || CROSSING[how].st !== 'pass')) cur.how = how;
      gap = 0;
    } else if (cur && (gap += STEP) >= 60) cur = null;
  }
  // water read with no crossing on the line: the line may pass just beside the bridge (a drawn axis, a raster cell):
  // a crossing within 60 m either side is taken as the one used
  for (const x of xs) {
    if (x.water === null || x.how !== null) continue;
    const mid = { x: x.at.x + x.dir.x * (x.lengthM / 2), y: x.at.y + x.dir.y * (x.lengthM / 2) }, n2 = { x: -x.dir.y, y: x.dir.x };
    for (let d = 20; d <= 60 && x.how === null; d += 20) for (const sgn of [1, -1]) {
      const w = toWorld(f, { x: mid.x + n2.x * d * sgn, y: mid.y + n2.y * d * sgn });
      const c = g.cls(w.x, w.y);
      if (c !== null && CROSSING[c] && c !== 50) { x.how = c; break; }
    }
  }
  // a bridge read along its deck shows no water: the water it spans is beside it, up to 150 m either side
  for (const x of xs) {
    if (x.water !== null || x.how === null || x.how === 50) continue;
    const mid = { x: x.at.x + x.dir.x * (x.lengthM / 2), y: x.at.y + x.dir.y * (x.lengthM / 2) }, n2 = { x: -x.dir.y, y: x.dir.x };
    for (let d = 30; d <= 150 && x.water === null; d += 30) for (const sgn of [1, -1]) {
      const w = toWorld(f, { x: mid.x + n2.x * d * sgn, y: mid.y + n2.y * d * sgn });
      const c = g.cls(w.x, w.y);
      if (c !== null && WET.has(c)) { x.water = c; break; }
    }
  }
  const steps = pts.length;
  return { n, steps, bad, worst, worstAt, roads, xs: xs.filter((x) => x.water !== null || (x.how !== null && x.how !== 50)) };
}

/**
 * On the ground, along the axis as laid (routed for tracks where the bundle allows): Axis route (its length against the
 * straight line, the share on roads and their classes), Going on the axis (NO-GO share and longest stretch), Crossings
 * on the axis (each water feature, how it is crossed: a Cl 60+ bridge passes, Cl 50-59 or unrecorded warns, below Cl 50
 * or none fails), Report lines (on the water features ahead of the SP, at least `rlApartM` apart, up to four; the bounds
 * between them) and the flank guards' ground. Report lines laid are returned for the map.
 */
export function advanceGroundRows(items: { role: string; pts: XY[] }[], f: FitFrame, g: PlanGround, doc: DoctrineSet, axis: AdvAxis | null = null, drawnRls: { label: string; s: number }[] | null = null, rlApartM: number | null = null): { rows: Check[]; rls: Record<string, { pts: XY[]; label: string }>; lines: { label: string; s: number }[] } {
  const F = advanceFigures(doc);
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const head = at('sp');
  const rls: Record<string, { pts: XY[]; label: string }> = {};
  if (!head) return { rows: [], rls, lines: [] };
  const ax: AdvAxis = axis ?? (() => {
    const ct = at('ctps') ?? { x: head.x, y: head.y + (F.ctps[0] + F.ctps[1]) / 2 }, mb = at('mainBody') ?? { x: head.x, y: head.y - F.body };
    return { path: [mb, head, ct], spAt: Math.hypot(head.x - mb.x, head.y - mb.y), routed: false, pending: false };
  })();
  const R = readAxis(ax, f, g);
  const rows: Check[] = [];
  const total = lenOf(ax.path);
  const where = (s: number) => (s >= ax.spAt ? `${fmtM(s - ax.spAt)} ahead of the SP` : `${fmtM(ax.spAt - s)} behind the SP`);
  if (R.n < R.steps / 2) {
    rows.push({ name: 'Going on the axis', st: 'unchecked', reason: 'the ground along the axis is not loaded yet' });
    return { rows, rls, lines: [] };
  }
  // the route
  const straight = Math.hypot(ax.path[ax.path.length - 1].x - ax.path[0].x, ax.path[ax.path.length - 1].y - ax.path[0].y);
  const onRoad = [...R.roads.values()].reduce((s, v) => s + v, 0);
  const roadTxt = R.roads.size ? `; ${Math.round((onRoad / total) * 100)} % on roads (${[...R.roads.entries()].sort((a, b) => b[1] - a[1]).map(([c, m]) => `${ROAD[c]} ${fmtM(m)}`).join(', ')})` : '; none of it on a road';
  rows.push(ax.routed
    ? { name: 'Axis route', st: total > straight * F.detour + 1 ? 'warn' : 'pass', reason: `the least-cost way for tracks over the bundle's going (NO-GO avoided, SLOW-GO dear), the Main Body through the SP to the C Tps: ${km(total)} against ${km(straight)} straight (${(total / straight).toFixed(2)} times; warn over ${F.detour}, E)${roadTxt}. Not a road route: the march table and the roads' classes are the Move Planner's` }
    : { name: 'Axis route', st: 'unchecked', reason: `${ax.pending ? 'the ground for the route is still loading' : 'no way for tracks found in the bundle\'s grid (about 25 km across)'}: the straight line read instead${roadTxt}` });
  // the going
  const share = R.bad / R.n;
  const gst: CheckState = R.worst > F.run[1] ? 'fail' : R.worst > F.run[0] || share > F.nogoWarn ? 'warn' : 'pass';
  rows.push({ name: 'Going on the axis', st: gst, reason: `${Math.round(share * 100)} % of the ${km(total)} is NO-GO for tracks (the bundle's tracked going, 20 m steps); the longest NO-GO stretch ${fmtM(R.worst)}${R.worst ? ` ${R.worstAt >= 0 ? `${fmtM(R.worstAt)} ahead of` : `${fmtM(-R.worstAt)} behind`} the SP` : ''} (warn over ${F.run[0]} m or ${Math.round(F.nogoWarn * 100)} %, fail over ${F.run[1]} m: E)${gst === 'pass' ? '' : ': a bridge or a detour there, or another axis; the mobile troops to seize the crossing ahead (s4 para 2)'}` });
  // the crossings
  if (!R.xs.length) rows.push({ name: 'Crossings on the axis', st: 'pass', reason: 'the axis crosses no water the bundle shows' });
  else {
    let st: CheckState = 'pass';
    const parts = R.xs.map((x) => {
      const water = x.water !== null ? g.label(x.water) : x.how !== null && x.how <= 44 ? 'water under a bridge' : 'water';
      const h = x.how !== null ? CROSSING[x.how] : null;
      const s1: CheckState = h ? h.st : 'fail';
      st = worse(st, s1);
      return `${water} ${where(x.s)}: ${h ? h.word : `no bridge on the axis (${fmtM(x.lengthM)} of it): bridge it, or the axis to a bridge`}`;
    });
    rows.push({ name: 'Crossings on the axis', st, reason: `${R.xs.length} water feature${R.xs.length > 1 ? 's' : ''}: ${parts.join('; ')}. Tanks need Cl 60 (rules.json; Al-Khalid about 48 t); the mobile troops seize the bridges ahead (s4 para 2)` });
  }
  // report lines: laid on the water ahead of the SP (or read as drawn)
  const RL_MAX = 4, apart = rlApartM ?? F.rlApart;
  let lines: { label: string; s: number }[];
  if (drawnRls) lines = drawnRls;
  else {
    lines = [];
    for (const x of R.xs) {
      if (!(x.water !== null ? RL_WATER.has(x.water) : x.how !== null && x.how >= 39 && x.how <= 43) || x.s <= ax.spAt + 300 || lines.length >= RL_MAX) continue;
      if (lines.length && x.s - lines[lines.length - 1].s < apart) continue;
      const i = lines.length + 1, half = 750, n = { x: -x.dir.y, y: x.dir.x };
      const name = x.water !== null ? g.label(x.water).replace(/ \/.*$/, '') : 'bridge';
      rls[`rl${i}`] = { pts: [{ x: x.at.x - n.x * half, y: x.at.y - n.y * half }, { x: x.at.x + n.x * half, y: x.at.y + n.y * half }], label: `RL ${i} ${name}` };
      lines.push({ label: `RL ${i} (${name})`, s: x.s });
    }
  }
  if (!lines.length) rows.push({ name: 'Report lines', st: 'unchecked', reason: 'no canal, distributary or stream crosses the axis ahead of the SP: set report lines on roads, railways or villages across the axis by eye (a report line is usually a terrain feature across the zone: OoW Vol II glossary)' });
  else {
    const sorted = [...lines].sort((a, b) => a.s - b.s);
    const bounds = sorted.map((l, i) => `${i ? sorted[i - 1].label.replace(/ \(.*$/, '') : 'SP'} to ${l.label.replace(/ \(.*$/, '')} ${fmtM(l.s - (i ? sorted[i - 1].s : ax.spAt))}`);
    rows.push({ name: 'Report lines', st: 'pass', reason: `${sorted.map((l) => `${l.label} ${where(l.s)}`).join('; ')} (on the water features across the axis, at least ${km(apart)} apart: ${rlApartM ? 'as set' : 'the default, E'}; a report line is usually a terrain feature across the zone: OoW Vol II glossary). Bounds: ${bounds.join(', ')}` });
  }
  // the flank guards
  const tracked = g.going('tracked');
  const fl = (['flankL', 'flankR'] as const).map((r) => ({ r, p: at(r) })).filter((x): x is { r: 'flankL' | 'flankR'; p: XY } => !!x.p);
  if (fl.length) {
    const read = fl.map(({ r, p }) => { const w = toWorld(f, p); const c = g.cls(w.x, w.y); return { side: r === 'flankL' ? 'left' : 'right', c, no: c !== null && tracked.nogo.has(c), slow: c !== null && tracked.caution.has(c) }; });
    const known = read.filter((x) => x.c !== null);
    rows.push(!known.length ? { name: 'Flank guards\' ground', st: 'unchecked', reason: 'their ground is not loaded yet' }
      : { name: 'Flank guards\' ground', st: known.some((x) => x.no) ? 'warn' : 'pass', reason: known.map((x) => `the ${x.side} flank guard on ${g.label(x.c!)}${x.no ? ' (NO-GO for tracks)' : x.slow ? ' (SLOW-GO for tracks)' : ''}`).join('; ') });
  }
  return { rows, rls, lines };
}

// ── the march: timings and halting areas (the Move Planner's road engine) ───────────────────────────────────────────

/** A serial of the advance: its name and vehicles, and what was counted. */
export interface MarchSerial { name: string; vehicles: number; known: string }
/** What the advance's march is worked from (Recipe.march): the serials from the ORBAT, the Move Planner's road rules. */
export interface AdvMarch { serials: MarchSerial[]; rules: MvRoadRules; src: string }

/**
 * The serials from the ORBAT: the Advance Guard an Armr Regt group (the Armr Regt's vehicles, p 115-117), the Main
 * Body the IABG less that Regt (its units' vehicle totals; those the ORBAT gives none for are named, not counted).
 * The road rules are MoveDoctrine `road` (speeds with tanks, density, halts). Null without the IABG or the Regt.
 */
export function marchFromOrbat(o: OrbatSet, moveDoc: any): AdvMarch | null {
  const find = (id: string | undefined) => (id ? o.own.find((u) => u.id === id) ?? null : null);
  const vehs = (u: any) => Number((u?.vehicles ?? []).find((v: any) => /^Total/i.test(String(v.name)))?.count) || 0;
  const regt = find('armr-regt'), bde = find('armr-iabg');
  const rv = vehs(regt);
  if (!regt || !bde || !rv) return null;
  let body = 0;
  const known: string[] = [], unknown: string[] = [];
  for (const c of bde.children ?? []) {
    const n = (Number(c.count) || 1) - (c.unit === 'armr-regt' ? 1 : 0);
    if (n <= 0) continue;
    const v = vehs(find(c.unit));
    if (v) { body += v * n; known.push(`${n > 1 ? `${n} ` : ''}${c.role} ${v * n}`); } else unknown.push(String(c.role));
  }
  return {
    serials: [
      { name: 'Adv Gd (Armr Regt gp)', vehicles: rv, known: `the Armr Regt's ${rv} vehicles (p ${regt.page})` },
      { name: 'Main Body', vehicles: body, known: `${known.join(', ')}; not counted, no vehicle total in the ORBAT: ${unknown.join(', ')}` },
    ],
    rules: roadRulesFrom(moveDoc),
    src: `SO's Hbk 2019 p ${bde.page} (IABG: 3 Armr Regts as printed, two held on the ground), MoveDoctrine road (R)`,
  };
}

/** The point and direction at distance `s` along a polyline. */
function pointAt(path: XY[], s: number): { p: XY; dir: XY } {
  let s0 = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (!L) continue;
    if (s <= s0 + L || i === path.length - 2) { const t = Math.max(0, Math.min(1, (s - s0) / L)); return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } }; }
    s0 += L;
  }
  return { p: path[0], dir: { x: 0, y: 1 } };
}

/** The polyline from distance `s0` to its end. */
function from(path: XY[], s0: number): XY[] {
  const out: XY[] = [pointAt(path, s0).p];
  let s = 0;
  for (let i = 0; i + 1 < path.length; i++) { s += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y); if (s > s0 + 1) out.push(path[i + 1]); }
  return out;
}

const hPlus = (min: number) => `H${min < 0 ? '-' : '+'}${Math.floor(Math.abs(min) / 60)}:${String(Math.round(Math.abs(min) % 60)).padStart(2, '0')}`;

/**
 * Halting areas for the Main Body (an area in an advance where a unit can halt till it can move forward: OoW Vol II
 * glossary): one 1 km short of each report line, beside the axis on its right so the axis stays clear, 600 x 400 m (E).
 */
export function haltingAreas(axis: AdvAxis, lines: { label: string; s: number }[]): Record<string, { pts: XY[]; label: string }> {
  const out: Record<string, { pts: XY[]; label: string }> = {};
  [...lines].sort((a, b) => a.s - b.s).slice(0, 4).forEach((l, i) => {
    const { p, dir } = pointAt(axis.path, Math.max(0, l.s - 1000));
    const n = { x: dir.y, y: -dir.x }, c = { x: p.x + n.x * 500, y: p.y + n.y * 500 };
    const corner = (u: number, v: number) => ({ x: c.x + dir.x * u + n.x * v, y: c.y + dir.y * u + n.y * v });
    out[`ha${i + 1}`] = { pts: [corner(-300, -200), corner(300, -200), corner(300, 200), corner(-300, 200)], label: `HA ${i + 1}` };
  });
  return out;
}

/**
 * The march along the axis by the Move Planner's road engine (MoveRoad.simulate): the Adv Gd's head at the SP at H, the
 * Main Body's head `mainBodyBackM` behind it, both moving at H (first light today at the SP, civil twilight: an advance
 * to contact by day, E), at the speeds for columns with tanks on good roads, the road density, the halts of the road
 * rules. March row: each serial's column length and time past a point, when its head reaches the SP, each report line
 * and the C Tps' line, its halts; warns when the Adv Gd's column is longer than the gap to the Main Body's head (the
 * Main Body closes on it) or a serial runs on past last light.
 */
export function advanceMarch(axis: AdvAxis, lines: { label: string; s: number }[], f: FitFrame, doc: DoctrineSet, march: AdvMarch, hAt: 'first' | 'last' | 'now' = 'first', nowMs: number = Date.now()): Check {
  const F = advanceFigures(doc), R = march.rules;
  const [vd, vn] = speedFor('good', true, R);
  const dens = densityFor('road', R);
  const ll = (p: XY): LngLat => { const w = toWorld(f, p); return mercToLngLat(w.x, w.y); };
  const spLL = ll(pointAt(axis.path, axis.spAt).p);
  const clock = clockFrom(todayIn());
  const light = new LightBook(clock, 'civil');
  // H: first light or last light today at the SP (civil twilight), or now
  const today = light.day(0, spLL[1], spLL[0]);
  const lit = hAt === 'last' ? today.last : today.first;
  const H = hAt === 'now' ? nowMs : Number.isFinite(lit) ? lit : atLocal(clock, 0, hAt === 'last' ? 1110 : 360);
  const dayAtH = light.isDay(H + 60000, spLL[1], spLL[0]);
  const total = lenOf(axis.path);
  let st: CheckState = 'pass';
  const notes: string[] = [];
  const parts = march.serials.map((s, i) => {
    const back = i === 0 ? 0 : F.body;
    const s0 = Math.max(0, axis.spAt - back);
    const pts = [...(axis.spAt - s0 > 1 ? [{ name: 'SP', s: axis.spAt - s0 }] : []), ...lines.map((l) => ({ name: l.label.replace(/ \(.*$/, ''), s: l.s - s0 })).filter((q) => q.s > 1)];
    const ser: MvSerialIn = {
      id: `adv${i}`, name: s.name, vehicles: s.vehicles, speedDay: vd, speedNi: vn, densDay: dens.day, densNi: dens.night,
      path: mkPath(from(axis.path, s0).map(ll)), startMs: H, window: { kind: 'both' },
      halts: { mode: 'running', runMin: R.shortRunMin, haltMin: R.shortHaltMin, longEvery: R.longEvery, longMin: R.longHaltMin, clockFirstAtMin: R.clockFirstAtMin, clockEveryMin: R.clockEveryMin },
      densityHalt: false, points: pts,
    };
    const run = simulate(ser, light, R);
    const at = (q: number) => hPlus((dueAt(run, q) - H) / 60000);
    const halts = run.stops.filter((x) => x.kind === 'SH' || x.kind === 'LH');
    if (run.segs.some((g) => g.mode === 'move' && g.day !== dayAtH)) { st = 'warn'; notes.push(`${s.name} runs on past ${dayAtH ? 'last' : 'first'} light`); }
    if (i === 0 && run.lenDayM > F.body) { st = 'warn'; notes.push(`the Adv Gd as one road column (${km(run.lenDayM)} at the road density) is longer than the ${km(F.body)} to the Main Body's head: the Main Body closes on it (hold it back, move by bounds, or the Adv Gd deployed off the road, which takes less depth)`); }
    return `${s.name}: ${s.vehicles} vehicles (${s.known}), ${km(run.lenDayM)} long by day, ${run.tppDay} min past a point; its head ${pts.map((q) => `at ${q.name} ${at(q.s)}`).join(', ')}${pts.length ? ', ' : ''}at the C Tps' line ${at(run.lengthM)}, its tail clear of it ${hPlus((clearAt(run, run.lengthM) - H) / 60000)}${halts.length ? `; ${halts.length} halt${halts.length > 1 ? 's' : ''} (${halts.map((x) => x.kind).join(', ')})` : ''}`;
  });
  return {
    name: 'March', st,
    reason: `H: the Adv Gd's head at the SP ${hAt === 'now' ? 'now (as set)' : hAt === 'last' ? 'at last light today there (civil twilight, as set: a night advance)' : 'at first light today there (civil twilight: an advance by day, the default)'}; the Main Body's head ${km(F.body)} back, both moving at H; ${vd} km/h by day, ${vn} by night (columns with tanks on good roads), ${dens.day} vehicles a km by day, ${dens.night} by night, halts ${R.shortHaltMin} min after each ${R.shortRunMin} min running (MoveDoctrine road, R); the axis ${km(total)}. ${parts.join('. ')}${notes.length ? `. ${notes.join('; ')}` : ''}. ${march.src}. The road state and a march table to the ground's roads: the Move Planner`,
  };
}

/** An advance fitted where it rests (PlanFit.fitLayout hands it over): the click is the SP, the aim the axis. */
export function fitAdvance(inp: FitLayoutInput): FittedLayout | null {
  const { recipe, ctx, ground } = inp;
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  if (!pivot) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k: kOf(inp.anchor.y), pivot: pivot.pts[0] };
  inp.begin?.();
  const axis = routeAxis(base.items, frame, ground);
  const gr = advanceGroundRows(base.items, frame, ground, ctx.doc, axis, null, recipe.advance?.rlApartM ?? null);
  // the axis arrow along the route, a little past the C Tps; the report lines on the water
  const p = axis.path, a = p[p.length - 2], b = p[p.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // simplified within 25 m, so the arrow as drawn reads as the route did; its head 300 m past the C Tps
  const arrow = simplify([...p, { x: b.x + ((b.x - a.x) / L) * 300, y: b.y + ((b.y - a.y) / L) * 300 }], 25);
  // the Main Body's halting areas short of the report lines; the march timed along the axis (Recipe.march, the ORBAT's)
  const has = haltingAreas(axis, gr.lines);
  const raw = solveRecipe(recipe, ctx, { ...inp.opts, paths: { ...(inp.opts.paths ?? {}), axis: arrow }, geom: { ...(inp.opts.geom ?? {}), ...gr.rls, ...has } });
  const marchRow = recipe.march && !axis.pending ? advanceMarch(axis, gr.lines, frame, ctx.doc, recipe.march, recipe.advance?.hAt ?? 'first') : null;
  const haRow: Check[] = Object.keys(has).length ? [{ name: 'Halting areas', st: 'pass', reason: `${Object.keys(has).map((k) => has[k].label).join(', ')}: for the Main Body, 1 km short of each report line, beside the axis on its right (600 x 400 m, E), where it halts till it can move forward (OoW Vol II glossary)` }] : [];
  const rows = [...advanceRows(raw.items, ctx.doc), ...gr.rows, ...haRow, ...(marchRow ? [marchRow] : [])];
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const fit: FitResult = {
    nudges: {}, slides: [], killingGr: null, slots: {}, rows, approaches: [],
    score: Math.max(0, 100 - 25 * fails - 8 * warns), fails, warns,
    pending: axis.pending || ground.pending(), data: ground.dataLine(), from: null, fromAssumed: true,
  };
  const res = { ...raw, mode: 'terrain' as const, rows, slots: [], assumptions: [`Fitted to the ground: ${fit.data}.`, axis.routed ? 'The axis is the least-cost way for tracks over the bundle\'s going, not a road route (the Move Planner\'s).' : 'The axis is straight from the SP: no way for tracks was found in the bundle\'s grid.', 'Fig 2\'s figures are read off a highlighted scan (uncertain).'] };
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain: null, enemy: null, unit: null };
}

/** Check my plan for an advance built here: the drawn symbols, the axis as drawn (else from the SP toward the C Tps). */
export function checkAdvance(inp: FitLayoutInput, drawn: AdvDrawn): { rows: Check[]; confirm: string[]; pending: boolean; read: string[]; missing: string[] } | null {
  const { recipe, ctx, ground } = inp;
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  const sp = drawn.sp?.pts[0], ct = drawn.ctps?.pts[0], van = drawn.vanGd?.pts[0];
  if (!pivot || !sp) return null;
  // the direction of advance: from the SP toward the covering troops, else from the Van Gd to the SP
  const bearing = ct ? Math.atan2(ct[0] - sp[0], ct[1] - sp[1]) : van ? Math.atan2(sp[0] - van[0], sp[1] - van[1]) : inp.bearing;
  const frame: FitFrame = { anchor: { x: sp[0], y: sp[1] }, bearing, k: kOf(sp[1]), pivot: pivot.pts[0] };
  inp.begin?.();
  const loc = (q: MercXY) => toLocal(frame, { x: q[0], y: q[1] });
  const items: PlanItem[] = base.items.filter((it) => drawn[it.role]).map((it) => ({ ...it, pts: drawn[it.role].pts.map(loc) }));
  // the axis as drawn: its points from the tail (the Main Body's end) toward the head, through the point nearest the SP
  let axis: AdvAxis | null = null;
  const ap = drawn.axis?.pts.map(loc);
  const head = items.find((i) => i.role === 'sp')!.pts[0];
  if (ap && ap.length >= 2) {
    let pts = ap[0].y > ap[ap.length - 1].y ? [...ap].reverse() : ap;
    // read up to the covering troops, not past the arrow's head
    const ctp = items.find((i) => i.role === 'ctps');
    if (ctp) { const q = project(pts, centre(ctp.pts)); pts = [...pts.slice(0, q.i + 1), q.q]; }
    axis = { path: pts, spAt: project(pts, head).s, routed: true, pending: false };
  }
  // each drawn report line where it meets the axis, measured along it
  const rlDrawn = Object.keys(drawn).filter((r) => /^rl\d$/.test(r)).map((r) => { const c = centre(drawn[r].pts.map(loc)); return { label: `RL ${r.slice(2)}`, s: axis ? project(axis.path, c).s : c.y - head.y }; });
  const gr = advanceGroundRows(items, frame, ground, ctx.doc, axis, rlDrawn.length ? rlDrawn : null);
  const rows = [...advanceRows(items, ctx.doc), ...gr.rows];
  const names = (r: string) => recipe.slots.find((s) => s.role === r)?.label || r;
  const need = ['sp', 'ctps', 'vanGd', 'mainGd', 'mainBody', 'flankL', 'flankR'];
  return { rows, confirm: ['The march on the roads (the march table, the roads\' and bridges\' classes): the Move Planner', 'Halting areas along the axis'], pending: ground.pending(), read: Object.keys(drawn).map(names), missing: need.filter((r) => !drawn[r]).map(names) };
}


/** Recipe roles of an advance, for the tab. */
export const isAdvance = (r: Recipe | undefined | null) => r?.task === 'advance';
