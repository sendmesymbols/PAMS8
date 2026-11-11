/**
 * NightMarchCard.ts
 *
 * The Night March cursor card (user, 2026-11-11: "mouse move card as well ... visually appealing, creative
 * visualization"). It follows the pointer and never scrolls; two faces:
 *   drawing  the leg from the last point laid to the cursor: the bar holds the leg and its bearing in the verdict
 *            colour; the hero is the compass dial (needle, 3° drift cone, the legs already laid as faint spokes,
 *            magnetic north, the objective on the rim) beside three tiles: bearing (grid / magnetic / mils), paces with
 *            the pace cord, time by night with the running total; then the landmark the leg would end on, the hazards
 *            as chips (canal crossed, skyline, inside the enemy's night sights, long leg), the legs ribbon, and the
 *            ruler of the distance to the objective against the night-sight and thermal rings;
 *   on a leg the pointer on a finished route: the leg, how many paces in and to go (the cord lit to here), when the
 *            column passes, the landmark at its end.
 * Every colour and size from GroundGuideTokens.ts; the dial turns with the map (GroundGuideNorth). DOM nodes and
 * textContent only. Measured once per update, so following the cursor costs no layout reads.
 */

import { ensureTokensCss, TONE } from '../GroundGuide/GroundGuideTokens';
import { ensureNorthCss, orientNorth, whereNode } from '../GroundGuide/GroundGuideNorth';
import { clock, hRel, toMils, type NightMarchChart, type NmLive, type NmOnLeg, type NmTone, type Rules } from './NightMarchRead';
import { compassDial, legRibbon, LAMP, objRuler, paceCord, TONE_COL } from './NightMarchViz';
import { deg3, dist, dur, num, type NmUnits } from './NightMarchText';

const STYLE_ID = 'ms-night-march-card-style';
const EDGE = 8;
const GAP = 18;
const TONE_KEY: Record<NmTone, keyof typeof TONE> = { ok: 'go', warn: 'slow', bad: 'nogo' };

const CSS = `
.ms-nmc{position:fixed;left:0;top:0;z-index:2147482992;pointer-events:none;width:352px;max-width:calc(100vw - 8px);box-sizing:border-box;border-radius:12px;overflow:hidden;
  font:400 13.5px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:var(--gg-text);background:linear-gradient(180deg,#1c2330 0%,var(--gg-card) 55%);
  border:1.5px solid var(--nm-c,#8ec1ea);box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.35);display:none}
.ms-nmc-bar{display:flex;align-items:center;gap:9px;padding:8px 12px;background-color:var(--nm-c);color:var(--nm-fg,#14181d);font-weight:750;font-size:18px;line-height:1.2;
  background-image:linear-gradient(90deg,rgba(255,255,255,.14),rgba(255,255,255,0) 60%)}
.ms-nmc-moon{flex:none;width:18px;height:18px}
.ms-nmc-title{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ms-nmc-pill{flex:none;padding:2px 9px;border-radius:999px;background:rgba(0,0,0,.18);font-size:12px;font-weight:750;line-height:1.5;white-space:nowrap}
.ms-nmc-hero{display:grid;grid-template-columns:132px minmax(0,1fr);gap:8px;align-items:center;padding:9px 10px 6px 8px}
.ms-nmc-tiles{display:flex;flex-direction:column;gap:5px;min-width:0}
.ms-nmc-t{padding:4px 8px 5px;border-radius:7px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);min-width:0}
.ms-nmc-k{font-size:11.5px;line-height:1.2;color:var(--gg-label)}
.ms-nmc-v{font-size:19px;font-weight:750;line-height:1.2;color:#fff;white-space:nowrap;font-variant-numeric:tabular-nums}
.ms-nmc-v small{font-size:12px;font-weight:600;color:var(--gg-label);margin-left:3px}
.ms-nmc-s{font-size:11.5px;line-height:1.25;color:var(--gg-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ms-nmc-cord{margin-top:3px}
.ms-nmc-sec{padding:7px 12px 8px;border-top:1px solid var(--gg-hair)}
.ms-nmc-row{display:flex;align-items:baseline;gap:8px;min-width:0}
.ms-nmc-rl{flex:none;width:58px;font-size:12px;color:var(--gg-label)}
.ms-nmc-rv{flex:1 1 auto;min-width:0;font-size:14px;font-weight:650;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-nmc-rv[data-t="warn"]{color:#ffb46b}.ms-nmc-rv[data-t="bad"]{color:#ff8a8d}.ms-nmc-rv[data-t="ok"]{color:#74dca3}
.ms-nmc-chips{display:flex;flex-wrap:wrap;gap:4px 6px;margin-top:6px}
.ms-nmc-chip{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:650;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:var(--gg-text)}
.ms-nmc-chip>i{width:8px;height:8px;border-radius:50%;display:inline-block}
.ms-nmc-rib{margin:7px 0 2px}
.ms-nmc-foot{display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center;padding:6px 12px;font-size:12px;color:var(--gg-label);border-top:1px solid var(--gg-hair);background:rgba(0,0,0,.14)}
.ms-nmc-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;margin-right:4px;box-sizing:border-box;border-radius:4px;
  font:750 12px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
`;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function tile(k: string, v: Array<Node | string>, s?: Array<Node | string> | string, extra?: Node): HTMLElement {
  const t = el('div', 'ms-nmc-t');
  const vv = el('div', 'ms-nmc-v');
  vv.append(...v);
  t.append(el('div', 'ms-nmc-k', k), vv);
  if (s && (typeof s === 'string' ? s : s.length)) {
    const ss = el('div', 'ms-nmc-s');
    if (typeof s === 'string') ss.textContent = s;
    else ss.append(...s);
    t.append(ss);
  }
  if (extra) t.append(extra);
  return t;
}
function small(t: string): HTMLElement {
  return el('small', undefined, t);
}
function chip(color: string, text: string): HTMLElement {
  const c = el('span', 'ms-nmc-chip');
  const i = el('i');
  i.style.background = color;
  c.append(i, text);
  return c;
}
function kbd(k: string, what: string): HTMLElement {
  const s = el('span');
  s.append(el('span', 'ms-nmc-kbd', k), what);
  return s;
}
/** The moon as it is tonight: a lit share of the disc (0-1). */
function moonIcon(illum: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'ms-nmc-moon');
  svg.setAttribute('aria-hidden', 'true');
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', '10');
  c.setAttribute('cy', '10');
  c.setAttribute('r', '8');
  c.setAttribute('fill', '#14181d');
  c.setAttribute('stroke', 'rgba(20,24,29,.6)');
  svg.append(c);
  const k = Math.max(0, Math.min(1, illum));
  // The lit part: a half disc plus an ellipse whose width follows the illumination.
  const rx = Math.abs(1 - 2 * k) * 8;
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', `M10 2A8 8 0 0 1 10 18A${rx.toFixed(2)} 8 0 0 ${k > 0.5 ? 1 : 0} 10 2Z`);
  p.setAttribute('fill', '#f1f3f6');
  svg.append(p);
  return svg;
}

export interface NmCardCtx {
  units: NmUnits;
  gmaDeg: number | null;
  hHourMin: number | null;
  echelonWord: string;
  /** Lit share of the moon tonight (the bar's icon), or null. */
  moonIllum: number | null;
  keys: boolean;
  R: Rules;
  tanks: boolean;
}

function brgTile(grid: number, mag: number | null, units: NmUnits): HTMLElement {
  const main = mag ?? grid;
  const ref = mag === null ? 'G' : 'M';
  if (units === 'mils') return tile('Bearing', [String(toMils(main)).padStart(4, '0'), small(`mils ${ref}`)], mag !== null ? `grid ${String(toMils(grid)).padStart(4, '0')} mils` : 'grid: set the GMA for magnetic');
  const sub = units === 'both' ? `${toMils(main)} mils ${ref}${mag !== null ? ` · grid ${deg3(grid)}` : ''}` : mag !== null ? `grid ${deg3(grid)}` : 'grid: set the GMA for magnetic';
  return tile('Bearing', [deg3(main), small(ref)], sub);
}

export class NightMarchCard {
  private _el: HTMLDivElement | null = null;
  private _w = 352;
  private _h = 320;
  private _x = -1;
  private _y = -1;
  private _shown = false;

  get isShown(): boolean {
    return this._shown;
  }

  /** The leg being drawn. */
  /** `objStep`: the FUP is laid and the cursor is where the Obj would be (the card reads the FUP against it). */
  showLive(v: NmLive, ctx: NmCardCtx, lengths: number[], northDeg: number, objStep = false): void {
    const root = this._ensure();
    root.replaceChildren();
    this._tone(root, v.tone);
    const bar = el('div', 'ms-nmc-bar');
    if (ctx.moonIllum !== null) bar.append(moonIcon(ctx.moonIllum));
    const title = objStep ? `Obj: ${v.distToObjM !== null ? `${dist(v.distToObjM)} from the FUP` : 'click it'}` : v.distM < 1 ? `Leg ${v.legNo}: click the next turn` : `Leg ${v.legNo} · ${v.magDeg === null ? `${deg3(v.bearingDeg)} G` : `${deg3(v.magDeg)} M`}`;
    bar.append(el('span', 'ms-nmc-title', title), el('span', 'ms-nmc-pill', `${ctx.echelonWord} · ${dist(v.cumM)}`));
    root.append(bar);

    const hero = el('div', 'ms-nmc-hero');
    hero.append(compassDial({ px: 132, bearing: v.distM >= 1 ? v.bearingDeg : null, prev: v.prevBearings, gmaDeg: ctx.gmaDeg, objBrg: v.objBrg, color: TONE_COL[v.tone] === TONE_COL.ok ? '#8ec1ea' : TONE_COL[v.tone], driftDeg: ctx.R.legs?.driftDegPer1000m ?? 3, label: `Leg ${v.legNo} bearing` }));
    const tiles = el('div', 'ms-nmc-tiles');
    tiles.append(brgTile(v.bearingDeg, v.magDeg, ctx.units));
    const cord = el('div', 'ms-nmc-cord');
    cord.append(paceCord(v.distM, 190));
    tiles.append(tile('Paces', [num(v.paces)], `${dist(v.distM)} · total ${num(v.cumPaces)} p${v.climbM >= 10 ? ` · ↑${v.climbM} m` : ''}`, cord));
    tiles.append(tile('Time by night', [dur(v.minNight)], `march so far ${dur(v.cumMin)}${v.terrain ? '' : ' · open Gr'}`));
    hero.append(tiles);
    root.append(hero);

    // Where the leg ends, and what is wrong with it.
    const sec = el('div', 'ms-nmc-sec');
    const row = el('div', 'ms-nmc-row');
    const rv = el('div', 'ms-nmc-rv');
    if (v.landmark) {
      rv.append(`${v.landmark.label}${v.landmark.name ? ` ${v.landmark.name}` : ''} `, v.landmark.distM > 15 ? whereNode(v.landmark.distM, v.landmark.dir, v.landmark.bearingDeg) : 'here');
      rv.dataset.t = 'ok';
    } else if (objStep) {
      rv.textContent = 'FUP (last leg)';
    } else if (v.terrain) {
      rv.textContent = 'No landmark here: guide + light';
      rv.dataset.t = 'warn';
    } else rv.textContent = v.ground ?? 'Pick a feature you can see at night';
    row.append(el('span', 'ms-nmc-rl', 'Ends on'), rv);
    sec.append(row);
    const chips = el('div', 'ms-nmc-chips');
    if (v.crossing) chips.append(chip(TONE_COL.bad, `Crosses ${v.crossing}`));
    if (v.sight === 'night') chips.append(chip('#a78bfa', 'In night sights'));
    else if (v.sight === 'thermal') chips.append(chip('rgba(167,139,250,.55)', 'In thermal range'));
    if (v.skyline) chips.append(chip(TONE_COL.warn, 'Skyline'));
    if (v.long) chips.append(chip(TONE_COL.warn, `Long leg: drift ${v.driftM} m`));
    if (v.ground && v.landmark) chips.append(chip('#7f8893', v.ground));
    if (!chips.childNodes.length) chips.append(chip(TONE_COL.ok, v.distM >= 1 ? 'Clear leg' : 'Start'));
    sec.append(chips);
    if (lengths.length) {
      const rib = el('div', 'ms-nmc-rib');
      rib.append(legRibbon([...lengths, Math.max(1, v.distM)], lengths.length, 326));
      sec.append(rib);
    }
    root.append(sec);

    const os = el('div', 'ms-nmc-sec');
    const orow = el('div', 'ms-nmc-row');
    const ov = el('div', 'ms-nmc-rv');
    const F = ctx.R.fup;
    const minM = ctx.tanks ? F.tankMinM : F.minM, wantM = ctx.tanks ? F.tankWantM : F.wantM;
    if (v.distToObjM !== null) {
      ov.textContent = `${dist(v.distToObjM)} · FUP here: ${v.distToObjM < minM ? 'too close' : v.distToObjM < wantM ? 'at the edge' : 'OK'}`;
      ov.dataset.t = v.distToObjM < minM ? 'bad' : v.distToObjM < wantM ? 'warn' : 'ok';
    } else ov.textContent = 'Obj: click it after the FUP';
    orow.append(el('span', 'ms-nmc-rl', 'To Obj'), ov);
    os.append(orow);
    if (v.distToObjM !== null) {
      const r = el('div', 'ms-nmc-rib');
      r.append(objRuler(v.distToObjM, { nightM: ctx.R.sights.nightM, thermalM: ctx.R.sights.thermalM, minM, wantM }, 326));
      os.append(r);
    }
    root.append(os);
    if (ctx.keys) {
      const ft = el('div', 'ms-nmc-foot');
      if (objStep) ft.append(kbd('Click', 'Obj'), kbd('Esc', 'no Obj'), kbd('⌫', 'back to the route'));
      else ft.append(kbd('Click', 'turn'), kbd('Dbl', 'FUP'), kbd('⌫', 'undo'), kbd('Esc', 'stop'));
      root.append(ft);
    }
    this._finish(root, northDeg);
  }

  /** The pointer on a finished route. */
  showOnLeg(o: NmOnLeg, C: NightMarchChart, ctx: NmCardCtx, northDeg: number): void {
    const root = this._ensure();
    root.replaceChildren();
    const lg = o.leg;
    this._tone(root, lg.tone);
    const bar = el('div', 'ms-nmc-bar');
    if (ctx.moonIllum !== null) bar.append(moonIcon(ctx.moonIllum));
    bar.append(el('span', 'ms-nmc-title', `Leg ${lg.i} of ${C.legs.length} · ${lg.magDeg === null ? `${deg3(lg.bearingDeg)} G` : `${deg3(lg.magDeg)} M`}`), el('span', 'ms-nmc-pill', lg.toFup ? 'to FUP' : `${ctx.echelonWord}`));
    root.append(bar);
    const hero = el('div', 'ms-nmc-hero');
    hero.append(compassDial({ px: 132, bearing: lg.bearingDeg, prev: C.legs.filter((x) => x.i !== lg.i).map((x) => x.bearingDeg), gmaDeg: ctx.gmaDeg, objBrg: null, color: '#8ec1ea', driftDeg: 3, label: `Leg ${lg.i} bearing` }));
    const tiles = el('div', 'ms-nmc-tiles');
    tiles.append(brgTile(lg.bearingDeg, lg.magDeg, ctx.units));
    const cord = el('div', 'ms-nmc-cord');
    cord.append(paceCord(lg.distM, 190, { doneM: o.alongM }));
    tiles.append(tile('Paces here', [num(o.pacesIn), small(`of ${num(lg.paces)}`)], `${num(o.pacesToGo)} to go · ${num(o.fromSpPaces)} from the SP`, cord));
    const T = C.timing;
    const at = T.hHourMin !== null ? clock(T.hHourMin - T.leaveBeforeH + o.atMin) : hRel(-T.leaveBeforeH + o.atMin);
    tiles.append(tile('Column here', [at], `leg ${dur(lg.minNight)} · ${dist(lg.distM)}`));
    hero.append(tiles);
    root.append(hero);
    const sec = el('div', 'ms-nmc-sec');
    const row = el('div', 'ms-nmc-row');
    const rv = el('div', 'ms-nmc-rv');
    if (lg.toFup) {
      rv.textContent = `FUP · ${C.fup.distToObjM !== null ? `${dist(C.fup.distToObjM)} from the Obj` : 'no Obj set'}`;
      rv.dataset.t = C.fup.tone;
    } else if (lg.landmark) {
      rv.textContent = `${lg.landmark.label}${lg.landmark.name ? ` ${lg.landmark.name}` : ''}`;
      rv.dataset.t = 'ok';
    } else {
      rv.textContent = 'No landmark: guide + light';
      rv.dataset.t = 'warn';
    }
    row.append(el('span', 'ms-nmc-rl', 'Ends on'), rv);
    sec.append(row);
    if (lg.notes.length) {
      const chips = el('div', 'ms-nmc-chips');
      for (const n of lg.notes.slice(0, 3)) chips.append(chip(lg.tone === 'bad' ? TONE_COL.bad : TONE_COL.warn, n.length > 44 ? `${n.slice(0, 43)}…` : n));
      sec.append(chips);
    }
    const rib = el('div', 'ms-nmc-rib');
    rib.append(legRibbon(C.legs.map((x) => x.distM), lg.i - 1, 326, C.legs.map((x) => x.tone)));
    sec.append(rib);
    root.append(sec);
    if (ctx.keys) {
      const ft = el('div', 'ms-nmc-foot');
      ft.append(kbd('W', 'night march chart'));
      const lamp = el('span');
      const dot = el('i');
      dot.style.cssText = `display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;background:${LAMP}`;
      lamp.append(dot, `${C.stores.lights} lights · ${C.stores.guides} guides`);
      ft.append(lamp);
      root.append(ft);
    }
    this._finish(root, northDeg);
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

  private _tone(root: HTMLElement, t: NmTone): void {
    const tk = TONE[TONE_KEY[t]];
    root.style.setProperty('--nm-c', t === 'ok' ? '#8ec1ea' : tk.fill);
    root.style.setProperty('--nm-fg', t === 'ok' ? '#14181d' : tk.fg);
  }

  private _finish(root: HTMLDivElement, northDeg: number): void {
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
      e.className = 'ms-nmc';
      e.setAttribute('role', 'status');
      e.setAttribute('aria-live', 'polite');
      document.body.appendChild(e);
      this._el = e;
    }
    return this._el;
  }

  /** Below and right of the pointer; flipped to stay on screen; above the open chart (never over it). */
  private _place(): void {
    const e = this._el;
    if (!e) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const chart = document.querySelector<HTMLElement>('.ms-nmd.ms-open');
    const bottom = chart ? Math.max(EDGE, vh - chart.offsetHeight - 10 - EDGE) : vh - EDGE;
    if (chart && bottom - EDGE < this._h) {
      e.style.display = 'none';
      return;
    }
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
