import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
import Polyline from '@arcgis/core/geometry/Polyline';
import EngineLogger from '../../../Support/EngineLogger';

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'PosDefScorerEngine';
const EARTH_R = 6_371_008.8;
const M_PER_DEG = 111_320;

export type FactorId = 'obs' | 'fof' | 'cff' | 'cfv' | 'egr' | 'dg';
export type ScoreMap = Record<FactorId, number>;

interface FactorDef {
  id: FactorId;
  label: string;
  icon: string;
  color: string;
  desc: (score: number) => string;
}

interface GradeDef {
  min: number;
  grade: string;
  label: string;
  color: string;
}

interface ScoreParams {
  obsRadius: number;
  slopeRadius: number;
  rayRes: number;
  threatBrg: number;
  slopeOkDeg: number;
  showVS: boolean;
  showDG: boolean;
  showSlp: boolean;
  showLOS: boolean;
  showEgr: boolean;
}

interface EgressResult {
  pt: Point;
  clear: boolean;
  masked: boolean;
  dist: number;
}

interface ScoreResult {
  scores: ScoreMap;
  composite: number;
  horizons: Float32Array;
  egrResults: EgressResult[];
  sampler: any;
  extent: Extent;
  numRays: number;
}

interface HistoryEntry {
  pt: Point;
  scores: ScoreMap;
  composite: number;
  obsZ: number;
}

export interface DefensibilitySummary {
  point: Point;
  scores: ScoreMap;
  composite: number;
  grade: string;
  label: string;
}

export interface DefensibilityScoreOptions {
  observerHeightM?: number;
  obsRadius?: number;
  slopeRadius?: number;
  rayResolutionDeg?: number;
  threatBearingDeg?: number;
  maxSlopeDeg?: number;
}

const FACTORS: FactorDef[] = [
  {
    id: 'obs',
    label: 'Observation arc',
    icon: 'OBS',
    color: '#1D9E75',
    desc: (s) => s >= 15 ? 'Excellent - sees most of AO' : s >= 10 ? 'Good observation' : s >= 6 ? 'Limited arcs' : 'Poor - nearly blind',
  },
  {
    id: 'fof',
    label: 'Fields of fire',
    icon: 'FOF',
    color: '#378ADD',
    desc: (s) => s >= 15 ? 'Wide unobstructed fields' : s >= 10 ? 'Adequate direct fire arcs' : s >= 6 ? 'Restricted by terrain' : 'Confined - minimal fire',
  },
  {
    id: 'cff',
    label: 'Cover from fire',
    icon: 'CFF',
    color: '#EF9F27',
    desc: (s) => s >= 15 ? 'Strong terrain masking' : s >= 10 ? 'Moderate protection' : s >= 6 ? 'Partial cover only' : 'Exposed - no cover',
  },
  {
    id: 'cfv',
    label: 'Cover from view',
    icon: 'CFV',
    color: '#B428DC',
    desc: (s) => s >= 15 ? 'Well concealed' : s >= 10 ? 'Partial concealment' : s >= 6 ? 'Marginal concealment' : 'Fully exposed',
  },
  {
    id: 'egr',
    label: 'Egress routes',
    icon: 'EGR',
    color: '#78C840',
    desc: (s) => s >= 15 ? 'Multiple covered routes' : s >= 10 ? 'At least one clear route' : s >= 6 ? 'Limited egress' : 'Bottleneck - trapped',
  },
  {
    id: 'dg',
    label: 'Dead ground behind',
    icon: 'DG',
    color: '#DC3C30',
    desc: (s) => s >= 15 ? 'Deep dead ground - safe FUP' : s >= 10 ? 'Useful dead ground' : s >= 6 ? 'Shallow dead ground' : 'No dead ground',
  },
];

const GRADE: GradeDef[] = [
  { min: 85, grade: 'A+', label: 'Exceptional', color: '#1D9E75' },
  { min: 75, grade: 'A', label: 'Strong', color: '#1D9E75' },
  { min: 65, grade: 'B', label: 'Good', color: '#78C840' },
  { min: 55, grade: 'B-', label: 'Acceptable', color: '#78C840' },
  { min: 45, grade: 'C', label: 'Marginal', color: '#EF9F27' },
  { min: 35, grade: 'D', label: 'Poor', color: '#EF9F27' },
  { min: 0, grade: 'F', label: 'Indefensible', color: '#DC3C30' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getGrade(score: number): GradeDef {
  return GRADE.find((g) => score >= g.min) ?? GRADE[GRADE.length - 1];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
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

function geoDist(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

function pointFromGeometry(graphic: Graphic): Point | null {
  const geom = graphic.geometry;
  if (geom?.type === 'point') return geom as Point;
  if ((geom as any)?.centroid) return (geom as any).centroid as Point;
  return null;
}

export class PosDefScorerEngine {
  static readonly OVERLAY_LAYER_ID = 'pos-def-viewshed-overlay';
  static readonly SPOKES_LAYER_ID = 'pos-def-los-spokes';
  static readonly POSITION_LAYER_ID = 'pos-def-position-marker';
  static readonly EGRESS_LAYER_ID = 'pos-def-egress-routes';
  static readonly HISTORY_LAYER_ID = 'pos-def-position-history';

  private _view: MapView | SceneView | null = null;
  private _overlayLayer!: GraphicsLayer;
  private _spokesLayer!: GraphicsLayer;
  private _posLayer!: GraphicsLayer;
  private _egrLayer!: GraphicsLayer;
  private _histLayer!: GraphicsLayer;
  private _mediaLayers: MediaLayer[] = [];

  private _scorePanelEl: HTMLDivElement | null = null;
  private _controlPanelEl: HTMLDivElement | null = null;
  private _hintEl: HTMLDivElement | null = null;
  private _clickHandle: any = null;
  private _currentPos: Point | null = null;
  private _egressPts: Point[] = [];
  private _history: HistoryEntry[] = [];
  private _running = false;
  private _addingEgress = false;

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._unbindMapClick();
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._overlayLayer.id)) {
      map.addMany([this._overlayLayer, this._spokesLayer, this._egrLayer, this._histLayer, this._posLayer]);
    }
    if (this._scorePanelEl && this._scorePanelEl.style.display !== 'none') this._bindMapClick();
  }

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    this._ensurePanels();
    this._showPanels();
    this._bindMapClick();
    const src = pointFromGeometry(graphic);
    if (src) {
      this._currentPos = new Point({ longitude: src.longitude ?? src.x, latitude: src.latitude ?? src.y, spatialReference: WGS84 });
      void this._runAnalysis(this._currentPos);
    }
  }

  openWidget(view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    if (!this._view) return;
    this._ensurePanels();
    this._showPanels();
    this._bindMapClick();
  }

  public async scorePoint(point: Point, options: DefensibilityScoreOptions = {}): Promise<DefensibilitySummary> {
    if (!this._view) throw new Error('PosDefScorerEngine requires initialize(view) before scorePoint().');
    let obsZ = options.observerHeightM ?? 1.8;
    try {
      const er = await (this._view.map as any).ground.queryElevation(point);
      obsZ = ((er?.geometry?.z ?? 0) as number) + (options.observerHeightM ?? 1.8);
    } catch {}
    const result = await this._scorePosition(point, obsZ, {
      obsRadius: options.obsRadius ?? 2500,
      slopeRadius: options.slopeRadius ?? 150,
      rayRes: options.rayResolutionDeg ?? 10,
      threatBrg: options.threatBearingDeg ?? 270,
      slopeOkDeg: options.maxSlopeDeg ?? 12,
      showVS: false,
      showDG: false,
      showSlp: false,
      showLOS: false,
      showEgr: false,
    });
    const grade = getGrade(result.composite);
    return {
      point,
      scores: result.scores,
      composite: result.composite,
      grade: grade.grade,
      label: grade.label,
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
      [this._overlayLayer, this._spokesLayer, this._posLayer, this._egrLayer, this._histLayer, ...this._mediaLayers]
        .forEach((layer) => { try { map.remove(layer); } catch {} });
    }
    this._scorePanelEl?.remove();
    this._controlPanelEl?.remove();
    this._hintEl?.remove();
    this._scorePanelEl = null;
    this._controlPanelEl = null;
    this._hintEl = null;
    this._view = null;
  }

  private _createLayers(): void {
    this._overlayLayer = new GraphicsLayer({ id: PosDefScorerEngine.OVERLAY_LAYER_ID, title: 'Position Defensibility - Overlay', elevationInfo: { mode: 'on-the-ground' } as any });
    this._spokesLayer = new GraphicsLayer({ id: PosDefScorerEngine.SPOKES_LAYER_ID, title: 'Position Defensibility - LOS Spokes', elevationInfo: { mode: 'on-the-ground' } as any });
    this._posLayer = new GraphicsLayer({ id: PosDefScorerEngine.POSITION_LAYER_ID, title: 'Position Defensibility - Position', elevationInfo: { mode: 'on-the-ground' } as any });
    this._egrLayer = new GraphicsLayer({ id: PosDefScorerEngine.EGRESS_LAYER_ID, title: 'Position Defensibility - Egress', elevationInfo: { mode: 'on-the-ground' } as any });
    this._histLayer = new GraphicsLayer({ id: PosDefScorerEngine.HISTORY_LAYER_ID, title: 'Position Defensibility - History', elevationInfo: { mode: 'on-the-ground' } as any });
  }

  private _ensurePanels(): void {
    if (!this._scorePanelEl) {
      this._scorePanelEl = document.createElement('div');
      this._scorePanelEl.id = 'posdef-left-panel';
      this._scorePanelEl.innerHTML = this._scorePanelHtml();
      document.body.appendChild(this._scorePanelEl);
    }
    if (!this._controlPanelEl) {
      this._controlPanelEl = document.createElement('div');
      this._controlPanelEl.id = 'posdef-right-panel';
      this._controlPanelEl.innerHTML = this._controlPanelHtml();
      document.body.appendChild(this._controlPanelEl);
      this._bindPanelEvents();
    }
    if (!this._hintEl) {
      this._hintEl = document.createElement('div');
      this._hintEl.id = 'posdef-hint';
      this._hintEl.textContent = 'Click map to score a position - Ctrl+Click to add egress waypoints';
      document.body.appendChild(this._hintEl);
    }
    this._drawRadar({ obs: 0, fof: 0, cff: 0, cfv: 0, egr: 0, dg: 0 });
  }

  private _scorePanelHtml(): string {
    return `
      <div class="posdef-lph">
        <div class="posdef-lph-title">Defensibility Scorer</div>
        <div class="posdef-lph-sub" id="posdef-lph-sub">Click map to score a position</div>
      </div>
      <div id="posdef-score-ring-wrap">
        <div id="posdef-score-ring">
          <svg id="posdef-score-svg" width="90" height="90" viewBox="0 0 90 90">
            <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="7"></circle>
            <circle id="posdef-score-arc" cx="45" cy="45" r="38" fill="none" stroke="#1D9E75" stroke-width="7" stroke-dasharray="0 239" stroke-dashoffset="60" stroke-linecap="round" transform="rotate(-90 45 45)"></circle>
          </svg>
          <div id="posdef-score-num">-</div>
        </div>
        <div id="posdef-score-meta">
          <div id="posdef-score-grade">-</div>
          <div id="posdef-score-desc">Place a position<br>on the map to score it</div>
        </div>
      </div>
      <div id="posdef-radar-wrap"><canvas id="posdef-radar-canvas" width="248" height="190"></canvas></div>
      <div id="posdef-factors">
        <div id="posdef-factor-empty">Scores for each factor will<br>appear here after analysis.<br><br>Each factor is scored 0-20.<br>Total composite score: 0-100.</div>
      </div>
      <div id="posdef-pos-history" style="display:none">
        <div class="posdef-ph-header">Previous positions</div>
        <div id="posdef-ph-rows"></div>
      </div>
    `;
  }

  private _controlPanelHtml(): string {
    return `
      <div class="posdef-ph2">
        <div class="posdef-ph2-title">Analysis Config</div>
        <div class="posdef-help-wrap">
          <button class="posdef-help-btn" id="posdef-help-btn" title="Position defensibility wiki">?</button>
          <button class="posdef-close-btn" id="posdef-close-btn" title="Close">x</button>
        </div>
        <div class="posdef-ph2-status ready" id="posdef-status">Click map to score</div>
      </div>
      <div class="posdef-help-popover" id="posdef-help-popover" hidden>
        <div class="posdef-help-head"><div><div class="posdef-help-kicker">Wiki</div><div class="posdef-help-title">Position Defensibility Scorer</div></div><button id="posdef-help-close" class="posdef-help-close">x</button></div>
        <div class="posdef-help-body">
          <p>Scores a fighting position from terrain-derived observation, fields of fire, cover, concealment, egress, and rear dead ground.</p>
          <div class="posdef-help-block"><h4>Workflow</h4><ol><li>Open from More Actions or right-click a symbol.</li><li>Click the map to score a position.</li><li>Ctrl+Click or use + Egress to add withdrawal routes.</li><li>Adjust ranges, weights, and overlays, then Re-score.</li></ol></div>
          <div class="posdef-help-block"><h4>Factors</h4><dl><dt>Observation</dt><dd>Visible ray coverage across the selected radius.</dd><dt>Fields of fire</dt><dd>Visible arcs inside the configured threat sector.</dd><dt>Cover</dt><dd>Nearby terrain masking from fire and view.</dd><dt>Egress</dt><dd>Clear or masked routes away from the position.</dd><dt>Dead ground</dt><dd>Rear terrain below line of sight for movement and FUP.</dd></dl></div>
        </div>
      </div>
      <div class="posdef-ps">Observer / position</div>
      <div class="posdef-pg">
        <div class="posdef-pf"><div class="posdef-pl">Eye height (m)</div><input id="posdef-inp-eye" type="number" value="1.8" min="0.5" max="10" step="0.1"></div>
        <div class="posdef-pf"><div class="posdef-pl">Position type</div><select id="posdef-inp-postype"><option value="dismount">Dismount</option><option value="vehicle" selected>Vehicle</option><option value="tank">Tank</option><option value="mg">MG/ATGM</option><option value="sniper">Sniper</option></select></div>
      </div>
      <div class="posdef-ps">Analysis ranges</div>
      ${this._sliderRow('Observation radius (m)', 'obs-r', 500, 10000, 250, 3000)}
      ${this._sliderRow('Slope check radius (m)', 'slp-r', 50, 500, 25, 150)}
      ${this._sliderRow('Ray resolution (deg)', 'ray-res', 2, 15, 1, 5, 'deg')}
      <div class="posdef-ps">Egress routes (optional)</div><div id="posdef-egress-list"><div id="posdef-eg-add-hint">Ctrl+Click map to add an egress waypoint</div></div>
      <div class="posdef-ps">Scoring context</div>
      <div class="posdef-pg"><div class="posdef-pf full"><div class="posdef-pl">Threat axis (bearing deg)</div><input id="posdef-inp-threat-brg" type="number" value="270" min="0" max="359" step="1"></div></div>
      ${this._sliderRow('Slope acceptable (deg)', 'slp-ok', 5, 30, 1, 12, 'deg')}
      <div class="posdef-pdiv"></div>
      <div class="posdef-ps">Factor weights (0-5)</div>
      <div class="posdef-wt-grid">
        ${this._weightRow('Observation', 'obs', 4)}${this._weightRow('Fields of fire', 'fof', 4)}${this._weightRow('Cover from fire', 'cff', 3)}${this._weightRow('Cover from view', 'cfv', 3)}${this._weightRow('Egress routes', 'egr', 3)}${this._weightRow('Dead ground', 'dg', 3)}
      </div>
      <div class="posdef-pdiv"></div>
      <div class="posdef-ps">Overlays</div>
      ${this._toggleRow('Viewshed overlay', 'vs', true)}${this._toggleRow('Dead ground overlay', 'dg', true)}${this._toggleRow('Slope overlay', 'slp', true)}${this._toggleRow('LOS spokes', 'los', true)}${this._toggleRow('Egress LOS lines', 'egr', true)}
      <div class="posdef-pdiv"></div>
      <div id="posdef-prog-wrap"><div id="posdef-prog-track"><div id="posdef-prog-fill"></div></div><div id="posdef-prog-label">-</div></div>
      <div class="posdef-pb-row"><button class="posdef-pb" id="posdef-btn-clear">Clear</button><button class="posdef-pb" id="posdef-btn-egress-mode">+ Egress</button><button class="posdef-pb primary" id="posdef-btn-rescore" disabled>Re-score</button></div>
    `;
  }

  private _sliderRow(label: string, id: string, min: number, max: number, step: number, value: number, suffix = ''): string {
    return `<div class="posdef-psr"><div class="posdef-psr-l">${label}</div><input id="posdef-inp-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><div class="posdef-psr-v" id="posdef-${id}-v">${value}${suffix}</div></div>`;
  }

  private _weightRow(label: string, id: FactorId, value: number): string {
    return `<div class="posdef-wt-item"><div class="posdef-wt-lbl">${label}</div><div class="posdef-wt-row"><input type="range" id="posdef-wt-${id}" min="0" max="5" step="1" value="${value}"><div class="posdef-wt-val" id="posdef-wv-${id}">${value}</div></div></div>`;
  }

  private _toggleRow(label: string, id: string, checked: boolean): string {
    return `<div class="posdef-ptr"><label>${label}</label><input id="posdef-opt-${id}" type="checkbox"${checked ? ' checked' : ''}></div>`;
  }

  private _bindPanelEvents(): void {
    const p = this._controlPanelEl;
    if (!p) return;
    [['obs-r', ''], ['slp-r', ''], ['ray-res', 'deg'], ['slp-ok', 'deg']].forEach(([id, suffix]) => {
      this._input(`posdef-inp-${id}`)?.addEventListener('input', () => this._setText(`posdef-${id}-v`, `${this._input(`posdef-inp-${id}`)?.value ?? ''}${suffix}`));
    });
    (['obs', 'fof', 'cff', 'cfv', 'egr', 'dg'] as FactorId[]).forEach((id) => {
      this._input(`posdef-wt-${id}`)?.addEventListener('input', () => {
        this._setText(`posdef-wv-${id}`, this._input(`posdef-wt-${id}`)?.value ?? '0');
        if (this._history[0]) this._updateScoreUI(this._history[0].scores, this._computeComposite(this._history[0].scores));
      });
    });
    p.querySelector('#posdef-help-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const help = p.querySelector<HTMLElement>('#posdef-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#posdef-help-close')?.addEventListener('click', () => {
      const help = p.querySelector<HTMLElement>('#posdef-help-popover');
      if (help) help.hidden = true;
    });
    p.querySelector('#posdef-close-btn')?.addEventListener('click', () => this.close());
    p.querySelector('#posdef-btn-egress-mode')?.addEventListener('click', () => this._toggleEgressMode());
    p.querySelector('#posdef-btn-rescore')?.addEventListener('click', () => { if (this._currentPos) void this._runAnalysis(this._currentPos); });
    p.querySelector('#posdef-btn-clear')?.addEventListener('click', () => this._clearAll());
  }

  private _bindMapClick(): void {
    if (!this._view || this._clickHandle) return;
    this._clickHandle = this._view.on('click', async (event: any) => {
      if (this._running || !this._view) return;
      const mapPoint = event.mapPoint as Point | null;
      if (!mapPoint) return;
      const pt = new Point({ longitude: mapPoint.longitude ?? mapPoint.x, latitude: mapPoint.latitude ?? mapPoint.y, spatialReference: WGS84 });
      if (this._addingEgress || event.native?.ctrlKey) {
        this._addEgressPoint(pt);
        return;
      }
      this._currentPos = pt;
      await this._runAnalysis(pt);
    });
  }

  private _unbindMapClick(): void {
    this._clickHandle?.remove?.();
    this._clickHandle = null;
  }

  private async _runAnalysis(pt: Point): Promise<void> {
    if (this._running || !this._view) return;
    this._running = true;
    this._button('posdef-btn-rescore')?.setAttribute('disabled', 'true');
    this._clearOverlays();

    const eyeH = this._num('posdef-inp-eye', 1.8);
    const obsR = this._num('posdef-inp-obs-r', 3000);
    const slpR = this._num('posdef-inp-slp-r', 150);
    const rayRes = this._num('posdef-inp-ray-res', 5);
    const threatBrg = this._num('posdef-inp-threat-brg', 270);
    const slopeOkDeg = this._num('posdef-inp-slp-ok', 12);

    this._setStatus('running', 'Sampling terrain...');
    this._setProgress(0.05, 'Getting observer elevation');

    let obsZ = eyeH;
    try {
      const er = await (this._view.map as any).ground.queryElevation(pt);
      obsZ = ((er?.geometry?.z ?? 0) as number) + eyeH;
    } catch {}

    this._drawPosition(pt);
    const params: ScoreParams = {
      obsRadius: obsR,
      slopeRadius: slpR,
      rayRes,
      threatBrg,
      slopeOkDeg,
      showVS: this._checked('posdef-opt-vs', true),
      showDG: this._checked('posdef-opt-dg', true),
      showSlp: this._checked('posdef-opt-slp', true),
      showLOS: this._checked('posdef-opt-los', true),
      showEgr: this._checked('posdef-opt-egr', true),
    };

    try {
      this._setStatus('running', 'Casting rays...');
      this._setProgress(0.15, 'Computing horizons');
      const result = await this._scorePosition(pt, obsZ, params);

      this._setProgress(0.7, 'Building overlays');
      await this._tick();
      if (params.showVS || params.showDG || params.showSlp) this._drawRasterOverlay(result, pt, obsZ, params);
      if (params.showLOS) this._buildLOSSpokes(pt, result.horizons, result.numRays, params.rayRes, params.obsRadius, result.sampler).forEach((g) => this._spokesLayer.add(g));
      if (params.showEgr) this._drawEgressLines(pt, result.egrResults);

      this._setProgress(0.9, 'Rendering score');
      await this._tick();
      this._updateScoreUI(result.scores, result.composite);
      const g = getGrade(result.composite);
      this._setText('posdef-lph-sub', `${g.label} - Score ${result.composite}/100`);
      this._button('posdef-btn-rescore')?.removeAttribute('disabled');

      this._history.unshift({ pt, scores: result.scores, composite: result.composite, obsZ });
      if (this._history.length > 5) this._history.pop();
      this._renderHistory();
      this._setProgress(1, `Done - composite score ${result.composite}/100`);
      this._setStatus('done', 'Scored');
      this._goToPoint(pt);
    } catch (err) {
      console.warn('[PosDefScorerEngine] analysis failed', err);
      this._setStatus('ready', 'Analysis failed');
      this._setProgress(0, 'Unable to complete terrain scoring');
    } finally {
      this._running = false;
    }
  }

  private async _scorePosition(positionPt: Point, obsZ: number, params: ScoreParams): Promise<ScoreResult> {
    if (!this._view) throw new Error('No active view');
    const { obsRadius, slopeRadius, rayRes, threatBrg } = params;
    const cosLat = Math.max(0.1, Math.cos((positionPt.latitude * Math.PI) / 180));
    const padDeg = (obsRadius * 1.08) / M_PER_DEG;
    const extent = new Extent({
      xmin: positionPt.longitude - padDeg / cosLat,
      ymin: positionPt.latitude - padDeg,
      xmax: positionPt.longitude + padDeg / cosLat,
      ymax: positionPt.latitude + padDeg,
      spatialReference: WGS84,
    });
    const sampler = await (this._view.map as any).ground.createElevationSampler(extent);
    const getZ = (lon: number, lat: number): number => {
      try {
        const result = sampler.queryElevation(new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 }));
        return Number.isFinite(result?.z) ? result.z : 0;
      } catch {
        return 0;
      }
    };
    const step = Math.max(20, obsRadius / 60);
    const numRays = Math.max(8, Math.round(360 / rayRes));
    const horizons = new Float32Array(numRays);
    for (let ri = 0; ri < numRays; ri++) {
      const brg = (ri / numRays) * 360;
      let maxSlp = -90;
      for (let d = step; d <= obsRadius; d += step) {
        const p = destPt(positionPt.longitude, positionPt.latitude, brg, d);
        maxSlp = Math.max(maxSlp, Math.atan2(getZ(p.longitude, p.latitude) - obsZ, d) * 180 / Math.PI);
      }
      horizons[ri] = maxSlp;
    }

    let visRays = 0;
    for (let ri = 0; ri < numRays; ri++) {
      const brg = (ri / numRays) * 360;
      const p = destPt(positionPt.longitude, positionPt.latitude, brg, obsRadius * 0.9);
      const slp = Math.atan2(getZ(p.longitude, p.latitude) - obsZ, obsRadius * 0.9) * 180 / Math.PI;
      if (slp >= horizons[ri]) visRays++;
    }
    const obsScore = Math.round(Math.min(20, (visRays / numRays) * 20));

    let fofVis = 0;
    let fofTotal = 0;
    for (let ri = 0; ri < numRays; ri++) {
      const brg = (ri / numRays) * 360;
      const delta = Math.abs(((brg - threatBrg + 540) % 360) - 180);
      if (delta > 90) continue;
      fofTotal++;
      const p = destPt(positionPt.longitude, positionPt.latitude, brg, obsRadius * 0.85);
      const slp = Math.atan2(getZ(p.longitude, p.latitude) - obsZ, obsRadius * 0.85) * 180 / Math.PI;
      if (slp >= horizons[ri]) fofVis++;
    }
    const fofScore = fofTotal > 0 ? Math.round(Math.min(20, (fofVis / fofTotal) * 20)) : 10;

    let totalRise = 0;
    for (let fi = 0; fi < 24; fi++) {
      const p = destPt(positionPt.longitude, positionPt.latitude, (fi / 24) * 360, slopeRadius);
      totalRise += Math.max(0, getZ(p.longitude, p.latitude) - obsZ + 0.5);
    }
    const cffScore = Math.round(Math.min(20, (totalRise / 24) / 15 * 20));

    let blocked = 0;
    for (let oi = 0; oi < 24; oi++) {
      const brg = (oi / 24) * 360;
      const p = destPt(positionPt.longitude, positionPt.latitude, brg, obsRadius * 0.9);
      const extObsZ = getZ(p.longitude, p.latitude) + 1.8;
      const dist = geoDist(positionPt.longitude, positionPt.latitude, p.longitude, p.latitude);
      const reverseSlp = Math.atan2(obsZ - extObsZ, dist) * 180 / Math.PI;
      const reverseBrg = (brg + 180) % 360;
      let maxReverseSlp = -90;
      for (let d = step; d < dist * 0.95; d += step) {
        const ip = destPt(p.longitude, p.latitude, reverseBrg, d);
        maxReverseSlp = Math.max(maxReverseSlp, Math.atan2(getZ(ip.longitude, ip.latitude) - extObsZ, d) * 180 / Math.PI);
      }
      if (reverseSlp < maxReverseSlp) blocked++;
    }
    const cfvScore = Math.round(Math.min(20, (blocked / 24) * 20));

    let egrScore = 10;
    const egrResults: EgressResult[] = [];
    if (this._egressPts.length > 0) {
      let clearEgr = 0;
      for (const ept of this._egressPts) {
        const dist = geoDist(positionPt.longitude, positionPt.latitude, ept.longitude, ept.latitude);
        const egrBrg = ((Math.atan2((ept.longitude - positionPt.longitude) * cosLat, ept.latitude - positionPt.latitude) * 180 / Math.PI) + 360) % 360;
        let maxSlpToEgr = -90;
        for (let d = step; d < dist * 0.95; d += step) {
          const p = destPt(positionPt.longitude, positionPt.latitude, egrBrg, d);
          maxSlpToEgr = Math.max(maxSlpToEgr, Math.atan2(getZ(p.longitude, p.latitude) - obsZ, d) * 180 / Math.PI);
        }
        const eptSlp = Math.atan2(getZ(ept.longitude, ept.latitude) - obsZ, dist) * 180 / Math.PI;
        const clear = eptSlp >= maxSlpToEgr;
        const mid = destPt(positionPt.longitude, positionPt.latitude, egrBrg, dist * 0.5);
        const midSlp = Math.atan2(getZ(mid.longitude, mid.latitude) - obsZ, dist * 0.5) * 180 / Math.PI;
        const masked = midSlp < horizons[Math.round(egrBrg / rayRes) % numRays] * 0.7;
        egrResults.push({ pt: ept, clear, masked, dist: Math.round(dist) });
        if (clear) clearEgr++;
      }
      const maskedCount = egrResults.filter((r) => r.masked).length;
      egrScore = Math.round(Math.min(20, (clearEgr / this._egressPts.length) * 12 + (maskedCount / this._egressPts.length) * 8));
    }

    const rearBrg = (threatBrg + 180) % 360;
    let totalDG = 0;
    let dgCount = 0;
    for (let ri = 0; ri < numRays; ri++) {
      const brg = (ri / numRays) * 360;
      if (Math.abs(((brg - rearBrg + 540) % 360) - 180) > 60) continue;
      for (let d = step; d <= slopeRadius * 3; d += step) {
        const p = destPt(positionPt.longitude, positionPt.latitude, brg, d);
        const losZ = obsZ + d * Math.tan(horizons[ri] * Math.PI / 180);
        const z = getZ(p.longitude, p.latitude);
        if (z < losZ) {
          totalDG += losZ - z;
          dgCount++;
        }
      }
    }
    const dgScore = Math.round(Math.min(20, ((dgCount ? totalDG / dgCount : 0) / 8) * 20));
    const scores: ScoreMap = { obs: obsScore, fof: fofScore, cff: cffScore, cfv: cfvScore, egr: egrScore, dg: dgScore };
    return { scores, composite: this._computeComposite(scores), horizons, egrResults, sampler, extent, numRays };
  }

  private _drawRasterOverlay(result: ScoreResult, positionPt: Point, obsZ: number, params: ScoreParams): void {
    if (!this._view) return;
    const canvas = this._buildViewshedCanvas(result.horizons, result.numRays, params.rayRes, positionPt, obsZ, result.sampler, result.extent, params.obsRadius, 0.8);
    const ml = new MediaLayer({
      source: [new ImageElement({ image: canvas.toDataURL('image/png'), georeference: new ExtentAndRotationGeoreference({ extent: result.extent }) })],
      title: 'Position Defensibility - Viewshed / Dead Ground',
    });
    (this._view.map as any).add(ml, 0);
    this._mediaLayers.push(ml);
  }

  private _buildViewshedCanvas(horizons: Float32Array, numRays: number, rayRes: number, positionPt: Point, obsZ: number, sampler: any, extent: Extent, obsRadius: number, opacity: number): HTMLCanvasElement {
    const cols = Math.round(obsRadius * 2 / 40);
    const rows = Math.round(obsRadius * 2 / 40);
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const cosLat = Math.cos(positionPt.latitude * Math.PI / 180);
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lon = extent.xmin + (c + 0.5) * dLon;
        const lat = extent.ymax - (r + 0.5) * dLat;
        const east = (lon - positionPt.longitude) * M_PER_DEG * cosLat;
        const north = (lat - positionPt.latitude) * M_PER_DEG;
        const dist = Math.sqrt(east * east + north * north);
        if (dist < 5 || dist > obsRadius) continue;
        const brg = ((Math.atan2(east, north) * 180 / Math.PI) + 360) % 360;
        const ri = Math.round(brg / rayRes) % numRays;
        const z = sampler.queryElevation(new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 }))?.z ?? 0;
        const slp = Math.atan2(z - obsZ, dist) * 180 / Math.PI;
        const px = (r * cols + c) * 4;
        if (slp >= horizons[ri]) {
          img.data[px] = 29; img.data[px + 1] = 158; img.data[px + 2] = 117; img.data[px + 3] = Math.round(0.35 * opacity * 255);
        } else {
          img.data[px] = 80; img.data[px + 1] = 20; img.data[px + 2] = 20; img.data[px + 3] = Math.round(0.25 * opacity * 255);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private _buildLOSSpokes(positionPt: Point, horizons: Float32Array, numRays: number, rayRes: number, obsRadius: number, sampler: any): Graphic[] {
    const graphics: Graphic[] = [];
    const posZ = sampler.queryElevation(positionPt)?.z ?? 0;
    for (let ri = 0; ri < numRays; ri += 3) {
      const brg = (ri / numRays) * 360;
      const p = destPt(positionPt.longitude, positionPt.latitude, brg, obsRadius);
      const z = sampler.queryElevation(new Point({ longitude: p.longitude, latitude: p.latitude, spatialReference: WGS84 }))?.z ?? 0;
      const visible = (Math.atan2(z - posZ + 2, obsRadius) * 180 / Math.PI) >= horizons[ri];
      graphics.push(new Graphic({
        geometry: new Polyline({ paths: [[[positionPt.longitude, positionPt.latitude], [p.longitude, p.latitude]]], spatialReference: WGS84 }),
        symbol: { type: 'simple-line', color: visible ? [29, 158, 117, 40] : [80, 20, 20, 30], width: 0.6 } as any,
        attributes: { type: 'posdef_los_spoke', visible },
      }));
    }
    return graphics;
  }

  private _drawPosition(pt: Point): void {
    this._posLayer.removeAll();
    this._posLayer.add(new Graphic({
      geometry: pt,
      symbol: this._view?.type === '3d'
        ? { type: 'point-3d', symbolLayers: [{ type: 'object', resource: { primitive: 'sphere' }, material: { color: [29, 158, 117, 0.95] }, width: 70, height: 70, depth: 70 }], verticalOffset: { screenLength: 24, maxWorldLength: 600, minWorldLength: 5 } } as any
        : { type: 'simple-marker', color: [29, 158, 117, 220], size: 14, outline: { color: [0, 0, 0, 180], width: 1 } } as any,
      attributes: { type: 'Scored position', label: `${pt.latitude.toFixed(5)}N ${pt.longitude.toFixed(5)}E` },
    }));
    this._posLayer.add(new Graphic({ geometry: pt, symbol: this._textSymbol('POS', '#1D9E75', 18), attributes: { type: 'posdef_position_label' } }));
  }

  private _addEgressPoint(pt: Point): void {
    this._egressPts.push(pt);
    this._redrawEgressMarkers();
    this._renderEgressList();
  }

  private _redrawEgressMarkers(): void {
    const lineGraphics = this._egrLayer.graphics.filter((g: Graphic) => g.attributes?.type === 'Egress LOS').toArray();
    this._egrLayer.removeAll();
    lineGraphics.forEach((g: Graphic) => this._egrLayer.add(g));
    this._egressPts.forEach((pt, i) => {
      this._egrLayer.add(new Graphic({
        geometry: pt,
        symbol: this._view?.type === '3d'
          ? { type: 'point-3d', symbolLayers: [{ type: 'object', resource: { primitive: 'diamond' }, material: { color: [55, 138, 221, 0.9] }, width: 55, height: 55, depth: 55 }], verticalOffset: { screenLength: 18, maxWorldLength: 400, minWorldLength: 4 } } as any
          : { type: 'simple-marker', style: 'diamond', color: [55, 138, 221, 220], size: 12, outline: { color: [0, 0, 0, 160], width: 1 } } as any,
        attributes: { type: `Egress point ${i + 1}`, label: 'Egress route waypoint' },
      }));
      this._egrLayer.add(new Graphic({ geometry: pt, symbol: this._textSymbol(`E${i + 1}`, '#378ADD', 14), attributes: { type: 'posdef_egress_label' } }));
    });
  }

  private _drawEgressLines(pt: Point, results: EgressResult[]): void {
    results.forEach((er) => {
      const color = er.clear ? (er.masked ? [78, 200, 64] : [29, 158, 117]) : [220, 60, 48];
      this._egrLayer.add(new Graphic({
        geometry: new Polyline({ paths: [[[pt.longitude, pt.latitude], [er.pt.longitude, er.pt.latitude]]], spatialReference: WGS84 }),
        symbol: { type: 'simple-line', color: [...color, 180], width: 2, style: er.masked ? 'solid' : 'short-dash' } as any,
        attributes: { type: 'Egress LOS', label: `${er.clear ? 'Clear' : 'Blocked'} - ${er.dist}m${er.masked ? ' (masked)' : ''}` },
      }));
    });
  }

  private _updateScoreUI(scores: ScoreMap, composite: number): void {
    const g = getGrade(composite);
    const arc = this._el('posdef-score-arc') as SVGCircleElement | null;
    const circ = 2 * Math.PI * 38;
    if (arc) {
      arc.style.strokeDasharray = `${composite / 100 * circ} ${circ}`;
      arc.style.stroke = g.color;
    }
    this._setText('posdef-score-num', String(composite));
    this._setStyle('posdef-score-num', 'color', g.color);
    this._setText('posdef-score-grade', `${g.grade} - ${g.label}`);
    this._setStyle('posdef-score-grade', 'color', g.color);
    this._setText('posdef-score-desc', this._gradeDescription(composite, scores));
    const wrap = this._el('posdef-factors');
    if (wrap) {
      wrap.innerHTML = '';
      FACTORS.forEach((f) => {
        const s = scores[f.id] ?? 0;
        const row = document.createElement('div');
        row.className = 'posdef-factor-row';
        row.innerHTML = `<div class="posdef-fac-icon">${f.icon}</div><div class="posdef-fac-body"><div class="posdef-fac-name">${f.label}</div><div class="posdef-fac-track"><div class="posdef-fac-fill" style="width:${s / 20 * 100}%;background:${f.color}"></div></div><div class="posdef-fac-note">${f.desc(s)}</div></div><div><div class="posdef-fac-score" style="color:${f.color}">${s}</div><div class="posdef-fac-max">/20</div></div>`;
        wrap.appendChild(row);
      });
    }
    this._drawRadar(scores);
  }

  private _drawRadar(scores: ScoreMap): void {
    const canvas = this._el('posdef-radar-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2 + 8;
    const R = Math.min(W, H) * 0.34;
    const N = FACTORS.length;
    ctx.clearRect(0, 0, W, H);
    [0.25, 0.5, 0.75, 1].forEach((t) => {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const a = (i / N) * 2 * Math.PI - Math.PI / 2;
        const x = cx + Math.cos(a) * R * t;
        const y = cy + Math.sin(a) * R * t;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(255,255,255,${t === 1 ? 0.12 : 0.06})`;
      ctx.lineWidth = t === 1 ? 1 : 0.5;
      ctx.stroke();
    });
    FACTORS.forEach((_, i) => {
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
    const dataPts = FACTORS.map((f, i) => {
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      const t = Math.min(1, (scores[f.id] ?? 0) / 20);
      return [cx + Math.cos(a) * R * t, cy + Math.sin(a) * R * t];
    });
    ctx.beginPath();
    dataPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(29,158,117,0.18)';
    ctx.strokeStyle = 'rgba(29,158,117,0.80)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    FACTORS.forEach((f, i) => {
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      const t = Math.min(1, (scores[f.id] ?? 0) / 20);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.beginPath();
      ctx.arc(cx + dx * R * t, cy + dy * R * t, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.font = '700 9px "Courier New"';
      ctx.fillStyle = f.color;
      ctx.textAlign = dx > 0.1 ? 'left' : dx < -0.1 ? 'right' : 'center';
      ctx.textBaseline = dy > 0.1 ? 'top' : dy < -0.1 ? 'bottom' : 'middle';
      ctx.fillText(`${f.icon} ${scores[f.id] ?? '-'}`, cx + dx * (R + 14), cy + dy * (R + 14));
    });
    const composite = this._computeComposite(scores);
    const g = getGrade(composite);
    ctx.font = '700 20px "Courier New"';
    ctx.fillStyle = g.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(composite), cx, cy - 4);
    ctx.font = '9px "Courier New"';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('/100', cx, cy + 12);
  }

  private _renderHistory(): void {
    const hist = this._el('posdef-pos-history');
    const rows = this._el('posdef-ph-rows');
    if (!hist || !rows) return;
    if (!this._history.length) {
      hist.style.display = 'none';
      return;
    }
    hist.style.display = 'block';
    rows.innerHTML = '';
    this._history.forEach((h, i) => {
      const g = getGrade(h.composite);
      const row = document.createElement('div');
      row.className = `posdef-ph-row${i === 0 ? ' active-pos' : ''}`;
      row.innerHTML = `<div class="posdef-ph-dot" style="background:${g.color}"></div><div class="posdef-ph-info">${h.pt.latitude.toFixed(4)}N ${h.pt.longitude.toFixed(4)}E</div><div class="posdef-ph-scr" style="color:${g.color}">${h.composite}</div>`;
      row.addEventListener('click', () => {
        this._scorePanelEl?.querySelectorAll('.posdef-ph-row').forEach((x) => x.classList.remove('active-pos'));
        row.classList.add('active-pos');
        this._goToPoint(h.pt);
        this._updateScoreUI(h.scores, h.composite);
      });
      rows.appendChild(row);
    });
    this._histLayer.removeAll();
    this._history.slice(1).forEach((h) => {
      const [r, gr, b] = hexToRgb(getGrade(h.composite).color);
      this._histLayer.add(new Graphic({
        geometry: h.pt,
        symbol: this._view?.type === '3d'
          ? { type: 'point-3d', symbolLayers: [{ type: 'object', resource: { primitive: 'sphere' }, material: { color: [r, gr, b, 0.55] }, width: 45, height: 45, depth: 45 }], verticalOffset: { screenLength: 14, maxWorldLength: 400, minWorldLength: 3 } } as any
          : { type: 'simple-marker', color: [r, gr, b, 130], size: 9 } as any,
        attributes: { type: 'Previous position', label: `Score ${h.composite}` },
      }));
    });
  }

  private _renderEgressList(): void {
    const list = this._el('posdef-egress-list');
    if (!list) return;
    list.innerHTML = '';
    if (!this._egressPts.length) {
      list.innerHTML = '<div id="posdef-eg-add-hint">Ctrl+Click map to add an egress waypoint</div>';
      return;
    }
    this._egressPts.forEach((ep, i) => {
      const row = document.createElement('div');
      row.className = 'posdef-eg-row';
      row.innerHTML = `<div class="posdef-eg-dot"></div><div class="posdef-eg-coords">E${i + 1} ${ep.latitude.toFixed(4)}N ${ep.longitude.toFixed(4)}E</div><button class="posdef-eg-del" data-i="${i}">x</button>`;
      row.querySelector('.posdef-eg-del')?.addEventListener('click', () => {
        this._egressPts.splice(i, 1);
        this._redrawEgressMarkers();
        this._renderEgressList();
      });
      list.appendChild(row);
    });
  }

  private _toggleEgressMode(): void {
    this._addingEgress = !this._addingEgress;
    const btn = this._button('posdef-btn-egress-mode');
    if (btn) {
      btn.textContent = this._addingEgress ? 'Cancel egress' : '+ Egress';
      btn.style.background = this._addingEgress ? 'rgba(55,138,221,0.15)' : '';
    }
    if (this._hintEl) {
      this._hintEl.textContent = this._addingEgress
        ? 'Click map to add egress waypoints - click Cancel when done'
        : 'Click map to score a position - Ctrl+Click to add egress waypoints';
    }
  }

  private _clearAll(): void {
    this._currentPos = null;
    this._egressPts = [];
    this._history = [];
    [this._overlayLayer, this._spokesLayer, this._posLayer, this._egrLayer, this._histLayer].forEach((l) => l.removeAll());
    this._clearOverlays();
    this._setText('posdef-lph-sub', 'Click map to score a position');
    this._setText('posdef-score-num', '-');
    this._setText('posdef-score-grade', '-');
    this._setText('posdef-score-desc', 'Place a position on the map to score it');
    const arc = this._el('posdef-score-arc') as SVGCircleElement | null;
    if (arc) arc.style.strokeDasharray = '0 239';
    const factors = this._el('posdef-factors');
    if (factors) factors.innerHTML = '<div id="posdef-factor-empty">Scores for each factor will<br>appear here after analysis.</div>';
    const hist = this._el('posdef-pos-history');
    if (hist) hist.style.display = 'none';
    this._drawRadar({ obs: 0, fof: 0, cff: 0, cfv: 0, egr: 0, dg: 0 });
    this._renderEgressList();
    this._button('posdef-btn-rescore')?.setAttribute('disabled', 'true');
    this._setProgress(0, '-');
    this._setStatus('ready', 'Click map to score');
    if (this._hintEl) this._hintEl.textContent = 'Click map to score a position - Ctrl+Click to add egress waypoints';
  }

  private _clearOverlays(): void {
    this._spokesLayer.removeAll();
    this._egrLayer.graphics
      .filter((g: Graphic) => g.attributes?.type === 'Egress LOS')
      .toArray()
      .forEach((g: Graphic) => this._egrLayer.remove(g));
    const map = this._view?.map as any;
    this._mediaLayers.forEach((l) => { try { map?.remove(l); } catch {} });
    this._mediaLayers = [];
  }

  private _computeComposite(scores: ScoreMap): number {
    const w = this._weights();
    const wT = Object.values(w).reduce((s, v) => s + v, 0) || 1;
    return Math.round(FACTORS.reduce((s, f) => s + (scores[f.id] ?? 0) * ((w[f.id] ?? 1) / 20), 0) / wT * 100);
  }

  private _weights(): Record<FactorId, number> {
    return {
      obs: this._num('posdef-wt-obs', 4),
      fof: this._num('posdef-wt-fof', 4),
      cff: this._num('posdef-wt-cff', 3),
      cfv: this._num('posdef-wt-cfv', 3),
      egr: this._num('posdef-wt-egr', 3),
      dg: this._num('posdef-wt-dg', 3),
    };
  }

  private _gradeDescription(score: number, scores: ScoreMap): string {
    const weak = FACTORS.filter((f) => (scores[f.id] ?? 0) < 8).map((f) => f.label.toLowerCase());
    if (score >= 75) return `Strong position. ${weak.length ? `Weakness: ${weak[0]}.` : 'All factors adequate.'}`;
    if (score >= 55) return `Acceptable. Improve: ${weak.slice(0, 2).join(', ') || 'marginal all round'}.`;
    if (score >= 40) return `Marginal. Critical weaknesses in: ${weak.slice(0, 2).join(', ') || 'multiple factors'}.`;
    return `Avoid this position. Multiple critical failures: ${weak.slice(0, 3).join(', ')}.`;
  }

  private _goToPoint(pt: Point): void {
    const target = this._view?.type === '3d'
      ? { center: [pt.longitude, pt.latitude], zoom: 14, tilt: 62 }
      : { center: [pt.longitude, pt.latitude], zoom: 14 };
    void this._view?.goTo(target as any, { duration: 900 }).catch(() => {});
  }

  private _showPanels(): void {
    if (this._scorePanelEl) this._scorePanelEl.style.display = 'flex';
    if (this._controlPanelEl) this._controlPanelEl.style.display = 'block';
    if (this._hintEl) this._hintEl.style.display = 'block';
  }

  private _hidePanels(): void {
    if (this._scorePanelEl) this._scorePanelEl.style.display = 'none';
    if (this._controlPanelEl) this._controlPanelEl.style.display = 'none';
    if (this._hintEl) this._hintEl.style.display = 'none';
  }

  private _textSymbol(text: string, color: string, yoffset: number): any {
    return { type: 'text', text, color, haloColor: [0, 0, 0, 190], haloSize: 2, font: { family: 'Courier New', size: 9, weight: 'bold' }, yoffset, horizontalAlignment: 'center' };
  }

  private _setStatus(s: 'ready' | 'running' | 'done', t: string): void {
    const el = this._el('posdef-status');
    if (s === 'done') EngineLogger.success(ENGINE_NAME, t);
    else EngineLogger.nextStep(ENGINE_NAME, t);
    if (el) {
      el.textContent = t;
      el.className = `posdef-ph2-status ${s}`;
    }
  }

  private _setProgress(f: number, label: string): void {
    const fill = this._el('posdef-prog-fill');
    if (fill) fill.style.width = `${Math.round(clamp(f, 0, 1) * 100)}%`;
    this._setText('posdef-prog-label', label);
  }

  private _tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private _el(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  private _input(id: string): HTMLInputElement | null {
    return this._el(id) as HTMLInputElement | null;
  }

  private _button(id: string): HTMLButtonElement | null {
    return this._el(id) as HTMLButtonElement | null;
  }

  private _num(id: string, fallback: number): number {
    const value = Number(this._input(id)?.value ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  }

  private _checked(id: string, fallback: boolean): boolean {
    const el = this._input(id);
    return el ? el.checked : fallback;
  }

  private _setText(id: string, value: string): void {
    const el = this._el(id);
    if (el) el.textContent = value;
  }

  private _setStyle(id: string, prop: keyof CSSStyleDeclaration, value: string): void {
    const el = this._el(id);
    if (el) (el.style as any)[prop] = value;
  }

  private _injectStyles(): void {
    if (document.getElementById('posdef-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'posdef-engine-styles';
    style.textContent = `
      #posdef-left-panel,#posdef-right-panel,#posdef-hint{font-family:'Courier New',monospace}
      #posdef-left-panel{position:absolute;top:14px;left:14px;width:272px;z-index:1098;background:rgba(6,7,9,.97);border:1px solid rgba(29,158,117,.28);border-radius:5px;color:#bfbcb4;font-size:12px;max-height:calc(100vh - 28px);display:none;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,.45)}
      #posdef-right-panel{position:absolute;top:14px;right:14px;width:284px;z-index:1098;background:rgba(6,7,9,.97);border:1px solid rgba(29,158,117,.28);border-radius:5px;color:#bfbcb4;font-size:12px;max-height:calc(100vh - 28px);overflow-y:auto;display:none;box-shadow:0 8px 24px rgba(0,0,0,.45)}
      .posdef-lph{padding:9px 12px 8px;border-bottom:1px solid rgba(29,158,117,.15);background:rgba(29,158,117,.07);flex-shrink:0}.posdef-lph-title,.posdef-ph2-title{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#1D9E75;font-weight:700}.posdef-lph-sub{font-size:9px;color:#3a3935;letter-spacing:.05em;margin-top:2px}
      #posdef-score-ring-wrap{display:flex;align-items:center;justify-content:center;gap:14px;padding:14px 12px;border-bottom:1px solid rgba(29,158,117,.12);flex-shrink:0}#posdef-score-ring{position:relative;width:90px;height:90px;flex-shrink:0}#posdef-score-num{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:26px;font-weight:700;color:#1D9E75;letter-spacing:-.02em;text-align:center;line-height:1}#posdef-score-meta{flex:1}#posdef-score-grade{font-size:18px;font-weight:700;color:#1D9E75;margin-bottom:4px}#posdef-score-desc{font-size:10px;color:#888780;line-height:1.5}
      #posdef-radar-wrap{padding:10px 12px;border-bottom:1px solid rgba(29,158,117,.10);flex-shrink:0;display:flex;align-items:center;justify-content:center}#posdef-radar-canvas{display:block}#posdef-factors{overflow-y:auto;flex:1;padding:8px 10px}.posdef-factor-row{display:grid;grid-template-columns:30px 1fr 32px;align-items:center;gap:6px;margin-bottom:8px}.posdef-fac-icon{font-size:10px;text-align:center;color:#888780}.posdef-fac-body{display:flex;flex-direction:column;gap:3px}.posdef-fac-name{font-size:10px;font-weight:500;color:#bfbcb4}.posdef-fac-track{height:3px;background:rgba(255,255,255,.06);border-radius:2px}.posdef-fac-fill{height:100%;border-radius:2px;transition:width .6s}.posdef-fac-note{font-size:8.5px;color:#3a3935;letter-spacing:.03em}.posdef-fac-score{font-size:13px;font-weight:700;text-align:right}.posdef-fac-max{font-size:8px;color:#3a3935;text-align:right;margin-top:1px}#posdef-factor-empty{padding:18px 10px;font-size:10px;color:#3a3935;text-align:center;line-height:1.8}
      #posdef-pos-history{border-top:1px solid rgba(29,158,117,.10);flex-shrink:0;max-height:130px;overflow-y:auto}.posdef-ph-header{font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:#3a3935;padding:6px 10px 3px}.posdef-ph-row{display:flex;align-items:center;gap:7px;padding:4px 10px;cursor:pointer;transition:background .12s}.posdef-ph-row:hover,.posdef-ph-row.active-pos{background:rgba(29,158,117,.10)}.posdef-ph-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}.posdef-ph-info{flex:1;font-size:9.5px;color:#888780}.posdef-ph-scr{font-size:11px;font-weight:700}
      .posdef-ph2{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:9px 12px 8px;border-bottom:1px solid rgba(29,158,117,.15);background:rgba(29,158,117,.07);position:sticky;top:0;z-index:2}.posdef-help-wrap{display:flex;gap:4px}.posdef-help-btn,.posdef-close-btn,.posdef-help-close{background:transparent;border:1px solid rgba(29,158,117,.28);border-radius:3px;color:#1D9E75;font-family:inherit;font-size:10px;cursor:pointer}.posdef-ph2-status{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#3a3935;transition:color .2s}.posdef-ph2-status.ready,.posdef-ph2-status.done{color:#1D9E75}.posdef-ph2-status.running{color:#EF9F27}
      .posdef-help-popover{position:absolute;top:37px;left:8px;right:8px;z-index:1120;max-height:min(440px,calc(100vh - 132px));overflow-y:auto;background:rgba(6,7,9,.99);border:1px solid rgba(29,158,117,.28);border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.45)}.posdef-help-popover[hidden]{display:none}.posdef-help-head{display:flex;justify-content:space-between;gap:10px;padding:10px 11px 8px;border-bottom:1px solid rgba(29,158,117,.15);background:rgba(29,158,117,.07)}.posdef-help-kicker{font-size:9px;color:#3a3935;letter-spacing:.09em;text-transform:uppercase}.posdef-help-title{margin-top:2px;font-size:13px;color:#1D9E75;font-weight:700}.posdef-help-body{padding:10px 11px 12px;font-size:10px;line-height:1.45;color:#888780;user-select:text}.posdef-help-body p{margin:0 0 9px}.posdef-help-block{margin-top:10px}.posdef-help-block h4{margin:0 0 5px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#bfbcb4}.posdef-help-block ol{margin:0;padding-left:17px}.posdef-help-block li{margin:3px 0}.posdef-help-block dl{display:grid;grid-template-columns:74px minmax(0,1fr);gap:5px 8px;margin:0}.posdef-help-block dt{color:#1D9E75;font-weight:700}.posdef-help-block dd{margin:0}
      .posdef-ps{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#3a3935;padding:9px 12px 5px}.posdef-pg{display:grid;grid-template-columns:1fr 1fr;gap:7px 10px;padding:0 12px 9px}.posdef-pf{display:flex;flex-direction:column;gap:3px}.posdef-pf.full{grid-column:1/-1}.posdef-pl{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780}#posdef-right-panel input,#posdef-right-panel select{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:3px;color:#bfbcb4;font-family:'Courier New',monospace;font-size:11px;padding:5px 7px;width:100%;outline:none;transition:border-color .15s}#posdef-right-panel input:focus,#posdef-right-panel select:focus{border-color:rgba(29,158,117,.55)}#posdef-right-panel select option{background:#141618}
      .posdef-psr{display:flex;align-items:center;gap:8px;padding:0 12px 8px}.posdef-psr-l{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780;flex:1.8}.posdef-psr input[type=range]{flex:2;accent-color:#1D9E75;cursor:pointer}.posdef-psr-v{font-size:10px;color:#1D9E75;min-width:38px;text-align:right}.posdef-pdiv{height:1px;background:rgba(255,255,255,.07);margin:4px 0}.posdef-ptr{display:flex;align-items:center;justify-content:space-between;padding:5px 12px}.posdef-ptr label{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780;cursor:pointer}.posdef-ptr input[type=checkbox]{accent-color:#1D9E75;width:13px;height:13px;cursor:pointer}
      #posdef-egress-list{padding:0 12px 8px}.posdef-eg-row{display:flex;align-items:center;gap:7px;padding:4px 0;border-bottom:.5px solid rgba(255,255,255,.05)}.posdef-eg-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#378ADD}.posdef-eg-coords{font-size:9.5px;color:#888780;flex:1;letter-spacing:.03em}.posdef-eg-del{font-size:10px;color:#3a3935;cursor:pointer;border:none;background:transparent;padding:2px 4px;transition:color .12s}.posdef-eg-del:hover{color:#DC3C30}#posdef-eg-add-hint{font-size:9px;color:#3a3935;padding:4px 0;letter-spacing:.04em}
      .posdef-wt-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;padding:0 12px 8px}.posdef-wt-item{display:flex;flex-direction:column;gap:3px}.posdef-wt-lbl{font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#888780}.posdef-wt-row{display:flex;align-items:center;gap:4px}.posdef-wt-row input[type=range]{flex:1;accent-color:#1D9E75}.posdef-wt-val{font-size:9px;color:#1D9E75;min-width:18px;text-align:right}
      #posdef-prog-wrap{padding:0 12px 9px}#posdef-prog-track{height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden}#posdef-prog-fill{height:100%;background:linear-gradient(to right,#1D9E75,#378ADD);border-radius:2px;width:0%;transition:width .12s}#posdef-prog-label{font-size:9px;color:#3a3935;letter-spacing:.05em;margin-top:4px}.posdef-pb-row{display:flex;gap:6px;padding:9px 12px}.posdef-pb{flex:1;padding:7px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:3px;border:1px solid rgba(29,158,117,.38);background:transparent;color:#1D9E75;transition:all .14s}.posdef-pb:hover:not(:disabled){background:rgba(29,158,117,.10)}.posdef-pb.primary{background:rgba(29,158,117,.16);border-color:#1D9E75}.posdef-pb.primary:hover:not(:disabled){background:rgba(29,158,117,.28)}.posdef-pb:disabled{opacity:.3;cursor:not-allowed}
      #posdef-hint{position:absolute;bottom:55px;left:50%;transform:translateX(-50%);background:rgba(6,7,9,.94);border:1px solid rgba(29,158,117,.45);color:#1D9E75;font-size:11px;letter-spacing:.08em;padding:8px 22px;border-radius:3px;pointer-events:none;z-index:1098;text-transform:uppercase;display:none}
      @media(max-width:720px){#posdef-left-panel{left:10px;top:72px;width:calc(100vw - 20px);max-height:44vh}#posdef-right-panel{left:10px;right:auto;top:calc(44vh + 84px);width:calc(100vw - 20px);max-height:calc(56vh - 94px)}}
    `;
    document.head.appendChild(style);
  }
}

export default PosDefScorerEngine;

