/**
 * MissionPlannerEngine.ts
 * Unified tactical terrain dashboard for military planners.
 *
 * Orchestrates LocalPeaksEngine, KeyTerrainIdentificationEngine, DeadGroundMapper,
 * PosDefScorerEngine, OpRankerEngine, and OcokaEngine to answer commander-level
 * questions: best defensive positions, concealed approaches, observation
 * dominance, overwatch placement, and anti-armor positions.
 *
 * Public interface aligned with LocalPeaksEngine (initialize / open / openWidget /
 * close / destroy / runAnalysis / runHeadless / clearResults / generateReport).
 */

import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import LocalPeaksEngine, { LocalPeakResult } from '../Analysis/Peaks/LocalPeaksEngine';
import KeyTerrainIdentificationEngine, { KeyTerrainFeature } from '../Analysis/KeyTerrain/KeyTerrainIdentificationEngine';
import DeadGroundMapper from '../Analysis/DeadGroundMapper';
import PosDefScorerEngine from '../Analysis/PositionDefesibilityScorer/PosDefScorerEngine';
import OpRankerEngine from '../Analysis/OpRanker/OpRankerEngine';
import OcokaEngine, { OcokaCorridor } from '../OCOKA/Ocoka';
// Optional, NON-OWNED collaborator. We import the class only for its pure static
// helpers (toPolyline / classifyClass) and types; the actual routing instance is
// the shared adapter created by SymbolEngine and reached lazily via _roadNet().
// MissionPlanner never constructs one and never requires the backend to be up.
import RoadNetworkEngine, { type TrafficabilitySummary } from '../Analysis/RoadNetworkEngine';
import GraphicsLayerManager, { LAYER_NAMES } from '../../Managers/GraphicsLayerManager';
import EngineLogger from '../../Support/EngineLogger';
import { SIDC } from '../../Support/SIDC';
import { getEchelonCode } from '../Declutter/echelon';

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'MissionPlannerEngine';
const EARTH_RADIUS_M = 6_371_008.8;

// Optical/ground observation heights used by the line-of-sight model. These model
// a standing/dismounted observer with optics and an exposed target (vehicle or
// standing figure). NOTE: this is BARE-EARTH terrain intervisibility only — it
// ignores vegetation canopy, structures, and sensor types beyond line-of-sight
// optics. Surfaced honestly in the panel field guide.
const OBSERVER_EYE_M = 2;
const TARGET_HEIGHT_M = 2;
// Per-candidate radial-viewshed probe budget. Bounded on purpose: azimuths × steps
// queries against ONE shared elevation sampler keeps a full 8-candidate solve in the
// low-thousands of synchronous queries (no per-candidate sampler creation, no N×N grid).
const PROBE_RANGE_M = 1500;
const PROBE_AZIMUTHS = 24;
const PROBE_STEPS = 15;

export type MissionMode = 'defensive' | 'offensive' | 'recon' | 'route' | 'ambush';
export type UnitType = 'infantry' | 'mechanized' | 'aviation';
export type ObserverSide = 'friendly' | 'enemy';
// Mission-movement route semantics. Withdraw/exfil head rearward to friendly; advance
// pushes forward to an objective; msr is the controlled main supply route itself.
type RouteKind = 'withdraw' | 'exfil' | 'advance' | 'msr';
type AoiMode = 'extent' | 'custom' | 'buffer';
type AoiDrawMode = 'polygon' | 'rectangle';
type MpStatusTone = 'ready' | 'running' | 'warn' | 'pick' | 'done';
type TabId = 'mission' | 'forces' | 'observation' | 'mobility' | 'results' | 'coa' | 'report';
type CautionLevel = 'info' | 'warn' | 'danger';

interface MissionPlannerWeights {
  terrain: number;
  observation: number;
  defensibility: number;
  corridor: number;
  concealment: number;
  accessibility: number;
}

interface ObserverPoint {
  id: string;
  side: ObserverSide;
  point: Point;
  active: boolean;
  name: string;
}

export interface MissionCaution {
  level: CautionLevel;
  text: string;
}

export interface MissionTerrainFeature {
  id: number;
  rank: number;
  type: string;
  name: string;
  point: Point;
  mgrs: string;
  elevationM: number;
  prominenceM: number;
  elevationAdvantageM: number;
  viewshedPct: number;
  deadGroundPct: number;
  defensibilityScore: number;
  mobilityInfluenceScore: number;
  corridorControlScore: number;
  ambushScore: number;
  exposureToEnemyPct: number;
  marchTimeMin: number;
  bearingToThreatDeg: number;
  elevationProfile: number[]; // sparkline samples toward threat
  compositeScore: number;
  recommendedUse: string;
  cautions: MissionCaution[];
}

export interface MissionPlannerHeadlessOptions {
  aoi?: Polygon | Extent;
  center?: Point;
  radiusM?: number;
  mode?: MissionMode;
  unit?: UnitType;
  threatBearingDeg?: number;
  observers?: { side: ObserverSide; point: Point }[];
  maxResults?: number;
}

interface CoaSnapshot {
  id: number;
  label: string;
  mode: MissionMode;
  unit: UnitType;
  threatBearingDeg: number;
  capturedAt: string;
  topFeatures: MissionTerrainFeature[];
  corridorsCount: number;
}

const MODE_WEIGHTS: Record<MissionMode, MissionPlannerWeights> = {
  defensive: { terrain: 0.25, observation: 0.25, defensibility: 0.20, corridor: 0.15, concealment: 0.10, accessibility: 0.05 },
  offensive: { terrain: 0.18, observation: 0.20, defensibility: 0.10, corridor: 0.20, concealment: 0.25, accessibility: 0.07 },
  recon:     { terrain: 0.18, observation: 0.32, defensibility: 0.15, corridor: 0.08, concealment: 0.20, accessibility: 0.07 },
  route:     { terrain: 0.12, observation: 0.15, defensibility: 0.08, corridor: 0.32, concealment: 0.18, accessibility: 0.15 },
  ambush:    { terrain: 0.15, observation: 0.10, defensibility: 0.15, corridor: 0.30, concealment: 0.25, accessibility: 0.05 },
};

// Which movement route each mission mode plans. Defensive falls back to a rally
// (withdraw); ambush/recon exfil to a rally; offensive pushes an axis of advance to
// the objective; route mode controls a main supply route (MSR).
const MODE_ROUTE: Record<MissionMode, RouteKind> = {
  defensive: 'withdraw',
  ambush:    'exfil',
  recon:     'exfil',
  offensive: 'advance',
  route:     'msr',
};

// Per-route presentation. `verb` is the ground/air label, `color`/`labelColor` the
// route + label RGBA, `destLabel` the destination marker text.
const ROUTE_PROFILE: Record<RouteKind, { verb: string; airVerb: string; color: number[]; labelColor: number[]; destLabel: string; objective: boolean }> = {
  withdraw: { verb: '⇨ WITHDRAW',         airVerb: '✈ WITHDRAW (air)',  color: [80, 230, 120, 0.85], labelColor: [80, 230, 120, 1], destLabel: '⚑ RALLY', objective: false },
  exfil:    { verb: '⇦ EXFIL',            airVerb: '✈ EXFIL (air)',     color: [80, 230, 120, 0.85], labelColor: [80, 230, 120, 1], destLabel: '⚑ RALLY', objective: false },
  advance:  { verb: '⇨ AXIS OF ADVANCE',  airVerb: '✈ AIR ASSAULT',     color: [239, 159, 39, 0.9],  labelColor: [245, 190, 90, 1], destLabel: '◎ OBJ',   objective: true },
  msr:      { verb: '⇨ MSR',              airVerb: '✈ AIR CORRIDOR',    color: [80, 160, 240, 0.9],  labelColor: [120, 180, 255, 1], destLabel: '◎ MSR',  objective: true },
};

const UNIT_SETTINGS: Record<UnitType, { maxSlopeDeg: number; ocokaForce: 'dismount' | 'wheeled' | 'tracked' | 'mixed'; defaultSpeedKmh: number }> = {
  infantry:   { maxSlopeDeg: 35, ocokaForce: 'dismount', defaultSpeedKmh: 5 },
  mechanized: { maxSlopeDeg: 20, ocokaForce: 'tracked',  defaultSpeedKmh: 25 },
  aviation:   { maxSlopeDeg: 90, ocokaForce: 'mixed',    defaultSpeedKmh: 180 },
};

const UTM_LETTERS = 'CDEFGHJKLMNPQRSTUVWX';

// ── helpers ────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toRad(deg: number): number { return (deg * Math.PI) / 180; }
function toDeg(rad: number): number { return (rad * 180) / Math.PI; }

// Loose lon/lat accessor type. Coords are nullable so an ArcGIS Point (whose
// longitude/latitude/x/y are `number | null | undefined`) is structurally assignable.
type LngLatLike = { longitude?: number | null; latitude?: number | null; x?: number | null; y?: number | null };

function distanceM(a: LngLatLike, b: LngLatLike): number {
  const aLat = a.latitude ?? a.y ?? 0;
  const aLon = a.longitude ?? a.x ?? 0;
  const bLat = b.latitude ?? b.y ?? 0;
  const bLon = b.longitude ?? b.x ?? 0;
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function bearingDeg(from: LngLatLike, to: LngLatLike): number {
  const lat1 = toRad(from.latitude ?? from.y ?? 0);
  const lat2 = toRad(to.latitude ?? to.y ?? 0);
  const dLon = toRad((to.longitude ?? to.x ?? 0) - (from.longitude ?? from.x ?? 0));
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function destinationPt(lon: number, lat: number, bearingD: number, distM: number): { longitude: number; latitude: number } {
  const ang = distM / EARTH_RADIUS_M;
  const br = toRad(bearingD);
  const l1 = toRad(lat);
  const o1 = toRad(lon);
  const l2 = Math.asin(Math.sin(l1) * Math.cos(ang) + Math.cos(l1) * Math.sin(ang) * Math.cos(br));
  const o2 = o1 + Math.atan2(Math.sin(br) * Math.sin(ang) * Math.cos(l1), Math.cos(ang) - Math.sin(l1) * Math.sin(l2));
  return { longitude: toDeg(o2), latitude: toDeg(l2) };
}

// UTM forward conversion for MGRS labelling — self-contained, no external dep.
function latLonToUTM(lat: number, lon: number, zone: number): { e: number; n: number } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = toRad(lat);
  const lambda = toRad(lon);
  const lambda0 = toRad((zone - 1) * 6 - 180 + 3);
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lambda - lambda0);
  const M = a * (
    (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi
    - (3 * e2 / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi)
  );
  const e = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let n = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) n += 10000000;
  return { e, n };
}

function latLonToMGRS(lat: number, lon: number, precision = 4): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  const zone = Math.floor((lon + 180) / 6) + 1;
  const latBand = Math.floor((lat + 80) / 8);
  const band = UTM_LETTERS[clamp(latBand, 0, UTM_LETTERS.length - 1)] || 'X';
  const zoneLetter = `${zone}${band}`;
  const utm = latLonToUTM(lat, lon, zone);
  const e = utm.e - 100000 * Math.floor(utm.e / 100000);
  const n = utm.n - 10000000 * Math.floor(utm.n / 10000000);
  const e100k = Math.floor(utm.e / 100000) % 10;
  const n100k = Math.floor(utm.n / 100000) % 20;
  // Lookup tables for 100k square letters (per MGRS spec) — abbreviated; use deterministic fallback.
  const colLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const rowLetters = 'ABCDEFGHJKLMNPQRSTUV';
  const setNum = ((zone - 1) % 6);
  const colSetOffset = [0, 8, 16, 0, 8, 16][setNum];
  const rowSetOffset = (setNum % 2 === 0) ? 0 : 5;
  const colLetter = colLetters[(e100k - 1 + colSetOffset + 24) % 24] || 'X';
  const rowLetter = rowLetters[(n100k + rowSetOffset) % 20] || 'X';
  const div = Math.pow(10, 5 - precision);
  const eStr = String(Math.floor(e / div)).padStart(precision, '0');
  const nStr = String(Math.floor(n / div)).padStart(precision, '0');
  return `${zoneLetter} ${colLetter}${rowLetter} ${eStr} ${nStr}`;
}

function pointFromGraphic(graphic?: Graphic | null): Point | null {
  const geom = graphic?.geometry as any;
  if (!geom) return null;
  if (geom.type === 'point') return geom as Point;
  return (geom.centroid ?? geom.extent?.center) as Point | null;
}

function pointFromLngLat(longitude: number, latitude: number): Point {
  return new Point({ longitude, latitude, spatialReference: WGS84 });
}

function lonOf(p: Point): number { return p.longitude ?? (p as any).x ?? 0; }
function latOf(p: Point): number { return p.latitude ?? (p as any).y ?? 0; }

function formatMarchTime(min: number): string {
  if (!Number.isFinite(min) || min < 0) return '—';
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

type Affiliation = 'friendly' | 'hostile' | 'neutral' | 'unknown';

/**
 * Resolve the standard identity (affiliation) of a force graphic from its SIDC,
 * using the project's canonical parser (SIDC.getIdentity() → the two-digit field
 * at positions 2–3) rather than a single-character heuristic. Falls back to the
 * legacy 2525B/C letter scheme (affiliation letter at index 1) when the SIDC is
 * not the digit-based form.
 *
 * Digit codes (per SIDC.ts standardIdentities):
 *   00 pending · 01 unknown · 02 assumed friend · 03 friend · 04 neutral ·
 *   05 suspect/joker · 06 hostile/faker
 */
function classifyAffiliation(sidcRaw: unknown): Affiliation {
  const sidc = String(sidcRaw ?? '').trim();
  if (!sidc) return 'unknown';

  // Digit scheme (project canonical / 2525D-style): identity = positions 2–3.
  const idField = sidc.length >= 4 ? new SIDC(sidc).getIdentity() : '';
  if (/^\d{2}$/.test(idField)) {
    switch (idField) {
      case '02': // assumed friend
      case '03': // friend
        return 'friendly';
      case '05': // suspect / joker
      case '06': // hostile / faker
        return 'hostile';
      case '04': // neutral
        return 'neutral';
      default:   // 00 pending, 01 unknown, 07+ presentation colours
        return 'unknown';
    }
  }

  // Legacy letter scheme (2525B/C 15-char SIDC): affiliation letter at index 1.
  const letter = sidc.charAt(1).toUpperCase();
  if (letter === 'F' || letter === 'A' || letter === 'D' || letter === 'M') return 'friendly'; // friend, assumed friend, exercise variants
  if (letter === 'H' || letter === 'S' || letter === 'J' || letter === 'K') return 'hostile';  // hostile, suspect, joker, faker
  if (letter === 'N' || letter === 'L') return 'neutral';
  return 'unknown'; // U pending/unknown, P, G, W
}

// ───────────────────────────────────────────────────────────────────────────────

export class MissionPlannerEngine {
  static readonly FEATURE_LAYER_ID = 'mission-planner-ranked-features';
  static readonly AO_LAYER_ID = 'mission-planner-ao';
  static readonly OBSERVER_LAYER_ID = 'mission-planner-observers';
  static readonly CORRIDOR_LAYER_ID = 'mission-planner-corridor-influence';
  static readonly LABEL_LAYER_ID = 'mission-planner-labels';
  static readonly SNAPSHOT_LAYER_ID = 'mission-planner-report-snapshot';
  static readonly FIRES_LAYER_ID = 'mission-planner-fires';
  static readonly HOSTILE_OBS_LAYER_ID = 'mission-planner-hostile-obs';
  static readonly WITHDRAWAL_LAYER_ID = 'mission-planner-withdrawal';

  private _view: MapView | SceneView | null = null;
  private _selectedGraphic: Graphic | null = null;
  private _panelEl: HTMLDivElement | null = null;
  private _featureLayer = new GraphicsLayer({ id: MissionPlannerEngine.FEATURE_LAYER_ID, title: 'Mission Planner — ranked features' });
  private _aoLayer = new GraphicsLayer({ id: MissionPlannerEngine.AO_LAYER_ID, title: 'Mission Planner — AO', elevationInfo: { mode: 'on-the-ground' } as any });
  private _observerLayer = new GraphicsLayer({ id: MissionPlannerEngine.OBSERVER_LAYER_ID, title: 'Mission Planner — observers' });
  private _corridorLayer = new GraphicsLayer({ id: MissionPlannerEngine.CORRIDOR_LAYER_ID, title: 'Mission Planner — corridor influence', elevationInfo: { mode: 'on-the-ground' } as any });
  private _labelLayer = new GraphicsLayer({ id: MissionPlannerEngine.LABEL_LAYER_ID, title: 'Mission Planner — labels' });
  private _snapshotLayer = new GraphicsLayer({ id: MissionPlannerEngine.SNAPSHOT_LAYER_ID, title: 'Mission Planner — report snapshot' });
  private _firesLayer = new GraphicsLayer({ id: MissionPlannerEngine.FIRES_LAYER_ID, title: 'Mission Planner — fires & sectors', elevationInfo: { mode: 'on-the-ground' } as any });
  private _hostileObsLayer = new GraphicsLayer({ id: MissionPlannerEngine.HOSTILE_OBS_LAYER_ID, title: 'Mission Planner — hostile observation', elevationInfo: { mode: 'on-the-ground' } as any });
  private _withdrawalLayer = new GraphicsLayer({ id: MissionPlannerEngine.WITHDRAWAL_LAYER_ID, title: 'Mission Planner — withdrawal route', elevationInfo: { mode: 'on-the-ground' } as any });
  private _localPeaks = new LocalPeaksEngine();
  private _keyTerrain = new KeyTerrainIdentificationEngine();
  private _deadGround = new DeadGroundMapper();
  private _posDef = new PosDefScorerEngine();
  private _opRanker = new OpRankerEngine();
  private _ocoka = new OcokaEngine();
  private _observers: ObserverPoint[] = [];
  private _results: MissionTerrainFeature[] = [];
  private _corridors: OcokaCorridor[] = [];
  private _hostileObsExtents: Extent[] = []; // bounding extents of enemy analysis areas — fallback exposure test only when DEM sampler is unavailable
  private _runSampler: any = null; // shared AOI elevation sampler for the current run (built once, reused by every probe/LOS/march call)
  // Reused scratch Point for _queryZ — synchronous helper, so one shared point is safe.
  private _scratchZPt = new Point({ longitude: 0, latitude: 0, spatialReference: WGS84 });
  private _roadEgress: { distanceKm: number; travelTimeMin: number; traffic: TrafficabilitySummary } | null = null; // optional road-following egress (when road service is up)
  private _coaSnapshots: CoaSnapshot[] = [];
  private _customAoi: Polygon | Extent | null = null;
  private _bufferCenter: Point | null = null;
  private _rallyPoint: Point | null = null; // optional manual withdrawal destination (overrides auto rally)
  private _sketch: SketchViewModel | null = null;
  private _bufferPickHandle: any = null;
  private _rallyPickHandle: any = null;
  private _viewWatchHandle: any = null;
  private _autoTimer: number | null = null;
  private _running = false;
  private _isDragging = false;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _threatBearingOverridden = false;
  private _ctxProvider: ((g: Graphic) => any[]) | null = null;

  constructor() {
    this._injectStyles();
  }

  // ── Public lifecycle / API ──────────────────────────────────────────────────

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._cancelBufferPick();
    this._detachAutoRun();
    this._view = view;
    const map = view.map as any;
    const layers = [
      this._aoLayer, this._hostileObsLayer, this._corridorLayer, this._withdrawalLayer,
      this._firesLayer, this._featureLayer, this._observerLayer, this._labelLayer, this._snapshotLayer,
    ];
    layers.forEach((layer) => { if (!map.findLayerById(layer.id)) map.add(layer); });
    // Wire the view into each headless sub-engine WITHOUT calling initialize(),
    // because initialize() would try to add GraphicsLayers with the same static
    // IDs that the AnalysisEngineRegistry's singleton instances already registered
    // (e.g. LocalPeaksEngine.PEAK_LAYER_ID).  The !findLayerById guard in each
    // sub-engine's initialize() silently skips the addMany(), leaving the sub-
    // engine's private layer references unparented — so any graphics written to
    // them never render.
    //
    // These engines are used here only for their headless compute methods
    // (runHeadless / scorePoint / rankCandidates), which only need this._view to
    // reach view.map.ground for elevation queries.  They never write to their own
    // layers during headless execution, so skipping layer registration is safe.
    (this._localPeaks as any)._view = view;
    (this._keyTerrain as any)._view = view;
    (this._deadGround as any)._view = view;
    (this._posDef     as any)._view = view;
    (this._opRanker   as any)._view = view;
    (this._ocoka      as any)._view = view;
    this._ensureSketch();
  }

  onViewChanged(view: MapView | SceneView): void {
    this.initialize(view);
  }

  open(graphic?: Graphic, view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    if (!this._view) return;
    this._selectedGraphic = graphic ?? null;
    this._ensurePanel();
    if (this._panelEl) this._panelEl.style.display = 'block';
    const src = pointFromGraphic(graphic);
    if (src) {
      const p = new Point({ longitude: lonOf(src), latitude: latOf(src), spatialReference: WGS84 });
      this._addObserver('friendly', p, 'Selected position');
      this._bufferCenter = p;
      this._drawBufferAoi();
      this._setStatus('Selected graphic loaded as friendly observer & buffer centre.', 'ready');
    } else {
      this._setStatus('Ready. Choose AOI mode (extent, custom, or buffer) and Run Analysis.', 'ready');
    }
    this._renderObservers();
    this._renderResults();
    this._renderForces();
    this._renderCoas();
    this._syncAutoRun();
    this._updateThreatBearingFromEnemies(false);
  }

  openWidget(view?: MapView | SceneView): void {
    this.open(undefined, view);
  }

  close(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
    this._cancelBufferPick();
    this._cancelRallyPick();
    this._detachAutoRun();
    this._sketch?.cancel();
  }

  destroy(): void {
    this.close();
    this.clearResults(false);
    const map = this._view?.map as any;
    if (map) {
      [this._featureLayer, this._aoLayer, this._observerLayer, this._corridorLayer,
       this._labelLayer, this._snapshotLayer, this._firesLayer, this._hostileObsLayer,
       this._withdrawalLayer]
        .forEach((layer) => map.remove(layer));
    }
    this._localPeaks.destroy();
    this._keyTerrain.destroy();
    this._deadGround.destroy();
    this._posDef.destroy();
    this._opRanker.destroy();
    this._ocoka.destroy();
    this._panelEl?.remove();
    this._panelEl = null;
    this._view = null;
  }

  async runAnalysis(): Promise<void> {
    if (!this._view || this._running) return;
    this._running = true;
    this._setRunDisabled(true);
    this._setStatus('Running terrain, observation, and mobility analysis…', 'running');
    this.clearResults(false);
    // Per-phase tracker: each boundary call sets `phase` immediately before it
    // runs so the catch can name the exact sub-engine/step that threw and show
    // its real message — instead of swallowing every failure as "Analysis failed".
    let phase = 'initialising';
    try {
      phase = 'reading inputs';
      const mode = this._selectValue('mp-mode', 'defensive') as MissionMode;
      const unit = this._selectValue('mp-unit', 'infantry') as UnitType;
      const radiusM = this._num('mp-radius', 3500);
      const center = this._resolveCenter();

      phase = 'resolving AOI';
      const aoi = this._resolveAoi(radiusM);
      if (!aoi.geometry || !aoi.extent) {
        this._setStatus('Choose or draw a valid AOI first.', 'warn');
        return;
      }
      this._drawAoi(aoi.geometry);

      const unitSettings = UNIT_SETTINGS[unit];

      phase = 'peak detection (LocalPeaksEngine.runHeadless)';
      this._setStatus('Detecting peaks…', 'running');
      // cellSizeM=300 keeps the grid ≤ ~100×100 cells at typical planning zoom levels,
      // avoiding the 240×240-cell clamp that causes multi-second Gaussian smooth freezes.
      const peaks = await this._localPeaks.runHeadless({ aoi: aoi.geometry as any, maxResults: 12, cellSizeM: 300, prominenceM: 15 });

      phase = 'key terrain (KeyTerrainIdentificationEngine.runHeadless)';
      this._setStatus('Identifying key terrain forms…', 'running');
      const keyFeatures = await this._keyTerrain.runHeadless({ center, extent: aoi.extent, radiusM, cellM: 200, maxFeatures: 14 });

      phase = 'mobility corridors (OcokaEngine.runHeadless)';
      this._setStatus('Extracting mobility corridors (OCOKA)…', 'running');
      this._corridors = await this._ocoka.runHeadless({
        center, radiusM: Math.max(radiusM, 4500), cellM: 150,
        force: unitSettings.ocokaForce, slopeThresholdDeg: unitSettings.maxSlopeDeg,
      });
      this._drawCorridors(this._corridors);

      phase = 'hostile observation (DeadGroundMapper.runHeadless)';
      this._setStatus('Mapping hostile observation envelopes…', 'running');
      await this._buildHostileObservation(radiusM, unitSettings.maxSlopeDeg);

      phase = 'merging candidates';
      const threatBrg = this._currentThreatBearing();
      const candidates = this._mergeCandidates(peaks, keyFeatures, threatBrg, unit);

      // Build ONE shared elevation sampler over the AOI (+observers +margin). Every
      // per-candidate computation — radial viewshed, enemy line-of-sight, and the
      // terrain-integrated march — queries this single cached sampler synchronously.
      // This is what makes real terrain analysis affordable: no per-candidate sampler
      // creation (the old hang source) and no full N×N grid re-solve. If the DEM is
      // unavailable the sampler is null and each metric degrades to a documented proxy.
      phase = 'building elevation sampler';
      this._runSampler = await this._buildRunSampler(aoi.extent);

      phase = 'scoring candidates (terrain line-of-sight)';
      this._setStatus(this._runSampler ? 'Scoring candidates (terrain LOS)…' : 'Scoring candidates (DEM offline → estimates)…', 'running');
      const enriched: MissionTerrainFeature[] = [];
      const scoringCandidates = candidates.slice(0, 8);
      for (const candidate of scoringCandidates) {
        enriched.push(await this._scoreCandidate(candidate, mode, unit, threatBrg, aoi.extent));
        await new Promise<void>((r) => setTimeout(r, 0)); // yield to browser between candidates
      }
      // ambush mode amplifies ambush score in composite
      if (mode === 'ambush') {
        enriched.forEach((f) => { f.compositeScore = Math.round(0.6 * f.ambushScore + 0.4 * f.compositeScore); });
      }
      enriched.sort((a, b) => b.compositeScore - a.compositeScore);
      enriched.forEach((feature, index) => { feature.rank = index + 1; feature.id = index + 1; });

      // Fetch elevation sparklines for top-3 only — each call creates one DEM sampler.
      // Done after ranking so we only pay for the positions that actually matter.
      phase = 'sparkline sampling (top-3)';
      for (const feature of enriched.slice(0, 3)) {
        feature.elevationProfile = await this._sampleSparkline(feature.point, threatBrg);
      }

      this._results = enriched;

      phase = 'drawing results & fires fans';
      this._setStatus('Drawing fires fans and withdrawal route…', 'running');
      this._drawResults();
      this._drawFiresFans(threatBrg);

      phase = 'mission route (rally/objective resolution / road egress)';
      await this._drawMissionRoute(threatBrg, unit, mode);

      phase = 'rendering panels';
      this._renderResults();
      this._renderReport();
      this._renderForces();

      const exposed = this._results.filter((f) => f.exposureToEnemyPct > 25).length;
      const road = this._roadEgress
        ? ` · road egress ${this._roadEgress.traffic.rating} ${this._roadEgress.distanceKm.toFixed(1)} km`
        : (this._roadNet()?.isAvailable === false ? ' · road net offline → terrain egress' : '');
      const msg = `Complete · ${this._results.length} ranked${exposed ? ` · ${exposed} EXPOSED to enemy` : ''}${road}.`;
      this._setStatus(msg, this._results.length ? 'done' : 'warn');
    } catch (error: any) {
      const detail = error?.message ?? String(error);
      // Full object (with stack) to the console; phase + message to the panel/log.
      console.error(`[MissionPlanner] Analysis failed during phase: ${phase}`, error);
      this._setStatus(`Failed during "${phase}": ${detail}`, 'warn');
    } finally {
      this._running = false;
      this._setRunDisabled(false);
      this._runSampler = null; // release cached DEM tiles
    }
  }

  async runHeadless(options: MissionPlannerHeadlessOptions = {}): Promise<MissionTerrainFeature[]> {
    if (!this._view) throw new Error('MissionPlannerEngine requires initialize(view) before runHeadless().');
    const mode = options.mode ?? 'defensive';
    const unit = options.unit ?? 'infantry';
    const unitSettings = UNIT_SETTINGS[unit];
    const radiusM = options.radiusM ?? 3500;
    const center = options.center
      ?? (options.aoi && (options.aoi as any).extent
            ? (options.aoi as any).extent.center as Point
            : ((options.aoi as Extent | undefined)?.center)
            ?? (this._view.center as Point));
    const aoiGeom = options.aoi
      ?? (this._view.extent ? this._view.extent.clone() : null);
    if (!aoiGeom) return [];
    const aoiExtent = (aoiGeom as any).extent ?? (aoiGeom as Extent);

    // optional observer seeding — reset first so repeated headless runs don't
    // accumulate observers from prior calls (neither runHeadless nor clearResults
    // ever cleared _observers, so threat bearings/exposure drifted across calls).
    if (options.observers) {
      this._observers = [];
      options.observers.forEach((o) => this._addObserver(o.side, o.point));
    }
    const threatBrg = options.threatBearingDeg ?? this._derivedThreatBearing();

    const peaks = await this._localPeaks.runHeadless({ aoi: aoiGeom as any, maxResults: 12, cellSizeM: 300, prominenceM: 15 });
    const keyFeatures = await this._keyTerrain.runHeadless({ center, extent: aoiExtent, radiusM, cellM: 200, maxFeatures: 14 });
    this._corridors = await this._ocoka.runHeadless({
      center, radiusM: Math.max(radiusM, 4500), cellM: 150,
      force: unitSettings.ocokaForce, slopeThresholdDeg: unitSettings.maxSlopeDeg,
    });
    await this._buildHostileObservation(radiusM, unitSettings.maxSlopeDeg);
    const candidates = this._mergeCandidates(peaks, keyFeatures, threatBrg, unit);
    this._runSampler = await this._buildRunSampler(aoiExtent);
    const enriched: MissionTerrainFeature[] = [];
    try {
      for (const candidate of candidates.slice(0, options.maxResults ?? 8)) {
        enriched.push(await this._scoreCandidate(candidate, mode, unit, threatBrg, aoiExtent));
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    } finally {
      this._runSampler = null;
    }
    if (mode === 'ambush') {
      enriched.forEach((f) => { f.compositeScore = Math.round(0.6 * f.ambushScore + 0.4 * f.compositeScore); });
    }
    enriched.sort((a, b) => b.compositeScore - a.compositeScore);
    enriched.forEach((f, i) => { f.rank = i + 1; f.id = i + 1; });
    this._results = enriched;
    return enriched;
  }

  clearResults(updateUi = true): void {
    this._featureLayer.removeAll();
    this._aoLayer.removeAll();
    this._observerLayer.removeAll();
    this._corridorLayer.removeAll();
    this._labelLayer.removeAll();
    this._snapshotLayer.removeAll();
    this._firesLayer.removeAll();
    this._hostileObsLayer.removeAll();
    this._withdrawalLayer.removeAll();
    this._results = [];
    this._corridors = [];
    this._hostileObsExtents = [];
    this._runSampler = null;
    this._roadEgress = null;
    if (updateUi) {
      this._renderObservers();
      this._renderResults();
      this._renderReport();
      this._renderForces();
      this._setStatus('Results cleared.', 'ready');
    }
  }

  generateReport(): string {
    const mode = this._selectValue('mp-mode', 'defensive');
    const unit = this._selectValue('mp-unit', 'infantry');
    const threat = this._currentThreatBearing();
    const rows = this._results.slice(0, 12).map((f) => `
      <tr>
        <td>${f.rank}</td>
        <td>${f.name}</td>
        <td>${f.mgrs}</td>
        <td>${f.compositeScore}</td>
        <td>${f.viewshedPct}%</td>
        <td>${f.deadGroundPct}%</td>
        <td>${f.exposureToEnemyPct}%</td>
        <td>${formatMarchTime(f.marchTimeMin)}</td>
        <td>${f.recommendedUse}</td>
      </tr>`).join('');
    const coaRows = this._coaSnapshots.length
      ? `<h2>COA Comparison</h2><table><thead><tr><th>COA</th><th>Mode</th><th>Threat</th><th>Top 3 (score)</th></tr></thead><tbody>${
          this._coaSnapshots.map((c) => `<tr><td>${c.label}</td><td>${c.mode}</td><td>${Math.round(c.threatBearingDeg)}°</td><td>${
            c.topFeatures.slice(0, 3).map((f) => `${f.name} (${f.compositeScore})`).join('<br>')
          }</td></tr>`).join('')
        }</tbody></table>` : '';
    return `
      <section class="mp-report-print">
        <h1>Mission Planner Terrain Report</h1>
        <p><b>Mode:</b> ${mode} · <b>Unit:</b> ${unit} · <b>Threat:</b> ${Math.round(threat)}° · <b>Features:</b> ${this._results.length}</p>
        <h2>Ranked Mission Terrain</h2>
        <table>
          <thead><tr><th>#</th><th>Feature</th><th>MGRS</th><th>Score</th><th>Obs</th><th>DG</th><th>Expo</th><th>March</th><th>Use</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9">No analysis results.</td></tr>'}</tbody>
        </table>
        <h2>Commander Notes</h2>
        <p>${this._results[0]?.recommendedUse ?? 'Run analysis to generate COA notes.'}</p>
        ${coaRows}
      </section>`;
  }

  // ── Internals: AOI / sketch ─────────────────────────────────────────────────

  private _ensureSketch(): void {
    if (!this._view || this._sketch) return;
    this._sketch = new SketchViewModel({ view: this._view, layer: this._aoLayer, defaultCreateOptions: { mode: 'click' } as any });
    this._sketch.on('create', (event: any) => {
      if (event.state !== 'complete') return;
      const geometry = event.graphic?.geometry as Polygon | Extent | null;
      if (!geometry) return;
      this._customAoi = geometry;
      this._styleAoiGraphic(event.graphic);
      this._setSelectValue('mp-aoi-mode', 'custom');
      this._setStatus('Custom AOI set. Run analysis when ready.', 'ready');
      this._maybeAutoRun();
    });
  }

  private _resolveAoi(radiusM: number): { geometry: Polygon | Extent | null; extent: Extent | null } {
    if (!this._view) return { geometry: null, extent: null };
    const mode = this._selectValue('mp-aoi-mode', 'extent') as AoiMode;
    if (mode === 'custom' && this._customAoi) {
      const ext = (this._customAoi as any).extent ?? (this._customAoi as Extent);
      return { geometry: this._customAoi, extent: ext };
    }
    if (mode === 'buffer' && this._bufferCenter) {
      const buf = this._bufferGeometry(radiusM);
      return { geometry: buf, extent: buf?.extent ?? null };
    }
    // extent fallback (also from selected graphic if available)
    const selectedExtent = (this._selectedGraphic?.geometry as any)?.extent as Extent | null;
    const ext = selectedExtent ?? this._view.extent?.clone?.() ?? null;
    return { geometry: ext, extent: ext };
  }

  private _bufferGeometry(radiusM: number): Polygon | null {
    if (!this._bufferCenter) return null;
    const raw = geometryEngine.geodesicBuffer(this._bufferCenter, radiusM, 'meters');
    return (Array.isArray(raw) ? raw[0] : raw) as Polygon | null;
  }

  private _startDraw(mode: AoiDrawMode): void {
    if (!this._view || !this._sketch) return;
    this._cancelBufferPick();
    this._aoLayer.removeAll();
    this._customAoi = null;
    this._setStatus(`Draw ${mode === 'rectangle' ? 'a bounding box' : 'a polygon'} AOI on the map.`, 'pick');
    this._sketch.create(mode === 'rectangle' ? 'rectangle' : 'polygon');
  }

  private _startBufferPick(): void {
    if (!this._view) return;
    this._cancelBufferPick();
    this._sketch?.cancel();
    this._setStatus('Click a point to centre the buffer AOI.', 'pick');
    this._bufferPickHandle = this._view.on('click', async (event: any) => {
      event.stopPropagation?.();
      let mapPoint = event.mapPoint as Point | null;
      if (!mapPoint && this._view?.type === '3d') {
        try {
          const hit = await (this._view as any).hitTest(event, { include: [(this._view as any).map.ground] });
          mapPoint = hit?.ground?.mapPoint ?? null;
        } catch { mapPoint = null; }
      }
      if (!mapPoint) return;
      this._bufferCenter = mapPoint;
      this._setSelectValue('mp-aoi-mode', 'buffer');
      this._drawBufferAoi();
      this._cancelBufferPick();
      this._setStatus('Buffer AOI set. Run analysis when ready.', 'ready');
      this._maybeAutoRun();
    });
  }

  private _cancelBufferPick(): void {
    this._bufferPickHandle?.remove?.();
    this._bufferPickHandle = null;
  }

  private _startRallyPick(): void {
    if (!this._view) return;
    this._cancelBufferPick();
    this._cancelRallyPick();
    this._sketch?.cancel();
    this._setStatus('Click a point to set the route destination (rally / objective).', 'pick');
    this._rallyPickHandle = this._view.on('click', async (event: any) => {
      event.stopPropagation?.();
      let mapPoint = event.mapPoint as Point | null;
      if (!mapPoint && this._view?.type === '3d') {
        try {
          const hit = await (this._view as any).hitTest(event, { include: [(this._view as any).map.ground] });
          mapPoint = hit?.ground?.mapPoint ?? null;
        } catch { mapPoint = null; }
      }
      if (!mapPoint) return;
      this._rallyPoint = new Point({ longitude: lonOf(mapPoint), latitude: latOf(mapPoint), spatialReference: WGS84 });
      this._cancelRallyPick();
      this._setStatus('Route destination set — it anchors the mission route. Run analysis to update.', 'ready');
      this._maybeAutoRun();
    });
  }

  private _cancelRallyPick(): void {
    this._rallyPickHandle?.remove?.();
    this._rallyPickHandle = null;
  }

  private _drawBufferAoi(): void {
    const radiusM = this._num('mp-radius', 3500);
    const geom = this._bufferGeometry(radiusM);
    if (!geom) return;
    this._aoLayer.removeAll();
    this._aoLayer.add(new Graphic({ geometry: geom, symbol: this._aoiSymbol(), attributes: { type: 'mission_planner_buffer' } }));
  }

  private _drawAoi(geometry: Polygon | Extent): void {
    this._aoLayer.removeAll();
    const geom = geometry.type === 'extent' ? Polygon.fromExtent(geometry as Extent) : geometry;
    this._aoLayer.add(new Graphic({ geometry: geom, symbol: this._aoiSymbol(), attributes: { type: 'mission_planner_aoi' } }));
  }

  private _styleAoiGraphic(graphic: Graphic): void {
    graphic.symbol = this._aoiSymbol();
    graphic.attributes = { type: 'mission_planner_custom_aoi' };
  }

  private _aoiSymbol(): any {
    return new SimpleFillSymbol({
      color: [55, 138, 221, 0.08],
      outline: new SimpleLineSymbol({ color: [55, 138, 221, 0.95], width: 1.5, style: 'dash' as any }),
    });
  }

  // ── Internals: candidates / scoring ─────────────────────────────────────────

  private _mergeCandidates(peaks: LocalPeakResult[], keyFeatures: KeyTerrainFeature[], threatBrg: number, _unit: UnitType): MissionTerrainFeature[] {
    const all: MissionTerrainFeature[] = [];
    keyFeatures.forEach((feature, idx) => {
      const p = pointFromLngLat(feature.lon, feature.lat);
      all.push(this._blankFeature({
        id: idx + 1,
        type: feature.type,
        name: `${feature.type.replace(/_/g, ' ')} #${feature.rank ?? idx + 1}`,
        point: p,
        elevationM: Math.round(feature.elev),
        prominenceM: Math.round(feature.prom),
        // Seed only — the real elevation advantage (vs. the local terrain ring) is
        // measured per candidate in _probeTerrain. Prominence is a sane, non-negative
        // stand-in used solely when the DEM sampler is unavailable. (Previously this
        // subtracted the GLOBAL max key-terrain elevation, forcing every feature but
        // the single tallest to a negative "advantage" and corrupting the ranking.)
        elevationAdvantageM: Math.round(Math.max(0, feature.prom)),
        viewshedPct: Math.round(feature.viewshedPct ?? 0),
        compositeScore: Math.round(feature.compositeScore ?? 0),
        bearingToThreatDeg: threatBrg,
      }));
    });
    peaks.forEach((peak, idx) => {
      const p = pointFromLngLat(peak.longitude, peak.latitude);
      all.push(this._blankFeature({
        id: 1000 + idx + 1,
        type: peak.type === 'peaks' ? 'local_peak' : 'valley',
        name: `${peak.type === 'peaks' ? 'Local peak' : 'Valley'} #${peak.rank}`,
        point: p,
        elevationM: Math.round(peak.elevation),
        prominenceM: Math.round(peak.prominence),
        elevationAdvantageM: Math.round(peak.elevation - peak.neighborhoodMean),
        viewshedPct: clamp(Math.round((peak.prominence / Math.max(1, peak.elevation - peak.neighborhoodMin)) * 100), 0, 100),
        compositeScore: 0,
        bearingToThreatDeg: threatBrg,
      }));
    });
    const seen = new Set<string>();
    return all.filter((feature) => {
      const key = `${lonOf(feature.point).toFixed(3)},${latOf(feature.point).toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private _blankFeature(partial: Partial<MissionTerrainFeature> & Pick<MissionTerrainFeature, 'id' | 'type' | 'name' | 'point' | 'elevationM' | 'prominenceM' | 'elevationAdvantageM' | 'viewshedPct' | 'compositeScore' | 'bearingToThreatDeg'>): MissionTerrainFeature {
    return {
      rank: 0,
      mgrs: latLonToMGRS(latOf(partial.point), lonOf(partial.point)),
      deadGroundPct: 0,
      defensibilityScore: 0,
      mobilityInfluenceScore: 0,
      corridorControlScore: 0,
      ambushScore: 0,
      exposureToEnemyPct: 0,
      marchTimeMin: 0,
      elevationProfile: [],
      recommendedUse: '',
      cautions: [],
      ...partial,
    };
  }

  private async _scoreCandidate(
    candidate: MissionTerrainFeature,
    mode: MissionMode,
    unit: UnitType,
    threatBrg: number,
    aoiExtent: Extent | null,
  ): Promise<MissionTerrainFeature> {
    const weights = MODE_WEIGHTS[mode];

    // Real terrain signals from the one shared sampler (bounded radial viewshed).
    // Every candidate — peak or key-terrain alike — flows through the same probe,
    // so observation, dead ground, and elevation advantage are finally on one scale.
    // Degrades to documented seed/proxy values only when the DEM sampler is null.
    const probe = this._probeTerrain(candidate.point);
    const hasProbe = probe != null;

    const viewshedPct = hasProbe ? probe!.viewshedPct : clamp(candidate.viewshedPct, 0, 100);
    const elevationAdvantageM = hasProbe ? probe!.elevationAdvantageM : candidate.elevationAdvantageM;
    const elevationM = hasProbe ? Math.round(probe!.groundZ) : candidate.elevationM;
    const dominanceDeg = hasProbe ? probe!.dominanceDeg : 0;

    // Dead ground = the complement of the real viewshed when probed; else the old
    // terrain-type proxy (kept only for the DEM-offline fallback path).
    const isLowGround = candidate.type.includes('valley') || candidate.type.includes('saddle') || candidate.type.includes('reentrant');
    const deadPct = hasProbe
      ? clamp(100 - viewshedPct, 0, 100)
      : clamp(Math.round(isLowGround ? 100 - candidate.viewshedPct * 0.5 : 100 - candidate.viewshedPct * 0.75), 5, 75);

    const terrainScore = clamp((elevationAdvantageM / 250) * 55 + (candidate.prominenceM / 120) * 45, 0, 100);
    const viewshedScore = clamp(viewshedPct, 0, 100);

    // Real defensibility: fields of fire (viewshed) + elevation dominance over the
    // surrounding terrain ring + the average inbound climb an attacker must make to
    // close the position. No longer a viewshed-only proxy.
    const defScore = hasProbe
      ? clamp(Math.round(
          0.40 * viewshedScore
          + 0.35 * clamp((elevationAdvantageM / 150) * 100, 0, 100)
          + 0.25 * clamp((dominanceDeg / 20) * 100, 0, 100),
        ), 0, 100)
      : clamp(Math.round(candidate.viewshedPct * 0.35 + clamp(candidate.elevationAdvantageM / 5, 0, 40) + clamp(candidate.prominenceM / 4, 0, 25)), 0, 100);

    const corridorScore = this._corridorInfluence(candidate.point);
    const concealmentScore = (mode === 'defensive')
      ? clamp(100 - Math.abs(deadPct - 35), 0, 100)
      : clamp(deadPct, 0, 100);

    // Real exposure: bare-earth line-of-sight from each active enemy observer to this
    // candidate (fraction of enemy OPs that can actually see it), not a bounding box.
    const exposurePct = this._exposureToEnemy(candidate.point);

    // Real march time: terrain-integrated walk/drive from the nearest friendly start.
    const marchTimeMin = this._marchTimeMin(candidate.point, unit);

    // Real accessibility: ease of reaching/resupplying the position — terrain march
    // cost (steep, far ground is less accessible) blended with proximity to a usable
    // mobility corridor. Replaces the former constant 55 that never differentiated.
    const marchScore = clamp(100 - marchTimeMin / 2, 0, 100);
    const accessibilityScore = Math.round(clamp(0.6 * marchScore + 0.4 * corridorScore, 0, 100));
    const mobilityInfluenceScore = Math.round((corridorScore + accessibilityScore) / 2);

    const compositeScore = Math.round(
      terrainScore * weights.terrain
      + viewshedScore * weights.observation
      + defScore * weights.defensibility
      + corridorScore * weights.corridor
      + concealmentScore * weights.concealment
      + accessibilityScore * weights.accessibility
      - exposurePct * 0.20, // positions the enemy can actually see are penalised
    );
    const ambushScore = Math.round(
      0.30 * corridorScore
      + 0.25 * clamp(100 - viewshedScore, 0, 100)
      + 0.20 * concealmentScore
      + 0.15 * defScore
      + 0.10 * clamp(100 - mobilityInfluenceScore, 0, 100),
    );

    // Sparklines are fetched separately after ranking (top-3 only) to keep the loop light.
    const elevationProfile: number[] = [];
    const cautions = this._buildCautions(deadPct, viewshedPct, defScore, exposurePct, candidate.point, aoiExtent, unit);

    return {
      ...candidate,
      elevationM,
      elevationAdvantageM,
      viewshedPct: Math.round(viewshedPct),
      mgrs: latLonToMGRS(latOf(candidate.point), lonOf(candidate.point)),
      deadGroundPct: Math.round(deadPct),
      defensibilityScore: Math.round(defScore),
      corridorControlScore: Math.round(corridorScore),
      mobilityInfluenceScore,
      ambushScore: clamp(ambushScore, 0, 100),
      exposureToEnemyPct: Math.round(exposurePct),
      marchTimeMin,
      bearingToThreatDeg: Math.round(threatBrg),
      elevationProfile,
      compositeScore: clamp(compositeScore, 0, 100),
      recommendedUse: this._recommendUse(mode, candidate.type, compositeScore, corridorScore, exposurePct),
      cautions,
    };
  }

  /**
   * Bounded radial-viewshed probe against the shared run sampler. Walks PROBE_AZIMUTHS
   * rays out to PROBE_RANGE_M, marking each step visible when its vertical angle clears
   * the running horizon (classic line-of-sight sweep). Returns the real fraction of the
   * surrounding terrain the position can observe (fields of fire), the position's
   * elevation advantage over the mean of the sampled ring, and the average inbound
   * climb angle an attacker faces (a dominance/defensibility cue). Returns null when no
   * DEM is available so callers fall back to documented proxies.
   */
  private _probeTerrain(point: Point): { viewshedPct: number; elevationAdvantageM: number; groundZ: number; dominanceDeg: number } | null {
    const sampler = this._runSampler;
    if (!sampler) return null;
    const lon = lonOf(point);
    const lat = latOf(point);
    const z0 = this._queryZ(sampler, lon, lat);
    if (z0 == null) return null;
    const obsZ = z0 + OBSERVER_EYE_M;
    const stepM = PROBE_RANGE_M / PROBE_STEPS;
    let visible = 0;
    let total = 0;
    let ringSum = 0;
    let ringCount = 0;
    let climbSum = 0;
    let climbCount = 0;
    for (let a = 0; a < PROBE_AZIMUTHS; a++) {
      const az = (a / PROBE_AZIMUTHS) * 360;
      let maxAngle = -Infinity; // running horizon (vertical angle), in radians
      for (let s = 1; s <= PROBE_STEPS; s++) {
        const d = s * stepM;
        const p = destinationPt(lon, lat, az, d);
        const z = this._queryZ(sampler, p.longitude, p.latitude);
        if (z == null) continue;
        const targetAngle = Math.atan2((z + TARGET_HEIGHT_M) - obsZ, d);
        if (targetAngle >= maxAngle) visible++;
        const terrainAngle = Math.atan2(z - obsZ, d);
        if (terrainAngle > maxAngle) maxAngle = terrainAngle;
        total++;
        ringSum += z;
        ringCount++;
        // inbound climb to reach us from this point (only counts where we dominate)
        if (z0 > z) { climbSum += toDeg(Math.atan2(z0 - z, d)); climbCount++; }
      }
    }
    if (total === 0) return null;
    const viewshedPct = clamp(Math.round((visible / total) * 100), 0, 100);
    const meanRing = ringCount ? ringSum / ringCount : z0;
    const elevationAdvantageM = Math.round(z0 - meanRing);
    const dominanceDeg = climbCount ? climbSum / climbCount : 0;
    return { viewshedPct, elevationAdvantageM, groundZ: z0, dominanceDeg };
  }

  /**
   * Bare-earth line-of-sight test from `from` (observer + eye height) to `to`
   * (target + height). Samples the intervening terrain at ~30 m and returns true
   * when the target clears the running terrain horizon. Synchronous against the
   * shared sampler.
   */
  private _losVisible(from: Point, to: Point, fromEyeM = OBSERVER_EYE_M, toHeightM = TARGET_HEIGHT_M): boolean {
    const sampler = this._runSampler;
    if (!sampler) return false;
    const flon = lonOf(from);
    const flat = latOf(from);
    const fromZ = this._queryZ(sampler, flon, flat);
    const toZ = this._queryZ(sampler, lonOf(to), latOf(to));
    if (fromZ == null || toZ == null) return false;
    const dist = distanceM(from, to);
    if (dist < 1) return true;
    const obsZ = fromZ + fromEyeM;
    const brg = bearingDeg(from, to);
    const steps = clamp(Math.round(dist / 30), 8, 80);
    let maxAngle = -Infinity;
    for (let s = 1; s < steps; s++) {
      const d = (s / steps) * dist;
      const p = destinationPt(flon, flat, brg, d);
      const z = this._queryZ(sampler, p.longitude, p.latitude);
      if (z == null) continue;
      const angle = Math.atan2(z - obsZ, d);
      if (angle > maxAngle) maxAngle = angle;
    }
    const targetAngle = Math.atan2((toZ + toHeightM) - obsZ, dist);
    return targetAngle >= maxAngle;
  }

  /** queryElevation wrapper that rejects non-finite / no-data samples (returns null). */
  private _queryZ(sampler: any, lon: number, lat: number): number | null {
    this._scratchZPt.longitude = lon;
    this._scratchZPt.latitude = lat;
    const z = sampler.queryElevation(this._scratchZPt)?.z;
    return Number.isFinite(z) ? z : null;
  }

  /**
   * Build ONE elevation sampler covering the AOI, all observers, and a margin large
   * enough for the radial probe / LOS / march reach. Created and awaited once per run;
   * thereafter all per-candidate queries hit its cached tiles synchronously. Returns
   * null if the ground/DEM cannot produce a sampler (engine then uses proxies).
   */
  private async _buildRunSampler(aoiExtent: Extent | null): Promise<any> {
    if (!this._view) return null;
    try {
      let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
      const include = (lon: number, lat: number) => {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        xmin = Math.min(xmin, lon); xmax = Math.max(xmax, lon);
        ymin = Math.min(ymin, lat); ymax = Math.max(ymax, lat);
      };
      if (aoiExtent) { include(aoiExtent.xmin, aoiExtent.ymin); include(aoiExtent.xmax, aoiExtent.ymax); }
      this._observers.forEach((o) => include(lonOf(o.point), latOf(o.point)));
      const c = this._resolveCenter();
      include(lonOf(c), latOf(c));
      if (!Number.isFinite(xmin)) return null;
      // Pad ~0.05° (~5.5 km) so edge probes/LOS stay inside cached data, then clamp the
      // overall span so a pair of far-apart observers can't request a giant low-res tile set.
      const pad = 0.05;
      xmin -= pad; ymin -= pad; xmax += pad; ymax += pad;
      const MAX_SPAN = 0.8;
      if (xmax - xmin > MAX_SPAN) { const cx = (xmin + xmax) / 2; xmin = cx - MAX_SPAN / 2; xmax = cx + MAX_SPAN / 2; }
      if (ymax - ymin > MAX_SPAN) { const cy = (ymin + ymax) / 2; ymin = cy - MAX_SPAN / 2; ymax = cy + MAX_SPAN / 2; }
      const ext = new Extent({ xmin, ymin, xmax, ymax, spatialReference: WGS84 });
      // noDataValue NaN (not 0): _queryZ()'s finite guard rejects no-data samples so LOS/march
      // probes skip gaps instead of treating them as real sea-level terrain.
      return await (this._view.map as any).ground.createElevationSampler(ext, { noDataValue: NaN });
    } catch {
      return null;
    }
  }

  private _corridorInfluence(point: Point): number {
    if (this._corridors.length === 0) return 0;
    let best = 0;
    this._corridors.forEach((corridor) => {
      corridor.path.forEach((pathPoint) => {
        // Real geodesic distance (m). The previous hard-coded 85000 m/deg longitude
        // scale only held near 40° N and skewed corridor control with latitude.
        const d = distanceM(point, { longitude: pathPoint.longitude, latitude: pathPoint.latitude });
        // Influence falls off to 0 at ~3.5 km from the corridor centreline, capped by
        // the corridor's own composite strength (you can't control a weak corridor well).
        best = Math.max(best, clamp(100 - d / 35, 0, corridor.composite));
      });
    });
    return best;
  }

  /**
   * Real exposure: the fraction of active enemy observers (0–100) that hold a
   * bare-earth line of sight to this candidate. Uses point-to-point LOS against the
   * shared sampler — the actual question a planner asks ("can the enemy OP see me?").
   *
   * Fallback (only when no DEM sampler is available): the coarse bounding-box test
   * against each enemy's analysis extent. That box approximates *proximity*, not
   * visibility, so it is used strictly as a degraded last resort.
   */
  private _exposureToEnemy(point: Point): number {
    const enemies = this._activeObservers('enemy');
    if (enemies.length === 0) return 0;
    if (this._runSampler) {
      let seen = 0;
      enemies.forEach((e) => { if (this._losVisible(e.point, point)) seen++; });
      return clamp(Math.round((seen / enemies.length) * 100), 0, 100);
    }
    // DEM offline → degrade to bounding-box proximity.
    if (this._hostileObsExtents.length === 0) return 0;
    let hits = 0;
    this._hostileObsExtents.forEach((ext) => { if (this._pointInExtent(point, ext)) hits++; });
    return clamp((hits / this._hostileObsExtents.length) * 100, 0, 100);
  }

  private _pointInExtent(point: Point, ext: Extent): boolean {
    try { return ext.contains(point); } catch { return false; }
  }

  private async _sampleSparkline(point: Point, bearing: number, samples = 24, spanM = 2000): Promise<number[]> {
    if (!this._view) return [];
    try {
      // Prefer the shared run sampler (already cached); only build a local one if a
      // sparkline is requested outside an active run.
      const sampler = this._runSampler ?? await (this._view.map as any).ground.createElevationSampler(
        new Extent({
          xmin: lonOf(point) - 0.05, ymin: latOf(point) - 0.05,
          xmax: lonOf(point) + 0.05, ymax: latOf(point) + 0.05,
          spatialReference: WGS84,
        }), { noDataValue: NaN });
      const out: number[] = [];
      for (let i = 0; i < samples; i++) {
        const t = (i - samples / 2) * (spanM / samples);
        const p = destinationPt(lonOf(point), latOf(point), bearing, t);
        const z = sampler.queryElevation(new Point({ longitude: p.longitude, latitude: p.latitude, spatialReference: WGS84 }))?.z ?? NaN;
        out.push(Number.isFinite(z) ? z : 0);
      }
      return out;
    } catch { return []; }
  }

  /**
   * Terrain-integrated march time (minutes) from the nearest friendly start point to
   * the candidate. Samples the straight path against the shared sampler and applies a
   * movement model per unit:
   *   • infantry  → Tobler's hiking function (slope-aware walking speed)
   *   • tracked / wheeled → base speed reduced on grade, near-stalled past the unit's
   *     max climbable slope
   *   • aviation  → terrain-independent air speed (straight-line)
   * Degrades to constant-speed straight-line when no DEM sampler is available.
   */
  private _marchTimeMin(point: Point, unit: UnitType): number {
    const settings = UNIT_SETTINGS[unit];
    const friendlies = this._activeObservers('friendly');
    const ref = friendlies[0]?.point ?? this._resolveCenter();
    if (!ref) return 0;
    const totalDist = distanceM(point, ref);
    if (totalDist < 1) return 0;

    // Aviation ignores ground; everything else without a DEM degrades to flat speed.
    const sampler = this._runSampler;
    if (unit === 'aviation' || !sampler) {
      return (totalDist / 1000 / Math.max(1, settings.defaultSpeedKmh)) * 60;
    }

    const brg = bearingDeg(ref, point);
    const steps = clamp(Math.round(totalDist / 50), 4, 120); // ~50 m segments, bounded
    const segM = totalDist / steps;
    let prevZ = this._queryZ(sampler, lonOf(ref), latOf(ref)) ?? 0;
    let minutes = 0;
    for (let s = 1; s <= steps; s++) {
      const d = s * segM;
      const p = destinationPt(lonOf(ref), latOf(ref), brg, d);
      const z = this._queryZ(sampler, p.longitude, p.latitude) ?? prevZ;
      const slope = (z - prevZ) / segM; // rise / run
      let speedKmh: number;
      if (unit === 'infantry') {
        // Tobler: 6·e^(−3.5·|slope+0.05|) km/h (≈5 km/h on the flat, slower up/down steep grades)
        speedKmh = 6 * Math.exp(-3.5 * Math.abs(slope + 0.05));
      } else {
        const slopeDeg = Math.abs(toDeg(Math.atan(slope)));
        const factor = slopeDeg >= settings.maxSlopeDeg ? 0.15 : clamp(1 - slopeDeg / settings.maxSlopeDeg, 0.15, 1);
        speedKmh = settings.defaultSpeedKmh * factor;
      }
      speedKmh = Math.max(0.3, speedKmh);
      minutes += (segM / 1000) / speedKmh * 60;
      prevZ = z;
    }
    return minutes;
  }

  private _recommendUse(mode: MissionMode, type: string, score: number, corridorScore: number, exposurePct: number): string {
    if (exposurePct > 50) return 'High enemy observation risk — consider alternative or use only after suppression.';
    if (mode === 'route') return corridorScore > 65 ? 'Control chokepoint and screen route movement.' : 'Monitor as secondary movement influence.';
    if (mode === 'ambush') return corridorScore > 55 ? 'Set ambush kill-zone covering the corridor.' : 'Secondary support-by-fire only.';
    if (mode === 'offensive') return corridorScore > 55 ? 'Assault support / support-by-fire position.' : 'Concealed approach checkpoint.';
    if (mode === 'recon') return score > 70 ? 'Primary OP with survivability checks.' : 'Alternate OP or relay point.';
    if (type.includes('saddle')) return 'Blocking position controlling passage through high ground.';
    return score > 70 ? 'Primary defensive position or overwatch anchor.' : 'Secondary battle position.';
  }

  private _buildCautions(deadPct: number, viewshedPct: number, defScore: number, exposurePct: number, point: Point, aoiExtent: Extent | null, _unit: UnitType): MissionCaution[] {
    const cautions: MissionCaution[] = [];
    if (exposurePct > 25) cautions.push({ level: 'danger', text: `EXPOSED ${Math.round(exposurePct)}%` });
    if (viewshedPct < 35) cautions.push({ level: 'warn', text: 'Limited observation' });
    if (deadPct > 60) cautions.push({ level: 'warn', text: 'Dead ground can be exploited by enemy' });
    if (defScore < 45) cautions.push({ level: 'warn', text: 'Weak defensibility' });
    // supply blind: > 2 km from any friendly FORCE graphic
    const forceLayer = this._view ? GraphicsLayerManager.getInstance(this._view).getLayer(LAYER_NAMES.FORCE) : null;
    const nearestFriendlyKm = forceLayer ? this._nearestFriendlyKm(point, forceLayer) : Infinity;
    if (Number.isFinite(nearestFriendlyKm) && nearestFriendlyKm > 2) cautions.push({ level: 'info', text: `Supply blind (>${nearestFriendlyKm.toFixed(1)} km)` });
    // border of AO
    if (aoiExtent) {
      const dx = Math.min(lonOf(point) - aoiExtent.xmin, aoiExtent.xmax - lonOf(point));
      const dy = Math.min(latOf(point) - aoiExtent.ymin, aoiExtent.ymax - latOf(point));
      const w = aoiExtent.xmax - aoiExtent.xmin;
      const h = aoiExtent.ymax - aoiExtent.ymin;
      if (Math.min(dx / w, dy / h) < 0.1) cautions.push({ level: 'info', text: 'Edge of AO (sampling bias)' });
    }
    return cautions;
  }

  private _nearestFriendlyKm(point: Point, forceLayer: GraphicsLayer): number {
    let best = Infinity;
    forceLayer.graphics.forEach((g) => {
      const sidc = String(g.attributes?.SIDC ?? g.attributes?.sidc ?? '');
      // Canonical affiliation (SIDC identity field) — the old sidc.charAt(3) heuristic
      // read the wrong digit and mislabelled hostile units (id '06') as friendly.
      if (classifyAffiliation(sidc) !== 'friendly') return;
      const gp = g.geometry as any;
      const gpPt = gp?.type === 'point' ? gp : gp?.centroid ?? gp?.extent?.center;
      if (!gpPt) return;
      const d = distanceM(point, gpPt) / 1000;
      if (d < best) best = d;
    });
    return best;
  }

  // ── Internals: graphics drawing ─────────────────────────────────────────────

  private _drawCorridors(corridors: OcokaCorridor[]): void {
    this._corridorLayer.removeAll();
    corridors.forEach((corridor) => {
      this._corridorLayer.add(new Graphic({
        geometry: {
          type: 'polyline',
          paths: [corridor.path.map((pt) => [pt.longitude, pt.latitude])],
          spatialReference: WGS84,
        } as any,
        symbol: new SimpleLineSymbol({
          color: corridor.rank === 1 ? [29, 158, 117, 0.9] : [239, 159, 39, 0.55],
          width: corridor.rank === 1 ? 4 : 2,
        }),
        attributes: { missionPlanner: true, type: 'mission_planner_corridor', corridorId: corridor.id, score: corridor.composite },
      }));
    });
  }

  private _drawResults(): void {
    this._featureLayer.removeAll();
    this._labelLayer.removeAll();
    this._results.forEach((feature) => {
      const t = Math.min(1, (feature.rank - 1) / 14);
      const size = clamp(22 - t * 8, 12, 24);
      const exposed = feature.exposureToEnemyPct > 25;
      const fill: [number, number, number, number] = exposed
        ? [220, 60, 48, 0.95]
        : feature.rank <= 3 ? [239, 159, 39, 0.95] : [55, 138, 221, 0.90];
      this._featureLayer.add(new Graphic({
        geometry: feature.point,
        symbol: new SimpleMarkerSymbol({
          style: 'diamond',
          size,
          color: fill,
          outline: { color: [255, 255, 255, 0.95], width: feature.rank === 1 ? 2 : 1 },
        }),
        attributes: { missionPlanner: true, type: 'mission_planner_feature', rank: feature.rank, score: feature.compositeScore, id: feature.id },
      }));
      this._labelLayer.add(new Graphic({
        geometry: feature.point,
        symbol: new TextSymbol({
          text: `#${feature.rank} · ${feature.compositeScore}`,
          color: [255, 255, 255, 1],
          haloColor: [0, 0, 0, 0.9],
          haloSize: 1,
          yoffset: -18,
          font: { size: 10, family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' } as any,
        }),
        attributes: { missionPlanner: true, type: 'mission_planner_label', featureId: feature.id },
      }));
    });
  }

  private _drawFiresFans(threatBrg: number): void {
    this._firesLayer.removeAll();
    const sectorDeg = this._num('mp-sector', 60);
    const ranges = [200, 500, 1000];
    this._results.slice(0, 3).forEach((feature) => {
      const lon = lonOf(feature.point);
      const lat = latOf(feature.point);
      // sector left + right edges
      [-sectorDeg / 2, sectorDeg / 2].forEach((delta) => {
        const end = destinationPt(lon, lat, threatBrg + delta, 1000);
        this._firesLayer.add(new Graphic({
          geometry: new Polyline({ paths: [[[lon, lat], [end.longitude, end.latitude]]], spatialReference: WGS84 }),
          symbol: new SimpleLineSymbol({ color: [239, 159, 39, 0.7], width: 1.4, style: 'dash' as any }),
          attributes: { missionPlanner: true, type: 'mission_planner_fires_edge', featureId: feature.id },
        }));
      });
      // concentric arcs at range bands
      ranges.forEach((r, idx) => {
        const arcPts: number[][] = [];
        for (let a = -sectorDeg / 2; a <= sectorDeg / 2; a += 5) {
          const p = destinationPt(lon, lat, threatBrg + a, r);
          arcPts.push([p.longitude, p.latitude]);
        }
        this._firesLayer.add(new Graphic({
          geometry: new Polyline({ paths: [arcPts], spatialReference: WGS84 }),
          symbol: new SimpleLineSymbol({
            color: [239, 159, 39, 0.5 + idx * 0.12],
            width: 1.2,
          }),
          attributes: { missionPlanner: true, type: 'mission_planner_fires_arc', featureId: feature.id, rangeM: r },
        }));
      });
    });
  }

  /**
   * Lazily reach the shared, OPTIONAL road-network adapter. It is owned by
   * SymbolEngine and only present when the external pgRouting service is wired
   * in; may also be offline. Returns null when absent — callers must degrade.
   */
  private _roadNet(): RoadNetworkEngine | null {
    return (window as any).symbolEngine?.roadNetworkEngine ?? null;
  }

  /**
   * Draw the mission movement route, mode-aware in concept, direction, and label, and
   * unit-aware in style:
   *   • defensive → WITHDRAW, ambush/recon → EXFIL  (rearward, toward friendly/rally)
   *   • offensive → AXIS OF ADVANCE                 (forward, toward the objective)
   *   • route     → MSR                             (along the dominant mobility corridor)
   * and per unit: aviation = direct air line, mechanized = trafficable corridor + real
   * road egress, infantry = most concealed (low enemy-LOS) corridor, cross-country.
   */
  private async _drawMissionRoute(threatBrg: number, unit: UnitType, mode: MissionMode): Promise<void> {
    this._withdrawalLayer.removeAll();
    this._roadEgress = null;
    const rank1 = this._results[0];
    if (!rank1) return;
    try {
      const kind = MODE_ROUTE[mode];
      const profile = ROUTE_PROFILE[kind];
      const { from, to, corridor: fixedCorridor, reversed: fixedReversed } = this._resolveRouteEndpoints(rank1.point, threatBrg, kind);
      const desiredBearing = bearingDeg(from, to);
      this._drawRouteDestMarker(to, kind);

      // Aviation: terrain-independent direct line from start to destination.
      if (unit === 'aviation') {
        const km = distanceM(from, to) / 1000;
        this._drawEgressPath(
          [[lonOf(from), latOf(from)], [lonOf(to), latOf(to)]],
          profile.color, 'dash',
          `${profile.airVerb} · ${km.toFixed(1)} km / ${formatMarchTime((km / UNIT_SETTINGS.aviation.defaultSpeedKmh) * 60)}`,
          profile.labelColor,
        );
        return;
      }

      let drawn = false;
      if (fixedCorridor) {
        // MSR mode: the route IS the dominant corridor — draw it end-to-end.
        const pts = fixedCorridor.path.map((p) => [p.longitude, p.latitude]);
        const oriented = fixedReversed ? pts.slice().reverse() : pts;
        this._drawEgressPath(oriented, profile.color, 'solid', profile.verb, profile.labelColor, fixedCorridor.id);
        drawn = true;
      } else if (this._corridors.length) {
        // Withdraw/exfil/advance: pick the best corridor for this unit, oriented toward `to`.
        let best: OcokaCorridor | null = null;
        let bestScore = -Infinity;
        let bestReversed = false;
        for (const corridor of this._corridors) {
          const { score, reversed } = this._scoreRouteCorridor(corridor, from, desiredBearing, unit);
          if (score > bestScore) { bestScore = score; best = corridor; bestReversed = reversed; }
        }
        if (best) {
          const pts = best.path.map((p) => [p.longitude, p.latitude]);
          const oriented = bestReversed ? pts.slice().reverse() : pts;
          const label = `${profile.verb} · ${unit === 'infantry' ? 'covered' : 'mobility'}`;
          this._drawEgressPath(oriented, profile.color, unit === 'infantry' ? 'short-dash' : 'solid', label, profile.labelColor, best.id);
          drawn = true;
        }
      }

      // No usable corridor: straight from→to so the route is never blank.
      if (!drawn) {
        this._drawEgressPath(
          [[lonOf(from), latOf(from)], [lonOf(to), latOf(to)]],
          profile.color, 'short-dash', profile.verb, profile.labelColor,
        );
      }

      // Vehicles get a real road-following overlay along the route when the optional
      // road service is up. Silent no-op otherwise (terrain route remains).
      if (unit === 'mechanized') await this._tryRoadEgress(from, to);
    } catch { /* route hint is best-effort */ }
  }

  /** Resolve the route's start and destination points for the given route kind. */
  private _resolveRouteEndpoints(rank1: Point, threatBrg: number, kind: RouteKind): { from: Point; to: Point; corridor?: OcokaCorridor; reversed?: boolean } {
    const mk = (lon: number, lat: number) => new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 });

    if (kind === 'withdraw' || kind === 'exfil') {
      return { from: rank1, to: this._resolveRallyPoint(rank1, threatBrg) };
    }

    if (kind === 'advance') {
      const to = this._resolveObjectivePoint(rank1, threatBrg);
      let from = this._nearestFriendlyPoint(to) ?? rank1;
      if (distanceM(from, to) < 200) {
        // Degenerate (objective on the only available start): advance toward the threat.
        const radiusM = this._num('mp-radius', 3500);
        const d = destinationPt(lonOf(from), latOf(from), threatBrg, radiusM * 1.5);
        return { from, to: mk(d.longitude, d.latitude) };
      }
      return { from, to };
    }

    // MSR: choose the dominant unit-trafficable corridor, oriented from the friendly side.
    let best: OcokaCorridor | null = null;
    let bestScore = -Infinity;
    for (const c of this._corridors) {
      const s = clamp(c.scores?.traf ?? c.composite ?? 0, 0, 100) * 0.6 + clamp(c.composite ?? 0, 0, 100) * 0.4;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    const friendly = this._nearestFriendlyPoint(rank1) ?? rank1;
    if (best && best.path.length >= 2) {
      const head = best.path[0];
      const tail = best.path[best.path.length - 1];
      const headPt = mk(head.longitude, head.latitude);
      const tailPt = mk(tail.longitude, tail.latitude);
      const reversed = distanceM(friendly, tailPt) < distanceM(friendly, headPt);
      return { from: reversed ? tailPt : headPt, to: reversed ? headPt : tailPt, corridor: best, reversed };
    }
    return { from: friendly, to: rank1 }; // no corridors → degenerate MSR placeholder
  }

  /** Resolve the rally (rearward) destination: manual pick → nearest friendly →
   *  fallback point away from the threat. */
  private _resolveRallyPoint(rank1: Point, threatBrg: number): Point {
    const mk = (lon: number, lat: number) => new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 });
    const MIN_M = 200;
    if (this._rallyPoint && distanceM(rank1, this._rallyPoint) > MIN_M) {
      return mk(lonOf(this._rallyPoint), latOf(this._rallyPoint));
    }
    const friendly = this._nearestFriendlyPoint(rank1);
    if (friendly && distanceM(rank1, friendly) > MIN_M) return friendly;
    const radiusM = this._num('mp-radius', 3500);
    const safeBearing = (threatBrg + 180) % 360; // away from the threat
    const d = destinationPt(lonOf(rank1), latOf(rank1), safeBearing, radiusM * 1.5);
    return mk(d.longitude, d.latitude);
  }

  /** Resolve the offensive objective: manual pick → (mp-objective: nearest enemy /
   *  threat bearing, or the top-ranked feature). */
  private _resolveObjectivePoint(rank1: Point, threatBrg: number): Point {
    const mk = (lon: number, lat: number) => new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 });
    const MIN_M = 200;
    if (this._rallyPoint && distanceM(rank1, this._rallyPoint) > MIN_M) {
      return mk(lonOf(this._rallyPoint), latOf(this._rallyPoint));
    }
    if (this._selectValue('mp-objective', 'enemy') === 'feature') {
      const feat = this._results[0];
      if (feat) return mk(lonOf(feat.point), latOf(feat.point));
    }
    // Default: nearest active enemy observer, else a point along the threat bearing.
    let best: Point | null = null;
    let bestD = Infinity;
    this._activeObservers('enemy').forEach((e) => {
      const d = distanceM(rank1, e.point);
      if (d > MIN_M && d < bestD) { bestD = d; best = e.point; }
    });
    if (best) return mk(lonOf(best), latOf(best));
    const radiusM = this._num('mp-radius', 3500);
    const d = destinationPt(lonOf(rank1), latOf(rank1), threatBrg, radiusM * 1.5); // toward the threat
    return mk(d.longitude, d.latitude);
  }

  /** Nearest active friendly observer, else nearest friendly FORCE graphic; null if none. */
  private _nearestFriendlyPoint(ref: Point): Point | null {
    const mk = (lon: number, lat: number) => new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 });
    let best: Point | null = null;
    let bestD = Infinity;
    this._activeObservers('friendly').forEach((o) => {
      const d = distanceM(ref, o.point);
      if (d < bestD) { bestD = d; best = o.point; }
    });
    if (!best && this._view) {
      const forceLayer = GraphicsLayerManager.getInstance(this._view).getLayer(LAYER_NAMES.FORCE);
      forceLayer?.graphics.forEach((g) => {
        const sidc = String(g.attributes?.SIDC ?? g.attributes?.sidc ?? '');
        if (classifyAffiliation(sidc) !== 'friendly') return;
        const gp = g.geometry as any;
        const pt = gp?.type === 'point' ? gp : gp?.centroid ?? gp?.extent?.center;
        if (!pt) return;
        const d = distanceM(ref, pt);
        if (d < bestD) { bestD = d; best = mk(lonOf(pt), latOf(pt)); }
      });
    }
    return best ? mk(lonOf(best), latOf(best)) : null;
  }

  /**
   * Score a corridor as a route for the given unit (0–100), and report whether it
   * should be traversed reversed so it heads toward the destination. Blends direction
   * alignment, per-unit trafficability (OCOKA traf), concealment (OCOKA mask/cc + live
   * enemy LOS along the path), and proximity to the start point.
   */
  private _scoreRouteCorridor(corridor: OcokaCorridor, ref: Point, desiredBearing: number, unit: UnitType): { score: number; reversed: boolean } {
    const fwd = this._bearingAlignment(corridor.bearingDeg, desiredBearing);
    const rev = this._bearingAlignment((corridor.bearingDeg + 180) % 360, desiredBearing);
    const reversed = rev > fwd;
    const directionScore = Math.max(fwd, rev);

    const trafScore = clamp(corridor.scores?.traf ?? corridor.composite ?? 0, 0, 100);
    const maskCc = clamp(((corridor.scores?.mask ?? 50) + (corridor.scores?.cc ?? 50)) / 2, 0, 100);
    const concealScore = clamp(0.5 * maskCc + 0.5 * (100 - this._corridorExposureFraction(corridor) * 100), 0, 100);

    let minD = Infinity;
    corridor.path.forEach((p) => {
      const d = distanceM(ref, { longitude: p.longitude, latitude: p.latitude });
      if (d < minD) minD = d;
    });
    const proximityScore = clamp(100 - minD / 30, 0, 100); // 0 at ~3 km off the start point

    const w = unit === 'infantry'
      ? { dir: 0.30, traf: 0.10, conceal: 0.45, prox: 0.15 } // foot: prize concealment, tolerate steep/off-road
      : { dir: 0.35, traf: 0.40, conceal: 0.10, prox: 0.15 }; // vehicles: prize trafficable ground
    const score = w.dir * directionScore + w.traf * trafScore + w.conceal * concealScore + w.prox * proximityScore;
    return { score, reversed };
  }

  /** Alignment of two bearings as 0–100 (100 = identical heading, 0 = opposite). */
  private _bearingAlignment(a: number, target: number): number {
    const diff = Math.abs(((a - target + 540) % 360) - 180); // 0..180
    return clamp(100 - (diff / 180) * 100, 0, 100);
  }

  /** Fraction (0–1) of sampled corridor-path points visible to any active enemy
   *  observer (real bare-earth LOS). 0 when no enemies or no DEM sampler. */
  private _corridorExposureFraction(corridor: OcokaCorridor): number {
    const enemies = this._activeObservers('enemy');
    const path = corridor.path;
    if (enemies.length === 0 || !this._runSampler || path.length === 0) return 0;
    const samples = Math.min(5, path.length);
    let exposed = 0;
    for (let i = 0; i < samples; i++) {
      const idx = Math.floor((i / Math.max(1, samples - 1)) * (path.length - 1));
      const pt = new Point({ longitude: path[idx].longitude, latitude: path[idx].latitude, spatialReference: WGS84 });
      if (enemies.some((e) => this._losVisible(e.point, pt))) exposed++;
    }
    return exposed / samples;
  }

  /** Draw a withdrawal egress polyline + a midpoint direction label. */
  private _drawEgressPath(pathLngLat: number[][], color: number[], style: string, label: string, labelColor: number[], corridorId?: string): void {
    if (pathLngLat.length < 2) return;
    this._withdrawalLayer.add(new Graphic({
      geometry: new Polyline({ paths: [pathLngLat], spatialReference: WGS84 }),
      symbol: new SimpleLineSymbol({ color: color as any, width: 3.4, style: style as any }),
      attributes: { missionPlanner: true, type: 'mission_planner_withdrawal', ...(corridorId ? { corridorId } : {}) },
    }));
    const mid = pathLngLat[Math.floor(pathLngLat.length / 2)];
    if (mid) {
      this._withdrawalLayer.add(new Graphic({
        geometry: new Point({ longitude: mid[0], latitude: mid[1], spatialReference: WGS84 }),
        symbol: new TextSymbol({
          text: label,
          color: labelColor as any,
          haloColor: [0, 0, 0, 0.9],
          haloSize: 1.2,
          font: { size: 10, family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' } as any,
        }),
        attributes: { missionPlanner: true, type: 'mission_planner_withdrawal_label' },
      }));
    }
  }

  /** Draw the route-destination marker — a friendly rally (withdraw/exfil) or an
   *  objective (advance/msr), styled to match. */
  private _drawRouteDestMarker(dest: Point, kind: RouteKind): void {
    const profile = ROUTE_PROFILE[kind];
    const markerColor = profile.objective ? [239, 159, 39, 0.9] : [80, 160, 240, 0.9];
    this._withdrawalLayer.add(new Graphic({
      geometry: dest,
      symbol: new SimpleMarkerSymbol({
        style: profile.objective ? 'diamond' : 'square', size: 13, color: markerColor as any,
        outline: { color: [255, 255, 255, 0.9], width: 1.4 },
      }),
      attributes: { missionPlanner: true, type: 'mission_planner_route_dest', kind },
    }));
    this._withdrawalLayer.add(new Graphic({
      geometry: dest,
      symbol: new TextSymbol({
        text: profile.destLabel,
        color: profile.labelColor as any,
        haloColor: [0, 0, 0, 0.9],
        haloSize: 1.2,
        yoffset: 11,
        font: { size: 10, family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' } as any,
      }),
      attributes: { missionPlanner: true, type: 'mission_planner_route_dest_label' },
    }));
  }

  /**
   * If the optional road-network service is reachable, overlay a road-following
   * egress route with drive-time and GO/SLOW-GO/NO-GO trafficability on top of
   * the terrain corridor, and cache the summary for the Mobility tab. Returns
   * quietly when the adapter is absent, disabled, offline, or finds no route —
   * MissionPlanner carries on with the terrain corridor it already drew.
   */
  private async _tryRoadEgress(from: Point, dest: Point): Promise<void> {
    const rn = this._roadNet();
    if (!rn) return;                            // engine not wired in → terrain egress only
    if (!(await rn.ensureAvailable())) return;  // backend down/disabled → terrain egress only

    // Route along real roads from the position to the resolved rally destination.
    const res = await rn.route(from, dest);
    if (!res.ok) return;                        // no nearby road / no path / error → terrain egress only
    const line = RoadNetworkEngine.toPolyline(res.data.geometry);
    if (!line) return;

    const traffic = res.data.trafficability;
    const tierColor: [number, number, number] =
      traffic.rating === 'GO' ? [80, 230, 120]
      : traffic.rating === 'SLOW-GO' ? [240, 200, 70]
      : [225, 90, 70];
    this._withdrawalLayer.add(new Graphic({
      geometry: line,
      symbol: new SimpleLineSymbol({ color: [...tierColor, 0.95] as any, width: 3.0 }),
      attributes: { missionPlanner: true, type: 'mission_planner_withdrawal_road' },
    }));
    const path = line.paths?.[0] ?? [];
    const mid = path[Math.floor(path.length / 2)];
    if (mid) {
      this._withdrawalLayer.add(new Graphic({
        geometry: new Point({ longitude: mid[0], latitude: mid[1], spatialReference: WGS84 }),
        symbol: new TextSymbol({
          text: `🛣 EGRESS ${traffic.rating} · ${res.data.distanceKm.toFixed(1)} km / ${formatMarchTime(res.data.travelTimeMin)}`,
          color: [...tierColor, 1] as any,
          haloColor: [0, 0, 0, 0.9],
          haloSize: 1.2,
          yoffset: 12,
          font: { size: 10, family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' } as any,
        }),
        attributes: { missionPlanner: true, type: 'mission_planner_withdrawal_road_label' },
      }));
    }
    this._roadEgress = { distanceKm: res.data.distanceKm, travelTimeMin: res.data.travelTimeMin, traffic };
  }

  private async _buildHostileObservation(radiusM: number, maxSlopeDeg: number): Promise<void> {
    this._hostileObsLayer.removeAll();
    this._hostileObsExtents = [];
    const enemies = this._activeObservers('enemy');
    if (enemies.length === 0) return;
    for (const enemy of enemies) {
      try {
        const analyzedRadiusM = Math.min(radiusM, 3000);
        const summary = await this._deadGround.runHeadless({
          observer: enemy.point,
          radiusM: analyzedRadiusM,
          cellM: 220,
        });
        if (!summary?.extent) continue;
        this._hostileObsExtents.push(summary.extent);
        // Visual envelope of the enemy's observation. The ring radius is the ACTUAL
        // analysed radius (never the larger AOI radius — the old code drew reach the
        // dead-ground solve never covered), and the visible fraction is encoded as fill
        // opacity rather than a shrunken radius, so the ring doesn't imply a hard cutoff.
        // Per-candidate exposure is decided by real line-of-sight in _exposureToEnemy,
        // not by this ring — this is a situational-awareness overlay only.
        const visibleFraction = clamp(1 - (summary.deadGroundPct / 100), 0, 1);
        const buf = geometryEngine.geodesicBuffer(enemy.point, analyzedRadiusM, 'meters');
        const polygon = (Array.isArray(buf) ? buf[0] : buf) as Polygon | null;
        if (polygon) {
          this._hostileObsLayer.add(new Graphic({
            geometry: polygon,
            symbol: new SimpleFillSymbol({
              color: [220, 60, 48, clamp(0.04 + visibleFraction * 0.18, 0.04, 0.22)],
              outline: new SimpleLineSymbol({ color: [220, 60, 48, 0.55], width: 1, style: 'dot' as any }),
            }),
            attributes: { missionPlanner: true, type: 'mission_planner_hostile_obs', observerId: enemy.id, visibleFraction, analyzedRadiusM },
          }));
        }
      } catch (e) {
        // silently skip — engine may not support every terrain area
        void e; void maxSlopeDeg;
      }
    }
  }

  // ── Internals: observers & threat bearing ──────────────────────────────────

  private _activeObservers(side?: ObserverSide): ObserverPoint[] {
    return this._observers.filter((o) => o.active && (!side || o.side === side));
  }

  private _addObserver(side: ObserverSide, point: Point, name?: string): ObserverPoint {
    const id = `mp-obs-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const observer: ObserverPoint = {
      id, side, point, active: true,
      name: name ?? `${side === 'friendly' ? 'Friendly' : 'Enemy'} OBS ${this._observers.filter((o) => o.side === side).length + 1}`,
    };
    this._observers.push(observer);
    if (side === 'enemy') this._updateThreatBearingFromEnemies(true);
    return observer;
  }

  /** Public helper used by ContextMenuManager pin-from-map provider. */
  public pinObserverFromGraphic(graphic: Graphic, side: ObserverSide): void {
    const p = pointFromGraphic(graphic);
    if (!p) return;
    const observer = this._addObserver(side, new Point({ longitude: lonOf(p), latitude: latOf(p), spatialReference: WGS84 }));
    this._renderObservers();
    this._setStatus(`Pinned ${observer.name} from map.`, 'ready');
    if (this._panelEl) this._panelEl.style.display = 'block';
    this._activateTab('observation');
  }

  private _currentThreatBearing(): number {
    if (this._threatBearingOverridden) return this._num('mp-threat-bearing', 0);
    return this._derivedThreatBearing();
  }

  private _derivedThreatBearing(): number {
    const enemies = this._activeObservers('enemy');
    if (enemies.length === 0) return this._num('mp-threat-bearing', 0);
    const centre = this._resolveCenter();
    if (!centre) return 0;
    let sumSin = 0;
    let sumCos = 0;
    enemies.forEach((e) => {
      const b = bearingDeg(centre, e.point);
      sumSin += Math.sin(toRad(b));
      sumCos += Math.cos(toRad(b));
    });
    return (toDeg(Math.atan2(sumSin, sumCos)) + 360) % 360;
  }

  private _updateThreatBearingFromEnemies(force: boolean): void {
    if (!this._threatBearingOverridden || force) {
      const value = Math.round(this._derivedThreatBearing());
      const input = this._panelEl?.querySelector<HTMLInputElement>('#mp-threat-bearing');
      if (input) input.value = String(value);
      this._threatBearingOverridden = false;
    }
  }

  private _resolveCenter(): Point {
    if (this._bufferCenter) return new Point({ longitude: lonOf(this._bufferCenter), latitude: latOf(this._bufferCenter), spatialReference: WGS84 });
    const selected = pointFromGraphic(this._selectedGraphic);
    if (selected) return new Point({ longitude: lonOf(selected), latitude: latOf(selected), spatialReference: WGS84 });
    const center = this._view?.center;
    if (!center) return pointFromLngLat(0, 0);
    return new Point({ longitude: center.longitude ?? (center as any).x, latitude: center.latitude ?? (center as any).y, spatialReference: WGS84 });
  }

  // ── Internals: panel UI ────────────────────────────────────────────────────

  private _ensurePanel(): void {
    if (this._panelEl) return;
    const panel = document.createElement('div');
    panel.className = 'mp-panel';
    panel.innerHTML = this._buildPanelHTML();
    document.body.appendChild(panel);
    this._panelEl = panel;
    this._bindPanelEvents();
    this._makeDraggable();
    this._registerCtxProvider();
  }

  private _buildPanelHTML(): string {
    return `
      <div class="mp-header" id="mp-drag-handle">
        <span class="mp-header-icon">MP</span>
        <span class="mp-header-title">Mission Planner</span>
        <span class="mp-status-dot" id="mp-status-dot"></span>
        <span class="mp-status-lbl" id="mp-status-lbl">Ready</span>
        <button class="mp-help-btn" id="mp-help-btn" title="Field Guide">?</button>
        <button class="mp-min-btn" id="mp-min-btn" title="Minimize">▾</button>
        <button class="mp-close-btn" id="mp-close-btn" title="Close">✕</button>
      </div>
      <div class="mp-help-popover" id="mp-help-popover" hidden>
        <div class="mp-help-head">
          <div>
            <div class="mp-help-kicker">Field Guide</div>
            <div class="mp-help-title">Unified Mission Terrain Dashboard</div>
          </div>
          <button id="mp-help-close">x</button>
        </div>
        <div class="mp-help-body">
          <p>Aggregates six terrain &amp; force engines into a single ranked picture of the AO: <b>peaks</b>, <b>key terrain</b>, <b>OCOKA corridors</b>, <b>dead ground</b>, <b>position defensibility</b>, and <b>OP ranking</b> — re-weighted by mission mode.</p>
          <ol>
            <li><b>Mission</b> — pick mode (defensive, offensive, recon, route, ambush), unit type, AOI radius, and threat bearing. Auto-run reruns on pan/zoom.</li>
            <li><b>Forces</b> — order-of-battle summary of friendly &amp; hostile graphics inside the AOI.</li>
            <li><b>Obs</b> — add/remove friendly &amp; enemy observers. Enemies drive hostile-LOS envelopes and threat bearing.</li>
            <li><b>Mobility</b> — OCOKA corridors feed the corridor-control and ambush scores, and drive the <b>mission route</b>, whose <i>purpose</i> follows the mode: defensive = <b>Withdraw</b>, ambush/recon = <b>Exfil</b> (rearward, toward your nearest friendly force), offensive = <b>Axis of Advance</b> toward the objective (Enemy/threat or the Top-ranked feature — set by <i>Objective</i>), route = <b>MSR</b> along the dominant corridor. The route <i>style</i> follows the unit — aviation flies a direct line, mechanized takes the most trafficable corridor + a real road egress, infantry takes the most concealed (low enemy line-of-sight) corridor. <i>Pick Dest</i> overrides the destination in any mode.</li>
            <li><b>Results</b> — ranked terrain features. Score bars: green=safe primary, orange=top-3, red=EXPOSED to enemy observation. Chips flag dead ground, weak defensibility, supply blind, edge-of-AO.</li>
            <li><b>COA</b> — snapshot up to 3 named courses-of-action for side-by-side compare.</li>
            <li><b>Report</b> — print, CSV, GeoJSON, or Shapefile export of the ranked features.</li>
          </ol>
          <p>Composite score weighting changes by mode (defensive favours terrain + observation; ambush favours corridor + concealment). Exposure to enemy LOS subtracts from the composite.</p>
          <p><b>How the numbers are derived (all measured against terrain elevation, not estimated):</b></p>
          <ul>
            <li><b>Obs / Dead ground</b> — a radial line-of-sight sweep around each position: the real share of the surrounding terrain it can / cannot see.</li>
            <li><b>Expo</b> — bare-earth line-of-sight from every active enemy observer to the position: the fraction of enemy OPs that can actually see it (not mere proximity).</li>
            <li><b>Def</b> — fields of fire + elevation dominance over the surrounding terrain + the inbound climb an attacker must make.</li>
            <li><b>March</b> — terrain-integrated travel from the nearest friendly start: Tobler's slope-aware pace (foot), grade-reduced speed (vehicles), air-speed (aviation).</li>
            <li><b>Corr</b> — geodesic distance to the nearest OCOKA corridor, capped by that corridor's strength.</li>
          </ul>
          <p><b>Limitations — read before briefing:</b> line-of-sight is <b>bare-earth only</b> — it ignores vegetation canopy, buildings, and any sensor beyond optical/visual (no radar/thermal/defilade behind man-made cover). Results are as good as the underlying DEM resolution. If the elevation service is unavailable the panel falls back to coarse estimates and the status line says so.</p>
        </div>
      </div>
      <div class="mp-tabs">
        <button data-tab="mission" class="active">Mission</button>
        <button data-tab="forces">Forces</button>
        <button data-tab="observation">Obs</button>
        <button data-tab="mobility">Mobility</button>
        <button data-tab="results">Results</button>
        <button data-tab="coa">COA</button>
        <button data-tab="report">Report</button>
      </div>
      <div class="mp-body">
        <div class="mp-status-msg" id="mp-status">Ready.</div>

        <section data-panel="mission">
          <div class="mp-sec">Mission</div>
          <div class="mp-grid">
            <label class="mp-field"><span>Mode</span><select id="mp-mode">
              <option value="defensive">Defensive</option>
              <option value="offensive">Offensive</option>
              <option value="recon">Recon</option>
              <option value="route">Route</option>
              <option value="ambush">Ambush</option>
            </select></label>
            <label class="mp-field"><span>Unit</span><select id="mp-unit">
              <option value="infantry">Infantry</option>
              <option value="mechanized">Mechanized</option>
              <option value="aviation">Aviation</option>
            </select></label>
            <label class="mp-field"><span>AOI radius (m)</span><input id="mp-radius" type="number" min="500" max="50000" step="250" value="3500"></label>
            <label class="mp-field"><span>AOI mode</span><select id="mp-aoi-mode">
              <option value="extent">View extent</option>
              <option value="custom">Custom polygon</option>
              <option value="buffer">Buffer centre</option>
            </select></label>
            <label class="mp-field"><span>Threat bearing °</span><input id="mp-threat-bearing" type="number" min="0" max="360" step="1" value="0"></label>
            <label class="mp-field"><span>Sector °</span><input id="mp-sector" type="number" min="20" max="180" step="5" value="60"></label>
            <label class="mp-field"><span>Objective (offensive)</span><select id="mp-objective" title="What the offensive Axis of Advance heads toward. 'Pick Dest' overrides this. Ignored in route/MSR mode (which follows the dominant corridor).">
              <option value="enemy">Enemy / threat</option>
              <option value="feature">Top-ranked feature</option>
            </select></label>
          </div>
          <div class="mp-btn-row">
            <button id="mp-draw-poly" class="mp-btn">Draw Polygon</button>
            <button id="mp-draw-box" class="mp-btn">Draw Box</button>
            <button id="mp-pick-buffer" class="mp-btn">Pick Buffer</button>
            <button id="mp-pick-rally" class="mp-btn" title="Click the map to set the route destination — rally point for withdraw/exfil modes, objective for advance/route modes. Overrides the automatic destination.">Pick Dest</button>
          </div>
          <div class="mp-toggle"><label>Auto-run on view change</label><input id="mp-auto-run" type="checkbox"></div>
          <div class="mp-btn-row">
            <button id="mp-run" class="mp-btn primary">Run Analysis</button>
            <button id="mp-clear" class="mp-btn">Clear</button>
            <button id="mp-save-coa" class="mp-btn ok">Save COA</button>
          </div>
        </section>

        <section data-panel="forces" hidden>
          <div class="mp-sec">Order of Battle (in AOI)</div>
          <div id="mp-forces-summary" class="mp-forces"></div>
        </section>

        <section data-panel="observation" hidden>
          <div class="mp-sec">Observers</div>
          <div class="mp-btn-row">
            <button id="mp-add-friendly" class="mp-btn">+ Friendly</button>
            <button id="mp-add-enemy" class="mp-btn">+ Enemy</button>
            <button id="mp-clear-observers" class="mp-btn">Clear</button>
          </div>
          <div id="mp-observer-list" class="mp-observer-list"></div>
        </section>

        <section data-panel="mobility" hidden>
          <div class="mp-sec">Mobility</div>
          <div class="mp-copy">OCOKA corridors and chokepoints feed the <b>corridor control</b> score and ambush composite.</div>
          <div id="mp-corridor-summary" class="mp-forces"></div>
          <div class="mp-sec" style="margin-top:10px">Road Network <span style="font-weight:400;opacity:0.7">(optional)</span></div>
          <div class="mp-copy">Road-following egress &amp; trafficability from an external road service. Falls back to terrain corridors when it is offline.</div>
          <div id="mp-road-summary" class="mp-forces"></div>
        </section>

        <section data-panel="results" hidden>
          <div class="mp-sec">Ranked Mission Terrain</div>
          <div id="mp-results-list" class="mp-results"></div>
        </section>

        <section data-panel="coa" hidden>
          <div class="mp-sec">COA Comparison (in-memory)</div>
          <div id="mp-coa-list" class="mp-coa-list"></div>
          <div class="mp-copy">Save up to 3 named snapshots. Cleared on panel close or page reload.</div>
        </section>

        <section data-panel="report" hidden>
          <div class="mp-sec">Report</div>
          <div class="mp-btn-row">
            <button id="mp-print" class="mp-btn">Print</button>
            <button id="mp-csv" class="mp-btn">CSV</button>
            <button id="mp-geojson" class="mp-btn">GeoJSON</button>
            <button id="mp-shp" class="mp-btn">Shapefile</button>
          </div>
          <div id="mp-report"></div>
        </section>
      </div>`;
  }

  private _bindPanelEvents(): void {
    this._el('mp-min-btn')?.addEventListener('click', () => {
      const body = this._panelEl?.querySelector<HTMLElement>('.mp-body');
      if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
    });
    this._el('mp-close-btn')?.addEventListener('click', () => this.close());
    this._el('mp-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = this._el('mp-help-popover') as HTMLElement | null;
      if (help) help.hidden = !help.hidden;
    });
    this._el('mp-help-close')?.addEventListener('click', () => {
      const help = this._el('mp-help-popover') as HTMLElement | null;
      if (help) help.hidden = true;
    });
    this._el('mp-run')?.addEventListener('click', () => void this.runAnalysis());
    this._el('mp-clear')?.addEventListener('click', () => this.clearResults());
    this._el('mp-save-coa')?.addEventListener('click', () => this._saveCoa());
    this._el('mp-draw-poly')?.addEventListener('click', () => this._startDraw('polygon'));
    this._el('mp-draw-box')?.addEventListener('click', () => this._startDraw('rectangle'));
    this._el('mp-pick-buffer')?.addEventListener('click', () => this._startBufferPick());
    this._el('mp-pick-rally')?.addEventListener('click', () => this._startRallyPick());
    this._el('mp-add-friendly')?.addEventListener('click', () => { this._addObserver('friendly', this._resolveCenter()); this._renderObservers(); });
    this._el('mp-add-enemy')?.addEventListener('click', () => { this._addObserver('enemy', this._resolveCenter()); this._renderObservers(); });
    this._el('mp-clear-observers')?.addEventListener('click', () => { this._observers = []; this._renderObservers(); this._updateThreatBearingFromEnemies(true); });
    this._el('mp-print')?.addEventListener('click', () => window.print());
    this._el('mp-csv')?.addEventListener('click', () => this._downloadText('mission-planner-results.csv', this._toCsv(), 'text/csv'));
    this._el('mp-geojson')?.addEventListener('click', () => this._downloadText('mission-planner-results.geojson', this._toGeoJson(), 'application/geo+json'));
    this._el('mp-shp')?.addEventListener('click', () => this._exportShapefile());
    this._el('mp-auto-run')?.addEventListener('change', () => this._syncAutoRun());
    this._el('mp-threat-bearing')?.addEventListener('input', () => { this._threatBearingOverridden = true; });
    this._el('mp-radius')?.addEventListener('change', () => { if (this._bufferCenter) this._drawBufferAoi(); });
    this._panelEl?.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => this._activateTab(button.dataset.tab as TabId));
    });
  }

  private _activateTab(tab: TabId): void {
    this._panelEl?.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    this._panelEl?.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _renderObservers(): void {
    this._observerLayer.removeAll();
    this._observers.forEach((observer) => {
      this._observerLayer.add(new Graphic({
        geometry: observer.point,
        symbol: new SimpleMarkerSymbol({
          style: observer.side === 'friendly' ? 'circle' : 'x',
          size: 12,
          color: observer.side === 'friendly'
            ? [55, 138, 221, observer.active ? 0.9 : 0.35]
            : [220, 60, 48, observer.active ? 0.9 : 0.35],
          outline: { color: [255, 255, 255, 0.85], width: 1.4 },
        }),
        attributes: { missionPlanner: true, type: 'mission_planner_observer', observerId: observer.id, side: observer.side },
      }));
    });
    const list = this._panelEl?.querySelector('#mp-observer-list');
    if (list) {
      list.innerHTML = this._observers.length
        ? this._observers.map((o) => `
          <label class="mp-observer-row" data-side="${o.side}">
            <input type="checkbox" data-mp-observer="${o.id}" ${o.active ? 'checked' : ''}>
            <span class="mp-obs-name">${o.name}</span>
            <span class="mp-obs-mgrs">${latLonToMGRS(latOf(o.point), lonOf(o.point), 3)}</span>
            <button class="mp-obs-del" data-mp-remove="${o.id}" title="Remove">×</button>
          </label>`).join('')
        : '<div class="mp-empty">No observers. Add friendly/enemy points to enrich the analysis.</div>';
      list.querySelectorAll<HTMLInputElement>('[data-mp-observer]').forEach((input) => {
        input.addEventListener('change', () => {
          const observer = this._observers.find((item) => item.id === input.dataset.mpObserver);
          if (observer) observer.active = input.checked;
          this._renderObservers();
          if (observer?.side === 'enemy') this._updateThreatBearingFromEnemies(true);
        });
      });
      list.querySelectorAll<HTMLButtonElement>('[data-mp-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._observers = this._observers.filter((o) => o.id !== btn.dataset.mpRemove);
          this._renderObservers();
          this._updateThreatBearingFromEnemies(true);
        });
      });
    }
    this._updateThreatBearingFromEnemies(false);
  }

  private _renderResults(): void {
    const list = this._panelEl?.querySelector('#mp-results-list');
    if (!list) return;
    if (!this._results.length) {
      list.innerHTML = '<div class="mp-empty">Run analysis to populate ranked mission terrain.</div>';
      return;
    }
    const maxComp = Math.max(1, ...this._results.map((f) => f.compositeScore));
    list.innerHTML = this._results.map((feature) => {
      const t = Math.min(1, (feature.rank - 1) / 14);
      const exposed = feature.exposureToEnemyPct > 25;
      const cr = exposed ? 220 : Math.round(255 - t * 55);
      const cg = exposed ? 60 : Math.round(168 - t * 78);
      const cb = exposed ? 48 : Math.round(40 - t * 14);
      const hex = '#' + [cr, cg, cb].map((v) => v.toString(16).padStart(2, '0')).join('');
      const compPct = Math.round((feature.compositeScore / maxComp) * 100);
      const sparkline = this._sparklineSVG(feature.elevationProfile);
      const chips = feature.cautions.map((c) =>
        `<span class="mp-chip mp-chip-${c.level}">${c.text}</span>`).join('');
      return `<div class="mp-row" data-rank="${feature.rank}">
        <div class="mp-row-header">
          <span class="mp-row-badge" style="background:${hex}">#${feature.rank}</span>
          <span class="mp-row-name">${feature.name}</span>
          <span class="mp-row-score">${feature.compositeScore}</span>
          <div class="mp-row-btns">
            <button data-fly="${feature.rank}" title="Fly to position">↗</button>
          </div>
        </div>
        <div class="mp-row-bar-wrap"><div class="mp-row-bar" style="width:${compPct}%;background:${hex}88"></div></div>
        <div class="mp-row-metrics">
          <span><span class="mp-lbl">Obs</span>${feature.viewshedPct}%</span>
          <span><span class="mp-lbl">DG</span>${feature.deadGroundPct}%</span>
          <span><span class="mp-lbl">Def</span>${feature.defensibilityScore}</span>
          <span><span class="mp-lbl">Corr</span>${feature.corridorControlScore}</span>
          <span><span class="mp-lbl">Amb</span>${feature.ambushScore}</span>
          <span><span class="mp-lbl">March</span>${formatMarchTime(feature.marchTimeMin)}</span>
          ${sparkline}
        </div>
        <div class="mp-row-mgrs">${feature.mgrs} · ${feature.elevationM} m · brg ${feature.bearingToThreatDeg}°</div>
        ${chips ? `<div class="mp-row-chips">${chips}</div>` : ''}
      </div>`;
    }).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-fly]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const feature = this._results.find((f) => String(f.rank) === btn.dataset.fly);
        if (feature) void this._view?.goTo({ target: feature.point, zoom: 14, tilt: this._view.type === '3d' ? 55 : undefined } as any, { duration: 900 });
      });
    });
  }

  private _sparklineSVG(samples: number[]): string {
    if (!samples.length) return '';
    const w = 64; const h = 18;
    const min = Math.min(...samples); const max = Math.max(...samples);
    const range = Math.max(1, max - min);
    const points = samples.map((v, i) => {
      const x = (i / (samples.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const trend = samples[samples.length - 1] - samples[0];
    const color = trend >= 0 ? '#1d9e75' : '#dc3c30';
    return `<span class="mp-sparkline" title="Elevation toward threat: ${trend >= 0 ? '+' : ''}${Math.round(trend)} m"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" stroke="${color}" stroke-width="1.5" fill="none"/></svg></span>`;
  }

  private _renderReport(): void {
    const report = this._panelEl?.querySelector('#mp-report');
    if (report) report.innerHTML = this.generateReport();
  }

  /** Mobility-tab readout of the optional road service. Mirrors its availability honestly. */
  private _roadSummaryHtml(): string {
    const rn = this._roadNet();
    if (!rn) return '<div class="mp-empty">Road-network service not loaded — terrain corridors drive mobility.</div>';
    if (!rn.isAvailable) return '<div class="mp-empty">Road-network service offline — egress falls back to terrain corridors.</div>';
    const eg = this._roadEgress;
    if (!eg) return '<div class="mp-empty">Road service online. Run analysis to compute a road-following egress.</div>';
    const t = eg.traffic;
    return '<table class="mp-table"><tbody>'
      + `<tr><td>Egress</td><td><b>${t.rating}</b></td></tr>`
      + `<tr><td>Distance</td><td>${eg.distanceKm.toFixed(1)} km</td></tr>`
      + `<tr><td>Drive time</td><td>${formatMarchTime(eg.travelTimeMin)}</td></tr>`
      + `<tr><td>Limiting</td><td>${RoadNetworkEngine.classifyClass(t.limitingClass).label}</td></tr>`
      + `<tr><td>Dominant</td><td>${RoadNetworkEngine.classifyClass(t.dominantClass).label}</td></tr>`
      + '</tbody></table>';
  }

  private _renderForces(): void {
    const target = this._panelEl?.querySelector('#mp-forces-summary');
    const corridorTarget = this._panelEl?.querySelector('#mp-corridor-summary');
    if (corridorTarget) {
      if (this._corridors.length === 0) {
        corridorTarget.innerHTML = '<div class="mp-empty">No corridors yet. Run analysis to extract OCOKA corridors.</div>';
      } else {
        corridorTarget.innerHTML = '<table class="mp-table"><thead><tr><th>#</th><th>Length</th><th>Width</th><th>Brg</th><th>Score</th></tr></thead><tbody>'
          + this._corridors.slice(0, 6).map((c) =>
              `<tr><td>${c.rank}</td><td>${(c.lengthM / 1000).toFixed(1)} km</td><td>${Math.round(c.widthM)} m</td><td>${Math.round(c.bearingDeg)}°</td><td>${Math.round(c.composite)}</td></tr>`).join('')
          + '</tbody></table>';
      }
    }
    const roadTarget = this._panelEl?.querySelector('#mp-road-summary');
    if (roadTarget) roadTarget.innerHTML = this._roadSummaryHtml();
    if (!target) return;
    if (!this._view) { target.innerHTML = ''; return; }
    const forceLayer = GraphicsLayerManager.getInstance(this._view).getLayer(LAYER_NAMES.FORCE);
    if (!forceLayer || forceLayer.graphics.length === 0) {
      target.innerHTML = '<div class="mp-empty">No force symbols on the map. Place units to populate the Order of Battle.</div>';
      return;
    }
    const counts: Record<string, { fr: number; en: number; ne: number }> = {};
    const aoi = this._aoLayer.graphics.getItemAt(0)?.geometry as Polygon | null;
    forceLayer.graphics.forEach((g) => {
      const geom = g.geometry as any;
      const pt = geom?.type === 'point' ? geom : geom?.centroid ?? geom?.extent?.center;
      if (!pt) return;
      if (aoi) { try { if (!geometryEngine.contains(aoi, pt) && !geometryEngine.intersects(aoi, pt)) return; } catch { /* fall through */ } }
      const sidc = String(g.attributes?.SIDC ?? g.attributes?.sidc ?? '');
      // Canonical affiliation + echelon, matching the on-map symbol. The previous
      // sidc.charAt(3)/charAt(4) heuristics read the wrong digits: hostile units were
      // tallied as friendly and the rows were grouped by a symbol-set digit.
      const affiliation = classifyAffiliation(sidc);
      const echCode = getEchelonCode(g);
      const key = echCode === '00' ? 'Unspecified' : `Ech ${echCode}`;
      if (!counts[key]) counts[key] = { fr: 0, en: 0, ne: 0 };
      if (affiliation === 'friendly') counts[key].fr++;
      else if (affiliation === 'hostile') counts[key].en++;
      else counts[key].ne++; // neutral + unknown
    });
    const keys = Object.keys(counts).sort();
    if (keys.length === 0) {
      target.innerHTML = '<div class="mp-empty">No force symbols intersect the AOI.</div>';
      return;
    }
    target.innerHTML = '<table class="mp-table"><thead><tr><th>Echelon</th><th>Friendly</th><th>Enemy</th><th>Neutral</th></tr></thead><tbody>'
      + keys.map((k) => `<tr><td>${k}</td><td class="mp-fr">${counts[k].fr}</td><td class="mp-en">${counts[k].en}</td><td>${counts[k].ne}</td></tr>`).join('')
      + '</tbody></table>';
  }

  private _renderCoas(): void {
    const list = this._panelEl?.querySelector('#mp-coa-list');
    if (!list) return;
    if (!this._coaSnapshots.length) {
      list.innerHTML = '<div class="mp-empty">No saved COAs yet. Run analysis and click Save COA to capture a snapshot.</div>';
      return;
    }
    list.innerHTML = '<table class="mp-table"><thead><tr><th>COA</th><th>Mode</th><th>Unit</th><th>Threat</th><th>Top 3 (score)</th><th></th></tr></thead><tbody>'
      + this._coaSnapshots.map((c) =>
          `<tr><td>${c.label}</td><td>${c.mode}</td><td>${c.unit}</td><td>${Math.round(c.threatBearingDeg)}°</td><td>${
            c.topFeatures.slice(0, 3).map((f) => `${f.name} (${f.compositeScore})`).join('<br>')
          }</td><td><button data-mp-coa-del="${c.id}" title="Remove">×</button></td></tr>`).join('')
      + '</tbody></table>';
    list.querySelectorAll<HTMLButtonElement>('[data-mp-coa-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._coaSnapshots = this._coaSnapshots.filter((c) => String(c.id) !== btn.dataset.mpCoaDel);
        this._renderCoas();
        this._renderReport();
      });
    });
  }

  private _saveCoa(): void {
    if (!this._results.length) {
      this._setStatus('Run an analysis before saving a COA.', 'warn');
      return;
    }
    if (this._coaSnapshots.length >= 3) {
      this._setStatus('COA buffer is full (max 3). Remove one before saving another.', 'warn');
      return;
    }
    const mode = this._selectValue('mp-mode', 'defensive') as MissionMode;
    const unit = this._selectValue('mp-unit', 'infantry') as UnitType;
    const label = `COA ${String.fromCharCode(65 + this._coaSnapshots.length)}`;
    this._coaSnapshots.push({
      id: Date.now(),
      label,
      mode, unit,
      threatBearingDeg: this._currentThreatBearing(),
      capturedAt: new Date().toISOString(),
      topFeatures: this._results.slice(0, 3).map((f) => ({ ...f })),
      corridorsCount: this._corridors.length,
    });
    this._renderCoas();
    this._renderReport();
    this._setStatus(`Saved ${label} (${mode}, ${unit}).`, 'done');
    this._activateTab('coa');
  }

  // ── Auto-run ───────────────────────────────────────────────────────────────

  private _syncAutoRun(): void {
    this._detachAutoRun();
    if (!this._view || !this._checked('mp-auto-run', false)) return;
    this._viewWatchHandle = (this._view as any).watch('stationary', (stationary: boolean) => { if (stationary) this._scheduleAutoRun(); });
    this._setStatus('Auto-run enabled. Pan/zoom will rerun after the view settles.', 'ready');
  }

  private _detachAutoRun(): void {
    this._viewWatchHandle?.remove?.();
    this._viewWatchHandle = null;
    if (this._autoTimer != null) window.clearTimeout(this._autoTimer);
    this._autoTimer = null;
  }

  private _maybeAutoRun(): void {
    if (this._checked('mp-auto-run', false)) this._scheduleAutoRun();
  }

  private _scheduleAutoRun(): void {
    if (this._autoTimer != null) window.clearTimeout(this._autoTimer);
    this._autoTimer = window.setTimeout(() => { this._autoTimer = null; void this.runAnalysis(); }, 700);
  }

  // ── Status / progress ─────────────────────────────────────────────────────

  private _setStatus(text: string, tone: MpStatusTone): void {
    const status = this._el('mp-status');
    if (tone === 'done' || tone === 'ready') EngineLogger.success(ENGINE_NAME, text);
    else if (tone === 'warn') EngineLogger.error(ENGINE_NAME, text);
    else EngineLogger.nextStep(ENGINE_NAME, text);
    if (status) { status.textContent = text; status.className = `mp-status-msg ${tone}`; }
    const dot = this._el('mp-status-dot');
    const lbl = this._el('mp-status-lbl');
    const map: Record<MpStatusTone, [string, string]> = {
      ready: ['#1D9E75', 'Ready'], running: ['#EF9F27', 'Running'],
      warn: ['#DC3C30', 'Check'], pick: ['#378ADD', 'Pick'], done: ['#1D9E75', 'Done'],
    };
    const [color, label] = map[tone];
    if (dot) { dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}88`; }
    if (lbl) lbl.textContent = label;
  }

  private _setRunDisabled(disabled: boolean): void {
    const btn = this._el('mp-run') as HTMLButtonElement | null;
    if (btn) btn.disabled = disabled;
  }

  // ── Context menu provider (pin-from-map) ──────────────────────────────────

  private _registerCtxProvider(): void {
    if (this._ctxProvider) return;
    const provider = (graphic: Graphic): any[] => {
      const type = graphic?.attributes?.type ?? graphic?.attributes?.graphicType;
      // Only attach pin options for our own ranked feature graphics
      if (type !== 'mission_planner_feature') return [];
      return [
        {
          id: 'mp-pin-friendly',
          label: 'Pin as Friendly Observer',
          icon: '<span class="menu-icon-text">⊕</span>',
          action: (g: Graphic) => this.pinObserverFromGraphic(g, 'friendly'),
        },
        {
          id: 'mp-pin-enemy',
          label: 'Pin as Enemy Observer',
          icon: '<span class="menu-icon-text">⊗</span>',
          action: (g: Graphic) => this.pinObserverFromGraphic(g, 'enemy'),
        },
      ];
    };
    this._ctxProvider = provider;
    try {
      const cm = (window as any).symbolEngine?.contextMenuManager;
      cm?.addDynamicItemProvider?.(provider);
    } catch { /* best effort */ }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  private _toCsv(): string {
    const header = 'rank,type,name,mgrs,longitude,latitude,elevationM,prominenceM,viewshedPct,deadGroundPct,exposureToEnemyPct,defensibilityScore,corridorControlScore,ambushScore,marchTimeMin,compositeScore,recommendedUse';
    const rows = this._results.map((f) => [
      f.rank, f.type, `"${f.name}"`, `"${f.mgrs}"`,
      lonOf(f.point), latOf(f.point),
      f.elevationM, f.prominenceM,
      f.viewshedPct, f.deadGroundPct, f.exposureToEnemyPct,
      f.defensibilityScore, f.corridorControlScore, f.ambushScore,
      f.marchTimeMin.toFixed(1), f.compositeScore,
      `"${f.recommendedUse}"`,
    ].join(','));
    return [header, ...rows].join('\n');
  }

  private _toGeoJson(): string {
    return JSON.stringify({
      type: 'FeatureCollection',
      features: this._results.map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lonOf(f.point), latOf(f.point), f.elevationM] },
        properties: {
          rank: f.rank, type: f.type, name: f.name, mgrs: f.mgrs,
          elevationM: f.elevationM, prominenceM: f.prominenceM,
          viewshedPct: f.viewshedPct, deadGroundPct: f.deadGroundPct,
          exposureToEnemyPct: f.exposureToEnemyPct,
          defensibilityScore: f.defensibilityScore,
          corridorControlScore: f.corridorControlScore,
          ambushScore: f.ambushScore,
          marchTimeMin: Math.round(f.marchTimeMin * 10) / 10,
          compositeScore: f.compositeScore,
          recommendedUse: f.recommendedUse,
          cautions: f.cautions,
        },
      })),
    }, null, 2);
  }

  private _exportShapefile(): void {
    if (!this._results.length) { this._setStatus('No mission terrain results to export.', 'warn'); return; }
    const base = 'mission-planner-results';
    const { shp, shx } = this._buildPointShapefile();
    this._downloadBlob(`${base}.shp`, shp);
    this._downloadBlob(`${base}.shx`, shx);
    this._downloadBlob(`${base}.dbf`, this._buildDbf());
    this._downloadText(`${base}.prj`, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]', 'text/plain');
    this._setStatus('Shapefile parts downloaded: .shp, .shx, .dbf, .prj.', 'done');
  }

  private _buildPointShapefile(): { shp: Blob; shx: Blob } {
    const recordLengthBytes = 28;
    const shpBytes = 100 + this._results.length * recordLengthBytes;
    const shxBytes = 100 + this._results.length * 8;
    const shp = new ArrayBuffer(shpBytes);
    const shx = new ArrayBuffer(shxBytes);
    const shpView = new DataView(shp);
    const shxView = new DataView(shx);
    const bounds = this._shapeBounds();
    this._writeShapeHeader(shpView, shpBytes, bounds);
    this._writeShapeHeader(shxView, shxBytes, bounds);
    let shpOffset = 100;
    let shxOffset = 100;
    let contentOffsetWords = 50;
    this._results.forEach((f, i) => {
      shpView.setInt32(shpOffset, i + 1, false);
      shpView.setInt32(shpOffset + 4, 10, false);
      shpView.setInt32(shpOffset + 8, 1, true);
      shpView.setFloat64(shpOffset + 12, lonOf(f.point), true);
      shpView.setFloat64(shpOffset + 20, latOf(f.point), true);
      shxView.setInt32(shxOffset, contentOffsetWords, false);
      shxView.setInt32(shxOffset + 4, 10, false);
      shpOffset += recordLengthBytes;
      shxOffset += 8;
      contentOffsetWords += recordLengthBytes / 2;
    });
    return { shp: new Blob([shp], { type: 'application/octet-stream' }), shx: new Blob([shx], { type: 'application/octet-stream' }) };
  }

  private _writeShapeHeader(view: DataView, byteLength: number, bounds: { xmin: number; ymin: number; xmax: number; ymax: number }): void {
    view.setInt32(0, 9994, false);
    view.setInt32(24, byteLength / 2, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, 1, true);
    view.setFloat64(36, bounds.xmin, true);
    view.setFloat64(44, bounds.ymin, true);
    view.setFloat64(52, bounds.xmax, true);
    view.setFloat64(60, bounds.ymax, true);
  }

  private _shapeBounds(): { xmin: number; ymin: number; xmax: number; ymax: number } {
    return {
      xmin: Math.min(...this._results.map((f) => lonOf(f.point))),
      ymin: Math.min(...this._results.map((f) => latOf(f.point))),
      xmax: Math.max(...this._results.map((f) => lonOf(f.point))),
      ymax: Math.max(...this._results.map((f) => latOf(f.point))),
    };
  }

  private _buildDbf(): Blob {
    const fields = [
      { name: 'RANK',   type: 'N', len: 6, dec: 0 },
      { name: 'NAME',   type: 'C', len: 32, dec: 0 },
      { name: 'MGRS',   type: 'C', len: 22, dec: 0 },
      { name: 'SCORE',  type: 'N', len: 6, dec: 0 },
      { name: 'OBS_PCT', type: 'N', len: 6, dec: 0 },
      { name: 'DG_PCT', type: 'N', len: 6, dec: 0 },
      { name: 'EXP_PCT', type: 'N', len: 6, dec: 0 },
      { name: 'AMB',    type: 'N', len: 6, dec: 0 },
      { name: 'ELEV_M', type: 'N', len: 8, dec: 0 },
    ];
    const headerLength = 32 + fields.length * 32 + 1;
    const recordLength = 1 + fields.reduce((sum, f) => sum + f.len, 0);
    const buffer = new ArrayBuffer(headerLength + this._results.length * recordLength + 1);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const now = new Date();
    view.setUint8(0, 0x03);
    view.setUint8(1, now.getFullYear() - 1900);
    view.setUint8(2, now.getMonth() + 1);
    view.setUint8(3, now.getDate());
    view.setUint32(4, this._results.length, true);
    view.setUint16(8, headerLength, true);
    view.setUint16(10, recordLength, true);
    fields.forEach((field, i) => {
      const offset = 32 + i * 32;
      this._writeAscii(bytes, offset, field.name, 11);
      view.setUint8(offset + 11, field.type.charCodeAt(0));
      view.setUint8(offset + 16, field.len);
      view.setUint8(offset + 17, field.dec);
    });
    bytes[headerLength - 1] = 0x0d;
    this._results.forEach((f, i) => {
      let offset = headerLength + i * recordLength;
      bytes[offset++] = 0x20;
      const values = [
        String(f.rank),
        f.name,
        f.mgrs,
        String(f.compositeScore),
        String(f.viewshedPct),
        String(f.deadGroundPct),
        String(f.exposureToEnemyPct),
        String(f.ambushScore),
        String(f.elevationM),
      ];
      fields.forEach((field, fi) => {
        const raw = values[fi] ?? '';
        const text = field.type === 'N' ? raw.padStart(field.len, ' ') : raw.padEnd(field.len, ' ');
        this._writeAscii(bytes, offset, text.slice(0, field.len), field.len);
        offset += field.len;
      });
    });
    bytes[bytes.length - 1] = 0x1a;
    return new Blob([buffer], { type: 'application/octet-stream' });
  }

  private _writeAscii(bytes: Uint8Array, offset: number, text: string, length: number): void {
    for (let i = 0; i < length; i++) bytes[offset + i] = i < text.length ? text.charCodeAt(i) : 0x20;
  }

  private _downloadText(filename: string, content: string, type: string): void {
    this._downloadBlob(filename, new Blob([content], { type }));
  }

  private _downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Drag handling ─────────────────────────────────────────────────────────

  private _makeDraggable(): void {
    if (!this._panelEl) return;
    const handle = this._panelEl.querySelector('#mp-drag-handle') as HTMLElement | null;
    if (!handle) return;
    handle.onmousedown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this._isDragging = true;
      const rect = this._panelEl!.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    };
  }

  private _onDragMove = (e: MouseEvent): void => {
    if (!this._isDragging || !this._panelEl) return;
    this._panelEl.style.left = `${clamp(e.clientX - this._dragOffsetX, 8, window.innerWidth - 436)}px`;
    this._panelEl.style.top = `${clamp(e.clientY - this._dragOffsetY, 8, window.innerHeight - 120)}px`;
    this._panelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  // ── Input helpers ────────────────────────────────────────────────────────

  private _el(id: string): HTMLElement | null { return this._panelEl?.querySelector(`#${id}`) ?? null; }
  private _num(id: string, fallback: number): number {
    const el = this._el(id) as HTMLInputElement | null;
    const v = el ? Number(el.value) : fallback;
    return Number.isFinite(v) ? v : fallback;
  }
  private _checked(id: string, fallback: boolean): boolean {
    const el = this._el(id) as HTMLInputElement | null;
    return el ? el.checked : fallback;
  }
  private _selectValue(id: string, fallback: string): string {
    const el = this._el(id) as HTMLSelectElement | null;
    return el?.value || fallback;
  }
  private _setSelectValue(id: string, value: string): void {
    const el = this._el(id) as HTMLSelectElement | null;
    if (el) el.value = value;
  }

  // ── Styles ───────────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('mission-planner-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'mission-planner-engine-styles';
    style.textContent = `
      .mp-panel{--ms-bg:#141820;--ms-bg-header:rgba(26,32,48,.97);--ms-bg-input:rgba(0,0,0,.28);--ms-border:rgba(90,140,220,.25);--ms-divider:rgba(80,100,150,.18);--ms-text:#dce8f5;--ms-text-dim:rgba(175,200,230,.82);--ms-text-label:rgba(140,170,205,.85);--ms-shadow:0 8px 36px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.04);position:fixed;top:62px;right:18px;width:420px;max-height:calc(100vh - 84px);background:var(--ms-bg);border:1px solid var(--ms-border);border-radius:var(--ms-radius);color:var(--ms-text);font-family:var(--ms-font);font-size:var(--ms-fs);z-index:1100;box-shadow:var(--ms-shadow);display:none;overflow:hidden;user-select:none;animation:mpIn .18s cubic-bezier(.34,1.56,.64,1)}
      @keyframes mpIn{from{opacity:0;transform:scale(.96) translateY(-8px)}to{opacity:1;transform:scale(1) translateY(0)}}
      .mp-header{display:flex;align-items:center;gap:7px;padding:9px 10px 8px;border-bottom:1px solid var(--ms-divider);background:var(--ms-bg-header);cursor:grab}.mp-header:active{cursor:grabbing}
      .mp-header-icon{font-size:var(--ms-fs-xs);letter-spacing:.08em;color:#1D9E75;border:1px solid var(--ms-border);border-radius:3px;padding:2px 5px;font-weight:700}
      .mp-header-title{font-size:var(--ms-fs-sm);letter-spacing:.12em;text-transform:uppercase;color:#1D9E75;font-weight:700;flex:1}
      .mp-status-dot{width:9px;height:9px;border-radius:50%;background:#555}
      .mp-status-lbl{font-size:var(--ms-fs-xs);letter-spacing:.08em;text-transform:uppercase;color:var(--ms-text-dim);min-width:48px;font-weight:600}
      .mp-help-btn,.mp-min-btn,.mp-close-btn{background:none;border:1px solid transparent;color:var(--ms-text-dim);font-size:var(--ms-fs-sm);cursor:pointer;padding:0 4px}
      .mp-help-btn{width:21px;height:21px;border-color:var(--ms-border);border-radius:50%;color:#1D9E75;font-weight:700;font-size:var(--ms-fs)}
      .mp-min-btn,.mp-close-btn{border-color:var(--ms-border);border-radius:3px;padding:1px 6px;font-size:var(--ms-fs)}
      .mp-tabs{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--ms-divider)}
      .mp-tabs button{border:0;background:var(--ms-bg-input);color:var(--ms-text-dim);padding:6px 2px;font:inherit;font-size:var(--ms-fs-xs);letter-spacing:.05em;text-transform:uppercase;cursor:pointer}
      .mp-tabs button.active{background:var(--ms-bg-header);color:#1D9E75}
      .mp-body{max-height:calc(100vh - 152px);overflow-y:auto;padding:0 0 8px}
      .mp-status-msg{margin:8px 10px 2px;padding:7px 9px;border:1px solid var(--ms-divider);border-radius:4px;background:var(--ms-bg-input);font-size:var(--ms-fs);line-height:1.4;color:var(--ms-text-dim)}
      .mp-status-msg.running{color:#EF9F27}.mp-status-msg.warn{color:#DC3C30;border-color:#DC3C30}.mp-status-msg.pick{color:#378ADD;border-color:#378ADD}.mp-status-msg.done,.mp-status-msg.ready{color:#1D9E75}
      .mp-sec{font-size:var(--ms-fs);letter-spacing:.12em;text-transform:uppercase;color:#1D9E75;font-weight:700;padding:11px 14px 6px}
      .mp-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 10px;padding:0 12px 9px}
      .mp-field{display:flex;flex-direction:column;gap:4px}
      .mp-field span{font-size:var(--ms-fs-xs);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label);font-weight:600}
      .mp-field input,.mp-field select{background:var(--ms-bg-input);border:1px solid var(--ms-border);border-radius:4px;color:var(--ms-text);font-family:inherit;font-size:var(--ms-fs);padding:7px 9px;outline:none;box-sizing:border-box;width:100%}
      .mp-field input:focus,.mp-field select:focus{border-color:#1D9E75}
      .mp-field select option{background:var(--ms-bg)}
      .mp-btn-row{display:flex;gap:7px;padding:7px 12px 0}
      .mp-btn{flex:1;padding:8px 5px;font-family:inherit;font-size:var(--ms-fs-xs);letter-spacing:.06em;text-transform:uppercase;font-weight:600;cursor:pointer;border-radius:4px;border:1px solid var(--ms-border);background:var(--ms-bg-input);color:var(--ms-text-dim);transition:all .14s}
      .mp-btn:hover:not(:disabled){background:var(--ms-bg-header);color:var(--ms-text)}
      .mp-btn.primary{border-color:#1D9E75;color:#1D9E75;font-weight:700}
      .mp-btn.ok{border-color:#EF9F27;color:#EF9F27}
      .mp-btn:disabled{opacity:.35;cursor:not-allowed}
      .mp-toggle{display:flex;align-items:center;justify-content:space-between;padding:6px 14px}
      .mp-toggle input{accent-color:#1D9E75;width:15px;height:15px;cursor:pointer}
      .mp-toggle label{font-size:var(--ms-fs-xs);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label);font-weight:600}
      .mp-copy{padding:6px 14px;font-size:var(--ms-fs);color:var(--ms-text-dim);line-height:1.45}
      .mp-empty{padding:14px 12px;border:1px dashed var(--ms-divider);border-radius:4px;margin:8px 12px;color:var(--ms-text-dim);font-size:var(--ms-fs);text-align:center}
      .mp-table{border-collapse:collapse;font-size:var(--ms-fs-xs);margin:4px 12px 8px;width:calc(100% - 24px)}
      .mp-table th,.mp-table td{border:1px solid var(--ms-divider);padding:5px 7px;text-align:left;color:var(--ms-text)}
      .mp-table th{background:var(--ms-bg-input);color:var(--ms-text-label);text-transform:uppercase;letter-spacing:.05em;font-size:var(--ms-fs-xs);font-weight:600}
      .mp-table .mp-fr{color:#378ADD;font-weight:700}.mp-table .mp-en{color:#DC3C30;font-weight:700}
      .mp-observer-list{padding:0 12px}
      .mp-observer-row{display:grid;grid-template-columns:22px 1fr auto 22px;align-items:center;gap:7px;padding:6px 9px;margin-bottom:6px;border:1px solid var(--ms-divider);border-radius:4px;background:var(--ms-bg-input);font-size:var(--ms-fs-xs);cursor:pointer}
      .mp-observer-row[data-side="enemy"] .mp-obs-name{color:#DC3C30}
      .mp-observer-row[data-side="friendly"] .mp-obs-name{color:#378ADD}
      .mp-obs-mgrs{font-size:var(--ms-fs-xs);color:var(--ms-text-label);letter-spacing:.03em}
      .mp-obs-del{background:transparent;border:1px solid var(--ms-border);color:var(--ms-text-dim);border-radius:3px;cursor:pointer;font-size:var(--ms-fs);padding:0 5px}
      .mp-obs-del:hover{color:#DC3C30;border-color:#DC3C30}
      .mp-results{max-height:380px;overflow-y:auto;padding:0 12px}
      .mp-row{border:1px solid var(--ms-divider);border-radius:5px;background:var(--ms-bg-input);padding:9px 11px;margin-bottom:8px;cursor:default}
      .mp-row:hover{border-color:#1D9E75;background:var(--ms-bg-header)}
      .mp-row-header{display:flex;align-items:center;gap:9px;margin-bottom:7px}
      .mp-row-badge{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:4px;font-size:var(--ms-fs);font-weight:700;color:#fff;min-width:46px;letter-spacing:.03em}
      .mp-row-name{flex:1;font-size:var(--ms-fs-sm);color:var(--ms-text);font-weight:600;text-transform:capitalize}
      .mp-row-score{font-size:var(--ms-fs-sm);font-weight:700;color:#1D9E75;letter-spacing:.01em}
      .mp-row-btns{display:flex;gap:5px}
      .mp-row-btns button{padding:5px 10px;border:1px solid var(--ms-border);background:transparent;color:var(--ms-text-dim);border-radius:4px;font-size:var(--ms-fs-xs);cursor:pointer;font-weight:600}
      .mp-row-btns button:hover{color:#1D9E75;border-color:#1D9E75}
      .mp-row-bar-wrap{height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden;margin-bottom:8px}
      .mp-row-bar{height:100%;border-radius:2px;transition:width .2s}
      .mp-row-metrics{display:flex;gap:14px;flex-wrap:wrap;font-size:var(--ms-fs);color:var(--ms-text);align-items:center;font-weight:600}
      .mp-lbl{font-size:var(--ms-fs-xs);text-transform:uppercase;letter-spacing:.07em;color:var(--ms-text-label);margin-right:3px;font-weight:600}
      .mp-row-mgrs{font-size:var(--ms-fs-xs);color:var(--ms-text-label);margin-top:5px;letter-spacing:.03em}
      .mp-row-chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}
      .mp-chip{display:inline-flex;align-items:center;padding:2px 7px;border-radius:8px;font-size:var(--ms-fs-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--ms-border)}
      .mp-chip-info{color:#378ADD;background:rgba(55,138,221,.08);border-color:rgba(55,138,221,.4)}
      .mp-chip-warn{color:#EF9F27;background:rgba(239,159,39,.08);border-color:rgba(239,159,39,.45)}
      .mp-chip-danger{color:#DC3C30;background:rgba(220,60,48,.10);border-color:rgba(220,60,48,.5);font-weight:700}
      .mp-sparkline{display:inline-flex;align-items:center;margin-left:auto}
      .mp-sparkline svg{display:block}
      .mp-coa-list{padding:0 12px}
      .mp-forces{padding:0 12px}
      .mp-report-print h1{font-size:var(--ms-fs-sm);color:#1D9E75;margin:4px 0}
      .mp-report-print h2{font-size:var(--ms-fs);color:#EF9F27;margin:8px 0 4px}
      .mp-report-print table{width:100%;border-collapse:collapse;font-size:var(--ms-fs-xs);margin:4px 0}
      .mp-report-print table th,.mp-report-print table td{border:1px solid var(--ms-divider);padding:4px 6px;text-align:left}
      .mp-report-print table th{background:var(--ms-bg-input);color:var(--ms-text-label);text-transform:uppercase;font-size:var(--ms-fs-xs)}
      #mp-report{padding:0 12px 12px}
      .mp-help-popover{position:absolute;top:39px;left:8px;right:8px;z-index:1120;max-height:min(440px,calc(100vh - 132px));overflow-y:auto;background:var(--ms-bg);border:1px solid var(--ms-border);border-radius:4px;box-shadow:var(--ms-shadow)}
      .mp-help-popover[hidden]{display:none}
      .mp-help-head{display:flex;justify-content:space-between;gap:10px;padding:10px 11px 8px;border-bottom:1px solid var(--ms-divider);background:var(--ms-bg-header)}
      .mp-help-kicker{font-size:var(--ms-fs-xs);color:var(--ms-text-label);letter-spacing:.09em;text-transform:uppercase;font-weight:600}
      .mp-help-title{margin-top:2px;font-size:var(--ms-fs-sm);color:#1D9E75;font-weight:700}
      .mp-help-head button{width:20px;height:20px;border:1px solid var(--ms-border);border-radius:3px;background:var(--ms-bg-input);color:var(--ms-text-dim);cursor:pointer}
      .mp-help-body{padding:10px 11px 12px;font-size:var(--ms-fs);line-height:1.5;color:var(--ms-text-dim);user-select:text}
      .mp-help-body p{margin:0 0 9px}
      .mp-help-body ol{margin:0 0 9px;padding-left:18px}
      .mp-help-body li{margin-bottom:5px}
      .mp-help-body b{color:var(--ms-text)}
      @media(max-width:560px){.mp-panel{left:12px;right:12px;top:72px;width:auto}.mp-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }
}

export default MissionPlannerEngine;
