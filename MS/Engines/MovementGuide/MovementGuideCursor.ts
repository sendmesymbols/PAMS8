/**
 * MovementGuideCursor.ts
 *
 * The Mov Guide's cursor card (user, 2026-11-11: "mouse move card as well"): a small card beside the mouse while the
 * Mov Detail is open, saying what is under the pointer for the open card: the route's km and dangers there and what
 * the card plans for it (the picket that sees it, the bound and when the packets pass, the site), the cordon sector,
 * the patrol leg, the lane or post; off any plan, the ground, the people and the nearest place; while drawing, the
 * route so far. A coloured edge carries the worst danger there; a mini strip shows where along the route it is.
 * DOM only; the engine works out the words (`HoverInfo`).
 */

import Utils from '../../Support/utils';

export interface HoverInfo {
  title: string;
  /** Danger colour for the edge (grey when none). */
  colour: string;
  lines: Array<{ k?: string; v: string; c?: string }>;
  /** Where along the route the pointer is (0-1), with the route's danger bands (colour per 0-1 run). */
  strip?: { at: number; runs: Array<{ from: number; to: number; c: string }> } | null;
  hint?: string;
}

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));
const CSS = `
.mgx{position:absolute;z-index:46;pointer-events:none;min-width:190px;max-width:290px;background:rgba(20,24,29,.95);color:#e8ebee;border:1px solid rgba(255,255,255,.16);border-left:5px solid #8a96a3;
 border-radius:9px;box-shadow:0 8px 22px rgba(0,0,0,.45);font:12.5px/1.35 system-ui,Segoe UI,Arial,sans-serif;padding:7px 10px 8px;transition:opacity .12s}
.mgx-t{font-weight:750;font-size:13px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mgx-l{display:flex;gap:6px;align-items:baseline}
.mgx-k{color:#aab3bd;flex:none;min-width:58px}
.mgx-v{min-width:0;overflow-wrap:anywhere}
.mgx-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:0}
.mgx-h{margin-top:4px;color:#ffd166;font-size:11.5px}
.mgx-s{margin-top:5px;display:block}
`;

export class MovementGuideCursor {
  private _el: HTMLDivElement | null = null;
  private _host: HTMLElement | null = null;
  private _key = '';

  show(host: HTMLElement | null, x: number, y: number, info: HoverInfo, minTop = 8): void {
    if (!host) return;
    if (!document.getElementById('mgx-style')) {
      const st = document.createElement('style');
      st.id = 'mgx-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!this._el || this._host !== host) {
      this._el?.remove();
      this._el = document.createElement('div');
      this._el.className = 'mgx';
      this._el.setAttribute('aria-hidden', 'true');
      host.appendChild(this._el);
      this._host = host;
    } else if (!this._el.isConnected) host.appendChild(this._el);
    const el = this._el;
    const key = JSON.stringify(info);
    if (key !== this._key) {
      this._key = key;
      el.style.borderLeftColor = info.colour;
      let strip = '';
      if (info.strip) {
        const w = 200;
        const runs = info.strip.runs.map((r) => `<rect x="${(r.from * w).toFixed(1)}" y="3" width="${Math.max(1.5, (r.to - r.from) * w).toFixed(1)}" height="6" fill="${r.c}"/>`).join('');
        const ax = Math.max(0, Math.min(1, info.strip.at)) * w;
        strip = `<svg class="mgx-s" viewBox="0 0 ${w} 14" width="${w}" height="14"><rect x="0" y="3" width="${w}" height="6" rx="3" fill="#2b313a"/>${runs}<path d="M${ax.toFixed(1)} 0 l4 -0 l-4 6 l-4 -6 z" fill="#fff"/><line x1="${ax.toFixed(1)}" y1="2" x2="${ax.toFixed(1)}" y2="12" stroke="#fff" stroke-width="1.5"/></svg>`;
      }
      el.innerHTML = `<div class="mgx-t">${esc(info.title)}</div>${info.lines
        .map((l) => `<div class="mgx-l">${l.k ? `<span class="mgx-k">${esc(l.k)}</span>` : ''}<span class="mgx-v">${l.c ? `<span class="mgx-dot" style="background:${l.c}"></span>` : ''}${esc(l.v)}</span></div>`)
        .join('')}${strip}${info.hint ? `<div class="mgx-h">${esc(info.hint)}</div>` : ''}`;
    }
    el.style.opacity = '1';
    // Beside the pointer, kept inside the map and clear of the bottom card.
    const hr = host.getBoundingClientRect();
    const w = el.offsetWidth || 220;
    const h = el.offsetHeight || 90;
    const bottomCard = host.querySelector('.mgd') as HTMLElement | null;
    const floor = bottomCard?.isConnected ? bottomCard.getBoundingClientRect().top - hr.top - 8 : hr.height - 8;
    let left = x + 18;
    let top = y + 18;
    if (left + w > hr.width - 8) left = x - w - 18;
    if (top + h > floor) top = y - h - 18;
    // Never under the host's toolbars nor over the bottom card: squeeze between them, beside the pointer.
    top = Math.max(minTop, Math.min(top, floor - h));
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(minTop, top)}px`;
  }

  hide(): void {
    if (this._el) this._el.style.opacity = '0';
  }

  destroy(): void {
    this._el?.remove();
    this._el = null;
    this._host = null;
    this._key = '';
    document.getElementById('mgx-style')?.remove();
  }
}
