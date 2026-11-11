/**
 * NightMarchChartView.ts
 *
 * The Night March chart docked at the foot of the map, built like the Ground Detail / Pl Detail (user, 2026-11-11:
 * "like bottom card styles switched with keys"). One chart, six styles, each a different way to read the same march:
 *   Chart   the march card as a table (leg, bearing, distance, paces, running total, time, landmark) beside the checks;
 *   Strip   the route unrolled: bearings, lamps, check points, halts, obstacles, skylines, sight zones, the profile;
 *   Cards   a pocket card for each leg: dial, bearing, paces and cord, the landmark it ends on;
 *   Trace   the real shape of the route, north up and turning with the map, with the FUP and the enemy's rings;
 *   FUP     the marking layout axis-up (tape, places, SL, lamps, guides, axis tape) with the stores and the checks;
 *   Clock   the march against the clock and the night's light, with the programme from leaving the SP to H.
 * The tab row shows each style with its answer under its name. W walks pages then styles (Shift+W back), a click on a
 * tab works too, Esc or × closes. It never scrolls: what does not fit goes to the next page. Colours and sizes from
 * GroundGuideTokens.ts; the trace and the dials turn with the map. DOM nodes and textContent only.
 */

import { ensureTokensCss, STEP_TEXT, TONE } from '../GroundGuide/GroundGuideTokens';
import { ensureNorthCss, orientNorth } from '../GroundGuide/GroundGuideNorth';
import type { MercXY } from '../PlatoonGuide/PlatoonGuideRead';
import { clock, hRel, toMils, type NmTone } from './NightMarchRead';
import { chartLines, deg3, dist, dur, ECHELON_WORD, num, type NightMarchBrief } from './NightMarchText';
import { compassDial, fupPlan, LAMP, paceCord, pocketCard, stripMap, timeDistance, TONE_COL, traceMap } from './NightMarchViz';

export type NmStyle = 'chart' | 'strip' | 'cards' | 'trace' | 'fup' | 'clock';
export const NM_STYLES: NmStyle[] = ['chart', 'strip', 'cards', 'trace', 'fup', 'clock'];
const STYLE_LABEL: Record<NmStyle, string> = { chart: 'Chart', strip: 'Strip', cards: 'Cards', trace: 'Trace', fup: 'FUP', clock: 'Clock' };
const STYLE_ID = 'ms-night-march-chart-style';
const VERDICT: Record<NmTone, string> = { ok: 'Ready to march', warn: 'March, with checks', bad: 'Fix before the march' };

const CSS = `
.ms-nmd{position:fixed;left:10px;right:10px;bottom:10px;z-index:2147482812;height:calc(46vh + 40px);min-height:min(440px,calc(100vh - 20px));max-height:calc(100vh - 20px);
  display:none;flex-direction:column;box-sizing:border-box;border-radius:12px;background:var(--gg-card);border:1px solid #5a6470;box-shadow:0 10px 30px rgba(0,0,0,.5);
  font:400 13.5px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:var(--gg-text)}
.ms-nmd.ms-open{display:flex}
.ms-nmd-h{flex:none;display:flex;align-items:center;gap:6px 10px;padding:8px 10px 7px;background:linear-gradient(90deg,#1d2635,var(--gg-head) 45%);border-radius:11px 11px 0 0;flex-wrap:wrap}
.ms-nmd-name{display:flex;align-items:center;gap:7px;font-weight:750;font-size:13.5px;color:var(--gg-strong);padding:0 6px 0 4px;white-space:nowrap}
.ms-nmd-tabs{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
.ms-nmd-tab{display:inline-flex;flex-direction:column;align-items:flex-start;padding:5px 10px;border-radius:8px;border:1px solid transparent;background:transparent;color:#d5dbe1;
  font:600 13.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer;text-align:left;max-width:180px}
.ms-nmd-tab:hover{background:rgba(255,255,255,.08);color:#fff}
.ms-nmd-tab:focus-visible{outline:2px solid var(--gg-accent);outline-offset:1px}
.ms-nmd-tab[aria-selected="true"]{background:#e4e8ec;border-color:#e4e8ec;color:#14181d}
.ms-nmd-ta{display:flex;align-items:center;gap:5px;max-width:100%;font-size:12px;font-weight:600;color:var(--gg-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-nmd-tab[aria-selected="true"] .ms-nmd-ta{color:#3d4650}
.ms-nmd-dot{display:inline-block;flex:none;width:9px;height:9px;border-radius:50%}
.ms-nmd-hsp{flex:1}
.ms-nmd-btn{font:400 13.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:30px;padding:0 10px;white-space:nowrap}
.ms-nmd-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.ms-nmd-btn:focus-visible{outline:2px solid var(--gg-accent);outline-offset:1px}
.ms-nmd-btn.ms-x{width:30px;padding:0;font-size:18px}
.ms-nmd-mode{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:3px 14px;padding:6px 16px;background:var(--gg-strip);border-top:1px solid var(--gg-hair-soft);font-size:13.5px;color:var(--gg-label)}
.ms-nmd-mode b{color:#fff;font-weight:600}
.ms-nmd-mode .ms-warn{color:var(--gg-warn);font-weight:600}
.ms-nmd-sum{flex:none;display:flex;flex-wrap:wrap;align-items:stretch;row-gap:10px;padding:10px 16px 11px;background:var(--gg-strip);border-top:1px solid var(--gg-hair-soft);border-bottom:1px solid var(--gg-hair)}
.ms-nmd-ans{flex:1.4 1 280px;min-width:0;max-width:440px;margin-right:12px;padding:8px 14px 9px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.18)}
.ms-nmd-ans[data-tone="ok"]{background:rgba(47,168,98,.12);border-color:rgba(47,168,98,.5)}
.ms-nmd-ans[data-tone="warn"]{background:rgba(238,138,31,.12);border-color:rgba(238,138,31,.55)}
.ms-nmd-ans[data-tone="bad"]{background:rgba(229,72,77,.12);border-color:rgba(229,72,77,.55)}
.ms-nmd-al{font-size:12px;line-height:1.3;color:var(--gg-label)}
.ms-nmd-av{margin-top:1px;font-size:22px;font-weight:750;line-height:1.2;color:#fff}
.ms-nmd-as{margin-top:2px;font-size:12px;line-height:1.35;color:var(--gg-label);overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ms-nmd-fact{flex:1 1 120px;min-width:0;max-width:250px;padding:0 14px;border-left:1px solid var(--gg-hair)}
.ms-nmd-ans+.ms-nmd-fact{border-left:0;padding-left:0}
.ms-nmd-fk{font-size:12px;line-height:1.3;color:var(--gg-label)}
.ms-nmd-fv{margin-top:2px;font:750 15.5px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#f4f6f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ms-nmd-fv[data-tone="ok"]{color:${STEP_TEXT.go}}.ms-nmd-fv[data-tone="warn"]{color:${STEP_TEXT.slow}}.ms-nmd-fv[data-tone="bad"]{color:${STEP_TEXT.nogo}}
.ms-nmd-fs{margin-top:1px;font-size:12px;line-height:1.35;color:var(--gg-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-nmd-band{flex:1 1 auto;min-height:120px;position:relative;box-sizing:border-box;padding:12px 16px 10px;overflow:hidden}
.ms-nmd-row{display:flex;gap:18px;height:100%;min-height:0}
.ms-nmd-side{flex:1 1 280px;min-width:240px;display:flex;flex-direction:column;gap:6px;min-height:0;overflow:hidden}
.ms-nmd-cap{display:flex;align-items:center;gap:7px;margin:0 0 6px;padding-bottom:5px;border-bottom:1px solid var(--gg-hair);font:600 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;color:#e4e8ec}
.ms-nmd-tbl{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
.ms-nmd-tbl th{text-align:left;font-size:12px;font-weight:600;color:var(--gg-label);padding:0 10px 6px 0;border-bottom:1px solid var(--gg-hair);white-space:nowrap}
.ms-nmd-tbl td{padding:5px 10px 5px 0;border-bottom:1px solid var(--gg-hair-soft);white-space:nowrap;vertical-align:middle}
.ms-nmd-tbl td.ms-num{text-align:right}
.ms-nmd-tbl th.ms-num{text-align:right}
.ms-nmd-tbl tr.ms-go{cursor:pointer}
.ms-nmd-tbl tr.ms-go:hover td{background:rgba(255,255,255,.05)}
.ms-nmd-leg{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-weight:750;font-size:12px;color:#14181d}
.ms-nmd-brg{font-size:15.5px;font-weight:750;color:#fff}
.ms-nmd-brg small{font-size:12px;color:var(--gg-label);font-weight:600;margin-left:4px}
.ms-nmd-lm{max-width:240px;overflow:hidden;text-overflow:ellipsis}
.ms-nmd-lm.ms-warn{color:${STEP_TEXT.slow}}
.ms-nmd-chk{display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:13.5px;line-height:1.35}
.ms-nmd-chk+.ms-nmd-chk{border-top:1px solid var(--gg-hair-soft)}
.ms-nmd-chk>i{flex:none;width:9px;height:9px;border-radius:50%;margin-top:5px}
.ms-nmd-chk.ms-go{cursor:pointer}
.ms-nmd-chk.ms-go:hover{background:rgba(255,255,255,.05)}
.ms-nmd-more{font-size:12px;color:var(--gg-warn);font-weight:600;padding-top:4px}
.ms-nmd-cards{display:flex;gap:12px;height:100%;align-items:stretch}
.ms-nm-pc{flex:0 0 214px;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;padding:9px 11px;border-radius:10px;background:linear-gradient(180deg,#232b36,#1b2028);border:1px solid rgba(255,255,255,.12);border-top:3px solid #8ec1ea;min-height:0;overflow:hidden}
.ms-nm-pc[data-tone="warn"]{border-top-color:${TONE.slow.fill}}.ms-nm-pc[data-tone="bad"]{border-top-color:${TONE.nogo.fill}}
.ms-nm-pc-h{display:flex;justify-content:space-between;gap:6px;font-size:12px;font-weight:700;color:var(--gg-label);text-transform:none}
.ms-nm-pc-no{color:#fff}
.ms-nm-pc-top{display:flex;gap:8px;align-items:center}
.ms-nm-pc-nums{min-width:0}
.ms-nm-pc-brg{font-size:26px;font-weight:750;line-height:1.05;color:#fff;font-variant-numeric:tabular-nums}
.ms-nm-pc-brg small,.ms-nm-pc-paces small{font-size:12px;font-weight:600;color:var(--gg-label)}
.ms-nm-pc-paces{margin-top:6px;font-size:20px;font-weight:750;line-height:1.1;color:#ffd27a;font-variant-numeric:tabular-nums}
.ms-nm-pc-sub{font-size:12px;color:var(--gg-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-nm-pc-ends{font-size:13px;line-height:1.35;color:var(--gg-text)}
.ms-nm-pc-ends b{color:#fff}
.ms-nm-pc-tot{font-size:12px;color:var(--gg-label)}
.ms-nm-pc-note{font-size:12px;line-height:1.3;color:${STEP_TEXT.slow};overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ms-nmd-stores{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 8px}
.ms-nmd-st{padding:4px 8px;min-width:0;overflow:hidden;border-radius:7px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
.ms-nmd-st b{display:block;font-size:17px;font-weight:750;color:#fff;font-variant-numeric:tabular-nums}
.ms-nmd-st span{display:block;font-size:12px;line-height:1.3;color:var(--gg-label);overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ms-nmd-prog{display:grid;grid-template-columns:62px minmax(0,1fr);column-gap:10px;font-variant-numeric:tabular-nums}
.ms-nmd-prog>div{padding:4px 0;border-bottom:1px solid var(--gg-hair-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-nmd-prog>.ms-t{font-weight:750;color:#fff}
.ms-nmd-prog>.ms-h{color:#ff8a8d;font-weight:750}
.ms-nmd-legs{columns:2;column-gap:16px;font-size:13px;font-variant-numeric:tabular-nums}
.ms-nmd-legs>div{break-inside:avoid;padding:3px 0;border-bottom:1px solid var(--gg-hair-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-nmd-f{flex:none;padding:6px 14px 7px;font-size:12px;color:var(--gg-label);border-top:1px solid var(--gg-hair-soft);display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center}
.ms-nmd-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;margin-right:5px;box-sizing:border-box;border-radius:4px;
  font:750 12px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
.ms-nmd-pg{margin-left:auto;color:var(--gg-warn);font-weight:600}
.ms-nmd-sum.ms-compact{padding:7px 16px 8px}
.ms-nmd-sum.ms-compact .ms-nmd-ans{padding:5px 12px 6px}
.ms-nmd-sum.ms-compact .ms-nmd-av{font-size:17px}
.ms-nmd-sum.ms-compact .ms-nmd-as,.ms-nmd-sum.ms-compact .ms-nmd-fs{display:none}
.ms-nmd-empty{color:var(--gg-label);padding:28px 12px;text-align:center;font-size:15px}
@media (prefers-reduced-motion:no-preference){.ms-nmd-band>*{animation:ms-nmd-in .18s cubic-bezier(.25,1,.5,1)}}
@keyframes ms-nmd-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
`;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function dot(color: string): HTMLElement {
  const d = el('span', 'ms-nmd-dot');
  d.style.background = color;
  return d;
}

export interface NmChartHost {
  close(): void;
  goTo(x: number, y: number): void;
  newRoute(): void;
  copied?(ok: boolean): void;
}

export class NightMarchChartView {
  private _root: HTMLDivElement | null = null;
  private _brief: NightMarchBrief | null = null;
  private _style: NmStyle = 'chart';
  private _page = 0;
  private _pages = 1;
  private _north = 0;
  private _open = false;
  private _resize: (() => void) | null = null;
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly _host: NmChartHost) {}

  get isOpen(): boolean {
    return this._open;
  }
  get style(): NmStyle {
    return this._style;
  }

  setStyle(s: NmStyle): void {
    if (!NM_STYLES.includes(s)) return;
    this._style = s;
    this._page = 0;
    if (this._open) this._render();
  }

  update(b: NightMarchBrief | null, northDeg: number): void {
    this._brief = b;
    this._north = northDeg;
    if (this._open) this._render();
  }

  setNorth(northDeg: number): void {
    this._north = northDeg;
    if (this._root && this._open) orientNorth(this._root, northDeg);
  }

  open(style?: NmStyle): void {
    if (style) {
      this._style = style;
      this._page = 0;
    }
    this._ensure();
    this._open = true;
    this._root!.classList.add('ms-open');
    this._render();
  }

  close(): void {
    this._open = false;
    this._root?.classList.remove('ms-open');
  }

  /** W: the next page, then the next style (Shift: back). From the last style's last page it wraps to the first. */
  step(dir: 1 | -1): void {
    if (!this._open) return this.open();
    if (dir > 0 && this._page + 1 < this._pages) this._page++;
    else if (dir < 0 && this._page > 0) this._page--;
    else {
      const i = NM_STYLES.indexOf(this._style);
      this._style = NM_STYLES[(i + dir + NM_STYLES.length) % NM_STYLES.length];
      this._page = dir < 0 ? Number.MAX_SAFE_INTEGER : 0;
    }
    this._render();
  }

  destroy(): void {
    if (this._resize) window.removeEventListener('resize', this._resize);
    this._resize = null;
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._root?.remove();
    this._root = null;
    this._open = false;
    document.getElementById(STYLE_ID)?.remove();
  }

  private _ensure(): void {
    ensureTokensCss();
    ensureNorthCss();
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    if (this._root) return;
    const r = document.createElement('div');
    r.className = 'ms-nmd';
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-label', 'Night march chart');
    document.body.appendChild(r);
    this._root = r;
    this._resize = () => {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._open && this._render(), 120);
    };
    window.addEventListener('resize', this._resize);
  }

  private _render(): void {
    const root = this._root;
    if (!root) return;
    root.replaceChildren();
    const b = this._brief;
    // Header: the name, the style tabs with their answers, the buttons.
    const head = el('div', 'ms-nmd-h');
    const name = el('div', 'ms-nmd-name');
    name.append('🌙 Night March');
    head.append(name);
    const tabs = el('div', 'ms-nmd-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const s of NM_STYLES) {
      const t = el('button', 'ms-nmd-tab') as HTMLButtonElement;
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(s === this._style));
      t.append(el('span', undefined, STYLE_LABEL[s]));
      const a = el('span', 'ms-nmd-ta');
      const ans = b ? this._tabAnswer(s, b) : null;
      if (ans) {
        if (ans.tone) a.append(dot(TONE_COL[ans.tone]));
        a.append(ans.text);
      } else a.textContent = '—';
      t.append(a);
      t.addEventListener('click', () => {
        this._style = s;
        this._page = 0;
        this._render();
      });
      tabs.append(t);
    }
    head.append(tabs, el('span', 'ms-nmd-hsp'));
    if (b) {
      const copy = el('button', 'ms-nmd-btn', 'Copy as Text') as HTMLButtonElement;
      copy.type = 'button';
      copy.addEventListener('click', () => {
        const text = chartLines(b).join('\n');
        void navigator.clipboard?.writeText(text).then(
          () => this._host.copied?.(true),
          () => this._host.copied?.(false),
        );
      });
      head.append(copy);
    }
    const nr = el('button', 'ms-nmd-btn', 'New Route') as HTMLButtonElement;
    nr.type = 'button';
    nr.title = 'Draw a new route: click the SP, each turn, double-click the FUP, then click the Obj';
    nr.addEventListener('click', () => this._host.newRoute());
    const x = el('button', 'ms-nmd-btn ms-x', '×') as HTMLButtonElement;
    x.type = 'button';
    x.setAttribute('aria-label', 'Close the night march chart');
    x.addEventListener('click', () => this._host.close());
    head.append(nr, x);
    root.append(head);

    if (!b) {
      const band = el('div', 'ms-nmd-band') as HTMLDivElement;
      band.append(el('div', 'ms-nmd-empty', 'No route yet. New Route: click the SP, each turn on a feature you can see at night, double-click the FUP, then click the Obj (Esc for none).'));
      root.append(band);
      this._foot(root);
      return;
    }
    const C = b.chart;
    const T = C.timing;
    // Mode strip: who, how it was worked out, bearings, H, tonight, grids.
    const mode = el('div', 'ms-nmd-mode');
    const add = (k: string, v: string, warn = false) => {
      const s = el('span');
      s.append(`${k} `);
      const bb = el('b', warn ? 'ms-warn' : undefined, v);
      s.append(bb);
      mode.append(s);
    };
    add('For', `${ECHELON_WORD[C.echelon]}${C.tanks ? ' + tanks' : ''}`);
    add('Times', C.terrain ? 'by Gr and slope' : `${T.flatKmh} km/h, ${b.terrainKind} (no terrain)`, !C.terrain);
    add('Bearings', C.gmaSet ? `magnetic, GMA ${b.gmaDeg! >= 0 ? `${b.gmaDeg}° E` : `${-b.gmaDeg!}° W`}` : 'GRID: set the GMA', !C.gmaSet);
    add('H', T.h ?? 'not set', T.h === null);
    if (b.tonight) add('Tonight', b.tonight.words);
    add('SP', b.grids.sp);
    add('FUP', b.grids.fup);
    if (b.grids.obj) add('Obj', b.grids.obj);
    root.append(mode);

    // Answer strip.
    // The picture styles get a one-line answer strip, so the drawing has the height.
    const sum = el('div', `ms-nmd-sum${this._style === 'chart' || this._style === 'cards' ? '' : ' ms-compact'}`);
    const ans = el('div', 'ms-nmd-ans');
    ans.dataset.tone = C.tone;
    const lead = C.checks.find((c) => c.tone === C.tone) ?? C.checks[0];
    ans.append(el('div', 'ms-nmd-al', `Night march · ${C.legs.length} legs`), el('div', 'ms-nmd-av', VERDICT[C.tone]), el('div', 'ms-nmd-as', lead ? lead.text : ''));
    sum.append(ans);
    const fact = (k: string, v: string, s?: string, tone?: NmTone) => {
      const f = el('div', 'ms-nmd-fact');
      const fv = el('div', 'ms-nmd-fv', v);
      if (tone) fv.dataset.tone = tone;
      f.append(el('div', 'ms-nmd-fk', k), fv);
      if (s) f.append(el('div', 'ms-nmd-fs', s));
      sum.append(f);
    };
    fact('Route', dist(C.lengthM), `${num(C.paces)} paces`);
    fact('March', dur(T.marchMin), `${dur(T.moveMin)} moving${T.halts.length ? ` · ${T.halts.length} halt${T.halts.length > 1 ? 's' : ''}` : ''}`);
    fact('Leave SP', T.leaveSp ?? hRel(-T.leaveBeforeH), T.arriveFup ? `in FUP ${T.arriveFup} · H ${T.h}` : `in FUP ${hRel(-T.fupMin)}`);
    fact('FUP to Obj', C.fup.distToObjM !== null ? dist(C.fup.distToObjM) : 'no Obj', `want ${dist(C.tanks ? 3000 : 1200)} or more`, C.fup.distToObjM !== null ? C.fup.tone : 'warn');
    fact('Marking', `${num(C.stores.tapeM)} m tape`, `${C.stores.lights} lights · ${C.stores.guides} guides`);
    root.append(sum);

    const band = el('div', 'ms-nmd-band') as HTMLDivElement;
    root.append(band);
    this._foot(root);
    // Lay the band out at its real size.
    const W = Math.max(320, band.clientWidth - 32);
    const H = Math.max(120, band.clientHeight - 22);
    this._pages = 1;
    if (this._style === 'chart') this._chart(band, b, W, H);
    else if (this._style === 'strip') band.append(stripMap(b, W, H));
    else if (this._style === 'cards') this._cards(band, b, W, H);
    else if (this._style === 'trace') this._trace(band, b, W, H);
    else if (this._style === 'fup') this._fup(band, b, W, H);
    else this._clock(band, b, W, H);
    this._page = Math.min(this._page, this._pages - 1);
    // The footer's page note (pages are known only now).
    const pg = root.querySelector('.ms-nmd-pg');
    if (pg) pg.textContent = this._pages > 1 ? `Page ${this._page + 1} of ${this._pages}: W for more` : '';
    orientNorth(root, this._north);
  }

  private _foot(root: HTMLElement): void {
    const f = el('div', 'ms-nmd-f');
    const k = (key: string, what: string) => {
      const s = el('span');
      s.append(el('span', 'ms-nmd-kbd', key), what);
      f.append(s);
    };
    k('W', 'next page, then next style');
    k('Shift+W', 'back');
    k('Esc', 'close');
    const lamp = el('span');
    const d = el('i');
    d.style.cssText = `display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;background:${LAMP}`;
    lamp.append(d, 'lamps shaded to the rear');
    f.append(lamp, el('span', 'ms-nmd-pg'));
    root.append(f);
  }

  private _tabAnswer(s: NmStyle, b: NightMarchBrief): { text: string; tone?: NmTone } | null {
    const C = b.chart;
    const T = C.timing;
    switch (s) {
      case 'chart':
        return { text: `${C.legs.length} legs · ${num(C.paces)} p`, tone: C.tone };
      case 'strip':
        return { text: `${dist(C.lengthM)}${C.sights?.night.enterAtM != null ? ' · in sights' : ''}` };
      case 'cards':
        return { text: `${C.legs.length} cards` };
      case 'trace':
        return { text: `axis ${C.fup.axisMagDeg !== null ? `${deg3(C.fup.axisMagDeg)} M` : `${deg3(C.fup.axisDeg)} G`}` };
      case 'fup':
        return { text: C.fup.distToObjM !== null ? `${dist(C.fup.distToObjM)} to Obj` : 'no Obj', tone: C.fup.tone };
      case 'clock':
        return { text: `Leave ${T.leaveSp ?? hRel(-T.leaveBeforeH)}` };
    }
  }

  private _goTo(at?: MercXY): void {
    if (at) this._host.goTo(at[0], at[1]);
  }

  /** The checks list, as many as fit in `maxH`, worst first; the rest counted. */
  private _checks(parent: HTMLElement, b: NightMarchBrief, maxH: number): void {
    const C = b.chart;
    const cap = el('div', 'ms-nmd-cap', 'Checks');
    parent.append(cap);
    const room = Math.max(1, Math.floor((maxH - 34) / 44));
    const list = C.checks.slice(0, room);
    for (const c of list) {
      const r = el('div', `ms-nmd-chk${c.at ? ' ms-go' : ''}`);
      const i = el('i');
      i.style.background = TONE_COL[c.tone];
      r.append(i, el('span', undefined, c.text));
      if (c.at) {
        r.title = 'Show on the map';
        r.addEventListener('click', () => this._goTo(c.at));
      }
      parent.append(r);
    }
    if (C.checks.length > list.length) parent.append(el('div', 'ms-nmd-more', `+${C.checks.length - list.length} more in Copy as Text`));
  }

  private _chart(band: HTMLElement, b: NightMarchBrief, _W: number, H: number): void {
    const C = b.chart;
    const T = C.timing;
    const row = el('div', 'ms-nmd-row');
    const left = el('div');
    left.style.cssText = 'flex:2.2 1 0;min-width:0;overflow:hidden';
    const side = el('div', 'ms-nmd-side');
    row.append(left, side);
    band.append(row);
    const perPage = Math.max(1, Math.floor((H - 34) / 35));
    this._pages = Math.max(1, Math.ceil(C.legs.length / perPage));
    this._page = Math.min(this._page, this._pages - 1);
    const legs = C.legs.slice(this._page * perPage, (this._page + 1) * perPage);
    const tbl = el('table', 'ms-nmd-tbl');
    const thead = el('tr');
    const cols: Array<[string, boolean]> = [['Leg', false], [C.gmaSet ? 'Bearing (mag)' : 'Bearing (grid)', false], ['Dist', true], ['Paces', true], ['Total p', true], ['Time', true], [T.hHourMin !== null ? 'Clock' : 'From H', true], ['Ends on', false]];
    for (const [c, numCol] of cols) thead.append(el('th', numCol ? 'ms-num' : undefined, c));
    const th = el('thead');
    th.append(thead);
    tbl.append(th);
    const tb = el('tbody');
    for (const lg of legs) {
      const tr = el('tr', 'ms-go');
      tr.title = 'Show the leg on the map';
      tr.addEventListener('click', () => this._goTo([(lg.from[0] + lg.to[0]) / 2, (lg.from[1] + lg.to[1]) / 2]));
      const no = el('span', 'ms-nmd-leg', String(lg.i));
      no.style.background = lg.tone === 'ok' ? '#8ec1ea' : TONE_COL[lg.tone];
      const c0 = el('td');
      c0.append(no);
      const main = lg.magDeg ?? lg.bearingDeg;
      const bc = el('td');
      const bs = el('span', 'ms-nmd-brg', b.units === 'mils' ? String(toMils(main)).padStart(4, '0') : deg3(main));
      bs.append(el('small', undefined, b.units === 'both' ? `${toMils(main)} mils` : lg.magDeg !== null ? `grid ${deg3(lg.bearingDeg)}` : b.units === 'mils' ? 'mils' : ''));
      bc.append(bs);
      const td = (t: string, cls = 'ms-num') => el('td', cls, t);
      const when = T.hHourMin !== null ? clock(T.hHourMin - T.leaveBeforeH + lg.startMin) : hRel(-T.leaveBeforeH + lg.startMin);
      const lm = el('td');
      const lmS = el('div', `ms-nmd-lm${!lg.toFup && !lg.landmark ? ' ms-warn' : ''}`, lg.toFup ? `FUP · ${C.fup.distToObjM !== null ? `${dist(C.fup.distToObjM)} to Obj` : 'no Obj'}` : lg.landmark ? `${lg.landmark.label}${lg.landmark.name ? ` ${lg.landmark.name}` : ''}` : 'no landmark: guide + light');
      if (lg.notes.length) lmS.title = lg.notes.join('\n');
      lm.append(lmS);
      tr.append(c0, bc, td(dist(lg.distM)), td(num(lg.paces)), td(num(lg.cumPaces)), td(dur(lg.minNight)), td(when), lm);
      tb.append(tr);
    }
    tbl.append(tb);
    left.append(tbl);
    this._checks(side, b, H);
  }

  private _cards(band: HTMLElement, b: NightMarchBrief, W: number, H: number): void {
    const C = b.chart;
    const wrap = el('div', 'ms-nmd-cards');
    band.append(wrap);
    const per = Math.max(1, Math.floor((W + 12) / (214 + 12)));
    this._pages = Math.max(1, Math.ceil(C.legs.length / per));
    this._page = Math.min(this._page, this._pages - 1);
    for (const lg of C.legs.slice(this._page * per, (this._page + 1) * per)) {
      const c = pocketCard(lg, b, H);
      c.style.cursor = 'pointer';
      c.title = 'Show the leg on the map';
      c.addEventListener('click', () => this._goTo([(lg.from[0] + lg.to[0]) / 2, (lg.from[1] + lg.to[1]) / 2]));
      wrap.append(c);
    }
  }

  private _trace(band: HTMLElement, b: NightMarchBrief, W: number, H: number): void {
    const C = b.chart;
    const row = el('div', 'ms-nmd-row');
    const side = el('div', 'ms-nmd-side');
    const tw = Math.max(320, Math.min(W - 280, Math.round(W * 0.62)));
    const pic = el('div');
    pic.style.cssText = `flex:none;width:${tw}px`;
    pic.append(traceMap(b, tw, H));
    row.append(pic, side);
    band.append(row);
    side.append(el('div', 'ms-nmd-cap', 'Legs'));
    const legs = el('div', 'ms-nmd-legs');
    for (const lg of C.legs) {
      const d = el('div');
      d.append(dot(lg.tone === 'ok' ? '#8ec1ea' : TONE_COL[lg.tone]), ` ${lg.i}  ${deg3(lg.magDeg ?? lg.bearingDeg)}${lg.magDeg === null ? ' G' : ' M'} · ${num(lg.paces)} p · ${dist(lg.distM)}`);
      legs.append(d);
    }
    side.append(legs);
    const dl = el('div');
    dl.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:10px';
    const dial = compassDial({ px: Math.min(120, Math.max(84, H - 160)), bearing: C.fup.axisDeg, prev: C.legs.map((l) => l.bearingDeg), gmaDeg: b.gmaDeg, objBrg: null, color: '#ff8a8d', driftDeg: 3, label: 'Axis to the Obj' });
    const info = el('div');
    info.append(el('div', 'ms-nmd-fk', 'Axis to the Obj (red), legs faint'), el('div', 'ms-nmd-fv', C.fup.axisMagDeg !== null ? `${deg3(C.fup.axisMagDeg)} M` : `${deg3(C.fup.axisDeg)} G`));
    dl.append(dial, info);
    side.append(dl);
  }

  private _fup(band: HTMLElement, b: NightMarchBrief, W: number, H: number): void {
    const C = b.chart;
    const F = C.fup;
    const row = el('div', 'ms-nmd-row');
    const pw = Math.min(W - 300, Math.max(360, Math.round(H * 1.5)), 720);
    const pic = el('div');
    pic.style.cssText = `flex:none;width:${pw}px`;
    pic.append(fupPlan(b, pw, H));
    const side = el('div', 'ms-nmd-side');
    row.append(pic, side);
    band.append(row);
    side.append(el('div', 'ms-nmd-cap', 'Marking party stores'));
    const st = el('div', 'ms-nmd-stores');
    const s = (v: string, k: string) => {
      const d = el('div', 'ms-nmd-st');
      d.append(el('b', undefined, v), el('span', undefined, k));
      st.append(d);
    };
    s(`${num(C.stores.tapeM)} m`, `tape: SL ${C.stores.slTapeM}, FUP ${C.stores.fupTapeM}, axis ${C.stores.axisTapeM}`);
    s(`${C.stores.rolls} rolls`, `${C.stores.rollsWithRoute} to tape the route too`);
    s(`${C.stores.lights}`, 'lights, shaded to the rear');
    s(`${C.stores.guides}`, `guides: SP, ${Math.max(0, C.legs.length - 1)} turns, entry, places`);
    side.append(st);
    const cap = el('div', 'ms-nmd-cap', 'FUP checks');
    cap.style.marginTop = '8px';
    side.append(cap);
    const fupChecks = C.checks.filter((c) => /FUP|SL|axis|Obj/.test(c.text));
    const room = Math.max(1, Math.floor((H - 110) / 44));
    for (const c of fupChecks.slice(0, room)) {
      const r = el('div', `ms-nmd-chk${c.at ? ' ms-go' : ''}`);
      const i = el('i');
      i.style.background = TONE_COL[c.tone];
      r.append(i, el('span', undefined, c.text));
      if (c.at) r.addEventListener('click', () => this._goTo(c.at));
      side.append(r);
    }
    if (!fupChecks.length) side.append(el('div', 'ms-nmd-chk', `FUP ${dist(F.frontM)} x ${dist(F.depthM)}, places: ${F.slots.map((x) => x.label).join(', ')}`));
  }

  private _clock(band: HTMLElement, b: NightMarchBrief, W: number, H: number): void {
    const C = b.chart;
    const T = C.timing;
    const row = el('div', 'ms-nmd-row');
    const pw = Math.max(360, Math.min(W - 300, Math.round(W * 0.64)));
    const pic = el('div');
    pic.style.cssText = `flex:none;width:${pw}px`;
    pic.append(timeDistance(b, pw, H));
    const side = el('div', 'ms-nmd-side');
    row.append(pic, side);
    band.append(row);
    side.append(el('div', 'ms-nmd-cap', 'Programme'));
    const prog = el('div', 'ms-nmd-prog');
    const at = (minAfterLeave: number) => (T.hHourMin !== null ? clock(T.hHourMin - T.leaveBeforeH + minAfterLeave) : hRel(-T.leaveBeforeH + minAfterLeave));
    const items: Array<[string, string, string?]> = [[at(0), 'Leave the SP']];
    const events: Array<{ m: number; t: string }> = [];
    for (const lg of C.legs) if (!lg.toFup) events.push({ m: lg.endMin, t: `Turn ${lg.i}${lg.landmark ? `: ${lg.landmark.label}` : ''}` });
    for (const h of T.halts) events.push({ m: h.atMin, t: `Halt ${h.min} min` });
    if (C.sights?.night.enterAtM != null) {
      const lg = C.legs.find((l) => l.cumM >= C.sights!.night.enterAtM!);
      if (lg) {
        const frac = (C.sights.night.enterAtM - (lg.cumM - lg.distM)) / Math.max(1, lg.distM);
        events.push({ m: Math.round(lg.startMin + (lg.endMin - lg.startMin) * frac), t: 'Into night sights: silent' });
      }
    }
    events.sort((a, z) => a.m - z.m);
    for (const e of events) items.push([at(e.m), e.t]);
    items.push([at(T.marchMin), 'In the FUP: shake out']);
    items.push([T.h ?? 'H', 'Cross the SL', 'h']);
    const room = Math.max(3, Math.floor((H - 34) / 29));
    const shown = items.length > room ? [...items.slice(0, room - 2), ['…', `${items.length - room + 1} more`] as [string, string], items[items.length - 1]] : items;
    for (const [t, what, cls] of shown) prog.append(el('div', cls === 'h' ? 'ms-h' : 'ms-t', t), el('div', undefined, what));
    side.append(prog);
    if (b.tonight) {
      const n = el('div', 'ms-nmd-fs', `Tonight: ${b.tonight.words}`);
      n.style.marginTop = '6px';
      side.append(n);
    }
    const cord = el('div');
    cord.style.marginTop = '6px';
    cord.append(el('div', 'ms-nmd-fk', `Pace cord for the march: ${num(C.paces)} paces`), paceCord(C.lengthM, Math.min(300, W - pw - 30)));
    side.append(cord);
  }
}
