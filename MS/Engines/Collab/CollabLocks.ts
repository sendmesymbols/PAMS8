/**
 * CollabLocks.ts
 *
 * Soft locks — the reason conflicts are rare enough for last-write-wins to be
 * an acceptable backstop rather than the primary mechanism.
 *
 * Claiming is optimistic and expiring: selecting a symbol or a slide object
 * broadcasts a claim with a TTL, refreshed for as long as the selection holds.
 * Nobody waits for a grant, so a lost message costs a moment of double-editing
 * rather than a deadlock, and a crashed browser releases everything it held
 * once the TTL lapses.
 *
 * Two claims racing for the same object resolve the same way on every peer:
 * the lower client id wins, and the loser learns it lost when the winner's
 * claim arrives.
 */

import type CollabSession from './CollabSession';
import type { ClientId, CollabMsg, LockPayload } from './CollabTypes';

export interface RemoteLock {
  id: string;
  owner: ClientId;
  scope: 'map' | 'slide';
  expiresAt: number;
}

export default class CollabLocks {
  /** Locks held by OTHER clients, keyed by object id. */
  private _remote = new Map<string, RemoteLock>();
  /**
   * Object ids this client currently claims → the scope each was claimed under.
   * A Map rather than a Set because the periodic refresh has to re-broadcast each
   * id under its ORIGINAL scope; defaulting to 'map' silently rewrote every slide
   * lock on the first refresh tick.
   */
  private _mine = new Map<string, 'map' | 'slide'>();
  private _refresh: ReturnType<typeof setInterval> | null = null;
  private _changeCbs: Array<() => void> = [];
  private _offMsg: Array<() => void> = [];
  private _ttlMs = 10000;
  private _enabled = true;
  // Declared as a plain field rather than a constructor parameter property so
  // CollabLocks.test.ts can run under `node` (strip-only TypeScript rejects
  // parameter properties).
  private readonly session: CollabSession;

  constructor(session: CollabSession) {
    this.session = session;
  }

  public start(opts: { ttlMs?: number; enabled?: boolean } = {}): void {
    this._ttlMs = Math.max(2000, opts.ttlMs ?? 10000);
    this._enabled = opts.enabled !== false;

    this._offMsg.push(this.session.on('lock', (m) => this._onLock(m)));
    this._offMsg.push(this.session.on('unlock', (m) => this._onUnlock(m)));
    // A peer that leaves takes its locks with it.
    this._offMsg.push(
      this.session.on('bye', (m) => {
        if (this._dropOwner(m.from)) this._emit();
      }),
    );

    this._startRefresh();
  }

  /**
   * Refresh at half the TTL so a claim never lapses while still in use, and
   * expire stale remote claims in the same tick.
   *
   * Restarted whenever the TTL changes: the period was previously computed once
   * at start(), so lowering `lockTtlMs` from 10 s to 3 s in the settings panel
   * left the refresh at 5 s and claims visibly lapsed between ticks.
   */
  private _startRefresh(): void {
    if (this._refresh) clearInterval(this._refresh);
    this._refresh = setInterval(() => {
      for (const [id, scope] of this._groupByScope()) this._broadcastClaim(id, scope);
      if (this._pruneExpired()) this._emit();
    }, Math.max(500, Math.floor(this._ttlMs / 2)));
  }

  /** Held ids bucketed by the scope they were claimed under. */
  private _groupByScope(): Array<[string[], 'map' | 'slide']> {
    if (!this._mine.size) return [];
    const map: string[] = [];
    const slide: string[] = [];
    for (const [id, scope] of this._mine) (scope === 'slide' ? slide : map).push(id);
    const out: Array<[string[], 'map' | 'slide']> = [];
    if (map.length) out.push([map, 'map']);
    if (slide.length) out.push([slide, 'slide']);
    return out;
  }

  public destroy(): void {
    if (this._refresh) {
      clearInterval(this._refresh);
      this._refresh = null;
    }
    this._offMsg.forEach((off) => off());
    this._offMsg = [];
    this.releaseAll();
    this._remote.clear();
    this._changeCbs = [];
  }

  public setOptions(opts: { ttlMs?: number; enabled?: boolean }): void {
    if (typeof opts.ttlMs === 'number') {
      const next = Math.max(2000, opts.ttlMs);
      if (next !== this._ttlMs) {
        this._ttlMs = next;
        if (this._refresh) this._startRefresh(); // only if start() already ran
      }
    }
    if (typeof opts.enabled === 'boolean') {
      this._enabled = opts.enabled;
      if (!this._enabled) {
        this.releaseAll();
        this._remote.clear();
        this._emit();
      }
    }
  }

  public onChange(cb: () => void): void {
    this._changeCbs.push(cb);
  }

  // ── Claiming ──────────────────────────────────────────────────────────────

  /**
   * Claim `ids`, releasing anything previously held UNDER THE SAME SCOPE that is
   * not in the new set. Ids already locked by a peer are skipped — the caller
   * should check `lockedByOther` first if it needs to react.
   *
   * Scoped, because the map and the open slide are two independent selection
   * surfaces sharing one CollabLocks instance. Dropping every held id regardless
   * of scope meant a map selection change released the slide objects the user was
   * editing, and clearing the slide canvas released their map symbols — in both
   * cases while they were still working on them, and with the peers who had been
   * kept out then free to edit. `_groupByScope` already assumed `_mine` could
   * hold both scopes at once; this is what makes that true.
   */
  public claim(ids: readonly string[], scope: 'map' | 'slide'): void {
    if (!this._enabled) return;
    const next = new Set(ids.filter((id) => id && !this.lockedByOther(id)));

    const dropped: string[] = [];
    for (const [id, held] of this._mine) {
      if (held === scope && !next.has(id)) dropped.push(id);
    }
    if (dropped.length) this._release(dropped);

    const added = Array.from(next).filter((id) => !this._mine.has(id));
    for (const id of next) this._mine.set(id, scope);
    if (added.length) this._broadcastClaim(added, scope);
  }

  public releaseAll(): void {
    if (!this._mine.size) return;
    this._release(Array.from(this._mine.keys()));
    this._mine.clear();
  }

  private _release(ids: string[]): void {
    ids.forEach((id) => this._mine.delete(id));
    this.session.send('unlock', { ids } as Partial<LockPayload>);
  }

  /** `scope` is required — a default here is what let refreshes mislabel locks. */
  private _broadcastClaim(ids: string[], scope: 'map' | 'slide'): void {
    const payload: LockPayload = { ids, scope, ttlMs: this._ttlMs };
    this.session.send('lock', payload);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /** True when a DIFFERENT client holds a live lock on `id`. */
  public lockedByOther(id: string): boolean {
    if (!this._enabled) return false;
    const l = this._remote.get(id);
    if (!l) return false;
    if (l.expiresAt <= Date.now()) {
      this._remote.delete(id);
      return false;
    }
    return l.owner !== this.session.me.id;
  }

  public ownerOf(id: string): { id: ClientId; name: string; color: string } | null {
    const l = this._remote.get(id);
    if (!l || l.expiresAt <= Date.now() || l.owner === this.session.me.id) return null;
    return { id: l.owner, name: this.session.nameOf(l.owner), color: this.session.colorOf(l.owner) };
  }

  public heldByMe(id: string): boolean {
    return this._mine.has(id);
  }

  /**
   * Every live remote lock, optionally narrowed to one scope. Presence asks for
   * 'map' only: a slide-object id can never match a map graphic, so including
   * those made it scan every symbol layer for an id that was never there.
   */
  public remoteLocks(scope?: 'map' | 'slide'): RemoteLock[] {
    this._pruneExpired();
    const now = Date.now();
    return Array.from(this._remote.values()).filter(
      (l) =>
        l.expiresAt > now && l.owner !== this.session.me.id && (!scope || l.scope === scope),
    );
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  private _onLock(msg: CollabMsg): void {
    const d: LockPayload | undefined = msg.d;
    if (!d?.ids?.length) return;
    const expiresAt = Date.now() + Math.max(2000, d.ttlMs || this._ttlMs);
    let changed = false;
    for (const id of d.ids) {
      // Concurrent claims: the lower client id wins, and because every peer
      // applies that same rule to the same pair of ids, they all agree. Our own
      // claims live in `_mine`, not `_remote`, so they must be checked first —
      // otherwise a claim we already won still gets recorded against us and we
      // end up blocked on an object we hold.
      if (this._mine.has(id)) {
        if (this.session.me.id < msg.from) continue; // we win — ignore theirs
        this._mine.delete(id); // we lose — record theirs below
      }
      const cur = this._remote.get(id);
      if (cur && cur.expiresAt > Date.now() && cur.owner !== msg.from && cur.owner < msg.from) {
        continue;
      }
      this._remote.set(id, { id, owner: msg.from, scope: d.scope ?? 'map', expiresAt });
      changed = true;
    }
    if (changed) this._emit();
  }

  private _onUnlock(msg: CollabMsg): void {
    const ids: string[] | undefined = msg.d?.ids;
    if (!ids?.length) return;
    let changed = false;
    for (const id of ids) {
      const cur = this._remote.get(id);
      if (cur && cur.owner === msg.from) {
        this._remote.delete(id);
        changed = true;
      }
    }
    if (changed) this._emit();
  }

  private _dropOwner(owner: ClientId): boolean {
    let changed = false;
    for (const [id, l] of this._remote) {
      if (l.owner === owner) {
        this._remote.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  private _pruneExpired(): boolean {
    const now = Date.now();
    let changed = false;
    for (const [id, l] of this._remote) {
      if (l.expiresAt <= now) {
        this._remote.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  private _emit(): void {
    this._changeCbs.forEach((cb) => cb());
  }
}
