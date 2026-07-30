/**
 * CollabRosterBar.ts
 *
 * The collaboration chip: who is in this room, and the live controls for it.
 *
 * Two surfaces, one component:
 *
 *   Chip (collapsed)  Status dot, count, and a stack of coloured initials — the
 *                     colour of a cursor on the map is immediately attributable
 *                     to a name. Carries its own one-click shared-view toggle so
 *                     the common action never costs a menu.
 *
 *   Menu (expanded)   Shared-view state, one row per person (click to follow
 *                     their view), and the way through to the full settings
 *                     panel.
 *
 * The menu deliberately reuses the REAL `.ms-settings-menu` / `.ms-sm-*` classes
 * from MS/Styles/Widgets.css rather than restyling a lookalike. That stylesheet is
 * loaded globally, so this is the same component the ⚙ menu and the context menu
 * use: identical metrics, identical hover language, and it picks up all five
 * ThemeManager themes with no code here. Approximating it would drift the moment
 * anyone touched Widgets.css.
 *
 * Everything this file adds of its own — the chip itself — is themed through the
 * `--ms-*` custom properties ThemeManager publishes on :root. Nothing is
 * hardcoded, which is what the previous version got wrong: it used a fixed dark
 * blue-grey palette and stayed that way on Night Vision, Sandstorm, Arctic and
 * SIPR while every other panel changed.
 *
 * Self-contained DOM and CSS: the engine adds no markup to index.html, and
 * disabling collab removes the chip with it.
 */

import CollabPresence from './CollabPresence';
import type { Peer } from './CollabSession';
import type { TransportStatus } from './CollabTransport';
import type { ClientId, CollabUser } from './CollabTypes';

const BAR_ID = 'ms-collab-roster';
const MENU_ID = 'ms-collab-menu';
const STYLE_ID = 'ms-collab-roster-style';
/**
 * Collapsed state, per browser profile. A rail the user tucked away must stay
 * tucked away across reloads, or collapsing it is pointless.
 */
const COLLAPSE_KEY = 'pams8.collab.railCollapsed';

/** What the chip needs to know about shared briefing. */
export interface PresentChipState {
  /** Who holds the podium, or null when it is vacant. */
  briefer: ClientId | null;
  isBriefer: boolean;
  /** True when a peer is briefing and we have navigated away from them. */
  detached: boolean;
  /** True when the briefer is actually in present mode, not merely holding it. */
  brieferActive: boolean;
}

export default class CollabRosterBar {
  private _el: HTMLDivElement | null = null;
  private _menu: HTMLDivElement | null = null;
  private _status: TransportStatus = 'connecting';
  private _detail = '';
  private _peers: Peer[] = [];
  private _incompatible = 0;
  private _syncing = false;
  private _following: ClientId | null = null;
  private _present: PresentChipState = {
    briefer: null,
    isBriefer: false,
    detached: false,
    brieferActive: false,
  };
  private _unread = 0;
  private _chatOpen = false;
  private _pingArmed = false;
  private _collapsed = CollabRosterBar._loadCollapsed();

  private _onToggleSync: (() => void) | null = null;
  private _onFollow: ((id: ClientId | null) => void) | null = null;
  private _onOpenSettings: (() => void) | null = null;
  private _onTogglePodium: (() => void) | null = null;
  private _onJoinPresentation: (() => void) | null = null;
  private _onRejoin: (() => void) | null = null;
  private _onToggleChat: (() => void) | null = null;
  private _onPing: (() => void) | null = null;

  private _clickHandler: ((e: Event) => void) | null = null;
  private _docClick: ((e: Event) => void) | null = null;
  private _docKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly me: CollabUser, private readonly roomName: string) {}

  // ── Mounting ──────────────────────────────────────────────────────────────

  public mount(): void {
    CollabRosterBar._injectStyle();
    if (document.getElementById(BAR_ID)) this.unmount();
    const el = document.createElement('div');
    el.id = BAR_ID;
    el.className = 'ms-collab-roster';
    document.body.appendChild(el);
    this._el = el;
    // One delegated listener: _render() replaces innerHTML wholesale, so
    // per-element handlers would be discarded on every roster update.
    this._clickHandler = (e: Event) => this._onClick(e);
    el.addEventListener('click', this._clickHandler);
    this._render();
  }

  public unmount(): void {
    this._closeMenu();
    if (this._el && this._clickHandler) {
      this._el.removeEventListener('click', this._clickHandler);
    }
    this._clickHandler = null;
    document.getElementById(BAR_ID)?.remove();
    this._el = null;
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  /** Called with null to stop following. */
  public onFollowPeer(cb: (id: ClientId | null) => void): void {
    this._onFollow = cb;
  }

  public onToggleSync(cb: () => void): void {
    this._onToggleSync = cb;
  }

  /** Opens the full `.ms-panel` settings widget — see CollabSettingsWidget. */
  public onOpenSettings(cb: () => void): void {
    this._onOpenSettings = cb;
  }

  /** Take the podium, or hand it back if we already hold it. */
  public onTogglePodium(cb: () => void): void {
    this._onTogglePodium = cb;
  }

  /** Go fullscreen with the briefer — opt-in, never pushed. */
  public onJoinPresentation(cb: () => void): void {
    this._onJoinPresentation = cb;
  }

  /** Snap back to the briefer's slide after navigating away. */
  public onRejoin(cb: () => void): void {
    this._onRejoin = cb;
  }

  public onToggleChat(cb: () => void): void {
    this._onToggleChat = cb;
  }

  public onPing(cb: () => void): void {
    this._onPing = cb;
  }

  // ── State in ──────────────────────────────────────────────────────────────

  public setStatus(status: TransportStatus, detail?: string): void {
    this._status = status;
    this._detail = detail ?? '';
    this._render();
  }

  /** `incompatible` = peers heard on a different protocol version. */
  public setPeers(peers: Peer[], incompatible = 0): void {
    this._peers = peers;
    this._incompatible = incompatible;
    this._render();
  }

  public setViewState(state: { syncing: boolean; following: ClientId | null }): void {
    this._syncing = state.syncing;
    this._following = state.following;
    this._render();
  }

  public setPresentState(state: PresentChipState): void {
    this._present = state;
    this._render();
  }

  public setChatState(state: { unread: number; open: boolean }): void {
    this._unread = state.unread;
    this._chatOpen = state.open;
    this._render();
  }

  public setPingArmed(armed: boolean): void {
    this._pingArmed = armed;
    this._render();
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  private _onClick(e: Event): void {
    const hit = (e.target as HTMLElement | null)?.closest('[data-act]') as HTMLElement | null;
    if (!hit) return;
    switch (hit.dataset.act) {
      case 'sync':
        this._onToggleSync?.();
        return;
      case 'menu':
        this._menu ? this._closeMenu() : this._openMenu();
        return;
      case 'follow': {
        const id = hit.dataset.id || '';
        // Clicking whoever you already follow is how you stop.
        this._onFollow?.(id && id !== this._following ? id : null);
        return;
      }
      case 'settings':
        this._closeMenu();
        this._onOpenSettings?.();
        return;
      case 'podium':
        this._onTogglePodium?.();
        return;
      case 'join':
        this._closeMenu();
        this._onJoinPresentation?.();
        return;
      case 'rejoin':
        this._closeMenu();
        this._onRejoin?.();
        return;
      case 'chat':
        this._closeMenu();
        this._onToggleChat?.();
        return;
      case 'ping':
        // Arming needs the map, not a menu in front of it.
        this._closeMenu();
        this._onPing?.();
        return;
      case 'invite':
        this._copyInvite();
        return;
      case 'collapse':
        this._collapsed = !this._collapsed;
        CollabRosterBar._saveCollapsed(this._collapsed);
        // A menu anchored to the rail would be left pointing at the wrong place
        // once the rail changes width.
        this._closeMenu();
        this._render();
        return;
      case 'close':
        this._closeMenu();
        return;
    }
  }

  private static _loadCollapsed(): boolean {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false; // storage blocked — start expanded
    }
  }

  private static _saveCollapsed(on: boolean): void {
    try {
      localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0');
    } catch {
      /* private browsing — the choice simply is not remembered */
    }
  }

  /**
   * Copy a `?room=` link to the clipboard.
   *
   * The URL is the documented way to share a room, and having to read a room name
   * out over a radio is the kind of friction that stops a feature being used. The
   * menu's empty state already shows the URL; this makes it one click.
   */
  private _copyInvite(): void {
    const url = CollabRosterBar._shareUrl(this.roomName);
    const clip: any = (navigator as any)?.clipboard;
    if (clip?.writeText) {
      void clip.writeText(url).then(
        () => CollabPresence.toast(`Invite link copied — room “${this.roomName}”`),
        // Refused (insecure origin, or no permission) — showing it is still more
        // use than failing silently.
        () => CollabPresence.toast(url),
      );
      return;
    }
    CollabPresence.toast(url);
  }

  private _openMenu(): void {
    if (!this._el) return;
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    // Real house classes, not a lookalike — see the file header.
    menu.className = 'ms-settings-menu ms-collab-menu';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    this._menu = menu;

    /**
     * Anchor beside the rail, computed rather than assumed. `right` is cleared
     * explicitly: `.ms-settings-menu` is written for a top-right chip and sets it,
     * so leaving it in place would fight the `left` set here and stretch the menu
     * across the window.
     */
    const r = this._el.getBoundingClientRect();
    menu.style.left = `${Math.round(r.right + 6)}px`;
    menu.style.right = 'auto';
    // Vertically aligned with the rail, then pulled back on screen — the rail sits
    // mid-height, so a tall menu would otherwise run off the bottom.
    const estHeight = 320;
    const top = Math.max(8, Math.min(r.top, window.innerHeight - estHeight - 8));
    menu.style.top = `${Math.round(top)}px`;

    menu.addEventListener('click', (e) => this._onClick(e));
    this._renderMenu();
    // Reveal on the next frame so the stylesheet's 130ms transition actually runs
    // instead of the menu appearing already-visible.
    requestAnimationFrame(() => menu.classList.add('ms-sm-visible'));

    // Same dismissal contract as SettingsMenu: Esc or a click elsewhere.
    this._docClick = (ev: Event) => {
      const t = ev.target as Node | null;
      if (t && (menu.contains(t) || this._el?.contains(t))) return;
      this._closeMenu();
    };
    this._docKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') this._closeMenu();
    };
    // Capture phase, so a stopPropagation() somewhere on the map cannot trap the
    // menu open.
    document.addEventListener('pointerdown', this._docClick, true);
    document.addEventListener('keydown', this._docKey, true);
    this._render(); // refresh aria-expanded on the trigger
  }

  private _closeMenu(): void {
    if (this._docClick) document.removeEventListener('pointerdown', this._docClick, true);
    if (this._docKey) document.removeEventListener('keydown', this._docKey, true);
    this._docClick = null;
    this._docKey = null;
    // Removed rather than hidden: the stylesheet leaves it position:fixed with no
    // pointer-events guard, so a merely-transparent menu would still swallow
    // clicks over the map.
    this._menu?.remove();
    this._menu = null;
    this._render();
  }

  // ── Chip ──────────────────────────────────────────────────────────────────

  private _render(): void {
    const el = this._el;
    if (!el) return;
    const esc = CollabRosterBar._esc;
    const count = this._peers.length + 1;
    const followedName = this._followedName();

    // Who is briefing outranks the peer count: it is the thing that changes what
    // the map in front of you is about to do.
    const brieferName =
      this._present.briefer && !this._present.isBriefer
        ? this._nameOf(this._present.briefer)
        : undefined;
    const label = this._present.isBriefer
      ? 'you are briefing'
      : brieferName
        ? `${brieferName} briefing`
        : followedName
          ? `following ${followedName}`
          : this._status === 'open'
            ? this._syncing
              ? `${count} in sync`
              : `${count} online`
            : this._status === 'connecting'
              ? 'connecting…'
              : this._status === 'error'
                ? 'reconnecting…'
                : 'offline';

    const dots = [this._chipDot(this.me, true), ...this._peers.map((p) => this._chipDot(p.user, false))].join('');

    const warn =
      this._incompatible > 0
        ? `<span class="ms-collab-warn" title="${esc(
            `${this._incompatible} peer(s) on an incompatible protocol version — their edits are ignored`,
          )}">!${this._incompatible}</span>`
        : '';

    const briefingLive = !!this._present.briefer;
    el.className = `ms-collab-roster${this._collapsed ? ' ms-collab-collapsed' : ''}`;

    // The label cannot fit a ~30px rail, so it becomes the trigger's tooltip and
    // the rail shows the count instead. The menu still spells it out in full.
    const trigger =
      `<button type="button" class="ms-collab-trigger" data-act="menu" aria-haspopup="menu"` +
      ` aria-expanded="${this._menu ? 'true' : 'false'}"` +
      ` title="${esc(`${label} — room ${this.roomName}${this._detail ? ` · ${this._detail}` : ''}`)}">` +
      `<span class="ms-collab-state ms-collab-${this._status}"></span>` +
      `<span class="ms-collab-count">${count}</span>` +
      warn +
      `</button>`;

    const syncBtn =
      `<button type="button" class="ms-collab-sync${this._syncing ? ' on' : ''}" data-act="sync"` +
      ` aria-pressed="${this._syncing ? 'true' : 'false'}"` +
      ` title="${esc(
        this._syncing
          ? 'Shared view is on — everyone pans and zooms together. Click to unlink.'
          : 'Link everyone to the same location and scale.',
      )}">${CollabRosterBar._linkIcon(this._syncing)}</button>`;

    /**
     * Collapsed keeps the things you must not be able to miss: an active briefing
     * and unread chat. Hiding an urgent, time-limited action behind a collapse
     * toggle would be the one case where tidiness costs you the thing itself.
     */
    const tools = this._collapsed
      ? (briefingLive ? this._briefButton() : '') + (this._unread > 0 ? this._chatButton() : '')
      : this._pingButton() + this._chatButton() + this._briefButton() + syncBtn;

    el.innerHTML =
      `<button type="button" class="ms-collab-handle" data-act="collapse"` +
      ` aria-expanded="${this._collapsed ? 'false' : 'true'}" title="${esc(
        this._collapsed ? 'Expand the collaboration rail' : 'Collapse the collaboration rail',
      )}">${CollabRosterBar._chevronIcon(this._collapsed)}</button>` +
      trigger +
      (this._collapsed ? '' : `<span class="ms-collab-dots">${dots}</span>`) +
      (tools ? `<span class="ms-collab-tools">${tools}</span>` : '');

    if (this._menu) this._renderMenu();
  }

  private _pingButton(): string {
    const esc = CollabRosterBar._esc;
    return (
      `<button type="button" class="ms-collab-sync${this._pingArmed ? ' on' : ''}" data-act="ping"` +
      ` aria-pressed="${this._pingArmed ? 'true' : 'false'}" title="${esc(
        this._pingArmed
          ? 'Click the map to ping the room — Esc to cancel'
          : 'Ping a location: drops a marker everyone sees for a few seconds',
      )}">${CollabRosterBar._pinIcon()}</button>`
    );
  }

  private _chatButton(): string {
    const esc = CollabRosterBar._esc;
    const badge =
      this._unread > 0
        ? `<span class="ms-collab-badge">${this._unread > 9 ? '9+' : this._unread}</span>`
        : '';
    return (
      `<button type="button" class="ms-collab-sync ms-collab-chatbtn${
        this._chatOpen ? ' on' : ''
      }" data-act="chat" aria-pressed="${this._chatOpen ? 'true' : 'false'}" title="${esc(
        this._unread > 0 ? `${this._unread} unread message(s)` : 'Room chat',
      )}">${CollabRosterBar._chatIcon()}${badge}</button>`
    );
  }

  /**
   * One slot, five states — always the most useful briefing action, so the thing
   * you need mid-brief never costs a menu. Rejoin in particular is time-critical:
   * you clicked away, the briefer moved on, and you want back now.
   */
  private _briefButton(): string {
    const esc = CollabRosterBar._esc;
    const p = this._present;
    const btn = (act: string, on: boolean, title: string, icon: string, extra = '') =>
      `<button type="button" class="ms-collab-sync${on ? ' on' : ''}${extra}" data-act="${act}"` +
      ` aria-pressed="${on ? 'true' : 'false'}" title="${esc(title)}">${icon}</button>`;

    if (p.isBriefer) {
      return btn('podium', true, 'You are briefing — click to hand back the podium', CollabRosterBar._micIcon());
    }
    if (p.briefer) {
      const who = this._nameOf(p.briefer);
      if (p.detached) {
        return btn('rejoin', false, `Rejoin ${who}'s briefing`, CollabRosterBar._rejoinIcon(), ' ms-collab-alert');
      }
      if (p.brieferActive) {
        return btn('join', false, `Go fullscreen with ${who}`, CollabRosterBar._joinIcon(), ' ms-collab-alert');
      }
      return btn('podium', false, `${who} is briefing — click to take over`, CollabRosterBar._micIcon());
    }
    return btn('podium', false, 'Brief the room — everyone follows your slides', CollabRosterBar._micIcon());
  }

  private _nameOf(id: ClientId): string {
    if (id === this.me.id) return this.me.name;
    return this._peers.find((p) => p.user.id === id)?.user.name ?? id.slice(0, 6);
  }

  /** Avatar in the chip's stack. Not interactive — following happens in the menu,
   *  where there is room to label what the click will do. */
  private _chipDot(u: CollabUser, isMe: boolean): string {
    const esc = CollabRosterBar._esc;
    const followed = !isMe && this._following === u.id;
    return (
      `<span class="ms-collab-dot${isMe ? ' me' : ''}${followed ? ' following' : ''}"` +
      ` style="--c:${esc(u.color)}"` +
      ` title="${esc(isMe ? `${u.name} (you)` : u.name)}">` +
      `${esc(CollabRosterBar._initials(u.name))}</span>`
    );
  }

  // ── Menu ──────────────────────────────────────────────────────────────────

  private _renderMenu(): void {
    const menu = this._menu;
    if (!menu) return;
    const esc = CollabRosterBar._esc;

    const syncRow =
      `<button type="button" class="ms-sm-row" role="menuitem" data-act="sync">` +
      `<span class="ms-sm-row-icon">${CollabRosterBar._linkIcon(this._syncing)}</span>` +
      `<span class="ms-sm-row-label">Everyone pans together</span>` +
      `<span class="ms-collab-flag${this._syncing ? ' on' : ''}">${
        this._syncing ? 'ON' : 'OFF'
      }</span></button>`;

    const peopleRows = this._peers.length
      ? this._peers
          .map((p) => {
            const followed = this._following === p.user.id;
            return (
              `<button type="button" class="ms-sm-row${followed ? ' ms-collab-row-on' : ''}"` +
              ` role="menuitem" data-act="follow" data-id="${esc(p.user.id)}"` +
              ` title="${esc(
                followed ? `Stop following ${p.user.name}` : `Follow ${p.user.name}'s view`,
              )}">` +
              `<span class="ms-sm-row-icon"><span class="ms-collab-dot" style="--c:${esc(
                p.user.color,
              )}">${esc(CollabRosterBar._initials(p.user.name))}</span></span>` +
              `<span class="ms-sm-row-label">${esc(p.user.name)}${
                p.known ? '' : ' <span class="ms-collab-sub">joining…</span>'
              }</span>` +
              `<span class="ms-collab-flag${followed ? ' on' : ''}">${
                followed ? 'FOLLOWING' : 'FOLLOW'
              }</span></button>`
            );
          })
          .join('')
      : // Empty state that teaches the feature rather than reporting nothing.
        `<div class="ms-sm-empty">Only you are here.<br><span class="ms-collab-share">${esc(
          CollabRosterBar._shareUrl(this.roomName),
        )}</span></div>`;

    menu.innerHTML =
      `<div class="ms-sm-header">` +
      `<span class="ms-sm-title">Collaboration</span>` +
      `<button class="ms-sm-close" data-act="close" title="Close">✕</button>` +
      `</div>` +
      `<div class="ms-sm-body">` +
      `<div class="ms-sm-group"><div class="ms-sm-group-title">Shared view</div>${syncRow}</div>` +
      this._briefingGroup() +
      `<div class="ms-sm-group"><div class="ms-sm-group-title">In this room</div>` +
      `<div class="ms-sm-row ms-collab-row-self">` +
      `<span class="ms-sm-row-icon"><span class="ms-collab-dot me" style="--c:${esc(
        this.me.color,
      )}">${esc(CollabRosterBar._initials(this.me.name))}</span></span>` +
      `<span class="ms-sm-row-label">${esc(this.me.name)}</span>` +
      `<span class="ms-collab-flag">YOU</span></div>` +
      peopleRows +
      `</div>` +
      `<div class="ms-sm-group"><div class="ms-sm-group-title">Room</div>` +
      `<button type="button" class="ms-sm-row" role="menuitem" data-act="chat">` +
      `<span class="ms-sm-row-icon">${CollabRosterBar._chatIcon()}</span>` +
      `<span class="ms-sm-row-label">Room chat</span>` +
      `<span class="ms-collab-flag${this._unread ? ' on' : ''}">${
        this._unread ? `${this._unread} NEW` : this._chatOpen ? 'OPEN' : ''
      }</span></button>` +
      `<button type="button" class="ms-sm-row" role="menuitem" data-act="invite"` +
      ` title="${esc(CollabRosterBar._shareUrl(this.roomName))}">` +
      `<span class="ms-sm-row-icon">${CollabRosterBar._icon(
        'M6.6 9.4 9.4 6.6M5.4 7.3 4.2 8.5a2.4 2.4 0 0 0 3.4 3.4l1.2-1.2M10.6 8.7l1.2-1.2a2.4 2.4 0 0 0-3.4-3.4L7.2 5.3',
      )}</span>` +
      `<span class="ms-sm-row-label">Copy invite link</span></button>` +
      `<button type="button" class="ms-sm-row" role="menuitem" data-act="settings">` +
      `<span class="ms-sm-row-icon">⚙</span>` +
      `<span class="ms-sm-row-label">All collaboration settings</span></button>` +
      `</div></div>` +
      `<div class="ms-sm-footer">${esc(this.roomName)}${
        this._incompatible ? ` · ${this._incompatible} on an old version` : ''
      }</div>`;
  }

  /**
   * The briefing group. Always present, because "nobody is briefing — you could"
   * is itself useful: the feature is otherwise undiscoverable from the menu.
   */
  private _briefingGroup(): string {
    const esc = CollabRosterBar._esc;
    const p = this._present;
    const row = (act: string, icon: string, label: string, flag: string, on: boolean) =>
      `<button type="button" class="ms-sm-row${on ? ' ms-collab-row-on' : ''}" role="menuitem"` +
      ` data-act="${act}"><span class="ms-sm-row-icon">${icon}</span>` +
      `<span class="ms-sm-row-label">${esc(label)}</span>` +
      `<span class="ms-collab-flag${on ? ' on' : ''}">${esc(flag)}</span></button>`;

    let rows = '';
    if (p.isBriefer) {
      rows = row('podium', CollabRosterBar._micIcon(), 'You are briefing', 'HAND BACK', true);
    } else if (p.briefer) {
      const who = this._nameOf(p.briefer);
      rows =
        row(
          'podium',
          CollabRosterBar._micIcon(),
          `${who} is briefing`,
          'TAKE OVER',
          false,
        ) +
        (p.detached
          ? row('rejoin', CollabRosterBar._rejoinIcon(), 'You looked away', 'REJOIN', false)
          : row(
              'join',
              CollabRosterBar._joinIcon(),
              p.brieferActive ? 'Following their slides' : 'Following',
              p.brieferActive ? 'GO FULLSCREEN' : 'FOLLOWING',
              !p.brieferActive,
            ));
    } else {
      rows = row('podium', CollabRosterBar._micIcon(), 'Brief the room', 'START', false);
    }
    return `<div class="ms-sm-group"><div class="ms-sm-group-title">Briefing</div>${rows}</div>`;
  }

  private _followedName(): string | undefined {
    if (!this._following) return undefined;
    return this._peers.find((p) => p.user.id === this._following)?.user.name;
  }

  /** The URL a colleague needs. The room rides in the query string so a link is
   *  all it takes — see CollabSession.loadRoom. */
  private static _shareUrl(room: string): string {
    try {
      return `${location.origin}/?room=${encodeURIComponent(room)}`;
    } catch {
      return `?room=${room}`;
    }
  }

  /**
   * Linked / unlinked glyph as inline SVG.
   *
   * Not an emoji: the broken-chain emoji is Unicode 15.1 and renders as two
   * separate glyphs, or as tofu, depending on the platform's emoji font — and an
   * emoji cannot take `currentColor`, so it could not follow the theme either.
   */
  private static _linkIcon(on: boolean): string {
    const common = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"';
    return on
      ? `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path ${common}` +
          ` d="M6.4 9.6 9.6 6.4M5.2 7.1 4 8.3a2.4 2.4 0 0 0 3.4 3.4l1.2-1.2M10.8 8.9 12 7.7a2.4 2.4 0 0 0-3.4-3.4L7.4 5.5"/></svg>`
      : `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path ${common}` +
          ` d="M5.6 6.2 4 7.8a2.4 2.4 0 0 0 3.4 3.4l1-1M10.4 9.8 12 8.2a2.4 2.4 0 0 0-3.4-3.4l-1 1M3.1 3.1l9.8 9.8"/></svg>`;
  }

  /**
   * The rest of the icon set, on the same terms as `_linkIcon`: inline SVG so it
   * inherits `currentColor` and follows the theme, rather than an emoji that
   * cannot be coloured and renders differently on every platform.
   */
  private static _icon(path: string): string {
    return (
      `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none"` +
      ` stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"` +
      ` d="${path}"/></svg>`
    );
  }

  /** Points the way the click will move the rail: out when collapsed, in when not. */
  private static _chevronIcon(collapsed: boolean): string {
    return CollabRosterBar._icon(collapsed ? 'M6.4 4.5 10 8l-3.6 3.5' : 'M9.6 4.5 6 8l3.6 3.5');
  }

  private static _pinIcon(): string {
    return CollabRosterBar._icon('M8 14s4.2-4.6 4.2-7.5a4.2 4.2 0 1 0-8.4 0C3.8 9.4 8 14 8 14zM8 7.3v.01');
  }

  private static _chatIcon(): string {
    return CollabRosterBar._icon('M13.5 8.2c0 2.5-2.5 4.5-5.5 4.5-.7 0-1.4-.1-2-.3L2.5 13.5l1-2.5A4.4 4.4 0 0 1 2.5 8.2c0-2.5 2.5-4.5 5.5-4.5s5.5 2 5.5 4.5z');
  }

  private static _micIcon(): string {
    return CollabRosterBar._icon('M8 2.5a1.9 1.9 0 0 1 1.9 1.9v3a1.9 1.9 0 0 1-3.8 0v-3A1.9 1.9 0 0 1 8 2.5zM4.4 7.2a3.6 3.6 0 0 0 7.2 0M8 11v2.5M6 13.5h4');
  }

  private static _rejoinIcon(): string {
    return CollabRosterBar._icon('M3 8.5A4.5 4.5 0 1 0 7.5 4H3.2M5.4 1.9 3 4l2.4 2.1');
  }

  private static _joinIcon(): string {
    return CollabRosterBar._icon('M6.2 2.8H2.8v3.4M9.8 2.8h3.4v3.4M13.2 9.8v3.4H9.8M2.8 9.8v3.4h3.4');
  }

  private static _initials(name: string): string {
    const parts = (name || '?').trim().split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  private static _esc(s: string): string {
    return String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
    );
  }

  /**
   * Chip-only CSS. Every value comes from a ThemeManager custom property, so the
   * chip follows Ops Dark / Night Vision / Sandstorm / Arctic / SIPR without a
   * single theme listener. The menu needs no CSS at all — Widgets.css already
   * owns `.ms-settings-menu` and `.ms-sm-*`; what is here only covers the few
   * collab-specific slots inside a house row.
   */
  private static _injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* Docked to the left edge at mid-height: a vertical rail, square on the docked
   side so it reads as attached to the window rather than floating over it. */
.ms-collab-roster{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:9000;
  display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 3px;
  border-radius:0 var(--ms-radius) var(--ms-radius) 0;background:var(--ms-bg);
  border:1px solid var(--ms-border);border-left:0;box-shadow:var(--ms-shadow);
  backdrop-filter:blur(14px);font-family:var(--ms-menu-font);color:var(--ms-text);
  user-select:none}
.ms-collab-roster.ms-collab-collapsed{padding:3px 2px;gap:2px}

.ms-collab-roster button{display:inline-flex;align-items:center;justify-content:center;
  background:none;border:0;color:inherit;font:inherit;cursor:pointer;
  border-radius:calc(var(--ms-radius) - 4px);
  transition:background-color .15s ease,color .15s ease,box-shadow .15s ease}
.ms-collab-roster button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--ms-accent)}

/* Full-width grab strip at the top of the rail. */
.ms-collab-handle{width:100%;height:13px;color:var(--ms-text-dim)}
.ms-collab-handle:hover{background:var(--ms-bg-input);color:var(--ms-text)}

.ms-collab-trigger{flex-direction:column;gap:2px;padding:4px 3px;width:100%}
.ms-collab-trigger:hover{background:var(--ms-bg-input)}
.ms-collab-trigger[aria-expanded="true"]{background:var(--ms-bg-input)}
/* --ms-text not --ms-text-dim, for the contrast reason given on .ms-collab-label. */
.ms-collab-count{font:700 var(--ms-fs-xs)/1 var(--ms-menu-font);color:var(--ms-text)}

.ms-collab-tools{display:flex;flex-direction:column;align-items:center;gap:2px}

.ms-collab-state{width:6px;height:6px;border-radius:50%;background:var(--ms-text-dim);flex:0 0 auto}
.ms-collab-open{background:var(--ms-success);box-shadow:0 0 6px var(--ms-success)}
.ms-collab-connecting{background:var(--ms-warning);animation:ms-collab-blink 1.1s infinite}
.ms-collab-error{background:var(--ms-danger);animation:ms-collab-blink 1.1s infinite}
@keyframes ms-collab-blink{0%,100%{opacity:1}50%{opacity:.3}}

/* --ms-text, not --ms-text-dim: at 11.5px this is small text needing 4.5:1, and
   dim only reaches 2.6–4.2:1 on four of the five themes. Hover is signalled by
   the trigger's background instead, which costs no legibility. */
.ms-collab-label{font-size:var(--ms-fs-xs);font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ms-text);white-space:nowrap}

/* Stacked downwards in the rail, overlapping like a deck of chips. The overlap is
   scoped to the rail: the same .ms-collab-dot appears alone inside a menu row,
   where any margin would just knock it out of alignment. */
.ms-collab-dots{display:flex;flex-direction:column;align-items:center}
.ms-collab-dots .ms-collab-dot{margin-top:-4px}
.ms-collab-dots .ms-collab-dot:first-child{margin-top:0}
/**
 * The initials' ink is deliberately NOT a theme token. A dot's background is the
 * peer's identity colour from PEER_PALETTE, which is theme-independent by design
 * (the same person is the same colour on every screen) and every entry in it is a
 * light pastel. So the foreground has to be a fixed dark ink: var(--ms-bg) would
 * be near-white on the Arctic theme and put white text on a pink dot. The
 * separator ring DOES use --ms-bg — it exists to punch the dot out of the chip
 * behind it, so it should follow the chip.
 */
.ms-collab-dot{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;
  border-radius:50%;background:var(--c);color:#0b0e12;
  font:700 8px/1 var(--ms-menu-font);border:1.5px solid var(--ms-bg);flex:0 0 auto}
.ms-collab-dot.me{box-shadow:0 0 0 1.5px var(--ms-text-dim)}
.ms-collab-dot.following{box-shadow:0 0 0 1.5px var(--ms-accent),0 0 7px var(--c)}

/* --ms-danger rather than --ms-warning: a peer on an incompatible version is
   having its edits silently discarded, which is an error not a caution — and the
   warning token drops to 2.6:1 on the light Arctic theme, below even the 3:1 a
   non-text indicator needs. Danger clears 3.5:1 on all five. */
.ms-collab-warn{font:700 var(--ms-fs-xs)/1 var(--ms-menu-font);color:var(--ms-danger);
  letter-spacing:.04em;padding-left:2px}

.ms-collab-sync{width:23px;height:23px;justify-content:center;color:var(--ms-text-dim)}
.ms-collab-sync:hover{background:var(--ms-bg-input);color:var(--ms-text)}
.ms-collab-sync.on{color:var(--ms-accent);background:var(--ms-bg-header);
  box-shadow:inset 0 0 0 1px var(--ms-border)}

/* An action the viewer wants NOW — Join, or Rejoin after looking away. Outlined
   in the accent rather than filled, so it reads as urgent without being confused
   with the .on state, which means "this toggle is currently engaged". */
.ms-collab-alert{color:var(--ms-accent);box-shadow:inset 0 0 0 1px var(--ms-accent)}
.ms-collab-alert:hover{background:var(--ms-bg-header);color:var(--ms-accent)}

.ms-collab-chatbtn{position:relative}
/* Coloured text with a --ms-bg halo, not a filled pill. The file already
   establishes that --ms-danger clears 3.5:1 on all five themes; a filled badge
   would instead need an ink colour legible on both a near-white (Arctic) and a
   near-black --ms-bg, and no single value does that. */
.ms-collab-badge{position:absolute;top:-2px;right:-2px;font:700 8.5px/1 var(--ms-menu-font);
  color:var(--ms-danger);letter-spacing:0;
  text-shadow:0 0 2px var(--ms-bg),0 0 2px var(--ms-bg),0 0 3px var(--ms-bg)}

/* Collab-specific slots inside the shared .ms-sm-row. */
.ms-collab-menu{min-width:248px;max-width:300px;font-family:var(--ms-menu-font)}
.ms-collab-menu .ms-sm-row-label{display:flex;align-items:center;gap:6px}
.ms-collab-menu .ms-sm-row-icon{margin-right:9px}
/* Inactive flags read as secondary through size and caps, NOT through a dimmer
   colour: --ms-text-label sits at 1.7–2.8:1 on every theme, which is illegible at
   this size. Active state is carried by hue (--ms-accent) plus the row tint. */
.ms-collab-flag{font:700 9.5px/1 var(--ms-menu-font);letter-spacing:.12em;
  color:var(--ms-text);opacity:.7;padding-left:8px;flex:0 0 auto}
.ms-collab-flag.on{color:var(--ms-accent);opacity:1}
.ms-collab-row-on{background:var(--ms-bg-header)}
.ms-collab-row-self{cursor:default}
.ms-collab-row-self:hover{background:none;border-left-color:transparent;filter:none}
.ms-collab-sub{font-size:9px;letter-spacing:.08em;text-transform:uppercase;opacity:.75}
.ms-collab-share{display:inline-block;margin-top:5px;font-family:var(--ms-font);font-size:9.5px;
  font-style:normal;color:var(--ms-text-dim);word-break:break-all}
`;
    document.head.appendChild(style);
  }
}
