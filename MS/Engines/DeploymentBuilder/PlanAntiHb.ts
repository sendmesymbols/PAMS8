/**
 * PlanAntiHb.ts — PURE. Anti para / heliborne defence of a vulnerable point (recipe `bn-anti-hb`, layout `anti-hb`),
 * from GSP 1947 Infantry Division in Battle s28 pp 127-133:
 * - the probable landing sites and likely objectives from the map and the ground (para 6 p 130): with the terrain the
 *   likely landing areas (LAs) are read round the VP: open ground a helicopter can land on, level (IpbDoctrine's LZ
 *   figures, held here as PlanDoctrine antiHb.*), clear over a landing patch, nearest the VP first; without it they are
 *   assumed (grey);
 * - early warning: OPs keeping every possible landing area under watch (para 5 a pp 128-129);
 * - obstacles on the probable landing areas (poles, stakes, mines) and on the routes out of them (para 11 a-b p 131), road
 *   blocks on the routes to the objective (para 13 a (5) p 132);
 * - a local defence force covering the landing areas and the objective (para 9 pp 130-131);
 * - an immediate action group, mobile, engaging the force while it lands, and a deliberate action group, a combined arms
 *   mobile force with armour (paras 10, 13 pp 131-133).
 *
 * Pure: plan metres, y toward the front (the solver's frame); the fit reads world points through the frame.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, PlanItem, XY, SolveResult } from './PlanSolve';
import { solveRecipe } from './PlanSolve';
import { detectTerrain, toWorld, type FitFrame, type FitLayoutInput, type FittedLayout, type FitResult } from './PlanFit';

const G = 'GSP 1947 Inf Div in Battle';
const P = (x: number, y: number): XY => ({ x, y });
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const centre = (pts: XY[]) => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? r[0] : fb; };
const rect = (c: XY, w: number, h: number): XY[] => [P(c.x - w / 2, c.y + h / 2), P(c.x + w / 2, c.y + h / 2), P(c.x + w / 2, c.y - h / 2), P(c.x - w / 2, c.y - h / 2)];
const LETTERS = ['A', 'B', 'C'];

export const isAntiHb = (r: Recipe) => r.layout === 'anti-hb';

/** What the fit read of the likely landing areas: how many, how far it looked; null in geometry mode. */
export interface AntiHbRead { found: number; searchedM: number; pending: boolean }

/** The anti-heliborne rows; empty for any other plan. */
export function antiHbRows(items: PlanItem[], recipe: Recipe, doc: DoctrineSet, read: AntiHbRead | null): { rows: Check[]; confirm: string[] } {
  if (!isAntiHb(recipe)) return { rows: [], confirm: [] };
  const at = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const las = items.filter((i) => /^la[A-C]$/.test(i.role) && i.pts.length >= 3);
  const vp = at('vp');
  const near = (role: string, la: PlanItem, within: number) => items.some((i) => new RegExp(`^${role}[A-C]$`).test(i.role) && i.role.slice(-1) === la.role.slice(-1) && i.pts.length && dist(centre(i.pts), centre(la.pts)) <= within);
  const R = num(doc, 'antiHb.searchM', 3000);
  const rows: Check[] = [];
  rows.push(!read
    ? { name: 'Landing areas', st: 'unchecked', reason: `${las.length} likely landing areas assumed round the VP (E): the probable landing sites and likely objectives come from the map and the ground (${G} s28 para 6 p 130); place the plan with the terrain data to read them` }
    : read.pending
      ? { name: 'Landing areas', st: 'unchecked', reason: 'the ground round the VP is still loading' }
      : { name: 'Landing areas', st: read.found ? 'pass' : 'warn', m: read.found, reason: read.found
        ? `${read.found} likely landing area${read.found === 1 ? '' : 's'} read within ${fmtM(R)} of the VP, nearest first: open ground a helicopter can land on, level, clear over a landing patch (PlanDoctrine antiHb, from IpbDoctrine's LZ figures); the probable landing sites and likely objectives from the map and the ground, confirmed by a detailed study (${G} s28 para 6 p 130)`
        : `none read within ${fmtM(R)}: confirm on the ground; landing areas further out still threaten the VP (${G} s28 para 6 p 130)` });
  if (!las.length) {
    // nothing read to watch, obstruct or block: grey, never a pass
    for (const name of ['LAs watched', 'LAs obstructed', 'Exits blocked']) rows.push({ name, st: 'unchecked', reason: `no landing area read: the OPs, obstacles and road blocks go on the landing areas the ground study finds (${G} s28 paras 5 a, 11 a-b pp 128-131)` });
  } else {
    const watched = las.filter((la) => near('op', la, 1500)).length;
    rows.push({ name: 'LAs watched', st: watched === las.length ? 'pass' : 'warn', reason: `${watched} of ${las.length} landing areas under an OP: the artillery OPs dovetailed into the anti-heliborne plan to keep all possible landing areas under vigil, OPs of the formations and units for the dead areas, with communication and alarms, mobile patrols by night (${G} s28 para 5 a pp 128-129)` });
    const blocked = las.filter((la) => near('ob', la, 200)).length;
    rows.push({ name: 'LAs obstructed', st: blocked === las.length ? 'pass' : 'warn', reason: `${blocked} of ${las.length} probable landing areas denied by obstacles: poles, stakes and mines (${G} s28 para 11 a p 131)` });
    const exits = las.filter((la) => near('rb', la, vp ? dist(centre(la.pts), vp.pts[0]) : 3000)).length;
    rows.push({ name: 'Exits blocked', st: exits === las.length ? 'pass' : 'warn', reason: `${exits} of ${las.length} landing areas with a road block on the way to the VP: obstacles on the routes out of the probable landing areas (${G} s28 para 11 b p 131); the action group's road blocks on the routes to the objective if it is delayed (para 13 a (5) p 132)` });
  }
  rows.push(at('defVp')
    ? { name: 'Local defence', st: 'pass', reason: `${at('defVp')?.label ?? 'the local defence force'} at the VP: covers the likely landing areas and gives close support to the objective, to delay, disorganise and contain the landed En; it may counter-attack during the landing, when the En is most vulnerable (${G} s28 para 9 pp 130-131)` }
    : { name: 'Local defence', st: 'warn', reason: `no local defence force at the VP (${G} s28 para 9 pp 130-131)` });
  const iag = at('iag'), dag = at('dag');
  if (iag && las.length) {
    const far = Math.max(...las.map((la) => dist(iag.pts[0], centre(la.pts))));
    const kmh = num(doc, 'moves.tankKmh.go', 24);
    rows.push({ name: 'Immediate action', st: 'pass', m: far, reason: `${iag.label || 'the immediate action group'}, mobile: ${fmtM(far)} to the farthest landing area, about ${Math.round((far / 1000) * (60 / kmh))} min mounted (IPB p 18 vehicle rate), straight line: it goes to the landing at once and engages with its own weapons, the artillery, aircraft and helicopters, the force engaged in flight and while it lands (${G} s28 para 5 e p 129, para 13 a pp 132); no time is printed` });
  }
  rows.push(dag
    ? { name: 'Deliberate action', st: 'pass', reason: `${dag.label || 'the deliberate action group'}: a combined arms mobile force, strong, with armour, its actions pre-planned on the map study and recce of the likely targets and landing sites; it destroys the landed force once its concentration is confirmed (${G} s28 para 10 p 131, para 13 b pp 132-133); the En may drop para / heliborne forces of up to a Bde at a time into the intermediate depth, to take ITG or hold up the reserves (SZ Battle (C&SC) p 7 para 14): size it against that` }
    : { name: 'Deliberate action', st: 'warn', reason: `no deliberate action group: a strong mobile reserve with armour earmarked to counter-attack and destroy the landed En (${G} s28 para 10 p 131)` });
  return {
    rows,
    confirm: [
      'Early warning beyond the OPs: the AD units\' ground radars, army aviation patrols, Mobile Observation Units, Mujahids, police, civil defence and the people (GSP s28 para 5 b-d p 129)',
      'Report: type and number of aircraft, direction of flight, time, map reference of the landing area, troops and their direction, counter action taken (GSP s28 para 5 f p 130)',
      'Bridges that may be En objectives prepared for demolition, the switches away from the bridge (GSP s28 para 11 c p 131)',
      'The area divided into sectors, each unit responsible for one, every unit with an anti-heliborne task (GSP s28 para 12 p 131)',
    ],
  };
}

/** The likely landing areas round the VP on the ground: open land classes, level, clear over a patch, nearest first. */
function findLas(base: SolveResult, f: FitFrame, inp: FitLayoutInput): { at: XY[]; read: AntiHbRead } {
  const g = inp.ground, doc = inp.ctx.doc;
  const vp = base.items.find((i) => i.role === 'vp')?.pts[0] ?? P(0, 0);
  const R = num(doc, 'antiHb.searchM', 3000), patch = num(doc, 'antiHb.laMinM', 150), apart = num(doc, 'antiHb.laApartM', 800);
  const clearOf = num(doc, 'antiHb.clearOfVpM', 600), slopeOk = num(doc, 'antiHb.slopeOkDeg', 7);
  const land = new Set<number>(((doctrineAt(doc, 'antiHb.landClasses') as any)?.value as number[] | undefined) ?? [0, 2, 12, 16, 17, 18, 23, 38]);
  const step = 150;
  let pending = false, known = 0;
  const cand: { p: XY; d: number }[] = [];
  for (let x = vp.x - R; x <= vp.x + R; x += step) for (let y = vp.y - R; y <= vp.y + R; y += step) {
    const p = P(x, y), d = dist(p, vp);
    if (d > R || d < clearOf) continue;
    let ok = true;
    for (const dx of [-patch / 2, 0, patch / 2]) { for (const dy of [-patch / 2, 0, patch / 2]) { const w = toWorld(f, P(x + dx, y + dy)); const c = g.cls(w.x, w.y); if (c === null) { pending = true; ok = false; break; } if (!land.has(c)) { ok = false; break; } } if (!ok) break; }
    if (!ok) continue;
    known++;
    const zs = [P(x - patch / 2, y), P(x + patch / 2, y), P(x, y - patch / 2), P(x, y + patch / 2)].map((q) => { const w = toWorld(f, q); return g.elev(w.x, w.y); });
    if (zs.some((z) => !Number.isFinite(z))) continue;
    const slope = (Math.atan(Math.max(Math.abs(zs[0] - zs[1]), Math.abs(zs[2] - zs[3])) / patch) * 180) / Math.PI;
    if (slope > slopeOk) continue;
    cand.push({ p, d });
  }
  cand.sort((a, b) => a.d - b.d);
  // all round: the nearest in each third of the circle round the VP first (every possible landing area under vigil,
  // GSP s28 para 5 a p 128; a decision, E), then the nearest left over where a third has none
  const third = (p: XY) => Math.floor((((Math.atan2(p.x - vp.x, p.y - vp.y) * 180) / Math.PI + 360) % 360) / 120);
  const at: XY[] = [];
  const take = (c: { p: XY }) => { if (at.length < LETTERS.length && at.every((q) => dist(q, c.p) >= apart)) at.push(c.p); };
  for (let s = 0; s < 3; s++) { const c = cand.find((k) => third(k.p) === s && at.every((q) => dist(q, k.p) >= apart)); if (c) take(c); }
  for (const c of cand) take(c);
  // lettered clockwise from north, nearest first within that
  at.sort((a, b) => third(a) - third(b) || dist(a, vp) - dist(b, vp));
  return { at, read: { found: at.length, searchedM: R, pending: pending && !known ? true : g.pending() } };
}

/** The anti-heliborne plan fitted to the ground: its landing areas read, their OPs, obstacles and road blocks laid to them. */
export function fitAntiHb(inp: FitLayoutInput): FittedLayout | null {
  const { recipe, ctx } = inp;
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  if (!pivot) return null;
  const k = 1 / Math.cos(2 * Math.atan(Math.exp(inp.anchor.y / 6378137)) - Math.PI / 2);
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k, pivot: pivot.pts[0] };
  inp.begin?.();
  const { at, read } = findLas(base, frame, inp);
  // the found ones only: an LA not read on the ground is not drawn (its OP, obstacle and road block with it)
  const keep = new Set(LETTERS.slice(0, at.length));
  const r2: Recipe = read.pending ? recipe : { ...recipe, slots: recipe.slots.filter((s) => { const m = /^(la|op|ob|rb)([A-C])$/.exec(s.role); return !m || keep.has(m[2]); }) };
  const vp = base.items.find((i) => i.role === 'vp')?.pts[0] ?? P(0, 0);
  const patch = num(ctx.doc, 'antiHb.laMinM', 150), opM = num(ctx.doc, 'antiHb.opFromLaM', 400);
  const geom: Record<string, { pts: XY[] }> = {};
  if (!read.pending) at.forEach((c, i) => {
    const L = LETTERS[i], d = dist(c, vp) || 1, ux = (vp.x - c.x) / d, uy = (vp.y - c.y) / d;
    geom[`la${L}`] = { pts: rect(c, patch * 2, patch * 2) };
    geom[`ob${L}`] = { pts: rect(c, patch * 2 + 100, patch * 2 + 100) };
    geom[`op${L}`] = { pts: [P(c.x + ux * Math.min(opM, d / 2), c.y + uy * Math.min(opM, d / 2))] };
    geom[`rb${L}`] = { pts: [P(c.x + ux * (d / 2), c.y + uy * (d / 2))] };
  });
  const raw = solveRecipe(r2, ctx, { ...inp.opts, geom: { ...(inp.opts.geom ?? {}), ...geom } });
  const ah = antiHbRows(raw.items, r2, ctx.doc, read);
  const rows = ah.rows;
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const fit: FitResult = {
    nudges: {}, slides: [], killingGr: null, slots: {}, rows, approaches: [],
    score: Math.max(0, 100 - 25 * fails - 8 * warns), fails, warns,
    pending: read.pending || inp.ground.pending(), data: inp.ground.dataLine(), from: null, fromAssumed: true,
  } as FitResult;
  const res: SolveResult = { ...raw, mode: 'terrain' as const, rows, slots: [], assumptions: [`Fitted to the ground: ${fit.data}.`, 'The likely landing areas are read off the bundle\'s classes and 30 m elevation: confirm each on the ground.'], confirm: [...(raw.confirm ?? []), ...ah.confirm] } as SolveResult;
  // the ground where it rests, for the card's Ground row (the anti-heliborne rows do not depend on it)
  const terrain = inp.terrain && inp.terrain !== 'auto' ? { kind: inp.terrain, source: 'user' as const } : detectTerrain(inp.ground, frame, raw, r2, ctx.doc);
  return { recipe: r2, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain, enemy: null, unit: null };
}
