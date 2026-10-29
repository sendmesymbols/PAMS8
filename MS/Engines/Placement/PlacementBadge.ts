/**
 * PlacementBadge.ts
 *
 * The small cursor-following label the Placement Advisor shows while drawing.
 * Position updates are direct style writes from a passive pointermove listener
 * (no layout reads, no timers), so following the cursor costs nothing.
 */

import type { PlacementVerdict } from './PlacementTypes';

const STYLE_ID = 'ms-placement-badge-style';

const CSS = `
.ms-placement-badge{position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;
  max-width:260px;padding:4px 9px;border-radius:6px;font:600 12px/1.35 system-ui,Segoe UI,Arial,sans-serif;
  color:#fff;background:rgba(40,40,40,.92);border:1px solid rgba(255,255,255,.25);
  box-shadow:0 2px 8px rgba(0,0,0,.35);white-space:normal;display:none}
.ms-placement-badge[data-verdict="ok"]{background:rgba(30,120,60,.94)}
.ms-placement-badge[data-verdict="near"]{background:rgba(170,120,10,.95)}
.ms-placement-badge[data-verdict="caution"]{background:rgba(180,100,10,.95)}
.ms-placement-badge[data-verdict="partial"]{background:rgba(200,80,20,.95)}
.ms-placement-badge[data-verdict="in"]{background:rgba(190,35,35,.95)}
.ms-placement-badge[data-verdict="unknown"]{background:rgba(90,90,90,.9);font-weight:500}
`;

export class PlacementBadge {
  private _el: HTMLDivElement | null = null;
  private _x = 0;
  private _y = 0;
  private _hasPointer = false;

  /** Pointer position in client coordinates; call from a pointermove listener. */
  moveTo(clientX: number, clientY: number): void {
    this._x = clientX;
    this._y = clientY;
    this._hasPointer = true;
    if (this._el && this._el.style.display !== 'none') this._place();
  }

  show(v: PlacementVerdict): void {
    const el = this._ensure();
    el.dataset.verdict = v.verdict;
    el.textContent = v.message;
    if (!this._hasPointer) {
      this._x = Math.round(window.innerWidth / 2);
      this._y = 90;
    }
    el.style.display = 'block';
    this._place();
  }

  hide(): void {
    if (this._el) this._el.style.display = 'none';
  }

  destroy(): void {
    this._el?.remove();
    this._el = null;
    this._hasPointer = false;
  }

  private _place(): void {
    if (!this._el) return;
    this._el.style.transform = `translate(${Math.round(this._x + 16)}px, ${Math.round(this._y + 20)}px)`;
  }

  private _ensure(): HTMLDivElement {
    if (this._el) return this._el;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const el = document.createElement('div');
    el.className = 'ms-placement-badge';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    this._el = el;
    return el;
  }
}
