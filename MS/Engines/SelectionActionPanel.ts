import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

import SelectionEngine, { SelectMode } from "./SelectionEngine.ts";
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
    /**
     * Enter Move/Scale/Rotate. Routes through SymbolEngine.modifySymbol so the
     * panel uses the same path as the right-click "Edit → Move, Scale, Rotate"
     * menu — which correctly handles single-point (move+rotate via proxy),
     * single-line/area, and any multi-selection (move+rotate+scale via proxy).
     */
    modifySymbol: (graphic: Graphic) => void;
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

type TabId = 'transform' | 'align' | 'distribute' | 'arrange' | 'filter';

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
    /** Compose mode for the Filter tab — persists across panel rebuilds. */
    private _filterMode: SelectMode = 'replace';
    /** Minimized state — persists across panel rebuilds (selection changes, tab switches). */
    private _minimized = false;
    private _dragAbort: AbortController | null = null;

    /**
     * True once the user has manually dragged the panel for the CURRENT selection.
     * While set, the auto "beside the symbol" placement is suppressed so the user's
     * chosen position wins — reset to false whenever the selection changes.
     */
    private _userMoved = false;
    /** Signature of the last selection, used to detect a genuinely new selection. */
    private _lastSelectionSig: string | null = null;
    /** Watches view pan/zoom so the panel keeps hugging the symbol as it moves. */
    private _viewWatchHandle: { remove(): void } | null = null;
    /** Window-resize handler that re-evaluates placement; removed with the container. */
    private _resizeHandler: (() => void) | null = null;

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
            this._lastSelectionSig = null;
            return;
        }

        const category = this._classify(selected);
        const visibleTabs = this._tabsForCategory(category);
        if (!visibleTabs.includes(this._activeTab)) {
            this._activeTab = visibleTabs[0];
        }

        // A genuinely new selection clears any manual drag offset so the panel
        // re-hugs the symbol; tab/minimize refreshes on the SAME selection keep it.
        const sig = selected.map(g => (g as any).uid ?? g.attributes?.id ?? '').join('|');
        if (sig !== this._lastSelectionSig) {
            this._lastSelectionSig = sig;
            this._userMoved = false;
        }

        this._ensureContainer();
        this._render(selected, category, visibleTabs);

        // Place beside the selection once the DOM is laid out (offsetWidth/Height
        // are valid synchronously here since every style is inline). Skip while the
        // user is manually positioning this selection's panel.
        if (!this._userMoved) {
            this._positionBesideSelection();
        }
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
            case 'B': return ['transform', 'filter'];
            case 'C': return ['transform', 'align', 'distribute', 'arrange', 'filter'];
            case 'D': return ['transform', 'align', 'distribute', 'filter'];
            case 'E': return ['transform', 'align', 'filter'];
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
        this._wireDrag(el);
        this._wireViewFollow();
    }

    private _removeContainer(): void {
        if (this._container) {
            this._dragAbort?.abort();
            this._dragAbort = null;
            this._viewWatchHandle?.remove();
            this._viewWatchHandle = null;
            if (this._resizeHandler) {
                window.removeEventListener('resize', this._resizeHandler);
                this._resizeHandler = null;
            }
            this._container.remove();
            this._container = null;
        }
    }

    /**
     * Keep the panel beside the symbol as the map pans/zooms and on window resize.
     * The getter reads the CURRENT view each evaluation, so it survives a 2D↔3D
     * view swap without needing to be re-wired. Suppressed once the user drags.
     */
    private _wireViewFollow(): void {
        this._viewWatchHandle = reactiveUtils.watch(
            () => (this._cb.getView() as any)?.extent,
            () => {
                if (!this._container || this._userMoved) return;
                if (this._selectionEngine.selectedGraphics.length === 0) return;
                this._positionBesideSelection();
            },
        );

        this._resizeHandler = () => {
            if (!this._container || this._userMoved) return;
            if (this._selectionEngine.selectedGraphics.length === 0) return;
            this._positionBesideSelection();
        };
        window.addEventListener('resize', this._resizeHandler);
    }

    /**
     * Drag by the header (badge/tabs area), same convention as the EditEngine
     * mode banner — mousedown anywhere in `.sap-header` except an actual
     * button/select/input starts a drag. Position is applied as explicit
     * left/top so it survives `_render()` rebuilds (only innerHTML is cleared
     * there, not the container's own style).
     */
    private _wireDrag(container: HTMLElement): void {
        this._dragAbort = new AbortController();
        const signal = this._dragAbort.signal;
        let dragging = false;
        let ox = 0;
        let oy = 0;

        container.addEventListener('mousedown', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('button, select, input, kbd')) return;
            if (!target.closest('.sap-header')) return;
            const rect = container.getBoundingClientRect();
            container.style.left = rect.left + 'px';
            container.style.top = rect.top + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
            container.style.transform = 'none';
            ox = e.clientX - rect.left;
            oy = e.clientY - rect.top;
            dragging = true;
            // The user is taking over placement — stop auto-hugging the symbol
            // until the selection changes.
            this._userMoved = true;
            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        }, { signal });

        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!dragging) return;
            const maxLeft = window.innerWidth - container.offsetWidth - 4;
            const maxTop = window.innerHeight - container.offsetHeight - 4;
            container.style.left = Math.max(0, Math.min(e.clientX - ox, maxLeft)) + 'px';
            container.style.top = Math.max(0, Math.min(e.clientY - oy, maxTop)) + 'px';
        }, { signal });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }, { signal });
    }

    // -----------------------------------------------------------------------
    // Placement — hug the selected symbol without overlapping it
    // -----------------------------------------------------------------------

    /**
     * Position the panel just beside the current selection, choosing the side
     * with the best fit so the panel never covers the symbol.
     *
     * Strategy: compute the selection's screen-space bounding box, then try
     * right → left → bottom → top with a fixed gap. The first side where the
     * panel fits fully inside the viewport (and is therefore clear of the box on
     * that axis) wins; the cross-axis is clamped into view. If no side fits, the
     * side with the most free space is used as a best-effort fallback.
     */
    private _positionBesideSelection(): void {
        const view = this._cb.getView();
        const el = this._container;
        if (!view || !el) return;

        const bounds = this._selectionScreenBounds(view);
        if (!bounds) { this._applyDefaultPosition(); return; }

        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Selection scrolled entirely off-screen → nothing to hug; fall back.
        if (bounds.maxX < 0 || bounds.minX > vw || bounds.maxY < 0 || bounds.minY > vh) {
            this._applyDefaultPosition();
            return;
        }

        const margin = 8;   // keep clear of the viewport edges
        const gap = 14;     // breathing room between symbol and panel
        const pw = el.offsetWidth || 380;
        const ph = el.offsetHeight || 80;
        const midX = (bounds.minX + bounds.maxX) / 2;
        const midY = (bounds.minY + bounds.maxY) / 2;
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

        // Each candidate keeps a `fits` flag (fully on-screen on its main axis, so
        // guaranteed clear of the symbol) and the free space on that side for the
        // fallback ranking.
        const candidates: Array<{ fits: boolean; left: number; top: number; space: number }> = [
            {   // right
                left: bounds.maxX + gap,
                top: clamp(midY - ph / 2, margin, vh - ph - margin),
                fits: bounds.maxX + gap + pw <= vw - margin,
                space: vw - bounds.maxX,
            },
            {   // left
                left: bounds.minX - gap - pw,
                top: clamp(midY - ph / 2, margin, vh - ph - margin),
                fits: bounds.minX - gap - pw >= margin,
                space: bounds.minX,
            },
            {   // bottom
                left: clamp(midX - pw / 2, margin, vw - pw - margin),
                top: bounds.maxY + gap,
                fits: bounds.maxY + gap + ph <= vh - margin,
                space: vh - bounds.maxY,
            },
            {   // top
                left: clamp(midX - pw / 2, margin, vw - pw - margin),
                top: bounds.minY - gap - ph,
                fits: bounds.minY - gap - ph >= margin,
                space: bounds.minY,
            },
        ];

        let chosen = candidates.find(c => c.fits);
        if (!chosen) {
            // Nothing fits cleanly (symbol fills the viewport) — take the roomiest
            // side and clamp both axes; minimal unavoidable overlap.
            const best = candidates.reduce((a, b) => (b.space > a.space ? b : a));
            chosen = {
                fits: false,
                space: best.space,
                left: clamp(best.left, margin, vw - pw - margin),
                top: clamp(best.top, margin, vh - ph - margin),
            };
        }

        el.style.left = `${Math.round(chosen.left)}px`;
        el.style.top = `${Math.round(chosen.top)}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
    }

    /** Restore the original bottom-centre anchor (used when there's nothing to hug). */
    private _applyDefaultPosition(): void {
        const el = this._container;
        if (!el) return;
        el.style.left = '50%';
        el.style.top = 'auto';
        el.style.right = 'auto';
        el.style.bottom = '70px';
        el.style.transform = 'translateX(-50%)';
    }

    /**
     * Union of the selected graphics' screen-space bounds (pixels, viewport
     * origin). Points map directly via `toScreen`; lines/areas sample their
     * extent corners + centre. Returns null if nothing projects (e.g. all behind
     * the 3D camera).
     */
    private _selectionScreenBounds(
        view: MapView | SceneView,
    ): { minX: number; minY: number; maxX: number; maxY: number } | null {
        const selected = this._selectionEngine.selectedGraphics;
        if (!selected.length) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let any = false;
        const add = (sp: { x: number; y: number } | null | undefined) => {
            if (!sp) return;
            any = true;
            if (sp.x < minX) minX = sp.x;
            if (sp.y < minY) minY = sp.y;
            if (sp.x > maxX) maxX = sp.x;
            if (sp.y > maxY) maxY = sp.y;
        };

        for (const g of selected) {
            const geom: any = g.geometry;
            if (!geom) continue;
            if (geom.type === 'point') {
                add(view.toScreen(geom));
            } else if (geom.extent) {
                const ext = geom.extent;
                const sr = ext.spatialReference;
                add(view.toScreen(new Point({ x: ext.xmin, y: ext.ymin, spatialReference: sr })));
                add(view.toScreen(new Point({ x: ext.xmin, y: ext.ymax, spatialReference: sr })));
                add(view.toScreen(new Point({ x: ext.xmax, y: ext.ymin, spatialReference: sr })));
                add(view.toScreen(new Point({ x: ext.xmax, y: ext.ymax, spatialReference: sr })));
                if (ext.center) add(view.toScreen(ext.center));
            }
        }

        return any ? { minX, minY, maxX, maxY } : null;
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    private _render(selected: Graphic[], category: Category, visibleTabs: TabId[]): void {
        if (!this._container) return;
        this._container.innerHTML = '';
        this._container.style.minWidth = this._minimized ? '0' : '380px';

        this._container.appendChild(this._renderHeader(selected, category, visibleTabs));
        if (!this._minimized) {
            this._container.appendChild(this._renderActions(selected, category));
        }
    }

    private _renderHeader(selected: Graphic[], category: Category, visibleTabs: TabId[]): HTMLElement {
        const header = document.createElement('div');
        header.className = 'sap-header';
        header.style.cssText = 'display:flex; align-items:center; gap:10px; cursor:grab;';

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

        // ── Tab pills (only if more than one, and not minimized) ───────────
        if (!this._minimized && visibleTabs.length > 1) {
            const tabRow = document.createElement('div');
            tabRow.style.cssText = 'display:flex; gap:4px; flex:1;';
            const tabLabels: Record<TabId, string> = {
                transform: 'Transform',
                align: 'Align',
                distribute: 'Distribute',
                arrange: 'Arrange',
                filter: 'Filter',
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

        // ── Minimize / Restore ──────────────────────────────────────────────
        const minBtn = this._mkIconBtn(this._minimized ? '▢' : '−', this._minimized ? 'Restore' : 'Minimize', () => {
            this._minimized = !this._minimized;
            this.refresh();
        });
        header.appendChild(minBtn);

        // ── Deselect (✕) ───────────────────────────────────────────────────
        const close = this._mkIconBtn('✕', 'Clear selection (Esc)', () => this._selectionEngine.clearSelection(), '#f08060');
        header.appendChild(close);

        return header;
    }

    /** Small square icon button used for the header's minimize/close controls. */
    private _mkIconBtn(icon: string, title: string, onClick: () => void, hoverColor = '#EF9F27'): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.title = title;
        btn.innerHTML = icon;
        btn.style.cssText = `
            background: transparent;
            border: 1px solid rgba(90,140,220,0.25);
            color: rgba(155,180,215,0.72);
            font-family: inherit;
            font-size: 11px;
            cursor: pointer;
            border-radius: 4px;
            width: 22px; height: 22px;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
        `;
        btn.addEventListener('mouseenter', () => btn.style.color = hoverColor);
        btn.addEventListener('mouseleave', () => btn.style.color = 'rgba(155,180,215,0.72)');
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return btn;
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
            case 'filter':     this._renderFilterActions(row, selected);              break;
        }

        return row;
    }

    private _renderTransformActions(row: HTMLElement, selected: Graphic[], category: Category): void {
        const primary = selected[0];
        const pushUndo = (e: any) => this._cb.pushUndo(e);

        switch (category) {
            case 'A': // Single point — move + rotate (scaling auto-suppressed for lone points)
                row.appendChild(this._mkBtn('✎ Move, Rotate', () => this._cb.modifySymbol(primary)));
                row.appendChild(this._mkBtn('⎘ Copy', () => this._cb.copySymbol(primary)));
                row.appendChild(this._mkBtn('✕ Delete', () => this._deleteOne(primary), 'danger'));
                row.appendChild(this._mkSimilarBtn(primary));
                row.appendChild(this._mkBtn('⌖ Center', () => this._centerOn(primary)));
                break;

            case 'B': // Single line/area
                row.appendChild(this._mkBtn('✎ Move, Scale, Rotate', () => this._cb.modifySymbol(primary)));
                row.appendChild(this._mkBtn('↕ Edit Points', () => this._editEngine.activateEditControlPoints(primary)));
                row.appendChild(this._mkBtn('⎘ Copy', () => this._cb.copySymbol(primary)));
                row.appendChild(this._mkBtn('✕ Delete', () => this._deleteOne(primary), 'danger'));
                row.appendChild(this._mkBtn('◍ Within', () => this._selectionEngine.selectWithin(primary, false)));
                row.appendChild(this._mkBtn('◎ Within+Self', () => this._selectionEngine.selectWithin(primary, true)));
                row.appendChild(this._mkSimilarBtn(primary));
                break;

            case 'C': // Multi points
            case 'D': // Multi lines/areas
                row.appendChild(this._mkBtn(`✎ Move, Scale, Rotate (${selected.length})`, () =>
                    this._cb.modifySymbol(primary)));
                row.appendChild(this._mkBtn(`✕ Delete (${selected.length})`, () =>
                    this._selectionEngine.deleteSelected((entry) => pushUndo(entry)), 'danger'));
                break;

            case 'E': // Mixed
                row.appendChild(this._mkBtn(`✎ Move, Scale, Rotate (${selected.length})`, () =>
                    this._cb.modifySymbol(primary)));
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

    /**
     * Filter tab — refine / extend / replace the selection by criteria.
     * The mode switch (Replace / Add / Refine) persists on the panel; every
     * button below calls the matching SelectionEngine method with that mode.
     */
    private _renderFilterActions(row: HTMLElement, selected: Graphic[]): void {
        const se = this._selectionEngine;

        // ── Mode switch ────────────────────────────────────────────────────
        const modeWrap = document.createElement('div');
        modeWrap.style.cssText = 'display:flex; align-items:center; gap:4px; margin-right:6px;';
        const modeLbl = document.createElement('span');
        modeLbl.textContent = 'Mode:';
        modeLbl.style.cssText = 'font-size:10px; color:rgba(155,180,215,0.7); text-transform:uppercase; letter-spacing:0.05em;';
        modeWrap.appendChild(modeLbl);
        (['replace', 'add', 'refine'] as SelectMode[]).forEach(m => {
            const active = this._filterMode === m;
            const b = document.createElement('button');
            b.textContent = m.charAt(0).toUpperCase() + m.slice(1);
            b.style.cssText = `
                padding:4px 8px; font-size:10px; font-family:inherit; font-weight:600;
                text-transform:uppercase; letter-spacing:0.04em; cursor:pointer; border-radius:4px;
                background:${active ? 'rgba(239,159,39,0.14)' : 'transparent'};
                border:1px solid ${active ? '#EF9F27' : 'rgba(90,140,220,0.25)'};
                color:${active ? '#EF9F27' : 'rgba(155,180,215,0.72)'};
            `;
            b.addEventListener('click', (e) => { e.stopPropagation(); this._filterMode = m; this.refresh(); });
            modeWrap.appendChild(b);
        });
        row.appendChild(modeWrap);

        // ── Quick actions ──────────────────────────────────────────────────
        row.appendChild(this._mkBtn('▦ All',    () => se.selectAll(this._filterMode)));
        row.appendChild(this._mkBtn('◑ Invert', () => se.invertSelection()));

        // ── Affiliation / echelon dropdowns (present codes only) ───────────
        const ids = se.getPresentIdentities();
        if (ids.length) {
            row.appendChild(this._mkSelect('Affiliation…',
                ids.map(i => [i.code, `${i.label} (${i.count})`] as [string, string]),
                code => se.selectByIdentity(code, this._filterMode)));
        }
        const ech = se.getPresentEchelons();
        if (ech.length) {
            row.appendChild(this._mkSelect('Echelon…',
                ech.map(e => [e.code, `${e.label} (${e.count})`] as [string, string]),
                code => se.selectByEchelon(code, this._filterMode)));
        }

        // ── Geometry ───────────────────────────────────────────────────────
        row.appendChild(this._mkBtn('● Points', () => se.selectPointSymbols(this._filterMode)));
        row.appendChild(this._mkBtn('╱ Lines',  () => se.selectLineSymbols(this._filterMode)));
        row.appendChild(this._mkBtn('■ Areas',  () => se.selectAreaSymbols(this._filterMode)));

        // ── Within radius of the first selected graphic ────────────────────
        const radiusWrap = document.createElement('div');
        radiusWrap.style.cssText = 'display:flex; align-items:center; gap:4px;';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.value = '1000';
        input.title = 'Radius in metres (from the first selected symbol)';
        input.style.cssText = `
            width:64px; padding:4px 6px; font-family:inherit; font-size:10.5px;
            background:rgba(0,0,0,0.3); color:rgba(220,232,245,0.92);
            border:1px solid rgba(90,140,220,0.25); border-radius:4px;
        `;
        input.addEventListener('click', e => e.stopPropagation());
        radiusWrap.appendChild(input);
        radiusWrap.appendChild(this._mkBtn('◌ Within Radius (m)', () => {
            const meters = parseFloat(input.value);
            if (meters > 0 && selected[0]) se.selectWithinRadius(selected[0], meters, this._filterMode);
        }));
        row.appendChild(radiusWrap);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Small <select> styled for the panel; calls `onPick(code)` on change. */
    private _mkSelect(placeholder: string, options: [string, string][], onPick: (code: string) => void): HTMLSelectElement {
        const sel = document.createElement('select');
        sel.style.cssText = `
            padding:4px 6px; font-family:inherit; font-size:10.5px; cursor:pointer;
            background:rgba(0,0,0,0.3); color:rgba(220,232,245,0.92);
            border:1px solid rgba(90,140,220,0.25); border-radius:4px;
        `;
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = placeholder; ph.disabled = true; ph.selected = true;
        sel.appendChild(ph);
        options.forEach(([value, label]) => {
            const o = document.createElement('option');
            o.value = value; o.textContent = label;
            sel.appendChild(o);
        });
        sel.addEventListener('click', e => e.stopPropagation());
        sel.addEventListener('change', () => { if (sel.value) onPick(sel.value); });
        return sel;
    }

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
        // Delegate to SelectionEngine so the symbol's AnnotationEngine labels are
        // removed with it (and re-created on undo) — same behaviour as the
        // context-menu delete path (SymbolEngine.removeGraphic). SelectionEngine
        // resolves the layer robustly (ArcGIS 5.0 leaves origin.layer unset for
        // plain graphics added to a GraphicsLayer).
        this._selectionEngine.deleteGraphic(graphic, (entry) => this._cb.pushUndo(entry));
    }

    private _centerOn(graphic: Graphic): void {
        const view = this._cb.getView();
        if (!view || !graphic.geometry) return;
        view.goTo({ target: graphic.geometry } as any).catch(() => { /* user-cancelled */ });
    }
}

export default SelectionActionPanel;
