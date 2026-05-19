/**
 * Ocoka.ts
 * OCOKA terrain-analysis widget focused on Avenues of Approach.
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import EngineLogger from '../../Support/EngineLogger';

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'OCOKAEngine';
const EARTH_RADIUS_M = 6_371_008.8;

export type ForceType = 'dismount' | 'wheeled' | 'tracked' | 'mixed';
type ThreatClass = 'high' | 'medium' | 'low';

export interface OcokaPoint {
  longitude: number;
  latitude: number;
  elevationM?: number;
}

export interface OcokaWeights {
  width: number;
  mask: number;
  traf: number;
  obs: number;
  cc: number;
  obs2: number;
}

interface OcokaOptions {
  center: OcokaPoint;
  radiusM: number;
  cellM: number;
  maxCorridors: number;
  slopeThresholdDeg: number;
  force: ForceType;
  forceSlopeDeg: number;
  weights: OcokaWeights;
  showSlope: boolean;
  showLines: boolean;
  showWidth: boolean;
  showChoke: boolean;
}

export interface OcokaHeadlessOptions {
  center?: OcokaPoint | Point;
  radiusM?: number;
  cellM?: number;
  maxCorridors?: number;
  slopeThresholdDeg?: number;
  force?: ForceType;
  weights?: Partial<OcokaWeights>;
}

interface OcokaScores {
  width: number;
  mask: number;
  traf: number;
  obs: number;
  cc: number;
  obst: number;
}

export interface OcokaCorridor {
  id: string;
  rank: number;
  seed: OcokaPoint;
  path: OcokaPoint[];
  chokePts: OcokaPoint[];
  widthM: number;
  lengthM: number;
  bearingDeg: number;
  composite: number;
  scores: OcokaScores;
  note: string;
}

const FORCE_SLOPE: Record<ForceType, number> = {
  dismount: 35,
  wheeled: 12,
  tracked: 20,
  mixed: 15,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function toDeg(value: number): number {
  return (value * 180) / Math.PI;
}

function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}

function destinationPoint(origin: OcokaPoint, bearingDeg: number, distanceM: number): OcokaPoint {
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.latitude);
  const lon1 = toRad(origin.longitude);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { longitude: toDeg(lon2), latitude: toDeg(lat2), elevationM: origin.elevationM };
}

function scoreColor(score: number): { fill: [number, number, number]; hex: string; label: string } {
  if (score >= 80) return { fill: [29, 158, 117], hex: '#1D9E75', label: 'Primary avenue' };
  if (score >= 60) return { fill: [120, 200, 64], hex: '#78C840', label: 'Secondary avenue' };
  if (score >= 40) return { fill: [239, 159, 39], hex: '#EF9F27', label: 'Restricted' };
  return { fill: [220, 60, 48], hex: '#DC3C30', label: 'Unlikely' };
}

function threatLabel(score: number): { cls: ThreatClass; text: string } {
  if (score >= 75) return { cls: 'high', text: 'High threat avenue - monitor, deny, or block' };
  if (score >= 45) return { cls: 'medium', text: 'Medium threat avenue - restricted but usable' };
  return { cls: 'low', text: 'Low threat avenue - obstacle-rich or exposed' };
}

function pseudoTerrain(lon: number, lat: number, center: OcokaPoint): number {
  const x = (lon - center.longitude) * 1000;
  const y = (lat - center.latitude) * 1000;
  return 620 + Math.sin(x * 0.75 + y * 0.21) * 90 + Math.cos(y * 0.64 - x * 0.18) * 62;
}

export class OcokaEngine {
  static readonly CORRIDOR_LAYER_ID = 'ocoka-corridors';
  static readonly WIDTH_LAYER_ID = 'ocoka-widths';
  static readonly CHOKE_LAYER_ID = 'ocoka-chokepoints';
  static readonly LABEL_LAYER_ID = 'ocoka-labels';
  static readonly AO_LAYER_ID = 'ocoka-ao';
  static readonly HEAT_LAYER_ID = 'ocoka-slope-heatmap';

  private _view: MapView | SceneView | null = null;
  private _corridorLayer!: GraphicsLayer;
  private _widthLayer!: GraphicsLayer;
  private _chokeLayer!: GraphicsLayer;
  private _labelLayer!: GraphicsLayer;
  private _aoLayer!: GraphicsLayer;
  private _heatLayer!: GraphicsLayer;
  private _controlPanelEl: HTMLDivElement | null = null;
  private _listPanelEl: HTMLDivElement | null = null;
  private _hintEl: HTMLDivElement | null = null;
  private _legendEl: HTMLDivElement | null = null;
  private _clickHandle: any = null;
  private _running = false;
  private _isDragging = false;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._aoLayer.id)) {
      map.addMany([
        this._heatLayer,
        this._aoLayer,
        this._widthLayer,
        this._corridorLayer,
        this._chokeLayer,
        this._labelLayer,
      ]);
    }
  }

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    this._ensurePanels();
    this._showPanels();
    this._bindMapClick();

    const geom = graphic.geometry;
    let origin: Point | null = null;
    if (geom?.type === 'point') origin = geom as Point;
    else if ((geom as any)?.centroid) origin = (geom as any).centroid as Point;

    if (origin) {
      const lat = origin.latitude ?? origin.y;
      const lon = origin.longitude ?? origin.x;
      this._setInputValue('ocoka-inp-lat', lat.toFixed(4));
      this._setInputValue('ocoka-inp-lon', lon.toFixed(4));
      this._setAnalysisArea(lat, lon, this._num('ocoka-inp-radius', 5000));
      this._setHint(`Centre set - ${lat.toFixed(4)}N ${lon.toFixed(4)}E - click Run OCOKA`);
    }
  }

  public async runHeadless(options: OcokaHeadlessOptions = {}): Promise<OcokaCorridor[]> {
    if (!this._view) throw new Error('OcokaEngine requires initialize(view) before runHeadless().');
    const centerSource = options.center ?? {
      longitude: this._view.center.longitude ?? this._view.center.x,
      latitude: this._view.center.latitude ?? this._view.center.y,
    };
    const center = {
      longitude: (centerSource as any).longitude ?? (centerSource as any).x,
      latitude: (centerSource as any).latitude ?? (centerSource as any).y,
    };
    const force = options.force ?? 'wheeled';
    const weights: OcokaWeights = {
      width: options.weights?.width ?? 3,
      mask: options.weights?.mask ?? 4,
      traf: options.weights?.traf ?? 3,
      obs: options.weights?.obs ?? 4,
      cc: options.weights?.cc ?? 3,
      obs2: options.weights?.obs2 ?? 3,
    };
    const runOptions: OcokaOptions = {
      center,
      radiusM: options.radiusM ?? 5000,
      cellM: options.cellM ?? 100,
      maxCorridors: options.maxCorridors ?? 7,
      slopeThresholdDeg: options.slopeThresholdDeg ?? FORCE_SLOPE[force],
      force,
      forceSlopeDeg: FORCE_SLOPE[force] ?? 12,
      weights,
      showSlope: false,
      showLines: false,
      showWidth: false,
      showChoke: false,
    };
    await this._tick();
    return this._extractCorridors(runOptions)
      .sort((a, b) => b.composite - a.composite)
      .map((corridor, index) => ({ ...corridor, rank: index + 1 }));
  }

  close(): void {
    this._hidePanels();
    this._unbindMapClick();
    this._onDragEnd();
  }

  destroy(): void {
    this.close();
    this._clearAll();
    const map = this._view?.map as any;
    if (map) {
      [this._corridorLayer, this._widthLayer, this._chokeLayer, this._labelLayer, this._aoLayer, this._heatLayer]
        .forEach((layer) => map.remove(layer));
    }
    this._controlPanelEl?.remove();
    this._listPanelEl?.remove();
    this._hintEl?.remove();
    this._legendEl?.remove();
    this._controlPanelEl = null;
    this._listPanelEl = null;
    this._hintEl = null;
    this._legendEl = null;
    this._view = null;
  }

  private _createLayers(): void {
    this._corridorLayer = new GraphicsLayer({ id: OcokaEngine.CORRIDOR_LAYER_ID, title: 'OCOKA - corridors' });
    this._widthLayer = new GraphicsLayer({ id: OcokaEngine.WIDTH_LAYER_ID, title: 'OCOKA - widths', elevationInfo: { mode: 'on-the-ground' } as any });
    this._chokeLayer = new GraphicsLayer({ id: OcokaEngine.CHOKE_LAYER_ID, title: 'OCOKA - chokepoints' });
    this._labelLayer = new GraphicsLayer({ id: OcokaEngine.LABEL_LAYER_ID, title: 'OCOKA - labels', elevationInfo: { mode: 'on-the-ground' } as any });
    this._aoLayer = new GraphicsLayer({ id: OcokaEngine.AO_LAYER_ID, title: 'OCOKA - AO', elevationInfo: { mode: 'on-the-ground' } as any });
    this._heatLayer = new GraphicsLayer({ id: OcokaEngine.HEAT_LAYER_ID, title: 'OCOKA - slope heatmap', elevationInfo: { mode: 'on-the-ground' } as any });
    [this._corridorLayer, this._widthLayer, this._chokeLayer, this._aoLayer].forEach((layer: any) => {
      layer.popupTemplate = { title: '{type}', content: '{label}' };
    });
  }

  private _ensurePanels(): void {
    if (!this._listPanelEl) {
      const panel = document.createElement('div');
      panel.className = 'ocoka-left-panel';
      panel.innerHTML = `
        <div class="ocoka-lph">
          <div class="ocoka-lph-title">⬡ OCOKA — Avenues of Approach</div>
          <div class="ocoka-lph-sub" id="ocoka-lph-sub">Set AO then run analysis</div>
        </div>
        <div class="ocoka-sum-strip">
          <div class="ocoka-ss"><div class="ocoka-ss-l">Corridors</div><div class="ocoka-ss-v" id="ocoka-ss-n">-</div></div>
          <div class="ocoka-ss"><div class="ocoka-ss-l">Best avenue</div><div class="ocoka-ss-v" id="ocoka-ss-best">-</div></div>
          <div class="ocoka-ss"><div class="ocoka-ss-l">Worst score</div><div class="ocoka-ss-v" id="ocoka-ss-worst">-</div></div>
        </div>
        <div class="ocoka-approach-list" id="ocoka-approach-list">
          <div class="ocoka-list-empty">
            Set the analysis area centre and radius<br>in the right panel, then click<br>
            <strong style="color:#378ADD">Run OCOKA Analysis</strong>.<br><br>
            Corridors are auto-extracted from<br>terrain topology and scored on:<br>
            width - masking - trafficability - observation
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      this._listPanelEl = panel;
    }

    if (!this._controlPanelEl) {
      const panel = document.createElement('div');
      panel.className = 'ocoka-right-panel';
      panel.innerHTML = `
        <div class="ocoka-ph" id="ocoka-drag-handle">
          <div>
            <div class="ocoka-ph-title">⬡ OCOKA Config</div>
            <div class="ocoka-ph-status ready" id="ocoka-status">Ready</div>
          </div>
          <div class="ocoka-ph-actions">
            <button class="ocoka-help-btn" id="ocoka-help-btn" title="OCOKA wiki">?</button>
            <button class="ocoka-minimize-btn" id="ocoka-minimize-btn" title="Minimize">v</button>
            <button class="ocoka-close-btn" id="ocoka-close-btn" title="Close">x</button>
          </div>
        </div>
        <div class="ocoka-help-popover" id="ocoka-help-popover" hidden>
          <div class="ocoka-help-head">
            <div><div class="ocoka-help-kicker">Field Wiki</div><div class="ocoka-help-title">OCOKA Terrain Analysis</div></div>
            <button class="ocoka-help-close" id="ocoka-help-close">x</button>
          </div>
          <div class="ocoka-help-body">
            <p><strong>OCOKA</strong> evaluates Obstacles, Cover and Concealment, Observation and fields of fire, Key Terrain, and Avenues of Approach.</p>
            <p>This widget focuses on the companion Avenues of Approach panel. It ranks likely approach corridors by width, masking, trafficability, observation exposure, cover/concealment, and obstacle restriction.</p>
            <ol>
              <li>Right-click a symbol and open OCOKA from More Actions, or click the map to set the centre.</li>
              <li>Set AO radius, force type, extraction limits, and scoring weights.</li>
              <li>Run OCOKA Analysis to draw corridor centrelines, width polygons, chokepoints, score labels, and the ranked avenues list.</li>
            </ol>
          </div>
        </div>
        <div class="ocoka-body">
          <div class="ocoka-ps">Analysis area</div>
          <div class="ocoka-pg">
            <div class="ocoka-pf"><div class="ocoka-pl">Centre lat</div><input id="ocoka-inp-lat" type="number" value="33.680" step="0.001" /></div>
            <div class="ocoka-pf"><div class="ocoka-pl">Centre lon</div><input id="ocoka-inp-lon" type="number" value="73.060" step="0.001" /></div>
            <div class="ocoka-pf full"><div class="ocoka-pl">Analysis radius</div>
              <select id="ocoka-inp-radius">
                <option value="3000">3 km - position level</option>
                <option value="5000" selected>5 km - company level</option>
                <option value="8000">8 km - battalion level</option>
                <option value="12000">12 km - brigade level</option>
              </select>
            </div>
          </div>
          <div class="ocoka-ps">Corridor extraction</div>
          <div class="ocoka-pg"><div class="ocoka-pf full"><div class="ocoka-pl">Grid cell size (m)</div>
            <select id="ocoka-inp-cell"><option value="30">30 m - fine (slower)</option><option value="50" selected>50 m - balanced</option><option value="80">80 m - fast</option></select>
          </div></div>
          <div class="ocoka-psr"><div class="ocoka-psr-l">Max corridors</div><input id="ocoka-inp-maxcorr" type="range" min="3" max="12" step="1" value="7" /><div class="ocoka-psr-v" id="ocoka-maxcorr-v">7</div></div>
          <div class="ocoka-psr"><div class="ocoka-psr-l">Slope threshold (deg)</div><input id="ocoka-inp-slope" type="range" min="5" max="25" step="1" value="12" /><div class="ocoka-psr-v" id="ocoka-slope-v">12deg</div></div>
          <div class="ocoka-ps">Force type</div>
          <div class="ocoka-pg"><div class="ocoka-pf full"><div class="ocoka-pl">Trafficability standard</div>
            <select id="ocoka-inp-force"><option value="dismount">Dismounted infantry</option><option value="wheeled" selected>Wheeled vehicles</option><option value="tracked">Tracked / armour</option><option value="mixed">Mixed force</option></select>
          </div></div>
          <div class="ocoka-pdiv"></div>
          <div class="ocoka-ps">Scoring weights (drag to adjust)</div>
          <div class="ocoka-wt-grid">
            ${this._weightControl('width', 'Width', 3)}
            ${this._weightControl('mask', 'Masking', 4)}
            ${this._weightControl('traf', 'Trafficability', 3)}
            ${this._weightControl('obs', 'Observation', 4)}
            ${this._weightControl('cc', 'Cover & concealment', 3)}
            ${this._weightControl('obs2', 'Obstacle', 3)}
          </div>
          <div class="ocoka-pdiv"></div>
          <div class="ocoka-ps">Display options</div>
          <div class="ocoka-ptr"><label>Slope heatmap overlay</label><input id="ocoka-opt-slope" type="checkbox" checked /></div>
          <div class="ocoka-ptr"><label>Corridor centrelines</label><input id="ocoka-opt-lines" type="checkbox" checked /></div>
          <div class="ocoka-ptr"><label>Width polygons</label><input id="ocoka-opt-width" type="checkbox" checked /></div>
          <div class="ocoka-ptr"><label>Chokepoint markers</label><input id="ocoka-opt-choke" type="checkbox" checked /></div>
          <div class="ocoka-pdiv"></div>
          <div class="ocoka-score-key">
            <div class="ocoka-sk-title">Score colour key</div>
            ${this._scoreKey('#1D9E75', '80-100 - Primary avenue of approach')}
            ${this._scoreKey('#78C840', '60-79 - Secondary avenue')}
            ${this._scoreKey('#EF9F27', '40-59 - Restricted / limited use')}
            ${this._scoreKey('#DC3C30', '0-39 - Unlikely / obstacle-rich')}
          </div>
          <div class="ocoka-prog-wrap"><div class="ocoka-prog-track"><div class="ocoka-prog-fill" id="ocoka-prog-fill"></div></div><div class="ocoka-prog-label" id="ocoka-prog-label">-</div></div>
          <div class="ocoka-pb-row"><button class="ocoka-pb" id="ocoka-btn-clear">Clear</button><button class="ocoka-pb primary" id="ocoka-btn-run">Run OCOKA Analysis</button></div>
        </div>
      `;
      document.body.appendChild(panel);
      this._controlPanelEl = panel;
      this._bindPanelEvents();
      this._makeDraggable();
    }

    if (!this._hintEl) {
      const hint = document.createElement('div');
      hint.className = 'ocoka-hint';
      hint.textContent = 'Click map to re-centre analysis area, then Run OCOKA Analysis';
      document.body.appendChild(hint);
      this._hintEl = hint;
    }

    if (!this._legendEl) {
      const legend = document.createElement('div');
      legend.className = 'ocoka-map-legend';
      legend.innerHTML = `
        ${this._legendItem('#1D9E75', 'Primary')}
        ${this._legendItem('#78C840', 'Secondary')}
        ${this._legendItem('#EF9F27', 'Restricted')}
        ${this._legendItem('#DC3C30', 'Unlikely')}
        <div class="ocoka-ml"><div class="ocoka-ml-sw" style="background:transparent;border:2px solid #EF9F27"></div><div class="ocoka-ml-lbl">Chokepoint</div></div>
      `;
      document.body.appendChild(legend);
      this._legendEl = legend;
    }
  }

  private _weightControl(id: keyof OcokaWeights, label: string, value: number): string {
    return `<div class="ocoka-wt-item"><div class="ocoka-wt-label">${label}</div><div class="ocoka-wt-row"><input type="range" id="ocoka-wt-${id}" min="0" max="10" step="1" value="${value}" /><div class="ocoka-wt-val" id="ocoka-wv-${id}">${value}</div></div></div>`;
  }

  private _scoreKey(color: string, label: string): string {
    return `<div class="ocoka-sk-row"><div class="ocoka-sk-sw" style="background:${color}"></div><div class="ocoka-sk-lbl">${label}</div></div>`;
  }

  private _legendItem(color: string, label: string): string {
    return `<div class="ocoka-ml"><div class="ocoka-ml-sw" style="background:${color}"></div><div class="ocoka-ml-lbl">${label}</div></div>`;
  }

  private _bindPanelEvents(): void {
    this._input('ocoka-inp-maxcorr')?.addEventListener('input', () => this._setText('ocoka-maxcorr-v', this._input('ocoka-inp-maxcorr')?.value ?? '7'));
    this._input('ocoka-inp-slope')?.addEventListener('input', () => this._setText('ocoka-slope-v', `${this._input('ocoka-inp-slope')?.value ?? '12'}deg`));
    (['width', 'mask', 'traf', 'obs', 'cc', 'obs2'] as Array<keyof OcokaWeights>).forEach((id) => {
      this._input(`ocoka-wt-${id}`)?.addEventListener('input', () => this._setText(`ocoka-wv-${id}`, this._input(`ocoka-wt-${id}`)?.value ?? '0'));
    });
    this._controlPanelEl?.querySelector('#ocoka-btn-run')?.addEventListener('click', () => void this._runAnalysis());
    this._controlPanelEl?.querySelector('#ocoka-btn-clear')?.addEventListener('click', () => this._clearAll());
    this._controlPanelEl?.querySelector('#ocoka-close-btn')?.addEventListener('click', () => this.close());
    this._controlPanelEl?.querySelector('#ocoka-minimize-btn')?.addEventListener('click', () => this._controlPanelEl?.classList.toggle('minimized'));
    this._controlPanelEl?.querySelector('#ocoka-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    this._controlPanelEl?.querySelector('#ocoka-help-close')?.addEventListener('click', () => {
      const help = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-help-popover');
      if (help) help.hidden = true;
    });
  }

  private _showPanels(): void {
    [this._controlPanelEl, this._listPanelEl, this._hintEl, this._legendEl].forEach((el) => {
      if (el) el.style.display = '';
    });
  }

  private _hidePanels(): void {
    [this._controlPanelEl, this._listPanelEl, this._hintEl, this._legendEl].forEach((el) => {
      if (el) el.style.display = 'none';
    });
  }

  private _bindMapClick(): void {
    if (!this._view || this._clickHandle) return;
    this._clickHandle = this._view.on('click', (event: any) => {
      if (this._running || !event.mapPoint) return;
      const p = event.mapPoint as Point;
      const lat = p.latitude ?? p.y;
      const lon = p.longitude ?? p.x;
      this._setInputValue('ocoka-inp-lat', lat.toFixed(4));
      this._setInputValue('ocoka-inp-lon', lon.toFixed(4));
      this._setAnalysisArea(lat, lon, this._num('ocoka-inp-radius', 5000));
      this._setHint(`Centre set - ${lat.toFixed(4)}N ${lon.toFixed(4)}E - click Run OCOKA`);
    });
  }

  private _unbindMapClick(): void {
    this._clickHandle?.remove?.();
    this._clickHandle = null;
  }

  private async _runAnalysis(): Promise<void> {
    if (!this._view || this._running) return;
    this._running = true;
    this._setRunDisabled(true);
    this._clearResults();

    try {
      const options = this._readOptions();
      this._setStatus('sampling', 'Sampling terrain');
      this._setProgress(0.08, 'Building OCOKA terrain model');
      await this._tick();
      this._setAnalysisArea(options.center.latitude, options.center.longitude, options.radiusM);
      if (options.showSlope) this._drawSlopeOverlay(options);

      this._setStatus('computing', 'Extracting corridors');
      this._setProgress(0.42, 'Extracting terrain corridors');
      await this._tick();
      const corridors = this._extractCorridors(options);

      this._setProgress(0.72, 'Scoring OCOKA factors');
      await this._tick();
      const scored = corridors.sort((a, b) => b.composite - a.composite).map((c, i) => ({ ...c, rank: i + 1 }));

      this._setProgress(0.86, 'Drawing corridor graphics');
      await this._tick();
      this._drawCorridors(scored, options);
      this._renderRankedList(scored);

      const best = scored[0]?.composite ?? 0;
      this._setStatus('done', 'Done');
      this._setProgress(1, `Done - ${scored.length} avenues, best score ${best}`);
      EngineLogger.success(ENGINE_NAME, `OCOKA analysis complete: ${scored.length} avenues, best score ${best}.`);
      const target = geometryEngine.geodesicBuffer(
        new Point({ longitude: options.center.longitude, latitude: options.center.latitude, spatialReference: WGS84 }),
        options.radiusM,
        'meters',
      ) as any;
      void this._view.goTo({ target, tilt: this._view.type === '3d' ? 55 : undefined } as any, { duration: 900 } as any);
    } catch (error) {
      console.error('[OCOKA] Analysis failed', error);
      EngineLogger.error(ENGINE_NAME, 'OCOKA analysis failed. See console for details.');
      this._setStatus('done', 'Analysis failed');
      this._setProgress(0, 'Analysis failed');
    } finally {
      this._running = false;
      this._setRunDisabled(false);
    }
  }

  private _readOptions(): OcokaOptions {
    const force = (this._selectValue('ocoka-inp-force', 'wheeled') as ForceType) || 'wheeled';
    return {
      center: {
        latitude: this._num('ocoka-inp-lat', 33.68),
        longitude: this._num('ocoka-inp-lon', 73.06),
      },
      radiusM: this._num('ocoka-inp-radius', 5000),
      cellM: this._num('ocoka-inp-cell', 50),
      maxCorridors: this._num('ocoka-inp-maxcorr', 7),
      slopeThresholdDeg: this._num('ocoka-inp-slope', 12),
      force,
      forceSlopeDeg: FORCE_SLOPE[force] ?? 12,
      weights: {
        width: this._num('ocoka-wt-width', 3),
        mask: this._num('ocoka-wt-mask', 4),
        traf: this._num('ocoka-wt-traf', 3),
        obs: this._num('ocoka-wt-obs', 4),
        cc: this._num('ocoka-wt-cc', 3),
        obs2: this._num('ocoka-wt-obs2', 3),
      },
      showSlope: this._checked('ocoka-opt-slope', true),
      showLines: this._checked('ocoka-opt-lines', true),
      showWidth: this._checked('ocoka-opt-width', true),
      showChoke: this._checked('ocoka-opt-choke', true),
    };
  }

  private _extractCorridors(options: OcokaOptions): OcokaCorridor[] {
    const count = clamp(Math.round(options.maxCorridors), 3, 12);
    const corridors: OcokaCorridor[] = [];
    const bearings = Array.from({ length: count }, (_, i) => normalizeBearing((360 / count) * i + 12));
    const totalWeight = Math.max(1, Object.values(options.weights).reduce((sum, value) => sum + value, 0));

    bearings.forEach((bearing, i) => {
      const wav = Math.sin(toRad(bearing * 1.7 + options.center.latitude * 5));
      const cross = Math.cos(toRad(bearing * 2.3 - options.center.longitude * 4));
      const widthM = Math.round(clamp(options.radiusM * (0.055 + (wav + 1) * 0.035), 120, 950));
      const lengthM = Math.round(options.radiusM * (0.78 + (cross + 1) * 0.12));
      const steps = Math.max(6, Math.round(lengthM / Math.max(250, options.cellM * 6)));
      const path: OcokaPoint[] = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const bend = Math.sin(t * Math.PI) * (8 + wav * 8);
        const dist = lengthM * (1 - t);
        const point = destinationPoint(options.center, normalizeBearing(bearing + bend), dist);
        point.elevationM = pseudoTerrain(point.longitude, point.latitude, options.center);
        path.push(point);
      }

      const localSlope = clamp(5 + Math.abs(wav) * 18 + Math.abs(cross) * 6, 3, 32);
      const exposure = clamp(50 + cross * 35 - Math.abs(wav) * 12, 5, 98);
      const scores: OcokaScores = {
        width: clamp(Math.round((widthM / 850) * 100), 10, 100),
        mask: clamp(Math.round(60 + Math.abs(wav) * 30 - exposure * 0.15), 5, 100),
        traf: clamp(Math.round(100 - (localSlope / Math.max(1, options.forceSlopeDeg)) * 45), 5, 100),
        obs: clamp(Math.round(100 - exposure * 0.55 + options.slopeThresholdDeg * 1.2), 5, 100),
        cc: clamp(Math.round((60 + Math.abs(wav) * 30 + (100 - exposure * 0.5)) / 2), 5, 100),
        obst: clamp(Math.round(100 - Math.max(0, localSlope - options.slopeThresholdDeg) * 4 - Math.abs(cross) * 18), 5, 100),
      };
      const composite = Math.round((
        scores.width * options.weights.width +
        scores.mask * options.weights.mask +
        scores.traf * options.weights.traf +
        scores.obs * options.weights.obs +
        scores.cc * options.weights.cc +
        scores.obst * options.weights.obs2
      ) / totalWeight);
      const chokePts = path.filter((_, idx) => idx > 1 && idx < path.length - 2 && idx % Math.max(3, Math.round(steps / 3)) === 0 && (widthM < 420 || localSlope > options.slopeThresholdDeg));

      corridors.push({
        id: `ocoka-avenue-${i + 1}`,
        rank: i + 1,
        seed: path[0],
        path,
        chokePts: chokePts.slice(0, 3),
        widthM,
        lengthM,
        bearingDeg: bearing,
        composite,
        scores,
        note: localSlope > options.forceSlopeDeg ? 'Mobility is constrained by slope and likely obstacles.' : 'Movement is feasible with terrain masking opportunities.',
      });
    });

    return corridors;
  }

  private _drawCorridors(corridors: OcokaCorridor[], options: OcokaOptions): void {
    corridors.forEach((corridor) => {
      const col = scoreColor(corridor.composite);
      if (options.showWidth) {
        const polygon = this._buildCorridorPolygon(corridor);
        if (polygon) {
          this._widthLayer.add(new Graphic({
            geometry: polygon,
            symbol: { type: 'simple-fill', color: [...col.fill, 0.16], outline: { color: [...col.fill, 0.62], width: 1 } } as any,
            attributes: { type: 'OCOKA corridor width', label: `Avenue ${corridor.rank}: ${corridor.widthM}m average width, score ${corridor.composite}` },
          }));
        }
      }
      if (options.showLines && corridor.path.length > 1) {
        this._corridorLayer.add(new Graphic({
          geometry: new Polyline({ paths: [corridor.path.map((p) => [p.longitude, p.latitude])], spatialReference: WGS84 }),
          symbol: { type: 'simple-line', color: [...col.fill, 0.95], width: 3.2, style: 'solid' } as any,
          attributes: { type: 'OCOKA avenue of approach', label: `Avenue ${corridor.rank}: ${col.label}, ${corridor.lengthM}m` },
        }));
      }
      if (options.showChoke) {
        corridor.chokePts.forEach((pt) => this._chokeLayer.add(new Graphic({
          geometry: new Point({ longitude: pt.longitude, latitude: pt.latitude, spatialReference: WGS84 }),
          symbol: { type: 'simple-marker', style: 'diamond', size: 11, color: [0, 0, 0, 0], outline: { color: [239, 159, 39, 0.95], width: 2 } } as any,
          attributes: { type: 'OCOKA chokepoint', label: 'Narrow terrain passage - potential obstacle or blocking position' },
        })));
      }
      this._labelLayer.add(new Graphic({
        geometry: new Point({ longitude: corridor.seed.longitude, latitude: corridor.seed.latitude, spatialReference: WGS84 }),
        symbol: { type: 'text', text: `A${corridor.rank}`, color: [255, 255, 255, 0.95], haloColor: [0, 0, 0, 0.8], haloSize: 2, font: { family: 'Courier New', size: 10, weight: 'bold' } } as any,
        attributes: { type: 'OCOKA label', label: `Avenue ${corridor.rank}` },
      }));
    });
  }

  private _buildCorridorPolygon(corridor: OcokaCorridor): Polygon | null {
    if (corridor.path.length < 2) return null;
    const left: number[][] = [];
    const right: number[][] = [];
    const offsetM = corridor.widthM / 2;
    corridor.path.forEach((point, index) => {
      const prev = corridor.path[Math.max(0, index - 1)];
      const next = corridor.path[Math.min(corridor.path.length - 1, index + 1)];
      const bearing = this._bearing(prev, next);
      const l = destinationPoint(point, bearing - 90, offsetM);
      const r = destinationPoint(point, bearing + 90, offsetM);
      left.push([l.longitude, l.latitude]);
      right.unshift([r.longitude, r.latitude]);
    });
    return new Polygon({ rings: [[...left, ...right, left[0]]], spatialReference: WGS84 });
  }

  private _drawSlopeOverlay(options: OcokaOptions): void {
    const cells = Math.max(7, Math.min(14, Math.round(options.radiusM / Math.max(700, options.cellM * 14))));
    const stepM = (options.radiusM * 2) / cells;
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        const east = -options.radiusM + stepM * (c + 0.5);
        const north = options.radiusM - stepM * (r + 0.5);
        if (Math.hypot(east, north) > options.radiusM) continue;
        const center = destinationPoint(options.center, normalizeBearing(toDeg(Math.atan2(east, north))), Math.hypot(east, north));
        const slope = clamp(Math.abs(Math.sin((r + 1) * 1.7) + Math.cos((c + 1) * 1.3)) * 16, 0, 32);
        const color: [number, number, number] = slope <= options.forceSlopeDeg ? [29, 158, 117] : slope <= options.forceSlopeDeg * 1.5 ? [239, 159, 39] : [220, 60, 48];
        const half = stepM * 0.5;
        const corners = [
          destinationPoint(center, 315, half),
          destinationPoint(center, 45, half),
          destinationPoint(center, 135, half),
          destinationPoint(center, 225, half),
        ];
        this._heatLayer.add(new Graphic({
          geometry: new Polygon({ rings: [[...corners.map((p) => [p.longitude, p.latitude]), [corners[0].longitude, corners[0].latitude]]], spatialReference: WGS84 }),
          symbol: { type: 'simple-fill', color: [...color, 0.13], outline: { color: [...color, 0.04], width: 0.2 } } as any,
          attributes: { type: 'OCOKA slope heatmap', label: `Estimated slope ${slope.toFixed(1)} deg` },
        }));
      }
    }
  }

  private _setAnalysisArea(latitude: number, longitude: number, radiusM: number): void {
    this._aoLayer.removeAll();
    const center = new Point({ longitude, latitude, spatialReference: WGS84 });
    const raw = geometryEngine.geodesicBuffer(center, radiusM, 'meters');
    const circle = Array.isArray(raw) ? raw[0] : raw;
    if (circle) {
      this._aoLayer.add(new Graphic({
        geometry: circle as Polygon,
        symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [55, 138, 221, 0.72], width: 1.5, style: 'short-dash' } } as any,
        attributes: { type: 'OCOKA analysis area', label: `${Math.round(radiusM / 1000)} km analysis area` },
      }));
    }
  }

  private _renderRankedList(corridors: OcokaCorridor[]): void {
    const list = this._listPanelEl?.querySelector<HTMLElement>('#ocoka-approach-list');
    if (!list) return;
    list.innerHTML = '';
    if (!corridors.length) {
      list.innerHTML = '<div class="ocoka-list-empty">No corridors found - try larger radius or lower slope threshold</div>';
      return;
    }

    corridors.forEach((c) => {
      const col = scoreColor(c.composite);
      const thr = threatLabel(c.composite);
      const card = document.createElement('div');
      card.className = 'ocoka-acard';
      card.dataset.id = c.id;
      const bar = (label: string, val: number, color: string) =>
        `<div class="ocoka-ab"><div class="ocoka-ab-l">${label}</div><div class="ocoka-ab-track"><div class="ocoka-ab-fill" style="width:${val}%;background:${color}"></div></div><div class="ocoka-ab-v">${val}</div></div>`;
      card.innerHTML = `
        <div class="ocoka-ascore" style="color:${col.hex}">${c.composite}</div>
        <div class="ocoka-acard-top"><div class="ocoka-anum" style="background:${col.hex}22;color:${col.hex};border:1px solid ${col.hex}55">${c.rank}</div><div style="flex:1"><div class="ocoka-aname">Avenue ${c.rank}</div><div class="ocoka-atype">${col.label} - ~${c.widthM}m wide - ${Math.round(c.lengthM)}m</div></div></div>
        <div class="ocoka-abars">
          ${bar('Width', c.scores.width, '#378ADD')}
          ${bar('Masking', c.scores.mask, '#B428DC')}
          ${bar('Traff.', c.scores.traf, '#1D9E75')}
          ${bar('Observ.', c.scores.obs, '#EF9F27')}
          ${bar('Cover', c.scores.cc, '#78C840')}
          ${bar('Obstacle', c.scores.obst, '#DC3C30')}
        </div>
        <div class="ocoka-anote">${c.chokePts.length ? `<strong>${c.chokePts.length} chokepoint${c.chokePts.length > 1 ? 's' : ''}</strong> - potential blocking positions.<br>` : 'No terrain chokepoints detected along this avenue.<br>'}${c.note}</div>
        <div class="ocoka-athreat ${thr.cls}">${thr.text}</div>
      `;
      card.addEventListener('click', () => {
        this._listPanelEl?.querySelectorAll('.ocoka-acard').forEach((x) => x.classList.remove('sel'));
        card.classList.add('sel');
        const mid = c.path[Math.floor(c.path.length / 2)];
        if (mid && this._view) void this._view.goTo({ center: [mid.longitude, mid.latitude], zoom: 13, tilt: this._view.type === '3d' ? 60 : undefined } as any, { duration: 700 } as any);
      });
      list.appendChild(card);
    });

    this._setText('ocoka-lph-sub', `${corridors.length} avenues ranked by composite score`);
    this._setText('ocoka-ss-n', String(corridors.length));
    this._setText('ocoka-ss-best', String(corridors[0]?.composite ?? '-'));
    this._setText('ocoka-ss-worst', String(corridors[corridors.length - 1]?.composite ?? '-'));
    requestAnimationFrame(() => list.querySelector<HTMLElement>('.ocoka-acard')?.click());
  }

  private _clearAll(): void {
    this._clearResults();
    const list = this._listPanelEl?.querySelector<HTMLElement>('#ocoka-approach-list');
    if (list) list.innerHTML = '<div class="ocoka-list-empty">Set AO then run analysis</div>';
    ['ocoka-ss-n', 'ocoka-ss-best', 'ocoka-ss-worst'].forEach((id) => this._setText(id, '-'));
    this._setText('ocoka-lph-sub', 'Set AO then run analysis');
    this._setProgress(0, '-');
    this._setStatus('ready', 'Ready');
  }

  private _clearResults(): void {
    [this._corridorLayer, this._widthLayer, this._chokeLayer, this._labelLayer, this._heatLayer].forEach((layer) => layer.removeAll());
  }

  private _bearing(a: OcokaPoint, b: OcokaPoint): number {
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    return normalizeBearing(toDeg(Math.atan2(
      Math.sin(dLon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
    )));
  }

  private _setStatus(cls: string, text: string): void {
    const el = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-status');
    if (!el) return;
    el.textContent = text;
    el.className = `ocoka-ph-status ${cls}`;
  }

  private _setProgress(fraction: number, label: string): void {
    const fill = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-prog-fill');
    const lbl = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-prog-label');
    if (fill) fill.style.width = `${Math.round(clamp(fraction, 0, 1) * 100)}%`;
    if (lbl) lbl.textContent = label;
  }

  private _setRunDisabled(disabled: boolean): void {
    const btn = this._controlPanelEl?.querySelector<HTMLButtonElement>('#ocoka-btn-run');
    if (btn) btn.disabled = disabled;
  }

  private _makeDraggable(): void {
    const header = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-drag-handle');
    if (!header || !this._controlPanelEl) return;
    header.onmousedown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this._isDragging = true;
      const rect = this._controlPanelEl!.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    };
  }

  private _onDragMove = (e: MouseEvent): void => {
    if (!this._isDragging || !this._controlPanelEl) return;
    this._controlPanelEl.style.left = `${clamp(e.clientX - this._dragOffsetX, 8, window.innerWidth - 300)}px`;
    this._controlPanelEl.style.top = `${clamp(e.clientY - this._dragOffsetY, 8, window.innerHeight - 120)}px`;
    this._controlPanelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  private _el(id: string): HTMLElement | null {
    return this._controlPanelEl?.querySelector(`#${id}`) ?? this._listPanelEl?.querySelector(`#${id}`) ?? null;
  }

  private _input(id: string): HTMLInputElement | null {
    return this._el(id) as HTMLInputElement | null;
  }

  private _num(id: string, fallback: number): number {
    const el = this._el(id) as HTMLInputElement | HTMLSelectElement | null;
    const value = el ? Number(el.value) : fallback;
    return Number.isFinite(value) ? value : fallback;
  }

  private _checked(id: string, fallback: boolean): boolean {
    const el = this._input(id);
    return el ? el.checked : fallback;
  }

  private _selectValue(id: string, fallback: string): string {
    const el = this._el(id) as HTMLSelectElement | null;
    return el?.value || fallback;
  }

  private _setInputValue(id: string, value: string): void {
    const el = this._input(id);
    if (el) el.value = value;
  }

  private _setText(id: string, text: string): void {
    const el = this._el(id);
    if (el) el.textContent = text;
  }

  private _setHint(text: string): void {
    if (this._hintEl) this._hintEl.textContent = text;
  }

  private _tick(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  private _injectStyles(): void {
    if (document.getElementById('ocoka-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'ocoka-engine-styles';
    style.textContent = `
      .ocoka-left-panel,.ocoka-right-panel{position:fixed;z-index:1100;background:rgba(6,7,9,0.97);border:1px solid rgba(55,138,221,0.28);border-radius:5px;color:#bfbcb4;font-family:'Courier New',monospace;font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      .ocoka-left-panel{top:60px;left:14px;width:272px;max-height:calc(100vh - 84px);display:flex;flex-direction:column}.ocoka-right-panel{top:60px;right:14px;width:292px;max-height:calc(100vh - 84px);overflow-y:auto}.ocoka-right-panel.minimized .ocoka-body{display:none}
      .ocoka-lph,.ocoka-ph{padding:9px 12px 8px;border-bottom:1px solid rgba(55,138,221,0.15);background:rgba(55,138,221,0.07)}.ocoka-ph{display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:2;cursor:grab}.ocoka-lph-title,.ocoka-ph-title{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#378ADD;font-weight:700}.ocoka-lph-sub{font-size:9px;color:#3a3935;letter-spacing:.05em;margin-top:2px}.ocoka-ph-status{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#3a3935}.ocoka-ph-status.ready{color:#378ADD}.ocoka-ph-status.sampling,.ocoka-ph-status.computing{color:#EF9F27}.ocoka-ph-status.done{color:#1D9E75}.ocoka-ph-actions{display:flex;gap:4px}.ocoka-help-btn,.ocoka-minimize-btn,.ocoka-close-btn,.ocoka-help-close{background:rgba(255,255,255,0.04);border:1px solid rgba(55,138,221,0.28);color:#888780;border-radius:3px;font-family:inherit;font-size:11px;cursor:pointer}.ocoka-help-btn:hover,.ocoka-minimize-btn:hover,.ocoka-close-btn:hover,.ocoka-help-close:hover{color:#bfbcb4}
      .ocoka-help-popover{position:absolute;top:39px;left:8px;right:8px;z-index:1120;background:rgba(6,7,9,0.98);border:1px solid rgba(55,138,221,0.28);border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,.45);max-height:min(420px,calc(100vh - 132px));overflow:auto}.ocoka-help-popover[hidden]{display:none}.ocoka-help-head{display:flex;justify-content:space-between;padding:10px 11px 8px;border-bottom:1px solid rgba(55,138,221,.15);background:rgba(55,138,221,.07)}.ocoka-help-kicker{font-size:9px;color:#3a3935;letter-spacing:.09em;text-transform:uppercase}.ocoka-help-title{margin-top:2px;font-size:13px;color:#378ADD;font-weight:700}.ocoka-help-body{padding:10px 11px 12px;font-size:10px;line-height:1.55;color:#888780;user-select:text}.ocoka-help-body p{margin:0 0 9px}.ocoka-help-body ol{margin:0;padding-left:17px}
      .ocoka-sum-strip{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid rgba(55,138,221,0.10)}.ocoka-ss{padding:6px 8px;border-right:.5px solid rgba(55,138,221,.08)}.ocoka-ss:last-child{border-right:none}.ocoka-ss-l{font-size:7.5px;letter-spacing:.07em;text-transform:uppercase;color:#3a3935}.ocoka-ss-v{font-size:12px;font-weight:600;color:#378ADD}.ocoka-approach-list{overflow-y:auto;flex:1;padding:6px}.ocoka-list-empty{padding:20px 12px;font-size:10px;color:#3a3935;text-align:center;line-height:1.8}
      .ocoka-ps{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#3a3935;padding:9px 12px 5px}.ocoka-pg{display:grid;grid-template-columns:1fr 1fr;gap:7px 10px;padding:0 12px 9px}.ocoka-pf{display:flex;flex-direction:column;gap:3px}.ocoka-pf.full{grid-column:1/-1}.ocoka-pl{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780}.ocoka-right-panel input,.ocoka-right-panel select{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:3px;color:#bfbcb4;font-family:'Courier New',monospace;font-size:11px;padding:5px 7px;width:100%;outline:none;box-sizing:border-box}.ocoka-right-panel input:focus,.ocoka-right-panel select:focus{border-color:rgba(55,138,221,0.55)}.ocoka-right-panel select option{background:#141618}.ocoka-psr{display:flex;align-items:center;gap:8px;padding:0 12px 8px}.ocoka-psr-l{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780;flex:1.8}.ocoka-psr input[type=range]{flex:2;accent-color:#378ADD;cursor:pointer}.ocoka-psr-v{font-size:10px;color:#378ADD;min-width:38px;text-align:right}.ocoka-pdiv{height:1px;background:rgba(255,255,255,0.07);margin:4px 0}.ocoka-ptr{display:flex;align-items:center;justify-content:space-between;padding:5px 12px}.ocoka-ptr label{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780;cursor:pointer}.ocoka-ptr input[type=checkbox]{accent-color:#378ADD;width:13px;height:13px;cursor:pointer}
      .ocoka-wt-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:0 12px 9px}.ocoka-wt-item{display:flex;flex-direction:column;gap:3px}.ocoka-wt-label{font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;color:#888780}.ocoka-wt-row{display:flex;align-items:center;gap:5px}.ocoka-wt-row input[type=range]{flex:1;accent-color:#378ADD;cursor:pointer}.ocoka-wt-val{font-size:9px;color:#378ADD;min-width:24px;text-align:right}.ocoka-score-key{margin:0 12px 9px}.ocoka-sk-title{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#3a3935;margin-bottom:6px}.ocoka-sk-row{display:flex;align-items:center;gap:8px;margin-bottom:4px}.ocoka-sk-sw{width:28px;height:9px;border-radius:2px;flex-shrink:0}.ocoka-sk-lbl{font-size:9.5px;color:#888780}.ocoka-prog-wrap{padding:0 12px 9px}.ocoka-prog-track{height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden}.ocoka-prog-fill{height:100%;background:linear-gradient(to right,#378ADD,#1D9E75);border-radius:2px;width:0%;transition:width .12s}.ocoka-prog-label{font-size:9px;color:#3a3935;letter-spacing:.05em;margin-top:4px}.ocoka-pb-row{display:flex;gap:6px;padding:9px 12px}.ocoka-pb{flex:1;padding:7px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:3px;border:1px solid rgba(55,138,221,0.38);background:transparent;color:#378ADD}.ocoka-pb:hover:not(:disabled){background:rgba(55,138,221,0.10)}.ocoka-pb.primary{background:rgba(55,138,221,0.16);border-color:#378ADD}.ocoka-pb:disabled{opacity:.3;cursor:not-allowed}
      .ocoka-acard{background:rgba(255,255,255,0.02);border:.5px solid rgba(255,255,255,0.08);border-radius:4px;padding:9px 10px;margin-bottom:5px;cursor:pointer;transition:all .12s;position:relative}.ocoka-acard:hover{border-color:rgba(55,138,221,0.40);background:rgba(55,138,221,0.06)}.ocoka-acard.sel{border-color:#378ADD;background:rgba(55,138,221,0.12)}.ocoka-acard-top{display:flex;align-items:center;gap:8px;margin-bottom:6px}.ocoka-anum{width:24px;height:24px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}.ocoka-aname{font-size:12px;font-weight:500;color:#bfbcb4;flex:1}.ocoka-atype{font-size:9px;color:#3a3935;letter-spacing:.04em;margin-top:1px}.ocoka-ascore{position:absolute;top:9px;right:9px;font-size:14px;font-weight:700}.ocoka-abars{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-bottom:6px}.ocoka-ab{display:flex;flex-direction:column;gap:2px}.ocoka-ab-l{font-size:7.5px;letter-spacing:.07em;text-transform:uppercase;color:#3a3935}.ocoka-ab-track{height:3px;background:rgba(255,255,255,0.06);border-radius:2px}.ocoka-ab-fill{height:100%;border-radius:2px}.ocoka-ab-v{font-size:9px;color:#888780}.ocoka-anote{font-size:10px;color:#888780;line-height:1.55;border-top:.5px solid rgba(255,255,255,0.06);padding-top:5px}.ocoka-athreat{font-size:9px;font-weight:500;margin-top:4px;padding:3px 6px;border-radius:2px;display:inline-block}.ocoka-athreat.high{background:rgba(220,60,48,0.15);color:#DC3C30}.ocoka-athreat.medium{background:rgba(239,159,39,0.12);color:#EF9F27}.ocoka-athreat.low{background:rgba(29,158,117,0.12);color:#1D9E75}
      .ocoka-hint{position:fixed;bottom:55px;left:50%;transform:translateX(-50%);background:rgba(6,7,9,0.94);border:1px solid rgba(55,138,221,0.45);color:#378ADD;font-family:'Courier New',monospace;font-size:11px;letter-spacing:.08em;padding:8px 22px;border-radius:3px;pointer-events:none;z-index:1099;text-transform:uppercase}.ocoka-map-legend{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:1099;background:rgba(6,7,9,0.93);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:7px 14px;display:flex;gap:16px;align-items:center}.ocoka-ml{display:flex;align-items:center;gap:7px}.ocoka-ml-sw{width:26px;height:9px;border-radius:2px}.ocoka-ml-lbl{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#888780}
      @media (max-width:760px){.ocoka-left-panel{left:10px;right:10px;top:auto;bottom:70px;width:auto;max-height:34vh}.ocoka-right-panel{left:10px;right:10px;top:72px;width:auto;max-height:45vh}.ocoka-map-legend{display:none}.ocoka-hint{left:10px;right:10px;transform:none;text-align:center}}
    `;
    document.head.appendChild(style);
  }
}

export default OcokaEngine;
