# Threat Sector Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the threat-sector tool a floating, draggable control panel (modelled on the Bearing Compass Panel) for drawing, listing, recoloring, and editing threat sectors.

**Architecture:** Upgrade `VisualizationEngine` to track sector *instances* (id + geometry + appearance) with create/update/remove/list APIs and in-memory appearance defaults; add a dedicated self-hosted `SectorPanel` UI class (compass-widget shape); wire `openSectorPanel()` through `SymbolEngine` and surface it from 5 entry points. State is in-memory.

**Tech Stack:** TypeScript, `@arcgis/core` 5.0.19 (ES module), Vite. No test runner in this repo.

> **Verification approach (deliberate deviation from TDD):** This codebase has **no unit-test runner** — its test surface is the manual `src/main.ts` + `index.html` harness, and it ships via Vite (type-check is advisory; `tsc` has a pre-existing error baseline — filter to changed files). So each code task is verified with a **filtered `tsc` compile** (no *new* errors in touched files), and **functional behavior is verified manually** in `npm run dev` at the end (Task 7). The user runs the dev server themselves — do **not** start it for them.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `MS/Engines/Visualization/VisualizationEngine.ts` | Sector geometry/render + instance model + appearance defaults + change-notifier | Modify |
| `MS/Engines/Visualization/SectorPanel.ts` | Self-hosted draggable panel UI (DOM only; talks to the engine API) | **Create** |
| `MS/Engines/SymbolEngine.ts` | Instantiate + own the panel; `openSectorPanel()`/`closeSectorPanel()`; route view switch; link to context menu | Modify |
| `MS/Managers/ContextMenuManager.ts` | "Threat Sector Panel" entry in the More Actions palette | Modify |
| `MS/Engines/VisualizationSettingsManifest.ts` | Ctrl+K / ⚙ Settings menu action to open the panel | Modify |
| `index.html` | Button in the Visualization feature settings panel | Modify |
| `src/main.ts` | Wire the settings-panel button click → `openSectorPanel()` | Modify |

`SectorDrawTool.ts` is **not** modified: its commit calls `showSector()`, which now delegates to `createSector()`, so click-drawn sectors become tracked instances automatically.

---

## Task 1: Sector instance model in VisualizationEngine

**Files:**
- Modify: `MS/Engines/Visualization/VisualizationEngine.ts` (replace `showSector`/`clearSectors` at `:978-1018`; add types/fields/methods)

All imports needed (`Point`, `Polygon`, `Graphic`, `Color`, `SimpleFillSymbol`, `SimpleLineSymbol`, `buildSectorRing`, `VIZ_TAG`) already exist in this file — the current `showSector` uses them. No new imports.

- [ ] **Step 1: Add the public types** near the other exported interfaces at the top of the file (after the existing imports / type block).

```ts
/** Options accepted when creating a threat sector. `opacity` is a back-compat alias for `fillOpacity`. */
export interface SectorOptions {
  rangeKm: number;
  azStartDeg: number;
  azEndDeg: number;
  color?: [number, number, number];
  fillOpacity?: number;
  opacity?: number;
  outlineOpacity?: number;
  outlineWidth?: number;
  label?: string;
}

/** Read-only snapshot of a tracked sector, for the panel UI. */
export interface SectorListItem {
  id: string;
  label: string;
  rangeKm: number;
  azStartDeg: number;
  azEndDeg: number;
  color: [number, number, number];
  fillOpacity: number;
  outlineOpacity: number;
  outlineWidth: number;
}
```

- [ ] **Step 2: Add private interface + instance fields** inside the `VisualizationEngine` class, next to its other private fields.

```ts
  // ── Threat sector instances + in-memory appearance defaults ────────────────
  private _sectors: Array<{
    id: string;
    center: Point;
    rangeKm: number;
    azStartDeg: number;
    azEndDeg: number;
    color: [number, number, number];
    fillOpacity: number;
    outlineOpacity: number;
    outlineWidth: number;
    label: string;
    graphic: Graphic;
  }> = [];
  private _sectorSeq = 0;
  private _sectorDefaultColor: [number, number, number] = [220, 50, 50];
  private _sectorDefaultFillOpacity = 0.30;
  private _sectorDefaultOutlineOpacity = 0.85;
  private _sectorDefaultOutlineWidth = 1.5;
  private _onSectorsChanged: (() => void) | null = null;
```

- [ ] **Step 3: Replace `showSector` and `clearSectors`** (current bodies at `:978-1018`) with the wrapper + the new instance API. Delete the old `showSector` and `clearSectors`, paste this in their place:

```ts
  /**
   * Draw a geodesic engagement/threat sector (wedge) centered on a point and
   * track it as an editable instance. Sweeps CLOCKWISE from azStartDeg to azEndDeg.
   * Returns the new sector's id, or "" if the inputs are invalid/degenerate.
   */
  public createSector(center: Point | Graphic, opts: SectorOptions): string {
    if (!this._vizLayer) return "";
    const pt = ("geometry" in center ? center.geometry : center) as Point | null;
    if (!pt || pt.type !== "point") return "";
    if (!(opts.rangeKm > 0)) return "";
    if (((opts.azEndDeg - opts.azStartDeg) % 360 + 360) % 360 === 0) return ""; // degenerate

    const color          = opts.color          ?? this._sectorDefaultColor;
    const fillOpacity    = opts.fillOpacity    ?? opts.opacity ?? this._sectorDefaultFillOpacity;
    const outlineOpacity = opts.outlineOpacity ?? this._sectorDefaultOutlineOpacity;
    const outlineWidth   = opts.outlineWidth   ?? this._sectorDefaultOutlineWidth;

    const id    = `sector_${++this._sectorSeq}`;
    const label = opts.label ?? `Sector ${this._sectorSeq}`;
    const graphic = new Graphic({
      geometry: this._buildSectorPolygon(pt, opts.rangeKm, opts.azStartDeg, opts.azEndDeg),
      symbol:   this._makeSectorSymbol(color, fillOpacity, outlineOpacity, outlineWidth),
      attributes: { [VIZ_TAG]: "sector", sectorId: id },
    });
    this._vizLayer.add(graphic);
    this._sectors.push({
      id, center: pt.clone(), rangeKm: opts.rangeKm, azStartDeg: opts.azStartDeg, azEndDeg: opts.azEndDeg,
      color, fillOpacity, outlineOpacity, outlineWidth, label, graphic,
    });
    this._emitSectorsChanged();
    return id;
  }

  /**
   * Back-compat wrapper kept for existing callers (SectorDrawTool, SymbolEngine
   * API passthrough). Delegates to createSector so drawn sectors are tracked.
   */
  public showSector(
    center: Point | Graphic,
    opts: { rangeKm: number; azStartDeg: number; azEndDeg: number; color?: [number, number, number]; opacity?: number },
  ): void {
    this.createSector(center, opts);
  }

  /** Patch a sector's geometry and/or appearance in place. */
  public updateSector(id: string, patch: Partial<Omit<SectorListItem, "id">>): void {
    const s = this._sectors.find(x => x.id === id);
    if (!s || !this._vizLayer) return;
    if (patch.rangeKm        !== undefined && patch.rangeKm > 0) s.rangeKm = patch.rangeKm;
    if (patch.azStartDeg     !== undefined) s.azStartDeg     = patch.azStartDeg;
    if (patch.azEndDeg       !== undefined) s.azEndDeg       = patch.azEndDeg;
    if (patch.color          !== undefined) s.color          = patch.color;
    if (patch.fillOpacity    !== undefined) s.fillOpacity    = patch.fillOpacity;
    if (patch.outlineOpacity !== undefined) s.outlineOpacity = patch.outlineOpacity;
    if (patch.outlineWidth   !== undefined) s.outlineWidth   = patch.outlineWidth;
    if (patch.label          !== undefined) s.label          = patch.label;
    s.graphic.geometry = this._buildSectorPolygon(s.center, s.rangeKm, s.azStartDeg, s.azEndDeg);
    s.graphic.symbol   = this._makeSectorSymbol(s.color, s.fillOpacity, s.outlineOpacity, s.outlineWidth);
    this._emitSectorsChanged();
  }

  /** Remove a single tracked sector by id. */
  public removeSector(id: string): void {
    const idx = this._sectors.findIndex(x => x.id === id);
    if (idx < 0) return;
    if (this._vizLayer) this._vizLayer.remove(this._sectors[idx].graphic);
    this._sectors.splice(idx, 1);
    this._emitSectorsChanged();
  }

  /** Snapshot of all tracked sectors (for the panel). */
  public listSectors(): SectorListItem[] {
    return this._sectors.map(s => ({
      id: s.id, label: s.label, rangeKm: s.rangeKm, azStartDeg: s.azStartDeg, azEndDeg: s.azEndDeg,
      color: s.color, fillOpacity: s.fillOpacity, outlineOpacity: s.outlineOpacity, outlineWidth: s.outlineWidth,
    }));
  }

  /** Current in-memory default appearance applied to new sectors. */
  public getSectorDefaults(): { color: [number, number, number]; fillOpacity: number; outlineOpacity: number; outlineWidth: number } {
    return {
      color: this._sectorDefaultColor,
      fillOpacity: this._sectorDefaultFillOpacity,
      outlineOpacity: this._sectorDefaultOutlineOpacity,
      outlineWidth: this._sectorDefaultOutlineWidth,
    };
  }

  /** Update the in-memory default appearance for subsequently created sectors. */
  public setSectorDefaults(patch: { color?: [number, number, number]; fillOpacity?: number; outlineOpacity?: number; outlineWidth?: number }): void {
    if (patch.color          !== undefined) this._sectorDefaultColor          = patch.color;
    if (patch.fillOpacity    !== undefined) this._sectorDefaultFillOpacity    = patch.fillOpacity;
    if (patch.outlineOpacity !== undefined) this._sectorDefaultOutlineOpacity = patch.outlineOpacity;
    if (patch.outlineWidth   !== undefined) this._sectorDefaultOutlineWidth   = patch.outlineWidth;
  }

  /** Register (or clear with null) a callback fired when the sector set changes. */
  public setSectorsChangedHandler(cb: (() => void) | null): void { this._onSectorsChanged = cb; }

  /** Remove all sector overlays (committed instances + transient preview). */
  public clearSectors(): void {
    if (this._vizLayer) {
      this._vizLayer.graphics
        .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "sector" || g.attributes?.[VIZ_TAG] === "sector-preview")
        .toArray()
        .forEach((g: Graphic) => this._vizLayer!.remove(g));
    }
    this._sectors = [];
    this._emitSectorsChanged();
  }

  private _buildSectorPolygon(center: Point, rangeKm: number, azStartDeg: number, azEndDeg: number): Polygon {
    const ring = buildSectorRing(center.longitude as number, center.latitude as number, rangeKm, azStartDeg, azEndDeg);
    return new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
  }

  private _makeSectorSymbol(color: [number, number, number], fillOpacity: number, outlineOpacity: number, outlineWidth: number): SimpleFillSymbol {
    const [r, g, b] = color;
    return new SimpleFillSymbol({
      color: new Color([r, g, b, fillOpacity]),
      outline: new SimpleLineSymbol({ color: new Color([r, g, b, outlineOpacity]), width: outlineWidth, style: "solid" }),
    });
  }

  private _emitSectorsChanged(): void { try { this._onSectorsChanged?.(); } catch { /* ignore */ } }
```

Note: `renderSectorPreview` / `clearSectorPreview` (the transient draw preview, currently just below) are **left unchanged**.

- [ ] **Step 2 verification: filtered compile** (PowerShell):

Run: `npx tsc -p tsconfig.build.json --noEmit 2>&1 | Select-String -Pattern "VisualizationEngine"`
Expected: no output (no new errors in this file). Bash equivalent: `... | grep VisualizationEngine || echo OK`.

- [ ] **Step 3: Commit**

```bash
git add MS/Engines/Visualization/VisualizationEngine.ts
git commit -m "feat(viz): track threat sectors as editable instances + appearance defaults

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create the SectorPanel UI class

**Files:**
- Create: `MS/Engines/Visualization/SectorPanel.ts`

Self-hosted, draggable panel following the `MagneticCompass` widget chrome (fixed-position div appended to `body`, header drag via document `mousemove`/`mouseup`, scoped injected `<style>`). It only touches the DOM and the `VisualizationEngine` sector API + a `beginDraw` callback.

- [ ] **Step 1: Write the full file**

```ts
import type MapView from "@arcgis/core/views/MapView";
import type SceneView from "@arcgis/core/views/SceneView";
import type Point from "@arcgis/core/geometry/Point";
import type VisualizationEngine from "./VisualizationEngine";

const PANEL_ID = "ts-widget";
const STYLE_ID = "ts-styles";

/**
 * Floating, draggable management panel for threat sectors — modelled on the
 * Bearing Compass Panel (MagneticCompass widget). Draw / numeric-create / list /
 * recolor / edit / remove, plus default-appearance controls. In-memory only.
 */
export default class SectorPanel {
  private _widget: HTMLElement | null = null;
  private _open = false;
  private _onDocMouseMove: ((e: MouseEvent) => void) | null = null;
  private _onDocMouseUp: ((e: MouseEvent) => void) | null = null;

  constructor(
    private _getView: () => MapView | SceneView | null,
    private _viz: VisualizationEngine,
    private _beginDraw: () => void,
  ) {}

  public openPanel(): void {
    this._injectStyles();
    if (!this._widget) this._createWidget();
    if (this._widget) { this._widget.style.display = "block"; this._open = true; }
    this._viz.setSectorsChangedHandler(() => this._update());
    this._update();
  }

  public closePanel(): void {
    if (this._widget) this._widget.style.display = "none";
    this._open = false;
    this._viz.setSectorsChangedHandler(null);
  }

  public onViewChanged(_view: MapView | SceneView): void {
    if (this._open) this._update();
  }

  public destroy(): void {
    if (this._onDocMouseMove) document.removeEventListener("mousemove", this._onDocMouseMove);
    if (this._onDocMouseUp)   document.removeEventListener("mouseup", this._onDocMouseUp);
    this._onDocMouseMove = null;
    this._onDocMouseUp = null;
    this._widget?.remove();
    this._widget = null;
    document.getElementById(STYLE_ID)?.remove();
    this._viz.setSectorsChangedHandler(null);
    this._open = false;
  }

  // ── DOM build ───────────────────────────────────────────────────────────────
  private _createWidget(): void {
    const el = document.createElement("div");
    el.id = PANEL_ID;
    el.innerHTML = this._html();
    document.body.appendChild(el);
    this._widget = el;
    this._bindEvents();
  }

  private _html(): string {
    const d = this._viz.getSectorDefaults();
    return `
<div class="ts-panel">
  <div class="ts-header" id="ts-header">
    <span class="ts-title">🎯 Threat Sectors</span>
    <button class="ts-close" id="ts-close" title="Close">✕</button>
  </div>
  <div class="ts-body">
    <div class="ts-section">
      <div class="ts-row">
        <button class="ts-btn ts-btn-add" id="ts-draw" title="Click the map: center → range → sweep">✎ Draw Sector</button>
        <button class="ts-btn ts-btn-danger" id="ts-clear" title="Remove all sectors">Clear All</button>
      </div>
    </div>

    <div class="ts-section">
      <div class="ts-section-title">CREATE BY NUMBERS (at map center)</div>
      <div class="ts-row"><label>Range km</label><input type="number" id="ts-range" value="5" min="0.1" step="0.1" style="width:64px"/></div>
      <div class="ts-row"><label>Start °</label><input type="number" id="ts-start" value="0" min="0" max="360" step="1" style="width:64px"/></div>
      <div class="ts-row"><label>End °</label><input type="number" id="ts-end" value="90" min="0" max="360" step="1" style="width:64px"/></div>
      <div class="ts-row"><button class="ts-btn ts-btn-add" id="ts-add" style="flex:1">＋ Add Sector</button></div>
    </div>

    <div class="ts-section">
      <div class="ts-section-title">DEFAULT APPEARANCE</div>
      <div class="ts-row"><label>Color</label><input type="color" id="ts-color" value="${this._rgb2hex(d.color)}" style="width:44px;height:22px;padding:1px"/></div>
      <div class="ts-row"><label>Fill</label><input type="range" id="ts-fill" min="0" max="1" step="0.05" value="${d.fillOpacity}" style="width:80px"/><span class="ts-val" id="ts-fill-val">${d.fillOpacity.toFixed(2)}</span></div>
      <div class="ts-row"><label>Outline</label><input type="range" id="ts-out" min="0" max="1" step="0.05" value="${d.outlineOpacity}" style="width:80px"/><span class="ts-val" id="ts-out-val">${d.outlineOpacity.toFixed(2)}</span></div>
      <div class="ts-row"><label>Width</label><input type="number" id="ts-width" value="${d.outlineWidth}" min="0.5" max="6" step="0.5" style="width:64px"/></div>
    </div>

    <div class="ts-section">
      <div class="ts-section-title">SECTORS</div>
      <div id="ts-list" class="ts-list"><div class="ts-empty" id="ts-empty">No sectors yet — draw or add one</div></div>
    </div>
  </div>
</div>`;
  }

  private _bindEvents(): void {
    if (!this._widget) return;
    const w = this._widget;
    const q = <T extends HTMLElement>(id: string) => w.querySelector<T>(`#${id}`);

    q("ts-close")?.addEventListener("click", () => this.closePanel());

    // Header drag-to-move (mirrors MagneticCompass)
    const header = q<HTMLElement>("ts-header")!;
    let dx = 0, dy = 0, dragging = false;
    header.addEventListener("mousedown", (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("#ts-close")) return;
      dragging = true;
      const r = w.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      w.style.left = r.left + "px";
      w.style.top  = r.top + "px";
      w.style.right = "auto";
      e.preventDefault();
    });
    if (this._onDocMouseMove) document.removeEventListener("mousemove", this._onDocMouseMove);
    if (this._onDocMouseUp)   document.removeEventListener("mouseup", this._onDocMouseUp);
    this._onDocMouseMove = (e: MouseEvent) => {
      if (!dragging || !this._widget) return;
      this._widget.style.left = (e.clientX - dx) + "px";
      this._widget.style.top  = (e.clientY - dy) + "px";
    };
    this._onDocMouseUp = () => { dragging = false; };
    document.addEventListener("mousemove", this._onDocMouseMove);
    document.addEventListener("mouseup", this._onDocMouseUp);

    // Draw / clear
    q("ts-draw")?.addEventListener("click", () => this._beginDraw());
    q("ts-clear")?.addEventListener("click", () => this._viz.clearSectors());

    // Numeric add at current map center
    q("ts-add")?.addEventListener("click", () => {
      const center = this._getView()?.center as Point | undefined;
      if (!center) return;
      this._viz.createSector(center, {
        rangeKm:    parseFloat(q<HTMLInputElement>("ts-range")!.value),
        azStartDeg: parseFloat(q<HTMLInputElement>("ts-start")!.value),
        azEndDeg:   parseFloat(q<HTMLInputElement>("ts-end")!.value),
      });
    });

    // Default appearance
    const fill = q<HTMLInputElement>("ts-fill")!;
    const out  = q<HTMLInputElement>("ts-out")!;
    fill.addEventListener("input", () => { q("ts-fill-val")!.textContent = parseFloat(fill.value).toFixed(2); });
    out.addEventListener("input",  () => { q("ts-out-val")!.textContent  = parseFloat(out.value).toFixed(2); });
    const pushDefaults = () => this._viz.setSectorDefaults({
      color:          this._hex2rgb(q<HTMLInputElement>("ts-color")!.value),
      fillOpacity:    parseFloat(fill.value),
      outlineOpacity: parseFloat(out.value),
      outlineWidth:   parseFloat(q<HTMLInputElement>("ts-width")!.value),
    });
    q("ts-color")?.addEventListener("change", pushDefaults);
    fill.addEventListener("change", pushDefaults);
    out.addEventListener("change", pushDefaults);
    q("ts-width")?.addEventListener("change", pushDefaults);
  }

  // ── List rendering ────────────────────────────────────────────────────────
  private _update(): void {
    if (!this._widget) return;
    const listEl  = this._widget.querySelector("#ts-list") as HTMLElement;
    const emptyEl = this._widget.querySelector("#ts-empty") as HTMLElement;
    if (!listEl) return;
    listEl.querySelectorAll(".ts-item").forEach(el => el.remove());

    const sectors = this._viz.listSectors();
    if (emptyEl) emptyEl.style.display = sectors.length ? "none" : "";

    for (const s of sectors) {
      const row = document.createElement("div");
      row.className = "ts-item";
      row.innerHTML = `
        <div class="ts-item-head">
          <input type="color" class="ts-i-color" value="${this._rgb2hex(s.color)}" title="Sector color"/>
          <span class="ts-i-label" title="${s.label}">${s.label}</span>
          <button class="ts-i-del" title="Remove sector">✕</button>
        </div>
        <div class="ts-item-row">
          <label>R</label><input type="number" class="ts-i-range" value="${s.rangeKm}" min="0.1" step="0.1"/>
          <label>S</label><input type="number" class="ts-i-start" value="${s.azStartDeg}" min="0" max="360" step="1"/>
          <label>E</label><input type="number" class="ts-i-end" value="${s.azEndDeg}" min="0" max="360" step="1"/>
        </div>`;
      const color = row.querySelector(".ts-i-color") as HTMLInputElement;
      const del   = row.querySelector(".ts-i-del")   as HTMLElement;
      const range = row.querySelector(".ts-i-range") as HTMLInputElement;
      const start = row.querySelector(".ts-i-start") as HTMLInputElement;
      const end   = row.querySelector(".ts-i-end")   as HTMLInputElement;
      color.addEventListener("change", () => this._viz.updateSector(s.id, { color: this._hex2rgb(color.value) }));
      del.addEventListener("click", () => this._viz.removeSector(s.id));
      const applyGeom = () => this._viz.updateSector(s.id, {
        rangeKm: parseFloat(range.value), azStartDeg: parseFloat(start.value), azEndDeg: parseFloat(end.value),
      });
      range.addEventListener("change", applyGeom);
      start.addEventListener("change", applyGeom);
      end.addEventListener("change", applyGeom);
      listEl.appendChild(row);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  private _rgb2hex(c: [number, number, number]): string {
    const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
  }

  private _hex2rgb(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return [220, 50, 50];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  private _injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} { position: fixed; top: 70px; right: 14px; z-index: 1100; width: 240px;
        font-family: var(--ms-font, 'Inter', sans-serif); font-size: var(--ms-fs, 12px); }
      #${PANEL_ID} .ts-panel { background: var(--ms-bg, #15181d); border: 1px solid rgba(220,80,80,0.35);
        border-radius: var(--ms-radius, 8px); box-shadow: var(--ms-shadow, 0 8px 28px rgba(0,0,0,0.5)); overflow: hidden; }
      #${PANEL_ID} .ts-header { display:flex; align-items:center; justify-content:space-between; padding:9px 11px;
        background: var(--ms-bg-header, rgba(220,80,80,0.12)); border-bottom:1px solid rgba(220,80,80,0.3); cursor:move; user-select:none; }
      #${PANEL_ID} .ts-title { font-weight:700; color:#e57373; letter-spacing:0.3px; }
      #${PANEL_ID} .ts-close { background:none; border:none; color:#e57373; cursor:pointer; font-size:13px; line-height:1; }
      #${PANEL_ID} .ts-body { padding:8px 11px 11px; max-height:70vh; overflow-y:auto; }
      #${PANEL_ID} .ts-section { margin-top:9px; }
      #${PANEL_ID} .ts-section-title { font-size:10px; letter-spacing:0.5px; color:var(--ms-fg-dim,#8a93a0); margin-bottom:5px; }
      #${PANEL_ID} .ts-row { display:flex; align-items:center; gap:7px; margin:4px 0; }
      #${PANEL_ID} .ts-row > label { flex:1; color:var(--ms-fg,#c9d1d9); }
      #${PANEL_ID} .ts-val { min-width:30px; text-align:right; color:var(--ms-fg-dim,#8a93a0); }
      #${PANEL_ID} .ts-btn { flex:1; padding:6px 8px; background:var(--ms-bg-soft,rgba(255,255,255,0.06));
        border:1px solid rgba(255,255,255,0.14); border-radius:5px; color:var(--ms-fg,#c9d1d9); cursor:pointer; font:inherit; }
      #${PANEL_ID} .ts-btn:hover { border-color:rgba(255,255,255,0.3); }
      #${PANEL_ID} .ts-btn-add { color:#e57373; border-color:rgba(220,80,80,0.4); background:rgba(220,80,80,0.10); }
      #${PANEL_ID} .ts-btn-danger { color:#ffb4a8; border-color:rgba(220,80,80,0.3); }
      #${PANEL_ID} .ts-list { display:flex; flex-direction:column; gap:5px; }
      #${PANEL_ID} .ts-empty { color:var(--ms-fg-dim,#8a93a0); font-style:italic; padding:4px 0; }
      #${PANEL_ID} .ts-item { border:1px solid rgba(255,255,255,0.1); border-radius:5px; padding:5px 6px; background:rgba(255,255,255,0.03); }
      #${PANEL_ID} .ts-item-head { display:flex; align-items:center; gap:6px; }
      #${PANEL_ID} .ts-item-head .ts-i-label { flex:1; color:var(--ms-fg,#c9d1d9); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #${PANEL_ID} .ts-i-del { background:none; border:none; color:#ffb4a8; cursor:pointer; }
      #${PANEL_ID} .ts-item-row { display:flex; align-items:center; gap:4px; margin-top:4px; }
      #${PANEL_ID} .ts-item-row label { color:var(--ms-fg-dim,#8a93a0); }
      #${PANEL_ID} .ts-item-row input { width:48px; }
      #${PANEL_ID} input { background:var(--ms-bg,#0e1014); color:var(--ms-fg,#c9d1d9);
        border:1px solid rgba(255,255,255,0.15); border-radius:4px; padding:2px 4px; font:inherit; }
    `;
    document.head.appendChild(style);
  }
}
```

- [ ] **Step 2 verification: filtered compile**

Run: `npx tsc -p tsconfig.build.json --noEmit 2>&1 | Select-String -Pattern "SectorPanel"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add MS/Engines/Visualization/SectorPanel.ts
git commit -m "feat(viz): SectorPanel — floating threat-sector management panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire SectorPanel into SymbolEngine

**Files:**
- Modify: `MS/Engines/SymbolEngine.ts` (import `:66`; field `:173`; instantiate `:777`; view switch `:613`; API near `:1473`)

- [ ] **Step 1: Add the import** immediately after the `SectorDrawTool` import (`SymbolEngine.ts:66`):

```ts
import SectorPanel from './Visualization/SectorPanel.ts';
```

- [ ] **Step 2: Add the field** immediately after `_sectorDrawTool` (`:173`):

```ts
  private _sectorPanel: SectorPanel | null = null;
```

- [ ] **Step 3: Instantiate + link** immediately after the `_sectorDrawTool` assignment (`:777`):

```ts
    this._sectorPanel = new SectorPanel(() => this.view, this._visualizationEngine, () => this.beginSectorDraw());
    this._contextMenuManager?.linkSectorPanel(this._sectorPanel);
```

- [ ] **Step 4: Route view switch** immediately after `this._sectorDrawTool?.onViewChanged(newView);` (`:613`):

```ts
    this._sectorPanel?.onViewChanged(newView);
```

- [ ] **Step 5: Add the public API** immediately after the `beginSectorDraw` method (`:1475`, just before `clearSectors`):

```ts
  /** Open the interactive threat-sector management panel. */
  public openSectorPanel(): void { this._sectorPanel?.openPanel(); }

  /** Close the threat-sector management panel. */
  public closeSectorPanel(): void { this._sectorPanel?.closePanel(); }
```

- [ ] **Step 6 verification: filtered compile** (this also depends on Task 4's `linkSectorPanel`; if Task 4 isn't done yet, expect exactly one error about `linkSectorPanel` not existing — acceptable until Task 4 lands; otherwise none):

Run: `npx tsc -p tsconfig.build.json --noEmit 2>&1 | Select-String -Pattern "SymbolEngine\.ts"`
Expected: no output once Task 4 is complete.

- [ ] **Step 7: Commit**

```bash
git add MS/Engines/SymbolEngine.ts
git commit -m "feat(viz): own SectorPanel in SymbolEngine + openSectorPanel API

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: More Actions… palette entry (ContextMenuManager)

**Files:**
- Modify: `MS/Managers/ContextMenuManager.ts` (field near `:116`; link method near `:437`; palette entry near `:1065`)

- [ ] **Step 1: Add the field** next to `_deploymentBuilderEngine` (`:116`):

```ts
  private _sectorPanel: { openPanel(): void } | null = null;
```

- [ ] **Step 2: Add the link method** immediately after `linkTrafficabilityEngine` (`:437`):

```ts
  /**
   * Link the threat-sector panel so "Threat Sector Panel" appears in the
   * More Actions palette. SymbolEngine links it only when the visualization
   * engine is active, which is the gating.
   */
  public linkSectorPanel(panel: { openPanel(): void } | null): void {
    this._sectorPanel = panel;
  }
```

- [ ] **Step 3: Add the palette action** alongside the other `if (this._xxxEngine)` blocks (immediately after the trafficability block at `:1065-1071`):

```ts
    if (this._sectorPanel) {
      actions.push(this.createPaletteAction('viz-threat-sector-panel', 'Threat Sector Panel', 'Visualization', undefined, () => {
        this._sectorPanel!.openPanel();
      }));
    }
```

- [ ] **Step 4 verification: filtered compile**

Run: `npx tsc -p tsconfig.build.json --noEmit 2>&1 | Select-String -Pattern "ContextMenuManager"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add MS/Managers/ContextMenuManager.ts
git commit -m "feat(viz): Threat Sector Panel entry in More Actions palette

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Ctrl+K / ⚙ Settings menu action (VisualizationSettingsManifest)

**Files:**
- Modify: `MS/Engines/VisualizationSettingsManifest.ts` (add one entry to the `visualizationSettingsManifest` array)

This mirrors the compass action at `DrawingCuesSettingsManifest.ts:302` (`type: 'action'`, `buttonLabel`, `onClick`). `SettingDescriptor` already supports these fields.

- [ ] **Step 1: Add the action entry** as a new object near the top of the `visualizationSettingsManifest` array (e.g. right after the `['features','visualizationEngine']` entry at `:40`):

```ts
  {
    path: ['visualization', 'sector', '__openPanel'],
    label: 'Threat sector panel',
    buttonLabel: '🎯 Open Threat Sector Panel',
    group: 'Threat sectors',
    type: 'action',
    help: 'Open the threat-sector management panel: draw, list, recolor, and edit sectors.',
    keywords: ['sector', 'threat', 'wedge', 'arc', 'fan', 'engagement'],
    onClick: () => {
      const se = (window as any).symbolEngine;
      if (se?.openSectorPanel) se.openSectorPanel();
      else console.warn('SymbolEngine not ready yet');
    },
  },
```

- [ ] **Step 2 verification: filtered compile**

Run: `npx tsc -p tsconfig.build.json --noEmit 2>&1 | Select-String -Pattern "VisualizationSettingsManifest"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add MS/Engines/VisualizationSettingsManifest.ts
git commit -m "feat(viz): Ctrl+K / Settings action to open Threat Sector Panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Settings-panel button (index.html + main.ts)

**Files:**
- Modify: `index.html` (button inside `#feature-panel-visualization`, ~`:2198`)
- Modify: `src/main.ts` (click handler after the `window.symbolEngine` exposure, `:148`)

- [ ] **Step 1: Add the button** inside `#feature-panel-visualization`, immediately after the master Visualization checkbox row (the `<input ... id="setting-visualizationEngine" .../>` row at ~`index.html:2201`). Insert this new row:

```html
            <div class="setting-row" style="margin-top:4px">
              <button style="flex:1;padding:5px 8px;background:rgba(220,80,80,0.12);border:1px solid rgba(220,80,80,0.3);border-radius:5px;color:rgba(220,80,80,0.95);font-size:10px;cursor:pointer;font-family:inherit" id="sector-open-panel-btn" title="Open the threat-sector management panel">🎯 Open Threat Sector Panel</button>
            </div>
```

- [ ] **Step 2: Wire the handler** in `src/main.ts`, immediately after `(window as any).symbolEngine = symbolEngine;` (`:148`):

```ts
// Threat Sector panel — open button in the Visualization settings panel
document.getElementById('sector-open-panel-btn')?.addEventListener('click', () => {
  (window as any).symbolEngine?.openSectorPanel?.();
});
```

- [ ] **Step 3 verification: filtered compile** (only `main.ts` is type-checked; `index.html` is not):

Run: `npx tsc -p tsconfig.build.json --noEmit 2>&1 | Select-String -Pattern "main.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat(viz): Open Threat Sector Panel button in Visualization settings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification (manual) + final filtered compile

**Files:** none (verification only)

- [ ] **Step 1: Full filtered compile across all touched files** — confirm no *new* errors:

Run (PowerShell):
```powershell
npx tsc -p tsconfig.build.json --noEmit 2>&1 | Select-String -Pattern "SectorPanel|VisualizationEngine|SymbolEngine\.ts|ContextMenuManager|VisualizationSettingsManifest|main\.ts|SectorDrawTool"
```
Expected: empty output (the only allowed pre-existing baseline, e.g. `DeadGroundMapper.ts`, is not in this list).

- [ ] **Step 2: Manual functional pass** — the **user** runs `npm run dev` (do not start it yourself) and confirms:
  1. In the Settings panel, enable **Visualization** (`features.visualizationEngine`). The viz engine loads.
  2. Open the panel from **each surface**: the **🎯 Open Threat Sector Panel** button in the Visualization settings panel; the **Ctrl+K** palette ("Threat Sector Panel" / "🎯 Open Threat Sector Panel"); right-click → **More Actions…** → **Threat Sector Panel**; and console `symbolEngine.openSectorPanel()`.
  3. **Draw Sector** → click center, move for range + click, sweep + click → a red wedge commits **and a row appears in the panel list**.
  4. The existing right-click **"Add Threat Sector"** still launches the direct draw (unchanged).
  5. **Default appearance**: change color + fill, then Draw/Add → new sector uses the new defaults.
  6. **Numeric "＋ Add Sector"** (range/start/end) → a sector appears at the current map center.
  7. **Per-row**: recolor (swatch), edit range/start/end (geometry updates), remove (✕) → only that sector goes.
  8. **Clear All** → all sectors removed; list shows the empty hint.
  9. Drag the panel header to move it; **✕** closes it.
  10. Switch **2D ↔ 3D** with the panel open → no errors; list still reflects state.

- [ ] **Step 3: Finalize the branch** — once the user confirms the manual pass, use `superpowers:finishing-a-development-branch` to decide merge / PR / cleanup.

---

## Self-Review

**Spec coverage:**
- Full-parity panel (defaults + draw + numeric create + list + per-sector edit/remove/recolor) → Task 2 (panel) + Task 1 (model). ✓
- In-memory state → Task 1 fields; no Settings.json wiring. ✓
- Click-draw unchanged → `SectorDrawTool` not modified; `showSector` delegates (Task 1). ✓
- 5 open surfaces: click-draw (existing), More Actions (Task 4), Ctrl+K/Settings menu (Task 5), index.html+main.ts settings panel (Task 6), plus `window.symbolEngine.openSectorPanel()` (Task 3). ✓
- Scope boundary (edit = numeric + appearance, no drag-handle editing) → panel exposes range/az/color/opacity only. ✓
- View switch + teardown → `onViewChanged` (Task 3) + `destroy()` (Task 2). ✓

**Placeholder scan:** No TBD/TODO; every code step is complete; no "add error handling" hand-waving.

**Type consistency:** `createSector`/`updateSector`/`removeSector`/`listSectors`/`getSectorDefaults`/`setSectorDefaults`/`setSectorsChangedHandler` defined in Task 1 are the exact names called by `SectorPanel` (Task 2) and `SymbolEngine` (Task 3). `linkSectorPanel` defined in Task 4 matches the call in Task 3. `openSectorPanel` defined in Task 3 matches Tasks 4/5/6 callers. `SectorListItem` patch shape (`Partial<Omit<SectorListItem,'id'>>`) covers every field the panel patches.
