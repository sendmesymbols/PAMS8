/**
 * SlideLinkDialog.ts
 *
 * The slide editor's "Link…" dialog: pick what the selected annotation jumps to
 * when it is clicked in present mode. A modal flyout over the editor stage,
 * built the same way MilSymPicker is (own DOM, own injected stylesheet, no
 * framework), because it is the same kind of thing — a chooser the editor opens
 * and forgets about.
 *
 * Two kinds of target, mirroring PowerPoint: a specific slide, or a relative
 * jump ('next', 'last slide viewed', …). Selecting a row arms it; Apply commits,
 * so the tooltip typed alongside it isn't lost to an immediate close. A
 * double-click on a row is the shortcut for "that one, no tooltip changes".
 */

import type { OverlayLink, Slide } from './BriefingTypes';
import { LINK_JUMPS, linkLabel } from './SlideLinks';

export interface SlideLinkDialogOptions {
  /** Every slide in the briefing, in order — the fixed-target list. */
  slides: readonly Slide[];
  /** Index of the slide being edited, marked in the list and skipped as a target. */
  currentIndex: number;
  /**
   * The selection's existing link, or null. With several objects selected whose
   * links differ, the caller passes null and sets `mixed`.
   */
  link: OverlayLink | null;
  /** How many objects the choice will be applied to (shown in the footer). */
  count: number;
  /** True when a multi-selection's existing links are not all the same. */
  mixed?: boolean;
  /** Commit. `null` clears the link. */
  onApply(link: OverlayLink | null): void;
}

const JUMP_HINTS: Record<string, string> = {
  next: 'Follows the slide order, so it survives reordering',
  prev: 'Follows the slide order, so it survives reordering',
  first: 'Jumps to the start of the briefing',
  last: 'Jumps to the end of the briefing',
  lastViewed: 'Returns to wherever the briefer came from',
  endShow: 'Leaves present mode',
};

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export default class SlideLinkDialog {
  private _el: HTMLElement | null = null;
  private _opts: SlideLinkDialogOptions | null = null;
  /** The armed target — what Apply will commit. */
  private _pick: OverlayLink | null = null;
  private _onKey: ((e: KeyboardEvent) => void) | null = null;
  private _outside: ((e: MouseEvent) => void) | null = null;

  public get isOpen(): boolean {
    return !!this._el;
  }

  public show(stage: HTMLElement, opts: SlideLinkDialogOptions): void {
    this.hide();
    this._injectStyles();
    this._opts = opts;
    // Start armed on whatever is already set, so Apply with no other input is a
    // no-op rather than a surprise.
    this._pick = opts.link ? { ...opts.link } : null;

    const el = document.createElement('div');
    el.className = 'ms-slink-wrap';
    el.innerHTML = `
      <div class="ms-slink" role="dialog" aria-label="Link annotation">
        <div class="ms-slink-head">
          <span class="ms-slink-title">Link</span>
          <span class="ms-slink-sub">${
            opts.mixed
              ? 'Selected objects have different links'
              : esc(linkLabel(opts.link ?? undefined, opts.slides))
          }</span>
          <button class="ms-slink-x" title="Close (Esc)">✕</button>
        </div>
        <div class="ms-slink-body">
          <div class="ms-slink-sect">Go to slide</div>
          <div class="ms-slink-slides">${this._slideRows()}</div>
          <div class="ms-slink-sect">Jump to</div>
          <div class="ms-slink-jumps">${this._jumpRows()}</div>
          <label class="ms-slink-tip">
            <span>Tooltip</span>
            <input type="text" class="ms-slink-tipin" maxlength="120"
                   placeholder="Shown on hover — defaults to the target's name"
                   value="${esc(opts.link?.tooltip ?? '')}">
          </label>
        </div>
        <div class="ms-slink-foot">
          <button class="ms-slink-remove"${opts.link || opts.mixed ? '' : ' disabled'}>Remove link</button>
          <span class="ms-slink-count">${
            opts.count > 1 ? `Applies to ${opts.count} objects` : ''
          }</span>
          <button class="ms-slink-cancel">Cancel</button>
          <button class="ms-slink-apply">Apply</button>
        </div>
      </div>`;
    stage.appendChild(el);
    this._el = el;
    this._syncSelection();

    el.addEventListener('click', (e) => this._onClick(e));
    el.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest('[data-target]') as HTMLElement | null;
      if (row) this._commit();
    });
    // A click on the backdrop (outside the panel) closes without applying.
    el.addEventListener('mousedown', (e) => {
      if (e.target === el) this.hide();
    });

    this._onKey = (e: KeyboardEvent) => {
      // Capture phase: the editor owns a lot of single-key shortcuts, and none
      // of them should fire while this dialog has the user's attention.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this._commit();
      }
    };
    document.addEventListener('keydown', this._onKey, true);

    // Scroll the current selection into view and focus the list for keyboard use.
    const active = el.querySelector('.ms-slink-row.active') as HTMLElement | null;
    active?.scrollIntoView({ block: 'center' });
    (el.querySelector('.ms-slink-tipin') as HTMLInputElement | null)?.focus();
  }

  public hide(): void {
    if (this._onKey) {
      document.removeEventListener('keydown', this._onKey, true);
      this._onKey = null;
    }
    if (this._outside) {
      document.removeEventListener('mousedown', this._outside, true);
      this._outside = null;
    }
    this._el?.remove();
    this._el = null;
    this._opts = null;
    this._pick = null;
  }

  public dispose(): void {
    this.hide();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _slideRows(): string {
    const opts = this._opts!;
    if (!opts.slides.length) return '<div class="ms-slink-empty">No slides</div>';
    return opts.slides
      .map((s, i) => {
        const isSelf = i === opts.currentIndex;
        const title = esc(String(s.title ?? '').trim() || 'Untitled');
        const thumb = s.thumbnailDataUrl
          ? `<img class="ms-slink-thumb" src="${s.thumbnailDataUrl}" alt="">`
          : '<span class="ms-slink-thumb ms-slink-nothumb"></span>';
        // Linking a slide to itself is never what someone means, so it is shown
        // (for orientation in the list) but not selectable.
        return `<div class="ms-slink-row${isSelf ? ' self' : ''}"${
          isSelf ? '' : ` data-target="slide:${esc(s.id)}"`
        } title="${title}">
            ${thumb}
            <span class="ms-slink-no">${i + 1}</span>
            <span class="ms-slink-name">${title}</span>
            ${isSelf ? '<span class="ms-slink-tag">this slide</span>' : ''}
          </div>`;
      })
      .join('');
  }

  private _jumpRows(): string {
    return LINK_JUMPS.map(
      (j) =>
        `<div class="ms-slink-row" data-target="jump:${j}" title="${esc(JUMP_HINTS[j] ?? '')}">
          <span class="ms-slink-jicon">↪</span>
          <span class="ms-slink-name">${esc(linkLabel({ jump: j }, []))}</span>
          <span class="ms-slink-hint">${esc(JUMP_HINTS[j] ?? '')}</span>
        </div>`,
    ).join('');
  }

  /** Reflect `_pick` in the row highlighting. */
  private _syncSelection(): void {
    const key = this._pick?.slideId
      ? `slide:${this._pick.slideId}`
      : this._pick?.jump
        ? `jump:${this._pick.jump}`
        : null;
    this._el?.querySelectorAll('.ms-slink-row').forEach((row: any) => {
      row.classList.toggle('active', !!key && row.dataset.target === key);
    });
  }

  private _onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest('.ms-slink-x') || t.closest('.ms-slink-cancel')) {
      this.hide();
      return;
    }
    if (t.closest('.ms-slink-remove')) {
      this._opts?.onApply(null);
      this.hide();
      return;
    }
    if (t.closest('.ms-slink-apply')) {
      this._commit();
      return;
    }
    const row = t.closest('[data-target]') as HTMLElement | null;
    if (row) {
      const target = row.dataset.target!;
      this._pick = target.startsWith('slide:')
        ? { slideId: target.slice(6) }
        : { jump: target.slice(5) as OverlayLink['jump'] };
      this._syncSelection();
    }
  }

  private _commit(): void {
    const opts = this._opts;
    if (!opts) return;
    if (!this._pick) {
      // Apply with nothing armed and nothing to clear — treat as cancel rather
      // than silently wiping a link the user never touched.
      this.hide();
      return;
    }
    const tip = (
      this._el?.querySelector('.ms-slink-tipin') as HTMLInputElement | null
    )?.value.trim();
    const link: OverlayLink = { ...this._pick };
    if (tip) link.tooltip = tip;
    else delete link.tooltip;
    opts.onApply(link);
    this.hide();
  }

  private _injectStyles(): void {
    if (document.getElementById('ms-slink-style')) return;
    const style = document.createElement('style');
    style.id = 'ms-slink-style';
    style.textContent = `
      .ms-slink-wrap {
        position: absolute; inset: 0; z-index: 60;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8,11,14,0.55);
      }
      .ms-slink {
        width: 420px; max-width: calc(100% - 32px); max-height: calc(100% - 40px);
        display: flex; flex-direction: column;
        background: rgba(24,29,35,0.99); border: 1px solid rgba(255,255,255,0.16);
        border-radius: 10px; box-shadow: 0 16px 44px rgba(0,0,0,0.55);
        font: 12px/1.4 system-ui, sans-serif; color: #dde3e8;
      }
      .ms-slink-head {
        display: flex; align-items: center; gap: 8px; padding: 9px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      .ms-slink-title { font-weight: 600; font-size: 13px; }
      .ms-slink-sub {
        flex: 1; min-width: 0; color: #93a1ad; font-size: 11px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ms-slink-x {
        background: none; border: none; color: #93a1ad; cursor: pointer;
        font-size: 13px; padding: 2px 4px; border-radius: 4px;
      }
      .ms-slink-x:hover { color: #dde3e8; background: rgba(255,255,255,0.08); }
      .ms-slink-body { overflow: auto; padding: 4px 10px 10px; }
      .ms-slink-sect {
        margin: 10px 0 5px; font-size: 10px; letter-spacing: 0.08em;
        text-transform: uppercase; color: #7d8b97;
      }
      .ms-slink-slides { max-height: 208px; overflow: auto; }
      .ms-slink-row {
        display: flex; align-items: center; gap: 8px;
        padding: 4px 6px; border-radius: 6px; cursor: pointer;
        border: 1px solid transparent;
      }
      .ms-slink-row:hover { background: rgba(255,255,255,0.07); }
      .ms-slink-row.active {
        background: rgba(45,108,223,0.26); border-color: rgba(45,108,223,0.85);
      }
      .ms-slink-row.self { cursor: default; opacity: 0.5; }
      .ms-slink-row.self:hover { background: none; }
      .ms-slink-thumb {
        width: 44px; height: 25px; object-fit: cover; border-radius: 3px;
        background: #101418; border: 1px solid rgba(255,255,255,0.12); flex: none;
      }
      .ms-slink-nothumb { display: inline-block; }
      .ms-slink-no {
        min-width: 18px; text-align: right; color: #93a1ad;
        font-variant-numeric: tabular-nums; flex: none;
      }
      .ms-slink-name {
        flex: 1; min-width: 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ms-slink-hint, .ms-slink-tag {
        color: #7d8b97; font-size: 10px; flex: none; max-width: 46%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ms-slink-jicon { width: 44px; text-align: center; color: #93a1ad; flex: none; }
      .ms-slink-empty { color: #7d8b97; padding: 6px; }
      .ms-slink-tip { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
      .ms-slink-tip > span { color: #93a1ad; flex: none; }
      .ms-slink-tipin {
        flex: 1; min-width: 0; padding: 4px 7px; border-radius: 5px;
        background: rgba(0,0,0,0.35); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); font: inherit;
      }
      .ms-slink-tipin:focus { outline: none; border-color: rgba(45,108,223,0.9); }
      .ms-slink-foot {
        display: flex; align-items: center; gap: 8px; padding: 9px 10px;
        border-top: 1px solid rgba(255,255,255,0.12);
      }
      .ms-slink-count { flex: 1; color: #7d8b97; font-size: 10px; }
      .ms-slink-foot button {
        padding: 4px 11px; border-radius: 5px; cursor: pointer; font: inherit;
        background: rgba(255,255,255,0.08); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16);
      }
      .ms-slink-foot button:hover:not(:disabled) { background: rgba(255,255,255,0.14); }
      .ms-slink-foot button:disabled { opacity: 0.4; cursor: default; }
      .ms-slink-apply {
        background: rgba(45,108,223,0.9) !important; border-color: rgba(45,108,223,1) !important;
        color: #fff !important;
      }
      .ms-slink-remove { color: #ff9a90 !important; }`;
    document.head.appendChild(style);
  }
}
