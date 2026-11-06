/**
 * GroundGuideDetail.ts
 *
 * The Ground Detail (D while drawing): a wide card docked at the foot of the map with a tab a GROTBC letter
 * (G Ground, R Roads & Rail, O Obstacles, T Trafficability, B Built-Up, C Cover) and the Legend (key K; L is Lasso Select), where the
 * docked legend and the layers and data behind the advice live while the card is open. It took the place of the
 * vertical Ground Brief on 2026-11-06, so that everything the engine reads is in view at once instead of a column
 * to scroll; the cursor card keeps only the verdict, Why, Inside, Nearest and the Inter Gap Rule.
 *
 * Each tab is a grid of tiles, packed so each tile is its own height (a short tile beside a tall one neither stretches
 * nor leaves a hole), built from the same pictures the card styles offer (the soil triangle and strength
 * gauge, the military-crest profile, the movement rose and going map, the road density gauge, ways-out rose and
 * make-up bar, the speed rose and road strip, the people radar, rose and minimap, the cover rose, tiles and shield),
 * so the user compares nothing: it is all there, north up. Only the active tab is built on each verdict, and the
 * Legend tab only when the legend changes. The card keeps its scroll and never shrinks while open (its height
 * ratchets), so the tiles do not jump under the eye as the cursor moves. A letter key switches tabs (and opens the card when it is closed);
 * the same letter again, D or Esc closes it. Esc still reaches the draw tool.
 *
 * DOM nodes and textContent only (names and labels never become markup). The card stops pointer events reaching
 * the map, as the legend does.
 */

import { itgSection, titleOf, verdictColor } from './GroundGuideBadge';
import { briefText, crossCountryDetail, ensureBriefCss, LETTER_COLOR, monthName, movementDetail, soilDetail, type GrotbcLetter } from './GroundGuideBrief';
import { COVER_FIELD_LABEL } from './GroundGuideCover';
import {
  aroundLine,
  bankLine,
  builtLine,
  coverGivesLine,
  coverGridTiles,
  coverIconsRow,
  coverRose,
  coverRoseKey,
  ensureCoverCss,
  formLine,
  fourLines,
  localLine,
  needLine,
  nearestGrid,
  roseText,
  shelterLine,
} from './GroundGuideCoverView';
import { fmtDistance } from './GroundGuideEvaluator';
import { ensureGoingCss, exitStripSection, goingCanvas, mapShares, ribbon, roseLegend, seasonIcon } from './GroundGuideGoingView';
import { buildLegend, ensureLegendStyle, legendEl, legendKeyRow, modeIcon, type LegendHandlers, type LegendState } from './GroundGuideLegend';
import {
  ageBar,
  densityScale,
  ensurePopulationCss,
  fmtPeople,
  nearestLine,
  populationChip,
  populationCompare,
  populationFlagStrip,
  populationLine,
  populationMinimap,
  populationPlaces,
  populationProfile,
  populationRose,
  populationSourceLine,
  radar,
  ringList,
} from './GroundGuidePopulationView';
import { fmtRadius, roadDensityNote } from './GroundGuideRoadDensity';
import { DENSITY_COLOURS, densityGauge, densityMakeup, densityRose, ensureRoadDensityCss } from './GroundGuideRoadDensityView';
import type { ObstaclesReading } from './GroundGuideSections';
import { buildingsProtected, buildingsWhere, groundChips, groundRelief, obstaclesGap, obstaclesTiles, roadsShield, roadsVerdict, weatherIcons, weatherYear } from './GroundGuideSectionsStyles';
import {
  buildingsMore,
  buildingsRows,
  ensureSectionsCss,
  groundMore,
  groundRows,
  kv,
  obstaclesMore,
  obstaclesRows,
  railTransportLine,
  roadsMore,
  roadsRows,
} from './GroundGuideSectionsView';
import {
  ensureSpeedCss,
  speedCaption,
  speedDayText,
  speedGrid,
  speedGroundText,
  speedHeadline,
  speedModeTiles,
  speedRoseLines,
  speedRoseSvg,
  speedWay,
  speedWhen,
} from './GroundGuideSpeedView';
import { blockGauge, blockTiles, blockWayOut, ensureTrafficCss, roadBlock, viewOf } from './GroundGuideTrafficView';
import type { GroundGuideVerdict } from './GroundGuideTypes';

export type DetailTab = GrotbcLetter | 'L';
export const DETAIL_TABS: readonly DetailTab[] = ['G', 'R', 'O', 'T', 'B', 'C', 'L'];
/** Map layer switches the Legend tab offers. */
export type DetailToggle = 'overlay' | 'boundary' | 'people' | 'indicators' | 'footprint';

/** The Legend tab's map switches, with the overlay's opacity. */
export interface DetailLegendInfo {
  overlayOpacity: number;
  toggles: Array<{ key: DetailToggle; label: string; on: boolean; note?: string }>;
}

export interface DetailHandlers {
  close(): void;
  /** The Legend tab's mode strip, season and day / night controls (the docked legend's own handlers). */
  legend: LegendHandlers;
  /** A layer switch in the Legend tab was used. */
  toggle(key: DetailToggle, on: boolean): void;
  /** The overlay opacity slider in the Legend tab was moved (0-1). */
  opacity(v: number): void;
  /** The tab changed (by click or key). */
  tab?(tab: DetailTab): void;
}

const STYLE_ID = 'ms-ground-guide-detail-style';
const TAB_KEY = 'ms-ground-guide-detail-tab';
const TAB_LABEL: Record<DetailTab, string> = { G: 'Ground', R: 'Roads & Rail', O: 'Obstacles', T: 'Trafficability', B: 'Built-Up', C: 'Cover', L: 'Legend' };
/** The key that opens each tab: the letter itself, except the Legend (K: L is Lasso Select in the app). */
export const TAB_KEY_OF: Record<DetailTab, string> = { G: 'G', R: 'R', O: 'O', T: 'T', B: 'B', C: 'C', L: 'K' };
const TAB_COLOR: Record<DetailTab, string> = { ...LETTER_COLOR, L: '#aab3bd' };
const TAB_FG: Record<DetailTab, string> = { G: '#1b1f25', R: '#1b1f25', O: '#fff', T: '#1b1f25', B: '#1b1f25', C: '#fff', L: '#1b1f25' };
/** Caption colour per tab: the letter's accent, lightened where it would sink into the dark tiles. */
const CAP_COLOR: Record<DetailTab, string> = { G: '#a9cf6f', R: '#d9b67e', O: '#b9a3ec', T: '#7dbcf0', B: '#c2b6aa', C: '#4fcf95', L: '#aab3bd' };
const W_COLOR = '#4a7f95';
/** Space between tiles, in px (the column gap in the CSS below; rows carry it inside each tile's span). */
const TILE_GAP = 9;

const CSS = `
.ms-ggd{position:fixed;left:10px;right:10px;bottom:10px;z-index:2147482800;max-height:min(54vh,640px);
  display:none;flex-direction:column;box-sizing:border-box;border-radius:12px;background:#1b1f25;border:1.5px solid #5b6470;box-shadow:0 8px 28px rgba(0,0,0,.5);
  font:400 13px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;--pb-k:#aab3bd}
.ms-ggd.ms-open{display:flex}
.ms-ggd-h{display:flex;align-items:center;gap:6px 8px;padding:7px 10px;background:#2b333d;border-radius:11px 11px 0 0;flex-wrap:wrap}
.ms-ggd-tabs{display:flex;gap:4px;flex-wrap:wrap}
.ms-ggd-tab{display:inline-flex;align-items:center;gap:7px;padding:5px 11px 5px 6px;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#c3cbd3;
  font:600 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer;letter-spacing:.02em}
.ms-ggd-tab:hover{background:rgba(255,255,255,.12);color:#fff}
.ms-ggd-tab:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-tab[aria-selected="true"]{background:var(--lc);border-color:var(--lc);color:var(--lf)}
.ms-ggd-tab[aria-selected="true"] .ms-ggd-k{background:rgba(0,0,0,.25);border-color:rgba(0,0,0,.35);color:var(--lf)}
.ms-ggd-k{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 4px;box-sizing:border-box;border-radius:4px;
  font:700 11px/1 ui-monospace,Consolas,monospace;color:#fff;background:linear-gradient(#3a424d,#2b313a);border:1px solid #545e6b;border-bottom-width:2px}
.ms-ggd-meta{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12.5px;color:#c3cbd3;min-width:0;flex-wrap:wrap}
.ms-ggd-meta b{color:#fff}
.ms-ggd-dot{display:inline-block;width:10px;height:10px;border-radius:50%;flex:none;box-shadow:0 0 0 1.5px rgba(255,255,255,.35)}
.ms-ggd-sep{color:#6b737c}
.ms-ggd-upd{color:#ffc861}
.ms-ggd-btn{font:inherit;color:#c3cbd3;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:6px;cursor:pointer;height:24px;padding:0 8px;line-height:1;white-space:nowrap}
.ms-ggd-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.ms-ggd-btn:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-btn.ms-x{width:26px;padding:0;font-size:15px}
.ms-ggd-s{overflow:auto;flex:1 1 auto;min-height:0;padding:10px;scrollbar-width:thin;scrollbar-color:#4a535e transparent}
/* The grid sits inside the scroller, so its height is its content, never the flex-resolved height: a definite
   height would share the rows out equally and clip every tile (the auto minimum of an overflow:hidden item is 0). */
/* Packed like a masonry: 1px rows, each tile spans its own measured height plus the gap (_pack), so a short tile
   beside a tall one neither stretches to match it nor leaves the row below it empty. */
.ms-ggd-b{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));grid-auto-rows:1px;column-gap:9px;row-gap:0;align-content:start;align-items:start}
.ms-ggd .ms-ggd-b>.ms-ggb-sec{background:#222830;border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:10px 13px 11px;min-width:0;overflow:hidden;font-size:13px}
.ms-ggd .ms-ggd-b>.ms-ggb-sec>.ms-ggb-cap{font-size:11.5px;margin-bottom:7px}
.ms-ggd .ms-gs-kv,.ms-ggd .ms-ggbr-ln,.ms-ggd .ms-gc-row,.ms-ggd .ms-gc-near,.ms-ggd .ms-ggp-list,.ms-ggd .ms-ggp-ln,.ms-ggd .ms-ggp-places,.ms-ggd .ms-ggd-kv,.ms-ggd .ms-gx-where,.ms-ggd .ms-gx-list,.ms-ggd .ms-ggs-kv,.ms-ggd .ms-ggb-tkv{font-size:12.5px}
.ms-ggd .ms-gs-kv{grid-template-columns:72px minmax(0,1fr);gap:4px 10px}
.ms-ggd .ms-gs-kv>.ms-gs-k,.ms-ggd .ms-ggd-kv>.k,.ms-ggd .ms-ggp-k,.ms-ggd .ms-ggbr-ln>span:first-child{font-size:11.5px}
.ms-ggd .ms-gv-soft,.ms-ggd .ms-ggb-soft,.ms-ggd .ms-ggd-soft,.ms-ggd .ms-gc-soft,.ms-ggd .ms-gx-soft,.ms-ggd .ms-grd-soft,.ms-ggd .ms-gv-blk,.ms-ggd .ms-gv-limit,.ms-ggd .ms-ggbr-list,.ms-ggd .ms-ggp-src{font-size:12px}
.ms-ggd .ms-gv-k,.ms-ggd .ms-gv-mx,.ms-ggd .ms-gx-chips>span,.ms-ggd .ms-ggl-chips>span{font-size:12px}
.ms-ggd .ms-ggb-big,.ms-ggd .ms-ggp-big,.ms-ggd .ms-ggs-big,.ms-ggd .ms-ggb-tbig{font-size:21px}
.ms-ggd .ms-gv-rate{font-size:17px}
.ms-ggd .ms-ggd-b>.ms-ggd-w2{grid-column:span 2}
.ms-ggd .ms-ggd-b>.ms-ggd-wall{grid-column:1 / -1}
.ms-ggd .ms-ggd-b>.ms-ggp-civ{border-radius:9px;border:1px solid rgba(240,226,200,.3)}
.ms-ggd-cap{display:flex;align-items:center;gap:7px}
.ms-ggd-l{display:inline-flex;align-items:center;justify-content:center;flex:none;width:17px;height:17px;border-radius:4px;font:800 11px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0}
.ms-ggd-empty{grid-column:1 / -1;color:#9aa3ad;padding:18px 12px;text-align:center;font-size:12.5px}
.ms-ggd-soft{color:#9aa3ad;font-size:12px;margin-top:5px}
.ms-ggd-soft b{color:#e8ebee;font-weight:600}
.ms-ggd-note{margin-top:6px;border-radius:5px;padding:4px 7px;font-size:11px}
.ms-ggd-f{padding:5px 12px 6px;font-size:11px;color:#8b95a0;border-top:1px solid rgba(255,255,255,.08);display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center}
.ms-ggd-f .ms-ggd-k{min-width:14px;height:14px;font-size:8.5px;padding:0 2px;margin-right:2px}
.ms-ggd .ms-ggb-sec .ms-gv-rose,.ms-ggd .ms-ggb-sec .ms-gv-map,.ms-ggd .ms-ggb-sec .ms-gc-rose,.ms-ggd .ms-ggb-sec .ms-ggs-rose{flex-wrap:wrap}
.ms-ggd .ms-ggl-strip{margin-top:0}
.ms-ggd .ms-ggl-list{margin-top:0;padding-top:0;border-top:0;max-height:none}
.ms-ggd .ms-ggl-keys{margin-top:0;padding-top:0;border-top:0;flex-direction:column;gap:6px}
.ms-ggd .ms-ggl-tcap:first-child{margin-top:0}
.ms-ggd-kv{display:grid;grid-template-columns:62px minmax(0,1fr);gap:3px 8px;font-size:11.5px;line-height:1.35}
.ms-ggd-kv>.k{color:#9aa3ad;font-size:10.5px;padding-top:1px}
.ms-ggd-kv>.v{min-width:0;color:#e8ebee;overflow-wrap:anywhere}
.ms-ggd-kv b{color:#fff;font-weight:600}
.ms-ggd-chips{display:flex;flex-wrap:wrap;gap:3px}
.ms-ggd-chips>span{font:500 10.5px/1 ui-monospace,Consolas,monospace;padding:3px 6px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#c3cbd3}
.ms-ggd-tg{display:flex;align-items:center;gap:7px;font-size:11.5px;cursor:pointer;padding:2px 0}
.ms-ggd-tg input{margin:0;accent-color:#8ec1ea}
.ms-ggd-tg small{color:#9aa3ad;font-size:10.5px}
.ms-ggd-modes{display:flex;flex-wrap:wrap;gap:6px}
.ms-ggd-mode{display:inline-flex;align-items:center;gap:7px;padding:6px 11px 6px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#c3cbd3;
  font:600 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer;white-space:nowrap}
.ms-ggd-mode:hover{background:rgba(255,255,255,.12);color:#fff}
.ms-ggd-mode:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-mode[aria-pressed="true"]{background:#8ec1ea;border-color:#8ec1ea;color:#1b1f25}
.ms-ggd-mode svg{flex:none;width:17px;height:17px}
.ms-ggd-modetag{margin-top:8px;font-size:12px;color:#9aa3ad}
.ms-ggd-modetag b{color:#fff;font-size:13px}
.ms-ggd-modetag .ms-hand{color:#ffc861}
.ms-ggd-sws{display:flex;flex-direction:column}
.ms-ggd-swrow{position:relative;display:flex;align-items:center;gap:11px;padding:7px 0;cursor:pointer;border-top:1px solid rgba(255,255,255,.07)}
.ms-ggd-swrow:first-child{border-top:0;padding-top:2px}
.ms-ggd-swin{position:absolute;opacity:0;width:0;height:0;margin:0}
.ms-ggd-sw{flex:none;width:36px;height:20px;border-radius:999px;background:#3a424d;position:relative;border:1px solid rgba(255,255,255,.1)}
.ms-ggd-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff}
.ms-ggd-swin:checked+.ms-ggd-sw{background:#2fa862;border-color:#2fa862}
.ms-ggd-swin:checked+.ms-ggd-sw::after{transform:translateX(16px)}
.ms-ggd-swin:focus-visible+.ms-ggd-sw{outline:2px solid #8ec1ea;outline-offset:2px}
.ms-ggd-swrow>span:last-child{min-width:0}
.ms-ggd-swrow b{display:block;color:#fff;font-weight:600;font-size:13px}
.ms-ggd-swrow small{display:block;color:#9aa3ad;font-size:11.5px;line-height:1.35}
.ms-ggd-range{display:flex;align-items:center;gap:8px;padding:0 0 8px 47px;font-size:12px;color:#9aa3ad}
.ms-ggd-range input{flex:1;min-width:0;accent-color:#8ec1ea;margin:0}
.ms-ggd-range b{color:#fff;font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
.ms-ggd .ms-ggl-ramp>i{height:14px}
.ms-ggd .ms-ggl-ramp-l{font-size:12px;color:#c3cbd3}
.ms-ggd .ms-ggl-note{font-size:12px;margin-top:5px}
.ms-ggd .ms-ggl-tcap{font-size:11px}
.ms-ggd .ms-ggl-cap{font-size:11px}
.ms-ggd .ms-ggl-key small{font-size:11.5px}
@media (prefers-reduced-motion:no-preference){.ms-ggd-sw,.ms-ggd-sw::after{transition:background .15s,transform .15s}}
@media (max-width:720px){.ms-ggd{left:6px;right:6px;bottom:6px;max-height:70vh}.ms-ggd-src{columns:1}.ms-ggd .ms-ggd-b>.ms-ggd-w2{grid-column:auto}}
@media (prefers-reduced-motion:no-preference){.ms-ggd-tab{transition:background .12s,color .12s}}
`;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function soft(text: string): HTMLElement {
  return el('div', 'ms-ggd-soft', text);
}

/** A tile: a letter badge and caption over its content (nulls skipped). The same look as a card section. */
function tile(letter: DetailTab | 'W', caption: string, ...content: Array<Node | string | null | undefined | false>): HTMLElement {
  const sec = el('div', 'ms-ggb-sec');
  const cap = el('div', 'ms-ggb-cap ms-ggd-cap');
  const b = el('span', 'ms-ggd-l', letter);
  b.style.background = letter === 'W' ? W_COLOR : TAB_COLOR[letter];
  b.style.color = letter === 'W' || letter === 'O' || letter === 'C' ? '#fff' : '#1b1f25';
  cap.append(b, caption);
  sec.append(cap);
  for (const c of content) if (c) sec.append(c);
  return sec;
}

function wide(e: HTMLElement, cols: 2 | 'all' = 2): HTMLElement {
  e.classList.add(cols === 'all' ? 'ms-ggd-wall' : 'ms-ggd-w2');
  return e;
}

function empty(text: string): HTMLElement {
  return el('div', 'ms-ggd-empty', text);
}

/** A canal with a recorded width or depth, or a river reach with a depth: the gap cross-section has something to draw. */
function hasGap(o: ObstaclesReading): boolean {
  const c = o.canal;
  const r = o.reach;
  return !!(c && (c.widthM || c.depthM)) || !!(r && r.depthM);
}

function readTab(): DetailTab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t && (DETAIL_TABS as readonly string[]).includes(t)) return t as DetailTab;
  } catch {
    /* storage blocked */
  }
  return 'G';
}

/** True when any part of the verdict is still waiting on tiles or features. */
function pendingOf(v: GroundGuideVerdict): boolean {
  return !!(v.loading || v.going?.pending || v.cover?.pending || v.sections?.pending || v.speed?.pending || v.population?.reading.pending || v.traffic?.pending || v.ground?.pending);
}

export class GroundGuideDetail {
  private _el: HTMLDivElement | null = null;
  private _tabs = new Map<DetailTab, HTMLButtonElement>();
  private _meta: HTMLElement | null = null;
  private _body: HTMLElement | null = null;
  private _scroll: HTMLElement | null = null;
  private _ro: ResizeObserver | null = null;
  private _packedW = 0;
  private _copy: HTMLButtonElement | null = null;
  private _copyTimer: ReturnType<typeof setTimeout> | null = null;
  private _tab: DetailTab = readTab();
  private _v: GroundGuideVerdict | null = null;
  private _legend: { state: LegendState; info: DetailLegendInfo } | null = null;
  private _keyP: HTMLElement | null = null;
  private _keyS: HTMLElement | null = null;
  private _pOn = false;
  private _sOn = false;

  constructor(private readonly _h: DetailHandlers) {}

  get isShown(): boolean {
    return !!this._el && this._el.classList.contains('ms-open');
  }

  get tab(): DetailTab {
    return this._tab;
  }

  /** Show the card for this verdict (rebuilds the active tab; the Legend tab waits for `setLegend`). */
  show(v: GroundGuideVerdict): void {
    this._v = v;
    const root = this._ensure();
    this._renderMeta(v);
    const first = !root.classList.contains('ms-open');
    root.classList.add('ms-open');
    if (first) this._renderTab(true);
    else if (this._tab !== 'L') this._renderTab(false);
  }

  /** Show the card with no verdict yet (D before a draw): the Legend tab works; the letters say what they wait for. */
  open(): void {
    const root = this._ensure();
    if (root.classList.contains('ms-open')) return;
    root.classList.add('ms-open');
    this._meta?.replaceChildren(el('span', undefined, 'No symbol being placed'));
    this._renderTab(true);
  }

  /** Switch tabs (the card is shown if it was hidden and there is something to show). */
  setTab(tab: DetailTab): void {
    const changed = tab !== this._tab;
    this._tab = tab;
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* storage blocked: the choice lasts for this page */
    }
    if (this._el) {
      for (const [k, b] of this._tabs) b.setAttribute('aria-selected', String(k === tab));
      if (this.isShown) this._renderTab(changed);
    }
    if (changed) this._h.tab?.(tab);
  }

  /** The legend as the docked card would draw it, plus the layers and data; redraws the Legend tab when it is up. */
  setLegend(state: LegendState, info: DetailLegendInfo): void {
    this._legend = { state, info };
    if (this.isShown && this._tab === 'L') this._renderTab(false);
  }

  /** Light the keys that work right now (the Legend tab's P and S rows). */
  setKeys(profile: boolean, snap: boolean): void {
    this._pOn = profile;
    this._sOn = snap;
    this._keyP?.classList.toggle('ms-on', profile);
    this._keyS?.classList.toggle('ms-on', snap);
    this._keyS?.classList.toggle('ms-lit', snap);
  }

  hide(): void {
    this._el?.classList.remove('ms-open');
    if (this._body) this._body.style.minHeight = '';
  }

  destroy(): void {
    this._ro?.disconnect();
    this._ro = null;
    if (this._copyTimer !== null) clearTimeout(this._copyTimer);
    this._copyTimer = null;
    this._el?.remove();
    this._el = this._meta = this._body = this._scroll = null;
    this._copy = null;
    this._tabs.clear();
    this._v = null;
    this._legend = null;
    this._keyP = this._keyS = null;
  }

  // ── building ──────────────────────────────────────────────────────────────

  private _ensure(): HTMLDivElement {
    if (this._el) return this._el;
    ensureBriefCss();
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = el('div', 'ms-ggd') as HTMLDivElement;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Ground Detail');
    // Clicks on the card must never reach a draw tool listening on the map.
    for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick']) root.addEventListener(t, (e) => e.stopPropagation());

    const head = el('div', 'ms-ggd-h');
    const tabs = el('div', 'ms-ggd-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const t of DETAIL_TABS) {
      const b = el('button', 'ms-ggd-tab', undefined) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === this._tab));
      b.title = `${TAB_LABEL[t]} (${TAB_KEY_OF[t]})`;
      b.style.setProperty('--lc', TAB_COLOR[t]);
      b.style.setProperty('--lf', TAB_FG[t]);
      b.append(el('span', 'ms-ggd-k', TAB_KEY_OF[t]), TAB_LABEL[t]);
      b.addEventListener('click', () => this.setTab(t));
      tabs.append(b);
      this._tabs.set(t, b);
    }
    const meta = el('div', 'ms-ggd-meta');
    const copy = el('button', 'ms-ggd-btn', 'Copy as Text') as HTMLButtonElement;
    copy.type = 'button';
    copy.title = 'Copy every section as plain text, for orders';
    copy.addEventListener('click', () => this._copyText());
    const close = el('button', 'ms-ggd-btn ms-x', '×') as HTMLButtonElement;
    close.type = 'button';
    close.title = 'Close (D or Esc)';
    close.setAttribute('aria-label', 'Close the Ground Detail');
    close.addEventListener('click', () => this._h.close());
    head.append(tabs, meta, copy, close);

    const scroll = el('div', 'ms-ggd-s');
    const body = el('div', 'ms-ggd-b');
    body.setAttribute('role', 'tabpanel');
    scroll.append(body);
    const foot = el('div', 'ms-ggd-f');
    const keys = el('span');
    for (const [k, t] of [['D', 'open / close'], ['G R O T B C', 'tabs'], ['K', 'legend'], ['Esc', 'close']] as const) {
      for (const kk of k.split(' ')) keys.append(el('span', 'ms-ggd-k', kk));
      keys.append(`${t} `);
    }
    foot.append(keys, el('span', undefined, 'Pictures are north up.'));
    root.append(head, scroll, foot);
    document.body.appendChild(root);
    this._el = root;
    this._meta = meta;
    this._body = body;
    this._scroll = scroll;
    this._copy = copy;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        if (body.clientWidth !== this._packedW) this._pack();
      });
      this._ro.observe(body);
    }
    return root;
  }

  private _renderMeta(v: GroundGuideVerdict): void {
    const meta = this._meta;
    if (!meta) return;
    meta.replaceChildren();
    const dot = el('span', 'ms-ggd-dot');
    dot.style.background = verdictColor(v);
    meta.append(dot, el('b', undefined, titleOf(v)), el('span', 'ms-ggd-sep', '·'), el('span', undefined, v.profileLabel));
    const g = v.going;
    if (g) {
      meta.append(el('span', 'ms-ggd-sep', '·'), seasonIcon(g.season, 12), el('span', undefined, g.season === 'dry' ? 'Dry Season' : 'After Rain'));
      if (g.month) meta.append(el('span', undefined, monthName(g.month)));
    }
    if (pendingOf(v)) meta.append(el('span', 'ms-ggd-upd', '· updating'));
  }

  /** Rebuild the active tab. `reset`: a new tab (or the first show), so the scroll and the height ratchet start afresh. */
  private _renderTab(reset: boolean): void {
    const body = this._body;
    if (!body) return;
    const tab = this._tab;
    const scroller = this._scroll ?? body;
    const keepScroll = reset ? 0 : scroller.scrollTop;
    if (reset) body.style.minHeight = '';
    body.style.setProperty('--pb-k', CAP_COLOR[tab]);
    body.setAttribute('aria-label', TAB_LABEL[tab]);
    let tiles: HTMLElement[] = [];
    try {
      tiles = tab === 'L' ? this._renderL() : this._renderLetter(tab);
    } catch (err) {
      tiles = [empty('This tab could not be drawn. The Engine Log has the error.')];
      console.error('[Ground Guide] detail tab', tab, err);
    }
    if (!tiles.length) tiles = [empty(this._v ? `Nothing to show for ${TAB_LABEL[tab]} here yet. Move the cursor over the map, or wait for the tiles.` : 'Move the cursor over the map while drawing.')];
    body.replaceChildren(...tiles);
    this._pack();
    scroller.scrollTop = keepScroll;
    // Ratchet: a tile that comes and goes with the cursor must not make the whole card change height. It holds the
    // grid (the content), not the scroller, so a header that wraps or a shorter window still shrinks the scroll box.
    const h = body.offsetHeight;
    if (h > (parseFloat(body.style.minHeight) || 0)) body.style.minHeight = `${h}px`;
  }

  /** Give every tile a row span of its own height (the grid rows are 1px), measured at content height first. */
  private _pack(): void {
    const body = this._body;
    if (!body) return;
    const kids = Array.from(body.children) as HTMLElement[];
    for (const k of kids) k.style.gridRowEnd = '';
    const heights = kids.map((k) => k.getBoundingClientRect().height);
    kids.forEach((k, i) => {
      k.style.gridRowEnd = `span ${Math.max(1, Math.ceil(heights[i]) + TILE_GAP)}`;
    });
    this._packedW = body.clientWidth;
  }

  private _renderLetter(tab: GrotbcLetter): HTMLElement[] {
    const v = this._v;
    if (!v || v.verdict === 'off' || v.verdict === 'exempt') return [];
    if (v.verdict === 'unknown') return [empty(v.waiting ? 'Loading the terrain tiles under the cursor.' : v.message)];
    switch (tab) {
      case 'G': return this._renderG(v);
      case 'R': return this._renderR(v);
      case 'O': return this._renderO(v);
      case 'T': return this._renderT(v);
      case 'B': return this._renderB(v);
      default: return this._renderC(v);
    }
  }

  // ── G ─────────────────────────────────────────────────────────────────────
  private _renderG(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const g = v.sections?.ground;
    if (g) {
      ensureSectionsCss();
      out.push(wide(groundRelief(g)));
      const rows = kv([...groundRows(g), ...groundMore(g, v)]);
      if (rows) out.push(tile('G', 'Terrain, Relief & Water', rows));
      out.push(groundChips(g));
    }
    const gi = v.going;
    if (gi?.soil) out.push(wide(tile('G', 'Soil', ...soilDetail(gi, 150))));
    const itg = itgSection(v);
    if (itg) out.push(itg);
    return out;
  }

  // ── R ─────────────────────────────────────────────────────────────────────
  private _renderR(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const r = v.sections?.roads;
    if (r) {
      ensureSectionsCss();
      out.push(roadsShield(r), roadsVerdict(r));
      const rows = kv([...roadsRows(r), ...roadsMore(r)]);
      const rt = railTransportLine(r);
      if (rt) rt.style.marginLeft = '0';
      if (rows || rt) out.push(tile('R', 'Route Here & Nearby', rows, rt));
      const d = r.density;
      if (d) {
        ensureRoadDensityCss();
        const note = el('div', 'ms-ggd-note', roadDensityNote(d));
        note.style.background = DENSITY_COLOURS[d.lead.key][0];
        note.style.color = DENSITY_COLOURS[d.lead.key][1];
        out.push(wide(tile('R', `Road Network Density · ${fmtRadius(d.radiusM)}`, densityGauge(d, 'both'), note)));
        out.push(tile('R', 'Ways Out', densityRose(d, 'both')));
        out.push(tile('R', 'Make-Up', densityMakeup(d, 'both'), soft('Routing network (OSM with NCGDB load classes): roads and tracks; town streets and footpaths are not counted.')));
      }
    }
    const road = v.traffic?.road;
    if (road) {
      ensureGoingCss();
      ensureTrafficCss();
      const rb = roadBlock(viewOf(v));
      if (rb) out.push(tile('R', `${road.caption} for ${v.profileLabel}`, rb));
    }
    return out;
  }

  // ── O ─────────────────────────────────────────────────────────────────────
  private _renderO(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const s = v.sections;
    const o = s?.obstacles;
    if (s && o) {
      ensureSectionsCss();
      out.push(obstaclesTiles(o));
      if (hasGap(o)) out.push(wide(obstaclesGap(o)));
      const rows = kv([...obstaclesRows(o, s), ...obstaclesMore(o, s)]);
      if (rows) out.push(tile('O', 'Obstacles Near', rows));
    }
    const g = v.going;
    if (g?.movement) {
      ensureGoingCss();
      const es = exitStripSection(g);
      if (es) out.push(es);
    }
    return out;
  }

  // ── T ─────────────────────────────────────────────────────────────────────
  private _renderT(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const g = v.going;
    if (g) {
      ensureGoingCss();
      ensureTrafficCss();
      const tv = viewOf(v);
      out.push(blockGauge(v, tv));
      if (g.point) out.push(tile('T', 'Cross-Country Going', ...crossCountryDetail(g, false)));
      out.push(blockTiles(v, tv));
      const mv = movementDetail(g, 140);
      if (mv) out.push(wide(tile('T', `Movement Freedom · ${g.season === 'dry' ? 'Dry' : 'After Rain'}`, mv, roseLegend(true), g.pending ? soft('Still loading round the edges') : null)));
      const cv = goingCanvas(g, 140, 0, true);
      if (cv && g.map) {
        const box = el('div', 'ms-gv-map');
        box.append(cv, mapShares(g) ?? el('span'));
        out.push(tile('T', `Going Map · ${fmtDistance(g.map.rangeM)}`, box, soft('Green GO, orange SLOW-GO, red NO-GO; the dashed ring is half the range.')));
      }
      if (tv.road?.main) out.push(blockWayOut(v, tv));
      const rb = ribbon(g, 54);
      if (rb) out.push(wide(tile('T', `Going by Month · ${tv.short}`, rb)));
    }
    const sp = v.speed;
    if (sp) {
      ensureGoingCss();
      ensureSpeedCss();
      const day = speedDayText(sp);
      const here = speedGroundText(sp);
      out.push(tile('T', speedCaption(sp), speedHeadline(sp), speedGrid(sp), day ? soft(`A day's march: ${day}`) : null, here ? soft(`Here: ${here}`) : null, soft(sp.basis)));
      if (sp.rays) {
        const row = el('div', 'ms-ggs-rose');
        row.append(speedRoseSvg(sp.rays, sp.rangeM, 124, 0), speedRoseLines(sp));
        out.push(tile('T', `Time to ${fmtDistance(sp.rangeM)} · ${sp.short}`, row));
      }
      const way = speedWay(sp);
      if (way) out.push(tile('T', `${speedCaption(sp)} · To the Road`, ...way));
      out.push(tile('T', 'Who Moves How Fast', speedModeTiles(sp), soft(`km/h cross-country · ${speedWhen(sp)}`)));
    }
    const w = v.sections?.weather;
    if (w) {
      ensureSectionsCss();
      out.push(wide(weatherYear(w)), weatherIcons(w));
    }
    return out;
  }

  // ── B ─────────────────────────────────────────────────────────────────────
  private _renderB(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const p = v.population;
    const r = p?.reading;
    if (p || v.sections?.buildings) ensurePopulationCss();
    const strip = populationFlagStrip(p);
    if (strip) out.push(wide(strip, 'all'));
    if (r) {
      const two = el('div', 'ms-ggp-two');
      two.append(radar(r, 110), ringList(r, [1, 2, 3, 5, 10]));
      out.push(tile('B', `People · ${r.radiusKm} km`, two, densityScale(r.cls), populationLine('Density', populationChip(r.cls), ` ${fmtPeople(r.perKm2)} per km² within ${r.radiusKm} km`)));
      if (r.ages && r.people > 0) {
        const a = el('div');
        a.append(...ageBar(r.people, r.ages));
        out.push(tile('B', 'Ages', a, populationLine('Males 15–49', `${fmtPeople(r.ages.males15_49)} within ${r.radiusKm} km`)));
      }
      out.push(tile('B', 'People by Direction', populationRose(r)));
      out.push(tile('B', 'People Map · 1 km Cells', populationMinimap(r)));
      out.push(tile('B', 'Out from Here', ...populationProfile(r)));
      out.push(tile('B', 'Places', populationPlaces(r, 8), nearestLine(r)));
      if (r.province) out.push(tile('B', 'Against the Province', ...populationCompare(r)));
      out.push(tile('B', 'Source', soft(populationSourceLine(r))));
    }
    const b = v.sections?.buildings;
    if (b) {
      ensureSectionsCss();
      out.push(buildingsWhere(b));
      const rows = kv([...buildingsRows(b), ...buildingsMore(b, v)]);
      if (rows) out.push(tile('B', 'Buildings, Huts & Services', rows));
      out.push(buildingsProtected(b));
    }
    return out;
  }

  // ── C ─────────────────────────────────────────────────────────────────────
  private _renderC(v: GroundGuideVerdict): HTMLElement[] {
    const c = v.cover;
    if (!c) return [];
    ensureCoverCss();
    const out: HTMLElement[] = [];
    out.push(wide(tile('C', 'Cover, Camouflage & Concealment', ...fourLines(c), needLine(c, v.profileLabel), bankLine(c), localLine(c), aroundLine(c))));
    out.push(tile('C', 'At a Glance', coverIconsRow(c), c.classLabel ? soft(`Ground: ${c.classLabel}`) : null));
    out.push(tile('C', 'Four Ways', coverGridTiles(c), coverGivesLine(c)));
    const box = el('div', 'ms-gc-rose');
    box.append(coverRose(c, 112, 0), roseText(c));
    out.push(tile('C', `Cover Round It · ${COVER_FIELD_LABEL[c.roseField]}`, box, coverRoseKey()));
    out.push(tile('C', `Nearest Cover · ${fmtDistance(c.radiusM)}`, nearestGrid(c)));
    out.push(
      tile(
        'C',
        'Also Mapped',
        shelterLine(c, true),
        formLine(c),
        builtLine(c),
        soft('Levels: this spot, from rules.json grotbc.coverSplit and banks (a starting proposal). The area round it (cc layer) never raises them. Check on the ground.'),
      ),
    );
    return out;
  }

  // ── L ─────────────────────────────────────────────────────────────────────
  /** The Legend tab: the mode as pills, the overlay key with its season and day / night switches, the map layer switches, the ground lists, the keys. */
  private _renderL(): HTMLElement[] {
    const L = this._legend;
    if (!L) return [empty('The legend appears once the terrain data has loaded.')];
    ensureLegendStyle();
    const st = L.state;
    const p = buildLegend(st, this._h.legend);
    this._keyP = p.keyP;
    this._keyS = p.keyS;
    this.setKeys(this._pOn, this._sOn);
    const out: HTMLElement[] = [];

    // Mode: one pill a mode, the current one lit; a click judges (or paints) for that mode.
    const modes = el('div', 'ms-ggd-modes');
    const cur = st.modes.find((m) => m.key === st.current) ?? { key: st.current, label: st.current };
    for (const m of st.modes) {
      const b = el('button', 'ms-ggd-mode') as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('aria-pressed', String(m.key === st.current));
      b.title = m.key === st.current ? `${m.label} (judged for now)` : `Judge for ${m.label}`;
      b.append(modeIcon(m.key), el('span', undefined, m.label));
      b.addEventListener('click', () => this._h.legend.pick(m.key));
      modes.append(b);
    }
    const tag = el('div', 'ms-ggd-modetag');
    tag.append(el('b', undefined, cur.label));
    if (st.tag) tag.append(' · ', el('span', st.hand ? 'ms-hand' : undefined, st.tag));
    out.push(wide(tile('L', `Mode · ${st.modes.length} to choose from`, modes, tag), 'all'));

    // Overlay key: the ramp and what the colours mean, with the season and day / night switches.
    out.push(tile('L', 'Overlay Key', p.ramp, p.labels, p.note, ...p.traffic, ...p.speed));

    // Map layers: switches, with the overlay's opacity while it is on.
    const sws = el('div', 'ms-ggd-sws');
    for (const t of L.info.toggles) {
      const row = el('label', 'ms-ggd-swrow');
      const inp = el('input', 'ms-ggd-swin') as HTMLInputElement;
      inp.type = 'checkbox';
      inp.checked = t.on;
      inp.addEventListener('change', () => this._h.toggle(t.key, inp.checked));
      const text = el('span');
      text.append(el('b', undefined, t.label));
      if (t.note) text.append(el('small', undefined, t.note));
      row.append(inp, el('span', 'ms-ggd-sw'), text);
      sws.append(row);
      if (t.key === 'overlay' && t.on) {
        const r = el('div', 'ms-ggd-range');
        const range = el('input') as HTMLInputElement;
        range.type = 'range';
        range.min = '0.1';
        range.max = '1';
        range.step = '0.05';
        range.value = String(L.info.overlayOpacity);
        range.setAttribute('aria-label', 'Overlay opacity');
        const val = el('b', undefined, `${Math.round(L.info.overlayOpacity * 100)}%`);
        range.addEventListener('input', () => (val.textContent = `${Math.round(Number(range.value) * 100)}%`));
        range.addEventListener('change', () => this._h.opacity(Number(range.value)));
        r.append(el('span', undefined, 'Opacity'), range, val);
        sws.append(r);
      }
    }
    out.push(tile('L', 'Map Layers', sws));

    // What the mode cannot use and what slows it.
    if (p.list) out.push(wide(tile('L', `Ground for ${cur.label}`, p.list)));

    // Keys.
    const keys = legendEl('ms-ggl-keys');
    if (p.keyP) keys.append(p.keyP);
    if (p.keyS) keys.append(p.keyS);
    keys.append(
      legendKeyRow('D', 'Ground Detail', 'Opens and Closes This Card'),
      legendKeyRow('G', 'Tabs', 'G R O T B C, One Letter a Tab'),
      legendKeyRow('K', 'Legend', 'This Tab (L Is Lasso Select)'),
      legendKeyRow('Esc', 'Close', 'Also Cancels the Draw'),
    );
    out.push(tile('L', 'Keys', keys));
    return out;
  }

  private _copyText(): void {
    const v = this._v;
    const btn = this._copy;
    if (!v || !btn) return;
    const text = briefText(v);
    const done = (ok: boolean) => {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      if (this._copyTimer !== null) clearTimeout(this._copyTimer);
      this._copyTimer = setTimeout(() => {
        btn.textContent = 'Copy as Text';
        this._copyTimer = null;
      }, 1800);
    };
    try {
      void navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } catch {
      done(false);
    }
  }
}
