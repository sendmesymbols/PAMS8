/**
 * DrawingCueEngine.ts
 * Live visual overlays on the map while drawing a symbol:
 *   • Rubber-band dashed line + live length / bearing label (last ctrl-pt → cursor)
 *   • Floating cursor coordinate label (lat / lon)
 *   • Distance rings from the last placed control point
 *   • Angular guide line snapping to nearest of 0/45/90/135/180/225/270/315° from last ctrl-pt
 *   • Nearby-symbol highlight rings, color-coded by cursor proximity
 *
 * Singleton — DrawingCueEngine.getInstance().
 *
 * Events emitted on document:
 *   "drawing-cue-state-change" – { isActive: boolean }
 */
import Point from '@arcgis/core/geometry/Point';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
export interface DrawingCueOptions {
    enabled?: boolean;
    rubberBand?: {
        enabled?: boolean;
        lineColor?: [number, number, number];
        lineOpacity?: number;
        lineWidth?: number;
        showLabel?: boolean;
        fontSize?: number;
        fontColor?: [number, number, number];
    };
    coordinateDisplay?: {
        enabled?: boolean;
        fontSize?: number;
        fontColor?: [number, number, number];
    };
    angularGuides?: {
        enabled?: boolean;
        snapThresholdDeg?: number;
        snapIntervalDeg?: number;
        lineColor?: [number, number, number];
        lineOpacity?: number;
        lineWidth?: number;
        showLabel?: boolean;
        fontSize?: number;
        showArc?: boolean;
        arcRadiusKm?: number;
        showFan?: boolean;
        showSnapPoint?: boolean;
        showAnchor?: boolean;
        relativeSegment?: boolean;
    };
    distanceRings?: {
        enabled?: boolean;
        intervalKm?: number;
        ringCount?: number;
        lineColor?: [number, number, number];
        lineOpacity?: number;
        lineWidth?: number;
        showLabels?: boolean;
        fontSize?: number;
        fontColor?: [number, number, number];
    };
    nearbyHighlight?: {
        enabled?: boolean;
        radiusKm?: number;
        ringRadiusKm?: number;
        nearColor?: [number, number, number];
        midColor?: [number, number, number];
        farColor?: [number, number, number];
        outlineWidth?: number;
        outlineOpacity?: number;
    };
    adaptive?: {
        enabled?: boolean;
        coverageFraction?: number;
        maxOuterKm?: number;
    };
}
declare class DrawingCueEngine {
    private static _instance;
    private _view;
    private _layer;
    private _isEnabled;
    private _isActive;
    private _isGeodesic;
    private _lastTick;
    private _rbLineG;
    private _rbLabelG;
    private _coordG;
    private _guideGs;
    private _ringGs;
    private _protractorGs;
    private _needleGs;
    private _lastCtrlPt;
    private _prevCtrlPtCount;
    private _candidateInfo;
    private _boundPointerMove;
    private _pointerHandle;
    private _rbEnabled;
    private _rbLineColor;
    private _rbLineOpacity;
    private _rbLineWidth;
    private _rbShowLabel;
    private _rbFontSize;
    private _rbFontColor;
    private _coordEnabled;
    private _coordFontSize;
    private _coordFontColor;
    private _guidesEnabled;
    private _guidesSnapThresholdDeg;
    private _guidesSnapIntervalDeg;
    private _guidesLineColor;
    private _guidesLineOpacity;
    private _guidesLineWidth;
    private _guidesShowLabel;
    private _guidesLabelFontSize;
    private _guidesShowArc;
    private _guidesArcRadiusKm;
    private _guidesShowFan;
    private _guidesShowSnapPoint;
    private _guidesShowAnchor;
    private _guidesRelativeSegment;
    private _prevSegBearing;
    private _ringsEnabled;
    private _ringsIntervalKm;
    private _ringsCount;
    private _ringsLineColor;
    private _ringsLineOpacity;
    private _ringsLineWidth;
    private _ringsShowLabels;
    private _ringsFontSize;
    private _ringsFontColor;
    private _hlEnabled;
    private _hlRadiusKm;
    private _hlRingRadiusKm;
    private _hlNearColor;
    private _hlMidColor;
    private _hlFarColor;
    private _hlOutlineWidth;
    private _hlOutlineOpacity;
    private _adaptiveEnabled;
    private _adaptiveCoverageFraction;
    private _adaptiveMaxOuterKm;
    private constructor();
    static getInstance(): DrawingCueEngine;
    get isEnabled(): boolean;
    get isActive(): boolean;
    start(view: MapView | SceneView): void;
    enable(): void;
    disable(): void;
    toggle(): boolean;
    /**
     * Called once when drawing begins. Snapshots existing graphics for nearby
     * highlight and starts the pointer-move listener.
     * Idempotent — safe to call on every onDrawProgress event.
     */
    activate(targetLayerIds: string[]): void;
    /**
     * Called on each onDrawProgress event. Updates last ctrl-pt and redraws
     * distance rings when a new point is committed.
     */
    updateFromProgress(_geom: __esri.Geometry, ctrlPts: Point[]): void;
    deactivate(): void;
    onViewChanged(view: MapView | SceneView): void;
    setOptions(opts: DrawingCueOptions): void;
    getStatus(): {
        isEnabled: boolean;
        isActive: boolean;
        isGeodesic: boolean;
        adaptiveEnabled: boolean;
        candidates: number;
        activeGraphics: number;
    };
    private _onCursorMove;
    private _updateRubberBand;
    private _updateCoordLabel;
    private _updateAngularGuides;
    private _addAnchorCrosshair;
    private _angleLabel;
    private _kmToMapUnits;
    private _computeAdaptiveIntervalKm;
    private _updateDistanceRings;
    private _updateProtractorRing;
    /**
     * Live bearing needle — updates every pointer-move tick.
     * Draws a rich compass needle with:
     *  • glow/shadow underline for depth
     *  • dimmed back-needle (opposite direction) for visual balance
     *  • swept arc from North (0°) to the bearing for angular visualisation
     *  • bright shaft line along the exact azimuth
     *  • diamond arrowhead at the ring perimeter
     *  • multi-line info label: bearing °, mils, compass quadrant, distance
     */
    private _updateProtractorNeedle;
    /** Convert a 0-360 bearing into compass quadrant notation (e.g. N45°E, S30°W). */
    private _compassQuadrant;
    private _updateNearbyHighlights;
    private _geodesicDistKm;
    private _hlColor;
    private _mapUnitsToKm;
    private _centroid;
    private _segLen;
    private _bearing;
    private _lineAngle;
    private _textSym;
    private _clearDrawingGraphics;
    private _removeGraphic;
    private _resolveGeodesic;
    private _resolveContainer;
    private _getOrCreateLayer;
    private _emitStateChange;
}
export default DrawingCueEngine;
