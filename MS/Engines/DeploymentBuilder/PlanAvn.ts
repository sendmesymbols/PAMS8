/**
 * PlanAvn.ts — PURE. The air lift of the Air Aslt Bn by the Air Aslt Sqn, from the ORBAT (avn.json, inf.json,
 * weapons.json: SO's Hbk 2019 Sec 7 pp 701-715, the Air Aslt Bn pp 621-622) and PlanDoctrine `airAslt` (E).
 *
 * - the troops lifted: the Bn HQ, the four STCs and the Cbt Sp Coy (the Adm Pl comes by road);
 * - the Sqn's lift a wave: its Air Aslt Hels (the Bell 412, the only type with the Air Aslt role, pp 706-708: 9 troops)
 *   and its Cargo Sp Flt (a type the book does not fix: `airAslt.cargoHel`, E);
 * - the waves, the round trip at the hel's cruise speed over `pzLzKm` with `groundMin` on the ground, and the build-up:
 *   how long after the first wave lands the Bn is complete, against `buildUpMaxH`. The first wave against one STC.
 *
 * No ArcGIS, no DOM, so Node can test it.
 */
import type { DoctrineSet } from './PlanRecipes';
import { doctrineAt } from './PlanRecipes';
import type { Check, CheckState } from './PlanSolve';
import type { OrbatSet } from './PlanOrbat';

export interface AirLiftHel { what: string; count: number; type: string; troops: number; kmh: number; assumed: boolean }
export interface AirLift {
  sqn: string;
  hels: AirLiftHel[];
  perWave: number;
  /** Who is lifted, and how many. */
  lifted: { name: string; n: number }[];
  troops: number;
  /** One STC: the first wave is held against it. */
  coy: number;
  waves: number;
  pzLzKm: number;
  groundMin: number;
  turnMin: number;
  buildH: number;
  maxH: number;
  src: string;
}

const val = (doc: DoctrineSet, p: string, fb: number) => { const v = Number(doctrineAt(doc, p)); return isFinite(v) && v > 0 ? v : fb; };
/** Troops a hel carries: its load line's "9 CT" (combat troops), else its sitting cas. */
const troopsOf = (W: any) => Number(String(W?.load ?? '').match(/(\d+)\s*CT\b/)?.[1]) || Number(W?.loadCasEvac?.casSitting) || 0;

const pg = (p: unknown) => `${/[-,]/.test(String(p)) ? 'pp' : 'p'} ${p ?? '?'}`;

/** Is this the Air Aslt Bn (inf.json `inf-bn-air-aslt`)? */
export const isAirAslt = (unitId: string | null | undefined) => !!unitId && /air-aslt/.test(unitId) && /^inf-bn/.test(unitId);

/** The Air Aslt Bn's lift by the Air Aslt Sqn; null for another unit or when the ORBAT lacks the Sqn or the types. */
export function airLiftOf(o: OrbatSet, unitId: string | null | undefined, doc: DoctrineSet): AirLift | null {
  if (!isAirAslt(unitId)) return null;
  const bn = o.own.find((u) => u.id === unitId), sqn = o.own.find((u) => u.id === 'avn-sqn-air-aslt');
  if (!bn || !sqn) return null;
  const W = (id: string) => o.weapons.find((w) => w.id === id);
  // the types by role (avnData pp 706-708): the Air Aslt Hel is the one Air Aslt type
  const roles: any[] = (o.avnData ?? []).find((t: any) => /by possible role/i.test(t.title ?? ''))?.rows ?? [];
  const aslt = roles.find((r) => /^Air Aslt$/i.test(r.role))?.weapons?.[0] ?? 'bell-412';
  const cargo = String(doctrineAt(doc, 'airAslt.cargoHel') ?? 'bell-412');
  const hels: AirLiftHel[] = [];
  for (const c of sqn.children ?? []) {
    const f = c.unit ? o.own.find((u) => u.id === c.unit) : null;
    if (!f) continue;
    for (const e of [...(f.weapons ?? []), ...(f.equipment ?? [])]) {
      const what = String(e.name);
      const isA = /Air Aslt Hel/i.test(what), isC = /Cargo Hel/i.test(what);
      if (!isA && !isC) continue;
      const w = W(isA ? aslt : cargo);
      if (!w) continue;
      const count = (Number(e.count) || 0) * (Number(c.count) || 1);
      const prev = hels.find((h) => h.what === what);
      if (prev) prev.count += count;
      else hels.push({ what, count, type: String(w.name), troops: troopsOf(w), kmh: Number(w.cruiseSpeedKmph) || 200, assumed: isC });
    }
  }
  if (!hels.length) return null;
  // who flies: the Bn HQ and the fighting Coys (the Adm Pl by road)
  const lifted: { name: string; n: number }[] = [];
  let coy = 0;
  for (const c of bn.children ?? []) {
    if (/Adm/i.test(String(c.role))) continue;
    const u = c.unit ? o.own.find((x) => x.id === c.unit) : null;
    const each = Number(u?.strength?.total ?? c.strength?.total) || 0;
    if (!each) continue;
    const k = Number(c.count) || 1;
    lifted.push({ name: k > 1 ? `${k} ${c.role}s` : String(c.role), n: each * k });
    if (/STC/.test(String(c.role))) coy = each;
  }
  const troops = lifted.reduce((s, x) => s + x.n, 0);
  const perWave = hels.reduce((s, h) => s + h.count * h.troops, 0);
  if (!troops || !perWave) return null;
  const pzLzKm = val(doc, 'airAslt.pzLzKm', 25), groundMin = val(doc, 'airAslt.groundMin', 10), maxH = val(doc, 'airAslt.buildUpMaxH', 2);
  // the slowest type sets the wave's pace
  const kmh = Math.min(...hels.map((h) => h.kmh));
  const turnMin = Math.round((2 * pzLzKm / kmh) * 60 + groundMin);
  const waves = Math.ceil(troops / perWave);
  return {
    sqn: String(sqn.name).replace(/\s*\(.*\)$/, ''), hels, perWave, lifted, troops, coy, waves, pzLzKm, groundMin, turnMin,
    buildH: ((waves - 1) * turnMin) / 60, maxH,
    src: `SO's Hbk 2019 ${pg(sqn.page)} (${sqn.id}), pp 706-708 types and loads, ${pg(bn.page)} (${bn.id})`,
  };
}

/**
 * The Air lift row: the Sqn's lift a wave, the waves for the Bn, the build-up on the LZ against `buildUpMaxH` (warn
 * beyond it), and the first wave against one STC (warn when it cannot land a whole Coy).
 */
export function airLiftRow(l: AirLift): Check {
  const helTxt = l.hels.map((h) => `${h.count} ${h.what}s (${h.type}${h.assumed ? ', taken: E' : ''}: ${h.troops} troops)`).join(' + ');
  const short = l.perWave < l.coy;
  const slow = l.buildH > l.maxH + 1e-9;
  const st: CheckState = short || slow ? 'warn' : 'pass';
  return {
    name: 'Air lift',
    st,
    reason: `${l.sqn}: ${helTxt} = ${l.perWave} a wave. The Bn's ${l.troops} (${l.lifted.map((x) => `${x.name} ${x.n}`).join(', ')}; the Adm Pl by road) in ${l.waves} wave${l.waves > 1 ? 's' : ''}; a round trip ${l.turnMin} min at ${l.pzLzKm} km PZ to LZ and ${l.groundMin} min on the ground (E): the Bn complete ${l.buildH.toFixed(1)} h after the first wave lands (${l.maxH} h allowed, E)${slow ? ': a second Sqn, a nearer PZ, or the Cargo Flt as Mi-17s (24 troops)' : ''}; the first wave ${l.perWave} against an STC of ${l.coy}${short ? ': less than a Coy lands at once' : ''}. ${l.src}`,
  };
}
