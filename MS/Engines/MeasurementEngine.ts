/**
 * MeasurementEngine.ts
 * Provides real-time measurements during symbol drawing: segment lengths, bearings,
 * total lengths, areas, and bounding-box dimensions.
 *
 * Singleton — use MeasurementEngine.getInstance().
 *
 * Events emitted on document:
 *   "measurement-update"       – { segmentLength, totalLength, area, bearing, height, width, unit, areaUnit }
 *   "measurement-state-change" – { state: "enabled"|"disabled", isEnabled: boolean }
 *   "measurement-hint"         – { message: string, phase: "idle"|"drawing"|"segment"|"complete" }
 *                                 Contextual guidance emitted at key drawing moments.
 */

import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import Extent from "@arcgis/core/geometry/Extent";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import Color from "@arcgis/core/Color";
import Font from "@arcgis/core/symbols/Font";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import EngineLogger from "../Support/EngineLogger";

// ─── Public types ─────────────────────────────────────────────────────────────

export type DistanceUnit =
    | "feet" | "miles" | "kilometers" | "nautical-miles" | "meters" | "yards";

export type AreaUnit =
    | "square-miles" | "acres" | "square-kilometers" | "hectares"
    | "square-meters" | "square-feet" | "square-yards";

export interface MeasurementOptions {
    dist_unit?: DistanceUnit;
    area_unit?: AreaUnit;
    font_size?: number;
    font_color?: [number, number, number];
    font_opacity?: number;
    line_color?: [number, number, number];
    line_width?: number;
    line_opacity?: number;
    /** Show bearing alongside segment length */
    show_bng?: boolean;
    show_height?: boolean;
    show_width?: boolean;
    show_area?: boolean;
    show_total?: boolean;
    show_segment?: boolean;
    show_extent?: boolean;
    show_line?: boolean;
    /** Only keep the most-recent segment label on the map */
    show_last_seg_only?: boolean;
    /** Compute slant range using elevation delta-Z */
    slant_range?: boolean;
    /** Magnetic declination to apply to bearings (degrees) */
    magnetic_declination?: number;
    /** Speed in km/h for march-time estimation */
    speed_kmh?: number;
}

export interface MeasurementSnapshot {
    segmentLength: string;
    totalLength: string;
    area: string;
    bearing: string;
    trueAzimuth?: number;
    magneticAzimuth?: number;
    gridAzimuth?: number;
    height: string;
    width: string;
    unit: DistanceUnit;
    areaUnit: AreaUnit;
}

export interface MeasurementHint {
    message: string;
    /** Drawing phase that triggered this hint. */
    phase: "idle" | "drawing" | "segment" | "complete";
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class MeasurementEngine {

    private static _instance: MeasurementEngine;

    // State
    private _isEnabled: boolean = false;
    private _view: MapView | SceneView | null = null;
    private _isGeodesic: boolean = false;

    // Graphics layer + individual graphic handles
    private _layer: GraphicsLayer | null = null;
    private _segGraphic: Graphic | null = null;
    private _lineGraphic: Graphic | null = null;
    private _extentGraphic: Graphic | null = null;
    private _hGraphic: Graphic | null = null;   // bounding-box height label
    private _wGraphic: Graphic | null = null;   // bounding-box width label
    private _aGraphic: Graphic | null = null;   // area label
    private _tGraphic: Graphic | null = null;   // total-length label

    // ── Unit tables ──────────────────────────────────────────────────────────

    readonly distanceUnits: Array<{ unit: DistanceUnit; abbr: string }> = [
        { unit: "feet",           abbr: "'"     },
        { unit: "miles",          abbr: "mi"    },
        { unit: "kilometers",     abbr: "km"    },
        { unit: "nautical-miles", abbr: "nm"    },
        { unit: "meters",         abbr: "m"     },
        { unit: "yards",          abbr: "yd"    },
    ];

    readonly areaUnits: Array<{ unit: AreaUnit; abbr: string }> = [
        { unit: "square-miles",      abbr: "sq mi" },
        { unit: "acres",             abbr: "ac"    },
        { unit: "square-kilometers", abbr: "sq km" },
        { unit: "hectares",          abbr: "ha"    },
        { unit: "square-meters",     abbr: "sq m"  },
        { unit: "square-feet",       abbr: "sq ft" },
        { unit: "square-yards",      abbr: "sq yd" },
    ];

    // ── Options ──────────────────────────────────────────────────────────────

    private _distUnit: DistanceUnit = "miles";
    private _areaUnit: AreaUnit     = "square-miles";
    private _fontSize: number                  = 12;
    private _fontColor: [number, number, number] = [20, 20, 20];
    private _fontOpacity: number               = 1;
    private _lineColor: [number, number, number] = [0, 255, 0];
    private _lineWidth: number                 = 2;
    private _lineOpacity: number               = 0.5;
    private _showBng: boolean          = true;
    private _showHeight: boolean       = true;
    private _showWidth: boolean        = true;
    private _showArea: boolean         = true;
    private _showTotal: boolean        = true;
    private _showSegment: boolean      = true;
    private _showExtent: boolean       = true;
    private _showLine: boolean         = true;
    private _showLastSegOnly: boolean  = false;
    private _slantRange: boolean       = false;
    private _magneticDeclination: number = 0;
    private _speedKmh: number          = 0;

    // ─────────────────────────────────────────────────────────────────────────

    private constructor() {}

    public static getInstance(): MeasurementEngine {
        if (!MeasurementEngine._instance) {
            MeasurementEngine._instance = new MeasurementEngine();
        }
        return MeasurementEngine._instance;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    get isEnabled(): boolean { return this._isEnabled; }

    /**
     * Attach the engine to a map view.
     * Call this whenever the active view changes.
     */
    public start(view: MapView | SceneView): void {
        this._view = view;
        // spatialReference may be null until the view finishes loading —
        // resolve it now if available, otherwise _resolveGeodesic() is called
        // lazily before the first measurement operation.
        const sr = view.spatialReference;
        this._isGeodesic = sr != null && (sr.wkid === 4326 || sr.wkid === 3857);
        this._layer = this._getOrCreateLayer("measurementGraphicsLayer");
    }

    public enable(): void {
        this._isEnabled = true;
        this._emitStateChange("enabled");
        this._emitHint(
            `Measurements on — draw a polyline or polygon to see live segment lengths` +
            (this._showBng  ? ", bearings" : "") +
            (this._showArea ? ", and area" : "") +
            `. Current unit: ${this._distAbbr(this._distUnit)}.`,
            "idle",
        );
        EngineLogger.success(
            'Measurement Engine',
            `Enabled — draw a symbol to see live segment lengths${this._showBng ? ', bearings' : ''}${this._showArea ? ', and area' : ''}. Unit: ${this._distAbbr(this._distUnit)}`,
        );
        console.info("[MeasurementEngine] enabled — unit:", this._distUnit, "| geodesic:", this._isGeodesic);
    }

    public disable(): void {
        this._isEnabled = false;
        this._layer?.removeAll();
        this._clearHandles();
        this._emitStateChange("disabled");
        this._emitHint("Measurements off. Re-enable to see live segment and area data while drawing.", "idle");
        EngineLogger.nextStep('Measurement Engine', 'Disabled — re-enable to measure drawings');
        console.info("[MeasurementEngine] disabled");
    }

    /** Toggle on/off. Returns new enabled state. */
    public toggle(): boolean {
        this._isEnabled ? this.disable() : this.enable();
        return this._isEnabled;
    }

    public setOptions(options: MeasurementOptions): void {
        if (options.dist_unit       !== undefined) this._distUnit        = options.dist_unit;
        if (options.area_unit       !== undefined) this._areaUnit        = options.area_unit;
        if (options.font_size       !== undefined) this._fontSize        = options.font_size;
        if (options.font_color      !== undefined) this._fontColor       = options.font_color;
        if (options.font_opacity    !== undefined) this._fontOpacity     = options.font_opacity;
        if (options.line_color      !== undefined) this._lineColor       = options.line_color;
        if (options.line_width      !== undefined) this._lineWidth       = options.line_width;
        if (options.line_opacity    !== undefined) this._lineOpacity     = options.line_opacity;
        if (options.show_bng        !== undefined) this._showBng         = options.show_bng;
        if (options.show_height     !== undefined) this._showHeight      = options.show_height;
        if (options.show_width      !== undefined) this._showWidth       = options.show_width;
        if (options.show_area       !== undefined) this._showArea        = options.show_area;
        if (options.show_total      !== undefined) this._showTotal       = options.show_total;
        if (options.show_segment    !== undefined) this._showSegment     = options.show_segment;
        if (options.show_extent     !== undefined) this._showExtent      = options.show_extent;
        if (options.show_line       !== undefined) this._showLine        = options.show_line;
        if (options.show_last_seg_only !== undefined) this._showLastSegOnly = options.show_last_seg_only;
        if (options.slant_range     !== undefined) this._slantRange      = options.slant_range;
        if (options.magnetic_declination !== undefined) this._magneticDeclination = options.magnetic_declination;
        if (options.speed_kmh       !== undefined) this._speedKmh        = options.speed_kmh;

        if (this._showLastSegOnly && !this._showSegment) {
            console.info("[MeasurementEngine] show_last_seg_only requires show_segment — forcing on");
            this._showSegment = true;
        }
    }

    public getOptions(): Required<MeasurementOptions> {
        return {
            dist_unit:        this._distUnit,
            area_unit:        this._areaUnit,
            font_size:        this._fontSize,
            font_color:       this._fontColor,
            font_opacity:     this._fontOpacity,
            line_color:       this._lineColor,
            line_width:       this._lineWidth,
            line_opacity:     this._lineOpacity,
            show_bng:         this._showBng,
            show_height:      this._showHeight,
            show_width:       this._showWidth,
            show_area:        this._showArea,
            show_total:       this._showTotal,
            show_segment:     this._showSegment,
            show_extent:      this._showExtent,
            show_line:        this._showLine,
            show_last_seg_only: this._showLastSegOnly,
            slant_range:      this._slantRange,
            magnetic_declination: this._magneticDeclination,
            speed_kmh:        this._speedKmh,
        };
    }

    /**
     * Called each time a new control point is clicked during drawing.
     * Creates a placeholder graphic for the next segment measurement.
     */
    public addSegment(ctrlPts: Point[]): void {
        if (!this._isEnabled || !this._view || !this._layer) return;
        this._resolveGeodesic();

        if (this._showSegment) {
            if (this._showLastSegOnly) {
                const prev = this._findById("seg-label");
                if (prev) this._layer.remove(prev);
            }

            const placeholder = new Point({ x: 0, y: 0, spatialReference: this._view.spatialReference });
            this._segGraphic = new Graphic({
                geometry: placeholder,
                symbol: this._textSymbol(placeholder, 45, ""),
            });
            (this._segGraphic as any).__meId = "seg-label";
            this._layer.add(this._segGraphic);
        }

        if (ctrlPts.length <= 1) {
            this._addEmptyGraphics();
            this._emitHint(
                "First point placed. Click to add the next point — each segment will show its length" +
                (this._showBng ? " and bearing" : "") + ".",
                "drawing",
            );
            EngineLogger.nextStep(
                'Measurement Engine',
                `First point placed — keep clicking to measure segments${this._showBng ? ' and bearings' : ''}. Double-click to finish`,
            );
        } else {
            this._emitHint("Point added. Keep clicking to extend the line. Double-click to finish.", "segment");
        }
    }

    /**
     * Called on every draw-progress event to update all on-map measurement labels.
     * @param geom Current geometry being drawn.
     * @param ctrlPts Current array of control points.
     * @param isPassive True when called from edit mode (new seg graphic each time).
     */
    public updateSegments(
        geom: __esri.Geometry,
        ctrlPts: Point[],
        isPassive: boolean = false,
    ): void {
        if (!this._isEnabled || !this._view || !this._layer) return;
        this._resolveGeodesic();
        if (geom.type !== "polyline" && geom.type !== "polygon") return;
        if (ctrlPts.length < 2) return;

        if (isPassive) {
            this._updateForEdit(geom, ctrlPts);
        } else {
            this._updateGraphics(geom, ctrlPts, ctrlPts.length - 2, ctrlPts.length - 1, false);
        }
    }

    /**
     * Called during multi-segment editing where segment index matters.
     */
    public updateAllSegments(geom: __esri.Geometry, ctrlPts: Point[], counter: number): void {
        if (!this._isEnabled || !this._view || !this._layer) return;
        if (geom.type !== "polyline" && geom.type !== "polygon") return;
        if (counter < 1) return;
        this._updateGraphics(geom, ctrlPts, counter, counter - 1, false);
    }

    /**
     * Called when drawing is finished or cancelled. Clears all measurement graphics.
     * Optionally re-arms for the first point of the next symbol.
     */
    public wrapUp(firstPts?: Point[]): void {
        this._layer?.removeAll();
        this._clearHandles();
        this._emitUpdate({} as MeasurementSnapshot);
        const continuing = firstPts && firstPts.length > 0;
        this._emitHint(
            continuing
                ? "Symbol complete. Starting the next segment…"
                : "Drawing complete. Start a new symbol to measure again.",
            "complete",
        );
        EngineLogger.success(
            'Measurement Engine',
            continuing ? 'Symbol measured — continuing to next drawing' : 'Drawing complete — measurements recorded',
        );
        if (continuing) {
            this.addSegment(firstPts!);
        }
    }

    /**
     * Measure an existing graphic (bounding-box H/W and total length if polyline).
     * Emits a "measurement-update" event and updates the HUD.
     * Returns the snapshot or null if the geometry is unsupported.
     */
    public measureGraphic(graphic: Graphic): MeasurementSnapshot | null {
        if (!this._view) return null;
        this._resolveGeodesic();
        const geom = graphic.geometry;
        if (!geom || !geom.extent) return null;

        const ext = geom.extent;
        const ll  = this._pt(ext.xmin, ext.ymin, ext);
        const ul  = this._pt(ext.xmin, ext.ymax, ext);
        const lr  = this._pt(ext.xmax, ext.ymin, ext);

        const height = this._segLen(ll, ul);
        const width  = this._segLen(ll, lr);
        const area   = this._area(this._extentToPolygon(ext));

        let total = "";
        if (geom.type === "polyline") {
            total = this._polyLen(geom as Polyline);
        }

        const snap: MeasurementSnapshot = {
            segmentLength: "",
            totalLength:   total,
            area,
            bearing:       "",
            height,
            width,
            unit:          this._distUnit,
            areaUnit:      this._areaUnit,
        };

        this._emitUpdate(snap);
        return snap;
    }

    /**
     * Reattach to a new view after a 2D↔3D switch.
     */
    public onViewChanged(view: MapView | SceneView): void {
        this.wrapUp();
        this.start(view);
    }

    public destroy(): void {
        if (this._view && this._layer) {
            (this._view.map as any).remove(this._layer);
        }
        this._layer = null;
        this._view  = null;
    }

    /**
     * Returns a snapshot of the engine's current operational state.
     * Useful for status indicators and debugging.
     */
    public getStatus(): {
        isEnabled: boolean;
        unit: DistanceUnit;
        areaUnit: AreaUnit;
        isGeodesic: boolean;
        activeGraphics: number;
    } {
        return {
            isEnabled: this._isEnabled,
            unit: this._distUnit,
            areaUnit: this._areaUnit,
            isGeodesic: this._isGeodesic,
            activeGraphics: this._layer?.graphics.length ?? 0,
        };
    }

    // ── Internal: graphics update ─────────────────────────────────────────────

    /** Core update — shared by draw-progress and all-segment editing. */
    private _updateGraphics(
        geom: __esri.Geometry,
        ctrlPts: Point[],
        iFirst: number,
        iLast: number,
        newSeg: boolean,
    ): void {
        if (!this._view || !this._layer) return;

        const firstPt = ctrlPts[iFirst];
        const lastPt  = ctrlPts[iLast];
        const angle   = this._angle(firstPt, lastPt);
        const ext     = geom.extent;
        if (!ext) return;

        const snap: Partial<MeasurementSnapshot> = {};

        // ── Segment label ──────────────────────────────────────────────────
        if (this._showSegment) {
            const mid    = this._mid(firstPt, lastPt);
            const segLen = this._segLen(firstPt, lastPt);
            const bVals  = this._bearingValues(firstPt, lastPt);
            const bng    = this._showBng ? " " + bVals.label : "";
            const label  = segLen + bng;
            snap.segmentLength = segLen;
            snap.bearing       = bng.trim();
            snap.trueAzimuth   = bVals.trueAzimuth;
            snap.magneticAzimuth = bVals.magneticAzimuth;
            snap.gridAzimuth   = bVals.gridAzimuth;

            if (newSeg) {
                // Edit mode: create a fresh graphic each time
                const prev = this._findById("seg-label");
                if (prev) this._layer.remove(prev);
                const sg = new Graphic({ geometry: mid, symbol: this._textSymbol(mid, angle, label) });
                (sg as any).__meId = "seg-label";
                this._layer.add(sg);
            } else if (this._segGraphic) {
                this._segGraphic.symbol   = this._textSymbol(mid, angle, label);
                this._segGraphic.geometry = mid;
            }
        }

        // ── Measurement line ───────────────────────────────────────────────
        if (this._showLine && this._lineGraphic) {
            const pl = new Polyline({ spatialReference: this._view.spatialReference });
            pl.addPath(ctrlPts.map(p => [p.x, p.y]));
            this._lineGraphic.geometry = pl;
        }

        // ── Bounding-box extent ────────────────────────────────────────────
        if (this._showExtent && this._extentGraphic) {
            this._extentGraphic.geometry = ext.clone();
        }

        // ── Height label ───────────────────────────────────────────────────
        if (this._showHeight && this._hGraphic) {
            const ll   = this._pt(ext.xmin, ext.ymin, ext);
            const ul   = this._pt(ext.xmin, ext.ymax, ext);
            const midH = this._mid(ll, ul);
            const hLen = this._segLen(ll, ul);
            snap.height = hLen;
            this._hGraphic.symbol   = this._textSymbol(midH, this._angle(ll, ul), hLen);
            this._hGraphic.geometry = midH;
        }

        // ── Width label ────────────────────────────────────────────────────
        if (this._showWidth && this._wGraphic) {
            const ul   = this._pt(ext.xmin, ext.ymax, ext);
            const ur   = this._pt(ext.xmax, ext.ymax, ext);
            const ll   = this._pt(ext.xmin, ext.ymin, ext);
            const lr   = this._pt(ext.xmax, ext.ymin, ext);
            const midW = this._mid(ul, ur);
            const wLen = this._segLen(ll, lr);
            snap.width = wLen;
            this._wGraphic.symbol   = this._textSymbol(midW, this._angle(ul, ur), wLen);
            this._wGraphic.geometry = midW;
        }

        // ── Area label ─────────────────────────────────────────────────────
        if (this._showArea && this._aGraphic) {
            const center = this._pt((ext.xmin + ext.xmax) / 2, (ext.ymin + ext.ymax) / 2, ext);
            const aStr   = this._area(this._extentToPolygon(ext));
            snap.area = aStr;
            this._aGraphic.symbol   = this._textSymbol(center, 0, aStr);
            this._aGraphic.geometry = center;
        }

        // ── Total-length label ─────────────────────────────────────────────
        if (this._showTotal && this._tGraphic) {
            const endPt  = ctrlPts[ctrlPts.length - 1];
            const pl     = new Polyline({ spatialReference: endPt.spatialReference });
            pl.addPath(ctrlPts.map(p => [p.x, p.y]));
            const totLen = this._polyLen(pl);
            snap.totalLength = totLen;
            const tSym = this._textSymbol(endPt, 0, totLen);
            tSym.xoffset = 80; tSym.yoffset = 30;
            this._tGraphic.symbol   = tSym;
            this._tGraphic.geometry = endPt;
        }

        this._emitUpdate(snap as MeasurementSnapshot);
    }

    /** Edit mode variant — always creates a fresh segment graphic. */
    private _updateForEdit(geom: __esri.Geometry, ctrlPts: Point[]): void {
        this._updateGraphics(geom, ctrlPts, ctrlPts.length - 2, ctrlPts.length - 1, true);
    }

    /** Create empty placeholder graphics on first control point. */
    private _addEmptyGraphics(): void {
        if (!this._view || !this._layer) return;

        const lc = new Color([...this._lineColor, this._lineOpacity]);
        const ls = new SimpleLineSymbol({ style: "solid", color: lc, width: this._lineWidth });
        const placeholder = new Point({ x: 0, y: 0, spatialReference: this._view.spatialReference });

        if (this._showLine) {
            const pl = new Polyline({ spatialReference: this._view.spatialReference });
            pl.addPath([[0, 0], [0, 0]]);
            this._lineGraphic = new Graphic({ geometry: pl, symbol: ls });
            this._layer.add(this._lineGraphic);
        }

        if (this._showExtent) {
            this._extentGraphic = new Graphic({ geometry: this._view.extent.clone(), symbol: ls });
            this._layer.add(this._extentGraphic);
        }

        if (this._showHeight) {
            this._hGraphic = new Graphic({ geometry: placeholder.clone(), symbol: this._textSymbol(placeholder, 45, "") });
            this._layer.add(this._hGraphic);
        }

        if (this._showWidth) {
            this._wGraphic = new Graphic({ geometry: placeholder.clone(), symbol: this._textSymbol(placeholder, 45, "") });
            this._layer.add(this._wGraphic);
        }

        if (this._showArea) {
            this._aGraphic = new Graphic({ geometry: placeholder.clone(), symbol: this._textSymbol(placeholder, 0, "") });
            this._layer.add(this._aGraphic);
        }

        if (this._showTotal) {
            this._tGraphic = new Graphic({ geometry: placeholder.clone(), symbol: this._textSymbol(placeholder, 0, "") });
            this._layer.add(this._tGraphic);
        }
    }

    private _clearHandles(): void {
        this._segGraphic    = null;
        this._lineGraphic   = null;
        this._extentGraphic = null;
        this._hGraphic      = null;
        this._wGraphic      = null;
        this._aGraphic      = null;
        this._tGraphic      = null;
    }

    // ── Geometry helpers ──────────────────────────────────────────────────────

    private _pt(x: number, y: number, ref: { spatialReference: __esri.SpatialReference }): Point {
        return new Point({ x, y, spatialReference: ref.spatialReference });
    }

    private _mid(a: Point, b: Point): Point {
        return new Point({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spatialReference: a.spatialReference });
    }

    private _angle(a: Point, b: Point): number {
        return Math.atan((b.y - a.y) / (b.x - a.x)) * 180 / Math.PI * -1;
    }

    private _metersToUnit(meters: number, unit: DistanceUnit): number {
        switch (unit) {
            case "feet": return meters * 3.28084;
            case "miles": return meters * 0.000621371;
            case "kilometers": return meters / 1000;
            case "nautical-miles": return meters * 0.000539957;
            case "yards": return meters * 1.09361;
            case "meters":
            default: return meters;
        }
    }

    private _segLenVal(pt1: Point, pt2: Point): number {
        const pl = new Polyline({ spatialReference: pt1.spatialReference });
        pl.addPath([[pt1.x, pt1.y], [pt2.x, pt2.y]]);
        let len2D = this._isGeodesic
            ? geometryEngine.geodesicLength(pl, this._distUnit as any)
            : geometryEngine.planarLength(pl, this._distUnit as any);
        
        len2D = Math.abs(len2D);

        if (this._slantRange && pt1.z !== undefined && pt2.z !== undefined) {
            const dzMeters = pt2.z - pt1.z;
            const dzUnit = this._metersToUnit(dzMeters, this._distUnit);
            return Math.sqrt(len2D * len2D + dzUnit * dzUnit);
        }
        return len2D;
    }

    private _segLen(pt1: Point, pt2: Point): string {
        const raw = this._segLenVal(pt1, pt2);
        return `${raw.toFixed(1)} ${this._distAbbr(this._distUnit)}`;
    }

    private _polyLenVal(pl: Polyline): number {
        if (!this._slantRange || !pl.hasZ) {
            const len2D = this._isGeodesic
                ? geometryEngine.geodesicLength(pl, this._distUnit as any)
                : geometryEngine.planarLength(pl, this._distUnit as any);
            return Math.abs(len2D);
        }

        // Slant range for polyline: sum of slant range for all segments
        let total = 0;
        pl.paths.forEach(path => {
            for (let i = 0; i < path.length - 1; i++) {
                const p1 = pl.getPoint(0, i);
                const p2 = pl.getPoint(0, i + 1);
                total += this._segLenVal(p1, p2);
            }
        });
        return total;
    }

    private _polyLen(pl: Polyline): string {
        const raw = this._polyLenVal(pl);
        let res = `${raw.toFixed(1)} ${this._distAbbr(this._distUnit)}`;
        
        // March-time estimator
        if (this._speedKmh > 0) {
            const distKm = this._distUnit === "kilometers" ? raw : 
                           this._metersToUnit(raw / this._metersToUnit(1, this._distUnit), "kilometers");
            const hours = distKm / this._speedKmh;
            const h = Math.floor(hours);
            const m = Math.round((hours - h) * 60);
            res += ` · ${h}h ${m}m @ ${this._speedKmh} km/h`;
        }
        return res;
    }

    private _area(poly: Polygon): string {
        const raw = this._isGeodesic
            ? geometryEngine.geodesicArea(poly, this._areaUnit as any)
            : geometryEngine.planarArea(poly, this._areaUnit as any);
        return `${Math.abs(raw).toFixed(1)} ${this._areaAbbr(this._areaUnit)}`;
    }

    private _extentToPolygon(ext: Extent): Polygon {
        return new Polygon({
            rings: [[
                [ext.xmin, ext.ymin],
                [ext.xmin, ext.ymax],
                [ext.xmax, ext.ymax],
                [ext.xmax, ext.ymin],
                [ext.xmin, ext.ymin],
            ]],
            spatialReference: ext.spatialReference,
        });
    }

    private _bearingValues(a: Point, b: Point): { trueAzimuth: number, magneticAzimuth: number, gridAzimuth: number, label: string } {
        const rise = b.y - a.y;
        const run  = b.x - a.x;
        
        let gridAzimuth = 0;
        if (rise === 0 && run === 0) {
            gridAzimuth = 0;
        } else {
            // Angle from North clockwise
            gridAzimuth = Math.atan2(run, rise) * (180 / Math.PI);
            if (gridAzimuth < 0) gridAzimuth += 360;
        }

        // For simplicity in this engine, we'll treat grid azimuth as true azimuth.
        // In a strict geodetic sense, convergence angle is needed for true azimuth.
        const trueAzimuth = gridAzimuth;
        
        let magneticAzimuth = trueAzimuth - this._magneticDeclination;
        if (magneticAzimuth < 0) magneticAzimuth += 360;
        if (magneticAzimuth >= 360) magneticAzimuth -= 360;

        // Create label from magnetic azimuth
        const ns = (magneticAzimuth > 270 || magneticAzimuth < 90) ? "N" : "S";
        const ew = (magneticAzimuth > 0 && magneticAzimuth < 180) ? "E" : (magneticAzimuth > 180 && magneticAzimuth < 360) ? "W" : "";
        
        let degFromPole = magneticAzimuth;
        if (magneticAzimuth > 90 && magneticAzimuth <= 180) degFromPole = 180 - magneticAzimuth;
        else if (magneticAzimuth > 180 && magneticAzimuth <= 270) degFromPole = magneticAzimuth - 180;
        else if (magneticAzimuth > 270) degFromPole = 360 - magneticAzimuth;
        
        const d = Math.floor(degFromPole);
        const t = (degFromPole - d) * 60;
        const m = Math.floor(t);
        const s = Math.floor(60 * (t - m));
        const label = `${ns}${d}°${m}'${s}"${ew}`;

        return { trueAzimuth, magneticAzimuth, gridAzimuth, label };
    }

    private _bearing(a: Point, b: Point): string {
        return this._bearingValues(a, b).label;
    }

    private _textSymbol(pt: Point, angle: number, label: string): TextSymbol {
        const font = new Font({ size: this._fontSize, style: "italic", weight: "bold", family: "Helvetica" });
        const color = new Color([...this._fontColor, this._fontOpacity]);

        let xOff = 5, yOff = 10;
        if      (angle >  45)              { xOff = 10; yOff = 5;  }
        else if (angle > -45 && angle < 0) { xOff = 5;  yOff = 13; }
        else if (angle <= -45)             { xOff = -10; yOff = 5;  }

        return new TextSymbol({
            text: label, font, color,
            haloColor: new Color([255, 255, 255, 0.95]),
            haloSize: 2,
            xoffset: xOff, yoffset: yOff, angle,
        });
    }

    private _distAbbr(u: DistanceUnit): string {
        return this.distanceUnits.find(x => x.unit === u)?.abbr ?? u;
    }

    private _areaAbbr(u: AreaUnit): string {
        return this.areaUnits.find(x => x.unit === u)?.abbr ?? u;
    }

    private _findById(id: string): Graphic | undefined {
        return this._layer?.graphics.find((g: Graphic) => (g as any).__meId === id) as Graphic | undefined;
    }

    /** Resolve geodesic mode from the view's spatial reference (lazy, idempotent). */
    private _resolveGeodesic(): void {
        const sr = this._view?.spatialReference;
        if (sr != null) {
            this._isGeodesic = sr.wkid === 4326 || sr.wkid === 3857;
        }
    }

    private _getOrCreateLayer(id: string): GraphicsLayer {
        if (!this._view) throw new Error("[MeasurementEngine] start() must be called before use");
        let layer = this._view.map.findLayerById(id) as GraphicsLayer | undefined;
        if (!layer) {
            layer = new GraphicsLayer({ id });
            this._view.map.add(layer);
        }
        return layer;
    }

    // ── Event helpers ─────────────────────────────────────────────────────────

    private _emitUpdate(snap: Partial<MeasurementSnapshot>): void {
        document.dispatchEvent(new CustomEvent("measurement-update", {
            detail: { ...snap, unit: this._distUnit, areaUnit: this._areaUnit },
            bubbles: true,
        }));
    }

    private _emitStateChange(state: "enabled" | "disabled"): void {
        document.dispatchEvent(new CustomEvent("measurement-state-change", {
            detail: { state, isEnabled: this._isEnabled },
            bubbles: true,
        }));
    }

    private _emitHint(message: string, phase: "idle" | "drawing" | "segment" | "complete"): void {
        document.dispatchEvent(new CustomEvent("measurement-hint", {
            detail: { message, phase },
            bubbles: true,
        }));
    }
}

export default MeasurementEngine;
