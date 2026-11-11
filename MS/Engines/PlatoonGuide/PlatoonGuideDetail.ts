/**
 * PlatoonGuideDetail.ts
 *
 * The Pl Detail: the Platoon Guide's wide card, built like the Ground Detail (GroundGuideDetail.ts; user, 2026-11-11:
 * "make it platoonguide like cards" of the Ground Guide). Docked at the foot of the map, it reads in the same parts:
 *   - the tab row, each tab with its own answer under its name (Here: GO on foot, See: 29% seen, Danger: 10 ...);
 *   - who and what it is read for (echelon and bubble, from where, eye height, grid and sheet, month and light);
 *   - the answer strip: the tab's answer in a toned block, then its key facts on one line;
 *   - the band: the tab's pictures first (way-out rose, visibility sketch, danger and help maps, bars), then its lists,
 *     down newspaper columns of a fixed height. It never scrolls: what does not fit goes to a next page.
 * A turns the page, then the tab (Shift+A goes back), so one key walks the whole card while the mouse is busy; a click on
 * a tab works too; Esc or × closes it. Every colour and size from GroundGuideTokens.ts; every picture is north up and
 * turns with the map, and every direction carries an arrow (GroundGuideNorth). DOM nodes and textContent only.
 */

import { ensureTokensCss, gauge, LEVEL_COLOR, LEVEL_TEXT, roseFrame, roseHub, roseKey, ROSE_C, ROSE_R, STEP_COLOR, STEP_TEXT, TONE } from '../GroundGuide/GroundGuideTokens';
import { ensureNorthCss, orientNorth, whereNode } from '../GroundGuide/GroundGuideNorth';
import type { PlGoing, PlReading, PlSee, PlSpot } from './PlatoonGuideRead';
import { brg, briefLines, dist, ECHELON_WORD, EYE_WORD, num, type PlatoonBrief } from './PlatoonGuideText';
import { leadDanger } from './PlatoonGuideCard';
import { dangerGlyph, glyph, glyphIcon, GLYPH_COLOR, plRadar, RADAR_KEY } from './PlatoonGuideRadar';

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
.ms-pld{position:fixed;left:10px;right:10px;bottom:10px;z-index:2147482810;height:calc(46vh + 40px);min-height:min(500px,calc(100vh - 20px));max-height:calc(100vh - 20px);
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

/** Places round the point on a rose scaled to `radiusM` (farther ones on the rim): the radar's glyph for the kind when there is one, else a dot. */
function spotsRose(label: string, spots: PlSpot[], radiusM: number, color: (s: PlSpot) => string, key: string, kindOf?: (s: PlSpot) => keyof typeof GLYPH_COLOR | null): HTMLElement {
  const f = roseFrame(label);
  for (const k of [0.5, 1]) f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: ROSE_R * k, fill: 'none', stroke: 'rgba(255,255,255,.18)', 'stroke-dasharray': '2 3' });
  for (const s of [...spots].sort((a, b) => b.distM - a.distM)) {
    const rr = Math.min(1, s.distM / radiusM) * (ROSE_R - 4);
    const [x, y] = f.at(rr, s.bearingDeg).split(' ').map(Number);
    const kind = kindOf?.(s) ?? null;
    if (kind) glyph(f.g, kind, x, y, 3.6);
    else f.add('circle', { cx: x, cy: y, r: 4.2, fill: color(s), stroke: '#14181d', 'stroke-width': 1.2 });
  }
  roseHub(f, 4.5);
  const w = el('div');
  w.append(f.svg, roseKey(key));
  return w;
}

/** The visibility sketch: seen (green), screened (amber), dead ground (red), range rings, landmarks; north up, turns with the map. */
function fanSketch(S: PlSee): HTMLElement {
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
  for (const m of [100, 300, 500, 1000, 1500, 2000].filter((x) => x <= S.radiusM)) {
    svgEl('circle', { cx: C, cy: C, r: (m * k).toFixed(1), fill: 'none', stroke: 'rgba(255,255,255,.35)', 'stroke-dasharray': '2 3' }, g);
    svgEl('text', { x: C + 3, y: (C - m * k + 11).toFixed(1), fill: '#c3cbd3', 'font-size': 10.5, 'font-family': 'system-ui,Segoe UI,Arial,sans-serif', 'data-gv-upright': `${C + 3} ${(C - m * k + 11).toFixed(1)}` }, g, m >= 1000 ? `${m / 1000} km` : `${m}`);
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
  const w = el('div');
  w.append(svg, roseKey([[STEP_COLOR.go, 'seen'], ['#ffb300', 'screened'], [STEP_COLOR.nogo, 'dead Gr']]));
  return w;
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

// ── the card ─────────────────────────────────────────────────────────────────

export interface PlatoonGuideDetailHandlers {
  close(): void;
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

  constructor(private readonly _h: PlatoonGuideDetailHandlers) {}

  get isOpen(): boolean {
    return !!this._el?.classList.contains('ms-open');
  }
  get tab(): PlTab {
    return this._tab;
  }

  /** The tabs this brief has, in order. */
  tabsOf(br: PlatoonBrief | null = this._brief): PlTab[] {
    const r = br?.reading;
    const t: PlTab[] = [];
    if (r) {
      t.push('here');
      if (r.see) t.push('see');
      if (r.danger) t.push('danger');
      t.push('people', 'help');
      if (r.stop) t.push('stop');
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
    e.classList.add('ms-open');
    this._render();
  }

  close(): void {
    this._el?.classList.remove('ms-open');
  }

  /** A: the next page, then the next tab (wrapping); Shift+A the other way. */
  step(dir: 1 | -1): void {
    if (!this.isOpen) return this.open();
    const tabs = this.tabsOf();
    if (!tabs.length) return;
    const ti = Math.max(0, tabs.indexOf(this._tab));
    if (dir > 0) {
      if (this._page + 1 < this._pages) this._page++;
      else {
        this._tab = tabs[(ti + 1) % tabs.length];
        this._page = 0;
      }
    } else if (this._page > 0) this._page--;
    else {
      this._tab = tabs[(ti - 1 + tabs.length) % tabs.length];
      this._page = -1; // the new tab's last page, once it is laid out
    }
    this._render();
  }

  update(br: PlatoonBrief, northDeg: number): void {
    const tabsBefore = this.tabsOf().join();
    const newSubject = !this._brief || this._brief.what !== br.what || (this._brief.patrol ? 1 : 0) !== (br.patrol ? 1 : 0);
    this._brief = br;
    this._north = northDeg;
    if (br.patrol && !br.reading) this._tab = 'patrol';
    if (!this.tabsOf().includes(this._tab)) this._tab = this.tabsOf()[0] ?? 'here';
    if (newSubject || tabsBefore !== this.tabsOf().join()) this._page = Math.min(this._page, 0);
    if (this.isOpen) this._render();
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
    e.replaceChildren();
    const h = el('div', 'ms-pld-h');
    h.append(el('span', 'ms-pld-name', 'Pl Detail'));
    const tabs = el('div', 'ms-pld-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const t of this.tabsOf()) {
      const bt = el('button', 'ms-pld-tab') as HTMLButtonElement;
      bt.type = 'button';
      bt.setAttribute('role', 'tab');
      bt.setAttribute('aria-selected', String(t === this._tab));
      const ans = this._tabAnswer(br!, t);
      const a = el('span', 'ms-pld-ta');
      if (ans.color) a.append(dot(ans.color));
      a.append(el('span', undefined, ans.text));
      bt.append(el('span', undefined, TAB_LABEL[t]), a);
      bt.addEventListener('click', () => {
        this._tab = t;
        this._page = 0;
        this._render();
      });
      tabs.append(bt);
    }
    const copy = el('button', 'ms-pld-btn', this._status ?? 'Copy as Text') as HTMLButtonElement;
    copy.type = 'button';
    copy.addEventListener('click', () => {
      if (!this._brief) return;
      void navigator.clipboard?.writeText(briefLines(this._brief).join('\n')).then(
        () => this._flash('Copied'),
        () => this._flash('Copy failed'),
      );
    });
    const x = el('button', 'ms-pld-btn ms-x', '×') as HTMLButtonElement;
    x.type = 'button';
    x.setAttribute('aria-label', 'Close the Pl Detail');
    x.addEventListener('click', () => this._h.close());
    h.append(tabs, el('span', 'ms-pld-hsp'), copy, x);
    e.append(h);
    if (!br || !this.tabsOf().length) {
      e.append(el('div', 'ms-pld-empty', 'Hover the map with ⌖ on, place or select a Team / Sec / Pl / Coy, or select a line for the patrol route card.'));
      return;
    }
    e.append(this._mode(br));
    e.append(this._strip(br));
    const band = el('div', 'ms-pld-band');
    const clip = el('div', 'ms-pld-clip');
    const flow = el('div', 'ms-pld-flow');
    for (const t of this._tiles(br)) flow.append(t);
    clip.append(flow);
    band.append(clip);
    e.append(band);
    const f = el('div', 'ms-pld-f');
    const k1 = el('span');
    k1.append(el('span', 'ms-pld-kbd', 'A'), 'next page, then tab');
    const k2 = el('span');
    k2.append(el('span', 'ms-pld-kbd', '⇧A'), 'back');
    const k3 = el('span');
    k3.append(el('span', 'ms-pld-kbd', 'Esc'), 'close');
    f.append(k1, k2, k3, el('span', 'ms-pld-pg'));
    e.append(f);
    orientNorth(e, this._north);
    this._layout();
  }

  /** Columns to the card's width; overflow to the right becomes pages, shown by sliding the flow. */
  private _layout(): void {
    const e = this._el;
    const clip = e?.querySelector<HTMLElement>('.ms-pld-clip');
    const flow = e?.querySelector<HTMLElement>('.ms-pld-flow');
    if (!e || !clip || !flow) return;
    const W = clip.clientWidth;
    if (!W) return;
    flow.style.setProperty('--pld-h', `${clip.clientHeight}px`);
    const n = Math.max(1, Math.floor((W + COL_GAP) / (COL_MIN + COL_GAP)));
    flow.style.columnCount = String(n);
    flow.style.transform = '';
    const pageW = W + COL_GAP;
    this._pages = Math.max(1, Math.round((flow.scrollWidth + COL_GAP) / pageW));
    if (this._page < 0 || this._page >= this._pages) this._page = this._page < 0 ? this._pages - 1 : 0;
    flow.style.transform = this._page ? `translateX(${-this._page * pageW}px)` : '';
    const pg = e.querySelector('.ms-pld-pg');
    if (pg) pg.textContent = this._pages > 1 ? `Page ${this._page + 1} of ${this._pages}: A for more` : '';
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
        const s = r.danger?.spots ?? [];
        const max = s.reduce((m, x) => Math.max(m, x.score ?? 0), 0);
        return { text: s.length ? `${s.length} on the Rds` : 'none found', color: s.length ? SCORE_COL(max) : STEP_COLOR.go };
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
        const hb = r.stop?.harbour;
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
      ans('Patrol base / harbour', ST.harbour ? `${dist(ST.harbour.distM)} ${ST.harbour.dir}` : 'None found', ST.harbour ? ST.harbourWhy.slice(0, 2).join(' · ') : ST.harbourWhy[1] ?? '', ST.harbour ? 'go' : 'marg');
      fact('OP', ST.op ? where(ST.op) : 'none', ST.op ? ST.opWhy : 'needs a tower, roof or tree', ST.op ? undefined : 'warn');
      fact('Concealment here', LVL[H.cover.concealment ?? 0] ?? '—', undefined, H.cover.concealment !== null && H.cover.concealment >= 2 ? 'go' : 'slow');
    }
    return s;
  }

  // ── tiles ──────────────────────────────────────────────────────────────────

  private _tiles(br: PlatoonBrief): HTMLElement[] {
    const r = br.reading;
    const t = this._tab;
    if (t === 'patrol' && br.patrol) return this._patrolTiles(br);
    if (!r) return [];
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
    // The hero: the bubble radar (sight to true scale, the way out round the rim, every answer where it is).
    const radar = el('div', 'ms-pld-pic ms-row');
    const rWrap = el('div');
    rWrap.append(plRadar(r, { px: 230, sight: true, scale: true, label: 'Round you: sight, way out, water, dangers, casevac, help' }));
    radar.append(rWrap);
    const key = el('div', 'ms-pld-rkey');
    const k1 = el('span');
    k1.append(sw(STEP_COLOR.go, 0.5), 'seen ', sw('#ffb300', 0.7), 'screened ', sw(STEP_COLOR.nogo, 0.8), 'dead Gr');
    key.append(k1);
    const k2 = el('span');
    k2.append(arcSw(STEP_COLOR.go), 'rim: way out, foot / veh · log scale past the dashed ring');
    key.append(k2);
    const k3 = el('span', 'ms-pld-gl');
    for (const [gk, word] of RADAR_KEY) {
      const s = el('span');
      s.append(glyphIcon(gk, 13), word);
      k3.append(s);
    }
    key.append(k3);
    radar.append(key);
    out.push(tile('Round you', radar));
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
    out.push(tile(`What you see (${EYE_WORD[r.eye] ?? r.eye}, ${S.eyeM} m)`, fanSketch(S)));
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
    const pic = el('div', 'ms-pld-pic');
    pic.classList.add('ms-row');
    pic.append(spotsRose('Dangers round you', D.spots, r.radiusM, (s) => SCORE_COL(s.score ?? 0), `Rim = ${dist(r.radiusM)}`, (s) => dangerGlyph(s.kind)));
    const side = el('div');
    side.append(el('div', 'ms-pld-big', String(D.spots.length)), el('div', 'ms-pld-why', `on ${D.roadKm.toFixed(1)} km of Rds and Trs`));
    // The rose's shapes with their counts, worst kinds first.
    const legend = el('div', 'ms-pld-gl');
    legend.style.marginTop = '6px';
    const KINDS: Array<[string, keyof typeof GLYPH_COLOR, string]> = [['mine', 'mine', 'mine / IED'], ['ambush', 'ambush', 'ambush'], ['block', 'block', 'Rd block'], ['vp', 'vp', 'VP'], ['overlooked', 'overlook', 'overlooked']];
    for (const [k, gk, word] of KINDS) {
      const n = D.spots.filter((x) => x.kind === k || (k === 'overlooked' && x.kind === 'rooftops')).length;
      if (!n) continue;
      const s = el('span');
      s.append(glyphIcon(gk, 13), `${n} ${word}`);
      legend.append(s);
    }
    side.append(legend);
    pic.append(side);
    out.push(tile('On the Rds round you', pic));
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
    const ring = el('div');
    for (const x of P.rings) ring.append(pairs([[`Within ${x.km} km`, b(num(x.people))]]));
    out.push(tile('People (WorldPop 2026 est)', pairs([['Here', P.perKm2 !== null ? `~${num(P.perKm2)} per km²` : 'not known'], ['Within 500 m', P.within500 !== null ? b(`~${num(P.within500)}`) : 'not known']]), ring));
    if (P.ages) {
      const tot = P.ages.males15_49 + P.ages.under15 + P.ages.over65;
      const ring2 = P.rings.find((x) => x.km === 2)?.people ?? tot;
      const pc = (n: number) => Math.round((100 * n) / Math.max(1, ring2));
      out.push(tile('Ages within 2 km', stack([[STEP_COLOR.slow, pc(P.ages.males15_49), 'males 15-49'], [LEVEL_COLOR[2], pc(P.ages.under15), 'under 15'], ['#7f8893', pc(P.ages.over65), 'over 65']]), pairs([['Males 15-49', num(P.ages.males15_49)], ['Under 15', num(P.ages.under15)], ['Over 65', num(P.ages.over65)]])));
    }
    out.push(tile('BUA and Bldgs', pairs([['Nearest BUA', spotV(P.bua, { why: true })], P.bld ? ['Bldgs here', `${P.bld.density}, ${P.bld.size}${P.bld.tall ? ', tall' : ''}`] : ['Bldgs here', 'none recorded'], P.huts ? ['Huts', `~${P.huts.perKm2} permanent per km²${P.huts.temporary ? ', temporary huts nearby (nomads)' : ''}`] : null])));
    out.push(tile(`Sensitive sites within ${dist(r.radiusM)}`, P.sensitive.counts.length ? pairs(P.sensitive.counts.map((c) => [c.label, b(String(c.n))] as [string, Node])) : el('div', 'ms-pld-note', 'None recorded.'), P.sensitive.nearest.length ? spotList(P.sensitive.nearest, () => '#ab47bc', this._go) : null));
    if (P.crowd.length) out.push(tile('Crowd points', spotList(P.crowd, () => '#ffa726', this._go)));
    out.push(tile('Read this as', el('div', 'ms-pld-note', `WorldPop 2026 estimates, not a census. ${r.gaps.find((g) => /thinly/.test(g)) ?? ''}`)));
    return out;
  }

  private _helpTiles(r: PlReading): HTMLElement[] {
    const HP = r.help;
    const out: HTMLElement[] = [];
    const reach = Math.max(5000, ...HP.friends.map((f) => f.distM));
    const pic = el('div', 'ms-pld-pic');
    pic.append(spotsRose('Nearest help', HP.friends, reach, () => '#42a5f5', `Rim = ${dist(reach)}`));
    const side = el('div');
    side.append(HP.friends.length ? spotList(HP.friends, () => '#42a5f5', this._go) : el('div', 'ms-pld-note', 'None recorded within 30 km.'));
    pic.append(side);
    out.push(tile('Nearest help', pic));
    out.push(tile('Signals', pairs([['Relay / OP Gr', HP.relay ? spotV(HP.relay, { why: true }) : el('span', 'ms-pld-why', r.full ? 'no higher Gr within 3 km sees you' : 'rest the cursor')], ['Radio', HP.radioShadow ? el('b', undefined, 'Low Gr ringed by higher Gr: radio shadow likely') : 'no shadow found']])));
    if (HP.supply.length) out.push(tile('Supply', spotList(HP.supply, () => '#9aa3ad', this._go)));
    return out;
  }

  private _stopTiles(r: PlReading): HTMLElement[] {
    const ST = r.stop!;
    const out: HTMLElement[] = [];
    const rows = el('div');
    for (const w of ST.harbourWhy) rows.append(el('div', 'ms-pld-li', `• ${w}`));
    out.push(tile('Patrol base / harbour', ST.harbour ? pairs([['Site', spotV(ST.harbour)]]) : null, rows));
    out.push(tile('OP', ST.op ? pairs([['Site', spotV(ST.op)]]) : null, el('div', 'ms-pld-note', ST.opWhy)));
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
