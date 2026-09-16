import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import DrawSeam from "../Support/DrawSeam";
import SymbolEvents from "../Support/SymbolEvents";

/**
 * Options every tactical line/area symbol accepts in init().
 * CTRL_PTS + GEOM   → immediate placement with a prebuilt geometry (plan load)
 * CTRL_PTS only     → immediate placement, geometry rebuilt via createSymbol()
 * neither           → interactive drawing (click / pointer-move / double-click)
 */
export interface TacticalSymbolOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline | Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}

export interface TacticalSymbolConfig {
    /** Six-digit symbol id stamped into DrawEssentials.SID. */
    SID: string;
    /** Display name stamped into DrawEssentials.SYM_NAME. */
    symName: string;
    /** "Line" | "Area" — stamped into DrawEssentials.SYM_GEO_TYPE. */
    symGeometricType: string;
    /** Channel name for SymbolEvents (usually the class name). */
    eventName: string;
}

/**
 * Base class for tactical line/area symbols.
 *
 * The ~160 symbol classes in MS/Symbols/ historically each carried a copy of
 * the same scaffold: view/layer wiring, the three init() placement modes, the
 * click / double-click / pointer-move interactive-draw handlers, DrawEssentials
 * assembly, the onDrawProgress/onDrawClick/onDrawEnd event emissions, cleanup
 * and deactivate(). Any lifecycle fix had to be repeated per class. This base
 * owns that scaffold once; a subclass provides its identity (config) and its
 * geometry math (createSymbol), and may override the protected hooks where its
 * behavior genuinely differs.
 *
 * External contract preserved: SymbolEngine drives instances via init() /
 * deactivate() / on(); EditEngine re-renders edits by duck-typing
 * `de.SCOPE.createSymbol(de)` — createSymbol is therefore public.
 */
export abstract class ____TacticalSymbolBase {
    protected view: MapView | SceneView;
    protected layerManager: GraphicsLayerManager;
    protected symbolLayer: GraphicsLayer;
    protected isLine: boolean;

    protected SID: string;
    protected symName: string;
    protected symGeometricType: string;

    protected _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    protected _points: Point[] = [];
    protected _drawType: number = 1;
    protected amplifier: Amplifier;

    protected isDrawing: boolean = false;
    protected tempGraphic: Graphic | null = null;

    private clickHandler: { remove(): void } | null = null;
    private doubleClickHandler: { remove(): void } | null = null;
    private mouseMoveHandler: { remove(): void } | null = null;

    protected events: SymbolEvents;

    protected constructor(view: MapView | SceneView, isLine: boolean, config: TacticalSymbolConfig) {
        this.view = view;
        this.isLine = isLine;
        this.SID = config.SID;
        this.symName = config.symName;
        this.symGeometricType = config.symGeometricType;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, config.eventName);
        this.layerManager.initializeLayers();
        this.tempGraphic = new Graphic();
    }

    /**
     * Build this symbol's geometry from DrawEssentials (CTRL_PTS, DRAW_TYPE,
     * plus any subclass extras). Called on every pointer move during an
     * interactive draw, on immediate placement, and by EditEngine through
     * `de.SCOPE.createSymbol(de)` while control points are dragged — it must
     * tolerate degenerate inputs mid-draw and return null instead of throwing.
     */
    public abstract createSymbol(drawEssentials: DrawEssentials): Polyline | Polygon | null;

    // ── init() placement modes (shared) ───────────────────────────────────────

    /**
     * Run the standard three-mode placement flow. Subclasses call this from
     * their public init() after storing their marker/parameters.
     */
    protected initFromOptions(options: TacticalSymbolOptions): void {
        if (Object.prototype.hasOwnProperty.call(options, "CTRL_PTS")
            && Object.prototype.hasOwnProperty.call(options, "GEOM")
            && options.GEOM != null) {
            // Immediate placement with both control points and prebuilt geometry
            if (this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = this.geometryFromOptions(options);
                } catch (error) {
                    console.error(this.symName, "Failed to create geometry:", error);
                }
            }
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline | Polygon, drawEss);
            }
            this._clear();
        } else if (Object.prototype.hasOwnProperty.call(options, "CTRL_PTS")) {
            // Immediate placement — rebuild geometry from control points
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
            const geometry = this.createSymbol(drawEss);
            if (geometry && this.tempGraphic) {
                this.tempGraphic.geometry = geometry;
                this.__drawEnd(geometry, drawEss);
                this._clear();
            }
        } else {
            this.startInteractiveDrawing();
        }
    }

    /**
     * Turn options.GEOM (paths/rings from a saved plan) into a real geometry.
     * Line symbols get a Polyline; override for Polygon-geometry symbols.
     */
    protected geometryFromOptions(options: TacticalSymbolOptions): Polyline | Polygon {
        return new Polyline({
            paths: options.GEOM as any,
            spatialReference: this.view.spatialReference,
        });
    }

    // ── Interactive drawing (shared) ──────────────────────────────────────────

    protected startInteractiveDrawing(): void {
        if (!this._lineSym) return;
        this.isDrawing = true;
        this.tempGraphic = new Graphic({ geometry: null as any, symbol: this._lineSym });
        this.symbolLayer.add(this.tempGraphic);

        this.clickHandler = this.view.on("click", (event: any) => this._onClickHandler(event));
        this.doubleClickHandler = this.view.on("double-click", (event: any) => this._onDoubleClickHandler(event));
    }

    /** After a click lands: true → the draw is complete (e.g. two-point lines). */
    protected shouldFinishAfterClick(): boolean {
        return this.isLine === true && this._points.length === 1;
    }

    private _onClickHandler(clickEvent: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference,
        }));

        if (this._points.length === 1) {
            this.mouseMoveHandler = this.view.on("pointer-move", (event: any) => this._onMouseMoveHandler(event));
        }

        this.events.emit("onDrawClick", { currentPts: this._points });

        if (this.shouldFinishAfterClick()) {
            this.cleanUp();
        }
    }

    private _onDoubleClickHandler(clickEvent: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference,
        }));
        this.cleanUp();
    }

    private _onMouseMoveHandler(inputEvent: any): void {
        if (!this.isDrawing || !this.tempGraphic) return;

        const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference,
        });

        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
        (drawEssentials as any).DRAW_TYPE = this._drawType;

        const geometry = this.createSymbol(drawEssentials);
        if (geometry) {
            this.tempGraphic.geometry = geometry;
            this.events.emit("onDrawProgress", {
                currentGeometry: geometry,
                currentDrawEssentials: drawEssentials,
                currentMarker: this._lineSym,
            });
        }
    }

    // ── DrawEssentials & completion (shared) ──────────────────────────────────

    /**
     * Assemble the DrawEssentials handed to SymbolEngine on completion.
     * Subclasses override to append their extra parameters (call super first).
     */
    protected createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).DRAW_TYPE = drawType;
        return drawEssentials;
    }

    protected cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEss = this.createDrawEssentials(this._points.slice(), this._drawType);
        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polyline | Polygon, drawEss);
        }
        this._clear();
        this._removeEvents();
    }

    protected __drawEnd(drawGeometry: Polyline | Polygon, drawEssentials: DrawEssentials): void {
        if (!drawGeometry) return;
        const spatialRef = this.view.spatialReference;
        let geographicGeometry = drawGeometry;
        if (spatialRef && spatialRef.wkid === 4326) {
            geographicGeometry = drawGeometry.clone();
        }
        this.events.emit("onDrawEnd", {
            geometry: drawGeometry,
            geographicGeometry,
            drawEssentials,
            marker: this._lineSym,
        });
    }

    // ── Cleanup / public surface (shared) ─────────────────────────────────────

    protected _clear(): void {
        if (this.tempGraphic && this.symbolLayer) {
            this.symbolLayer.remove(this.tempGraphic);
        }
        this.tempGraphic = null;
        this._points = [];
    }

    protected _removeEvents(): void {
        this.clickHandler?.remove();
        this.clickHandler = null;
        this.doubleClickHandler?.remove();
        this.doubleClickHandler = null;
        this.mouseMoveHandler?.remove();
        this.mouseMoveHandler = null;
    }

    /** Premium stylus seam: remove the last placed vertex (undo). Re-render is
     *  driven by the premium layer's next move. */
    public removeLastPoint(): boolean {
        if (!this._points || this._points.length === 0) return false;
        this._points.pop();
        if (this._points.length === 0 && this.tempGraphic) {
            this.tempGraphic.geometry = null as any;
        }
        return true;
    }

    /** Abandon an in-flight draw: drop temp graphics and view listeners. */
    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this.isDrawing = false;
    }

    public on(eventName: string, callback: (data: any) => void): void {
        this.events.on(eventName, callback);
    }

    public off(eventName: string, callback?: (data: any) => void): void {
        this.events.off(eventName, callback);
    }

    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default ____TacticalSymbolBase;
