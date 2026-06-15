import View from '@arcgis/core/views/View';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import { Evented } from '@arcgis/core/core/Evented';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import Point from '@arcgis/core/geometry/Point';

import GraphicsLayerManager from './GraphicsLayerManager';
import { menuIcon } from './MenuIcons';
import MeasurementEngine from '../Engines/MeasurementEngine';
import WeaponEffectEngine from '../Engines/Analysis/WeaponEffectEngine';
import LOSEngine from '../Engines/Analysis/LOSEngine';
import TrajectoryEngine from '../Engines/Analysis/TrajectoryEngine';
import BufferEngine from '../Engines/Analysis/BufferEngine';
import CorridorEngine from '../Engines/Analysis/CorridorEngine';
import FlightEngine from '../Engines/Analysis/FlightEngine';
import { EffectEngine } from '../Engines/Analysis/EffectEngine';
import DeadGroundMapper from '../Engines/Analysis/DeadGroundMapper';
import KeyTerrainIdentificationEngine from '../Engines/Analysis/KeyTerrain/KeyTerrainIdentificationEngine';
import PosDefScorerEngine from '../Engines/Analysis/PositionDefesibilityScorer/PosDefScorerEngine';
import OpRankerEngine from '../Engines/Analysis/OpRanker/OpRankerEngine';
import LocalPeaksEngine from '../Engines/Analysis/Peaks/LocalPeaksEngine';
import OcokaEngine from '../Engines/OCOKA/Ocoka';
import MissionPlannerEngine from '../Engines/MissionPlanner/MissionPlannerEngine';
import TrafficabilityEngine from '../Engines/Analysis/TrafficabilityEngine';
import LandingZoneEngine from '../Engines/Analysis/LandingZone/LandingZoneEngine';
import AirspaceEngine from '../Engines/Analysis/Airspace/AirspaceEngine';

export interface ContextMenuItem {
  id: string;
  label: string | ((graphic?: Graphic) => string);
  shortcut?: string;
  icon?: string;
  enabled?: boolean | ((graphic: Graphic) => boolean);
  visible?: boolean | ((graphic: Graphic) => boolean);
  action?: (graphic: Graphic) => void;
  group?: string;
  order?: number;
  children?: ContextMenuItem[];
}

export interface ContextMenuOptions {
  // CSS classes for styling
  menuClass?: string;
  menuItemClass?: string;
  menuItemHoverClass?: string;
  menuGroupClass?: string;
  menuSeparatorClass?: string;

  // Target filter
  targetGraphicTypes?: string[];
  targetLayerIds?: string[];

  // Positioning
  offsetX?: number;
  offsetY?: number;
}

export interface MenuItemEvent {
  actionId: string;
  graphic: Graphic;
  layerId: string;
  graphicType?: string;
  view: MapView | SceneView;
  point: Point;
  originalEvent: any;
}

interface PaletteAction {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  icon?: string;
  enabled: boolean;
  searchText: string;
  run: () => void;
}

/**
 * ContextMenuManager - Singleton class to manage right-click context menus for graphics
 * Uses the ArcGIS Evented class for event handling
 */
class ContextMenuManager extends Evented {
  private static instance: ContextMenuManager;
  private menuElement: HTMLDivElement;
  private paletteElement: HTMLDivElement;
  private view: MapView | SceneView | null = null;
  private activeGraphic: Graphic | null = null;
  public readonly menuItems: Map<string, ContextMenuItem[]> = new Map();
  private layerManager: GraphicsLayerManager | null = null;
  private options: ContextMenuOptions;
  private clickPoint: Point | null = null;
  private originalEvent: any = null;
  private _measurementEngine: MeasurementEngine | null = null;
  private _symbolEngine: { creationMode: 'single' | 'continuous'; stopContinuousMode(): void } | null = null;
  private _weaponEffectEngine: WeaponEffectEngine | null = null;
  private _losEngine: LOSEngine | null = null;
  private _trajectoryEngine: TrajectoryEngine | null = null;
  private _bufferEngine: BufferEngine | null = null;
  private _corridorEngine: CorridorEngine | null = null;
  private _flightEngine: FlightEngine | null = null;
  private _effectEngine: EffectEngine | null = null;
  private _deadGroundMapper: DeadGroundMapper | null = null;
  private _keyTerrainIdentificationEngine: KeyTerrainIdentificationEngine | null = null;
  private _posDefScorerEngine: PosDefScorerEngine | null = null;
  private _opRankerEngine: OpRankerEngine | null = null;
  private _localPeaksEngine: LocalPeaksEngine | null = null;
  private _ocokaEngine: OcokaEngine | null = null;
  private _missionPlannerEngine: MissionPlannerEngine | null = null;
  private _landingZoneEngine: LandingZoneEngine | null = null;
  private _airspaceEngine: AirspaceEngine | null = null;
  private _trafficabilityEngine: TrafficabilityEngine | null = null;
  private _deploymentBuilderEngine: { openWidget(): void } | null = null;

  private _enabled: boolean = true;

  // Event handles for cleanup on re-initialization
  private _pointerDownHandle: any = null;
  private _contextMenuHandler: ((e: Event) => void) | null = null;
  private _contextMenuContainer: HTMLElement | null = null;
  private _dynamicItemProviders: Array<
    (graphic: Graphic) => ContextMenuItem[]
  > = [];
  private _paletteActions: PaletteAction[] = [];
  private _paletteFilteredActions: PaletteAction[] = [];
  private _paletteSelectedIndex = 0;

  // Bound document-listener references, stored so destroy() can remove the SAME
  // function objects. Passing a fresh .bind(this) to removeEventListener creates
  // a new reference that never matches what was added — so the listeners (and
  // this dead singleton) would otherwise leak and stack up on every re-init.
  private readonly _onDocClickHideMenu: () => void = this.hideMenu.bind(this);
  private readonly _onDocClickHidePalette: () => void =
    this.hideActionPalette.bind(this);
  private readonly _onDocKeyDown: (e: KeyboardEvent) => void = (e) =>
    this.handlePaletteKeyDown(e);

  private constructor() {
    super();

    // Create menu element
    this.menuElement = document.createElement('div');
    this.menuElement.id = 'arcgis-context-menu';
    this.menuElement.style.display = 'none';
    this.menuElement.style.position = 'absolute';
    this.menuElement.style.zIndex = '1000';
    document.body.appendChild(this.menuElement);

    this.paletteElement = document.createElement('div');
    this.paletteElement.id = 'arcgis-action-palette';
    this.paletteElement.style.display = 'none';
    this.paletteElement.style.position = 'absolute';
    this.paletteElement.style.zIndex = '1002';
    this.paletteElement.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(this.paletteElement);

    // Default options
    this.options = {
      menuClass: 'arcgis-context-menu',
      menuItemClass: 'arcgis-context-menu-item',
      menuItemHoverClass: 'arcgis-context-menu-item-hover',
      menuGroupClass: 'arcgis-context-menu-group',
      menuSeparatorClass: 'arcgis-context-menu-separator',
      offsetX: 0,
      offsetY: 0,
      targetGraphicTypes: [],
      targetLayerIds: [],
    };

    // Apply default styling
    this.applyDefaultStyles();

    // Document handlers — registered with the stored bound references so
    // destroy() can remove these exact listeners.
    document.addEventListener('click', this._onDocClickHideMenu);
    document.addEventListener('click', this._onDocClickHidePalette);
    document.addEventListener('keydown', this._onDocKeyDown);
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): ContextMenuManager {
    if (!ContextMenuManager.instance) {
      ContextMenuManager.instance = new ContextMenuManager();
    }
    return ContextMenuManager.instance;
  }

  /**
   * Initialize with a view and options
   */
  public initialize(
    view: MapView | SceneView,
    options?: ContextMenuOptions,
  ): void {
    this.view = view;
    this.options = { ...this.options, ...options };

    // Get layer manager
    this.layerManager = GraphicsLayerManager.getInstance(view);

    // Set view-related styling
    this.menuElement.className = this.options.menuClass || '';

    // Set up view event listeners
    this.setupViewEvents();

    console.log('ContextMenuManager initialized for view:', view.container?.id);
  }

  /**
   * Configure options
   */
  public configure(options: ContextMenuOptions): void {
    this.options = { ...this.options, ...options };
  }

  public enable(): void {
    this._enabled = true;
  }

  public disable(): void {
    this._enabled = false;
    this.hideMenu();
  }

  /**
   * Register menu items for a specific graphic type
   * @param graphicType The type of graphic these menu items apply to
   * @param items Array of context menu items
   */
  public registerMenuItems(
    graphicType: string,
    items: ContextMenuItem[],
  ): void {
    this.menuItems.set(graphicType, items);
    console.log(
      `Registered ${items.length} menu items for graphic type: ${graphicType}`,
    );
  }

  /**
   * Add a menu item to an existing graphic type
   */
  public addMenuItem(graphicType: string, item: ContextMenuItem): void {
    if (!this.menuItems.has(graphicType)) {
      this.menuItems.set(graphicType, []);
    }

    const items = this.menuItems.get(graphicType)!;
    items.push(item);

    // Re-sort items by group and order
    this.menuItems.set(graphicType, this.sortMenuItems(items));
  }

  /**
   * Remove a menu item by ID
   */
  public removeMenuItem(graphicType: string, itemId: string): boolean {
    if (!this.menuItems.has(graphicType)) return false;

    const items = this.menuItems.get(graphicType)!;
    const initialLength = items.length;

    const filteredItems = items.filter((item) => item.id !== itemId);
    this.menuItems.set(graphicType, filteredItems);

    return filteredItems.length < initialLength;
  }

  /**
   * Clear all menu items for a specific graphic type
   */
  public clearMenuItems(graphicType: string): void {
    this.menuItems.delete(graphicType);
  }

  /**
   * Clear all menu items for all graphic types
   */
  public clearAllMenuItems(): void {
    this.menuItems.clear();
  }

  /**
   * Link a MeasurementEngine so the context menu gains a measurement section.
   * The section is rendered at the bottom of every right-click menu and allows
   * the user to toggle measurements on/off and measure the selected graphic.
   */
  public linkMeasurementEngine(engine: MeasurementEngine): void {
    this._measurementEngine = engine;
    console.log('ContextMenuManager: MeasurementEngine linked');
  }

  /**
   * Link a SymbolEngine so the context menu can show a "Stop Continuous Mode"
   * option whenever continuous creation mode is active.
   */
  public linkSymbolEngine(engine: { creationMode: 'single' | 'continuous'; stopContinuousMode(): void }): void {
    this._symbolEngine = engine;
  }

  /**
   * Link a WeaponEffectEngine so the "Analysis → Weapon Engagement Zone"
   * context menu item opens the WEZ panel with the right-clicked graphic
   * as the observer origin.
   */
  public linkWeaponEffectEngine(engine: WeaponEffectEngine | null): void {
    this._weaponEffectEngine = engine;
  }

  /**
   * Link a LOSEngine so the "Analysis → Line of Sight" context menu item
   * opens the LOS panel with the right-clicked graphic as the observer origin.
   */
  public linkLOSEngine(engine: LOSEngine | null): void {
    this._losEngine = engine;
  }

  /**
   * Link a TrajectoryEngine so the "Analysis → Projectile Trajectory" item
   * opens the trajectory panel with the right-clicked graphic as fire origin.
   */
  public linkTrajectoryEngine(engine: TrajectoryEngine | null): void {
    this._trajectoryEngine = engine;
  }

  /**
   * Link a BufferEngine so the "Analysis → Buffer and Threat Rings" item
   * opens the buffer panel with the right-clicked graphic as source origin.
   */
  public linkBufferEngine(engine: BufferEngine | null): void {
    this._bufferEngine = engine;
  }

  /**
   * Link a CorridorEngine so the "Analysis -> Corridor Analysis" item
   * opens the corridor panel with the right-clicked graphic as route origin.
   */
  public linkCorridorEngine(engine: CorridorEngine | null): void {
    this._corridorEngine = engine;
  }

  /**
   * Link a FlightEngine so the "Analysis -> UAV Flight Analysis" item
   * opens the UAV mission panel with the right-clicked graphic as origin.
   */
  public linkFlightEngine(engine: FlightEngine | null): void {
    this._flightEngine = engine;
  }

  /**
   * Link an EffectEngine so the "Analysis -> Effects Radius" item
   * opens the effects panel.
   */
  public linkEffectEngine(engine: EffectEngine | null): void {
    this._effectEngine = engine;
  }

  /**
   * Link a DeadGroundMapper engine so "Analysis -> Dead Ground Mapper"
   * can be opened from More Actions palette.
   */
  public linkDeadGroundMapper(engine: DeadGroundMapper | null): void {
    this._deadGroundMapper = engine;
  }

  /**
   * Link a KeyTerrainIdentificationEngine so "Analysis -> Key Terrain Identifier"
   * can be opened from More Actions palette.
   */
  public linkKeyTerrainIdentificationEngine(
    engine: KeyTerrainIdentificationEngine | null,
  ): void {
    this._keyTerrainIdentificationEngine = engine;
  }

  /**
   * Link a Position Defensibility Scorer engine so it can be opened from
   * the More Actions palette.
   */
  public linkPosDefScorerEngine(engine: PosDefScorerEngine | null): void {
    this._posDefScorerEngine = engine;
  }

  /**
   * Link an Observation Post Ranker engine so it can be opened from
   * the More Actions palette.
   */
  public linkOpRankerEngine(engine: OpRankerEngine | null): void {
    this._opRankerEngine = engine;
  }

  /**
   * Link a LocalPeaksEngine so it can be opened from
   * the More Actions palette.
   */
  public linkLocalPeaksEngine(engine: LocalPeaksEngine | null): void {
    this._localPeaksEngine = engine;
  }

  /**
   * Link an OCOKA engine so it can be opened from the More Actions palette.
   */
  public linkOcokaEngine(engine: OcokaEngine | null): void {
    this._ocokaEngine = engine;
  }

  /**
   * Link a MissionPlannerEngine so it can be opened from the More Actions palette.
   */
  public linkMissionPlannerEngine(engine: MissionPlannerEngine | null): void {
    this._missionPlannerEngine = engine;
  }

  /** Link a LandingZoneEngine so "Landing Zone Analysis" can be opened from the menu. */
  public linkLandingZoneEngine(engine: LandingZoneEngine | null): void {
    this._landingZoneEngine = engine;
  }

  /** Link an AirspaceEngine so "Airspace (ROZ/ACA)" can be opened from the menu. */
  public linkAirspaceEngine(engine: AirspaceEngine | null): void {
    this._airspaceEngine = engine;
  }

  /**
   * Link a TrafficabilityEngine so "Trafficability" can be opened from the
   * More Actions palette with the right-clicked graphic as the origin.
   */
  public linkTrafficabilityEngine(engine: TrafficabilityEngine | null): void {
    this._trafficabilityEngine = engine;
  }

  /**
   * Link a DeploymentBuilderEngine so the "Open Deployment Builder" item
   * appears in all graphic right-click menus when set.
   */
  public linkDeploymentBuilderEngine(engine: { openWidget(): void } | null): void {
    this._deploymentBuilderEngine = engine;
  }

  /** Null out all analysis engine references so the Analysis submenu is hidden. */
  public unlinkAnalysisEngines(): void {
    this._weaponEffectEngine = null;
    this._losEngine = null;
    this._trajectoryEngine = null;
    this._bufferEngine = null;
    this._corridorEngine = null;
    this._flightEngine = null;
    this._effectEngine = null;
    this._deadGroundMapper = null;
    this._keyTerrainIdentificationEngine = null;
    this._posDefScorerEngine = null;
    this._opRankerEngine = null;
    this._localPeaksEngine = null;
    this._ocokaEngine = null;
    this._missionPlannerEngine = null;
    this._landingZoneEngine = null;
    this._airspaceEngine = null;
  }


  /**
   * Register a function that returns extra context menu items dynamically.
   * Called each time the menu opens, so items can depend on runtime state
   * (e.g. menu items that depend on current application state).
   */
  public addDynamicItemProvider(
    provider: (graphic: Graphic) => ContextMenuItem[],
  ): void {
    this._dynamicItemProviders.push(provider);
  }

  /**
   * Returns the graphic that was most recently right-clicked.
   * Useful for keyboard-shortcut handlers that need a target graphic.
   */
  public getLastClickedGraphic(): Graphic | null {
    return this.activeGraphic;
  }


  /**
   * Display the context menu at the given coordinates
   */
  private showMenuAt(x: number, y: number, graphic: Graphic): void {
    this.menuElement.innerHTML = '';

    const graphicType =
      graphic.attributes?.graphicType || graphic.attributes?.type;

    let items: ContextMenuItem[];
    if (graphicType && this.menuItems.has(graphicType)) {
      items = this.menuItems.get(graphicType)!;
    } else if (this.menuItems.size > 0) {
      items = this.menuItems.values().next().value;
    } else {
      console.warn(`No menu items registered for graphic type: ${graphicType}`);
      return;
    }

    this.activeGraphic = graphic;

    const dynamicItems = this._dynamicItemProviders.flatMap((p) => p(graphic));
    items = [...items, ...dynamicItems];

    this.renderMenuItems(items, this.menuElement, graphic, x, y);

    // ── Analysis section (hidden when all analysis engines are disabled) ──
    if (this._losEngine || this._weaponEffectEngine || this._trajectoryEngine ||
        this._bufferEngine || this._corridorEngine || this._flightEngine ||
        this._effectEngine) {
      const sep = document.createElement('div');
      sep.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep);

      // Only include items whose engine is currently loaded
      const analysisItems: ContextMenuItem[] = [
        ...(this._losEngine ? [{
          id: 'analysis-los',
          label: 'Line of Sight',
          icon: menuIcon('eye'),
          action: (g: Graphic) => { if (this._losEngine && this.view) this._losEngine.open(g, this.view); },
        }] : []),
        ...(this._weaponEffectEngine ? [{
          id: 'analysis-wez',
          label: 'Weapon Engagement Zone',
          icon: menuIcon('crosshair'),
          action: (g: Graphic) => { if (this._weaponEffectEngine && this.view) this._weaponEffectEngine.open(g, this.view); },
        }] : []),
        ...(this._trajectoryEngine ? [{
          id: 'analysis-trajectory',
          label: 'Projectile Trajectory',
          icon: menuIcon('arrow-up-right'),
          action: (g: Graphic) => { if (this._trajectoryEngine && this.view) this._trajectoryEngine.open(g, this.view); },
        }] : []),
      ];

      const analysisItem = document.createElement('div');
      analysisItem.className = this.options.menuItemClass || '';
      analysisItem.classList.add('has-submenu');
      analysisItem.style.position = 'relative';
      analysisItem.innerHTML = `<span class="menu-icon">${menuIcon('layers')}</span><span style="flex:1">Analysis</span>`;

      const submenuEl = document.createElement('div');
      submenuEl.className = 'arcgis-submenu';
      this.renderMenuItems(analysisItems, submenuEl, graphic, x, y);
      analysisItem.appendChild(submenuEl);

      analysisItem.addEventListener('mouseenter', () => {
        analysisItem.classList.add(this.options.menuItemHoverClass || '');
        submenuEl.style.display = 'block';
        requestAnimationFrame(() => {
          const rect = submenuEl.getBoundingClientRect();
          if (rect.right > window.innerWidth) {
            submenuEl.style.left = 'auto';
            submenuEl.style.right = '100%';
          } else {
            submenuEl.style.left = '100%';
            submenuEl.style.right = 'auto';
          }
        });
      });
      analysisItem.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!submenuEl.matches(':hover') && !analysisItem.matches(':hover')) {
            analysisItem.classList.remove(this.options.menuItemHoverClass || '');
            submenuEl.style.display = 'none';
          }
        }, 100);
      });
      submenuEl.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!submenuEl.matches(':hover') && !analysisItem.matches(':hover')) {
            analysisItem.classList.remove(this.options.menuItemHoverClass || '');
            submenuEl.style.display = 'none';
          }
        }, 100);
      });

      this.menuElement.appendChild(analysisItem);
    } // end analysis if-block
    // ────────────────────────────────────────────────────────────────────

    // ── Measurement section ──────────────────────────────────────────────
    if (this._measurementEngine) {
      const isOn = this._measurementEngine.isEnabled;
      const opts = this._measurementEngine.getOptions();

      const sep = document.createElement('div');
      sep.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep);

      const header = document.createElement('div');
      header.className = 'arcgis-menu-section-header';
      header.textContent = 'Measurements';
      this.menuElement.appendChild(header);

      const toggleItem = document.createElement('div');
      toggleItem.className = this.options.menuItemClass || '';
      toggleItem.innerHTML = isOn
        ? `<span class="menu-icon">${menuIcon('activity')}</span><span>Disable Measurements <span style="color:var(--ms-success);font-size:10px;margin-left:6px;background:rgba(76,175,80,0.12);padding:2px 6px;border-radius:3px;font-family:var(--ms-menu-font)">● ON</span></span>`
        : `<span class="menu-icon">${menuIcon('ruler-simple')}</span><span>Enable Measurements <span style="color:var(--ms-text-dim);font-size:10px;margin-left:6px;background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:3px;font-family:var(--ms-menu-font)">○ OFF</span></span>`;
      toggleItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this._measurementEngine!.toggle();
        this.hideMenu();
      });
      toggleItem.addEventListener('mouseenter', () =>
        toggleItem.classList.add(this.options.menuItemHoverClass || ''),
      );
      toggleItem.addEventListener('mouseleave', () =>
        toggleItem.classList.remove(this.options.menuItemHoverClass || ''),
      );
      this.menuElement.appendChild(toggleItem);

      if (isOn) {
        const slantItem = document.createElement('div');
        slantItem.className = this.options.menuItemClass || '';
        slantItem.innerHTML = opts.slant_range
          ? `<span class="menu-icon">${menuIcon('box-3d')}</span><span>Disable 3D Slant Range</span>`
          : `<span class="menu-icon">${menuIcon('box-3d')}</span><span>Enable 3D Slant Range</span>`;
        slantItem.addEventListener('click', (e) => {
          e.stopPropagation();
          this._measurementEngine!.setOptions({ slant_range: !opts.slant_range });
          this.hideMenu();
        });
        slantItem.addEventListener('mouseenter', () =>
          slantItem.classList.add(this.options.menuItemHoverClass || ''),
        );
        slantItem.addEventListener('mouseleave', () =>
          slantItem.classList.remove(this.options.menuItemHoverClass || ''),
        );
        this.menuElement.appendChild(slantItem);

        const measureItem = document.createElement('div');
        measureItem.className = this.options.menuItemClass || '';
        measureItem.innerHTML = `<span class="menu-icon">${menuIcon('move')}</span><span>Measure This Symbol</span>`;
        measureItem.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.activeGraphic) {
            const snap = this._measurementEngine!.measureGraphic(
              this.activeGraphic,
            );
            if (snap) {
              document.dispatchEvent(
                new CustomEvent('measurement-graphic-measured', {
                  detail: { ...snap, screenX: x, screenY: y },
                  bubbles: true,
                }),
              );
            }
          }
          this.hideMenu();
        });
        measureItem.addEventListener('mouseenter', () =>
          measureItem.classList.add(this.options.menuItemHoverClass || ''),
        );
        measureItem.addEventListener('mouseleave', () =>
          measureItem.classList.remove(this.options.menuItemHoverClass || ''),
        );
        this.menuElement.appendChild(measureItem);
      }
    }
    // ────────────────────────────────────────────────────────────────────

    // ── Continuous creation mode section ────────────────────────────────
    if (this._symbolEngine?.creationMode === 'continuous') {
      const sep2 = document.createElement('div');
      sep2.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep2);

      const stopItem = document.createElement('div');
      stopItem.className = this.options.menuItemClass || '';
      stopItem.innerHTML = `<span class="menu-icon">${menuIcon('square-stop')}</span><span>Stop Continuous Mode <span style="color:var(--ms-warning);font-size:10px;margin-left:6px;background:rgba(229,165,64,0.12);padding:2px 6px;border-radius:3px;font-family:var(--ms-menu-font)">● LOOP</span></span><span class="menu-shortcut">Esc</span>`;
      stopItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this._symbolEngine!.stopContinuousMode();
        this.hideMenu();
      });
      stopItem.addEventListener('mouseenter', () =>
        stopItem.classList.add(this.options.menuItemHoverClass || ''),
      );
      stopItem.addEventListener('mouseleave', () =>
        stopItem.classList.remove(this.options.menuItemHoverClass || ''),
      );
      this.menuElement.appendChild(stopItem);
    }
    // ────────────────────────────────────────────────────────────────────

    // ── Deployment Manager section ──────────────────────────────────────
    if (this._deploymentBuilderEngine) {
      const sep3 = document.createElement('div');
      sep3.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep3);

      const dbItem = document.createElement('div');
      dbItem.className = this.options.menuItemClass || '';
      dbItem.innerHTML = `<span class="menu-icon">${menuIcon('map-pin')}</span><span>Open Deployment Manager</span>`;
      dbItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deploymentBuilderEngine!.openWidget();
        this.hideMenu();
      });
      dbItem.addEventListener('mouseenter', () =>
        dbItem.classList.add(this.options.menuItemHoverClass || ''),
      );
      dbItem.addEventListener('mouseleave', () =>
        dbItem.classList.remove(this.options.menuItemHoverClass || ''),
      );
      this.menuElement.appendChild(dbItem);
    }
    // ────────────────────────────────────────────────────────────────────

    const paletteActions = this.buildPaletteActions(items, graphic, x, y);
    if (paletteActions.length > 0) {
      const sep4 = document.createElement('div');
      sep4.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep4);

      const moreItem = document.createElement('div');
      moreItem.className = this.options.menuItemClass || '';
      moreItem.innerHTML = `<span class="menu-icon">${menuIcon('grid')}</span><span>More Actions…</span><span class="menu-shortcut">Search</span>`;
      moreItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showActionPalette(x, y, graphic, paletteActions);
      });
      moreItem.addEventListener('mouseenter', () =>
        moreItem.classList.add(this.options.menuItemHoverClass || ''),
      );
      moreItem.addEventListener('mouseleave', () =>
        moreItem.classList.remove(this.options.menuItemHoverClass || ''),
      );
      this.menuElement.appendChild(moreItem);
    }

    this.menuElement.style.left = `${x + (this.options.offsetX || 0)}px`;
    this.menuElement.style.top = `${y + (this.options.offsetY || 0)}px`;
    this.menuElement.style.display = 'block';
  }

  /**
   * Recursively render menu items into a container element.
   * Items with `children` become submenu triggers; others are leaf actions.
   */
  private renderMenuItems(
    items: ContextMenuItem[],
    container: HTMLElement,
    graphic: Graphic,
    screenX: number,
    screenY: number,
  ): void {
    let currentGroup: string | null = null;
    let groupContainer: HTMLDivElement | null = null;

    items.forEach((item) => {
      const isVisible =
        typeof item.visible === 'function'
          ? item.visible(graphic)
          : item.visible !== undefined
            ? item.visible
            : true;
      if (!isVisible) return;

      const isEnabled =
        typeof item.enabled === 'function'
          ? item.enabled(graphic)
          : item.enabled !== undefined
            ? item.enabled
            : true;

      // Flat group headers (backward compat, only for non-submenu items)
      if (item.group && item.group !== currentGroup && !item.children) {
        currentGroup = item.group;
        groupContainer = document.createElement('div');
        groupContainer.className = this.options.menuGroupClass || '';
        const groupTitle = document.createElement('div');
        groupTitle.textContent = currentGroup;
        groupTitle.className = 'arcgis-context-menu-group-title';
        groupContainer.appendChild(groupTitle);
        container.appendChild(groupContainer);
      }

      const menuItem = document.createElement('div');
      menuItem.className = this.options.menuItemClass || '';
      menuItem.dataset.id = item.id;
      if (!isEnabled) menuItem.classList.add('disabled');

      if (item.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'menu-icon';
        iconSpan.innerHTML = item.icon;
        menuItem.appendChild(iconSpan);
      }

      const labelSpan = document.createElement('span');
      labelSpan.textContent =
        typeof item.label === 'function' ? item.label(graphic) : item.label;
      labelSpan.style.flex = '1';
      menuItem.appendChild(labelSpan);

      if (item.children && item.children.length > 0) {
        menuItem.classList.add('has-submenu');
        menuItem.style.position = 'relative';

        const submenuEl = document.createElement('div');
        submenuEl.className = 'arcgis-submenu';
        this.renderMenuItems(
          item.children,
          submenuEl,
          graphic,
          screenX,
          screenY,
        );
        menuItem.appendChild(submenuEl);

        menuItem.addEventListener('mouseenter', () => {
          menuItem.classList.add(this.options.menuItemHoverClass || '');
          submenuEl.style.display = 'block';

          requestAnimationFrame(() => {
            const rect = submenuEl.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
              submenuEl.style.left = 'auto';
              submenuEl.style.right = '100%';
            } else {
              submenuEl.style.left = '100%';
              submenuEl.style.right = 'auto';
            }
          });
        });
        menuItem.addEventListener('mouseleave', () => {
          setTimeout(() => {
            if (!submenuEl.matches(':hover') && !menuItem.matches(':hover')) {
              menuItem.classList.remove(this.options.menuItemHoverClass || '');
              submenuEl.style.display = 'none';
            }
          }, 100);
        });
        submenuEl.addEventListener('mouseleave', () => {
          setTimeout(() => {
            if (!submenuEl.matches(':hover') && !menuItem.matches(':hover')) {
              menuItem.classList.remove(this.options.menuItemHoverClass || '');
              submenuEl.style.display = 'none';
            }
          }, 100);
        });
      } else {
        if (item.shortcut) {
          const kbdSpan = document.createElement('span');
          kbdSpan.className = 'menu-shortcut';
          kbdSpan.textContent = item.shortcut;
          menuItem.appendChild(kbdSpan);
        }

        if (isEnabled) {
          menuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.action) item.action(graphic);
            this.emit('menu-item-click', {
              actionId: item.id,
              graphic,
              layerId: graphic.origin?.layer?.id || '',
              graphicType:
                graphic.attributes?.graphicType || graphic.attributes?.type,
              view: this.view,
              point: this.clickPoint!,
              originalEvent: this.originalEvent,
            } as MenuItemEvent);
            this.hideMenu();
          });
          menuItem.addEventListener('mouseenter', () =>
            menuItem.classList.add(this.options.menuItemHoverClass || ''),
          );
          menuItem.addEventListener('mouseleave', () =>
            menuItem.classList.remove(this.options.menuItemHoverClass || ''),
          );
        }
      }

      if (groupContainer && item.group === currentGroup && !item.children) {
        groupContainer.appendChild(menuItem);
      } else {
        container.appendChild(menuItem);
      }
    });
  }

  private buildPaletteActions(
    items: ContextMenuItem[],
    graphic: Graphic,
    screenX: number,
    screenY: number,
  ): PaletteAction[] {
    const actions = this.flattenMenuItemsForPalette(items, graphic);
    actions.push(...this.buildRuntimePaletteActions(graphic, screenX, screenY));
    return actions;
  }

  private flattenMenuItemsForPalette(
    items: ContextMenuItem[],
    graphic: Graphic,
    path: string[] = [],
  ): PaletteAction[] {
    const actions: PaletteAction[] = [];

    items.forEach((item) => {
      if (!this.isMenuItemVisible(item, graphic)) return;

      const label =
        typeof item.label === 'function' ? item.label(graphic) : item.label;
      const category = item.group || path.join(' / ') || 'Common';
      const nextPath = item.children ? [...path, label] : path;

      if (item.children && item.children.length > 0) {
        actions.push(
          ...this.flattenMenuItemsForPalette(item.children, graphic, nextPath),
        );
        return;
      }

      const enabled = this.isMenuItemEnabled(item, graphic);
      const actionCategory = category || 'Common';
      actions.push({
        id: item.id,
        label,
        category: actionCategory,
        shortcut: item.shortcut,
        icon: item.icon,
        enabled,
        searchText: this.normalizeSearchText(
          `${label} ${actionCategory} ${item.id} ${item.shortcut || ''}`,
        ),
        run: () => this.runPaletteMenuItem(item, graphic),
      });
    });

    return actions;
  }

  private buildRuntimePaletteActions(
    graphic: Graphic,
    screenX: number,
    screenY: number,
  ): PaletteAction[] {
    const actions: PaletteAction[] = [];

    if (this._losEngine) {
      actions.push(this.createPaletteAction('analysis-los', 'Line of Sight', 'Analysis', undefined, () => {
        if (this._losEngine && this.view) this._losEngine.open(graphic, this.view);
      }));
    }

    if (this._weaponEffectEngine) {
      actions.push(this.createPaletteAction('analysis-wez', 'Weapon Engagement Zone', 'Analysis', undefined, () => {
        if (this._weaponEffectEngine && this.view) this._weaponEffectEngine.open(graphic, this.view);
      }));
    }

    if (this._trajectoryEngine) {
      actions.push(this.createPaletteAction('analysis-trajectory', 'Projectile Trajectory', 'Analysis', undefined, () => {
        if (this._trajectoryEngine && this.view) this._trajectoryEngine.open(graphic, this.view);
      }));
    }

    if (this._bufferEngine) {
      actions.push(this.createPaletteAction('analysis-buffer', 'Buffer & Threat Rings', 'Analysis / More Tools', undefined, () => {
        if (this._bufferEngine && this.view) this._bufferEngine.open(graphic, this.view);
      }));
    }

    if (this._corridorEngine) {
      actions.push(this.createPaletteAction('analysis-corridor', 'Corridor Analysis', 'Analysis / More Tools', undefined, () => {
        if (this._corridorEngine && this.view) this._corridorEngine.open(graphic, this.view);
      }));
    }

    if (this._flightEngine) {
      actions.push(this.createPaletteAction('analysis-flight', 'UAV Flight Analysis', 'Analysis / More Tools', undefined, () => {
        if (this._flightEngine && this.view) this._flightEngine.open(graphic, this.view);
      }));
    }

    if (this._effectEngine) {
      actions.push(this.createPaletteAction('analysis-effects', 'Effect Analysis', 'Analysis / More Tools', undefined, () => {
        if (this._effectEngine && this.view) this._effectEngine.open(graphic, this.view);
      }));
    }

    if (this._deadGroundMapper) {
      actions.push(this.createPaletteAction('analysis-dead-ground', 'Dead Ground Mapper', 'Analysis / More Tools', undefined, () => {
        if (this._deadGroundMapper && this.view) this._deadGroundMapper.open(graphic, this.view);
      }));
    }

    if (this._keyTerrainIdentificationEngine) {
      actions.push(this.createPaletteAction('analysis-key-terrain', 'Key Terrain Identifier', 'Analysis / More Tools', undefined, () => {
        if (this._keyTerrainIdentificationEngine && this.view) {
          this._keyTerrainIdentificationEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._posDefScorerEngine) {
      actions.push(this.createPaletteAction('analysis-pos-def-scorer', 'Position Defensibility Scorer', 'Analysis / More Tools', undefined, () => {
        if (this._posDefScorerEngine && this.view) {
          this._posDefScorerEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._opRankerEngine) {
      actions.push(this.createPaletteAction('analysis-op-ranker', 'Observation Post Ranker', 'Analysis / More Tools', undefined, () => {
        if (this._opRankerEngine && this.view) {
          this._opRankerEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._localPeaksEngine) {
      actions.push(this.createPaletteAction('analysis-local-peaks', 'Peak Analysis', 'Analysis / More Tools', undefined, () => {
        if (this._localPeaksEngine && this.view) {
          this._localPeaksEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._ocokaEngine) {
      actions.push(this.createPaletteAction('analysis-ocoka', '⬡ OCOKA — Avenues of Approach', 'Analysis / More Tools', undefined, () => {
        if (this._ocokaEngine && this.view) {
          this._ocokaEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._missionPlannerEngine) {
      actions.push(this.createPaletteAction('analysis-mission-planner', 'Mission Planner Dashboard', 'Analysis / Mission Planning', undefined, () => {
        if (this._missionPlannerEngine && this.view) {
          this._missionPlannerEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._landingZoneEngine) {
      actions.push(this.createPaletteAction('analysis-landing-zone', 'Landing Zone Analysis', 'Analysis / More Tools', undefined, () => {
        if (this._landingZoneEngine && this.view) {
          this._landingZoneEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._airspaceEngine) {
      actions.push(this.createPaletteAction('analysis-airspace', 'Airspace (ROZ / ACA)', 'Analysis / More Tools', undefined, () => {
        if (this._airspaceEngine && this.view) {
          this._airspaceEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._trafficabilityEngine) {
      actions.push(this.createPaletteAction('analysis-trafficability', 'Trafficability', 'Analysis / Mobility', undefined, () => {
        if (this._trafficabilityEngine && this.view) {
          this._trafficabilityEngine.open(graphic, this.view);
        }
      }));
    }

    if (this._measurementEngine) {
      const isOn = this._measurementEngine.isEnabled;
      const opts = this._measurementEngine.getOptions();
      actions.push(this.createPaletteAction(
        'measurement-toggle',
        isOn ? 'Disable Measurements' : 'Enable Measurements',
        'Measurements',
        undefined,
        () => this._measurementEngine!.toggle(),
      ));

      if (isOn) {
        actions.push(this.createPaletteAction(
          'measurement-slant-range',
          opts.slant_range ? 'Disable 3D Slant Range' : 'Enable 3D Slant Range',
          'Measurements',
          undefined,
          () => this._measurementEngine!.setOptions({ slant_range: !opts.slant_range }),
        ));
        actions.push(this.createPaletteAction(
          'measurement-measure-symbol',
          'Measure This Symbol',
          'Measurements',
          undefined,
          () => {
            const snap = this._measurementEngine!.measureGraphic(graphic);
            if (snap) {
              document.dispatchEvent(
                new CustomEvent('measurement-graphic-measured', {
                  detail: { ...snap, screenX, screenY },
                  bubbles: true,
                }),
              );
            }
          },
        ));
      }
    }

    if (this._symbolEngine?.creationMode === 'continuous') {
      actions.push(this.createPaletteAction(
        'stop-continuous-mode',
        'Stop Continuous Mode',
        'Runtime',
        'Esc',
        () => this._symbolEngine!.stopContinuousMode(),
      ));
    }

    if (this._deploymentBuilderEngine) {
      actions.push(this.createPaletteAction(
        'deployment-manager',
        'Open Deployment Manager',
        'Tools',
        undefined,
        () => this._deploymentBuilderEngine!.openWidget(),
      ));
    }

    return actions;
  }

  private createPaletteAction(
    id: string,
    label: string,
    category: string,
    shortcut: string | undefined,
    run: () => void,
    enabled = true,
  ): PaletteAction {
    return {
      id,
      label,
      category,
      shortcut,
      enabled,
      searchText: this.normalizeSearchText(`${label} ${category} ${id} ${shortcut || ''}`),
      run: () => {
        run();
        this.emitPaletteAction(id);
        this.hideActionPalette();
        this.hideMenu();
      },
    };
  }

  private showActionPalette(
    x: number,
    y: number,
    graphic: Graphic,
    actions: PaletteAction[],
  ): void {
    this.activeGraphic = graphic;
    this._paletteActions = actions;
    this._paletteFilteredActions = actions;
    this._paletteSelectedIndex = 0;
    this.menuElement.style.display = 'none';

    this.paletteElement.innerHTML = '';
    this.paletteElement.className = 'arcgis-action-palette';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'arcgis-action-palette-search';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'arcgis-action-palette-search-icon';
    searchIcon.innerHTML = menuIcon('search');
    searchWrap.appendChild(searchIcon);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search actions';
    input.setAttribute('aria-label', 'Search actions');
    searchWrap.appendChild(input);
    this.paletteElement.appendChild(searchWrap);

    const list = document.createElement('div');
    list.className = 'arcgis-action-palette-list';
    this.paletteElement.appendChild(list);

    const hint = document.createElement('div');
    hint.className = 'arcgis-action-palette-hint';
    hint.textContent = 'Enter to run  /  Esc to close';
    this.paletteElement.appendChild(hint);

    const render = () => {
      const query = this.normalizeSearchText(input.value);
      this._paletteFilteredActions = query
        ? this._paletteActions.filter((action) => action.searchText.includes(query))
        : this._paletteActions;
      this._paletteSelectedIndex = Math.min(
        this._paletteSelectedIndex,
        Math.max(this._paletteFilteredActions.length - 1, 0),
      );
      this.renderPaletteList(list);
    };

    input.addEventListener('input', () => {
      this._paletteSelectedIndex = 0;
      render();
    });

    this.paletteElement.style.left = `${x + 14}px`;
    this.paletteElement.style.top = `${y + 14}px`;
    this.paletteElement.style.display = 'block';

    render();
    this.repositionActionPalette();
    requestAnimationFrame(() => input.focus());
  }

  private renderPaletteList(container: HTMLElement): void {
    container.innerHTML = '';

    if (this._paletteFilteredActions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'arcgis-action-palette-empty';
      empty.textContent = 'No matching actions';
      container.appendChild(empty);
      return;
    }

    let currentCategory = '';
    this._paletteFilteredActions.forEach((action, index) => {
      if (action.category !== currentCategory) {
        currentCategory = action.category;
        const header = document.createElement('div');
        header.className = 'arcgis-action-palette-category';
        header.textContent = currentCategory;
        container.appendChild(header);
      }

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'arcgis-action-palette-row';
      if (index === this._paletteSelectedIndex) row.classList.add('selected');
      if (!action.enabled) row.disabled = true;

      if (action.icon) {
        const icon = document.createElement('span');
        icon.className = 'arcgis-action-palette-icon';
        icon.innerHTML = action.icon;
        row.appendChild(icon);
      }

      const copy = document.createElement('span');
      copy.className = 'arcgis-action-palette-copy';
      const label = document.createElement('span');
      label.className = 'arcgis-action-palette-label';
      label.textContent = action.label;
      const meta = document.createElement('span');
      meta.className = 'arcgis-action-palette-meta';
      meta.textContent = action.category;
      copy.appendChild(label);
      copy.appendChild(meta);
      row.appendChild(copy);

      if (action.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'arcgis-action-palette-shortcut';
        shortcut.textContent = action.shortcut;
        row.appendChild(shortcut);
      }

      row.addEventListener('mouseenter', () => {
        this._paletteSelectedIndex = index;
        this.updatePaletteSelection(container);
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (action.enabled) action.run();
      });
      container.appendChild(row);
    });
  }

  private handlePaletteKeyDown(e: KeyboardEvent): void {
    if (this.paletteElement.style.display === 'none') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.hideActionPalette();
      this.hideMenu();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      const max = this._paletteFilteredActions.length - 1;
      if (max < 0) return;
      this._paletteSelectedIndex =
        (this._paletteSelectedIndex + direction + this._paletteFilteredActions.length) %
        this._paletteFilteredActions.length;
      const list = this.paletteElement.querySelector('.arcgis-action-palette-list');
      if (list instanceof HTMLElement) this.updatePaletteSelection(list);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const action = this._paletteFilteredActions[this._paletteSelectedIndex];
      if (action?.enabled) action.run();
    }
  }

  private runPaletteMenuItem(item: ContextMenuItem, graphic: Graphic): void {
    if (item.action) item.action(graphic);
    this.emitPaletteAction(item.id);
    this.hideActionPalette();
    this.hideMenu();
  }

  private updatePaletteSelection(container: HTMLElement): void {
    const rows = container.querySelectorAll('.arcgis-action-palette-row');
    rows.forEach((row, index) => {
      row.classList.toggle('selected', index === this._paletteSelectedIndex);
    });
  }

  private emitPaletteAction(actionId: string): void {
    if (!this.activeGraphic || !this.view) return;

    this.emit('menu-item-click', {
      actionId,
      graphic: this.activeGraphic,
      layerId: (this.activeGraphic.origin as any)?.layer?.id || '',
      graphicType:
        this.activeGraphic.attributes?.graphicType || this.activeGraphic.attributes?.type,
      view: this.view,
      point: this.clickPoint!,
      originalEvent: this.originalEvent,
    } as MenuItemEvent);
  }

  private isMenuItemVisible(item: ContextMenuItem, graphic: Graphic): boolean {
    return typeof item.visible === 'function'
      ? item.visible(graphic)
      : item.visible !== undefined
        ? item.visible
        : true;
  }

  private isMenuItemEnabled(item: ContextMenuItem, graphic: Graphic): boolean {
    return typeof item.enabled === 'function'
      ? item.enabled(graphic)
      : item.enabled !== undefined
        ? item.enabled
        : true;
  }

  private normalizeSearchText(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private repositionActionPalette(): void {
    const rect = this.paletteElement.getBoundingClientRect();
    const margin = 12;

    if (rect.right > window.innerWidth - margin) {
      this.paletteElement.style.left = `${Math.max(margin, window.innerWidth - rect.width - margin)}px`;
    }

    if (rect.bottom > window.innerHeight - margin) {
      this.paletteElement.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`;
    }
  }

  private hideActionPalette(): void {
    this.paletteElement.style.display = 'none';
    this.paletteElement.innerHTML = '';
    this._paletteActions = [];
    this._paletteFilteredActions = [];
    this._paletteSelectedIndex = 0;
  }

  /**
   * Hide the context menu
   */
  private hideMenu(): void {
    this.menuElement.style.display = 'none';
    this.hideActionPalette();
    this.activeGraphic = null;
    this.clickPoint = null;
    this.originalEvent = null;
  }

  /**
   * Handle menu item clicks
   */
  private handleMenuItemClick(actionId: string): void {
    if (!this.activeGraphic || !this.view) return;

    // Get graphic type
    const graphicType =
      this.activeGraphic.attributes?.graphicType ||
      this.activeGraphic.attributes?.type;

    // Resolve items: exact type match → fallback to first registered set
    let items: ContextMenuItem[];
    if (graphicType && this.menuItems.has(graphicType)) {
      items = this.menuItems.get(graphicType)!;
    } else if (this.menuItems.size > 0) {
      items = this.menuItems.values().next().value;
    } else {
      return;
    }
    const item = items.find((i) => i.id === actionId);

    if (!item) {
      console.warn(`Menu item with ID ${actionId} not found`);
      return;
    }

    // Execute action if available
    if (item.action) {
      item.action(this.activeGraphic);
    }

    // Emit event
    const layerId = (this.activeGraphic.origin as any)?.layer?.id || '';

    this.emit('menu-item-click', {
      actionId,
      graphic: this.activeGraphic,
      layerId,
      graphicType,
      view: this.view,
      point: this.clickPoint!,
      originalEvent: this.originalEvent,
    } as MenuItemEvent);

    // Hide menu
    this.hideMenu();
  }

  /**
   * Remove event listeners from the previous view before re-initialization.
   */
  private teardownViewEvents(): void {
    // Remove the ArcGIS view pointer-down handle
    if (this._pointerDownHandle) {
      this._pointerDownHandle.remove();
      this._pointerDownHandle = null;
    }

    // Remove the native contextmenu listener from the old container
    if (this._contextMenuHandler && this._contextMenuContainer) {
      this._contextMenuContainer.removeEventListener(
        'contextmenu',
        this._contextMenuHandler,
      );
      this._contextMenuHandler = null;
      this._contextMenuContainer = null;
    }
  }

  /**
   * Set up event listeners on the view
   */
  private setupViewEvents(): void {
    if (!this.view) return;

    // Clean up any previous listeners before attaching new ones
    this.teardownViewEvents();

    // Prevent default context menu
    this._contextMenuHandler = (e: Event) => e.preventDefault();
    this._contextMenuContainer = this.view.container;
    this.view.container.addEventListener(
      'contextmenu',
      this._contextMenuHandler,
    );

    // Listen for pointer-down events (to catch right-clicks)
    this._pointerDownHandle = this.view.on('pointer-down', (event) => {
      // Left-click (button 0) always dismisses any open menu
      if (event.button !== 2) {
        this.hideMenu();
        return;
      }

      if (!this._enabled) return;

      // Store original event
      this.originalEvent = event.native;

      event.stopPropagation();
      this.hideMenu();

      // Resolve target layer IDs to GraphicsLayer references for efficient hitTest filtering
      const targetLayers = (this.options.targetLayerIds ?? [])
        .map(id => this.layerManager?.getLayer(id))
        .filter((l): l is GraphicsLayer => l !== undefined);
      const hitOptions = targetLayers.length ? { include: targetLayers } : undefined;

      this.view!.hitTest(event, hitOptions).then((response) => {
        const graphicHit = response.results?.find((result) => {
          if (!result.graphic) return false;

          const graphicType =
            result.graphic.attributes?.graphicType || result.graphic.attributes?.type;

          if (
            this.options.targetGraphicTypes &&
            this.options.targetGraphicTypes.length > 0
          ) {
            if (
              !graphicType ||
              !this.options.targetGraphicTypes.includes(graphicType)
            ) {
              return false;
            }
          }

          return true;
        });

        if (graphicHit) {
          const graphic = graphicHit.graphic;
          this.clickPoint = this.view!.toMap({ x: event.x, y: event.y });
          this.showMenuAt(event.x, event.y, graphic);
        }
      });
    });

    // Note: menu dismissal on left-click is handled in the pointer-down handler above
  }

  /**
   * Apply default styles to the menu element
   */
  private applyDefaultStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      /* ── Context menu shell ─────────────────────────────────────────────── */
      .arcgis-context-menu {
        background-color: var(--ms-bg);
        border: 1px solid var(--ms-border);
        border-radius: var(--ms-radius);
        box-shadow: var(--ms-shadow);
        padding: 5px 0;
        min-width: 200px;
        max-width: 320px;
        user-select: none;
        backdrop-filter: blur(14px);
        animation: contextMenuFadeIn 0.13s ease-out;
        font-family: var(--ms-menu-font);
      }

      @keyframes contextMenuFadeIn {
        from { opacity: 0; transform: scale(0.96) translateY(-4px); }
        to   { opacity: 1; transform: scale(1)    translateY(0);    }
      }

      /* ── Menu items ─────────────────────────────────────────────────────── */
      .arcgis-context-menu-item {
        padding: 7px 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        color: var(--ms-text);
        font-size: 12.5px;
        font-family: var(--ms-menu-font);
        letter-spacing: 0.01em;
        transition: background-color 0.08s ease, border-left-color 0.08s ease;
        border-left: 2px solid transparent;
        margin: 1px 4px;
        border-radius: 4px;
      }

      .arcgis-context-menu-item:hover,
      .arcgis-context-menu-item-hover {
        background-color: var(--ms-bg-input);
        border-left-color: var(--ms-accent);
        color: var(--ms-text);
        filter: brightness(1.15);
      }

      .arcgis-context-menu-item.disabled {
        color: var(--ms-text-label);
        cursor: default;
        opacity: 0.55;
      }

      .arcgis-context-menu-item.disabled:hover {
        background-color: transparent;
        border-left-color: transparent;
        filter: none;
      }

      /* ── Groups ─────────────────────────────────────────────────────────── */
      .arcgis-context-menu-group {
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px solid var(--ms-divider);
      }

      .arcgis-context-menu-group-title {
        padding: 5px 14px 4px;
        font-family: var(--ms-menu-font);
        font-size: var(--ms-fs-xs);
        color: var(--ms-accent-dim);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.8;
      }

      /* ── Section header (Measurements, etc.) ───────────────────────────── */
      .arcgis-menu-section-header {
        padding: 8px 14px 3px;
        font-family: var(--ms-menu-font);
        font-size: var(--ms-fs-xs);
        color: var(--ms-accent-dim);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.8;
      }

      /* ── Separator ──────────────────────────────────────────────────────── */
      .arcgis-context-menu-separator {
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--ms-divider), transparent);
        margin: 5px 10px;
      }

      /* ── Icon slot (SVG) ────────────────────────────────────────────────── */
      .menu-icon {
        width: 16px;
        min-width: 16px;
        height: 16px;
        margin-right: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--ms-accent-dim);
        opacity: 0.85;
        flex-shrink: 0;
      }

      .menu-icon svg {
        width: 16px;
        height: 16px;
      }

      /* Backward-compat: callers that still pass a bare Unicode string or
         the old <span class="menu-icon-text"> wrapper — render it gracefully
         without the pill border/background that was removed. */
      .menu-icon-text {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        min-width: 16px;
        height: 16px;
        margin-right: 10px;
        font-size: 13px;
        line-height: 1;
        color: var(--ms-accent-dim);
        opacity: 0.85;
        flex-shrink: 0;
      }

      /* ── Shortcut badge ─────────────────────────────────────────────────── */
      .menu-shortcut {
        margin-left: auto;
        padding-left: 12px;
        font-size: var(--ms-fs-xs);
        font-family: var(--ms-menu-font);
        color: var(--ms-text-dim);
        white-space: nowrap;
        background: rgba(0, 0, 0, 0.18);
        padding: 2px 6px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      /* ── Submenu chevron ────────────────────────────────────────────────── */
      .arcgis-context-menu-item.has-submenu {
        position: relative;
      }

      .arcgis-context-menu-item.has-submenu::after {
        content: '';
        display: inline-block;
        width: 12px;
        height: 12px;
        margin-left: auto;
        flex-shrink: 0;
        background-color: var(--ms-accent-dim);
        opacity: 0.55;
        clip-path: polygon(30% 18%, 72% 50%, 30% 82%, 20% 72%, 54% 50%, 20% 28%);
      }

      /* ── Submenu panel ──────────────────────────────────────────────────── */
      .arcgis-submenu {
        display: none;
        position: absolute;
        left: calc(100% + 4px);
        top: -4px;
        background-color: var(--ms-bg);
        border: 1px solid var(--ms-border);
        border-radius: var(--ms-radius);
        box-shadow: var(--ms-shadow);
        padding: 5px 0;
        min-width: 200px;
        max-width: 300px;
        z-index: 1001;
        backdrop-filter: blur(14px);
        animation: submenuFadeIn 0.1s ease-out;
      }

      @keyframes submenuFadeIn {
        from { opacity: 0; transform: translateX(-6px); }
        to   { opacity: 1; transform: translateX(0);    }
      }

      /* ══════════════════════════════════════════════════════════════════════
         ACTION PALETTE ("More Actions…")
         ══════════════════════════════════════════════════════════════════════ */
      .arcgis-action-palette {
        width: min(420px, calc(100vw - 24px));
        max-height: min(520px, calc(100vh - 24px));
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 100px),
          var(--ms-bg);
        border: 1px solid var(--ms-border);
        border-radius: 10px;
        box-shadow: 0 20px 52px rgba(0, 0, 0, 0.4), var(--ms-shadow);
        color: var(--ms-text);
        font-family: var(--ms-menu-font);
        overflow: hidden;
        user-select: none;
        backdrop-filter: blur(16px);
        animation: actionPaletteIn 0.14s cubic-bezier(0.22, 1, 0.36, 1);
      }

      @keyframes actionPaletteIn {
        from { opacity: 0; transform: translateY(-6px) scale(0.982); }
        to   { opacity: 1; transform: translateY(0)    scale(1);      }
      }

      /* ── Search bar ─────────────────────────────────────────────────────── */
      .arcgis-action-palette-search {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--ms-divider);
      }

      .arcgis-action-palette-search-icon {
        width: 16px;
        min-width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--ms-accent-dim);
        opacity: 0.7;
        flex-shrink: 0;
      }

      .arcgis-action-palette-search-icon svg {
        width: 16px;
        height: 16px;
      }

      .arcgis-action-palette-search input {
        width: 100%;
        min-width: 0;
        background: var(--ms-bg-input);
        border: 1px solid var(--ms-border);
        border-radius: 6px;
        color: var(--ms-text);
        font-family: var(--ms-menu-font);
        font-size: 13px;
        outline: none;
        padding: 7px 10px;
        transition: border-color 0.12s ease, box-shadow 0.12s ease;
      }

      .arcgis-action-palette-search input::placeholder {
        color: var(--ms-text-dim);
        opacity: 0.7;
      }

      .arcgis-action-palette-search input:focus {
        border-color: var(--ms-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--ms-accent) 20%, transparent);
      }

      /* ── List area ──────────────────────────────────────────────────────── */
      .arcgis-action-palette-list {
        max-height: min(390px, calc(100vh - 150px));
        overflow: auto;
        padding: 4px 6px;
      }

      .arcgis-action-palette-list::-webkit-scrollbar { width: 5px; }
      .arcgis-action-palette-list::-webkit-scrollbar-track { background: transparent; }
      .arcgis-action-palette-list::-webkit-scrollbar-thumb {
        background: var(--ms-scrollbar-thumb);
        border-radius: 3px;
      }

      /* ── Category header ────────────────────────────────────────────────── */
      .arcgis-action-palette-category {
        font-family: var(--ms-menu-font);
        font-size: var(--ms-fs-xs);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ms-accent-dim);
        border-left: 2px solid var(--ms-accent);
        padding: 5px 6px 4px;
        margin: 8px 2px 3px;
        opacity: 0.85;
      }

      /* ── Action rows ────────────────────────────────────────────────────── */
      .arcgis-action-palette-row {
        width: 100%;
        min-height: 38px;
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--ms-text);
        cursor: pointer;
        font-family: var(--ms-menu-font);
        margin: 1px 0;
        padding: 6px 8px;
        text-align: left;
        transition: background-color 0.08s ease, border-color 0.08s ease;
      }

      .arcgis-action-palette-row.selected,
      .arcgis-action-palette-row:hover {
        background: var(--ms-bg-input);
        border-color: color-mix(in srgb, var(--ms-accent) 45%, transparent);
      }

      .arcgis-action-palette-row:active {
        transform: translateY(1px);
      }

      .arcgis-action-palette-row:disabled {
        cursor: default;
        opacity: 0.4;
      }

      /* ── Row icon slot ──────────────────────────────────────────────────── */
      .arcgis-action-palette-icon {
        width: 18px;
        min-width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--ms-accent-dim);
        opacity: 0.85;
        flex-shrink: 0;
      }

      .arcgis-action-palette-icon svg {
        width: 16px;
        height: 16px;
      }

      /* ── Row text ───────────────────────────────────────────────────────── */
      .arcgis-action-palette-copy {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .arcgis-action-palette-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--ms-menu-font);
        font-size: 13px;
        font-weight: 500;
        color: var(--ms-text);
      }

      .arcgis-action-palette-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--ms-menu-font);
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        opacity: 0.8;
      }

      /* ── Shortcut badge ─────────────────────────────────────────────────── */
      .arcgis-action-palette-shortcut {
        font-family: var(--ms-menu-font);
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        background: rgba(0, 0, 0, 0.18);
        border: 1px solid var(--ms-divider);
        border-radius: 4px;
        padding: 2px 6px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* ── Empty / hint ───────────────────────────────────────────────────── */
      .arcgis-action-palette-empty {
        padding: 24px 12px;
        font-family: var(--ms-menu-font);
        font-size: 13px;
        color: var(--ms-text-dim);
        text-align: center;
        opacity: 0.7;
      }

      .arcgis-action-palette-hint {
        border-top: 1px solid var(--ms-divider);
        font-family: var(--ms-menu-font);
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        padding: 7px 12px 9px;
        opacity: 0.65;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Sort menu items by group and order
   */
  private sortMenuItems(items: ContextMenuItem[]): ContextMenuItem[] {
    return [...items].sort((a, b) => {
      // First sort by group
      if (a.group && b.group) {
        if (a.group !== b.group) {
          return a.group.localeCompare(b.group);
        }
      } else if (a.group && !b.group) {
        return -1;
      } else if (!a.group && b.group) {
        return 1;
      }

      // Then sort by order
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      } else if (a.order !== undefined) {
        return -1;
      } else if (b.order !== undefined) {
        return 1;
      }

      // Finally sort by label
      const labelA = typeof a.label === 'function' ? a.id : a.label;
      const labelB = typeof b.label === 'function' ? b.id : b.label;
      return labelA.localeCompare(labelB);
    });
  }

  /**
   * Destroy the menu and clean up resources
   */
  public destroy(): void {
    if (this.menuElement && this.menuElement.parentNode) {
      this.menuElement.parentNode.removeChild(this.menuElement);
    }
    if (this.paletteElement && this.paletteElement.parentNode) {
      this.paletteElement.parentNode.removeChild(this.paletteElement);
    }

    document.removeEventListener('click', this._onDocClickHideMenu);
    document.removeEventListener('click', this._onDocClickHidePalette);
    document.removeEventListener('keydown', this._onDocKeyDown);
    this.menuItems.clear();
    this.view = null;
    this.activeGraphic = null;
    ContextMenuManager.instance = null as any;
  }
}

export default ContextMenuManager;


