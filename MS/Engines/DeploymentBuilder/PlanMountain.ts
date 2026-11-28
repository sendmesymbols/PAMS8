/**
 * PlanMountain -- the mountain layouts of MW (Mountain Warfare, GSP-1973, 2003) on top of the ordinary defence and attack
 * solvers: rows the geometry settles for each layout, by the book and page.
 *
 * Defence (MW s12 pp 152-162): the layout in strong points, tiers from the foothills or valleys to the ridge line, the
 * final battle on the ridge (p 152 para 8); a Pl strong point with 30 days' staying power in each Coy posn (para 9); a
 * ridge sandwiched in nullahs, 1/3 of the troops on the nullahs, 2/3 on the ridge (p 154 para 11); a penetrant ridge
 * held in depth along it, knolls as Pl strong points, side spurs held and the valleys between them blocked (p 155 para
 * 12 b); a lateral ridge held on its top, all round with a bias to the front, forward spurs occupied (p 157 para 13); a
 * pass held on the heights dominating its two shoulders (p 158 para 14); a narrow valley held on the side spurs and hill
 * features both sides in successive posns, a broad one on the valley bed as well, strong at its mouth (pp 161-162 para 16).
 *
 * Attack (MW s7 pp 78-95; s8 p 109): the Obj a hill feature on a flank of the main axis or in the rear that dominates the
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
import { buaAttackRows, buaDefRows, fixingRows, mobileRows } from './PlanBua';

type Item = { role: string; label?: string; pts: XY[] };
const P = (x: number, y: number): XY => ({ x, y });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const centre = (pts: XY[]): XY => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const spread = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : 0);
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
/** A posn's name without its trailing bracket ("B Coy (Res Bn), the arch" stays; "Bn HQ (main)" -> "Bn HQ"). */
const nameOf = (i: { role: string; label?: string }) => (i.label ?? i.role).replace(/\s*\([^)]*\)\s*$/, '');

/** The mountain defence layouts and the attack (recipe layouts). */
export const MTN_DEF_LAYOUTS = ['ridge', 'penetrant', 'lateral', 'pass', 'valley', 'salient', 'valleys'] as const;
/** The mountain attacks: the multidirectional Bn attack (MW s7) and the reduction of a salient (MW s9). */
export const MTN_ATK_LAYOUTS = ['mtn', 'salient', 'salient-wedge'] as const;
export const isMountainRecipe = (r: Recipe) => (r.task === 'defence' && (MTN_DEF_LAYOUTS as readonly string[]).includes(r.layout)) || (r.task === 'attack' && (MTN_ATK_LAYOUTS as readonly string[]).includes(r.layout));

/**
 * Pls in a slot: a Pl 1, a Coy 3 less any Pls it has given away, a Bn 12. "less a Pl" and "less 12 Pl" (a numbered Pl)
 * are one; "less two Pls" and "less 2 Pls" are two.
 */
export function plsOf(slot: { echelon?: string; label?: string }): number {
  const less = /less (a|one|two|\d+) (Pls?)\b/i.exec(slot.label ?? '');
  const n = !less ? 0 : less[2].toLowerCase() === 'pl' ? 1 : /two/i.test(less[1]) ? 2 : /\d/.test(less[1]) ? Number(less[1]) : 1;
  return slot.echelon === '14' ? 1 : slot.echelon === '15' ? 3 - n : slot.echelon === '16' ? 12 - n : 0;
}

/** Elevation in metres at a plan-metre point; NaN when not known. */
export type ElevAt = (p: XY) => number;

/**
 * The rows for a mountain, BUA or fixing-force layout (none for any other recipe). With `elevAt` (the fit, Check my plan
 * with the ground) the strong points and the Obj are read on the elevation; without it those rows stay unchecked.
 */
export function layoutRows(items: Item[], recipe: Recipe, doc: DoctrineSet, elevAt?: ElevAt): Check[] {
  // the BUA attack and defence and the MIB fixing force (PlanBua) go through the same hook
  if (recipe.layout === 'bua') return recipe.task === 'attack' ? buaAttackRows(items, recipe, doc) : buaDefRows(items, recipe, doc);
  if (recipe.layout === 'fixing') return fixingRows(items, recipe, doc);
  if (recipe.layout === 'mobile') return mobileRows(items, recipe, doc);
  if (!isMountainRecipe(recipe)) return [];
  if (recipe.task === 'attack') return recipe.layout === 'salient' ? salientAttackRows(items, doc, elevAt) : recipe.layout === 'salient-wedge' ? wedgeAttackRows(items, doc, elevAt) : mtnAttackRows(items, doc, elevAt);
  return mtnDefRows(items, recipe, doc, elevAt);
}

// ── the most dominating feature, read on the elevation (MW s12 para 9 p 152; s7 para 3 p 78) ──────────────────────────

const inPoly = (p: XY, poly: XY[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) c = !c;
  }
  return c;
};

/** Where a posn's top lies from its centre, in the plan's own words (forward = toward the En). */
function partOf(top: XY, c: XY, en: number): string {
  const f = en * (top.y - c.y), r = en * (top.x - c.x), d = Math.hypot(f, r);
  if (d < 60) return 'at its centre';
  const fb = Math.abs(f) >= d * 0.38 ? (f > 0 ? 'forward' : 'rear') : '', lr = Math.abs(r) >= d * 0.38 ? (r > 0 ? 'right' : 'left') : '';
  return `${fmtM(d)} ${[fb, lr].filter(Boolean).join(' ')} of its centre`;
}

export interface FeatureRead {
  /** The highest point inside the outline and its height. */
  top: XY; topM: number;
  /** The lowest point read inside, for the relief. */
  lowM: number;
  /** Ground higher than the top by more than the tolerance within the overlook radius, outside every own posn: the highest such. */
  over: { at: XY; m: number; dM: number } | null;
  /** Share of the samples with a height. */
  known: number;
}

/**
 * The rear area of a defence on mountain ground (MW s21 pp 232-238): what of it the plan holds (the HQ, gun areas, C Pen
 * posns, bridges, admin installations, para 3 pp 232-233), what the En's infiltrators do there (para 4 p 233) and the
 * measures (p 237). A row to confirm: the plan carries no guard or patrol plan to judge. Null when the plan holds none.
 */
export function rearAreaRow(items: { role: string; label?: string; pts: XY[] }[]): Check | null {
  const has = (re: RegExp) => items.filter((i) => re.test(i.role) && i.pts.length);
  const parts: string[] = [];
  const n = (k: number, one: string, many: string) => (k ? `${k === 1 ? `the ${one}` : `${k} ${many}`}` : '');
  const hq = has(/^hq$/), guns = has(/^gunArea/), cpen = has(/^cpen/), br = has(/^bridge/), adm = has(/^(adm|baa|daa|ech|ads)/i);
  for (const p of [n(hq.length, hq[0]?.label ?? 'HQ', 'HQs'), n(guns.length, 'gun area', 'gun areas'), n(cpen.length, 'C Pen posn', 'C Pen posns'), n(br.length, 'bridge', 'bridges'), n(adm.length, 'admin area', 'admin areas')]) if (p) parts.push(p);
  if (!parts.length) return null;
  return {
    name: 'Rear area', st: 'unchecked',
    reason: `on the plan: ${parts.join(', ')}: in the mountains the En's infiltrating parties reach the rear area easily, and its logistic and command elements cluster on the few roads and choke points (MW s21 para 2 p 232); the rear area holds the formation's Tac HQ, the admin installations, the gun areas and wagon lines, the C Pen posns, the bridges, defiles, landing grounds, helicopter sites and transformers (para 3 pp 232-233); the En infiltrates behind the FDLs to raid the admin installations, destroy the guns and the important bridges, set off slides to block the roads, and seize the defiles or occupy the C Pen posns (para 4 a, c p 233): a guard or patrol plan for each, diversions built beforehand for the important bridges, convoys with AA weapons mounted (p 237): plan and confirm them`,
  };
}

/**
 * The top of an outline on the elevation (a grid inside it, about 400 samples) and whether higher ground outside it, and
 * outside every own posn in `own`, overlooks that top within `radiusM` (rings 100 m apart, 24 bearings).
 */
export function readFeature(poly: XY[], own: XY[][], elevAt: ElevAt, radiusM: number, tolM: number): FeatureRead | null {
  if (poly.length < 3) return null;
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const step = Math.max(30, Math.sqrt(((x1 - x0) * (y1 - y0)) / 400));
  let top: XY | null = null, topM = -Infinity, lowM = Infinity, n = 0, k = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
    const p = P(x, y);
    if (!inPoly(p, poly)) continue;
    n++;
    const e = elevAt(p);
    if (!Number.isFinite(e)) continue;
    k++;
    if (e > topM) { topM = e; top = p; }
    if (e < lowM) lowM = e;
  }
  if (!top || !n || k / n < 0.5) return null;
  let over: FeatureRead['over'] = null;
  for (let r = 100; r <= radiusM + 1e-6; r += 100) for (let b = 0; b < 24; b++) {
    const a = (b * Math.PI) / 12, p = P(top.x + r * Math.sin(a), top.y + r * Math.cos(a));
    if (inPoly(p, poly) || own.some((o) => o.length >= 3 && inPoly(p, o))) continue;
    const e = elevAt(p);
    if (Number.isFinite(e) && e > topM + tolM && (!over || e > over.m)) over = { at: p, m: e, dM: r };
  }
  return { top, topM, lowM, over, known: k / n };
}

function mtnDefRows(items: Item[], recipe: Recipe, doc: DoctrineSet, elevAt?: ElevAt): Check[] {
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
    rows.push({ name: 'Nullahs', st: ok ? 'pass' : 'warn', reason: `${plsNul} of ${plsAll} Pls (${Math.round(share * 100)} %) guard the nullahs, ${plsAll - plsNul} hold the ridge line: a ridge sandwiched in nullahs needs part of the force against infiltration through them, MW's suggested proportion 1/3 on the nullahs and 2/3 on the ridge (MW s12 para 11 p 154)${ok ? '' : `; within one Pl of ${Math.round(want * plsAll)}`}`,
      detail: ok ? undefined : { head: `${Math.round(share * 100)} % on the nullahs`, why: share < want ? 'The nullahs are the infiltration routes round the ridge (MW p 154): too few on them and the ridge is turned.' : 'Too many on the nullahs leaves the ridge line, where the En is faced, thin (MW p 154).', fix: [`About ${Math.round(want * plsAll)} Pls on the nullahs, the rest on the ridge`] } });
  }
  if (lay === 'penetrant') {
    // depth along the ridge; side spurs held; the valleys between the side spurs blocked (p 155 para 12 b)
    const ridge = items.filter((i) => ['fwd', 'depth', 'res'].includes(slot(i.role)?.kind ?? '') && !/^(spur|blk)/.test(i.role) && i.pts.length >= 3);
    const along = spread(ridge.map((i) => ahead(ctr(i)))), across = spread(ridge.map((i) => ctr(i).x));
    const ratio = num(doc, 'mountain.penetrantDepthRatio', 2);
    rows.push({ name: 'Depth along ridge', st: along >= ratio * across ? 'pass' : 'warn', reason: `the ridge Coys ${fmtM(along)} deep along it and ${fmtM(across)} across: a penetrant ridge is held in depth along the ridge line, the weapons oriented on an En attacking along it; knolls on it made Pl strong points (MW s12 para 12 b (1)-(2) p 155)` });
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
    rows.push({ name: 'Ridge top', st: spread(top) <= coyD + 1 && (resBack === null || resBack <= kD * coyD) ? 'pass' : 'warn', reason: `the forward Coys ${fmtM(spread(top))} apart front to back${resBack !== null ? `, the reserve ${fmtM(Math.max(0, resBack))} behind them` : ''}: the key to a lateral ridge is its top, held at all cost, all round with a bias to the front (MW s12 para 13 a (1) p 157); the reserve kept on the top, not down the reverse slope (within ${kD} Coy depths, ${fmtM(kD * coyD)})` });
    const spurs = has(/^spur/).filter((i) => ahead(ctr(i)) > Math.max(...top));
    rows.push({ name: 'Forward spurs', st: spurs.length ? 'pass' : 'warn', reason: `${spurs.length} posn${spurs.length === 1 ? '' : 's'} on the forward spurs: occupying them gives strength and depth; the infiltration routes between the side spurs covered (MW p 157 para 13 a (2))` });
  }
  if (lay === 'pass') {
    // the heights dominating the two shoulders (p 158 para 14)
    const sh = has(/^sh[LR]$/);
    const sides = new Set(sh.map((i) => Math.sign(ctr(i).x)));
    rows.push({ name: 'Both shoulders', st: sides.has(-1) && sides.has(1) ? 'pass' : 'warn', reason: `${sh.map((i) => i.label ?? i.role).join(' and ') || 'nothing'} on the shoulders: the defence of a pass lies on the heights dominating its two shoulders (MW s12 para 14 p 158)` });
    const blk = has(/^blk/);
    rows.push({ name: 'Pass blocked', st: blk.length ? 'pass' : 'warn', reason: `${blk.length ? `${blk[0].label ?? 'a block'} on the pass` : 'no block on the pass itself'}: passes are lucrative targets for infiltration, a heliborne force and raids (MW p 158 para 14 c (1)-(3))` });
  }
  if (lay === 'valley') {
    // the side spurs both sides, successive posns; the valley bed and its mouth in a broad valley (pp 161-162 para 16)
    const sideItems = items.filter((i) => ['fwd', 'depth'].includes(slot(i.role)?.kind ?? '') && !/^bed/.test(i.role) && i.pts.length >= 3);
    const sides = new Set(sideItems.map((i) => Math.sign(ctr(i).x)));
    const lines = new Set(sideItems.map((i) => Math.round(ahead(ctr(i)) / 500)));
    rows.push({ name: 'Heights both sides', st: sides.has(-1) && sides.has(1) ? 'pass' : 'warn', reason: `posns on ${sides.has(-1) && sides.has(1) ? 'both sides' : 'one side only'} of the valley: a narrow valley is held on the side spurs and hill features both sides, which dominate it (MW s12 para 16 b p 162)` });
    rows.push({ name: 'Successive posns', st: lines.size >= 2 ? 'pass' : 'warn', reason: `${lines.size} line${lines.size === 1 ? '' : 's'} of posns along the valley: successive defensive posns on the hill features make an advance along it difficult (MW p 162 para 16 b)` });
    const bed = has(/^bed/);
    rows.push({ name: 'Valley bed', st: bed.length ? 'pass' : 'unchecked', reason: bed.length ? `${bed[0].label ?? 'a posn'} on the valley bed: in a broad valley the posns are also on the bed, strong at the mouth and where it narrows (MW p 162 para 16 c)` : 'none on the valley bed: needed only where the valley is broad (MW p 162 para 16 c)' });
  }
  if (lay === 'salient') {
    // a salient (MW s14 pp 178-179): the central arch held lightly, strong dispositions on the shoulders, the depth
    // localities prepared and partly occupied, the reserves central on interior lines
    const sh = has(/^sh[LR]$/).filter((i) => i.pts.length >= 3), arch = has(/^arch/).filter((i) => i.pts.length >= 3);
    const pls = (i: Item) => plsOf({ echelon: slot(i.role)?.echelon, label: i.label });
    const archPls = arch.reduce((a, i) => a + pls(i), 0);
    const sides = new Set(sh.map((i) => Math.sign(ctr(i).x)));
    const strong = sh.length >= 2 && sides.has(-1) && sides.has(1) && sh.every((i) => pls(i) > archPls);
    rows.push({
      name: 'Shoulders', st: strong ? 'pass' : 'warn',
      reason: `${sh.map((i) => `${nameOf(i)} ${pls(i)} Pls`).join(', ') || 'no shoulder posn'} against ${archPls} Pl${archPls === 1 ? '' : 's'} on the arch: the outer periphery (the central arch) is usually held lightly with strong dispositions on the shoulders, its key features Pl / Coy strong points with the bias of the defence toward the shoulders (MW s14 para 1, para 1 a p 178)`,
      ...(strong ? {} : { detail: {
        head: sh.length < 2 || !(sides.has(-1) && sides.has(1)) ? 'Both shoulders are not held' : 'The arch is held as strongly as a shoulder',
        why: 'A force defending a salient is vulnerable to envelopment directed at its base (MW s14 para 2 a p 179): the shoulders carry the defence, the arch watches and delays.',
        fix: ['Shift troops from the arch to the shoulders', 'Hold the arch with Pl strong points and section posts for surveillance and early warning (para 1 e p 179)', 'A posn on each shoulder, one each side'],
      } }),
    });
    const shAhead = sh.length ? Math.max(...sh.map((i) => ahead(ctr(i)))) : null;
    const archAhead = arch.length && shAhead !== null ? ahead(ctr(arch[0])) - shAhead : null;
    rows.push({
      name: 'Arch', st: archAhead !== null && archAhead > 0 ? 'pass' : 'warn',
      reason: archAhead === null ? 'no arch posn: a salient is own ground projecting toward the En (MW s9 para 2 a p 124), its arch at the tip'
        : `${nameOf(arch[0])} ${fmtM(Math.abs(archAhead))} ${archAhead > 0 ? 'ahead of' : 'behind'} the shoulders: a salient is own ground projecting toward the En (MW s9 para 2 a p 124), held on the arch by Pl / Coy localities and section posts for surveillance and early warning (MW s14 para 1 e p 179), the gaps kept under surveillance (para 1 d p 178)`,
      ...(archAhead !== null && archAhead > 0 ? {} : { detail: { head: 'No projection toward the En', why: 'Without the arch ahead of the shoulders the ground is not a salient but a straight front.', fix: ['Lay the arch on the tip of the salient', 'For a straight front use Bde Def: two Bns up'] } }),
    });
    const res = byKind('res')[0];
    if (res && sh.length >= 2) {
      const xs = sh.map((i) => ctr(i).x), mid = (Math.min(...xs) + Math.max(...xs)) / 2, span = Math.max(...xs) - Math.min(...xs);
      const share = num(doc, 'mountain.salient.centralShare', 0.2);
      const off = Math.abs(ctr(res).x - mid);
      const behindArch = !arch.length || ahead(ctr(res)) < ahead(ctr(arch[0]));
      const ok = off <= share * span + 1e-6 && behindArch;
      rows.push({
        name: 'Reserve central', st: ok ? 'pass' : 'warn',
        reason: `${nameOf(res)} ${fmtM(off)} off the middle between the shoulders (within ${Math.round(share * 100)} % of their ${fmtM(span)} counts as central, M), ${behindArch ? 'behind' : 'ahead of'} the arch, ${sh.map((i) => `${fmtM(dist(ctr(res), ctr(i)))} to ${nameOf(i)}`).join(', ')}: the salient lets the defender locate his reserves centrally, effective in quick time to reinforce the important tactical ground or recapture it (MW s14 para 1 h p 179), on interior lines (para 1 f); where the tracks are poor they are split per sub-sector (para 2 d)`,
        ...(ok ? {} : { detail: { head: 'The reserve is not central', why: 'Off the middle, the reserve reaches one shoulder late and loses the salient\'s interior lines (MW s14 para 1 f, h p 179).', fix: ['Put the reserve behind the arch, between the shoulders', 'Or split it, a part behind each shoulder, where the tracks between them are poor (para 2 d)'] } }),
      });
    }
    // the depth localities: depth posns, or prepared for occupation at short notice (cpen, drawn planned)
    const deps = [...byKind('depth'), ...byKind('cpen')];
    const planned = deps.filter((i) => slot(i.role)?.planned);
    rows.push({ name: 'Depth', st: deps.length ? 'pass' : 'warn', reason: `${deps.length} depth localit${deps.length === 1 ? 'y' : 'ies'}${planned.length ? `, ${planned.length} prepared for occupation (dashed)` : ''}: important localities in depth are prepared for occupation by the reserves at short notice or by the forward troops after a reverse, at times partly occupied from the outset (MW s14 para 1 b p 178)` });
    rows.push({ name: 'Salient', st: 'unchecked', reason: "the arch takes more troops than a linear border, the salient is fired on from three sides, and the En's envelopment is aimed at its base: bypassed, the forward localities are isolated or fight on a reverse front (MW s14 para 2 a-c p 179); a Bn guards one major approach in an important sub-sector, wider frontages with wide gaps elsewhere (para 1 g): confirm against the approaches" });
  }
  if (lay === 'valleys') {
    // a mountain Div: the reserves split to guard the valleys, each placed to launch at once (GSP s27 para 4 p 122; s39
    // para 11 p 176); upwards of Bn level not from one central location (MW s12 p 169)
    const res = byKind('res'), nameOf = (i: Item) => (i.label ?? i.role).replace(/\s*\(.*\)\s*$/, '');
    const covered = fwd.filter((f) => res.some((r) => Math.sign(ctr(r).x) === Math.sign(ctr(f).x) && ahead(ctr(r)) < ahead(ctr(f))));
    const split = res.length >= 2 && covered.length === fwd.length;
    rows.push({
      name: 'Reserves split', st: split ? 'pass' : 'warn',
      reason: `${res.length} reserve group${res.length === 1 ? '' : 's'} (${res.map(nameOf).join(', ') || 'none'}), ${covered.length} of ${fwd.length} forward Bdes with one behind it: in mountains the divisional reserves may have to be split to guard the approaches along different valleys or terrain compartments (GSP 1947 Inf Div in Battle s27 para 4 p 122); upwards of Bn level the reserves cannot act from one central location (MW s12 p 169)`,
      ...(split ? {} : { detail: { head: 'The Div reserve is in one place', why: 'Between valleys the reserve cannot cross the compartments in time: an immediate counter-attack has the greater chance, so the reserves are split and positioned to be launched at once (GSP s39 para 11 p 176; MW p 169).', fix: ['A reserve group behind each forward Bde, on its valley', 'Keep the tracks between them open so the groups can still concentrate quickly (GSP p 176)'] } }),
    });
    const reach = num(doc, 'mountain.divValleys.groupBehindM', 6000);
    const far = res.filter((r) => { const f = fwd.filter((x) => Math.sign(ctr(x).x) === Math.sign(ctr(r).x)).sort((a, b) => dist(ctr(a), ctr(r)) - dist(ctr(b), ctr(r)))[0]; return !f || dist(ctr(f), ctr(r)) > reach; });
    rows.push({ name: 'Launch at once', st: far.length ? 'warn' : 'pass', reason: `${res.map((r) => { const f = fwd.filter((x) => Math.sign(ctr(x).x) === Math.sign(ctr(r).x)).sort((a, b) => dist(ctr(a), ctr(r)) - dist(ctr(b), ctr(r)))[0]; return f ? `${nameOf(r)} ${fmtM(dist(ctr(f), ctr(r)))} from ${nameOf(f)}` : `${nameOf(r)}: no Bde on its side`; }).join(', ')} (within ${fmtM(reach)}, E): the reserves are so positioned that they can be launched immediately as well as concentrated quickly (GSP s39 para 11 p 176); on foot in the mountains (armour confined to roads and tracks, MW p 238)` });
    rows.push({ name: 'Security zone', st: 'unchecked', reason: 'none laid: along the LoC in Kashmir and the Northern Areas no Security Zone exists, and the En softens up selected posts first (MW s12 p 164); where one can be had, the Div Def two up lays it' });
  }
  // every mountain defence: strong points and tiers (p 152 paras 8-9)
  const spRule = 'each Coy posn with at least a Pl strong point on its most dominating feature, difficult to reduce, 30 days\' staying power, the rallying point and the pivot for counter-attack by the reserves; one third of its force always in it (MW s12 para 9 p 152; s13 p 176); posns held in tiers from the foothills or valleys to the ridge line, the final battle on the ridge; night posns in the valleys, day posns on the heights (para 8 p 152)';
  const coys = items.filter((i) => slot(i.role)?.echelon === '15' && i.pts.length >= 3);
  if (!elevAt || !coys.length) {
    rows.push({ name: 'Strong points', st: 'unchecked', reason: `${spRule}: confirm on the ground` });
    return rows;
  }
  const radius = num(doc, 'mountain.strongPoint.overlookM', 600), tol = num(doc, 'mountain.strongPoint.overlookTolM', 10);
  const posns = items.filter((i) => ['14', '15', '16'].includes(slot(i.role)?.echelon ?? '') && i.pts.length >= 3).map((i) => i.pts);
  const reads = coys.map((i) => ({ i, r: readFeature(i.pts, posns.filter((p) => p !== i.pts), elevAt, radius, tol) }));
  const name = (i: Item) => (i.label ?? i.role).replace(/\s*\(.*\)\s*$/, '');
  const unread = reads.filter((x) => !x.r);
  const over = reads.filter((x) => x.r?.over);
  const parts = reads.map(({ i, r }) => !r ? `${name(i)} not read`
    : r.over ? `${name(i)}: its top ${Math.round(r.topM)} m (${partOf(r.top, centre(i.pts), en)}) overlooked by ${Math.round(r.over.m)} m ${fmtM(r.over.dM)} ${en * (r.over.at.y - r.top.y) > 0 ? 'toward the En' : 'away from the En'}`
    : r.topM - r.lowM < tol ? `${name(i)}: level ground about ${Math.round(r.topM)} m, no top to choose (the Pl SP where it is hardest to reduce), nothing higher within ${fmtM(radius)}`
    : `${name(i)}: Pl SP on its top ${Math.round(r.topM)} m (${partOf(r.top, centre(i.pts), en)}), ${Math.round(r.topM - r.lowM)} m above its lowest part, nothing higher within ${fmtM(radius)}`);
  const st = over.length ? 'warn' : unread.length ? 'unchecked' : 'pass';
  rows.push({
    name: 'Strong points', st,
    reason: `${parts.join('; ')} (read from the 30 m elevation: higher ground ${tol} m or more above the top, outside the own posns, within ${fmtM(radius)}, E): ${spRule}`,
    ...(over.length ? { detail: {
      head: `${over.map((x) => name(x.i)).join(', ')}: the SP is not on the most dominating feature`,
      why: 'The strong point "should be selected at most dominating feature difficult to reduce" (MW s12 para 9 p 152): ground above it within small-arms reach lets the En look and fire down into it, and the other tiers cannot gain strength from it.',
      fix: ['Move or stretch the Coy posn onto the higher ground, or put its Pl SP there', 'Hold the higher ground with another posn (an own posn there is not counted as overlooking)', 'If it cannot be held, deny it by fire, mines and wire, and accept the SP below it'],
    } } : {}),
  });
  return rows;
}

function mtnAttackRows(items: Item[], doc: DoctrineSet, elevAt?: ElevAt): Check[] {
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
  rows.push({ name: 'Multidirectional', st: distinct.length >= 3 ? 'pass' : distinct.length === 2 ? 'warn' : 'fail', reason: `${distinct.length} directions onto the Obj (${distinct.map((d) => d.what).join(', ')}; ${sep} deg or more apart): attacks in the mountains succeed by multiple threats on the position: isolation, infiltration into the rear or flanks, blocking posns, a fire base from an adjoining hill, frontal fixation only where the ground permits (MW s7 para 13 a pp 83-84)` });
  if (infil && fup) {
    const f = centre(fup.pts), i = centre(infil.pts);
    const beyond = (i.x - o.x) * (o.x - f.x) + (i.y - o.y) * (o.y - f.y) > 0;
    rows.push({ name: 'Infiltration', st: beyond ? 'pass' : 'warn', reason: `${infil.label ?? 'the infiltration block'} ${beyond ? 'beyond' : 'short of'} the Obj from the FUP: the infiltrating troops attack from the rear or flanks and block the routes of reinforcement and escape (MW p 84 para 13 a (1) (b), (d)); in a strong point attack, the fifth Pl infiltrates (p 109 para 10)` });
  }
  if (bof) rows.push({ name: 'Fire base', st: 'pass', reason: `${bof.label ?? 'the fire base'}: on an adjoining hill feature, long range direct fire weapons with minimum troops, overhead fire to the last moment, specific targets, one target per two weapons; not mixed with the FSG that goes with the assault (MW s7 paras 28-29 pp 93-94; para 13 a (1) (g) p 84)` });
  const res = items.filter((i) => /^res/.test(i.role) && i.pts.length);
  rows.push({ name: 'Reserve per axis', st: res.length ? 'pass' : 'warn', reason: `${res.length ? res.map((i) => i.label ?? i.role).join(', ') : 'no reserve'} on this axis: a central reserve is of little value, shifting troops between axes is seldom possible; at Bn level attack in phases with liberal timings to make one (MW s7 para 9 p 82)` });
  rows.push(objectiveRow(obj, doc, elevAt));
  return rows;
}

/** The Obj read on the elevation: a hill feature that dominates the defences (MW s7 para 3 p 78; s9 para 7 p 129). */
function objectiveRow(obj: Item, doc: DoctrineSet, elevAt?: ElevAt): Check {
  const objRule = 'the Obj a hill feature on a flank of the main axis or in the rear that dominates the defences: taken, it isolates them, cuts the routes of withdrawal and stops supplies and reinforcements (MW s7 para 3 p 78)';
  const radius = num(doc, 'mountain.strongPoint.overlookM', 600), tol = num(doc, 'mountain.strongPoint.overlookTolM', 10);
  const r = elevAt && obj.pts.length >= 3 ? readFeature(obj.pts, [], elevAt, radius, tol) : null;
  if (!r) return { name: 'Objective', st: 'unchecked', reason: `${objRule}: read with the ground` };
  if (r.over) return {
    name: 'Objective', st: 'warn',
    reason: `the Obj's top ${Math.round(r.topM)} m is overlooked by ${Math.round(r.over.m)} m ${fmtM(r.over.dM)} from it (read from the 30 m elevation, E: ${tol} m higher within ${fmtM(radius)}): ${objRule}`,
    detail: { head: 'Higher ground overlooks the Obj', why: 'Taken, an Obj under higher ground is not the feature that dominates the defences (MW p 78); the En on the height above fires down into the reorganisation.', fix: ['Make the higher ground the Obj, or a later phase onto it', 'Take or neutralise it first (a fire base on it, MW p 84)', 'Mask it with smoke and fire during the reorganisation'] },
  };
  return { name: 'Objective', st: 'pass', reason: `the Obj's top ${Math.round(r.topM)} m, ${Math.round(r.topM - r.lowM)} m above its lowest part, nothing higher within ${fmtM(radius)} (read from the 30 m elevation): ${objRule}` };
}

/**
 * The reduction of the En's salient (MW s9 pp 127-133; Figure 4 p 131): the En fixed from the front while his base is
 * attacked by envelopment from the flanks combined with infiltration (para 5 a p 128), at more than one assembly (para 8
 * p 130). The tip of his salient is where the fixing arrow (role `fix`) points; the main Obj is judged from it.
 */
function salientAttackRows(items: Item[], doc: DoctrineSet, elevAt?: ElevAt): Check[] {
  const rows: Check[] = [];
  const at = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const obj = at('obj'), fix = at('fix'), axis = at('axis'), infil = at('infil');
  if (!obj) return rows;
  const O = centre(obj.pts);
  const archR = num(doc, 'mountain.salient.archRadiusM', 1500), flankDeg = num(doc, 'mountain.salient.flankMinDeg', 45);
  const fixer = items.find((i) => /^bnFix|^fixBy/.test(i.role) && i.pts.length);
  if (fix && fix.pts.length >= 2) {
    const T0 = fix.pts[0], T = fix.pts[fix.pts.length - 1];
    const L = dist(T0, T) || 1, u = P((T.x - T0.x) / L, (T.y - T0.y) / L);
    const along = (p: XY) => (p.x - T.x) * u.x + (p.y - T.y) * u.y;
    const lateral = (p: XY) => Math.abs((p.x - T.x) * u.y - (p.y - T.y) * u.x);
    const dArch = dist(O, T);
    const onArch = dArch < archR;
    let axDeg: number | null = null;
    if (axis && axis.pts.length >= 2) {
      const a = axis.pts[0], b = axis.pts[axis.pts.length - 1], d = dist(a, b) || 1;
      const c = ((b.x - a.x) * u.x + (b.y - a.y) * u.y) / d;
      axDeg = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
    }
    const flankOk = axDeg === null || axDeg >= flankDeg;
    const ok = !onArch && flankOk;
    rows.push({
      name: 'Base or shoulder', st: ok ? 'pass' : 'warn',
      reason: `${obj.label ?? 'the Obj'}: ${fmtM(dArch)} from the tip of his salient, ${fmtM(Math.max(0, along(O)))} toward its base and ${fmtM(lateral(O))} off its line${axDeg !== null ? `, the main axis ${Math.round(axDeg)}° off the fixing direction` : ''} (on the arch within ${fmtM(archR)}; from a flank at ${flankDeg}° or more: M): fix the En from the front while his base is attacked by envelopment combined with infiltration; if the shoulders cannot be assailed, penetrate a shoulder supported by infiltration (MW s9 para 5 a, b p 128; Fig 4 p 131); frontal attacks astride the obvious approaches are very costly (para 4 a p 127)`,
      ...(ok ? {} : { detail: {
        head: onArch ? 'The main attack goes onto the arch' : 'The main attack comes in frontally',
        why: 'The approaches to a salient are limited, obvious and strongly held, so frontal attacks astride them are very costly; the tactically important features are taken from the flanks or rear, and success hinges on pulling his reserves forward ahead of its base (MW s9 para 4 a, b p 127).',
        fix: ['Put the main Obj on a shoulder or the base, approached from a flank', 'Fix the arch from the front with fire and a small force', 'Infiltrate to the base to block his reinforcement and withdrawal'],
      } }),
    });
    rows.push({ name: 'Front fixed', st: 'pass', reason: `${fixer?.label ?? 'a force'} fixes the arch from the front (MW s9 para 5 a p 128; Fig 4 p 131); his reserves committed in the wrong direction or fixed from the outset (para 5 d p 129)` });
    if (infil) {
      const I = centre(infil.pts), deep = along(I) >= archR;
      rows.push({ name: 'Infiltration to the base', st: deep ? 'pass' : 'warn', reason: `${infil.label ?? 'the infiltration force'}: ${fmtM(Math.max(0, along(I)))} beyond the tip toward the base (${fmtM(archR)} or more, M): infiltration can lead to early seizure of the vital objective in the rear (MW s9 para 10 p 132), from relatively less important and lightly held sectors, overnight (para 4 p 128)` });
    } else rows.push({ name: 'Infiltration to the base', st: 'warn', reason: 'no infiltration force: the base is attacked by envelopment combined with infiltration (MW s9 para 5 a p 128; para 10 p 132)' });
  } else rows.push({ name: 'Front fixed', st: 'warn', reason: 'no fixing force facing the arch: a salient is reduced by fixing the En from the front while his base is attacked by envelopment combined with infiltration (MW s9 para 5 a p 128)' });
  rows.push(...salientCommonRows(items, obj, doc, elevAt));
  return rows;
}

/**
 * The second form of manoeuvre against the En's salient (MW s9 para 9 p 130; Figure 5 p 131): the salient divided through
 * a wedge for subsequent reduction. The main attack comes in from a flank and the secondary up through the tip, their
 * Objs meeting in its middle; a fixing force holds the other flank; infiltration to the base blocks his reinforcement.
 */
function wedgeAttackRows(items: Item[], doc: DoctrineSet, elevAt?: ElevAt): Check[] {
  const rows: Check[] = [];
  const at = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const obj = at('obj'), objS = at('objS'), axis = at('axis'), axisS = at('axisS'), fix = at('fix'), infil = at('infil');
  if (!obj) return rows;
  const O = centre(obj.pts);
  const link = num(doc, 'mountain.salient.wedgeLinkM', 1500), flankDeg = num(doc, 'mountain.salient.flankMinDeg', 45);
  const dirOf = (a: Item) => { const p = a.pts[0], q = a.pts[a.pts.length - 1], d = dist(p, q) || 1; return P((q.x - p.x) / d, (q.y - p.y) / d); };
  const rule = 'the salient may be divided through a wedge for subsequent reduction (MW s9 para 9 p 130; Figure 5 p 131): the main attack in from a flank, the secondary up through the tip to meet it, a fixing force on the other flank';
  if (objS && axis && axisS) {
    const S = centre(objS.pts), gap = dist(O, S);
    const u = dirOf(axis), v = dirOf(axisS), deg = (Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) * 180) / Math.PI;
    const ok = gap <= link && deg >= flankDeg;
    rows.push({
      name: 'Wedge', st: ok ? 'pass' : 'warn',
      reason: `${obj.label ?? 'OBJ A'} and ${objS.label ?? 'OBJ B'} ${fmtM(gap)} apart (meet within ${fmtM(link)}, M), the main axis ${Math.round(deg)}° off the secondary (from a flank at ${flankDeg}° or more, M): ${rule}`,
      ...(ok ? {} : { detail: { head: gap > link ? 'The two attacks do not meet' : 'The main attack does not come from a flank', why: 'A wedge divides the salient only where the main and secondary attacks join in its middle; apart, each is a frontal attack on a strongly held approach (MW s9 para 4 a p 127, para 9 p 130).', fix: ['Lay OBJ A and OBJ B side by side in the middle of the salient', 'Bring the main attack in from a flank, the secondary up through the tip', 'Or attack the base from both flanks (Figure 4: Salient)'] } }),
    });
  } else rows.push({ name: 'Wedge', st: 'warn', reason: `no secondary attack through the tip: ${rule}` });
  const mainSide = axis ? Math.sign(centre(axis.pts).x - O.x) || -1 : -1;
  const fixSide = fix ? Math.sign(centre(fix.pts).x - O.x) : 0;
  rows.push(fix && fixSide && fixSide !== mainSide
    ? { name: 'Flank fixed', st: 'pass', reason: `${items.find((i) => /^bnFix/.test(i.role))?.label ?? 'a force'} fixes the flank opposite the main attack (MW s9 Figure 5 p 131); his reserves committed in the wrong direction or fixed from the outset (para 5 d p 129)` }
    : { name: 'Flank fixed', st: 'warn', reason: `${fix ? 'the fixing force is on the same flank as the main attack' : 'no fixing force'}: in the wedge the other flank is fixed while the main and secondary attacks divide the salient (MW s9 Figure 5 p 131)` });
  if (infil) {
    const I = centre(infil.pts), deep = I.y > Math.max(O.y, objS ? centre(objS.pts).y : O.y);
    rows.push({ name: 'Infiltration to the base', st: deep ? 'pass' : 'warn', reason: `${infil.label ?? 'the infiltration force'} ${deep ? 'beyond' : 'short of'} the wedge toward the base: infiltration can lead to early seizure of the vital objective in the rear (MW s9 para 10 p 132), blocking his reinforcement of the divided parts` });
  } else rows.push({ name: 'Infiltration to the base', st: 'warn', reason: 'no infiltration force to the base (MW s9 para 10 p 132)' });
  rows.push({ name: 'Reduce in parts', st: 'unchecked', reason: 'once divided, each part of the salient is reduced in turn (MW s9 para 9 p 130); command on exterior lines from several directions is difficult and the wireless screened by the ground: detailed coordination at command and staff levels (para 11 p 132): plan the reduction of each part' });
  rows.push(...salientCommonRows(items, obj, doc, elevAt));
  return rows;
}

/** The rows both reductions of a salient share: assembly, a reserve per axis, deception, the arty and DAA split, the Obj. */
function salientCommonRows(items: Item[], obj: Item, doc: DoctrineSet, elevAt?: ElevAt): Check[] {
  const rows: Check[] = [];
  const assy = items.filter((i) => /^assy/.test(i.role) && i.pts.length);
  rows.push({ name: 'Assembly', st: assy.length >= 2 ? 'pass' : 'warn', reason: `${assy.length} Assy Area${assy.length === 1 ? '' : 's'}: the deployment areas are few and strung out along the roads and tracks, so a sizeable force assembles at more than one location, which needs detailed coordination and helps surprise (MW s9 para 8 a, b, d p 130)` });
  const res = items.filter((i) => /^res/.test(i.role) && i.pts.length);
  rows.push({ name: 'Reserve per axis', st: res.length ? 'pass' : 'warn', reason: `${res.length ? res.map((i) => i.label ?? i.role).join(', ') : 'no Bde reserve'}, each assaulting Bn keeping its own: a central reserve is of little value, shifting troops between axes is seldom possible (MW s7 para 9 p 82)` });
  rows.push({ name: 'Deception', st: 'unchecked', reason: 'deploy first on several axes able to concentrate on the chosen one, a fake logistic / artillery build-up, attacks at several points, a fake signal net, patrols and recce on a broad front, the opening artillery weight away from the points of attack (MW s9 para 12 a-g pp 132-133): plan them' });
  rows.push({ name: 'Arty and DAA', st: 'unchecked', reason: "the main, secondary and fixing attacks lie wide apart on exterior lines: split the artillery across the prongs without dissipating it (MW s9 para 13 p 133); one DAA cannot support Bdes attacking from different directions: split it in two, give resources to the BAAs or use the holding formation's (para 14 p 133)" });
  rows.push(objectiveRow(obj, doc, elevAt));
  return rows;
}
