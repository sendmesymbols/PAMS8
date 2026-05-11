/**
 * ProximityEngine.ts
 * Shows a real-time snap indicator (dot + dashed line + distance label) while
 * drawing a symbol, connecting the cursor to the nearest point on any existing
 * graphic in the configured target layers.
 *
 * Singleton — use ProximityEngine.getInstance().
 *
 * Events emitted on document:
 *   "proximity-state-change"  – { state: "enabled"|"disabled", isEnabled: boolean }
 *   "proximity-snap"          – { coordinate: {x,y}, distance: string, unit: string }
 *   "proximity-clear"         – {}
 *   "proximity-hint"          – { message: string, phase: "idle"|"active"|"snapped"|"no-targets" }
 *                                 Contextual guidance emitted at key moments.
 *
 * Integration:
 *   - SymbolEngine calls start() once, activate() when drawing begins,
 *     deactivate() when drawing ends, and onViewChanged() on view switch.
 */
export type ProximityHintPhase = 'idle' | 'active' | 'snapped' | 'no-targets';
export interface ProximityHint {
    message: string;
    phase: ProximityHintPhase;
}
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
export type ProximityDistanceUnit = 'feet' | 'miles' | 'kilometers' | 'nautical-miles' | 'meters' | 'yards';
export interface ProximityOptions {
    nearestVertex?: boolean;
    nearestCoordinate?: boolean;
    showDistance?: boolean;
    showDirection?: boolean;
    distanceUnit?: ProximityDistanceUnit;
    snapRadiusPx?: number;
    lineColor?: [number, number, number];
    lineOpacity?: number;
    lineWidth?: number;
    markerColor?: [number, number, number];
    markerSize?: number;
    fontSize?: number;
    fontColor?: [number, number, number];
}
declare class ProximityEngine {
    private static _instance;
    private _view;
    private _isEnabled;
    private _isActive;
    private _isGeodesic;
    private _lastTick;
    private _pointerHandle;
    private _boundPointerMove;
    private _layer;
    private _snapGraphic;
    private _lineGraphic;
    private _labelGraphic;
    private _targetLayerIds;
    private _candidateSnapshot;
    private _candidateExtents;
    private _dotSym;
    private _lineSym;
    private _txtSym;
    private _lastSnapX;
    private _lastSnapY;
    private _inClearedState;
    private _nearestVertex;
    private _nearestCoordinate;
    private _showDistance;
    private _showDirection;
    private _distUnit;
    private _snapRadiusPx;
    private _lineColor;
    private _lineOpacity;
    private _lineWidth;
    private _markerColor;
    private _markerSize;
    private _fontSize;
    private _fontColor;
    private constructor();
    static getInstance(): ProximityEngine;
    get isEnabled(): boolean;
    get isActive(): boolean;
    /**
     * Attach to a view and configure target layers + options.
     * Re-call after a view switch via onViewChanged().
     */
    start(view: MapView | SceneView, targetLayerIds: string[], options?: ProximityOptions): void;
    enable(): void;
    disable(): void;
    toggle(): boolean;
    /**
     * Called when drawing starts. Attaches the pointer-move listener.
     * Idempotent — safe to call on every onDrawProgress event.
     */
    activate(): void;
    /**
     * Called when drawing ends. Removes the pointer-move listener and clears graphics.
     */
    deactivate(): void;
    /** Re-attach to a new view after 2D ↔ 3D switch. */
    onViewChanged(view: MapView | SceneView): void;
    setOptions(opts: ProximityOptions): void;
    private _runProximity;
    /** Euclidean distance in map-coordinate units (used for ranking candidates). */
    private _mapDist;
    /** Screen-space pixel distance — used only for optional snapRadiusPx check. */
    private _screenDist;
    /**
     * Draw or update the three indicator graphics:
     *   1. Dot at bestCoord
     *   2. Dashed line from cursor → bestCoord
     *   3. Distance label at midpoint
     *
     * Symbol objects are pre-allocated once in _initReuseObjects() and reused
     * each frame — only their mutable text/color properties are updated.
     */
    private _renderSnap;
    /** Remove all indicator graphics from the layer. Re-created lazily on next snap. */
    private _clear;
    private _calcDist;
    private _calcBearing;
    private _resolveGeodesic;
    /** Safely resolve view.container, which may be a string ID or an HTMLElement. */
    private _resolveContainer;
    private _getOrCreateLayer;
    /**
     * Pre-compute bounding-box center and half-diagonal for a candidate graphic.
     * Used each frame to cull distant candidates before running geometry engine calls.
     */
    private _computeCandidateExtent;
    /**
     * Pre-allocate reusable symbol objects for the current draw session.
     * Subsequent frames mutate these in place rather than constructing new instances.
     */
    private _initReuseObjects;
    private _emitStateChange;
    /** Only dispatches when the snap coordinate has moved by at least 1 map unit. */
    private _emitSnap;
    /** Only dispatches once per cleared state — avoids flooding listeners each frame. */
    private _emitClear;
    private _emitHint;
    /**
     * Returns a snapshot of the engine's current operational state.
     * Useful for status indicators and debugging.
     */
    getStatus(): {
        isEnabled: boolean;
        isActive: boolean;
        unit: ProximityDistanceUnit;
        isGeodesic: boolean;
        targetLayers: number;
        activeGraphics: number;
        snapRadiusPx: number;
    };
    /**
     * Update configuration options at runtime.
     * Only updates options that are provided in the config object.
     */
    updateConfig(config: Partial<ProximityOptions>): void;
    private _refreshIndicatorGraphics;
}
export default ProximityEngine;
