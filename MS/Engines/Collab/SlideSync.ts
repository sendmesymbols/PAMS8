/**
 * SlideSync.ts
 *
 * Live co-editing of the briefing deck: slide structure AND the objects inside
 * a slide, with soft locks per object.
 *
 * Like MapSync, this file edits nothing outside itself. Both engines are
 * wrapped at runtime and restored on teardown:
 *
 *   BriefingEngine   Every public deck mutator (add / capture / remove / rename
 *                    / move / duplicate / notes / section / transition / hidden /
 *                    builds) is wrapped. After the original runs we read the
 *                    resulting state and publish it — so we are never guessing
 *                    what the method did.
 *
 *   SlideEditor      One wrap does the heavy lifting: `_commit()`, the single
 *                    funnel every one of the editor's ~35 mutation paths already
 *                    calls to push an undo snapshot. Wrapping it means a moved
 *                    arrow, an edited textbox, a restyled table and a pasted
 *                    picture all publish through the same code, and no future
 *                    editor feature can forget to notify us.
 *
 * Wire format is the persisted `SlideOverlay` model itself — already normalised
 * [0..1] against the slide rect by OverlayFabric — so nothing new is serialised
 * and a shared overlay renders identically on every screen size.
 *
 * Known limitation, deliberate: `backgroundDataUrl` (a full-resolution map
 * screenshot, often megabytes) is stripped before sending, and thumbnails above
 * `imageMaxKb` are dropped too. A shared slide therefore arrives without its
 * captured map image and falls back to the live map beneath its annotations.
 * Streaming multi-megabyte PNGs to every peer on every capture is not a trade
 * worth making on a LAN, and the graphics themselves are already synced.
 */

import EngineLogger from '../../Support/EngineLogger';
import CollabPresence from './CollabPresence';
import type CollabLocks from './CollabLocks';
import type CollabSession from './CollabSession';
import type { CollabMsg } from './CollabTypes';

const ENGINE_NAME = 'Collab Engine';

/** How often to re-check for locks that lapsed on their TTL. See _startLockSweep. */
const LOCK_SWEEP_MS = 2000;

export interface SlideSyncOptions {
  syncSlides: boolean;
  locks: boolean;
  /** Draw a badge on objects a peer is currently holding. */
  showLocks: boolean;
  /** Drop a slide thumbnail larger than this before sending. */
  imageMaxKb: number;
}

/** Structural view of BriefingEngine — avoids a circular import. */
interface BriefingLike {
  getSlides(): readonly any[];
  removeSlide(ref: number | string): void;
  [key: string]: any;
}

interface EditorLike {
  isOpen(): boolean;
  readonly editingIndex: number;
  [key: string]: any;
}

/** Deck mutators wrapped on BriefingEngine, and what each publishes. */
const CREATORS = ['captureSlide', 'addBlankSlide', 'captureIntoSlide', 'duplicateSlide'] as const;
const MUTATORS = [
  'renameSlide',
  'setSlideNotes',
  'setSlideSection',
  'setSlideTransition',
  'setSlideHidden',
  'toggleSlideHidden',
  'setSlideBuildMode',
  'clearBuildSteps',
  'addBuildStep',
] as const;

export default class SlideSync {
  private _be: BriefingLike | null = null;
  private _editor: EditorLike | null = null;
  private _opts: SlideSyncOptions = {
    syncSlides: true,
    locks: true,
    showLocks: true,
    imageMaxKb: 256,
  };

  /** Original method references, restored verbatim on destroy. */
  private _origs = new Map<string, Function>();
  private _origCommit: Function | null = null;
  private _origOpen: Function | null = null;
  private _origClose: Function | null = null;

  private _offMsg: Array<() => void> = [];
  private _fabricHandlers: Array<[string, Function]> = [];
  private _fc: any = null;
  private _lockSweep: ReturnType<typeof setInterval> | null = null;
  /** Whether the last paint actually drew a badge — the sweep's trailing edge. */
  private _badgesPainted = false;

  /** Last published overlay JSON per slide id — the diff baseline. */
  private _baseline = new Map<string, Map<string, string>>();
  private _applying = false;

  constructor(
    private readonly session: CollabSession,
    private readonly locks: CollabLocks,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  public start(
    briefingEngine: unknown,
    slideEditor: unknown,
    opts?: Partial<SlideSyncOptions>,
  ): void {
    if (opts) this._opts = { ...this._opts, ...opts };
    this._be = (briefingEngine as BriefingLike) ?? null;
    this._editor = (slideEditor as EditorLike) ?? null;
    if (!this._be) {
      EngineLogger.error(ENGINE_NAME, 'Slide sync idle — briefing engine is not enabled');
      return;
    }

    this._wrapDeck();
    this._wrapEditor();
    this._seedBaseline();

    this._offMsg.push(this.session.on('slide.up', (m) => this._onRemoteSlideUp(m)));
    this._offMsg.push(this.session.on('slide.del', (m) => this._onRemoteSlideDel(m)));
    this._offMsg.push(this.session.on('slide.order', (m) => this._onRemoteOrder(m)));
    this._offMsg.push(this.session.on('ov.up', (m) => this._onRemoteOverlayUp(m)));
    this._offMsg.push(this.session.on('ov.del', (m) => this._onRemoteOverlayDel(m)));

    // A claim or release only matters while the canvas is up. CollabLocks has no
    // unsubscribe, so the `_fc` guard — not a teardown call — is what makes this
    // safe once the editor closes or SlideSync is destroyed.
    this.locks.onChange(() => this._fc?.requestRenderAll?.());
  }

  public setOptions(opts: Partial<SlideSyncOptions>): void {
    this._opts = { ...this._opts, ...opts };
  }

  public destroy(): void {
    this._detachFabric();
    for (const [name, fn] of this._origs) SlideSync._unwrap(this._be, name, fn);
    this._origs.clear();
    const ed: any = this._editor;
    if (ed) {
      SlideSync._unwrap(ed, '_commit', this._origCommit);
      SlideSync._unwrap(ed, 'open', this._origOpen);
      SlideSync._unwrap(ed, 'close', this._origClose);
    }
    this._origCommit = this._origOpen = this._origClose = null;
    this._offMsg.forEach((off) => off());
    this._offMsg = [];
    this._baseline.clear();
    this._be = null;
    this._editor = null;
  }

  /**
   * Undo one runtime wrap. Deleting the own property we added reveals the class
   * method still on the prototype, leaving the object exactly as we found it;
   * re-assigning would leave a permanent own property behind. The saved original
   * is the fallback for the case where the method really was an own property.
   */
  private static _unwrap(target: any, name: string, original: Function | null): void {
    if (!target) return;
    delete target[name];
    if (typeof target[name] !== 'function' && original) target[name] = original;
  }

  // ── Deck-level wraps ──────────────────────────────────────────────────────

  private _wrapDeck(): void {
    const be: any = this._be;
    if (!be) return;
    const self = this;

    for (const name of CREATORS) {
      if (typeof be[name] !== 'function') continue;
      const orig = be[name].bind(be);
      this._origs.set(name, be[name]);
      be[name] = function wrappedCreator(...args: any[]) {
        const slide = orig(...args);
        if (slide && !self._applying && self._opts.syncSlides) {
          // A brand-new slide (including a duplicate) is the one case where the
          // sender's overlays are authoritative — nobody else has this slide.
          self._publishSlide(slide, true);
        }
        return slide;
      };
    }

    for (const name of MUTATORS) {
      if (typeof be[name] !== 'function') continue;
      const orig = be[name].bind(be);
      this._origs.set(name, be[name]);
      be[name] = function wrappedMutator(ref: any, ...rest: any[]) {
        const result = orig(ref, ...rest);
        if (!self._applying && self._opts.syncSlides) {
          const slide = self._resolve(ref);
          if (slide) self._publishSlide(slide, false);
        }
        return result;
      };
    }

    if (typeof be.removeSlide === 'function') {
      const orig = be.removeSlide.bind(be);
      this._origs.set('removeSlide', be.removeSlide);
      be.removeSlide = function wrappedRemove(ref: any) {
        // Resolve the id BEFORE the slide is gone.
        const slide = self._resolve(ref);
        const id = slide?.id;
        const result = orig(ref);
        if (id && !self._applying && self._opts.syncSlides) {
          self._baseline.delete(id);
          self.session.send('slide.del', { id }, `sl:${id}`);
        }
        return result;
      };
    }

    if (typeof be.moveSlide === 'function') {
      const orig = be.moveSlide.bind(be);
      this._origs.set('moveSlide', be.moveSlide);
      be.moveSlide = function wrappedMove(from: any, to: number) {
        const result = orig(from, to);
        if (!self._applying && self._opts.syncSlides) self._publishOrder();
        return result;
      };
    }
  }

  /**
   * @param withOverlays  Only a slide the receiver has never seen carries its
   *   overlays. For an update (rename, notes, transition…) they are stripped —
   *   see _onRemoteSlideUp for why sending them corrupts concurrent editing.
   */
  private _publishSlide(slide: any, withOverlays: boolean): void {
    const idx = this._indexOf(slide.id);
    this.session.send(
      'slide.up',
      {
        slide: this._sanitize(slide, withOverlays),
        index: idx < 0 ? this._slides().length : idx,
      },
      `sl:${slide.id}`,
    );
    // A captured slide can arrive with overlays already on it (duplicate).
    this._rebaseline(slide);
  }

  private _publishOrder(): void {
    const ids = this._slides().map((s) => s.id);
    this.session.send('slide.order', { ids }, 'sl:order');
  }

  // ── Editor-level wraps ────────────────────────────────────────────────────

  private _wrapEditor(): void {
    const ed: any = this._editor;
    if (!ed) return;
    const self = this;

    if (typeof ed._commit === 'function') {
      this._origCommit = ed._commit;
      const orig = ed._commit.bind(ed);
      ed._commit = function wrappedCommit(...args: any[]) {
        const out = orig(...args);
        if (!self._applying && self._opts.syncSlides) self._publishOverlayDiff();
        return out;
      };
    } else {
      EngineLogger.error(
        ENGINE_NAME,
        'Slide editor internals changed — in-slide edits will not be shared',
      );
    }

    if (typeof ed.open === 'function') {
      this._origOpen = ed.open;
      const orig = ed.open.bind(ed);
      ed.open = async function wrappedOpen(host: any, index: number) {
        const ok = await orig(host, index);
        if (ok) self._attachFabric();
        return ok;
      };
    }

    if (typeof ed.close === 'function') {
      this._origClose = ed.close;
      const orig = ed.close.bind(ed);
      ed.close = function wrappedClose(save: boolean) {
        if (self._opts.syncSlides && save) self._publishOverlayDiff();
        self._detachFabric();
        self.locks.claim([], 'slide');
        return orig(save);
      };
    }
  }

  /** Hook the live fabric canvas for per-object lock claims. */
  private _attachFabric(): void {
    // Reopening the editor without an intervening close would otherwise stack a
    // second set of handlers on the new canvas and orphan the first.
    this._detachFabric();
    const ed: any = this._editor;
    const fc = ed?._fc;
    if (!fc?.on) return;
    this._fc = fc;
    const self = this;

    const onSelect = () => {
      if (!self._opts.locks) return;
      const objs: any[] = fc.getActiveObjects?.() ?? [];
      const ids = objs.map((o) => o?.data?.id).filter(Boolean);
      const blocked = ids.filter((id: string) => self.locks.lockedByOther(id));
      if (blocked.length) {
        const owner = self.locks.ownerOf(blocked[0]);
        CollabPresence.toast(`${owner?.name ?? 'Another user'} is editing this object`);
        fc.discardActiveObject();
        fc.requestRenderAll?.();
        self.locks.claim([], 'slide');
        return;
      }
      self.locks.claim(ids, 'slide');
    };
    const onClear = () => self.locks.claim([], 'slide');
    const onRender = () => self._paintLocks();

    fc.on('selection:created', onSelect);
    fc.on('selection:updated', onSelect);
    fc.on('selection:cleared', onClear);
    fc.on('after:render', onRender);
    this._fabricHandlers.push(
      ['selection:created', onSelect],
      ['selection:updated', onSelect],
      ['selection:cleared', onClear],
      ['after:render', onRender],
    );
    this._startLockSweep();
  }

  private _detachFabric(): void {
    this._stopLockSweep();
    const fc = this._fc;
    if (fc?.off) {
      for (const [evt, fn] of this._fabricHandlers) {
        try {
          fc.off(evt, fn);
        } catch {
          /* fabric 4 tolerates a missing handler */
        }
      }
    }
    this._fabricHandlers = [];
    this._fc = null;
    this._badgesPainted = false;
  }

  // ── Lock badges ───────────────────────────────────────────────────────────

  /**
   * Draw a badge over every object a peer currently holds.
   *
   * Painted straight onto the canvas context from `after:render` rather than
   * added as fabric objects, because anything in `getObjects()` flows through
   * the editor's `_snapshotJson()` into the undo stack, the `ov.up` we publish,
   * the saved deck and the PowerPoint export — a lock badge would arrive on
   * every peer's screen as a real annotation. Drawing leaves no trace: the next
   * render clears the canvas and asks us again.
   */
  private _paintLocks(): void {
    const fc = this._fc;
    if (!fc || !this._opts.showLocks) {
      this._badgesPainted = false;
      return;
    }
    const ctx = fc.contextContainer;
    if (!ctx) return;

    let painted = false;
    for (const obj of (fc.getObjects?.() ?? []) as any[]) {
      const id = obj?.data?.id;
      if (!id) continue;
      // ownerOf already excludes our own claims and anything expired.
      const owner = this.locks.ownerOf(id);
      if (!owner) continue;
      // Viewport-transformed, so the badge tracks the editor's zoom and pan
      // without any arithmetic of ours.
      SlideSync._drawLockBadge(ctx, obj.getBoundingRect(), owner.color);
      painted = true;
    }
    this._badgesPainted = painted;
  }

  /**
   * A dashed box in the holder's colour with a padlock chip at its corner. The
   * chip is filled rather than tinted text: a colour-emoji font ignores
   * `fillStyle`, so the padlock alone would be the same grey for everyone.
   */
  private static _drawLockBadge(
    ctx: CanvasRenderingContext2D,
    r: { left: number; top: number; width: number; height: number },
    color: string,
  ): void {
    const SIZE = 16;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.left - 1, r.top - 1, r.width + 2, r.height + 2);

    // Above the box normally; tucked inside it for an object sitting against
    // the top edge, where the chip would otherwise be clipped away.
    const x = r.left - 1;
    const y = r.top - 2 - SIZE < 0 ? r.top + 1 : r.top - 2 - SIZE;
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, SIZE, SIZE);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒', x + SIZE / 2, y + SIZE / 2 + 1);
    ctx.restore();
  }

  /**
   * Repaint periodically while any slide lock is live.
   *
   * `onChange` covers claims and releases, but a lock that lapses on its TTL
   * arrives as silence — no message, no callback, and a badge that would sit
   * there forever after a peer's browser died. The `_badgesPainted` term is the
   * trailing edge: without it the sweep goes quiet the moment the last lock
   * expires, one repaint too early to rub the badge out.
   */
  private _startLockSweep(): void {
    this._stopLockSweep();
    this._lockSweep = setInterval(() => {
      if (!this._fc) return;
      if (!this._badgesPainted && !this.locks.remoteLocks('slide').length) return;
      this._fc.requestRenderAll?.();
    }, LOCK_SWEEP_MS);
  }

  private _stopLockSweep(): void {
    if (this._lockSweep) clearInterval(this._lockSweep);
    this._lockSweep = null;
  }

  // ── Overlay diffing ───────────────────────────────────────────────────────

  /**
   * Compare the editor's current overlays against the last published set and
   * emit one op per changed or removed object. Per-object rather than
   * whole-slide so two people working on different objects never overwrite each
   * other, and so a nudge costs one small message.
   */
  private _publishOverlayDiff(): void {
    const ed: any = this._editor;
    if (!ed?.isOpen?.()) return;
    const slide = this._slides()[ed.editingIndex];
    if (!slide?.id) return;
    const overlays = this._readEditorOverlays();
    if (!overlays) return;

    const prev = this._baseline.get(slide.id) ?? new Map<string, string>();
    const next = new Map<string, string>();

    for (const ov of overlays) {
      if (!ov?.id) continue;
      const json = JSON.stringify(ov);
      next.set(ov.id, json);
      if (prev.get(ov.id) === json) continue;
      this.session.send('ov.up', { slideId: slide.id, ov }, `ov:${slide.id}:${ov.id}`);
    }
    for (const id of prev.keys()) {
      if (next.has(id)) continue;
      this.session.send('ov.del', { slideId: slide.id, id }, `ov:${slide.id}:${id}`);
    }
    this._baseline.set(slide.id, next);
  }

  /** Read overlays out of the open editor via its own snapshot serialiser. */
  private _readEditorOverlays(): any[] | null {
    const ed: any = this._editor;
    if (typeof ed?._snapshotJson !== 'function') return null;
    try {
      const parsed = JSON.parse(ed._snapshotJson());
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private _seedBaseline(): void {
    for (const s of this._slides()) this._rebaseline(s);
  }

  private _rebaseline(slide: any): void {
    if (!slide?.id) return;
    const map = new Map<string, string>();
    for (const ov of slide.overlays ?? []) {
      if (ov?.id) map.set(ov.id, JSON.stringify(ov));
    }
    this._baseline.set(slide.id, map);
  }

  // ── Applying remote ops ───────────────────────────────────────────────────

  private _onRemoteSlideUp(msg: CollabMsg): void {
    if (!this._opts.syncSlides) return;
    const incoming = msg.d?.slide;
    if (!incoming?.id) return;
    if (!this.session.accept(`sl:${incoming.id}`, msg.ts)) return;

    const slides = this._slides();
    const idx = this._indexOf(incoming.id);
    this._applying = true;
    try {
      if (idx >= 0) {
        // Mutate in place: BriefingEngine, the editor and any open panel all
        // hold references to this object.
        const target = slides[idx];
        /**
         * `overlays` is deliberately NOT taken from the payload on an update.
         *
         * A slide-level op (rename, notes, transition) is stamped under
         * `sl:<id>`, entirely independent of the per-object `ov:<id>:<objId>`
         * stamps — so replacing the array wholesale let a rename silently revert
         * whatever objects somebody else was editing on that slide. Object state
         * belongs to ov.up / ov.del alone; the sender no longer even transmits it
         * here. Images are preserved for the same reason: the payload is
         * deliberately stripped of them (see _sanitize).
         */
        SlideSync._mergeSlide(target, incoming, {
          overlays: target.overlays,
          backgroundDataUrl: target.backgroundDataUrl,
          thumbnailDataUrl: target.thumbnailDataUrl,
        });
      } else {
        const at = Math.max(0, Math.min(Number(msg.d?.index ?? slides.length), slides.length));
        // Inserting shifts every index after `at`, including the presenter's
        // current slide and the open editor's — both re-pinned by id.
        this._keepIndices(() => (slides as any[]).splice(at, 0, incoming));
      }
      this._rebaseline(this._slideById(incoming.id) ?? incoming);
      this._refreshUi();
    } finally {
      this._applying = false;
    }
  }

  /** Keys that must never be copied from a wire payload onto a live object:
   *  `JSON.parse` creates a real own `__proto__` property, and assigning it
   *  reaches Object.prototype through the inherited setter. */
  private static readonly UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  /**
   * Replace `target`'s contents with `incoming`, in place, then reinstate
   * `preserve`. In place because BriefingEngine, the slide strip and the editor
   * all hold references to the same slide object.
   */
  private static _mergeSlide(target: any, incoming: any, preserve: Record<string, any>): void {
    for (const k of Object.keys(target)) {
      if (SlideSync.UNSAFE_KEYS.has(k)) continue;
      delete target[k];
    }
    for (const k of Object.keys(incoming)) {
      if (SlideSync.UNSAFE_KEYS.has(k)) continue;
      target[k] = incoming[k];
    }
    for (const [k, v] of Object.entries(preserve)) {
      if (v !== undefined) target[k] = v;
    }
  }

  /**
   * Run a reordering mutation with the presenter's current slide and the open
   * editor's slide re-pinned by id afterwards.
   *
   * Both are stored as plain array indices, so a peer inserting or reordering
   * slides above them silently repoints them at a different slide — which for
   * the editor means the next `_publishOverlayDiff()` would attribute your edits
   * to the wrong slide entirely. BriefingEngine's own moveSlide/duplicateSlide
   * use exactly this find-by-id idiom; this applies it to the remote paths too.
   */
  private _keepIndices<T>(fn: () => T): T {
    const be: any = this._be;
    const ed: any = this._editor;
    const before = this._slides();
    const currentId =
      typeof be?._current === 'number' && be._current >= 0 ? before[be._current]?.id : undefined;
    const editingId =
      ed?.isOpen?.() && typeof ed._index === 'number' && ed._index >= 0
        ? before[ed._index]?.id
        : undefined;

    const out = fn();

    const after = this._slides();
    if (currentId !== undefined) {
      const next = after.findIndex((s) => s?.id === currentId);
      if (next >= 0) be._current = next;
    }
    if (editingId !== undefined) {
      const next = after.findIndex((s) => s?.id === editingId);
      if (next >= 0) ed._index = next;
    }
    return out;
  }

  private _onRemoteSlideDel(msg: CollabMsg): void {
    if (!this._opts.syncSlides) return;
    const id = msg.d?.id;
    if (!id) return;
    if (!this.session.accept(`sl:${id}`, msg.ts)) return;
    const idx = this._indexOf(id);
    if (idx < 0) return;
    this._applying = true;
    try {
      // Close the editor first if it is standing on the slide being removed.
      const ed: any = this._editor;
      if (ed?.isOpen?.() && ed.editingIndex === idx) {
        CollabPresence.toast('This slide was deleted by another user');
        ed.close(false);
      }
      // Removing shifts the indices after it, so re-pin the same way an insert
      // does. If the current slide was the one removed its id is simply not
      // found and BriefingEngine's own clamp stands.
      this._keepIndices(() => this._be?.removeSlide(idx));
      this._baseline.delete(id);
      this._refreshUi();
    } finally {
      this._applying = false;
    }
  }

  private _onRemoteOrder(msg: CollabMsg): void {
    if (!this._opts.syncSlides) return;
    const ids: string[] | undefined = msg.d?.ids;
    if (!ids?.length) return;
    if (!this.session.accept('sl:order', msg.ts)) return;
    const slides = this._slides() as any[];
    const byId = new Map(slides.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    // Anything the sender did not know about keeps its relative place at the end
    // rather than being dropped.
    for (const s of slides) if (!ids.includes(s.id)) ordered.push(s);
    if (ordered.length !== slides.length) return;
    this._applying = true;
    try {
      this._keepIndices(() => {
        slides.length = 0;
        slides.push(...ordered);
      });
      this._refreshUi();
    } finally {
      this._applying = false;
    }
  }

  private _onRemoteOverlayUp(msg: CollabMsg): void {
    if (!this._opts.syncSlides) return;
    const { slideId, ov } = msg.d ?? {};
    if (!slideId || !ov?.id) return;
    if (!this.session.accept(`ov:${slideId}:${ov.id}`, msg.ts)) return;

    const slide = this._slideById(slideId);
    if (!slide) return;
    const list: any[] = (slide.overlays ??= []);
    const i = list.findIndex((o) => o?.id === ov.id);
    if (i >= 0) list[i] = ov;
    else list.push(ov);

    const map = this._baseline.get(slideId) ?? new Map<string, string>();
    map.set(ov.id, JSON.stringify(ov));
    this._baseline.set(slideId, map);

    this._reloadEditorIfShowing(slideId, list);
    this._refreshUi();
  }

  private _onRemoteOverlayDel(msg: CollabMsg): void {
    if (!this._opts.syncSlides) return;
    const { slideId, id } = msg.d ?? {};
    if (!slideId || !id) return;
    if (!this.session.accept(`ov:${slideId}:${id}`, msg.ts)) return;

    const slide = this._slideById(slideId);
    if (!slide?.overlays) return;
    const i = slide.overlays.findIndex((o: any) => o?.id === id);
    if (i < 0) return;
    slide.overlays.splice(i, 1);
    this._baseline.get(slideId)?.delete(id);
    this._reloadEditorIfShowing(slideId, slide.overlays);
    this._refreshUi();
  }

  /**
   * Push a changed overlay set into the open canvas. The editor's own
   * `_restore()` is the only safe way in — it rebuilds fabric objects with the
   * arrow/vertex controls and grouping wiring that a hand-built object would
   * lack. Selection is captured and re-applied around it, so a remote edit to a
   * different object does not steal what you had selected.
   */
  private _reloadEditorIfShowing(slideId: string, overlays: any[]): void {
    const ed: any = this._editor;
    if (!ed?.isOpen?.()) return;
    if (this._slides()[ed.editingIndex]?.id !== slideId) return;
    if (typeof ed._restore !== 'function') return;

    const fc = ed._fc;
    const activeIds: string[] = (fc?.getActiveObjects?.() ?? [])
      .map((o: any) => o?.data?.id)
      .filter(Boolean);

    this._applying = true;
    try {
      ed._restore(JSON.stringify(overlays));
      if (fc && activeIds.length === 1) {
        const again = (fc.getObjects() as any[]).find((o) => o?.data?.id === activeIds[0]);
        if (again) {
          fc.setActiveObject(again);
          fc.requestRenderAll?.();
        }
      }
    } catch (err) {
      EngineLogger.error(
        ENGINE_NAME,
        `Could not apply a shared slide edit: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this._applying = false;
    }
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  /** Deck payload for a late joiner. */
  public collectSnapshot(): any | null {
    const be: any = this._be;
    if (!be?.exportBriefing) return null;
    try {
      const doc = be.exportBriefing();
      if (!doc?.slides?.length) return null;
      return { ...doc, slides: doc.slides.map((s: any) => this._sanitize(s)) };
    } catch {
      return null;
    }
  }

  /** Replace the local deck with a snapshot (only when we have none of our own). */
  public applySnapshot(doc: any): void {
    if (!this._opts.syncSlides || !doc?.slides?.length) return;
    const be: any = this._be;
    if (!be?.importBriefing) return;
    if (this._slides().length) return; // never clobber existing local work
    this._applying = true;
    try {
      be.importBriefing(doc);
      this._seedBaseline();
      this._refreshUi();
    } catch (err) {
      EngineLogger.error(
        ENGINE_NAME,
        `Could not load the shared deck: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this._applying = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _slides(): any[] {
    return (this._be?.getSlides() as any[]) ?? [];
  }

  private _indexOf(id: string): number {
    return this._slides().findIndex((s) => s?.id === id);
  }

  private _slideById(id: string): any | null {
    return this._slides().find((s) => s?.id === id) ?? null;
  }

  /** BriefingEngine's `ref` convention: number = index, string = slide id. */
  private _resolve(ref: any): any | null {
    const slides = this._slides();
    if (typeof ref === 'number') return slides[ref] ?? null;
    if (typeof ref === 'string') return this._slideById(ref);
    return slides[(this._be as any)?.currentIndex ?? -1] ?? null;
  }

  /** Repaint the slide strip / sorter if the briefing panel is showing. */
  private _refreshUi(): void {
    const be: any = this._be;
    try {
      be?._refreshStrip?.();
    } catch {
      /* panel not built yet */
    }
  }

  /**
   * Strip the heavy capture images. See the file header — this is the one
   * deliberate lossy point in slide sync.
   *
   * `withOverlays: false` also drops object state, which only the ov.* ops are
   * allowed to carry once a slide exists on both sides.
   */
  private _sanitize(slide: any, withOverlays = true): any {
    const out: any = { ...slide };
    delete out.backgroundDataUrl;
    if (!withOverlays) delete out.overlays;
    const maxChars = Math.max(0, this._opts.imageMaxKb) * 1024;
    if (typeof out.thumbnailDataUrl === 'string' && out.thumbnailDataUrl.length > maxChars) {
      delete out.thumbnailDataUrl;
    }
    return out;
  }
}
