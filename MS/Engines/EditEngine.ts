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
    // Mixed-edit session state (Point/FPoint + Line/Area).
    private _isMixedEdit = false;
    private _mixedSnapshots: { graphic: Graphic; geometry: any; ctrlPts: Point[] | null; baseLnPts: any }[] = [];
    private _mixedProxyGraphic: Graphic | null = null;
    private _mixedProxyOriginalGeometry: any = null;
    // Per-symbol halos shown during a mixed-edit session — flashed at start so
    // the user sees which symbols are in scope, then kept as a subtle outline
    // that follows each symbol as the proxy is transformed.
    private _mixedHaloGraphics: { graphic: Graphic; symbolType: string }[] = [];
    private _mixedFlashTimeout: number | null = null;

    // rAF coalescing for live reshape redraws — drag events can fire many times
    // per frame and createSymbol() can be expensive for complex symbols, so we
    // collapse pending redraws to one per animation frame using the latest state.
    private _redrawRafId: number | null = null;
    private _pendingRedraw: { graphic: Graphic; de: DrawEssentials } | null = null;

    // Cached screen positions for handle hit-testing — recomputed only when
    // the view's scale/center changes (cheap polling) or when a handle moves.
    private _handleScreenCacheScale: number | null = null;
    private _handleScreenCacheCx: number | null = null;
    private _handleScreenCacheCy: number | null = null;
    private _pointerMoveRafId: number | null = null;
    private _lastPointerMoveEvt: any = null;

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

    // Floating tip shown while an edit session is active — lets the user disable
    // the mode without going through the right-click context menu.
    private _modeBanner: HTMLElement | null = null;
    private _modeBannerAbort: AbortController | null = null;

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

        this._showModeBanner('move-scale-rotate');
        this._installEscListener();
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

        this._showModeBanner('control-points');
        this._installEscListener();
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
        if (this._isMixedEdit) {
            this._finalizeMixedEditBeforeDeactivate();
        }
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
        this._removeModeBanner();

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
        this._isMixedEdit = false;
        this._mixedSnapshots = [];
        this._mixedProxyGraphic = null;
        this._mixedProxyOriginalGeometry = null;
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
        const layer = (graphic.origin?.layer ?? null) as GraphicsLayer | null;
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
                    // Clear snapshot so a subsequent deactivate()/cancel doesn't revert.
                    this._originalGeometry = null;
                    break;
                case "cancel":
                    if (this._originalGeometry) graphic.geometry = this._originalGeometry;
                    this._reAnnotate(graphic);
                    break;
            }
        });
    }

    // -----------------------------------------------------------------------
    // SketchViewModel — Poly/Polygon symbols (move + rotate + scale)
    // -----------------------------------------------------------------------

    private _activatePolyEdit(graphic: Graphic, additionalGraphics: Graphic[] = []): void {
        const layer = (graphic.origin?.layer ?? null) as GraphicsLayer | null;
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

    private _activateMixedEditSession(graphic: Graphic, additionalGraphics: Graphic[] = []): void {
        const allGraphics = [graphic, ...additionalGraphics];
        this._mixedSnapshots = allGraphics.map(g => {
            const de = this._getDrawEssentials(g);
            return {
                graphic: g,
                geometry: g.geometry?.clone?.() ?? g.geometry,
                ctrlPts: this._cloneCtrlPts((de as any)?.CTRL_PTS),
                baseLnPts: this._cloneBaseLnPts((de as any)?.BASE_LN_PTS),
            };
        });

        this._mixedSnapshots.forEach(s => this._deAnnotate(s.graphic));

        this._logMixedSession(allGraphics);
        this._createMixedHalos();
        this._flashMixedHalos();

        const proxy = this._createMixedProxyGraphic(allGraphics);
        if (!proxy) return;
        this._mixedProxyGraphic = proxy;
        this._mixedProxyOriginalGeometry = proxy.geometry?.clone?.() ?? proxy.geometry;
        this._handleLayer.add(proxy);

        // Uniform scaling (preserveAspectRatio) is enabled so a group can be
        // moved, rotated AND scaled. The affine derived in _computeAffineTransform
        // is a similarity transform (uniform scale + rotate + translate), so we
        // lock the aspect ratio to keep the proxy's scaling uniform and faithful.
        this._sketchVM = new SketchViewModel({
            view: this.view,
            layer: this._handleLayer,
            defaultUpdateOptions: {
                enableScaling: true,
                preserveAspectRatio: true,
                enableRotation: true,
                toggleToolOnClick: false,
                tool: "transform",
            } as any,
        });

        this._sketchVM.update([proxy], {
            tool: "transform",
            enableScaling: true,
            preserveAspectRatio: true,
            enableRotation: true,
            toggleToolOnClick: false,
        } as any);

        this._sketchVM.on("update", (evt: any) => {
            switch (evt.state) {
                case "active":
                    this._applyMixedCurrentTransform();
                    break;
                case "complete":
                    this._applyMixedCurrentTransform();
                    this._mixedSnapshots.forEach(s => this._reAnnotate(s.graphic));
                    this._emit("changeInSymbol", {
                        graphic,
                        additionalGraphics: additionalGraphics
                    });
                    this._clearMixedSessionState();
                    break;
                case "cancel":
                    this._restoreMixedSnapshots();
                    this._mixedSnapshots.forEach(s => this._reAnnotate(s.graphic));
                    this._clearMixedSessionState();
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

    /**
     * Activate group-transform mode for any multi-graphic selection — whether
     * the members share a geometry type or are heterogeneous (point + line/area).
     * A single proxy bounding box is transformed and the resulting move + rotate
     * + uniform scale is applied to every member. This is required because
     * ArcGIS SketchViewModel only supports translation when several graphics are
     * updated together, so rotate/scale of a group is otherwise unavailable.
     */
    public activateMixedEdit(graphic: Graphic, additionalGraphics: Graphic[] = []): void {
        this.deactivate();
        this._activeGraphic = graphic;
        this._isMixedEdit = true;
        this._activateMixedEditSession(graphic, additionalGraphics);
        EngineLogger.nextStep('Edit Engine', 'Group transform active — drag to move, rotate or scale');
        this._showModeBanner('mixed-edit');
        this._installEscListener();
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

    private _applyMixedCurrentTransform(): void {
        if (!this._mixedProxyGraphic || this._mixedSnapshots.length === 0) return;
        if (!this._mixedProxyOriginalGeometry) return;
        const t = this._computeAffineTransform(this._mixedProxyOriginalGeometry, this._mixedProxyGraphic.geometry);
        this._mixedSnapshots.forEach(s => this._applySnapshotTransform(s, t));
        this._updateMixedHalos();
    }

    private _applySnapshotTransform(
        snapshot: { graphic: Graphic; geometry: any; ctrlPts: Point[] | null; baseLnPts: any },
        t: AffineTransform
    ): void {
        snapshot.graphic.geometry = this._applyAffineToGeometry(snapshot.geometry, t);
        const de = this._getDrawEssentials(snapshot.graphic);
        if (!de) return;

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

    private _applyAffineToGeometry(geometry: any, t: AffineTransform): any {
        if (!geometry?.clone) return geometry;
        const g = geometry.clone();

        // Inline the affine transform: avoid allocating a Point per vertex
        // (mixed-edit fires this per pointer event × per selected graphic).
        const a = t.a, b = t.b, tx = t.tx, ty = t.ty;

        if (g.type === "point") {
            const x = g.x;
            const y = g.y;
            g.x = a * x - b * y + tx;
            g.y = b * x + a * y + ty;
            return g;
        }
        if (g.type === "polyline" && g.paths) {
            g.paths = g.paths.map((path: number[][]) =>
                path.map(([x, y]: number[]) => [
                    a * x - b * y + tx,
                    b * x + a * y + ty,
                ])
            );
            return g;
        }
        if (g.type === "polygon" && g.rings) {
            g.rings = g.rings.map((ring: number[][]) =>
                ring.map(([x, y]: number[]) => [
                    a * x - b * y + tx,
                    b * x + a * y + ty,
                ])
            );
            return g;
        }
        return g;
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

            this._refreshHandleScreenCache(view);

            for (let i = 0; i < this._handleGraphics.length; i++) {
                const screenPt = (this._handleGraphics[i].attributes as any)?._cachedScreen;
                if (!screenPt) continue;
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
            if (handleGraphic) {
                handleGraphic.geometry = mapPt;
                // Invalidate the cached screen position for this handle; the
                // next refresh will recompute all entries.
                this._handleScreenCacheScale = null;
            }

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
            if (this._activeHandleIndex < 0) {
                this._isDraggingHandle = false;
                this._handleDragOccurred = false;
                return;
            }

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

        // pointer-move: update cursor to indicate add / drag / remove mode.
        // rAF-throttled so we do at most one cursor pass per frame, and reads
        // screen positions from the cache instead of calling view.toScreen()
        // for every handle on every pointer event.
        this._pointerMoveRawHandle = view.on("pointer-move", (evt: any) => {
            this._lastPointerMoveEvt = evt;
            if (this._pointerMoveRafId !== null) return;
            this._pointerMoveRafId = requestAnimationFrame(() => {
                this._pointerMoveRafId = null;
                const e = this._lastPointerMoveEvt;
                if (!e) return;
                this._refreshHandleScreenCache(view);

                let nearAdded = false;
                let nearOriginal = false;
                for (const handle of this._handleGraphics) {
                    const screenPt = (handle.attributes as any)?._cachedScreen;
                    if (!screenPt) continue;
                    if (Math.hypot(screenPt.x - e.x, screenPt.y - e.y) < 16) {
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
        });
    }

    /**
     * Call the symbol's own createSymbol() via drawEssentials.SCOPE and update
     * the graphic's geometry.  SCOPE is set to the symbol instance during init().
     */
    private _redrawFromCtrlPts(graphic: Graphic, de: DrawEssentials): void {
        // Coalesce rapid drag events into one redraw per frame using the latest
        // (graphic, de) pair. Calls from _addControlPoint / _removeControlPoint
        // still land in the same queue and produce a redraw on the next frame.
        this._pendingRedraw = { graphic, de };
        if (this._redrawRafId !== null) return;
        this._redrawRafId = requestAnimationFrame(() => {
            this._redrawRafId = null;
            const pending = this._pendingRedraw;
            this._pendingRedraw = null;
            if (!pending) return;
            const scope = (pending.de as any).SCOPE;
            if (scope && typeof scope.createSymbol === "function") {
                try {
                    const newGeom = scope.createSymbol(pending.de);
                    if (newGeom) pending.graphic.geometry = newGeom;
                    // createSymbol() may emit onDrawEnd and cause AnnotationEngine to
                    // re-annotate. Strip any labels that appeared during this redraw.
                    this._deAnnotate(pending.graphic);
                } catch (e) {
                    console.error("EditEngine._redrawFromCtrlPts: createSymbol error", e);
                }
            }
        });
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
        this._handleScreenCacheScale = null; // handle set changed → recompute

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
        this._handleScreenCacheScale = null; // handle set changed → recompute

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

    /**
     * Recompute each handle's screen-space position via view.toScreen(), but
     * only when the cached view scale / center is stale. Result is stored on
     * `handle.attributes._cachedScreen` so pointer-down and pointer-move can
     * hit-test without per-event toScreen() calls.
     */
    private _refreshHandleScreenCache(view: any): void {
        const scale = view.scale;
        const cx = view.center?.x ?? 0;
        const cy = view.center?.y ?? 0;
        if (scale === this._handleScreenCacheScale &&
            cx === this._handleScreenCacheCx &&
            cy === this._handleScreenCacheCy) {
            return; // cache is still valid
        }
        for (const handle of this._handleGraphics) {
            const geom = handle.geometry as any;
            if (!geom) continue;
            (handle.attributes as any)._cachedScreen = view.toScreen(geom);
        }
        this._handleScreenCacheScale = scale;
        this._handleScreenCacheCx = cx;
        this._handleScreenCacheCy = cy;
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
        this._handleScreenCacheScale = null;
        this._handleScreenCacheCx = null;
        this._handleScreenCacheCy = null;
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

        // Cancel any pending throttled work so it doesn't run on a torn-down session.
        if (this._pointerMoveRafId !== null) {
            cancelAnimationFrame(this._pointerMoveRafId);
            this._pointerMoveRafId = null;
        }
        this._lastPointerMoveEvt = null;
        if (this._redrawRafId !== null) {
            cancelAnimationFrame(this._redrawRafId);
            this._redrawRafId = null;
        }
        this._pendingRedraw = null;

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

    private _createMixedProxyGraphic(graphics: Graphic[]): Graphic | null {
        const pts: { x: number; y: number }[] = [];
        graphics.forEach(g => {
            const ext = g.geometry?.extent;
            if (ext) {
                pts.push({ x: ext.xmin, y: ext.ymin }, { x: ext.xmax, y: ext.ymax });
            } else if (g.geometry?.type === "point") {
                pts.push({ x: g.geometry.x, y: g.geometry.y });
            }
        });
        if (pts.length === 0) return null;

        const minX = Math.min(...pts.map(p => p.x));
        const maxX = Math.max(...pts.map(p => p.x));
        const minY = Math.min(...pts.map(p => p.y));
        const maxY = Math.max(...pts.map(p => p.y));
        const padX = (maxX - minX || 1) * 0.05;
        const padY = (maxY - minY || 1) * 0.05;
        const ring = [
            [minX - padX, minY - padY],
            [maxX + padX, minY - padY],
            [maxX + padX, maxY + padY],
            [minX - padX, maxY + padY],
            [minX - padX, minY - padY],
        ];

        return new Graphic({
            geometry: {
                type: "polygon",
                rings: [ring],
                spatialReference: this.view.spatialReference,
            } as any,
            symbol: {
                type: "simple-fill",
                color: [0, 0, 0, 0],
                outline: { color: [0, 120, 255, 0.8], width: 1, style: "dash" },
            } as any,
            attributes: { isMixedTransformProxy: true },
        });
    }

    /**
     * Build a subtle halo graphic for each symbol in the mixed-edit session.
     * Halos sit on the handle layer and follow each symbol's geometry as the
     * user transforms the proxy, so the user can always see which symbols are
     * in scope — even if they extend beyond the proxy rectangle.
     */
    private _createMixedHalos(): void {
        for (const s of this._mixedSnapshots) {
            const geom = s.graphic.geometry;
            if (!geom) continue;
            const haloSym = this._createHaloSymbol(geom.type);
            if (!haloSym) continue;
            const halo = new Graphic({
                geometry: geom.clone(),
                symbol: haloSym,
                attributes: { isMixedHalo: true },
            });
            this._handleLayer.add(halo);
            this._mixedHaloGraphics.push({ graphic: halo, symbolType: geom.type });
        }
    }

    /**
     * Briefly swap each halo's symbol with a brighter "flash" variant at session
     * start, then restore. One-shot pulse so the user sees every participating
     * symbol confirm itself even before they start dragging.
     */
    private _flashMixedHalos(durationMs = 450): void {
        if (this._mixedHaloGraphics.length === 0) return;
        const originals = this._mixedHaloGraphics.map(h => h.graphic.symbol);
        const targets = [...this._mixedHaloGraphics];
        targets.forEach(h => {
            const flashSym = this._createFlashSymbol(h.symbolType);
            if (flashSym) h.graphic.symbol = flashSym;
        });
        this._mixedFlashTimeout = window.setTimeout(() => {
            this._mixedFlashTimeout = null;
            targets.forEach((h, i) => {
                if (!h.graphic) return;
                try { h.graphic.symbol = originals[i]; } catch { /* graphic may have been removed */ }
            });
        }, durationMs);
    }

    private _updateMixedHalos(): void {
        const n = Math.min(this._mixedHaloGraphics.length, this._mixedSnapshots.length);
        for (let i = 0; i < n; i++) {
            this._mixedHaloGraphics[i].graphic.geometry = this._mixedSnapshots[i].graphic.geometry;
        }
    }

    private _clearMixedHalos(): void {
        if (this._mixedFlashTimeout !== null) {
            clearTimeout(this._mixedFlashTimeout);
            this._mixedFlashTimeout = null;
        }
        for (const h of this._mixedHaloGraphics) {
            this._handleLayer.remove(h.graphic);
        }
        this._mixedHaloGraphics = [];
    }

    private _createHaloSymbol(geomType: string): any {
        if (geomType === 'point') {
            return new SimpleMarkerSymbol({
                color: new Color([0, 180, 255, 0]),
                size: 28,
                style: 'circle',
                outline: { color: new Color([0, 180, 255, 0.6]), width: 2 },
            });
        }
        if (geomType === 'polyline') {
            return {
                type: 'simple-line',
                color: [0, 180, 255, 0.5],
                width: 6,
                style: 'solid',
            };
        }
        if (geomType === 'polygon') {
            return {
                type: 'simple-fill',
                color: [0, 180, 255, 0.08],
                outline: { color: [0, 180, 255, 0.6], width: 2 },
            };
        }
        return null;
    }

    private _createFlashSymbol(geomType: string): any {
        if (geomType === 'point') {
            return new SimpleMarkerSymbol({
                color: new Color([255, 255, 255, 0.3]),
                size: 36,
                style: 'circle',
                outline: { color: new Color([120, 220, 255, 1]), width: 3 },
            });
        }
        if (geomType === 'polyline') {
            return {
                type: 'simple-line',
                color: [255, 255, 255, 0.9],
                width: 8,
                style: 'solid',
            };
        }
        if (geomType === 'polygon') {
            return {
                type: 'simple-fill',
                color: [255, 255, 255, 0.25],
                outline: { color: [255, 255, 255, 1], width: 3 },
            };
        }
        return null;
    }

    private _logMixedSession(graphics: Graphic[]): void {
        const counts: Record<string, number> = {};
        for (const g of graphics) {
            const t = g.geometry?.type ?? 'unknown';
            counts[t] = (counts[t] ?? 0) + 1;
        }
        const label = (type: string, n: number): string => {
            const base = type === 'polyline' ? 'Line'
                       : type === 'polygon'  ? 'Area'
                       : type === 'point'    ? 'Point'
                       : type;
            return `${n} ${base}${n !== 1 ? 's' : ''}`;
        };
        const parts = Object.entries(counts).map(([t, n]) => label(t, n)).join(', ');
        EngineLogger.nextStep('Edit Engine', `Mixed edit — ${graphics.length} symbols in session (${parts})`);
    }

    private _restoreMixedSnapshots(): void {
        this._mixedSnapshots.forEach(s => {
            s.graphic.geometry = s.geometry?.clone?.() ?? s.geometry;
            const de = this._getDrawEssentials(s.graphic);
            if (!de) return;
            if (s.ctrlPts) (de as any).CTRL_PTS = this._cloneCtrlPts(s.ctrlPts) ?? s.ctrlPts;
            if (s.baseLnPts) (de as any).BASE_LN_PTS = this._cloneBaseLnPts(s.baseLnPts);
        });
    }

    private _clearMixedSessionState(): void {
        this._clearMixedHalos();
        if (this._mixedProxyGraphic) {
            this._handleLayer.remove(this._mixedProxyGraphic);
        }
        this._mixedProxyGraphic = null;
        this._mixedProxyOriginalGeometry = null;
        this._mixedSnapshots = [];
        this._isMixedEdit = false;
        // Destroy SVM last; any "cancel" event fired by destroy is a no-op
        // because the state above has already been cleared.
        if (this._sketchVM) {
            this._sketchVM.destroy();
            this._sketchVM = null;
        }
    }

    private _finalizeMixedEditBeforeDeactivate(): void {
        if (!this._isMixedEdit || !this._sketchVM || !this._mixedProxyGraphic) return;
        this._applyMixedCurrentTransform();
        this._mixedSnapshots.forEach(s => this._reAnnotate(s.graphic));
        this._emit("changeInSymbol", {
            graphic: this._activeGraphic,
            additionalGraphics: this._mixedSnapshots
                .map(s => s.graphic)
                .filter(g => g !== this._activeGraphic),
        });
        this._clearMixedSessionState();
    }

    private _emit(type: string, data: any): void {
        if (type === 'changeInSymbol') {
            EngineLogger.success('Edit Engine', 'Symbol updated — edit complete');
        }
        this._eventListeners.get(type)?.forEach(fn => {
            try {
                fn(data);
            } catch (e) {
                console.error(`EditEngine: listener for "${type}" threw`, e);
            }
        });
    }

    // -----------------------------------------------------------------------
    // Mode banner — on-map tip with a Disable button
    // -----------------------------------------------------------------------

    private _installEscListener(): void {
        if (this._keydownListener) return;
        this._keydownListener = (e: KeyboardEvent) => {
            if (e.key === "Escape") this.deactivate();
        };
        document.addEventListener("keydown", this._keydownListener);
    }

    private _showModeBanner(mode: 'move-scale-rotate' | 'control-points' | 'mixed-edit'): void {
        this._removeModeBanner();

        const labels: Record<'move-scale-rotate' | 'control-points' | 'mixed-edit', { icon: string; title: string; hint: string }> = {
            'move-scale-rotate': { icon: '✎',  title: 'Move, Scale, Rotate', hint: 'Drag handles to transform the symbol' },
            'control-points':    { icon: '↕',  title: 'Edit Control Points',   hint: 'Drag handles to reshape • Click symbol to add • Click point to remove' },
            'mixed-edit':        { icon: '✎',  title: 'Move, Scale, Rotate', hint: 'Drag the box to move, rotate or scale the group' },
        };
        const cfg = labels[mode];

        const el = document.createElement('div');
        el.style.cssText = `
            position: fixed;
            bottom: 70px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(14,18,28,0.92);
            border: 1px solid rgba(90,140,220,0.4);
            border-radius: 9px;
            padding: 8px 16px;
            font-family: 'Inter','Segoe UI',sans-serif;
            font-size: 11.5px;
            color: #a8c4e0;
            z-index: 1500;
            white-space: nowrap;
            box-shadow: 0 4px 18px rgba(0,0,0,0.45);
            display: flex; gap: 12px; align-items: center;
        `;
        const sep = `<span style="color:#334455">|</span>`;
        const kbd = `<kbd style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:4px;padding:1px 6px;font-size:10.5px;color:#f08060;font-family:inherit">Esc</kbd>`;
        el.innerHTML = `
            <span><span style="color:#64b4ff;font-weight:700;margin-right:4px">${cfg.icon}</span><strong style="color:#c8dff5">${cfg.title}</strong></span>
            ${sep}
            <span style="opacity:0.85">${cfg.hint}</span>
            ${sep}
            <button class="edit-banner-disable" style="background:rgba(220,80,80,0.18);border:1px solid rgba(220,80,80,0.5);border-radius:4px;padding:3px 10px;color:#f08060;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;letter-spacing:0.02em">Disable</button>
            ${sep}
            <span style="opacity:0.7">or press ${kbd}</span>
        `;
        this._modeBannerAbort = new AbortController();
        el.querySelector('.edit-banner-disable')?.addEventListener(
            'click',
            () => this.deactivate(),
            { signal: this._modeBannerAbort.signal }
        );
        document.body.appendChild(el);
        this._modeBanner = el;
        this._wireBannerDrag(el);
    }

    /**
     * Make the mode banner draggable so the user can move it off any panel that
     * overlaps it. Listeners are bound to `_modeBannerAbort` so they tear down
     * when the banner is removed.
     */
    private _wireBannerDrag(banner: HTMLElement): void {
        if (!this._modeBannerAbort) return;
        const signal = this._modeBannerAbort.signal;
        let dragging = false;
        let ox = 0;
        let oy = 0;

        banner.style.cursor = 'grab';

        banner.addEventListener('mousedown', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('button, kbd')) return;
            const rect = banner.getBoundingClientRect();
            // Anchor by explicit left/top so subsequent moves don't fight the
            // original left: 50% / transform: translateX(-50%) centring.
            banner.style.left = rect.left + 'px';
            banner.style.top = rect.top + 'px';
            banner.style.right = 'auto';
            banner.style.bottom = 'auto';
            banner.style.transform = 'none';
            ox = e.clientX - rect.left;
            oy = e.clientY - rect.top;
            dragging = true;
            banner.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        }, { signal });

        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!dragging) return;
            const maxLeft = window.innerWidth  - banner.offsetWidth  - 4;
            const maxTop  = window.innerHeight - banner.offsetHeight - 4;
            banner.style.left = Math.max(0, Math.min(e.clientX - ox, maxLeft)) + 'px';
            banner.style.top  = Math.max(0, Math.min(e.clientY - oy, maxTop))  + 'px';
        }, { signal });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            banner.style.cursor = 'grab';
            document.body.style.userSelect = '';
        }, { signal });
    }

    private _removeModeBanner(): void {
        this._modeBannerAbort?.abort();
        this._modeBannerAbort = null;
        if (this._modeBanner) {
            this._modeBanner.remove();
            this._modeBanner = null;
        }
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
        getSelectionCount?: () => number,
    ): ContextMenuItem[] {
        return [
            {
                id: 'edit-submenu',
                label: 'Edit',
                icon: '<span class="menu-icon-text">✎</span>',
                visible: () =>
                    (settingsData as any).features?.editMoveScaleRotate !== false ||
                    (settingsData as any).features?.editControlPoints !== false,
                children: [
                    {
                        id: 'modify-symbol',
                        label: 'Move, Scale, Rotate',
                        shortcut: 'M',
                        icon: '<span class="menu-icon-text">✎</span>',
                        visible: (_graphic: Graphic) =>
                            (settingsData as any).features?.editMoveScaleRotate !== false &&
                            !this.isModifyingSymbol,
                        action: (graphic: Graphic) => onModify(graphic),
                    },
                    {
                        id: 'disable-modify-symbol',
                        label: 'Disable Move, Scale, Rotate',
                        shortcut: 'Esc',
                        icon: '<span class="menu-icon-text">✖</span>',
                        visible: (_graphic: Graphic) =>
                            (settingsData as any).features?.editMoveScaleRotate !== false &&
                            this.isModifyingSymbol,
                        action: (_graphic: Graphic) => onDeactivate(),
                    },
                    {
                        id: 'edit-ctrl-pts',
                        label: 'Edit Control Points',
                        shortcut: 'E',
                        icon: '<span class="menu-icon-text">↕</span>',
                        // Reshape currently operates on a single symbol — hide
                        // the entry when 2+ symbols are selected so the user
                        // doesn't silently get reshape on just the right-clicked
                        // one (see EditEngine review #13, option 1).
                        visible: (_graphic: Graphic) =>
                            (settingsData as any).features?.editControlPoints !== false &&
                            !this.isEditingControlPoints &&
                            (getSelectionCount?.() ?? 1) <= 1,
                        action: (graphic: Graphic) => onActivateCtrlPts(graphic),
                    },
                    {
                        id: 'deactivate-ctrl-pts',
                        label: 'Deactivate Control Points',
                        shortcut: 'Esc',
                        icon: '<span class="menu-icon-text">✖</span>',
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
