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
import DeadGroundMapper, { DeadGroundSummary } from '../Analysis/DeadGroundMapper';
import PosDefScorerEngine, { DefensibilitySummary } from '../Analysis/PositionDefesibilityScorer/PosDefScorerEngine';
import OpRankerEngine, { OpRankSummary } from '../Analysis/OpRanker/OpRankerEngine';
import OcokaEngine, { OcokaCorridor } from '../OCOKA/Ocoka';
import GraphicsLayerManager, { LAYER_NAMES } from '../../Managers/GraphicsLayerManager';
import EngineLogger from '../../Support/EngineLogger';

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'MissionPlannerEngine';
const EARTH_RADIUS_M = 6_371_008.8;

export type MissionMode = 'defensive' | 'offensive' | 'recon' | 'route' | 'ambush';
export type UnitType = 'infantry' | 'mechanized' | 'aviation';
export type ObserverSide = 'friendly' | 'enemy';
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

function distanceM(a: { longitude?: number; latitude?: number; x?: number; y?: number }, b: { longitude?: number; latitude?: number; x?: number; y?: number }): number {
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

function bearingDeg(from: { longitude?: number; latitude?: number; x?: number; y?: number }, to: { longitude?: number; latitude?: number; x?: number; y?: number }): number {
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
  private _hostileObsExtents: Extent[] = []; // bounding extents of enemy LOS regions for hit-test
  private _coaSnapshots: CoaSnapshot[] = [];
  private _customAoi: Polygon | Extent | null = null;
  private _bufferCenter: Point | null = null;
  private _sketch: SketchViewModel | null = null;
  private _bufferPickHandle: any = null;
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
    this._localPeaks.initialize(view);
    this._keyTerrain.initialize(view);
    this._deadGround.initialize(view);
    this._posDef.initialize(view);
    this._opRanker.initialize(view);
    this._ocoka.initialize(view);
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
    try {
      const mode = this._selectValue('mp-mode', 'defensive') as MissionMode;
      const unit = this._selectValue('mp-unit', 'infantry') as UnitType;
      const radiusM = this._num('mp-radius', 3500);
      const center = this._resolveCenter();
      const aoi = this._resolveAoi(radiusM);
      if (!aoi.geometry || !aoi.extent) {
        this._setStatus('Choose or draw a valid AOI first.', 'warn');
        return;
      }
      this._drawAoi(aoi.geometry);

      const unitSettings = UNIT_SETTINGS[unit];
      this._setStatus('Detecting peaks and key terrain forms…', 'running');
      const peaks = await this._localPeaks.runHeadless({ aoi: aoi.geometry as any, maxResults: 12, cellSizeM: 120, prominenceM: 15 });
      const keyFeatures = await this._keyTerrain.runHeadless({ center, extent: aoi.extent, radiusM, cellM: 120, maxFeatures: 14 });

      this._setStatus('Extracting mobility corridors (OCOKA)…', 'running');
      this._corridors = await this._ocoka.runHeadless({
        center, radiusM: Math.max(radiusM, 4500), cellM: 150,
        force: unitSettings.ocokaForce, slopeThresholdDeg: unitSettings.maxSlopeDeg,
      });
      this._drawCorridors(this._corridors);

      this._setStatus('Mapping hostile observation envelopes…', 'running');
      await this._buildHostileObservation(radiusM, unitSettings.maxSlopeDeg);

      const threatBrg = this._currentThreatBearing();
      const candidates = this._mergeCandidates(peaks, keyFeatures, threatBrg, unit);
      const observerSeed = this._activeObservers('friendly').map((o) => o.point);
      const topPeakObservers = candidates.slice(0, 3).map((c) => c.point);

      this._setStatus('Ranking OP candidates and computing defensibility…', 'running');
      const opRank = await this._opRanker.rankCandidates(
        [...observerSeed, ...topPeakObservers].slice(0, 8),
        { maxRangeM: radiusM, aoRadiusM: radiusM, cellM: 180, optimalCount: 3 },
      ).catch(() => null);

      const enriched: MissionTerrainFeature[] = [];
      for (const candidate of candidates.slice(0, 16)) {
        const [def, dead] = await Promise.all([
          this._posDef.scorePoint(candidate.point, {
            obsRadius: radiusM,
            maxSlopeDeg: unitSettings.maxSlopeDeg,
            threatBearingDeg: threatBrg,
          }).catch(() => null),
          this._deadGround.runHeadless({
            observer: candidate.point,
            radiusM: Math.min(radiusM, 3000),
            cellM: 160,
          }).catch(() => null),
        ]);
        enriched.push(await this._scoreCandidate(candidate, def, dead, opRank, mode, unit, threatBrg, aoi.extent));
      }
      // ambush mode amplifies ambush score in composite
      if (mode === 'ambush') {
        enriched.forEach((f) => { f.compositeScore = Math.round(0.6 * f.ambushScore + 0.4 * f.compositeScore); });
      }
      enriched.sort((a, b) => b.compositeScore - a.compositeScore);
      enriched.forEach((feature, index) => { feature.rank = index + 1; feature.id = index + 1; });
      this._results = enriched;

      this._setStatus('Drawing fires fans and withdrawal route…', 'running');
      this._drawResults();
      this._drawFiresFans(threatBrg);
      await this._drawWithdrawal(threatBrg, unitSettings.ocokaForce);
      this._renderResults();
      this._renderReport();
      this._renderForces();

      const exposed = this._results.filter((f) => f.exposureToEnemyPct > 25).length;
      const msg = `Complete · ${this._results.length} ranked${exposed ? ` · ${exposed} EXPOSED to enemy` : ''}.`;
      this._setStatus(msg, this._results.length ? 'done' : 'warn');
    } catch (error) {
      console.error('[MissionPlanner] Analysis failed', error);
      this._setStatus('Analysis failed. Try a smaller AOI or coarser terrain settings.', 'warn');
    } finally {
      this._running = false;
      this._setRunDisabled(false);
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

    // optional observer seeding
    if (options.observers?.length) {
      options.observers.forEach((o) => this._addObserver(o.side, o.point));
    }
    const threatBrg = options.threatBearingDeg ?? this._derivedThreatBearing();

    const peaks = await this._localPeaks.runHeadless({ aoi: aoiGeom as any, maxResults: 12, cellSizeM: 120, prominenceM: 15 });
    const keyFeatures = await this._keyTerrain.runHeadless({ center, extent: aoiExtent, radiusM, cellM: 120, maxFeatures: 14 });
    this._corridors = await this._ocoka.runHeadless({
      center, radiusM: Math.max(radiusM, 4500), cellM: 150,
      force: unitSettings.ocokaForce, slopeThresholdDeg: unitSettings.maxSlopeDeg,
    });
    await this._buildHostileObservation(radiusM, unitSettings.maxSlopeDeg);
    const candidates = this._mergeCandidates(peaks, keyFeatures, threatBrg, unit);
    const enriched: MissionTerrainFeature[] = [];
    for (const candidate of candidates.slice(0, options.maxResults ?? 16)) {
      const [def, dead] = await Promise.all([
        this._posDef.scorePoint(candidate.point, { obsRadius: radiusM, maxSlopeDeg: unitSettings.maxSlopeDeg, threatBearingDeg: threatBrg }).catch(() => null),
        this._deadGround.runHeadless({ observer: candidate.point, radiusM: Math.min(radiusM, 3000), cellM: 160 }).catch(() => null),
      ]);
      enriched.push(await this._scoreCandidate(candidate, def, dead, null, mode, unit, threatBrg, aoiExtent));
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

  private _mergeCandidates(peaks: LocalPeakResult[], keyFeatures: KeyTerrainFeature[], threatBrg: number, unit: UnitType): MissionTerrainFeature[] {
    const all: MissionTerrainFeature[] = [];
    const keyMaxElev = Math.max(1, ...keyFeatures.map((feature) => feature.elev));
    keyFeatures.forEach((feature, idx) => {
      const p = pointFromLngLat(feature.lon, feature.lat);
      all.push(this._blankFeature({
        id: idx + 1,
        type: feature.type,
        name: `${feature.type.replace(/_/g, ' ')} #${feature.rank ?? idx + 1}`,
        point: p,
        elevationM: Math.round(feature.elev),
        prominenceM: Math.round(feature.prom),
        elevationAdvantageM: Math.round(feature.elev - keyMaxElev + Math.max(0, feature.prom)),
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
    def: DefensibilitySummary | null,
    dead: DeadGroundSummary | null,
    opRank: OpRankSummary | null,
    mode: MissionMode,
    unit: UnitType,
    threatBrg: number,
    aoiExtent: Extent | null,
  ): Promise<MissionTerrainFeature> {
    const weights = MODE_WEIGHTS[mode];
    const terrainScore = clamp((candidate.elevationAdvantageM / 250) * 55 + (candidate.prominenceM / 120) * 45, 0, 100);
    const viewshedScore = clamp(candidate.viewshedPct, 0, 100);
    const defScore = def?.composite ?? candidate.defensibilityScore;
    const corridorScore = this._corridorInfluence(candidate.point);
    const deadPct = dead?.deadGroundPct ?? candidate.deadGroundPct;
    const concealmentScore = (mode === 'defensive')
      ? clamp(100 - Math.abs(deadPct - 35), 0, 100)
      : clamp(deadPct, 0, 100);
    const op = opRank?.candidates.find((item) => Math.abs(lonOf(item.point) - lonOf(candidate.point)) < 0.0001);
    const accessibilityScore = op?.optimal ? 80 : 55;
    const exposurePct = this._exposureToEnemy(candidate.point);
    const mobilityInfluenceScore = Math.round((corridorScore + accessibilityScore) / 2);

    const compositeScore = Math.round(
      terrainScore * weights.terrain
      + viewshedScore * weights.observation
      + defScore * weights.defensibility
      + corridorScore * weights.corridor
      + concealmentScore * weights.concealment
      + accessibilityScore * weights.accessibility
      - exposurePct * 0.20, // exposed positions are penalised
    );
    const ambushScore = Math.round(
      0.30 * corridorScore
      + 0.25 * clamp(100 - viewshedScore, 0, 100)
      + 0.20 * concealmentScore
      + 0.15 * defScore
      + 0.10 * clamp(100 - mobilityInfluenceScore, 0, 100),
    );

    const marchTimeMin = this._marchTimeMin(candidate.point, unit);
    const elevationProfile = await this._sampleSparkline(candidate.point, threatBrg);
    const cautions = this._buildCautions(deadPct, candidate.viewshedPct, defScore, exposurePct, candidate.point, aoiExtent, unit);

    return {
      ...candidate,
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

  private _corridorInfluence(point: Point): number {
    if (this._corridors.length === 0) return 0;
    const lon = lonOf(point);
    const lat = latOf(point);
    let best = 0;
    this._corridors.forEach((corridor) => {
      corridor.path.forEach((pathPoint) => {
        const d = Math.hypot((pathPoint.longitude - lon) * 85000, (pathPoint.latitude - lat) * 111320);
        best = Math.max(best, clamp(100 - d / 35, 0, corridor.composite));
      });
    });
    return best;
  }

  /** Fraction of nearby enemy LOS extents the candidate falls inside (0–100). */
  private _exposureToEnemy(point: Point): number {
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
      const sampler = await (this._view.map as any).ground.createElevationSampler(
        new Extent({
          xmin: lonOf(point) - 0.05, ymin: latOf(point) - 0.05,
          xmax: lonOf(point) + 0.05, ymax: latOf(point) + 0.05,
          spatialReference: WGS84,
        }), { noDataValue: 0 });
      const out: number[] = [];
      for (let i = 0; i < samples; i++) {
        const t = (i - samples / 2) * (spanM / samples);
        const p = destinationPt(lonOf(point), latOf(point), bearing, t);
        const z = sampler.queryElevation(new Point({ longitude: p.longitude, latitude: p.latitude, spatialReference: WGS84 }))?.z ?? 0;
        out.push(z);
      }
      return out;
    } catch { return []; }
  }

  private _marchTimeMin(point: Point, unit: UnitType): number {
    const speed = UNIT_SETTINGS[unit].defaultSpeedKmh;
    const friendlies = this._activeObservers('friendly');
    const ref = friendlies[0]?.point ?? this._resolveCenter();
    if (!ref) return 0;
    const km = distanceM(point, ref) / 1000;
    return (km / Math.max(1, speed)) * 60;
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
      const identity = sidc.charAt(3); // standard identity byte position (varies by scheme — heuristic)
      const friendly = identity === '3' || identity === '6' || identity === 'F'; // friendly / assumed friend
      if (!friendly) return;
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

  private async _drawWithdrawal(threatBrg: number, force: 'dismount' | 'wheeled' | 'tracked' | 'mixed'): Promise<void> {
    this._withdrawalLayer.removeAll();
    const rank1 = this._results[0];
    if (!rank1) return;
    try {
      const corridors = await this._ocoka.runHeadless({
        center: rank1.point,
        radiusM: 2000,
        cellM: 150,
        force,
        maxCorridors: 5,
      });
      // pick the corridor whose bearing is closest to OPPOSITE of threat (i.e., away from enemy)
      const safeBearing = (threatBrg + 180) % 360;
      const best = corridors.slice().sort((a, b) => {
        const dA = Math.abs(((a.bearingDeg - safeBearing + 540) % 360) - 180);
        const dB = Math.abs(((b.bearingDeg - safeBearing + 540) % 360) - 180);
        return dA - dB;
      })[0];
      if (!best) return;
      this._withdrawalLayer.add(new Graphic({
        geometry: {
          type: 'polyline',
          paths: [best.path.map((pt) => [pt.longitude, pt.latitude])],
          spatialReference: WGS84,
        } as any,
        symbol: new SimpleLineSymbol({ color: [80, 230, 120, 0.85], width: 3.4, style: 'short-dash' as any }),
        attributes: { missionPlanner: true, type: 'mission_planner_withdrawal', corridorId: best.id },
      }));
      // arrow at midpoint indicating direction
      const mid = best.path[Math.floor(best.path.length / 2)];
      if (mid) {
        this._withdrawalLayer.add(new Graphic({
          geometry: new Point({ longitude: mid.longitude, latitude: mid.latitude, spatialReference: WGS84 }),
          symbol: new TextSymbol({
            text: '⇨ WITHDRAW',
            color: [80, 230, 120, 1],
            haloColor: [0, 0, 0, 0.9],
            haloSize: 1.2,
            font: { size: 10, family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' } as any,
          }),
          attributes: { missionPlanner: true, type: 'mission_planner_withdrawal_label' },
        }));
      }
    } catch { /* withdrawal hint is best-effort */ }
  }

  private async _buildHostileObservation(radiusM: number, maxSlopeDeg: number): Promise<void> {
    this._hostileObsLayer.removeAll();
    this._hostileObsExtents = [];
    const enemies = this._activeObservers('enemy');
    if (enemies.length === 0) return;
    for (const enemy of enemies) {
      try {
        const summary = await this._deadGround.runHeadless({
          observer: enemy.point,
          radiusM: Math.min(radiusM, 3000),
          cellM: 220,
        });
        if (!summary?.extent) continue;
        this._hostileObsExtents.push(summary.extent);
        // visualise enemy LOS reach via geodesic buffer around enemy with reduced radius proportional to visible fraction
        const visibleFraction = clamp(1 - (summary.deadGroundPct / 100), 0, 1);
        const visR = radiusM * visibleFraction;
        if (visR > 50) {
          const buf = geometryEngine.geodesicBuffer(enemy.point, visR, 'meters');
          const polygon = (Array.isArray(buf) ? buf[0] : buf) as Polygon | null;
          if (polygon) {
            this._hostileObsLayer.add(new Graphic({
              geometry: polygon,
              symbol: new SimpleFillSymbol({
                color: [220, 60, 48, 0.10],
                outline: new SimpleLineSymbol({ color: [220, 60, 48, 0.55], width: 1, style: 'dot' as any }),
              }),
              attributes: { missionPlanner: true, type: 'mission_planner_hostile_obs', observerId: enemy.id, visibleFraction },
            }));
          }
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
            <li><b>Mobility</b> — OCOKA corridors feed the corridor-control and ambush scores.</li>
            <li><b>Results</b> — ranked terrain features. Score bars: green=safe primary, orange=top-3, red=EXPOSED to enemy observation. Chips flag dead ground, weak defensibility, supply blind, edge-of-AO.</li>
            <li><b>COA</b> — snapshot up to 3 named courses-of-action for side-by-side compare.</li>
            <li><b>Report</b> — print, CSV, GeoJSON, or Shapefile export of the ranked features.</li>
          </ol>
          <p>Composite score weighting changes by mode (defensive favours terrain + observation; ambush favours corridor + concealment). Exposure to enemy LOS subtracts from the composite.</p>
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
          </div>
          <div class="mp-btn-row">
            <button id="mp-draw-poly" class="mp-btn">Draw Polygon</button>
            <button id="mp-draw-box" class="mp-btn">Draw Box</button>
            <button id="mp-pick-buffer" class="mp-btn">Pick Buffer</button>
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
      const ident = sidc.charAt(3);
      const echelon = sidc.charAt(4) || '?';
      const key = `Ech ${echelon}`;
      if (!counts[key]) counts[key] = { fr: 0, en: 0, ne: 0 };
      if (ident === '3' || ident === '6' || ident === 'F') counts[key].fr++;
      else if (ident === '1' || ident === 'H' || ident === '4') counts[key].en++;
      else counts[key].ne++;
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
