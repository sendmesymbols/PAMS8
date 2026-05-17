import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import Evented from '@arcgis/core/core/Evented';
import Point from '@arcgis/core/geometry/Point';
import MeasurementEngine from '../Engines/MeasurementEngine';
import WeaponEffectEngine from '../Engines/Analysis/WeaponEffectEngine';
import LOSEngine from '../Engines/Analysis/LOSEngine';
import TrajectoryEngine from '../Engines/Analysis/TrajectoryEngine';
import BufferEngine from '../Engines/Analysis/BufferEngine';
import CorridorEngine from '../Engines/Analysis/CorridorEngine';
import FlightEngine from '../Engines/Analysis/FlightEngine';
import { EffectEngine } from '../Engines/Analysis/EffectEngine';
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
    readonly menuItems: Map<string, ContextMenuItem[]>;
    private layerManager;
    private options;
    private clickPoint;
    private originalEvent;
    private _measurementEngine;
    private _symbolEngine;
    private _weaponEffectEngine;
    private _losEngine;
    private _trajectoryEngine;
    private _bufferEngine;
    private _corridorEngine;
    private _flightEngine;
    private _effectEngine;
    private _deploymentBuilderEngine;
    private _enabled;
    private _pointerDownHandle;
    private _contextMenuHandler;
    private _contextMenuContainer;
    private _dynamicItemProviders;
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
    enable(): void;
    disable(): void;
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
     * Link a MeasurementEngine so the context menu gains a measurement section.
     * The section is rendered at the bottom of every right-click menu and allows
     * the user to toggle measurements on/off and measure the selected graphic.
     */
    linkMeasurementEngine(engine: MeasurementEngine): void;
    /**
     * Link a SymbolEngine so the context menu can show a "Stop Continuous Mode"
     * option whenever continuous creation mode is active.
     */
    linkSymbolEngine(engine: {
        creationMode: 'single' | 'continuous';
        stopContinuousMode(): void;
    }): void;
    /**
     * Link a WeaponEffectEngine so the "Analysis → Weapon Engagement Zone"
     * context menu item opens the WEZ panel with the right-clicked graphic
     * as the observer origin.
     */
    linkWeaponEffectEngine(engine: WeaponEffectEngine | null): void;
    /**
     * Link a LOSEngine so the "Analysis → Line of Sight" context menu item
     * opens the LOS panel with the right-clicked graphic as the observer origin.
     */
    linkLOSEngine(engine: LOSEngine | null): void;
    /**
     * Link a TrajectoryEngine so the "Analysis → Projectile Trajectory" item
     * opens the trajectory panel with the right-clicked graphic as fire origin.
     */
    linkTrajectoryEngine(engine: TrajectoryEngine | null): void;
    /**
     * Link a BufferEngine so the "Analysis → Buffer and Threat Rings" item
     * opens the buffer panel with the right-clicked graphic as source origin.
     */
    linkBufferEngine(engine: BufferEngine | null): void;
    /**
     * Link a CorridorEngine so the "Analysis -> Corridor Analysis" item
     * opens the corridor panel with the right-clicked graphic as route origin.
     */
    linkCorridorEngine(engine: CorridorEngine | null): void;
    /**
     * Link a FlightEngine so the "Analysis -> UAV Flight Analysis" item
     * opens the UAV mission panel with the right-clicked graphic as origin.
     */
    linkFlightEngine(engine: FlightEngine | null): void;
    /**
     * Link an EffectEngine so the "Analysis -> Effects Radius" item
     * opens the effects panel.
     */
    linkEffectEngine(engine: EffectEngine | null): void;
    /**
     * Link a DeploymentBuilderEngine so the "Open Deployment Builder" item
     * appears in all graphic right-click menus when set.
     */
    linkDeploymentBuilderEngine(engine: {
        openWidget(): void;
    } | null): void;
    /** Null out all analysis engine references so the Analysis submenu is hidden. */
    unlinkAnalysisEngines(): void;
    /**
     * Register a function that returns extra context menu items dynamically.
     * Called each time the menu opens, so items can depend on runtime state
     * (e.g. menu items that depend on current application state).
     */
    addDynamicItemProvider(provider: (graphic: Graphic) => ContextMenuItem[]): void;
    /**
     * Returns the graphic that was most recently right-clicked.
     * Useful for keyboard-shortcut handlers that need a target graphic.
     */
    getLastClickedGraphic(): Graphic | null;
    /**
     * Display the context menu at the given coordinates
     */
    private showMenuAt;
    /**
     * Recursively render menu items into a container element.
     * Items with `children` become submenu triggers; others are leaf actions.
     */
    private renderMenuItems;
    /**
     * Hide the context menu
     */
    private hideMenu;
    /**
     * Handle menu item clicks
     */
    private handleMenuItemClick;
    /**
     * Remove event listeners from the previous view before re-initialization.
     */
    private teardownViewEvents;
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
