/**
 * StylusDrawController.ts
 *
 * Central, stylus-friendly drawing path for line / polyline / polygon (Area)
 * symbols. The ~147 symbol classes each copy-paste a mouse-centric interactive
 * model (click = add control point, pointer-move = preview, double-click =
 * finish) which breaks on a stylus: passive pens / touch don't hover (no
 * preview), taps that drift register as pans, and double-tap is unreliable.
 *
 * Rather than editing every symbol, this controller drives drawing centrally.
 * In stylus mode SymbolEngine.initialize() does NOT call the symbol's
 * interactive init(); instead it hands the (already-constructed) symbol to
 * begin(). The controller captures the gesture — a simplified freehand stroke
 * or tapped vertices — reduces it to control points, then calls the symbol's
 * EXISTING immediate-placement path `symbol.init({ CTRL_PTS }, marker)`, which
 * builds geometry synchronously and emits onDrawEnd. The duplicated per-symbol
 * input handlers are simply never used.
 *
 * Activation is decided by SymbolEngine via shouldEngage(): pen/touch engages
 * in 'auto' mode (no hover dependency — device is sniffed from a persistent
 * window 'pointerdown' probe), 'on' forces it, 'off' keeps classic drawing.
 *
 * See the design notes in the plan; key reuse: the EditEngine drag-capture
 * idiom (view.on('drag', e => e.stopPropagation()) to suppress map pan), the
 * SKETCH GraphicsLayer for preview, and ArcGIS geometryEngine.generalize for
 * Douglas-Peucker stroke simplification.
 */

import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import Graphic from '@arcgis/core/Graphic';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';
import type GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import type GraphicsLayerManager from '../../Managers/GraphicsLayerManager';
import { LAYER_NAMES } from '../../Managers/GraphicsLayerManager';

type View = MapView | SceneView;
type Paradigm = 'freehand' | 'tap' | 'native';
type StylusMode = 'auto' | 'on' | 'off';

export interface StylusDrawDeps {
  getView: () => View;
  getLayerManager: () => GraphicsLayerManager;
  getSettings: () => any;
  // 'native' paradigm only: SymbolEngine drives finish/cancel so we don't need
  // per-symbol APIs. finishNativeDraw re-emits the symbol's own terminator at
  // the last tapped screen point; cancelNativeDraw tears the native draw down.
  finishNativeDraw?: (screen?: { x: number; y: number } | null) => void;
  cancelNativeDraw?: () => void;
}

interface CurrentSymbol {
  Class: string;
  Name: string;
  SymGeoType: string;
  [k: string]: any;
}

interface Session {
  symbol: any;
  marker: any;
  drawEssentials: any;
  currentSymbol: CurrentSymbol;
  paradigm: Paradigm;
  points: Point[];
  previewGraphic: Graphic | null;
  vertexGraphics: Graphic[];
  handles: any[];
  capturing: boolean;
  tapDownScreen: { x: number; y: number } | null;
  // 'native' paradigm extras (unused by freehand/tap):
  mode?: 'native' | 'legacy';
  lastScreen?: { x: number; y: number } | null;
  nativeOnEnd?: () => void;
}

// Minimum screen-pixel travel between captured freehand samples — keeps the raw
// stroke from exploding into thousands of near-coincident points.
const FREEHAND_MIN_PX = 3;

// Preview styling (shared instances — these never mutate).
const PREVIEW_LINE = new SimpleLineSymbol({ color: [0, 160, 255, 0.95], width: 1.75, style: 'dash' });
const PREVIEW_FILL = new SimpleFillSymbol({
  color: [0, 160, 255, 0.12],
  outline: { color: [0, 160, 255, 0.95], width: 1.75, style: 'dash' },
});
const VERTEX_SYM = new SimpleMarkerSymbol({
  style: 'circle',
  size: 8,
  color: [0, 160, 255, 0.95],
  outline: { color: [255, 255, 255, 0.9], width: 1 },
});

// Line/area symbols whose immediate-placement init() REQUIRES a baseline
// (BASE_LN_PTS) and throws without it. Verified by reading each init()'s
// CTRL_PTS branch (the "...Baseline...required..." throwers) and cross-checked
// against Mapper's SYMBOL_MAP class keys. For these, the first two gesture
// points become the baseline (start + centre) and the rest become control
// points — mirroring the classic baseline-then-control-points interaction.
// NOTE: Delay / AvenueOfApchs / AxisOfAdvanceFeint reference BASE_LN_PTS but
// their CTRL_PTS-only branch is plain, so they are deliberately NOT listed.
const BASELINE_CLASSES = new Set<string>([
  'Block',
  'BlockObstacleEffect',
  'Breach',
  'Bridge',
  'Bypass',
  'Canalize',
  'Clear',
  'Disrupt',
  'DisruptObstacleEffect',
  'Funnel',
  'Isolate',
  'Penetrate',
  'AttackByFirePosition',
  'SupportByFirePosition',
  'ObstacleBypassEasy',
  'ObstacleBypassDifficult',
  'ObstacleBypassImpossible',
  'InfiltrationLane',
  'SafeLane',
  'UARoute',
  'MovingConvoy',
  'TransitCorridors',
  'MinimumRiskRoute',
  'LowLevelTransitRoute',
  'FreehandDoubleLineArrow',
]);

function isBaselineClass(cls: string | undefined): boolean {
  return !!cls && BASELINE_CLASSES.has(cls);
}

export default class StylusDrawController {
  private _deps: StylusDrawDeps;
  private _lastPointerType: string = 'mouse';
  private _session: Session | null = null;
  private _toolbarEl: HTMLDivElement | null = null;
  private _winPointerDown: ((e: PointerEvent) => void) | null = null;

  constructor(deps: StylusDrawDeps) {
    this._deps = deps;
    // Persistent capture-phase probe so we know the input device BEFORE a draw
    // starts — crucially, this needs no hover (works for passive pens / touch).
    if (typeof window !== 'undefined') {
      this._winPointerDown = (e: PointerEvent) => {
        if (e.pointerType) this._lastPointerType = e.pointerType;
      };
      window.addEventListener('pointerdown', this._winPointerDown, true);
    }
  }

  /** True while a stylus capture session is live (read by keyboard Enter/Escape routing). */
  get isEngaged(): boolean {
    return this._session !== null;
  }

  /**
   * Should the stylus controller drive this draw instead of the symbol's classic
   * click/double-click handlers? Only line/area symbols, and only when the mode
   * + detected device agree.
   */
  shouldEngage(currentSymbol: CurrentSymbol | undefined): boolean {
    if (!currentSymbol) return false;
    const geo = currentSymbol.SymGeoType;
    if (geo !== 'Area' && geo !== 'Line') return false;
    const mode: StylusMode = this._deps.getSettings()?.stylus?.mode ?? 'auto';
    if (mode === 'off') return false;
    if (mode === 'on') return true;
    // auto: engage only when the last physical input was a pen or touch
    return this._lastPointerType === 'pen' || this._lastPointerType === 'touch';
  }

  /** Per-symbol override (keyed by Class) beats the global default. */
  resolveParadigm(currentSymbol: CurrentSymbol): Paradigm {
    const s = this._deps.getSettings()?.stylus ?? {};
    const per = s.perSymbol?.[currentSymbol?.Class];
    const p = per ?? s.paradigm ?? 'freehand';
    if (p === 'tap') return 'tap';
    if (p === 'native') return 'native';
    return 'freehand';
  }

  /**
   * True when this draw should run through the symbol's OWN interactive draw
   * (real createSymbol preview + native baseline phase) rather than begin()'s
   * freehand/tap capture. SymbolEngine uses this to pick the fork.
   */
  usesNativeDraw(currentSymbol: CurrentSymbol | undefined): boolean {
    return (
      this.shouldEngage(currentSymbol) &&
      !!currentSymbol &&
      this.resolveParadigm(currentSymbol) === 'native'
    );
  }

  /**
   * Start a capture session for an already-constructed symbol instance whose
   * interactive init() has been DEFERRED by SymbolEngine. On completion we call
   * symbol.init({ CTRL_PTS }) ourselves.
   */
  begin(symbol: any, marker: any, drawEssentials: any, currentSymbol: CurrentSymbol): void {
    this.deactivate(); // never stack sessions
    const paradigm = this.resolveParadigm(currentSymbol);
    this._session = {
      symbol,
      marker,
      drawEssentials,
      currentSymbol,
      paradigm,
      points: [],
      previewGraphic: null,
      vertexGraphics: [],
      handles: [],
      capturing: false,
      tapDownScreen: null,
    };
    if (paradigm === 'freehand') this._beginFreehand();
    else this._beginTap();
  }

  // ── Freehand: press → drag (pan suppressed) → lift ──────────────────────────
  private _beginFreehand(): void {
    const view = this._deps.getView();
    const s = this._session!;

    s.handles.push(
      view.on('pointer-down', (evt: any) => {
        if (evt.button !== 0) return;
        s.capturing = true;
        s.points = [];
        const mp = view.toMap({ x: evt.x, y: evt.y });
        if (mp) s.points.push(this._toPoint(mp));
        evt.stopPropagation(); // suppress the click that would otherwise follow
      }),
    );

    // Listening on 'drag' (not 'pointer-move') is what actually stops the map
    // from panning while the stylus is down — same idiom as EditEngine.
    s.handles.push(
      view.on('drag', (evt: any) => {
        if (!s.capturing) return;
        evt.stopPropagation();
        if (evt.action !== 'update') return;
        const last = s.points[s.points.length - 1];
        if (last) {
          const lastScreen = view.toScreen(last as any);
          if (lastScreen && Math.hypot(lastScreen.x - evt.x, lastScreen.y - evt.y) < FREEHAND_MIN_PX) return;
        }
        const mp = view.toMap({ x: evt.x, y: evt.y });
        if (!mp) return;
        s.points.push(this._toPoint(mp));
        this._renderPreview();
      }),
    );

    s.handles.push(
      view.on('pointer-up', () => {
        if (!s.capturing) return;
        s.capturing = false;
        this.finish();
      }),
    );
  }

  // ── Tap: tap each vertex (drift = pan), explicit Finish ─────────────────────
  private _beginTap(): void {
    const view = this._deps.getView();
    const s = this._session!;

    s.handles.push(
      view.on('pointer-down', (evt: any) => {
        if (evt.button !== 0) return;
        s.tapDownScreen = { x: evt.x, y: evt.y };
      }),
    );

    s.handles.push(
      view.on('pointer-up', (evt: any) => {
        const down = s.tapDownScreen;
        s.tapDownScreen = null;
        if (!down) return;
        // A press that drifted beyond tolerance was a pan — let the map keep it.
        if (Math.hypot(evt.x - down.x, evt.y - down.y) > this._tapTolerancePx()) return;
        const mp = view.toMap({ x: evt.x, y: evt.y });
        if (!mp) return;
        s.points.push(this._toPoint(mp));
        this._renderPreview();
        this._renderVertices();
        this._positionToolbar();
        // Single-segment line symbols finish after two taps.
        if (s.drawEssentials?.IS_LINE && s.points.length >= 2) this.finish();
      }),
    );

    if (this._deps.getSettings()?.stylus?.tap?.showFinishToolbar !== false) this._showToolbar();
  }

  // ── Native paradigm: delegate to the symbol's own interactive draw ──────────
  /**
   * The symbol's native init() has already been called by SymbolEngine, so its
   * real createSymbol preview + (for baseline classes) the two-phase BaseLine
   * flow are live. We add only a thin layer on top: a Finish/Cancel toolbar and
   * — because touch can't hover — a synthetic pointer-move after each tap that
   * drives the symbol's own move handler so the preview updates. No geometry is
   * reimplemented here and no symbol class is edited.
   */
  attachNative(symbol: any, currentSymbol: CurrentSymbol): void {
    this.deactivate(); // never stack sessions
    const view = this._deps.getView();
    const session: Session = {
      symbol,
      marker: null,
      drawEssentials: null,
      currentSymbol,
      paradigm: 'native',
      points: [],
      previewGraphic: null,
      vertexGraphics: [],
      handles: [],
      capturing: false,
      tapDownScreen: null,
      mode: 'native',
      lastScreen: null,
    };
    this._session = session;

    // Passive observer — the symbol's own click handler (registered in init(),
    // BEFORE this attach) adds the control point; we never stopPropagation, we
    // only watch so we can record the finish location and drive a touch preview.
    session.handles.push(
      view.on('click', (evt: any) => {
        session.lastScreen = { x: evt.x, y: evt.y };
        this._positionToolbarAt(evt.x, evt.y);
        // Pen hover already previews; touch has no hover, so nudge the symbol's
        // move handler with a synthetic pointer-move at the just-tapped point.
        if (this._lastPointerType !== 'mouse') this._emitSyntheticHover(evt.x, evt.y);
      }),
    );

    // Auto-clear when the draw finishes by ANY route (double-tap, Finish button,
    // or a click-count terminator). Guarded inside deactivate() / re-entrancy.
    const onEnd = () => this.deactivate();
    session.nativeOnEnd = onEnd;
    try {
      symbol.on?.('onDrawEnd', onEnd);
    } catch {
      /* symbol without a public .on still finishes via SymbolEngine's bus */
    }

    if (this._deps.getSettings()?.stylus?.tap?.showFinishToolbar !== false) {
      this._showToolbar(false); // no Undo: native draw has no remove-last-vertex
    }
  }

  /**
   * Dispatch a synthetic 'pointermove' on the view surface so a no-hover (touch)
   * tap still drives the symbol's createSymbol preview. ArcGIS 5.0.19's input
   * pipeline has no isTrusted gate, so this reaches view.on('pointer-move')
   * exactly like a real hover. Only 'pointermove' is sent (never down/up) and a
   * sentinel pointerId is used so no drag / device state is affected.
   */
  private _emitSyntheticHover(x: number, y: number): void {
    const view = this._deps.getView();
    const container = view.container as HTMLElement | null;
    if (!container) return;
    const surface =
      (container.querySelector('.esri-view-surface') as HTMLElement | null) ?? container;
    try {
      const rect = surface.getBoundingClientRect();
      surface.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: rect.left + x,
          clientY: rect.top + y,
          bubbles: true,
          cancelable: true,
          pointerType: 'touch',
          pointerId: 99999,
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      );
    } catch {
      /* PointerEvent unsupported → no touch preview, not fatal */
    }
  }

  private _positionToolbarAt(x: number, y: number): void {
    const el = this._toolbarEl;
    if (!el) return;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y - 56)}px`;
    el.style.transform = 'translateX(-50%)';
  }

  // ── Completion ──────────────────────────────────────────────────────────────
  finish(): void {
    const s = this._session;
    if (!s) return;
    if (s.mode === 'native') {
      // SymbolEngine re-emits the symbol's own terminator; on success the
      // symbol's onDrawEnd → our nativeOnEnd → deactivate(). If the draw isn't
      // actually finishable yet (e.g. baseline phase), this is a harmless no-op
      // and the session stays armed.
      this._deps.finishNativeDraw?.(s.lastScreen ?? null);
      return;
    }
    let pts = this._dedupe(s.points);
    if (s.paradigm === 'freehand') pts = this._simplify(pts);
    // Baseline-first symbols need 2 baseline points + >=1 control point; the
    // rest need >=2. Below the minimum, drop what we have and stay armed.
    const minPts = isBaselineClass(s.currentSymbol?.Class) ? 3 : 2;
    if (pts.length < minPts) {
      this._resetPointsKeepArmed();
      return;
    }
    // Bucket B: ellipse mode (DRAW_TYPE 3) is defined by exactly two points.
    if (Number(s.drawEssentials?.DRAW_TYPE) === 3) pts = [pts[0], pts[pts.length - 1]];
    this._applyToSymbol(s, pts);
    this.deactivate();
  }

  undoLast(): void {
    const s = this._session;
    if (!s || s.points.length === 0) return;
    s.points.pop();
    this._renderPreview();
    this._renderVertices();
    this._positionToolbar();
  }

  cancel(): void {
    const s = this._session;
    if (s?.mode === 'native') {
      // SymbolEngine._cancelActiveDraw deactivates the symbol AND calls our
      // deactivate(), which clears the session — don't double-tear-down here.
      this._deps.cancelNativeDraw?.();
      return;
    }
    this.deactivate();
  }

  /**
   * Feed the captured control points into the symbol's existing immediate-
   * placement path. Setting CTRL_PTS as an own-property is what flips init()
   * out of interactive mode (DrawEssentials does not declare it by default).
   */
  private _applyToSymbol(s: Session, pts: Point[]): void {
    const de: any = s.drawEssentials;
    if (isBaselineClass(s.currentSymbol?.Class)) {
      // First two gesture points define the baseline (start + centre); the
      // remainder are the effect/control points — matching the classic
      // baseline-then-control-points interaction these symbols expect.
      de.BASE_LN_PTS = this._synthBaseLine(pts[0], pts[1]);
      de.CTRL_PTS = pts.slice(2);
    } else {
      de.CTRL_PTS = pts;
    }
    try {
      s.symbol.init(de, s.marker);
    } catch (err) {
      // Safety net for any mis-classified symbol — never crash the app.
      console.warn('[StylusDrawController] symbol.init failed for', s.currentSymbol?.Class, err);
    } finally {
      // Some classes (e.g. Ambush) call setupEventHandlers() at the top of
      // init() even on the immediate-placement path, leaking view listeners.
      // deactivate() releases them and never removes the placed graphic.
      try {
        s.symbol.deactivate?.();
      } catch {
        /* no-op */
      }
    }
  }

  /**
   * Build a baseline {startPt, midPt, endPt} from the first two gesture points,
   * mirroring BaseLine._baseLine: start = p0, centre = p1, end extends one more
   * baseline-length beyond the centre (so getMidPoint(start, end) === p1, which
   * is what the baseline symbols recompute internally).
   */
  private _synthBaseLine(p0: Point, p1: Point): { startPt: Point; midPt: Point; endPt: Point } {
    const sr = this._deps.getView().spatialReference;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const endPt = new Point({
      x: p1.x + len * Math.cos(angle),
      y: p1.y + len * Math.sin(angle),
      spatialReference: sr,
    });
    return { startPt: p0, midPt: p1, endPt };
  }

  // ── Geometry helpers ────────────────────────────────────────────────────────
  private _dedupe(pts: Point[]): Point[] {
    if (pts.length <= 1) return pts.slice();
    const eps = (((this._deps.getView() as any).resolution as number) || 0) || 1e-6;
    const out: Point[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = out[out.length - 1];
      const b = pts[i];
      if (Math.abs(a.x - b.x) > eps || Math.abs(a.y - b.y) > eps) out.push(b);
    }
    return out;
  }

  private _simplify(pts: Point[]): Point[] {
    if (pts.length <= 2) return pts;
    const view = this._deps.getView();
    const res = (view as any).resolution as number | undefined;
    const tolPx = Number(this._deps.getSettings()?.stylus?.freehand?.simplifyTolerancePx ?? 4);
    if (!res || !isFinite(res) || tolPx <= 0) return pts; // 3D / unknown resolution → keep deduped raw
    const maxDeviation = tolPx * res; // view.resolution is in SR units / px, matching generalize's default units
    try {
      const line = new Polyline({
        paths: [pts.map((p) => [p.x, p.y])],
        spatialReference: view.spatialReference,
      });
      const gen = geometryEngine.generalize(line, maxDeviation, true) as Polyline;
      const path = gen?.paths?.[0];
      if (path && path.length >= 2) {
        return path.map((c) => new Point({ x: c[0], y: c[1], spatialReference: view.spatialReference }));
      }
    } catch {
      /* fall through to raw points */
    }
    return pts;
  }

  // ── Preview (SKETCH layer; NOT the symbol's private geometry) ───────────────
  private _renderPreview(): void {
    const s = this._session;
    if (!s) return;
    const view = this._deps.getView();
    const layer = this._sketchLayer();
    if (!layer) return;
    if (s.points.length < 2) {
      if (s.previewGraphic) {
        layer.remove(s.previewGraphic);
        s.previewGraphic = null;
      }
      return;
    }
    const isArea = s.currentSymbol.SymGeoType === 'Area';
    const coords = s.points.map((p) => [p.x, p.y]);
    const geom: any = isArea
      ? new Polygon({ rings: [[...coords, coords[0]]], spatialReference: view.spatialReference })
      : new Polyline({ paths: [coords], spatialReference: view.spatialReference });
    if (!s.previewGraphic) {
      s.previewGraphic = new Graphic({ geometry: geom, symbol: isArea ? PREVIEW_FILL : PREVIEW_LINE });
      layer.add(s.previewGraphic);
    } else {
      s.previewGraphic.geometry = geom;
    }
  }

  private _renderVertices(): void {
    const s = this._session;
    if (!s) return;
    const layer = this._sketchLayer();
    if (!layer) return;
    for (const g of s.vertexGraphics) layer.remove(g);
    s.vertexGraphics = [];
    for (const p of s.points) {
      const g = new Graphic({ geometry: p, symbol: VERTEX_SYM });
      layer.add(g);
      s.vertexGraphics.push(g);
    }
  }

  private _resetPointsKeepArmed(): void {
    const s = this._session;
    if (!s) return;
    const layer = this._sketchLayer();
    if (layer) {
      if (s.previewGraphic) layer.remove(s.previewGraphic);
      for (const g of s.vertexGraphics) layer.remove(g);
    }
    s.previewGraphic = null;
    s.vertexGraphics = [];
    s.points = [];
  }

  // ── Finish / Undo / Cancel toolbar (tap mode) ───────────────────────────────
  private _showToolbar(includeUndo: boolean = true): void {
    const view = this._deps.getView();
    const container = view.container as HTMLElement | null;
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'ms-stylus-toolbar';
    el.style.cssText =
      'position:absolute;z-index:50;display:flex;gap:6px;padding:6px;border-radius:8px;' +
      'background:rgba(20,24,30,0.92);box-shadow:0 2px 8px rgba(0,0,0,0.45);' +
      'font:600 13px/1 system-ui,sans-serif;color:#e6edf3;top:12px;left:50%;transform:translateX(-50%);' +
      'touch-action:none;user-select:none;align-items:center;';
    // Baseline-first symbols take their first two taps as the baseline — cue it.
    if (isBaselineClass(this._session?.currentSymbol?.Class)) {
      const hint = document.createElement('span');
      hint.textContent = '① end  ② centre  ③+ effect';
      hint.style.cssText = 'margin-right:4px;opacity:0.85;font-weight:500;';
      el.appendChild(hint);
    }
    el.appendChild(this._mkBtn('✓ Finish', '#1f6feb', () => this.finish()));
    if (includeUndo) el.appendChild(this._mkBtn('⤺ Undo', '#30363d', () => this.undoLast()));
    el.appendChild(this._mkBtn('✕ Cancel', '#30363d', () => this.cancel()));
    // Keep button taps from reaching the map (would add a stray vertex).
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('pointerup', (e) => e.stopPropagation());
    container.appendChild(el);
    this._toolbarEl = el;
  }

  private _mkBtn(label: string, bg: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      `border:0;border-radius:6px;padding:7px 11px;cursor:pointer;color:#fff;background:${bg};` +
      'font:inherit;touch-action:none;';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private _positionToolbar(): void {
    const s = this._session;
    if (!s || !this._toolbarEl) return;
    const last = s.points[s.points.length - 1];
    if (!last) return;
    const view = this._deps.getView();
    const sp = view.toScreen(last as any);
    if (!sp) return;
    // Float just above the most-recent vertex; clamp inside the container.
    const el = this._toolbarEl;
    el.style.left = `${Math.max(8, sp.x)}px`;
    el.style.top = `${Math.max(8, sp.y - 56)}px`;
    el.style.transform = 'translateX(-50%)';
  }

  private _removeToolbar(): void {
    if (this._toolbarEl?.parentElement) this._toolbarEl.parentElement.removeChild(this._toolbarEl);
    this._toolbarEl = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  deactivate(): void {
    const s = this._session;
    if (s) {
      if (s.nativeOnEnd) {
        try {
          s.symbol?.off?.('onDrawEnd', s.nativeOnEnd);
        } catch {
          /* no-op */
        }
      }
      for (const h of s.handles) {
        try {
          h.remove();
        } catch {
          /* no-op */
        }
      }
      const layer = this._sketchLayer();
      if (layer) {
        if (s.previewGraphic) layer.remove(s.previewGraphic);
        for (const g of s.vertexGraphics) layer.remove(g);
      }
    }
    this._removeToolbar();
    this._session = null;
  }

  onViewChanged(_view: View): void {
    // Capture handles + toolbar are bound to the old view/container; drop the
    // session. getView()/getLayerManager() read fresh on the next begin().
    this.deactivate();
  }

  destroy(): void {
    this.deactivate();
    if (this._winPointerDown && typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this._winPointerDown, true);
      this._winPointerDown = null;
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  private _sketchLayer(): GraphicsLayer | null {
    try {
      return this._deps.getLayerManager().getOrCreateLayer(LAYER_NAMES.SKETCH);
    } catch {
      return null;
    }
  }

  private _toPoint(mp: any): Point {
    return new Point({ x: mp.x, y: mp.y, spatialReference: this._deps.getView().spatialReference });
  }

  private _tapTolerancePx(): number {
    return Number(this._deps.getSettings()?.stylus?.tap?.tapTolerancePx ?? 6);
  }
}
