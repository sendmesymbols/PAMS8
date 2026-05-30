import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SelectionEngine from "./SelectionEngine.ts";
import EditEngine from "./EditEngine.ts";
/**
 * Callbacks exposing the few SymbolEngine-owned operations the panel needs.
 * Passed in instead of importing SymbolEngine directly so this widget stays
 * decoupled (and avoids a circular import).
 */
export interface SelectionActionPanelCallbacks {
    copySymbol: (graphic: Graphic) => void;
    pushUndo: (entry: {
        label: string;
        undo: () => void;
        redo: () => void;
    }) => void;
    getView: () => MapView | SceneView;
    modifySymbol: (graphic: Graphic) => void;
}
/**
 * SelectionActionPanel
 *
 * Bottom-centre floating toolbar that appears whenever SelectionEngine has a
 * non-empty selection.  Surfaces a tab switcher + button row whose contents
 * adapt to the current selection's shape (A/B/C/D/E).
 *
 * No new behaviour — every button calls an existing method on SelectionEngine,
 * EditEngine, or the callbacks passed by SymbolEngine.
 *
 * Style: matches the EditEngine mode banner so the two read as one family.
 */
declare class SelectionActionPanel {
    private _selectionEngine;
    private _editEngine;
    private _cb;
    private _enabled;
    private _container;
    private _selectionListener;
    private _activeTab;
    private _similarPopup;
    constructor(selectionEngine: SelectionEngine, editEngine: EditEngine, callbacks: SelectionActionPanelCallbacks);
    /**
     * Swap in a new EditEngine instance.  Called from SymbolEngine.onViewChanged
     * after a 2D/3D view switch rebuilds the engine — without this the panel
     * keeps pinning the old EditEngine (memory leak) and its buttons would
     * invoke the old instance bound to the previous view.
     */
    rewireEditEngine(editEngine: EditEngine): void;
    /** Start listening for selection changes and rendering the panel. */
    enable(): void;
    /** Tear down the panel and detach listeners. */
    disable(): void;
    /**
     * Re-evaluate visibility and rebuild the panel.  Called on selectionChange
     * and externally by SymbolEngine when an edit session starts/ends or the
     * view is swapped.
     */
    refresh(): void;
    private _classify;
    /** Coarse geometry bucket used by classification. */
    private _kind;
    private _tabsForCategory;
    private _ensureContainer;
    private _removeContainer;
    private _render;
    private _renderHeader;
    private _summary;
    private _renderActions;
    private _renderTransformActions;
    private _renderAlignActions;
    private _renderDistributeActions;
    private _renderArrangeActions;
    private _mkBtn;
    /** "Select Similar ▾" button — opens a small floating popup with 4 options. */
    private _mkSimilarBtn;
    private _toggleSimilarPopup;
    private _removeSimilarPopup;
    private _deleteOne;
    private _centerOn;
}
export default SelectionActionPanel;
