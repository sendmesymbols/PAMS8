/**
 * CollabSession.ts
 *
 * Identity, peer roster, heartbeat, and the last-write-wins gate. Everything
 * above this file (MapSync, SlideSync, Presence) talks to the session rather
 * than to a transport, so swapping SSE for BroadcastChannel — or, later, a Yjs
 * provider — changes nothing outside this folder.
 *
 * Roster protocol: on connect we announce 'hello'. Any peer receiving a hello
 * from an unknown client answers with its own hello (`reply: true`, so the
 * answer is never answered) — that is enough for every peer to learn every
 * other without the relay holding any state. A 'ping' every HEARTBEAT_MS keeps
 * the entry alive; peers unheard-from for PEER_TIMEOUT_MS are dropped, which is
 * also how a browser crash (no 'bye') resolves.
 */

import EngineLogger from '../../Support/EngineLogger.ts';
import { cerr, clog } from './CollabDebug.ts';
import {
  colorForClient,
  hlcNewer,
  hlcRecv,
  hlcSend,
  isPersistent,
  isValidPayload,
  MAX_NAME_LEN,
  newClientId,
  newHlcState,
  PROTOCOL_VERSION,
  sanitizeUser,
  type ClientId,
  type CollabMsg,
  type CollabMsgType,
  type CollabUser,
  type HLC,
  type HlcState,
} from './CollabTypes.ts';
import {
  createTransport,
  type CollabTransport,
  type TransportOptions,
  type TransportStatus,
} from './CollabTransport.ts';

const ENGINE_NAME = 'Collab Engine';
const HEARTBEAT_MS = 5000;
const PEER_TIMEOUT_MS = 16000;
/**
 * Floor between re-introduction hellos. A peer that was pruned while its tab was
 * in the background is re-learned from its first message, and this stops a burst
 * of cursor traffic from a still-unknown peer turning into a burst of hellos.
 */
const REDISCOVER_MIN_MS = 1000;
/** Display name — per browser profile, so it survives across sessions. */
const NAME_KEY = 'pams8.collab.name';
/**
 * Room — per browser profile. Without this the room lives only in the imported
 * Settings.json module, which is rebuilt on every reload, so a room typed into
 * the settings panel was forgotten the moment the page refreshed.
 */
const ROOM_KEY = 'pams8.collab.room';
/**
 * Client id — per TAB (sessionStorage), not per profile. Two windows of the same
 * browser must be two different people: they share localStorage, so a
 * profile-wide id would give both the same identity, and each would then discard
 * the other's messages as its own echo. A reload keeps the same tab's id, so
 * refreshing rejoins as the same person rather than appearing as a newcomer.
 */
const ID_KEY = 'pams8.collab.clientId';

export interface Peer {
  user: CollabUser;
  /** Date.now() of the last message from this peer. */
  lastSeen: number;
  /**
   * False until this peer's own `hello` has arrived. A peer first seen through
   * some other message (see _rediscover) is provisional: it counts in the roster
   * immediately, but its name is a placeholder until it introduces itself.
   */
  known: boolean;
}

export interface SessionOptions {
  room: string;
  transport: string;
  relayUrl: string;
  /** '' = auto-generate a friendly name. */
  userName: string;
  /** Shared secret for the relay; '' leaves it unauthenticated. */
  token?: string;
  /**
   * Test seam. `connect()` otherwise reaches straight for `createTransport`,
   * which needs EventSource and fetch — so the roster protocol, the rediscovery
   * path and the last-write-wins gate, which is where being wrong is silent,
   * could not be tested at all without a browser. Production never passes this.
   */
  transportFactory?: (kind: string, opts: TransportOptions) => CollabTransport;
}

type MsgHandler = (msg: CollabMsg) => void;

export default class CollabSession {
  public readonly me: CollabUser;

  private _transport: CollabTransport | null = null;
  private _peers = new Map<ClientId, Peer>();
  private _handlers = new Map<CollabMsgType, MsgHandler[]>();
  private _rosterCbs: Array<(peers: Peer[]) => void> = [];
  private _statusCbs: Array<(s: TransportStatus, d?: string) => void> = [];
  private _hlc: HlcState = newHlcState();
  /** entity key → winning stamp. The last-write-wins table. */
  private _stamps = new Map<string, HLC>();
  private _heartbeat: ReturnType<typeof setInterval> | null = null;
  private _status: TransportStatus = 'closed';
  private _unloadHandler: (() => void) | null = null;
  private _lastRediscover = 0;
  /** Client ids seen on a different protocol version — surfaced in the roster. */
  private _incompatible = new Set<ClientId>();

  /**
   * Declared as a plain field rather than a constructor parameter property so
   * CollabSession.test.ts can run under bare `node`, whose strip-only TypeScript
   * rejects parameter properties. CollabLocks does the same, for the same reason.
   */
  private readonly opts: SessionOptions;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.me = CollabSession._loadIdentity(opts.userName);
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  /**
   * Identity is split across two stores on purpose — see ID_KEY / NAME_KEY.
   * The display name follows Settings when set, else the remembered one, else an
   * auto-generated one: deliberately no modal on join.
   */
  private static _loadIdentity(settingsName: string): CollabUser {
    let id = '';
    let savedName = '';
    try {
      id = sessionStorage.getItem(ID_KEY) || '';
      savedName = localStorage.getItem(NAME_KEY) || '';
    } catch {
      /* storage blocked — fall through to a fresh in-memory identity */
    }
    if (!id) {
      id = newClientId();
      try {
        sessionStorage.setItem(ID_KEY, id);
      } catch {
        /* identity lasts for this page load only */
      }
    }
    const name = (
      (settingsName || '').trim() ||
      savedName ||
      `User-${id.slice(0, 4)}`
    ).slice(0, MAX_NAME_LEN);
    CollabSession._rememberName(name);
    return { id, name, color: colorForClient(id) };
  }

  private static _rememberName(name: string): void {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* private browsing — the name simply is not remembered */
    }
  }

  /**
   * Resolve the room to join, most specific first: an explicit `?room=` in the
   * URL (so a room is shareable as a link), then the last room used on this
   * browser profile, then the Settings.json default.
   */
  public static loadRoom(settingsRoom: string): string {
    let fromUrl = '';
    try {
      fromUrl = (new URLSearchParams(location.search).get('room') || '').trim();
    } catch {
      /* no location — non-browser host */
    }
    if (fromUrl) return fromUrl.slice(0, 64);
    let saved = '';
    try {
      saved = (localStorage.getItem(ROOM_KEY) || '').trim();
    } catch {
      /* storage blocked */
    }
    return saved || (settingsRoom || '').trim() || 'default';
  }

  public static rememberRoom(room: string): void {
    try {
      localStorage.setItem(ROOM_KEY, room);
    } catch {
      /* private browsing — the room simply is not remembered */
    }
  }

  public setUserName(name: string): void {
    const clean = (name || '').trim().slice(0, MAX_NAME_LEN);
    if (!clean || clean === this.me.name) return;
    this.me.name = clean;
    CollabSession._rememberName(clean);
    this._sendHello(false);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  public connect(): void {
    const make = this.opts.transportFactory ?? createTransport;
    this._transport = make(this.opts.transport, {
      room: this.opts.room,
      clientId: this.me.id,
      relayUrl: this.opts.relayUrl,
      token: this.opts.token,
      onIncompatible: (from, version) => {
        if (!from || this._incompatible.has(from)) return;
        this._incompatible.add(from);
        EngineLogger.error(
          ENGINE_NAME,
          `A peer is running protocol v${version} — this build speaks v${PROTOCOL_VERSION}. Its edits are ignored.`,
        );
        this._emitRoster();
      },
    });
    this._transport.onMessage((m) => this._receive(m));
    this._transport.onStatus((s, d) => {
      this._status = s;
      this._statusCbs.forEach((cb) => cb(s, d));
      if (s === 'open') this._sendHello(false);
    });
    this._transport.connect();

    this._heartbeat = setInterval(() => {
      this.send('ping', undefined);
      this._prunePeers();
    }, HEARTBEAT_MS);

    // A closing tab should vanish immediately rather than linger for the
    // timeout; 'bye' rides a keepalive POST so it survives unload.
    this._unloadHandler = () => this.send('bye', undefined);
    // Guarded so the session can be exercised under bare `node` — see
    // SessionOptions.transportFactory.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this._unloadHandler);
    }
  }

  public disconnect(): void {
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
    if (this._unloadHandler) {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', this._unloadHandler);
      }
      this._unloadHandler = null;
    }
    this.send('bye', undefined);
    this._transport?.close();
    this._transport = null;
    this._peers.clear();
    this._stamps.clear();
    this._emitRoster();
  }

  public get status(): TransportStatus {
    return this._status;
  }

  public get transportKind(): string {
    return this._transport?.kind ?? 'none';
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  /**
   * Publish a message. Persistent types are stamped and recorded in the local
   * LWW table under `entityKey`, so our own op cannot later be undone by a
   * stale remote one.
   */
  public send(t: CollabMsgType, d: any, entityKey?: string): void {
    if (!this._transport) {
      // Heartbeat pings racing a teardown are expected; anything else is a real
      // dropped op and must be visible.
      if (t !== 'cursor' && t !== 'ping') {
        cerr(`dropped ${t} — no transport (not connected)`, null);
      }
      return;
    }
    if (t !== 'cursor' && t !== 'ping') clog('send', t, entityKey ?? '');
    const msg: CollabMsg = { v: PROTOCOL_VERSION, t, from: this.me.id, d };
    if (isPersistent(t)) {
      const ts = hlcSend(this._hlc, this.me.id);
      msg.ts = ts;
      if (entityKey) this._stamps.set(entityKey, ts);
    }
    this._transport.send(msg);
  }

  /** Send addressed to one peer (used for snapshot offers). */
  public sendTo(to: ClientId, t: CollabMsgType, d: any): void {
    if (!this._transport) return;
    this._transport.send({ v: PROTOCOL_VERSION, t, from: this.me.id, to, d });
  }

  private _sendHello(reply: boolean): void {
    this.send('hello', { user: this.me, reply });
  }

  // ── Receive ───────────────────────────────────────────────────────────────

  public on(t: CollabMsgType, handler: MsgHandler): () => void {
    const list = this._handlers.get(t) ?? [];
    list.push(handler);
    this._handlers.set(t, list);
    return () => {
      const cur = this._handlers.get(t);
      if (!cur) return;
      const i = cur.indexOf(handler);
      if (i > -1) cur.splice(i, 1);
    };
  }

  /** Returns an unsubscriber, like `on()` — the roster bar is remounted on a
   *  settings toggle and must be able to detach its old listener. */
  public onRoster(cb: (peers: Peer[]) => void): () => void {
    this._rosterCbs.push(cb);
    return () => {
      const i = this._rosterCbs.indexOf(cb);
      if (i > -1) this._rosterCbs.splice(i, 1);
    };
  }

  public onStatus(cb: (s: TransportStatus, d?: string) => void): () => void {
    this._statusCbs.push(cb);
    return () => {
      const i = this._statusCbs.indexOf(cb);
      if (i > -1) this._statusCbs.splice(i, 1);
    };
  }

  private _receive(msg: CollabMsg): void {
    if (msg.to && msg.to !== this.me.id) return; // not addressed to us
    if (msg.t !== 'cursor' && msg.t !== 'ping') {
      clog('recv', msg.t, 'from', msg.from, `handlers=${this._handlers.get(msg.t)?.length ?? 0}`);
    }
    // Drop a malformed op here rather than letting each use site half-apply it.
    if (!isValidPayload(msg.t, msg.d)) {
      cerr(`ignored malformed ${msg.t} from ${msg.from || 'unknown'}`, msg.d);
      return;
    }

    this._touchPeer(msg);
    hlcRecv(this._hlc, msg.ts);

    if (msg.t === 'hello') {
      this._registerHello(msg);
      /**
       * Always answer an unsolicited hello — `reply: true` is what stops the
       * volley, so answering is safe, and it is also what makes re-discovery
       * converge. Answering only when the sender was NEW to us used to leave a
       * one-way roster: a peer re-introducing itself after being pruned got no
       * reply (we were already in ITS roster), so it never learned our identity
       * and we never learned its name.
       */
      if (!msg.d?.reply) this._sendHello(true);
      return;
    }
    if (msg.t === 'bye') {
      if (this._peers.delete(msg.from)) this._emitRoster();
      this._handlers.get('bye')?.forEach((h) => h(msg));
      return;
    }
    if (msg.t === 'ping') return; // _touchPeer already did the work

    this._handlers.get(msg.t)?.forEach((h) => h(msg));
  }

  private _registerHello(msg: CollabMsg): void {
    const user = sanitizeUser(msg.d?.user);
    if (!user) return;
    const existing = this._peers.get(user.id);
    this._peers.set(user.id, { user, lastSeen: Date.now(), known: true });
    this._emitRoster();
    if (!existing?.known) EngineLogger.success(ENGINE_NAME, `${user.name} joined`);
  }

  /**
   * Note a peer we are hearing from but do not have in the roster, and ask it to
   * introduce itself.
   *
   * This is the recovery path for the one failure that made collaboration look
   * broken during completely ordinary use. Browsers throttle timers in hidden
   * tabs to roughly once a minute, so a peer that alt-tabs away for longer than
   * PEER_TIMEOUT_MS stops heartbeating and everyone prunes it. Its ops kept
   * arriving (handlers are keyed by type, not by roster membership) but it was
   * gone from the online count and its cursor chip fell back to a raw client id,
   * permanently — nothing ever re-registered it.
   */
  private _rediscover(from: ClientId): void {
    this._peers.set(from, {
      user: { id: from, name: from.slice(0, 6), color: colorForClient(from) },
      lastSeen: Date.now(),
      known: false,
    });
    this._emitRoster();
    const now = Date.now();
    if (now - this._lastRediscover < REDISCOVER_MIN_MS) return;
    this._lastRediscover = now;
    this._sendHello(false); // unsolicited, so the peer answers with its real name
  }

  private _touchPeer(msg: CollabMsg): void {
    const p = this._peers.get(msg.from);
    if (p) {
      p.lastSeen = Date.now();
      return;
    }
    // A hello carries its own identity, so _registerHello handles that case
    // properly; anything else from a stranger means we lost them and must ask.
    if (msg.from && msg.from !== this.me.id && msg.t !== 'hello' && msg.t !== 'bye') {
      this._rediscover(msg.from);
    }
  }

  private _prunePeers(): void {
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    let changed = false;
    for (const [id, p] of this._peers) {
      if (p.lastSeen < cutoff) {
        this._peers.delete(id);
        EngineLogger.success(ENGINE_NAME, `${p.user.name} left`);
        changed = true;
      }
    }
    if (changed) this._emitRoster();
  }

  private _emitRoster(): void {
    const list = this.peers;
    this._rosterCbs.forEach((cb) => cb(list));
  }

  public get peers(): Peer[] {
    return Array.from(this._peers.values());
  }

  public peer(id: ClientId): Peer | undefined {
    return this._peers.get(id);
  }

  public colorOf(id: ClientId): string {
    return this._peers.get(id)?.user.color ?? colorForClient(id);
  }

  public nameOf(id: ClientId): string {
    return this._peers.get(id)?.user.name ?? id.slice(0, 6);
  }

  public get peerIds(): ClientId[] {
    return Array.from(this._peers.keys());
  }

  /** Allocation-free peer count — `peerIds` builds an array, and the cursor
   *  path consults this on every pointer-move. */
  public get peerCount(): number {
    return this._peers.size;
  }

  /**
   * How many distinct peers have been heard on a different protocol version.
   * Both transports drop those messages, which otherwise makes a peer on an old
   * build indistinguishable from a peer who is not there at all.
   */
  public get incompatibleCount(): number {
    return this._incompatible.size;
  }

  // ── Last-write-wins gate ──────────────────────────────────────────────────

  /**
   * Should a remote persistent op be applied? Records the stamp when yes, so a
   * later duplicate or out-of-order delivery of an older op is discarded.
   *
   * Deletes and upserts share one key per entity deliberately: a delete that
   * arrives after an edit must win, and an edit stamped after a delete must
   * resurrect the entity. Ordering, not type, decides.
   */
  public accept(entityKey: string, ts: HLC | undefined): boolean {
    if (!hlcNewer(ts, this._stamps.get(entityKey))) return false;
    if (ts) this._stamps.set(entityKey, ts);
    return true;
  }

}
