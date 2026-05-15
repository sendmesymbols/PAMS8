/**
 * LOSEngine.ts
 * Line-of-Sight / Viewshed analysis engine.
 *
 * 3D SceneView → Uses ArcGIS LineOfSightAnalysis for direct-target LOS
 *                + ArcGIS ViewshedAnalysis for viewshed dome.
 * 2D MapView   → ElevationSampler terrain ray-casting only.
 *
 * Integrated with ContextMenuManager via linkLOSEngine().
 * Right-click any symbol → Analysis → Line of Sight.
 *
 * Layers:
 *   los-analysis   — working graphics (cleared on every run)
 *   los-observer   — observer marker
 *   los-committed  — persisted results after Commit
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
export declare class LOSEngine {
    static readonly ANALYSIS_LAYER_ID = "los-analysis";
    static readonly OBSERVER_LAYER_ID = "los-observer";
    static readonly COMMITTED_LAYER_ID = "los-committed";
    private _view;
    private _analysisLayer;
    private _observerLayer;
    private _committedLayer;
    private _observerPoint;
    private _targets;
    private _panelEl;
    private _pickHandle;
    private _pickMode;
    private _losAnalysis;
    private _losAnalysisView;
    private _losResultsWatch;
    private _losObserverPoint;
    private _viewshedAnalysis;
    private _viewshedAnalysisView;
    private _committedViewshedAnalysis;
    private _isDragging;
    private _dragOffsetX;
    private _dragOffsetY;
    constructor();
    initialize(view: MapView | SceneView): void;
    open(graphic: Graphic, view: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    private _createLayers;
    private _clearLOSAnalysis;
    private _clearCommittedViewshedAnalysis;
    private _engineMode;
    private _useArcGIS3D;
    private _setCommitEnabled;
    private _runLOS3D;
    private _updateLOS3DResults;
    private _runViewshed3D;
    private _ensureCommittedViewshedAnalysis;
    private _runTerrain;
    private _run;
    private _drawObserver;
    private _drawTargetMarkers;
    private _is3D;
    private _observerSymbol;
    private _targetSymbol;
    private _makeLOSLine;
    private _obstructionSymbol;
    private _viewshedSymbol;
    private _commit;
    private _startPick;
    private _cancelPick;
    private _updateTargetList;
    private _showPanel;
    private _hidePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _setStatus;
    private _inp;
    private _sel;
    private _injectStyles;
}
export default LOSEngine;
