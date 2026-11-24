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
  STALE_MARK, accept, acceptAll, addRow, applyPatches, aprcKinds, attkHeads, carryOver, cellTyped, counts, dropMoved, find, isStale, keepMoved, keepUnread, lines, markChanges, newDoc, normLimits, normalizeDoc, numberOf, restoreDiscarded, retime, setCell, setMine, shown, staleWhy, tableOf, toText, walk,
  type AprcConfirm, type AprcCopy, type AprcDoc, type AprcFigure, type AprcKind, type AprcLimits, type AprcPara, type AprcPatch, type AprcSrc,
} from './AprcModel';
import { nightOf, parseDTime, styleNotes, writeMechs, type AprcClimb, type AprcMechsIn, type AprcNight } from './AprcMechs';
import { casEstimate, casGroupsOf, gunUnitFor, liftDraft, readHeads, type AprcCasGroup } from './AprcBooks';
import {
  attkFirst, hSumFromText, lightTimes, parseHHour, writeAdm, writeAir, writeAttkDir, writeAttkPlan, writeCoyTasks, writeEnemy, writeFire, writeGround, writeGroundWdr, writePlan, writeStrength, writeSymbols, writeTasks, writeTimeCalcAttk, writeTimeData, writeTimeReq, zoneWord,
  type AprcAdmIn, type AprcAirIn, type AprcAttkIn, type AprcAttkPlanIn, type AprcAvenueIn, type AprcCheckIn, type AprcCoyIn, type AprcEnemyIn, type AprcFireIn, type AprcForceUnit, type AprcGroundIn, type AprcHSumIn, type AprcObsn, type AprcStrengthIn, type AprcSymbolIn, type AprcTimeDataIn, type AprcTimeIn,
} from './AprcWrite';
import { APRC_DOC_CSS, aprcFileBase, bodyHtml, esc, printHtml } from './AprcHtml';
import { setSetting } from '../../Support/SettingsBus';
import { DOCX_MIME, docxFiles, type DocxImage } from './AprcDocx';
import { APRC_DECKS, DECK_THEME, buildDeck, deckSideOfReading, mergeDeck, type AprcDeckKind, type DeckMap, type DeckOptions } from './AprcDeck';

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
  /** Hours east of UTC for first / last light and the read time: the place's zone, never the computer's (5: Pakistan Standard Time). */
  utcOffsetH: number;
  /** D Day's date ("YYYY-MM-DD"): first / last lt and the moon are worked out for it; empty takes today. */
  dDay: string;
  /** Time now as a D-time ("D-1 1000"): the time aval and the essential timings run from it; empty leaves them out. */
  timeNow: string;
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
  utcOffsetH: 5,
  dDay: '',
  timeNow: '',
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
  /** The Admin Area finder (its `result`), when the host passes it: Adm and Log from its best sites. */
  adminArea?: () => any | null;
}

/** The readings whose paragraphs the mechanics may re-time when a sheet input (H, D Day, time now, a limitation) changes. */
const MECHS_FROM: AprcSrc[] = ['gr', 'en', 'plan', 'time', 'aim', 'map'];

/** The mechanics' inputs a Read gathers; the sheet's own (kind, limits, H, time now, the night, the zone) are added when applied. */
type MechsCtx = Omit<AprcMechsIn, 'kind' | 'limits' | 'hHour' | 'timeNow' | 'night' | 'zone'>;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (dx: number, dy: number): string => COMPASS[Math.round((((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360) / 45) % 8];
const mercToLngLat = (x: number, y: number): [number, number] => [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
const lngLatToMerc = (lng: number, lat: number): [number, number] => [(lng * Math.PI * R) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
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
${P}.win-min{top:132px;bottom:auto;left:auto;right:16px;transform:none;height:auto;width:min(540px,calc(100vw - 20px))}
${P}.win-min>:not(.ap-head):not(.ap-busy):not(.ap-toast){display:none!important}
${P}.win-min .ap-head{border-radius:12px;border-bottom:0;cursor:grab;touch-action:none}
${P}.win-min.dragging{user-select:none;box-shadow:0 18px 44px rgba(0,0,0,.6)}
${P}.win-min.dragging .ap-head{cursor:grabbing}
${P}.win-min .ap-head :is(.ap-select,[data-a="menu"]){display:none}
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
${P} .ap-ptool{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:10px;row-gap:6px;padding:8px 14px;border-bottom:1px solid var(--ap-hair-soft);background:var(--ap-bg)}
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
${P} .ap-hfield input[type=date]{width:132px;color-scheme:dark}
${P} .ap-hfield input.wide{width:96px}
${P} .ap-lims{display:grid;grid-template-columns:1fr;gap:7px;margin:0 0 14px;padding:11px 12px;border-radius:8px;border:1px solid var(--ap-hair);background:rgba(255,255,255,.03);font-size:13px}
${P} .ap-lims h5{margin:0 0 2px;font-size:13px;font-weight:700;color:var(--ap-strong)}
${P} .ap-lims label{display:flex;align-items:center;gap:8px;color:var(--ap-tx);line-height:1.35}
${P} .ap-lims input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--ap-accent)}
${P} .ap-lims input[type=text],${P} .ap-lims input[type=number],${P} .ap-lims select{height:26px;padding:0 7px;border-radius:6px;border:1px solid var(--ap-edge);background:var(--ap-field);color:var(--ap-tx);font-size:12.5px}
${P} .ap-lims input[type=text]{flex:1;min-width:0}
${P} .ap-lims input[type=number]{width:62px}
${P} .ap-lims textarea{width:100%;min-height:44px;padding:5px 7px;border-radius:6px;border:1px solid var(--ap-edge);background:var(--ap-field);color:var(--ap-tx);font:inherit;font-size:12.5px;resize:vertical}
${P} .ap-lims .ap-mut{margin:2px 0 0;color:var(--ap-soft);font-size:12px;line-height:1.4}
${P} .ap-call.style{border-color:rgba(142,193,234,.45);background:rgba(142,193,234,.06)}
${P} .ap-call.style ul{margin:4px 0 0;padding-left:18px;color:var(--ap-label)}
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
${P} .ap-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--ap-gr)}
${P} .ap-dot.busy{background:var(--ap-accent);animation:ap-pulse 1s ease-in-out infinite alternate}
${P} .ap-dot.err{background:var(--ap-stale)}
${P} .ap-dot.idle{background:var(--ap-yours)}
@keyframes ap-pulse{from{opacity:.35}to{opacity:1}}
${P} .ap-ask{flex:none;display:flex;align-items:center;gap:10px;margin:10px 12px 0;padding:8px 10px 8px 12px;border-radius:8px;border:1px solid var(--ap-accent);background:var(--ap-accent-bg);color:var(--ap-strong);font-size:13.5px}
${P} .ap-ask .ap-note-t{flex:1;min-width:0}
${P} .ap-chg{display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%;background:var(--ap-accent)}
${P} .ap-lastread{margin-top:10px;color:var(--ap-label);font-size:12.5px;line-height:1.45}
${P} .ap-lastread button{padding:0;border:0;background:none;color:var(--ap-accent);font:inherit;font-weight:650;cursor:pointer;text-decoration:underline}
${P} .ap-call.chg{border-color:rgba(142,193,234,.45);background:rgba(142,193,234,.08)}
${P} .ap-call.chg .ap-call-t .ap-chg{width:9px;height:9px}
${P} .ap-toast.act{pointer-events:auto}
${P} .ap-toast .ap-btn{height:26px;padding:0 10px;font-size:12.5px}
${P} .ap-log{padding:4px 10px 6px;font-size:13px;line-height:1.4;color:var(--ap-tx)}
${P} .ap-log time{display:inline-block;min-width:44px;color:var(--ap-soft);font-variant-numeric:tabular-nums}
${P} .ap-log.err{color:#ffb4b5}
${APRC_DOC_CSS}
${P} .ap-page .aprc-doc{font-size:10.5pt}
`;

let cssDone = false;
/** Sheets holding the style: the last one destroyed takes it out of <head>. */
let cssUsers = 0;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-aprc-css';
  st.textContent = STYLE;
  document.head.appendChild(st);
}
function releaseCss(): void {
  cssUsers = Math.max(0, cssUsers - 1);
  if (cssUsers || typeof document === 'undefined') return;
  document.getElementById('ms-aprc-css')?.remove();
  cssDone = false;
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
  if (p.moved) return 'stale';
  if (p.draft === '' && !p.table) return 'head';
  if (p.draft === null && !p.table) return 'yours';
  if (p.state === 'judge') return p.accepted ? 'accepted' : 'open';
  if (p.state === 'yours') return p.cells ? 'written' : 'yours';
  return p.state;
}

const WORD: Record<ParaStatus, string> = {
  head: 'Heading',
  stale: 'Changed under your words',
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
  ['stale', 'Look again: keep yours or take the new reading. It says what changed: Gr, map, plan check, en options, ORBAT, timings or H.'],
];

/** What changed under the planner's words, in the paragraph panel. */
const STALE_WORD: Record<AprcSrc | 'rows', string> = {
  gr: 'The Gr reading changed after you wrote this',
  map: 'The symbols on the map changed after you wrote this',
  plan: 'The plan check changed after you wrote this',
  en: 'The en options (the IPB reading) changed after you wrote this',
  orbat: 'The ORBAT figures changed after you wrote this',
  time: 'The timings worked out from H and the Time Req changed after you wrote this',
  h: 'H changed since you wrote this',
  aim: "The aim's limitations changed since you wrote this",
  rows: 'Rows you typed in are gone from the new reading: your figures are kept as added rows',
};
/** What a reading is called in the sheet. */
const SRC_WORD: Record<AprcSrc, string> = { gr: 'Gr', map: 'map', plan: 'plan check', en: 'en options', orbat: 'ORBAT', time: 'timings', h: 'H', aim: "aim's limitations" };

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
  log: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.6V8l2.3 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  stop: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/></svg>',
};

/** Messages that read as a failure or a refusal (the toast's red, the history's mark). */
const ERR_RE = /fail|refused|need|cannot|not available|type HH:MM|no open|nothing to undo/i;

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

type AprcFilter = 'all' | 'todo' | 'open' | 'stale' | 'written' | 'changed';
const FILTERS: Array<{ f: AprcFilter; label: string }> = [
  { f: 'all', label: 'All' },
  { f: 'todo', label: 'To do' },
  { f: 'open', label: 'Proposals' },
  { f: 'stale', label: 'Look again' },
  { f: 'changed', label: 'Changed' },
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
    if (!v) return;
    const err = ERR_RE.test(v);
    this._dotErr = err;
    this._log.unshift({ at: new Date(), msg: v, err });
    this._log.length = Math.min(this._log.length, 10);
  }
  /** The last ten messages, newest first (the toast fades; these stay, under the clock button). */
  private _log: Array<{ at: Date; msg: string; err: boolean }> = [];
  /** The last message was a failure: the minimized bar's dot shows it. */
  private _dotErr = false;
  /** What Read is doing now, and since when (shown in the header while busy). */
  private _step = '';
  private _busyAt = 0;
  private _busyTick: ReturnType<typeof setInterval> | null = null;
  /** Timers the sheet set (print, downloads): cleared on destroy. */
  private _timers = new Set<ReturnType<typeof setTimeout>>();
  private _printFrame: HTMLIFrameElement | null = null;
  /** The last change that can be undone, until the next change: the document before it. */
  private _undo: { label: string; json: string; ver: number; seq: number } | null = null;
  /** A question in the sheet (its own style, not the browser's confirm). */
  private _askState: { text: string; yes: string; no: string; resolve: (v: boolean) => void } | null = null;
  private _cssHeld = false;
  /** The en options' and timings' inputs of the last Read, so a new H re-times them without reading again. */
  private _lastTime: AprcTimeDataIn | null = null;
  private _lastHSum: AprcHSumIn | null = null;
  /** What the two Aprc books' mechanics need from the last Read (re-applied on H, D Day, time now or a limitation). */
  private _mx: MechsCtx | null = null;
  private _mxKind: AprcKind | null = null;
  /** The MITG's place (lng, lat) of the last reading: the night of D Day is worked out there. */
  private _mxLL: [number, number] | null = null;
  private _note = '';
  private _sel: string | null = null;
  /** The outline's filter. */
  private _filter: AprcFilter = 'all';
  /** The menu open under the header, if any. */
  private _menu: 'export' | 'more' | 'log' | null = null;
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
  /** The last ground reading (its AOR trace is drawn again, dark, for the slides). */
  private _aor: { reading: AorReading; frame: AorFrame } | null = null;
  /** A Read finished in this session (so `_lastEnemy` is what that reading found, not missing after a reload). */
  private _readHere = false;
  private _slideMaps: DeckOptions['maps'] | null = null;

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

  /**
   * Set options. A new kind for a sheet that holds a document of the other kind goes the way the sheet's own kind
   * select goes (asked first when the planner has written in it, the sheet cleared with an Undo, read again if it was
   * read): a host or the settings widget cannot drop his words without asking.
   */
  setOptions(o: Partial<GroundAppreciationOptions>): void {
    const rest: Partial<GroundAppreciationOptions> = { ...(o ?? {}) };
    const want = rest.kind;
    if (want && this._enabled && this._doc && want !== this._doc.kind && aprcKinds().find((k) => k.kind === want)?.ready) {
      delete rest.kind;
      void this._changeKind(want);
    }
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null)) } as GroundAppreciationOptions;
    if (!aprcKinds().find((k) => k.kind === this._opts.kind)?.ready) this._opts.kind = 'def';
    if (!Number.isFinite(Number(this._opts.utcOffsetH)) || Math.abs(Number(this._opts.utcOffsetH)) > 14) this._opts.utcOffsetH = DEFAULT_GROUND_APPRECIATION_OPTIONS.utcOffsetH;
    if (String(this._opts.orbatUrl || '') !== this._orbatBase) this._orbat = undefined;
    if (this._enabled) this._render();
  }

  /** Keep a choice made in the sheet in the settings too, so a later settings change does not undo it. */
  private _persist(key: keyof GroundAppreciationOptions, value: unknown): void {
    try {
      if (typeof window !== 'undefined' && (window as any).symbolEngine) setSetting(['groundAppreciation', key], value);
    } catch {
      /* no settings bus (a host without one): the choice holds for this session */
    }
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    if (!this._doc) {
      const kept = this._load();
      // the kept sheet decides the kind (it was saved under it), so it is never refused for a kind set elsewhere
      if (kept && kept.kind !== this._opts.kind) {
        this._opts.kind = kept.kind;
        this._persist('kind', kept.kind);
      }
      this._doc = kept ?? newDoc(this._opts.kind);
    }
    EngineLogger.nextStep(ENGINE, 'Aprc on: open the sheet and press Read');
    // a kept sheet's line of denial to the Ground Guide's AOR trace
    this._syncDenial();
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._readSeq++;
    this._busy = false;
    this._stopBusyClock();
    this.openPanel(false);
    // the line of denial it gave the Ground Guide goes with it
    this._syncDenial();
  }

  /** Off, and everything the sheet put in the page goes: its timers, listeners, the print frame, its style when it is the last. */
  destroy(): void {
    this.disable();
    this._askState?.resolve(false);
    this._askState = null;
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = null;
    cancelAnimationFrame(this._resizeRaf);
    this._resizeRaf = 0;
    this._stopBusyClock();
    if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
    this._outside = null;
    this._printFrame?.remove();
    this._printFrame = null;
    this._el?.remove();
    this._el = null;
    if (this._cssHeld) {
      this._cssHeld = false;
      releaseCss();
    }
  }

  /** A timer the sheet keeps track of (cleared on destroy). */
  private _later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      this._timers.delete(t);
      fn();
    }, ms);
    this._timers.add(t);
    return t;
  }

  onViewChanged(): void {
    /* nothing is drawn on the map */
  }

  openPanel(open = true): void {
    if (!open) {
      // what was typed in the paragraph box is kept as the planner's
      if (this._open) this._commitDirty();
      this._askState?.resolve(false);
      this._closeMenu(false);
      this._open = false;
      this._el?.classList.remove('ms-open');
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
      return;
    }
    if (!this._enabled) return;
    if (!this._cssHeld) {
      this._cssHeld = true;
      cssUsers++;
    }
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
    el.style.right = '';
    el.style.bottom = '';
    el.style.transform = '';
    el.setAttribute('aria-modal', String(this._win === 'max'));
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
        el.style.right = 'auto';
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
  async read(o: { at?: [number, number] | null; from?: [number, number] | null; waitGuide?: boolean } = {}): Promise<AprcDoc | null> {
    if (!this._enabled) return null;
    // words typed in the paragraph box are the planner's before the new reading comes in
    this._commitDirty();
    const seq = ++this._readSeq;
    const live = (): boolean => seq === this._readSeq;
    this._busy = true;
    this._busyAt = Date.now();
    this._step = 'Starting';
    this._note = '';
    this._startBusyClock();
    this._render();
    const step = (s: string): void => {
      if (!live()) return;
      this._step = s;
      this._renderBusy();
    };
    const prev = this._doc;
    // an undo still open when Read starts (a clear or a kind change that asked for this Read) stays open after it
    const undoAtStart = this._undo && this._undo.ver === this._docVer ? this._undo : null;
    const doc = newDoc(this._opts.kind);
    const attk = doc.kind === 'attk';
    const wdr = doc.kind === 'wdr';
    // the line of denial the sheet holds (a def's limitation) is marked on the trace drawn by this Read
    const denial = prev && prev.kind === doc.kind && doc.kind === 'def' ? (prev.limits?.denial ?? null) : null;
    const notes: string[] = [];
    const at = this._clock();
    // readings not taken this time: what the previous sheet holds from them is kept
    const unread = new Set<AprcSrc>();
    const tag = (cs: AprcConfirm[], src: AprcSrc): AprcConfirm[] => cs.map((c) => ({ ...c, src }));
    let lastEnemy: AprcEnemyIn | null = null;
    let timeIn: AprcTimeDataIn | null = null;
    let hsum: AprcHSumIn | null = null;
    const ech0 = this._opts.echelon === 'coy' ? 'Coy' : this._opts.echelon === 'bde' ? 'Bde' : 'Bn';
    const mx: MechsCtx = { echelon: ech0, reading: null, ipbRows: [], planRows: [], check: null, planAdv: [], planDis: [], time: null, attk: null, attkPlan: null, hsum: null, enNear: {}, symbols: [] };
    // the doctrine books' heads that apply to this reading (AprcBooks.readHeads) and their drafts
    const books: { mounted: boolean; mountains: boolean; patches: AprcPatch[] } = { mounted: false, mountains: false, patches: [] };
    const rowsOf = (ps: Array<{ id: string; table?: { rows: string[][] } | null }>, id: string): string[][] => ps.find((x) => x.id === id)?.table?.rows ?? [];
    const advDis = (rows: Array<{ name: string; st: string; reason: string }>): void => {
      const say = (x: { name: string; reason: string }): string => `${x.name}: ${x.reason}`.replace(/\.$/, '');
      mx.planAdv = rows.filter((x) => x.st === 'pass').map(say);
      mx.planDis = rows.filter((x) => x.st === 'fail' || x.st === 'warn').map(say);
    };
    try {
      // 1. the ground, through the Ground Guide (the attack: round the obj, from own side)
      let guide = this._host.guide?.() ?? null;
      const graphic = this._host.selected?.()[0] ?? null;
      const start = attk ? this._attkStart(o.from ?? null) : null;
      let aor: { reading: AorReading; frame: AorFrame } | null = null;
      // just turned on (`waitGuide`), or still loading its terrain data: wait until the data is in (or has failed)
      if (o.waitGuide || (guide?.isEnabled && guide.status?.state === 'loading')) {
        step('Waiting for the terrain data');
        guide = await this._guideSettled(seq);
        if (!live()) return null;
      }
      if (!guide?.isEnabled) notes.push('Ground Guide is off: the Gr paragraphs are not read.');
      else {
        step('Gr: the AOR');
        const so = this._opts;
        const side = attk ? (start ? { from: start.ll } : { away: true }) : {};
        aor = await withTimeout<{ reading: AorReading; frame: AorFrame } | null>(guide.aorAround(Array.isArray(o.at) ? o.at : null, { graphic, echelon: so.echelon === 'auto' ? undefined : so.echelon, profile: so.mover === 'auto' ? undefined : so.mover, ...side }), 60000);
        if (!live()) return null;
        if (!aor) notes.push(guide.status?.state === 'ready' ? 'The ground could not be read here: outside the terrain data, or it did not load in time.' : 'No terrain data: the Gr paragraphs are not read.');
      }
      if (!aor) ['gr', 'en', 'orbat', 'time'].forEach((k) => unread.add(k as AprcSrc));
      // an attack read with nothing marked says what it took, and how to put it right
      if (attk && aor) {
        if (!o.at && !graphic) notes.push('Obj: a VG symbol, else the map centre. Select the obj and Read again.');
        if (!start) notes.push('Own start not marked: taken opposite the threat. Check an attack plan (FUP or axis) and Read again.');
      }
      const threat = this._threatAt(aor?.reading ?? null);

      // 2. the symbols on the map
      step('Symbols on the map');
      const { symbols, drawn } = await this._symbols(aor?.reading ?? null);
      if (!live()) return null;
      const sym = writeSymbols(symbols, { attack: attk });
      mx.symbols = symbols;
      applyPatches(doc, sym.patches, 'map');
      doc.confirm.push(...tag(sym.confirm, 'map'));

      if (aor && attk) {
        const r = aor.reading;
        const ech = aor.frame.echelon;
        step('Apchs onto the obj (IPB)');
        const ipb = await this._ipbAttk(guide, r, start, ech);
        if (!live()) return null;
        mx.reading = r;
        mx.echelon = ech;
        mx.attk = ipb?.in ?? null;
        mx.enNear = this._enNear(r, drawn);
        if (r.country === 'Mountains') {
          books.mountains = true;
          books.patches.push(liftDraft('attk', ech));
        }
        const gin = await this._groundIn(guide, aor, graphic, sym.drawnObs, seq, step);
        if (!live() || !gin) return null;
        // the uphill assault in mountains: the climb from the SL / FUP to the obj off the 30 m elevation (MW Annex F)
        if (r.country === 'Mountains') {
          step('The climb to the obj');
          mx.climb = await this._climbIn(guide, r, gin.ground?.elevationM ?? null, ipb);
          if (!live()) return null;
        }
        gin.attack = true;
        gin.threatMarked = !!start;
        gin.startWords = start ? `${start.label ? `${start.label} ` : ''}${this._where(r, this._ground(r, start.merc))}` : null;
        if (ipb?.view?.wx) gin.wx = { marginal: ipb.view.wx.rows.filter((x: any) => x.status === 'marg').map((x: any) => `${x.mission} (${x.element})`), unfavourable: ipb.view.wx.rows.filter((x: any) => x.status === 'unfav').map((x: any) => `${x.mission} (${x.element})`) };
        const w = writeGround(gin);
        applyPatches(doc, w.patches, 'gr');
        doc.confirm.unshift(...tag(w.confirm, 'gr'));
        doc.frame = w.frame ?? null;
        if (ipb?.in) {
          const dw = writeAttkDir(ipb.in);
          applyPatches(doc, dw.patches, 'en');
          doc.confirm.push(...tag(dw.confirm, 'en'));
        } else {
          unread.add('en');
          notes.push('The dir of attk was not read (no apch onto the obj from own side).');
        }
        step('ORBAT');
        const orbat = await this._loadOrbat();
        if (!live()) return null;
        if (orbat) {
          const si = await this._strengthIn(orbat, r, ech, null, drawn, true);
          if (!live()) return null;
          if (si) {
            const sw = writeStrength(si, { attack: true, disposns: sym.ownWhere, mountains: r.country === 'Mountains' });
            applyPatches(doc, sw.patches, 'orbat');
            doc.confirm.push(...tag(sw.confirm, 'orbat'));
            books.mounted = si.own.some((u) => !!u.mounted);
            const cp = this._casPatch(orbat, si);
            if (cp) books.patches.push(cp);
          }
        } else {
          unread.add('orbat');
          notes.push(`No ORBAT at ${this._orbatBase || 'the ORBAT url'}: relative strength is counted from the symbols only.`);
        }
        applyPatches(doc, attkHeads(ech), 'gr');
        doc.sources = this._sources(guide);
        step('Figures');
        doc.figures = await this._figures(aor);
        if (!live()) return null;
      } else if (aor && wdr) {
        // the withdrawal (OoW Vol III): the MITG is the new def posn, its AOR the Gr forward of it the wdr crosses
        const r = aor.reading;
        if (!o.at && !graphic) notes.push('Wdr: the MITG is taken as the new def posn (a VG symbol, else the map centre). Select the new posn and Read again.');
        const gin = await this._groundIn(guide, aor, graphic, sym.drawnObs, seq, step);
        if (!live() || !gin) return null;
        if (threat) {
          gin.threatMarked = true;
          gin.threatWords = threat.words;
        }
        const w = writeGround(gin);
        applyPatches(doc, w.patches, 'gr');
        const ww = writeGroundWdr(r);
        applyPatches(doc, ww.patches, 'gr');
        // only the confirm items of paragraphs the withdrawal has
        doc.confirm.unshift(...tag([...w.confirm, ...ww.confirm].filter((c) => !c.paras.length || c.paras.some((id) => !!find(doc, id))), 'gr'));
        doc.frame = w.frame ?? null;
        mx.reading = r;
        mx.echelon = w.frame?.echelon ?? ech0;
        ['en', 'orbat'].forEach((k) => unread.add(k as AprcSrc));
        doc.sources = this._sources(guide);
        step('Figures');
        doc.figures = await this._figures(aor);
        if (!live()) return null;
      } else if (aor) {
        const r = aor.reading;
        step('En options (IPB)');
        const ipb = await this._ipb(guide, r, graphic, threat?.deg ?? null);
        if (!live()) return null;
        const gin = await this._groundIn(guide, aor, graphic, sym.drawnObs, seq, step);
        if (!live() || !gin) return null;
        if (threat) {
          gin.threatMarked = true;
          gin.threatWords = threat.words;
        }
        if (ipb?.wx) gin.wx = { marginal: ipb.wx.rows.filter((x: any) => x.status === 'marg').map((x: any) => `${x.mission} (${x.element})`), unfavourable: ipb.wx.rows.filter((x: any) => x.status === 'unfav').map((x: any) => `${x.mission} (${x.element})`) };
        const w = writeGround(gin);
        applyPatches(doc, w.patches, 'gr');
        doc.confirm.unshift(...tag(w.confirm, 'gr'));
        doc.frame = w.frame ?? null;
        mx.reading = r;
        mx.echelon = w.frame?.echelon ?? ech0;
        if (r.country === 'Mountains') {
          books.mountains = true;
          books.patches.push(liftDraft('def', mx.echelon));
        }
        const tw = writeTasks(r);
        applyPatches(doc, tw.patches, 'gr');
        let en: AprcEnemyIn | null = null;
        try {
          en = ipb ? this._enemyIn(ipb, r, sym.enForce, guide) : null;
        } catch (err) {
          console.warn('[Aprc] en options', err);
          notes.push('The en options could not be read from the IPB reading (a part of it was missing).');
        }
        lastEnemy = en;
        if (en) {
          const ew = writeEnemy(en);
          applyPatches(doc, ew.patches, 'en');
          mx.ipbRows = rowsOf(ew.patches, 'crs.react');
          doc.confirm.push(...tag(ew.confirm, 'en'));
        } else {
          unread.add('en');
          notes.push('The en options were not read (no avenue from the threat side).');
        }
        // the fire of own posns and his air, when the Extended View has read them at this place
        const fire = this._fireIn(ipb, r, guide);
        if (fire) {
          const fw = writeFire(fire);
          applyPatches(doc, fw.patches, 'en');
          doc.confirm.push(...tag(fw.confirm, 'en'));
        } else applyPatches(doc, ['killing', 'df', 'surv', 'obs'].map((k) => ({ id: `gr.ded.dp1.${k}`, prompts: ['From the fire of own posns: turn on the Extended View (F) with IPB fire at this place, mark own posns, and Read again'] })));
        const air = this._airIn(ipb, r, guide);
        if (air) {
          const aw = writeAir(air);
          applyPatches(doc, aw.patches, 'en');
          doc.confirm.push(...tag(aw.confirm, 'en'));
        }
        // the ORBAT: relative strength, Pls held against the tasks; time required (mine laying by its engineers)
        step('ORBAT');
        const orbat = await this._loadOrbat();
        if (!live()) return null;
        if (orbat) {
          const si = await this._strengthIn(orbat, r, w.frame?.echelon ?? 'Bn', tw.pls, drawn);
          if (!live()) return null;
          if (si) {
            const sw = writeStrength(si);
            applyPatches(doc, sw.patches, 'orbat');
            doc.confirm.push(...tag(sw.confirm, 'orbat'));
            const cp = this._casPatch(orbat, si);
            if (cp) books.patches.push(cp);
          }
        } else {
          unread.add('orbat');
          notes.push(`No ORBAT at ${this._orbatBase || 'the ORBAT url'}: relative strength is counted from the symbols only.`);
        }
        step('Time req');
        const tin = await this._timeIn(orbat, r, w.frame?.echelon ?? 'Bn', drawn);
        if (!live()) return null;
        const tr = writeTimeReq(tin);
        applyPatches(doc, tr.patches, 'orbat');
        const minesH = tin.mines ? [tin.mines.handH, tin.mines.mechH].filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null : null;
        mx.time = { moveH: tin.move ? tin.move.km / tin.move.kmh : null, prepH: tin.prep?.h[0] ?? null, minesH, reqH: tr.reqH };
        doc.confirm.push(...tag(tr.confirm, 'orbat'));
        const fdl = en ? en.avenues.flatMap((a) => (a.lines ?? []).filter((l) => l.role === 'FDLs').map((l) => l.h[0])) : [];
        timeIn = { hHour: this._hHour(guide), reqH: tr.reqH, fdlH: fdl.length ? Math.min(...fdl) : null };
        applyPatches(doc, writeTimeData(timeIn).patches, 'time');
        doc.sources = this._sources(guide);
        step('Figures');
        doc.figures = await this._figures(aor, denial);
        if (!live()) return null;
      } else if (this._opts.figures !== 'trace') {
        step('A shot of the map');
        const shot = await this._mapShot();
        if (!live()) return null;
        if (shot) doc.figures = [shot];
      }

      // 3. a checked plan: a defence for the defence, an attack for the attack
      step('Plan check');
      const rep: any = this._host.planCheck?.() ?? null;
      if (attk) {
        const ac = rep?.task === 'attack' ? this._attkCheckIn(rep, aor?.reading ?? null) : null;
        if (ac) {
          const pw = writeAttkPlan(ac);
          applyPatches(doc, pw.patches, 'plan');
          doc.confirm.push(...tag(pw.confirm, 'plan'));
          mx.attkPlan = ac;
          advDis([...ac.rows, ...ac.axes.flatMap((a) => a.rows.map((x) => ({ ...x, name: `${a.label}: ${x.name}` })))]);
        }
        hsum = rep?.task === 'attack' ? this._hSumOf(rep) : null;
        mx.hsum = hsum;
        applyPatches(doc, writeTimeCalcAttk(this._hHour(guide), hsum).patches, 'time');
      } else if (!wdr) {
        const chk = rep?.task === 'attack' ? null : this._checkIn();
        if (chk) {
          const pw = writePlan(chk);
          applyPatches(doc, pw.patches, 'plan');
          doc.confirm.push(...tag(pw.confirm, 'plan'));
          mx.check = chk;
          mx.planRows = rowsOf(pw.patches, 'crs.react');
          advDis(chk.rows);
          if (aor) applyPatches(doc, writeCoyTasks(this._coysIn(rep, aor.reading)).patches, 'plan');
        }
      }
      // adm: the Admin Area finder's last sites, when the host passes it
      const adm = this._admIn(aor?.reading ?? null);
      if (adm) {
        const aw = writeAdm(adm);
        applyPatches(doc, aw.patches, 'plan');
        doc.confirm.push(...tag(aw.confirm, 'plan'));
      }
      if (!live()) return null;

      // the doctrine books' heads where they apply (a mounted unit's dismounting area, mules and porters in mountains,
      // the cas estimate from the ORBAT), kept where the last sheet holds the planner's words in them
      readHeads(doc, { mounted: books.mounted, mountains: books.mountains, orbat: books.patches.some((x) => x.id === 'plan.adm.cas') }, prev, unread);
      applyPatches(doc, books.patches);

      // the two Aprc books' mechanics (the aim's limitations, the layout by them, the course, the Vis, the timings, the
      // attack's tests and Time Calc, the sketch list); what was not read this time is taken from the last Read
      const was = this._mxKind === doc.kind ? this._mx : null;
      if (was) {
        if (!mx.reading) Object.assign(mx, { reading: was.reading, echelon: was.echelon, enNear: was.enNear });
        if (unread.has('en')) Object.assign(mx, { ipbRows: was.ipbRows, attk: mx.attk ?? was.attk });
        if (!mx.time) mx.time = was.time;
      }
      if (prev && prev.kind === doc.kind && prev.limits) doc.limits = { ...prev.limits };
      if (aor) this._mxLL = mercToLngLat(...this._toMerc(aor.reading, aor.reading.mitg.at));
      const mw = writeMechs(this._mechsIn(doc, mx));
      applyPatches(doc, mw.patches);
      doc.confirm.push(...tag(mw.confirm, 'gr'));

      // what was not read this time: the previous reading of it is kept, never lost
      const same = prev && prev.kind === doc.kind ? prev : null;
      const kept = keepUnread(same, doc, unread);
      // the attack's heads by the echelon set, where no reading gave them
      if (attk && !aor) applyPatches(doc, attkHeads(this._opts.echelon === 'bn' ? 'Bn' : this._opts.echelon === 'bde' ? 'Bde' : 'Coy').filter((h) => !find(doc, h.id)?.src));
      doc.readAt = { ...(doc.readAt ?? {}) };
      for (const k of ['gr', 'map', 'plan', 'en', 'orbat', 'time'] as AprcSrc[]) if (!unread.has(k)) doc.readAt[k] = at;
      if (kept && same) {
        const was = (k: AprcSrc): string => same.readAt?.[k] ?? same.frame?.readAt ?? 'an earlier Read';
        let held = false;
        walk(doc, (p) => {
          if (p.src === 'gr') held = true;
        });
        if (unread.has('gr') && held) notes.unshift(`Gr not read this time: the reading of ${was('gr')} kept.`);
        let enHeld = false;
        walk(doc, (p) => {
          if (p.src === 'en') enHeld = true;
        });
        if (unread.has('en') && enHeld) notes.push(`En options not read this time: those of ${was('en')} kept.`);
      }
      // the same item from two readings is listed once
      doc.confirm = doc.confirm.filter((c, i, all) => all.findIndex((x) => x.text === c.text) === i);
      const changed = markChanges(this._wasRead(same) ? same : null, doc);
      carryOver(prev, doc);

      // only now does the sheet take the reading (an overtaken Read has changed nothing)
      this._doc = doc;
      this._docVer++;
      if (undoAtStart && this._undo === undoAtStart) undoAtStart.ver = this._docVer;
      else this._undo = null;
      this._readHere = true;
      if (aor) {
        this._aor = aor;
        this._slideMaps = null;
      }
      if (!unread.has('en') || !this._lastEnemy) this._lastEnemy = lastEnemy;
      this._mx = mx;
      this._mxKind = doc.kind;
      if (timeIn || !unread.has('time')) this._lastTime = timeIn;
      this._lastHSum = hsum;
      this._note = notes.join(' ');
      const c = counts(doc);
      this._msg = `Read: ${c.gr} from Gr, ${c.map} from the map, ${c.open} proposal${c.open === 1 ? '' : 's'} to judge${c.accepted ? `, ${c.accepted} accepted` : ''}, ${c.yours} yours${same && this._wasRead(same) ? `; ${changed} changed since the last Read` : ''}${kept ? `; ${kept} kept from before` : ''}`;
      EngineLogger.success(ENGINE, this._msg);
      if (this._undo) this._undo.seq = this._msgSeq;
      this._save();
      this._emit('aprc-read', { doc: this._doc });
      return this._doc;
    } catch (err) {
      console.error('[Aprc] read', err);
      if (live()) {
        this._msg = `Read failed: ${err instanceof Error ? err.message : String(err)}. The sheet is as it was.`;
        EngineLogger.error(ENGINE, this._msg);
      }
      return null;
    } finally {
      if (live()) {
        this._busy = false;
        this._stopBusyClock();
        this._render();
      }
    }
  }

  /** Stop a Read under way: nothing it found is taken, the sheet stays as it was. */
  cancelRead(): boolean {
    if (!this._busy) return false;
    this._readSeq++;
    this._busy = false;
    this._stopBusyClock();
    this._msg = 'Read cancelled: the sheet is as it was';
    this._render();
    return true;
  }

  private _startBusyClock(): void {
    this._stopBusyClock();
    this._busyTick = setInterval(() => this._renderBusy(), 1000);
  }
  private _stopBusyClock(): void {
    if (this._busyTick) clearInterval(this._busyTick);
    this._busyTick = null;
  }

  /** The step and the seconds in the header while Read runs (only that part of the sheet is drawn again). */
  private _renderBusy(): void {
    if (!this._el || !this._open || !this._busy) return;
    const secs = Math.max(0, Math.round((Date.now() - this._busyAt) / 1000));
    const frame = this._part('frame');
    frame.innerHTML = `<span>${esc(this._step || 'Reading')}…</span><span class="ap-fr-at">${secs} s</span>`;
    frame.title = 'Read is under way: Cancel stops it and leaves the sheet as it was';
    const dot = this._part('dot');
    dot.className = 'ap-dot busy';
    dot.title = `Reading: ${this._step}`;
  }

  /** The place's clock now ("2027-02-15 11:00"), in the zone set for the sheet (not the computer's). */
  private _clock(d = new Date()): string {
    return new Date(d.getTime() + Number(this._opts.utcOffsetH) * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  }

  /** The Threat marker the host passes: where it is in words and its bearing from the MITG; null when none is marked. */
  private _threatAt(r: AorReading | null): { ll: [number, number]; words: string; deg: number } | null {
    const t = this._host.threat?.() ?? null;
    if (!Array.isArray(t) || t.length !== 2 || !t.every((v) => Number.isFinite(v))) return null;
    if (!r) return { ll: [t[0], t[1]], words: 'the Threat marker', deg: NaN };
    const g = this._ground(r, lngLatToMerc(t[0], t[1]));
    const dx = g[0] - r.mitg.at[0], dy = g[1] - r.mitg.at[1];
    const named = !!r.mitg.name && r.mitg.name !== 'MITG';
    const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    return { ll: [t[0], t[1]], words: `the Threat marker, ${(Math.hypot(dx, dy) / 1000).toFixed(1)} km ${compass(dx, dy)} of ${named ? r.mitg.name : 'the MITG'}`, deg };
  }

  /** The IPB reading's view whose area is this one: the host reading's, else the Extended View's live one when it was read here. */
  private _liveAt(r: AorReading, guide: any): any | null {
    const lv: any = guide?.ipbApproaches?.() ?? null;
    if (!lv?.anchor) return null;
    const m = this._toMerc(r, r.mitg.at);
    return Math.hypot(lv.anchor[0] - m[0], lv.anchor[1] - m[1]) <= 2500 ? lv : null;
  }

  /** Own posns' fire on his avenues (the IPB fire reading), when it is there for this place. */
  private _fireIn(ipb: any, r: AorReading, guide: any): AprcFireIn | null {
    const f: any = ipb?.fire ?? this._liveAt(r, guide)?.fire ?? null;
    if (!f || !Array.isArray(f.lines) || !f.lines.length) return null;
    return {
      posnSide: f.posnSide === 'enemy' ? 'enemy' : 'own',
      posns: Array.isArray(f.posns) ? f.posns.length : 0,
      assumedRange: Array.isArray(f.posns) && f.posns.some((p: any) => p?.assumed),
      lines: f.lines.map((l: any) => ({ id: String(l.id), coveredPct: Number(l.coveredPct) || 0, screenedPct: Number(l.screenedPct) || 0, deadPct: Number(l.deadPct) || 0, outPct: Number(l.outPct) || 0, seenPct: Number(l.seenPct) || 0, gaps: Array.isArray(l.gaps) ? l.gaps : [] })),
      killing: (Array.isArray(f.killing) ? f.killing : []).map((k: any) => ({ on: String(k.on), kind: k.kind === 'narrows' ? 'narrows' : 'stretch', widthM: Number.isFinite(k.widthM) ? Number(k.widthM) : null, lengthM: Number(k.lengthM) || 0, alongM: Number(k.alongM) || 0, where: Array.isArray(k.at) ? this._where(r, this._ground(r, k.at)) : null })),
    };
  }

  /** His air avenues, LZs and DZs (the IPB air reading), when it is there for this place. */
  private _airIn(ipb: any, r: AorReading, guide: any): AprcAirIn | null {
    const a: any = ipb?.air ?? (this._liveAt(r, guide) ? guide?.ipbAir?.() : null) ?? null;
    if (!a || a.side === 'own') return null;
    const zone = (z: any) => ({ id: String(z.id), rank: Number(z.rank) || 99, where: Array.isArray(z.at) ? this._where(r, this._ground(r, z.at)) : null, why: String(z.why ?? ''), existing: z.existing ? String(z.existing) : null });
    return {
      lzs: (Array.isArray(a.lzs) ? a.lzs : []).map(zone),
      dzs: (Array.isArray(a.dzs) ? a.dzs : []).map(zone),
      routes: (Array.isArray(a.routes) ? a.routes : []).map((x: any) => ({ id: String(x.id), to: String(x.to ?? ''), lengthM: Number(x.lengthM) || 0, seenPct: Number(x.seenPct) || 0 })),
      band: String(a.bandLabel ?? a.band ?? ''),
    };
  }

  /** The Admin Area finder's last result, when the host passes the finder. */
  private _admIn(r: AorReading | null): AprcAdmIn | null {
    const res: any = this._host.adminArea?.()?.result ?? null;
    if (!res?.sites?.length) return null;
    return {
      kind: String(res.rule?.label ?? 'Admin area'),
      sites: res.sites.map((x: any) => ({ rank: Number(x.rank) || 99, where: r && Array.isArray(x.at) ? this._where(r, this._ground(r, x.at)) : null, tone: String(x.tone ?? 'unknown'), verdict: String(x.verdict ?? '') })),
    };
  }

  /** The H-hour sum of a checked attack plan, read from its row, if the check carries one. */
  private _hSumOf(rep: any): AprcHSumIn | null {
    const rows: any[] = [...(rep?.rows ?? []), ...((rep?.groups ?? []) as any[]).flatMap((g) => g?.rows ?? [])];
    const h = rows.find((x) => /^H-hour sum$/i.test(String(x?.name ?? '')));
    return h ? hSumFromText(String(h.reason ?? '')) : null;
  }

  /**
   * The Ground Guide once it is on and its terrain data has settled (ready, failed, or no bundle set), waiting up to two
   * minutes for the data to load; null when it never came on or another Read overtook this one.
   */
  private async _guideSettled(seq: number, capMs = 120000): Promise<any | null> {
    const t0 = Date.now();
    for (;;) {
      if (seq !== this._readSeq) return null;
      const g = this._host.guide?.() ?? null;
      const st = g?.isEnabled ? g.status?.state : null;
      // 'failed' counts once the guide has had a moment to start its load (it reads 'failed' before configure runs)
      if (st === 'ready' || st === 'no-bundle-url' || (st === 'failed' && Date.now() - t0 > 1500)) return g;
      if (Date.now() - t0 > capMs) return g?.isEnabled ? g : null;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  /** True when this sheet holds a reading (ground or map), not only the empty headings. */
  private _wasRead(doc: AprcDoc | null): boolean {
    if (!doc) return false;
    if (doc.frame || doc.sources.length) return true;
    const c = counts(doc);
    return c.gr + c.map > 0;
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

  /** The symbols on the map, in words for the writer and as PlanCheck reads them (`drawn`, for the ORBAT and Time Req). */
  private async _symbols(r: AorReading | null): Promise<{ symbols: AprcSymbolIn[]; drawn: any[] }> {
    const recs = this._host.records?.() ?? [];
    if (!recs.length) return { symbols: [], drawn: [] };
    try {
      const { readSymbols } = await import('../DeploymentBuilder/PlanCheck');
      const raw = readSymbols(recs as any);
      const symbols = raw.map((s) => {
        let where: string | null = null;
        if (r && s.pts.length) {
          const cx = s.pts.reduce((a, p) => a + p.x, 0) / s.pts.length, cy = s.pts.reduce((a, p) => a + p.y, 0) / s.pts.length;
          where = this._where(r, [(cx - r.centre[0]) / r.k, (cy - r.centre[1]) / r.k]);
        }
        // a HQ: 2525D HQ / TF / dummy amplifier 2 (HQ) or 6 (TF HQ); 3 and 7 are dummies
        return { id: s.id, key: s.key, name: s.name, side: s.side, ech: s.ech, label: s.label, where, planned: s.status === '1', hq: s.hqtf === '2' || s.hqtf === '6' };
      });
      return { symbols, drawn: raw };
    } catch (err) {
      console.warn('[Aprc] symbols', err);
      return { symbols: [], drawn: [] };
    }
  }

  /** The IPB reading of the en's avenues onto the position, with his times, the Annex A weather and the template. */
  /** `threatDeg`: the bearing to the Threat marker when one is marked, else the AOR reading's facing. */
  private async _ipb(guide: any, r: AorReading, graphic: any, threatDeg: number | null = null): Promise<any | null> {
    if (!guide?.ipbApproachesAround) return null;
    const ll = mercToLngLat(...this._toMerc(r, r.mitg.at));
    const sidc: string | null = graphic?.attributes?.drawEssentials?.AMPLIFIER?.SIDC ?? null;
    return withTimeout<any>(guide.ipbApproachesAround(ll, { sidc, readFor: 'defence', threatDeg: Number.isFinite(threatDeg) ? threatDeg : r.faceDeg, extras: true }), 60000);
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
    // a partial decision object (no rates) gives no options; it never throws away the rest of the reading
    if (!Array.isArray(v?.aas) || !v.aas.length || !d || !Array.isArray(d.rates?.go) || !Array.isArray(d.rates?.slow)) return null;
    const profiles: any[] = Array.isArray(d.profiles) ? d.profiles : [];
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
      const pr = profiles.find((x: any) => x?.aa === aa.id);
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
        startH: Array.isArray(pr?.startH) ? pr.startH : [0, 0],
        endH: Array.isArray(pr?.endH) ? pr.endH : [0, 0],
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
      tais: (Array.isArray(d.tais) ? d.tais : []).map((x: any) => ({ id: x.id, aa: x.aa, why: x.why, earliestH: x.earliestH, latestH: x.latestH })),
      dps: (Array.isArray(d.dps) ? d.dps : []).map((x: any) => ({ id: x.id, kind: x.kind, aa: x.aa, tai: x.tai, decision: x.decision, earliestH: x.earliestH, beforeH: !!x.beforeH })),
      template: t ? { label: String(t.label ?? ''), src: String(t.src ?? ''), confirmed: !!t.confirmed, phases: (Array.isArray(t.phases?.rows) ? t.phases.rows : []).map((x: any) => ({ phase: x.phase, time: x.time })) } : null,
      hHour: this._hHour(guide),
    };
  }

  // ── the attack ────────────────────────────────────────────────────────────────────────────────────────────────

  private _ground(r: AorReading, merc: [number, number]): AorXY {
    return [(merc[0] - r.centre[0]) / r.k, (merc[1] - r.centre[1]) / r.k];
  }

  /**
   * Where own tps start an attack: a host's `from`, else the checked attack plan's FUP of its first phase (else the
   * tail of its axis). Null: none on the map, and the reading takes own side opposite the threat.
   */
  private _attkStart(from: [number, number] | null): { ll: [number, number]; merc: [number, number]; label: string } | null {
    if (Array.isArray(from) && from.length === 2 && from.every((v) => Number.isFinite(v))) return { ll: [from[0], from[1]], merc: lngLatToMerc(from[0], from[1]), label: '' };
    const c: any = this._host.planCheck?.() ?? null;
    if (c?.task !== 'attack' || !c.groups?.length) return null;
    const g = c.groups.find((x: any) => (x.phase ?? 1) === 1) ?? c.groups[0];
    const cen = (pts: any[]): [number, number] => [pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length];
    if (g.fup?.pts?.length) {
      const m = cen(g.fup.pts);
      return { ll: mercToLngLat(...m), merc: m, label: g.fup.label ? `FUP ${g.fup.label}` : 'FUP' };
    }
    const ax: any[] = g.axis?.pts ?? [];
    if (!ax.length) return null;
    const o = g.obj?.pts?.length ? cen(g.obj.pts) : null;
    const a = ax[0], b = ax[ax.length - 1];
    const tail = o && Math.hypot(a.x - o[0], a.y - o[1]) < Math.hypot(b.x - o[0], b.y - o[1]) ? b : a;
    return { ll: mercToLngLat(tail.x, tail.y), merc: [tail.x, tail.y], label: `the start of ${g.label || 'the axis'}` };
  }

  /**
   * The IPB reading for the attack: from own start (else a point taken back from the obj on own side) onto the MITG,
   * with the flanking, frontal and turning apchs, their FUPs and the choke on his MSR; null when the guide cannot.
   */
  private async _ipbAttk(guide: any, r: AorReading, start: { ll: [number, number]; merc: [number, number] } | null, ech: string): Promise<{ in: AprcAttkIn | null; view: any } | null> {
    if (!guide?.ipbApproachesAround) return null;
    const named = !!r.mitg.name && r.mitg.name !== 'MITG';
    const obj = mercToLngLat(...this._toMerc(r, r.mitg.at));
    // no start on the map: taken back from the obj on own side, by echelon (a method setting, said so)
    const backM = ({ Coy: 3000, Bn: 5000, Bde: 10000 } as Record<string, number>)[ech] ?? 5000;
    const th = (r.faceDeg * Math.PI) / 180;
    const S = start?.ll ?? mercToLngLat(...this._toMerc(r, [r.mitg.at[0] + Math.sin(th) * backM, r.mitg.at[1] + Math.cos(th) * backM]));
    const v: any = await withTimeout<any>(guide.ipbApproachesAround(S, { readFor: 'attack', threatDeg: (r.faceDeg + 180) % 360, hq: ech === 'Bde' ? 'div' : 'bde', extras: true, objective: obj, objectiveLabel: named ? r.mitg.name : 'the Obj' }), 60000);
    if (!v) return null;
    const gr = (p: [number, number]): AorXY => this._ground(r, p);
    const MOVER: Record<string, string> = { armour: 'armour', mech: 'mech inf', dismounted: 'dismounted inf' };
    const ob = v.objective ?? null;
    const avenues = (v.aas ?? []).filter((aa: any) => aa.viable !== false || aa.onto).map((aa: any) => ({
      id: String(aa.id),
      rank: Number(aa.rank) || 99,
      onto: (['frontal', 'left', 'right', 'turn'] as const).find((k) => k === aa.onto) ?? null,
      label: String(aa.ontoLabel ?? aa.id),
      lengthM: Number(aa.lengthM) || 0,
      goPct: Number(aa.goPct) || 0,
      minWidthM: Number(aa.minWidthM) || 0,
      waterLines: Number(aa.waterLines) || 0,
      assaultM: Number.isFinite(aa.assaultM) ? Number(aa.assaultM) : null,
      assaultNogoPct: Number.isFinite(aa.assaultNogoPct) ? Number(aa.assaultNogoPct) : null,
      fupWhere: aa.fupAt ? this._where(r, gr(aa.fupAt)) : null,
    }));
    const t = ob?.turn ?? null;
    const input: AprcAttkIn | null = ob
      ? {
          objective: named ? r.mitg.name : 'the obj',
          mover: MOVER[v.mover] ?? String(v.mover ?? ''),
          aaFor: String(v.aaFor ?? ''),
          mcWidthM: Number(v.mcWidthM) || 0,
          fupM: Number(ob.fupM) || 1100,
          avenues,
          turn: t ? { label: String(t.label ?? 'the MSR'), kind: String(t.kind ?? 'road'), behindM: Number(t.behindM) || 0, msr: !!t.msr, where: t.at ? this._where(r, gr(t.at)) : null } : null,
          start: start ? 'own start' : `a point ${(backM / 1000).toFixed(0)} km back from the obj on own side`,
          startAssumed: !start,
        }
      : null;
    return { in: input, view: v };
  }

  /** A checked attack plan (Check my plan, attack) for the appreciation: each axis with its obj, FUP, SL and BOF in words. */
  private _attkCheckIn(c: any, r: AorReading | null): AprcAttkPlanIn | null {
    if (!c?.groups?.length) return null;
    const whereOf = (s: any): string | null => {
      if (!r || !s?.pts?.length) return null;
      const m: [number, number] = [s.pts.reduce((a: number, p: any) => a + p.x, 0) / s.pts.length, s.pts.reduce((a: number, p: any) => a + p.y, 0) / s.pts.length];
      return this._where(r, this._ground(r, m));
    };
    const nm = (s: any, fallback: string): string | null => (s ? String(s.label || s.name || fallback) : null);
    const rows = (l: any[]): Array<{ name: string; st: string; reason: string }> => (l ?? []).map((x: any) => ({ name: String(x.name ?? ''), st: String(x.st ?? ''), reason: String(x.reason ?? '') }));
    return {
      title: String(c.title ?? 'Attack'),
      recipe: c.mapped?.built?.recipe ?? null,
      axes: c.groups.map((g: any) => {
        const fw = whereOf(g.fup), bw = whereOf(g.bof);
        return {
          label: String(g.label ?? 'Axis'),
          phase: Number(g.phase) || 1,
          obj: nm(g.obj, 'Obj'),
          objWhere: whereOf(g.obj),
          fup: nm(g.fup, 'FUP'),
          fupWhere: fw,
          sl: nm(g.sl, 'SL'),
          bof: nm(g.bof, 'BOF'),
          bofWhere: bw,
          rows: rows(g.rows),
        };
      }),
      rows: rows(c.rows),
      confirm: c.confirm ?? [],
      assumptions: c.assumptions ?? [],
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

  /** The Cas Estimate under Adm and Log: the own units' strength by rank and lsf row, from the ORBAT (lsf pp 47-51). */
  private _casPatch(o: any, si: AprcStrengthIn | null): AprcPatch | null {
    if (!o?.own || !si?.own.length) return null;
    const acc = new Map<string, AprcCasGroup>();
    const missing: string[] = [];
    for (const u of si.own) {
      if (!u.id) {
        missing.push(u.name);
        continue;
      }
      const g = casGroupsOf(o.own, u.id, u.count);
      for (const x of g.groups) {
        const a = acc.get(x.arm) ?? { arm: x.arm, offr: 0, jco: 0, sldr: 0 };
        a.offr += x.offr;
        a.jco += x.jco;
        a.sldr += x.sldr;
        acc.set(x.arm, a);
      }
      missing.push(...g.missing);
    }
    return casEstimate({ groups: [...acc.values()], missing: [...new Set(missing)], src: [...new Set(si.own.map((u) => u.src))].join('; '), assumed: si.ownAssumed });
  }

  /** Own and en units for the relative strength: a built plan's, else the symbols marked, else assumed (and said so). */
  private async _strengthIn(o: any, r: AorReading, echWord: string, need: number | null, drawn: any[], attack = false): Promise<AprcStrengthIn | null> {
    const { brief, ownUnitFor, enUnitFor } = await import('../DeploymentBuilder/PlanOrbat');
    const pd: any = (await import('../../Data/PlanDoctrine.json')).default;
    const ownEch = ({ Coy: '15', Bn: '16', Bde: '18' } as Record<string, string>)[echWord] ?? '16';
    const ECHW: Record<string, string> = { '15': 'Coy', '16': 'Bn', '18': 'Bde', '21': 'Div' };
    const isUnit = (s: any) => String(s.key ?? '').startsWith('10') && !!s.ech;
    const unitOf = (id: string | null, count: number): AprcForceUnit | null => {
      const b = id ? brief(o, id) : null;
      if (!b) return null;
      const n = (l: Array<{ count: number }>) => l.reduce((a, w) => a + (Number(w.count) || 0), 0);
      return { name: b.name, count, coys: b.coys, strength: b.strength, atgm: n(b.atgm), mortars: n(b.mortars), plsPerCoy: b.plsPerCoy, src: b.src, id: b.id, mounted: !!b.mounted };
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
      // the attack: he defends one level down, inf (as Check my plan takes him: PlanContext.defaultEnemy)
      const e = meta?.enemy?.echelon ?? order[Math.min(order.length - 1, Math.max(0, order.indexOf(ownEch) + (attack ? -up : up)))];
      const type = meta?.enemy?.type ?? (attack || r.country === 'Mountains' ? 'inf' : (pd?.enemy?.defaultType?.value ?? 'mech'));
      en = group([enUnitFor(e, type, r.country === 'Mountains' ? 'mountain' : null)]);
      enAssumed = meta?.enemy
        ? `the built plan's en (${ECHW[e] ?? e}, ${type})`
        : attack
          ? `one level down, a ${ECHW[e] ?? e} in def, inf: an attacker keeps the usual 3 : 1 (${r.country === 'Mountains' ? 'MW p 80: in mountains comparatively more, in sequence' : 'IBB p 248'})`
          : `one level up, a ${ECHW[e] ?? e} (${pd?.enemy?.defaultUp?.src ?? 'PlanDoctrine'}), ${type} (${type === 'mech' ? pd?.enemy?.defaultType?.src ?? 'PlanDoctrine' : 'mountains: inf'})`;
    }
    if (!en.length || !own.length) return null;
    return { en, enAssumed, own, ownAssumed, need };
  }

  /** Time Req inputs: the move in (the unit symbol outside the AOR), posn preparation, the protective minefield. */
  private async _timeIn(o: any | null, r: AorReading, echWord: string, drawn: any[]): Promise<AprcTimeIn> {
    const pd: any = (await import('../../Data/PlanDoctrine.json')).default;
    const md: any = (await import('../../Data/MoveDoctrine.json')).default;
    const ownEch = ({ Coy: '15', Bn: '16', Bde: '18' } as Record<string, string>)[echWord] ?? '16';
    // the DS guns (a Bn's fd Bty, a Bde's fd Regt; a Coy has none of its own: IBB p 122) and the ground's own prep notes
    const out: AprcTimeIn = { move: null, prep: null, mines: null, guns: echWord === 'Coy' ? null : gunUnitFor(echWord), ground: r.country };
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
    for (const s of drawn) {
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
    if (echWord === 'Bn' || echWord === 'Bde') {
      // a Bn's (and a Bde's Bns') posns: OoW Vol I p 39 (PlanDoctrine readyBy.bnPosnH when it holds one), not a Coy's
      const bn = pd?.readyBy?.bnPosnH;
      const h = Number(Array.isArray(bn?.value) ? bn.value[0] : bn?.value) || 36;
      out.prep = { h: [h, h], src: String(bn?.src ?? 'A battalion needs a minimum of 36 working hours for preparing positions to meet a full-scale attack; Inf subunits about 12 h (OoW Vol I p 39); a Coy 24-36 h (IC s75 p 399); the guide\'s specimen 36 h (Understanding Aprc Sec II sheet 7)'), note: `A Bn prepares its posns in at least ${h} working hrs` };
    } else if (Array.isArray(ready?.value)) out.prep = { h: [Number(ready.value[0]), Number(ready.value[1])], src: String(ready.src ?? 'PlanDoctrine readyBy.coyPosnH') };
    const fdl = r.lines.find((l) => l.role === 'FDLs');
    if (o && fdl) {
      const { ownEngrTypes, minesByEngr, engrShare } = await import('../DeploymentBuilder/PlanEngr');
      const t = (o.engrData ?? []).find((x: any) => /Mine Laying - Planning Data: Manual/i.test(String(x?.title)));
      const row = t?.rows?.find((x: any) => x.Condition === 'Engr Pl' && /mixed/i.test(String(x.Cluster)));
      const perPl = Number(row?.['Max in 24 hrs']);
      const meta = drawn.find((s) => s.side === 'own' && s.pbMeta)?.pbMeta ?? null;
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
      this._msg = 'Opened with the plan: Read again for the pictures';
      this._render();
    }
    return ok;
  }

  /**
   * The readings at the MITG and along each apch for the Gr paragraphs. Null when another Read overtook this one. The
   * Obsn head is read at three points along the home side of each apch (its mean, spread and worst place).
   */
  private async _groundIn(guide: any, aor: { reading: AorReading; frame: AorFrame }, graphic: any, drawnObs: string[], seq: number, step: (s: string) => void): Promise<AprcGroundIn | null> {
    const r = aor.reading;
    const ll = mercToLngLat(...this._toMerc(r, r.mitg.at));
    const sidc: string | null = graphic?.attributes?.drawEssentials?.AMPLIFIER?.SIDC ?? null;
    step('Gr: sections, cover and sight at the MITG');
    const [sec, cov, ext] = await Promise.all([
      withTimeout<any>(guide.sectionsAround?.(ll) ?? Promise.resolve(null), 20000),
      withTimeout<any>(guide.coverAround?.(ll) ?? Promise.resolve(null), 20000),
      withTimeout<any>(guide.extendedAround?.(ll, { sidc, threatDeg: r.faceDeg, radiusKm: 2 }) ?? Promise.resolve(null), 30000),
    ]);
    if (seq !== this._readSeq) return null;
    const obsn: Partial<Record<AorSide, AprcObsn | null>> = {};
    const toward = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
    if (this._opts.obsn && guide.extendedAround) {
      const FRACS = [0.8, 0.5, 0.2];
      for (const a of r.apchs) {
        const reads: Array<{ e: any; near: string | null }> = [];
        for (let k = 0; k < FRACS.length; k++) {
          step(`Obsn along the ${a.side} apch ${k + 1}/${FRACS.length}`);
          // points along the part of the approach on the home side (its last `pastM`)
          const want = a.lengthM - a.pastM * FRACS[k];
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
          if (seq !== this._readSeq) return null;
          if (!e?.obs || !Number.isFinite(e.obs.seenPct)) continue;
          let near: string | null = null, nd = 1500;
          for (const q of r.map.places) {
            const d = Math.hypot(q.at[0] - at[0], q.at[1] - at[1]);
            if (d < nd) ((nd = d), (near = q.name));
          }
          reads.push({ e, near });
        }
        if (!reads.length) {
          obsn[a.side] = null;
          continue;
        }
        const seen = reads.map((x) => Number(x.e.obs.seenPct));
        const clear = reads.map((x) => Number(x.e.obs.clearMedianM)).sort((p, q) => p - q);
        const worst = reads[seen.indexOf(Math.min(...seen))];
        const mid = reads[Math.floor(reads.length / 2)];
        const ov = reads.map((x) => x.e.obs.overlook).filter(Boolean).sort((p: any, q: any) => q.riseM - p.riseM)[0] ?? null;
        obsn[a.side] = {
          near: mid.near,
          radiusM: mid.e.radiusM ?? 2000,
          seenPct: seen.reduce((p, q) => p + q, 0) / seen.length,
          clearMedianM: clear[Math.floor(clear.length / 2)],
          country: mid.e.obs.country,
          overlook: ov ? { riseM: ov.riseM, distM: ov.distM, compass: toward(ov.bearingDeg) } : null,
          points: reads.length,
          minSeenPct: Math.min(...seen),
          maxSeenPct: Math.max(...seen),
          worstNear: reads.length > 1 ? worst.near : null,
        };
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
      // the view from the MITG toward the reading's threat side (the attack: toward own side, his view from the obj)
      mitgObsn: ext?.obs ? { near: null, radiusM: ext.radiusM ?? 2000, seenPct: ext.obs.seenPct, clearMedianM: ext.obs.clearMedianM, country: ext.obs.country, overlook: ext.obs.overlook ? { riseM: ext.obs.overlook.riseM, distM: ext.obs.overlook.distM, compass: toward(ext.obs.overlook.bearingDeg) } : null } : null,
      // the place's zone (groundAppreciation.utcOffsetH), never the computer's
      light: lightTimes(this._dDate(), ll[1], ll[0], Number(this._opts.utcOffsetH) * 60),
      drawnObs,
      threatMarked: !r.originsAssumed,
      readAt: `${this._clock()} (${zoneWord(Number(this._opts.utcOffsetH))})`,
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

  private async _figures(aor: { reading: AorReading; frame: AorFrame }, denial: string | null = null): Promise<AprcFigure[]> {
    const out: AprcFigure[] = [];
    if (this._opts.figures !== 'map') {
      const t = await this._traceFigure(aor, denial);
      if (t) out.push(t);
    }
    if (this._opts.figures !== 'trace') {
      const shot = await this._mapShot();
      if (shot) out.push(shot);
    }
    return out;
  }

  /** The trace of the AOR reading, the line of denial given marked "Line of Denial" on it (OoW Vol I pp 17-18). */
  private async _traceFigure(aor: { reading: AorReading; frame: AorFrame }, denial: string | null): Promise<AprcFigure | null> {
    const W = 900, H = 800;
    const den = denial && aor.reading.lines.some((l) => l.id === denial) ? denial : null;
    const frame: AorFrame = { ...aor.frame, reading: aor.reading, style: 'trace', orient: 'north', northDeg: 0, layers: { going: true, apch: true, line: true, itg: true, dml: true, msr: true }, loading: false, denial: den };
    try {
      const svg = aorMapSvg(aor.reading, frame, W, H, 'full');
      const png = await this._rasterise(svg, W, H, 2);
      return { id: 'trace', kind: 'trace', caption: `Trace: apchs, lines of def${den ? ` (Line ${den} the line of denial)` : ''} and going for ${aor.frame.profileLabel.toLowerCase()}. North up.`, svg, png: png ?? undefined, w: W, h: H };
    } catch (err) {
      console.warn('[Aprc] trace', err);
      return null;
    }
  }

  /**
   * The line of denial changed on the sheet: the trace of this session's reading is drawn again with it, the slides'
   * traces too (the line of denial is the planner's, set after the Read).
   */
  private async _retrace(): Promise<void> {
    const doc = this._doc, aor = this._aor;
    // the slides' traces are drawn again from the reading when next asked for
    this._slideMaps = null;
    if (!doc || !aor || !this._readHere || !doc.figures.some((f) => f.id === 'trace')) return;
    const fig = await this._traceFigure(aor, doc.kind === 'def' ? (doc.limits?.denial ?? null) : null);
    if (!fig || this._doc !== doc) return;
    doc.figures = doc.figures.map((f) => (f.id === 'trace' ? fig : f));
    this._save();
    this._render();
  }

  /**
   * The climb from the SL (else the FUP) to the obj for the uphill assault in mountains (MW Annex F pp 311-313): the
   * height at each read off the terrain data's 30 m elevation through the Ground Guide (`sectionsAround`, as at the MITG),
   * the obj's the MITG's. The start: the checked attack plan's first-phase SL, else its FUP, else the FUP of the apch the
   * IPB reading leads with. Null when a height is not read or the way is not uphill.
   */
  private async _climbIn(guide: any, r: AorReading, objElev: number | null, ipb: { in: AprcAttkIn | null; view: any } | null): Promise<AprcClimb | null> {
    if (objElev === null || !Number.isFinite(objElev) || !guide?.sectionsAround) return null;
    const cen = (pts: any[]): [number, number] => [pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length];
    let at: [number, number] | null = null;
    let what = '';
    const c: any = this._host.planCheck?.() ?? null;
    if (c?.task === 'attack' && c.groups?.length) {
      const g = c.groups.find((x: any) => (x.phase ?? 1) === 1) ?? c.groups[0];
      if (g.sl?.pts?.length) ((at = cen(g.sl.pts)), (what = g.sl.label ? `SL ${g.sl.label}` : 'the SL'));
      else if (g.fup?.pts?.length) ((at = cen(g.fup.pts)), (what = g.fup.label ? `FUP ${g.fup.label}` : 'the FUP'));
    }
    if (!at && ipb?.in && ipb.view) {
      const first = attkFirst(ipb.in)?.first ?? null;
      const aa = first ? (ipb.view.aas ?? []).find((x: any) => String(x.id) === first.id) : null;
      if (first && Array.isArray(aa?.fupAt)) ((at = [Number(aa.fupAt[0]), Number(aa.fupAt[1])]), (what = `the FUP of Apch ${first.id} (${first.label})`));
    }
    if (!at) return null;
    const s: any = await withTimeout<any>(guide.sectionsAround(mercToLngLat(...at)), 20000);
    const e = s?.ground?.elevationM;
    if (typeof e !== 'number' || !Number.isFinite(e)) return null;
    const g = this._ground(r, at);
    const horizM = Math.hypot(g[0] - r.mitg.at[0], g[1] - r.mitg.at[1]);
    const m = Math.round(objElev - e);
    if (m <= 0 || horizM < 50) return null;
    return { m, horizM, from: `${what} ${this._where(r, g)}`, to: r.mitg.name && r.mitg.name !== 'MITG' ? r.mitg.name : 'the Obj' };
  }

  private _rasterise(svg: string, w: number, h: number, scale: number, mime: 'image/png' | 'image/jpeg' = 'image/png'): Promise<string | null> {
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
            done(mime === 'image/jpeg' ? c.toDataURL(mime, 0.86) : c.toDataURL(mime));
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
  /** Start again: every heading, nothing written. The planner's words go too, until the next change: Undo brings them back. */
  clear(label = 'Cleared'): void {
    this._undoable(label, () => {
      // a Read still running would land on the cleared sheet (of the old kind): it is dropped
      this._readSeq++;
      this._busy = false;
      this._stopBusyClock();
      this._lastEnemy = null;
      this._lastTime = null;
      this._lastHSum = null;
      this._readHere = false;
      this._doc = newDoc(this._opts.kind);
      this._sel = null;
      this._dirty = null;
      this._msg = `${label}: every heading empty. Undo brings it back`;
      this._changed();
    });
  }

  /** Give a paragraph back to the tool; his words are kept on it to put back, and Undo restores them at once. */
  giveBack(id: string): boolean {
    const p = this._doc ? find(this._doc, id) : null;
    if (!p) return false;
    let ok = false;
    this._undoable(`${this._num(id)} given back`, () => {
      if (p.moved && !p.mine) ok = dropMoved(this._doc!, id);
      else ok = setMine(this._doc!, id, null);
      if (!ok) return;
      this._msg = `${this._num(id)} given back: the tool's draft prints. Undo brings yours back`;
      this._changed();
    });
    return ok;
  }

  /** Put back the words last given back to the tool. */
  putBack(id: string): boolean {
    if (!this._doc || !restoreDiscarded(this._doc, id)) return false;
    this._msg = `${this._num(id)}: your earlier words put back`;
    this._changed();
    return true;
  }

  /**
   * Run a change that can be undone: the document before it is kept until the next change. The toast that says what
   * was done carries Undo (Ctrl+Z in the sheet too).
   */
  private _undoable(label: string, fn: () => void): void {
    const json = this._doc ? JSON.stringify(this._doc) : null;
    const ver = this._docVer;
    fn();
    if (json === null || this._docVer === ver) return;
    this._undo = { label, json, ver: this._docVer, seq: this._msgSeq };
    // show the toast again, now with Undo on it
    this._toastSeq = -1;
    this._render();
  }

  /** Undo the last clear, give-back, open or kind change (until the next change). */
  undo(): boolean {
    const u = this._undo;
    if (!u || u.ver !== this._docVer) {
      this._undo = null;
      this._msg = 'Nothing to undo';
      this._render();
      return false;
    }
    if (this._busy) this.cancelRead();
    const d = normalizeDoc(JSON.parse(u.json));
    if (!d) return false;
    this._undo = null;
    this._doc = d;
    // the readings held for re-timing belong to the sheet undone
    this._readHere = false;
    this._lastEnemy = null;
    this._lastTime = null;
    this._lastHSum = null;
    if (d.kind !== this._opts.kind) {
      this._opts.kind = d.kind;
      this._persist('kind', d.kind);
    }
    this._msg = `Undone: ${u.label.charAt(0).toLowerCase()}${u.label.slice(1)}`;
    this._changed();
    return true;
  }

  private _changed(): void {
    this._docVer++;
    this._save();
    this._render();
    this._emit('aprc-changed', { doc: this._doc });
  }

  /**
   * Change the kind of appreciation: asked first in the sheet when the planner has written in it; the sheet starts
   * again (Undo brings the old one back) and is read again when it held a reading. The setting follows.
   */
  private async _changeKind(next: AprcKind): Promise<void> {
    const doc = this._doc;
    if (!doc || doc.kind === next) {
      this._opts.kind = next;
      return;
    }
    let mine = false;
    walk(doc, (p) => {
      if (p.mine || p.accepted || p.cells) mine = true;
    });
    const label = (k: AprcKind) => aprcKinds().find((x) => x.kind === k)?.label ?? k;
    if (mine) {
      if (!this._open) this.openPanel(true);
      const ok = await this._ask(`Change to ${label(next)}? The sheet starts again with every heading empty and your written paragraphs go (Undo brings them back).`, `Change to ${label(next)}`, `Keep ${label(doc.kind)}`);
      if (!ok || this._doc !== doc) {
        this._persist('kind', this._doc?.kind ?? doc.kind);
        this._render();
        return;
      }
    }
    const wasRead = this._wasRead(doc);
    this._opts.kind = next;
    // the sheet takes the new kind before the setting does: the setting's echo (setOptions) then finds nothing to change
    // (persisted first, it came back while the sheet still held the old kind and started this again, without end)
    this.clear(`Changed to ${label(next)}`);
    this._persist('kind', next);
    if (wasRead) void this.read();
  }

  /** Ask in the sheet's own style; resolves true for yes. A newer question, closing the sheet or Esc answers no. */
  private _ask(text: string, yes: string, no: string): Promise<boolean> {
    this._askState?.resolve(false);
    return new Promise((res) => {
      const st = {
        text,
        yes,
        no,
        resolve: (v: boolean) => {
          if (this._askState === st) this._askState = null;
          res(v);
          this._render();
        },
      };
      this._askState = st;
      this._render();
      (this._el?.querySelector('[data-a="ask-yes"]') as HTMLElement | null)?.focus({ preventScroll: true });
    });
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────

  toText(copy: AprcCopy = this._opts.copy): string {
    return this._doc ? toText(this._doc, copy) : '';
  }
  /** A whole HTML document laid out for A4 print. */
  toHtml(copy: AprcCopy = this._opts.copy): string {
    return this._doc ? printHtml(this._doc, copy) : '';
  }
  /** The document as plain data (figures as they are, or left out: `pictures: false`); `fromJSON` takes it back. */
  toJSON(o: { pictures?: boolean } = {}): AprcDoc | null {
    if (!this._doc) return null;
    const d = JSON.parse(JSON.stringify(this._doc)) as AprcDoc;
    if (o.pictures === false) d.figures = [];
    return d;
  }
  /**
   * Open an appreciation (a file, a plan). It is made safe to open (missing arrays given, typed cells keyed by row);
   * the sheet's kind and its setting follow the opened one, so the next Read keeps its words and the next start keeps
   * the sheet. The sheet it replaces comes back with Undo.
   */
  fromJSON(raw: any): boolean {
    const doc = normalizeDoc(raw);
    if (!doc) return false;
    this._undoable('Opened another appreciation', () => {
      // the opened sheet is not the last reading: a Read still running is dropped, and H has no en options of its to re-time
      this._readSeq++;
      this._busy = false;
      this._stopBusyClock();
      this._lastEnemy = null;
      this._lastTime = null;
      this._lastHSum = null;
      this._readHere = false;
      this._aor = null;
      this._slideMaps = null;
      this._doc = doc;
      if (doc.kind !== this._opts.kind) {
        this._opts.kind = doc.kind;
        this._persist('kind', doc.kind);
      }
      this._sel = null;
      this._dirty = null;
      this._msg = 'Opened';
      this._changed();
    });
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

  /** The slides of a deck kind (not yet in the briefing); the dark maps once `makeSlides` has drawn them, else the document's trace. */
  toDeck(kind: AprcDeckKind = this._opts.deck, copy: AprcCopy = this._opts.copy): any[] {
    if (!this._doc) return [];
    const bg = this._blank(1280, 720, DECK_THEME.bg), th = this._blank(320, 180, DECK_THEME.bg);
    return buildDeck(this._doc, { kind, copy, blankBg: bg, thumb: th, maps: this._slideMaps ?? undefined });
  }

  private _blank(w: number, h: number, colour = '#ffffff'): string {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = colour;
      g.fillRect(0, 0, w, h);
    }
    return c.toDataURL('image/png');
  }

  /**
   * The trace drawn for the slides: dark (the Gr Scope's dark style, to sit on the Ops room slides), the whole AOR and
   * one per apch showing that apch alone, keyed by its paragraph's side (the attack's Lt / Rt mirrored to own side, its
   * labels too). Drawn from the last reading; null after a reload or an opened file (the slides then take the document's
   * trace). JPEG, to keep the deck and the PowerPoint small.
   */
  private async _makeSlideMaps(): Promise<DeckOptions['maps'] | null> {
    if (this._slideMaps) return this._slideMaps;
    if (!this._aor || !this._doc) return null;
    const { reading, frame } = this._aor;
    const kind = this._doc.kind;
    const W = 900, H = 800;
    const denial = kind === 'def' ? (this._doc.limits?.denial ?? null) : null;
    const base: AorFrame = { ...frame, reading, style: 'dark', orient: 'north', northDeg: 0, layers: { going: true, apch: true, line: true, itg: true, dml: true, msr: true }, loading: false, denial: denial && reading.lines.some((l) => l.id === denial) ? denial : null };
    const r0: AorReading = kind === 'attk' ? { ...reading, apchs: reading.apchs.map((a) => ({ ...a, side: deckSideOfReading(kind, a.side) as AorSide })) } : reading;
    const draw = async (r: AorReading): Promise<DeckMap | null> => {
      try {
        const png = await this._rasterise(aorMapSvg(r, { ...base, reading: r }, W, H, 'full'), W, H, 1.4, 'image/jpeg');
        return png ? { png, w: W, h: H } : null;
      } catch (err) {
        console.warn('[Aprc] slide map', err);
        return null;
      }
    };
    const apch: Record<string, DeckMap> = {};
    for (const a of r0.apchs) {
      const m = await draw({ ...r0, apchs: [a] });
      if (m) apch[a.side] = m;
    }
    this._slideMaps = { all: await draw(r0), apch };
    return this._slideMaps;
  }

  /** Each slide's preview drawn from its own content (the Briefing's own compositor); the blank page where it cannot. */
  private async _slideThumbs(slides: any[]): Promise<void> {
    try {
      const { composeOverlayThumbnail } = await import('../Briefing/OverlayFabric');
      const base = this._blank(320, 180, DECK_THEME.bg);
      for (const s of slides) {
        const t = await composeOverlayThumbnail(base, s.overlays, 0.8);
        if (t) s.thumbnailDataUrl = t;
      }
    } catch (err) {
      console.warn('[Aprc] slide previews', err);
    }
  }

  /**
   * Make the slides in the Briefing module. Slides that are not the appreciation's stay; an appreciation slide edited
   * since it was made is kept; the rest are replaced. Resolves with what happened, or null when Briefing is off.
   */
  async makeSlides(kind: AprcDeckKind = this._opts.deck): Promise<{ added: number; kept: number; replaced: number } | null> {
    const be: any = this._host.briefing?.() ?? null;
    if (!this._doc || !be?.importBriefing || !be.getSlides) {
      this._msg = 'Slides need the Briefing module on (features.briefing)';
      this._render();
      return null;
    }
    this._msg = 'Making the slides…';
    this._render();
    await this._makeSlideMaps();
    const fresh = this.toDeck(kind);
    await this._slideThumbs(fresh);
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
    this._later(() => URL.revokeObjectURL(a.href), 4000);
  }

  private _fileName(ext: string): string {
    return `${aprcFileBase(this._doc, this._opts.copy)}.${ext}`;
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
    this._printFrame?.remove();
    const fr = document.createElement('iframe');
    this._printFrame = fr;
    fr.setAttribute('aria-hidden', 'true');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    // the window's title is the file name: Save as PDF offers it
    fr.srcdoc = printHtml(this._doc, this._opts.copy, { title: aprcFileBase(this._doc, this._opts.copy) });
    let gone = false;
    const done = () => {
      if (gone) return;
      gone = true;
      fr.remove();
      if (this._printFrame === fr) this._printFrame = null;
    };
    fr.onload = () => {
      try {
        // taken away once the print dialog closes (a long fallback where `afterprint` never comes)
        fr.contentWindow?.addEventListener('afterprint', () => this._later(done, 500));
        this._later(done, 10 * 60000);
        fr.contentWindow?.focus();
        fr.contentWindow?.print();
      } catch (err) {
        console.warn('[Aprc] print', err);
        done();
      }
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

  /** Save to a file: without the pictures by default (Read makes them again; a few KB instead of MB). */
  exportJson(o: { pictures?: boolean } = {}): void {
    const d = this.toJSON({ pictures: !!o.pictures });
    if (!d) return;
    this._download(new Blob([JSON.stringify(d)], { type: 'application/json' }), this._fileName('json'));
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
  /** The sheet kept in this browser, made safe to open; its kind wins over the setting (`enable`). */
  private _load(): AprcDoc | null {
    if (!this._opts.keep || typeof localStorage === 'undefined') return null;
    try {
      return normalizeDoc(JSON.parse(localStorage.getItem(STORE) ?? 'null'));
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
    el.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown N A Shift+A F X C M Control+Z Escape');
    const kinds = aprcKinds();
    el.innerHTML = `<header class="ap-head">
<span class="ap-dot idle" data-p="dot" aria-hidden="true"></span>
<span class="ap-ttl">Aprc</span>
<select class="ap-select" data-o="kind" aria-label="Kind of appreciation">${kinds.map((k) => `<option value="${k.kind}" ${k.ready ? '' : 'disabled'}>${esc(k.label)}${k.ready ? '' : ' (no outline yet)'}</option>`).join('')}</select>
<div class="ap-frame" data-p="frame"></div>
<button class="ap-btn pri" data-a="read" data-p="read" title="Read the ground and the symbols on the map. Your words and acceptances are kept."></button>
<button class="ap-btn" data-a="menu" data-v="export" aria-haspopup="menu" aria-expanded="false">Export ${UI.caret}</button>
<button class="ap-btn icon" data-a="menu" data-v="log" aria-haspopup="menu" aria-expanded="false" aria-label="Messages (M)" title="Messages: the last ten, with their times (M)">${UI.log}</button>
<button class="ap-btn icon" data-a="menu" data-v="more" aria-haspopup="menu" aria-expanded="false" aria-label="Save, open or clear" title="Save, open or clear">${UI.more}</button>
<span class="ap-minprog" data-p="minprog"></span>
<span class="ap-wsep" aria-hidden="true"></span>
<button class="ap-btn icon ghost" data-a="win" data-v="min" data-p="winmin"></button>
<button class="ap-btn icon ghost" data-a="win" data-v="max" data-p="winmax"></button>
<button class="ap-btn icon ghost" data-a="close" aria-label="Close (Esc)" title="Close (Esc)">${UI.close}</button>
</header>
<div class="ap-busy" data-p="busy" aria-hidden="true"><i></i></div>
<div class="ap-ask" data-p="ask" role="alertdialog" aria-live="assertive" hidden></div>
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
<label class="ap-hfield" title="D Day's date: first and last lt and the moon are worked out for it. Empty takes today.">D Day<input type="date" data-o="dDay"></label>
<label class="ap-hfield" title="Time now as a D-time (D-1 1000): the time aval and the essential timings run from it. Empty leaves them out.">Now<input class="wide" type="text" data-o="timeNow" maxlength="16" placeholder="D-1 1000" autocomplete="off"></label>
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
      if (a === 'menu') return this._toggleMenu(v as 'export' | 'more' | 'log');
      if (a !== 'clear') this._closeMenu(false);
      if (a === 'ask-yes' || a === 'ask-no') return this._askState?.resolve(a === 'ask-yes');
      if (a === 'give') this._dirty = null;
      else if (a !== 'save' && a !== 'sel' && a !== 'prev' && a !== 'next' && a !== 'next-todo') this._commitDirty();
      switch (a) {
        case 'close':
          return this.openPanel(false);
        case 'read':
          return void this.read();
        case 'cancel':
          return void this.cancelRead();
        case 'undo':
          return void this.undo();
        case 'restore':
          if (this._sel) this.putBack(this._sel);
          return;
        case 'confirm':
          return this._showConfirm();
        case 'json-pics':
          this.exportJson({ pictures: true });
          this._msg = 'Saved to a file, with the pictures';
          return this._render();
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
          this._msg = 'Saved to a file (no pictures: Read makes them again)';
          return this._render();
        case 'open':
          return this._openJson();
        case 'slides':
          if (v) this.setOptions({ deck: v as AprcDeckKind });
          return void this.makeSlides(v ? (v as AprcDeckKind) : this._opts.deck);
        case 'guide':
          // one click: the guide comes on, and the sheet reads once its terrain data is in
          this._host.turnOnGuide?.();
          this._note = '';
          return void this.read({ waitGuide: true });
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
          if (this._sel) this.giveBack(this._sel);
          return;
        case 'keep': {
          const p = this._doc && this._sel ? find(this._doc, this._sel) : null;
          if (!p) return;
          if (p.mine && this.setText(p.id, p.mine.text)) {
            if (p.moved) keepMoved(this._doc!, p.id);
            this._msg = `${this._num(p.id)}: yours kept`;
            this._render();
          } else if (p.moved && keepMoved(this._doc!, p.id)) {
            this._msg = `${this._num(p.id)}: your rows kept`;
            this._changed();
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
    if (cell) {
      // a cell taken away by a new drawing of the panel has been committed already
      if (t.isConnected && this._doc && this._sel) this._commitCell(t as HTMLInputElement);
      return;
    }
    if (t.dataset?.lim) return this._limitInput(t as HTMLInputElement);
    const k = t.dataset?.o;
    if (!k) return;
    if (k === 'hHour') return void this.setH(t.value);
    if (k === 'dDay') return this.setDDay(t.value);
    if (k === 'timeNow') return this.setNow(t.value);
    if (k === 'kind') {
      const next = t.value as AprcKind;
      // A sheet that held a reading is read again for the new kind (the planner asked for a reading once: it is kept
      // current); a sheet never read only takes the new headings, the first Read stays his.
      t.value = this._doc?.kind ?? this._opts.kind;
      void this._changeKind(next);
    }
  }

  /**
   * H on D Day. With a reading of this session, only what carries a time is re-timed (his times, his phases' clock
   * times, the reactions table when it is the en options', the Time Data, the attack's Time Calc); a reactions table a
   * plan check settled stays, and the planner's words over a re-timed paragraph are marked "H changed", not "Gr". A
   * sheet kept from an earlier session asks before it reads again.
   */
  setH(value: string): void {
    const v = String(value ?? '').trim();
    if (v && parseHHour(v) === null) {
      this._msg = 'H: type HH:MM (24 h), or leave it empty';
      return this._render();
    }
    this.setOptions({ hHour: v });
    this._persist('hHour', v);
    const doc = this._doc;
    const hh = v || this._hHour(this._host.guide?.() ?? null);
    const word = v ? `H ${v}` : 'H cleared';
    if (doc && this._readHere && (this._lastEnemy || this._lastTime || doc.kind === 'attk')) {
      const patches = [
        ...(this._lastEnemy && doc.kind === 'def' ? writeEnemy({ ...this._lastEnemy, hHour: hh }).patches : []),
        ...(this._lastTime && doc.kind === 'def' ? writeTimeData({ ...this._lastTime, hHour: hh }).patches : []),
        ...(doc.kind === 'attk' ? writeTimeCalcAttk(hh, this._lastHSum).patches : []),
      ];
      const n = retime(doc, patches, ['en', 'time'], 'h') + (this._mx && this._mxKind === doc.kind ? retime(doc, writeMechs(this._mechsIn(doc)).patches, MECHS_FROM, 'h') : 0);
      if (this._lastTime) this._lastTime = { ...this._lastTime, hHour: hh };
      this._msg = n ? `${word}: ${n} paragraph${n === 1 ? '' : 's'} re-timed` : `${word}: nothing carries a time to change`;
      this._changed();
      return;
    }
    const read = this._wasRead(doc);
    if (read && doc && doc.frame && !this._readHere) {
      void this._ask(`${word}. This sheet was read in an earlier session: read it again to time the en options from H? What is not read again is kept.`, 'Read again', 'Not now').then((yes) => {
        if (yes) void this.read();
        else {
          this._msg = `${word}: the times show it after the next Read`;
          this._render();
        }
      });
      return;
    }
    this._msg = !read ? `${word}: the en options are timed from it when you Read` : `${word}: this reading has no en options or timings to re-time`;
    this._render();
  }

  // ── the two Aprc books' mechanics: the aim's limitations, D Day, time now ─────────────────────────────────────

  /** The mechanics' inputs: the last Read's (or `mx`), with the sheet's limitations, H, time now and the night of D Day. */
  private _mechsIn(doc: AprcDoc, mx: MechsCtx | null = this._mxKind === doc.kind ? this._mx : null): AprcMechsIn {
    const base: MechsCtx = mx ?? { echelon: this._opts.echelon === 'coy' ? 'Coy' : this._opts.echelon === 'bde' ? 'Bde' : 'Bn', reading: null, ipbRows: [], planRows: [], check: null, planAdv: [], planDis: [], time: null, attk: null, attkPlan: null, hsum: null, enNear: {}, symbols: [] };
    const ll = this._mxLL;
    const off = Number(this._opts.utcOffsetH) * 60;
    let night: AprcNight | null = null;
    try {
      night = ll ? nightOf(this._opts.dDay || null, ll[1], ll[0], off) : null;
    } catch (err) {
      console.warn('[Aprc] night', err);
    }
    return { ...base, kind: doc.kind, limits: doc.limits ?? {}, hHour: this._hHour(this._host.guide?.() ?? null), timeNow: this._opts.timeNow || null, night, zone: zoneWord(Number(this._opts.utcOffsetH)) };
  }

  /** D Day's date at noon in the place's zone (the sheet's D Day, else today). */
  private _dDate(): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(this._opts.dDay ?? '').trim());
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) - Number(this._opts.utcOffsetH) * 3600000) : new Date();
  }

  /**
   * En units of a Pl or more marked within 1 km of each apch onto the obj, those within 1.5 km of the obj left out (its
   * own garrison): an apch with a Pl or more seen on it is discarded (Understanding Aprc p 17). By the reading's side.
   */
  private _enNear(r: AorReading, drawn: any[]): Partial<Record<AorSide, string[]>> {
    const big = new Set(['14', '15', '16', '17', '18', '21', '22', '23']);
    const out: Partial<Record<AorSide, string[]>> = {};
    const en = drawn.filter((x) => x?.side === 'enemy' && String(x.key ?? '').startsWith('10') && big.has(String(x.ech)) && x.pts?.length);
    const segD = (p: AorXY, a: AorXY, b: AorXY): number => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
    };
    for (const a of r.apchs) {
      const names: string[] = [];
      for (const x of en) {
        const m: [number, number] = [x.pts.reduce((q: number, p: any) => q + p.x, 0) / x.pts.length, x.pts.reduce((q: number, p: any) => q + p.y, 0) / x.pts.length];
        const g = this._ground(r, m);
        if (Math.hypot(g[0] - r.mitg.at[0], g[1] - r.mitg.at[1]) < 1500) continue;
        let d = Infinity;
        for (let i = 0; i + 1 < a.path.length; i++) d = Math.min(d, segD(g, a.path[i], a.path[i + 1]));
        if (d <= 1000) names.push(String(x.label || x.name || 'En'));
      }
      if (names.length) out[a.side] = [...new Set(names)];
    }
    return out;
  }

  /** Re-apply the mechanics after a sheet input changed; returns how many paragraphs changed. */
  private _reapply(cause: AprcSrc): number {
    const doc = this._doc;
    if (!doc) return 0;
    const w = writeMechs(this._mechsIn(doc));
    // with no limitation left, the aim goes back to the outline's (the attack keeps its drafted words)
    if (!w.patches.some((x) => x.id === 'aim')) {
      const fresh = find(newDoc(doc.kind), 'aim');
      const now = find(doc, 'aim');
      if (fresh && now && now.src === 'aim') w.patches.unshift(doc.kind !== 'attk' ? { id: 'aim', draft: null, state: 'yours', basis: [], children: fresh.children, src: 'aim' } : { id: 'aim', children: fresh.children, src: 'aim' });
    }
    const n = retime(doc, w.patches, MECHS_FROM, cause);
    for (const c of w.confirm) if (!doc.confirm.some((x) => x.text === c.text)) doc.confirm.push({ ...c, src: 'gr' });
    return n;
  }

  /** The aim's limitations as set (a copy). */
  limits(): AprcLimits {
    return { ...(this._doc?.limits ?? {}) };
  }

  /**
   * Set the aim's limitations (merged into those set; null clears them). The aim, the def's layout, analysis and course,
   * the Vis and the timings (the attack's Time Calc) follow at once; the planner's words over them go stale.
   */
  setLimits(patch: Partial<AprcLimits> | null): void {
    if (!this._doc) this._doc = newDoc(this._opts.kind);
    const doc = this._doc;
    const denialWas = doc.limits?.denial ?? null;
    doc.limits = patch === null ? undefined : normLimits({ ...(doc.limits ?? {}), ...patch });
    const n = this._reapply('aim');
    this._msg = `Limitations ${doc.limits ? 'set' : 'cleared'}: ${n} paragraph${n === 1 ? '' : 's'} ${n === 1 ? 'follows' : 'follow'}`;
    this._changed();
    // the line of denial is marked on the trace: drawn again when it changes
    if ((doc.limits?.denial ?? null) !== denialWas) void this._retrace();
  }

  /** D Day's date ("YYYY-MM-DD", or empty for today): first / last lt and the moon follow; the Met para on the next Read. */
  setDDay(value: string): void {
    const v = String(value ?? '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      this._msg = 'D Day: pick a date, or leave it empty for today';
      return this._render();
    }
    this.setOptions({ dDay: v });
    this._persist('dDay', v);
    const n = this._reapply('time');
    this._msg = `D Day ${v || 'today'}: ${n} paragraph${n === 1 ? '' : 's'} re-timed${this._readHere ? '; the Met para takes it on the next Read' : ''}`;
    this._changed();
  }

  /** Time now as a D-time ("D-1 1000", or empty): the time aval, the essential timings and more / less time follow. */
  setNow(value: string): void {
    const v = String(value ?? '').trim();
    if (v && parseDTime(v) === null) {
      this._msg = 'Now: type a D-time such as D-1 1000, or leave it empty';
      return this._render();
    }
    this.setOptions({ timeNow: v });
    this._persist('timeNow', v);
    const n = this._reapply('time');
    this._msg = `Time now ${v || 'cleared'}: ${n} paragraph${n === 1 ? '' : 's'} re-timed`;
    this._changed();
  }

  /** A control of the Limitations box changed. */
  private _limitInput(t: HTMLInputElement): void {
    const k = t.dataset.lim as keyof AprcLimits;
    const v: any = t.type === 'checkbox' ? t.checked : k === 'other' ? String(t.value).split(/\n+/) : k === 'delayH' || k === 'maxCoys' || k === 'climbM' ? (t.value ? Number(t.value) : null) : t.value.trim() || null;
    if ((k === 'by' || k === 'deny' || k === 'noMovBefore' || k === 'clearBy') && v && parseDTime(v) === null) {
      this._msg = `${k === 'by' ? 'By' : k === 'deny' ? 'Denied until' : k === 'noMovBefore' ? 'No rearward mov before' : 'Clear by'}: type a D-time such as 0600 D+1`;
      return this._render();
    }
    this.setLimits({ [k]: v } as Partial<AprcLimits>);
  }

  /** The Limitations box in the Aim's panel. */
  private _limitsHtml(doc: AprcDoc): string {
    const l = doc.limits ?? {};
    const box = (k: string, on: boolean | undefined, label: string): string => `<label><input type="checkbox" data-lim="${k}" ${on ? 'checked' : ''}>${esc(label)}</label>`;
    const txt = (k: string, v: string | null | undefined, label: string, ph: string): string => `<label>${esc(label)}<input type="text" data-lim="${k}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" autocomplete="off"></label>`;
    const num = (k: string, v: number | null | undefined, label: string): string => `<label>${esc(label)}<input type="number" min="1" step="1" data-lim="${k}" value="${v ?? ''}"></label>`;
    let h = '<div class="ap-lims" role="group" aria-label="Limitations"><h5>Limitations</h5>';
    if (doc.kind === 'def') {
      const lines = this._mx?.reading?.lines.map((x) => x.id) ?? ['W', 'X', 'Y', 'Z'];
      h += box('fwd', l.fwd, 'Def to be as far fwd as tac feasible');
      h += `<label>No pen beyond line<select data-lim="noPen"><option value="">None</option>${lines.map((x) => `<option value="${x}" ${l.noPen === x ? 'selected' : ''}>Line ${x}</option>`).join('')}</select></label>`;
      h += `<label>Line of denial (given)<select data-lim="denial"><option value="">None</option>${lines.map((x) => `<option value="${x}" ${l.denial === x ? 'selected' : ''}>Line ${x}</option>`).join('')}</select></label>`;
      h += txt('allCosts', l.allCosts, 'Def at all costs', 'a place');
      h += box('attrition', l.attrition, 'Cause max attrition / delay onto the En');
      h += num('delayH', l.delayH, 'Delay the En for (hrs)');
      h += num('maxCoys', l.maxCoys, 'Not more than (Coys)');
      h += txt('by', l.by, 'Def to be ready by', '0600 D Day');
      h += box('salient', l.salient, 'Def of a salient');
      h += box('penetrated', l.penetrated, 'The En has pen the defs');
    } else if (doc.kind === 'wdr') {
      h += txt('newPosn', l.newPosn, 'New def posn (given)', 'a place');
      h += txt('deny', l.deny, 'Posn denied until', '0200 D+1');
      h += txt('noMovBefore', l.noMovBefore, 'No rearward mov before', '1900 D Day');
      h += txt('clearLine', l.clearLine, 'All tps clear of (line)', 'a line');
      h += txt('clearBy', l.clearBy, 'Clear by', '0500 D+1');
      h += num('delayH', l.delayH, 'Delay the En fwd of the new posn (hrs)');
      h += box('byDay', l.byDay, 'Wdr by day');
    } else {
      h += txt('by', l.by, 'Area to be captured by', '0600 D+1');
      h += box('destr', l.destr, 'Ensure max destr of the En (block before the attk)');
      h += box('night', l.night, 'Attk to be conducted at ni');
      h += box('bunkers', l.bunkers, 'The obj a tough area with bunkers');
    }
    h += `<label style="display:block">Others, one a line<textarea data-lim="other">${esc((l.other ?? []).join('\n'))}</textarea></label>`;
    h += `<p class="ap-mut">Given by the higher comd. ${doc.kind === 'def' ? 'They place the FDLs, the depth and the screens, and become advs (Understanding Aprc pp 3-4, 12); the line of denial stands for the line of no pen when none is set (OoW Vol I pp 17-18), and is marked on the trace.' : doc.kind === 'wdr' ? 'The essential timings are laid down by the highest comd (OoW Vol III p 19 para 17); the delay fwd of the new posn by the higher comd (p 10 para 6c). They set the Time and Space: the new posn ready by them, its prep 36 working hrs a Bn (OoW Vol I p 39), a ni wdr finished before first lt (OoW Vol III p 44).' : 'They set the Time Calc: backward from the time given (Mechs of Aprc (Attk) p 13).'}</p>`;
    if (doc.kind === 'attk') {
      const rd = this._mxKind === 'attk' ? this._mx?.climb ?? null : null;
      h += '<h5>Time Calc</h5>';
      h += box('quick', l.quick, 'A quick attk (from contact)');
      h += `<label>Climb SL to Obj (m, mountains)<input type="number" min="1" step="1" data-lim="climbM" value="${l.climbM ?? ''}" placeholder="${rd ? `read ${rd.m}` : ''}"></label>`;
      h += `<p class="ap-mut">Yours, not limitations: a quick attk takes contact to H by MIB p 89 / Annex L and IBB p 133; the climb puts the assault on the slant with 1 h for every 350 m (MW Annex F pp 311-313). In mountains Read takes it off the 30 m elevation from the SL (else the FUP) to the obj${rd ? `: ${rd.m} m from ${esc(rd.from)}` : ''}; a climb typed here overrides it.</p>`;
    }
    h += '</div>';
    return h;
  }

  /** Commit a typed cell; true when the sheet was drawn again. */
  private _commitCell(inp: HTMLInputElement): boolean {
    const [r, c] = String(inp.dataset.cell).split(',').map(Number);
    const p = this._doc && this._sel ? find(this._doc, this._sel) : null;
    if (!p?.table) return false;
    const now = tableOf(p, 'draft')?.rows[r]?.[c] ?? '';
    if (inp.value.trim() === now.trim()) return false;
    return this.setCell(this._sel!, r, c, inp.value);
  }

  /** Enter goes down a row, Tab across (Shift back), committing the cell first; the panel keeps the focus on the new cell. */
  private _cellKey(e: KeyboardEvent, inp: HTMLInputElement): boolean {
    if (e.key !== 'Enter' && e.key !== 'Tab') return false;
    const [r, c] = String(inp.dataset.cell).split(',').map(Number);
    const p = this._doc && this._sel ? find(this._doc, this._sel) : null;
    const tb = p ? tableOf(p, 'draft') : null;
    if (!tb) return false;
    const rows = tb.rows.length, cols = tb.head.length;
    let r2 = r, c2 = c;
    if (e.key === 'Enter') r2 = e.shiftKey ? r - 1 : r + 1;
    else {
      c2 = c + (e.shiftKey ? -1 : 1);
      if (c2 >= cols) ((c2 = 0), r2++);
      if (c2 < 0) ((c2 = cols - 1), r2--);
    }
    if (r2 < 0 || r2 >= rows) {
      if (e.key === 'Tab') return false; // out of the table: the focus moves on as usual
      r2 = Math.max(0, Math.min(rows - 1, r2));
    }
    e.preventDefault();
    this._commitCell(inp);
    const next = this._el?.querySelector(`.ap-tbl input[data-cell="${r2},${c2}"]`) as HTMLInputElement | null;
    next?.focus();
    next?.select();
    return true;
  }

  /** Confirm on Gr in the paragraph panel (C). */
  private _showConfirm(): void {
    this._commitDirty();
    this._sel = null;
    if (this._hideRt) {
      this._hideRt = false;
      this._saveUi();
    }
    this._render();
    const sec = this._el?.querySelector('.ap-sec-confirm') as HTMLElement | null;
    sec?.scrollIntoView({ block: 'start' });
    if (!sec) {
      this._msg = 'No Confirm on Gr items yet: Read first';
      this._render();
    }
  }

  /** Keep Tab inside the sheet while it is open as a window (not folded to its bar). */
  private _trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || this._win === 'min' || !this._el) return;
    const all = [...this._el.querySelectorAll<HTMLElement>('button,select,input,textarea,[tabindex="0"]')].filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null && !x.closest('[hidden]'));
    if (!all.length) return;
    const first = all[0], last = all[all.length - 1];
    const a = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (a === first || a === this._el)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (a === last || a === this._el)) {
      e.preventDefault();
      first.focus();
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
    if (this._askState && e.key === 'Escape') {
      e.preventDefault();
      this._askState.resolve(false);
      return;
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
    if (t.matches?.('.ap-tbl input[data-cell]') && this._cellKey(e, t as HTMLInputElement)) return;
    this._trapTab(e);
    if (e.defaultPrevented) return;
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
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      this.undo();
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
        // Shift+A accepts and moves on to the next to do
        const p = this._doc && this._sel ? find(this._doc, this._sel) : null;
        if (!p || statusOf(p) !== 'open') {
          if (e.shiftKey) this._nextTodo();
          else return;
          break;
        }
        this.accept(p.id, true);
        this._msg = `${this._num(p.id)} accepted: it prints in the fair copy`;
        if (e.shiftKey) this._nextTodo();
        else this._render();
        break;
      }
      case 'f':
      case 'F':
        this.setOptions({ copy: this._opts.copy === 'fair' ? 'draft' : 'fair' });
        this._persist('copy', this._opts.copy);
        break;
      case 'x':
      case 'X':
        this._toggleMenu('export');
        break;
      case 'm':
      case 'M':
        this._toggleMenu('log');
        break;
      case 'c':
      case 'C':
        this._showConfirm();
        break;
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

  private _toggleMenu(which: 'export' | 'more' | 'log'): void {
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
    } else if (this._menu === 'log') {
      h += `<div class="ap-ml">Messages, newest first</div>`;
      h += this._log.length
        ? this._log.map((x) => `<div class="ap-log${x.err ? ' err' : ''}"><time>${esc(x.at.toTimeString().slice(0, 5))}</time>${esc(x.msg)}</div>`).join('')
        : '<div class="ap-log">None yet.</div>';
      h += `<div class="ap-msep" role="separator"></div>`;
      h += item('confirm', `Confirm on Gr (${this._doc?.confirm.length ?? 0})`, 'What the reading asks you to check on the ground (C)');
    } else {
      h += item('json', 'Save to a file', '.json without the pictures (small; Read makes them again)');
      h += item('json-pics', 'Save with the pictures', '.json with the trace and the map shot (large)');
      h += item('open', 'Open a file…', 'An appreciation saved before');
      h += `<div class="ap-msep" role="separator"></div>`;
      h += this._clearArmed
        ? item('clear', 'Click again to clear', 'Every heading empty: your words go too (Undo brings them back)', { cls: 'danger armed' })
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

  /**
   * The line of denial the aim's limitations give (a defence's), passed to the Ground Guide so its Gr Scope AOR trace marks
   * it too (`guide.setAorDenial`). Sent only when it changes (or the guide is a new one), so a denial another host set on
   * the guide is not overwritten by every redraw; off (the Aprc turned off) it takes back the one it sent.
   */
  private _denialSent: { guide: any; id: string | null } | null = null;
  private _syncDenial(): void {
    const g = this._host.guide?.() ?? null;
    if (!g || typeof g.setAorDenial !== 'function') return;
    const id = this._enabled && this._doc?.kind === 'def' ? (this._doc.limits?.denial ?? null) : null;
    if (this._denialSent && this._denialSent.guide === g && this._denialSent.id === id) return;
    // nothing sent yet and nothing to send: leave the guide's own as it is
    if (!this._denialSent && id === null) return;
    g.setAorDenial(id);
    this._denialSent = { guide: g, id };
  }

  private _render(): void {
    this._syncDenial();
    if (!this._el || !this._open) return;
    const doc = this._doc ?? newDoc(this._opts.kind);
    const copy = this._opts.copy;
    const t = this._tally(doc);
    const fr = doc.frame;

    // header
    const frame = this._part('frame');
    const dot = this._part('dot');
    if (this._busy) this._renderBusy();
    else {
      frame.innerHTML = fr
        ? [fr.echelon, fr.place, fr.mover, `${fr.month}, ${fr.season === 'wet' ? 'after rain' : 'dry'}`].map((x) => `<span>${esc(x)}</span>`).join('') + `<span class="ap-fr-at">read ${esc(fr.readAt)}</span>`
        : '<span class="ap-fr-none">Not read yet</span>';
      frame.title = fr ? `AOR from ${fr.aor}; threat ${fr.threat}` : '';
      dot.className = `ap-dot ${this._dotErr ? 'err' : fr ? '' : 'idle'}`.trim();
      dot.title = this._dotErr ? `Last message: ${this._msg}` : fr ? `Read ${fr.readAt}` : 'Not read yet';
    }
    // while Read runs the button stops it
    const rb = this._part('read') as HTMLButtonElement;
    rb.disabled = false;
    rb.dataset.a = this._busy ? 'cancel' : 'read';
    rb.classList.toggle('pri', !this._busy);
    rb.innerHTML = this._busy ? `${UI.stop}Cancel` : `${UI.read}${fr ? 'Read again' : this._dotErr && this._log[0]?.msg.startsWith('Read') ? 'Retry' : 'Read'}`;
    rb.title = this._busy ? 'Stop the Read: nothing it found is taken, the sheet stays as it was' : 'Read the ground and the symbols on the map. Your words and acceptances are kept; what cannot be read again is kept from before.';
    (this._el.querySelector('[data-o="kind"]') as HTMLSelectElement).value = doc.kind;
    this._part('busy').classList.toggle('on', this._busy);
    const ask = this._part('ask');
    const q = this._askState;
    ask.hidden = !q;
    ask.innerHTML = q ? `${UI.warn}<span class="ap-note-t">${esc(q.text)}</span><button class="ap-btn sm pri" data-a="ask-yes">${esc(q.yes)}</button><button class="ap-btn sm" data-a="ask-no">${esc(q.no)}</button>` : '';

    // over the page
    for (const b of this._el.querySelectorAll<HTMLElement>('.ap-seg [data-a="copy"]')) b.setAttribute('aria-pressed', String(b.dataset.v === copy));
    this._part('copyhint').textContent = copy === 'fair' ? 'As it goes up: blanks print a ruled line' : 'With the marks, the proposals and the annexes';
    const hin = this._el.querySelector('[data-o="hHour"]') as HTMLInputElement;
    if (document.activeElement !== hin) hin.value = this._opts.hHour ?? '';
    const din = this._el.querySelector('[data-o="dDay"]') as HTMLInputElement;
    if (document.activeElement !== din) din.value = this._opts.dDay ?? '';
    const nin = this._el.querySelector('[data-o="timeNow"]') as HTMLInputElement;
    if (document.activeElement !== nin) nin.value = this._opts.timeNow ?? '';

    // the note under the header
    const guideOff = !this._host.guide?.()?.isEnabled;
    const note = this._part('note');
    const noteText = this._note || (guideOff && !fr ? 'Ground Guide is off: the Gr paragraphs are read through it.' : '');
    note.classList.toggle('on', !!noteText);
    note.innerHTML = noteText ? `${UI.warn}<span class="ap-note-t">${esc(noteText)}</span>${guideOff && this._host.turnOnGuide && !this._busy ? '<button class="ap-btn sm" data-a="guide" title="Turns the Ground Guide on (its cursor card and keys come with it) and reads once the terrain data has loaded">Turn on Ground Guide and read</button>' : ''}` : '';

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
    let chg = 0;
    walk(doc, (p) => {
      if (p.changed) chg++;
    });
    const n: Record<AprcFilter, number> = { all: t.all, todo: t.todo, open: t.open, stale: t.stale, written: t.written + t.stale, changed: chg };
    h += `<div class="ap-chips" role="group" aria-label="Show">${FILTERS.filter((x) => (x.f !== 'stale' || t.stale || this._filter === 'stale') && (x.f !== 'changed' || chg || this._filter === 'changed'))
      .map((x) => `<button class="ap-chip" data-a="filter" data-v="${x.f}" aria-pressed="${this._filter === x.f}">${x.label} <b>${n[x.f]}</b></button>`)
      .join('')}</div>`;
    if (t.open) h += `<button class="ap-btn sm" data-a="accept-all" title="Take every open proposal as it stands; you can take any back">Accept all ${t.open} proposal${t.open === 1 ? '' : 's'}</button>`;
    // the last Read's summary stays here after its toast has gone
    const last = doc.readAt ? Object.values(doc.readAt).sort().pop() : null;
    const style = styleNotes(doc);
    if (last || doc.confirm.length || style.length)
      h += `<div class="ap-lastread">${last ? `Last Read ${esc(last)}${chg ? `: ${chg} changed` : ''}. ` : ''}${doc.confirm.length ? `<button data-a="confirm" title="What the reading asks you to check on the ground (C)">Confirm on Gr ${doc.confirm.length}</button>` : ''}${style.length ? `${doc.confirm.length ? ' · ' : ''}<button data-a="sel" data-v="${esc(style[0].id)}" title="The books' writing rules: the first paragraph that breaks one">Writing rules ${style.length}</button>` : ''}</div>`;
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
        const ct = `<span>${r.chg ? `<span class="ap-chg" title="${r.chg} changed on the last Read"></span>` : ''}${r.match >= 2 ? `<span class="ap-ct" title="${r.match} ${this._filter === 'all' ? 'paragraphs' : 'shown'} under it">${r.match}</span>` : ''}</span>`;
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
        stale: 'None: nothing has changed under your words.',
        written: 'Nothing written yet. Select a paragraph and write in the box on the right.',
        changed: 'Nothing changed on the last Read.',
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
  private _rollup(p: AprcPara): { worst: ParaStatus; match: number; first: string; chg: number } {
    const f = this._filter;
    let worst: ParaStatus = 'head', match = 0, todo = 0, seen = 0, first = '', chg = 0;
    const go = (q: AprcPara) => {
      const s = statusOf(q);
      if (q.changed) chg++;
      const hit = f === 'changed' ? !!q.changed : f !== 'all' && inFilter(s, f);
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
    return { worst, match, first: first || p.id, chg };
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
    h += `<div class="ap-sec"><h5>Keys</h5><dl class="ap-keys"><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Previous, next paragraph</dd><dt><kbd>N</kbd></dt><dd>Next to do</dd><dt><kbd>A</kbd></dt><dd>Accept the proposal</dd><dt><kbd>Shift</kbd> + <kbd>A</kbd></dt><dd>Accept it and go to the next to do</dd><dt><kbd>Enter</kbd></dt><dd>Write in the paragraph (or double-click it)</dd><dt><kbd>Ctrl</kbd> + <kbd>Enter</kbd></dt><dd>Save as yours</dd><dt><kbd>Enter</kbd> / <kbd>Tab</kbd></dt><dd>In a table cell: save it, go down a row / across</dd><dt><kbd>F</kbd></dt><dd>Fair copy or draft copy</dd><dt><kbd>X</kbd></dt><dd>Export</dd><dt><kbd>C</kbd></dt><dd>Confirm on Gr</dd><dt><kbd>M</kbd></dt><dd>Messages</dd><dt><kbd>Ctrl</kbd> + <kbd>Z</kbd></dt><dd>Undo a clear, give-back, open or kind change</dd><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Fold the outline, the paragraph panel</dd><dt><kbd>Esc</kbd></dt><dd>Leave the box; again to close</dd><dt><kbd>Alt</kbd> + <kbd>A</kbd></dt><dd>Open or close the sheet (anywhere)</dd></dl></div>`;
    if (doc.confirm.length) h += `<div class="ap-sec ap-sec-confirm"><h5>Confirm on Gr (${doc.confirm.length})</h5><ul>${doc.confirm.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></div>`;
    return h;
  }

  /** The selected paragraph: its state, what to do about it, the box, its table, what it rests on. */
  private _paraHtml(doc: AprcDoc, p: AprcPara): string {
    const s = statusOf(p);
    const num = numberOf(doc, p.id);
    const part = lines(doc).find((l) => l.type === 'para' && l.p.id === p.id);
    const head = p.head ?? (part && part.type === 'para' ? asWords(part.part.title) : '');
    let h = `<h3 class="ap-rt-h"><span class="ap-rt-n">${esc(num)}</span>${esc(head)}</h3>`;
    const why = staleWhy(p);
    if (s !== 'head') h += `<div class="ap-badges"><span class="ap-badge st-${s}">${ICON[s]}${esc(s === 'stale' && why ? `${STALE_MARK[why]} you wrote it` : WORD[s])}</span></div>`;
    if (p.id === 'aim') h += this._limitsHtml(doc);
    const notes = styleNotes(doc).filter((x) => x.id === p.id);
    if (notes.length) h += `<div class="ap-call style"><div class="ap-call-t">The books' writing rules</div><ul>${notes.map((x) => `<li>${esc(x.note)}</li>`).join('')}</ul></div>`;

    if (s === 'stale' && why === 'rows' && !p.mine) {
      h += `<div class="ap-call stale"><div class="ap-call-t">${ICON.stale}${esc(STALE_WORD.rows)}</div><p>The table below shows them as added rows. Keep them, or take the new reading without them (Undo brings them back).</p><div class="ap-acts"><button class="ap-btn" data-a="keep">Keep my rows</button><button class="ap-btn" data-a="give">Use the new reading</button></div></div>`;
    } else if (s === 'stale') {
      h += `<div class="ap-call stale"><div class="ap-call-t">${ICON.stale}${esc(STALE_WORD[why ?? 'gr'])}</div><p>It now reads:</p><div class="ap-quote">${esc(p.draft ?? '')}</div><div class="ap-acts"><button class="ap-btn" data-a="keep">Keep mine</button><button class="ap-btn" data-a="give">Use the new reading</button></div></div>`;
    } else if (s === 'open') {
      h += `<div class="ap-call judge"><div class="ap-call-t">${ICON.open}A proposal for you to judge</div><p>It prints in the fair copy only once you accept it, or write your own in the box.</p><div class="ap-acts"><button class="ap-btn pri" data-a="acc">Accept <kbd>A</kbd></button></div></div>`;
    } else if (s === 'accepted') {
      h += `<div class="ap-call done">${ICON.accepted}<span class="sp">Accepted: it prints as it stands.</span><button class="ap-btn sm ghost" data-a="acc" data-v="off">Take back</button></div>`;
    } else if (s === 'gr' || s === 'map') {
      h += `<p class="ap-lead">${s === 'gr' ? 'Drafted from the ground reading.' : p.src === 'aim' || p.src === 'time' ? 'Written from what you set on the sheet (the limitations, H, D Day, time now).' : 'Read from the symbols on the map and the last Check my plan.'} It prints as it stands. Edit it, or save it as yours, and Read will not change it.</p>`;
    } else if (s === 'yours') {
      h += `<p class="ap-lead">The map cannot tell this. Write it, or it prints a ruled line.</p>`;
    } else if (s === 'head') {
      h += `<p class="ap-lead">A heading: its sub-paragraphs carry the words. You may add words under the heading.</p>`;
    }
    // what the last Read (or a new H) changed in the draft, and what it said before
    if (p.changed && p.before) {
      const b = p.before;
      h += `<div class="ap-call chg"><div class="ap-call-t"><span class="ap-chg"></span>Changed on the last ${p.changed === 'h' ? 'H change' : 'Read'} (${esc(SRC_WORD[p.changed])})</div>${b.draft ? `<p>Before this ${p.changed === 'h' ? 'change' : 'Read'}:</p><div class="ap-quote">${esc(b.draft)}</div>` : `<p>${b.table ? 'Its table changed.' : 'New on this Read: it was a ruled line before.'}</p>`}</div>`;
    }
    if (p.discarded && !p.mine) h += `<div class="ap-call done"><span class="sp">Your earlier words (given back ${esc(p.discarded.at.slice(0, 16).replace('T', ' '))}): <span class="ap-quote">${esc(p.discarded.text)}</span></span><button class="ap-btn sm" data-a="restore">Put back</button></div>`;

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
      h += `<div class="ap-sec"><h5>Table</h5><p class="ap-mut">Type into any cell: what you type is yours, kept on its row and never overwritten. Empty a cell to take the tool's value back. Enter goes down a row, Tab across.</p><div class="ap-tblw"><table class="ap-tbl" style="min-width:${Math.max(100, tb.head.length * 84)}px"><colgroup>${tb.head.map((_, c) => `<col style="width:${(((tb.widths ?? [])[c] ?? 1 / tb.head.length) * 100).toFixed(0)}%">`).join('')}</colgroup><tr>${tb.head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>`;
      tb.rows.forEach((row, r) => {
        h += `<tr>${row.map((v, c) => `<td><input data-cell="${r},${c}" value="${esc(v)}" aria-label="${esc(tb.head[c])}, row ${r + 1}${r >= p.table!.rows.length ? ' (added)' : ''}"${cellTyped(p, r, c) ? ' class="mine"' : ''}></td>`).join('')}</tr>`;
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
    if (p.src) h += `<p class="ap-mut" style="margin-top:14px">Drafted from the ${esc(SRC_WORD[p.src])}${doc.readAt?.[p.src] ? `, read ${esc(doc.readAt[p.src]!)}` : ''}.</p>`;
    return h;
  }

  /** The last message as a toast: it stays a few seconds (longer for a failure) and is read out once. */
  private _toast(): void {
    // a message while Read runs waits for it (the header shows the steps meanwhile)
    if (!this._el || this._toastSeq === this._msgSeq || this._busy) return;
    this._toastSeq = this._msgSeq;
    const el = this._part('toast');
    const msg = this._msg;
    if (!msg) return;
    const err = ERR_RE.test(msg);
    const undo = !!this._undo && this._undo.seq === this._msgSeq && this._undo.ver === this._docVer;
    el.innerHTML = `${err ? UI.err : UI.ok}<span>${esc(msg)}</span>${undo ? `<button class="ap-btn sm" data-a="undo" title="Undo: ${esc(this._undo!.label.toLowerCase())} (Ctrl+Z)">Undo</button>` : ''}`;
    el.classList.toggle('err', err);
    el.classList.toggle('act', undo);
    el.classList.add('on');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('on', 'act'), undo ? 12000 : err ? 9000 : 4500);
  }
}
