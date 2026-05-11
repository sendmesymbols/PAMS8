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
  private _spacingMeters: number = 200;

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
    if (minBtn) minBtn.textContent = this._minimized ? '□' : '─';
  }

  private _buildWidget(): void {
    const el = document.createElement('div');
    el.id = 'deploymentBuilderWidget';
    el.style.cssText = `
      position: fixed;
      top: 110px;
      left: 60px;
      width: 520px;
      background: rgba(16, 20, 30, 0.97);
      border: 1px solid rgba(90, 140, 220, 0.4);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      z-index: 1200;
      font-family: 'Inter', 'Segoe UI', sans-serif;
      font-size: 11.5px;
      color: #d0dcf0;
      user-select: none;
      display: block;
    `;

    el.innerHTML = `
      <div class="db-header" style="
        display:flex;align-items:center;justify-content:space-between;
        padding:9px 12px;background:rgba(80,130,200,0.1);
        border-bottom:1px solid rgba(90,140,220,0.25);
        border-radius:10px 10px 0 0;cursor:grab;
      ">
        <span style="font-weight:700;color:#8ec4ff;font-size:13px">🗺️ Deployment Builder</span>
        <div style="display:flex;gap:6px">
          <button class="db-btn-min" style="
            background:none;border:1px solid rgba(100,160,230,0.3);border-radius:4px;
            color:#7eb8ff;width:22px;height:22px;cursor:pointer;font-size:12px;
            display:flex;align-items:center;justify-content:center;
          " title="Minimize">─</button>
          <button class="db-btn-close" style="
            background:none;border:1px solid rgba(220,80,80,0.3);border-radius:4px;
            color:#f08080;width:22px;height:22px;cursor:pointer;font-size:12px;
            display:flex;align-items:center;justify-content:center;
          " title="Close">✕</button>
        </div>
      </div>

      <div class="db-body" style="display:flex;height:340px;">
        <!-- Left column: plan list -->
        <div class="db-left" style="
          width:220px;flex-shrink:0;border-right:1px solid rgba(90,140,220,0.2);
          display:flex;flex-direction:column;
        ">
          <div style="padding:8px 10px;border-bottom:1px solid rgba(90,140,220,0.15)">
            <input class="db-search" type="text" placeholder="🔍 Search plans..." style="
              width:100%;box-sizing:border-box;background:rgba(0,0,0,0.3);
              border:1px solid rgba(90,140,220,0.25);border-radius:5px;
              color:#d0dcf0;font-size:11px;padding:5px 8px;outline:none;
            " />
          </div>
          <div class="db-plan-list" style="flex:1;overflow-y:auto;padding:4px 0;"></div>
        </div>

        <!-- Right column: info + placement -->
        <div class="db-right" style="flex:1;display:flex;flex-direction:column;padding:12px;">
          <div class="db-info" style="flex:1;">
            <div style="color:#5a7aa8;font-size:10px;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">⚙ Formation Options</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <label style="color:#8ab0d8;font-size:10.5px">Formation</label>
              <select class="db-formation" style="
                background:rgba(0,0,0,0.3);border:1px solid rgba(90,140,220,0.25);
                border-radius:4px;color:#d0dcf0;font-size:10.5px;padding:3px 6px;cursor:pointer;
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
              <label style="color:#8ab0d8;font-size:10.5px">Spacing</label>
              <div style="display:flex;gap:4px">
                ${[100,200,400,600].map(m =>
                  `<button class="db-spacing-btn" data-m="${m}" style="
                    padding:2px 7px;font-size:10px;cursor:pointer;
                    background:rgba(80,110,160,0.15);border:1px solid rgba(90,140,220,0.25);
                    border-radius:4px;color:#90b8d8;
                  ">${m}m</button>`
                ).join('')}
              </div>
            </div>

            <div style="border-top:1px solid rgba(90,140,220,0.15);padding-top:10px;">
              <div class="db-selected-name" style="font-weight:700;color:#8ec4ff;margin-bottom:4px;font-size:12px">No plan selected</div>
              <div class="db-selected-desc" style="color:#6a8ab0;font-size:10.5px;min-height:32px;"></div>
              <div class="db-selected-count" style="color:#5a7098;font-size:10px;margin-top:4px;"></div>
            </div>
          </div>

          <div class="db-status" style="
            font-size:10.5px;color:#e5a540;min-height:18px;margin-bottom:8px;
          "></div>

          <div style="display:flex;gap:8px">
            <button class="db-btn-place" disabled style="
              flex:1;padding:7px 0;background:rgba(80,130,200,0.18);
              border:1px solid rgba(80,130,200,0.35);border-radius:6px;
              color:#90b8d8;font-size:11px;cursor:not-allowed;font-weight:600;
            ">Place on Map</button>
            <button class="db-btn-cancel" style="
              padding:7px 14px;background:rgba(220,80,80,0.1);
              border:1px solid rgba(220,80,80,0.25);border-radius:6px;
              color:#e08080;font-size:11px;cursor:pointer;
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
          (b as HTMLElement).style.background = 'rgba(80,110,160,0.15)';
          (b as HTMLElement).style.borderColor = 'rgba(90,140,220,0.25)';
          (b as HTMLElement).style.color = '#90b8d8';
        });
        (btn as HTMLElement).style.background = 'rgba(100,160,230,0.3)';
        (btn as HTMLElement).style.borderColor = 'rgba(100,180,255,0.6)';
        (btn as HTMLElement).style.color = '#e8f4ff';
      });
    });
    // Highlight default spacing (200m)
    const defaultBtn = el.querySelector('[data-m="200"]') as HTMLElement;
    if (defaultBtn) {
      defaultBtn.style.background = 'rgba(100,160,230,0.3)';
      defaultBtn.style.borderColor = 'rgba(100,180,255,0.6)';
      defaultBtn.style.color = '#e8f4ff';
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
      #deploymentBuilderWidget .db-plan-list::-webkit-scrollbar-thumb { background: rgba(90,140,220,0.3); border-radius: 3px; }
      #deploymentBuilderWidget .db-category-header {
        padding: 6px 10px 4px;
        font-size: 9.5px; font-weight: 700;
        color: #5a7aa8; text-transform: uppercase; letter-spacing: 1px;
        cursor: pointer; display: flex; align-items: center; gap: 4px;
      }
      #deploymentBuilderWidget .db-category-header:hover { color: #7aa0d0; }
      #deploymentBuilderWidget .db-plan-item {
        padding: 5px 14px;
        font-size: 11px; color: #90b0d8; cursor: pointer;
        transition: background 0.1s;
      }
      #deploymentBuilderWidget .db-plan-item:hover { background: rgba(80,130,200,0.15); color: #d0e8ff; }
      #deploymentBuilderWidget .db-plan-item.active {
        background: rgba(100,160,230,0.2);
        color: #e8f4ff;
        border-left: 2px solid #64b4ff;
      }
      #deploymentBuilderWidget .db-search:focus {
        border-color: rgba(100,180,255,0.5) !important;
        box-shadow: 0 0 0 2px rgba(100,180,255,0.1);
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
    if (list) list.innerHTML = '<div style="padding:12px;color:#5a7098;font-size:10.5px">Loading plans…</div>';
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
      list.innerHTML = '<div style="padding:12px;color:#445566;font-style:italic;font-size:10.5px">No plans found</div>';
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
      placeBtn.style.background = 'rgba(80,130,200,0.3)';
      placeBtn.style.borderColor = 'rgba(80,160,230,0.55)';
      placeBtn.style.color = '#d0e8ff';
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

    // Extract plan symbol positions for centroid computation
    const planPoints = this._extractPlanPoints(this._selectedPlanData);
    const centroid = this._computeCentroid(planPoints);

    const formSlots = FORMATIONS[this._formationType];
    const anchor = this._anchorPoint;

    let slotIndex = 0;

    const coordTransform = (pt: { x: number; y: number }): { x: number; y: number } => {
      if (formSlots === null) {
        // As-Is: just offset by (anchor - centroid)
        return this._offsetPoint(pt, anchor, centroid);
      }
      // Formation: map slotIndex to formation slot
      const slot = formSlots[slotIndex % formSlots.length] ?? [0, 0];
      slotIndex++;
      const [lat, fwd] = slot;
      return this._computeFormationPoint(anchor, lat, fwd, bearing, this._spacingMeters);
    };

    const count = this._serializationEngine.loadPlanSymbolsFromData(
      this._selectedPlanData,
      coordTransform,
    );

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

    const planPoints = this._extractPlanPoints(this._selectedPlanData);
    const centroid = this._computeCentroid(planPoints);
    const formSlots = FORMATIONS[this._formationType];
    const anchor = this._anchorPoint;

    planPoints.forEach((pt, i) => {
      let ghostPt: { x: number; y: number };
      if (formSlots === null) {
        ghostPt = this._offsetPoint(pt, anchor, centroid);
      } else {
        const slot = formSlots[i % formSlots.length] ?? [0, 0];
        ghostPt = this._computeFormationPoint(anchor, slot[0], slot[1], bearing, this._spacingMeters);
      }

      const wgsPt = this._toWGS84(ghostPt.x, ghostPt.y, anchor);
      if (!wgsPt) return;

      const ghostGraphic = new Graphic({
        geometry: wgsPt,
        symbol: new SimpleMarkerSymbol({
          style: 'circle',
          size: 10,
          color: [100, 180, 255, 0.4],
          outline: { color: [100, 200, 255, 0.7], width: 1.5 },
        }),
      });
      this._ghostLayer!.add(ghostGraphic);
    });

    // Draw anchor indicator
    const anchorGraphic = new Graphic({
      geometry: anchor,
      symbol: new SimpleMarkerSymbol({
        style: 'cross',
        size: 14,
        color: [255, 220, 60, 0.8],
        outline: { color: [255, 220, 60, 1], width: 2 },
      }),
    });
    this._ghostLayer.add(anchorGraphic);
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
    const anchorProj = this._toProjected(anchor);
    return {
      x: anchorProj.x + (pt.x - centroid.x),
      y: anchorProj.y + (pt.y - centroid.y),
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

  private _toWGS84(
    projX: number,
    projY: number,
    referenceAnchor: Point,
  ): Point | null {
    try {
      const wkid = this._isProjected() ? 102100 : (this._view?.spatialReference?.wkid ?? 4326);
      const pt = new Point({ x: projX, y: projY, spatialReference: { wkid } });
      if (this._isProjected()) {
        return webMercatorUtils.webMercatorToGeographic(pt) as Point;
      }
      return pt;
    } catch {
      return null;
    }
  }

  // ── Plan Helpers ───────────────────────────────────────────────────────────

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
