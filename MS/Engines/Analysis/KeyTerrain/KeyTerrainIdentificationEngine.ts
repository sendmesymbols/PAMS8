import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
import EngineLogger from '../../../Support/EngineLogger';

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'KeyTerrainIdentificationEngine';
const EARTH_R = 6_371_008.8;
const M_PER_DEG = 111_320;

export type FeatureType = 'dominant_ground' | 'ridge' | 'saddle' | 're_entrant' | 'spur';
type OverlayKey = 'curvature' | 'markers' | 'viewshed';

interface FeatureTypeDef {
  label: string;
  short: string;
  weight: number;
  color: [number, number, number];
  icon: string;
  hexColor: string;
  assessment: (feature: RankedFeature) => string;
}

export interface FeatureCandidate {
  r: number;
  c: number;
  type: FeatureType;
  typeScore: number;
  elev: number;
  prom: number;
  lap: number;
  plan: number;
  prof: number;
}

export interface RankedFeature extends FeatureCandidate {
  lon: number;
  lat: number;
  viewshedRaw: number;
  viewshedPct: number;
  viewshedNorm: number;
  compositeScore: number;
  rank: number;
  depth?: number;
  ridgeBearing?: number;
  /** Set when the feature sits on the reachable road network (controls a movement avenue). */
  controlsRoute?: boolean;
}

export type KeyTerrainFeature = RankedFeature;

export interface KeyTerrainHeadlessOptions {
  center?: Point | { longitude: number; latitude: number };
  extent?: Extent;
  radiusM?: number;
  cellM?: number;
  maxFeatures?: number;
  sensitivity?: number;
  wantHills?: boolean;
  wantSaddles?: boolean;
  wantReents?: boolean;
  wantSpurs?: boolean;
}

interface DetectionOptions {
  sensitivity: number;
  maxFeatures: number;
  wantHills: boolean;
  wantSaddles: boolean;
  wantReents: boolean;
  wantSpurs: boolean;
}

interface GridSample {
  grid: Float32Array;
  sampler: any;
}

interface DetectionResult {
  features: FeatureCandidate[];
  minElev: number;
  maxElev: number;
  relief: number;
}

const FEATURE_TYPES: Record<FeatureType, FeatureTypeDef> = {
  dominant_ground: {
    label: 'Dominant ground',
    short: 'DOMGND',
    weight: 1.0,
    color: [220, 60, 48],
    icon: '▲',
    hexColor: '#DC3C30',
    assessment: (pt) =>
      `Controls ${Math.round(pt.viewshedPct)}% of AO. Seizure gives observation and fires over all lower ground. Must be held or denied.`,
  },
  ridge: {
    label: 'Ridge / crest',
    short: 'RIDGE',
    weight: 0.85,
    color: [239, 159, 39],
    icon: '≡',
    hexColor: '#EF9F27',
    assessment: (pt) =>
      `Linear high ground ${Math.round(pt.elev)}m. Good defensive line - perpendicular to likely axis of advance. Enfilade fires along ${Math.round(pt.ridgeBearing ?? 0)}deg.`,
  },
  saddle: {
    label: 'Saddle / pass',
    short: 'SADDLE',
    weight: 0.9,
    color: [55, 138, 221],
    icon: '⊓',
    hexColor: '#378ADD',
    assessment: (pt) =>
      `Gap in high ground at ${Math.round(pt.elev)}m. Controls movement through the terrain mass. Blocking position here affects all movement in sector.`,
  },
  re_entrant: {
    label: 'Re-entrant / avenue',
    short: 'REENT',
    weight: 0.8,
    color: [29, 158, 117],
    icon: '↓',
    hexColor: '#1D9E75',
    assessment: (pt) =>
      `Concave terrain channel - ${Math.round(pt.depth ?? 0)}m deep. Natural avenue of approach. Enemy dismounts will use this at night. Requires observation or obstacles.`,
  },
  spur: {
    label: 'Spur / finger',
    short: 'SPUR',
    weight: 0.7,
    color: [180, 40, 220],
    icon: '↗',
    hexColor: '#B428DC',
    assessment: (pt) =>
      `Spur extending from high ground at ${Math.round(pt.elev)}m. Flanking fire position. Screens dead ground on both sides of feature.`,
  },
};

function destinationPoint(lon: number, lat: number, bearingDeg: number, distM: number): {
  longitude: number;
  latitude: number;
} {
  const angularDistance = distM / EARTH_R;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
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
  return {
    longitude: (lon2 * 180) / Math.PI,
    latitude: (lat2 * 180) / Math.PI,
  };
}

export class KeyTerrainIdentificationEngine {
  static readonly MARKER_LAYER_ID = 'key-terrain-markers';
  static readonly CENTER_LAYER_ID = 'key-terrain-center';

  private _view: MapView | SceneView | null = null;
  private _markerLayer!: GraphicsLayer;
  private _centerLayer!: GraphicsLayer;
  private _curvatureLayer: MediaLayer | null = null;
  private _viewshedLayer: MediaLayer | null = null;

  private _controlPanelEl: HTMLDivElement | null = null;
  private _listPanelEl: HTMLDivElement | null = null;
  private _clickHandle: any = null;
  private _running = false;
  private _centreSet = false;
  private _picking = false;
  private _hintTimer: number | null = null;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;
  private _subDragCleanup: Array<() => void> = [];

  private _overlayState: Record<OverlayKey, boolean> = {
    curvature: true,
    markers: true,
    viewshed: false,
  };

  constructor() {
    this._createLayers();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._markerLayer.id)) {
      map.addMany([this._centerLayer, this._markerLayer]);
    }
  }

  open(graphic?: Graphic | null, view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    this._ensurePanels();
    this._showPanels();
    this._bindMapClick();
    document.body.classList.add('ms-popup-dark');

    const geom = graphic?.geometry;
    let src: Point | null = null;
    if (geom?.type === 'point') src = geom as Point;
    else if ((geom as any)?.centroid) src = (geom as any).centroid as Point;

    if (src) {
      const latitude = src.latitude ?? src.y;
      const longitude = src.longitude ?? src.x;
      const latInput = this._input('kt-inp-lat');
      const lonInput = this._input('kt-inp-lon');
      if (latInput) latInput.value = latitude.toFixed(4);
      if (lonInput) lonInput.value = longitude.toFixed(4);
      this._setAnalysisCentreMarker(latitude, longitude);
      this._centreSet = true;
    } else {
      // Opened standalone (no symbol). Clear any seeded centre and prompt the
      // user to pick a location — validation in _runAnalysis enforces this.
      this._centreSet = false;
      const latInput = this._input('kt-inp-lat');
      const lonInput = this._input('kt-inp-lon');
      if (latInput) latInput.value = '';
      if (lonInput) lonInput.value = '';
      this._centerLayer.removeAll();
      this._setStatus('ready', 'Pick a location to begin');
      this._beginPicking();
    }
  }

  close(): void {
    this._hidePanels();
    this._unbindMapClick();
    document.body.classList.remove('ms-popup-dark');
    (this._view as any)?.closePopup?.();
    if (this._view?.popup) this._view.popup.visible = false;
    this._onDragEnd();
  }

  destroy(): void {
    this.close();
    this._clearResults();
    this._subDragCleanup.forEach((fn) => fn());
    this._subDragCleanup = [];
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._markerLayer);
      map.remove(this._centerLayer);
      if (this._curvatureLayer) map.remove(this._curvatureLayer);
      if (this._viewshedLayer) map.remove(this._viewshedLayer);
    }
    this._controlPanelEl?.remove();
    this._listPanelEl?.remove();
    this._controlPanelEl = null;
    this._listPanelEl = null;
    this._view = null;
    this._curvatureLayer = null;
    this._viewshedLayer = null;
  }

  public async runHeadless(options: KeyTerrainHeadlessOptions = {}): Promise<KeyTerrainFeature[]> {
    if (!this._view) throw new Error('KeyTerrainIdentificationEngine requires initialize(view) before runHeadless().');
    const center = options.center
      ?? {
        longitude: this._view.center.longitude ?? this._view.center.x,
        latitude: this._view.center.latitude ?? this._view.center.y,
      };
    const centreLon = (center as any).longitude ?? (center as any).x;
    const centreLat = (center as any).latitude ?? (center as any).y;
    const radiusM = options.radiusM ?? 3500;
    const cellM = options.cellM ?? 80;
    const opts: DetectionOptions = {
      sensitivity: options.sensitivity ?? 5,
      maxFeatures: options.maxFeatures ?? 20,
      wantHills: options.wantHills ?? true,
      wantSaddles: options.wantSaddles ?? true,
      wantReents: options.wantReents ?? true,
      wantSpurs: options.wantSpurs ?? true,
    };
    const cosLat = Math.max(0.01, Math.cos((centreLat * Math.PI) / 180));
    const padDeg = (radiusM * 1.05) / M_PER_DEG;
    const extent = options.extent ?? new Extent({
      xmin: centreLon - padDeg / cosLat,
      ymin: centreLat - padDeg,
      xmax: centreLon + padDeg / cosLat,
      ymax: centreLat + padDeg,
      spatialReference: WGS84,
    });
    const cols = Math.max(12, Math.ceil((radiusM * 2) / cellM));
    const rows = Math.max(12, Math.ceil((radiusM * 2) / cellM));
    const { grid, sampler } = await this._sampleGrid(extent, cols, rows);
    let minElev = Infinity;
    let maxElev = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] < minElev) minElev = grid[i];
      if (grid[i] > maxElev) maxElev = grid[i];
    }
    const smooth = this._gaussianSmooth(grid, cols, rows);
    const { laplacian, planCurv, profileCurv } = this._computeCurvature(smooth, cols, rows, cellM);
    const prominenceRadius = Math.max(3, Math.round(radiusM / cellM / 8));
    const prominence = this._computeProminence(smooth, cols, rows, prominenceRadius);
    const { features } = this._detectFeatures(smooth, grid, laplacian, planCurv, profileCurv, prominence, cols, rows, opts);
    const rankedFeatures = features as RankedFeature[];
    for (const feature of rankedFeatures) {
      await this._scoreViewsheds([feature], sampler, extent, cols, rows, cellM, radiusM);
      feature.ridgeBearing = this._estimateRidgeBearing(feature.plan, feature.prof);
    }
    this._scoreFeatures(rankedFeatures, minElev, maxElev);
    await this._enrichFeaturesWithRoads(rankedFeatures, centreLon, centreLat, radiusM);
    return rankedFeatures;
  }

  private _createLayers(): void {
    this._markerLayer = new GraphicsLayer({
      id: KeyTerrainIdentificationEngine.MARKER_LAYER_ID,
      title: 'Key terrain - markers',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._centerLayer = new GraphicsLayer({
      id: KeyTerrainIdentificationEngine.CENTER_LAYER_ID,
      title: 'Key terrain - analysis centre',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    (this._markerLayer as any).popupTemplate = {
      title: '{type}',
      content: '{label}',
    };
  }

  private _ensurePanels(): void {
    if (!this._listPanelEl) {
      const panel = document.createElement('div');
      panel.className = 'ms-panel ms-theme-ops-dark';
      panel.id = 'kt-list-panel';
      panel.innerHTML = `
        <div class="ms-header">
          <div class="ms-header-icon">▲</div>
          <div class="ms-header-title">Key Terrain — Ranked</div>
          <div class="ms-status-lbl" id="kt-list-sub">Run analysis to identify features</div>
          <button class="ms-header-btn ms-btn-round" id="kt-list-close-btn" title="Close">✕</button>
        </div>
        <div class="ms-body" id="kt-feature-list">
          <div class="ms-empty" id="kt-list-empty">
            Set the analysis area in the right panel, then click<br>
            <strong style="color:#EF9F27">Run Analysis</strong><br><br>
            Features are ranked by composite score:<br>
            elevation prominence + viewshed coverage<br>+ tactical type weight
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      this._listPanelEl = panel;
      panel.querySelector('#kt-list-close-btn')?.addEventListener('click', () => this.close());
      this._makeSubDraggable(panel, panel.querySelector<HTMLElement>('.ms-header'));
    }

    if (!this._controlPanelEl) {
      const panel = document.createElement('div');
      panel.className = 'ms-panel ms-theme-ops-dark';
      panel.id = 'kt-ctrl-panel';
      panel.innerHTML = `
        <div class="ms-header" id="kt-drag-handle">
          <div class="ms-header-icon">⛰</div>
          <div class="ms-header-title">Key Terrain Identifier</div>
          <div class="ms-status-dot" id="kt-status-dot"></div>
          <div class="ms-status-lbl" id="kt-status-lbl" style="flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Ready</div>
          <button class="ms-header-btn ms-btn-round" id="kt-help-btn" title="How key terrain analysis works" style="flex-shrink:0">?</button>
          <button class="ms-header-btn ms-btn-round" id="kt-minimize-btn" title="Minimize" style="flex-shrink:0">▼</button>
          <button class="ms-header-btn ms-btn-round" id="kt-close-btn" title="Close (keeps graphics)" style="flex-shrink:0">✕</button>
        </div>
        <div class="ms-help-popover" id="kt-help-popover" hidden>
          <div class="ms-help-head">
            <div>
              <div class="ms-help-kicker">Field Guide</div>
              <div class="ms-help-title">Key Terrain Identifier</div>
            </div>
            <button class="ms-help-close" id="kt-help-close" title="Close">✕</button>
          </div>
          <div class="ms-help-body">
            <p><strong style="color:#EF9F27">What it does.</strong> Detects and ranks tactically significant terrain inside the analysis area by combining elevation prominence, surface curvature (Laplacian + plan/profile), and a 36-ray viewshed score from each candidate.</p>
            <p><strong style="color:#EF9F27">Feature classes.</strong></p>
            <ul style="margin:0 0 9px;padding-left:16px;list-style:none">
              <li><span style="color:#DC3C30">▲ Dominant ground</span> — high points with strong prominence and viewshed; seize / deny.</li>
              <li><span style="color:#EF9F27">≡ Ridge / crest</span> — linear high ground; defensive line, enfilade fires.</li>
              <li><span style="color:#378ADD">⊓ Saddle / pass</span> — gap between high ground; controls movement.</li>
              <li><span style="color:#1D9E75">↓ Re-entrant</span> — concave channel; covered avenue of approach.</li>
              <li><span style="color:#B428DC">↗ Spur / finger</span> — flank position; screens dead ground.</li>
            </ul>
            <p><strong style="color:#EF9F27">Workflow.</strong></p>
            <ol>
              <li>Click map to set analysis centre — yellow marker confirms.</li>
              <li>Pick a radius matching your echelon (2 km pos, 4 km coy, 8 km bn, 15 km bde).</li>
              <li>Grid cell size — smaller = sharper features, slower run.</li>
              <li>Sensitivity drives prominence threshold; raise it to surface subtler features.</li>
              <li>Toggle feature types you care about, then <strong>Run Analysis</strong>.</li>
              <li>Click any ranked card to fly to that feature.</li>
            </ol>
            <p><strong style="color:#EF9F27">Reading the cards.</strong> Score (0-100) = 35% prominence + 40% viewshed + 15% elevation + 10% type weight. Bars show each component normalised across the result set. The top result also drives the optional viewshed overlay.</p>
          </div>
        </div>
        <div class="ms-body">
          <div class="ms-section-title">Analysis area</div>
          <div class="ms-btn-row">
            <button class="ms-btn primary" id="kt-pick-loc" title="Click, then tap the map to set the analysis centre">📍 Pick location on map</button>
          </div>
          <div class="ms-grid">
            <div class="ms-field">
              <div class="ms-label">Centre lat</div>
              <input id="kt-inp-lat" class="ms-input" type="number" value="" step="0.001" placeholder="—" />
            </div>
            <div class="ms-field">
              <div class="ms-label">Centre lon</div>
              <input id="kt-inp-lon" class="ms-input" type="number" value="" step="0.001" placeholder="—" />
            </div>
            <div class="ms-field full">
              <div class="ms-label">Radius (m)</div>
              <select id="kt-inp-radius" class="ms-select">
                <option value="2000">2 km - position-level</option>
                <option value="4000" selected>4 km - company-level</option>
                <option value="8000">8 km - battalion-level</option>
                <option value="15000">15 km - brigade-level</option>
              </select>
            </div>
          </div>
          <div class="ms-section-title">Resolution & sensitivity</div>
          <div class="ms-grid">
            <div class="ms-field full">
              <div class="ms-label">Grid cell size (m)</div>
              <select id="kt-inp-cell" class="ms-select">
                <option value="20">20 m - fine (slower)</option>
                <option value="40" selected>40 m - balanced</option>
                <option value="70">70 m - fast</option>
              </select>
            </div>
          </div>
          <div class="ms-slider-row">
            <div class="ms-slider-label">Peak sensitivity</div>
            <input id="kt-inp-sens" type="range" min="1" max="10" step="1" value="5" />
            <div class="ms-slider-value" id="kt-sens-v">5</div>
          </div>
          <div class="ms-slider-row">
            <div class="ms-slider-label">Max features</div>
            <input id="kt-inp-maxfeat" type="range" min="5" max="30" step="1" value="15" />
            <div class="ms-slider-value" id="kt-maxfeat-v">15</div>
          </div>
          <div class="ms-section-title">Feature types</div>
          <div class="ms-toggle-row"><label>Dominant ground (hilltops)</label><input id="kt-opt-hills" type="checkbox" checked /></div>
          <div class="ms-toggle-row"><label>Saddles / passes</label><input id="kt-opt-saddles" type="checkbox" checked /></div>
          <div class="ms-toggle-row"><label>Re-entrants / avenues</label><input id="kt-opt-reents" type="checkbox" checked /></div>
          <div class="ms-toggle-row"><label>Spurs / flank positions</label><input id="kt-opt-spurs" type="checkbox" checked /></div>
          <div class="ms-divider"></div>
          <div class="ms-section-title">Overlay</div>
          <div class="ms-btn-row">
            <button class="ms-btn primary" data-ov="curvature">Curvature</button>
            <button class="ms-btn primary" data-ov="markers">Markers</button>
            <button class="ms-btn" data-ov="viewshed">Top viewshed</button>
          </div>
          <div class="ms-slider-row">
            <div class="ms-slider-label">Overlay opacity</div>
            <input id="kt-inp-opa" type="range" min="0.2" max="1.0" step="0.05" value="0.65" />
            <div class="ms-slider-value" id="kt-opa-v">0.65</div>
          </div>
          <div class="ms-divider"></div>
          <div class="ms-info-grid">
            <div class="ms-info-item"><div class="ms-info-label">Features found</div><div class="ms-info-value" id="kt-sg-found">-</div></div>
            <div class="ms-info-item"><div class="ms-info-label">Area (km2)</div><div class="ms-info-value" id="kt-sg-area">-</div></div>
            <div class="ms-info-item"><div class="ms-info-label">Highest elev</div><div class="ms-info-value" id="kt-sg-elev">-</div></div>
            <div class="ms-info-item"><div class="ms-info-label">Relief (m)</div><div class="ms-info-value" id="kt-sg-relief">-</div></div>
          </div>
          <div class="ms-progress-wrap">
            <div class="ms-progress-track"><div class="ms-progress-fill" id="kt-prog-fill"></div></div>
            <div class="ms-progress-label" id="kt-prog-label">-</div>
          </div>
          <div class="ms-btn-row">
            <button class="ms-btn" id="kt-btn-clear">Clear</button>
            <button class="ms-btn primary" id="kt-btn-run">Run Analysis ↗</button>
          </div>
          <div class="ms-hint" id="kt-hint" style="display:none">Click map to re-centre the analysis area</div>
        </div>
      `;
      document.body.appendChild(panel);
      this._controlPanelEl = panel;
      this._bindPanelEvents();
      this._makeDraggable();
    }
  }

  private _bindPanelEvents(): void {
    this._controlPanelEl
      ?.querySelectorAll<HTMLButtonElement>('.ms-btn[data-ov]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.ov as OverlayKey;
          this._overlayState[key] = !this._overlayState[key];
          btn.classList.toggle('primary', this._overlayState[key]);
          this._syncOverlayVisibility();
        });
      });

    this._input('kt-inp-sens')?.addEventListener('input', () => {
      const el = this._input('kt-inp-sens');
      const out = this._el('kt-sens-v');
      if (el && out) out.textContent = el.value;
    });
    this._input('kt-inp-maxfeat')?.addEventListener('input', () => {
      const el = this._input('kt-inp-maxfeat');
      const out = this._el('kt-maxfeat-v');
      if (el && out) out.textContent = el.value;
    });
    this._input('kt-inp-opa')?.addEventListener('input', () => {
      const el = this._input('kt-inp-opa');
      const out = this._el('kt-opa-v');
      if (el && out) out.textContent = Number(el.value).toFixed(2);
      this._applyOverlayOpacity();
    });

    this._controlPanelEl?.querySelector('#kt-pick-loc')?.addEventListener('click', () => {
      this._beginPicking();
    });

    this._controlPanelEl?.querySelector('#kt-btn-run')?.addEventListener('click', () => {
      void this._runAnalysis();
    });
    this._controlPanelEl?.querySelector('#kt-btn-clear')?.addEventListener('click', () => {
      this._clearAll();
    });
    this._controlPanelEl?.querySelector('#kt-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = this._controlPanelEl?.querySelector<HTMLElement>('#kt-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    this._controlPanelEl?.querySelector('#kt-help-close')?.addEventListener('click', () => {
      const help = this._controlPanelEl?.querySelector<HTMLElement>('#kt-help-popover');
      if (help) help.hidden = true;
    });
    this._controlPanelEl?.querySelector('#kt-minimize-btn')?.addEventListener('click', () => {
      const body = this._controlPanelEl?.querySelector<HTMLElement>('.ms-body');
      const btn = this._controlPanelEl?.querySelector<HTMLElement>('#kt-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.classList.contains('ms-minimized');
      body.classList.toggle('ms-minimized', !minimized);
      btn.textContent = !minimized ? '▼' : '▶';
    });
    this._controlPanelEl?.querySelector('#kt-close-btn')?.addEventListener('click', () => {
      this.close();
    });
  }

  private _showPanels(): void {
    if (this._listPanelEl) {
      this._listPanelEl.className = 'ms-panel ms-theme-ops-dark';
      this._listPanelEl.setAttribute('data-engine', 'key-terrain');
      this._listPanelEl.style.top = '14px';
      this._listPanelEl.style.left = '14px';
      this._listPanelEl.classList.add('ms-visible');
    }
    if (this._controlPanelEl) {
      this._controlPanelEl.className = 'ms-panel ms-theme-ops-dark';
      this._controlPanelEl.setAttribute('data-engine', 'key-terrain');
      this._controlPanelEl.style.top = '14px';
      this._controlPanelEl.style.right = '14px';
      this._controlPanelEl.classList.add('ms-visible');
    }
    const hint = this._el('kt-hint');
    if (hint) hint.classList.add('ms-visible');
  }

  private _hidePanels(): void {
    if (this._listPanelEl) this._listPanelEl.classList.remove('ms-visible');
    if (this._controlPanelEl) this._controlPanelEl.classList.remove('ms-visible');
  }

  private _bindMapClick(): void {
    if (!this._view || this._clickHandle) return;
    this._clickHandle = this._view.on('click', async (event: any) => {
      if (this._running) return;
      let mapPoint: any = event?.mapPoint ?? null;
      if (!mapPoint && this._view?.type === '3d') {
        try {
          const result: any = await this._view.hitTest(event, {
            include: [(this._view.map as any).ground] as any,
          });
          mapPoint = result?.ground?.mapPoint ?? null;
        } catch {
          mapPoint = null;
        }
      }
      if (!mapPoint && this._view?.toMap && event?.x != null && event?.y != null) {
        mapPoint = this._view.toMap({ x: event.x, y: event.y } as any);
      }
      if (!mapPoint) return;
      const latitude = mapPoint.latitude ?? mapPoint.y;
      const longitude = mapPoint.longitude ?? mapPoint.x;
      const latInput = this._input('kt-inp-lat');
      const lonInput = this._input('kt-inp-lon');
      if (latInput) latInput.value = latitude.toFixed(4);
      if (lonInput) lonInput.value = longitude.toFixed(4);
      this._setAnalysisCentreMarker(latitude, longitude);
      this._centreSet = true;
      this._endPicking();
      this._setStatus('ready', `Centre set ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      this._setProgress(0, 'Analysis centre updated');
    });
  }

  private _unbindMapClick(): void {
    this._clickHandle?.remove?.();
    this._clickHandle = null;
  }

  private async _runAnalysis(): Promise<void> {
    if (!this._view || this._running) return;

    // Validation — a centre must be picked before analysis can run.
    const latRaw = this._input('kt-inp-lat')?.value ?? '';
    const lonRaw = this._input('kt-inp-lon')?.value ?? '';
    const latNum = Number(latRaw);
    const lonNum = Number(lonRaw);
    const hasCentre =
      this._centreSet &&
      latRaw.trim() !== '' &&
      lonRaw.trim() !== '' &&
      Number.isFinite(latNum) &&
      Number.isFinite(lonNum) &&
      Math.abs(latNum) <= 90 &&
      Math.abs(lonNum) <= 180;
    if (!hasCentre) {
      this._setStatus('error', 'No location selected');
      this._flashHint('Pick a location on the map first — use “📍 Pick location on map”.', true);
      this._beginPicking();
      return;
    }

    const runBtn = this._controlPanelEl?.querySelector<HTMLButtonElement>('#kt-btn-run');
    this._running = true;
    if (runBtn) runBtn.disabled = true;

    try {
      const centreLat = Number(this._input('kt-inp-lat')?.value ?? 33.68);
      const centreLon = Number(this._input('kt-inp-lon')?.value ?? 73.06);
      const radiusM = Number(this._select('kt-inp-radius')?.value ?? 4000);
      const cellM = Number(this._select('kt-inp-cell')?.value ?? 40);
      const opacity = Number(this._input('kt-inp-opa')?.value ?? 0.65);
      const maxFeat = Number(this._input('kt-inp-maxfeat')?.value ?? 15);
      const sensitivity = Number(this._input('kt-inp-sens')?.value ?? 5);

      const opts: DetectionOptions = {
        sensitivity,
        maxFeatures: maxFeat,
        wantHills: this._input('kt-opt-hills')?.checked ?? true,
        wantSaddles: this._input('kt-opt-saddles')?.checked ?? true,
        wantReents: this._input('kt-opt-reents')?.checked ?? true,
        wantSpurs: this._input('kt-opt-spurs')?.checked ?? true,
      };

      const cosLat = Math.cos((centreLat * Math.PI) / 180);
      const padDeg = (radiusM * 1.05) / M_PER_DEG;
      const extent = new Extent({
        xmin: centreLon - padDeg / cosLat,
        ymin: centreLat - padDeg,
        xmax: centreLon + padDeg / cosLat,
        ymax: centreLat + padDeg,
        spatialReference: WGS84,
      });

      const cols = Math.ceil((radiusM * 2) / cellM);
      const rows = Math.ceil((radiusM * 2) / cellM);

      this._clearResults();

      this._setStatus('sampling', 'Sampling DEM...');
      this._setProgress(0, 'Downloading elevation tiles');
      const { grid, sampler } = await this._sampleGrid(extent, cols, rows);

      let minElev = Infinity;
      let maxElev = -Infinity;
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] < minElev) minElev = grid[i];
        if (grid[i] > maxElev) maxElev = grid[i];
      }

      this._setProgress(0.15, 'Smoothing elevation surface');
      await this._tick();
      const smooth = this._gaussianSmooth(grid, cols, rows);

      this._setProgress(0.25, 'Computing Laplacian curvature');
      await this._tick();
      const { laplacian, planCurv, profileCurv } = this._computeCurvature(smooth, cols, rows, cellM);

      this._setProgress(0.35, 'Computing topographic prominence');
      await this._tick();
      const prominenceRadius = Math.max(3, Math.round(radiusM / cellM / 8));
      const prominence = this._computeProminence(smooth, cols, rows, prominenceRadius);

      this._setProgress(0.45, 'Detecting terrain features');
      await this._tick();
      const { features, relief } = this._detectFeatures(
        smooth,
        grid,
        laplacian,
        planCurv,
        profileCurv,
        prominence,
        cols,
        rows,
        opts,
      );

      if (features.length === 0) {
        this._setStatus('done', 'No features found - try higher sensitivity');
        const list = this._el('kt-feature-list');
        if (list) {
          list.innerHTML =
            '<div class="ms-empty" id="kt-list-empty">No features detected.<br>Try increasing sensitivity or switching cell size.</div>';
        }
        return;
      }

      this._setStatus('scoring', 'Scoring viewsheds...');
      let scored = 0;
      const rankedFeatures = features as RankedFeature[];
      for (const feature of rankedFeatures) {
        this._setProgress(
          0.5 + 0.35 * (scored / rankedFeatures.length),
          `Viewshed ${scored + 1}/${rankedFeatures.length}: ${FEATURE_TYPES[feature.type].label}`,
        );
        await this._tick();
        await this._scoreViewsheds([feature], sampler, extent, cols, rows, cellM, radiusM);
        feature.ridgeBearing = this._estimateRidgeBearing(feature.plan, feature.prof);
        scored++;
      }

      this._setProgress(0.87, 'Ranking features');
      await this._tick();
      this._scoreFeatures(rankedFeatures, minElev, maxElev);

      this._setProgress(0.88, 'Checking road control');
      await this._enrichFeaturesWithRoads(rankedFeatures, centreLon, centreLat, radiusM);

      if (this._overlayState.curvature) {
        this._setProgress(0.9, 'Building curvature overlay');
        await this._tick();
        this._curvatureLayer = this._buildCurvatureHeatmap(laplacian, cols, rows, extent, opacity);
        (this._view.map as any).add(this._curvatureLayer);
      }

      this._setProgress(0.93, 'Placing markers');
      await this._tick();
      this._markerLayer.addMany(this._buildFeatureMarkers(rankedFeatures));

      if (this._overlayState.viewshed && rankedFeatures.length > 0) {
        this._setProgress(0.95, 'Computing top feature viewshed');
        await this._tick();
        this._viewshedLayer = this._buildTopViewshedGraphic(
          rankedFeatures[0],
          extent,
          cols,
          rows,
          grid,
          sampler,
          cellM,
        );
        (this._view.map as any).add(this._viewshedLayer);
      }

      this._setProgress(0.98, 'Rendering ranked list');
      this._renderFeatureList(rankedFeatures, minElev, maxElev);

      this._setText('kt-sg-found', String(rankedFeatures.length));
      this._setText('kt-sg-area', `${(Math.PI * (radiusM / 1000) ** 2).toFixed(1)} km2`);
      this._setText('kt-sg-elev', `${Math.round(maxElev)} m`);
      this._setText('kt-sg-relief', `${Math.round(relief)} m`);

      this._setProgress(1, `Done - ${rankedFeatures.length} features identified`);
      this._setStatus('done', 'Done');
      this._syncOverlayVisibility();
      this._applyOverlayOpacity();

      await this._view.goTo({ target: extent, ...(this._view.type === '3d' ? { tilt: 55 } : {}) } as any, {
        duration: 1200,
      });

      window.setTimeout(() => {
        const first = this._listPanelEl?.querySelector<HTMLElement>('.kt-fc');
        first?.click();
      }, 1400);
    } catch (error) {
      console.error('[KeyTerrain] Analysis failed', error);
      this._setStatus('done', 'Analysis failed');
      this._setProgress(0, 'Error');
    } finally {
      this._running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  private async _sampleGrid(extent: Extent, cols: number, rows: number): Promise<GridSample> {
    const sampler = await (this._view!.map as any).ground.createElevationSampler(extent, { noDataValue: 0 });
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const grid = new Float32Array(cols * rows);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lon = extent.xmin + (c + 0.5) * dLon;
        const lat = extent.ymax - (r + 0.5) * dLat;
        const z =
          sampler.queryElevation(
            new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 }),
          )?.z ?? 0;
        grid[r * cols + c] = z;
      }
    }
    return { grid, sampler };
  }

  private _gaussianSmooth(grid: Float32Array, cols: number, rows: number): Float32Array {
    const kernel = [
      0.003, 0.013, 0.022, 0.013, 0.003,
      0.013, 0.059, 0.097, 0.059, 0.013,
      0.022, 0.097, 0.159, 0.097, 0.022,
      0.013, 0.059, 0.097, 0.059, 0.013,
      0.003, 0.013, 0.022, 0.013, 0.003,
    ];
    const smooth = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let value = 0;
        let weight = 0;
        for (let kr = -2; kr <= 2; kr++) {
          for (let kc = -2; kc <= 2; kc++) {
            const rr = r + kr;
            const cc = c + kc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            const ki = (kr + 2) * 5 + (kc + 2);
            value += kernel[ki] * grid[rr * cols + cc];
            weight += kernel[ki];
          }
        }
        smooth[r * cols + c] = weight > 0 ? value / weight : grid[r * cols + c];
      }
    }
    return smooth;
  }

  private _computeCurvature(
    smooth: Float32Array,
    cols: number,
    rows: number,
    cellM: number,
  ): { laplacian: Float32Array; planCurv: Float32Array; profileCurv: Float32Array } {
    const h2 = cellM * cellM;
    const laplacian = new Float32Array(cols * rows);
    const planCurv = new Float32Array(cols * rows);
    const profileCurv = new Float32Array(cols * rows);

    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const i = r * cols + c;
        const fN = smooth[(r - 1) * cols + c];
        const fS = smooth[(r + 1) * cols + c];
        const fE = smooth[r * cols + c + 1];
        const fW = smooth[r * cols + c - 1];
        const fC = smooth[i];
        const fNE = smooth[(r - 1) * cols + c + 1];
        const fNW = smooth[(r - 1) * cols + c - 1];
        const fSE = smooth[(r + 1) * cols + c + 1];
        const fSW = smooth[(r + 1) * cols + c - 1];

        laplacian[i] = (fN + fS + fE + fW - 4 * fC) / h2;

        const dZdx = (fE - fW) / (2 * cellM);
        const dZdy = (fN - fS) / (2 * cellM);
        const slope2 = dZdx * dZdx + dZdy * dZdy;

        const d2Zdx2 = (fE + fW - 2 * fC) / h2;
        const d2Zdy2 = (fN + fS - 2 * fC) / h2;
        const d2Zdxy = (fNE - fNW - fSE + fSW) / (4 * h2);

        if (slope2 > 1e-8) {
          planCurv[i] =
            -(
              dZdx * dZdx * d2Zdy2 -
              2 * dZdx * dZdy * d2Zdxy +
              dZdy * dZdy * d2Zdx2
            ) / Math.pow(slope2, 1.5);
          profileCurv[i] =
            -(
              dZdx * dZdx * d2Zdx2 +
              2 * dZdx * dZdy * d2Zdxy +
              dZdy * dZdy * d2Zdy2
            ) /
            (slope2 * Math.sqrt(1 + slope2));
        }
      }
    }

    return { laplacian, planCurv, profileCurv };
  }

  private _computeProminence(
    grid: Float32Array,
    cols: number,
    rows: number,
    radiusCells: number,
  ): Float32Array {
    const prominence = new Float32Array(cols * rows);
    const rc = Math.max(2, Math.round(radiusCells));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const elev = grid[r * cols + c];
        let minSurr = Infinity;

        for (let dr = -rc; dr <= rc; dr++) {
          for (let dc = -rc; dc <= rc; dc++) {
            const dist = Math.sqrt(dr * dr + dc * dc);
            if (dist < rc * 0.5 || dist > rc) continue;
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            const v = grid[rr * cols + cc];
            if (v < minSurr) minSurr = v;
          }
        }
        prominence[r * cols + c] = minSurr < Infinity ? elev - minSurr : 0;
      }
    }

    return prominence;
  }

  private _detectFeatures(
    smooth: Float32Array,
    grid: Float32Array,
    laplacian: Float32Array,
    planCurv: Float32Array,
    profileCurv: Float32Array,
    prominence: Float32Array,
    cols: number,
    rows: number,
    opts: DetectionOptions,
  ): DetectionResult {
    const { sensitivity, maxFeatures, wantHills, wantSaddles, wantReents, wantSpurs } = opts;
    const suppRadius = Math.max(3, Math.round((8 / sensitivity) * 3));
    const features: FeatureCandidate[] = [];
    const suppressed = new Uint8Array(cols * rows);

    const isSuppressed = (r: number, c: number) => suppressed[r * cols + c] === 1;
    const suppress = (r: number, c: number, radius: number) => {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.sqrt(dr * dr + dc * dc) > radius) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) suppressed[rr * cols + cc] = 1;
        }
      }
    };

    let maxProm = 0;
    let minElev = Infinity;
    let maxElev = -Infinity;
    for (let i = 0; i < cols * rows; i++) {
      if (prominence[i] > maxProm) maxProm = prominence[i];
      if (grid[i] < minElev) minElev = grid[i];
      if (grid[i] > maxElev) maxElev = grid[i];
    }
    const relief = maxElev - minElev || 1;
    const promThresh = maxProm * ((0.12 / sensitivity) * 5);
    const candidates: FeatureCandidate[] = [];

    for (let r = suppRadius; r < rows - suppRadius; r++) {
      for (let c = suppRadius; c < cols - suppRadius; c++) {
        const i = r * cols + c;
        const elev = smooth[i];
        const prom = prominence[i];
        const lap = laplacian[i];
        const plan = planCurv[i];
        const prof = profileCurv[i];

        if (prom < promThresh) continue;

        let isLocalMax = true;
        for (let dr = -2; dr <= 2 && isLocalMax; dr++) {
          for (let dc = -2; dc <= 2 && isLocalMax; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (smooth[(r + dr) * cols + (c + dc)] > elev) isLocalMax = false;
          }
        }

        let isLocalMin = true;
        for (let dr = -2; dr <= 2 && isLocalMin; dr++) {
          for (let dc = -2; dc <= 2 && isLocalMin; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (smooth[(r + dr) * cols + (c + dc)] < elev) isLocalMin = false;
          }
        }

        let type: FeatureType | null = null;
        let typeScore = 0;

        if (isLocalMax && wantHills) {
          const absElev = (elev - minElev) / relief;
          const absProm = prom / (maxProm || 1);
          const planAbs = Math.abs(plan);

          if (absElev > 0.6 && absProm > 0.4) {
            type = 'dominant_ground';
            typeScore = absElev * 0.5 + absProm * 0.5;
          } else if (planAbs > 0.001 && absProm > 0.25 && wantSpurs) {
            type = plan > 0 ? 'ridge' : 'spur';
            typeScore = absProm * 0.6 + ((elev - minElev) / relief) * 0.4;
          } else if (wantSpurs) {
            type = 'spur';
            typeScore = absProm * 0.5 + ((elev - minElev) / relief) * 0.5;
          }
        }

        if (!type && wantSaddles) {
          const minN = smooth[(r - 1) * cols + c];
          const minS = smooth[(r + 1) * cols + c];
          const minE = smooth[r * cols + c + 1];
          const minW = smooth[r * cols + c - 1];
          const isMinNS = elev < minN && elev < minS;
          const isMinEW = elev < minE && elev < minW;
          const isMaxNS = elev > minN && elev > minS;
          const isMaxEW = elev > minE && elev > minW;

          if ((isMinNS && isMaxEW) || (isMinEW && isMaxNS)) {
            type = 'saddle';
            typeScore = 0.5 + ((elev - minElev) / relief) * 0.5;
          }
        }

        if (!type && isLocalMin && lap < -0.0005 && wantReents) {
          type = 're_entrant';
          typeScore = 0.3 + (prom / Math.max(1, maxProm)) * 0.4;
        }

        if (type) {
          candidates.push({ r, c, type, typeScore, elev, prom, lap, plan, prof });
        }
      }
    }

    candidates.sort((a, b) => {
      const scoreA = a.typeScore * (FEATURE_TYPES[a.type]?.weight ?? 0.5);
      const scoreB = b.typeScore * (FEATURE_TYPES[b.type]?.weight ?? 0.5);
      return scoreB - scoreA;
    });

    for (const candidate of candidates) {
      if (features.length >= maxFeatures) break;
      if (isSuppressed(candidate.r, candidate.c)) continue;
      features.push(candidate);
      suppress(candidate.r, candidate.c, suppRadius);
    }

    return { features, minElev, maxElev, relief };
  }

  private async _scoreViewsheds(
    features: RankedFeature[],
    sampler: any,
    extent: Extent,
    cols: number,
    rows: number,
    cellM: number,
    radiusM: number,
  ): Promise<void> {
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const numRays = 36;
    const stepM = Math.max(cellM, 40);
    const numSteps = Math.ceil(radiusM / stepM);

    for (const feat of features) {
      const lon = extent.xmin + (feat.c + 0.5) * dLon;
      const lat = extent.ymax - (feat.r + 0.5) * dLat;
      const obsZ = feat.elev + 1.5;

      let visible = 0;
      let total = 0;

      for (let ri = 0; ri < numRays; ri++) {
        const bearing = (ri / numRays) * 360;
        let maxSlopeDeg = -90;

        for (let s = 1; s <= numSteps; s++) {
          const dist = s * stepM;
          const { longitude, latitude } = destinationPoint(lon, lat, bearing, dist);
          const pt = new Point({ longitude, latitude, spatialReference: WGS84 });
          const z = sampler.queryElevation(pt)?.z ?? 0;
          const slope = (Math.atan2(z - obsZ, dist) * 180) / Math.PI;
          total++;
          if (slope >= maxSlopeDeg) {
            visible++;
            maxSlopeDeg = slope;
          }
        }
      }

      feat.lon = lon;
      feat.lat = lat;
      feat.viewshedRaw = total > 0 ? visible / total : 0;
      feat.viewshedPct = Math.round(feat.viewshedRaw * 100);
      if (feat.type === 're_entrant') feat.depth = Math.abs(feat.prom);
    }

    const maxVs = Math.max(0.01, ...features.map((f) => f.viewshedRaw));
    features.forEach((f) => {
      f.viewshedNorm = f.viewshedRaw / maxVs;
    });
  }

  private _scoreFeatures(features: RankedFeature[], minElev: number, maxElev: number): void {
    const maxProm = Math.max(1, ...features.map((f) => f.prom));
    const relief = Math.max(1, maxElev - minElev);

    features.forEach((feature) => {
      const promScore = feature.prom / maxProm;
      const vsScore = feature.viewshedNorm;
      const elevScore = (feature.elev - minElev) / relief;
      const typeWeight = FEATURE_TYPES[feature.type]?.weight ?? 0.5;

      feature.compositeScore = Math.round(
        100 * (promScore * 0.35 + vsScore * 0.4 + elevScore * 0.15 + typeWeight * 0.1),
      );
    });

    features.sort((a, b) => b.compositeScore - a.compositeScore);
    features.forEach((feature, index) => {
      feature.rank = index + 1;
    });
  }

  private _buildCurvatureHeatmap(
    laplacian: Float32Array,
    cols: number,
    rows: number,
    extent: Extent,
    opacity: number,
  ): MediaLayer {
    let maxAbs = 0;
    for (let i = 0; i < laplacian.length; i++) {
      if (Math.abs(laplacian[i]) > maxAbs) maxAbs = Math.abs(laplacian[i]);
    }
    maxAbs ||= 1;

    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return new MediaLayer({ title: 'Terrain curvature' });
    }
    const imgData = ctx.createImageData(cols, rows);

    for (let i = 0; i < cols * rows; i++) {
      const t = laplacian[i] / maxAbs;
      const px = i * 4;
      if (Math.abs(t) < 0.05) {
        imgData.data[px + 3] = 0;
        continue;
      }
      if (t > 0) {
        const tt = Math.min(1, t * 3);
        imgData.data[px] = Math.round(220 - tt * 40);
        imgData.data[px + 1] = Math.round(60 - tt * 40);
        imgData.data[px + 2] = Math.round(48 - tt * 30);
      } else {
        const tt = Math.min(1, -t * 3);
        imgData.data[px] = Math.round(24 + tt * 31);
        imgData.data[px + 1] = Math.round(95 + tt * 43);
        imgData.data[px + 2] = Math.round(165 + tt * 56);
      }
      // Bake only per-pixel intensity here; the user-facing opacity is applied
      // live via the MediaLayer.opacity property so the slider can adjust it
      // without rebuilding the raster (and without double-applying).
      imgData.data[px + 3] = Math.round(200 * Math.min(1, Math.abs(t) * 4));
    }

    ctx.putImageData(imgData, 0, 0);
    return new MediaLayer({
      source: [
        new ImageElement({
          image: canvas.toDataURL('image/png'),
          georeference: new ExtentAndRotationGeoreference({ extent }),
        }),
      ],
      title: 'Terrain curvature',
      opacity,
    });
  }

  private _buildFeatureMarkers(features: RankedFeature[]): Graphic[] {
    return features.flatMap((feature) => {
      const ft = FEATURE_TYPES[feature.type];
      const [r, g, b] = ft.color;
      const point = new Point({
        longitude: feature.lon,
        latitude: feature.lat,
        spatialReference: WGS84,
      });

      const marker = new Graphic({
        geometry: point,
        symbol:
          this._view?.type === '3d'
            ? ({
                type: 'point-3d',
                symbolLayers: [
                  {
                    type: 'object',
                    resource: {
                      primitive:
                        feature.type === 'saddle'
                          ? 'cylinder'
                          : feature.type === 're_entrant'
                            ? 'diamond'
                            : 'sphere',
                    },
                    material: { color: [r, g, b, 0.95] },
                    width: feature.rank === 1 ? 120 : 80,
                    height: feature.rank === 1 ? 120 : 80,
                    depth: feature.rank === 1 ? 120 : 80,
                  },
                ],
                verticalOffset: {
                  screenLength: feature.rank === 1 ? 36 : 24,
                  maxWorldLength: 2000,
                  minWorldLength: 8,
                },
              } as any)
            : ({
                type: 'simple-marker',
                style:
                  feature.type === 'saddle'
                    ? 'square'
                    : feature.type === 're_entrant'
                      ? 'diamond'
                      : 'circle',
                color: [r, g, b, 0.95],
                size: feature.rank === 1 ? 16 : 12,
                outline: { color: [255, 255, 255, 0.9], width: 1.2 },
              } as any),
        attributes: {
          type: `#${feature.rank} - ${ft.label}`,
          label: `Score: ${feature.compositeScore} | Elev: ${Math.round(feature.elev)}m | Viewshed: ${feature.viewshedPct}%`,
          rank: feature.rank,
          feat: feature.type,
        },
      });

      const label = new Graphic({
        geometry: point,
        symbol: {
          type: 'text',
          text: String(feature.rank),
          color: [255, 255, 255, 255],
          haloColor: [r, g, b, 255],
          haloSize: 2.5,
          font: { family: 'Courier New', size: 11, weight: 'bold' },
          horizontalAlignment: 'center',
          verticalAlignment: 'middle',
          yoffset: feature.rank === 1 ? 24 : 16,
        } as any,
        attributes: { type: 'rank_label', rank: feature.rank },
      });

      return [marker, label];
    });
  }

  private _buildTopViewshedGraphic(
    topFeature: RankedFeature,
    extent: Extent,
    cols: number,
    rows: number,
    grid: Float32Array,
    sampler: any,
    cellM: number,
  ): MediaLayer {
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const step = Math.max(cellM, 40);
    const obsZ = topFeature.elev + 1.5;
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return new MediaLayer({ title: 'Top feature viewshed', opacity: 0.7 });
    }
    const imgD = ctx.createImageData(cols, rows);

    const horizons: Record<number, number> = {};
    for (let deg = 0; deg < 360; deg += 2) {
      let maxSlope = -90;
      for (let dist = step; dist <= 12_000; dist += step) {
        const { longitude, latitude } = destinationPoint(topFeature.lon, topFeature.lat, deg, dist);
        const z =
          sampler.queryElevation(new Point({ longitude, latitude, spatialReference: WGS84 }))?.z ?? 0;
        const slope = (Math.atan2(z - obsZ, dist) * 180) / Math.PI;
        if (slope > maxSlope) maxSlope = slope;
      }
      horizons[deg] = maxSlope;
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const lon = extent.xmin + (col + 0.5) * dLon;
        const lat = extent.ymax - (row + 0.5) * dLat;
        const east = (lon - topFeature.lon) * M_PER_DEG * Math.cos((topFeature.lat * Math.PI) / 180);
        const north = (lat - topFeature.lat) * M_PER_DEG;
        const dist = Math.sqrt(east * east + north * north);
        if (dist < 5 || dist > 12_000) continue;
        const bearing = (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360;
        const bKey = (Math.round(bearing / 2) * 2) % 360;
        const terrainZ = grid[row * cols + col];
        const slope = (Math.atan2(terrainZ - obsZ, dist) * 180) / Math.PI;
        const px = (row * cols + col) * 4;
        if (slope >= (horizons[bKey] ?? -90)) {
          imgD.data[px] = 29;
          imgD.data[px + 1] = 158;
          imgD.data[px + 2] = 117;
          imgD.data[px + 3] = 70;
        }
      }
    }
    ctx.putImageData(imgD, 0, 0);

    return new MediaLayer({
      source: [
        new ImageElement({
          image: canvas.toDataURL('image/png'),
          georeference: new ExtentAndRotationGeoreference({ extent }),
        }),
      ],
      title: 'Top feature viewshed',
      opacity: this._currentOpacity(),
    });
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

  private _haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = ((lat2 - lat1) * Math.PI) / 180;
    const dl = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(a));
  }

  /**
   * Opportunistically promote terrain that controls movement. Pulls a drive-time
   * service area from the AO centre off the optional road service and boosts the
   * composite score of passes / avenues / dominant ground / ridges that sit on
   * the reachable road network — terrain that commands a road is more "key".
   * Re-sorts and re-ranks when anything was boosted.
   *
   * Fully degradable: a missing/down service is a no-op and the pure-terrain
   * ranking stands. Never throws.
   */
  private async _enrichFeaturesWithRoads(
    features: RankedFeature[],
    centreLon: number,
    centreLat: number,
    radiusM: number,
  ): Promise<void> {
    const rn = this._roadNet();
    if (!rn || features.length === 0) return;
    let available = false;
    try {
      available = await rn.ensureAvailable();
    } catch {
      available = false;
    }
    if (!available) return;

    // Drive time chosen so the isochrone roughly spans the AO (~40 km/h road avg, +10 min slack).
    const minutes = Math.max(5, Math.min(60, Math.round(((radiusM / 1000) / 40) * 60) + 10));
    let res: any = null;
    try {
      res = await rn.serviceArea({ longitude: centreLon, latitude: centreLat }, minutes);
    } catch {
      res = { ok: false };
    }
    if (!res?.ok || !res.data?.geometry) return;
    const roadCoords = this._flattenLineCoords(res.data.geometry);
    if (roadCoords.length < 2) return;

    const NEAR_M = 250;
    let boosted = 0;
    for (const f of features) {
      if (f.type !== 'saddle' && f.type !== 're_entrant' && f.type !== 'dominant_ground' && f.type !== 'ridge') {
        continue;
      }
      let near = false;
      for (const [lon, lat] of roadCoords) {
        if (this._haversineM(f.lon, f.lat, lon, lat) <= NEAR_M) {
          near = true;
          break;
        }
      }
      if (near) {
        f.controlsRoute = true;
        f.compositeScore = Math.min(100, Math.round(f.compositeScore * 1.15));
        boosted++;
      }
    }

    if (boosted > 0) {
      features.sort((a, b) => b.compositeScore - a.compositeScore);
      features.forEach((f, i) => {
        f.rank = i + 1;
      });
      EngineLogger.success(ENGINE_NAME, `Key terrain: ${boosted} feature(s) control the reachable road network.`);
    }
  }

  private _renderFeatureList(features: RankedFeature[], minElev: number, maxElev: number): void {
    const list = this._el('kt-feature-list');
    if (!list) return;
    list.innerHTML = '';
    const relief = Math.max(1, maxElev - minElev);
    const maxProm = Math.max(1, ...features.map((f) => f.prom));

    this._setText('kt-list-sub', `${features.length} features ranked by tactical value`);

    features.forEach((feature) => {
      const ft = FEATURE_TYPES[feature.type];
      const card = document.createElement('div');
      card.className = 'ms-feature-card';
      card.dataset.rank = String(feature.rank);

      const promPct = Math.round((feature.prom / maxProm) * 100);
      const elevPct = Math.round(((feature.elev - minElev) / relief) * 100);

      card.innerHTML = `
        <div class="ms-feature-score" style="color:${ft.hexColor}">${feature.compositeScore}</div>
        <div class="ms-feature-top">
          <div class="ms-feature-rank" style="background:${ft.hexColor}22;color:${ft.hexColor};border:1px solid ${ft.hexColor}55">
            ${feature.rank}
          </div>
          <div>
            <div class="ms-feature-name">${ft.icon} ${ft.label}</div>
            <div class="ms-feature-type">${Math.round(feature.elev)} m MSL &nbsp;&middot;&nbsp; ${feature.viewshedPct}% visible</div>
          </div>
        </div>
        <div class="ms-feature-bars">
          <div class="ms-feature-bar">
            <div class="ms-feature-bar-label">Prominence</div>
            <div class="ms-feature-bar-track"><div class="ms-feature-bar-fill" style="width:${promPct}%;background:${ft.hexColor}"></div></div>
            <div class="ms-feature-bar-val">${Math.round(feature.prom)}m</div>
          </div>
          <div class="ms-feature-bar">
            <div class="ms-feature-bar-label">Viewshed</div>
            <div class="ms-feature-bar-track"><div class="ms-feature-bar-fill" style="width:${feature.viewshedPct}%;background:#378ADD"></div></div>
            <div class="ms-feature-bar-val">${feature.viewshedPct}%</div>
          </div>
          <div class="ms-feature-bar">
            <div class="ms-feature-bar-label">Elevation</div>
            <div class="ms-feature-bar-track"><div class="ms-feature-bar-fill" style="width:${elevPct}%;background:#1D9E75"></div></div>
            <div class="ms-feature-bar-val">${Math.round(feature.elev)}m</div>
          </div>
        </div>
        <div class="ms-feature-assessment">${ft.assessment(feature)}${feature.controlsRoute ? ' <strong style="color:#EF9F27">Controls a road avenue — high mobility value.</strong>' : ''}</div>
      `;

      card.addEventListener('click', () => {
        this._listPanelEl?.querySelectorAll('.ms-feature-card').forEach((el) => el.classList.remove('selected'));
        card.classList.add('selected');
        void this._view?.goTo(
          {
            center: [feature.lon, feature.lat],
            zoom: 14,
            ...(this._view?.type === '3d' ? { tilt: 60 } : {}),
          } as any,
          { duration: 900 },
        );
      });

      list.appendChild(card);
    });
  }

  private _estimateRidgeBearing(plan: number, profile: number): number {
    const angle = (Math.atan2(profile, plan || 0.0001) * 180) / Math.PI;
    return (Math.round(angle) + 360) % 360;
  }

  private _syncOverlayVisibility(): void {
    this._markerLayer.visible = this._overlayState.markers;
    if (this._curvatureLayer) this._curvatureLayer.visible = this._overlayState.curvature;
    if (this._viewshedLayer) this._viewshedLayer.visible = this._overlayState.viewshed;
  }

  /** Current value of the overlay-opacity slider (falls back to the default). */
  private _currentOpacity(): number {
    return Number(this._input('kt-inp-opa')?.value ?? 0.65);
  }

  /** Apply the slider opacity to every overlay layer live (no rebuild needed). */
  private _applyOverlayOpacity(): void {
    const o = this._currentOpacity();
    if (this._curvatureLayer) this._curvatureLayer.opacity = o;
    if (this._viewshedLayer) this._viewshedLayer.opacity = o;
    if (this._markerLayer) this._markerLayer.opacity = o;
  }

  private _clearResults(): void {
    this._markerLayer.removeAll();
    const map = this._view?.map as any;
    if (this._curvatureLayer && map) map.remove(this._curvatureLayer);
    if (this._viewshedLayer && map) map.remove(this._viewshedLayer);
    this._curvatureLayer = null;
    this._viewshedLayer = null;
  }

  private _clearAll(): void {
    this._clearResults();
    this._centerLayer.removeAll();
    this._centreSet = false;
    const latInput = this._input('kt-inp-lat');
    const lonInput = this._input('kt-inp-lon');
    if (latInput) latInput.value = '';
    if (lonInput) lonInput.value = '';
    const list = this._el('kt-feature-list');
    if (list) {
      list.innerHTML =
        '<div class="ms-empty" id="kt-list-empty">Run analysis to identify features</div>';
    }
    this._setText('kt-list-sub', 'Run analysis to identify features');
    ['kt-sg-found', 'kt-sg-area', 'kt-sg-elev', 'kt-sg-relief'].forEach((id) => this._setText(id, '-'));
    this._setProgress(0, '-');
    this._setStatus('ready', 'Pick a location to begin');
    this._syncOverlayVisibility();
    this._beginPicking();
  }

  private _setAnalysisCentreMarker(latitude: number, longitude: number): void {
    this._centerLayer.removeAll();
    const point = new Point({ latitude, longitude, spatialReference: WGS84 });
    this._centerLayer.add(
      new Graphic({
        geometry: point,
        symbol: {
          type: 'simple-marker',
          style: 'circle',
          size: 11,
          color: [239, 159, 39, 0.95],
          outline: { color: [7, 8, 9, 0.95], width: 1.8 },
        } as any,
        attributes: {
          type: 'Analysis centre',
          label: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        },
        popupTemplate: {
          title: 'Analysis centre',
          content: '{label}',
        },
      }),
    );
  }

  private _makeDraggable(): void {
    const handle = this._controlPanelEl?.querySelector<HTMLElement>('#kt-drag-handle');
    if (!handle || !this._controlPanelEl) return;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this._isDragging = true;
      const rect = this._controlPanelEl!.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    });
  }

  private _onDragMove = (e: MouseEvent): void => {
    if (!this._isDragging || !this._controlPanelEl) return;
    const maxLeft = Math.max(8, window.innerWidth - 396);
    const maxTop = Math.max(8, window.innerHeight - 120);
    const left = Math.min(maxLeft, Math.max(8, e.clientX - this._dragOffsetX));
    const top = Math.min(maxTop, Math.max(8, e.clientY - this._dragOffsetY));
    this._controlPanelEl.style.left = `${left}px`;
    this._controlPanelEl.style.top = `${top}px`;
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
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - 80);
      panel.style.left = `${Math.min(maxLeft, Math.max(8, e.clientX - ox))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(8, e.clientY - oy))}px`;
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

  /** Enter "pick a centre on the map" mode — highlight the button and flash a hint. */
  private _beginPicking(): void {
    this._picking = true;
    const btn = this._el('kt-pick-loc');
    if (btn) {
      btn.classList.add('primary');
      btn.textContent = '📍 Click the map to set centre…';
    }
    this._flashHint('Click anywhere on the map to set the analysis centre.', false, 0);
  }

  /** Leave picking mode — restore the button label and clear the hint. */
  private _endPicking(): void {
    this._picking = false;
    const btn = this._el('kt-pick-loc');
    if (btn) btn.textContent = '📍 Pick location on map';
    this._flashHint('', false, 1);
  }

  /**
   * Show a transient tip in the panel's hint slot. `isError` styles it as a
   * warning; `autoHideMs` (default 4000) auto-clears it — pass 0 to keep it
   * visible until the next call, or pass a tiny value to hide immediately.
   */
  private _flashHint(message: string, isError = false, autoHideMs = 4000): void {
    const hint = this._el('kt-hint');
    if (!hint) return;
    if (this._hintTimer != null) {
      window.clearTimeout(this._hintTimer);
      this._hintTimer = null;
    }
    if (!message) {
      hint.style.display = 'none';
      return;
    }
    hint.textContent = message;
    hint.style.display = 'block';
    hint.style.fontStyle = isError ? 'normal' : 'italic';
    hint.style.color = isError ? 'var(--ms-danger, #dc5050)' : 'var(--ms-text-dim)';
    if (autoHideMs > 0) {
      this._hintTimer = window.setTimeout(() => {
        hint.style.display = 'none';
        this._hintTimer = null;
      }, autoHideMs);
    }
  }

  private _setStatus(statusClass: string, text: string): void {
    if (statusClass === 'done') EngineLogger.success(ENGINE_NAME, text);
    else if (statusClass === 'sampling' || statusClass === 'scoring' || statusClass === 'ready') EngineLogger.nextStep(ENGINE_NAME, text);
    else EngineLogger.error(ENGINE_NAME, text);
    const dot = this._el('kt-status-dot');
    const lbl = this._el('kt-status-lbl');
    if (lbl) lbl.textContent = text;
    if (dot) {
      if (statusClass === 'done' || statusClass === 'ready') {
        dot.style.background = 'var(--ms-success)';
        dot.style.boxShadow = '0 0 6px var(--ms-success)';
      } else if (statusClass === 'sampling' || statusClass === 'scoring') {
        dot.style.background = 'var(--ms-accent)';
        dot.style.boxShadow = '0 0 6px var(--ms-accent)';
      } else {
        dot.style.background = 'var(--ms-danger, #dc5050)';
        dot.style.boxShadow = '0 0 6px var(--ms-danger, #dc5050)';
      }
    }
  }

  private _setProgress(fraction: number, label: string): void {
    const fill = this._el('kt-prog-fill');
    const text = this._el('kt-prog-label');
    if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;
    if (text) text.textContent = label;
  }

  private _tick(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  private _el(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  private _input(id: string): HTMLInputElement | null {
    return document.getElementById(id) as HTMLInputElement | null;
  }

  private _select(id: string): HTMLSelectElement | null {
    return document.getElementById(id) as HTMLSelectElement | null;
  }

  private _setText(id: string, text: string): void {
    const el = this._el(id);
    if (el) el.textContent = text;
  }
}

export default KeyTerrainIdentificationEngine;


