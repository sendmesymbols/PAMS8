import type MapView from "@arcgis/core/views/MapView";
import type SceneView from "@arcgis/core/views/SceneView";
import type Point from "@arcgis/core/geometry/Point";
import type VisualizationEngine from "./VisualizationEngine";
import { bindDisclosures } from "../../Support/Disclosure";

const PANEL_ID = "ts-widget";

/**
 * Floating, draggable management panel for threat sectors — draw /
 * numeric-create / list / recolor / edit / remove, plus default-appearance
 * controls. In-memory only.
 *
 * Chrome is the shared `ms-*` widget vocabulary from MS/Styles/Widgets.css; the
 * per-sector list rows are the only engine-specific component (`ts-*`).
 */
export default class SectorPanel {
  private _widget: HTMLElement | null = null;
  private _open = false;
  /** Live only for the duration of a header drag — see `_makeDraggable`. */
  private _dragMove: ((e: MouseEvent) => void) | null = null;
  private _dragUp: (() => void) | null = null;

  constructor(
    private _getView: () => MapView | SceneView | null,
    private _viz: VisualizationEngine,
    private _beginDraw: () => void,
  ) {}

  public openPanel(): void {
    if (!this._widget) this._createWidget();
    this._widget!.classList.add("ms-visible");
    this._open = true;
    this._viz.setSectorsChangedHandler(() => this._update());
    this._update();
  }

  public closePanel(): void {
    this._widget?.classList.remove("ms-visible");
    this._endDrag();
    this._open = false;
    this._viz.setSectorsChangedHandler(null);
  }

  public onViewChanged(_view: MapView | SceneView): void {
    if (this._open) this._update();
  }

  public destroy(): void {
    this._endDrag();
    this._widget?.remove();
    this._widget = null;
    this._viz.setSectorsChangedHandler(null);
    this._open = false;
  }

  // ── DOM build ───────────────────────────────────────────────────────────────
  private _createWidget(): void {
    const el = document.createElement("div");
    el.id = PANEL_ID;
    el.className = "ms-panel ms-theme-ops-dark";
    el.setAttribute("data-engine", "threat-sectors");
    // Height and overflow come from .ms-panel / .ms-body.
    el.style.cssText = "top: 70px; right: 14px; width: 300px;";
    el.innerHTML = this._html();
    document.body.appendChild(el);
    this._widget = el;
    this._bindEvents();
    bindDisclosures(el);
  }

  private _html(): string {
    const d = this._viz.getSectorDefaults();
    return `
      <div class="ms-header" id="ts-header">
        <div class="ms-header-icon">SEC</div>
        <div class="ms-header-title">Threat Sectors</div>
        <div class="ms-status-dot" id="ts-status-dot"></div>
        <div class="ms-status-lbl" id="ts-status-lbl">None</div>
        <button class="ms-header-btn ms-btn-round" id="ts-help-btn" title="How threat sectors work">?</button>
        <button class="ms-header-btn ms-btn-round" id="ts-min-btn" title="Minimize">&#9660;</button>
        <button class="ms-header-btn ms-btn-round" id="ts-close" title="Close (keeps sectors)">&#10005;</button>
      </div>

      <div class="ms-help-popover" id="ts-help-popover" hidden>
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Field Guide</div>
            <div class="ms-help-title">Threat Sectors</div>
          </div>
          <button class="ms-help-close" id="ts-help-close" title="Close">&#10005;</button>
        </div>
        <div class="ms-help-body">
          <p>Draws a weapon or observation arc as a wedge: a centre, a range, and the pair of azimuths it sweeps between. Sectors live in memory for the session and are not saved with the plan.</p>
          <p><strong style="color:var(--ms-accent)">Drawing</strong></p>
          <p>Press <strong>Draw Sector</strong>, then click the map three times &mdash; centre, range, sweep. The shipped appearance produces a usable arc untouched.</p>
          <p><strong style="color:var(--ms-accent)">By numbers</strong></p>
          <p>When you already know the figures, the collapsed group places a sector at the current map centre from a range and a start/end bearing.</p>
          <p><strong style="color:var(--ms-accent)">Editing</strong></p>
          <p>Every sector in the list carries its own colour, range, start and end, and a 3D extrusion height. Height only shows in a SceneView; 0 keeps the wedge flat.</p>
        </div>
      </div>

      <div class="ms-body">
        <!-- Default view: draw one. Numeric entry and the default appearance
             are both tweakables with usable shipped values. -->
        <div class="ms-btn-row">
          <button class="ms-btn ms-cta" id="ts-draw" title="Click the map: centre &rarr; range &rarr; sweep">&#9998; Draw Sector</button>
        </div>
        <div class="ms-hint">Click the map three times: centre, range, sweep.</div>

        <div id="ts-results" hidden>
          <div class="ms-divider"></div>
          <div class="ms-section-title">Sectors</div>
          <div id="ts-list" class="ts-list"></div>
          <div class="ms-btn-row">
            <button class="ms-btn danger" id="ts-clear" title="Remove all sectors">Clear All</button>
          </div>
        </div>

        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="ts-num-toggle" aria-expanded="false" aria-controls="ts-num-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">&#9654;</span>
            <span class="ms-disclosure-title">Add by numbers</span>
            <span class="ms-disclosure-meta">Places at the map centre</span>
          </button>
          <div class="ms-disclosure-body" id="ts-num-body" hidden>
            <div class="ms-grid">
              <div class="ms-field">
                <label class="ms-label" for="ts-range">Range km</label>
                <input type="number" id="ts-range" class="ms-input" value="5" min="0.1" step="0.1" />
              </div>
              <div class="ms-field">
                <label class="ms-label" for="ts-start">Start &deg;</label>
                <input type="number" id="ts-start" class="ms-input" value="0" min="0" max="360" step="1" />
              </div>
              <div class="ms-field">
                <label class="ms-label" for="ts-end">End &deg;</label>
                <input type="number" id="ts-end" class="ms-input" value="90" min="0" max="360" step="1" />
              </div>
            </div>
            <div class="ms-btn-row">
              <button class="ms-btn primary" id="ts-add">&#65291; Add Sector</button>
            </div>
          </div>
        </div>

        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="ts-look-toggle" aria-expanded="false" aria-controls="ts-look-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">&#9654;</span>
            <span class="ms-disclosure-title">Default appearance</span>
            <span class="ms-disclosure-meta">Applies to the next sector</span>
          </button>
          <div class="ms-disclosure-body" id="ts-look-body" hidden>
            <div class="ms-grid">
              <div class="ms-field">
                <label class="ms-label" for="ts-color">Colour</label>
                <input type="color" id="ts-color" class="ms-input ts-color" value="${this._rgb2hex(d.color)}" />
              </div>
              <div class="ms-field">
                <label class="ms-label" for="ts-width">Outline width</label>
                <input type="number" id="ts-width" class="ms-input" value="${d.outlineWidth}" min="0.5" max="6" step="0.5" />
              </div>
            </div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">Fill opacity</div>
              <input type="range" id="ts-fill" min="0" max="1" step="0.05" value="${d.fillOpacity}" />
              <div class="ms-slider-value" id="ts-fill-val">${d.fillOpacity.toFixed(2)}</div>
            </div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">Outline opacity</div>
              <input type="range" id="ts-out" min="0" max="1" step="0.05" value="${d.outlineOpacity}" />
              <div class="ms-slider-value" id="ts-out-val">${d.outlineOpacity.toFixed(2)}</div>
            </div>
            <div class="ms-grid">
              <div class="ms-field full">
                <label class="ms-label" for="ts-height">Extrusion height m (3D only)</label>
                <input type="number" id="ts-height" class="ms-input" value="${d.extrudeHeightM}" min="0" step="50"
                       title="Extrusion height in metres — visible only in 3D (SceneView). 0 = flat." />
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  private _bindEvents(): void {
    if (!this._widget) return;
    const w = this._widget;
    const q = <T extends HTMLElement>(id: string) => w.querySelector<T>(`#${id}`);

    q("ts-close")?.addEventListener("click", () => this.closePanel());
    this._makeDraggable(q<HTMLElement>("ts-header")!);

    q("ts-min-btn")?.addEventListener("click", () => {
      const body = w.querySelector<HTMLElement>(".ms-body");
      const btn = q<HTMLElement>("ts-min-btn");
      if (!body || !btn) return;
      const minimized = body.classList.toggle("ms-minimized");
      btn.textContent = minimized ? "▶" : "▼";
      btn.title = minimized ? "Restore" : "Minimize";
    });
    q("ts-help-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const help = q<HTMLElement>("ts-help-popover");
      if (help) help.hidden = !help.hidden;
    });
    q("ts-help-close")?.addEventListener("click", () => {
      const help = q<HTMLElement>("ts-help-popover");
      if (help) help.hidden = true;
    });

    // Draw / clear
    q("ts-draw")?.addEventListener("click", () => this._beginDraw());
    q("ts-clear")?.addEventListener("click", () => this._viz.clearSectors());

    // Numeric add at current map center
    q("ts-add")?.addEventListener("click", () => {
      const center = this._getView()?.center as Point | undefined;
      if (!center) return;
      this._viz.createSector(center, {
        rangeKm:    this._num(q<HTMLInputElement>("ts-range")!.value, 1),
        azStartDeg: this._num(q<HTMLInputElement>("ts-start")!.value, 0),
        azEndDeg:   this._num(q<HTMLInputElement>("ts-end")!.value, 90),
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
      extrudeHeightM: this._num(q<HTMLInputElement>("ts-height")!.value, 0),
    });
    q("ts-color")?.addEventListener("change", pushDefaults);
    fill.addEventListener("change", pushDefaults);
    out.addEventListener("change", pushDefaults);
    q("ts-width")?.addEventListener("change", pushDefaults);
    q("ts-height")?.addEventListener("change", pushDefaults);
  }

  /**
   * Header drag. The document-level handlers live only for the duration of a
   * drag — they used to be registered for the panel's whole lifetime, running
   * on every mousemove on the page and continuing to move the panel after it
   * was closed mid-drag.
   */
  private _makeDraggable(handle: HTMLElement): void {
    let dx = 0;
    let dy = 0;
    handle.addEventListener("mousedown", (e: MouseEvent) => {
      const w = this._widget;
      if (!w) return;
      if ((e.target as HTMLElement).closest("button")) return;
      const r = w.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      w.style.left = `${r.left}px`;
      w.style.top = `${r.top}px`;
      w.style.right = "auto";
      this._dragMove = (me: MouseEvent) => {
        if (!this._widget) return;
        const maxLeft = window.innerWidth - this._widget.offsetWidth - 4;
        const maxTop = window.innerHeight - this._widget.offsetHeight - 4;
        this._widget.style.left = `${Math.max(0, Math.min(me.clientX - dx, maxLeft))}px`;
        this._widget.style.top = `${Math.max(0, Math.min(me.clientY - dy, maxTop))}px`;
      };
      this._dragUp = () => this._endDrag();
      document.addEventListener("mousemove", this._dragMove);
      document.addEventListener("mouseup", this._dragUp);
      e.preventDefault();
    });
  }

  private _endDrag(): void {
    if (this._dragMove) document.removeEventListener("mousemove", this._dragMove);
    if (this._dragUp) document.removeEventListener("mouseup", this._dragUp);
    this._dragMove = null;
    this._dragUp = null;
  }

  // ── List rendering ────────────────────────────────────────────────────────
  private _update(): void {
    if (!this._widget) return;
    const listEl = this._widget.querySelector("#ts-list") as HTMLElement | null;
    if (!listEl) return;

    const sectors = this._viz.listSectors();

    // The whole Sectors block is output: hidden until there is one to show.
    const results = this._widget.querySelector("#ts-results") as HTMLElement | null;
    if (results) results.hidden = sectors.length === 0;
    const dot = this._widget.querySelector("#ts-status-dot") as HTMLElement | null;
    if (dot) dot.className = `ms-status-dot ${sectors.length ? "ready" : ""}`.trim();
    const lbl = this._widget.querySelector("#ts-status-lbl") as HTMLElement | null;
    if (lbl) lbl.textContent = sectors.length ? `${sectors.length} sector${sectors.length === 1 ? "" : "s"}` : "None";

    listEl.textContent = "";

    for (const s of sectors) {
      const row = document.createElement("div");
      row.className = "ts-item";
      row.innerHTML = `
        <div class="ts-item-head">
          <input type="color" class="ms-input ts-color ts-i-color" value="${this._rgb2hex(s.color)}" title="Sector colour"/>
          <span class="ts-i-label" title="${s.label}">${s.label}</span>
          <button class="ms-header-btn ms-btn-round ts-i-del" title="Remove sector">&#10005;</button>
        </div>
        <div class="ts-item-row">
          <label class="ms-label">R km</label><input type="number" class="ms-input ts-i-range" value="${s.rangeKm}" min="0.1" step="0.1"/>
          <label class="ms-label">Start</label><input type="number" class="ms-input ts-i-start" value="${s.azStartDeg}" min="0" max="360" step="1"/>
          <label class="ms-label">End</label><input type="number" class="ms-input ts-i-end" value="${s.azEndDeg}" min="0" max="360" step="1"/>
        </div>
        <div class="ts-item-row">
          <label class="ms-label">Height m (3D)</label><input type="number" class="ms-input ts-i-height" value="${s.extrudeHeightM}" min="0" step="50"/>
        </div>`;
      const color = row.querySelector(".ts-i-color") as HTMLInputElement;
      const del   = row.querySelector(".ts-i-del")   as HTMLElement;
      const range = row.querySelector(".ts-i-range") as HTMLInputElement;
      const start = row.querySelector(".ts-i-start") as HTMLInputElement;
      const end   = row.querySelector(".ts-i-end")   as HTMLInputElement;
      const height = row.querySelector(".ts-i-height") as HTMLInputElement;
      color.addEventListener("change", () => this._viz.updateSector(s.id, { color: this._hex2rgb(color.value) }));
      del.addEventListener("click", () => this._viz.removeSector(s.id));
      const applyGeom = () => this._viz.updateSector(s.id, {
        rangeKm:    this._num(range.value, s.rangeKm),
        azStartDeg: this._num(start.value, s.azStartDeg),
        azEndDeg:   this._num(end.value, s.azEndDeg),
      });
      range.addEventListener("change", applyGeom);
      start.addEventListener("change", applyGeom);
      end.addEventListener("change", applyGeom);
      height.addEventListener("change", () => this._viz.updateSector(s.id, { extrudeHeightM: this._num(height.value, s.extrudeHeightM) }));
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

  private _num(value: string, fallback: number): number {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
}
