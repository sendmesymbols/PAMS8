/**
 * NightMarchRead.ts
 *
 * The Night March chart's pure engine (OCOKA_Roadmap.md ch. 2 "Attack": "Night march chart — bearings and paced legs
 * (120 paces = 100 m), FUP marking layout"). No DOM, no ArcGIS: Node runs it (tools/nightmarch-test/run.mjs).
 *
 * Input: the route from the start point (SP) to the forming-up place (FUP) as Web Mercator points (the last point is the
 * FUP), the objective (optional), the echelon, the grid-magnetic angle and H hour (both optional). With a terrain probe
 * the legs come from the Platoon Guide's patrol route card (`patrolCard`: time by ground and slope, the landmark each leg
 * ends on, skylines, obstacles, villages, ground hidden from the objective); without one they are worked out from the
 * geometry on open ground at the march table's night speed, and the chart says so.
 *
 * Output (`NightMarchChart`): every leg with grid and magnetic bearing, distance, paces and the running count, time by
 * night and the clock time when H hour is set, the landmark it ends on and check points on long legs; the FUP and start
 * line laid square to the axis with the places in it, the lights and guides; the stores the marking party carries; the
 * timings back from H; the enemy's night-sight and thermal rings round the objective; and the checks, worst first.
 * Rules and figures: MS/Data/NightMarchDoctrine.json (R = roadmap rule, E = proposal).
 */

import type { GoingSets, NearFeature } from '../MovementGuide/MovementGuideScan';
import { patrolCard, plBearing, plCompass, plDist, plOffset, type MercXY, type PatrolCard, type PlFootSpeeds, type PlProbe, type PlSpot, type PlStretch, type ScanFn } from '../PlatoonGuide/PlatoonGuideRead';

export type NmEchelon = 'platoon' | 'company' | 'battalion';
export type NmTerrain = 'plains' | 'desert' | 'mountain';
export type NmTone = 'ok' | 'warn' | 'bad';
export type NmSight = 'none' | 'thermal' | 'night';
export type Rules = Record<string, any>;

const DEFAULTS: Rules = {
  pace: { pacesPer100m: 120, beadM: 100 },
  legs: { legMaxM: 1000, checkEveryM: 650, minLegM: 50, landmarkM: 150, driftDegPer1000m: 3 },
  speed: { nightKmh: { plains: 3, desert: 2.5, mountain: 1 }, haltEveryMin: 120, haltMin: 15, spareFactor: 0.15 },
  fup: { minM: 1000, wantM: 1200, tankMinM: 2500, tankWantM: 3000, approachMaxDeg: 60, slFeatureM: 60, slFeatureMaxDeg: 20, slFeatureKinds: ['road', 'track', 'rail', 'bund', 'wall_fence'], slObstacleM: 300 },
  sights: { nightM: 1200, thermalM: 4000, thermalNearM: 3000 },
  layout: {
    platoon: { frontM: 100, depthM: 60, fupMin: 10, slots: [['1 Sec', 0, 0], ['2 Sec', 1, 0], ['3 Sec', 0.5, 1], ['Pl HQ', 0.5, 0.55]] },
    company: { frontM: 200, depthM: 120, fupMin: 20, slots: [['1 Pl', 0, 0], ['2 Pl', 1, 0], ['3 Pl', 0.5, 1], ['Coy HQ', 0.5, 0.55]] },
    battalion: { frontM: 450, depthM: 300, fupMin: 30, slots: [['A Coy', 0, 0], ['B Coy', 1, 0], ['C Coy', 0, 1], ['D Coy', 1, 1], ['Tac HQ', 0.5, 0.5]] },
  },
  marking: { routeLightM: 200, axisTapeM: 100, tapeRollM: 100 },
};

/** The doctrine file with every value it leaves out filled in from the defaults. */
export function nmRulesFrom(doc: unknown): Rules {
  const d: Rules = (doc && typeof doc === 'object' ? doc : {}) as Rules;
  const out: Rules = {};
  for (const [k, v] of Object.entries(DEFAULTS)) out[k] = { ...v, ...(d[k] ?? {}) };
  return out;
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

export const norm360 = (d: number): number => ((d % 360) + 360) % 360;
export const angGap = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
export const toMils = (deg: number): number => Math.round((norm360(deg) * 6400) / 360) % 6400;
/** Paces for a distance (120 paces = 100 m by default). */
export const pacesFor = (m: number, R: Rules): number => Math.round((m / 100) * (R.pace?.pacesPer100m ?? 120));
/** "HH:MM" from minutes after midnight (wraps round the day). */
export function clock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** "H-2:45" for minutes before H (negative = before). */
export function hRel(min: number): string {
  const a = Math.abs(Math.round(min));
  const s = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  return min < 0 ? `H-${s}` : min > 0 ? `H+${s}` : 'H';
}
/** "02:30" or "0230" to minutes after midnight; null when not a time. */
export function parseHHMM(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^\s*(\d{1,2}):?(\d{2})\s*$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
/** Magnetic from grid: the grid-magnetic angle is east-positive (magnetic north east of grid north), so mag = grid - GMA. */
export const magOf = (gridDeg: number, gmaDeg: number | null): number | null => (gmaDeg === null || !Number.isFinite(gmaDeg) ? null : norm360(gridDeg - gmaDeg));

function lerp(a: MercXY, b: MercXY, t: number): MercXY {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function spotFrom(from: MercXY, f: NearFeature): PlSpot {
  const b = plBearing(from, [f.x, f.y]);
  return { kind: f.kind, label: f.label, name: f.name, x: f.x, y: f.y, distM: plDist(from, [f.x, f.y]), bearingDeg: b, dir: plCompass(b), attrs: f.attrs };
}
/** The nearest point of a polyline to p: the segment index, the point, how far along the whole line, and the offset. */
export function nearestOnPath(path: MercXY[], p: MercXY): { seg: number; at: MercXY; chainM: number; offM: number; t: number } | null {
  let best: { seg: number; at: MercXY; chainM: number; offM: number; t: number } | null = null;
  let chain = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const at = lerp(a, b, t);
    const off = plDist(p, at);
    const L = plDist(a, b);
    if (!best || off < best.offM) best = { seg: i, at, chainM: chain + L * t, offM: off, t };
    chain += L;
  }
  return best;
}

// ── shapes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface NmCheckPt {
  x: number;
  y: number;
  /** Metres into the leg. */
  atM: number;
}

export interface NmLeg {
  i: number;
  from: MercXY;
  to: MercXY;
  bearingDeg: number;
  magDeg: number | null;
  distM: number;
  paces: number;
  /** Metres and paces from the SP to the end of this leg. */
  cumM: number;
  cumPaces: number;
  /** Moving time by night, minutes (with the spare). */
  minNight: number;
  climbM: number;
  /** Minutes after leaving the SP: the start and end of the leg, halts included. */
  startMin: number;
  endMin: number;
  /** The feature the leg ends on, recognisable at night; null when none is recorded within reach. */
  landmark: PlSpot | null;
  /** The last leg ends at the FUP itself. */
  toFup: boolean;
  long: boolean;
  checkPts: NmCheckPt[];
  /** Metres a 3-degree drift puts the column off at the leg's end. */
  driftM: number;
  /** The worst enemy sight ring the leg's end is inside. */
  sight: NmSight;
  tone: NmTone;
  notes: string[];
}

export type NmLightKind = 'sp' | 'turn' | 'route' | 'entry' | 'sl' | 'corner' | 'axis';
export interface NmLight {
  x: number;
  y: number;
  kind: NmLightKind;
  label: string;
}
export interface NmSlot {
  label: string;
  at: MercXY;
  /** Four corners: rear-left, front-left, front-right, rear-right. */
  corners: MercXY[];
  hq: boolean;
}
export interface NmFup {
  centre: MercXY;
  axisDeg: number;
  axisMagDeg: number | null;
  /** True when the axis points at the objective; false = along the last leg (no objective set). */
  axisToObj: boolean;
  frontM: number;
  depthM: number;
  /** Rear-left, front-left, front-right, rear-right. */
  corners: MercXY[];
  sl: [MercXY, MercXY];
  entry: MercXY;
  axisEnd: MercXY;
  slots: NmSlot[];
  fupMin: number;
  distToObjM: number | null;
  tone: NmTone;
  /** Angle between the last leg and the axis: the column should come in from the rear. */
  approachDeg: number;
  approachTone: NmTone;
  /** The linear feature the SL lies on, if one is found square to the axis. */
  slFeature: string | null;
  /** An obstacle across the axis just beyond the SL (the SL must never be behind one). */
  obstacleAhead: { label: string; distM: number } | null;
}
export interface NmHalt {
  /** Minutes after leaving the SP the halt starts. */
  atMin: number;
  min: number;
  chainM: number;
  x: number;
  y: number;
}
export interface NmTiming {
  /** Moving time, with the spare. */
  moveMin: number;
  halts: NmHalt[];
  /** SP to arrival in the FUP. */
  marchMin: number;
  fupMin: number;
  /** Minutes before H to leave the SP. */
  leaveBeforeH: number;
  hHourMin: number | null;
  /** Clock times when H is set. */
  leaveSp: string | null;
  arriveFup: string | null;
  h: string | null;
  spareFactor: number;
  /** km/h by night the times rest on, when the ground is not read (no terrain data). */
  flatKmh: number | null;
}
export interface NmStores {
  slTapeM: number;
  fupTapeM: number;
  axisTapeM: number;
  routeTapeM: number;
  /** SL + FUP + axis tape (the route is taped only where the party has tape to spare). */
  tapeM: number;
  rolls: number;
  rollsWithRoute: number;
  lights: number;
  guides: number;
}
export interface NmRing {
  radiusM: number;
  /** Metres from the SP where the route first comes inside the ring; null when it never does. */
  enterAtM: number | null;
}
export interface NmCheck {
  tone: NmTone;
  text: string;
  /** Where on the map it applies (a click goes there). */
  at?: MercXY;
}
export interface NightMarchChart {
  path: MercXY[];
  objective: MercXY | null;
  echelon: NmEchelon;
  /** Times and landmarks read from the terrain (false = geometry on open ground). */
  terrain: boolean;
  lengthM: number;
  paces: number;
  legs: NmLeg[];
  fup: NmFup;
  timing: NmTiming;
  stores: NmStores;
  lights: NmLight[];
  guides: Array<{ x: number; y: number; label: string }>;
  sights: { night: NmRing; thermal: NmRing } | null;
  skyline: PlStretch[];
  exposed: PlStretch[];
  /** Hidden from the objective. */
  dead: PlStretch[];
  /** Share of the route hidden from the objective (0-1); null when not worked out. */
  deadShare: number | null;
  obstacles: PatrolCard['obstacles'];
  villages: PatrolCard['villages'];
  gmaSet: boolean;
  tanks: boolean;
  checks: NmCheck[];
  tone: NmTone;
  pending: boolean;
}

export interface NmInput {
  path: MercXY[];
  objective: MercXY | null;
  echelon: NmEchelon;
  gmaDeg: number | null;
  /** Minutes after midnight; null = timings relative to H. */
  hHourMin: number | null;
  /** The march table's ground when the terrain is not read. */
  terrainKind: NmTerrain;
  /** Tanks with the attack: the tank FUP distances apply. */
  tanks?: boolean;
  probe?: PlProbe | null;
  /** PlatoonDoctrine.json through plRulesFrom (its `patrol` block). */
  patrolRules?: Rules | null;
  foot?: GoingSets | null;
  speeds?: PlFootSpeeds | null;
  classLabel?: (c: number) => string;
  scanRoad?: ScanFn;
}

const worst = (a: NmTone, b: NmTone): NmTone => (a === 'bad' || b === 'bad' ? 'bad' : a === 'warn' || b === 'warn' ? 'warn' : 'ok');

/** Legs from the geometry alone: open ground at the march table's night speed. */
function flatLegs(path: MercXY[], R: Rules, kmh: number): PatrolCard['legs'] {
  const out: PatrolCard['legs'] = [];
  for (let s = 0; s + 1 < path.length; s++) {
    const a = path[s], b = path[s + 1];
    const L = plDist(a, b);
    if (!(L > 0.5)) continue;
    const min = (L / 1000 / Math.max(0.3, kmh)) * 60;
    out.push({ i: out.length + 1, from: a, to: b, bearingDeg: plBearing(a, b), distM: L, paces: pacesFor(L, R), minDay: Math.round(min * 0.75), minNight: Math.round(min), climbM: 0, endFeature: null });
  }
  return out;
}

function sightOf(p: MercXY, obj: MercXY | null, R: Rules): NmSight {
  if (!obj) return 'none';
  const d = plDist(p, obj);
  return d <= R.sights.nightM ? 'night' : d <= R.sights.thermalM ? 'thermal' : 'none';
}

/** The FUP laid square to the axis at the route's end, with the places in it. */
export function layFup(centre: MercXY, axisDeg: number, echelon: NmEchelon, R: Rules): Pick<NmFup, 'corners' | 'sl' | 'entry' | 'axisEnd' | 'slots' | 'frontM' | 'depthM' | 'fupMin'> {
  const L = R.layout[echelon] ?? R.layout.company;
  const w: number = L.frontM, d: number = L.depthM;
  const at = (across: number, along: number): MercXY => plOffset(plOffset(centre, axisDeg, along), axisDeg + 90, across);
  const corners = [at(-w / 2, -d / 2), at(-w / 2, d / 2), at(w / 2, d / 2), at(w / 2, -d / 2)];
  const sl: [MercXY, MercXY] = [corners[1], corners[2]];
  const slots: NmSlot[] = (L.slots as Array<[string, number, number]>).map(([label, u, v]) => {
    const hq = /HQ/i.test(label);
    const across = (u - 0.5) * w * 0.5;
    const along = d / 2 - d * 0.25 - v * d * 0.5;
    const sw = hq ? w * 0.14 : w * 0.42;
    const sd = hq ? d * 0.16 : d * 0.36;
    return { label, at: at(across, along), corners: [at(across - sw / 2, along - sd / 2), at(across - sw / 2, along + sd / 2), at(across + sw / 2, along + sd / 2), at(across + sw / 2, along - sd / 2)], hq };
  });
  return { corners, sl, entry: at(0, -d / 2), axisEnd: at(0, d / 2 + R.marking.axisTapeM), slots, frontM: w, depthM: d, fupMin: L.fupMin };
}

/**
 * The night march chart for a route (SP ... FUP) and an objective. Pure: the probe, when given, is read synchronously
 * and `pending` says some tiles were still loading (read again when they arrive).
 */
export function nightMarchChart(input: NmInput, R: Rules): NightMarchChart {
  const path = input.path.filter((p, i, a) => i === 0 || plDist(a[i - 1], p) > 0.5);
  const obj = input.objective;
  const gma = input.gmaDeg !== null && Number.isFinite(input.gmaDeg) ? input.gmaDeg : null;
  const flatKmh: number = R.speed.nightKmh?.[input.terrainKind] ?? 3;
  const terrain = !!(input.probe && input.patrolRules && input.foot && input.speeds);
  let pc: PatrolCard | null = null;
  if (terrain && path.length >= 2) {
    pc = patrolCard(input.probe!, input.patrolRules!, path, {
      foot: input.foot!,
      speeds: input.speeds!,
      threat: obj,
      classLabel: input.classLabel ?? ((c) => `Class ${c}`),
      scanRoad: input.scanRoad,
    });
  }
  const raw = pc ? pc.legs : flatLegs(path, R, flatKmh);
  const spare = 1 + (R.speed.spareFactor ?? 0);
  const haltEvery: number = R.speed.haltEveryMin ?? 120;
  const haltMin: number = R.speed.haltMin ?? 15;

  // Legs, the running counts and the clock with halts (a halt after each `haltEvery` minutes on the move).
  const legs: NmLeg[] = [];
  const halts: NmHalt[] = [];
  let cumM = 0, cumMove = 0, clockMin = 0;
  let nextHalt = haltEvery;
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k];
    const move = Math.max(1, r.minNight) * spare;
    const start = clockMin;
    // Halts that fall inside this leg (none at the very end of the march: the column is in the FUP then).
    let inLeg = 0;
    while (cumMove + move > nextHalt && halts.length < 50) {
      const into = nextHalt - cumMove; // minutes of moving into the leg
      const t = Math.min(1, into / move);
      const at = lerp(r.from, r.to, t);
      halts.push({ atMin: Math.round(start + into + inLeg * haltMin), min: haltMin, chainM: cumM + r.distM * t, x: at[0], y: at[1] });
      inLeg++;
      nextHalt += haltEvery;
    }
    cumMove += move;
    clockMin = start + move + inLeg * haltMin;
    cumM += r.distM;
    const last = k === raw.length - 1;
    const long = r.distM > R.legs.legMaxM;
    const checkPts: NmCheckPt[] = [];
    if (long) {
      for (let m = R.legs.checkEveryM; m < r.distM - 100; m += R.legs.checkEveryM) {
        const p = lerp(r.from, r.to, m / r.distM);
        checkPts.push({ x: p[0], y: p[1], atM: m });
      }
    }
    const landmark = r.endFeature ?? null;
    const sight = sightOf(r.to, obj, R);
    const notes: string[] = [];
    let tone: NmTone = 'ok';
    if (!last && !landmark) {
      notes.push(input.probe ? 'No landmark recorded: put a guide and a light at the turn' : 'Landmark not read: choose a feature you can see at night');
      tone = 'warn';
    }
    if (long) {
      notes.push(`Long leg: check ${checkPts.length ? `at ${checkPts.map((c) => `${Math.round(c.atM)} m`).join(', ')}` : 'half way'}`);
      tone = 'warn';
    }
    if (!last && sight === 'night') {
      notes.push('Inside the enemy\'s night sights: silent, no lights');
      tone = 'warn';
    }
    legs.push({
      i: legs.length + 1,
      from: r.from,
      to: r.to,
      bearingDeg: r.bearingDeg,
      magDeg: magOf(r.bearingDeg, gma),
      distM: r.distM,
      paces: pacesFor(r.distM, R),
      cumM,
      cumPaces: pacesFor(cumM, R),
      minNight: Math.round(move),
      climbM: r.climbM,
      startMin: Math.round(start),
      endMin: Math.round(clockMin),
      landmark,
      toFup: last,
      long,
      checkPts,
      driftM: Math.round((r.distM * Math.tan(((R.legs.driftDegPer1000m ?? 3) * Math.PI) / 180))),
      sight,
      tone,
      notes,
    });
  }
  const lengthM = cumM;

  // The FUP: centred on the route's last point, its axis on the objective (else along the last leg).
  const centre = path[path.length - 1];
  const lastBrg = legs.length ? legs[legs.length - 1].bearingDeg : 0;
  const axisDeg = obj && plDist(centre, obj) > 1 ? plBearing(centre, obj) : lastBrg;
  const lay = layFup(centre, axisDeg, input.echelon, R);
  const distToObjM = obj ? plDist(centre, obj) : null;
  const tanks = !!input.tanks;
  const minM = tanks ? R.fup.tankMinM : R.fup.minM;
  const wantM = tanks ? R.fup.tankWantM : R.fup.wantM;
  const fupTone: NmTone = distToObjM === null ? 'warn' : distToObjM < minM ? 'bad' : distToObjM < wantM ? 'warn' : 'ok';
  const approachDeg = legs.length ? angGap(lastBrg, axisDeg) : 0;
  const approachTone: NmTone = approachDeg > 120 ? 'bad' : approachDeg > R.fup.approachMaxDeg ? 'warn' : 'ok';

  // The SL: a linear feature square to the axis on it, and no obstacle just beyond it.
  let slFeature: string | null = null;
  let obstacleAhead: NmFup['obstacleAhead'] = null;
  const slMid = lerp(lay.sl[0], lay.sl[1], 0.5);
  if (input.probe) {
    const kinds = new Set<string>(R.fup.slFeatureKinds ?? []);
    const slBrg = norm360(axisDeg + 90);
    for (const l of input.probe.lines(slMid[0], slMid[1], R.fup.slFeatureM, kinds)) {
      const xy = l.xy;
      let bestD = Infinity, bestB = 0;
      for (let i = 0; i + 3 < xy.length; i += 2) {
        const a: MercXY = [xy[i], xy[i + 1]], b: MercXY = [xy[i + 2], xy[i + 3]];
        const n = nearestOnPath([a, b], slMid);
        if (n && n.offM < bestD) {
          bestD = n.offM;
          bestB = plBearing(a, b);
        }
      }
      if (bestD <= R.fup.slFeatureM && Math.min(angGap(bestB, slBrg), angGap(bestB, slBrg + 180)) <= R.fup.slFeatureMaxDeg) {
        const nm = (l.attrs?.n ?? l.attrs?.name) as string | undefined;
        slFeature = `${l.kind === 'wall_fence' ? 'Wall / fence' : l.kind === 'power_line' ? 'Power line' : l.kind.charAt(0).toUpperCase() + l.kind.slice(1)}${nm ? ` ${nm}` : ''}`;
        break;
      }
    }
    if (input.foot) {
      for (let m = 10; m <= R.fup.slObstacleM; m += 10) {
        const p = plOffset(slMid, axisDeg, m);
        const c = input.probe.cls(p[0], p[1]);
        if (c !== null && input.foot.nogo.has(c)) {
          obstacleAhead = { label: input.classLabel?.(c) ?? 'NO-GO Gr', distM: m };
          break;
        }
      }
    }
  }
  const fup: NmFup = {
    centre,
    axisDeg,
    axisMagDeg: magOf(axisDeg, gma),
    axisToObj: !!obj,
    ...lay,
    distToObjM,
    tone: fupTone,
    approachDeg,
    approachTone,
    slFeature,
    obstacleAhead,
  };

  // Timings back from H: the march, then the FUP's shake-out time; the SP is left that long before H.
  const H = input.hHourMin;
  const leaveBeforeH = Math.round(clockMin + lay.fupMin);
  const timing: NmTiming = {
    moveMin: Math.round(cumMove),
    halts,
    marchMin: Math.round(clockMin),
    fupMin: lay.fupMin,
    leaveBeforeH,
    hHourMin: H,
    leaveSp: H === null ? null : clock(H - leaveBeforeH),
    arriveFup: H === null ? null : clock(H - lay.fupMin),
    h: H === null ? null : clock(H),
    spareFactor: R.speed.spareFactor ?? 0,
    flatKmh: terrain ? null : flatKmh,
  };

  // Lights and guides the marking party puts out.
  const lights: NmLight[] = [];
  const guides: Array<{ x: number; y: number; label: string }> = [];
  if (path.length) {
    lights.push({ x: path[0][0], y: path[0][1], kind: 'sp', label: 'SP' });
    guides.push({ x: path[0][0], y: path[0][1], label: 'SP' });
  }
  for (const lg of legs) {
    const step = R.marking.routeLightM;
    for (let m = step; m < lg.distM - 50; m += step) {
      const p = lerp(lg.from, lg.to, m / lg.distM);
      lights.push({ x: p[0], y: p[1], kind: 'route', label: `Leg ${lg.i}` });
    }
    if (!lg.toFup) {
      lights.push({ x: lg.to[0], y: lg.to[1], kind: 'turn', label: `Turn ${lg.i}` });
      guides.push({ x: lg.to[0], y: lg.to[1], label: `Turn ${lg.i}` });
    }
  }
  lights.push({ x: lay.entry[0], y: lay.entry[1], kind: 'entry', label: 'FUP entry' });
  guides.push({ x: lay.entry[0], y: lay.entry[1], label: 'FUP entry' });
  lights.push({ x: lay.sl[0][0], y: lay.sl[0][1], kind: 'sl', label: 'SL left' }, { x: lay.sl[1][0], y: lay.sl[1][1], kind: 'sl', label: 'SL right' });
  lights.push({ x: lay.corners[0][0], y: lay.corners[0][1], kind: 'corner', label: 'FUP rear left' }, { x: lay.corners[3][0], y: lay.corners[3][1], kind: 'corner', label: 'FUP rear right' });
  lights.push({ x: lay.axisEnd[0], y: lay.axisEnd[1], kind: 'axis', label: 'Axis tape end' });
  for (const s of lay.slots) guides.push({ x: s.at[0], y: s.at[1], label: s.label });

  const slTapeM = Math.round(lay.frontM);
  const fupTapeM = Math.round(2 * (lay.frontM + lay.depthM));
  const axisTapeM = Math.round(R.marking.axisTapeM);
  const tapeM = slTapeM + fupTapeM + axisTapeM;
  const roll = Math.max(1, R.marking.tapeRollM);
  const stores: NmStores = {
    slTapeM,
    fupTapeM,
    axisTapeM,
    routeTapeM: Math.round(lengthM),
    tapeM,
    rolls: Math.ceil(tapeM / roll),
    rollsWithRoute: Math.ceil((tapeM + lengthM) / roll),
    lights: lights.length,
    guides: guides.length,
  };

  // The enemy's sights round the objective: where the route first comes inside each ring.
  let sights: NightMarchChart['sights'] = null;
  if (obj) {
    const enter = (r: number): number | null => {
      let chain = 0;
      for (let s = 0; s + 1 < path.length; s++) {
        const a = path[s], b = path[s + 1];
        const L = plDist(a, b);
        const n = Math.max(1, Math.ceil(L / 25));
        for (let k = 0; k <= n; k++) if (plDist(lerp(a, b, k / n), obj) <= r) return Math.round(chain + (L * k) / n);
        chain += L;
      }
      return null;
    };
    sights = { night: { radiusM: R.sights.nightM, enterAtM: enter(R.sights.nightM) }, thermal: { radiusM: R.sights.thermalM, enterAtM: enter(R.sights.thermalM) } };
  }

  let deadShare: number | null = null;
  if (pc && obj && lengthM > 0 && !pc.pending) {
    const hidden = pc.dead.reduce((s, d) => s + Math.max(0, d.toM - d.fromM), 0);
    deadShare = Math.max(0, Math.min(1, hidden / lengthM));
  }

  // The checks, worst first.
  const checks: NmCheck[] = [];
  const push = (tone: NmTone, text: string, at?: MercXY) => checks.push({ tone, text, at });
  if (!legs.length) push('bad', 'Draw the route: the SP, each turn, and the FUP last');
  if (obj && distToObjM !== null) {
    const fmt = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);
    if (fupTone === 'bad') push('bad', `FUP ${fmt(distToObjM)} from the Obj: under ${fmt(minM)}${tanks ? ' for a tank FUP' : ''}, inside the enemy's night sights. Move it back`, centre);
    else if (fupTone === 'warn') push('warn', `FUP ${fmt(distToObjM)} from the Obj: inside ${fmt(wantM)}, at the edge of the enemy's night sights`, centre);
    else push('ok', `FUP ${fmt(distToObjM)} from the Obj (${fmt(wantM)} or more wanted${tanks ? ' with tanks' : ''})`, centre);
  } else push('warn', 'No Obj set: the FUP distance, the axis and the enemy\'s sights are not checked');
  if (fup.obstacleAhead) push('bad', `${fup.obstacleAhead.label} across the axis ${fup.obstacleAhead.distM} m beyond the SL: the SL must never be behind an obstacle`, plOffset(slMid, axisDeg, fup.obstacleAhead.distM));
  if (approachTone === 'bad') push('bad', `The route comes into the FUP from the enemy's side (${Math.round(approachDeg)}° off the axis): come in from the rear`, centre);
  else if (approachTone === 'warn') push('warn', `The route comes into the FUP ${Math.round(approachDeg)}° off the axis: turn the column before the FUP, no change of direction inside it`, centre);
  if (gma === null) push('warn', 'Set the grid-magnetic angle: bearings are grid only until then');
  const noMark = legs.filter((l) => !l.toFup && !l.landmark);
  if (noMark.length) push('warn', `${noMark.length === 1 ? 'Leg' : 'Legs'} ${noMark.map((l) => l.i).join(', ')} end${noMark.length === 1 ? 's' : ''} on no feature recognisable at night: move the turn to one, or put a guide and a light there`, noMark[0].to);
  const longs = legs.filter((l) => l.long);
  if (longs.length) push('warn', `${longs.length === 1 ? 'Leg' : 'Legs'} ${longs.map((l) => l.i).join(', ')} over ${R.legs.legMaxM} m: check points every ${R.legs.checkEveryM} m (3° drift is ${Math.round(Math.max(...longs.map((l) => l.driftM)))} m off at the end)`, longs[0].checkPts[0] ? [longs[0].checkPts[0].x, longs[0].checkPts[0].y] : longs[0].to);
  if (sights?.night.enterAtM !== null && sights?.night.enterAtM !== undefined && sights.night.enterAtM < lengthM - 1) push('warn', `Inside the enemy's night sights (${R.sights.nightM} m) from ${Math.round(sights.night.enterAtM)} m (${pacesFor(sights.night.enterAtM, R)} paces): silent, no lights, no talk from there`);
  if (pc) {
    if (pc.skyline.length) push('warn', `On a skyline ${pc.skyline.length === 1 ? 'once' : `${pc.skyline.length} times`} (from ${Math.round(pc.skyline[0].fromM)} m): move off the crest`, [pc.skyline[0].x, pc.skyline[0].y]);
    if (pc.obstacles.length) push('warn', `Crosses ${pc.obstacles.map((o) => `${o.label} at ${Math.round(o.chainM)} m`).slice(0, 3).join(', ')}: a guide and a rope at each crossing`, [pc.obstacles[0].x, pc.obstacles[0].y]);
    if (pc.villages.length) push('warn', `Passes ${pc.villages.map((v) => v.name ?? 'a village').slice(0, 3).join(', ')}: dogs and people; keep off`);
    if (pc.exposed.length && obj) push('warn', `Seen from the Obj or high Gr on ${pc.exposed.length} stretch${pc.exposed.length === 1 ? '' : 'es'} (from ${Math.round(pc.exposed[0].fromM)} m)`, [pc.exposed[0].x, pc.exposed[0].y]);
    if (deadShare !== null) push(deadShare >= 0.5 ? 'ok' : 'warn', `${Math.round(deadShare * 100)}% of the route is hidden from the Obj`);
    if (fup.slFeature) push('ok', `SL on ${fup.slFeature}, square to the axis`);
    else push('warn', 'No linear feature square to the axis on the SL: tape it end to end');
  } else {
    push('warn', `No terrain read: times at ${flatKmh} km/h by night on ${input.terrainKind}, no landmarks, skylines or obstacles`);
  }
  let tone: NmTone = 'ok';
  for (const c of checks) tone = worst(tone, c.tone);
  const rank: Record<NmTone, number> = { bad: 0, warn: 1, ok: 2 };
  checks.sort((a, b) => rank[a.tone] - rank[b.tone]);

  return {
    path,
    objective: obj,
    echelon: input.echelon,
    terrain,
    lengthM,
    paces: pacesFor(lengthM, R),
    legs,
    fup,
    timing,
    stores,
    lights,
    guides,
    sights,
    skyline: pc?.skyline ?? [],
    exposed: pc?.exposed ?? [],
    dead: pc?.dead ?? [],
    deadShare,
    obstacles: pc?.obstacles ?? [],
    villages: pc?.villages ?? [],
    gmaSet: gma !== null,
    tanks,
    checks,
    tone,
    pending: pc?.pending ?? false,
  };
}

// ── the cursor: the leg being drawn, or the leg under the pointer ────────────────────────────────────────────────────

export interface NmLive {
  legNo: number;
  from: MercXY;
  to: MercXY;
  bearingDeg: number;
  magDeg: number | null;
  /** Bearings of the legs already laid (the dial shows them faint). */
  prevBearings: number[];
  distM: number;
  paces: number;
  cumM: number;
  cumPaces: number;
  minNight: number;
  cumMin: number;
  /** The feature at the cursor the leg would end on. */
  landmark: PlSpot | null;
  /** NO-GO ground on foot the leg crosses. */
  crossing: string | null;
  /** The ground under the cursor. */
  ground: string | null;
  skyline: boolean;
  /** Metres climbed on the leg (terrain only). */
  climbM: number;
  distToObjM: number | null;
  /** Bearing from the cursor to the objective. */
  objBrg: number | null;
  sight: NmSight;
  long: boolean;
  driftM: number;
  tone: NmTone;
  terrain: boolean;
  pending: boolean;
}

/**
 * The leg from the last point laid to the cursor while the route is drawn (quick: one leg, no route scan).
 * `laid` is the route so far (SP first); `cursor` is where the leg would end.
 */
export function liveLeg(input: Omit<NmInput, 'path' | 'echelon' | 'hHourMin' | 'scanRoad'> & { laid: MercXY[]; cursor: MercXY }, R: Rules): NmLive {
  const laid = input.laid;
  const from = laid[laid.length - 1] ?? input.cursor;
  const to = input.cursor;
  const gma = input.gmaDeg !== null && Number.isFinite(input.gmaDeg) ? input.gmaDeg : null;
  const L = plDist(from, to);
  const brg = L > 0.5 ? plBearing(from, to) : 0;
  const flatKmh: number = R.speed.nightKmh?.[input.terrainKind] ?? 3;
  const spare = 1 + (R.speed.spareFactor ?? 0);
  let cumM = 0, cumMin = 0;
  const prev: number[] = [];
  for (let i = 0; i + 1 < laid.length; i++) {
    const d = plDist(laid[i], laid[i + 1]);
    cumM += d;
    cumMin += (d / 1000 / flatKmh) * 60 * spare;
    if (d > 0.5) prev.push(plBearing(laid[i], laid[i + 1]));
  }
  const terrain = !!(input.probe && input.patrolRules && input.foot && input.speeds);
  let minNight = (L / 1000 / flatKmh) * 60 * spare;
  let landmark: PlSpot | null = null;
  let crossing: string | null = null;
  let ground: string | null = null;
  let skyline = false;
  let climb = 0;
  let pending = false;
  if (terrain && L > 0.5) {
    const pc = patrolCard(input.probe!, input.patrolRules!, [from, to], { foot: input.foot!, speeds: input.speeds!, threat: null, classLabel: input.classLabel ?? ((c) => `Class ${c}`) });
    const lg = pc.legs[0];
    if (lg) {
      minNight = lg.minNight * spare;
      landmark = lg.endFeature;
      climb = lg.climbM;
    }
    crossing = pc.obstacles[0]?.label ?? null;
    skyline = pc.skyline.length > 0;
    pending = pc.pending;
  } else if (input.probe) {
    const fs = input.probe.features(to[0], to[1], R.legs.landmarkM, new Set<string>((input.patrolRules?.patrol?.legFeatureKinds ?? []) as string[]));
    const f = fs.find((x) => x.name) ?? fs[0];
    landmark = f ? spotFrom(to, f) : null;
  }
  if (input.probe) {
    const c = input.probe.cls(to[0], to[1]);
    ground = c === null ? null : (input.classLabel?.(c) ?? null);
  }
  const obj = input.objective;
  const distToObjM = obj ? plDist(to, obj) : null;
  const sight = sightOf(to, obj, R);
  const long = L > R.legs.legMaxM;
  let tone: NmTone = 'ok';
  if (crossing || sight === 'night') tone = 'bad';
  else if (long || skyline || (L > R.legs.minLegM && !landmark && terrain)) tone = 'warn';
  return {
    legNo: laid.length,
    from,
    to,
    bearingDeg: brg,
    magDeg: magOf(brg, gma),
    prevBearings: prev,
    distM: L,
    paces: pacesFor(L, R),
    cumM: cumM + L,
    cumPaces: pacesFor(cumM + L, R),
    minNight: Math.round(minNight),
    cumMin: Math.round(cumMin + minNight),
    landmark,
    crossing,
    ground,
    skyline,
    climbM: Math.round(climb),
    distToObjM,
    objBrg: obj && distToObjM && distToObjM > 1 ? plBearing(to, obj) : null,
    sight,
    long,
    driftM: Math.round(L * Math.tan(((R.legs.driftDegPer1000m ?? 3) * Math.PI) / 180)),
    tone,
    terrain,
    pending,
  };
}

export interface NmOnLeg {
  leg: NmLeg;
  /** Metres and paces into the leg at the pointer, and to go to its end. */
  alongM: number;
  pacesIn: number;
  pacesToGo: number;
  /** Metres the pointer is off the line. */
  offM: number;
  /** Minutes after leaving the SP the column passes here. */
  atMin: number;
  /** Paces from the SP. */
  fromSpPaces: number;
}

/** The leg under the pointer (within `tolM` of the route): how far in, in paces, and the time the column passes. */
export function legAt(chart: NightMarchChart, p: MercXY, tolM: number, R: Rules): NmOnLeg | null {
  let best: NmOnLeg | null = null;
  for (const leg of chart.legs) {
    const n = nearestOnPath([leg.from, leg.to], p);
    if (!n || n.offM > tolM || (best && n.offM >= best.offM)) continue;
    const along = n.chainM;
    best = {
      leg,
      alongM: along,
      pacesIn: pacesFor(along, R),
      pacesToGo: Math.max(0, leg.paces - pacesFor(along, R)),
      offM: n.offM,
      atMin: Math.round(leg.startMin + (leg.endMin - leg.startMin) * (leg.distM > 0 ? along / leg.distM : 0)),
      fromSpPaces: pacesFor(leg.cumM - leg.distM + along, R),
    };
  }
  return best;
}
