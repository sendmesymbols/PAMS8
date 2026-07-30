/**
 * PresentSync.ts
 *
 * Shared briefing: one person drives the deck and the room follows.
 *
 * SlideSync already shares the deck's CONTENT — slides, ordering, and the objects
 * on each slide. What it never shared is the briefer's POSITION in it, so a room
 * could co-edit a deck perfectly and still be unable to deliver it: everyone sat
 * on whichever slide they had last clicked. This file adds that, plus the live
 * mark-up that goes with talking over a map.
 *
 * The podium
 *
 *   One person holds it at a time. Claiming is a `podium` op, which is
 *   PERSISTENT — the HLC ordering IS the arbitration, so the newest claim wins
 *   and every peer independently agrees who that was. Arbitrating it the way
 *   CollabLocks arbitrates locks does not converge; see PERSISTENT_TYPES.
 *
 *   The claim expires. A `pres` heartbeat every HEARTBEAT_MS pushes it forward,
 *   and PODIUM_TTL_MS of silence vacates it, so a briefer whose browser dies
 *   does not hold the room hostage.
 *
 * Following, and breaking away
 *
 *   A viewer's slide position follows the briefer automatically. Entering present
 *   mode does NOT: `PresentSession.enter()` takes fullscreen, and doing that to
 *   somebody's screen because a peer started talking is hostile. So the position
 *   is shared and the [Join] button on the roster chip is how a viewer chooses to
 *   go fullscreen with it.
 *
 *   Consequence worth knowing: build steps only visibly apply to viewers who did
 *   join, because `PresentSession._groups` is only populated while their own
 *   session is active. Outside present mode BriefingEngine runs its own
 *   timer-driven builds and there is no step cursor to move.
 *
 *   Navigating yourself detaches you, and the chip offers [Rejoin]. Detaching is
 *   driven by the navigation call itself, never inferred from position drift —
 *   the same reasoning ViewSync's follow-cancel rests on.
 *
 * Everything here is a runtime wrap restored on destroy. No file under Briefing/
 * is modified.
 */

import EngineLogger from '../../Support/EngineLogger';
import { cerr, clog, mergeDefined } from './CollabDebug';
import CollabPresence from './CollabPresence';
import type CollabSession from './CollabSession';
import type PresentInkLayer from './PresentInkLayer';
import {
  podiumHolderAt,
  type ClientId,
  type CollabMsg,
  type InkPayload,
  type PodiumState,
  type PresPayload,
} from './CollabTypes';

const ENGINE_NAME = 'Collab Engine';
/** Entity key for the podium in the last-write-wins table. */
const PODIUM_KEY = 'podium';
/**
 * Heartbeat period. Doubles as the podium refresh and as the convergence
 * mechanism: `pres` is ephemeral, so a viewer that missed a slide change — or
 * whose `goToSlide` was refused because a transition was still running — is
 * corrected within one tick instead of staying behind indefinitely.
 */
const HEARTBEAT_MS = 2000;
/** Silence after which the podium is considered abandoned. */
const PODIUM_TTL_MS = 8000;
/** Upper bound on outbound ink messages. */
const INK_HZ = 15;
/** Points per pen message. A long stroke is decimated to this. */
const INK_MAX_PTS = 120;
/** Laser tail length sent per message. */
const LASER_TAIL = 14;

/** Structural view of BriefingEngine — avoids a circular import. */
interface BriefingLike {
  getSlides(): readonly any[];
  readonly currentIndex: number;
  goToSlide(index: number): Promise<void>;
  [key: string]: any;
}

export interface PresentSyncOptions {
  /** Master switch — `collab.sharePresentation`. */
  sharePresentation: boolean;
  /** Share laser / pen / spotlight mark-up — `collab.shareInk`. */
  shareInk: boolean;
}

export default class PresentSync {
  private _be: BriefingLike | null = null;
  private _opts: PresentSyncOptions = { sharePresentation: true, shareInk: true };

  private _origs = new Map<string, Function>();
  private _psOrigs = new Map<string, Function>();
  private _annOrigs = new Map<string, Function>();
  private _offMsg: Array<() => void> = [];
  private _inkHandlers: Array<[string, EventListener]> = [];
  private _inkTarget: HTMLElement | null = null;
  /**
   * The annotator instance `_annOrigs` was taken from. PresentSession builds a
   * fresh PresentAnnotator on every `enter()` and disposes it on `exit()`, so the
   * wrap has to be tracked per instance rather than per method name.
   */
  private _annWrapped: any = null;

  private _podium: PodiumState = { holder: null, until: 0 };
  /** Last position heard from the briefer — replayed on rejoin / join. */
  private _lastPres: PresPayload | null = null;
  private _detached = false;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _changeCbs: Array<() => void> = [];
  /** True while applying a remote position, so our wraps do not echo it. */
  private _applying = false;

  private _lastInkSent = 0;
  private _penPts: Array<[number, number]> = [];
  private _laserPts: Array<[number, number]> = [];

  constructor(
    private readonly session: CollabSession,
    private readonly ink: PresentInkLayer,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  public start(briefingEngine: unknown, opts?: Partial<PresentSyncOptions>): void {
    this._opts = mergeDefined(this._opts, opts);
    this._be = (briefingEngine as BriefingLike) ?? null;
    if (!this._be) {
      EngineLogger.error(ENGINE_NAME, 'Shared briefing idle — briefing engine is not enabled');
      return;
    }

    this._wrapDeck();
    this._wrapPresentSession();
    this._attachInk();

    this._offMsg.push(this.session.on('podium', (m) => this._onPodium(m)));
    this._offMsg.push(this.session.on('pres', (m) => this._onPres(m)));
    this._offMsg.push(this.session.on('ink', (m) => this._onInk(m)));
    this._offMsg.push(
      this.session.on('bye', (m) => {
        this.ink.clearPeer(m.from);
        if (this._holder() !== m.from) return;
        clog('the briefer left — podium vacant');
        this._podium = { holder: null, until: 0 };
        this.ink.clearAll();
        this._emit();
      }),
    );

    this._timer = setInterval(() => this._tick(), HEARTBEAT_MS);
    clog('PresentSync.start', this._opts);
  }

  public setOptions(opts: Partial<PresentSyncOptions>): void {
    const wasOn = this._opts.sharePresentation;
    this._opts = mergeDefined(this._opts, opts);
    if (wasOn && !this._opts.sharePresentation) {
      // Switching it off must also give up the podium, or the room keeps
      // following a briefer who believes they have stopped sharing.
      if (this._isBriefer()) this.releasePodium();
      this._podium = { holder: null, until: 0 };
      this._detached = false;
      this.ink.clearAll();
      this._emit();
    }
  }

  public destroy(): void {
    // Release before tearing down, so the room is not left following a client
    // that has gone.
    if (this._isBriefer()) {
      try {
        this.session.send('podium', { take: false }, PODIUM_KEY);
      } catch {
        /* transport already gone */
      }
    }
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._detachInk();
    this._unwrapAnnotator();
    for (const [name, fn] of this._origs) PresentSync._unwrap(this._be, name, fn);
    for (const [name, fn] of this._psOrigs) PresentSync._unwrap(this._presentSession(), name, fn);
    this._origs.clear();
    this._psOrigs.clear();
    this._offMsg.forEach((off) => off());
    this._offMsg = [];
    this._changeCbs = [];
    this._podium = { holder: null, until: 0 };
    this._lastPres = null;
    this._detached = false;
    this._be = null;
  }

  /**
   * Undo one runtime wrap: deleting the own property we added reveals the class
   * method still on the prototype, leaving the object exactly as we found it.
   * Same idiom as SlideSync._unwrap.
   */
  private static _unwrap(target: any, name: string, original: Function | null): void {
    if (!target) return;
    delete target[name];
    if (typeof target[name] !== 'function' && original) target[name] = original;
  }

  // ── Public state — the roster chip reads and drives this ───────────────────

  /** Who is briefing right now, accounting for expiry. */
  public get briefer(): ClientId | null {
    return this._holder();
  }

  public get isBriefer(): boolean {
    return this._isBriefer();
  }

  /** True when a peer is briefing and we have navigated away from them. */
  public get detached(): boolean {
    return this._detached && !!this._holder() && !this._isBriefer();
  }

  /** True when the briefer is actually in present mode, not merely holding it. */
  public get brieferActive(): boolean {
    return this._lastPres?.active === true;
  }

  public onChange(cb: () => void): void {
    this._changeCbs.push(cb);
  }

  private _emit(): void {
    this._changeCbs.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        cerr('podium change handler failed', err);
      }
    });
  }

  // ── Podium ────────────────────────────────────────────────────────────────

  public takePodium(): void {
    if (!this._opts.sharePresentation) {
      CollabPresence.toast('Shared briefing is switched off');
      return;
    }
    if (!this._be) return;
    this._podium = { holder: this.session.me.id, until: Date.now() + PODIUM_TTL_MS };
    this._detached = false;
    this.session.send('podium', { take: true }, PODIUM_KEY);
    this._publishPres();
    this._emit();
    EngineLogger.success(ENGINE_NAME, 'You are briefing the room');
  }

  public releasePodium(): void {
    if (!this._isBriefer()) return;
    this.session.send('podium', { take: false }, PODIUM_KEY);
    this._podium = { holder: null, until: 0 };
    this.ink.clearAll();
    this._emit();
    EngineLogger.success(ENGINE_NAME, 'You handed back the podium');
  }

  public togglePodium(): void {
    if (this._isBriefer()) this.releasePodium();
    else this.takePodium();
  }

  /** Snap back to the briefer after having navigated away. */
  public rejoin(): void {
    if (!this._holder() || this._isBriefer()) return;
    this._detached = false;
    if (this._lastPres) this._applyPres(this._lastPres);
    this._emit();
  }

  /**
   * Go fullscreen with the briefer. Opt-in per viewer, deliberately — see the
   * file header for why this is not automatic.
   */
  public joinPresentation(): void {
    const ps: any = this._presentSession();
    if (!ps) {
      CollabPresence.toast('Present mode is unavailable');
      return;
    }
    this._detached = false;
    if (!ps.isActive?.()) {
      try {
        ps.enter();
      } catch (err) {
        cerr('could not enter present mode', err);
      }
    }
    if (this._lastPres) this._applyPres(this._lastPres);
    this._emit();
  }

  private _holder(): ClientId | null {
    return podiumHolderAt(this._podium, Date.now());
  }

  private _isBriefer(): boolean {
    return this._holder() === this.session.me.id;
  }

  /** True when we should be tracking a peer's position. */
  private _isFollowing(): boolean {
    const h = this._holder();
    return !!h && h !== this.session.me.id && !this._detached && this._opts.sharePresentation;
  }

  private _detach(): void {
    if (this._detached) return;
    this._detached = true;
    clog('local navigation — detached from the briefer');
    this._emit();
  }

  /**
   * One timer drives both roles: the briefer re-announces its position (which
   * also refreshes its own claim), and everybody notices an expired podium.
   */
  private _tick(): void {
    const before = this._holder();
    if (this._isBriefer()) {
      this._podium.until = Date.now() + PODIUM_TTL_MS;
      this._publishPres();
    }
    if (this._holder() !== before) {
      if (!this._holder()) {
        this.ink.clearAll();
        EngineLogger.success(ENGINE_NAME, 'The briefer went quiet — podium released');
      }
      this._emit();
    }
  }

  private _onPodium(msg: CollabMsg): void {
    // The LWW gate IS the arbitration — newest claim wins, identically on every
    // peer, with no negotiation and no possibility of a split verdict.
    if (!this.session.accept(PODIUM_KEY, msg.ts)) {
      clog('podium op rejected as stale', msg.from);
      return;
    }
    const take = msg.d?.take === true;
    if (take) {
      const wasMine = this._isBriefer();
      this._podium = { holder: msg.from, until: Date.now() + PODIUM_TTL_MS };
      // A new briefer starts everybody attached; whoever wants out can navigate.
      this._detached = false;
      this._lastPres = null;
      this.ink.clearAll();
      if (wasMine) {
        CollabPresence.toast(`${this.session.nameOf(msg.from)} took the podium`);
      }
      EngineLogger.success(ENGINE_NAME, `${this.session.nameOf(msg.from)} is briefing`);
    } else if (this._holder() === msg.from) {
      this._podium = { holder: null, until: 0 };
      this._lastPres = null;
      this.ink.clearAll();
      EngineLogger.success(ENGINE_NAME, `${this.session.nameOf(msg.from)} handed back the podium`);
    }
    this._emit();
  }

  // ── Position out ──────────────────────────────────────────────────────────

  private _wrapDeck(): void {
    const be: any = this._be;
    if (!be || typeof be.goToSlide !== 'function') return;
    const self = this;
    const orig = be.goToSlide.bind(be);
    this._origs.set('goToSlide', be.goToSlide);
    be.goToSlide = function wrappedGoToSlide(index: number) {
      const out = orig(index);
      try {
        // Whatever the reason for the move, the peer-ink layer follows the slide
        // now on screen — otherwise a viewer sees the previous slide's ink.
        self.ink.setSlide(self._currentSlideId());
        if (self._applying) return out;
        if (self._isBriefer()) self._publishPres();
        else if (self._isFollowing()) self._detach();
      } catch (err) {
        cerr('goToSlide wrap failed', err);
      }
      return out;
    };
  }

  /**
   * `advance` / `back` move the build cursor without changing slide, and
   * `enter` / `exit` change whether the briefer is actually presenting — none of
   * which passes through goToSlide, so each needs its own wrap.
   */
  private _wrapPresentSession(): void {
    const ps: any = this._presentSession();
    if (!ps) {
      clog('no present session yet — build-step sync will attach on next start');
      return;
    }
    const self = this;
    for (const name of ['advance', 'back'] as const) {
      if (typeof ps[name] !== 'function') continue;
      const orig = ps[name].bind(ps);
      this._psOrigs.set(name, ps[name]);
      ps[name] = function wrappedStep(...args: any[]) {
        const out = orig(...args);
        try {
          if (self._applying) return out;
          if (self._isBriefer()) self._publishPres();
          else if (self._isFollowing()) self._detach();
        } catch (err) {
          cerr(`${name} wrap failed`, err);
        }
        return out;
      };
    }
    for (const name of ['enter', 'exit'] as const) {
      if (typeof ps[name] !== 'function') continue;
      const orig = ps[name].bind(ps);
      this._psOrigs.set(name, ps[name]);
      ps[name] = function wrappedMode(...args: any[]) {
        const out = orig(...args);
        try {
          // Entering rebuilds the annotator's canvases, so the ink taps have to
          // be re-pointed at the new element.
          self._attachInk();
          if (!self._applying && self._isBriefer()) self._publishPres();
        } catch (err) {
          cerr(`${name} wrap failed`, err);
        }
        return out;
      };
    }
  }

  private _publishPres(): void {
    if (!this._opts.sharePresentation || !this._isBriefer()) return;
    const slideId = this._currentSlideId();
    if (!slideId) return;
    const ps: any = this._presentSession();
    const payload: PresPayload = {
      slideId,
      build: Number.isFinite(ps?._cursor) ? Number(ps._cursor) : 0,
      active: ps?.isActive?.() === true,
    };
    this._lastPres = payload;
    this.session.send('pres', payload);
  }

  // ── Position in ───────────────────────────────────────────────────────────

  private _onPres(msg: CollabMsg): void {
    if (!this._opts.sharePresentation) return;
    const d: PresPayload | undefined = msg.d;
    if (!d?.slideId) return;

    const holder = this._holder();
    if (!holder) {
      /**
       * A vacant podium adopts whoever is heartbeating.
       *
       * `podium` is persistent, but the relay stores nothing and replays nothing,
       * and a snapshot carries no podium state — so a client that arrives after
       * the claim was made (a late joiner, or this engine rebuilt by the
       * room/transport/token reconnect in CollabEngine) never heard it and stayed
       * permanently unaware that anybody was briefing: no [Join] on the chip, no
       * slide following, and no symptom to go on. The `pres` heartbeat is already
       * this file's convergence mechanism for a missed slide change; this makes it
       * the convergence mechanism for a missed claim as well.
       *
       * Safe because only the real holder emits `pres` — `_publishPres` gates on
       * `_isBriefer()` — and it costs no arbitration: a LIVE holder still wins
       * below, so a displaced peer's stale heartbeat is dropped exactly as before,
       * and a later genuine `podium` op still goes through the LWW gate.
       */
      this._podium = { holder: msg.from, until: Date.now() + PODIUM_TTL_MS };
      this._detached = false;
      clog('adopted the briefer from a pres heartbeat', msg.from);
      EngineLogger.success(ENGINE_NAME, `${this.session.nameOf(msg.from)} is briefing`);
      this._emit();
    } else if (holder !== msg.from) {
      // Only the podium holder drives. A `pres` from anybody else is stale
      // traffic from someone who has just been displaced.
      return;
    }
    // Heartbeat: hearing from the briefer is what keeps its claim alive.
    this._podium.until = Date.now() + PODIUM_TTL_MS;
    const wasActive = this._lastPres?.active;
    this._lastPres = d;
    if (wasActive !== d.active) this._emit();
    if (!this._isFollowing()) return;
    this._applyPres(d);
  }

  private _applyPres(d: PresPayload): void {
    const be: any = this._be;
    if (!be) return;
    const idx = this._indexOf(d.slideId);
    // Not here yet — the slide is still in flight as a slide.up. The heartbeat
    // will bring us to it once it lands, which is exactly why one exists.
    if (idx < 0) {
      clog('briefer is on a slide we do not have yet', d.slideId);
      return;
    }
    this._applying = true;
    try {
      if (be.currentIndex !== idx) void be.goToSlide(idx);
      this._applyBuild(d.build);
      this.ink.setSlide(d.slideId);
    } catch (err) {
      cerr('could not follow the briefer', err);
    } finally {
      this._applying = false;
    }
  }

  /**
   * Move the local build cursor to the briefer's.
   *
   * Only has an effect inside present mode: `_groups` is populated by
   * `armBuilds` during a present-mode slide entry, and outside it BriefingEngine
   * owns builds through its own timer path with no step cursor to move.
   */
  private _applyBuild(n: number): void {
    const ps: any = this._presentSession();
    if (!ps?.isActive?.()) return;
    const groups = ps._groups;
    if (!Array.isArray(groups) || !groups.length) return;
    const want = Math.max(0, Math.min(Math.round(n), groups.length));
    if (ps._cursor === want) return;
    ps._cursor = want;
    const slide = this._slides()[(this._be as any)?.currentIndex ?? -1];
    if (!slide) return;
    try {
      ps._host?.snapBuildGroups?.(slide, groups, want);
    } catch (err) {
      cerr('could not apply the briefer’s build step', err);
    }
  }

  // ── Ink out ───────────────────────────────────────────────────────────────

  /**
   * Tap the annotator's own fx canvas rather than wrapping its private pointer
   * handlers. Both listeners run: PresentAnnotator calls `stopPropagation`, which
   * stops the event bubbling to the view but leaves other listeners on the SAME
   * element alone, and its `setPointerCapture` keeps subsequent moves targeted
   * here too.
   */
  private _attachInk(): void {
    this._detachInk();
    const ann: any = this._annotator();
    const fx: HTMLElement | undefined = ann?._fx;
    if (!fx?.addEventListener) return;
    this._inkTarget = fx;

    const down = ((e: Event) => this._onInkPointer(e as PointerEvent, 'down')) as EventListener;
    const move = ((e: Event) => this._onInkPointer(e as PointerEvent, 'move')) as EventListener;
    const up = ((e: Event) => this._onInkPointer(e as PointerEvent, 'up')) as EventListener;
    fx.addEventListener('pointerdown', down);
    fx.addEventListener('pointermove', move);
    fx.addEventListener('pointerup', up);
    fx.addEventListener('pointerleave', up);
    this._inkHandlers.push(
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointerleave', up],
    );

    /**
     * Clearing ink has to reach the room too, or a viewer keeps strokes the
     * briefer has just wiped.
     *
     * Keyed on the annotator INSTANCE, not on the method name. `enter()` builds a
     * new PresentAnnotator every time, so a `_annOrigs.has('clearInk')` guard
     * wrapped the first one and then silently left every later one bare: after a
     * single exit → re-enter, the briefer's clear reached nobody.
     */
    if (typeof ann.clearInk === 'function' && this._annWrapped !== ann) {
      this._unwrapAnnotator();
      const self = this;
      const orig = ann.clearInk.bind(ann);
      this._annOrigs.set('clearInk', ann.clearInk);
      this._annWrapped = ann;
      ann.clearInk = function wrappedClearInk() {
        const out = orig();
        try {
          const sid = self._currentSlideId();
          if (sid && self._isBriefer() && self._opts.shareInk) {
            self.session.send('ink', { k: 'clear', sid } as InkPayload);
          }
        } catch (err) {
          cerr('clearInk wrap failed', err);
        }
        return out;
      };
    }
  }

  private _detachInk(): void {
    const fx = this._inkTarget;
    if (fx) {
      for (const [type, fn] of this._inkHandlers) fx.removeEventListener(type, fn);
    }
    this._inkHandlers = [];
    this._inkTarget = null;
  }

  /**
   * Restore the annotator we actually wrapped, whichever instance that was.
   *
   * Not `this._annotator()`: that returns the CURRENT one, which after an
   * exit → re-enter is a different object (and after an `exit()` is null), so
   * unwrapping through it left the wrap in place on the instance that carried it.
   */
  private _unwrapAnnotator(): void {
    const ann = this._annWrapped;
    if (ann) {
      for (const [name, fn] of this._annOrigs) PresentSync._unwrap(ann, name, fn);
    }
    this._annOrigs.clear();
    this._annWrapped = null;
  }

  private _onInkPointer(e: PointerEvent, phase: 'down' | 'move' | 'up'): void {
    try {
      if (!this._opts.shareInk || !this._isBriefer()) return;
      const ann: any = this._annotator();
      const tool: string = ann?.tool ?? 'none';
      if (tool === 'none') return;
      const sid = this._currentSlideId();
      if (!sid) return;
      const at = PresentSync._normalise(e, ann._fx as HTMLElement);
      if (!at) return;

      if (tool === 'spotlight') {
        this._sendInk({ k: 'spot', sid, pts: [at], r: Number(ann._spotRadius) || 0.12 }, false);
        return;
      }
      if (tool === 'laser') {
        if (phase === 'down') this._laserPts = [];
        this._laserPts.push(at);
        if (this._laserPts.length > LASER_TAIL) {
          this._laserPts.splice(0, this._laserPts.length - LASER_TAIL);
        }
        if (phase === 'up') return; // the trail fades on its own at the receiver
        this._sendInk({ k: 'laser', sid, pts: [...this._laserPts] }, false);
        return;
      }
      if (tool === 'pen') {
        if (phase === 'down') this._penPts = [at];
        else this._penPts.push(at);
        if (phase === 'up') {
          // The committing message is never throttled — dropping it would leave
          // the stroke forever "in progress" on every other screen.
          if (this._penPts.length > 1) {
            this._sendInk({ k: 'pen', sid, pts: PresentSync._decimate(this._penPts), done: true }, true);
          }
          this._penPts = [];
          return;
        }
        this._sendInk({ k: 'pen', sid, pts: PresentSync._decimate(this._penPts) }, false);
      }
    } catch (err) {
      cerr('ink capture failed', err);
    }
  }

  private _sendInk(payload: InkPayload, force: boolean): void {
    const now = Date.now();
    if (!force && now - this._lastInkSent < 1000 / INK_HZ) return;
    this._lastInkSent = now;
    this.session.send('ink', payload);
  }

  private _onInk(msg: CollabMsg): void {
    if (!this._opts.sharePresentation || !this._opts.shareInk) return;
    const d: InkPayload | undefined = msg.d;
    if (!d) return;
    // Only the briefer marks up. Anyone else's ink is stale or unsolicited.
    if (this._holder() !== msg.from) return;
    this.ink.applyInk(msg.from, this.session.colorOf(msg.from), d);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _slides(): any[] {
    return (this._be?.getSlides() as any[]) ?? [];
  }

  private _indexOf(id: string): number {
    return this._slides().findIndex((s) => s?.id === id);
  }

  private _currentSlideId(): string | null {
    const idx = (this._be as any)?.currentIndex ?? -1;
    return this._slides()[idx]?.id ?? null;
  }

  /**
   * Reads the `_present` GETTER, not the `_presentSession` field.
   *
   * BriefingEngine builds its playback session lazily on first use, so the field
   * is null until somebody presents — and reading the field would mean
   * `_wrapPresentSession` found nothing to wrap at start() and never attached, so
   * build steps would silently never sync. Touching the getter constructs it; its
   * constructor only stores the host config and injects a stylesheet, so bringing
   * that forward costs nothing.
   */
  private _presentSession(): any {
    const be: any = this._be;
    if (!be) return null;
    try {
      return be._present ?? null;
    } catch (err) {
      cerr('could not obtain the present session', err);
      return null;
    }
  }

  private _annotator(): any {
    return this._presentSession()?._annotator ?? null;
  }

  /** Pointer position as a [0..1] fraction of the annotator canvas. */
  private static _normalise(e: PointerEvent, el: HTMLElement | undefined): [number, number] | null {
    if (!el?.getBoundingClientRect) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [Number(x.toFixed(4)), Number(y.toFixed(4))];
  }

  /**
   * Even sampling down to INK_MAX_PTS, keeping the last point so the stroke
   * always reaches where the pen actually is. Same approach MapSync uses for
   * drawing previews.
   */
  private static _decimate(pts: Array<[number, number]>): Array<[number, number]> {
    if (pts.length <= INK_MAX_PTS) return pts;
    const step = Math.ceil(pts.length / INK_MAX_PTS);
    const out: Array<[number, number]> = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
    const last = pts[pts.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }
}
