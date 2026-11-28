/**
 * PlanArty.ts — PURE. Artillery with a Bn plan, from the ORBAT (arty.json, weapons.json; SO's Hbk 2019 Sec 2) and the
 * Gun Deployment doctrine (GunDoctrine.json: gun area sizes, how far behind the front, room).
 *
 * - the artillery that can support a Bn: the Fd, Med, Med (SP), Mtn and Hy Regts, or one of their Btys, each with its
 *   gun and the gun's planning range (90 % of max, Sec 2 p 212);
 * - its gun area laid behind the plan: a Regt 1000 x 1000 m, a Bty 400 x 200 m (GunDoctrine areas), on the plan's axis
 *   in defence, beside the axis behind the FUP in an attack, in the middle of the band the Gun Deployment tool holds it
 *   to (at least 2 km behind the front in defence, 1 km in an attack; at most a third of the planning range behind);
 * - the rows: Arty reach (the DF Tgts, his FUP; the Obj and LOE in an attack) and, on the ground, Gun area (the share of
 *   it where its guns go: towed on wheels, SP on tracks). Level, crest, firm soil, access and concealment are the Gun
 *   Deployment tool's: the row says so.
 *
 * No ArcGIS, no DOM. The doctrine figures are passed in (the tab reads GunDoctrine.json), so Node can test it.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { footprints } from './PlanRecipes';
import type { Check, CheckState, SolveResult, XY } from './PlanSolve';
import { toWorld, type FitFrame, type PlanGround } from './PlanFit';
import type { OrbatSet } from './PlanOrbat';

/** An artillery unit that can support a Bn, with its gun. */
export interface ArtyType {
  id: string;
  name: string;
  /** A Regt, a Bty, or a Div Arty (its gun Regts in `regts`: a Div plan). */
  unit: 'regt' | 'bty' | 'div';
  guns: number;
  /** A Div Arty's gun Regts, one gun area each (arty.json children, counts expanded). */
  regts?: ArtyType[];
  /** Its Btys' id (a Regt) or its Regt's id (a Bty); null when not printed. */
  partner: string | null;
  weapon: { id: string; name: string; planM: number; maxM: number; minM: number; sp: boolean };
  src: string;
}

/** What the plan carries of its artillery (Recipe.arty): the unit, the gun, the band behind the front, the room wanted. */
export interface ArtyOnPlan extends ArtyType {
  /** How far behind the front the gun area may stand: [min, max] metres, and where the figures come from. */
  band: [number, number];
  bandSrc: string;
  /** The gun area's size, metres, and its source. */
  areaM: [number, number];
  areaSrc: string;
  /** Usable share of the gun area: [ok, min] (GunDoctrine room). */
  room: [number, number];
  /** A Div Arty's Regts, each with its own band and area. */
  regts?: ArtyOnPlan[];
}

/** The Gun Deployment doctrine's figures this module uses (from GunDeploymentFind.gunRulesFrom). */
export interface ArtyDoctrine {
  defMinM: number; attkMinM: number; defMaxFrac: number; attkMaxFrac: number;
  regtM: [number, number]; btyM: [number, number];
  room: [number, number];
  src: { band: string; area: string };
}

const find = (list: any[], id: string | null | undefined) => (id ? list.find((u) => u.id === id) ?? null : null);

/**
 * The Regts and Btys that can support a Bn plan: own guns and howitzers whose range is printed. Rocket units (the
 * MLRS with its 40 km minimum, the MBRL Bty: general support), locating and 8 in units (no weapon linked) are left out. A Regt is listed before its Bty.
 */
export function ownArtyTypes(o: OrbatSet): ArtyType[] {
  const out: ArtyType[] = [];
  for (const u of o.own.filter((x) => x.arm === 'arty' && (x.type === 'regt' || x.type === 'bty'))) {
    const w = (u.weapons ?? []).find((x: any) => x.weapon);
    const W = w ? o.weapons.find((x) => x.id === w.weapon) : null;
    const pr = W?.planRangeM ?? {};
    const maxM = Number(pr.max), planM = Number(pr.plan) || Math.round(maxM * 0.9), minM = Number(pr.min) || 0;
    if (!W || !(maxM > 0) || minM > 10000 || !['how', 'gun'].includes(String(W.type))) continue;
    const guns = Number(w.count) || 0;
    const unit: 'regt' | 'bty' = u.type === 'regt' ? 'regt' : 'bty';
    const partner = unit === 'regt'
      ? (u.children ?? []).map((c: any) => find(o.own, c.unit)).find((c: any) => c?.type === 'bty')?.id ?? null
      : o.own.find((r) => r.type === 'regt' && (r.children ?? []).some((c: any) => c.unit === u.id))?.id ?? null;
    out.push({ id: u.id, name: String(u.name), unit, guns, partner, weapon: { id: W.id, name: String(W.name), planM, maxM, minM, sp: /\(SP\)|\bSP\b/.test(String(W.name)) || /\(SP\)/.test(String(u.name)) }, src: `SO's Hbk 2019 p ${u.page ?? '?'} (${u.id}); ${W.name} plan ${planM} m (weapons.json)` });
  }
  return out.sort((a, b) => Number(a.unit === 'bty') - Number(b.unit === 'bty'));
}

/**
 * The Div Arties (arty.json type `div-arty`: Inf Div Arty 2 Fd + 2 Med Regts, Armd Div Arty 3 Med (SP) + 1 Med Regt;
 * Sec 2 pp 202-203) with their gun Regts as ownArtyTypes lists them, counts expanded. For a Div plan.
 */
export function ownDivArties(o: OrbatSet, types: ArtyType[] = ownArtyTypes(o)): ArtyType[] {
  const out: ArtyType[] = [];
  for (const u of o.own.filter((x) => x.arm === 'arty' && x.type === 'div-arty')) {
    const regts: ArtyType[] = [];
    for (const c of u.children ?? []) {
      const t = types.find((x) => x.id === c.unit && x.unit === 'regt');
      if (!t) continue;
      const n = Math.max(1, Number(c.count) || 1);
      for (let i = 0; i < n; i++) regts.push({ ...t, name: n > 1 ? `${i + 1} ${t.name}` : t.name });
    }
    if (!regts.length) continue;
    // its longest gun stands for it on the chip; each Regt keeps its own
    const top = regts.reduce((p, q) => (q.weapon.planM > p.weapon.planM ? q : p));
    out.push({ id: u.id, name: String(u.name), unit: 'div', guns: regts.reduce((s, r) => s + r.guns, 0), partner: null, regts, weapon: top.weapon,
      src: `SO's Hbk 2019 p ${u.page ?? '?'} (${u.id}): ${regts.map((r) => r.name).join(', ')}` });
  }
  return out;
}

/** The artillery for a plan, with the band, the area and the room from the Gun Deployment doctrine (a crossing is an attack). */
export function artyOnPlan(a: ArtyType, task: string, d: ArtyDoctrine): ArtyOnPlan {
  const atk = task === 'attack' || task === 'crossing';
  const minM = atk ? d.attkMinM : d.defMinM, frac = atk ? d.attkMaxFrac : d.defMaxFrac;
  const { regts, ...one } = a;
  return {
    ...one,
    band: [minM, Math.round(a.weapon.planM * frac)],
    bandSrc: d.src.band,
    areaM: a.unit === 'bty' ? d.btyM : d.regtM,
    areaSrc: d.src.area,
    room: d.room,
    ...(regts ? { regts: regts.map((r) => artyOnPlan(r, task, d)) } : {}),
  };
}

/** The gun-area role of the i-th Regt on a plan: `gunArea`, `gunArea2`, ... */
export const gunRole = (i: number) => (i ? `gunArea${i + 1}` : 'gunArea');

/** A slot's footprint in recipe metres (x across, y back toward home), for keeping a gun area clear of it. */
function slotBox(s: Recipe['slots'][number]): [number, number, number, number] | null {
  const S: any = s.shape;
  if (!S) return null;
  if (S.rect) {
    // a size given by a doctrine path ({ doctrine }) is not a number here: the box is not known (never a NaN box that
    // nothing is ever clear of)
    const b: [number, number, number, number] = [S.rect.acrossM - S.rect.wM / 2, S.rect.backM - S.rect.hM / 2, S.rect.acrossM + S.rect.wM / 2, S.rect.backM + S.rect.hM / 2];
    return b.every(Number.isFinite) ? b : null;
  }
  const pts: [number, number][] = [...(S.at ? [S.at] : []), ...(S.pts ?? []), ...(S.base ?? []), ...(S.ctrl ? [S.ctrl] : [])];
  if (!pts.length) return null;
  const pad = S.widthM ? S.widthM / 2 : S.at ? 150 : 0;
  return [Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad, Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad];
}

/**
 * The gun areas laid behind a crossing (Bn, Bde: the Regt or Bty chosen; Div: each Regt of its Div Arty): on the home
 * bank, each at the middle of its band behind the FUPs, slid across from the plan's axis until it is 100 m clear of the
 * FUPs, Assy areas, bases of fire, HQs, the Bns and Bdes waiting, and the other gun areas. Lines (SL, PL, BH) are crossed.
 */
function withCrossArty(r: Recipe, a: ArtyOnPlan): Recipe {
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const regts = a.regts?.length ? a.regts : [a];
  const fups = r.slots.filter((s) => /^fup/.test(s.role)).map(slotBox).filter((b): b is NonNullable<typeof b> => !!b);
  // the FUPs' middle (recipe y back toward home): the band is measured from there, as in an attack
  const fy = fups.length ? fups.reduce((s, b) => s + (b[1] + b[3]) / 2, 0) / fups.length : 0;
  const busy = r.slots.filter((s) => (s.kind === 'area' || s.kind === 'point') && !/^ax/.test(s.role)).map(slotBox).filter((b): b is NonNullable<typeof b> => !!b);
  const clear = (b: [number, number, number, number]) => busy.every((q) => b[2] + 100 <= q[0] || b[0] - 100 >= q[2] || b[3] + 100 <= q[1] || b[1] - 100 >= q[3]);
  const placed: string[] = [];
  regts.forEach((g, i) => {
    const mid = g.band[1] >= g.band[0] ? Math.round((g.band[0] + g.band[1]) / 2) : g.band[0];
    const [w, h] = g.areaM;
    // the nearest clear place to the axis at the middle of the band: across in 250 m steps, forward or back within the
    // band in 250 m steps (a metre off the band's middle costs 1.5 m across)
    let best: { x: number; d: number; cost: number } | null = null;
    for (let d = g.band[0]; d <= Math.max(g.band[0], g.band[1]) + 1; d += 250) {
      for (let k = 0; k <= 60; k++) {
        const x = k % 2 ? -Math.ceil(k / 2) * 250 : (k / 2) * 250, cost = Math.abs(x) + 1.5 * Math.abs(d - mid);
        if (best && cost >= best.cost) continue;
        const cy = fy + d + h / 2;
        if (clear([x - w / 2, cy - h / 2, x + w / 2, cy + h / 2])) best = { x, d, cost };
      }
    }
    const cx = best?.x ?? 0, d = best?.d ?? mid, cy = Math.round(fy + d + h / 2);
    busy.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
    out.slots.push({ role: gunRole(i), kind: 'area', sym: '25240501', label: g.name, order: 8, shape: { rect: { acrossM: cx, backM: cy, wM: w, hM: h } } });
    placed.push(`${g.name} (${g.guns} x ${g.weapon.name}) ${(d / 1000).toFixed(1)} km behind the FUPs`);
  });
  out.id = `${r.id}-gun`;
  out.name = `${r.name}, ${a.name}`;
  out.arty = a;
  out.note = `${r.note ?? ''} ${a.name} on the home bank: ${placed.join('; ')}; each gun area in the middle of its band (a crossing is an attack: GunDoctrine front), clear of the FUPs and Assy areas (PlanArty.withArty).`.trim();
  return out;
}

/**
 * The gun area laid behind a Coy, Bn or Bde plan (a new recipe `-gun`; the one passed in is not changed): in defence on the plan's
 * axis behind the FDL's front edge, in an attack 1500 m beside the axis behind the FUP (clear of the Assy Area), in the
 * middle of the band; where the band is empty (a short gun) at its minimum, and Arty reach says so.
 */
export function withArty(r: Recipe, doc: DoctrineSet, a: ArtyOnPlan): Recipe {
  if (r.arty) return r;
  if (r.task === 'crossing') return withCrossArty(r, a);
  if (r.echelon === '21' && r.task === 'defence') return withDivDefArty(r, doc, a);
  // a Coy, Bn or Bde defence or attack (a Coy's support Bty, the Bn's, a Bde's Regt): the same band behind its FDL / FUP
  if (!['15', '16', '18'].includes(r.echelon) || (r.task !== 'defence' && r.task !== 'attack')) return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const d = a.band[1] >= a.band[0] ? Math.round((a.band[0] + a.band[1]) / 2) : a.band[0];
  let across = 0, back: number;
  if (r.task === 'defence') {
    const fp = footprints(doc, r).filter((b) => b.kind === 'fwd' || b.kind === 'round');
    const front = fp.length ? Math.min(...fp.map((b) => b.y - b.h / 2)) : 0;
    back = front + d;
  } else {
    const fup = r.slots.find((s) => s.role === 'fup')?.shape?.pts;
    const fy = fup?.length ? fup.reduce((s, p) => s + p[1], 0) / fup.length : 0;
    back = fy + d;
    // 1500 m beside the axis, then the nearest place 100 m clear of the Assy Area, the BOF, the HQ and the other areas
    // (250 m steps across, either side), as the crossing's gun areas are
    const [w, h] = a.areaM;
    const busy = r.slots.filter((s) => (s.kind === 'area' || s.kind === 'point') && !/^ax/.test(s.role)).map(slotBox).filter((b): b is NonNullable<typeof b> => !!b);
    const cy = back + h / 2;
    const clear = (x: number) => busy.every((q) => x + w / 2 + 100 <= q[0] || x - w / 2 - 100 >= q[2] || cy + h / 2 + 100 <= q[1] || cy - h / 2 - 100 >= q[3]);
    across = 1500;
    for (let k = 0; k <= 40 && !clear(across); k++) across = 1500 + (k % 2 ? -1 : 1) * Math.ceil((k + 1) / 2) * 250;
  }
  out.slots.push({ role: 'gunArea', kind: 'area', sym: '25240501', label: a.name, order: 8, shape: { rect: { acrossM: across, backM: Math.round(back + a.areaM[1] / 2), wM: a.areaM[0], hM: a.areaM[1] } } });
  out.id = `${r.id}-gun`;
  out.name = `${r.name}, ${a.name}`;
  out.arty = a;
  out.note = `${r.note ?? ''} ${a.name} (${a.guns} x ${a.weapon.name}, planning range ${(a.weapon.planM / 1000).toFixed(1)} km) in its gun area ${(a.areaM[0] / 1000).toFixed(1)} x ${(a.areaM[1] / 1000).toFixed(1)} km, its front edge ${(d / 1000).toFixed(1)} km behind the ${r.task === 'attack' ? 'FUP' : 'FDL'} (PlanArty.withArty).`.trim();
  return out;
}

/**
 * A Div defence's artillery (OoW Vol I p 83): the Div Arty deployed in groups to cover the major approaches, one group
 * behind each forward Bde (the approach it holds), its Regts dealt out across the groups in turn; each Regt's gun area in
 * the middle of its band behind that Bde's front, side by side 300 m apart within the group. A Div Arty or one Regt.
 */
function withDivDefArty(r: Recipe, doc: DoctrineSet, a: ArtyOnPlan): Recipe {
  const fwd = footprints(doc, r).filter((b) => b.kind === 'fwd').sort((p, q) => p.x - q.x);
  if (!fwd.length) return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const regts = a.regts?.length ? a.regts : [a];
  const groups: ArtyOnPlan[][] = fwd.map(() => []);
  regts.forEach((g, i) => groups[i % fwd.length].push(g));
  const placed: string[] = [];
  let k = 0;
  groups.forEach((gs, gi) => {
    const b = fwd[gi], front = b.y - b.h / 2;
    gs.forEach((g, j) => {
      const d = g.band[1] >= g.band[0] ? Math.round((g.band[0] + g.band[1]) / 2) : g.band[0];
      const [w, h] = g.areaM;
      const across = Math.round(b.x + (j - (gs.length - 1) / 2) * (w + 300));
      out.slots.push({ role: gunRole(k++), kind: 'area', sym: '25240501', label: g.name, order: 8, shape: { rect: { acrossM: across, backM: Math.round(front + d + h / 2), wM: w, hM: h } } });
    });
    if (gs.length) placed.push(`${gs.map((g) => g.name).join(', ')} behind the ${(r.slots.find((s) => s.role === b.role)?.label ?? b.role)}`);
  });
  out.id = `${r.id}-gun`;
  out.name = `${r.name}, ${a.name}`;
  out.arty = a;
  out.note = `${r.note ?? ''} ${a.name} in groups to cover the major approaches (OoW Vol I p 83): ${placed.join('; ')}; each gun area in the middle of its band behind the Bde's front (PlanArty.withArty).`.trim();
  return out;
}

const centre = (pts: XY[]): XY => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

/**
 * A gun-area role's item and its sections (G on mountain ground lays `<role>S2`, `<role>S3`, ...: withGunSections), the
 * first section first; a gun area not laid by section is the one item. Empty when the role is not on the plan.
 */
export function gunSectionsOf<T extends { role: string; pts: XY[] }>(items: T[], role: string): T[] {
  const re = new RegExp(`^${role}S(\\d+)$`);
  const first = items.filter((i) => i.role === role && i.pts.length);
  const more = items.filter((i) => re.test(i.role) && i.pts.length).sort((p, q) => Number(re.exec(p.role)![1]) - Number(re.exec(q.role)![1]));
  return [...first, ...more];
}

/**
 * Reach from a gun area laid by sections: a point is in range when any section has it between the gun's minimum and its
 * planning range; its distance is the one from the nearest such section (else from the nearest section). With one area
 * these read exactly as from its centre.
 */
function reachFrom(cs: XY[], plan: number, min: number) {
  const rs = (p: XY) => cs.map((c) => Math.hypot(p.x - c.x, p.y - c.y));
  const ok = (r: number) => r <= plan && r >= min;
  return {
    inRange: (p: XY) => rs(p).some(ok),
    distTo: (p: XY) => { const all = rs(p), good = all.filter(ok); return good.length ? Math.min(...good) : Math.min(...all); },
  };
}

/**
 * A Div defence's artillery rows (OoW Vol I p 83): Arty groups, each forward Bde (each major approach) with a group behind
 * it whose guns reach out past the En FUP in front of it (`enemyFupM`), the DF plan by sectors; Arty reinforcement, the Med
 * / Hy Regts in the Div Arty and the reinforcing Regt the extended frontage wants (a warn on the three-axes layout, OoW
 * Vol I Annex D an extended frontage); on the ground, Gun area for each Regt. Plan metres, y toward the enemy.
 */
function divArtyRows(items: { role: string; pts: XY[] }[], recipe: Recipe, a: ArtyOnPlan, enemyFupM: number | null, f: FitFrame | null, g: PlanGround | null): Check[] {
  const regts = a.regts?.length ? a.regts : [a];
  const areas = regts.map((r, i) => ({ r, it: items.find((x) => x.role === gunRole(i) && x.pts.length), secs: gunSectionsOf(items, gunRole(i)) })).filter((x): x is { r: ArtyOnPlan; it: { role: string; pts: XY[] }; secs: { role: string; pts: XY[] }[] } => !!x.it);
  if (!areas.length) return [];
  const label = (role: string) => recipe.slots.find((s) => s.role === role)?.label ?? role;
  const fwd = items.filter((i) => /^fwd/.test(i.role) && i.pts.length >= 3).map((i) => ({ role: i.role, x: centre(i.pts).x, front: Math.max(...i.pts.map((p) => p.y)) }));
  if (!fwd.length) return [];
  // each gun area belongs to the group of the forward Bde nearest it across the front
  const groupOf = (p: XY) => fwd.reduce((best, b) => (Math.abs(b.x - p.x) < Math.abs(best.x - p.x) ? b : best), fwd[0]);
  const beyond = enemyFupM ?? 0;
  let short = 0;
  const parts = fwd.map((b) => {
    const mine = areas.filter((x) => groupOf(centre(x.it.pts)).role === b.role);
    const tgt = { x: b.x, y: b.front + beyond };
    // a Regt laid by sections reaches when any of its sections does
    const reach = mine.filter((x) => x.secs.some((sc) => { const c = centre(sc.pts); const q = Math.hypot(tgt.x - c.x, tgt.y - c.y); return q <= x.r.weapon.planM; }));
    if (!mine.length || reach.length < mine.length) short++;
    return `${label(b.role)}: ${mine.length ? `${mine.map((x) => x.r.name).join(', ')}${reach.length < mine.length ? `, ${mine.length - reach.length} short of ${beyond ? `the En FUP ${km(beyond)} out` : 'its front'}` : beyond ? `, past the En FUP ${km(beyond)} out` : ''}` : 'no group behind it'}`;
  });
  const rows: Check[] = [{ name: 'Arty groups', st: short ? 'warn' : 'pass', reason: `${a.name} in ${fwd.length} groups, one behind each forward Bde: ${parts.join('; ')}. The Div Arty deployed in groups to cover the major approaches, the DF plan made by sectors (OoW Vol I p 83); in the desert alternative gun areas against the En outflanking moves (OoW Vol I p 70). Band: ${a.bandSrc}`,
    ...(short ? { detail: { head: `${short} approach${short > 1 ? 'es' : ''} without a group in reach`, why: 'Each major approach needs artillery that reaches the En forming up in front of it (OoW Vol I p 83).', fix: ['Move a group nearer the approach, or a Regt from a quieter sector', 'A longer gun (a Med or Hy Regt) on that approach'] } } : {}) }];
  const heavy = regts.filter((r) => /\b(Med|Hy|Medium|Heavy)\b/i.test(r.name));
  const extended = recipe.layout === 'three-axes';
  rows.push({ name: 'Arty reinforcement', st: extended ? 'warn' : 'pass', reason: `${heavy.length ? `${heavy.map((r) => r.name).join(', ')} in the Div Arty` : 'no Med or Hy Regt in the Div Arty'}; on extended frontages the Div Arty is reinforced by a minimum of one Med / Hy Regt (OoW Vol I p 83)${extended ? ': three Bdes up on three axes is such a frontage (OoW Vol I Annex D p 105): ask Corps for it' : ': confirm with Corps if the frontage is extended'}`,
    ...(extended ? { detail: { head: 'Reinforcing Med / Hy Regt not in the plan', why: 'On an extended frontage the Div Arty alone cannot cover every approach in strength (OoW Vol I p 83).', fix: ['Ask Corps for a Med / Hy Regt and give it the main approach'] } } : {}) });
  if (f && g) {
    const read = areas.map(({ r, secs }) => ({ r, s: worstGround(secs, f, g, !r.weapon.sp) })).filter((x) => x.s !== null) as { r: ArtyOnPlan; s: number }[];
    const worst = read.length ? Math.min(...read.map((x) => x.s)) : null;
    const gst: CheckState = worst === null ? 'unchecked' : worst >= a.room[0] ? 'pass' : worst >= a.room[1] ? 'warn' : 'fail';
    rows.push({ name: 'Gun area', st: gst, reason: `${read.length ? read.map((x) => `${x.r.name} ${Math.round(x.s * 100)} %`).join(', ') + ` of the area is ground a gun position may take (the bundle's Gun Position going${read.some((x) => !x.r.weapon.sp) ? '; loose sand not counted for the towed guns, DW p 60' : ''}); ${Math.round(a.room[0] * 100)} % wanted (GunDoctrine room)` : 'their ground not loaded'}; ${a.areaSrc}` });
  }
  return rows;
}
const fmtM = (m: number) => (m >= 1000 ? km(m) : `${Math.round(m / 10) * 10} m`);

/**
 * The artillery's rows. Arty reach: how far behind the front its gun area stands (the band), how far its guns reach
 * beyond it, and, in defence, the DF Tgts and his FUP (`enemyFupM`) in range; in an attack, the Obj and the LOE. On the
 * ground, Gun area: the share of it where its guns go (towed on wheels, SP on tracks), against GunDoctrine room.
 * Plan metres (y toward the enemy). Empty with no gun area.
 */
export function artyRows(items: { role: string; pts: XY[] }[], recipe: Recipe, enemyFupM: number | null, f: FitFrame | null = null, g: PlanGround | null = null, backOf: ((p: XY) => number) | null = null): Check[] {
  const a = recipe.arty as ArtyOnPlan | undefined;
  if (a && recipe.task === 'crossing') return crossArtyRows(items, a, f, g, backOf);
  if (a && recipe.echelon === '21' && recipe.task === 'defence') return divArtyRows(items, recipe, a, enemyFupM, f, g);
  // the gun area, or its sections (G on mountain ground: MW s22 para 6 a (1) p 244, a Bty by sections in two or three places)
  const secs = gunSectionsOf(items, 'gunArea');
  const ga = secs[0];
  if (!a || !ga) return [];
  const many = secs.length > 1;
  const cs = secs.map((s) => centre(s.pts));
  const gFront = Math.max(...secs.flatMap((s) => s.pts.map((p) => p.y)));
  const plan = a.weapon.planM, min = a.weapon.minM;
  const { inRange, distTo } = reachFrom(cs, plan, min);
  const rows: Check[] = [];
  const what = `${a.name} (${a.guns} x ${a.weapon.name}, planning range ${km(plan)}${min ? `, min ${km(min)}` : ''})`;
  const its = many ? `its ${secs.length} sections, the nearest` : 'its gun area';
  if (recipe.task === 'attack') {
    const fup = items.find((i) => i.role === 'fup');
    const fy = fup ? centre(fup.pts).y : 0;
    const d = fy - gFront;
    const tgts = ['obj', 'loe', 'obj2'].map((r) => items.find((i) => i.role === r)).filter((i): i is NonNullable<typeof i> => !!i);
    const far = tgts.flatMap((t) => t.pts).reduce((m, p) => Math.max(m, distTo(p)), 0);
    const out = tgts.filter((t) => !t.pts.every(inRange)).map((t) => t.role === 'loe' ? 'the LOE' : t.role === 'obj2' ? 'Obj 2' : 'the Obj');
    const inBand = d >= a.band[0] - 1 && d <= a.band[1] + 1;
    const st: CheckState = out.length ? 'fail' : inBand ? 'pass' : 'warn';
    rows.push({ name: 'Arty reach', st, reason: `${what}: ${its} ${fmtM(Math.max(0, d))} behind the FUP (${km(a.band[0])}-${km(a.band[1])}: ${a.bandSrc}); ${out.length ? `${out.join(' and ')} out of range${many ? ' of every section' : ''}: the guns forward, or a longer gun` : `the Obj${tgts.some((t) => t.role === 'loe') ? ' and the LOE' : ''} in range, the furthest point ${km(far)} from ${many ? 'the nearest section in range' : 'the guns'}`}` });
  } else {
    const fdl = items.find((i) => i.role === 'fdl');
    const frontY = fdl ? Math.max(...fdl.pts.map((p) => p.y)) : 0;
    const d = frontY - gFront;
    const beyond = Math.max(0, ...cs.map((c) => plan - (frontY - c.y)));
    const df = items.filter((i) => i.role === 'dfTgt' && i.pts.length);
    const dfOut = df.filter((t) => !inRange(t.pts[0])).length;
    const fupOk = enemyFupM === null || beyond >= enemyFupM;
    const inBand = d >= a.band[0] - 1 && d <= a.band[1] + 1;
    const st: CheckState = dfOut || !fupOk ? 'warn' : inBand ? 'pass' : 'warn';
    rows.push({ name: 'Arty reach', st, reason: `${what}: ${its} ${fmtM(Math.max(0, d))} behind the FDL (${km(a.band[0])}-${km(a.band[1])}: ${a.bandSrc}); its guns reach ${km(beyond)} beyond the FDL${enemyFupM !== null ? `, ${fupOk ? 'past' : 'short of'} the En FUP ${km(enemyFupM)} out` : ''}${df.length ? `; ${df.length - dfOut} of ${df.length} DF Tgts in range` : ''}${a.band[1] < a.band[0] ? `; no band: a third of its range (${km(a.band[1])}) is short of the ${km(a.band[0])} it must stand back: a longer gun` : !inBand ? `; outside the band${d < a.band[0] ? ': too near the front, the En overruns it early (OoW I p 70)' : ': too far back, the fire does not reach deep'}` : ''}` });
  }
  if (f && g) {
    const towed = !a.weapon.sp;
    // by sections: the worst-placed section speaks for the Bty
    const reads = secs.map((x) => gunGroundRead(x.pts, f, g, towed)).filter((x): x is { s: number; sand: number } => !!x);
    const rd = !reads.length ? null : many ? reads.reduce((w, x) => (x.s < w.s ? x : w)) : reads[0];
    const s = rd?.s ?? null;
    const st: CheckState = s === null ? 'unchecked' : s >= a.room[0] ? 'pass' : s >= a.room[1] ? 'warn' : 'fail';
    rows.push({ name: 'Gun area', st, reason: `${s === null ? 'its ground not loaded' : `${Math.round(s * 100)} % of ${many ? `its worst section (of ${secs.length})` : 'it'} is ground a gun position may take (the bundle's Gun Position going)${sandText(rd!.sand, towed)}; ${Math.round(a.room[0] * 100)} % wanted, under ${Math.round(a.room[1] * 100)} % the guns cannot keep 100 m apart (GunDoctrine room)${st === 'fail' ? ': move it (G while placing)' : ''}`}; ${a.areaSrc}. Level, crest, firm soil, access and concealment: G while placing sites it with the Gun Deployment finder` });
    if (recipe.task !== 'attack') {
      const lee = duneLeeRow(items.filter((i) => i.role === 'dfTgt' && i.pts.length).map((i) => ({ label: (i as { label?: string }).label ?? 'DF Tgt', at: i.pts[0] })), cs, f, g);
      if (lee) rows.push(lee);
    }
  }
  return rows;
}

/**
 * The dune lee (DW s17 para 7 e p 61: "Targets on the reverse slopes of high and steep dunes can not be effectively
 * engaged by guns"). From each DF Tgt back toward the nearest gun area, every 30 m out to `withinM`: a crest of sand or
 * dunes that rises `riseM` or more above the target (50 ft, the lowest of the desert's dunes, DW s2 para 1 a p 2) at an
 * angle above `fallDeg` (the shell's angle of fall: E) hides it from the guns. The figures are GunDoctrine desert.duneLee
 * (tools/planbuilder-test/dw.mjs keeps them equal). Null when no target has a sand crest near it (not dune country).
 */
export const DUNE_LEE = { riseM: 15, fallDeg: 20, withinM: 300, stepM: 30 } as const;
export function duneLeeRow(tgts: { label: string; at: XY }[], guns: XY[], f: FitFrame, g: PlanGround): Check | null {
  if (!tgts.length || !guns.length) return null;
  const sandy = (c: number | null) => c !== null && /\b(sand|dunes?)\b/i.test(g.label(c));
  const hid: string[] = [];
  let read = 0, dune = false;
  for (const t of tgts) {
    const gun = guns.reduce((b, c) => (Math.hypot(c.x - t.at.x, c.y - t.at.y) < Math.hypot(b.x - t.at.x, b.y - t.at.y) ? c : b));
    const L = Math.hypot(gun.x - t.at.x, gun.y - t.at.y);
    if (L < 1) continue;
    const ux = (gun.x - t.at.x) / L, uy = (gun.y - t.at.y) / L;
    const w0 = toWorld(f, t.at), e0 = g.elev(w0.x, w0.y);
    if (!(e0 === e0)) continue;
    read++;
    let worst: { rise: number; deg: number } | null = null;
    for (let d = DUNE_LEE.stepM; d <= Math.min(DUNE_LEE.withinM, L); d += DUNE_LEE.stepM) {
      const w = toWorld(f, { x: t.at.x + ux * d, y: t.at.y + uy * d });
      const e = g.elev(w.x, w.y), c = g.cls(w.x, w.y);
      if (!(e === e) || !sandy(c)) continue;
      dune = true;
      const rise = e - e0, deg = (Math.atan2(rise, d) * 180) / Math.PI;
      if (rise >= DUNE_LEE.riseM && deg >= DUNE_LEE.fallDeg && (!worst || rise > worst.rise)) worst = { rise, deg }; // the crest: the highest qualifying point
    }
    if (worst) hid.push(`${t.label} under a ${Math.round(worst.rise)} m dune face at ${Math.round(worst.deg)}°`);
  }
  if (!read) return { name: 'Dune lee', st: 'unchecked', reason: 'the elevation at the DF Tgts is not loaded: targets on the reverse slopes of high, steep dunes cannot be effectively engaged by guns (DW p 61)' };
  if (!dune) return null;
  if (!hid.length) return { name: 'Dune lee', st: 'pass', reason: `none of the ${read} DF Tgts read lies under a dune face rising ${DUNE_LEE.riseM} m or more at over ${DUNE_LEE.fallDeg}° toward the guns (DW p 61: the reverse slopes of high, steep dunes cannot be effectively engaged by guns)` };
  return {
    name: 'Dune lee', st: 'warn',
    reason: `${hid.length} of ${read} DF Tgts on a dune's reverse slope from the guns: ${hid.join('; ')} (DW s17 para 7 e p 61: targets on the reverse slopes of high and steep dunes cannot be effectively engaged by guns)`,
    detail: { head: `${hid.length} DF Tgt${hid.length > 1 ? 's' : ''} in the dune lee`, why: `Targets on the reverse slopes of high and steep dunes cannot be effectively engaged by guns (DW s17 para 7 e p 61); a crest of ${DUNE_LEE.riseM} m (50 ft, the lowest dunes, DW p 2) or more within ${DUNE_LEE.withinM} m, steeper than the shell's fall (${DUNE_LEE.fallDeg}°, E), hides the target.`, items: hid, fix: ['Give these targets to the mortars (high angle) or to air / combat aviation', 'Move the gun area so the line of fire runs along the dunes, not across them', 'Air burst over troops in the open (DW p 61)'] },
  };
}

/**
 * The share of a gun area (plan metres) that is ground a gun position may take: 25 samples against the bundle's Gun
 * Position going (rules.json profiles.gun: water, marsh, built-up, too steep are no place for guns); null with under 13
 * read (the ground not loaded).
 */
function gunGround(pts: XY[], f: FitFrame, g: PlanGround, towed = false): number | null {
  return gunGroundRead(pts, f, g, towed)?.s ?? null;
}

/** gunGround over a gun area's sections: the worst read (one area: its own share); null when none is read. */
function worstGround(secs: { pts: XY[] }[], f: FitFrame, g: PlanGround, towed = false): number | null {
  const v = secs.map((sc) => gunGround(sc.pts, f, g, towed)).filter((x): x is number => x !== null);
  return v.length ? Math.min(...v) : null;
}

/**
 * gunGround with the loose sand counted: for towed guns the bundle's Sand class is no place for them ("in areas of loose
 * sand, it is difficult to move the guns. Therefore, self propelled guns are ideal": DW s17 para 7 a p 60), SP guns take
 * it (the Gun Position going's caution). `sand` the share of loose sand read, whatever the guns.
 */
function gunGroundRead(pts: XY[], f: FitFrame, g: PlanGround, towed: boolean): { s: number; sand: number } | null {
  const going = g.going('gun');
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let n = 0, ok = 0, sand = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const w = toWorld(f, { x: x0 + ((i + 0.5) / 5) * (x1 - x0), y: y0 + ((j + 0.5) / 5) * (y1 - y0) });
    const c = g.cls(w.x, w.y);
    if (c === null) continue;
    n++;
    const loose = /^sand$/i.test(g.label(c));
    if (loose) sand++;
    if (!going.nogo.has(c) && !(towed && loose)) ok++;
  }
  return n >= 13 ? { s: ok / n, sand: sand / n } : null;
}

/** The loose sand in a gun area, in words ('' when none): towed guns stick there, SP guns are ideal (DW p 60). */
function sandText(sand: number, towed: boolean): string {
  if (sand < 0.04) return '';
  return towed ? `; ${Math.round(sand * 100)} % loose sand, not counted: towed guns are hard to move in loose sand, SP guns are ideal there (DW p 60)` : `; ${Math.round(sand * 100)} % loose sand, taken by SP guns (DW p 60)`;
}

/**
 * A crossing's artillery rows (withCrossArty): Arty reach, each Regt from its gun area behind the FUPs to the break-in
 * (the Objs, PL 1) and the deep line (Obj 3, PL 2, the BH); on the ground, Gun area for each. Every Regt must reach the
 * break-in (IBB S46: the assault is fired in); the deep line wants at least one (the Med Regts' depth fire).
 */
function crossArtyRows(items: { role: string; pts: XY[] }[], a: ArtyOnPlan, f: FitFrame | null, g: PlanGround | null, backOf: ((p: XY) => number) | null = null): Check[] {
  // how far behind the water a point is: the obstacle's own frame when the crossing is laid along it (a bend, a
  // diagonal to the aim), else the plan's y
  const back = backOf ?? ((p: XY) => -p.y);
  const regts = a.regts?.length ? a.regts : [a];
  const areas = regts.map((r, i) => ({ r, it: items.find((x) => x.role === gunRole(i) && x.pts.length), secs: gunSectionsOf(items, gunRole(i)) })).filter((x): x is { r: ArtyOnPlan; it: { role: string; pts: XY[] }; secs: { role: string; pts: XY[] }[] } => !!x.it);
  if (!areas.length) return [];
  const fups = items.filter((i) => /^fup/.test(i.role) && i.pts.length);
  const fb = fups.length ? fups.reduce((s, i) => s + back(centre(i.pts)), 0) / fups.length : 0;
  const near = items.filter((i) => /^(obj[12]?|ph1[ab]?)$/.test(i.role) && i.pts.length);
  const deep = items.filter((i) => /^(obj3|ph2|bh)$/.test(i.role) && i.pts.length);
  const word = (i: { role: string }) => ({ ph1: 'PL 1', ph1a: 'PL 1', ph1b: 'PL 1', ph2: 'PL 2', bh: 'the BH', obj: 'the Obj', obj1: 'Obj 1', obj2: 'Obj 2', obj3: 'Obj 3' } as Record<string, string>)[i.role] ?? i.role;
  let nearAll = 0, deepAny = false, offBand = 0;
  const parts = areas.map(({ r, secs }) => {
    // its front edge (the point nearest the water) behind the FUPs' middle; laid by sections, the nearest section's
    const d = Math.min(...secs.flatMap((sc) => sc.pts.map(back))) - fb;
    const { inRange: reach, distTo } = reachFrom(secs.map((sc) => centre(sc.pts)), r.weapon.planM, r.weapon.minM);
    const nOut = [...new Set(near.filter((t) => !t.pts.every(reach)).map(word))];
    const dOut = [...new Set(deep.filter((t) => !t.pts.every(reach)).map(word))];
    if (!nOut.length) nearAll++;
    if (deep.length && !dOut.length) deepAny = true;
    const inBand = d >= r.band[0] - 1 && d <= r.band[1] + 1;
    if (!inBand) offBand++;
    const far = [...near, ...deep].flatMap((t) => t.pts).reduce((m, p) => Math.max(m, distTo(p)), 0);
    return `${r.name} ${fmtM(Math.max(0, d))} behind the FUPs (${km(r.band[0])}-${km(r.band[1])}${inBand ? '' : ', outside its band'}): ${nOut.length ? `${nOut.join(', ')} out of range` : 'the break-in in range'}${deep.length ? `, ${dOut.length ? `${dOut.join(', ')} out` : 'the deep line in range'}` : ''} (furthest ${km(far)}, plan ${km(r.weapon.planM)})`;
  });
  const st: CheckState = !nearAll ? 'fail' : nearAll < areas.length || (deep.length && !deepAny) || offBand ? 'warn' : 'pass';
  const rows: Check[] = [{ name: 'Arty reach', st, reason: `${a.name}${a.unit === 'div' ? ` (${areas.length} Regts, ${a.guns} guns)` : ` (${a.guns} x ${a.weapon.name})`}: ${parts.join('; ')}${deep.length && !deepAny ? '; no Regt reaches the deep line: the Med Regts forward after the break-in, or Corps Arty' : ''}. Band: ${a.bandSrc}` }];
  if (f && g) {
    const shares = areas.map(({ r, secs }) => ({ r, s: worstGround(secs, f, g, !r.weapon.sp) }));
    const read = shares.filter((x) => x.s !== null) as { r: ArtyOnPlan; s: number }[];
    const worst = read.length ? Math.min(...read.map((x) => x.s)) : null;
    const gst: CheckState = worst === null ? 'unchecked' : worst >= a.room[0] ? 'pass' : worst >= a.room[1] ? 'warn' : 'fail';
    rows.push({ name: 'Gun area', st: gst, reason: `${read.length ? read.map((x) => `${x.r.name} ${Math.round(x.s * 100)} %`).join(', ') + ` of the area is ground a gun position may take (the bundle's Gun Position going${read.some((x) => !x.r.weapon.sp) ? '; loose sand not counted for the towed guns, DW p 60' : ''}); ${Math.round(a.room[0] * 100)} % wanted, under ${Math.round(a.room[1] * 100)} % the guns cannot keep 100 m apart (GunDoctrine room)` : 'their ground not loaded'}; ${a.areaSrc}. Level, crest, firm soil, access and concealment: site them with Gun Deployment` });
  }
  return rows;
}

// ── mountains: towed guns by section (MW s22 para 5 b p 240, para 6 a (1) p 244) ─────────────────────────────────────

/** A plan's Regt or Bty whose guns go by section on mountain ground: towed (not SP) and not a light, mule-packed gun. */
export function goesBySectionOnPlan(a: ArtyType, lightIds: readonly string[]): boolean {
  return !a.weapon.sp && !lightIds.includes(a.weapon.id);
}

/** The section sites G found for one gun-area role: its unit's name and each section's outline (plan metres). */
export interface GunSections { role: string; name: string; rings: XY[][]; /** Each section's label (a Regt's Btys: "B2 Sec 1"); else "<name> Sec n". */ labels?: string[] }

/**
 * The plan with its gun areas by sections (G on mountain ground): each gun-area role's item becomes its first section
 * (label "<unit> Sec 1", the section's outline) and a copy of it is added for every other section ("Sec 2", "Sec 3";
 * role `<role>S<n>`), so the plan shows and Create on Map places one PAA per section site, with the plan's own symbol.
 * The result passed in is not changed.
 */
export function withGunSections(res: SolveResult, secs: GunSections[]): SolveResult {
  if (!secs.length) return res;
  const items = [...res.items];
  for (const s of secs) {
    const k = items.findIndex((i) => i.role === s.role);
    if (k < 0 || !s.rings.length) continue;
    const base = items[k];
    const lbl = (j: number) => s.labels?.[j] ?? `${s.name} Sec ${j + 1}`;
    items[k] = { ...base, label: lbl(0), pts: s.rings[0] };
    s.rings.slice(1).forEach((ring, j) => items.push({ ...base, id: `${base.id}-s${j + 2}`, role: `${s.role}S${j + 2}`, label: lbl(j + 1), pts: ring }));
  }
  return { ...res, items };
}

/**
 * The Gun area rows on mountain ground for towed guns (MW s22 pp 240, 244): the conventional area's room test is set
 * aside (gun areas near the roads are too small for the conventional layout; towed guns go a single gun or a section near
 * the hairpin bends, a Bty by sections in two or three places): not checked until G sites the Bty by sections, then the
 * sections' own verdict (`sited`, from the Gun site row). Other ground, SP or light guns: the rows as they are.
 */
export function mountainGunRows(rows: Check[], a: ArtyOnPlan | undefined, kind: string | null | undefined, lightIds: readonly string[], sited: Check | null): Check[] {
  if (kind !== 'mountain' || !a) return rows;
  const units = a.regts?.length ? a.regts : [a];
  const towed = units.filter((u) => goesBySectionOnPlan(u, lightIds));
  if (!towed.length) return rows;
  const book = 'in mountains gun areas near the roads and tracks are scarce and too small for the conventional layout: towed guns go a single gun or a section in small areas near the hairpin bends, a Bty by sections in two or three places (MW s22 para 5 b p 240, para 6 a (1) p 244); light guns away from the roads keep the conventional layout (p 241)';
  return rows.map((r) => {
    if (r.name !== 'Gun area') return r;
    if (sited) return { ...r, st: sited.st, reason: `by sections (G): ${towed.map((u) => u.name).join(', ')}, see Gun site; ${book}; confirm the sites by recce (p 240)`, detail: undefined };
    return { ...r, st: 'unchecked', reason: `${towed.map((u) => u.name).join(', ')} (towed): ${book}. G sites the Bty by sections. The conventional area as laid: ${r.reason}`, detail: undefined };
  });
}

