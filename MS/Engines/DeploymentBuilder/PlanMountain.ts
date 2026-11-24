/**
 * PlanMountain -- the mountain layouts of MW (Mountain Warfare, GSP 2016) on top of the ordinary defence and attack
 * solvers: rows the geometry settles for each layout, by the book and page.
 *
 * Defence (MW s2 pp 152-162): the layout in strong points, tiers from the foothills or valleys to the ridge line, the
 * final battle on the ridge (p 152 para 8); a Pl strong point with 30 days' staying power in each Coy posn (para 9); a
 * ridge sandwiched in nullahs, 1/3 of the troops on the nullahs, 2/3 on the ridge (p 154 para 11); a penetrant ridge
 * held in depth along it, knolls as Pl strong points, side spurs held and the valleys between them blocked (p 155 para
 * 12 b); a lateral ridge held on its top, all round with a bias to the front, forward spurs occupied (p 157 para 13); a
 * pass held on the heights dominating its two shoulders (p 158 para 14); a narrow valley held on the side spurs and hill
 * features both sides in successive posns, a broad one on the valley bed as well, strong at its mouth (pp 161-162 para 16).
 *
 * Attack (MW s1 pp 78-95, 109): the Obj a hill feature on a flank of the main axis or in the rear that dominates the
 * defences (p 78 para 3); a multidirectional attack: isolation, infiltration, blocking posns on the routes of
 * reinforcement and escape, a fire base on an adjoining hill (pp 83-84 para 13); a reserve on each axis, phases to make a
 * reserve at Bn level (p 82 para 9); the fire base long range direct fire weapons, one target per two weapons (p 94 para
 * 28); a strong point reduced by five Pls, three up, one reserve, one infiltrating (p 109 para 10).
 *
 * Pure: plan metres; the En side read from the plan itself (where the forward posns lie from the reserve).
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, XY } from './PlanSolve';
import { buaAttackRows, buaDefRows, fixingRows } from './PlanBua';

type Item = { role: string; label?: string; pts: XY[] };
const P = (x: number, y: number): XY => ({ x, y });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const centre = (pts: XY[]): XY => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const spread = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : 0);

/** The mountain defence layouts and the attack (recipe layouts). */
export const MTN_DEF_LAYOUTS = ['ridge', 'penetrant', 'lateral', 'pass', 'valley'] as const;
export const isMountainRecipe = (r: Recipe) => (r.task === 'defence' && (MTN_DEF_LAYOUTS as readonly string[]).includes(r.layout)) || (r.task === 'attack' && r.layout === 'mtn');

/**
 * Pls in a slot: a Pl 1, a Coy 3 less any Pls it has given away, a Bn 12. "less a Pl" and "less 12 Pl" (a numbered Pl)
 * are one; "less two Pls" and "less 2 Pls" are two.
 */
export function plsOf(slot: { echelon?: string; label?: string }): number {
  const less = /less (a|one|two|\d+) (Pls?)\b/i.exec(slot.label ?? '');
  const n = !less ? 0 : less[2].toLowerCase() === 'pl' ? 1 : /two/i.test(less[1]) ? 2 : /\d/.test(less[1]) ? Number(less[1]) : 1;
  return slot.echelon === '14' ? 1 : slot.echelon === '15' ? 3 - n : slot.echelon === '16' ? 12 - n : 0;
}

/** The rows for a mountain, BUA or fixing-force layout (none for any other recipe). */
export function layoutRows(items: Item[], recipe: Recipe, doc: DoctrineSet): Check[] {
  // the BUA attack and defence and the MIB fixing force (PlanBua) go through the same hook
  if (recipe.layout === 'bua') return recipe.task === 'attack' ? buaAttackRows(items, recipe, doc) : buaDefRows(items, recipe);
  if (recipe.layout === 'fixing') return fixingRows(items, recipe, doc);
  if (!isMountainRecipe(recipe)) return [];
  return recipe.task === 'attack' ? mtnAttackRows(items, doc) : mtnDefRows(items, recipe, doc);
}

function mtnDefRows(items: Item[], recipe: Recipe, doc: DoctrineSet): Check[] {
  const rows: Check[] = [];
  const slot = (role: string) => recipe.slots.find((s) => s.role === role);
  const has = (re: RegExp) => items.filter((i) => re.test(i.role) && i.pts.length);
  const byKind = (k: string) => items.filter((i) => slot(i.role)?.kind === k && i.pts.length);
  const fwd = byKind('fwd'), back = [...byKind('depth'), ...byKind('res')];
  if (!fwd.length) return rows;
  // the En side: where the forward posns lie from the depth and reserve (+1 = +y)
  const fy = centre(fwd.flatMap((i) => i.pts)).y, by = back.length ? centre(back.flatMap((i) => i.pts)).y : fy - 1;
  const en = fy >= by ? 1 : -1;
  const ahead = (p: XY) => en * p.y;
  const ctr = (i: Item) => centre(i.pts);
  const lay = recipe.layout;

  if (lay === 'ridge') {
    // 1/3 of the troops on the nullahs, 2/3 on the ridge line (p 154 para 11)
    // every posn held by a Pl, Coy or Bn (the Battle Posns with an echelon; HQs and points carry none)
    const held = items.filter((i) => ['14', '15', '16'].includes(slot(i.role)?.echelon ?? '') && i.pts.length >= 3);
    const nul = held.filter((i) => /^nul/.test(i.role));
    const plsAll = held.reduce((a, i) => a + plsOf({ echelon: slot(i.role)?.echelon, label: i.label }), 0);
    const plsNul = nul.reduce((a, i) => a + plsOf({ echelon: slot(i.role)?.echelon, label: i.label }), 0);
    const share = plsAll ? plsNul / plsAll : 0, want = num(doc, 'mountain.nullahShare', 1 / 3);
    const ok = plsAll > 0 && Math.abs(share - want) <= 1 / plsAll + 1e-9;
    rows.push({ name: 'Nullahs', st: ok ? 'pass' : 'warn', reason: `${plsNul} of ${plsAll} Pls (${Math.round(share * 100)} %) guard the nullahs, ${plsAll - plsNul} hold the ridge line: a ridge sandwiched in nullahs needs part of the force against infiltration through them, MW's suggested proportion 1/3 on the nullahs and 2/3 on the ridge (MW s2 para 11 p 154)${ok ? '' : `; within one Pl of ${Math.round(want * plsAll)}`}`,
      detail: ok ? undefined : { head: `${Math.round(share * 100)} % on the nullahs`, why: share < want ? 'The nullahs are the infiltration routes round the ridge (MW p 154): too few on them and the ridge is turned.' : 'Too many on the nullahs leaves the ridge line, where the En is faced, thin (MW p 154).', fix: [`About ${Math.round(want * plsAll)} Pls on the nullahs, the rest on the ridge`] } });
  }
  if (lay === 'penetrant') {
    // depth along the ridge; side spurs held; the valleys between the side spurs blocked (p 155 para 12 b)
    const ridge = items.filter((i) => ['fwd', 'depth', 'res'].includes(slot(i.role)?.kind ?? '') && !/^(spur|blk)/.test(i.role) && i.pts.length >= 3);
    const along = spread(ridge.map((i) => ahead(ctr(i)))), across = spread(ridge.map((i) => ctr(i).x));
    const ratio = num(doc, 'mountain.penetrantDepthRatio', 2);
    rows.push({ name: 'Depth along ridge', st: along >= ratio * across ? 'pass' : 'warn', reason: `the ridge Coys ${fmtM(along)} deep along it and ${fmtM(across)} across: a penetrant ridge is held in depth along the ridge line, the weapons oriented on an En attacking along it; knolls on it made Pl strong points (MW s2 para 12 b (1)-(2) p 155)` });
    const spurs = has(/^spur/), blks = has(/^blk/);
    const sides = new Set(spurs.map((i) => Math.sign(ctr(i).x)));
    rows.push({ name: 'Side spurs', st: sides.has(-1) && sides.has(1) ? 'pass' : 'warn', reason: `${spurs.length} side spur posn${spurs.length === 1 ? '' : 's'}${sides.has(-1) && sides.has(1) ? ', one each side' : ', not both sides'}: occupation of the side spurs is essential (MW p 155 para 12 b (3))` });
    rows.push({ name: 'Valleys blocked', st: blks.length >= 2 ? 'pass' : 'warn', reason: `${blks.length} block${blks.length === 1 ? '' : 's'} on the valleys between the side spurs (MW p 155 para 12 b (3): blocking the valleys between side spurs is essential)` });
  }
  if (lay === 'lateral') {
    // the top held all round with a bias to the front; forward spurs occupied (p 157 para 13)
    const top = fwd.map((i) => ahead(ctr(i)));
    const depthOf = (i: Item) => spread(i.pts.map(ahead));
    const res = byKind('res')[0];
    const coyD = Math.max(...fwd.map(depthOf));
    const resBack = res ? Math.min(...top) - ahead(ctr(res)) : null, kD = num(doc, 'mountain.lateralResCoyDepths', 2);
    rows.push({ name: 'Ridge top', st: spread(top) <= coyD + 1 && (resBack === null || resBack <= kD * coyD) ? 'pass' : 'warn', reason: `the forward Coys ${fmtM(spread(top))} apart front to back${resBack !== null ? `, the reserve ${fmtM(Math.max(0, resBack))} behind them` : ''}: the key to a lateral ridge is its top, held at all cost, all round with a bias to the front (MW s2 para 13 (1) p 157); the reserve kept on the top, not down the reverse slope (within ${kD} Coy depths, ${fmtM(kD * coyD)})` });
    const spurs = has(/^spur/).filter((i) => ahead(ctr(i)) > Math.max(...top));
    rows.push({ name: 'Forward spurs', st: spurs.length ? 'pass' : 'warn', reason: `${spurs.length} posn${spurs.length === 1 ? '' : 's'} on the forward spurs: occupying them gives strength and depth; the infiltration routes between the side spurs covered (MW p 157 para 13 (2))` });
  }
  if (lay === 'pass') {
    // the heights dominating the two shoulders (p 158 para 14)
    const sh = has(/^sh[LR]$/);
    const sides = new Set(sh.map((i) => Math.sign(ctr(i).x)));
    rows.push({ name: 'Both shoulders', st: sides.has(-1) && sides.has(1) ? 'pass' : 'warn', reason: `${sh.map((i) => i.label ?? i.role).join(' and ') || 'nothing'} on the shoulders: the defence of a pass lies on the heights dominating its two shoulders (MW s2 para 14 p 158)` });
    const blk = has(/^blk/);
    rows.push({ name: 'Pass blocked', st: blk.length ? 'pass' : 'warn', reason: `${blk.length ? `${blk[0].label ?? 'a block'} on the pass` : 'no block on the pass itself'}: passes are lucrative targets for infiltration, a heliborne force and raids (MW p 158 para 14 (1)-(3))` });
  }
  if (lay === 'valley') {
    // the side spurs both sides, successive posns; the valley bed and its mouth in a broad valley (pp 161-162 para 16)
    const sideItems = items.filter((i) => ['fwd', 'depth'].includes(slot(i.role)?.kind ?? '') && !/^bed/.test(i.role) && i.pts.length >= 3);
    const sides = new Set(sideItems.map((i) => Math.sign(ctr(i).x)));
    const lines = new Set(sideItems.map((i) => Math.round(ahead(ctr(i)) / 500)));
    rows.push({ name: 'Heights both sides', st: sides.has(-1) && sides.has(1) ? 'pass' : 'warn', reason: `posns on ${sides.has(-1) && sides.has(1) ? 'both sides' : 'one side only'} of the valley: a narrow valley is held on the side spurs and hill features both sides, which dominate it (MW s2 para 16 b p 162)` });
    rows.push({ name: 'Successive posns', st: lines.size >= 2 ? 'pass' : 'warn', reason: `${lines.size} line${lines.size === 1 ? '' : 's'} of posns along the valley: successive defensive posns on the hill features make an advance along it difficult (MW p 162 para 16 b)` });
    const bed = has(/^bed/);
    rows.push({ name: 'Valley bed', st: bed.length ? 'pass' : 'unchecked', reason: bed.length ? `${bed[0].label ?? 'a posn'} on the valley bed: in a broad valley the posns are also on the bed, strong at the mouth and where it narrows (MW p 162 para 16 c)` : 'none on the valley bed: needed only where the valley is broad (MW p 162 para 16 c)' });
  }
  // every mountain defence: strong points and tiers (p 152 paras 8-9)
  rows.push({ name: 'Strong points', st: 'unchecked', reason: 'each Coy posn with at least a Pl strong point on its most dominating feature, 30 days\' staying power, the rallying point and the pivot for counter-attack; posns held in tiers from the foothills or valleys to the ridge line, the final battle on the ridge; night posns in the valleys, day posns on the heights (MW s2 paras 8-9 p 152): confirm on the ground' });
  return rows;
}

function mtnAttackRows(items: Item[], doc: DoctrineSet): Check[] {
  const rows: Check[] = [];
  const at = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const obj = at('obj');
  if (!obj) return rows;
  const o = centre(obj.pts);
  const brg = (p: XY) => (Math.atan2(p.x - o.x, p.y - o.y) * 180) / Math.PI;
  // the directions onto the Obj: the assault (from its FUP), the fire base, the infiltration block; apart by 60 deg or more
  const dirs: { what: string; deg: number }[] = [];
  const fup = at('fup'), bof = at('bof'), infil = at('infil');
  if (fup) dirs.push({ what: 'the assault', deg: brg(centre(fup.pts)) });
  if (bof) dirs.push({ what: 'the fire base', deg: brg(centre(bof.pts)) });
  if (infil) dirs.push({ what: 'the infiltration block', deg: brg(centre(infil.pts)) });
  const apart = (a: number, b: number) => { const d = Math.abs(((a - b) % 360) + 360) % 360; return Math.min(d, 360 - d); };
  const distinct: typeof dirs = [];
  const sep = num(doc, 'mountain.dirsApartDeg', 60);
  for (const d of dirs) if (distinct.every((x) => apart(x.deg, d.deg) >= sep)) distinct.push(d);
  rows.push({ name: 'Multidirectional', st: distinct.length >= 3 ? 'pass' : distinct.length === 2 ? 'warn' : 'fail', reason: `${distinct.length} directions onto the Obj (${distinct.map((d) => d.what).join(', ')}; ${sep} deg or more apart): attacks in the mountains succeed by multiple threats on the position: isolation, infiltration into the rear or flanks, blocking posns, a fire base from an adjoining hill, frontal fixation only where the ground permits (MW s1 para 13 a pp 83-84)` });
  if (infil && fup) {
    const f = centre(fup.pts), i = centre(infil.pts);
    const beyond = (i.x - o.x) * (o.x - f.x) + (i.y - o.y) * (o.y - f.y) > 0;
    rows.push({ name: 'Infiltration', st: beyond ? 'pass' : 'warn', reason: `${infil.label ?? 'the infiltration block'} ${beyond ? 'beyond' : 'short of'} the Obj from the FUP: the infiltrating troops attack from the rear or flanks and block the routes of reinforcement and escape (MW p 84 para 13 a (1) (b), (d)); in a strong point attack, the fifth Pl infiltrates (p 109 para 10)` });
  }
  if (bof) rows.push({ name: 'Fire base', st: 'pass', reason: `${bof.label ?? 'the fire base'}: on an adjoining hill feature, long range direct fire weapons with minimum troops, overhead fire to the last moment, specific targets, one target per two weapons; not mixed with the FSG that goes with the assault (MW s1 para 28 pp 94-95; para 13 a (1) (g) p 84)` });
  const res = items.filter((i) => /^res/.test(i.role) && i.pts.length);
  rows.push({ name: 'Reserve per axis', st: res.length ? 'pass' : 'warn', reason: `${res.length ? res.map((i) => i.label ?? i.role).join(', ') : 'no reserve'} on this axis: a central reserve is of little value, shifting troops between axes is seldom possible; at Bn level attack in phases with liberal timings to make one (MW s1 para 9 p 82)` });
  rows.push({ name: 'Objective', st: 'unchecked', reason: 'the Obj a hill feature on a flank of the main axis or in the rear that dominates the defences: taken, it isolates them, cuts the routes of withdrawal and stops supplies and reinforcements (MW s1 para 3 p 78): read with the ground' });
  return rows;
}
