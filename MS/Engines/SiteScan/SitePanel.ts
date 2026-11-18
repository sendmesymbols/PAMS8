/**
 * SitePanel.ts
 *
 * The panel a site finder docks at the foot of the map (Gun Deployment on the left, Admin Area on the right). The
 * answer comes first (PRODUCT.md: verdict, then reason, then evidence):
 *
 *   title bar   the name, fold (the answer stays in the bar) and close;
 *   answer      one line with its verdict icon: what was found, or what to do next;
 *   setup       the places it works from (search circle, target, threat), each with its Pick button, and the settings
 *               as labelled fields; folds to one line once the search is set up;
 *   actions     pick / why not on the left, the outputs on the right;
 *   sites       the ranked sites, one line each with its verdict in words and how many checks pass (arrow keys move);
 *   checks      the selected site's rows: verdict icon, value, why, fix, and the rules folded under it.
 *
 * One delegated listener; the host owns every state and is asked again on render. Colours, type sizes (nothing under
 * 12 px) and verdict icons from GroundGuideTokens: a verdict is never carried by colour alone. Esc closes it (the host
 * binds the key).
 */

import Utils from '../../Support/utils';
import { ensureTokensCss, ladderIconMarkup, SURFACE, type LadderIcon } from '../GroundGuide/GroundGuideTokens';
import { basisLabel, type RuleRef, type Tone } from './SiteScan';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));

export interface PanelControl {
  key: string;
  label: string;
  type: 'select' | 'number';
  value: string | number;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  title?: string;
  /** A field with long values (a gun's name): takes a wider share of the row. */
  wide?: boolean;
}
export interface PanelAction {
  id: string;
  label: string;
  title?: string;
  primary?: boolean;
  disabled?: boolean;
  /** An output (Create on Map, Copy as Text): grouped at the right of the bar. */
  output?: boolean;
  /** Being used now (a map pick under way): drawn pressed. */
  on?: boolean;
}
export interface PanelPlace {
  label: string;
  value: string;
  /** False when nothing is set yet: the value is drawn as a remark, not as a place. */
  set?: boolean;
  /** Buttons beside it: action ids with labels. */
  buttons: Array<{ id: string; label: string; title?: string; on?: boolean }>;
}
export interface PanelRow {
  label: string;
  value: string;
  tone: Tone;
  why: string;
  fix?: string;
  /** The rules the check applied (book, page, words; or the proposal and why). */
  rules?: RuleRef[];
}
export interface PanelSite {
  rank: number;
  grid: string;
  verdict: string;
  tone: Tone;
  score: number;
  rows: PanelRow[];
  /** Why it stands where it does in the list. */
  why?: string[];
  /** The ordering method behind that (proposals). */
  whyRules?: RuleRef[];
}
/** A reason with the rules behind it (a place left out, a gate failed). */
export interface PanelReason {
  text: string;
  rules: RuleRef[];
}
/** "Why not here?": a place the user picked, read with the same checks. */
export interface PanelWhyNot {
  grid: string;
  verdict: string;
  tone: Tone;
  gates: PanelReason[];
  vsBest: string[];
  rows: PanelRow[];
  /** The action that takes the reading off again (a small button in its heading). */
  clearAct?: string;
}
export interface SitePanelHost {
  controls(): PanelControl[];
  setControl(key: string, value: string): void;
  places(): PanelPlace[];
  actions(): PanelAction[];
  act(id: string): void;
  headline(): { tone: Tone | 'idle'; text: string };
  sites(): PanelSite[];
  selected(): number;
  select(i: number): void;
  notes(): string[];
  footer(): string;
  close(): void;
  /** Places left out of the list, by reason, with the rules (optional). */
  leftOut?(): PanelReason[];
  /** The "Why not here?" reading, when one was asked for (optional). */
  whyNot?(): PanelWhyNot | null;
  /** The setup in one line, shown when the setup is folded ("155 mm How · Bty · Def · 4 km · Nov"). */
  summary?(): string;
  /** What to do, in order, shown while there is nothing to list yet. */
  guide?(): string[];
  /** True once the search is set up: the setup then folds to its one-line summary (open again when it turns false). */
  setupDone?(): boolean;
  /** The action that takes every picked place and the result off (a small button in the setup). */
  clearAct?(): { id: string; label: string; title?: string; disabled?: boolean } | null;
}

const TONE_HEX: Record<Tone, string> = { ok: '#2fa862', warn: '#ee8a1f', bad: '#e5484d', unknown: '#9aa3ad' };
/** A verdict written on the dark card. */
const TONE_TEXT: Record<Tone, string> = { ok: '#74dca3', warn: '#ffb46b', bad: '#ff8a8d', unknown: '#c3cbd3' };
const TONE_ICON: Record<Tone, LadderIcon> = { ok: 'check', warn: 'tri', bad: 'octx', unknown: 'dots' };
const TONE_WORD: Record<Tone, string> = { ok: 'Passes', warn: 'Needs work', bad: 'Fails', unknown: 'Not read' };

/** A verdict's icon (tick, triangle, crossed octagon, dots) with its word for screen readers and on hover. */
export function toneIconHtml(tone: Tone, size = 16): string {
  return `<svg class="ms-sf-ic" width="${size}" height="${size}" viewBox="0 0 20 20" role="img" aria-label="${TONE_WORD[tone]}"><title>${TONE_WORD[tone]}</title>${ladderIconMarkup(TONE_ICON[tone], SURFACE.card, TONE_HEX[tone])}</svg>`;
}

/** "7 of 9 checks pass · 2 need work": how a site's rows came out. */
export function tallyOf(rows: Array<{ tone: Tone }>): string {
  const c: Record<Tone, number> = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  for (const r of rows) c[r.tone]++;
  const out = [`${c.ok} of ${rows.length} checks pass`];
  if (c.bad) out.push(`${c.bad} fail${c.bad === 1 ? 's' : ''}`);
  if (c.warn) out.push(`${c.warn} need${c.warn === 1 ? 's' : ''} work`);
  if (c.unknown) out.push(`${c.unknown} not read`);
  return out.join(' · ');
}

/** One rule as HTML: where (book, page), the words, whether they were checked in the book. */
export function ruleHtml(r: RuleRef): string {
  const chk =
    r.checked === 'ok'
      ? '<span class="ms-rc ok" title="These words were found on this page of the book (tools/doctrine-refs/verify.py)">✓ checked</span>'
      : r.checked === 'page?'
        ? '<span class="ms-rc warn" title="The words were found, but on another page: confirm the page">page?</span>'
        : r.checked === 'unchecked'
          ? '<span class="ms-rc" title="An online source: not checked against a local copy">online</span>'
          : r.checked === 'orbat'
            ? '<span class="ms-rc" title="From the ORBAT data (weapons.json), read from this page of the handbook; checked by tools/orbat-test">ORBAT</span>'
            : '';
  if (!r.book)
    return `<li class="ms-r-e"><b>${esc(r.figure)}</b>: <span class="ms-rb ${esc(r.basis.toLowerCase())}">${esc(basisLabel(r))}</span>${r.note ? ` ${esc(r.note)}` : ''}${r.searched ? ` <span class="ms-r-s">Looked for in: ${esc(r.searched)}.</span>` : ''}${r.decided ? ` <span class="ms-r-s">Decided ${esc(r.decided)}.</span>` : ''}</li>`;
  if (r.role === 'data') return `<li><span class="ms-rb d" title="The data this value was read from">data</span> <b>${esc(r.figure)}</b>: ${esc(r.book)}${r.quote ? `: ${esc(r.quote)}` : ''}</li>`;
  const tag = r.role === 'context' ? '<span class="ms-rb c">context</span>' : `<span class="ms-rb ${esc(r.basis.toLowerCase())}">${esc(r.basis)}</span>`;
  return `<li>${tag} <b>${esc(r.figure)}</b>: ${esc(r.book)}${r.page ? ` <b>p ${esc(r.page)}</b>` : ''}${r.quote ? ` <q>${esc(r.quote)}</q>` : ''} ${chk}${r.calc ? ` <span class="ms-r-s">Worked out: ${esc(r.calc)}</span>` : ''}${r.note ? ` <span class="ms-r-s">${esc(r.note)}</span>` : ''}</li>`;
}

/** A folded list of rules: the summary names book and page of each; open it for the words. */
export function rulesHtml(rules: RuleRef[] | undefined, key: string): string {
  if (!rules?.length) return '';
  const seen = new Set<string>();
  const where: string[] = [];
  for (const r of rules) {
    const w = r.role === 'data' ? `data: ${r.book.split(' - ')[0]}` : r.book ? `${r.book.replace("SO's Hbk 2019, ", 'SOH ')}${r.page ? ` p ${r.page}` : ''}` : r.basis === 'E' ? (r.decided ? 'decision' : 'proposal') : r.basis === 'M' ? 'method' : r.basis;
    if (!seen.has(w)) {
      seen.add(w);
      where.push(w);
    }
  }
  return `<details class="ms-sf-rules" data-k="${esc(key)}"><summary title="The rules and data behind this: open for the book, page and words">📖 ${esc(where.join(' · '))}</summary><ul>${rules.map(ruleHtml).join('')}</ul></details>`;
}

/** A check row: verdict icon, label and value on one line; under them the reason, the fix and the folded rules. */
function rowHtml(r: PanelRow, key: string, withFix = true): string {
  return (
    `<div class="ms-sf-row" data-tone="${r.tone}">${toneIconHtml(r.tone)}<span class="ms-sf-rl">${esc(r.label)}</span><span class="ms-sf-rv">${esc(r.value)}</span>` +
    `<span class="ms-sf-why">${esc(r.why)}</span>${withFix && r.fix ? `<span class="ms-sf-fix"><b>Fix</b> ${esc(r.fix)}</span>` : ''}${rulesHtml(r.rules, key)}</div>`
  );
}

const CSS = `
.ms-sf{position:fixed;bottom:10px;z-index:2147482805;width:min(500px,calc(100vw - 20px));max-height:calc(100vh - 150px);display:none;flex-direction:column;
 background:var(--gg-card);color:var(--gg-text);border:1px solid var(--gg-hair);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.5);font:400 13.5px/1.4 system-ui,Segoe UI,Arial,sans-serif}
.ms-sf.ms-open{display:flex}
.ms-sf.ms-left{left:10px}.ms-sf.ms-right{right:10px}
.ms-sf.ms-front{z-index:2147482806}
.ms-sf *{box-sizing:border-box}
.ms-sf-h{flex:none;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;background:var(--gg-head);border-radius:9px 9px 0 0}
.ms-sf.ms-folded .ms-sf-h{border-radius:9px}
.ms-sf-t{font-weight:750;font-size:13.5px;color:var(--gg-strong);white-space:nowrap}
.ms-sf-sub{flex:1;min-width:0;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;visibility:hidden}
.ms-sf.ms-folded .ms-sf-sub{visibility:visible}
.ms-sf-main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.ms-sf.ms-folded .ms-sf-main{display:none}
.ms-sf-btn{font:600 13.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:var(--gg-text);background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.22);border-radius:6px;cursor:pointer;height:30px;padding:0 9px;white-space:nowrap}
.ms-sf-btn:hover{background:rgba(255,255,255,.15);color:var(--gg-strong)}
.ms-sf-btn:focus-visible,.ms-sf summary:focus-visible,.ms-sf-site:focus-visible{outline:2px solid var(--gg-accent);outline-offset:1px}
.ms-sf-btn.ms-pri{background:#2b5d86;border-color:#5b96c4;color:#fff}
.ms-sf-btn.ms-pri:hover{background:#336c9b}
.ms-sf-btn.ms-on{background:#e4e8ec;color:#14181d;border-color:#e4e8ec}
.ms-sf-btn[disabled]{color:#8b949e;background:transparent;border-color:rgba(255,255,255,.12);cursor:default}
.ms-sf-btn.ms-x{width:30px;padding:0;font-size:17px;font-weight:400}
.ms-sf-btn.ms-sm{height:26px;padding:0 8px;font-size:12px}
.ms-sf-ans{flex:none;display:flex;align-items:flex-start;gap:8px;padding:9px 12px;font-weight:750;font-size:15.5px;line-height:1.3;border-bottom:1px solid var(--gg-hair)}
.ms-sf-ans .ms-sf-ic{flex:none;margin-top:1px}
.ms-sf-ans[data-tone="ok"]{color:${TONE_TEXT.ok}}.ms-sf-ans[data-tone="warn"]{color:${TONE_TEXT.warn}}.ms-sf-ans[data-tone="bad"]{color:${TONE_TEXT.bad}}.ms-sf-ans[data-tone="unknown"]{color:${TONE_TEXT.unknown}}.ms-sf-ans[data-tone="idle"]{color:var(--gg-text)}
.ms-sf-setup{flex:none;background:var(--gg-strip);border-bottom:1px solid var(--gg-hair)}
.ms-sf-setup>summary{display:flex;align-items:baseline;gap:8px;padding:5px 12px;cursor:pointer;list-style:none;font-size:12px;color:var(--gg-label)}
.ms-sf-setup>summary::-webkit-details-marker{display:none}
.ms-sf-setup>summary::before{content:"▸";flex:none;width:10px;color:var(--gg-label)}
.ms-sf-setup[open]>summary::before{content:"▾"}
.ms-sf-setup>summary b{flex:none;font-weight:600;font-size:13.5px;color:var(--gg-text)}
.ms-sf-su-s{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-sf-setup[open] .ms-sf-su-s{visibility:hidden}
.ms-sf-places{padding:2px 12px 6px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:5px 10px;align-items:center}
.ms-sf-places .k{color:var(--gg-label);font-size:12px}
.ms-sf-places .v{color:var(--gg-text);font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-sf-places .v.ms-unset{font-weight:400;color:var(--gg-label)}
.ms-sf-places .b{display:flex;gap:4px;justify-content:flex-end}
.ms-sf-strip{display:flex;flex-wrap:wrap;gap:6px 10px;padding:6px 12px 9px;border-top:1px solid var(--gg-hair-soft)}
.ms-sf-fld{display:flex;flex-direction:column;gap:2px;flex:1 1 84px;min-width:0;font-size:12px;color:var(--gg-label)}
.ms-sf-fld.ms-wide{flex:3 1 190px}
.ms-sf-fld>span{white-space:nowrap}
.ms-sf-fld>div{display:flex;align-items:center;gap:5px;min-width:0}
.ms-sf select,.ms-sf input{font:600 13.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:var(--gg-text);background:#11151a;border:1px solid #4a5560;border-radius:5px;padding:2px 5px;height:28px;width:100%;min-width:0}
.ms-sf input{text-align:right}
.ms-sf select:focus-visible,.ms-sf input:focus-visible{outline:2px solid var(--gg-accent);outline-offset:0;border-color:var(--gg-accent)}
.ms-sf-acts{flex:none;display:flex;flex-wrap:wrap;gap:6px;padding:7px 12px;border-bottom:1px solid var(--gg-hair)}
.ms-sf-acts .ms-gap{flex:1 1 0;min-width:0}
.ms-sf-body{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;padding:4px 0 8px;overflow-wrap:anywhere}
.ms-sf-list{list-style:none;margin:0;padding:0}
.ms-sf-site{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:0 9px;align-items:center;padding:5px 12px 5px 9px;cursor:pointer;border-left:3px solid transparent}
.ms-sf-site:hover{background:rgba(255,255,255,.05)}
.ms-sf-site.ms-sel{background:rgba(142,193,234,.13);border-left-color:var(--gg-accent)}
.ms-sf-rk{grid-row:1 / span 2;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:750;font-size:12px;color:#14181d}
.ms-sf-g{font-weight:600;font-variant-numeric:tabular-nums;color:var(--gg-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-sf-vd{display:inline-flex;align-items:center;gap:5px;font-weight:600;white-space:nowrap;max-width:250px;overflow:hidden;text-overflow:ellipsis}
.ms-sf-vd .ms-sf-ic{flex:none}
.ms-sf-tl{grid-column:2 / -1;font-size:12px;color:var(--gg-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-sf-sec{margin:8px 12px 0;padding-top:7px;border-top:1px solid var(--gg-hair)}
.ms-sf-sec h5{display:flex;align-items:baseline;gap:8px;margin:0 0 4px;font-size:13.5px;font-weight:750;color:var(--gg-strong)}
.ms-sf-sec h5 small{flex:1;min-width:0;font-size:12px;font-weight:400;color:var(--gg-label)}
.ms-sf-sec p,.ms-sf-sec li{margin:3px 0;color:var(--gg-text)}
.ms-sf-sec ul,.ms-sf-sec ol{margin:0;padding-left:18px}
.ms-sf-sec.ms-quiet p,.ms-sf-sec.ms-quiet li{font-size:12px;color:var(--gg-label)}
.ms-sf-row{display:grid;grid-template-columns:16px 116px minmax(0,1fr);gap:1px 8px;align-items:start;padding:5px 0;border-bottom:1px solid var(--gg-hair-soft)}
.ms-sf-row:last-child{border-bottom:0}
.ms-sf-row>.ms-sf-ic{margin-top:2px}
.ms-sf-rl{color:var(--gg-label)}
.ms-sf-rv{color:var(--gg-strong);font-weight:600}
.ms-sf-why,.ms-sf-fix,.ms-sf-row>.ms-sf-rules{grid-column:2 / -1;min-width:0}
.ms-sf-why{font-size:12px;color:var(--gg-label)}
.ms-sf-fix{font-size:12px;color:var(--gg-warn)}
.ms-sf-fix b{font-weight:750}
.ms-sf-rules{font-size:12px;color:var(--gg-label);margin-top:1px;min-width:0}
.ms-sf-rules summary{cursor:pointer;color:var(--gg-accent);list-style:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-sf-rules summary::-webkit-details-marker{display:none}
.ms-sf-rules[open] summary{white-space:normal}
.ms-sf-rules ul{margin:3px 0 2px;padding-left:16px}
.ms-sf-rules li{margin:3px 0;font-size:12px;color:var(--gg-text)}
.ms-sf-rules q{color:var(--gg-strong);font-style:italic}
.ms-rb{display:inline-block;min-width:16px;padding:0 5px;border-radius:6px;font-size:12px;font-weight:700;text-align:center;background:rgba(255,255,255,.12);color:#e4e8ec}
.ms-rb.r{background:rgba(47,168,98,.3);color:#a6ebc4}.ms-rb.u,.ms-rb.s{background:rgba(77,166,255,.28);color:#bcdcff}.ms-rb.e{background:rgba(238,138,31,.3);color:#ffd09a}.ms-rb.c{background:rgba(255,255,255,.08);color:#c3cbd3}.ms-rb.d,.ms-rb.t{background:rgba(167,139,250,.25);color:#d9ccff}.ms-rb.m{background:rgba(144,164,174,.28);color:#d5dee3}
.ms-r-s{color:var(--gg-soft)}
.ms-rc{display:inline-block;padding:0 5px;border-radius:6px;font-size:12px;background:rgba(255,255,255,.08);color:#c3cbd3}
.ms-rc.ok{background:rgba(47,168,98,.25);color:#a6ebc4}.ms-rc.warn{background:rgba(238,138,31,.25);color:#ffd09a}
.ms-sf-reason{margin:4px 0}
.ms-sf-foot{flex:none;padding:5px 12px 6px;font-size:12px;color:var(--gg-label);border-top:1px solid var(--gg-hair-soft)}
@media (max-width:560px){.ms-sf{width:calc(100vw - 12px);bottom:6px}.ms-sf.ms-left{left:6px}.ms-sf.ms-right{right:6px}.ms-sf-row{grid-template-columns:16px 92px minmax(0,1fr)}.ms-sf-vd{max-width:150px}}
`;

type PartKey = 'ans' | 'sum' | 'places' | 'strip' | 'acts' | 'body' | 'foot';

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-site-panel-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** The panels now open, so the one last used can be brought in front of the other on a narrow screen. */
const openPanels = new Set<SitePanel>();

export class SitePanel {
  private _el: HTMLElement | null = null;
  private _open = false;
  private _folded = false;
  private _host: SitePanelHost;
  private _title: string;
  private _side: 'left' | 'right';
  private _id: string;
  private _parts: Record<PartKey, HTMLElement> | null = null;
  private _sub: HTMLElement | null = null;
  private _foldBtn: HTMLElement | null = null;
  private _last: Record<string, string> = {};
  private _onResize: (() => void) | null = null;
  /** The last `setupDone` seen: the setup folds or opens only when it changes, so the user's own fold is kept. */
  private _setupWas: boolean | null = null;

  constructor(id: string, title: string, side: 'left' | 'right', host: SitePanelHost) {
    this._id = id;
    this._title = title;
    this._side = side;
    this._host = host;
  }

  get isOpen(): boolean {
    return this._open;
  }
  /** Folded to its title bar (the answer stays in the bar; the map drawings stay on). */
  get isFolded(): boolean {
    return this._folded;
  }

  open(): void {
    ensureCss();
    if (!this._el) this._build();
    this._open = true;
    fitBelowBar(this._el!);
    this._el!.classList.add('ms-open');
    this._front();
    if (!this._onResize) {
      // the host's top bar wraps to more rows on a narrower window: keep clear of it
      this._onResize = () => {
        if (this._open && this._el) fitBelowBar(this._el);
      };
      window.addEventListener('resize', this._onResize);
    }
    this.render();
  }

  close(): void {
    this._open = false;
    this._el?.classList.remove('ms-open');
    openPanels.delete(this);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onResize = null;
  }

  /** Fold to the title bar, or open out again. */
  fold(on = !this._folded): void {
    this._folded = on;
    this._el?.classList.toggle('ms-folded', on);
    if (this._foldBtn) {
      this._foldBtn.textContent = on ? '▴' : '▾';
      this._foldBtn.title = on ? 'Open the panel out' : 'Fold the panel to its title bar (the drawings stay on the map)';
      this._foldBtn.setAttribute('aria-label', on ? 'Open the panel out' : 'Fold the panel');
      this._foldBtn.setAttribute('aria-expanded', String(!on));
    }
    if (!on) this.render();
  }

  destroy(): void {
    this.close();
    this._el?.remove();
    this._el = null;
    this._parts = null;
    this._sub = null;
    this._foldBtn = null;
    this._last = {};
    this._setupWas = null;
  }

  /** In front of any other site panel (they overlap on a narrow screen). */
  private _front(): void {
    openPanels.add(this);
    for (const p of openPanels) p._el?.classList.toggle('ms-front', p === this);
  }

  private _build(): void {
    const el = document.createElement('section');
    el.id = this._id;
    el.className = `ms-sf ms-${this._side}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', this._title);
    el.innerHTML =
      `<header class="ms-sf-h"><span class="ms-sf-t">${esc(this._title)}</span><span class="ms-sf-sub"></span>` +
      `<button type="button" class="ms-sf-btn ms-x" data-act="__fold"></button>` +
      `<button type="button" class="ms-sf-btn ms-x" data-act="__close" aria-label="Close" title="Close (Esc): the drawings stay on the map; the top-bar button opens the panel again">×</button></header>` +
      `<div class="ms-sf-main"><div class="ms-sf-ans" role="status"></div>` +
      `<details class="ms-sf-setup" open><summary><b>Setup</b><span class="ms-sf-su-s"></span></summary><div class="ms-sf-places"></div><div class="ms-sf-strip"></div></details>` +
      `<div class="ms-sf-acts"></div><div class="ms-sf-body"></div><div class="ms-sf-foot"></div></div>`;
    const q = (c: string) => el.querySelector(`.${c}`) as HTMLElement;
    this._parts = { ans: q('ms-sf-ans'), sum: q('ms-sf-su-s'), places: q('ms-sf-places'), strip: q('ms-sf-strip'), acts: q('ms-sf-acts'), body: q('ms-sf-body'), foot: q('ms-sf-foot') };
    this._sub = q('ms-sf-sub');
    this._foldBtn = el.querySelector('[data-act="__fold"]') as HTMLElement;
    this._last = {};
    el.addEventListener('pointerdown', () => this._front());
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act],[data-site]') as HTMLElement | null;
      if (!t || !el.contains(t)) return;
      if (t.dataset.act === '__close') this._host.close();
      else if (t.dataset.act === '__fold') this.fold();
      else if (t.dataset.act) this._host.act(t.dataset.act);
      else if (t.dataset.site) this._host.select(Number(t.dataset.site));
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const key = t.dataset?.ctl;
      if (key) this._host.setControl(key, t.value);
    });
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      // keys typed into the panel's fields stay there (no map shortcuts)
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') {
        e.stopPropagation();
        return;
      }
      // the list of sites: arrows move the choice, Home / End jump, Enter and Space choose
      const li = t.closest?.('.ms-sf-site') as HTMLElement | null;
      if (!li) return;
      const n = this._host.sites().length;
      const i = Number(li.dataset.site);
      const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'Enter' || e.key === ' ' ? i : -1;
      if (to < 0 || to >= n) return;
      e.preventDefault();
      e.stopPropagation();
      this._host.select(to);
    });
    document.body.appendChild(el);
    this._el = el;
    this.fold(this._folded);
  }

  render(): void {
    if (!this._open || !this._el || !this._parts) return;
    const h = this._host;
    const hl = h.headline();
    // the answer also rides in the title bar, so a folded panel still says what was found
    if (this._sub) {
      this._sub.textContent = hl.text;
      this._sub.style.color = hl.tone === 'idle' ? 'var(--gg-label)' : TONE_TEXT[hl.tone];
    }
    if (this._folded) return;
    const done = !!h.setupDone?.();
    if (done !== this._setupWas) {
      this._setupWas = done;
      const d = this._el.querySelector('.ms-sf-setup') as HTMLDetailsElement | null;
      if (d) d.open = !done;
    }
    const ctl = h
      .controls()
      .map((c) => {
        const t = c.title ? ` title="${esc(c.title)}"` : '';
        const field =
          c.type === 'select'
            ? `<select data-ctl="${esc(c.key)}">${(c.options ?? []).map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(c.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
            : `<input type="number" data-ctl="${esc(c.key)}" value="${esc(c.value)}"${c.min !== undefined ? ` min="${c.min}"` : ''}${c.max !== undefined ? ` max="${c.max}"` : ''}${c.step !== undefined ? ` step="${c.step}"` : ''}>${c.unit ? `<span>${esc(c.unit)}</span>` : ''}`;
        return `<label class="ms-sf-fld${c.wide ? ' ms-wide' : ''}"${t}><span>${esc(c.label)}</span><div>${field}</div></label>`;
      })
      .join('');
    const clear = h.clearAct?.() ?? null;
    const placeList = h.places();
    const places = placeList
      .map((p, i) => {
        const btns = [
          ...p.buttons.map((b) => `<button type="button" class="ms-sf-btn ms-sm${b.on ? ' ms-on' : ''}" data-act="${esc(b.id)}"${b.on ? ' aria-pressed="true"' : ''}${b.title ? ` title="${esc(b.title)}"` : ''}>${esc(b.label)}</button>`),
          // the "clear everything" button sits on the last line, where there is room
          ...(clear && i === placeList.length - 1 ? [`<button type="button" class="ms-sf-btn ms-sm" data-act="${esc(clear.id)}"${clear.disabled ? ' disabled' : ''}${clear.title ? ` title="${esc(clear.title)}"` : ''}>${esc(clear.label)}</button>`] : []),
        ];
        return `<span class="k">${esc(p.label)}</span><span class="v${p.set === false ? ' ms-unset' : ''}" title="${esc(p.value)}">${esc(p.value)}</span><span class="b">${btns.join('')}</span>`;
      })
      .join('');
    const actBtn = (a: PanelAction) =>
      `<button type="button" class="ms-sf-btn${a.primary ? ' ms-pri' : ''}${a.on ? ' ms-on' : ''}" data-act="${esc(a.id)}"${a.on ? ' aria-pressed="true"' : ''}${a.disabled ? ' disabled' : ''}${a.title ? ` title="${esc(a.title)}"` : ''}>${esc(a.label)}</button>`;
    const actList = h.actions();
    const acts = `${actList.filter((a) => !a.output).map(actBtn).join('')}<span class="ms-gap"></span>${actList.filter((a) => a.output).map(actBtn).join('')}`;
    const sites = h.sites();
    const sel = h.selected();
    const list = sites.length
      ? `<ul class="ms-sf-list" role="listbox" aria-label="Sites, best first">${sites
          .map(
            (s, i) =>
              `<li class="ms-sf-site${i === sel ? ' ms-sel' : ''}" data-site="${i}" role="option" aria-selected="${i === sel}" tabindex="${i === sel ? 0 : -1}" title="Show site ${s.rank} on the map and its checks below">` +
              `<span class="ms-sf-rk" style="background:${TONE_HEX[s.tone]}">${s.rank}</span><span class="ms-sf-g">${esc(s.grid)}</span>` +
              `<span class="ms-sf-vd" style="color:${TONE_TEXT[s.tone]}">${toneIconHtml(s.tone, 14)}${esc(s.verdict)}</span>` +
              `<span class="ms-sf-tl">${esc(tallyOf(s.rows))}</span></li>`,
          )
          .join('')}</ul>`
      : '';
    const cur = sites[sel];
    const rows = cur ? `<div class="ms-sf-sec"><h5>Checks at site ${cur.rank}<small>${esc(cur.grid)}</small></h5>${cur.rows.map((r) => rowHtml(r, `s${cur.rank}:${r.label}`)).join('')}</div>` : '';
    // why this one stands where it does in the list
    const order = cur?.why?.length ? `<div class="ms-sf-sec"><h5>Why site ${cur.rank} is ${cur.rank === 1 ? 'first' : 'here'}</h5>${cur.why.map((w) => `<p>${esc(w)}</p>`).join('')}${rulesHtml(cur.whyRules, 'order')}</div>` : '';
    // "Why not here?": the gates it failed (with their rules), where #1 is better, and its own rows
    const wn = h.whyNot?.() ?? null;
    const whyNot = wn
      ? `<div class="ms-sf-sec"><h5>Why not ${esc(wn.grid)}?<small></small>${wn.clearAct ? `<button type="button" class="ms-sf-btn ms-sm" data-act="${esc(wn.clearAct)}" title="Take this reading off">Clear</button>` : ''}</h5>` +
        `<p style="color:${TONE_TEXT[wn.tone]};font-weight:600">${esc(wn.verdict)}</p>` +
        wn.gates.map((g, i) => `<div class="ms-sf-reason">• ${esc(g.text)}${rulesHtml(g.rules, `wg${i}`)}</div>`).join('') +
        (wn.vsBest.length ? `<ul>${wn.vsBest.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : '') +
        (wn.rows.length ? `<details class="ms-sf-rules" data-k="wnrows" style="margin-top:4px"><summary>Every check at this place (${wn.rows.length})</summary>${wn.rows.map((r) => rowHtml(r, `wn:${r.label}`, false)).join('')}</details>` : '') +
        `</div>`
      : '';
    // places left out of the list, by reason
    const left = h.leftOut?.() ?? [];
    const leftOut = left.length ? `<div class="ms-sf-sec"><h5>Places left out</h5>${left.map((g, i) => `<div class="ms-sf-reason">• ${esc(g.text)}${rulesHtml(g.rules, `lo${i}`)}</div>`).join('')}</div>` : '';
    const noteList = h.notes();
    const notes = noteList.length ? `<div class="ms-sf-sec ms-quiet"><h5>Notes</h5><ul>${noteList.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '';
    // nothing to list yet: what to do, in order
    const steps = !sites.length && !wn ? (h.guide?.() ?? []) : [];
    const guide = steps.length ? `<div class="ms-sf-sec" style="border-top:0;margin-top:2px"><h5>How to use</h5><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : '';
    const foot = h.footer();
    // only the parts whose content changed are rewritten: a select or number box being used keeps its focus
    const set = (k: PartKey, html: string) => {
      const p = this._parts![k];
      if (this._last[k] === html) return;
      this._last[k] = html;
      // folded rule lists that were open stay open when the part is rewritten (tiles arriving, a new reading)
      const open = new Set([...p.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset.k ?? ''));
      const scroll = p.scrollTop;
      // the keyboard's place in the list of sites is kept through the rewrite
      const inList = k === 'body' && p.contains(document.activeElement) && !!(document.activeElement as HTMLElement | null)?.closest?.('.ms-sf-site');
      p.innerHTML = html;
      for (const d of p.querySelectorAll('details')) if (open.has((d as HTMLElement).dataset.k ?? '')) (d as HTMLDetailsElement).open = true;
      p.scrollTop = scroll;
      if (inList) (p.querySelector('.ms-sf-site.ms-sel') as HTMLElement | null)?.focus({ preventScroll: true });
      if (k !== 'sum') p.style.display = html ? '' : 'none';
    };
    this._parts.ans.dataset.tone = hl.tone;
    set('ans', `${hl.tone === 'idle' ? '' : toneIconHtml(hl.tone, 18)}<span>${esc(hl.text)}</span>`);
    set('sum', esc(h.summary?.() ?? ''));
    set('places', places);
    set('strip', ctl);
    set('acts', acts);
    set('body', `${guide}${list}${whyNot}${rows}${order}${leftOut}${notes}`);
    set('foot', foot ? esc(foot) : '');
  }
}

/**
 * Dock a top-anchored panel just below the host's top bar (`#infoDiv` in the harness; it wraps to more rows on a
 * narrow window), else 118 px down, and keep it on the screen.
 */
export function dockBelowBar(el: HTMLElement, o: { clearFoot?: boolean } = {}): void {
  if (typeof document === 'undefined') return;
  const top = Math.round(Math.max(10, barBottom(118)));
  el.style.top = `${top}px`;
  // `clearFoot`: stop above a panel docked at the foot that lies under this one (the caller fits again on DOCK_EVENT)
  let floor = Infinity;
  if (o.clearFoot) {
    const r = el.getBoundingClientRect();
    for (const f of document.querySelectorAll<HTMLElement>('[data-ms-dock="foot"]')) {
      if (f === el) continue;
      const fr = f.getBoundingClientRect();
      if (fr.width <= 0 || fr.height <= 0 || fr.right <= r.left || fr.left >= r.right) continue;
      floor = Math.min(floor, fr.top - 8);
    }
  }
  el.style.maxHeight = Number.isFinite(floor) ? `${Math.max(150, Math.round(floor - top))}px` : `calc(100vh - ${top + 10}px)`;
}

/** Keep a bottom-anchored panel from running up under the host's top bar; `capVh` also holds it to that share of the window. */
export function fitBelowBar(el: HTMLElement, capVh = 0): void {
  if (typeof document === 'undefined') return;
  const room = `calc(100vh - ${Math.round(barBottom(140) + 10)}px)`;
  el.style.maxHeight = capVh > 0 ? `min(${room}, ${capVh}vh)` : room;
}

/** Where the host's top bar ends (plus a gap), else `fallback` px down. */
function barBottom(fallback: number): number {
  const b = document.getElementById('infoDiv')?.getBoundingClientRect();
  return b && b.height > 0 && b.bottom < window.innerHeight * 0.6 ? b.bottom + 8 : fallback;
}

/** Raised on `window` when a panel docked at the foot opens, closes or changes size, so a panel above it can make room. */
export const DOCK_EVENT = 'ms-dock-change';

/** Mark a panel as docked at the foot and report its size changes (DOCK_EVENT). Returns the undo. */
export function watchFootDock(el: HTMLElement): () => void {
  el.dataset.msDock = 'foot';
  if (typeof ResizeObserver === 'undefined' || typeof window === 'undefined') return () => {};
  const ro = new ResizeObserver(() => window.dispatchEvent(new Event(DOCK_EVENT)));
  ro.observe(el);
  return () => ro.disconnect();
}

const hintTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** The status pill at the top of the map ("Click where the guns should go"); null takes it off. */
export function siteHint(id: string, icon: string, text: string | null, ms = 0): void {
  if (typeof document === 'undefined') return;
  const t = hintTimers.get(id);
  if (t) clearTimeout(t);
  hintTimers.delete(id);
  let h = document.getElementById(id);
  if (!text) {
    h?.remove();
    return;
  }
  if (!h) {
    h = document.createElement('div');
    h.id = id;
    h.setAttribute('role', 'status');
    h.style.cssText =
      'position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:2147482995;pointer-events:none;padding:7px 14px;border-radius:999px;max-width:calc(100vw - 24px);' +
      'background:rgba(20,24,29,.92);border:1px solid #8ec1ea;color:#f1f3f6;font:600 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    document.body.appendChild(h);
  }
  // below the host's top bar, however many rows it has wrapped to (a fixed 96 px sat on the bar's own buttons)
  const bar = document.getElementById('infoDiv')?.getBoundingClientRect();
  h.style.top = `${Math.round(bar && bar.height > 0 && bar.bottom < window.innerHeight * 0.6 ? bar.bottom + 10 : 96)}px`;
  h.textContent = `${icon} ${text}`;
  if (ms > 0) hintTimers.set(id, setTimeout(() => siteHint(id, icon, null), ms));
}

/**
 * Put text on the clipboard. The Clipboard API only exists on a secure page (https or localhost); a host served over
 * plain http on a LAN address has none, so the old selection copy is the fallback there. False when both refuse.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* not allowed here: try the selection copy */
  }
  const ta = document.createElement('textarea');
  try {
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

export default SitePanel;
