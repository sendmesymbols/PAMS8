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

export interface OrbatSet {
  /** inf.json units (and any other own arm files added). */
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

const find = (list: any[], id: string | null | undefined) => (id ? list.find((u) => u.id === id) ?? null : null);
const NOT_MANOEUVRE = /\bhq\b|adm|cbt sp|\bsp\b|sp coy|sup|sig|wksp|tpt|amb|ord|eme|asc|engr|\bfd coy|def & emp|def and emp|\bint\b|\bfs\b|\brp\b|pro\b|med\b|mor\b|tk tptr|ghatak|\batt\b|arty|art\b|\bfd regt|med regt|\bad\b|lat\b|hat\b|r&s|recce|svy|met\b|aop|dental|surg|mule|animal|postal|\bpu\b|\bgl sec|vet|rvc/i;
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

/** Manoeuvre Coys / Sqns down a unit's children. A child not printed is judged from its role (E). */
function coysOf(list: any[], u: any, depth = 0): number {
  if (!u || depth > 6) return 0;
  const text = `${u.name ?? ''} ${u.type ?? ''} ${u.subtype ?? ''}`;
  // a service or support unit is no manoeuvre unit, whatever Coys it has (an ASC Bn's transport Coys)
  if (NOT_MANOEUVRE.test(text)) return 0;
  if (u.echelon === '15') return MANOEUVRE.test(text) ? 1 : 0;
  if (u.children?.length) return u.children.reduce((a: number, c: any) => a + (Number(c.count) || 1) * childCoys(list, c, depth), 0);
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
  const isAtgm = (w: { id: string | null; name: string }) => /atgm|\bbs\b|baktar|tow|milan|konkurs|\bnag\b|spandrel|sagger|fagot|hj-?8|red arrow/i.test(`${w.id ?? ''} ${w.name}`);
  const isRr = (w: { id: string | null; name: string }) => /106\s*mm\s*rr|106mm-rr|recoilless/i.test(`${w.id ?? ''} ${w.name}`);
  const atgm = ws.filter(isAtgm).map(line), rr = ws.filter(isRr).map(line);
  const mortars = ws.filter((w) => /\bmor\b|mortar|-mor\b/i.test(`${w.id ?? ''} ${w.name}`) && !/2 ?inch|2"|60/.test(w.name)).map(line);
  const mgs = ws.filter((w) => w.id === 'mg-1a3' || /mg ?1 ?a ?3|mgia3/i.test(w.name));
  for (const a of atgm.filter((x) => x.rangeM === null)) notes.push(`${a.name}: no range in weapons.json`);
  if (!ws.length) notes.push('no weapons printed for it or its children');
  const veh: any[] = u.vehicles ?? [];
  const apcs = veh.filter((v) => /\bapc|bmp|icv|ifv\b/i.test(String(v.name))).reduce((a, v) => a + (Number(v.count) || 0), 0);
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

/** Own infantry Bn types for the Task step: each with its manoeuvre Coys and whether it is mounted. */
export function ownBnTypes(o: OrbatSet): { id: string; name: string; coys: number; mounted: boolean }[] {
  return o.own.filter((u) => u.arm === 'inf' && u.type === 'bn' && !/coast|ssg/i.test(u.id))
    .map((u) => { const b = brief(o, u.id)!; return { id: u.id, name: b.name, coys: b.coys, mounted: b.mounted }; });
}

/** The unit in one line: all ranks, Coys, the weapons the rules use, mounted or not, and the source. */
export function unitLine(b: UnitBrief): string {
  const km = (m: number | null) => (m === null ? '?' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
  const w = (l: WeaponLine[]) => l.map((x) => `${x.count} ${x.name.replace(/ Wpn Sys| Launcher/g, '')} (${km(x.rangeM)})`).join(', ');
  const parts = [
    b.strength ? `${b.strength.toLocaleString('en-GB')} all ranks` : null,
    `${b.coys} ${b.side === 'en' ? 'manoeuvre' : 'rifle'} Coys${b.plsPerCoy ? ` of ${b.plsPerCoy} Pls` : ''}`,
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
export function forceFromOrbat(own: UnitBrief | null, en: UnitBrief | null): { ownS?: number; enS?: number; ownName?: string; enName?: string } {
  return {
    ownS: own?.coys || undefined, enS: en?.coys || undefined,
    ownName: own ? `${own.name} (${own.coys} rifle Coys)` : undefined,
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
export function minefieldRow(o: OrbatSet, doc: DoctrineSet, frontageM: number, own: UnitBrief | null): Check | null {
  const t = (o.engrData ?? []).find((x: any) => /Mine Laying - Planning Data: Manual/i.test(String(x?.title)));
  const row = t?.rows?.find((r: any) => r.Condition === 'Engr Pl' && /mixed/i.test(String(r.Cluster)));
  const perPl = Number(row?.['Max in 24 hrs']);
  if (!perPl || !(frontageM > 0)) return null;
  const ready = resolveRange(doc, doctrineAt(doc, 'readyBy.coyPosnH')) ?? [24, 36];
  const clusters = Math.round(frontageM);
  const coyH = Math.round((clusters / (3 * perPl)) * 24);
  const rifles = own ? Math.max(1, Math.round(own.coys * (own.plsPerCoy ?? 3))) : 0;
  const ownH = rifles ? Math.round((clusters / (rifles * perPl * 0.5)) * 24) : null;
  const st = coyH <= ready[1] ? 'pass' : 'warn';
  return {
    name: 'Mines in time', st,
    reason: `protective minefield along ${(frontageM / 1000).toFixed(1)} km of front, about ${clusters.toLocaleString('en-GB')} mixed clusters: one Engr Fd Coy (3 Pls at ${perPl} in 24 h, SO's Hbk p 439) about ${coyH} h${ownH !== null ? `; the ${rifles} rifle Pls alone, at half that, about ${ownH} h` : ''}; posns ready in ${ready[0]}-${ready[1]} h (IBB)${st === 'warn' ? ': ask for more engineers or the MML (a Fd Coy with 6 MMLs lays 9000 m of ATMs in 24 h, p 439)' : ''}`,
  };
}
