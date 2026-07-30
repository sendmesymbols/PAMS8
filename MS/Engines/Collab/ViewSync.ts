/**
 * ViewSync.ts
 *
 * Shared map view: when enabled, everybody in the room is looking at the same
 * place at the same scale.
 *
 * Two ways to use it, both live here:
 *
 *   Symmetric (the default)   Anyone can move the map and everyone follows.
 *                             Whoever moves takes a baton for BATON_MS; while
 *                             somebody else holds it your own movement is not
 *                             broadcast, so two people panning at once cannot
 *                             drag each other back and forth.
 *
 *   Follow a peer             Click a dot on the roster chip and you become that
 *                             person's passenger: only their viewpoint is
 *                             applied, unconditionally. Moving the map yourself
 *                             is the way out — a deliberate local gesture drops
 *                             follow mode.
 *
 * How a gesture travels (the part that is easy to get wrong):
 *
 *   while moving   throttled to SEND_HZ, applied by the receiver with
 *                  `animate: false`. Animating each one instead queues goTo
 *                  calls faster than they can play, and followers visibly
 *                  rubber-band and fall behind. Instant assignment cannot queue.
 *
 *   on stationary  one final message flagged `done`, applied with a short
 *                  animation. This is what guarantees every peer converges on
 *                  the same viewpoint even if intermediate messages were
 *                  dropped — they are ephemeral and expendable by design.
 *
 * Arbitration and the 2D/3D rules are pure functions in CollabTypes
 * (`shouldApplyRemoteView`, `shouldBroadcastLocalView`, `viewTargetFor`) so they
 * are unit-tested under bare `node` without a view or a DOM.
 */

import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import type Point from '@arcgis/core/geometry/Point';
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';

import { cerr, clog } from './CollabDebug';
import type CollabSession from './CollabSession';
import {
  shouldApplyRemoteView,
  shouldBroadcastLocalView,
  viewTargetFor,
  type BatonState,
  type ClientId,
  type CollabMsg,
  type ViewPayload,
} from './CollabTypes';

/** Upper bound on outbound viewpoints during a gesture. */
const SEND_HZ = 8;
/**
 * How long the last mover keeps the right to drive. Long enough to cover the
 * pause between two flicks of a pan, short enough that taking over feels
 * immediate rather than like waiting for a turn.
 */
const BATON_MS = 1500;
/** Animation for the final, authoritative viewpoint of a gesture. */
const SETTLE_MS = 250;
/**
 * Grace added after a remote apply during which local viewpoint changes are
 * still treated as ours-from-them rather than as user input.
 *
 * `goTo` resolves a frame or two before the view stops reporting changes, so a
 * flag cleared strictly on resolution leaks a spurious "the user moved" event —
 * which would both echo back to the room and, in follow mode, silently cancel
 * following. The same timestamp-window idiom MapSync uses for _drawBusyUntil.
 */
const APPLY_GRACE_MS = 180;

export interface ViewSyncOptions {
  /** Master switch — `collab.syncView`. */
  syncView: boolean;
}

export default class ViewSync {
  private _view: MapView | SceneView | null = null;
  private _opts: ViewSyncOptions = { syncView: false };

  private _watches: Array<{ remove(): void }> = [];
  private _inputHandles: Array<{ remove(): void }> = [];
  private _offMsg: Array<() => void> = [];

  private _baton: BatonState = { owner: null, until: 0 };
  private _following: ClientId | null = null;

  private _lastSent = 0;
  /** Date.now() until which local view changes are attributed to a remote apply. */
  private _applyUntil = 0;
  private _changeCbs: Array<() => void> = [];

  constructor(private readonly session: CollabSession) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  public start(view: MapView | SceneView, opts?: Partial<ViewSyncOptions>): void {
    this._view = view;
    if (opts) this.setOptions(opts);
    this._offMsg.push(this.session.on('view', (m) => this._onRemoteView(m)));
    // A peer that leaves cannot keep the baton or keep being followed.
    this._offMsg.push(
      this.session.on('bye', (m) => {
        if (this._baton.owner === m.from) this._baton = { owner: null, until: 0 };
        if (this._following === m.from) this.follow(null);
      }),
    );
    this._attachWatches();
    clog('ViewSync.start', this._opts);
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._detachWatches();
    this._view = view;
    this._attachWatches();
  }

  public setOptions(opts: Partial<ViewSyncOptions>): void {
    const wasOn = this._opts.syncView;
    if (typeof opts.syncView === 'boolean') this._opts.syncView = opts.syncView;
    if (wasOn !== this._opts.syncView) {
      if (!this._opts.syncView) {
        // Turning it off must also stop us being a passenger, otherwise follow
        // mode would keep driving a view the user thinks they just unlinked.
        this._following = null;
        this._baton = { owner: null, until: 0 };
      }
      this._emit();
    }
  }

  public destroy(): void {
    this._detachWatches();
    this._offMsg.forEach((off) => off());
    this._offMsg = [];
    this._changeCbs = [];
    this._following = null;
    this._baton = { owner: null, until: 0 };
    this._view = null;
  }

  // ── Public state (the roster chip reads and drives this) ───────────────────

  public get isSyncing(): boolean {
    return this._opts.syncView;
  }

  public get following(): ClientId | null {
    return this._following;
  }

  /** Notified whenever `isSyncing` or `following` changes, for the roster chip. */
  public onChange(cb: () => void): void {
    this._changeCbs.push(cb);
  }

  public toggleSync(): void {
    this.setOptions({ syncView: !this._opts.syncView });
  }

  /**
   * Become `id`'s passenger, or pass null to stop. Following implies syncing —
   * asking to follow somebody while unlinked otherwise does nothing visible.
   */
  public follow(id: ClientId | null): void {
    if (id && id === this.session.me.id) return;
    if (this._following === id) return;
    this._following = id;
    if (id && !this._opts.syncView) this._opts.syncView = true;
    this._emit();
    clog('ViewSync.follow', id ?? '(nobody)');
  }

  private _emit(): void {
    this._changeCbs.forEach((cb) => cb());
  }

  // ── Local movement out ────────────────────────────────────────────────────

  private _attachWatches(): void {
    const view = this._view;
    if (!view) return;
    this._watches.push(
      reactiveUtils.watch(
        () => view.viewpoint,
        () => this._onLocalMove(false),
      ),
    );
    // The authoritative end-of-gesture message. DeclutterEngine watches the same
    // property for the same reason: it is the only reliable "the user has
    // finished" signal the SDK offers.
    this._watches.push(
      reactiveUtils.watch(
        () => view.stationary,
        (stationary: boolean) => {
          if (stationary) this._onLocalMove(true);
        },
      ),
    );

    /**
     * Leaving follow mode is driven by real input events, NOT by noticing that
     * the viewpoint changed.
     *
     * Inferring it from the viewpoint would mean deciding, on every frame,
     * whether a change was the leader's doing or the user's — and the only
     * available discriminator is a timing window. One janky frame longer than
     * that window and a follower silently stops following for no visible reason.
     * A drag or a wheel tick is unambiguous: `goTo` never produces one.
     */
    const cancelFollow = () => {
      if (this._following) {
        clog('local gesture — leaving follow mode');
        this.follow(null);
      }
    };
    for (const evt of ['drag', 'mouse-wheel', 'double-click'] as const) {
      this._inputHandles.push(view.on(evt as any, cancelFollow as any));
    }
  }

  private _detachWatches(): void {
    this._watches.forEach((w) => w.remove());
    this._watches = [];
    this._inputHandles.forEach((h) => h.remove());
    this._inputHandles = [];
  }

  private _onLocalMove(done: boolean): void {
    if (!this._opts.syncView) return;
    // Our own view moving because we just applied somebody else's viewpoint is
    // not user input — echoing it would be a feedback loop.
    if (Date.now() < this._applyUntil) return;

    // A passenger does not steer. Getting out of follow mode is handled by the
    // input listeners in _attachWatches, not from here.
    if (this._following) return;
    if (!this.session.peerCount) return; // nobody to tell

    const now = Date.now();
    if (
      !shouldBroadcastLocalView({
        following: this._following,
        myId: this.session.me.id,
        baton: this._baton,
        now,
      })
    ) {
      return; // another peer is driving
    }
    // Intermediate frames are rate-limited; the final one never is, because it
    // is what everybody converges on.
    if (!done && now - this._lastSent < 1000 / SEND_HZ) return;

    const payload = this._readViewpoint(done);
    if (!payload) return;
    this._lastSent = now;
    this._baton = { owner: this.session.me.id, until: now + BATON_MS };
    this.session.send('view', payload);
  }

  private _readViewpoint(done: boolean): ViewPayload | null {
    const view = this._view;
    if (!view) return null;
    const centre = ViewSync._toLonLat(view.center as Point | null);
    const scale = (view as any).scale;
    if (!centre || !Number.isFinite(scale) || scale <= 0) return null;
    const vt: '2d' | '3d' = view.type === '3d' ? '3d' : '2d';
    const payload: ViewPayload = { lon: centre[0], lat: centre[1], scale, vt };
    if (vt === '3d') {
      const cam: any = (view as SceneView).camera;
      if (Number.isFinite(cam?.tilt)) payload.tilt = cam.tilt;
      if (Number.isFinite(cam?.heading)) payload.heading = cam.heading;
    } else {
      // A rotated MapView is a deliberate orientation — usually north-up
      // abandoned to match a scheme of manoeuvre — so a follower who keeps their
      // own rotation is looking at the same ground the wrong way round.
      // `viewTargetFor` only lets this cross between two 2D views.
      const rot = (view as any).rotation;
      if (Number.isFinite(rot)) payload.rotation = rot;
    }
    if (done) payload.done = true;
    return payload;
  }

  // ── Remote movement in ────────────────────────────────────────────────────

  private _onRemoteView(msg: CollabMsg): void {
    if (!this._opts.syncView) return;
    const d: ViewPayload | undefined = msg.d;
    const view = this._view;
    if (!d || !view) return;

    const now = Date.now();
    if (
      !shouldApplyRemoteView({
        following: this._following,
        from: msg.from,
        myId: this.session.me.id,
        baton: this._baton,
        now,
      })
    ) {
      return;
    }
    this._baton = { owner: msg.from, until: now + BATON_MS };

    const target = viewTargetFor(d, view.type === '3d' ? '3d' : '2d');
    const settle = d.done === true;
    // Hold the echo window open across the whole apply, including the settle
    // animation, so the view changes it causes are not read back as user input.
    this._applyUntil = now + (settle ? SETTLE_MS : 0) + APPLY_GRACE_MS;

    void (view as any)
      .goTo(target, settle ? { duration: SETTLE_MS } : { animate: false })
      .catch((err: any) => {
        // goTo rejects whenever it is superseded by the next one, which during a
        // stream is completely normal — only surface a real failure.
        if (err?.name !== 'view:goto-interrupted') {
          cerr('could not follow a shared viewpoint', err);
        }
      });
  }

  private static _toLonLat(pt: Point | null | undefined): [number, number] | null {
    if (!pt) return null;
    let p: any = pt;
    if (p.spatialReference?.isWebMercator) {
      p = webMercatorUtils.webMercatorToGeographic(p as Point);
    }
    const lon = p?.longitude ?? p?.x;
    const lat = p?.latitude ?? p?.y;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
  }
}
