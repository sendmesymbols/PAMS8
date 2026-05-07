/**
 * WeaponEffectEngine.ts
 * Weapon Engagement Zone (WEZ) analysis engine.
 *
 * Integrated with ContextMenuManager via linkWeaponEffectEngine().
 * Right-clicking any military symbol → Analysis → Weapon Engagement Zone
 * opens this panel with the symbol's location as the observer origin.
 *
 * Uses three private GraphicsLayers:
 *   wez-analysis   — live working layer (cleared on every redraw)
 *   wez-observer   — observer marker
 *   wez-committed  — persisted results after "Commit"
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
export interface WeaponPreset {
    label: string;
    minRangeM: number;
    maxRangeM: number;
    azimuthSpreadDeg: number;
    elevMinDeg: number;
    elevMaxDeg: number;
    extrudeHeightFactor: number;
    color: [number, number, number];
    accentHex: string;
    icon: string;
}
export declare const WEAPON_PRESETS: Record<string, WeaponPreset>;
export declare class WeaponEffectEngine {
    static readonly ANALYSIS_LAYER_ID = "wez-analysis";
    static readonly COMMITTED_LAYER_ID = "wez-committed";
    static readonly OBSERVER_LAYER_ID = "wez-observer";
    private _view;
    private _analysisLayer;
    private _committedLayer;
    private _observerLayer;
    private _observerPoint;
    private _panelEl;
    private _repositionHandle;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    constructor();
    initialize(view: MapView | SceneView): void;
    /** Called by ContextMenuManager when "Weapon Engagement Zone" is clicked. */
    open(graphic: Graphic, view: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    private _createLayers;
    private _destinationPoint;
    private _buildAzimuthWedge;
    private _computeWEZ;
    private _is3D;
    /** Returns fill alpha (0-255) from the panel's fill-opacity slider. */
    private _getFillAlpha;
    private _wezZoneSymbol;
    private _deadZoneSymbol;
    private _maskedSectorSymbol;
    private _rangeRingSymbol;
    private _azimuthLineSymbol;
    private _observerSymbol;
    private _rangeLabelSymbol;
    private _redraw;
    private _drawObserver;
    private _runTerrainMask;
    private _showPanel;
    private _hidePanel;
    /** Hide panel but keep working graphics + observer intact for later resume. */
    private _minimizePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _startReposition;
    private _cancelReposition;
    private _commit;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _setStatus;
    private _syncTerrainBtn;
    private _currentPreset;
    private _weaponKey;
    private _inp;
    private _setInputVal;
    private _fmtDist;
    private _detectWeaponType;
    private _injectStyles;
}
export default WeaponEffectEngine;
