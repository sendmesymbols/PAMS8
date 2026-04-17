import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import Color from "@arcgis/core/Color";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import AnnotationEngine from "./AnnotationEngine.ts";

// ── Highlight symbols ────────────────────────────────────────────────────────

const HIGHLIGHT_POINT_SYM = new SimpleMarkerSymbol({
    style: "circle",
    color: new Color([0, 120, 255, 0]),
    size: 24,
    outline: { color: new Color([0, 120, 255, 1]), width: 3 }
});

const HIGHLIGHT_LINE_SYM = new SimpleLineSymbol({
    color: new Color([0, 120, 255, 0.9]),
    width: 4,
    style: "dash"
});

const HIGHLIGHT_FILL_SYM = new SimpleFillSymbol({
    color: new Color([0, 120, 255, 0.12]),
    outline: { color: new Color([0, 120, 255, 1]), width: 3 }
});

// ── Proxy bounding-box symbol (used as drag handle for batch move) ───────────

const PROXY_SYM = new SimpleFillSymbol({
    color: new Color([0, 120, 255, 0.08]),
    outline: { color: new Color([0, 120, 255, 0.6]), width: 2, style: "dash" }
});

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

    private _selected: Map<string, Graphic> = new Map();         // id → graphic
    private _highlights: Map<string, Graphic> = new Map();       // id → highlight overlay
    private _highlightLayer!: GraphicsLayer;

    private _clickHandle: any = null;
    private _targetLayerIds: string[] = [];

    // Active SketchVM for batch-move proxy drag
    private _sketchVM: SketchViewModel | null = null;

    private _eventListeners: Map<string, Function[]> = new Map();

    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager) {
        this._getView = viewProvider;
        this._layerManager = layerManager;
        this._highlightLayer = layerManager.getOrCreateLayer(LAYER_NAMES.SELECTION_HIGHLIGHT);
    }

    // ── View management ───────────────────────────────────────────────────────

    get view(): MapView | SceneView { return this._getView(); }

    onViewChanged(newView: MapView | SceneView): void {
        this.deactivate();
        this._layerManager = GraphicsLayerManager.getInstance(newView);
        this._highlightLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.SELECTION_HIGHLIGHT);
        this.activate(this._targetLayerIds);
    }

    // ── Activation ───────────────────────────────────────────────────────────

    /**
     * Start listening for click events on the given layer IDs.
     */
    activate(targetLayerIds: string[]): void {
        this._targetLayerIds = targetLayerIds;
        if (this._clickHandle) this._clickHandle.remove();

        this._clickHandle = this.view.on("click", async (evt) => {
            const isShift = (evt.native as MouseEvent).shiftKey;

            const response = await this.view.hitTest(evt);
            const hit = response.results?.find((r: any) => {
                if (!r.graphic) return false;
                const id = r.graphic.layer?.id;
                return targetLayerIds.length === 0 || (id && targetLayerIds.includes(id));
            });

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
    }

    deactivate(): void {
        if (this._clickHandle) { this._clickHandle.remove(); this._clickHandle = null; }
        if (this._sketchVM) { this._sketchVM.cancel(); this._sketchVM.destroy(); this._sketchVM = null; }
    }

    /** Cancel any in-progress moveSelected operation without clearing the selection. */
    cancelMove(): void {
        if (this._sketchVM) { this._sketchVM.cancel(); this._sketchVM.destroy(); this._sketchVM = null; }
    }

    // ── Selection management ──────────────────────────────────────────────────

    selectGraphic(graphic: Graphic): void {
        const id = this._graphicId(graphic);
        if (!id || this._selected.has(id)) return;
        this._selected.set(id, graphic);
        this._addHighlight(graphic, id);
        this._emit("selectionChange", { selected: this.selectedGraphics });
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
        this._selected.clear();
        this._highlightLayer.removeAll();
        this._highlights.clear();
        this._emit("selectionChange", { selected: [] });
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
        if (this._selected.size < 2) return;
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

                // Refresh highlights at new positions
                this._refreshHighlights();

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
            layer: g.layer as GraphicsLayer | null,
        }));

        this.clearSelection();

        toDelete.forEach(({ graphic, layer }) => layer?.remove(graphic));

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

        this._refreshHighlights();
        this._pushAlignUndo(`Align ${axis === "horizontal" ? "Horizontal" : "Vertical"}`, snapshots, onEntry);
    }

    /**
     * Arrange selected symbols in a square grid centred on their collective centroid.
     */
    arrangeSquare(spacing: number = 500, onEntry?: (e: any) => void): void {
        this._arrange("square", spacing, onEntry);
    }

    /**
     * Arrange selected symbols in a triangle formation (1 front, widening to rear).
     */
    arrangeTriangle(spacing: number = 500, onEntry?: (e: any) => void): void {
        this._arrange("triangle", spacing, onEntry);
    }

    /**
     * Arrange in an inverted triangle (wide front, narrowing to rear).
     */
    arrangeInvertedTriangle(spacing: number = 500, onEntry?: (e: any) => void): void {
        this._arrange("invertedTriangle", spacing, onEntry);
    }

    private _arrange(
        type: "square" | "triangle" | "invertedTriangle",
        spacing: number,
        onEntry?: (e: any) => void
    ): void {
        const graphics = this.selectedGraphics;
        if (graphics.length < 2) return;

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

        this._refreshHighlights();
        const label = type === "square" ? "Arrange Square"
            : type === "triangle" ? "Arrange Triangle"
            : "Arrange Inverted Triangle";
        this._pushAlignUndo(label, snapshots, onEntry);
    }

    // ── Formation position generators ─────────────────────────────────────────

    private _formationPositions(
        type: "square" | "triangle" | "invertedTriangle",
        n: number,
        cx: number, cy: number,
        spacing: number
    ): { x: number; y: number }[] {
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

    // ── Private helpers ───────────────────────────────────────────────────────

    private _graphicId(graphic: Graphic): string | null {
        return graphic.attributes?.id ?? null;
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

    private _applyDelta(graphics: Graphic[], dx: number, dy: number): void {
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
                de.CTRL_PTS = de.CTRL_PTS.map((p: any) => {
                    const c = p.clone ? p.clone() : { ...p };
                    c.x += dx; c.y += dy;
                    return c;
                });
            }
            if (de?.BASE_LN_PTS) {
                de.BASE_LN_PTS = de.BASE_LN_PTS.map((p: any) => ({
                    ...p, x: (p.x ?? 0) + dx, y: (p.y ?? 0) + dy
                }));
            }
        });
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

    private _addHighlight(graphic: Graphic, id: string): void {
        const geom = graphic.geometry;
        if (!geom) return;
        let sym: any;
        if (geom.type === "point") sym = HIGHLIGHT_POINT_SYM;
        else if (geom.type === "polyline") sym = HIGHLIGHT_LINE_SYM;
        else sym = HIGHLIGHT_FILL_SYM;

        const h = new Graphic({ geometry: geom, symbol: sym });
        this._highlightLayer.add(h);
        this._highlights.set(id, h);
    }

    private _removeHighlight(id: string): void {
        const h = this._highlights.get(id);
        if (h) { this._highlightLayer.remove(h); this._highlights.delete(id); }
    }

    /** Re-sync highlight geometries to current graphic positions (after move/align). */
    private _refreshHighlights(): void {
        this._selected.forEach((graphic, id) => {
            const h = this._highlights.get(id);
            if (h) h.geometry = graphic.geometry;
        });
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
                snapshots.forEach(s => { s.graphic.geometry = s.prevGeom; });
                this._refreshHighlights();
            },
            redo: () => {
                afterStates.forEach(s => { s.graphic.geometry = s.afterGeom; });
                this._refreshHighlights();
            },
        });
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
