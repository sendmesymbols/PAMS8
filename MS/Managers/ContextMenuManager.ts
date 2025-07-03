import View from "@arcgis/core/views/View";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Evented from "@arcgis/core/core/Evented";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import Point from "@arcgis/core/geometry/Point";

import GraphicsLayerManager from "./GraphicsLayerManager";

export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: string;
    enabled?: boolean | ((graphic: Graphic) => boolean);
    visible?: boolean | ((graphic: Graphic) => boolean);
    action?: (graphic: Graphic) => void;
    // Optional properties for grouping and ordering
    group?: string;
    order?: number;
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
    private menuItems: Map<string, ContextMenuItem[]> = new Map();
    private layerManager: GraphicsLayerManager | null = null;
    private options: ContextMenuOptions;
    private clickPoint: Point | null = null;
    private originalEvent: any = null;

    private constructor() {
        super();

        // Create menu element
        this.menuElement = document.createElement("div");
        this.menuElement.id = "arcgis-context-menu";
        this.menuElement.style.display = "none";
        this.menuElement.style.position = "absolute";
        this.menuElement.style.zIndex = "1000";
        document.body.appendChild(this.menuElement);

        // Default options
        this.options = {
            menuClass: "arcgis-context-menu",
            menuItemClass: "arcgis-context-menu-item",
            menuItemHoverClass: "arcgis-context-menu-item-hover",
            menuGroupClass: "arcgis-context-menu-group",
            menuSeparatorClass: "arcgis-context-menu-separator",
            offsetX: 0,
            offsetY: 0,
            targetGraphicTypes: [],
            targetLayerIds: []
        };

        // Apply default styling
        this.applyDefaultStyles();

        // Document click handler to hide menu
        document.addEventListener("click", this.hideMenu.bind(this));
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
    public initialize(view: MapView | SceneView, options?: ContextMenuOptions): void {
        this.view = view;
        this.options = { ...this.options, ...options };

        // Get layer manager
        this.layerManager = GraphicsLayerManager.getInstance(view);

        // Set view-related styling
        this.menuElement.className = this.options.menuClass || "";

        // Set up view event listeners
        this.setupViewEvents();

        console.log("ContextMenuManager initialized for view:", view.container?.id);
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
    public registerMenuItems(graphicType: string, items: ContextMenuItem[]): void {
        this.menuItems.set(graphicType, items);
        console.log(`Registered ${items.length} menu items for graphic type: ${graphicType}`);
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

        const filteredItems = items.filter(item => item.id !== itemId);
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
     * Display the context menu at the given coordinates
     */
    private showMenuAt(x: number, y: number, graphic: Graphic): void {
        // Clear existing menu content
        this.menuElement.innerHTML = "";

        // Get graphic type from attributes
        const graphicType = graphic.attributes?.graphicType || graphic.attributes?.type;

        // Check if we have menu items for this graphic type
        if (!graphicType || !this.menuItems.has(graphicType)) {
            console.warn(`No menu items registered for graphic type: ${graphicType}`);
            return;
        }

        // Store the active graphic
        this.activeGraphic = graphic;

        // Get menu items for this graphic type
        const items = this.menuItems.get(graphicType)!;

        // Create menu structure
        let currentGroup: string | null = null;
        let groupContainer: HTMLDivElement | null = null;

        items.forEach(item => {
            // Check visibility and enabled state if they are functions
            const isVisible = typeof item.visible === 'function' ? item.visible(graphic) :
                item.visible !== undefined ? item.visible : true;

            if (!isVisible) return;

            const isEnabled = typeof item.enabled === 'function' ? item.enabled(graphic) :
                item.enabled !== undefined ? item.enabled : true;

            // Handle grouping
            if (item.group && item.group !== currentGroup) {
                // Create a new group
                currentGroup = item.group;
                groupContainer = document.createElement("div");
                groupContainer.className = this.options.menuGroupClass || "";

                const groupTitle = document.createElement("div");
                groupTitle.textContent = currentGroup;
                groupTitle.className = "arcgis-context-menu-group-title";
                groupContainer.appendChild(groupTitle);

                this.menuElement.appendChild(groupContainer);
            }

            // Create menu item
            const menuItem = document.createElement("div");
            menuItem.className = this.options.menuItemClass || "";
            menuItem.dataset.id = item.id;

            // Apply disabled state if needed
            if (!isEnabled) {
                menuItem.classList.add("disabled");
            }

            // Create content with icon and label
            if (item.icon) {
                const iconSpan = document.createElement("span");
                iconSpan.className = "menu-icon";
                iconSpan.innerHTML = item.icon;
                menuItem.appendChild(iconSpan);
            }

            const labelSpan = document.createElement("span");
            labelSpan.textContent = item.label;
            menuItem.appendChild(labelSpan);

            // Add event listener for clicks
            if (isEnabled) {
                menuItem.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.handleMenuItemClick(item.id);
                });

                // Add hover effect
                menuItem.addEventListener("mouseenter", () => {
                    menuItem.classList.add(this.options.menuItemHoverClass || "");
                });

                menuItem.addEventListener("mouseleave", () => {
                    menuItem.classList.remove(this.options.menuItemHoverClass || "");
                });
            }

            // Add to group or directly to menu
            if (groupContainer && item.group === currentGroup) {
                groupContainer.appendChild(menuItem);
            } else {
                this.menuElement.appendChild(menuItem);
            }
        });

        // Position the menu
        this.menuElement.style.left = `${x + (this.options.offsetX || 0)}px`;
        this.menuElement.style.top = `${y + (this.options.offsetY || 0)}px`;

        // Display the menu
        this.menuElement.style.display = "block";
    }

    /**
     * Hide the context menu
     */
    private hideMenu(): void {
        this.menuElement.style.display = "none";
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
        const graphicType = this.activeGraphic.attributes?.graphicType ||
            this.activeGraphic.attributes?.type;

        if (!graphicType || !this.menuItems.has(graphicType)) return;

        // Find menu item
        const items = this.menuItems.get(graphicType)!;
        const item = items.find(i => i.id === actionId);

        if (!item) {
            console.warn(`Menu item with ID ${actionId} not found`);
            return;
        }

        // Execute action if available
        if (item.action) {
            item.action(this.activeGraphic);
        }

        // Emit event
        const layerId = this.activeGraphic.layer?.id || "";

        this.emit("menu-item-click", {
            actionId,
            graphic: this.activeGraphic,
            layerId,
            graphicType,
            view: this.view,
            point: this.clickPoint!,
            originalEvent: this.originalEvent
        } as MenuItemEvent);

        // Hide menu
        this.hideMenu();
    }

    /**
     * Set up event listeners on the view
     */
    private setupViewEvents(): void {
        if (!this.view) return;

        // Prevent default context menu
        this.view.container.addEventListener("contextmenu", (e) => {
            e.preventDefault();
        });

        // Listen for pointer-down events (to catch right-clicks)
        this.view.on("pointer-down", (event) => {
            // Check if it's a right-click (button property is 2 for right clicks)
            console.log("Click");
            if (event.button === 2) {

                console.log("Right Click");

                // Store original event
                this.originalEvent = event.native;

                // Prevent default behavior
                event.stopPropagation();

                // Hide any existing menu
                this.hideMenu();

                // Hit test to see if a graphic was clicked
                this.view!.hitTest(event).then((response) => {
                    console.log("Hit test", response);
                    // Find first graphic that matches our target criteria
                    const graphicHit = response.results?.find(result => {
                        console.log("find")
                        console.log(result.graphic)
                        if (!result.graphic) return false;

                        console.log("Graphics Found")
                        const graphic = result.graphic;
                        console.log(graphic)
                        const layerId = graphic.layer?.id;
                        const graphicType = graphic.attributes?.graphicType || graphic.attributes?.type;

                        // Check layer filter if specified
                        if (this.options.targetLayerIds && this.options.targetLayerIds.length > 0) {
                            if (!layerId || !this.options.targetLayerIds.includes(layerId)) {
                                return false;
                            }
                        }


                        // Check graphic type filter if specified
                        if (this.options.targetGraphicTypes && this.options.targetGraphicTypes.length > 0) {
                            if (!graphicType || !this.options.targetGraphicTypes.includes(graphicType)) {
                                return false;
                            }
                        }

                        return true;
                    });

                    console.log("graphicHit");
                    console.log(graphicHit);
                    if (graphicHit) {
                        const graphic = graphicHit.graphic;

                        // Store the click point
                        this.clickPoint = this.view!.toMap({ x: event.x, y: event.y });

                        // Show menu at click location
                        this.showMenuAt(event.x, event.y, graphic);
                    }
                });
            }
        });

        // Close menu on map click
        reactiveUtils.on(() => this.view!, "click", this.hideMenu.bind(this));
    }

    /**
     * Apply default styles to the menu element
     */
    private applyDefaultStyles(): void {
        const style = document.createElement("style");
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

        document.removeEventListener("click", this.hideMenu.bind(this));
        this.menuItems.clear();
        this.view = null;
        this.activeGraphic = null;
        ContextMenuManager.instance = null as any;
    }
}

export default ContextMenuManager;