import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../Managers/GraphicsLayerManager";
/**
 * SelectionEngine — manages multi-symbol selection and batch operations.
 *
 * Features:
 *   - Left-click a symbol           → select it (clear others)
 *   - Shift+click                   → toggle symbol in / out of selection
 *   - Click on empty ground         → clear selection
 *   - moveSelected()                → SketchVM proxy-drag all selected symbols
 *   - deleteSelected()              → remove all selected, one undo entry
 *   - alignHorizontal/Vertical()    → spread evenly along axis
 *   - arrangeSquare/Triangle/InvertedTriangle() → formation layouts
 *
 * Events emitted: "selectionChange" → { selected: Graphic[] }
 */
declare class SelectionEngine {
    private _getView;
    private _layerManager;
    private _selected;
    private _highlights;
    private _highlightLayer;
    private _clickHandle;
    private _targetLayerIds;
    private _sketchVM;
    private _eventListeners;
    private _annotationRefresh;
    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager);
    /** Register a callback that re-annotates a graphic after its geometry is moved. */
    setAnnotationRefreshCallback(fn: (graphic: Graphic) => void): void;
    get view(): MapView | SceneView;
    onViewChanged(newView: MapView | SceneView): void;
    /**
     * Start listening for click events on the given layer IDs.
     */
    activate(targetLayerIds: string[]): void;
    deactivate(): void;
    /** Cancel any in-progress moveSelected operation without clearing the selection. */
    cancelMove(): void;
    selectGraphic(graphic: Graphic): void;
    deselectGraphic(graphic: Graphic): void;
    toggleGraphic(graphic: Graphic): void;
    clearSelection(): void;
    
    selectSimilarSameSIDC(graphic: Graphic): void;
    selectSimilarSameEchelon(graphic: Graphic): void;
    selectOwnOnly(): void;
    selectEnemy(): void;
    selectPointSymbols(): void;
    selectAreaSymbols(): void;
    selectLineSymbols(): void;
    selectWithin(graphic: Graphic, includeSelf?: boolean): void;

    isSelected(graphic: Graphic): boolean;
    get selectedGraphics(): Graphic[];
    get count(): number;
    /**
     * Create a bounding-box proxy graphic and let the user drag it.
     * On completion, apply the same delta to every selected graphic.
     *
     * @param onComplete  Called with { graphics, dx, dy } when move finishes.
     *                    Pass an undo-push callback here.
     */
    moveSelected(onComplete?: (result: {
        graphics: Graphic[];
        dx: number;
        dy: number;
    }) => void): void;
    /**
     * Delete all selected graphics.
     * @param onEntry Called once with an UndoEntry so the caller can push it to the undo stack.
     */
    deleteSelected(onEntry?: (entry: {
        label: string;
        undo: () => void;
        redo: () => void;
    }) => void): void;
    /**
     * Spread all selected symbols along a horizontal line (equal X spacing, shared Y = centroid Y).
     */
    alignHorizontal(onEntry?: (e: any) => void): void;
    /**
     * Spread all selected symbols along a vertical line (equal Y spacing, shared X = centroid X).
     */
    alignVertical(onEntry?: (e: any) => void): void;
    alignLeft(onEntry?: (e: any) => void): void;
    alignRight(onEntry?: (e: any) => void): void;
    alignTop(onEntry?: (e: any) => void): void;
    alignBottom(onEntry?: (e: any) => void): void;
    /** Move all symbols so their centroids share the same X (vertical centre axis). */
    centerOnX(onEntry?: (e: any) => void): void;
    /** Move all symbols so their centroids share the same Y (horizontal centre axis). */
    centerOnY(onEntry?: (e: any) => void): void;
    private _alignEdge;
    private _align;
    /**
     * Arrange selected symbols in a square grid centred on their collective centroid.
     * When `spacing` is omitted the mean nearest-neighbour distance of the current
     * selection is used, so the formation respects the existing scale of the map.
     */
    arrangeSquare(spacing?: number, onEntry?: (e: any) => void): void;
    /** Arrange in a triangle formation (1 front, widening to rear). */
    arrangeTriangle(spacing?: number, onEntry?: (e: any) => void): void;
    /** Arrange in an inverted triangle (wide front, narrowing to rear). */
    arrangeInvertedTriangle(spacing?: number, onEntry?: (e: any) => void): void;
    /** V-shape: one lead symbol at the point, two arms trailing back at ~45°. */
    arrangeWedge(spacing?: number, onEntry?: (e: any) => void): void;
    /** Diagonal staircase, trailing left and rear. */
    arrangeEchelonLeft(spacing?: number, onEntry?: (e: any) => void): void;
    /** Diagonal staircase, trailing right and rear. */
    arrangeEchelonRight(spacing?: number, onEntry?: (e: any) => void): void;
    /** Single file, evenly spaced along the Y axis (north–south column). */
    arrangeColumn(spacing?: number, onEntry?: (e: any) => void): void;
    /** Single file, evenly spaced along the X axis (east–west line). */
    arrangeLine(spacing?: number, onEntry?: (e: any) => void): void;
    /** Distribute symbols on the perimeter of a rotated square (N/E/S/W corners first). */
    arrangeDiamond(spacing?: number, onEntry?: (e: any) => void): void;
    /** Distribute symbols evenly around a circle; arc-spacing equals the computed spacing. */
    arrangeCircle(spacing?: number, onEntry?: (e: any) => void): void;
    private _arrange;
    private _formationPositions;
    /** Build triangle row counts that sum to n: [1, 2, 3, ...] */
    private _triangleRows;
    /**
     * Wedge (V-shape): one tip at the front, arms alternating left/right going back.
     * Odd remainders go to a centre column behind the last arm pair.
     */
    private _wedgePositions;
    /**
     * Echelon: diagonal staircase.
     * Left: lead is top-right, trail goes down-left.
     * Right: lead is top-left, trail goes down-right.
     */
    private _echelonPositions;
    /** Column: single file along Y axis, evenly spaced, all at the same X. */
    private _columnPositions;
    /** Line: single file along X axis, evenly spaced, all at the same Y. */
    private _linePositions;
    /**
     * Diamond: symbols distributed evenly on the perimeter of a rotated square
     * (radius = spacing).  For n=4 this gives the classic N/E/S/W diamond.
     */
    private _diamondPerimeterPositions;
    /**
     * Circle: symbols distributed evenly on a circle whose arc-spacing ≈ spacing.
     * Starts at the top (north) and goes clockwise.
     */
    private _circlePositions;
    /**
     * Derive a formation spacing from the current layout of the selected graphics.
     *
     * Algorithm: mean nearest-neighbour distance across all selected symbol centroids.
     * This respects whatever zoom-level / map-scale the user is working at.
     * If all symbols are stacked on the same point a pixel-based fallback is used.
     */
    private _computeSpacing;
    /** Snapshot geometries before a bulk operation so undo can restore them. */
    private _snapshots;
    /**
     * Bounding edges of a graphic's geometry.
     * Point symbols use their coordinates directly (no spatial extent).
     * Line/area symbols use the geometry's extent.
     */
    private _edges;
    private _graphicId;
    private _centroid;
    private _applyDelta;
    private _boundingBox;
    private _bboxToPolygon;
    private _addHighlight;
    private _removeHighlight;
    /** Re-sync highlight geometries to current graphic positions (after move/align). */
    private _refreshHighlights;
    private _pushAlignUndo;
    on(type: string, listener: Function): {
        remove(): void;
    };
    private _emit;
}
export default SelectionEngine;
