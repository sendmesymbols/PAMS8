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
  weights: Record<FactorId, number>;
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
  autoDir?: boolean; // true = auto terrain estimate (no user waypoint)
  autoDirBrg?: number; // compass bearing of auto-direction line
  /** Set when a real road route to the egress point was found. */
  viaRoad?: boolean;
  roadKm?: number;
  roadMin?: number;
  roadRating?: 'GO' | 'SLOW-GO' | 'NO-GO';
}

interface ScoreResult {
  scores: ScoreMap;
  composite: number;
  horizons: Float32Array;
  egrResults: EgressResult[];
  sampler: any;
  extent: Extent;
  numRays: number;
  egrAutoAnalyzed: boolean;
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
  weights?: Partial<Record<FactorId, number>>;
}

const FACTORS: FactorDef[] = [
  {
    id: 'obs',
    label: 'Observation arc',
    icon: 'OBS',
    color: '#1D9E75',
    desc: (s) => s >= 15 ? 'Wide arcs — early warning across most approach routes' :
                 s >= 10 ? 'Adequate — most threat approaches visible' :
                 s >= 6  ? 'Restricted — significant dead angles; post sentries' :
                           'Severe blind arcs — position vulnerable to unseen approach',
  },
  {
    id: 'fof',
    label: 'Fields of fire',
    icon: 'FOF',
    color: '#378ADD',
    desc: (s) => s >= 15 ? 'Open fire lanes — can engage across threat sector at range' :
                 s >= 10 ? 'Adequate direct fire into threat sector' :
                 s >= 6  ? 'Restricted — terrain forces close-range or channelled engagement' :
                           'Cannot effectively engage the threat axis — reposition or clear obstacles',
  },
  {
    id: 'cff',
    label: 'Cover from fire',
    icon: 'CFF',
    color: '#EF9F27',
    desc: (s) => s >= 15 ? 'Strong defilade — terrain masks position from direct fire' :
                 s >= 10 ? 'Partial defilade — some fire approaches on the threat axis' :
                 s >= 6  ? 'Exposed on key threat axes — dig in or use additional cover' :
                           'No terrain masking from enemy fire — position must be hardened',
  },
  {
    id: 'cfv',
    label: 'Cover from view',
    icon: 'CFV',
    color: '#B428DC',
    desc: (s) => s >= 15 ? 'Well concealed — hard to locate from surrounding terrain' :
                 s >= 10 ? 'Partially concealed — use camouflage and noise discipline' :
                 s >= 6  ? 'Largely observable — assume enemy can see this position' :
                           'Fully exposed — enemy observation from multiple angles is certain',
  },
  {
    id: 'egr',
    label: 'Egress routes',
    icon: 'EGR',
    color: '#78C840',
    desc: (s) => s >= 15 ? 'Multiple open/masked withdrawal routes available' :
                 s >= 10 ? 'At least one viable withdrawal route' :
                 s >= 6  ? 'Limited egress — withdrawal under fire will be difficult' :
                           'Position risks becoming a trap — plan alternate break-out routes',
  },
  {
    id: 'dg',
    label: 'Dead ground behind',
    icon: 'DG',
    color: '#DC3C30',
    desc: (s) => s >= 15 ? 'Extensive dead ground — secure FUP and covered friendly approach' :
                 s >= 10 ? 'Useful dead ground for tactical movement to/from position' :
                 s >= 6  ? 'Shallow dead ground — limited covered movement rearward' :
                           'Exposed rear — reinforcement and resupply routes are under observation',
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

const DEFAULT_WEIGHTS: Record<FactorId, number> = {
  obs: 4,
  fof: 4,
  cff: 3,
  cfv: 3,
  egr: 3,
  dg: 3,
};

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
  /**
   * The most recent scored position, for consumers that want the numbers
   * after the fact rather than at call time — the briefing's chart insert
   * (see AnalysisCharts.posDefRadarSpec) is the first of them.
   */
  private _lastSummary: DefensibilitySummary | null = null;
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
  private _draggableBound: WeakSet<HTMLElement> = new WeakSet();
  private _egrAutoAnalyzed = true;

  constructor() {
    this._createLayers();
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

  /** The most recently scored position, or null if nothing has been scored yet. */
  public get lastSummary(): DefensibilitySummary | null {
    return this._lastSummary;
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
      weights: { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) },
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
      this._scorePanelEl.className = 'ms-panel ms-theme-ops-dark';
      this._scorePanelEl.style.cssText = 'position: absolute; top: 14px; left: 14px; width: 440px; z-index: 1098; max-height: calc(100vh - 28px); display: none; flex-direction: column;';
      this._scorePanelEl.innerHTML = this._scorePanelHtml();
      document.body.appendChild(this._scorePanelEl);
    }
    if (!this._controlPanelEl) {
      this._controlPanelEl = document.createElement('div');
      this._controlPanelEl.id = 'posdef-right-panel';
      this._controlPanelEl.className = 'ms-panel ms-theme-ops-dark';
      this._controlPanelEl.style.cssText = 'position: absolute; top: 14px; right: 14px; width: 312px; z-index: 1098; max-height: calc(100vh - 28px); overflow-y: auto; overflow-x: hidden; display: none;';
      this._controlPanelEl.innerHTML = this._controlPanelHtml();
      document.body.appendChild(this._controlPanelEl);
      this._bindPanelEvents();
    }
    if (!this._hintEl) {
      this._hintEl = document.createElement('div');
      this._hintEl.id = 'posdef-hint';
      this._hintEl.style.cssText = 'position: absolute; bottom: 55px; left: 50%; transform: translateX(-50%); z-index: 1098; display: none; font-family: monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px 22px; border-radius: 6px; pointer-events: none; background: rgba(20, 24, 32, 0.94); color: var(--ms-text, #dce8f5); border: 1px solid var(--ms-border, rgba(90, 130, 200, 0.35)); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45); backdrop-filter: blur(10px);';
      this._hintEl.textContent = 'Click map to score a position - Ctrl+Click to add egress waypoints';
      document.body.appendChild(this._hintEl);
    }
    this._makePanelDraggable(this._scorePanelEl);
    this._makePanelDraggable(this._controlPanelEl);
    this._drawRadar({ obs: 0, fof: 0, cff: 0, cfv: 0, egr: 0, dg: 0 });
  }

  private _makePanelDraggable(panel: HTMLDivElement | null): void {
    if (!panel) return;
    const handle = panel.querySelector('.ms-header') as HTMLElement | null;
    if (!handle || this._draggableBound.has(panel)) return;
    this._draggableBound.add(panel);
    handle.style.cursor = 'grab';
    handle.style.userSelect = 'none';
    let ox = 0;
    let oy = 0;

    // The document-level handlers live only for the duration of a drag — the
    // same pattern the other analysis engines use. Registering them once and
    // leaving them there ran a handler on every mousemove for the life of the
    // page, and pinned `panel` in their closures so it could never be collected.
    const onMove = (e: MouseEvent) => {
      const maxLeft = window.innerWidth - panel.offsetWidth - 4;
      const maxTop = window.innerHeight - panel.offsetHeight - 4;
      panel.style.left = Math.max(0, Math.min(e.clientX - ox, maxLeft)) + 'px';
      panel.style.top = Math.max(0, Math.min(e.clientY - oy, maxTop)) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.style.cursor = 'grab';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, select')) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      handle.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  private _scorePanelHtml(): string {
    return `
      <div class="ms-header">
        <div class="ms-header-title">Pos Def Scorer</div>
      </div>
      <div class="ms-body" style="display: flex; flex-direction: column; overflow-y: auto;">
        <div style="padding: 14px 16px; border-bottom: var(--ms-divider); font-size: 14px; letter-spacing: 0.03em; color: var(--ms-text-dim);" id="posdef-lph-sub">Click map to score a position</div>
        <div style="display: flex; align-items: center; justify-content: center; gap: 22px; padding: 20px 18px; border-bottom: var(--ms-divider); flex-shrink: 0;">
          <div style="position: relative; width: 140px; height: 140px; flex-shrink: 0;" id="posdef-score-ring">
            <svg id="posdef-score-svg" width="140" height="140" viewBox="0 0 90 90" style="display: block;">
              <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="7"></circle>
              <circle id="posdef-score-arc" cx="45" cy="45" r="38" fill="none" stroke="var(--ms-accent)" stroke-width="7" stroke-dasharray="0 239" stroke-dashoffset="60" stroke-linecap="round" transform="rotate(-90 45 45)"></circle>
            </svg>
            <div id="posdef-score-num" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 46px; font-weight: 800; color: var(--ms-accent); text-align: center; line-height: 1;">-</div>
          </div>
          <div style="flex: 1;">
            <div id="posdef-score-grade" style="font-size: 28px; font-weight: 800; color: var(--ms-accent); margin-bottom: 8px; line-height: 1.1;">-</div>
            <div id="posdef-score-desc" style="font-size: 14px; color: var(--ms-text-dim); line-height: 1.55;">Place a position<br>on the map to score it</div>
          </div>
        </div>
        <div style="padding: 12px; border-bottom: var(--ms-divider); flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><canvas id="posdef-radar-canvas" width="412" height="280" style="display: block;"></canvas></div>
        <div id="posdef-factors" style="overflow-y: auto; flex: 1; padding: 16px 18px;">
          <div id="posdef-factor-empty" style="padding: 22px 12px; font-size: 14px; color: var(--ms-text-dim); text-align: center; line-height: 1.9;">Scores for each factor will<br>appear here after analysis.<br><br>Each factor is scored 0-20.<br>Total composite score: 0-100.</div>
        </div>
        <div id="posdef-pos-history" style="display: none; border-top: var(--ms-divider); flex-shrink: 0; max-height: 130px; overflow-y: auto;">
          <div style="font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ms-text-dim); padding: 6px 10px 3px;">Previous positions</div>
          <div id="posdef-ph-rows"></div>
        </div>
      </div>
    `;
  }

  private _controlPanelHtml(): string {
    return `
      <div class="ms-header">
        <div class="ms-header-title">Pos Def Scorer</div>
        <div style="display: flex; gap: 4px;">
          <button class="ms-btn" id="posdef-help-btn" title="Position defensibility wiki" style="padding: 4px 8px; font-size: var(--ms-fs-xs);">?</button>
          <button class="ms-btn" id="posdef-close-btn" title="Close" style="padding: 4px 8px; font-size: var(--ms-fs-xs);">✕</button>
        </div>
      </div>
      <div class="ms-help-popover" id="posdef-help-popover" hidden style="position: absolute; top: 37px; left: 8px; right: 8px; z-index: 1120; max-height: min(440px, calc(100vh - 132px));">
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Wiki</div>
            <div class="ms-help-title">Position Defensibility Scorer</div>
          </div>
          <button id="posdef-help-close" class="ms-help-close">✕</button>
        </div>
        <div class="ms-help-body">
          <p>Scores a fighting position from terrain-derived observation, fields of fire, cover, concealment, egress, and rear dead ground.</p>
          <div style="margin-top: 10px;"><h4 style="margin: 0 0 5px; font-size: var(--ms-fs-xs); letter-spacing: 0.08em; text-transform: uppercase;">Workflow</h4><ol style="margin: 0; padding-left: 17px;"><li style="margin: 3px 0;">Open from More Actions or right-click a symbol.</li><li style="margin: 3px 0;">Click the map to score a position.</li><li style="margin: 3px 0;">Ctrl+Click or use + Egress to add withdrawal routes.</li><li style="margin: 3px 0;">Adjust ranges, weights, and overlays, then Re-score.</li></ol></div>
          <div style="margin-top: 10px;"><h4 style="margin: 0 0 5px; font-size: var(--ms-fs-xs); letter-spacing: 0.08em; text-transform: uppercase;">Factors</h4><dl style="display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 5px 8px; margin: 0;"><dt style="color: var(--ms-accent); font-weight: 700;">Observation</dt><dd style="margin: 0;">Visible ray coverage across the selected radius.</dd><dt style="color: var(--ms-accent); font-weight: 700;">Fields of fire</dt><dd style="margin: 0;">Visible arcs inside the configured threat sector.</dd><dt style="color: var(--ms-accent); font-weight: 700;">Cover</dt><dd style="margin: 0;">Nearby terrain masking from fire and view.</dd><dt style="color: var(--ms-accent); font-weight: 700;">Egress</dt><dd style="margin: 0;">Clear or masked routes away from the position.</dd><dt style="color: var(--ms-accent); font-weight: 700;">Dead ground</dt><dd style="margin: 0;">Rear terrain below line of sight for movement and FUP.</dd></dl></div>
        </div>
      </div>
      <div class="ms-body" style="display: flex; flex-direction: column; overflow-y: auto;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px;">
          <div style="font-size: var(--ms-fs-xs); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ms-text-dim);" id="posdef-status">Click map to score</div>
        </div>
        <div class="ms-section-title">Observer / position</div>
        <div class="ms-grid">
          <div class="ms-field"><label class="ms-label">Eye height (m)</label><input id="posdef-inp-eye" type="number" value="1.8" min="0.5" max="10" step="0.1" class="ms-input"></div>
          <div class="ms-field"><label class="ms-label">Position type</label><select id="posdef-inp-postype" class="ms-select"><option value="dismount">Dismount</option><option value="vehicle">Vehicle</option><option value="tank">Tank</option><option value="mg">MG/ATGM</option><option value="sniper" selected>Sniper</option></select></div>
        </div>
        <div class="ms-section-title">Analysis ranges</div>
        ${this._sliderRow('Observation radius (m)', 'obs-r', 500, 10000, 250, 3000)}
        ${this._sliderRow('Slope check radius (m)', 'slp-r', 50, 500, 25, 150)}
        ${this._sliderRow('Ray resolution (deg)', 'ray-res', 2, 15, 1, 5, 'deg')}
        <div class="ms-section-title">Egress routes (optional)</div>
        <div id="posdef-egress-list" style="padding: 0 12px 8px;"><div id="posdef-eg-add-hint" style="font-size: var(--ms-fs-xs); color: var(--ms-text-dim); padding: 4px 0; letter-spacing: 0.04em;">Ctrl+Click map to add an egress waypoint</div></div>
        <div class="ms-section-title">Scoring context</div>
        <div class="ms-grid">
          <div class="ms-field" style="grid-column: 1/-1;"><label class="ms-label">Threat axis (bearing deg)</label><input id="posdef-inp-threat-brg" type="number" value="270" min="0" max="359" step="1" class="ms-input"></div>
        </div>
        ${this._sliderRow('Slope acceptable (deg)', 'slp-ok', 5, 30, 1, 12, 'deg')}
        <div class="ms-divider" style="margin: 4px 0;"></div>
        <div class="ms-section-title">Factor weights (0-5)</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; padding: 0 12px 8px;">
          ${this._weightRow('Observation', 'obs', 4)}${this._weightRow('Fields of fire', 'fof', 4)}${this._weightRow('Cover from fire', 'cff', 3)}${this._weightRow('Cover from view', 'cfv', 3)}${this._weightRow('Egress routes', 'egr', 3)}${this._weightRow('Dead ground', 'dg', 3)}
        </div>
        <div class="ms-divider" style="margin: 4px 0;"></div>
        <div class="ms-section-title">Overlays</div>
        ${this._toggleRow('Viewshed overlay', 'vs', true)}${this._toggleRow('Dead ground overlay', 'dg', true)}${this._toggleRow('Slope overlay', 'slp', true)}${this._toggleRow('LOS spokes', 'los', true)}${this._toggleRow('Egress LOS lines', 'egr', true)}
        <div class="ms-divider" style="margin: 4px 0;"></div>
        <div style="padding: 0 12px 9px;"><div id="posdef-prog-track" style="height: 4px; background: var(--ms-bg-subtle); border-radius: 2px; overflow: hidden;"><div id="posdef-prog-fill" style="height: 100%; background: linear-gradient(to right, var(--ms-accent), #378ADD); border-radius: 2px; width: 0%; transition: width 0.12s;"></div></div><div id="posdef-prog-label" style="font-size: var(--ms-fs-xs); color: var(--ms-text-dim); letter-spacing: 0.05em; margin-top: 4px;">-</div></div>
        <div style="display: flex; gap: 6px; padding: 9px 12px;">
          <button class="ms-btn" id="posdef-btn-clear" style="flex: 1;">Clear</button>
          <button class="ms-btn" id="posdef-btn-egress-mode" style="flex: 1;">+ Egress</button>
          <button class="ms-btn ms-btn-primary" id="posdef-btn-rescore" style="flex: 1;" disabled>Re-score</button>
        </div>
      </div>
    `;
  }

  private _sliderRow(label: string, id: string, min: number, max: number, step: number, value: number, suffix = ''): string {
    return `<div style="display: flex; align-items: center; gap: 8px; padding: 0 12px 8px;"><label style="font-size: var(--ms-fs-xs); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ms-text-dim); flex: 1.8;" class="ms-label">${label}</label><input id="posdef-inp-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="flex: 2; accent-color: var(--ms-accent); cursor: pointer;"><div id="posdef-${id}-v" style="font-size: var(--ms-fs-xs); color: var(--ms-accent); min-width: 38px; text-align: right;">${value}${suffix}</div></div>`;
  }

  private _weightRow(label: string, id: FactorId, value: number): string {
    return `<div style="display: flex; flex-direction: column; gap: 3px;"><div style="font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ms-text-dim);">${label}</div><div style="display: flex; align-items: center; gap: 4px;"><input type="range" id="posdef-wt-${id}" min="0" max="5" step="1" value="${value}" style="flex: 1; accent-color: var(--ms-accent);"><div id="posdef-wv-${id}" style="font-size: var(--ms-fs-xs); color: var(--ms-accent); min-width: 18px; text-align: right;">${value}</div></div></div>`;
  }

  private _toggleRow(label: string, id: string, checked: boolean): string {
    return `<div style="display: flex; align-items: center; justify-content: space-between; padding: 5px 12px;"><label style="font-size: var(--ms-fs-xs); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ms-text-dim); cursor: pointer;" class="ms-label">${label}</label><input id="posdef-opt-${id}" type="checkbox"${checked ? ' checked' : ''} style="accent-color: var(--ms-accent); width: 13px; height: 13px; cursor: pointer;"></div>`;
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
      weights: this._weights(),
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
      if (params.showVS || params.showDG || params.showSlp) await this._drawRasterOverlay(result, pt, obsZ, params);
      if (params.showLOS) this._buildLOSSpokes(pt, obsZ, result.numRays, params.obsRadius, result.sampler, result.horizons).forEach((g) => this._spokesLayer.add(g));
      if (this._egressPts.length > 0) {
        this._setProgress(0.82, 'Routing egress on road network');
        await this._enrichEgressWithRoads(pt, result);
      }
      if (params.showEgr) this._drawEgressLines(pt, result.egrResults);

      this._egrAutoAnalyzed = result.egrAutoAnalyzed;
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
    const { obsRadius, slopeRadius, rayRes, threatBrg, slopeOkDeg } = params;
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
    // Reused scratch Point — getZ is synchronous, so one shared point is safe.
    const zPt = new Point({ longitude: 0, latitude: 0, spatialReference: WGS84 });
    const getZ = (lon: number, lat: number): number => {
      try {
        zPt.longitude = lon;
        zPt.latitude = lat;
        const result = sampler.queryElevation(zPt);
        return Number.isFinite(result?.z) ? result.z : 0;
      } catch {
        return 0;
      }
    };
    const step = Math.max(20, obsRadius / 60);
    // Minimum 24 rays (15° per ray) — below this terrain analysis loses tactical meaning.
    const numRays = Math.max(24, Math.round(360 / rayRes));
    const horizons = new Float32Array(numRays);

    // Reusable LOS helper: is a target visible from positionPt/obsZ?
    const isTargetVisible = (brg: number, targetDist: number, targetSlope: number): boolean => {
      let maxInterveningSlope = -90;
      for (let d = step; d < targetDist - step * 0.5; d += step) {
        const p = destPt(positionPt.longitude, positionPt.latitude, brg, d);
        maxInterveningSlope = Math.max(
          maxInterveningSlope,
          Math.atan2(getZ(p.longitude, p.latitude) - obsZ, d) * 180 / Math.PI,
        );
      }
      return targetSlope >= maxInterveningSlope;
    };

    // Horizon array — maximum blocking elevation angle per ray over full obsRadius.
    for (let ri = 0; ri < numRays; ri++) {
      const brg = (ri / numRays) * 360;
      let maxSlp = -90;
      for (let d = step; d <= obsRadius; d += step) {
        const p = destPt(positionPt.longitude, positionPt.latitude, brg, d);
        maxSlp = Math.max(maxSlp, Math.atan2(getZ(p.longitude, p.latitude) - obsZ, d) * 180 / Math.PI);
      }
      horizons[ri] = maxSlp;
    }
    await this._tick();

    // ── OBS: fraction of rays with unobstructed LOS to 90% of radius ──────────
    let visRays = 0;
    for (let ri = 0; ri < numRays; ri++) {
      const brg = (ri / numRays) * 360;
      const targetDist = obsRadius * 0.9;
      const p = destPt(positionPt.longitude, positionPt.latitude, brg, targetDist);
      const slp = Math.atan2(getZ(p.longitude, p.latitude) - obsZ, targetDist) * 180 / Math.PI;
      if (isTargetVisible(brg, targetDist, slp)) visRays++;
    }
    const obsScore = Math.round(Math.min(20, (visRays / numRays) * 20));

    // ── FOF: visible rays within threat sector (±90° of threat bearing) ────────
    let fofVis = 0;
    let fofTotal = 0;
    for (let ri = 0; ri < numRays; ri++) {
      const brg = (ri / numRays) * 360;
      const delta = Math.abs(((brg - threatBrg + 540) % 360) - 180);
      if (delta > 90) continue;
      fofTotal++;
      const targetDist = obsRadius * 0.85;
      const p = destPt(positionPt.longitude, positionPt.latitude, brg, targetDist);
      const slp = Math.atan2(getZ(p.longitude, p.latitude) - obsZ, targetDist) * 180 / Math.PI;
      if (isTargetVisible(brg, targetDist, slp)) fofVis++;
    }
    const fofScore = fofTotal > 0 ? Math.round(Math.min(20, (fofVis / fofTotal) * 20)) : 10;
    await this._tick();

    // ── CFF: cover from enemy direct fire ─────────────────────────────────────
    // Cast from enemy positions along the threat axis at direct fire ranges and
    // check whether intervening terrain masks our position from each enemy LOS.
    // A high score means the position is in defilade from the threat direction.
    const cffRanges = [400, 800, 1200, 1800].filter((r) => r <= obsRadius * 0.95);
    const cffSpreads = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
    let cffBlocked = 0;
    let cffChecked = 0;
    for (const range of cffRanges) {
      for (const spread of cffSpreads) {
        const enemyBrg = (threatBrg + spread + 360) % 360;
        const enemyPt = destPt(positionPt.longitude, positionPt.latitude, enemyBrg, range);
        const enemyZ = getZ(enemyPt.longitude, enemyPt.latitude) + 1.8;
        const dist = geoDist(positionPt.longitude, positionPt.latitude, enemyPt.longitude, enemyPt.latitude);
        const reverseBrg = (enemyBrg + 180) % 360;
        // Angle from enemy to our position
        const posSlope = Math.atan2(obsZ - enemyZ, dist) * 180 / Math.PI;
        // Check intervening terrain between enemy and our position
        let maxInterveningTerrain = -90;
        for (let d = step; d < dist * 0.92; d += step) {
          const ip = destPt(enemyPt.longitude, enemyPt.latitude, reverseBrg, d);
          maxInterveningTerrain = Math.max(
            maxInterveningTerrain,
            Math.atan2(getZ(ip.longitude, ip.latitude) - enemyZ, d) * 180 / Math.PI,
          );
        }
        cffChecked++;
        if (maxInterveningTerrain > posSlope) cffBlocked++;
      }
    }
    // If threat ranges all exceeded obsRadius (tiny obsRadius setting) fall back gracefully.
    const cffScore = cffChecked > 0 ? Math.round(Math.min(20, (cffBlocked / cffChecked) * 20)) : 0;
    await this._tick();

    // ── CFV: cover from enemy observation ─────────────────────────────────────
    // 24 notional observers at 90% of obsRadius; count how many cannot see us.
    let cfvBlocked = 0;
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
      if (reverseSlp < maxReverseSlp) cfvBlocked++;
    }
    const cfvScore = Math.round(Math.min(20, (cfvBlocked / 24) * 20));
    await this._tick();

    // ── EGR: egress routes ─────────────────────────────────────────────────────
    let egrScore = 0;
    const egrResults: EgressResult[] = [];
    let egrAutoAnalyzed = true;

    if (this._egressPts.length > 0) {
      // User-defined waypoint analysis — precise and directional.
      egrAutoAnalyzed = false;
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
        const masked = midSlp < horizons[Math.round(egrBrg * numRays / 360) % numRays] * 0.7;
        egrResults.push({ pt: ept, clear, masked, dist: Math.round(dist) });
        if (clear) clearEgr++;
      }
      const maskedCount = egrResults.filter((r) => r.masked).length;
      egrScore = Math.round(Math.min(20, (clearEgr / this._egressPts.length) * 12 + (maskedCount / this._egressPts.length) * 8));
    } else {
      // Auto terrain analysis: probe 8 cardinal/intercardinal bearings.
      // Scores terrain traversability and masking — not a route plan, but a
      // terrain-based estimate of withdrawal options in each direction.
      const autoEgrDirs = [0, 45, 90, 135, 180, 225, 270, 315];
      const egrCheckDist = Math.min(1200, obsRadius * 0.4);
      let clearCount = 0;
      let maskedAndClearCount = 0;

      for (const dir of autoEgrDirs) {
        const ept = destPt(positionPt.longitude, positionPt.latitude, dir, egrCheckDist);
        // Slope traversability: reject directions exceeding acceptable slope.
        let maxRouteSlopeDeg = 0;
        for (let d = step; d < egrCheckDist * 0.95; d += step) {
          const p1 = destPt(positionPt.longitude, positionPt.latitude, dir, d);
          const p2 = destPt(positionPt.longitude, positionPt.latitude, dir, Math.min(d + step, egrCheckDist));
          const dz = Math.abs(getZ(p2.longitude, p2.latitude) - getZ(p1.longitude, p1.latitude));
          maxRouteSlopeDeg = Math.max(maxRouteSlopeDeg, Math.atan2(dz, step) * 180 / Math.PI);
        }
        const clear = maxRouteSlopeDeg <= slopeOkDeg;
        // Masking: is the midpoint of this route below the blocking horizon?
        const midPt = destPt(positionPt.longitude, positionPt.latitude, dir, egrCheckDist * 0.5);
        const midSlp = Math.atan2(getZ(midPt.longitude, midPt.latitude) - obsZ, egrCheckDist * 0.5) * 180 / Math.PI;
        const riIdx = Math.round(dir * numRays / 360) % numRays;
        const masked = midSlp < horizons[riIdx] * 0.7;
        const eptPoint = new Point({ longitude: ept.longitude, latitude: ept.latitude, spatialReference: WGS84 });
        egrResults.push({ pt: eptPoint, clear, masked, dist: Math.round(egrCheckDist), autoDir: true, autoDirBrg: dir });
        if (clear) clearCount++;
        if (clear && masked) maskedAndClearCount++;
      }
      // Max raw: 8 clear × 1.5 + 8 masked × 1.0 = 20 → maps directly to 0-20.
      egrScore = Math.round(Math.min(20, clearCount * 1.5 + maskedAndClearCount * 1.0));
    }
    await this._tick();

    // ── DG: dead ground behind position — enemy LOS extended rearward ─────────
    // For each rear-arc ray, place a notional enemy at the opposite (threat) side
    // and compute where that enemy's LOS line passes through our position and
    // extends into the rear terrain. Any ground below that projected LOS height
    // is dead ground — concealed from the enemy and usable for FUP / withdrawal.
    const rearBrg = (threatBrg + 180) % 360;
    // Use a conservative engagement range: enemy at 1.5 km or half the obs radius.
    const enemyEngageRange = Math.min(1500, obsRadius * 0.5);
    let dgCount = 0;
    let dgTotal = 0;
    const maxDGDist = Math.min(slopeRadius * 4, obsRadius * 0.3);

    for (let ri = 0; ri < numRays; ri++) {
      const brg = (ri / numRays) * 360;
      const angleDelta = Math.abs(((brg - rearBrg + 540) % 360) - 180);
      if (angleDelta > 60) continue; // examine only the rear 120° arc

      // Enemy is in the threat direction, opposite to this rear ray.
      const enemyDirBrg = (brg + 180) % 360;
      const enemyPt = destPt(positionPt.longitude, positionPt.latitude, enemyDirBrg, enemyEngageRange);
      const enemyZ = getZ(enemyPt.longitude, enemyPt.latitude) + 1.8;

      // Angle of enemy's LOS arriving at our position.
      const angleToPos = Math.atan2(obsZ - enemyZ, enemyEngageRange);

      // Walk rearward: is each point below the enemy's extended LOS?
      for (let d = step; d <= maxDGDist; d += step) {
        const p = destPt(positionPt.longitude, positionPt.latitude, brg, d);
        const z = getZ(p.longitude, p.latitude);
        // LOS height at total distance (enemyEngageRange + d) from the enemy.
        const losHeight = enemyZ + (enemyEngageRange + d) * Math.tan(angleToPos);
        dgTotal++;
        if (z < losHeight) dgCount++;
      }
    }
    // Score = fraction of rear-arc terrain that is in dead ground (0-100% → 0-20).
    const dgScore = Math.round(Math.min(20, (dgCount / Math.max(1, dgTotal)) * 20));

    const scores: ScoreMap = { obs: obsScore, fof: fofScore, cff: cffScore, cfv: cfvScore, egr: egrScore, dg: dgScore };
    const composite = this._computeComposite(scores, params.weights);
    // Cached here rather than in scorePoint() because this is the one place
    // BOTH paths — the interactive map-click and the headless scorePoint() —
    // pass through, so `lastSummary` is whatever was actually scored last.
    const grade = getGrade(composite);
    this._lastSummary = {
      point: positionPt,
      scores,
      composite,
      grade: grade.grade,
      label: grade.label,
    };
    return { scores, composite, horizons, egrResults, sampler, extent, numRays, egrAutoAnalyzed };
  }

  private async _drawRasterOverlay(result: ScoreResult, positionPt: Point, obsZ: number, params: ScoreParams): Promise<void> {
    if (!this._view) return;
    const canvas = await this._buildViewshedCanvas(result.numRays, positionPt, obsZ, result.extent, params.obsRadius, 0.8, result.horizons);
    const ml = new MediaLayer({
      source: [new ImageElement({ image: canvas.toDataURL('image/png'), georeference: new ExtentAndRotationGeoreference({ extent: result.extent }) })],
      title: 'Position Defensibility - Viewshed / Dead Ground',
    });
    (this._view.map as any).add(ml, 0);
    this._mediaLayers.push(ml);
  }

  private async _buildViewshedCanvas(numRays: number, positionPt: Point, obsZ: number, extent: Extent, obsRadius: number, opacity: number, horizons: Float32Array): Promise<HTMLCanvasElement> {
    const cols = Math.round(obsRadius * 2 / 40);
    const rows = Math.round(obsRadius * 2 / 40);
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const cosLat = Math.cos(positionPt.latitude * Math.PI / 180);
    // Re-create a lightweight sampler for canvas pixel queries only.
    let sampler: any = null;
    try { sampler = await (this._view!.map as any).ground.createElevationSampler(extent); } catch { /* no elevation */ }
    const getZ = (lon: number, lat: number): number => {
      try { const r = sampler?.queryElevation(new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 })); return Number.isFinite(r?.z) ? r.z : 0; } catch { return 0; }
    };
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    const aVis = Math.round(0.35 * opacity * 255);
    const aHid = Math.round(0.25 * opacity * 255);
    for (let r = 0; r < rows; r++) {
      // Yield every 20 rows so the browser can repaint between chunks.
      if (r % 20 === 0) await this._tick();
      for (let c = 0; c < cols; c++) {
        const lon = extent.xmin + (c + 0.5) * dLon;
        const lat = extent.ymax - (r + 0.5) * dLat;
        const east = (lon - positionPt.longitude) * M_PER_DEG * cosLat;
        const north = (lat - positionPt.latitude) * M_PER_DEG;
        const dist = Math.sqrt(east * east + north * north);
        if (dist < 5 || dist > obsRadius) continue;
        const brg = ((Math.atan2(east, north) * 180 / Math.PI) + 360) % 360;
        const ri = Math.round(brg * numRays / 360) % numRays;
        const z = getZ(lon, lat);
        const slp = Math.atan2(z - obsZ, dist) * 180 / Math.PI;
        // Visibility test using precomputed per-ray horizon — O(1) per pixel.
        // A pixel is visible when its elevation angle exceeds the max blocking
        // angle of all terrain samples along that ray to obsRadius.
        const visible = slp > horizons[ri];
        const px = (r * cols + c) * 4;
        if (visible) {
          img.data[px] = 29; img.data[px + 1] = 158; img.data[px + 2] = 117; img.data[px + 3] = aVis;
        } else {
          img.data[px] = 80; img.data[px + 1] = 20; img.data[px + 2] = 20; img.data[px + 3] = aHid;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private _buildLOSSpokes(positionPt: Point, obsZ: number, numRays: number, obsRadius: number, sampler: any, horizons: Float32Array): Graphic[] {
    const graphics: Graphic[] = [];
    for (let ri = 0; ri < numRays; ri += 3) {
      const brg = (ri / numRays) * 360;
      const p = destPt(positionPt.longitude, positionPt.latitude, brg, obsRadius);
      const z = (sampler.queryElevation(new Point({ longitude: p.longitude, latitude: p.latitude, spatialReference: WGS84 }))?.z ?? 0);
      // Visibility from precomputed horizon — endpoint slope vs max blocking slope on this ray.
      const endSlope = Math.atan2(z - obsZ, obsRadius) * 180 / Math.PI;
      const visible = endSlope >= horizons[ri];
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

  /** Lazily reach the shared (optional) road-network adapter — may be absent. */
  private _roadNet(): any {
    return (window as any).symbolEngine?.roadNetworkEngine ?? null;
  }

  /**
   * Opportunistically score the egress factor on real road-following routes
   * from the position to each egress waypoint: a drivable withdrawal route is
   * strong evidence the position can be vacated under power. Folds in as the
   * better of the terrain-LOS egress score and the road-egress score, so road
   * data never *lowers* the score — it only reveals viable routes the
   * line-of-sight check can't see.
   *
   * Fully degradable: a missing/down service is a no-op; per-leg failures are
   * skipped. Never throws.
   */
  private async _enrichEgressWithRoads(pt: Point, result: ScoreResult): Promise<void> {
    const rn = this._roadNet();
    if (!rn || this._egressPts.length === 0) return;
    let available = false;
    try {
      available = await rn.ensureAvailable();
    } catch {
      available = false;
    }
    if (!available) return;

    let any = false;
    let sumScore = 0;
    for (const er of result.egrResults) {
      let res: any = null;
      try {
        res = await rn.route(pt, er.pt);
      } catch {
        res = { ok: false };
      }
      if (!res?.ok || !res.data) continue;
      any = true;
      er.viaRoad = true;
      er.roadKm = res.data.distanceKm ?? 0;
      er.roadMin = res.data.travelTimeMin ?? 0;
      const rating: 'GO' | 'SLOW-GO' | 'NO-GO' = res.data.trafficability?.rating ?? 'GO';
      er.roadRating = rating;
      sumScore += rating === 'GO' ? 20 : rating === 'SLOW-GO' ? 14 : 7;
    }
    if (!any) return;

    const successCount = result.egrResults.filter(er => er.viaRoad).length;
    const roadEgr = Math.round(sumScore / Math.max(1, successCount));
    result.scores.egr = Math.max(result.scores.egr, Math.min(20, roadEgr));
    result.composite = this._computeComposite(result.scores);
    EngineLogger.success(ENGINE_NAME, 'Defensibility: egress scored on real road routes.');
  }

  private _drawEgressLines(pt: Point, results: EgressResult[]): void {
    const compassLabel = (brg: number) => {
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return dirs[Math.round(brg / 45) % 8];
    };
    results.forEach((er) => {
      if (er.autoDir) {
        // Terrain-estimate lines: thin, low-opacity, dotted — not a planned route.
        const color = er.clear ? (er.masked ? [78, 200, 64, 90] : [29, 158, 117, 70]) : [180, 60, 40, 55];
        this._egrLayer.add(new Graphic({
          geometry: new Polyline({ paths: [[[pt.longitude, pt.latitude], [er.pt.longitude, er.pt.latitude]]], spatialReference: WGS84 }),
          symbol: { type: 'simple-line', color, width: 1, style: 'short-dot' } as any,
          attributes: { type: 'Egress LOS', label: `Terrain est. ${compassLabel(er.autoDirBrg ?? 0)}: ${er.clear ? 'passable' : 'blocked'}${er.masked ? ' (masked)' : ''}` },
        }));
      } else {
        const color = er.clear ? (er.masked ? [78, 200, 64] : [29, 158, 117]) : [220, 60, 48];
        const roadTxt = er.viaRoad
          ? ` — road ${(er.roadKm ?? 0).toFixed(1)}km / ${Math.round(er.roadMin ?? 0)}min ${er.roadRating}`
          : '';
        this._egrLayer.add(new Graphic({
          geometry: new Polyline({ paths: [[[pt.longitude, pt.latitude], [er.pt.longitude, er.pt.latitude]]], spatialReference: WGS84 }),
          symbol: { type: 'simple-line', color: [...color, 180], width: 2, style: er.masked ? 'solid' : 'short-dash' } as any,
          attributes: { type: 'Egress LOS', label: `${er.clear ? 'Clear' : 'Blocked'} — ${er.dist}m${er.masked ? ' (masked)' : ''}${roadTxt}` },
        }));
      }
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
        const isEgrAuto = f.id === 'egr' && this._egrAutoAnalyzed;
        const badge = isEgrAuto
          ? `<span style="font-size:9px;letter-spacing:0.07em;text-transform:uppercase;color:#EF9F27;background:rgba(239,159,39,0.1);border:1px solid rgba(239,159,39,0.3);border-radius:3px;padding:1px 5px;vertical-align:middle;margin-left:5px;">terrain est.</span>`
          : '';
        const row = document.createElement('div');
        row.style.cssText = 'display: grid; grid-template-columns: 40px 1fr 56px; align-items: center; gap: 12px; margin-bottom: 14px;';
        row.innerHTML = `<div style="font-size: 18px; text-align: center; color: var(--ms-text-dim);">${f.icon}</div><div style="display: flex; flex-direction: column; gap: 5px;"><div style="font-size: 15px; font-weight: 600; color: var(--ms-text);">${f.label}${badge}</div><div style="height: 6px; background: var(--ms-bg-subtle); border-radius: 3px;"><div style="height: 100%; border-radius: 3px; transition: width 0.6s; width: ${s / 20 * 100}%; background: ${f.color};"></div></div><div style="font-size: 12px; color: var(--ms-text-dim); letter-spacing: 0.03em;">${f.desc(s)}${isEgrAuto ? ' Add egress waypoints for precise analysis.' : ''}</div></div><div><div style="font-size: 24px; font-weight: 800; text-align: right; color: ${f.color};">${s}</div><div style="font-size: 11px; color: var(--ms-text-dim); text-align: right; margin-top: 1px;">/20</div></div>`;
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
      ctx.arc(cx + dx * R * t, cy + dy * R * t, 5, 0, Math.PI * 2);
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.font = '700 14px "Courier New"';
      ctx.fillStyle = f.color;
      ctx.textAlign = dx > 0.1 ? 'left' : dx < -0.1 ? 'right' : 'center';
      ctx.textBaseline = dy > 0.1 ? 'top' : dy < -0.1 ? 'bottom' : 'middle';
      ctx.fillText(`${f.icon} ${scores[f.id] ?? '-'}`, cx + dx * (R + 22), cy + dy * (R + 22));
    });
    const composite = this._computeComposite(scores);
    const g = getGrade(composite);
    ctx.font = '700 34px "Courier New"';
    ctx.fillStyle = g.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(composite), cx, cy - 6);
    ctx.font = '13px "Courier New"';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('/100', cx, cy + 20);
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
      row.style.cssText = `display: flex; align-items: center; gap: 7px; padding: 4px 10px; cursor: pointer; transition: background 0.12s; ${i === 0 ? 'background: var(--ms-bg-subtle);' : ''}`;
      row.innerHTML = `<div style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${g.color};"></div><div style="flex: 1; font-size: 9.5px; color: var(--ms-text-dim);">${h.pt.latitude.toFixed(4)}N ${h.pt.longitude.toFixed(4)}E</div><div style="font-size: 11px; font-weight: 700; color: ${g.color};">${h.composite}</div>`;
      row.addEventListener('click', () => {
        this._scorePanelEl?.querySelectorAll('#posdef-ph-rows > div').forEach((x) => x.style.background = '');
        row.style.background = 'var(--ms-bg-subtle)';
        this._goToPoint(h.pt);
        this._updateScoreUI(h.scores, h.composite);
      });
      row.addEventListener('mouseover', () => {
        if (!row.style.background) row.style.background = 'rgba(255, 255, 255, 0.06)';
      });
      row.addEventListener('mouseout', () => {
        if (row.style.background === 'rgba(255, 255, 255, 0.06)') row.style.background = '';
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
      list.innerHTML = `
        <div style="font-size: var(--ms-fs-xs); color: rgba(239,159,39,0.7); padding: 4px 0 2px; letter-spacing: 0.04em; line-height: 1.55;">
          No waypoints — EGR scored from terrain estimate.<br>
          <span style="opacity:0.65;">Ctrl+Click map to add precise egress waypoints.</span>
        </div>`;
      return;
    }
    this._egressPts.forEach((ep, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 7px; padding: 4px 0; border-bottom: 0.5px solid rgba(255, 255, 255, 0.05);';
      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'font-size: var(--ms-fs-xs); color: var(--ms-text-dim); cursor: pointer; border: none; background: transparent; padding: 2px 4px; transition: color 0.12s;';
      delBtn.textContent = '✕';
      delBtn.addEventListener('mouseover', () => delBtn.style.color = 'var(--ms-accent-danger)');
      delBtn.addEventListener('mouseout', () => delBtn.style.color = 'var(--ms-text-dim)');
      delBtn.addEventListener('click', () => {
        this._egressPts.splice(i, 1);
        this._redrawEgressMarkers();
        this._renderEgressList();
      });
      row.innerHTML = `<div style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: #378ADD;"></div><div style="font-size: 9.5px; color: var(--ms-text-dim); flex: 1; letter-spacing: 0.03em;">E${i + 1} ${ep.latitude.toFixed(4)}N ${ep.longitude.toFixed(4)}E</div>`;
      row.appendChild(delBtn);
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
    if (this._addingEgress) {
      this._addingEgress = false;
      const btn = this._button('posdef-btn-egress-mode');
      if (btn) {
        btn.textContent = '+ Egress';
        btn.style.background = '';
      }
    }
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

  private _computeComposite(scores: ScoreMap, weights?: Record<FactorId, number>): number {
    const w = weights ?? this._weights();
    const wT = Object.values(w).reduce((s, v) => s + v, 0) || 1;
    return Math.round(FACTORS.reduce((s, f) => s + (scores[f.id] ?? 0) * ((w[f.id] ?? 1) / 20), 0) / wT * 100);
  }

  private _weights(): Record<FactorId, number> {
    return {
      obs: this._num('posdef-wt-obs', DEFAULT_WEIGHTS.obs),
      fof: this._num('posdef-wt-fof', DEFAULT_WEIGHTS.fof),
      cff: this._num('posdef-wt-cff', DEFAULT_WEIGHTS.cff),
      cfv: this._num('posdef-wt-cfv', DEFAULT_WEIGHTS.cfv),
      egr: this._num('posdef-wt-egr', DEFAULT_WEIGHTS.egr),
      dg: this._num('posdef-wt-dg', DEFAULT_WEIGHTS.dg),
    };
  }

  private _gradeDescription(score: number, scores: ScoreMap): string {
    const weak = FACTORS.filter((f) => (scores[f.id] ?? 0) < 8).map((f) => f.label.toLowerCase());
    const crit = FACTORS.filter((f) => (scores[f.id] ?? 0) < 5).map((f) => f.label.toLowerCase());
    if (score >= 75) return `Strong position. ${weak.length ? `Monitor: ${weak[0]} — below threshold.` : 'All factors adequate — prepare and improve.'}`;
    if (score >= 55) return `Acceptable — enhance before occupation. Prioritise: ${weak.slice(0, 2).join(', ') || 'all factors marginal'}.`;
    if (score >= 40) return `Marginal — use only if no alternatives. Critical: ${weak.slice(0, 2).join(', ') || 'multiple factors'}. Supplement with engineering works.`;
    if (score >= 25) return `Poor position. Seek alternatives. ${crit.length ? `Cannot hold without improving: ${crit.slice(0, 2).join(', ')}.` : 'All factors below acceptable.'}`;
    return `Avoid — multiple critical failures. Position likely indefensible: ${weak.slice(0, 3).join(', ') || 'all factors'}.`;
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
      if (s === 'ready' || s === 'done') {
        el.style.color = 'var(--ms-accent)';
      } else if (s === 'running') {
        el.style.color = '#EF9F27';
      }
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

}

export default PosDefScorerEngine;

