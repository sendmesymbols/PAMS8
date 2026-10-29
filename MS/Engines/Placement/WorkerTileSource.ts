/**
 * WorkerTileSource.ts
 *
 * TileSource backed by a Web Worker (TerrainTileWorker): PNG fetch + decode and
 * overlay painting happen off the main thread, so panning or zooming with the
 * advisor armed or the overlay on no longer saturates it. If the worker cannot
 * start (no Worker support, a CSP that forbids blob workers) or dies, every call
 * — including ones already in flight — silently falls back to the main-thread
 * HttpPngTileSource, so enabling it can never lose data.
 */

import TerrainTileWorker from './TerrainTileWorker.ts?worker&inline';
import type { OverlayPaintParams } from './PlacementOverlayPaint';
import { HttpPngTileSource, type TileSource } from './TerrainTileCache';

interface Pending {
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
  /** Re-run the same request on the main thread if the worker dies. */
  fallback: () => Promise<unknown>;
}

export class WorkerTileSource implements TileSource {
  private _worker: Worker | null = null;
  private _broken = false;
  private _seq = 0;
  private readonly _pending = new Map<number, Pending>();
  private readonly _fallback: HttpPngTileSource;
  /** Absolute base URL — a blob-URL worker has no base to resolve relative URLs against. */
  private readonly _abs: string;

  constructor(
    baseUrl: string,
    private readonly _tileSize: number,
  ) {
    this._abs = new URL(baseUrl, document.baseURI).href.replace(/\/+$/, '');
    this._fallback = new HttpPngTileSource(baseUrl, _tileSize);
  }

  /** True while the worker is running; false once it failed or was never available. */
  get workerActive(): boolean {
    return this._ensure() !== null;
  }

  async fetchTile(layer: string, z: number, x: number, y: number): Promise<Uint8Array | null> {
    const fb = () => this._fallback.fetchTile(layer, z, x, y);
    const data = await this._call<ArrayBuffer | null>(
      { op: 'tile', url: `${this._abs}/${layer}/${z}/${x}/${y}.png`, tileSize: this._tileSize },
      fb,
    );
    // The fallback resolves a Uint8Array; the worker resolves its transferred buffer.
    if (data === null) return null;
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  /**
   * Fetch, decode and paint one overlay tile in the worker. `fallback` paints it on the
   * main thread if the worker is unavailable. Resolves null when there is nothing to draw.
   */
  async renderOverlay(
    clsLayer: string,
    distLayer: string | null,
    z: number,
    ax: number,
    ay: number,
    params: OverlayPaintParams,
    fallback: () => Promise<Uint8ClampedArray | null>,
  ): Promise<Uint8ClampedArray | null> {
    const url = (layer: string) => `${this._abs}/${layer}/${z}/${ax}/${ay}.png`;
    const out = await this._call<ArrayBuffer | Uint8ClampedArray | null>(
      { op: 'overlay', clsUrl: url(clsLayer), distUrl: distLayer ? url(distLayer) : null, params },
      fallback,
    );
    if (out === null) return null;
    return out instanceof Uint8ClampedArray ? out : new Uint8ClampedArray(out);
  }

  dispose(): void {
    this._worker?.terminate();
    this._worker = null;
    this._broken = true;
    const err = new Error('tile worker disposed');
    for (const p of this._pending.values()) p.reject(err);
    this._pending.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private _call<T>(msg: Record<string, unknown>, fallback: () => Promise<unknown>): Promise<T> {
    const w = this._ensure();
    if (!w) return fallback() as Promise<T>;
    return new Promise<T>((resolve, reject) => {
      const id = ++this._seq;
      this._pending.set(id, { resolve, reject, fallback });
      try {
        w.postMessage({ id, ...msg });
      } catch (e) {
        this._pending.delete(id);
        this._fail(e);
        (fallback() as Promise<T>).then(resolve, reject);
      }
    });
  }

  private _ensure(): Worker | null {
    if (this._broken) return null;
    if (this._worker) return this._worker;
    try {
      const w = new TerrainTileWorker({ name: 'ms-terrain-tiles' });
      w.onmessage = (e: MessageEvent) => this._onMessage(e.data);
      w.onerror = (ev: ErrorEvent) => this._fail(new Error(ev.message || 'tile worker error'));
      this._worker = w;
    } catch (e) {
      this._fail(e);
    }
    return this._worker;
  }

  private _onMessage(m: { id: number; data?: ArrayBuffer | null; rgba?: ArrayBuffer | null; error?: string }): void {
    const p = this._pending.get(m.id);
    if (!p) return;
    this._pending.delete(m.id);
    if (m.error !== undefined) p.reject(new Error(m.error));
    else p.resolve('rgba' in m ? m.rgba : m.data);
  }

  /** The worker is unusable: stop using it and re-run everything in flight on the main thread. */
  private _fail(err: unknown): void {
    if (this._broken) return;
    this._broken = true;
    console.warn('[Placement] tile worker unavailable, decoding on the main thread:', err);
    this._worker?.terminate();
    this._worker = null;
    const inFlight = [...this._pending.values()];
    this._pending.clear();
    for (const p of inFlight) (p.fallback() as Promise<unknown>).then(p.resolve, p.reject);
  }
}
