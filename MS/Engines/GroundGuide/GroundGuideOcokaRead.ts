/**
 * GroundGuideOcokaRead.ts
 *
 * Puts the OCOKA reading together for the Ground Guide: lays the bundle's tiles out for the engine
 * (GroundGuideOcoka.ts), resolves where the threat is, picks the weapon, runs the sums and names what they found.
 * The figures and rules come from MS/Data/OcokaDoctrine.json (a mix of pamphlet figures and proposals: see its
 * `basisCodes`), the weapon ranges from the `Rng` field of MS/Data/Symbols.json.
 *
 * Cost (tools/ocoka-test, 2026-11-10): about 1.5 ms for everything the cursor card needs; the Detail's picture adds
 * 6 to 8 ms and is only drawn while the Detail is open. A reading is kept per 30 m cell, so a cursor that stays in a
 * cell costs nothing.
 */

import DOCTRINE from '../../Data/OcokaDoctrine.json';
import {
  analyseSight,
  avenueMask,
  avenueOverlap,
  bearingsFor,
  betterPosition,
  buildGrid,
  compass8,
  cropShares,
  DEFAULT_FIRE_RULE,
  dominanceOf,
  elevAt,
  findAvenue,
  fineStep,
  fireOf,
  gridHolds,
  mercToPx,
  newBands,
  nightOf,
  nvdReach,
  observationOf,
  obstacleFrontOf,
  parseVisibility,
  pxToMerc,
  sightRuns,
  sightTables,
  sightTo,
  visibilityAt,
  waysOut,
  type Avenue,
  type FireRule,
  type Going,
  type OcokaGrid,
  type OcokaLayers,
  type OcokaWeapon,
  type SightTables,
  type TilePeek,
  type VisibilityGrid,
} from './GroundGuideOcoka';
import type { GroundGuideItgCandidate, GroundGuideOcoka, GroundGuideExtendedOptions, MercXY, OcokaEye, OcokaKeyGround, OcokaMapOverlay, OcokaMapPlan, OcokaMapSight, OcokaThreatMode } from './GroundGuideTypes';

export const OCOKA_DOCTRINE: any = DOCTRINE;
export const OCOKA_THREATS: readonly OcokaThreatMode[] = ['front', 'bearing', 'point', 'allRound'];
export const OCOKA_EYES: readonly OcokaEye[] = ['auto', 'standing', 'prone', 'vehicle', 'post'];
/** Range bands of the fields-of-fire picture, metres. */
export const FIRE_BANDS = [0, 100, 300, 600, 1000, 2000];
/** Straight ways out are judged to this distance, and the highest ground within this one. */
const WAYS_M = 2000;
const KEY_M = 3000;
const MAX_KEY = 4;

const EYE: Record<Exclude<OcokaEye, 'auto'>, { m: number; label: string }> = {
  standing: { m: 1.6, label: 'Standing man' },
  prone: { m: 0.4, label: 'Prone man' },
  vehicle: { m: 2.4, label: 'Vehicle commander' },
  post: { m: 3.0, label: 'Obsn post' },
};
export function eyeFor(eye: OcokaEye, profile: string): { m: number; label: string } {
  if (eye !== 'auto') return EYE[eye];
  return profile === 'tracked' || profile === 'amphibious' ? EYE.vehicle : EYE.standing;
}

/** The threat's bearing and arc from the options, the unit's front and the point (grid bearing in Web Mercator). */
export function resolveThreat(o: GroundGuideExtendedOptions, frontDeg: number, at: MercXY, threatAt: MercXY | null): GroundGuideOcoka['threat'] {
  let mode = o.threat;
  let b = frontDeg;
  if (mode === 'point') {
    if (threatAt && (Math.abs(threatAt[0] - at[0]) > 1 || Math.abs(threatAt[1] - at[1]) > 1)) b = (Math.atan2(threatAt[0] - at[0], threatAt[1] - at[1]) * 180) / Math.PI;
    else mode = 'front';
  } else if (mode === 'bearing') b = o.bearingDeg;
  b = ((b % 360) + 360) % 360;
  const all = mode === 'allRound';
  return { mode, bearingDeg: all ? 0 : Math.round(b), sectorDeg: all ? 360 : o.sectorDeg, compass: all ? 'All Round' : compass8(b), allRound: all };
}

const tableCache = new Map<string, SightTables>();
function tablesFor(doctrine: any, month: number, res: number): SightTables {
  const key = `${month}|${res.toFixed(2)}`;
  let t = tableCache.get(key);
  if (!t) {
    if (tableCache.size > 24) tableCache.clear();
    t = sightTables(doctrine, month, res);
    tableCache.set(key, t);
  }
  return t;
}

/** "W-NW": the compass points a run of 15 degree sectors covers (north first, clockwise), shortest way round. */
function arcOf(sectors: number[], total: number): string {
  if (!sectors.length) return '';
  if (sectors.length >= total) return 'All Round';
  const set = new Set(sectors);
  // Start after the largest gap, so a run that crosses north reads NW-NE, not N-NW.
  let start = sectors[0];
  for (const s of sectors) if (!set.has((s + total - 1) % total)) start = s;
  let end = start;
  while (set.has((end + 1) % total) && (end + 1) % total !== start) end = (end + 1) % total;
  const a = compass8((start * 360) / total);
  const b = compass8((end * 360) / total);
  const contiguous = ((end - start + total) % total) + 1 === sectors.length;
  if (!contiguous) return Array.from(new Set(sectors.map((s) => compass8((s * 360) / total)))).slice(0, 4).join(', ');
  return a === b ? a : `${a}-${b}`;
}

export interface OcokaReadArgs {
  grid: OcokaGrid;
  /** The point in grid pixels. */
  ox: number;
  oy: number;
  at: MercXY;
  lngLat: [number, number];
  profile: string;
  going: Going;
  classLabel: (cls: number) => string;
  weapon: OcokaWeapon;
  weaponLabel: string;
  opts: GroundGuideExtendedOptions;
  /** The unit's front (`footprint.bearingDeg`), and the threat point in Web Mercator when there is one. */
  frontDeg: number;
  threatAt: MercXY | null;
  month: number;
  night: boolean;
  candidates: GroundGuideItgCandidate[];
  candidatesPending: boolean;
  visibility: VisibilityGrid | null;
  /** Also trace the viewshed for the Detail's picture. */
  picture: boolean;
  doctrine?: any;
  now?: Date;
}

/** The OCOKA reading at a point, or null where the bundle has no elevation. */
export function readOcoka(a: OcokaReadArgs): GroundGuideOcoka | null {
  const g = a.grid;
  const elev0 = elevAt(g, a.ox, a.oy);
  if (elev0 !== elev0) return null;
  const doctrine = a.doctrine ?? OCOKA_DOCTRINE;
  const o = a.opts;
  const eye = eyeFor(o.eye, a.profile);
  const T = o.surface ? tablesFor(doctrine, a.month, g.res) : null;
  const radiusM = o.radiusKm * 1000;
  const threat = resolveThreat(o, a.frontDeg, a.at, a.threatAt);
  const wp = a.weapon;
  const direct = wp.channel === 'dir' || wp.channel === 'at';
  // A weapon with no line of sight of its own (mortar, gun, air defence) is read for its local defence: small arms.
  const effM = direct ? wp.effM : 300;
  const targetM = direct ? wp.targetM : 1.7;
  const base = { eyeM: eye.m, targetM, tolM: 1, tables: T, going: a.going };

  const all = analyseSight(g, a.ox, a.oy, bearingsFor(2), { ...base, radiusM, effM });
  const obs = observationOf(all);

  const bands = newBands(FIRE_BANDS.filter((e) => e < Math.max(effM, 600)));
  const wedgeR = Math.min(radiusM, Math.max(effM, 600));
  const wedge = analyseSight(g, a.ox, a.oy, threat.allRound ? bearingsFor(2) : bearingsFor(fineStep(wedgeR, g.res), threat.bearingDeg, threat.sectorDeg), { ...base, radiusM: wedgeR, effM, bands });
  const rule = { ...DEFAULT_FIRE_RULE, ...(doctrine?.fieldOfFire?.grade ?? {}) } as FireRule;
  const fire = direct ? fireOf(wedge, effM, bands, rule) : null;
  const of = obstacleFrontOf(wedge, effM);

  const ways = waysOut(g, a.ox, a.oy, a.going, Math.min(WAYS_M, radiusM));
  const stopBy = new Map<number, number[]>();
  ways.state.forEach((s, i) => {
    if (s !== 'nogo') return;
    const c = ways.stopClass[i];
    const list = stopBy.get(c);
    if (list) list.push(i);
    else stopBy.set(c, [i]);
  });
  const stops = Array.from(stopBy, ([c, list]) => ({ label: a.classLabel(c), sectors: list.length, arc: arcOf(list, ways.sectors) })).sort((x, y) => y.sectors - x.sectors);

  const dom = dominanceOf(g, a.ox, a.oy, Math.min(KEY_M, radiusM));
  const candidates: OcokaKeyGround[] = [];
  for (const c of a.candidates.slice(0, MAX_KEY)) {
    const [px, py] = mercToPx(c.at[0], c.at[1], g.z, g.ts);
    const gx = px - g.px0;
    const gy = py - g.py0;
    const inside = gx >= 1 && gy >= 1 && gx < g.w - 1 && gy < g.h - 1;
    // A man on it and the point see each other: the same line both ways on the ground alone.
    const s = inside ? sightTo(g, a.ox, a.oy, gx, gy, { eyeM: eye.m, targetM: 1.7, radiusM: 0, effM: 0, tolM: 1, tables: T }) : null;
    candidates.push({
      name: c.name,
      kindLabel: c.kindLabel,
      level: c.level,
      distanceM: c.distanceM,
      bearingDeg: c.bearingDeg,
      compass: c.compass,
      higherM: typeof c.elevationM === 'number' ? c.elevationM - elev0 : null,
      seenP: s ? s.p : null,
      at: c.at,
      itg: c,
    });
  }

  const crop = cropShares(doctrine, a.month);
  const weather = a.visibility ? visibilityAt(a.visibility, a.lngLat[0], a.lngLat[1], a.month) : null;
  const night = a.night ? nightOf(a.now ?? new Date(), a.lngLat[1], a.lngLat[0]) : null;
  const nv = wp.nv;
  const device = nv ? (nv.ti ?? (night && night.level === 'starlight' ? nv.star : nv.moon) ?? nv.moon ?? nv.star ?? 0) : 0;
  const reach = device > 0 ? nvdReach(device, !!nv?.ti, doctrine, weather?.meanViewKm ?? null) : null;

  let picture: GroundGuideOcoka['picture'] = null;
  if (a.picture) {
    const bearings = bearingsFor(fineStep(radiusM, g.res));
    const steps = Math.max(1, Math.floor(radiusM / g.res));
    const p = new Uint8Array(bearings.length * steps);
    const pTerrain = new Uint8Array(bearings.length * steps);
    analyseSight(g, a.ox, a.oy, bearings, { ...base, going: null, radiusM, effM, trace: p, traceTerrain: pTerrain });
    picture = { rays: bearings.length, steps, bearings, p, pTerrain, radiusM, stepM: g.res };
  }

  return {
    pending: g.pending || a.candidatesPending,
    at: a.at,
    lngLat: a.lngLat,
    elevationM: elev0,
    threat,
    weapon: { ...wp, label: a.weaponLabel },
    eyeM: eye.m,
    eyeLabel: eye.label,
    month: a.month,
    radiusM,
    surface: o.surface,
    obs,
    fire,
    obstacle: { ...of, nogoLabel: of.nogoM !== null ? a.classLabel(of.nogoClass) : null, cautionLabel: of.cautionM !== null ? a.classLabel(of.cautionClass) : null, rangeM: effM },
    ways: { radiusM: ways.radiusM, total: ways.sectors, go: ways.go, slow: ways.slow, blocked: ways.blocked, state: ways.state, distM: Array.from(ways.distM), stops },
    key: { aboveMaxM: dom.aboveMaxM, maxM: dom.maxM, distM: dom.distM, compass: compass8(dom.bearingDeg), withinM: Math.min(KEY_M, radiusM), highest: dom.aboveMaxM >= -5, candidates, candidatesPending: a.candidatesPending },
    crop: { tallPct: 100 * crop.tall, hidesPct: 100 * crop.hides },
    weather,
    light: { night: a.night, level: night ? night.level : 'day', moonlitShare: night ? night.moonlitShare : null, moonIllum: night ? night.moonIllum : null },
    nightSight: reach ? { ...reach, thermal: !!nv?.ti } : null,
    picture,
  };
}

/**
 * The ground the live reading runs on: the bundle's finest tiles round the cursor, laid out once and kept until the
 * cursor nears its edge, the layers change or a tile it was missing arrives. Also keeps the last reading per cell.
 */
export class OcokaLive {
  private _grid: OcokaGrid | null = null;
  private _sig = '';
  private _tick = -1;
  private _key = '';
  private _reading: GroundGuideOcoka | null = null;

  grid(peek: TilePeek, L: OcokaLayers, z: number, ts: number, lat: number, cx: number, cy: number, radiusPx: number, tick: number): OcokaGrid {
    const sig = `${z}|${ts}|${L.cls}|${L.elevHi}|${L.elevLo}|${L.bld}`;
    const g = this._grid;
    if (g && sig === this._sig && gridHolds(g, cx, cy, radiusPx) && !(g.pending && tick !== this._tick)) return g;
    // Half a tile of slack, so a cursor that wanders does not rebuild it on every move.
    const built = buildGrid(peek, L, z, ts, lat, cx, cy, radiusPx + ts / 2);
    this._grid = built;
    this._sig = sig;
    this._tick = tick;
    this._key = '';
    this._reading = null;
    return built;
  }

  recall(key: string): GroundGuideOcoka | null {
    return key === this._key ? this._reading : null;
  }
  remember(key: string, r: GroundGuideOcoka): void {
    this._key = key;
    this._reading = r;
  }
  clear(): void {
    this._grid = null;
    this._key = '';
    this._reading = null;
  }
}

/** The month's visibility grid of the bundle (`grotbc.visibility`), fetched on first use. */
export class OcokaVisibility {
  private _grid: VisibilityGrid | null = null;
  private _state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';

  constructor(
    private readonly _indexUrl: string,
    private readonly _dataUrl: string,
    private readonly _onReady: () => void,
  ) {}

  get state(): string {
    return this._state;
  }
  /** The grid, or null while it loads (the first call starts the load) or when it failed. */
  get(): VisibilityGrid | null {
    if (this._state === 'idle') void this._load();
    return this._grid;
  }
  private async _load(): Promise<void> {
    this._state = 'loading';
    try {
      const [h, d] = await Promise.all([fetch(this._indexUrl), fetch(this._dataUrl)]);
      if (!h.ok || !d.ok) throw new Error(`HTTP ${h.status} / ${d.status}`);
      this._grid = parseVisibility(await h.json(), await d.arrayBuffer());
      this._state = 'ready';
      this._onReady();
    } catch {
      this._state = 'failed';
    }
  }
}

// ── map products ─────────────────────────────────────────────────────────────────────────────────────────────────────

const VIOLET_SECTOR_DEG = 40;
/** How far a better position is looked for, and the frontage taken for a symbol that has none (a column), metres. */
export const BETTER_SEARCH_M = 300;
export const DEFAULT_FRONTAGE_M = 100;

export interface OcokaMapArgs {
  grid: OcokaGrid;
  ox: number;
  oy: number;
  at: MercXY;
  lngLat: [number, number];
  profile: string;
  going: Going;
  classLabel: (cls: number) => string;
  reading: GroundGuideOcoka;
  opts: GroundGuideExtendedOptions;
  threatAt: MercXY | null;
  frontageM: number;
  doctrine?: any;
}

function offset(at: MercXY, cosLat: number, bearingDeg: number, distM: number): MercXY {
  const t = (bearingDeg * Math.PI) / 180;
  return [at[0] + (Math.sin(t) * distM) / cosLat, at[1] + (Math.cos(t) * distM) / cosLat];
}
/** A slice of a ring between two bearings and two distances, clockwise (an outer ring for ArcGIS). */
function slice(at: MercXY, cosLat: number, b0: number, b1: number, d0: number, d1: number): MercXY[] {
  const a = offset(at, cosLat, b0, d0);
  return [a, offset(at, cosLat, b0, d1), offset(at, cosLat, b1, d1), offset(at, cosLat, b1, d0), a];
}
/** The outline of a fan: the point, then its arc, clockwise; a full circle when the arc is 360 degrees. */
function sectorRing(at: MercXY, cosLat: number, bearingDeg: number, sectorDeg: number, radiusM: number): MercXY[] {
  const ring: MercXY[] = [];
  const all = sectorDeg >= 360;
  if (!all) ring.push(at);
  const n = Math.max(8, Math.ceil(sectorDeg / 4));
  for (let i = 0; i <= n; i++) ring.push(offset(at, cosLat, bearingDeg - sectorDeg / 2 + (i * sectorDeg) / n, radiusM));
  ring.push(ring[0]);
  return ring;
}
function gridPx(g: OcokaGrid, m: MercXY): [number, number] {
  const [px, py] = mercToPx(m[0], m[1], g.z, g.ts);
  return [px - g.px0, py - g.py0];
}
function inGrid(g: OcokaGrid, x: number, y: number): boolean {
  return x >= 2 && y >= 2 && x < g.w - 2 && y < g.h - 2;
}

/**
 * The quick products, redrawn as the cursor moves: the fire fan toward the threat with dead and screened ground,
 * the lines of sight to the ITG candidates and the threat, and what the threat sees of the position and of the ground
 * between (only when the threat is a place on the map).
 */
export function ocokaSight(a: OcokaMapArgs): OcokaMapSight {
  const g = a.grid;
  const r = a.reading;
  const doctrine = a.doctrine ?? OCOKA_DOCTRINE;
  const cosLat = Math.cos((a.lngLat[1] * Math.PI) / 180);
  const T = a.opts.surface ? tablesFor(doctrine, r.month, g.res) : null;
  const rangeM = r.obstacle.rangeM;
  const base = { eyeM: r.eyeM, targetM: r.weapon.channel === 'at' ? 2.4 : 1.7, tolM: 1, tables: T, going: null, effM: rangeM };

  // The fan: rays no finer than a degree (a polygon a ray), cut into runs of dead and screened ground.
  const all = r.threat.allRound;
  const stepWant = Math.max(1, fineStep(rangeM, g.res));
  const bearings = all ? bearingsFor(Math.max(2, stepWant)) : bearingsFor(stepWant, r.threat.bearingDeg, r.threat.sectorDeg);
  const stepDeg = all ? 360 / bearings.length : r.threat.sectorDeg / Math.max(1, bearings.length - 1);
  const steps = Math.max(1, Math.floor(rangeM / g.res));
  const p = new Uint8Array(bearings.length * steps);
  const pT = new Uint8Array(bearings.length * steps);
  analyseSight(g, a.ox, a.oy, bearings, { ...base, radiusM: steps * g.res + 0.001, trace: p, traceTerrain: pT });
  const dead: MercXY[][] = [];
  const screened: MercXY[][] = [];
  for (const run of sightRuns(p, pT, bearings.length, steps, g.res, rangeM)) {
    if (run.state === 0 || run.toM - run.fromM < 1) continue;
    const b = bearings[run.ray];
    (run.state === 1 ? dead : screened).push(slice(a.at, cosLat, b - stepDeg / 2, b + stepDeg / 2, run.fromM, run.toM));
  }
  const fan: OcokaMapSight['fan'] = { outline: sectorRing(a.at, cosLat, r.threat.bearingDeg, all ? 360 : r.threat.sectorDeg + stepDeg, rangeM), dead, screened, rangeM };

  // Lines of sight from the position.
  const lines: OcokaMapSight['lines'] = [];
  r.key.candidates.forEach((c, i) => {
    const [gx, gy] = gridPx(g, c.at);
    if (!inGrid(g, gx, gy)) return;
    const s = sightTo(g, a.ox, a.oy, gx, gy, { ...base, targetM: 1.7, radiusM: 0 });
    if (s) lines.push({ kind: 'itg', n: i + 1, to: c.at, p: s.p, blockAt: s.blockAtM !== null ? offset(a.at, cosLat, s.bearingDeg, s.blockAtM) : null });
  });

  // The threat as a place: does it see the position, and what does it see of the ground between?
  let enemy: OcokaMapSight['enemy'] = null;
  if (a.threatAt && r.threat.mode === 'point') {
    const [ex, ey] = gridPx(g, a.threatAt);
    if (inGrid(g, ex, ey)) {
      // A vehicle commander's eye for the threat (the higher eye sees more: never understate it); the target is this unit.
      const own = a.profile === 'tracked' || a.profile === 'amphibious' ? 2.4 : 1.7;
      const eOpts = { eyeM: 2.4, targetM: own, tolM: 1, tables: T, going: null, effM: 0, radiusM: 0 };
      const sees = sightTo(g, ex, ey, a.ox, a.oy, eOpts);
      if (sees) {
        const eCos = 1 / Math.cosh(a.threatAt[1] / 6378137); // cos(latitude) of the threat's place, from its Mercator northing
        const toward = (sees.bearingDeg + 360) % 360;
        const reach = Math.min(sees.distM + 300, 9000);
        const eb = bearingsFor(Math.max(1, fineStep(reach, g.res)), toward, VIOLET_SECTOR_DEG);
        const eStep = VIOLET_SECTOR_DEG / Math.max(1, eb.length - 1);
        const eSteps = Math.max(1, Math.floor(reach / g.res));
        const ep = new Uint8Array(eb.length * eSteps);
        const ept = new Uint8Array(eb.length * eSteps);
        const er = analyseSight(g, ex, ey, eb, { ...eOpts, radiusM: eSteps * g.res + 0.001, effM: sees.distM, trace: ep, traceTerrain: ept });
        const seen: MercXY[][] = [];
        for (const run of sightRuns(ep, ept, eb.length, eSteps, g.res, reach)) if (run.state === 0 && run.toM - run.fromM >= 1) seen.push(slice(a.threatAt, eCos, eb[run.ray] - eStep / 2, eb[run.ray] + eStep / 2, run.fromM, run.toM));
        let eAll = 0, eHid = 0;
        for (let i = 0; i < er.n; i++) {
          eAll += er.eAll[i];
          eHid += er.eDead[i] + er.eScr[i];
        }
        enemy = {
          at: a.threatAt,
          seesP: sees.p,
          distM: sees.distM,
          blockAt: sees.blockAtM !== null ? offset(a.threatAt, eCos, sees.bearingDeg, sees.blockAtM) : null,
          blockAtM: sees.blockAtM,
          // Never "100 %" while some of the ground between is drawn as seen.
          coveredPct: eAll ? Math.min((100 * eHid) / eAll, seen.length ? 99 : 100) : 0,
          outline: sectorRing(a.threatAt, eCos, toward, VIOLET_SECTOR_DEG + eStep, reach),
          seen,
        };
      }
    }
  }
  return { fan, lines, enemy };
}

function pathMerc(g: OcokaGrid, path: Float32Array): MercXY[] {
  const out: MercXY[] = [];
  const n = path.length / 2;
  for (let k = 0; k < n; k++) {
    if (k % 2 && k !== n - 1) continue; // every second cell is enough for a line on the map
    out.push(pxToMerc(path[k * 2] + g.px0, path[k * 2 + 1] + g.py0, g.z, g.ts));
  }
  return out;
}

/**
 * The slower products, worked out when the cursor rests: the avenues of approach from the threat to the position for a
 * formation of this frontage, with their chokepoints, and a better position nearby for the same weapon.
 */
export function ocokaPlan(a: OcokaMapArgs): OcokaMapPlan {
  const g = a.grid;
  const r = a.reading;
  const doctrine = a.doctrine ?? OCOKA_DOCTRINE;
  const cosLat = Math.cos((a.lngLat[1] * Math.PI) / 180);
  const T = a.opts.surface ? tablesFor(doctrine, r.month, g.res) : null;
  const plan: OcokaMapPlan = { frontageM: a.frontageM, from: null, fromAssumed: false, avenues: [], noAvenue: null, better: null };

  // Avenues: from the threat's place, or with only a direction from a start that far out on its bearing.
  if (!r.threat.allRound) {
    let from: MercXY | null = null;
    if (a.threatAt && r.threat.mode === 'point') {
      const [ex, ey] = gridPx(g, a.threatAt);
      if (inGrid(g, ex, ey)) from = a.threatAt;
    }
    if (!from) {
      from = offset(a.at, cosLat, r.threat.bearingDeg, Math.min(r.radiusM, 5000) - 2 * g.res);
      plan.fromAssumed = true;
    }
    const [sx, sy] = gridPx(g, from);
    if (inGrid(g, sx, sy)) {
      plan.from = from;
      const o = { going: a.going, frontageM: a.frontageM };
      const first = findAvenue(g, sx, sy, a.ox, a.oy, o);
      const found: Avenue[] = [];
      if (first.reached) {
        found.push(first);
        const mask = avenueMask(g, first, Math.max(a.frontageM, 250) / g.res);
        const second = findAvenue(g, sx, sy, a.ox, a.oy, { ...o, avoid: mask, avoidCost: 4 });
        if (second.reached && avenueOverlap(g, second, mask) < 0.6 && second.cost <= 2.2 * first.cost) found.push(second);
      } else plan.noAvenue = r.ways.stops[0]?.label ?? 'NO-GO Gr';
      const crossing = /bridge|ford|ferry|crossing|tunnel/i;
      plan.avenues = found.map((av) => ({
        path: pathMerc(g, av.path),
        lengthM: av.lengthM,
        goPct: av.goPct,
        minWidthM: av.minWidthM,
        fits: av.fits,
        chokes: av.chokes.map((c) => {
          const own = a.classLabel(c.cellClass);
          return { at: pxToMerc(c.x + g.px0, c.y + g.py0, g.z, g.ts), widthM: c.widthM, label: crossing.test(own) ? own : c.nogoClass ? `Gap in ${a.classLabel(c.nogoClass)}` : 'Narrow Gr', fromPosnM: Math.max(0, av.lengthM - c.atM) };
        }),
      }));
    }
  }

  // A better position for the same weapon and threat, on ground the mode can use.
  if (r.fire) {
    const rule = { ...DEFAULT_FIRE_RULE, ...(doctrine?.fieldOfFire?.grade ?? {}) } as FireRule;
    const b = betterPosition(g, a.ox, a.oy, {
      eyeM: r.eyeM, targetM: r.weapon.targetM, tolM: 1, tables: T, going: a.going, radiusM: 0, effM: r.obstacle.rangeM,
      threatDeg: r.threat.bearingDeg, sectorDeg: r.threat.allRound ? 360 : r.threat.sectorDeg, searchM: BETTER_SEARCH_M, rule,
    });
    if (b) {
      plan.better = {
        at: pxToMerc(b.x + g.px0, b.y + g.py0, g.z, g.ts),
        distanceM: b.distanceM,
        bearingDeg: b.bearingDeg,
        compass: compass8(b.bearingDeg),
        grade: b.fire.grade,
        hereGrade: b.here.grade,
        seenPct: b.fire.seenPct,
        hereSeenPct: b.here.seenPct,
        clearM: b.fire.clearMedianM,
        higherM: b.higherM,
      };
    }
  }
  return plan;
}

export interface OcokaViewshedArgs {
  grid: OcokaGrid;
  ox: number;
  oy: number;
  at: MercXY;
  kind: 'threat' | 'view';
  eyeM: number;
  /** Height of what is looked for: a standing man 1.7 m, a vehicle 2.4 m. */
  targetM: number;
  radiusM: number;
  month: number;
  surface: boolean;
  doctrine?: any;
}

/**
 * The Extended View's map overlay: the ground that may be seen all round from one spot out to `radiusM` (an even chance or
 * better), as rings a ray wide. From the threat's place it shows what the threat overlooks, and so the ground that is
 * out of its view; from the position, the position's own view. Rays are half a degree apart or finer.
 */
export function ocokaViewshed(a: OcokaViewshedArgs): OcokaMapOverlay {
  const g = a.grid;
  const cosLat = 1 / Math.cosh(a.at[1] / 6378137);
  const T = a.surface ? tablesFor(a.doctrine ?? OCOKA_DOCTRINE, a.month, g.res) : null;
  const bearings = bearingsFor(Math.max(0.5, fineStep(a.radiusM, g.res)));
  const stepDeg = 360 / bearings.length;
  const steps = Math.max(1, Math.floor(a.radiusM / g.res));
  const p = new Uint8Array(bearings.length * steps);
  const pT = new Uint8Array(bearings.length * steps);
  const r = analyseSight(g, a.ox, a.oy, bearings, { eyeM: a.eyeM, targetM: a.targetM, tolM: 1, tables: T, going: null, effM: a.radiusM, radiusM: steps * g.res + 0.001, trace: p, traceTerrain: pT });
  const seen: MercXY[][] = [];
  for (const run of sightRuns(p, pT, bearings.length, steps, g.res, a.radiusM)) {
    if (run.state !== 0 || run.toM - run.fromM < 1) continue;
    const b = bearings[run.ray];
    seen.push(slice(a.at, cosLat, b - stepDeg / 2, b + stepDeg / 2, run.fromM, run.toM));
  }
  let all = 0, hid = 0;
  for (let i = 0; i < r.n; i++) {
    all += r.eAll[i];
    hid += r.eDead[i] + r.eScr[i];
  }
  return { kind: a.kind, at: a.at, radiusM: a.radiusM, outline: sectorRing(a.at, cosLat, 0, 360, a.radiusM), seen, seenPct: all ? 100 * (1 - hid / all) : 0 };
}
