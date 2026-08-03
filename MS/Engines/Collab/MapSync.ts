/**
 * MapSync.ts
 *
 * Keeps map graphics in step across peers — and does it without a single edit
 * inside SymbolEngine, EditEngine, MorphixEngine, or any of the ~124 symbol
 * classes. All the coupling lives here, so deleting this folder removes the
 * feature completely.
 *
 * How each kind of change is noticed:
 *
 *   create / delete   `layer.graphics.on('change')` on every symbol layer — the
 *                     same passive hook DeclutterEngine already uses. Catches a
 *                     graphic however it appeared: interactive draw, template,
 *                     paste, deployment builder, plan load.
 *
 *   geometry edits    Commit-boundary diffing. EditEngine mutates geometry in
 *                     place, which fires no event, so on pointer-up (and on any
 *                     selection change) we re-serialise ONLY the graphics that
 *                     are or just were selected — typically one to ten — and
 *                     emit the ones whose serialisation actually changed. Cheap,
 *                     and it cannot miss an edit because every edit path in the
 *                     app runs through selection.
 *
 *   property edits    `updateSymbol()` is wrapped at runtime here and restored
 *                     on teardown. Morphix, the settings panels, and the
 *                     force-size sweep all funnel through it.
 *
 * The wire format is SerializationEngine.saveSymbolToJSON() — the exact payload
 * the plan format already round-trips — so a remote graphic is rebuilt through
 * the ordinary loadSymbolFromJSON() path and renders identically to a local one.
 */

import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import type GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';
import type Collection from '@arcgis/core/core/Collection';

import AnnotationEngine from '../AnnotationEngine';
import { removeMinefieldTextureForGraphic } from '../../Support/MinefieldTextureFill3D';
import GraphicsLayerManager, {
  LAYER_NAMES,
  SYMBOL_LAYER_IDS,
} from '../../Managers/GraphicsLayerManager';
import EngineLogger from '../../Support/EngineLogger';
import { cerr, clog, mergeDefined } from './CollabDebug';
import CollabPresence from './CollabPresence';
import type CollabLocks from './CollabLocks';
import type CollabSession from './CollabSession';
import type { CollabMsg, CursorPayload, PreviewPayload } from './CollabTypes';

const ENGINE_NAME = 'Collab Engine';
/**
 * Settle delay for graphics noticed via the layer observer (paste, template,
 * plan load), where the symbol class may still be finishing. The `symbolCreated`
 * path needs no delay — drawSymEnd has already completed by then — so it
 * publishes immediately and this only applies to the fallback route.
 */
const ADD_SETTLE_MS = 60;

/**
 * SymbolEngine fields that `initialize()` overwrites on every call, including
 * passive ones. A remote symbol rebuilt mid-draw would otherwise repoint the
 * LOCAL user's in-flight draw at the remote symbol's identity — see
 * _applyPreservingDrawState.
 */
const DRAW_STATE_KEYS = [
  '_pendingAttrs',
  '_activeSIDC',
  '_activeAmplifier',
  '_lastDrawEssentials',
  '_lastAmplifier',
  '_lastCreatedGraphic',
  'currentSymbol',
  'sidc',
  'amplifier',
] as const;

/** How long after the last draw-progress event a local draw counts as active. */
const DRAW_GRACE_MS = 1200;
/** Cap on preview vertices sent per message — a freehand trace can hold thousands. */
const PREVIEW_MAX_PTS = 60;
/** How often the viewport heartbeat may fire. One a second is plenty for a rectangle. */
const VIEWPORT_MS = 1000;
/**
 * Re-send the viewport even when it has not changed, this often.
 *
 * Without it a peer who joins while everybody is sitting still learns nothing
 * about where anyone is looking until somebody happens to pan.
 */
const VIEWPORT_REPEAT_MS = 3000;

/**
 * The slice of SymbolEngine this module needs. Declared structurally rather than
 * importing SymbolEngine, which would be a circular dependency (SymbolEngine
 * dynamically imports CollabEngine).
 */
export interface MapSyncHost {
  /**
   * Read-only: on SymbolEngine this is a getter with no setter, so it must never
   * be assigned. View switches arrive through onViewChanged instead, and
   * `layerManager` is itself a getter that already follows the current view.
   */
  readonly view: MapView | SceneView;
  readonly layerManager: GraphicsLayerManager;
  serializationEngine: { saveSymbolToJSON(g: Graphic): any };
  loadSymbolFromJSON(data: any): Graphic | null;
  selectionEngine?: {
    on(type: string, cb: (data: any) => void): { remove(): void };
    selectedGraphics: Graphic[];
    clearSelection(): void;
  };
  updateSymbol?: (graphic: Graphic, patch: any) => any;
  labelOptions?: any;
}

export interface MapSyncOptions {
  syncMap: boolean;
  showPreviews: boolean;
  cursorHz: number;
  locks: boolean;
  /** Broadcast our own extent so peers can see where we are looking. */
  shareViewport: boolean;
}

export default class MapSync {
  private _host: MapSyncHost | null = null;
  private _view: MapView | SceneView | null = null;
  private _opts: MapSyncOptions = {
    syncMap: true,
    showPreviews: true,
    cursorHz: 20,
    locks: true,
    shareViewport: true,
  };

  /** Serialised form of every graphic we have already published, by id. */
  private _hashes = new Map<string, string>();
  /** Ids selected at the previous selectionChange — diffed on the next commit. */
  private _watched = new Set<string>();
  /**
   * Each watched graphic as OUR OWN serialiser saw it when the selection was
   * made — the baseline the commit-boundary diff compares against.
   *
   * It cannot compare against `_hashes`, because for a graphic that arrived from
   * a peer `_hashes` holds the sender's JSON. Any field that does not survive
   * saveSymbolToJSON(loadSymbolFromJSON(x)) byte-for-byte — key order, float
   * formatting, a defaulted field — then reads as a local edit, so merely
   * clicking a peer's symbol published it back, the peer accepted it as newer and
   * rebuilt its own graphic (a visible flicker and a re-annotate), potentially on
   * every selection. Comparing our serialisation against our serialisation is
   * immune to that whatever the round-trip fidelity turns out to be.
   */
  private _preEdit = new Map<string, string>();

  private _layerHandles: Array<{ remove(): void }> = [];
  private _viewHandles: Array<{ remove(): void }> = [];
  private _offMsg: Array<() => void> = [];
  private _docHandlers: Array<[string, EventListener]> = [];
  private _selHandle: { remove(): void } | null = null;
  private _addTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingAdds = new Set<string>();
  /**
   * Ids removed while a local draw was in flight, re-checked once it ends.
   *
   * The layer observer stands down completely during a draw, so a deletion in that
   * window produced no `g.del` — and because `_hashes` still held the id, no later
   * pass noticed either, leaving the symbol on every peer's map permanently.
   *
   * Deferred rather than published on the spot because a removal mid-draw is not
   * necessarily a deletion: a symbol class re-rendering a finished graphic removes
   * and re-adds it, and only once the draw is over is `findGraphic` a trustworthy
   * answer to "is it actually gone?".
   */
  private _pendingRemoves = new Set<string>();

  /** True while applying a remote op — suppresses the observers so nothing echoes. */
  private _applying = false;
  /** True while our own updateSymbol() runs — it removes + re-adds internally. */
  private _updating = false;

  private _lastCursorSent = 0;
  private _localPreviewId: string | null = null;
  private _vpTimer: ReturnType<typeof setInterval> | null = null;
  private _lastVpKey = '';
  private _lastVpSent = 0;
  /**
   * True while a one-shot ping is armed. Arming beats a modifier chord because
   * every plausible one is taken: Ctrl and Shift +click are SelectionEngine's
   * add-to-selection, and Alt is ProximityEngine's snap modifier. An explicit
   * "next click drops a ping" cannot collide with any of them, and is visible.
   */
  private _pingArmed = false;
  private _pingHandles: Array<{ remove(): void }> = [];
  private _pingKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** Newest pending remote op per graphic id — coalesced, see _enqueueApply. */
  private _pendingApplies = new Map<string, CollabMsg>();
  /** Date.now() until which a local draw counts as in progress. */
  private _drawBusyUntil = 0;
  private _drainTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bound original, used to call through. */
  private _origUpdateSymbol: ((g: Graphic, patch: any) => any) | null = null;
  /** Unbound original, used to restore — see _unwrapUpdateSymbol. */
  private _rawUpdateSymbol: Function | null = null;
  /** Whether updateSymbol was an own property before we wrapped it. */
  private _hadOwnUpdateSymbol = false;
  /** The exact wrapper we installed, so teardown does not clobber later wrappers. */
  private _patchedUpdateSymbol: Function | null = null;

  constructor(
    private readonly session: CollabSession,
    private readonly locks: CollabLocks,
    private readonly presence: CollabPresence,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  public start(host: MapSyncHost, opts?: Partial<MapSyncOptions>): void {
    this._host = host;
    this._opts = mergeDefined(this._opts, opts);
    this._view = host.view;
    clog('MapSync.start', this._opts);

    this._seedHashes();
    this._attachLayerObservers();
    this._attachViewObservers();
    this._attachSelectionObserver();
    this._attachDrawObservers();
    this._wrapUpdateSymbol();

    this._offMsg.push(this.session.on('g.up', (m) => this._onRemoteUpsert(m)));
    this._offMsg.push(this.session.on('g.del', (m) => this._onRemoteDelete(m)));
    this._offMsg.push(this.session.on('cursor', (m) => this._onRemoteCursor(m)));
    this._offMsg.push(this.session.on('preview', (m) => this._onRemotePreview(m)));
    this._offMsg.push(
      this.session.on('preview-end', (m) => this.presence.clearPreview(m.d?.pid)),
    );
    this._offMsg.push(this.session.on('look', (m) => this._onRemotePing(m)));
    this._offMsg.push(this.session.on('vp', (m) => this._onRemoteViewport(m)));

    this._vpTimer = setInterval(() => this._maybeSendViewport(), VIEWPORT_MS);
  }

  // ── Awareness: viewport heartbeat ─────────────────────────────────────────

  /**
   * Publish our extent when it has changed, or every VIEWPORT_REPEAT_MS
   * regardless. Skipped entirely in an empty room, like the cursor path.
   */
  private _maybeSendViewport(): void {
    if (!this._opts.shareViewport || !this.session.peerCount) return;
    const box = this.presence.myViewport();
    if (!box) return;
    const key = `${box.xmin.toFixed(4)},${box.ymin.toFixed(4)},${box.xmax.toFixed(4)},${box.ymax.toFixed(4)}`;
    const now = Date.now();
    if (key === this._lastVpKey && now - this._lastVpSent < VIEWPORT_REPEAT_MS) return;
    this._lastVpKey = key;
    this._lastVpSent = now;
    this.session.send('vp', box);
  }

  private _onRemoteViewport(msg: CollabMsg): void {
    const d = msg.d;
    if (!d) return;
    this.presence.setViewport(msg.from, this.session.nameOf(msg.from), this.session.colorOf(msg.from), d);
  }

  // ── Awareness: "look here" ping ───────────────────────────────────────────

  /** Arm a one-shot ping: the next click on the map drops it. Esc cancels. */
  public armPing(): void {
    if (this._pingArmed) {
      this.disarmPing();
      return;
    }
    const view = this._view;
    if (!view) return;
    this._pingArmed = true;
    const container = view.container as HTMLElement | undefined;
    if (container) container.style.cursor = 'crosshair';
    CollabPresence.toast('Click the map to ping the room — Esc to cancel');

    this._pingHandles.push(
      view.on('click', (evt: any) => {
        // Nothing else should act on this click: the user armed it for a ping.
        evt.stopPropagation?.();
        const ll = MapSync._toLonLat(evt?.mapPoint);
        this.disarmPing();
        if (ll) this.pingAt(ll[0], ll[1]);
      }),
    );
    this._pingKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.disarmPing();
    };
    document.addEventListener('keydown', this._pingKeyHandler, true);
  }

  public disarmPing(): void {
    if (!this._pingArmed) return;
    this._pingArmed = false;
    const container = this._view?.container as HTMLElement | undefined;
    if (container) container.style.cursor = '';
    this._pingHandles.forEach((h) => h.remove());
    this._pingHandles = [];
    if (this._pingKeyHandler) {
      document.removeEventListener('keydown', this._pingKeyHandler, true);
      this._pingKeyHandler = null;
    }
  }

  public get pingArmed(): boolean {
    return this._pingArmed;
  }

  /**
   * Drop a ping. Rendered locally too — a gesture with no local feedback leaves
   * you unsure whether it went anywhere.
   */
  public pingAt(lon: number, lat: number): void {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    // 'look', not 'ping' — see the CollabMsgType comment; 'ping' is the heartbeat.
    this.session.send('look', { lon, lat });
    this.presence.addPing(
      this.session.me.id,
      this.session.me.name,
      this.session.colorOf(this.session.me.id),
      lon,
      lat,
    );
  }

  /** Ping the centre of the current view — the Ctrl+K command's entry point. */
  public pingViewCentre(): void {
    const ll = MapSync._toLonLat((this._view as any)?.center);
    if (ll) this.pingAt(ll[0], ll[1]);
  }

  private _onRemotePing(msg: CollabMsg): void {
    const d = msg.d;
    if (!d || !Number.isFinite(d.lon) || !Number.isFinite(d.lat)) return;
    this.presence.addPing(
      msg.from,
      this.session.nameOf(msg.from),
      this.session.colorOf(msg.from),
      d.lon,
      d.lat,
    );
  }

  public onViewChanged(view: MapView | SceneView): void {
    // An armed ping belongs to the view it was armed on; its click handle and
    // crosshair cursor are both attached there.
    this.disarmPing();
    this._view = view;
    this._detachLayerObservers();
    this._detachViewObservers();
    this._attachLayerObservers();
    this._attachViewObservers();
    // The new view has a different extent, so the cached key would suppress the
    // first heartbeat from it.
    this._lastVpKey = '';
  }

  public setOptions(opts: Partial<MapSyncOptions>): void {
    this._opts = mergeDefined(this._opts, opts);
    clog('MapSync.setOptions', this._opts);
  }

  public destroy(): void {
    this._unwrapUpdateSymbol();
    this.disarmPing();
    if (this._vpTimer) {
      clearInterval(this._vpTimer);
      this._vpTimer = null;
    }
    this._detachLayerObservers();
    this._detachViewObservers();
    this._selHandle?.remove();
    this._selHandle = null;
    this._docHandlers.forEach(([t, h]) => document.removeEventListener(t, h));
    this._docHandlers = [];
    this._offMsg.forEach((off) => off());
    this._offMsg = [];
    if (this._addTimer) {
      clearTimeout(this._addTimer);
      this._addTimer = null;
    }
    if (this._drainTimer) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
    this._pendingAdds.clear();
    this._pendingRemoves.clear();
    this._pendingApplies.clear();
    this._hashes.clear();
    this._watched.clear();
    this._preEdit.clear();
    this._drawBusyUntil = 0;
    this._localPreviewId = null;
    this._host = null;
  }

  // ── Observers: create / delete ────────────────────────────────────────────

  private _symbolLayers(): GraphicsLayer[] {
    const lm = this._host?.layerManager;
    if (!lm) return [];
    return SYMBOL_LAYER_IDS.map((id) => lm.getOrCreateLayer(id)).filter(Boolean);
  }

  private _attachLayerObservers(): void {
    let attached = 0;
    for (const layer of this._symbolLayers()) {
      const coll = layer.graphics as unknown as Collection<Graphic>;
      if (!coll?.on) {
        cerr(`layer "${layer?.id}" exposes no observable graphics collection`, null);
        continue;
      }
      const handle = coll.on('change', (evt: any) => {
        // Never let a fault in here surface as a broken map interaction: this
        // handler runs inside the symbol classes' own add/remove calls.
        try {
          if (this._applying || this._updating || !this._opts.syncMap) return;
          // Stay out of the way completely while a draw is in flight. Symbol
          // classes churn scratch graphics through this very layer on every
          // pointer move; the finished symbol arrives via symbolCreated.
          // Removals are DEFERRED rather than dropped — see _pendingRemoves.
          if (this._localDrawActive()) {
            (evt.removed as Graphic[] | undefined)?.forEach((g) => {
              const id = this._readId(g);
              if (id && this._hashes.has(id)) this._pendingRemoves.add(id);
            });
            return;
          }
          this._flushPendingRemoves();
          clog('layer change', layer.id, {
            added: evt.added?.length ?? 0,
            removed: evt.removed?.length ?? 0,
          });
          (evt.added as Graphic[] | undefined)?.forEach((g) => this._queueAdd(g));
          (evt.removed as Graphic[] | undefined)?.forEach((g) => this._onLocalRemove(g));
        } catch (err) {
          cerr('layer change handler failed', err);
        }
      });
      this._layerHandles.push(handle);
      attached++;
    }
    clog(`layer observers attached: ${attached}/${SYMBOL_LAYER_IDS.length}`);
  }

  private _detachLayerObservers(): void {
    this._layerHandles.forEach((h) => h.remove());
    this._layerHandles = [];
  }

  /**
   * Backstop route for graphics that appear without a `symbolCreated` event
   * (paste, template, plan load, deployment builder). Published a beat later
   * because the symbol class may still be adding annotation text, echelon marks
   * or minefield texture at `change` time.
   *
   * Read-only and filtered: an in-progress scratch graphic must never be
   * touched or published — see _readId / _isShareable.
   */
  private _queueAdd(g: Graphic): void {
    if (!this._isShareable(g)) {
      clog('add ignored — not a completed symbol');
      return;
    }
    const id = this._readId(g);
    if (!id) {
      // No id yet and we will not assign one from an observer. The real symbol
      // arrives through symbolCreated, which owns id assignment.
      clog('add ignored — no id yet (waiting for symbolCreated)');
      return;
    }
    this._pendingAdds.add(id);
    if (this._addTimer) return;
    this._addTimer = setTimeout(() => {
      this._addTimer = null;
      const ids = Array.from(this._pendingAdds);
      this._pendingAdds.clear();
      ids.forEach((gid) => {
        const graphic = this.findGraphic(gid);
        if (graphic) this._publish(graphic);
      });
    }, ADD_SETTLE_MS);
  }

  private _onLocalRemove(g: Graphic): void {
    const id = this._readId(g);
    if (!id) return;
    // Only ever announce the deletion of something we announced the creation of.
    // A symbol class removing its own scratch graphic must not become a g.del —
    // that was the other half of the transient-graphic flood.
    if (!this._hashes.has(id)) {
      clog('remove ignored — never published', id);
      return;
    }
    // updateSymbol removes then re-adds; a remove with the graphic still present
    // elsewhere is a move between layers, not a deletion.
    if (this.findGraphic(id)) return;
    this._pendingAdds.delete(id);
    this._hashes.delete(id);
    this._watched.delete(id);
    this._preEdit.delete(id);
    this.session.send('g.del', { id }, `g:${id}`);
  }

  /**
   * Publish the deletions noticed during a draw, now that the draw is over and
   * the layers have settled. A no-op while a draw is still running, so a
   * multi-click shape defers past each of its own pointer-ups.
   */
  private _flushPendingRemoves(): void {
    if (!this._pendingRemoves.size || this._localDrawActive()) return;
    const ids = Array.from(this._pendingRemoves);
    this._pendingRemoves.clear();
    for (const id of ids) {
      // Back on the map — that was a re-render, not a deletion.
      if (this.findGraphic(id)) continue;
      // Already accounted for: a remote g.del landed, or the ordinary local
      // remove path got there first. Both clear `_hashes`.
      if (!this._hashes.has(id)) continue;
      this._hashes.delete(id);
      this._watched.delete(id);
      this._preEdit.delete(id);
      this._pendingAdds.delete(id);
      clog('deferred remove published', id);
      this.session.send('g.del', { id }, `g:${id}`);
    }
  }

  // ── Observers: mutation ───────────────────────────────────────────────────

  private _attachViewObservers(): void {
    const view = this._view;
    if (!view) return;

    // Every view handler is guarded: these run in the same pointer pipeline the
    // symbol classes and cue engines use, so an exception escaping one of them
    // must never be able to disturb drawing.
    const guard = (fn: (evt: any) => void) => (evt: any) => {
      try {
        fn(evt);
      } catch (err) {
        cerr('view handler failed', err);
      }
    };

    // Commit boundary for drag/scale/rotate/vertex edits.
    this._viewHandles.push(
      view.on(
        'pointer-up',
        guard(() => {
          // After the pointer is released the symbol class may still be rebuilding
          // geometry; one frame is enough for it to land.
          requestAnimationFrame(() => {
            try {
              // Also the backstop for a draw that ended without an onDrawEnd —
              // a cancelled one, say, which leaves the grace window to lapse on
              // its own and so never schedules a drain.
              this._flushPendingRemoves();
              this._diffWatched();
            } catch (err) {
              cerr('commit-boundary diff failed', err);
            }
          });
        }),
      ),
    );

    this._viewHandles.push(
      view.on(
        'pointer-move',
        guard((evt: any) => this._maybeSendCursor(evt)),
      ),
    );
    this._viewHandles.push(
      view.on(
        'pointer-leave',
        guard(() => {
          this._lastCursorSent = 0;
        }),
      ),
    );
  }

  private _detachViewObservers(): void {
    this._viewHandles.forEach((h) => h.remove());
    this._viewHandles = [];
  }

  private _attachSelectionObserver(): void {
    const sel = this._host?.selectionEngine;
    if (!sel?.on) return;
    this._selHandle = sel.on('selectionChange', (data: any) => {
      const selected: Graphic[] = data?.selected ?? [];
      // A selection change is also a commit boundary — the previous selection
      // may have just been dragged.
      this._diffWatched();

      // SelectionEngine assigns ids as it selects, so reading is enough here.
      const ids = selected.map((g) => this._readId(g)).filter(Boolean) as string[];

      // Refuse to hold a selection someone else is editing: every local edit
      // path starts from selection, so dropping it here is what actually
      // enforces the lock.
      if (this._opts.locks) {
        const blocked = ids.filter((id) => this.locks.lockedByOther(id));
        if (blocked.length) {
          const owner = this.locks.ownerOf(blocked[0]);
          CollabPresence.toast(`${owner?.name ?? 'Another user'} is editing this symbol`);
          sel.clearSelection();
          return;
        }
      }

      this._watched = new Set(ids);
      // Baseline for the diff below, taken before the user can edit anything.
      this._capturePreEdit();
      this.locks.claim(ids, 'map');
    });
  }

  /** Re-serialise the watched set and publish whatever actually changed. */
  private _diffWatched(): void {
    if (!this._opts.syncMap || this._applying || !this._watched.size) return;
    for (const id of this._watched) {
      const g = this.findGraphic(id);
      if (!g) continue;
      const now = this._localHash(g);
      // Unchanged since the selection was made or since the last commit — a pan,
      // a click on empty space, or simply selecting somebody else's symbol.
      if (now !== null && now === this._preEdit.get(id)) continue;
      this._publish(g);
      if (now !== null) this._preEdit.set(id, now);
    }
  }

  /** Snapshot the watched set through our own serialiser. */
  private _capturePreEdit(): void {
    this._preEdit.clear();
    if (!this._opts.syncMap) return;
    for (const id of this._watched) {
      const g = this.findGraphic(id);
      if (!g || !this._isShareable(g)) continue;
      const h = this._localHash(g);
      if (h) this._preEdit.set(id, h);
    }
  }

  /**
   * Our serialisation of `g`, or null if it cannot be serialised. Same call
   * `_publish` makes, so the two results are directly comparable; quiet on
   * failure because this only ever feeds a comparison, never the wire.
   */
  private _localHash(g: Graphic): string | null {
    const host = this._host;
    if (!host) return null;
    const id = this._readId(g);
    if (!id) return null;
    try {
      const sym = host.serializationEngine.saveSymbolToJSON(g);
      if (!sym) return null;
      sym.id = id;
      return JSON.stringify(sym);
    } catch {
      return null;
    }
  }

  // ── Observers: in-progress drawing + cursor ───────────────────────────────

  private _attachDrawObservers(): void {
    const onProgress = ((e: Event) => {
      try {
        // Marks the local draw as live regardless of the preview setting: the
        // observers and the apply queue must both stand down during a draw even
        // when previews are switched off.
        this._drawBusyUntil = Date.now() + DRAW_GRACE_MS;
        if (!this._opts.showPreviews) return;
        const detail: any = (e as CustomEvent).detail;
        this._sendPreview(detail?.currentGeometry);
      } catch (err) {
        cerr('draw-progress handler failed', err);
      }
    }) as EventListener;

    const onEnd = (() => {
      try {
        if (this._localPreviewId) {
          this.session.send('preview-end', { pid: this._localPreviewId });
          this._localPreviewId = null;
        }
        // Draw finished — release the queue now rather than waiting out the grace
        // window, so a peer's symbol appears the moment your stroke ends.
        this._drawBusyUntil = 0;
        this._scheduleDrain();
      } catch (err) {
        cerr('draw-end handler failed', err);
      }
    }) as EventListener;

    /**
     * Second, more direct creation trigger. `symbolCreated` is emitted by
     * drawSymEnd itself with the finished Graphic, so it does not depend on the
     * graphics collection reporting the add — and because it is skipped when the
     * draw lifecycle is suppressed, a graphic we rebuilt from a remote op never
     * fires it. _queueAdd is idempotent (a Set keyed by id, then a hash compare),
     * so overlapping with the collection observer costs nothing.
     */
    const onCreated = ((e: Event) => {
      try {
        if (!this._opts.syncMap) {
          clog('symbolCreated ignored — syncMap is', this._opts.syncMap);
          return;
        }
        if (this._applying || this._updating) return;
        const detail: any = (e as CustomEvent).detail;
        const g: Graphic | undefined = detail?.graphic;
        clog('symbolCreated', detail?.id, !!g);
        if (!g) return;
        // The local draw is over — reopen the observers and the apply queue.
        this._drawBusyUntil = 0;
        this._scheduleDrain();
        // Publish straight away: drawSymEnd has finished by the time this fires,
        // so there is nothing to wait for. The settle timer stays on the
        // layer-observer route, where the symbol class may still be working.
        const id = this._readId(g);
        if (id) this._pendingAdds.delete(id);
        this._publish(g);
      } catch (err) {
        cerr('symbolCreated handler failed', err);
      }
    }) as EventListener;

    document.addEventListener('onDrawProgress', onProgress);
    document.addEventListener('onDrawEnd', onEnd);
    document.addEventListener('symbolCreated', onCreated);
    this._docHandlers.push(
      ['onDrawProgress', onProgress],
      ['onDrawEnd', onEnd],
      ['symbolCreated', onCreated],
    );
  }

  private _sendPreview(geometry: any): void {
    if (!geometry) return;
    const pts = MapSync._geometryToLonLat(geometry);
    if (!pts.length) return;
    if (!this._localPreviewId) {
      this._localPreviewId = `${this.session.me.id}-${Date.now().toString(36)}`;
    }
    const kind: PreviewPayload['kind'] =
      geometry.type === 'polygon' ? 'polygon' : geometry.type === 'point' ? 'point' : 'polyline';
    const payload: PreviewPayload = { pid: this._localPreviewId, kind, pts };
    this.session.send('preview', payload);
  }

  private _maybeSendCursor(evt: any): void {
    // Nobody to see it. Worth the check: on the SSE transport this is a POST at
    // `cursorHz`, so a single user sitting alone in a room was pushing 20
    // requests a second at the relay for no reason at all.
    if (!this.session.peerCount) return;
    const hz = Math.max(1, Math.min(60, this._opts.cursorHz));
    const minGap = 1000 / hz;
    const now = Date.now();
    if (now - this._lastCursorSent < minGap) return;
    const view = this._view;
    if (!view) return;
    let mapPt: any;
    try {
      mapPt = (view as any).toMap({ x: evt.x, y: evt.y });
    } catch {
      return;
    }
    const ll = MapSync._toLonLat(mapPt);
    if (!ll) return;
    this._lastCursorSent = now;
    const payload: CursorPayload = {
      lon: ll[0],
      lat: ll[1],
      ...(this._localPreviewId ? { drawing: true } : {}),
    };
    this.session.send('cursor', payload);
  }

  // ── updateSymbol wrap ─────────────────────────────────────────────────────

  /**
   * Wrapping rather than editing SymbolEngine keeps every coupling point inside
   * this folder. The wrap also enforces locks on the patch API, which otherwise
   * bypasses selection entirely.
   */
  private _wrapUpdateSymbol(): void {
    const host: any = this._host;
    if (!host || typeof host.updateSymbol !== 'function') return;
    this._hadOwnUpdateSymbol = Object.prototype.hasOwnProperty.call(host, 'updateSymbol');
    this._rawUpdateSymbol = host.updateSymbol;
    this._origUpdateSymbol = host.updateSymbol.bind(host);
    const self = this;
    const patchedUpdateSymbol = function patchedUpdateSymbol(graphic: Graphic, patch: any) {
      const id = graphic?.attributes?.id;
      if (self._opts.locks && id && self.locks.lockedByOther(id)) {
        const owner = self.locks.ownerOf(id);
        CollabPresence.toast(`${owner?.name ?? 'Another user'} is editing this symbol`);
        return null;
      }
      self._updating = true;
      let result: any;
      try {
        result = self._origUpdateSymbol!(graphic, patch);
      } finally {
        self._updating = false;
      }
      if (!self._applying && self._opts.syncMap) {
        // updateSymbol may replace the Graphic instance; re-find by id.
        const fresh = (id && self.findGraphic(id)) || (result as Graphic) || graphic;
        if (fresh) self._publish(fresh);
      }
      return result;
    };
    this._patchedUpdateSymbol = patchedUpdateSymbol;
    host.updateSymbol = patchedUpdateSymbol;
  }

  /**
   * Restore by DELETING the own property we added, which re-exposes the class
   * method on SymbolEngine's prototype. Assigning the saved reference back would
   * leave a permanent own property (and the bound copy at that), so the raw
   * original is only used if the method really was an own property to begin with.
   */
  private _unwrapUpdateSymbol(): void {
    const host: any = this._host;
    if (host && this._rawUpdateSymbol) {
      if (host.updateSymbol === this._patchedUpdateSymbol) {
        if (this._hadOwnUpdateSymbol) host.updateSymbol = this._rawUpdateSymbol;
        else delete host.updateSymbol;
      }
    }
    this._origUpdateSymbol = null;
    this._rawUpdateSymbol = null;
    this._hadOwnUpdateSymbol = false;
    this._patchedUpdateSymbol = null;
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  /** Serialise `g` and broadcast it if its serialisation changed. */
  private _publish(g: Graphic): void {
    const host = this._host;
    if (!host) return;
    if (!this._isShareable(g)) {
      clog('publish skipped — not a completed symbol');
      return;
    }
    const id = this._ensureId(g);
    if (!id) return;
    let sym: any;
    try {
      sym = host.serializationEngine.saveSymbolToJSON(g);
    } catch (err) {
      cerr(`could not serialise symbol ${id} for sharing`, err);
      EngineLogger.error(
        ENGINE_NAME,
        `Could not serialise a symbol for sharing: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (!sym) {
      cerr(`saveSymbolToJSON returned nothing for ${id}`, null);
      return;
    }
    sym.id = id;
    const hash = JSON.stringify(sym);
    if (this._hashes.get(id) === hash) {
      clog('publish skipped — unchanged', id);
      return;
    }
    this._hashes.set(id, hash);
    clog('publish g.up', id, `${hash.length} bytes`);
    this.session.send('g.up', { sym }, `g:${id}`);
  }

  /** Snapshot every graphic for a late joiner. */
  public collectSnapshot(): any[] {
    const host = this._host;
    if (!host) return [];
    const out: any[] = [];
    for (const layer of this._symbolLayers()) {
      layer.graphics?.forEach((g: Graphic) => {
        if (!this._isShareable(g)) return;
        const id = this._ensureId(g);
        if (!id) return;
        try {
          const sym = host.serializationEngine.saveSymbolToJSON(g);
          if (sym) {
            sym.id = id;
            out.push(sym);
          }
        } catch {
          /* skip an unserialisable graphic rather than fail the snapshot */
        }
      });
    }
    return out;
  }

  // ── Applying remote ops ───────────────────────────────────────────────────

  private _onRemoteUpsert(msg: CollabMsg): void {
    if (!this._opts.syncMap) {
      clog('remote g.up ignored — syncMap is', this._opts.syncMap);
      return;
    }
    const id = msg.d?.sym?.id;
    if (!id) {
      cerr('remote g.up carried no symbol id', msg.d);
      return;
    }
    // The LWW gate runs on ARRIVAL, not on apply, so ordering is decided by the
    // stamp rather than by how long an op happened to sit in the defer queue.
    if (!this.session.accept(`g:${id}`, msg.ts)) {
      clog('remote g.up rejected as stale', id);
      return;
    }
    clog('remote g.up accepted', id);
    this._enqueueApply(id, msg);
  }

  private _applyUpsert(msg: CollabMsg): void {
    const sym = msg.d?.sym;
    if (!sym?.id) return;
    // Already identical locally — skip the rebuild entirely. Catches snapshot
    // overlap and any op that merely restates what we already render, which are
    // the cases where a full initialize() pass would be pure waste.
    if (this._hashes.get(sym.id) === JSON.stringify({ ...sym, id: sym.id })) {
      clog('apply skipped — already identical', sym.id);
      return;
    }
    const g = this.applySymbol(sym);
    clog(g ? 'remote symbol drawn' : 'remote symbol FAILED to draw', sym.id);
  }

  /** Rebuild a graphic from its serialised form, replacing any existing one. */
  public applySymbol(sym: any): Graphic | null {
    const host = this._host;
    if (!host || !sym?.id) return null;
    this._applying = true;
    try {
      const existing = this.findGraphic(sym.id);
      if (existing) this._hardRemove(existing);
      // suppressDrawingLifecycle keeps the rebuild from re-entering the draw
      // pipeline (and from re-broadcasting through the draw observers).
      const g = this._applyPreservingDrawState(() =>
        host.loadSymbolFromJSON({ ...sym, suppressDrawingLifecycle: true }),
      );
      if (g) {
        if (!g.attributes) (g as any).attributes = {};
        g.attributes.id = sym.id;
        this._hashes.set(sym.id, JSON.stringify(sym));
        // If we happen to have this graphic selected (only possible with locks
        // off), rebase the diff baseline onto the rebuilt graphic so the next
        // pointer-up does not read the peer's edit as ours and bounce it back.
        if (this._watched.has(sym.id)) {
          const h = this._localHash(g);
          if (h) this._preEdit.set(sym.id, h);
        }
      }
      return g;
    } catch (err) {
      cerr(`could not draw shared symbol ${sym.id}`, err);
      EngineLogger.error(
        ENGINE_NAME,
        `Could not draw a shared symbol: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      this._applying = false;
    }
  }

  /**
   * Run a rebuild with SymbolEngine's draw-session state saved and restored.
   *
   * THE important fix in this file. `loadSymbolFromJSON()` calls
   * `initialize(de, amp, isPassive = true)`, and although passive mode skips the
   * workflow teardown, `initialize()` still reassigns `sidc`, `amplifier`,
   * `currentSymbol`, `_activeSIDC`, `_activeAmplifier` and `_pendingAttrs`
   * unconditionally. Those are precisely the fields `drawSymEnd()` reads to
   * finish the LOCAL user's draw — the source comment even says they exist "so
   * drawSymEnd() reads from these stable copies even if initialize() is called
   * again before this draw completes".
   *
   * So a peer's symbol arriving while you have a tool armed used to repoint your
   * own half-finished draw at the remote symbol's SIDC and steal its id. Two
   * people drawing at once produced wrong symbols and duplicated ids, which read
   * as "propagates, but not properly".
   *
   * Snapshotting around the call fixes it for every timing, rather than merely
   * making the collision less likely. Doing it here keeps SymbolEngine unedited.
   */
  private _applyPreservingDrawState<T>(fn: () => T): T {
    const h: any = this._host;
    if (!h) return fn();
    const saved: Record<string, unknown> = {};
    for (const k of DRAW_STATE_KEYS) saved[k] = h[k];
    try {
      return fn();
    } finally {
      // Restore after the call: loadSymbolFromJSON reads _lastCreatedGraphic
      // internally and has already returned its result by now.
      for (const k of DRAW_STATE_KEYS) h[k] = saved[k];
    }
  }

  /** True while the local user has a draw in flight. */
  private _localDrawActive(): boolean {
    return Date.now() < this._drawBusyUntil;
  }

  /**
   * Queue a remote op instead of applying it inline, coalescing by graphic id.
   *
   * Applying is expensive: `loadSymbolFromJSON()` runs the full `initialize()`
   * pipeline, the same heavy path used by plan load, paste and programmatic
   * creation. It is not something to run per message. Two things make that
   * affordable:
   *
   *   Coalescing — only the NEWEST op per graphic id survives the queue, so a
   *   burst (a drag publishing several times, a snapshot overlapping live edits,
   *   a peer nudging one symbol repeatedly) costs one rebuild, not N. The LWW
   *   gate already ran on arrival, so dropping superseded ops is safe: they had
   *   older stamps and would have lost anyway.
   *
   *   Draw-gap scheduling — the queue never drains while the local user is
   *   mid-stroke, so a peer's rebuild cannot compete with your own drawing for
   *   the frame.
   */
  private _enqueueApply(id: string, msg: CollabMsg): void {
    this._pendingApplies.set(id, msg); // newest op per id wins
    this._scheduleDrain();
  }

  private _scheduleDrain(): void {
    if (this._drainTimer) return;
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      this._drainApplies();
    }, this._localDrawActive() ? 200 : 0);
  }

  private _drainApplies(): void {
    if (this._localDrawActive()) {
      this._scheduleDrain(); // still drawing — try again in the next gap
      return;
    }
    // The draw is over: whatever was deleted during it is a real deletion now.
    this._flushPendingRemoves();
    if (!this._pendingApplies.size) return;
    const queued = Array.from(this._pendingApplies.values());
    this._pendingApplies.clear();
    clog(`applying ${queued.length} remote op(s)`);
    for (const msg of queued) {
      if (msg.t === 'g.up') this._applyUpsert(msg);
      else if (msg.t === 'g.del') this._applyDelete(msg);
    }
  }

  private _onRemoteDelete(msg: CollabMsg): void {
    if (!this._opts.syncMap) return;
    const id = msg.d?.id;
    if (!id) return;
    if (!this.session.accept(`g:${id}`, msg.ts)) {
      clog('remote g.del rejected as stale', id);
      return;
    }
    // Same queue as upserts, keyed by the same id: a delete arriving after an
    // edit supersedes that edit instead of both rebuilding then removing.
    this._enqueueApply(id, msg);
  }

  private _applyDelete(msg: CollabMsg): void {
    const id = msg.d?.id;
    if (!id) return;
    const g = this.findGraphic(id);
    this._hashes.delete(id);
    this._watched.delete(id);
    this._preEdit.delete(id);
    if (!g) return;
    this._applying = true;
    try {
      this._hardRemove(g);
      clog('remote symbol removed', id);
    } finally {
      this._applying = false;
    }
  }

  /**
   * Remove a graphic and its dependents. Mirrors SymbolEngine's own private
   * removeGraphic minus the undo entry — a peer's deletion belongs on their
   * undo stack, not ours.
   */
  private _hardRemove(g: Graphic): void {
    const lm = this._host?.layerManager;
    // `graphic.layer` is what the SDK sets when a graphic is added to a
    // GraphicsLayer; `graphic.origin` is only populated for features from a
    // FeatureLayer query and has no `.layer` — see SymbolEngine's
    // _resolveGraphicLayer, which documents the same trap. Reading only `origin`
    // meant this always fell through to the layer scan below, which removes the
    // graphic but never runs removeMinefieldTextureForGraphic, so a peer's
    // deletion left the minefield texture fill behind.
    const layer = ((g as any).layer ?? (g as any).origin?.layer ?? null) as GraphicsLayer | null;
    const id = g.attributes?.id;
    if (layer) {
      try {
        removeMinefieldTextureForGraphic(layer, g);
      } catch {
        /* not a minefield */
      }
      layer.remove(g);
    } else if (lm) {
      for (const l of this._symbolLayers()) l.remove(g);
    }
    if (id && lm) {
      try {
        AnnotationEngine.deAnnotate(lm.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER), id);
      } catch {
        /* no labels */
      }
    }
  }

  private _onRemoteCursor(msg: CollabMsg): void {
    const d: CursorPayload | undefined = msg.d;
    if (!d || typeof d.lon !== 'number' || typeof d.lat !== 'number') return;
    this.presence.updateCursor(
      msg.from,
      this.session.nameOf(msg.from),
      this.session.colorOf(msg.from),
      d.lon,
      d.lat,
      d.drawing === true,
    );
  }

  private _onRemotePreview(msg: CollabMsg): void {
    const d: PreviewPayload | undefined = msg.d;
    if (!d?.pid || !Array.isArray(d.pts)) return;
    this.presence.setPreview(
      msg.from,
      this.session.colorOf(msg.from),
      d.pid,
      d.kind ?? 'polyline',
      d.pts,
      d.label,
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Find a graphic by attributes.id across every symbol layer. */
  public findGraphic(id: string): Graphic | null {
    for (const layer of this._symbolLayers()) {
      const found = layer.graphics?.find((g: Graphic) => g.attributes?.id === id);
      if (found) return found;
    }
    return null;
  }

  /**
   * Read a graphic's id WITHOUT touching the graphic. Observers must use this.
   *
   * Symbol classes render their in-progress preview by adding a scratch graphic
   * straight into the layer we observe — PhaseLine, for one, adds `tempGraphic`
   * to LAYER_NAMES.TACT on every pointer move and removes it again. Assigning an
   * id to one of those, or replacing a null `attributes` on it, means mutating
   * another component's private object in the middle of its draw. That is what
   * broke the local drawing preview whenever collaboration was enabled.
   */
  private _readId(g: Graphic | null | undefined): string | null {
    const id = g?.attributes?.id;
    return typeof id === 'string' && id ? id : null;
  }

  /**
   * True when a graphic is a finished symbol worth sharing, rather than a symbol
   * class's in-progress scratch graphic. Every real symbol carries
   * `drawEssentials`; a transient preview does not survive the draw, so
   * publishing one is always wrong — and publishing one per pointer-move is what
   * flooded the wire and made the receiver rebuild garbage through the full
   * initialize() pipeline.
   */
  private _isShareable(g: Graphic | null | undefined): boolean {
    return !!g?.attributes?.drawEssentials && !!g.geometry;
  }

  /**
   * Id for publishing, assigned only if absent. Safe here because the caller has
   * already established this is a real symbol: SelectionEngine assigns lazily on
   * first selection, and sync cannot wait that long — an id-less graphic has no
   * identity for peers to converge on. Never fabricates `attributes`.
   */
  private _ensureId(g: Graphic): string | null {
    const existing = this._readId(g);
    if (existing) return existing;
    if (!g?.attributes) return null;
    const c: any = (globalThis as any).crypto;
    g.attributes.id = c?.randomUUID
      ? c.randomUUID()
      : `sym-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return g.attributes.id as string;
  }

  /**
   * Record current state as already-published, so enabling collab is silent.
   * Read-only on purpose: turning the feature on must not modify a single
   * existing graphic, so anything without an id yet is simply skipped and picked
   * up the first time it is edited.
   */
  private _seedHashes(): void {
    const host = this._host;
    if (!host) return;
    for (const layer of this._symbolLayers()) {
      layer.graphics?.forEach((g: Graphic) => {
        if (!this._isShareable(g)) return;
        const id = this._readId(g);
        if (!id) return;
        try {
          const sym = host.serializationEngine.saveSymbolToJSON(g);
          if (sym) {
            sym.id = id;
            this._hashes.set(id, JSON.stringify(sym));
          }
        } catch {
          /* ignore */
        }
      });
    }
  }

  private static _toLonLat(pt: any): [number, number] | null {
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

  /** Flatten any geometry to WGS84 [lon,lat] pairs, capped for the wire. */
  private static _geometryToLonLat(geometry: any): Array<[number, number]> {
    if (!geometry) return [];
    let geom: any = geometry;
    if (geom.spatialReference?.isWebMercator) {
      try {
        geom = webMercatorUtils.webMercatorToGeographic(geom);
      } catch {
        return [];
      }
    }
    let raw: number[][] = [];
    if (geom.type === 'point') {
      const ll = MapSync._toLonLat(geom);
      return ll ? [ll] : [];
    }
    if (geom.type === 'polyline') raw = geom.paths?.[0] ?? [];
    else if (geom.type === 'polygon') raw = geom.rings?.[0] ?? [];
    else if (Array.isArray(geom)) raw = geom;
    if (!raw.length) return [];

    // Even sampling keeps the shape recognisable; the first and last vertices
    // always survive so the preview tracks the live cursor.
    const step = raw.length > PREVIEW_MAX_PTS ? Math.ceil(raw.length / PREVIEW_MAX_PTS) : 1;
    const out: Array<[number, number]> = [];
    for (let i = 0; i < raw.length; i += step) {
      const p = raw[i];
      if (Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])) {
        out.push([Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);
      }
    }
    const last = raw[raw.length - 1];
    if (step > 1 && Number.isFinite(last?.[0])) {
      out.push([Number(last[0].toFixed(6)), Number(last[1].toFixed(6))]);
    }
    return out;
  }
}
