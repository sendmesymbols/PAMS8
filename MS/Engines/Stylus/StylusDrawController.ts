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

// Line/area symbols whose immediate-placement createSymbol() reads CTRL_PTS as
// [chordStart, chordEnd, curvatureCandidate, ...] — a three-point circle fit
// through the first two points (the flanks of a curved boundary) and a third
// "bulge" point — rather than as ordered vertices along a path (verified by
// reading each createSymbol()'s CTRL_PTS[0]/[1]/[2] usage). This is the OTHER
// shape of "two points first, then the real symbol": with the classic mouse
// click handler, click 1 + click 2 render a straight line (the temp graphic)
// that "vanishes" the instant click 3 supplies the curvature and the arc
// appears — same interaction the user described for BASE_LN_PTS symbols, just
// implemented inline instead of via the separate BaseLine helper class.
// A freehand stroke or a sequence of taps instead captures points in TRACE
// order (first tap = one flank, interior taps = along the bulge, last tap =
// the other flank) — see _reorderArcPoints, which remaps trace order into the
// [start, end, bulge] triple these classes expect.
const ARC_CANDIDATE_CLASSES = new Set<string>([
  'Ambush',
  'Contain',
  'Delay',
  'Withdraw',
  'WithdrawUnderPressure',
  'Retire',
  'ArcOfFireSD',
  'FreehandSemiCircle',
  'FreehandSemiCircleFilled',
]);

function isArcCandidateClass(cls: string | undefined): boolean {
  return !!cls && ARC_CANDIDATE_CLASSES.has(cls);
}

// A pen contact within this window means the user is actively drawing with the
// pen — touch drags then PAN the map in scrub mode (Procreate convention)
// instead of starting a stroke. Composes with premium palm rejection, which
// separately drops quick-after-pen touch contacts entirely.
const PEN_ACTIVE_MS = 2500;

// ── Toolbar presentation ──────────────────────────────────────────────────────
// The toolbar's job is to be reachable, not to be seen. It is a compact
// icon-only pill that rests at partial opacity, comes to full strength only when
// the user reaches for it, and all but vanishes mid-stroke — so a planning
// session is never framed by chrome.
//
// Styled from an injected stylesheet rather than inline cssText for what inline
// styles can't express: pseudo-class states (hover / focus-visible / active /
// disabled), density switching from a single data-touch attribute instead of a
// ternary at every property, and the reduced-motion + coarse-pointer queries.
// Only the live x/y position stays inline.
//
// Every colour reads from the ThemeManager custom properties on :root, so the
// pill follows Ops Dark / Night Vision / Sandstorm / Arctic / SIPR instead of
// hardcoding one dark palette (the previous fixed #1f6feb-on-#141e1e chrome
// inverted illegibly under the light Arctic theme and broke Night Vision's
// dark-adaptation intent). Fallbacks match Ops Dark for the case where
// ThemeManager never ran.
const TOOLBAR_STYLE_ID = 'ms-stylus-toolbar-styles';

// Exponential ease-out: state changes land immediately and settle. No bounce.
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

// How close a hovering pointer must come before the pill wakes to full opacity.
// Generous on touch, where there is no hover to rely on.
const TB_NEAR_PX = 90;
const TB_NEAR_PX_TOUCH = 130;

// Contact travel that turns a tap into a stroke. Below this the pill holds
// steady, so tapping vertices doesn't make it flicker.
const TB_STROKE_PX = 5;

// ── Icons ─────────────────────────────────────────────────────────────────────
// Drawn as stroked SVG on a 24×24 grid rather than the Unicode glyphs (✓ ⤺ ✕ ✏ ⊙)
// this toolbar used to print. Those resolve through the platform's symbol
// fallback font, which ships a single light weight — font-weight has no effect on
// them, so they render thin and inconsistent across Windows / iPadOS / Android.
// A stroke width is real geometry: it stays firm at every density, scales
// crisply, and inherits `currentColor`, so every existing button state (accent
// primary, danger hover, aria-pressed, disabled) applies unchanged.
//
// `dots` are zero-length round-capped paths — round dots at a heavier stroke,
// no <circle> special-casing needed.
const TB_ICONS: Record<string, { d?: string[]; dots?: [number, number][] }> = {
  finish: { d: ['M4.5 12.5 L9.5 17.5 L19.5 6.5'] },
  undo: { d: ['M9 14 L4 9 L9 4', 'M4 9 H14.5 A5.5 5.5 0 0 1 14.5 20 H11'] },
  // Drawn to a wider box than the check: crossed diagonals carry less visual
  // mass than orthogonal strokes, so an equal-sized X reads smaller.
  cancel: { d: ['M6 6 L18 18', 'M18 6 L6 18'] },
  draw: {
    d: ['M16.4 3.6 a2.12 2.12 0 0 1 3 3 L7.5 18.5 L3 20 L4.5 15.5 Z', 'M14.3 5.7 L17.3 8.7'],
  },
  points: { d: ['M5.5 12 a6.5 6.5 0 1 0 13 0 a6.5 6.5 0 1 0 -13 0'], dots: [[12, 12]] },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function mkIcon(name: keyof typeof TB_ICONS | string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true'); // the button's aria-label is the name
  svg.setAttribute('focusable', 'false'); // legacy IE/Edge tab-stop guard
  const spec = TB_ICONS[name];
  for (const d of spec?.d ?? []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  for (const [x, y] of spec?.dots ?? []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', `M${x} ${y} L${x} ${y}`);
    p.setAttribute('class', 'ms-stylus-dot');
    svg.appendChild(p);
  }
  return svg;
}

function injectToolbarStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(TOOLBAR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TOOLBAR_STYLE_ID;
  style.textContent = `
.ms-stylus-toolbar {
  --_tb-accent: var(--ms-accent, #64b4ff);
  --_tb-border: var(--ms-border, rgba(64, 140, 220, 0.35));
  --_tb-text: var(--ms-text, #b8c5d8);
  --_tb-danger: var(--ms-danger, #e24b4a);
  --_tb-fill: var(--ms-bg-input, rgba(255, 255, 255, 0.05));
  /* Density tokens — data-touch="1" retunes the whole pill from one place. */
  --_tb-size: 26px;
  --_tb-glyph: 15px;
  --_tb-stroke: 2.6;
  --_tb-pad: 3px;
  --_tb-gap: 2px;
  --_tb-radius: 6px;
  --_tb-rest: 0.5;

  position: absolute;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: var(--_tb-gap);
  padding: var(--_tb-pad);
  border: 1px solid var(--_tb-border);
  border-radius: calc(var(--_tb-radius) + var(--_tb-pad));
  background: var(--ms-bg, rgba(14, 17, 26, 0.97));
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  font-family: var(--ms-menu-font, 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif);
  line-height: 1;
  color: var(--_tb-text);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  /* Entry state; .is-in is added a tick after append. */
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
  transition: opacity 160ms ${EASE_OUT}, transform 160ms ${EASE_OUT};
}

/* Resting: present but recessive. */
.ms-stylus-toolbar.is-in {
  opacity: var(--_tb-rest);
  transform: none;
}
/* Reached for: hover, keyboard focus, or a pointer within TB_NEAR_PX. */
.ms-stylus-toolbar.is-in:hover,
.ms-stylus-toolbar.is-in:focus-within,
.ms-stylus-toolbar.is-in.is-near {
  opacity: 1;
}
/* Mid-stroke: out of sight AND out of the input path, so the pill can neither
   distract from the line being drawn nor swallow a vertex under the hand. */
.ms-stylus-toolbar.is-in.is-drawing {
  opacity: 0.07;
  pointer-events: none;
  transition: opacity 90ms linear;
}

/* Finger-sized targets whenever the last physical input wasn't a mouse. */
.ms-stylus-toolbar[data-touch='1'] {
  --_tb-size: 42px;
  --_tb-glyph: 20px;
  /* Slightly lighter in absolute terms at the larger size, so the icons read
     with the same visual weight rather than turning blobby. */
  --_tb-stroke: 2.35;
  --_tb-pad: 4px;
  --_tb-gap: 3px;
  --_tb-radius: 9px;
  --_tb-rest: 0.62;
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
/* Icon-only, one shape for every control. Hierarchy comes from an accent seat
   on the primary and a danger tint that only appears on intent — no
   full-saturation fills sitting on an idle control. */
.ms-stylus-btn {
  display: inline-grid;
  place-items: center;
  width: var(--_tb-size);
  height: var(--_tb-size);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--_tb-radius);
  background: transparent;
  color: var(--_tb-text);
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
  touch-action: none;
  transition: background-color 140ms ${EASE_OUT}, color 140ms ${EASE_OUT},
    transform 100ms ${EASE_OUT};
}

/* Firm stroke geometry, inheriting the button's colour state. */
.ms-stylus-btn > svg {
  display: block;
  width: var(--_tb-glyph);
  height: var(--_tb-glyph);
  fill: none;
  stroke: currentColor;
  stroke-width: var(--_tb-stroke);
  stroke-linecap: round;
  stroke-linejoin: round;
  /* Taps land on the button, never on a path — keeps event.target predictable
     for the toolbar-leak guards that test closest('.ms-stylus-toolbar'). */
  pointer-events: none;
}
.ms-stylus-btn > svg .ms-stylus-dot {
  stroke-width: calc(var(--_tb-stroke) * 1.9);
}
.ms-stylus-btn:hover {
  background: var(--_tb-fill);
}
.ms-stylus-btn:active {
  transform: scale(0.9);
}
.ms-stylus-btn:focus-visible {
  outline: 2px solid var(--_tb-accent);
  outline-offset: 1px;
}
.ms-stylus-btn:disabled {
  opacity: 0.3;
  cursor: default;
  pointer-events: none;
}

.ms-stylus-btn.is-primary {
  color: var(--_tb-accent);
  background: rgba(100, 180, 255, 0.14);
  background: color-mix(in oklab, var(--_tb-accent) 14%, transparent);
}
.ms-stylus-btn.is-primary:hover {
  background: rgba(100, 180, 255, 0.26);
  background: color-mix(in oklab, var(--_tb-accent) 26%, transparent);
}
.ms-stylus-btn.is-danger:hover {
  color: var(--_tb-danger);
  background: rgba(226, 75, 74, 0.14);
  background: color-mix(in oklab, var(--_tb-danger) 15%, transparent);
}

/* ── Segmented Draw / Points control ─────────────────────────────────────── */
/* aria-pressed is the styling hook, so the visual and the announced state
   cannot drift apart. */
.ms-stylus-seg {
  display: flex;
  gap: 1px;
  padding: 1px;
  border-radius: calc(var(--_tb-radius) + 1px);
  background: var(--_tb-fill);
}
.ms-stylus-btn[aria-pressed='true'] {
  color: var(--_tb-accent);
  background: rgba(100, 180, 255, 0.18);
  background: color-mix(in oklab, var(--_tb-accent) 18%, transparent);
}

.ms-stylus-sep {
  align-self: stretch;
  width: 1px;
  margin: 4px 2px;
  background: var(--ms-divider, rgba(255, 255, 255, 0.07));
}

/* ── One-shot coach line ─────────────────────────────────────────────────── */
/* Everything teachable lives here, on a line that leaves after 5 s, rather than
   in permanent chrome. */
.ms-stylus-hint {
  position: absolute;
  z-index: 49;
  padding: 6px 12px;
  border: 1px solid var(--ms-border, rgba(64, 140, 220, 0.35));
  border-radius: 999px;
  background: var(--ms-bg, rgba(14, 17, 26, 0.97));
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  color: var(--ms-text, #b8c5d8);
  font-family: var(--ms-menu-font, 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0.94;
  transition: opacity 600ms ease;
}
.ms-stylus-toolbar[data-touch='1'] ~ .ms-stylus-hint {
  font-size: 13px;
  padding: 7px 14px;
}
.ms-stylus-hint b {
  color: var(--ms-accent, #64b4ff);
  font-weight: 600;
}
.ms-stylus-hint.is-out {
  opacity: 0;
}

/* A tapped button on a touch screen keeps :hover until the next tap elsewhere —
   drop hover styling where there is no real pointer. */
@media (hover: none) {
  .ms-stylus-btn:hover {
    background: transparent;
    color: var(--_tb-text);
  }
  .ms-stylus-btn.is-primary:hover,
  .ms-stylus-btn[aria-pressed='true']:hover {
    color: var(--_tb-accent);
    background: color-mix(in oklab, var(--_tb-accent) 16%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ms-stylus-toolbar,
  .ms-stylus-btn,
  .ms-stylus-hint {
    transition-duration: 1ms;
  }
  .ms-stylus-toolbar {
    transform: none;
  }
  .ms-stylus-btn:active {
    transform: none;
  }
}
`;
  document.head.appendChild(style);
}

export default class StylusDrawController {
  private _deps: StylusDrawDeps;
  private _lastPointerType: string = 'mouse';
  private _lastPenTs = -Infinity;
  private _session: Session | null = null;
  private _toolbarEl: HTMLDivElement | null = null;
  private _finishBtn: HTMLButtonElement | null = null;
  private _undoBtn: HTMLButtonElement | null = null;
  private _hintEl: HTMLDivElement | null = null;
  private _hintShown = false;
  // Cached client rect of the pill, invalidated whenever it moves — the
  // proximity handler runs on pointermove and must not force layout.
  private _tbRect: DOMRect | null = null;
  private _tbAwarenessOff: (() => void) | null = null;
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
        // Keep the pill next to the work. Native draws own their vertices, so
        // this is the only place the controller learns where the user just
        // tapped — without it the toolbar sat wherever it first appeared.
        this._positionToolbar();
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
   * handler never runs and the vertex is silently lost. Crucially this happens
   * PER GESTURE (it depends on how much that particular tap drifted), not per
   * device — a draw can get real clicks for some taps and nothing for others.
   * Rescue: watch raw pointer-down/up pairs; when a qualifying tap (small
   * travel, short press, pen/touch, outside the toolbar) produces no REAL click
   * within stylus.native.tapFallbackMs, commit the vertex by re-emitting the
   * symbol's own 'click' (bus emit, as everywhere else).
   *
   * Cancellation is PER TAP, matched by position: a real click near a pending
   * tap proves ArcGIS delivered THAT tap, so only that rescue is cancelled.
   * (An earlier build disarmed the whole session on the first real click —
   * on tablets with intermittent click delivery that lost every subsequent
   * drifting tap, i.e. control points went missing mid-draw.) On healthy
   * hardware every rescue is cancelled by its own click (ArcGIS's ~250 ms click
   * delay sits well inside the default 400 ms window), so there is no
   * duplicate-vertex risk. Synthetic clicks carry the _msSynthetic marker and
   * never cancel anything.
   */
  private _installTapFallback(session: Session): void {
    const windowMs = Number(this._deps.getSettings()?.stylus?.native?.tapFallbackMs ?? 400);
    if (windowMs <= 0) return;
    const view = this._deps.getView();
    let downAt: { x: number; y: number; t: number } | null = null;
    type PendingTap = { timer: any; x: number; y: number };
    const pending = new Set<PendingTap>();
    const clearPending = () => {
      for (const p of pending) clearTimeout(p.timer);
      pending.clear();
    };
    const now = () =>
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

    session.handles.push(
      view.on('pointer-down', (evt: any) => {
        if (evt.button !== 0) return;
        if (this._lastPointerType === 'mouse') return; // mouse clicks are reliable
        if (this._isInsideToolbar(evt.x, evt.y)) return;
        downAt = { x: evt.x, y: evt.y, t: now() };
      }),
    );

    session.handles.push(
      view.on('pointer-up', (evt: any) => {
        const d = downAt;
        downAt = null;
        if (!d) return;
        if (Math.hypot(evt.x - d.x, evt.y - d.y) > this._tapTolerancePx()) return; // pan
        if (now() - d.t > 600) return; // long-press ≠ tap
        const entry: PendingTap = { timer: null, x: evt.x, y: evt.y };
        entry.timer = setTimeout(() => {
          pending.delete(entry);
          // Session ended (draw finished/cancelled) while the timer was in flight.
          if (this._session !== session) return;
          if (stylusDebug(this._deps)) {
            EngineLogger.nextStep(
              'Stylus Native',
              `tap fallback FIRED x=${entry.x} y=${entry.y} (no click within ${windowMs}ms)`,
            );
          }
          // The session's own 'click' observer handles the side effects
          // (lastScreen, premium.onTap / synthetic hover) — same as a real tap.
          this._emitSyntheticClick(entry.x, entry.y);
        }, windowMs);
        pending.add(entry);
      }),
    );

    // A real click cancels only the pending rescue(s) at its own position —
    // the next tap starts with the fallback fully armed again.
    const cancelRadius = Math.max(12, this._tapTolerancePx() * 2);
    session.handles.push(
      view.on('click', (evt: any) => {
        if (evt?._msSynthetic) return; // our own emission cancels nothing
        for (const p of pending) {
          if (Math.hypot(evt.x - p.x, evt.y - p.y) <= cancelRadius) {
            clearTimeout(p.timer);
            pending.delete(p);
          }
        }
      }),
    );
    // A real double-click is the draw terminator — nothing left to rescue.
    session.handles.push(
      view.on('double-click', (evt: any) => {
        if (evt?._msSynthetic) return;
        clearPending();
      }),
    );

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
    } else if (isArcCandidateClass(s.currentSymbol?.Class)) {
      de.CTRL_PTS = this._reorderArcPoints(pts);
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

  /**
   * Remap trace-order gesture points into the [chordStart, chordEnd,
   * bulgeCandidate] triple ARC_CANDIDATE_CLASSES read CTRL_PTS as. A freehand
   * stroke or tap sequence naturally goes [flank, ...along the bulge..., other
   * flank] — so the first and last captured points become the chord ends, and
   * whichever interior point deviates furthest from the chord (the apex of the
   * traced curve) becomes the curvature candidate. Any other interior points
   * are dropped: these classes only ever read three. 2-point gestures (a
   * straight boundary, no curvature) pass through unchanged.
   */
  private _reorderArcPoints(pts: Point[]): Point[] {
    if (pts.length <= 2) return pts;
    const start = pts[0];
    const end = pts[pts.length - 1];
    let bulge = pts[1];
    let maxDev = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = this._perpendicularDist(start, end, pts[i]);
      if (d > maxDev) {
        maxDev = d;
        bulge = pts[i];
      }
    }
    return [start, end, bulge];
  }

  /** Perpendicular distance from point p to the line through a→b (map units). */
  private _perpendicularDist(a: Point, b: Point, p: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
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
    injectToolbarStyles();
    // Finger-sized targets whenever the last physical input wasn't a mouse.
    const touchUI = this._lastPointerType !== 'mouse';
    const el = document.createElement('div');
    el.className = 'ms-stylus-toolbar';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-orientation', 'horizontal');
    el.setAttribute('aria-label', 'Stylus drawing controls');
    if (touchUI) el.dataset.touch = '1';
    // ✏ Draw / ⊙ Points chip — native-mode sessions only. Novices switch modes
    // right where they draw instead of hunting through settings; the choice
    // sticks as the new default.
    const hasChip = this._session?.mode === 'native';
    if (hasChip) this._appendModeChip(el);
    // Hairline between the mode chip and the actions — the two groups do
    // different jobs, so whitespace alone under-separates them at this size.
    if (hasChip) {
      const sep = document.createElement('div');
      sep.className = 'ms-stylus-sep';
      el.appendChild(sep);
    }
    // Icon-only: at this scale a glyph reads faster than a word, and the labels
    // were most of the pill's width. Names live on title + aria-label.
    this._finishBtn = this._mkBtn('finish', 'Finish drawing', 'is-primary', () => this.finish(), 'Enter');
    el.appendChild(this._finishBtn);
    if (includeUndo) {
      this._undoBtn = this._mkBtn('undo', 'Undo last point', '', () => this.undoLast());
      el.appendChild(this._undoBtn);
    }
    el.appendChild(
      this._mkBtn('cancel', 'Cancel drawing', 'is-danger', () => this.cancel(), 'Escape'),
    );
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
    // Opening position only — the first click moves it next to the work. Centred
    // near the top, clear of the app's top bar. Measured width, not
    // left:50% + translateX(-50%), so _positionToolbar can clamp against real
    // pixel edges and the entry animation owns transform.
    const cw = container.clientWidth || 0;
    this._placeToolbar(Math.round((cw - el.offsetWidth) / 2), 58);
    // A tick later, so the browser has the pre-transition state to animate from.
    // setTimeout, not rAF: rAF never fires when the document is backgrounded.
    setTimeout(() => el.classList.add('is-in'), 0);
    this._syncToolbarState();
    this._installToolbarAwareness(container);
    this._maybeShowHint(container);
  }

  /** Clamp to the container and write the position, invalidating the cache. */
  private _placeToolbar(left: number, top: number): void {
    const el = this._toolbarEl;
    if (!el) return;
    const container = this._deps.getView().container as HTMLElement | null;
    const cw = container?.clientWidth ?? 0;
    const ch = container?.clientHeight ?? 0;
    const maxL = Math.max(8, cw - el.offsetWidth - 8);
    const maxT = Math.max(8, ch - el.offsetHeight - 8);
    el.style.left = `${Math.round(Math.min(Math.max(8, left), maxL))}px`;
    el.style.top = `${Math.round(Math.min(Math.max(8, top), maxT))}px`;
    this._tbRect = null;
    this._layoutHint();
  }

  /**
   * Two behaviours that keep the pill out of the way without the user managing
   * it:
   *
   * · **Recede while stroking.** Once a contact travels past TB_STROKE_PX the
   *   pill drops to 7% and stops taking input, so it can't distract from the
   *   line or eat a vertex under the drawing hand. A stationary tap is below the
   *   threshold, so tapping vertices never makes it flicker.
   * · **Wake on approach.** A hovering pointer within TB_NEAR_PX brings it to
   *   full opacity before it is reached, which is a much larger target than
   *   :hover and works for pens that report hover.
   *
   * Listeners are passive + capture: purely observational, never interfering
   * with ArcGIS's own pointer pipeline, and still seen when a symbol handler
   * stops propagation.
   */
  private _installToolbarAwareness(container: HTMLElement): void {
    let downAt: { x: number; y: number } | null = null;
    let stroking = false;
    let restore: ReturnType<typeof setTimeout> | null = null;

    const bar = () => this._toolbarEl;
    const nearPx = this._lastPointerType === 'mouse' ? TB_NEAR_PX : TB_NEAR_PX_TOUCH;

    const rect = (): DOMRect | null => {
      const el = bar();
      if (!el) return null;
      if (!this._tbRect) this._tbRect = el.getBoundingClientRect();
      return this._tbRect;
    };

    const onDown = (e: PointerEvent) => {
      const el = bar();
      if (!el) return;
      // Pressing our own buttons is not drawing.
      const tgt = e.target as HTMLElement | null;
      if (tgt && typeof tgt.closest === 'function' && tgt.closest('.ms-stylus-toolbar')) return;
      downAt = { x: e.clientX, y: e.clientY };
    };

    const onMove = (e: PointerEvent) => {
      const el = bar();
      if (!el) return;
      if (downAt) {
        if (!stroking && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > TB_STROKE_PX) {
          stroking = true;
          if (restore) {
            clearTimeout(restore);
            restore = null;
          }
          el.classList.add('is-drawing');
          el.classList.remove('is-near');
        }
        return;
      }
      const r = rect();
      if (!r) return;
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      const near = Math.hypot(dx, dy) <= nearPx;
      // Only touch the DOM when the state actually flips.
      if (near !== el.classList.contains('is-near')) el.classList.toggle('is-near', near);
    };

    const onUp = () => {
      downAt = null;
      if (!stroking) return;
      stroking = false;
      // Short delay so a stroke that ends in a flurry of taps doesn't strobe.
      restore = setTimeout(() => {
        bar()?.classList.remove('is-drawing');
        restore = null;
      }, 130);
    };

    const opts = { passive: true, capture: true } as AddEventListenerOptions;
    container.addEventListener('pointerdown', onDown, opts);
    container.addEventListener('pointermove', onMove, opts);
    container.addEventListener('pointerup', onUp, opts);
    container.addEventListener('pointercancel', onUp, opts);
    this._tbAwarenessOff = () => {
      if (restore) clearTimeout(restore);
      container.removeEventListener('pointerdown', onDown, opts);
      container.removeEventListener('pointermove', onMove, opts);
      container.removeEventListener('pointerup', onUp, opts);
      container.removeEventListener('pointercancel', onUp, opts);
    };
  }

  /** Segmented ✏ Draw / ⊙ Points control that flips session.paradigm live. */
  private _appendModeChip(toolbar: HTMLDivElement): void {
    const wrap = document.createElement('div');
    wrap.className = 'ms-stylus-seg';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Drawing mode');
    const mk = (icon: string, label: string, mode: 'scrub' | 'native') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ms-stylus-btn';
      b.appendChild(mkIcon(icon));
      b.dataset.mode = mode;
      b.setAttribute('aria-label', label);
      b.title = mode === 'scrub' ? 'Draw — drag to sketch a stroke' : 'Points — tap to place vertices';
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
    const scrubBtn = mk('draw', 'Draw mode', 'scrub');
    const tapBtn = mk('points', 'Points mode', 'native');
    // aria-pressed is both the announced state and the CSS hook — one write.
    const paint = () => {
      const cur = this._session?.paradigm === 'scrub' ? 'scrub' : 'native';
      for (const b of [scrubBtn, tapBtn]) {
        b.setAttribute('aria-pressed', String(b.dataset.mode === cur));
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

  /**
   * One-time transient coach line beside the toolbar — then never again.
   *
   * The baseline-first tap order also lands here rather than in a permanent chip
   * on the pill: it is something you need once, at the start, and it was the
   * single widest thing in the chrome.
   */
  // Touch sizing comes from the toolbar's data-touch sibling selector in CSS.
  private _maybeShowHint(container: HTMLElement): void {
    const baseline = isBaselineClass(this._session?.currentSymbol?.Class);
    const arcCandidate = isArcCandidateClass(this._session?.currentSymbol?.Class);
    if (this._hintShown || (this._session?.mode !== 'native' && !baseline && !arcCandidate)) return;
    this._hintShown = true;
    const scrub = this._session?.paradigm === 'scrub';
    const hint = document.createElement('div');
    hint.className = 'ms-stylus-hint';
    // Live region: the coach line appears without any user action, so a screen
    // reader would otherwise never announce it.
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    if (baseline) {
      // Numerals carry the accent so the sequence reads at a glance.
      for (const [n, word] of [
        ['①', 'end'],
        ['②', 'centre'],
        ['③+', 'effect'],
      ]) {
        const num = document.createElement('b');
        num.textContent = n;
        hint.appendChild(num);
        hint.appendChild(document.createTextNode(` ${word} `));
      }
    } else if (arcCandidate) {
      const lead = document.createElement('b');
      lead.textContent = 'First & last taps set the flanks';
      hint.appendChild(lead);
      hint.appendChild(document.createTextNode(' — points between bow the curve. '));
    }
    hint.appendChild(
      document.createTextNode(
        // No ✓ glyph here: the button is stroked SVG now, and the font's
        // checkmark is a visibly different, thinner shape.
        scrub ? 'Drag to sketch — lift to finish.' : 'Tap to place points, then Finish.',
      ),
    );
    container.appendChild(hint);
    this._hintEl = hint;
    this._layoutHint();
    setTimeout(() => hint.classList.add('is-out'), 5500);
    setTimeout(() => {
      if (hint.parentElement) hint.parentElement.removeChild(hint);
      if (this._hintEl === hint) this._hintEl = null;
    }, 6200);
  }

  /**
   * Park the coach line against the toolbar's real rect, on whichever side has
   * room. The old fixed top offset assumed the toolbar stayed at the top of the
   * view, so the two drifted apart as soon as it moved.
   */
  private _layoutHint(): void {
    const hint = this._hintEl;
    const bar = this._toolbarEl;
    if (!hint || !bar) return;
    const container = this._deps.getView().container as HTMLElement | null;
    if (!container) return;
    const cw = container.clientWidth || 0;
    const ch = container.clientHeight || 0;
    const bTop = parseFloat(bar.style.top) || 0;
    const bh = bar.offsetHeight;
    const hh = hint.offsetHeight;
    // Default below the pill; above it when the pill is parked near the bottom.
    const below = bTop + bh + 8;
    const top = below + hh > ch - 8 ? Math.max(8, bTop - hh - 8) : below;
    const left = (parseFloat(bar.style.left) || 0) + bar.offsetWidth / 2 - hint.offsetWidth / 2;
    hint.style.top = `${Math.round(top)}px`;
    hint.style.left = `${Math.round(Math.min(Math.max(8, left), Math.max(8, cw - hint.offsetWidth - 8)))}px`;
  }

  /**
   * Show what is actually possible right now: Finish stays disabled until the
   * gesture holds enough points for the symbol to build (baseline-first classes
   * need the two baseline taps plus one control point), and Undo until there is
   * a point to remove. Both used to sit enabled and silently no-op, which reads
   * as a broken button.
   */
  private _syncToolbarState(): void {
    const s = this._session;
    // Native draws keep their points inside the symbol, so we can't count them —
    // leave both live rather than guess wrong.
    const counted = !!s && s.mode !== 'native';
    if (this._undoBtn) this._undoBtn.disabled = counted && s!.points.length === 0;
    if (this._finishBtn) {
      const need = isBaselineClass(s?.currentSymbol?.Class) ? 3 : 2;
      this._finishBtn.disabled = counted && s!.points.length < need;
    }
  }

  private _mkBtn(
    icon: string,
    label: string,
    variant: string,
    onClick: () => void,
    shortcut?: string,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = variant ? `ms-stylus-btn ${variant}` : 'ms-stylus-btn';
    b.appendChild(mkIcon(icon));
    // Icon-only, so the accessible name and the tooltip carry the label.
    b.setAttribute('aria-label', label);
    b.title = shortcut ? `${label} (${shortcut === 'Escape' ? 'Esc' : shortcut})` : label;
    if (shortcut) b.setAttribute('aria-keyshortcuts', shortcut);
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

  /**
   * Follow the point just placed, on every click, offset clear of it.
   *
   * The pill sits up-and-to-the-right of the tap: near enough that Finish is a
   * short reach from where the user is already working, far enough that it never
   * lands under the pen tip, the wrist, or the vertex itself. It flips to the
   * left when the right edge is close, and below when there is no room above,
   * so the offset survives taps in any corner.
   */
  private _positionToolbar(): void {
    const s = this._session;
    if (!s || !this._toolbarEl) return;
    // Called on every point add/remove, so it is also the right beat to refresh
    // the buttons' enabled state.
    this._syncToolbarState();
    const view = this._deps.getView();
    // Anchor on the last tap. Native draws keep their vertices inside the
    // symbol, so they report the tap in screen space instead of s.points.
    let sp: { x: number; y: number } | null = null;
    if (s.mode === 'native') {
      sp = s.lastScreen ?? null;
    } else {
      const last = s.points[s.points.length - 1];
      const p = last ? view.toScreen(last as any) : null;
      if (p) sp = { x: p.x, y: p.y };
    }
    if (!sp) return;
    const el = this._toolbarEl;
    const container = view.container as HTMLElement | null;
    const cw = container?.clientWidth ?? 0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Clearance from the tap to the pill's nearest edge — enough that the pen
    // and hand never overlap it, close enough to still read as attached.
    const gap = 22;
    let left = sp.x + gap;
    if (left + w > cw - 8) left = sp.x - gap - w; // no room right → mirror left
    let top = sp.y - gap - h;
    if (top < 8) top = sp.y + gap; // no room above → drop below
    this._placeToolbar(left, top);
  }

  private _removeToolbar(): void {
    this._tbAwarenessOff?.();
    this._tbAwarenessOff = null;
    if (this._toolbarEl?.parentElement) this._toolbarEl.parentElement.removeChild(this._toolbarEl);
    this._toolbarEl = null;
    this._finishBtn = null;
    this._undoBtn = null;
    this._tbRect = null;
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
