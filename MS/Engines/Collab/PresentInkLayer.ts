/**
 * PresentInkLayer.ts
 *
 * Draws OTHER people's presentation mark-up — pen ink, laser trail, spotlight —
 * on a canvas this engine owns, stacked under the local `PresentAnnotator`'s two
 * canvases (z 42/43) at z 41.
 *
 * Why a separate canvas rather than pushing remote strokes into the annotator's
 * own `_strokes` map, which would be less code:
 *
 *   `PresentAnnotator.inkAsOverlays()` converts the session's strokes into real
 *   `SlideOverlay`s, and present mode offers to keep them on the way out. A
 *   viewer whose store held the briefer's strokes would therefore be offered —
 *   and could silently persist — somebody else's ink as annotations on their own
 *   deck. Ink you did not draw must not be able to end up in your saved plan.
 *
 * It also keeps the removability guarantee intact: nothing in Briefing/ is
 * modified, and deleting this folder takes the whole feature with it.
 *
 * Coordinates arrive normalised [0..1] against the view container, the same
 * convention PresentAnnotator stores strokes in, so a stroke drawn on a 4K
 * projector lands in the same place on a laptop.
 */

import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';

import type { ClientId, InkPayload } from './CollabTypes';

const STYLE_ID = 'ms-collab-ink-style';
/** How long a laser point stays visible before it has fully faded. */
const LASER_FADE_MS = 700;
/** Forget a peer's transient mark-up this long after its last update. */
const STALE_MS = 5000;
/** Matches PresentAnnotator's own dim, so a shared spotlight looks identical. */
const SPOTLIGHT_DIM = 0.72;
/** Cap on stroke points held per peer — a fast pen produces a lot of them. */
const MAX_STROKE_PTS = 400;

interface Stroke {
  /** Normalised [0..1]. */
  pts: Array<[number, number]>;
  color: string;
}

interface Laser {
  color: string;
  pts: Array<[number, number]>;
  at: number;
}

interface Spot {
  color: string;
  x: number;
  y: number;
  r: number;
  at: number;
}

export default class PresentInkLayer {
  private _view: MapView | SceneView | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _raf: number | null = null;
  private _onResize: (() => void) | null = null;

  /** Committed peer strokes, per slide id. */
  private _strokes = new Map<string, Stroke[]>();
  /** In-progress strokes, per peer — replaced wholesale on every update. */
  private _active = new Map<ClientId, { sid: string; stroke: Stroke }>();
  private _lasers = new Map<ClientId, Laser>();
  private _spots = new Map<ClientId, Spot>();
  /** Which slide's ink is on screen. */
  private _slideId: string | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  public start(view: MapView | SceneView): void {
    this._view = view;
    PresentInkLayer._injectStyle();
    this._mount();
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._unmount();
    this._view = view;
    this._mount();
    this._kick();
  }

  public destroy(): void {
    this._unmount();
    this._strokes.clear();
    this._active.clear();
    this._lasers.clear();
    this._spots.clear();
    this._slideId = null;
    this._view = null;
  }

  private _mount(): void {
    const container = this._view?.container as HTMLElement | undefined;
    if (!container) return;
    const el = document.createElement('canvas');
    el.className = 'ms-collab-ink';
    container.appendChild(el);
    this._canvas = el;
    this._onResize = () => this._kick();
    window.addEventListener('resize', this._onResize);
    this._resize();
  }

  private _unmount(): void {
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    this._canvas?.remove();
    this._canvas = null;
  }

  // ── Inbound state ─────────────────────────────────────────────────────────

  /** Show a different slide's peer ink. Transient mark-up is unaffected. */
  public setSlide(slideId: string | null): void {
    if (this._slideId === slideId) return;
    this._slideId = slideId;
    this._kick();
  }

  public applyInk(from: ClientId, color: string, d: InkPayload): void {
    const now = Date.now();
    if (d.k === 'clear') {
      this._strokes.delete(d.sid);
      this._active.delete(from);
      this._kick();
      return;
    }
    const pts = PresentInkLayer._clean(d.pts);
    if (!pts.length) return;

    if (d.k === 'laser') {
      // Replace rather than append: the sender streams its recent tail, so
      // replacing is idempotent and a dropped message costs one frame instead of
      // leaving a permanent gap in the trail.
      this._lasers.set(from, { color, pts, at: now });
    } else if (d.k === 'spot') {
      const [x, y] = pts[0];
      this._spots.set(from, { color, x, y, r: Number(d.r) > 0 ? Number(d.r) : 0.12, at: now });
    } else {
      // Pen. The sender re-sends the whole stroke each time for the same
      // drop-tolerance reason, so this is a replace too; `done` commits it.
      const stroke: Stroke = { pts, color };
      if (d.done) {
        const list = this._strokes.get(d.sid) ?? [];
        list.push(stroke);
        this._strokes.set(d.sid, list);
        this._active.delete(from);
      } else {
        this._active.set(from, { sid: d.sid, stroke });
      }
    }
    this._kick();
  }

  /** Drop everything a departing peer left behind. */
  public clearPeer(from: ClientId): void {
    this._active.delete(from);
    this._lasers.delete(from);
    this._spots.delete(from);
    this._kick();
  }

  /** Wipe the layer — podium released, or shared briefing switched off. */
  public clearAll(): void {
    this._strokes.clear();
    this._active.clear();
    this._lasers.clear();
    this._spots.clear();
    this._kick();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /**
   * One repaint on the next frame. Deliberately does not re-arm itself; the
   * paint re-arms only while a laser or spotlight is still decaying, so static
   * ink over a still map costs nothing.
   */
  private _kick(): void {
    if (this._raf !== null || !this._canvas) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._paint();
    });
  }

  private _resize(): void {
    const el = this._canvas;
    const container = this._view?.container as HTMLElement | undefined;
    if (!el || !container) return;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
  }

  private _paint(): void {
    const el = this._canvas;
    if (!el) return;
    this._resize();
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = el;
    ctx.clearRect(0, 0, w, h);

    const now = Date.now();
    this._expire(now);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Committed ink for the slide on screen, then whatever is still being drawn.
    const committed = (this._slideId && this._strokes.get(this._slideId)) || [];
    for (const s of committed) PresentInkLayer._strokePath(ctx, s, w, h, 1);
    for (const a of this._active.values()) {
      if (a.sid !== this._slideId) continue;
      PresentInkLayer._strokePath(ctx, a.stroke, w, h, 1);
    }

    let animating = false;
    for (const l of this._lasers.values()) {
      const age = now - l.at;
      if (age >= LASER_FADE_MS) continue;
      animating = true;
      PresentInkLayer._strokePath(ctx, l, w, h, 1 - age / LASER_FADE_MS, 3.2, true);
    }

    // At most one spotlight is meaningful; the newest wins if two peers somehow
    // both have one, because stacking dim masks would black the screen out.
    let newest: Spot | null = null;
    for (const s of this._spots.values()) if (!newest || s.at > newest.at) newest = s;
    if (newest) {
      animating = true;
      PresentInkLayer._spotlight(ctx, newest, w, h);
    }

    if (animating) this._kick();
  }

  private _expire(now: number): void {
    for (const [id, l] of this._lasers) if (now - l.at > STALE_MS) this._lasers.delete(id);
    for (const [id, s] of this._spots) if (now - s.at > STALE_MS) this._spots.delete(id);
  }

  private static _strokePath(
    ctx: CanvasRenderingContext2D,
    s: Stroke,
    w: number,
    h: number,
    alpha: number,
    width = 2.6,
    glow = false,
  ): void {
    if (s.pts.length < 2) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = width;
    if (glow) {
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 8;
    }
    ctx.beginPath();
    ctx.moveTo(s.pts[0][0] * w, s.pts[0][1] * h);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0] * w, s.pts[i][1] * h);
    ctx.stroke();
    ctx.restore();
  }

  /** Dim everything, then punch a feathered hole — mirrors PresentAnnotator. */
  private static _spotlight(
    ctx: CanvasRenderingContext2D,
    s: Spot,
    w: number,
    h: number,
  ): void {
    const x = s.x * w;
    const y = s.y * h;
    const r = Math.max(8, s.r * Math.min(w, h));
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${SPOTLIGHT_DIM})`;
    ctx.fillRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(x, y, r * 0.72, x, y, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // A thin ring in the briefer's colour, so it is obvious whose lens this is.
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Keep only finite, in-range pairs — this is wire data. */
  private static _clean(pts: InkPayload['pts']): Array<[number, number]> {
    if (!Array.isArray(pts)) return [];
    const out: Array<[number, number]> = [];
    for (const p of pts) {
      const x = Number(p?.[0]);
      const y = Number(p?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < -0.5 || x > 1.5 || y < -0.5 || y > 1.5) continue;
      out.push([x, y]);
      if (out.length >= MAX_STROKE_PTS) break;
    }
    return out;
  }

  private static _injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.ms-collab-ink{position:absolute;inset:0;pointer-events:none;z-index:41}
`;
    document.head.appendChild(style);
  }
}
