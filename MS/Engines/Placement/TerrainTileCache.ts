/**
 * TerrainTileCache.ts
 *
 * Cold-path storage for the Placement Advisor: fetches 8-bit PNG tiles from a
 * static bundle folder, decodes them to Uint8Array and keeps an LRU of
 * decoded tiles. The hot path only ever calls `peek()`, which is a Map lookup.
 *
 * Tile scheme: Web Mercator XYZ, 256 px, y grows southward (OSM numbering).
 */

export interface TileSource {
  /** Resolve to the pixel values (tileSize² bytes), or null when the tile does not exist (404 = no coverage). */
  fetchTile(layer: string, z: number, x: number, y: number): Promise<Uint8Array | null>;
  /** Release resources (e.g. a worker) when the source is replaced or the engine is destroyed. */
  dispose?(): void;
}

export const MERC_ORIGIN = 20037508.342789244; // π · 6378137

export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const x = (lng * MERC_ORIGIN) / 180;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = (Math.log(Math.tan(((90 + clamped) * Math.PI) / 360)) / (Math.PI / 180)) * (MERC_ORIGIN / 180);
  return [x, y];
}

/** Web Mercator units per pixel at zoom `z` (equator; multiply by cos(lat) for ground metres). */
export function resolutionAt(z: number, tileSize = 256): number {
  return (2 * MERC_ORIGIN) / (tileSize * Math.pow(2, z));
}

/** Zoom whose resolution is closest to `res` map-units/px, clamped to [zMin, zMax]. */
export function zoomForResolution(res: number, zMin: number, zMax: number, tileSize = 256): number {
  if (!(res > 0)) return zMax;
  const z = Math.round(Math.log2((2 * MERC_ORIGIN) / (tileSize * res)));
  return Math.max(zMin, Math.min(zMax, z));
}

export interface TilePixel {
  tx: number;
  ty: number;
  px: number;
  py: number;
}

export function mercatorToTilePixel(x: number, y: number, z: number, tileSize = 256): TilePixel {
  const res = resolutionAt(z, tileSize);
  const gx = (x + MERC_ORIGIN) / res;
  const gy = (MERC_ORIGIN - y) / res;
  const tx = Math.floor(gx / tileSize);
  const ty = Math.floor(gy / tileSize);
  return {
    tx,
    ty,
    px: Math.min(tileSize - 1, Math.max(0, Math.floor(gx - tx * tileSize))),
    py: Math.min(tileSize - 1, Math.max(0, Math.floor(gy - ty * tileSize))),
  };
}

export function tileKey(layer: string, z: number, x: number, y: number): string {
  return `${layer}/${z}/${x}/${y}`;
}

/**
 * Default source: `${baseUrl}/${layer}/${z}/${x}/${y}.png`, decoded through
 * createImageBitmap with colour management off so pixel values survive intact.
 */
export class HttpPngTileSource implements TileSource {
  private _canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private _ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly tileSize: number,
  ) {}

  async fetchTile(layer: string, z: number, x: number, y: number): Promise<Uint8Array | null> {
    const url = `${this.baseUrl}/${layer}/${z}/${x}/${y}.png`;
    const resp = await fetch(url, { cache: 'force-cache' });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`tile ${url}: HTTP ${resp.status}`);
    // A host with an SPA fallback (Vite dev server, many production setups) answers a
    // missing tile with 200 + index.html instead of 404 — that is "no coverage", not a failure.
    if (!(resp.headers.get('content-type') ?? '').toLowerCase().startsWith('image/')) return null;
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob, {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    try {
      const ctx = this._context();
      ctx.clearRect(0, 0, this.tileSize, this.tileSize);
      ctx.drawImage(bmp, 0, 0);
      const rgba = ctx.getImageData(0, 0, this.tileSize, this.tileSize).data;
      const n = this.tileSize * this.tileSize;
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = rgba[i * 4]; // greyscale → R channel
      return out;
    } finally {
      bmp.close();
    }
  }

  private _context(): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
    if (this._ctx) return this._ctx;
    const s = this.tileSize;
    if (typeof OffscreenCanvas !== 'undefined') {
      this._canvas = new OffscreenCanvas(s, s);
    } else {
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      this._canvas = c;
    }
    const ctx = (this._canvas as any).getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this._ctx = ctx;
    return ctx;
  }
}

type Entry =
  | { state: 'loaded'; data: Uint8Array }
  | { state: 'missing' }
  | { state: 'pending' }
  | { state: 'failed'; retryAt: number };

export interface TileCacheStats {
  loaded: number;
  missing: number;
  pending: number;
  failed: number;
}

/** Result of a synchronous lookup: data, `null` = no coverage, `undefined` = not loaded yet. */
export type PeekResult = Uint8Array | null | undefined;

export class TerrainTileCache {
  private readonly _entries = new Map<string, Entry>();
  private readonly _queue: Array<{ key: string; layer: string; z: number; x: number; y: number }> = [];
  private _inFlight = 0;
  private _generation = 0;

  static readonly MAX_IN_FLIGHT = 6;
  static readonly RETRY_MS = 10_000;

  constructor(
    private _source: TileSource,
    private _capacity: number,
    /** Called after any tile settles (loaded / missing / failed). */
    private readonly _onChange?: () => void,
  ) {}

  setSource(source: TileSource): void {
    this._source = source;
    this.clear();
  }

  setCapacity(n: number): void {
    this._capacity = Math.max(16, n | 0);
    this._evict();
  }

  /** Drop everything; in-flight fetches from before are ignored on arrival. */
  clear(): void {
    this._entries.clear();
    this._queue.length = 0;
    this._generation++;
  }

  /**
   * Synchronous lookup. Queues a fetch on a miss but never waits for it —
   * this is the only method the mouse-move path calls.
   */
  peek(layer: string, z: number, x: number, y: number): PeekResult {
    const key = tileKey(layer, z, x, y);
    const e = this._entries.get(key);
    if (!e) {
      this.request(layer, z, x, y);
      return undefined;
    }
    switch (e.state) {
      case 'loaded':
        // Refresh LRU position.
        this._entries.delete(key);
        this._entries.set(key, e);
        return e.data;
      case 'missing':
        return null;
      case 'failed':
        if (Date.now() >= e.retryAt) {
          this._entries.delete(key);
          this.request(layer, z, x, y);
        }
        return undefined;
      default:
        // Still queued behind a prefetch burst: the cursor needs it now, so move it to the front.
        this._promote(key);
        return undefined;
    }
  }

  /** Drop fetches that are queued but not started (a pan/zoom made them stale). In-flight ones finish. */
  cancelQueued(): void {
    for (const job of this._queue) {
      if (this._entries.get(job.key)?.state === 'pending') this._entries.delete(job.key);
    }
    this._queue.length = 0;
  }

  has(layer: string, z: number, x: number, y: number): boolean {
    const e = this._entries.get(tileKey(layer, z, x, y));
    return !!e && (e.state === 'loaded' || e.state === 'missing');
  }

  /** Queue a fetch (deduplicated). Safe to call repeatedly. */
  request(layer: string, z: number, x: number, y: number): void {
    const key = tileKey(layer, z, x, y);
    if (this._entries.has(key)) return;
    this._entries.set(key, { state: 'pending' });
    this._queue.push({ key, layer, z, x, y });
    this._pump();
  }

  stats(): TileCacheStats {
    const s: TileCacheStats = { loaded: 0, missing: 0, pending: 0, failed: 0 };
    for (const e of this._entries.values()) s[e.state]++;
    return s;
  }

  /** Move a queued job to the top of the (LIFO) queue; no-op when it is already in flight. */
  private _promote(key: string): void {
    const q = this._queue;
    const last = q.length - 1;
    if (last < 0 || q[last].key === key) return;
    for (let i = last - 1; i >= 0; i--) {
      if (q[i].key === key) {
        q.push(q.splice(i, 1)[0]);
        return;
      }
    }
  }

  private _pump(): void {
    while (this._inFlight < TerrainTileCache.MAX_IN_FLIGHT && this._queue.length > 0) {
      // LIFO: the most recently requested tiles are the ones under the cursor now.
      const job = this._queue.pop()!;
      const gen = this._generation;
      this._inFlight++;
      this._source
        .fetchTile(job.layer, job.z, job.x, job.y)
        .then(
          (data) => {
            if (gen !== this._generation) return;
            this._entries.set(job.key, data ? { state: 'loaded', data } : { state: 'missing' });
            this._evict();
          },
          () => {
            if (gen !== this._generation) return;
            this._entries.set(job.key, { state: 'failed', retryAt: Date.now() + TerrainTileCache.RETRY_MS });
          },
        )
        .finally(() => {
          this._inFlight--;
          this._onChange?.();
          this._pump();
        });
    }
  }

  private _evict(): void {
    // Map iterates in insertion order; `peek` re-inserts on hit, so the first
    // loaded entries are the least recently used.
    let loaded = 0;
    for (const e of this._entries.values()) if (e.state === 'loaded') loaded++;
    if (loaded <= this._capacity) return;
    for (const [key, e] of this._entries) {
      if (e.state !== 'loaded') continue;
      this._entries.delete(key);
      if (--loaded <= this._capacity) break;
    }
  }
}
