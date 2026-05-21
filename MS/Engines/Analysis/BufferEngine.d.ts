/**
 * BufferEngine.ts
 * Buffer & Threat Rings analysis engine.
 *
 * Integrated with ContextMenuManager via linkBufferEngine().
 * Right-clicking any military symbol -> Analysis -> Buffer and Threat Rings
 * opens this panel with the symbol location as source origin.
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
export interface ThreatRingDef {
    label: string;
    radiusM: number;
    colorKey: keyof typeof RING_COLORS;
}
interface ThreatPreset {
    label: string;
    rings: ThreatRingDef[];
}
export declare const THREAT_PRESETS: Record<string, ThreatPreset>;
export declare const RING_COLORS: {
    readonly lethal: {
        readonly fill: readonly [220, 60, 48, 0.18];
        readonly outline: readonly [220, 60, 48, 0.85];
        readonly label: "#DC3C30";
    };
    readonly warning: {
        readonly fill: readonly [239, 159, 39, 0.13];
        readonly outline: readonly [239, 159, 39, 0.8];
        readonly label: "#EF9F27";
    };
    readonly safe: {
        readonly fill: readonly [29, 158, 117, 0.09];
        readonly outline: readonly [29, 158, 117, 0.6];
        readonly label: "#1D9E75";
    };
    readonly info: {
        readonly fill: readonly [55, 138, 221, 0.1];
        readonly outline: readonly [55, 138, 221, 0.65];
        readonly label: "#378ADD";
    };
    readonly dead: {
        readonly fill: readonly [100, 100, 100, 0.25];
        readonly outline: readonly [150, 150, 150, 0.7];
        readonly label: "#969490";
    };
    readonly exclusion: {
        readonly fill: readonly [180, 40, 220, 0.12];
        readonly outline: readonly [180, 40, 220, 0.7];
        readonly label: "#B428DC";
    };
};
export declare class BufferEngine {
    static readonly ANALYSIS_LAYER_ID = "buffer-analysis";
    static readonly LABEL_LAYER_ID = "buffer-labels";
    static readonly SOURCE_LAYER_ID = "buffer-sources";
    static readonly COMMITTED_LAYER_ID = "buffer-committed";
    private _view;
    private _analysisLayer;
    private _labelLayer;
    private _sourceLayer;
    private _committedLayer;
    private _panelEl;
    private _pickHandle;
    private _mode;
    private _presetKey;
    private _sourcePoints;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    constructor();
    initialize(view: MapView | SceneView): void;
    open(graphic: Graphic, view: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    private _createLayers;
    private _computeRings;
    private _computeUnionRings;
    private _computeContestedZone;
    private _computeMultiSourceContestedZone;
    private _computeCorridorBuffer;
    private _buildRingGraphics;
    private _buildLabelGraphics;
    private _buildGeometryLabelGraphics;
    private _toWgs84Point;
    private _buildSourceGraphic;
    private _drawSources;
    private _redraw;
    private _contestedGraphic;
    private _corridorGraphic;
    private _currentRings;
    private _startPick;
    private _cancelPick;
    private _commit;
    private _showPanel;
    private _hidePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _inp;
    private _setStatus;
    private _syncCommit;
    private _syncStats;
    private _injectStyles;
}
export default BufferEngine;
