/**
 * PlanDivAttack.ts — PURE. The Div attack's own rows (recipes `div-attk-*`), from GSP 1947 Infantry Division in Battle s19
 * pp 84-91; the main attack's FUP, SL, axis and Assy Area are judged by the solver's attack rows like any attack.
 *
 * - Div formation: two Bdes up on a relatively broad front, the third the Div reserve (para 11 a p 85), or one Bde up, the
 *   more applicable in mountains (para 11 b pp 85-86). `m` carries the Bdes up, so PlanContext.groundNotes judges it on the
 *   ground (mountains: one up; desert: the Inf Div is least suited to offensive operations there, pp 85, 171).
 * - Clear axes: each Bde needs a clear axis of advance, and the gap between the assaulting Bdes gives the Div's attack
 *   frontage (para 12 d p 86). One up: the follow-up Bde goes through or round the leading Bde (para 11 b p 86).
 * - Main attack: delivered in strength on a narrow front, the troops in depth keeping the momentum (para 14 p 90); the
 *   secondary attack keeps the pressure on and draws the En reserves (para 7 p 84). The Div reserve stands behind the main
 *   attack, not the secondary.
 * - Div reserve: earmarked with its fire support to deal with the unexpected and keep the momentum, a fresh one made once
 *   it is committed (para 13 b (5) p 88). No time is printed for it: its distance and times are given, not judged.
 *
 * Pure: plan metres, y toward the enemy (the solver's frame).
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, PlanItem, XY } from './PlanSolve';
import { fupFromObjCheck } from './PlanContext';

const G = 'GSP 1947 Inf Div in Battle';
const P = (x: number, y: number): XY => ({ x, y });
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const centre = (pts: XY[]) => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const ext = (pts: XY[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
/** An axis arrow's width: its base line across the tail (MainAttack BASE_LN_PTS), else 0. */
const widthOf = (it: PlanItem) => (it.base ? dist(it.base.start, it.base.end) : 0);
/** The corridor an axis arrow sweeps across: its centre line's x extent widened by half its width. */
const corridor = (it: PlanItem) => { const e = ext(it.pts), w = widthOf(it) / 2; return { x0: e.x0 - w, x1: e.x1 + w }; };

export interface DivAttackRows { rows: Check[]; confirm: string[] }

/** The Div attack's rows; empty for any plan that is not a Div attack. */
export function divAttackRows(items: PlanItem[], recipe: Recipe, doc: DoctrineSet): DivAttackRows {
  if (recipe.task !== 'attack' || recipe.echelon !== '21') return { rows: [], confirm: [] };
  const at = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const rows: Check[] = [];
  const confirm: string[] = [];
  const axis = at('axis'), axisS = at('axisS'), axisF = at('axisF'), obj = at('obj'), objS = at('objS'), objF = at('objF'), res = at('divRes');
  const twoUp = !!axisS;
  const lab = (it: PlanItem | undefined, fb: string) => it?.label || fb;

  // the formation (para 11 pp 85-86); m = Bdes up, judged on the ground by groundNotes
  rows.push(twoUp
    ? { name: 'Div formation', st: 'pass', m: 2, reason: `two Bdes up: the Div attacks on a relatively broad front without great depth, the uncommitted Bde as the Div reserve giving flexibility, security and adequate depth (${G} s19 para 11 a p 85)` }
    : { name: 'Div formation', st: 'pass', m: 1, reason: `one Bde up: the most depth, keeps the initiative, flexible, secure and the easiest to control; the follow-up Bdes go through or round the leading Bde to keep the momentum or meet a threat to either flank; slower to deploy, and the penetration is more easily blocked (${G} s19 para 11 b pp 85-86)` });

  // each Bde its own clear axis; the Div's attack frontage = the Bdes' and the gap between them (para 12 d p 86)
  if (twoUp && axis && axisS) {
    const a = corridor(axis), b = corridor(axisS);
    const gap = a.x1 <= b.x0 ? b.x0 - a.x1 : b.x1 <= a.x0 ? a.x0 - b.x1 : -Math.min(a.x1 - b.x0, b.x1 - a.x0);
    const front = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0);
    rows.push(gap >= 0
      ? { name: 'Clear axes', st: 'pass', m: front, reason: `each Bde on its own axis, ${fmtM(gap)} clear between them (${fmtM(widthOf(axis))} and ${fmtM(widthOf(axisS))} wide); the Div attack frontage ${fmtM(front)}: the two Bdes' frontages and the gap between them (${G} s19 para 12 d p 86)` }
      : { name: 'Clear axes', st: 'warn', m: front, reason: `the two Bde axes overlap by ${fmtM(-gap)}: each Bde needs a clear axis of advance (${G} s19 para 12 d p 86)`, detail: { head: `Bde axes overlap ${fmtM(-gap)}`, why: 'Two Bdes on one corridor crowd each other, mask each other\'s fire and cannot be controlled apart.', fix: ['Move the secondary attack onto its own approach, a Bde frontage clear of the main one', 'Or attack one Bde up, the second following through or round the first (para 11 b)'] } });
    confirm.push('The inter-Bde boundary on the ground: each Bde\'s axis clear of the other\'s fire and movement');
  } else if (axis && axisF && obj) {
    const oe = ext(obj.pts);
    const through = axisF.pts.some((p) => p.x >= oe.x0 && p.x <= oe.x1 && p.y >= oe.y0 && p.y <= oe.y1);
    rows.push(through
      ? { name: 'Clear axes', st: 'warn', reason: `the follow-up Bde's axis runs through ${lab(obj, 'OBJ A')}, where the leading Bde reorganises: it goes through or round the leading Bde (${G} s19 para 11 b p 86), not across its objective`, detail: { head: 'Follow-up axis through the leading Bde\'s Obj', fix: ['Route the follow-up Bde round a flank of the leading Bde\'s Obj'] } }
      : { name: 'Clear axes', st: 'pass', reason: `the follow-up Bde goes round ${lab(obj, 'OBJ A')} onto ${lab(objF, 'the depth objective')}, keeping the momentum without passing through the leading Bde's reorganisation (${G} s19 para 11 b p 86; para 16 p 90)` });
  }

  // the main attack in strength, the depth behind it (para 14 p 90; para 7 p 84)
  if (res && axis) {
    const rc = res.pts[0], m = centre(axis.pts);
    if (twoUp && axisS) {
      const s = centre(axisS.pts);
      const behindMain = Math.abs(rc.x - m.x) < Math.abs(rc.x - s.x);
      rows.push(behindMain
        ? { name: 'Main attack', st: 'pass', reason: `${lab(at('bde'), 'the main attack Bde')} onto ${lab(obj, 'the main Obj')} with ${lab(res, 'the Div reserve')} behind it: the main attack in strength on a narrow front to rupture the defence, the troops in depth keeping the momentum (${G} s19 para 14 p 90); ${lab(at('bdeS'), 'the secondary attack')} onto ${lab(objS, 'its Obj')} keeps the pressure on, makes the En fight on two fronts and draws the En reserves early in the wrong direction (para 7 p 84)` }
        : { name: 'Main attack', st: 'warn', reason: `${lab(res, 'the Div reserve')} stands behind the secondary attack: the depth belongs behind the main attack to keep its momentum (${G} s19 para 14 p 90)`, detail: { head: 'Reserve behind the secondary attack', fix: ['Move the Div reserve behind the main attack', 'Or make the attack it stands behind the main one'] } });
    } else rows.push({ name: 'Main attack', st: 'pass', reason: `one Bde up: the whole Div's weight on one axis, ${lab(at('bdeF'), 'the follow-up Bde')} and ${lab(res, 'the Div reserve')} in depth behind it (${G} s19 para 11 b pp 85-86; para 14 p 90)` });
  }

  // thinking two down: the tasks assessed in Bns, then turned into Bde tasks (para 13 b (3)-(4), (6) p 88); a Bde drawn
  // without its Bns counts its three (an Inf Bde is a HQ and three Inf Bns, s12 para 2 p 60; the Div three Bdes, Annex A p 198)
  {
    const bns = items.filter((i) => i.echelon === '16' && /^(aslt[LR]|bn(L|R|Res)[A-Z]?)$/.test(i.role) && i.pts.length);
    const whole = items.filter((i) => (i.role === 'divRes' || i.role === 'bdeF') && i.pts.length);
    const total = bns.length + whole.length * 3, held = num(doc, 'divAttack.bnsInDiv', 9);
    const up = bns.filter((i) => !/Res/.test(i.role)).length, bdeRes = bns.length - up;
    rows.push({ name: 'Tasks in Bns', st: total <= held ? 'pass' : 'warn', m: total, limitM: held, limitSrc: 'GSP 1947 Annex A p 198', reason: `thinking two down: ${up} Bns in the assault, ${bdeRes} in the Bdes' reserves${whole.length ? `, ${whole.map((i) => lab(i, i.role)).join(' and ')} (${whole.length * 3} Bns)` : ''}: ${total} of the Div's ${held} (three Bdes of three Bns, ${G} Annex A p 198; s12 para 2 p 60); the tasks assessed in Bns, then turned into Bde tasks (s19 para 13 b (3)-(4) p 88)${total > held ? '; more than the Div holds: extra Bdes or units from Corps or Army (s11 para 2 p 59)' : ''}` });
  }

  // the preliminary operation on the En outposts (para 13 d p 89)
  const objPs = items.filter((i) => /^objP/.test(i.role) && i.pts.length);
  if (objPs.length) {
    const sl = at('sl'), assy = at('assy');
    const slY = sl ? Math.max(...sl.pts.map((p) => p.y)) : 0, assyY = assy ? Math.max(...assy.pts.map((p) => p.y)) : -Infinity;
    const ok = objPs.every((o) => { const c = centre(o.pts); return c.y < slY && c.y > assyY; });
    rows.push({ name: 'Prelim op', st: ok ? 'pass' : 'warn', reason: `${objPs.map((o) => lab(o, 'OBJ P')).join(', ')}: the En outposts out of contact with the En main posn, on the ground of the FUPs and SLs, cleared first so that the En main posn is observed, the guns deploy well forward and a good SL is secured (${G} s19 para 13 d p 89); by each leading Bde's Res Bn, done before the assault Bns leave the Assy Areas for the FUPs (see the H-hour sum)${ok ? '' : '; an OBJ P lies beyond the SL or behind the Assy Areas: it is not the ground the attack forms up on'}. The force and the time are not printed: both are decisions (E)` });
    confirm.push('The En outposts where the recce finds them, and the time the preliminary operation needs before the move to the FUPs');
  }

  // Ph 2: the Div reserve through the gap onto the En depth (para 13 b (5)-(6) p 88; para 14-16 p 90)
  const objC = at('objC'), fupC = at('fupC'), axisC = at('axisC');
  if (objC && fupC) {
    const ce = ext(objC.pts), fe = ext(fupC.pts);
    const toBox = (e: ReturnType<typeof ext>, p: XY) => Math.hypot(Math.max(0, e.x0 - p.x, p.x - e.x1), Math.max(0, e.y0 - p.y, p.y - e.y1));
    const gap = Math.min(...[...fupC.pts, P((fe.x0 + fe.x1) / 2, (fe.y0 + fe.y1) / 2)].map((p) => toBox(ce, p)));
    rows.push({ name: 'Div phases', st: 'pass', reason: `Ph 1 ${lab(at('bde'), '1 Bde')} onto ${lab(obj, 'OBJ A')} and ${lab(at('bdeS'), '2 Bde')} onto ${lab(objS, 'OBJ B')}; Ph 2 ${lab(res, '3 Bde')} from FUP C between them onto ${lab(objC, 'OBJ C')}, the En depth, the Ph 1 Objs held as the firm base on its flanks. Phased because the troops cannot take every task in one phase and the guns may have to move up to reach the En depth (${G} s19 para 13 b (6) p 88); a quick reorganisation on each Ph 1 Obj forestalls the En counter-attack and lets Ph 2 develop fast (para 16 pp 90-91); Ph 2 should go in before the En Bde reserve can react, 2-3 h of the En decision (p 83)` });
    rows.push({ ...fupFromObjCheck(doc, gap, null, { obj: `${lab(objC, 'OBJ C')}'s` }), name: 'FUP C from OBJ C' });
    const clear = num(doc, 'attack.phase2.clearObj1M', 300);
    const ph1 = [obj, objS].filter((x): x is PlanItem => !!x).map((x) => ext(x.pts));
    // the FUP by its own outline; the axis by its centre line less half its width (the arrow's corridor)
    const gFup = Math.min(...ph1.map((e) => Math.min(...fupC.pts.map((p) => toBox(e, p)))));
    const gAxis = axisC ? Math.min(...ph1.map((e) => Math.min(...axisC.pts.map((p) => toBox(e, p))))) - widthOf(axisC) / 2 : Infinity;
    const g1 = Math.min(gFup, gAxis);
    rows.push({ name: 'Ph 2 through the gap', st: g1 >= clear - 1 ? 'pass' : 'warn', m: g1, limitM: clear, reason: `FUP C and the Ph 2 axis ${fmtM(Math.max(0, g1))} clear of the Ph 1 Objs (wants ${fmtM(clear)}: not through the troops reorganising on them, IBB p 186; PlanDoctrine attack.phase2.clearObj1M)` });
    rows.push({ name: 'Fresh reserve', st: 'warn', reason: `${lab(res, '3 Bde')}, the Div reserve, is committed in Ph 2: once a reserve has been committed a fresh one must be constituted as quickly as possible (${G} s19 para 13 b (5) p 88); the plan names none`, detail: { head: 'No Div reserve after Ph 2', why: 'With the reserve Bde in Ph 2 the Div has nothing to meet the unexpected or the En counter-attack on OBJ A and OBJ B (para 13 b (5) p 88; para 16 p 90).', fix: ['The Res Bns of the Ph 1 Bdes as the fresh Div reserve once OBJ A and OBJ B are firm', 'A Bde or units from Corps as the new reserve (s11 para 2 p 59)', 'One phase only, the reserve kept'] } });
    confirm.push('The En depth locality (OBJ C) by recce or air photo, and the guns\' reach onto it from their gun areas or after they move up');
  } else if (res && obj) {
    // the Div reserve: earmarked with fire support; no time printed (para 13 b (5) p 88)
    const oe = ext(obj.pts);
    const d = dist(res.pts[0], P((oe.x0 + oe.x1) / 2, oe.y0));
    const veh = num(doc, 'moves.tankKmh.go', 24), foot = num(doc, 'cpen.footKmPerH', 5);
    const tV = Math.round((d / 1000) * (60 / veh)), tF = Math.round((d / 1000) * (60 / foot));
    rows.push({ name: 'Div reserve', st: 'pass', m: d, reason: `${lab(res, 'the Div reserve')} ${fmtM(d)} from ${lab(obj, 'the main Obj')}: about ${tV} min mounted (IPB p 18 vehicle rate), ${tF} min on foot, straight line. A reserve with its fire support is earmarked to deal with the unexpected and keep the momentum, and a fresh one is made as soon as it is committed (${G} s19 para 13 b (5) p 88); no time is printed for it. The Inf Div can undertake limited exploitation only (para 18 p 91)` });
    confirm.push('The Div reserve\'s routes forward and its fire support, and the transport to lift it (the Div\'s pool)');
  }
  return { rows, confirm };
}

// ── the options (the tab's Prelim op and Phases chips) ───────────────────────────────────────────────────────────────

type Slot = Recipe['slots'][number];
const rectOf = (s: Slot | undefined) => s?.shape?.rect as { acrossM: number; backM: number; wM: number; hM: number } | undefined;

/**
 * A Div attack with its options; the recipe passed in is not changed.
 * - prelim: the En outposts on the ground of each leading Bde's FUP and SL (OBJ P), cleared first by its Res Bn (GSP s19
 *   para 13 d p 89). Placed 1.65 km in front of the Obj's near edge, just behind the FUP: the En BOPs about 1.5 km ahead of the En
 *   main posn (IpbTemplates def-bde, E); the force and the time are not printed (E).
 * - phases 2 (two up only): the Div reserve Bde from FUP C in the gap between the two Ph 1 Objs onto OBJ C, the En depth
 *   locality 1.5 km behind and between them (the Indian Bde two up holds 1500 m of depth, one Bn in depth, IDD pp 2-3; the
 *   place is a decision, E); FUP C 1000-1200 m from OBJ C by night (attack.fupFromObjM); PL 1 beyond the Ph 1 Objs; the
 *   LOE 1 km beyond OBJ C; the inter-Bde boundary ends short of FUP C.
 */
export function withDivOptions(r: Recipe, doc: DoctrineSet, o: { phases: 1 | 2; prelim: boolean }): Recipe {
  void doc;
  if (r.task !== 'attack' || r.echelon !== '21') return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const slot = (role: string) => out.slots.find((s) => s.role === role);
  const notes: string[] = [];
  let suffix = '';
  if (o.prelim) {
    ([['obj', 'bnRes', 'OBJ P1'], ['objS', 'bnResS', 'OBJ P2']] as const).forEach(([objRole, resRole, label]) => {
      const rc = rectOf(slot(objRole));
      if (!rc) return;
      out.slots.push({ role: objRole === 'obj' ? 'objP' : 'objPS', kind: 'area', sym: '25151700', label, order: 1, shape: { rect: { acrossM: rc.acrossM, backM: rc.backM + rc.hM / 2 + 1650, wM: 400, hM: 300 } } });
      const b = slot(resRole);
      if (b) b.label = 'Res Bn (Prelim Op)';
    });
    suffix += '-pre';
    notes.push(`Prelim op: the En outposts (OBJ P) on the ground of the FUPs and SLs cleared first by each leading Bde's Res Bn, so that the En main posn is observed, the guns deploy forward and a good SL is secured (GSP 1947 Inf Div in Battle s19 para 13 d p 89); OBJ P about 1.5 km ahead of the En main posn (the En BOPs, IpbTemplates def-bde, E); the force and the time are decisions (E).`);
  }
  const ra = rectOf(slot('obj')), rb = rectOf(slot('objS'));
  if (o.phases === 2 && ra && rb) {
    const mid = (ra.acrossM + rb.acrossM) / 2, objBack = ra.backM, near = objBack - 1000; // OBJ C's near edge (backM)
    const cBack = objBack - 1500, fupBack = near + 1200;
    out.slots.push(
      { role: 'objC', kind: 'area', sym: '25151700', label: 'OBJ C', order: 1, shape: { rect: { acrossM: mid, backM: cBack, wM: 1500, hM: 1000 } } },
      { role: 'fupC', kind: 'area', sym: '25140302', label: 'FUP C', order: 2, shape: { pts: [[mid - 700, fupBack + 200], [mid + 700, fupBack - 200]] } },
      { role: 'slC', kind: 'line', sym: '25140303', label: 'SL', order: 2, shape: { pts: [[mid - 750, fupBack - 250], [mid + 750, fupBack - 250]] } },
      { role: 'axisC', kind: 'area', sym: '25151403', label: '', order: 3, shape: { pts: [[mid, fupBack - 250], [mid, near + 100]], widthM: 1300 } },
      { role: 'pl1', kind: 'line', sym: '25140300', label: 'PL 1', order: 5, shape: { pts: [[Math.min(ra.acrossM, rb.acrossM) - 1500, objBack - ra.hM / 2 - 150], [Math.max(ra.acrossM, rb.acrossM) + 1500, objBack - ra.hM / 2 - 150]] } },
    );
    const loe = slot('loe');
    if (loe?.shape?.pts) loe.shape.pts = loe.shape.pts.map(([x]) => [x, cBack - 500 - 1000] as [number, number]);
    const bdy = slot('bdy');
    if (bdy?.shape?.pts) bdy.shape.pts = [bdy.shape.pts[0], [mid, fupBack + 300]];
    const res = slot('divRes');
    if (res) res.label = '3 Bde (Ph 2)';
    suffix += '-2ph';
    notes.push(`Ph 2: the Div reserve Bde from FUP C in the gap between OBJ A and OBJ B onto OBJ C, the En depth (GSP 1947 Inf Div in Battle s19 para 13 b (5)-(6) p 88); OBJ C 1.5 km behind and between the Ph 1 Objs (the En depth Bn, IDD pp 2-3; the place E); a fresh Div reserve to be constituted once it is committed (p 88).`);
  }
  if (!suffix) return r;
  out.id = `${r.id}${suffix}`;
  out.name = `${r.name}${o.prelim ? ', prelim op' : ''}${suffix.includes('2ph') ? ', two phases' : ''}`;
  out.note = `${r.note ?? ''} ${notes.join(' ')}`.trim();
  return out;
}
