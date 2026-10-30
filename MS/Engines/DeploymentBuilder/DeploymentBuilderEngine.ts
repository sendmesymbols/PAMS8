import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import Extent from '@arcgis/core/geometry/Extent';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';

import SerializationEngine from '../ImportExport/SerializationEngine';
import Plan from '../ImportExport/Plan.ts';
import EngineLogger from '../../Support/EngineLogger';
import Utils from '../../Support/utils.ts';
import { bindDisclosures } from '../../Support/Disclosure';
import symbolMeta from '../../Data/Symbols.json';

// ── Web Mercator helpers ─────────────────────────────────────────────────────
// Plan files store WGS84 degrees; every layout calculation runs in Web Mercator
// (what the 102100 views draw in) so a rotation or scale on screen is exactly the
// one applied to the data.
const R_EARTH = 6378137;
const MAX_MERC_LAT = 85.0511287798;
const MERC_SR = { wkid: 102100 };

interface XY { x: number; y: number }

function lonLatToMerc(lon: number, lat: number): XY {
  const la = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, lat));
  return {
    x: (R_EARTH * lon * Math.PI) / 180,
    y: R_EARTH * Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)),
  };
}

function mercToLonLat(x: number, y: number): XY {
  return {
    x: (x / R_EARTH) * (180 / Math.PI),
    y: (2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) * (180 / Math.PI),
  };
}

function meanXY(points: XY[]): XY {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / points.length, y: sy / points.length };
}

/** Ghost colour by MIL-STD-2525D standard identity (SIDC digit 4): blue friend, red hostile. */
function affiliationRGB(sidc?: string): [number, number, number] {
  switch (sidc?.charAt(3)) {
    case '3': case '2': return [60, 140, 255];   // friend / assumed friend
    case '6': case '5': return [255, 80, 80];    // hostile / suspect
    case '4': return [80, 200, 120];             // neutral
    default:  return [240, 190, 60];
  }
}

const GHOST_ICON_PX = 28;

/** Exercise-template roles that are the opposing force's: drawn with the hostile (red) frame. */
const HOSTILE_ROLES = new Set(['forbidden-zone', 'threat-zone', 'kill-zone']);
const SPREAD_MIN_PCT = 10;
const SPREAD_MAX_PCT = 500;

/** One symbol's geometry, in Web Mercator, relative to its own centroid. */
interface PlanSymbolGeom {
  id: string;        // plnOrdrSymbolId — what a plan's `pivot` names
  label: string;     // designation / symbol name, for the pivot picker
  kind: string;      // SYM_GEO_TYPE: Point | FPoint | Line | Area
  sidc?: string;
  centroid: XY;
  rel: XY[];         // one entry per geometry point, in extraction order
  reach: number;     // furthest point from `centroid`
}

interface PlanMetrics {
  symbolCount: number;
  centroid: XY;      // mean of every geometry point in the plan
  symbols: PlanSymbolGeom[];
}

interface Bounds { xmin: number; ymin: number; xmax: number; ymax: number }

const CATEGORY_LABELS: Record<string, string> = {
  own:       'Own Forces',
  en:        'Enemy',
  attack:    'Attack',
  defence:   'Defence',
  logistic:  'Logistic',
  exercises: 'Exercises',
  imported:  'Imported',
  other:     'Other',
};

const ENGINE_NAME = 'DeploymentManager';

export interface PlanEntry {
  id: string;
  name: string;
  category: string;
  /** Path under the registry base. Unused when `data` carries the plan itself. */
  file: string;
  description: string;
  /** Symbol the map click lands on and rotation/spread are measured from (a plnOrdrSymbolId, or the template symbol id). Default: the plan centre. */
  pivot?: string;
  /** The plan document inline (Plan document or exercise template), for hosts that already hold it. */
  data?: any;
}

/** Where the plan list and plan files come from. Hosts can supply their own (an SOP library, a server). */
export interface DeploymentPlanSource {
  list(): Promise<PlanEntry[]>;
  /** The Plan document / exercise template for `entry`, or null when it cannot be had. */
  load(entry: PlanEntry): Promise<any | null>;
}

/** Hooks the host (SymbolEngine) lends the manager so a placement is one undoable step and removable as a unit. */
export interface DeploymentHost {
  groupUndo<T>(label: string, fn: () => T): T;
  /** Remove symbols by attributes.id as one undoable step; returns how many were found. */
  removeByIds(ids: string[], label?: string): number;
}

export interface DeploymentBuilderOptions {
  /** A base URL (holding `Deployemets.json`) or a custom source. Default: `/MS/Data/Deployments/`. */
  planSource?: string | DeploymentPlanSource;
  host?: DeploymentHost;
}

const DEFAULT_REGISTRY_BASE = '/MS/Data/Deployments/';

/** Registry + plan files served as static JSON under `base`. */
function urlPlanSource(base: string): DeploymentPlanSource {
  const root = base.endsWith('/') ? base : `${base}/`;
  const getJson = async (url: string) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    try {
      return await resp.json();
    } catch {
      // A wrong base usually lands on the host's HTML fallback page, not a 404.
      throw new Error(`${url} did not return JSON — check the plan source base URL`);
    }
  };
  return {
    list: async () => {
      const data = await getJson(`${root}Deployemets.json`);
      return Array.isArray(data) ? data : (data?.plans ?? []);
    },
    load: (entry) => (entry.data != null ? Promise.resolve(entry.data) : getJson(root + entry.file)),
  };
}

/** What a placement left on the map, so it can be removed or repositioned as a unit. */
interface PlacementRecord {
  id: string;
  entry: PlanEntry;
  data: any;
  metrics: PlanMetrics;
  pivotId: string | null;
  spread: number;
  rotate: boolean;
  symbolIds: string[];
}

type Phase = 'idle' | 'anchor' | 'bearing';

class DeploymentBuilderEngine {
  private static _instance: DeploymentBuilderEngine | null = null;

  private _view: MapView | SceneView | null = null;
  private _enabled: boolean = false;
  private _widget: HTMLElement | null = null;
  private _ghostLayer: GraphicsLayer | null = null;
  private _serializationEngine: SerializationEngine | null = null;

  // Placement state
  private _phase: Phase = 'idle';
  private _selectedPlanData: any = null;
  private _selectedPlanEntry: PlanEntry | null = null;
  private _selectedPlanMetrics: PlanMetrics | null = null;
  private _anchorPoint: Point | null = null;
  /** Off: the plan keeps its drawn orientation. On: a second click aims it. */
  private _rotate: boolean = false;
  /** Multiplier on each symbol's distance from the plan centroid (1 = as drawn). */
  private _spread: number = 1;
  /** Symbol the plan pivots on; null = the plan centre. */
  private _pivotId: string | null = null;
  /** On: stay armed after each placement so copies can be dropped one after another. */
  private _keepPlacing: boolean = false;
  private _placedThisRun: number = 0;
  private _rearmTimer: ReturnType<typeof setTimeout> | null = null;
  private _host: DeploymentHost | null = null;
  private _lastPlacement: PlacementRecord | null = null;
  /** Set while repositioning: the placement the next commit replaces. */
  private _replacing: PlacementRecord | null = null;

  // Event handles
  private _pointerMoveHandle: any = null;
  private _pointerDownHandle: any = null;  // placement click handler
  private _bgClickHandle: any = null;       // background right-click handler (persistent)
  private _rightClickHandle: any = null;    // bearing-phase right-click to reset anchor
  private _keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

  // RAF throttle for ghost-preview redraws
  private _ghostRafId: number | null = null;
  private _pendingGhostCursor: Point | null = null;
  /** Ghost unit icons by SIDC; null = milsymbol could not draw it (a dot is used). */
  private _iconCache: Map<string, PictureMarkerSymbol | null> = new Map();

  // Placement overlay UI
  private _bearingHUD: HTMLElement | null = null;
  private _placementInstructions: HTMLElement | null = null;

  // Background right-click popup
  private _bgPopup: HTMLElement | null = null;

  // Registry cache
  private _registry: PlanEntry[] | null = null;
  private _registryError: string | null = null;
  private _source: DeploymentPlanSource = urlPlanSource(DEFAULT_REGISTRY_BASE);

  // Widget state
  private _minimized: boolean = false;
  private _helpDismiss: ((e: MouseEvent) => void) | null = null;
  private _searchText: string = '';
  private _collapsedCategories: Set<string> = new Set();
  /** Restore height for un-minimize. Must match the CSS height. */
  private _widgetHeight: string = '500px';

  private constructor() {}

  public static getInstance(): DeploymentBuilderEngine {
    if (!DeploymentBuilderEngine._instance) {
      DeploymentBuilderEngine._instance = new DeploymentBuilderEngine();
    }
    return DeploymentBuilderEngine._instance;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public start(view: MapView | SceneView, serialEngine: SerializationEngine, options: DeploymentBuilderOptions = {}): void {
    this._view = view;
    this._serializationEngine = serialEngine;
    this._host = options.host ?? null;
    this._ghostLayer = new GraphicsLayer({ listMode: 'hide', opacity: 0.85 });
    view.map.add(this._ghostLayer);
    if (options.planSource) this.setPlanSource(options.planSource);
    EngineLogger.success(ENGINE_NAME, 'DeploymentBuilderEngine started');
  }

  /**
   * Point the manager at a different plan library: a base URL holding
   * `Deployemets.json`, or an object with `list()` / `load(entry)`. Refreshes the
   * open list; the current selection is kept.
   */
  public setPlanSource(source: string | DeploymentPlanSource): void {
    this._source = typeof source === 'string' ? urlPlanSource(source) : source;
    this._registry = null;
    this._registryError = null;
    if (this._widget?.classList.contains('ms-visible')) void this._loadRegistryIntoWidget();
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._cancelPlacement();
    if (this._ghostLayer) {
      if (this._view?.map) this._view.map.remove(this._ghostLayer);
    }
    this._view = view;
    this._ghostLayer = new GraphicsLayer({ listMode: 'hide', opacity: 0.85 });
    view.map.add(this._ghostLayer);
    this._removePointerHandles();
    this._removeBgPopup();
  }

  public enable(): void {
    this._enabled = true;
  }

  public disable(): void {
    this._enabled = false;
    this._cancelPlacement();
    this._removeBgPopup();
  }

  public destroy(): void {
    this.disable();
    this._removeBgClickHandle();
    if (this._helpDismiss) {
      document.removeEventListener('click', this._helpDismiss);
      this._helpDismiss = null;
    }
    if (this._widget) {
      this._widget.remove();
      this._widget = null;
    }
    if (this._ghostLayer && this._view?.map) {
      this._view.map.remove(this._ghostLayer);
    }
    this._ghostLayer = null;
    this._view = null;
    DeploymentBuilderEngine._instance = null;
  }

  // ── Widget ─────────────────────────────────────────────────────────────────

  public openWidget(): void {
    if (!this._widget) {
      this._buildWidget();
    } else {
      this._widget.classList.add('ms-visible');
      this._widget.style.removeProperty('display');
      this._minimized = false;
      this._applyMinimizeState();
    }
    this._syncLastPlacement();
    this._loadRegistryIntoWidget();
  }

  private _closeWidget(): void {
    if (this._widget) {
      this._widget.classList.remove('ms-visible');
    }
    this._cancelPlacement();
  }

  private _minimizeWidget(): void {
    this._minimized = !this._minimized;
    this._applyMinimizeState();
  }

  private _applyMinimizeState(): void {
    if (!this._widget) return;
    const body = this._widget.querySelector('.ms-body') as HTMLElement | null;
    const minBtn = this._widget.querySelector('#db-min-btn') as HTMLElement | null;
    if (body) body.classList.toggle('ms-minimized', this._minimized);
    if (minBtn) {
      minBtn.textContent = this._minimized ? '▶' : '▼';
      minBtn.title = this._minimized ? 'Restore' : 'Minimize';
    }
    this._widget.classList.toggle('db-minimized', this._minimized);
    this._widget.style.height = this._minimized ? 'auto' : this._widgetHeight;
  }

  private _buildWidget(): void {

    const el = document.createElement('div');
    el.id = 'deploymentBuilderWidget';
    el.className = 'ms-panel ms-theme-ops-dark ms-visible';
    el.setAttribute('data-engine', 'deployment-builder');

    el.innerHTML = `
      <div class="ms-header" id="db-drag-handle">
        <div class="ms-header-icon">DEP</div>
        <div class="ms-header-title">Deployment Mgr</div>
        <div class="ms-status-dot" id="db-status-dot"></div>
        <div class="ms-status-lbl" id="db-status-lbl">Idle</div>
        <button class="ms-header-btn ms-btn-round" id="db-help-btn" title="How it works">?</button>
        <button class="ms-header-btn ms-btn-round" id="db-min-btn" title="Minimize">▼</button>
        <button class="ms-header-btn ms-btn-round" id="db-close-btn" title="Close">✕</button>
      </div>

      <div class="ms-help-popover" id="db-help-popover" hidden>
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Field Guide</div>
            <div class="ms-help-title">Deployment Manager</div>
          </div>
          <button class="ms-help-close" id="db-help-close" title="Close">✕</button>
        </div>
        <div class="ms-help-body">
          <p>Drop a pre-built tactical plan onto the map. The whole plan moves as one piece, so units, lines and areas keep the relationships they were drawn with.</p>
          <p><strong style="color:var(--ms-accent)">Workflow</strong></p>
          <ol>
            <li>Pick a plan from the list on the left.</li>
            <li>Click <strong>Place on Map</strong>. The view zooms out if the plan is too big to see, and a live preview follows the cursor.</li>
            <li>Click the map to place the plan's centre.</li>
            <li>With <strong>Rotate to a bearing</strong> on, move the cursor to aim the plan and click again.</li>
          </ol>
          <p><strong style="color:var(--ms-accent)">Options</strong></p>
          <ul style="list-style:none;padding:0;margin:0 0 9px">
            <li><strong>Rotate to a bearing</strong> — turn the whole plan to face a direction (as drawn it faces north)</li>
            <li><strong>Spread</strong> — 100% is exactly as drawn; more pushes the units apart, less pulls them together</li>
            <li><strong>Keep placing copies</strong> — stay armed after each drop; Esc to finish</li>
            <li><strong>Pivot</strong> — land your click on a chosen unit (an HQ, say) instead of the plan's centre</li>
          </ul>
          <p>The preview shows the plan's real ground size at the current spread. After placing, the map zooms to show every new symbol, and <strong>Ctrl+Z</strong> takes the whole placement back in one step. <strong>Last placement</strong> lets you reposition or remove it later.</p>
          <p><strong style="color:var(--ms-accent)">Shortcuts</strong></p>
          <ul style="list-style:none;padding:0;margin:0">
            <li><strong>Right-click</strong> during bearing — reset to anchor pick</li>
            <li><strong>Esc</strong> — cancel placement</li>
          </ul>
        </div>
      </div>

      <div class="ms-body" id="db-body">
        <div class="db-cols">
          <!-- Left: plan picker -->
          <div class="db-left">
            <div class="db-toolbar">
              <input class="ms-input db-search" type="text" placeholder="Search plans…" autocomplete="off" />
              <button class="ms-btn db-btn-import" title="Use a local Save Plan JSON">Use Saved Plan…</button>
            </div>
            <div class="db-plan-list"></div>
          </div>

          <!-- Right: the selected plan and Place. Rotation and spread are
               tweakables with usable defaults (drawn orientation, 100%), so
               they sit in a collapsed disclosure. -->
          <div class="db-right">
            <div class="ms-section-title">Selected Plan</div>
            <div class="db-plan-summary">
              <div class="db-plan-name empty">No plan selected</div>
              <div class="db-plan-desc"></div>
              <div class="db-plan-thumb" hidden></div>
              <div class="ms-info-grid">
                <div class="ms-info-item">
                  <div class="ms-info-label">Symbols</div>
                  <div class="ms-info-value db-plan-syms">—</div>
                </div>
                <div class="ms-info-item">
                  <div class="ms-info-label">Category</div>
                  <div class="ms-info-value db-plan-cat">—</div>
                </div>
                <div class="ms-info-item">
                  <div class="ms-info-label">Ground size</div>
                  <div class="ms-info-value db-plan-size">—</div>
                </div>
                <div class="ms-info-item">
                  <div class="ms-info-label">Contains</div>
                  <div class="ms-info-value db-plan-comp">—</div>
                </div>
              </div>
            </div>

            <div class="ms-hint db-status"></div>

            <div class="ms-btn-row">
              <button class="ms-btn ms-cta db-btn-place" disabled>Place on Map ↗</button>
            </div>
            <div class="ms-btn-row db-cancel-row" hidden>
              <button class="ms-btn danger db-btn-cancel">Cancel placement</button>
            </div>

            <div class="db-last" hidden>
              <div class="ms-section-title">Last placement</div>
              <div class="db-last-line"><span class="db-last-name"></span> <span class="db-last-meta"></span></div>
              <div class="ms-btn-row">
                <button class="ms-btn db-btn-reposition" title="Pick it up and place it again, same plan and options">Reposition</button>
                <button class="ms-btn danger db-btn-remove" title="Remove every symbol of that placement (one undo step)">Remove</button>
              </div>
            </div>

            <div class="ms-disclosure" data-open="false">
              <button class="ms-disclosure-head" type="button" id="db-form-toggle" aria-expanded="false" aria-controls="db-form-body">
                <span class="ms-disclosure-chevron" aria-hidden="true">▶</span>
                <span class="ms-disclosure-title">Placement options</span>
                <span class="ms-disclosure-meta db-form-meta">As drawn · 100%</span>
              </button>
              <div class="ms-disclosure-body" id="db-form-body" hidden>
                <div class="ms-toggle-row">
                  <label for="db-rotate">Rotate to a bearing</label>
                  <input type="checkbox" id="db-rotate" class="db-rotate" />
                </div>
                <div class="ms-hint">Off: placed with one click, facing the way it was drawn. On: click the centre, then aim and click again.</div>

                <div class="ms-toggle-row">
                  <label for="db-keep">Keep placing copies</label>
                  <input type="checkbox" id="db-keep" class="db-keep" />
                </div>
                <div class="ms-hint">Stay armed after each drop to place another. Esc to finish.</div>

                <div class="db-pivot-block" hidden>
                  <div class="ms-section-title">Pivot</div>
                  <div class="db-pivot-row">
                    <select class="ms-input db-pivot" aria-label="Pivot unit"></select>
                  </div>
                  <div class="ms-hint">Your click lands on this unit; rotation and spread are measured from it. Default is the plan's centre.</div>
                </div>

                <div class="ms-section-title">Spread</div>
                <div class="db-spacing-row">
                  <input class="ms-input db-spread-val" type="number" value="100" min="${SPREAD_MIN_PCT}" max="${SPREAD_MAX_PCT}" step="10" />
                  <span class="db-unit">%</span>
                </div>
                <div class="ms-hint">100% is exactly as drawn. Higher moves each unit further from the plan's centre; its own size and shape don't change.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div data-resize="e"  class="db-resize-handle db-resize-e"></div>
      <div data-resize="s"  class="db-resize-handle db-resize-s"></div>
      <div data-resize="se" class="db-resize-handle db-resize-se"></div>
    `;

    document.body.appendChild(el);
    this._widget = el;

    // Wire header buttons
    el.querySelector('#db-close-btn')!.addEventListener('click', () => this._closeWidget());
    el.querySelector('#db-min-btn')!.addEventListener('click', () => this._minimizeWidget());

    // Help popover (toggled via hidden attribute, click-outside to dismiss)
    const helpBtn = el.querySelector('#db-help-btn') as HTMLElement | null;
    const helpPop = el.querySelector('#db-help-popover') as HTMLElement | null;
    const helpClose = el.querySelector('#db-help-close') as HTMLElement | null;
    if (helpBtn && helpPop) {
      helpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        helpPop.hidden = !helpPop.hidden;
      });
      helpClose?.addEventListener('click', () => { helpPop.hidden = true; });
      // Kept on the instance so destroy() can take it off the document again;
      // it used to be an anonymous listener that outlived the widget.
      this._helpDismiss = (e: MouseEvent) => {
        if (helpPop.hidden) return;
        if (!helpPop.contains(e.target as Node) && e.target !== helpBtn) {
          helpPop.hidden = true;
        }
      };
      document.addEventListener('click', this._helpDismiss);
    }

    bindDisclosures(el);

    // Drag (header is the handle)
    this._makeDraggable(el.querySelector('#db-drag-handle') as HTMLElement, el);

    // Resize
    this._makeResizable(el);

    // Search
    const searchEl = el.querySelector('.db-search') as HTMLInputElement;
    searchEl.addEventListener('input', () => {
      this._searchText = searchEl.value.toLowerCase();
      this._renderPlanList();
    });
    el.querySelector('.db-btn-import')!.addEventListener('click', () => this._importSavedPlanFromFile());

    this._showCancel(false);

    // Rotate toggle + spread %
    const rotateEl = el.querySelector('.db-rotate') as HTMLInputElement;
    rotateEl.addEventListener('change', () => {
      this._rotate = rotateEl.checked;
      this._syncOptionsMeta();
    });

    const keepEl = el.querySelector('.db-keep') as HTMLInputElement;
    keepEl.addEventListener('change', () => {
      this._keepPlacing = keepEl.checked;
      this._syncOptionsMeta();
    });

    const pivotEl = el.querySelector('.db-pivot') as HTMLSelectElement;
    pivotEl.addEventListener('change', () => {
      this._pivotId = pivotEl.value || null;
      this._syncOptionsMeta();
      this._renderPlanPreview();
    });

    const spreadEl = el.querySelector('.db-spread-val') as HTMLInputElement;
    spreadEl.addEventListener('input', () => {
      const pct = parseFloat(spreadEl.value);
      this._spread = Number.isFinite(pct)
        ? Math.max(SPREAD_MIN_PCT, Math.min(SPREAD_MAX_PCT, pct)) / 100
        : 1;
      this._syncOptionsMeta();
      this._renderPlanPreview();
    });
    // Out-of-range or empty text snaps to what is actually applied.
    spreadEl.addEventListener('change', () => {
      spreadEl.value = String(Math.round(this._spread * 100));
      this._syncOptionsMeta();
    });

    // Place / Cancel
    el.querySelector('.db-btn-place')!.addEventListener('click', () => this._onPlaceClicked());
    el.querySelector('.db-btn-cancel')!.addEventListener('click', () => this._cancelPlacement());

    // Last placement: pick it up again, or take it away
    el.querySelector('.db-btn-reposition')!.addEventListener('click', () => this._repositionLast());
    el.querySelector('.db-btn-remove')!.addEventListener('click', () => this._removeLast());
  }


  private _makeDraggable(handle: HTMLElement, el: HTMLElement): void {
    let startX = 0, startY = 0, elX = 0, elY = 0;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      elX = rect.left;
      elY = rect.top;
      handle.style.cursor = 'grabbing';
      const onMove = (me: MouseEvent) => {
        elX += me.clientX - startX;
        elY += me.clientY - startY;
        startX = me.clientX;
        startY = me.clientY;
        const maxX = window.innerWidth - el.offsetWidth;
        const maxY = window.innerHeight - el.offsetHeight;
        el.style.left = `${Math.max(0, Math.min(elX, maxX))}px`;
        el.style.top = `${Math.max(0, Math.min(elY, maxY))}px`;
      };
      const onUp = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  private _makeResizable(el: HTMLElement): void {
    const handles = el.querySelectorAll<HTMLElement>('[data-resize]');
    handles.forEach((handle) => {
      const dir = handle.dataset.resize!;
      handle.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;
        const rect = el.getBoundingClientRect();
        const startL = rect.left;
        const startT = rect.top;
        const minW = 380;
        const minH = 240;

        const onMove = (me: MouseEvent) => {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;
          const maxW = window.innerWidth * 0.9;
          const maxH = window.innerHeight * 0.9;

          if (dir.includes('e')) {
            el.style.width = `${Math.max(minW, Math.min(maxW, startW + dx))}px`;
          }
          if (dir.includes('s')) {
            const newH = Math.max(minH, Math.min(maxH, startH + dy));
            el.style.height = `${newH}px`;
            this._widgetHeight = el.style.height;
          }
          if (dir === 'se') {
            el.style.width = `${Math.max(minW, Math.min(maxW, startW + dx))}px`;
            const newH = Math.max(minH, Math.min(maxH, startH + dy));
            el.style.height = `${newH}px`;
            this._widgetHeight = el.style.height;
          }
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.cursor = '';
        };

        document.body.style.cursor = handle.style.cursor;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  // ── Registry & Plan Loading ────────────────────────────────────────────────

  private async _loadRegistry(): Promise<PlanEntry[]> {
    if (this._registry) return this._registry;
    try {
      const plans = await this._source.list();
      this._registry = Array.isArray(plans) ? plans : [];
      this._registryError = null;
      return this._registry;
    } catch (err) {
      // Not cached: the next open (or Retry) asks again.
      this._registryError = err instanceof Error ? err.message : String(err);
      EngineLogger.error(ENGINE_NAME, `Failed to load plan registry: ${this._registryError}`);
      return [];
    }
  }

  private async _loadPlanFile(entry: PlanEntry): Promise<any> {
    try {
      return await this._source.load(entry);
    } catch (err) {
      EngineLogger.error(ENGINE_NAME, `Failed to load plan "${entry.name}": ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async _loadRegistryIntoWidget(): Promise<void> {
    const list = this._widget?.querySelector('.db-plan-list') as HTMLElement | null;
    if (list) list.innerHTML = '<div class="db-list-loading">Loading plans…</div>';
    const plans = await this._loadRegistry();
    this._renderPlanList(plans);
  }

  private _renderPlanList(plans?: PlanEntry[]): void {
    const list = this._widget?.querySelector('.db-plan-list') as HTMLElement | null;
    if (!list) return;
    const source = plans ?? this._registry ?? [];
    const filtered = this._searchText
      ? source.filter(p => p.name.toLowerCase().includes(this._searchText) || p.category.includes(this._searchText))
      : source;

    // Group by category
    const grouped: Record<string, PlanEntry[]> = {};
    filtered.forEach(p => {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p);
    });

    list.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'db-list-empty';
      if (this._registryError && !this._registry) {
        empty.textContent = `Could not load plans — ${this._registryError}`;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'ms-btn db-btn-retry';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => { void this._loadRegistryIntoWidget(); });
        empty.appendChild(retry);
      } else {
        empty.textContent = this._searchText ? 'No matching plans' : 'No plans available';
      }
      list.appendChild(empty);
      return;
    }

    Object.keys(grouped).forEach((cat) => {
      const isCollapsed = this._collapsedCategories.has(cat);
      const header = document.createElement('div');
      header.className = 'db-category-header' + (isCollapsed ? ' collapsed' : '');
      const label = CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
      // cat comes from the plan registry (a shared file) — escape it.
      header.innerHTML = `<span class="db-caret">▼</span><span>${Utils.escapeHtml(label)}</span>`;
      header.addEventListener('click', () => {
        if (this._collapsedCategories.has(cat)) {
          this._collapsedCategories.delete(cat);
        } else {
          this._collapsedCategories.add(cat);
        }
        this._renderPlanList();
      });
      list.appendChild(header);

      if (!isCollapsed) {
        grouped[cat].forEach(plan => {
          const item = document.createElement('div');
          item.className = 'db-plan-item' + (this._selectedPlanEntry?.id === plan.id ? ' active' : '');
          item.textContent = plan.name;
          item.addEventListener('click', () => this._selectPlan(plan));
          list.appendChild(item);
        });
      }
    });
  }

  private _applySelectedPlanToUI(state: 'loading' | 'ready' | 'failed'): void {
    if (!this._widget || !this._selectedPlanEntry) return;
    const nameEl = this._widget.querySelector('.db-plan-name') as HTMLElement | null;
    const descEl = this._widget.querySelector('.db-plan-desc') as HTMLElement | null;
    const symsEl = this._widget.querySelector('.db-plan-syms') as HTMLElement | null;
    const catEl = this._widget.querySelector('.db-plan-cat') as HTMLElement | null;
    const placeBtn = this._widget.querySelector('.db-btn-place') as HTMLButtonElement | null;

    if (nameEl) {
      nameEl.textContent = this._selectedPlanEntry.name;
      nameEl.classList.remove('empty');
    }
    if (descEl) descEl.textContent = this._selectedPlanEntry.description;
    if (catEl) catEl.textContent = CATEGORY_LABELS[this._selectedPlanEntry.category] ?? this._selectedPlanEntry.category;

    if (state === 'loading') {
      if (symsEl) symsEl.textContent = '…';
      if (placeBtn) placeBtn.disabled = true;
      this._setHeaderState('running', 'Loading');
    } else if (state === 'failed') {
      if (symsEl) symsEl.textContent = '—';
      if (placeBtn) placeBtn.disabled = true;
      this._setStatus('Failed to load plan file');
      this._setHeaderState('warning', 'Error');
    } else {
      const count = this._selectedPlanMetrics?.symbolCount ?? 0;
      if (symsEl) symsEl.textContent = String(count);
      if (placeBtn) placeBtn.disabled = count <= 0;
      this._setHeaderState(count > 0 ? 'ready' : '', count > 0 ? 'Ready' : 'Empty');
    }
    this._populatePivotSelect();
    this._renderPlanPreview();
    this._syncOptionsMeta();
  }

  // ── Plan preview ───────────────────────────────────────────────────────────

  /** Pivot candidates are units (points); lines, areas and text boxes have no single spot worth landing a click on. */
  private _pivotCandidates(m: PlanMetrics | null): PlanSymbolGeom[] {
    return (m?.symbols ?? []).filter((s) =>
      s.kind !== 'Line' && s.kind !== 'Area' && s.id !== '' && !/text\s*box/i.test(s.label));
  }

  /** A plan's `pivot` names a symbol by id; template symbols are stored as `<template id>-<symbol id>`, so a suffix match counts. */
  private _resolvePivotId(name: string | undefined, m: PlanMetrics): string | null {
    if (!name) return null;
    const hit = this._pivotCandidates(m).find((s) => s.id === name || s.id.endsWith(`-${name}`));
    return hit?.id ?? null;
  }

  private _populatePivotSelect(): void {
    const block = this._widget?.querySelector<HTMLElement>('.db-pivot-block');
    const sel = this._widget?.querySelector<HTMLSelectElement>('.db-pivot');
    if (!block || !sel) return;
    const cands = this._pivotCandidates(this._selectedPlanMetrics);
    block.hidden = cands.length === 0;
    sel.innerHTML = '';
    const centre = document.createElement('option');
    centre.value = '';
    centre.textContent = 'Plan centre';
    sel.appendChild(centre);
    const m = this._selectedPlanMetrics;
    if (!m) return;   // still loading (or failed): only "Plan centre" is on offer
    // Plans repeat names ("Inf", "Tgt"…), so say where each one sits relative to the plan centre.
    const gk = Math.cos((mercToLonLat(m.centroid.x, m.centroid.y).y * Math.PI) / 180);
    for (const s of cands) {
      const dx = (s.centroid.x - m.centroid.x) * gk;
      const dy = (s.centroid.y - m.centroid.y) * gk;
      const dist = Math.hypot(dx, dy);
      const where = dist < 50
        ? 'at centre'
        : `${this._formatDistance(dist)} ${this._bearingToCardinal(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360)}`;
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = `${s.label} — ${where}`;
      sel.appendChild(o);
    }
    sel.value = this._pivotId ?? '';
  }

  /** The plan as it lands for the current spread, facing as drawn, relative to the pivot (anchor at 0,0). */
  private _authoredLayout(): { items: { s: PlanSymbolGeom; pts: XY[] }[]; bounds: Bounds; groundK: number } | null {
    const m = this._selectedPlanMetrics;
    if (!m || m.symbols.length === 0) return null;
    const pivot = this._pivot(m);
    const origin = { x: 0, y: 0 };
    const bounds: Bounds = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
    const items = m.symbols.map((s) => {
      const pts = this._layoutSymbol(s, pivot, origin, 1, 0, this._spread, 1);
      for (const p of pts) {
        bounds.xmin = Math.min(bounds.xmin, p.x);
        bounds.xmax = Math.max(bounds.xmax, p.x);
        bounds.ymin = Math.min(bounds.ymin, p.y);
        bounds.ymax = Math.max(bounds.ymax, p.y);
      }
      return { s, pts };
    });
    if (!Number.isFinite(bounds.xmin)) return null;
    // Mercator units overstate ground distance by 1/cos(latitude) at the plan's own latitude.
    const groundK = Math.cos((mercToLonLat(pivot.x, pivot.y).y * Math.PI) / 180);
    return { items, bounds, groundK };
  }

  /** Footprint thumbnail, real ground size and composition for the selected plan at the current spread. */
  private _renderPlanPreview(): void {
    const w = this._widget;
    if (!w) return;
    const thumb = w.querySelector<HTMLElement>('.db-plan-thumb');
    const sizeEl = w.querySelector<HTMLElement>('.db-plan-size');
    const compEl = w.querySelector<HTMLElement>('.db-plan-comp');
    const layout = this._authoredLayout();
    if (!thumb || !sizeEl || !compEl) return;
    if (!layout) {
      thumb.hidden = true;
      thumb.innerHTML = '';
      sizeEl.textContent = '—';
      compEl.textContent = '—';
      return;
    }

    const { items, bounds: b, groundK } = layout;
    const spanX = b.xmax - b.xmin;
    const spanY = b.ymax - b.ymin;
    sizeEl.textContent = spanX * groundK < 1 && spanY * groundK < 1
      ? 'single point'
      : `${this._formatDistance(spanX * groundK)} × ${this._formatDistance(spanY * groundK)}`;

    const counts = { unit: 0, line: 0, area: 0 };
    for (const { s } of items) {
      if (s.kind === 'Line') counts.line++;
      else if (s.kind === 'Area') counts.area++;
      else counts.unit++;
    }
    compEl.textContent = [
      counts.unit && `${counts.unit} unit${counts.unit > 1 ? 's' : ''}`,
      counts.line && `${counts.line} line${counts.line > 1 ? 's' : ''}`,
      counts.area && `${counts.area} area${counts.area > 1 ? 's' : ''}`,
    ].filter(Boolean).join(' · ');

    const W = 260, H = 120, PAD = 12;
    const sc = Math.min((W - 2 * PAD) / Math.max(spanX, 1), (H - 2 * PAD) / Math.max(spanY, 1));
    const ox = (W - spanX * sc) / 2 - b.xmin * sc;
    const oy = (H + spanY * sc) / 2 + b.ymin * sc;
    const px = (p: XY) => `${(p.x * sc + ox).toFixed(1)},${(oy - p.y * sc).toFixed(1)}`;
    const rgba = (rgb: [number, number, number], a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

    let shapes = '';
    let marks = '';
    for (const { s, pts } of items) {
      if (pts.length === 0) continue;
      const rgb = affiliationRGB(s.sidc);
      if (s.kind === 'Area' && pts.length >= 3) {
        shapes += `<polygon points="${pts.map(px).join(' ')}" fill="${rgba(rgb, 0.18)}" stroke="${rgba(rgb, 0.9)}" stroke-width="1.2"/>`;
      } else if ((s.kind === 'Line' || s.kind === 'Area') && pts.length >= 2) {
        shapes += `<polyline points="${pts.map(px).join(' ')}" fill="none" stroke="${rgba(rgb, 0.9)}" stroke-width="1.6"/>`;
      } else {
        const [cx, cy] = px(pts[0]).split(',');
        const chosen = s.id === this._pivotId;
        marks += `<circle cx="${cx}" cy="${cy}" r="${chosen ? 4.5 : 3.4}" fill="${rgba(rgb, 0.85)}" stroke="${chosen ? '#ffdc3c' : 'rgba(0,0,0,0.5)'}" stroke-width="${chosen ? 1.8 : 0.8}"/>`;
      }
    }
    // Where your click lands.
    const [ax, ay] = px({ x: 0, y: 0 }).split(',');
    const cross = `<path d="M${+ax - 6} ${ay}H${+ax + 6}M${ax} ${+ay - 6}V${+ay + 6}" stroke="#ffdc3c" stroke-width="1.4" fill="none"/>`;

    thumb.innerHTML =
      `<svg class="db-thumb-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Plan footprint, north up">` +
      `${shapes}${marks}${cross}` +
      `<text x="${W - 8}" y="14" text-anchor="end" font-size="10" fill="currentColor" opacity="0.6">N ↑</text>` +
      `</svg>`;
    thumb.hidden = false;
  }

  private async _selectPlan(plan: PlanEntry): Promise<void> {
    this._selectedPlanEntry = plan;
    this._selectedPlanData = null;
    this._selectedPlanMetrics = null;
    this._pivotId = null;

    this._applySelectedPlanToUI('loading');
    this._renderPlanList();

    const raw = await this._loadPlanFile(plan);
    // A slower load must not overwrite a plan picked after it.
    if (this._selectedPlanEntry !== plan) return;
    const data = raw ? this._asPlanDocument(raw) : null;
    if (!data) {
      this._applySelectedPlanToUI('failed');
      return;
    }
    this._selectedPlanData = data;
    this._selectedPlanMetrics = this._buildPlanMetrics(data);
    this._pivotId = this._resolvePivotId(plan.pivot, this._selectedPlanMetrics);
    this._applySelectedPlanToUI('ready');
  }

  // ── Placement Flow ─────────────────────────────────────────────────────────

  /**
   * Plans come in two shapes: a saved Plan document, or an exercise template (the
   * normalised `symbols[]` format in Templates/Ex). Return a Plan document for either,
   * or null when the data is neither.
   */
  private _asPlanDocument(data: any): any | null {
    if (Plan.isPlanDocument(data)) return data;
    if (Array.isArray(data?.symbols)) return this._templateToPlanDoc(data);
    return null;
  }

  /**
   * Turn an exercise template into a Plan document. Template positions are ratios in
   * [-1, 1] of the placement area (x across the frontage, y through the depth, both
   * measured from its centre), so they are laid out around lon/lat 0,0 in real
   * kilometres and the document names that point as its origin; the placement then
   * puts the origin on the clicked point. Seed-only fields (locked, scenarioProp,
   * success criteria) and the colour overrides belong to the scenario engine and are
   * not carried over: the symbols arrive as ordinary, editable ones in their standard look.
   */
  private _templateToPlanDoc(tpl: any): any | null {
    const frontageM = (Number(tpl.defaults?.frontageKm) || 10) * 500;   // half-width, metres
    const depthM = (Number(tpl.defaults?.depthKm) || 10) * 500;         // half-depth, metres
    const point = (x: number, y: number) => {
      const ll = mercToLonLat(x * frontageM, y * depthM);
      return { type: 'point', x: ll.x, y: ll.y, sp: 'WGS1SP' };
    };

    const planId = Date.now();
    const overlayId = `template-${tpl.id ?? 'plan'}`;
    const symbols: any[] = [];

    for (const s of tpl.symbols) {
      const meta = (symbolMeta as Record<string, any>)[s.symbolKey];
      if (!meta) {
        EngineLogger.error(ENGINE_NAME, `Template "${tpl.id}": unknown symbol key "${s.symbolKey}" (${s.id}) skipped`);
        continue;
      }

      let pts: { x: number; y: number }[] = [];
      if (s.geoType === 'Line') {
        pts = s.path ?? [];
      } else if (s.geoType === 'Area') {
        const ring: number[][] = s.rings?.[0] ?? [];
        const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
        pts = (closed ? ring.slice(0, -1) : ring).map(([x, y]) => ({ x, y }));
      } else if (s.position) {
        pts = [s.position];
      }
      if (pts.length === 0 || (meta.SymGeoType !== s.geoType && !(meta.SymGeoType === 'Point' && s.geoType === 'FPoint'))) {
        EngineLogger.error(ENGINE_NAME, `Template "${tpl.id}": "${s.id}" does not fit symbol ${s.symbolKey} (${meta.SymGeoType}); skipped`);
        continue;
      }

      const key = String(s.symbolKey);
      const identity = HOSTILE_ROLES.has(s.role) ? '6' : '3';
      const drawEss: any = {
        SYM_GEO_TYPE: meta.SymGeoType,
        SID: key.slice(2),
        SYM_NAME: meta.Name ?? '',
        AMPLIFIER: {
          UNIQUE_DESIG: s.amplifier?.uniqueDesignation ?? '', UNIQUE_DESIG_ID: '', HIGHER_FORM: '', hfid: '',
          STAFF_COM: '', ADDL_INFO: '', MULTI_LINE_LABEL_TEXT: '', MULTI_LINE_LABEL_COLOR: '#000000',
          MULTI_LINE_LABEL_ALIGN: 'center',
        },
        SIDC: `100${identity}${key.slice(0, 2)}0000${key.slice(2)}0000`,
        labelOptions: {},
        opacity: 1,
      };
      if (meta.SymGeoType === 'Line') {
        drawEss.CTRL_PTS = pts.map((p) => point(p.x, p.y));
        drawEss.DRAW_TYPE = 1;
      } else if (meta.SymGeoType === 'Area') {
        drawEss.CTRL_PTS = pts.map((p) => point(p.x, p.y));
        drawEss.ECHELON = '00';
        drawEss.DRAW_TYPE = 2;      // plain polygon — keeps the template's corners exactly
        drawEss.FACE_GAP = 5;
      } else {
        drawEss.SIZE = Number(s.style?.size) || 25;
        drawEss.ANGLE = 0;
        drawEss.GEOM = point(pts[0].x, pts[0].y);
      }
      symbols.push(Plan.createSymbol(planId, overlayId, `${tpl.id}-${s.id}`, drawEss));
    }

    if (symbols.length === 0) return null;
    return {
      poObj: { plnOrdrOverlay: [Plan.createOverlay(planId, overlayId, String(tpl.name ?? tpl.id ?? 'Template'), 1, symbols)] },
      pamsOrigin: { x: 0, y: 0 },
    };
  }

  private _importSavedPlanFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = this._asPlanDocument(JSON.parse(evt.target?.result as string));
          if (!parsed) {
            this._setStatus('Selected file is not a Save Plan or exercise template JSON');
            EngineLogger.error(ENGINE_NAME, 'Imported file is not a valid Plan document');
            return;
          }

          const metrics = this._buildPlanMetrics(parsed);
          if (metrics.symbolCount <= 0) {
            this._setStatus('Selected plan has no placeable symbols');
            EngineLogger.error(ENGINE_NAME, 'Imported Plan document has no placeable symbols');
            return;
          }

          this._selectImportedPlan(file.name, parsed, metrics);
          this._setStatus(`Imported "${file.name}"`);
          EngineLogger.success(ENGINE_NAME, `Imported saved plan "${file.name}" with ${metrics.symbolCount} symbols`);
        } catch (err) {
          this._setStatus('Could not parse selected plan JSON');
          EngineLogger.error(
            ENGINE_NAME,
            `Failed to import saved plan: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  private _selectImportedPlan(fileName: string, data: any, metrics: PlanMetrics): void {
    this._selectedPlanEntry = {
      id: `imported-${Date.now()}`,
      name: fileName.replace(/\.json$/i, ''),
      category: 'imported',
      file: '',
      description: 'Imported saved plan',
    };
    this._selectedPlanData = data;
    this._selectedPlanMetrics = metrics;
    this._pivotId = null;

    this._applySelectedPlanToUI('ready');
    this._renderPlanList();
  }

  private _onPlaceClicked(): void {
    if (!this._selectedPlanData) return;
    this._replacing = null;
    this._placedThisRun = 0;
    this._setHeaderState('running', 'Anchor');
    this._startPlacement();
    this._fitViewToPlan();
    // Minimize widget so it doesn't block the map
    if (!this._minimized) this._minimizeWidget();
  }

  private _startPlacement(): void {
    if (!this._view) return;
    this._phase = 'anchor';
    this._anchorPoint = null;
    this._showCancel(true);
    this._clearGhostGraphics();
    this._removePointerHandles();

    const container = this._getViewContainer();
    if (container) container.style.cursor = 'none';

    this._listenAnchorHover();

    this._pointerDownHandle = this._view.on('click', (evt) => {
      const pt = evt.mapPoint;
      if (!pt) return;
      if (this._phase === 'anchor') {
        this._anchorPoint = pt;
        if (this._pointerMoveHandle) { this._pointerMoveHandle.remove(); this._pointerMoveHandle = null; }
        if (this._rotate) {
          this._startBearingPhase(pt);
        } else {
          // Keeping the drawn orientation needs no bearing — commit immediately
          this._commitPlacement(0);
        }
      } else if (this._phase === 'bearing' && this._anchorPoint) {
        this._commitPlacement(this._computeBearing(this._anchorPoint, pt));
      }
    });

    this._keyDownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this._cancelPlacement();
    };
    document.addEventListener('keydown', this._keyDownHandler);

    this._showPlacementInstructions(this._rotate ? 'anchor' : 'anchor-asIs');
    this._setStatus(this._rotate
      ? 'Click on map to set anchor point…'
      : 'Click on map to place — the plan keeps its drawn orientation');
  }

  /** Anchor phase: the plan ghost follows the cursor, drawn as authored (no rotation). */
  private _listenAnchorHover(): void {
    if (!this._view) return;
    if (this._pointerMoveHandle) { this._pointerMoveHandle.remove(); this._pointerMoveHandle = null; }
    this._pointerMoveHandle = this._view.on('pointer-move', (evt) => {
      if (this._phase !== 'anchor') return;
      const mapPt = this._view!.toMap({ x: evt.x, y: evt.y });
      if (mapPt) this._queueGhost(mapPt);
    });
  }

  private _startBearingPhase(anchor: Point): void {
    if (!this._view) return;
    this._phase = 'bearing';
    this._showPlacementInstructions('bearing');
    this._setStatus('Move cursor to set bearing — click to place');
    this._setHeaderState('running', 'Bearing');
    this._renderGhost(anchor, 0, null);

    this._pointerMoveHandle = this._view.on('pointer-move', (evt) => {
      const mapPt = this._view!.toMap({ x: evt.x, y: evt.y });
      if (!mapPt) return;
      const bearingDeg = this._radiansToDegrees(this._computeBearing(anchor, mapPt));
      // HUD and status are lightweight — update immediately for responsive feel
      this._showBearingHUD(evt.x, evt.y, bearingDeg);
      this._setStatus(`Bearing: ${Math.round(bearingDeg).toString().padStart(3, '0')}° ${this._bearingToCardinal(bearingDeg)} — click to place`);
      this._queueGhost(mapPt);
    });

    // Right-click during bearing phase resets to anchor selection
    this._rightClickHandle = this._view.on('pointer-down', (evt) => {
      if (evt.button !== 2) return;
      this._phase = 'anchor';
      this._showCancel(true);
      this._anchorPoint = null;
      this._clearGhostGraphics();
      this._removeBearingHUD();
      if (this._pointerMoveHandle) { this._pointerMoveHandle.remove(); this._pointerMoveHandle = null; }
      if (this._rightClickHandle) { this._rightClickHandle.remove(); this._rightClickHandle = null; }
      this._showPlacementInstructions('anchor');
      this._setStatus('Click on map to set anchor point…');
      this._setHeaderState('running', 'Anchor');
      this._listenAnchorHover();
    });
  }

  private _commitPlacement(bearing: number): void {
    if (!this._anchorPoint || !this._selectedPlanData || !this._serializationEngine) return;
    this._phase = 'idle';
    this._showCancel(false);
    this._clearGhostGraphics();
    this._removePointerHandles();
    const container = this._getViewContainer();
    if (container) container.style.cursor = '';
    this._removeBearingHUD();
    this._removePlacementInstructions();

    // Every point of every symbol goes through the same layout the ghost used, so
    // what was previewed is exactly what lands on the map.
    const { plan, bounds } = this._buildPlacedPlan(this._anchorPoint, bearing);
    const entry = this._selectedPlanEntry;
    const replacing = this._replacing;
    const deploymentId = `dep-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const symbolIds: string[] = [];
    const engine = this._serializationEngine;

    // Per-symbol "Add" undo entries fold into one: a single Ctrl+Z takes the whole
    // placement back. When repositioning, the new copy lands first so a failed load
    // never costs the old one, and the swap is one step too.
    const run = (): number => {
      const n = Math.max(0, engine.loadPlanSymbolsFromData(plan, undefined, {
        onLoaded: (g, id) => {
          if (!g) return;
          symbolIds.push(id);
          if (g.attributes) {
            g.attributes.deploymentId = deploymentId;
            g.attributes.deploymentName = entry?.name;
          }
        },
      }));
      if (n > 0 && replacing) this._host?.removeByIds(replacing.symbolIds, 'Remove deployment');
      return n;
    };
    const label = `${replacing ? 'Reposition' : 'Place'} ${entry?.name ?? 'deployment'}`;
    const count = this._host ? this._host.groupUndo(label, run) : run();
    this._anchorPoint = null;
    this._replacing = null;

    if (count > 0 && entry && this._selectedPlanData) {
      this._lastPlacement = {
        id: deploymentId,
        entry,
        data: this._selectedPlanData,
        metrics: this._getSelectedPlanMetrics(),
        pivotId: this._pivotId,
        spread: this._spread,
        rotate: this._rotate,
        symbolIds,
      };
      this._placedThisRun++;
      EngineLogger.success(ENGINE_NAME, `Placed ${count} symbols from "${entry.name}"`);
    }

    // Keep placing: stay armed for the next copy; the map stays where the user has it.
    if (count > 0 && this._keepPlacing && !replacing) {
      this._setStatus(`Placed ${this._placedThisRun} cop${this._placedThisRun === 1 ? 'y' : 'ies'} — click to place another, Esc to finish`);
      this._setHeaderState('running', `Placed ${this._placedThisRun}`);
      // Re-arm on the next tick: doing it inside this click's own dispatch could hand the
      // same click to the fresh handler and drop a second copy on the same spot.
      this._rearmTimer = setTimeout(() => {
        this._rearmTimer = null;
        if (this._phase !== 'idle') return;
        const status = this._widget?.querySelector('.db-status')?.textContent ?? '';
        this._startPlacement();
        this._setStatus(status);
      }, 0);
      return;
    }

    if (count > 0) this._zoomToPlaced(bounds);

    this._setStatus(`Placed ${count} symbol${count !== 1 ? 's' : ''}`);
    this._setHeaderState(count > 0 ? 'ready' : 'warning', count > 0 ? 'Placed' : 'Empty');
    // Placed → the widget has done its job, close it. Nothing placed → restore it
    // so the empty-result status stays visible.
    if (count > 0) this._closeWidget();
    else if (this._minimized) this._minimizeWidget();
  }

  // ── Last placement ─────────────────────────────────────────────────────────

  /** Show the last-placement card only while there is something it can act on. */
  private _syncLastPlacement(): void {
    const card = this._widget?.querySelector<HTMLElement>('.db-last');
    if (!card) return;
    const rec = this._lastPlacement;
    card.hidden = !rec || !this._host;
    if (!rec) return;
    const name = card.querySelector<HTMLElement>('.db-last-name');
    const meta = card.querySelector<HTMLElement>('.db-last-meta');
    if (name) name.textContent = rec.entry.name;
    if (meta) meta.textContent = `${rec.symbolIds.length} symbol${rec.symbolIds.length !== 1 ? 's' : ''}`;
  }

  /** Take the last placement off the map as one undoable step. */
  private _removeLast(): void {
    const rec = this._lastPlacement;
    if (!rec || !this._host) return;
    const removed = this._host.removeByIds(rec.symbolIds, `Remove ${rec.entry.name}`);
    this._lastPlacement = null;
    this._syncLastPlacement();
    this._setStatus(removed > 0
      ? `Removed ${removed} symbol${removed !== 1 ? 's' : ''} — Ctrl+Z brings them back`
      : 'Nothing left to remove — it was already deleted or undone');
  }

  /**
   * Pick the last placement up: same plan and options, ghost back on the cursor. The
   * old copy stays on the map until the new one lands, so cancelling loses nothing.
   */
  private _repositionLast(): void {
    const rec = this._lastPlacement;
    if (!rec) return;
    this._selectedPlanEntry = rec.entry;
    this._selectedPlanData = rec.data;
    this._selectedPlanMetrics = rec.metrics;
    this._pivotId = rec.pivotId;
    this._spread = rec.spread;
    this._rotate = rec.rotate;

    const w = this._widget;
    const rotateEl = w?.querySelector<HTMLInputElement>('.db-rotate');
    const spreadEl = w?.querySelector<HTMLInputElement>('.db-spread-val');
    if (rotateEl) rotateEl.checked = this._rotate;
    if (spreadEl) spreadEl.value = String(Math.round(this._spread * 100));
    this._applySelectedPlanToUI('ready');
    this._renderPlanList();

    this._replacing = rec;
    this._placedThisRun = 0;
    this._setHeaderState('running', 'Anchor');
    this._startPlacement();
    this._fitViewToPlan();
    if (!this._minimized) this._minimizeWidget();
  }

  private _cancelPlacement(): void {
    this._phase = 'idle';
    this._replacing = null;
    if (this._rearmTimer !== null) {
      clearTimeout(this._rearmTimer);
      this._rearmTimer = null;
    }
    this._showCancel(false);
    this._clearGhostGraphics();
    this._removePointerHandles();
    const container = this._getViewContainer();
    if (container) container.style.cursor = '';
    this._setStatus('');
    this._removeBearingHUD();
    this._removePlacementInstructions();
    if (this._minimized) this._minimizeWidget();
    const ready = (this._selectedPlanMetrics?.symbolCount ?? 0) > 0;
    this._setHeaderState(ready ? 'ready' : '', ready ? 'Ready' : 'Idle');
    this._syncLastPlacement();
  }

  // ── View framing ───────────────────────────────────────────────────────────

  /** Visible span (Web Mercator units) of the shorter view side, or null when it can't be measured. */
  private _viewSpanMerc(): number | null {
    const ext = this._view?.extent;
    if (!ext) return null;
    const wkid = ext.spatialReference?.wkid;
    if (wkid === 102100 || wkid === 3857) return Math.min(ext.width, ext.height);
    if (wkid === 4326) {
      const lo = lonLatToMerc(ext.xmin, ext.ymin);
      const hi = lonLatToMerc(ext.xmax, ext.ymax);
      return Math.min(hi.x - lo.x, hi.y - lo.y);
    }
    return null;
  }

  private _goToMercBounds(b: Bounds): void {
    const view = this._view;
    if (!view) return;
    const target = new Extent({ ...b, spatialReference: MERC_SR });
    view.goTo(target, { duration: 700 }).catch(() => { /* superseded by another navigation */ });
  }

  /**
   * The ghost is drawn at the plan's real ground size, so a plan tens of
   * kilometres across is off-screen — and its markers invisible — at a tight
   * zoom. Zoom out until the whole footprint fits; a view that already fits is
   * left alone.
   */
  private _fitViewToPlan(): void {
    const view = this._view;
    if (!view || !this._selectedPlanData) return;
    const c = this._toProjected(view.center);
    const diameter = 2 * this._footprintRadius(this._spread, this._groundScale(c.y));
    const span = this._viewSpanMerc();
    if (!(diameter > 0) || span === null || diameter <= span * 0.8) return;

    const half = (diameter * 1.5) / 2;
    this._goToMercBounds({ xmin: c.x - half, ymin: c.y - half, xmax: c.x + half, ymax: c.y + half });

    const groundM = diameter * Math.cos((mercToLonLat(c.x, c.y).y * Math.PI) / 180);
    this._setStatus(`Plan spans about ${this._formatDistance(groundM)} — zoomed out to fit. ` + this._statusText());
  }

  /** After placement, pan/zoom so every placed symbol is on screen. */
  private _zoomToPlaced(b: Bounds): void {
    if (!Number.isFinite(b.xmin) || !Number.isFinite(b.xmax)) return;
    const minSpan = 400;     // keeps a one-symbol plan from zooming to rooftop level
    const pad = 1.35;
    const cx = (b.xmin + b.xmax) / 2;
    const cy = (b.ymin + b.ymax) / 2;
    const halfW = (Math.max(b.xmax - b.xmin, minSpan) * pad) / 2;
    const halfH = (Math.max(b.ymax - b.ymin, minSpan) * pad) / 2;
    this._goToMercBounds({ xmin: cx - halfW, ymin: cy - halfH, xmax: cx + halfW, ymax: cy + halfH });
  }

  private _formatDistance(meters: number): string {
    return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km` : `${Math.round(meters)} m`;
  }

  private _statusText(): string {
    return this._rotate ? 'Click on map to set anchor point…' : 'Click on map to place…';
  }

  // ── Ghost Preview ──────────────────────────────────────────────────────────

  /** Coalesce pointer-moves into one ghost redraw per frame. */
  private _queueGhost(cursor: Point): void {
    this._pendingGhostCursor = cursor;
    if (this._ghostRafId !== null) return;
    this._ghostRafId = requestAnimationFrame(() => {
      this._ghostRafId = null;
      const cur = this._pendingGhostCursor;
      if (!cur) return;
      if (this._phase === 'anchor') {
        this._renderGhost(cur, 0, null);
      } else if (this._phase === 'bearing' && this._anchorPoint) {
        this._renderGhost(this._anchorPoint, this._computeBearing(this._anchorPoint, cur), cur);
      }
    });
  }

  /**
   * Draw the plan at `anchor`, rotated `theta` radians clockwise from north.
   * Units show their real icon, lines and areas their control-point outline, and
   * a dashed ring marks the plan's footprint so it stays readable when zoomed out.
   */
  private _renderGhost(anchor: Point, theta: number, cursor: Point | null): void {
    const layer = this._ghostLayer;
    if (!layer || !this._selectedPlanData) return;
    const metrics = this._getSelectedPlanMetrics();
    layer.removeAll();

    const a = this._toProjected(anchor);
    const k = this._groundScale(a.y);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const areas: Graphic[] = [];
    const lines: Graphic[] = [];
    const marks: Graphic[] = [];

    const pivot = this._pivot(metrics);
    for (const s of metrics.symbols) {
      const pts = this._layoutSymbol(s, pivot, a, cos, sin, this._spread, k);
      if (pts.length === 0) continue;
      const rgb = affiliationRGB(s.sidc);
      if (s.kind === 'Area' && pts.length >= 3) {
        const ring = pts.map((p) => [p.x, p.y]);
        ring.push([pts[0].x, pts[0].y]);
        areas.push(new Graphic({
          geometry: new Polygon({ rings: [ring], spatialReference: MERC_SR }),
          symbol: new SimpleFillSymbol({
            color: [rgb[0], rgb[1], rgb[2], 0.14],
            outline: { color: [rgb[0], rgb[1], rgb[2], 0.9], width: 1.4 },
          }),
        }));
      } else if ((s.kind === 'Line' || s.kind === 'Area') && pts.length >= 2) {
        lines.push(new Graphic({
          geometry: new Polyline({ paths: [pts.map((p) => [p.x, p.y])], spatialReference: MERC_SR }),
          symbol: new SimpleLineSymbol({ color: [rgb[0], rgb[1], rgb[2], 0.9], width: 2 }),
        }));
      } else {
        marks.push(new Graphic({
          geometry: new Point({ x: pts[0].x, y: pts[0].y, spatialReference: MERC_SR }),
          symbol: (s.sidc && this._ghostIcon(s.sidc)) || this._ghostDot(rgb),
        }));
      }
    }

    const radius = this._footprintRadius(this._spread, k);
    const ring: number[][] = [];
    for (let i = 0; i <= 72; i++) {
      const t = (i / 72) * 2 * Math.PI;
      ring.push([a.x + radius * Math.sin(t), a.y + radius * Math.cos(t)]);
    }
    const footprint = new Graphic({
      geometry: new Polyline({ paths: [ring], spatialReference: MERC_SR }),
      symbol: new SimpleLineSymbol({ color: [255, 220, 60, 0.55], width: 1.5, style: 'dash' }),
    });

    layer.addMany([...areas, ...lines, footprint, ...marks]);
    this._addAnchorIndicator(layer, anchor, cursor !== null);

    // Bearing arrow from anchor to cursor
    if (cursor) {
      const c = this._toProjected(cursor);
      layer.add(new Graphic({
        geometry: new Polyline({ paths: [[[a.x, a.y], [c.x, c.y]]], spatialReference: MERC_SR }),
        symbol: new SimpleLineSymbol({ color: [255, 200, 50, 0.8], width: 2, style: 'short-dash' }),
      }));
      // Arrowhead at cursor — triangle rotated to bearing direction
      layer.add(new Graphic({
        geometry: cursor,
        symbol: new SimpleMarkerSymbol({
          style: 'triangle',
          size: 14,
          color: [255, 200, 50, 0.9],
          outline: { color: [255, 230, 120, 1], width: 1.5 },
          angle: -this._radiansToDegrees(theta), // ArcGIS CCW; negate to rotate CW from north
        }),
      }));
    }
  }

  /** Crosshair rings: red while hovering for the anchor, yellow once it is fixed. */
  private _addAnchorIndicator(layer: GraphicsLayer, anchor: Point, fixed: boolean): void {
    const ring = (size: number, color: number[], width: number) => new Graphic({
      geometry: anchor,
      symbol: new SimpleMarkerSymbol({ style: 'circle', size, color: [0, 0, 0, 0], outline: { color, width } }),
    });
    if (fixed) {
      layer.addMany([
        ring(34, [255, 220, 60, 0.3], 1),
        ring(20, [255, 220, 60, 0.6], 1.5),
        new Graphic({
          geometry: anchor,
          symbol: new SimpleMarkerSymbol({
            style: 'cross', size: 22,
            color: [255, 220, 60, 1],
            outline: { color: [255, 220, 60, 1], width: 2.5 },
          }),
        }),
      ]);
    } else {
      layer.addMany([
        ring(28, [255, 0, 0, 0.7], 2),
        ring(16, [255, 0, 0, 0.7], 2),
        new Graphic({
          geometry: anchor,
          symbol: new SimpleMarkerSymbol({
            style: 'cross', size: 22,
            color: [100, 200, 255, 1],
            outline: { color: [255, 0, 0, 0.9], width: 2 },
          }),
        }),
      ]);
    }
  }

  private _clearGhostGraphics(): void {
    this._ghostLayer?.removeAll();
  }

  private _ghostDot(rgb: [number, number, number]): SimpleMarkerSymbol {
    return new SimpleMarkerSymbol({
      style: 'circle', size: 12,
      color: [rgb[0], rgb[1], rgb[2], 0.35],
      outline: { color: [rgb[0], rgb[1], rgb[2], 0.9], width: 1.5 },
    });
  }

  /** The unit's real 2525D frame icon (cached per SIDC), or null when milsymbol can't draw it. */
  private _ghostIcon(sidc: string): PictureMarkerSymbol | null {
    const cached = this._iconCache.get(sidc);
    if (cached !== undefined) return cached;
    let sym: PictureMarkerSymbol | null = null;
    try {
      const ms = new (window as any).MS.symbol(sidc, { size: GHOST_ICON_PX });
      ms.getMarker();
      const canvas = ms.asCanvas();
      const w = ms.width || GHOST_ICON_PX;
      const h = ms.height || GHOST_ICON_PX;
      const anchor = ms.markerAnchor || { x: w / 2, y: h / 2 };
      sym = new PictureMarkerSymbol({
        url: canvas.toDataURL(),
        width: `${w}px`,
        height: `${h}px`,
        xoffset: `${w / 2 - anchor.x}px`,
        yoffset: `${anchor.y - h / 2}px`,
      });
    } catch {
      sym = null;
    }
    this._iconCache.set(sidc, sym);
    return sym;
  }

  // ── Bearing HUD & Instructions ─────────────────────────────────────────────

  private _showBearingHUD(screenX: number, screenY: number, bearingDeg: number): void {
    this._injectOverlayStyles();
    if (!this._bearingHUD) {
      const el = document.createElement('div');
      el.className = 'db-bearing-hud';
      document.body.appendChild(el);
      this._bearingHUD = el;
    }
    const cardinal = this._bearingToCardinal(bearingDeg);
    const deg = Math.round(bearingDeg).toString().padStart(3, '0');
    this._bearingHUD.innerHTML = `
      <span class="db-bearing-kicker">BRG</span>
      <span class="db-bearing-deg">${deg}°</span>
      <span class="db-bearing-card">${cardinal}</span>
    `;
    // Offset so HUD sits just above-right of cursor
    this._bearingHUD.style.left = `${screenX + 20}px`;
    this._bearingHUD.style.top = `${screenY - 40}px`;
  }

  private _removeBearingHUD(): void {
    if (this._bearingHUD) {
      this._bearingHUD.remove();
      this._bearingHUD = null;
    }
  }

  private _showPlacementInstructions(phase: 'anchor' | 'anchor-asIs' | 'bearing'): void {
    this._injectOverlayStyles();
    if (!this._placementInstructions) {
      const el = document.createElement('div');
      el.className = 'db-placement-instructions';
      document.body.appendChild(el);
      this._placementInstructions = el;
    }

    const sep = `<span class="db-pi-sep">|</span>`;
    const key = (label: string, tone: 'accent' | 'success' | 'danger' = 'accent') =>
      `<kbd class="db-pi-key db-pi-key-${tone}">${label}</kbd>`;

    if (phase === 'anchor-asIs') {
      this._placementInstructions.innerHTML = `
        <span class="db-pi-step">Place plan</span>
        ${sep}
        <span>${key('Click')} to place the plan's centre — drawn orientation kept</span>
        ${sep}
        <span>${key('Esc', 'danger')} cancel</span>
      `;
    } else if (phase === 'anchor') {
      this._placementInstructions.innerHTML = `
        <span class="db-pi-step">Step 1 of 2 — Centre</span>
        ${sep}
        <span>${key('Click')} to set the plan's centre</span>
        ${sep}
        <span>${key('Esc', 'danger')} cancel</span>
      `;
    } else {
      this._placementInstructions.innerHTML = `
        <span class="db-pi-step">Step 2 of 2 — Bearing</span>
        ${sep}
        <span>${key('Click')} to place the plan</span>
        ${sep}
        <span>${key('Right-click', 'success')} reset anchor</span>
        ${sep}
        <span>${key('Esc', 'danger')} cancel</span>
      `;
    }
  }

  private _injectOverlayStyles(): void {
    if (document.getElementById('db-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'db-overlay-styles';
    style.textContent = `
      .db-bearing-hud {
        position: fixed;
        z-index: 1500;
        display: flex; align-items: center; gap: 8px;
        background: color-mix(in srgb, var(--ms-bg, #0e121c) 75%, transparent);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        backdrop-filter: blur(10px) saturate(140%);
        border: 1px solid color-mix(in srgb, var(--ms-accent, #ef9f27) 55%, transparent);
        border-radius: 7px;
        padding: 5px 12px 5px 10px;
        font-family: var(--ms-font-mono);
        font-size: var(--ms-fs-sm);
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      }
      .db-bearing-hud .db-bearing-kicker {
        color: color-mix(in srgb, var(--ms-text, #b4c8e6) 80%, transparent);
        font-size: var(--ms-fs-xs);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-weight: 700;
      }
      .db-bearing-hud .db-bearing-deg {
        font-weight: 800;
        color: var(--ms-text, #fff);
        font-size: 14px;
        text-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
      }
      .db-bearing-hud .db-bearing-card {
        color: var(--ms-success, #80d8a0);
        font-size: var(--ms-fs);
        font-weight: 600;
      }

      .db-placement-instructions {
        position: fixed;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1500;
        display: flex; gap: 14px; align-items: center;
        background: color-mix(in srgb, var(--ms-bg, #0e121c) 72%, transparent);
        -webkit-backdrop-filter: blur(12px) saturate(140%);
        backdrop-filter: blur(12px) saturate(140%);
        border: 1px solid var(--ms-border, rgba(90, 140, 220, 0.4));
        border-radius: 9px;
        padding: 8px 20px;
        font-family: var(--ms-font);
        font-size: var(--ms-fs);
        color: var(--ms-text, #c8dcf0);
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      }
      .db-placement-instructions .db-pi-step {
        color: var(--ms-text, #fff);
        font-weight: 700;
        text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
      }
      .db-placement-instructions .db-pi-sep {
        color: color-mix(in srgb, var(--ms-text, #96aac8) 40%, transparent);
      }
      .db-placement-instructions .db-pi-key {
        background: color-mix(in srgb, var(--ms-text, #fff) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--ms-text, #fff) 22%, transparent);
        border-radius: var(--ms-radius-sm);
        padding: 1px 6px;
        font-size: var(--ms-fs-xs);
        font-family: inherit;
        font-weight: 600;
      }
      .db-placement-instructions .db-pi-key-accent  { color: var(--ms-accent, #ffc46e); }
      .db-placement-instructions .db-pi-key-success { color: var(--ms-success, #90e8b0); }
      .db-placement-instructions .db-pi-key-danger  { color: var(--ms-danger, #ff9090); }
    `;
    document.head.appendChild(style);
  }

  private _removePlacementInstructions(): void {
    if (this._placementInstructions) {
      this._placementInstructions.remove();
      this._placementInstructions = null;
    }
  }

  private _radiansToDegrees(radians: number): number {
    return ((radians * 180) / Math.PI + 360) % 360;
  }

  private _bearingToCardinal(deg: number): string {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  // ── Placement Math ─────────────────────────────────────────────────────────

  /** Rhumb bearing in radians (0 = north, clockwise) — the same angle the cursor line shows on screen. */
  private _computeBearing(from: Point, to: Point): number {
    const a = this._toProjected(from);
    const b = this._toProjected(to);
    return Math.atan2(b.x - a.x, b.y - a.y);
  }

  /**
   * Where each point of one symbol lands for a placement at `a`, rotated by the
   * bearing (`cos`, `sin`). The symbol's centroid moves to its scaled, rotated
   * spot around the plan centroid; the symbol's own points rotate with it, so with
   * spread 1 the whole plan turns as one rigid piece. `k` is the latitude correction
   * from `_groundScale`, applied to everything so real distances survive the move.
   */
  private _layoutSymbol(s: PlanSymbolGeom, planCentroid: XY, a: XY, cos: number, sin: number, spread: number, k: number): XY[] {
    const cx = (s.centroid.x - planCentroid.x) * spread;
    const cy = (s.centroid.y - planCentroid.y) * spread;
    return s.rel.map((r) => {
      const lx = (cx + r.x) * k;
      const ly = (cy + r.y) * k;
      return { x: a.x + lx * cos + ly * sin, y: a.y - lx * sin + ly * cos };
    });
  }

  /** Furthest any point of the placed plan reaches from the anchor, in Web Mercator units. */
  private _footprintRadius(spread: number, k: number): number {
    if (!this._selectedPlanData) return 0;
    const m = this._getSelectedPlanMetrics();
    const pivot = this._pivot(m);
    let r = 0;
    for (const s of m.symbols) {
      const d = Math.hypot(s.centroid.x - pivot.x, s.centroid.y - pivot.y) * spread + s.reach;
      if (d > r) r = d;
    }
    return r * k;
  }

  /**
   * Web Mercator stretches distances by 1/cos(latitude), so a plan authored at one latitude
   * and dropped at another would grow or shrink on the ground. Scaling by the ratio of the
   * two cosines keeps a 25 km frontage 25 km wherever it lands.
   */
  private _groundScale(anchorY: number): number {
    const m = this._getSelectedPlanMetrics();
    const pivot = this._pivot(m);
    const rad = Math.PI / 180;
    const cosPlan = Math.cos(mercToLonLat(pivot.x, pivot.y).y * rad);
    const cosHere = Math.cos(mercToLonLat(0, anchorY).y * rad);
    return cosHere > 1e-6 ? cosPlan / cosHere : 1;
  }

  /** The point the click lands on and rotation/spread are measured from: the chosen unit, else the plan centre. */
  private _pivot(m: PlanMetrics): XY {
    if (this._pivotId) {
      const s = m.symbols.find((x) => x.id === this._pivotId);
      if (s) return s.centroid;
    }
    return m.centroid;
  }

  private _toProjected(pt: Point): XY {
    if (pt.spatialReference?.wkid === 4326 || pt.spatialReference?.wkid === 4269) {
      // Geographic → Web Mercator
      try {
        const proj = webMercatorUtils.geographicToWebMercator(pt) as Point;
        return { x: proj.x, y: proj.y };
      } catch {
        return { x: pt.x, y: pt.y };
      }
    }
    return { x: pt.x, y: pt.y };
  }

  // ── Plan Helpers ───────────────────────────────────────────────────────────

  /**
   * Deep-clone the plan and lay every symbol out for a placement at `anchor`,
   * rotated by `bearing`. Returns the cloned plan plus the Web Mercator bounds of
   * everything placed, for framing the view afterwards.
   */
  private _buildPlacedPlan(anchor: Point, bearing: number): { plan: any; bounds: Bounds } {
    const plan = JSON.parse(JSON.stringify(this._selectedPlanData));
    const metrics = this._getSelectedPlanMetrics();
    const pivot = this._pivot(metrics);
    const a = this._toProjected(anchor);
    const k = this._groundScale(a.y);
    const cos = Math.cos(bearing);
    const sin = Math.sin(bearing);
    const bounds: Bounds = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };

    let index = 0;
    this._eachSymbolGeometry(plan, (_sym, _de, refs) => {
      const geom = metrics.symbols[index++];
      // `metrics` came from this same document, so the shapes always agree; if they ever
      // don't, leave the symbol where it was saved rather than guess.
      if (!geom || geom.rel.length !== refs.length) return false;
      const placed = this._layoutSymbol(geom, pivot, a, cos, sin, this._spread, k);
      refs.forEach((ref, i) => {
        const ll = mercToLonLat(placed[i].x, placed[i].y);
        ref.x = ll.x;
        ref.y = ll.y;
        bounds.xmin = Math.min(bounds.xmin, placed[i].x);
        bounds.ymin = Math.min(bounds.ymin, placed[i].y);
        bounds.xmax = Math.max(bounds.xmax, placed[i].x);
        bounds.ymax = Math.max(bounds.ymax, placed[i].y);
      });
      return true;
    });

    return { plan, bounds };
  }

  /**
   * Visit every live symbol that has geometry. `refs` are the symbol's own point
   * objects inside the parsed `drawEss`, so a callback can read or move them in
   * place; returning true writes the edited `drawEss` back onto the symbol.
   */
  private _eachSymbolGeometry(
    planDoc: any,
    visit: (sym: any, de: any, refs: { x: any; y: any }[]) => boolean | void,
  ): void {
    try {
      for (const overlay of planDoc?.poObj?.plnOrdrOverlay ?? []) {
        for (const sym of overlay?.plnOrdrSymbolSet ?? []) {
          if (sym.isDelete === 'Y') continue;
          try {
            const de = JSON.parse(sym.drawEss);
            const refs = this._collectPointRefs(de);
            if (refs.length === 0) continue;
            if (visit(sym, de, refs) === true) sym.drawEss = JSON.stringify(de);
          } catch { /* skip symbol with malformed drawEss JSON */ }
        }
      }
    } catch { /* malformed plan doc — use whatever was visited */ }
  }

  private _collectPointRefs(de: any): { x: any; y: any }[] {
    const refs: { x: any; y: any }[] = [];
    const add = (p: any) => {
      if (p?.x != null && p?.y != null) refs.push(p);
    };
    add(de.GEOM ?? de.geom);
    add(de.OPTIONS?.GEOM);
    if (Array.isArray(de.CTRL_PTS)) de.CTRL_PTS.forEach(add);
    if (de.BASE_LN_PTS) {
      add(de.BASE_LN_PTS.startPt);
      add(de.BASE_LN_PTS.midPt);
      add(de.BASE_LN_PTS.endPt);
    }
    return refs;
  }

  private _countPlanSymbols(planDoc: any): number {
    let n = 0;
    try {
      for (const overlay of planDoc?.poObj?.plnOrdrOverlay ?? [])
        for (const sym of overlay?.plnOrdrSymbolSet ?? [])
          if (sym.isDelete !== 'Y') n++;
    } catch { /* malformed plan doc — return the count so far */ }
    return n;
  }

  private _getSelectedPlanMetrics(): PlanMetrics {
    if (!this._selectedPlanMetrics) {
      this._selectedPlanMetrics = this._buildPlanMetrics(this._selectedPlanData);
    }
    return this._selectedPlanMetrics;
  }

  private _buildPlanMetrics(planDoc: any): PlanMetrics {
    const raw: { id: string; label: string; kind: string; sidc?: string; pts: XY[] }[] = [];
    this._eachSymbolGeometry(planDoc, (sym, de, refs) => {
      const desig = String(de.AMPLIFIER?.UNIQUE_DESIG ?? '').trim();
      const name = String(de.SYM_NAME ?? '').trim();
      raw.push({
        id: String(sym?.plnOrdrSymbolPK?.plnOrdrSymbolId ?? ''),
        label: desig && name ? `${desig} · ${name}` : desig || name || 'Unit',
        kind: String(de.SYM_GEO_TYPE ?? ''),
        sidc: de.AMPLIFIER?.SIDC ?? de.SIDC,
        pts: refs.map((r) => lonLatToMerc(Number(r.x), Number(r.y))),
      });
    });

    // Converted exercise templates are authored around the placement area's centre, not
    // around wherever their symbols happen to cluster, so they name their own origin.
    const origin = planDoc?.pamsOrigin;
    const centroid = origin ? lonLatToMerc(Number(origin.x), Number(origin.y)) : meanXY(raw.flatMap((r) => r.pts));
    const symbols: PlanSymbolGeom[] = raw.map((r) => {
      const c = meanXY(r.pts);
      const rel = r.pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
      return {
        id: r.id,
        label: r.label,
        kind: r.kind,
        sidc: r.sidc,
        centroid: c,
        rel,
        reach: rel.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.y)), 0),
      };
    });

    return { symbolCount: this._countPlanSymbols(planDoc), centroid, symbols };
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private _removePointerHandles(): void {
    if (this._ghostRafId !== null) {
      cancelAnimationFrame(this._ghostRafId);
      this._ghostRafId = null;
    }
    if (this._pointerMoveHandle) {
      this._pointerMoveHandle.remove();
      this._pointerMoveHandle = null;
    }
    if (this._pointerDownHandle) {
      this._pointerDownHandle.remove();
      this._pointerDownHandle = null;
    }
    if (this._rightClickHandle) {
      this._rightClickHandle.remove();
      this._rightClickHandle = null;
    }
    if (this._keyDownHandler) {
      document.removeEventListener('keydown', this._keyDownHandler);
      this._keyDownHandler = null;
    }
    // Note: _bgClickHandle is intentionally NOT removed here — it is persistent
  }

  private _removeBgClickHandle(): void {
    if (this._bgClickHandle) {
      this._bgClickHandle.remove();
      this._bgClickHandle = null;
    }
  }

  private _removeBgPopup(): void {
    if (this._bgPopup) {
      this._bgPopup.remove();
      this._bgPopup = null;
    }
  }

  private _getViewContainer(): HTMLElement | null {
    const container = this._view?.container;
    if (!container) return null;
    if (typeof container === 'string') {
      return document.getElementById(container);
    }
    return container as HTMLElement;
  }

  /**
   * Keep the collapsed disclosure's summary honest — otherwise a tuned
   * placement is invisible while the group is shut.
   */
  private _syncOptionsMeta(): void {
    const meta = this._widget?.querySelector<HTMLElement>('.db-form-meta');
    if (!meta) return;
    const parts = [this._rotate ? 'Rotate' : 'As drawn', `${Math.round(this._spread * 100)}%`];
    if (this._pivotId) parts.push('pivot');
    if (this._keepPlacing) parts.push('repeat');
    meta.textContent = parts.join(' · ');
  }

  /** The Cancel button only means anything mid-placement. */
  private _showCancel(on: boolean): void {
    const row = this._widget?.querySelector<HTMLElement>('.db-cancel-row');
    if (row) row.hidden = !on;
  }

  private _setStatus(msg: string): void {
    const el = this._widget?.querySelector('.db-status') as HTMLElement | null;
    if (el) el.textContent = msg;
  }

  private _setHeaderState(state: '' | 'ready' | 'running' | 'warning', label: string): void {
    if (!this._widget) return;
    const dot = this._widget.querySelector('#db-status-dot') as HTMLElement | null;
    const lbl = this._widget.querySelector('#db-status-lbl') as HTMLElement | null;
    if (dot) {
      dot.classList.remove('ready', 'running', 'warning');
      if (state) dot.classList.add(state);
    }
    if (lbl) lbl.textContent = label;
  }
}

export default DeploymentBuilderEngine;
