/**
 * PlatoonGuideBuaWorker.ts
 *
 * Fetches and parses the bundle's settlements.geojson (42 MB, mostly attributes) off the main thread and hands back the
 * compact store (PlatoonGuideBua) with its typed arrays transferred, so the map never stalls while it loads.
 * Message in: { url }. Out: { store } or { error }.
 */

import { buaTransfer, buildBuaStore } from './PlatoonGuideBua';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };

ctx.onmessage = async (e: MessageEvent) => {
  try {
    const r = await fetch(String(e.data?.url ?? ''));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const store = buildBuaStore(await r.json());
    ctx.postMessage({ store }, buaTransfer(store));
  } catch (err) {
    ctx.postMessage({ error: (err as Error)?.message ?? String(err) });
  }
};
