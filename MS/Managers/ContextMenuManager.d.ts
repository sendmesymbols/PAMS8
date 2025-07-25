import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Graphic from "@arcgis/core/Graphic";
import Evented from "@arcgis/core/core/Evented";
import Point from "@arcgis/core/geometry/Point";
export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: string;
    enabled?: boolean | ((graphic: Graphic) => boolean);
    visible?: boolean | ((graphic: Graphic) => boolean);
    action?: (graphic: Graphic) => void;
    group?: string;
    order?: number;
}
export interface ContextMenuOptions {
    menuClass?: string;
    menuItemClass?: string;
    menuItemHoverClass?: string;
    menuGroupClass?: string;
    menuSeparatorClass?: string;
    targetGraphicTypes?: string[];
    targetLayerIds?: string[];
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
declare class ContextMenuManager extends Evented {
    private static instance;
    private menuElement;
    private view;
    private activeGraphic;
    private menuItems;
    private layerManager;
    private options;
    private clickPoint;
    private originalEvent;
    private constructor();
    /**
     * Get the singleton instance
     */
    static getInstance(): ContextMenuManager;
    /**
     * Initialize with a view and options
     */
    initialize(view: MapView | SceneView, options?: ContextMenuOptions): void;
    /**
     * Configure options
     */
    configure(options: ContextMenuOptions): void;
    /**
     * Register menu items for a specific graphic type
     * @param graphicType The type of graphic these menu items apply to
     * @param items Array of context menu items
     */
    registerMenuItems(graphicType: string, items: ContextMenuItem[]): void;
    /**
     * Add a menu item to an existing graphic type
     */
    addMenuItem(graphicType: string, item: ContextMenuItem): void;
    /**
     * Remove a menu item by ID
     */
    removeMenuItem(graphicType: string, itemId: string): boolean;
    /**
     * Clear all menu items for a specific graphic type
     */
    clearMenuItems(graphicType: string): void;
    /**
     * Clear all menu items for all graphic types
     */
    clearAllMenuItems(): void;
    /**
     * Display the context menu at the given coordinates
     */
    private showMenuAt;
    /**
     * Hide the context menu
     */
    private hideMenu;
    /**
     * Handle menu item clicks
     */
    private handleMenuItemClick;
    /**
     * Set up event listeners on the view
     */
    private setupViewEvents;
    /**
     * Apply default styles to the menu element
     */
    private applyDefaultStyles;
    /**
     * Sort menu items by group and order
     */
    private sortMenuItems;
    /**
     * Destroy the menu and clean up resources
     */
    destroy(): void;
}
export default ContextMenuManager;
