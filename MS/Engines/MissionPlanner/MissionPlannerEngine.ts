import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
import Polygon from '@arcgis/core/geometry/Polygon';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import LocalPeaksEngine, { LocalPeakResult } from '../Analysis/Peaks/LocalPeaksEngine';
import KeyTerrainIdentificationEngine, { KeyTerrainFeature } from '../Analysis/KeyTerrain/KeyTerrainIdentificationEngine';
import DeadGroundMapper, { DeadGroundSummary } from '../Analysis/DeadGroundMapper';
import PosDefScorerEngine, { DefensibilitySummary } from '../Analysis/PositionDefesibilityScorer/PosDefScorerEngine';
import OpRankerEngine, { OpRankSummary } from '../Analysis/OpRanker/OpRankerEngine';
import OcokaEngine, { OcokaCorridor } from '../OCOKA/Ocoka';

type MissionMode = 'defensive' | 'offensive' | 'recon' | 'route';
type UnitType = 'infantry' | 'mechanized' | 'aviation';
type ObserverSide = 'friendly' | 'enemy';

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

export interface MissionTerrainFeature {
  rank: number;
  type: string;
  name: string;
  point: Point;
  elevationM: number;
  prominenceM: number;
  elevationAdvantageM: number;
  viewshedPct: number;
  deadGroundPct: number;
  defensibilityScore: number;
  mobilityInfluenceScore: number;
  corridorControlScore: number;
  compositeScore: number;
  recommendedUse: string;
  cautions: string[];
}

const WGS84 = { wkid: 4326 } as any;

const MODE_WEIGHTS: Record<MissionMode, MissionPlannerWeights> = {
  defensive: { terrain: 0.25, observation: 0.25, defensibility: 0.2, corridor: 0.15, concealment: 0.1, accessibility: 0.05 },
  offensive: { terrain: 0.18, observation: 0.2, defensibility: 0.1, corridor: 0.2, concealment: 0.25, accessibility: 0.07 },
  recon: { terrain: 0.18, observation: 0.32, defensibility: 0.15, corridor: 0.08, concealment: 0.2, accessibility: 0.07 },
  route: { terrain: 0.12, observation: 0.15, defensibility: 0.08, corridor: 0.32, concealment: 0.18, accessibility: 0.15 },
};

const UNIT_SETTINGS: Record<UnitType, { maxSlopeDeg: number; ocokaForce: 'dismount' | 'wheeled' | 'tracked' | 'mixed' }> = {
  infantry: { maxSlopeDeg: 35, ocokaForce: 'dismount' },
  mechanized: { maxSlopeDeg: 20, ocokaForce: 'tracked' },
  aviation: { maxSlopeDeg: 90, ocokaForce: 'mixed' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pointFromGraphic(graphic?: Graphic | null): Point | null {
  const geom = graphic?.geometry;
  if (!geom) return null;
  if (geom.type === 'point') return geom as Point;
  return ((geom as any).centroid ?? (geom as any).extent?.center) as Point | null;
}

function pointFromLngLat(longitude: number, latitude: number): Point {
  return new Point({ longitude, latitude, spatialReference: WGS84 });
}

export class MissionPlannerEngine {
  static readonly FEATURE_LAYER_ID = 'mission-planner-ranked-features';
  static readonly AO_LAYER_ID = 'mission-planner-ao';
  static readonly OBSERVER_LAYER_ID = 'mission-planner-observers';
  static readonly CORRIDOR_LAYER_ID = 'mission-planner-corridor-influence';
  static readonly LABEL_LAYER_ID = 'mission-planner-labels';
  static readonly SNAPSHOT_LAYER_ID = 'mission-planner-report-snapshot';

  private _view: MapView | SceneView | null = null;
  private _selectedGraphic: Graphic | null = null;
  private _panelEl: HTMLDivElement | null = null;
  private _featureLayer = new GraphicsLayer({ id: MissionPlannerEngine.FEATURE_LAYER_ID, title: 'Mission Planner - ranked features' });
  private _aoLayer = new GraphicsLayer({ id: MissionPlannerEngine.AO_LAYER_ID, title: 'Mission Planner - AO', elevationInfo: { mode: 'on-the-ground' } as any });
  private _observerLayer = new GraphicsLayer({ id: MissionPlannerEngine.OBSERVER_LAYER_ID, title: 'Mission Planner - observers' });
  private _corridorLayer = new GraphicsLayer({ id: MissionPlannerEngine.CORRIDOR_LAYER_ID, title: 'Mission Planner - corridor influence', elevationInfo: { mode: 'on-the-ground' } as any });
  private _labelLayer = new GraphicsLayer({ id: MissionPlannerEngine.LABEL_LAYER_ID, title: 'Mission Planner - labels' });
  private _snapshotLayer = new GraphicsLayer({ id: MissionPlannerEngine.SNAPSHOT_LAYER_ID, title: 'Mission Planner - report snapshot' });
  private _localPeaks = new LocalPeaksEngine();
  private _keyTerrain = new KeyTerrainIdentificationEngine();
  private _deadGround = new DeadGroundMapper();
  private _posDef = new PosDefScorerEngine();
  private _opRanker = new OpRankerEngine();
  private _ocoka = new OcokaEngine();
  private _observers: ObserverPoint[] = [];
  private _results: MissionTerrainFeature[] = [];
  private _corridors: OcokaCorridor[] = [];
  private _running = false;

  constructor() {
    this._injectStyles();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    const layers = [this._aoLayer, this._corridorLayer, this._featureLayer, this._observerLayer, this._labelLayer, this._snapshotLayer];
    layers.forEach((layer) => {
      if (!map.findLayerById(layer.id)) map.add(layer);
    });
    this._localPeaks.initialize(view);
    this._keyTerrain.initialize(view);
    this._deadGround.initialize(view);
    this._posDef.initialize(view);
    this._opRanker.initialize(view);
    this._ocoka.initialize(view);
  }

  onViewChanged(view: MapView | SceneView): void {
    this.initialize(view);
  }

  open(graphic?: Graphic, view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    if (!this._view) return;
    this._selectedGraphic = graphic ?? null;
    this._ensurePanel();
    this._panelEl!.style.display = 'block';
    const src = pointFromGraphic(graphic);
    if (src) {
      this._addObserver('friendly', new Point({ longitude: src.longitude ?? src.x, latitude: src.latitude ?? src.y, spatialReference: WGS84 }), 'Selected position');
      this._setStatus('Selected graphic loaded as a friendly observer.');
    } else {
      this._setStatus('Ready. AO will use selected graphic or current view extent.');
    }
    this._renderObservers();
    this._renderResults();
  }

  openWidget(view?: MapView | SceneView): void {
    this.open(undefined, view);
  }

  close(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
  }

  destroy(): void {
    this.close();
    this.clearResults();
    const map = this._view?.map as any;
    if (map) {
      [this._featureLayer, this._aoLayer, this._observerLayer, this._corridorLayer, this._labelLayer, this._snapshotLayer]
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
    this._setStatus('Running terrain, observation, and mobility analysis...');
    this.clearResults(false);

    try {
      const mode = this._selectValue('mp-mode', 'defensive') as MissionMode;
      const unit = this._selectValue('mp-unit', 'infantry') as UnitType;
      const radiusM = this._num('mp-radius', 3500);
      const center = this._resolveCenter();
      const extent = this._resolveExtent(center, radiusM);
      this._drawAoi(extent);

      const unitSettings = UNIT_SETTINGS[unit];
      const peaks = await this._localPeaks.runHeadless({ aoi: extent, maxResults: 12, cellSizeM: 120, prominenceM: 15 });
      const keyFeatures = await this._keyTerrain.runHeadless({ center, extent, radiusM, cellM: 120, maxFeatures: 14 });
      this._corridors = await this._ocoka.runHeadless({
        center,
        radiusM: Math.max(radiusM, 4500),
        cellM: 150,
        force: unitSettings.ocokaForce,
        slopeThresholdDeg: unitSettings.maxSlopeDeg,
      });
      this._drawCorridors(this._corridors);

      const candidates = this._mergeCandidates(peaks, keyFeatures);
      const observerSeed = this._activeObservers().map((observer) => observer.point);
      const topPeakObservers = candidates.slice(0, 3).map((candidate) => candidate.point);
      const opRank = await this._opRanker.rankCandidates([...observerSeed, ...topPeakObservers].slice(0, 8), {
        maxRangeM: radiusM,
        aoRadiusM: radiusM,
        cellM: 180,
        optimalCount: 3,
      }).catch(() => null);

      const enriched: MissionTerrainFeature[] = [];
      for (const candidate of candidates.slice(0, 16)) {
        const [def, dead] = await Promise.all([
          this._posDef.scorePoint(candidate.point, {
            obsRadius: radiusM,
            maxSlopeDeg: unitSettings.maxSlopeDeg,
          }).catch(() => null),
          this._deadGround.runHeadless({
            observer: candidate.point,
            radiusM: Math.min(radiusM, 3000),
            cellM: 160,
          }).catch(() => null),
        ]);
        enriched.push(this._scoreCandidate(candidate, def, dead, opRank, mode));
      }

      enriched.sort((a, b) => b.compositeScore - a.compositeScore);
      enriched.forEach((feature, index) => { feature.rank = index + 1; });
      this._results = enriched;
      this._drawResults();
      this._renderResults();
      this._renderReport();
      this._setStatus(`Complete. ${this._results.length} mission terrain features ranked.`);
    } catch (error) {
      console.error('[MissionPlanner] Analysis failed', error);
      this._setStatus('Analysis failed. Try a smaller AO or coarser terrain settings.');
    } finally {
      this._running = false;
      this._setRunDisabled(false);
    }
  }

  clearResults(updateUi = true): void {
    this._featureLayer.removeAll();
    this._aoLayer.removeAll();
    this._observerLayer.removeAll();
    this._corridorLayer.removeAll();
    this._labelLayer.removeAll();
    this._snapshotLayer.removeAll();
    this._results = [];
    this._corridors = [];
    if (updateUi) {
      this._renderResults();
      this._renderReport();
      this._setStatus('Results cleared.');
    }
  }

  generateReport(): string {
    const mode = this._selectValue('mp-mode', 'defensive');
    const unit = this._selectValue('mp-unit', 'infantry');
    const rows = this._results.map((feature) => `
      <tr>
        <td>${feature.rank}</td>
        <td>${feature.name}</td>
        <td>${feature.compositeScore}</td>
        <td>${feature.viewshedPct}%</td>
        <td>${feature.deadGroundPct}%</td>
        <td>${feature.recommendedUse}</td>
      </tr>`).join('');
    return `
      <section class="mp-report-print">
        <h1>Mission Planner Terrain Report</h1>
        <p><b>Mode:</b> ${mode} <b>Unit:</b> ${unit} <b>Features:</b> ${this._results.length}</p>
        <h2>Top Ranked Key Terrain</h2>
        <table>
          <thead><tr><th>Rank</th><th>Feature</th><th>Score</th><th>Viewshed</th><th>Dead Ground</th><th>Use</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No analysis results.</td></tr>'}</tbody>
        </table>
        <h2>Commander Notes</h2>
        <p>${this._results[0]?.recommendedUse ?? 'Run analysis to generate COA notes.'}</p>
      </section>`;
  }

  private _scoreCandidate(
    candidate: MissionTerrainFeature,
    def: DefensibilitySummary | null,
    dead: DeadGroundSummary | null,
    opRank: OpRankSummary | null,
    mode: MissionMode,
  ): MissionTerrainFeature {
    const weights = MODE_WEIGHTS[mode];
    const terrainScore = clamp((candidate.elevationAdvantageM / 250) * 55 + (candidate.prominenceM / 120) * 45, 0, 100);
    const viewshedScore = clamp(candidate.viewshedPct, 0, 100);
    const defScore = def?.composite ?? candidate.defensibilityScore;
    const corridorScore = this._corridorInfluence(candidate.point);
    const deadPct = dead?.deadGroundPct ?? candidate.deadGroundPct;
    const concealmentScore = mode === 'defensive' ? clamp(100 - Math.abs(deadPct - 35), 0, 100) : clamp(deadPct, 0, 100);
    const op = opRank?.candidates.find((item) => Math.abs((item.point.longitude ?? item.point.x) - (candidate.point.longitude ?? candidate.point.x)) < 0.0001);
    const accessibilityScore = op?.optimal ? 80 : 55;
    const compositeScore = Math.round(
      terrainScore * weights.terrain +
      viewshedScore * weights.observation +
      defScore * weights.defensibility +
      corridorScore * weights.corridor +
      concealmentScore * weights.concealment +
      accessibilityScore * weights.accessibility,
    );
    return {
      ...candidate,
      deadGroundPct: deadPct,
      defensibilityScore: defScore,
      corridorControlScore: corridorScore,
      mobilityInfluenceScore: Math.round((corridorScore + accessibilityScore) / 2),
      compositeScore,
      recommendedUse: this._recommendUse(mode, candidate.type, compositeScore, corridorScore),
      cautions: this._buildCautions(deadPct, candidate.viewshedPct, defScore),
    };
  }

  private _mergeCandidates(peaks: LocalPeakResult[], keyFeatures: KeyTerrainFeature[]): MissionTerrainFeature[] {
    const all: MissionTerrainFeature[] = [];
    const keyMaxElev = Math.max(1, ...keyFeatures.map((feature) => feature.elev));
    keyFeatures.forEach((feature) => {
      all.push({
        rank: 0,
        type: feature.type,
        name: `${feature.type.replace(/_/g, ' ')} ${feature.rank ?? all.length + 1}`,
        point: pointFromLngLat(feature.lon, feature.lat),
        elevationM: Math.round(feature.elev),
        prominenceM: Math.round(feature.prom),
        elevationAdvantageM: Math.round(feature.elev - keyMaxElev + Math.max(0, feature.prom)),
        viewshedPct: Math.round(feature.viewshedPct ?? 0),
        deadGroundPct: 0,
        defensibilityScore: 0,
        mobilityInfluenceScore: 0,
        corridorControlScore: 0,
        compositeScore: Math.round(feature.compositeScore ?? 0),
        recommendedUse: '',
        cautions: [],
      });
    });
    peaks.forEach((peak) => {
      all.push({
        rank: 0,
        type: peak.type === 'peaks' ? 'local_peak' : 'valley',
        name: `${peak.type === 'peaks' ? 'Local peak' : 'Valley'} ${peak.rank}`,
        point: pointFromLngLat(peak.longitude, peak.latitude),
        elevationM: Math.round(peak.elevation),
        prominenceM: Math.round(peak.prominence),
        elevationAdvantageM: Math.round(peak.elevation - peak.neighborhoodMean),
        viewshedPct: clamp(Math.round((peak.prominence / Math.max(1, peak.elevation - peak.neighborhoodMin)) * 100), 0, 100),
        deadGroundPct: 0,
        defensibilityScore: 0,
        mobilityInfluenceScore: 0,
        corridorControlScore: 0,
        compositeScore: 0,
        recommendedUse: '',
        cautions: [],
      });
    });
    const seen = new Set<string>();
    return all.filter((feature) => {
      const key = `${(feature.point.longitude ?? feature.point.x).toFixed(3)},${(feature.point.latitude ?? feature.point.y).toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private _corridorInfluence(point: Point): number {
    if (this._corridors.length === 0) return 0;
    const lon = point.longitude ?? point.x;
    const lat = point.latitude ?? point.y;
    let best = 0;
    this._corridors.forEach((corridor) => {
      corridor.path.forEach((pathPoint) => {
        const d = Math.hypot((pathPoint.longitude - lon) * 85000, (pathPoint.latitude - lat) * 111320);
        best = Math.max(best, clamp(100 - d / 35, 0, corridor.composite));
      });
    });
    return Math.round(best);
  }

  private _recommendUse(mode: MissionMode, type: string, score: number, corridorScore: number): string {
    if (mode === 'route') return corridorScore > 65 ? 'Control chokepoint and screen route movement' : 'Monitor as secondary movement influence';
    if (mode === 'offensive') return corridorScore > 55 ? 'Assault support or support-by-fire position' : 'Concealed approach checkpoint';
    if (mode === 'recon') return score > 70 ? 'Primary OP with survivability checks' : 'Alternate OP or relay point';
    if (type.includes('saddle')) return 'Blocking position controlling passage through high ground';
    return score > 70 ? 'Primary defensive position or overwatch anchor' : 'Secondary battle position';
  }

  private _buildCautions(deadPct: number, viewshedPct: number, defScore: number): string[] {
    const cautions: string[] = [];
    if (viewshedPct < 35) cautions.push('Limited observation');
    if (deadPct > 60) cautions.push('Enemy can exploit dead ground near position');
    if (defScore < 45) cautions.push('Weak defensibility score');
    return cautions;
  }

  private _resolveCenter(): Point {
    const selected = pointFromGraphic(this._selectedGraphic);
    if (selected) return new Point({ longitude: selected.longitude ?? selected.x, latitude: selected.latitude ?? selected.y, spatialReference: WGS84 });
    const center = this._view!.center;
    return new Point({ longitude: center.longitude ?? center.x, latitude: center.latitude ?? center.y, spatialReference: WGS84 });
  }

  private _resolveExtent(center: Point, radiusM: number): Extent {
    const selectedExtent = (this._selectedGraphic?.geometry as any)?.extent as Extent | null;
    if (selectedExtent) return selectedExtent;
    const viewExtent = this._view?.extent;
    if (viewExtent) return viewExtent;
    const lat = center.latitude ?? center.y;
    const lon = center.longitude ?? center.x;
    const pad = radiusM / 111320;
    const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    return new Extent({ xmin: lon - pad / cosLat, ymin: lat - pad, xmax: lon + pad / cosLat, ymax: lat + pad, spatialReference: WGS84 });
  }

  private _activeObservers(): ObserverPoint[] {
    return this._observers.filter((observer) => observer.active);
  }

  private _addObserver(side: ObserverSide, point: Point, name?: string): void {
    const id = `mp-observer-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    this._observers.push({ id, side, point, active: true, name: name ?? `${side} observer ${this._observers.length + 1}` });
  }

  private _drawAoi(extent: Extent): void {
    this._aoLayer.removeAll();
    const polygon = Polygon.fromExtent(extent);
    this._aoLayer.add(new Graphic({
      geometry: polygon,
      symbol: new SimpleFillSymbol({
        color: [55, 138, 221, 0.06],
        outline: new SimpleLineSymbol({ color: [55, 138, 221, 0.9], width: 1.5, style: 'dash' as any }),
      }),
      attributes: { missionPlanner: true, type: 'ao' },
    }));
  }

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
        attributes: { missionPlanner: true, corridorId: corridor.id, score: corridor.composite },
      }));
    });
  }

  private _drawResults(): void {
    this._featureLayer.removeAll();
    this._labelLayer.removeAll();
    this._results.forEach((feature) => {
      const size = 10 + clamp(feature.compositeScore / 8, 0, 14);
      this._featureLayer.add(new Graphic({
        geometry: feature.point,
        symbol: new SimpleMarkerSymbol({
          style: 'diamond',
          size,
          color: feature.rank <= 3 ? [220, 60, 48, 0.95] : [239, 159, 39, 0.9],
          outline: { color: [255, 255, 255, 0.95], width: 1 },
        }),
        attributes: { missionPlanner: true, rank: feature.rank, score: feature.compositeScore },
      }));
      this._labelLayer.add(new Graphic({
        geometry: feature.point,
        symbol: new TextSymbol({
          text: `#${feature.rank} ${feature.compositeScore}`,
          color: [255, 255, 255, 1],
          haloColor: [0, 0, 0, 0.9],
          haloSize: 1,
          yoffset: -18,
          font: { size: 10, family: 'Roboto', weight: 'bold' } as any,
        }),
      }));
    });
  }

  private _renderObservers(): void {
    this._observerLayer.removeAll();
    this._observers.forEach((observer) => {
      this._observerLayer.add(new Graphic({
        geometry: observer.point,
        symbol: new SimpleMarkerSymbol({
          style: observer.side === 'friendly' ? 'circle' : 'x',
          size: 11,
          color: observer.side === 'friendly' ? [55, 138, 221, observer.active ? 0.9 : 0.35] : [220, 60, 48, observer.active ? 0.9 : 0.35],
          outline: { color: [255, 255, 255, 0.85], width: 1 },
        }),
        attributes: { missionPlanner: true, observerId: observer.id, side: observer.side },
      }));
    });
    const list = this._panelEl?.querySelector('#mp-observer-list');
    if (!list) return;
    list.innerHTML = this._observers.map((observer) => `
      <label class="mp-observer-row">
        <input type="checkbox" data-mp-observer="${observer.id}" ${observer.active ? 'checked' : ''}>
        <span>${observer.name}</span><b>${observer.side}</b>
      </label>`).join('') || '<div class="mp-empty">No observers set.</div>';
    list.querySelectorAll<HTMLInputElement>('[data-mp-observer]').forEach((input) => {
      input.addEventListener('change', () => {
        const observer = this._observers.find((item) => item.id === input.dataset.mpObserver);
        if (observer) observer.active = input.checked;
        this._renderObservers();
      });
    });
  }

  private _renderResults(): void {
    const list = this._panelEl?.querySelector('#mp-results-list');
    if (!list) return;
    list.innerHTML = this._results.map((feature) => `
      <button class="mp-result-row" data-mp-rank="${feature.rank}">
        <span>#${feature.rank}</span>
        <b>${feature.name}</b>
        <em>${feature.compositeScore}</em>
        <small>OBS ${feature.viewshedPct}% DEF ${feature.defensibilityScore} DG ${feature.deadGroundPct}%</small>
      </button>`).join('') || '<div class="mp-empty">Run analysis to rank mission terrain.</div>';
    list.querySelectorAll<HTMLButtonElement>('[data-mp-rank]').forEach((button) => {
      button.addEventListener('click', () => {
        const feature = this._results.find((item) => String(item.rank) === button.dataset.mpRank);
        if (feature) void this._view?.goTo({ target: feature.point, zoom: 14, tilt: this._view.type === '3d' ? 55 : undefined } as any);
      });
    });
  }

  private _renderReport(): void {
    const report = this._panelEl?.querySelector('#mp-report');
    if (report) report.innerHTML = this.generateReport();
  }

  private _ensurePanel(): void {
    if (this._panelEl) return;
    const panel = document.createElement('div');
    panel.className = 'mp-panel';
    panel.innerHTML = `
      <div class="mp-head">
        <div><b>Mission Planner Dashboard</b><span id="mp-status">Ready</span></div>
        <button id="mp-close" title="Close">x</button>
      </div>
      <div class="mp-tabs">
        <button data-tab="mission" class="active">Mission</button>
        <button data-tab="terrain">Terrain</button>
        <button data-tab="observation">Observation</button>
        <button data-tab="mobility">Mobility</button>
        <button data-tab="results">Results</button>
        <button data-tab="report">Report</button>
      </div>
      <div class="mp-body">
        <section data-panel="mission">
          <label>Mode<select id="mp-mode"><option value="defensive">Defensive</option><option value="offensive">Offensive</option><option value="recon">Recon</option><option value="route">Route Planning</option></select></label>
          <label>Unit<select id="mp-unit"><option value="infantry">Infantry</option><option value="mechanized">Mechanized</option><option value="aviation">Aviation</option></select></label>
          <label>AO Radius (m)<input id="mp-radius" type="number" value="3500" min="500" step="250"></label>
          <div class="mp-actions"><button id="mp-run">Run Analysis</button><button id="mp-clear">Clear</button></div>
        </section>
        <section data-panel="terrain" hidden><div class="mp-copy">Peaks, ridges, saddles, spurs, and dominant ground are detected from existing terrain engines.</div></section>
        <section data-panel="observation" hidden>
          <div class="mp-actions"><button id="mp-add-friendly">Add Friendly From View</button><button id="mp-add-enemy">Add Enemy From View</button></div>
          <div id="mp-observer-list"></div>
        </section>
        <section data-panel="mobility" hidden><div class="mp-copy">OCOKA corridors and chokepoints feed the corridor control score.</div></section>
        <section data-panel="results" hidden><div id="mp-results-list"></div></section>
        <section data-panel="report" hidden><div class="mp-actions"><button id="mp-print">Print</button><button id="mp-csv">CSV</button><button id="mp-geojson">GeoJSON</button></div><div id="mp-report"></div></section>
      </div>`;
    document.body.appendChild(panel);
    this._panelEl = panel;
    panel.querySelector('#mp-close')?.addEventListener('click', () => this.close());
    panel.querySelector('#mp-run')?.addEventListener('click', () => void this.runAnalysis());
    panel.querySelector('#mp-clear')?.addEventListener('click', () => this.clearResults());
    panel.querySelector('#mp-print')?.addEventListener('click', () => window.print());
    panel.querySelector('#mp-csv')?.addEventListener('click', () => this._download('mission-planner-results.csv', this._toCsv(), 'text/csv'));
    panel.querySelector('#mp-geojson')?.addEventListener('click', () => this._download('mission-planner-results.geojson', this._toGeoJson(), 'application/geo+json'));
    panel.querySelector('#mp-add-friendly')?.addEventListener('click', () => {
      this._addObserver('friendly', this._resolveCenter());
      this._renderObservers();
    });
    panel.querySelector('#mp-add-enemy')?.addEventListener('click', () => {
      this._addObserver('enemy', this._resolveCenter());
      this._renderObservers();
    });
    panel.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => this._activateTab(button.dataset.tab!));
    });
  }

  private _activateTab(tab: string): void {
    this._panelEl?.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    this._panelEl?.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
  }

  private _setStatus(text: string): void {
    const el = this._panelEl?.querySelector('#mp-status');
    if (el) el.textContent = text;
  }

  private _setRunDisabled(disabled: boolean): void {
    const button = this._panelEl?.querySelector<HTMLButtonElement>('#mp-run');
    if (button) button.disabled = disabled;
  }

  private _num(id: string, fallback: number): number {
    const value = Number((this._panelEl?.querySelector(`#${id}`) as HTMLInputElement | null)?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  private _selectValue(id: string, fallback: string): string {
    return (this._panelEl?.querySelector(`#${id}`) as HTMLSelectElement | null)?.value ?? fallback;
  }

  private _toCsv(): string {
    const header = 'rank,type,name,longitude,latitude,elevationM,prominenceM,viewshedPct,deadGroundPct,defensibilityScore,corridorControlScore,compositeScore,recommendedUse';
    const rows = this._results.map((feature) => [
      feature.rank,
      feature.type,
      `"${feature.name}"`,
      feature.point.longitude ?? feature.point.x,
      feature.point.latitude ?? feature.point.y,
      feature.elevationM,
      feature.prominenceM,
      feature.viewshedPct,
      feature.deadGroundPct,
      feature.defensibilityScore,
      feature.corridorControlScore,
      feature.compositeScore,
      `"${feature.recommendedUse}"`,
    ].join(','));
    return [header, ...rows].join('\n');
  }

  private _toGeoJson(): string {
    return JSON.stringify({
      type: 'FeatureCollection',
      features: this._results.map((feature) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [feature.point.longitude ?? feature.point.x, feature.point.latitude ?? feature.point.y] },
        properties: { ...feature, point: undefined },
      })),
    }, null, 2);
  }

  private _download(filename: string, text: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private _injectStyles(): void {
    if (document.getElementById('mission-planner-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'mission-planner-engine-styles';
    style.textContent = `
      .mp-panel{position:fixed;right:18px;top:72px;width:390px;max-height:calc(100vh - 96px);display:none;z-index:1120;background:var(--ms-bg,#15191f);border:1px solid var(--ms-border,#303844);box-shadow:var(--ms-shadow,0 10px 32px #0008);color:var(--ms-text,#eef3f8);font-family:var(--ms-font,Arial);font-size:12px;overflow:hidden}
      .mp-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--ms-bg-header,#202732);border-bottom:1px solid var(--ms-divider,#303844)}
      .mp-head b{display:block;color:#ef9f27;text-transform:uppercase;letter-spacing:.08em}.mp-head span{display:block;margin-top:3px;color:var(--ms-text-dim,#aab3bf);font-size:11px}.mp-head button{background:transparent;border:1px solid var(--ms-border,#303844);color:var(--ms-text-dim,#aab3bf);cursor:pointer}
      .mp-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--ms-divider,#303844)}.mp-tabs button{border:0;background:var(--ms-bg-input,#11161d);color:var(--ms-text-dim,#aab3bf);padding:7px 4px;font:inherit;cursor:pointer}.mp-tabs button.active{background:#263141;color:#fff}
      .mp-body{padding:10px;max-height:calc(100vh - 190px);overflow:auto}.mp-body section label{display:block;margin-bottom:8px;color:var(--ms-text-label,#c8d0db);text-transform:uppercase;letter-spacing:.06em;font-size:10px}
      .mp-body input,.mp-body select{width:100%;box-sizing:border-box;margin-top:4px;background:var(--ms-bg-input,#11161d);border:1px solid var(--ms-border,#303844);color:var(--ms-text,#eef3f8);padding:6px;font:inherit}
      .mp-actions{display:flex;gap:7px;margin:8px 0}.mp-actions button,#mp-run{flex:1;border:1px solid var(--ms-border,#303844);background:var(--ms-bg-input,#11161d);color:var(--ms-text,#eef3f8);padding:7px;font:inherit;cursor:pointer}#mp-run{border-color:#ef9f27;color:#ef9f27}.mp-actions button:disabled{opacity:.45;cursor:wait}
      .mp-empty,.mp-copy{border:1px dashed var(--ms-divider,#303844);padding:12px;color:var(--ms-text-dim,#aab3bf);line-height:1.4}.mp-result-row{width:100%;display:grid;grid-template-columns:38px 1fr 42px;gap:6px;text-align:left;margin-bottom:6px;padding:7px;border:1px solid var(--ms-divider,#303844);background:var(--ms-bg-input,#11161d);color:var(--ms-text,#eef3f8);cursor:pointer}.mp-result-row span{color:#ef9f27}.mp-result-row em{font-style:normal;text-align:right;color:#1d9e75}.mp-result-row small{grid-column:2/4;color:var(--ms-text-dim,#aab3bf)}
      .mp-observer-row{display:grid!important;grid-template-columns:22px 1fr 60px;align-items:center;border:1px solid var(--ms-divider,#303844);padding:6px;margin-bottom:5px;text-transform:none!important;letter-spacing:0!important;font-size:12px!important}.mp-observer-row b{text-align:right;color:#ef9f27;font-size:10px;text-transform:uppercase}
      .mp-report-print table{width:100%;border-collapse:collapse}.mp-report-print th,.mp-report-print td{border:1px solid var(--ms-divider,#303844);padding:5px;text-align:left}.mp-report-print h1{font-size:18px}.mp-report-print h2{font-size:13px;color:#ef9f27}
      @media(max-width:620px){.mp-panel{left:10px;right:10px;width:auto;top:64px}}
    `;
    document.head.appendChild(style);
  }
}

export default MissionPlannerEngine;
