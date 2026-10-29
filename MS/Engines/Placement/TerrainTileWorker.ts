/**
 * TerrainTileWorker.ts
 *
 * Web Worker for the Placement Advisor's cold path: fetches and decodes terrain
 * PNG tiles and paints overlay tiles, so none of that work (≈3 ms per tile of
 * canvas readback and byte loops) lands on the main thread while the user pans.
 * The mouse-move verdict path does NOT use this — it reads decoded tiles
 * synchronously on the main thread.
 *
 * Bundled inline (`?worker&inline`) by WorkerTileSource, so it needs no extra
 * file on the host's static server and works air-gapped. Self-contained: it may
 * only import pure modules (no DOM, no ArcGIS).
 *
 * Protocol (all fields are plain; no property starts with "_" because the
 * production build mangles those):
 *   → { id, op: 'tile',    url }
 *   ← { id, data: ArrayBuffer | null }               null = no coverage
 *   → { id, op: 'overlay', clsUrl, distUrl | null, params: OverlayPaintParams }
 *   ← { id, rgba: ArrayBuffer | null }               null = nothing to draw
 *   ← { id, error: string }                          on any failure
 */

import { paintOverlayTile, type OverlayPaintParams } from './PlacementOverlayPaint';

interface TileRequest {
  id: number;
  op: 'tile';
  url: string;
  tileSize: number;
}
interface OverlayRequest {
  id: number;
  op: 'overlay';
  clsUrl: string;
  distUrl: string | null;
  params: OverlayPaintParams;
}
type Request = TileRequest | OverlayRequest;

const ctx: any = self;
const CACHE_CAPACITY = 192;
/** Decoded tiles, keyed by URL, so the advisor and the overlay never decode the same tile twice. */
const decoded = new Map<string, Uint8Array | null>();
const inFlight = new Map<string, Promise<Uint8Array | null>>();

let canvas: OffscreenCanvas | null = null;
let g2d: OffscreenCanvasRenderingContext2D | null = null;

async function decode(url: string, ts: number): Promise<Uint8Array | null> {
  const resp = await fetch(url, { cache: 'force-cache' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  // SPA-fallback hosts answer a missing tile with 200 + HTML: that is "no coverage".
  if (!(resp.headers.get('content-type') ?? '').toLowerCase().startsWith('image/')) return null;
  const bmp = await createImageBitmap(await resp.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    if (!canvas || canvas.width !== ts) {
      canvas = new OffscreenCanvas(ts, ts);
      g2d = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
      if (!g2d) throw new Error('2D canvas context unavailable in worker');
    }
    g2d!.clearRect(0, 0, ts, ts);
    g2d!.drawImage(bmp, 0, 0);
    const rgba = g2d!.getImageData(0, 0, ts, ts).data;
    const out = new Uint8Array(ts * ts);
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4]; // greyscale → R channel
    return out;
  } finally {
    bmp.close();
  }
}

/** Decode with a small LRU and in-flight de-duplication. */
function load(url: string, ts: number): Promise<Uint8Array | null> {
  if (decoded.has(url)) {
    const v = decoded.get(url)!;
    decoded.delete(url); // refresh LRU position
    decoded.set(url, v);
    return Promise.resolve(v);
  }
  let p = inFlight.get(url);
  if (!p) {
    p = decode(url, ts).then(
      (v) => {
        inFlight.delete(url);
        decoded.set(url, v);
        if (decoded.size > CACHE_CAPACITY) decoded.delete(decoded.keys().next().value as string);
        return v;
      },
      (e) => {
        inFlight.delete(url);
        throw e;
      },
    );
    inFlight.set(url, p);
  }
  return p;
}

ctx.onmessage = async (e: MessageEvent<Request>) => {
  const m = e.data;
  try {
    if (m.op === 'tile') {
      const t = await load(m.url, m.tileSize);
      if (!t) {
        ctx.postMessage({ id: m.id, data: null });
        return;
      }
      // Hand back a copy: the decoded original stays in this worker's cache.
      const copy = t.slice();
      ctx.postMessage({ id: m.id, data: copy.buffer }, [copy.buffer]);
    } else if (m.op === 'overlay') {
      const ts = m.params.tileSize;
      const [ct, dt] = await Promise.all([
        load(m.clsUrl, ts),
        m.distUrl ? load(m.distUrl, ts).catch(() => null) : Promise.resolve(null),
      ]);
      if (!ct) {
        ctx.postMessage({ id: m.id, rgba: null });
        return;
      }
      const rgba = paintOverlayTile(ct, dt, m.params);
      ctx.postMessage({ id: m.id, rgba: rgba.buffer }, [rgba.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ id: (m as Request).id, error: String((err as Error)?.message ?? err) });
  }
};
