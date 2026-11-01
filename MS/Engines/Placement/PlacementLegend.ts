/**
 * PlacementLegend.ts
 *
 * Two small pieces of orientation for the Placement Advisor:
 *  - the Legend, docked bottom-left on the map through the view's own UI so it follows 2D / 3D switches.
 *    It names the mode the ground is judged for and steps between modes (Previous / Next, or a mode's
 *    icon), keys the overlay's four colours on a ramp, lists what counts as NO-GO and SLOW-GO for that
 *    mode, and explains the P and S keys (S lights up while the quick fix can help);
 *  - a one-line hint chip ("pick a symbol to see terrain advice", "this symbol gets no terrain
 *    advice because it is not terrain-bound").
 * Built from DOM nodes and `textContent` only.
 */

const STYLE_ID = 'ms-placement-legend-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DETAILS_KEY = 'ms-placement-legend-details';

const LEGEND_CSS = `
.ms-pl{width:290px;max-width:calc(100vw - 24px);box-sizing:border-box;font:400 12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;
  background:rgba(27,31,37,.95);border:1px solid #39414b;border-radius:10px;padding:10px 12px 11px;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.ms-pl button{font:inherit;color:inherit;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:6px;cursor:pointer;padding:0}
.ms-pl button:hover{background:rgba(255,255,255,.12)}
.ms-pl button:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-pl-head{display:flex;align-items:center;gap:8px}
.ms-pl-title{font-weight:700;font-size:13px;letter-spacing:.1em;text-transform:uppercase}
.ms-pl-count{margin-left:auto;font:500 11px/1 ui-monospace,Consolas,monospace;color:#9aa3ad}
.ms-pl-more{width:22px;height:20px;font-size:11px;line-height:1}
.ms-pl-strip{display:flex;align-items:center;gap:4px;margin-top:9px}
.ms-pl-strip>button{flex:none;width:24px;height:32px;font-size:15px}
.ms-pl-icons{flex:1;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:3px}
.ms-pl-icons button{height:32px;display:flex;align-items:center;justify-content:center;color:#9aa3ad}
.ms-pl-icons button[aria-pressed="true"]{color:#1b1f25;background:#8ec1ea;border-color:#8ec1ea}
.ms-pl-name{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;margin-top:7px}
.ms-pl-name b{font-size:14px;color:#fff}
.ms-pl-tag{font-size:11px;color:#9aa3ad}
.ms-pl-tag.ms-hand{color:#ffc861}
.ms-pl-ramp{display:grid;grid-template-columns:repeat(4,1fr);margin-top:9px;border-radius:4px;overflow:hidden}
.ms-pl-ramp>i{height:10px}
.ms-pl-ramp-l{display:grid;grid-template-columns:repeat(4,1fr);font-size:10.5px;color:#9aa3ad;margin-top:4px}
.ms-pl-ramp-l>span{text-align:center}
.ms-pl-ramp-l>span:first-child{text-align:left}
.ms-pl-ramp-l>span:last-child{text-align:right}
.ms-pl-note{font-size:11px;color:#9aa3ad;margin-top:3px}
.ms-pl-list{display:flex;flex-direction:column;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.09)}
.ms-pl-cap{font-weight:700;font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px}
.ms-pl-chips{display:flex;flex-wrap:wrap;gap:4px}
.ms-pl-chips>span{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12)}
.ms-pl-keys{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.09)}
.ms-pl-key{display:flex;align-items:center;gap:7px;opacity:.45;transition:opacity .2s}
.ms-pl-key.ms-on{opacity:1}
.ms-pl-key small{display:block;font-size:10.5px;color:#9aa3ad}
.ms-pl-kbd{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:5px;
  font:700 11.5px/1 ui-monospace,Consolas,monospace;color:#fff;background:linear-gradient(#3a424d,#2b313a);border:1px solid #545e6b;border-bottom-width:2px}
.ms-pl-key.ms-lit .ms-pl-kbd{background:linear-gradient(#3f8f5b,#2b6b42);border-color:#5fc183;box-shadow:0 0 0 3px rgba(47,168,98,.25)}
.ms-pl-hint{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:2147482500;display:none;
  max-width:min(90vw,460px);padding:7px 14px;border-radius:999px;background:#242a32;border:1px solid #4a535e;
  box-shadow:0 3px 12px rgba(0,0,0,.4);font:400 12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;pointer-events:none}
@media (prefers-reduced-motion: reduce){.ms-pl-key{transition:none}}
`;

/** Line icons for the modes, on a 24-unit grid. A mode without one gets a plain dot. */
const MODE_ICONS: Record<string, string[]> = {
  dismounted: ['M15 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M12 8l-2 6', 'M9 11l3-3 3 3 2 0', 'M10 14l-2 7', 'M10 14l3 3v4'],
  wheeled: ['M2 7h11v8H2z', 'M13 10h4l3 3v2h-7', 'M8 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z', 'M18 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'],
  tracked: ['M5 14h14a3 3 0 0 1 0 6H5a3 3 0 0 1 0-6z', 'M8 14l1.5-4h6l1 4', 'M15 11.5h6', 'M7 17h.01', 'M12 17h.01', 'M17 17h.01'],
  vessel: ['M3 14h18l-3 5H6z', 'M8 14V9h6v5', 'M11 9V5'],
  generic: ['M4 20h16', 'M6 20V10l6-4 6 4v10', 'M10 20v-5h4v5'],
  _: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
};

export interface LegendEntry {
  label: string;
  /** RGBA as the overlay paints it. */
  rgba: readonly number[];
}

export interface LegendMode {
  key: string;
  label: string;
}

/** Everything the legend shows; rebuilt only when the mode or the options change, not on every cursor move. */
export interface LegendState {
  /** The modes Previous / Next step through, in order. */
  modes: LegendMode[];
  /** Key of the mode shown. */
  current: string;
  /** How the mode was chosen ("Auto · From Symbol", "Set by Hand", …); empty for none. */
  tag: string;
  /** The mode was picked by hand (the tag is drawn as a warning). */
  hand: boolean;
  /** The overlay's colours, from good to bad. */
  entries: LegendEntry[];
  /** A line under the ramp (what "Marginal" means). */
  note: string;
  /** Terrain the mode cannot use / is slowed by. */
  nogo: string[];
  slow: string[];
  /** Whether to explain the keys at all (off for touch, or when both keys are switched off). */
  keys: { profile: boolean; snap: boolean } | null;
}

export interface LegendHandlers {
  /** Previous (-1) / Next (+1). */
  step(dir: 1 | -1): void;
  /** A mode's icon was clicked. */
  pick(key: string): void;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = LEGEND_CSS;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap = 'div'>(cls: string, text?: string, tag?: K): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag ?? 'div') as HTMLElementTagNameMap[K];
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, label: string, text?: string): HTMLButtonElement {
  const b = el(cls, text, 'button');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

function modeIcon(key: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [['width', '19'], ['height', '19'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'],
    ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) {
    svg.setAttribute(k, v);
  }
  for (const d of MODE_ICONS[key] ?? MODE_ICONS._) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/** The overlay is drawn over imagery at partial strength; the key shows it a little firmer so it reads on the dark card. */
function swatch(rgba: readonly number[]): string {
  const [r, g, b, a] = rgba;
  return `rgba(${r},${g},${b},${Math.min(1, Math.max(0.55, a / 255 + 0.25))})`;
}

function readDetailsOpen(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) !== '0';
  } catch {
    return true;
  }
}

export class PlacementLegend {
  private _card: HTMLDivElement | null = null;
  private _view: any = null;
  private _keyP: HTMLElement | null = null;
  private _keyS: HTMLElement | null = null;
  private _detailsOpen = readDetailsOpen();
  private _state: LegendState | null = null;
  private _pOn = false;
  private _sOn = false;
  private _hint: HTMLDivElement | null = null;
  private _hintKind = '';
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly _handlers: LegendHandlers) {}

  /** Show (or update) the legend on this view; moves it when the view has changed. */
  show(view: any, state: LegendState): void {
    ensureStyle();
    this._state = state;
    if (!this._card) {
      this._card = el('ms-pl');
      this._card.setAttribute('role', 'group');
      this._card.setAttribute('aria-label', 'Legend');
      // Clicks on the legend must never reach a draw tool listening on the map.
      for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick']) this._card.addEventListener(t, (e) => e.stopPropagation());
    }
    this._render(state);
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

  /** Light the keys that work right now: P while a draw can change mode, S while the quick fix can help. Cheap; call per verdict. */
  setKeys(profile: boolean, snap: boolean): void {
    this._pOn = profile;
    this._sOn = snap;
    this._keyP?.classList.toggle('ms-on', profile);
    this._keyS?.classList.toggle('ms-on', snap);
    this._keyS?.classList.toggle('ms-lit', snap);
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
    this._keyP = this._keyS = null;
    this._state = null;
  }

  private _render(s: LegendState): void {
    const card = this._card!;
    const idx = Math.max(0, s.modes.findIndex((m) => m.key === s.current));
    const mode = s.modes[idx] ?? { key: s.current, label: s.current };
    // Rebuilding moves focus out of the card; put it back on the same control so keyboard users keep their place.
    const focused = card.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.plFocus : undefined;

    const head = el('ms-pl-head');
    const more = button('ms-pl-more', this._detailsOpen ? 'Hide terrain lists' : 'Show terrain lists', this._detailsOpen ? '▾' : '▸');
    more.setAttribute('aria-expanded', String(this._detailsOpen));
    more.dataset.plFocus = 'more';
    more.onclick = () => {
      this._detailsOpen = !this._detailsOpen;
      try {
        localStorage.setItem(DETAILS_KEY, this._detailsOpen ? '1' : '0');
      } catch {
        /* storage blocked: the choice lasts for this page */
      }
      if (this._state) this._render(this._state);
    };
    head.append(el('ms-pl-title', 'Legend'), el('ms-pl-count', s.modes.length > 1 ? `Mode ${idx + 1} / ${s.modes.length}` : ''), more);

    const parts: HTMLElement[] = [head];
    if (s.modes.length > 1) {
      const strip = el('ms-pl-strip');
      const prev = button('', 'Previous mode', '‹');
      const next = button('', 'Next mode', '›');
      prev.dataset.plFocus = 'prev';
      next.dataset.plFocus = 'next';
      prev.onclick = () => this._handlers.step(-1);
      next.onclick = () => this._handlers.step(1);
      const icons = el('ms-pl-icons');
      icons.setAttribute('role', 'group');
      icons.setAttribute('aria-label', 'Modes');
      for (const m of s.modes) {
        const b = button('', m.label);
        b.setAttribute('aria-pressed', String(m.key === mode.key));
        b.dataset.plFocus = `mode:${m.key}`;
        b.appendChild(modeIcon(m.key));
        b.onclick = () => this._handlers.pick(m.key);
        icons.appendChild(b);
      }
      strip.append(prev, icons, next);
      parts.push(strip);
    }

    const name = el('ms-pl-name');
    name.append(el('', mode.label, 'b'));
    if (s.tag) name.append(el(s.hand ? 'ms-pl-tag ms-hand' : 'ms-pl-tag', s.tag, 'span'));
    parts.push(name);

    const ramp = el('ms-pl-ramp');
    const labels = el('ms-pl-ramp-l');
    for (const e of s.entries) {
      const i = el('', undefined, 'i');
      i.style.background = swatch(e.rgba);
      ramp.appendChild(i);
      labels.appendChild(el('', e.label, 'span'));
    }
    parts.push(ramp, labels);
    if (s.note) parts.push(el('ms-pl-note', s.note));

    if (this._detailsOpen && (s.nogo.length || s.slow.length)) {
      const list = el('ms-pl-list');
      const group = (caption: string, color: string, items: string[]) => {
        if (!items.length) return;
        const g = el('');
        const cap = el('ms-pl-cap', caption);
        cap.style.color = color;
        const chips = el('ms-pl-chips');
        for (const t of items) chips.appendChild(el('', t, 'span'));
        g.append(cap, chips);
        list.appendChild(g);
      };
      group(`NO-GO for ${mode.label}`, '#ff8a8d', s.nogo);
      group('SLOW-GO', '#ffb766', s.slow);
      parts.push(list);
    }

    this._keyP = this._keyS = null;
    if (s.keys) {
      const keys = el('ms-pl-keys');
      const key = (k: string, label: string, sub?: string) => {
        const row = el('ms-pl-key');
        const text = el('', label);
        if (sub) text.appendChild(el('', sub, 'small'));
        row.append(el('ms-pl-kbd', k, 'span'), text);
        keys.appendChild(row);
        return row;
      };
      if (s.keys.profile) this._keyP = key('P', 'Change Mode');
      if (s.keys.snap) this._keyS = key('S', 'Quick Fix', 'Moves It to the Nearest Usable Ground');
      if (keys.childElementCount) parts.push(keys);
    }

    card.replaceChildren(...parts);
    this.setKeys(this._pOn, this._sOn);
    if (focused) (card.querySelector(`[data-pl-focus="${CSS.escape(focused)}"]`) as HTMLElement | null)?.focus();
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
