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
import RoadNetworkEngine from "./Analysis/RoadNetworkEngine";
import type SpatialReference from "@arcgis/core/geometry/SpatialReference";
import type Geometry from "@arcgis/core/geometry/Geometry";

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
    /** Bearing display format. "decimal" → 045°, "mils" → 800 mil, "quadrant" → N45°E */
    bearing_format?: BearingFormat;
    /** Auto-pick a readable display unit per value (m↔km, ft↔mi, yd↔mi) */
    auto_unit?: boolean;
    /** Keep measurement labels on the map after a drawing is finished */
    preserve_labels_on_complete?: boolean;
    /** Augment a measured polyline with road-following distance/ETA/trafficability (optional service). */
    road_eta?: boolean;
}

export type BearingFormat = "decimal" | "mils" | "quadrant";

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
    /** Road-following distance/ETA/trafficability, when the road-network service is available. */
    roadInfo?: string;
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
    private _planarWarned: boolean = false;

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
    private _fontSize: number                  = 13;
    private _fontColor: [number, number, number] = [255, 255, 255];
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
    private _roadEta: boolean          = false;
    private _bearingFormat: BearingFormat = "decimal";
    private _autoUnit: boolean         = false;
    private _preserveOnComplete: boolean = false;

    // Cached style objects — rebuilt only when font options change, not per label.
    private _font: Font | null = null;
    private _fontColorObj: Color | null = null;
    private readonly _haloColor = new Color([0, 0, 0, 1]);

    // Reusable polyline for length math (never assigned to a graphic).
    private readonly _scratchLine = new Polyline();

    // requestAnimationFrame coalescing for draw-progress updates.
    private _rafId: number | null = null;
    private _pendingUpdate: (() => void) | null = null;

    // Most recent emitted snapshot — backs getFormattedSnapshot()/clipboard copy.
    private _lastSnapshot: Partial<MeasurementSnapshot> | null = null;

    // ─────────────────────────────────────────────────────────────────────────

    private constructor() {
        this._rebuildStyle();
    }

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
        if (options.road_eta        !== undefined) this._roadEta         = options.road_eta;
        if (options.bearing_format  !== undefined) this._bearingFormat   = options.bearing_format;
        if (options.auto_unit       !== undefined) this._autoUnit        = options.auto_unit;
        if (options.preserve_labels_on_complete !== undefined) this._preserveOnComplete = options.preserve_labels_on_complete;

        if (this._showLastSegOnly && !this._showSegment) {
            console.info("[MeasurementEngine] show_last_seg_only requires show_segment — forcing on");
            this._showSegment = true;
        }

        if (options.font_size !== undefined || options.font_color !== undefined || options.font_opacity !== undefined) {
            this._rebuildStyle();
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
            road_eta:         this._roadEta,
            bearing_format:   this._bearingFormat,
            auto_unit:        this._autoUnit,
            preserve_labels_on_complete: this._preserveOnComplete,
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
            if (this._showLastSegOnly && this._segGraphic) {
                this._layer.remove(this._segGraphic);
            }

            const placeholder = new Point({ x: 0, y: 0, spatialReference: this._view.spatialReference });
            this._segGraphic = new Graphic({
                geometry: placeholder,
                symbol: this._textSymbol(placeholder, 45, ""),
            });
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
            // Running summary instead of repeating the same "keep clicking" line.
            const segCount = ctrlPts.length - 1;
            const pl = new Polyline({ spatialReference: ctrlPts[0].spatialReference });
            pl.addPath(ctrlPts.map(p => [p.x, p.y]));
            this._emitHint(
                `${segCount} segment${segCount !== 1 ? "s" : ""} — total ${this._polyLen(pl)}. Double-click to finish.`,
                "segment",
            );
        }
    }

    /**
     * Called on every draw-progress event to update all on-map measurement labels.
     * @param geom Current geometry being drawn.
     * @param ctrlPts Current array of control points.
     * @param isPassive True when called from edit mode (new seg graphic each time).
     */
    public updateSegments(
        geom: Geometry,
        ctrlPts: Point[],
        isPassive: boolean = false,
    ): void {
        if (!this._isEnabled || !this._view || !this._layer) return;
        this._resolveGeodesic();
        if (geom.type !== "polyline" && geom.type !== "polygon") return;
        if (ctrlPts.length < 2) return;

        // Draw-progress fires per mousemove; coalesce to one update per frame.
        this._schedule(() => {
            if (!this._isEnabled || !this._view || !this._layer) return;
            if (isPassive) {
                this._updateForEdit(geom, ctrlPts);
            } else {
                this._updateGraphics(geom, ctrlPts, ctrlPts.length - 2, ctrlPts.length - 1, false);
            }
        });
    }

    /** Coalesce rapid draw-progress updates into one rAF-aligned pass (trailing). */
    private _schedule(fn: () => void): void {
        this._pendingUpdate = fn;
        if (this._rafId != null) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            const job = this._pendingUpdate;
            this._pendingUpdate = null;
            job?.();
        });
    }

    private _cancelScheduled(): void {
        if (this._rafId != null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._pendingUpdate = null;
    }

    /**
     * Called during multi-segment editing where segment index matters.
     */
    public updateAllSegments(geom: Geometry, ctrlPts: Point[], counter: number): void {
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
        this._cancelScheduled();
        const continuing = firstPts && firstPts.length > 0;

        // Preserve finished labels for briefings/screenshots only when the
        // drawing is truly done (not when re-arming for the next segment).
        if (this._preserveOnComplete && !continuing) {
            this._clearHandles();
            this._emitUpdate({} as MeasurementSnapshot);
            this._emitHint("Drawing complete — labels kept. Start a new symbol to measure again.", "complete");
            EngineLogger.success('Measurement Engine', 'Drawing complete — labels preserved');
            return;
        }

        this._layer?.removeAll();
        this._clearHandles();
        this._emitUpdate({} as MeasurementSnapshot);
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
        // Use the actual polygon rings for area (not the bounding box, which
        // overstates diagonal/thin/rotated shapes); polylines/points have no area.
        const area   = geom.type === "polygon" ? this._area(geom as Polygon) : "";

        let total = "";
        if (geom.type === "polyline") {
            total = this._polyLen(geom as Polyline);
        } else if (geom.type === "polygon") {
            total = this._polyLen(this._polygonToPolyline(geom as Polygon));
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
        // Optional road-following enrichment — async, never blocks the measurement.
        if (this._roadEta && geom.type === "polyline") {
            void this._enrichWithRoadEta(geom as Polyline, snap);
        }
        return snap;
    }

    /** Lazily reach the optional road-network adapter (may be absent). */
    private _roadNet(): any {
        return (window as any).symbolEngine?.roadNetworkEngine ?? null;
    }

    /**
     * Asynchronously augment a measured polyline with road-following distance,
     * drive time and trafficability, then re-emit the snapshot. Endpoints-only
     * (shortest road path A→B) to bound API calls. Fully degradable: a missing
     * or failed service simply leaves the straight-line measurement untouched.
     */
    private async _enrichWithRoadEta(
        pl: Polyline,
        baseSnap: Partial<MeasurementSnapshot>,
    ): Promise<void> {
        const rn = this._roadNet();
        if (!rn || !pl.paths?.length) return;
        const lastPath = pl.paths[pl.paths.length - 1];
        if (!lastPath?.length) return;
        const a = pl.getPoint(0, 0);
        const b = pl.getPoint(pl.paths.length - 1, lastPath.length - 1);
        if (!a || !b) return;

        let res: any = null;
        try {
            res = await rn.route(a, b);
        } catch {
            return;
        }
        if (!res?.ok || !res.data) return;

        const d = res.data;
        const km = (d.distanceKm ?? 0).toFixed(1);
        const min = Math.round(d.travelTimeMin ?? 0);
        let info = `${km} km · ${min} min by road`;
        const t = d.trafficability;
        if (t) {
            const lim = RoadNetworkEngine.classifyClass(t.limitingClass);
            info += ` · ${t.rating} (ltd: ${lim.label})`;
        }
        // Re-emit the original measurement plus the road enrichment.
        this._emitUpdate({ ...baseSnap, roadInfo: info });
    }

    /**
     * Reattach to a new view after a 2D↔3D switch.
     */
    public onViewChanged(view: MapView | SceneView): void {
        this.wrapUp();
        // Detach the layer from the previous view's map, or it leaks across
        // every 2D↔3D switch.
        if (this._view && this._layer) {
            this._view.map?.remove(this._layer);
        }
        this._layer = null;
        this.start(view);
    }

    public destroy(): void {
        this._cancelScheduled();
        this._layer?.removeAll();
        this._clearHandles();
        if (this._view && this._layer) {
            this._view.map?.remove(this._layer);
        }
        this._isEnabled = false;
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

    /**
     * A clean multi-line string of the most recent measurement, suitable for
     * the "Copy" button or clipboard. Returns "" if nothing has been measured.
     */
    public getFormattedSnapshot(): string {
        const s = this._lastSnapshot;
        if (!s) return "";
        const lines: string[] = [];
        if (s.segmentLength) lines.push(`Segment: ${s.segmentLength}`);
        if (s.bearing)       lines.push(`Bearing: ${s.bearing}`);
        if (s.totalLength)   lines.push(`Total:   ${s.totalLength}`);
        if (s.height)        lines.push(`Height:  ${s.height}`);
        if (s.width)         lines.push(`Width:   ${s.width}`);
        if (s.area)          lines.push(`Area:    ${s.area}`);
        return lines.join("\n");
    }

    // ── Internal: graphics update ─────────────────────────────────────────────

    /** Core update — shared by draw-progress and all-segment editing. */
    private _updateGraphics(
        geom: Geometry,
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
                if (this._segGraphic) this._layer.remove(this._segGraphic);
                this._segGraphic = new Graphic({ geometry: mid, symbol: this._textSymbol(mid, angle, label) });
                this._layer.add(this._segGraphic);
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
    private _updateForEdit(geom: Geometry, ctrlPts: Point[]): void {
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

    private _pt(x: number, y: number, ref: { spatialReference: SpatialReference }): Point {
        return new Point({ x, y, spatialReference: ref.spatialReference });
    }

    private _mid(a: Point, b: Point): Point {
        return new Point({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spatialReference: a.spatialReference });
    }

    private _angle(a: Point, b: Point): number {
        // atan2 handles vertical segments (b.x === a.x) and full quadrant range;
        // plain atan returns NaN/±90° ambiguity there.
        return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI * -1;
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

    /** Pick a readable display unit for a length given in meters. */
    private _resolveDisplayUnit(meters: number): DistanceUnit {
        if (!this._autoUnit) return this._distUnit;
        const m = Math.abs(meters);
        switch (this._distUnit) {
            case "feet":
            case "miles":
                return m >= 1609.34 ? "miles" : "feet";
            case "yards":
                return m >= 1609.34 ? "miles" : "yards";
            case "nautical-miles":
                return "nautical-miles";
            case "meters":
            case "kilometers":
            default:
                return m >= 1000 ? "kilometers" : "meters";
        }
    }

    /** Format a length (in meters) into a display string with smart precision. */
    private _formatDist(meters: number): string {
        const unit = this._resolveDisplayUnit(meters);
        const v = this._metersToUnit(meters, unit);
        let str: string;
        if (unit === "meters" || unit === "feet" || unit === "yards") {
            str = v.toFixed(0);                       // whole units for small measures
        } else {
            str = Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
        }
        return `${str} ${this._distAbbr(unit)}`;
    }

    /** Straight-line length between two points, in meters (slant-adjusted if enabled). */
    private _segMeters(pt1: Point, pt2: Point): number {
        this._scratchLine.spatialReference = pt1.spatialReference;
        this._scratchLine.paths = [[[pt1.x, pt1.y], [pt2.x, pt2.y]]];
        let m = Math.abs(this._isGeodesic
            ? geometryEngine.geodesicLength(this._scratchLine, "meters")
            : geometryEngine.planarLength(this._scratchLine, "meters"));

        if (this._slantRange && (pt1.z !== undefined || pt2.z !== undefined)) {
            const z1 = pt1.z !== undefined ? pt1.z : 0;   // treat missing z as 0
            const z2 = pt2.z !== undefined ? pt2.z : 0;
            const dz = z2 - z1;                   // z is already in meters
            return Math.sqrt(m * m + dz * dz);
        }
        return m;
    }

    private _segLen(pt1: Point, pt2: Point): string {
        return this._formatDist(this._segMeters(pt1, pt2));
    }

    private _polyMeters(pl: Polyline): number {
        if (!this._slantRange || !pl.hasZ) {
            return Math.abs(this._isGeodesic
                ? geometryEngine.geodesicLength(pl, "meters")
                : geometryEngine.planarLength(pl, "meters"));
        }

        // Slant range: sum per-segment slant length across every path.
        let total = 0;
        for (let p = 0; p < pl.paths.length; p++) {
            const path = pl.paths[p];
            for (let i = 0; i < path.length - 1; i++) {
                total += this._segMeters(pl.getPoint(p, i)!, pl.getPoint(p, i + 1)!);
            }
        }
        return total;
    }

    private _polyLen(pl: Polyline): string {
        const meters = this._polyMeters(pl);
        let res = this._formatDist(meters);

        // March-time estimator
        if (this._speedKmh > 0) {
            const distKm = meters / 1000;
            const hours = distKm / this._speedKmh;
            const h = Math.floor(hours);
            const m = Math.round((hours - h) * 60);
            res += ` · ${h}h ${m}m @ ${this._speedKmh} km/h`;
        }
        return res;
    }

    private _area(poly: Polygon): string {
        const raw = Math.abs(this._isGeodesic
            ? geometryEngine.geodesicArea(poly, this._areaUnit as any)
            : geometryEngine.planarArea(poly, this._areaUnit as any));
        const str = this._areaUnit === "square-meters" || this._areaUnit === "square-feet"
            ? raw.toFixed(0)
            : raw < 10 ? raw.toFixed(2) : raw.toFixed(1);
        return `${str} ${this._areaAbbr(this._areaUnit)}`;
    }

    private _polygonToPolyline(poly: Polygon): Polyline {
        return new Polyline({ paths: poly.rings, spatialReference: poly.spatialReference });
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

        // Without a projection convergence angle we can't separate grid from true
        // azimuth, so grid is the best honest estimate of true north here.
        const trueAzimuth = gridAzimuth;

        let magneticAzimuth = trueAzimuth - this._magneticDeclination;
        if (magneticAzimuth < 0) magneticAzimuth += 360;
        if (magneticAzimuth >= 360) magneticAzimuth -= 360;

        const label = this._bearingLabel(trueAzimuth, magneticAzimuth);
        return { trueAzimuth, magneticAzimuth, gridAzimuth, label };
    }

    /**
     * Build a compact bearing label. Uses magnetic azimuth (suffix "M") when a
     * declination is set, otherwise true azimuth (suffix "T") — so the label is
     * never silently mislabelled as one when it's the other.
     */
    private _bearingLabel(trueAz: number, magAz: number): string {
        const hasDecl = this._magneticDeclination !== 0;
        const az = hasDecl ? magAz : trueAz;
        const suffix = hasDecl ? "M" : "T";

        switch (this._bearingFormat) {
            case "mils": {
                const mils = Math.round(az / 360 * 6400) % 6400;
                return `${mils} mil ${suffix}`;
            }
            case "quadrant": {
                // Quadrant bearing: measured from the nearer N/S pole toward E/W.
                // Boundaries (0/90/180/270/360) are cardinals — inclusive so due
                // East (90) reads N90°E rather than the nonsensical S90°E.
                const ns = (az <= 90 || az >= 270) ? "N" : "S";
                const ew = (az === 0 || az === 180 || az === 360) ? "" : (az < 180 ? "E" : "W");
                let degFromPole = az;
                if (az > 90 && az <= 180) degFromPole = 180 - az;
                else if (az > 180 && az <= 270) degFromPole = az - 180;
                else if (az > 270) degFromPole = 360 - az;
                const d = Math.floor(degFromPole);
                const t = (degFromPole - d) * 60;
                const m = Math.floor(t);
                const s = Math.floor(60 * (t - m));
                return `${ns}${d}°${m}'${s}"${ew}`;
            }
            case "decimal":
            default:
                return `${(Math.round(az) % 360).toString().padStart(3, "0")}°${suffix}`;
        }
    }

    /** Rebuild cached Font/Color — called on construction and when font opts change. */
    private _rebuildStyle(): void {
        this._font = new Font({ size: this._fontSize, style: "italic", weight: "bold", family: "Helvetica" });
        this._fontColorObj = new Color([...this._fontColor, this._fontOpacity]);
    }

    private _textSymbol(_anchor: Point, angle: number, label: string): TextSymbol {
        let xOff = 6, yOff = 6;
        if      (angle >  45)              { xOff = 10; yOff = 4;  }
        else if (angle > -45 && angle < 0) { xOff = 6;  yOff = 12; }
        else if (angle <= -45)             { xOff = -10; yOff = 4; }

        // Font/Color are shared value objects — cheaper than allocating per label
        // on every draw-progress frame.
        return new TextSymbol({
            text: label,
            font: this._font!,
            color: this._fontColorObj!,
            haloColor: this._haloColor,
            haloSize: 3,
            xoffset: xOff, yoffset: yOff,
        });
    }

    private _distAbbr(u: DistanceUnit): string {
        return this.distanceUnits.find(x => x.unit === u)?.abbr ?? u;
    }

    private _areaAbbr(u: AreaUnit): string {
        return this.areaUnits.find(x => x.unit === u)?.abbr ?? u;
    }

    /**
     * Resolve geodesic mode from the view's spatial reference (lazy, idempotent).
     * Only WGS84 (4326) and Web Mercator (3857) support the geodesic operators;
     * any other projected SR falls back to planar, which is inaccurate over long
     * distances — warn once so it isn't a silent surprise.
     */
    private _resolveGeodesic(): void {
        const sr = this._view?.spatialReference;
        if (sr == null) return;
        const supportsGeodesic = sr.wkid === 4326 || sr.wkid === 3857;
        if (!supportsGeodesic && !this._planarWarned) {
            this._planarWarned = true;
            console.warn(
                `[MeasurementEngine] SR ${sr.wkid} uses planar measurement — ` +
                `distances/areas may be inaccurate over long ranges.`,
            );
        }
        this._isGeodesic = supportsGeodesic;
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
        this._lastSnapshot = { ...snap, unit: this._distUnit, areaUnit: this._areaUnit };
        document.dispatchEvent(new CustomEvent("measurement-update", {
            detail: this._lastSnapshot,
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
