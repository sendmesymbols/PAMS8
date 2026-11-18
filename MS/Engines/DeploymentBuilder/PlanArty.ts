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
import type { Check, CheckState, XY } from './PlanSolve';
import { toWorld, type FitFrame, type PlanGround } from './PlanFit';
import type { OrbatSet } from './PlanOrbat';

/** An artillery unit that can support a Bn, with its gun. */
export interface ArtyType {
  id: string;
  name: string;
  unit: 'regt' | 'bty';
  guns: number;
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

/** The artillery for a plan, with the band, the area and the room from the Gun Deployment doctrine. */
export function artyOnPlan(a: ArtyType, task: string, d: ArtyDoctrine): ArtyOnPlan {
  const minM = task === 'attack' ? d.attkMinM : d.defMinM, frac = task === 'attack' ? d.attkMaxFrac : d.defMaxFrac;
  return {
    ...a,
    band: [minM, Math.round(a.weapon.planM * frac)],
    bandSrc: d.src.band,
    areaM: a.unit === 'regt' ? d.regtM : d.btyM,
    areaSrc: d.src.area,
    room: d.room,
  };
}

/**
 * The gun area laid behind a Bn plan (a new recipe `-gun`; the one passed in is not changed): in defence on the plan's
 * axis behind the FDL's front edge, in an attack 1500 m beside the axis behind the FUP (clear of the Assy Area), in the
 * middle of the band; where the band is empty (a short gun) at its minimum, and Arty reach says so.
 */
export function withArty(r: Recipe, doc: DoctrineSet, a: ArtyOnPlan): Recipe {
  if (r.echelon !== '16' || (r.task !== 'defence' && r.task !== 'attack') || r.arty) return r;
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
    across = 1500;
  }
  out.slots.push({ role: 'gunArea', kind: 'area', sym: '25240501', label: a.name, order: 8, shape: { rect: { acrossM: across, backM: Math.round(back + a.areaM[1] / 2), wM: a.areaM[0], hM: a.areaM[1] } } });
  out.id = `${r.id}-gun`;
  out.name = `${r.name}, ${a.name}`;
  out.arty = a;
  out.note = `${r.note ?? ''} ${a.name} (${a.guns} x ${a.weapon.name}, planning range ${(a.weapon.planM / 1000).toFixed(1)} km) in its gun area ${(a.areaM[0] / 1000).toFixed(1)} x ${(a.areaM[1] / 1000).toFixed(1)} km, its front edge ${(d / 1000).toFixed(1)} km behind the ${r.task === 'attack' ? 'FUP' : 'FDL'} (PlanArty.withArty).`.trim();
  return out;
}

const centre = (pts: XY[]): XY => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const fmtM = (m: number) => (m >= 1000 ? km(m) : `${Math.round(m / 10) * 10} m`);

/**
 * The artillery's rows. Arty reach: how far behind the front its gun area stands (the band), how far its guns reach
 * beyond it, and, in defence, the DF Tgts and his FUP (`enemyFupM`) in range; in an attack, the Obj and the LOE. On the
 * ground, Gun area: the share of it where its guns go (towed on wheels, SP on tracks), against GunDoctrine room.
 * Plan metres (y toward the enemy). Empty with no gun area.
 */
export function artyRows(items: { role: string; pts: XY[] }[], recipe: Recipe, enemyFupM: number | null, f: FitFrame | null = null, g: PlanGround | null = null): Check[] {
  const a = recipe.arty as ArtyOnPlan | undefined;
  const ga = items.find((i) => i.role === 'gunArea' && i.pts.length);
  if (!a || !ga) return [];
  const xs = ga.pts.map((p) => p.x), ys = ga.pts.map((p) => p.y);
  const C = centre(ga.pts), gFront = Math.max(...ys);
  const plan = a.weapon.planM, min = a.weapon.minM;
  const inRange = (p: XY) => { const r = Math.hypot(p.x - C.x, p.y - C.y); return r <= plan && r >= min; };
  const rows: Check[] = [];
  const what = `${a.name} (${a.guns} x ${a.weapon.name}, planning range ${km(plan)}${min ? `, min ${km(min)}` : ''})`;
  if (recipe.task === 'attack') {
    const fup = items.find((i) => i.role === 'fup');
    const fy = fup ? centre(fup.pts).y : 0;
    const d = fy - gFront;
    const tgts = ['obj', 'loe', 'obj2'].map((r) => items.find((i) => i.role === r)).filter((i): i is NonNullable<typeof i> => !!i);
    const far = tgts.flatMap((t) => t.pts).reduce((m, p) => Math.max(m, Math.hypot(p.x - C.x, p.y - C.y)), 0);
    const out = tgts.filter((t) => !t.pts.every(inRange)).map((t) => t.role === 'loe' ? 'the LOE' : t.role === 'obj2' ? 'Obj 2' : 'the Obj');
    const inBand = d >= a.band[0] - 1 && d <= a.band[1] + 1;
    const st: CheckState = out.length ? 'fail' : inBand ? 'pass' : 'warn';
    rows.push({ name: 'Arty reach', st, reason: `${what}: its gun area ${fmtM(Math.max(0, d))} behind the FUP (${km(a.band[0])}-${km(a.band[1])}: ${a.bandSrc}); ${out.length ? `${out.join(' and ')} out of range: the guns forward, or a longer gun` : `the Obj${tgts.some((t) => t.role === 'loe') ? ' and the LOE' : ''} in range, the furthest point ${km(far)} from the guns`}` });
  } else {
    const fdl = items.find((i) => i.role === 'fdl');
    const frontY = fdl ? Math.max(...fdl.pts.map((p) => p.y)) : 0;
    const d = frontY - gFront;
    const beyond = Math.max(0, plan - (frontY - C.y));
    const df = items.filter((i) => i.role === 'dfTgt' && i.pts.length);
    const dfOut = df.filter((t) => !inRange(t.pts[0])).length;
    const fupOk = enemyFupM === null || beyond >= enemyFupM;
    const inBand = d >= a.band[0] - 1 && d <= a.band[1] + 1;
    const st: CheckState = dfOut || !fupOk ? 'warn' : inBand ? 'pass' : 'warn';
    rows.push({ name: 'Arty reach', st, reason: `${what}: its gun area ${fmtM(Math.max(0, d))} behind the FDL (${km(a.band[0])}-${km(a.band[1])}: ${a.bandSrc}); its guns reach ${km(beyond)} beyond the FDL${enemyFupM !== null ? `, ${fupOk ? 'past' : 'short of'} his FUP ${km(enemyFupM)} out` : ''}${df.length ? `; ${df.length - dfOut} of ${df.length} DF Tgts in range` : ''}${a.band[1] < a.band[0] ? `; no band: a third of its range (${km(a.band[1])}) is short of the ${km(a.band[0])} it must stand back: a longer gun` : !inBand ? `; outside the band${d < a.band[0] ? ': too near the front, he overruns it early (OoW I p 70)' : ': too far back, the fire does not reach deep'}` : ''}` });
  }
  if (f && g) {
    // the bundle's Gun Position going (rules.json profiles.gun): water, marsh, built-up, too steep are no place for guns
    const going = g.going('gun');
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let n = 0, ok = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const w = toWorld(f, { x: x0 + ((i + 0.5) / 5) * (x1 - x0), y: y0 + ((j + 0.5) / 5) * (y1 - y0) });
      const c = g.cls(w.x, w.y);
      if (c === null) continue;
      n++;
      if (!going.nogo.has(c)) ok++;
    }
    const share = n ? ok / n : null;
    const st: CheckState = share === null || n < 13 ? 'unchecked' : share >= a.room[0] ? 'pass' : share >= a.room[1] ? 'warn' : 'fail';
    rows.push({ name: 'Gun area', st, reason: `${share === null || n < 13 ? 'its ground not loaded' : `${Math.round(share * 100)} % of it is ground a gun position may take (the bundle's Gun Position going); ${Math.round(a.room[0] * 100)} % wanted, under ${Math.round(a.room[1] * 100)} % the guns cannot keep 100 m apart (GunDoctrine room)${st === 'fail' ? ': move it, J does not move a gun area' : ''}`}; ${a.areaSrc}. Level, crest, firm soil, access and concealment: site it with Gun Deployment` });
  }
  return rows;
}
