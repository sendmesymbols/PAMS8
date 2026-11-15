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
  const type = (terrain === 'mountain' ? doctrineAt(doc, 'terrain.kinds.mountain.enemyType') : doctrineAt(doc, 'enemy.defaultType')) as EnemyType;
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
 * two levels up is more than it holds alone). Attack: own against the defender (MW p 80: more than 3 : 1).
 * Strengths may be given (counted from the symbols); otherwise each side's echelon.
 */
/** Both sides from the ORBAT (PlanOrbat.forceFromOrbat): manoeuvre Coys and how to name each. */
export interface ForceSides { ownS?: number; enS?: number; ownName?: string; enName?: string }

export function forceRow(doc: DoctrineSet, task: 'defence' | 'attack', ownEch: string | null, en: EnemySpec, ownS?: number, enS?: number, names: ForceSides = {}): Check {
  const want = num(doc, 'enemy.ratio.attackerWants', 3);
  const o = ownS ?? strengthOf(doc, ownEch), e = enS ?? strengthOf(doc, en.echelon);
  const typeLabel = String(doctrineAt(doc, `enemy.types.${en.type}.label`) ?? en.type);
  const enName = names.enName ? `en ${names.enName}, ${typeLabel}` : `en ${echelonLabel(doc, en.echelon)} (${typeLabel})`;
  const from = en.source === 'symbols' ? ', read from the enemy symbols' : en.source === 'plan' ? ', as the plan was built for' : en.source === 'default' ? `, assumed one level ${task === 'attack' ? 'down' : 'up'}: set it in step 2` : '';
  const vs = names.ownName ? ` against the ${names.ownName}` : '';
  const armour = en.type === 'armd' && names.enName ? '; his tanks count only as Sqns here: they weigh more (E)' : '';
  if (!o || !e) return { name: 'En force', st: 'unchecked', reason: `${enName}${from}: the plan's own echelon is not known` };
  if (task === 'attack') {
    const r = o / e;
    const st: CheckState = r >= want * 0.95 ? 'pass' : r >= want * 0.66 ? 'warn' : 'fail';
    return { name: 'Force ratio', st, reason: `about ${r1(r)} : 1${names.ownName ? `, the ${names.ownName},` : ''} on the ${enName}${from}; MW p 80 wants more than ${want} : 1${st === 'pass' ? '' : st === 'warn' ? ': mass fire on the Obj or take it in phases' : ': too weak for a deliberate attack here'}` };
  }
  const r = e / o;
  if (r > want * 2) return { name: 'En force', st: 'warn', reason: `${enName}${from}${vs}: about ${r1(r)} : 1, more than this plan holds alone. It is one locality of a bigger defence: depth and reserves beyond it, or a delay${armour}` };
  if (r >= want * 0.66) return { name: 'En force', st: 'pass', reason: `${enName}${from}${vs}: about ${r1(r)} : 1, the attack this plan is laid to hold (the attacker wants ${want} : 1, MW p 80)${armour}` };
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
    case '15': return lit('size.coy.frontageM', 'Coy 1.5 km (IBB Annex U App 6 p481); not extended on any ground (IC s84.6b)');
    case '16': {
      const t = doctrineAt(doc, `terrain.kinds.${kind}.bnFrontageRow`);
      if (typeof t === 'string') return row(t);
      return row(nFwd >= 3 ? 'Battalion, three companies up' : nFwd === 2 ? 'Battalion, two companies up' : 'Battalion, normal terrain');
    }
    case '18': return kind === 'obstacle' ? lit('terrain.kinds.obstacle.bdeFrontageM', 'Bde on an obstacle (E: IC s113 Div 60-80 km over three Bdes up)') : lit('check.posnFrontageM.18', 'Bde 10-12 km (OOW1 Annexes B-D, a yardstick)');
    case '21': return kind === 'obstacle' ? lit('terrain.kinds.obstacle.divFrontageM', 'Inf Div on an obstacle (IC s113)') : lit('check.posnFrontageM.21', 'Inf Div (IC s113)');
    default: return null;
  }
}

/**
 * The solver's geometry rows for this ground: the frontage allowance (an obstacle or mountains let a Bn hold more,
 * IC s113), the gaps (accepted in the desert, OOW1 s22 p68), plus the ground and the enemy as rows of their own.
 */
export function applyContext(rows: Check[], doc: DoctrineSet, planEch: string, task: string, frontageM: number, nFwd: number, enemy: EnemySpec | null, terrain: TerrainSpec | null, force: ForceSides = {}): Check[] {
  const out = rows.map((r) => ({ ...r }));
  const kind = terrain?.kind ?? 'plains';
  if (task !== 'attack' && terrain) {
    const fr = out.find((r) => r.name === 'Frontage');
    const al = kind !== 'plains' && kind !== 'desert' ? frontageAllowance(doc, planEch, kind, nFwd) : null;
    if (fr && al && frontageM > 0) {
      const ok = frontageM <= al.range[1] + 1;
      if (ok || fr.st !== 'pass') { fr.st = ok ? 'pass' : 'fail'; fr.reason = `${fmtM(frontageM)} held; on this ground the row allows ${fmtM(al.range[1])} (${al.src})`; }
    }
    if (kind === 'desert') {
      for (const r of out.filter((x) => (x.name === 'Gaps' || x.name === 'Mutual support') && x.st === 'warn')) {
        r.st = 'pass';
        r.reason += '; large gaps are accepted in the desert (OOW1 s22 p68): screen them with mobile troops and mines';
      }
    }
  }
  if (terrain) out.unshift(terrainRow(doc, terrain));
  if (enemy) out.unshift(forceRow(doc, task === 'attack' ? 'attack' : 'defence', planEch, enemy, force.ownS, force.enS, force));
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
