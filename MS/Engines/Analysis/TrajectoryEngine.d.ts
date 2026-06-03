/**
 * TrajectoryEngine.ts
 * Ballistic projectile trajectory analysis engine.
 *
 * Integrated with ContextMenuManager via linkTrajectoryEngine().
 * Right-clicking any military symbol → Analysis → Projectile Trajectory
 * opens this panel with the symbol's location as the firing point.
 *
 * Uses three private GraphicsLayers:
 *   trajectory-analysis   — live working layer (cleared on every redraw)
 *   trajectory-observer   — fire/target markers
 *   trajectory-committed  — persisted results after "Commit"
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
export interface ProjectilePreset {
    label: string;
    massKg: number;
    diamM: number;
    Cd: number;
    muzzleVelocity: number;
    optimalAngle: number;
    maxAngle: number;
    cepM: number;
    color: [number, number, number];
    accentHex: string;
    icon: string;
}
export declare const PROJECTILE_PRESETS: Record<string, ProjectilePreset>;
export declare class TrajectoryEngine {
    static readonly ANALYSIS_LAYER_ID = "trajectory-analysis";
    static readonly OBSERVER_LAYER_ID = "trajectory-observer";
    static readonly COMMITTED_LAYER_ID = "trajectory-committed";
    private _view;
    private _analysisLayer;
    private _observerLayer;
    private _committedLayer;
    private _firePoint;
    private _targetPoint;
    private _panelEl;
    private _clickHandle;
    private _placeMode;
    private _currentTrajectory;
    private _animFrame;
    private _animRunning;
    private _animGraphic;
    private _animStartMs;
    private _animStartIdx;
    private _animPlaybackRate;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    private _tooltipEl;
    private _tooltipTimer;
    constructor();
    initialize(view: MapView | SceneView): void;
    /** Called by ContextMenuManager when "Projectile Trajectory" is clicked. */
    open(graphic?: Graphic | null, view?: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    private _createLayers;
    private _destinationPoint;
    private _bearing;
    private _haversineM;
    private _enuToGeo;
    private _airDensity;
    private _integrate;
    private _interpolateImpactPoint;
    private _solveLaunchAngle;
    private _buildCEP;
    private _redraw;
    private _is3D;
    private _apogeeSymbol;
    private _impactSymbol;
    private _fireSymbol;
    private _targetSymbol;
    private _projectileSymbol;
    private _drawFireMarker;
    private _drawTargetMarker;
    private _startFirePlacement;
    private _startTargetPlacement;
    private _cancelPlacement;
    private _pickMapPoint;
    private _startAnimation;
    private _setupAnimGraphic;
    private _seekAnimation;
    private _playAnimation;
    private _toggleAnimation;
    private _stopAnimation;
    private _commit;
    private _showPanel;
    private _hidePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _setStatus;
    private _setText;
    /** Show a transient tooltip bubble anchored under the "Pick Fire ⊕" button. */
    private _flashPickTooltip;
    private _hideTooltip;
    private _inp;
    private _setInputVal;
    private _currentPreset;
    private _presetKey;
    private _detectPresetType;
    private _injectStyles;
}
export default TrajectoryEngine;
