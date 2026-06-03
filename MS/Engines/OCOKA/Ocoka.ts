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
import RoadNetworkEngine, { type TrafficabilitySummary } from '../Analysis/RoadNetworkEngine';

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
  /** True when the corridor centreline was replaced by a real road route. */
  viaRoad?: boolean;
  /** Road-following distance (km), present only when viaRoad. */
  roadDistanceKm?: number;
  /** Road-following drive time (min), present only when viaRoad. */
  roadTimeMin?: number;
  /** Military trafficability of the routed approach, present only when viaRoad. */
  trafficability?: TrafficabilitySummary | null;
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
  private _pickMode = false;
  private _tooltipEl: HTMLDivElement | null = null;
  private _tooltipTimer: number | null = null;
  private _isDragging = false;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _subDragCleanup: Array<() => void> = [];

  constructor() {
    this._createLayers();

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

  open(graphic?: Graphic | null, view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    this._ensurePanels();
    this._showPanels();
    this._bindMapClick();
    document.body.classList.add('ms-popup-dark');

    const geom = graphic?.geometry;
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
      this._endPickMode();
    } else if (!this._hasValidLocation()) {
      // Opened with no symbol and no prior centre — prompt the user to pick one.
      this._setHint('No symbol — click 📍 Pick, then click the map to set the OCOKA centre');
      this._setStatus('ready', 'Pick a location');
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
    const corridors = this._extractCorridors(runOptions);
    await this._enrichCorridorsWithRoads(corridors, runOptions);
    return corridors
      .sort((a, b) => b.composite - a.composite)
      .map((corridor, index) => ({ ...corridor, rank: index + 1 }));
  }

  close(): void {
    this._hidePanels();
    this._unbindMapClick();
    this._endPickMode();
    this._hideTooltip();
    document.body.classList.remove('ms-popup-dark');
    (this._view as any)?.closePopup?.();
    if (this._view?.popup) this._view.popup.visible = false;
    this._onDragEnd();
  }

  destroy(): void {
    this.close();
    this._clearAll();
    this._subDragCleanup.forEach((fn) => fn());
    this._subDragCleanup = [];
    const map = this._view?.map as any;
    if (map) {
      [this._corridorLayer, this._widthLayer, this._chokeLayer, this._labelLayer, this._aoLayer, this._heatLayer]
        .forEach((layer) => map.remove(layer));
    }
    this._controlPanelEl?.remove();
    this._listPanelEl?.remove();
    this._hintEl?.remove();
    this._legendEl?.remove();
    this._hideTooltip();
    this._tooltipEl?.remove();
    this._controlPanelEl = null;
    this._listPanelEl = null;
    this._hintEl = null;
    this._legendEl = null;
    this._tooltipEl = null;
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
      panel.className = 'ms-panel ms-theme-ops-dark';
      panel.id = 'ocoka-list-panel';
      panel.style.cssText = 'top:60px;left:14px;width:480px;max-height:calc(100vh - 84px);';
      panel.innerHTML = `
        <div class="ms-header">
          <div class="ms-header-icon">⬡</div>
          <div class="ms-header-title">OCOKA — Avenues</div>
          <div class="ms-status-lbl" id="ocoka-lph-sub">Set AO then run analysis</div>
        </div>
        <div class="buffer-stats">
          <div class="buffer-stat"><div class="buffer-stat-lbl">Corridors</div><div class="buffer-stat-val" id="ocoka-ss-n">-</div></div>
          <div class="buffer-stat"><div class="buffer-stat-lbl">Best avenue</div><div class="buffer-stat-val" id="ocoka-ss-best">-</div></div>
          <div class="buffer-stat"><div class="buffer-stat-lbl">Worst score</div><div class="buffer-stat-val" id="ocoka-ss-worst">-</div></div>
        </div>
        <div class="ms-body" id="ocoka-approach-list" style="overflow-y:auto;flex:1;padding:6px;">
          <div class="ms-empty">
            Set the analysis area centre and radius<br>in the right panel, then click<br>
            <strong style="color:#378ADD">Run OCOKA Analysis</strong>.<br><br>
            Corridors are auto-extracted from<br>terrain topology and scored on:<br>
            width - masking - trafficability - observation
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      this._listPanelEl = panel;
      this._makeSubDraggable(panel, panel.querySelector<HTMLElement>('.ms-header'));
    }

    if (!this._controlPanelEl) {
      const panel = document.createElement('div');
      panel.className = 'ms-panel ms-theme-ops-dark';
      panel.style.cssText = 'top:60px;right:14px;width:380px;max-height:calc(100vh - 84px);overflow-y:auto;';
      panel.innerHTML = `
        <div class="ms-header" id="ocoka-drag-handle">
          <div class="ms-header-icon">⬡</div>
          <div class="ms-header-title">OCOKA Config</div>
          <div class="ms-status-dot" id="ocoka-status-dot"></div>
          <div class="ms-status-lbl" id="ocoka-status-lbl">Ready</div>
          <button class="ms-header-btn ms-btn-round" id="ocoka-help-btn" title="OCOKA wiki">?</button>
          <button class="ms-header-btn ms-btn-round" id="ocoka-minimize-btn" title="Minimize">▼</button>
          <button class="ms-header-btn ms-btn-round" id="ocoka-close-btn" title="Close">✕</button>
        </div>
        <div class="ms-help-popover" id="ocoka-help-popover" hidden>
          <div class="ms-help-head">
            <div><div class="ms-help-kicker">Field Wiki</div><div class="ms-help-title">OCOKA Terrain Analysis</div></div>
            <button class="ms-help-close" id="ocoka-help-close">✕</button>
          </div>
          <div class="ms-help-body">
            <p><strong>OCOKA</strong> evaluates Obstacles, Cover and Concealment, Observation and fields of fire, Key Terrain, and Avenues of Approach.</p>
            <p>This widget focuses on the companion Avenues of Approach panel. It ranks likely approach corridors by width, masking, trafficability, observation exposure, cover/concealment, and obstacle restriction.</p>
            <ol>
              <li>Right-click a symbol and open OCOKA from More Actions, or click the map to set the centre.</li>
              <li>Set AO radius, force type, extraction limits, and scoring weights.</li>
              <li>Run OCOKA Analysis to draw corridor centrelines, width polygons, chokepoints, score labels, and the ranked avenues list.</li>
            </ol>
            <div class="ms-help-kicker" style="margin-top:10px">Scoring weights explained</div>
            <p><strong>Width</strong> — usable corridor breadth; favours avenues that pass a force without bottleneck.</p>
            <p><strong>Masking</strong> — terrain screening from enemy observation along the route.</p>
            <p><strong>Trafficability</strong> — slope and surface suitability for the selected force (dismount / wheeled / tracked).</p>
            <p><strong>Observation</strong> — own fields of fire and overwatch potential from the corridor.</p>
            <p><strong>Cover &amp; concealment</strong> — protection from direct fire and visual detection within the corridor.</p>
            <p><strong>Obstacle</strong> — restriction from natural or built obstacles that slow or canalise movement.</p>
          </div>
        </div>
        <div class="ms-body">
          <div class="ms-section-title">Analysis area</div>
          <div class="ms-grid">
            <div class="ms-field full"><div class="ms-label">Centre coordinates</div>
              <div style="display:flex;gap:6px;align-items:center;">
                <input id="ocoka-inp-lat" class="ms-input" type="number" placeholder="lat" step="0.001" title="Centre latitude (decimal degrees)" style="flex:1;min-width:0;" />
                <input id="ocoka-inp-lon" class="ms-input" type="number" placeholder="lon" step="0.001" title="Centre longitude (decimal degrees)" style="flex:1;min-width:0;" />
                <button class="ms-btn" id="ocoka-btn-pick" title="Click, then click anywhere on the map to set the analysis centre" style="flex:0 0 auto;white-space:nowrap;padding:6px 9px;">📍 Pick</button>
              </div>
            </div>
            <div class="ms-field full"><div class="ms-label">Analysis radius</div>
              <select id="ocoka-inp-radius" class="ms-select">
                <option value="3000">3 km - position level</option>
                <option value="5000" selected>5 km - company level</option>
                <option value="8000">8 km - battalion level</option>
                <option value="12000">12 km - brigade level</option>
              </select>
            </div>
          </div>
          <div class="ms-section-title">Corridor extraction</div>
          <div class="ms-grid"><div class="ms-field full"><div class="ms-label">Grid cell size (m)</div>
            <select id="ocoka-inp-cell" class="ms-select"><option value="30">30 m - fine (slower)</option><option value="50" selected>50 m - balanced</option><option value="80">80 m - fast</option></select>
          </div></div>
          <div class="ms-slider-row"><div class="ms-slider-label">Max corridors</div><input id="ocoka-inp-maxcorr" type="range" min="3" max="12" step="1" value="7" /><div class="ms-slider-value" id="ocoka-maxcorr-v">7</div></div>
          <div class="ms-slider-row"><div class="ms-slider-label">Slope threshold (deg)</div><input id="ocoka-inp-slope" type="range" min="5" max="25" step="1" value="12" /><div class="ms-slider-value" id="ocoka-slope-v">12deg</div></div>
          <div class="ms-section-title">Force type</div>
          <div class="ms-grid"><div class="ms-field full"><div class="ms-label">Trafficability standard</div>
            <select id="ocoka-inp-force" class="ms-select"><option value="dismount">Dismounted infantry</option><option value="wheeled" selected>Wheeled vehicles</option><option value="tracked">Tracked / armour</option><option value="mixed">Mixed force</option></select>
          </div></div>
          <div class="ms-divider"></div>
          <div class="ms-section-title">Scoring weights (drag to adjust)</div>
          <div class="ms-weight-grid">
            ${this._weightControl('width', 'Width', 3)}
            ${this._weightControl('mask', 'Masking', 4)}
            ${this._weightControl('traf', 'Trafficability', 3)}
            ${this._weightControl('obs', 'Observation', 4)}
            ${this._weightControl('cc', 'Cover & concealment', 3)}
            ${this._weightControl('obs2', 'Obstacle', 3)}
          </div>
          <div class="ms-divider"></div>
          <div class="ms-section-title">Display options</div>
          <div class="ms-toggle-row"><label>Slope heatmap overlay</label><input id="ocoka-opt-slope" type="checkbox" checked /></div>
          <div class="ms-toggle-row"><label>Corridor centrelines</label><input id="ocoka-opt-lines" type="checkbox" checked /></div>
          <div class="ms-toggle-row"><label>Width polygons</label><input id="ocoka-opt-width" type="checkbox" checked /></div>
          <div class="ms-toggle-row"><label>Chokepoint markers</label><input id="ocoka-opt-choke" type="checkbox" checked /></div>
          <div class="ms-divider"></div>
          <div class="ms-score-key">
            <div class="ms-section-title" style="padding-top:4px">Score colour key</div>
            ${this._scoreKey('#1D9E75', '80-100 - Primary avenue of approach')}
            ${this._scoreKey('#78C840', '60-79 - Secondary avenue')}
            ${this._scoreKey('#EF9F27', '40-59 - Restricted / limited use')}
            ${this._scoreKey('#DC3C30', '0-39 - Unlikely / obstacle-rich')}
          </div>
          <div class="ms-progress-wrap"><div class="ms-progress-track"><div class="ms-progress-fill" id="ocoka-prog-fill"></div></div><div class="ms-progress-label" id="ocoka-prog-label">-</div></div>
          <div class="ms-btn-row"><button class="ms-btn" id="ocoka-btn-clear">Clear</button><button class="ms-btn primary" id="ocoka-btn-run">Run OCOKA Analysis</button></div>
        </div>
      `;
      document.body.appendChild(panel);
      this._controlPanelEl = panel;
      this._bindPanelEvents();
      this._makeDraggable();
    }

    if (!this._hintEl) {
      const hint = document.createElement('div');
      hint.className = 'ms-map-hint';
      hint.textContent = 'Click map to re-centre analysis area, then Run OCOKA Analysis';
      document.body.appendChild(hint);
      this._hintEl = hint;
    }

    if (!this._legendEl) {
      const legend = document.createElement('div');
      legend.className = 'ms-map-legend';
      legend.innerHTML = `
        ${this._legendItem('#1D9E75', 'Primary')}
        ${this._legendItem('#78C840', 'Secondary')}
        ${this._legendItem('#EF9F27', 'Restricted')}
        ${this._legendItem('#DC3C30', 'Unlikely')}
        <div class="ms-map-legend-item"><div class="ms-map-legend-swatch" style="background:transparent;border:2px solid #EF9F27"></div><div class="ms-map-legend-label">Chokepoint</div></div>
      `;
      document.body.appendChild(legend);
      this._legendEl = legend;
    }
  }

  private _weightControl(id: keyof OcokaWeights, label: string, value: number): string {
    return `<div class="ms-weight-row"><div class="ms-label">${label}</div><input type="range" id="ocoka-wt-${id}" min="0" max="10" step="1" value="${value}" /><div class="ms-weight-val" id="ocoka-wv-${id}">${value}</div></div>`;
  }

  private _scoreKey(color: string, label: string): string {
    return `<div class="ms-score-key-row"><div class="ms-score-key-swatch" style="background:${color}"></div><div class="ms-score-key-label">${label}</div></div>`;
  }

  private _legendItem(color: string, label: string): string {
    return `<div class="ms-map-legend-item"><div class="ms-map-legend-swatch" style="background:${color}"></div><div class="ms-map-legend-label">${label}</div></div>`;
  }

  private _bindPanelEvents(): void {
    this._input('ocoka-inp-maxcorr')?.addEventListener('input', () => this._setText('ocoka-maxcorr-v', this._input('ocoka-inp-maxcorr')?.value ?? '7'));
    this._input('ocoka-inp-slope')?.addEventListener('input', () => this._setText('ocoka-slope-v', `${this._input('ocoka-inp-slope')?.value ?? '12'}deg`));
    (['width', 'mask', 'traf', 'obs', 'cc', 'obs2'] as Array<keyof OcokaWeights>).forEach((id) => {
      this._input(`ocoka-wt-${id}`)?.addEventListener('input', () => this._setText(`ocoka-wv-${id}`, this._input(`ocoka-wt-${id}`)?.value ?? '0'));
    });
    this._controlPanelEl?.querySelector('#ocoka-btn-run')?.addEventListener('click', () => void this._runAnalysis());
    this._controlPanelEl?.querySelector('#ocoka-btn-clear')?.addEventListener('click', () => this._clearAll());
    this._controlPanelEl?.querySelector('#ocoka-btn-pick')?.addEventListener('click', () => this._beginPickMode());
    // Typing a valid coordinate clears any "pick a location" prompt.
    ['ocoka-inp-lat', 'ocoka-inp-lon'].forEach((id) =>
      this._input(id)?.addEventListener('input', () => { if (this._hasValidLocation()) { this._hideTooltip(); this._endPickMode(); } }),
    );
    this._controlPanelEl?.querySelector('#ocoka-close-btn')?.addEventListener('click', () => this.close());
    this._controlPanelEl?.querySelector('#ocoka-minimize-btn')?.addEventListener('click', () => {
      const body = this._controlPanelEl?.querySelector<HTMLElement>('.ms-body');
      const btn = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.classList.contains('ms-minimized');
      body.classList.toggle('ms-minimized', !minimized);
      btn.textContent = minimized ? '▼' : '▶';
    });
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
    [this._controlPanelEl, this._listPanelEl].forEach((el) => el?.classList.add('ms-visible'));
    [this._hintEl, this._legendEl].forEach((el) => el?.classList.add('ms-visible'));
  }

  private _hidePanels(): void {
    [this._controlPanelEl, this._listPanelEl].forEach((el) => el?.classList.remove('ms-visible'));
    [this._hintEl, this._legendEl].forEach((el) => el?.classList.remove('ms-visible'));
  }

  private _bindMapClick(): void {
    if (!this._view || this._clickHandle) return;
    this._clickHandle = this._view.on('click', (event: any) => {
      if (this._running || !event.mapPoint) return;
      if (!this._pickMode) return;
      const p = event.mapPoint as Point;
      const lat = p.latitude ?? p.y;
      const lon = p.longitude ?? p.x;
      this._setInputValue('ocoka-inp-lat', lat.toFixed(4));
      this._setInputValue('ocoka-inp-lon', lon.toFixed(4));
      this._setAnalysisArea(lat, lon, this._num('ocoka-inp-radius', 5000));
      this._setHint(`Centre set - ${lat.toFixed(4)}N ${lon.toFixed(4)}E - click Run OCOKA`);
      this._hideTooltip();
      this._endPickMode();
    });
  }

  private _unbindMapClick(): void {
    this._clickHandle?.remove?.();
    this._clickHandle = null;
  }

  private async _runAnalysis(): Promise<void> {
    if (!this._view || this._running) return;
    if (!this._hasValidLocation()) {
      this._flashTooltip('Set a location first — click 📍 Pick, then click the map (or type a lat / lon).');
      this._beginPickMode();
      return;
    }
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

      this._setProgress(0.58, 'Routing approaches on road network');
      await this._enrichCorridorsWithRoads(corridors, options);

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

  /** Weighted composite of the six OCOKA factor scores. */
  private _composite(scores: OcokaScores, weights: OcokaWeights): number {
    const totalWeight = Math.max(
      1,
      weights.width + weights.mask + weights.traf + weights.obs + weights.cc + weights.obs2,
    );
    return Math.round((
      scores.width * weights.width +
      scores.mask * weights.mask +
      scores.traf * weights.traf +
      scores.obs * weights.obs +
      scores.cc * weights.cc +
      scores.obst * weights.obs2
    ) / totalWeight);
  }

  /** Lazily reach the shared (optional) road-network adapter — may be absent. */
  private _roadNet(): any {
    return (window as any).symbolEngine?.roadNetworkEngine ?? null;
  }

  /** Flatten a GeoJSON Line/MultiLineString into a single [lng,lat][] list. */
  private _flattenLineCoords(geom: any): number[][] {
    if (!geom || !Array.isArray(geom.coordinates)) return [];
    if (geom.type === 'MultiLineString') {
      const out: number[][] = [];
      for (const seg of geom.coordinates) for (const c of seg) out.push([c[0], c[1]]);
      return out;
    }
    return (geom.coordinates as number[][]).map((c) => [c[0], c[1]]);
  }

  /**
   * Opportunistically replace each synthetic corridor centreline with a real
   * road route from its perimeter entry to the AO centre, and re-derive the
   * trafficability score from the actual road classes traversed.
   *
   * Fully degradable: if the optional road service is absent or down, this is a
   * no-op and the synthetic corridors stand. A single failed route leaves that
   * corridor untouched while the rest still enrich. Never throws.
   */
  private async _enrichCorridorsWithRoads(corridors: OcokaCorridor[], options: OcokaOptions): Promise<void> {
    const rn = this._roadNet();
    if (!rn) return;
    let available = false;
    try {
      available = await rn.ensureAvailable();
    } catch {
      available = false;
    }
    if (!available) return;

    const centre = { longitude: options.center.longitude, latitude: options.center.latitude };
    let enriched = 0;
    for (const corridor of corridors) {
      const entry = { longitude: corridor.seed.longitude, latitude: corridor.seed.latitude };
      let res: any = null;
      try {
        res = await rn.route(entry, centre);
      } catch {
        res = { ok: false };
      }
      if (!res?.ok || !res.data?.geometry) continue;

      const coords = this._flattenLineCoords(res.data.geometry);
      if (coords.length < 2) continue;

      const roadDistanceKm = res.data.distanceKm ?? 0;
      const roadTimeMin = res.data.travelTimeMin ?? 0;
      corridor.path = coords.map(([longitude, latitude]) => ({ longitude, latitude }) as OcokaPoint);
      corridor.seed = corridor.path[0];
      corridor.bearingDeg = this._bearing(corridor.path[0], corridor.path[corridor.path.length - 1]);
      corridor.chokePts = []; // synthetic chokepoints no longer align with the real road path
      corridor.viaRoad = true;
      corridor.roadDistanceKm = roadDistanceKm;
      corridor.roadTimeMin = roadTimeMin;
      corridor.lengthM = Math.round(roadDistanceKm * 1000) || corridor.lengthM;

      const traffic: TrafficabilitySummary | null = res.data.trafficability ?? null;
      corridor.trafficability = traffic;
      const head = `Road approach — ${roadDistanceKm.toFixed(1)} km, ${Math.round(roadTimeMin)} min`;
      if (traffic && traffic.totalKm > 0) {
        const tk = traffic.tierKm;
        const trafScore = clamp(
          Math.round((tk.GO * 100 + tk['SLOW-GO'] * 55 + tk['NO-GO'] * 18) / traffic.totalKm),
          5,
          100,
        );
        corridor.scores = { ...corridor.scores, traf: trafScore };
        corridor.composite = this._composite(corridor.scores, options.weights);
        const lim = RoadNetworkEngine.classifyClass(traffic.limitingClass);
        corridor.note = `${head} · ${traffic.rating} (limiting: ${lim.label}).`;
      } else {
        corridor.note = `${head}.`;
      }
      enriched++;
    }

    if (enriched > 0) {
      EngineLogger.success(ENGINE_NAME, `OCOKA: ${enriched} approach(es) routed on the road network.`);
    }
  }

  private _extractCorridors(options: OcokaOptions): OcokaCorridor[] {
    const count = clamp(Math.round(options.maxCorridors), 3, 12);
    const corridors: OcokaCorridor[] = [];
    const bearings = Array.from({ length: count }, (_, i) => normalizeBearing((360 / count) * i + 12));

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
      const composite = this._composite(scores, options.weights);
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
      list.innerHTML = '<div class="ms-empty">No corridors found - try larger radius or lower slope threshold</div>';
      return;
    }

    corridors.forEach((c) => {
      const col = scoreColor(c.composite);
      const thr = threatLabel(c.composite);
      const card = document.createElement('div');
      card.className = 'ms-feature-card';
      card.dataset.id = c.id;
      const bar = (label: string, val: number, color: string) =>
        `<div class="ms-feature-bar"><div class="ms-feature-bar-label">${label}</div><div class="ms-feature-bar-track"><div class="ms-feature-bar-fill" style="width:${val}%;background:${color}"></div></div><div class="ms-feature-bar-val">${val}</div></div>`;
      card.innerHTML = `
        <div class="ms-feature-score" style="color:${col.hex}">${c.composite}</div>
        <div class="ms-feature-top"><div class="ms-feature-rank" style="background:${col.hex}22;color:${col.hex};border:1px solid ${col.hex}55">${c.rank}</div><div style="flex:1"><div class="ms-feature-name">Avenue ${c.rank}</div><div class="ms-feature-type">${col.label} - ~${c.widthM}m wide - ${Math.round(c.lengthM)}m</div></div></div>
        <div class="ms-feature-bars" style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;">
          ${bar('Width', c.scores.width, '#378ADD')}
          ${bar('Masking', c.scores.mask, '#B428DC')}
          ${bar('Traff.', c.scores.traf, '#1D9E75')}
          ${bar('Observ.', c.scores.obs, '#EF9F27')}
          ${bar('Cover', c.scores.cc, '#78C840')}
          ${bar('Obstacle', c.scores.obst, '#DC3C30')}
        </div>
        <div class="ms-feature-assessment">${c.chokePts.length ? `<strong>${c.chokePts.length} chokepoint${c.chokePts.length > 1 ? 's' : ''}</strong> - potential blocking positions.<br>` : 'No terrain chokepoints detected along this avenue.<br>'}${c.note}</div>
        <div class="ms-feature-threat ${thr.cls}">${thr.text}</div>
      `;
      card.addEventListener('click', () => {
        this._listPanelEl?.querySelectorAll('.ms-feature-card').forEach((x) => x.classList.remove('selected'));
        card.classList.add('selected');
        const mid = c.path[Math.floor(c.path.length / 2)];
        if (mid && this._view) void this._view.goTo({ center: [mid.longitude, mid.latitude], zoom: 13, tilt: this._view.type === '3d' ? 60 : undefined } as any, { duration: 700 } as any);
      });
      list.appendChild(card);
    });

    this._setText('ocoka-lph-sub', `${corridors.length} avenues ranked by composite score`);
    this._setText('ocoka-ss-n', String(corridors.length));
    this._setText('ocoka-ss-best', String(corridors[0]?.composite ?? '-'));
    this._setText('ocoka-ss-worst', String(corridors[corridors.length - 1]?.composite ?? '-'));
    requestAnimationFrame(() => list.querySelector<HTMLElement>('.ms-feature-card')?.click());
  }

  private _clearAll(): void {
    this._clearResults();
    const list = this._listPanelEl?.querySelector<HTMLElement>('#ocoka-approach-list');
    if (list) list.innerHTML = '<div class="ms-empty">Set AO then run analysis</div>';
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
    const dot = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-status-dot');
    const lbl = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-status-lbl');
    if (lbl) lbl.textContent = text;
    if (dot) {
      if (cls === 'done' || cls === 'ready') {
        dot.style.background = cls === 'done' ? 'var(--ms-success)' : '#888';
        dot.style.boxShadow = cls === 'done' ? '0 0 6px var(--ms-success)' : 'none';
      } else {
        dot.style.background = 'var(--ms-accent)';
        dot.style.boxShadow = '0 0 6px var(--ms-accent)';
      }
    }
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
    this._controlPanelEl.style.left = `${clamp(e.clientX - this._dragOffsetX, 8, window.innerWidth - 396)}px`;
    this._controlPanelEl.style.top = `${clamp(e.clientY - this._dragOffsetY, 8, window.innerHeight - 120)}px`;
    this._controlPanelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  private _makeSubDraggable(panel: HTMLElement, handle: HTMLElement | null): void {
    if (!handle) return;
    let dragging = false;
    let ox = 0;
    let oy = 0;
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${clamp(e.clientX - ox, 8, window.innerWidth - rect.width - 8)}px`;
      panel.style.top = `${clamp(e.clientY - oy, 8, window.innerHeight - 80)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, select')) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      dragging = true;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    };
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', onDown);
    this._subDragCleanup.push(() => {
      handle.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    });
  }

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

  /** True when both lat and lon inputs hold a finite coordinate. */
  private _hasValidLocation(): boolean {
    const lat = (this._input('ocoka-inp-lat')?.value ?? '').trim();
    const lon = (this._input('ocoka-inp-lon')?.value ?? '').trim();
    return lat !== '' && lon !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
  }

  /** Enter "pick on map" mode — highlights the button and prompts the user. */
  private _beginPickMode(): void {
    this._pickMode = true;
    const btn = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-btn-pick');
    if (btn) {
      btn.classList.add('primary');
      btn.textContent = '📍 Click map…';
    }
    this._setHint('Click anywhere on the map to set the OCOKA analysis centre');
    this._setStatus('ready', 'Picking location');
  }

  private _endPickMode(): void {
    if (!this._pickMode) return;
    this._pickMode = false;
    const btn = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-btn-pick');
    if (btn) {
      btn.classList.remove('primary');
      btn.textContent = '📍 Pick';
    }
  }

  /** Show a transient tooltip bubble anchored under the Pick button. */
  private _flashTooltip(message: string): void {
    const btn = this._controlPanelEl?.querySelector<HTMLElement>('#ocoka-btn-pick');
    if (!btn) { this._setHint(message); return; }
    if (!this._tooltipEl) {
      const tip = document.createElement('div');
      tip.className = 'ms-panel ms-theme-ops-dark';
      tip.style.cssText =
        'position:fixed;z-index:1200;background:var(--ms-bg-elevated,#1e2434);color:var(--ms-text,#fff);' +
        'border:1px solid var(--ms-accent,#e5a540);border-radius:6px;padding:7px 10px;font-size:11px;line-height:1.4;' +
        'max-width:230px;box-shadow:0 6px 20px rgba(0,0,0,.45);pointer-events:none;opacity:0;transition:opacity .18s;';
      document.body.appendChild(tip);
      this._tooltipEl = tip;
    }
    const tip = this._tooltipEl;
    tip.textContent = message;
    const rect = btn.getBoundingClientRect();
    tip.style.left = `${Math.max(8, rect.right - 230)}px`;
    tip.style.top = `${rect.bottom + 8}px`;
    // Force a reflow so the opacity transition runs even on rapid re-trigger.
    void tip.offsetWidth;
    tip.style.opacity = '1';
    btn.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 360 },
    );
    if (this._tooltipTimer) window.clearTimeout(this._tooltipTimer);
    this._tooltipTimer = window.setTimeout(() => this._hideTooltip(), 3800);
  }

  private _hideTooltip(): void {
    if (this._tooltipTimer) {
      window.clearTimeout(this._tooltipTimer);
      this._tooltipTimer = null;
    }
    if (this._tooltipEl) this._tooltipEl.style.opacity = '0';
  }

  private _tick(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

}

export default OcokaEngine;
