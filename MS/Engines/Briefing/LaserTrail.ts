/**
 * LaserTrail.ts
 *
 * Ephemeral laser-pointer trail for the SlideEditor's fabric canvas. Points
 * collected while the pointer is dragged render on fabric's upper canvas
 * (`contextTop`) via requestAnimationFrame and decay away over ~1 s — the
 * width/alpha easing follows Excalidraw's laserTrails.ts (DECAY_TIME /
 * DECAY_LENGTH easeOut mapping). Nothing here is ever persisted.
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

export default class LaserTrail {
  private _fc: any; // fabric.Canvas
  private _pts: TrailPoint[] = [];
  private _raf = 0;
  private _down = false;

  constructor(fc: any) {
    this._fc = fc;
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
      this._fc?.clearContext?.(this._fc.contextTop);
    } catch {}
  }

  private _push(x: number, y: number): void {
    this._pts.push({ x, y, t: performance.now() });
    if (!this._raf) this._raf = requestAnimationFrame(() => this._render());
  }

  private _render(): void {
    this._raf = 0;
    const fc = this._fc;
    const ctx = fc?.contextTop;
    if (!ctx) return;

    const now = performance.now();
    this._pts = this._pts.filter((p) => now - p.t < DECAY_TIME_MS);
    fc.clearContext(ctx);

    const pts = this._pts;
    if (pts.length >= 2) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const age = easeOut(1 - (now - pts[i].t) / DECAY_TIME_MS);
        const tail = easeOut(1 - Math.max(0, pts.length - 1 - i - DECAY_LENGTH) / DECAY_LENGTH);
        const k = Math.min(age, tail);
        if (k <= 0.01) continue;
        // Soft halo pass under a bright core, like a real laser dot smear.
        ctx.strokeStyle = `rgba(${COLOR}, ${0.22 * k})`;
        ctx.lineWidth = 10 * k;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${COLOR}, ${0.9 * k})`;
        ctx.lineWidth = 3.5 * k;
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
