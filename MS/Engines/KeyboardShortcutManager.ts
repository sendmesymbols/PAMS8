import Graphic from '@arcgis/core/Graphic';

import ContextMenuManager from '../Managers/ContextMenuManager';
import EditEngine from './EditEngine.ts';
import SelectionEngine from './SelectionEngine.ts';
import settingsData from '../Data/Settings.json';
import CommandPalette from '../Support/CommandPalette';

interface UndoEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

export interface KeyboardShortcutDeps {
  contextMenuManager: ContextMenuManager;
  editEngine: EditEngine;
  selectionEngine: SelectionEngine;
  // Action callbacks
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
 *   Alt+L       Subtract lasso — remove enclosed symbols from selection
 *   Ctrl+Z      Undo
 *   Ctrl+Y / Ctrl+Shift+Z   Redo
 *   Ctrl+C      Copy
 *   Ctrl+V      Paste
 *   Ctrl+Shift+V    Paste with offset dialog
 */
export default class KeyboardShortcutManager {
  private _handler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private deps: KeyboardShortcutDeps) {}

  attach(): void {
    if (this._handler) return; // already attached
    this._handler = (e: KeyboardEvent) => this.onKeyDown(e);
    document.addEventListener('keydown', this._handler);
  }

  detach(): void {
    if (!this._handler) return;
    document.removeEventListener('keydown', this._handler);
    this._handler = null;
  }

  /**
   * Swap in a new EditEngine instance after a view switch.  Without this the
   * old EditEngine is pinned by this manager's document keydown listener and
   * shortcut state queries (`isModifyingSymbol` / `isEditingControlPoints`)
   * read from the discarded engine bound to the previous view.
   */
  rewireEditEngine(editEngine: EditEngine): void {
    this.deps.editEngine = editEngine;
  }

  private currentGraphic(): Graphic | null {
    return (
      this.deps.contextMenuManager.getLastClickedGraphic() ??
      (this.deps.selectionEngine.count === 1
        ? this.deps.selectionEngine.selectedGraphics[0]
        : null)
    );
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Ctrl+K opens the command palette from anywhere — including focused inputs
    // (otherwise users can't escape the giant settings panel via keyboard).
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      CommandPalette.toggle();
      return;
    }

    // Skip when typing in an input field or contenteditable element
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (el?.isContentEditable) return;

    // Handle Ctrl shortcuts first
    if (e.ctrlKey || e.metaKey) {
      if (e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        this.deps.redo();
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        this.deps.undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        this.deps.redo();
      } else if (e.key === 'c' || e.key === 'C') {
        if ((settingsData as any).features?.clipboard !== false) {
          const g = this.currentGraphic();
          if (g) {
            e.preventDefault();
            this.deps.copySymbol(g);
          }
        }
      } else if (e.key === 'v' || e.key === 'V') {
        if ((settingsData as any).features?.clipboard !== false) {
          e.preventDefault();
          if (e.shiftKey) {
            this.deps.showPasteOffsetDialog();
          } else {
            this.deps.activatePasteMode();
          }
        }
      }
      return;
    }

    const graphic = this.currentGraphic();

    switch (e.key) {
      case 'm':
      case 'M':
        if (graphic) {
          e.preventDefault();
          this.deps.modifySymbol(graphic);
        }
        break;
      case 'e':
      case 'E':
        if (graphic) {
          e.preventDefault();
          this.deps.activateEditControlPoints(graphic);
        }
        break;
      case 'Escape':
        if (
          this.deps.editEngine.isModifyingSymbol ||
          this.deps.editEngine.isEditingControlPoints
        ) {
          e.preventDefault();
          this.deps.deactivateEdit();
        } else if (this.deps.getCreationMode() === 'continuous') {
          e.preventDefault();
          this.deps.stopContinuousMode();
        }
        break;
      case 'Delete':
        if (this.deps.selectionEngine.count > 1) {
          e.preventDefault();
          this.deps.selectionEngine.deleteSelected((entry) =>
            this.deps.pushUndo(entry),
          );
        } else if (graphic) {
          e.preventDefault();
          this.deps.removeGraphic(graphic);
        }
        break;
      case 'i':
      case 'I':
        if (graphic) {
          e.preventDefault();
          this.deps.showSymbolDetails(graphic);
        }
        break;
      case 'c':
      case 'C':
        if (graphic) {
          e.preventDefault();
          this.deps.centerOnGraphic(graphic);
        }
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        if (e.altKey) {
          if (this.deps.selectionEngine.isLassoActive) {
            this.deps.selectionEngine.cancelLasso();
          } else {
            this.deps.selectionEngine.lassoSelect({ subtract: true });
          }
        } else if (this.deps.selectionEngine.isLassoActive) {
          this.deps.selectionEngine.cancelLasso();
        } else {
          this.deps.closeActiveWorkflow();
          this.deps.selectionEngine.lassoSelect();
        }
        break;
    }
  }
}
