/**
 * CollabTransport.ts
 *
 * Message plumbing for the Collab engine. Two interchangeable backends behind
 * one interface, chosen by `collab.transport` in Settings.json:
 *
 *   'sse'        SSE down (EventSource) + POST up, against a relay mounted on
 *                the same origin that serves the app. No database, no state on
 *                the relay — it only fans a message out to the other members of
 *                the room. See Server/collabRelay.js.
 *
 *   'broadcast'  BroadcastChannel. Multiple windows/tabs on ONE machine, no
 *                server at all. This is the fastest way to try the feature and
 *                what the integration tests use.
 *
 * Upstream sends are coalesced: ephemeral traffic (cursor / preview) waits up
 * to FLUSH_MS so a 20 Hz cursor stream costs ~20 POSTs a second instead of one
 * per event, while persistent ops (a drawn symbol, a deleted graphic) flush
 * immediately so an edit is never held back behind cursor jitter.
 *
 * A failed upstream POST is retried. EventSource reconnects the DOWNstream on
 * its own, which made an outage look survivable — but every op posted during it
 * was gone, so the two maps silently disagreed from then on with nothing logged
 * on either side. Persistent ops are therefore queued and replayed with backoff;
 * ephemeral ones are dropped, being expendable by design. Replay is safe without
 * re-stamping: an op keeps its original HLC, so if it did land the first time
 * (a lost RESPONSE looks identical to a lost request) the receiver's LWW gate
 * sees an equal — not newer — stamp and discards it.
 */

import { cerr, clog } from './CollabDebug.ts';
import { isPersistent, PROTOCOL_VERSION, type ClientId, type CollabMsg } from './CollabTypes.ts';

export type TransportStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface CollabTransport {
  readonly kind: 'sse' | 'broadcast';
  connect(): void;
  send(msg: CollabMsg): void;
  onMessage(cb: (msg: CollabMsg) => void): void;
  onStatus(cb: (status: TransportStatus, detail?: string) => void): void;
  close(): void;
}

export interface TransportOptions {
  room: string;
  clientId: ClientId;
  /** '' = same origin. Otherwise an absolute base like 'http://ops-pc:6547'. */
  relayUrl?: string;
  /**
   * Shared secret, appended as `?t=`. '' (the default) leaves the relay
   * unauthenticated, which is its documented posture on an isolated LAN.
   */
  token?: string;
  /**
   * Called when a message is dropped for speaking a different protocol version.
   * Without this a peer on an older build looks exactly like a peer who is not
   * in the room, which is a confusing way to fail after a partial rollout.
   */
  onIncompatible?: (from: ClientId, version: unknown) => void;
}

/** Upstream coalescing window for ephemeral messages. */
const FLUSH_MS = 40;
/** First retry delay after a failed POST; doubles up to RETRY_MAX_MS. */
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 4000;
/**
 * Cap on queued persistent ops awaiting replay.
 *
 * Bounded rather than unbounded because a relay that is never coming back would
 * otherwise let the queue grow for the life of the tab. 200 ops is far more than
 * any real outage produces at human editing speed, and dropping the OLDEST is
 * the right end to drop from: the newest state is what peers actually need.
 */
const MAX_RETRY_QUEUE = 200;
/**
 * Cap on one upstream POST body, in characters.
 *
 * The relay refuses a body over MAX_BODY_BYTES (8 MB, tools/collabRelay.js) by
 * destroying the request mid-read, which reaches this client as a network failure
 * rather than an HTTP status — so it took the `.catch` path and requeued the batch
 * whole. `_drainRetry` posted the ENTIRE queue as one body, so once the queue grew
 * past the relay's cap it could only ever fail, and retried forever at
 * RETRY_MAX_MS with nothing getting through.
 *
 * Half the relay's cap, because this counts characters and the relay counts bytes:
 * the margin covers a body that is entirely multi-byte.
 */
const MAX_POST_CHARS = 4_000_000;

// ── SSE + POST ──────────────────────────────────────────────────────────────

export class SseTransport implements CollabTransport {
  public readonly kind = 'sse' as const;

  private _es: EventSource | null = null;
  private _onMsg: ((m: CollabMsg) => void) | null = null;
  private _onStatus: ((s: TransportStatus, d?: string) => void) | null = null;
  private _queue: CollabMsg[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _closed = false;
  private _base: string;
  /** Persistent ops whose POST failed, awaiting replay. */
  private _retry: CollabMsg[] = [];
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _retryDelay = RETRY_MIN_MS;
  /** Plain field, not a parameter property — see CollabSession.opts. */
  private readonly opts: TransportOptions;

  constructor(opts: TransportOptions) {
    this.opts = opts;
    this._base = (opts.relayUrl || '').replace(/\/+$/, '');
  }

  /** Room, client and (when set) token are the same on every endpoint. */
  private _url(route: string): string {
    return (
      `${this._base}/collab/${route}` +
      `?room=${encodeURIComponent(this.opts.room)}` +
      `&client=${encodeURIComponent(this.opts.clientId)}` +
      (this.opts.token ? `&t=${encodeURIComponent(this.opts.token)}` : '')
    );
  }

  public connect(): void {
    this._closed = false;
    this._status('connecting');
    try {
      this._es = new EventSource(this._url('stream'));
    } catch (err) {
      this._status('error', err instanceof Error ? err.message : String(err));
      return;
    }
    this._es.onopen = () => {
      this._status('open');
      // The stream reopening is the best signal available that the relay is
      // reachable again, so stop backing off and replay immediately rather than
      // waiting out a timer that was sized for an outage now over.
      this._retryDelay = RETRY_MIN_MS;
      this._drainRetry();
    };
    // EventSource reconnects on its own; report the gap but do not tear down.
    this._es.onerror = () => {
      if (!this._closed) this._status('error', 'stream interrupted — retrying');
    };
    this._es.onmessage = (ev: MessageEvent) => {
      let parsed: any;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      const list: any[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const m of list) {
        if (m?.v !== PROTOCOL_VERSION) {
          this.opts.onIncompatible?.(m?.from, m?.v);
          continue;
        }
        if (m.from === this.opts.clientId) continue; // belt-and-braces echo guard
        this._onMsg?.(m as CollabMsg);
      }
    };
  }

  public send(msg: CollabMsg): void {
    if (this._closed) return;
    this._queue.push(msg);
    if (isPersistent(msg.t) || msg.t === 'hello' || msg.t === 'bye' || msg.t === 'snap.off') {
      this._flush();
      return;
    }
    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = null;
        this._flush();
      }, FLUSH_MS);
    }
  }

  private _flush(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._queue.length) return;
    const batch = this._queue;
    this._queue = [];
    this._post(batch);
  }

  /**
   * POST one batch, requeueing its persistent ops if the relay cannot be
   * reached. `_flush` and the retry drain both go through here so a first
   * attempt and a replay behave identically on failure.
   */
  private _post(batch: CollabMsg[]): void {
    const body = JSON.stringify(batch);

    /**
     * `keepalive` is ONLY for the final 'bye' during page unload, which is what
     * it exists for.
     *
     * It must not be used for ordinary traffic: the Fetch spec gives keepalive
     * requests a shared 64 KiB body budget across everything inflight, and
     * Chrome rejects requests that exceed it. Small cursor messages slipped
     * under the cap while a `g.up` carrying a serialised symbol did not — so
     * cursors appeared to work and no symbol ever propagated, silently.
     */
    const unloading = batch.some((m) => m.t === 'bye');

    void fetch(this._url('send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      ...(unloading ? { keepalive: true } : {}),
    })
      .then((res) => {
        if (res.ok) {
          this._retryDelay = RETRY_MIN_MS; // recovered — stop backing off
          clog('posted', batch.map((m) => m.t).join(','), `${body.length}B`);
          return;
        }
        // A 5xx may well clear on its own. A 4xx is this client's own fault —
        // an oversized body, a wrong token — and replaying it forever would
        // bury the real error under an endless retry loop.
        if (res.status >= 500) {
          cerr(`relay error HTTP ${res.status} — queued ${batch.length} op(s) for retry`, null);
          this._requeue(batch);
        } else {
          cerr(
            `relay rejected ${batch.length} message(s) — HTTP ${res.status}, not retrying`,
            null,
          );
        }
      })
      .catch((err) => {
        // Never silent: a dropped op is indistinguishable from a bug otherwise.
        cerr(`failed to post ${batch.map((m) => m.t).join(',')} (${body.length}B)`, err);
        this._requeue(batch);
      });
  }

  /** Queue a failed batch's persistent ops; at the cap the oldest go first. */
  private _requeue(batch: CollabMsg[]): void {
    if (this._closed) return;
    const worth: CollabMsg[] = [];
    for (const m of batch) {
      if (!isPersistent(m.t)) continue; // cursors and previews are not worth replaying
      // An op the relay can never accept must not enter the queue: it would fail
      // identically on every attempt and, sitting at the head, hold up everything
      // behind it. Losing one op loudly beats losing all of them silently.
      const len = JSON.stringify(m).length;
      if (len > MAX_POST_CHARS) {
        cerr(`dropping ${m.t} — ${Math.round(len / 1024)}KB exceeds what the relay accepts`, null);
        continue;
      }
      worth.push(m);
    }
    if (!worth.length) return;
    this._retry.push(...worth);
    const over = this._retry.length - MAX_RETRY_QUEUE;
    if (over > 0) {
      this._retry.splice(0, over);
      cerr(`retry queue full — discarded ${over} of the oldest queued op(s)`, null);
    }
    this._scheduleRetry();
  }

  private _scheduleRetry(): void {
    if (this._retryTimer || this._closed || !this._retry.length) return;
    const delay = this._retryDelay;
    this._retryDelay = Math.min(RETRY_MAX_MS, this._retryDelay * 2);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._drainRetry();
    }, delay);
  }

  /**
   * Replay as much of the queue as fits in one body, oldest first, leaving the
   * rest for the next tick. `_requeue` guarantees every individual op is under the
   * cap, so this always makes progress.
   */
  private _drainRetry(): void {
    if (this._closed || !this._retry.length) return;
    const batch: CollabMsg[] = [];
    let size = 0;
    while (this._retry.length) {
      const len = JSON.stringify(this._retry[0]).length;
      if (batch.length && size + len > MAX_POST_CHARS) break;
      batch.push(this._retry.shift()!);
      size += len;
    }
    clog(`replaying ${batch.length} queued op(s), ${this._retry.length} still queued`);
    this._post(batch);
    // Anything left rides the retry timer rather than going out immediately, so a
    // second batch is not fired at a relay that has yet to answer the first.
    if (this._retry.length) this._scheduleRetry();
  }

  public onMessage(cb: (m: CollabMsg) => void): void {
    this._onMsg = cb;
  }

  public onStatus(cb: (s: TransportStatus, d?: string) => void): void {
    this._onStatus = cb;
  }

  public close(): void {
    // Set before flushing so the final 'bye' still goes out (it reads the queue
    // directly) while _requeue refuses to queue anything after teardown.
    this._closed = true;
    this._flush();
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this._retry = [];
    this._es?.close();
    this._es = null;
    this._status('closed');
  }

  private _status(s: TransportStatus, d?: string): void {
    this._onStatus?.(s, d);
  }
}

// ── BroadcastChannel ────────────────────────────────────────────────────────

export class BroadcastTransport implements CollabTransport {
  public readonly kind = 'broadcast' as const;

  private _ch: BroadcastChannel | null = null;
  private _onMsg: ((m: CollabMsg) => void) | null = null;
  private _onStatus: ((s: TransportStatus, d?: string) => void) | null = null;
  /** Plain field, not a parameter property — see CollabSession.opts. */
  private readonly opts: TransportOptions;

  constructor(opts: TransportOptions) {
    this.opts = opts;
  }

  public connect(): void {
    if (typeof BroadcastChannel === 'undefined') {
      this._onStatus?.('error', 'BroadcastChannel unavailable in this browser');
      return;
    }
    this._ch = new BroadcastChannel(`pams8-collab-${this.opts.room}`);
    this._ch.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m?.v !== PROTOCOL_VERSION) {
        this.opts.onIncompatible?.(m?.from, m?.v);
        return;
      }
      if (m.from === this.opts.clientId) return;
      this._onMsg?.(m as CollabMsg);
    };
    this._onStatus?.('open');
  }

  public send(msg: CollabMsg): void {
    try {
      this._ch?.postMessage(msg);
    } catch {
      /* channel closed mid-send */
    }
  }

  public onMessage(cb: (m: CollabMsg) => void): void {
    this._onMsg = cb;
  }

  public onStatus(cb: (s: TransportStatus, d?: string) => void): void {
    this._onStatus = cb;
  }

  public close(): void {
    this._ch?.close();
    this._ch = null;
    this._onStatus?.('closed');
  }
}

export function createTransport(
  kind: string | undefined,
  opts: TransportOptions,
): CollabTransport {
  return kind === 'broadcast' ? new BroadcastTransport(opts) : new SseTransport(opts);
}
