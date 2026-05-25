import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayerManager from '../Managers/GraphicsLayerManager';
import SelectionEngine from './SelectionEngine.ts';
interface UndoEntry {
    label: string;
    undo: () => void;
    redo: () => void;
}
export interface ClipboardEngineDeps {
    getView: () => MapView | SceneView;
    layerManager: GraphicsLayerManager;
    getSelectionEngine: () => SelectionEngine;
    pushUndo: (entry: UndoEntry) => void;
    closeActiveWorkflow: () => void;
    emitEvent: (eventName: string, data: any) => void;
    getLabelOptions: () => any;
}
/**
 * Owns the copy/paste clipboard and all related geometry transforms.
 * Extracted from SymbolEngine to keep that class focused on coordination.
 * SymbolEngine retains the public copySymbol / pasteSymbol / hasClipboard /
 * paste-mode methods as thin delegates so existing call sites are unchanged.
 */
export default class ClipboardEngine {
    private readonly deps;
    private _clipboard;
    constructor(deps: ClipboardEngineDeps);
    private get view();
    get hasClipboard(): boolean;
    get clipboardLength(): number;
    /** Drop any held items — used when the clipboard feature is disabled. */
    clear(): void;
    copy(graphic: Graphic): void;
    paste(targetPoint: Point, expandDistance?: number, expandUnit?: string): Graphic | null;
    showPasteOffsetDialog(): void;
    activatePasteModeWithOffset(expandDistance: number, expandUnit: string): void;
    activatePasteMode(): void;
    private _pasteOneItem;
    private _transformDrawEssentials;
    private _shiftDrawEssentials;
    private _buildPastedGraphic;
    private _computeBearing;
    private _clipboardCentroid;
    private _offsetGeometryTo;
    private static generateUUID;
}
export {};
