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
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
export type DistanceUnit = "feet" | "miles" | "kilometers" | "nautical-miles" | "meters" | "yards";
export type AreaUnit = "square-miles" | "acres" | "square-kilometers" | "hectares" | "square-meters" | "square-feet" | "square-yards";
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
declare class MeasurementEngine {
    private static _instance;
    private _isEnabled;
    private _view;
    private _isGeodesic;
    private _planarWarned;
    private _layer;
    private _segGraphic;
    private _lineGraphic;
    private _extentGraphic;
    private _hGraphic;
    private _wGraphic;
    private _aGraphic;
    private _tGraphic;
    readonly distanceUnits: Array<{
        unit: DistanceUnit;
        abbr: string;
    }>;
    readonly areaUnits: Array<{
        unit: AreaUnit;
        abbr: string;
    }>;
    private _distUnit;
    private _areaUnit;
    private _fontSize;
    private _fontColor;
    private _fontOpacity;
    private _lineColor;
    private _lineWidth;
    private _lineOpacity;
    private _showBng;
    private _showHeight;
    private _showWidth;
    private _showArea;
    private _showTotal;
    private _showSegment;
    private _showExtent;
    private _showLine;
    private _showLastSegOnly;
    private _slantRange;
    private _magneticDeclination;
    private _speedKmh;
    private _roadEta;
    private _bearingFormat;
    private _autoUnit;
    private _preserveOnComplete;
    private _font;
    private _fontColorObj;
    private readonly _haloColor;
    private readonly _scratchLine;
    private _rafId;
    private _pendingUpdate;
    private _lastSnapshot;
    private constructor();
    static getInstance(): MeasurementEngine;
    get isEnabled(): boolean;
    /**
     * Attach the engine to a map view.
     * Call this whenever the active view changes.
     */
    start(view: MapView | SceneView): void;
    enable(): void;
    disable(): void;
    /** Toggle on/off. Returns new enabled state. */
    toggle(): boolean;
    setOptions(options: MeasurementOptions): void;
    getOptions(): Required<MeasurementOptions>;
    /**
     * Called each time a new control point is clicked during drawing.
     * Creates a placeholder graphic for the next segment measurement.
     */
    addSegment(ctrlPts: Point[]): void;
    /**
     * Called on every draw-progress event to update all on-map measurement labels.
     * @param geom Current geometry being drawn.
     * @param ctrlPts Current array of control points.
     * @param isPassive True when called from edit mode (new seg graphic each time).
     */
    updateSegments(geom: __esri.Geometry, ctrlPts: Point[], isPassive?: boolean): void;
    /** Coalesce rapid draw-progress updates into one rAF-aligned pass (trailing). */
    private _schedule;
    private _cancelScheduled;
    /**
     * Called during multi-segment editing where segment index matters.
     */
    updateAllSegments(geom: __esri.Geometry, ctrlPts: Point[], counter: number): void;
    /**
     * Called when drawing is finished or cancelled. Clears all measurement graphics.
     * Optionally re-arms for the first point of the next symbol.
     */
    wrapUp(firstPts?: Point[]): void;
    /**
     * Measure an existing graphic (bounding-box H/W and total length if polyline).
     * Emits a "measurement-update" event and updates the HUD.
     * Returns the snapshot or null if the geometry is unsupported.
     */
    measureGraphic(graphic: Graphic): MeasurementSnapshot | null;
    /** Lazily reach the optional road-network adapter (may be absent). */
    private _roadNet;
    /**
     * Asynchronously augment a measured polyline with road-following distance,
     * drive time and trafficability, then re-emit the snapshot. Endpoints-only
     * (shortest road path A→B) to bound API calls. Fully degradable: a missing
     * or failed service simply leaves the straight-line measurement untouched.
     */
    private _enrichWithRoadEta;
    /**
     * Reattach to a new view after a 2D↔3D switch.
     */
    onViewChanged(view: MapView | SceneView): void;
    destroy(): void;
    /**
     * Returns a snapshot of the engine's current operational state.
     * Useful for status indicators and debugging.
     */
    getStatus(): {
        isEnabled: boolean;
        unit: DistanceUnit;
        areaUnit: AreaUnit;
        isGeodesic: boolean;
        activeGraphics: number;
    };
    /**
     * A clean multi-line string of the most recent measurement, suitable for
     * the "Copy" button or clipboard. Returns "" if nothing has been measured.
     */
    getFormattedSnapshot(): string;
    /** Core update — shared by draw-progress and all-segment editing. */
    private _updateGraphics;
    /** Edit mode variant — always creates a fresh segment graphic. */
    private _updateForEdit;
    /** Create empty placeholder graphics on first control point. */
    private _addEmptyGraphics;
    private _clearHandles;
    private _pt;
    private _mid;
    private _angle;
    private _metersToUnit;
    /** Pick a readable display unit for a length given in meters. */
    private _resolveDisplayUnit;
    /** Format a length (in meters) into a display string with smart precision. */
    private _formatDist;
    /** Straight-line length between two points, in meters (slant-adjusted if enabled). */
    private _segMeters;
    private _segLen;
    private _polyMeters;
    private _polyLen;
    private _area;
    private _polygonToPolyline;
    private _extentToPolygon;
    private _bearingValues;
    /**
     * Build a compact bearing label. Uses magnetic azimuth (suffix "M") when a
     * declination is set, otherwise true azimuth (suffix "T") — so the label is
     * never silently mislabelled as one when it's the other.
     */
    private _bearingLabel;
    /** Rebuild cached Font/Color — called on construction and when font opts change. */
    private _rebuildStyle;
    private _textSymbol;
    private _distAbbr;
    private _areaAbbr;
    /**
     * Resolve geodesic mode from the view's spatial reference (lazy, idempotent).
     * Only WGS84 (4326) and Web Mercator (3857) support the geodesic operators;
     * any other projected SR falls back to planar, which is inaccurate over long
     * distances — warn once so it isn't a silent surprise.
     */
    private _resolveGeodesic;
    private _getOrCreateLayer;
    private _emitUpdate;
    private _emitStateChange;
    private _emitHint;
}
export default MeasurementEngine;
