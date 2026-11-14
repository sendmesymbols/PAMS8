/**
 * GroundGuideKeyNotice.ts
 *
 * The key notice (user, 2026-11-14: "X key and all the available keys, we can give user a notification bottom center on
 * the screen about modes, keys and what will they do, 5 seconds"). When a Ground Guide key changes a mode (F, Shift+F, X,
 * [ ], J, V, Shift+V, H, P), a small card at the foot of the screen, in the middle, says the mode now and what it shows,
 * then the keys that work in it and what each does. It goes after `ms` (5 s by default); the next key replaces it.
 *
 * It never takes a click (pointer-events: none) and docks clear of whatever the host lays over the foot of the map (the
 * Ground Detail, the answer bars, the info bars): from the bottom it walks up until the map's own surface shows under the
 * whole card (`document.elementsFromPoint`), the way the threat marker docks. `groundGuide.card.keyNotice: false` turns it
 * off (the old one-line chip and the cursor card's flash come back).
 */

import { ACCENT, FONT, FS, FW, LINE, SURFACE, TEXT } from './GroundGuideTokens';

/** A key and what it does now, e.g. ['X', 'your options']. A key name with spaces shows a cap per word ('[ ]'). */
export type KeyNoticeKey = [string, string];

export interface KeyNoticeContent {
  /** The mode now, short: "Ext View on", "Your options against the threat". */
  mode: string;
  /** What it shows or did, one short sentence. */
  text?: string;
  /** The keys that work now. */
  keys?: KeyNoticeKey[];
  /** Amber head: nothing changed (no better Posn here). */
  warn?: boolean;
}

const STYLE_ID = 'ms-ggk-style';
const CSS = `
.ms-ggk{position:fixed;left:50%;bottom:56px;transform:translate(-50%,6px);z-index:2147482600;max-width:min(92vw,620px);
  padding:9px 14px 10px;border-radius:12px;background:${SURFACE.card};border:1px solid ${LINE.ring};
  box-shadow:0 6px 22px rgba(0,0,0,.45);font:${FW.regular} ${FS.body}px/1.4 ${FONT};color:${TEXT.main};pointer-events:none;
  opacity:0;transition:opacity .18s ease-out,transform .18s ease-out}
.ms-ggk.ms-on{opacity:1;transform:translate(-50%,0)}
.ms-ggk-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.ms-ggk-m{font-weight:${FW.bold};font-size:${FS.value}px;color:${TEXT.strong}}
.ms-ggk-m.ms-warn{color:${TEXT.warn}}
.ms-ggk-t{color:${TEXT.label}}
.ms-ggk-k{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:7px;padding-top:7px;border-top:1px solid ${LINE.hair};font-size:${FS.meta}px;color:${TEXT.soft}}
.ms-ggk-k>span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.ms-ggk-c{display:inline-block;min-width:20px;padding:1px 5px;border:1px solid ${LINE.ring};border-bottom-width:2px;border-radius:5px;
  background:${SURFACE.raised};color:${TEXT.strong};font-weight:${FW.bold};font-size:${FS.meta}px;line-height:16px;text-align:center}
.ms-ggk-c+.ms-ggk-c{margin-left:-2px}
.ms-ggk-k>span:first-child .ms-ggk-c{border-color:${ACCENT}}
@media (prefers-reduced-motion: reduce){.ms-ggk{transition:none;transform:translate(-50%,0)}}
`;

function ensureCss(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class GroundGuideKeyNotice {
  private _el: HTMLElement | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _hideTimer: ReturnType<typeof setTimeout> | null = null;

  get isShown(): boolean {
    return !!this._el?.classList.contains('ms-on');
  }

  /** Show `c` for `ms` (5 s by default), replacing what is shown. */
  show(c: KeyNoticeContent, ms = 5000): void {
    if (typeof document === 'undefined') return;
    ensureCss();
    if (!this._el) {
      this._el = el('div', 'ms-ggk');
      this._el.setAttribute('role', 'status');
      this._el.setAttribute('aria-live', 'polite');
      document.body.appendChild(this._el);
    }
    const root = this._el;
    const head = el('div', 'ms-ggk-h');
    head.append(el('span', c.warn ? 'ms-ggk-m ms-warn' : 'ms-ggk-m', c.mode));
    if (c.text) head.append(el('span', 'ms-ggk-t', c.text));
    const parts: HTMLElement[] = [head];
    if (c.keys?.length) {
      const row = el('div', 'ms-ggk-k');
      for (const [k, what] of c.keys) {
        const item = el('span');
        for (const cap of k.split(' ')) item.append(el('span', 'ms-ggk-c', cap));
        item.append(what);
        row.append(item);
      }
      parts.push(row);
    }
    root.replaceChildren(...parts);
    if (this._hideTimer !== null) clearTimeout(this._hideTimer);
    this._hideTimer = null;
    root.style.display = 'block';
    this._dock(root);
    void root.offsetWidth; // the fade-in starts from the hidden state
    root.classList.add('ms-on');
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = null;
    const root = this._el;
    if (!root || !root.classList.contains('ms-on')) return;
    root.classList.remove('ms-on');
    this._hideTimer = setTimeout(() => {
      this._hideTimer = null;
      if (!root.classList.contains('ms-on')) root.style.display = 'none';
    }, 220);
  }

  destroy(): void {
    if (this._timer !== null) clearTimeout(this._timer);
    if (this._hideTimer !== null) clearTimeout(this._hideTimer);
    this._timer = this._hideTimer = null;
    this._el?.remove();
    this._el = null;
  }

  /**
   * Dock above whatever covers the foot of the map at the middle: walk up from 56 px over the bottom edge in 8 px steps
   * until the map surface (or the page itself) shows under the card's middle and both ends; up to near the top.
   */
  private _dock(root: HTMLElement): void {
    const W = window.innerWidth, H = window.innerHeight;
    root.style.bottom = '56px';
    const r = root.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (!w || !h || typeof document.elementsFromPoint !== 'function') return;
    const free = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const top = document.elementsFromPoint(x, y).find((e) => e !== root && !root.contains(e));
      if (!top || top === document.body || top === document.documentElement) return true;
      return !!top.closest('.esri-view-surface');
    };
    const cx = W / 2;
    // Up to near the top: the Ground Detail can fill the lower half or more, and the notice then sits above it.
    for (let b = 56; b <= H - h - 72; b += 8) {
      const y0 = H - b - h - 4, y1 = H - b + 4; // a little outside the card, above and below
      const xs = [cx - w / 2 - 4, cx, cx + w / 2 + 4];
      if (xs.every((x) => free(x, y0) && free(x, y1) && free(x, (y0 + y1) / 2))) {
        root.style.bottom = `${b}px`;
        return;
      }
    }
  }
}
