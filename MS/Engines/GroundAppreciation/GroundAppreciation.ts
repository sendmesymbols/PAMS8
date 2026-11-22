/**
 * GroundAppreciation.ts
 *
 * The appreciation of the situation, drafted from the map and written out (user, 22 Nov 2026; Appreciation_Plan.md).
 * Off by default (`features.groundAppreciation`); the top bar's Aprc button turns it on and opens the sheet.
 *
 *   reading   Read takes the ground through the Ground Guide (its Gr Scope AOR reading round the VG symbol, the selected
 *             symbol or the map centre, with the sections, cover and sight readings at the MITG and on each approach),
 *             the symbols on the map (en and own by echelon and place, obstacle symbols) and the last Check my plan;
 *   model     AprcModel: every heading of the appreciation; a paragraph is drafted from the ground (GR), read from the
 *             map (MAP), proposed for the planner's judgement (YOU JUDGE) or left to him as a ruled line (YOURS);
 *   the sheet outline, the page as it prints, and what the selected paragraph rests on; a paragraph the planner writes
 *             is his and is never overwritten, a proposal prints in the fair copy only once accepted;
 *   output    Word (.docx, zipped with the JSZip of the PowerPoint bundle: no new dependency), PDF through print, text,
 *             JSON, and slides in the Briefing module (full brief, decision brief, sand model).
 *
 * It reads the terrain bundle only through the Ground Guide, and only when Read is pressed (claude_rules.md): with the
 * guide off or no bundle the sheet still opens, takes the planner's words and exports; the Gr paragraphs stay ruled.
 */

import EngineLogger from '../../Support/EngineLogger';
import { ensureTokensCss } from '../GroundGuide/GroundGuideTokens';
import { aorMapSvg, type AorFrame } from '../GroundGuide/GroundGuideScopeAor';
import type { AorReading, AorSide, AorXY } from '../GroundGuide/GroundGuideAor';
import { dockBelowBar } from '../SiteScan/SitePanel';
import { shortDate, sourceName } from '../SiteScan/SiteScan';
import {
  accept, acceptAll, addRow, applyPatches, aprcKinds, carryOver, counts, find, isStale, lines, newDoc, numberOf, setCell, setMine, shown, tableOf, toText, walk,
  type AprcCopy, type AprcDoc, type AprcFigure, type AprcKind, type AprcPara,
} from './AprcModel';
import {
  lightTimes, parseHHour, writeCoyTasks, writeEnemy, writeGround, writePlan, writeStrength, writeSymbols, writeTasks, writeTimeReq,
  type AprcAvenueIn, type AprcCheckIn, type AprcCoyIn, type AprcEnemyIn, type AprcForceUnit, type AprcGroundIn, type AprcObsn, type AprcStrengthIn, type AprcSymbolIn, type AprcTimeIn,
} from './AprcWrite';
import { APRC_DOC_CSS, bodyHtml, esc, printHtml } from './AprcHtml';
import { DOCX_MIME, docxFiles, type DocxImage } from './AprcDocx';
import { APRC_DECKS, buildDeck, mergeDeck, type AprcDeckKind } from './AprcDeck';

const ENGINE = 'Aprc';
const PANEL_ID = 'ms-aprc-panel';
const STORE = 'pams8.aprc.v1';
/** Which side panels are folded: a viewer's convenience, kept in this browser only. */
const UI_STORE = 'pams8.aprc.ui.v1';
/** Panel sizes a drag may give (px): the outline and the paragraph panel across, the paragraph panel down on a narrow sheet; the page keeps PAGE_MIN. */
const SIZE = { out: [180, 460], rt: [260, 640], rows: [110, 140] } as const;
const PAGE_MIN = 360;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const R = 6378137;

export interface GroundAppreciationOptions {
  kind: AprcKind;
  copy: AprcCopy;
  /** Figures in the document: the vector trace, a shot of the live map, or both. */
  figures: 'both' | 'trace' | 'map';
  deck: AprcDeckKind;
  /** Read the sight along each approach for its Obsn head (the Extended View's reading; a few seconds more). */
  obsn: boolean;
  echelon: 'auto' | 'coy' | 'bn' | 'bde';
  /** Mode the going is read for; `auto` takes the Gr Scope AOR setting. */
  mover: string;
  /** Keep the document in the browser between sessions. */
  keep: boolean;
  /** H as a clock time on D Day ("HH:MM"): clock times beside H+ in the en's options; empty takes the Ground Guide's IPB H. */
  hHour: string;
  /** Where the ORBAT is served (relative strength, Pls held, the engineers' mine laying). */
  orbatUrl: string;
}

export const DEFAULT_GROUND_APPRECIATION_OPTIONS: GroundAppreciationOptions = {
  kind: 'def',
  copy: 'draft',
  figures: 'both',
  deck: 'full',
  obsn: true,
  echelon: 'auto',
  mover: 'auto',
  keep: true,
  hHour: '',
  orbatUrl: '/MS/Data/Orbat/PK',
};

export interface GroundAppreciationHost {
  /** The Ground Guide, or null while it is off. */
  guide?: () => any | null;
  turnOnGuide?: () => void;
  selected?: () => any[];
  /** The symbols on the map as plan records (SerializationEngine.planRecordsOf). */
  records?: () => Array<{ id: string; drawEss: any; attrs?: Record<string, any> }>;
  threat?: () => [number, number] | null;
  /** The last Check my plan report of the Intelligent Deployment tab, or null. */
  planCheck?: () => any | null;
  briefing?: () => any | null;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (dx: number, dy: number): string => COMPASS[Math.round((((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360) / 45) % 8];
const mercToLngLat = (x: number, y: number): [number, number] => [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

// ── the sheet's look ─────────────────────────────────────────────────────────────────────────────────────────────
// Dark chrome from the Ground Guide tokens round a paper page (the page is what prints). Every paragraph state carries a
// shape and a word besides its colour. Redesigned 22 Nov 2026: header with Read / Export / More, the copy and H over
// the page, progress and filters over the outline, the paragraph's actions in the inspector, messages as a toast.

const P = `#${PANEL_ID}`;
const STYLE = `
${P}{--ap-bg:var(--gg-card,#1b1f25);--ap-pane:var(--gg-strip,#20262e);--ap-head:var(--gg-head,#262d36);--ap-desk:#12161a;--ap-field:#12161b;--ap-pop:#262e38;
 --ap-tx:var(--gg-text,#f1f3f6);--ap-strong:var(--gg-strong,#fff);--ap-label:var(--gg-label,#c3cbd3);--ap-soft:#9ba6b1;
 --ap-hair:var(--gg-hair,rgba(255,255,255,.14));--ap-hair-soft:var(--gg-hair-soft,rgba(255,255,255,.1));--ap-edge:#3d4650;
 --ap-accent:var(--gg-accent,#8ec1ea);--ap-accent-bg:rgba(142,193,234,.15);--ap-on-accent:#0d1620;
 --ap-gr:oklch(.8 .14 158);--ap-map:oklch(.78 .11 252);--ap-judge:oklch(.86 .13 85);--ap-written:oklch(.78 .12 300);--ap-yours:oklch(.76 .012 250);--ap-stale:oklch(.72 .17 25);
 position:fixed;left:50%;transform:translateX(-50%);top:118px;z-index:2147482806;width:min(1280px,calc(100vw - 20px));height:calc(100vh - 140px);display:none;flex-direction:column;
 background:var(--ap-bg);color:var(--ap-tx);border:1px solid var(--ap-hair);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.55);font:13.5px/1.4 system-ui,"Segoe UI",Arial,sans-serif;outline:none}
${P}.ms-open{display:flex}
${P}.win-max{inset:0;width:auto;height:auto;transform:none;border:0;border-radius:0;box-shadow:none}
${P}.win-max .ap-head{border-radius:0}
${P}.win-min{top:auto;bottom:14px;height:auto;width:min(600px,calc(100vw - 20px))}
${P}.win-min>:not(.ap-head):not(.ap-busy):not(.ap-toast){display:none!important}
${P}.win-min .ap-head{border-radius:12px;border-bottom:0;cursor:grab;touch-action:none}
${P}.win-min.dragging{user-select:none;box-shadow:0 18px 44px rgba(0,0,0,.6)}
${P}.win-min.dragging .ap-head{cursor:grabbing}
${P}.win-min .ap-head :is(.ap-select,[data-a="menu"],[data-a="read"]){display:none}
${P}.win-min .ap-toast{bottom:calc(100% + 10px)}
${P}.win-min.toast-below .ap-toast{bottom:auto;top:calc(100% + 10px)}
${P} .ap-minprog{display:none;flex:none;color:var(--ap-label);font-size:12.5px;font-variant-numeric:tabular-nums}
${P} .ap-minprog b{color:var(--ap-strong);font-weight:700}
${P}.win-min .ap-minprog{display:inline}
${P} .ap-wsep{flex:none;width:1px;height:18px;margin:0 2px;background:var(--ap-hair)}
${P}{color-scheme:dark;scrollbar-color:rgba(255,255,255,.2) transparent}
${P} *{scrollbar-width:thin}
${P} :is(.ap-list,.ap-page,.ap-rt-body,.ap-tblw,textarea):hover{scrollbar-color:rgba(255,255,255,.36) transparent}
${P} ::-webkit-scrollbar{width:10px;height:10px}
${P} ::-webkit-scrollbar-track,${P} ::-webkit-scrollbar-corner{background:transparent}
${P} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);background-clip:padding-box;border:2px solid transparent;border-radius:8px}
${P} ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.38);background-clip:padding-box}
${P} ::-webkit-scrollbar-button{display:none}
${P} *{box-sizing:border-box}
${P} button,${P} select,${P} input,${P} textarea{font:inherit;color:inherit}
${P} [hidden]{display:none!important}
${P} .sp{flex:1}
${P} .ap-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
${P} svg{flex:none}
${P} kbd{display:inline-block;min-width:18px;padding:1px 5px;border:1px solid var(--ap-hair);border-bottom-width:2px;border-radius:4px;background:rgba(255,255,255,.05);font:600 11.5px/1.3 ui-monospace,Consolas,monospace;color:var(--ap-label);text-align:center}

${P} .ap-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:var(--ap-tx);font-weight:600;font-size:13px;line-height:1;cursor:pointer;white-space:nowrap;transition:background-color .15s ease-out,border-color .15s ease-out,color .15s ease-out}
${P} .ap-btn:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.24);color:var(--ap-strong)}
${P} .ap-btn:active{background:rgba(255,255,255,.17)}
${P} .ap-btn.pri{background:var(--ap-accent);border-color:var(--ap-accent);color:var(--ap-on-accent)}
${P} .ap-btn.pri:hover{background:#a9d1f0;border-color:#a9d1f0;color:var(--ap-on-accent)}
${P} .ap-btn.ghost{background:none;border-color:transparent}
${P} .ap-btn.ghost:hover{background:rgba(255,255,255,.08)}
${P} .ap-btn.icon{width:30px;padding:0}
${P} .ap-btn.sm{height:26px;padding:0 9px;font-size:12.5px}
${P} .ap-btn.icon.sm{width:26px;padding:0}
${P} .ap-btn[disabled]{opacity:.42;cursor:default;pointer-events:none}
${P} .ap-btn kbd{border-color:currentColor;color:inherit;background:none;opacity:.7;font-size:11px;padding:0 4px}
${P} .ap-btn[aria-expanded=true]{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.26)}
${P} :is(button,select,input,textarea,[tabindex]):focus-visible{outline:2px solid var(--ap-accent);outline-offset:2px}
${P} .ap-select{height:28px;padding:0 26px 0 9px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:var(--ap-field) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23c3cbd3' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 9px center;appearance:none;font-size:13px;font-weight:600;cursor:pointer}

${P} .ap-head{flex:none;position:relative;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 16px;background:var(--ap-head);border-bottom:1px solid var(--ap-hair-soft);border-radius:12px 12px 0 0}
${P} .ap-ttl{font-size:16px;font-weight:750;color:var(--ap-strong);letter-spacing:.01em}
${P} .ap-frame{flex:1;min-width:0;margin-left:6px;color:var(--ap-label);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${P} .ap-frame>span+span::before{content:"·";margin:0 7px;color:var(--ap-soft)}
${P} .ap-frame .ap-fr-at{color:var(--ap-soft)}
${P} .ap-frame .ap-fr-none{color:var(--ap-soft)}
${P} .ap-head .ap-btn{flex:none}
${P} .ap-spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ap-rot .8s linear infinite}
@keyframes ap-rot{to{transform:rotate(360deg)}}
${P} .ap-busy{flex:none;height:2px;position:relative;overflow:hidden;background:transparent}
${P} .ap-busy.on{background:rgba(142,193,234,.18)}
${P} .ap-busy.on i{position:absolute;inset:0 auto 0 0;width:30%;background:var(--ap-accent);animation:ap-slide 1.3s cubic-bezier(.25,1,.5,1) infinite}
@keyframes ap-slide{from{transform:translateX(-100%)}to{transform:translateX(340%)}}

${P} .ap-note{flex:none;display:none;align-items:center;gap:10px;margin:10px 12px 0;padding:8px 10px 8px 12px;border-radius:8px;border:1px solid rgba(255,210,122,.35);background:rgba(255,210,122,.09);color:#ffe2a6;font-size:13px}
${P} .ap-note.on{display:flex}
${P} .ap-note .ap-note-t{flex:1;min-width:0}

${P} .ap-grid{--ap-wo:var(--ap-wo-user,256px);--ap-wr:var(--ap-wr-user,352px);flex:1;min-height:0;position:relative;display:grid;grid-template-columns:var(--ap-wo) minmax(0,1fr) var(--ap-wr)}
${P} .ap-grid.no-out{--ap-wo:40px}${P} .ap-grid.no-rt{--ap-wr:40px}
${P} .ap-rz{position:absolute;z-index:6;top:0;bottom:0;width:10px;margin-left:-5px;cursor:col-resize;touch-action:none;outline:none}
${P} .ap-rz::after{content:"";position:absolute;top:0;bottom:0;left:4px;width:2px;border-radius:1px;background:transparent;transition:background-color .15s ease-out .08s}
${P} .ap-rz:hover::after,${P} .ap-rz.on::after{background:var(--ap-accent)}
${P} .ap-rz:focus-visible::after{background:var(--ap-accent);box-shadow:0 0 0 2px rgba(142,193,234,.35)}
${P} .ap-rz-out{left:var(--ap-wo)}${P} .ap-rz-rt{left:calc(100% - var(--ap-wr))}
${P} .ap-grid.no-out .ap-rz-out,${P} .ap-grid.no-rt .ap-rz-rt{display:none}
${P} .ap-grid.resizing{cursor:col-resize;user-select:none}${P} .ap-grid.resizing.rows{cursor:row-resize}
${P} .ap-grid.resizing>:not(.ap-rz){pointer-events:none}
${P} .ap-rail{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;height:100%;padding:12px 0;border:0;background:none;color:var(--ap-label);cursor:pointer;font-size:12.5px;font-weight:650;transition:background-color .15s ease-out,color .15s ease-out}
${P} .ap-rail:hover{background:rgba(255,255,255,.05);color:var(--ap-strong)}
${P} .ap-rail .v{writing-mode:vertical-rl;white-space:nowrap}
${P} .ap-rail b{min-width:22px;height:20px;padding:0 6px;border-radius:10px;background:var(--ap-accent-bg);color:var(--ap-accent);font-size:11.5px;line-height:20px;text-align:center;font-variant-numeric:tabular-nums}
${P} .ap-pane-btn.folded{color:var(--ap-accent)}

${P} .ap-out{display:flex;flex-direction:column;min-height:0;background:var(--ap-pane);border-right:1px solid var(--ap-hair-soft)}
${P} .ap-prog{flex:none;padding:14px 14px 12px;border-bottom:1px solid var(--ap-hair-soft)}
${P} .ap-prog-h{display:flex;align-items:baseline;gap:6px;margin-bottom:8px}
${P} .ap-prog-h b{font-size:20px;font-weight:750;color:var(--ap-strong);font-variant-numeric:tabular-nums}
${P} .ap-prog-h span{color:var(--ap-label);font-size:13px}
${P} .ap-bar{display:flex;gap:1px;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.07)}
${P} .ap-bar i{display:block;min-width:2px}
${P} .ap-bar .b-written{background:var(--ap-written)}${P} .ap-bar .b-stale{background:var(--ap-stale)}${P} .ap-bar .b-accepted{background:var(--ap-judge)}
${P} .ap-bar .b-gr{background:var(--ap-gr)}${P} .ap-bar .b-map{background:var(--ap-map)}
${P} .ap-bar .b-open{background:repeating-linear-gradient(135deg,var(--ap-judge) 0 3px,transparent 3px 6px)}
${P} .ap-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
${P} .ap-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--ap-hair);background:none;color:var(--ap-label);font-size:12.5px;font-weight:600;cursor:pointer;transition:background-color .15s ease-out,border-color .15s ease-out}
${P} .ap-chip:hover{background:rgba(255,255,255,.07);color:var(--ap-strong)}
${P} .ap-chip b{font-weight:650;color:var(--ap-soft);font-variant-numeric:tabular-nums}
${P} .ap-chip[aria-pressed=true]{background:var(--ap-accent-bg);border-color:var(--ap-accent);color:var(--ap-strong)}
${P} .ap-chip[aria-pressed=true] b{color:var(--ap-accent)}
${P} .ap-prog .ap-btn{margin-top:10px;width:100%}
${P} .ap-list{flex:1;min-height:0;overflow:auto;padding:4px 8px 16px}
${P} .ap-ph{padding:14px 8px 4px;font-size:13px;font-weight:700;color:var(--ap-strong)}
${P} .ap-gh{padding:8px 8px 2px;font-size:12.5px;font-weight:600;color:var(--ap-soft)}
${P} .ap-it{display:grid;grid-template-columns:16px 28px minmax(0,1fr) auto;align-items:center;gap:6px;width:100%;min-height:30px;padding:4px 8px;border:0;border-radius:6px;background:none;color:var(--ap-tx);text-align:left;cursor:pointer;font-size:13.5px;transition:background-color .12s ease-out}
${P} .ap-it:hover{background:rgba(255,255,255,.06)}
${P} .ap-it.sel{background:var(--ap-accent-bg);color:var(--ap-strong)}
${P} .ap-it.sel .ap-no{color:var(--ap-accent)}
${P} .ap-it .ap-no{color:var(--ap-soft);font-variant-numeric:tabular-nums;font-size:13px}
${P} .ap-it .ap-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${P} .ap-it .ap-ct{min-width:20px;height:18px;padding:0 6px;border-radius:9px;background:rgba(255,255,255,.09);color:var(--ap-label);font-size:11.5px;font-weight:650;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
${P} .ap-empty{padding:18px 10px;color:var(--ap-soft);font-size:13px;line-height:1.5}
${P} .ap-ic{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}
${P} .st-gr{color:var(--ap-gr)}${P} .st-map{color:var(--ap-map)}${P} .st-open,${P} .st-accepted{color:var(--ap-judge)}
${P} .st-yours{color:var(--ap-yours)}${P} .st-written{color:var(--ap-written)}${P} .st-stale{color:var(--ap-stale)}

${P} .ap-mid{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--ap-desk);container:ap-page/inline-size}
${P} .ap-ptool{flex:none;display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--ap-hair-soft);background:var(--ap-bg)}
${P} .ap-seg{flex:none;display:inline-flex;padding:2px;border-radius:8px;background:var(--ap-field);border:1px solid rgba(255,255,255,.1)}
${P} .ap-seg button{height:26px;padding:0 12px;border:0;border-radius:6px;background:none;color:var(--ap-label);font-size:13px;font-weight:600;cursor:pointer;transition:background-color .15s ease-out,color .15s ease-out}
${P} .ap-seg button:hover{color:var(--ap-strong)}
${P} .ap-seg button[aria-pressed=true]{background:#3a4553;color:var(--ap-strong);box-shadow:0 1px 2px rgba(0,0,0,.35)}
${P} .ap-hint-copy{flex:0 1 auto;color:var(--ap-soft);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
${P} .ap-seg button{white-space:nowrap}
${P} .ap-ptool .ap-btn{flex:none}
${P} .ap-ptool .sp{min-width:0}
@container ap-page (max-width:560px){${P} .ap-hint-copy{display:none}}
${P} .ap-hfield{flex:none;display:inline-flex;align-items:center;gap:8px;color:var(--ap-label);font-size:13px;white-space:nowrap}
${P} .ap-hfield input{width:70px;height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--ap-edge);background:var(--ap-field);color:var(--ap-tx);font-size:13px;font-variant-numeric:tabular-nums}
${P} .ap-hfield input:focus{border-color:var(--ap-accent)}
${P} .ap-page{flex:1;min-height:0;overflow:auto;padding:20px 18px 48px}
${P} .ap-page .aprc-doc{max-width:800px;margin:0 auto;padding:clamp(22px,6%,40px) clamp(18px,6%,46px) 40px clamp(22px,7%,56px);border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,.4),0 8px 28px rgba(0,0,0,.35);font-size:10.5pt}
${P} .ap-page .ap-rule.long{min-width:min(22em,100%)}
${P} .ap-page .ap-addr{max-width:100%}
${P} .ap-page .ap-p{cursor:pointer;border-radius:2px;transition:background-color .12s ease-out}
${P} .ap-page .ap-p:hover{background:#eef4fb;box-shadow:0 0 0 4px #eef4fb}
${P} .ap-page .ap-p.sel{background:#fff1bf;box-shadow:0 0 0 4px #fff1bf,0 0 0 5.5px #d39e12}

${P} .ap-rt{display:flex;flex-direction:column;min-height:0;background:var(--ap-pane);border-left:1px solid var(--ap-hair-soft)}
${P} .ap-rt-nav{flex:none;display:flex;align-items:center;gap:4px;padding:8px 10px;border-bottom:1px solid var(--ap-hair-soft)}
${P} .ap-rt-no{margin:0 6px;font-weight:650;color:var(--ap-label);font-variant-numeric:tabular-nums}
${P} .ap-rt-nav .ap-btn b{font-variant-numeric:tabular-nums;color:var(--ap-accent)}
${P} .ap-rt-body{flex:1;min-height:0;overflow:auto;padding:16px 16px 24px}
${P} .ap-rt-h{margin:0 0 10px;font-size:16px;line-height:1.3;font-weight:700;color:var(--ap-strong)}
${P} .ap-rt-h .ap-rt-n{color:var(--ap-soft);font-weight:650;margin-right:6px;font-variant-numeric:tabular-nums}
${P} .ap-badge{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px 0 8px;border-radius:13px;font-size:12.5px;font-weight:650;background:rgba(255,255,255,.07);background:color-mix(in oklch,currentColor 15%,transparent)}
${P} .ap-badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
${P} .ap-lead{margin:0 0 12px;color:var(--ap-label);font-size:13px;line-height:1.5}
${P} .ap-call{margin:0 0 14px;padding:11px 12px;border-radius:8px;border:1px solid;font-size:13px;line-height:1.5}
${P} .ap-call p{margin:4px 0 0;color:var(--ap-label)}
${P} .ap-call-t{display:flex;align-items:center;gap:7px;font-weight:700;color:var(--ap-strong)}
${P} .ap-call.judge{border-color:rgba(255,210,122,.4);background:rgba(255,210,122,.08)}
${P} .ap-call.judge .ap-call-t svg{color:var(--ap-judge)}
${P} .ap-call.stale{border-color:rgba(255,120,120,.45);background:rgba(229,72,77,.1)}
${P} .ap-call.stale .ap-call-t svg{color:var(--ap-stale)}
${P} .ap-call.done{display:flex;align-items:center;gap:8px;border-color:var(--ap-hair);background:rgba(255,255,255,.04);color:var(--ap-label)}
${P} .ap-call.done svg{color:var(--ap-judge)}
${P} .ap-quote{margin-top:8px;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,.25);color:var(--ap-tx);white-space:pre-wrap}
${P} .ap-acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
${P} .ap-ed-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
${P} .ap-ed-h label{font-size:13px;font-weight:650;color:var(--ap-label)}
${P} .ap-dirty{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#ffd27a}
${P} .ap-dirty::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
${P} .ap-ed textarea{display:block;width:100%;min-height:150px;max-height:52vh;resize:vertical;padding:9px 11px;border-radius:8px;border:1px solid var(--ap-edge);background:var(--ap-field);color:var(--ap-tx);font-size:13.5px;line-height:1.5}
${P} .ap-ed.small textarea{min-height:72px}
${P} .ap-ed textarea:focus{border-color:var(--ap-accent);outline:none;box-shadow:0 0 0 3px rgba(142,193,234,.18)}
${P} .ap-ed textarea::placeholder{color:#7f8a95}
${P} .ap-kh{color:var(--ap-soft);font-size:12px}
${P} .ap-sec{margin-top:20px}
${P} .ap-sec h5{margin:0 0 6px;font-size:13px;font-weight:700;color:var(--ap-strong)}
${P} .ap-sec .ap-mut{margin:0 0 8px;color:var(--ap-soft);font-size:12.5px;line-height:1.45}
${P} .ap-sec ul{margin:0;padding-left:18px}
${P} .ap-sec li{margin:5px 0;line-height:1.45}
${P} .ap-sec li::marker{color:var(--ap-soft)}
${P} .ap-tag{display:inline-block;margin-right:6px;padding:0 6px;border-radius:4px;background:rgba(255,255,255,.08);color:var(--ap-label);font-size:11.5px;font-weight:650;line-height:18px}
${P} .ap-kids .ap-it{grid-template-columns:16px 40px minmax(0,1fr)}
${P} .ap-tblw{overflow-x:auto;margin:0 -2px}
${P} .ap-tbl{width:100%;border-collapse:separate;border-spacing:2px;table-layout:fixed}
${P} .ap-tbl th{padding:2px 4px;text-align:left;color:var(--ap-soft);font-size:12px;font-weight:650;vertical-align:bottom}
${P} .ap-tbl input{width:100%;height:28px;padding:0 6px;border-radius:5px;border:1px solid var(--ap-edge);background:var(--ap-field);color:var(--ap-tx);font-size:12.5px}
${P} .ap-tbl input:focus{border-color:var(--ap-accent);outline:none}
${P} .ap-tbl input.mine{border-color:var(--ap-written);background:rgba(183,156,240,.08)}
${P} .ap-steps{margin:0 0 4px;padding:0;list-style:none;counter-reset:s}
${P} .ap-steps li{position:relative;margin:0 0 14px;padding-left:34px;line-height:1.5;color:var(--ap-label);counter-increment:s}
${P} .ap-steps li::before{content:counter(s);position:absolute;left:0;top:-1px;width:24px;height:24px;border-radius:50%;border:1.5px solid var(--ap-hair);color:var(--ap-strong);font-weight:700;font-size:12.5px;line-height:21px;text-align:center}
${P} .ap-steps li.done::before{content:"✓";background:var(--ap-accent);border-color:var(--ap-accent);color:var(--ap-on-accent)}
${P} .ap-steps li b{color:var(--ap-strong)}
${P} .ap-steps .ap-btn{margin-top:8px}
${P} .ap-legend{list-style:none;padding:0!important;margin:0}
${P} .ap-legend li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:4px;align-items:start;margin:6px 0!important}
${P} .ap-legend li .ap-ic{margin-top:2px}
${P} .ap-legend b{color:var(--ap-tx);font-weight:650}
${P} .ap-legend span.d{color:var(--ap-soft)}
${P} .ap-keys{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;margin:0;align-items:center;font-size:13px}
${P} .ap-keys dt{white-space:nowrap}
${P} .ap-keys dd{margin:0;color:var(--ap-label)}

${P} .ap-menu{position:absolute;z-index:30;min-width:270px;max-width:340px;padding:6px;border-radius:10px;border:1px solid var(--ap-hair);background:var(--ap-pop);box-shadow:0 14px 34px rgba(0,0,0,.55)}
${P} .ap-ml{padding:8px 10px 4px;color:var(--ap-soft);font-size:12px;font-weight:650}
${P} .ap-mi{display:block;width:100%;padding:7px 10px;border:0;border-radius:6px;background:none;color:var(--ap-tx);text-align:left;cursor:pointer;font-size:13.5px;font-weight:600;line-height:1.3}
${P} .ap-mi small{display:block;margin-top:2px;color:var(--ap-soft);font-size:12px;font-weight:400}
${P} .ap-mi:hover,${P} .ap-mi:focus-visible{background:rgba(255,255,255,.09);outline:none}
${P} .ap-mi .ap-last{margin-left:6px;padding:0 6px;border-radius:4px;background:var(--ap-accent-bg);color:var(--ap-accent);font-size:11px;font-weight:650}
${P} .ap-mi.danger{color:#ff9a9c}
${P} .ap-mi.danger.armed{background:rgba(229,72,77,.22);color:#ffd2d3}
${P} .ap-msep{height:1px;margin:6px 4px;background:var(--ap-hair-soft)}

${P} .ap-toast{position:absolute;left:50%;bottom:18px;z-index:40;display:flex;align-items:center;gap:9px;max-width:min(580px,calc(100% - 32px));padding:10px 14px;border-radius:9px;border:1px solid var(--ap-hair);background:#2c3540;color:var(--ap-strong);font-size:13.5px;box-shadow:0 10px 28px rgba(0,0,0,.5);opacity:0;transform:translate(-50%,8px);pointer-events:none;transition:opacity .2s cubic-bezier(.25,1,.5,1),transform .2s cubic-bezier(.25,1,.5,1)}
${P} .ap-toast.on{opacity:1;transform:translate(-50%,0)}
${P} .ap-toast svg{color:var(--ap-gr)}
${P} .ap-toast.err{background:#3d2427;border-color:rgba(255,120,120,.45)}
${P} .ap-toast.err svg{color:var(--ap-stale)}

@media (max-width:1180px){${P} .ap-grid{--ap-wo:var(--ap-wo-user,224px);--ap-wr:var(--ap-wr-user,312px)}${P} .ap-hint-copy{display:none}}
@media (max-width:940px){
 ${P} .ap-grid,${P} .ap-grid.no-out{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(140px,1fr) var(--ap-hr-user,minmax(0,.8fr))}
 ${P} .ap-rz-out{display:none}
 ${P} .ap-rz-rt{left:0;right:0;bottom:auto;width:auto;height:10px;margin:-5px 0 0;cursor:row-resize}
 ${P} .ap-rz-rt::after{left:0;right:0;top:4px;bottom:auto;width:auto;height:2px}
 ${P} .ap-grid.no-rt{grid-template-rows:minmax(0,1fr) auto}
 ${P} .ap-rt .ap-rail{flex-direction:row;height:40px;padding:0 14px}
 ${P} .ap-rt .ap-rail .v{writing-mode:horizontal-tb}
 ${P} .ap-out{display:none;position:absolute;z-index:20;left:0;top:0;bottom:0;width:min(300px,86%);box-shadow:12px 0 30px rgba(0,0,0,.45)}
 ${P} .ap-grid.out-open .ap-out{display:flex}
 ${P} .ap-rt{border-left:0;border-top:1px solid var(--ap-hair)}
 ${P} .ap-ed textarea{min-height:96px}
}
@media (max-width:720px){${P} .ap-frame{display:none}${P} .ap-head .ap-select{margin-right:auto}}
@media (prefers-reduced-motion:reduce){${P} *,${P} *::before,${P} *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}${P} .ap-busy.on i{width:100%;transform:none}}
${APRC_DOC_CSS}
${P} .ap-page .aprc-doc{font-size:10.5pt}
`;

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-aprc-css';
  st.textContent = STYLE;
  document.head.appendChild(st);
}

/**
 * Where a paragraph stands for the planner. `head`: a heading whose sub-paragraphs carry the words (not counted);
 * the three to do: `stale` (his words, the Gr changed under them), `yours` (prints a ruled line), `open` (a proposal
 * not yet taken); the rest print as they are.
 */
type ParaStatus = 'head' | 'stale' | 'yours' | 'open' | 'accepted' | 'written' | 'gr' | 'map';
const TODO: ReadonlySet<ParaStatus> = new Set(['stale', 'yours', 'open']);
/** Worst first: the outline shows the worst state under a paragraph. */
const WORST: ParaStatus[] = ['stale', 'yours', 'open', 'map', 'gr', 'accepted', 'written', 'head'];

function statusOf(p: AprcPara): ParaStatus {
  if (p.mine) return isStale(p) ? 'stale' : 'written';
  if (p.draft === '' && !p.table) return 'head';
  if (p.draft === null && !p.table) return 'yours';
  if (p.state === 'judge') return p.accepted ? 'accepted' : 'open';
  if (p.state === 'yours') return p.cells ? 'written' : 'yours';
  return p.state;
}

const WORD: Record<ParaStatus, string> = {
  head: 'Heading',
  stale: 'Gr changed since you wrote it',
  yours: 'Yours to write',
  open: 'Proposal: you judge',
  accepted: 'Proposal accepted',
  written: 'Written by you',
  gr: 'Drafted from Gr',
  map: 'From the map',
};
const MEANS: Array<[ParaStatus, string]> = [
  ['written', 'Read never changes it.'],
  ['gr', 'Prints as it stands; edit it to make it yours.'],
  ['map', 'Read from the symbols and Check my plan.'],
  ['open', 'Prints in the fair copy once you accept it.'],
  ['accepted', 'Prints as it stands.'],
  ['yours', 'Prints a ruled line until you write it.'],
  ['stale', 'Look again: keep yours or take the new reading.'],
];

const svg = (body: string, size = 14): string => `<svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">${body}</svg>`;
const ICON: Record<ParaStatus, string> = {
  head: '',
  gr: svg('<circle cx="7" cy="7" r="5" fill="currentColor"/>'),
  map: svg('<rect x="2.3" y="2.3" width="9.4" height="9.4" rx="2" fill="currentColor"/>'),
  open: svg('<path d="M7 1.7 12.3 7 7 12.3 1.7 7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
  accepted: svg('<path d="M7 1.4 12.6 7 7 12.6 1.4 7Z" fill="currentColor"/>'),
  yours: svg('<circle cx="7" cy="7" r="4.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.4 1.9"/>'),
  written: svg('<path d="M2.4 7.4 5.6 10.4 11.6 3.7" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>'),
  stale: svg('<circle cx="7" cy="7" r="6.2" fill="currentColor"/><path d="M7 3.5v4.3M7 10.2v.2" stroke="#1b1f25" stroke-width="1.9" stroke-linecap="round"/>'),
};
const ico = (s: ParaStatus): string => `<span class="ap-ic st-${s}">${ICON[s]}</span>`;
const UI = {
  read: '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1M13.6 1.8v3.1h-3.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  caret: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="12.5" cy="8" r="1.5" fill="currentColor"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  prev: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 8.8 7 5.3l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 5.2 7 8.7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  min: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  max: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  restore: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.8" y="5.6" width="7.6" height="7.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 5.4V4.2c0-.8.6-1.4 1.4-1.4h4.8c.8 0 1.4.6 1.4 1.4V9c0 .8-.6 1.4-1.4 1.4h-1.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11V3.8M4.9 6.8 8 3.7l3.1 3.1M3.2 13.2h9.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  paneL: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 2.8v10.4" stroke="currentColor" stroke-width="1.5"/></svg>',
  paneR: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.8v10.4" stroke="currentColor" stroke-width="1.5"/></svg>',
  warn: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.2v3.6M8 11.8v.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  ok: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" opacity=".2"/><path d="M4.6 8.3 7 10.6l4.4-4.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  err: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" opacity=".22"/><path d="M8 4.4v4.4M8 11.2v.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
};

/** Part titles are held in capitals for the page; the outline shows them as words. */
const SMALL_WORDS = new Set(['of', 'and', 'the', 'to', 'in', 'on']);
const asWords = (s: string): string =>
  s === s.toUpperCase()
    ? s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
    : s;

interface Tally {
  all: number;
  todo: number;
  stale: number;
  yours: number;
  open: number;
  accepted: number;
  written: number;
  gr: number;
  map: number;
}

type AprcFilter = 'all' | 'todo' | 'open' | 'stale' | 'written';
const FILTERS: Array<{ f: AprcFilter; label: string }> = [
  { f: 'all', label: 'All' },
  { f: 'todo', label: 'To do' },
  { f: 'open', label: 'Proposals' },
  { f: 'stale', label: 'Gr changed' },
  { f: 'written', label: 'Written' },
];
const inFilter = (s: ParaStatus, f: AprcFilter): boolean =>
  s !== 'head' && (f === 'all' ? true : f === 'todo' ? TODO.has(s) : f === 'open' ? s === 'open' : f === 'stale' ? s === 'stale' : s === 'written' || s === 'stale');

export default class GroundAppreciation {
  private _opts: GroundAppreciationOptions = { ...DEFAULT_GROUND_APPRECIATION_OPTIONS };
  private _enabled = false;
  private _getView: () => any;
  private _host: GroundAppreciationHost;
  private _doc: AprcDoc | null = null;
  private _busy = false;
  private _msgText = '';
  /** Counts messages, so the same words twice still show the toast twice. */
  private _msgSeq = 0;
  private _toastSeq = 0;
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;
  private get _msg(): string {
    return this._msgText;
  }
  private set _msg(v: string) {
    this._msgText = v;
    this._msgSeq++;
  }
  private _note = '';
  private _sel: string | null = null;
  /** The outline's filter. */
  private _filter: AprcFilter = 'all';
  /** The menu open under the header, if any. */
  private _menu: 'export' | 'more' | null = null;
  /** Clear asks twice: the first click arms it. */
  private _clearArmed = false;
  private _outside: ((e: Event) => void) | null = null;
  /** Words typed in the paragraph box and not yet saved. */
  private _dirty: { id: string; text: string } | null = null;
  /** The outline as a drawer on a narrow sheet. */
  private _outOpen = false;
  /** The outline and the paragraph panel folded to a rail (kept in this browser: a viewer's convenience). */
  private _hideOut = false;
  private _hideRt = false;
  private _uiLoaded = false;
  private _resizeRaf = 0;
  /** Sizes the planner dragged (null: the default for the width); kept with the folds in this browser. */
  /** The sheet as a window: docked under the host's bar, filling the screen, or folded to a bar at the foot. */
  private _win: 'normal' | 'max' | 'min' = 'normal';
  /** What a folded sheet goes back to: maximized (as it launches) unless the planner restored it down. */
  private _maxPref = false;
  /** When the window state last changed: a double-click that began as the restoring click is not taken as a second change. */
  private _winAt = 0;
  /** Where the minimized bar was dragged to (its top-left, px), or null: centred at the foot. Kept in this browser. */
  private _minPos: { x: number; y: number } | null = null;
  /** When a drag of the bar ended: the click that ends a drag does not restore the sheet. */
  private _movedAt = 0;
  private _wo: number | null = null;
  private _wr: number | null = null;
  private _hr: number | null = null;
  /** Bumped on every change of the document, so the page is drawn again only when it changed. */
  private _docVer = 0;
  private _pageKey = '';
  private _el: HTMLElement | null = null;
  private _open = false;
  private _resize: (() => void) | null = null;
  private _readSeq = 0;
  /** The ORBAT once loaded (null: not found; undefined: not tried yet). */
  private _orbat: any | null | undefined = undefined;
  private _orbatBase = '';
  /** The last en reading, so a new H re-times the options without reading the ground again. */
  private _lastEnemy: AprcEnemyIn | null = null;
  /** The symbols on the map as PlanCheck read them at the last Read. */
  private _drawn: any[] = [];

  constructor(getView: () => any, host: GroundAppreciationHost = {}) {
    this._getView = getView;
    this._host = host;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this._enabled;
  }
  get panelOpen(): boolean {
    return this._open;
  }
  get busy(): boolean {
    return this._busy;
  }
  /** The appreciation as it stands (null before the first Read with nothing kept). */
  get doc(): AprcDoc | null {
    return this._doc;
  }
  get options(): Readonly<GroundAppreciationOptions> {
    return this._opts;
  }

  setOptions(o: Partial<GroundAppreciationOptions>): void {
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null)) } as GroundAppreciationOptions;
    if (!aprcKinds().find((k) => k.kind === this._opts.kind)?.ready) this._opts.kind = 'def';
    if (String(this._opts.orbatUrl || '') !== this._orbatBase) this._orbat = undefined;
    if (this._enabled) this._render();
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    if (!this._doc) this._doc = this._load() ?? newDoc(this._opts.kind);
    EngineLogger.nextStep(ENGINE, 'Aprc on: open the sheet and press Read');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._readSeq++;
    this._busy = false;
    this.openPanel(false);
  }

  destroy(): void {
    this.disable();
    this._el?.remove();
    this._el = null;
  }

  onViewChanged(): void {
    /* nothing is drawn on the map */
  }

  openPanel(open = true): void {
    if (!open) {
      // what was typed in the paragraph box is kept as the planner's
      if (this._open) this._commitDirty();
      this._closeMenu(false);
      this._open = false;
      this._el?.classList.remove('ms-open');
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
      return;
    }
    if (!this._enabled) return;
    ensureCss();
    if (!this._el) this._build();
    // the sheet launches maximized, the whole page as the Briefing's edit view (user, 22 Nov 2026); opening a folded
    // sheet that is still open brings it back as it was
    if (!this._open) {
      this._win = 'max';
      this._maxPref = true;
    } else if (this._win === 'min') this._win = this._maxPref ? 'max' : 'normal';
    this._open = true;
    this._dock();
    this._el!.classList.add('ms-open');
    if (!this._resize) {
      this._resize = () => {
        this._dock();
        if (this._menu) this._renderMenu();
        cancelAnimationFrame(this._resizeRaf);
        this._resizeRaf = requestAnimationFrame(() => this._render());
      };
      window.addEventListener('resize', this._resize);
    }
    this._render();
    // keys work in the sheet at once (arrows, N, A, Esc)
    if (!this._el!.contains(document.activeElement)) this._el!.focus({ preventScroll: true });
  }

  togglePanel(): boolean {
    if (this._open && this._win === 'min') {
      this._setWin(this._maxPref ? 'max' : 'normal');
      return true;
    }
    this.openPanel(!this._open);
    return this._open;
  }

  /** The sheet's window: 'normal' (docked under the host's bar), 'max' (the whole screen) or 'min' (a bar at the foot). */
  get windowState(): 'normal' | 'max' | 'min' {
    return this._win;
  }
  setWindow(state: 'normal' | 'max' | 'min'): void {
    if (!this._open) this.openPanel(true);
    this._setWin(state);
  }

  private _dock(): void {
    if (!this._el) return;
    const el = this._el;
    el.classList.toggle('win-max', this._win === 'max');
    el.classList.toggle('win-min', this._win === 'min');
    // the bar's own place applies only while minimized
    el.style.left = '';
    el.style.bottom = '';
    el.style.transform = '';
    el.classList.remove('toast-below');
    if (this._win === 'max') {
      // the whole page, edge to edge (as the Briefing's edit view)
      el.style.top = '0';
      el.style.height = '100vh';
      el.style.maxHeight = 'none';
      return;
    }
    if (this._win === 'min') {
      el.style.top = '';
      el.style.height = '';
      el.style.maxHeight = '';
      if (this._minPos) {
        const r = el.getBoundingClientRect();
        const p = this._clampPos(this._minPos.x, this._minPos.y, r.width, r.height);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        el.style.bottom = 'auto';
        el.style.transform = 'none';
        el.classList.toggle('toast-below', p.y < 90);
      }
      return;
    }
    dockBelowBar(this._el);
    const top = parseFloat(this._el.style.top) || 118;
    this._el.style.height = `calc(100vh - ${Math.round(top + 12)}px)`;
  }

  // ── reading ───────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Read the map and draft the appreciation. The planner's words and acceptances are kept. Resolves with the document,
   * or null when the engine is off or another Read overtook this one. `at` ([lng, lat]) sets the MITG for a host; without
   * it the MITG is a VG symbol, else the selected symbol, else the map centre.
   */
  async read(o: { at?: [number, number] | null } = {}): Promise<AprcDoc | null> {
    if (!this._enabled) return null;
    // words typed in the paragraph box are the planner's before the new reading comes in
    this._commitDirty();
    const seq = ++this._readSeq;
    this._busy = true;
    this._msg = 'Reading…';
    this._note = '';
    this._render();
    const prev = this._doc;
    const doc = newDoc(this._opts.kind);
    const notes: string[] = [];
    try {
      // 1. the ground, through the Ground Guide
      const guide = this._host.guide?.() ?? null;
      const graphic = this._host.selected?.()[0] ?? null;
      let aor: { reading: AorReading; frame: AorFrame } | null = null;
      if (!guide?.isEnabled) notes.push('Ground Guide is off: the Gr paragraphs are not read.');
      else {
        for (let i = 0; i < 12 && guide.status?.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 500));
        const so = this._opts;
        aor = await withTimeout<{ reading: AorReading; frame: AorFrame } | null>(guide.aorAround(Array.isArray(o.at) ? o.at : null, { graphic, echelon: so.echelon === 'auto' ? undefined : so.echelon, profile: so.mover === 'auto' ? undefined : so.mover }), 60000);
        if (!aor) notes.push(guide.status?.state === 'ready' ? 'The ground could not be read here: outside the terrain data, or it did not load in time.' : 'No terrain data: the Gr paragraphs are not read.');
      }
      if (seq !== this._readSeq) return null;

      // 2. the symbols on the map
      const symbols = await this._symbols(aor?.reading ?? null);
      const sym = writeSymbols(symbols);
      applyPatches(doc, sym.patches);
      doc.confirm.push(...sym.confirm);

      if (aor) {
        const ipb = await this._ipb(guide, aor.reading, graphic);
        if (seq !== this._readSeq) return null;
        const gin = await this._groundIn(guide, aor, graphic, sym.drawnObs);
        if (seq !== this._readSeq) return null;
        if (ipb?.wx) gin.wx = { marginal: ipb.wx.rows.filter((x: any) => x.status === 'marg').map((x: any) => `${x.mission} (${x.element})`), unfavourable: ipb.wx.rows.filter((x: any) => x.status === 'unfav').map((x: any) => `${x.mission} (${x.element})`) };
        const w = writeGround(gin);
        applyPatches(doc, w.patches);
        doc.confirm.unshift(...w.confirm);
        doc.frame = w.frame ?? null;
        const tw = writeTasks(aor.reading);
        applyPatches(doc, tw.patches);
        const en = ipb ? this._enemyIn(ipb, aor.reading, sym.enForce, guide) : null;
        this._lastEnemy = en;
        if (en) {
          const ew = writeEnemy(en);
          applyPatches(doc, ew.patches);
          doc.confirm.push(...ew.confirm);
        } else notes.push('The en options were not read (no avenue from the threat side).');
        // the ORBAT: relative strength, Pls held against the tasks; time required (mine laying by its engineers)
        const orbat = await this._loadOrbat();
        if (seq !== this._readSeq) return null;
        if (orbat) {
          const si = await this._strengthIn(orbat, aor.reading, w.frame?.echelon ?? 'Bn', tw.pls);
          if (si) {
            const sw = writeStrength(si);
            applyPatches(doc, sw.patches);
            doc.confirm.push(...sw.confirm);
          }
        } else notes.push(`No ORBAT at ${this._orbatBase || 'the ORBAT url'}: relative strength is counted from the symbols only.`);
        const tr = writeTimeReq(await this._timeIn(orbat, aor.reading, w.frame?.echelon ?? 'Bn'));
        applyPatches(doc, tr.patches);
        doc.confirm.push(...tr.confirm);
        doc.sources = this._sources(guide);
        doc.figures = await this._figures(aor);
      } else if (this._opts.figures !== 'trace') {
        const shot = await this._mapShot();
        if (shot) doc.figures = [shot];
      }

      // 3. a checked plan
      const chk = this._checkIn();
      if (chk) {
        const pw = writePlan(chk);
        applyPatches(doc, pw.patches);
        doc.confirm.push(...pw.confirm);
        if (aor) applyPatches(doc, writeCoyTasks(this._coysIn(this._host.planCheck?.(), aor.reading)).patches);
      }
      if (seq !== this._readSeq) return null;
      this._doc = carryOver(prev, doc);
      this._docVer++;
      this._note = notes.join(' ');
      const c = counts(this._doc);
      this._msg = `Read: ${c.gr} from Gr, ${c.map} from the map, ${c.judge} proposals, ${c.yours} yours`;
      EngineLogger.success(ENGINE, this._msg);
      this._save();
      this._emit('aprc-read', { doc: this._doc });
      return this._doc;
    } catch (err) {
      console.error('[Aprc] read', err);
      this._msg = `Read failed: ${err instanceof Error ? err.message : String(err)}`;
      EngineLogger.error(ENGINE, this._msg);
      return null;
    } finally {
      if (seq === this._readSeq) {
        this._busy = false;
        this._render();
      }
    }
  }

  private _toMerc(r: AorReading, p: AorXY): [number, number] {
    return [r.centre[0] + p[0] * r.k, r.centre[1] + p[1] * r.k];
  }

  /** Where a ground point (metres from the reading's centre) is, in words. */
  private _where(r: AorReading, p: AorXY): string {
    let best: { name: string; d: number; at: AorXY } | null = null;
    for (const q of r.map.places) {
      const d = Math.hypot(q.at[0] - p[0], q.at[1] - p[1]);
      if (!best || d < best.d) best = { name: q.name, d, at: q.at };
    }
    if (best && best.d <= 400) return `at ${best.name}`;
    if (best && best.d <= 3000) return `${(best.d / 1000).toFixed(1)} km ${compass(p[0] - best.at[0], p[1] - best.at[1])} of ${best.name}`;
    const d = Math.hypot(p[0] - r.mitg.at[0], p[1] - r.mitg.at[1]);
    return `${(d / 1000).toFixed(1)} km ${compass(p[0] - r.mitg.at[0], p[1] - r.mitg.at[1])} of ${r.mitg.name}`;
  }

  private async _symbols(r: AorReading | null): Promise<AprcSymbolIn[]> {
    const recs = this._host.records?.() ?? [];
    this._drawn = [];
    if (!recs.length) return [];
    try {
      const { readSymbols } = await import('../DeploymentBuilder/PlanCheck');
      const raw = readSymbols(recs as any);
      this._drawn = raw;
      return raw.map((s) => {
        let where: string | null = null;
        if (r && s.pts.length) {
          const cx = s.pts.reduce((a, p) => a + p.x, 0) / s.pts.length, cy = s.pts.reduce((a, p) => a + p.y, 0) / s.pts.length;
          where = this._where(r, [(cx - r.centre[0]) / r.k, (cy - r.centre[1]) / r.k]);
        }
        return { id: s.id, key: s.key, name: s.name, side: s.side, ech: s.ech, label: s.label, where, planned: s.status === '1' };
      });
    } catch (err) {
      console.warn('[Aprc] symbols', err);
      return [];
    }
  }

  /** The IPB reading of the en's avenues onto the position, with his times, the Annex A weather and the template. */
  private async _ipb(guide: any, r: AorReading, graphic: any): Promise<any | null> {
    if (!guide?.ipbApproachesAround) return null;
    const ll = mercToLngLat(...this._toMerc(r, r.mitg.at));
    const sidc: string | null = graphic?.attributes?.drawEssentials?.AMPLIFIER?.SIDC ?? null;
    return withTimeout<any>(guide.ipbApproachesAround(ll, { sidc, readFor: 'defence', threatDeg: r.faceDeg, extras: true }), 60000);
  }

  /** H on D Day: the sheet's, else the Ground Guide's IPB H; null when neither is set. */
  private _hHour(guide: any): string | null {
    const own = String(this._opts.hHour ?? '').trim();
    if (own && parseHHour(own) !== null) return own;
    const gg = String(guide?.options?.extended?.ipb?.hHour ?? '').trim();
    return gg && parseHHour(gg) !== null ? gg : null;
  }

  /**
   * His hours where an avenue crosses each line of def: the crossing on the avenue's path (the cut lengthened by half at
   * each end, as the avenues may run wider than the AOR), its distance along the path as the decision support measures
   * it, and his time there from the profile.
   */
  private _lineTimes(aa: any, pr: any, r: AorReading): Array<{ id: string; role: string; h: [number, number] }> {
    const pts: Array<[number, number, number]> = pr?.pts ?? [];
    if (pts.length < 2 || !aa?.line?.length || !r.lines.length) return [];
    const P: AorXY[] = aa.line.map((p: [number, number]) => [(p[0] - r.centre[0]) / r.k, (p[1] - r.centre[1]) / r.k]);
    const al: number[] = [Number(aa.startM) || 0];
    for (let i = 1; i < P.length; i++) al.push(al[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const s0 = al[0], last = al[al.length - 1];
    const kk = last > s0 ? (Number(aa.endM) - s0) / (last - s0) : 1;
    for (let i = 0; i < al.length; i++) al[i] = s0 + (al[i] - s0) * kk;
    const timeAt = (m: number): [number, number] => {
      if (m <= pts[0][0]) return [pts[0][1], pts[0][2]];
      for (let j = 0; j + 1 < pts.length; j++) {
        const a = pts[j], b = pts[j + 1];
        if (m <= b[0]) {
          const t = b[0] > a[0] ? (m - a[0]) / (b[0] - a[0]) : 0;
          return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        }
      }
      const z = pts[pts.length - 1];
      return [z[1], z[2]];
    };
    const out: Array<{ id: string; role: string; h: [number, number] }> = [];
    for (const l of r.lines) {
      const [a0, b0] = l.cut;
      const dx = b0[0] - a0[0], dy = b0[1] - a0[1];
      const A: AorXY = [a0[0] - dx * 0.5, a0[1] - dy * 0.5], B: AorXY = [b0[0] + dx * 0.5, b0[1] + dy * 0.5];
      for (let i = 0; i + 1 < P.length; i++) {
        const p = P[i], q = P[i + 1];
        const rx = q[0] - p[0], ry = q[1] - p[1], sx = B[0] - A[0], sy = B[1] - A[1];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((A[0] - p[0]) * sy - (A[1] - p[1]) * sx) / den;
        const u = ((A[0] - p[0]) * ry - (A[1] - p[1]) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        out.push({ id: l.id, role: l.role, h: timeAt(al[i] + (al[i + 1] - al[i]) * t) });
        break;
      }
    }
    return out.sort((x, y) => x.h[0] - y.h[0]);
  }

  private _enemyIn(v: any, r: AorReading, force: string | null, guide: any = null): AprcEnemyIn | null {
    const d = v?.decision;
    if (!v?.aas?.length || !d) return null;
    const ground = (p: [number, number]): AorXY => [(p[0] - r.centre[0]) / r.k, (p[1] - r.centre[1]) / r.k];
    const avenues: AprcAvenueIn[] = v.aas.map((aa: any) => {
      const pts: AorXY[] = (aa.line ?? []).map(ground);
      const seen: Array<{ name: string; at: number }> = [];
      for (const q of r.map.places) {
        if (q.across) continue;
        let best = Infinity, at = 0, acc = 0;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
          const t = Math.max(0, Math.min(1, ((q.at[0] - a[0]) * dx + (q.at[1] - a[1]) * dy) / (L * L)));
          const dd = Math.hypot(a[0] + t * dx - q.at[0], a[1] + t * dy - q.at[1]);
          if (dd < best) ((best = dd), (at = acc + t * L));
          acc += L;
        }
        if (best <= 800) seen.push({ name: q.name, at });
      }
      const pr = d.profiles.find((x: any) => x.aa === aa.id);
      return {
        id: String(aa.id),
        rank: Number(aa.rank) || 99,
        viable: !!aa.viable,
        main: !!aa.main,
        lengthM: Number(aa.lengthM) || 0,
        goPct: Number(aa.goPct) || 0,
        minWidthM: Number(aa.minWidthM) || 0,
        waterLines: Number(aa.waterLines) || 0,
        through: seen.sort((a, b) => a.at - b.at).map((x) => x.name).filter((nm, i, all) => all.indexOf(nm) === i),
        onto: aa.ontoLabel ?? null,
        startH: pr ? pr.startH : [0, 0],
        endH: pr ? pr.endH : [0, 0],
        lines: pr ? this._lineTimes(aa, pr, r) : [],
      };
    });
    const named = !!r.mitg.name && r.mitg.name !== 'MITG';
    const MOVER: Record<string, string> = { armour: 'armour', mech: 'mech inf', dismounted: 'dismounted inf' };
    const t = v.template;
    return {
      force,
      mover: MOVER[d.rates.mover] ?? d.rates.mover,
      rates: { go: d.rates.go, slow: d.rates.slow },
      fromThreat: !!d.fromThreat,
      aaFor: String(v.aaFor ?? ''),
      mcWidthM: Number(v.mcWidthM) || 0,
      objective: named ? r.mitg.name : 'the MITG',
      avenues,
      tais: (d.tais ?? []).map((x: any) => ({ id: x.id, aa: x.aa, why: x.why, earliestH: x.earliestH, latestH: x.latestH })),
      dps: (d.dps ?? []).map((x: any) => ({ id: x.id, kind: x.kind, aa: x.aa, tai: x.tai, decision: x.decision, earliestH: x.earliestH, beforeH: !!x.beforeH })),
      template: t ? { label: t.label, src: t.src, confirmed: !!t.confirmed, phases: (t.phases?.rows ?? []).map((x: any) => ({ phase: x.phase, time: x.time })) } : null,
      hHour: this._hHour(guide),
    };
  }

  // ── the ORBAT ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** The ORBAT files (as the Intelligent Deployment tab reads them), once; null when they are not served. */
  private async _loadOrbat(): Promise<any | null> {
    const base = String(this._opts.orbatUrl || DEFAULT_GROUND_APPRECIATION_OPTIONS.orbatUrl).replace(/\/+$/, '');
    if (this._orbat !== undefined && this._orbatBase === base) return this._orbat;
    this._orbatBase = base;
    try {
      const { OWN_ORBAT_FILES, mergeOwn } = await import('../DeploymentBuilder/PlanOrbat');
      const get = async (f: string) => {
        const res = await fetch(`${base}/${f}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${f}`);
        return res.json();
      };
      const [inf, ...arms] = OWN_ORBAT_FILES;
      const [infDoc, en, weapons, ...armDocs] = await Promise.all([get(inf), get('en.json'), get('weapons.json'), ...arms.map((f) => get(f).catch(() => null))]);
      const engr = armDocs[arms.indexOf('engr.json')];
      this._orbat = { own: mergeOwn([infDoc?.units, ...armDocs.map((d: any) => d?.units)]), en: en?.units ?? [], weapons: weapons?.weapons ?? [], engrData: engr?.engrData ?? [] };
    } catch (err) {
      this._orbat = null;
      EngineLogger.error(ENGINE, `No ORBAT at ${base} (${err instanceof Error ? err.message : String(err)}): relative strength from the symbols only`);
    }
    return this._orbat;
  }

  /** Own and en units for the relative strength: a built plan's, else the symbols marked, else assumed (and said so). */
  private async _strengthIn(o: any, r: AorReading, echWord: string, need: number | null): Promise<AprcStrengthIn | null> {
    const { brief, ownUnitFor, enUnitFor } = await import('../DeploymentBuilder/PlanOrbat');
    const pd: any = (await import('../../Data/PlanDoctrine.json')).default;
    const ownEch = ({ Coy: '15', Bn: '16', Bde: '18' } as Record<string, string>)[echWord] ?? '16';
    const ECHW: Record<string, string> = { '15': 'Coy', '16': 'Bn', '18': 'Bde', '21': 'Div' };
    const drawn = this._drawn;
    const isUnit = (s: any) => String(s.key ?? '').startsWith('10') && !!s.ech;
    const unitOf = (id: string | null, count: number): AprcForceUnit | null => {
      const b = id ? brief(o, id) : null;
      if (!b) return null;
      const n = (l: Array<{ count: number }>) => l.reduce((a, w) => a + (Number(w.count) || 0), 0);
      return { name: b.name, count, coys: b.coys, strength: b.strength, atgm: n(b.atgm), mortars: n(b.mortars), plsPerCoy: b.plsPerCoy, src: b.src };
    };
    const group = (pairs: Array<string | null>): AprcForceUnit[] => {
      const m = new Map<string, number>();
      for (const id of pairs) if (id) m.set(id, (m.get(id) ?? 0) + 1);
      return [...m].map(([id, n]) => unitOf(id, n)).filter((u): u is AprcForceUnit => !!u);
    };
    // own: the built plan's unit, else the own symbols of the AOR's echelon (standard type), else the standard type
    const meta = drawn.find((s) => s.side === 'own' && s.pbMeta?.unit)?.pbMeta ?? null;
    let own: AprcForceUnit[] = [], ownAssumed: string | null = null;
    if (meta?.unit) own = group([meta.unit]);
    if (!own.length) {
      const mine = drawn.filter((s) => s.side === 'own' && isUnit(s) && s.ech === ownEch);
      own = group(mine.length ? mine.map(() => ownUnitFor(ownEch)) : [ownUnitFor(ownEch)]);
      ownAssumed = mine.length ? `the ${ECHW[ownEch]} symbols on the map taken as the standard type (ORBAT)` : `a standard ${ECHW[ownEch]} for the ${ECHW[ownEch]} AOR (no own ${ECHW[ownEch]} symbol marked)`;
    }
    // en: his symbols marked, else the built plan's enemy, else one level up (PlanDoctrine)
    const typeOf = (name: string): 'inf' | 'mech' | 'armd' => (/armou?r|tank/i.test(name) ? 'armd' : /mech/i.test(name) ? 'mech' : 'inf');
    const enSyms = drawn.filter((s) => s.side === 'enemy' && isUnit(s) && ['15', '16', '18', '21'].includes(s.ech));
    let en: AprcForceUnit[] = [], enAssumed: string | null = null;
    if (enSyms.length) en = group(enSyms.map((s) => enUnitFor(s.ech, typeOf(String(s.name ?? '')))));
    if (!en.length) {
      const up = Number(pd?.enemy?.defaultUp?.value ?? 1);
      const order = ['15', '16', '18', '21'];
      const e = meta?.enemy?.echelon ?? order[Math.min(order.length - 1, Math.max(0, order.indexOf(ownEch) + up))];
      const type = meta?.enemy?.type ?? (r.country === 'Mountains' ? 'inf' : (pd?.enemy?.defaultType?.value ?? 'mech'));
      en = group([enUnitFor(e, type, r.country === 'Mountains' ? 'mountain' : null)]);
      enAssumed = meta?.enemy ? `the built plan's en (${ECHW[e] ?? e}, ${type})` : `one level up, a ${ECHW[e] ?? e} (${pd?.enemy?.defaultUp?.src ?? 'PlanDoctrine'}), ${type} (${type === 'mech' ? pd?.enemy?.defaultType?.src ?? 'PlanDoctrine' : 'mountains: inf'})`;
    }
    if (!en.length || !own.length) return null;
    return { en, enAssumed, own, ownAssumed, need };
  }

  /** Time Req inputs: the move in (the unit symbol outside the AOR), posn preparation, the protective minefield. */
  private async _timeIn(o: any | null, r: AorReading, echWord: string): Promise<AprcTimeIn> {
    const pd: any = (await import('../../Data/PlanDoctrine.json')).default;
    const md: any = (await import('../../Data/MoveDoctrine.json')).default;
    const ownEch = ({ Coy: '15', Bn: '16', Bde: '18' } as Record<string, string>)[echWord] ?? '16';
    const out: AprcTimeIn = { move: null, prep: null, mines: null };
    // the move in: an own symbol of the AOR's echelon outside the AOR, 2 km or more from the MITG
    const inside = (p: AorXY): boolean => {
      let c = false;
      const R2 = r.outline.map((q) => [(q[0] - r.centre[0]) / r.k, (q[1] - r.centre[1]) / r.k] as AorXY);
      for (let i = 0, j = R2.length - 1; i < R2.length; j = i++) {
        const a = R2[i], b = R2[j];
        if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    };
    for (const s of this._drawn) {
      if (s.side !== 'own' || s.ech !== ownEch || !String(s.key ?? '').startsWith('10') || !s.pts?.length) continue;
      const cx = s.pts.reduce((a: number, p: any) => a + p.x, 0) / s.pts.length, cy = s.pts.reduce((a: number, p: any) => a + p.y, 0) / s.pts.length;
      const g: AorXY = [(cx - r.centre[0]) / r.k, (cy - r.centre[1]) / r.k];
      const d = Math.hypot(g[0] - r.mitg.at[0], g[1] - r.mitg.at[1]);
      if (inside(g) || d < 2000) continue;
      const kmh = Number(md?.road?.speeds?.allTypes?.good?.[1]);
      if (!(kmh > 0)) break;
      out.move = { from: `${s.label || s.name} ${this._where(r, g)}`, km: d / 1000, kmh, src: `average speed of a column of all types of vehicles on good roads by night, ${kmh} km/h (SO's Hbk 2019 Sec 9 / SD in the Field Vol II: MoveDoctrine road.speeds)` };
      break;
    }
    const ready = pd?.readyBy?.coyPosnH;
    if (Array.isArray(ready?.value)) out.prep = { h: [Number(ready.value[0]), Number(ready.value[1])], src: String(ready.src ?? 'PlanDoctrine readyBy.coyPosnH') };
    const fdl = r.lines.find((l) => l.role === 'FDLs');
    if (o && fdl) {
      const { ownEngrTypes, minesByEngr, engrShare } = await import('../DeploymentBuilder/PlanEngr');
      const t = (o.engrData ?? []).find((x: any) => /Mine Laying - Planning Data: Manual/i.test(String(x?.title)));
      const row = t?.rows?.find((x: any) => x.Condition === 'Engr Pl' && /mixed/i.test(String(x.Cluster)));
      const perPl = Number(row?.['Max in 24 hrs']);
      const meta = this._drawn.find((s) => s.side === 'own' && s.pbMeta)?.pbMeta ?? null;
      const types = ownEngrTypes(o);
      let e = types.find((x) => x.id === (meta?.engr ?? 'engr-fd-coy')) ?? types.find((x) => x.id === 'engr-fd-coy') ?? null;
      if (e && meta?.engr && meta?.engrCoys) e = engrShare(e, Number(meta.engrCoys));
      if (e && perPl > 0) {
        const m = minesByEngr(e, fdl.frontM, perPl);
        out.mines = { frontM: fdl.frontM, engr: `${e.name}${meta?.engr ? ' (grouped to the plan)' : ' (taken: one Engr Fd Coy)'}`, handH: m.handH, mechH: m.mechH, perPl, src: `SO's Hbk 2019 p 439 (an Engr Pl lays ${perPl} mixed clusters in 24 h; a set of 6 MMLs 9000 m of ATMs in 24 h), a cluster to a metre of front (E); ${e.src}` };
      }
    }
    return out;
  }

  /** The Coys of a checked plan, with where each posn runs (named places at its ends), what is in it and its moves. */
  private _coysIn(c: any, r: AorReading): AprcCoyIn[] {
    if (!c?.posns?.length) return [];
    const th = (r.faceDeg * Math.PI) / 180;
    const R: AorXY = [Math.cos(th), -Math.sin(th)];
    const home = r.map.places.filter((p) => !p.across);
    const nearest = (p: AorXY): string | null => {
      let best: string | null = null, bd = 1500;
      for (const q of home) {
        const d = Math.hypot(q.at[0] - p[0], q.at[1] - p[1]);
        if (d < bd) ((bd = d), (best = q.name));
      }
      return best;
    };
    const spanOf = (poly: any[]): string | null => {
      const g: AorXY[] = (poly ?? []).map((p: any) => [((p.x ?? p[0]) - r.centre[0]) / r.k, ((p.y ?? p[1]) - r.centre[1]) / r.k] as AorXY);
      if (!g.length) return null;
      let lo = g[0], hi = g[0];
      for (const p of g) {
        const v = p[0] * R[0] + p[1] * R[1];
        if (v < lo[0] * R[0] + lo[1] * R[1]) lo = p;
        if (v > hi[0] * R[0] + hi[1] * R[1]) hi = p;
      }
      const a = nearest(lo), b = nearest(hi);
      if (a && b) return a === b ? `over ${a}` : `from incl ${a} to incl ${b}`;
      return a || b ? `at ${a ?? b}` : null;
    };
    const fwd = c.posns.filter((p: any) => p.kind === 'fwd');
    const catk = fwd.map((p: any) => {
      const sp = spanOf(p.poly);
      return sp?.replace(/^(over|at) /, '').replace(/^from incl (.*) to incl .*$/, '$1') ?? p.label;
    });
    const trig = (c.whatIf?.triggers ?? []) as any[];
    const same = (a: string, b: string) => !!a && !!b && (a.toLowerCase() === b.toLowerCase() || a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));
    return c.posns
      .filter((p: any) => ['fwd', 'depth', 'res'].includes(p.kind))
      .map((p: any) => ({
        label: String(p.label),
        kind: String(p.kind),
        span: spanOf(p.poly),
        units: (p.units ?? []).filter((u: string) => u && !same(u, p.label)),
        moves: trig.filter((t) => same(String(t.who ?? ''), String(p.label))).map((t) => ({ to: String(t.to ?? ''), min: Number(t.min) || 0, inTime: t.st === 'pass' })),
        catk: p.kind === 'fwd' ? [] : catk,
      }));
  }

  // ── in the plan file ──────────────────────────────────────────────────────────────────────────────────────────

  /** The appreciation for Save Plan (pictures left out: Read makes them again); null when nothing is read or written. */
  planExtra(): AprcDoc | null {
    const d = this._doc;
    if (!d) return null;
    const c = counts(d);
    let typed = false;
    walk(d, (p) => {
      if (p.cells || p.accepted) typed = true;
    });
    if (!d.frame && !c.written && !typed) return null;
    return { ...(JSON.parse(JSON.stringify(d)) as AprcDoc), figures: [] };
  }

  /** Load Plan: the appreciation saved with the plan replaces the one in the sheet. */
  loadPlanExtra(data: unknown): boolean {
    const ok = this.fromJSON(data);
    if (ok) {
      this._lastEnemy = null;
      this._msg = 'Opened with the plan: Read again for the pictures';
      this._render();
    }
    return ok;
  }

  private async _groundIn(guide: any, aor: { reading: AorReading; frame: AorFrame }, graphic: any, drawnObs: string[]): Promise<AprcGroundIn> {
    const r = aor.reading;
    const ll = mercToLngLat(...this._toMerc(r, r.mitg.at));
    const sidc: string | null = graphic?.attributes?.drawEssentials?.AMPLIFIER?.SIDC ?? null;
    const [sec, cov, ext] = await Promise.all([
      withTimeout<any>(guide.sectionsAround?.(ll) ?? Promise.resolve(null), 20000),
      withTimeout<any>(guide.coverAround?.(ll) ?? Promise.resolve(null), 20000),
      withTimeout<any>(guide.extendedAround?.(ll, { sidc, threatDeg: r.faceDeg, radiusKm: 2 }) ?? Promise.resolve(null), 30000),
    ]);
    const obsn: Partial<Record<AorSide, AprcObsn | null>> = {};
    if (this._opts.obsn && guide.extendedAround) {
      for (const a of r.apchs) {
        // a point half way along the part of the approach on the home side
        const want = a.lengthM - a.pastM / 2;
        let acc = 0, at: AorXY = a.path[a.path.length - 1];
        for (let i = 1; i < a.path.length; i++) {
          const L = Math.hypot(a.path[i][0] - a.path[i - 1][0], a.path[i][1] - a.path[i - 1][1]);
          if (acc + L >= want) {
            const t = L ? (want - acc) / L : 0;
            at = [a.path[i - 1][0] + (a.path[i][0] - a.path[i - 1][0]) * t, a.path[i - 1][1] + (a.path[i][1] - a.path[i - 1][1]) * t];
            break;
          }
          acc += L;
        }
        const e: any = await withTimeout<any>(guide.extendedAround(mercToLngLat(...this._toMerc(r, at)), { profile: 'dismounted', radiusKm: 2, threatDeg: (r.faceDeg + 180) % 360 }), 30000);
        if (!e?.obs) {
          obsn[a.side] = null;
          continue;
        }
        let near: string | null = null, nd = 1500;
        for (const q of r.map.places) {
          const d = Math.hypot(q.at[0] - at[0], q.at[1] - at[1]);
          if (d < nd) ((nd = d), (near = q.name));
        }
        const ov = e.obs.overlook;
        obsn[a.side] = { near, radiusM: e.radiusM ?? 2000, seenPct: e.obs.seenPct, clearMedianM: e.obs.clearMedianM, country: e.obs.country, overlook: ov ? { riseM: ov.riseM, distM: ov.distM, compass: COMPASS[Math.round((((ov.bearingDeg % 360) + 360) % 360) / 45) % 8] } : null };
      }
    }
    const gd = sec?.ground, rd = sec?.roads?.density, wx = sec?.weather, lv = cov?.levels;
    return {
      reading: r,
      frame: aor.frame,
      ground: gd ? { elevationM: gd.elevationM ?? null, slopeBand: gd.slopeBand ?? null, landform: gd.landform ?? null, rough: gd.rough?.label ?? null } : null,
      roads: rd ? { density: rd.density, allWeatherPct: rd.totalKm > 0 ? (100 * rd.allWeatherKm) / rd.totalKm : 0, radiusM: rd.radiusM, exitDirs: rd.exitDirs ?? [] } : null,
      weather: wx ? { monthName: wx.monthName, tmax: wx.tmax, tmin: wx.tmin, precMm: wx.precMm, windMs: wx.windMs, source: String(wx.source ?? '').replace(/NCGDB/g, '1:50k map'), dataDate: shortDate(wx.dataDate) } : null,
      visibility: ext?.weather ?? null,
      cover: lv ? { direct: lv.direct, indirect: lv.indirect, ground: lv.ground, aerial: lv.aerial } : null,
      crop: ext?.crop ?? null,
      obsn,
      light: lightTimes(new Date(), ll[1], ll[0], -new Date().getTimezoneOffset()),
      drawnObs,
      threatMarked: !r.originsAssumed,
      readAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' '),
    };
  }

  private _sources(guide: any): string[] {
    const m: any = guide?.bundleManifest ?? null;
    const out: string[] = [];
    for (const s of (m?.sources ?? []) as any[]) {
      if (!s?.id) continue;
      const d = shortDate(s.dataDate);
      const line = `${sourceName(s.id, s.name)}${d ? ` (${d})` : ''}`;
      if (!out.includes(line)) out.push(line);
    }
    if (m?.built) out.push(`Terrain bundle built ${String(m.built).slice(0, 10)}`);
    return out;
  }

  private _checkIn(): AprcCheckIn | null {
    const c: any = this._host.planCheck?.() ?? null;
    if (!c || !Array.isArray(c.posns)) return null;
    return {
      title: String(c.title ?? 'Plan'),
      posns: c.posns.map((p: any) => ({ label: String(p.label ?? ''), kind: String(p.kind ?? ''), ech: p.ech ?? null, planned: !!p.planned })),
      rows: (c.rows ?? []).map((r: any) => ({ name: String(r.name ?? ''), st: String(r.st ?? ''), reason: String(r.reason ?? '') })),
      triggers: (c.whatIf?.triggers ?? []).map((t: any) => ({ trigger: String(t.trigger ?? ''), who: String(t.who ?? ''), from: String(t.from ?? ''), to: String(t.to ?? ''), min: Number(t.min) || 0, enemyMin: Number(t.enemyMin) || 0, st: String(t.st ?? ''), reason: String(t.reason ?? '') })),
      confirm: c.confirm ?? [],
      assumptions: c.assumptions ?? [],
    };
  }

  // ── figures ───────────────────────────────────────────────────────────────────────────────────────────────────

  private async _figures(aor: { reading: AorReading; frame: AorFrame }): Promise<AprcFigure[]> {
    const out: AprcFigure[] = [];
    const W = 900, H = 800;
    if (this._opts.figures !== 'map') {
      const frame: AorFrame = { ...aor.frame, reading: aor.reading, style: 'trace', orient: 'north', northDeg: 0, layers: { going: true, apch: true, line: true, itg: true, dml: true, msr: true }, loading: false };
      try {
        const svg = aorMapSvg(aor.reading, frame, W, H, 'full');
        const png = await this._rasterise(svg, W, H, 2);
        out.push({ id: 'trace', kind: 'trace', caption: `Trace: apchs, lines of def and going for ${aor.frame.profileLabel.toLowerCase()}. North up.`, svg, png: png ?? undefined, w: W, h: H });
      } catch (err) {
        console.warn('[Aprc] trace', err);
      }
    }
    if (this._opts.figures !== 'trace') {
      const shot = await this._mapShot();
      if (shot) out.push(shot);
    }
    return out;
  }

  private _rasterise(svg: string, w: number, h: number, scale: number): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        const done = (v: string | null) => resolve(v);
        const timer = setTimeout(() => done(null), 8000);
        img.onload = () => {
          clearTimeout(timer);
          try {
            const c = document.createElement('canvas');
            c.width = w * scale;
            c.height = h * scale;
            const g = c.getContext('2d');
            if (!g) return done(null);
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, c.width, c.height);
            g.drawImage(img, 0, 0, c.width, c.height);
            done(c.toDataURL('image/png'));
          } catch {
            done(null);
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          done(null);
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      } catch {
        resolve(null);
      }
    });
  }

  /** A shot of the map as it is on screen, with the symbols. Null when the view cannot give one in time. */
  private async _mapShot(): Promise<AprcFigure | null> {
    const view: any = this._getView?.();
    if (!view?.takeScreenshot) return null;
    const s: any = await withTimeout<any>(view.takeScreenshot({ format: 'png' }), 8000);
    if (!s?.dataUrl) return null;
    return { id: 'map', kind: 'map', caption: 'The map as on screen when read, with the symbols.', png: s.dataUrl, w: s.data?.width ?? view.width ?? 1280, h: s.data?.height ?? view.height ?? 720 };
  }

  // ── the planner's words ───────────────────────────────────────────────────────────────────────────────────────

  /** Write a paragraph (empty text gives it back to the tool). */
  setText(id: string, text: string | null): boolean {
    if (!this._doc || !setMine(this._doc, id, text)) return false;
    this._changed();
    return true;
  }
  /** Type into a cell of a paragraph's table; empty text (or the tool's own value) gives the cell back to the tool. */
  setCell(id: string, r: number, c: number, text: string | null): boolean {
    const p = this._doc ? find(this._doc, id) : null;
    if (!this._doc || !p?.table) return false;
    const t = (text ?? '').trim();
    const drafted = p.table.rows[r]?.[c] ?? '';
    if (!setCell(this._doc, id, r, c, !t || t === drafted ? null : t)) return false;
    this._changed();
    return true;
  }

  /** Take a proposal as it stands, or take the acceptance back. */
  accept(id: string, on = true): boolean {
    if (!this._doc || !accept(this._doc, id, on)) return false;
    this._changed();
    return true;
  }
  acceptAll(): number {
    if (!this._doc) return 0;
    const n = acceptAll(this._doc);
    if (n) this._changed();
    return n;
  }
  /** Start again: every heading, nothing written. The planner's words go too. */
  clear(): void {
    this._doc = newDoc(this._opts.kind);
    this._sel = null;
    this._dirty = null;
    this._msg = 'Cleared: every heading empty';
    this._changed();
  }

  private _changed(): void {
    this._docVer++;
    this._save();
    this._render();
    this._emit('aprc-changed', { doc: this._doc });
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────

  toText(copy: AprcCopy = this._opts.copy): string {
    return this._doc ? toText(this._doc, copy) : '';
  }
  /** A whole HTML document laid out for A4 print. */
  toHtml(copy: AprcCopy = this._opts.copy): string {
    return this._doc ? printHtml(this._doc, copy) : '';
  }
  /** The document as plain data (figures as they are); `fromJSON` takes it back. */
  toJSON(): AprcDoc | null {
    return this._doc ? (JSON.parse(JSON.stringify(this._doc)) as AprcDoc) : null;
  }
  fromJSON(doc: any): boolean {
    if (!doc || doc.version !== 1 || !Array.isArray(doc.parts)) return false;
    this._doc = doc as AprcDoc;
    this._sel = null;
    this._dirty = null;
    this._msg = 'Opened';
    this._changed();
    return true;
  }

  /** The Word document as a Blob. Loads the PowerPoint bundle once for its JSZip. */
  async toDocx(copy: AprcCopy = this._opts.copy): Promise<Blob | null> {
    if (!this._doc) return null;
    let JSZip: any = (window as any).JSZip;
    if (!JSZip) {
      const { loadPptxGenJS } = await import('../ImportExport/PptxExporter');
      await loadPptxGenJS();
      JSZip = (window as any).JSZip;
    }
    if (!JSZip) throw new Error('JSZip is not available (the PowerPoint bundle did not load)');
    const images: Record<string, DocxImage> = {};
    for (const f of this._doc.figures) {
      if (!f.png) continue;
      const b64 = f.png.split(',')[1] ?? '';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      images[f.id] = { bytes, w: f.w, h: f.h };
    }
    const zip = new JSZip();
    for (const [path, body] of Object.entries(docxFiles(this._doc, copy, images))) zip.file(path, body);
    return (await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' })) as Blob;
  }

  /** The slides of a deck kind (not yet in the briefing). */
  toDeck(kind: AprcDeckKind = this._opts.deck, copy: AprcCopy = this._opts.copy): any[] {
    if (!this._doc) return [];
    const bg = this._blank(1280, 720), th = this._blank(240, 135);
    return buildDeck(this._doc, { kind, copy, blankBg: bg, thumb: th });
  }

  private _blank(w: number, h: number): string {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
    }
    return c.toDataURL('image/png');
  }

  /**
   * Make the slides in the Briefing module. Slides that are not the appreciation's stay; an appreciation slide edited
   * since it was made is kept; the rest are replaced. Returns what happened, or null when Briefing is off.
   */
  makeSlides(kind: AprcDeckKind = this._opts.deck): { added: number; kept: number; replaced: number } | null {
    const be: any = this._host.briefing?.() ?? null;
    if (!this._doc || !be?.importBriefing || !be.getSlides) {
      this._msg = 'Slides need the Briefing module on (features.briefing)';
      this._render();
      return null;
    }
    const fresh = this.toDeck(kind);
    const m = mergeDeck(be.getSlides(), fresh);
    // The deck's own chrome (its classification banner, set in the Briefing module) is kept as it is.
    const cur = be.exportBriefing?.() ?? { version: 12 };
    be.importBriefing({ version: cur.version ?? 12, slides: m.slides, ...(cur.chrome ? { chrome: cur.chrome } : {}) });
    this._msg = `Slides: ${m.added} made${m.kept ? `, ${m.kept} you edited kept` : ''}${m.replaced ? `, ${m.replaced} replaced` : ''}`;
    EngineLogger.success(ENGINE, this._msg);
    this._render();
    return { added: m.added, kept: m.kept, replaced: m.replaced };
  }

  private _download(blob: Blob, name: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  private _fileName(ext: string): string {
    const place = (this._doc?.frame?.place ?? 'aprc').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'aprc';
    return `Aprc_${place}_${new Date().toISOString().slice(0, 10)}${this._opts.copy === 'draft' ? '_draft' : ''}.${ext}`;
  }

  async exportWord(): Promise<boolean> {
    try {
      const b = await this.toDocx();
      if (!b) return false;
      this._download(b, this._fileName('docx'));
      this._msg = `Word: ${this._opts.copy} copy saved`;
      EngineLogger.success(ENGINE, this._msg);
      this._render();
      return true;
    } catch (err) {
      this._msg = `Word export failed: ${err instanceof Error ? err.message : String(err)}`;
      EngineLogger.error(ENGINE, this._msg);
      this._render();
      return false;
    }
  }

  /** Print (Save as PDF in the print dialog). */
  exportPrint(): void {
    if (!this._doc) return;
    const fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    fr.srcdoc = this.toHtml();
    fr.onload = () => {
      try {
        fr.contentWindow?.focus();
        fr.contentWindow?.print();
      } catch (err) {
        console.warn('[Aprc] print', err);
      }
      setTimeout(() => fr.remove(), 60000);
    };
    document.body.appendChild(fr);
    this._msg = 'Print: choose Save as PDF for a PDF';
    this._render();
  }

  async copyText(): Promise<boolean> {
    const t = this.toText();
    try {
      await navigator.clipboard.writeText(t);
      this._msg = 'Copied as text';
    } catch {
      this._msg = 'Copy failed: the browser refused the clipboard';
    }
    this._render();
    return this._msg === 'Copied as text';
  }

  exportJson(): void {
    if (!this._doc) return;
    this._download(new Blob([JSON.stringify(this._doc)], { type: 'application/json' }), this._fileName('json'));
  }

  private _openJson(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        if (!this.fromJSON(JSON.parse(await f.text()))) throw new Error('not an appreciation file');
      } catch (err) {
        this._msg = `Open failed: ${err instanceof Error ? err.message : String(err)}`;
        this._render();
      }
    };
    inp.click();
  }

  // ── kept between sessions ─────────────────────────────────────────────────────────────────────────────────────

  private _save(): void {
    if (!this._opts.keep || !this._doc || typeof localStorage === 'undefined') return;
    try {
      // without the pictures: they are made again on Read
      localStorage.setItem(STORE, JSON.stringify({ ...this._doc, figures: [] }));
    } catch {
      /* storage full or refused: the document stays in memory */
    }
  }
  private _load(): AprcDoc | null {
    if (!this._opts.keep || typeof localStorage === 'undefined') return null;
    try {
      const d = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      if (d) delete d.marking; // a document kept before the marking became a ruled line
      return d && d.version === 1 && Array.isArray(d.parts) && d.kind === this._opts.kind ? (d as AprcDoc) : null;
    } catch {
      return null;
    }
  }

  private _emit(name: string, detail: unknown): void {
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ── the sheet ─────────────────────────────────────────────────────────────────────────────────────────────────

  private _build(): void {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Appreciation of the situation');
    const kinds = aprcKinds();
    el.innerHTML = `<header class="ap-head">
<span class="ap-ttl">Aprc</span>
<select class="ap-select" data-o="kind" aria-label="Kind of appreciation">${kinds.map((k) => `<option value="${k.kind}" ${k.ready ? '' : 'disabled'}>${esc(k.label)}${k.ready ? '' : ' (no outline yet)'}</option>`).join('')}</select>
<div class="ap-frame" data-p="frame"></div>
<button class="ap-btn pri" data-a="read" data-p="read" title="Read the ground and the symbols on the map. Your words and acceptances are kept."></button>
<button class="ap-btn" data-a="menu" data-v="export" aria-haspopup="menu" aria-expanded="false">Export ${UI.caret}</button>
<button class="ap-btn icon" data-a="menu" data-v="more" aria-haspopup="menu" aria-expanded="false" aria-label="Save, open or clear" title="Save, open or clear">${UI.more}</button>
<span class="ap-minprog" data-p="minprog"></span>
<span class="ap-wsep" aria-hidden="true"></span>
<button class="ap-btn icon ghost" data-a="win" data-v="min" data-p="winmin"></button>
<button class="ap-btn icon ghost" data-a="win" data-v="max" data-p="winmax"></button>
<button class="ap-btn icon ghost" data-a="close" aria-label="Close (Esc)" title="Close (Esc)">${UI.close}</button>
</header>
<div class="ap-busy" data-p="busy" aria-hidden="true"><i></i></div>
<div class="ap-note" data-p="note" role="note"></div>
<div class="ap-grid" data-p="grid">
<nav class="ap-out" id="ap-pane-out" data-p="out" aria-label="Outline"></nav>
<section class="ap-mid" aria-label="The page">
<div class="ap-ptool">
<button class="ap-btn icon sm ghost ap-pane-btn" data-a="pane" data-v="out" data-p="paneout" aria-controls="ap-pane-out" aria-keyshortcuts="[">${UI.paneL}</button>
<div class="ap-seg" role="group" aria-label="Copy"><button data-a="copy" data-v="fair" title="What goes up: a paragraph not written, and a proposal not accepted, print a ruled line">Fair copy</button><button data-a="copy" data-v="draft" title="With a mark on each paragraph, the proposals shown, and the Confirm on Gr, basis and data annexes">Draft copy</button></div>
<span class="ap-hint-copy" data-p="copyhint"></span>
<span class="sp"></span>
<label class="ap-hfield" title="H as a clock time on D Day: the en's times get clock times beside H+. Empty takes the Ground Guide's IPB H.">H on D Day<input type="text" data-o="hHour" inputmode="numeric" maxlength="5" placeholder="HH:MM" autocomplete="off"></label>
<button class="ap-btn icon sm ghost ap-pane-btn" data-a="pane" data-v="rt" data-p="panert" aria-controls="ap-pane-rt" aria-keyshortcuts="]">${UI.paneR}</button>
</div>
<div class="ap-page" data-p="page"></div>
</section>
<aside class="ap-rt" id="ap-pane-rt" data-p="rt" aria-label="The selected paragraph"></aside>
<div class="ap-rz ap-rz-out" data-rz="out" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="ap-pane-out" aria-label="Resize the outline" title="Drag to resize; double-click to reset"></div>
<div class="ap-rz ap-rz-rt" data-rz="rt" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="ap-pane-rt" aria-label="Resize the paragraph panel" title="Drag to resize; double-click to reset"></div>
</div>
<div class="ap-menu" data-p="menu" role="menu" hidden></div>
<div class="ap-toast" data-p="toast" role="status" aria-live="polite"></div>`;
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('pointerdown', (e) => {
      const tt = e.target as HTMLElement;
      const h = tt.closest('[data-rz]') as HTMLElement | null;
      if (h && e.button === 0) this._startResize(e, h);
      else if (this._win === 'min' && e.button === 0 && tt.closest('.ap-head') && !tt.closest('button,select,input')) this._startMove(e);
    });
    el.addEventListener('dblclick', (e) => {
      const rz = (e.target as HTMLElement).closest('[data-rz]') as HTMLElement | null;
      if (rz) return this._resetSize(rz.dataset.rz as 'out' | 'rt');
      const tt = e.target as HTMLElement;
      if (tt.closest('.ap-head') && !tt.closest('button,select,input')) {
        if (performance.now() - this._winAt > 500) this._setWin(this._win === 'max' ? 'normal' : 'max');
        return;
      }
      const p = (e.target as HTMLElement).closest('.ap-page .ap-p[data-id]') as HTMLElement | null;
      if (p) this._select(p.dataset.id!, false, true);
    });
    el.addEventListener('change', (e) => this._changeEv(e));
    el.addEventListener('input', (e) => this._input(e));
    el.addEventListener('keydown', (e) => this._key(e));
    document.body.appendChild(el);
    this._el = el;
    this._loadUi();
  }

  private _part(k: string): HTMLElement {
    return this._el!.querySelector(`[data-p="${k}"]`) as HTMLElement;
  }

  // ── the sheet: what the planner does ─────────────────────────────────────────────────────────────────────────

  private _click(e: Event): void {
    const t = e.target as HTMLElement;
    // the outline drawer of a narrow sheet folds away on a click beside it
    if (this._outOpen && !t.closest('.ap-out') && !t.closest('[data-a="pane"][data-v="out"]')) {
      this._outOpen = false;
      this._part('grid').classList.remove('out-open');
    }
    if (this._win === 'min' && t.closest('.ap-head') && !t.closest('button,select,input')) {
      if (performance.now() - this._movedAt < 350) return;
      this._setWin(this._maxPref ? 'max' : 'normal');
      return;
    }
    const b = t.closest('[data-a]') as HTMLButtonElement | null;
    if (b && this._el!.contains(b)) {
      if (b.disabled) return;
      const a = b.dataset.a!, v = b.dataset.v ?? '';
      if (a === 'menu') return this._toggleMenu(v as 'export' | 'more');
      if (a !== 'clear') this._closeMenu(false);
      if (a === 'give') this._dirty = null;
      else if (a !== 'save' && a !== 'sel' && a !== 'prev' && a !== 'next' && a !== 'next-todo') this._commitDirty();
      switch (a) {
        case 'close':
          return this.openPanel(false);
        case 'read':
          return void this.read();
        case 'accept-all': {
          const n = this.acceptAll();
          this._msg = n ? `${n} proposal${n === 1 ? '' : 's'} accepted: they print in the fair copy` : 'No open proposal';
          return this._render();
        }
        case 'filter':
          this._filter = v as AprcFilter;
          return this._render();
        case 'copy':
          return this.setOptions({ copy: v as AprcCopy });
        case 'word':
          return void this.exportWord();
        case 'print':
          return this.exportPrint();
        case 'text':
          return void this.copyText();
        case 'json':
          this.exportJson();
          this._msg = 'Saved to a file';
          return this._render();
        case 'open':
          return this._openJson();
        case 'slides':
          if (v) this.setOptions({ deck: v as AprcDeckKind });
          return void this.makeSlides(v ? (v as AprcDeckKind) : this._opts.deck);
        case 'guide':
          this._host.turnOnGuide?.();
          this._msg = 'Ground Guide on: press Read when the terrain data has loaded';
          this._note = '';
          return this._render();
        case 'clear':
          if (!this._clearArmed) {
            this._clearArmed = true;
            this._renderMenu();
            (this._part('menu').querySelector('[data-a="clear"]') as HTMLElement | null)?.focus();
            return;
          }
          this._closeMenu(true);
          this.clear();
          return;
        case 'sel':
          return this._select(v, true);
        case 'prev':
          return this._go(-1);
        case 'next':
          return this._go(1);
        case 'next-todo':
          return this._nextTodo();
        case 'win':
          if (v === 'min') return this._setWin(this._win === 'min' ? (this._maxPref ? 'max' : 'normal') : 'min');
          return this._setWin(this._win === 'max' ? 'normal' : 'max');
        case 'pane':
          return this._togglePane(v as 'out' | 'rt');
        case 'edit':
          return this._focusEditor();
        case 'save': {
          const ta = this._el!.querySelector('.ap-rt textarea') as HTMLTextAreaElement | null;
          if (!ta || !this._sel) return;
          this._dirty = { id: this._sel, text: ta.value };
          if (!this._commitDirty(true)) {
            this._msg = 'Nothing to save';
            this._render();
          }
          return;
        }
        case 'give':
          if (this._sel && this.setText(this._sel, null)) {
            this._msg = `${this._num(this._sel)} given back: the tool's draft prints`;
            this._render();
          }
          return;
        case 'keep': {
          const p = this._doc && this._sel ? find(this._doc, this._sel) : null;
          if (p?.mine && this.setText(p.id, p.mine.text)) {
            this._msg = `${this._num(p.id)}: yours kept`;
            this._render();
          }
          return;
        }
        case 'acc':
          if (this._sel && this.accept(this._sel, v !== 'off')) {
            this._msg = v === 'off' ? `${this._num(this._sel)}: acceptance taken back` : `${this._num(this._sel)} accepted: it prints in the fair copy`;
            this._render();
          }
          return;
        case 'addrow':
        case 'delrow':
          if (this._doc && this._sel && addRow(this._doc, this._sel, a === 'addrow' ? 1 : -1)) this._changed();
          return;
      }
      return;
    }
    const p = t.closest('.ap-page .ap-p[data-id]') as HTMLElement | null;
    if (p) this._select(p.dataset.id!, false);
  }

  private _changeEv(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const cell = t.dataset?.cell;
    if (cell && this._doc && this._sel) {
      const [r, c] = cell.split(',').map(Number);
      this.setCell(this._sel, r, c, t.value);
      return;
    }
    const k = t.dataset?.o;
    if (!k) return;
    if (k === 'hHour') {
      const v = t.value.trim();
      if (v && parseHHour(v) === null) {
        this._msg = 'H: type HH:MM (24 h), or leave it empty';
        return this._render();
      }
      this.setOptions({ hHour: v });
      if (this._doc && this._lastEnemy) {
        applyPatches(this._doc, writeEnemy({ ...this._lastEnemy, hHour: v || this._hHour(this._host.guide?.() ?? null) }).patches);
        this._msg = v ? `H ${v}: the en's times re-timed` : 'H cleared';
        this._changed();
      } else this._msg = 'H set: Read again to time the en options';
      return this._render();
    }
    if (k === 'kind') {
      const next = t.value as AprcKind;
      if (this._doc && this._doc.kind !== next) {
        let mine = false;
        walk(this._doc, (p) => {
          if (p.mine || p.accepted || p.cells) mine = true;
        });
        if (mine && !window.confirm('Change the kind of appreciation? It starts again with every heading empty, and your written paragraphs go.')) {
          t.value = this._doc.kind;
          return;
        }
      }
      this.setOptions({ kind: next });
      if (this._doc && this._doc.kind !== this._opts.kind) this.clear();
    }
  }

  /** Typing in the paragraph box: held as the planner's until saved (Save, Ctrl+Enter, or moving to another paragraph). */
  private _input(e: Event): void {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta.matches?.('.ap-ed textarea') || !this._sel) return;
    this._dirty = { id: this._sel, text: ta.value };
    const changed = this._isChanged();
    const ind = this._el!.querySelector('.ap-dirty') as HTMLElement | null;
    if (ind) ind.hidden = !changed;
    const save = this._el!.querySelector('[data-a="save"]') as HTMLButtonElement | null;
    if (save) {
      save.classList.toggle('pri', changed);
      save.disabled = !changed && !this._canKeep();
    }
  }

  private _key(e: KeyboardEvent): void {
    // keys in the sheet never reach the map
    e.stopPropagation();
    const t = e.target as HTMLElement;
    const rz = t.closest?.('[data-rz]') as HTMLElement | null;
    if (rz && !this._menu) {
      const which = rz.dataset.rz as 'out' | 'rt';
      const step = e.shiftKey ? 48 : 16;
      const narrow = this._narrow();
      let d = 0;
      if (narrow) d = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') d = (e.key === 'ArrowRight') === (which === 'out') ? step : -step;
      if (e.key === 'Enter' || e.key === 'Home') {
        e.preventDefault();
        return this._resetSize(which);
      }
      if (d) {
        e.preventDefault();
        this._setSize(which, this._sizeOf(which) + d);
        this._saveUi();
        return;
      }
    }
    if (this._menu) {
      const items = [...this._part('menu').querySelectorAll<HTMLElement>('.ap-mi')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        this._closeMenu(true);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        return;
      }
      if (e.key === 'Tab') this._closeMenu(false);
      return;
    }
    if (t.matches?.('textarea,input,select')) {
      if (t.matches('.ap-ed textarea') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._commitDirty(true);
        this._el!.focus({ preventScroll: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        t.blur();
        this._el!.focus({ preventScroll: true });
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'Escape':
        if (this._outOpen) {
          this._outOpen = false;
          this._render();
        } else this.openPanel(false);
        break;
      case 'ArrowDown':
      case 'j':
        this._go(1);
        break;
      case 'ArrowUp':
      case 'k':
        this._go(-1);
        break;
      case '[':
        this._togglePane('out');
        break;
      case ']':
        this._togglePane('rt');
        break;
      case 'n':
      case 'N':
        this._nextTodo();
        break;
      case 'a':
      case 'A': {
        const p = this._doc && this._sel ? find(this._doc, this._sel) : null;
        if (!p || statusOf(p) !== 'open') return;
        this.accept(p.id, true);
        this._msg = `${this._num(p.id)} accepted: it prints in the fair copy`;
        this._render();
        break;
      }
      case 'Enter':
      case 'e':
        if (t.matches?.('button')) return;
        if (!this._sel) return void this._nextTodo();
        this._focusEditor();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ── the sheet: moving through the paragraphs ─────────────────────────────────────────────────────────────────

  private _num(id: string): string {
    return this._doc ? numberOf(this._doc, id) || id : id;
  }

  /** Every paragraph in printing order (headings only kept, so a selected heading has a place). */
  private _order(): Array<{ id: string; s: ParaStatus }> {
    const out: Array<{ id: string; s: ParaStatus }> = [];
    if (!this._doc) return out;
    for (const l of lines(this._doc)) if (l.type === 'para') out.push({ id: l.p.id, s: statusOf(l.p) });
    return out;
  }

  private _go(step: number): void {
    const L = this._order();
    if (!L.length) return;
    let i = L.findIndex((x) => x.id === this._sel);
    if (i < 0) i = step > 0 ? -1 : L.length;
    for (let j = i + step; j >= 0 && j < L.length; j += step) {
      if (L[j].s !== 'head') return this._select(L[j].id, true);
    }
  }

  private _nextTodo(): void {
    this._commitDirty();
    const L = this._order();
    const i = L.findIndex((x) => x.id === this._sel);
    for (let k = 1; k <= L.length; k++) {
      const x = L[(i + k + L.length) % L.length];
      if (TODO.has(x.s)) return this._select(x.id, true);
    }
    this._msg = 'Nothing left to do: every paragraph prints';
    this._render();
  }

  private _select(id: string | null, scroll: boolean, edit = false): void {
    if (id !== this._sel) this._commitDirty();
    this._sel = id;
    this._outOpen = false;
    this._render();
    if (id && scroll) this._reveal(id);
    if (edit) this._focusEditor();
  }

  /** Bring the paragraph into view on the page and in the outline, only when it is out of sight. */
  private _reveal(id: string): void {
    const page = this._part('page');
    const el = page.querySelector(`.ap-p[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (el) {
      const pr = page.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (r.top < pr.top + 12 || r.bottom > pr.bottom - 12) {
        const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      }
    }
    (this._part('out').querySelector('.ap-it.sel') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }

  private _focusEditor(): void {
    if (this._hideRt) {
      this._hideRt = false;
      this._saveUi();
      this._render();
    }
    const ta = this._el?.querySelector('.ap-ed textarea') as HTMLTextAreaElement | null;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  /** The words in the box differ from what the paragraph holds. */
  private _isChanged(): boolean {
    const d = this._dirty;
    const p = d && this._doc ? find(this._doc, d.id) : null;
    if (!d || !p) return false;
    return d.text.trim() !== (p.mine?.text ?? p.draft ?? '').trim();
  }

  /** A drafted paragraph can be kept as the planner's as it stands (Read then leaves it alone). */
  private _canKeep(): boolean {
    const p = this._doc && this._sel ? find(this._doc, this._sel) : null;
    return !!p && !p.mine && !!(this._dirty?.id === p.id ? this._dirty.text : p.draft ?? '').trim();
  }

  /**
   * Save the box as the planner's. `force` saves a drafted paragraph unchanged too (Save as mine). Moving away saves
   * what was typed, so nothing typed is lost. Returns true when something was saved.
   */
  private _commitDirty(force = false): boolean {
    const d = this._dirty;
    if (!d || !this._doc) return false;
    const p = find(this._doc, d.id);
    if (!p) {
      this._dirty = null;
      return false;
    }
    const changed = this._isChanged();
    this._dirty = null;
    if (!changed && !(force && !p.mine && d.text.trim())) return false;
    if (!this.setText(d.id, d.text)) return false;
    this._msg = d.text.trim() ? `${this._num(d.id)} saved as yours: Read never changes it` : `${this._num(d.id)} given back to the tool`;
    this._render();
    return true;
  }

  /** Below 940 px the outline is a drawer and the paragraph panel sits under the page. */
  private _narrow(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(max-width: 940px)').matches;
  }

  /** Fold or open a side panel; on a narrow sheet the outline opens as a drawer instead. */
  private _togglePane(which: 'out' | 'rt'): void {
    if (which === 'out' && this._narrow()) this._outOpen = !this._outOpen;
    else if (which === 'out') this._hideOut = !this._hideOut;
    else {
      this._commitDirty();
      this._hideRt = !this._hideRt;
    }
    this._saveUi();
    this._render();
    if (which === 'out' && !this._hideOut && this._sel) this._reveal(this._sel);
  }

  private _loadUi(): void {
    if (this._uiLoaded) return;
    this._uiLoaded = true;
    try {
      const u = JSON.parse(localStorage.getItem(UI_STORE) ?? 'null');
      this._hideOut = !!u?.out;
      this._hideRt = !!u?.rt;
      this._minPos = Number.isFinite(u?.mx) && Number.isFinite(u?.my) ? { x: Number(u.mx), y: Number(u.my) } : null;
      const px = (v: unknown): number | null => (Number(v) > 0 ? Number(v) : null);
      this._wo = px(u?.wo);
      this._wr = px(u?.wr);
      this._hr = px(u?.hr);
    } catch {
      /* storage refused: both panels open */
    }
  }

  private _saveUi(): void {
    try {
      localStorage.setItem(UI_STORE, JSON.stringify({ out: this._hideOut, rt: this._hideRt, wo: this._wo, wr: this._wr, hr: this._hr, mx: this._minPos?.x ?? null, my: this._minPos?.y ?? null }));
    } catch {
      /* storage refused: the panels stay as they are for this session */
    }
  }

  /**
   * Maximize, restore or minimize the sheet. Minimizing keeps what was typed and gives the keys back to the map; the
   * folded bar shows the progress and restores on a click. Maximized is remembered in this browser.
   */
  private _setWin(w: 'normal' | 'max' | 'min'): void {
    if (!this._el || w === this._win) return;
    const was = this._win;
    if (w === 'min') {
      this._commitDirty();
      this._closeMenu(false);
      this._outOpen = false;
    } else {
      this._maxPref = w === 'max';
    }
    this._win = w;
    this._winAt = performance.now();
    this._dock();
    this._render();
    if (w === 'min') {
      if (this._el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    } else if (was === 'min') this._el.focus({ preventScroll: true });
  }

  /** Keep the bar inside the window (4 px clear of each edge). */
  private _clampPos(x: number, y: number, w: number, h: number): { x: number; y: number } {
    return { x: Math.round(clamp(x, 4, Math.max(4, innerWidth - w - 4))), y: Math.round(clamp(y, 4, Math.max(4, innerHeight - h - 4))) };
  }

  /**
   * Drag the minimized bar. It moves once the pointer has gone 4 px (less is a click, which restores the sheet); the
   * place is kept in this browser, and the bar stays inside the window when the window changes size.
   */
  private _startMove(e: PointerEvent): void {
    const el = this._el!;
    const head = el.querySelector('.ap-head') as HTMLElement;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
    let moved = false;
    try {
      head.setPointerCapture(e.pointerId);
    } catch {
      /* capture refused: the bar still follows while the pointer stays on it */
    }
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      if (!moved) {
        moved = true;
        el.classList.add('dragging');
      }
      this._minPos = this._clampPos(ev.clientX - dx, ev.clientY - dy, r.width, r.height);
      this._dock();
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (moved) {
        this._movedAt = performance.now();
        this._saveUi();
      }
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  }

  // ── the sheet: panel sizes ───────────────────────────────────────────────────────────────────────────────────

  /** The panel's size now (px): across, or down for the paragraph panel on a narrow sheet. */
  private _sizeOf(which: 'out' | 'rt'): number {
    const pane = this._part(which === 'out' ? 'out' : 'rt');
    return this._narrow() && which === 'rt' ? pane.offsetHeight : pane.offsetWidth;
  }

  /** Set a panel to a size, held between its bounds and the room the page needs. */
  private _setSize(which: 'out' | 'rt', px: number): void {
    const grid = this._part('grid');
    px = Math.round(px);
    if (this._narrow()) this._hr = clamp(px, SIZE.rows[0], Math.max(SIZE.rows[0], grid.clientHeight - SIZE.rows[1]));
    else if (which === 'out') this._wo = clamp(px, SIZE.out[0], Math.min(SIZE.out[1], grid.clientWidth - this._part('rt').offsetWidth - PAGE_MIN));
    else this._wr = clamp(px, SIZE.rt[0], Math.min(SIZE.rt[1], grid.clientWidth - this._part('out').offsetWidth - PAGE_MIN));
    this._applySizes();
  }

  private _resetSize(which: 'out' | 'rt'): void {
    if (this._narrow()) this._hr = null;
    else if (which === 'out') this._wo = null;
    else this._wr = null;
    this._applySizes();
    this._saveUi();
  }

  /** Drag an edge: the panel follows the pointer; the size is kept when the button comes up. */
  private _startResize(e: PointerEvent, h: HTMLElement): void {
    const which = h.dataset.rz as 'out' | 'rt';
    const grid = this._part('grid');
    const narrow = this._narrow();
    e.preventDefault();
    h.focus({ preventScroll: true });
    try {
      h.setPointerCapture(e.pointerId);
    } catch {
      /* capture refused: the drag still follows while the pointer stays on the handle */
    }
    grid.classList.add('resizing');
    grid.classList.toggle('rows', narrow);
    h.classList.add('on');
    const move = (ev: PointerEvent) => {
      const r = grid.getBoundingClientRect();
      this._setSize(which, narrow ? r.bottom - ev.clientY : which === 'out' ? ev.clientX - r.left : r.right - ev.clientX);
    };
    const up = () => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      grid.classList.remove('resizing', 'rows');
      h.classList.remove('on');
      this._saveUi();
      if (this._menu) this._renderMenu();
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  }

  /**
   * Put the dragged sizes on the grid. Below 940 px only the paragraph panel's height applies; a window too narrow for
   * the dragged widths shrinks them for now (not kept), so the page keeps PAGE_MIN.
   */
  private _applySizes(): void {
    if (!this._el) return;
    const grid = this._part('grid');
    const set = (k: string, v: number | null) => (v ? grid.style.setProperty(k, `${Math.round(v)}px`) : grid.style.removeProperty(k));
    const narrow = this._narrow();
    const hOut = this._el.querySelector('.ap-rz-out') as HTMLElement, hRt = this._el.querySelector('.ap-rz-rt') as HTMLElement;
    if (narrow) {
      set('--ap-wo-user', null);
      set('--ap-wr-user', null);
      set('--ap-hr-user', this._hr ? Math.min(this._hr, Math.max(SIZE.rows[0], grid.clientHeight - SIZE.rows[1])) : null);
      hRt.style.top = `${this._part('rt').offsetTop}px`;
      hRt.setAttribute('aria-orientation', 'horizontal');
    } else {
      const mid = typeof matchMedia === 'function' && matchMedia('(max-width: 1180px)').matches;
      let wo = this._wo, wr = this._wr;
      const o = this._hideOut ? 40 : wo ?? (mid ? 224 : 256), r = this._hideRt ? 40 : wr ?? (mid ? 312 : 352);
      const room = grid.clientWidth - PAGE_MIN;
      if (room > 0 && o + r > room) {
        const k = room / (o + r);
        if (wo) wo = Math.max(SIZE.out[0], wo * k);
        if (wr) wr = Math.max(SIZE.rt[0], wr * k);
      }
      set('--ap-wo-user', wo);
      set('--ap-wr-user', wr);
      set('--ap-hr-user', null);
      hRt.style.top = '';
      hRt.setAttribute('aria-orientation', 'vertical');
    }
    for (const [h, which] of [[hOut, 'out'], [hRt, 'rt']] as Array<[HTMLElement, 'out' | 'rt']>) {
      const b = narrow && which === 'rt' ? SIZE.rows : SIZE[which];
      h.setAttribute('aria-valuenow', String(this._sizeOf(which)));
      h.setAttribute('aria-valuemin', String(b[0]));
      if (b !== SIZE.rows) h.setAttribute('aria-valuemax', String(b[1]));
      else h.removeAttribute('aria-valuemax');
    }
  }

  // ── the sheet: menus ─────────────────────────────────────────────────────────────────────────────────────────

  private _toggleMenu(which: 'export' | 'more'): void {
    if (this._menu === which) return this._closeMenu(true);
    this._commitDirty();
    this._menu = which;
    this._clearArmed = false;
    this._renderMenu();
    (this._part('menu').querySelector('.ap-mi') as HTMLElement | null)?.focus();
    if (!this._outside) {
      this._outside = (ev: Event) => {
        const n = ev.target as Node;
        if (this._part('menu').contains(n) || (n as HTMLElement).closest?.('[data-a="menu"]')) return;
        this._closeMenu(false);
      };
      document.addEventListener('pointerdown', this._outside, true);
    }
  }

  private _closeMenu(refocus: boolean): void {
    if (!this._menu) return;
    const was = this._menu;
    this._menu = null;
    this._clearArmed = false;
    if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
    this._outside = null;
    this._renderMenu();
    if (refocus) (this._el?.querySelector(`[data-a="menu"][data-v="${was}"]`) as HTMLElement | null)?.focus();
  }

  private _renderMenu(): void {
    if (!this._el) return;
    const m = this._part('menu');
    for (const b of this._el.querySelectorAll<HTMLElement>('[data-a="menu"]')) b.setAttribute('aria-expanded', String(b.dataset.v === this._menu));
    if (!this._menu) {
      m.hidden = true;
      m.innerHTML = '';
      return;
    }
    const item = (a: string, label: string, note: string, o: { v?: string; cls?: string; extra?: string } = {}) =>
      `<button class="ap-mi${o.cls ? ` ${o.cls}` : ''}" role="menuitem" data-a="${a}"${o.v ? ` data-v="${esc(o.v)}"` : ''}>${label}${o.extra ?? ''}<small>${note}</small></button>`;
    let h = '';
    if (this._menu === 'export') {
      const copy = this._opts.copy === 'fair' ? 'Fair copy' : 'Draft copy';
      h += `<div class="ap-ml">${copy} (switch above the page)</div>`;
      h += item('word', 'Word document', '.docx, with the figures');
      h += item('print', 'PDF', 'Opens print: choose Save as PDF');
      h += item('text', 'Copy as text', 'To paste into a signal or a note');
      h += `<div class="ap-msep" role="separator"></div><div class="ap-ml">Slides in the Briefing - PPTX</div>`;
      for (const d of APRC_DECKS) h += item('slides', esc(d.label), esc(d.note[0].toUpperCase() + d.note.slice(1)), { v: d.kind, extra: d.kind === this._opts.deck ? '<span class="ap-last">default</span>' : '' });
    } else {
      h += item('json', 'Save to a file', '.json, to open later or send on');
      h += item('open', 'Open a file…', 'An appreciation saved before');
      h += `<div class="ap-msep" role="separator"></div>`;
      h += this._clearArmed
        ? item('clear', 'Click again to clear', 'Every heading empty: your words go too', { cls: 'danger armed' })
        : item('clear', 'Clear the appreciation…', 'Start again with every heading empty', { cls: 'danger' });
    }
    m.innerHTML = h;
    m.hidden = false;
    const anchor = this._el.querySelector(`[data-a="menu"][data-v="${this._menu}"]`) as HTMLElement | null;
    if (anchor) {
      const pr = this._el.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      m.style.top = `${Math.round(ar.bottom - pr.top + 6)}px`;
      m.style.right = `${Math.max(8, Math.round(pr.right - ar.right))}px`;
      m.style.left = 'auto';
    }
  }

  // ── the sheet: drawing it ────────────────────────────────────────────────────────────────────────────────────

  private _tally(doc: AprcDoc): Tally {
    const t: Tally = { all: 0, todo: 0, stale: 0, yours: 0, open: 0, accepted: 0, written: 0, gr: 0, map: 0 };
    walk(doc, (p) => {
      const s = statusOf(p);
      if (s === 'head') return;
      t.all++;
      t[s]++;
      if (TODO.has(s)) t.todo++;
    });
    return t;
  }

  private _render(): void {
    if (!this._el || !this._open) return;
    const doc = this._doc ?? newDoc(this._opts.kind);
    const copy = this._opts.copy;
    const t = this._tally(doc);
    const fr = doc.frame;

    // header
    const frame = this._part('frame');
    frame.innerHTML = this._busy
      ? '<span>Reading the ground and the map…</span>'
      : fr
        ? [fr.echelon, fr.place, fr.mover, `${fr.month}, ${fr.season === 'wet' ? 'after rain' : 'dry'}`].map((x) => `<span>${esc(x)}</span>`).join('') + `<span class="ap-fr-at">read ${esc(fr.readAt)}</span>`
        : '<span class="ap-fr-none">Not read yet</span>';
    frame.title = fr && !this._busy ? `AOR from ${fr.aor}; threat ${fr.threat}` : '';
    const rb = this._part('read') as HTMLButtonElement;
    rb.disabled = this._busy;
    rb.innerHTML = this._busy ? '<span class="ap-spin" aria-hidden="true"></span>Reading…' : `${UI.read}${fr ? 'Read again' : 'Read'}`;
    (this._el.querySelector('[data-o="kind"]') as HTMLSelectElement).value = doc.kind;
    this._part('busy').classList.toggle('on', this._busy);

    // over the page
    for (const b of this._el.querySelectorAll<HTMLElement>('.ap-seg [data-a="copy"]')) b.setAttribute('aria-pressed', String(b.dataset.v === copy));
    this._part('copyhint').textContent = copy === 'fair' ? 'As it goes up: blanks print a ruled line' : 'With the marks, the proposals and the annexes';
    const hin = this._el.querySelector('[data-o="hHour"]') as HTMLInputElement;
    if (document.activeElement !== hin) hin.value = this._opts.hHour ?? '';

    // the note under the header
    const guideOff = !this._host.guide?.()?.isEnabled;
    const note = this._part('note');
    const noteText = this._note || (guideOff && !fr ? 'Ground Guide is off: the Gr paragraphs are read through it.' : '');
    note.classList.toggle('on', !!noteText);
    note.innerHTML = noteText ? `${UI.warn}<span class="ap-note-t">${esc(noteText)}</span>${guideOff && this._host.turnOnGuide ? '<button class="ap-btn sm" data-a="guide">Turn on Ground Guide</button>' : ''}` : '';

    const wMin = this._part('winmin'), wMax = this._part('winmax');
    const minWord = this._win === 'min' ? 'Restore' : 'Minimize', maxWord = this._win === 'max' ? 'Restore down' : 'Maximize';
    wMin.innerHTML = this._win === 'min' ? UI.up : UI.min;
    wMin.setAttribute('aria-label', minWord);
    wMin.title = minWord;
    wMax.innerHTML = this._win === 'max' ? UI.restore : UI.max;
    wMax.setAttribute('aria-label', maxWord);
    wMax.title = `${maxWord} (or double-click the title bar)`;
    (this._el.querySelector('.ap-head') as HTMLElement).title = this._win === 'min' ? 'Drag to move; click to restore' : '';
    this._part('minprog').innerHTML = `<b>${t.all - t.yours - t.open}</b> of ${t.all} ready · ${t.todo} to do`;
    const narrow = this._narrow();
    const grid = this._part('grid');
    grid.classList.toggle('out-open', this._outOpen);
    grid.classList.toggle('no-out', this._hideOut && !narrow);
    grid.classList.toggle('no-rt', this._hideRt);
    const po = this._part('paneout'), pr = this._part('panert');
    const outShown = narrow ? this._outOpen : !this._hideOut;
    po.setAttribute('aria-expanded', String(outShown));
    po.setAttribute('aria-label', `${outShown ? 'Hide' : 'Show'} the outline ([)`);
    po.title = `${outShown ? 'Hide' : 'Show'} the outline ([)`;
    po.classList.toggle('folded', this._hideOut && !narrow);
    pr.classList.toggle('folded', this._hideRt);
    pr.setAttribute('aria-expanded', String(!this._hideRt));
    pr.setAttribute('aria-label', `${this._hideRt ? 'Show' : 'Hide'} the paragraph panel (])`);
    pr.title = `${this._hideRt ? 'Show' : 'Hide'} the paragraph panel (])`;
    this._renderOutline(doc, t);
    this._renderPage(doc, copy);
    this._renderRight(doc, t);
    this._applySizes();
    if (this._menu) this._renderMenu();
    this._toast();
  }

  /** Progress, filters and the top-level paragraphs, each with the worst state under it. */
  private _renderOutline(doc: AprcDoc, t: Tally): void {
    const box = this._part('out');
    if (this._hideOut && !this._narrow()) {
      box.innerHTML = `<button class="ap-rail" data-a="pane" data-v="out" aria-expanded="false" aria-label="Show the outline ([)" title="Show the outline ([)">${UI.paneL}<span class="v">Outline</span>${t.todo ? `<b title="${t.todo} to do">${t.todo}</b>` : ''}</button>`;
      return;
    }
    const listTop = box.querySelector('.ap-list')?.scrollTop ?? 0;
    const focused = box.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset : null;
    const ready = t.all - t.yours - t.open;
    const seg = (n: number, cls: string, word: string) => (n ? `<i class="${cls}" style="flex:${n}" title="${word}: ${n}"></i>` : '');
    let h = `<div class="ap-prog"><div class="ap-prog-h"><b>${ready}</b><span>of ${t.all} ready for the fair copy</span></div>`;
    h += `<div class="ap-bar" role="img" aria-label="${ready} of ${t.all} paragraphs print; ${t.todo} to do">${seg(t.written, 'b-written', WORD.written)}${seg(t.stale, 'b-stale', WORD.stale)}${seg(t.accepted, 'b-accepted', WORD.accepted)}${seg(t.gr, 'b-gr', WORD.gr)}${seg(t.map, 'b-map', WORD.map)}${seg(t.open, 'b-open', WORD.open)}</div>`;
    const n: Record<AprcFilter, number> = { all: t.all, todo: t.todo, open: t.open, stale: t.stale, written: t.written + t.stale };
    h += `<div class="ap-chips" role="group" aria-label="Show">${FILTERS.filter((x) => x.f !== 'stale' || t.stale || this._filter === 'stale')
      .map((x) => `<button class="ap-chip" data-a="filter" data-v="${x.f}" aria-pressed="${this._filter === x.f}">${x.label} <b>${n[x.f]}</b></button>`)
      .join('')}</div>`;
    if (t.open) h += `<button class="ap-btn sm" data-a="accept-all" title="Take every open proposal as it stands; you can take any back">Accept all ${t.open} proposal${t.open === 1 ? '' : 's'}</button>`;
    h += '</div><div class="ap-list">';

    let rows = '', pending = '', any = false;
    for (const l of lines(doc)) {
      if (l.type === 'part') pending = `<div class="ap-ph">${esc(asWords(l.title))}</div>`;
      else if (l.type === 'group') pending += `<div class="ap-gh">${esc(l.title)}</div>`;
      else if (l.depth === 0) {
        const r = this._rollup(l.p);
        if (!r.match) continue;
        any = true;
        const sel = this._sel === l.p.id || !!this._sel?.startsWith(`${l.p.id}.`);
        const ct = r.match >= 2 ? `<span class="ap-ct" title="${r.match} ${this._filter === 'all' ? 'paragraphs' : 'shown'} under it">${r.match}</span>` : '<span></span>';
        rows += pending;
        pending = '';
        rows += `<button class="ap-it${sel ? ' sel' : ''}" data-a="sel" data-v="${esc(r.first)}"${sel ? ' aria-current="true"' : ''} title="${esc(`${l.p.head ?? asWords(l.part.title)}: ${WORD[r.worst].toLowerCase()}`)}">${ico(r.worst)}<span class="ap-no">${esc(l.label.replace('.', ''))}</span><span class="ap-nm">${esc(l.p.head ?? asWords(l.part.title))}<span class="ap-sr">, ${esc(WORD[r.worst])}</span></span>${ct}</button>`;
      }
    }
    if (!any) {
      const EMPTY: Record<AprcFilter, string> = {
        all: 'No paragraphs.',
        todo: 'Nothing left to do: every paragraph prints in the fair copy.',
        open: 'No open proposal.',
        stale: 'None: the ground under your words has not changed.',
        written: 'Nothing written yet. Select a paragraph and write in the box on the right.',
      };
      rows = `<div class="ap-empty">${EMPTY[this._filter]}</div>`;
    }
    box.innerHTML = `${h}${rows}</div>`;
    const list = box.querySelector('.ap-list') as HTMLElement;
    list.scrollTop = listTop;
    if (focused?.a) (box.querySelector(`[data-a="${focused.a}"]${focused.v ? `[data-v="${CSS.escape(focused.v)}"]` : ''}`) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /**
   * The worst state under a top-level paragraph (under a filter: the worst of those the filter shows), how many under it
   * the filter shows (all: how many to do), and the first of them (a click on the row goes there).
   */
  private _rollup(p: AprcPara): { worst: ParaStatus; match: number; first: string } {
    const f = this._filter;
    let worst: ParaStatus = 'head', match = 0, todo = 0, seen = 0, first = '';
    const go = (q: AprcPara) => {
      const s = statusOf(q);
      const hit = f !== 'all' && inFilter(s, f);
      if ((f === 'all' || hit) && WORST.indexOf(s) < WORST.indexOf(worst)) worst = s;
      if (s !== 'head') seen++;
      if (TODO.has(s)) todo++;
      if (hit) {
        match++;
        if (!first) first = q.id;
      }
      q.children.forEach(go);
    };
    go(p);
    if (f === 'all') match = seen ? Math.max(1, todo) : 1;
    return { worst, match, first: first || p.id };
  }

  private _renderPage(doc: AprcDoc, copy: AprcCopy): void {
    const page = this._part('page');
    const key = `${this._docVer}|${copy}|${doc === this._doc}`;
    if (this._pageKey !== key) {
      const top = page.scrollTop;
      page.innerHTML = `<div class="aprc-doc">${bodyHtml(doc, copy)}</div>`;
      page.scrollTop = top;
      this._pageKey = key;
    }
    for (const x of page.querySelectorAll('.ap-p.sel')) x.classList.remove('sel');
    if (this._sel) page.querySelector(`.ap-p[data-id="${CSS.escape(this._sel)}"]`)?.classList.add('sel');
  }

  private _renderRight(doc: AprcDoc, t: Tally): void {
    const rt = this._part('rt');
    if (this._hideRt) {
      const no = this._sel ? numberOf(doc, this._sel) : '';
      rt.innerHTML = `<button class="ap-rail" data-a="pane" data-v="rt" aria-expanded="false" aria-label="Show the paragraph panel (])" title="Show the paragraph panel (])">${UI.paneR}<span class="v">Paragraph${no ? ` ${esc(no)}` : ''}</span></button>`;
      rt.dataset.sel = '';
      return;
    }
    const same = rt.dataset.sel === (this._sel ?? '');
    const ta0 = rt.querySelector('.ap-ed textarea') as HTMLTextAreaElement | null;
    const hadFocus = !!ta0 && document.activeElement === ta0;
    const caret = hadFocus && ta0 ? [ta0.selectionStart, ta0.selectionEnd] : null;
    const bodyTop = rt.querySelector('.ap-rt-body')?.scrollTop ?? 0;
    const p = this._sel ? find(doc, this._sel) : null;

    const nav = `<div class="ap-rt-nav"><button class="ap-btn icon sm ghost" data-a="prev" aria-label="Previous paragraph (Up)" title="Previous paragraph (↑)">${UI.prev}</button><button class="ap-btn icon sm ghost" data-a="next" aria-label="Next paragraph (Down)" title="Next paragraph (↓)">${UI.next}</button><span class="ap-rt-no">${p ? esc(numberOf(doc, p.id)) : ''}</span><span class="sp"></span><button class="ap-btn sm" data-a="next-todo" ${t.todo ? '' : 'disabled'} title="The next paragraph to write or judge (N)">Next to do <b>${t.todo}</b></button></div>`;
    rt.innerHTML = `${nav}<div class="ap-rt-body">${p ? this._paraHtml(doc, p) : this._introHtml(doc, t)}</div>`;
    rt.dataset.sel = this._sel ?? '';

    const body = rt.querySelector('.ap-rt-body') as HTMLElement;
    if (same) body.scrollTop = bodyTop;
    if (same && hadFocus && caret) {
      const ta = rt.querySelector('.ap-ed textarea') as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(caret[0] ?? ta.value.length, caret[1] ?? ta.value.length);
      }
    }
  }

  /** Nothing selected: how the sheet is worked, what the marks mean, the keys. */
  private _introHtml(doc: AprcDoc, t: Tally): string {
    const read = !!doc.frame;
    let h = `<h3 class="ap-rt-h">Work through the appreciation</h3><ol class="ap-steps">`;
    h += `<li class="${read ? 'done' : ''}"><b>Read the map.</b> It drafts what the ground and the symbols can tell. Your words are kept on every Read.${read || this._busy ? '' : `<br><button class="ap-btn pri sm" data-a="read">${UI.read}Read</button>`}</li>`;
    h += `<li class="${read && !t.todo ? 'done' : ''}"><b>Settle each paragraph.</b> Accept a proposal, write what is yours, look again where the Gr changed.${t.todo ? `<br><button class="ap-btn sm" data-a="next-todo">Start with the first to do (${t.todo})</button>` : ''}</li>`;
    h += `<li><b>Export</b> the fair copy to Word or PDF, or make the Briefing slides.</li></ol>`;
    h += `<div class="ap-sec"><h5>What the marks mean</h5><ul class="ap-legend">${MEANS.map(([s, d]) => `<li>${ico(s)}<span><b>${esc(WORD[s])}.</b> <span class="d">${esc(d)}</span></span></li>`).join('')}</ul></div>`;
    h += `<div class="ap-sec"><h5>Keys</h5><dl class="ap-keys"><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Previous, next paragraph</dd><dt><kbd>N</kbd></dt><dd>Next to do</dd><dt><kbd>A</kbd></dt><dd>Accept the proposal</dd><dt><kbd>Enter</kbd></dt><dd>Write in the paragraph (or double-click it)</dd><dt><kbd>Ctrl</kbd> + <kbd>Enter</kbd></dt><dd>Save as yours</dd><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Fold the outline, the paragraph panel</dd><dt><kbd>Esc</kbd></dt><dd>Leave the box; again to close</dd></dl></div>`;
    if (doc.confirm.length) h += `<div class="ap-sec"><h5>Confirm on Gr (${doc.confirm.length})</h5><ul>${doc.confirm.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></div>`;
    return h;
  }

  /** The selected paragraph: its state, what to do about it, the box, its table, what it rests on. */
  private _paraHtml(doc: AprcDoc, p: AprcPara): string {
    const s = statusOf(p);
    const num = numberOf(doc, p.id);
    const part = lines(doc).find((l) => l.type === 'para' && l.p.id === p.id);
    const head = p.head ?? (part && part.type === 'para' ? asWords(part.part.title) : '');
    let h = `<h3 class="ap-rt-h"><span class="ap-rt-n">${esc(num)}</span>${esc(head)}</h3>`;
    if (s !== 'head') h += `<div class="ap-badges"><span class="ap-badge st-${s}">${ICON[s]}${esc(WORD[s])}</span></div>`;

    if (s === 'stale') {
      h += `<div class="ap-call stale"><div class="ap-call-t">${ICON.stale}The Gr reading changed after you wrote this</div><p>It now reads:</p><div class="ap-quote">${esc(p.draft ?? '')}</div><div class="ap-acts"><button class="ap-btn" data-a="keep">Keep mine</button><button class="ap-btn" data-a="give">Use the new reading</button></div></div>`;
    } else if (s === 'open') {
      h += `<div class="ap-call judge"><div class="ap-call-t">${ICON.open}A proposal for you to judge</div><p>It prints in the fair copy only once you accept it, or write your own in the box.</p><div class="ap-acts"><button class="ap-btn pri" data-a="acc">Accept <kbd>A</kbd></button></div></div>`;
    } else if (s === 'accepted') {
      h += `<div class="ap-call done">${ICON.accepted}<span class="sp">Accepted: it prints as it stands.</span><button class="ap-btn sm ghost" data-a="acc" data-v="off">Take back</button></div>`;
    } else if (s === 'gr' || s === 'map') {
      h += `<p class="ap-lead">${s === 'gr' ? 'Drafted from the ground reading.' : 'Read from the symbols on the map and the last Check my plan.'} It prints as it stands. Edit it, or save it as yours, and Read will not change it.</p>`;
    } else if (s === 'yours') {
      h += `<p class="ap-lead">The map cannot tell this. Write it, or it prints a ruled line.</p>`;
    } else if (s === 'head') {
      h += `<p class="ap-lead">A heading: its sub-paragraphs carry the words. You may add words under the heading.</p>`;
    }

    // the box
    const dirty = this._dirty?.id === p.id ? this._dirty.text : null;
    const cur = dirty ?? p.mine?.text ?? (p.draft || '');
    const changed = dirty !== null && this._isChanged();
    const canSave = changed || (!p.mine && !!cur.trim());
    const ph = p.prompts.length ? p.prompts.join(' · ') : p.table && !p.draft ? 'Words before the table (optional)' : s === 'head' ? 'Words under the heading (optional)' : 'Write this paragraph';
    const lab = p.mine ? 'Your words' : s === 'gr' || s === 'map' || s === 'open' || s === 'accepted' ? 'The draft: edit to make it yours' : 'Your words';
    h += `<div class="ap-ed${s === 'head' ? ' small' : ''}"><div class="ap-ed-h"><label for="ap-ed-ta">${lab}</label><span class="ap-dirty"${changed ? '' : ' hidden'}>Not saved</span></div>`;
    h += `<textarea id="ap-ed-ta" placeholder="${esc(ph)}">${esc(cur)}</textarea>`;
    h += `<div class="ap-acts"><button class="ap-btn${changed ? ' pri' : ''}" data-a="save" ${canSave ? '' : 'disabled'} title="Make it yours: Read never overwrites it">Save as mine</button><span class="ap-kh"><kbd>Ctrl</kbd> + <kbd>Enter</kbd></span><span class="sp"></span>${p.mine && s !== 'stale' ? `<button class="ap-btn sm ghost" data-a="give" title="Drop your words and take the tool's draft again">Give back to the tool</button>` : ''}</div></div>`;

    // the table
    const tb = tableOf(p, 'draft');
    if (tb && p.table) {
      const added = p.addRows ?? 0;
      h += `<div class="ap-sec"><h5>Table</h5><p class="ap-mut">Type into any cell: what you type is yours and is never overwritten. Empty a cell to take the tool's value back.</p><div class="ap-tblw"><table class="ap-tbl" style="min-width:${Math.max(100, tb.head.length * 84)}px"><colgroup>${tb.head.map((_, c) => `<col style="width:${(((tb.widths ?? [])[c] ?? 1 / tb.head.length) * 100).toFixed(0)}%">`).join('')}</colgroup><tr>${tb.head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>`;
      tb.rows.forEach((row, r) => {
        h += `<tr>${row.map((v, c) => `<td><input data-cell="${r},${c}" value="${esc(v)}" aria-label="${esc(tb.head[c])}, row ${r + 1}"${p.cells?.[`${r},${c}`] !== undefined ? ' class="mine"' : ''}></td>`).join('')}</tr>`;
      });
      h += `</table></div><div class="ap-acts"><button class="ap-btn sm" data-a="addrow">Add a row</button>${added ? '<button class="ap-btn sm ghost" data-a="delrow">Remove the last added row</button>' : ''}</div></div>`;
    }

    // sub-paragraphs
    if (p.children.length) {
      const kids: string[] = [];
      const go = (q: AprcPara) => {
        const qs = statusOf(q);
        if (qs !== 'head') kids.push(`<button class="ap-it" data-a="sel" data-v="${esc(q.id)}" title="${esc(WORD[qs])}">${ico(qs)}<span class="ap-no">${esc(numberOf(doc, q.id))}</span><span class="ap-nm">${esc(q.head ?? (shown(q, 'draft').text ?? '').slice(0, 60))}<span class="ap-sr">, ${esc(WORD[qs])}</span></span></button>`);
        q.children.forEach(go);
      };
      p.children.forEach(go);
      if (kids.length) h += `<div class="ap-sec"><h5>Under it</h5><div class="ap-kids">${kids.join('')}</div></div>`;
    }

    if (p.prompts.length) h += `<div class="ap-sec"><h5>To consider</h5><ul>${p.prompts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    if (p.basis.length) {
      const KIND: Record<string, string> = { data: 'Data', rule: 'Rule', input: 'Input', calc: 'Worked out' };
      h += `<div class="ap-sec"><h5>Rests on</h5><ul>${p.basis.map((b) => `<li><span class="ap-tag">${esc(KIND[b.kind] ?? b.kind)}</span>${esc(b.text)}</li>`).join('')}</ul></div>`;
    }
    const conf = doc.confirm.filter((x) => x.paras.some((id) => p.id === id || p.id.startsWith(`${id}.`)));
    if (conf.length) h += `<div class="ap-sec"><h5>Confirm on Gr</h5><ul>${conf.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></div>`;
    return h;
  }

  /** The last message as a toast: it stays a few seconds (longer for a failure) and is read out once. */
  private _toast(): void {
    if (!this._el || this._toastSeq === this._msgSeq) return;
    this._toastSeq = this._msgSeq;
    const el = this._part('toast');
    const msg = this._msg;
    if (!msg || this._busy) return;
    const err = /fail|refused|need|cannot|not available|type HH:MM|no open/i.test(msg);
    el.innerHTML = `${err ? UI.err : UI.ok}<span>${esc(msg)}</span>`;
    el.classList.toggle('err', err);
    el.classList.add('on');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('on'), err ? 9000 : 4500);
  }
}
