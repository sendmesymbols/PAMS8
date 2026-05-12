import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';

import SerializationEngine from '../ImportExport/SerializationEngine';
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

const ENGINE_NAME = 'DeploymentBuilder';

interface PlanEntry {
  id: string;
  name: string;
  category: string;
  file: string;
  description: string;
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
  private _anchorPoint: Point | null = null;
  private _formationType: string = 'as-is';
  private _spacingMeters: number = 0;

  // Event handles
  private _pointerMoveHandle: any = null;
  private _pointerDownHandle: any = null;  // placement click handler
  private _bgClickHandle: any = null;       // background right-click handler (persistent)
  private _keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

  // Background right-click popup
  private _bgPopup: HTMLElement | null = null;

  // Registry cache
  private _registry: PlanEntry[] | null = null;
  private _registryBaseUrl: string = '';

  // Widget state
  private _minimized: boolean = false;
  private _searchText: string = '';
  private _collapsedCategories: Set<string> = new Set();

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
    this._attachBackgroundRightClick();
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
    this._removeBgClickHandle();
    this._removeBgPopup();
    this._attachBackgroundRightClick();
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
      this._widget.style.display = 'block';
      this._minimized = false;
      this._applyMinimizeState();
    }
    this._loadRegistryIntoWidget();
  }

  private _closeWidget(): void {
    if (this._widget) {
      this._widget.style.display = 'none';
    }
    this._cancelPlacement();
  }

  private _minimizeWidget(): void {
    this._minimized = !this._minimized;
    this._applyMinimizeState();
  }

  private _applyMinimizeState(): void {
    if (!this._widget) return;
    const body = this._widget.querySelector('.db-body') as HTMLElement | null;
    const minBtn = this._widget.querySelector('.db-btn-min') as HTMLElement | null;
    if (body) body.style.display = this._minimized ? 'none' : 'flex';
    if (minBtn) minBtn.textContent = this._minimized ? '▶' : '▼';
  }

  private _buildWidget(): void {
    const el = document.createElement('div');
    el.id = 'deploymentBuilderWidget';
    el.style.cssText = `
      position: fixed;
      top: 110px;
      left: 60px;
      width: 520px;
      background: var(--ms-bg);
      border: 1px solid var(--ms-border);
      border-radius: var(--ms-radius);
      box-shadow: var(--ms-shadow);
      z-index: 1200;
      font-family: var(--ms-font);
      font-size: var(--ms-fs);
      color: var(--ms-text);
      user-select: none;
      display: block;
    `;

    el.innerHTML = `
      <div class="db-header" style="
        display:flex;align-items:center;justify-content:space-between;
        padding:9px 12px;background:var(--ms-bg-header);
        border-bottom:1px solid var(--ms-divider);
        border-radius:var(--ms-radius) var(--ms-radius) 0 0;cursor:grab;
      ">
        <span style="font-weight:700;color:var(--ms-accent);font-size:13px">🗺️ Deployment Builder</span>
        <div style="display:flex;gap:6px">
          <button class="db-btn-min" style="
            background:none;border:1px solid var(--ms-border);border-radius:4px;
            color:var(--ms-text-dim);width:22px;height:22px;cursor:pointer;font-size:12px;
            display:flex;align-items:center;justify-content:center;
          " title="Minimize">▼</button>
          <button class="db-btn-close" style="
            background:none;border:1px solid var(--ms-border);border-radius:4px;
            color:var(--ms-text-dim);width:22px;height:22px;cursor:pointer;font-size:12px;
            display:flex;align-items:center;justify-content:center;
          " title="Close">✕</button>
        </div>
      </div>

      <div class="db-body" style="display:flex;height:340px;">
        <!-- Left column: plan list -->
        <div class="db-left" style="
          width:220px;flex-shrink:0;border-right:1px solid var(--ms-divider);
          display:flex;flex-direction:column;
        ">
          <div style="padding:8px 10px;border-bottom:1px solid var(--ms-divider)">
            <input class="db-search" type="text" placeholder="🔍 Search plans..." style="
              width:100%;box-sizing:border-box;background:var(--ms-bg-input);
              border:1px solid var(--ms-border);border-radius:5px;
              color:var(--ms-text);font-size:var(--ms-fs-sm);padding:5px 8px;outline:none;
            " />
          </div>
          <div class="db-plan-list" style="flex:1;overflow-y:auto;padding:4px 0;"></div>
        </div>

        <!-- Right column: info + placement -->
        <div class="db-right" style="flex:1;display:flex;flex-direction:column;padding:12px;">
          <div class="db-info" style="flex:1;">
            <div style="color:var(--ms-text-label);font-size:var(--ms-fs-xs);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">⚙ Formation Options</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <label style="color:var(--ms-text-dim);font-size:var(--ms-fs-sm)">Formation</label>
              <select class="db-formation" style="
                background:var(--ms-bg-input);border:1px solid var(--ms-border);
                border-radius:4px;color:var(--ms-text);font-size:var(--ms-fs-sm);padding:3px 6px;cursor:pointer;
              ">
                <option value="as-is">As-Is (Original)</option>
                <option value="line">Line</option>
                <option value="column">Column</option>
                <option value="wedge">Wedge</option>
                <option value="echelonR">Echelon Right</option>
                <option value="echelonL">Echelon Left</option>
                <option value="vee">Vee</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
              <label style="color:var(--ms-text-dim);font-size:var(--ms-fs-sm)">Spacing</label>
              <div style="display:flex;gap:4px">
                ${([{m:0,label:'None'},{m:100,label:'100m'},{m:200,label:'200m'},{m:400,label:'400m'},{m:600,label:'600m'}]).map(({m,label}) =>
                  `<button class="db-spacing-btn" data-m="${m}" style="
                    padding:2px 7px;font-size:var(--ms-fs-xs);cursor:pointer;
                    background:var(--ms-bg-input);border:1px solid var(--ms-border);
                    border-radius:4px;color:var(--ms-text-dim);
                  ">${label}</button>`
                ).join('')}
              </div>
            </div>

            <div style="border-top:1px solid var(--ms-divider);padding-top:10px;">
              <div class="db-selected-name" style="font-weight:700;color:var(--ms-accent);margin-bottom:4px;font-size:var(--ms-fs)">No plan selected</div>
              <div class="db-selected-desc" style="color:var(--ms-text-dim);font-size:var(--ms-fs-sm);min-height:32px;"></div>
              <div class="db-selected-count" style="color:var(--ms-text-label);font-size:var(--ms-fs-xs);margin-top:4px;"></div>
            </div>
          </div>

          <div class="db-status" style="
            font-size:var(--ms-fs-sm);color:var(--ms-warning);min-height:18px;margin-bottom:8px;
          "></div>

          <div style="display:flex;gap:8px">
            <button class="db-btn-place" disabled style="
              flex:1;padding:7px 0;background:var(--ms-bg-input);
              border:1px solid var(--ms-border);border-radius:6px;
              color:var(--ms-text-dim);font-size:var(--ms-fs);cursor:not-allowed;font-weight:600;
            ">Place on Map</button>
            <button class="db-btn-cancel" style="
              padding:7px 14px;background:var(--ms-bg-input);
              border:1px solid var(--ms-danger);border-radius:6px;
              color:var(--ms-danger);font-size:var(--ms-fs);cursor:pointer;
            ">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    this._widget = el;

    // Wire header buttons
    el.querySelector('.db-btn-close')!.addEventListener('click', () => this._closeWidget());
    el.querySelector('.db-btn-min')!.addEventListener('click', () => this._minimizeWidget());

    // Drag
    this._makeDraggable(el.querySelector('.db-header') as HTMLElement, el);

    // Search
    const searchEl = el.querySelector('.db-search') as HTMLInputElement;
    searchEl.addEventListener('input', () => {
      this._searchText = searchEl.value.toLowerCase();
      this._renderPlanList();
    });

    // Formation
    const formEl = el.querySelector('.db-formation') as HTMLSelectElement;
    formEl.addEventListener('change', () => {
      this._formationType = formEl.value;
    });

    // Spacing buttons
    el.querySelectorAll('.db-spacing-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._spacingMeters = parseInt((btn as HTMLElement).dataset.m || '200');
        el.querySelectorAll('.db-spacing-btn').forEach(b => {
          (b as HTMLElement).style.background = 'var(--ms-bg-input)';
          (b as HTMLElement).style.borderColor = 'var(--ms-border)';
          (b as HTMLElement).style.color = 'var(--ms-text-dim)';
        });
        (btn as HTMLElement).style.background = 'var(--ms-accent-dim)';
        (btn as HTMLElement).style.borderColor = 'var(--ms-accent)';
        (btn as HTMLElement).style.color = 'var(--ms-text)';
      });
    });
    // Highlight default spacing (None)
    const defaultBtn = el.querySelector('[data-m="0"]') as HTMLElement;
    if (defaultBtn) {
      defaultBtn.style.background = 'var(--ms-accent-dim)';
      defaultBtn.style.borderColor = 'var(--ms-accent)';
      defaultBtn.style.color = 'var(--ms-text)';
    }

    // Place / Cancel
    el.querySelector('.db-btn-place')!.addEventListener('click', () => this._onPlaceClicked());
    el.querySelector('.db-btn-cancel')!.addEventListener('click', () => this._cancelPlacement());

    this._injectWidgetStyles();
  }

  private _injectWidgetStyles(): void {
    if (document.getElementById('db-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'db-widget-styles';
    style.textContent = `
      #deploymentBuilderWidget .db-plan-list::-webkit-scrollbar { width: 5px; }
      #deploymentBuilderWidget .db-plan-list::-webkit-scrollbar-track { background: transparent; }
      #deploymentBuilderWidget .db-plan-list::-webkit-scrollbar-thumb { background: var(--ms-border); border-radius: 3px; }
      #deploymentBuilderWidget .db-category-header {
        padding: 6px 10px 4px;
        font-size: var(--ms-fs-xs); font-weight: 700;
        color: var(--ms-text-label); text-transform: uppercase; letter-spacing: 1px;
        cursor: pointer; display: flex; align-items: center; gap: 4px;
      }
      #deploymentBuilderWidget .db-category-header:hover { color: var(--ms-text-dim); }
      #deploymentBuilderWidget .db-plan-item {
        padding: 5px 14px;
        font-size: var(--ms-fs); color: var(--ms-text-dim); cursor: pointer;
        transition: background 0.1s;
      }
      #deploymentBuilderWidget .db-plan-item:hover { background: var(--ms-accent-dim); color: var(--ms-text); }
      #deploymentBuilderWidget .db-plan-item.active {
        background: var(--ms-accent-dim);
        color: var(--ms-text);
        border-left: 2px solid var(--ms-accent);
      }
      #deploymentBuilderWidget .db-search:focus {
        border-color: var(--ms-accent) !important;
        box-shadow: 0 0 0 2px var(--ms-accent-dim);
      }
      #deploymentBuilderWidget .db-formation option { background: var(--ms-bg); }
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
        el.style.left = `${Math.max(0, elX)}px`;
        el.style.top = `${Math.max(0, elY)}px`;
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
    if (list) list.innerHTML = '<div style="padding:12px;color:var(--ms-text-label);font-size:var(--ms-fs-sm)">Loading plans…</div>';
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
      list.innerHTML = '<div style="padding:12px;color:var(--ms-text-dim);font-style:italic;font-size:var(--ms-fs-sm)">No plans found</div>';
      return;
    }

    const categoryLabels: Record<string, string> = {
      own: '▼ Own Forces', en: '▼ Enemy', attack: '▼ Attack',
      defence: '▼ Defence', logistic: '▼ Logistic', exercises: '▼ Exercises', other: '▼ Other',
    };

    Object.keys(grouped).forEach(cat => {
      const isCollapsed = this._collapsedCategories.has(cat);
      const header = document.createElement('div');
      header.className = 'db-category-header';
      header.textContent = (categoryLabels[cat] ?? `▼ ${cat.charAt(0).toUpperCase() + cat.slice(1)}`).replace('▼', isCollapsed ? '▶' : '▼');
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

  private async _selectPlan(plan: PlanEntry): Promise<void> {
    this._selectedPlanEntry = plan;
    this._selectedPlanData = null;

    // Update UI immediately with loading state
    const nameEl = this._widget?.querySelector('.db-selected-name') as HTMLElement | null;
    const descEl = this._widget?.querySelector('.db-selected-desc') as HTMLElement | null;
    const countEl = this._widget?.querySelector('.db-selected-count') as HTMLElement | null;
    const placeBtn = this._widget?.querySelector('.db-btn-place') as HTMLButtonElement | null;

    if (nameEl) nameEl.textContent = plan.name;
    if (descEl) descEl.textContent = plan.description;
    if (countEl) countEl.textContent = 'Loading…';
    if (placeBtn) { placeBtn.disabled = true; placeBtn.style.cursor = 'not-allowed'; }

    this._renderPlanList();

    const data = await this._loadPlanFile(plan.file);
    if (!data) {
      if (countEl) countEl.textContent = '⚠ Failed to load plan file';
      return;
    }
    this._selectedPlanData = data;

    // Count symbols
    let count = 0;
    try {
      for (const overlay of data?.poObj?.plnOrdrOverlay ?? []) {
        for (const sym of overlay?.plnOrdrSymbolSet ?? []) {
          if (sym.isDelete !== 'Y') count++;
        }
      }
    } catch {}

    if (countEl) countEl.textContent = `${count} symbol${count !== 1 ? 's' : ''}`;
    if (placeBtn && count > 0) {
      placeBtn.disabled = false;
      placeBtn.style.cursor = 'pointer';
      placeBtn.style.background = 'var(--ms-accent-dim)';
      placeBtn.style.borderColor = 'var(--ms-accent)';
      placeBtn.style.color = 'var(--ms-text)';
    }
  }

  // ── Placement Flow ─────────────────────────────────────────────────────────

  private _onPlaceClicked(): void {
    if (!this._selectedPlanData) return;
    this._setStatus('Click on map to set anchor point…');
    this._startPlacement(this._selectedPlanData);
    // Minimize widget so it doesn't block the map
    if (!this._minimized) this._minimizeWidget();
  }

  private _startPlacement(planData: any): void {
    if (!this._view) return;
    this._phase = 'anchor';
    this._clearGhostGraphics();
    this._removePointerHandles();

    // Change cursor
    (this._view.container as HTMLElement).style.cursor = 'crosshair';

    this._pointerDownHandle = this._view.on('click', (evt) => {
      if (this._phase === 'anchor') {
        const pt = evt.mapPoint;
        if (!pt) return;
        this._anchorPoint = pt;
        this._startBearingPhase(pt);
      } else if (this._phase === 'bearing') {
        const bearing = this._computeBearing(this._anchorPoint!, evt.mapPoint);
        this._commitFormation(bearing);
      }
    });

    this._keyDownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this._cancelPlacement();
    };
    document.addEventListener('keydown', this._keyDownHandler);
  }

  private _startBearingPhase(anchor: Point): void {
    if (!this._view) return;
    this._phase = 'bearing';
    this._setStatus('Move cursor to set bearing — click to place');

    this._pointerMoveHandle = this._view.on('pointer-move', (evt) => {
      const screenPt = { x: evt.x, y: evt.y };
      const mapPt = this._view!.toMap(screenPt);
      if (!mapPt) return;
      const bearing = this._computeBearing(anchor, mapPt);
      this._updateGhostPreview(bearing);
    });
  }

  private _commitFormation(bearing: number): void {
    if (!this._anchorPoint || !this._selectedPlanData || !this._serializationEngine) return;
    this._phase = 'idle';
    this._clearGhostGraphics();
    this._removePointerHandles();
    if (this._view) (this._view.container as HTMLElement).style.cursor = '';

    const formSlots = FORMATIONS[this._formationType];
    const anchor = this._anchorPoint;

    let count: number;
    if (formSlots === null) {
      // As-Is: apply a single uniform offset (anchor − plan centroid) to every point.
      // Because it's the same delta for all points, each symbol's shape is preserved.
      const planPoints = this._extractPlanPoints(this._selectedPlanData);
      const centroid = this._computeCentroid(planPoints);
      const coordTransform = (pt: { x: number; y: number }): { x: number; y: number } => {
        const projPt = this._offsetPoint(pt, anchor, centroid);
        const wgsPt = this._toWGS84(projPt.x, projPt.y);
        return wgsPt ? { x: wgsPt.x, y: wgsPt.y } : pt;
      };
      count = this._serializationEngine.loadPlanSymbolsFromData(this._selectedPlanData, coordTransform);
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
    if (!this._minimized) { /* already minimized, restore */ }
    // Restore widget
    if (this._minimized) this._minimizeWidget();
  }

  private _cancelPlacement(): void {
    this._phase = 'idle';
    this._clearGhostGraphics();
    this._removePointerHandles();
    if (this._view) (this._view.container as HTMLElement).style.cursor = '';
    this._setStatus('');
    if (this._minimized) this._minimizeWidget();
  }

  // ── Ghost Preview ──────────────────────────────────────────────────────────

  private _updateGhostPreview(bearing: number): void {
    if (!this._ghostLayer || !this._anchorPoint || !this._selectedPlanData) return;
    this._clearGhostGraphics();

    const formSlots = FORMATIONS[this._formationType];
    const anchor = this._anchorPoint;
    const ghostDot = (projPt: { x: number; y: number }) => {
      const wgsPt = this._toWGS84(projPt.x, projPt.y);
      if (!wgsPt) return;
      this._ghostLayer!.add(new Graphic({
        geometry: wgsPt,
        symbol: new SimpleMarkerSymbol({
          style: 'circle', size: 10,
          color: [100, 180, 255, 0.4],
          outline: { color: [100, 200, 255, 0.7], width: 1.5 },
        }),
      }));
    };

    if (formSlots === null) {
      // As-Is: one dot per plan point, shifted to the anchor
      const planPoints = this._extractPlanPoints(this._selectedPlanData);
      const centroid = this._computeCentroid(planPoints);
      planPoints.forEach(pt => ghostDot(this._offsetPoint(pt, anchor, centroid)));
    } else {
      // Formation: one dot per symbol at its assigned slot position
      const symCount = this._countPlanSymbols(this._selectedPlanData);
      for (let i = 0; i < symCount; i++) {
        const slot = formSlots[i % formSlots.length] ?? [0, 0];
        ghostDot(this._computeFormationPoint(anchor, slot[0], slot[1], bearing, this._spacingMeters));
      }
    }

    // Anchor indicator
    this._ghostLayer.add(new Graphic({
      geometry: anchor,
      symbol: new SimpleMarkerSymbol({
        style: 'cross', size: 14,
        color: [255, 220, 60, 0.8],
        outline: { color: [255, 220, 60, 1], width: 2 },
      }),
    }));
  }

  private _clearGhostGraphics(): void {
    this._ghostLayer?.removeAll();
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
          const slotProj = this._computeFormationPoint(anchor, slot[0], slot[1], bearing, this._spacingMeters);

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

  private _extractPlanPoints(planDoc: any): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    try {
      for (const overlay of planDoc?.poObj?.plnOrdrOverlay ?? []) {
        for (const sym of overlay?.plnOrdrSymbolSet ?? []) {
          if (sym.isDelete === 'Y') continue;
          try {
            const de = JSON.parse(sym.drawEss);
            const geom = de.GEOM ?? de.geom;
            if (geom?.x != null && geom?.y != null) {
              points.push({ x: geom.x, y: geom.y });
            } else if (Array.isArray(de.CTRL_PTS) && de.CTRL_PTS.length > 0) {
              points.push({ x: de.CTRL_PTS[0].x, y: de.CTRL_PTS[0].y });
            }
          } catch {}
        }
      }
    } catch {}
    return points;
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

  // ── Background Right-Click ─────────────────────────────────────────────────

  private _attachBackgroundRightClick(): void {
    if (!this._view) return;
    if (this._bgClickHandle) { this._bgClickHandle.remove(); this._bgClickHandle = null; }
    this._bgClickHandle = this._view.on('pointer-down', async (evt) => {
      if (evt.button !== 2) return;
      if (!this._enabled) return;

      const results = await this._view!.hitTest(evt);
      if (results.results.length > 0) return; // graphic hit — let ContextMenuManager handle it

      this._showBgPopup(evt.x, evt.y);
    });
  }

  private _showBgPopup(screenX: number, screenY: number): void {
    this._removeBgPopup();
    const popup = document.createElement('div');
    popup.style.cssText = `
      position: fixed;
      left: ${screenX}px;
      top: ${screenY}px;
      background: rgba(16,20,30,0.97);
      border: 1px solid rgba(90,140,220,0.35);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      z-index: 1300;
      font-family: 'Inter','Segoe UI',sans-serif;
      font-size: 11.5px;
      overflow: hidden;
      min-width: 180px;
    `;

    const item = document.createElement('div');
    item.style.cssText = `
      padding: 8px 14px;
      cursor: pointer;
      color: #90b0d8;
      display: flex; align-items: center; gap: 8px;
    `;
    item.innerHTML = `<span style="font-size:14px">🗺️</span><span>Open Deployment Builder</span>`;
    item.addEventListener('mouseenter', () => { item.style.background = 'rgba(80,130,200,0.2)'; item.style.color = '#d0e8ff'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; item.style.color = '#90b0d8'; });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openWidget();
      this._removeBgPopup();
    });
    popup.appendChild(item);
    document.body.appendChild(popup);
    this._bgPopup = popup;

    // Close on outside click
    setTimeout(() => {
      const closer = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
          this._removeBgPopup();
          document.removeEventListener('click', closer);
        }
      };
      document.addEventListener('click', closer);
    }, 0);
  }

  private _removeBgPopup(): void {
    if (this._bgPopup) {
      this._bgPopup.remove();
      this._bgPopup = null;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private _removePointerHandles(): void {
    if (this._pointerMoveHandle) {
      this._pointerMoveHandle.remove();
      this._pointerMoveHandle = null;
    }
    if (this._pointerDownHandle) {
      this._pointerDownHandle.remove();
      this._pointerDownHandle = null;
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

  private _setStatus(msg: string): void {
    const el = this._widget?.querySelector('.db-status') as HTMLElement | null;
    if (el) el.textContent = msg;
  }
}

export default DeploymentBuilderEngine;
