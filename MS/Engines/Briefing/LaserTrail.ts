/**
 * LaserTrail.ts
 *
 * Ephemeral laser-pointer trail. Points collected while the pointer is dragged
 * render via requestAnimationFrame and decay away over ~1 s — the width/alpha
 * easing follows Excalidraw's laserTrails.ts (DECAY_TIME / DECAY_LENGTH easeOut
 * mapping). Nothing here is ever persisted.
 *
 * Two targets, picked by what the constructor is handed:
 *   • a fabric.Canvas  — the SlideEditor. Paints on fabric's upper canvas
 *     (`contextTop`) through the canvas viewportTransform, so the beam tracks
 *     the artboard when the editor is zoomed or panned.
 *   • an HTMLCanvasElement — present mode's annotator FX layer. No fabric, no
 *     viewport transform: points are already in canvas pixels.
 *
 * fabric.js 4.5 is a CDN global (`window.fabric`) — never import it.
 */

const DECAY_TIME_MS = 1000;
/** Trailing points beyond this many fade by position as well as by age. */
const DECAY_LENGTH = 60;
const COLOR = '255, 45, 45'; // laser red (rgb parts)

const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

/** What the renderer needs, whichever target it was handed. */
interface TrailSurface {
  ctx: CanvasRenderingContext2D;
  clear: () => void;
  /** fabric viewportTransform, or null when painting straight onto a canvas. */
  vpt: number[] | null;
  zoom: number;
}

export default class LaserTrail {
  private _fc: any = null; // fabric.Canvas, when constructed from one
  private _el: HTMLCanvasElement | null = null; // raw canvas, when constructed from one
  private _pts: TrailPoint[] = [];
  private _raf = 0;
  private _down = false;

  constructor(target: any) {
    if (typeof HTMLCanvasElement !== 'undefined' && target instanceof HTMLCanvasElement) {
      this._el = target;
    } else {
      this._fc = target;
    }
  }

  /**
   * Resolve the paint surface for this frame. Returns null once the target is
   * gone (canvas detached, fabric canvas disposed), which stops the loop.
   */
  private _surface(): TrailSurface | null {
    if (this._el) {
      const ctx = this._el.getContext('2d');
      if (!ctx) return null;
      const el = this._el;
      return {
        ctx,
        clear: () => ctx.clearRect(0, 0, el.width, el.height),
        vpt: null,
        zoom: 1,
      };
    }
    const fc = this._fc;
    const ctx = fc?.contextTop;
    if (!ctx) return null;
    return {
      ctx,
      clear: () => fc.clearContext(ctx),
      vpt: fc.viewportTransform ?? null,
      zoom: fc.getZoom?.() || 1,
    };
  }

  public onDown(x: number, y: number): void {
    this._down = true;
    this._push(x, y);
  }

  public onMove(x: number, y: number): void {
    if (!this._down) return;
    this._push(x, y);
  }

  public onUp(): void {
    this._down = false;
  }

  /** Stop immediately: drop points, cancel the loop, wipe the overlay canvas. */
  public dispose(): void {
    this._down = false;
    this._pts = [];
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    try {
      this._surface()?.clear();
    } catch {}
  }

  private _push(x: number, y: number): void {
    this._pts.push({ x, y, t: performance.now() });
    if (!this._raf) this._raf = requestAnimationFrame(() => this._render());
  }

  private _render(): void {
    this._raf = 0;
    const surface = this._surface();
    if (!surface) return;
    const { ctx, vpt, zoom } = surface;

    const now = performance.now();
    this._pts = this._pts.filter((p) => now - p.t < DECAY_TIME_MS);
    surface.clear();

    const pts = this._pts;
    if (pts.length >= 2) {
      ctx.save();
      // In the editor, points arrive in scene coordinates but contextTop paints
      // in screen space, so the canvas viewport transform has to be applied here
      // or the trail lands somewhere else entirely once zoomed/panned. On a raw
      // canvas (present mode) there is no transform and vpt is null.
      if (vpt) ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const age = easeOut(1 - (now - pts[i].t) / DECAY_TIME_MS);
        const tail = easeOut(1 - Math.max(0, pts.length - 1 - i - DECAY_LENGTH) / DECAY_LENGTH);
        const k = Math.min(age, tail);
        if (k <= 0.01) continue;
        // Soft halo pass under a bright core, like a real laser dot smear.
        // Widths divide out the zoom so the beam stays the same on-screen size.
        ctx.strokeStyle = `rgba(${COLOR}, ${0.22 * k})`;
        ctx.lineWidth = (10 * k) / zoom;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${COLOR}, ${0.9 * k})`;
        ctx.lineWidth = (3.5 * k) / zoom;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this._pts.length || this._down) {
      this._raf = requestAnimationFrame(() => this._render());
    }
  }
}
