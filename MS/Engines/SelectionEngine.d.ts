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
    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager);
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
    private _align;
    /**
     * Arrange selected symbols in a square grid centred on their collective centroid.
     */
    arrangeSquare(spacing?: number, onEntry?: (e: any) => void): void;
    /**
     * Arrange selected symbols in a triangle formation (1 front, widening to rear).
     */
    arrangeTriangle(spacing?: number, onEntry?: (e: any) => void): void;
    /**
     * Arrange in an inverted triangle (wide front, narrowing to rear).
     */
    arrangeInvertedTriangle(spacing?: number, onEntry?: (e: any) => void): void;
    private _arrange;
    private _formationPositions;
    /** Build triangle row counts that sum to n: [1, 2, 3, ...] */
    private _triangleRows;
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
