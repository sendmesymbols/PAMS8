import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import Color from "@arcgis/core/Color";
import Point from "@arcgis/core/geometry/Point";

import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import { ContextMenuItem } from "../Managers/ContextMenuManager";
import AnnotationEngine from "./AnnotationEngine.ts";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import settingsData from "../Data/Settings.json";
import EngineLogger from "../Support/EngineLogger";

// Layer name for temporary reshape handle graphics
const EDIT_HANDLES_LAYER = "EditHandlesLayer";

/**
 * 2D similarity transform parameters solved from two point correspondences.
 * Encodes translate + rotate + uniform scale as (a, b, tx, ty) where:
 *   x' = a·x − b·y + tx
 *   y' = b·x + a·y + ty
 * This avoids any pivot/centroid assumption and works exactly for any
 * combination of translate, rotate, and uniform scale.
 */
interface AffineTransform {
    a: number;   // scale · cos(angle)
    b: number;   // scale · sin(angle)
    tx: number;
    ty: number;
}

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
class EditEngine {
    private _getView: () => MapView | SceneView;
    private _layerManager: GraphicsLayerManager;

    // SketchViewModel used for move / transform operations
    private _sketchVM: SketchViewModel | null = null;

    // The graphic currently being edited
    private _activeGraphic: Graphic | null = null;

    // Snapshot of the graphic state captured before a SketchViewModel transform begins.
    // Required so we can sync CTRL_PTS after the transform and can restore on cancel.
    private _originalGeometry: any = null;
    private _originalCtrlPts: Point[] | null = null;
    private _originalBaseLnPts: any = null;

    // Additional graphics (from a multi-selection) included in the same transform session.
    private _additionalSnapshots: { graphic: Graphic; geometry: any; ctrlPts: Point[] | null; baseLnPts: any }[] = [];

    // Reshape handle state
    private _handleLayer: GraphicsLayer;
    private _handleGraphics: Graphic[] = [];
    private _pointerDownHandle: any = null;
    private _pointerMoveHandle: any = null;
    private _pointerUpHandle: any = null;
    private _pointerMoveRawHandle: any = null; // cursor/hover indication
    private _isDraggingHandle = false;
    private _handleDragOccurred = false;       // distinguishes click vs real drag on a handle
    private _activeHandleIndex = -1;
    private _suppressNextClick = false;   // true after handle drag so click doesn't add a point
    private _clickHandle: any = null;
    private _keydownListener: ((e: KeyboardEvent) => void) | null = null;

    // External event listeners
    private _eventListeners: Map<string, Function[]> = new Map();

    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager) {
        this._getView = viewProvider;
        this._layerManager = layerManager;
        this._handleLayer = this._layerManager.getOrCreateLayer(EDIT_HANDLES_LAYER);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    get view(): MapView | SceneView {
        return this._getView();
    }

    /**
     * Activate interactive editing for a graphic.
     *
     * - Point geometry   → SketchViewModel move tool
     * - Polyline/Polygon → SketchViewModel transform tool (move + rotate + scale)
     *
     * Annotations are removed at the start of the operation and restored
     * when the operation completes or is cancelled.
     */
    public activate(graphic: Graphic, additionalGraphics: Graphic[] = []): void {
        this.deactivate();
        this._activeGraphic = graphic;

        if (additionalGraphics.length === 0 && graphic.geometry?.type === "point") {
            this._activatePointEdit(graphic);
            EngineLogger.nextStep('Edit Engine', 'Edit mode active — drag symbol to move it');
        } else {
            this._activatePolyEdit(graphic, additionalGraphics);
            EngineLogger.nextStep('Edit Engine', 'Edit mode active — drag handles to move, rotate, or scale');
        }
    }

    /**
     * Activate reshape mode for a poly/polygon symbol.
     * Places a draggable handle at each CTRL_PT; dragging a handle updates
     * that control point in drawEssentials and calls the symbol's createSymbol()
     * method to redraw the geometry live.
     */
    public activateEditControlPoints(graphic: Graphic): void {
        this.deactivate();
        this._activeGraphic = graphic;

        const de = this._getDrawEssentials(graphic);
        const ctrlPts: Point[] | undefined = (de as any)?.CTRL_PTS;

        if (!ctrlPts || ctrlPts.length === 0) {
            EngineLogger.error('Edit Engine', 'No control points found on this symbol — reshape is not available');
            console.warn("EditEngine.activateReshape: no CTRL_PTS found on graphic");
            return;
        }
        EngineLogger.nextStep('Edit Engine', 'Reshape mode active — drag control points to reshape the symbol');

        this._deAnnotate(graphic);
        this._showHandles(ctrlPts);
        this._setupHandleDrag(graphic, de!);

        // Escape key exits reshape mode
        this._keydownListener = (e: KeyboardEvent) => {
            if (e.key === "Escape") this.deactivate();
        };
        document.addEventListener("keydown", this._keydownListener);
    }

    /**
     * Programmatically scale a point symbol by a factor.
     * Updates SIZE in drawEssentials and emits "scalePointSymbol" so the caller
     * can regenerate the PictureMarkerSymbol with the new size.
     *
     * @param scaleFactor  e.g. 1.2 = 20 % larger, 0.8 = 20 % smaller
     */
    public scalePointSymbol(graphic: Graphic, scaleFactor: number): void {
        const de = this._getDrawEssentials(graphic);
        if (!de) return;

        de.SIZE = Math.max(10, (de.SIZE || 35) * scaleFactor);
        this._emit("scalePointSymbol", { graphic, newSize: de.SIZE });
    }

    /**
     * End all active edit operations and clean up all resources.
     * Safe to call even when no edit is in progress.
     */
    public deactivate(): void {
        if (this._sketchVM) {
            // For tool:"transform" (scale/rotate), SketchViewModel "complete" only fires
            // when the user clicks elsewhere — NOT when releasing a transform handle.
            // So if the user right-clicks to open the context menu and then picks
            // "Edit Control Points", "complete" never fired and CTRL_PTS were never synced.
            // Sync them now, then clear the snapshots so the cancel handler below is a no-op
            // (i.e., it won't revert the geometry back to pre-transform state).
            if (this._activeGraphic && this._originalGeometry && this._originalCtrlPts) {
                this._syncCtrlPts(this._activeGraphic);
                this._additionalSnapshots.forEach(s => this._syncCtrlPtsFrom(s));
            }
            this._originalGeometry = null;
            this._originalCtrlPts = null;
            this._originalBaseLnPts = null;
            this._additionalSnapshots = [];

            this._sketchVM.cancel();
            this._sketchVM.destroy();
            this._sketchVM = null;
        }

        this._clearHandles();
        this._clearPointerHandlers();

        if (this._keydownListener) {
            document.removeEventListener("keydown", this._keydownListener);
            this._keydownListener = null;
        }

        this._activeGraphic = null;
        this._originalGeometry = null;
        this._originalCtrlPts = null;
        this._originalBaseLnPts = null;
        this._additionalSnapshots = [];
        this._isDraggingHandle = false;
        this._activeHandleIndex = -1;
    }

    /** True while control-point handles are visible on screen. */
    public get isEditingControlPoints(): boolean {
        return this._handleGraphics.length > 0;
    }

    /** True while SketchViewModel move/transform is active (not control-point mode). */
    public get isModifyingSymbol(): boolean {
        return this._sketchVM !== null && !this.isEditingControlPoints;
    }

    /** Register a listener for EditEngine events ("changeInSymbol", "scalePointSymbol"). */
    public on(type: string, listener: Function): { remove(): void } {
        if (!this._eventListeners.has(type)) {
            this._eventListeners.set(type, []);
        }
        this._eventListeners.get(type)!.push(listener);

        return {
            remove: () => {
                const list = this._eventListeners.get(type);
                if (list) {
                    const i = list.indexOf(listener);
                    if (i > -1) list.splice(i, 1);
                }
            }
        };
    }

    // -----------------------------------------------------------------------
    // SketchViewModel — Point symbols (move only)
    // -----------------------------------------------------------------------

    private _activatePointEdit(graphic: Graphic): void {
        const layer = graphic.layer as GraphicsLayer | null;
        if (!layer) {
            console.error("EditEngine: graphic has no layer — cannot activate SketchViewModel");
            return;
        }

        // Snapshot geometry so we can restore on cancel
        this._originalGeometry = graphic.geometry.clone();

        this._sketchVM = new SketchViewModel({ view: this.view, layer });
        this._sketchVM.update([graphic], { tool: "move" } as any);

        this._sketchVM.on("update", (evt: any) => {
            switch (evt.state) {
                case "start":
                    this._deAnnotate(graphic);
                    break;
                case "complete":
                    this._syncPointDrawEssentials(graphic);
                    this._reAnnotate(graphic);
                    this._emit("changeInSymbol", { graphic });
                    break;
                case "cancel":
                    graphic.geometry = this._originalGeometry;
                    this._reAnnotate(graphic);
                    break;
            }
        });
    }

    // -----------------------------------------------------------------------
    // SketchViewModel — Poly/Polygon symbols (move + rotate + scale)
    // -----------------------------------------------------------------------

    private _activatePolyEdit(graphic: Graphic, additionalGraphics: Graphic[] = []): void {
        const layer = graphic.layer as GraphicsLayer | null;
        if (!layer) {
            console.error("EditEngine: graphic has no layer — cannot activate SketchViewModel");
            return;
        }

        const de = this._getDrawEssentials(graphic);

        // Snapshot primary graphic so we can (a) sync CTRL_PTS after transform, (b) restore on cancel
        this._originalGeometry = graphic.geometry.clone();
        this._originalCtrlPts = this._cloneCtrlPts((de as any)?.CTRL_PTS);
        this._originalBaseLnPts = this._cloneBaseLnPts((de as any)?.BASE_LN_PTS);

        // Snapshot additional graphics from multi-selection
        this._additionalSnapshots = additionalGraphics.map(g => {
            const ade = this._getDrawEssentials(g);
            return {
                graphic: g,
                geometry: g.geometry.clone(),
                ctrlPts: this._cloneCtrlPts((ade as any)?.CTRL_PTS),
                baseLnPts: this._cloneBaseLnPts((ade as any)?.BASE_LN_PTS),
            };
        });

        const allGraphics = [graphic, ...additionalGraphics];

        this._sketchVM = new SketchViewModel({ view: this.view, layer });
        this._sketchVM.update(allGraphics, { tool: "transform" } as any);

        this._sketchVM.on("update", (evt: any) => {
            switch (evt.state) {
                case "start":
                    this._deAnnotate(graphic);
                    this._additionalSnapshots.forEach(s => this._deAnnotate(s.graphic));
                    break;
                case "complete":
                    this._syncCtrlPts(graphic);
                    this._additionalSnapshots.forEach(s => this._syncCtrlPtsFrom(s));
                    this._reAnnotate(graphic);
                    this._additionalSnapshots.forEach(s => this._reAnnotate(s.graphic));
                    this._emit("changeInSymbol", { graphic, additionalGraphics: this._additionalSnapshots.map(s => s.graphic) });
                    // Clear snapshots so a subsequent deactivate() / cancel doesn't revert.
                    this._originalGeometry = null;
                    this._originalCtrlPts = null;
                    this._originalBaseLnPts = null;
                    this._additionalSnapshots = [];
                    break;
                case "cancel":
                    // Only revert if snapshots are still set (i.e. deactivate() hasn't
                    // already synced and cleared them — which it does for scale/rotate
                    // where "complete" never fired before the cancel).
                    if (this._originalGeometry) graphic.geometry = this._originalGeometry;
                    if (de && this._originalCtrlPts) (de as any).CTRL_PTS = this._originalCtrlPts;
                    if (de && this._originalBaseLnPts) (de as any).BASE_LN_PTS = this._originalBaseLnPts;
                    this._reAnnotate(graphic);
                    this._additionalSnapshots.forEach(s => {
                        s.graphic.geometry = s.geometry;
                        const ade = this._getDrawEssentials(s.graphic);
                        if (ade && s.ctrlPts) (ade as any).CTRL_PTS = s.ctrlPts;
                        if (ade && s.baseLnPts) (ade as any).BASE_LN_PTS = s.baseLnPts;
                        this._reAnnotate(s.graphic);
                    });
                    break;
            }
        });
    }

    // -----------------------------------------------------------------------
    // CTRL_PTS synchronisation after SketchViewModel transform
    // -----------------------------------------------------------------------

    /**
     * After SketchViewModel has updated the graphic's geometry, compute the
     * 2D similarity transform (translate + rotate + uniform scale) that was
     * applied, and propagate it to CTRL_PTS and BASE_LN_PTS in drawEssentials
     * so they remain consistent for future saves or redraws.
     */
    private _syncCtrlPts(graphic: Graphic): void {
        const de = this._getDrawEssentials(graphic);
        if (!de || !this._originalGeometry) return;

        const t = this._computeAffineTransform(this._originalGeometry, graphic.geometry);

        this._syncGeometryPoints(de, t);

        // Transform CTRL_PTS
        const ctrlPts: Point[] | undefined = (de as any).CTRL_PTS;
        if (ctrlPts && this._originalCtrlPts) {
            (de as any).CTRL_PTS = this._originalCtrlPts.map(pt =>
                this._applyAffineToPoint(pt, t)
            );
        }

        // Transform BASE_LN_PTS
        const baseLnPts = (de as any).BASE_LN_PTS;
        if (baseLnPts && this._originalBaseLnPts) {
            const result: any = {};
            if (this._originalBaseLnPts.startPt)
                result.startPt = this._applyAffineToPoint(this._originalBaseLnPts.startPt, t);
            if (this._originalBaseLnPts.midPt)
                result.midPt = this._applyAffineToPoint(this._originalBaseLnPts.midPt, t);
            if (this._originalBaseLnPts.endPt)
                result.endPt = this._applyAffineToPoint(this._originalBaseLnPts.endPt, t);
            (de as any).BASE_LN_PTS = result;
        }
    }

    /** Sync CTRL_PTS for an additional graphic using its own pre-edit snapshot. */
    private _syncCtrlPtsFrom(snapshot: { graphic: Graphic; geometry: any; ctrlPts: Point[] | null; baseLnPts: any }): void {
        const de = this._getDrawEssentials(snapshot.graphic);
        if (!de || !snapshot.geometry) return;

        const t = this._computeAffineTransform(snapshot.geometry, snapshot.graphic.geometry);

        this._syncGeometryPoints(de, t);

        if (snapshot.ctrlPts) {
            (de as any).CTRL_PTS = snapshot.ctrlPts.map(pt => this._applyAffineToPoint(pt, t));
        }

        if (snapshot.baseLnPts) {
            const result: any = {};
            if (snapshot.baseLnPts.startPt) result.startPt = this._applyAffineToPoint(snapshot.baseLnPts.startPt, t);
            if (snapshot.baseLnPts.midPt) result.midPt = this._applyAffineToPoint(snapshot.baseLnPts.midPt, t);
            if (snapshot.baseLnPts.endPt) result.endPt = this._applyAffineToPoint(snapshot.baseLnPts.endPt, t);
            (de as any).BASE_LN_PTS = result;
        }
    }

    private _syncPointDrawEssentials(graphic: Graphic): void {
        const de = this._getDrawEssentials(graphic);
        if (!de || graphic.geometry?.type !== "point") return;

        const pt = (graphic.geometry as Point).clone();
        if ((de as any).GEOM) (de as any).GEOM = pt.clone();
        if ((de as any).OPTIONS?.GEOM) {
            (de as any).OPTIONS = {
                ...(de as any).OPTIONS,
                GEOM: pt.clone(),
            };
        }
    }

    private _syncGeometryPoints(de: DrawEssentials, t: AffineTransform): void {
        const anyDe = de as any;
        if (anyDe.GEOM) {
            anyDe.GEOM = this._applyAffineToPoint(
                anyDe.GEOM instanceof Point ? anyDe.GEOM : new Point(anyDe.GEOM),
                t
            );
        }
        if (anyDe.OPTIONS?.GEOM) {
            anyDe.OPTIONS = {
                ...anyDe.OPTIONS,
                GEOM: this._applyAffineToPoint(
                    anyDe.OPTIONS.GEOM instanceof Point ? anyDe.OPTIONS.GEOM : new Point(anyDe.OPTIONS.GEOM),
                    t
                ),
            };
        }
    }

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
    private _computeAffineTransform(oldGeom: any, newGeom: any): AffineTransform {
        const v1old = this._getVertex(oldGeom, 0);
        const v2old = this._getVertex(oldGeom, 1);
        const v1new = this._getVertex(newGeom, 0);
        const v2new = this._getVertex(newGeom, 1);

        let a = 1, b = 0, tx = 0, ty = 0;

        if (v1old && v2old && v1new && v2new) {
            const dx  = v2old.x - v1old.x;
            const dy  = v2old.y - v1old.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq > 1e-20) {
                const dx2 = v2new.x - v1new.x;
                const dy2 = v2new.y - v1new.y;
                a  = (dx * dx2 + dy * dy2) / lenSq;
                b  = (dx * dy2 - dy * dx2) / lenSq;
                tx = v1new.x - (a * v1old.x - b * v1old.y);
                ty = v1new.y - (b * v1old.x + a * v1old.y);
            }
        } else if (v1old && v1new) {
            // Degenerate — only one vertex available, treat as pure translation
            tx = v1new.x - v1old.x;
            ty = v1new.y - v1old.y;
        }

        return { a, b, tx, ty };
    }

    /** Apply the 2D similarity transform to a single Point. */
    private _applyAffineToPoint(pt: Point, t: AffineTransform): Point {
        return new Point({
            x: t.a * pt.x - t.b * pt.y + t.tx,
            y: t.b * pt.x + t.a * pt.y + t.ty,
            spatialReference: pt.spatialReference ?? this.view.spatialReference,
        });
    }

    /** Returns the vertex at `index` from the first path/ring of geom, or null. */
    private _getVertex(geom: any, index: number): { x: number; y: number } | null {
        if (geom.type === "point" && index === 0) {
            return { x: geom.x, y: geom.y };
        }
        if (geom.type === "polyline" && geom.paths?.length) {
            const path = geom.paths[0];
            if (path.length > index) return { x: path[index][0], y: path[index][1] };
        }
        if (geom.type === "polygon" && geom.rings?.length) {
            const ring = geom.rings[0];
            if (ring.length > index) return { x: ring[index][0], y: ring[index][1] };
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Reshape: CTRL_PTS drag handles
    // -----------------------------------------------------------------------

    /** Render a visible handle graphic at each CTRL_PT position. */
    private _showHandles(ctrlPts: Point[]): void {
        const sym = new SimpleMarkerSymbol({
            color: new Color([0, 120, 255, 0.85]),
            size: 14,
            style: "circle",
            outline: { color: new Color([255, 255, 255, 1]), width: 2 },
        });

        ctrlPts.forEach((pt, index) => {
            const handle = new Graphic({
                geometry: pt.clone(),
                symbol: sym,
                attributes: { isEditHandle: true, ctrlPtIndex: index },
            });
            this._handleGraphics.push(handle);
            this._handleLayer.add(handle);
        });
    }

    /**
     * Wire up pointer-down / pointer-move / pointer-up on the view to detect
     * handle drags and update CTRL_PTS + redraw the symbol live.
     */
    private _setupHandleDrag(graphic: Graphic, de: DrawEssentials): void {
        const view = this.view;

        // pointer-down: synchronous screen-space distance check.
        // Must be synchronous so _isDraggingHandle is set before the first drag event fires.
        this._pointerDownHandle = view.on("pointer-down", (evt: any) => {
            if (evt.button !== 0) return; // left button only
            this._isDraggingHandle = false;
            this._handleDragOccurred = false;
            this._activeHandleIndex = -1;

            for (let i = 0; i < this._handleGraphics.length; i++) {
                const geom = this._handleGraphics[i].geometry as any;
                if (!geom) continue;
                const screenPt = view.toScreen(geom);
                if (Math.hypot(screenPt.x - evt.x, screenPt.y - evt.y) < 16) {
                    this._isDraggingHandle = true;
                    this._activeHandleIndex = i;
                    this._suppressNextClick = true; // drag → suppress the click that follows
                    evt.stopPropagation();
                    break;
                }
            }
            // No deactivation here — the click handler below decides add-point vs deactivate
        });

        // click: add a new control point if the symbol was clicked,
        //        deactivate if empty space was clicked.
        this._clickHandle = view.on("click", async (evt: any) => {
            if (evt.button !== 0) return;

            // Swallow the click that follows a handle drag
            if (this._suppressNextClick) {
                this._suppressNextClick = false;
                return;
            }

            const hit = await view.hitTest(evt);
            const results = (hit.results as any[]);

            // Did the user click the symbol itself?
            const symbolHit = results.find(r => r.graphic === graphic);
            if (symbolHit) {
                const mapPt = view.toMap({ x: evt.x, y: evt.y });
                if (mapPt) this._addControlPoint(mapPt, graphic, de);
                return;
            }

            // Did the user click a handle? (e.g. a very precise single-click) — keep mode active
            const handleHit = results.find(
                r => r.graphic?.attributes?.isEditHandle === true &&
                     this._handleGraphics.includes(r.graphic)
            );
            if (handleHit) return;

            // Clicked on empty space → exit control-point editing
            this.deactivate();
        });

        // drag: intercept ArcGIS pan when a handle is active.
        // Listening on "drag" (not "pointer-move") is what actually stops the map from panning.
        this._pointerMoveHandle = view.on("drag", (evt: any) => {
            if (!this._isDraggingHandle || this._activeHandleIndex < 0) return;
            evt.stopPropagation(); // prevents map pan / rotate

            if (evt.action !== "update") return;

            this._handleDragOccurred = true;

            const mapPt = view.toMap({ x: evt.x, y: evt.y });
            if (!mapPt) return;

            // Move the visual handle to follow the pointer
            const handleGraphic = this._handleGraphics[this._activeHandleIndex];
            if (handleGraphic) handleGraphic.geometry = mapPt;

            // Update the corresponding CTRL_PT and trigger a live redraw
            const ctrlPts: Point[] = (de as any).CTRL_PTS;
            if (ctrlPts && this._activeHandleIndex < ctrlPts.length) {
                ctrlPts[this._activeHandleIndex] = mapPt;
                this._redrawFromCtrlPts(graphic, de);
            }
        });

        // pointer-up: finalise drag OR detect handle click → remove
        this._pointerUpHandle = view.on("pointer-up", () => {
            if (!this._isDraggingHandle) return;

            const wasRealDrag = this._handleDragOccurred;
            this._isDraggingHandle = false;
            this._handleDragOccurred = false;

            if (!wasRealDrag) {
                // Click on a handle (pointer-down+up with no movement) → remove if it was added
                const handle = this._handleGraphics[this._activeHandleIndex];
                if (handle?.attributes?.isAdded) {
                    this._removeControlPoint(this._activeHandleIndex, graphic, de);
                }
                this._activeHandleIndex = -1;
                return;
            }

            this._activeHandleIndex = -1;
            this._reAnnotate(graphic);
            this._emit("changeInSymbol", { graphic });
        });

        // pointer-move: update cursor to indicate add / drag / remove mode
        this._pointerMoveRawHandle = view.on("pointer-move", (evt: any) => {
            let nearAdded = false;
            let nearOriginal = false;
            for (const handle of this._handleGraphics) {
                const geom = handle.geometry as any;
                if (!geom) continue;
                const screenPt = view.toScreen(geom);
                if (Math.hypot(screenPt.x - evt.x, screenPt.y - evt.y) < 16) {
                    if (handle.attributes?.isAdded) nearAdded = true;
                    else nearOriginal = true;
                    break;
                }
            }
            const container = (view as any).container as HTMLElement;
            if (!container) return;
            if (nearAdded) container.style.cursor = "not-allowed";     // click will remove
            else if (nearOriginal) container.style.cursor = "move";    // click will drag
            else container.style.cursor = "crosshair";                 // click will add
        });
    }

    /**
     * Call the symbol's own createSymbol() via drawEssentials.SCOPE and update
     * the graphic's geometry.  SCOPE is set to the symbol instance during init().
     */
    private _redrawFromCtrlPts(graphic: Graphic, de: DrawEssentials): void {
        const scope = (de as any).SCOPE;
        if (scope && typeof scope.createSymbol === "function") {
            try {
                const newGeom = scope.createSymbol(de);
                if (newGeom) graphic.geometry = newGeom;
                // createSymbol() may emit onDrawEnd and cause AnnotationEngine to
                // re-annotate. Strip any labels that appeared during this redraw.
                this._deAnnotate(graphic);
            } catch (e) {
                console.error("EditEngine._redrawFromCtrlPts: createSymbol error", e);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Add control point
    // -----------------------------------------------------------------------

    /**
     * Insert a new CTRL_PT at mapPt, splitting the nearest existing segment.
     * Updates handles and triggers a live redraw.
     */
    private _addControlPoint(mapPt: Point, graphic: Graphic, de: DrawEssentials): void {
        const ctrlPts: Point[] = (de as any).CTRL_PTS;
        if (!ctrlPts || ctrlPts.length < 2) return;

        const insertIdx = this._findInsertionIndex(ctrlPts, mapPt);

        // Insert into CTRL_PTS
        ctrlPts.splice(insertIdx, 0, mapPt);

        // Shift ctrlPtIndex on all handles that come after the insertion point
        for (let i = insertIdx; i < this._handleGraphics.length; i++) {
            this._handleGraphics[i].attributes.ctrlPtIndex = i + 1;
        }

        // Create the new handle (green tint so the user sees it was just added)
        const newHandle = new Graphic({
            geometry: mapPt.clone(),
            symbol: new SimpleMarkerSymbol({
                color: new Color([0, 180, 90, 0.9]),
                size: 14,
                style: "circle",
                outline: { color: new Color([255, 255, 255, 1]), width: 2 },
            }),
            attributes: { isEditHandle: true, ctrlPtIndex: insertIdx, isAdded: true },
        });
        this._handleGraphics.splice(insertIdx, 0, newHandle);
        this._handleLayer.add(newHandle);

        // Redraw symbol with the new point
        this._redrawFromCtrlPts(graphic, de);
        this._emit("changeInSymbol", { graphic });
    }

    /**
     * Remove an added control point at the given handle index.
     * Guards against removing below 2 points (minimum for a valid polyline).
     */
    private _removeControlPoint(index: number, graphic: Graphic, de: DrawEssentials): void {
        const ctrlPts: Point[] = (de as any).CTRL_PTS;
        if (!ctrlPts || ctrlPts.length <= 2) return;

        ctrlPts.splice(index, 1);

        const removed = this._handleGraphics.splice(index, 1)[0];
        if (removed) this._handleLayer.remove(removed);

        // Re-index remaining handles
        for (let i = index; i < this._handleGraphics.length; i++) {
            this._handleGraphics[i].attributes.ctrlPtIndex = i;
        }

        this._redrawFromCtrlPts(graphic, de);
        this._emit("changeInSymbol", { graphic });
    }

    /**
     * Return the index at which to insert mapPt so it falls on the nearest segment.
     */
    private _findInsertionIndex(ctrlPts: Point[], mapPt: Point): number {
        let minDist = Infinity;
        let insertAfterIdx = ctrlPts.length - 1;

        for (let i = 0; i < ctrlPts.length - 1; i++) {
            const d = this._distancePtToSegment(mapPt, ctrlPts[i], ctrlPts[i + 1]);
            if (d < minDist) {
                minDist = d;
                insertAfterIdx = i;
            }
        }
        return insertAfterIdx + 1;
    }

    /** Minimum distance from point P to segment A→B in map coordinates. */
    private _distancePtToSegment(P: Point, A: Point, B: Point): number {
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(P.x - A.x, P.y - A.y);
        const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq));
        return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
    }

    private _clearHandles(): void {
        this._handleGraphics.forEach(g => this._handleLayer.remove(g));
        this._handleGraphics = [];
    }

    private _clearPointerHandlers(): void {
        this._pointerDownHandle?.remove();
        this._pointerMoveHandle?.remove();
        this._pointerUpHandle?.remove();
        this._clickHandle?.remove();
        this._pointerMoveRawHandle?.remove();
        this._pointerDownHandle = null;
        this._pointerMoveHandle = null;
        this._pointerUpHandle = null;
        this._clickHandle = null;
        this._pointerMoveRawHandle = null;
        this._suppressNextClick = false;
        this._handleDragOccurred = false;

        // Restore default cursor when leaving reshape mode
        const container = (this.view as any)?.container as HTMLElement;
        if (container) container.style.cursor = "";
    }

    // -----------------------------------------------------------------------
    // Annotation helpers
    // -----------------------------------------------------------------------

    private _deAnnotate(graphic: Graphic): void {
        const id = graphic.attributes?.id ?? (graphic as any).id;
        if (!id) return;
        const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
        AnnotationEngine.deAnnotate(layer, id);
    }

    private _reAnnotate(graphic: Graphic): void {
        const de = this._getDrawEssentials(graphic);
        // Only annotate if amplifier data is present (AMPLIFIER is set to an Amplifier object)
        if (!de?.AMPLIFIER || typeof de.AMPLIFIER === "string") return;

        const id = graphic.attributes?.id ?? (graphic as any).id;
        if (!id) return;

        const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
        AnnotationEngine.annotate(
            layer,
            graphic.geometry,
            de.AMPLIFIER as unknown as Amplifier,
            de,
            id,
            settingsData.textSize,
            de.ISFHAND ?? 0,
            de.labelOptions ?? {},
            {}
        );
    }

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    private _getDrawEssentials(graphic: Graphic): DrawEssentials | null {
        return graphic.attributes?.drawEssentials ?? (graphic as any).drawEssentials ?? null;
    }

    /** Deep-clone an array of CTRL_PTS (handles both Point instances and plain {x,y} objects). */
    private _cloneCtrlPts(pts: Point[] | undefined): Point[] | null {
        if (!pts?.length) return null;
        return pts.map(pt =>
            pt instanceof Point
                ? pt.clone()
                : new Point({
                    x: (pt as any).x,
                    y: (pt as any).y,
                    spatialReference: (pt as any).spatialReference,
                })
        );
    }

    /** Deep-clone BASE_LN_PTS ({ startPt, midPt, endPt }). */
    private _cloneBaseLnPts(b: any | undefined): any | null {
        if (!b) return null;
        const clonePt = (pt: any): Point | undefined => {
            if (!pt) return undefined;
            return pt instanceof Point ? pt.clone() : new Point(pt);
        };
        return {
            startPt: clonePt(b.startPt),
            midPt: clonePt(b.midPt),
            endPt: clonePt(b.endPt),
        };
    }

    private _emit(type: string, data: any): void {
        if (type === 'changeInSymbol') {
            EngineLogger.success('Edit Engine', 'Symbol updated — edit complete');
        }
        this._eventListeners.get(type)?.forEach(fn => fn(data));
    }

    // -----------------------------------------------------------------------
    // Context menu
    // -----------------------------------------------------------------------

    /**
     * Returns the Edit submenu item tree.
     * Call from SymbolEngine.registerContextMenuItems() and spread the result.
     */
    public buildContextMenuItems(
        onModify: (graphic: Graphic) => void,
        onActivateCtrlPts: (graphic: Graphic) => void,
        onDeactivate: () => void,
    ): ContextMenuItem[] {
        return [
            {
                id: 'edit-submenu',
                label: 'Edit',
                icon: '<span style="font-size:14px">✍️</span>',
                visible: () =>
                    (settingsData as any).features?.editMoveScaleRotate !== false ||
                    (settingsData as any).features?.editControlPoints !== false,
                children: [
                    {
                        id: 'modify-symbol',
                        label: 'Move, Scale, Rotate',
                        shortcut: 'M',
                        icon: '<span style="font-size:14px">✍️</span>',
                        visible: (_graphic: Graphic) =>
                            (settingsData as any).features?.editMoveScaleRotate !== false &&
                            !this.isModifyingSymbol,
                        action: (graphic: Graphic) => onModify(graphic),
                    },
                    {
                        id: 'disable-modify-symbol',
                        label: 'Disable Move, Scale, Rotate',
                        shortcut: 'Esc',
                        icon: '<span style="font-size:14px">✖</span>',
                        visible: (_graphic: Graphic) =>
                            (settingsData as any).features?.editMoveScaleRotate !== false &&
                            this.isModifyingSymbol,
                        action: (_graphic: Graphic) => onDeactivate(),
                    },
                    {
                        id: 'edit-ctrl-pts',
                        label: 'Edit Control Points',
                        shortcut: 'E',
                        icon: '<span style="font-size:14px">↕</span>',
                        visible: (_graphic: Graphic) =>
                            (settingsData as any).features?.editControlPoints !== false &&
                            !this.isEditingControlPoints,
                        action: (graphic: Graphic) => onActivateCtrlPts(graphic),
                    },
                    {
                        id: 'deactivate-ctrl-pts',
                        label: 'Deactivate Control Points',
                        shortcut: 'Esc',
                        icon: '<span style="font-size:14px">✖</span>',
                        visible: (_graphic: Graphic) =>
                            (settingsData as any).features?.editControlPoints !== false &&
                            this.isEditingControlPoints,
                        action: (_graphic: Graphic) => onDeactivate(),
                    },
                ],
            },
        ];
    }
}

export default EditEngine;
