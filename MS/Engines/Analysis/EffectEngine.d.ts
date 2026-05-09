/**
 * EffectEngine.ts
 * Munition Effects Radius analysis engine.
 *
 * Integrated with ContextMenuManager via linkEffectEngine().
 * Right-click any symbol → Analysis → Effects Radius.
 *
 * Layers:
 *   effects-analysis   — working graphics (rings, spheres, union)
 *   effects-marker     — impact point markers
 *   effects-anim       — animated blast wave sphere
 *   effects-committed  — persisted results after Commit
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
export declare const MUNITION_PRESETS: Record<string, any>;
export declare const STRUCTURE_FACTORS: Record<string, any>;
export declare function computeEffects(munition: string, structureFactor?: string, detonationHeightOverride?: number | null): any;
export declare const EFFECTS_COLORS: Record<string, {
    fill: number[];
    outline: number[];
}>;
export declare function destinationPoint(lon: number, lat: number, bearingDeg: number, distM: number): {
    longitude: number;
    latitude: number;
};
export declare class EffectEngine {
    static readonly ANALYSIS_LAYER_ID = "effects-analysis";
    static readonly MARKER_LAYER_ID = "effects-marker";
    static readonly ANIM_LAYER_ID = "effects-anim";
    static readonly COMMITTED_LAYER_ID = "effects-committed";
    private _view;
    private _analysisLayer;
    private _markerLayer;
    private _animLayer;
    private _committedLayer;
    private _panelEl;
    private _legendEl;
    private _hintEl;
    private _strikes;
    private _pickHandle;
    private _blastAnimations;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    constructor();
    initialize(view: MapView | SceneView): void;
    open(graphic: Graphic, view: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    private _createLayers;
    private _addStrike;
    private _redrawAll;
    private _playBlastWave;
    private _stopAllAnimations;
    private _commit;
    private _updatePhysicsPanel;
    private _renderStrikeList;
    private _setStatus;
    private _flashStatus;
    private _showPanel;
    private _hidePanel;
    private _showLegend;
    private _hideLegend;
    private _showHint;
    private _hideHint;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _inp;
    private _startPick;
    private _cancelPick;
    private _makeDraggable;
    private _injectStyles;
    private _buildRingGraphics;
    private _buildImpactMarker;
    private _buildBlastSphereMesh;
    private _createBlastWaveAnimation;
    private _stopAnimation;
    private _buildUnionFootprint;
}
