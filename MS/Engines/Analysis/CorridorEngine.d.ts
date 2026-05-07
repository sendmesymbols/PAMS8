/**
 * CorridorEngine.ts
 * Route corridor / MSR analysis engine.
 *
 * Integrated with ContextMenuManager via linkCorridorEngine().
 * Right-clicking a symbol -> Analysis -> Corridor Analysis opens this panel.
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
export declare class CorridorEngine {
    static readonly ANALYSIS_LAYER_ID = "corridor-analysis";
    static readonly THREAT_LAYER_ID = "corridor-threats";
    static readonly COMMITTED_LAYER_ID = "corridor-committed";
    static readonly PREVIEW_LAYER_ID = "corridor-preview";
    private _view;
    private _analysisLayer;
    private _threatLayer;
    private _committedLayer;
    private _previewLayer;
    private _panelEl;
    private _waypoints;
    private _threats;
    private _routeDrawn;
    private _placementMode;
    private _activeThreatOverlayId;
    private _mapClickHandle;
    private _workingGraphics;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    constructor();
    initialize(view: MapView | SceneView): void;
    open(graphic: Graphic, view: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    private _createLayers;
    private _showPanel;
    private _hidePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _startPlacement;
    private _cancelPlacement;
    private _drawPreview;
    private _drawThreat;
    private _redraw;
    private _addAnalysisGraphic;
    private _polygonGraphic;
    private _commit;
    private _refreshPanel;
    private _restoreFromCommitted;
    private _pickMapPoint;
    private _graphicToPoint;
    private _firstPolygon;
    private _is3D;
    private _computeTotalDistance;
    private _currentPreset;
    private _presetKey;
    private _currentThreatOverlay;
    private _setInputVal;
    private _inp;
    private _setText;
    private _setStatus;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _injectStyles;
}
export default CorridorEngine;
