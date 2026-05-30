import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';

import SerializationEngine from '../ImportExport/SerializationEngine';
import Plan from '../ImportExport/Plan.ts';
import EngineLogger from '../../Support/EngineLogger';

// ── Formation slot offsets (lateral, forward) ────────────────────────────────
const FORMATIONS: Record<string, [number, number][] | null> = {
  'as-is':    null,
  'line':     [[-2,0],[-1,0],[0,0],[1,0],[2,0]],
  'column':   [[0,0],[0,-1],[0,-2],[0,-3],[0,-4]],
  'wedge':    [[0,0],[-1,-1],[1,-1],[-2,-2],[2,-2]],
  'echelonR': [[0,0],[1,-1],[2,-2],[3,-3],[4,-4]],
  'echelonL': [[0,0],[-1,-1],[-2,-2],[-3,-3],[-4,-4]],
  'vee':      [[0,0],[-1.5,1],[1.5,1],[-3,1.8],[3,1.8]],
};

// ── Formation chip metadata ──────────────────────────────────────────────────
// SVG icons render in a 24×24 viewBox, top = "forward / bearing direction".
// Filled with currentColor so chips pick up the theme accent when active.
const FORMATION_META: Array<{ key: string; label: string; svg: string; hint: string }> = [
  {
    key: 'as-is',
    label: 'As-Is',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="7" r="1.5"/><circle cx="13" cy="5" r="1.5"/><circle cx="18" cy="10" r="1.5"/><circle cx="9" cy="14" r="1.5"/><circle cx="16" cy="17" r="1.5"/></svg>',
    hint: 'Symbols keep their saved layout around the anchor. Spacing adds extra radial separation; 0 keeps the original plan exactly.',
  },
  {
    key: 'line',
    label: 'Line',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="3" cy="12" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="13" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/><circle cx="22" cy="12" r="1.5"/></svg>',
    hint: 'Side-by-side along the bearing. Spacing controls the gap between each unit.',
  },
  {
    key: 'column',
    label: 'Column',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="3" r="1.5"/><circle cx="12" cy="8" r="1.5"/><circle cx="12" cy="13" r="1.5"/><circle cx="12" cy="18" r="1.5"/><circle cx="12" cy="22" r="1.5"/></svg>',
    hint: 'One behind the other along the bearing. Spacing controls the gap between each unit.',
  },
  {
    key: 'wedge',
    label: 'Wedge',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="4" r="1.5"/><circle cx="7" cy="11" r="1.5"/><circle cx="17" cy="11" r="1.5"/><circle cx="3" cy="18" r="1.5"/><circle cx="21" cy="18" r="1.5"/></svg>',
    hint: 'Lead at the anchor, flanks fan behind. Spacing controls how far apart the units sit.',
  },
  {
    key: 'vee',
    label: 'Vee',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="20" r="1.5"/><circle cx="7" cy="13" r="1.5"/><circle cx="17" cy="13" r="1.5"/><circle cx="3" cy="6" r="1.5"/><circle cx="21" cy="6" r="1.5"/></svg>',
    hint: 'Lead at the anchor, arms fan toward the front. Spacing controls the spread of the arms.',
  },
  {
    key: 'echelonR',
    label: 'Ech R',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="3" cy="5" r="1.5"/><circle cx="8" cy="9" r="1.5"/><circle cx="13" cy="13" r="1.5"/><circle cx="18" cy="17" r="1.5"/><circle cx="22" cy="21" r="1.5"/></svg>',
    hint: 'Step diagonally to the right and rear. Spacing controls the step distance.',
  },
  {
    key: 'echelonL',
    label: 'Ech L',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="21" cy="5" r="1.5"/><circle cx="16" cy="9" r="1.5"/><circle cx="11" cy="13" r="1.5"/><circle cx="6" cy="17" r="1.5"/><circle cx="2" cy="21" r="1.5"/></svg>',
    hint: 'Step diagonally to the left and rear. Spacing controls the step distance.',
  },
];

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

interface PlanEntry {
  id: string;
  name: string;
  category: string;
  file: string;
  description: string;
}

interface PlanMetrics {
  symbolCount: number;
  points: { x: number; y: number }[];
  symbolCentroids: { x: number; y: number }[];
  centroid: { x: number; y: number };
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
  private _formationType: string = 'as-is';
  private _spacingMeters: number = 0;

  // Event handles
  private _pointerMoveHandle: any = null;
  private _pointerDownHandle: any = null;  // placement click handler
  private _bgClickHandle: any = null;       // background right-click handler (persistent)
  private _rightClickHandle: any = null;    // bearing-phase right-click to reset anchor
  private _keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

  // RAF throttle for ghost-preview redraws
  private _ghostRafId: number | null = null;
  private _pendingGhostBearing: number = 0;
  private _pendingGhostCursor: Point | null = null;

  // Placement overlay UI
  private _bearingHUD: HTMLElement | null = null;
  private _placementInstructions: HTMLElement | null = null;

  // Background right-click popup
  private _bgPopup: HTMLElement | null = null;

  // Registry cache
  private _registry: PlanEntry[] | null = null;
  private _registryBaseUrl: string = '';

  // Widget state
  private _minimized: boolean = false;
  private _searchText: string = '';
  private _collapsedCategories: Set<string> = new Set();
  private _widgetHeight: string = '430px';

  private constructor() {}

  public static getInstance(): DeploymentBuilderEngine {
    if (!DeploymentBuilderEngine._instance) {
      DeploymentBuilderEngine._instance = new DeploymentBuilderEngine();
    }
    return DeploymentBuilderEngine._instance;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public start(view: MapView | SceneView, serialEngine: SerializationEngine): void {
    this._view = view;
    this._serializationEngine = serialEngine;
    this._ghostLayer = new GraphicsLayer({ listMode: 'hide' });
    view.map.add(this._ghostLayer);
    this._registryBaseUrl = this._resolveRegistryBase();
    EngineLogger.success(ENGINE_NAME, 'DeploymentBuilderEngine started');
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._cancelPlacement();
    if (this._ghostLayer) {
      if (this._view?.map) this._view.map.remove(this._ghostLayer);
    }
    this._view = view;
    this._ghostLayer = new GraphicsLayer({ listMode: 'hide' });
    view.map.add(this._ghostLayer);
    this._removePointerHandles();
    this._removeBgPopup();
    this._registryBaseUrl = this._resolveRegistryBase();
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
    if (minBtn) minBtn.textContent = this._minimized ? '▶' : '▼';
    this._widget.classList.toggle('db-minimized', this._minimized);
    this._widget.style.height = this._minimized ? 'auto' : this._widgetHeight;
  }

  private _buildWidget(): void {
    this._injectWidgetStyles();

    const el = document.createElement('div');
    el.id = 'deploymentBuilderWidget';
    el.className = 'ms-panel ms-theme-ops-dark ms-visible';
    el.setAttribute('data-engine', 'deployment-builder');

    const chips = FORMATION_META.map((f) => `
      <button class="db-chip${f.key === this._formationType ? ' active' : ''}" data-form="${f.key}" title="${f.hint}">
        <span class="db-chip-icon">${f.svg}</span>
        <span class="db-chip-label">${f.label}</span>
      </button>
    `).join('');

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
          <p>Drop pre-built tactical plans onto the map at a chosen anchor and bearing. Spacing controls unit separation in every formation.</p>
          <p><strong style="color:var(--ms-accent)">Workflow</strong></p>
          <ol>
            <li>Pick a plan from the list on the left.</li>
            <li>Pick a formation and spacing on the right.</li>
            <li>Click <strong>Place on Map</strong>, then click the map to set anchor.</li>
            <li>Move the cursor and click again to set bearing. As-Is skips this step.</li>
          </ol>
          <p><strong style="color:var(--ms-accent)">Formations</strong></p>
          <ul style="list-style:none;padding:0;margin:0 0 9px">
            <li><strong>As-Is</strong> — keep the plan's original layout</li>
            <li><strong>Line / Column</strong> — across or along the bearing</li>
            <li><strong>Wedge</strong> — lead at anchor, flanks behind</li>
            <li><strong>Vee</strong> — lead at anchor, arms toward the front</li>
            <li><strong>Ech R / Ech L</strong> — diagonal steps to right or left rear</li>
          </ul>
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

          <!-- Right: configure & place -->
          <div class="db-right">
            <div class="ms-section-title">Formation</div>
            <div class="db-chip-grid">${chips}</div>
            <div class="ms-hint db-form-hint"></div>

            <div class="ms-section-title">Spacing</div>
            <div class="db-spacing-row">
              <input class="ms-input db-spacing-val" type="number" value="0" min="0" step="1" />
              <select class="ms-select db-spacing-unit">
                <option value="m">m</option>
                <option value="km">km</option>
                <option value="mi">mi</option>
                <option value="nm">nm</option>
              </select>
            </div>

            <div class="ms-divider"></div>

            <div class="ms-section-title">Selected Plan</div>
            <div class="db-plan-summary">
              <div class="db-plan-name empty">No plan selected</div>
              <div class="db-plan-desc"></div>
              <div class="ms-info-grid">
                <div class="ms-info-item">
                  <div class="ms-info-label">Symbols</div>
                  <div class="ms-info-value db-plan-syms">—</div>
                </div>
                <div class="ms-info-item">
                  <div class="ms-info-label">Category</div>
                  <div class="ms-info-value db-plan-cat">—</div>
                </div>
              </div>
            </div>

            <div class="ms-hint db-status"></div>

            <div class="ms-btn-row">
              <button class="ms-btn danger db-btn-cancel">Cancel</button>
              <button class="ms-btn primary db-btn-place" disabled>Place on Map ↗</button>
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
      document.addEventListener('click', (e) => {
        if (helpPop.hidden) return;
        if (!helpPop.contains(e.target as Node) && e.target !== helpBtn) {
          helpPop.hidden = true;
        }
      });
    }

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

    // Formation chips
    const chipGrid = el.querySelector('.db-chip-grid') as HTMLElement;
    const formHint = el.querySelector('.db-form-hint') as HTMLElement;

    const syncFormationUI = (key: string) => {
      this._formationType = key;
      const meta = FORMATION_META.find((f) => f.key === key);
      formHint.textContent = meta?.hint ?? '';
      chipGrid.querySelectorAll<HTMLElement>('.db-chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.form === key);
      });
    };
    chipGrid.querySelectorAll<HTMLElement>('.db-chip').forEach((chip) => {
      chip.addEventListener('click', () => syncFormationUI(chip.dataset.form ?? 'as-is'));
    });
    syncFormationUI(this._formationType);

    // Spacing: numeric input + unit select
    const spacingValEl = el.querySelector('.db-spacing-val') as HTMLInputElement;
    const spacingUnitEl = el.querySelector('.db-spacing-unit') as HTMLSelectElement;
    const UNIT_TO_M: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, nm: 1852 };

    const updateSpacing = () => {
      const val = parseFloat(spacingValEl.value) || 0;
      this._spacingMeters = val * (UNIT_TO_M[spacingUnitEl.value] ?? 1);
    };
    spacingValEl.addEventListener('input', updateSpacing);
    spacingUnitEl.addEventListener('change', updateSpacing);

    // Place / Cancel
    el.querySelector('.db-btn-place')!.addEventListener('click', () => this._onPlaceClicked());
    el.querySelector('.db-btn-cancel')!.addEventListener('click', () => this._cancelPlacement());
  }

  private _injectWidgetStyles(): void {
    if (document.getElementById('db-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'db-widget-styles';
    style.textContent = `
      /* Override ms-panel defaults — wider for two-column layout, custom position */
      #deploymentBuilderWidget {
        top: 110px; left: 60px;
        width: 560px; height: 500px;
        min-width: 440px; min-height: 320px;
        max-width: 90vw; max-height: 90vh;
        z-index: 1200;
        overflow: visible;
      }
      #deploymentBuilderWidget.db-minimized .db-resize-handle { display: none; }

      /* Body becomes a row-flex container; columns scroll independently */
      #deploymentBuilderWidget .ms-body {
        padding: 0; overflow: hidden; min-height: 0;
        display: flex; flex-direction: column;
      }
      #deploymentBuilderWidget .db-cols {
        display: flex; flex: 1; min-height: 0; overflow: hidden;
      }

      /* Left column: plan picker */
      #deploymentBuilderWidget .db-left {
        width: 232px; flex-shrink: 0;
        border-right: 1px solid var(--ms-divider);
        display: flex; flex-direction: column; min-width: 0;
      }
      #deploymentBuilderWidget .db-toolbar {
        padding: 9px 10px;
        border-bottom: 1px solid var(--ms-divider);
        display: flex; flex-direction: column; gap: 6px;
      }
      #deploymentBuilderWidget .db-toolbar .ms-input { padding: 6px 8px; }
      #deploymentBuilderWidget .db-toolbar .ms-btn  { padding: 6px 8px; }
      #deploymentBuilderWidget .db-plan-list {
        flex: 1; overflow-y: auto; padding: 4px 0;
      }
      #deploymentBuilderWidget .db-category-header {
        padding: 9px 12px 4px;
        font-size: var(--ms-fs-xs); font-weight: 700;
        color: var(--ms-text-label);
        text-transform: uppercase; letter-spacing: 0.1em;
        cursor: pointer; user-select: none;
        display: flex; align-items: center; gap: 6px;
        transition: var(--ms-transition);
      }
      #deploymentBuilderWidget .db-category-header:hover { color: var(--ms-accent); }
      #deploymentBuilderWidget .db-category-header .db-caret {
        font-size: 8px; transition: transform 0.15s; opacity: 0.7;
      }
      #deploymentBuilderWidget .db-category-header.collapsed .db-caret {
        transform: rotate(-90deg);
      }
      #deploymentBuilderWidget .db-plan-item {
        padding: 6px 12px 6px 18px;
        font-size: var(--ms-fs);
        color: var(--ms-text-dim);
        cursor: pointer;
        transition: var(--ms-transition);
        border-left: 2px solid transparent;
      }
      #deploymentBuilderWidget .db-plan-item:hover {
        background: rgba(239, 159, 39, 0.06);
        color: var(--ms-text);
      }
      #deploymentBuilderWidget .db-plan-item.active {
        background: rgba(239, 159, 39, 0.14);
        color: var(--ms-text);
        border-left-color: var(--ms-accent);
      }
      #deploymentBuilderWidget .db-list-loading,
      #deploymentBuilderWidget .db-list-empty {
        padding: 14px 12px;
        color: var(--ms-text-dim);
        font-size: var(--ms-fs-xs);
        font-style: italic;
        text-align: center;
      }

      /* Right column: configure */
      #deploymentBuilderWidget .db-right {
        flex: 1; min-width: 0;
        display: flex; flex-direction: column;
        overflow-y: auto;
      }
      #deploymentBuilderWidget .db-right .ms-section-title:first-child { padding-top: 9px; }

      /* Formation chip grid */
      #deploymentBuilderWidget .db-chip-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        padding: 0 12px 4px;
      }
      #deploymentBuilderWidget .db-chip {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 7px 4px 5px;
        background: var(--ms-bg-input);
        border: 1px solid var(--ms-border);
        border-radius: var(--ms-radius-sm);
        color: var(--ms-text-dim);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--ms-fs-xs);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 600;
        transition: var(--ms-transition);
        min-width: 0;
      }
      #deploymentBuilderWidget .db-chip-icon {
        display: flex; align-items: center; justify-content: center;
        opacity: 0.7; transition: opacity var(--ms-transition);
      }
      #deploymentBuilderWidget .db-chip-icon svg {
        width: 26px; height: 26px;
      }
      #deploymentBuilderWidget .db-chip:hover {
        border-color: var(--ms-accent); color: var(--ms-text);
      }
      #deploymentBuilderWidget .db-chip:hover .db-chip-icon { opacity: 1; }
      #deploymentBuilderWidget .db-chip:active { transform: scale(0.97); }
      #deploymentBuilderWidget .db-chip.active {
        border-color: var(--ms-accent);
        background: rgba(239, 159, 39, 0.14);
        color: var(--ms-accent);
      }
      #deploymentBuilderWidget .db-chip.active .db-chip-icon { opacity: 1; }

      /* Spacing row */
      #deploymentBuilderWidget .db-spacing-row {
        display: flex; gap: 6px; padding: 0 12px 6px;
        align-items: center;
      }
      #deploymentBuilderWidget .db-spacing-row .ms-input {
        flex: 1; padding: 5px 8px;
      }
      #deploymentBuilderWidget .db-spacing-row .ms-select {
        width: 64px; flex-shrink: 0; padding: 5px 6px;
      }

      /* Plan summary */
      #deploymentBuilderWidget .db-plan-summary {
        padding: 2px 12px 4px;
      }
      #deploymentBuilderWidget .db-plan-name {
        font-size: var(--ms-fs-sm);
        color: var(--ms-text);
        font-weight: 700;
        margin-bottom: 3px;
      }
      #deploymentBuilderWidget .db-plan-name.empty {
        color: var(--ms-text-label);
        font-weight: 500; font-style: italic;
      }
      #deploymentBuilderWidget .db-plan-desc {
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        line-height: 1.4;
        margin-bottom: 6px;
        min-height: 18px;
      }
      #deploymentBuilderWidget .db-plan-summary .ms-info-grid {
        padding: 4px 0 0;
      }

      /* Status / action row */
      #deploymentBuilderWidget .db-status:empty { display: none; }
      #deploymentBuilderWidget .ms-btn-row { padding: 6px 12px 12px; gap: 6px; }
      #deploymentBuilderWidget .db-btn-place { flex: 2; }
      #deploymentBuilderWidget .db-btn-cancel { flex: 1; }

      /* Resize handles */
      #deploymentBuilderWidget .db-resize-handle {
        position: absolute;
        z-index: 20;
        border-radius: 3px;
        transition: background 0.15s;
      }
      #deploymentBuilderWidget .db-resize-handle:hover,
      #deploymentBuilderWidget .db-resize-handle:active {
        background: rgba(239, 159, 39, 0.18);
      }
      #deploymentBuilderWidget .db-resize-e {
        top: 8px; right: -4px; bottom: 8px; width: 8px; cursor: ew-resize;
      }
      #deploymentBuilderWidget .db-resize-s {
        bottom: -4px; left: 8px; right: 8px; height: 8px; cursor: ns-resize;
      }
      #deploymentBuilderWidget .db-resize-se {
        bottom: -4px; right: -4px; width: 14px; height: 14px; cursor: se-resize;
      }
      #deploymentBuilderWidget .db-resize-se::after {
        content: '';
        position: absolute;
        bottom: 4px; right: 4px;
        width: 7px; height: 7px;
        border-right: 2px solid var(--ms-accent);
        border-bottom: 2px solid var(--ms-accent);
        border-radius: 1px;
        opacity: 0.55;
      }
    `;
    document.head.appendChild(style);
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

  private _resolveRegistryBase(): string {
    return '/MS/Data/Deployments/';
  }

  private async _loadRegistry(): Promise<PlanEntry[]> {
    if (this._registry) return this._registry;
    try {
      const url = this._registryBaseUrl + 'Deployemets.json';
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this._registry = data.plans ?? [];
      return this._registry!;
    } catch (err) {
      EngineLogger.error(ENGINE_NAME, `Failed to load plan registry: ${err}`);
      return [];
    }
  }

  private async _loadPlanFile(relativePath: string): Promise<any> {
    try {
      const url = this._registryBaseUrl + relativePath;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      EngineLogger.error(ENGINE_NAME, `Failed to load plan file "${relativePath}": ${err}`);
      return null;
    }
  }

  private async _loadRegistryIntoWidget(): Promise<void> {
    const list = this._widget?.querySelector('.db-plan-list') as HTMLElement | null;
    if (list) list.innerHTML = '<div class="db-list-loading">Loading plans…</div>';
    const plans = await this._loadRegistry();
    console.log('[DeploymentBuilder] Registry loaded:', plans.length, 'plans from', this._registryBaseUrl + 'Deployemets.json');
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
      empty.textContent = this._searchText ? 'No matching plans' : 'No plans available';
      list.appendChild(empty);
      return;
    }

    Object.keys(grouped).forEach((cat) => {
      const isCollapsed = this._collapsedCategories.has(cat);
      const header = document.createElement('div');
      header.className = 'db-category-header' + (isCollapsed ? ' collapsed' : '');
      const label = CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
      header.innerHTML = `<span class="db-caret">▼</span><span>${label}</span>`;
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
  }

  private async _selectPlan(plan: PlanEntry): Promise<void> {
    this._selectedPlanEntry = plan;
    this._selectedPlanData = null;
    this._selectedPlanMetrics = null;

    this._applySelectedPlanToUI('loading');
    this._renderPlanList();

    const data = await this._loadPlanFile(plan.file);
    if (!data) {
      this._applySelectedPlanToUI('failed');
      return;
    }
    this._selectedPlanData = data;
    this._selectedPlanMetrics = this._buildPlanMetrics(data);
    this._applySelectedPlanToUI('ready');
  }

  // ── Placement Flow ─────────────────────────────────────────────────────────

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
          const parsed = JSON.parse(evt.target?.result as string);
          if (!Plan.isPlanDocument(parsed)) {
            this._setStatus('Selected file is not a valid Save Plan JSON');
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

    this._applySelectedPlanToUI('ready');
    this._renderPlanList();
  }

  private _onPlaceClicked(): void {
    if (!this._selectedPlanData) return;
    this._setStatus('Click on map to set anchor point…');
    this._setHeaderState('running', 'Anchor');
    this._startPlacement(this._selectedPlanData);
    // Minimize widget so it doesn't block the map
    if (!this._minimized) this._minimizeWidget();
  }

  private _startPlacement(_planData: any): void {
    if (!this._view) return;
    this._phase = 'anchor';
    this._clearGhostGraphics();
    this._removePointerHandles();

    const container = this._getViewContainer();
    if (container) container.style.cursor = 'none';

    // Live crosshair follows cursor during anchor phase (RAF-throttled)
    this._pointerMoveHandle = this._view.on('pointer-move', (evt) => {
      if (this._phase !== 'anchor') return;
      const mapPt = this._view!.toMap({ x: evt.x, y: evt.y });
      if (!mapPt) return;
      this._pendingGhostCursor = mapPt;
      if (this._ghostRafId === null) {
        this._ghostRafId = requestAnimationFrame(() => {
          this._ghostRafId = null;
          if (this._pendingGhostCursor) this._updateAnchorHover(this._pendingGhostCursor);
        });
      }
    });

    this._pointerDownHandle = this._view.on('click', (evt) => {
      if (this._phase === 'anchor') {
        const pt = evt.mapPoint;
        if (!pt) return;
        this._anchorPoint = pt;
        if (this._pointerMoveHandle) { this._pointerMoveHandle.remove(); this._pointerMoveHandle = null; }
        if (this._formationType === 'as-is') {
          // Bearing is irrelevant for As-Is — commit immediately
          this._commitFormation(0);
        } else {
          this._startBearingPhase(pt);
        }
      } else if (this._phase === 'bearing') {
        const bearing = this._computeBearing(this._anchorPoint!, evt.mapPoint);
        this._commitFormation(bearing);
      }
    });

    this._keyDownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this._cancelPlacement();
    };
    document.addEventListener('keydown', this._keyDownHandler);

    this._showPlacementInstructions(this._formationType === 'as-is' ? 'anchor-asIs' : 'anchor');
    this._setStatus(this._formationType === 'as-is'
      ? 'Click on map to place — no bearing needed for As-Is'
      : 'Click on map to set anchor point…');
  }

  private _startBearingPhase(anchor: Point): void {
    if (!this._view) return;
    this._phase = 'bearing';
    this._showPlacementInstructions('bearing');
    this._setStatus('Move cursor to set bearing — click to place');
    this._setHeaderState('running', 'Bearing');

    this._pointerMoveHandle = this._view.on('pointer-move', (evt) => {
      const mapPt = this._view!.toMap({ x: evt.x, y: evt.y });
      if (!mapPt) return;
      const bearing = this._computeBearing(anchor, mapPt);
      const bearingDeg = this._radiansToDegrees(bearing);
      // HUD and status are lightweight — update immediately for responsive feel
      this._showBearingHUD(evt.x, evt.y, bearingDeg);
      this._setStatus(`Bearing: ${Math.round(bearingDeg).toString().padStart(3, '0')}° ${this._bearingToCardinal(bearingDeg)} — click to place`);
      // Ghost redraw is expensive — throttle to one frame at a time
      this._pendingGhostBearing = bearing;
      this._pendingGhostCursor = mapPt;
      if (this._ghostRafId === null) {
        this._ghostRafId = requestAnimationFrame(() => {
          this._ghostRafId = null;
          this._updateGhostPreview(this._pendingGhostBearing, this._pendingGhostCursor ?? undefined);
        });
      }
    });

    // Right-click during bearing phase resets to anchor selection
    this._rightClickHandle = this._view.on('pointer-down', (evt) => {
      if (evt.button !== 2) return;
      this._phase = 'anchor';
      this._anchorPoint = null;
      this._clearGhostGraphics();
      this._removeBearingHUD();
      if (this._pointerMoveHandle) { this._pointerMoveHandle.remove(); this._pointerMoveHandle = null; }
      if (this._rightClickHandle) { this._rightClickHandle.remove(); this._rightClickHandle = null; }
      this._showPlacementInstructions('anchor');
      this._setStatus('Click on map to set anchor point…');
      this._setHeaderState('running', 'Anchor');
      this._pointerMoveHandle = this._view!.on('pointer-move', (evt2) => {
        if (this._phase !== 'anchor') return;
        const mapPt = this._view!.toMap({ x: evt2.x, y: evt2.y });
        if (!mapPt) return;
        this._pendingGhostCursor = mapPt;
        if (this._ghostRafId === null) {
          this._ghostRafId = requestAnimationFrame(() => {
            this._ghostRafId = null;
            if (this._pendingGhostCursor) this._updateAnchorHover(this._pendingGhostCursor);
          });
        }
      });
    });
  }

  private _commitFormation(bearing: number): void {
    if (!this._anchorPoint || !this._selectedPlanData || !this._serializationEngine) return;
    this._phase = 'idle';
    this._clearGhostGraphics();
    this._removePointerHandles();
    const container = this._getViewContainer();
    if (container) container.style.cursor = '';
    this._removeBearingHUD();
    this._removePlacementInstructions();

    const formSlots = FORMATIONS[this._formationType];
    const anchor = this._anchorPoint;

    let count: number;
    if (formSlots === null) {
      // As-Is: apply a single uniform offset (anchor − plan centroid) to every point.
      // Because it's the same delta for all points, each symbol's shape is preserved.
      const asIsPlan = this._applyAsIsSpacingToPlan(anchor);
      count = this._serializationEngine.loadPlanSymbolsFromData(asIsPlan);
    } else {
      // Formation: each symbol gets its own slot.  Pre-process the whole plan so that
      // every symbol's centroid moves to its assigned slot while its internal shape is kept.
      const formationPlan = this._applyFormationToPlan(bearing);
      count = this._serializationEngine.loadPlanSymbolsFromData(formationPlan);
    }

    if (count > 0) {
      EngineLogger.success(ENGINE_NAME, `Placed ${count} symbols from "${this._selectedPlanEntry?.name}"`);
    }

    this._setStatus(`Placed ${count} symbol${count !== 1 ? 's' : ''}`);
    this._setHeaderState(count > 0 ? 'ready' : 'warning', count > 0 ? 'Placed' : 'Empty');
    // Restore widget
    if (this._minimized) this._minimizeWidget();
  }

  private _cancelPlacement(): void {
    this._phase = 'idle';
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
  }

  // ── Ghost Preview ──────────────────────────────────────────────────────────

  private _updateAnchorHover(mapPt: Point): void {
    if (!this._ghostLayer) return;
    this._clearGhostGraphics();
    // Outer ring
    this._ghostLayer.add(new Graphic({
      geometry: mapPt,
      symbol: new SimpleMarkerSymbol({
        style: 'circle', size: 28,
        color: [0, 0, 0, 0],
        outline: { color: [255, 0, 0, 0.7], width: 2 },
      }),
    }));
    // Inner ring
    this._ghostLayer.add(new Graphic({
      geometry: mapPt,
      symbol: new SimpleMarkerSymbol({
        style: 'circle', size: 16,
        color: [0, 0, 0, 0],
        outline: { color: [255, 0, 0, 0.7], width: 2 },
      }),
    }));
    // Cross hair
    this._ghostLayer.add(new Graphic({
      geometry: mapPt,
      symbol: new SimpleMarkerSymbol({
        style: 'cross', size: 22,
        color: [100, 200, 255, 1],
        outline: { color: [255, 0, 0, 7], width: 2 },
      }),
    }));

    if (this._selectedPlanData && this._formationType === 'as-is') {
      this._getAsIsGhostProjectedPoints(mapPt).forEach((pt) => this._addGhostDot(pt));
    }
  }

  private _updateGhostPreview(bearing: number, cursorPt?: Point): void {
    if (!this._ghostLayer || !this._anchorPoint || !this._selectedPlanData) return;
    this._clearGhostGraphics();

    const bearingDeg = this._radiansToDegrees(bearing);
    const formSlots = FORMATIONS[this._formationType];
    const anchor = this._anchorPoint;

    if (formSlots === null) {
      this._getAsIsGhostProjectedPoints(anchor).forEach((pt) => this._addGhostDot(pt));
    } else {
      // Pre-compute once — avoids per-slot calls to _toProjected, _isProjected, and Math.cos/sin
      const anchorProj = this._toProjected(anchor);
      const isProj = this._isProjected();
      const mpLat = 111320;
      const mpLon = isProj ? 1 : 111320 * Math.cos((anchorProj.y * Math.PI) / 180);
      const cosB = Math.cos(bearing);
      const sinB = Math.sin(bearing);
      const spacingM = this._spacingMeters;

      const symCount = this._getSelectedPlanMetrics().symbolCount;
      for (let i = 0; i < symCount; i++) {
        const slot = formSlots[i % formSlots.length] ?? [0, 0];
        const eM = (slot[0] * cosB + slot[1] * sinB) * spacingM;
        const nM = (-slot[0] * sinB + slot[1] * cosB) * spacingM;
        this._addGhostDot(isProj
          ? { x: anchorProj.x + eM, y: anchorProj.y + nM }
          : { x: anchorProj.x + eM / mpLon, y: anchorProj.y + nM / mpLat });
      }
    }

    // Anchor indicator: concentric rings + cross
    this._ghostLayer.add(new Graphic({
      geometry: anchor,
      symbol: new SimpleMarkerSymbol({
        style: 'circle', size: 34,
        color: [0, 0, 0, 0],
        outline: { color: [255, 220, 60, 0.3], width: 1 },
      }),
    }));
    this._ghostLayer.add(new Graphic({
      geometry: anchor,
      symbol: new SimpleMarkerSymbol({
        style: 'circle', size: 20,
        color: [0, 0, 0, 0],
        outline: { color: [255, 220, 60, 0.6], width: 1.5 },
      }),
    }));
    this._ghostLayer.add(new Graphic({
      geometry: anchor,
      symbol: new SimpleMarkerSymbol({
        style: 'cross', size: 22,
        color: [255, 220, 60, 1],
        outline: { color: [255, 220, 60, 1], width: 2.5 },
      }),
    }));

    // Bearing arrow from anchor to cursor
    if (cursorPt) {
      const anchorWGS = this._pointToWGS84(anchor);
      const cursorWGS = this._pointToWGS84(cursorPt);
      const bearingLine = new Polyline({
        paths: [[[anchorWGS.x, anchorWGS.y], [cursorWGS.x, cursorWGS.y]]],
        spatialReference: { wkid: 4326 },
      });
      this._ghostLayer.add(new Graphic({
        geometry: bearingLine,
        symbol: new SimpleLineSymbol({
          color: [255, 200, 50, 0.8],
          width: 2,
          style: 'short-dash',
        }),
      }));
      // Arrowhead at cursor — triangle rotated to bearing direction
      this._ghostLayer.add(new Graphic({
        geometry: cursorPt,
        symbol: new SimpleMarkerSymbol({
          style: 'triangle',
          size: 14,
          color: [255, 200, 50, 0.9],
          outline: { color: [255, 230, 120, 1], width: 1.5 },
          angle: -bearingDeg, // ArcGIS CCW; negate to rotate CW from north
        }),
      }));
    }
  }

  private _clearGhostGraphics(): void {
    this._ghostLayer?.removeAll();
  }

  private _addGhostDot(projPt: { x: number; y: number }): void {
    if (!this._ghostLayer) return;
    const wgsPt = this._toWGS84(projPt.x, projPt.y);
    if (!wgsPt) return;
    this._ghostLayer.add(new Graphic({
      geometry: wgsPt,
      symbol: new SimpleMarkerSymbol({
        style: 'circle', size: 12,
        color: [100, 180, 255, 0.3],
        outline: { color: [100, 200, 255, 0.85], width: 1.5 },
      }),
    }));
  }

  private _getAsIsGhostProjectedPoints(anchor: Point): { x: number; y: number }[] {
    const metrics = this._getSelectedPlanMetrics();
    const anchorProj = this._toProjected(anchor);
    const spacingM = this._spacingMeters;

    return metrics.symbolCentroids.map((centroid) => {
      const relX = centroid.x - metrics.centroid.x;
      const relY = centroid.y - metrics.centroid.y;
      const len = Math.hypot(relX, relY);
      const extraX = len > 0 && spacingM > 0 ? (relX / len) * spacingM : 0;
      const extraY = len > 0 && spacingM > 0 ? (relY / len) * spacingM : 0;
      return {
        x: anchorProj.x + relX + extraX,
        y: anchorProj.y + relY + extraY,
      };
    });
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
        <span class="db-pi-step">As-Is placement</span>
        ${sep}
        <span>${key('Click')} to place at anchor — no bearing step</span>
        ${sep}
        <span>${key('Esc', 'danger')} cancel</span>
      `;
    } else if (phase === 'anchor') {
      this._placementInstructions.innerHTML = `
        <span class="db-pi-step">Step 1 of 2 — Anchor</span>
        ${sep}
        <span>${key('Click')} to set anchor point</span>
        ${sep}
        <span>${key('Esc', 'danger')} cancel</span>
      `;
    } else {
      this._placementInstructions.innerHTML = `
        <span class="db-pi-step">Step 2 of 2 — Bearing</span>
        ${sep}
        <span>${key('Click')} to place formation</span>
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
        background: rgba(14, 18, 28, 0.72);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        backdrop-filter: blur(10px) saturate(140%);
        border: 1px solid rgba(239, 159, 39, 0.55);
        border-radius: 7px;
        padding: 5px 12px 5px 10px;
        font-family: var(--ms-font-mono);
        font-size: var(--ms-fs-sm);
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      }
      .db-bearing-hud .db-bearing-kicker {
        color: rgba(180, 200, 230, 0.85);
        font-size: var(--ms-fs-xs);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-weight: 700;
      }
      .db-bearing-hud .db-bearing-deg {
        font-weight: 800;
        color: #ffffff;
        font-size: 14px;
        text-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
      }
      .db-bearing-hud .db-bearing-card {
        color: #80d8a0;
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
        background: rgba(14, 18, 28, 0.68);
        -webkit-backdrop-filter: blur(12px) saturate(140%);
        backdrop-filter: blur(12px) saturate(140%);
        border: 1px solid rgba(90, 140, 220, 0.4);
        border-radius: 9px;
        padding: 8px 20px;
        font-family: var(--ms-font);
        font-size: var(--ms-fs);
        color: rgba(200, 220, 240, 0.95);
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      }
      .db-placement-instructions .db-pi-step {
        color: #ffffff;
        font-weight: 700;
        text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
      }
      .db-placement-instructions .db-pi-sep {
        color: rgba(150, 170, 200, 0.4);
      }
      .db-placement-instructions .db-pi-key {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: var(--ms-radius-sm);
        padding: 1px 6px;
        font-size: var(--ms-fs-xs);
        font-family: inherit;
        font-weight: 600;
      }
      .db-placement-instructions .db-pi-key-accent  { color: #ffc46e; }
      .db-placement-instructions .db-pi-key-success { color: #90e8b0; }
      .db-placement-instructions .db-pi-key-danger  { color: #ff9090; }
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

  // ── Formation Math ─────────────────────────────────────────────────────────

  private _computeBearing(from: Point, to: Point): number {
    const fromWGS = this._pointToWGS84(from);
    const toWGS = this._pointToWGS84(to);
    const dLon = ((toWGS.x - fromWGS.x) * Math.PI) / 180;
    const lat1 = (fromWGS.y * Math.PI) / 180;
    const lat2 = (toWGS.y * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return Math.atan2(y, x); // radians, 0 = north, clockwise
  }

  private _computeFormationPoint(
    anchor: Point,
    lat: number,
    fwd: number,
    bearing: number,
    spacingM: number,
  ): { x: number; y: number } {
    const eastM = lat * Math.cos(bearing) + fwd * Math.sin(bearing);
    const northM = -lat * Math.sin(bearing) + fwd * Math.cos(bearing);
    return this._addMetersToPoint(anchor, eastM * spacingM, northM * spacingM);
  }

  private _offsetPoint(
    pt: { x: number; y: number },
    anchor: Point,
    centroid: { x: number; y: number },
  ): { x: number; y: number } {
    // pt is WGS84 (from _extractPlanPoints); project it to match centroid's space
    const ptProj = this._toProjected(new Point({ x: pt.x, y: pt.y, spatialReference: { wkid: 4326 } }));
    const anchorProj = this._toProjected(anchor);
    return {
      x: anchorProj.x + (ptProj.x - centroid.x),
      y: anchorProj.y + (ptProj.y - centroid.y),
    };
  }

  private _addMetersToPoint(anchor: Point, eastM: number, northM: number): { x: number; y: number } {
    const anchorProj = this._toProjected(anchor);
    if (this._isProjected()) {
      return { x: anchorProj.x + eastM, y: anchorProj.y + northM };
    }
    // Geographic: approximate degrees from meters
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos((anchorProj.y * Math.PI) / 180);
    return {
      x: anchorProj.x + eastM / metersPerDegLon,
      y: anchorProj.y + northM / metersPerDegLat,
    };
  }

  private _toProjected(pt: Point): { x: number; y: number } {
    if (pt.spatialReference?.wkid === 4326 || pt.spatialReference?.wkid === 4269) {
      // Geographic → Web Mercator
      try {
        const proj = webMercatorUtils.geographicToWebMercator(pt) as Point;
        return { x: proj.x, y: proj.y };
      } catch {
        return { x: pt.x, y: pt.y };
      }
    }
    if (pt.spatialReference?.wkid === 102100 || pt.spatialReference?.wkid === 3857) {
      return { x: pt.x, y: pt.y };
    }
    return { x: pt.x, y: pt.y };
  }

  private _pointToWGS84(pt: Point): { x: number; y: number } {
    if (pt.spatialReference?.wkid === 4326) return { x: pt.x, y: pt.y };
    try {
      const geo = webMercatorUtils.webMercatorToGeographic(pt) as Point;
      return { x: geo.x, y: geo.y };
    } catch {
      return { x: pt.longitude ?? pt.x, y: pt.latitude ?? pt.y };
    }
  }

  private _isProjected(): boolean {
    const wkid = this._view?.spatialReference?.wkid;
    return wkid === 102100 || wkid === 3857;
  }

  private _toWGS84(projX: number, projY: number): Point | null {
    try {
      const pt = new Point({ x: projX, y: projY, spatialReference: { wkid: 102100 } });
      return webMercatorUtils.webMercatorToGeographic(pt) as Point;
    } catch {
      return null;
    }
  }

  // ── Plan Helpers ───────────────────────────────────────────────────────────

  private _applyAsIsSpacingToPlan(anchor: Point): any {
    const plan = JSON.parse(JSON.stringify(this._selectedPlanData));
    const metrics = this._getSelectedPlanMetrics();
    const anchorProj = this._toProjected(anchor);
    const spacingM = this._spacingMeters;

    const shiftPt = (p: any, dx: number, dy: number): any => {
      if (!p || p.x == null || p.y == null) return p;
      const pp = this._toProjected(new Point({ x: p.x, y: p.y, spatialReference: { wkid: 4326 } }));
      const wgs = this._toWGS84(pp.x + dx, pp.y + dy);
      return wgs ? { ...p, x: wgs.x, y: wgs.y } : p;
    };

    for (const overlay of plan.poObj?.plnOrdrOverlay ?? []) {
      for (const sym of overlay.plnOrdrSymbolSet ?? []) {
        if (sym.isDelete === 'Y') continue;
        try {
          const de = JSON.parse(sym.drawEss);
          const pts: { x: number; y: number }[] = [];
          const push = (p: any) => {
            if (p?.x != null && p?.y != null) pts.push({ x: p.x, y: p.y });
          };

          push(de.GEOM ?? de.geom);
          push(de.OPTIONS?.GEOM);
          if (Array.isArray(de.CTRL_PTS)) de.CTRL_PTS.forEach(push);
          if (de.BASE_LN_PTS) {
            push(de.BASE_LN_PTS.startPt);
            push(de.BASE_LN_PTS.midPt);
            push(de.BASE_LN_PTS.endPt);
          }
          if (pts.length === 0) continue;

          const symCentroid = this._computeCentroid(pts);
          const relX = symCentroid.x - metrics.centroid.x;
          const relY = symCentroid.y - metrics.centroid.y;
          const len = Math.hypot(relX, relY);
          const extraX = len > 0 && spacingM > 0 ? (relX / len) * spacingM : 0;
          const extraY = len > 0 && spacingM > 0 ? (relY / len) * spacingM : 0;
          const target = {
            x: anchorProj.x + relX + extraX,
            y: anchorProj.y + relY + extraY,
          };
          const dx = target.x - symCentroid.x;
          const dy = target.y - symCentroid.y;

          if (de.GEOM?.x != null) de.GEOM = shiftPt(de.GEOM, dx, dy);
          if (de.OPTIONS?.GEOM?.x != null) de.OPTIONS = { ...de.OPTIONS, GEOM: shiftPt(de.OPTIONS.GEOM, dx, dy) };
          if (Array.isArray(de.CTRL_PTS)) de.CTRL_PTS = de.CTRL_PTS.map((p: any) => shiftPt(p, dx, dy));
          if (de.BASE_LN_PTS) {
            de.BASE_LN_PTS = {
              startPt: shiftPt(de.BASE_LN_PTS.startPt, dx, dy),
              midPt:   shiftPt(de.BASE_LN_PTS.midPt,   dx, dy),
              endPt:   shiftPt(de.BASE_LN_PTS.endPt,   dx, dy),
            };
          }

          sym.drawEss = JSON.stringify(de);
        } catch { /* skip malformed symbols */ }
      }
    }

    return plan;
  }

  /**
   * Deep-clone the plan and shift every symbol so its centroid lands on its
   * assigned formation slot.  All control points within a symbol are offset by
   * the same (slotPos − symbolCentroid) delta, preserving the symbol's shape.
   */
  private _applyFormationToPlan(bearing: number): any {
    const plan = JSON.parse(JSON.stringify(this._selectedPlanData));
    const formSlots = FORMATIONS[this._formationType]!;
    const anchor = this._anchorPoint!;
    let slotIndex = 0;

    // Pre-compute anchor projection, trig, and unit-conversion factors once for the whole loop
    const anchorProj = this._toProjected(anchor);
    const isProj = this._isProjected();
    const mpLat = 111320;
    const mpLon = isProj ? 1 : 111320 * Math.cos((anchorProj.y * Math.PI) / 180);
    const cosB = Math.cos(bearing);
    const sinB = Math.sin(bearing);
    const spacingM = this._spacingMeters;

    const projPt = (p: any): { x: number; y: number } =>
      this._toProjected(new Point({ x: p.x, y: p.y, spatialReference: { wkid: 4326 } }));

    const shiftPt = (p: any, dx: number, dy: number): any => {
      if (!p || p.x == null) return p;
      const pp = projPt(p);
      const wgs = this._toWGS84(pp.x + dx, pp.y + dy);
      return wgs ? { ...p, x: wgs.x, y: wgs.y } : p;
    };

    for (const overlay of plan.poObj?.plnOrdrOverlay ?? []) {
      for (const sym of overlay.plnOrdrSymbolSet ?? []) {
        if (sym.isDelete === 'Y') continue;
        try {
          const de = JSON.parse(sym.drawEss);

          // Collect all WGS84 points that define this symbol's geometry
          const pts: { x: number; y: number }[] = [];
          const push = (p: any) => { if (p?.x != null) pts.push({ x: p.x, y: p.y }); };
          push(de.GEOM);
          push(de.OPTIONS?.GEOM);
          (de.CTRL_PTS ?? []).forEach(push);
          if (de.BASE_LN_PTS) {
            push(de.BASE_LN_PTS.startPt);
            push(de.BASE_LN_PTS.midPt);
            push(de.BASE_LN_PTS.endPt);
          }
          if (pts.length === 0) continue;

          // Symbol centroid in projected space
          const symCentroid = this._computeCentroid(pts);

          // Assign one slot per symbol, compute target projected position
          const slot = formSlots[slotIndex % formSlots.length] ?? [0, 0];
          slotIndex++;
          const eM = (slot[0] * cosB + slot[1] * sinB) * spacingM;
          const nM = (-slot[0] * sinB + slot[1] * cosB) * spacingM;
          const slotProj = isProj
            ? { x: anchorProj.x + eM, y: anchorProj.y + nM }
            : { x: anchorProj.x + eM / mpLon, y: anchorProj.y + nM / mpLat };

          const dx = slotProj.x - symCentroid.x;
          const dy = slotProj.y - symCentroid.y;

          if (de.GEOM?.x != null) de.GEOM = shiftPt(de.GEOM, dx, dy);
          if (de.OPTIONS?.GEOM?.x != null) de.OPTIONS = { ...de.OPTIONS, GEOM: shiftPt(de.OPTIONS.GEOM, dx, dy) };
          if (Array.isArray(de.CTRL_PTS)) de.CTRL_PTS = de.CTRL_PTS.map((p: any) => shiftPt(p, dx, dy));
          if (de.BASE_LN_PTS) {
            de.BASE_LN_PTS = {
              startPt: shiftPt(de.BASE_LN_PTS.startPt, dx, dy),
              midPt:   shiftPt(de.BASE_LN_PTS.midPt,   dx, dy),
              endPt:   shiftPt(de.BASE_LN_PTS.endPt,   dx, dy),
            };
          }

          sym.drawEss = JSON.stringify(de);
        } catch { /* skip malformed symbols */ }
      }
    }
    return plan;
  }

  private _countPlanSymbols(planDoc: any): number {
    let n = 0;
    try {
      for (const overlay of planDoc?.poObj?.plnOrdrOverlay ?? [])
        for (const sym of overlay?.plnOrdrSymbolSet ?? [])
          if (sym.isDelete !== 'Y') n++;
    } catch {}
    return n;
  }

  private _getSelectedPlanMetrics(): PlanMetrics {
    if (!this._selectedPlanMetrics) {
      this._selectedPlanMetrics = this._buildPlanMetrics(this._selectedPlanData);
    }
    return this._selectedPlanMetrics;
  }

  private _buildPlanMetrics(planDoc: any): PlanMetrics {
    const pointGroups = this._extractPlanPointGroups(planDoc);
    const points = pointGroups.flat();
    return {
      symbolCount: this._countPlanSymbols(planDoc),
      points,
      symbolCentroids: pointGroups.map((group) => this._computeCentroid(group)),
      centroid: this._computeCentroid(points),
    };
  }

  private _extractPlanPoints(planDoc: any): { x: number; y: number }[] {
    return this._extractPlanPointGroups(planDoc).flat();
  }

  private _extractPlanPointGroups(planDoc: any): { x: number; y: number }[][] {
    const groups: { x: number; y: number }[][] = [];
    try {
      for (const overlay of planDoc?.poObj?.plnOrdrOverlay ?? []) {
        for (const sym of overlay?.plnOrdrSymbolSet ?? []) {
          if (sym.isDelete === 'Y') continue;
          try {
            const de = JSON.parse(sym.drawEss);
            const group: { x: number; y: number }[] = [];
            const push = (p: any) => {
              if (p?.x != null && p?.y != null) group.push({ x: p.x, y: p.y });
            };

            push(de.GEOM ?? de.geom);
            push(de.OPTIONS?.GEOM);
            if (Array.isArray(de.CTRL_PTS)) de.CTRL_PTS.forEach(push);
            if (de.BASE_LN_PTS) {
              push(de.BASE_LN_PTS.startPt);
              push(de.BASE_LN_PTS.midPt);
              push(de.BASE_LN_PTS.endPt);
            }
            if (group.length > 0) groups.push(group);
          } catch {}
        }
      }
    } catch {}
    return groups;
  }

  private _computeCentroid(points: { x: number; y: number }[]): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 };
    // Convert to projected space for centroid
    const projected = points.map(p => {
      try {
        const pt = new Point({ x: p.x, y: p.y, spatialReference: { wkid: 4326 } });
        return this._toProjected(pt);
      } catch {
        return p;
      }
    });
    const sumX = projected.reduce((s, p) => s + p.x, 0);
    const sumY = projected.reduce((s, p) => s + p.y, 0);
    return { x: sumX / projected.length, y: sumY / projected.length };
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
