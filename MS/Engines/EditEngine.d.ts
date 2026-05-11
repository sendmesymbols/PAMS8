import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../Managers/GraphicsLayerManager";
import { ContextMenuItem } from "../Managers/ContextMenuManager";
/**
 * EditEngine — interactive move / rotate / scale / reshape for drawn military symbols.
 *
 * Supported operations:
 *   Point symbols   → move via SketchViewModel;
 *                     scale programmatically via scalePointSymbol()
 *   Poly/Polygon    → move + rotate + scale via SketchViewModel transform tool,
 *                     reshape via draggable CTRL_PTS handles
 *
 * Usage:
 *   const editEngine = new EditEngine(() => activeView, layerManager);
 *   editEngine.activate(graphic);          // move (point) or transform (poly)
 *   editEngine.activateReshape(graphic);   // reshape via CTRL_PTS (poly only)
 *   editEngine.deactivate();               // end edit session
 *
 * Events emitted:
 *   "changeInSymbol" – { graphic }  – fired when any edit operation completes
 *   "scalePointSymbol" – { graphic, newSize } – fired after scalePointSymbol()
 */
declare class EditEngine {
    private _getView;
    private _layerManager;
    private _sketchVM;
    private _activeGraphic;
    private _originalGeometry;
    private _originalCtrlPts;
    private _originalBaseLnPts;
    private _additionalSnapshots;
    private _handleLayer;
    private _handleGraphics;
    private _pointerDownHandle;
    private _pointerMoveHandle;
    private _pointerUpHandle;
    private _pointerMoveRawHandle;
    private _isDraggingHandle;
    private _handleDragOccurred;
    private _activeHandleIndex;
    private _suppressNextClick;
    private _clickHandle;
    private _keydownListener;
    private _eventListeners;
    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager);
    get view(): MapView | SceneView;
    /**
     * Activate interactive editing for a graphic.
     *
     * - Point geometry   → SketchViewModel move tool
     * - Polyline/Polygon → SketchViewModel transform tool (move + rotate + scale)
     *
     * Annotations are removed at the start of the operation and restored
     * when the operation completes or is cancelled.
     */
    activate(graphic: Graphic, additionalGraphics?: Graphic[]): void;
    /**
     * Activate reshape mode for a poly/polygon symbol.
     * Places a draggable handle at each CTRL_PT; dragging a handle updates
     * that control point in drawEssentials and calls the symbol's createSymbol()
     * method to redraw the geometry live.
     */
    activateEditControlPoints(graphic: Graphic): void;
    /**
     * Programmatically scale a point symbol by a factor.
     * Updates SIZE in drawEssentials and emits "scalePointSymbol" so the caller
     * can regenerate the PictureMarkerSymbol with the new size.
     *
     * @param scaleFactor  e.g. 1.2 = 20 % larger, 0.8 = 20 % smaller
     */
    scalePointSymbol(graphic: Graphic, scaleFactor: number): void;
    /**
     * End all active edit operations and clean up all resources.
     * Safe to call even when no edit is in progress.
     */
    deactivate(): void;
    /** True while control-point handles are visible on screen. */
    get isEditingControlPoints(): boolean;
    /** True while SketchViewModel move/transform is active (not control-point mode). */
    get isModifyingSymbol(): boolean;
    /** Register a listener for EditEngine events ("changeInSymbol", "scalePointSymbol"). */
    on(type: string, listener: Function): {
        remove(): void;
    };
    private _activatePointEdit;
    private _activatePolyEdit;
    /**
     * After SketchViewModel has updated the graphic's geometry, compute the
     * 2D similarity transform (translate + rotate + uniform scale) that was
     * applied, and propagate it to CTRL_PTS and BASE_LN_PTS in drawEssentials
     * so they remain consistent for future saves or redraws.
     */
    private _syncCtrlPts;
    /** Sync CTRL_PTS for an additional graphic using its own pre-edit snapshot. */
    private _syncCtrlPtsFrom;
    /**
     * Derive the exact 2D similarity transform mapping oldGeom → newGeom.
     *
     * Uses two vertex correspondences (SketchViewModel preserves vertex order)
     * to solve (a, b, tx, ty) in closed form:
     *   a  = (Δx·Δx' + Δy·Δy') / (Δx² + Δy²)
     *   b  = (Δx·Δy' − Δy·Δx') / (Δx² + Δy²)
     *   tx = x1' − a·x1 + b·y1
     *   ty = y1' − b·x1 − a·y1
     *
     * This avoids any pivot/centroid assumption, so asymmetric shapes (e.g.
     * MainAttack arrows) transform exactly regardless of which side is scaled.
     */
    private _computeAffineTransform;
    /** Apply the 2D similarity transform to a single Point. */
    private _applyAffineToPoint;
    /** Returns the vertex at `index` from the first path/ring of geom, or null. */
    private _getVertex;
    /** Render a visible handle graphic at each CTRL_PT position. */
    private _showHandles;
    /**
     * Wire up pointer-down / pointer-move / pointer-up on the view to detect
     * handle drags and update CTRL_PTS + redraw the symbol live.
     */
    private _setupHandleDrag;
    /**
     * Call the symbol's own createSymbol() via drawEssentials.SCOPE and update
     * the graphic's geometry.  SCOPE is set to the symbol instance during init().
     */
    private _redrawFromCtrlPts;
    /**
     * Insert a new CTRL_PT at mapPt, splitting the nearest existing segment.
     * Updates handles and triggers a live redraw.
     */
    private _addControlPoint;
    /**
     * Remove an added control point at the given handle index.
     * Guards against removing below 2 points (minimum for a valid polyline).
     */
    private _removeControlPoint;
    /**
     * Return the index at which to insert mapPt so it falls on the nearest segment.
     */
    private _findInsertionIndex;
    /** Minimum distance from point P to segment A→B in map coordinates. */
    private _distancePtToSegment;
    private _clearHandles;
    private _clearPointerHandlers;
    private _deAnnotate;
    private _reAnnotate;
    private _getDrawEssentials;
    /** Deep-clone an array of CTRL_PTS (handles both Point instances and plain {x,y} objects). */
    private _cloneCtrlPts;
    /** Deep-clone BASE_LN_PTS ({ startPt, midPt, endPt }). */
    private _cloneBaseLnPts;
    private _emit;
    /**
     * Returns the Edit submenu item tree.
     * Call from SymbolEngine.registerContextMenuItems() and spread the result.
     */
    buildContextMenuItems(onModify: (graphic: Graphic) => void, onActivateCtrlPts: (graphic: Graphic) => void, onDeactivate: () => void): ContextMenuItem[];
}
export default EditEngine;
