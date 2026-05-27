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
    private _isLatLon;
    private _isWebMercator;
    private _rafId;
    private _pendingEvent;
    private _containerEl;
    private _altPressed;
    private _boundKeyDown;
    private _boundKeyUp;
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
    private _indicatorVisible;
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
     * Consumes the most recent pointer event once per animation frame.
     * Bound as a class arrow-property so requestAnimationFrame keeps `this`.
     */
    private _processPendingFrame;
    /**
     * Re-snapshot the target layers without tearing down the active session.
     * Call this if graphics are added/removed mid-draw (e.g. paste during a
     * multi-click polyline) so they become snap targets immediately.
     */
    refreshCandidates(): void;
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
    /**
     * Approximate map-units-per-pixel for the current view.
     * MapView exposes an exact, linear `resolution`. SceneView has none, so we
     * approximate from the current extent — good enough for the coarse spatial
     * pre-filter cull (which already pads with a buffer + per-candidate halfDiag).
     */
    private _getViewResolution;
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
    /**
     * Hide the indicator graphics. They stay on the layer (visible=false) and are
     * re-shown on the next snap — toggling visibility avoids the full GraphicsLayer
     * redraw that add()/remove() triggers every time the cursor leaves/re-enters range.
     */
    private _clear;
    /**
     * Distance between two map points, formatted for display.
     * Geographic / Web Mercator views use inline great-circle (haversine) math —
     * no per-frame Polyline allocation and no geometry-engine call. Planar length
     * in Web Mercator overstates ground distance badly away from the equator, so
     * we never use it there. Other projected systems fall back to the geometry
     * engine so their native units convert correctly.
     */
    private _calcDist;
    /** Convert a point's coords to [lon, lat] degrees for great-circle math. */
    private _toLonLat;
    private _haversineMeters;
    /**
     * Adaptive precision: keep the label readable across magnitudes
     * (e.g. "8473 m", "84.7 m", "0.423 km") without switching the user's chosen
     * unit out from under them.
     */
    private _formatDistance;
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
     * Pre-allocate reusable symbol objects and the three indicator graphics for
     * the current draw session. The graphics are added to the layer once (hidden);
     * subsequent frames toggle their visibility and swap geometry rather than
     * adding/removing, which would force a full layer redraw each time.
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
