/**
 * LocalPeaksEngine.ts
 * Terrain local peak / valley detection widget.
 *
 * Mirrors FlightEngine's self-contained analysis-engine pattern: private layers,
 * draggable panel, status/progress, map interaction handles, and exports.
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import Polygon from '@arcgis/core/geometry/Polygon';
import Extent from '@arcgis/core/geometry/Extent';
export type PeakMode = 'peaks' | 'valleys';
export type SortKey = 'rank' | 'elevation' | 'prominence';
export interface LocalPeaksHeadlessOptions {
    aoi?: Polygon | Extent;
    mode?: PeakMode;
    cellSizeM?: number;
    searchRadiusM?: number;
    prominenceM?: number;
    isolationM?: number;
    minElevationM?: number;
    maxResults?: number;
    sortKey?: SortKey;
}
export interface LocalPeakResult {
    id: number;
    rank: number;
    longitude: number;
    latitude: number;
    elevation: number;
    prominence: number;
    neighborhoodMean: number;
    neighborhoodMin: number;
    neighborhoodMax: number;
    isolationM: number;
    type: PeakMode;
    row: number;
    col: number;
}
export declare class LocalPeaksEngine {
    static readonly PEAK_LAYER_ID = "local-peaks-results";
    static readonly LABEL_LAYER_ID = "local-peaks-labels";
    static readonly AOI_LAYER_ID = "local-peaks-aoi";
    static readonly PROFILE_LAYER_ID = "local-peaks-profile";
    private _view;
    private _peakLayer;
    private _labelLayer;
    private _aoiLayer;
    private _profileLayer;
    private _panelEl;
    private _sketch;
    private _bufferPickHandle;
    private _viewWatchHandle;
    private _autoTimer;
    private _profileWidget;
    private _profileContainer;
    private _customAoi;
    private _bufferCenter;
    private _results;
    private _selectedId;
    private _running;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    constructor();
    initialize(view: MapView | SceneView): void;
    open(graphic?: Graphic, view?: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    clearResults(): void;
    runHeadless(options?: LocalPeaksHeadlessOptions): Promise<LocalPeakResult[]>;
    private _createLayers;
    private _ensureSketch;
    private _values;
    private _runAnalysis;
    private _gridSpec;
    private _sampleGrid;
    private _smooth;
    private _detectCandidates;
    private _rankAndFilter;
    private _renderGraphics;
    private _peakSymbol;
    private _resolveAoi;
    private _bufferGeometry;
    private _pointInAoi;
    private _drawAoiGeometry;
    private _drawBufferAoi;
    private _styleAoiGraphic;
    private _aoiSymbol;
    private _startDraw;
    private _startBufferPick;
    private _cancelBufferPick;
    private _selectPeak;
    private _drawProfileLine;
    private _openProfile;
    private _destroyProfileWidget;
    private _showPanel;
    private _hidePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _renderResults;
    private _syncStats;
    private _syncAutoRun;
    private _detachAutoRun;
    private _maybeAutoRun;
    private _scheduleAutoRun;
    private _exportCsv;
    private _exportGeoJson;
    private _exportShapefile;
    private _buildPointShapefile;
    private _writeShapeHeader;
    private _shapeBounds;
    private _buildDbf;
    private _writeAscii;
    private _download;
    private _downloadBlob;
    private _setStatus;
    private _setProgress;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _el;
    private _num;
    private _checked;
    private _selectValue;
    private _setSelectValue;
    private _setText;
    private _tick;
    private _injectStyles;
}
export default LocalPeaksEngine;
