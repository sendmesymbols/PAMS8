/**
 * PlanContext.ts — PURE. Who attacks and what ground the plan stands on (PlanDoctrine `enemy`, `terrain`):
 *
 * - the enemy's echelon sets how wide an approach must be to carry him (IPB: he attacks on the corridors of the level
 *   below him) and the force ratio; his type (Inf / Mech / Armd) sets the going his approaches use, how fast he comes
 *   and where his FUP lies;
 * - the kind of ground (plains, obstacle, desert, mountains) sets the frontage a unit may hold, the gaps accepted, the
 *   layout Auto tries first, the foot rates and the flanks.
 *
 * No ArcGIS, no DOM. Reading the kind of ground off the bundle is `detectTerrain` in PlanFit.ts (it needs the frames).
 */
import type { DoctrineSet } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckState } from './PlanSolve';

export type EnemyType = 'inf' | 'mech' | 'armd';
export type TerrainKind = 'plains' | 'obstacle' | 'desert' | 'mountain';

export interface EnemySpec {
  /** 2525D echelon code: '15' Coy, '16' Bn, '18' Bde, '21' Div. */
  echelon: string;
  type: EnemyType;
  /** Set by the user, read from enemy symbols on the map, or the doctrinal default (one level up). */
  source: 'user' | 'default' | 'symbols' | 'plan';
  note?: string;
}

export interface TerrainSpec {
  kind: TerrainKind;
  /** Chosen by the user, read off the bundle (auto), read from symbols (a DCB drawn in front), or assumed (no data). */
  source: 'user' | 'auto' | 'symbols' | 'assumed' | 'plan';
  why?: string;
}

/** Echelons by level: Pl, Coy, Bn, Bde, Div, Corps (a Regt / Gp counts as a Bn). */
export const BY_LEVEL = ['14', '15', '16', '18', '21', '22'];
const LEVEL: Record<string, number> = { '14': 0, '15': 1, '16': 2, '17': 2, '18': 3, '21': 4, '22': 5 };
export const levelOf = (ech: string | null | undefined): number | null => (ech != null && ech in LEVEL ? LEVEL[ech] : null);
export const TERRAIN_KINDS: TerrainKind[] = ['plains', 'obstacle', 'desert', 'mountain'];
export const ENEMY_TYPES: EnemyType[] = ['inf', 'mech', 'armd'];

const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

export function echelonLabel(doc: DoctrineSet, ech: string | null | undefined): string {
  if (!ech) return '?';
  return String(doctrineAt(doc, `enemy.levels.${ech}.label`) ?? ech);
}

/** The echelon n levels above (or below) this one. */
export function echelonUp(ech: string, n: number): string {
  const l = levelOf(ech) ?? 2;
  return BY_LEVEL[Math.max(0, Math.min(BY_LEVEL.length - 1, l + n))];
}

/**
 * The enemy when the user has not said: in defence one level up (he attacks at 3 : 1), mechanised (infantry in the
 * mountains); in attack the defender one level down (own 3 : 1 on him), infantry.
 */
export function defaultEnemy(doc: DoctrineSet, ownEch: string, terrain?: TerrainKind | null, task: string = 'defence'): EnemySpec {
  const up = num(doc, 'enemy.defaultUp', 1);
  if (task === 'attack') return { echelon: echelonUp(ownEch, -up), type: 'inf', source: 'default' };
  // the ground's own enemy where its book gives one (mountains: infantry, MW pp 238-239; desert: armour led, DW pp 10-12)
  const kt = terrain ? doctrineAt(doc, `terrain.kinds.${terrain}.enemyType`) : undefined;
  const type = (kt ?? doctrineAt(doc, 'enemy.defaultType')) as EnemyType;
  return { echelon: echelonUp(ownEch, up), type: ENEMY_TYPES.includes(type) ? type : 'mech', source: 'default' };
}

/** Width of one mobility corridor of the level below the enemy's echelon: what he attacks on (IPB pp 7, 12). */
export function enemyCorridorM(doc: DoctrineSet, ech: string): number {
  return num(doc, `enemy.corridorM.${ech}`, 500);
}

/** The largest enemy echelon an approach this wide at its narrowest carries (its corridors fit), or null. */
export function approachCarries(doc: DoctrineSet, widthM: number): string | null {
  for (const e of [...BY_LEVEL].reverse()) {
    if (levelOf(e)! < 1) continue;
    if (widthM + 1 >= enemyCorridorM(doc, e)) return e;
  }
  return null;
}

export function enemyProfile(doc: DoctrineSet, type: EnemyType): 'dismounted' | 'tracked' {
  return doctrineAt(doc, `enemy.types.${type}.profile`) === 'dismounted' ? 'dismounted' : 'tracked';
}

/** What leads the enemy's move: "lead tanks", "leading infantry". */
export function enemyMover(doc: DoctrineSet, type: EnemyType): string {
  return String(doctrineAt(doc, `enemy.types.${type}.mover`) ?? 'leading troops');
}

/** Own troops on foot over this kind of ground, GO and SLOW-GO km/h by day. */
export function footKmh(doc: DoctrineSet, kind: TerrainKind): { go: number; slow: number } {
  return { go: num(doc, `terrain.kinds.${kind}.footKmh.go`, num(doc, 'moves.footKmh.go', 4)), slow: num(doc, `terrain.kinds.${kind}.footKmh.slow`, num(doc, 'moves.footKmh.slow', 2.4)) };
}

/** The enemy's leading element: infantry at the foot rates for the ground, vehicles at the IPB vehicle rates. */
export function enemyKmh(doc: DoctrineSet, type: EnemyType, kind: TerrainKind): { go: number; slow: number } {
  if (enemyProfile(doc, type) === 'dismounted') return footKmh(doc, kind);
  return { go: num(doc, 'moves.tankKmh.go', 24), slow: num(doc, 'moves.tankKmh.slow', 16) };
}

/** Where the enemy forms up in front of the FDL (IBB p201 infantry 1000-1200 m, p214 tanks 2500-3000 m). */
export function enemyFupM(doc: DoctrineSet, type: EnemyType): [number, number] {
  const r = resolveRange(doc, doctrineAt(doc, `enemy.types.${type}.fupFromFdlM`));
  return r ?? (enemyProfile(doc, type) === 'dismounted' ? [1000, 1200] : [2500, 3000]);
}

export function strengthOf(doc: DoctrineSet, ech: string | null | undefined): number {
  if (!ech) return 0;
  return Number(doctrineAt(doc, `enemy.levels.${ech}.strength`)) || 0;
}

const r1 = (x: number) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

/**
 * The force ratio row. Defence: the enemy's strength against the plan's (3 : 1 is the attack a unit plans to hold;
 * two levels up is more than it holds alone). Attack: own against the defender, the usual 3 : 1 superiority (IBB S47
 * para 17 a p 248); in mountains comparatively more than the conventional 3 : 1, reached in sequence (MW p 80, no
 * figure printed): there an attack passes only above 3 : 1. Strengths may be given (counted from the symbols);
 * otherwise each side's echelon. `kind` the ground (null: not known, read as plains).
 */
/** Both sides from the ORBAT (PlanOrbat.forceFromOrbat): manoeuvre Coys and how to name each. */
export interface ForceSides { ownS?: number; enS?: number; ownName?: string; enName?: string }

export function forceRow(doc: DoctrineSet, task: 'defence' | 'attack', ownEch: string | null, en: EnemySpec, ownS?: number, enS?: number, names: ForceSides = {}, kind: TerrainKind | null = null): Check {
  const want = num(doc, 'enemy.ratio.attackerWants', 3);
  const mtn = kind === 'mountain';
  const rule = mtn ? `MW p 80 wants comparatively more than the conventional ${want} : 1 in mountains, reached in sequence (most troops in reserve at first)` : `the usual ${want} : 1 superiority (IBB S47 para 17 a p 248)`;
  const o = ownS ?? strengthOf(doc, ownEch), e = enS ?? strengthOf(doc, en.echelon);
  const typeLabel = String(doctrineAt(doc, `enemy.types.${en.type}.label`) ?? en.type);
  const enName = names.enName ? `en ${names.enName}, ${typeLabel}` : `en ${echelonLabel(doc, en.echelon)} (${typeLabel})`;
  const from = en.source === 'symbols' ? ', read from the enemy symbols' : en.source === 'plan' ? ', as the plan was built for' : en.source === 'default' ? `, assumed one level ${task === 'attack' ? 'down' : 'up'}: set it in step 2` : '';
  const vs = names.ownName ? ` against the ${names.ownName}` : '';
  const armour = en.type === 'armd' && names.enName ? '; the En tanks count only as Sqns here: they weigh more (E)' : '';
  if (!o || !e) return { name: 'En force', st: 'unchecked', reason: `${enName}${from}: the plan's own echelon is not known` };
  if (task === 'attack') {
    const r = o / e;
    // as written: off the mountains 3 : 1 (a rounding margin of 5 %), in them more than 3 : 1
    const st: CheckState = (mtn ? r > want : r >= want * 0.95) ? 'pass' : r >= want * 0.66 ? 'warn' : 'fail';
    return { name: 'Force ratio', st, reason: `about ${r1(r)} : 1${names.ownName ? `, the ${names.ownName},` : ''} on the ${enName}${from}; ${rule}${st === 'pass' ? '' : st === 'warn' ? (mtn && r >= want * 0.95 ? ': add a sub-unit, or build the ratio up phase by phase from the reserve' : ': mass fire on the Obj or take it in phases') : ': too weak for a deliberate attack here'}` };
  }
  const r = e / o;
  if (r > want * 2) return { name: 'En force', st: 'warn', reason: `${enName}${from}${vs}: about ${r1(r)} : 1, more than this plan holds alone. It is one locality of a bigger defence: depth and reserves beyond it, or a delay${armour}` };
  if (r >= want * 0.66) return { name: 'En force', st: 'pass', reason: `${enName}${from}${vs}: about ${r1(r)} : 1, the attack this plan is laid to hold (the attacker wants ${mtn ? `more than ${want} : 1 in mountains, MW p 80` : `${want} : 1, IBB p 248`})${armour}` };
  return { name: 'En force', st: 'pass', reason: `${enName}${from}${vs}: about ${r1(r)} : 1, short of the ${want} : 1 a deliberate attack wants: expect a probe, raid or infiltration${armour}` };
}

/**
 * The frontage the plan's echelon may hold on this ground: [min, max] and its source. For a Bn plan, `nFwd` picks the
 * IBB row (two / three Coys up) when the recipe gives none (Check my plan).
 */
export function frontageAllowance(doc: DoctrineSet, planEch: string, kind: TerrainKind, nFwd = 2): { range: [number, number]; src: string } | null {
  const row = (unit: string) => {
    const r = (doc.ocoka?.frontage?.rows ?? []).find((x: any) => x.unit === unit);
    const fr = r ? resolveRange(doc, r.frontageM) : null;
    return fr ? { range: fr, src: `${unit}: ${r.src}` } : null;
  };
  const lit = (path: string, src: string) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? { range: r, src } : null; };
  switch (planEch) {
    case '14': return lit('check.posnFrontageM.14', 'Pl 600 m (IBB Annex U App 5 p 480; AMP p 1.3: most 500 m); not extended on any ground (IBB S59 para 6 b p 326)');
    case '15': return lit('size.coy.frontageM', 'Coy 1200-1500 m (AMP p 1.10; IBB Annex U App 6 p 481: 1500 m); not extended on any ground (IBB S59 para 6 b p 326)');
    case '16': {
      // an obstacle: IBB Annex V's own row (2750-4115 m); the desert and the mountains: the extended rows (no figure in
      // DW or MW); the plains: two / three up, else the normal 3000-5000 m (IBB S53 para 4 c p 277)
      const t = doctrineAt(doc, `terrain.kinds.${kind}.bnFrontageRow`);
      if (typeof t === 'string') return row(t);
      return row(nFwd >= 3 ? 'Battalion, three companies up' : nFwd === 2 ? 'Battalion, two companies up' : 'Battalion, normal frontage in the plains');
    }
    case '18': return kind === 'obstacle' ? lit('terrain.kinds.obstacle.bdeFrontageM', 'Bde on an obstacle (GSP 1947 s26 p 119: 8-10 km on a ditch cum bund)') : lit('check.posnFrontageM.18', 'Bde 10-12 km (OOW1 Annexes B-D pp 103-105, a yardstick)');
    case '21': return kind === 'obstacle' ? lit('terrain.kinds.obstacle.divFrontageM', 'Inf Div on an obstacle (no own figure printed: the Foxland (En) Div of IC s113 p 658, E)') : lit('check.posnFrontageM.21', 'Inf Div (OOW1 Annexes C-D pp 104-105: a Bde of 10-12 km on each axis, calc)');
    default: return null;
  }
}

/**
 * A frontage other than a Bn's against its row on this ground. A Coy or Pl is never extended (IBB S59 para 6 b p 326):
 * beyond its row it fails on any ground. A Bde or Div on extended ground (the desert, DW p 56; the mountains, MW p 148)
 * has no printed figure there: beyond the row it warns, never fails. Null when the echelon has no row.
 */
export function frontageRowCheck(doc: DoctrineSet, planEch: string, kind: TerrainKind, nFwd: number, frontageM: number): Check | null {
  const al = frontageAllowance(doc, planEch, kind, nFwd);
  if (!al) return null;
  const held = `${fmtM(frontageM)} held by ${nFwd} forward posn${nFwd === 1 ? '' : 's'}`;
  if (frontageM <= al.range[1] + 1) return { name: 'Frontage', st: 'pass', reason: `${held}; ${al.src} allows ${fmtM(al.range[1])}` };
  if ((planEch === '18' || planEch === '21') && extendedGround(doc, kind)) {
    const why = kind === 'desert' ? 'defence in the desert extends over a wide front and accepts large gaps (DW p 56)' : 'frontages in mountains are generally large, with large gaps (MW p 148)';
    return {
      name: 'Frontage', st: 'warn',
      reason: `${held}: beyond ${al.src}'s ${fmtM(al.range[1])}; ${why}, but no ${planEch === '18' ? 'Bde' : 'Div'} figure is printed for it: judge it`,
      detail: { head: `Extended frontage, ${fmtM(frontageM)}`, why: `${why[0].toUpperCase()}${why.slice(1)}. The books print no figure for a ${planEch === '18' ? 'Bde' : 'Div'} on this ground.`, fix: ['Hold the key areas firmly and cover the gaps by mobile troops, mines, fire and patrols', `Or bring the front in to ${fmtM(al.range[1])} (${al.src})`] },
    };
  }
  const never = planEch === '15' || planEch === '14' ? '; a Coy or Pl frontage is never extended (IBB S59 para 6 b p 326)' : '';
  return { name: 'Frontage', st: 'fail', reason: `${held}: beyond the ${fmtM(al.range[1])} ${al.src} allows${never}` };
}

/** Ground where defence goes on extended frontages (the desert: DW pp 24, 56; the mountains: MW pp 148, 150). */
export const extendedGround = (doc: DoctrineSet, kind: TerrainKind): boolean => doctrineAt(doc, `terrain.kinds.${kind}.extendedFrontage`) === true;
/** Ground where large gaps between localities are accepted (the desert: OOW1 s22 p 68, DW p 56; the mountains: MW p 148). */
export const gapsAccepted = (doc: DoctrineSet, kind: TerrainKind): boolean => doctrineAt(doc, `terrain.kinds.${kind}.gapsAccepted`) === true;

/**
 * A Bn's frontage on this ground. In the plains a Bn normally holds 3000-5000 m (IBB S53 para 4 c p 277): inside it
 * passes. An extended frontage (IBB S59 p 325, Annex U Apps 6-7: two Coys up 4500 m, three up 6500 m) is for approaches
 * widely apart or short resources: in the plains it warns, saying what it costs; on extended ground (the desert, DW pp
 * 24, 56; the mountains, MW pp 148, 150; neither prints a figure, so IBB's extended rows hold) it passes. Beyond the
 * extended row it fails. An obstacle keeps its own row (IBB Annex V, frontageAllowance). Null when no row is found.
 */
export function bnFrontageCheck(doc: DoctrineSet, kind: TerrainKind, nFwd: number, frontageM: number): Check | null {
  const ext = frontageAllowance(doc, '16', kind, Math.max(2, nFwd));
  if (!ext) return null;
  const held = `${fmtM(frontageM)} held by ${nFwd} forward posn${nFwd === 1 ? '' : 's'}`;
  if (kind === 'obstacle' || extendedGround(doc, kind)) {
    const why = kind === 'desert' ? 'the desert is extended ground (DW p 24, p 56)' : kind === 'mountain' ? 'mountain frontages are generally large (MW p 148, p 150)' : 'on an obstacle';
    return frontageM <= ext.range[1] + 1
      ? { name: 'Frontage', st: 'pass', reason: `${held}; ${why}: ${ext.src} allows ${fmtM(ext.range[1])}; the Coys are not extended, the gaps grow (IBB S59 p 326)` }
      : { name: 'Frontage', st: 'fail', reason: `${held}: beyond the ${fmtM(ext.range[1])} allowed even on extended ground (${ext.src})` };
  }
  const normal = resolveRange(doc, doctrineAt(doc, 'terrain.bnNormalFrontageM'));
  if (normal && frontageM <= normal[1] + 1) return { name: 'Frontage', st: 'pass', reason: `${held}; a Bn in the plains normally holds ${fmtM(normal[0])}-${fmtM(normal[1])} (IBB S53 para 4 c p 277)` };
  if (frontageM <= ext.range[1] + 1) {
    return {
      name: 'Frontage', st: 'warn',
      reason: `${held}: an extended frontage (${ext.src} up to ${fmtM(ext.range[1])}), beyond the plains' normal ${normal ? `${fmtM(normal[0])}-${fmtM(normal[1])}` : '3-5 km'} (IBB p 277)`,
      detail: {
        head: `Extended frontage, ${fmtM(frontageM)} in the plains`,
        why: 'IBB S59 p 325: a Bn goes on an extended frontage only when the approaches to be held are widely apart or the resources are short. It costs command and control, more and mobile protective detachments, a reserve hard to place, thin artillery cover, more infiltration through bigger gaps (IBB S59 para 2 pp 325-326).',
        fix: ['Bring the forward posns in to 5 km or less', 'Or keep it, where the approaches are widely apart: hold the key areas firmly, cover the gaps by mines, fire, observation and patrols, dig additional posns in the localities, and keep the larger gaps where a Bde reserve can act (IBB S59 paras 5-7 pp 326-327)'],
      },
    };
  }
  return { name: 'Frontage', st: 'fail', reason: `${held}: beyond the extended frontage too (${ext.src}: ${fmtM(ext.range[1])}; plains normal ${normal ? fmtM(normal[1]) : '5 km'}, IBB p 277)` };
}

/**
 * What the ground's own books add to rows already judged: mountains (MW), the desert (DW), by night (MIB, DW). The text
 * is appended to the row's reason; a verdict changes only where the book sets the general figure aside (the FUP band in
 * mountains: MW p 85). Rows not present are left alone. Run last, once every row is in (the build, the fit, Check my plan).
 */
export function groundNotes(rows: Check[], doc: DoctrineSet, kind: TerrainKind, task: string, planEch: string, night: boolean | null): Check[] {
  void doc; void planEch;
  const out = rows.map((r) => ({ ...r }));
  const add = (name: string, text: string) => { for (const r of out.filter((x) => x.name === name)) if (!r.reason.includes(text)) r.reason += `; ${text}`; };
  // the FUP: no classic FUP in mountains; in broken ground and BUAs nearer than the plains' band
  for (const fup of out.filter((r) => r.name === 'FUP from the Obj')) {
    if (kind === 'mountain') {
      fup.st = 'unchecked';
      fup.reason = `${fup.m != null ? `${fmtM(fup.m)} to the near edge` : fup.reason}: in mountains there is no classic FUP, only a designated place crossed at H, reached by more than one route and as close as cover allows (MW pp 83, 85); with En NVDs form up beyond his effective MG range, behind cover (MW p 228). The plains' 1000-1200 m (IBB p 201) does not apply: confirm it on the ground`;
    } else if (fup.st === 'warn' && fup.m != null && fup.limitM != null && fup.m < fup.limitM) fup.reason += '; in broken ground and BUAs the distance may be reduced (IBB p 203)';
  }
  if (task !== 'attack') {
    add('Reserve reach', 'the C Pen posns: a Coy minus at Bn level (IBB p 308), occupied not later than 1.5-2 h after H at Bn, 3 h at Bde (p 310); a Coy that sends troops to one keeps at least a third on its own task (p 311); the oblique depth Coy rather than the one behind (p 313)');
    if (kind === 'mountain') add('Reserve reach', 'mountains: reserves are normally split for the vast frontages (MW p 148); above Bn level not from one central place, and reinforcing from quieter localities may beat a counter-attack (MW pp 165, 169); kept as far forward as possible (OOW1 p 72)');
    if (kind === 'desert') {
      // the Bde and Div reserves employed as early as possible within 2-6 h (DW pp 26-27: terrain.kinds.desert.reserveH)
      const rh = resolveRange(doc, doctrineAt(doc, 'terrain.kinds.desert.reserveH'));
      add('Reserve reach', `desert: reserves one third or more of the force, mainly armour, down to Bde (DW p 26)${Array.isArray(rh) ? `; a Bde or Div reserve employed as early as possible, within ${rh[0]}-${rh[1]} h (DW p 27)` : ''}`);
      // the share measured by the solver (Reserve share: m the share): below a third it warns (DW p 26)
      for (const r of out.filter((x) => x.name === 'Reserve share' && x.m != null && x.m < 1 / 3 - 1e-6)) {
        r.st = 'warn';
        r.reason += '; in the desert one third or possibly more of the force is earmarked as reserves, mainly armour (DW p 26): short of it';
        r.detail = { head: `Reserve ${Math.round(r.m! * 100)} % of the force in the desert`, why: 'In the desert the battle is decided by the reserves: one third or possibly more of the force, mainly armour, at every level down to Bde (DW pp 26-27).', fix: ['Take a forward unit into reserve and hold the front on a wider frontage (extended frontages are the rule in the desert, DW p 24)', 'Ask for armour to be grouped as the reserve'] };
      }
    }
  }
  if (kind === 'desert') add('Arty reach', 'desert: towed guns stick in loose sand (SP guns ideal, trailers cannot be towed); DF targets on the reverse slopes of high, steep dunes cannot be engaged; air burst is better (DW pp 60-61); several alternative gun areas (OOW1 p 70)');
  if (kind === 'mountain') add('Arty reach', 'mountains: towed guns by single gun or section near hairpin bends, a Bty in 2-3 places; one ground observer per Inf Coy; concentrations, not barrages; harassing fire on passes and defiles (MW pp 240-246)');
  if (task === 'attack') add('Arty reach', 'keep about a third of the ammunition for opportunity targets and DF (MIB p 108)');
  if (kind === 'mountain') add('Air lift', 'mountains: the helicopter load falls with altitude; fly back well before last light; helicopters for emergencies only (MW p 263)');
  if (task === 'attack' && night) {
    add('Tank timing', 'by night tanks never go among the dismounted infantry without night-fighting kit: without it they fire the plan and join on the Obj once it is secured, or before first light (MIB p 140)');
    if (kind === 'desert') add('Tank timing', 'in the desert at night the tanks are under command of the attacking infantry (DW p 48)');
  }
  if (kind === 'desert') {
    add('Mech breach', 'desert: TAMs may work on the dhars but are likely to fail on soft sand (DW p 65)');
    add('Mines in time', 'desert: mechanical mine laying fails in loose sand: lay by MML on the dhars and by hand on soft sand; the wind shifts and uncovers mines (DW p 65)');
  }
  if (task === 'attack') {
    // the FUP: an alternative always selected and known to all, secured by night; in dead ground, square to the Obj, not a
    // likely En DF task (IBB p 204 (5), p 212 e; MIB p 91)
    add('FUP from the Obj', 'an alternative FUP must always be selected and known to all ranks (IBB p 204), selected and secured in a deliberate night attack (IBB p 212); the FUP in dead ground, square to the Obj and not a likely En DF task (MIB p 91)');
    // the layout: depth or abreast by the Obj, the En and the ground (MIB s19 pp 103-106)
    add('Form of attack', 'one up (in depth) for a deep Obj, a vague En, flank security, restrictive ground or poor visibility; two or three up (abreast) for a shallow, strongly held Obj, secure flanks, several apchs and ample fire (MIB pp 103-106)');
    // against a strong point (OOW2 s12 pp 44-46; MW p 104)
    add('Force ratio', 'against a strong point or fortified Obj: a greater ratio of troops to task, attack at more than one point by the most difficult approach, the point isolated by smoke from the fire of the others (OOW2 pp 45-46; MW p 104)');
  }
  if (kind === 'mountain') for (const n of ['Ph 2 timing', 'Ph 3 timing']) add(n, 'mountains: fresh troops for each phase, a unit used not recycled before 48-72 h (OOW2 p 60; MW pp 210-215); liberal timings (MW p 82)');
  return out;
}

/**
 * An attack's assault frontage by day and by night on this ground. `nightMaxM` is the assault row's figure, a night
 * figure (IBB S47 para 17 a p 248: a Coy 250 m, a Bn two up 450-650 m; a Bde GSP p 86). Never a fail: the books print
 * no day figure outside the desert.
 * - The desert (DW s12 para 18 a p 47: by night the frontage and depth are half the day's, wider in bright moonlight):
 *   by day twice the row passes; by night the row is the limit; with the light not known the night limit passes and up
 *   to the day's warns.
 * - The mountains (MW p 79; GSP s19 para 12 a p 86, para 12 e p 87: limited, narrower than open ground, not specified):
 *   the night row is the most by day and by night; wider warns.
 * - The plains and an obstacle: by night (or the light not known) the row is the limit; by day a wider frontage is
 *   allowed (OOW2 s9 para 2 c p 36; GSP p 86: open terrain wider at unit level) but no figure is printed: wider warns
 *   "judge it", never fails.
 */
export function assaultFrontageCheck(doc: DoctrineSet, kind: TerrainKind, night: boolean | null, wM: number, nightMaxM: number, rowSrc: string): Check | null {
  if (kind !== 'desert') {
    const w = `${fmtM(wM)} wide`;
    const lim = fmtM(nightMaxM);
    if (kind === 'mountain') {
      const mw = 'in mountains the frontages of attack are limited, narrower than on open ground (MW p 79; GSP s19 para 12 a p 86, para 12 e p 87: not specified)';
      if (wM <= nightMaxM + 1) return { name: 'Assault frontage', st: 'pass', reason: `${w}; the night row's ${lim} (${rowSrc}) is the most by day and by night: ${mw}` };
      return { name: 'Assault frontage', st: 'warn', reason: `${w}: beyond the night row's ${lim} (${rowSrc}); ${mw}`, detail: { head: `Assault ${w} in mountains`, why: `${mw[0].toUpperCase()}${mw.slice(1)}. Concentration comes from attacking from several directions at once (MW p 80), not from a wide front.`, fix: [`Narrow the assault to ${lim}`, 'Or attack the Obj from the front, a flank and the rear at once on separate approaches (MW p 80)'] } };
    }
    const day = 'by day a wider frontage is allowed (OOW2 s9 para 2 c p 36: at night frontages are kept relatively narrow compared with a day attack; GSP s19 para 12 a p 86: open terrain wider at unit level), but no day figure is printed';
    if (wM <= nightMaxM + 1) return { name: 'Assault frontage', st: 'pass', reason: `${w}; ${night === false ? 'by day, inside' : night ? 'by night' : 'the night figure'} ${lim} (${rowSrc})${night === false ? `; ${day}` : ''}` };
    if (night === false) return { name: 'Assault frontage', st: 'warn', reason: `${w} by day: beyond the night row's ${lim} (${rowSrc}); ${day}: judge it on the ground` };
    return {
      name: 'Assault frontage', st: 'warn',
      reason: `${w}: beyond the night row's ${lim} (${rowSrc})${night === null ? `; it holds by day only, ${day}` : ''}`,
      detail: { head: `Assault ${w}${night ? ' by night' : ''}`, why: `By night a Coy assaults on 250 m and a Bn two up on 450-650 m (IBB S47 para 17 a p 248); ${day}.`, fix: [`Narrow the assault to ${lim} by night`, 'Or attack by day, judging the wider frontage on the ground'] },
    };
  }
  const f = num(doc, 'attack.desertNightOfDay', 0.5);
  const dayMax = nightMaxM / (f > 0 ? f : 0.5);
  const w = `${fmtM(wM)} wide`;
  const dw = 'in the desert a night attack takes half the frontage and depth of a day attack, more in bright moonlight (DW s12 para 18 a p 47)';
  if (night === false) {
    return wM <= dayMax + 1
      ? { name: 'Assault frontage', st: 'pass', reason: `${w}; by day up to ${fmtM(dayMax)}: twice the night row's ${fmtM(nightMaxM)} (${rowSrc}); ${dw}` }
      : { name: 'Assault frontage', st: 'warn', reason: `${w}: beyond ${fmtM(dayMax)} even by day (twice the night row's ${fmtM(nightMaxM)}, ${rowSrc}; DW p 47)` };
  }
  if (wM <= nightMaxM + 1) return { name: 'Assault frontage', st: 'pass', reason: `${w}; ${night ? 'by night' : 'the night figure'} ${fmtM(nightMaxM)} (${rowSrc})${night ? `: ${dw}` : `; by day up to ${fmtM(dayMax)} (DW p 47)`}` };
  const fix = [`Narrow the assault to ${fmtM(nightMaxM)} by night`, 'Or attack by day, or by bright moonlight (DW p 47: then wider), where the air situation allows (DW p 47: night attacks against well-prepared posns for want of covered approaches)'];
  if (night === null && wM <= dayMax + 1) return { name: 'Assault frontage', st: 'warn', reason: `${w}: inside the day's ${fmtM(dayMax)} but beyond the night's ${fmtM(nightMaxM)} (${rowSrc}): it holds by day or in bright moonlight only (DW p 47)`, detail: { head: `Assault ${fmtM(wM)} wide, by day only`, why: `${dw[0].toUpperCase()}${dw.slice(1)}.`, fix } };
  return { name: 'Assault frontage', st: 'warn', reason: `${w}: beyond the night's ${fmtM(nightMaxM)} (${rowSrc}); ${dw}`, detail: { head: `Assault ${fmtM(wM)} wide by night`, why: `${dw[0].toUpperCase()}${dw.slice(1)}.`, fix } };
}

/**
 * The solver's geometry rows for this ground: the frontage (a Bn by bnFrontageCheck: normal in the plains, extended in
 * the desert and the mountains; an obstacle or a Bde / Div by its row), the gaps (accepted where the ground says so:
 * the desert, OOW1 s22 p 68, DW p 56; the mountains, MW p 148), plus the ground and the enemy as rows of their own.
 */
export function applyContext(rows: Check[], doc: DoctrineSet, planEch: string, task: string, frontageM: number, nFwd: number, enemy: EnemySpec | null, terrain: TerrainSpec | null, force: ForceSides = {}, night: boolean | null = null): Check[] {
  const out = rows.map((r) => ({ ...r }));
  const kind = terrain?.kind ?? 'plains';
  // an attack: the assault frontage by day or by night on this ground (IBB p 248; DW p 47; MW p 79; OOW2 p 36)
  if (task === 'attack' && terrain) {
    const af = out.find((r) => r.name === 'Assault frontage');
    if (af && af.m != null && af.limitM != null) {
      const v = assaultFrontageCheck(doc, kind, night, af.m, af.limitM, af.limitSrc ?? 'the assault row');
      if (v) Object.assign(af, v);
    }
  }
  if (task !== 'attack' && terrain) {
    const fr = out.find((r) => r.name === 'Frontage');
    // a canal or ditch defence is held to its own book row on the obstacle (PlanSolve; IBB S61 p 333)
    const onCanal = !!fr && /held on the obstacle/.test(fr.reason);
    const bn = fr && frontageM > 0 && planEch === '16' && kind !== 'obstacle' && !onCanal ? bnFrontageCheck(doc, kind, nFwd, frontageM) : null;
    if (fr && bn) Object.assign(fr, bn);
    else {
      // a Coy or Pl on any ground (never extended, IBB p 326); a Bde / Div off the plains, with the leeway extended
      // ground gives it (no figure printed); the plains keep the recipe's own row
      const byRow = planEch === '15' || planEch === '14' || (kind !== 'plains' && kind !== 'desert') || ((planEch === '18' || planEch === '21') && kind === 'desert');
      const v = fr && frontageM > 0 && byRow ? frontageRowCheck(doc, planEch, kind, nFwd, frontageM) : null;
      if (fr && v && (v.st !== 'pass' || fr.st !== 'pass')) Object.assign(fr, v);
    }
    if (gapsAccepted(doc, kind)) {
      const src = kind === 'mountain' ? 'large gaps go with the large frontages in mountains (MW p 148)' : 'large gaps are accepted in the desert (OOW1 s22 p68; DW p 56)';
      for (const r of out.filter((x) => (x.name === 'Gaps' || x.name === 'Mutual support') && x.st === 'warn')) {
        r.st = 'pass';
        r.reason += `; ${src}: screen them with mobile troops, mines, fire and patrols`;
      }
    }
  }
  if (terrain) out.unshift(terrainRow(doc, terrain));
  if (enemy) out.unshift(forceRow(doc, task === 'attack' ? 'attack' : 'defence', planEch, enemy, force.ownS, force.enS, force, terrain?.kind ?? null));
  return out;
}

export function terrainLabel(doc: DoctrineSet, kind: TerrainKind): string {
  return String(doctrineAt(doc, `terrain.kinds.${kind}.label`) ?? kind);
}

export function terrainRow(doc: DoctrineSet, t: TerrainSpec): Check {
  const label = terrainLabel(doc, t.kind);
  const why = t.why ? `: ${t.why}` : '';
  switch (t.source) {
    case 'user': return { name: 'Terrain', st: 'pass', reason: `${label}, as set${why}` };
    case 'auto': return { name: 'Terrain', st: 'pass', reason: `${label}, read from the terrain${why}` };
    case 'symbols': return { name: 'Terrain', st: 'pass', reason: `${label}, from the symbols drawn${why}` };
    case 'plan': return { name: 'Terrain', st: 'pass', reason: `${label}${t.why ? `, ${t.why}` : ', as the plan was built'}` };
    default: return { name: 'Terrain', st: 'unchecked', reason: `${label}, assumed${why || ': no terrain data'}` };
  }
}

/** The layout Auto tries first on this ground (it only orders the list; the score card decides). */
export function firstLayout(doc: DoctrineSet, kind: TerrainKind): string | null {
  const v = doctrineAt(doc, `terrain.kinds.${kind}.firstLayout`);
  return typeof v === 'string' ? v : null;
}
