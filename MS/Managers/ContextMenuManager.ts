import View from '@arcgis/core/views/View';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Evented from '@arcgis/core/core/Evented';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import Point from '@arcgis/core/geometry/Point';

import GraphicsLayerManager from './GraphicsLayerManager';
import MeasurementEngine from '../Engines/MeasurementEngine';
import WeaponEffectEngine from '../Engines/Analysis/WeaponEffectEngine';
import LOSEngine from '../Engines/Analysis/LOSEngine';
import TrajectoryEngine from '../Engines/Analysis/TrajectoryEngine';
import BufferEngine from '../Engines/Analysis/BufferEngine';
import CorridorEngine from '../Engines/Analysis/CorridorEngine';
import { EffectEngine } from '../Engines/Analysis/EffectEngine';
import ImportExportEngine from '../Engines/ImportExportEngine';

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

/**
 * ContextMenuManager - Singleton class to manage right-click context menus for graphics
 * Uses the ArcGIS Evented class for event handling
 */
class ContextMenuManager extends Evented {
  private static instance: ContextMenuManager;
  private menuElement: HTMLDivElement;
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
  private _effectEngine: EffectEngine | null = null;
  private _importExportEngine: ImportExportEngine | null = null;

  // Event handles for cleanup on re-initialization
  private _pointerDownHandle: any = null;
  private _contextMenuHandler: ((e: Event) => void) | null = null;
  private _contextMenuContainer: HTMLElement | null = null;
  private _dynamicItemProviders: Array<
    (graphic: Graphic) => ContextMenuItem[]
  > = [];

  private constructor() {
    super();

    // Create menu element
    this.menuElement = document.createElement('div');
    this.menuElement.id = 'arcgis-context-menu';
    this.menuElement.style.display = 'none';
    this.menuElement.style.position = 'absolute';
    this.menuElement.style.zIndex = '1000';
    document.body.appendChild(this.menuElement);

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

    // Document click handler to hide menu
    document.addEventListener('click', this.hideMenu.bind(this));
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
  public linkWeaponEffectEngine(engine: WeaponEffectEngine): void {
    this._weaponEffectEngine = engine;
  }

  /**
   * Link a LOSEngine so the "Analysis → Line of Sight" context menu item
   * opens the LOS panel with the right-clicked graphic as the observer origin.
   */
  public linkLOSEngine(engine: LOSEngine): void {
    this._losEngine = engine;
  }

  /**
   * Link a TrajectoryEngine so the "Analysis → Projectile Trajectory" item
   * opens the trajectory panel with the right-clicked graphic as fire origin.
   */
  public linkTrajectoryEngine(engine: TrajectoryEngine): void {
    this._trajectoryEngine = engine;
  }

  /**
   * Link a BufferEngine so the "Analysis → Buffer abd Threat Rings" item
   * opens the buffer panel with the right-clicked graphic as source origin.
   */
  public linkBufferEngine(engine: BufferEngine): void {
    this._bufferEngine = engine;
  }

  /**
   * Link a CorridorEngine so the "Analysis -> Corridor Analysis" item
   * opens the corridor panel with the right-clicked graphic as route origin.
   */
  public linkCorridorEngine(engine: CorridorEngine): void {
    this._corridorEngine = engine;
  }

  /**
   * Link an EffectEngine so the "Analysis -> Effects Radius" item
   * opens the effects panel.
   */
  public linkEffectEngine(engine: EffectEngine): void {
    this._effectEngine = engine;
  }

  public linkImportExportEngine(engine: ImportExportEngine): void {
    this._importExportEngine = engine;
  }

  /**
   * Register a function that returns extra context menu items dynamically.
   * Called each time the menu opens, so items can depend on runtime state
   * (e.g. the current list of saved templates).
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

    // ── Save / Load section ───────────────────────────────────────────────
    if (this._importExportEngine) {
      const sep = document.createElement('div');
      sep.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep);

      const saveLoadItems: ContextMenuItem[] = [
        {
          id: 'save-symbols',
          label: 'Save Symbols',
          icon: `<span style="font-size:14px">💾</span>`,
          action: () => {
            this._importExportEngine!.saveToFile();
          },
        },
        {
          id: 'load-symbols',
          label: 'Load Symbols',
          icon: `<span style="font-size:14px">📂</span>`,
          action: () => {
            this._importExportEngine!.loadFromFile();
          },
        },
        {
          id: 'save-as-plan',
          label: 'Save Plan',
          icon: `<span style="font-size:14px">💾</span>`,
          action: () => {
            this._importExportEngine!.savePlanToFile();
          },
        },
        {
          id: 'load-plan',
          label: 'Load Plan',
          icon: `<span style="font-size:14px">📂</span>`,
          action: () => {
            this._importExportEngine!.loadPlanFromFile();
          },
        },
      ];

      const saveLoadItem = document.createElement('div');
      saveLoadItem.className = this.options.menuItemClass || '';
      saveLoadItem.classList.add('has-submenu');
      saveLoadItem.style.position = 'relative';
      saveLoadItem.innerHTML = `<span class="menu-icon" style="font-size:14px">📁</span><span style="flex:1">Save / Load</span>`;

      const submenuEl = document.createElement('div');
      submenuEl.className = 'arcgis-submenu';
      this.renderMenuItems(saveLoadItems, submenuEl, graphic, x, y);
      saveLoadItem.appendChild(submenuEl);

      saveLoadItem.addEventListener('mouseenter', () => {
        saveLoadItem.classList.add(this.options.menuItemHoverClass || '');
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
      saveLoadItem.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!submenuEl.matches(':hover') && !saveLoadItem.matches(':hover')) {
            saveLoadItem.classList.remove(this.options.menuItemHoverClass || '');
            submenuEl.style.display = 'none';
          }
        }, 100);
      });
      submenuEl.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!submenuEl.matches(':hover') && !saveLoadItem.matches(':hover')) {
            saveLoadItem.classList.remove(this.options.menuItemHoverClass || '');
            submenuEl.style.display = 'none';
          }
        }, 100);
      });

      this.menuElement.appendChild(saveLoadItem);
    }
    // ───────────────────────────────────────────────────────────────────

    this.renderMenuItems(items, this.menuElement, graphic, x, y);

    // ── Analysis section ────────────────────────────────────────────────
    {
      const sep = document.createElement('div');
      sep.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep);

      const analysisItems: ContextMenuItem[] = [
        {
          id: 'analysis-los',
          label: 'Line of Sight',
          icon: `<span style="font-size:14px">👁️</span>`,
          action: (g: Graphic) => {
            if (this._losEngine && this.view) {
              this._losEngine.open(g, this.view);
            }
          },
        },
        {
          id: 'analysis-wez',
          label: 'Weapon Engagement Zone',
          icon: `<span style="font-size:14px">🎯</span>`,
          action: (g: Graphic) => {
            if (this._weaponEffectEngine && this.view) {
              this._weaponEffectEngine.open(g, this.view);
            }
          },
        },
        {
          id: 'analysis-trajectory',
          label: 'Projectile Trajectory',
          icon: `<span style="font-size:14px">📈</span>`,
          action: (g: Graphic) => {
            if (this._trajectoryEngine && this.view) {
              this._trajectoryEngine.open(g, this.view);
            }
          },
        },
        {
          id: 'analysis-buffer',
          label: 'Buffer abd Threat Rings',
          icon: `<span style="font-size:14px">⭕</span>`,
          action: (g: Graphic) => {
            if (this._bufferEngine && this.view) {
              this._bufferEngine.open(g, this.view);
            }
          },
        },
        {
          id: 'analysis-corridor',
          label: 'Corridor Analysis',
          icon: `<span style="font-size:14px">🛣️</span>`,
          action: (g: Graphic) => {
            if (this._corridorEngine && this.view) {
              this._corridorEngine.open(g, this.view);
            }
          },
        },
        {
          id: 'analysis-effects',
          label: 'Effect Analysis',
          icon: `<span style="font-size:14px">💥</span>`,
          action: (g: Graphic) => {
            if (this._effectEngine && this.view) {
              this._effectEngine.open(g, this.view);
            }
          },
        },
      ];

      const analysisItem = document.createElement('div');
      analysisItem.className = this.options.menuItemClass || '';
      analysisItem.classList.add('has-submenu');
      analysisItem.style.position = 'relative';
      analysisItem.innerHTML = `<span class="menu-icon" style="font-size:14px">🔭</span><span style="flex:1">Analysis</span>`;

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
    }
    // ────────────────────────────────────────────────────────────────────

    // ── Measurement section ──────────────────────────────────────────────
    if (this._measurementEngine) {
      const isOn = this._measurementEngine.isEnabled;
      const opts = this._measurementEngine.getOptions();

      const sep = document.createElement('div');
      sep.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep);

      const header = document.createElement('div');
      header.style.cssText =
        'padding:8px 14px 4px;font-size:10px;color:#5a8ad0;font-weight:700;text-transform:uppercase;letter-spacing:1px';
      header.textContent = 'Measurements';
      this.menuElement.appendChild(header);

      const toggleItem = document.createElement('div');
      toggleItem.className = this.options.menuItemClass || '';
      toggleItem.innerHTML = isOn
        ? `<span class="menu-icon" style="font-size:14px">🔬</span><span>Disable Measurements <span style="color:#4caf50;font-size:10px;margin-left:6px;background:rgba(76,175,80,0.15);padding:2px 6px;border-radius:3px">● ON</span></span>`
        : `<span class="menu-icon" style="font-size:14px">📐</span><span>Enable Measurements <span style="color:#5a7aa8;font-size:10px;margin-left:6px;background:rgba(90,122,168,0.15);padding:2px 6px;border-radius:3px">○ OFF</span></span>`;
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
          ? `<span class="menu-icon" style="font-size:14px">⛰️</span><span>Disable 3D Slant Range</span>`
          : `<span class="menu-icon" style="font-size:14px">⛰️</span><span>Enable 3D Slant Range</span>`;
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
        measureItem.innerHTML = `<span class="menu-icon" style="font-size:14px">📏</span><span>Measure This Symbol</span>`;
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
      stopItem.innerHTML = `<span class="menu-icon" style="font-size:14px">⏹</span><span>Stop Continuous Mode <span style="color:#e5a540;font-size:10px;margin-left:6px;background:rgba(229,165,64,0.15);padding:2px 6px;border-radius:3px">● LOOP</span></span><span class="menu-shortcut">Esc</span>`;
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
              layerId: graphic.layer?.id || '',
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

  /**
   * Hide the context menu
   */
  private hideMenu(): void {
    this.menuElement.style.display = 'none';
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
    const layerId = this.activeGraphic.layer?.id || '';

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
      .arcgis-context-menu {
        background-color: rgba(22, 27, 38, 0.97);
        border: 1px solid rgba(90, 130, 200, 0.3);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(0, 0, 0, 0.15);
        padding: 6px 0;
        min-width: 180px;
        max-width: 320px;
        user-select: none;
        backdrop-filter: blur(12px);
        animation: contextMenuFadeIn 0.15s ease-out;
      }

      @keyframes contextMenuFadeIn {
        from {
          opacity: 0;
          transform: scale(0.96) translateY(-4px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .arcgis-context-menu-item {
        padding: 8px 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        color: #b8c8e0;
        font-size: 12px;
        font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
        transition: all 0.1s ease;
        border-left: 2px solid transparent;
        margin: 0 4px;
        border-radius: 4px;
      }

      .arcgis-context-menu-item:hover,
      .arcgis-context-menu-item-hover {
        background-color: rgba(80, 130, 200, 0.2);
        border-left-color: #64b4ff;
        color: #ffffff;
        padding-left: 16px;
      }

      .arcgis-context-menu-item.disabled {
        color: #4a5a78;
        cursor: default;
      }

      .arcgis-context-menu-item.disabled:hover {
        background-color: inherit;
        border-left-color: transparent;
      }

      .arcgis-context-menu-group {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid rgba(80, 120, 180, 0.15);
      }

      .arcgis-context-menu-group-title {
        padding: 6px 14px;
        font-size: 10px;
        color: #5a8ad0;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .arcgis-context-menu-separator {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(80, 120, 180, 0.2), transparent);
        margin: 6px 12px;
      }

      .menu-icon {
        margin-right: 10px;
        display: inline-flex;
        align-items: center;
        font-size: 14px;
        opacity: 0.9;
      }

      .menu-shortcut {
        margin-left: 16px;
        font-size: 10px;
        color: #5a7aa8;
        white-space: nowrap;
        font-family: 'SF Mono', 'Consolas', monospace;
        background: rgba(0, 0, 0, 0.2);
        padding: 2px 5px;
        border-radius: 3px;
      }

      .arcgis-context-menu-item.has-submenu {
        position: relative;
      }

      .arcgis-context-menu-item.has-submenu::after {
        content: '▸';
        margin-left: auto;
        font-size: 10px;
        color: #5a8ad0;
        flex-shrink: 0;
      }

      .arcgis-submenu {
        display: none;
        position: absolute;
        left: calc(100% + 4px);
        top: -4px;
        background-color: rgba(22, 27, 38, 0.98);
        border: 1px solid rgba(90, 130, 200, 0.3);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        padding: 6px 0;
        min-width: 180px;
        max-width: 300px;
        z-index: 1001;
        backdrop-filter: blur(12px);
        animation: submenuFadeIn 0.12s ease-out;
      }

      @keyframes submenuFadeIn {
        from {
          opacity: 0;
          transform: translateX(-8px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
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
      return a.label.localeCompare(b.label);
    });
  }

  /**
   * Destroy the menu and clean up resources
   */
  public destroy(): void {
    if (this.menuElement && this.menuElement.parentNode) {
      this.menuElement.parentNode.removeChild(this.menuElement);
    }

    document.removeEventListener('click', this.hideMenu.bind(this));
    this.menuItems.clear();
    this.view = null;
    this.activeGraphic = null;
    ContextMenuManager.instance = null as any;
  }
}

export default ContextMenuManager;
