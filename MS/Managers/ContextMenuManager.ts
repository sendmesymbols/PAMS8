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

    this.renderMenuItems(items, this.menuElement, graphic, x, y);

    // ── Measurement section ──────────────────────────────────────────────
    if (this._measurementEngine) {
      const isOn = this._measurementEngine.isEnabled;

      const sep = document.createElement('div');
      sep.className = this.options.menuSeparatorClass || '';
      this.menuElement.appendChild(sep);

      const header = document.createElement('div');
      header.style.cssText =
        'padding:4px 12px 2px;font-size:11px;color:#888;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px';
      header.textContent = 'Measurements';
      this.menuElement.appendChild(header);

      const toggleItem = document.createElement('div');
      toggleItem.className = this.options.menuItemClass || '';
      toggleItem.innerHTML = isOn
        ? `<span class="menu-icon" style="font-size:14px">🔬</span><span>Disable Measurements <span style="color:#4caf50;font-size:11px">● ON</span></span>`
        : `<span class="menu-icon" style="font-size:14px">📐</span><span>Enable Measurements <span style="color:#aaa;font-size:11px">○ OFF</span></span>`;
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
        background-color: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        padding: 5px 0;
        min-width: 150px;
        max-width: 300px;
        user-select: none;
      }
      
      .arcgis-context-menu-item {
        padding: 8px 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        color: #333;
        font-size: 14px;
      }
      
      .arcgis-context-menu-item:hover,
      .arcgis-context-menu-item-hover {
        background-color: #f5f5f5;
      }
      
      .arcgis-context-menu-item.disabled {
        color: #aaa;
        cursor: default;
      }
      
      .arcgis-context-menu-item.disabled:hover {
        background-color: inherit;
      }
      
      .arcgis-context-menu-group {
        margin-top: 5px;
        padding-top: 5px;
        border-top: 1px solid #eee;
      }
      
      .arcgis-context-menu-group-title {
        padding: 4px 12px;
        font-size: 12px;
        color: #777;
        font-weight: bold;
      }
      
      .arcgis-context-menu-separator {
        height: 1px;
        background-color: #eee;
        margin: 5px 0;
      }
      
      .menu-icon {
        margin-right: 8px;
        display: inline-flex;
        align-items: center;
      }

      .menu-shortcut {
        margin-left: 16px;
        font-size: 11px;
        color: #999;
        white-space: nowrap;
      }

      .arcgis-context-menu-item.has-submenu::after {
        content: '▶';
        margin-left: 8px;
        font-size: 10px;
        color: #666;
        flex-shrink: 0;
      }

      .arcgis-submenu {
        display: none;
        position: absolute;
        left: 100%;
        top: 0;
        background-color: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        padding: 5px 0;
        min-width: 180px;
        max-width: 300px;
        z-index: 1001;
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
