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

import { itgSection, titleOf, verdictColor } from './GroundGuideBadge';
import { briefText, ensureBriefCss, LETTER_COLOR, monthName, movementDetail, soilDetail, type GrotbcLetter } from './GroundGuideBrief';
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
import { detailSummary } from './GroundGuideDetailSummary';
import { fmtDistance, titleCase } from './GroundGuideEvaluator';
import { ensureGoingCss, exitStripSection, goingCanvas, mapShares, orientRoses, ribbon, roseLegend, seasonIcon } from './GroundGuideGoingView';
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
const W_COLOR = '#4a7f95';
/** Space between the band's columns, and the narrowest a column may be, px. */
const COL_GAP = 28;
const COL_MIN = 262;
/** Space between two tiles in a column, px. */
const ITEM_GAP = 16;

const CSS = `
.ms-ggd{position:fixed;left:10px;right:10px;bottom:10px;z-index:2147482800;
  display:none;flex-direction:column;box-sizing:border-box;border-radius:12px;background:#1b1f25;border:1px solid #4d5661;box-shadow:0 10px 30px rgba(0,0,0,.5);
  font:400 14px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;--pb-k:#aab3bd}
.ms-ggd.ms-open{display:flex}
.ms-ggd-h{flex:none;display:flex;align-items:center;gap:6px 10px;padding:7px 10px;background:#262d36;border-radius:11px 11px 0 0;flex-wrap:wrap}
.ms-ggd-tabs{display:flex;gap:3px;flex-wrap:wrap}
.ms-ggd-tab{display:inline-flex;align-items:center;gap:7px;padding:6px 12px 6px 6px;border-radius:7px;border:1px solid transparent;background:transparent;color:#bcc5ce;
  font:600 13px/1 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer}
.ms-ggd-tab:hover{background:rgba(255,255,255,.08);color:#fff}
.ms-ggd-tab:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-tab[aria-selected="true"]{background:var(--lc);border-color:var(--lc);color:var(--lf)}
.ms-ggd-tab[aria-selected="true"] .ms-ggd-k{background:rgba(0,0,0,.22);border-color:rgba(0,0,0,.3);color:var(--lf)}
.ms-ggd-k{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 4px;box-sizing:border-box;border-radius:4px;
  font:700 11px/1 ui-monospace,Consolas,monospace;color:#fff;background:linear-gradient(#3a424d,#2b313a);border:1px solid #545e6b;border-bottom-width:2px}
.ms-ggd-meta{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:13px;color:#bcc5ce;min-width:0}
.ms-ggd-meta b{color:#fff;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggd-dot{display:inline-block;width:10px;height:10px;border-radius:50%;flex:none;box-shadow:0 0 0 1.5px rgba(255,255,255,.35)}
.ms-ggd-upd{color:#ffc861;white-space:nowrap}
.ms-ggd-btn{font:500 13px/1 system-ui,Segoe UI,Arial,sans-serif;color:#c9d1d9;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:6px;cursor:pointer;height:28px;padding:0 10px;white-space:nowrap}
.ms-ggd-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.ms-ggd-btn:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-btn.ms-x{width:28px;padding:0;font-size:17px}
/* 1. The answer strip: who the ground is judged for, then the letter's facts on one line. */
.ms-ggd-sum{flex:none;box-sizing:border-box;display:flex;align-items:stretch;gap:16px;padding:10px 16px 11px;background:#20262e;border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.08)}
.ms-ggd-sum[hidden]{display:none}
.ms-ggd-for{flex:none;width:210px;min-width:0;padding-right:16px;border-right:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;justify-content:center;gap:2px}
.ms-ggd-for-m{display:flex;align-items:center;gap:7px;font:700 14.5px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#fff;min-width:0}
.ms-ggd-for-m>svg{flex:none;color:#8ec1ea}
.ms-ggd-for-m>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-ggd-for-s{display:flex;align-items:center;gap:5px;font-size:12px;color:#a9b2bc;white-space:nowrap;overflow:hidden}
.ms-ggd-for-s .ms-hand{color:#ffc861;font-weight:650}
.ms-ggd-for-w{font-size:12px;color:#ffd27a;line-height:1.3}
.ms-ggd-sum-row{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-content:center;row-gap:10px}
.ms-ggd-fact{flex:1 1 130px;min-width:0;max-width:290px;padding:0 14px;border-left:1px solid rgba(255,255,255,.1)}
.ms-ggd-fact:first-child{padding-left:0;border-left:0}
.ms-ggd-fact.ms-lead{flex:1.25 1 170px;max-width:330px}
.ms-ggd-fk{font-size:12px;line-height:1.3;color:#a9b2bc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggd-fv{margin-top:2px;font:650 16px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#f4f6f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggd-fact.ms-lead .ms-ggd-fv{font-size:19px}
.ms-ggd-fd{display:inline-block;width:10px;height:10px;margin-right:7px;border-radius:50%;vertical-align:1px}
.ms-ggd-fact.ms-lead .ms-ggd-fd{width:12px;height:12px;vertical-align:2px}
.ms-ggd-fd[data-tone="go"],.ms-ggd-fd[data-tone="c3"]{background:#2fa862}
.ms-ggd-fd[data-tone="slow"],.ms-ggd-fd[data-tone="c1"]{background:#f0932b}
.ms-ggd-fd[data-tone="nogo"]{background:#e5484d}
.ms-ggd-fd[data-tone="c2"]{background:#9cc45a}
.ms-ggd-fd[data-tone="c0"]{background:#5b6470;box-shadow:inset 0 0 0 1.5px #9aa3ad}
.ms-ggd-fd[data-tone="warn"]{background:#f2b84b}
.ms-ggd-fv[data-tone="go"],.ms-ggd-fv[data-tone="c3"]{color:#74dca3}
.ms-ggd-fv[data-tone="slow"],.ms-ggd-fv[data-tone="c1"]{color:#ffb46b}
.ms-ggd-fv[data-tone="nogo"]{color:#ff8a8d}
.ms-ggd-fv[data-tone="c2"]{color:#c3df8f}
.ms-ggd-fv[data-tone="warn"]{color:#ffd27a}
.ms-ggd-fs{margin-top:1px;font-size:12.5px;line-height:1.35;color:#a9b2bc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 2. The band: a fixed height, newspaper columns, pages instead of a scroll bar. */
.ms-ggd-band{flex:none;position:relative;box-sizing:border-box;height:clamp(220px,calc(62vh - 170px),500px);padding:12px 16px 10px}
.ms-ggd-clip{height:100%;overflow:hidden}
/* The tiles are placed by _layout (absolute, first fit down the columns), so a short tile fills the space under a
   tall one rather than leaving it empty; pages sit side by side and the flow slides to the one shown. */
.ms-ggd-flow{position:relative;height:100%}
@media (prefers-reduced-motion:no-preference){.ms-ggd-flow{transition:transform .22s cubic-bezier(.25,1,.5,1)}}
.ms-ggd .ms-ggd-flow>.ms-ggb-sec{position:absolute;box-sizing:border-box;margin:0;padding:0;background:none;border:0;border-radius:0;min-width:0;overflow:hidden;font-size:13.5px}
.ms-ggd .ms-ggd-flow>.ms-ggb-sec>.ms-ggb-cap{display:flex;align-items:center;gap:7px;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.09);
  font:650 13px/1.3 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0;text-transform:none;color:#e4e8ec}
.ms-ggd-rule{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.07)}
.ms-ggd-cont{font-weight:400;color:#97a1ab}
.ms-ggd .ms-ggd-flow .ms-gs-kv{display:block}
.ms-ggd-pair{display:grid;grid-template-columns:84px minmax(0,1fr);column-gap:12px;padding:2px 0}
/* A rose, dial or round map keeps its words beside it in a column: the tile stays short enough to share a column. */
.ms-ggd .ms-gv-rose>div,.ms-ggd .ms-ggs-rose>div,.ms-ggd .ms-gc-rose>div,.ms-ggd .ms-gv-map>div{flex:1 1 128px;min-width:0}
.ms-ggd-l{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:18px;border-radius:4px;font:800 11px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0}
.ms-ggd-empty{color:#a3acb6;padding:20px 12px;text-align:center;font-size:13.5px;column-span:all}
.ms-ggd-soft{color:#a3acb6;font-size:12.5px;margin-top:6px}
.ms-ggd-soft b{color:#e8ebee;font-weight:600}
.ms-ggd-note{margin-top:7px;border-radius:5px;padding:5px 8px;font-size:12px}
/* Text a step larger than on the cursor card: the Detail is read at arm's length, often in daylight. */
.ms-ggd .ms-gs-kv,.ms-ggd .ms-ggbr-ln,.ms-ggd .ms-gc-row,.ms-ggd .ms-gc-near,.ms-ggd .ms-ggp-list,.ms-ggd .ms-ggp-ln,.ms-ggd .ms-ggp-places,.ms-ggd .ms-ggd-kv,.ms-ggd .ms-gx-where,.ms-ggd .ms-gx-list,.ms-ggd .ms-ggs-kv,.ms-ggd .ms-ggb-tkv,.ms-ggd .ms-gs-one{font-size:13.5px}
.ms-ggd .ms-gs-kv{line-height:1.4}
.ms-ggd .ms-ggp-chip{font-size:10.5px;padding:4px 8px 3px}
.ms-ggd .ms-gs-kv .ms-gs-k,.ms-ggd .ms-ggd-kv>.k,.ms-ggd .ms-ggp-k,.ms-ggd .ms-ggbr-ln>span:first-child{font-size:12.5px;color:#a3acb6}
.ms-ggd .ms-gv-soft,.ms-ggd .ms-ggb-soft,.ms-ggd .ms-gc-soft,.ms-ggd .ms-gx-soft,.ms-ggd .ms-grd-soft,.ms-ggd .ms-gv-blk,.ms-ggd .ms-gv-limit,.ms-ggd .ms-ggbr-list,.ms-ggd .ms-ggp-src,.ms-ggd .ms-gs-src{font-size:12.5px}
.ms-ggd .ms-gv-k,.ms-ggd .ms-gv-mx,.ms-ggd .ms-gx-chips>span,.ms-ggd .ms-ggl-chips>span,.ms-ggd .ms-gv-leg,.ms-ggd .ms-gs-more{font-size:12px}
.ms-ggd .ms-gv-scale>span,.ms-ggd .ms-gv-mx>.ms-gv-c,.ms-ggd .ms-gv-mx>.ms-gv-h,.ms-ggd .ms-gv-chip,.ms-ggd .ms-gs-chip,.ms-ggd .ms-gs-more>.ms-gs-k{font-size:10.5px}
.ms-ggd .ms-gv-gl{font-size:10.5px;height:14px}
.ms-ggd .ms-gv-rl{font-size:10.5px}
.ms-ggd .ms-ggb-big,.ms-ggd .ms-ggp-big,.ms-ggd .ms-ggs-big,.ms-ggd .ms-ggb-tbig{font-size:22px}
.ms-ggd .ms-gv-rate{font-size:18px}
.ms-ggd .ms-ggb-sec .ms-gv-rose,.ms-ggd .ms-ggb-sec .ms-gv-map,.ms-ggd .ms-ggb-sec .ms-gc-rose,.ms-ggd .ms-ggb-sec .ms-ggs-rose{flex-wrap:wrap}
.ms-ggd-f{flex:none;padding:6px 14px 7px;font-size:12px;color:#97a1ab;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center}
.ms-ggd-f .ms-ggd-k{min-width:17px;height:17px;font-size:10px;padding:0 3px;margin-right:3px}
.ms-ggd-page{margin-left:auto;display:inline-flex;align-items:center;gap:8px;color:#c9d1d9}
.ms-ggd-page[hidden]{display:none}
.ms-ggd-page b{color:#ffd27a;font-weight:650}
.ms-ggd-dots{display:inline-flex;gap:4px}
.ms-ggd-dots>i{width:7px;height:7px;border-radius:50%;background:#4a535e}
.ms-ggd-dots>i.ms-on{background:#ffd27a}
.ms-ggd-band.ms-more::after{content:"";position:absolute;top:12px;right:0;bottom:10px;width:42px;pointer-events:none;background:linear-gradient(90deg,rgba(27,31,37,0),#1b1f25 85%)}
/* The Legend tab. */
.ms-ggd .ms-ggl-strip{margin-top:0}
.ms-ggd .ms-ggl-list{margin-top:0;padding-top:0;border-top:0;max-height:none}
.ms-ggd .ms-ggl-keys{margin-top:0;padding-top:0;border-top:0;flex-direction:column;gap:6px}
.ms-ggd .ms-ggl-tcap:first-child{margin-top:0}
.ms-ggd-kv{display:grid;grid-template-columns:62px minmax(0,1fr);gap:3px 8px;font-size:12.5px;line-height:1.35}
.ms-ggd-kv>.k{color:#a3acb6;font-size:11.5px;padding-top:1px}
.ms-ggd-kv>.v{min-width:0;color:#e8ebee;overflow-wrap:anywhere}
.ms-ggd-kv b{color:#fff;font-weight:600}
.ms-ggd-modes{display:flex;flex-wrap:wrap;gap:6px}
.ms-ggd-mode{display:inline-flex;align-items:center;gap:7px;padding:6px 11px 6px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#c9d1d9;
  font:600 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer;white-space:nowrap}
.ms-ggd-mode:hover{background:rgba(255,255,255,.12);color:#fff}
.ms-ggd-mode:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-ggd-mode[aria-pressed="true"]{background:#8ec1ea;border-color:#8ec1ea;color:#1b1f25}
.ms-ggd-mode svg{flex:none;width:16px;height:16px}
.ms-ggd-modetag{margin-top:9px;font-size:13px;color:#a3acb6}
.ms-ggd-modetag b{color:#fff;font-size:14px}
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
.ms-ggd-swrow b{display:block;color:#fff;font-weight:600;font-size:13.5px}
.ms-ggd-swrow small{display:block;color:#a3acb6;font-size:12px;line-height:1.35}
.ms-ggd-range{display:flex;align-items:center;gap:8px;padding:0 0 8px 47px;font-size:12.5px;color:#a3acb6}
.ms-ggd-range input{flex:1;min-width:0;accent-color:#8ec1ea;margin:0}
.ms-ggd-range b{color:#fff;font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
.ms-ggd .ms-ggl-ramp>i{height:14px}
.ms-ggd .ms-ggl-ramp-l{font-size:12.5px;color:#c9d1d9}
.ms-ggd .ms-ggl-note{font-size:12.5px;margin-top:5px}
.ms-ggd .ms-ggl-tcap{font-size:11.5px}
.ms-ggd .ms-ggl-cap{font-size:11.5px}
.ms-ggd .ms-ggl-key small{font-size:12px}
@media (prefers-reduced-motion:no-preference){.ms-ggd-sw,.ms-ggd-sw::after{transition:background .15s,transform .15s}.ms-ggd-tab{transition:background .12s,color .12s}}
@media (max-width:720px){.ms-ggd{left:6px;right:6px;bottom:6px}.ms-ggd-band{height:clamp(200px,calc(70vh - 220px),460px)}
  .ms-ggd-sum{flex-wrap:wrap;padding:10px 12px;gap:8px 10px}.ms-ggd-for{width:100%;padding:0 0 8px;border-right:0;border-bottom:1px solid rgba(255,255,255,.1)}
  .ms-ggd-fact{flex-basis:120px;padding:0 10px}.ms-ggd-fact.ms-lead{flex-basis:130px}}
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
 * Who the ground is judged for, at the head of the strip (user, 2026-11-07: "nothing showing which layer / force type
 * data is being used ... he can make wrong decisions"): the mode with its icon, the echelon and how the mode was set
 * (by the symbol, or by hand with P, in amber), the season and light the going and speed are read for, and a warning
 * when the map overlay paints another mode.
 */
function forBlock(v: GroundGuideVerdict): HTMLElement {
  const box = el('div', 'ms-ggd-for');
  const m = el('div', 'ms-ggd-for-m');
  const ic = modeIcon(v.profile);
  ic.setAttribute('width', '18');
  ic.setAttribute('height', '18');
  m.append(ic, el('span', undefined, v.profileLabel));
  m.title = `Judged for ${v.profileLabel}`;
  const s = el('div', 'ms-ggd-for-s');
  const echelon = v.footprint?.echelon;
  if (echelon) s.append(`${titleCase(echelon)} · `);
  s.append(v.profileOverride ? el('span', 'ms-hand', 'Set by Hand (P)') : 'From the Symbol');
  box.append(m, s);
  const g = v.going;
  const when: string[] = [];
  if (g) when.push(`${g.season === 'wet' ? 'After Rain' : 'Dry'}${g.month ? `, ${monthName(g.month)}` : ''}`);
  if (v.speed) when.push(v.speed.light === 'night' ? 'Night' : 'Day');
  if (when.length) {
    const w = el('div', 'ms-ggd-for-s');
    if (g) w.append(seasonIcon(g.season, 12));
    w.append(when.join(' · '));
    box.append(w);
  }
  if (v.overlayOther) box.append(el('div', 'ms-ggd-for-w', `Map colours show ${v.overlayOther}`));
  return box;
}

export class GroundGuideDetail {
  private _el: HTMLDivElement | null = null;
  private _tabs = new Map<DetailTab, HTMLButtonElement>();
  private _meta: HTMLElement | null = null;
  private _sum: HTMLElement | null = null;
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

  /** Turn to the tab's next page. False when it is on its last page (the caller then closes the card). */
  nextPage(): boolean {
    if (!this.isShown || this._page + 1 >= this._pages) return false;
    this._page++;
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

  hide(): void {
    this._el?.classList.remove('ms-open');
    if (this._sum) this._sum.style.minHeight = '';
    this._page = 0;
  }

  destroy(): void {
    this._ro?.disconnect();
    this._ro = null;
    if (this._copyTimer !== null) clearTimeout(this._copyTimer);
    this._copyTimer = null;
    this._el?.remove();
    this._el = this._meta = this._sum = this._band = this._clip = this._flow = this._pageEl = null;
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
    for (const [k, t] of [['D', 'open / close'], ['G R O T B C', 'tabs'], ['K', 'legend'], ['Esc', 'close']] as const) {
      for (const kk of k.split(' ')) keys.append(el('span', 'ms-ggd-k', kk));
      keys.append(`${t}  `);
    }
    const page = el('span', 'ms-ggd-page');
    page.hidden = true;
    page.setAttribute('aria-live', 'polite');
    foot.append(keys, el('span', undefined, 'Dials and arrows turn with the map.'), page);
    root.append(head, sum, band, foot);
    ensureNorthCss();
    setNorthVar(root, this._north);
    document.body.appendChild(root);
    this._el = root;
    this._meta = meta;
    this._sum = sum;
    this._band = band;
    this._clip = clip;
    this._flow = flow;
    this._pageEl = page;
    this._copy = copy;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        if (clip.clientWidth === this._w) return;
        // A new width fits a different number of columns and facts: refit both.
        if (this._sum && !this._sum.hidden) {
          this._sum.style.minHeight = '';
          this._fitSummary();
        }
        this._paginate(true);
      });
      this._ro.observe(clip);
    }
    return root;
  }

  private _renderMeta(v: GroundGuideVerdict): void {
    const meta = this._meta;
    if (!meta) return;
    const dot = el('span', 'ms-ggd-dot');
    dot.style.background = verdictColor(v);
    meta.replaceChildren(dot, el('b', undefined, titleOf(v)));
    if (pendingOf(v)) meta.append(el('span', 'ms-ggd-upd', '· updating'));
  }

  /** The answer strip for the active tab: who it is judged for and its facts, or hidden (the Legend tab, or nothing yet). */
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
    sum.replaceChildren(forBlock(v), strip);
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
   * Lay the tiles out down the band's columns and count the pages. Every tile is set to the column width and
   * measured; each goes into the first column (on any page) with room for it, so a short tile fills the space under
   * a tall one; a column that is full opens the next, and the columns past the card's width make the next page. A
   * list taller than the band is split row by row and continues at the top of a later column. `keep`: stay on the
   * page shown (a rebuild as the cursor moves), else the first.
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
    const tiles = Array.from(flow.children).filter((k) => k.classList.contains('ms-ggb-sec')) as HTMLElement[];
    if (!tiles.length || W <= 0 || H <= 0) {
      this._pages = 1;
      this._page = 0;
      this._showPage(false);
      return;
    }
    const per = Math.max(1, Math.floor((W + COL_GAP) / (COL_MIN + COL_GAP)));
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
    const cols: Array<{ x: number; used: number }> = [];
    const colOf = new Map<HTMLElement, number>();
    const open = (): number => {
      const i = cols.length;
      cols.push({ x: Math.floor(i / per) * (W + COL_GAP) + (i % per) * (colW + COL_GAP), used: 0 });
      return i;
    };
    for (const { t, after } of items) {
      const h = t.offsetHeight;
      // A continuation goes after its list's column, never before it.
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
    // A hairline between neighbouring columns on each page.
    for (let i = 0; i < cols.length; i++) {
      if (i % per === 0 || cols[i].used === 0) continue;
      const r = el('div', 'ms-ggd-rule');
      r.style.left = `${Math.round(cols[i].x - COL_GAP / 2)}px`;
      flow.append(r);
    }
    this._pages = Math.max(1, Math.ceil(cols.length / per));
    this._page = keep ? Math.min(this._page, this._pages - 1) : 0;
    this._showPage(false);
    void flow.offsetWidth; // the jump to the kept page is not animated; a page turn is
    flow.style.transition = '';
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
    next.append(el('b', undefined, `Page ${this._page + 1} of ${this._pages}`), '  ', el('span', 'ms-ggd-k', key), more ? 'next page' : 'closes');
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
        const note = el('div', 'ms-ggd-note', roadDensityNote(d));
        note.style.background = DENSITY_COLOURS[d.lead.key][0];
        note.style.color = DENSITY_COLOURS[d.lead.key][1];
        out.push(tile('R', `Road Network Density · ${fmtRadius(d.radiusM)}`, densityGauge(d, 'both'), note));
        out.push(tile('R', 'Ways Out', densityRose(d, 'both')));
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
        const t = tile('O', 'Obstacles Near', near);
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
        row.append(speedRoseSvg(sp.rays, sp.rangeM, 120, 0), speedRoseLines(sp));
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
      row.append(speedRoseSvg(sp.rays, sp.rangeM, 120, 0), speedRoseLines(sp));
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
      if (way) out.push(tile('T', `${speedCaption(sp)} · To the Road`, ...way));
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
      two.append(radar(r, 104), ringList(r, [1, 2, 3, 5, 10]));
      out.push(tile('B', `People · ${r.radiusKm} km`, two, densityScale(r.cls), populationLine('Density', populationChip(r.cls), ` ${fmtPeople(r.perKm2)} per km² within ${r.radiusKm} km`)));
      out.push(tile('B', 'People by Direction', populationRose(r)));
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
      if (list) out.push(listTile('B', 'Buildings, Huts & Services', list));
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
    const mode = [needLine(c, v.profileLabel), bankLine(c), localLine(c), aroundLine(c), c.classLabel ? soft(`Ground here: ${c.classLabel}`) : null].filter((x): x is HTMLElement => !!x);
    if (mode.length) out.push(tile('C', `For ${v.profileLabel}`, ...mode));
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
      const t = tile('L', `Ground for ${cur.label}`, p.list);
      t.classList.add('ms-ggd-brk');
      out.push(t);
    }

    // Keys.
    const keys = legendEl('ms-ggl-keys');
    if (p.keyP) keys.append(p.keyP);
    if (p.keyS) keys.append(p.keyS);
    keys.append(
      legendKeyRow('D', 'Ground Detail', 'Opens and Closes This Card'),
      legendKeyRow('G', 'Tabs', 'G R O T B C, One Letter a Tab; Again for the Next Page'),
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
