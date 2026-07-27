/**
 * PresenterPanel.ts
 *
 * The briefer's own view: speaker notes, an elapsed timer, the next slide's
 * thumbnail, build progress and transport controls.
 *
 * One renderer, two homes. `mount(doc)` builds the panel inside ANY document,
 * so the same code drives:
 *   • the in-page panel (docked right over the map, toggled with N) — useful
 *     on one screen for rehearsal;
 *   • a popped-out window the briefer drags to their laptop while the map
 *     projects — the real dual-screen briefing.
 *
 * The popped-out window is same-origin, so there is no message channel: the
 * child's DOM is touched directly and its keystrokes are forwarded straight
 * into the same host callbacks the in-page panel uses. Closing the child (or
 * the parent navigating away) re-docks automatically, so the panel can never
 * strand itself in a window nobody can see.
 */

import EngineLogger from '../../../Support/EngineLogger';

const ENGINE_NAME = 'BriefingEngine';

export interface PresenterSlideRef {
  title: string;
  thumb?: string;
}

/** Everything the panel paints. Pushed by PresentSession on every change. */
export interface PresenterData {
  index: number;
  total: number;
  title: string;
  notes: string;
  /**
   * The slide on the audience screen right now. Only painted when the panel is
   * popped out — see the .ms-presenter-now CSS for why.
   */
  current: PresenterSlideRef | null;
  next: PresenterSlideRef | null;
  /** Click-mode build progress; both 0 when the slide isn't step-driven. */
  buildRevealed: number;
  buildTotal: number;
  blackout: boolean;
}

export interface PresenterHost {
  next(): void;
  prev(): void;
  goTo(index: number): void;
  toggleBlackout(): void;
  exit(): void;
  listSlides(): PresenterSlideRef[];
}

const PANEL_CSS = `
.ms-presenter {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(38vw, 460px);
  z-index: 9700; display: flex; flex-direction: column; gap: 10px;
  padding: 14px; box-sizing: border-box;
  background: rgba(12, 15, 20, 0.94);
  border-left: 1px solid rgba(90,140,220,0.28);
  color: #dce8f5; font: 13px/1.5 'Segoe UI', system-ui, sans-serif;
  backdrop-filter: blur(6px);
}
.ms-presenter.ms-windowed {
  position: static; width: auto; height: 100%; border-left: none; backdrop-filter: none;
}
.ms-presenter-head { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.ms-presenter-pos {
  font: 700 11px/1 Consolas, monospace; letter-spacing: .06em; padding: 4px 8px;
  border-radius: 9px; background: rgba(255,255,255,.07);
  border: 1px solid rgba(80,100,150,.22); color: rgba(155,180,215,.8);
}
.ms-presenter-title {
  font-weight: 700; font-size: 15px; color: #EF9F27; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-presenter-clock {
  display: flex; align-items: baseline; gap: 10px; flex-shrink: 0;
  padding: 8px 10px; border-radius: 7px; background: rgba(255,255,255,.05);
  border: 1px solid rgba(80,100,150,.2);
}
.ms-presenter-elapsed { font: 700 26px/1 Consolas, monospace; letter-spacing: .04em; }
.ms-presenter-elapsed.ms-paused { color: rgba(155,180,215,.55); }
.ms-presenter-wall { font: 12px/1 Consolas, monospace; color: rgba(155,180,215,.7); }
.ms-presenter-clock-btns { margin-left: auto; display: flex; gap: 5px; }
.ms-presenter-notes {
  flex: 1; min-height: 80px; overflow-y: auto; white-space: pre-wrap;
  padding: 11px 12px; border-radius: 7px; font-size: 15px; line-height: 1.6;
  background: rgba(0,0,0,.3); border: 1px solid rgba(80,100,150,.2);
}
.ms-presenter-notes.ms-empty { color: rgba(155,180,215,.42); font-style: italic; }
/* The current slide, big. Only worth showing in the POPPED-OUT window: docked
   in-page the live map is right behind the panel, so a preview of it would be
   redundant and would eat the notes' vertical space. */
.ms-presenter-now { flex-shrink: 0; }
.ms-presenter:not(.ms-windowed) .ms-presenter-now { display: none; }
.ms-presenter-nowbox {
  width: 100%; aspect-ratio: 16/9; border-radius: 7px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg,#26313a,#17202a) center/contain no-repeat;
  border: 1px solid rgba(80,100,150,.28);
  color: rgba(155,180,215,.45); font-size: 11px; text-align: center; padding: 6px;
  box-sizing: border-box;
}
.ms-presenter-nowbox img { width: 100%; height: 100%; object-fit: contain; }
.ms-presenter-nextwrap { flex-shrink: 0; }
.ms-presenter-label {
  font: 700 10px/1 'Segoe UI', system-ui, sans-serif; letter-spacing: .1em;
  text-transform: uppercase; color: rgba(155,180,215,.6); margin-bottom: 5px;
}
.ms-presenter-next {
  display: flex; gap: 9px; align-items: center; padding: 7px; border-radius: 7px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(80,100,150,.2);
}
.ms-presenter-next img {
  width: 104px; height: 59px; object-fit: cover; border-radius: 4px; flex-shrink: 0;
  background: linear-gradient(135deg,#26313a,#17202a);
}
.ms-presenter-next .ms-noimg {
  width: 104px; height: 59px; border-radius: 4px; flex-shrink: 0;
  background: linear-gradient(135deg,#26313a,#17202a);
  display: flex; align-items: center; justify-content: center;
  color: rgba(155,180,215,.45); font-size: 10px;
}
.ms-presenter-next span { font-size: 13px; overflow: hidden; }
.ms-presenter-builds {
  flex-shrink: 0; font: 11px/1 Consolas, monospace; color: rgba(155,180,215,.75);
  padding: 6px 9px; border-radius: 6px; background: rgba(239,159,39,.12);
  border: 1px solid rgba(239,159,39,.35);
}
.ms-presenter-btns { display: flex; flex-wrap: wrap; gap: 6px; flex-shrink: 0; }
.ms-presenter-btn {
  background: rgba(0,0,0,.3); color: #dce8f5; border: 1px solid rgba(90,140,220,.28);
  border-radius: 4px; padding: 7px 11px; cursor: pointer; font: inherit; font-size: 11px;
  transition: all .15s ease;
}
.ms-presenter-btn:hover { background: rgba(255,255,255,.1); border-color: #EF9F27; }
.ms-presenter-btn.ms-on { background: #EF9F27; border-color: #EF9F27; color: #14181f; font-weight: 700; }
.ms-presenter-btn.ms-wide { flex: 1; }
.ms-presenter-grid {
  display: none; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 7px; overflow-y: auto; max-height: 34%; flex-shrink: 0;
  padding: 7px; border-radius: 7px;
  background: rgba(0,0,0,.3); border: 1px solid rgba(80,100,150,.2);
}
.ms-presenter-grid.ms-open { display: grid; }
.ms-presenter-gtile {
  position: relative; aspect-ratio: 16/9; border-radius: 4px; cursor: pointer;
  border: 2px solid transparent; overflow: hidden;
  background: linear-gradient(135deg,#26313a,#17202a) center/cover no-repeat;
}
.ms-presenter-gtile:hover { border-color: #EF9F27; }
.ms-presenter-gtile.ms-cur { border-color: #EF9F27; }
.ms-presenter-gtile b {
  position: absolute; left: 3px; top: 2px; font: 700 9px/1.4 Consolas, monospace;
  padding: 1px 4px; border-radius: 3px; background: rgba(0,0,0,.62); color: #dce8f5;
}
`;

/** Standalone document for the popped-out window — dark, no margins. */
const WINDOW_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Presenter View</title><style>
html,body{margin:0;height:100%;background:#0c0f14;overflow:hidden;}
</style></head><body></body></html>`;

const pad = (n: number) => String(n).padStart(2, '0');

export default class PresenterPanel {
  private _host: PresenterHost;
  private _root: HTMLElement | null = null;
  private _win: Window | null = null;
  private _last: PresenterData | null = null;

  // Timer
  private _elapsedMs = 0;
  private _running = true;
  private _lastTick = 0;
  private _tickTimer: number | null = null;

  private _gridOpen = false;
  private _onWinKey: ((e: KeyboardEvent) => void) | null = null;
  private _onWinClose: (() => void) | null = null;

  constructor(host: PresenterHost) {
    this._host = host;
  }

  // ── Mounting ───────────────────────────────────────────────────────────────

  /** Build the panel inside `doc`. Replaces any previous mount. */
  public mount(doc: Document): void {
    this._unmount();
    if (!doc.getElementById('ms-presenter-style')) {
      const style = doc.createElement('style');
      style.id = 'ms-presenter-style';
      style.textContent = PANEL_CSS;
      doc.head.appendChild(style);
    }
    const root = doc.createElement('div');
    root.className = 'ms-presenter' + (doc !== document ? ' ms-windowed' : '');
    root.innerHTML = `
      <div class="ms-presenter-head">
        <span class="ms-presenter-pos"></span>
        <span class="ms-presenter-title"></span>
      </div>
      <div class="ms-presenter-clock">
        <span class="ms-presenter-elapsed">00:00</span>
        <span class="ms-presenter-wall"></span>
        <span class="ms-presenter-clock-btns">
          <button class="ms-presenter-btn" data-act="timer" title="Pause / resume the elapsed timer">❚❚</button>
          <button class="ms-presenter-btn" data-act="reset" title="Reset the elapsed timer (T)">↺</button>
        </span>
      </div>
      <div class="ms-presenter-now">
        <div class="ms-presenter-label">On screen now</div>
        <div class="ms-presenter-nowbox"></div>
      </div>
      <div class="ms-presenter-builds" hidden></div>
      <div class="ms-presenter-label">Speaker notes</div>
      <div class="ms-presenter-notes"></div>
      <div class="ms-presenter-nextwrap">
        <div class="ms-presenter-label">Next</div>
        <div class="ms-presenter-next"></div>
      </div>
      <div class="ms-presenter-grid"></div>
      <div class="ms-presenter-btns">
        <button class="ms-presenter-btn ms-wide" data-act="prev" title="Previous (←)">◀ Prev</button>
        <button class="ms-presenter-btn ms-wide" data-act="next" title="Next (→ / Space)">Next ▶</button>
        <button class="ms-presenter-btn" data-act="grid" title="All slides (G)">⊞</button>
        <button class="ms-presenter-btn" data-act="black" title="Black the audience screen (B)">◼</button>
        <button class="ms-presenter-btn" data-act="pop" title="Move this panel to its own window for a second screen">⧉ Pop out</button>
        <button class="ms-presenter-btn" data-act="exit" title="End the slideshow (Esc)">✕ End</button>
      </div>`;
    doc.body.appendChild(root);
    this._root = root;

    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement)?.closest?.('[data-act]')?.getAttribute('data-act');
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      switch (act) {
        case 'prev':
          this._host.prev();
          break;
        case 'next':
          this._host.next();
          break;
        case 'grid':
          this.toggleGrid();
          break;
        case 'black':
          this._host.toggleBlackout();
          break;
        case 'pop':
          if (this._win) this.dock();
          else if (!this.popOut()) this._reportPopBlocked();
          break;
        case 'exit':
          this._host.exit();
          break;
        case 'timer':
          this.toggleTimer();
          break;
        case 'reset':
          this.resetTimer();
          break;
      }
    });

    this._startTicking();
    if (this._last) this.update(this._last);
    this._renderGrid();
  }

  private _unmount(): void {
    this._root?.remove();
    this._root = null;
  }

  public isMounted(): boolean {
    return !!this._root;
  }

  public isPoppedOut(): boolean {
    return !!this._win && !this._win.closed;
  }

  // ── Pop out / dock ─────────────────────────────────────────────────────────

  /**
   * Re-mount into a second browser window. Popup blockers can refuse this —
   * the caller gets `false` back and the panel stays docked in-page.
   */
  public popOut(): boolean {
    if (this.isPoppedOut()) return true;
    let win: Window | null = null;
    try {
      win = window.open('', 'ms-presenter-view', 'width=620,height=820,menubar=no,toolbar=no');
    } catch {
      win = null;
    }
    if (!win) return false;

    try {
      win.document.open();
      win.document.write(WINDOW_HTML);
      win.document.close();
    } catch {
      try {
        win.close();
      } catch {}
      return false;
    }

    this._win = win;
    this.mount(win.document);
    const popBtn = this._root?.querySelector('[data-act="pop"]');
    if (popBtn) popBtn.textContent = '⧉ Dock';

    // The briefer will be typing into this window, not the map one — forward
    // its transport keys so the deck still responds.
    this._onWinKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          this._host.next();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          this._host.prev();
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          this._host.toggleBlackout();
          break;
        case 'g':
        case 'G':
          e.preventDefault();
          this.toggleGrid();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          this.resetTimer();
          break;
        case 'Escape':
          e.preventDefault();
          this._host.exit();
          break;
      }
    };
    win.addEventListener('keydown', this._onWinKey);

    // Closing the child must re-dock, or the panel silently disappears.
    this._onWinClose = () => this.dock();
    win.addEventListener('beforeunload', this._onWinClose);
    window.addEventListener('beforeunload', this._closeWindow);
    return true;
  }

  /**
   * A refused window.open is otherwise indistinguishable from a dead button —
   * say so on the button itself (the briefer is looking right at it) and in the
   * Engine Log, then restore the label.
   */
  private _reportPopBlocked(): void {
    EngineLogger.error(
      ENGINE_NAME,
      'Presenter view could not open its own window — allow pop-ups for this site, then try again.',
    );
    const btn = this._root?.querySelector('[data-act="pop"]') as HTMLElement | null;
    if (!btn) return;
    btn.textContent = '⧉ Pop-up blocked';
    btn.setAttribute('title', 'Your browser blocked the window. Allow pop-ups for this site, then try again.');
    window.setTimeout(() => {
      if (this._win) return; // it opened in the meantime — leave the Dock label alone
      const still = this._root?.querySelector('[data-act="pop"]') as HTMLElement | null;
      if (!still) return;
      still.textContent = '⧉ Pop out';
      still.setAttribute('title', 'Move this panel to its own window for a second screen');
    }, 4000);
  }

  /** Bring the panel back into the main document, closing the child window. */
  public dock(): void {
    const win = this._win;
    this._win = null;
    if (win) {
      try {
        if (this._onWinKey) win.removeEventListener('keydown', this._onWinKey);
        if (this._onWinClose) win.removeEventListener('beforeunload', this._onWinClose);
        if (!win.closed) win.close();
      } catch {}
    }
    this._onWinKey = null;
    this._onWinClose = null;
    window.removeEventListener('beforeunload', this._closeWindow);
    this.mount(document);
  }

  private _closeWindow = (): void => {
    try {
      if (this._win && !this._win.closed) this._win.close();
    } catch {}
  };

  // ── Timer ──────────────────────────────────────────────────────────────────

  private _startTicking(): void {
    this._lastTick = performance.now();
    if (this._tickTimer !== null) return;
    this._tickTimer = window.setInterval(() => this._tick(), 500);
  }

  private _tick(): void {
    const now = performance.now();
    if (this._running) this._elapsedMs += now - this._lastTick;
    this._lastTick = now;
    this._paintClock();
  }

  public resetTimer(): void {
    this._elapsedMs = 0;
    this._lastTick = performance.now();
    this._paintClock();
  }

  public toggleTimer(): void {
    this._lastTick = performance.now();
    this._running = !this._running;
    this._paintClock();
  }

  private _paintClock(): void {
    const root = this._root;
    if (!root) return;
    const total = Math.floor(this._elapsedMs / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const el = root.querySelector('.ms-presenter-elapsed') as HTMLElement | null;
    if (el) {
      el.textContent = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
      el.classList.toggle('ms-paused', !this._running);
    }
    const wall = root.querySelector('.ms-presenter-wall') as HTMLElement | null;
    if (wall) {
      const d = new Date();
      wall.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const btn = root.querySelector('[data-act="timer"]') as HTMLElement | null;
    if (btn) btn.textContent = this._running ? '❚❚' : '▶';
  }

  // ── Slide grid ─────────────────────────────────────────────────────────────

  public toggleGrid(): void {
    this._gridOpen = !this._gridOpen;
    this._renderGrid();
  }

  public closeGrid(): void {
    if (!this._gridOpen) return;
    this._gridOpen = false;
    this._renderGrid();
  }

  public get gridOpen(): boolean {
    return this._gridOpen;
  }

  private _renderGrid(): void {
    const grid = this._root?.querySelector('.ms-presenter-grid') as HTMLElement | null;
    if (!grid) return;
    grid.classList.toggle('ms-open', this._gridOpen);
    if (!this._gridOpen) {
      grid.innerHTML = '';
      return;
    }
    const cur = this._last?.index ?? -1;
    grid.innerHTML = this._host
      .listSlides()
      .map(
        (s, i) =>
          `<div class="ms-presenter-gtile${i === cur ? ' ms-cur' : ''}" data-idx="${i}"${
            s.thumb ? ` style="background-image:url('${s.thumb}')"` : ''
          } title="${String(s.title || `Slide ${i + 1}`).replace(/"/g, '&quot;')}"><b>${i + 1}</b></div>`,
      )
      .join('');
    grid.onclick = (e) => {
      const tile = (e.target as HTMLElement)?.closest?.('[data-idx]');
      if (!tile) return;
      e.stopPropagation();
      this._gridOpen = false;
      this._renderGrid();
      this._host.goTo(Number(tile.getAttribute('data-idx')));
    };
  }

  // ── Painting ───────────────────────────────────────────────────────────────

  public update(data: PresenterData): void {
    this._last = data;
    const root = this._root;
    if (!root) return;

    const set = (sel: string, text: string) => {
      const el = root.querySelector(sel) as HTMLElement | null;
      if (el) el.textContent = text;
    };
    set('.ms-presenter-pos', `${data.index + 1} / ${data.total}`);
    set('.ms-presenter-title', data.title || `Slide ${data.index + 1}`);

    const notes = root.querySelector('.ms-presenter-notes') as HTMLElement | null;
    if (notes) {
      const has = !!data.notes?.trim();
      notes.textContent = has ? data.notes : 'No speaker notes for this slide.';
      notes.classList.toggle('ms-empty', !has);
    }

    const builds = root.querySelector('.ms-presenter-builds') as HTMLElement | null;
    if (builds) {
      const show = data.buildTotal > 0;
      builds.hidden = !show;
      if (show) {
        builds.textContent =
          data.buildRevealed >= data.buildTotal
            ? `Builds ${data.buildTotal} / ${data.buildTotal} — next advance changes slide`
            : `Build ${data.buildRevealed} / ${data.buildTotal} — advance to reveal`;
      }
    }

    const now = root.querySelector('.ms-presenter-nowbox') as HTMLElement | null;
    if (now) {
      // A slide captured in 3D-headless has no thumbnail — say so rather than
      // showing an empty box the briefer reads as "the screen is blank".
      now.innerHTML = data.current?.thumb
        ? `<img src="${data.current.thumb}" alt="">`
        : 'No preview for this slide — check the projected screen.';
    }

    const next = root.querySelector('.ms-presenter-next') as HTMLElement | null;
    if (next) {
      if (!data.next) {
        next.innerHTML = `<div class="ms-noimg">End</div><span>End of briefing</span>`;
      } else {
        const label = this._escape(data.next.title || `Slide ${data.index + 2}`);
        next.innerHTML =
          (data.next.thumb
            ? `<img src="${data.next.thumb}" alt="">`
            : `<div class="ms-noimg">No preview</div>`) + `<span>${label}</span>`;
      }
    }

    const black = root.querySelector('[data-act="black"]') as HTMLElement | null;
    black?.classList.toggle('ms-on', data.blackout);

    if (this._gridOpen) this._renderGrid();
    this._paintClock();
  }

  private _escape(s: string): string {
    return s.replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
    );
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  public destroy(): void {
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    const win = this._win;
    this._win = null;
    if (win) {
      try {
        if (this._onWinKey) win.removeEventListener('keydown', this._onWinKey);
        if (this._onWinClose) win.removeEventListener('beforeunload', this._onWinClose);
        if (!win.closed) win.close();
      } catch {}
    }
    this._onWinKey = null;
    this._onWinClose = null;
    window.removeEventListener('beforeunload', this._closeWindow);
    this._unmount();
    this._last = null;
    this._gridOpen = false;
  }
}
