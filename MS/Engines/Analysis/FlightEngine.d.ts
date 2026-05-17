/**
 * FlightEngine.ts
 * UAV flight planning and visualization analysis engine.
 *
 * Integrated with ContextMenuManager via linkFlightEngine().
 * Right-clicking any military symbol -> Analysis -> UAV Flight Analysis
 * opens this panel with the symbol's location as launch/current UAV origin.
 *
 * Uses private GraphicsLayers:
 *   flight-route      - working route, waypoints, ETA labels
 *   flight-coverage   - endurance, sensor, and weapon envelopes
 *   flight-vehicle    - animated/current UAV marker
 *   flight-committed  - persisted flight plans after "Commit"
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
export interface FlightPreset {
    label: string;
    role: string;
    speedKmh: number;
    enduranceMin: number;
    altitudeM: number;
    sensorRangeM: number;
    sensorFovDeg: number;
    armed: boolean;
    weaponRangeM: number;
    color: [number, number, number];
    accentHex: string;
}
export declare const UAV_PRESETS: Record<string, FlightPreset>;
export declare class FlightEngine {
    static readonly ROUTE_LAYER_ID = "flight-route";
    static readonly COVERAGE_LAYER_ID = "flight-coverage";
    static readonly VEHICLE_LAYER_ID = "flight-vehicle";
    static readonly COMMITTED_LAYER_ID = "flight-committed";
    private _view;
    private _routeLayer;
    private _coverageLayer;
    private _vehicleLayer;
    private _committedLayer;
    private _panelEl;
    private _pickHandle;
    private _animationId;
    private _animationStartedAt;
    private _animationDurationMs;
    private _waypoints;
    private _presetKey;
    private _pendingValues;
    private _routeRenderKey;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    constructor();
    initialize(view: MapView | SceneView): void;
    open(graphic: Graphic, view: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    private _createLayers;
    private _is3D;
    private _flightElevationInfo;
    private _values;
    private _computeMetrics;
    private _positionAt;
    private _redraw;
    private _drawRoute;
    private _drawAltitudeTether;
    private _drawEndurance;
    private _drawSurveillanceTrail;
    private _drawSensorFootprint;
    private _drawWeaponEnvelope;
    private _drawVehicle;
    private _drawProgressSegment;
    private _routeSymbol;
    private _waypointSymbol;
    private _vehicleSymbol;
    private _progressRouteSymbol;
    private _circle;
    private _sector;
    private _showPanel;
    private _hidePanel;
    private _minimizePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _startPick;
    private _cancelPick;
    private _startAnimation;
    private _animateFrame;
    private _stopAnimation;
    private _removeGraphicsByTypes;
    private _commit;
    private _loadCommittedPlan;
    private _applyPendingValues;
    private _syncPanel;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _textSymbol;
    private _setStatus;
    private _el;
    private _num;
    private _checked;
    private _selectValue;
    private _setVal;
    private _setChecked;
    private _injectStyles;
}
export default FlightEngine;
