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
import PremiumStylus from './PremiumStylus';
import EngineLogger from '../../Support/EngineLogger';

// Default OFF. Enable via Settings.json → stylus.debug = true, or
// window.__stylusDebug = true, to trace the tablet-side pointer flow through
// the Engine Log panel.
function stylusDebug(deps: { getSettings: () => any }): boolean {
  try {
    if (typeof window !== 'undefined' && (window as any).__stylusDebug) return true;
    return !!deps.getSettings?.()?.stylus?.debug;
  } catch {
    return false;
  }
}

type View = MapView | SceneView;
type Paradigm = 'freehand' | 'tap' | 'native' | 'scrub';
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

// A pen contact within this window means the user is actively drawing with the
// pen — touch drags then PAN the map in scrub mode (Procreate convention)
// instead of starting a stroke. Composes with premium palm rejection, which
// separately drops quick-after-pen touch contacts entirely.
const PEN_ACTIVE_MS = 2500;

export default class StylusDrawController {
  private _deps: StylusDrawDeps;
  private _lastPointerType: string = 'mouse';
  private _lastPenTs = -Infinity;
  private _session: Session | null = null;
  private _toolbarEl: HTMLDivElement | null = null;
  private _hintEl: HTMLDivElement | null = null;
  private _hintShown = false;
  private _winPointerDown: ((e: PointerEvent) => void) | null = null;
  private _premium: PremiumStylus | null = null;

  constructor(deps: StylusDrawDeps) {
    this._deps = deps;
    // Persistent capture-phase probe so we know the input device BEFORE a draw
    // starts — crucially, this needs no hover (works for passive pens / touch).
    if (typeof window !== 'undefined') {
      this._winPointerDown = (e: PointerEvent) => {
        if (e.pointerType) this._lastPointerType = e.pointerType;
        if (e.pointerType === 'pen') this._lastPenTs = this._now();
      };
      window.addEventListener('pointerdown', this._winPointerDown, true);
    }
  }

  private _now(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  /** A pen touched the surface recently — the user is drawing with the pen. */
  private _penActive(): boolean {
    return this._now() - this._lastPenTs < PEN_ACTIVE_MS;
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
    if (p === 'scrub') return 'scrub';
    return 'freehand';
  }

  /**
   * True when this draw should run through the symbol's OWN interactive draw
   * (real createSymbol preview + native baseline phase) rather than begin()'s
   * freehand/tap capture. SymbolEngine uses this to pick the fork. Covers both
   * 'native' (tap per vertex) and 'scrub' (freehand gesture feeding the native
   * draw) — scrub only adds a drag capture on top of the same machinery.
   */
  usesNativeDraw(currentSymbol: CurrentSymbol | undefined): boolean {
    if (!this.shouldEngage(currentSymbol) || !currentSymbol) return false;
    const p = this.resolveParadigm(currentSymbol);
    return p === 'native' || p === 'scrub';
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
    const paradigm = this.resolveParadigm(currentSymbol);
    const session: Session = {
      symbol,
      marker: null,
      drawEssentials: null,
      currentSymbol,
      paradigm,
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

    // Premium layer (glide cursor, smoothing, snap-to-cursor, palm rejection,
    // dwell-to-finish) — only when enabled. It composes ON TOP of the native
    // draw; it never replaces geometry. Strictly draw-time: we're already inside
    // the !isPassive interactive branch, and it is torn down in deactivate().
    const premiumOn = this._deps.getSettings()?.stylus?.premium?.enabled !== false;
    if (premiumOn) {
      this._premium = new PremiumStylus({
        getView: () => this._deps.getView(),
        getSettings: () => this._deps.getSettings(),
        finishNativeDraw: (screen) =>
          this._deps.finishNativeDraw?.(screen ?? this._session?.lastScreen ?? null),
        emitHoverAt: (x, y) => this._emitSyntheticHover(x, y),
        // Authoritative — updated on every pointerdown via a persistent
        // capture-phase window probe, so it's correct on the very first touch
        // tap (where pointer-move never fires beforehand).
        getPointerType: () => this._lastPointerType,
      });
      this._premium.attach(symbol, currentSymbol);
    }

    if (stylusDebug(this._deps)) {
      EngineLogger.nextStep(
        'Stylus Native',
        `attachNative class=${currentSymbol?.Class} pt=${this._lastPointerType} premium=${!!this._premium}`,
      );
    }

    if (stylusDebug(this._deps)) {
      // Diagnostic-only: see whether raw pointer events even reach the view on
      // this tablet, and whether ArcGIS classifies the tap as a drag (which
      // would suppress 'click'). Never stopPropagation — this is read-only.
      session.handles.push(
        view.on('pointer-down' as any, (evt: any) => {
          EngineLogger.nextStep(
            'Stylus Native',
            `view pointer-down x=${evt.x} y=${evt.y} pt=${evt?.native?.pointerType} btn=${evt.button}`,
          );
        }),
      );
      session.handles.push(
        view.on('pointer-up' as any, (evt: any) => {
          EngineLogger.nextStep(
            'Stylus Native',
            `view pointer-up x=${evt.x} y=${evt.y} pt=${evt?.native?.pointerType}`,
          );
        }),
      );
      session.handles.push(
        view.on('drag' as any, (evt: any) => {
          EngineLogger.nextStep(
            'Stylus Native',
            `view drag action=${evt.action} x=${evt.x} y=${evt.y} pt=${evt?.native?.pointerType ?? evt.pointerType}`,
          );
        }),
      );
      // Witness: an independent pointer-move listener. Real hover AND our
      // synthetic dispatch should BOTH fire this. If our emitHover logs "ok"
      // but this witness never fires with pointerId=99999, ArcGIS is dropping
      // the synthetic event in its own pipeline (a real regression from what
      // the memory noted worked on desktop).
      session.handles.push(
        view.on('pointer-move' as any, (evt: any) => {
          const nat = evt?.native as PointerEvent | undefined;
          EngineLogger.nextStep(
            'Stylus Native',
            `view pointer-move x=${evt.x?.toFixed?.(0)} y=${evt.y?.toFixed?.(0)} pt=${nat?.pointerType ?? evt.pointerType} id=${nat?.pointerId} trusted=${nat?.isTrusted}`,
          );
        }),
      );
    }

    // Passive observer — the symbol's own click handler (registered in init(),
    // BEFORE this attach) adds the control point; we never stopPropagation, we
    // only watch so we can record the finish location and drive a touch preview.
    session.handles.push(
      view.on('click', (evt: any) => {
        // Leak insurance: a view click whose screen point falls inside the
        // toolbar is a tap on OUR UI that escaped into ArcGIS's pipeline —
        // never treat it as a map point (it would corrupt lastScreen, and the
        // Finish re-emission would land a vertex under the button).
        if (this._isInsideToolbar(evt.x, evt.y)) {
          if (stylusDebug(this._deps)) {
            EngineLogger.error('Stylus Native', `click LEAKED from toolbar x=${evt.x} y=${evt.y} — ignored`);
          }
          return;
        }
        session.lastScreen = { x: evt.x, y: evt.y };
        if (stylusDebug(this._deps)) {
          EngineLogger.nextStep(
            'Stylus Native',
            `click x=${evt.x} y=${evt.y} pt=${evt?.native?.pointerType ?? this._lastPointerType}`,
          );
        }
        if (this._premium?.isActive) {
          // Premium owns the (smoothed / snapped) touch preview + glide cursor.
          this._premium.onTap(evt.x, evt.y);
        } else if (this._lastPointerType !== 'mouse') {
          // Plain native: touch has no hover, so nudge the symbol's move handler
          // with a synthetic pointer-move at the just-tapped point.
          this._emitSyntheticHover(evt.x, evt.y);
        }
      }),
    );

    // Fallback trigger: if 'click' never fires on this tablet (e.g. ArcGIS treats
    // touch as a drag), a same-spot pointer-down → pointer-up pair also drives
    // the symbol's own click handler indirectly via ArcGIS, but at minimum we
    // want the synthetic hover to fire. Use immediate-click so the 300 ms
    // double-click delay never eats the tap.
    try {
      session.handles.push(
        (view as any).on('immediate-click', (evt: any) => {
          if (stylusDebug(this._deps)) {
            EngineLogger.nextStep(
              'Stylus Native',
              `immediate-click x=${evt.x} y=${evt.y} pt=${evt?.native?.pointerType ?? this._lastPointerType}`,
            );
          }
          // Only trigger the synthetic-hover nudge if we're on touch AND premium
          // isn't going to do it (premium.onTap runs from 'click'). This is a
          // pure diagnostic path when 'click' turns out to be missing on tablet.
          if (!this._premium?.isActive && this._lastPointerType === 'touch') {
            this._emitSyntheticHover(evt.x, evt.y);
          }
        }),
      );
    } catch {
      /* older builds may not expose immediate-click */
    }

    // Auto-clear when the draw finishes by ANY route (double-tap, Finish button,
    // or a click-count terminator). Guarded inside deactivate() / re-entrancy.
    const onEnd = () => this.deactivate();
    session.nativeOnEnd = onEnd;
    try {
      symbol.on?.('onDrawEnd', onEnd);
    } catch {
      /* symbol without a public .on still finishes via SymbolEngine's bus */
    }

    // Scrub capture: freehand press-drag-lift gesture committing vertices into
    // this same native draw (live real-symbol preview + premium layer intact).
    // Installed on EVERY native-mode session but gated on session.paradigm at
    // event time, so the toolbar's ✏ Draw / ⊙ Points chip can switch modes
    // mid-draw without re-attaching anything.
    this._installScrub(session);

    // Tablet rescue: some tablets classify a stationary tap as a micro-drag and
    // never emit 'click' — the native draw goes dead. Self-disarming fallback.
    this._installTapFallback(session);

    if (this._deps.getSettings()?.stylus?.tap?.showFinishToolbar !== false) {
      // Undo is always offered: premium seam or the direct removeLastPoint
      // fallback in undoLast() covers every drawable symbol (uniform sweep).
      this._showToolbar(
        !!this._premium?.canUndo || typeof symbol?.removeLastPoint === 'function',
      );
    }
  }

  // ── Scrub: freehand gesture driving the symbol's OWN live preview ────────────
  /**
   * Fourth paradigm — the press-drag-lift gesture of 'freehand', but the live
   * preview is the REAL symbol (the native interactive draw is running, so the
   * premium cursor / smoothing / snap layer applies unchanged). While dragging,
   * a vertex is committed by re-emitting the symbol's own 'click' whenever the
   * stroke bows away from the straight segment since the last vertex by more
   * than stylus.scrub.tolerancePx — a live Douglas-Peucker, so straight runs
   * stay sparse and curves gain vertices. Between commits a synthetic hover
   * drives the symbol's rubber-band (real hover never fires mid-drag). Lift
   * commits the final point and finishes via the native double-click
   * terminator. Stationary taps still add vertices (ArcGIS emits a real click
   * for those), so scrub degrades gracefully into the native paradigm.
   */
  private _installScrub(session: Session): void {
    const view = this._deps.getView();
    let stroking = false;
    let lastVertex: { x: number; y: number } | null = null; // last committed, screen px
    let samples: { x: number; y: number }[] = [];
    let startOrigin: { x: number; y: number } | null = null; // drag-start screen px
    let committed = 0; // vertices committed during THIS stroke (start = 1)

    session.handles.push(
      view.on('drag', (evt: any) => {
        if (this._session !== session) return;
        if (evt.action === 'start') {
          // Only the scrub paradigm captures strokes; in ⊙ Points mode drags
          // stay with the map (pan), exactly like the plain native paradigm.
          if (session.paradigm !== 'scrub') return;
          // Leave right/middle-button drags (rotate / classic pan) to the map.
          if (evt.button !== undefined && evt.button !== 0) return;
          // Pen draws, finger pans: while the pen is in active use, a touch
          // drag moves the map instead of starting a stroke.
          const ptype = evt?.native?.pointerType ?? this._lastPointerType;
          if (ptype === 'touch' && this._penActive()) return;
          stroking = true;
          evt.stopPropagation(); // suppress map pan for this stroke
          const x = evt.origin?.x ?? evt.x;
          const y = evt.origin?.y ?? evt.y;
          samples = [];
          startOrigin = { x, y };
          lastVertex = this._emitSyntheticClick(x, y) ? { x, y } : null;
          committed = lastVertex ? 1 : 0;
          return;
        }
        if (!stroking) return;
        evt.stopPropagation();
        if (!isFinite(evt.x) || !isFinite(evt.y)) return;

        if (evt.action === 'update') {
          if (!lastVertex) {
            // Start landed off-map (3D off-globe) — retry the first vertex here.
            lastVertex = this._emitSyntheticClick(evt.x, evt.y) ? { x: evt.x, y: evt.y } : null;
            if (lastVertex) {
              startOrigin = lastVertex;
              committed = 1;
            }
            return;
          }
          const prev = samples[samples.length - 1] ?? lastVertex;
          if (Math.hypot(evt.x - prev.x, evt.y - prev.y) < FREEHAND_MIN_PX) return;
          samples.push({ x: evt.x, y: evt.y });
          const cur = { x: evt.x, y: evt.y };
          if (this._maxDeviationPx(lastVertex, cur, samples) > this._scrubTolerancePx()) {
            if (this._emitSyntheticClick(cur.x, cur.y)) {
              lastVertex = cur;
              samples = [];
              committed++;
            }
          }
          // Live rubber band between commits — drive the symbol's move handler.
          this._emitSyntheticHover(evt.x, evt.y);
          return;
        }

        if (evt.action === 'end') {
          stroking = false;
          const last = lastVertex;
          const origin = startOrigin;
          lastVertex = null;
          samples = [];
          startOrigin = null;
          if (!last) return; // whole stroke off-map — stay armed
          session.lastScreen = { x: evt.x, y: evt.y };
          // Distinguish a genuine stroke from a stylus TAP that the tablet
          // reported as a micro-drag. A tap (only the start vertex committed and
          // negligible travel) must NOT finish — the start-click already placed
          // the vertex, so leave it and stay armed. Successive taps then
          // accumulate exactly like native tap-to-place; the user completes via
          // the ✓ Finish button / Enter / double-tap. Without this, every tap
          // becomes a one-vertex stroke that immediately tries (and fails) to
          // finish, so nothing draws until a real drag happens.
          const netTravel = origin
            ? Math.hypot(evt.x - origin.x, evt.y - origin.y)
            : 0;
          const genuineStroke = committed >= 2 || netTravel > this._tapTolerancePx();
          if (!genuineStroke) {
            // Render the just-placed vertex (pen may not hover) and stay armed.
            this._emitSyntheticHover(evt.x, evt.y);
            return;
          }
          // Final vertex at the lift point, then the native terminator (mirrors
          // the Finish button; a doubled last point is already tolerated).
          if (Math.hypot(evt.x - last.x, evt.y - last.y) >= FREEHAND_MIN_PX) {
            this._emitSyntheticClick(evt.x, evt.y);
          }
          this._deps.finishNativeDraw?.({ x: evt.x, y: evt.y });
        }
      }),
    );
  }

  /**
   * Re-emit the symbol's own 'click' on the view event bus — the same trick as
   * the native double-click terminator (SymbolEngine._finishActiveDraw) — so
   * the vertex is added by the symbol's OWN handler: DrawSeam resolution,
   * click-count terminators and baseline phases all behave exactly like a real
   * tap. Returns false when the point can't be resolved (off-globe).
   */
  private _emitSyntheticClick(x: number, y: number): boolean {
    const view: any = this._deps.getView();
    let mapPoint: any = null;
    try {
      mapPoint = view.toMap({ x, y });
    } catch {
      mapPoint = null;
    }
    if (!mapPoint) return false;
    try {
      view.emit('click', {
        x,
        y,
        mapPoint,
        button: 0,
        buttons: 0,
        native: { pointerType: this._lastPointerType || 'pen' },
        // Marks the event as ours: the tap fallback must not read synthetic
        // clicks as proof that the device delivers real ones.
        _msSynthetic: true,
        stopPropagation() {},
        preventDefault() {},
      });
      return true;
    } catch (err) {
      if (stylusDebug(this._deps)) {
        EngineLogger.error('Stylus Scrub', `emitClick THREW ${String((err as any)?.message ?? err)}`);
      }
      return false;
    }
  }

  /** Max perpendicular deviation (px) of the samples from the segment a→b. */
  private _maxDeviationPx(
    a: { x: number; y: number },
    b: { x: number; y: number },
    pts: { x: number; y: number }[],
  ): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let max = 0;
    for (const p of pts) {
      const d =
        len < 1e-6
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (d > max) max = d;
    }
    return max;
  }

  private _scrubTolerancePx(): number {
    const s = this._deps.getSettings()?.stylus?.scrub ?? {};
    // Novice-friendly presets; the raw pixel number applies on 'custom' (or
    // when the preset is absent, preserving pre-preset configs).
    if (s.detail === 'smooth') return 10;
    if (s.detail === 'balanced') return 6;
    if (s.detail === 'fine') return 3;
    return Number(s.tolerancePx ?? 6);
  }

  // ── Tablet tap fallback (native / scrub sessions) ────────────────────────────
  /**
   * Failure mode seen on some tablets: ArcGIS classifies a stationary pen/touch
   * tap as a micro-drag and never emits 'click', so the symbol's own click
   * handler never runs and the native draw is completely dead. Rescue: watch raw
   * pointer-down/up pairs; when a qualifying tap (small travel, short press,
   * pen/touch, outside the toolbar) produces no REAL click or double-click
   * within stylus.native.tapFallbackMs, commit the vertex by re-emitting the
   * symbol's own 'click' (bus emit, as everywhere else).
   *
   * Self-disarming: the first real click proves the device delivers clicks and
   * turns the fallback off for the whole session — on healthy hardware it can
   * never fire, so there is no duplicate-vertex risk (ArcGIS's ~250 ms click
   * delay sits well inside the default 400 ms window). Synthetic clicks carry
   * the _msSynthetic marker and don't count as proof.
   */
  private _installTapFallback(session: Session): void {
    const windowMs = Number(this._deps.getSettings()?.stylus?.native?.tapFallbackMs ?? 400);
    if (windowMs <= 0) return;
    const view = this._deps.getView();
    let downAt: { x: number; y: number; t: number } | null = null;
    let clicksWork = false;
    const pending = new Set<any>();
    const clearPending = () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
    const now = () =>
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

    session.handles.push(
      view.on('pointer-down', (evt: any) => {
        if (clicksWork || evt.button !== 0) return;
        if (this._lastPointerType === 'mouse') return; // mouse clicks are reliable
        if (this._isInsideToolbar(evt.x, evt.y)) return;
        downAt = { x: evt.x, y: evt.y, t: now() };
      }),
    );

    session.handles.push(
      view.on('pointer-up', (evt: any) => {
        const d = downAt;
        downAt = null;
        if (clicksWork || !d) return;
        if (Math.hypot(evt.x - d.x, evt.y - d.y) > this._tapTolerancePx()) return; // pan
        if (now() - d.t > 600) return; // long-press ≠ tap
        const x = evt.x;
        const y = evt.y;
        const timer = setTimeout(() => {
          pending.delete(timer);
          // Session ended (draw finished/cancelled) or a later real click
          // disarmed us while the timer was in flight.
          if (this._session !== session || clicksWork) return;
          if (stylusDebug(this._deps)) {
            EngineLogger.nextStep(
              'Stylus Native',
              `tap fallback FIRED x=${x} y=${y} (no click within ${windowMs}ms)`,
            );
          }
          // The session's own 'click' observer handles the side effects
          // (lastScreen, premium.onTap / synthetic hover) — same as a real tap.
          this._emitSyntheticClick(x, y);
        }, windowMs);
        pending.add(timer);
      }),
    );

    const disarm = (evt: any) => {
      if (evt?._msSynthetic) return; // our own emission proves nothing
      clicksWork = true;
      clearPending();
    };
    session.handles.push(view.on('click', disarm));
    session.handles.push(view.on('double-click', disarm));

    // Scrub handles drags itself (drag start commits a vertex) — a pending tap
    // that turns into a stroke must not also fallback-commit. In ⊙ Points mode
    // a micro-drag is exactly the broken-click signature, so there the
    // pointer-up distance gate alone decides. Checked at event time because the
    // toolbar chip can switch session.paradigm mid-draw.
    session.handles.push(
      view.on('drag', (evt: any) => {
        if (session.paradigm !== 'scrub') return;
        if (evt.action === 'start') {
          downAt = null;
          clearPending();
        }
      }),
    );

    // Timers are cleared with the session (handles can't carry timeouts).
    session.handles.push({ remove: clearPending });
  }

  /**
   * Drive every view.on('pointer-move') handler (the symbol's preview, premium
   * cursor, proximity, cues) with a synthetic hover so a no-hover (touch) tap —
   * or a mid-drag scrub — still updates the symbol's createSymbol preview.
   *
   * Primary path: emit straight on the VIEW EVENT BUS — the same proven trick
   * as the click / double-click re-emission. Delivery to view.on handlers is
   * synchronous and deterministic, and it does not depend on ArcGIS's DOM input
   * pipeline lacking an isTrusted gate (which an SDK upgrade could add).
   * Fallback: the original DOM 'pointermove' dispatch on the view surface.
   * Either way a sentinel pointerId is used so no drag / device state is
   * affected.
   */
  private _emitSyntheticHover(x: number, y: number): void {
    const view = this._deps.getView();
    const dbg = stylusDebug(this._deps);
    try {
      (view as any).emit('pointer-move', {
        x,
        y,
        button: 0,
        buttons: 0,
        pointerType: this._lastPointerType || 'touch',
        native: {
          pointerType: this._lastPointerType || 'touch',
          pointerId: 99999,
          isPrimary: true,
          isTrusted: false,
        },
        stopPropagation() {},
        preventDefault() {},
      });
      if (dbg) {
        EngineLogger.success(
          'Stylus Native',
          `emitHover bus ok pt=${this._lastPointerType} x=${x.toFixed(0)} y=${y.toFixed(0)}`,
        );
      }
      return;
    } catch (err) {
      if (dbg) {
        EngineLogger.error(
          'Stylus Native',
          `emitHover bus THREW ${String((err as any)?.message ?? err)} — falling back to DOM dispatch`,
        );
      }
    }
    const container = view.container as HTMLElement | null;
    if (!container) {
      if (dbg) EngineLogger.error('Stylus Native', 'emitHover ABORT no container');
      return;
    }
    const surface =
      (container.querySelector('.esri-view-surface') as HTMLElement | null) ?? container;
    const usingSurface = surface !== container;
    const rect = surface.getBoundingClientRect();
    const clientX = rect.left + x;
    const clientY = rect.top + y;
    try {
      surface.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX,
          clientY,
          bubbles: true,
          cancelable: true,
          pointerType: this._lastPointerType || 'touch',
          pointerId: 99999,
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      );
      if (dbg) {
        EngineLogger.success(
          'Stylus Native',
          `emitHover ok pt=${this._lastPointerType} surfaceEl=${usingSurface} client=${clientX.toFixed(0)},${clientY.toFixed(0)}`,
        );
      }
    } catch (err) {
      if (dbg) EngineLogger.error('Stylus Native', `emitHover THREW ${String((err as any)?.message ?? err)}`);
      /* PointerEvent unsupported → no touch preview, not fatal */
    }
  }

  /** Screen point (view coords) inside the floating toolbar's current rect? */
  private _isInsideToolbar(x: number, y: number): boolean {
    const el = this._toolbarEl;
    if (!el) return false;
    const container = this._deps.getView().container as HTMLElement | null;
    if (!container) return false;
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cx = c.left + x;
    const cy = c.top + y;
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
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
    if (!s) return;
    if (s.mode === 'native') {
      // Native draw: the symbol owns its points — undo via the premium seam,
      // or hit the uniform removeLastPoint() seam directly when the premium
      // layer is disabled (Undo must ALWAYS work; it's the novice safety net).
      if (this._premium?.undo()) return;
      try {
        if (s.symbol?.removeLastPoint?.() && s.lastScreen) {
          this._emitSyntheticHover(s.lastScreen.x, s.lastScreen.y);
        }
      } catch {
        /* no-op */
      }
      return;
    }
    if (s.points.length === 0) return;
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

  // ── Finish / Undo / Cancel toolbar (tap + native/scrub modes) ───────────────
  private _showToolbar(includeUndo: boolean = true): void {
    const view = this._deps.getView();
    const container = view.container as HTMLElement | null;
    if (!container) return;
    // Finger-sized targets whenever the last physical input wasn't a mouse.
    const touchUI = this._lastPointerType !== 'mouse';
    const el = document.createElement('div');
    el.className = 'ms-stylus-toolbar';
    el.style.cssText =
      'position:absolute;z-index:50;display:flex;gap:6px;padding:6px;border-radius:8px;' +
      'background:rgba(20,24,30,0.92);box-shadow:0 2px 8px rgba(0,0,0,0.45);' +
      `font:600 ${touchUI ? 15 : 13}px/1 system-ui,sans-serif;color:#e6edf3;top:12px;left:50%;transform:translateX(-50%);` +
      'touch-action:none;user-select:none;align-items:center;';
    // ✏ Draw / ⊙ Points chip — native-mode sessions only. Novices switch modes
    // right where they draw instead of hunting through settings; the choice
    // sticks as the new default.
    if (this._session?.mode === 'native') this._appendModeChip(el, touchUI);
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
    // Keep toolbar taps from reaching the map (a leaked tap becomes a stray
    // vertex). Block the WHOLE event family: on touch browsers a tap also
    // produces touchstart/touchend and compatibility mouse events, and blocking
    // only pointer* + click leaves those paths open into ArcGIS's pipeline.
    for (const type of [
      'pointerdown',
      'pointerup',
      'pointercancel',
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'touchstart',
      'touchend',
      'contextmenu',
    ]) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
    container.appendChild(el);
    this._toolbarEl = el;
    this._maybeShowHint(container, touchUI);
  }

  /** Segmented ✏ Draw / ⊙ Points control that flips session.paradigm live. */
  private _appendModeChip(toolbar: HTMLDivElement, touchUI: boolean): void {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex;border:1px solid #30363d;border-radius:6px;overflow:hidden;margin-right:4px;';
    const mk = (label: string, mode: 'scrub' | 'native') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.mode = mode;
      b.style.cssText =
        `border:0;padding:${touchUI ? '12px 16px' : '6px 10px'};cursor:pointer;` +
        'font:inherit;touch-action:none;background:transparent;color:#9da7b3;';
      // pointerup (not click) for the same tablet-responsiveness reason as _mkBtn.
      b.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._setSessionParadigm(mode);
        paint();
      });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      return b;
    };
    const scrubBtn = mk('✏ Draw', 'scrub');
    const tapBtn = mk('⊙ Points', 'native');
    const paint = () => {
      const cur = this._session?.paradigm === 'scrub' ? 'scrub' : 'native';
      for (const b of [scrubBtn, tapBtn]) {
        const active = b.dataset.mode === cur;
        b.style.background = active ? '#1f6feb' : 'transparent';
        b.style.color = active ? '#fff' : '#9da7b3';
      }
    };
    paint();
    wrap.appendChild(scrubBtn);
    wrap.appendChild(tapBtn);
    toolbar.appendChild(wrap);
  }

  private _setSessionParadigm(p: 'scrub' | 'native'): void {
    const s = this._session;
    if (s) s.paradigm = p;
    // Persist as the new global default — same live-settings write the
    // harness's per-symbol override control uses — so the choice sticks.
    try {
      const st = this._deps.getSettings();
      if (st?.stylus) st.stylus.paradigm = p;
    } catch {
      /* no-op */
    }
  }

  /** One-time transient coach line under the toolbar — then never again. */
  private _maybeShowHint(container: HTMLElement, touchUI: boolean): void {
    if (this._hintShown || this._session?.mode !== 'native') return;
    this._hintShown = true;
    const scrub = this._session?.paradigm === 'scrub';
    const hint = document.createElement('div');
    hint.className = 'ms-stylus-hint';
    hint.textContent = scrub
      ? 'Drag to sketch — lift to finish. Tap to place single points.'
      : 'Tap to place points — ✓ Finish when done.';
    hint.style.cssText =
      `position:absolute;z-index:49;top:${touchUI ? 74 : 58}px;left:50%;transform:translateX(-50%);` +
      'padding:7px 14px;border-radius:14px;background:rgba(20,24,30,0.85);color:#c9d4df;' +
      'font:500 13px/1.3 system-ui,sans-serif;pointer-events:none;white-space:nowrap;' +
      'opacity:1;transition:opacity 0.6s ease;';
    container.appendChild(hint);
    this._hintEl = hint;
    setTimeout(() => {
      hint.style.opacity = '0';
    }, 5500);
    setTimeout(() => {
      if (hint.parentElement) hint.parentElement.removeChild(hint);
      if (this._hintEl === hint) this._hintEl = null;
    }, 6200);
  }

  private _mkBtn(label: string, bg: string, onClick: () => void): HTMLButtonElement {
    const touchUI = this._lastPointerType !== 'mouse';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      `border:0;border-radius:6px;padding:${touchUI ? '12px 18px' : '7px 11px'};cursor:pointer;color:#fff;background:${bg};` +
      'font:inherit;touch-action:none;';
    // Act on pointerup, not click: on tablets the browser may never synthesize a
    // click for the button (slop / preventDefault upstream), and ArcGIS's own
    // ~250 ms click delay makes click-based UI feel dead. pointerup is instant
    // and fires for pen, touch, and mouse alike.
    let fired = false;
    b.addEventListener('pointerup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (fired) return;
      fired = true;
      // Swallow the follow-up click; re-arm for the next tap.
      setTimeout(() => (fired = false), 400);
      onClick();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!fired) onClick(); // mouse/browser path where pointerup was eaten
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
    if (this._hintEl?.parentElement) this._hintEl.parentElement.removeChild(this._hintEl);
    this._hintEl = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  deactivate(): void {
    // Premium layer first — it owns DOM overlays + capture-phase listeners.
    if (this._premium) {
      try {
        this._premium.detach();
      } catch {
        /* no-op */
      }
      this._premium = null;
    }
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
