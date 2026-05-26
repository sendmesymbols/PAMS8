import Graphic from '@arcgis/core/Graphic';
import EditEngine from './EditEngine.ts';
import GraphicsLayerManager from '../Managers/GraphicsLayerManager';
export interface UndoEntry {
    label: string;
    undo: () => void;
    redo: () => void;
}
export interface UndoRedoDeps {
    layerManager: GraphicsLayerManager;
    editEngine: EditEngine;
    getLabelOptions: () => any;
}
/**
 * Owns the undo/redo stacks, the pre-edit snapshot mechanism, and the
 * EditEngine wiring that captures geometry changes as undo entries.
 * Extracted from SymbolEngine — SymbolEngine retains thin delegates for
 * _pushUndo / undo / redo / undoCount / redoCount / nextUndoLabel / nextRedoLabel
 * so external call sites are unchanged.
 */
export default class UndoRedoManager {
    private readonly deps;
    private _undoStack;
    private _redoStack;
    private _preEditSnapshot;
    constructor(deps: UndoRedoDeps);
    /** Push an undo entry and clear the redo stack. */
    push(entry: UndoEntry): void;
    /** Undo the last operation. */
    undo(): void;
    /** Redo the last undone operation. */
    redo(): void;
    get undoCount(): number;
    get redoCount(): number;
    get nextUndoLabel(): string | null;
    /**
     * Clear both stacks and the pre-edit snapshot — used by clearAllGraphics.
     *
     * The stack arrays hold closures that reference Graphic instances via
     * `undo`/`redo` lambdas; dropping the arrays releases those references for
     * GC. We also null `_preEditSnapshot`, which otherwise pins the most
     * recently-edited graphic (including any `additionalGraphics`) until the
     * next edit operation completes.
     */
    clear(): void;
    get nextRedoLabel(): string | null;
    /**
     * Snapshot a graphic's geometry, CTRL_PTS and BASE_LN_PTS just before an
     * edit operation begins. Called from SymbolEngine right before activating
     * EditEngine on a graphic.
     */
    capturePreEditSnapshot(graphic: Graphic, additionalGraphics: Graphic[], operationLabel: string): void;
    /**
     * Re-wire the EditEngine listener — invoke after a view switch causes
     * SymbolEngine to construct a new EditEngine.
     */
    rewireEditEngine(editEngine: EditEngine): void;
    private wireEditEngineUndo;
    private buildGraphicUndoState;
}
