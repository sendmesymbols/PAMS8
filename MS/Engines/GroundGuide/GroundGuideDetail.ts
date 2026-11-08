/**
 * GroundGuideDetail.ts
 *
 * The Ground Detail (D while drawing): a wide card docked at the foot of the map with a tab a GROTBC letter
 * (G Ground, R Roads & Rail, O Obstacles, T Trafficability, B Built-Up, C Cover) and the Legend (key K; L is Lasso Select), where the
 * docked legend and the layers and data behind the advice live while the card is open. It took the place of the
 * vertical Ground Brief on 2026-11-06, so that everything the engine reads is in view at once instead of a column
 * to scroll; the cursor card keeps the verdict, Why, Inside, Nearest and the Inter Gap Rule.
 *
 * The card never scrolls (user, 2026-11-07: the tabs are switched by key while the mouse is busy placing the symbol,
 * so there is no hand free to scroll). It reads in two parts:
 *   1. the answer strip (GroundGuideDetailSummary): first who the ground is judged for (the mode, how it was set,
 *      the season and light, and a warning when the map overlay paints another mode), then the letter's answer and
 *      its key facts;
 *   2. the band: a fixed height under it where the tab's pictures (dials, roses, the going map, gauges, bars), then
 *      its lists and notes, run down newspaper columns. Pictures never break across a column; a list may, row by row.
 *      What does not fit on the card's width goes to a next page, turned with the same letter key (T, then T again),
 *      which closes the card from the last page; the footer says when there is more.
 * A tile that only repeated the answer strip (the ground chips, the route check box, the obstacle tiles, the
 * cross-country scales, the civil flag strip, the cover icons) was left out of its tab on 2026-11-07; Copy as Text
 * still gives every section. A tile's own letter badge is dropped when it is the tab's letter (W weather in T, the
 * T exits in O keep theirs).
 *
 * Everything turns with the map (GroundGuideNorth: dials, the going map and an arrow after every compass point
 * follow the 2D rotation or 3D heading). Only the active tab is built on each verdict, and the Legend tab only when
 * the legend changes; a rebuild keeps the page shown. The band's height is fixed, so the card does not change size
 * under the eye as the cursor moves. A letter key switches tabs (and opens the card when it is closed); D or Esc
 * closes it. Esc still reaches the draw tool.
 *
 * DOM nodes and textContent only (names and labels never become markup). The card stops pointer events reaching
 * the map, as the legend does.
 */

import { itgSection } from './GroundGuideBadge';
import { briefText, ensureBriefCss, monthName, movementDetail, soilDetail, type GrotbcLetter } from './GroundGuideBrief';
import { COVER_FIELD_LABEL } from './GroundGuideCover';
import {
  aroundLine,
  bankLine,
  builtLine,
  coverGivesLine,
  coverGridTiles,
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
import { detailSummary, letterAnswer } from './GroundGuideDetailSummary';
import { ensureTokensCss } from './GroundGuideTokens';
import { fmtDistance, titleCase } from './GroundGuideEvaluator';
import { ensureGoingCss, exitStripSection, goingCanvas, mapShares, orientRoses, ribbon, roseFigure, roseLegend, seasonIcon } from './GroundGuideGoingView';
import { arrowCompass, ensureNorthCss, setNorthVar } from './GroundGuideNorth';
import { buildLegend, ensureLegendStyle, legendEl, legendKeyRow, modeIcon, type LegendHandlers, type LegendState } from './GroundGuideLegend';
import {
  ageBar,
  densityScale,
  ensurePopulationCss,
  fmtPeople,
  nearestLine,
  populationChip,
  populationCompare,
  populationLine,
  populationMinimap,
  populationPlaces,
  populationProfile,
  populationRose,
  populationSourceLine,
  radar,
  radarKey,
  ringList,
} from './GroundGuidePopulationView';
import { fmtRadius, roadDensityNote } from './GroundGuideRoadDensity';
import { DENSITY_COLOURS, densityGauge, densityMakeup, densityRose, ensureRoadDensityCss } from './GroundGuideRoadDensityView';
import type { ObstaclesReading } from './GroundGuideSections';
import { buildingsProtected, buildingsWhere, groundRelief, obstaclesDial, obstaclesGap, obstaclesNear, roadsShield, weatherIcons, weatherYear } from './GroundGuideSectionsStyles';
import {
  buildingsMore,
  buildingsRows,
  ensureSectionsCss,
  groundMore,
  groundRows,
  kv,
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
  speedRoseKey,
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
  /** The card's height changed (the grip, or the window): the cursor card re-checks where it may go. */
  resized?(): void;
}

const STYLE_ID = 'ms-ground-guide-detail-style';
const TAB_KEY = 'ms-ground-guide-detail-tab';
const TAB_LABEL: Record<DetailTab, string> = { G: 'Gr', R: 'Rds & Rail', O: 'Obs', T: 'Trafficability', B: 'BUAs', C: 'Cover', L: 'Legend' };
/** The key that opens each tab: the letter itself, except the Legend (K: L is Lasso Select in the app). */
export const TAB_KEY_OF: Record<DetailTab, string> = { G: 'G', R: 'R', O: 'O', T: 'T', B: 'B', C: 'C', L: 'K' };
/** Where the Detail's height is remembered (item 14), and the three stops it snaps to, as a share of the window. */
const HEIGHT_KEY = 'ms-ground-guide-detail-height';
const HEIGHT_STOPS = [0.4, 0.5, 0.6] as const;
const HEIGHT_DEFAULT = 0.5;
/** The shortest the card gets, px: header, force line, strip and footer (about 220) plus a band of 260. */
const MIN_CARD_PX = 480;
/** Added to every stop, px, so the band's last line (a gauge's caption, a list's last row) is not cut at the bottom. */
const EXTRA_PX = 40;
/** Space between the band's columns, and the narrowest and widest a column may be, px. */
const COL_GAP = 28;
const COL_MIN = 262;
const COL_MAX = 560;
/** The smallest a picture's own label (a compass letter, a triangle corner, a cross-section note) is drawn, px on screen. */
const SVG_MIN_TEXT = 10.5;
/**
 * The pictures' own labels at least SVG_MIN_TEXT on screen: each SVG text is sized in its picture's units, so it is
 * raised by the picture's scale. Run after the layout (a picture that fills its column scales with it); a size set
 * before is cleared first, so a wider column can bring a label back down.
 */
function raiseSvgText(root: ParentNode): void {
  for (const tx of Array.from(root.querySelectorAll<SVGTextElement>('svg text'))) {
    const svg = tx.ownerSVGElement;
    if (!svg || !tx.textContent?.trim()) continue;
    tx.style.fontSize = '';
    const w = svg.clientWidth || svg.getBoundingClientRect().width;
    if (!w) continue;
    const vb = svg.viewBox?.baseVal;
    const scale = vb && vb.width ? w / vb.width : 1;
    const fs = parseFloat(getComputedStyle(tx).fontSize);
    if (!fs || fs * scale >= SVG_MIN_TEXT) continue;
    tx.style.fontSize = `${(SVG_MIN_TEXT / scale).toFixed(2)}px`;
  }
}

/**
 * Split heights `h` (in order) into `n` non-empty columns so the tallest column is as short as it can be; `gap`
 * between two tiles in a column. Returns the index each column starts at, and that tallest height.
 */
function balanceColumns(h: number[], n: number, gap: number): { starts: number[]; max: number } {
  const k = h.length;
  const pre = [0];
  for (const x of h) pre.push(pre[pre.length - 1] + x);
  const colH = (a: number, b: number) => pre[b] - pre[a] + gap * (b - a - 1);
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0));
  for (let i = 1; i <= k; i++) best[1][i] = colH(0, i);
  for (let j = 2; j <= n; j++) {
    for (let i = j; i <= k; i++) {
      for (let s = j - 1; s < i; s++) {
        const m = Math.max(best[j - 1][s], colH(s, i));
        if (m < best[j][i]) {
          best[j][i] = m;
          cut[j][i] = s;
        }
      }
    }
  }
  const starts: number[] = [];
  let i = k;
  for (let j = n; j >= 1; j--) {
    const s = j === 1 ? 0 : cut[j][i];
    starts.unshift(s);
    i = s;
  }
  return { starts, max: best[n][k] };
}
/** Space between two tiles in a column, px. */
const ITEM_GAP = 16;

const CSS = `
.ms-ggd{position:fixed;left:10px;right:10px;bottom:10px;z-index:2147482800;height:calc(50vh + 40px);min-height:300px;
  display:none;flex-direction:column;box-sizing:border-box;border-radius:12px;background:#1b1f25;border:1px solid #5a6470;box-shadow:0 10px 30px rgba(0,0,0,.5);
  font:400 13.5px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;--pb-k:#c3cbd3}
.ms-ggd.ms-open{display:flex}
/* Drag to size (item 14): a grip on the top edge, three stops, remembered. */
.ms-ggd-grip{position:absolute;left:50%;top:-1px;transform:translateX(-50%);width:120px;height:14px;padding:0;border:0;background:none;cursor:ns-resize;touch-action:none;z-index:1}
.ms-ggd-grip::before{content:"";position:absolute;left:38px;right:38px;top:5px;height:4px;border-radius:2px;background:#8a96a3}
.ms-ggd-grip:hover::before,.ms-ggd-grip.ms-drag::before{background:#c9d1d9}
.ms-ggd-grip:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px;border-radius:4px}
.ms-ggd-stop{position:absolute;left:50%;transform:translate(-50%,-140%);padding:2px 8px;border-radius:999px;background:#2b313a;border:1px solid #545e6b;font-size:12px;color:#e8ebee;pointer-events:none;white-space:nowrap}
.ms-ggd-h{flex:none;display:flex;align-items:center;gap:6px 10px;padding:8px 10px 7px;background:#262d36;border-radius:11px 11px 0 0;flex-wrap:wrap}
.ms-ggd-tabs{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
/* GROTBC answer row (item 8): each tab its letter, a short name and its own answer as a dot and a word; tabs are neutral, the open one light. */
.ms-ggd-tab{display:inline-flex;align-items:center;gap:7px;padding:5px 10px 5px 6px;border-radius:8px;border:1px solid transparent;background:transparent;color:#d5dbe1;
  font:600 13.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer;text-align:left;max-width:200px}
.ms-ggd-tab:hover{background:rgba(255,255,255,.08);color:#fff}
.ms-ggd-tab:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-tab[aria-selected="true"]{background:#e4e8ec;border-color:#e4e8ec;color:#14181d}
.ms-ggd-tab[aria-selected="true"] .ms-ggd-k{background:#fff;border-color:#9aa5b1;color:#14181d}
.ms-ggd-tt{display:flex;flex-direction:column;min-width:0}
.ms-ggd-tl{white-space:nowrap}
.ms-ggd-ta{display:flex;align-items:center;gap:5px;min-width:0;font-size:12px;font-weight:600;color:#c3cbd3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggd-ta>span:last-child{overflow:hidden;text-overflow:ellipsis}
.ms-ggd-tab[aria-selected="true"] .ms-ggd-ta{color:#3d4650}
.ms-ggd-ta .ms-ggd-fd{margin:0}
.ms-ggd-ring{flex:none;width:9px;height:9px;box-sizing:border-box;border-radius:50%;border:2px solid #ffd27a}
.ms-ggd-tab[aria-selected="true"] .ms-ggd-ring{border-color:#9a6a00}
.ms-ggd-k{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:4px;
  font:750 12px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
.ms-ggd-hsp{flex:1}
.ms-ggd-btn{font:400 13.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:30px;padding:0 10px;white-space:nowrap}
.ms-ggd-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.ms-ggd-btn:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-btn.ms-x{width:30px;padding:0;font-size:18px}
/* Who the ground is judged for: its own line under the tabs, on every tab (item 9). */
.ms-ggd-mode{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:3px 14px;padding:6px 16px;background:#20262e;border-top:1px solid rgba(255,255,255,.1);font-size:13.5px;color:#c3cbd3}
.ms-ggd-mode[hidden]{display:none}
.ms-ggd-mode>span{display:inline-flex;align-items:center;gap:6px;min-width:0}
.ms-ggd-mode svg{flex:none;color:#8ec1ea}
.ms-ggd-mode b{color:#fff;font-weight:600}
.ms-ggd-mode .ms-hand{color:#ffd27a;font-weight:600}
.ms-ggd-mode .ms-when{margin-left:auto}
.ms-ggd-mode .ms-upd{color:#ffd27a;font-weight:600}
.ms-ggd-mode .ms-other{color:#ffd27a}
/* 1. The answer strip: the letter's answer, then its facts on one line. */
.ms-ggd-sum{flex:none;box-sizing:border-box;display:flex;align-items:stretch;padding:10px 16px 11px;background:#20262e;border-top:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.14)}
.ms-ggd-sum[hidden]{display:none}
.ms-ggd-sum-row{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-content:center;align-items:stretch;row-gap:10px}
.ms-ggd-ans{flex:1.6 1 300px;min-width:0;max-width:460px;margin-right:12px;padding:8px 14px 9px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.18)}
.ms-ggd-ans[data-tone="go"],.ms-ggd-ans[data-tone="c3"]{background:rgba(47,168,98,.12);border-color:rgba(47,168,98,.5)}
.ms-ggd-ans[data-tone="marg"],.ms-ggd-ans[data-tone="c2"]{background:rgba(241,214,70,.1);border-color:rgba(241,214,70,.5)}
.ms-ggd-ans[data-tone="slow"],.ms-ggd-ans[data-tone="c1"]{background:rgba(238,138,31,.12);border-color:rgba(238,138,31,.55)}
.ms-ggd-ans[data-tone="nogo"]{background:rgba(229,72,77,.12);border-color:rgba(229,72,77,.55)}
.ms-ggd-ans[data-tone="warn"]{background:rgba(255,210,122,.1);border-color:rgba(255,210,122,.5)}
.ms-ggd-ans[data-tone="c0"]{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.22)}
.ms-ggd-ans-l{font-size:12px;line-height:1.3;color:#c3cbd3}
.ms-ggd-ans-v{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 9px;margin-top:1px;font-size:22px;font-weight:750;line-height:1.2;color:#fff}
.ms-ggd-ans-v>small{font-size:13.5px;font-weight:600;color:#c3cbd3}
.ms-ggd-ans-s{margin-top:2px;font-size:12px;line-height:1.35;color:#c3cbd3;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
[data-tone="go"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="go"],[data-tone="c3"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="c3"]{color:#74dca3}
[data-tone="slow"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="slow"],[data-tone="c1"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="c1"]{color:#ffb46b}
[data-tone="nogo"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="nogo"]{color:#ff8a8d}
[data-tone="marg"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="marg"],[data-tone="c2"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="c2"]{color:#f1d646}
[data-tone="warn"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="warn"]{color:#ffd27a}
[data-tone="c0"].ms-ggd-fv,.ms-ggd-ans-v>[data-tone="c0"]{color:#c3cbd3}
.ms-ggd-fact{flex:1 1 130px;min-width:0;max-width:290px;padding:0 14px;border-left:1px solid rgba(255,255,255,.14)}
.ms-ggd-ans+.ms-ggd-fact{border-left:0;padding-left:0}
.ms-ggd-fact:first-child{padding-left:0;border-left:0}
.ms-ggd-fk{font-size:12px;line-height:1.3;color:#c3cbd3;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ms-ggd-fv{margin-top:2px;font:750 15.5px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#f4f6f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggd-fd{display:inline-block;flex:none;width:10px;height:10px;margin-right:7px;border-radius:50%;vertical-align:1px}
.ms-ggd-fd[data-tone="go"],.ms-ggd-fd[data-tone="c3"]{background:#2fa862}
.ms-ggd-fd[data-tone="slow"],.ms-ggd-fd[data-tone="c1"]{background:#ee8a1f}
.ms-ggd-fd[data-tone="nogo"]{background:#e5484d}
.ms-ggd-fd[data-tone="marg"]{background:#f1d646}
.ms-ggd-fd[data-tone="c2"]{background:#d9c23e}
.ms-ggd-fd[data-tone="c0"]{background:#5b6470;box-shadow:inset 0 0 0 1.5px #9aa3ad}
.ms-ggd-fd[data-tone="warn"]{background:#f2b84b}
/* Sub-lines take two lines before anything is cut (item 5); the whole line is on hover and in Copy as Text. */
.ms-ggd-fs{margin-top:1px;font-size:12px;line-height:1.35;color:#c3cbd3;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
/* 2. The band: fills the rest of the card's height, newspaper columns, pages instead of a scroll bar. */
.ms-ggd-band{flex:1 1 auto;min-height:120px;position:relative;box-sizing:border-box;padding:12px 16px 10px}
.ms-ggd-clip{height:100%;overflow:hidden}
/* The tiles are placed by _layout (absolute, first fit down the columns), so a short tile fills the space under a
   tall one rather than leaving it empty; pages sit side by side and the flow slides to the one shown. */
.ms-ggd-flow{position:relative;height:100%}
@media (prefers-reduced-motion:no-preference){.ms-ggd-flow{transition:transform .22s cubic-bezier(.25,1,.5,1)}}
.ms-ggd .ms-ggd-flow>.ms-ggb-sec{position:absolute;box-sizing:border-box;margin:0;padding:0;background:none;border:0;border-radius:0;min-width:0;overflow:hidden;font-size:13.5px}
.ms-ggd .ms-ggd-flow>.ms-ggb-sec>.ms-ggb-cap{display:flex;align-items:center;gap:7px;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.14);
  font:600 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0;text-transform:none;color:#e4e8ec}
.ms-ggd-rule{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.1)}
.ms-ggd-cont{font-weight:400;color:#c3cbd3}
.ms-ggd .ms-ggd-flow .ms-gs-kv{display:block}
/* Label / value rows: a hairline and air between rows, so a value that wraps to three lines still reads as one row
   (user, 2026-11-08: "long text with headers not properly separated"). */
.ms-ggd-pair{display:grid;grid-template-columns:84px minmax(0,1fr);column-gap:12px;padding:6px 0}
.ms-ggd-pair:first-child{padding-top:1px}
.ms-ggd-pair+.ms-ggd-pair{border-top:1px solid rgba(255,255,255,.1)}
.ms-ggd .ms-gs-kv>.ms-ggd-pair>.ms-gs-k{padding-top:1px;line-height:1.35}
/* A rose, dial or round map keeps its words beside it in a column: the tile stays short enough to share a column. */
.ms-ggd .ms-gv-rose>div,.ms-ggd .ms-ggs-rose>div,.ms-ggd .ms-gc-rose>div,.ms-ggd .ms-gv-map>div{flex:1 1 128px;min-width:0}
.ms-ggd-l{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:4px;font:750 12px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0;background:#aab3bd;color:#14181d}
.ms-ggd-empty{color:#c3cbd3;padding:20px 12px;text-align:center;font-size:13.5px;column-span:all}
.ms-ggd-soft{color:#b8c1ca;font-size:12px;margin-top:6px}
.ms-ggd-soft b{color:#e8ebee;font-weight:600}
.ms-ggd-note{margin-top:7px;border-radius:5px;padding:5px 8px;font-size:12px}
/* Text a step larger than on the cursor card: the Detail is read at arm's length, often in daylight. */
.ms-ggd .ms-gs-kv,.ms-ggd .ms-ggbr-ln,.ms-ggd .ms-gc-row,.ms-ggd .ms-gc-near,.ms-ggd .ms-ggp-list,.ms-ggd .ms-ggp-ln,.ms-ggd .ms-ggp-places,.ms-ggd .ms-ggd-kv,.ms-ggd .ms-gx-where,.ms-ggd .ms-gx-list,.ms-ggd .ms-ggs-kv,.ms-ggd .ms-ggb-tkv,.ms-ggd .ms-gs-one{font-size:13.5px}
.ms-ggd .ms-gs-kv{line-height:1.4}
.ms-ggd .ms-ggp-ln{grid-template-columns:minmax(58px,max-content) minmax(0,1fr)}
.ms-ggd .ms-ggp-ln>.ms-ggp-k{white-space:nowrap}
.ms-ggd .ms-gs-kv .ms-gs-k,.ms-ggd .ms-ggd-kv>.k,.ms-ggd .ms-ggp-k,.ms-ggd .ms-ggbr-ln>span:first-child{font-size:12px;color:#c3cbd3}
.ms-ggd .ms-ggb-big,.ms-ggd .ms-ggp-big,.ms-ggd .ms-ggs-big,.ms-ggd .ms-ggb-tbig{font-size:22px}
.ms-ggd .ms-gv-rate{font-size:18px}
.ms-ggd .ms-ggb-sec .ms-gv-rose,.ms-ggd .ms-ggb-sec .ms-gv-map,.ms-ggd .ms-ggb-sec .ms-gc-rose,.ms-ggd .ms-ggb-sec .ms-ggs-rose{flex-wrap:wrap}
.ms-ggd-f{flex:none;padding:6px 14px 7px;font-size:12px;color:#c3cbd3;border-top:1px solid rgba(255,255,255,.1);display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center}
.ms-ggd-f .ms-ggd-k{margin-right:4px}
.ms-ggd-f>span{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 0}
.ms-ggd-page{margin-left:auto;display:inline-flex;align-items:center;gap:8px;color:#e1e6eb}
.ms-ggd-page[hidden]{display:none}
.ms-ggd-page b{color:#ffd27a;font-weight:600}
.ms-ggd-dots{display:inline-flex;gap:4px}
.ms-ggd-dots>i{width:7px;height:7px;border-radius:50%;background:#4a535e}
.ms-ggd-dots>i.ms-on{background:#ffd27a}
.ms-ggd-band.ms-more::after{content:"";position:absolute;top:12px;right:0;bottom:10px;width:42px;pointer-events:none;background:linear-gradient(90deg,rgba(27,31,37,0),#1b1f25 85%)}
/* The Legend tab. */
.ms-ggd .ms-ggl-strip{margin-top:0}
.ms-ggd .ms-ggl-list{margin-top:0;padding-top:0;border-top:0;max-height:none}
.ms-ggd .ms-ggl-keys{margin-top:0;padding-top:0;border-top:0;flex-direction:column;gap:6px}
.ms-ggd .ms-ggl-tcap:first-child{margin-top:0}
.ms-ggd-kv{display:grid;grid-template-columns:62px minmax(0,1fr);gap:3px 8px;font-size:12px;line-height:1.35}
.ms-ggd-kv>.k{color:#c3cbd3;font-size:12px;padding-top:1px}
.ms-ggd-kv>.v{min-width:0;color:#e8ebee;overflow-wrap:anywhere}
.ms-ggd-kv b{color:#fff;font-weight:600}
.ms-ggd-modes{display:flex;flex-wrap:wrap;gap:6px}
.ms-ggd-mode-b{display:inline-flex;align-items:center;gap:7px;padding:6px 11px 6px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#e1e6eb;
  font:600 12px/1 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer;white-space:nowrap}
.ms-ggd-mode-b:hover{background:rgba(255,255,255,.12);color:#fff}
.ms-ggd-mode-b:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-mode-b[aria-pressed="true"]{background:#8ec1ea;border-color:#8ec1ea;color:#14181d}
.ms-ggd-mode-b svg{flex:none;width:16px;height:16px}
.ms-ggd-modetag{margin-top:9px;font-size:13.5px;color:#c3cbd3}
.ms-ggd-modetag b{color:#fff;font-size:13.5px}
.ms-ggd-modetag .ms-hand{color:#ffd27a}
.ms-ggd-sws{display:flex;flex-direction:column}
.ms-ggd-swrow{position:relative;display:flex;align-items:center;gap:11px;padding:7px 0;cursor:pointer;border-top:1px solid rgba(255,255,255,.1)}
.ms-ggd-swrow:first-child{border-top:0;padding-top:2px}
.ms-ggd-swin{position:absolute;opacity:0;width:0;height:0;margin:0}
.ms-ggd-sw{flex:none;width:36px;height:20px;border-radius:999px;background:#3a424d;position:relative;border:1px solid rgba(255,255,255,.14)}
.ms-ggd-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff}
.ms-ggd-swin:checked+.ms-ggd-sw{background:#2fa862;border-color:#2fa862}
.ms-ggd-swin:checked+.ms-ggd-sw::after{transform:translateX(16px)}
.ms-ggd-swin:focus-visible+.ms-ggd-sw{outline:2px solid #8ec1ea;outline-offset:2px}
.ms-ggd-swrow>span:last-child{min-width:0}
.ms-ggd-swrow b{display:block;color:#fff;font-weight:600;font-size:13.5px}
.ms-ggd-swrow small{display:block;color:#c3cbd3;font-size:12px;line-height:1.35}
.ms-ggd-range{display:flex;align-items:center;gap:8px;padding:0 0 8px 47px;font-size:12px;color:#c3cbd3}
.ms-ggd-range input{flex:1;min-width:0;accent-color:#8ec1ea;margin:0}
.ms-ggd-range b{color:#fff;font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
.ms-ggd .ms-ggl-ramp>i{height:14px}
.ms-ggd .ms-ggl-note{margin-top:5px}
@media (prefers-reduced-motion:no-preference){.ms-ggd-sw,.ms-ggd-sw::after{transition:background .15s,transform .15s}.ms-ggd-tab{transition:background .12s,color .12s}}
/* A narrow window: answers stay, names shorten (the tab keeps its letter, name and answer on two lines). */
@media (max-width:1160px){.ms-ggd-tab{max-width:150px;padding-right:8px}}
@media (max-width:720px){.ms-ggd{left:6px;right:6px;bottom:6px}
  .ms-ggd-sum{padding:10px 12px}.ms-ggd-ans{flex-basis:100%;max-width:none;margin-right:0}
  .ms-ggd-fact{flex-basis:120px;padding:0 10px}.ms-ggd-ans+.ms-ggd-fact{padding-left:0}}
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
  cap.append(el('span', 'ms-ggd-l', letter), caption); // neutral: a letter is not a verdict (item 16)
  sec.append(cap);
  for (const c of content) if (c) sec.append(c);
  return sec;
}

function empty(text: string): HTMLElement {
  return el('div', 'ms-ggd-empty', text);
}

/**
 * A label / value list made to break across the band's columns row by row: each label and its value in one block
 * (the list keeps its own look), and the tile marked as one that may continue at the top of the next column.
 */
function listTile(letter: DetailTab, caption: string, list: HTMLElement, ...more: Array<Node | null | undefined | false>): HTMLElement {
  const kids = Array.from(list.children);
  for (let i = 0; i + 1 < kids.length; i += 2) {
    const p = el('div', 'ms-ggd-pair');
    p.append(kids[i], kids[i + 1]);
    list.append(p);
  }
  const t = tile(letter, caption, list, ...more);
  t.classList.add('ms-ggd-brk');
  return t;
}

/** A canal with a recorded width or depth, or a river reach with a depth: the gap cross-section has something to draw. */
function hasGap(o: ObstaclesReading): boolean {
  const c = o.canal;
  const r = o.reach;
  return !!(c && (c.widthM || c.depthM)) || !!(r && r.depthM);
}

function readHeight(): number {
  try {
    const h = Number(localStorage.getItem(HEIGHT_KEY));
    if ((HEIGHT_STOPS as readonly number[]).includes(h)) return h;
  } catch {
    /* storage blocked */
  }
  return HEIGHT_DEFAULT;
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

/**
 * Who the ground is judged for (user, 2026-11-07: "nothing showing which layer / force type data is being used ... he
 * can make wrong decisions"), on its own line under the tabs so it stays in view on every tab (2026-11-08, item 9):
 * the mode with its icon, the echelon and how the mode was set (by the symbol, or by hand with P, in amber), a warning
 * when the map overlay paints another mode, and the season and light the going and speed are read for.
 */
function modeParts(v: GroundGuideVerdict): HTMLElement[] {
  const who = el('span');
  const ic = modeIcon(v.profile);
  ic.setAttribute('width', '16');
  ic.setAttribute('height', '16');
  who.title = `Judged for ${v.profileLabel}`;
  who.append(ic, 'For ', el('b', undefined, v.profileLabel));
  const echelon = v.footprint?.echelon;
  if (echelon) who.append(` · ${titleCase(echelon)}`);
  who.append(' · ', v.profileOverride ? el('span', 'ms-hand', 'Set by hand (P)') : 'from the symbol');
  const out = [who];
  if (v.overlayOther) out.push(el('span', 'ms-other', `Map colours show ${v.overlayOther}`));
  const g = v.going;
  const when: string[] = [];
  if (g) when.push(`${g.season === 'wet' ? 'After rain' : 'Dry'}${g.month ? `, ${monthName(g.month)}` : ''}`);
  if (v.speed) when.push(v.speed.light === 'night' ? 'Night' : 'Day');
  const w = el('span', 'ms-when');
  if (when.length) {
    if (g) w.append(seasonIcon(g.season, 13));
    w.append(when.join(' · '));
  }
  // Still waiting on tiles or features: said in words, as the cursor card's grey "Checking" (item 4).
  if (pendingOf(v)) w.append(el('span', 'ms-upd', `${when.length ? ' · ' : ''}Checking…`));
  if (w.childNodes.length) out.push(w);
  return out;
}

export class GroundGuideDetail {
  private _el: HTMLDivElement | null = null;
  private _tabs = new Map<DetailTab, HTMLButtonElement>();
  /** Each letter tab's answer line (item 8). */
  private _ans = new Map<DetailTab, HTMLElement>();
  /** Who the ground is judged for, under the tabs (item 9). */
  private _mode: HTMLElement | null = null;
  private _sum: HTMLElement | null = null;
  /** The card's height as a share of the window, one of HEIGHT_STOPS (item 14). */
  private _height = readHeight();
  private _grip: HTMLButtonElement | null = null;
  /** The card's box on screen while open, for the cursor card to keep clear of (item 7); null = measure again. */
  private _rect: DOMRect | null = null;
  /** Room left free for the Gr Scope rail (setInset). */
  private _inset: { side: 'right' | 'left'; px: number } = { side: 'right', px: 0 };
  private _onWinResize: (() => void) | null = null;
  private _h0 = 0;
  private _band: HTMLElement | null = null;
  private _clip: HTMLElement | null = null;
  private _flow: HTMLElement | null = null;
  private _pageEl: HTMLElement | null = null;
  private _page = 0;
  private _pages = 1;
  private _ro: ResizeObserver | null = null;
  private _w = 0;
  private _north = 0; // where north points on screen, degrees clockwise from up
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

  /**
   * The card's box on screen while it is open, else null: the cursor card keeps clear of it (item 7). Measured once
   * and kept until the card opens, closes, is resized or the window changes, so the pointer path reads no layout.
   */
  get rect(): DOMRect | null {
    if (!this.isShown || !this._el) return null;
    return (this._rect ??= this._el.getBoundingClientRect());
  }

  /** Show the card for this verdict (rebuilds the active tab; the Legend tab waits for `setLegend`). */
  show(v: GroundGuideVerdict): void {
    this._v = v;
    const root = this._ensure();
    this._renderMeta(v);
    const first = !root.classList.contains('ms-open');
    root.classList.add('ms-open');
    if (first) {
      this._rect = null;
      this._renderTab(true);
    } else if (this._tab !== 'L') this._renderTab(false);
  }

  /** Show the card with no verdict yet (D before a draw): the Legend tab works; the letters say what they wait for. */
  open(): void {
    const root = this._ensure();
    if (root.classList.contains('ms-open')) return;
    root.classList.add('ms-open');
    this._rect = null;
    this._renderMeta(null);
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

  /**
   * Turn to the tab's next page; from the last page back to the first (user, 2026-11-08: "pages wrap"; the letter no
   * longer closes the card, D and Esc do). False when the tab has only one page.
   */
  nextPage(): boolean {
    if (!this.isShown || this._pages < 2) return false;
    this._page = (this._page + 1) % this._pages;
    this._showPage();
    return true;
  }

  /** Shift + the letter: back a page (from the first to the last). False when the tab has only one page. */
  prevPage(): boolean {
    if (!this.isShown || this._pages < 2) return false;
    this._page = (this._page + this._pages - 1) % this._pages;
    this._showPage();
    return true;
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

  /** The map was turned: every rose, map and arrow on the card turns with it (no rebuild). */
  setNorth(northDeg: number): void {
    if (northDeg === this._north) return;
    this._north = northDeg;
    if (!this._el) return;
    setNorthVar(this._el, northDeg);
    orientRoses(this._el, northDeg);
  }

  /**
   * Room kept free at one side for the Gr Scope rail while it is shown (px from the window's edge; 0 = none): the card
   * stops short of it instead of running under it, and fits its tiles to the narrower width.
   */
  setInset(side: 'right' | 'left', px: number): void {
    if (side === this._inset.side && px === this._inset.px) return;
    this._inset = { side, px };
    this._applyInset();
  }

  private _applyInset(): void {
    const e = this._el;
    if (!e) return;
    const { side, px } = this._inset;
    e.style.right = side === 'right' && px > 0 ? `${px}px` : '';
    e.style.left = side === 'left' && px > 0 ? `${px}px` : '';
    this._rect = null;
    if (this.isShown) this._h.resized?.();
  }

  hide(): void {
    this._el?.classList.remove('ms-open');
    if (this._sum) this._sum.style.minHeight = '';
    this._page = 0;
    this._rect = null;
  }

  destroy(): void {
    this._ro?.disconnect();
    this._ro = null;
    if (this._onWinResize) window.removeEventListener('resize', this._onWinResize);
    this._onWinResize = null;
    if (this._copyTimer !== null) clearTimeout(this._copyTimer);
    this._copyTimer = null;
    this._el?.remove();
    this._el = this._mode = this._sum = this._band = this._clip = this._flow = this._pageEl = null;
    this._grip = null;
    this._copy = null;
    this._tabs.clear();
    this._ans.clear();
    this._v = null;
    this._legend = null;
    this._keyP = this._keyS = null;
  }

  // ── building ──────────────────────────────────────────────────────────────

  private _ensure(): HTMLDivElement {
    if (this._el) return this._el;
    ensureBriefCss();
    ensureTokensCss();
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
      // Two lines (item 8): the short name over the tab's own answer, a dot and a word (filled in by _renderMeta).
      const b = el('button', 'ms-ggd-tab', undefined) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === this._tab));
      b.title = `${TAB_LABEL[t]} (${TAB_KEY_OF[t]})`;
      b.setAttribute('aria-label', TAB_LABEL[t]);
      const tt = el('span', 'ms-ggd-tt');
      const ans = el('span', 'ms-ggd-ta');
      ans.textContent = ' ';
      tt.append(el('span', 'ms-ggd-tl', TAB_LABEL[t]), ans);
      b.append(el('span', 'ms-ggd-k', TAB_KEY_OF[t]), tt);
      b.addEventListener('click', () => this.setTab(t));
      tabs.append(b);
      this._tabs.set(t, b);
      this._ans.set(t, ans);
    }
    const copy = el('button', 'ms-ggd-btn', 'Copy as Text') as HTMLButtonElement;
    copy.type = 'button';
    copy.title = 'Copy every section as plain text, for orders';
    copy.addEventListener('click', () => this._copyText());
    const close = el('button', 'ms-ggd-btn ms-x', '×') as HTMLButtonElement;
    close.type = 'button';
    close.title = 'Close (D or Esc)';
    close.setAttribute('aria-label', 'Close the Ground Detail');
    close.addEventListener('click', () => this._h.close());
    head.append(tabs, el('span', 'ms-ggd-hsp'), copy, close);

    const mode = el('div', 'ms-ggd-mode');
    mode.hidden = true;
    const sum = el('div', 'ms-ggd-sum');
    sum.hidden = true;
    sum.setAttribute('role', 'group');
    const band = el('div', 'ms-ggd-band');
    const clip = el('div', 'ms-ggd-clip');
    const flow = el('div', 'ms-ggd-flow');
    flow.setAttribute('role', 'tabpanel');
    clip.append(flow);
    band.append(clip);
    const foot = el('div', 'ms-ggd-f');
    const keys = el('span');
    for (const [k, t] of [['D', 'open / close'], ['G R O T B C', 'tabs, again for the next page, with Shift back'], ['K', 'legend'], ['V', 'Gr Scope'], ['Esc', 'close']] as const) {
      for (const kk of k.split(' ')) keys.append(el('span', 'ms-ggd-k', kk));
      keys.append(`${t} `);
    }
    const page = el('span', 'ms-ggd-page');
    page.hidden = true;
    page.setAttribute('aria-live', 'polite');
    foot.append(keys, page);
    root.append(this._makeGrip(), head, mode, sum, band, foot);
    ensureNorthCss();
    setNorthVar(root, this._north);
    this._applyHeight(root);
    document.body.appendChild(root);
    this._el = root;
    this._applyInset();
    this._mode = mode;
    this._sum = sum;
    this._band = band;
    this._clip = clip;
    this._flow = flow;
    this._pageEl = page;
    this._copy = copy;
    this._onWinResize = () => {
      this._rect = null;
      this._applyHeight(root);
      if (this.isShown) this._h.resized?.();
    };
    window.addEventListener('resize', this._onWinResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        this._rect = null;
        if (clip.clientWidth === this._w && clip.clientHeight === this._h0) return;
        // A new width fits a different number of columns and facts, a new height more or fewer tiles: refit both.
        if (this._sum && !this._sum.hidden && clip.clientWidth !== this._w) {
          this._sum.style.minHeight = '';
          this._fitSummary();
        }
        this._paginate(true);
      });
      this._ro.observe(clip);
    }
    return root;
  }

  // ── height (item 14: drag to size) ────────────────────────────────────────

  /**
   * The card's height in px for a stop: a share of the window plus EXTRA_PX, but never so short that the band under the
   * strip drops below 260 px (the tallest tiles, a rose with its key or the speed table, need it: the card never
   * scrolls, so a shorter band would cut them), and never more than fits above the bottom gap.
   */
  private _px(stop: number): number {
    return Math.round(Math.min(window.innerHeight - 20, Math.max(MIN_CARD_PX, window.innerHeight * stop + EXTRA_PX)));
  }

  private _applyHeight(root: HTMLElement | null = this._el): void {
    if (!root) return;
    root.style.height = `${this._px(this._height)}px`;
    this._grip?.setAttribute('aria-valuenow', String(Math.round(this._height * 100)));
    this._grip?.setAttribute('aria-valuetext', `${Math.round(this._height * 100)}% of the window`);
  }

  private _setHeight(stop: number, save: boolean): void {
    if (stop !== this._height) {
      this._height = stop;
      this._rect = null;
      this._applyHeight();
      this._h.resized?.();
    }
    if (save) {
      try {
        localStorage.setItem(HEIGHT_KEY, String(stop));
      } catch {
        /* storage blocked: the height lasts for this page */
      }
    }
  }

  /**
   * The grip on the top edge: drag it and the card snaps to 40, 50 or 60 % of the window, the one nearest the
   * pointer, remembered between sessions; Up / Down on the focused grip step through them. The mouse is needed once,
   * not while drawing; the height then stays the same on every tab, the Legend included.
   */
  private _makeGrip(): HTMLButtonElement {
    const g = el('button', 'ms-ggd-grip') as HTMLButtonElement;
    g.type = 'button';
    g.title = 'Drag to size the Ground Detail (40, 50 or 60% of the window)';
    g.setAttribute('role', 'slider');
    g.setAttribute('aria-label', 'Ground Detail height');
    g.setAttribute('aria-valuemin', '40');
    g.setAttribute('aria-valuemax', '60');
    const tip = el('span', 'ms-ggd-stop');
    tip.hidden = true;
    const nearest = (clientY: number): number => {
      const want = (window.innerHeight - 10 - clientY) / window.innerHeight;
      return HEIGHT_STOPS.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
    };
    const show = () => {
      tip.textContent = `${Math.round(this._height * 100)}%`;
      tip.hidden = false;
    };
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.classList.add('ms-drag');
      show();
    });
    g.addEventListener('pointermove', (e) => {
      if (!g.hasPointerCapture(e.pointerId)) return;
      this._setHeight(nearest(e.clientY), false);
      show();
    });
    const end = (e: PointerEvent) => {
      if (!g.hasPointerCapture(e.pointerId)) return;
      g.releasePointerCapture(e.pointerId);
      g.classList.remove('ms-drag');
      tip.hidden = true;
      this._setHeight(this._height, true);
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('keydown', (e) => {
      const i = HEIGHT_STOPS.indexOf(this._height as (typeof HEIGHT_STOPS)[number]);
      const j = e.key === 'ArrowUp' ? i + 1 : e.key === 'ArrowDown' ? i - 1 : i;
      if (j === i) return;
      e.preventDefault();
      e.stopPropagation();
      this._setHeight(HEIGHT_STOPS[Math.min(HEIGHT_STOPS.length - 1, Math.max(0, j))], true);
    });
    g.append(tip);
    this._grip = g;
    return g;
  }

  /** Every letter tab's answer (item 8) and the line saying who the ground is judged for (item 9). */
  private _renderMeta(v: GroundGuideVerdict | null): void {
    for (const [t, line] of this._ans) {
      const a = t === 'L' ? null : letterAnswer(t, v);
      if (!a) {
        line.replaceChildren(' ');
        line.title = '';
        continue;
      }
      const mark = el('span', a.ring ? 'ms-ggd-ring' : 'ms-ggd-fd');
      if (a.tone && !a.ring) mark.dataset.tone = a.tone;
      line.replaceChildren(...(a.tone || a.ring ? [mark] : []), el('span', undefined, a.tab));
      line.title = a.tab;
      this._tabs.get(t)?.setAttribute('aria-label', `${TAB_LABEL[t]}: ${a.tab}`);
    }
    const mode = this._mode;
    if (!mode) return;
    if (!v || v.verdict === 'off' || v.verdict === 'exempt') {
      mode.replaceChildren(el('span', undefined, 'No symbol being placed'));
      mode.hidden = false;
      return;
    }
    mode.replaceChildren(...modeParts(v));
    mode.hidden = false;
  }

  /** The answer strip for the active tab: the letter's answer and its facts, or hidden (the Legend tab, or nothing yet). */
  private _renderSummary(tab: DetailTab): void {
    const sum = this._sum;
    if (!sum) return;
    const v = this._v;
    const strip = tab === 'L' ? null : detailSummary(tab, v);
    if (!strip || !v) {
      sum.replaceChildren();
      sum.hidden = true;
      sum.style.minHeight = '';
      return;
    }
    sum.setAttribute('aria-label', `${TAB_LABEL[tab]} at a glance, for ${v.profileLabel}`);
    sum.replaceChildren(strip);
    sum.hidden = false;
    arrowCompass(strip);
    this._fitSummary();
    // A ratchet: a fact that comes and goes with the cursor must not make the strip (and the card) jump. Border-box.
    const h = sum.offsetHeight;
    if (h > (parseFloat(sum.style.minHeight) || 0)) sum.style.minHeight = `${h}px`;
  }
  /**
   * Keep the facts to one line: those that wrap on a narrow card are hidden (the lead and the first facts stay;
   * every fact is also in the band below), so the strip never eats the band.
   */
  private _fitSummary(): void {
    const row = this._sum?.querySelector<HTMLElement>('.ms-ggd-sum-row');
    if (!row) return;
    const facts = Array.from(row.children) as HTMLElement[];
    for (const f of facts) f.hidden = false;
    const top = facts[0]?.offsetTop ?? 0;
    for (const f of facts.slice(1)) if (f.offsetTop > top + 2) f.hidden = true;
  }

  /** Rebuild the active tab. `reset`: a new tab (or the first show), so it opens on its first page. */
  private _renderTab(reset: boolean): void {
    const flow = this._flow;
    if (!flow) return;
    const tab = this._tab;
    if (reset && this._sum) this._sum.style.minHeight = '';
    flow.setAttribute('aria-label', TAB_LABEL[tab]);
    this._renderSummary(tab);
    let tiles: HTMLElement[] = [];
    try {
      tiles = tab === 'L' ? this._renderL() : this._renderLetter(tab);
    } catch (err) {
      tiles = [empty('This tab could not be drawn. The Engine Log has the error.')];
      console.error('[Ground Guide] detail tab', tab, err);
    }
    if (!tiles.length) {
      tiles = [empty(this._v ? `Nothing to show for ${TAB_LABEL[tab]} here yet. Move the cursor over the map, or wait for the tiles.` : 'Move the cursor over the map while drawing.')];
    }
    flow.replaceChildren(...tiles);
    this._trimLetters(tab);
    // On the card root, not the flow: orientNorth also sets --gg-north on what it is given, and a copy left on the
    // flow would hide the root's value from every arrow when the map is turned later (setNorth turns the root).
    orientRoses(this._el ?? flow, this._north);
    arrowCompass(flow);
    this._paginate(!reset);
  }

  /** In a letter's tab every tile is that letter: its badge says nothing the tab does not, so it goes. Others (W, T) stay. */
  private _trimLetters(tab: DetailTab): void {
    const flow = this._flow;
    if (!flow) return;
    for (const b of flow.querySelectorAll<HTMLElement>(':scope > .ms-ggb-sec > .ms-ggb-cap > span:first-child')) {
      if (b.textContent === tab && b.childElementCount === 0) b.remove();
    }
  }

  /**
   * Lay the tiles out in the band's columns and count the pages. When the tab fits one page with its tiles kept in
   * order, they are spread over the whole width (`_spread`). Otherwise every tile is set to the narrowest column width
   * and measured; each goes into the first column (on any page) with room for it, so a short tile fills the space
   * under a tall one; a column that is full opens the next, and the columns past the card's width make the next page.
   * A list taller than the band is split row by row and continues at the top of a later column. A last (or only) page
   * that leaves columns empty widens its used ones to the card's width. `keep`: stay on the page shown (a rebuild as
   * the cursor moves), else the first.
   */
  private _paginate(keep: boolean): void {
    const flow = this._flow;
    const clip = this._clip;
    if (!flow || !clip) return;
    flow.style.transition = 'none';
    flow.style.transform = '';
    for (const r of Array.from(flow.querySelectorAll(':scope > .ms-ggd-rule'))) r.remove();
    const W = clip.clientWidth;
    const H = clip.clientHeight;
    this._w = W;
    this._h0 = H;
    const tiles = Array.from(flow.children).filter((k) => k.classList.contains('ms-ggb-sec')) as HTMLElement[];
    if (!tiles.length || W <= 0 || H <= 0) {
      this._pages = 1;
      this._page = 0;
      this._showPage(false);
      return;
    }
    const per = Math.max(1, Math.floor((W + COL_GAP) / (COL_MIN + COL_GAP)));
    let cols = this._spread(tiles, W, H, per);
    let pages = 1;
    if (!cols) {
      const colW = (W - (per - 1) * COL_GAP) / per;
      for (const t of tiles) {
        t.style.width = `${colW}px`;
        t.style.left = t.style.top = '0px';
      }
      // Split the lists that run past the band's height, in place (the continuation follows its list).
      const items: Array<{ t: HTMLElement; after: HTMLElement | null }> = [];
      for (const t of tiles) {
        const parts = t.classList.contains('ms-ggd-brk') && t.offsetHeight > H ? this._splitList(t, H) : [t];
        parts.forEach((p, i) => items.push({ t: p, after: i ? parts[i - 1] : null }));
      }
      const fit = this._firstFit(items, per, colW, W, H);
      cols = fit.cols;
      pages = Math.max(1, Math.ceil(cols.length / per));
      const first = (pages - 1) * per; // the last page's first column
      const m = cols.length - first;
      if (m < per) {
        // The last (or only) page has columns to spare (user, 2026-11-08: half the card was empty). Its tiles are
        // shared out side by side over the whole width (two left over sit beside each other, not one under the
        // other); when that does not fit, they go first fit again into the columns the page used, made wider; when
        // that does not fit either, everything is placed as it was.
        const last = items.filter(({ t }) => (fit.colOf.get(t) ?? 0) >= first);
        const dx = (pages - 1) * (W + COL_GAP);
        const placed = this._spread(last.map(({ t }) => t), W, H, per, dx) ?? this._widen(last, m, W, H, dx);
        if (placed) cols = [...cols.slice(0, first), ...placed];
        else {
          for (const { t } of items) t.style.width = `${colW}px`;
          cols = this._firstFit(items, per, colW, W, H).cols;
        }
      }
    }
    // A hairline between neighbouring columns on each page (not before a page's first column).
    for (const c of cols) {
      if (c.used === 0 || c.x % (W + COL_GAP) < 1) continue;
      const r = el('div', 'ms-ggd-rule');
      r.style.left = `${Math.round(c.x - COL_GAP / 2)}px`;
      flow.append(r);
    }
    this._pages = pages;
    raiseSvgText(flow);
    this._page = keep ? Math.min(this._page, this._pages - 1) : 0;
    this._showPage(false);
    void flow.offsetWidth; // the jump to the kept page is not animated; a page turn is
    flow.style.transition = '';
  }

  /**
   * The tiles side by side across the whole card, when they fit one page that way: as many columns as there is room
   * for (or one a tile, when there are fewer tiles), as wide as `COL_MAX`, the tiles kept in order and shared out so
   * the tallest column is as short as it can be. Null when a tile is taller than the band (a list to split) or the
   * shared-out columns would not fit: the caller then packs first fit and pages.
   */
  private _spread(tiles: HTMLElement[], W: number, H: number, per: number, x0 = 0): Array<{ x: number; used: number }> | null {
    const n = Math.min(per, tiles.length);
    if (n < 1) return null;
    const colW = Math.min(COL_MAX, (W - (n - 1) * COL_GAP) / n);
    for (const t of tiles) {
      t.style.width = `${colW}px`;
      t.style.left = t.style.top = '0px';
    }
    const h = tiles.map((t) => t.offsetHeight);
    if (h.some((x) => x > H)) return null;
    const { starts, max } = balanceColumns(h, n, ITEM_GAP);
    if (max > H) return null;
    const cols: Array<{ x: number; used: number }> = [];
    starts.forEach((s, j) => {
      const end = j + 1 < starts.length ? starts[j + 1] : tiles.length;
      const x = x0 + j * (colW + COL_GAP);
      let y = 0;
      for (let i = s; i < end; i++) {
        tiles[i].style.left = `${Math.round(x)}px`;
        tiles[i].style.top = `${Math.round(y)}px`;
        y += h[i] + ITEM_GAP;
      }
      cols.push({ x, used: Math.max(0, y - ITEM_GAP) });
    });
    return cols;
  }

  /**
   * The last page's tiles first fit again into its `m` columns made as wide as the card allows, shifted to the page
   * at `dx`. Null when they no longer fit `m` columns.
   */
  private _widen(last: Array<{ t: HTMLElement; after: HTMLElement | null }>, m: number, W: number, H: number, dx: number): Array<{ x: number; used: number }> | null {
    const inLast = new Set(last.map(({ t }) => t));
    const wide = Math.min(COL_MAX, (W - (m - 1) * COL_GAP) / m);
    for (const { t } of last) t.style.width = `${wide}px`;
    const again = this._firstFit(
      last.map(({ t, after }) => ({ t, after: after && inLast.has(after) ? after : null })),
      m,
      wide,
      W,
      H,
    );
    if (again.cols.length > m) return null;
    for (const { t } of last) t.style.left = `${Math.round(parseFloat(t.style.left) + dx)}px`;
    return again.cols.map((c) => ({ x: c.x + dx, used: c.used }));
  }

  /**
   * First fit down the columns, `per` to a page of width `W`: each tile into the first column (on any page) with room
   * for it, so a short tile fills the space under a tall one; a continuation only after its list's column.
   */
  private _firstFit(
    items: Array<{ t: HTMLElement; after: HTMLElement | null }>,
    per: number,
    colW: number,
    W: number,
    H: number,
  ): { cols: Array<{ x: number; used: number }>; colOf: Map<HTMLElement, number> } {
    const cols: Array<{ x: number; used: number }> = [];
    const colOf = new Map<HTMLElement, number>();
    const open = (): number => {
      const i = cols.length;
      cols.push({ x: Math.floor(i / per) * (W + COL_GAP) + (i % per) * (colW + COL_GAP), used: 0 });
      return i;
    };
    for (const { t, after } of items) {
      const h = t.offsetHeight;
      const from = after ? (colOf.get(after) ?? -1) + 1 : 0;
      let ci = -1;
      for (let i = from; i < cols.length; i++) {
        const c = cols[i];
        if (c.used === 0 || c.used + ITEM_GAP + h <= H) {
          ci = i;
          break;
        }
      }
      if (ci < 0) {
        do ci = open();
        while (ci < from);
      }
      const c = cols[ci];
      const top = c.used === 0 ? 0 : c.used + ITEM_GAP;
      t.style.left = `${Math.round(c.x)}px`;
      t.style.top = `${Math.round(top)}px`;
      c.used = top + h;
      colOf.set(t, ci);
    }
    return { cols, colOf };
  }

  /**
   * Split a list tile (caption over a label / value list, maybe a line after it) into pieces no taller than `h`, row
   * by row: the first keeps the caption, the others carry it again with "continued". The pieces are left in the flow
   * in order, the line after the list at the end of the last.
   */
  private _splitList(t: HTMLElement, h: number): HTMLElement[] {
    const list = t.querySelector<HTMLElement>(':scope > .ms-gs-kv');
    const cap = t.querySelector<HTMLElement>(':scope > .ms-ggb-cap');
    if (!list || !cap || list.childElementCount < 2) return [t];
    const after: Element[] = [];
    for (let n = list.nextElementSibling; n; n = n.nextElementSibling) after.push(n);
    for (const a of after) a.remove();
    const out: HTMLElement[] = [t];
    let cur = t;
    let curList = list;
    while (cur.offsetHeight > h && curList.childElementCount > 1) {
      const next = t.cloneNode(false) as HTMLElement;
      const c2 = cap.cloneNode(true) as HTMLElement;
      c2.append(el('span', 'ms-ggd-cont', ' continued'));
      const nl = curList.cloneNode(false) as HTMLElement;
      next.append(c2, nl);
      cur.after(next);
      while (cur.offsetHeight > h && curList.childElementCount > 1) nl.prepend(curList.lastElementChild!);
      out.push(next);
      cur = next;
      curList = nl;
    }
    cur.append(...after);
    return out;
  }

  private _showPage(animate = true): void {
    const flow = this._flow;
    const clip = this._clip;
    if (!flow || !clip) return;
    if (!animate) flow.style.transition = 'none';
    flow.style.transform = this._page ? `translateX(${-this._page * (clip.clientWidth + COL_GAP)}px)` : '';
    this._band?.classList.toggle('ms-more', this._page + 1 < this._pages);
    const p = this._pageEl;
    if (!p) return;
    p.hidden = this._pages < 2;
    if (this._pages < 2) return;
    const dots = el('span', 'ms-ggd-dots');
    for (let i = 0; i < this._pages; i++) dots.append(el('i', i === this._page ? 'ms-on' : undefined));
    const key = TAB_KEY_OF[this._tab];
    const more = this._page + 1 < this._pages;
    const next = el('span');
    next.append(el('b', undefined, `Page ${this._page + 1} of ${this._pages}`), ' ', el('span', 'ms-ggd-k', key), more ? 'next page' : 'back to page 1', ' Shift + ', el('span', 'ms-ggd-k', key), 'back');
    p.replaceChildren(dots, next);
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

  // Each tab lists its pictures first, then its lists and notes, most telling first: the band runs them down its
  // columns in this order and pages what does not fit.

  // ── G ─────────────────────────────────────────────────────────────────────
  private _renderG(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const g = v.sections?.ground;
    if (g) {
      ensureSectionsCss();
      out.push(groundRelief(g));
    }
    const gi = v.going;
    if (gi?.soil) out.push(tile('G', 'Soil', ...soilDetail(gi, 112)));
    const itg = itgSection(v);
    if (itg) out.push(itg);
    if (g) {
      const list = kv([...groundRows(g), ...groundMore(g, v)]);
      if (list) out.push(listTile('G', 'Terrain, Relief & Water', list));
    }
    return out;
  }

  // ── R ─────────────────────────────────────────────────────────────────────
  private _renderR(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const r = v.sections?.roads;
    if (r) {
      ensureSectionsCss();
      out.push(roadsShield(r));
      const d = r.density;
      if (d) {
        ensureRoadDensityCss();
        // The callout judges for the mode being drawn (item 10): many roads are no help to a mode none of them suits.
        const forMode = v.traffic?.road;
        const noneForMode = !!forMode && !forMode.main && forMode.caption === 'Rd';
        const note = el('div', 'ms-ggd-note', noneForMode ? `${forMode!.text}: ${v.profileLabel} moves cross-country here, whatever the density.` : roadDensityNote(d));
        note.style.background = noneForMode ? 'rgba(238,138,31,.14)' : DENSITY_COLOURS[d.lead.key][0];
        note.style.color = noneForMode ? '#ffb46b' : DENSITY_COLOURS[d.lead.key][1];
        out.push(tile('R', `Rd Network Density · ${fmtRadius(d.radiusM)}`, densityGauge(d, 'both'), note));
        out.push(tile('R', 'Rds Out', densityRose(d, 'both')));
        out.push(tile('R', 'Route Classification', densityMakeup(d, 'both')));
      }
    }
    const road = v.traffic?.road;
    if (road) {
      ensureGoingCss();
      ensureTrafficCss();
      const rb = roadBlock(viewOf(v));
      if (rb) out.push(tile('R', `${road.caption} for ${v.profileLabel}`, rb));
    }
    if (r) {
      const list = kv([...roadsRows(r), ...roadsMore(r)]);
      const rt = railTransportLine(r);
      if (rt) rt.style.marginLeft = '0';
      if (list) out.push(listTile('R', 'Route Here & Nearby', list, rt));
      else if (rt) out.push(tile('R', 'Route Here & Nearby', rt));
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
      const dial = obstaclesDial(o, 132);
      if (dial) out.push(dial);
    }
    const g = v.going;
    if (g?.movement) {
      ensureGoingCss();
      const es = exitStripSection(g, 120);
      if (es) out.push(es);
    }
    if (s && o) {
      if (hasGap(o)) out.push(obstaclesGap(o));
      // Natural and man-made apart, each row with its icon (obstaclesRows already holds every row once).
      const near = obstaclesNear(obstaclesRows(o, s), o);
      if (near.childElementCount) {
        const t = tile('O', 'Obs Near', near);
        t.classList.add('ms-ggd-brk');
        out.push(t);
      }
    }
    return out;
  }

  // ── T ─────────────────────────────────────────────────────────────────────
  private _renderT(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const g = v.going;
    const sp = v.speed;
    if (sp) ensureSpeedCss();
    if (g) {
      ensureGoingCss();
      ensureTrafficCss();
      const tv = viewOf(v);
      out.push(blockGauge(v, tv));
      const mv = movementDetail(g, 120);
      if (mv) out.push(tile('T', `Movement Freedom · ${g.season === 'dry' ? 'Dry' : 'After Rain'}`, mv, roseLegend(true), g.pending ? soft('Still loading round the edges') : null));
      if (sp?.rays) {
        const row = el('div', 'ms-ggs-rose');
        row.append(roseFigure(speedRoseSvg(sp.rays, sp.rangeM, 120, 0), speedRoseKey()), speedRoseLines(sp));
        out.push(tile('T', `Time to ${fmtDistance(sp.rangeM)} · ${sp.short}`, row));
      }
      const cv = goingCanvas(g, 120, 0, true);
      if (cv && g.map) {
        const box = el('div', 'ms-gv-map');
        box.append(cv, mapShares(g) ?? el('span'));
        out.push(tile('T', `Going Map · ${fmtDistance(g.map.rangeM)}`, box, soft('Dashed ring: half the range.')));
      }
      if (tv.road?.main) out.push(blockWayOut(v, tv));
      out.push(blockTiles(v, tv));
      if (sp) out.push(tile('T', 'Who Moves How Fast', speedModeTiles(sp), soft(`km/h cross-country · ${speedWhen(sp)}`)));
      const rb = ribbon(g, 48);
      if (rb) out.push(tile('T', `Going by Month · ${tv.short}`, rb));
    } else if (sp?.rays) {
      const row = el('div', 'ms-ggs-rose');
      row.append(roseFigure(speedRoseSvg(sp.rays, sp.rangeM, 120, 0), speedRoseKey()), speedRoseLines(sp));
      out.push(tile('T', `Time to ${fmtDistance(sp.rangeM)} · ${sp.short}`, row));
    }
    const w = v.sections?.weather;
    if (w) {
      ensureSectionsCss();
      out.push(weatherYear(w));
    }
    if (sp) {
      ensureGoingCss();
      const day = speedDayText(sp);
      const here = speedGroundText(sp);
      out.push(tile('T', speedCaption(sp), speedHeadline(sp), speedGrid(sp), day ? soft(`A day's march: ${day}`) : null, here ? soft(`Here: ${here}`) : null, soft(sp.basis)));
      const way = speedWay(sp);
      if (way) out.push(tile('T', `${speedCaption(sp)} · To the Rd`, ...way));
    }
    if (w) out.push(weatherIcons(w));
    return out;
  }

  // ── B ─────────────────────────────────────────────────────────────────────
  private _renderB(v: GroundGuideVerdict): HTMLElement[] {
    const out: HTMLElement[] = [];
    const p = v.population;
    const r = p?.reading;
    if (p || v.sections?.buildings) ensurePopulationCss();
    if (r) {
      const two = el('div', 'ms-ggp-two');
      two.append(roseFigure(radar(r, 104), radarKey()), ringList(r, [1, 2, 3, 5, 10]));
      out.push(tile('B', `People · ${r.radiusKm} km`, two, densityScale(r.cls), populationLine('Density', populationChip(r.cls), ` ${fmtPeople(r.perKm2)} per km² within ${r.radiusKm} km`)));
      out.push(tile('B', 'People by Dir', populationRose(r)));
      out.push(tile('B', 'People Map · 1 km Cells', populationMinimap(r)));
      out.push(tile('B', 'Out from Here', ...populationProfile(r)));
      if (r.ages && r.people > 0) {
        const a = el('div');
        a.append(...ageBar(r.people, r.ages));
        out.push(tile('B', 'Ages', a, populationLine('Males 15–49', `${fmtPeople(r.ages.males15_49)} within ${r.radiusKm} km`)));
      }
      const places = tile('B', 'Places', populationPlaces(r, 8), nearestLine(r));
      places.classList.add('ms-ggd-brk');
      out.push(places);
    }
    const b = v.sections?.buildings;
    if (b) {
      ensureSectionsCss();
      out.push(buildingsWhere(b));
      const list = kv([...buildingsRows(b), ...buildingsMore(b, v)]);
      if (list) out.push(listTile('B', 'Bldgs, Huts & Svcs', list));
      out.push(buildingsProtected(b));
    }
    if (r?.province) out.push(tile('B', 'Against the Province', ...populationCompare(r)));
    if (r) out.push(tile('B', 'Source', soft(populationSourceLine(r))));
    return out;
  }

  // ── C ─────────────────────────────────────────────────────────────────────
  private _renderC(v: GroundGuideVerdict): HTMLElement[] {
    const c = v.cover;
    if (!c) return [];
    ensureCoverCss();
    const out: HTMLElement[] = [];
    out.push(tile('C', 'Four Ways', coverGridTiles(c), coverGivesLine(c)));
    const box = el('div', 'ms-gc-rose');
    box.append(coverRose(c, 112, 0), roseText(c));
    out.push(tile('C', `Cover Round It · ${COVER_FIELD_LABEL[c.roseField]}`, box, coverRoseKey()));
    out.push(tile('C', `Nearest Cover · ${fmtDistance(c.radiusM)}`, nearestGrid(c)));
    out.push(tile('C', 'Levels', ...fourLines(c)));
    const mode = [needLine(c, v.profileLabel), bankLine(c), localLine(c), aroundLine(c), c.classLabel ? soft(`Gr here: ${c.classLabel}`) : null].filter((x): x is HTMLElement => !!x);
    if (mode.length) out.push(tile('C', `For ${v.profileLabel}`, ...mode));
    out.push(
      tile(
        'C',
        'Also Mapped',
        shelterLine(c, true),
        formLine(c),
        builtLine(c),
        soft('Levels: this spot, from its ground class and any river or canal bank (a starting proposal). The cover density of the area round it never raises them. Check on the ground.'),
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
      const b = el('button', 'ms-ggd-mode-b') as HTMLButtonElement;
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
    out.push(tile('L', `Mode · ${st.modes.length} to choose from`, tag, modes));

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
    if (p.list) {
      const t = tile('L', `Gr for ${cur.label}`, p.list);
      t.classList.add('ms-ggd-brk');
      out.push(t);
    }

    // Keys.
    const keys = legendEl('ms-ggl-keys');
    if (p.keyP) keys.append(p.keyP);
    if (p.keyS) keys.append(p.keyS);
    keys.append(
      legendKeyRow('D', 'Gr Detail', 'Opens and closes this card'),
      legendKeyRow('H', 'Hint', 'Shrinks the cursor card to GO / SLOW-GO / NO-GO; again for the card'),
      legendKeyRow('G', 'Tabs', 'G R O T B C, one letter a tab; again for the next page (back to the first after the last), Shift + letter goes back'),
      legendKeyRow('K', 'Legend', 'This tab (L is Lasso Select)'),
      legendKeyRow('V', 'Gr Scope', 'Shows or hides the side rail: the map round the symbol with range rings and the GROTBC layers'),
      legendKeyRow('Esc', 'Close', 'Closes this card; a second Esc cancels the draw'),
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
