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
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

  private _overlayState: Record<OverlayKey, boolean> = {
    curvature: true,
    markers: true,
    viewshed: false,
  };

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._markerLayer.id)) {
      map.addMany([this._centerLayer, this._markerLayer]);
    }
  }

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    this._ensurePanels();
    this._showPanels();
    this._bindMapClick();

    const geom = graphic.geometry;
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
    }
  }

  close(): void {
    this._hidePanels();
    this._unbindMapClick();
    this._onDragEnd();
  }

  destroy(): void {
    this.close();
    this._clearResults();
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
      panel.className = 'kt-list-panel kt-panel';
      panel.innerHTML = `
        <div class="kt-lph">
          <div class="kt-lph-title">▲ Key Terrain - Ranked</div>
          <div class="kt-lph-sub" id="kt-list-sub">Run analysis to identify features</div>
        </div>
        <div class="kt-feature-list" id="kt-feature-list">
          <div class="kt-list-empty" id="kt-list-empty">
            Set the analysis area in the right panel, then click<br>
            <strong style="color:#EF9F27">Run Analysis</strong><br><br>
            Features are ranked by composite score:<br>
            elevation prominence + viewshed coverage<br>+ tactical type weight
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      this._listPanelEl = panel;
    }

    if (!this._controlPanelEl) {
      const panel = document.createElement('div');
      panel.className = 'kt-ctrl-panel kt-panel';
      panel.innerHTML = `
        <div class="kt-ph" id="kt-drag-handle">
          <div class="kt-ph-title-wrap">
            <div class="kt-ph-title">□ Key Terrain Identifier</div>
            <div class="kt-ph-status ready" id="kt-status">Ready</div>
          </div>
          <div class="kt-ph-actions">
            <button class="kt-help-btn" id="kt-help-btn" title="How key terrain analysis works">?</button>
            <button class="kt-minimize-btn" id="kt-minimize-btn" title="Minimize">▼</button>
            <button class="kt-close-btn" id="kt-close-btn" title="Close (keeps graphics)">✕</button>
          </div>
        </div>
        <div class="kt-help-popover" id="kt-help-popover" hidden>
          <div class="kt-help-head">
            <div>
              <div class="kt-help-kicker">Field Guide</div>
              <div class="kt-help-title">Key Terrain Identifier</div>
            </div>
            <button class="kt-help-close" id="kt-help-close" title="Close">✕</button>
          </div>
          <div class="kt-help-body">
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
        <div class="kt-body">
          <div class="kt-ps">Analysis area</div>
          <div class="kt-pg">
            <div class="kt-pf">
              <div class="kt-pl">Centre lat</div>
              <input id="kt-inp-lat" type="number" value="33.680" step="0.001" />
            </div>
            <div class="kt-pf">
              <div class="kt-pl">Centre lon</div>
              <input id="kt-inp-lon" type="number" value="73.060" step="0.001" />
            </div>
            <div class="kt-pf full">
              <div class="kt-pl">Radius (m)</div>
              <select id="kt-inp-radius">
                <option value="2000">2 km - position-level</option>
                <option value="4000" selected>4 km - company-level</option>
                <option value="8000">8 km - battalion-level</option>
                <option value="15000">15 km - brigade-level</option>
              </select>
            </div>
          </div>
          <div class="kt-ps">Resolution & sensitivity</div>
          <div class="kt-pg">
            <div class="kt-pf full">
              <div class="kt-pl">Grid cell size (m)</div>
              <select id="kt-inp-cell">
                <option value="20">20 m - fine (slower)</option>
                <option value="40" selected>40 m - balanced</option>
                <option value="70">70 m - fast</option>
              </select>
            </div>
          </div>
          <div class="kt-psr">
            <div class="kt-psr-l">Peak sensitivity</div>
            <input id="kt-inp-sens" type="range" min="1" max="10" step="1" value="5" />
            <div class="kt-psr-v" id="kt-sens-v">5</div>
          </div>
          <div class="kt-psr">
            <div class="kt-psr-l">Max features</div>
            <input id="kt-inp-maxfeat" type="range" min="5" max="30" step="1" value="15" />
            <div class="kt-psr-v" id="kt-maxfeat-v">15</div>
          </div>
          <div class="kt-ps">Feature types</div>
          <div class="kt-ptr"><label>Dominant ground (hilltops)</label><input id="kt-opt-hills" type="checkbox" checked /></div>
          <div class="kt-ptr"><label>Saddles / passes</label><input id="kt-opt-saddles" type="checkbox" checked /></div>
          <div class="kt-ptr"><label>Re-entrants / avenues</label><input id="kt-opt-reents" type="checkbox" checked /></div>
          <div class="kt-ptr"><label>Spurs / flank positions</label><input id="kt-opt-spurs" type="checkbox" checked /></div>
          <div class="kt-pdiv"></div>
          <div class="kt-ps">Overlay</div>
          <div class="kt-overlay-row">
            <button class="kt-ov-btn on" data-ov="curvature">Curvature</button>
            <button class="kt-ov-btn on" data-ov="markers">Markers</button>
            <button class="kt-ov-btn" data-ov="viewshed">Top viewshed</button>
          </div>
          <div class="kt-psr">
            <div class="kt-psr-l">Overlay opacity</div>
            <input id="kt-inp-opa" type="range" min="0.2" max="1.0" step="0.05" value="0.65" />
            <div class="kt-psr-v" id="kt-opa-v">0.65</div>
          </div>
          <div class="kt-pdiv"></div>
          <div class="kt-score-grid">
            <div class="kt-sg"><div class="kt-sg-l">Features found</div><div class="kt-sg-v" id="kt-sg-found">-</div></div>
            <div class="kt-sg"><div class="kt-sg-l">Area (km2)</div><div class="kt-sg-v" id="kt-sg-area">-</div></div>
            <div class="kt-sg"><div class="kt-sg-l">Highest elev</div><div class="kt-sg-v" id="kt-sg-elev">-</div></div>
            <div class="kt-sg"><div class="kt-sg-l">Relief (m)</div><div class="kt-sg-v" id="kt-sg-relief">-</div></div>
          </div>
          <div class="kt-prog-wrap">
            <div class="kt-prog-track"><div class="kt-prog-fill" id="kt-prog-fill"></div></div>
            <div class="kt-prog-label" id="kt-prog-label">-</div>
          </div>
          <div class="kt-pb-row">
            <button class="kt-pb" id="kt-btn-clear">Clear</button>
            <button class="kt-pb primary" id="kt-btn-run">Run Analysis ↗</button>
          </div>
          <div class="kt-hint" id="kt-hint" style="display:none">Click map to re-centre the analysis area</div>
        </div>
      `;
      document.body.appendChild(panel);
      this._controlPanelEl = panel;
      this._bindPanelEvents();
      this._makeDraggable();
    }
  }

  private _bindPanelEvents(): void {
    this._controlPanelEl?.querySelectorAll<HTMLButtonElement>('.kt-ov-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = (btn.dataset.ov || 'curvature') as OverlayKey;
        this._overlayState[key] = !this._overlayState[key];
        btn.classList.toggle('on', this._overlayState[key]);
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
      const body = this._controlPanelEl?.querySelector<HTMLElement>('.kt-body');
      const btn = this._controlPanelEl?.querySelector<HTMLElement>('#kt-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.style.display === 'none';
      body.style.display = minimized ? '' : 'none';
      btn.textContent = minimized ? '▼' : '▶';
    });
    this._controlPanelEl?.querySelector('#kt-close-btn')?.addEventListener('click', () => {
      this.close();
    });
  }

  private _showPanels(): void {
    if (this._listPanelEl) this._listPanelEl.style.display = 'flex';
    if (this._controlPanelEl) this._controlPanelEl.style.display = 'block';
    const hint = this._el('kt-hint');
    if (hint) hint.style.display = '';
  }

  private _hidePanels(): void {
    if (this._listPanelEl) this._listPanelEl.style.display = 'none';
    if (this._controlPanelEl) this._controlPanelEl.style.display = 'none';
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
            '<div class="kt-list-empty" id="kt-list-empty">No features detected.<br>Try increasing sensitivity or switching cell size.</div>';
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
      imgData.data[px + 3] = Math.round(opacity * 200 * Math.min(1, Math.abs(t) * 4));
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
      opacity: 0.7,
    });
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
      card.className = 'kt-fc';
      card.dataset.rank = String(feature.rank);

      const promPct = Math.round((feature.prom / maxProm) * 100);
      const elevPct = Math.round(((feature.elev - minElev) / relief) * 100);

      card.innerHTML = `
        <div class="kt-fc-score-badge" style="color:${ft.hexColor}">${feature.compositeScore}</div>
        <div class="kt-fc-top">
          <div class="kt-fc-rank" style="background:${ft.hexColor}22;color:${ft.hexColor};border:1px solid ${ft.hexColor}55">
            ${feature.rank}
          </div>
          <div>
            <div class="kt-fc-name">${ft.icon} ${ft.label}</div>
            <div class="kt-fc-type">${Math.round(feature.elev)} m MSL &nbsp;&middot;&nbsp; ${feature.viewshedPct}% visible</div>
          </div>
        </div>
        <div class="kt-fc-bars">
          <div class="kt-fc-bar">
            <div class="kt-fc-bar-label">Prominence</div>
            <div class="kt-fc-bar-track"><div class="kt-fc-bar-fill" style="width:${promPct}%;background:${ft.hexColor}"></div></div>
            <div class="kt-fc-bar-val">${Math.round(feature.prom)}m</div>
          </div>
          <div class="kt-fc-bar">
            <div class="kt-fc-bar-label">Viewshed</div>
            <div class="kt-fc-bar-track"><div class="kt-fc-bar-fill" style="width:${feature.viewshedPct}%;background:#378ADD"></div></div>
            <div class="kt-fc-bar-val">${feature.viewshedPct}%</div>
          </div>
          <div class="kt-fc-bar">
            <div class="kt-fc-bar-label">Elevation</div>
            <div class="kt-fc-bar-track"><div class="kt-fc-bar-fill" style="width:${elevPct}%;background:#1D9E75"></div></div>
            <div class="kt-fc-bar-val">${Math.round(feature.elev)}m</div>
          </div>
        </div>
        <div class="kt-fc-assessment">${ft.assessment(feature)}</div>
      `;

      card.addEventListener('click', () => {
        this._listPanelEl?.querySelectorAll('.kt-fc').forEach((el) => el.classList.remove('selected'));
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
    const list = this._el('kt-feature-list');
    if (list) {
      list.innerHTML =
        '<div class="kt-list-empty" id="kt-list-empty">Run analysis to identify features</div>';
    }
    this._setText('kt-list-sub', 'Run analysis to identify features');
    ['kt-sg-found', 'kt-sg-area', 'kt-sg-elev', 'kt-sg-relief'].forEach((id) => this._setText(id, '-'));
    this._setProgress(0, '-');
    this._setStatus('ready', 'Ready');
    this._syncOverlayVisibility();
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

  private _setStatus(statusClass: string, text: string): void {
    const el = this._el('kt-status');
    if (!el) return;
    if (statusClass === 'done') EngineLogger.success(ENGINE_NAME, text);
    else if (statusClass === 'sampling' || statusClass === 'scoring' || statusClass === 'ready') EngineLogger.nextStep(ENGINE_NAME, text);
    else EngineLogger.error(ENGINE_NAME, text);
    el.textContent = text;
    el.className = `kt-ph-status ${statusClass}`;
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

  private _injectStyles(): void {
    if (document.getElementById('key-terrain-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'key-terrain-engine-styles';
    style.textContent = `
      .kt-list-panel{
        position:absolute;top:14px;left:14px;width:380px;z-index:1100;
        background:var(--ms-bg, #141820);
        border:1px solid var(--ms-border, rgba(90,140,220,0.3));
        border-radius:var(--ms-radius, 9px);
        color:var(--ms-text, #dce8f5);
        font-family:var(--ms-font, 'SF Pro Display','Segoe UI',system-ui,sans-serif);
        font-size:var(--ms-fs, 13.5px);
        max-height:calc(100vh - 28px);display:none;flex-direction:column;
        box-shadow:0 8px 36px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.04);
      }
      .kt-lph{
        padding:10px 14px 9px;
        border-bottom:1px solid var(--ms-divider, rgba(80,100,150,0.18));
        background:rgba(239,159,39,0.07);
        flex-shrink:0;
      }
      .kt-lph-title{font-size:var(--ms-fs-sm, 15px);letter-spacing:.12em;text-transform:uppercase;color:#EF9F27;font-weight:700;margin-bottom:2px}
      .kt-lph-sub{font-size:var(--ms-fs-xs, 11.5px);color:var(--ms-text-dim, rgba(175,200,230,0.82));letter-spacing:.05em}
      .kt-feature-list{overflow-y:auto;flex:1;padding:8px}
      .kt-fc{
        background:rgba(255,255,255,0.02);
        border:1px solid var(--ms-divider, rgba(80,100,150,0.18));
        border-radius:6px;padding:10px 12px;margin-bottom:7px;
        cursor:pointer;transition:all .12s;position:relative;
      }
      .kt-fc:hover{background:rgba(239,159,39,0.07);border-color:rgba(239,159,39,0.35)}
      .kt-fc.selected{border-color:#EF9F27;background:rgba(239,159,39,0.10)}
      .kt-fc-top{display:flex;align-items:flex-start;gap:9px;margin-bottom:7px}
      .kt-fc-rank{
        width:24px;height:24px;border-radius:4px;
        display:flex;align-items:center;justify-content:center;
        font-size:var(--ms-fs, 13.5px);font-weight:700;flex-shrink:0;
      }
      .kt-fc-name{font-size:var(--ms-fs, 13.5px);font-weight:600;color:var(--ms-text, #dce8f5);line-height:1.3;flex:1}
      .kt-fc-type{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.06em;text-transform:uppercase;color:var(--ms-text-dim, rgba(175,200,230,0.82));margin-top:2px}
      .kt-fc-bars{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:6px}
      .kt-fc-bar{display:flex;flex-direction:column;gap:3px}
      .kt-fc-bar-label{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.06em;text-transform:uppercase;color:var(--ms-text-label, rgba(140,170,205,0.85))}
      .kt-fc-bar-track{height:4px;background:rgba(255,255,255,0.06);border-radius:2px}
      .kt-fc-bar-fill{height:100%;border-radius:2px;transition:width .3s}
      .kt-fc-bar-val{font-size:var(--ms-fs-xs, 11.5px);color:var(--ms-text, #dce8f5)}
      .kt-fc-assessment{
        font-size:var(--ms-fs-xs, 11.5px);color:var(--ms-text-dim, rgba(175,200,230,0.82));line-height:1.5;
        border-top:1px solid var(--ms-divider, rgba(80,100,150,0.18));padding-top:6px;margin-top:4px
      }
      .kt-fc-score-badge{position:absolute;top:10px;right:12px;font-size:var(--ms-fs-sm, 15px);font-weight:700}
      .kt-list-empty{
        padding:22px 14px;font-size:var(--ms-fs, 13.5px);color:var(--ms-text-dim, rgba(175,200,230,0.82));letter-spacing:.04em;
        text-align:center;line-height:1.65;
      }
      .kt-ctrl-panel{
        position:absolute;top:14px;right:14px;width:380px;z-index:1100;
        background:var(--ms-bg, #141820);
        border:1px solid var(--ms-border, rgba(90,140,220,0.3));
        border-radius:var(--ms-radius, 9px);
        color:var(--ms-text, #dce8f5);
        font-family:var(--ms-font, 'SF Pro Display','Segoe UI',system-ui,sans-serif);
        font-size:var(--ms-fs, 13.5px);
        max-height:calc(100vh - 28px);overflow-y:auto;display:none;
        box-shadow:0 8px 36px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.04);
      }
      .kt-ph{
        display:flex;align-items:flex-start;justify-content:space-between;
        padding:10px 14px 9px;
        border-bottom:1px solid var(--ms-divider, rgba(80,100,150,0.18));
        background:rgba(239,159,39,0.07);
        position:sticky;top:0;z-index:2;
        cursor:move;
      }
      .kt-ph-title-wrap{display:flex;flex-direction:column;gap:3px}
      .kt-ph-title{font-size:var(--ms-fs-sm, 15px);letter-spacing:.12em;text-transform:uppercase;color:#EF9F27;font-weight:700}
      .kt-ph-status{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-dim, rgba(175,200,230,0.82));transition:color .2s;font-weight:600}
      .kt-ph-status.sampling{color:#EF9F27}
      .kt-ph-status.scoring{color:#378ADD}
      .kt-ph-status.done{color:#1D9E75}
      .kt-ph-status.ready{color:#EF9F27}
      .kt-ph-actions{display:flex;align-items:center;gap:6px}
      .kt-help-btn,.kt-minimize-btn,.kt-close-btn{
        width:22px;height:22px;padding:0;border:0;background:transparent;color:var(--ms-text-dim, rgba(175,200,230,0.82));
        cursor:pointer;font-size:var(--ms-fs, 13.5px);line-height:1;border-radius:3px;transition:all .12s;
        font-family:inherit;
      }
      .kt-help-btn:hover,.kt-minimize-btn:hover,.kt-close-btn:hover{color:var(--ms-text, #dce8f5);background:rgba(255,255,255,0.06)}
      .kt-help-btn{border:1px solid var(--ms-border, rgba(90,140,220,0.3));border-radius:50%;color:#1D9E75;font-weight:700}
      .kt-help-popover{
        margin:8px 12px;border:1px solid var(--ms-border, rgba(90,140,220,0.3));
        background:var(--ms-bg, #141820);border-radius:6px;overflow:hidden;
        max-height:min(440px, calc(100vh - 132px));overflow-y:auto;
      }
      .kt-help-head{
        display:flex;align-items:flex-start;justify-content:space-between;
        padding:9px 12px;border-bottom:1px solid var(--ms-divider, rgba(80,100,150,0.18));
        background:rgba(239,159,39,0.06);
      }
      .kt-help-kicker{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.09em;text-transform:uppercase;color:var(--ms-text-label, rgba(140,170,205,0.85))}
      .kt-help-title{font-size:var(--ms-fs-sm, 15px);color:#EF9F27;letter-spacing:.06em;text-transform:uppercase;font-weight:700;margin-top:2px}
      .kt-help-close{
        width:22px;height:22px;padding:0;border:1px solid var(--ms-border, rgba(90,140,220,0.3));background:transparent;color:var(--ms-text-dim, rgba(175,200,230,0.82));
        cursor:pointer;font-size:var(--ms-fs, 13.5px);font-family:inherit;border-radius:3px;
      }
      .kt-help-close:hover{color:var(--ms-text, #dce8f5);border-color:#EF9F27}
      .kt-help-body{padding:11px 12px 12px;font-size:var(--ms-fs, 13.5px);color:var(--ms-text-dim, rgba(175,200,230,0.82));line-height:1.55;user-select:text}
      .kt-help-body p{margin:0 0 9px}
      .kt-help-body ol,.kt-help-body ul{margin:0 0 9px;padding-left:17px}
      .kt-help-body li{margin:0 0 5px}
      .kt-ps{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.1em;text-transform:uppercase;color:var(--ms-text-label, rgba(140,170,205,0.85));padding:11px 14px 6px;font-weight:600}
      .kt-pg{display:grid;grid-template-columns:1fr 1fr;gap:9px 10px;padding:0 14px 10px}
      .kt-pf{display:flex;flex-direction:column;gap:4px}
      .kt-pf.full{grid-column:1/-1}
      .kt-pl{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label, rgba(140,170,205,0.85));font-weight:600}
      .kt-ctrl-panel input,.kt-ctrl-panel select{
        background:rgba(0,0,0,0.28);border:1px solid var(--ms-border, rgba(90,140,220,0.3));
        border-radius:4px;color:var(--ms-text, #dce8f5);font-family:inherit;
        font-size:var(--ms-fs, 13.5px);padding:7px 9px;width:100%;outline:none;transition:border-color .15s;
        box-sizing:border-box;
      }
      .kt-ctrl-panel input:focus,.kt-ctrl-panel select:focus{border-color:#EF9F27}
      .kt-ctrl-panel select option{background:var(--ms-bg, #141820)}
      .kt-psr{display:flex;align-items:center;gap:9px;padding:0 14px 9px}
      .kt-psr-l{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label, rgba(140,170,205,0.85));flex:1.8;font-weight:600}
      .kt-psr input[type=range]{flex:2;accent-color:#EF9F27;cursor:pointer}
      .kt-psr-v{font-size:var(--ms-fs, 13.5px);color:#EF9F27;min-width:40px;text-align:right;font-weight:600}
      .kt-pdiv{height:1px;background:var(--ms-divider, rgba(80,100,150,0.18));margin:5px 0}
      .kt-ptr{display:flex;align-items:center;justify-content:space-between;padding:6px 14px}
      .kt-ptr label{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label, rgba(140,170,205,0.85));cursor:pointer;font-weight:600}
      .kt-ptr input[type=checkbox]{accent-color:#EF9F27;width:15px;height:15px;cursor:pointer}
      .kt-overlay-row{display:flex;gap:6px;padding:0 14px 10px}
      .kt-ov-btn{
        flex:1;padding:7px 5px;font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.05em;text-transform:uppercase;
        cursor:pointer;border-radius:4px;border:1px solid var(--ms-border, rgba(90,140,220,0.3));
        background:rgba(0,0,0,0.28);color:var(--ms-text-dim, rgba(175,200,230,0.82));font-family:inherit;
        transition:all .13s;font-weight:600;
      }
      .kt-ov-btn:hover{color:var(--ms-text, #dce8f5)}
      .kt-ov-btn.on{border-color:#EF9F27;color:#EF9F27;background:rgba(239,159,39,0.10)}
      .kt-prog-wrap{padding:0 14px 10px}
      .kt-prog-track{height:5px;background:rgba(0,0,0,0.28);border-radius:3px;overflow:hidden;border:1px solid var(--ms-divider, rgba(80,100,150,0.18))}
      .kt-prog-fill{height:100%;background:linear-gradient(to right,#EF9F27,#378ADD);border-radius:3px;width:0%;transition:width .1s}
      .kt-prog-label{font-size:var(--ms-fs-xs, 11.5px);color:var(--ms-text-dim, rgba(175,200,230,0.82));letter-spacing:.04em;margin-top:5px}
      .kt-score-grid{
        display:grid;grid-template-columns:1fr 1fr;gap:7px 10px;
        margin:0 14px 10px;background:rgba(239,159,39,0.05);border:1px solid rgba(239,159,39,0.18);
        border-radius:5px;padding:9px 11px;
      }
      .kt-sg{display:flex;flex-direction:column;gap:2px}
      .kt-sg-l{font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label, rgba(140,170,205,0.85));font-weight:600}
      .kt-sg-v{color:#EF9F27;font-size:var(--ms-fs-sm, 15px);font-weight:700}
      .kt-pb-row{display:flex;gap:7px;padding:10px 14px}
      .kt-pb{
        flex:1;padding:9px;font-family:inherit;
        font-size:var(--ms-fs-xs, 11.5px);letter-spacing:.06em;text-transform:uppercase;
        cursor:pointer;border-radius:4px;border:1px solid var(--ms-border, rgba(90,140,220,0.3));
        background:rgba(0,0,0,0.28);color:var(--ms-text-dim, rgba(175,200,230,0.82));transition:all .14s;font-weight:600;
      }
      .kt-pb:hover:not(:disabled){background:rgba(239,159,39,0.10);color:#EF9F27;border-color:#EF9F27}
      .kt-pb.primary{background:rgba(239,159,39,0.16);border-color:#EF9F27;color:#EF9F27;font-weight:700}
      .kt-pb.primary:hover:not(:disabled){background:rgba(239,159,39,0.28)}
      .kt-pb:disabled{opacity:.35;cursor:not-allowed}
      .kt-hint{
        position:sticky;bottom:0;margin:0 14px 12px;
        background:rgba(7,8,9,0.94);border:1px solid rgba(239,159,39,0.45);
        color:#EF9F27;font-family:inherit;font-size:var(--ms-fs-xs, 11.5px);
        letter-spacing:.08em;padding:9px 12px;border-radius:4px;
        pointer-events:none;z-index:99;text-transform:uppercase;text-align:center;font-weight:600;
      }
      @media (max-width: 980px) {
        .kt-list-panel{left:10px;top:10px;width:calc(50vw - 18px);max-height:48vh}
        .kt-ctrl-panel{right:10px;top:10px;width:calc(50vw - 18px);max-height:calc(100vh - 20px)}
      }
      @media (max-width: 720px) {
        .kt-list-panel{left:10px;right:10px;top:10px;width:auto;max-height:32vh}
        .kt-ctrl-panel{left:10px;right:10px;top:auto;bottom:10px;width:auto;max-height:52vh}
      }
    `;
    document.head.appendChild(style);
  }
}

export default KeyTerrainIdentificationEngine;


