/**
 * PlanOrbat.ts — PURE. The ORBAT (MS/Data/Orbat/PK, from SO's Hbk 2019, RESTD) in the Intelligent Deployment tab:
 *
 * - what a unit holds: its manoeuvre Coys / Sqns counted down its children, Pls per Coy, all ranks, its weapons with
 *   their ranges (weapons.json planRangeM), APCs (mounted or not);
 * - the enemy's unit for an echelon and type (en.json, Sec 13 Threat);
 * - the force ratio from both (manoeuvre Coys against manoeuvre Coys, not the level table);
 * - the ranges the rules use (BOF's RR, mortars, MG mutual support, ATGM) from the unit's own weapons;
 * - the time to lay the protective minefield at the engineer rates (engr.json engrData, p 439).
 *
 * The data is passed in (the tab fetches it; Node reads the files), so nothing here loads anything. A unit or a
 * figure the extraction does not have is said so and the doctrine figure is kept.
 */
import type { DoctrineSet } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check } from './PlanSolve';
import type { EnemyType, TerrainKind } from './PlanContext';
import { minesByEngr, type EngrType } from './PlanEngr';

export interface OrbatSet {
  /** Own units: every arm file as one list (mergeOwn over OWN_ORBAT_FILES); inf.json alone still works. */
  own: any[];
  /** en.json units. */
  en: any[];
  /** weapons.json weapons. */
  weapons: any[];
  /** engr.json engrData (planning tables). */
  engrData?: any[];
}

export interface WeaponLine { id: string | null; name: string; count: number; rangeM: number | null }

export interface UnitBrief {
  id: string;
  name: string;
  side: 'own' | 'en';
  echelon: string;
  /** All ranks as printed (or the children's sum when every child is printed); null when not given. */
  strength: number | null;
  /** Manoeuvre Coys / Sqns (rifle, mech, AFV ...), counted down the children; support, HQ and services left out. */
  coys: number;
  plsPerCoy: number | null;
  atgm: WeaponLine[];
  rr: WeaponLine[];
  mortars: WeaponLine[];
  mgEffM: number | null;
  mgCount: number;
  /** APCs / ICVs in its vehicles. */
  apcs: number;
  mounted: boolean;
  src: string;
  /** What the extraction lacks for it (and what was assumed instead). */
  notes: string[];
}

/** The own arm files of the ORBAT, merged in this order: inf.json must be there, the others add to it. */
export const OWN_ORBAT_FILES = ['inf.json', 'armr.json', 'arty.json', 'ad.json', 'engr.json', 'sig.json', 'avn.json', 'log.json', 'mov.json'];

/**
 * The own units of every arm as one list, so a child kept in another arm's file is found (an Inf Bde's Sig Coy, the
 * Indep Mech Inf Bde Gp's Armr Regt). An id met twice keeps the first; a file that is missing adds nothing.
 */
export function mergeOwn(lists: (any[] | null | undefined)[]): any[] {
  const seen = new Set<string>(), out: any[] = [];
  for (const l of lists) for (const u of l ?? []) {
    if (!u?.id || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

const find = (list: any[], id: string | null | undefined) => (id ? list.find((u) => u.id === id) ?? null : null);
const NOT_MANOEUVRE = /\bhq\b|adm|cbt sp|\bsp\b|sp coy|sup|s ?& ?t\b|sig|wksp|tpt|amb|ord|eme|asc|engr|\bfd coy|def & emp|def and emp|\bint\b|\bfs\b|\brp\b|pro\b|med\b|mor\b|tk tptr|ghatak|\batt\b|arty|art\b|\bfd regt|med regt|\bad\b|lat\b|hat\b|r&s|recce|svy|met\b|aop|dental|surg|mule|animal|postal|\bpu\b|\bgl sec|vet|rvc/i;
const MANOEUVRE = /inf|mech|mib|armd|armr|afv|\btk\b|tank|cdo|rifle|stc|aslt|mjd|ranger|wing|mtn|\bcoy\b|sqn/i;

function weaponRange(o: OrbatSet, wid: string | null): number | null {
  const w = wid ? o.weapons.find((x) => x.id === wid) : null;
  const r = w?.planRangeM;
  if (!r) return null;
  const v = r.eff ?? r.max ?? r.plan ?? null;
  return typeof v === 'number' ? v : null;
}

/** A unit's weapons: as printed for it, else its children's times their counts. */
function weaponsOf(o: OrbatSet, list: any[], u: any, depth = 0): { id: string | null; name: string; count: number }[] {
  if (!u || depth > 6) return [];
  if (Array.isArray(u.weapons) && u.weapons.length) return u.weapons.map((w: any) => ({ id: w.weapon ?? null, name: String(w.name ?? ''), count: Number(w.count) || 0 }));
  const out = new Map<string, { id: string | null; name: string; count: number }>();
  for (const c of u.children ?? []) {
    const cu = find(list, c.unit);
    for (const w of weaponsOf(o, list, cu, depth + 1)) {
      const key = w.id ?? w.name;
      const k = out.get(key);
      const n = w.count * (Number(c.count) || 1);
      if (k) k.count += n; else out.set(key, { ...w, count: n });
    }
  }
  return [...out.values()];
}

/** A unit's APCs / ICVs: as printed for it, else its children's times their counts (a Mech Bde Gp's are its MIBs'). */
function apcsOf(list: any[], u: any, depth = 0): number {
  if (!u || depth > 6) return 0;
  if (Array.isArray(u.vehicles) && u.vehicles.length) return u.vehicles.filter((v: any) => /\bapc|bmp|icv|ifv\b/i.test(String(v?.name))).reduce((a: number, v: any) => a + (Number(v.count) || 0), 0);
  return (u.children ?? []).reduce((a: number, c: any) => a + (Number(c.count) || 1) * apcsOf(list, find(list, c.unit), depth + 1), 0);
}

/** Manoeuvre Coys / Sqns down a unit's children. A child not printed is judged from its role (E). */
function coysOf(list: any[], u: any, depth = 0): number {
  if (!u || depth > 6) return 0;
  const text = `${u.name ?? ''} ${u.type ?? ''} ${u.subtype ?? ''}`;
  // a service or support unit is no manoeuvre unit, whatever Coys it has (an ASC Bn's transport Coys)
  if (NOT_MANOEUVRE.test(text)) return 0;
  // asked of a unit below a Coy itself: a rifle Pl is a third of a Coy (as roleCoys), a section none
  if (depth === 0 && Number(u.echelon) < 15) return u.echelon === '14' && MANOEUVRE.test(text) ? 1 / 3 : 0;
  if (u.echelon === '15') return MANOEUVRE.test(text) ? 1 : 0;
  if (u.children?.length) {
    // the Armd Div lists its Armr Regts and MIBs itself and its Armd Bdes with no contents of their own: the Bdes are made of
    // those Regts, so counting them as 12 Coys each would count the same Sqns again
    const listsRegts = u.echelon === '21' && u.children.some((c: any) => /armr regt/i.test(String(find(list, c.unit)?.name ?? '')));
    return u.children.reduce((a: number, c: any) => a + (Number(c.count) || 1) * (listsRegts && !find(list, c.unit) && /armd bde/i.test(String(c.role)) ? 0 : childCoys(list, c, depth)), 0);
  }
  if (NOT_MANOEUVRE.test(text) || !MANOEUVRE.test(text)) return 0;
  // no children printed: an infantry or mech Bn its 4 Coys, an armd Regt its 3 Sqns (E, from the printed ones)
  return roleCoys(text, u.echelon);
}
function childCoys(list: any[], c: any, depth: number): number {
  const cu = find(list, c.unit);
  if (cu) return coysOf(list, cu, depth + 1);
  return NOT_MANOEUVRE.test(String(c.role ?? '')) || !MANOEUVRE.test(String(c.role ?? '')) ? 0 : roleCoys(String(c.role), null);
}
function roleCoys(text: string, ech: string | null): number {
  if (/\bdiv\b/i.test(text) || ech === '21') return 36;
  if (/\bbde\b/i.test(text) || ech === '18') return 12;
  if (/regt|\bbn\b|mib|wing/i.test(text) || ech === '16' || ech === '17') return /armr|armd|afv|tk/i.test(text) ? 3 : 4;
  if (/coy|sqn|stc/i.test(text) || ech === '15') return 1;
  if (/\bpl\b|\btp\b/i.test(text) || ech === '14') return 1 / 3;
  return 0;
}
function strengthOf(list: any[], u: any, depth = 0): number | null {
  if (!u || depth > 6) return null;
  const t = Number(u.strength?.total);
  if (Number.isFinite(t) && t > 0) return t;
  if (!u.children?.length) return null;
  let sum = 0;
  for (const c of u.children) { const s = strengthOf(list, find(list, c.unit), depth + 1); if (s === null) return null; sum += s * (Number(c.count) || 1); }
  return sum || null;
}

/** What a unit holds, from the ORBAT. Null when the id is not there. */
export function brief(o: OrbatSet, id: string | null | undefined): UnitBrief | null {
  const ownU = find(o.own, id), enU = ownU ? null : find(o.en, id);
  const u = ownU ?? enU;
  if (!u) return null;
  const list = ownU ? o.own : o.en;
  const notes: string[] = [];
  const ws = weaponsOf(o, list, u);
  const line = (w: { id: string | null; name: string; count: number }): WeaponLine => ({ ...w, rangeM: weaponRange(o, w.id) });
  const isAtgm = (w: { id: string | null; name: string }) => /atgm|\bbs\b|baktar|\btow\b|milan|konkurs|\bnag\b|spandrel|sagger|fagot|hj-?8|red arrow/i.test(`${w.id ?? ''} ${w.name}`);
  const isRr = (w: { id: string | null; name: string }) => /106\s*mm\s*rr|106mm-rr|recoilless/i.test(`${w.id ?? ''} ${w.name}`);
  const atgm = ws.filter(isAtgm).map(line), rr = ws.filter(isRr).map(line);
  const mortars = ws.filter((w) => /\bmor\b|mortar|-mor\b/i.test(`${w.id ?? ''} ${w.name}`) && !/2 ?inch|2"|60/.test(w.name)).map(line);
  const mgs = ws.filter((w) => w.id === 'mg-1a3' || /mg ?1 ?a ?3|mgia3/i.test(w.name));
  for (const a of atgm.filter((x) => x.rangeM === null)) notes.push(`${a.name}: no range in weapons.json`);
  if (!ws.length) notes.push('no weapons printed for it or its children');
  const apcs = apcsOf(list, u);
  // Pls per Coy: the first manoeuvre Coy's Pls
  let pls: number | null = null;
  const coyChild = u.echelon === '15' ? u : (u.children ?? []).map((c: any) => find(list, c.unit)).find((cu: any) => cu && cu.echelon === '15' && coysOf(list, cu) === 1);
  if (coyChild) pls = (coyChild.children ?? []).filter((c: any) => /\bpl\b/i.test(String(c.role)) && !NOT_MANOEUVRE.test(String(c.role))).reduce((a: number, c: any) => a + (Number(c.count) || 1), 0) || null;
  const hasCoyChildren = (u.children ?? []).length > 0;
  if (!hasCoyChildren && u.echelon !== '15') notes.push('its children are not printed: its Coys judged from its type (E)');
  return {
    id: u.id, name: String(u.name ?? u.id), side: ownU ? 'own' : 'en', echelon: String(u.echelon ?? ''),
    strength: strengthOf(list, u), coys: Math.round(coysOf(list, u) * 100) / 100, plsPerCoy: pls,
    atgm, rr, mortars, mgEffM: mgs.length ? weaponRange(o, 'mg-1a3') : null, mgCount: mgs.reduce((a, w) => a + w.count, 0),
    apcs, mounted: apcs > 0,
    src: `SO's Hbk 2019${ownU ? '' : ' Sec 13'} p ${u.page ?? '?'} (${u.id})`, notes,
  };
}

/** The own unit for a plan: the recipe's, else the standard one for its echelon. */
export function ownUnitFor(ech: string, preferred?: string | null): string {
  if (preferred) return preferred;
  return ({ '14': 'inf-pl-std-rifle', '15': 'inf-coy-std-rifle', '16': 'inf-bn-std', '18': 'inf-bde', '21': 'inf-div' } as Record<string, string>)[ech] ?? 'inf-bn-std';
}

/** The enemy's unit for an echelon and type (Sec 13 Threat). */
export function enUnitFor(ech: string, type: EnemyType, kind?: TerrainKind | null): string | null {
  const T: Record<string, Record<EnemyType, string>> = {
    '15': { inf: 'en-inf-coy', mech: 'en-inf-coy', armd: 'en-armd-regt-afv-sqn' },
    '16': { inf: 'en-inf-bn', mech: 'en-mech-inf-bn', armd: 'en-armd-regt' },
    '18': { inf: 'en-iib', mech: 'en-rapid-inf-bde', armd: 'en-iab' },
    '21': { inf: kind === 'mountain' ? 'en-mtn-div' : 'en-inf-div', mech: 'en-rapid-def', armd: 'en-armd-div' },
  };
  return T[ech]?.[type] ?? null;
}

/** An own Bn-sized infantry type the Task step offers. */
export interface OwnType {
  id: string;
  name: string;
  /** Its manoeuvre Coys. */
  coys: number;
  mounted: boolean;
  /** Its rifle Coy and that Coy's rifle Pl (ORBAT ids), for a Coy or Pl plan of this type; null: it has none (an AT Bn). */
  coy: string | null;
  pl: string | null;
  plsPerCoy: number | null;
}

/** A Bn-sized type's rifle Coy and that Coy's rifle Pl, down its children; null: not printed, or it has none. */
export function subUnitsOf(o: OrbatSet, typeId: string | null | undefined): { coy: string | null; pl: string | null } {
  const u = find(o.own, typeId);
  const coy = (u?.children ?? []).map((c: any) => find(o.own, c.unit)).find((cu: any) => cu && cu.echelon === '15' && coysOf(o.own, cu) === 1) ?? null;
  const pl = (coy?.children ?? []).filter((c: any) => /\bpl\b/i.test(String(c.role)) && !NOT_MANOEUVRE.test(String(c.role)))
    .map((c: any) => find(o.own, c.unit)).find((pu: any) => pu && pu.echelon === '14') ?? null;
  return { coy: coy?.id ?? null, pl: pl?.id ?? null };
}

/**
 * Own Bn-sized infantry types for the Task step: the Bns, and the FC and Rangers Wings (4 rifle Coys each, pp 642-644).
 * Each with its manoeuvre Coys, whether it is mounted, and its rifle Coy and Pl. SSG and Coast Guards are left out; so
 * is a wing with no rifle Coys (the FC Corps' Sp, HQ and Adm Wings).
 */
export function ownBnTypes(o: OrbatSet): OwnType[] {
  return o.own.filter((u) => u.arm === 'inf' && (u.type === 'bn' || u.type === 'wing') && !/coast|ssg/i.test(u.id))
    .map((u) => { const b = brief(o, u.id)!, s = subUnitsOf(o, u.id); return { id: u.id, name: b.name, coys: b.coys, mounted: b.mounted, coy: s.coy, pl: s.pl, plsPerCoy: b.plsPerCoy, wing: u.type === 'wing' }; })
    .filter((t) => !t.wing || t.coys > 0)
    .map(({ wing: _wing, ...t }) => t);
}

/** An anti-tank Bn (LAT, HAT): its ATGM Coys are grouped out to the Bns and Bdes, not laid as a Bn plan. */
export interface AtType {
  id: string;
  name: string;
  /** Its ATGM Coys, and the launchers in each (the Bn's printed total shared out). */
  coys: number;
  launchersPerCoy: number;
  /** One AT Coy's name and all ranks. */
  coyName: string;
  coyStrength: number | null;
  /** The ATGM Pls in one of its Coys (2: LAT and HAT), and one Pl's launchers and all ranks. */
  plsPerCoy: number;
  launchersPerPl: number;
  plStrength: number | null;
}

/** The AT Bns in the ORBAT: Bn-sized infantry with no rifle Coy and ATGM launchers (LAT APC, LAT Jeep, HAT). */
export function ownAtTypes(o: OrbatSet): AtType[] {
  const out: AtType[] = [];
  for (const u of o.own) {
    if (u.arm !== 'inf' || u.type !== 'bn' || /coast|ssg/i.test(u.id)) continue;
    const b = brief(o, u.id)!;
    const launchers = b.atgm.reduce((a, w) => a + w.count, 0);
    if (b.coys > 0 || !launchers) continue;
    const kids = (u.children ?? []).map((c: any) => ({ c, cu: find(o.own, c.unit) })).filter((x: any) => x.cu && x.cu.echelon === '15' && !NOT_MANOEUVRE_HQ.test(String(x.c.role)));
    const n = kids.reduce((a: number, x: any) => a + (Number(x.c.count) || 1), 0);
    if (!n) continue;
    const coyU = kids[0].cu;
    const plKids = (coyU.children ?? []).filter((c: any) => /atgm pl|hat pl/i.test(String(c.role)));
    const plsPerCoy = plKids.reduce((a: number, c: any) => a + (Number(c.count) || 1), 0) || 2;
    const plU = plKids.length ? find(o.own, plKids[0].unit) : null;
    const perCoy = Math.round(launchers / n);
    out.push({ id: u.id, name: b.name, coys: n, launchersPerCoy: perCoy, coyName: String(coyU.name), coyStrength: Number(coyU.strength?.total) || null, plsPerCoy, launchersPerPl: Math.round(perCoy / plsPerCoy), plStrength: Number(plU?.strength?.total) || null });
  }
  return out;
}
const NOT_MANOEUVRE_HQ = /\bhq\b|adm|sp coy/i;

/**
 * A unit with ATGM Coys of an AT Bn grouped to it (LAT, HAT), or `byPl` its ATGM Pls (a Coy defence: 2 a Coy): their
 * launchers added to its own, so the ATGM pairs sited on the tank approaches and the AT cover row count them. Its Coys,
 * rifle Coy count and reserve are not changed.
 */
export function withAtGroup(o: OrbatSet, unit: UnitBrief | null, atId: string | null | undefined, coys: number, byPl = false): UnitBrief | null {
  const at = atId ? ownAtTypes(o).find((t) => t.id === atId) : null;
  if (byPl) return withAtPls(o, unit, at, coys);
  const k = Math.max(0, Math.min(at?.coys ?? 0, Math.round(coys)));
  const ab = at ? brief(o, at.id) : null;
  if (!unit || !at || !ab || !k) return unit;
  const line = ab.atgm[0];
  const add: WeaponLine = { id: line?.id ?? null, name: (line?.name ?? 'ATGM').replace(/ Wpn Sys.*| Launcher.*/, ''), count: at.launchersPerCoy * k, rangeM: line?.rangeM ?? null };
  // "LAT Coy (APC borne)" in the plural: "LAT Coys (APC borne)"
  const coyText = k > 1 ? at.coyName.replace(/^(.*?)( \(.*\))?$/, '$1s$2') : at.coyName;
  const notes = [...unit.notes, `${k} ${coyText} grouped to it: ${add.count} ${add.name} (the ${at.name}'s ${ab.atgm.reduce((a, w) => a + w.count, 0)} shared out over its ${at.coys} Coys)`];
  return {
    ...unit,
    name: `${unit.name} + ${k} ${coyText}`,
    strength: unit.strength !== null && at.coyStrength ? unit.strength + k * at.coyStrength : unit.strength,
    atgm: [...unit.atgm, add],
    src: `${unit.src}; ${ab.src}`,
    notes,
  };
}

/** ATGM Pls of an AT Bn's Coy grouped to a unit (a Coy defence): up to the Pls in one Coy, the Pl's launchers each. */
function withAtPls(o: OrbatSet, unit: UnitBrief | null, at: AtType | null | undefined, n: number): UnitBrief | null {
  const k = Math.max(0, Math.min(at?.plsPerCoy ?? 0, Math.round(n)));
  const ab = at ? brief(o, at.id) : null;
  if (!unit || !at || !ab || !k) return unit;
  const line = ab.atgm[0];
  const add: WeaponLine = { id: line?.id ?? null, name: (line?.name ?? 'ATGM').replace(/ Wpn Sys.*| Launcher.*/, ''), count: at.launchersPerPl * k, rangeM: line?.rangeM ?? null };
  const what = `${k} ATGM Pl${k > 1 ? 's' : ''} (${at.coyName})`;
  return {
    ...unit,
    name: `${unit.name} + ${what}`,
    strength: unit.strength !== null && at.plStrength ? unit.strength + k * at.plStrength : unit.strength,
    atgm: [...unit.atgm, add],
    src: `${unit.src}; ${ab.src}`,
    notes: [...unit.notes, `${what} grouped to it: ${add.count} ${add.name} (a Coy's ${at.launchersPerCoy} shared over its ${at.plsPerCoy} ATGM Pls)`],
  };
}

/** The tank Sqn of an Armr Regt (armr.json, p 107-108, 111): what the tanks with an attack are. */
export interface TankSqn {
  id: string;
  name: string;
  /** Tanks in the Sqn (SHQ's 2 and the Tps'), the Tps and the tanks in each. */
  tanks: number;
  tps: number;
  tpTanks: number;
  /** The Armr Regt's tanks (44), when it prints them; null when the Regt is not in the list. */
  regtTanks: number | null;
  src: string;
}

/** The tank Sqn from the ORBAT, counted down its children and vehicles; null when the Armr files are not loaded. */
export function tankSqnOf(o: OrbatSet, id = 'armr-sqn-tk'): TankSqn | null {
  const u = find(o.own, id);
  if (!u) return null;
  const tks = (x: any): number => (x?.vehicles ?? []).filter((v: any) => /^tks?$/i.test(String(v?.name).trim())).reduce((a: number, v: any) => a + (Number(v.count) || 0), 0);
  const tpKid = (u.children ?? []).find((c: any) => find(o.own, c.unit)?.echelon === '14');
  const tp = tpKid ? find(o.own, tpKid.unit) : null;
  const tanks = tks(u);
  if (!tanks) return null;
  const regt = find(o.own, 'armr-regt');
  return { id: u.id, name: String(u.name), tanks, tps: tpKid ? Number(tpKid.count) || 1 : 0, tpTanks: tks(tp), regtTanks: regt ? tks(regt) || null : null, src: `SO's Hbk 2019 p ${u.page ?? '?'} (${u.id})` };
}

/**
 * The Recce Sqn of the Recce Regt (armr.json p 109-112): SHQ's tanks and its AFV Tps' (11), its Rifle Tps and their APCs
 * (4 a Tp, p 112), counted down its children; null when the armour file is not loaded.
 */
export function recceSqnOf(o: OrbatSet): { name: string; tanks: number; afvTps: number; rifleTps: number; apcs: number; src: string } | null {
  const u = find(o.own, 'armr-recce-sqn');
  if (!u) return null;
  // gun tanks only ("Tks", "Tks (SHQ)"), not the Adm Tp's "Tk Dozer"
  const tks = (vs: any[] | undefined) => (vs ?? []).filter((v: any) => /^tks?(\s*\(|$)/i.test(String(v?.name).trim())).reduce((a: number, v: any) => a + (Number(v.count) || 0), 0);
  let tanks = 0, afvTps = 0, rifleTps = 0, apcs = 0;
  for (const c of u.children ?? []) {
    const n = Number(c.count) || 1, cu = find(o.own, c.unit);
    if (cu && /afv tp/i.test(String(c.role))) { afvTps += n; tanks += n * tks(cu.vehicles); continue; }
    tanks += n * tks(c.vehicles);
    if (/rifle tp/i.test(String(c.role))) { rifleTps += n; apcs += n * (c.vehicles ?? []).filter((v: any) => /apc/i.test(String(v?.name))).reduce((a: number, v: any) => a + (Number(v.count) || 0), 0); }
  }
  return { name: String(u.name), tanks, afvTps, rifleTps, apcs, src: `SO's Hbk 2019 p ${u.page ?? '?'} (${u.id})` };
}

/** The Sqn in a line: its tanks and Tps, the Regt it comes from. */
export function tankSqnText(s: TankSqn): string {
  return `${s.tanks} tanks${s.tps ? ` (${s.tps} Tps of ${s.tpTanks}${s.tanks - s.tps * s.tpTanks > 0 ? `, SHQ ${s.tanks - s.tps * s.tpTanks}` : ''})` : ''}${s.regtTanks ? `, from an Armr Regt of ${s.regtTanks}` : ''}`;
}

/** Own formation types for a Div plan (Inf Div, Armd Div): manoeuvre Coys / Sqns and whether it is mounted. */
export function ownDivTypes(o: OrbatSet): { id: string; name: string; coys: number }[] {
  return o.own.filter((u) => u.type === 'div' && (u.arm === 'inf' || u.arm === 'armr') && Number(u.echelon) === 21)
    .map((u) => { const b = brief(o, u.id)!; return { id: u.id, name: b.name, coys: b.coys }; })
    .sort((a, b) => Number(b.id === 'inf-div') - Number(a.id === 'inf-div'));
}

/** Whether a type suits a plan of an echelon: a Bn plan wants `need` Coys, a Coy plan a rifle Coy of `need` Pls, a Pl plan a rifle Pl. */
export function typeFits(t: OwnType, ech: string, need: number): boolean {
  if (ech === '16') return t.coys === need;
  if (ech === '15') return !!t.coy && (t.plsPerCoy ?? need) === need;
  if (ech === '14') return !!t.pl;
  return false;
}

/** Own Bde types for a Bde plan (Inf Bde, IIBG, Indep Mech Inf Bde Gp): manoeuvre Coys / Sqns, Bn-sized manoeuvre units, mounted or not. */
export function ownBdeTypes(o: OrbatSet): { id: string; name: string; coys: number; bns: number; mounted: boolean }[] {
  // the infantry Bdes and the armoured one (IABG: 3 Armr Regts and a MIB)
  return o.own.filter((u) => (u.arm === 'inf' || u.arm === 'armr') && u.type === 'bde' && Number(u.echelon) === 18).map((u) => {
    const b = brief(o, u.id)!;
    const bns = (u.children ?? []).reduce((a: number, c: any) => {
      const cu = find(o.own, c.unit);
      return a + (cu && (cu.echelon === '16' || cu.echelon === '17') && coysOf(o.own, cu) > 0 ? Number(c.count) || 1 : 0);
    }, 0);
    return { id: u.id, name: b.name, coys: b.coys, bns, mounted: b.mounted };
    // the Inf Bde (the one a Bde plan is laid for unless another is chosen) leads
  }).sort((a, b) => Number(b.id === 'inf-bde') - Number(a.id === 'inf-bde'));
}

/**
 * The own unit a plan is laid for. A Bn-sized type chosen (Mtn Inf Bn, MIB, a Rangers Wing ...) gives a Bn plan that
 * unit, a Coy plan its rifle Coy and a Pl plan that Coy's rifle Pl; a Bde plan takes the Bde type chosen. Without a
 * choice, or when the type has no such sub-unit, the recipe's or family's unit, else the standard one.
 */
export function unitForPlan(o: OrbatSet, ech: string, pick: { type?: string | null; bde?: string | null; div?: string | null; preferred?: string | null }): string {
  const dflt = ownUnitFor(ech, pick.preferred);
  if (ech === '18') return pick.bde && find(o.own, pick.bde) ? pick.bde : dflt;
  if (ech === '21') return pick.div && find(o.own, pick.div) ? pick.div : dflt;
  if (!pick.type || !find(o.own, pick.type)) return dflt;
  if (ech === '16') return pick.type;
  const s = subUnitsOf(o, pick.type);
  return (ech === '15' ? s.coy : ech === '14' ? s.pl : null) ?? dflt;
}

/** How a unit's Coys are named: rifle for an own Bn; manoeuvre for the enemy and for a Bde or above (its count takes in armour Sqns). */
export function coyWord(b: UnitBrief): string {
  return b.side === 'en' || Number(b.echelon) >= 18 ? 'manoeuvre' : 'rifle';
}

/** A unit's size in words: its Coys ("4 rifle Coys of 3 Pls"), a Coy by its Pls; null for a unit below a Coy. */
export function sizeText(b: UnitBrief): string | null {
  const e = Number(b.echelon);
  if (e && e < 15) return null;
  if (e === 15) return b.plsPerCoy ? `${b.plsPerCoy} Pls` : null;
  return `${b.coys} ${coyWord(b)} Coys${b.plsPerCoy ? ` of ${b.plsPerCoy} Pls` : ''}`;
}

/** The unit in one line: all ranks, Coys, the weapons the rules use, mounted or not, and the source. */
export function unitLine(b: UnitBrief): string {
  const km = (m: number | null) => (m === null ? '?' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
  const w = (l: WeaponLine[]) => l.map((x) => `${x.count} ${x.name.replace(/ Wpn Sys| Launcher/g, '')} (${km(x.rangeM)})`).join(', ');
  const parts = [
    b.strength ? `${b.strength.toLocaleString('en-GB')} all ranks` : null,
    sizeText(b),
    b.atgm.length ? w(b.atgm) : null, b.rr.length ? w(b.rr) : null, b.mortars.length ? w(b.mortars) : null,
    b.mgCount ? `${b.mgCount} MG1A3 (${km(b.mgEffM)})` : null,
    b.mounted ? `mounted (${b.apcs} APCs)` : null,
  ].filter(Boolean);
  return `${b.name}: ${parts.join('; ')} (${b.src})`;
}

/**
 * The doctrine with the ranges the rules use taken from the unit's own weapons: the BOF's 106 mm RR, the 81 mm
 * mortars, MG mutual support (twice the MG1A3's reach), the ATGM. A weapon the unit lacks keeps the doctrine figure.
 */
export function doctrineForUnit(doc: DoctrineSet, b: UnitBrief | null): DoctrineSet {
  if (!b) return doc;
  const plan = JSON.parse(JSON.stringify(doc.plan));
  const rr = b.rr.find((x) => x.rangeM), mor = b.mortars.find((x) => /81/.test(x.name) && x.rangeM) ?? b.mortars.find((x) => x.rangeM), at = b.atgm.find((x) => x.rangeM);
  if (rr) plan.attack.bofRangeMaxM = { value: rr.rangeM, basis: 'D', src: `ORBAT ${b.id}: ${rr.name} ${rr.rangeM} m (weapons.json)` };
  if (mor) plan.attack.morRangeM = { value: mor.rangeM, basis: 'D', src: `ORBAT ${b.id}: ${mor.name} ${mor.rangeM} m (weapons.json)` };
  if (b.mgEffM) plan.checkBands.mutualSupportGapMaxM = { value: 2 * b.mgEffM, basis: 'D', src: `ORBAT ${b.id}: twice the MG1A3's ${b.mgEffM} m` };
  plan.atFramework = { ...(plan.atFramework ?? {}), atgmRangeM: at ? { value: at.rangeM, basis: 'D', src: `ORBAT ${b.id}: ${at.name} ${at.rangeM} m` } : undefined };
  return { ...doc, plan };
}

/** The force from both ORBATs: manoeuvre Coys each side and the names, for PlanContext.forceRow. */
export function forceFromOrbat(own: UnitBrief | null, en: UnitBrief | null, tanks?: TankSqn | null, nSqn = 1, tp = false): { ownS?: number; enS?: number; ownName?: string; enName?: string } {
  // tank Sqns with the plan (the attack's one, a defence's one to three) count as one more manoeuvre unit each, tank Tps
  // (a Coy defence) a third of one (armour weighs more: E)
  const t = tanks && own ? Math.max(0, Math.round(nSqn)) : 0;
  const add = tp ? t / 3 : t;
  const what = tp ? `${t} Tk Tp${t > 1 ? 's' : ''} of ${tanks?.tpTanks ?? 3} tanks` : `${t} Tk Sqn${t > 1 ? 's' : ''} of ${tanks?.tanks} tanks`;
  return {
    ownS: own?.coys ? own.coys + add : undefined, enS: en?.coys || undefined,
    // a Coy or a Pl is named alone ("1 rifle Coys" says nothing); a Coy with tank Tps says so
    ownName: own ? (Number(own.echelon) <= 15 ? `${own.name}${t ? ` + ${what}` : ''}` : `${own.name} (${own.coys} ${coyWord(own)} Coys${t ? ` + ${what}` : ''})`) : undefined,
    enName: en ? `${en.name} (${en.coys} manoeuvre Coys${en.strength ? `, ${en.strength.toLocaleString('en-GB')} all ranks` : ''}; ${en.src})` : undefined,
  };
}

/** ATGM pairs the unit fields (launchers in pairs, IBB atFramework). */
export function atgmPairs(b: UnitBrief | null): number {
  if (!b) return 1;
  const n = b.atgm.reduce((a, w) => a + w.count, 0);
  return Math.max(0, Math.floor(n / 2));
}

/**
 * The protective minefield along the front in time (engr.json p 439: an Engr Pl lays 780 mixed clusters in 24 h, an
 * Inf Pl half; a mixed field 1 ATM and 1 APM a metre of front, E reading) against the time to be ready.
 */
export function minefieldRow(o: OrbatSet, doc: DoctrineSet, frontageM: number, own: UnitBrief | null, engr: EngrType | null = null): Check | null {
  const t = (o.engrData ?? []).find((x: any) => /Mine Laying - Planning Data: Manual/i.test(String(x?.title)));
  const row = t?.rows?.find((r: any) => r.Condition === 'Engr Pl' && /mixed/i.test(String(r.Cluster)));
  const perPl = Number(row?.['Max in 24 hrs']);
  if (!perPl || !(frontageM > 0)) return null;
  const ready = resolveRange(doc, doctrineAt(doc, 'readyBy.coyPosnH')) ?? [24, 36];
  const clusters = Math.round(frontageM);
  const rifles = own ? Math.max(1, Math.round(own.coys * (own.plsPerCoy ?? 3))) : 0;
  const ownH = rifles ? Math.round((clusters / (rifles * perPl * 0.5)) * 24) : null;
  const ownPart = ownH !== null ? `; the ${rifles} rifle Pls alone, at half that, about ${ownH} h` : '';
  const readyPart = `posns ready in ${ready[0]}-${ready[1]} h (IBB)`;
  const head = `protective minefield along ${(frontageM / 1000).toFixed(1)} km of front, about ${clusters.toLocaleString('en-GB')} mixed clusters`;
  if (engr) {
    // the engineers grouped to the plan (ORBAT): their Pls by hand and, with a set of 6 MMLs, the ATMs by machine
    const m = minesByEngr(engr, clusters, perPl);
    const best = [m.handH, m.mechH].filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;
    const st = best !== null && best <= ready[1] ? 'pass' : 'warn';
    const hand = m.handH !== null ? `by hand with its ${engr.pls} Pls (${perPl} mixed clusters a Pl in 24 h, SO's Hbk p 439) about ${m.handH} h` : 'no engineer Pls that lay mines';
    const mech = m.mechH !== null ? `; with its MMLs laying ATMs alongside the Pls (a set of 6: 9000 m in 24 h, p 439, ideal conditions, under trial; ${m.sets} set${m.sets > 1 ? 's' : ''}, the rest in reserve) about ${m.mechH} h (an AT belt by machine, E)` : engr.mml ? `; ${engr.mml} MML, short of a set of 6` : '';
    return { name: 'Mines in time', st, reason: `${head}: the ${engr.name} ${hand}${mech}${ownPart}; ${readyPart}${st === 'warn' ? ': more engineers, or the Div\'s Engr Bn with its MMLs' : ''}` };
  }
  const coyH = Math.round((clusters / (3 * perPl)) * 24);
  const st = coyH <= ready[1] ? 'pass' : 'warn';
  return {
    name: 'Mines in time', st,
    reason: `${head}: one Engr Fd Coy (3 Pls at ${perPl} in 24 h, SO's Hbk p 439) about ${coyH} h${ownPart}; ${readyPart}${st === 'warn' ? ': ask for more engineers or the MML (a Fd Coy with 6 MMLs lays 9000 m of ATMs in 24 h, p 439)' : ''}`,
  };
}
