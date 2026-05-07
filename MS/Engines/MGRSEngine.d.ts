/**
 * MGRSEngine.ts
 * On-demand MGRS grid overlay for ArcGIS 2D and 3D views.
 *
 * GZD boundaries use pure lat/lon math (Norwegian + Svalbard exceptions included).
 * 100 km / 10 km sub-grids use compact Transverse Mercator (UTM) math — no
 * external library dependency.
 *
 * Singleton — MGRSEngine.getInstance().
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
export interface MGRSEngineOptions {
    showGZD?: boolean;
    show100K?: boolean;
    show10K?: boolean;
    show1K?: boolean;
    autoZoom?: boolean;
    gzdColor?: [number, number, number];
    gzdOpacity?: number;
    gzdWidth?: number;
    hundredKColor?: [number, number, number];
    hundredKOpacity?: number;
    hundredKWidth?: number;
    tenKColor?: [number, number, number];
    tenKOpacity?: number;
    tenKWidth?: number;
    oneKColor?: [number, number, number];
    oneKOpacity?: number;
    oneKWidth?: number;
    showLabels?: boolean;
    labelSize?: number;
    labelColor?: [number, number, number];
    labelOpacity?: number;
}
export default class MGRSEngine {
    private static _instance;
    private _view;
    private _layer;
    private _enabled;
    private _active;
    private _handles;
    private _rebuildTimer;
    private _opts;
    private constructor();
    static getInstance(): MGRSEngine;
    start(view: MapView | SceneView): void;
    enable(): void;
    disable(): void;
    toggle(): boolean;
    setOptions(opts: Partial<MGRSEngineOptions>): void;
    refresh(): void;
    onViewChanged(newView: MapView | SceneView): void;
    destroy(): void;
    get isEnabled(): boolean;
    get isActive(): boolean;
    private _setupWatcher;
    private _scheduleRebuild;
    private _rebuild;
    private _rebuildWGS84;
    private _buildGZDLines;
    private _buildGZDLabels;
    private _buildSubGridLines;
    private _lineGraphic;
    private _textGraphic;
    private _lineSym;
    private _textSym;
    private _clearHandles;
}
