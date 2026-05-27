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
    pushUndo: (entry: { label: string; undo: () => void; redo: () => void }) => void;
    getView: () => MapView | SceneView;
}

/**
 * Selection category — derived from the current selection's geometry shape.
 *   A → single point
 *   B → single line or polygon
 *   C → multi, all points
 *   D → multi, all lines or all polygons
 *   E → mixed (points + lines/polygons)
 */
type Category = 'A' | 'B' | 'C' | 'D' | 'E';

type TabId = 'transform' | 'align' | 'distribute' | 'arrange';

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
class SelectionActionPanel {
    private _selectionEngine: SelectionEngine;
    private _editEngine: EditEngine;
    private _cb: SelectionActionPanelCallbacks;

    private _enabled = false;
    private _container: HTMLElement | null = null;
    private _selectionListener: { remove(): void } | null = null;

    private _activeTab: TabId = 'transform';
    private _similarPopup: HTMLElement | null = null;

    constructor(
        selectionEngine: SelectionEngine,
        editEngine: EditEngine,
        callbacks: SelectionActionPanelCallbacks,
    ) {
        this._selectionEngine = selectionEngine;
        this._editEngine = editEngine;
        this._cb = callbacks;
    }

    /**
     * Swap in a new EditEngine instance.  Called from SymbolEngine.onViewChanged
     * after a 2D/3D view switch rebuilds the engine — without this the panel
     * keeps pinning the old EditEngine (memory leak) and its buttons would
     * invoke the old instance bound to the previous view.
     */
    public rewireEditEngine(editEngine: EditEngine): void {
        this._editEngine = editEngine;
    }

    /** Start listening for selection changes and rendering the panel. */
    public enable(): void {
        if (this._enabled) return;
        this._enabled = true;
        this._selectionListener = this._selectionEngine.on('selectionChange', () => this.refresh());
        this.refresh();
    }

    /** Tear down the panel and detach listeners. */
    public disable(): void {
        if (!this._enabled) return;
        this._enabled = false;
        this._selectionListener?.remove();
        this._selectionListener = null;
        this._removeContainer();
        this._removeSimilarPopup();
    }

    /**
     * Re-evaluate visibility and rebuild the panel.  Called on selectionChange
     * and externally by SymbolEngine when an edit session starts/ends or the
     * view is swapped.
     */
    public refresh(): void {
        if (!this._enabled) {
            this._removeContainer();
            return;
        }

        const selected = this._selectionEngine.selectedGraphics;
        // Hide while an edit session is active — the EditEngine banner already
        // occupies bottom-centre and serves the user.
        const editActive = this._editEngine.isModifyingSymbol || this._editEngine.isEditingControlPoints;

        if (selected.length === 0 || editActive) {
            this._removeContainer();
            this._removeSimilarPopup();
            return;
        }

        const category = this._classify(selected);
        const visibleTabs = this._tabsForCategory(category);
        if (!visibleTabs.includes(this._activeTab)) {
            this._activeTab = visibleTabs[0];
        }

        this._ensureContainer();
        this._render(selected, category, visibleTabs);
    }

    // -----------------------------------------------------------------------
    // Classification
    // -----------------------------------------------------------------------

    private _classify(selected: Graphic[]): Category {
        if (selected.length === 1) {
            return selected[0].geometry?.type === 'point' ? 'A' : 'B';
        }
        const kinds = selected.map(g => this._kind(g));
        const hasPoint = kinds.includes('point');
        const hasLineArea = kinds.includes('lineArea');
        if (hasPoint && hasLineArea) return 'E';
        return hasPoint ? 'C' : 'D';
    }

    /** Coarse geometry bucket used by classification. */
    private _kind(graphic: Graphic): 'point' | 'lineArea' | 'unknown' {
        const t = this._selectionEngine.getGraphicGeomType(graphic);
        if (t === 'Point' || t === 'FPoint' || graphic.geometry?.type === 'point') return 'point';
        if (graphic.geometry?.type === 'polyline' || graphic.geometry?.type === 'polygon') return 'lineArea';
        if (t === 'Line' || t === 'Area' || t === 'Polyline' || t === 'Polygon') return 'lineArea';
        return 'unknown';
    }

    private _tabsForCategory(c: Category): TabId[] {
        switch (c) {
            case 'A':
            case 'B': return ['transform'];
            case 'C': return ['transform', 'align', 'distribute', 'arrange'];
            case 'D': return ['transform', 'align', 'distribute'];
            case 'E': return ['transform', 'align'];
        }
    }

    // -----------------------------------------------------------------------
    // DOM container
    // -----------------------------------------------------------------------

    private _ensureContainer(): void {
        if (this._container) return;
        const el = document.createElement('div');
        el.className = 'selection-action-panel ms-theme-ops-dark';
        el.style.cssText = `
            position: fixed;
            bottom: 70px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(14,18,28,0.92);
            border: 1px solid rgba(90,140,220,0.4);
            border-radius: 9px;
            padding: 6px 12px 8px;
            font-family: 'Inter','Segoe UI',sans-serif;
            font-size: 11.5px;
            color: #a8c4e0;
            z-index: 1490;
            box-shadow: 0 4px 18px rgba(0,0,0,0.45);
            display: flex; flex-direction: column; gap: 6px;
            min-width: 380px;
        `;
        document.body.appendChild(el);
        this._container = el;
    }

    private _removeContainer(): void {
        if (this._container) {
            this._container.remove();
            this._container = null;
        }
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    private _render(selected: Graphic[], category: Category, visibleTabs: TabId[]): void {
        if (!this._container) return;
        this._container.innerHTML = '';

        this._container.appendChild(this._renderHeader(selected, category, visibleTabs));
        this._container.appendChild(this._renderActions(selected, category));
    }

    private _renderHeader(selected: Graphic[], category: Category, visibleTabs: TabId[]): HTMLElement {
        const header = document.createElement('div');
        header.style.cssText = 'display:flex; align-items:center; gap:10px;';

        // ── Selection badge ────────────────────────────────────────────────
        const badge = document.createElement('span');
        badge.style.cssText = 'display:flex; align-items:center; gap:6px; padding-right:8px; border-right:1px solid #334455;';
        const dot = document.createElement('span');
        dot.style.cssText = `
            width:9px; height:9px; border-radius:50%; flex-shrink:0;
            background:${category === 'E' ? '#e5a540' : '#1D9E75'};
            box-shadow: 0 0 6px ${category === 'E' ? '#e5a540' : '#1D9E75'};
        `;
        const label = document.createElement('span');
        label.style.cssText = 'color:#c8dff5; font-weight:600;';
        label.textContent = this._summary(selected, category);
        badge.appendChild(dot);
        badge.appendChild(label);
        header.appendChild(badge);

        // ── Tab pills (only if more than one) ──────────────────────────────
        if (visibleTabs.length > 1) {
            const tabRow = document.createElement('div');
            tabRow.style.cssText = 'display:flex; gap:4px; flex:1;';
            const tabLabels: Record<TabId, string> = {
                transform: 'Transform',
                align: 'Align',
                distribute: 'Distribute',
                arrange: 'Arrange',
            };
            visibleTabs.forEach(tab => {
                const btn = document.createElement('button');
                const isActive = tab === this._activeTab;
                btn.textContent = tabLabels[tab];
                btn.style.cssText = `
                    padding: 4px 10px;
                    font-size: 10.5px;
                    font-family: inherit;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    cursor: pointer;
                    background: ${isActive ? 'rgba(239,159,39,0.12)' : 'transparent'};
                    border: 1px solid ${isActive ? '#EF9F27' : 'rgba(90,140,220,0.25)'};
                    border-radius: 4px;
                    color: ${isActive ? '#EF9F27' : 'rgba(155,180,215,0.72)'};
                    transition: all 0.15s ease;
                `;
                btn.addEventListener('click', () => {
                    this._activeTab = tab;
                    this.refresh();
                });
                tabRow.appendChild(btn);
            });
            header.appendChild(tabRow);
        } else {
            const filler = document.createElement('div');
            filler.style.cssText = 'flex:1;';
            header.appendChild(filler);
        }

        // ── Deselect (✕) ───────────────────────────────────────────────────
        const close = document.createElement('button');
        close.title = 'Clear selection (Esc)';
        close.innerHTML = '✕';
        close.style.cssText = `
            background: transparent;
            border: 1px solid rgba(90,140,220,0.25);
            color: rgba(155,180,215,0.72);
            font-family: inherit;
            font-size: 11px;
            cursor: pointer;
            border-radius: 4px;
            width: 22px; height: 22px;
            display: flex; align-items: center; justify-content: center;
        `;
        close.addEventListener('mouseenter', () => close.style.color = '#f08060');
        close.addEventListener('mouseleave', () => close.style.color = 'rgba(155,180,215,0.72)');
        close.addEventListener('click', () => this._selectionEngine.clearSelection());
        header.appendChild(close);

        return header;
    }

    private _summary(selected: Graphic[], category: Category): string {
        const n = selected.length;
        switch (category) {
            case 'A': return '1 Point';
            case 'B': {
                const t = selected[0].geometry?.type;
                return t === 'polygon' ? '1 Area' : '1 Line';
            }
            case 'C': return `${n} Points`;
            case 'D': {
                const t = selected[0].geometry?.type;
                return t === 'polygon' ? `${n} Areas` : `${n} Lines`;
            }
            case 'E': {
                let pts = 0, areas = 0;
                selected.forEach(g => {
                    if (this._kind(g) === 'point') pts++;
                    else if (this._kind(g) === 'lineArea') areas++;
                });
                return `${n} mixed · ${pts}pt · ${areas}area`;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Action rows
    // -----------------------------------------------------------------------

    private _renderActions(selected: Graphic[], category: Category): HTMLElement {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap; padding-top:4px; border-top:1px solid rgba(80,100,150,0.18);';

        switch (this._activeTab) {
            case 'transform':  this._renderTransformActions(row, selected, category); break;
            case 'align':      this._renderAlignActions(row);                          break;
            case 'distribute': this._renderDistributeActions(row);                     break;
            case 'arrange':    this._renderArrangeActions(row);                        break;
        }

        return row;
    }

    private _renderTransformActions(row: HTMLElement, selected: Graphic[], category: Category): void {
        const primary = selected[0];
        const additional = selected.slice(1);
        const pushUndo = (e: any) => this._cb.pushUndo(e);

        switch (category) {
            case 'A': // Single point
                row.appendChild(this._mkBtn('✎ Move', () => this._editEngine.activate(primary)));
                row.appendChild(this._mkBtn('⎘ Copy', () => this._cb.copySymbol(primary)));
                row.appendChild(this._mkBtn('✕ Delete', () => this._deleteOne(primary), 'danger'));
                row.appendChild(this._mkSimilarBtn(primary));
                row.appendChild(this._mkBtn('⌖ Center', () => this._centerOn(primary)));
                break;

            case 'B': // Single line/area
                row.appendChild(this._mkBtn('✎ Move/Scale/Rotate', () => this._editEngine.activate(primary)));
                row.appendChild(this._mkBtn('↕ Edit Points', () => this._editEngine.activateEditControlPoints(primary)));
                row.appendChild(this._mkBtn('⎘ Copy', () => this._cb.copySymbol(primary)));
                row.appendChild(this._mkBtn('✕ Delete', () => this._deleteOne(primary), 'danger'));
                row.appendChild(this._mkBtn('◍ Within', () => this._selectionEngine.selectWithin(primary, false)));
                row.appendChild(this._mkBtn('◎ Within+Self', () => this._selectionEngine.selectWithin(primary, true)));
                row.appendChild(this._mkSimilarBtn(primary));
                break;

            case 'C': // Multi points
            case 'D': // Multi lines/areas
                row.appendChild(this._mkBtn(`✎ Move/Scale/Rotate (${selected.length})`, () =>
                    this._editEngine.activateMixedEdit(primary, additional)));
                row.appendChild(this._mkBtn(`✣ Move`, () =>
                    this._selectionEngine.moveSelected(({ graphics, dx, dy }) =>
                        pushUndo({
                            label: `Move ${graphics.length} Symbols`,
                            undo: () => this._selectionEngine._applyDelta(graphics, -dx, -dy),
                            redo: () => this._selectionEngine._applyDelta(graphics, dx, dy),
                        }))));
                row.appendChild(this._mkBtn(`✕ Delete (${selected.length})`, () =>
                    this._selectionEngine.deleteSelected((entry) => pushUndo(entry)), 'danger'));
                break;

            case 'E': // Mixed
                row.appendChild(this._mkBtn(`✎ Move/Scale/Rotate (${selected.length})`, () =>
                    this._editEngine.activateMixedEdit(primary, additional)));
                row.appendChild(this._mkBtn(`✣ Move`, () =>
                    this._selectionEngine.moveSelected(({ graphics, dx, dy }) =>
                        pushUndo({
                            label: `Move ${graphics.length} Symbols`,
                            undo: () => this._selectionEngine._applyDelta(graphics, -dx, -dy),
                            redo: () => this._selectionEngine._applyDelta(graphics, dx, dy),
                        }))));
                row.appendChild(this._mkBtn(`✕ Delete (${selected.length})`, () =>
                    this._selectionEngine.deleteSelected((entry) => pushUndo(entry)), 'danger'));
                break;
        }
    }

    private _renderAlignActions(row: HTMLElement): void {
        const pushUndo = (e: any) => this._cb.pushUndo(e);
        row.appendChild(this._mkBtn('← Left',   () => this._selectionEngine.alignLeft(pushUndo)));
        row.appendChild(this._mkBtn('→ Right',  () => this._selectionEngine.alignRight(pushUndo)));
        row.appendChild(this._mkBtn('↑ Top',    () => this._selectionEngine.alignTop(pushUndo)));
        row.appendChild(this._mkBtn('↓ Bottom', () => this._selectionEngine.alignBottom(pushUndo)));
        row.appendChild(this._mkBtn('↕ Center X', () => this._selectionEngine.centerOnX(pushUndo)));
        row.appendChild(this._mkBtn('↔ Center Y', () => this._selectionEngine.centerOnY(pushUndo)));
    }

    private _renderDistributeActions(row: HTMLElement): void {
        const pushUndo = (e: any) => this._cb.pushUndo(e);
        row.appendChild(this._mkBtn('⇔ Horizontal', () => this._selectionEngine.alignHorizontal(pushUndo)));
        row.appendChild(this._mkBtn('↕ Vertical',   () => this._selectionEngine.alignVertical(pushUndo)));
    }

    private _renderArrangeActions(row: HTMLElement): void {
        const pushUndo = (e: any) => this._cb.pushUndo(e);
        row.appendChild(this._mkBtn('― Line',         () => this._selectionEngine.arrangeLine(undefined, pushUndo)));
        row.appendChild(this._mkBtn('| Column',       () => this._selectionEngine.arrangeColumn(undefined, pushUndo)));
        row.appendChild(this._mkBtn('⊞ Square',       () => this._selectionEngine.arrangeSquare(undefined, pushUndo)));
        row.appendChild(this._mkBtn('▲ Triangle',     () => this._selectionEngine.arrangeTriangle(undefined, pushUndo)));
        row.appendChild(this._mkBtn('▽ Inv Triangle', () => this._selectionEngine.arrangeInvertedTriangle(undefined, pushUndo)));
        row.appendChild(this._mkBtn('⋁ Wedge',        () => this._selectionEngine.arrangeWedge(undefined, pushUndo)));
        row.appendChild(this._mkBtn('↙ Echelon L',    () => this._selectionEngine.arrangeEchelonLeft(undefined, pushUndo)));
        row.appendChild(this._mkBtn('↘ Echelon R',    () => this._selectionEngine.arrangeEchelonRight(undefined, pushUndo)));
        row.appendChild(this._mkBtn('◇ Diamond',      () => this._selectionEngine.arrangeDiamond(undefined, pushUndo)));
        row.appendChild(this._mkBtn('○ Circle',       () => this._selectionEngine.arrangeCircle(undefined, pushUndo)));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private _mkBtn(label: string, onClick: () => void, variant: 'default' | 'danger' = 'default'): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        const isDanger = variant === 'danger';
        btn.style.cssText = `
            padding: 5px 10px;
            font-family: inherit;
            font-size: 10.5px;
            letter-spacing: 0.05em;
            font-weight: 600;
            cursor: pointer;
            background: ${isDanger ? 'rgba(220,80,80,0.10)' : 'rgba(0,0,0,0.28)'};
            border: 1px solid ${isDanger ? 'rgba(220,80,80,0.45)' : 'rgba(90,140,220,0.25)'};
            border-radius: 4px;
            color: ${isDanger ? '#f0a0a0' : 'rgba(220,232,245,0.92)'};
            white-space: nowrap;
            transition: all 0.12s ease;
        `;
        btn.addEventListener('mouseenter', () => {
            btn.style.borderColor = isDanger ? 'rgba(220,80,80,0.7)' : '#EF9F27';
            btn.style.background = isDanger ? 'rgba(220,80,80,0.18)' : 'rgba(26,32,48,0.97)';
            btn.style.color = isDanger ? '#fff0f0' : '#dce8f5';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.borderColor = isDanger ? 'rgba(220,80,80,0.45)' : 'rgba(90,140,220,0.25)';
            btn.style.background = isDanger ? 'rgba(220,80,80,0.10)' : 'rgba(0,0,0,0.28)';
            btn.style.color = isDanger ? '#f0a0a0' : 'rgba(220,232,245,0.92)';
        });
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return btn;
    }

    /** "Select Similar ▾" button — opens a small floating popup with 4 options. */
    private _mkSimilarBtn(graphic: Graphic): HTMLButtonElement {
        const btn = this._mkBtn('⌕ Similar ▾', () => this._toggleSimilarPopup(btn, graphic));
        return btn;
    }

    private _toggleSimilarPopup(anchor: HTMLElement, graphic: Graphic): void {
        if (this._similarPopup) {
            this._removeSimilarPopup();
            return;
        }
        const rect = anchor.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.style.cssText = `
            position: fixed;
            left: ${rect.left}px;
            bottom: ${window.innerHeight - rect.top + 4}px;
            background: rgba(20,26,38,0.97);
            border: 1px solid rgba(90,140,220,0.4);
            border-radius: 6px;
            padding: 4px;
            display: flex; flex-direction: column; gap: 2px;
            z-index: 1495;
            box-shadow: 0 4px 14px rgba(0,0,0,0.5);
            min-width: 150px;
        `;
        const items: [string, () => void][] = [
            ['Same SIDC',    () => this._selectionEngine.selectSimilarSameSIDC(graphic)],
            ['Same Echelon', () => this._selectionEngine.selectSimilarSameEchelon(graphic)],
            ['Own Only',     () => this._selectionEngine.selectOwnOnly()],
            ['Enemy',        () => this._selectionEngine.selectEnemy()],
        ];
        items.forEach(([label, action]) => {
            const item = document.createElement('button');
            item.textContent = label;
            item.style.cssText = `
                background: transparent;
                border: none;
                color: rgba(220,232,245,0.92);
                font-family: inherit;
                font-size: 11px;
                text-align: left;
                padding: 6px 10px;
                border-radius: 3px;
                cursor: pointer;
            `;
            item.addEventListener('mouseenter', () => item.style.background = 'rgba(239,159,39,0.12)');
            item.addEventListener('mouseleave', () => item.style.background = 'transparent');
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this._removeSimilarPopup();
                action();
            });
            pop.appendChild(item);
        });
        document.body.appendChild(pop);
        this._similarPopup = pop;

        // Dismiss on outside click
        const onDocClick = (e: MouseEvent) => {
            if (!pop.contains(e.target as Node) && e.target !== anchor) {
                this._removeSimilarPopup();
                document.removeEventListener('click', onDocClick);
            }
        };
        setTimeout(() => document.addEventListener('click', onDocClick), 0);
    }

    private _removeSimilarPopup(): void {
        if (this._similarPopup) {
            this._similarPopup.remove();
            this._similarPopup = null;
        }
    }

    private _deleteOne(graphic: Graphic): void {
        const layer = graphic.layer as any;
        if (!layer) return;
        this._selectionEngine.clearSelection();
        layer.remove(graphic);
        this._cb.pushUndo({
            label: 'Delete Symbol',
            undo: () => layer.add(graphic),
            redo: () => layer.remove(graphic),
        });
    }

    private _centerOn(graphic: Graphic): void {
        const view = this._cb.getView();
        if (!view || !graphic.geometry) return;
        view.goTo({ target: graphic.geometry } as any).catch(() => { /* user-cancelled */ });
    }
}

export default SelectionActionPanel;
