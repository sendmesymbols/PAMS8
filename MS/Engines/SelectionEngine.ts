import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Color from "@arcgis/core/Color";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import GraphicsLayerManager from "../Managers/GraphicsLayerManager";
import { ContextMenuItem } from "../Managers/ContextMenuManager";
import * as promiseUtils from "@arcgis/core/core/promiseUtils";
import EngineLogger from "../Support/EngineLogger";
import settingsData from "../Data/Settings.json";

// ── Proxy bounding-box symbol (used as drag handle for batch move) ───────────

const PROXY_SYM = new SimpleFillSymbol({
    color: new Color([0, 120, 255, 0.08]),
    outline: { color: new Color([0, 120, 255, 0.6]), width: 2, style: "dash" }
});

// ── Lasso selection polygon symbol ───────────────────────────────────────────

const LASSO_SYM = new SimpleFillSymbol({
    color: new Color([0, 200, 100, 0.10]),
    outline: { color: new Color([0, 200, 100, 0.8]), width: 1.5, style: "dash" }
});

// ── Subtract (deselect) lasso polygon symbol ─────────────────────────────────
const LASSO_SUBTRACT_SYM = new SimpleFillSymbol({
    color: new Color([220, 50, 50, 0.12]),
    outline: { color: new Color([220, 50, 50, 0.9]), width: 1.5, style: "dash" }
});

const CLONE_DRAG_LIVE_ANNOTATION_LIMIT = 25;

interface UndoEntry {
    label: string;
    undo: () => void;
    redo: () => void;
}

interface CloneDragSymbol {
    graphic: Graphic;
    layer: GraphicsLayer;
    id: string;
    undo: () => void;
    redo: () => void;
}

interface CloneDragSource {
    graphic: Graphic;
    layerId: string;
}

interface CloneDragCallbacks {
    buildClones: (sources: CloneDragSource[]) => CloneDragSymbol[] | null;
    pushUndo: (entry: UndoEntry) => void;
    closeActiveWorkflow: () => void;
}

interface CloneDragState {
    token: number;
    previousSelection: Graphic[];
    lastMapPoint: Point;
    latestMapPoint: Point;
    items: CloneDragSymbol[];
    rafId: number | null;
    pending: boolean;
    ended: boolean;
    moved: boolean;
}

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
class SelectionEngine {
    private _getView: () => MapView | SceneView;
    private _layerManager: GraphicsLayerManager;

    private _selected: Map<string, Graphic> = new Map();                 // id → graphic
    private _highlights: Map<string, { remove(): void }> = new Map();   // id → ArcGIS highlight handle

    private _clickHandle: any = null;
    private _pointerMoveHandle: any = null;
    private _dragHandle: any = null;
    private _hoverHandle: { remove(): void } | null = null;
    private _hoverGraphic: Graphic | null = null;
    private _isDrawing: boolean = false;
    private _targetLayerIds: string[] = [];
    private _suppressNextClick: boolean = false;
    private _cloneDragCallbacks: CloneDragCallbacks | null = null;
    private _cloneDragState: CloneDragState | null = null;
    private _cloneDragToken = 0;

    // Active SketchVM for batch-move proxy drag
    private _sketchVM: SketchViewModel | null = null;

    // Active SketchVM for lasso-select polygon draw
    private _lassoVM: SketchViewModel | null = null;

    private _eventListeners: Map<string, Function[]> = new Map();

    // Called after each graphic's geometry is updated so the caller can refresh annotations
    private _annotationRefresh: ((graphic: Graphic) => void) | null = null;

    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager) {
        this._getView = viewProvider;
        this._layerManager = layerManager;
    }

    /** Register a callback that re-annotates a graphic after its geometry is moved. */
    public setAnnotationRefreshCallback(fn: (graphic: Graphic) => void): void {
        this._annotationRefresh = fn;
    }

    public setCloneDragCallbacks(callbacks: CloneDragCallbacks): void {
        this._cloneDragCallbacks = callbacks;
    }

    /** Suppress hover highlights while a symbol is being drawn. */
    public setDrawing(drawing: boolean): void {
        this._isDrawing = drawing;
        if (drawing) {
            this._hoverHandle?.remove();
            this._hoverHandle = null;
            this._hoverGraphic = null;
        }
    }

    // ── View management ───────────────────────────────────────────────────────

    get view(): MapView | SceneView { return this._getView(); }

    onViewChanged(newView: MapView | SceneView): void {
        // Preserve logical selection but drop stale layerView highlight handles
        const prevSelected = Array.from(this._selected.values());
        this._highlights.forEach(h => h.remove());
        this._highlights.clear();

        this.deactivate();
        this._layerManager = GraphicsLayerManager.getInstance(newView);
        this.activate(this._targetLayerIds);

        // Re-establish highlights on the new view for any previously selected graphics
        prevSelected.forEach(g => {
            const id = this._graphicId(g);
            if (id && this._selected.has(id)) this._addHighlight(g, id);
        });
    }

    // ── Activation ───────────────────────────────────────────────────────────

    /**
     * Start listening for click events on the given layer IDs.
     */
    activate(targetLayerIds: string[]): void {
        this._targetLayerIds = targetLayerIds;
        if (this._clickHandle) this._clickHandle.remove();
        if (this._pointerMoveHandle) this._pointerMoveHandle.remove();
        if (this._dragHandle) this._dragHandle.remove();

        const debouncedHover = promiseUtils.debounce(async (evt: any) => {
            if (this._isDrawing) return;
            if (this._cloneDragState) return;
            const targetLayers = this._targetLayerIds
                .map(id => this._layerManager.getLayer(id))
                .filter((l): l is GraphicsLayer => l !== undefined);
            const hitOptions = targetLayers.length ? { include: targetLayers } : undefined;
            const response = await this.view.hitTest(evt, hitOptions);
            const hit = response.results?.find((r: any) => !!r.graphic);
            const graphic: Graphic | null = hit ? (hit as any).graphic : null;

            if (graphic === this._hoverGraphic) return;

            this._hoverHandle?.remove();
            this._hoverHandle = null;
            this._hoverGraphic = null;

            if (graphic) {
                const layer = this._findContainingLayer(graphic);
                if (!layer) return;
                const layerView = await this.view.whenLayerView(layer) as any;
                this._hoverHandle = layerView.highlight(graphic);
                this._hoverGraphic = graphic;
            }
        });

        this._pointerMoveHandle = this.view.on("pointer-move", (evt) => {
            debouncedHover(evt).catch(() => {}); // suppress AbortError from debounce cancellation
        });

        this._clickHandle = this.view.on("click", async (evt) => {
            if (this._suppressNextClick) {
                this._suppressNextClick = false;
                return;
            }
            if (evt.button !== 0) return; // ignore right/middle click — ArcGIS fires click for all buttons
            const isShift = (evt.native as MouseEvent).shiftKey;

            const targetLayers = this._targetLayerIds
                .map(id => this._layerManager.getLayer(id))
                .filter((l): l is GraphicsLayer => l !== undefined);
            const hitOptions = targetLayers.length ? { include: targetLayers } : undefined;
            const response = await this.view.hitTest(evt, hitOptions);
            const hit = response.results?.find((r: any) => !!r.graphic);

            if (hit) {
                const graphic = (hit as any).graphic as Graphic;
                if (isShift) {
                    this.toggleGraphic(graphic);
                } else {
                    this.clearSelection();
                    this.selectGraphic(graphic);
                }
            } else if (!isShift) {
                this.clearSelection();
            }
        });

        this._dragHandle = this.view.on("drag", (evt) => this._handleCloneDrag(evt));
    }

    deactivate(): void {
        if (this._clickHandle) { this._clickHandle.remove(); this._clickHandle = null; }
        if (this._pointerMoveHandle) { this._pointerMoveHandle.remove(); this._pointerMoveHandle = null; }
        if (this._dragHandle) { this._dragHandle.remove(); this._dragHandle = null; }
        this._cancelCloneDrag(false);
        this._hoverHandle?.remove(); this._hoverHandle = null; this._hoverGraphic = null;
        if (this._sketchVM) { this._sketchVM.cancel(); this._sketchVM.destroy(); this._sketchVM = null; }
        this.cancelLasso();
    }

    /** Cancel any in-progress moveSelected operation without clearing the selection. */
    cancelMove(): void {
        if (this._sketchVM) { this._sketchVM.cancel(); this._sketchVM.destroy(); this._sketchVM = null; }
    }

    /** Cancel any in-progress lasso-select operation without changing the selection. */
    cancelLasso(): void {
        if (this._lassoVM) { this._lassoVM.cancel(); this._lassoVM.destroy(); this._lassoVM = null; }
        this._layerManager.getLayer("_LassoLayer")?.removeAll();
    }

    get isLassoActive(): boolean { return this._lassoVM !== null; }

    // Clone-drag (Cmd/Ctrl+Shift+drag)

    private _handleCloneDrag(evt: any): void {
        const action = evt.action;
        if (action === "start") {
            this._startCloneDrag(evt);
            return;
        }

        const state = this._cloneDragState;
        if (!state) return;

        if (action === "update") {
            evt.stopPropagation?.();
            this._updateCloneDrag(evt);
            return;
        }

        if (action === "end") {
            evt.stopPropagation?.();
            this._finishCloneDrag();
            return;
        }

        if (action === "cancel") {
            evt.stopPropagation?.();
            this._cancelCloneDrag(true);
        }
    }

    private _startCloneDrag(evt: any): void {
        if (!this._cloneDragCallbacks) return;
        if (this._isDrawing) return;
        if ((settingsData as any).features?.copyPaste === false) return;
        if (!this._isCloneDragGesture(evt)) return;

        const mapPoint = this._mapPointFromDrag(evt);
        if (!mapPoint) return;

        evt.stopPropagation?.();
        this._suppressNextClick = true;
        this._cancelCloneDrag(false);
        this._hoverHandle?.remove();
        this._hoverHandle = null;
        this._hoverGraphic = null;

        const token = ++this._cloneDragToken;
        this._cloneDragState = {
            token,
            previousSelection: this.selectedGraphics,
            lastMapPoint: mapPoint,
            latestMapPoint: mapPoint,
            items: [],
            rafId: null,
            pending: true,
            ended: false,
            moved: false,
        };

        void this._resolveCloneDragHit(evt, token).catch((error) => {
            console.warn("[SelectionEngine] Clone-drag hit test failed", error);
            if (this._cloneDragState?.token === token) this._cancelCloneDrag(false);
        });
    }

    private async _resolveCloneDragHit(evt: any, token: number): Promise<void> {
        const targetLayers = this._targetLayerIds
            .map(id => this._layerManager.getLayer(id))
            .filter((l): l is GraphicsLayer => l !== undefined);
        const hitOptions = targetLayers.length ? { include: targetLayers } : undefined;
        const response = await this.view.hitTest(evt, hitOptions);
        const hit = response.results?.find((r: any) => !!r.graphic);
        const source = hit ? ((hit as any).graphic as Graphic) : null;
        const sourceLayer = source ? this._findContainingLayer(source) : null;

        const state = this._cloneDragState;
        if (!state || state.token !== token) return;
        if (state.ended || !source || !sourceLayer) {
            this._cancelCloneDrag(false);
            return;
        }

        const sources = this._cloneDragSourcesForHit(source, sourceLayer);
        if (sources.length === 0) {
            this._cancelCloneDrag(false);
            return;
        }

        this._cloneDragCallbacks?.closeActiveWorkflow();
        const clones = this._cloneDragCallbacks?.buildClones(sources);
        if (!clones || clones.length === 0) {
            this._cancelCloneDrag(false);
            return;
        }

        clones.forEach(clone => clone.layer.add(clone.graphic));
        state.items = clones;
        state.pending = false;

        this.clearSelection();
        clones.forEach(clone => this.selectGraphic(clone.graphic));
        this._applyCloneDragDeltaToLatest(state, true);
        EngineLogger.nextStep(
            'Selection Engine',
            `Clone-drag active - move ${clones.length} duplicated symbol${clones.length !== 1 ? 's' : ''}`
        );
    }

    private _updateCloneDrag(evt: any): void {
        const state = this._cloneDragState;
        if (!state) return;
        const mapPoint = this._mapPointFromDrag(evt);
        if (!mapPoint) return;

        state.latestMapPoint = mapPoint;
        this._scheduleCloneDragFrame(state);
    }

    private _finishCloneDrag(): void {
        const state = this._cloneDragState;
        if (!state) return;

        if (state.pending) {
            state.ended = true;
            return;
        }

        this._flushCloneDragFrame(state, true);
        this._cloneDragState = null;
        if (state.rafId !== null) {
            window.cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
        if (state.items.length === 0) return;
        this._refreshCloneDragAnnotations(state);

        const items = [...state.items];
        const count = items.length;

        this._cloneDragCallbacks?.pushUndo({
            label: `Clone and Move ${count} Symbol${count !== 1 ? 's' : ''}`,
            undo: () => items.forEach(item => item.undo()),
            redo: () => items.forEach(item => item.redo()),
        });
        EngineLogger.success(
            'Selection Engine',
            `${count} symbol${count !== 1 ? 's' : ''} cloned${state.moved ? ' and moved' : ''}`
        );
    }

    private _cancelCloneDrag(restoreSelection: boolean): void {
        const state = this._cloneDragState;
        this._cloneDragState = null;
        if (!state) return;
        if (state.rafId !== null) {
            window.cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }

        if (state.items.length > 0) {
            state.items.forEach(item => item.undo());
            this.clearSelection();
            if (restoreSelection) {
                state.previousSelection.forEach(g => {
                    if (this._findContainingLayer(g)) this.selectGraphic(g);
                });
            }
        }
    }

    private _scheduleCloneDragFrame(state: CloneDragState): void {
        if (state.pending || state.items.length === 0 || state.rafId !== null) return;
        state.rafId = window.requestAnimationFrame(() => {
            state.rafId = null;
            this._flushCloneDragFrame(state, false);
        });
    }

    private _flushCloneDragFrame(state: CloneDragState, forceAnnotationRefresh: boolean): void {
        if (state.rafId !== null) {
            window.cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
        this._applyCloneDragDeltaToLatest(state, forceAnnotationRefresh);
    }

    private _applyCloneDragDeltaToLatest(state: CloneDragState, forceAnnotationRefresh: boolean = false): void {
        if (state.pending || state.items.length === 0) return;

        const dx = state.latestMapPoint.x - state.lastMapPoint.x;
        const dy = state.latestMapPoint.y - state.lastMapPoint.y;
        if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;

        const graphics = state.items.map(item => item.graphic);
        const refreshAnnotations =
            forceAnnotationRefresh ||
            state.items.length <= CLONE_DRAG_LIVE_ANNOTATION_LIMIT;
        this._applyDelta(graphics, dx, dy, refreshAnnotations);
        state.lastMapPoint = state.latestMapPoint;
        state.moved = true;
    }

    private _cloneDragSourcesForHit(source: Graphic, sourceLayer: GraphicsLayer): CloneDragSource[] {
        if (this.isSelected(source) && this.count > 1) {
            const selectedSources = this.selectedGraphics
                .map((graphic) => {
                    const layer = this._findContainingLayer(graphic);
                    return layer ? { graphic, layerId: layer.id } : null;
                })
                .filter((item): item is CloneDragSource => item !== null);

            if (selectedSources.length > 0) return selectedSources;
        }

        return [{ graphic: source, layerId: sourceLayer.id }];
    }

    private _refreshCloneDragAnnotations(state: CloneDragState): void {
        state.items.forEach(item => this._annotationRefresh?.(item.graphic));
    }

    private _isCloneDragGesture(evt: any): boolean {
        const native = evt.native ?? evt;
        const shift = Boolean(native.shiftKey ?? evt.shiftKey);
        const commandOrCtrl = Boolean(native.metaKey ?? evt.metaKey) || Boolean(native.ctrlKey ?? evt.ctrlKey);
        return shift && commandOrCtrl;
    }

    private _mapPointFromDrag(evt: any): Point | null {
        const point = evt.mapPoint ?? this.view.toMap({ x: evt.x, y: evt.y });
        return point ? (point.clone?.() ?? point) : null;
    }

    // ── Lasso Select ─────────────────────────────────────────────────────────

    /**
     * Let the user draw a polygon; on completion every symbol whose geometry
     * is contained in (or intersects) the polygon is added to the selection.
     *
     * The polygon is drawn as a single click-to-vertex sketch (double-click
     * or right-click to finish).  Pass `freehand: true` for a freehand lasso.
     *
     * @param onComplete  Called with the newly-selected graphics when done.
     */
    lassoSelect(
        opts?: { freehand?: boolean; addToSelection?: boolean; subtract?: boolean },
        onComplete?: (selected: Graphic[]) => void
    ): void {
        if (this._lassoVM) { this._lassoVM.cancel(); this._lassoVM.destroy(); }

        const lassoLayer = this._layerManager.getOrCreateLayer("_LassoLayer");
        lassoLayer.removeAll();

        this._lassoVM = new SketchViewModel({
            view: this.view,
            layer: lassoLayer,
            polygonSymbol: opts?.subtract ? LASSO_SUBTRACT_SYM : LASSO_SYM,
        });

        EngineLogger.nextStep(
            'Selection Engine',
            `${opts?.subtract ? 'Subtract' : 'Lasso'} active — draw a polygon to ${opts?.subtract ? 'deselect' : 'select'} symbols. ${opts?.freehand ? 'Release mouse' : 'Double-click'} to finish`,
        );

        const mode = opts?.freehand ? "freehand" : "click";
        this._lassoVM.create("polygon", { mode } as any);

        this._lassoVM.on("create", (evt: any) => {
            if (evt.state === "complete") {
                const poly = evt.graphic?.geometry as Polygon | null;
                lassoLayer.removeAll();
                this._lassoVM?.destroy();
                this._lassoVM = null;

                if (!poly) return;

                // Gather all target layers (fall back to all managed layers if none configured)
                const targetIds = this._targetLayerIds.length
                    ? this._targetLayerIds
                    : this._layerManager.listLayers();

                const hit: Graphic[] = [];
                targetIds.forEach(id => {
                    if (id === "_LassoLayer") return;
                    const layer = this._layerManager.getLayer(id);
                    if (!layer) return;
                    (layer.graphics as any).forEach((g: Graphic) => {
                        if (!g.geometry) return;
                        const inside = geometryEngine.intersects(poly, g.geometry);
                        if (inside) hit.push(g);
                    });
                });

                // In subtract mode the lasso reports the graphics it removed from the
                // selection — only those actually selected, so the count is accurate and
                // we don't fire spurious selectionChange events for unselected graphics.
                let affected = hit;
                if (opts?.subtract) {
                    affected = hit.filter(g => this.isSelected(g));
                    affected.forEach(g => this.deselectGraphic(g));
                    if (affected.length > 0) {
                        EngineLogger.success(
                            'Selection Engine',
                            `${affected.length} symbol${affected.length !== 1 ? 's' : ''} removed from selection`,
                        );
                    } else {
                        EngineLogger.nextStep('Selection Engine', 'No selected symbols inside the subtract area');
                    }
                } else {
                    if (!opts?.addToSelection) this.clearSelection();
                    hit.forEach(g => this.selectGraphic(g));
                    if (hit.length > 0) {
                        EngineLogger.success(
                            'Selection Engine',
                            `${hit.length} symbol${hit.length !== 1 ? 's' : ''} selected via lasso`,
                        );
                    } else {
                        EngineLogger.nextStep('Selection Engine', 'No symbols found in lasso area — try a wider selection');
                    }
                }

                if (onComplete) onComplete(affected);
            }

            if (evt.state === "cancel") {
                lassoLayer.removeAll();
                this._lassoVM?.destroy();
                this._lassoVM = null;
            }
        });
    }

    // ── Select Similar / Within ──────────────────────────────────────────────────

    private _getGraphicSIDC(graphic: Graphic): string | null {
        const de = graphic.attributes?.drawEssentials;
        return de?.AMPLIFIER?.SIDC || de?.SIDC || null;
    }

    private _getGraphicSymbolCode(graphic: Graphic): string | null {
        const sidc = this._getGraphicSIDC(graphic);
        if (!sidc || sidc.length < 16) return null;
        return sidc.substring(10, 16);
    }

    private _getGraphicEchelon(graphic: Graphic): string | null {
        const sidc = this._getGraphicSIDC(graphic);
        if (!sidc || sidc.length < 10) return null;
        return sidc.substring(8, 10);
    }

    private _getGraphicIdentity(graphic: Graphic): string | null {
        const sidc = this._getGraphicSIDC(graphic);
        if (!sidc || sidc.length < 4) return null;
        return sidc.substring(2, 4);
    }

    /** Public wrapper around the geom-type classifier so external widgets (e.g. SelectionActionPanel) can bucket selections. */
    public getGraphicGeomType(graphic: Graphic): string | null {
        return this._getGraphicGeomType(graphic);
    }

    private _getGraphicGeomType(graphic: Graphic): string | null {
        const de = graphic.attributes?.drawEssentials;
        if (de?.SYM_GEO_TYPE) return de.SYM_GEO_TYPE;
        if (graphic.geometry?.type === "point") return "Point";
        if (graphic.geometry?.type === "polyline") return "Line";
        if (graphic.geometry?.type === "polygon") return "Area";
        return null;
    }

    private _selectAllMatching(predicate: (g: Graphic) => boolean): void {
        const hit: Graphic[] = [];
        const targetIds = this._targetLayerIds.length ? this._targetLayerIds : this._layerManager.listLayers();
        targetIds.forEach(id => {
            if (id === "_LassoLayer") return;
            const layer = this._layerManager.getLayer(id);
            if (!layer) return;
            (layer.graphics as any).forEach((g: Graphic) => {
                if (!g.geometry) return;
                if (predicate(g)) {
                    hit.push(g);
                }
            });
        });
        this.clearSelection();
        hit.forEach(g => this.selectGraphic(g));
    }

    selectSimilarSameSIDC(graphic: Graphic): void {
        const code = this._getGraphicSymbolCode(graphic);
        if (!code) return;
        this._selectAllMatching(g => this._getGraphicSymbolCode(g) === code);
    }

    selectSimilarSameEchelon(graphic: Graphic): void {
        const echelon = this._getGraphicEchelon(graphic);
        if (!echelon) return;
        this._selectAllMatching(g => this._getGraphicEchelon(g) === echelon);
    }

    selectOwnOnly(): void {
        this._selectAllMatching(g => {
            const id = this._getGraphicIdentity(g);
            return id === "03" || id === "02"; // Friend, Assumed Friend
        });
    }

    selectEnemy(): void {
        this._selectAllMatching(g => {
            const id = this._getGraphicIdentity(g);
            return id === "06" || id === "05" || id === "07"; // Hostile, Suspect, Red
        });
    }

    selectPointSymbols(): void {
        this._selectAllMatching(g => {
            const t = this._getGraphicGeomType(g);
            return t === "Point" || t === "FPoint";
        });
    }

    selectAreaSymbols(): void {
        this._selectAllMatching(g => {
            const t = this._getGraphicGeomType(g);
            return t === "Area" || t === "Polygon";
        });
    }

    selectLineSymbols(): void {
        this._selectAllMatching(g => {
            const t = this._getGraphicGeomType(g);
            return t === "Line" || t === "Polyline";
        });
    }

    selectWithin(graphic: Graphic, includeSelf: boolean = false): void {
        if (!graphic.geometry) return;
        
        let poly: Polygon;
        if (graphic.geometry.type === "polygon") {
            poly = graphic.geometry as Polygon;
        } else if (graphic.geometry.type === "polyline") {
            poly = new Polygon({
                rings: (graphic.geometry as Polyline).paths,
                spatialReference: graphic.geometry.spatialReference
            });
        } else {
            return;
        }

        const hit: Graphic[] = [];
        const targetIds = this._targetLayerIds.length ? this._targetLayerIds : this._layerManager.listLayers();
        targetIds.forEach(id => {
            if (id === "_LassoLayer") return;
            const layer = this._layerManager.getLayer(id);
            if (!layer) return;
            (layer.graphics as any).forEach((g: Graphic) => {
                if (!g.geometry) return;
                if (!includeSelf && g === graphic) return;

                const inside = geometryEngine.intersects(poly, g.geometry);
                    
                if (inside) {
                    hit.push(g);
                }
            });
        });
        
        this.clearSelection();
        hit.forEach(g => this.selectGraphic(g));
        if (includeSelf) {
            this.selectGraphic(graphic);
        }
    }

    // ── Selection management ──────────────────────────────────────────────────

    selectGraphic(graphic: Graphic): void {
        const id = this._graphicId(graphic);
        if (!id || this._selected.has(id)) return;
        this._selected.set(id, graphic);
        this._addHighlight(graphic, id);
        this._emit("selectionChange", { selected: this.selectedGraphics });
        const n = this._selected.size;
        EngineLogger.success('Selection Engine', `${n} symbol${n !== 1 ? 's' : ''} selected`);
    }

    deselectGraphic(graphic: Graphic): void {
        const id = this._graphicId(graphic);
        if (!id) return;
        this._selected.delete(id);
        this._removeHighlight(id);
        this._emit("selectionChange", { selected: this.selectedGraphics });
    }

    toggleGraphic(graphic: Graphic): void {
        const id = this._graphicId(graphic);
        if (!id) return;
        this._selected.has(id) ? this.deselectGraphic(graphic) : this.selectGraphic(graphic);
    }

    clearSelection(): void {
        const hadSelection = this._selected.size > 0;
        this._selected.clear();
        this._highlights.forEach(h => h.remove());
        this._highlights.clear();
        this._emit("selectionChange", { selected: [] });
        if (hadSelection) EngineLogger.nextStep('Selection Engine', 'Selection cleared');
    }

    isSelected(graphic: Graphic): boolean {
        const id = this._graphicId(graphic);
        return id !== null && this._selected.has(id);
    }

    get selectedGraphics(): Graphic[] {
        return Array.from(this._selected.values());
    }

    get count(): number { return this._selected.size; }

    // ── Batch move ────────────────────────────────────────────────────────────

    /**
     * Create a bounding-box proxy graphic and let the user drag it.
     * On completion, apply the same delta to every selected graphic.
     *
     * @param onComplete  Called with { graphics, dx, dy } when move finishes.
     *                    Pass an undo-push callback here.
     */
    moveSelected(
        onComplete?: (result: { graphics: Graphic[]; dx: number; dy: number }) => void
    ): void {
        if (this._selected.size === 0) return;
        EngineLogger.nextStep(
            'Selection Engine',
            `Move mode — drag to reposition ${this._selected.size} selected symbols`,
        );
        if (this._sketchVM) { this._sketchVM.cancel(); this._sketchVM.destroy(); }

        const graphics = this.selectedGraphics;
        const bbox = this._boundingBox(graphics);
        if (!bbox) return;

        // Proxy graphic centred on bounding box
        const proxyGeom = this._bboxToPolygon(bbox);
        const proxyGraphic = new Graphic({ geometry: proxyGeom, symbol: PROXY_SYM });

        const proxyLayer = this._layerManager.getOrCreateLayer("_SelectionProxyLayer");
        proxyLayer.add(proxyGraphic);

        const origCx = (bbox.xmin + bbox.xmax) / 2;
        const origCy = (bbox.ymin + bbox.ymax) / 2;

        // Snapshot original positions
        const snapshots = graphics.map(g => ({
            graphic: g,
            geom: g.geometry.clone(),
            ctrlPts: (g.attributes?.drawEssentials as any)?.CTRL_PTS
                ? (g.attributes.drawEssentials as any).CTRL_PTS.map((p: any) => p.clone?.() ?? p)
                : null,
            baseLnPts: (g.attributes?.drawEssentials as any)?.BASE_LN_PTS
                ? JSON.parse(JSON.stringify((g.attributes.drawEssentials as any).BASE_LN_PTS))
                : null,
        }));

        this._sketchVM = new SketchViewModel({ view: this.view, layer: proxyLayer });
        this._sketchVM.update([proxyGraphic], { tool: "move" } as any);

        this._sketchVM.on("update", (evt: any) => {
            if (evt.state === "complete") {
                const newBbox = proxyGraphic.geometry?.extent;
                if (!newBbox) { proxyLayer.remove(proxyGraphic); return; }

                const newCx = (newBbox.xmin + newBbox.xmax) / 2;
                const newCy = (newBbox.ymin + newBbox.ymax) / 2;
                const dx = newCx - origCx;
                const dy = newCy - origCy;

                // Apply delta to all selected graphics
                this._applyDelta(graphics, dx, dy);

                proxyLayer.remove(proxyGraphic);
                this._sketchVM?.destroy();
                this._sketchVM = null;

                if (onComplete) onComplete({ graphics, dx, dy });
            }
            if (evt.state === "cancel") {
                proxyLayer.remove(proxyGraphic);
                this._sketchVM?.destroy();
                this._sketchVM = null;
            }
        });
    }

    // ── Batch delete ─────────────────────────────────────────────────────────

    /**
     * Delete all selected graphics.
     * @param onEntry Called once with an UndoEntry so the caller can push it to the undo stack.
     */
    deleteSelected(
        onEntry?: (entry: { label: string; undo: () => void; redo: () => void }) => void
    ): void {
        if (this._selected.size === 0) return;

        const toDelete = this.selectedGraphics.map(g => ({
            graphic: g,
            layer: this._findContainingLayer(g),
        }));

        this.clearSelection();

        toDelete.forEach(({ graphic, layer }) => layer?.remove(graphic));

        EngineLogger.success(
            'Selection Engine',
            `${toDelete.length} symbol${toDelete.length > 1 ? 's' : ''} deleted`,
        );

        if (onEntry) {
            onEntry({
                label: `Delete ${toDelete.length} Symbol${toDelete.length > 1 ? "s" : ""}`,
                undo: () => toDelete.forEach(({ graphic, layer }) => layer?.add(graphic)),
                redo: () => toDelete.forEach(({ graphic, layer }) => layer?.remove(graphic)),
            });
        }
    }

    // ── Align & Distribute ────────────────────────────────────────────────────

    /**
     * Spread all selected symbols along a horizontal line (equal X spacing, shared Y = centroid Y).
     */
    alignHorizontal(onEntry?: (e: any) => void): void {
        this._align("horizontal", onEntry);
    }

    /**
     * Spread all selected symbols along a vertical line (equal Y spacing, shared X = centroid X).
     */
    alignVertical(onEntry?: (e: any) => void): void {
        this._align("vertical", onEntry);
    }

    // ── Edge-align operations ─────────────────────────────────────────────────
    // Each moves every symbol so the specified edge/axis aligns to the extreme value
    // across all selected graphics.  Works correctly for point, line, and area symbols
    // because _edges() uses extent for line/polygon and raw coordinates for points.

    alignLeft(onEntry?: (e: any) => void): void {
        this._alignEdge("left", onEntry);
    }

    alignRight(onEntry?: (e: any) => void): void {
        this._alignEdge("right", onEntry);
    }

    alignTop(onEntry?: (e: any) => void): void {
        this._alignEdge("top", onEntry);
    }

    alignBottom(onEntry?: (e: any) => void): void {
        this._alignEdge("bottom", onEntry);
    }

    /** Move all symbols so their centroids share the same X (vertical centre axis). */
    centerOnX(onEntry?: (e: any) => void): void {
        this._alignEdge("centerX", onEntry);
    }

    /** Move all symbols so their centroids share the same Y (horizontal centre axis). */
    centerOnY(onEntry?: (e: any) => void): void {
        this._alignEdge("centerY", onEntry);
    }

    private _alignEdge(
        edge: "left" | "right" | "top" | "bottom" | "centerX" | "centerY",
        onEntry?: (e: any) => void
    ): void {
        const graphics = this.selectedGraphics;
        if (graphics.length < 2) return;
        const snapshots = this._snapshots(graphics);
        const edges = graphics.map(g => this._edges(g));

        let target: number;
        switch (edge) {
            case "left":    target = Math.min(...edges.map(e => e.left));  break;
            case "right":   target = Math.max(...edges.map(e => e.right)); break;
            case "top":     target = Math.max(...edges.map(e => e.top));   break;
            case "bottom":  target = Math.min(...edges.map(e => e.bottom)); break;
            case "centerX": target = (Math.min(...edges.map(e => e.left)) + Math.max(...edges.map(e => e.right))) / 2; break;
            case "centerY": target = (Math.min(...edges.map(e => e.bottom)) + Math.max(...edges.map(e => e.top))) / 2; break;
        }

        graphics.forEach((g, i) => {
            let dx = 0, dy = 0;
            switch (edge) {
                case "left":    dx = target - edges[i].left;   break;
                case "right":   dx = target - edges[i].right;  break;
                case "top":     dy = target - edges[i].top;    break;
                case "bottom":  dy = target - edges[i].bottom; break;
                case "centerX": dx = target - edges[i].cx;     break;
                case "centerY": dy = target - edges[i].cy;     break;
            }
            if (dx !== 0 || dy !== 0) this._applyDelta([g], dx, dy);
        });

        const labels: Record<string, string> = {
            left: "Align Left", right: "Align Right",
            top: "Align Top", bottom: "Align Bottom",
            centerX: "Center on X", centerY: "Center on Y"
        };
        this._pushAlignUndo(labels[edge], snapshots, onEntry);
    }

    private _align(axis: "horizontal" | "vertical", onEntry?: (e: any) => void): void {
        const graphics = this.selectedGraphics;
        if (graphics.length < 2) return;

        const centroids = graphics.map(g => this._centroid(g));
        const snapshots = graphics.map((g, i) => ({
            graphic: g, prevGeom: g.geometry.clone(), prevCtrlPts: null as any
        }));

        if (axis === "horizontal") {
            // Sort by X, keep Y = average Y
            const avgY = centroids.reduce((s, c) => s + c.y, 0) / centroids.length;
            const sortedByX = [...centroids.map((c, i) => ({ c, i }))]
                .sort((a, b) => a.c.x - b.c.x);
            const totalWidth = sortedByX[sortedByX.length - 1].c.x - sortedByX[0].c.x;
            const spacing = graphics.length > 1 ? totalWidth / (graphics.length - 1) : 0;
            const startX = sortedByX[0].c.x;

            sortedByX.forEach(({ i }, seq) => {
                const targetX = startX + seq * spacing;
                const dx = targetX - centroids[i].x;
                const dy = avgY - centroids[i].y;
                this._applyDelta([graphics[i]], dx, dy);
            });
        } else {
            // Sort by Y, keep X = average X
            const avgX = centroids.reduce((s, c) => s + c.x, 0) / centroids.length;
            const sortedByY = [...centroids.map((c, i) => ({ c, i }))]
                .sort((a, b) => a.c.y - b.c.y);
            const totalHeight = sortedByY[sortedByY.length - 1].c.y - sortedByY[0].c.y;
            const spacing = graphics.length > 1 ? totalHeight / (graphics.length - 1) : 0;
            const startY = sortedByY[0].c.y;

            sortedByY.forEach(({ i }, seq) => {
                const targetY = startY + seq * spacing;
                const dx = avgX - centroids[i].x;
                const dy = targetY - centroids[i].y;
                this._applyDelta([graphics[i]], dx, dy);
            });
        }

        this._pushAlignUndo(`Align ${axis === "horizontal" ? "Horizontal" : "Vertical"}`, snapshots, onEntry);
    }

    /**
     * Arrange selected symbols in a square grid centred on their collective centroid.
     * When `spacing` is omitted the mean nearest-neighbour distance of the current
     * selection is used, so the formation respects the existing scale of the map.
     */
    arrangeSquare(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("square", spacing, onEntry);
    }

    /** Arrange in a triangle formation (1 front, widening to rear). */
    arrangeTriangle(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("triangle", spacing, onEntry);
    }

    /** Arrange in an inverted triangle (wide front, narrowing to rear). */
    arrangeInvertedTriangle(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("invertedTriangle", spacing, onEntry);
    }

    /** V-shape: one lead symbol at the point, two arms trailing back at ~45°. */
    arrangeWedge(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("wedge", spacing, onEntry);
    }

    /** Diagonal staircase, trailing left and rear. */
    arrangeEchelonLeft(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("echelonLeft", spacing, onEntry);
    }

    /** Diagonal staircase, trailing right and rear. */
    arrangeEchelonRight(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("echelonRight", spacing, onEntry);
    }

    /** Single file, evenly spaced along the Y axis (north–south column). */
    arrangeColumn(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("column", spacing, onEntry);
    }

    /** Single file, evenly spaced along the X axis (east–west line). */
    arrangeLine(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("line", spacing, onEntry);
    }

    /** Distribute symbols on the perimeter of a rotated square (N/E/S/W corners first). */
    arrangeDiamond(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("diamond", spacing, onEntry);
    }

    /** Distribute symbols evenly around a circle; arc-spacing equals the computed spacing. */
    arrangeCircle(spacing?: number, onEntry?: (e: any) => void): void {
        this._arrange("circle", spacing, onEntry);
    }

    private _arrange(
        type: "square" | "triangle" | "invertedTriangle" | "wedge" | "echelonLeft" | "echelonRight" | "column" | "line" | "diamond" | "circle",
        spacingOverride: number | undefined,
        onEntry?: (e: any) => void
    ): void {
        const graphics = this.selectedGraphics;
        if (graphics.length < 2) return;

        // Use the mean nearest-neighbour distance of the current layout so
        // the formation preserves the visual scale rather than a hardcoded value.
        const spacing = spacingOverride ?? this._computeSpacing(graphics);

        const snapshots = graphics.map(g => ({
            graphic: g, prevGeom: g.geometry.clone(), prevCtrlPts: null as any
        }));

        // Centre of the formation = collective centroid of current positions
        const centroids = graphics.map(g => this._centroid(g));
        const cx = centroids.reduce((s, c) => s + c.x, 0) / centroids.length;
        const cy = centroids.reduce((s, c) => s + c.y, 0) / centroids.length;

        const positions = this._formationPositions(type, graphics.length, cx, cy, spacing);

        graphics.forEach((g, i) => {
            const curr = this._centroid(g);
            this._applyDelta([g], positions[i].x - curr.x, positions[i].y - curr.y);
        });

        const labelMap: Record<string, string> = {
            square: "Arrange Square", triangle: "Arrange Triangle",
            invertedTriangle: "Arrange Inverted Triangle", wedge: "Arrange Wedge",
            echelonLeft: "Arrange Echelon Left", echelonRight: "Arrange Echelon Right",
            column: "Arrange Column", line: "Arrange Line",
            diamond: "Arrange Diamond", circle: "Arrange Circle",
        };
        this._pushAlignUndo(labelMap[type] ?? "Arrange", snapshots, onEntry);
    }

    // ── Formation position generators ─────────────────────────────────────────

    private _formationPositions(
        type: "square" | "triangle" | "invertedTriangle" | "wedge" | "echelonLeft" | "echelonRight" | "column" | "line" | "diamond" | "circle",
        n: number,
        cx: number, cy: number,
        spacing: number
    ): { x: number; y: number }[] {
        switch (type) {
            case "wedge":        return this._wedgePositions(n, cx, cy, spacing);
            case "echelonLeft":  return this._echelonPositions(n, cx, cy, spacing, "left");
            case "echelonRight": return this._echelonPositions(n, cx, cy, spacing, "right");
            case "column":       return this._columnPositions(n, cx, cy, spacing);
            case "line":         return this._linePositions(n, cx, cy, spacing);
            case "diamond":      return this._diamondPerimeterPositions(n, cx, cy, spacing);
            case "circle":       return this._circlePositions(n, cx, cy, spacing);
        }
        if (type === "square") {
            const cols = Math.ceil(Math.sqrt(n));
            const rows = Math.ceil(n / cols);
            const positions: { x: number; y: number }[] = [];
            let idx = 0;
            for (let r = 0; r < rows && idx < n; r++) {
                const rowCount = Math.min(cols, n - r * cols);
                const rowOffsetX = -((rowCount - 1) * spacing) / 2;
                for (let c = 0; c < rowCount && idx < n; c++, idx++) {
                    positions.push({
                        x: cx + rowOffsetX + c * spacing,
                        y: cy + ((rows - 1) / 2 - r) * spacing
                    });
                }
            }
            return positions;
        }

        // Build rows: triangle = [1, 2, 3, ...], inverted = [..., 3, 2, 1]
        const rows = this._triangleRows(n);
        if (type === "invertedTriangle") rows.reverse();
        const totalRows = rows.length;
        const positions: { x: number; y: number }[] = [];

        rows.forEach((rowCount, rowIdx) => {
            const rowOffsetX = -((rowCount - 1) * spacing) / 2;
            const rowY = cy + ((totalRows - 1) / 2 - rowIdx) * spacing;
            for (let c = 0; c < rowCount; c++) {
                positions.push({ x: cx + rowOffsetX + c * spacing, y: rowY });
            }
        });
        return positions;
    }

    /** Build triangle row counts that sum to n: [1, 2, 3, ...] */
    private _triangleRows(n: number): number[] {
        const rows: number[] = [];
        let remaining = n;
        let row = 1;
        while (remaining > 0) {
            const count = Math.min(row, remaining);
            rows.push(count);
            remaining -= count;
            row++;
        }
        return rows;
    }

    /**
     * Wedge (V-shape): one tip at the front, arms alternating left/right going back.
     * Odd remainders go to a centre column behind the last arm pair.
     */
    private _wedgePositions(n: number, cx: number, cy: number, s: number): { x: number; y: number }[] {
        const depth = Math.ceil((n - 1) / 2);
        const positions: { x: number; y: number }[] = [{ x: cx, y: cy + depth * s }];
        let la = 1, ra = 1;
        for (let i = 1; i < n; i++) {
            if (i % 2 === 1) {
                positions.push({ x: cx - la * s, y: cy + (depth - la) * s });
                la++;
            } else {
                positions.push({ x: cx + ra * s, y: cy + (depth - ra) * s });
                ra++;
            }
        }
        return positions;
    }

    /**
     * Echelon: diagonal staircase.
     * Left: lead is top-right, trail goes down-left.
     * Right: lead is top-left, trail goes down-right.
     */
    private _echelonPositions(n: number, cx: number, cy: number, s: number, dir: "left" | "right"): { x: number; y: number }[] {
        const sign = dir === "left" ? -1 : 1;
        return Array.from({ length: n }, (_, i) => ({
            x: cx + sign * (i - (n - 1) / 2) * s,
            y: cy + ((n - 1) / 2 - i) * s
        }));
    }

    /** Column: single file along Y axis, evenly spaced, all at the same X. */
    private _columnPositions(n: number, cx: number, cy: number, s: number): { x: number; y: number }[] {
        return Array.from({ length: n }, (_, i) => ({
            x: cx,
            y: cy + ((n - 1) / 2 - i) * s
        }));
    }

    /** Line: single file along X axis, evenly spaced, all at the same Y. */
    private _linePositions(n: number, cx: number, cy: number, s: number): { x: number; y: number }[] {
        return Array.from({ length: n }, (_, i) => ({
            x: cx + (i - (n - 1) / 2) * s,
            y: cy
        }));
    }

    /**
     * Diamond: symbols distributed evenly on the perimeter of a rotated square
     * (radius = spacing).  For n=4 this gives the classic N/E/S/W diamond.
     */
    private _diamondPerimeterPositions(n: number, cx: number, cy: number, s: number): { x: number; y: number }[] {
        if (n === 1) return [{ x: cx, y: cy }];
        if (n === 2) return [{ x: cx, y: cy + s }, { x: cx, y: cy - s }];
        if (n === 3) return [{ x: cx, y: cy + s }, { x: cx - s, y: cy - s }, { x: cx + s, y: cy - s }];

        return Array.from({ length: n }, (_, i) => {
            const t = (i / n) * 4;   // [0, 4) mapped to 4 sides
            const frac = t % 1;
            if (t < 1) return { x: cx + frac * s,         y: cy + (1 - frac) * s }; // N→E
            if (t < 2) return { x: cx + (1 - frac) * s,   y: cy - frac * s };       // E→S
            if (t < 3) return { x: cx - frac * s,         y: cy - (1 - frac) * s }; // S→W
            return           { x: cx - (1 - frac) * s,    y: cy + frac * s };        // W→N
        });
    }

    /**
     * Circle: symbols distributed evenly on a circle whose arc-spacing ≈ spacing.
     * Starts at the top (north) and goes clockwise.
     */
    private _circlePositions(n: number, cx: number, cy: number, s: number): { x: number; y: number }[] {
        const radius = (s * n) / (2 * Math.PI);
        return Array.from({ length: n }, (_, i) => {
            const angle = (2 * Math.PI * i / n) - Math.PI / 2; // 0 = north
            return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
        });
    }

    // ── Shared snap/edge helpers ──────────────────────────────────────────────

    /**
     * Derive a formation spacing from the current layout of the selected graphics.
     *
     * Algorithm: mean nearest-neighbour distance across all selected symbol centroids.
     * This respects whatever zoom-level / map-scale the user is working at.
     * If all symbols are stacked on the same point a pixel-based fallback is used.
     */
    private _computeSpacing(graphics: Graphic[]): number {
        const pts = graphics.map(g => this._centroid(g));
        const n = pts.length;

        let totalNND = 0;
        for (let i = 0; i < n; i++) {
            let minDist = Infinity;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const dx = pts[i].x - pts[j].x;
                const dy = pts[i].y - pts[j].y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) minDist = d;
            }
            if (isFinite(minDist)) totalNND += minDist;
        }
        const meanNND = totalNND / n;

        // Pixel-based fallback for stacked/coincident symbols (at least 60 screen px)
        const pixelFallback = ((this.view as any).resolution ?? 1) * 60;
        return meanNND > 0 ? meanNND : pixelFallback;
    }

    /** Snapshot geometries before a bulk operation so undo can restore them. */
    private _snapshots(graphics: Graphic[]): { graphic: Graphic; prevGeom: any }[] {
        return graphics.map(g => ({ graphic: g, prevGeom: g.geometry?.clone() }));
    }

    /**
     * Bounding edges of a graphic's geometry.
     * Point symbols use their coordinates directly (no spatial extent).
     * Line/area symbols use the geometry's extent.
     */
    private _edges(graphic: Graphic): { left: number; right: number; top: number; bottom: number; cx: number; cy: number } {
        const geom = graphic.geometry;
        if (!geom) return { left: 0, right: 0, top: 0, bottom: 0, cx: 0, cy: 0 };
        if (geom.type === "point") {
            const p = geom as Point;
            return { left: p.x, right: p.x, top: p.y, bottom: p.y, cx: p.x, cy: p.y };
        }
        const ext = geom.extent;
        if (!ext) {
            const c = this._centroid(graphic);
            return { left: c.x, right: c.x, top: c.y, bottom: c.y, cx: c.x, cy: c.y };
        }
        return {
            left: ext.xmin, right: ext.xmax,
            top: ext.ymax, bottom: ext.ymin,
            cx: (ext.xmin + ext.xmax) / 2,
            cy: (ext.ymin + ext.ymax) / 2
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _graphicId(graphic: Graphic): string | null {
        if (!graphic.attributes) graphic.attributes = {};
        if (!graphic.attributes.id) {
            graphic.attributes.id =
                globalThis.crypto?.randomUUID?.() ??
                `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        return graphic.attributes.id;
    }

    private _centroid(graphic: Graphic): { x: number; y: number } {
        const geom = graphic.geometry;
        if (!geom) return { x: 0, y: 0 };
        if (geom.type === "point") {
            const p = geom as Point;
            return { x: p.x, y: p.y };
        }
        const ext = geom.extent;
        return ext
            ? { x: (ext.xmin + ext.xmax) / 2, y: (ext.ymin + ext.ymax) / 2 }
            : { x: 0, y: 0 };
    }

    public _applyDelta(
        graphics: Graphic[],
        dx: number,
        dy: number,
        refreshAnnotations: boolean = true
    ): void {
        graphics.forEach(g => {
            const geom = g.geometry;
            if (!geom) return;

            const de = g.attributes?.drawEssentials as any;

            if (geom.type === "point") {
                const p = geom as Point;
                const newPt = p.clone();
                newPt.x += dx;
                newPt.y += dy;
                g.geometry = newPt;
            } else if (geom.type === "polyline") {
                const line = geom as Polyline;
                const newLine = line.clone();
                newLine.paths = newLine.paths.map(path =>
                    path.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest])
                );
                g.geometry = newLine;
            } else if (geom.type === "polygon") {
                const poly = geom as Polygon;
                const newPoly = poly.clone();
                newPoly.rings = newPoly.rings.map(ring =>
                    ring.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest])
                );
                g.geometry = newPoly;
            }

            // Shift CTRL_PTS and BASE_LN_PTS
            if (de?.CTRL_PTS) {
                de.CTRL_PTS = de.CTRL_PTS.map((p: any) => this._shiftGeometryLike(p, dx, dy));
            }
            if (de?.BASE_LN_PTS) {
                de.BASE_LN_PTS = {
                    ...de.BASE_LN_PTS,
                    startPt: this._shiftGeometryLike(de.BASE_LN_PTS.startPt, dx, dy),
                    midPt: this._shiftGeometryLike(de.BASE_LN_PTS.midPt, dx, dy),
                    endPt: this._shiftGeometryLike(de.BASE_LN_PTS.endPt, dx, dy),
                };
            }
            if (de?.GEOM) {
                de.GEOM = this._shiftGeometryLike(de.GEOM, dx, dy);
            }
            if (de?.OPTIONS?.GEOM) {
                de.OPTIONS = {
                    ...de.OPTIONS,
                    GEOM: this._shiftGeometryLike(de.OPTIONS.GEOM, dx, dy),
                };
            }

            // Refresh annotation label at new position
            if (refreshAnnotations) this._annotationRefresh?.(g);
        });
    }

    private _shiftGeometryLike(value: any, dx: number, dy: number): any {
        if (!value) return value;
        const clone = value.clone?.() ?? { ...value };

        if (clone.type === "point" || ("x" in clone && "y" in clone)) {
            clone.x = (clone.x ?? 0) + dx;
            clone.y = (clone.y ?? 0) + dy;
            return clone;
        }

        if (clone.type === "polyline" && clone.paths) {
            clone.paths = clone.paths.map((path: number[][]) =>
                path.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest])
            );
            return clone;
        }

        if (clone.type === "polygon" && clone.rings) {
            clone.rings = clone.rings.map((ring: number[][]) =>
                ring.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest])
            );
            return clone;
        }

        return clone;
    }

    private _boundingBox(graphics: Graphic[]): { xmin: number; xmax: number; ymin: number; ymax: number } | null {
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        graphics.forEach(g => {
            const c = this._centroid(g);
            if (c.x < xmin) xmin = c.x;
            if (c.x > xmax) xmax = c.x;
            if (c.y < ymin) ymin = c.y;
            if (c.y > ymax) ymax = c.y;
        });
        if (!isFinite(xmin)) return null;
        // Ensure non-zero extent for proxy
        const pad = 1;
        return { xmin: xmin - pad, xmax: xmax + pad, ymin: ymin - pad, ymax: ymax + pad };
    }

    private _bboxToPolygon(bb: { xmin: number; xmax: number; ymin: number; ymax: number }): Polygon {
        return new Polygon({
            rings: [[
                [bb.xmin, bb.ymin], [bb.xmax, bb.ymin],
                [bb.xmax, bb.ymax], [bb.xmin, bb.ymax],
                [bb.xmin, bb.ymin]
            ]],
            spatialReference: this.view.spatialReference
        });
    }

    /**
     * Locate the GraphicsLayer that currently contains `graphic` by scanning
     * managed layers. Required for ArcGIS 5.0 where `Graphic.layer` was removed
     * and `Graphic.origin` is only populated for feature-query / sketch-derived
     * graphics — not for plain `new Graphic({...})` added to a GraphicsLayer.
     */
    /** Public wrapper around the layer resolver so external widgets (e.g. SelectionActionPanel) can robustly find a graphic's layer. */
    public findContainingLayer(graphic: Graphic): GraphicsLayer | null {
        return this._findContainingLayer(graphic);
    }

    private _findContainingLayer(graphic: Graphic): GraphicsLayer | null {
        // Fast path: origin is set (e.g. graphics from FeatureLayer queries)
        const fromOrigin = (graphic.origin as any)?.layer as GraphicsLayer | undefined;
        if (fromOrigin) return fromOrigin;

        const targetIds = this._targetLayerIds.length
            ? this._targetLayerIds
            : this._layerManager.listLayers();
        for (const id of targetIds) {
            const layer = this._layerManager.getLayer(id);
            if (layer && (layer.graphics as any).includes(graphic)) return layer;
        }
        return null;
    }

    private async _addHighlight(graphic: Graphic, id: string): Promise<void> {
        const layer = this._findContainingLayer(graphic);
        if (!layer) return;
        try {
            const layerView = await this.view.whenLayerView(layer) as any;
            if (!this._selected.has(id)) return; // cleared while awaiting
            const handle = layerView.highlight(graphic);
            this._removeHighlight(id); // drop any stale handle from a racing call
            this._highlights.set(id, handle);
        } catch { /* view replaced during await */ }
    }

    private _removeHighlight(id: string): void {
        this._highlights.get(id)?.remove();
        this._highlights.delete(id);
    }

    private _pushAlignUndo(
        label: string,
        snapshots: { graphic: Graphic; prevGeom: any }[],
        onEntry?: (e: any) => void
    ): void {
        if (!onEntry) return;
        const afterStates = snapshots.map(s => ({
            graphic: s.graphic,
            afterGeom: s.graphic.geometry.clone(),
        }));

        onEntry({
            label,
            undo: () => {
                snapshots.forEach(s => {
                    s.graphic.geometry = s.prevGeom;
                    this._annotationRefresh?.(s.graphic);
                });
            },
            redo: () => {
                afterStates.forEach(s => {
                    s.graphic.geometry = s.afterGeom;
                    this._annotationRefresh?.(s.graphic);
                });
            },
        });
    }

    // ── Context menu items ────────────────────────────────────────────────────

    /**
     * Returns the Selection and Align/Arrange context-menu item trees.
     * Call from SymbolEngine.registerContextMenuItems() and spread the result.
     */
    public buildContextMenuItems(
        pushUndo: (e: any) => void,
        closeActiveWorkflow: () => void
    ): ContextMenuItem[] {
        return [
            // ── Selection submenu ────────────────────────────────────────────────
            {
                id: 'selection-submenu',
                label: 'Selection',
                icon: '<span class="menu-icon-text">◈</span>',
                visible: () => (settingsData as any).features?.selectionMenu !== false,
                children: [
                    {
                        id: 'lasso-select',
                        label: () => this.isLassoActive ? 'Cancel Lasso' : 'Lasso Select',
                        shortcut: 'L',
                        icon: '<span class="menu-icon-text">▣</span>',
                        action: (_graphic: any) => {
                            closeActiveWorkflow();
                            if (this.isLassoActive) {
                                this.cancelLasso();
                            } else {
                                this.lassoSelect();
                            }
                        },
                    },
                    {
                        id: 'toggle-select',
                        label: (graphic: any) =>
                            this.isSelected(graphic) ? 'Deselect' : 'Add to Selection',
                        shortcut: 'Shift+Click',
                        icon: '<span class="menu-icon-text">◈</span>',
                        action: (graphic: any) => this.toggleGraphic(graphic),
                    },
                    {
                        id: 'clear-selection',
                        label: () => `Clear Selection (${this.count})`,
                        icon: '<span class="menu-icon-text">✕</span>',
                        visible: () => this.count > 0,
                        action: (_graphic: any) => this.clearSelection(),
                    },
                    {
                        id: 'move-selected',
                        label: () => `Move Selected (${this.count})`,
                        shortcut: 'M',
                        icon: '<span class="menu-icon-text">✣</span>',
                        visible: () => this.count > 0,
                        action: (_graphic: any) => {
                            closeActiveWorkflow();
                            this.moveSelected(({ graphics, dx, dy }) =>
                                pushUndo({
                                    label: `Move ${graphics.length} Symbols`,
                                    undo: () => this._applyDelta(graphics, -dx, -dy),
                                    redo: () => this._applyDelta(graphics, dx, dy),
                                })
                            );
                        },
                    },
                    {
                        id: 'delete-selected',
                        label: () => `Delete Selected (${this.count})`,
                        shortcut: 'Del',
                        icon: '<span class="menu-icon-text">×</span>',
                        visible: () => this.count > 1,
                        action: (_graphic: any) =>
                            this.deleteSelected((entry) => pushUndo(entry)),
                    },
                    // ── Select Similar submenu ──────────────────────────────────
                    {
                        id: 'select-similar-submenu',
                        label: 'Select Similar',
                        icon: '<span class="menu-icon-text">⌕</span>',
                        children: [
                            {
                                id: 'select-same-sidc',
                                label: 'Same SIDC',
                                icon: '<span class="menu-icon-text">◇</span>',
                                action: (graphic: any) => this.selectSimilarSameSIDC(graphic),
                            },
                            {
                                id: 'select-same-echelon',
                                label: 'Same Echelon',
                                icon: '<span class="menu-icon-text">▣</span>',
                                action: (graphic: any) => this.selectSimilarSameEchelon(graphic),
                            },
                            {
                                id: 'select-own-only',
                                label: 'Own Only',
                                icon: '<span class="menu-icon-text">●</span>',
                                action: () => this.selectOwnOnly(),
                            },
                            {
                                id: 'select-enemy',
                                label: 'Enemy',
                                icon: '<span class="menu-icon-text">○</span>',
                                action: () => this.selectEnemy(),
                            },
                        ],
                    },
                    // ── Select Within submenu ───────────────────────────────────
                    {
                        id: 'select-within-submenu',
                        label: 'Select Within',
                        icon: '<span class="menu-icon-text">◍</span>',
                        children: [
                            {
                                id: 'select-within',
                                label: 'Within',
                                icon: '<span class="menu-icon-text">◍</span>',
                                action: (graphic: any) => this.selectWithin(graphic, false),
                            },
                            {
                                id: 'select-within-self',
                                label: 'Within + Self',
                                icon: '<span class="menu-icon-text">◎</span>',
                                action: (graphic: any) => this.selectWithin(graphic, true),
                            },
                        ],
                    },
                    // ── Filter by Type submenu ──────────────────────────────────
                    {
                        id: 'filter-type-submenu',
                        label: 'Filter by Type',
                        icon: '<span class="menu-icon-text">▼</span>',
                        children: [
                            {
                                id: 'select-points',
                                label: 'Points',
                                icon: '<span class="menu-icon-text">●</span>',
                                action: () => this.selectPointSymbols(),
                            },
                            {
                                id: 'select-areas',
                                label: 'Areas',
                                icon: '<span class="menu-icon-text">■</span>',
                                action: () => this.selectAreaSymbols(),
                            },
                            {
                                id: 'select-lines',
                                label: 'Lines',
                                icon: '<span class="menu-icon-text">╱</span>',
                                action: () => this.selectLineSymbols(),
                            },
                        ],
                    },
                ],
            },
            // ── Align parent menu (Align, Distribute, Arrange) ───────────────────
            {
                id: 'align-parent',
                label: 'Align',
                icon: '<span class="menu-icon-text">⊞</span>',
                visible: () => (settingsData as any).features?.alignMenu !== false && this.count > 1,
                children: [
                    // ── Align submenu ───────────────────────────────────────────
                    {
                        id: 'align-submenu',
                        label: 'Align',
                        icon: '<span class="menu-icon-text">⊞</span>',
                        children: [
                            {
                                id: 'align-left',
                                label: 'Align Left',
                                icon: '<span class="menu-icon-text">←</span>',
                                action: (_g: any) => this.alignLeft((e) => pushUndo(e)),
                            },
                            {
                                id: 'align-right',
                                label: 'Align Right',
                                icon: '<span class="menu-icon-text">→</span>',
                                action: (_g: any) => this.alignRight((e) => pushUndo(e)),
                            },
                            {
                                id: 'align-top',
                                label: 'Align Top',
                                icon: '<span class="menu-icon-text">↑</span>',
                                action: (_g: any) => this.alignTop((e) => pushUndo(e)),
                            },
                            {
                                id: 'align-bottom',
                                label: 'Align Bottom',
                                icon: '<span class="menu-icon-text">↓</span>',
                                action: (_g: any) => this.alignBottom((e) => pushUndo(e)),
                            },
                            {
                                id: 'center-on-x',
                                label: 'Center on X',
                                icon: '<span class="menu-icon-text">↕</span>',
                                action: (_g: any) => this.centerOnX((e) => pushUndo(e)),
                            },
                            {
                                id: 'center-on-y',
                                label: 'Center on Y',
                                icon: '<span class="menu-icon-text">↔</span>',
                                action: (_g: any) => this.centerOnY((e) => pushUndo(e)),
                            },
                        ],
                    },
                    // ── Distribute submenu ──────────────────────────────────────
                    {
                        id: 'distribute-submenu',
                        label: 'Distribute',
                        icon: '<span class="menu-icon-text">⇔</span>',
                        children: [
                            {
                                id: 'align-horizontal',
                                label: 'Distribute Horizontal',
                                icon: '<span class="menu-icon-text">⇔</span>',
                                action: (_g: any) => this.alignHorizontal((e) => pushUndo(e)),
                            },
                            {
                                id: 'align-vertical',
                                label: 'Distribute Vertical',
                                icon: '<span class="menu-icon-text">↕</span>',
                                action: (_g: any) => this.alignVertical((e) => pushUndo(e)),
                            },
                        ],
                    },
                    // ── Arrange submenu ─────────────────────────────────────────
                    {
                        id: 'arrange-submenu',
                        label: 'Arrange',
                        icon: '<span class="menu-icon-text">⊞</span>',
                        children: [
                            {
                                id: 'arrange-line',
                                label: 'Line',
                                icon: '<span class="menu-icon-text">―</span>',
                                action: (_g: any) => this.arrangeLine(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-column',
                                label: 'Column',
                                icon: '<span class="menu-icon-text">|</span>',
                                action: (_g: any) => this.arrangeColumn(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-square',
                                label: 'Square Grid',
                                icon: '<span class="menu-icon-text">⊞</span>',
                                action: (_g: any) => this.arrangeSquare(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-triangle',
                                label: 'Triangle',
                                icon: '<span class="menu-icon-text">▲</span>',
                                action: (_g: any) => this.arrangeTriangle(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-inv-triangle',
                                label: 'Inverted Triangle',
                                icon: '<span class="menu-icon-text">▽</span>',
                                action: (_g: any) => this.arrangeInvertedTriangle(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-wedge',
                                label: 'Wedge',
                                icon: '<span class="menu-icon-text">⋁</span>',
                                action: (_g: any) => this.arrangeWedge(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-echelon-left',
                                label: 'Echelon Left',
                                icon: '<span class="menu-icon-text">↙</span>',
                                action: (_g: any) => this.arrangeEchelonLeft(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-echelon-right',
                                label: 'Echelon Right',
                                icon: '<span class="menu-icon-text">↘</span>',
                                action: (_g: any) => this.arrangeEchelonRight(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-diamond',
                                label: 'Diamond',
                                icon: '<span class="menu-icon-text">◇</span>',
                                action: (_g: any) => this.arrangeDiamond(undefined, (e) => pushUndo(e)),
                            },
                            {
                                id: 'arrange-circle',
                                label: 'Circle',
                                icon: '<span class="menu-icon-text">○</span>',
                                action: (_g: any) => this.arrangeCircle(undefined, (e) => pushUndo(e)),
                            },
                        ],
                    },
                ],
            },
        ];
    }

    // ── Event system ──────────────────────────────────────────────────────────

    public on(type: string, listener: Function): { remove(): void } {
        if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
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

    private _emit(type: string, data: any): void {
        this._eventListeners.get(type)?.forEach(fn => fn(data));
    }
}

export default SelectionEngine;
