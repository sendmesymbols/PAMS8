import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import EngineLogger from '../../../Support/EngineLogger';

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'OpRankerEngine';
const EARTH_R = 6_371_008.8;
const M_PER_DEG = 111_320;

// Composite score weights — tune to doctrine priority
const W_UNIQUE   = 0.38;
const W_TOTAL    = 0.20;
const W_ELEV     = 0.22;
const W_MUTUAL   = 0.13;
const W_ACCESS   = 0.07;

const OP_COLORS: Array<[number, number, number]> = [
  [55, 138, 221], [239, 159, 39], [180, 40, 220], [29, 158, 117],
  [220, 60, 48],  [245, 240, 64], [100, 200, 100], [255, 120, 180],
];
const HEX_COLORS = ['#378ADD','#EF9F27','#B428DC','#1D9E75','#DC3C30','#F5F040','#64C864','#FF78B4'];

interface OpStats { totalSeen: number; uniqueSeen: number; totalPct: number; uniquePct: number; }

interface OpCandidate {
  pt: Point;
  index: number;
  raster: Uint8Array | null;
  stats: OpStats | null;
  obsZ?: number;
  elevAdv?: number;       // metres above AO centre elevation
  compositeScore?: number;
  mutualWith?: number[];  // indices of other OPs this one has mutual LOS with
  isOptimal: boolean;
  rank?: number;
  roadAccess?: { km: number; min: number; rating: string } | 'none';
}

interface CoverageResult {
  coverCount: Uint8Array;
  aoMask: Uint8Array;
  aoTotal: number;
  opStats: OpStats[];
  gapCount: number;
  combinedSeen: number;
}

interface OverlayState {
  combined: boolean;
  counts: boolean;
  gap: boolean;
  individual: boolean;
  overlap: boolean;
  mutual: boolean;
}

export interface OpRankSummary {
  candidates: Array<{
    point: Point;
    rank: number;
    uniquePct: number;
    totalPct: number;
    compositeScore: number;
    elevAdvM: number;
    mutualCount: number;
    optimal: boolean;
  }>;
  combinedCoveragePct: number;
  gapPct: number;
  optimalIndices: number[];
}

export interface OpRankHeadlessOptions {
  observerHeightM?: number;
  maxRangeM?: number;
  aoRadiusM?: number;
  cellM?: number;
  optimalCount?: number;
  aoCenterLon?: number;
  aoCenterLat?: number;
}

function destPt(lon: number, lat: number, brg: number, dist: number): { longitude: number; latitude: number } {
  const d = dist / EARTH_R;
  const b = (brg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { longitude: (l2 * 180) / Math.PI, latitude: (p2 * 180) / Math.PI };
}

function pointFromGeometry(graphic: Graphic): Point | null {
  const geom = graphic.geometry;
  if (geom?.type === 'point') return geom as Point;
  if ((geom as any)?.centroid) return (geom as any).centroid as Point;
  return null;
}

export class OpRankerEngine {
  static readonly OP_LAYER_ID         = 'op-ranker-markers';
  static readonly RANGE_LAYER_ID      = 'op-ranker-range-rings';
  static readonly AO_LAYER_ID         = 'op-ranker-ao-boundary';
  static readonly AO_CENTER_LAYER_ID  = 'op-ranker-ao-center';
  static readonly MUTUAL_VIZ_LAYER_ID = 'op-ranker-mutual-viz';

  private _view: MapView | SceneView | null = null;
  private _opLayer!: GraphicsLayer;
  private _rangeLayer!: GraphicsLayer;
  private _aoLayer!: GraphicsLayer;
  private _aoCenterLayer!: GraphicsLayer;
  private _mutualVizLayer!: GraphicsLayer;
  private _mediaLayers: MediaLayer[] = [];

  private _listPanelEl: HTMLDivElement | null = null;
  private _controlPanelEl: HTMLDivElement | null = null;
  private _hintEl: HTMLDivElement | null = null;
  private _clickHandle: any = null;

  private _ops: OpCandidate[] = [];
  private _running = false;
  private _analysed = false;

  // AO centre — set by user to define the target/observation area
  private _aoCenterPt: Point | null = null;
  private _aoPickMode = false;
  private _aoCenterElevM = 0;

  // Cached analysis data — enables overlay redraw without re-running viewsheds
  private _cachedCoverage: CoverageResult | null = null;
  private _cachedExtent: Extent | null = null;
  private _cachedCols = 0;
  private _cachedRows = 0;
  private _cachedCellM = 0;

  private _ovState: OverlayState = {
    combined: true, counts: true, gap: true,
    individual: false, overlap: true, mutual: true,
  };
  private _dragTarget: HTMLElement | null = null;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._unbindMapClick();
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._aoLayer.id)) {
      map.addMany([
        this._aoCenterLayer, this._mutualVizLayer,
        this._aoLayer, this._rangeLayer, this._opLayer,
      ]);
    }
    if (this._controlPanelEl && this._controlPanelEl.style.display !== 'none') this._bindMapClick();
  }

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    this.openWidget(view);
    const src = pointFromGeometry(graphic);
    if (src && this._ops.length === 0) {
      this._addOP(new Point({
        longitude: src.longitude ?? src.x,
        latitude: src.latitude ?? src.y,
        spatialReference: WGS84,
      }));
    }
  }

  openWidget(view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    if (!this._view) return;
    this._ensurePanels();
    this._showPanels();
    this._bindMapClick();
  }

  public async rankCandidates(points: Point[], options: OpRankHeadlessOptions = {}): Promise<OpRankSummary> {
    if (!this._view) throw new Error('OpRankerEngine requires initialize(view) before rankCandidates().');
    if (points.length === 0) {
      return { candidates: [], combinedCoveragePct: 0, gapPct: 0, optimalIndices: [] };
    }
    const eyeH     = options.observerHeightM ?? 1.8;
    const maxRangeM = options.maxRangeM ?? 3500;
    const aoRadiusM = options.aoRadiusM ?? 3000;
    const cellM    = options.cellM ?? 120;
    const kCount   = options.optimalCount ?? Math.min(3, points.length);

    const hasCtr = options.aoCenterLon != null && options.aoCenterLat != null;
    const cLon = hasCtr ? options.aoCenterLon! : points.reduce((s, p) => s + (p.longitude ?? p.x), 0) / points.length;
    const cLat = hasCtr ? options.aoCenterLat! : points.reduce((s, p) => s + (p.latitude ?? p.y), 0) / points.length;
    const cosLat = Math.max(0.01, Math.cos((cLat * Math.PI) / 180));
    const padM  = Math.max(aoRadiusM, maxRangeM) * 1.1;
    const padDeg = padM / M_PER_DEG;
    const extent = new Extent({
      xmin: cLon - padDeg / cosLat, ymin: cLat - padDeg,
      xmax: cLon + padDeg / cosLat, ymax: cLat + padDeg,
      spatialReference: WGS84,
    });
    const cols = Math.max(8, Math.ceil((padM * 2) / cellM));
    const rows = Math.max(8, Math.ceil((padM * 2) / cellM));

    // Elevation sampler created once over the AO and shared across all candidates.
    // This is the required 8th arg of _computeViewshedRaster — its absence made
    // this headless API throw a TypeError on the first candidate.
    const sampler = await (this._view as any).map.ground.createElevationSampler(extent, { noDataValue: 0 });

    const rasters: Uint8Array[] = [];
    const obsZs: number[] = [];
    for (const pt of points) {
      let obsZ = eyeH;
      try {
        const er = await (this._view.map as any).ground.queryElevation(pt);
        obsZ = ((er?.geometry?.z ?? 0) as number) + eyeH;
      } catch {}
      obsZs.push(obsZ);
      const { raster } = await this._computeViewshedRaster(pt, obsZ, extent, cols, rows, cellM, maxRangeM, sampler);
      rasters.push(raster);
    }

    // AO centre elevation
    let aoCElevM = 0;
    try {
      const er = await (this._view.map as any).ground.queryElevation(
        new Point({ longitude: cLon, latitude: cLat, spatialReference: WGS84 })
      );
      aoCElevM = (er?.geometry?.z ?? 0) as number;
    } catch {}

    const result = this._analyseCoverage(rasters, cols, rows, aoRadiusM, extent, cLon, cLat);
    const optimalIndices = this._selectOptimalSet(rasters, kCount, result.aoMask, cols * rows);

    const elevAdvs = obsZs.map(z => z - eyeH - aoCElevM); // terrain elev adv (subtract eyeH to compare terrain)
    const minElev = Math.min(...elevAdvs);
    const maxElev = Math.max(...elevAdvs);
    const elevRange = maxElev - minElev + 0.1;

    const ranked = points.map((point, index) => {
      const s = result.opStats[index];
      const normElev = (elevAdvs[index] - minElev) / elevRange;
      // Neutral mutual (0) + neutral access (0.35 — the interactive no-road default)
      // so headless uses the SAME formula/weights as the panel and isn't capped near
      // 0.80. Full mutual-LOS parity in headless is a deferred enhancement (no live caller).
      const composite = OpRankerEngine._composite(s.uniquePct / 100, s.totalPct / 100, normElev, 0, 0.35);
      return {
        point, rank: 0,
        uniquePct: s?.uniquePct ?? 0,
        totalPct:  s?.totalPct ?? 0,
        compositeScore: composite,
        elevAdvM: +(elevAdvs[index]).toFixed(0),
        mutualCount: 0,
        optimal: optimalIndices.includes(index),
      };
    }).sort((a, b) => b.compositeScore - a.compositeScore);
    ranked.forEach((item, i) => { item.rank = i + 1; });

    return {
      candidates: ranked,
      combinedCoveragePct: result.aoTotal > 0 ? Math.round((100 * result.combinedSeen) / result.aoTotal) : 0,
      gapPct: result.aoTotal > 0 ? Math.round((100 * result.gapCount) / result.aoTotal) : 0,
      optimalIndices,
    };
  }

  close(): void {
    this._hidePanels();
    this._unbindMapClick();
  }

  destroy(): void {
    this.close();
    this._clearAll();
    const map = this._view?.map as any;
    if (map) {
      [
        this._opLayer, this._rangeLayer, this._aoLayer,
        this._aoCenterLayer, this._mutualVizLayer,
        ...this._mediaLayers,
      ].forEach((layer) => { try { map.remove(layer); } catch {} });
    }
    this._listPanelEl?.remove();
    this._controlPanelEl?.remove();
    this._hintEl?.remove();
    this._listPanelEl = null;
    this._controlPanelEl = null;
    this._hintEl = null;
    this._view = null;
  }

  // ─── Layer creation ──────────────────────────────────────────────────────────

  private _createLayers(): void {
    const elevInfo = { mode: 'on-the-ground' } as any;
    this._opLayer = new GraphicsLayer({
      id: OpRankerEngine.OP_LAYER_ID, title: 'OP Ranker - Markers', elevationInfo: elevInfo,
    });
    this._rangeLayer = new GraphicsLayer({
      id: OpRankerEngine.RANGE_LAYER_ID, title: 'OP Ranker - Range Rings', elevationInfo: elevInfo,
    });
    this._aoLayer = new GraphicsLayer({
      id: OpRankerEngine.AO_LAYER_ID, title: 'OP Ranker - AO Boundary', elevationInfo: elevInfo,
    });
    this._aoCenterLayer = new GraphicsLayer({
      id: OpRankerEngine.AO_CENTER_LAYER_ID, title: 'OP Ranker - AO Centre', elevationInfo: elevInfo,
    });
    this._mutualVizLayer = new GraphicsLayer({
      id: OpRankerEngine.MUTUAL_VIZ_LAYER_ID, title: 'OP Ranker - Mutual LOS', elevationInfo: elevInfo,
    });
    (this._opLayer as any).popupTemplate = { title: '{type}', content: '{label}' };
  }

  // ─── Panel HTML ──────────────────────────────────────────────────────────────

  private _ensurePanels(): void {
    if (!this._listPanelEl) {
      this._listPanelEl = document.createElement('div');
      this._listPanelEl.id = 'oprank-list-panel';
      this._listPanelEl.innerHTML = this._listPanelHtml();
      document.body.appendChild(this._listPanelEl);
      this._makeDraggable(this._listPanelEl, '.oprank-lph');
    }
    if (!this._controlPanelEl) {
      this._controlPanelEl = document.createElement('div');
      this._controlPanelEl.id = 'oprank-ctrl-panel';
      this._controlPanelEl.innerHTML = this._controlPanelHtml();
      document.body.appendChild(this._controlPanelEl);
      this._bindPanelEvents();
      this._makeDraggable(this._controlPanelEl, '.oprank-ph');
    }
    if (!this._hintEl) {
      this._hintEl = document.createElement('div');
      this._hintEl.id = 'oprank-hint';
      document.body.appendChild(this._hintEl);
    }
    this._syncSummary();
    this._syncHint();
    if (!this._ops.length) this._renderEmptyList();
  }

  private _listPanelHtml(): string {
    return `
      <div class="oprank-lph">
        <div class="oprank-lph-title">Observation Post Ranker</div>
        <div class="oprank-lph-sub" id="oprank-lph-sub">Place OPs on map then run analysis</div>
      </div>
      <div id="oprank-summary-strip">
        <div class="oprank-ss-cell"><div class="oprank-ss-l">OPs placed</div><div class="oprank-ss-v" id="oprank-ss-ops">0</div></div>
        <div class="oprank-ss-cell"><div class="oprank-ss-l">AO coverage</div><div class="oprank-ss-v" id="oprank-ss-cov">-</div></div>
        <div class="oprank-ss-cell"><div class="oprank-ss-l">Gap area</div><div class="oprank-ss-v" id="oprank-ss-gap">-</div></div>
      </div>
      <div id="oprank-list-recommendation" style="display:none">
        <div class="oprank-rec-label">Recommended Set</div>
        <div class="oprank-rec-ops" id="oprank-rec-ops"></div>
        <div class="oprank-rec-stats" id="oprank-rec-stats"></div>
      </div>
      <div id="oprank-op-list"></div>
    `;
  }

  private _controlPanelHtml(): string {
    return `
      <div class="oprank-ph">
        <div class="oprank-ph-title">OP Analysis</div>
        <div class="oprank-ph-tools">
          <button class="oprank-help-btn" id="oprank-help-btn" title="OP Ranker Help">?</button>
          <button class="oprank-min-btn" id="oprank-min-btn" title="Minimize">v</button>
          <button class="oprank-close-btn" id="oprank-close-btn" title="Close">x</button>
        </div>
        <div class="oprank-ph-status placing" id="oprank-status">Place OPs on map</div>
      </div>
      <div class="oprank-help-popover" id="oprank-help-popover" hidden>
        <div class="oprank-help-head">
          <div><div class="oprank-help-kicker">Field Guide</div><div class="oprank-help-title">Observation Post Ranker</div></div>
          <button id="oprank-help-close" class="oprank-help-close">x</button>
        </div>
        <div class="oprank-help-body">
          <p>Ranks candidate OPs by composite score: unique coverage, total viewshed, elevation advantage over target, mutual line-of-sight, and road accessibility.</p>
          <div class="oprank-help-block"><h4>Workflow</h4>
            <ol>
              <li><strong>Set AO Target</strong> — click the target/objective position so the analysis scores coverage of that area, not the space between your own OPs.</li>
              <li>Click the map to place 2–8 candidate OPs around the target.</li>
              <li>Adjust observer height (platform), range, and AO radius.</li>
              <li>Run analysis to rank OPs and generate gap/coverage overlays.</li>
              <li>Use <em>Export Report</em> to generate a briefing document.</li>
            </ol>
          </div>
          <div class="oprank-help-block"><h4>Composite Score (0–100)</h4>
            <dl>
              <dt>Unique coverage 38%</dt><dd>Cells only this OP can see — measures irreplaceability.</dd>
              <dt>Total coverage 20%</dt><dd>All AO cells visible from this post.</dd>
              <dt>Elevation advantage 22%</dt><dd>Height above target terrain — dominant ground sees more.</dd>
              <dt>Mutual LOS 13%</dt><dd>How many other OPs can see this one — supports relay &amp; paired overwatch.</dd>
              <dt>Road access 7%</dt><dd>Trafficability to the post from the AO centre.</dd>
            </dl>
          </div>
          <div class="oprank-help-block"><h4>AO Centre</h4>
            <p>Set the target/objective position before placing OPs. The coverage score is computed relative to this point. Without a set target the AO defaults to the centroid of your OPs — less tactically meaningful.</p>
          </div>
          <div class="oprank-help-block"><h4>Mutual LOS</h4>
            <p>Green dashed lines connect OPs that have reciprocal line of sight. Paired OPs can relay observations and provide mutual support. An OP with no mutual LOS is isolated.</p>
          </div>
        </div>
      </div>
      <div class="oprank-body">

        <div class="oprank-ps">Target / AO Centre</div>
        <div class="oprank-pg">
          <div class="oprank-pf full">
            <div class="oprank-pl">Click to set where OPs should observe</div>
            <div style="display:flex;gap:5px;margin-bottom:5px">
              <button class="oprank-pb" id="oprank-btn-ao-pick" style="flex:1">📍 Set Target on Map</button>
              <button class="oprank-pb" id="oprank-btn-ao-clear" style="flex:0 0 52px" disabled>Clear</button>
            </div>
            <div id="oprank-ao-coords" class="oprank-ao-note">No target set — AO will centre on OP centroid</div>
          </div>
        </div>

        <div class="oprank-ps">Observer Platform</div>
        <div class="oprank-pg">
          <div class="oprank-pf full">
            <div class="oprank-platform-row">
              <button class="oprank-plat-btn active" data-h="1.8">Dismounted<span>1.8 m</span></button>
              <button class="oprank-plat-btn" data-h="2.5">Vehicle<span>2.5 m</span></button>
              <button class="oprank-plat-btn" data-h="5.0">Tower<span>5.0 m</span></button>
            </div>
          </div>
          <div class="oprank-pf"><div class="oprank-pl">Eye height (m)</div><input id="oprank-inp-eye" type="number" value="1.8" min="0.5" max="20" step="0.1"/></div>
          <div class="oprank-pf"><div class="oprank-pl">Max obs range (m)</div><input id="oprank-inp-range" type="number" value="5000" min="500" max="20000" step="200"/></div>
        </div>

        <div class="oprank-ps">Area of Observation (AO)</div>
        <div class="oprank-pg">
          <div class="oprank-pf full">
            <div class="oprank-pl">AO radius (m) — coverage scoring boundary</div>
            <select id="oprank-inp-ao">
              <option value="2000">2 km</option>
              <option value="4000" selected>4 km</option>
              <option value="6000">6 km</option>
              <option value="10000">10 km</option>
            </select>
          </div>
        </div>

        <div class="oprank-ps">Grid Resolution</div>
        <div class="oprank-pg">
          <div class="oprank-pf full">
            <div class="oprank-pl">Cell size (m)</div>
            <select id="oprank-inp-cell">
              <option value="30">30 m — fine</option>
              <option value="50" selected>50 m — balanced</option>
              <option value="80">80 m — fast</option>
              <option value="120">120 m — rapid</option>
            </select>
          </div>
        </div>

        <div class="oprank-ps">Optimal OP Set</div>
        <div class="oprank-pg">
          <div class="oprank-pf full">
            <div class="oprank-pl">How many OPs to recommend</div>
            <select id="oprank-inp-optimal">
              <option value="1">Best single OP</option>
              <option value="2">Best 2 OPs</option>
              <option value="3" selected>Best 3 OPs</option>
              <option value="4">Best 4 OPs</option>
            </select>
          </div>
        </div>

        <div class="oprank-pdiv"></div>
        <div class="oprank-ps">Overlays</div>
        <div class="oprank-ov-row">
          <button class="oprank-ov-btn on" data-ov="combined">Coverage</button>
          <button class="oprank-ov-btn on" data-ov="counts">Heatmap</button>
          <button class="oprank-ov-btn gap-on" data-ov="gap">Gaps</button>
          <button class="oprank-ov-btn on" data-ov="mutual">Mutual LOS</button>
        </div>
        <div class="oprank-psr">
          <div class="oprank-psr-l">Overlay opacity</div>
          <input id="oprank-inp-opa" type="range" min="0.2" max="1.0" step="0.05" value="0.70"/>
          <div class="oprank-psr-v" id="oprank-opa-v">0.70</div>
        </div>
        <div class="oprank-ptr">
          <label>Show individual viewsheds</label>
          <input id="oprank-opt-individual" type="checkbox"/>
        </div>
        <div class="oprank-ptr">
          <label>Show OP-OP overlap extent</label>
          <input id="oprank-opt-overlap" type="checkbox" checked/>
        </div>

        <div class="oprank-pdiv"></div>
        <div class="oprank-optimal-strip" id="oprank-optimal-strip" style="display:none">
          <div class="oprank-opt-label">Recommended set</div>
          <div class="oprank-opt-body" id="oprank-optimal-body">-</div>
        </div>
        <div id="oprank-prog-wrap">
          <div id="oprank-prog-track"><div id="oprank-prog-fill"></div></div>
          <div id="oprank-prog-label">-</div>
        </div>
        <div class="oprank-pb-row">
          <button class="oprank-pb" id="oprank-btn-clear">Clear all</button>
          <button class="oprank-pb primary" id="oprank-btn-run" disabled>Run Analysis →</button>
        </div>
        <div class="oprank-pb-row" style="padding-top:0">
          <button class="oprank-pb" id="oprank-btn-export" disabled style="flex:1">Export Report</button>
        </div>
      </div>
    `;
  }

  // ─── Event binding ───────────────────────────────────────────────────────────

  private _bindPanelEvents(): void {
    const p = this._controlPanelEl;
    if (!p) return;

    p.querySelector('#oprank-help-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const h = p.querySelector<HTMLElement>('#oprank-help-popover');
      if (h) h.hidden = !h.hidden;
    });
    p.querySelector('#oprank-help-close')?.addEventListener('click', () => {
      const h = p.querySelector<HTMLElement>('#oprank-help-popover');
      if (h) h.hidden = true;
    });
    p.querySelector('#oprank-close-btn')?.addEventListener('click', () => this.close());
    p.querySelector('#oprank-min-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.oprank-body');
      const btn  = p.querySelector<HTMLElement>('#oprank-min-btn');
      if (!body || !btn) return;
      const min = body.style.display === 'none';
      body.style.display = min ? '' : 'none';
      btn.textContent = min ? 'v' : '>';
    });

    // AO target picker
    p.querySelector('#oprank-btn-ao-pick')?.addEventListener('click', () => {
      this._aoPickMode = !this._aoPickMode;
      const btn = p.querySelector<HTMLElement>('#oprank-btn-ao-pick');
      if (!btn) return;
      if (this._aoPickMode) {
        btn.textContent = '✕ Cancel';
        btn.classList.add('picking');
        if (this._hintEl) this._hintEl.textContent = 'Click map to set AO target (observation area centre)';
      } else {
        btn.textContent = '📍 Set Target on Map';
        btn.classList.remove('picking');
        this._syncHint();
      }
    });
    p.querySelector('#oprank-btn-ao-clear')?.addEventListener('click', () => {
      this._aoCenterPt = null;
      this._aoCenterLayer.removeAll();
      this._setText('oprank-ao-coords', 'No target set — AO will centre on OP centroid');
      const clearBtn = p.querySelector<HTMLButtonElement>('#oprank-btn-ao-clear');
      if (clearBtn) clearBtn.disabled = true;
      if (this._analysed) void this._runAnalysis();
    });

    // Platform presets
    p.querySelectorAll<HTMLButtonElement>('.oprank-plat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        p.querySelectorAll('.oprank-plat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const h = parseFloat(btn.dataset.h ?? '1.8');
        const eyeInput = this._input('oprank-inp-eye') as HTMLInputElement | null;
        if (eyeInput) eyeInput.value = String(h);
        if (this._analysed) void this._runAnalysis();
      });
    });

    // Overlay toggles — redraw from cache, no re-analysis
    p.querySelectorAll<HTMLButtonElement>('.oprank-ov-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ov = btn.dataset.ov as keyof OverlayState;
        this._ovState[ov] = !this._ovState[ov];
        if (ov === 'gap')    btn.classList.toggle('gap-on', this._ovState[ov]);
        else if (ov === 'mutual') btn.classList.toggle('mutual-on', this._ovState[ov]);
        else                 btn.classList.toggle('on', this._ovState[ov]);
        if (this._analysed) this._redrawOverlays();
      });
    });

    this._input('oprank-inp-opa')?.addEventListener('input', () => {
      this._setText('oprank-opa-v', this._num('oprank-inp-opa', 0.7).toFixed(2));
      if (this._analysed) this._redrawOverlays();
    });
    this._input('oprank-opt-individual')?.addEventListener('change', () => {
      this._ovState.individual = this._checked('oprank-opt-individual', false);
      if (this._analysed) this._redrawOverlays();
    });
    this._input('oprank-opt-overlap')?.addEventListener('change', () => {
      this._ovState.overlap = this._checked('oprank-opt-overlap', true);
      if (this._analysed) this._redrawOverlays();
    });

    ['oprank-inp-range', 'oprank-inp-ao', 'oprank-inp-cell', 'oprank-inp-optimal'].forEach((id) => {
      this._input(id)?.addEventListener('change', () => {
        this._rebuildMarkers();
        if (this._analysed) void this._runAnalysis();
      });
    });
    this._input('oprank-inp-eye')?.addEventListener('change', () => {
      if (this._analysed) void this._runAnalysis();
    });

    p.querySelector('#oprank-btn-clear')?.addEventListener('click', () => this._clearAll());
    p.querySelector('#oprank-btn-run')?.addEventListener('click', () => void this._runAnalysis());
    p.querySelector('#oprank-btn-export')?.addEventListener('click', () => this._exportReport());
  }

  private _bindMapClick(): void {
    if (!this._view || this._clickHandle) return;
    this._clickHandle = this._view.on('click', async (event: any) => {
      if (this._running) return;
      const mapPoint = event.mapPoint as Point | null;
      if (!mapPoint) return;

      // AO pick mode — set target, don't place OP
      if (this._aoPickMode) {
        this._aoPickMode = false;
        const pickBtn = this._controlPanelEl?.querySelector<HTMLElement>('#oprank-btn-ao-pick');
        if (pickBtn) { pickBtn.textContent = '📍 Set Target on Map'; pickBtn.classList.remove('picking'); }
        this._setAOCenter(new Point({
          longitude: mapPoint.longitude ?? mapPoint.x,
          latitude:  mapPoint.latitude  ?? mapPoint.y,
          spatialReference: WGS84,
        }));
        return;
      }

      if (this._ops.length >= 8) {
        this._setProgress(null, 'Maximum 8 OPs — remove one first');
        return;
      }
      this._addOP(new Point({
        longitude: mapPoint.longitude ?? mapPoint.x,
        latitude:  mapPoint.latitude  ?? mapPoint.y,
        spatialReference: WGS84,
      }));
    });
  }

  private _unbindMapClick(): void {
    this._clickHandle?.remove?.();
    this._clickHandle = null;
  }

  // ─── AO Centre ───────────────────────────────────────────────────────────────

  private _setAOCenter(pt: Point): void {
    this._aoCenterPt = pt;
    this._aoCenterLayer.removeAll();
    this._aoCenterLayer.addMany(this._buildAOCenterGraphics(pt));
    const lon = (pt.longitude ?? pt.x).toFixed(4);
    const lat = (pt.latitude  ?? pt.y).toFixed(4);
    this._setText('oprank-ao-coords', `Target: ${lat}°N  ${lon}°E`);
    const clearBtn = this._controlPanelEl?.querySelector<HTMLButtonElement>('#oprank-btn-ao-clear');
    if (clearBtn) clearBtn.disabled = false;
    this._syncHint();
    if (this._analysed && this._ops.length >= 2) void this._runAnalysis();
  }

  private _buildAOCenterGraphics(pt: Point): Graphic[] {
    const ring: Graphic = new Graphic({
      geometry: pt,
      symbol: {
        type: 'simple-marker', style: 'circle',
        color: [0, 0, 0, 0],
        size: 22,
        outline: { color: [255, 200, 0, 230], width: 2.5 },
      } as any,
    });
    const cross: Graphic = new Graphic({
      geometry: pt,
      symbol: {
        type: 'simple-marker', style: 'cross',
        color: [255, 200, 0, 230],
        size: 20,
        outline: { color: [255, 200, 0, 230], width: 2 },
      } as any,
    });
    const label: Graphic = new Graphic({
      geometry: pt,
      symbol: {
        type: 'text', text: 'TGT',
        color: [255, 200, 0, 230],
        haloColor: [0, 0, 0, 200], haloSize: 2,
        font: { family: 'Courier New', size: 9, weight: 'bold' },
        horizontalAlignment: 'center',
        verticalAlignment: 'bottom',
        yoffset: -16,
      } as any,
    });
    return [ring, cross, label];
  }

  // ─── OP Management ───────────────────────────────────────────────────────────

  private _addOP(pt: Point): void {
    const idx = this._ops.length;
    this._ops.push({ pt, index: idx, raster: null, stats: null, isOptimal: false });
    this._opLayer.add(this._buildOPMarker(pt, idx, false));
    this._opLayer.add(this._buildOPLabel(pt, idx));
    this._rangeLayer.add(this._buildRangeRing(pt, this._num('oprank-inp-range', 5000), OP_COLORS[idx % OP_COLORS.length]));
    this._analysed = false;
    this._cachedCoverage = null;
    this._syncSummary();
    this._syncHint();
    this._renderOPListPre();
  }

  private _removeOP(index: number): void {
    this._ops.splice(index, 1);
    this._ops.forEach((op, i) => {
      op.index = i;
      op.raster = null; op.stats = null;
      op.isOptimal = false; op.rank = undefined;
      op.compositeScore = undefined; op.elevAdv = undefined; op.mutualWith = undefined;
    });
    this._analysed = false;
    this._cachedCoverage = null;
    this._clearMedia();
    this._mutualVizLayer.removeAll();
    this._aoLayer.removeAll();
    this._rebuildMarkers(false);
    this._syncSummary();
    this._syncHint();
    this._renderOPListPre();
  }

  private _rebuildMarkers(resetStats = true): void {
    this._opLayer.removeAll();
    this._rangeLayer.removeAll();
    const maxR = this._num('oprank-inp-range', 5000);
    this._ops.forEach((op, i) => {
      if (resetStats) {
        op.raster = null; op.stats = null; op.isOptimal = false;
        op.compositeScore = undefined; op.elevAdv = undefined; op.mutualWith = undefined;
      }
      this._opLayer.add(this._buildOPMarker(op.pt, i, op.isOptimal));
      this._opLayer.add(this._buildOPLabel(op.pt, i));
      this._rangeLayer.add(this._buildRangeRing(op.pt, maxR, OP_COLORS[i % OP_COLORS.length]));
    });
  }

  private _clearAll(): void {
    this._ops = [];
    this._running = false;
    this._analysed = false;
    this._cachedCoverage = null;
    this._opLayer.removeAll();
    this._rangeLayer.removeAll();
    this._aoLayer.removeAll();
    this._mutualVizLayer.removeAll();
    this._clearMedia();
    this._setText('oprank-lph-sub', 'Place OPs on map then run analysis');
    this._setText('oprank-ss-cov', '-');
    this._setText('oprank-ss-gap', '-');
    const strip = this._el('oprank-optimal-strip');
    if (strip) strip.style.display = 'none';
    const recPanel = this._el('oprank-list-recommendation');
    if (recPanel) recPanel.style.display = 'none';
    const exportBtn = this._button('oprank-btn-export');
    if (exportBtn) exportBtn.disabled = true;
    this._setProgress(0, '-');
    this._setStatus('placing', 'Place OPs on map');
    this._renderEmptyList();
    this._syncSummary();
    this._syncHint();
  }

  // ─── Analysis pipeline ───────────────────────────────────────────────────────

  private async _runAnalysis(): Promise<void> {
    if (this._running || !this._view || this._ops.length < 2) return;
    this._running = true;
    this._button('oprank-btn-run')?.setAttribute('disabled', 'true');
    this._clearMedia();
    this._mutualVizLayer.removeAll();

    const eyeH      = this._num('oprank-inp-eye', 1.8);
    const maxRangeM = this._num('oprank-inp-range', 5000);
    const aoRadiusM = this._num('oprank-inp-ao', 4000);
    const cellM     = this._num('oprank-inp-cell', 50);
    const kCount    = this._num('oprank-inp-optimal', 3);

    // AO centre: user-set target takes priority over OP centroid
    const opCLon = this._ops.reduce((s, op) => s + (op.pt.longitude ?? op.pt.x), 0) / this._ops.length;
    const opCLat = this._ops.reduce((s, op) => s + (op.pt.latitude  ?? op.pt.y), 0) / this._ops.length;
    const aoCLon = this._aoCenterPt ? (this._aoCenterPt.longitude ?? this._aoCenterPt.x) : opCLon;
    const aoCLat = this._aoCenterPt ? (this._aoCenterPt.latitude  ?? this._aoCenterPt.y) : opCLat;

    const cosLat = Math.max(0.01, Math.cos((aoCLat * Math.PI) / 180));

    // Extent must cover all OPs + AO circle
    const distToAO = Math.sqrt(
      ((aoCLon - opCLon) * M_PER_DEG * cosLat) ** 2 +
      ((aoCLat - opCLat) * M_PER_DEG) ** 2
    );
    const padM  = Math.max(aoRadiusM, maxRangeM, distToAO + aoRadiusM) * 1.1;
    const padDeg = padM / M_PER_DEG;
    const extCLon = (aoCLon + opCLon) / 2;
    const extCLat = (aoCLat + opCLat) / 2;
    const extent = new Extent({
      xmin: extCLon - padDeg / cosLat, ymin: extCLat - padDeg,
      xmax: extCLon + padDeg / cosLat, ymax: extCLat + padDeg,
      spatialReference: WGS84,
    });
    const cols = Math.max(8, Math.ceil((padM * 2) / cellM));
    const rows = Math.max(8, Math.ceil((padM * 2) / cellM));

    this._cachedExtent = extent;
    this._cachedCols   = cols;
    this._cachedRows   = rows;
    this._cachedCellM  = cellM;

    this._aoLayer.removeAll();
    this._aoLayer.add(this._buildAOBoundary(aoCLon, aoCLat, aoRadiusM));
    this._setStatus('computing', 'Computing viewsheds…');

    try {
      // 1 — Viewsheds  (sampler created once and shared across all OPs)
      this._setProgress(0.02, 'Loading elevation data…');
      await this._tick();
      const sampler = await (this._view as any).map.ground.createElevationSampler(extent, { noDataValue: 0 });

      for (let i = 0; i < this._ops.length; i++) {
        this._setProgress((i / this._ops.length) * 0.60, `Viewshed ${i + 1}/${this._ops.length} — OP ${i + 1}`);
        await this._tick();
        let obsZ = eyeH;
        try {
          const er = await (this._view.map as any).ground.queryElevation(this._ops[i].pt);
          obsZ = ((er?.geometry?.z ?? 0) as number) + eyeH;
        } catch {}
        const { raster } = await this._computeViewshedRaster(
          this._ops[i].pt, obsZ, extent, cols, rows, cellM, maxRangeM, sampler,
        );
        this._ops[i].raster = raster;
        this._ops[i].obsZ   = obsZ;
      }

      // 2 — Coverage analysis (AO-centric)
      this._setProgress(0.62, 'Analysing AO coverage and gaps…');
      await this._tick();
      const rasters = this._ops.map(op => op.raster).filter((r): r is Uint8Array => !!r);
      const result  = this._analyseCoverage(rasters, cols, rows, aoRadiusM, extent, aoCLon, aoCLat);
      this._ops.forEach((op, i) => { op.stats = result.opStats[i]; });
      this._cachedCoverage = result;

      // 3 — Elevation advantage
      this._setProgress(0.68, 'Computing elevation advantage…');
      await this._tick();
      await this._enrichOpsWithElevAdvantage(aoCLon, aoCLat);

      // 4 — Mutual visibility
      this._setProgress(0.74, 'Computing mutual line-of-sight…');
      await this._tick();
      this._computeMutualVisibility(extent, cols, rows);

      // 5 — Optimal set
      this._setProgress(0.78, 'Selecting optimal OP set…');
      await this._tick();
      const optimalIndices = this._selectOptimalSet(rasters, kCount, result.aoMask, cols * rows);
      this._ops.forEach(op => { op.isOptimal = false; });
      optimalIndices.forEach(idx => { if (this._ops[idx]) this._ops[idx].isOptimal = true; });
      this._rebuildMarkers(false);

      // 6 — Composite scoring
      this._setProgress(0.82, 'Computing composite scores…');
      await this._tick();
      this._computeCompositeScores();

      // 7 — Sort by composite score
      const ranked = [...this._ops].sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
      ranked.forEach((op, i) => { op.rank = i + 1; });

      // 8 — Overlays
      this._setProgress(0.85, 'Rendering overlays…');
      await this._tick();
      this._redrawOverlays();

      // 9 — Coverage summary
      const covPct  = result.aoTotal > 0 ? Math.round((100 * result.combinedSeen) / result.aoTotal) : 0;
      const gapKm2  = ((result.gapCount * cellM * cellM) / 1e6).toFixed(2);
      this._setText('oprank-ss-cov', `${covPct}%`);
      this._setText('oprank-ss-gap', `${gapKm2} km²`);

      // 10 — Road access
      this._setProgress(0.92, 'Checking road access…');
      await this._enrichOpsWithRoadAccess(aoCLon, aoCLat);

      // Recompute composite with access data, then re-sort
      this._computeCompositeScores();
      const finalRanked = [...this._ops].sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
      finalRanked.forEach((op, i) => { op.rank = i + 1; });

      this._renderRankedList(finalRanked, result.aoTotal, cellM);
      this._renderOptimalResult(optimalIndices, kCount, result.aoTotal, result.combinedSeen);

      const exportBtn = this._button('oprank-btn-export');
      if (exportBtn) exportBtn.disabled = false;

      this._setProgress(1, `Done — ${this._ops.length} OPs ranked · ${covPct}% AO covered`);
      this._setStatus('done', 'Done');
      void this._view.goTo({ target: extent, tilt: 50 } as any, { duration: 900 });
      this._analysed = true;

    } catch (error) {
      console.warn('[OPRanker] Analysis failed', error);
      this._setStatus('error', 'Analysis failed');
      this._setProgress(null, 'Analysis failed — try a coarser grid or smaller range');
    } finally {
      this._running = false;
      this._syncSummary();
    }
  }

  // ─── Analysis sub-routines ───────────────────────────────────────────────────

  private async _enrichOpsWithElevAdvantage(aoCLon: number, aoCLat: number): Promise<void> {
    try {
      const er = await (this._view!.map as any).ground.queryElevation(
        new Point({ longitude: aoCLon, latitude: aoCLat, spatialReference: WGS84 })
      );
      this._aoCenterElevM = (er?.geometry?.z ?? 0) as number;
    } catch {
      this._aoCenterElevM = 0;
    }
    // elevAdv = observer terrain elevation above AO target terrain
    this._ops.forEach(op => {
      op.elevAdv = ((op.obsZ ?? 0) - this._num('oprank-inp-eye', 1.8)) - this._aoCenterElevM;
    });
  }

  private _computeMutualVisibility(extent: Extent, cols: number, rows: number): void {
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    this._ops.forEach(op => { op.mutualWith = []; });

    for (let i = 0; i < this._ops.length; i++) {
      for (let j = i + 1; j < this._ops.length; j++) {
        const a = this._ops[i];
        const b = this._ops[j];
        if (!a.raster || !b.raster) continue;

        const lonB = b.pt.longitude ?? b.pt.x;
        const latB = b.pt.latitude  ?? b.pt.y;
        const colB = Math.floor((lonB - extent.xmin) / dLon);
        const rowB = Math.floor((extent.ymax - latB)  / dLat);
        const aSeesB = colB >= 0 && colB < cols && rowB >= 0 && rowB < rows
                    && a.raster[rowB * cols + colB] === 1;

        const lonA = a.pt.longitude ?? a.pt.x;
        const latA = a.pt.latitude  ?? a.pt.y;
        const colA = Math.floor((lonA - extent.xmin) / dLon);
        const rowA = Math.floor((extent.ymax - latA)  / dLat);
        const bSeesA = colA >= 0 && colA < cols && rowA >= 0 && rowA < rows
                    && b.raster[rowA * cols + colA] === 1;

        if (aSeesB && bSeesA) {
          a.mutualWith!.push(j);
          b.mutualWith!.push(i);
        }
      }
    }
  }

  private _computeCompositeScores(): void {
    if (!this._ops.length) return;
    const elevAdvs = this._ops.map(op => op.elevAdv ?? 0);
    const minElev  = Math.min(...elevAdvs);
    const maxElev  = Math.max(...elevAdvs);
    const elevRange = maxElev - minElev + 0.1;
    const nOps = this._ops.length;

    this._ops.forEach(op => {
      if (!op.stats) return;
      const uniqueFrac = op.stats.uniquePct / 100;
      const totalFrac  = op.stats.totalPct  / 100;
      const normElev   = ((op.elevAdv ?? 0) - minElev) / elevRange;
      const normMutual = nOps > 1 ? (op.mutualWith?.length ?? 0) / (nOps - 1) : 0;

      let accessScore = 0.35;
      if (op.roadAccess === 'none') {
        accessScore = 0.05;
      } else if (op.roadAccess) {
        accessScore = op.roadAccess.rating === 'GO'      ? 1.0
                    : op.roadAccess.rating === 'SLOW-GO' ? 0.5
                    : 0.15;
      }

      op.compositeScore = OpRankerEngine._composite(uniqueFrac, totalFrac, normElev, normMutual, accessScore);
    });
  }

  /**
   * Single source of truth for the 5-term composite OP score, so the interactive
   * and headless paths can't drift. (Headless previously inlined only 3 terms —
   * omitting mutual-LOS and access — which capped its scores near 0.80 and
   * diverged from the panel ordering.)
   */
  private static _composite(
    uniqueFrac: number,
    totalFrac: number,
    normElev: number,
    normMutual: number,
    accessScore: number,
  ): number {
    return Math.round(
      (W_UNIQUE * uniqueFrac +
        W_TOTAL * totalFrac +
        W_ELEV * normElev +
        W_MUTUAL * normMutual +
        W_ACCESS * accessScore) *
        100,
    );
  }

  private async _computeViewshedRaster(
    opPt: Point, obsZ: number, extent: Extent,
    cols: number, rows: number, cellM: number, maxRangeM: number,
    sampler: any,
  ): Promise<{ raster: Uint8Array }> {
    const dLon  = (extent.xmax - extent.xmin) / cols;
    const dLat  = (extent.ymax - extent.ymin) / rows;
    const stepM = Math.max(cellM * 0.6, 20);
    const opLon = opPt.longitude ?? opPt.x;
    const opLat = opPt.latitude  ?? opPt.y;
    const cosLat = Math.cos((opLat * Math.PI) / 180);
    const horizonRes = 2;

    // Reuse one Point instance to avoid GC pressure in tight loops
    const scratchPt = new Point({ longitude: 0, latitude: 0, spatialReference: WGS84 });

    const isVisible = (brg: number, targetDist: number, targetSlope: number): boolean => {
      let maxSlope = -90;
      for (let dist = stepM; dist < targetDist - stepM * 0.5; dist += stepM) {
        const { longitude, latitude } = destPt(opLon, opLat, brg, dist);
        scratchPt.longitude = longitude;
        scratchPt.latitude  = latitude;
        const z = sampler.queryElevation(scratchPt)?.z ?? 0;
        maxSlope = Math.max(maxSlope, (Math.atan2(z - obsZ, dist) * 180) / Math.PI);
      }
      return targetSlope >= maxSlope;
    };

    const raster = new Uint8Array(cols * rows);
    // Yield every 12 rows so the main thread stays responsive during heavy computation
    for (let row = 0; row < rows; row++) {
      if (row % 12 === 0) await this._tick();
      for (let col = 0; col < cols; col++) {
        const lon  = extent.xmin + (col + 0.5) * dLon;
        const lat  = extent.ymax - (row + 0.5) * dLat;
        const east = (lon - opLon) * M_PER_DEG * cosLat;
        const north = (lat - opLat) * M_PER_DEG;
        const dist = Math.sqrt(east * east + north * north);
        if (dist < 2 || dist > maxRangeM) continue;
        const brg = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
        const snappedBrg = (Math.round(brg / horizonRes) % (360 / horizonRes)) * horizonRes;
        scratchPt.longitude = lon;
        scratchPt.latitude  = lat;
        const terrZ = sampler.queryElevation(scratchPt)?.z ?? 0;
        const slope = (Math.atan2(terrZ - obsZ, dist) * 180) / Math.PI;
        raster[row * cols + col] = isVisible(snappedBrg, dist, slope) ? 1 : 0;
      }
    }
    return { raster };
  }

  private _analyseCoverage(
    rasters: Uint8Array[], cols: number, rows: number,
    aoRadiusM: number, extent: Extent,
    aoCLon: number, aoCLat: number,
  ): CoverageResult {
    const total = cols * rows;
    const dLon  = (extent.xmax - extent.xmin) / cols;
    const dLat  = (extent.ymax - extent.ymin) / rows;
    const cosLat = Math.cos((aoCLat * Math.PI) / 180);

    const coverCount = new Uint8Array(total);
    rasters.forEach(r => { for (let i = 0; i < total; i++) if (r[i]) coverCount[i]++; });

    // AO mask centred on target, not OP centroid
    const aoMask = new Uint8Array(total);
    let aoTotal = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const lon  = extent.xmin + (col + 0.5) * dLon;
        const lat  = extent.ymax - (row + 0.5) * dLat;
        const east = (lon - aoCLon) * M_PER_DEG * cosLat;
        const north = (lat - aoCLat) * M_PER_DEG;
        if (Math.sqrt(east * east + north * north) <= aoRadiusM) {
          aoMask[row * cols + col] = 1;
          aoTotal++;
        }
      }
    }

    const opStats = rasters.map(r => {
      let totalSeen = 0; let uniqueSeen = 0;
      for (let i = 0; i < total; i++) {
        if (!aoMask[i] || !r[i]) continue;
        totalSeen++;
        if (coverCount[i] === 1) uniqueSeen++;
      }
      return {
        totalSeen, uniqueSeen,
        totalPct:  aoTotal > 0 ? (totalSeen  / aoTotal) * 100 : 0,
        uniquePct: aoTotal > 0 ? (uniqueSeen / aoTotal) * 100 : 0,
      };
    });

    let gapCount = 0; let combinedSeen = 0;
    for (let i = 0; i < total; i++) {
      if (!aoMask[i]) continue;
      if (coverCount[i] === 0) gapCount++;
      if (coverCount[i] > 0)  combinedSeen++;
    }
    return { coverCount, aoMask, aoTotal, opStats, gapCount, combinedSeen };
  }

  private _selectOptimalSet(rasters: Uint8Array[], kCount: number, aoMask: Uint8Array, total: number): number[] {
    const selected: number[] = [];
    const alreadySeen = new Uint8Array(total);
    for (let iter = 0; iter < Math.min(kCount, rasters.length); iter++) {
      let bestIdx = -1; let bestGain = -1;
      for (let k = 0; k < rasters.length; k++) {
        if (selected.includes(k)) continue;
        let gain = 0;
        for (let i = 0; i < total; i++) if (aoMask[i] && rasters[k][i] && !alreadySeen[i]) gain++;
        if (gain > bestGain) { bestGain = gain; bestIdx = k; }
      }
      if (bestIdx < 0) break;
      selected.push(bestIdx);
      for (let i = 0; i < total; i++) if (aoMask[i] && rasters[bestIdx][i]) alreadySeen[i] = 1;
    }
    return selected;
  }

  // ─── Overlay rendering ───────────────────────────────────────────────────────

  private _redrawOverlays(): void {
    if (!this._cachedCoverage || !this._cachedExtent) return;
    this._clearMedia();
    const opacity = this._num('oprank-inp-opa', 0.7);
    const { coverCount, aoMask } = this._cachedCoverage;

    if (this._ovState.combined) {
      this._addMediaLayer(this._buildHeatmapLayer(
        coverCount, aoMask, this._cachedCols, this._cachedRows,
        this._cachedExtent, opacity, this._ovState.gap, this._ovState.counts,
      ));
    }
    if (this._ovState.individual) {
      this._ops.forEach((op, i) => {
        if (!op.raster) return;
        this._addMediaLayer(this._buildIndividualViewshedLayer(
          op.raster, this._cachedCols, this._cachedRows,
          this._cachedExtent!, OP_COLORS[i % OP_COLORS.length], opacity,
        ));
      });
    }
    this._drawMutualVisibilityLines();
  }

  private _drawMutualVisibilityLines(): void {
    this._mutualVizLayer.removeAll();
    if (!this._ovState.mutual) return;
    const seen = new Set<string>();
    this._ops.forEach(opA => {
      (opA.mutualWith ?? []).forEach(j => {
        const key = `${Math.min(opA.index, j)}-${Math.max(opA.index, j)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const opB = this._ops[j];
        if (!opB) return;
        this._mutualVizLayer.add(new Graphic({
          geometry: new Polyline({
            paths: [[
              [opA.pt.longitude ?? opA.pt.x, opA.pt.latitude ?? opA.pt.y],
              [opB.pt.longitude ?? opB.pt.x, opB.pt.latitude ?? opB.pt.y],
            ]],
            spatialReference: WGS84,
          }),
          symbol: {
            type: 'simple-line',
            color: [80, 220, 130, 200],
            width: 1.8,
            style: 'dash',
          } as any,
        }));
      });
    });
  }

  private _buildHeatmapLayer(
    coverCount: Uint8Array, aoMask: Uint8Array,
    cols: number, rows: number, extent: Extent,
    opacity: number, showGap: boolean, showCounts: boolean,
  ): MediaLayer {
    const canvas = document.createElement('canvas');
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const px = i * 4;
      const cnt = coverCount[i];
      if (!aoMask[i]) {
        imgData.data[px + 3] = 0;
      } else if (cnt === 0 && showGap) {
        imgData.data[px] = 180; imgData.data[px+1] = 25; imgData.data[px+2] = 25; imgData.data[px+3] = Math.round(opacity * 180);
      } else if (cnt === 1 && showCounts) {
        imgData.data[px] = 55;  imgData.data[px+1] = 138; imgData.data[px+2] = 221; imgData.data[px+3] = Math.round(opacity * 160);
      } else if (cnt === 2 && showCounts) {
        imgData.data[px] = 55;  imgData.data[px+1] = 200; imgData.data[px+2] = 200; imgData.data[px+3] = Math.round(opacity * 150);
      } else if (cnt >= 3 && showCounts) {
        imgData.data[px] = 29;  imgData.data[px+1] = 158; imgData.data[px+2] = 117; imgData.data[px+3] = Math.round(opacity * 140);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return new MediaLayer({
      source: [new ImageElement({
        image: canvas.toDataURL('image/png'),
        georeference: new ExtentAndRotationGeoreference({ extent }),
      })],
      title: 'OP coverage heatmap', opacity: 1,
    });
  }

  private _buildIndividualViewshedLayer(
    raster: Uint8Array, cols: number, rows: number,
    extent: Extent, color: [number, number, number], opacity: number,
  ): MediaLayer {
    const [r, g, b] = color;
    const canvas = document.createElement('canvas');
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      if (!raster[i]) continue;
      const px = i * 4;
      imgData.data[px] = r; imgData.data[px+1] = g; imgData.data[px+2] = b;
      imgData.data[px+3] = Math.round(opacity * 120);
    }
    ctx.putImageData(imgData, 0, 0);
    return new MediaLayer({
      source: [new ImageElement({
        image: canvas.toDataURL('image/png'),
        georeference: new ExtentAndRotationGeoreference({ extent }),
      })],
      title: 'Individual viewshed', opacity: 1,
    });
  }

  private _buildAOBoundary(cLon: number, cLat: number, aoRadiusM: number): Graphic {
    const pts: number[][] = [];
    for (let i = 0; i <= 72; i++) {
      const { longitude, latitude } = destPt(cLon, cLat, (i / 72) * 360, aoRadiusM);
      pts.push([longitude, latitude]);
    }
    return new Graphic({
      geometry: new Polygon({ rings: [pts], spatialReference: WGS84 }),
      symbol: {
        type: 'simple-fill', color: [255, 200, 0, 8],
        outline: { color: [255, 200, 0, 180], width: 1.5, style: 'dash' },
      } as any,
      attributes: { type: 'AO boundary' },
    });
  }

  // ─── Marker builders ─────────────────────────────────────────────────────────

  private _buildOPMarker(pt: Point, index: number, isOptimal: boolean): Graphic {
    const [r, g, b] = OP_COLORS[index % OP_COLORS.length];
    const symbol = this._view?.type === '3d'
      ? {
          type: 'point-3d',
          symbolLayers: [{
            type: 'object',
            resource: { primitive: isOptimal ? 'diamond' : 'sphere' },
            material: { color: [r, g, b, 0.95] },
            width: isOptimal ? 100 : 70, height: isOptimal ? 100 : 70, depth: isOptimal ? 100 : 70,
          }],
          verticalOffset: { screenLength: 24, maxWorldLength: 600, minWorldLength: 5 },
        }
      : {
          type: 'simple-marker',
          style: isOptimal ? 'diamond' : 'circle',
          color: [r, g, b, 220],
          size: isOptimal ? 16 : 12,
          outline: { color: [255, 255, 255, 210], width: 1.2 },
        };
    return new Graphic({
      geometry: pt, symbol: symbol as any,
      attributes: {
        type: `OP ${index + 1}`,
        label: `OP ${index + 1} — ${(pt.latitude ?? pt.y).toFixed(4)}N ${(pt.longitude ?? pt.x).toFixed(4)}E`,
        opIndex: index,
      },
    });
  }

  private _buildOPLabel(pt: Point, index: number): Graphic {
    return new Graphic({
      geometry: pt,
      symbol: {
        type: 'text', text: `${index + 1}`,
        color: [255, 255, 255, 255],
        haloColor: [...OP_COLORS[index % OP_COLORS.length], 255], haloSize: 2.5,
        font: { family: 'Courier New', size: 10, weight: 'bold' },
        horizontalAlignment: 'center', verticalAlignment: 'middle', yoffset: 16,
      } as any,
    });
  }

  private _buildRangeRing(pt: Point, radiusM: number, color: [number, number, number]): Graphic {
    const [r, g, b] = color;
    const ring: number[][] = [];
    const lon = pt.longitude ?? pt.x;
    const lat = pt.latitude  ?? pt.y;
    for (let i = 0; i <= 48; i++) {
      const p = destPt(lon, lat, (i / 48) * 360, radiusM);
      ring.push([p.longitude, p.latitude]);
    }
    return new Graphic({
      geometry: new Polygon({ rings: [ring], spatialReference: WGS84 }),
      symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [r, g, b, 80], width: 1, style: 'dash' } } as any,
    });
  }

  // ─── List rendering ──────────────────────────────────────────────────────────

  private _renderEmptyList(): void {
    const list = this._el('oprank-op-list');
    if (!list) return;
    list.innerHTML = `
      <div id="oprank-list-empty">
        1. <strong style="color:#FFC832">Set AO Target</strong> — pick the objective on map.<br><br>
        2. Click map to place <strong style="color:#378ADD">Observation Post</strong> positions.<br><br>
        3. Place 2–8 candidates, then click<br>
        <strong style="color:#378ADD">Run Analysis</strong>.
      </div>
    `;
  }

  private _renderOPListPre(): void {
    const list = this._el('oprank-op-list');
    if (!list) return;
    if (!this._ops.length) { this._renderEmptyList(); return; }
    list.innerHTML = '';
    this._ops.forEach((op, i) => {
      const hex  = HEX_COLORS[i % HEX_COLORS.length];
      const card = document.createElement('div');
      card.className = 'oprank-op-card';
      card.innerHTML = `
        <div class="oprank-op-top">
          <div class="oprank-op-num">${i + 1}</div>
          <div>
            <div class="oprank-op-name"><span class="oprank-colour-dot" style="background:${hex}"></span>OP ${i + 1}</div>
            <div class="oprank-op-coords">${(op.pt.latitude ?? op.pt.y).toFixed(4)}N  ${(op.pt.longitude ?? op.pt.x).toFixed(4)}E</div>
          </div>
        </div>
        <div style="font-size:var(--ms-fs-xs);color:var(--ms-text-label);padding-top:4px">Run analysis to compute viewshed</div>
        <div class="oprank-op-actions">
          <button class="oprank-op-action-btn remove" data-k="${i}">Remove</button>
          <button class="oprank-op-action-btn" data-fly="${i}">Fly to</button>
        </div>
      `;
      card.querySelector('[data-k]')?.addEventListener('click', () => this._removeOP(i));
      card.querySelector('[data-fly]')?.addEventListener('click', () => this._flyTo(i));
      list.appendChild(card);
    });
    this._setText('oprank-lph-sub', 'Place OPs on map then run analysis');
  }

  private _renderRankedList(ranked: OpCandidate[], aoTotal: number, cellM: number): void {
    const list = this._el('oprank-op-list');
    if (!list) return;
    list.innerHTML = '';
    this._setText('oprank-lph-sub', `${ranked.length} OPs ranked by composite score`);
    const maxUnique = Math.max(1, ...ranked.map(op => op.stats?.uniqueSeen ?? 0));

    ranked.forEach(op => {
      const hex  = HEX_COLORS[op.index % HEX_COLORS.length];
      const s    = op.stats!;
      const uniquePct  = Math.round(s.uniquePct);
      const totalPct   = Math.round(s.totalPct);
      const uniqueBar  = Math.round((s.uniqueSeen / maxUnique) * 100);
      const uniqueKm2  = ((s.uniqueSeen * cellM * cellM) / 1e6).toFixed(2);
      const composite  = op.compositeScore ?? 0;

      // Elevation advantage
      const elevTxt = op.elevAdv != null
        ? (op.elevAdv >= 0 ? `+${Math.round(op.elevAdv)} m above TGT` : `${Math.round(op.elevAdv)} m below TGT`)
        : '—';
      const elevColor = (op.elevAdv ?? 0) >= 0 ? '#1D9E75' : '#DC3C30';

      // Mutual support
      const mutualCount = op.mutualWith?.length ?? 0;
      const mutualTxt   = mutualCount > 0
        ? op.mutualWith!.map(j => `OP ${j + 1}`).join(', ')
        : 'None — isolated';
      const mutualColor = mutualCount > 0 ? '#50d878' : '#DC3C30';

      // Assessment text
      let note = '';
      if (uniquePct > 25)    note = `Essential — ${uniqueKm2} km² only this OP can observe.`;
      else if (uniquePct > 10) note = `Valuable — removes ${uniqueKm2} km² of coverage if withdrawn.`;
      else if (uniquePct > 3)  note = 'Moderate contribution. Worth keeping if manpower allows.';
      else                     note = 'Viewshed largely duplicated — low priority.';
      if (op.isOptimal) note += ' In recommended set.';

      // Road access
      let roadTxt = '';
      if (op.roadAccess === 'none') {
        roadTxt = '<br><span style="color:#DC3C30;font-weight:600">⚠ No road access — air/foot insertion required.</span>';
      } else if (op.roadAccess) {
        const ratingColor = op.roadAccess.rating === 'GO' ? '#1D9E75' : op.roadAccess.rating === 'SLOW-GO' ? '#EF9F27' : '#DC3C30';
        roadTxt = `<br><span style="color:${ratingColor}">Road: ${op.roadAccess.km.toFixed(1)} km · ${Math.round(op.roadAccess.min)} min · <strong>${op.roadAccess.rating}</strong></span>`;
      }

      // Score colour
      const scoreColor = composite >= 65 ? '#1D9E75' : composite >= 40 ? '#EF9F27' : '#DC3C30';

      const card = document.createElement('div');
      card.className = `oprank-op-card${op.isOptimal ? ' in-optimal' : ''}`;
      card.innerHTML = `
        <div class="oprank-op-score-badge" style="color:${scoreColor}">${composite}</div>
        <div class="oprank-op-top">
          <div class="oprank-op-num${op.isOptimal ? ' optimal' : ''}">${op.rank ?? '-'}</div>
          <div style="flex:1">
            <div class="oprank-op-name"><span class="oprank-colour-dot" style="background:${hex}"></span>OP ${op.index + 1}${op.isOptimal ? ' ★' : ''}</div>
            <div class="oprank-op-coords">${(op.pt.latitude ?? op.pt.y).toFixed(4)}N  ${(op.pt.longitude ?? op.pt.x).toFixed(4)}E</div>
          </div>
        </div>
        <div class="oprank-op-bars">
          <div class="oprank-ob">
            <div class="oprank-ob-lbl">Unique coverage</div>
            <div class="oprank-ob-track"><div class="oprank-ob-fill" style="width:${uniqueBar}%;background:${hex}"></div></div>
            <div class="oprank-ob-val">${uniquePct}% (${uniqueKm2} km²)</div>
          </div>
          <div class="oprank-ob">
            <div class="oprank-ob-lbl">Total viewshed</div>
            <div class="oprank-ob-track"><div class="oprank-ob-fill" style="width:${totalPct}%;background:#378ADD"></div></div>
            <div class="oprank-ob-val">${totalPct}% of AO</div>
          </div>
        </div>
        <div class="oprank-op-factors">
          <div class="oprank-factor"><span class="oprank-factor-l">Elev adv</span><span class="oprank-factor-v" style="color:${elevColor}">${elevTxt}</span></div>
          <div class="oprank-factor"><span class="oprank-factor-l">Mutual LOS</span><span class="oprank-factor-v" style="color:${mutualColor}">${mutualTxt}</span></div>
        </div>
        <div class="oprank-op-note">${note}${roadTxt}</div>
        <div class="oprank-op-actions">
          <button class="oprank-op-action-btn" data-fly="${op.index}">Fly to</button>
          <button class="oprank-op-action-btn remove" data-k="${op.index}">Remove</button>
        </div>
      `;
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        this._listPanelEl?.querySelectorAll('.oprank-op-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this._flyTo(op.index);
      });
      card.querySelector('[data-k]')?.addEventListener('click', () => this._removeOP(op.index));
      card.querySelector('[data-fly]')?.addEventListener('click', () => this._flyTo(op.index));
      list.appendChild(card);
    });
    void aoTotal; // used by callers for summary stats
  }

  private _renderOptimalResult(indices: number[], kCount: number, aoTotal: number, combinedSeen: number): void {
    if (!indices.length) return;

    const covPct   = aoTotal > 0 ? Math.round((100 * combinedSeen) / aoTotal) : 0;
    const scores   = indices.map(idx => this._ops[idx]?.compositeScore ?? 0);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const covColor = covPct >= 80 ? '#1D9E75' : covPct >= 60 ? '#EF9F27' : '#DC3C30';

    // ── List panel recommendation banner ──────────────────────────────────────
    const recPanel = this._el('oprank-list-recommendation');
    const recOps   = this._el('oprank-rec-ops');
    const recStats = this._el('oprank-rec-stats');
    if (recPanel && recOps && recStats) {
      recPanel.style.display = 'block';
      recOps.innerHTML = indices.map(idx => {
        const op  = this._ops[idx];
        const hex = HEX_COLORS[idx % HEX_COLORS.length];
        const sc  = op?.compositeScore ?? 0;
        return `
          <div class="oprank-rec-card" style="border-color:${hex}22">
            <div class="oprank-rec-dot" style="background:${hex}"></div>
            <div class="oprank-rec-name">OP ${idx + 1}</div>
            <div class="oprank-rec-score" style="color:${hex}">${sc}</div>
          </div>`;
      }).join('');
      recStats.innerHTML = `
        <span class="oprank-rec-cov" style="color:${covColor}">${covPct}% AO covered</span>
        <span class="oprank-rec-avg">avg score ${avgScore}</span>
        <span class="oprank-rec-note">greedy max-coverage · ${kCount} OPs</span>
      `;
    }

    // ── Control panel strip (compact summary) ────────────────────────────────
    const strip = this._el('oprank-optimal-strip');
    const body  = this._el('oprank-optimal-body');
    if (strip && body) {
      strip.style.display = 'block';
      const names = indices.map(idx => `<strong style="color:${HEX_COLORS[idx % HEX_COLORS.length]}">OP ${idx + 1}</strong>`);
      body.innerHTML = `${names.join(', ')} · <strong style="color:${covColor}">${covPct}%</strong> AO · score ${avgScore}`;
    }
  }

  // ─── Road access ─────────────────────────────────────────────────────────────

  private _roadNet(): any { return (window as any).symbolEngine?.roadNetworkEngine ?? null; }

  private async _enrichOpsWithRoadAccess(cLon: number, cLat: number): Promise<void> {
    const rn = this._roadNet();
    if (!rn || this._ops.length === 0) return;
    let available = false;
    try { available = await rn.ensureAvailable(); } catch { available = false; }
    if (!available) return;

    const origin = { longitude: cLon, latitude: cLat };
    for (const op of this._ops) {
      let res: any = null;
      try {
        res = await rn.route(origin, {
          longitude: op.pt.longitude ?? op.pt.x,
          latitude:  op.pt.latitude  ?? op.pt.y,
        });
      } catch { res = { ok: false }; }
      op.roadAccess = res?.ok && res.data
        ? { km: res.data.distanceKm ?? 0, min: res.data.travelTimeMin ?? 0, rating: res.data.trafficability?.rating ?? 'GO' }
        : 'none';
    }
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  private _exportReport(): void {
    if (!this._analysed || !this._cachedCoverage) return;
    const cellM     = this._cachedCellM;
    const aoRadius  = this._num('oprank-inp-ao', 4000);
    const maxRange  = this._num('oprank-inp-range', 5000);
    const eyeH      = this._num('oprank-inp-eye', 1.8);
    const kCount    = this._num('oprank-inp-optimal', 3);
    const aoCLon    = this._aoCenterPt ? (this._aoCenterPt.longitude ?? this._aoCenterPt.x)
                      : this._ops.reduce((s, op) => s + (op.pt.longitude ?? op.pt.x), 0) / this._ops.length;
    const aoCLat    = this._aoCenterPt ? (this._aoCenterPt.latitude ?? this._aoCenterPt.y)
                      : this._ops.reduce((s, op) => s + (op.pt.latitude ?? op.pt.y), 0) / this._ops.length;

    const cv     = this._cachedCoverage;
    const covPct = cv.aoTotal > 0 ? Math.round(100 * cv.combinedSeen / cv.aoTotal) : 0;
    const gapKm2 = ((cv.gapCount * cellM * cellM) / 1e6).toFixed(2);

    const ranked = [...this._ops]
      .filter(op => op.stats)
      .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));

    const optIndices = this._ops.filter(op => op.isOptimal).map(op => op.index);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const lines: string[] = [
      'OBSERVATION POST RANKER — ANALYSIS REPORT',
      '==========================================',
      `Date/Time     : ${now} UTC`,
      `AO Centre     : ${aoCLat.toFixed(4)}°N  ${aoCLon.toFixed(4)}°E${this._aoCenterPt ? '' : '  [derived — no target set]'}`,
      `AO Radius     : ${(aoRadius / 1000).toFixed(1)} km`,
      `Max Obs Range : ${(maxRange  / 1000).toFixed(1)} km`,
      `Eye Height    : ${eyeH} m`,
      `Grid Cell     : ${cellM} m`,
      '',
      'RANKED OBSERVATION POSTS',
      '------------------------',
    ];

    ranked.forEach((op) => {
      const s   = op.stats!;
      const elv = op.elevAdv != null
        ? (op.elevAdv >= 0 ? `+${Math.round(op.elevAdv)} m above TGT` : `${Math.round(op.elevAdv)} m below TGT`)
        : 'n/a';
      const mutual  = op.mutualWith?.length ? op.mutualWith.map(j => `OP ${j + 1}`).join(', ') : 'None';
      let road = 'Unknown';
      if (op.roadAccess === 'none') road = 'No road access (air/foot insertion required)';
      else if (op.roadAccess) road = `${op.roadAccess.km.toFixed(1)} km, ${Math.round(op.roadAccess.min)} min [${op.roadAccess.rating}]`;

      lines.push(
        `Rank ${op.rank}${op.isOptimal ? ' ★' : ' '}: OP ${op.index + 1}  |  Composite Score: ${op.compositeScore ?? '-'}/100`,
        `  Position      : ${(op.pt.latitude ?? op.pt.y).toFixed(5)}°N  ${(op.pt.longitude ?? op.pt.x).toFixed(5)}°E`,
        `  Unique Cov    : ${s.uniquePct.toFixed(1)}%  (${((s.uniqueSeen * cellM * cellM) / 1e6).toFixed(2)} km²)`,
        `  Total Viewshed: ${s.totalPct.toFixed(1)}%  of AO`,
        `  Elev Advantage: ${elv}`,
        `  Mutual LOS    : ${mutual}`,
        `  Road Access   : ${road}`,
        '',
      );
    });

    lines.push(
      'OPTIMAL SET RECOMMENDATION',
      '--------------------------',
      `Best ${kCount} OP set : ${optIndices.map(i => `OP ${i + 1}`).join(', ') || 'N/A'}`,
      `Combined AO coverage  : ${covPct}%`,
      `Unobserved (gap) area : ${gapKm2} km²`,
      '',
      'ASSESSMENT',
      '----------',
      covPct >= 80
        ? 'GOOD COVERAGE — Recommended set covers ≥80% of AO.'
        : covPct >= 60
          ? 'MODERATE COVERAGE — Significant blind spots remain. Consider adding OPs or widening range.'
          : 'LOW COVERAGE — Critical gaps. Reposition OPs closer to dominant terrain, or increase AO radius.',
      '',
      '★ = In recommended optimal set',
      'Report generated by PAMS8 OpRankerEngine',
    );

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `OP_Ranker_${now.replace(/[: ]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    EngineLogger.success(ENGINE_NAME, `Report exported — ${ranked.length} OPs, ${covPct}% AO coverage`);
  }

  // ─── Media layer management ──────────────────────────────────────────────────

  private _addMediaLayer(layer: MediaLayer): void {
    const map = this._view?.map as any;
    if (!map) return;
    map.add(layer, 0);
    this._mediaLayers.push(layer);
  }

  private _clearMedia(): void {
    const map = this._view?.map as any;
    this._mediaLayers.forEach(layer => { try { map?.remove(layer); } catch {} });
    this._mediaLayers = [];
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  private _flyTo(index: number): void {
    const op = this._ops[index];
    if (!op || !this._view) return;
    void this._view.goTo({ center: [op.pt.longitude ?? op.pt.x, op.pt.latitude ?? op.pt.y], zoom: 14, tilt: 55 } as any, { duration: 800 });
  }

  // ─── Panel visibility ────────────────────────────────────────────────────────

  private _showPanels(): void {
    if (this._listPanelEl)    this._listPanelEl.style.display    = 'flex';
    if (this._controlPanelEl) this._controlPanelEl.style.display = 'block';
    if (this._hintEl)         this._hintEl.style.display         = 'block';
  }

  private _hidePanels(): void {
    if (this._listPanelEl)    this._listPanelEl.style.display    = 'none';
    if (this._controlPanelEl) this._controlPanelEl.style.display = 'none';
    if (this._hintEl)         this._hintEl.style.display         = 'none';
  }

  private _syncSummary(): void {
    this._setText('oprank-ss-ops', String(this._ops.length));
    const run = this._button('oprank-btn-run');
    if (run) run.disabled = this._ops.length < 2 || this._running;
  }

  private _syncHint(): void {
    if (!this._hintEl) return;
    if (this._aoPickMode) return; // hint already set by pick mode handler
    if (!this._aoCenterPt) {
      this._hintEl.textContent = this._ops.length === 0
        ? 'Step 1: Set AO Target → then click map to place OPs'
        : this._ops.length < 2
          ? 'Place at least 2 OPs then Run Analysis'
          : `${this._ops.length} OPs placed — click Run Analysis`;
    } else {
      this._hintEl.textContent = this._ops.length < 2
        ? 'Target set — now place 2+ OPs around it'
        : `${this._ops.length} OPs · Target set — click Run Analysis`;
    }
  }

  // ─── Drag ────────────────────────────────────────────────────────────────────

  private _makeDraggable(panel: HTMLElement, handleSelector: string): void {
    const handle = panel.querySelector<HTMLElement>(handleSelector);
    if (!handle) return;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button,input,select')) return;
      this._dragTarget = panel;
      const rect = panel.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    });
  }

  private _onDragMove = (e: MouseEvent): void => {
    if (!this._dragTarget) return;
    const panelW = this._dragTarget.offsetWidth  || 380;
    const panelH = this._dragTarget.offsetHeight || 0;
    const maxLeft = Math.max(0, window.innerWidth  - panelW - 16);
    const maxTop  = Math.max(0, window.innerHeight - panelH - 16);
    const left = Math.min(Math.max(0, e.clientX - this._dragOffsetX), maxLeft);
    const top  = Math.min(Math.max(0, e.clientY - this._dragOffsetY), maxTop);
    this._dragTarget.style.left  = `${left}px`;
    this._dragTarget.style.top   = `${top}px`;
    this._dragTarget.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._dragTarget = null;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  // ─── Utilities ───────────────────────────────────────────────────────────────

  private _setStatus(state: 'placing' | 'computing' | 'done' | 'error', text: string): void {
    const el = this._el('oprank-status');
    if (state === 'done')    EngineLogger.success(ENGINE_NAME, text);
    else if (state === 'error') EngineLogger.error(ENGINE_NAME, text);
    else                     EngineLogger.nextStep(ENGINE_NAME, text);
    if (!el) return;
    el.textContent = text;
    el.className = `oprank-ph-status ${state}`;
  }

  private _setProgress(frac: number | null, label: string): void {
    const fill = this._el('oprank-prog-fill');
    const lbl  = this._el('oprank-prog-label');
    if (fill && frac != null) fill.style.width = `${Math.round(frac * 100)}%`;
    if (fill && frac === 0)   fill.style.width = '0%';
    if (lbl) lbl.textContent = label;
  }

  private _el(id: string): HTMLElement | null { return document.getElementById(id); }
  private _input(id: string): HTMLInputElement | HTMLSelectElement | null {
    return this._el(id) as HTMLInputElement | HTMLSelectElement | null;
  }
  private _button(id: string): HTMLButtonElement | null { return this._el(id) as HTMLButtonElement | null; }
  private _num(id: string, fallback: number): number {
    const value = Number((this._input(id) as HTMLInputElement | null)?.value);
    return Number.isFinite(value) ? value : fallback;
  }
  private _checked(id: string, fallback: boolean): boolean {
    const el = this._input(id) as HTMLInputElement | null;
    return el ? el.checked : fallback;
  }
  private _setText(id: string, text: string): void {
    const el = this._el(id); if (el) el.textContent = text;
  }
  private _tick(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)); }

  // ─── Styles ──────────────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('op-ranker-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'op-ranker-engine-styles';
    style.textContent = `
      #oprank-list-panel,#oprank-ctrl-panel{
        --ms-bg:rgba(14,18,28,.97);--ms-bg-header:rgba(20,26,40,.98);--ms-bg-input:rgba(0,0,0,.28);
        --ms-border:rgba(90,140,220,.25);--ms-divider:rgba(80,100,150,.18);
        --ms-text:#dce8f5;--ms-text-dim:rgba(175,200,230,.82);--ms-text-label:rgba(140,170,205,.85);
        --ms-accent:#378ADD;--ms-accent-2:#1D9E75;--ms-radius:9px;
        --ms-fs:12px;--ms-fs-sm:13px;--ms-fs-xs:11px;
        --ms-shadow:0 8px 36px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.04);
        position:fixed;z-index:1100;background:var(--ms-bg);border:1px solid var(--ms-border);
        border-radius:var(--ms-radius);color:var(--ms-text);
        font-family:'SF Pro Display','Segoe UI',system-ui,sans-serif;font-size:var(--ms-fs);
        box-shadow:var(--ms-shadow);user-select:none;overflow:hidden}

      #oprank-list-panel{top:60px;left:14px;width:480px;max-height:calc(100vh - 88px);display:none;flex-direction:column}
      #oprank-ctrl-panel{top:60px;right:14px;width:480px;max-height:calc(100vh - 88px);overflow-y:auto;display:none}

      .oprank-lph,.oprank-ph{padding:10px 14px 9px;border-bottom:1px solid var(--ms-divider);background:var(--ms-bg-header);cursor:grab}
      .oprank-lph-title,.oprank-ph-title{font-size:var(--ms-fs);letter-spacing:.13em;text-transform:uppercase;color:var(--ms-accent);font-weight:700}
      .oprank-lph-sub{font-size:var(--ms-fs-xs);color:var(--ms-text-label);letter-spacing:.05em;margin-top:2px}
      .oprank-ph{display:flex;align-items:center;gap:7px;position:sticky;top:0;z-index:2}
      .oprank-ph-title{flex:1}
      .oprank-ph-tools{display:flex;gap:3px}
      .oprank-help-btn,.oprank-min-btn,.oprank-close-btn,.oprank-help-close{
        background:var(--ms-bg-input);border:1px solid var(--ms-border);color:var(--ms-text-dim);
        border-radius:3px;font-family:inherit;font-size:var(--ms-fs);cursor:pointer}
      .oprank-help-btn{width:19px;height:19px;border-radius:50%;color:var(--ms-accent-2);font-weight:700}
      .oprank-help-btn:hover,.oprank-min-btn:hover,.oprank-close-btn:hover,.oprank-help-close:hover{color:var(--ms-text)}
      .oprank-ph-status{font-size:var(--ms-fs-xs);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label)}
      .oprank-ph-status.placing{color:var(--ms-accent)}.oprank-ph-status.computing{color:#EF9F27}
      .oprank-ph-status.done{color:var(--ms-accent-2)}.oprank-ph-status.error{color:#DC3C30}

      #oprank-summary-strip{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--ms-divider);flex-shrink:0}
      .oprank-ss-cell{padding:8px 11px;display:flex;flex-direction:column;gap:2px;border-right:1px solid var(--ms-divider)}
      .oprank-ss-cell:last-child{border-right:none}
      .oprank-ss-l{font-size:var(--ms-fs-xs);letter-spacing:.08em;text-transform:uppercase;color:var(--ms-text-label);font-weight:600}
      .oprank-ss-v{font-size:var(--ms-fs-sm);font-weight:700;color:var(--ms-accent)}

      #oprank-op-list{overflow-y:auto;flex:1;padding:7px}
      .oprank-op-card{background:var(--ms-bg-input);border:1px solid var(--ms-divider);border-radius:5px;padding:9px 11px;margin-bottom:6px;cursor:pointer;transition:all .12s;position:relative}
      .oprank-op-card:hover{background:var(--ms-bg-header);border-color:var(--ms-accent)}
      .oprank-op-card.selected{border-color:var(--ms-accent);background:var(--ms-bg-header)}
      .oprank-op-card.in-optimal{border-left:3px solid var(--ms-accent-2)}
      .oprank-op-top{display:flex;align-items:center;gap:8px;margin-bottom:6px}
      .oprank-op-num{width:26px;height:26px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:var(--ms-fs);font-weight:700;flex-shrink:0;background:rgba(55,138,221,.15);color:var(--ms-accent);border:1px solid var(--ms-border)}
      .oprank-op-num.optimal{background:rgba(29,158,117,.15);color:var(--ms-accent-2);border-color:rgba(29,158,117,.5)}
      .oprank-op-name{font-size:var(--ms-fs);font-weight:600;color:var(--ms-text);display:flex;align-items:center;gap:5px}
      .oprank-op-coords{font-size:var(--ms-fs-xs);color:var(--ms-text-label);letter-spacing:.04em;margin-top:1px}

      /* Composite score badge — top right of card */
      .oprank-op-score-badge{position:absolute;top:9px;right:10px;font-size:13px;font-weight:800;letter-spacing:-.5px}

      .oprank-op-bars{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;margin-bottom:6px}
      .oprank-ob{display:flex;flex-direction:column;gap:2px}
      .oprank-ob-lbl{font-size:var(--ms-fs-xs);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label);font-weight:600}
      .oprank-ob-track{height:6px;background:rgba(255,255,255,.06);border-radius:2px}
      .oprank-ob-fill{height:100%;border-radius:2px}
      .oprank-ob-val{font-size:var(--ms-fs-xs);color:var(--ms-text-dim)}

      /* Factor rows (elevation, mutual LOS) */
      .oprank-op-factors{display:flex;flex-direction:column;gap:3px;margin-bottom:6px;padding:5px 0;border-top:1px solid var(--ms-divider)}
      .oprank-factor{display:flex;align-items:center;gap:6px}
      .oprank-factor-l{font-size:var(--ms-fs-xs);color:var(--ms-text-label);text-transform:uppercase;letter-spacing:.06em;font-weight:600;flex:0 0 86px}
      .oprank-factor-v{font-size:var(--ms-fs-xs);font-weight:600;flex:1}

      .oprank-op-note{font-size:var(--ms-fs-xs);color:var(--ms-text-dim);line-height:1.5;border-top:1px solid var(--ms-divider);padding-top:6px}
      .oprank-op-actions{display:flex;gap:5px;margin-top:7px}
      .oprank-op-action-btn{font-size:var(--ms-fs-xs);letter-spacing:.05em;text-transform:uppercase;padding:4px 8px;border-radius:3px;border:1px solid var(--ms-border);background:transparent;color:var(--ms-text-dim);cursor:pointer;font-family:inherit;font-weight:600}
      .oprank-op-action-btn:hover{background:var(--ms-bg-header);color:var(--ms-text)}
      .oprank-op-action-btn.remove{border-color:rgba(220,60,48,.4);color:rgba(220,80,72,.85)}

      #oprank-list-empty{padding:20px 14px;font-size:var(--ms-fs);color:var(--ms-text-label);text-align:center;line-height:2}
      .oprank-colour-dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex-shrink:0}

      /* AO note */
      .oprank-ao-note{font-size:var(--ms-fs-xs);color:var(--ms-text-label);margin-top:4px;padding:4px 6px;background:rgba(255,200,0,.05);border:1px solid rgba(255,200,0,.15);border-radius:4px}

      /* Platform presets */
      .oprank-platform-row{display:flex;gap:4px;margin-bottom:8px}
      .oprank-plat-btn{flex:1;padding:5px 4px;font-size:var(--ms-fs-xs);letter-spacing:.04em;text-align:center;cursor:pointer;border-radius:4px;border:1px solid var(--ms-border);background:var(--ms-bg-input);color:var(--ms-text-dim);font-family:inherit;transition:all .13s;line-height:1.6}
      .oprank-plat-btn span{display:block;font-weight:700;color:var(--ms-text-label)}
      .oprank-plat-btn:hover{background:var(--ms-bg-header);color:var(--ms-text)}
      .oprank-plat-btn.active{border-color:var(--ms-accent);color:var(--ms-accent);background:rgba(55,138,221,.12)}
      .oprank-plat-btn.active span{color:var(--ms-accent)}

      /* Control panel body layout */
      .oprank-ps{font-size:var(--ms-fs);letter-spacing:.12em;text-transform:uppercase;color:var(--ms-accent);font-weight:700;padding:11px 14px 6px}
      .oprank-pg{display:grid;grid-template-columns:1fr 1fr;gap:9px 10px;padding:0 12px 9px}
      .oprank-pf{display:flex;flex-direction:column;gap:3px}
      .oprank-pf.full{grid-column:1/-1}
      .oprank-pl{font-size:var(--ms-fs-xs);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label);font-weight:600}

      #oprank-ctrl-panel input,#oprank-ctrl-panel select{
        background:var(--ms-bg-input);border:1px solid var(--ms-border);border-radius:4px;
        color:var(--ms-text);font-family:inherit;font-size:var(--ms-fs);padding:7px 9px;
        width:100%;outline:none;transition:border-color .15s;box-sizing:border-box}
      #oprank-ctrl-panel input:focus,#oprank-ctrl-panel select:focus{border-color:var(--ms-accent)}
      #oprank-ctrl-panel select option{background:var(--ms-bg)}

      .oprank-psr{display:flex;align-items:center;gap:8px;padding:0 12px 8px}
      .oprank-psr-l{font-size:var(--ms-fs-xs);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label);flex:1.8;font-weight:600}
      .oprank-psr input[type=range]{flex:2;accent-color:var(--ms-accent);cursor:pointer}
      .oprank-psr-v{font-size:var(--ms-fs);color:var(--ms-accent);min-width:42px;text-align:right;font-weight:600}
      .oprank-pdiv{height:1px;background:var(--ms-divider);margin:6px 0}
      .oprank-ptr{display:flex;align-items:center;justify-content:space-between;padding:6px 14px}
      .oprank-ptr label{font-size:var(--ms-fs-xs);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-label);cursor:pointer;font-weight:600}
      .oprank-ptr input[type=checkbox]{accent-color:var(--ms-accent);width:15px;height:15px;cursor:pointer}

      .oprank-ov-row{display:flex;gap:5px;padding:0 12px 9px;flex-wrap:wrap}
      .oprank-ov-btn{flex:1;min-width:60px;padding:7px 4px;font-size:var(--ms-fs-xs);letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:4px;border:1px solid var(--ms-border);background:var(--ms-bg-input);color:var(--ms-text-dim);font-family:inherit;transition:all .13s;font-weight:600}
      .oprank-ov-btn:hover{background:var(--ms-bg-header);color:var(--ms-text)}
      .oprank-ov-btn.on{border-color:var(--ms-accent);color:var(--ms-accent);background:rgba(55,138,221,.12)}
      .oprank-ov-btn.gap-on{border-color:rgba(220,60,48,.55);color:#DC3C30;background:rgba(220,60,48,.12)}
      .oprank-ov-btn.mutual-on{border-color:rgba(80,220,130,.55);color:#50DC82;background:rgba(80,220,130,.10)}

      #oprank-prog-wrap{padding:0 12px 9px}
      #oprank-prog-track{height:6px;background:var(--ms-bg-input);border:1px solid var(--ms-divider);border-radius:3px;overflow:hidden}
      #oprank-prog-fill{height:100%;background:linear-gradient(90deg,var(--ms-accent-2),var(--ms-accent));border-radius:2px;width:0%;transition:width .16s}
      #oprank-prog-label{font-size:var(--ms-fs-xs);color:var(--ms-text-label);letter-spacing:.05em;margin-top:5px}

      .oprank-optimal-strip{margin:0 12px 9px;padding:9px 11px;background:rgba(29,158,117,.07);border:1px solid rgba(29,158,117,.28);border-radius:4px}
      .oprank-opt-label{font-size:var(--ms-fs-xs);letter-spacing:.08em;text-transform:uppercase;color:var(--ms-accent-2);margin-bottom:5px;font-weight:700}
      .oprank-opt-body{font-size:var(--ms-fs);color:var(--ms-text-dim);line-height:1.6}

      .oprank-pb-row{display:flex;gap:7px;padding:9px 12px 0}
      .oprank-pb-row:last-child{padding-bottom:11px}
      .oprank-pb{flex:1;padding:8px 5px;font-family:inherit;font-size:var(--ms-fs-xs);letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:4px;border:1px solid var(--ms-border);background:var(--ms-bg-input);color:var(--ms-text-dim);font-weight:600;transition:all .14s}
      .oprank-pb:hover:not(:disabled){background:var(--ms-bg-header);color:var(--ms-text)}
      .oprank-pb.primary{background:rgba(55,138,221,.14);border-color:var(--ms-accent);color:var(--ms-accent);font-weight:700}
      .oprank-pb.picking{background:rgba(255,160,0,.15);border-color:rgba(255,160,0,.6);color:#FFA000;font-weight:700;animation:oprank-pulse .9s ease-in-out infinite}
      .oprank-pb:disabled{opacity:.35;cursor:not-allowed}
      @keyframes oprank-pulse{0%,100%{opacity:.7}50%{opacity:1}}

      #oprank-hint{position:fixed;bottom:55px;left:50%;transform:translateX(-50%);
        background:rgba(26,32,48,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
        border:1px solid rgba(55,138,221,.45);box-shadow:0 4px 16px rgba(0,0,0,.35);
        color:#7FB8EA;font-family:'SF Pro Display','Segoe UI',system-ui,sans-serif;
        font-size:var(--ms-fs);letter-spacing:.08em;padding:9px 22px;border-radius:6px;
        pointer-events:none;z-index:1100;text-transform:uppercase;display:none;font-weight:600}

      .oprank-help-popover{position:absolute;top:39px;left:8px;right:8px;z-index:1120;
        max-height:min(540px,calc(100vh - 132px));overflow-y:auto;background:var(--ms-bg);
        border:1px solid var(--ms-border);border-radius:var(--ms-radius);box-shadow:var(--ms-shadow);color:var(--ms-text)}
      .oprank-help-popover[hidden]{display:none}
      .oprank-help-head{display:flex;justify-content:space-between;gap:10px;padding:11px 12px 9px;border-bottom:1px solid var(--ms-divider);background:var(--ms-bg-header)}
      .oprank-help-kicker{font-size:var(--ms-fs-xs);color:var(--ms-text-label);letter-spacing:.09em;text-transform:uppercase;font-weight:600}
      .oprank-help-title{margin-top:2px;font-size:12px;color:var(--ms-accent);font-weight:700}
      .oprank-help-body{padding:11px 12px 13px;font-size:var(--ms-fs);line-height:1.5;color:var(--ms-text-dim);user-select:text}
      .oprank-help-body p{margin:0 0 9px}
      .oprank-help-block{margin-top:11px}
      .oprank-help-block h4{margin:0 0 6px;font-size:var(--ms-fs);letter-spacing:.08em;text-transform:uppercase;color:var(--ms-text);font-weight:700}
      .oprank-help-block ol{margin:0;padding-left:18px}
      .oprank-help-block li{margin:4px 0}
      .oprank-help-block dl{display:grid;grid-template-columns:130px minmax(0,1fr);gap:6px 10px;margin:0}
      .oprank-help-block dt{color:var(--ms-accent);font-weight:700}
      .oprank-help-block dd{margin:0}

      /* ── Recommendation banner (list panel) ── */
      #oprank-list-recommendation{
        flex-shrink:0;padding:9px 12px 10px;
        background:linear-gradient(135deg,rgba(29,158,117,.10) 0%,rgba(55,138,221,.06) 100%);
        border-bottom:1px solid rgba(29,158,117,.28)}
      .oprank-rec-label{
        font-size:var(--ms-fs-xs);letter-spacing:.1em;text-transform:uppercase;
        color:var(--ms-accent-2);font-weight:700;margin-bottom:7px}
      .oprank-rec-ops{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px}
      .oprank-rec-card{
        display:flex;align-items:center;gap:5px;padding:5px 8px;
        background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.08);
        border-radius:5px;flex:1;min-width:70px}
      .oprank-rec-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .oprank-rec-name{font-size:var(--ms-fs);font-weight:600;color:var(--ms-text);flex:1}
      .oprank-rec-score{font-size:12px;font-weight:800}
      .oprank-rec-stats{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .oprank-rec-cov{font-size:var(--ms-fs-sm);font-weight:700}
      .oprank-rec-avg{font-size:var(--ms-fs-xs);color:var(--ms-text-dim);font-weight:600}
      .oprank-rec-note{font-size:var(--ms-fs-xs);color:var(--ms-text-label);letter-spacing:.04em;margin-left:auto}

      @media(max-width:720px){
        #oprank-list-panel{left:10px;top:62px;width:calc(100vw - 20px);max-height:34vh}
        #oprank-ctrl-panel{left:10px;right:auto;top:calc(34vh + 72px);width:calc(100vw - 20px);max-height:calc(66vh - 88px)}
        .oprank-pg{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }
}

export default OpRankerEngine;
