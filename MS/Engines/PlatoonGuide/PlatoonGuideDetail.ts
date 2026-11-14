/**
 * PlatoonGuideDetail.ts
 *
 * The Pl Detail: the Platoon Guide's wide card, built like the Ground Detail (GroundGuideDetail.ts; user, 2026-11-11:
 * "make it platoonguide like cards" of the Ground Guide). Docked at the foot of the map, it reads in the same parts:
 *   - the tab row, each tab with its own answer under its name (Here: GO on foot, See: 29% seen, Danger: 10 ...);
 *   - who and what it is read for (echelon and bubble, from where, eye height, grid and sheet, month and light);
 *   - the answer strip: the tab's answer in a toned block, then its key facts on one line;
 *   - the hero: the tab's big picture at the left, as tall as the card (user, 2026-11-13: "These dials should be big, they
 *     are important"): Here the bubble radar, See what you see, Danger the dangers on the Rds round you, Help the nearest
 *     help, People where the people are (the population grid with the people inside each ring), Stop where to stop (the
 *     bubble on its grid, each site coloured by the test that ruled it out, the patrol base, the next best sites and the
 *     OP with what it sees); its key beside it on wide screens, under it on narrow ones, one item to a line;
 *   - the band: the tab's other pictures and lists down newspaper columns of a fixed height. It never scrolls: what does
 *     not fit goes to a next page (the wheel over the card, or ‹ › at its foot).
 * Folded, it is the answer bar: the tab row alone at the foot of the map, every tab's answer at once (views 1 2 3 of
 * platoon-guide-view-options.html); a click on a tab opens it there. A walks the tabs (Shift+A back); Esc or ▾ folds it.
 * The pin pill says when the guide holds the reading at a point. Every colour and size from GroundGuideTokens.ts; every
 * picture is north up and turns with the map, and every direction carries an arrow (GroundGuideNorth). DOM nodes and
 * textContent only.
 */

import { ensureTokensCss, gauge, LEVEL_COLOR, LEVEL_TEXT, STEP_COLOR, STEP_TEXT, TONE } from '../GroundGuide/GroundGuideTokens';
import { POPULATION_CLASSES, populationClass } from '../GroundGuide/GroundGuidePopulation';
import { ensureNorthCss, orientNorth, whereNode } from '../GroundGuide/GroundGuideNorth';
import type { PlGoing, PlReading, PlSee, PlSpot } from './PlatoonGuideRead';
import { brg, briefLines, dist, ECHELON_WORD, EYE_WORD, num, type PlatoonBrief } from './PlatoonGuideText';
import { leadDanger } from './PlatoonGuideCard';
import { dangerGlyph, glyph, GLYPH_CODE, GLYPH_COLOR, GLYPH_WORD, glyphIcon, helpCode, plRadar, RADAR_KEY, type GlyphKind } from './PlatoonGuideRadar';

/** Danger kinds in the order a patrol cares about them: what can kill it first, then what helps the enemy. */
const DANGER_RANK: Record<string, number> = { mine: 0, ambush: 0, block: 0, vp: 1, rooftops: 1, overlooked: 2 };
function byDanger(a: PlSpot, b: PlSpot): number {
  return (DANGER_RANK[a.kind] ?? 3) - (DANGER_RANK[b.kind] ?? 3) || (b.score ?? 0) - (a.score ?? 0) || a.distM - b.distM;
}

/** A colour swatch for a key line. */
function sw(color: string, opacity = 1): HTMLElement {
  const i = document.createElement('i');
  i.className = 'ms-pld-sw';
  i.style.background = color;
  i.style.opacity = String(opacity);
  return i;
}
/** A short arc swatch (the radar's rim). */
function arcSw(color: string): HTMLElement {
  const i = document.createElement('i');
  i.className = 'ms-pld-arc';
  i.style.borderColor = color;
  return i;
}

/** A small shape for a key line: a diamond, a triangle or a ring (the shapes on the See picture). */
function miniShape(kind: 'diamond' | 'tri' | 'ring', color: string): SVGSVGElement {
  const svg = svgEl('svg', { width: 13, height: 13, viewBox: '0 0 13 13', 'aria-hidden': 'true' }) as SVGSVGElement;
  if (kind === 'diamond') svgEl('path', { d: 'M6.5 1.2L11.8 6.5L6.5 11.8L1.2 6.5Z', fill: color, stroke: '#14181d', 'stroke-width': 1 }, svg);
  else if (kind === 'tri') svgEl('path', { d: 'M6.5 1.5L12 11.5H1Z', fill: color, stroke: '#14181d', 'stroke-width': 1 }, svg);
  else svgEl('circle', { cx: 6.5, cy: 6.5, r: 5, fill: 'none', stroke: color, 'stroke-width': 1.3, 'stroke-dasharray': '2 2' }, svg);
  return svg;
}

export type PlTab = 'here' | 'see' | 'danger' | 'people' | 'help' | 'stop' | 'patrol';
const TAB_LABEL: Record<PlTab, string> = { here: 'Here', see: 'See', danger: 'Danger', people: 'People', help: 'Help', stop: 'Stop', patrol: 'Patrol' };
const STYLE_ID = 'ms-platoon-guide-detail-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const COL_GAP = 28;
const COL_MIN = 270;
const GO_WORD: Record<PlGoing, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO', unknown: 'not known' };
const LVL = ['None', 'Poor', 'Fair', 'Good'];
type AnsTone = 'go' | 'slow' | 'nogo' | 'marg' | 'warn' | 'c0' | 'none';
const scoreTone = (s: number): AnsTone => (s >= 70 ? 'nogo' : s >= 50 ? 'slow' : 'marg');
const SCORE_COL = (s: number) => (s >= 70 ? STEP_COLOR.nogo : s >= 50 ? STEP_COLOR.slow : TONE.marg.dot);

const CSS = `
.ms-pld{position:fixed;left:10px;right:10px;bottom:10px;z-index:2147482810;height:calc(52vh + 40px);min-height:min(520px,calc(100vh - 20px));max-height:calc(100vh - 20px);
  display:none;flex-direction:column;box-sizing:border-box;border-radius:12px;background:var(--gg-card);border:1px solid #5a6470;box-shadow:0 10px 30px rgba(0,0,0,.5);
  font:400 13.5px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:var(--gg-text)}
.ms-pld.ms-open{display:flex}
.ms-pld-h{flex:none;display:flex;align-items:center;gap:6px 10px;padding:8px 10px 7px;background:var(--gg-head);border-radius:11px 11px 0 0;flex-wrap:wrap}
.ms-pld-name{font-weight:750;font-size:13.5px;color:var(--gg-strong);padding:0 6px 0 4px;white-space:nowrap}
.ms-pld-tabs{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
.ms-pld-tab{display:inline-flex;flex-direction:column;align-items:flex-start;padding:5px 10px;border-radius:8px;border:1px solid transparent;background:transparent;color:#d5dbe1;
  font:600 13.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer;text-align:left;max-width:190px}
.ms-pld-tab:hover{background:rgba(255,255,255,.08);color:#fff}
.ms-pld-tab:focus-visible{outline:2px solid var(--gg-accent);outline-offset:1px}
.ms-pld-tab[aria-selected="true"]{background:#e4e8ec;border-color:#e4e8ec;color:#14181d}
.ms-pld-ta{display:flex;align-items:center;gap:5px;max-width:100%;font-size:12px;font-weight:600;color:var(--gg-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-pld-tab[aria-selected="true"] .ms-pld-ta{color:#3d4650}
.ms-pld-dot{display:inline-block;flex:none;width:9px;height:9px;border-radius:50%}
.ms-pld-hsp{flex:1}
.ms-pld-btn{font:400 13.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:30px;padding:0 10px;white-space:nowrap}
.ms-pld-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.ms-pld-btn:focus-visible{outline:2px solid var(--gg-accent);outline-offset:1px}
.ms-pld-btn.ms-x{width:30px;padding:0;font-size:18px}
.ms-pld-mode{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:3px 14px;padding:6px 16px;background:var(--gg-strip);border-top:1px solid var(--gg-hair-soft);font-size:13.5px;color:var(--gg-label)}
.ms-pld-mode b{color:#fff;font-weight:600}
.ms-pld-mode .ms-warn{color:var(--gg-warn);font-weight:600}
.ms-pld-mode .ms-when{margin-left:auto}
.ms-pld-sum{flex:none;display:flex;flex-wrap:wrap;align-items:stretch;row-gap:10px;padding:10px 16px 11px;background:var(--gg-strip);border-top:1px solid var(--gg-hair-soft);border-bottom:1px solid var(--gg-hair)}
.ms-pld-ans{flex:1.6 1 300px;min-width:0;max-width:460px;margin-right:12px;padding:8px 14px 9px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.18)}
.ms-pld-ans[data-tone="go"]{background:rgba(47,168,98,.12);border-color:rgba(47,168,98,.5)}
.ms-pld-ans[data-tone="marg"]{background:rgba(241,214,70,.1);border-color:rgba(241,214,70,.5)}
.ms-pld-ans[data-tone="slow"]{background:rgba(238,138,31,.12);border-color:rgba(238,138,31,.55)}
.ms-pld-ans[data-tone="nogo"]{background:rgba(229,72,77,.12);border-color:rgba(229,72,77,.55)}
.ms-pld-ans[data-tone="warn"]{background:rgba(255,210,122,.1);border-color:rgba(255,210,122,.5)}
.ms-pld-al{font-size:12px;line-height:1.3;color:var(--gg-label)}
.ms-pld-av{margin-top:1px;font-size:22px;font-weight:750;line-height:1.2;color:#fff}
.ms-pld-as{margin-top:2px;font-size:12px;line-height:1.35;color:var(--gg-label);overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ms-pld-fact{flex:1 1 130px;min-width:0;max-width:290px;padding:0 14px;border-left:1px solid var(--gg-hair)}
.ms-pld-ans+.ms-pld-fact{border-left:0;padding-left:0}
.ms-pld-fk{font-size:12px;line-height:1.3;color:var(--gg-label)}
.ms-pld-fv{margin-top:2px;font:750 15.5px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#f4f6f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-pld-fv[data-tone="go"]{color:${STEP_TEXT.go}}.ms-pld-fv[data-tone="slow"]{color:${STEP_TEXT.slow}}.ms-pld-fv[data-tone="nogo"]{color:${STEP_TEXT.nogo}}
.ms-pld-fv[data-tone="marg"]{color:${TONE.marg.text}}.ms-pld-fv[data-tone="warn"]{color:var(--gg-warn)}.ms-pld-fv[data-tone="c0"]{color:var(--gg-label)}
.ms-pld-fs{margin-top:1px;font-size:12px;line-height:1.35;color:var(--gg-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-pld-band{flex:1 1 auto;min-height:120px;position:relative;box-sizing:border-box;padding:12px 16px 10px}
.ms-pld-clip{height:100%;overflow:hidden}
.ms-pld-flow{height:100%;column-gap:${COL_GAP}px;column-fill:auto;column-rule:1px solid rgba(255,255,255,.1)}
@media (prefers-reduced-motion:no-preference){.ms-pld-flow{transition:transform .22s cubic-bezier(.25,1,.5,1)}}
.ms-pld-tile{break-inside:avoid;margin:0 0 16px;min-width:0}
.ms-pld-cap{display:flex;align-items:center;gap:7px;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid var(--gg-hair);font:600 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;color:#e4e8ec}
.ms-pld-pair{display:grid;grid-template-columns:96px minmax(0,1fr);column-gap:12px;padding:6px 0}
.ms-pld-pair:first-child{padding-top:1px}
.ms-pld-pair+.ms-pld-pair{border-top:1px solid var(--gg-hair-soft)}
.ms-pld-k{font-size:12px;color:var(--gg-label);padding-top:1px;line-height:1.35}
.ms-pld-v{min-width:0;line-height:1.4}
.ms-pld-v b{color:#fff;font-weight:600}
.ms-pld-why{color:var(--gg-soft);font-size:12px}
.ms-pld-pic{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.ms-pld-pic>div{flex:1 1 120px;min-width:0}
.ms-pld-pic>div:first-child{flex:0 0 auto}
.ms-pld-pic>div+div{flex:1 1 150px}
.ms-pld-pic .ms-pld-pair{grid-template-columns:62px minmax(0,1fr);column-gap:8px}
/* A picture and its words side by side, never wrapped under it: the tile stays one column high. */
.ms-pld-pic.ms-row{flex-wrap:nowrap;align-items:center;gap:10px}
.ms-pld-pic.ms-row>div+div{flex:1 1 0;min-width:0}
.ms-pld .ms-gg-gz-lab{white-space:nowrap}
.ms-pld-big{font-size:22px;font-weight:750;color:#fff;line-height:1.2;font-variant-numeric:tabular-nums}
.ms-pld-bar{display:flex;height:12px;border-radius:3px;overflow:hidden;margin:4px 0 4px;background:#3a434e}
.ms-pld-bar>i{display:block;height:100%}
.ms-pld-li{padding:4px 0;font-size:13.5px}
.ms-pld-li+.ms-pld-li{border-top:1px solid var(--gg-hair-soft)}
.ms-pld-li>.ms-pld-dot{margin-right:7px;vertical-align:0}
.ms-pld-li.ms-go{cursor:pointer}
.ms-pld-li.ms-go:hover{background:rgba(255,255,255,.06)}
.ms-pld-dirs{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;margin:2px 0 6px}
.ms-pld-dir{text-align:center;font-size:12px;font-weight:750;border-radius:4px;padding:3px 0;color:#14181d;background:#3a434e}
.ms-pld-note{font-size:12px;color:var(--gg-soft);margin-top:6px}
.ms-pl-radar{display:block;margin:0 auto}
/* The big pictures fit the band's height (set by _layout), so a tile is never split across two columns. */
.ms-pld-flow .ms-pl-radar,.ms-pld-flow .ms-pld-fan{width:min(230px,calc(var(--pld-h,320px) - 120px));height:min(230px,calc(var(--pld-h,320px) - 120px));min-width:120px;min-height:120px}
.ms-pld-rkey{display:flex;flex-direction:column;gap:3px;margin-top:6px;font-size:12px;line-height:1.35;color:var(--gg-label)}
.ms-pld-sw{display:inline-block;width:11px;height:11px;border-radius:2px;margin:0 4px 0 2px;vertical-align:-1px}
.ms-pld-arc{display:inline-block;width:12px;height:12px;border:3px solid;border-color:inherit;border-bottom-color:transparent!important;border-left-color:transparent!important;border-radius:50%;margin:0 5px -2px 2px;transform:rotate(-45deg);box-sizing:border-box}
.ms-pld-gl{display:flex;flex-wrap:wrap;gap:3px 10px}
.ms-pld-gl>span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.ms-pld-empty{color:var(--gg-label);padding:20px 12px;text-align:center}
.ms-pld-f{flex:none;padding:6px 14px 7px;font-size:12px;color:var(--gg-label);border-top:1px solid var(--gg-hair-soft);display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center}
.ms-pld-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;margin-right:5px;box-sizing:border-box;border-radius:4px;
  font:750 12px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
.ms-pld-pg{margin-left:auto;color:var(--gg-warn);font-weight:600}
/* The answer bar: the Pl Detail folded to its tab row (every tab's answer at once). */
.ms-pld.ms-bar{display:flex;height:auto;min-height:0}
.ms-pld.ms-bar .ms-pld-h{border-radius:11px}
.ms-pld-nm{display:flex;flex-direction:column;padding:0 8px 0 4px;min-width:0;max-width:160px}
.ms-pld-nm>b{font-weight:750;font-size:13.5px;line-height:1.25;color:var(--gg-strong);white-space:nowrap}
.ms-pld-nm>span{font-size:12px;line-height:1.3;color:var(--gg-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-pld-pin{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 8px;border-radius:999px;background:#3b3220;border:1px solid var(--gg-warn);color:var(--gg-warn);font-size:12px;font-weight:650;white-space:nowrap}
.ms-pld-hint{display:inline-flex;align-items:center;font-size:12px;color:var(--gg-label);white-space:nowrap}
/* The open Detail: the tab's big picture on the left, the answer strip and the tiles beside it. */
.ms-pld-body{flex:1 1 auto;min-height:0;display:flex}
.ms-pld-hero{flex:none;display:flex;flex-direction:column;align-items:center;width:max(var(--pld-hero,260px),250px);padding:10px 14px 8px 16px;border-right:1px solid var(--gg-hair);overflow:hidden}
.ms-pld-hcap{flex:none;align-self:stretch;margin:0 0 6px;padding-bottom:6px;border-bottom:1px solid var(--gg-hair);font:600 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;color:#e4e8ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-pld-hpic{flex:none;line-height:0}
.ms-pld-hpic>svg{display:block;width:var(--pld-hero,260px);height:var(--pld-hero,260px)}
.ms-pld-hkey{flex:none;align-self:stretch;margin-top:6px;font-size:12px;line-height:1.35;color:var(--gg-label)}
.ms-pld-hkey .ms-pld-rkey{margin-top:0}
/* Wide screens: the key beside the picture, so the picture takes the whole height. */
.ms-pld-hero.ms-side{display:grid;grid-template-columns:var(--pld-hero,260px) 172px;grid-template-rows:auto minmax(0,1fr);column-gap:14px;align-items:start;width:auto}
.ms-pld-hero.ms-side .ms-pld-hcap{grid-column:1 / span 2}
.ms-pld-hero.ms-side .ms-pld-hkey{margin-top:2px}
.ms-pld-hero.ms-side .ms-pld-gl{flex-direction:column;gap:3px}
.ms-pld-main{flex:1 1 0;min-width:0;display:flex;flex-direction:column}
.ms-pld-main .ms-pld-sum{border-top:0}
.ms-pld-pgb{font:700 14px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;width:26px;height:22px;padding:0}
.ms-pld-pgb:hover:not(:disabled){background:rgba(255,255,255,.14);color:#fff}
.ms-pld-pgb:disabled{opacity:.35;cursor:default}
.ms-pld-pgw{display:inline-flex;align-items:center;gap:6px;margin-left:auto}
.ms-pld-pgw .ms-pld-pg{margin-left:0}
/* People pictures. */
.ms-pld-rb{display:grid;grid-template-columns:62px minmax(0,1fr) auto;align-items:center;column-gap:8px;padding:3px 0}
.ms-pld-rb>i{display:block;height:14px;border-radius:3px;min-width:2px}
.ms-pld-rb>b{font-variant-numeric:tabular-nums;color:#fff;font-weight:700}
.ms-pld-rb>span{font-size:12px;color:var(--gg-label)}
.ms-pld-cls{display:inline-flex;align-items:center;gap:5px;padding:1px 8px 1px 5px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid rgba(255,255,255,.2)}
.ms-pld-waf{display:grid;grid-template-columns:repeat(10,11px);gap:2px;margin:4px 0 6px}
.ms-pld-waf>i{display:block;width:11px;height:11px;border-radius:2px}
.ms-pld-chips{display:flex;flex-wrap:wrap;gap:5px 6px;margin:2px 0 6px}
.ms-pld-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px 2px 5px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);font-size:12.5px;font-weight:650}
.ms-pld-chip>b{color:#fff}
/* Keys: one item to a line, its code bold. */
.ms-pld-ki{display:flex;align-items:center;gap:5px;min-width:0}
.ms-pld-ki>b{color:#fff;font-weight:750;min-width:30px}
.ms-pld-ki>svg{flex:none}
.ms-pld-gl.ms-codes{gap:3px 12px}
/* Narrow screens (key under the dial): key items two to a row so the dial keeps its size; words and lists span both. */
.ms-pld-hero:not(.ms-side) .ms-pld-rkey{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 12px}
.ms-pld-hero:not(.ms-side) .ms-pld-rkey>:not(.ms-pld-ki){grid-column:1 / -1}
/* Stop pictures. */
.ms-pld-pbh{display:flex;align-items:center;gap:8px;margin:0 0 6px;cursor:pointer}
.ms-pld-pbh:hover .ms-pld-big{text-decoration:underline}
.ms-pld-ck{display:grid;grid-template-columns:14px 88px minmax(0,1fr);align-items:center;column-gap:8px;padding:2px 0;min-height:20px}
.ms-pld-ck+.ms-pld-ck{border-top:1px solid var(--gg-hair-soft)}
.ms-pld-ck>.ms-ok{color:${STEP_TEXT.go};font-weight:800}
.ms-pld-ckv{display:flex;align-items:center;gap:8px;min-width:0}
.ms-pld-ckv>svg{flex:none}
.ms-pld-pips{display:inline-flex;gap:3px;margin-right:8px;vertical-align:-1px}
.ms-pld-pips>i{display:block;width:16px;height:10px;border-radius:2px;background:#3a434e}
.ms-pld-lim{position:relative;flex:0 0 64px;height:8px;border-radius:4px;background:#3a434e;overflow:visible}
.ms-pld-lim>i{display:block;height:100%;border-radius:4px}
.ms-pld-lim>u{position:absolute;top:-3px;width:2px;height:14px;background:#fff;border-radius:1px;transform:translateX(-1px)}
.ms-pld-lim.ms-tall{display:block;height:12px;margin:8px 0 2px}
.ms-pld-lim.ms-tall>u{top:-4px;height:20px}
.ms-pld-fr{display:grid;grid-template-columns:minmax(0,1fr) 84px 38px;align-items:center;column-gap:8px;padding:2px 0;font-size:12.5px;line-height:1.3}
.ms-pld-fr>span{display:flex;align-items:center;min-width:0;color:var(--gg-label)}
.ms-pld-fr>b{grid-column:3;grid-row:1;text-align:right;font-variant-numeric:tabular-nums;color:#fff;font-weight:700}
.ms-pld-fr.ms-pass>span{color:#fff;font-weight:650}
.ms-pld-fb{grid-column:2;grid-row:1;display:flex;height:9px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,.06)}
.ms-pld-fb>i{display:block;height:100%}
.ms-pld-alt{display:flex;flex-wrap:wrap;align-items:center;gap:0 6px}
.ms-pld-alt>.ms-pld-why{flex-basis:100%;padding-left:22px}
.ms-pld-altn{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#2b313a;border:1px solid #545e6b;font-size:11px;font-weight:750;color:#fff}
`;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svgEl(tag: string, attrs: Record<string, string | number>, parent?: Element, text?: string): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e as SVGElement;
}
function where(s: PlSpot): Node {
  return s.distM < 15 ? document.createTextNode('here') : whereNode(s.distM, s.dir, s.bearingDeg);
}
function tile(cap: string, ...content: Array<Node | null | false | undefined>): HTMLElement {
  const t = el('div', 'ms-pld-tile');
  t.append(el('div', 'ms-pld-cap', cap));
  for (const c of content) if (c) t.append(c);
  return t;
}
function pairs(rows: Array<[string, Node | string] | null | false>): HTMLElement {
  const d = el('div');
  for (const r of rows) {
    if (!r) continue;
    const p = el('div', 'ms-pld-pair');
    const v = el('div', 'ms-pld-v');
    v.append(r[1]);
    p.append(el('div', 'ms-pld-k', r[0]), v);
    d.append(p);
  }
  return d;
}
function frag(...parts: Array<Node | string | null | undefined | false>): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const p of parts) if (p) f.append(p);
  return f;
}
function b(text: string): HTMLElement {
  return el('b', undefined, text);
}
function why(text: string | undefined | null): Node | string {
  return text ? el('span', 'ms-pld-why', ` · ${text}`) : '';
}
function spotV(s: PlSpot | null | undefined, opts: { name?: boolean; why?: boolean } = {}): Node {
  if (!s) return el('span', 'ms-pld-why', 'none recorded');
  const nm = opts.name !== false && s.name && s.name !== s.label ? ` ${s.name}` : '';
  return frag(b(`${s.label}${nm}`), ' ', where(s), opts.why && s.why ? why(s.why) : '');
}
function dot(color: string): HTMLElement {
  const d = el('span', 'ms-pld-dot');
  d.style.background = color;
  return d;
}

/** A map pin: the reading is held at a point. */
function pinIcon(): SVGSVGElement {
  const svg = svgEl('svg', { width: 12, height: 14, viewBox: '0 0 12 14', 'aria-hidden': 'true' }) as SVGSVGElement;
  svgEl('path', { d: 'M6 13.5C6 13.5 1 8.4 1 5.2A5 5 0 0 1 11 5.2C11 8.4 6 13.5 6 13.5Z', fill: 'currentColor' }, svg);
  svgEl('circle', { cx: 6, cy: 5.2, r: 1.9, fill: '#3b3220' }, svg);
  return svg;
}
/** A place label short enough to sit beside a glyph on a dial. */
function shortLabel(s: string): string {
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}

/** A list of places, each with a dot and its distance and arrow; a click moves the map to it. */
function spotList(list: PlSpot[], color: (s: PlSpot) => string, goTo: (s: PlSpot) => void, opts: { why?: boolean; label?: (s: PlSpot) => string } = {}): HTMLElement {
  const d = el('div');
  for (const s of list) {
    const li = el('div', 'ms-pld-li ms-go');
    li.title = 'Show on the map';
    li.append(dot(color(s)), b(opts.label ? opts.label(s) : `${s.label}${s.name && s.name !== s.label ? ` ${s.name}` : ''}`), ' ', where(s));
    if (opts.why && s.why) li.append(why(s.why));
    li.addEventListener('click', () => goTo(s));
    d.append(li);
  }
  return d;
}

// ── pictures ─────────────────────────────────────────────────────────────────

/** The visibility sketch: seen (green), screened (amber), dead ground (red), range rings, landmarks; north up, turns with the map. */
function fanSvg(S: PlSee): SVGSVGElement {
  const W = 230, C = W / 2, R = C - 14;
  const svg = svgEl('svg', { width: W, height: W, viewBox: `0 0 ${W} ${W}`, role: 'img', 'aria-label': 'Visibility sketch', class: 'ms-pld-fan' }) as SVGSVGElement;
  svgEl('circle', { cx: C, cy: C, r: R + 2, fill: '#14181d', stroke: '#5d6772', 'stroke-width': 1.3 }, svg);
  const g = svgEl('g', { 'data-gv-rose': `${C} ${C}` }, svg);
  const k = R / S.radiusM;
  const pt = (bd: number, m: number) => [C + Math.sin((bd * Math.PI) / 180) * m * k, C - Math.cos((bd * Math.PI) / 180) * m * k];
  const half = 180 / S.rays.length;
  const fill = ['', STEP_COLOR.go, '#ffb300', STEP_COLOR.nogo];
  const op = [0, 0.5, 0.65, 0.8];
  for (const ray of S.rays) {
    let i = 0;
    while (i < ray.states.length) {
      const st = ray.states[i];
      let j = i;
      while (j + 1 < ray.states.length && ray.states[j + 1] === st) j++;
      if (st) {
        const r0 = i * S.stepM, r1 = (j + 1) * S.stepM;
        const a = pt(ray.bearingDeg - half, r0), bb = pt(ray.bearingDeg + half, r0), c = pt(ray.bearingDeg + half, r1), d = pt(ray.bearingDeg - half, r1);
        svgEl('path', { d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${bb[0].toFixed(1)} ${bb[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}L${d[0].toFixed(1)} ${d[1].toFixed(1)}Z`, fill: fill[st], 'fill-opacity': op[st] }, g);
      }
      i = j + 1;
    }
  }
  let lastLy = C;
  for (const m of [100, 300, 500, 1000, 1500, 2000].filter((x) => x <= S.radiusM)) {
    svgEl('circle', { cx: C, cy: C, r: (m * k).toFixed(1), fill: 'none', stroke: 'rgba(255,255,255,.35)', 'stroke-dasharray': '2 3' }, g);
    const ly = C + m * k - 4;
    if (ly - lastLy < 14) continue; // too close to the last label: the ring alone
    lastLy = ly;
    svgEl('text', { x: C, y: ly.toFixed(1), 'text-anchor': 'middle', fill: '#e6edf3', 'font-size': 10.5, 'font-family': 'system-ui,Segoe UI,Arial,sans-serif', 'paint-order': 'stroke', stroke: '#14181d', 'stroke-width': 3, 'data-gv-upright': `${C} ${(ly - 4).toFixed(1)}` }, g, m >= 1000 ? `${m / 1000} km` : `${m}`);
  }
  for (const s of S.refs.filter((x) => x.distM <= S.radiusM)) {
    const [x, y] = pt(s.bearingDeg, s.distM);
    svgEl('path', { d: `M${x} ${y - 5}L${x + 5} ${y}L${x} ${y + 5}L${x - 5} ${y}Z`, fill: '#e6edf3', stroke: '#14181d', 'stroke-width': 1 }, g);
  }
  for (const s of S.overlook.filter((x) => x.distM <= S.radiusM)) {
    const [x, y] = pt(s.bearingDeg, s.distM);
    svgEl('path', { d: `M${x} ${y - 6}L${x + 5.5} ${y + 4}L${x - 5.5} ${y + 4}Z`, fill: '#ba68c8', stroke: '#14181d', 'stroke-width': 1 }, g);
  }
  svgEl('text', { x: C, y: 9, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#c9d1d9', 'font-size': 12, 'font-weight': 750, 'font-family': 'system-ui,Segoe UI,Arial,sans-serif', 'data-gv-upright': `${C} 9` }, g, 'N');
  svgEl('circle', { cx: C, cy: C, r: 4.5, fill: '#42a5f5', stroke: '#fff', 'stroke-width': 1.5 }, svg);
  return svg;
}

/** A stacked bar with its words: [colour, share %, word]. */
function stack(parts: Array<[string, number, string]>): HTMLElement {
  const w = el('div');
  const bar = el('div', 'ms-pld-bar');
  for (const [c, p] of parts) {
    const i = el('i');
    i.style.background = c;
    i.style.width = `${Math.max(0, p)}%`;
    bar.append(i);
  }
  const words = el('div', 'ms-pld-why');
  words.textContent = parts.map(([, p, wd]) => `${wd} ${p}%`).join(' · ');
  w.append(bar, words);
  return w;
}

// ── the big pictures (the hero of a tab) ────────────────────────────────────

const FONT = 'system-ui,Segoe UI,Arial,sans-serif';
const HERO = 240;
const HC = HERO / 2;
const HR = HC - 16;

/** Nice distances for rings, up to `reach`. */
function ringsUpTo(reachM: number, max = 3): number[] {
  const nice = [100, 200, 300, 500, 1000, 1500, 2000, 3000, 5000, 10000, 20000, 30000, 60000];
  const inside = nice.filter((m) => m < reachM * 0.85);
  if (inside.length <= max) return inside;
  // Spread: keep the rings about evenly placed on the scale used.
  const out: number[] = [];
  for (let i = 1; i <= max; i++) {
    const want = (reachM * i) / (max + 1);
    const best = inside.reduce((m, x) => (Math.abs(x - want) < Math.abs(m - want) ? x : m), inside[0]);
    if (!out.includes(best)) out.push(best);
  }
  return out.sort((a, b) => a - b);
}

/** The frame of a hero dial: a dark disc, a group that turns with the map (`data-gv-rose`), compass letters that stay upright. */
function heroFrame(label: string): { svg: SVGSVGElement; g: SVGElement; at: (rPx: number, bearingDeg: number) => [number, number] } {
  const svg = svgEl('svg', { width: HERO, height: HERO, viewBox: `0 0 ${HERO} ${HERO}`, role: 'img', 'aria-label': label }) as SVGSVGElement;
  svgEl('circle', { cx: HC, cy: HC, r: HR + 10, fill: '#14181d', stroke: '#5d6772', 'stroke-width': 1.2 }, svg);
  const g = svgEl('g', { 'data-gv-rose': `${HC} ${HC}` }, svg);
  const at = (rPx: number, b: number): [number, number] => [HC + Math.sin((b * Math.PI) / 180) * rPx, HC - Math.cos((b * Math.PI) / 180) * rPx];
  for (let b = 0; b < 360; b += 45) {
    const [x0, y0] = at(HR + 2, b);
    const [x1, y1] = at(HR + (b % 90 ? 6 : 9), b);
    svgEl('line', { x1: x0.toFixed(1), y1: y0.toFixed(1), x2: x1.toFixed(1), y2: y1.toFixed(1), stroke: '#8a96a3', 'stroke-width': b % 90 ? 1 : 1.6 }, g);
  }
  const [nx, ny] = at(HR - 7, 0);
  svgEl('text', { x: nx, y: ny, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#e6edf3', 'font-size': 12, 'font-weight': 800, 'font-family': FONT, 'data-gv-upright': `${nx} ${ny}` }, g, 'N');
  return { svg, g, at };
}

interface HeroItem {
  kind: keyof typeof GLYPH_COLOR | null;
  color: string;
  distM: number;
  bearingDeg: number;
  text?: string;
  strong?: boolean;
}

/** A hero rose: places round the point to scale (linear, or square-root to give near ground more room), rings with their
 *  distances, the bubble, and short labels on the ones that matter. */
function heroRose(o: { label: string; reachM: number; sqrt?: boolean; bubbleM?: number; items: HeroItem[] }): SVGSVGElement {
  const { svg, g, at } = heroFrame(o.label);
  const rad = (m: number) => HR * (o.sqrt ? Math.sqrt(Math.min(1, m / o.reachM)) : Math.min(1, m / o.reachM));
  // Boxes already taken by words (ring labels, the N, glyphs): a label that would sit on one moves to the other side or is
  // left out (the list beside the dial names every place).
  const taken: Array<[number, number, number, number]> = [[HC - 7, 5, HC + 7, 22]];
  const free = (bx: [number, number, number, number]) => bx[0] >= 2 && bx[2] <= HERO - 2 && taken.every((t) => bx[2] <= t[0] || bx[0] >= t[2] || bx[3] <= t[1] || bx[1] >= t[3]);
  const textW = (s: string) => s.length * 5.9 + 2;
  for (const m of ringsUpTo(o.reachM)) {
    const rr = rad(m);
    svgEl('circle', { cx: HC, cy: HC, r: rr.toFixed(1), fill: 'none', stroke: 'rgba(255,255,255,.28)', 'stroke-dasharray': '2 3' }, g);
    // Distances inside the foot of each ring (the N keeps the top).
    const lx = HC, ly = HC + rr - 4;
    svgEl('text', { x: lx, y: ly.toFixed(1), 'text-anchor': 'middle', fill: '#c3cbd3', 'font-size': 10.5, 'font-family': FONT, 'paint-order': 'stroke', stroke: '#14181d', 'stroke-width': 3, 'data-gv-upright': `${lx} ${(ly - 4).toFixed(1)}` }, g, dist(m));
    taken.push([lx - textW(dist(m)) / 2, ly - 9, lx + textW(dist(m)) / 2, ly + 3]);
  }
  svgEl('circle', { cx: HC, cy: HC, r: HR, fill: 'none', stroke: 'rgba(255,255,255,.4)' }, g);
  const rimX = HC, rimY = HC + HR - 4;
  svgEl('text', { x: rimX, y: rimY, 'text-anchor': 'middle', fill: '#e6edf3', 'font-size': 10.5, 'font-weight': 700, 'font-family': FONT, 'paint-order': 'stroke', stroke: '#14181d', 'stroke-width': 3, 'data-gv-upright': `${rimX} ${rimY - 4}` }, g, dist(o.reachM));
  taken.push([rimX - textW(dist(o.reachM)) / 2, rimY - 9, rimX + textW(dist(o.reachM)) / 2, rimY + 3]);
  if (o.bubbleM && o.bubbleM < o.reachM) svgEl('circle', { cx: HC, cy: HC, r: rad(o.bubbleM).toFixed(1), fill: 'rgba(66,165,245,.07)', stroke: '#42a5f5', 'stroke-opacity': 0.7, 'stroke-dasharray': '5 4' }, g);
  const placed = [...o.items].sort((a, b) => b.distM - a.distM).map((it) => {
    const [x, y] = at(rad(it.distM), it.bearingDeg);
    if (it.strong) svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 9.5, fill: 'none', stroke: it.color, 'stroke-width': 2 }, g);
    if (it.kind) glyph(g, it.kind, x, y, 5.2);
    else svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 4.6, fill: it.color, stroke: '#14181d', 'stroke-width': 1.2 }, g);
    taken.push([x - 6, y - 6, x + 6, y + 6]);
    return { it, x, y };
  });
  // Labels nearest first: near ground matters most.
  for (const { it, x, y } of placed.reverse()) {
    if (!it.text) continue;
    const w = textW(it.text);
    const right: [number, number, number, number] = [x + 8, y - 5, x + 8 + w, y + 7];
    const left: [number, number, number, number] = [x - 8 - w, y - 5, x - 8, y + 7];
    const box = free(right) ? right : free(left) ? left : null;
    if (!box) continue;
    taken.push(box);
    const tx = box === right ? x + 9 : x - 9;
    svgEl('text', { x: tx.toFixed(1), y: (y + 4).toFixed(1), 'text-anchor': box === right ? 'start' : 'end', fill: '#f1f3f6', 'font-size': 10.5, 'font-weight': 650, 'font-family': FONT, 'paint-order': 'stroke', stroke: '#14181d', 'stroke-width': 3, 'data-gv-upright': `${x.toFixed(1)} ${y.toFixed(1)}` }, g, it.text);
  }
  svgEl('circle', { cx: HC, cy: HC, r: 4.5, fill: '#42a5f5', stroke: '#fff', 'stroke-width': 1.5 }, svg);
  return svg;
}

/** Where the people are: the population grid round the point (cells about 1 km), coloured by density class, to 3 km,
 *  with the rings carrying the people inside them, the bubble, the nearest BUA, sensitive sites and crowd points. */
function peopleMap(r: PlReading): SVGSVGElement {
  const P = r.people;
  const reachKm = 3;
  const { svg, g, at } = heroFrame('Where the people are');
  const k = HR / reachKm;
  const clipId = `pld-pm-${Math.round(Math.random() * 1e9)}`;
  const defs = svgEl('defs', {}, svg);
  const cp = svgEl('clipPath', { id: clipId }, defs);
  svgEl('circle', { cx: HC, cy: HC, r: HR }, cp);
  const cells = svgEl('g', { 'clip-path': `url(#${clipId})` }, g);
  const G = P.grid;
  if (G && G.size > 0) {
    const half = Math.floor(G.size / 2);
    const s = G.cellKm * k;
    for (let gr = 0; gr < G.size; gr++) {
      for (let gc = 0; gc < G.size; gc++) {
        const v = G.perKm2[gr * G.size + gc];
        const cx = HC + (gc - half) * s, cy = HC + (gr - half) * s;
        if (Math.hypot(cx - HC, cy - HC) > HR + s) continue;
        if (v < 0) svgEl('rect', { x: (cx - s / 2).toFixed(1), y: (cy - s / 2).toFixed(1), width: s.toFixed(1), height: s.toFixed(1), fill: 'none', stroke: 'rgba(255,255,255,.08)' }, cells);
        else svgEl('rect', { x: (cx - s / 2).toFixed(1), y: (cy - s / 2).toFixed(1), width: (s + 0.4).toFixed(1), height: (s + 0.4).toFixed(1), fill: populationClass(v).color, 'fill-opacity': 0.92, stroke: '#14181d', 'stroke-opacity': 0.35, 'stroke-width': 0.6 }, cells);
      }
    }
  } else {
    svgEl('text', { x: HC, y: HC + 34, 'text-anchor': 'middle', fill: '#c3cbd3', 'font-size': 11.5, 'font-family': FONT }, svg, 'No population grid in the bundle');
  }
  // Rings with the people inside them.
  for (const km of [1, 2, 3]) {
    const rr = km * k;
    svgEl('circle', { cx: HC, cy: HC, r: rr.toFixed(1), fill: 'none', stroke: '#fff', 'stroke-opacity': 0.75, 'stroke-width': 1.1, 'stroke-dasharray': km === 3 ? '' : '4 3' }, g);
    const n = P.rings.find((x) => x.km === km)?.people;
    // Inside the foot of each ring, so the outer one stays on the dial.
    const lx = HC, ly = HC + rr - 5;
    svgEl('text', { x: lx, y: ly.toFixed(1), 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 750, 'font-family': FONT, 'paint-order': 'stroke', stroke: '#14181d', 'stroke-width': 3.2, 'data-gv-upright': `${lx} ${(ly - 4).toFixed(1)}` }, g, n !== undefined ? `${km} km · ${num(n)}` : `${km} km`);
  }
  if (r.radiusM < reachKm * 1000) svgEl('circle', { cx: HC, cy: HC, r: ((r.radiusM / 1000) * k).toFixed(1), fill: 'none', stroke: '#42a5f5', 'stroke-width': 1.6, 'stroke-dasharray': '5 4' }, g);
  const place = (s: PlSpot, kind: keyof typeof GLYPH_COLOR | null, color: string, text?: string) => {
    if (s.distM > reachKm * 1000) return;
    const [x, y] = at((s.distM / 1000) * k, s.bearingDeg);
    if (kind) glyph(g, kind, x, y, 5.4);
    else svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 4.2, fill: color, stroke: '#14181d', 'stroke-width': 1.3 }, g);
    if (text) svgEl('text', { x: (x + 9).toFixed(1), y: (y + 4).toFixed(1), fill: '#fff', 'font-size': 10.5, 'font-weight': 650, 'font-family': FONT, 'paint-order': 'stroke', stroke: '#14181d', 'stroke-width': 3, 'data-gv-upright': `${x.toFixed(1)} ${y.toFixed(1)}` }, g, text);
  };
  for (const s of P.crowd) place(s, null, '#ffa726');
  for (const s of P.sensitive.nearest) place(s, null, '#ab47bc');
  if (P.bua) place(P.bua, 'bua', '', P.bua.name ?? P.bua.label);
  svgEl('circle', { cx: HC, cy: HC, r: 4.5, fill: '#42a5f5', stroke: '#fff', 'stroke-width': 1.5 }, svg);
  return svg;
}

/** People by direction within 2 km: eight wedges, area to the share, the busiest named; north up, turns with the map. */
function sectorRose(sectors: number[]): HTMLElement {
  const W = 132, C = W / 2, R = C - 14;
  const svg = svgEl('svg', { width: W, height: W, viewBox: `0 0 ${W} ${W}`, role: 'img', 'aria-label': 'People by direction' }) as SVGSVGElement;
  svgEl('circle', { cx: C, cy: C, r: R + 4, fill: '#14181d', stroke: '#5d6772' }, svg);
  const g = svgEl('g', { 'data-gv-rose': `${C} ${C}` }, svg);
  const max = Math.max(1, ...sectors);
  const at = (rr: number, b: number) => `${(C + Math.sin((b * Math.PI) / 180) * rr).toFixed(1)} ${(C - Math.cos((b * Math.PI) / 180) * rr).toFixed(1)}`;
  svgEl('circle', { cx: C, cy: C, r: R / 2, fill: 'none', stroke: 'rgba(255,255,255,.18)', 'stroke-dasharray': '2 3' }, g);
  sectors.forEach((n, i) => {
    const rr = Math.max(2, R * Math.sqrt(n / max));
    const b = i * 45;
    svgEl('path', { d: `M${C} ${C}L${at(rr, b - 20)}A${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1 ${at(rr, b + 20)}Z`, fill: populationClass(n / (Math.PI * 4 / 8)).color, stroke: '#14181d', 'stroke-width': 1 }, g);
  });
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let i = 0; i < 8; i += 2) {
    const [x, y] = at(R + 9, i * 45).split(' ');
    svgEl('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#c3cbd3', 'font-size': 10.5, 'font-weight': 700, 'font-family': FONT, 'data-gv-upright': `${x} ${y}` }, g, DIRS[i]);
  }
  const w = el('div', 'ms-pld-pic ms-row');
  const p = el('div');
  p.append(svg);
  const order = sectors.map((n, i) => ({ n, d: DIRS[i] })).sort((a, b) => b.n - a.n);
  const side = el('div');
  side.append(pairs([['Busiest', frag(b(order[0].d), ` · ${num(order[0].n)}`)], ['Next', `${order[1].d} ${num(order[1].n)} · ${order[2].d} ${num(order[2].n)}`], ['Quietest', frag(b(order[7].d), ` · ${num(order[7].n)}`)]]));
  w.append(p, side);
  return w;
}

/** How many, how far: people within 500 m, 1, 2 and 3 km as bars to scale, each coloured by its density class. */
function ringBars(P: PlReading['people']): HTMLElement {
  const rows: Array<[string, number, number]> = [];
  if (P.within500 !== null) rows.push(['500 m', P.within500, 0.25]);
  for (const x of P.rings) rows.push([`${x.km} km`, x.people, x.km * x.km]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const d = el('div');
  for (const [lab, n, r2] of rows) {
    const row = el('div', 'ms-pld-rb');
    const bar = el('i');
    bar.style.width = `${Math.max(1, (100 * n) / max)}%`;
    bar.style.background = populationClass(n / (Math.PI * r2)).color;
    row.append(el('span', undefined, lab), bar, b(num(n)));
    d.append(row);
  }
  return d;
}

/** Busier or quieter further out: people per km² by distance band to 10 km, as columns on a log scale, class colours. */
function bandColumns(bands: Array<{ fromKm: number; toKm: number; perKm2: number }>): SVGSVGElement {
  const W = 250, H = 108, top = 16, base = 84;
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'People per km² by distance' }) as SVGSVGElement;
  const lmax = Math.log10(Math.max(10, ...bands.map((x) => x.perKm2)) + 1);
  const cw = W / bands.length;
  svgEl('line', { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, stroke: 'rgba(255,255,255,.25)' }, svg);
  bands.forEach((x, i) => {
    const h = ((base - top) * Math.log10(x.perKm2 + 1)) / lmax;
    const cx = i * cw + 4;
    svgEl('rect', { x: cx.toFixed(1), y: (base - h).toFixed(1), width: (cw - 8).toFixed(1), height: Math.max(1, h).toFixed(1), rx: 2, fill: populationClass(x.perKm2).color, stroke: '#14181d', 'stroke-width': 0.8 }, svg);
    svgEl('text', { x: (cx + (cw - 8) / 2).toFixed(1), y: (base - h - 4).toFixed(1), 'text-anchor': 'middle', fill: '#f1f3f6', 'font-size': 10.5, 'font-weight': 700, 'font-family': FONT }, svg, num(Math.round(x.perKm2)));
    svgEl('text', { x: (cx + (cw - 8) / 2).toFixed(1), y: base + 15, 'text-anchor': 'middle', fill: '#c3cbd3', 'font-size': 10.5, 'font-family': FONT }, svg, `${x.fromKm}-${x.toKm}`);
  });
  return svg;
}

/** A 10 x 10 waffle: one square per 1% of the people within 2 km. */
function waffle(parts: Array<[string, number, string]>): HTMLElement {
  const w = el('div', 'ms-pld-waf');
  let left = 100;
  const cells: string[] = [];
  for (const [c, p] of parts) {
    const n = Math.min(left, Math.max(0, Math.round(p)));
    for (let i = 0; i < n; i++) cells.push(c);
    left -= n;
  }
  while (cells.length < 100) cells.push('#3a434e');
  for (const c of cells) {
    const i = el('i');
    i.style.background = c;
    w.append(i);
  }
  return w;
}

/** The density classes as a key line. */
function classKey(): HTMLElement {
  const d = el('div', 'ms-pld-gl');
  for (const c of POPULATION_CLASSES) {
    const s = el('span');
    s.append(sw(c.color), `${c.label}${c.min ? ` ${num(c.min)}+` : ''}`);
    d.append(s);
  }
  return d;
}

// ── Stop pictures ───────────────────────────────────────────────────────────

/** Why a site was ruled out, by the first test it failed (PlStop.tests keys); passed sites are green. */
const STOP_COL: Record<string, string> = {
  nogo: '#8a3036',
  road: '#7b8794',
  bua: '#d2b27a',
  conceal: '#c9a53a',
  flood: '#3d8fd6',
  crest: '#a874e8',
  nearBua: '#8d6e63',
  nearRd: '#4f5c6a',
  ways: '#e07b1a',
  water: '#4dc3d1',
};
const stopCol = (key: string): string => STOP_COL[key] ?? '#5b6470';

/** Where to stop: the bubble read on its grid, each site coloured by the first test that ruled it out (green: passed
 *  every test), the patrol base and the next best sites, the OP and what it sees; north up, turns with the map. */
function stopMap(r: PlReading): SVGSVGElement {
  const ST = r.stop!;
  const { svg, g, at } = heroFrame('Where to stop: why the ground was ruled out');
  const k = HR / Math.max(1, r.radiusM);
  const clipId = `pld-st-${Math.round(Math.random() * 1e9)}`;
  const defs = svgEl('defs', {}, svg);
  const cp = svgEl('clipPath', { id: clipId }, defs);
  svgEl('circle', { cx: HC, cy: HC, r: HR }, cp);
  const cells = svgEl('g', { 'clip-path': `url(#${clipId})` }, g);
  const s = ST.grid.stepM * k;
  for (const [dx, dy, code] of ST.grid.cells) {
    const cx = HC + dx * k, cy = HC - dy * k;
    const fill = code < 0 ? STEP_COLOR.go : stopCol(ST.tests[code]?.key ?? '');
    svgEl('rect', { x: (cx - s / 2).toFixed(1), y: (cy - s / 2).toFixed(1), width: (s + 0.3).toFixed(1), height: (s + 0.3).toFixed(1), fill, 'fill-opacity': code < 0 ? 0.95 : 0.78, stroke: '#14181d', 'stroke-opacity': 0.45, 'stroke-width': 0.5 }, cells);
  }
  // The OP's view: how far it sees each way, out to 1 km, as an outline over the grid.
  if (ST.op && ST.opView) {
    const [ox, oy] = at(ST.op.distM * k, ST.op.bearingDeg);
    const pts = ST.opView.map((v, i) => {
      const rr = Math.max(0.04, v) * 1000 * k;
      const a = (i * 15 * Math.PI) / 180;
      return `${(ox + Math.sin(a) * rr).toFixed(1)} ${(oy - Math.cos(a) * rr).toFixed(1)}`;
    });
    const view = svgEl('g', { 'clip-path': `url(#${clipId})` }, g);
    svgEl('path', { d: `M${pts.join('L')}Z`, fill: GLYPH_COLOR.op, 'fill-opacity': 0.16, stroke: GLYPH_COLOR.op, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, view);
  }
  // Half the bubble, dashed, with its distance at its foot; the bubble's edge is the dial's rim.
  const halfM = r.radiusM / 2;
  svgEl('circle', { cx: HC, cy: HC, r: (halfM * k).toFixed(1), fill: 'none', stroke: '#fff', 'stroke-opacity': 0.55, 'stroke-dasharray': '3 3' }, g);
  svgEl('circle', { cx: HC, cy: HC, r: HR, fill: 'none', stroke: '#90caf9', 'stroke-width': 1.6, 'stroke-dasharray': '1.5 3', 'stroke-linecap': 'round' }, g);
  const lab = (x: number, y: number, t: string, anchor = 'middle', weight = 700) =>
    svgEl('text', { x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': anchor, fill: '#fff', 'font-size': 10.5, 'font-weight': weight, 'font-family': FONT, 'paint-order': 'stroke', stroke: '#14181d', 'stroke-width': 3.2, 'data-gv-upright': `${x.toFixed(1)} ${(y - 4).toFixed(1)}` }, g, t);
  lab(HC, HC + halfM * k - 4, dist(halfM));
  lab(HC, HC + HR - 4, `search ${dist(r.radiusM)}`);
  // A label beside a mark, on the side that keeps it on the dial.
  const beside = (x: number, y: number, gap: number, t: string) => {
    const w = t.length * 6.2 + 2;
    if (x + gap + w <= HERO - 4) lab(x + gap, y + 4, t, 'start');
    else lab(x - gap, y + 4, t, 'end');
  };
  // The next best sites (numbered), then the OP, then the patrol base on top.
  ST.sites.slice(1).forEach((x, i) => {
    const [px, py] = at(x.distM * k, x.bearingDeg);
    glyph(g, 'harbour', px, py, 4.2);
    beside(px, py, 8, String(i + 2));
  });
  if (ST.op) {
    const [px, py] = at(ST.op.distM * k, ST.op.bearingDeg);
    svgEl('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: 8.5, fill: '#14181d', stroke: GLYPH_COLOR.op, 'stroke-width': 1.4 }, g);
    glyph(g, 'op', px, py, 4.6);
    beside(px, py, 11, 'OP');
  }
  const hb = ST.harbour;
  if (hb) {
    const [px, py] = at(hb.distM * k, hb.bearingDeg);
    svgEl('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: 10, fill: '#14181d', stroke: '#fff', 'stroke-width': 1.8 }, g);
    glyph(g, 'harbour', px, py, 5.6);
    beside(px, py, 13, 'PB');
  }
  svgEl('circle', { cx: HC, cy: HC, r: 4.5, fill: '#42a5f5', stroke: '#fff', 'stroke-width': 1.5 }, svg);
  return svg;
}

/** Four pips for a level (none, poor, fair, good) in the level colours, with its word. */
function pips(level: number): HTMLElement {
  const w = el('span', 'ms-pld-pips');
  for (let i = 1; i <= 3; i++) {
    const p = el('i');
    if (i <= level) p.style.background = LEVEL_COLOR[level] ?? '#9aa3ad';
    w.append(p);
  }
  const t = el('b', undefined, LVL[level] ?? '?');
  t.style.color = LEVEL_TEXT[level] ?? '';
  const d = el('span');
  d.append(w, t);
  return d;
}

/** Eight wedges: the ways out on foot from a site (green open, red blocked); north up, turns with the map. */
function waysRose(dirs: boolean[], px = 44): SVGSVGElement {
  const C = px / 2, R = C - 3;
  const svg = svgEl('svg', { width: px, height: px, viewBox: `0 0 ${px} ${px}`, role: 'img', 'aria-label': `Ways out: ${dirs.filter(Boolean).length} of 8` }) as SVGSVGElement;
  svgEl('circle', { cx: C, cy: C, r: R + 2, fill: '#14181d', stroke: '#5d6772' }, svg);
  const g = svgEl('g', { 'data-gv-rose': `${C} ${C}` }, svg);
  const P = (rr: number, b: number) => `${(C + Math.sin((b * Math.PI) / 180) * rr).toFixed(1)} ${(C - Math.cos((b * Math.PI) / 180) * rr).toFixed(1)}`;
  dirs.forEach((ok, i) => {
    const b0 = i * 45 - 19, b1 = i * 45 + 19;
    svgEl('path', { d: `M${P(R * 0.32, b0)}L${P(R, b0)}A${R} ${R} 0 0 1 ${P(R, b1)}L${P(R * 0.32, b1)}A${R * 0.32} ${R * 0.32} 0 0 0 ${P(R * 0.32, b0)}Z`, fill: ok ? STEP_COLOR.go : STEP_COLOR.nogo, 'fill-opacity': ok ? 1 : 0.55 }, g);
  });
  const [nx, ny] = P(R - 4, 0).split(' ');
  svgEl('text', { x: nx, y: ny, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', 'font-size': 8, 'font-weight': 800, 'font-family': FONT, 'paint-order': 'stroke', stroke: '#14181d', 'stroke-width': 2.4, 'data-gv-upright': `${nx} ${ny}` }, g, 'N');
  return svg;
}

/** A distance against its limit: the bar to scale, the limit marked (a site must be within it, or beyond it). */
function limitBar(m: number, limitM: number, within: boolean): HTMLElement {
  const w = el('span', 'ms-pld-lim');
  const span = limitM * (within ? 1.25 : 2);
  const f = el('i');
  f.style.width = `${Math.min(100, (100 * m) / span)}%`;
  f.style.background = within ? '#4fb3ff' : STEP_COLOR.go;
  const tick = el('u');
  tick.style.left = `${(100 * limitM) / span}%`;
  w.append(f, tick);
  return w;
}

/** What the OP sees: 24 wedges, each as long as the share of the ground it sees that way out to 1 km. */
function opRose(view: number[], px = 128): SVGSVGElement {
  const C = px / 2, R = C - 14;
  const svg = svgEl('svg', { width: px, height: px, viewBox: `0 0 ${px} ${px}`, role: 'img', 'aria-label': 'What the OP sees, by direction' }) as SVGSVGElement;
  svgEl('circle', { cx: C, cy: C, r: R + 4, fill: '#14181d', stroke: '#5d6772' }, svg);
  const g = svgEl('g', { 'data-gv-rose': `${C} ${C}` }, svg);
  const P = (rr: number, b: number) => `${(C + Math.sin((b * Math.PI) / 180) * rr).toFixed(1)} ${(C - Math.cos((b * Math.PI) / 180) * rr).toFixed(1)}`;
  svgEl('circle', { cx: C, cy: C, r: R / 2, fill: 'none', stroke: 'rgba(255,255,255,.22)', 'stroke-dasharray': '2 3' }, g);
  svgEl('circle', { cx: C, cy: C, r: R, fill: 'none', stroke: 'rgba(255,255,255,.22)' }, g);
  view.forEach((v, i) => {
    const rr = Math.max(1.5, R * v);
    const b0 = i * 15 - 6.5, b1 = i * 15 + 6.5;
    svgEl('path', { d: `M${C} ${C}L${P(rr, b0)}A${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1 ${P(rr, b1)}Z`, fill: GLYPH_COLOR.op, 'fill-opacity': 0.35 + 0.6 * v }, g);
  });
  const DIRS = ['N', 'E', 'S', 'W'];
  DIRS.forEach((d, i) => {
    const [x, y] = P(R + 9, i * 90).split(' ');
    svgEl('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#c3cbd3', 'font-size': 10.5, 'font-weight': 700, 'font-family': FONT, 'data-gv-upright': `${x} ${y}` }, g, d);
  });
  glyph(g, 'op', C, C, 4.6);
  return svg;
}

/** The funnel: the sites read, then each test with the sites it ruled out (in its colour) and those left, to the ones
 *  that passed every test. */
function funnel(ST: NonNullable<PlReading['stop']>): HTMLElement {
  const d = el('div');
  const N = Math.max(1, ST.checked);
  const row = (label: Node | string, count: string, left: number, out: number, col: string | null) => {
    const r = el('div', 'ms-pld-fr');
    const l = el('span');
    l.append(label);
    const bar = el('div', 'ms-pld-fb');
    const a = el('i');
    a.style.width = `${(100 * left) / N}%`;
    a.style.background = col === null ? '#9aa3ad' : 'rgba(255,255,255,.22)';
    bar.append(a);
    if (out > 0 && col) {
      const o = el('i');
      o.style.width = `${Math.max(0.6, (100 * out) / N)}%`;
      o.style.background = col;
      bar.append(o);
    }
    r.append(l, b(count), bar);
    d.append(r);
  };
  row('Sites read', num(ST.checked), ST.checked, 0, null);
  let left = ST.checked;
  for (const t of ST.tests) {
    if (!t.out) continue;
    left -= t.out;
    const lab = frag(sw(stopCol(t.key)), t.label);
    row(lab, `−${num(t.out)}`, left, t.out, stopCol(t.key));
  }
  const last = el('div', 'ms-pld-fr ms-pass');
  const l = el('span');
  l.append(sw(STEP_COLOR.go), 'Passed every test');
  const bar = el('div', 'ms-pld-fb');
  const a = el('i');
  a.style.width = `${Math.max(ST.passed ? 0.8 : 0, (100 * ST.passed) / N)}%`;
  a.style.background = STEP_COLOR.go;
  bar.append(a);
  last.append(l, b(num(ST.passed)), bar);
  d.append(last);
  return d;
}

// ── the card ─────────────────────────────────────────────────────────────────

export interface PlatoonGuideDetailHandlers {
  /** × or Esc on the open Detail: fold it back to the answer bar. */
  close(): void;
  /** A tab clicked, on the answer bar or the open Detail. */
  openTab?(tab: PlTab): void;
  /** The pointer came onto the bar or the Detail (the guide pins the reading so the mouse can read it). */
  enter?(): void;
  /** × on the answer bar: hide it until a reading is asked for again. */
  hideBar?(): void;
  goTo(x: number, y: number): void;
}

export class PlatoonGuideDetail {
  private _el: HTMLDivElement | null = null;
  private _tab: PlTab = 'here';
  private _page = 0;
  private _pages = 1;
  private _brief: PlatoonBrief | null = null;
  private _north = 0;
  private _status: string | null = null;
  private _ro: ResizeObserver | null = null;
  /** closed: nothing on screen; bar: the tab row only, docked at the foot; open: the whole Detail. */
  private _view: 'closed' | 'bar' | 'open' = 'closed';
  private _pinned = false;
  private _wheelAt = 0;

  constructor(private readonly _h: PlatoonGuideDetailHandlers) {}

  /** The whole Detail is open. */
  get isOpen(): boolean {
    return this._view === 'open';
  }
  /** Folded to the answer bar. */
  get isBar(): boolean {
    return this._view === 'bar';
  }
  get tab(): PlTab {
    return this._tab;
  }

  /** The tabs this brief has, in order. */
  tabsOf(br: PlatoonBrief | null = this._brief): PlTab[] {
    const r = br?.reading;
    const t: PlTab[] = [];
    if (r) {
      // A quick reading (the cursor moving) has no sight, dangers or stop yet: their tabs stay, with ..., so the bar does
      // not jump as the cursor moves and rests.
      t.push('here');
      if (r.see || !r.full) t.push('see');
      if (r.danger || !r.full) t.push('danger');
      t.push('people', 'help');
      if (r.stop || !r.full) t.push('stop');
    }
    if (br?.patrol) t.push('patrol');
    return t;
  }

  open(tab?: PlTab): void {
    const e = this._ensure();
    if (tab) {
      if (tab !== this._tab) this._page = 0;
      this._tab = tab;
    }
    this._view = 'open';
    this._apply(e);
    this._render();
  }

  /** Nothing on screen (the bar too). */
  close(): void {
    this._view = 'closed';
    if (this._el) this._apply(this._el);
  }

  /** Fold to the answer bar (or close when there is nothing read yet). */
  fold(): void {
    if (!this._brief) return this.close();
    const e = this._ensure();
    this._view = 'bar';
    this._apply(e);
    this._render();
  }

  /** Show the answer bar when nothing else is up, or take it away (the open Detail stays). */
  showBar(on: boolean): void {
    if (on && this._view === 'closed' && this._brief) this.fold();
    else if (!on && this._view === 'bar') this.close();
  }

  /** The reading is pinned (A, or the pointer on the bar): the header says so and how to let it go. */
  setPinned(on: boolean): void {
    if (on === this._pinned) return;
    this._pinned = on;
    if (this._view !== 'closed') this._render();
  }

  /** A: the next tab (wrapping), Shift+A the one before; a closed or folded Detail opens. Pages turn with ‹ › or the wheel. */
  step(dir: 1 | -1): void {
    if (!this.isOpen) return this.open();
    const tabs = this.tabsOf();
    if (!tabs.length) return;
    const ti = Math.max(0, tabs.indexOf(this._tab));
    this._tab = tabs[(ti + dir + tabs.length) % tabs.length];
    this._page = 0;
    this._render();
  }

  /** The next (1) or previous (-1) page of the open tab. */
  page(dir: 1 | -1): void {
    if (!this.isOpen) return;
    const next = Math.max(0, Math.min(this._pages - 1, this._page + dir));
    if (next === this._page) return;
    this._page = next;
    this._layout();
  }

  private _apply(e: HTMLElement): void {
    e.classList.toggle('ms-open', this._view === 'open');
    e.classList.toggle('ms-bar', this._view === 'bar');
  }

  update(br: PlatoonBrief, northDeg: number): void {
    const tabsBefore = this.tabsOf().join();
    const newSubject = !this._brief || this._brief.what !== br.what || (this._brief.patrol ? 1 : 0) !== (br.patrol ? 1 : 0);
    this._brief = br;
    this._north = northDeg;
    if (br.patrol && !br.reading) this._tab = 'patrol';
    if (!this.tabsOf().includes(this._tab)) this._tab = this.tabsOf()[0] ?? 'here';
    if (newSubject || tabsBefore !== this.tabsOf().join()) this._page = Math.min(this._page, 0);
    if (this._view !== 'closed') this._render();
  }

  setNorth(northDeg: number): void {
    this._north = northDeg;
    if (this._el && this.isOpen) orientNorth(this._el, northDeg);
  }

  destroy(): void {
    this._ro?.disconnect();
    this._ro = null;
    this._el?.remove();
    this._el = null;
    document.getElementById(STYLE_ID)?.remove();
  }

  private _ensure(): HTMLDivElement {
    ensureTokensCss();
    ensureNorthCss();
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    if (!this._el) {
      const e = document.createElement('div');
      e.className = 'ms-pld';
      e.setAttribute('role', 'region');
      e.setAttribute('aria-label', 'Pl Detail');
      for (const t of ['pointerdown', 'pointermove', 'wheel', 'dblclick', 'contextmenu']) e.addEventListener(t, (ev) => ev.stopPropagation());
      e.addEventListener('pointerenter', () => this._h.enter?.());
      // The wheel over the open Detail turns its pages (it never scrolls).
      e.addEventListener('wheel', (ev) => {
        if (!this.isOpen || this._pages < 2) return;
        ev.preventDefault();
        const now = Date.now();
        if (now - this._wheelAt < 280 || Math.abs(ev.deltaY) < 4) return;
        this._wheelAt = now;
        this.page(ev.deltaY > 0 ? 1 : -1);
      }, { passive: false });
      document.body.appendChild(e);
      this._el = e;
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => {
          if (this.isOpen) this._layout();
        });
        this._ro.observe(e);
      }
    }
    return this._el;
  }

  private _render(): void {
    const e = this._el;
    if (!e) return;
    const br = this._brief;
    const bar = this._view === 'bar';
    e.replaceChildren();
    const h = el('div', 'ms-pld-h');
    const nm = el('div', 'ms-pld-nm');
    nm.append(el('b', undefined, bar ? 'Pl Guide' : 'Pl Detail'), el('span', undefined, br?.what ?? ''));
    h.append(nm);
    const tabs = el('div', 'ms-pld-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const t of this.tabsOf()) {
      const bt = el('button', 'ms-pld-tab') as HTMLButtonElement;
      bt.type = 'button';
      bt.setAttribute('role', 'tab');
      bt.setAttribute('aria-selected', String(!bar && t === this._tab));
      bt.title = bar ? `Open ${TAB_LABEL[t]} with its pictures` : TAB_LABEL[t];
      const ans = this._tabAnswer(br!, t);
      const a = el('span', 'ms-pld-ta');
      if (ans.color) a.append(dot(ans.color));
      a.append(el('span', undefined, ans.text));
      bt.append(el('span', undefined, TAB_LABEL[t]), a);
      // On pointerdown too: the bar is redrawn as readings arrive, and a click whose button was replaced is lost.
      const act = () => (this._h.openTab ? this._h.openTab(t) : this.open(t));
      bt.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        act();
      });
      bt.addEventListener('click', (ev) => {
        if ((ev as MouseEvent).detail === 0) act(); // keyboard (Enter / Space)
      });
      tabs.append(bt);
    }
    h.append(tabs, el('span', 'ms-pld-hsp'));
    if (this._pinned) {
      const pin = el('span', 'ms-pld-pin');
      pin.append(pinIcon(), 'Pinned · Esc lets go');
      pin.title = 'The reading stays at the pin while the mouse is on the card. Esc, or placing the symbol, lets it go.';
      h.append(pin);
    }
    if (bar) {
      const hint = el('span', 'ms-pld-hint');
      hint.append(el('span', 'ms-pld-kbd', 'A'), 'pin and open');
      h.append(hint);
    } else {
      const copy = el('button', 'ms-pld-btn', this._status ?? 'Copy as Text') as HTMLButtonElement;
      copy.type = 'button';
      copy.addEventListener('click', () => {
        if (!this._brief) return;
        void navigator.clipboard?.writeText(briefLines(this._brief).join('\n')).then(
          () => this._flash('Copied'),
          () => this._flash('Copy failed'),
        );
      });
      h.append(copy);
    }
    const x = el('button', 'ms-pld-btn ms-x', bar ? '×' : '▾') as HTMLButtonElement;
    x.type = 'button';
    x.setAttribute('aria-label', bar ? 'Hide the Pl Guide bar' : 'Fold the Pl Detail to its bar');
    x.title = bar ? 'Hide the bar until the next reading is asked for (A, a placed or selected symbol)' : 'Fold to the bar (Esc)';
    x.addEventListener('click', () => (bar ? (this._h.hideBar ? this._h.hideBar() : this.close()) : this._h.close()));
    h.append(x);
    e.append(h);
    if (bar) return;
    if (!br || !this.tabsOf().length) {
      e.append(el('div', 'ms-pld-empty', 'Hover the map with ⌖ on, place or select a Team / Sec / Pl / Coy, or select a line for the patrol route card.'));
      return;
    }
    e.append(this._mode(br));
    const body = el('div', 'ms-pld-body');
    const hero = this._hero(br);
    if (hero) body.append(hero);
    const main = el('div', 'ms-pld-main');
    main.append(this._strip(br));
    const band = el('div', 'ms-pld-band');
    const clip = el('div', 'ms-pld-clip');
    const flow = el('div', 'ms-pld-flow');
    for (const t of this._tiles(br)) flow.append(t);
    clip.append(flow);
    band.append(clip);
    main.append(band);
    body.append(main);
    e.append(body);
    const f = el('div', 'ms-pld-f');
    const k1 = el('span');
    k1.append(el('span', 'ms-pld-kbd', 'A'), 'next tab');
    const k2 = el('span');
    k2.append(el('span', 'ms-pld-kbd', '⇧A'), 'back');
    const k3 = el('span');
    k3.append(el('span', 'ms-pld-kbd', 'Esc'), 'fold to the bar');
    const pgw = el('span', 'ms-pld-pgw');
    const prev = el('button', 'ms-pld-pgb', '‹') as HTMLButtonElement;
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous page');
    prev.addEventListener('click', () => this.page(-1));
    const next = el('button', 'ms-pld-pgb', '›') as HTMLButtonElement;
    next.type = 'button';
    next.setAttribute('aria-label', 'Next page');
    next.addEventListener('click', () => this.page(1));
    pgw.append(el('span', 'ms-pld-pg'), prev, next);
    f.append(k1, k2, k3, pgw);
    e.append(f);
    orientNorth(e, this._north);
    this._layout();
  }

  /** The hero's size to the body's height; columns to the rest of the width; overflow to the right becomes pages. */
  private _layout(): void {
    const e = this._el;
    const clip = e?.querySelector<HTMLElement>('.ms-pld-clip');
    const flow = e?.querySelector<HTMLElement>('.ms-pld-flow');
    if (!e || !clip || !flow) return;
    const body = e.querySelector<HTMLElement>('.ms-pld-body');
    const hero = e.querySelector<HTMLElement>('.ms-pld-hero');
    if (body && hero) {
      const H = body.clientHeight;
      const Wb = body.clientWidth;
      const cap = hero.querySelector<HTMLElement>('.ms-pld-hcap')?.offsetHeight ?? 26;
      const fit = (keyH: number, side: boolean) => Math.floor(Math.max(150, Math.min(H - cap - keyH - 30, Wb * (side ? 0.34 : 0.44), 560)));
      // Key under the picture: the key wraps taller as the picture narrows, so fit again until it settles.
      hero.classList.remove('ms-side');
      let px = fit(56, false);
      for (let i = 0; i < 4; i++) {
        hero.style.setProperty('--pld-hero', `${px}px`);
        const next = fit(hero.querySelector<HTMLElement>('.ms-pld-hkey')?.offsetHeight ?? 0, false);
        if (next >= px) break;
        px = next;
      }
      hero.style.setProperty('--pld-hero', `${px}px`);
      const keyEl = hero.querySelector<HTMLElement>('.ms-pld-hkey');
      const overflows = !!keyEl && keyEl.getBoundingClientRect().bottom > hero.getBoundingClientRect().bottom - 4;
      // Key beside the picture: on wide screens; where it gives a bigger picture and leaves two columns of tiles; and
      // where the key would not fit under the picture, if one column of tiles is left.
      const sidePx = fit(0, true);
      const left = Wb - (sidePx + 172 + 14 + 30);
      if (Wb >= 1380 || (sidePx > px && left >= 2 * COL_MIN + COL_GAP) || (overflows && left >= COL_MIN + 90)) {
        hero.classList.add('ms-side');
        hero.style.setProperty('--pld-hero', `${sidePx}px`);
      }
    }
    const W = clip.clientWidth;
    if (!W) return;
    flow.style.setProperty('--pld-h', `${clip.clientHeight}px`);
    const n = Math.max(1, Math.floor((W + COL_GAP) / (COL_MIN + COL_GAP)));
    flow.style.columnCount = String(n);
    flow.style.transform = '';
    const pageW = W + COL_GAP;
    // Up, not to the nearest: a last column that starts a page is a page of its own.
    this._pages = Math.max(1, Math.ceil((flow.scrollWidth + COL_GAP) / pageW - 0.05));
    if (this._page < 0 || this._page >= this._pages) this._page = this._page < 0 ? this._pages - 1 : 0;
    flow.style.transform = this._page ? `translateX(${-this._page * pageW}px)` : '';
    const pg = e.querySelector('.ms-pld-pg');
    if (pg) pg.textContent = this._pages > 1 ? `Page ${this._page + 1} of ${this._pages}` : '';
    const [prev, next] = Array.from(e.querySelectorAll<HTMLButtonElement>('.ms-pld-pgb'));
    if (prev && next) {
      prev.hidden = next.hidden = this._pages < 2;
      prev.disabled = this._page === 0;
      next.disabled = this._page >= this._pages - 1;
    }
  }

  private _flash(text: string): void {
    this._status = text;
    this._render();
    setTimeout(() => {
      this._status = null;
      if (this.isOpen) this._render();
    }, 1400);
  }

  private _go = (s: PlSpot): void => this._h.goTo(s.x, s.y);

  // ── header pieces ──────────────────────────────────────────────────────────

  private _tabAnswer(br: PlatoonBrief, t: PlTab): { text: string; color?: string } {
    const r = br.reading;
    if (t === 'patrol' && br.patrol) return { text: `${dist(br.patrol.lengthM)} · ${br.patrol.minDay} min` };
    if (!r) return { text: '' };
    switch (t) {
      case 'here': {
        const g = r.here.going.foot;
        return { text: `${GO_WORD[g]} on foot`, color: g === 'unknown' ? TONE.chk.dot : STEP_COLOR[g] };
      }
      case 'see':
        return r.see ? { text: `${r.see.pct.seen}% seen · ${r.see.pct.dead}% dead` } : { text: '…' };
      case 'danger': {
        if (!r.danger) return { text: '…' };
        const s = r.danger.spots;
        const lead = leadDanger(r);
        if (!lead) return { text: 'none found', color: STEP_COLOR.go };
        const word = lead.label.replace('Likely ', '').replace(/^./, (c) => c.toUpperCase());
        return { text: `${word} ${dist(lead.distM)} ${lead.dir}${s.length > 1 ? ` · ${s.length}` : ''}`, color: SCORE_COL(lead.score ?? 0) };
      }
      case 'people': {
        const r1 = r.people.rings.find((x) => x.km === 1);
        return { text: r1 ? `${num(r1.people)} in 1 km` : r.people.within500 !== null ? `~${num(r.people.within500)} in 500 m` : 'not known' };
      }
      case 'help': {
        const f = r.help.friends[0];
        return { text: f ? `${f.label} ${dist(f.distM)}` : 'none in 30 km' };
      }
      case 'stop': {
        if (!r.stop) return { text: '…' };
        const hb = r.stop.harbour;
        return { text: hb ? `PB ${dist(hb.distM)} ${hb.dir}` : 'no PB found', color: hb ? STEP_COLOR.go : TONE.marg.dot };
      }
      default:
        return { text: '' };
    }
  }

  private _mode(br: PlatoonBrief): HTMLElement {
    const m = el('div', 'ms-pld-mode');
    const r = br.reading;
    const parts: Array<Node> = [];
    if (r) {
      parts.push(frag(b(`${ECHELON_WORD[r.echelon] ?? 'Pl'}`), ` · bubble ${dist(r.radiusM)} · ${br.what.split(' · ')[1] ?? ''}`));
      parts.push(frag('eye ', b(`${EYE_WORD[r.eye] ?? r.eye}`)));
    } else parts.push(frag(b('Patrol route'), ' on foot'));
    parts.push(frag(b(br.grid), br.sheet ? ` · sheet ${br.sheet}` : ''));
    if (!br.threat && (r?.see || br.patrol)) parts.push(el('span', 'ms-warn', 'No threat place set'));
    if (br.pending) parts.push(el('span', 'ms-warn', 'Reading…'));
    for (const p of parts) {
      const s = el('span');
      s.append(p);
      m.append(s);
    }
    const when = el('span', 'ms-when');
    const mo = r ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(r.month - 1 + 12) % 12] : '';
    when.textContent = [mo, br.light?.now].filter(Boolean).join(' · ');
    m.append(when);
    return m;
  }

  private _strip(br: PlatoonBrief): HTMLElement {
    const s = el('div', 'ms-pld-sum');
    const ans = (label: string, value: string, sub: string, tone: AnsTone) => {
      const a = el('div', 'ms-pld-ans');
      a.dataset.tone = tone;
      a.append(el('div', 'ms-pld-al', label), el('div', 'ms-pld-av', value), el('div', 'ms-pld-as', sub));
      s.append(a);
    };
    const fact = (k: string, v: Node | string, sub?: string, tone?: AnsTone) => {
      const f = el('div', 'ms-pld-fact');
      const fv = el('div', 'ms-pld-fv');
      fv.append(v);
      if (tone) fv.dataset.tone = tone;
      f.append(el('div', 'ms-pld-fk', k), fv);
      if (sub) f.append(el('div', 'ms-pld-fs', sub));
      s.append(f);
    };
    const r = br.reading;
    const t = this._tab;
    if (t === 'patrol' && br.patrol) {
      const p = br.patrol;
      ans('Patrol route', `${dist(p.lengthM)} · ${p.legs.length} legs`, `Day ${p.minDay} min · night ${p.minNight} min${p.sameWayBack ? ' · same way back: change it' : ''}`, p.sameWayBack ? 'nogo' : 'none');
      fact('Exposed', `${p.exposed.length} stretch${p.exposed.length === 1 ? '' : 'es'}`, undefined, p.exposed.length ? 'slow' : 'go');
      if (p.threatKnown) fact('Hidden from the threat', `${p.dead.length} stretch${p.dead.length === 1 ? '' : 'es'}`);
      fact('Obs crossed', String(p.obstacles.length), p.obstacles[0]?.label, p.obstacles.length ? 'slow' : 'go');
      fact('Villages passed', String(p.villages.length), p.villages[0]?.name ?? undefined, p.villages.length ? 'warn' : undefined);
      return s;
    }
    if (!r) return s;
    const H = r.here;
    if (t === 'here') {
      const g = H.going.foot;
      ans('Going here', `${GO_WORD[g]} on foot`, `Vehicles ${GO_WORD[H.going.veh]} · ${H.clsLabel}${H.going.afterRain ? ` · ${H.going.afterRain}` : ''}`, g === 'unknown' ? 'none' : (g as AnsTone));
      const ways = H.waysOut.dirs.filter((d) => d.foot === 'go').length;
      fact('Ways out on foot', `${ways} of 8`, H.waysOut.dirs.filter((d) => d.foot === 'nogo').map((d) => d.dir).join(' ') ? `blocked ${H.waysOut.dirs.filter((d) => d.foot === 'nogo').map((d) => d.dir).join(' ')}` : undefined, ways <= 2 ? 'slow' : 'go');
      const w = H.water.nearest;
      fact('Water', w ? where(w) : 'none in 5 km', w?.label, w ? undefined : 'nogo');
      fact('HLS Gr', H.hls.ground ? where(H.hls.ground) : 'none in 2 km', H.hls.wires.length ? 'wires near it' : undefined, H.hls.ground ? (H.hls.wires.length ? 'warn' : undefined) : 'nogo');
      fact('Hospital', H.medical.hospital ? where(H.medical.hospital) : 'none in 60 km', H.medical.driveMin !== null ? `~${H.medical.driveMin} min drive (est)` : undefined);
    } else if (t === 'see' && r.see) {
      const S = r.see;
      ans(`In view within ${dist(S.radiusM)}`, `${S.pct.seen}% seen`, `screened ${S.pct.screened}% · dead ${S.pct.dead}% · within 300 m: ${S.near.seen}% seen`, S.pct.dead >= 50 ? 'slow' : 'none');
      fact('Nearest dead Gr', S.deadNear ? where(S.deadNear) : 'none in 300 m', undefined, S.deadNear ? 'slow' : 'go');
      fact('Covered from', S.approachDirs.length ? S.approachDirs.join(' ') : 'none', undefined, S.approachDirs.length ? 'slow' : 'go');
      fact('Looks down on you', String(S.overlook.length + (S.rooftops ? 1 : 0)), S.overlook[0] ? `${dist(S.overlook[0].distM)} ${S.overlook[0].dir}` : undefined, S.overlook.length ? 'warn' : 'go');
      fact('Skyline', S.skyline ? 'On a crest' : 'No', undefined, S.skyline ? 'nogo' : 'go');
    } else if (t === 'danger' && r.danger) {
      const D = r.danger;
      const lead = leadDanger(r);
      const max = D.spots.reduce((m, x) => Math.max(m, x.score ?? 0), 0);
      ans('Dangers on the Rds round you', D.spots.length ? `${D.spots.length} found` : 'None found', lead ? `Nearest strong: ${lead.label.replace('Likely ', '')} ${dist(lead.distM)} ${lead.dir}` : `${D.roadKm.toFixed(1)} km of Rds read · ground pattern only`, D.spots.length ? scoreTone(max) : 'go');
      const c = (k: string) => D.spots.filter((x) => x.kind === k).length;
      fact('Mine / IED', String(c('mine')), undefined, c('mine') ? 'nogo' : 'go');
      fact('Ambush', String(c('ambush')), undefined, c('ambush') ? 'nogo' : 'go');
      fact('Vulnerable Pts', String(c('vp')), undefined, c('vp') ? 'slow' : 'go');
      fact('Border', D.border ? `${D.border.km.toFixed(1)} km` : 'over 20 km', D.border?.kind, D.border ? (D.border.km <= 5 ? 'nogo' : 'warn') : 'go');
    } else if (t === 'people') {
      const P = r.people;
      const r1 = P.rings.find((x) => x.km === 1);
      ans('People round you (WorldPop 2026 est)', r1 ? `${num(r1.people)} within 1 km` : P.within500 !== null ? `~${num(P.within500)} within 500 m` : 'Not known', P.perKm2 !== null ? `~${num(P.perKm2)} per km² here · ~${num(P.within500 ?? 0)} within 500 m` : '', 'none');
      fact('Nearest BUA', P.bua ? where(P.bua) : 'none in 10 km', P.bua?.name ?? undefined);
      if (P.ages) fact('Males 15-49 (2 km)', num(P.ages.males15_49));
      const sens = P.sensitive.counts.reduce((a, x) => a + x.n, 0);
      fact('Sensitive sites', String(sens), P.sensitive.counts.map((x) => `${x.label} ${x.n}`).join(', ') || undefined, sens ? 'warn' : undefined);
      fact('Crowd points', String(P.crowd.length), P.crowd[0]?.label);
    } else if (t === 'help') {
      const HP = r.help;
      const f = HP.friends[0];
      ans('Nearest help', f ? `${f.label}` : 'None in 30 km', f ? `${dist(f.distM)} ${f.dir}${f.name ? ` · ${f.name}` : ''}` : '', f ? 'none' : 'warn');
      fact('Relay Gr', HP.relay ? where(HP.relay) : r.full ? 'none in 3 km' : '…', HP.relay?.why);
      fact('Radio', HP.radioShadow ? 'Shadow likely' : 'No shadow', undefined, HP.radioShadow ? 'warn' : 'go');
      fact('Hospital', H.medical.hospital ? where(H.medical.hospital) : 'none in 60 km');
    } else if (t === 'stop' && r.stop) {
      const ST = r.stop;
      ans('Patrol base / harbour', ST.harbour ? `PB ${dist(ST.harbour.distM)} ${ST.harbour.dir}` : 'None found', ST.harbour ? ST.harbourWhy.slice(0, 3).join(' · ') : ST.harbourWhy[1] ?? '', ST.harbour ? 'go' : 'marg');
      fact('Sites that pass', `${num(ST.passed)} of ${num(ST.checked)}`, 'every test', ST.passed ? 'go' : 'slow');
      fact('OP', ST.op ? where(ST.op) : 'none', ST.op ? ST.opWhy : 'needs a tower, roof or tree', ST.op ? undefined : 'warn');
      fact('Concealment here', LVL[H.cover.concealment ?? 0] ?? '—', undefined, H.cover.concealment !== null && H.cover.concealment >= 2 ? 'go' : 'slow');
    }
    return s;
  }

  // ── the hero: the tab's big picture ────────────────────────────────────────

  private _hero(br: PlatoonBrief): HTMLElement | null {
    const r = br.reading;
    if (!r || this._tab === 'patrol') return null;
    let cap = '';
    let pic: SVGSVGElement;
    const key = el('div', 'ms-pld-rkey');
    const line = (...parts: Array<Node | string>) => {
      const s = el('span');
      s.append(...parts);
      key.append(s);
    };
    const glyphs = (list: Array<[keyof typeof GLYPH_COLOR, string]>) => {
      const k = el('span', 'ms-pld-gl');
      for (const [gk, word] of list) {
        const s = el('span');
        s.append(glyphIcon(gk, 13), word);
        k.append(s);
      }
      key.append(k);
    };
    // One key item to a line (user, 2026-11-13: "should have new line for each").
    const item = (mark: Node, ...words: Array<Node | string>) => {
      const s = el('span', 'ms-pld-ki');
      s.append(mark, ...words);
      key.append(s);
    };
    // The glyphs with the short word they carry on the map and in the halo (Wtr, IED...), then what it stands for.
    const coded = (list: GlyphKind[]) => {
      const k = el('span', 'ms-pld-gl ms-codes');
      for (const gk of list) {
        const s = el('span', 'ms-pld-ki');
        s.append(glyphIcon(gk, 13), b(GLYPH_CODE[gk]), GLYPH_WORD[gk]);
        k.append(s);
      }
      key.append(k);
    };
    switch (this._tab) {
      case 'here': {
        cap = 'Round you';
        pic = plRadar(r, { px: 260, sight: true, scale: true, label: 'Round you: sight, way out, water, dangers, casevac, help' });
        item(sw(STEP_COLOR.go, 0.5), 'seen');
        item(sw('#ffb300', 0.7), 'screened');
        item(sw(STEP_COLOR.nogo, 0.8), 'dead Gr');
        item(arcSw(STEP_COLOR.go), 'rim: way out, foot (outer) / veh');
        line(el('span', 'ms-pld-why', 'dashed ring: the search radius; log scale past it'));
        coded(RADAR_KEY);
        break;
      }
      case 'see': {
        if (!r.see) return null;
        cap = `What you see (${EYE_WORD[r.eye] ?? r.eye}, ${r.see.eyeM} m)`;
        pic = fanSvg(r.see);
        item(sw(STEP_COLOR.go, 0.5), 'seen');
        item(sw('#ffb300', 0.7), 'screened by crops, trees, Bldgs');
        item(sw(STEP_COLOR.nogo, 0.8), 'dead Gr');
        item(miniShape('diamond', '#e6edf3'), 'range card landmark');
        item(miniShape('tri', '#ba68c8'), 'Gr that looks down on you');
        item(miniShape('ring', 'rgba(255,255,255,.6)'), 'range rings');
        break;
      }
      case 'danger': {
        const D = r.danger;
        if (!D) return null;
        cap = 'On the Rds round you';
        const labelled = new Set([...D.spots].sort(byDanger).slice(0, 6));
        const reach = Math.max(r.radiusM, Math.min(r.radiusM * 2, ...D.spots.map((x) => x.distM)));
        pic = heroRose({
          label: 'Dangers on the Rds round you',
          reachM: reach,
          bubbleM: r.radiusM,
          items: D.spots.map((s) => ({ kind: dangerGlyph(s.kind), color: SCORE_COL(s.score ?? 0), distM: s.distM, bearingDeg: s.bearingDeg, strong: (s.score ?? 0) >= 70, text: labelled.has(s) ? dist(s.distM) : undefined })),
        });
        const KINDS: Array<[string, keyof typeof GLYPH_COLOR, string]> = [['mine', 'mine', 'mine / IED'], ['ambush', 'ambush', 'ambush'], ['block', 'block', 'Rd block'], ['vp', 'vp', 'VP'], ['overlooked', 'overlook', 'overlooked']];
        const counted: Array<[keyof typeof GLYPH_COLOR, string]> = [];
        for (const [k, gk, word] of KINDS) {
          const n = D.spots.filter((x) => x.kind === k || (k === 'overlooked' && x.kind === 'rooftops')).length;
          if (n) counted.push([gk, `${n} ${word}`]);
        }
        if (counted.length) glyphs(counted);
        line(el('span', 'ms-pld-why', `ringed: score 70+ · blue dashed: the search radius · ${D.roadKm.toFixed(1)} km of Rds read`));
        break;
      }
      case 'help': {
        cap = 'Nearest help';
        const HP = r.help;
        const M = r.here.medical;
        const items: HeroItem[] = HP.friends.map((f) => ({ kind: 'help', color: '#42a5f5', distM: f.distM, bearingDeg: f.bearingDeg, text: `${helpCode(f.kind)} ${shortLabel(f.name ?? f.label)}` }));
        if (M.hospital) items.push({ kind: 'hospital', color: '#ff5c63', distM: M.hospital.distM, bearingDeg: M.hospital.bearingDeg, text: 'Hospital' });
        if (M.bhu) items.push({ kind: 'hospital', color: '#ff5c63', distM: M.bhu.distM, bearingDeg: M.bhu.bearingDeg, text: 'BHU' });
        if (HP.relay) items.push({ kind: 'relay', color: '#8c9eff', distM: HP.relay.distM, bearingDeg: HP.relay.bearingDeg, text: 'RL relay Gr' });
        const reach = Math.min(60000, Math.max(5000, ...items.map((x) => x.distM)) * 1.05);
        pic = heroRose({ label: 'Nearest help', reachM: reach, sqrt: true, bubbleM: r.radiusM, items });
        item(glyphIcon('help', 13), b('Pol'), 'police station');
        item(glyphIcon('help', 13), b('Post'), 'post · ', b('BOP'), 'border post');
        item(glyphIcon('help', 13), b('Fort'), 'fort · ', b('Cantt'), 'cantonment');
        item(glyphIcon('hospital', 13), b('Hosp'), 'hospital, BHU');
        item(glyphIcon('relay', 13), b('RL'), 'relay Gr');
        line(el('span', 'ms-pld-why', 'square-root scale: near ground gets more room'));
        break;
      }
      case 'people': {
        cap = 'Where the people are';
        pic = peopleMap(r);
        key.append(classKey());
        line(glyphIcon('bua', 13), 'nearest BUA ', dot('#ab47bc'), ' sensitive site ', dot('#ffa726'), ' crowd point');
        line(el('span', 'ms-pld-why', `${r.people.grid ? `cells ~${r.people.grid.cellKm.toFixed(1)} km · ` : ''}WorldPop 2026 est, not a census`));
        break;
      }
      case 'stop': {
        const ST = r.stop;
        if (!ST) return null;
        cap = 'Where to stop';
        pic = stopMap(r);
        item(sw(STEP_COLOR.go), b(`${Math.round((100 * ST.passed) / Math.max(1, ST.checked))}%`), 'passed every test');
        for (const t of [...ST.tests].filter((x) => x.out > 0).sort((a, b2) => b2.out - a.out)) item(sw(stopCol(t.key), 0.85), b(`${Math.round((100 * t.out) / Math.max(1, ST.checked))}%`), t.label);
        item(glyphIcon('harbour', 13), b('PB'), 'patrol base · 2-4 next best');
        if (ST.op) item(glyphIcon('op', 13), b('OP'), 'OP site, outline: what it sees');
        break;
      }
      default:
        return null;
    }
    const h = el('div', 'ms-pld-hero');
    h.append(el('div', 'ms-pld-hcap', cap));
    const p = el('div', 'ms-pld-hpic');
    p.append(pic);
    const k = el('div', 'ms-pld-hkey');
    k.append(key);
    h.append(p, k);
    return h;
  }

  // ── tiles ──────────────────────────────────────────────────────────────────

  private _tiles(br: PlatoonBrief): HTMLElement[] {
    const r = br.reading;
    const t = this._tab;
    if (t === 'patrol' && br.patrol) return this._patrolTiles(br);
    if (!r) return [];
    if ((t === 'see' && !r.see) || (t === 'danger' && !r.danger) || (t === 'stop' && !r.stop)) return [tile('Reading…', el('div', 'ms-pld-note', 'Sight, the dangers on the Rds and where to stop are read once the cursor rests (or A pins it).'))];
    if (t === 'here') return this._hereTiles(br, r);
    if (t === 'see') return this._seeTiles(br, r);
    if (t === 'danger') return this._dangerTiles(r);
    if (t === 'people') return this._peopleTiles(r);
    if (t === 'help') return this._helpTiles(r);
    if (t === 'stop') return this._stopTiles(r);
    return [];
  }

  private _checks(r: PlReading, match?: RegExp): HTMLElement | null {
    const list = match ? r.checks.filter((c) => match.test(c)) : r.checks;
    if (!list.length) return null;
    const d = el('div');
    for (const c of list) d.append(el('div', 'ms-pld-li', `• ${c}`));
    return tile('Check on the Gr', d);
  }

  private _hereTiles(br: PlatoonBrief, r: PlReading): HTMLElement[] {
    const H = r.here;
    const out: HTMLElement[] = [];
    const g = H.going.foot;
    // The going on the ladder's gauge (the way out is the radar's rim and the strip of directions below).
    out.push(tile('Going here', gauge(g === 'unknown' ? null : g), pairs([['Vehicles', frag(b(GO_WORD[H.going.veh]))], ['Ground', H.clsLabel], H.going.afterRain ? ['After rain', el('span', 'ms-pld-why', H.going.afterRain)] : null])));
    const dirs = el('div', 'ms-pld-dirs');
    for (const d of H.waysOut.dirs) {
      const c = el('div', 'ms-pld-dir', d.dir);
      if (d.foot !== 'unknown') c.style.background = STEP_COLOR[d.foot];
      c.title = `${d.dir}: foot ${GO_WORD[d.foot]}, vehicles ${GO_WORD[d.veh]}`;
      dirs.append(c);
    }
    out.push(tile('Way out on foot', dirs, pairs([['Vehicles', H.waysOut.dirs.filter((d) => d.veh === 'go').map((d) => d.dir).join(' ') || 'none'], ['Nearest Rd / Tr', H.waysOut.road ? frag(b(H.waysOut.road.name ?? H.waysOut.road.label), ' ', where(H.waysOut.road)) : 'none in 5 km']])));
    const lv = (n: number | null) => {
      const s = el('b', undefined, n === null ? 'not known' : LVL[n] ?? String(n));
      if (n !== null) s.style.color = LEVEL_TEXT[n] ?? '';
      return s;
    };
    out.push(tile('Cover and concealment', pairs([['Cover here', lv(H.cover.cover)], ['Concealment', lv(H.cover.concealment)], H.betterCover ? ['Better cover', spotV(H.betterCover)] : null, H.betterConcealment ? ['Better concealed', spotV(H.betterConcealment)] : null])));
    const W = H.water;
    out.push(tile('Water', pairs([['Nearest', spotV(W.nearest, { why: true })], W.perennial ? ['No power needed', spotV(W.perennial)] : null, W.line ? ['Flowing', spotV(W.line, { why: true })] : null, W.brackish ? ['Brackish', frag(b('noted on the map '), where(W.brackish), why('test before drinking'))] : null, ['Recorded', `${W.count} water points within 5 km`]])));
    const M = H.medical;
    const wires = H.hls.wires.map((x) => `${x.label} ${dist(x.distM)} ${x.dir}`).join('; ');
    out.push(tile('Casevac', pairs([['Landing Gr', H.hls.ground ? frag(b(H.hls.ground.distM < 15 ? 'clear Gr here' : 'clear Gr '), H.hls.ground.distM < 15 ? '' : where(H.hls.ground), why(H.hls.ground.why)) : el('span', 'ms-pld-why', 'none within 2 km')], wires ? ['Wires', el('span', 'ms-pld-why', wires)] : null, ['Recorded HLS', spotV(H.hls.recorded)], ['Hospital', spotV(M.hospital)], M.driveMin !== null ? ['Drive', frag(b(`~${M.driveMin} min`), why('straight line × 1.4 at 40 km/h: an estimate'))] : null, ['BHU', spotV(M.bhu)], ['Dispensary', spotV(M.dispensary)]])));
    const wh = H.where;
    out.push(tile('Where am I', pairs([['Grid', b(br.grid)], br.sheet ? ['Sheet', b(br.sheet)] : null, wh.km ? ['KM stone', spotV(wh.km)] : null, ['Place', spotV(wh.place)], wh.district || wh.tehsil ? ['District', [wh.district, wh.tehsil].filter(Boolean).join(' / ')] : null])));
    if (!r.full) out.push(tile('More when the cursor rests', el('div', 'ms-pld-note', 'Sight, the dangers on the Rds round you and where to stop are read once the cursor rests.')));
    const c = this._checks(r, /Water|Brackish|Landing|Hospital|Going after rain/);
    if (c) out.push(c);
    return out;
  }

  private _seeTiles(br: PlatoonBrief, r: PlReading): HTMLElement[] {
    const S = r.see!;
    const out: HTMLElement[] = [];
    out.push(
      tile(
        'Shares',
        el('div', 'ms-pld-k', `Within ${dist(S.radiusM)}`),
        stack([[STEP_COLOR.go, S.pct.seen, 'seen'], ['#ffb300', S.pct.screened, 'screened'], [STEP_COLOR.nogo, S.pct.dead, 'dead']]),
        el('div', 'ms-pld-k', 'Within 300 m'),
        stack([[STEP_COLOR.go, S.near.seen, 'seen'], ['#ffb300', S.near.screened, 'screened'], [STEP_COLOR.nogo, S.near.dead, 'dead']]),
        pairs([['Nearest dead Gr', S.deadNear ? frag(b(dist(S.deadNear.distM)), ' ', where(S.deadNear), why('a man there is hidden from you')) : 'none within 300 m'], S.approachDirs.length ? ['Covered from', b(S.approachDirs.join(' '))] : null, S.skyline ? ['Skyline', el('b', undefined, 'on a crest: move below it')] : null]),
      ),
    );
    out.push(tile('Who looks down on you', S.overlook.length || S.rooftops ? spotList([...S.overlook, ...(S.rooftops ? [S.rooftops] : [])], () => '#ba68c8', this._go, { why: true, label: (s) => s.label }) : el('div', 'ms-pld-note', 'No higher Gr in view within 800 m.')));
    const rc = el('div');
    for (const x of S.refs) {
      const li = el('div', 'ms-pld-li ms-go');
      li.append(b(brg(x.bearingDeg)), `  ${dist(x.distM)}  ${x.name ?? x.label}`);
      li.addEventListener('click', () => this._go(x));
      rc.append(li);
    }
    out.push(tile('Range card', S.refs.length ? rc : el('div', 'ms-pld-note', 'No landmark in view.')));
    const rs = el('div');
    for (const x of S.resection) {
      const li = el('div', 'ms-pld-li ms-go');
      li.append(b(brg(x.bearingDeg)), `  ${x.name ?? x.label}  ${dist(x.distM)}`);
      li.addEventListener('click', () => this._go(x));
      rs.append(li);
    }
    out.push(tile('Resection', S.resection.length === 3 ? rs : el('div', 'ms-pld-note', 'Fewer than three fixed landmarks in view.'), el('div', 'ms-pld-note', 'Grid bearings: apply the magnetic variation.')));
    const v = br.vis;
    out.push(tile('Light and weather', pairs([br.light ? ['Now', b(br.light.now)] : null, br.light ? ['Tonight', br.light.tonight] : null, v ? ['This month', `fog ${v.fogPct ?? '?'}% of days, haze ${v.hazePct ?? '?'}%`] : null, v && v.meanViewKm !== null ? ['Mean view', `${v.meanViewKm.toFixed(0)} km`] : null])));
    const c = this._checks(r, /Dead and screened/);
    if (c) out.push(c);
    return out;
  }

  private _dangerTiles(r: PlReading): HTMLElement[] {
    const D = r.danger!;
    const out: HTMLElement[] = [];
    if (D.spots.length) out.push(tile('Where (worst kinds first)', spotList([...D.spots].sort(byDanger), (s) => SCORE_COL(s.score ?? 0), this._go, { why: true, label: (s) => s.label.replace('Likely ', '') })));
    if (D.approaches.length) out.push(tile('Covered Gr towards you', spotList(D.approaches, () => TONE.slow.dot, this._go)));
    if (D.hazards.length) out.push(tile('Hazards', spotList(D.hazards, () => '#8d6e63', this._go, { why: true })));
    const other: Array<[string, Node | string] | null> = [D.border ? ['Border', frag(b(`${D.border.kind} ${D.border.km.toFixed(1)} km`), D.border.km <= 5 ? why('under observation, mines possible') : '')] : null, ...D.natural.map((n) => ['Natural', el('span', 'ms-pld-why', n)] as [string, Node])];
    if (other.some(Boolean)) out.push(tile('Border and nature', pairs(other)));
    out.push(tile('Read this as', el('div', 'ms-pld-note', r.gaps[0] ?? ''), this._checks(r, /mine/)));
    return out;
  }

  private _peopleTiles(r: PlReading): HTMLElement[] {
    const P = r.people;
    const out: HTMLElement[] = [];
    // How many, how far: bars to scale, each in its density class; the class here as a chip.
    const here = el('div', 'ms-pld-pair');
    const cls = P.perKm2 !== null ? populationClass(P.perKm2) : null;
    const chip = el('span', 'ms-pld-cls');
    if (cls) {
      chip.style.background = cls.color;
      chip.style.color = cls.dark ? '#fff' : '#14181d';
      chip.textContent = cls.label;
    }
    const hv = el('div', 'ms-pld-v');
    hv.append(P.perKm2 !== null ? frag(b(`~${num(P.perKm2)}`), ' per km² ', chip) : 'not known');
    here.append(el('div', 'ms-pld-k', 'Here'), hv);
    out.push(tile('How many, how far', here, P.within500 !== null || P.rings.length ? ringBars(P) : el('div', 'ms-pld-note', 'No population grid in the bundle.')));
    // Which way the people are.
    if (P.sectors) out.push(tile('By direction (within 2 km)', sectorRose(P.sectors)));
    // Busier or quieter further out.
    if (P.bands && P.bands.length) {
      const near = P.bands[0].perKm2, far = P.bands[P.bands.length - 1].perKm2;
      const trend = far > near * 1.5 ? 'busier further out' : near > far * 1.5 ? 'quieter further out' : 'about the same out to 10 km';
      out.push(tile('People per km² by distance (km)', bandColumns(P.bands), el('div', 'ms-pld-note', `Here: ${trend}.`)));
    }
    if (P.ages) {
      const tot = Math.max(1, P.rings.find((x) => x.km === 2)?.people ?? P.ages.males15_49 + P.ages.under15 + P.ages.over65);
      const pc = (n: number) => (100 * n) / tot;
      const parts: Array<[string, number, string]> = [[STEP_COLOR.slow, pc(P.ages.males15_49), 'males 15-49'], [LEVEL_COLOR[2], pc(P.ages.under15), 'under 15'], ['#9aa3ad', pc(P.ages.over65), 'over 65']];
      const key = el('div', 'ms-pld-gl');
      for (const [c, p, word] of parts) {
        const s = el('span');
        s.append(sw(c), b(`${Math.round(p)}%`), ` ${word}`);
        key.append(s);
      }
      const rest = el('span');
      rest.append(sw('#3a434e'), 'others');
      key.append(rest);
      out.push(tile('Ages within 2 km (1 square = 1%)', waffle(parts), key, pairs([['Males 15-49', b(num(P.ages.males15_49))]])));
    }
    const bua = P.bua;
    out.push(
      tile(
        'BUA and Bldgs',
        bua ? frag(el('div', 'ms-pld-big', bua.name ?? bua.label), el('div', 'ms-pld-why', `${bua.label}${bua.why ? ` · ${bua.why}` : ''}`)) : null,
        pairs([bua ? ['Where', where(bua)] : ['Nearest BUA', 'none in 10 km'], P.bld ? ['Bldgs here', `${P.bld.density}, ${P.bld.size}${P.bld.tall ? ', tall' : ''}`] : ['Bldgs here', 'none recorded'], P.huts ? ['Huts', `~${P.huts.perKm2} permanent per km²${P.huts.temporary ? ', temporary huts nearby (nomads)' : ''}`] : null]),
      ),
    );
    const chips = el('div', 'ms-pld-chips');
    for (const c of P.sensitive.counts) {
      const ch = el('span', 'ms-pld-chip');
      ch.append(dot('#ab47bc'), b(String(c.n)), ` ${c.label}`);
      chips.append(ch);
    }
    out.push(tile(`Sensitive sites within ${dist(r.radiusM)}`, P.sensitive.counts.length ? chips : el('div', 'ms-pld-note', 'None recorded.'), P.sensitive.nearest.length ? spotList(P.sensitive.nearest, () => '#ab47bc', this._go) : null));
    if (P.crowd.length) out.push(tile('Crowd points', spotList(P.crowd, () => '#ffa726', this._go)));
    out.push(tile('Read this as', el('div', 'ms-pld-note', `WorldPop 2026 estimates, not a census. ${r.gaps.find((g) => /thinly/.test(g)) ?? ''}`)));
    return out;
  }

  private _helpTiles(r: PlReading): HTMLElement[] {
    const HP = r.help;
    const out: HTMLElement[] = [];
    out.push(tile('Help, nearest first', HP.friends.length ? spotList(HP.friends, () => '#42a5f5', this._go) : el('div', 'ms-pld-note', 'None recorded within 30 km.')));
    out.push(tile('Signals', pairs([['Relay / OP Gr', HP.relay ? spotV(HP.relay, { why: true }) : el('span', 'ms-pld-why', r.full ? 'no higher Gr within 3 km sees you' : 'rest the cursor')], ['Radio', HP.radioShadow ? el('b', undefined, 'Low Gr ringed by higher Gr: radio shadow likely') : 'no shadow found']])));
    if (HP.supply.length) out.push(tile('Supply', spotList(HP.supply, () => '#9aa3ad', this._go)));
    return out;
  }

  private _stopTiles(r: PlReading): HTMLElement[] {
    const ST = r.stop!;
    const out: HTMLElement[] = [];
    const R = ST.rules;
    const best = ST.sites[0] ?? null;
    if (ST.harbour && best) {
      // The patrol base: every test it passed, each with its picture.
      const ck = (label: string, pic: Node | null, value: Node | string) => {
        const row = el('div', 'ms-pld-ck');
        row.append(el('span', 'ms-ok', '✓'), el('span', 'ms-pld-k', label));
        const v = el('span', 'ms-pld-ckv');
        if (pic) v.append(pic);
        v.append(value);
        row.append(v);
        return row;
      };
      const head = el('div', 'ms-pld-pbh');
      const hb = ST.harbour;
      head.append(glyphIcon('harbour', 22), el('span', 'ms-pld-big', 'PB'), where(hb));
      head.title = 'Show on the map';
      head.addEventListener('click', () => this._go(hb));
      const ways = el('span');
      ways.append(b(`${best.ways} of 8`), ' on foot');
      const wtr = el('span');
      wtr.append(b(dist(best.waterM)));
      const bua = el('span');
      bua.append(best.buaM !== null ? b(dist(best.buaM)) : frag('none in ', b(dist(R.villageM))));
      out.push(
        tile(
          'Patrol base / harbour',
          head,
          ck('Concealment', null, pips(best.conceal)),
          ck('Cover', null, pips(best.cover)),
          ck('Ways out', waysRose(best.waysDirs, 32), ways),
          ck(`Water ≤ ${R.waterKm} km`, limitBar(best.waterM, R.waterKm * 1000, true), wtr),
          ck(`BUA ≥ ${dist(R.villageM)}`, best.buaM !== null ? limitBar(best.buaM, R.villageM, false) : null, bua),
          ck('Rd / Tr', null, frag('none in ', b(dist(R.roadM)))),
          ck('Gr', null, 'not flood Gr, not on a crest'),
        ),
      );
    } else {
      out.push(tile('Patrol base / harbour', el('div', 'ms-pld-big', 'None found'), el('div', 'ms-pld-note', ST.harbourWhy[0] ?? ''), el('div', 'ms-pld-note', 'The map beside it shows which test ruled each part of the bubble out; the funnel below how many.')));
    }
    out.push(tile(`How the bubble was ruled out (${dist(ST.grid.stepM)} grid)`, funnel(ST)));
    if (ST.sites.length > 1) {
      const d = el('div');
      const LV = ['no', 'poor', 'fair', 'good'];
      ST.sites.slice(1).forEach((x, i) => {
        const li = el('div', 'ms-pld-li ms-go ms-pld-alt');
        li.title = 'Show on the map';
        const n = el('span', 'ms-pld-altn', String(i + 2));
        li.append(glyphIcon('harbour', 16), n, b(dist(x.distM)), ' ', whereNode(x.distM, x.dir, x.bearingDeg), el('div', 'ms-pld-why', `${LV[x.conceal]} concealment, ${LV[x.cover]} cover · ${x.ways} ways out · water ${dist(x.waterM)}`));
        li.addEventListener('click', () => this._h.goTo(x.x, x.y));
        d.append(li);
      });
      out.push(tile('Next best sites (250 m apart or more)', d));
    }
    if (ST.op && ST.opView) {
      const op = ST.op;
      const w = el('div', 'ms-pld-pic ms-row');
      const p = el('div');
      p.append(opRose(ST.opView));
      const side = el('div');
      side.append(pairs([['Sees', frag(b(`${op.score ?? 0}%`), ' of the Gr within 1 km')], ['Height', ST.opRiseM !== null ? frag(b(`${ST.opRiseM >= 0 ? '+' : ''}${ST.opRiseM} m`), ' above the Gr round it') : '—'], ['Where', where(op)]]));
      w.append(p, side);
      w.title = 'Show on the map';
      w.style.cursor = 'pointer';
      w.addEventListener('click', () => this._go(op));
      out.push(tile('OP site: what it sees (to 1 km)', w));
    } else {
      // No OP: how high the highest ground stands against the rise an OP needs.
      const need = R.opRiseM;
      const has = Math.max(0, ST.opRiseM ?? 0);
      const span = Math.max(need * 1.6, has + 1);
      const g = el('div', 'ms-pld-lim ms-tall');
      const f = el('i');
      f.style.width = `${Math.min(100, (100 * has) / span)}%`;
      f.style.background = TONE.marg.dot;
      const tick = el('u');
      tick.style.left = `${(100 * need) / span}%`;
      g.append(f, tick);
      out.push(tile('OP site', el('div', 'ms-pld-big', 'None on the Gr'), pairs([['Highest Gr', frag(b(`+${has} m`), ' above the rest')], ['An OP needs', frag(b(`+${need} m`), ' (the mark)')]]), g, el('div', 'ms-pld-note', ST.opWhy)));
    }
    const c = this._checks(r, /Patrol base/);
    if (c) out.push(c);
    return out;
  }

  private _patrolTiles(br: PlatoonBrief): HTMLElement[] {
    const p = br.patrol!;
    const out: HTMLElement[] = [];
    const legs = el('div');
    for (const l of p.legs) {
      const li = el('div', 'ms-pld-li ms-go');
      li.append(b(`Leg ${l.i}  ${brg(l.bearingDeg)}`), `  ${dist(l.distM)} · ${num(l.paces)} paces · ${l.minDay} / ${l.minNight} min${l.climbM >= 10 ? ` · climb ${l.climbM} m` : ''}`);
      li.append(why(l.endFeature ? `ends at ${l.endFeature.name ?? l.endFeature.label}` : 'no landmark at the turn'));
      li.addEventListener('click', () => this._h.goTo(l.to[0], l.to[1]));
      legs.append(li);
    }
    out.push(tile('Legs (grid bearings, day / night minutes)', legs));
    const range = (s: { fromM: number; toM: number }) => (Math.abs(s.toM - s.fromM) < 30 ? `at ${dist(s.fromM)}` : `${dist(s.fromM)}-${dist(s.toM)}`);
    out.push(
      tile(
        'On the route',
        pairs([
          ['Bounds', p.bounds.map((x) => dist(x.chainM)).join(', ') || 'none'],
          p.fmp ? ['Final meeting Pt', `at ${dist(p.fmp.chainM)} (${dist(p.lengthM - p.fmp.chainM)} short)`] : null,
          p.threatKnown ? ['Hidden from threat', p.dead.map(range).join(', ') || 'no stretch'] : null,
          ['Exposed', p.exposed.map(range).join(', ') || 'no stretch'],
          p.skyline.length ? ['Skyline', p.skyline.map(range).join(', ')] : null,
          p.obstacles.length ? ['Obs crossed', p.obstacles.map((o) => `${o.label} at ${dist(o.chainM)}`).join('; ')] : null,
          p.villages.length ? ['Villages', `${p.villages.map((v) => `${v.name ?? 'village'} at ${dist(v.chainM)}`).join('; ')}: avoid at night`] : null,
        ]),
      ),
    );
    if (p.dangers.length) {
      const d = el('div');
      for (const s of p.dangers.slice(0, 8)) {
        const li = el('div', 'ms-pld-li');
        li.append(dot(SCORE_COL(s.score)), b(`${s.label} `), range(s), why(s.why));
        d.append(li);
      }
      out.push(tile('Dangers on the route (on foot)', d));
    }
    const ch = el('div');
    for (const c of p.checks) ch.append(el('div', 'ms-pld-li', `• ${c}`));
    out.push(tile('Check on the Gr', ch));
    return out;
  }
}
