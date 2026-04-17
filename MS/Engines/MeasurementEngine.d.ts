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
}
export interface MeasurementSnapshot {
    segmentLength: string;
    totalLength: string;
    area: string;
    bearing: string;
    height: string;
    width: string;
    unit: DistanceUnit;
    areaUnit: AreaUnit;
}
declare class MeasurementEngine {
    private static _instance;
    private _isEnabled;
    private _view;
    private _isGeodesic;
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
    /**
     * Reattach to a new view after a 2D↔3D switch.
     */
    onViewChanged(view: MapView | SceneView): void;
    destroy(): void;
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
    private _segLen;
    private _polyLen;
    private _area;
    private _extentToPolygon;
    private _bearing;
    private _textSymbol;
    private _distAbbr;
    private _areaAbbr;
    private _findById;
    /** Resolve geodesic mode from the view's spatial reference (lazy, idempotent). */
    private _resolveGeodesic;
    private _getOrCreateLayer;
    private _emitUpdate;
    private _emitStateChange;
}
export default MeasurementEngine;
