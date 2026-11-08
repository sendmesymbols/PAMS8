/**
 * GroundGuideScope.ts
 *
 * The Gr Scope rail (user, 2026-11-08, approved from ground-guide-scope-window.html): a side window docked at the edge
 * of the map, shown and hidden with V at any time the guide is on. It has nothing to do with the mouse: it never
 * follows the cursor, and the cursor card and its H chip are separate and unchanged. The map is the window: the real
 * ground for the echelon with its range rings, the frontage (its front edge coloured where it is in NO-GO), the clear
 * ground S would move it to, and a bird's-eye view of the GROTBC things round the spot (GroundGuideScopeScene). Under
 * the map only its legend, one line per letter, each line also that layer's switch. No Inter Gap marks (user).
 *
 * The guide decides what it reads (the symbol being placed, the selected symbol, the one just placed, the map centre)
 * and hands a `ScopeFrame`; this file only draws it. Text goes in through `textContent`; the map is one SVG string of
 * fixed markup whose only text (names from the bundle, distances) goes through `esc`.
 */

import { fmtDistance, titleCase } from './GroundGuideEvaluator';
import { plainLabel, titleOf } from './GroundGuideBadge';
import { seasonIcon } from './GroundGuideGoingView';
import { modeIcon } from './GroundGuideLegend';
import { arrowCompass, ensureNorthCss, pointerArrow, setNorthVar } from './GroundGuideNorth';
import {
  GOING_GO,
  GOING_MARG,
  GOING_NOGO,
  GOING_SLOW,
  OVER_BUA,
  OVER_NULLAH,
  OVER_TREES,
  SCOPE_N,
  TOWN_KINDS,
  people,
  type ScopeLine,
  type ScopePoint,
  type ScopeScene,
} from './GroundGuideScopeScene';
import { ACCENT, ensureTokensCss, FONT, FS, FW, LETTER_FG, LETTER_FILL, LINE, ROAD, SCOPE_MAP, SURFACE, TEXT, TONE, ladderIcon, verdictTone, type Tone } from './GroundGuideTokens';
import type { GroundGuideFrontBlock, GroundGuideVerdict } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-scope-style';
const STORE_KEY = 'ms-gg-scope';
/** The rail at full size, px (the full height of the map on a 1600 x 900 screen). */
const RAIL_W = 400;
const RAIL_H = 836;
/** The map inside it, px. */
const MAP_PX = 397;
/** Gap to the map's edge, px; the rail is never drawn smaller than this share of its size. */
const GAP = 10;
const MIN_SCALE = 0.55;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export type ScopeLetter = 'G' | 'R' | 'O' | 'T' | 'B' | 'C';
const LETTERS: Array<[ScopeLetter, string]> = [
  ['G', 'Ground'],
  ['R', 'Routes'],
  ['O', 'Obstacles'],
  ['T', 'Trafficability'],
  ['B', 'Built-up'],
  ['C', 'Cover'],
];

/** What the rail is reading. */
export type ScopeSource = 'drawing' | 'selected' | 'placed' | 'centre';

/** The echelon's frontage as judged (from the verdict's footprint, or the echelon table for the map centre). */
export interface ScopeEchelon {
  name: string;
  frontageM: number;
  depthM: number;
  /** Degrees from north; null for the disc (facing all round). */
  facingDeg: number | null;
}

export interface ScopeFrame {
  source: ScopeSource;
  scene: ScopeScene;
  /** Where north points on screen, degrees clockwise from up: the map turns with the view. */
  northDeg: number;
  /** The guide's verdict for the symbol; null for the map centre. */
  verdict: GroundGuideVerdict | null;
  profile: string;
  profileLabel: string;
  echelon: ScopeEchelon | null;
  /** Season, month and light the going is read for ("Dry · Nov · Day"). */
  when: { season: 'dry' | 'wet'; text: string } | null;
  /** S moves the symbol (drawing a point, with a keyboard); D opens the Ground Detail. */
  keys: { snap: boolean; detail: boolean };
  /** The line or area being judged, ground metres east / north of the spot, one array per part; null for a point. */
  outline: Float64Array[] | null;
  closed: boolean;
  /** Clear ground, ground metres east / north of the spot (where S moves it). */
  clearAt: [number, number] | null;
  /** Map tiles still on their way. */
  loading: boolean;
}

export interface ScopeHandlers {
  /** Shown or hidden from the rail's own controls (its V button, the edge tab). */
  toggle(open: boolean): void;
  /** A layer was switched from the legend: draw again. */
  redraw(): void;
  /** Docked again (shown, hidden, the map resized): what it covers may have changed. */
  moved?(): void;
}

const CSS = `
.ms-ggsc{position:fixed;left:0;top:0;z-index:2147482700;width:${RAIL_W}px;height:${RAIL_H}px;box-sizing:border-box;display:flex;flex-direction:column;
  background:${SURFACE.card};color:${TEXT.main};border:1.5px solid var(--ggsc-c,${TONE.chk.fill});border-radius:12px;overflow:hidden;
  font:${FW.regular} ${FS.body}px/1.4 ${FONT};box-shadow:0 10px 28px rgba(0,0,0,.45);cursor:default;text-align:left;
  transform-origin:0 0;transform:translateX(var(--ggsc-x,0px)) scale(var(--ggsc-s,1));
  transition:transform .22s cubic-bezier(.25,1,.5,1),opacity .22s cubic-bezier(.25,1,.5,1),visibility 0s}
.ms-ggsc.ms-off{opacity:0;visibility:hidden;pointer-events:none;transition:transform .22s cubic-bezier(.25,1,.5,1),opacity .22s cubic-bezier(.25,1,.5,1),visibility 0s .22s}
.ms-ggsc *{box-sizing:border-box}
.ms-ggsc button{font:inherit;color:inherit}
.ms-ggsc button:focus-visible,.ms-ggsc-tab:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
.ms-ggsc-bar{flex:none;display:flex;align-items:center;gap:8px;height:40px;padding:0 9px 0 12px;background:var(--ggsc-c,${TONE.chk.fill});color:var(--ggsc-fg,#fff);font-weight:${FW.bold};font-size:${FS.value}px}
.ms-ggsc-bar.ms-hatch{background:repeating-linear-gradient(-45deg,${TONE.part.fill} 0 9px,#ab282e 9px 13px)}
.ms-ggsc-bar>svg{flex:none}
.ms-ggsc-ttl{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggsc-kv{flex:none;display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 5px;border:0;border-radius:5px;background:rgba(0,0,0,.22);font:${FW.bold} ${FS.meta}px/1 ${FONT}!important;cursor:pointer}
.ms-ggsc-kv:hover{background:rgba(0,0,0,.36)}
.ms-ggsc-mode{flex:none;padding:5px 12px 6px;background:${SURFACE.strip};border-bottom:1px solid ${LINE.soft};font-size:${FS.meta}px;color:${TEXT.label};line-height:1.45}
.ms-ggsc-mode>div{display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden}
.ms-ggsc-mode svg{flex:none;width:16px;height:16px;color:${ACCENT}}
.ms-ggsc-mode b{color:${TEXT.main};font-weight:${FW.semi};overflow:hidden;text-overflow:ellipsis}
.ms-ggsc-when{margin-left:auto;display:inline-flex;align-items:center;gap:4px;flex:none}
.ms-ggsc-when svg{width:14px;height:14px;color:${TEXT.label}}
.ms-ggsc-ans{flex:none;padding:6px 12px 7px}
.ms-ggsc-lead{font-size:${FS.value}px;font-weight:${FW.bold};line-height:1.3;color:${TEXT.strong}}
.ms-ggsc-act{display:flex;align-items:center;flex-wrap:wrap;gap:3px 7px;margin-top:3px;font-size:${FS.body}px;font-weight:${FW.semi};line-height:1.3}
.ms-ggsc-act:empty{display:none}
.ms-ggsc-act .ms-soft{color:${TEXT.label};font-weight:${FW.regular}}
.ms-ggsc-kc{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 4px;border-radius:4px;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px;font:${FW.bold} ${FS.meta}px/1 ${FONT};color:#e8ebee}
.ms-ggsc-map{flex:none;width:${MAP_PX}px;height:${MAP_PX}px;border-top:1px solid ${LINE.hair};border-bottom:1px solid ${LINE.hair};background:${SCOPE_MAP.cell.none}}
.ms-ggsc-map svg{display:block}
.ms-ggsc-leg{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.ms-ggsc-key{display:flex;flex-wrap:wrap;gap:2px 12px;padding:5px 12px;font-size:${FS.meta}px;color:${TEXT.label};border-bottom:1px solid ${LINE.soft}}
.ms-ggsc-key span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.ms-ggsc-row{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;align-items:start;width:100%;padding:3px 12px 4px;border:0;border-bottom:1px solid rgba(255,255,255,.07);background:none;text-align:left;cursor:pointer}
.ms-ggsc-row:hover{background:rgba(255,255,255,.04)}
.ms-ggsc-row:last-child{border-bottom:0}
.ms-ggsc-l{display:inline-grid;place-items:center;width:20px;height:20px;margin-top:1px;border-radius:4px;background:${LETTER_FILL};color:${LETTER_FG};font:${FW.bold} ${FS.meta}px/1 ${FONT};border:1.5px solid ${LETTER_FILL}}
.ms-ggsc-row[aria-checked="false"] .ms-ggsc-l{background:transparent;color:${LETTER_FILL}}
.ms-ggsc-row[aria-checked="false"] .ms-ggsc-c{opacity:.42}
.ms-ggsc-c{display:flex;flex-wrap:wrap;gap:1px 12px;min-width:0;font-size:${FS.meta}px;line-height:1.4;color:#e1e6eb}
.ms-ggsc-i{display:inline-flex;align-items:center;gap:6px;min-width:0}
.ms-ggsc-i svg{flex:none}
.ms-ggsc-i b{font-weight:${FW.semi};color:${TEXT.strong}}
.ms-ggsc-i em{font-style:normal;color:${TEXT.label}}
.ms-ggsc-foot{flex:none;display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-top:1px solid ${LINE.hair};font-size:${FS.meta}px;color:${TEXT.label};white-space:nowrap}
.ms-ggsc-foot .ms-ggsc-kc{margin-left:4px}
.ms-ggsc-foot .ms-ggsc-kc:first-child{margin-left:0}
.ms-ggsc-adv{margin-left:auto;color:${TEXT.warn}}
.ms-ggsc-tab{position:fixed;z-index:2147482700;padding:10px 6px;border:1px solid #39434f;background:${SURFACE.head};color:#e1e6eb;font:${FW.semi} ${FS.meta}px/1 ${FONT};
  writing-mode:vertical-rl;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.ms-ggsc-tab.ms-r{border-right:0;border-radius:8px 0 0 8px}
.ms-ggsc-tab.ms-l{border-left:0;border-radius:0 8px 8px 0}
.ms-ggsc-tab:hover{background:#2f3741}
.ms-ggsc-tab[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.ms-ggsc,.ms-ggsc.ms-off{transition:none}}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const compass = (b: number): string => COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
const at = (d: number, b: number): string => `${fmtDistance(d)} ${compass(b)}`;

/** "1.2k" people, "190k": short enough for a map label. */
function ppl(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
}

/** Short forms kept in capitals when a name recorded in capitals is title-cased ("JHELUM RS" is "Jhelum RS"). */
const KEEP_CAPS = new Set(['RS', 'GT', 'HQ', 'PAF', 'CMH', 'MSR']);

/** "JHELUM" reads better as "Jhelum" beside the rest. */
function placeName(n: unknown): string {
  const s = String(n ?? '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s
    .split(/(\s+)/)
    .map((w) => (KEEP_CAPS.has(w) ? w : w.toLowerCase().replace(/(^|[(-])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase())))
    .join('');
}

/** A class label as a headline noun: "Steep slope (>30°)" becomes "Steep Slope"; built-up ground is "BUA". */
function groundName(label: string | null | undefined): string {
  if (!label) return 'NO-GO Gr';
  if (/^built-up/i.test(label)) return 'BUA';
  const s = plainLabel(label).replace(/\s*\([^)]*\)/g, '').trim();
  return s ? titleCase(s.charAt(0).toUpperCase() + s.slice(1)) : 'NO-GO Gr';
}

function tiny(inner: string, w = 22): string {
  return `<svg width="${w}" height="14" viewBox="0 0 ${w} 14" aria-hidden="true">${inner}</svg>`;
}

const M = SCOPE_MAP;
const CAS = M.casing;
/** Legend icons: fixed markup. */
const IC = {
  hill: tiny(`<path d="M11 2 l6 10 h-12z" fill="${M.hill}" stroke="${CAS}" stroke-width="1.1"/>`),
  itg: tiny(`<rect x="7" y="3" width="8" height="8" transform="rotate(45 11 7)" fill="none" stroke="${M.itg}" stroke-width="1.8"/>`),
  ridge: tiny(`<path d="M1 7H21" stroke="${M.ridge}" stroke-width="1.4" stroke-dasharray="1.5 3"/>`),
  msr: tiny(`<path d="M1 7H21" stroke="${CAS}" stroke-width="5.5"/><path d="M1 7H21" stroke="${ROAD.msr}" stroke-width="3"/>`),
  all: tiny(`<path d="M1 7H21" stroke="${ROAD.allWeather}" stroke-width="2.4"/>`),
  minor: tiny(`<path d="M1 7H21" stroke="${M.minor}" stroke-width="1.4"/>`),
  rail: tiny(`<path d="M1 7H21" stroke="${CAS}" stroke-width="3.6"/><path d="M1 7H21" stroke="${M.rail}" stroke-width="2" stroke-dasharray="5 4"/>`),
  water: tiny(`<path d="M1 7H21" stroke="${M.water}" stroke-width="3"/>`),
  power: tiny(`<path d="M1 7H21" stroke="${M.power}" stroke-width="1.3" stroke-dasharray="5 3"/>`),
  nogo: tiny(`<rect x="2" y="2" width="18" height="10" rx="2" fill="${M.cell.nogo}"/>`),
  town: tiny(`<circle cx="11" cy="7" r="4.5" fill="${M.town}" stroke="${CAS}" stroke-width="1.2"/>`),
  bua: tiny(`<rect x="2" y="2" width="18" height="10" rx="2" fill="${M.plain.ground}"/><path d="M2 10 L10 2 M6 12 L16 2 M12 12 L20 4" stroke="rgb(${M.bua.join(',')})" stroke-width="1.2"/>`),
  trees: tiny(`<rect x="2" y="2" width="18" height="10" rx="2" fill="${M.cell.go}"/><g fill="rgb(${M.trees.join(',')})"><rect x="4" y="4" width="2.2" height="2.2"/><rect x="9" y="4" width="2.2" height="2.2"/><rect x="14" y="4" width="2.2" height="2.2"/><rect x="6.5" y="8" width="2.2" height="2.2"/><rect x="11.5" y="8" width="2.2" height="2.2"/></g>`),
  nullah: tiny(`<rect x="2" y="2" width="18" height="10" rx="2" fill="${M.plain.ground}"/><path d="M4 2 L14 12 M10 2 L20 12" stroke="rgb(${M.nullah.join(',')})" stroke-width="1.4"/>`),
};
const swatch = (col: string): string => tiny(`<rect x="2" y="2" width="14" height="10" rx="2" fill="${col}" stroke="${CAS}" stroke-width=".8"/>`, 18);
const CELL_COLORS = ['', M.cell.go, M.cell.marg, M.cell.slow, M.cell.nogo];

/** One legend item: an icon, a bold name, then a soft rest ("383 m N"). */
function item(icon: string, bold: string, rest = ''): HTMLElement {
  const s = el('span', 'ms-ggsc-i');
  const ic = el('span');
  ic.innerHTML = icon; // fixed markup from IC / swatch, never bundle text
  s.append(ic.firstChild!);
  const t = el('span');
  if (bold) t.append(el('b', undefined, bold));
  if (bold && rest) t.append(' ');
  if (rest) t.append(el('em', undefined, rest));
  s.append(t);
  return s;
}

function halo(x: number, y: number, txt: string, anchor: string, col: string, size: number, w: number = FW.semi): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${size}" font-weight="${w}" font-family="${FONT}" fill="${col}" stroke="${CAS}" stroke-width="3.2" paint-order="stroke" stroke-linejoin="round">${esc(txt)}</text>`;
}

interface Store {
  shown: boolean;
  layers: Record<ScopeLetter, boolean>;
}

function loadStore(): Store {
  const s: Store = { shown: false, layers: { G: true, R: true, O: true, T: true, B: true, C: true } };
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (typeof v.shown === 'boolean') s.shown = v.shown;
    for (const [k] of LETTERS) if (typeof v.layers?.[k] === 'boolean') s.layers[k] = v.layers[k];
  } catch {
    /* private window or blocked storage: the defaults */
  }
  return s;
}

/** Images of a scene's grids, made once per scene and kept with it. */
const IMAGES = new WeakMap<ScopeScene, Map<string, string>>();

export class GroundGuideScope {
  private _root: HTMLDivElement | null = null;
  private _tab: HTMLButtonElement | null = null;
  private _store = loadStore();
  private _enabled = false;
  private _side: 'right' | 'left' = 'right';
  private _tabOn = true;
  private _frame: ScopeFrame | null = null;
  private _container: HTMLElement | null = null;
  private _pad = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Room kept free above the rail at the top of the map (a host toolbar), px. */
  private _top = 54;
  private _ro: ResizeObserver | null = null;
  private _onResize = () => this._place();
  private _rect: DOMRect | null = null;
  private _uid = 0;

  constructor(private readonly _h: ScopeHandlers) {}

  /** The user wants it shown (V); remembered between sessions. It is on screen only while the guide is on as well. */
  get wanted(): boolean {
    return this._store.shown;
  }

  get isShown(): boolean {
    return this._enabled && this._store.shown && !!this._root;
  }

  get layers(): Readonly<Record<ScopeLetter, boolean>> {
    return this._store.layers;
  }

  /**
   * The rail's box on screen while it is shown, else null: the cursor card keeps clear of it. Worked out where it is
   * docked, not measured, so it is right while the rail is still sliding in.
   */
  get rect(): DOMRect | null {
    return this.isShown ? this._rect : null;
  }

  /** Width of the screen it takes at the map's edge while shown (px from the window's edge), else 0: the Detail leaves it free. */
  get inset(): { side: 'right' | 'left'; px: number } {
    const r = this.rect;
    if (!r) return { side: this._side, px: 0 };
    return { side: this._side, px: Math.round(this._side === 'right' ? window.innerWidth - r.left + GAP : r.right + GAP) };
  }

  setOptions(o: { side?: 'right' | 'left'; tab?: boolean; topPx?: number }): void {
    if (o.side) this._side = o.side;
    if (o.tab !== undefined) this._tabOn = o.tab;
    if (o.topPx !== undefined) this._top = o.topPx;
    this._place();
  }

  /**
   * The map's container to dock to (a new one after a 2D / 3D switch), and the view's padding: a host that keeps a
   * toolbar or panel over the map pads the view for it, and the rail docks inside that.
   */
  attach(container: HTMLElement | null, pad?: { top?: number; right?: number; bottom?: number; left?: number } | null): void {
    const p = { top: pad?.top ?? 0, right: pad?.right ?? 0, bottom: pad?.bottom ?? 0, left: pad?.left ?? 0 };
    const samePad = p.top === this._pad.top && p.right === this._pad.right && p.bottom === this._pad.bottom && p.left === this._pad.left;
    this._pad = p;
    if (container === this._container) {
      if (!samePad) this._place();
      return;
    }
    this._ro?.disconnect();
    this._container = container;
    if (container && typeof ResizeObserver !== 'undefined') {
      this._ro ??= new ResizeObserver(() => this._place());
      this._ro.observe(container);
    }
    this._place();
  }

  /** The guide is on (with a bundle) and the rail allowed: the edge tab shows, and the rail when wanted. */
  setEnabled(on: boolean): void {
    if (on === this._enabled) return;
    this._enabled = on;
    if (on) {
      this._ensure();
      window.addEventListener('resize', this._onResize);
    } else window.removeEventListener('resize', this._onResize);
    this._place();
  }

  /** Show or hide it (V, the edge tab, the API); the choice is remembered. */
  setShown(open: boolean): void {
    this._store.shown = open;
    this._save();
    if (open) this._ensure();
    this._place();
    if (open && this._frame) this.render(this._frame);
  }

  render(f: ScopeFrame): void {
    this._frame = f;
    if (!this._enabled || !this._store.shown) return;
    const root = this._ensure();
    const v = f.verdict;
    const tone: Tone | null = v && v.verdict !== 'off' && v.verdict !== 'exempt' ? verdictTone(v) : null;
    const t = tone ? TONE[tone] : null;
    root.style.setProperty('--ggsc-c', t ? t.fill : SURFACE.head);
    root.style.setProperty('--ggsc-fg', t ? t.fg : TEXT.main);
    const focusLayer = (document.activeElement as HTMLElement | null)?.closest?.('.ms-ggsc')
      ? (document.activeElement as HTMLElement).dataset.layer ?? (document.activeElement as HTMLElement).dataset.ggscAct
      : undefined;
    root.replaceChildren(this._bar(f, tone), this._mode(f), this._answer(f), this._map(f), this._legend(f), this._foot(f));
    setNorthVar(root, f.northDeg);
    arrowCompass(root.querySelector('.ms-ggsc-leg'));
    if (focusLayer) (root.querySelector(`[data-layer="${focusLayer}"],[data-ggsc-act="${focusLayer}"]`) as HTMLElement | null)?.focus();
  }

  destroy(): void {
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
    this._ro = null;
    this._root?.remove();
    this._tab?.remove();
    this._root = null;
    this._tab = null;
    this._frame = null;
    this._enabled = false;
  }

  // ── frame ──────────────────────────────────────────────────────────────────

  private _ensure(): HTMLDivElement {
    if (this._root) return this._root;
    ensureTokensCss();
    ensureNorthCss();
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const root = el('div', 'ms-ggsc ms-off');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Gr Scope');
    // Clicks on the rail must never reach a draw tool listening on the page (as the Ground Detail).
    for (const t of ['pointerdown', 'mousedown', 'dblclick']) root.addEventListener(t, (e) => e.stopPropagation());
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || !root.contains(b)) return;
      const layer = b.dataset.layer as ScopeLetter | undefined;
      if (layer) {
        this._store.layers[layer] = !this._store.layers[layer];
        this._save();
        this._h.redraw();
        if (this._frame) this.render(this._frame);
      } else if (b.dataset.ggscAct === 'hide') this._h.toggle(false);
    });
    document.body.appendChild(root);
    const tab = el('button', 'ms-ggsc-tab', 'V · Gr Scope');
    tab.type = 'button';
    tab.title = 'Show the Gr Scope rail (V)';
    tab.hidden = true;
    tab.addEventListener('click', () => this._h.toggle(true));
    document.body.appendChild(tab);
    this._root = root;
    this._tab = tab;
    return root;
  }

  /** Dock to the map's edge, scaled down to fit a short map; slide out when hidden. */
  private _place(): void {
    this._rect = null;
    const root = this._root;
    const tab = this._tab;
    if (!root || !tab) return;
    const c = this._container?.getBoundingClientRect();
    const whole = c && c.width > 0 && c.height > 0 ? c : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const p = this._pad;
    const box = new DOMRect(whole.left + p.left, whole.top + p.top, Math.max(1, whole.width - p.left - p.right), Math.max(1, whole.height - p.top - p.bottom));
    const above = Math.max(GAP, this._top);
    const s = Math.max(MIN_SCALE, Math.min(1, (box.height - above - GAP) / RAIL_H, (box.width * 0.5) / RAIL_W));
    const w = RAIL_W * s;
    const left = Math.round(this._side === 'right' ? box.right - GAP - w : box.left + GAP);
    const top = Math.round(box.top + above);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    this._rect = new DOMRect(left, top, w, RAIL_H * s);
    root.style.setProperty('--ggsc-s', s.toFixed(3));
    const on = this._enabled && this._store.shown;
    root.style.setProperty('--ggsc-x', on ? '0px' : `${this._side === 'right' ? w + 2 * GAP : -(w + 2 * GAP)}px`);
    root.classList.toggle('ms-off', !on);
    root.setAttribute('aria-hidden', String(!on));
    tab.hidden = !(this._enabled && this._tabOn && !this._store.shown);
    tab.classList.toggle('ms-r', this._side === 'right');
    tab.classList.toggle('ms-l', this._side === 'left');
    tab.style.top = `${Math.round(box.top + box.height / 2 - 50)}px`;
    if (this._side === 'right') {
      tab.style.left = '';
      tab.style.right = `${Math.round(window.innerWidth - box.right)}px`;
    } else {
      tab.style.right = '';
      tab.style.left = `${Math.round(box.left)}px`;
    }
    this._h.moved?.();
  }

  private _save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this._store));
    } catch {
      /* storage blocked: the choice lasts for this page */
    }
  }

  // ── the parts ──────────────────────────────────────────────────────────────

  private _bar(f: ScopeFrame, tone: Tone | null): HTMLElement {
    const bar = el('div', tone && TONE[tone].hatch ? 'ms-ggsc-bar ms-hatch' : 'ms-ggsc-bar');
    const v = f.verdict;
    if (tone) bar.append(ladderIcon(TONE[tone].icon, 19, TONE[tone].fill));
    else bar.append(scopeGlyph());
    const title = !v ? 'Gr Scope' : v.verdict === 'exempt' ? 'Not Terrain-Bound' : tone === 'chk' ? 'Checking' : titleOf(v);
    bar.append(el('span', 'ms-ggsc-ttl', title));
    const kv = el('button', 'ms-ggsc-kv', 'V');
    kv.type = 'button';
    kv.dataset.ggscAct = 'hide';
    kv.title = 'Hide the Gr Scope (V)';
    kv.setAttribute('aria-label', 'Hide the Gr Scope (V)');
    bar.append(kv);
    return bar;
  }

  private _mode(f: ScopeFrame): HTMLElement {
    const m = el('div', 'ms-ggsc-mode');
    const l1 = el('div');
    l1.append(modeIcon(f.profile), el('b', undefined, f.echelon ? `${f.profileLabel} · ${f.echelon.name}` : f.profileLabel));
    if (f.when) {
      const w = el('span', 'ms-ggsc-when');
      w.append(seasonIcon(f.when.season, 14), f.when.text);
      l1.append(w);
    }
    const src = { drawing: 'Placing', selected: 'Selected', placed: 'Placed', centre: 'Map centre' }[f.source];
    const e = f.echelon;
    let shape: string;
    if (e) {
      shape = `Frontage ${fmtDistance(e.frontageM)}${e.depthM > 0 ? ` · Depth ${fmtDistance(e.depthM)}` : ''} · ${e.facingDeg === null ? 'All round' : `Facing ${compass(e.facingDeg)}`}`;
    } else if (f.outline) shape = f.closed ? 'Area as drawn' : 'Line as drawn';
    else shape = f.source === 'centre' ? 'Place or select a symbol for its verdict' : 'Point symbol';
    m.append(l1, el('div', undefined, `${src} · ${shape}`));
    return m;
  }

  private _answer(f: ScopeFrame): HTMLElement {
    const a = el('div', 'ms-ggsc-ans');
    const v = f.verdict;
    const lead = el('div', 'ms-ggsc-lead');
    const act = el('div', 'ms-ggsc-act');
    a.append(lead, act);
    if (!v) {
      lead.textContent = 'Gr round the map centre';
      act.append(el('span', 'ms-soft', `For ${f.profileLabel}; no verdict without a symbol`));
      return a;
    }
    if (v.verdict === 'exempt' || v.verdict === 'off') {
      lead.textContent = v.verdict === 'exempt' ? 'No terrain verdict for this symbol' : 'Ground Guide off';
      return a;
    }
    if (v.verdict === 'unknown' || verdictTone(v) === 'chk') {
      lead.textContent = v.verdict === 'unknown' ? v.message : 'Checking the ground here';
      return a;
    }
    const e = f.echelon;
    const noun = e ? (e.depthM > 0 ? `the ${e.name} Posn` : 'the Frontage') : f.outline ? 'the Shape' : 'the Symbol';
    const pct = v.fraction > 0 ? Math.max(1, Math.round(v.fraction * 100)) : 0; // a share that rounds to 0 is never shown as clear
    const n = v.nearest && v.nearest.kind === 'no-go' ? v.nearest : null;
    if (pct >= 100) lead.textContent = `All of ${noun} in ${groundName(v.className)}`;
    else if (pct > 0) lead.textContent = `${pct}% of ${noun} in ${groundName(v.className)}`;
    else if (v.verdict === 'caution') lead.textContent = `${groundName(v.className)} under ${noun}`;
    else if (v.verdict === 'near') {
      const what = n ? groundName(n.className) : 'NO-GO Gr';
      lead.textContent = `${e ? (e.depthM > 0 ? 'Posn' : 'Frontage') : 'Symbol'} clear; ${what} ${n ? (n.distanceM < 1 ? 'alongside' : at(n.distanceM, n.bearingDeg)) : 'close'}`;
    } else if (v.verdict === 'ok') lead.textContent = e || f.outline ? `All of ${noun} on Suitable Gr` : 'On Suitable Gr';
    else lead.textContent = v.message;

    const c = v.clear;
    if (c && c.distanceM !== null && c.compass !== null) {
      act.style.color = M.clear;
      const p = pointerArrow(c.bearingDeg ?? c.compass);
      if (p) act.append(p);
      act.append(el('span', undefined, `Clear Gr ${fmtDistance(c.distanceM)} ${c.compass}`));
      if (f.keys.snap) act.append(el('span', 'ms-ggsc-kc', 'S'), el('span', 'ms-soft', 'moves it there'));
    } else if (c) {
      act.style.color = TEXT.warn;
      act.textContent = `No clear Gr within ${fmtDistance(c.searchedM)}: check on the ground`;
    } else if (v.verdict === 'near' && pct === 0 && n) {
      act.style.color = TONE.marg.text;
      act.textContent = `Usable; NO-GO ${n.distanceM < 1 ? 'at the edge' : at(n.distanceM, n.bearingDeg)} closes that side`;
    } else if (v.verdict === 'caution') {
      act.style.color = TEXT.label;
      act.textContent = v.reason ?? 'Slow going here';
    } else if (v.verdict === 'ok') {
      act.style.color = TONE.go.text;
      act.textContent = v.distanceM !== null ? `No NO-GO within ${fmtDistance(v.distanceM)}` : 'No NO-GO close';
    } else if (v.detail) {
      act.style.color = TEXT.label;
      act.textContent = v.detail;
    }
    arrowCompass(act);
    return a;
  }

  private _foot(f: ScopeFrame): HTMLElement {
    const ft = el('div', 'ms-ggsc-foot');
    ft.append(el('span', 'ms-ggsc-kc', 'V'), 'Hide');
    if (f.keys.snap && f.verdict?.clear?.distanceM != null) ft.append(el('span', 'ms-ggsc-kc', 'S'), 'Quick Fix');
    if (f.keys.detail) ft.append(el('span', 'ms-ggsc-kc', 'D'), 'Detail');
    ft.append(el('span', 'ms-ggsc-adv', 'Check on the ground'));
    return ft;
  }

  // ── the map ────────────────────────────────────────────────────────────────

  private _map(f: ScopeFrame): HTMLElement {
    const box = el('div', 'ms-ggsc-map');
    box.innerHTML = this._mapSvg(f); // fixed markup; every name and figure in it went through esc()
    return box;
  }

  private _mapSvg(f: ScopeFrame): string {
    const L = this._store.layers;
    const sc = f.scene;
    const lv = sc.level.lv;
    const R = sc.level.radiusM;
    const S = MAP_PX;
    const c = S / 2;
    const kpx = c / R;
    const nr = (f.northDeg * Math.PI) / 180;
    const cs = Math.cos(nr);
    const sn = Math.sin(nr);
    // Ground metres east / north of the spot to the turned map's px.
    const X = (x: number, y: number) => c + (x * cs + y * sn) * kpx;
    const Y = (x: number, y: number) => c - (-x * sn + y * cs) * kpx;
    const id = `ggsc${++this._uid}`;
    const v = f.verdict;
    const aria = v ? `${titleOf(v)}. ${v.message}` : 'Ground round the map centre';
    let s = `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(aria)}"><defs><clipPath id="${id}"><rect width="${S}" height="${S}"/></clipPath></defs><g clip-path="url(#${id})">`;

    // Grids: drawn north up over `half`, turned with the map.
    const W = (2 * sc.half * kpx).toFixed(1);
    const o0 = (c - sc.half * kpx).toFixed(1);
    const turn = f.northDeg ? ` transform="rotate(${f.northDeg.toFixed(2)} ${c} ${c})"` : '';
    const img = (key: string, draw: (cv: HTMLCanvasElement) => void) =>
      `<image href="${this._image(sc, key, draw)}" x="${o0}" y="${o0}" width="${W}" height="${W}" preserveAspectRatio="none" style="image-rendering:pixelated"${turn}/>`;
    s += img(L.T ? 'T' : 'P', (cv) => paintGoing(cv, sc.going, L.T));
    s += `<rect width="${S}" height="${S}" fill="rgba(14,17,21,${L.T ? 0.16 : 0.05})"/>`;
    if (L.C) s += img('C', (cv) => paintOver(cv, sc.over, 'C'));
    if (L.B) s += img('B', (cv) => paintOver(cv, sc.over, 'B'));

    // Lines: water and wires under the roads, minor roads first.
    const zw = lv >= 3 ? 0.8 : 1;
    const path = (pts: Float64Array): string => {
      let d = '';
      let px = NaN;
      let py = NaN;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const x = X(pts[i], pts[i + 1]);
        const y = Y(pts[i], pts[i + 1]);
        if (d && Math.abs(x - px) < 1.2 && Math.abs(y - py) < 1.2 && i + 2 < pts.length) continue;
        d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        px = x;
        py = y;
      }
      return d;
    };
    const stroke = (pts: Float64Array, col: string, w: number, dash = '', casing = 0): string => {
      const d = path(pts);
      if (!d.includes('L')) return '';
      return (
        (casing ? `<path d="${d}" fill="none" stroke="${CAS}" stroke-width="${(w + casing).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round" opacity=".7"/>` : '') +
        `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w.toFixed(1)}" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
      );
    };
    const by = (kind: ScopeLine['kind']) => sc.lines.filter((l) => l.kind === kind);
    if (L.O) {
      for (const l of by('river')) s += stroke(l.pts, M.water, 3.6 * zw, '', 2);
      for (const l of by('canal')) s += stroke(l.pts, M.water, 2.4 * zw, '', 1.8);
      for (const l of by('power')) s += stroke(l.pts, M.power, 1.1, '6 3', 1.6);
    }
    if (L.G) for (const l of by('ridge')) s += stroke(l.pts, M.ridge, 1.3, '1.5 3');
    if (L.R) {
      for (const l of by('track')) s += stroke(l.pts, ROAD.track, 1.2, '4 3', 1.4);
      for (const l of by('minor')) s += stroke(l.pts, M.minor, 1.3 * zw, '', 1.4);
      for (const l of by('fair')) s += stroke(l.pts, ROAD.fairWeather, 1.8 * zw, '', 1.6);
      for (const l of by('all')) s += stroke(l.pts, ROAD.allWeather, 2.2 * zw, '', 1.8);
      for (const l of by('rail')) s += stroke(l.pts, CAS, 3.6 * zw) + stroke(l.pts, M.rail, 2 * zw, '6 5');
      for (const l of by('msr')) s += stroke(l.pts, ROAD.msr, 3.2 * zw, '', 2.6);
    }

    // Names are placed so none lands on another (or on the symbol).
    const boxes: number[][] = [[c - 14, c - 16, c + 14, c + 14]];
    const free = (b: number[]) => b[0] > 2 && b[2] < S - 2 && b[1] > 2 && b[3] < S - 2 && !boxes.some((o) => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3]);
    const label = (x: number, y: number, txt: string, col: string, size: number): string => {
      const w = txt.length * size * 0.56 + 4;
      const h = size + 2;
      const cands: Array<[number, number, string]> = [[x + 9, y + 4, 'start'], [x - 9, y + 4, 'end'], [x, y - 10, 'middle'], [x, y + 18, 'middle'], [x + 8, y - 8, 'start'], [x - 8, y + 16, 'end'], [x + 8, y + 16, 'start'], [x - 8, y - 8, 'end']];
      for (const [cx, cy, an] of cands) {
        const lx = an === 'start' ? cx : an === 'end' ? cx - w : cx - w / 2;
        const b = [lx, cy - h + 4, lx + w, cy + 2];
        if (!free(b)) continue;
        boxes.push(b);
        return halo(cx, cy, txt, an, col, size);
      }
      return '';
    };
    const mark = (x: number, y: number, r: number) => boxes.push([x - r, y - r, x + r, y + r]);

    // Range rings.
    for (const d of sc.level.rings) {
      const r = (d * kpx).toFixed(1);
      s += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${CAS}" stroke-width="2.6" opacity=".35"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.1"/>`;
    }

    // The shape being judged: the frontage (and the clear ground where S moves it), or the line / area as drawn.
    const labels: Array<[number, number, string, string, number]> = [];
    const e = f.echelon;
    if (e && f.clearAt) s += this._ghost(f, e, X, Y, c, S, mark, labels);
    if (e) s += footprintSvg(e, 0, 0, v?.footprint?.front ?? null, X, Y, kpx, boxes);
    else if (f.outline) {
      for (const part of f.outline) {
        const pts = f.closed && part.length >= 4 ? Float64Array.from([...part, part[0], part[1]]) : part;
        s += stroke(pts, CAS, 5.5) + stroke(pts, '#ffffff', 2.2);
      }
    }

    // Point marks.
    const P = (p: ScopePoint): [number, number] => [X(p.x, p.y), Y(p.x, p.y)];
    if (L.R) {
      for (const o of sc.bridges) {
        const [x, y] = P(o);
        s += `<rect x="${(x - 2.6).toFixed(1)}" y="${(y - 2.6).toFixed(1)}" width="5.2" height="5.2" fill="#ffffff" stroke="${CAS}" stroke-width="1.2"/>`;
      }
      for (const o of sc.stations) {
        const [x, y] = P(o);
        s += `<rect x="${(x - 5).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="10" height="6" fill="${M.rail}" stroke="${CAS}" stroke-width="1.3"/>`;
        mark(x, y, 6);
      }
      for (const o of sc.junctions) {
        const [x, y] = P(o);
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="none" stroke="#ffffff" stroke-width="1.6"/>`;
      }
    }
    if (L.B) {
      for (const o of sc.towns) {
        const [x, y] = P(o);
        const t = TOWN_KINDS[o.key];
        const r = (t?.r ?? 2.4) * (lv >= 3 ? 1 : 1.1);
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${M.town}" stroke="${CAS}" stroke-width="1.3"/>`;
        if ((t?.rank ?? 9) <= 3) mark(x, y, r + 1);
      }
    }
    if (L.G) {
      for (const o of sc.heights) {
        const [x, y] = P(o);
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="${M.hill}" stroke="${CAS}" stroke-width=".8"/>`;
      }
      for (const o of sc.hills) {
        const [x, y] = P(o);
        s += `<path d="M${x.toFixed(1)} ${(y - 5.5).toFixed(1)} l5 8.5 h-10z" fill="${M.hill}" stroke="${CAS}" stroke-width="1.2" stroke-linejoin="round"/>`;
        mark(x, y, 6);
      }
      for (const o of sc.itg) {
        const [x, y] = P(o);
        const strong = Number(o.a.it) >= 2;
        const r = strong ? 7.5 : 6;
        const sq = `x="${(x - r / 1.414).toFixed(1)}" y="${(y - r / 1.414).toFixed(1)}" width="${(r * 1.414).toFixed(1)}" height="${(r * 1.414).toFixed(1)}" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})" fill="none"`;
        s += `<rect ${sq} stroke="${CAS}" stroke-width="3.6"/><rect ${sq} stroke="${M.itg}" stroke-width="${strong ? 2.2 : 1.6}"/>`;
        mark(x, y, r);
      }
    }

    // Names: clear ground first, then the biggest towns, the highest ground, then road numbers; a handful at most.
    for (const [x, y, txt, col, size] of labels) s += label(x, y, txt, col, size);
    const maxNames = lv >= 3 ? 5 : 6;
    let named = 0;
    if (L.B) {
      const seen = new Set<string>();
      for (const o of [...sc.towns].sort((p, q) => people(q) - people(p) || p.d - q.d)) {
        const name = placeName(o.a.n);
        if (named >= 3 || !name || seen.has(name) || (lv >= 3 && (TOWN_KINDS[o.key]?.rank ?? 9) > 3)) continue;
        seen.add(name);
        const pop = people(o);
        const t = label(...P(o), pop ? `${name} ${ppl(pop)}` : name, M.town, FS.meta);
        if (t) {
          named++;
          s += t;
        }
      }
    }
    if (L.G) {
      for (const o of [...sc.hills].sort((p, q) => Number(q.a.e ?? 0) - Number(p.a.e ?? 0)).slice(0, 2)) {
        if (named >= maxNames - 1) break;
        const txt = `${o.a.n ? `${placeName(o.a.n)} ` : ''}${typeof o.a.e === 'number' ? `${Math.round(o.a.e)} m` : ''}`.trim();
        if (!txt) continue;
        const t = label(...P(o), txt, M.hill, FS.meta);
        if (t) {
          named++;
          s += t;
        }
      }
    }
    if (L.R) {
      const seen = new Set<string>();
      for (const l of [...by('msr'), ...by('all')]) {
        const n = typeof l.a.n === 'string' ? l.a.n.trim() : '';
        const key = (typeof l.a.r === 'string' && l.a.r.trim()) || (lv <= 2 && n && n.length <= 16 ? placeName(n) : '');
        if (!key || seen.has(key) || named >= maxNames) continue;
        const nb = nearestOn(l.pts);
        if (!nb) continue;
        const px = X(nb.x, nb.y);
        const py = Y(nb.x, nb.y);
        if (px < 10 || px > S - 10 || py < 10 || py > S - 10) continue;
        const t = label(px, py, key, '#ffffff', FS.meta);
        if (t) {
          seen.add(key);
          named++;
          s += t;
        }
      }
    }
    // Ring distances on the quietest diagonal of the screen.
    for (const qb of [135, 225, 45, 315]) {
      const before = boxes.length;
      let out = '';
      let ok = true;
      for (const d of sc.level.rings) {
        const a = (qb * Math.PI) / 180;
        const t = label(c + Math.sin(a) * d * kpx - 8, c - Math.cos(a) * d * kpx + 2, fmtDistance(d), '#d7dde3', FS.meta);
        if (!t) ok = false;
        out += t;
      }
      if (ok) {
        s += out;
        break;
      }
      boxes.length = before; // put back what this diagonal took, so the next one can try
    }

    // The spot: the symbol's facing, or a reticle for the map centre.
    if (f.source === 'centre') {
      s += `<g stroke-linecap="round"><path d="M${c - 11} ${c}H${c - 4}M${c + 4} ${c}H${c + 11}M${c} ${c - 11}V${c - 4}M${c} ${c + 4}V${c + 11}" stroke="${CAS}" stroke-width="4.5"/><path d="M${c - 11} ${c}H${c - 4}M${c + 4} ${c}H${c + 11}M${c} ${c - 11}V${c - 4}M${c} ${c + 4}V${c + 11}" stroke="#ffffff" stroke-width="2"/></g>`;
    } else {
      const b = (e?.facingDeg ?? 0) + f.northDeg;
      s += `<g transform="translate(${c} ${c}) rotate(${b.toFixed(1)})"><path d="M0 -12 L8.5 9 L0 4 L-8.5 9Z" fill="#ffffff" stroke="${CAS}" stroke-width="1.8" stroke-linejoin="round"/></g>`;
    }
    // North, the scale bar, and a word while the map's tiles are still coming.
    s += `<g transform="translate(16 18)"><circle r="11" fill="rgba(11,13,16,.55)" stroke="#8a96a3"/><path d="M0 -8 L4 1 L-4 1Z" fill="#e8ebee" transform="rotate(${f.northDeg.toFixed(1)})"/>${halo(0, 9, 'N', 'middle', '#e8ebee', 10, FW.bold)}</g>`;
    const lb = sc.level.barM * kpx;
    s += `<line x1="10" y1="${S - 11}" x2="${(10 + lb).toFixed(1)}" y2="${S - 11}" stroke="${CAS}" stroke-width="5"/><line x1="10" y1="${S - 11}" x2="${(10 + lb).toFixed(1)}" y2="${S - 11}" stroke="#e8ebee" stroke-width="2"/>${halo(10, S - 17, fmtDistance(sc.level.barM), 'start', '#e8ebee', FS.meta)}`;
    if (f.loading) s += halo(S - 10, 20, 'Loading map…', 'end', TEXT.label, FS.meta, FW.regular);
    return `${s}</g></svg>`;
  }

  /** Clear ground: the frontage drawn again where S would move it, dashed green, with an arrow to it (or a pointer at the edge). */
  private _ghost(
    f: ScopeFrame,
    e: ScopeEchelon,
    X: (x: number, y: number) => number,
    Y: (x: number, y: number) => number,
    c: number,
    S: number,
    mark: (x: number, y: number, r: number) => void,
    labels: Array<[number, number, string, string, number]>,
  ): string {
    const [gx, gy] = f.clearAt!;
    const d = Math.hypot(gx, gy);
    const name = `Clear Gr ${fmtDistance(d)}`;
    const sx = X(gx, gy);
    const sy = Y(gx, gy);
    const ang = Math.atan2(sx - c, -(sy - c)); // screen bearing of the spot, radians clockwise from up
    let s = '';
    if (sx > 4 && sx < S - 4 && sy > 4 && sy < S - 4) {
      s += ghostSvg(e, gx, gy, X, Y);
      if (Math.hypot(sx - c, sy - c) > 26) {
        const ax = c + 16 * Math.sin(ang);
        const ay = c - 16 * Math.cos(ang);
        const ex = sx - 9 * Math.sin(ang);
        const ey = sy + 9 * Math.cos(ang);
        const deg = ((ang * 180) / Math.PI).toFixed(1);
        s += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${CAS}" stroke-width="5.5" stroke-linecap="round"/><line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${M.clear}" stroke-width="2.6" stroke-linecap="round"/><g transform="translate(${ex.toFixed(1)} ${ey.toFixed(1)}) rotate(${deg})"><path d="M0 -6 L5.5 4 L-5.5 4Z" fill="${M.clear}" stroke="${CAS}" stroke-width="1.3"/></g>`;
      }
      labels.push([sx, sy, name, M.clear, FS.meta]);
    } else {
      // Off the map: a pointer at the edge, the way it lies.
      const sa = Math.abs(Math.sin(ang));
      const ca = Math.abs(Math.cos(ang));
      const t0 = Math.min(sa > 1e-6 ? (c - 12) / sa : 1e9, ca > 1e-6 ? (c - 12) / ca : 1e9);
      const ex = c + Math.sin(ang) * t0;
      const ey = c - Math.cos(ang) * t0;
      s += `<g transform="translate(${ex.toFixed(1)} ${ey.toFixed(1)}) rotate(${((ang * 180) / Math.PI).toFixed(1)})"><path d="M0 -9 L7 5 L-7 5Z" fill="${M.clear}" stroke="${CAS}" stroke-width="1.4"/></g>`;
      mark(ex, ey, 8);
      labels.push([ex, ey, name, M.clear, FS.meta]);
    }
    return s;
  }

  // ── the legend ─────────────────────────────────────────────────────────────

  private _legend(f: ScopeFrame): HTMLElement {
    const leg = el('div', 'ms-ggsc-leg');
    const key = el('div', 'ms-ggsc-key');
    const e = f.echelon;
    const k = (icon: string, word: string) => {
      const s = el('span');
      const i = el('span');
      i.innerHTML = icon; // fixed markup
      s.append(i.firstChild!, word);
      key.append(s);
    };
    if (f.source === 'centre') k(tiny(`<path d="M5 7H9M13 7H17M11 1V5M11 9V13" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`), 'Map centre');
    else k(tiny(`<path d="M11 1 L16 13 L11 10 L6 13Z" fill="#fff" stroke="${CAS}" stroke-width="1.1" stroke-linejoin="round"/>`), 'Symbol');
    if (e) {
      k(
        e.depthM > 0
          ? tiny(`<rect x="2" y="3" width="18" height="9" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M2 3H11" stroke="#fff" stroke-width="3.2"/><path d="M11 3H20" stroke="${M.frontNogo}" stroke-width="3.2"/>`)
          : tiny(`<path d="M1 7H9" stroke="#fff" stroke-width="3.6"/><path d="M9 7H14" stroke="${M.frontPart}" stroke-width="3.6"/><path d="M14 7H21" stroke="${M.frontNogo}" stroke-width="3.6"/>`),
        e.depthM > 0 ? 'Posn' : 'Frontage',
      );
    }
    k(tiny(`<circle cx="11" cy="7" r="5.5" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.1"/>`), 'Rings');
    if (f.clearAt) k(tiny(`<path d="M1 7H21" stroke="${M.clear}" stroke-width="3" stroke-dasharray="5 3"/>`), 'Clear Gr');
    leg.append(key);
    const rows = this._rows(f);
    for (const [letter, name] of LETTERS) {
      const on = this._store.layers[letter];
      const b = el('button', 'ms-ggsc-row');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(on));
      b.dataset.layer = letter;
      b.title = `${name}: click to ${on ? 'hide' : 'show'} on the map`;
      const c = el('span', 'ms-ggsc-c');
      c.append(...rows[letter]);
      b.append(el('span', 'ms-ggsc-l', letter), c);
      leg.append(b);
    }
    return leg;
  }

  /** One line per letter: the nearest or biggest of each thing in view. */
  private _rows(f: ScopeFrame): Record<ScopeLetter, HTMLElement[]> {
    const sc = f.scene;
    const R = sc.level.radiusM;
    const nr = (f.northDeg * Math.PI) / 180;
    const cs = Math.cos(nr);
    const sn = Math.sin(nr);
    // In view: inside the turned map's square.
    const inView = (x: number, y: number) => Math.abs(x * cs + y * sn) <= R && Math.abs(-x * sn + y * cs) <= R;
    const N = SCOPE_N;
    const step = (2 * sc.half) / N;
    const cellAt = (i: number, j: number): [number, number] => [(i - (N - 1) / 2) * step, ((N - 1) / 2 - j) * step];
    // One pass over the cells in view: how many of each going and cover code, and the nearest of each.
    let cells = 0;
    const count: Record<string, number> = {};
    const nearD: Record<string, number> = {};
    const nearXY: Record<string, [number, number]> = {};
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const [x, y] = cellAt(i, j);
        if (!inView(x, y)) continue;
        cells++;
        const o = j * N + i;
        const d = x * x + y * y;
        const kg = `g${sc.going[o]}`;
        const ko = `o${sc.over[o]}`;
        count[kg] = (count[kg] ?? 0) + 1;
        count[ko] = (count[ko] ?? 0) + 1;
        if (!(d >= nearD[kg])) ((nearD[kg] = d), (nearXY[kg] = [x, y]));
        if (!(d >= nearD[ko])) ((nearD[ko] = d), (nearXY[ko] = [x, y]));
      }
    }
    const near = {
      get: (k: string): { d: number; b: number } | undefined => {
        const p = nearXY[k];
        return p ? { d: Math.hypot(p[0], p[1]), b: ((Math.atan2(p[0], p[1]) * 180) / Math.PI + 360) % 360 } : undefined;
      },
    };
    const share = (k: string) => (cells ? (count[k] ?? 0) / cells : 0);
    const best = (kind: ScopeLine['kind']) => {
      let b: { n: { d: number; b: number }; a: Record<string, unknown> } | null = null;
      for (const l of sc.lines) {
        if (l.kind !== kind) continue;
        const n = nearestOn(l.pts);
        if (n && inView(n.x, n.y) && (!b || n.d < b.n.d)) b = { n, a: l.a };
      }
      return b;
    };
    const vis = (list: ScopePoint[]) => list.filter((p) => inView(p.x, p.y));

    // G
    const g: HTMLElement[] = [];
    const hi = vis(sc.hills).sort((p, q) => Number(q.a.e ?? 0) - Number(p.a.e ?? 0))[0];
    if (hi) g.push(item(IC.hill, `High Gr${typeof hi.a.e === 'number' ? ` ${Math.round(hi.a.e)} m` : ''}`, at(hi.d, hi.b)));
    const itg = vis(sc.itg);
    if (itg.length) {
      const ni = [...itg].sort((p, q) => p.d - q.d)[0];
      g.push(item(IC.itg, `${Math.max(sc.itgAll, itg.length)} ITG`, `nearest ${at(ni.d, ni.b)}`));
    } else if (best('ridge')) g.push(item(IC.ridge, 'Ridgeline', at(best('ridge')!.n.d, best('ridge')!.n.b)));
    if (!g.length) g.push(item(IC.hill, 'No high Gr in view'));

    // R
    const r: HTMLElement[] = [];
    const msr = best('msr');
    const all = best('all');
    const rail = best('rail');
    const minor = best('fair') ?? best('minor') ?? best('track');
    if (msr) {
      const cl = parseInt(String(msr.a.c ?? ''), 10);
      r.push(item(IC.msr, `${typeof msr.a.r === 'string' && msr.a.r ? `${msr.a.r} ` : ''}MSR${Number.isFinite(cl) ? ` Cl ${cl}` : ''}`, at(msr.n.d, msr.n.b)));
    }
    if (all && (!msr || all.n.d < msr.n.d)) r.push(item(IC.all, 'All-weather Rd', at(all.n.d, all.n.b)));
    if (rail && r.length < 2) r.push(item(IC.rail, 'Rly', at(rail.n.d, rail.n.b)));
    if (!r.length && minor) r.push(item(IC.minor, 'Rd', at(minor.n.d, minor.n.b)));
    if (!r.length) r.push(item(IC.minor, 'No Rd in view'));

    // O
    const o: HTMLElement[] = [];
    const ng = near.get(`g${GOING_NOGO}`);
    if (ng && f.verdict?.verdict !== 'exempt') o.push(item(this._store.layers.T ? IC.nogo : swatch(M.plain.nogo), 'NO-GO Gr', ng.d < step * 1.5 ? (f.source === 'centre' ? 'at the centre' : 'at the symbol') : at(ng.d, ng.b)));
    const canal = best('canal');
    const river = best('river');
    const w = canal && river ? (canal.n.d < river.n.d ? (['Canal', canal] as const) : (['River', river] as const)) : canal ? (['Canal', canal] as const) : river ? (['River', river] as const) : null;
    if (w) o.push(item(IC.water, w[0], at(w[1].n.d, w[1].n.b)));
    const pw = best('power');
    if (pw && o.length < 2) o.push(item(IC.power, 'Power line', at(pw.n.d, pw.n.b)));
    if (!o.length) o.push(item(IC.water, 'No Obs in view'));

    // T
    const t: HTMLElement[] = [];
    if (f.verdict?.verdict === 'exempt') t.push(item(swatch(M.cell.none), 'Not judged', 'the symbol is not terrain-bound'));
    else {
      for (const [code, word] of [[GOING_GO, 'Suitable'], [GOING_MARG, 'Marginal'], [GOING_SLOW, 'SLOW-GO'], [GOING_NOGO, 'NO-GO']] as const) {
        const p = Math.round(share(`g${code}`) * 100);
        if (p) t.push(item(swatch(CELL_COLORS[code]), word, `${p}%`));
      }
      if (!t.length) t.push(item(swatch(M.cell.none), 'No terrain data in view'));
    }

    // B
    const bb: HTMLElement[] = [];
    const towns = vis(sc.towns).filter((p) => placeName(p.a.n));
    const big = [...towns].sort((p, q) => people(q) - people(p) || p.d - q.d)[0];
    if (big) bb.push(item(IC.town, `${placeName(big.a.n)}${people(big) ? ` ${ppl(people(big))}` : ''}`, at(big.d, big.b)));
    const nearT = towns.filter((p) => !big || placeName(p.a.n) !== placeName(big.a.n)).sort((p, q) => p.d - q.d)[0];
    if (nearT) bb.push(item(IC.town, placeName(nearT.a.n), at(nearT.d, nearT.b)));
    else {
      const bu = share(`o${OVER_BUA}`);
      if (bu > 0.004) bb.push(item(IC.bua, `BUA ${Math.max(1, Math.round(bu * 100))}%`, 'of the view'));
    }
    if (!bb.length) bb.push(item(IC.town, 'No BUA in view'));

    // C
    const cc: HTMLElement[] = [];
    const tr = near.get(`o${OVER_TREES}`);
    if (tr) cc.push(item(IC.trees, `Trees ${Math.max(1, Math.round(share(`o${OVER_TREES}`) * 100))}%`, `nearest ${at(tr.d, tr.b)}`));
    const nu = near.get(`o${OVER_NULLAH}`);
    if (nu) cc.push(item(IC.nullah, 'Nullah', at(nu.d, nu.b)));
    if (!cc.length) cc.push(item(IC.trees, 'Little cover in view'));

    return { G: g.slice(0, 2), R: r.slice(0, 2), O: o.slice(0, 2), T: t, B: bb.slice(0, 2), C: cc };
  }

  private _image(sc: ScopeScene, key: string, draw: (cv: HTMLCanvasElement) => void): string {
    let m = IMAGES.get(sc);
    if (!m) IMAGES.set(sc, (m = new Map()));
    let url = m.get(key);
    if (!url) {
      const cv = document.createElement('canvas');
      draw(cv);
      url = cv.toDataURL();
      m.set(key, url);
    }
    return url;
  }
}

// ── drawing helpers ──────────────────────────────────────────────────────────

/** The nearest point of a polyline (ground metres) to the spot, with its distance and bearing. */
function nearestOn(pts: Float64Array): { x: number; y: number; d: number; b: number } | null {
  let best: { x: number; y: number; d: number; b: number } | null = null;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const ax = pts[i - 2];
    const ay = pts[i - 1];
    const dx = pts[i] - ax;
    const dy = pts[i + 1] - ay;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const x = ax + t * dx;
    const y = ay + t * dy;
    const d = Math.hypot(x, y);
    if (!best || d < best.d) best = { x, y, d, b: ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 };
  }
  return best;
}

/** Going cells, one canvas pixel each; with T off, plain ground with NO-GO kept in the neutral obstacle colour. */
function paintGoing(cv: HTMLCanvasElement, going: Uint8Array, T: boolean): void {
  const N = SCOPE_N;
  cv.width = N;
  cv.height = N;
  const x = cv.getContext('2d');
  if (!x) return;
  const plain = ['', M.plain.ground, M.plain.ground, M.plain.ground, M.plain.nogo];
  for (let i = 0; i < going.length; i++) {
    const g = going[i];
    x.fillStyle = g ? (T ? CELL_COLORS[g] : plain[g]) : M.cell.none;
    x.fillRect(i % N, Math.floor(i / N), 1, 1);
  }
}

/** Built-up hatch (B) and trees / nullah stipple (C) at 4 px a cell, the pattern running across cells. */
function paintOver(cv: HTMLCanvasElement, over: Uint8Array, which: 'B' | 'C'): void {
  const N = SCOPE_N;
  const S = N * 4;
  cv.width = S;
  cv.height = S;
  const x = cv.getContext('2d');
  if (!x) return;
  const d = x.createImageData(S, S);
  const px = d.data;
  const set = (i: number, j: number, rgb: readonly number[], a: number) => {
    const o = (j * S + i) * 4;
    px[o] = rgb[0];
    px[o + 1] = rgb[1];
    px[o + 2] = rgb[2];
    px[o + 3] = a;
  };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const ch = over[(j >> 2) * N + (i >> 2)];
      if (which === 'B' && ch === OVER_BUA && (i + j) % 6 === 0) set(i, j, M.bua, 150);
      if (which === 'C' && ch === OVER_TREES && i % 6 < 2 && j % 6 < 2) set(i, j, M.trees, 205);
      if (which === 'C' && ch === OVER_NULLAH && (i - j + 600) % 6 === 0) set(i, j, M.nullah, 185);
    }
  }
  x.putImageData(d, 0, 0);
}

/** Unit vectors (east, north) ahead of the unit and to its right, for a facing in degrees from north. */
function axes(facingDeg: number): { fx: number; fy: number; rx: number; ry: number } {
  const a = (facingDeg * Math.PI) / 180;
  return { fx: Math.sin(a), fy: Math.cos(a), rx: Math.cos(a), ry: -Math.sin(a) };
}

/** The frontage at (px, py) ground metres: a box (with depth) or a line, its front edge in blocks coloured by NO-GO; a disc when it faces all round. */
function footprintSvg(
  e: ScopeEchelon,
  px: number,
  py: number,
  front: GroundGuideFrontBlock[] | null,
  X: (x: number, y: number) => number,
  Y: (x: number, y: number) => number,
  kpx: number,
  boxes: number[][],
): string {
  const F = e.frontageM / 2;
  const D = e.depthM / 2;
  if (e.facingDeg === null) {
    const r = (F * kpx).toFixed(1);
    const cx = X(px, py).toFixed(1);
    const cy = Y(px, py).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,.06)" stroke="${CAS}" stroke-width="4"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffffff" stroke-width="1.8"/>`;
  }
  const { fx, fy, rx, ry } = axes(e.facingDeg);
  const pt = (a: number, b: number): [number, number] => [X(px + a * fx + b * rx, py + a * fy + b * ry), Y(px + a * fx + b * rx, py + a * fy + b * ry)];
  let s = '';
  if (D > 0) {
    const ring = [pt(D, -F), pt(D, F), pt(-D, F), pt(-D, -F)].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    s += `<polygon points="${ring}" fill="rgba(255,255,255,.06)" stroke="${CAS}" stroke-width="4"/><polygon points="${ring}" fill="none" stroke="#ffffff" stroke-width="1.8"/>`;
  }
  // The front edge, left to right as the unit faces, one block per stretch of the front.
  const [lx, ly] = pt(D, -F);
  const [qx, qy] = pt(D, F);
  const w = D > 0 ? 6 : 5;
  s += `<line x1="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${qx.toFixed(1)}" y2="${qy.toFixed(1)}" stroke="${CAS}" stroke-width="${w + 3.5}" stroke-linecap="square"/>`;
  const blocks = front?.length ? front : [{ nogo: 0, rest: 'go' as const }];
  const n = blocks.length;
  blocks.forEach((b, i) => {
    const t0 = i / n;
    const t1 = Math.min(1, (i + 1) / n + 0.002);
    const col = b.nogo >= 0.5 ? M.frontNogo : b.nogo > 0 ? M.frontPart : b.rest === 'slow' ? TONE.slow.text : '#ffffff';
    s += `<line x1="${(lx + (qx - lx) * t0).toFixed(1)}" y1="${(ly + (qy - ly) * t0).toFixed(1)}" x2="${(lx + (qx - lx) * t1).toFixed(1)}" y2="${(ly + (qy - ly) * t1).toFixed(1)}" stroke="${col}" stroke-width="${w}"/>`;
  });
  boxes.push([Math.min(lx, qx) - 4, Math.min(ly, qy) - 6, Math.max(lx, qx) + 4, Math.max(ly, qy) + 6]);
  return s;
}

/** The frontage drawn at the clear ground: dashed green, the same shape. */
function ghostSvg(e: ScopeEchelon, px: number, py: number, X: (x: number, y: number) => number, Y: (x: number, y: number) => number): string {
  const F = e.frontageM / 2;
  const D = e.depthM / 2;
  if (e.facingDeg === null) {
    const r = Math.hypot(X(px + F, py) - X(px, py), Y(px + F, py) - Y(px, py)).toFixed(1);
    return `<circle cx="${X(px, py).toFixed(1)}" cy="${Y(px, py).toFixed(1)}" r="${r}" fill="rgba(116,220,163,.12)" stroke="${M.clear}" stroke-width="2.2" stroke-dasharray="6 4"/>`;
  }
  const { fx, fy, rx, ry } = axes(e.facingDeg);
  const pt = (a: number, b: number) => `${X(px + a * fx + b * rx, py + a * fy + b * ry).toFixed(1)},${Y(px + a * fx + b * rx, py + a * fy + b * ry).toFixed(1)}`;
  if (D > 0) return `<polygon points="${[pt(D, -F), pt(D, F), pt(-D, F), pt(-D, -F)].join(' ')}" fill="rgba(116,220,163,.12)" stroke="${M.clear}" stroke-width="2.2" stroke-dasharray="6 4"/>`;
  const [a, b] = [pt(0, -F), pt(0, F)];
  return `<polyline points="${a} ${b}" fill="none" stroke="${CAS}" stroke-width="6.5"/><polyline points="${a} ${b}" fill="none" stroke="${M.clear}" stroke-width="3.5" stroke-dasharray="6 3"/>`;
}

/** The rail's own mark (no verdict yet): a scope ring with a cross. */
function scopeGlyph(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '19');
  svg.setAttribute('height', '19');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 1.5V6M10 14V18.5M1.5 10H6M14 10H18.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'; // fixed markup
  return svg;
}
