/**
 * PremiumStylus.ts
 *
 * The "premium" stylus drawing layer. It sits ON TOP of the native drawing
 * paradigm (the symbol's own createSymbol preview + baseline phase) and adds the
 * high-end feel touches, WITHOUT reimplementing geometry and WITHOUT editing any
 * symbol class:
 *
 *   • Glide cursor      — a smooth crosshair/ring that follows the pen (hover)
 *                         or finger, so touch finally has a visible cursor.
 *   • Input smoothing   — a 1€ filter on the cursor + the touch preview so the
 *                         ghost glides instead of jittering.
 *   • Snap-to-cursor    — when ProximityEngine reports a snap, the cursor (and,
 *                         on touch, the live preview) jump to the snap target so
 *                         you SEE exactly where the next vertex lands.
 *   • Palm rejection    — stray touches while a pen is active (and obvious
 *                         palm-sized contacts) are dropped.
 *   • Dwell-to-finish   — optionally finish by holding the pen still (off by
 *                         default; opt-in via settings).
 *
 * Lifecycle: created + attach()ed ONLY from StylusDrawController.attachNative(),
 * i.e. only on a genuine interactive native draw. Fully torn down on detach().
 * Holds no state that outlives a single draw. Never reached on passive /
 * programmatic placement (plan load, paste, updateSymbol).
 *
 * Snap-to-COMMIT (moving the actually-placed vertex onto the snap target), plus
 * angle-lock and length-lock, ARE implemented — via the DrawSeam resolver below
 * (stylus.premium.precision.*, off by default until validated on a real
 * device); no pointer events are intercepted or re-issued. Pen-input smoothing
 * of the live preview itself remains deliberately undone: the smoothed glide
 * cursor already conveys the position, and re-driving the symbol's preview from
 * filtered coordinates needs on-device tuning first.
 */

import Point from '@arcgis/core/geometry/Point';
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';

type View = MapView | SceneView;

export interface PremiumStylusDeps {
  getView: () => View;
  getSettings: () => any;
  /** Finish the active native draw (used by dwell-to-finish). Optional screen
   *  point lets dwell finish at the current cursor rather than the last tap. */
  finishNativeDraw: (screen?: { x: number; y: number } | null) => void;
  /** Drive the symbol's own move handler via a synthetic hover (touch preview). */
  emitHoverAt: (screenX: number, screenY: number) => void;
  /** Authoritative last-seen pointer type (from a capture-phase window probe in
   *  StylusDrawController). Reliable for touch, which never fires pointer-move
   *  before the first tap; our internal pointer-move sniff would still be 'mouse'. */
  getPointerType?: () => string;
}

import OneEuroFilter2D from './OneEuroFilter';
import DrawSeam from '../../Support/DrawSeam';
import EngineLogger from '../../Support/EngineLogger';

// Default OFF. Enable via Settings.json → stylus.debug = true, or
// window.__stylusDebug = true, to trace the tablet-side pointer flow through
// the Engine Log panel.
function stylusDebug(getSettings: () => any): boolean {
  try {
    if (typeof window !== 'undefined' && (window as any).__stylusDebug) return true;
    return !!getSettings?.()?.stylus?.debug;
  } catch {
    return false;
  }
}

export default class PremiumStylus {
  private _deps: PremiumStylusDeps;
  private _handles: any[] = [];
  private _cursorEl: HTMLDivElement | null = null;
  private _filter = new OneEuroFilter2D();
  // Fallback pointer-type sniff from view.on('pointer-move'). Only reliable
  // for hover-capable devices (mouse / pen). For touch prefer deps.getPointerType()
  // which is fed by a capture-phase window pointerdown probe.
  private _movePointerType: string = 'mouse';

  // Snap state, mirrored from ProximityEngine's document events. Map point is
  // the single source of truth — its screen position is recomputed at use time
  // (_snapScreenNow), because stored screen coords go stale after pan/zoom and,
  // on touch, proximity-clear never fires between taps.
  private _onProxSnap: ((e: any) => void) | null = null;
  private _onProxClear: (() => void) | null = null;

  // Palm rejection. -Infinity so that with NO pen ever seen, "pen active
  // recently" is always false (a 0 default would reject all touch when
  // performance.now() is unavailable and returns 0).
  private _lastPenTs = -Infinity;
  private _winPointerDownCapture: ((e: PointerEvent) => void) | null = null;

  // Last drawn cursor position (screen px) — used by dwell-to-finish.
  private _lastCursor: { x: number; y: number } | null = null;

  // Dwell-to-finish.
  private _dwellTimer: any = null;
  private _committed = false; // at least one vertex placed → dwell may finish

  // Precision: snap / angle-lock / length-lock resolver state.
  private _snapMap: Point | null = null; // proximity snap target (map coords)
  private _lastResolvedMap: Point | null = null; // last point the resolver returned
  private _lastCommittedMap: Point | null = null; // last committed vertex (lock anchor)
  private _resolverRegistered = false;

  // Active draw symbol (for undo + freehand stroke) + pen pressure + stroke state.
  private _symbol: any = null;
  private _pressure = 0.5;
  private _strokePts: Point[] = [];
  private _strokeMode = false;

  private _active = false;

  constructor(deps: PremiumStylusDeps) {
    this._deps = deps;
  }

  get isActive(): boolean {
    return this._active;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  attach(symbol?: any, _currentSymbol?: any): void {
    if (this._active) this.detach();
    // Defensive: never inherit a stale resolver from a prior draw whose teardown
    // failed — keeps a precision-OFF draw truly neutral.
    DrawSeam.clearResolver();
    this._active = true;
    this._committed = false;
    this._snapMap = null;
    this._lastResolvedMap = null;
    this._lastCommittedMap = null;
    this._symbol = symbol ?? null;
    this._strokePts = [];
    // Freehand smooth-stroke mode: only for symbols that expose the stroke seam.
    this._strokeMode =
      !!this._cfg().freehandStroke && typeof this._symbol?.setStrokePoints === 'function';
    this._filter.reset();
    this._applyFilterParams();

    const view = this._deps.getView();

    // Glide cursor — follows pen hover / finger; snaps to the proximity target.
    if (this._cfg().cursor?.enabled !== false) this._mountCursor();

    // Pointer-move drives the cursor (smoothed), the dwell timer, and device type.
    this._handles.push(
      view.on('pointer-move', (evt: any) => this._onPointerMove(evt)),
    );
    // Hide the cursor when the pointer leaves the surface.
    try {
      this._handles.push(view.on('pointer-leave', () => this._hideCursor()));
    } catch {
      /* some view builds may not expose pointer-leave */
    }

    // Mirror ProximityEngine snaps (visual-only events on document).
    if (this._cfg().snap?.enabled !== false) this._listenForSnaps();

    // Palm rejection — capture phase so we pre-empt the map + the draw handlers.
    if (this._cfg().palmReject !== false) this._installPalmRejection();

    // Precision resolver: make the COMMITTED vertex (and the live preview) land
    // on the snapped / angle-locked / length-locked point — not just the cursor.
    // Registered globally only for THIS draw (one interactive draw at a time).
    if (this._cfg().precision?.enabled) {
      DrawSeam.setResolver((_view, raw) => this._resolveDrawPoint(raw));
      this._resolverRegistered = true;
    }

    // Freehand smooth stroke (opt-in, freehand symbols only): capture a drag,
    // smooth it, and drive the symbol's REAL preview via setStrokePoints.
    if (this._strokeMode) this._installFreehandStroke();
  }

  // ── Freehand smooth stroke + undo ────────────────────────────────────────────
  private _installFreehandStroke(): void {
    const view = this._deps.getView();
    this._handles.push(
      view.on('drag', (evt: any) => {
        if (!this._strokeMode || !this._symbol) return;
        evt.stopPropagation(); // suppress map pan while sketching
        if (evt.action === 'start') {
          this._strokePts = [];
          this._filter.reset();
        }
        if (evt.action === 'start' || evt.action === 'update') {
          if (!isFinite(evt.x) || !isFinite(evt.y)) return;
          let sx = evt.x;
          let sy = evt.y;
          if (this._cfg().smoothing?.enabled !== false) {
            const f = this._filter.filter(evt.x, evt.y, this._now());
            sx = f.x;
            sy = f.y;
          }
          // Sample throttle — skip near-coincident points.
          const lastSp = this._strokePts.length
            ? this._toScreen(this._strokePts[this._strokePts.length - 1])
            : null;
          if (lastSp && Math.hypot(lastSp.x - sx, lastSp.y - sy) < 3) {
            this._moveCursor(sx, sy, false);
            return;
          }
          const mp = (view as any).toMap({ x: sx, y: sy });
          if (mp) {
            this._strokePts.push(new Point({ x: mp.x, y: mp.y, spatialReference: view.spatialReference }));
            this._committed = true;
            try {
              this._symbol.setStrokePoints(this._strokePts);
            } catch {
              /* no-op */
            }
          }
          this._moveCursor(sx, sy, false);
        }
        if (evt.action === 'end') {
          try {
            this._symbol.finishStroke?.();
          } catch {
            /* no-op */
          }
        }
      }),
    );
  }

  /** Premium Undo: remove the last placed vertex of the active draw, if supported. */
  undo(): boolean {
    if (this._symbol && typeof this._symbol.removeLastPoint === 'function') {
      try {
        const ok = !!this._symbol.removeLastPoint();
        // Re-render: most symbols' removeLastPoint just pops _points and rely on
        // the next move; nudge the symbol's own move handler at the last cursor
        // so the preview updates immediately (pen and touch).
        if (ok && this._lastCursor) this._deps.emitHoverAt(this._lastCursor.x, this._lastCursor.y);
        return ok;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** True when the active symbol supports premium Undo. */
  get canUndo(): boolean {
    return typeof this._symbol?.removeLastPoint === 'function';
  }

  private _toScreen(p: Point): { x: number; y: number } | null {
    try {
      const sp = (this._deps.getView() as any).toScreen(p);
      return sp && isFinite(sp.x) ? { x: sp.x, y: sp.y } : null;
    } catch {
      return null;
    }
  }

  detach(): void {
    this._active = false;
    // Clear the global resolver FIRST — a throw in the teardown below must never
    // leave a stale resolver registered for the next (possibly non-premium) draw.
    if (this._resolverRegistered) {
      DrawSeam.clearResolver();
      this._resolverRegistered = false;
    }
    for (const h of this._handles) {
      try {
        h.remove();
      } catch {
        /* no-op */
      }
    }
    this._handles = [];
    this._clearDwell();
    this._unmountCursor();
    if (this._onProxSnap) document.removeEventListener('proximity-snap', this._onProxSnap as any);
    if (this._onProxClear) document.removeEventListener('proximity-clear', this._onProxClear as any);
    this._onProxSnap = null;
    this._onProxClear = null;
    if (this._winPointerDownCapture && typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this._winPointerDownCapture, true);
      this._winPointerDownCapture = null;
    }
    this._snapMap = null;
    this._symbol = null;
    this._strokeMode = false;
    this._strokePts = [];
  }

  /**
   * Called by StylusDrawController on each committed tap. For touch (no hover) we
   * drive the symbol's real preview via a synthetic hover at the snapped point so
   * the user sees the actual symbol building up. Pen hover already previews live.
   */
  onTap(screenX: number, screenY: number): void {
    this._committed = true;
    // The committed vertex is the point the resolver just returned for this click
    // (when precision is on); it anchors angle/length-lock for the next segment.
    if (this._lastResolvedMap) this._lastCommittedMap = this._lastResolvedMap;
    // A tap is an EXPLICIT position — honour the snap target only when the tap
    // landed within the pull radius of it (same gate as the hover cursor).
    // Recompute the target's screen position from the map point: on touch no
    // hover happens between taps, so proximity-clear never fires and the stored
    // snap goes stale — ungated, every tap's preview would ride the nearest
    // other-symbol vertex (the "snaps back" bug).
    let target = { x: screenX, y: screenY };
    let snapped = false;
    if (this._snapMap) {
      const sp = this._toScreen(this._snapMap);
      if (sp && Math.hypot(sp.x - screenX, sp.y - screenY) <= this._snapPullPx()) {
        target = sp;
        snapped = true;
      }
    }
    this._moveCursor(target.x, target.y, snapped);
    // Prefer the authoritative pointer type from the controller (updated on
    // every pointerdown); fall back to our pointer-move sniff. Touch never
    // fires pointer-move before the first tap, so the sniff alone stays 'mouse'
    // and the synthetic hover would be skipped — that's the bug this fixes.
    const ptype = this._deps.getPointerType?.() ?? this._movePointerType;
    const willEmit = ptype !== 'mouse' && ptype !== 'pen';
    if (stylusDebug(this._deps.getSettings)) {
      EngineLogger.nextStep(
        'Stylus Premium',
        `onTap x=${screenX} y=${screenY} target=${target.x.toFixed(0)},${target.y.toFixed(0)} ptype=${ptype} emit=${willEmit} snap=${snapped}`,
      );
    }
    if (willEmit) {
      // Touch: no hover, so nudge the symbol's preview to the (snapped) point.
      this._deps.emitHoverAt(target.x, target.y);
    }
  }

  // ── Pointer move: cursor + smoothing + dwell ─────────────────────────────────
  private _onPointerMove(evt: any): void {
    if (!isFinite(evt?.x) || !isFinite(evt?.y)) return; // guard malformed events → no NaN cursor
    const ptype = evt?.native?.pointerType ?? evt?.pointerType;
    if (ptype) this._movePointerType = ptype;
    if (ptype === 'pen') this._lastPenTs = this._now();
    const pr = evt?.native?.pressure;
    this._pressure = typeof pr === 'number' && pr > 0 ? pr : 0.5;

    const t = this._now();
    const sm = this._cfg().smoothing;
    let sx = evt.x;
    let sy = evt.y;
    if (sm?.enabled !== false) {
      const f = this._filter.filter(evt.x, evt.y, t);
      sx = f.x;
      sy = f.y;
    }
    // Snap the cursor to the proximity target when one is active and close.
    const snapped = this._snapScreenNow();
    if (snapped && Math.hypot(snapped.x - sx, snapped.y - sy) <= this._snapPullPx()) {
      this._moveCursor(snapped.x, snapped.y, true);
    } else {
      this._moveCursor(sx, sy, false);
    }

    this._armDwell();
  }

  // ── Dwell-to-finish ──────────────────────────────────────────────────────────
  private _armDwell(): void {
    const ms = Number(this._cfg().finish?.dwellMs ?? 0);
    this._clearDwell();
    if (ms <= 0 || !this._committed) return;
    this._dwellTimer = setTimeout(() => {
      this._dwellTimer = null;
      if (this._active && this._committed) this._deps.finishNativeDraw(this._lastCursor);
    }, ms);
  }

  private _clearDwell(): void {
    if (this._dwellTimer) {
      clearTimeout(this._dwellTimer);
      this._dwellTimer = null;
    }
  }

  // ── Precision resolver (snap / angle-lock / length-lock) ─────────────────────
  /**
   * Invoked via DrawSeam for EVERY draw-point read (candidate + commit) while
   * precision is on. Returns the map Point the symbol should use, so the live
   * preview AND the committed vertex land on the same resolved target.
   * Priority: snap-to-vertex is absolute; otherwise angle-lock and length-lock
   * COMPOSE (45° + 1 km = a polar grid around the previous vertex).
   */
  private _resolveDrawPoint(raw: Point): Point {
    const view = this._deps.getView();
    const sr = view.spatialReference;
    const p = this._cfg().precision ?? {};
    let out: Point = raw;
    let snapped = false;

    // 1) Snap to a nearby existing vertex/coordinate (ProximityEngine target) —
    //    an absolute target, so the locks below don't apply on top.
    if (p.snapCommit !== false && this._snapMap) {
      try {
        const sp = (view as any).toScreen(raw);
        const snapSp = this._snapScreenNow();
        if (sp && snapSp && Math.hypot(sp.x - snapSp.x, sp.y - snapSp.y) <= this._snapPullPx()) {
          out = this._snapMap;
          snapped = true;
        }
      } catch {
        /* fall through to raw */
      }
    }

    // 2) Angle-lock relative to the last committed vertex.
    if (!snapped && p.angleLock?.enabled && this._lastCommittedMap) {
      out = this._applyAngleLock(raw, this._lastCommittedMap, sr, p.angleLock) ?? out;
    }

    // 3) Length-lock, applied to the (possibly angle-locked) point so both
    //    locks combine instead of angle silently winning.
    if (!snapped && p.lengthLock?.enabled && this._lastCommittedMap) {
      out = this._applyLengthLock(out, this._lastCommittedMap, sr, p.lengthLock) ?? out;
    }

    this._lastResolvedMap = out;
    return out;
  }

  private _applyAngleLock(raw: Point, anchor: Point, sr: any, cfg: any): Point | null {
    const dx = raw.x - anchor.x;
    const dy = raw.y - anchor.y;
    const len = Math.hypot(dx, dy);
    if (!isFinite(len) || len < 1e-6) return null;
    const interval = Number(cfg.intervalDeg ?? 45);
    const threshold = Number(cfg.thresholdDeg ?? 8);
    if (interval <= 0) return null;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const nearest = Math.round(deg / interval) * interval;
    let diff = Math.abs(deg - nearest) % 360;
    if (diff > 180) diff = 360 - diff;
    if (diff > threshold) return null; // not close enough to a guide angle
    const rad = (nearest * Math.PI) / 180;
    return new Point({ x: anchor.x + len * Math.cos(rad), y: anchor.y + len * Math.sin(rad), spatialReference: sr });
  }

  private _applyLengthLock(raw: Point, anchor: Point, sr: any, cfg: any): Point | null {
    const dx = raw.x - anchor.x;
    const dy = raw.y - anchor.y;
    const len = Math.hypot(dx, dy);
    if (!isFinite(len) || len < 1e-6) return null;
    const step = Number(cfg.intervalKm ?? 1) * 1000; // map units (~metres in projected SR)
    if (!isFinite(step) || step <= 0) return null;
    const snapped = Math.round(len / step) * step;
    if (snapped <= 0) return null;
    const scale = snapped / len;
    return new Point({ x: anchor.x + dx * scale, y: anchor.y + dy * scale, spatialReference: sr });
  }

  // ── Proximity snap mirror ────────────────────────────────────────────────────
  private _listenForSnaps(): void {
    this._onProxSnap = (e: any) => {
      const c = e?.detail?.coordinate;
      if (!c) return;
      try {
        const view = this._deps.getView();
        this._snapMap = new Point({ x: c.x, y: c.y, spatialReference: view.spatialReference });
      } catch {
        this._snapMap = null;
      }
    };
    this._onProxClear = () => {
      this._snapMap = null;
    };
    document.addEventListener('proximity-snap', this._onProxSnap as any);
    document.addEventListener('proximity-clear', this._onProxClear as any);
  }

  /** Current screen position of the snap target (recomputed — never cached). */
  private _snapScreenNow(): { x: number; y: number } | null {
    return this._snapMap ? this._toScreen(this._snapMap) : null;
  }

  // ── Palm rejection ───────────────────────────────────────────────────────────
  private _installPalmRejection(): void {
    if (typeof window === 'undefined') return;
    this._winPointerDownCapture = (e: PointerEvent) => {
      if (!this._active) return;
      // Never reject taps on our own UI (the Finish/Cancel toolbar) — otherwise a
      // pen-then-touch within the palm window would make those buttons dead.
      const tgt = e.target as Element | null;
      if (tgt && typeof tgt.closest === 'function' && tgt.closest('.ms-stylus-toolbar')) return;
      if (e.pointerType === 'pen') {
        this._lastPenTs = this._now();
        return;
      }
      if (e.pointerType !== 'touch') return;
      // Drop a touch while a pen is active, or an obvious palm-sized contact.
      // The size heuristic is only meaningful on pen-capable devices — on a
      // pure-touch tablet a normal fingertip contact can exceed palmSizePx, so
      // gate `big` behind "a pen has been observed at least once this session".
      const penActive = this._now() - this._lastPenTs < this._palmWindowMs();
      const penEverSeen = isFinite(this._lastPenTs);
      const big =
        penEverSeen &&
        ((e as any).width > this._palmSizePx() || (e as any).height > this._palmSizePx());
      if (penActive || big) {
        if (stylusDebug(this._deps.getSettings)) {
          EngineLogger.error(
            'Stylus Premium',
            `palm DROP w=${(e as any).width} h=${(e as any).height} penActive=${penActive} big=${big}`,
          );
        }
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('pointerdown', this._winPointerDownCapture, true);
  }

  // ── Cursor overlay ───────────────────────────────────────────────────────────
  private _mountCursor(): void {
    const view = this._deps.getView();
    const container = view.container as HTMLElement | null;
    if (!container) return;
    const c = this._cfg().cursor ?? {};
    const size = Number(c.size ?? 22);
    const col = this._rgba(c.color ?? [0, 200, 255], 0.95);
    const el = document.createElement('div');
    el.className = 'ms-stylus-cursor';
    el.style.cssText =
      `position:absolute;z-index:48;pointer-events:none;left:0;top:0;` +
      `width:${size}px;height:${size}px;margin-left:${-size / 2}px;margin-top:${-size / 2}px;` +
      `border:1.5px solid ${col};border-radius:50%;box-shadow:0 0 6px ${col};` +
      `display:none;transition:border-color 90ms linear,transform 90ms linear;` +
      // crosshair tick in the centre
      `background:` +
      `linear-gradient(${col},${col}) center/1.5px 8px no-repeat,` +
      `linear-gradient(${col},${col}) center/8px 1.5px no-repeat;`;
    container.appendChild(el);
    this._cursorEl = el;
  }

  private _moveCursor(x: number, y: number, snapped: boolean): void {
    this._lastCursor = { x, y };
    const el = this._cursorEl;
    if (!el) return;
    el.style.display = 'block';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    // Snapped state: highlight + slight grow so the lock is obvious.
    const c = this._cfg().cursor ?? {};
    const base = this._rgba(c.color ?? [0, 200, 255], 0.95);
    const lock = this._rgba(c.snapColor ?? [120, 255, 140], 1);
    el.style.borderColor = snapped ? lock : base;
    const pScale = this._cfg().ink?.pressure ? 0.6 + 0.8 * this._pressure : 1;
    const s = (snapped ? 1.25 : 1) * pScale;
    el.style.transform = `scale(${s.toFixed(3)})`;
  }

  private _hideCursor(): void {
    if (this._cursorEl) this._cursorEl.style.display = 'none';
  }

  private _unmountCursor(): void {
    if (this._cursorEl?.parentElement) this._cursorEl.parentElement.removeChild(this._cursorEl);
    this._cursorEl = null;
  }

  // ── Config helpers ───────────────────────────────────────────────────────────
  private _cfg(): any {
    return this._deps.getSettings()?.stylus?.premium ?? {};
  }

  private _applyFilterParams(): void {
    const sm = this._cfg().smoothing ?? {};
    this._filter.setParams(
      Number(sm.minCutoff ?? 1.0),
      Number(sm.beta ?? 0.02),
      Number(sm.dCutoff ?? 1.0),
    );
  }

  private _snapPullPx(): number {
    return Number(this._cfg().snap?.pullPx ?? 24);
  }
  private _palmWindowMs(): number {
    return Number(this._cfg().palmWindowMs ?? 1200);
  }
  private _palmSizePx(): number {
    return Number(this._cfg().palmSizePx ?? 45);
  }

  private _now(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
  }

  private _rgba(rgb: number[], a: number): string {
    const [r, g, b] = rgb;
    return `rgba(${r},${g},${b},${a})`;
  }
}
