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
  /**
   * Optional full-resolution image for the big "On screen now" box. `thumb` is
   * the 240px rail raster — upscaled into that box it turns to mush — so
   * PresentSession hands the current slide's capture-time screenshot (with its
   * annotations composited) here whenever it has one. Absent → `thumb` is used.
   */
  full?: string;
  /**
   * Skipped by playback. The jump grid still lists the slide — reaching one on
   * purpose is the point of the grid — but marks it so it never reads as part
   * of the running deck.
   */
  hidden?: boolean;
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
  /**
   * The panel is about to open or close its own window. Opening a popup makes
   * the browser drop fullscreen on the map window, and the session must not
   * read that as "the briefer left the show" — see PresentSession's
   * fullscreenchange handler.
   */
  onWindowChange?(): void;
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
/* The column itself must never scroll or grow: the transport buttons live at
   the bottom and have to stay reachable no matter how many slides the jump grid
   holds. Everything that CAN give way (preview, notes, grid) shrinks or scrolls
   internally; head / clock / buttons never do. */
.ms-presenter { overflow: hidden; min-height: 0; }
.ms-presenter-head { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
/* Shared scrollbar treatment — the default OS bar looked pasted on next to the
   rest of the panel (matches .ms-briefing-strip in BriefingEngine). */
.ms-presenter-notes, .ms-presenter-grid {
  scrollbar-width: thin; scrollbar-color: rgba(90,140,220,.35) transparent;
}
.ms-presenter-notes::-webkit-scrollbar, .ms-presenter-grid::-webkit-scrollbar { width: 8px; }
.ms-presenter-notes::-webkit-scrollbar-track,
.ms-presenter-grid::-webkit-scrollbar-track { background: transparent; }
.ms-presenter-notes::-webkit-scrollbar-thumb,
.ms-presenter-grid::-webkit-scrollbar-thumb {
  background: rgba(90,140,220,.35); border-radius: 4px;
}
.ms-presenter-notes::-webkit-scrollbar-thumb:hover,
.ms-presenter-grid::-webkit-scrollbar-thumb:hover { background: #EF9F27; }
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
  display: flex; align-items: baseline; gap: 10px; flex: 0 0 auto;
  padding: 8px 10px; border-radius: 7px; background: rgba(255,255,255,.05);
  border: 1px solid rgba(80,100,150,.2);
}
.ms-presenter-elapsed { font: 700 26px/1 Consolas, monospace; letter-spacing: .04em; }
.ms-presenter-elapsed.ms-paused { color: rgba(155,180,215,.55); }
.ms-presenter-wall { font: 12px/1 Consolas, monospace; color: rgba(155,180,215,.7); }
.ms-presenter-clock-btns { margin-left: auto; display: flex; gap: 5px; }
.ms-presenter-notes {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; white-space: pre-wrap;
  padding: 11px 12px; border-radius: 7px; font-size: 15px; line-height: 1.6;
  background: rgba(0,0,0,.3); border: 1px solid rgba(80,100,150,.2);
}
.ms-presenter-notes.ms-empty { color: rgba(155,180,215,.42); font-style: italic; }

/* ── Collapsible sections ───────────────────────────────────────────────────
   Ported from the slide editor's .ms-sledit-sec / .ms-sledit-seclabel: dim
   uppercase heading with an accent tick, a ▾ chip that rotates when shut, and
   .collapsed hiding every child but the heading. Same idiom, same muscle
   memory, one delegated handler for all four sections.
   The chip is a real <button> here where the editor uses an ::after — the
   editor needs the pseudo-element because showPanel rewrites its labels with
   textContent, whereas these labels are static, so a button costs nothing and
   is keyboard-reachable. */
.ms-presenter-sec { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.ms-presenter-seclabel {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  cursor: pointer; user-select: none;
  font: 700 10px/1 'Segoe UI', system-ui, sans-serif; letter-spacing: .1em;
  text-transform: uppercase; color: rgba(155,180,215,.6);
  transition: color .14s ease;
}
.ms-presenter-seclabel:hover { color: #dce8f5; }
/* Accent tick: what turns a dim uppercase line into a section heading. */
.ms-presenter-seclabel::before {
  content: ''; flex: none; width: 3px; height: 11px; border-radius: 2px;
  background: #EF9F27; opacity: .5; transition: opacity .14s ease;
}
.ms-presenter-seclabel:hover::before { opacity: 1; }
.ms-presenter-sectoggle {
  margin-left: auto; flex: none; width: 18px; height: 18px; padding: 0;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  font: inherit; font-size: 10px; line-height: 1; color: #dce8f5;
  background: rgba(0,0,0,.3); border: 1px solid rgba(80,100,150,.28);
  border-radius: 5px;
  transition: transform .16s ease, background .14s ease, border-color .14s ease, color .14s ease;
}
.ms-presenter-seclabel:hover .ms-presenter-sectoggle {
  background: #EF9F27; border-color: transparent; color: #14181f;
}
/* Rotated rather than swapped for '▸': the turn is what reads as opening and
   closing, and a swapped character cannot animate. */
.ms-presenter-sec.collapsed > .ms-presenter-seclabel .ms-presenter-sectoggle {
  transform: rotate(-90deg);
}
.ms-presenter-sec.collapsed > *:not(.ms-presenter-seclabel) { display: none; }
/* Shutting the timer must not COST the briefer the timer — the elapsed value
   rides in the heading whenever that section is closed. */
.ms-presenter-secpeek { display: none; font: 700 11px/1 Consolas, monospace; color: #EF9F27; }
.ms-presenter-sec.collapsed .ms-presenter-secpeek { display: inline-flex; }

/* Who gives way when the window is short. --nowh is the preview's flex-basis
   as a percentage of the panel; the resizer writes it, _restoreLayout replays
   it, and the notes take whatever is left. */
.ms-presenter-sec[data-sec="clock"] { flex: 0 0 auto; }
/* min-height covers the heading plus the box's own 60px floor: without it a
   short window with the jump grid open shrinks the section below its contents
   and the preview paints over the notes. Under that much pressure the grid and
   the notes give way instead, which is the right order. */
.ms-presenter-sec[data-sec="now"] { flex: 0 1 var(--nowh, 46%); min-height: 84px; }
.ms-presenter-sec[data-sec="notes"] { flex: 1 1 auto; }
.ms-presenter-sec[data-sec="next"] { flex: 0 0 auto; }
/* Notes shut → nobody would claim the freed height (a flex column parks its
   slack after the last item), so hand it to the preview — unless the preview is
   itself shut, in which case it must not grow into the space it just gave up. */
.ms-presenter.ms-nonotes .ms-presenter-sec[data-sec="now"]:not(.collapsed) { flex-grow: 1; }
/* MUST come after the per-section rules (equal specificity, later wins): a shut
   section is a heading and nothing else, so it drops its basis and its floor —
   otherwise collapsing the preview would leave 46% of the panel empty. */
.ms-presenter-sec.collapsed { flex: 0 0 auto; min-height: 0; }

/* The current slide, big. Only worth showing in the POPPED-OUT window: docked
   in-page the live map is right behind the panel, so a preview of it would be
   redundant and would eat the notes' vertical space. The splitter goes with
   it — there is nothing to split when the preview isn't there. */
.ms-presenter:not(.ms-windowed) .ms-presenter-now,
.ms-presenter:not(.ms-windowed) .ms-presenter-resizer { display: none; }
.ms-presenter-nowbox {
  /* Fills whatever height the split gives it and lets the image letterbox
     inside (object-fit below). An aspect-ratio here instead would fight the
     split: the box would take its height from the panel's WIDTH and the drag
     would only ever add black bars. */
  flex: 1 1 auto; min-height: 60px; width: 100%;
  border-radius: 7px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg,#26313a,#17202a) center/contain no-repeat;
  border: 1px solid rgba(80,100,150,.28);
  color: rgba(155,180,215,.45); font-size: 11px; text-align: center; padding: 6px;
  box-sizing: border-box;
}
.ms-presenter-nowbox img { width: 100%; height: 100%; object-fit: contain; }

/* The preview / notes splitter: the editor's rail resizer turned 90° — same
   5px strip with a button riding on it, invisible until the panel is hovered.
   Drag moves the boundary, double-click resets, the button shuts the preview
   outright. The negative margin cancels the column's own 10px gaps, so the
   strip costs about as much room as the single gap it replaces. */
.ms-presenter-resizer {
  position: relative; flex: 0 0 auto; height: 5px; margin: -7px 0;
  cursor: row-resize; background: transparent;
}
.ms-presenter-resizer:hover { background: rgba(100,180,255,.18); border-radius: 3px; }
body.ms-presenter-resizing { cursor: row-resize; user-select: none; }
.ms-presenter-paneltoggle {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 40px; height: 15px; padding: 0; cursor: pointer; z-index: 6;
  display: flex; align-items: center; justify-content: center;
  background: rgba(12,15,20,.94); color: rgba(155,180,215,.8);
  border: 1px solid rgba(80,100,150,.28); border-radius: 5px;
  font: inherit; font-size: 10px; line-height: 1;
  opacity: 0; transition: opacity .14s ease;
}
.ms-presenter:hover .ms-presenter-paneltoggle { opacity: 1; }
.ms-presenter-paneltoggle:hover { color: #dce8f5; border-color: #EF9F27; }

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
  flex: 0 0 auto; font: 11px/1 Consolas, monospace; color: rgba(155,180,215,.75);
  padding: 6px 9px; border-radius: 6px; background: rgba(239,159,39,.12);
  border: 1px solid rgba(239,159,39,.35);
}
/* Never shrinks, never scrolls away — this is the panel's escape hatch. The auto
   margin is a no-op while the notes are absorbing the slack; it only bites when
   the briefer has collapsed enough sections to leave the column short, and then
   it keeps the transport at the bottom edge instead of floating it mid-panel. */
.ms-presenter-btns {
  display: flex; flex-wrap: wrap; gap: 6px; flex: 0 0 auto; margin-top: auto;
}
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
  gap: 7px; overflow-y: auto; max-height: 34%;
  /* 0 1 auto + min-height:0 is what lets a 100-slide deck scroll INSIDE the
     grid instead of pushing the buttons off the bottom of the window. */
  flex: 0 1 auto; min-height: 0;
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
/* Hidden slides stay reachable from the grid but must not read as part of the
   running deck — scrimmed thumbnail, struck-through number (as in the sorter). */
.ms-presenter-gtile.ms-hidden::before {
  content: ''; position: absolute; inset: 0;
  background: rgba(8,11,16,.68); pointer-events: none;
}
.ms-presenter-gtile.ms-hidden b { text-decoration: line-through; color: #9bb4d7; }
`;

/** Standalone document for the popped-out window — dark, no margins. */
const WINDOW_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Presenter View</title><style>
html,body{margin:0;height:100%;background:#0c0f14;overflow:hidden;}
</style></head><body></body></html>`;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Collapsible sections, in panel order. Also the whitelist `_restoreLayout`
 * validates stored names against — nothing read out of localStorage ever
 * reaches a selector, so a corrupted entry can't do more than be ignored.
 */
const SEC_NAMES = ['clock', 'now', 'notes', 'next'] as const;
type SecName = (typeof SEC_NAMES)[number];

/** What each toggle's tooltip calls its section. */
const SEC_LABELS: Record<SecName, string> = {
  clock: 'the timer',
  now: 'the slide preview',
  notes: 'the speaker notes',
  next: 'the next slide',
};

/** Layout keys, named after the slide editor's (ms-sledit-sections / -rails). */
const SEC_COLLAPSE_KEY = 'ms-presenter-sections';
const SPLIT_KEY = 'ms-presenter-split';

/**
 * Preview height as a percentage of the panel. The upper bound is not squeamish
 * about space, it is about the 16:9 image: past ~65% the box is taller than the
 * slide's own aspect and the extra pixels become letterbox, not detail.
 */
/** The ▾ chip every section heading ends with; titles are filled in by _syncLayoutChrome. */
const SEC_TOGGLE = `<button class="ms-presenter-sectoggle" type="button">▾</button>`;

const NOW_PCT_DEFAULT = 46;
const NOW_PCT_MIN = 28;
const NOW_PCT_MAX = 65;
const clampPct = (n: number): number =>
  Math.min(NOW_PCT_MAX, Math.max(NOW_PCT_MIN, Math.round(n)));

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
  /** Source currently in the "On screen now" box — see update()'s repaint guard. */
  private _nowSrc = '';
  /** Preview height as a % of the panel; the splitter's only piece of state. */
  private _nowPct = NOW_PCT_DEFAULT;
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
      <div class="ms-presenter-sec" data-sec="clock">
        <div class="ms-presenter-seclabel">Timer
          <span class="ms-presenter-secpeek"></span>
          ${SEC_TOGGLE}
        </div>
        <div class="ms-presenter-clock">
          <span class="ms-presenter-elapsed">00:00</span>
          <span class="ms-presenter-wall"></span>
          <span class="ms-presenter-clock-btns">
            <button class="ms-presenter-btn" data-act="timer" title="Pause / resume the elapsed timer">❚❚</button>
            <button class="ms-presenter-btn" data-act="reset" title="Reset the elapsed timer (T)">↺</button>
          </span>
        </div>
      </div>
      <div class="ms-presenter-sec ms-presenter-now" data-sec="now">
        <div class="ms-presenter-seclabel">On screen now ${SEC_TOGGLE}</div>
        <div class="ms-presenter-nowbox"></div>
      </div>
      <div class="ms-presenter-builds" hidden></div>
      <div class="ms-presenter-resizer" title="Drag to resize · double-click to reset">
        <button class="ms-presenter-paneltoggle" type="button">▴</button>
      </div>
      <div class="ms-presenter-sec" data-sec="notes">
        <div class="ms-presenter-seclabel">Speaker notes ${SEC_TOGGLE}</div>
        <div class="ms-presenter-notes"></div>
      </div>
      <div class="ms-presenter-sec" data-sec="next">
        <div class="ms-presenter-seclabel">Next ${SEC_TOGGLE}</div>
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

    // Collapsible headings. One delegated handler covers all four sections, and
    // the ▾ chip rides INSIDE its heading so clicking either does the same
    // thing. Section clicks carry no data-act, so the handler above ignores them.
    root.addEventListener('click', (e) => {
      const label = (e.target as HTMLElement)?.closest?.('.ms-presenter-seclabel');
      const name = (label?.closest('.ms-presenter-sec') as HTMLElement | null)?.dataset.sec;
      if (!name) return;
      e.stopPropagation();
      this.toggleSection(name as SecName);
    });
    this._wireResizer();

    this._startTicking();
    this._nowSrc = ''; // fresh DOM — the preview box has to be painted again
    this._restoreLayout();
    // Primes the heading's elapsed chip too, so a panel that mounts with the
    // timer already collapsed isn't blank there until the next tick.
    this._paintClock();
    if (this._last) this.update(this._last);
    this._renderGrid();
  }

  // ── Layout: collapsible sections + preview/notes splitter ──────────────────

  private _sec(name: SecName): HTMLElement | null {
    return this._root?.querySelector(`.ms-presenter-sec[data-sec="${name}"]`) ?? null;
  }

  private _isShut(name: SecName): boolean {
    return !!this._sec(name)?.classList.contains('collapsed');
  }

  /** Collapse / expand one section — the heading, and the splitter's button. */
  public toggleSection(name: SecName): void {
    const sec = this._sec(name);
    if (!sec) return;
    sec.classList.toggle('collapsed');
    this._syncLayoutChrome();
    this._persistLayout();
  }

  /**
   * Drag to move the preview/notes boundary, double-click to reset, click the
   * button on the strip to shut the preview. Mirrors SlideEditorUI._wireResizer,
   * with one difference that matters: the move/up listeners go on the panel's
   * OWN window, which is the pop-out, not the map window this class runs in.
   */
  private _wireResizer(): void {
    const root = this._root;
    const handle = root?.querySelector('.ms-presenter-resizer') as HTMLElement | null;
    if (!root || !handle) return;
    const toggle = handle.querySelector('.ms-presenter-paneltoggle') as HTMLElement | null;

    toggle?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.toggleSection('now');
    });

    handle.addEventListener('mousedown', (down) => {
      if (down.target === toggle) return; // the button is a click, not a drag
      if (this._isShut('now')) return; // nothing to size — use the button
      down.preventDefault();
      const doc = root.ownerDocument;
      const win = doc.defaultView ?? window;
      const startY = down.clientY;
      const startPct = this._nowPct;
      const panelH = root.clientHeight || 1;
      doc.body.classList.add('ms-presenter-resizing');
      const move = (ev: MouseEvent) => {
        this._nowPct = clampPct(startPct + ((ev.clientY - startY) / panelH) * 100);
        this._applySplit();
      };
      const up = () => {
        win.removeEventListener('mousemove', move);
        win.removeEventListener('mouseup', up);
        doc.body.classList.remove('ms-presenter-resizing');
        this._persistLayout();
      };
      win.addEventListener('mousemove', move);
      win.addEventListener('mouseup', up);
    });

    handle.addEventListener('dblclick', () => {
      this._nowPct = NOW_PCT_DEFAULT;
      this._applySplit();
      this._persistLayout();
    });
  }

  private _applySplit(): void {
    this._root?.style.setProperty('--nowh', `${this._nowPct}%`);
  }

  /** Toggle glyphs, tooltips and the notes-shut class — everything derived from state. */
  private _syncLayoutChrome(): void {
    const root = this._root;
    if (!root) return;
    root.classList.toggle('ms-nonotes', this._isShut('notes'));
    for (const name of SEC_NAMES) {
      const btn = this._sec(name)?.querySelector('.ms-presenter-sectoggle') as HTMLElement | null;
      if (!btn) continue;
      const shut = this._isShut(name);
      btn.setAttribute('aria-expanded', shut ? 'false' : 'true');
      btn.title = `${shut ? 'Show' : 'Hide'} ${SEC_LABELS[name]}`;
    }
    const pane = root.querySelector('.ms-presenter-paneltoggle') as HTMLElement | null;
    if (pane) {
      const shut = this._isShut('now');
      // Points where clicking will move the boundary, as the editor's chevrons do.
      pane.textContent = shut ? '▾' : '▴';
      pane.title = `${shut ? 'Show' : 'Hide'} ${SEC_LABELS.now}`;
    }
  }

  private _persistLayout(): void {
    const shut = SEC_NAMES.filter((name) => this._isShut(name));
    try {
      localStorage.setItem(SEC_COLLAPSE_KEY, JSON.stringify(shut));
      localStorage.setItem(SPLIT_KEY, JSON.stringify({ nowPct: this._nowPct }));
    } catch {
      /* storage disabled — the layout just doesn't outlive the window */
    }
  }

  /**
   * Replay the stored layout into a freshly mounted panel. Runs for BOTH homes,
   * which is what carries the briefer's arrangement across a dock / pop-out.
   */
  private _restoreLayout(): void {
    let shut: unknown = [];
    try {
      shut = JSON.parse(localStorage.getItem(SEC_COLLAPSE_KEY) ?? '[]');
      const split = JSON.parse(localStorage.getItem(SPLIT_KEY) ?? '{}');
      if (typeof split?.nowPct === 'number') this._nowPct = clampPct(split.nowPct);
    } catch {
      /* corrupt storage — start from the defaults */
    }
    if (Array.isArray(shut)) {
      // Whitelisted, so a junk entry is ignored rather than reaching a selector.
      for (const name of SEC_NAMES) {
        if (shut.includes(name)) this._sec(name)?.classList.add('collapsed');
      }
    }
    this._applySplit();
    this._syncLayoutChrome();
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
    // Must run BEFORE window.open: the popup steals focus and the browser drops
    // the map window out of fullscreen, which would otherwise end the show and
    // take this new window down with it.
    this._host.onWindowChange?.();
    let win: Window | null = null;
    try {
      win = window.open('', 'ms-presenter-view', this._windowFeatures());
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

    // The host re-takes fullscreen on the map window shortly after this, which
    // can pull focus back to it. Land focus on the briefer's window last, so
    // the end state is: map fullscreen on the projector, this on top here.
    window.setTimeout(() => {
      try {
        if (this._win && !this._win.closed) this._win.focus();
      } catch {}
    }, 700);

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
   * Pop-out geometry. A fixed 620×820 left the "On screen now" preview about
   * 560px wide, too small to read a slide's own text off — so take a generous
   * share of the briefer's screen instead, clamped so the window still fits and
   * centred rather than dropped wherever the browser cascades it.
   */
  private _windowFeatures(): string {
    const sw = Math.max(640, window.screen?.availWidth || 1280);
    const sh = Math.max(480, window.screen?.availHeight || 900);
    const w = Math.round(Math.max(620, Math.min(1180, sw * 0.56)));
    const h = Math.round(Math.max(700, Math.min(1200, sh * 0.94)));
    const left = Math.max(0, Math.round((sw - w) / 2));
    const top = Math.max(0, Math.round((sh - h) / 2));
    return `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no`;
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
    if (win) this._host.onWindowChange?.();
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
    const text = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    const el = root.querySelector('.ms-presenter-elapsed') as HTMLElement | null;
    if (el) {
      el.textContent = text;
      el.classList.toggle('ms-paused', !this._running);
    }
    // Same value in the heading, for when the section is collapsed. Painted
    // unconditionally — CSS decides whether it shows, so nothing here has to
    // know the section's state.
    const peek = root.querySelector('.ms-presenter-secpeek') as HTMLElement | null;
    if (peek) peek.textContent = this._running ? text : `${text} ▶`;
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
      .map((s, i) => {
        const label = String(s.title || `Slide ${i + 1}`) + (s.hidden ? ' — hidden' : '');
        return `<div class="ms-presenter-gtile${i === cur ? ' ms-cur' : ''}${
          s.hidden ? ' ms-hidden' : ''
        }" data-idx="${i}"${
          s.thumb ? ` style="background-image:url('${s.thumb}')"` : ''
        } title="${label.replace(/"/g, '&quot;')}"><b>${i + 1}</b></div>`;
      })
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
      // Full-resolution capture first, rail thumbnail only as a stand-in while
      // that is still being composed (see PresenterSlideRef.full).
      const src = data.current?.full || data.current?.thumb || '';
      // Repaint ONLY on a real change: `full` is a megabyte-class data URL and
      // update() runs on every chrome sync — rewriting the <img> each time makes
      // the box flash while the browser re-decodes the same picture.
      if (src !== this._nowSrc) {
        this._nowSrc = src;
        // A slide captured in 3D-headless has neither image — say so rather than
        // showing an empty box the briefer reads as "the screen is blank".
        now.innerHTML = src
          ? `<img src="${src}" alt="">`
          : 'No preview for this slide — check the projected screen.';
      }
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
    this._nowSrc = '';
    this._gridOpen = false;
  }
}
