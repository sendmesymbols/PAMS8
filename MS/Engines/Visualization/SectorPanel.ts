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
