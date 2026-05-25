import Graphic from '@arcgis/core/Graphic';
import ContextMenuManager from '../Managers/ContextMenuManager';
import EditEngine from './EditEngine.ts';
import SelectionEngine from './SelectionEngine.ts';
interface UndoEntry {
    label: string;
    undo: () => void;
    redo: () => void;
}
export interface KeyboardShortcutDeps {
    contextMenuManager: ContextMenuManager;
    editEngine: EditEngine;
    selectionEngine: SelectionEngine;
    modifySymbol: (g: Graphic) => void;
    activateEditControlPoints: (g: Graphic) => void;
    deactivateEdit: () => void;
    undo: () => void;
    redo: () => void;
    copySymbol: (g: Graphic) => void;
    activatePasteMode: () => void;
    showPasteOffsetDialog: () => void;
    removeGraphic: (g: Graphic) => void;
    showSymbolDetails: (g: Graphic) => void;
    centerOnGraphic: (g: Graphic) => void;
    closeActiveWorkflow: () => void;
    pushUndo: (entry: UndoEntry) => void;
    stopContinuousMode: () => void;
    getCreationMode: () => 'single' | 'continuous';
}
/**
 * Owns the global document-level keydown listener and all keyboard shortcut
 * routing (M, E, Escape, Delete, I, C, L, Ctrl+Z/Y/C/V, Ctrl+Shift+V).
 * Extracted from SymbolEngine — SymbolEngine's _setupKeyboardShortcuts now
 * constructs and attaches one of these.
 *
 * Shortcut table:
 *   M           Move, Scale, Rotate (last right-clicked or single-selected graphic)
 *   E           Edit Control Points
 *   Escape      Deactivate edit / cancel continuous-mode
 *   Delete      Delete selection or last clicked graphic
 *   I           Show symbol details
 *   C           Center on graphic
 *   L           Lasso select (or cancel active lasso)
 *   Ctrl+Z      Undo
 *   Ctrl+Y / Ctrl+Shift+Z   Redo
 *   Ctrl+C      Copy
 *   Ctrl+V      Paste
 *   Ctrl+Shift+V    Paste with offset dialog
 */
export default class KeyboardShortcutManager {
    private readonly deps;
    private _handler;
    constructor(deps: KeyboardShortcutDeps);
    attach(): void;
    detach(): void;
    private currentGraphic;
    private onKeyDown;
}
export {};
