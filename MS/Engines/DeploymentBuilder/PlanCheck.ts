/**
 * PlanCheck.ts — PURE. "Check my plan" (PlanBuilder_Plan.md Phase 5): read a plan someone drew (or placed from the
 * Templates tab), work out what each symbol is in the plan, and run the rules the Intelligent Deployment tab builds
 * with, without moving anything.
 *
 * Reading (PlanBuilder_Plan.md 16.2 cautions):
 * - side from the SIDC identity: 02 / 03 own (08 Rangers, basis O), 05 / 06 enemy; freehand colours and set 00 are
 *   left out;
 * - echelon from the label first ("A Coy", "27 FF"), then the SIDC, then a unit symbol inside, then the size; a
 *   posn drawn the size of another echelon is flagged;
 * - planned status (SIDC digit 7 = 1) is a depth or alternate posn; an unlabelled planned outline over a held posn is
 *   left out; the HQ / TF digit 1, 3, 5, 7 is a dummy;
 * - the front: the threat marker, else the enemy symbols, else the DCB / ditch / FEBA in front, else the minefields;
 * - the plan's own outline (a posn holding two or more smaller posns) is the plan's locality, not a posn.
 *
 * Checks: defence — frontage, depth, gaps, mutual support, facing, depth posns, reserve reach, alternates, each posn's
 * size; with the ground (PlanFit, check only) the ground under each posn, fields of fire, what overlooks it, flanks,
 * approaches covered (the drawn en axes when there are any), the en FUP, the obstacle tie-in, heights. Attack — per
 * axis the FUP's distance, the SL, the BOF's flank and range, the assault width, and on the ground the FUP unseen, the
 * going and the BOF's view. Both — the enemy force and the ground's kind. No ArcGIS, no DOM, no fetch.
 */
import type { DoctrineSet } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckState, SlotResult, XY } from './PlanSolve';
import { detailLines } from './PlanSolve';
import { atCoverRow, detectTerrain, fitPlan, frontCheckRows, toLocal, toWorld, type FitFrame, type FitResult, type GroundAvenue, type PlanGround } from './PlanFit';
import { faceBearing, frontValid, nearestOnFront, type EnFront } from './PlanEnFront';
import { movesRow, reserveMovesCheck, tankCoverRow, triggerLines, whatIf, type WhatIfResult } from './PlanWhatIf';
import {
  assaultFrontageCheck, bnFrontageCheck, defaultEnemy, fupFromObjCheck, groundNotes, echelonLabel, enemyFupM, enemyProfile, footKmh, forceRow, frontageAllowance, frontageRowCheck, gapsAccepted, levelOf, strengthOf, terrainLabel, terrainRow,
  type EnemySpec, type EnemyType, type TerrainKind, type TerrainSpec,
} from './PlanContext';
import { brief, enUnitFor, forceFromOrbat, minefieldRow, tankSqnOf, withAtGroup, type OrbatSet } from './PlanOrbat';
import { counterAttack } from './PlanAttack';
import { defTankRows, tankGoingRow } from './PlanTanks';
import { artyRows } from './PlanArty';
import { adRows } from './PlanAD';
import { layoutRows, rearAreaRow } from './PlanMountain';
import { ctpsOverride } from './PlanCtps';
import type { Recipe } from './PlanRecipes';
import { airLiftOf, airLiftRow } from './PlanAvn';

/** The roles AD cover reads back: the FUs and the vulnerable points. */
const AD_ROLES = /^(ad\d+|gunArea\d*|hq|assy\d*|vwa|res|bridge\d*)$/;
/** A built plan's gun areas: each Regt's (gunArea, gunArea2 ...) and the sections G laid on mountain ground (gunAreaS2, gunArea2S3 ...). */
const GUN_ROLES = /^gunArea\d*(S\d+)?$/;
import { engrShare, inundation, ownEngrTypes } from './PlanEngr';
import type { ForceSides } from './PlanContext';

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PlanRecord { id: string; drawEss: any; attrs?: Record<string, any> }

export interface DrawnSymbol {
  id: string;
  /** Symbols.json catalog key (symbol set + entity). */
  key: string;
  name: string;
  geo: string;
  sidc: string;
  side: 'own' | 'enemy' | 'other';
  status: string;
  hqtf: string;
  /** 2525D echelon from the SIDC or ECHELON field ('15' Coy ...), null when none. */
  ech: string | null;
  label: string;
  /** Web Mercator. */
  pts: XY[];
  base: { start: XY; mid: XY; end: XY } | null;
  pbRole?: string;
  /** A built plan's recipe and what it was fitted for (ground, enemy, unit, threat), from the graphic's attributes. */
  pbRecipe?: string;
  pbMeta?: any;
}

const R = 6378137;
const P = (x: number, y: number): XY => ({ x, y });
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const merc = (p: any): XY | null => {
  if (!p || p.x == null || p.y == null) return null;
  const x = Number(p.x), y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
    const la = Math.max(-85, Math.min(85, y));
    return P((x * Math.PI * R) / 180, R * Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)));
  }
  return P(x, y);
};
/** Ground metres per Mercator unit at a Mercator y. */
const kAt = (y: number) => 1 / Math.cos(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2);

/** The records of a Plan document (poObj.plnOrdrOverlay[].plnOrdrSymbolSet[]), as the sample plans and Save Plan write them. */
export function recordsFromPlanDoc(doc: any): PlanRecord[] {
  const out: PlanRecord[] = [];
  for (const o of doc?.poObj?.plnOrdrOverlay ?? []) for (const s of o?.plnOrdrSymbolSet ?? []) {
    let de: any = s?.drawEss;
    if (typeof de === 'string') { try { de = JSON.parse(de); } catch { de = null; } }
    if (de) out.push({ id: String(s?.plnOrdrSymbolPK?.plnOrdrSymbolId ?? s?.id ?? out.length), drawEss: de });
  }
  return out;
}

const OWN = new Set(['02', '03', '08']);
const ENEMY = new Set(['05', '06']);
const ECH_OK = /^(1[1-9]|2[0-6])$/;

export function readSymbols(records: PlanRecord[]): DrawnSymbol[] {
  const out: DrawnSymbol[] = [];
  for (const r of records) {
    const de = r.drawEss ?? {};
    const sidc = String(de.SIDC || de.OPTIONS?.SIDC || de.AMPLIFIER?.SIDC || '');
    if (sidc.length < 16) continue;
    const set = sidc.slice(4, 6), ident = sidc.slice(2, 4);
    const sid = String(de.SID || sidc.slice(10, 16));
    const key = `${set}${sid}`;
    const name = String(de.SYM_NAME ?? '');
    const freehand = set === '00' || /^0000/.test(sid) || /freehand/i.test(name);
    const side: DrawnSymbol['side'] = freehand ? 'other' : OWN.has(ident) ? 'own' : ENEMY.has(ident) ? 'enemy' : 'other';
    const geo = String(de.SYM_GEO_TYPE ?? '');
    let pts: XY[] = [];
    if (Array.isArray(de.CTRL_PTS) && de.CTRL_PTS.length) pts = de.CTRL_PTS.map(merc).filter(Boolean) as XY[];
    if (!pts.length) { const g = merc(de.GEOM) ?? merc(de.OPTIONS?.GEOM); if (g) pts = [g]; }
    const b = de.BASE_LN_PTS;
    const base = b && merc(b.startPt) && merc(b.endPt) ? { start: merc(b.startPt)!, mid: merc(b.midPt) ?? merc(b.startPt)!, end: merc(b.endPt)! } : null;
    if (!pts.length && base) pts = [base.mid];
    if (!pts.length) continue;
    const echField = String(de.ECHELON ?? de.OPTIONS?.ECHELON ?? '');
    const amp = sidc.slice(8, 10);
    const ech = ECH_OK.test(echField) ? echField : ECH_OK.test(amp) ? amp : null;
    const label = String(de.AMPLIFIER?.UNIQUE_DESIG ?? de.OPTIONS?.uniqueDesignation ?? '').trim();
    out.push({ id: r.id, key, name, geo, sidc, side, status: sidc[6], hqtf: sidc[7], ech, label, pts, base, pbRole: r.attrs?.pbRole, pbRecipe: r.attrs?.pbRecipe, pbMeta: r.attrs?.pbMeta });
  }
  return out;
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────
const centroid = (pts: XY[]) => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
function inPoly(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const bbox = (pts: XY[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
/** Shortest distance between two point sets (their points and segments), Mercator units. */
function setDist(a: XY[], b: XY[]): number {
  const seg = (p: XY, s: XY, e: XY) => { const L = dist(s, e) ** 2; if (!L) return dist(p, s); const t = Math.max(0, Math.min(1, ((p.x - s.x) * (e.x - s.x) + (p.y - s.y) * (e.y - s.y)) / L)); return dist(p, P(s.x + t * (e.x - s.x), s.y + t * (e.y - s.y))); };
  let best = Infinity;
  const edges = (q: XY[]) => (q.length < 2 ? [[q[0], q[0]]] : q.map((p, i) => [p, q[(i + 1) % q.length]]));
  for (const p of a) for (const [s, e] of edges(b)) best = Math.min(best, seg(p, s, e));
  for (const p of b) for (const [s, e] of edges(a)) best = Math.min(best, seg(p, s, e));
  return best;
}
/** Densify a polyline every `step` Mercator units. */
function densify(pts: XY[], step: number): XY[] {
  const out: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const L = dist(pts[i - 1], pts[i]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push(P(pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / n, pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / n));
  }
  return out;
}

// ── keys ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const isPosnKey = (k: string) => k === '25151200' || k === '25151201' || k === '25151203';
const isAxisKey = (k: string) => ['25151403', '25151404', '25151408', '25140602', '25140603'].includes(k);
/** A ditch, DCB or AT wall (25290201-04), an obstacle line or a DCB facility: the linear obstacles a front can tie to (wire is not one). */
const isDitch = (k: string) => /^252902/.test(k) || k === '20121459';
const isObstacleLine = (k: string) => isDitch(k) || k === '25290100' || k === '25140400';
const isMinefield = (k: string) => /^2527/.test(k);
const isUnit = (s: DrawnSymbol) => s.geo === 'FPoint' && /^1[0-5]$/.test(s.key.slice(0, 2));
const isArmour = (s: DrawnSymbol) => /^1012(05|02)/.test(s.key) || /^1512(01|02)/.test(s.key) || /^15120/.test(s.key) || /tank|armr|armd/i.test(s.name);
const isReserveMark = (s: DrawnSymbol) => s.key === '30180000' || /reserve/i.test(s.name) || /^res\b/i.test(s.label);

/** Echelon in a label: "A Coy" 15, "1 Pl" 14, "27 FF" / "26 Punjab" (a Bn of a regiment) 16, "12 Bde" 18, "31 Div" 21. */
export function echelonFromLabel(label: string): string | null {
  const t = label.trim();
  if (!t) return null;
  if (/\b(div|division)\b/i.test(t)) return '21';
  if (/\b(bde|brigade)\b/i.test(t)) return '18';
  if (/\b(bn|battalion|regt|regiment)\b/i.test(t)) return '16';
  if (/\b(coy|company|sqn|squadron|bty|battery)\b/i.test(t)) return '15';
  if (/\b(pl|platoon|tp|troop)\b/i.test(t)) return '14';
  if (/\b(sec|section)\b/i.test(t)) return '13';
  // Pakistan Army infantry battalions: a number and a regiment
  if (/^\d+\s*(FF|Punjab|Baloch|AK|Sind|NLI|SR|BR|Frontier Force|Azad Kashmir|Rangers|Maratha|Rashtrya Rifles|RR|Dogra|Garhwal|Jat|Sikh|Rajput|Gorkha|Madras|Mahar|JAK|Kumaon|Grenadiers|Guards)\b/i.test(t)) return '16';
  return null;
}

// ── mapping ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type PosnKind = 'fwd' | 'depth' | 'res' | 'cpen' | 'alt' | 'sup' | 'sub' | 'outline' | 'dummy' | 'ignore';
export const POSN_KINDS: PosnKind[] = ['fwd', 'depth', 'res', 'cpen', 'alt', 'sup', 'sub', 'outline', 'dummy', 'ignore'];

export interface PosnRead {
  id: string;
  label: string;
  kind: PosnKind;
  /** Why it was read so (label, planned, position ...); 'set' when the user chose it. */
  kindWhy: string;
  ech: string | null;
  echBy: 'label' | 'sidc' | 'unit' | 'size' | 'none';
  /** The echelon its size suggests. */
  echSize: string | null;
  planned: boolean;
  /** Web Mercator outline. */
  poly: XY[];
  /** In plan metres once the front is known. */
  c?: XY; w?: number; h?: number;
  /** Open face (Battle Posn first-last points) direction, plan radians from the front; null: closed or a point. */
  faceDeg?: number | null;
  /** Units inside it (labels). */
  units: string[];
}

export interface ThreatRead {
  at: XY | null;
  from: 'marker' | 'front' | 'plan' | 'enemy' | 'cues' | 'obstacle' | 'none';
  why: string;
}

export interface MappedPlan {
  task: 'defence' | 'attack';
  syms: DrawnSymbol[];
  posns: PosnRead[];
  posnEch: string | null;
  planEch: string | null;
  threat: ThreatRead;
  frame: FitFrame | null;
  unclear: string[];
  /** Built by the Intelligent Deployment tab: its recipe and what it was fitted for (pbMeta). */
  built: { recipe: string | null; meta: any; allRound: boolean } | null;
  /** The En front line or area the plan is read against: marked in the tab, else the one it was built against. */
  front?: EnFront | null;
}

export interface MapOptions {
  /** Threat marker (world), if the user marked one. */
  threat?: XY | null;
  /** The En front line or area marked in the tab (world, PlanEnFront). */
  front?: EnFront | null;
  /** The user's roles, posn id -> kind. */
  kinds?: Record<string, PosnKind>;
  task?: 'defence' | 'attack' | 'auto';
  /** The tab's recipes by id: a built plan's roles map to the recipe's slot kinds (fwd, depth, res, round). */
  recipes?: Record<string, { echelon: string; task?: string; slots: { role: string; kind: string }[] }>;
}

const SIZE_ROWS: [string, number][] = [['14', 600], ['15', 1500], ['16', 4750], ['18', 11000], ['21', 25000]];
function echelonBySize(widthM: number): string | null {
  if (!(widthM > 0)) return null;
  let best: string | null = null, bd = Infinity;
  for (const [e, w] of SIZE_ROWS) { const d = Math.abs(Math.log(widthM / w)); if (d < bd) { bd = d; best = e; } }
  return best;
}
const DEPTH_OF: Record<string, number> = { '13': 100, '14': 250, '15': 700, '16': 3000, '17': 3000, '18': 5000, '21': 10000 };

export function mapPlan(syms: DrawnSymbol[], doc: DoctrineSet, opts: MapOptions = {}): MappedPlan {
  const own = syms.filter((s) => s.side === 'own'), en = syms.filter((s) => s.side === 'enemy');
  const ownAttack = own.some((s) => isAxisKey(s.key) || s.key === '25140302' || s.key === '25140303' || s.key === '25152100');
  const task: MappedPlan['task'] = opts.task === 'defence' || opts.task === 'attack' ? opts.task : ownAttack && en.some((s) => isPosnKey(s.key) || isUnit(s)) ? 'attack' : ownAttack && !own.some((s) => isPosnKey(s.key)) ? 'attack' : 'defence';
  const unclear: string[] = [];
  const posns: PosnRead[] = [];
  if (task === 'defence') {
    const units = own.filter(isUnit);
    for (const s of own.filter((x) => isPosnKey(x.key) && x.pts.length >= 3)) {
      const k = kAt(centroid(s.pts).y);
      const bb = bbox(s.pts);
      const widthM = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / k;
      const inside = units.filter((u) => inPoly(u.pts[0], s.pts));
      let ech: string | null = null, echBy: PosnRead['echBy'] = 'none';
      const fromLabel = echelonFromLabel(s.label);
      if (fromLabel) { ech = fromLabel; echBy = 'label'; }
      else if (s.ech && s.ech !== '00') { ech = s.ech; echBy = 'sidc'; }
      else {
        const u = inside.filter((x) => x.ech && levelOf(x.ech) !== null).sort((a, b) => (levelOf(b.ech) ?? 0) - (levelOf(a.ech) ?? 0))[0];
        if (u) { ech = u.ech; echBy = 'unit'; }
      }
      const echSize = echelonBySize(widthM);
      if (!ech) { ech = echSize; echBy = echSize ? 'size' : 'none'; }
      const label = s.label || inside.find((u) => u.label)?.label || '';
      posns.push({ id: s.id, label: label || `(${s.name || 'posn'})`, kind: 'fwd', kindWhy: '', ech, echBy, echSize, planned: s.status === '1', poly: s.pts, units: inside.map((u) => u.label || u.name).filter(Boolean) });
    }
    // drawn only as unit symbols: each held at its echelon's doctrine size (said so)
    if (!posns.length) {
      for (const u of units.filter((x) => levelOf(x.ech) !== null && (levelOf(x.ech) ?? 0) >= 1)) {
        const wM = SIZE_ROWS.find(([e]) => e === u.ech)?.[1] ?? 1500, hM = DEPTH_OF[u.ech!] ?? 700;
        const k = kAt(u.pts[0].y), c = u.pts[0];
        const poly = [P(c.x - (wM / 2) * k, c.y - (hM / 2) * k), P(c.x + (wM / 2) * k, c.y - (hM / 2) * k), P(c.x + (wM / 2) * k, c.y + (hM / 2) * k), P(c.x - (wM / 2) * k, c.y + (hM / 2) * k)];
        posns.push({ id: u.id, label: u.label || u.name, kind: 'fwd', kindWhy: '', ech: u.ech, echBy: 'sidc', echSize: null, planned: u.status === '1', poly, units: [u.label || u.name] });
      }
      if (posns.length) unclear.push('No posns are drawn: each unit symbol is taken at its echelon\'s doctrine size (draw Battle Posns for a real check)');
    }
  }

  // a plan built by the Intelligent Deployment tab carries its roles, recipe and what it was fitted for: read it so,
  // not by a fresh guess (the same plan must not read differently when checked again)
  const built = syms.some((s) => s.side === 'own' && s.pbRole);
  const meta = syms.find((s) => s.pbMeta)?.pbMeta ?? null;
  const recipeId = syms.find((s) => s.pbRecipe)?.pbRecipe ?? null;
  const recipe = recipeId ? opts.recipes?.[recipeId] ?? null : null;
  const roleOf = (id: string) => syms.find((s) => s.id === id)?.pbRole ?? null;
  const kindFromRole = (role: string): PosnKind | null => {
    if (role === 'alt') return 'alt';
    if (role === 'sup') return 'sup';
    if (role === 'cpenPosn') return 'cpen';
    if (/Pl$/.test(role)) return 'sub';
    const k = recipe?.slots.find((s) => s.role === role)?.kind;
    if (/^tkSqn\d*$/.test(role)) return 'ignore';       // tank Sqns grouped to the Bn: a force, not a posn held
    if (k === 'fwd' || k === 'round') return 'fwd';
    if (k === 'depth') return 'depth';
    if (k === 'res') return 'res';
    if (/^fwd/.test(role)) return 'fwd';
    if (/^depth/.test(role)) return 'depth';
    if (role === 'res') return 'res';
    return null;
  };
  const allRound = !!recipe?.slots.some((s) => s.kind === 'round');

  // the front: the threat marker, the threat the plan was built against, the enemy symbols, the built plan's own
  // forward and depth posns, then what points at the enemy (arcs of fire, minefields ...), an obstacle line
  const ownPts = (task === 'defence' ? posns.flatMap((p) => p.poly) : own.flatMap((s) => s.pts));
  const ownC = ownPts.length ? centroid(ownPts) : null;
  let threat: ThreatRead = { at: null, from: 'none', why: 'no threat marked, no enemy symbols, no obstacle drawn in front' };
  const builtFwd = posns.filter((p) => roleOf(p.id) && kindFromRole(roleOf(p.id)!) === 'fwd');
  const builtBack = posns.filter((p) => roleOf(p.id) && ['depth', 'res'].includes(kindFromRole(roleOf(p.id)!) ?? ''));
  // the En front line / area: marked in the tab, else the one a built plan was laid against (pbMeta.enFront)
  const front: EnFront | null = frontValid(opts.front) ? opts.front : frontValid(meta?.enFront) ? meta.enFront as EnFront : null;
  const frontWhy = front ? `the En ${front.kind === 'area' ? 'area' : 'front line'} ${frontValid(opts.front) ? 'marked' : 'the plan was built against'}` : '';
  if (opts.threat) threat = { at: opts.threat, from: 'marker', why: `the threat marker${front ? ` and ${frontWhy}` : ''}` };
  else if (front && ownC && task === 'defence') threat = { at: nearestOnFront(front, ownC).at, from: 'front', why: frontWhy };
  else if (meta?.threat && Number.isFinite(meta.threat.x)) threat = { at: { x: meta.threat.x, y: meta.threat.y }, from: 'plan', why: 'the threat the plan was built against' };
  else if (en.length && task === 'defence') threat = { at: centroid(en.flatMap((s) => (s.pts.length > 3 ? [centroid(s.pts)] : s.pts))), from: 'enemy', why: `the ${en.length} enemy symbols drawn` };
  else if (task === 'defence' && ownC && builtFwd.length && builtBack.length && !allRound) {
    const fc = centroid(builtFwd.map((p) => centroid(p.poly))), bc = centroid(builtBack.map((p) => centroid(p.poly)));
    const d = dist(fc, bc) || 1, far = 10000 * kAt(ownC.y);
    threat = { at: P(ownC.x + ((fc.x - bc.x) / d) * far, ownC.y + ((fc.y - bc.y) / d) * far), from: 'plan', why: 'the built plan\'s own front (its forward posns ahead of its depth)' };
  } else if (task === 'defence' && ownC) {
    // what points at the enemy: arcs of fire, covering troops / security zone, protective minefields, the FEBA; a DCB
    // or ditch only when nothing else is drawn (Demo 2 puts one in depth, on the Line of No Penetration)
    const cue = (s: DrawnSymbol) => s.key === '25152300' || s.key === '25342201' || s.key === '00000161' || isMinefield(s.key) || s.key === '25140400';
    const cues = own.filter(cue);
    const use = cues.length ? cues : own.filter((s) => isObstacleLine(s.key));
    if (use.length) {
      // each cue from the centre of the posns held now (a planned D line far back would pull the centre off the front;
      // the nearest posn is no good either: a protective minefield 200 m out beside an offset posn points sideways)
      const held = posns.filter((p) => !p.planned).map((p) => centroid(p.poly));
      const o = held.length ? centroid(held) : ownC;
      let vx = 0, vy = 0;
      for (const s of use) {
        const c = centroid(s.pts);
        const d = dist(c, o);
        if (d > 0) { vx += (c.x - o.x) / d; vy += (c.y - o.y) / d; }
      }
      const L = Math.hypot(vx, vy);
      const names = use.map((s) => (s.key === '25342201' ? 'covering troops' : s.key === '25152300' ? 'arcs of fire' : isMinefield(s.key) ? 'minefields' : s.name || 'obstacle')).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      if (L / use.length >= 0.5) {
        const far = 10000 * kAt(ownC.y);
        threat = { at: P(ownC.x + (vx / L) * far, ownC.y + (vy / L) * far), from: cues.length ? 'cues' : 'obstacle', why: `the ${names} drawn (assumed: mark the threat to be sure)` };
      } else threat = { at: null, from: 'none', why: `the ${names} drawn lie all round the plan` };
    }
  }
  // a threat on top of the plan gives no direction
  if (threat.at && ownC && dist(threat.at, ownC) / kAt(ownC.y) < 200) { threat = { at: null, from: 'none', why: `${threat.why} lie on the plan itself: mark the threat` }; }
  if (threat.from === 'none' && task === 'defence') unclear.push(`Where the enemy comes from (${threat.why}): mark the threat (step 2) so the front is known`);
  else if (threat.from === 'obstacle' || threat.from === 'cues') unclear.push(`The front is read from ${threat.why}`);

  // the plan's centre: the posns held (a built plan's forward, depth and reserve posns), not its planned alternates,
  // Sup or C Pen posns, so the approaches are sought toward the same centre the build used
  let frame: FitFrame | null = null;
  const core = built && builtFwd.length ? [...builtFwd, ...builtBack] : posns.filter((p) => !p.planned);
  const anchorC = core.length ? centroid(core.map((p) => centroid(p.poly))) : ownC;
  if (task === 'defence' && anchorC && threat.at) {
    // facing an En front: square to the part of it nearest the plan (a window as wide as the posns held), as the build
    const spanM = core.length ? (Math.max(...core.flatMap((p) => p.poly.map((v) => v.x))) - Math.min(...core.flatMap((p) => p.poly.map((v) => v.x)))) / kAt(anchorC.y) : 1000;
    const fb = front ? faceBearing(front, anchorC, Math.max(1000, spanM)) : null;
    const bearing = fb ?? Math.atan2(threat.at.x - anchorC.x, threat.at.y - anchorC.y);
    frame = { anchor: anchorC, bearing, k: kAt(anchorC.y), pivot: P(0, 0) };
  }

  // plan level: the posns' common echelon; a posn holding two or more smaller ones is the plan's own outline
  if (task === 'defence') {
    for (const p of posns) {
      const smaller = posns.filter((q) => q !== p && q.poly.some((v) => inPoly(v, p.poly)) && inPoly(centroid(q.poly), p.poly) && (levelOf(q.ech) ?? 9) < (levelOf(p.ech) ?? 0));
      if (smaller.length >= 2) { p.kind = 'outline'; p.kindWhy = `holds ${smaller.map((q) => q.label).join(', ')}`; }
    }
    const counted = posns.filter((p) => p.kind !== 'outline' && !p.planned && p.ech);
    const tally = new Map<string, number>();
    for (const p of counted) tally.set(p.ech!, (tally.get(p.ech!) ?? 0) + 1);
    // a built plan's posns are one level below its recipe (its Pl posns inside the Coys must not outvote the Coys)
    const posnEch = recipe ? (['14', '15', '16', '18', '21', '22'][(levelOf(recipe.echelon) ?? 2) - 1] ?? null) : [...tally.entries()].sort((a, b) => b[1] - a[1] || (levelOf(b[0]) ?? 0) - (levelOf(a[0]) ?? 0))[0]?.[0] ?? null;
    const outline = posns.find((p) => p.kind === 'outline');
    const planEch = recipe?.echelon ?? (outline?.ech && (levelOf(outline.ech) ?? 0) > (levelOf(posnEch) ?? 0) ? outline.ech : posnEch ? (['14', '15', '16', '18', '21', '22'][(levelOf(posnEch) ?? 1) + 1] ?? null) : null);

    // plan metres
    if (frame) for (const p of posns) {
      const loc = p.poly.map((v) => toLocal(frame!, v));
      const bb = bbox(loc);
      p.c = P((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2); p.w = bb.x1 - bb.x0; p.h = bb.y1 - bb.y0;
      // which way a Battle Posn faces: away from the segment (last point back to the first) that carries its echelon
      // mark, which sits on the rear side (user, 15 Nov 2026)
      const n = loc.length;
      const closed = n < 3 || dist(loc[0], loc[n - 1]) < 0.05 * Math.max(p.w, p.h);
      if (!closed) { const m = P((loc[0].x + loc[n - 1].x) / 2, (loc[0].y + loc[n - 1].y) / 2); p.faceDeg = (Math.atan2(p.c.x - m.x, p.c.y - m.y) * 180) / Math.PI; }
      else p.faceDeg = null;
    }
    // kinds
    const held = posns.filter((p) => p.kind !== 'outline' && !p.planned);
    const tolFront = Number(doctrineAt(doc, 'check.frontTolerance')) || 0.5;
    const cands = held.filter((p) => p.ech === posnEch || !posnEch);
    const maxFront = frame && cands.length ? Math.max(...cands.map((p) => p.c!.y + p.h! / 2)) : 0;
    for (const p of posns) {
      if (p.kind === 'outline') continue;
      const resMark = syms.some((s) => s.side === 'own' && isReserveMark(s) && inPoly(s.pts[0], p.poly)) || /\bres\b|reserve/i.test(p.label);
      if (/dummy|dmy/i.test(p.label) || ['1', '3', '5', '7'].includes(syms.find((s) => s.id === p.id)?.hqtf ?? '0')) { p.kind = 'dummy'; p.kindWhy = 'dummy (HQ / TF digit or label)'; }
      else if (syms.find((s) => s.id === p.id)?.key === '25151201' || /c\s?pen/i.test(p.label)) { p.kind = 'cpen'; p.kindWhy = 'C Pen posn'; }
      else if (/^alt\b|\balt\b/i.test(p.label)) { p.kind = 'alt'; p.kindWhy = 'labelled Alt'; }
      else if (resMark) { p.kind = 'res'; p.kindWhy = 'marked Res'; }
      else if (posnEch && p.ech && (levelOf(p.ech) ?? 9) < (levelOf(posnEch) ?? 0)) { p.kind = 'sub'; p.kindWhy = `a ${echelonLabel(doc, p.ech)} posn inside the plan`; }
      else if (p.planned) {
        const over = held.find((q) => q.id !== p.id && inPoly(centroid(p.poly), q.poly));
        if (over && !p.label.replace(/^\(.*\)$/, '')) { p.kind = 'ignore'; p.kindWhy = `planned outline over ${over.label}`; }
        else { p.kind = 'depth'; p.kindWhy = 'planned (dashed): a depth posn'; }
      } else if (frame) {
        // forward: nothing of its own echelon stands in front of it in its lane (an FDL along a canal or DCB is not a
        // straight line); or its front edge is on the most forward one
        const lane = (q: PosnRead) => Math.min(p.c!.x + p.w! / 2, q.c!.x + q.w! / 2) - Math.max(p.c!.x - p.w! / 2, q.c!.x - q.w! / 2) >= 0.25 * Math.min(p.w!, q.w!);
        const blocker = held.find((q) => q !== p && q.c && (q.ech === p.ech || !p.ech) && lane(q) && q.c.y - p.c!.y > 0.5 * Math.max(p.h!, q.h!));
        const tol = tolFront * (DEPTH_OF[p.ech ?? posnEch ?? '15'] ?? 700);
        if (!blocker || p.c!.y + p.h! / 2 >= maxFront - tol) { p.kind = 'fwd'; p.kindWhy = blocker ? 'its front edge on the FDL' : 'nothing of its size in front of it'; }
        else { p.kind = 'depth'; p.kindWhy = `behind ${blocker.label}`; }
      } else { p.kind = 'fwd'; p.kindWhy = 'no front known: taken as forward'; }
      // a built plan's own role wins over the reading (D Coy is the reserve because it was built as one)
      const role = roleOf(p.id), rk = role ? kindFromRole(role) : null;
      if (rk) { p.kind = rk; p.kindWhy = `built as ${role}`; }
      const set = opts.kinds?.[p.id];
      if (set) { p.kind = set; p.kindWhy = 'set'; }
      if ((p.echBy === 'size' || p.echBy === 'none') && !['ignore', 'outline', 'dummy', 'sub'].includes(p.kind)) unclear.push(`${p.label}: echelon ${p.ech ? `judged a ${echelonLabel(doc, p.ech)} from its size` : 'not known'} (no label or SIDC echelon)`);
    }
    // a Reserves symbol (or a unit labelled Res) standing on its own: the reserve, held at a posn's size round it
    if (frame && posnEch) {
      for (const s of syms.filter((x) => x.side === 'own' && x.geo === 'FPoint' && isReserveMark(x) && !posns.some((p) => inPoly(x.pts[0], p.poly)))) {
        const wM = SIZE_ROWS.find(([e]) => e === posnEch)?.[1] ?? 1500, hM = DEPTH_OF[posnEch] ?? 700;
        const c = toLocal(frame, s.pts[0]);
        const poly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => toWorld(frame, P(c.x + (u * wM) / 2, c.y + (v * hM) / 2)));
        const set = opts.kinds?.[s.id];
        posns.push({ id: s.id, label: s.label ? `Res (${s.label})` : 'Res', kind: set ?? 'res', kindWhy: set ? 'set' : `a ${s.name || 'Reserves'} symbol, held at a ${echelonLabel(doc, posnEch)} posn's size round it`, ech: posnEch, echBy: 'size', echSize: null, planned: s.status === '1', poly, units: [], c, w: wM, h: hM, faceDeg: null });
      }
    }
    return { task, syms, posns, posnEch, planEch, threat, frame, unclear, built: built ? { recipe: recipeId, meta, allRound } : null, front };
  }
  return { task, syms, posns, posnEch: null, planEch: null, threat, frame: null, unclear, built: built ? { recipe: recipeId, meta, allRound } : null, front };
}

// ── the report ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface AttackGroup {
  id: string;
  label: string;
  axis: DrawnSymbol;
  obj: { label: string; pts: XY[] } | null;
  fup: DrawnSymbol | null;
  sl: DrawnSymbol | null;
  bof: DrawnSymbol | null;
  rows: Check[];
  st: CheckState;
  /** 2: a later phase (PlanPhase) from the Obj of the axis `after` names. */
  phase?: number;
  after?: string;
}

export interface CheckReport {
  task: 'defence' | 'attack';
  title: string;
  planEch: string | null;
  /** What was read, one line each. */
  read: string[];
  /** What to confirm: the reading the check is least sure of. */
  unclear: string[];
  posns: PosnRead[];
  /** Per posn (defence) or per axis (attack): the checks. */
  slots: SlotResult[];
  rows: Check[];
  groups: AttackGroup[];
  enemy: EnemySpec;
  terrain: TerrainSpec;
  threat: ThreatRead;
  frame: FitFrame | null;
  fit: FitResult | null;
  /** The what-if on the plan as drawn (defence, with the ground): the trigger table. */
  whatIf?: WhatIfResult | null;
  confirm: string[];
  assumptions: string[];
  mapped: MappedPlan;
}

export interface CheckOptions extends MapOptions {
  /** The user's enemy (step 2); otherwise read from the enemy symbols, else one level up. */
  enemy?: EnemySpec | null;
  /** Part of it set by the user (his echelon or type alone): laid over what the symbols or the default give. */
  enemyOverride?: { echelon?: string; type?: EnemyType } | null;
  /** The user's ground kind, or 'auto' (from symbols drawn, then the bundle, else plains assumed). */
  terrain?: TerrainKind | 'auto' | null;
  ground?: PlanGround | null;
  /** The ORBAT: the enemy's unit for his echelon and type when he is not drawn (Sec 13). */
  orbat?: OrbatSet | null;
}

const worst = (cs: Check[]): CheckState => (cs.some((c) => c.st === 'fail') ? 'fail' : cs.some((c) => c.st === 'warn') ? 'warn' : cs.some((c) => c.st === 'unchecked') ? 'unchecked' : 'pass');

/** The enemy read from the enemy symbols: his biggest echelon, armour if he has any. */
function enemyFromSymbols(syms: DrawnSymbol[], doc: DoctrineSet): EnemySpec | null {
  const en = syms.filter((s) => s.side === 'enemy' && (isUnit(s) || isPosnKey(s.key)));
  if (!en.length) return null;
  const echOf = (s: DrawnSymbol) => (isPosnKey(s.key) ? echelonFromLabel(s.label) ?? s.ech : s.ech ?? echelonFromLabel(s.label));
  const top = en.map(echOf).filter((e): e is string => !!e && levelOf(e) !== null).sort((a, b) => (levelOf(b) ?? 0) - (levelOf(a) ?? 0))[0];
  if (!top) return null;
  const units = en.filter(isUnit);
  const armr = units.filter(isArmour).length, inf = units.length - armr;
  const type: EnemyType = armr && armr >= inf ? 'armd' : armr ? 'mech' : 'inf';
  return { echelon: top, type, source: 'symbols', note: `${en.length} enemy symbols, the biggest a ${echelonLabel(doc, top)}${armr ? `, ${armr} armour` : ''}` };
}

/** Combat strength in rifle-Coy equivalents: the level whose units add up to the most (a Bde and its Bns are not added twice). */
function strengthOfSide(syms: DrawnSymbol[], doc: DoctrineSet): number {
  // per level, the unit symbols or the posns, whichever count more (a Coy drawn as a posn with its unit symbol in it
  // is one Coy, not two); HQ symbols are not a fighting element of their own
  const units = new Map<number, number>(), posns = new Map<number, number>();
  for (const s of syms) {
    const e = isPosnKey(s.key) ? echelonFromLabel(s.label) ?? s.ech : s.ech ?? echelonFromLabel(s.label);
    const l = levelOf(e);
    // planned posns (a D line to be occupied later) and dummies hold nobody now
    if (l === null || !(isUnit(s) || isPosnKey(s.key)) || ['1', '3', '5', '7'].includes(s.hqtf) || s.status === '1') continue;
    if (isUnit(s) && s.hqtf === '2') continue;
    const m = isPosnKey(s.key) ? posns : units;
    m.set(l, (m.get(l) ?? 0) + strengthOf(doc, e));
  }
  const levels = new Set([...units.keys(), ...posns.keys()]);
  return Math.max(0, ...[...levels].map((l) => Math.max(units.get(l) ?? 0, posns.get(l) ?? 0)));
}

export function checkPlan(records: PlanRecord[] | DrawnSymbol[], doc: DoctrineSet, opts: CheckOptions = {}): CheckReport {
  const syms = (records.length && 'drawEss' in (records[0] as any)) ? readSymbols(records as PlanRecord[]) : (records as DrawnSymbol[]);
  const mp = mapPlan(syms, doc, opts);
  return mp.task === 'attack' ? checkAttack(mp, doc, opts) : checkDefence(mp, doc, opts);
}

/** The enemy's strength: counted from his symbols when drawn, else his unit in the ORBAT (Sec 13), else the levels. */
function enemyFromOrbat(mp: MappedPlan, doc: DoctrineSet, opts: CheckOptions, enemy: EnemySpec, kind: TerrainKind): [number | undefined, ForceSides] {
  if (enemy.source === 'symbols') return [strengthOfSide(mp.syms.filter((s) => s.side === 'enemy'), doc) || undefined, {}];
  const b = opts.orbat ? brief(opts.orbat, enUnitFor(enemy.echelon, enemy.type, kind)) : null;
  return b ? [b.coys || undefined, { enName: forceFromOrbat(null, b).enName }] : [undefined, {}];
}

function withOverride(e: EnemySpec, opts: CheckOptions): EnemySpec {
  const o = opts.enemyOverride;
  if (!o || (!o.echelon && !o.type)) return e;
  return { ...e, echelon: o.echelon ?? e.echelon, type: o.type ?? e.type, source: 'user', note: e.note };
}

/** The ground's kind: the user's; else an obstacle drawn in front; else the bundle; else plains, assumed. */
function terrainFor(mp: MappedPlan, doc: DoctrineSet, opts: CheckOptions, res: any, recipe: any): TerrainSpec {
  if (opts.terrain && opts.terrain !== 'auto') return { kind: opts.terrain, source: 'user' };
  // a built plan: the ground it was fitted for (Auto read it there; reading it again could fall either side of a margin)
  const mg = mp.built?.meta?.ground;
  if (mg && ['plains', 'obstacle', 'desert', 'mountain'].includes(mg)) return { kind: mg, source: 'plan', why: `as the plan was built${mp.built?.meta?.groundWhy ? ` (${mp.built.meta.groundWhy})` : ''}` };
  const ob = mp.syms.filter((s) => s.side === 'own' && isDitch(s.key));
  if (ob.length && mp.frame) {
    const fwd = mp.posns.filter((p) => p.kind === 'fwd' && p.c);
    const frontY = fwd.length ? Math.max(...fwd.map((p) => p.c!.y + p.h! / 2)) : 0;
    const ahead = ob.filter((s) => s.pts.some((v) => toLocal(mp.frame!, v).y > frontY - 500));
    if (ahead.length) return { kind: 'obstacle', source: 'symbols', why: `${ahead[0].name || 'DCB'} drawn in front` };
  }
  if (opts.ground && mp.frame && res) {
    const t = detectTerrain(opts.ground, mp.frame, res, recipe, doc);
    if (t) return t;
  }
  return { kind: 'plains', source: 'assumed', why: opts.ground ? 'the ground round it is not loaded yet' : 'no terrain data' };
}

/**
 * A plan built from a mountain recipe (PlanMountain: ridge, penetrant / lateral ridge, pass, valley, the mountain attack):
 * its layout rows on the drawn symbols, as the build gives them. Plan metres from the drawn symbols' roles (pbRole);
 * `layoutRows` reads the En side from where the forward posns lie, so any frame serves. None for another recipe.
 */
function mountainRowsOf(mp: MappedPlan, doc: DoctrineSet, opts: CheckOptions, frame: FitFrame | null): Check[] {
  const id = mp.built?.recipe;
  const recipe = id ? (opts.recipes?.[id] as unknown as Recipe | undefined) : undefined;
  if (!recipe?.layout) return [];
  const own = mp.syms.filter((s) => s.side === 'own' && s.pbRole && s.pts.length);
  if (!own.length) return [];
  // no frame (an attack read as drawn): a local one at the first symbol, metres on the ground (Mercator scaled by 1 / cos lat)
  const f: FitFrame = frame ?? (() => { const a = own[0].pts[0]; return { anchor: { x: a.x, y: a.y }, bearing: 0, k: 1 / Math.cos(2 * Math.atan(Math.exp(a.y / 6378137)) - Math.PI / 2), pivot: { x: 0, y: 0 } }; })();
  // with the ground, the strong points and the Obj are read on the elevation (MW s12 para 9 p 152; s7 para 3 p 78)
  const g = opts.ground;
  const elevAt = g ? (p: XY) => { const w = toWorld(f, p); return g.elev(w.x, w.y); } : undefined;
  return layoutRows(own.map((s) => ({ role: s.pbRole!, label: s.label, pts: s.pts.map((v) => toLocal(f, v)) })), recipe, doc, elevAt);
}

function checkDefence(mp: MappedPlan, doc: DoctrineSet, opts: CheckOptions): CheckReport {
  const frame = mp.frame;
  const posns = mp.posns;
  const active = posns.filter((p) => ['fwd', 'depth', 'res', 'cpen', 'alt', 'sup'].includes(p.kind));
  const fwd = active.filter((p) => p.kind === 'fwd' && p.c).sort((a, b) => a.c!.x - b.c!.x);
  const depth = active.filter((p) => (p.kind === 'depth' || p.kind === 'res') && p.c);
  const planEch = mp.planEch ?? '16';
  const posnEch = mp.posnEch ?? '15';
  const rows: Check[] = [];
  const confirm: string[] = [];
  const range = (path: string) => resolveRange(doc, doctrineAt(doc, path));

  // the slots PlanFit reads (role = posn id)
  // each posn faces the way it was drawn (its open face), to the nearest 30 degrees (the build turns posns by 90 or 120):
  // an all-round plan's rear posn is judged facing out, never through the plan's own middle. Planned posns (alternates,
  // Sup and C Pen) are timed by the what-if, as the build does, not given ground rows of their own.
  const turnOf = (p: PosnRead) => (p.faceDeg == null ? 0 : ((Math.round(p.faceDeg / 30) * 30) % 360 + 360) % 360);
  const slots: SlotResult[] = active.filter((p) => p.c && !['alt', 'sup', 'cpen'].includes(p.kind)).map((p) => ({ role: p.id, label: p.label, kind: p.kind === 'res' ? 'res' : p.kind === 'fwd' ? 'fwd' : 'depth', centre: p.c!, wM: p.w!, hM: p.h!, turnDeg: turnOf(p), checks: [], st: 'unchecked' as CheckState }));
  const recipe: any = { task: 'defence', echelon: planEch, slots: slots.map((s) => ({ role: s.role, kind: s.kind })) };
  const res: any = { slots, items: [], rows: [] };
  const terrain = terrainFor(mp, doc, opts, res, recipe);
  const kind = terrain.kind;
  const me = mp.built?.meta?.enemy;
  const builtEnemy: EnemySpec | null = me?.echelon && me?.type ? { echelon: me.echelon, type: me.type, source: 'plan', note: 'as the plan was built' } : null;
  const enemy = withOverride(opts.enemy ?? enemyFromSymbols(mp.syms, doc) ?? builtEnemy ?? defaultEnemy(doc, planEch, kind, 'defence'), opts);
  // the unit it was built for (ORBAT): its Coys and whether its reserve is mounted
  const unitBase = opts.orbat && mp.built?.meta?.unit ? brief(opts.orbat, mp.built.meta.unit) : null;
  // AT Coys grouped to it when it was built (LAT, HAT): their launchers count for the ATGM pairs and AT cover
  const atg = mp.built?.meta?.atGroup;
  const unitB = opts.orbat && unitBase && atg?.id ? withAtGroup(opts.orbat, unitBase, String(atg.id), Number(atg.coys) || 1, !!atg.byPl) : unitBase;

  // tank Sqns grouped to it when it was built (PlanTanks.withDefTanks): counted in the force as in the build
  const defTk = Number(mp.built?.meta?.defTanks) || 0;
  const tkSqn = defTk && opts.orbat ? tankSqnOf(opts.orbat) : null;
  {
    const [enS, names] = enemyFromOrbat(mp, doc, opts, enemy, kind);
    const defTp = mp.built?.meta?.defTanksUnit === 'Tp';
    const ownF = unitB ? forceFromOrbat(unitB, null, tkSqn, defTk, defTp) : null;
    rows.push(forceRow(doc, 'defence', planEch, enemy, (unitB?.coys ? unitB.coys + (tkSqn ? (defTp ? defTk / 3 : defTk) : 0) : 0) || strengthOfSide(mp.syms.filter((s) => s.side === 'own'), doc) || undefined, enS, { ...names, ownName: ownF?.ownName }, kind));
  }
  rows.push(terrainRow(doc, terrain));

  if (!frame) {
    rows.push({ name: 'Frontage', st: 'unchecked', reason: 'the front is not known: mark the threat' });
  } else if (fwd.length) {
    // frontage across the forward posns, against the row for the plan's echelon on this ground
    const x0 = Math.min(...fwd.map((p) => p.c!.x - p.w! / 2)), x1 = Math.max(...fwd.map((p) => p.c!.x + p.w! / 2));
    const frontageM = x1 - x0;
    const al = frontageAllowance(doc, planEch, kind, fwd.length);
    // a Bn: normal in the plains, extended in the desert and the mountains (IBB S53 p 277, S59 p 325; DW p 24; MW p 148)
    const bnF = planEch === '16' && kind !== 'obstacle' ? bnFrontageCheck(doc, kind, fwd.length, frontageM) : null;
    rows.push(bnF ?? (al
      ? frontageRowCheck(doc, planEch, kind, fwd.length, frontageM)!
      : { name: 'Frontage', st: 'warn', reason: `${fmtM(frontageM)}; no printed frontage for a ${echelonLabel(doc, planEch)} (E)` }));
    // depth: the FDL to the rear of the last posn held now (planned posns are a D line to be occupied later)
    const frontY = Math.max(...fwd.map((p) => p.c!.y + p.h! / 2));
    const rear = Math.min(...[...fwd, ...depth.filter((p) => !p.planned)].map((p) => p.c!.y - p.h! / 2));
    const depthM = frontY - rear;
    const plannedD = depth.filter((p) => p.planned);
    const behindOf = plannedD.map((p) => frontY - p.c!.y);
    const dLine = plannedD.length ? `; planned ${plannedD.map((p) => p.label).join(', ')} centred ${fmtM(Math.max(0, Math.min(...behindOf)))}-${fmtM(Math.max(0, Math.max(...behindOf)))} behind the FDL (a D line, occupied later)` : '';
    const nFwd = fwd.length;
    const unit = planEch === '16' ? (doctrineAt(doc, `terrain.kinds.${kind}.bnFrontageRow`) as string) ?? (nFwd >= 3 ? 'Battalion, three companies up' : nFwd === 2 ? 'Battalion, two companies up' : 'Battalion, normal frontage in the plains') : null;
    const row = unit ? (doc.ocoka?.frontage?.rows ?? []).find((r: any) => r.unit === unit) : null;
    const dr = row?.depthM != null ? resolveRange(doc, row.depthM) : range(`check.planDepthM.${planEch}`);
    // a Coy with all its Pls forward and none in depth (IC s74 para 11 p 391; depth always kept, s84 para 7 c p 447)
    if (planEch === '15' && nFwd >= 3 && !depth.length) rows.push({ name: 'Depth', st: 'warn', reason: `${fmtM(depthM)}, ${nFwd} Pls forward and none in depth: a Coy defends two Pls forward and one in depth; all three up only if the frontage is over extended, the lack of depth fully weighed (IC s74 para 11 p 391; depth at Coy level always retained, s84 para 7 c p 447)${dLine}`,
      detail: { head: 'Three up: no Pl in depth', why: 'Nothing holds a penetration or counter-attacks it (IC s74 para 11 p 391).', fix: ['Two up, one back if the frontage allows it', 'Kept three up: a prepared depth posn the Coy can occupy at short notice, depth behind it from the Bn (IC s84 para 7 b p 447)'] } });
    else rows.push(dr
      ? { name: 'Depth', st: depthM >= dr[0] - 1 && depthM <= dr[1] * 1.25 ? 'pass' : 'warn', reason: `${fmtM(depthM)} from the FDL to the rear of the posns held; ${row ? row.unit : `a ${echelonLabel(doc, planEch)}`} wants ${fmtM(dr[0])}-${fmtM(dr[1])}${dLine}` }
      : { name: 'Depth', st: 'unchecked', reason: `${fmtM(depthM)}; no printed depth for a ${echelonLabel(doc, planEch)}${dLine}` });
    // gaps between neighbouring forward posns
    const gaps: { a: PosnRead; b: PosnRead; g: number }[] = [];
    for (let i = 1; i < fwd.length; i++) gaps.push({ a: fwd[i - 1], b: fwd[i], g: fwd[i].c!.x - fwd[i].w! / 2 - (fwd[i - 1].c!.x + fwd[i - 1].w! / 2) });
    const gmax = gaps.length ? Math.max(...gaps.map((x) => x.g)) : 0;
    const big = (levelOf(planEch) ?? 2) >= 3;
    if (!gaps.length) rows.push({ name: 'Gaps', st: 'pass', reason: 'one posn forward' });
    else if (big || gapsAccepted(doc, kind)) {
      // between Bns and Bdes gaps are accepted (OOW1 p82; desert s22 p68), each closed by an obstacle and fire
      const obst = mp.syms.filter((s) => s.side === 'own' && (isMinefield(s.key) || /^2529/.test(s.key)));
      const open = gaps.filter((x) => x.g > 50 && !obst.some((s) => { const l = s.pts.map((v) => toLocal(frame, v)); const bb = bbox(l); return bb.x1 >= x.a.c!.x + x.a.w! / 2 && bb.x0 <= x.b.c!.x - x.b.w! / 2 && bb.y1 >= frontY - 1500; }));
      rows.push({ name: 'Gaps', st: open.length ? 'warn' : 'pass', reason: `${gaps.map((x) => `${x.a.label} - ${x.b.label} ${fmtM(Math.max(0, x.g))}`).join(', ')}; ${open.length ? `${open.map((x) => `${x.a.label} - ${x.b.label}`).join(', ')} with no minefield or obstacle drawn across it: close it with mines, fire and patrols` : 'each closed by a minefield or obstacle drawn across it'} (gaps between ${big ? 'Bns and Bdes' : 'localities'} are accepted, ${big ? 'OOW1 p82' : 'OOW1 s22 p68'})` });
    } else {
      const gapRow = planEch === '15' ? range('size.pl.gapM') : resolveRange(doc, (doc.ocoka?.frontage?.rows ?? []).find((r: any) => r.unit === 'Company, battalion two up')?.gapM);
      const g = gapRow?.[1] ?? 500;
      rows.push({ name: 'Gaps', st: gmax <= g * 1.1 + 1 ? 'pass' : 'warn', reason: `widest ${fmtM(Math.max(0, gmax))}; the row gives ${fmtM(g)} (${planEch === '15' ? 'IBB Annex U App 5 p480' : 'IBB Annex U App 6 p481'}). Close it with mines, fire and patrols` });
      const ms = resolveRange(doc, doctrineAt(doc, 'checkBands.mutualSupportGapMaxM'))?.[0] ?? 914;
      rows.push({ name: 'Mutual support', st: gmax <= ms ? 'pass' : 'warn', reason: `widest gap ${fmtM(Math.max(0, gmax))}; both neighbours' MGs sweep up to ${fmtM(ms)} (E)` });
    }
    // facing: a Battle Posn's echelon mark (the segment from its last point back to its first) goes on its rear side
    const faced = fwd.filter((p) => p.faceDeg != null);
    const away = faced.filter((p) => Math.abs(((p.faceDeg! + 540) % 360) - 180) > 100);
    rows.push(mp.built?.allRound ? { name: 'Facing the threat', st: 'pass', reason: 'all round: each posn faces out' }
      : !faced.length ? { name: 'Facing the threat', st: 'unchecked', reason: 'no Battle Posn with an echelon mark to read' }
      : away.length ? { name: 'Facing the threat', st: 'warn', reason: `${away.map((p) => p.label).join(', ')} carr${away.length > 1 ? 'y their' : 'ies its'} echelon mark on the side toward the threat: the mark goes on the rear side, or the posn faces the wrong way` }
      : { name: 'Facing the threat', st: 'pass', reason: 'the forward posns face the threat (echelon marks on their rear sides)' });
    // depth and reserve
    rows.push(depth.length
      ? { name: 'Posns in depth', st: 'pass', reason: `${depth.map((p) => p.label).join(', ')}` }
      : { name: 'Posns in depth', st: 'warn', reason: 'nothing in depth: the counter-attack needs depth localities still holding (OOW1 s17 p54)' });
    const resP = active.filter((p) => p.kind === 'res' && p.c);
    const wantMin = resolveRange(doc, doctrineAt(doc, `check.reserveMin.${planEch}`))?.[0] ?? 30;
    if (!resP.length) rows.push({ name: 'Reserve reach', st: 'warn', reason: 'no reserve marked: label one posn Res (or set its role) to check its reach' });
    else {
      const r = resP[0];
      const mounted = !!unitB?.mounted || mp.syms.some((s) => s.side === 'own' && isUnit(s) && isArmour(s) && inPoly(s.pts[0], r.poly));
      // the build's pace (PlanSolve): cpen.footKmPerH, the ground's in desert and mountains; mounted at the vehicle rate
      const kmh = mounted ? (resolveRange(doc, doctrineAt(doc, 'moves.tankKmh.go'))?.[0] ?? 24) : kind === 'desert' || kind === 'mountain' ? footKmh(doc, kind).go : (resolveRange(doc, doctrineAt(doc, 'cpen.footKmPerH'))?.[0] ?? 5);
      const behind = resolveRange(doc, doctrineAt(doc, (levelOf(planEch) ?? 2) >= 2 ? 'cpen.behindFwdM.bn' : 'cpen.behindFwdM.coy'))?.[0] ?? 400;
      const far = Math.max(...fwd.map((p) => dist(r.c!, P(p.c!.x, p.c!.y - p.h! / 2 - behind))));
      const settle = resolveRange(doc, doctrineAt(doc, 'cpen.settleMin'))?.[0] ?? 5;
      const min = Math.round((far / 1000 / kmh) * 60 + settle);
      rows.push({ name: 'Reserve reach', st: min <= wantMin ? 'pass' : 'warn', reason: `${r.label} to behind the farthest forward posn in ${min} min ${mounted ? 'mounted' : 'on foot'}, straight line (wants ${wantMin} min)` });
      confirm.push(`${r.label}: walk (or drive) the routes to the counter-attack and C Pen posns and time them`);
    }
    // alternates (Coy and Bn plans; Bdes and Divs use a D line, Demo 2)
    if ((levelOf(planEch) ?? 2) <= 2) {
      const alts = active.filter((p) => p.kind === 'alt');
      rows.push(alts.length ? { name: 'Alternates', st: alts.length >= fwd.length ? 'pass' : 'warn', reason: `${alts.length} drawn for ${fwd.length} forward posns` } : { name: 'Alternates', st: 'warn', reason: 'none drawn: each forward posn wants one, outside its beaten zone, with a covered route' });
    }
  }

  // each posn: its size against its echelon
  const slack = Number(doctrineAt(doc, 'check.sizeSlack')) || 1.25;
  for (const s of slots) {
    const p = posns.find((x) => x.id === s.role)!;
    // planned posns (alternates, Sup, C Pen) are sized by the plan, not held to an echelon
    if (!['fwd', 'depth', 'res'].includes(p.kind)) continue;
    let max = resolveRange(doc, doctrineAt(doc, `check.posnFrontageM.${p.ech}`))?.[1] ?? null;
    if (p.ech === '16') { const al = frontageAllowance(doc, '16', kind, 3); if (al) max = Math.max(max ?? 0, al.range[1]); }
    // a Coy on a canal or ditch may hold 1500-2000 m with three Pls up (IC s85 para 11 p 455)
    if (p.ech === '15' && kind === 'obstacle') { const al = frontageAllowance(doc, '15', kind, 3); if (al) max = Math.max(max ?? 0, al.range[1]); }
    if (!max) { s.checks.push({ name: 'Size', st: 'unchecked', reason: `echelon ${p.ech ?? 'not known'}: no size to hold it to` }); continue; }
    const w = s.wM;
    const note = p.echSize && p.ech && p.echSize !== p.ech && w > max * slack ? ` (its size is a ${echelonLabel(doc, p.echSize)}'s)` : '';
    s.checks.push(w <= max + 1
      ? { name: 'Size', st: 'pass', reason: `${fmtM(w)} across; a ${echelonLabel(doc, p.ech)} holds up to ${fmtM(max)}` }
      : { name: 'Size', st: w <= max * slack ? 'warn' : 'fail', reason: `${fmtM(w)} across; a ${echelonLabel(doc, p.ech)} holds ${fmtM(max)}${p.ech === '15' || p.ech === '14' ? `, and its frontage is not extended (IBB S59 para 6 b p 326; IC s84 para 6 b p 446)${p.ech === '15' && kind !== 'obstacle' ? '; on a canal or ditch a Coy three Pls up may hold 1500-2000 m (IC s85 para 11 p 455)' : ''}` : ''}${note}` });
  }

  // on the ground: PlanFit, reading only (never sliding)
  let fit: FitResult | null = null;
  let whatIfRes: WhatIfResult | null = null;
  if (frame && opts.ground && slots.length) {
    const enSyms = mp.syms.filter((s) => s.side === 'enemy');
    const axes = enSyms.filter((s) => isAxisKey(s.key) && s.pts.length >= 2);
    const centre = centroid(posns.flatMap((p) => p.poly));
    let approaches: GroundAvenue[] | undefined;
    if (axes.length) {
      const g = opts.ground;
      const going = g.going(enemyProfile(doc, enemy.type));
      approaches = axes.map((a) => {
        const pts = dist(a.pts[0], centre) < dist(a.pts[a.pts.length - 1], centre) ? [...a.pts].reverse() : [...a.pts];
        const path = densify(pts, 100 * frame.k);
        let n = 0, slow = 0;
        for (const p of path) { const c = g.cls(p.x, p.y); if (c === null) continue; n++; if (going.caution.has(c) || going.nogo.has(c)) slow++; }
        const widthM = a.base ? dist(a.base.start, a.base.end) / frame.k : 0;
        const lengthM = path.reduce((acc, p, i) => acc + (i ? dist(path[i - 1], p) / frame.k : 0), 0);
        return { path, lengthM, goPct: n ? (100 * (n - slow)) / n : 100, minWidthM: widthM, chokes: [] };
      });
    }
    const enFupSym = enSyms.find((s) => s.key === '25140302');
    // a front read from an obstacle or minefield gives the direction, not where he starts: assumed out along the front
    const start = mp.threat.from === 'marker' || mp.threat.from === 'enemy' || (mp.threat.from === 'plan' && mp.built?.meta?.threat) ? mp.threat.at : null;
    fit = fitPlan({ res, recipe, doc, frame, ground: opts.ground, threat: start, approaches, enemy, terrain, checkOnly: true, enFup: enFupSym ? centroid(enFupSym.pts) : null, front: mp.front ?? null });
    for (const s of slots) s.checks.push(...(fit.slots[s.role] ?? []));
    // the obstacle drawn (a DCB or AT ditch is not in the bundle): its tie-in read from the symbol, not the ground
    const drawnOb = mp.syms.filter((s) => s.side === 'own' && isDitch(s.key));
    if (terrain.source === 'symbols' && drawnOb.length && fwd.length) {
      // a Coy / Pl plan: IC's band (s72 para 6 b p 372; s76 para 11 e p 417), as the fit reads it
      const band = ((planEch === '15' || planEch === '14') ? resolveRange(doc, doctrineAt(doc, 'checkBands.fieldOfFireToObstacleCoyM')) : null) ?? resolveRange(doc, doctrineAt(doc, 'terrain.kinds.obstacle.tieInM')) ?? [250, 700];
      const lines = drawnOb.map((s) => s.pts.map((v) => toLocal(frame, v)));
      const at: string[] = [], far: string[] = [];
      for (const p of fwd) {
        const front = [P(p.c!.x - p.w! / 2, p.c!.y + p.h! / 2), P(p.c!.x, p.c!.y + p.h! / 2), P(p.c!.x + p.w! / 2, p.c!.y + p.h! / 2)];
        const d = Math.min(...lines.map((l) => setDist(front, l)));
        (d <= band[1] ? at : far).push(`${p.label} ${fmtM(d)}`);
      }
      const name = drawnOb[0].name || 'DCB';
      fit.rows = fit.rows.filter((r) => r.name !== 'Obstacle tie-in');
      fit.rows.push(far.length
        ? { name: 'Obstacle tie-in', st: 'warn', reason: `the ${name} drawn is ${far.join(', ')} in front: beyond the MGs (${fmtM(band[1])}, ${planEch === '15' || planEch === '14' ? 'the LMGs\' 500 m line, IC s76 para 11 e p 417' : 'E'}). Held so far forward it is the advance posn's obstacle (OOW1 s5 p 14: the advance position is usually based on a natural obstacle); else move the FDL up to it${at.length ? `; ${at.join(', ')} on it` : ''}` }
        : { name: 'Obstacle tie-in', st: 'pass', reason: `the ${name} under the forward posns' fire: ${at.join(', ')}` });
    }
    rows.push(...fit.rows);
    // as the build does: AT cover from the drawn ATGMs, the what-if and its trigger table (alternates paired by letter:
    // Alt A -> A Coy), so a built plan checked again gives the build's verdicts
    const items: any[] = mp.syms.filter((s) => s.side === 'own' && s.key === '15111200' && s.pts.length).map((s) => ({ role: 'atgm', key: s.key, pts: [toLocal(frame, s.pts[0])] }));
    // tank Sqns grouped to it when it was built: read from their symbols, for the leaguer and the C Pen moves
    for (const s of mp.syms.filter((x) => x.side === 'own' && x.pbRole && /^tkSqn\d*$/.test(x.pbRole) && x.pts.length)) items.push({ role: s.pbRole, key: s.key, label: s.label || s.pbRole, pts: [toLocal(frame, s.pts[0])] });
    const atRow = atCoverRow({ ...res, items } as any, recipe, unitB, fit.approaches, frame, doc, enemy);
    if (atRow) rows.push(atRow);
    if (defTk) rows.push(...defTankRows(items, { ...recipe, defTanks: defTk, defTanksUnit: mp.built?.meta?.defTanksUnit === 'Tp' ? 'Tp' : 'Sqn', tankSqn: tkSqn ?? undefined }, frame, opts.ground, doc, fit.from ?? null));
    // the artillery it was built with: its gun area, the FDL and the DF Tgts read from their symbols, judged as the build did
    const artyMeta = mp.built?.meta?.arty;
    if (artyMeta) {
      const own = (role: string) => mp.syms.filter((x) => x.side === 'own' && x.pbRole === role && x.pts.length).map((x) => ({ role, pts: x.pts.map((v) => toLocal(frame, v)) }));
      // every Regt's gun area and every section of one laid by sections (gunArea, gunArea2 ...; gunAreaS2 ...: G on mountain ground)
      const guns = mp.syms.filter((x) => x.side === 'own' && x.pbRole && GUN_ROLES.test(x.pbRole) && x.pts.length).map((x) => ({ role: x.pbRole!, pts: x.pts.map((v) => toLocal(frame, v)) }));
      rows.push(...artyRows([...guns, ...own('fdl'), ...own('dfTgt')], { ...recipe, task: 'defence', arty: artyMeta }, enemyFupM(doc, enemy.type)[0], frame, opts.ground));
    }
    // the AD it was built with (pbMeta.ad): its FUs and the VPs read from their symbols, judged as the build did
    const adMeta = mp.built?.meta?.ad;
    if (adMeta) rows.push(...adRows(mp.syms.filter((x) => x.side === 'own' && x.pbRole && AD_ROLES.test(x.pbRole) && x.pts.length).map((x) => ({ role: x.pbRole!, label: x.label, pts: x.pts.map((v) => toLocal(frame, v)) })), { ad: adMeta }, kind));
    const alternates = active.filter((p) => p.kind === 'alt' && p.c).map((a) => {
      const letter = a.label.replace(/^alt\s*/i, '').trim().split(/\s+/)[0];
      const of = fwd.find((x) => x.label.split(/\s+/)[0] === letter);
      return of ? { of: of.id, ofLabel: of.label, label: a.label, centre: a.c!, min: 0 } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    const raw: any = { ...res, recipe, alternates, items };
    // the Sup and C Pen posns drawn on the map (a built plan's, or the user's): timed where they are, not sited again
    const drawn = {
      sups: active.filter((p) => p.kind === 'sup' && p.c).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).map((p) => ({ label: p.label, centre: p.c! })),
      cpen: active.find((p) => p.kind === 'cpen' && p.c)?.c ?? null,
    };
    whatIfRes = whatIf({ recipe, raw, res: raw, fit, frame, anchor: frame.anchor, bearing: frame.bearing, manual: {}, terrain, enemy, unit: unitB, drawnMoves: drawn } as any, opts.ground, doc, start);
    const mr = movesRow(whatIfRes);
    if (mr) rows.push(mr);
    const tc = defTk ? tankCoverRow(raw, recipe, whatIfRes, fit, frame, doc) : null;
    if (tc) rows.push(tc);
    const rs = slots.find((x) => x.kind === 'res');
    const rc = rs ? reserveMovesCheck(whatIfRes, rs.label) : null;
    if (rs && rc) rs.checks.push(rc);
    if (axes.length) rows.push({ name: 'Drawn en axes', st: 'pass', reason: `${axes.length} enemy axes read as the En approaches (${axes.map((a) => a.label || a.name).join(', ')})` });
  } else {
    for (const s of slots) s.checks.push({ name: 'Ground', st: 'unchecked', reason: frame ? 'needs terrain data' : 'the front is not known' });
    for (const n of ['Approaches covered', 'Fields of fire', 'Flanks', 'Exposure']) rows.push({ name: n, st: 'unchecked', reason: opts.ground ? 'the front is not known: mark the threat' : 'needs terrain data' });
    // the En front is geometry: read without the terrain too
    if (frame && mp.front && slots.length) rows.push(...frontCheckRows(res, recipe, doc, frame, mp.front));
  }
  if (opts.orbat && fwd.length) {
    const fm = Math.max(...fwd.map((p) => p.c!.x + p.w! / 2)) - Math.min(...fwd.map((p) => p.c!.x - p.w! / 2));
    // the engineers it was built with (pbMeta.engr): their Pls and MMLs; else the doctrine's one Fd Coy
    const whole = mp.built?.meta?.engr ? ownEngrTypes(opts.orbat).find((e) => e.id === mp.built!.meta.engr) ?? null : null;
    const engr = whole && mp.built?.meta?.engrCoys ? engrShare(whole, Number(mp.built.meta.engrCoys)) : whole;
    const m = minefieldRow(opts.orbat, doc, fm, unitB ?? (opts.orbat ? brief(opts.orbat, 'inf-bn-std') : null), engr);
    if (m) rows.push(m);
    // the inundation belt it was built with (pbMeta.inund), timed across the front as drawn
    const inu = mp.built?.meta?.inund ? inundation(opts.orbat.engrData ?? [], fm, engr, mp.built.meta.inund) : null;
    if (inu) rows.push(inu.row);
  }
  for (const s of slots) s.st = worst(s.checks);
  for (const p of posns.filter((x) => x.kind === 'fwd' || x.kind === 'res')) confirm.push(`${p.label}: the ground, fields of fire and dead ground in front`);
  confirm.push('The enemy approaches, and that each is covered by fire');

  const title = `${echelonLabel(doc, planEch)} defence: ${fwd.length} forward, ${depth.filter((p) => p.kind === 'depth').length} in depth, ${active.filter((p) => p.kind === 'res').length} reserve`;
  const read = [
    `${mp.syms.filter((s) => s.side === 'own').length} own, ${mp.syms.filter((s) => s.side === 'enemy').length} enemy, ${mp.syms.filter((s) => s.side === 'other').length} other symbols (freehand and unknown left out)`,
    `Posns: ${posns.filter((p) => !['ignore'].includes(p.kind)).map((p) => `${p.label} ${p.kind}`).join(', ') || 'none'}; posns are ${echelonLabel(doc, posnEch)}s, so this is a ${echelonLabel(doc, planEch)} plan`,
    `Front: ${mp.threat.why}`,
    ...(mp.built ? [`Built by the Intelligent Deployment tab${mp.built.recipe ? ` (${mp.built.recipe})` : ''}: read with its own roles${mp.built.meta ? ', ground, enemy and threat' : ''}, as it was built`] : []),
    `Enemy: ${echelonLabel(doc, enemy.echelon)} ${String(doctrineAt(doc, `enemy.types.${enemy.type}.label`) ?? enemy.type)} (${enemy.source === 'symbols' ? enemy.note : enemy.source === 'user' ? 'as set' : enemy.source === 'plan' ? 'as the plan was built for' : 'assumed one level up'})`,
    `Ground: ${terrainLabel(doc, kind)} (${terrain.source}${terrain.why ? `: ${terrain.why}` : ''})`,
  ];
  const assumptions = [
    'Read as drawn: nothing was moved.',
    mp.threat.from === 'marker' ? 'The threat is where it was marked.' : `The threat is read from ${mp.threat.why}.`,
    'Frontages from the own rows (IBB Annex U / V, OOW1; the Foxland rows of IC s113-114 are the En\'s); the en force from the En echelon (about three of the level below each level up, E).',
  ];
  const unclear = [...mp.unclear];
  if (terrain.source === 'assumed') unclear.push(`Ground taken as plains (${terrain.why}): set it if the plan stands on an obstacle, desert or mountains, which allow wider frontages`);
  // a built C Tps plan: the main-defence rows that do not apply dropped (PlanCtps.ctpsOverride)
  const builtRecipe = mp.built?.recipe ? (opts.recipes?.[mp.built.recipe] as unknown as Recipe | undefined) : undefined;
  return { task: 'defence', title, planEch, read, unclear, posns, slots, rows: ctpsOverride(groundNotes([...rows, ...mountainRowsOf(mp, doc, opts, frame), ...(terrain.kind === 'mountain' ? [rearAreaRow(mp.syms.filter((s) => s.side === 'own' && s.pbRole).map((s) => ({ role: s.pbRole!, label: s.label, pts: s.pts })))].filter((r): r is Check => !!r) : [])], doc, terrain.kind, 'defence', planEch ?? '16', null), builtRecipe), groups: [], enemy, terrain, threat: mp.threat, frame, fit, whatIf: whatIfRes, confirm, assumptions, mapped: mp };
}

function checkAttack(mp: MappedPlan, doc: DoctrineSet, opts: CheckOptions): CheckReport {
  const own = mp.syms.filter((s) => s.side === 'own'), en = mp.syms.filter((s) => s.side === 'enemy');
  const axes = own.filter((s) => isAxisKey(s.key) && s.pts.length >= 2);
  const fups = own.filter((s) => s.key === '25140302'), sls = own.filter((s) => s.key === '25140303'), bofs = own.filter((s) => s.key === '25152100' || s.key === '25152000');
  const objs = [
    ...en.filter((s) => isPosnKey(s.key) && s.pts.length >= 3).map((s) => ({ label: s.label || s.name, pts: s.pts })),
    ...own.filter((s) => s.key === '25151700' && s.pts.length >= 3).map((s) => ({ label: s.label || 'Obj', pts: s.pts })),
  ];
  const anyY = (own[0] ?? en[0])?.pts[0]?.y ?? 0;
  const k = kAt(anyY);
  const m = (a: number) => a / k;   // Mercator units to ground metres
  const rows: Check[] = [];
  const confirm: string[] = [];
  const range = (path: string) => resolveRange(doc, doctrineAt(doc, path));
  const ownEch = (() => { const s = strengthOfSide(own, doc); return s >= 27 ? '21' : s >= 9 ? '18' : s >= 3 ? '16' : '15'; })();
  const enemy = withOverride(opts.enemy ?? enemyFromSymbols(mp.syms, doc) ?? defaultEnemy(doc, ownEch, null, 'attack'), opts);
  // the ground's kind as the build reads it: the user's; a built plan's own; else the bundle round the Obj (mountains,
  // desert: the same detectTerrain the build runs); else plains, assumed
  const terrain: TerrainSpec = (() => {
    if (opts.terrain && opts.terrain !== 'auto') return { kind: opts.terrain, source: 'user' } as TerrainSpec;
    const mg = mp.built?.meta?.ground;
    if (mg && ['plains', 'obstacle', 'desert', 'mountain'].includes(mg)) return { kind: mg, source: 'plan', why: `as the plan was built${mp.built?.meta?.groundWhy ? ` (${mp.built.meta.groundWhy})` : ''}` } as TerrainSpec;
    const o = objs[0]?.pts;
    if (opts.ground && o?.length) {
      const c = { x: o.reduce((a, p) => a + p.x, 0) / o.length, y: o.reduce((a, p) => a + p.y, 0) / o.length };
      const f: FitFrame = { anchor: c, bearing: 0, k: kAt(c.y), pivot: { x: 0, y: 0 } };
      const t = detectTerrain(opts.ground, f, { slots: [], items: [] } as any, { slots: [] } as any, doc);
      if (t) return t;
    }
    return { kind: 'plains', source: 'assumed', why: opts.ground ? 'the ground round the Obj is not loaded yet' : 'set the Ground if the attack goes over an obstacle, desert or mountains' } as TerrainSpec;
  })();
  { const [enS, names] = enemyFromOrbat(mp, doc, opts, enemy, terrain.kind); rows.push(forceRow(doc, 'attack', ownEch, enemy, strengthOfSide(own, doc) || undefined, enS, names, terrain.kind)); }
  rows.push(terrainRow(doc, terrain));
  // the artillery it was built with (pbMeta.arty): its gun area, the FUP, the Obj and the LOE read from their symbols, in
  // metres from the FUP toward the Obj, judged as the build did (Arty reach)
  const artyMeta = mp.built?.meta?.arty;
  if (artyMeta) {
    const byRole = (r: string) => own.filter((s) => s.pbRole === r && s.pts.length);
    const fu = byRole('fup')[0], ob = byRole('obj')[0];
    if (fu && ob) {
      const F0 = centroid(fu.pts), O0 = centroid(ob.pts), L = Math.hypot(O0.x - F0.x, O0.y - F0.y) || 1;
      const u = P((O0.x - F0.x) / L, (O0.y - F0.y) / L);
      const loc = (p: XY) => P(((p.x - F0.x) * u.y - (p.y - F0.y) * u.x) / k, ((p.x - F0.x) * u.x + (p.y - F0.y) * u.y) / k);
      const items = [...own.filter((s) => s.pbRole && GUN_ROLES.test(s.pbRole) && s.pts.length).map((s) => ({ role: s.pbRole!, pts: s.pts.map(loc) })), ...['fup', 'obj', 'obj2', 'loe'].flatMap((r) => byRole(r).map((s) => ({ role: r, pts: s.pts.map(loc) })))];
      rows.push(...artyRows(items, { task: 'attack', arty: artyMeta } as any, null));
    }
  }
  // the AD it was built with (pbMeta.ad): its FUs and the VPs (the gun area, the HQ, the Assy, the reserve) as drawn
  const adMeta = mp.built?.meta?.ad;
  if (adMeta) rows.push(...adRows(own.filter((s) => s.pbRole && AD_ROLES.test(s.pbRole) && s.pts.length).map((s) => ({ role: s.pbRole!, label: s.label, pts: s.pts.map((p) => P(p.x / k, p.y / k)) })), { ad: adMeta }, terrain.kind));
  // built for the Air Aslt Bn: its lift by the Air Aslt Sqn (PlanAvn)
  const lift = opts.orbat ? airLiftOf(opts.orbat, mp.built?.meta?.unit, doc) : null;
  if (lift) rows.push(airLiftRow(lift));
  // the FUP band is a night figure (IC s68 para 12 e (1) p 333): a built plan's light is the one it was built for, else not known
  const nightAt = typeof mp.built?.meta?.night === 'boolean' ? mp.built.meta.night as boolean : null;
  const slBand = range('check.slAxisDeg') ?? [60, 120];
  const bofMin = range('attack.bofFlankMinDeg')?.[0] ?? 30, bofMax = range('attack.bofRangeMaxM')?.[0] ?? 1189;
  // the assault row by the echelon attacking (PlanDoctrine attack.assaultRowByEch: a Coy 250 m, a Bn two up 450-650 m,
  // IBB S47 para 17 a p 248; a Bde GSP p 86); a built plan's echelon is its recipe's
  const byEch = doctrineAt(doc, 'attack.assaultRowByEch') as Record<string, string> | undefined;
  const asltName = String((mp.planEch && byEch?.[mp.planEch]) ?? doctrineAt(doc, 'attack.assaultRow') ?? '');
  const aslt = (doc.ocoka?.frontage?.rows ?? []).find((r: any) => r.unit === asltName);
  const asltMax = aslt ? resolveRange(doc, aslt.frontageM)?.[1] ?? 400 : 400;

  const groups: AttackGroup[] = [];
  // each axis: its head the end nearer an objective, the posn there (inside several, a Coy posn inside its Bn's
  // outline, the smallest)
  const pre = axes.map((a) => {
    const ends = [a.pts[0], a.pts[a.pts.length - 1]];
    const near = (p: XY) => (objs.length ? Math.min(...objs.map((o) => (inPoly(p, o.pts) ? 0 : setDist([p], o.pts)))) : Infinity);
    const headFirst = near(ends[0]) < near(ends[1]);
    const head = headFirst ? ends[0] : ends[1], tail = headFirst ? ends[1] : ends[0];
    const areaOf = (q: XY[]) => { const b = bbox(q); return (b.x1 - b.x0) * (b.y1 - b.y0); };
    const obj = objs.length ? objs.map((o) => ({ o, d: inPoly(head, o.pts) ? 0 : setDist([head], o.pts), a: areaOf(o.pts) })).sort((x, y) => x.d - y.d || x.a - y.a)[0] : null;
    return { head, tail, objOk: obj && m(obj.d) <= 2000 ? obj.o : null };
  });
  // phases (PlanPhase): an axis that starts beside another axis's Obj and goes on to a deeper one is a later phase from
  // it (IBB p186: the follow-up Coys round Obj 1 onto Obj 2); a built plan says so by its roles (axis2 after axis)
  const after = new Map<number, number>();
  const gapToPts = (p: XY, pts: XY[]) => m(inPoly(p, pts) ? 0 : setDist([p], pts));
  // the tanks' own axis (PlanTanks) is neither a later phase nor the one a later phase goes on from
  const isTankAxis = (s: DrawnSymbol) => s.pbRole === 'tkAxis' || /^tks?\b/i.test(s.label ?? '');
  axes.forEach((a, i) => {
    if (a.pbRole === 'axis2') { const j = axes.findIndex((x) => x.pbRole === 'axis'); if (j >= 0 && j !== i) after.set(i, j); return; }
    if (a.pbRole || isTankAxis(a)) return;
    const g = pre[i];
    if (!g.objOk) return;
    for (let j = 0; j < pre.length; j++) {
      const o = pre[j].objOk;
      if (j === i || !o || o === g.objOk || after.get(j) === i || isTankAxis(axes[j])) continue;
      const deeper = dist(centroid(g.objOk.pts), pre[j].tail) > dist(centroid(o.pts), pre[j].tail);
      if (gapToPts(g.tail, o.pts) <= 1500 && deeper) { after.set(i, j); break; }
    }
  });
  const clear1 = range('attack.phase2.clearObj1M')?.[0] ?? 300;
  axes.forEach((a, i) => {
    const { head, tail, objOk } = pre[i];
    // a later phase: the Obj taken before it is the firm base that fires for it (IBB p189 para 23)
    const prevI = after.get(i), prev = prevI !== undefined ? pre[prevI] : null;
    const fup = fups.map((f) => ({ f, d: dist(centroid(f.pts), tail) })).sort((x, y) => x.d - y.d)[0];
    const fupOk = fup && m(fup.d) <= 4000 ? fup.f : null;
    // the tanks' own axis (PlanTanks): by role, its label, or armour at an FUP beyond the infantry's distance (IBB p214)
    const tankAxis = isTankAxis(a) || (!!fupOk && !!objOk && m(setDist(fupOk.pts, objOk.pts)) >= 2000 && own.some((s) => isUnit(s) && isArmour(s) && m(dist(s.pts[0], centroid(fupOk.pts))) < 600));
    const axisDir = Math.atan2(head.x - tail.x, head.y - tail.y);
    const along = (p: XY) => ((p.x - tail.x) * Math.sin(axisDir) + (p.y - tail.y) * Math.cos(axisDir)) / Math.max(1, dist(tail, head));
    const sl = sls.map((s) => ({ s, d: setDist(s.pts, [tail, head]), t: along(centroid(s.pts)) })).filter((x) => x.t > -0.3 && x.t < 1.0 && m(x.d) < 1500).sort((x, y) => x.d - y.d)[0]?.s ?? null;
    const oc = objOk ? centroid(objOk.pts) : head;
    const bof = bofs.map((b) => ({ b, d: dist(centroid(b.pts), oc) })).sort((x, y) => x.d - y.d)[0];
    const bofOk = bof && m(bof.d) <= 2500 ? bof.b : null;
    const label = a.label || `Axis ${i + 1}`;
    const gr: Check[] = [];
    if (!objOk) gr.push({ name: 'Objective', st: 'warn', reason: 'no enemy posn or Obj within 2 km of its head: draw the Obj' });
    if (prev && fupOk && objOk) {
      // FUP 2: as any night FUP, 1000-1200 m in the plains (IC s68 para 12 e (1) p 333); by day no distance (s66 para 8 c)
      const d = m(setDist(fupOk.pts, objOk.pts));
      gr.push(fupFromObjCheck(doc, d, nightAt, { which: 'fup2', obj: `${objOk.label}'s` }));
    } else if (fupOk && objOk) {
      const d = m(setDist(fupOk.pts, objOk.pts));
      const tanks = own.some((s) => isUnit(s) && isArmour(s) && m(dist(s.pts[0], centroid(fupOk.pts))) < 1500);
      // 1 m either way (fupFromObjCheck): a plan laid at exactly 1000 m reads 999.99 m back through Web Mercator
      gr.push(fupFromObjCheck(doc, d, nightAt, { tanks }));
    } else gr.push({ name: 'FUP from the Obj', st: 'warn', reason: fupOk ? 'no Obj to measure to' : 'no FUP drawn within 4 km of the axis tail' });
    if (tankAxis) {
      // the tanks cross no SL of their own and need no BOF: they are timed to the infantry's (IBB p187)
    } else if (sl) {
      const s0 = sl.pts[0], s1 = sl.pts[sl.pts.length - 1];
      const slDir = Math.atan2(s1.x - s0.x, s1.y - s0.y);
      let ang = Math.abs(((slDir - axisDir) * 180) / Math.PI) % 180;
      if (ang > 90) ang = 180 - ang;
      const sq = 90 - ang;   // 0 = square to the axis
      gr.push({ name: 'SL square to the axis', st: 90 - sq >= slBand[0] && 90 - sq <= slBand[1] ? 'pass' : 'warn', reason: `${sl.label || 'SL'} lies ${Math.round(ang)}° to the axis (wants ${slBand[0]}-${slBand[1]}°, E)` });
      if (fupOk && objOk) {
        const tF = along(centroid(fupOk.pts)), tS = along(centroid(sl.pts)), tO = along(centroid(objOk.pts));
        gr.push({ name: 'SL between FUP and Obj', st: tS > tF && tS < tO ? 'pass' : 'warn', reason: tS > tF && tS < tO ? `${sl.label || 'SL'} ${fmtM(m(setDist(sl.pts, objOk.pts)))} short of the Obj` : `${sl.label || 'SL'} is not between the FUP and the Obj` });
      }
    } else gr.push({ name: 'SL square to the axis', st: 'warn', reason: 'no SL drawn across this axis' });
    if (prev?.objOk && objOk) {
      // a later phase: the Obj taken before it fires for it, and it comes round that Obj from a new direction
      const o1 = prev.objOk, c1 = centroid(o1.pts), c2 = centroid(objOk.pts);
      const d12 = m(setDist(o1.pts, objOk.pts));
      let off = Math.abs(((Math.atan2(c2.x - c1.x, c2.y - c1.y) - axisDir) * 180) / Math.PI) % 360; if (off > 180) off = 360 - off;
      gr.push({ name: 'Ph 2 fire base', st: d12 <= bofMax && off >= bofMin ? 'pass' : 'warn', reason: `${o1.label}, held as the firm base (IBB p189 para 23), ${fmtM(d12)} from ${objOk.label} (106 mm RR reaches ${fmtM(bofMax)}), firing ${Math.round(off)}° across this axis (wants ${bofMin}° or more)` });
      const lineGap = (pts: XY[], poly: XY[]) => {
        let best = Infinity;
        for (let k = 1; k < pts.length; k++) {
          const p0 = pts[k - 1], p1 = pts[k], n = Math.max(1, Math.ceil(m(dist(p0, p1)) / 50));
          for (let s = 0; s <= n; s++) best = Math.min(best, gapToPts(P(p0.x + ((p1.x - p0.x) * s) / n, p0.y + ((p1.y - p0.y) * s) / n), poly));
        }
        return best;
      };
      const g1 = Math.min(lineGap(a.pts, o1.pts), fupOk ? lineGap([centroid(fupOk.pts), tail], o1.pts) : Infinity);
      const prevDir = Math.atan2(prev.head.x - prev.tail.x, prev.head.y - prev.tail.y);
      let turn = Math.abs(((axisDir - prevDir) * 180) / Math.PI) % 360; if (turn > 180) turn = 360 - turn;
      // a new direction (IBB p186: to avoid massing, for surprise): turned off phase 1's axis, or in a lane of its own
      // beside it (a flank attack rolled up from the same side); either reading is E
      const pl = Math.max(1, dist(prev.tail, prev.head));
      const lane = m(Math.abs((tail.x - prev.tail.x) * (prev.head.y - prev.tail.y) - (tail.y - prev.tail.y) * (prev.head.x - prev.tail.x)) / pl);
      const newDir = turn >= bofMin || lane >= clear1 - 1;
      gr.push({ name: 'Ph 2 direction', st: g1 >= clear1 - 1 && newDir ? 'pass' : 'warn', reason: `${fmtM(g1)} off ${o1.label} (wants ${clear1} m: not through the Coys reorganising on it); ${Math.round(turn)}° off the phase 1 axis${turn < bofMin ? `, its lane ${fmtM(lane)} from phase 1's` : ''} (a new direction, IBB p186: turned ${bofMin}° or more, or a lane of its own ${clear1} m or more aside, E)` });
    } else if (tankAxis) {
      // see above
    } else if (bofOk && objOk) {
      const bp = centroid(bofOk.pts);
      const bofDir = Math.atan2(oc.x - bp.x, oc.y - bp.y);
      let off = Math.abs(((bofDir - axisDir) * 180) / Math.PI) % 360; if (off > 180) off = 360 - off;
      gr.push({ name: 'BOF on a flank', st: off >= bofMin ? 'pass' : 'warn', reason: `fires ${Math.round(off)}° off the axis (wants ${bofMin}° or more, E)` });
      // to the Obj's near edge: a big Obj (a Bn locality) is engaged where the assault meets it, not at its middle
      const d = m(inPoly(bp, objOk.pts) ? 0 : setDist([bp], objOk.pts));
      gr.push({ name: 'BOF range', st: d <= bofMax ? 'pass' : 'warn', reason: `${fmtM(d)} to the Obj's near edge; 106 mm RR reaches ${fmtM(bofMax)} (ORBAT)` });
    } else gr.push({ name: 'BOF on a flank', st: 'warn', reason: 'no BOF drawn within 2.5 km of the Obj' });
    if (a.base) {
      const w = m(dist(a.base.start, a.base.end));
      // in the desert by day or by night (DW p 47); a drawn plan's light is the one it was built for, else not known
      const nightOf = typeof mp.built?.meta?.night === 'boolean' ? mp.built.meta.night as boolean : null;
      gr.push(assaultFrontageCheck(doc, terrain.kind, nightOf, w, asltMax, aslt ? `${aslt.unit}: ${aslt.src}` : 'the assault row')
        ?? { name: 'Assault frontage', st: w <= asltMax * 1.1 ? 'pass' : 'warn', reason: `${fmtM(w)} wide; ${aslt ? `${aslt.unit} ${fmtM(asltMax)} (${aslt.src})` : `${fmtM(asltMax)}`}` });
    }
    // the ground: the attack fit in a frame of its own (north up, the Obj at its centre)
    if (opts.ground && objOk) {
      const frame: FitFrame = { anchor: oc, bearing: 0, k: kAt(oc.y), pivot: P(0, 0) };
      const L = (p: XY) => toLocal(frame, p);
      const items: any[] = [{ role: 'obj', pts: objOk.pts.map(L) }, { role: 'axis', pts: [L(tail), L(head)] }];
      if (fupOk) items.push({ role: 'fup', pts: fupOk.pts.map(L) });
      if (sl && !tankAxis) items.push({ role: 'sl', pts: sl.pts.map(L) });
      if (bofOk && !prev && !tankAxis) items.push({ role: 'bof', pts: [L(centroid(bofOk.pts))] });
      const f = fitPlan({ res: { items, slots: [], rows: [] } as any, recipe: { task: 'attack', echelon: '16', slots: [] } as any, doc, frame, ground: opts.ground });
      // the tanks' axis is read on tracks, not on foot
      gr.push(...(tankAxis ? f.rows.filter((r) => r.name !== 'Approach going') : f.rows));
      if (tankAxis) gr.push(tankGoingRow(a.pts.map(L), frame, opts.ground));
      // the last objective (no later phase goes on from it): his counter-attack ways in, for the reorganisation; his
      // depth lies on along the attack, from the first phase's start through this objective
      if (![...after.values()].includes(i) && !tankAxis) {
        let root = i;
        for (let k = 0; k < axes.length && after.has(root); k++) root = after.get(root)!;
        const t0 = pre[root].tail;
        const cf: FitFrame = { anchor: oc, bearing: Math.atan2(oc.x - t0.x, oc.y - t0.y), k: kAt(oc.y), pivot: P(0, 0) };
        const ca = counterAttack({ items: [{ role: 'obj', label: objOk.label, pts: objOk.pts.map((q) => toLocal(cf, q)) }] } as any, cf, opts.ground, doc, enemy.type);
        if (ca) gr.push(ca.row);
      }
    } else gr.push({ name: 'On the ground', st: 'unchecked', reason: opts.ground ? 'no Obj to read toward' : 'needs terrain data: FUP unseen, the going, the BOF\'s view' });
    groups.push({ id: a.id, label, axis: a, obj: objOk, fup: fupOk, sl, bof: prev ? null : bofOk, rows: gr, st: worst(gr), phase: prev ? 2 : 1, after: prevI !== undefined ? axes[prevI].id : undefined });
    confirm.push(`${label}: FUP and SL by recce, the BOF's view of ${objOk?.label ?? 'the Obj'}`);
  });
  if (!axes.length) rows.push({ name: 'Axes', st: 'warn', reason: 'no attack axis (Main / Sp Attk arrow) drawn' });
  if (after.size) {
    const pairs = [...after.entries()].map(([i, j]) => `${groups[j]?.label ?? 'Axis'} onto ${pre[j].objOk?.label ?? '?'}, then ${groups[i]?.label ?? 'Axis'} onto ${pre[i].objOk?.label ?? '?'}`);
    rows.push({ name: 'Phases', st: 'pass', reason: `${after.size + 1} phases: ${pairs.join('; ')} (IBB p178: objectives and phases; p186: the follow-up Coys from a new direction)` });
    // a built plan names its follow-up Coys and reserve (PlanPhase)
    const roleSet = new Set(own.map((s) => s.pbRole).filter(Boolean));
    const resSym = own.find((s) => s.pbRole === 'res');
    if (roleSet.has('fu1')) rows.push(resSym
      ? { name: 'Reserve', st: 'pass', reason: `${resSym.label || 'a Coy'} kept as the Bn reserve (IBB p186 h(3): commit only what the task needs)` }
      : { name: 'Reserve', st: 'warn', reason: 'no Bn reserve: every rifle Coy is in the assault, the follow-up or the BOF: tell Bde (IBB p186 i); the Obj taken first holds as the firm base (p189 para 23)' });
  }
  const hit = new Set(groups.map((g) => g.obj?.label).filter(Boolean));
  const spare = objs.filter((o) => !hit.has(o.label));
  const spareNames = [...new Set(spare.map((o) => o.label))];
  if (objs.length) rows.push({ name: 'Objectives', st: 'pass', reason: `${hit.size} of ${objs.length} enemy posns attacked${spare.length ? `; ${spare.length} not (${spareNames.slice(0, 6).join(', ')}${spareNames.length > 6 ? ` and ${spareNames.length - 6} more` : ''}): fix them by fire, mask or bypass` : ''}` });
  const slots: SlotResult[] = groups.map((g) => ({ role: g.id, label: g.label, kind: 'axis', centre: P(0, 0), wM: 0, hM: 0, turnDeg: 0, checks: g.rows, st: g.st }));
  const title = `${echelonLabel(doc, ownEch)} attack: ${axes.length} axes onto ${hit.size} enemy posns`;
  const read = [
    `${own.length} own, ${en.length} enemy, ${mp.syms.filter((s) => s.side === 'other').length} other symbols (freehand and unknown left out)`,
    `Axes: ${groups.map((g) => `${g.label} → ${g.obj?.label ?? '?'}`).join(', ') || 'none'}; ${fups.length} FUP, ${sls.length} SL, ${bofs.length} BOF`,
    `Enemy: ${echelonLabel(doc, enemy.echelon)} ${String(doctrineAt(doc, `enemy.types.${enemy.type}.label`) ?? enemy.type)} (${enemy.source === 'symbols' ? enemy.note : enemy.source === 'user' ? 'as set' : 'assumed one level down'})`,
  ];
  return { task: 'attack', title, planEch: ownEch, read, unclear: mp.unclear, posns: [], slots, rows: groundNotes([...rows, ...mountainRowsOf(mp, doc, opts, null)], doc, terrain.kind, 'attack', ownEch ?? '16', typeof mp.built?.meta?.night === 'boolean' ? mp.built.meta.night as boolean : null), groups, enemy, terrain, threat: mp.threat, frame: null, fit: null, confirm, assumptions: ['Read as drawn: nothing was moved.', 'Each axis is matched to the Obj at its head, the FUP at its tail, the SL across it and the BOF nearest the Obj.'], mapped: mp };
}

/** Copy as Text. */
export function checkText(r: CheckReport): string {
  const W: Record<CheckState, string> = { pass: 'Pass', warn: 'Warn', fail: 'Fail', unchecked: 'Not checked' };
  const L: string[] = [];
  L.push(`CHECK MY PLAN: ${r.title.toUpperCase()}`);
  for (const x of r.read) L.push(`  ${x}`);
  if (r.unclear.length) { L.push(''); L.push('TO CONFIRM'); for (const u of r.unclear) L.push(`  - ${u}`); }
  L.push(''); L.push('CHECKS');
  for (const c of r.rows) { L.push(`  ${c.name.padEnd(22)} ${(c.word ?? W[c.st]).padEnd(11)} ${c.reason}`); L.push(...detailLines(c)); }
  if (r.task === 'defence' && r.slots.length) {
    L.push(''); L.push('POSNS');
    for (const s of r.slots) {
      L.push(`  ${s.label} (${r.posns.find((p) => p.id === s.role)?.kind ?? s.kind}) ${W[s.st]}`);
      for (const c of s.checks) L.push(`    ${c.name.padEnd(18)} ${(c.word ?? W[c.st]).padEnd(11)} ${c.reason}`);
    }
  }
  for (const g of r.groups) {
    L.push(''); L.push(`${g.label.toUpperCase()} -> ${g.obj?.label ?? '?'} (${W[g.st]})`);
    for (const c of g.rows) L.push(`  ${c.name.padEnd(22)} ${(c.word ?? W[c.st]).padEnd(11)} ${c.reason}`);
  }
  if (r.whatIf?.triggers.length) { L.push(''); L.push("TRIGGERS (who moves, route, own time against the enemy's)"); for (const t of triggerLines(r.whatIf)) L.push(t); }
  L.push(''); L.push('CONFIRM ON THE GROUND');
  for (const c of r.confirm) L.push(`  - ${c}`);
  L.push(''); L.push('ASSUMED');
  for (const a of r.assumptions) L.push(`  - ${a}`);
  return L.join('\n');
}

/** World point of a plan-metre point in the report's frame (the map draws the rings and the en FUP with it). */
export function reportWorld(r: CheckReport, p: XY): XY | null {
  return r.frame ? toWorld(r.frame, p) : null;
}
