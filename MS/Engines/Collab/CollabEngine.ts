/**
 * CollabEngine.ts
 *
 * Multi-user collaboration for the map and the briefing deck. Opt-in via
 * Settings.json → `features.collab`.
 *
 * Design constraint this engine is built around: it must be removable. Deleting
 * MS/Engines/Collab/ and setting `features.collab: false` returns the app to
 * exactly its previous behaviour. Nothing outside this folder is edited except
 * one dynamic import in SymbolEngine (the same pattern MeasurementEngine,
 * BriefingEngine and ScreenAnchorEngine already use) and the relay middleware
 * registration in vite.config.ts.
 *
 * Composition:
 *
 *   CollabTransport   SSE + POST against a same-origin relay, or
 *                     BroadcastChannel for multi-window on one machine.
 *   CollabSession     Identity, roster, heartbeat, HLC + last-write-wins gate.
 *   CollabLocks       Soft, expiring per-object locks.
 *   CollabPresence    Cursors, trails, previews, lock badges.
 *   CollabRosterBar   Who is online.
 *   MapSync           Graphics in / out, without touching SymbolEngine.
 *   SlideSync         Deck + in-slide objects, without touching SlideEditor.
 *   CollabSnapshot    Late-joiner catch-up, peer-served.
 *
 * Public API (also on `window.collabEngine`):
 *   engine.collabEngine.enable() / .disable() / .isEnabled
 *   engine.collabEngine.setUserName('Maj Ali')
 *   engine.collabEngine.roster       → [{ id, name, color }]
 *   engine.collabEngine.status       → 'open' | 'connecting' | 'error' | 'closed'
 */

import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';

import EngineLogger from '../../Support/EngineLogger';
import { onSettingsChanged } from '../../Support/SettingsBus';
import settingsData from '../../Data/Settings.json';
import { cerr, clog, mergeDefined, setCollabDebug } from './CollabDebug';
import CollabLocks from './CollabLocks';
import CollabPresence from './CollabPresence';
import CollabRosterBar from './CollabRosterBar';
import CollabActivity from './CollabActivity';
import CollabChat from './CollabChat';
import CollabSession, { type Peer } from './CollabSession';
import CollabSnapshot from './CollabSnapshot';
import MapSync, { type MapSyncHost } from './MapSync';
import PresentInkLayer from './PresentInkLayer';
import PresentSync from './PresentSync';
import SlideSync from './SlideSync';
import ViewSync from './ViewSync';
import type { TransportStatus } from './CollabTransport';
import type { CollabUser } from './CollabTypes';

const ENGINE_NAME = 'Collab Engine';

export interface CollabSettings {
  transport: string;
  relayUrl: string;
  room: string;
  userName: string;
  showCursors: boolean;
  showTrails: boolean;
  trailLength: number;
  showPreviews: boolean;
  showLocks: boolean;
  cursorHz: number;
  locks: boolean;
  lockTtlMs: number;
  syncMap: boolean;
  syncSlides: boolean;
  slideImageMaxKb: number;
  /** Shared map view — everyone pans and zooms together. */
  syncView: boolean;
  /** Shared briefing — one person drives the deck and the room follows. */
  sharePresentation: boolean;
  /** Share the briefer's laser / pen / spotlight mark-up. */
  shareInk: boolean;
  /** Draw "look here" pings from peers. */
  showPings: boolean;
  /** Broadcast our own extent so peers can see where we are looking. */
  shareViewport: boolean;
  /** Draw peers' extents as rectangles. Off by default — it is visual clutter. */
  showViewports: boolean;
  /** Room chat. */
  chat: boolean;
  /** Who-did-what lines into the Engine Log. */
  activityLog: boolean;
  /** Shared secret for the relay. '' leaves it unauthenticated, as documented. */
  token: string;
  showRoster: boolean;
  /** Verbose console tracing — see CollabDebug.ts. */
  debug: boolean;
}

const DEFAULTS: CollabSettings = {
  transport: 'sse',
  relayUrl: '',
  room: 'default',
  userName: '',
  showCursors: true,
  showTrails: true,
  trailLength: 8,
  showPreviews: true,
  showLocks: true,
  cursorHz: 20,
  locks: true,
  lockTtlMs: 10000,
  syncMap: true,
  syncSlides: true,
  slideImageMaxKb: 256,
  syncView: false,
  sharePresentation: true,
  shareInk: true,
  showPings: true,
  shareViewport: true,
  showViewports: false,
  chat: true,
  activityLog: true,
  token: '',
  showRoster: true,
  debug: false,
};

export default class CollabEngine {
  private static _instance: CollabEngine | null = null;

  private _host: MapSyncHost | null = null;
  private _cfg: CollabSettings = { ...DEFAULTS };

  private _session: CollabSession | null = null;
  private _locks: CollabLocks | null = null;
  private _presence: CollabPresence | null = null;
  private _roster: CollabRosterBar | null = null;
  private _mapSync: MapSync | null = null;
  private _slideSync: SlideSync | null = null;
  private _viewSync: ViewSync | null = null;
  private _snapshot: CollabSnapshot | null = null;
  private _presentSync: PresentSync | null = null;
  private _inkLayer: PresentInkLayer | null = null;
  private _chat: CollabChat | null = null;
  private _activity: CollabActivity | null = null;

  private _enabled = false;
  private _offSettings: (() => void) | null = null;
  private _offRoster: (() => void) | null = null;
  private _offStatus: (() => void) | null = null;
  /**
   * Bumped by every enable()/disable(). `_initSlideSync` awaits a dynamic import
   * and checks this afterwards, so an init still in flight when the session is
   * torn down and rebuilt (changing the room, or fast-toggling the master switch)
   * abandons itself instead of installing a second set of SlideEditor wrappers
   * on top of the new ones — which published every in-slide edit twice and left
   * the first set permanently attached.
   */
  private _generation = 0;

  private constructor() {}

  public static getInstance(): CollabEngine {
    if (!CollabEngine._instance) CollabEngine._instance = new CollabEngine();
    return CollabEngine._instance;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Bind the engine to the host (SymbolEngine) without connecting. Call
   * `enable()` to join the room.
   */
  public start(host: unknown): void {
    this._host = host as MapSyncHost;
    this._cfg = CollabEngine._readSettings();
    // Own our settings rather than having SymbolEngine route them here — one
    // less thing to unpick if the engine is removed.
    this._offSettings ??= onSettingsChanged(({ fullPath, value }) =>
      this.onSettingChanged(fullPath, value),
    );
    EngineLogger.success(ENGINE_NAME, 'Collaboration ready (not yet connected)');
  }

  public get isEnabled(): boolean {
    return this._enabled;
  }

  public enable(): void {
    if (this._enabled) return;
    const host = this._host;
    if (!host?.view) {
      EngineLogger.error(ENGINE_NAME, 'Cannot enable collaboration before the view exists');
      return;
    }
    this._cfg = CollabEngine._readSettings();
    const generation = ++this._generation;

    const session = new CollabSession({
      room: this._cfg.room || 'default',
      transport: this._cfg.transport,
      relayUrl: this._cfg.relayUrl,
      userName: this._cfg.userName,
      token: this._cfg.token,
    });
    this._session = session;

    const locks = new CollabLocks(session);
    this._locks = locks;

    const presence = new CollabPresence();
    this._presence = presence;

    const mapSync = new MapSync(session, locks, presence);
    this._mapSync = mapSync;

    presence.start(
      host.view,
      { findGraphic: (id) => mapSync.findGraphic(id), colorOf: (id) => session.colorOf(id) },
      {
        showCursors: this._cfg.showCursors,
        showTrails: this._cfg.showTrails,
        trailLength: this._cfg.trailLength,
        showPreviews: this._cfg.showPreviews,
        showLocks: this._cfg.showLocks,
        showPings: this._cfg.showPings,
        showViewports: this._cfg.showViewports,
      },
    );

    locks.start({ ttlMs: this._cfg.lockTtlMs, enabled: this._cfg.locks });
    // Map scope only — a slide-object id can never match a map graphic.
    locks.onChange(() => presence.setLocks(locks.remoteLocks('map')));

    mapSync.start(host, {
      syncMap: this._cfg.syncMap,
      showPreviews: this._cfg.showPreviews,
      cursorHz: this._cfg.cursorHz,
      locks: this._cfg.locks,
      shareViewport: this._cfg.shareViewport,
    });

    if (this._cfg.chat) {
      const chat = new CollabChat(session);
      chat.start();
      chat.onChange(() => this._refreshRosterChat());
      this._chat = chat;
    }

    if (this._cfg.activityLog) {
      const activity = new CollabActivity(session);
      activity.start({ enabled: true });
      this._activity = activity;
    }

    const viewSync = new ViewSync(session);
    this._viewSync = viewSync;
    /**
     * Guarded because this runs BEFORE session.connect() below. Shared view is an
     * optional extra; an exception setting it up (an SDK event name this view
     * type does not support, say) must not be able to stop the room being joined
     * at all — which is exactly the kind of failure that looks like "collab is
     * completely dead" and hides its own cause.
     */
    try {
      viewSync.start(host.view, { syncView: this._cfg.syncView });
      // Toggling from the chip is a live control, not a settings edit, so mirror
      // the resulting state back into cfg + Settings.json to keep the ⚙ menu and
      // the palette showing the truth.
      viewSync.onChange(() => {
        this._cfg.syncView = viewSync.isSyncing;
        const root: any = (settingsData as any).collab ?? ((settingsData as any).collab = {});
        root.syncView = viewSync.isSyncing;
        this._refreshRosterView();
      });
    } catch (err) {
      cerr('view sync failed to start — continuing without it', err);
      EngineLogger.error(
        ENGINE_NAME,
        `Shared view unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      this._viewSync = null;
    }

    /**
     * Shared briefing. Constructed whenever BriefingEngine is present, even with
     * `sharePresentation` off, because the flag is an option PresentSync already
     * honours everywhere — building it unconditionally means toggling the setting
     * live works without a second construction path here.
     *
     * Guarded for the same reason shared view is: an optional extra must not be
     * able to stop the room being joined.
     */
    const briefing = (host as any)?.briefingEngine;
    if (briefing) {
      try {
        const inkLayer = new PresentInkLayer();
        inkLayer.start(host.view);
        this._inkLayer = inkLayer;
        const presentSync = new PresentSync(session, inkLayer);
        presentSync.start(briefing, {
          sharePresentation: this._cfg.sharePresentation,
          shareInk: this._cfg.shareInk,
        });
        presentSync.onChange(() => this._refreshRosterPresent());
        this._presentSync = presentSync;
      } catch (err) {
        cerr('shared briefing failed to start — continuing without it', err);
        EngineLogger.error(
          ENGINE_NAME,
          `Shared briefing unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
        this._presentSync = null;
        this._inkLayer?.destroy();
        this._inkLayer = null;
      }
    }

    if (this._cfg.showRoster) this._mountRoster();

    // A departing peer takes its cursor, trail and previews with it. A peer that
    // vanishes without saying goodbye is handled by Presence's own staleness
    // timer, so this only covers the clean exit.
    session.on('bye', (m) => presence.removePeer(m.from));

    session.connect();

    this._enabled = true;
    EngineLogger.success(
      ENGINE_NAME,
      `Joined room "${this._cfg.room}" as ${session.me.name} via ${session.transportKind}`,
    );

    // Slides and snapshot come up after the map so a snapshot has somewhere to land.
    void this._initSlideSync(generation).then(() => {
      if (generation !== this._generation || !this._enabled || !this._session) return;
      // Chat rides along as the snapshot's optional ChatPort, so a late joiner is
      // handed the last few lines by the same peer that serves its symbols.
      this._snapshot = new CollabSnapshot(
        this._session,
        this._mapSync,
        this._slideSync,
        this._chat,
      );
      this._snapshot.start();
    });
  }

  /** Mount the roster chip and remember how to detach its listeners again. */
  private _mountRoster(): void {
    const session = this._session;
    if (!session || this._roster) return;
    const bar = new CollabRosterBar(session.me, this._cfg.room);
    bar.mount();
    bar.setPeers(session.peers, session.incompatibleCount);
    bar.setStatus(session.status);
    this._roster = bar;
    this._offRoster = session.onRoster((peers: Peer[]) =>
      bar.setPeers(peers, session.incompatibleCount),
    );
    this._offStatus = session.onStatus((s: TransportStatus, d?: string) => bar.setStatus(s, d));
    bar.onToggleSync(() => this._viewSync?.toggleSync());
    bar.onFollowPeer((id) => this._viewSync?.follow(id));
    // The chip's menu is the live control surface; the full manifest panel is the
    // same widget the ⚙ menu and Ctrl+K already open, imported lazily so a build
    // without the settings surface still links.
    bar.onOpenSettings(() => {
      void import('./CollabSettingsWidget')
        .then((m) => m.openCollabSettings())
        .catch((err) => cerr('could not open the collaboration settings panel', err));
    });
    bar.onTogglePodium(() => this._presentSync?.togglePodium());
    bar.onJoinPresentation(() => this._presentSync?.joinPresentation());
    bar.onRejoin(() => this._presentSync?.rejoin());
    bar.onToggleChat(() => {
      if (!this._chat) {
        CollabPresence.toast('Room chat is switched off');
        return;
      }
      this._chat.toggle();
      this._refreshRosterChat();
    });
    bar.onPing(() => {
      this._mapSync?.armPing();
      bar.setPingArmed(this._mapSync?.pingArmed ?? false);
    });
    this._refreshRosterView();
    this._refreshRosterPresent();
    this._refreshRosterChat();
  }

  private _refreshRosterView(): void {
    const vs = this._viewSync;
    if (!this._roster || !vs) return;
    this._roster.setViewState({ syncing: vs.isSyncing, following: vs.following });
  }

  private _refreshRosterPresent(): void {
    const ps = this._presentSync;
    if (!this._roster) return;
    this._roster.setPresentState({
      briefer: ps?.briefer ?? null,
      isBriefer: ps?.isBriefer ?? false,
      detached: ps?.detached ?? false,
      brieferActive: ps?.brieferActive ?? false,
    });
  }

  private _refreshRosterChat(): void {
    if (!this._roster) return;
    this._roster.setChatState({
      unread: this._chat?.unread ?? 0,
      open: this._chat?.isOpen ?? false,
    });
  }

  private _unmountRoster(): void {
    this._offRoster?.();
    this._offStatus?.();
    this._offRoster = null;
    this._offStatus = null;
    this._roster?.unmount();
    this._roster = null;
  }

  public disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._generation++;
    this._snapshot?.destroy();
    this._slideSync?.destroy();
    // Before the session goes: PresentSync hands the podium back on the way out,
    // which needs a live transport.
    this._presentSync?.destroy();
    this._inkLayer?.destroy();
    this._chat?.destroy();
    this._activity?.destroy();
    this._viewSync?.destroy();
    this._mapSync?.destroy();
    this._locks?.destroy();
    this._presence?.destroy();
    this._unmountRoster();
    this._session?.disconnect();
    this._snapshot = null;
    this._slideSync = null;
    this._presentSync = null;
    this._inkLayer = null;
    this._chat = null;
    this._activity = null;
    this._viewSync = null;
    this._mapSync = null;
    this._locks = null;
    this._presence = null;
    this._session = null;
    EngineLogger.success(ENGINE_NAME, 'Left the collaboration room');
  }

  public destroy(): void {
    this.disable();
    this._offSettings?.();
    this._offSettings = null;
    this._host = null;
  }

  public onViewChanged(view: MapView | SceneView): void {
    if (!this._enabled) return;
    this._presence?.onViewChanged(view);
    this._mapSync?.onViewChanged(view);
    this._viewSync?.onViewChanged(view);
    // The peer-ink canvas lives in the view container, so it has to move with it.
    this._inkLayer?.onViewChanged(view);
  }

  /**
   * Slide sync needs BriefingEngine, which is itself optional and lazily loaded.
   * Imported dynamically so a deployment with briefing disabled never pays for
   * the slide editor.
   */
  private async _initSlideSync(generation: number): Promise<void> {
    if (!this._cfg.syncSlides || !this._session || !this._locks) return;
    if (this._slideSync) {
      this._slideSync.setOptions({
        syncSlides: this._cfg.syncSlides,
        locks: this._cfg.locks,
        showLocks: this._cfg.showLocks,
        imageMaxKb: this._cfg.slideImageMaxKb,
      });
      this._snapshot?.setSlideSync(this._slideSync);
      return;
    }
    const briefing = (this._host as any)?.briefingEngine;
    if (!briefing) {
      EngineLogger.success(ENGINE_NAME, 'Briefing disabled — sharing map only');
      return;
    }
    try {
      const { default: SlideEditor } = await import('../Briefing/SlideEditor');
      // The session we were started for is gone — installing wrappers now would
      // double-wrap whatever the replacement session already installed.
      if (generation !== this._generation) {
        clog('slide sync init abandoned — session was replaced mid-import');
        return;
      }
      if (!this._session || !this._locks) return;
      const sync = new SlideSync(this._session, this._locks);
      sync.start(briefing, SlideEditor.getInstance(), {
        syncSlides: this._cfg.syncSlides,
        locks: this._cfg.locks,
        showLocks: this._cfg.showLocks,
        imageMaxKb: this._cfg.slideImageMaxKb,
      });
      this._slideSync = sync;
      this._snapshot?.setSlideSync(sync);
      EngineLogger.success(ENGINE_NAME, 'Slide co-editing active');
    } catch (err) {
      EngineLogger.error(
        ENGINE_NAME,
        `Slide co-editing unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  private static _readSettings(): CollabSettings {
    const raw = ((settingsData as any).collab ?? {}) as Partial<CollabSettings>;
    // mergeDefined, not spread: a key present-but-undefined would otherwise
    // overwrite its default with undefined and silently disable that feature.
    const cfg = mergeDefined(DEFAULTS, raw);
    // ?room= beats the remembered room beats Settings.json — the settings module
    // is rebuilt on every reload, so on its own it cannot remember anything.
    cfg.room = CollabSession.loadRoom(cfg.room);
    setCollabDebug(cfg.debug === true);
    clog('settings resolved', cfg);
    return cfg;
  }

  /**
   * Live settings. Presentation flags apply in place; anything that defines the
   * connection itself (room, transport, relay) needs a reconnect, which we do
   * transparently.
   */
  public onSettingChanged(fullPath: string, value: unknown): void {
    if (fullPath === 'features.collab') {
      if (value === true) this.enable();
      else this.disable();
      return;
    }
    if (!fullPath.startsWith('collab.')) return;

    const key = fullPath.slice('collab.'.length) as keyof CollabSettings;
    (this._cfg as any)[key] = value;
    // Mirror into the loaded settings object so a later enable() sees it.
    const root: any = (settingsData as any).collab ?? ((settingsData as any).collab = {});
    root[key] = value;
    // …and outlive the reload, which the imported JSON module cannot.
    if (key === 'room') CollabSession.rememberRoom(String(value ?? '').trim() || 'default');

    if (!this._enabled) return;

    switch (key) {
      case 'room':
      case 'transport':
      case 'relayUrl':
      // The token is part of the connection: it rides on the stream URL, so it
      // only takes effect on a fresh EventSource.
      case 'token':
        EngineLogger.success(ENGINE_NAME, 'Reconnecting with new connection settings');
        this.disable();
        this.enable();
        return;
      case 'userName':
        this._session?.setUserName(String(value ?? ''));
        this._roster?.setPeers(
          this._session?.peers ?? [],
          this._session?.incompatibleCount ?? 0,
        );
        return;
      case 'showCursors':
      case 'showTrails':
      case 'trailLength':
      case 'showPreviews':
      case 'showLocks':
      case 'showPings':
      case 'showViewports':
        this._presence?.setOptions({
          showCursors: this._cfg.showCursors,
          showTrails: this._cfg.showTrails,
          trailLength: this._cfg.trailLength,
          showPreviews: this._cfg.showPreviews,
          showLocks: this._cfg.showLocks,
          showPings: this._cfg.showPings,
          showViewports: this._cfg.showViewports,
        });
        this._mapSync?.setOptions({ showPreviews: this._cfg.showPreviews });
        // Slide objects carry the same badge on the editor canvas, so the one
        // setting governs both surfaces.
        this._slideSync?.setOptions({ showLocks: this._cfg.showLocks });
        return;
      case 'locks':
      case 'lockTtlMs':
        this._locks?.setOptions({ enabled: this._cfg.locks, ttlMs: this._cfg.lockTtlMs });
        this._mapSync?.setOptions({ locks: this._cfg.locks });
        this._slideSync?.setOptions({ locks: this._cfg.locks });
        return;
      case 'cursorHz':
      case 'syncMap':
      case 'shareViewport':
        this._mapSync?.setOptions({
          cursorHz: this._cfg.cursorHz,
          syncMap: this._cfg.syncMap,
          shareViewport: this._cfg.shareViewport,
        });
        return;
      case 'sharePresentation':
      case 'shareInk':
        this._presentSync?.setOptions({
          sharePresentation: this._cfg.sharePresentation,
          shareInk: this._cfg.shareInk,
        });
        this._refreshRosterPresent();
        return;
      case 'chat':
        this._setChatEnabled(value === true);
        return;
      case 'activityLog':
        this._activity?.setOptions({ enabled: value === true });
        if (value === true && !this._activity && this._session) {
          const activity = new CollabActivity(this._session);
          activity.start({ enabled: true });
          this._activity = activity;
        }
        return;
      case 'syncView':
        this._viewSync?.setOptions({ syncView: value === true });
        this._refreshRosterView();
        return;
      case 'syncSlides':
      case 'slideImageMaxKb':
        if (this._cfg.syncSlides && !this._slideSync) {
          void this._initSlideSync(this._generation);
          return;
        }
        this._slideSync?.setOptions({
          syncSlides: this._cfg.syncSlides,
          imageMaxKb: this._cfg.slideImageMaxKb,
        });
        return;
      case 'debug':
        setCollabDebug(value === true);
        return;
      case 'showRoster':
        if (value === false) this._unmountRoster();
        else this._mountRoster();
        return;
      default:
        return;
    }
  }

  /**
   * Chat is started and torn down rather than gated by a flag, so a user who has
   * switched it off pays for no listener and holds no scrollback. The snapshot
   * already holds its own reference, so it is re-pointed here too.
   */
  private _setChatEnabled(on: boolean): void {
    if (!on) {
      this._chat?.destroy();
      this._chat = null;
      this._snapshot?.setChat(null);
      this._refreshRosterChat();
      return;
    }
    if (this._chat || !this._session) return;
    const chat = new CollabChat(this._session);
    chat.start();
    chat.onChange(() => this._refreshRosterChat());
    this._chat = chat;
    this._snapshot?.setChat(chat);
    this._refreshRosterChat();
  }

  // ── Public conveniences ───────────────────────────────────────────────────

  public setUserName(name: string): void {
    this._session?.setUserName(name);
  }

  /**
   * Ask the room for its state again — for when a client suspects it has drifted
   * (an outage that outlasted the transport's replay queue, say).
   *
   * Merge-only: it recovers objects you are MISSING, not local copies that are
   * stale, because a snapshot carries no HLC stamps to arbitrate against.
   */
  public resync(): void {
    if (!this._enabled || !this._snapshot) {
      EngineLogger.error(ENGINE_NAME, 'Not connected — nothing to resync');
      return;
    }
    this._snapshot.resync();
  }

  /** Drop a "look here" marker at the centre of the current view. */
  public pingHere(): void {
    this._mapSync?.pingViewCentre();
  }

  /** Arm a one-shot ping: the next click on the map drops it. */
  public armPing(): void {
    this._mapSync?.armPing();
    this._roster?.setPingArmed(this._mapSync?.pingArmed ?? false);
  }

  public takePodium(): void {
    this._presentSync?.takePodium();
  }

  public releasePodium(): void {
    this._presentSync?.releasePodium();
  }

  public sendChat(text: string): void {
    this._chat?.send(text);
  }

  public get chat(): CollabChat | null {
    return this._chat;
  }

  public get presentSync(): PresentSync | null {
    return this._presentSync;
  }

  public get roster(): CollabUser[] {
    const me = this._session?.me;
    const peers = this._session?.peers.map((p) => p.user) ?? [];
    return me ? [me, ...peers] : peers;
  }

  public get status(): TransportStatus {
    return this._session?.status ?? 'closed';
  }

  public get session(): CollabSession | null {
    return this._session;
  }

  public get viewSync(): ViewSync | null {
    return this._viewSync;
  }

  /**
   * One-shot health report — `window.collabEngine.diagnose()`.
   *
   * Collaboration fails quietly by nature: a message never sent looks exactly
   * like a message never received, and both look like "nothing happens". This
   * prints the state of every link in the chain at once, so a single call in each
   * window says which one is broken instead of requiring a guess. Pair it with
   * `collab.debug: true` (or `window.collabDebug(true)`) for the per-message trace.
   */
  public diagnose(): Record<string, unknown> {
    const s = this._session;
    return {
      enabled: this._enabled,
      status: this.status,
      transport: s?.transportKind ?? 'none',
      room: this._cfg.room,
      me: s ? `${s.me.name} (${s.me.id})` : null,
      peers: s?.peers.map((p) => `${p.user.name} (${p.user.id})${p.known ? '' : ' [provisional]'}`) ?? [],
      peerCount: s?.peerCount ?? 0,
      incompatiblePeers: s?.incompatibleCount ?? 0,
      // The two questions people actually have.
      sharedViewOn: this._viewSync?.isSyncing ?? false,
      following: this._viewSync?.following ?? null,
      syncMap: this._cfg.syncMap,
      syncSlides: this._cfg.syncSlides,
      slideSyncActive: !!this._slideSync,
      // Shared briefing — who is driving, and whether we are still with them.
      sharePresentation: this._cfg.sharePresentation,
      presentSyncActive: !!this._presentSync,
      briefer: this._presentSync?.briefer
        ? `${s?.nameOf(this._presentSync.briefer)} (${this._presentSync.briefer})`
        : null,
      iAmBriefing: this._presentSync?.isBriefer ?? false,
      detachedFromBriefer: this._presentSync?.detached ?? false,
      shareViewport: this._cfg.shareViewport,
      showViewports: this._cfg.showViewports,
      chatActive: !!this._chat,
      chatUnread: this._chat?.unread ?? 0,
      activityLog: !!this._activity,
      relayTokenSet: !!this._cfg.token,
      rosterChipMounted: !!this._roster,
      debugTracing: this._cfg.debug,
      hint:
        s && s.peerCount === 0
          ? 'No peers. Check both windows report the same room, and that the relay answers: curl http://localhost:6547/collab/health'
          : this._viewSync?.isSyncing
            ? 'Shared view is on. If a pan does not propagate, the other peer may still hold the 1.5s baton.'
            : 'Shared view is OFF — click the link button on the online chip, or set collab.syncView.',
    };
  }
}
