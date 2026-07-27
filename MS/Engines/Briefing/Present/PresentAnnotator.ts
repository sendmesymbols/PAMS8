/**
 * PresentAnnotator.ts
 *
 * Live mark-up during a presentation: laser pointer, pen ink and a spotlight
 * dim mask. Owns two stacked canvases over the view container, both sized to
 * the container and rebuilt on resize:
 *
 *   ink (z 42) — pen strokes. Persistent for the session, repainted only when
 *                the stroke list or the canvas size changes.
 *   fx  (z 43) — laser trail / spotlight mask. Per-frame, cleared constantly,
 *                which is exactly why ink cannot share it.
 *
 * Only ONE tool is active at a time, so the fx layer is never contended. While
 * a tool is active the fx canvas takes pointer events (so a drag draws instead
 * of advancing the deck); with no tool both canvases are pointer-transparent
 * and clicks fall through to present mode's advance handler.
 *
 * Pen strokes are kept per slide id, normalized [0..1] against the canvas, so
 * they survive a resize and convert straight into 'freehand' SlideOverlays if
 * the briefer chooses to keep their ink on the way out.
 */

import LaserTrail from '../LaserTrail';
import type { SlideOverlay } from '../BriefingTypes';

export type PresentTool = 'none' | 'laser' | 'pen' | 'spotlight';

interface Stroke {
  /** Normalized [0..1] against canvas width/height. */
  pts: Array<{ x: number; y: number }>;
  color: string;
  /** Fraction of canvas height — matches SlideOverlay.strokeWidth. */
  width: number;
}

const DEFAULT_PEN_COLOR = '#ff2d2d';
/** Fraction of view height. ~2.6px on a 1080-tall view. */
const DEFAULT_PEN_WIDTH = 0.0024;
const DEFAULT_SPOTLIGHT_RADIUS = 0.12;
const SPOTLIGHT_DIM = 0.72;
/** Radius bounds as a fraction of the view's smaller side. */
const SPOTLIGHT_MIN = 0.03;
const SPOTLIGHT_MAX = 0.6;

export default class PresentAnnotator {
  private _container: HTMLElement;
  private _ink: HTMLCanvasElement;
  private _fx: HTMLCanvasElement;
  private _tool: PresentTool = 'none';
  private _laser: LaserTrail;

  /** slide id → strokes drawn on it this session. */
  private _strokes = new Map<string, Stroke[]>();
  private _slideId: string | null = null;
  private _active: Stroke | null = null;

  private _spotAt: { x: number; y: number } | null = null;
  private _spotRadius: number;
  private _penColor: string;
  private _penWidth: number;

  private _onDown: (e: PointerEvent) => void;
  private _onMove: (e: PointerEvent) => void;
  private _onUp: (e: PointerEvent) => void;

  constructor(
    container: HTMLElement,
    opts?: { penColor?: string; penWidth?: number; spotlightRadius?: number },
  ) {
    this._container = container;
    this._penColor = opts?.penColor || DEFAULT_PEN_COLOR;
    const penWidth = Number(opts?.penWidth);
    this._penWidth = penWidth > 0 ? penWidth : DEFAULT_PEN_WIDTH;
    const spot = Number(opts?.spotlightRadius);
    this._spotRadius = spot > 0 ? spot : DEFAULT_SPOTLIGHT_RADIUS;

    this._ink = this._makeCanvas(42);
    this._fx = this._makeCanvas(43);
    this._laser = new LaserTrail(this._fx);
    this.resize();

    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._fx.addEventListener('pointerdown', this._onDown);
    this._fx.addEventListener('pointermove', this._onMove);
    this._fx.addEventListener('pointerup', this._onUp);
    this._fx.addEventListener('pointerleave', this._onUp);
  }

  private _makeCanvas(z: number): HTMLCanvasElement {
    const el = document.createElement('canvas');
    el.className = 'ms-present-annotator';
    el.style.zIndex = String(z);
    el.style.pointerEvents = 'none';
    this._container.appendChild(el);
    return el;
  }

  // ── Tool state ─────────────────────────────────────────────────────────────

  public get tool(): PresentTool {
    return this._tool;
  }

  public setTool(tool: PresentTool): void {
    if (this._tool === tool) return;
    this._finishStroke();
    this._laser.dispose();
    this._spotAt = null;
    this._clearFx();
    this._tool = tool;
    // Only an active tool intercepts pointers; 'none' lets clicks advance.
    this._fx.style.pointerEvents = tool === 'none' ? 'none' : 'auto';
    this._fx.style.cursor = tool === 'none' ? '' : 'crosshair';
    if (tool === 'spotlight') {
      // The hole only tracks the cursor once it MOVES, so seed it at the centre
      // — otherwise turning the spotlight on blacks the screen out entirely
      // until the briefer happens to move the mouse.
      this._spotAt = { x: this._fx.width / 2, y: this._fx.height / 2 };
      this._paintSpotlight();
    }
  }

  /** Toggle a tool on, or back off if it was already the active one. */
  public toggleTool(tool: PresentTool): PresentTool {
    this.setTool(this._tool === tool ? 'none' : tool);
    return this._tool;
  }

  /** Grow / shrink the spotlight hole. `delta` is a fraction of the smaller side. */
  public nudgeSpotlight(delta: number): void {
    this._spotRadius = Math.max(SPOTLIGHT_MIN, Math.min(SPOTLIGHT_MAX, this._spotRadius + delta));
    if (this._tool === 'spotlight') this._paintSpotlight();
  }

  // ── Slide lifecycle ────────────────────────────────────────────────────────

  /** Switch to another slide's ink. The active tool is deliberately kept. */
  public setSlide(slideId: string | null): void {
    if (this._slideId === slideId) return;
    this._finishStroke();
    this._slideId = slideId;
    this._paintInk();
  }

  public hasInk(slideId?: string | null): boolean {
    const id = slideId === undefined ? this._slideId : slideId;
    if (id === null || id === undefined) return false;
    return (this._strokes.get(id)?.length ?? 0) > 0;
  }

  public hasAnyInk(): boolean {
    for (const strokes of this._strokes.values()) if (strokes.length) return true;
    return false;
  }

  /** Drop the current slide's ink. */
  public clearInk(): void {
    this._finishStroke();
    if (this._slideId) this._strokes.delete(this._slideId);
    this._paintInk();
  }

  /**
   * The session's pen strokes as persistable overlays, keyed by slide id.
   * Points are already normalized [0..1]; the bbox is derived from them, which
   * is the same shape OverlayFabric reads back for a 'freehand' overlay.
   */
  public inkAsOverlays(): Map<string, SlideOverlay[]> {
    const out = new Map<string, SlideOverlay[]>();
    for (const [slideId, strokes] of this._strokes) {
      const overlays: SlideOverlay[] = [];
      for (const s of strokes) {
        if (s.pts.length < 2) continue;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of s.pts) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        overlays.push({
          id: `ink-${Math.random().toString(36).slice(2, 10)}`,
          kind: 'freehand',
          x: minX,
          y: minY,
          w: Math.max(0.001, maxX - minX),
          h: Math.max(0.001, maxY - minY),
          points: s.pts.map((p) => ({ x: Number(p.x.toFixed(5)), y: Number(p.y.toFixed(5)) })),
          stroke: s.color,
          strokeWidth: s.width,
        });
      }
      if (overlays.length) out.set(slideId, overlays);
    }
    return out;
  }

  // ── Painting ───────────────────────────────────────────────────────────────

  /** Match both canvases to the container box and repaint. Cheap to over-call. */
  public resize(): void {
    const w = Math.max(1, this._container.clientWidth);
    const h = Math.max(1, this._container.clientHeight);
    for (const el of [this._ink, this._fx]) {
      if (el.width !== w) el.width = w;
      if (el.height !== h) el.height = h;
    }
    this._paintInk();
    if (this._tool === 'spotlight') this._paintSpotlight();
  }

  private _clearFx(): void {
    const ctx = this._fx.getContext('2d');
    ctx?.clearRect(0, 0, this._fx.width, this._fx.height);
  }

  private _paintInk(): void {
    const ctx = this._ink.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this._ink;
    ctx.clearRect(0, 0, w, h);
    const strokes = (this._slideId && this._strokes.get(this._slideId)) || [];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      if (s.pts.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.width * h);
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x * w, s.pts[0].y * h);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x * w, s.pts[i].y * h);
      ctx.stroke();
    }
  }

  /** Dim everything, then punch a soft hole at the cursor with destination-out. */
  private _paintSpotlight(): void {
    const ctx = this._fx.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this._fx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgba(0,0,0,${SPOTLIGHT_DIM})`;
    ctx.fillRect(0, 0, w, h);
    if (!this._spotAt) return;
    const r = this._spotRadius * Math.min(w, h);
    const { x, y } = this._spotAt;
    // A hard core with a feathered rim reads as a real spotlight rather than a
    // cut-out circle. destination-out uses only the gradient's ALPHA.
    const grad = ctx.createRadialGradient(x, y, r * 0.72, x, y, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ── Pointer handling ───────────────────────────────────────────────────────

  private _at(e: PointerEvent): { x: number; y: number } {
    const rect = this._fx.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private _pointerDown(e: PointerEvent): void {
    if (this._tool === 'none') return;
    // Never let a mark-up drag reach the view's advance handler or start a map pan.
    e.preventDefault();
    e.stopPropagation();
    try {
      this._fx.setPointerCapture(e.pointerId);
    } catch {}
    const p = this._at(e);
    if (this._tool === 'laser') {
      this._laser.onDown(p.x, p.y);
    } else if (this._tool === 'pen') {
      const { width: w, height: h } = this._ink;
      this._active = {
        pts: [{ x: p.x / w, y: p.y / h }],
        color: this._penColor,
        width: this._penWidth,
      };
    } else if (this._tool === 'spotlight') {
      this._spotAt = p;
      this._paintSpotlight();
    }
  }

  private _pointerMove(e: PointerEvent): void {
    if (this._tool === 'none') return;
    const p = this._at(e);
    if (this._tool === 'laser') {
      this._laser.onMove(p.x, p.y);
    } else if (this._tool === 'pen' && this._active) {
      const { width: w, height: h } = this._ink;
      this._active.pts.push({ x: p.x / w, y: p.y / h });
      this._paintInk();
      this._paintActiveStroke();
    } else if (this._tool === 'spotlight') {
      // Spotlight tracks the cursor with no button held — it is a lens, not a stroke.
      this._spotAt = p;
      this._paintSpotlight();
    }
  }

  private _pointerUp(e: PointerEvent): void {
    if (this._tool === 'none') return;
    try {
      this._fx.releasePointerCapture(e.pointerId);
    } catch {}
    if (this._tool === 'laser') this._laser.onUp();
    else if (this._tool === 'pen') this._finishStroke();
  }

  /** Draw the in-progress stroke on top of the committed ones, without committing it. */
  private _paintActiveStroke(): void {
    const ctx = this._ink.getContext('2d');
    const s = this._active;
    if (!ctx || !s || s.pts.length < 2) return;
    const { width: w, height: h } = this._ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.width * h);
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x * w, s.pts[0].y * h);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x * w, s.pts[i].y * h);
    ctx.stroke();
  }

  private _finishStroke(): void {
    const s = this._active;
    this._active = null;
    if (!s || s.pts.length < 2 || !this._slideId) {
      this._paintInk();
      return;
    }
    const list = this._strokes.get(this._slideId) ?? [];
    list.push(s);
    this._strokes.set(this._slideId, list);
    this._paintInk();
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  public dispose(): void {
    this._laser.dispose();
    this._fx.removeEventListener('pointerdown', this._onDown);
    this._fx.removeEventListener('pointermove', this._onMove);
    this._fx.removeEventListener('pointerup', this._onUp);
    this._fx.removeEventListener('pointerleave', this._onUp);
    this._ink.remove();
    this._fx.remove();
    this._strokes.clear();
  }
}
