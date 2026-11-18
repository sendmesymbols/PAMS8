/**
 * PlanRecipes.ts — PURE. The recipe format of the Deployment Mgr's Build tab (PlanBuilder_Plan.md section 5), the
 * doctrine resolver and the recipe validator. No ArcGIS, no DOM: Node runs it (tools/planbuilder-test/recipes.mjs)
 * and the Build tab runs the same checks when it loads recipes, so a bad recipe is reported, never drawn.
 *
 * A recipe is a set of slots (roles) with rules; coordinates are an output. In geometry mode (terrain bundle off or
 * missing) a slot sits at its `seed`, metres from the plan's centre with the front up (acrossM right +, backM toward
 * the rear +); with the terrain, the fit moves it from there by its rules. `rule` holds only rules that need no
 * terrain; `terrainRule` holds the rest and is dropped (and shown as "not checked") without the bundle.
 *
 * Erasable TypeScript only (no enums, no parameter properties): Node 24 runs this file as it is.
 */

// ── Format ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A figure taken from PlanDoctrine.json by path, e.g. { doctrine: 'standoff.lpM' }. */
export interface DoctrineRef { doctrine: string }
export type Num = number | DoctrineRef;
export type Range = Num | [number, number];

export type SlotKind = 'fwd' | 'depth' | 'res' | 'round' | 'cpen' | 'area' | 'obstacle' | 'line' | 'point';
/** Kinds that hold ground: they need a seed and a size, and must not overlap. */
export const FOOTPRINT_KINDS: readonly SlotKind[] = ['fwd', 'depth', 'res', 'round', 'cpen'];

export interface RecipeSlot {
  role: string;
  kind: SlotKind;
  /** Symbols.json catalog key. */
  sym: string;
  label?: string;
  /** 2525D echelon code of the unit in the slot ('14' Pl, '15' Coy ...). */
  echelon?: string;
  /** Placement order: a slot's rules may only name slots of a lower or equal order. */
  order: number;
  /** Ground held: { doctrine: 'size.coy' } (frontageM x depthM) or explicit wM / hM. */
  size?: DoctrineRef | { wM: Num; hM: Num };
  seed?: { acrossM: number; backM: number };
  /** Turned from facing the front, clockwise (all-round layouts face outward). */
  turnDeg?: number;
  count?: Num | Range;
  /** Placed only with the terrain (e.g. a killing ground on the approach's chokepoint). */
  terrainOnly?: boolean;
  /**
   * Explicit geometry in plan metres [acrossM, backM] (backM negative = toward the enemy), for control measures an
   * attack lays by distance: `at` (a point), `pts` (a line or area through these), `rect` (an area), `base` + `ctrl`
   * (a BOF: base line and the point it fires toward), `widthM` (an axis arrow's width across its tail).
   */
  shape?: {
    at?: [number, number];
    pts?: [number, number][];
    rect?: { acrossM: number; backM: number; wM: Num; hM: Num };
    base?: [[number, number], [number, number]];
    ctrl?: [number, number];
    widthM?: Num;
  };
  /** DRAW_TYPE handed to the symbol (default: 1 for lines and Battle Posns, 2 for plain polygons). */
  drawType?: number;
  /** His, not ours (SIDC identity hostile): a minefield or wire he is assumed to hold (a crossing's). */
  hostile?: boolean;
  /** Drawn with planned status (dashed): a posn taken up later in the battle (the mortars' step-up posn). */
  planned?: boolean;
  rule?: Record<string, unknown>;
  terrainRule?: Record<string, unknown>;
}

export interface Recipe {
  format: 'pams8-plan-recipe';
  version: number;
  id: string;
  family: string;
  name: string;
  task: string;
  layout: string;
  echelon: string;
  /** ORBAT unit id (MS/Data/Orbat/PK). */
  unit?: string;
  /**
   * The manoeuvre Coys (a Coy plan: Pls) the layout is for, when it is not the standard four (three). A family may then
   * hold the same layout once for each count; the tab shows the layouts that match the unit type chosen.
   */
  forCoys?: number;
  basis: 'D' | 'O' | 'E' | 'U';
  /** OcokaDoctrine.frontage row the whole layout is held to (null: none printed, basis E). */
  frontageRow: string | null;
  /** Row for the depth when frontageRow is null. */
  depthRow?: string;
  /** Row for the gaps between forward slots. */
  subRow?: string | null;
  needs: { terrain: boolean };
  note?: string;
  slots: RecipeSlot[];
  alternates?: { of: string; kind: 'alt'; spacing?: Num | Range }[];
  supplementary?: 'perSecondaryApproach' | 'none';
  checks?: string[];
  /** An attack in two phases (PlanPhase.twoPhaseRecipe): Obj 2, FUP 2, SL 2, the phase 2 axis, the follow-up Coys. */
  phases?: number;
  /** The side phase 2 goes round Obj 1: 1 right, -1 left (as seen from the own side). */
  phase2Side?: 1 | -1;
  /** A tank Sqn with the attack (PlanTanks.withTanks): in the fire support role, or in close support (armour heavy). */
  tanks?: 'fire' | 'close';
  /** Tank Sqns grouped to a Bn defence (PlanTanks.withDefTanks): their harbours beside the reserve, the C Pen force at the tank rate. */
  defTanks?: number;
  /** Engineers with a crossing (PlanBuildTab): the unit, its Pls and equipment, and the bridge tables it builds from. */
  engr?: import('./PlanEngr').EngrType & { kinds: ReturnType<typeof import('./PlanEngr').bridgeKinds> };
  /** A screen held by a Recce Sqn (PlanSmallOps.withRecceScreen): its AFV Tps the posts, their eye height, the Sqn. */
  screenBy?: { name: string; posts: string; eyeM: number; text: string };
  /** His protective minefield in front of the Obj (PlanAttack.withAttackMinefield): its depth and the lanes through it. */
  enMfAtk?: { depthM: number; lanes: number };
  /** Artillery with the plan and its gun area (PlanArty.withArty): the unit, its gun, the band behind the front. */
  arty?: import('./PlanArty').ArtyOnPlan;
  /** AD sited round the plan's vulnerable points (PlanAD.withAd): the unit, its fire units, the figures used. */
  ad?: import('./PlanAD').AdOnPlan;
  /** An inundation belt in front of a defence (PlanEngr.withInundation): its depth, the water, the soil. */
  inund?: import('./PlanEngr').InundSpec;
  /** What defTanks counts: Sqns (a Bn defence) or Tps (a Coy defence). */
  defTanksUnit?: 'Sqn' | 'Tp';
  /** The tank Sqn with the attack, from the ORBAT (PlanOrbat.tankSqnOf): tanks, Tps, tanks a Tp; its source. */
  tankSqn?: { tanks: number; tps: number; tpTanks: number; regtTanks: number | null; src: string };
  /** The role of the point the map click lands on (an ambush's KZ, a patrol's SP); else the HQ or the target on the Obj. */
  pivot?: string;
}

/** Tasks laid by PlanSmallOps over the Movement / Platoon Guide engines (Phase 8), not by the defence or attack rules. */
export const SMALL_TASKS: readonly string[] = ['ambush', 'patrol', 'recce'];

export const TASKS = ['defence', 'attack', 'crossing', 'ambush', 'patrol', 'recce', 'withdrawal'] as const;
export const LAYOUTS = ['two-up', 'three-up', 'one-up', 'all-round', 'canal', 'rev-slope', 'frontal', 'left-flank', 'right-flank', 'two-phase', 'night', 'line', 'l', 'v', 'patrol', 'two-ops', 'three-ops', 'four-bn', 'two-bde', 'area', 'screen'] as const;
export const ECHELONS = ['13', '14', '15', '16', '17', '18', '21'] as const;
export const CHECK_NAMES = ['approaches', 'facingThreat', 'gaps', 'depth', 'flanks', 'exposure', 'killingGr', 'alternates', 'reserveReach', 'mutualSupport', 'fieldOfFire', 'backBlast', 'dfMinRange', 'deadGroundFront', 'fupDistance', 'assaultFrontage', 'bofFlank', 'bofRange', 'morReach', 'fireLift'] as const;

/** Rule vocabulary (PlanBuilder_Plan.md 5.2). Geometry rules may sit in `rule`; terrain rules only in `terrainRule`. */
export const GEOMETRY_RULES = [
  'distM', 'behind', 'ahead', 'side', 'squareTo', 'gapTo', 'frontage', 'depth', 'withinRangeOf', 'outOfRangeOf', 'bearingFromAxis',
  'inRangeOf', 'mutualSupport', 'coversGap', 'backBlastClear', 'minRange', 'fireLift', 'reach', 'beforeEnemy',
  'inFrontOf', 'depthM', 'joins', 'edge', 'perSlot', 'of', 'centre',
] as const;
export const TERRAIN_RULES = [
  'onGround', 'notIn', 'vehicleAccess', 'sees', 'unseenFrom', 'fieldOfFireM', 'deadGroundFront', 'notOverlookedFrom',
  'prefer', 'onObstacle', 'tieTo', 'on', 'across',
] as const;
/** Rule values that name other slots. */
const SLOT_REF_RULES = ['behind', 'inRangeOf', 'mutualSupport', 'coversGap', 'inFrontOf', 'joins', 'perSlot', 'of', 'sees'];
const PREFER = ['itg', 'highGround', 'reverseSlope', 'behindObstacle', 'bua', 'roadAccess'];
const NOT_IN = ['noGo', 'slowGo', 'water', 'bua'];

// ── Doctrine ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DoctrineSet {
  /** MS/Data/PlanDoctrine.json */
  plan: any;
  /** MS/Data/OcokaDoctrine.json (frontage rows, standoff, field of fire) */
  ocoka: any;
}

const isRef = (v: unknown): v is DoctrineRef => !!v && typeof v === 'object' && typeof (v as any).doctrine === 'string';

/** Look a path up in PlanDoctrine.json; a { value } leaf gives its value. undefined when the path is not there. */
export function doctrineAt(doc: DoctrineSet, path: string): unknown {
  let node: any = doc.plan;
  for (const k of path.split('.')) { if (node == null || typeof node !== 'object') return undefined; node = node[k]; }
  if (node && typeof node === 'object' && 'value' in node) node = node.value;
  return isRef(node) ? doctrineAt(doc, node.doctrine) : node;
}

/** A number or [min, max] from a literal or a doctrine ref; null when it is neither. */
export function resolveRange(doc: DoctrineSet, v: unknown): [number, number] | null {
  let x: any = isRef(v) ? doctrineAt(doc, v.doctrine) : v;
  if (x && typeof x === 'object' && !Array.isArray(x) && 'value' in x) x = x.value;
  if (typeof x === 'number' && isFinite(x)) return [x, x];
  if (Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number' && isFinite(n))) return [x[0], x[1]];
  return null;
}
const mid = (r: [number, number]) => (r[0] + r[1]) / 2;

export function frontageRow(doc: DoctrineSet, unit: string): any | null {
  return (doc.ocoka?.frontage?.rows ?? []).find((r: any) => r.unit === unit) ?? null;
}

/** Width (across the front) and depth of a slot in metres, after its turn. null when it has no size. */
export function slotSizeM(doc: DoctrineSet, s: RecipeSlot): { wM: number; hM: number } | null {
  if (!s.size) return null;
  let w: [number, number] | null, h: [number, number] | null;
  if (isRef(s.size)) {
    const o: any = doctrineAt(doc, s.size.doctrine);
    if (!o || typeof o !== 'object') return null;
    w = resolveRange(doc, o.frontageM); h = resolveRange(doc, o.depthM);
  } else { w = resolveRange(doc, s.size.wM); h = resolveRange(doc, s.size.hM); }
  if (!w || !h) return null;
  const turned = Math.round(((s.turnDeg ?? 0) % 180 + 180) % 180) === 90;
  return turned ? { wM: mid(h), hM: mid(w) } : { wM: mid(w), hM: mid(h) };
}

/** The slots that hold ground, as boxes in plan metres (x right, y back). Turned boxes other than 90 / 270 keep their
 *  unturned box: good enough for overlap and footprint checks at the seed. */
export function footprints(doc: DoctrineSet, r: Recipe) {
  return r.slots.filter((s) => FOOTPRINT_KINDS.includes(s.kind) && s.seed).map((s) => {
    const z = slotSizeM(doc, s) ?? { wM: 0, hM: 0 };
    return { role: s.role, kind: s.kind, x: s.seed!.acrossM, y: s.seed!.backM, w: z.wM, h: z.hM };
  });
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RecipeIssue { level: 'fail' | 'warn'; recipe: string; msg: string }
export interface ValidateCtx {
  doc: DoctrineSet;
  /** Symbols.json keys */
  symbols: Set<string> | Record<string, unknown>;
  /** ORBAT unit ids; when omitted the unit is not checked */
  units?: Set<string>;
  /** the file name the recipe came from, to check it against the id */
  file?: string;
}

const hasKey = (s: ValidateCtx['symbols'], k: string) => (s instanceof Set ? s.has(k) : Object.prototype.hasOwnProperty.call(s, k));

/** Every problem with one recipe. A 'fail' means the Build tab will not offer it. */
export function validateRecipe(r: Recipe, ctx: ValidateCtx): RecipeIssue[] {
  const out: RecipeIssue[] = [];
  const id = (r && typeof r.id === 'string') ? r.id : '(no id)';
  const fail = (msg: string) => out.push({ level: 'fail', recipe: id, msg });
  const warn = (msg: string) => out.push({ level: 'warn', recipe: id, msg });
  const doc = ctx.doc;

  if (!r || typeof r !== 'object') { fail('not an object'); return out; }
  if (r.format !== 'pams8-plan-recipe') fail(`format "${r.format}" is not pams8-plan-recipe`);
  if (r.version !== 1) fail(`version ${r.version} not supported (1)`);
  if (!/^[a-z0-9-]+$/.test(id)) fail('id must be lower-case letters, digits and dashes');
  if (ctx.file && ctx.file.replace(/\.json$/, '') !== id) fail(`id "${id}" does not match the file name ${ctx.file}`);
  for (const k of ['family', 'name', 'task', 'layout', 'echelon'] as const) if (typeof r[k] !== 'string' || !r[k]) fail(`${k} missing`);
  if (!(TASKS as readonly string[]).includes(r.task)) fail(`task "${r.task}" unknown`);
  if (!(LAYOUTS as readonly string[]).includes(r.layout)) fail(`layout "${r.layout}" unknown`);
  if (!(ECHELONS as readonly string[]).includes(r.echelon)) fail(`echelon "${r.echelon}" is not a 2525D code in use`);
  if (!['D', 'O', 'E', 'U'].includes(r.basis)) fail(`basis "${r.basis}" is not D / O / E / U`);
  if (!r.needs || typeof r.needs.terrain !== 'boolean') fail('needs.terrain missing');
  if (r.unit && ctx.units && !ctx.units.has(r.unit)) fail(`unit ${r.unit} is not in the ORBAT`);
  if (r.forCoys != null) {
    const below = String(Number(r.echelon) === 16 ? 15 : 14);
    // a defence's sub-units hold ground (posns); an attack's are unit symbols (the assault Coys, the reserve)
    const held = Array.isArray(r.slots) ? r.slots.filter((s) => s?.echelon === below && (['fwd', 'depth', 'res', 'round'].includes(s.kind) || (r.task === 'attack' && s.kind === 'point' && /^10/.test(String(s.sym))))).length : 0;
    if (!Number.isInteger(r.forCoys) || r.forCoys < 1) fail(`forCoys ${r.forCoys} is not a whole number from 1`);
    else if (held !== r.forCoys) fail(`forCoys is ${r.forCoys} but the recipe holds ground with ${held} sub-units`);
  }
  if (r.frontageRow != null && !frontageRow(doc, r.frontageRow)) fail(`frontageRow "${r.frontageRow}" is not a row of OcokaDoctrine.frontage`);
  // a crossing's frontages and depths are PlanDoctrine.crossing.bridgehead (IBB S46), not an OcokaDoctrine row
  if (r.frontageRow == null && r.basis === 'D' && r.task !== 'crossing' && r.layout !== 'canal' && !SMALL_TASKS.includes(r.task)) warn('basis D but no frontage row');
  if (r.subRow && !frontageRow(doc, r.subRow)) fail(`subRow "${r.subRow}" is not a row of OcokaDoctrine.frontage`);
  if (r.depthRow && !frontageRow(doc, r.depthRow)) fail(`depthRow "${r.depthRow}" is not a row of OcokaDoctrine.frontage`);
  for (const c of r.checks ?? []) if (!(CHECK_NAMES as readonly string[]).includes(c)) fail(`check "${c}" unknown`);
  if (!Array.isArray(r.slots) || !r.slots.length) { fail('no slots'); return out; }
  if (r.pivot != null && !r.slots.some((s) => s?.role === r.pivot && s.shape?.at)) fail(`pivot "${r.pivot}" is not a point slot of the recipe`);

  const walkRefs = (at: string, v: unknown): void => {
    if (isRef(v)) { if (doctrineAt(doc, v.doctrine) === undefined) fail(`${at}: doctrine path "${v.doctrine}" not in PlanDoctrine.json`); return; }
    if (Array.isArray(v)) v.forEach((x) => walkRefs(at, x));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walkRefs(at, x);
  };

  // slots
  const byRole = new Map<string, RecipeSlot>();
  for (const s of r.slots) {
    const at = `slot ${s?.role ?? '?'}`;
    if (!s || typeof s.role !== 'string' || !s.role) { fail('a slot has no role'); continue; }
    if (byRole.has(s.role)) fail(`${at}: role used twice`);
    byRole.set(s.role, s);
    if (!['fwd', 'depth', 'res', 'round', 'cpen', 'area', 'obstacle', 'line', 'point'].includes(s.kind)) fail(`${at}: kind "${s.kind}" unknown`);
    if (typeof s.sym !== 'string' || !hasKey(ctx.symbols, s.sym)) fail(`${at}: symbol ${s.sym} is not in Symbols.json`);
    if (!Number.isInteger(s.order) || s.order < 1) fail(`${at}: order must be a whole number from 1`);
    if (s.echelon && !(ECHELONS as readonly string[]).includes(s.echelon) && s.echelon !== '11' && s.echelon !== '12') fail(`${at}: echelon ${s.echelon} not a 2525D code`);
    if (s.echelon && Number(s.echelon) >= Number(r.echelon)) fail(`${at}: echelon ${s.echelon} is not below the recipe's ${r.echelon}`);
    if (FOOTPRINT_KINDS.includes(s.kind)) {
      if (!s.seed || typeof s.seed.acrossM !== 'number' || typeof s.seed.backM !== 'number') fail(`${at}: a ${s.kind} slot needs a seed (acrossM, backM)`);
      if (!slotSizeM(doc, s)) fail(`${at}: size missing or not resolvable in PlanDoctrine.json`);
    } else if (!s.rule && !s.terrainRule && !s.shape) fail(`${at}: neither a seed, a shape nor a rule places it`);
    if (s.terrainOnly && !s.terrainRule) fail(`${at}: terrainOnly but no terrainRule`);
    if (!s.terrainOnly && !FOOTPRINT_KINDS.includes(s.kind) && !s.rule && !s.shape) fail(`${at}: placed only by terrain rules, so mark it terrainOnly`);
    if (s.shape) {
      const pair = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && isFinite(n));
      const sh = s.shape;
      if (sh.at != null && !pair(sh.at)) fail(`${at}: shape.at is not [acrossM, backM]`);
      if (sh.pts != null && (!Array.isArray(sh.pts) || sh.pts.length < 2 || !sh.pts.every(pair))) fail(`${at}: shape.pts needs two or more [acrossM, backM]`);
      if (sh.base != null && (!Array.isArray(sh.base) || sh.base.length !== 2 || !sh.base.every(pair))) fail(`${at}: shape.base needs two [acrossM, backM]`);
      if (sh.base != null && !pair(sh.ctrl)) fail(`${at}: shape.base needs shape.ctrl`);
      if (sh.rect != null && (typeof sh.rect.acrossM !== 'number' || typeof sh.rect.backM !== 'number' || !resolveRange(doc, sh.rect.wM) || !resolveRange(doc, sh.rect.hM))) fail(`${at}: shape.rect needs acrossM, backM, wM, hM`);
      if (sh.widthM != null && !resolveRange(doc, sh.widthM)) fail(`${at}: shape.widthM does not resolve`);
      if (sh.at == null && sh.pts == null && sh.rect == null && sh.base == null) fail(`${at}: shape gives no geometry`);
      walkRefs(`${at} shape`, sh);
    }
  }

  // rules: vocabulary, slot references (lower or equal order), doctrine refs
  const refsIn = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : (v && typeof v === 'object' && typeof (v as any).slot === 'string') ? [(v as any).slot] : (v && typeof v === 'object' && Array.isArray((v as any).slots)) ? (v as any).slots : [];
  for (const s of r.slots) {
    const at = `slot ${s.role}`;
    for (const [part, allowed] of [['rule', GEOMETRY_RULES], ['terrainRule', TERRAIN_RULES]] as const) {
      const rule = (s as any)[part];
      if (rule == null) continue;
      if (typeof rule !== 'object') { fail(`${at}: ${part} is not an object`); continue; }
      for (const [k, v] of Object.entries(rule)) {
        if (!(allowed as readonly string[]).includes(k)) {
          fail(part === 'rule' && (TERRAIN_RULES as readonly string[]).includes(k)
            ? `${at}: "${k}" needs the terrain: move it into terrainRule`
            : `${at}: ${part} "${k}" is not in the rule vocabulary`);
          continue;
        }
        if (SLOT_REF_RULES.includes(k) || k === 'gapTo' || k === 'reach') {
          for (const ref of refsIn(v)) {
            if (k === 'sees' && !byRole.has(ref)) continue;            // sees may name a non-slot (threat, approach)
            const t = byRole.get(ref);
            if (!t) fail(`${at}: ${k} names slot "${ref}", which is not in the recipe`);
            else if (t === s) fail(`${at}: ${k} names itself`);
            else if (t.order > s.order && k !== 'reach') fail(`${at}: ${k} names "${ref}", placed later (order ${t.order} > ${s.order})`);
          }
        }
        if (k === 'gapTo' && v && typeof v === 'object' && (v as any).row && !frontageRow(doc, (v as any).row)) fail(`${at}: gapTo row "${(v as any).row}" is not a frontage row`);
        if (k === 'prefer') for (const p of Array.isArray(v) ? v : [v]) if (!PREFER.includes(p as string)) fail(`${at}: prefer "${p}" unknown`);
        if (k === 'notIn') for (const p of Array.isArray(v) ? v : [v]) if (!NOT_IN.includes(p as string)) fail(`${at}: notIn "${p}" unknown`);
        walkRefs(`${at} ${part}.${k}`, v);
      }
    }
    if (s.count != null) walkRefs(`${at} count`, s.count);
    if (s.size) walkRefs(`${at} size`, s.size);
  }
  for (const a of r.alternates ?? []) {
    if (!byRole.has(a.of)) fail(`alternate of "${a.of}": no such slot`);
    else if (!FOOTPRINT_KINDS.includes(byRole.get(a.of)!.kind)) fail(`alternate of "${a.of}": not a posn that holds ground`);
    if (a.spacing != null) walkRefs(`alternate of ${a.of}`, a.spacing);
  }

  // geometry at the seeds: no overlap, inside the frontage and depth rows, gaps
  const fp = footprints(doc, r);
  for (let i = 0; i < fp.length; i++) for (let j = i + 1; j < fp.length; j++) {
    const a = fp[i], b = fp[j];
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) fail(`slots ${a.role} and ${b.role} overlap at their seeds`);
  }
  if (fp.length) {
    const left = Math.min(...fp.map((f) => f.x - f.w / 2)), right = Math.max(...fp.map((f) => f.x + f.w / 2));
    const front = Math.min(...fp.map((f) => f.y - f.h / 2)), rear = Math.max(...fp.map((f) => f.y + f.h / 2));
    const row = r.frontageRow ? frontageRow(doc, r.frontageRow) : null;
    const dRow = row ?? (r.depthRow ? frontageRow(doc, r.depthRow) : null);
    if (row) {
      const fr = resolveRange(doc, row.frontageM);
      if (fr && right - left > fr[1] + 1) fail(`frontage ${Math.round(right - left)} m is wider than the row's ${fr[1]} m (${r.frontageRow})`);
    }
    if (dRow?.depthM != null) {
      const dr = resolveRange(doc, dRow.depthM);
      if (dr && (rear - front < dr[0] - 1 || rear - front > dr[1] + 1)) warn(`depth ${Math.round(rear - front)} m is outside the row's ${dr[0]}-${dr[1]} m (${dRow.unit})`);
    }
    const sub = r.subRow ? frontageRow(doc, r.subRow) : null;
    const fwd = fp.filter((f) => f.kind === 'fwd').sort((a, b) => a.x - b.x);
    if (sub?.gapM != null && fwd.length > 1) {
      for (let i = 1; i < fwd.length; i++) {
        const gap = fwd[i].x - fwd[i - 1].x - (fwd[i].w + fwd[i - 1].w) / 2;
        if (gap > sub.gapM * 1.1 + 1) warn(`gap ${Math.round(gap)} m between ${fwd[i - 1].role} and ${fwd[i].role} is wider than the row's ${sub.gapM} m`);
      }
    }
  }
  return out;
}

/** Siblings in a family must agree on task and echelon (Auto ranks across them). */
export function validateFamilies(recipes: Recipe[]): RecipeIssue[] {
  const out: RecipeIssue[] = [];
  const fam = new Map<string, Recipe[]>();
  for (const r of recipes) fam.set(r.family, [...(fam.get(r.family) ?? []), r]);
  for (const [f, list] of fam) {
    const t = list[0];
    for (const r of list.slice(1)) {
      if (r.task !== t.task) out.push({ level: 'fail', recipe: r.id, msg: `family ${f}: task ${r.task} differs from ${t.id}'s ${t.task}` });
      if (r.echelon !== t.echelon) out.push({ level: 'fail', recipe: r.id, msg: `family ${f}: echelon ${r.echelon} differs from ${t.id}'s ${t.echelon}` });
    }
    // the same layout may come once for each Coy count (a three-Coy Bn's two up beside the four-Coy one)
    const layouts = list.map((r) => `${r.layout}/${r.forCoys ?? 'std'}`);
    if (new Set(layouts).size !== layouts.length) out.push({ level: 'fail', recipe: f, msg: `family ${f} has the same layout twice` });
  }
  return out;
}
