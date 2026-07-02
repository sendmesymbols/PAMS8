/**
 * OneEuroFilter.ts
 *
 * The "1€ filter" (Casiez, Roussel & Vogel, CHI 2012) — a low-latency adaptive
 * low-pass filter for noisy interactive signals. It smooths a stylus/touch
 * position so the moving cursor and live preview glide instead of jittering,
 * while keeping latency low during fast movement (the cutoff rises with speed).
 *
 * Used ONLY by the premium stylus layer (PremiumStylus.ts) to smooth pointer
 * positions in screen space. It is a pure utility — no ArcGIS / DOM coupling.
 *
 * Tuning (screen-pixel domain, dt in seconds):
 *   minCutoff — lower = smoother but laggier when still (default 1.0 Hz)
 *   beta      — higher = less lag when moving fast (default 0.02)
 *   dCutoff   — cutoff for the derivative used to drive beta (default 1.0 Hz)
 */

/** A single scalar 1€ filter. */
class Scalar {
  private _hatPrev: number | null = null;
  private _dxHatPrev = 0;

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff: number,
  ) {}

  reset(): void {
    this._hatPrev = null;
    this._dxHatPrev = 0;
  }

  setParams(minCutoff: number, beta: number, dCutoff: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  /** Filter one sample. dt is the elapsed time in seconds since the last sample. */
  filter(x: number, dt: number): number {
    // First sample: pass through and seed history.
    if (this._hatPrev === null) {
      this._hatPrev = x;
      this._dxHatPrev = 0;
      return x;
    }
    // Non-advancing / invalid timestep (e.g. two samples in the same ms): keep
    // the last FILTERED value instead of jumping back to the raw sample.
    if (!isFinite(dt) || dt <= 0) {
      return this._hatPrev;
    }
    // Derivative of the signal, low-pass filtered.
    const dx = (x - this._hatPrev) / dt;
    const aD = this._alpha(dt, this.dCutoff);
    const dxHat = aD * dx + (1 - aD) * this._dxHatPrev;

    // Adaptive cutoff: faster movement → higher cutoff → less smoothing/lag.
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this._alpha(dt, cutoff);
    const hat = a * x + (1 - a) * this._hatPrev;

    this._hatPrev = hat;
    this._dxHatPrev = dxHat;
    return hat;
  }

  private _alpha(dt: number, cutoff: number): number {
    // Guard a misconfigured / corrupted cutoff (<=0 or non-finite) so tau can't
    // become Infinity/NaN and freeze the filter — fall back to no smoothing.
    if (!isFinite(cutoff) || cutoff <= 0) return 1;
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
}

export default class OneEuroFilter2D {
  private _x: Scalar;
  private _y: Scalar;
  private _tPrev: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this._x = new Scalar(minCutoff, beta, dCutoff);
    this._y = new Scalar(minCutoff, beta, dCutoff);
  }

  /** Re-tune both axes at runtime (e.g. from settings). */
  setParams(minCutoff: number, beta: number, dCutoff: number): void {
    this._x.setParams(minCutoff, beta, dCutoff);
    this._y.setParams(minCutoff, beta, dCutoff);
  }

  /** Clear history so the next sample passes through unfiltered (new stroke). */
  reset(): void {
    this._x.reset();
    this._y.reset();
    this._tPrev = null;
  }

  /**
   * Filter a 2D point. `t` is a timestamp in MILLISECONDS (e.g. event.timeStamp
   * or performance.now()); dt is derived internally.
   */
  filter(x: number, y: number, t: number): { x: number; y: number } {
    let dt = 0;
    if (this._tPrev !== null) dt = (t - this._tPrev) / 1000;
    this._tPrev = t;
    return { x: this._x.filter(x, dt), y: this._y.filter(y, dt) };
  }
}
