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
import EngineLogger from '../../../Support/EngineLogger';

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'OpRankerEngine';
const EARTH_R = 6_371_008.8;
const M_PER_DEG = 111_320;

const OP_COLORS: Array<[number, number, number]> = [
  [55, 138, 221],
  [239, 159, 39],
  [180, 40, 220],
  [29, 158, 117],
  [220, 60, 48],
  [245, 240, 64],
  [100, 200, 100],
  [255, 120, 180],
];

const HEX_COLORS = [
  '#378ADD',
  '#EF9F27',
  '#B428DC',
  '#1D9E75',
  '#DC3C30',
  '#F5F040',
  '#64C864',
  '#FF78B4',
];

interface OpStats {
  totalSeen: number;
  uniqueSeen: number;
  totalPct: number;
  uniquePct: number;
}

interface OpCandidate {
  pt: Point;
  index: number;
  raster: Uint8Array | null;
  stats: OpStats | null;
  obsZ?: number;
  isOptimal: boolean;
  rank?: number;
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
}

export interface OpRankSummary {
  candidates: Array<{
    point: Point;
    rank: number;
    uniquePct: number;
    totalPct: number;
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
  static readonly OP_LAYER_ID = 'op-ranker-markers';
  static readonly RANGE_LAYER_ID = 'op-ranker-range-rings';
  static readonly AO_LAYER_ID = 'op-ranker-ao-boundary';

  private _view: MapView | SceneView | null = null;
  private _opLayer!: GraphicsLayer;
  private _rangeLayer!: GraphicsLayer;
  private _aoLayer!: GraphicsLayer;
  private _mediaLayers: MediaLayer[] = [];
  private _listPanelEl: HTMLDivElement | null = null;
  private _controlPanelEl: HTMLDivElement | null = null;
  private _hintEl: HTMLDivElement | null = null;
  private _clickHandle: any = null;
  private _ops: OpCandidate[] = [];
  private _running = false;
  private _analysed = false;
  private _ovState: OverlayState = {
    combined: true,
    counts: true,
    gap: true,
    individual: false,
    overlap: true,
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
      map.addMany([this._aoLayer, this._rangeLayer, this._opLayer]);
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
    const eyeH = options.observerHeightM ?? 1.8;
    const maxRangeM = options.maxRangeM ?? 3500;
    const aoRadiusM = options.aoRadiusM ?? 3000;
    const cellM = options.cellM ?? 120;
    const kCount = options.optimalCount ?? Math.min(3, points.length);
    const cLon = points.reduce((sum, pt) => sum + (pt.longitude ?? pt.x), 0) / points.length;
    const cLat = points.reduce((sum, pt) => sum + (pt.latitude ?? pt.y), 0) / points.length;
    const cosLat = Math.max(0.01, Math.cos((cLat * Math.PI) / 180));
    const padM = Math.max(aoRadiusM, maxRangeM) * 1.1;
    const padDeg = padM / M_PER_DEG;
    const extent = new Extent({
      xmin: cLon - padDeg / cosLat,
      ymin: cLat - padDeg,
      xmax: cLon + padDeg / cosLat,
      ymax: cLat + padDeg,
      spatialReference: WGS84,
    });
    const cols = Math.max(8, Math.ceil((padM * 2) / cellM));
    const rows = Math.max(8, Math.ceil((padM * 2) / cellM));
    const rasters: Uint8Array[] = [];
    for (const pt of points) {
      let obsZ = eyeH;
      try {
        const er = await (this._view.map as any).ground.queryElevation(pt);
        obsZ = ((er?.geometry?.z ?? 0) as number) + eyeH;
      } catch {}
      const { raster } = await this._computeViewshedRaster(pt, obsZ, extent, cols, rows, cellM, maxRangeM);
      rasters.push(raster);
    }
    const result = this._analyseCoverage(rasters, cols, rows, aoRadiusM, extent);
    const optimalIndices = this._selectOptimalSet(rasters, kCount, result.aoMask, cols * rows);
    const ranked = points.map((point, index) => ({
      point,
      rank: 0,
      uniquePct: result.opStats[index]?.uniquePct ?? 0,
      totalPct: result.opStats[index]?.totalPct ?? 0,
      optimal: optimalIndices.includes(index),
    })).sort((a, b) => b.uniquePct - a.uniquePct);
    ranked.forEach((item, index) => { item.rank = index + 1; });
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
      [this._opLayer, this._rangeLayer, this._aoLayer, ...this._mediaLayers].forEach((layer) => {
        try { map.remove(layer); } catch {}
      });
    }
    this._listPanelEl?.remove();
    this._controlPanelEl?.remove();
    this._hintEl?.remove();
    this._listPanelEl = null;
    this._controlPanelEl = null;
    this._hintEl = null;
    this._view = null;
  }

  private _createLayers(): void {
    this._opLayer = new GraphicsLayer({
      id: OpRankerEngine.OP_LAYER_ID,
      title: 'OP Ranker - Markers',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._rangeLayer = new GraphicsLayer({
      id: OpRankerEngine.RANGE_LAYER_ID,
      title: 'OP Ranker - Range Rings',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._aoLayer = new GraphicsLayer({
      id: OpRankerEngine.AO_LAYER_ID,
      title: 'OP Ranker - AO Boundary',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    (this._opLayer as any).popupTemplate = { title: '{type}', content: '{label}' };
  }

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
      this._hintEl.textContent = 'Click map to place a candidate OP - place 2-8 then Run Analysis';
      document.body.appendChild(this._hintEl);
    }
    this._syncSummary();
    if (!this._ops.length) this._renderEmptyList();
  }

  private _listPanelHtml(): string {
    return `
      <div class="oprank-lph">
        <div class="oprank-lph-title">Observation Post Ranker</div>
        <div class="oprank-lph-sub" id="oprank-lph-sub">Place OPs on map - then run analysis</div>
      </div>
      <div id="oprank-summary-strip">
        <div class="oprank-ss-cell"><div class="oprank-ss-l">OPs placed</div><div class="oprank-ss-v" id="oprank-ss-ops">0</div></div>
        <div class="oprank-ss-cell"><div class="oprank-ss-l">AO coverage</div><div class="oprank-ss-v" id="oprank-ss-cov">-</div></div>
        <div class="oprank-ss-cell"><div class="oprank-ss-l">Gap area</div><div class="oprank-ss-v" id="oprank-ss-gap">-</div></div>
      </div>
      <div id="oprank-op-list"></div>
    `;
  }

  private _controlPanelHtml(): string {
    return `
      <div class="oprank-ph">
        <div class="oprank-ph-title">OP Analysis</div>
        <div class="oprank-ph-tools">
          <button class="oprank-help-btn" id="oprank-help-btn" title="OP Ranker Wiki">?</button>
          <button class="oprank-min-btn" id="oprank-min-btn" title="Minimize">v</button>
          <button class="oprank-close-btn" id="oprank-close-btn" title="Close">x</button>
        </div>
        <div class="oprank-ph-status placing" id="oprank-status">Place OPs on map</div>
      </div>
      <div class="oprank-help-popover" id="oprank-help-popover" hidden>
        <div class="oprank-help-head"><div><div class="oprank-help-kicker">Wiki</div><div class="oprank-help-title">Observation Post Ranker</div></div><button id="oprank-help-close" class="oprank-help-close">x</button></div>
        <div class="oprank-help-body">
          <p>Ranks candidate observation posts by terrain viewshed, unique coverage contribution, area-of-observation coverage, gaps, and recommended set coverage.</p>
          <div class="oprank-help-block"><h4>Workflow</h4><ol><li>Open the widget from More Actions or a symbol context menu.</li><li>Click the map to place 2-8 candidate OPs.</li><li>Adjust observer height, range, AO radius, grid cell size, and optimal set size.</li><li>Run analysis to rank OPs and render gap/coverage overlays.</li></ol></div>
          <div class="oprank-help-block"><h4>Scoring</h4><dl><dt>Unique</dt><dd>AO cells only visible from one OP. High unique coverage means the OP is hard to replace.</dd><dt>Total</dt><dd>All AO cells visible from the OP, including duplicated coverage.</dd><dt>Gaps</dt><dd>AO cells unseen by any candidate OP.</dd><dt>Optimal</dt><dd>Greedy maximum-coverage set. It is fast and gives a strong approximation for OP selection.</dd></dl></div>
          <div class="oprank-help-block"><h4>Overlays</h4><dl><dt>Coverage</dt><dd>Master display for generated coverage rasters.</dd><dt>Count heatmap</dt><dd>Shows how many OPs can see each AO cell.</dd><dt>Gap zones</dt><dd>Highlights blind cells inside the AO.</dd><dt>Individual</dt><dd>Draws per-OP viewsheds using the OP colors.</dd></dl></div>
        </div>
      </div>
      <div class="oprank-body">
        <div class="oprank-ps">Observer parameters</div>
        <div class="oprank-pg">
          <div class="oprank-pf"><div class="oprank-pl">Eye height (m)</div><input id="oprank-inp-eye" type="number" value="1.8" min="0.5" max="10" step="0.1"/></div>
          <div class="oprank-pf"><div class="oprank-pl">Max obs range (m)</div><input id="oprank-inp-range" type="number" value="5000" min="500" max="20000" step="200"/></div>
        </div>
        <div class="oprank-ps">Area of observation (AO)</div>
        <div class="oprank-pg"><div class="oprank-pf full"><div class="oprank-pl">AO radius (m) - defines coverage scoring area</div><select id="oprank-inp-ao"><option value="2000">2 km</option><option value="4000" selected>4 km</option><option value="6000">6 km</option><option value="10000">10 km</option></select></div></div>
        <div class="oprank-ps">Grid resolution</div>
        <div class="oprank-pg"><div class="oprank-pf full"><div class="oprank-pl">Cell size (m)</div><select id="oprank-inp-cell"><option value="30">30 m - fine</option><option value="50" selected>50 m - balanced</option><option value="80">80 m - fast</option></select></div></div>
        <div class="oprank-ps">Optimal OP set</div>
        <div class="oprank-pg"><div class="oprank-pf full"><div class="oprank-pl">How many OPs to recommend</div><select id="oprank-inp-optimal"><option value="1">Best single OP</option><option value="2">Best 2 OPs</option><option value="3" selected>Best 3 OPs</option><option value="4">Best 4 OPs</option></select></div></div>
        <div class="oprank-pdiv"></div>
        <div class="oprank-ps">Overlays</div>
        <div class="oprank-ov-row">
          <button class="oprank-ov-btn on" data-ov="combined">Coverage</button>
          <button class="oprank-ov-btn on" data-ov="counts">Count heatmap</button>
          <button class="oprank-ov-btn gap-on" data-ov="gap">Gap zones</button>
        </div>
        <div class="oprank-psr"><div class="oprank-psr-l">Overlay opacity</div><input id="oprank-inp-opa" type="range" min="0.2" max="1.0" step="0.05" value="0.70"/><div class="oprank-psr-v" id="oprank-opa-v">0.70</div></div>
        <div class="oprank-ptr"><label>Show individual viewsheds</label><input id="oprank-opt-individual" type="checkbox"/></div>
        <div class="oprank-ptr"><label>Show OP-OP overlap extent</label><input id="oprank-opt-overlap" type="checkbox" checked/></div>
        <div class="oprank-pdiv"></div>
        <div class="oprank-optimal-strip" id="oprank-optimal-strip" style="display:none"><div class="oprank-opt-label">Recommended set</div><div class="oprank-opt-body" id="oprank-optimal-body">-</div></div>
        <div id="oprank-prog-wrap"><div id="oprank-prog-track"><div id="oprank-prog-fill"></div></div><div id="oprank-prog-label">-</div></div>
        <div class="oprank-pb-row"><button class="oprank-pb" id="oprank-btn-clear">Clear all</button><button class="oprank-pb primary" id="oprank-btn-run" disabled>Run Analysis -></button></div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    const p = this._controlPanelEl;
    if (!p) return;
    p.querySelector('#oprank-help-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const help = p.querySelector<HTMLElement>('#oprank-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#oprank-help-close')?.addEventListener('click', () => {
      const help = p.querySelector<HTMLElement>('#oprank-help-popover');
      if (help) help.hidden = true;
    });
    p.querySelector('#oprank-close-btn')?.addEventListener('click', () => this.close());
    p.querySelector('#oprank-min-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.oprank-body');
      const btn = p.querySelector<HTMLElement>('#oprank-min-btn');
      if (!body || !btn) return;
      const minimized = body.style.display === 'none';
      body.style.display = minimized ? '' : 'none';
      btn.textContent = minimized ? 'v' : '>';
    });
    p.querySelectorAll<HTMLButtonElement>('.oprank-ov-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ov = btn.dataset.ov as keyof OverlayState;
        this._ovState[ov] = !this._ovState[ov];
        if (ov === 'gap') btn.classList.toggle('gap-on', this._ovState[ov]);
        else btn.classList.toggle('on', this._ovState[ov]);
        if (this._analysed) void this._runAnalysis();
      });
    });
    this._input('oprank-inp-opa')?.addEventListener('input', () => this._setText('oprank-opa-v', this._num('oprank-inp-opa', 0.7).toFixed(2)));
    this._input('oprank-opt-individual')?.addEventListener('change', () => {
      this._ovState.individual = this._checked('oprank-opt-individual', false);
      if (this._analysed) void this._runAnalysis();
    });
    this._input('oprank-opt-overlap')?.addEventListener('change', () => {
      this._ovState.overlap = this._checked('oprank-opt-overlap', true);
      if (this._analysed) void this._runAnalysis();
    });
    ['oprank-inp-range', 'oprank-inp-ao', 'oprank-inp-cell', 'oprank-inp-optimal'].forEach((id) => {
      this._input(id)?.addEventListener('change', () => {
        this._rebuildMarkers();
        if (this._analysed) void this._runAnalysis();
      });
    });
    p.querySelector('#oprank-btn-clear')?.addEventListener('click', () => this._clearAll());
    p.querySelector('#oprank-btn-run')?.addEventListener('click', () => void this._runAnalysis());
  }

  private _bindMapClick(): void {
    if (!this._view || this._clickHandle) return;
    this._clickHandle = this._view.on('click', async (event: any) => {
      if (this._running) return;
      const mapPoint = event.mapPoint as Point | null;
      if (!mapPoint) return;
      if (this._ops.length >= 8) {
        this._setProgress(null, 'Maximum 8 OPs - remove one first');
        return;
      }
      this._addOP(new Point({
        longitude: mapPoint.longitude ?? mapPoint.x,
        latitude: mapPoint.latitude ?? mapPoint.y,
        spatialReference: WGS84,
      }));
    });
  }

  private _unbindMapClick(): void {
    this._clickHandle?.remove?.();
    this._clickHandle = null;
  }

  private _addOP(pt: Point): void {
    const idx = this._ops.length;
    this._ops.push({ pt, index: idx, raster: null, stats: null, isOptimal: false });
    this._opLayer.add(this._buildOPMarker(pt, idx, false));
    this._opLayer.add(this._buildOPLabel(pt, idx));
    this._rangeLayer.add(this._buildRangeRing(pt, this._num('oprank-inp-range', 5000), OP_COLORS[idx % OP_COLORS.length]));
    this._analysed = false;
    this._syncSummary();
    this._renderOPListPre();
  }

  private async _runAnalysis(): Promise<void> {
    if (this._running || !this._view || this._ops.length < 2) return;
    this._running = true;
    this._button('oprank-btn-run')?.setAttribute('disabled', 'true');
    this._clearMedia();

    const eyeH = this._num('oprank-inp-eye', 1.8);
    const maxRangeM = this._num('oprank-inp-range', 5000);
    const aoRadiusM = this._num('oprank-inp-ao', 4000);
    const cellM = this._num('oprank-inp-cell', 50);
    const kCount = this._num('oprank-inp-optimal', 3);
    const opacity = this._num('oprank-inp-opa', 0.7);
    const cLon = this._ops.reduce((sum, op) => sum + (op.pt.longitude ?? op.pt.x), 0) / this._ops.length;
    const cLat = this._ops.reduce((sum, op) => sum + (op.pt.latitude ?? op.pt.y), 0) / this._ops.length;
    const cosLat = Math.max(0.01, Math.cos((cLat * Math.PI) / 180));
    const padM = Math.max(aoRadiusM, maxRangeM) * 1.1;
    const padDeg = padM / M_PER_DEG;
    const extent = new Extent({
      xmin: cLon - padDeg / cosLat,
      ymin: cLat - padDeg,
      xmax: cLon + padDeg / cosLat,
      ymax: cLat + padDeg,
      spatialReference: WGS84,
    });
    const cols = Math.max(8, Math.ceil((padM * 2) / cellM));
    const rows = Math.max(8, Math.ceil((padM * 2) / cellM));

    this._aoLayer.removeAll();
    this._aoLayer.add(this._buildAOBoundary(cLon, cLat, aoRadiusM));
    this._setStatus('computing', 'Computing viewsheds...');

    try {
      for (let i = 0; i < this._ops.length; i++) {
        this._setProgress((i / this._ops.length) * 0.65, `Viewshed ${i + 1}/${this._ops.length} - OP ${i + 1}`);
        await this._tick();
        let obsZ = eyeH;
        try {
          const er = await (this._view.map as any).ground.queryElevation(this._ops[i].pt);
          obsZ = ((er?.geometry?.z ?? 0) as number) + eyeH;
        } catch {}
        const { raster } = await this._computeViewshedRaster(this._ops[i].pt, obsZ, extent, cols, rows, cellM, maxRangeM);
        this._ops[i].raster = raster;
        this._ops[i].obsZ = obsZ;
      }

      this._setProgress(0.66, 'Analysing coverage and gaps...');
      await this._tick();
      const rasters = this._ops.map((op) => op.raster).filter((r): r is Uint8Array => !!r);
      const result = this._analyseCoverage(rasters, cols, rows, aoRadiusM, extent);
      this._ops.forEach((op, i) => { op.stats = result.opStats[i]; });

      this._setProgress(0.72, 'Selecting optimal OP set...');
      await this._tick();
      const optimalIndices = this._selectOptimalSet(rasters, kCount, result.aoMask, cols * rows);
      this._ops.forEach((op) => { op.isOptimal = false; });
      optimalIndices.forEach((idx) => { if (this._ops[idx]) this._ops[idx].isOptimal = true; });
      this._rebuildMarkers(false);

      this._setProgress(0.78, 'Ranking OPs...');
      await this._tick();
      const ranked = [...this._ops].sort((a, b) => (b.stats?.uniqueSeen ?? 0) - (a.stats?.uniqueSeen ?? 0));
      ranked.forEach((op, i) => { op.rank = i + 1; });

      this._setProgress(0.82, 'Rendering overlays...');
      await this._tick();
      if (this._ovState.combined) {
        this._addMediaLayer(this._buildHeatmapLayer(result.coverCount, result.aoMask, cols, rows, extent, opacity, this._ovState.gap, this._ovState.counts));
      }
      if (this._ovState.individual) {
        this._ops.forEach((op, i) => {
          if (!op.raster) return;
          this._addMediaLayer(this._buildIndividualViewshedLayer(op.raster, cols, rows, extent, OP_COLORS[i % OP_COLORS.length], opacity));
        });
      }

      const covPct = result.aoTotal > 0 ? Math.round((100 * result.combinedSeen) / result.aoTotal) : 0;
      const gapKm2 = ((result.gapCount * cellM * cellM) / 1e6).toFixed(2);
      this._setText('oprank-ss-cov', `${covPct}%`);
      this._setText('oprank-ss-gap', `${gapKm2} km2`);
      this._renderRankedList(ranked, result.aoTotal, cellM);
      this._renderOptimalResult(optimalIndices, kCount, result.aoTotal, result.combinedSeen);
      this._setProgress(1, `Done - ${this._ops.length} OPs ranked, ${covPct}% AO covered`);
      this._setStatus('done', 'Done');
      void this._view.goTo({ target: extent, tilt: 50 } as any, { duration: 900 });
      this._analysed = true;
    } catch (error) {
      console.warn('[OPRanker] Analysis failed', error);
      this._setStatus('error', 'Analysis failed');
      this._setProgress(null, 'Analysis failed - try a coarser grid or smaller range');
    } finally {
      this._running = false;
      this._syncSummary();
    }
  }

  private async _computeViewshedRaster(
    opPt: Point,
    obsZ: number,
    extent: Extent,
    cols: number,
    rows: number,
    cellM: number,
    maxRangeM: number,
  ): Promise<{ raster: Uint8Array }> {
    const view = this._view as any;
    const sampler = await view.map.ground.createElevationSampler(extent, { noDataValue: 0 });
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const stepM = Math.max(cellM * 0.6, 20);
    const numSteps = Math.ceil(maxRangeM / stepM);
    const opLon = opPt.longitude ?? opPt.x;
    const opLat = opPt.latitude ?? opPt.y;
    const cosLat = Math.cos((opLat * Math.PI) / 180);
    const horizonRes = 2;
    const horizons = new Float32Array(360 / horizonRes);

    for (let di = 0; di < horizons.length; di++) {
      const brg = di * horizonRes;
      let maxSlope = -90;
      for (let s = 1; s <= numSteps; s++) {
        const dist = s * stepM;
        const { longitude, latitude } = destPt(opLon, opLat, brg, dist);
        const z = sampler.queryElevation(new Point({ longitude, latitude, spatialReference: WGS84 }))?.z ?? 0;
        maxSlope = Math.max(maxSlope, (Math.atan2(z - obsZ, dist) * 180) / Math.PI);
      }
      horizons[di] = maxSlope;
    }

    const raster = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const lon = extent.xmin + (col + 0.5) * dLon;
        const lat = extent.ymax - (row + 0.5) * dLat;
        const east = (lon - opLon) * M_PER_DEG * cosLat;
        const north = (lat - opLat) * M_PER_DEG;
        const dist = Math.sqrt(east * east + north * north);
        if (dist < 2 || dist > maxRangeM) continue;
        const brg = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
        const bKey = Math.round(brg / horizonRes) % (360 / horizonRes);
        const terrZ = sampler.queryElevation(new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 }))?.z ?? 0;
        const slope = (Math.atan2(terrZ - obsZ, dist) * 180) / Math.PI;
        raster[row * cols + col] = slope >= horizons[bKey] ? 1 : 0;
      }
    }
    return { raster };
  }

  private _analyseCoverage(rasters: Uint8Array[], cols: number, rows: number, aoRadiusM: number, extent: Extent): CoverageResult {
    const total = cols * rows;
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const cLon = (extent.xmax + extent.xmin) / 2;
    const cLat = (extent.ymax + extent.ymin) / 2;
    const cosLat = Math.cos((cLat * Math.PI) / 180);
    const coverCount = new Uint8Array(total);
    rasters.forEach((r) => {
      for (let i = 0; i < total; i++) if (r[i]) coverCount[i]++;
    });
    const aoMask = new Uint8Array(total);
    let aoTotal = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const lon = extent.xmin + (col + 0.5) * dLon;
        const lat = extent.ymax - (row + 0.5) * dLat;
        const east = (lon - cLon) * M_PER_DEG * cosLat;
        const north = (lat - cLat) * M_PER_DEG;
        if (Math.sqrt(east * east + north * north) <= aoRadiusM) {
          aoMask[row * cols + col] = 1;
          aoTotal++;
        }
      }
    }
    const opStats = rasters.map((r) => {
      let totalSeen = 0;
      let uniqueSeen = 0;
      for (let i = 0; i < total; i++) {
        if (!aoMask[i] || !r[i]) continue;
        totalSeen++;
        if (coverCount[i] === 1) uniqueSeen++;
      }
      return {
        totalSeen,
        uniqueSeen,
        totalPct: aoTotal > 0 ? (totalSeen / aoTotal) * 100 : 0,
        uniquePct: aoTotal > 0 ? (uniqueSeen / aoTotal) * 100 : 0,
      };
    });
    let gapCount = 0;
    let combinedSeen = 0;
    for (let i = 0; i < total; i++) {
      if (!aoMask[i]) continue;
      if (coverCount[i] === 0) gapCount++;
      if (coverCount[i] > 0) combinedSeen++;
    }
    return { coverCount, aoMask, aoTotal, opStats, gapCount, combinedSeen };
  }

  private _selectOptimalSet(rasters: Uint8Array[], kCount: number, aoMask: Uint8Array, total: number): number[] {
    const selected: number[] = [];
    const alreadySeen = new Uint8Array(total);
    for (let iter = 0; iter < Math.min(kCount, rasters.length); iter++) {
      let bestIdx = -1;
      let bestGain = -1;
      for (let k = 0; k < rasters.length; k++) {
        if (selected.includes(k)) continue;
        let gain = 0;
        for (let i = 0; i < total; i++) if (aoMask[i] && rasters[k][i] && !alreadySeen[i]) gain++;
        if (gain > bestGain) {
          bestGain = gain;
          bestIdx = k;
        }
      }
      if (bestIdx < 0) break;
      selected.push(bestIdx);
      for (let i = 0; i < total; i++) if (rasters[bestIdx][i]) alreadySeen[i] = 1;
    }
    return selected;
  }

  private _buildHeatmapLayer(
    coverCount: Uint8Array,
    aoMask: Uint8Array,
    cols: number,
    rows: number,
    extent: Extent,
    opacity: number,
    showGap: boolean,
    showCounts: boolean,
  ): MediaLayer {
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const px = i * 4;
      const cnt = coverCount[i];
      if (!aoMask[i]) {
        imgData.data[px + 3] = 0;
      } else if (cnt === 0 && showGap) {
        imgData.data[px] = 180; imgData.data[px + 1] = 25; imgData.data[px + 2] = 25; imgData.data[px + 3] = Math.round(opacity * 180);
      } else if (cnt === 1 && showCounts) {
        imgData.data[px] = 55; imgData.data[px + 1] = 138; imgData.data[px + 2] = 221; imgData.data[px + 3] = Math.round(opacity * 160);
      } else if (cnt === 2 && showCounts) {
        imgData.data[px] = 55; imgData.data[px + 1] = 200; imgData.data[px + 2] = 200; imgData.data[px + 3] = Math.round(opacity * 150);
      } else if (cnt >= 3 && showCounts) {
        imgData.data[px] = 29; imgData.data[px + 1] = 158; imgData.data[px + 2] = 117; imgData.data[px + 3] = Math.round(opacity * 140);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return new MediaLayer({
      source: [new ImageElement({
        image: canvas.toDataURL('image/png'),
        georeference: new ExtentAndRotationGeoreference({ extent }),
      })],
      title: 'OP coverage heatmap',
      opacity: 1,
    });
  }

  private _buildIndividualViewshedLayer(raster: Uint8Array, cols: number, rows: number, extent: Extent, color: [number, number, number], opacity: number): MediaLayer {
    const [r, g, b] = color;
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      if (!raster[i]) continue;
      const px = i * 4;
      imgData.data[px] = r; imgData.data[px + 1] = g; imgData.data[px + 2] = b; imgData.data[px + 3] = Math.round(opacity * 120);
    }
    ctx.putImageData(imgData, 0, 0);
    return new MediaLayer({
      source: [new ImageElement({
        image: canvas.toDataURL('image/png'),
        georeference: new ExtentAndRotationGeoreference({ extent }),
      })],
      title: 'Individual viewshed',
      opacity: 1,
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
      symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [55, 138, 221, 160], width: 1.5, style: 'dash' } } as any,
      attributes: { type: 'AO boundary' },
    });
  }

  private _buildOPMarker(pt: Point, index: number, isOptimal: boolean): Graphic {
    const [r, g, b] = OP_COLORS[index % OP_COLORS.length];
    const symbol = this._view?.type === '3d'
      ? {
          type: 'point-3d',
          symbolLayers: [{
            type: 'object',
            resource: { primitive: isOptimal ? 'diamond' : 'sphere' },
            material: { color: [r, g, b, 0.95] },
            width: isOptimal ? 100 : 70,
            height: isOptimal ? 100 : 70,
            depth: isOptimal ? 100 : 70,
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
      geometry: pt,
      symbol: symbol as any,
      attributes: {
        type: `OP ${index + 1}`,
        label: `OP ${index + 1} - ${(pt.latitude ?? pt.y).toFixed(4)}N ${(pt.longitude ?? pt.x).toFixed(4)}E`,
        opIndex: index,
      },
    });
  }

  private _buildOPLabel(pt: Point, index: number): Graphic {
    return new Graphic({
      geometry: pt,
      symbol: {
        type: 'text',
        text: `${index + 1}`,
        color: [255, 255, 255, 255],
        haloColor: [...OP_COLORS[index % OP_COLORS.length], 255],
        haloSize: 2.5,
        font: { family: 'Courier New', size: 10, weight: 'bold' },
        horizontalAlignment: 'center',
        verticalAlignment: 'middle',
        yoffset: 16,
      } as any,
    });
  }

  private _buildRangeRing(pt: Point, radiusM: number, color: [number, number, number]): Graphic {
    const [r, g, b] = color;
    const ring: number[][] = [];
    const lon = pt.longitude ?? pt.x;
    const lat = pt.latitude ?? pt.y;
    for (let i = 0; i <= 48; i++) {
      const p = destPt(lon, lat, (i / 48) * 360, radiusM);
      ring.push([p.longitude, p.latitude]);
    }
    return new Graphic({
      geometry: new Polygon({ rings: [ring], spatialReference: WGS84 }),
      symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [r, g, b, 80], width: 1, style: 'dash' } } as any,
    });
  }

  private _renderEmptyList(): void {
    const list = this._el('oprank-op-list');
    if (!list) return;
    list.innerHTML = `
      <div id="oprank-list-empty">
        Click the map to place candidate<br>
        <strong style="color:#378ADD">Observation Post</strong> positions.<br><br>
        Place 2-8 candidates, then click<br>
        <strong style="color:#378ADD">Run Analysis</strong> to rank them<br>
        by unique coverage contribution.
      </div>
    `;
  }

  private _renderOPListPre(): void {
    const list = this._el('oprank-op-list');
    if (!list) return;
    if (!this._ops.length) {
      this._renderEmptyList();
      return;
    }
    list.innerHTML = '';
    this._ops.forEach((op, i) => {
      const hex = HEX_COLORS[i % HEX_COLORS.length];
      const card = document.createElement('div');
      card.className = 'oprank-op-card';
      card.innerHTML = `
        <div class="oprank-op-top">
          <div class="oprank-op-num">${i + 1}</div>
          <div>
            <div class="oprank-op-name"><span class="oprank-colour-dot" style="background:${hex};margin-right:5px"></span>OP ${i + 1}</div>
            <div class="oprank-op-coords">${(op.pt.latitude ?? op.pt.y).toFixed(4)}N  ${(op.pt.longitude ?? op.pt.x).toFixed(4)}E</div>
          </div>
        </div>
        <div style="font-size:9px;color:#3a3935;padding-top:4px">Run analysis to compute viewshed</div>
        <div class="oprank-op-actions">
          <button class="oprank-op-action-btn remove" data-k="${i}">Remove</button>
          <button class="oprank-op-action-btn" data-fly="${i}">Fly to</button>
        </div>
      `;
      card.querySelector('[data-k]')?.addEventListener('click', () => this._removeOP(i));
      card.querySelector('[data-fly]')?.addEventListener('click', () => this._flyTo(i));
      list.appendChild(card);
    });
    this._setText('oprank-lph-sub', 'Place OPs on map - then run analysis');
  }

  private _renderRankedList(ranked: OpCandidate[], aoTotal: number, cellM: number): void {
    const list = this._el('oprank-op-list');
    if (!list) return;
    list.innerHTML = '';
    this._setText('oprank-lph-sub', `${ranked.length} OPs ranked by unique coverage`);
    const maxUnique = Math.max(1, ...ranked.map((op) => op.stats?.uniqueSeen ?? 0));
    ranked.forEach((op) => {
      const hex = HEX_COLORS[op.index % HEX_COLORS.length];
      const s = op.stats!;
      const uniquePct = Math.round(s.uniquePct);
      const totalPct = Math.round(s.totalPct);
      const uniqueBar = Math.round((s.uniqueSeen / maxUnique) * 100);
      const uniqueKm2 = ((s.uniqueSeen * cellM * cellM) / 1e6).toFixed(2);
      let note = '';
      if (uniquePct > 25) note = `Highest unique contribution - ${uniqueKm2} km2 seen by no other OP. Essential.`;
      else if (uniquePct > 10) note = `Good unique coverage. Removing it leaves ${uniqueKm2} km2 blind.`;
      else if (uniquePct > 3) note = 'Moderate contribution. Worth keeping if manpower allows.';
      else note = 'Minimal unique coverage - viewshed largely duplicated by other OPs.';
      if (op.isOptimal) note += ' In recommended set.';

      const card = document.createElement('div');
      card.className = `oprank-op-card${op.isOptimal ? ' in-optimal' : ''}`;
      card.innerHTML = `
        <div class="oprank-op-badge" style="color:${hex}">${s.uniqueSeen > 0 ? `${uniquePct}%` : '0%'}</div>
        <div class="oprank-op-top">
          <div class="oprank-op-num${op.isOptimal ? ' optimal' : ''}">${op.rank ?? '-'}</div>
          <div style="flex:1">
            <div class="oprank-op-name"><span class="oprank-colour-dot" style="background:${hex};margin-right:5px"></span>OP ${op.index + 1}${op.isOptimal ? ' *' : ''}</div>
            <div class="oprank-op-coords">${(op.pt.latitude ?? op.pt.y).toFixed(4)}N  ${(op.pt.longitude ?? op.pt.x).toFixed(4)}E</div>
          </div>
        </div>
        <div class="oprank-op-bars">
          <div class="oprank-ob"><div class="oprank-ob-lbl">Unique coverage</div><div class="oprank-ob-track"><div class="oprank-ob-fill" style="width:${uniqueBar}%;background:${hex}"></div></div><div class="oprank-ob-val">${uniquePct}% (${uniqueKm2} km2)</div></div>
          <div class="oprank-ob"><div class="oprank-ob-lbl">Total viewshed</div><div class="oprank-ob-track"><div class="oprank-ob-fill" style="width:${totalPct}%;background:#378ADD"></div></div><div class="oprank-ob-val">${totalPct}% of AO</div></div>
        </div>
        <div class="oprank-op-note">${note}</div>
        <div class="oprank-op-actions"><button class="oprank-op-action-btn" data-fly="${op.index}">Fly to</button><button class="oprank-op-action-btn remove" data-k="${op.index}">Remove</button></div>
      `;
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        this._listPanelEl?.querySelectorAll('.oprank-op-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this._flyTo(op.index);
      });
      card.querySelector('[data-k]')?.addEventListener('click', () => this._removeOP(op.index));
      card.querySelector('[data-fly]')?.addEventListener('click', () => this._flyTo(op.index));
      list.appendChild(card);
    });
    void aoTotal;
  }

  private _renderOptimalResult(indices: number[], kCount: number, aoTotal: number, combinedSeen: number): void {
    const strip = this._el('oprank-optimal-strip');
    const body = this._el('oprank-optimal-body');
    if (!strip || !body) return;
    strip.style.display = 'block';
    if (!indices.length) {
      body.textContent = 'No OPs available.';
      return;
    }
    const names = indices.map((idx) => `<strong style="color:${HEX_COLORS[idx % HEX_COLORS.length]}">OP ${idx + 1}</strong>`);
    const covPct = aoTotal > 0 ? Math.round((100 * combinedSeen) / aoTotal) : 0;
    body.innerHTML = `Use ${names.join(', ')} for optimal ${kCount}-OP coverage.<br>Combined AO coverage with this set: <strong>${covPct}%</strong>.<br>Greedy set maximises total observable ground.`;
  }

  private _removeOP(index: number): void {
    this._ops.splice(index, 1);
    this._ops.forEach((op, i) => {
      op.index = i;
      op.raster = null;
      op.stats = null;
      op.isOptimal = false;
      op.rank = undefined;
    });
    this._analysed = false;
    this._clearMedia();
    this._aoLayer.removeAll();
    this._rebuildMarkers(false);
    this._syncSummary();
    this._renderOPListPre();
  }

  private _rebuildMarkers(resetStats = true): void {
    this._opLayer.removeAll();
    this._rangeLayer.removeAll();
    const maxR = this._num('oprank-inp-range', 5000);
    this._ops.forEach((op, i) => {
      if (resetStats) {
        op.raster = null;
        op.stats = null;
        op.isOptimal = false;
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
    this._opLayer.removeAll();
    this._rangeLayer.removeAll();
    this._aoLayer.removeAll();
    this._clearMedia();
    this._setText('oprank-lph-sub', 'Place OPs on map - then run analysis');
    this._setText('oprank-ss-cov', '-');
    this._setText('oprank-ss-gap', '-');
    const strip = this._el('oprank-optimal-strip');
    if (strip) strip.style.display = 'none';
    this._setProgress(0, '-');
    this._setStatus('placing', 'Place OPs on map');
    this._renderEmptyList();
    this._syncSummary();
  }

  private _syncSummary(): void {
    this._setText('oprank-ss-ops', String(this._ops.length));
    const run = this._button('oprank-btn-run');
    if (run) run.disabled = this._ops.length < 2 || this._running;
    if (this._hintEl) {
      this._hintEl.textContent = this._ops.length < 2
        ? 'Click map to place a candidate OP - place 2-8 then Run Analysis'
        : `${this._ops.length} OPs placed - click Run Analysis`;
    }
  }

  private _addMediaLayer(layer: MediaLayer): void {
    const map = this._view?.map as any;
    if (!map) return;
    map.add(layer, 0);
    this._mediaLayers.push(layer);
  }

  private _clearMedia(): void {
    const map = this._view?.map as any;
    this._mediaLayers.forEach((layer) => {
      try { map?.remove(layer); } catch {}
    });
    this._mediaLayers = [];
  }

  private _flyTo(index: number): void {
    const op = this._ops[index];
    if (!op || !this._view) return;
    void this._view.goTo({ center: [op.pt.longitude ?? op.pt.x, op.pt.latitude ?? op.pt.y], zoom: 14, tilt: 55 } as any, { duration: 800 });
  }

  private _showPanels(): void {
    if (this._listPanelEl) this._listPanelEl.style.display = 'flex';
    if (this._controlPanelEl) this._controlPanelEl.style.display = 'block';
    if (this._hintEl) this._hintEl.style.display = 'block';
  }

  private _hidePanels(): void {
    if (this._listPanelEl) this._listPanelEl.style.display = 'none';
    if (this._controlPanelEl) this._controlPanelEl.style.display = 'none';
    if (this._hintEl) this._hintEl.style.display = 'none';
  }

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
    this._dragTarget.style.left = `${Math.max(0, e.clientX - this._dragOffsetX)}px`;
    this._dragTarget.style.top = `${Math.max(0, e.clientY - this._dragOffsetY)}px`;
    this._dragTarget.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._dragTarget = null;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  private _setStatus(state: 'placing' | 'computing' | 'done' | 'error', text: string): void {
    const el = this._el('oprank-status');
    if (state === 'done') EngineLogger.success(ENGINE_NAME, text);
    else if (state === 'error') EngineLogger.error(ENGINE_NAME, text);
    else EngineLogger.nextStep(ENGINE_NAME, text);
    if (!el) return;
    el.textContent = text;
    el.className = `oprank-ph-status ${state}`;
  }

  private _setProgress(frac: number | null, label: string): void {
    const fill = this._el('oprank-prog-fill');
    const lbl = this._el('oprank-prog-label');
    if (fill && frac != null) fill.style.width = `${Math.round(frac * 100)}%`;
    if (lbl) lbl.textContent = label;
  }

  private _el(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  private _input(id: string): HTMLInputElement | HTMLSelectElement | null {
    return this._el(id) as HTMLInputElement | HTMLSelectElement | null;
  }

  private _button(id: string): HTMLButtonElement | null {
    return this._el(id) as HTMLButtonElement | null;
  }

  private _num(id: string, fallback: number): number {
    const value = Number((this._input(id) as HTMLInputElement | null)?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  private _checked(id: string, fallback: boolean): boolean {
    const el = this._input(id) as HTMLInputElement | null;
    return el ? el.checked : fallback;
  }

  private _setText(id: string, text: string): void {
    const el = this._el(id);
    if (el) el.textContent = text;
  }

  private _tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private _injectStyles(): void {
    if (document.getElementById('op-ranker-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'op-ranker-engine-styles';
    style.textContent = `
      #oprank-list-panel,#oprank-ctrl-panel{position:fixed;z-index:1100;background:rgba(6,8,9,0.97);border:1px solid rgba(55,138,221,0.28);border-radius:5px;color:#bfbcb4;font-family:'Courier New',monospace;font-size:12px;box-shadow:var(--ms-shadow,0 8px 28px rgba(0,0,0,.42));user-select:none}
      #oprank-list-panel{top:60px;left:14px;width:268px;max-height:calc(100vh - 88px);display:none;flex-direction:column}
      #oprank-ctrl-panel{top:60px;right:14px;width:288px;max-height:calc(100vh - 88px);overflow-y:auto;display:none}
      .oprank-lph,.oprank-ph{padding:9px 12px 8px;border-bottom:1px solid rgba(55,138,221,0.15);background:rgba(55,138,221,0.07);cursor:grab}
      .oprank-lph-title,.oprank-ph-title{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#378ADD;font-weight:700}
      .oprank-lph-sub{font-size:9px;color:#3a3935;letter-spacing:.05em;margin-top:2px}
      .oprank-ph{display:flex;align-items:center;gap:7px;position:sticky;top:0;z-index:2}
      .oprank-ph-title{flex:1}.oprank-ph-tools{display:flex;gap:3px}.oprank-help-btn,.oprank-min-btn,.oprank-close-btn,.oprank-help-close{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#888780;border-radius:3px;font-family:inherit;font-size:11px;cursor:pointer}
      .oprank-help-btn{width:17px;height:17px;border-radius:50%;color:#1D9E75;font-weight:700}.oprank-help-btn:hover,.oprank-min-btn:hover,.oprank-close-btn:hover,.oprank-help-close:hover{color:#bfbcb4}
      .oprank-ph-status{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#3a3935}.oprank-ph-status.placing{color:#378ADD}.oprank-ph-status.computing{color:#EF9F27}.oprank-ph-status.done{color:#1D9E75}.oprank-ph-status.error{color:#DC3C30}
      #oprank-summary-strip{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid rgba(55,138,221,0.12);flex-shrink:0}.oprank-ss-cell{padding:7px 10px;display:flex;flex-direction:column;gap:2px;border-right:.5px solid rgba(55,138,221,.1)}.oprank-ss-cell:last-child{border-right:none}.oprank-ss-l{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#3a3935}.oprank-ss-v{font-size:13px;font-weight:600;color:#378ADD}
      #oprank-op-list{overflow-y:auto;flex:1;padding:6px}.oprank-op-card{background:rgba(255,255,255,.02);border:.5px solid rgba(255,255,255,.08);border-radius:4px;padding:8px 10px;margin-bottom:5px;cursor:pointer;transition:all .12s;position:relative}.oprank-op-card:hover{background:rgba(55,138,221,.07);border-color:rgba(55,138,221,.35)}.oprank-op-card.selected{border-color:#378ADD;background:rgba(55,138,221,.12)}.oprank-op-card.in-optimal{border-left:3px solid #1D9E75}.oprank-op-top{display:flex;align-items:center;gap:8px;margin-bottom:6px}.oprank-op-num{width:24px;height:24px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;background:rgba(55,138,221,.15);color:#378ADD;border:1px solid rgba(55,138,221,.35)}.oprank-op-num.optimal{background:rgba(29,158,117,.15);color:#1D9E75;border-color:rgba(29,158,117,.5)}
      .oprank-op-name{font-size:12px;font-weight:500;color:#bfbcb4;flex:1}.oprank-op-coords{font-size:9px;color:#3a3935;letter-spacing:.04em;margin-top:1px}.oprank-op-badge{font-size:12px;font-weight:700;position:absolute;top:8px;right:8px}.oprank-colour-dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex-shrink:0}
      .oprank-op-bars{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin-bottom:6px}.oprank-ob{display:flex;flex-direction:column;gap:2px}.oprank-ob-lbl{font-size:8px;letter-spacing:.07em;text-transform:uppercase;color:#3a3935}.oprank-ob-track{height:3px;background:rgba(255,255,255,.06);border-radius:2px}.oprank-ob-fill{height:100%;border-radius:2px}.oprank-ob-val{font-size:9px;color:#888780}.oprank-op-note{font-size:10px;color:#6b6a64;line-height:1.5;border-top:.5px solid rgba(255,255,255,.06);padding-top:5px}.oprank-op-actions{display:flex;gap:5px;margin-top:6px}.oprank-op-action-btn{font-size:9px;letter-spacing:.05em;text-transform:uppercase;padding:3px 7px;border-radius:2px;border:.5px solid rgba(255,255,255,.12);background:transparent;color:#888780;cursor:pointer;font-family:inherit}.oprank-op-action-btn:hover{background:rgba(255,255,255,.06);color:#bfbcb4}.oprank-op-action-btn.remove{border-color:rgba(220,60,48,.3);color:rgba(220,60,48,.7)}
      #oprank-list-empty{padding:20px 12px;font-size:10px;color:#3a3935;text-align:center;line-height:1.8}
      .oprank-ps{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#3a3935;padding:9px 12px 5px}.oprank-pg{display:grid;grid-template-columns:1fr 1fr;gap:7px 10px;padding:0 12px 9px}.oprank-pf{display:flex;flex-direction:column;gap:3px}.oprank-pf.full{grid-column:1/-1}.oprank-pl{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780}
      #oprank-ctrl-panel input,#oprank-ctrl-panel select{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:3px;color:#bfbcb4;font-family:inherit;font-size:11px;padding:5px 7px;width:100%;outline:none;transition:border-color .15s;box-sizing:border-box}#oprank-ctrl-panel input:focus,#oprank-ctrl-panel select:focus{border-color:rgba(55,138,221,.55)}#oprank-ctrl-panel select option{background:#141618}
      .oprank-psr{display:flex;align-items:center;gap:8px;padding:0 12px 8px}.oprank-psr-l{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780;flex:1.8}.oprank-psr input[type=range]{flex:2;accent-color:#378ADD;cursor:pointer}.oprank-psr-v{font-size:10px;color:#378ADD;min-width:38px;text-align:right}.oprank-pdiv{height:1px;background:rgba(255,255,255,.07);margin:4px 0}.oprank-ptr{display:flex;align-items:center;justify-content:space-between;padding:5px 12px}.oprank-ptr label{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780;cursor:pointer}.oprank-ptr input[type=checkbox]{accent-color:#378ADD;width:13px;height:13px;cursor:pointer}
      .oprank-ov-row{display:flex;gap:5px;padding:0 12px 9px}.oprank-ov-btn{flex:1;padding:5px 3px;font-size:9px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:3px;border:1px solid rgba(255,255,255,.10);background:transparent;color:#888780;font-family:inherit;transition:all .13s}.oprank-ov-btn.on{border-color:rgba(55,138,221,.55);color:#378ADD;background:rgba(55,138,221,.10)}.oprank-ov-btn.gap-on{border-color:rgba(220,60,48,.55);color:#DC3C30;background:rgba(220,60,48,.10)}
      #oprank-prog-wrap{padding:0 12px 9px}#oprank-prog-track{height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden}#oprank-prog-fill{height:100%;background:linear-gradient(to right,#378ADD,#1D9E75);border-radius:2px;width:0%;transition:width .12s}#oprank-prog-label{font-size:9px;color:#3a3935;letter-spacing:.05em;margin-top:4px}
      .oprank-optimal-strip{margin:0 12px 9px;padding:8px 10px;background:rgba(29,158,117,.06);border:1px solid rgba(29,158,117,.20);border-radius:3px}.oprank-opt-label{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#1D9E75;margin-bottom:5px}.oprank-opt-body{font-size:10px;color:#888780;line-height:1.6}
      .oprank-pb-row{display:flex;gap:6px;padding:9px 12px}.oprank-pb{flex:1;padding:7px;font-family:inherit;font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:3px;border:1px solid rgba(55,138,221,.38);background:transparent;color:#378ADD;transition:all .14s}.oprank-pb:hover:not(:disabled){background:rgba(55,138,221,.10)}.oprank-pb.primary{background:rgba(55,138,221,.16);border-color:#378ADD}.oprank-pb:disabled{opacity:.3;cursor:not-allowed}
      #oprank-hint{position:fixed;bottom:55px;left:50%;transform:translateX(-50%);background:rgba(6,8,9,.94);border:1px solid rgba(55,138,221,.45);color:#378ADD;font-family:'Courier New',monospace;font-size:11px;letter-spacing:.08em;padding:8px 22px;border-radius:3px;pointer-events:none;z-index:1100;text-transform:uppercase;display:none}
      .oprank-help-popover{position:absolute;top:39px;left:8px;right:8px;z-index:1120;max-height:min(520px,calc(100vh - 132px));overflow-y:auto;background:rgba(6,8,9,.99);border:1px solid rgba(55,138,221,.28);border-radius:4px;box-shadow:var(--ms-shadow,0 8px 28px rgba(0,0,0,.42));color:#bfbcb4}.oprank-help-popover[hidden]{display:none}.oprank-help-head{display:flex;justify-content:space-between;gap:10px;padding:10px 11px 8px;border-bottom:1px solid rgba(55,138,221,.15);background:rgba(55,138,221,.07)}.oprank-help-kicker{font-size:9px;color:#3a3935;letter-spacing:.09em;text-transform:uppercase}.oprank-help-title{margin-top:2px;font-size:13px;color:#1D9E75;font-weight:700}.oprank-help-body{padding:10px 11px 12px;font-size:10px;line-height:1.45;color:#888780;user-select:text}.oprank-help-body p{margin:0 0 9px}.oprank-help-block{margin-top:10px}.oprank-help-block h4{margin:0 0 5px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#bfbcb4}.oprank-help-block ol{margin:0;padding-left:17px}.oprank-help-block li{margin:3px 0}.oprank-help-block dl{display:grid;grid-template-columns:72px minmax(0,1fr);gap:5px 8px;margin:0}.oprank-help-block dt{color:#1D9E75;font-weight:700}.oprank-help-block dd{margin:0}
      @media (max-width:720px){#oprank-list-panel{left:10px;top:62px;width:calc(100vw - 20px);max-height:34vh}#oprank-ctrl-panel{left:10px;right:auto;top:calc(34vh + 72px);width:calc(100vw - 20px);max-height:calc(66vh - 88px)}}
    `;
    document.head.appendChild(style);
  }
}

export default OpRankerEngine;

