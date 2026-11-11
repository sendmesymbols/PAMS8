/**
 * MovementGuideWaterCard.ts
 *
 * The Water card's cursor card (user, 2026-11-11: "mouse move card as well — make it visually appealing and use
 * creative visualization techniques", like the Ground and Platoon Guides' cards). While the Mov Detail is open on
 * Water, it follows the pointer and reads the obstacle under it: a quick read as the mouse moves (type, name, width),
 * the full reading once it rests (350 ms), home being the side the pointer is on (or away from the threat marker).
 *
 *   - the bar, in the verdict ladder's colour for tanks: the Annex P number and type, the pill "Annex P n";
 *   - a neutral line: the name, which bank you are on, cross or hold, the month;
 *   - the hero, one of three styles (Q cycles them, kept for next time):
 *       Section  the fisheye cross-section with a soldier and a tank on the home bank to height scale;
 *       Plan     the plan radar (north up, turning with the map) beside four tiles: width, depth, home / far bank;
 *       Gauges   depth / step out / width tubes against the wading depths, the tank's climb and gap, bridge spans;
 *   - the movers: tanks / wheels / foot chips in the going colours, the tank's reason under them;
 *   - the obstacle straightened: the crossings either way along it;
 *   - the footer names the keys: 9 walks the Water Detail's lenses, Q the style.
 * It measures itself once per update, flips to stay on screen, steps aside of the Mov Detail and never takes pointer
 * events. Markup from MovementGuideWaterPics (numbers, fixed strings and escaped names only).
 */

import Utils from '../../Support/utils';
import { ensureTokensCss, ladderIconMarkup, TONE, type Tone } from '../GroundGuide/GroundGuideTokens';
import { ensureNorthCss, orientNorth } from '../GroundGuide/GroundGuideNorth';
import type { WaterReading, WaterRules } from './MovementGuideWater';
import { alongStrip, figWord, fisheyeSection, gaugesPic, GO_C, GO_T, GO_W, moverIcon, planRadar, SRC_COLOR, SRC_LETTER, WATER, WATER_PICS_CSS } from './MovementGuideWaterPics';

export type WaterCardStyle = 'section' | 'plan' | 'gauges';
export const WATER_CARD_STYLES: WaterCardStyle[] = ['section', 'plan', 'gauges'];
const STYLE_WORD: Record<WaterCardStyle, string> = { section: 'Section', plan: 'Plan', gauges: 'Gauges' };

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));
const STYLE_ID = 'ms-water-card-style';
const EDGE = 8;
const GAP = 18;
const toneCss = (Object.keys(TONE) as Tone[]).map((t) => `.mgwc[data-tone="${t}"]{--wc-c:${TONE[t].fill};--wc-fg:${TONE[t].fg}}`).join('\n');
const CSS = `
.mgwc{position:fixed;left:0;top:0;z-index:2147482990;pointer-events:none;--wc-c:${TONE.chk.fill};--wc-fg:#fff;width:350px;max-width:calc(100vw - 8px);box-sizing:border-box;
  border-radius:12px;overflow:hidden;font:400 13.5px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;display:none;
  background:radial-gradient(120% 60% at 50% 0%,rgba(58,149,216,.16),rgba(58,149,216,0) 60%),linear-gradient(180deg,#1f242b 0%,#1b1f25 60%);
  border:1.5px solid var(--wc-c);box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.35)}
${toneCss}
.mgwc-bar{display:flex;align-items:center;gap:9px;padding:9px 12px;background-color:var(--wc-c);color:var(--wc-fg);font-weight:750;font-size:18px;line-height:1.2;
  background-image:linear-gradient(90deg,rgba(255,255,255,.12),rgba(255,255,255,0) 60%)}
.mgwc-bar>svg{flex:none}
.mgwc-title{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mgwc-pill{flex:none;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.2);font-size:12px;font-weight:750;line-height:1.5;white-space:nowrap}
.mgwc[data-tone="slow"] .mgwc-pill,.mgwc[data-tone="marg"] .mgwc-pill{background:rgba(0,0,0,.18)}
.mgwc-mode{display:flex;flex-wrap:wrap;gap:2px 10px;padding:6px 12px;background:#222830;border-bottom:1px solid rgba(255,255,255,.14);font-size:12px;line-height:1.35;color:#c3cbd3}
.mgwc-mode b{color:#f1f3f6;font-weight:650}
.mgwc-hero{padding:6px 8px 2px}
.mgwc-hero svg.mgv{display:block;width:100%;height:auto}
.mgwc-plan{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px;align-items:center}
.mgwc-tiles{display:flex;flex-direction:column;gap:5px;min-width:0}
.mgwc-st{padding:4px 8px 5px;border-radius:7px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
.mgwc-sk{font-size:11.5px;line-height:1.2;color:#c3cbd3}
.mgwc-sv{font-size:15px;font-weight:750;line-height:1.25;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.mgwc-src{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;font:800 9px/1 system-ui,Segoe UI,Arial,sans-serif;color:#14181d;margin-left:6px;vertical-align:2px}
.mgwc-mv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;padding:6px 10px 2px}
.mgwc-m{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);min-width:0}
.mgwc-m b{font:800 12px/1.15 system-ui,Segoe UI,Arial,sans-serif;white-space:nowrap}
.mgwc-m span{display:block;font-size:10.5px;line-height:1.1;color:#c3cbd3}
.mgwc-why{padding:3px 12px 0;font-size:12px;line-height:1.35;color:#c3cbd3;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.mgwc-strip{padding:2px 8px 0}
.mgwc-strip svg{display:block;width:100%;height:auto}
.mgwc-wait{display:flex;align-items:center;gap:7px;padding:10px 12px;color:#c3cbd3;font-size:12.5px}
.mgwc-wait>i{display:inline-block;width:6px;height:6px;border-radius:50%;background:${WATER.line}}
@media (prefers-reduced-motion:no-preference){.mgwc-wait>i{animation:mgwc-pulse 1.1s ease-in-out infinite}.mgwc-wait>i:nth-child(2){animation-delay:.18s}.mgwc-wait>i:nth-child(3){animation-delay:.36s}
 .mgwc[data-moving="1"] .mgwc-hero,.mgwc[data-moving="1"] .mgwc-strip{opacity:.55;transition:opacity .15s}}
@keyframes mgwc-pulse{0%,100%{opacity:.25}50%{opacity:1}}
.mgwc-foot{display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;margin-top:6px;padding:6px 12px;font-size:12px;color:#c3cbd3;border-top:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.12)}
.mgwc-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;margin-right:5px;box-sizing:border-box;border-radius:4px;
  font:750 12px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
${WATER_PICS_CSS}
`;

/** What the card shows while the pointer moves before the full reading: the quick read. */
export interface WaterQuick {
  label: string;
  annex: number | null;
  name: string | null;
  width: string;
  distM: number;
}

export class MovementGuideWaterCard {
  private _el: HTMLDivElement | null = null;
  private _x = -1;
  private _y = -1;
  private _w = 350;
  private _h = 200;
  private _shown = false;

  get isShown(): boolean {
    return this._shown;
  }

  /** The full reading under the pointer. `moving`: the pointer has moved on since (the pictures dim until it rests). */
  show(w: WaterReading, R: WaterRules, o: { style: WaterCardStyle; pointer: [number, number] | null; km: number; northDeg: number; keys: boolean; moving?: boolean }): void {
    const root = this._ensure();
    const tv = w.verdict.tanks.v;
    const tone: Tone = w.pending ? 'chk' : tv === 'nogo' ? 'nogo' : tv === 'slow' ? 'slow' : 'go';
    root.dataset.tone = tone;
    root.dataset.moving = o.moving ? '1' : '0';
    const T = TONE[tone];
    const icon = `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">${ladderIconMarkup(T.icon, T.fill, T.fg)}</svg>`;
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][w.season.month - 1];
    const hero = this._hero(w, R, o);
    const mover = (k: 'tanks' | 'wheels' | 'foot', name: string) => {
      const v = w.verdict[k];
      return `<div class="mgwc-m" style="border-color:${GO_C[v.v]}88">${moverIcon(k, GO_C[v.v], 20)}<div><b style="color:${GO_T[v.v]}">${GO_W[v.v]}</b><span>${name}</span></div></div>`;
    };
    root.innerHTML = `
      <div class="mgwc-bar">${icon}<span class="mgwc-title">${esc(`${w.annex ? `${w.annex}. ` : ''}${w.typeLabel}`)}</span><span class="mgwc-pill">${w.annex ? `Annex P ${w.annex}` : 'not Annex P'}</span></div>
      <div class="mgwc-mode">${w.name ? `<b>${esc(w.name)}</b>` : ''}<span>you: <b>${esc(w.home.dir)} bank</b>${w.homeGuessed ? ' (on the water)' : ''}</span><span>we <b>${w.purpose === 'cross' ? 'cross' : 'hold'}</b></span><span><b>${month}</b> ${w.season.wet ? 'monsoon' : 'dry'}</span></div>
      <div class="mgwc-hero">${hero}</div>
      <div class="mgwc-mv">${mover('tanks', 'Tanks')}${mover('wheels', 'Wheels')}${mover('foot', 'Foot')}</div>
      <div class="mgwc-why">${esc(w.verdict.tanks.why)}</div>
      <div class="mgwc-strip">${alongStrip(w, o.km, { width: 330 })}</div>
      ${o.keys ? `<div class="mgwc-foot"><span><span class="mgwc-kbd">9</span>Water Detail lenses</span><span><span class="mgwc-kbd">Q</span>${STYLE_WORD[o.style]} ${WATER_CARD_STYLES.indexOf(o.style) + 1}/${WATER_CARD_STYLES.length}</span></div>` : ''}`;
    this._measure(o.northDeg);
  }

  /** The quick read while the pointer moves over water with no full reading for it yet. */
  quick(q: WaterQuick, o: { keys: boolean }): void {
    const root = this._ensure();
    root.dataset.tone = 'chk';
    root.dataset.moving = '1';
    const T = TONE.chk;
    root.innerHTML = `
      <div class="mgwc-bar"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">${ladderIconMarkup(T.icon, T.fill, T.fg)}</svg><span class="mgwc-title">${esc(`${q.annex ? `${q.annex}. ` : ''}${q.label}`)}</span><span class="mgwc-pill">${q.annex ? `Annex P ${q.annex}` : 'not Annex P'}</span></div>
      <div class="mgwc-mode">${q.name ? `<b>${esc(q.name)}</b>` : ''}<span>width <b>${esc(q.width)}</b></span><span>${Math.round(q.distM)} m away</span></div>
      <div class="mgwc-wait"><i></i><i></i><i></i> Reading the banks, depth and crossings: rest the mouse</div>
      ${o.keys ? `<div class="mgwc-foot"><span><span class="mgwc-kbd">9</span>Water Detail lenses</span><span><span class="mgwc-kbd">Q</span>style</span></div>` : ''}`;
    this._measure(0);
  }

  moveTo(x: number, y: number): void {
    this._x = x;
    this._y = y;
    if (this._shown) this._place();
  }

  setNorth(northDeg: number): void {
    if (this._el && this._shown) orientNorth(this._el, northDeg);
  }

  hide(): void {
    this._shown = false;
    if (this._el) this._el.style.display = 'none';
  }

  destroy(): void {
    this._el?.remove();
    this._el = null;
    this._shown = false;
    document.getElementById(STYLE_ID)?.remove();
  }

  private _hero(w: WaterReading, R: WaterRules, o: { style: WaterCardStyle; pointer: [number, number] | null; km: number }): string {
    if (o.style === 'gauges') return gaugesPic(w, R, { width: 330, height: 138 });
    if (o.style === 'plan') {
      const tile = (k: string, f: WaterReading['width'], unit = 'm') =>
        `<div class="mgwc-st"><div class="mgwc-sk">${esc(k)}</div><div class="mgwc-sv">${esc(figWord(f, unit))}<span class="mgwc-src" style="background:${SRC_COLOR[f.src]}" title="${esc(f.src)}">${SRC_LETTER[f.src]}</span></div></div>`;
      const bank = (b: WaterReading['home']) => (b.aboveWater.src !== 'none' ? b.aboveWater : b.aboveLand);
      return `<div class="mgwc-plan">${planRadar(w, { size: 150, pointer: o.pointer, km: o.km })}<div class="mgwc-tiles">${tile('Width', w.width)}${tile('Depth', w.depth)}${tile(`Home bank ${w.home.dir}`, bank(w.home))}${tile(`Far bank ${w.far.dir}`, bank(w.far))}</div></div>`;
    }
    return fisheyeSection(w, { width: 330, height: 136 });
  }

  private _measure(northDeg: number): void {
    const root = this._el!;
    orientNorth(root, northDeg);
    root.style.visibility = 'hidden';
    root.style.display = 'block';
    this._w = root.offsetWidth;
    this._h = root.offsetHeight;
    root.style.visibility = '';
    this._shown = true;
    if (this._x >= 0) this._place();
    else root.style.display = 'none';
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
      e.className = 'mgwc';
      e.setAttribute('role', 'status');
      e.setAttribute('aria-live', 'polite');
      document.body.appendChild(e);
      this._el = e;
    }
    return this._el;
  }

  /**
   * Below and right of the pointer; flipped to stay on screen; above the open Mov Detail when there is room, else over
   * it (the card reads the point under the mouse, which the Detail does not show).
   */
  private _place(): void {
    const e = this._el;
    if (!e) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const detail = document.querySelector<HTMLElement>('.mgd');
    const top = detail?.isConnected ? detail.getBoundingClientRect().top : vh;
    let bottom = Math.max(EDGE, Math.min(vh - EDGE, top - 8));
    if (bottom - EDGE < this._h) bottom = vh - EDGE;
    let x = this._x + GAP;
    let y = this._y + GAP;
    if (x + this._w > vw - EDGE) x = this._x - GAP - this._w;
    if (y + this._h > bottom) y = this._y - GAP - this._h;
    x = Math.max(EDGE, Math.min(x, vw - EDGE - this._w));
    y = Math.max(EDGE, Math.min(y, bottom - this._h));
    e.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    e.style.display = 'block';
  }
}
