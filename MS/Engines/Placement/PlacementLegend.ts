/**
 * PlacementLegend.ts
 *
 * Two small pieces of orientation for the Placement Advisor:
 *  - a colour key for the terrain overlay (it paints four colours and says nothing about what they
 *    mean), docked bottom-left on the map through the view's own UI so it follows 2D / 3D switches;
 *  - a one-line hint chip ("pick a symbol to see terrain advice", "this symbol gets no terrain
 *    advice because it is not terrain-bound").
 * Built from DOM nodes and `textContent` only.
 */

const STYLE_ID = 'ms-placement-legend-style';

const CSS = `
.ms-pl{font:400 12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;background:rgba(27,31,37,.92);
  border:1px solid #39414b;border-radius:8px;padding:7px 10px;box-shadow:0 2px 8px rgba(0,0,0,.35);max-width:260px}
.ms-pl-title{font-weight:600;margin-bottom:4px}
.ms-pl-row{display:flex;align-items:center;gap:8px;padding:1px 0}
.ms-pl-sw{flex:none;width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,.35)}
.ms-pl-hint{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:2147482500;display:none;
  max-width:min(90vw,460px);padding:7px 14px;border-radius:999px;background:#242a32;border:1px solid #4a535e;
  box-shadow:0 3px 12px rgba(0,0,0,.4);font:400 12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;pointer-events:none}
`;

export interface LegendEntry {
  label: string;
  /** RGBA as the overlay paints it. */
  rgba: readonly number[];
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(cls: string, text?: string): HTMLDivElement {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class PlacementLegend {
  private _card: HTMLDivElement | null = null;
  private _view: any = null;
  private _hint: HTMLDivElement | null = null;
  private _hintKind = '';
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;

  /** Show (or update) the colour key on this view; moves it when the view has changed. */
  show(view: any, title: string, entries: LegendEntry[]): void {
    ensureStyle();
    if (!this._card) {
      this._card = el('ms-pl');
      this._card.setAttribute('role', 'group');
      this._card.setAttribute('aria-label', 'Terrain overlay key');
    }
    const rows = entries.map((e) => {
      const row = el('ms-pl-row');
      const sw = el('ms-pl-sw');
      const [r, g, b, a] = e.rgba;
      // The overlay is drawn over imagery at partial strength; the key shows it a little firmer so it reads on the dark card.
      sw.style.background = `rgba(${r},${g},${b},${Math.min(1, Math.max(0.55, a / 255 + 0.25))})`;
      row.append(sw, el('', e.label));
      return row;
    });
    this._card.replaceChildren(el('ms-pl-title', title), ...rows);
    if (this._view !== view) {
      this._detach();
      this._view = view;
      try {
        view.ui.add(this._card, { position: 'bottom-left', index: 0 });
      } catch {
        // no view UI (headless host): float it instead
        this._card.style.cssText = 'position:fixed;left:12px;bottom:40px;z-index:2147482400';
        document.body.appendChild(this._card);
      }
    }
  }

  hide(): void {
    this._detach();
    this._view = null;
  }

  /** A one-line chip at the bottom of the screen. `kind` lets the caller take back only its own hint. */
  hint(text: string, kind: string, ms = 5000): void {
    ensureStyle();
    if (!this._hint) {
      this._hint = el('ms-pl-hint');
      this._hint.setAttribute('role', 'status');
      document.body.appendChild(this._hint);
    }
    this._hint.textContent = text;
    this._hint.style.display = 'block';
    this._hintKind = kind;
    if (this._hintTimer !== null) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.hideHint(), ms);
  }

  /** Hide the hint; with `kind`, only if it is that hint. */
  hideHint(kind?: string): void {
    if (kind !== undefined && kind !== this._hintKind) return;
    if (this._hintTimer !== null) clearTimeout(this._hintTimer);
    this._hintTimer = null;
    this._hintKind = '';
    if (this._hint) this._hint.style.display = 'none';
  }

  destroy(): void {
    this.hide();
    this.hideHint();
    this._hint?.remove();
    this._hint = null;
    this._card = null;
  }

  private _detach(): void {
    if (!this._card) return;
    try {
      this._view?.ui?.remove(this._card);
    } catch {
      /* view already torn down */
    }
    this._card.remove();
  }
}
