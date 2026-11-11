/**
 * MovementGuideCards.ts
 *
 * The Mov Detail: a wide card docked at the foot of the map, in the Ground Detail's manner (user, 2026-11-11: "like
 * the bottom card styles switched with keys like the Ground Guide"). Nine tabs, each with its key: 1 Cordon,
 * 2 Picket, 3 Convoy, 4 Mines, 5 Patrol, 6 Ambush, 7 Rd Block, 8 Infil, 9 Water; N opens and closes the card. The card never
 * scrolls, because the keys are pressed while the mouse is busy drawing. It reads in two parts:
 *   1. the answer strip: the card's answer in one big figure and three or four key facts beside it;
 *   2. the band: a fixed height where the card's sections (input, settings, then its tables) run down newspaper
 *      columns. What does not fit across goes to the next page, turned with the same number key (Shift turns back);
 *      the footer says when there is more.
 * The top edge has a grip to make the card taller or lower. Actions: Create on Map, Copy as Text, Clear, close.
 * A row with a place moves the map to it; on Ambush and Rd Block a row picks the site whose layout is drawn.
 */

import Utils from '../../Support/utils';
import { CARDS, PARAMS, type CardId, type CardResult } from './MovementGuide';
import { countWords, dur, hhmm, km, kmAt, kmRange, nearWords, num, riskWord, SOURCE_WORD, type CardCtx } from './MovementGuideText';
import { ambushSketch, band as vband, blockSketch, convoyChart, cordonRing, gauge, infilBand, legRose, patrolProfile, routeProfile, VZ } from './MovementGuideViz';
import type { MercXY } from './MovementGuideScan';
import { axisStrip, figText, GOING_C, GOING_W, reachStrip, srcText, waterSection } from './MovementGuideWaterViz';
import type { WaterReading, WaterRules } from './MovementGuideWater';
import { lensBand, lensesFor, lensRow, lensSummary, LENS_CSS, type WaterLens } from './MovementGuideWaterDetail';
import { WATER_PICS_CSS } from './MovementGuideWaterPics';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));
const BAND = (v: number): string => (v >= 70 ? '#e5484d' : v >= 50 ? '#f28c28' : v >= 30 ? '#f5c518' : '#8a96a3');
const HEIGHT_KEY = 'pams8.movementGuide.cardHeight';

const CSS = `
.mgd{position:absolute;left:10px;right:10px;bottom:10px;z-index:45;height:340px;min-height:220px;display:flex;flex-direction:column;box-sizing:border-box;
 background:#1b1f25;color:#e8ebee;border:1px solid rgba(255,255,255,.16);border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.5);font:13.5px/1.4 system-ui,Segoe UI,Arial,sans-serif}
.mgd-grip{position:absolute;left:50%;top:-1px;transform:translateX(-50%);width:120px;height:14px;padding:0;border:0;background:none;cursor:ns-resize;touch-action:none;z-index:1}
.mgd-grip::before{content:"";position:absolute;left:38px;right:38px;top:5px;height:4px;border-radius:2px;background:#8a96a3}
.mgd-head{flex:none;display:flex;align-items:center;gap:5px;padding:9px 12px 7px;flex-wrap:wrap}
.mgd-name{font-weight:750;font-size:13.5px;margin-right:4px;white-space:nowrap}
.mgd-tab{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px 0 4px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#c3cbd3;cursor:pointer;font:600 13px/1 system-ui,Segoe UI,Arial,sans-serif;white-space:nowrap}
.mgd-tab:hover{background:rgba(255,255,255,.09)}
.mgd-tab.on{background:#2b3a4d;border-color:#4d8fd6;color:#fff}
.mgd-tab .dot{width:6px;height:6px;border-radius:50%;background:#3fb27f}
.mgd-k{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:4px;font:750 12px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
.mgd-sp{flex:1}
.mgd-btn{font:400 13px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:30px;padding:0 10px;white-space:nowrap}
.mgd-btn:hover{background:rgba(255,255,255,.12)}.mgd-btn:disabled{opacity:.4;cursor:default}
.mgd-btn.primary{background:#1f5fae;border-color:#3d84d6;color:#fff}.mgd-btn.primary:hover{background:#2670c4}
.mgd-btn.on{border-color:#00e5ff;color:#00e5ff}
.mgd-chip{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;color:#14181d;background:#8a96a3;white-space:nowrap}
.mgd-sum{flex:none;display:flex;align-items:stretch;padding:7px 16px 8px;background:#20262e;border-top:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.14);gap:0;overflow:hidden}
.mgd-ans{flex:1.6 1 280px;min-width:0;max-width:460px;margin-right:14px;padding:7px 14px 8px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.18)}
.mgd-ans-l{font-size:12px;color:#c3cbd3}
.mgd-ans-v{font-size:22px;font-weight:750;line-height:1.2;color:#fff}
.mgd-ans-s{font-size:12px;color:#c3cbd3;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.mgd-fact{flex:1 1 120px;min-width:0;max-width:260px;padding:0 14px;border-left:1px solid rgba(255,255,255,.14)}
.mgd-ans+.mgd-fact{border-left:0;padding-left:0}
.mgd-fk{font-size:12px;color:#c3cbd3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mgd-fv{font-size:17px;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mgd-fs{font-size:12px;color:#c3cbd3;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.mgd-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:0}
.mgd-band{flex:1 1 auto;min-height:80px;position:relative;padding:10px 16px 6px;overflow:hidden}
.mgd-flow{height:100%;column-width:290px;column-gap:28px;column-fill:auto;column-rule:1px solid rgba(255,255,255,.1)}
.mgd-sec{break-inside:avoid;margin:0 0 12px}
.mgd-sec.flow{break-inside:auto}
.mgd-cap{font-size:12px;font-weight:750;letter-spacing:.04em;text-transform:uppercase;color:#d7dde3;margin:0 0 6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.14);break-after:avoid;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mgd-in{font-size:12.5px;color:#c3cbd3}
.mgd-ok{color:#3fb27f;font-weight:700}
.mgd-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mgd-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 10px}
.mgd-f{display:flex;flex-direction:column;font-size:11.5px;color:#aab3bd;min-width:0}
.mgd-f input,.mgd-f select{width:100%;box-sizing:border-box;min-width:0;margin-top:2px;background:#11161b;color:#e8ebee;border:1px solid #3a4652;border-radius:5px;padding:3px 5px;font-size:12.5px}
.mgd-f.bool{flex-direction:row;align-items:center;gap:6px;color:#d7dde3}.mgd-f.bool input{width:auto;margin:0}
.mgd-t{width:100%;border-collapse:collapse;font-size:12.5px;overflow-wrap:anywhere}
.mgd-t th{text-align:left;color:#aab3bd;font-weight:600;padding:2px 4px;border-bottom:1px solid #3a4652}
.mgd-t td{padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:top}
.mgd-t tr{break-inside:avoid}
.mgd-t tr[data-x],.mgd-t tr[data-choose]{cursor:pointer}
.mgd-t tr[data-x]:hover td,.mgd-t tr[data-choose]:hover td{background:rgba(255,255,255,.06)}
.mgd-t tr.sel td{background:#22364d}
.mgd-why{color:#aab3bd}
.mgd-foot{flex:none;display:flex;align-items:center;gap:8px;padding:6px 12px 8px;font-size:12px;color:#aab3bd;border-top:1px solid rgba(255,255,255,.08)}
.mgd-foot>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mgd-foot .st{color:#ffd166}
.mgd-band svg.mgv{max-height:calc(var(--mgd-bandh,400px) - 64px);width:100%}
.mgd-page{margin-left:auto;margin-right:4px;display:inline-flex;align-items:center;gap:8px;color:#e1e6eb;white-space:nowrap}
.mgd-pic{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
.mgd-dots{display:inline-flex;gap:4px}.mgd-dots>i{width:7px;height:7px;border-radius:50%;background:#4a535e}.mgd-dots>i.on{background:#e8ebee}
`;

export interface CardsModel {
  state: 'off' | 'loading' | 'ready' | 'unavailable';
  error: string | null;
  card: CardId;
  result: CardResult | null;
  pending: boolean;
  status: string | null;
  drawing: boolean;
  inputs: { route: { name: string; pts: number } | null; cordon: string | null; patrolStart: boolean; patrolObj: boolean; infil: boolean; water: string | null };
  ctx: CardCtx;
  /** For the pictures: the ground's height at a point, and the infiltration line as drawn. */
  elevAt?: (p: MercXY) => number;
  infilLine?: MercXY[] | null;
  /** The Water card's figures (gauges, bridge spans, months). */
  waterRules?: WaterRules;
}
export interface CardsCallbacks {
  close: () => void;
  card: (id: CardId) => void;
  input: (what: string) => void;
  param: (card: CardId, key: string, value: unknown) => void;
  action: (what: string, arg?: unknown) => void;
  goTo: (x: number, y: number) => void;
}

interface Fact {
  k: string;
  v: string;
  s?: string;
  c?: string;
}

export class MovementGuideCards {
  private _el: HTMLDivElement | null = null;
  private _host: HTMLElement | null = null;
  private _done = new Set<CardId>();
  private _page = 0;
  private _pages = 1;
  private _pageCard: CardId | null = null;
  private _pageKey = '';
  private _last: CardsModel | null = null;
  /** The Water card's lens (9 again walks the pages, then the lenses). */
  private _lens: WaterLens = 'type';
  /** Going back into a lens: open it on its last page once measured. */
  private _toLastPage = false;
  /** How far down the map's top edge is covered by the host's toolbars (px), from the last layout. */
  topClear = 12;
  private _height = typeof window !== 'undefined' ? Math.max(300, Math.min(520, Math.round(window.innerHeight * 0.5))) : 340;

  constructor(private readonly _cb: CardsCallbacks) {
    try {
      const h = Number(localStorage.getItem(HEIGHT_KEY));
      if (h >= 220 && h <= 1200) this._height = h;
    } catch {
      /* storage blocked */
    }
  }

  get isShown(): boolean {
    return !!this._el?.isConnected;
  }

  mount(host: HTMLElement | null): void {
    if (!host) return;
    if (!document.getElementById('mgd-style')) {
      const st = document.createElement('style');
      st.id = 'mgd-style';
      st.textContent = CSS + LENS_CSS + WATER_PICS_CSS;
      document.head.appendChild(st);
    }
    if (this._el && this._host === host) {
      if (!this._el.isConnected) host.appendChild(this._el);
      return;
    }
    this._el?.remove();
    const el = document.createElement('div');
    el.className = 'mgd';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Mov Detail');
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('change', (e) => this._change(e));
    for (const t of ['pointerdown', 'wheel', 'dblclick']) el.addEventListener(t, (e) => e.stopPropagation());
    host.appendChild(el);
    this._el = el;
    this._host = host;
  }

  hide(): void {
    this._el?.remove();
  }

  destroy(): void {
    this._el?.remove();
    this._el = null;
    this._host = null;
    document.getElementById('mgd-style')?.remove();
  }

  /** Turn the band's page (the same number key again; Shift turns back). True when it turned, false on the last page. */
  turn(dir: 1 | -1 = 1): boolean {
    const next = this._page + dir;
    if (next < 0 || next >= this._pages) return false;
    this._page = next;
    this._applyPage();
    return true;
  }

  /** The Water card's lens shown. */
  get lens(): WaterLens {
    return this._lens;
  }

  /**
   * 9 again: the next page of the Water lens, past its last page the next lens (Shift: back, the previous lens on its last
   * page). True when something changed.
   */
  walkLens(dir: 1 | -1): boolean {
    const m = this._last;
    if (!m || m.card !== 'water' || m.result?.card !== 'water' || !m.result.reading) return false;
    if (this.turn(dir)) return true;
    const L = lensesFor(m.result);
    const i = Math.max(0, L.indexOf(this._lens));
    this._lens = L[(i + dir + L.length) % L.length];
    this._toLastPage = dir < 0;
    this.render(m);
    return true;
  }

  setLens(lens: WaterLens): void {
    this._lens = lens;
    if (this._last) this.render(this._last);
  }

  render(m: CardsModel): void {
    const el = this._el;
    if (!el) return;
    this._last = m;
    if (m.result) this._done.add(m.card);
    if (m.card === 'water' && m.result?.card === 'water' && !lensesFor(m.result).includes(this._lens)) this._lens = 'type';
    const key = `${m.card}|${m.card === 'water' ? this._lens : ''}`;
    if (this._pageKey !== key) {
      this._page = 0;
      this._pageKey = key;
      this._pageCard = m.card;
    }
    const chip =
      m.state === 'loading'
        ? { t: 'Loading terrain', c: '#f5c518' }
        : m.state === 'unavailable'
          ? { t: 'No terrain data', c: '#e5484d' }
          : m.pending
            ? { t: 'Reading terrain…', c: '#f5c518' }
            : null;
    el.style.height = `${this._height}px`;
    el.innerHTML = `
      <button class="mgd-grip" data-grip="1" title="Drag to make the card taller or lower" aria-label="Resize"></button>
      <div class="mgd-head">
        <span class="mgd-name">🛣 Mov Detail</span>
        ${CARDS.map((c, i) => `<button class="mgd-tab${c.id === m.card ? ' on' : ''}" data-card="${c.id}" title="${esc(c.title)} (key ${i + 1})"><span class="mgd-k">${i + 1}</span>${esc(c.label)}${this._done.has(c.id) ? '<span class="dot"></span>' : ''}</button>`).join('')}
        <span class="mgd-sp"></span>
        ${chip ? `<span class="mgd-chip" style="background:${chip.c}">${esc(chip.t)}</span>` : ''}
        <button class="mgd-btn" data-act="close" title="Close (N or Esc)" aria-label="Close"><span class="mgd-k">N</span> ×</button>
      </div>
      ${m.state === 'unavailable' ? '' : this._summary(m)}
      ${m.state !== 'unavailable' && m.card === 'water' && m.result?.card === 'water' ? lensRow(m.result, this._lens) : ''}
      <div class="mgd-band"><div class="mgd-flow">${m.state === 'unavailable' ? this._noData(m) : this._sections(m)}</div></div>
      <div class="mgd-foot">
        ${m.status ? `<span class="st">${esc(m.status)}</span>` : `<span>${esc(m.ctx.dataLine)}. Estimates from the map, not a recce: check on the ground.</span>`}
        <span class="mgd-page" data-page="1"></span>
        <button class="mgd-btn primary" data-act="create" ${m.result ? '' : 'disabled'} title="Put the plan on the map as ordinary symbols">Create on Map</button>
        <button class="mgd-btn" data-act="copy" ${m.result ? '' : 'disabled'} title="The card's brief as text">Copy as Text</button>
        <button class="mgd-btn" data-act="clear" title="Clear this card's input">Clear</button>
      </div>`;
    this._clamp();
    requestAnimationFrame(() => this._measure());
    this._measure();
  }

  // ── layout ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Never taller than the map leaves below the host's own toolbars. */
  private _clamp(): void {
    const el = this._el;
    const host = this._host;
    if (!el || !host) return;
    const r = host.getBoundingClientRect();
    let top = 12;
    if (typeof document.elementFromPoint === 'function') {
      for (let y = 4; y < Math.min(320, r.height / 2); y += 8) {
        const hit = document.elementFromPoint(r.left + 24, r.top + y);
        if (!hit || host.contains(hit)) {
          top = Math.max(12, y + 8);
          break;
        }
        top = y + 16;
      }
    }
    // Lift the card clear of whatever the host lays over the map's bottom edge (a log, a status bar): look up the
    // left and right edges for the first point that is the map or this card.
    let bottom = 10;
    if (typeof document.elementFromPoint === 'function') {
      // The highest point near the bottom that something outside the map covers: the card stands above it.
      for (const x of [r.left + 40, r.right - 40]) {
        let top = 0;
        for (let y = 4; y < 160; y += 4) {
          const hit = document.elementFromPoint(x, r.bottom - y);
          if (hit && !host.contains(hit)) top = y;
        }
        if (top) bottom = Math.max(bottom, top + 8);
      }
    }
    this.topClear = top;
    el.style.bottom = `${bottom}px`;
    el.style.maxHeight = `${Math.max(220, r.height - top - bottom - 10)}px`;
  }

  private _measure(): void {
    const el = this._el;
    if (!el) return;
    const flow = el.querySelector('.mgd-flow') as HTMLElement | null;
    const band = el.querySelector('.mgd-band') as HTMLElement | null;
    if (!flow || !band) return;
    el.style.setProperty('--mgd-bandh', `${band.clientHeight}px`);
    const w = band.clientWidth - 32;
    const pages = w > 0 ? Math.max(1, Math.ceil((flow.scrollWidth - 2) / (w + 28))) : 1;
    this._pages = pages;
    if (this._toLastPage) {
      this._page = pages - 1;
      this._toLastPage = false;
    }
    if (this._page >= pages) this._page = pages - 1;
    this._applyPage();
  }

  private _applyPage(): void {
    const el = this._el;
    if (!el) return;
    const flow = el.querySelector('.mgd-flow') as HTMLElement | null;
    const band = el.querySelector('.mgd-band') as HTMLElement | null;
    if (flow && band) flow.style.transform = `translateX(${-this._page * (band.clientWidth - 32 + 28)}px)`;
    const pg = el.querySelector('[data-page]') as HTMLElement | null;
    if (pg) {
      const key = this._pageCard ? CARDS.findIndex((c) => c.id === this._pageCard) + 1 : 0;
      pg.innerHTML =
        this._pages > 1
          ? `<span class="mgd-dots">${Array.from({ length: this._pages }, (_, i) => `<i class="${i === this._page ? 'on' : ''}"></i>`).join('')}</span>${this._page < this._pages - 1 ? `More: <span class="mgd-k">${key}</span>` : `Back: <span class="mgd-k">⇧</span><span class="mgd-k">${key}</span>`}`
          : '';
    }
  }

  // ── content ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _noData(m: CardsModel): string {
    return `<section class="mgd-sec"><div class="mgd-cap">No terrain data</div><div class="mgd-in">The terrain bundle could not be loaded${m.error ? ` (${esc(m.error)})` : ''}. The cards need it; drawing symbols works as usual.</div><div class="mgd-row" style="margin-top:6px"><button class="mgd-btn" data-act="retry">Try Again</button></div></section>`;
  }

  private _summary(m: CardsModel): string {
    const def = CARDS.find((c) => c.id === m.card)!;
    const lensOn = m.card === 'water' && m.result?.card === 'water' && m.result.reading && m.state === 'ready';
    const a = lensOn ? lensSummary(this._lens, m.result as Extract<CardResult, { card: 'water' }>, m.ctx.params) : this._answer(m);
    const facts = a.facts.map((f) => `<div class="mgd-fact"><div class="mgd-fk">${esc(f.k)}</div><div class="mgd-fv">${f.c ? `<span class="mgd-dot" style="background:${f.c}"></span>` : ''}${esc(f.v)}</div>${f.s ? `<div class="mgd-fs">${esc(f.s)}</div>` : ''}</div>`).join('');
    return `<div class="mgd-sum"><div class="mgd-ans"><div class="mgd-ans-l">${esc(def.title)}</div><div class="mgd-ans-v">${esc(a.v)}</div><div class="mgd-ans-s">${esc(a.s)}</div></div>${facts}</div>`;
  }

  private _answer(m: CardsModel): { v: string; s: string; facts: Fact[] } {
    const r = m.result;
    const def = CARDS.find((c) => c.id === m.card)!;
    if (m.state === 'loading') return { v: 'Loading terrain…', s: 'The cards work out as soon as the terrain bundle is in.', facts: [] };
    if (!r) return { v: 'Give the card its input', s: this._hint(def.input), facts: [] };
    const p = m.ctx.params;
    const routeFacts = (rt: { risk: 'low' | 'medium' | 'high'; lengthM: number; peopleNear: number | null; buaM: number }): Fact[] => [
      { k: 'Route', v: km(rt.lengthM), s: `Risk ${riskWord(rt.risk)}`, c: rt.risk === 'high' ? '#e5484d' : rt.risk === 'medium' ? '#f28c28' : '#3fb27f' },
      { k: 'People within 500 m', v: rt.peopleNear !== null ? `≈ ${num(rt.peopleNear)}` : '…', s: `BUA ${km(rt.buaM)}` },
    ];
    switch (r.card) {
      case 'cordon': {
        const c = r.reading;
        return {
          v: `${num(c.totalMen)} men`,
          s: c.urban ? `${r.layout.sectors.length} Pl sectors of ${Math.round(r.layout.sectorM)} m in ${r.layout.companies} Coy; ${c.outerCordon.roadBlocks} road blocks` : `Rural: ${c.inner.sections} sections on the escape routes; ${c.outerCordon.roadBlocks} road blocks`,
          facts: [
            { k: 'Cordon line', v: km(c.perimeterM), s: `${c.areaKm2.toFixed(2)} km² · ${c.urban ? 'built-up' : 'rural'}` },
            { k: 'Inner / outer', v: `${num(c.inner.men)} / ${num(c.outerCordon.men)}`, s: `${p.menPer100m} per 100 m + rooftops + side Rds` },
            { k: 'People inside', v: c.people !== null ? `≈ ${num(c.people)}` : '…', s: r.ages ? `men 15-49 ≈ ${num(r.ages.males15_49)}` : 'WorldPop est.' },
            { k: 'Sensitive sites', v: String(c.sensitive.length), s: c.hides.length ? `${c.hides.length} possible hides near` : 'no hide recorded near' },
          ],
        };
      }
      case 'picket':
        return {
          v: `${r.plan.pickets.length} pickets · ${num(r.plan.men)} men`,
          s: `${r.plan.mode === 'bothSides' ? 'Route picketing, both sides' : 'Piqueting, fewest posts'}; Rd seen ${r.plan.coveragePct} % within ${r.plan.rangeM} m${r.plan.gaps.length ? `; ${r.plan.gaps.length} gaps` : ''}`,
          facts: [...routeFacts(r.route), { k: 'Check posts', v: String(r.checkPosts.length), s: 'junctions that cannot be bypassed' }, { k: 'Clear first', v: String(r.clear.length), s: r.clear[0] ? `${r.clear[0].label} ${kmAt(r.clear[0].chainM)}` : 'nothing scored 50+' }],
        };
      case 'convoy': {
        const c = r.plan;
        return {
          v: `${c.packets.length} packets · ${dur(c.totalMin)}`,
          s: `SP ${hhmm(c.packets[0].spMin)} · last clears RP ${hhmm(c.packets[c.packets.length - 1].rpMin)} · by ${p.light}`,
          facts: [...routeFacts(r.route), { k: 'Bounds', v: String(c.bounds.length), s: `about ${p.boundKm} km, ending at safe halts` }, { k: 'To clear', v: String(c.bounds.reduce((a, b) => a + b.clear.length, 0)), s: 'dangers scoring 50+' }],
        };
      }
      case 'mines':
        return {
          v: `${r.sites.length} likely site${r.sites.length === 1 ? '' : 's'}`,
          s: r.sites[0] ? `Worst: ${r.sites[0].why} at ${kmAt(r.sites[0].chainM)}` : 'None scored high enough',
          facts: [...routeFacts(r.route), { k: 'Culverts', v: String(r.sites.filter((s) => s.kind === 'culvert').length) }, { k: 'Slow / turn places', v: String(r.sites.filter((s) => s.kind === 'mine').length) }],
        };
      case 'patrol': {
        const o = r.out;
        if (!o) return { v: 'No route', s: 'The objective cannot be reached on foot from the start: move one of them.', facts: [] };
        return {
          v: `${km(o.lengthM)} · ${dur(o.minNight)} by night`,
          s: `${o.legs.length} legs${o.fmp ? `, FMP ${km(o.lengthM - o.fmp.chainM)} short` : ''}; route in ${r.back ? km(r.back.lengthM) : '-'}${r.back?.sameWayBack ? ' (same way!)' : ', a different way'}`,
          facts: [
            { k: 'By day', v: dur(o.minDay) },
            { k: 'Exposed', v: String(o.exposed.length), s: m.ctx.threatSet ? 'to the threat or high Gr' : 'to high Gr (no threat set)' },
            { k: 'Skylines', v: String(o.skyline.length), s: `obstacles ${o.obstacles.length}` },
            { k: 'Still meets', v: `${r.routes.met.roads} % Rd`, s: `villages ${r.routes.met.villages} %, wood edges ${r.routes.met.woodEdges} %` },
          ],
        };
      }
      case 'ambush': {
        const s = r.sites[r.chosen];
        return {
          v: s ? `Site ${s.rank} · ${s.score}` : 'No site',
          s: s ? `${s.layout.shape} layout at ${kmAt(s.chainM)}, fire from the ${s.layout.side === 'L' ? 'left' : 'right'}, MP ${s.layout.meetingM} m back` : 'No stretch where the target cannot leave the Rd beside cover.',
          facts: [...routeFacts(r.route), { k: 'Sites', v: String(r.sites.length), s: 'click a row for its layout' }, { k: 'Withdrawal', v: s ? `${s.layout.withdrawalCoverPct} %` : '-', s: 'in cover' }],
        };
      }
      case 'block': {
        const s = r.sites[r.chosen];
        return {
          v: s ? `Site ${s.rank} · ${s.score}` : 'No site',
          s: s ? `${kmAt(s.chainM)}: ${s.parts.filter((q) => q.ok).map((q) => q.what).slice(0, 2).join(', ')}` : 'No stretch round a bend or over a crest with NO-GO on both sides.',
          facts: [...routeFacts(r.route), { k: 'Sites', v: String(r.sites.length), s: 'click a row' }, { k: 'Flanking Posns', v: s ? String(s.positions.length) : '-', s: s?.positions[0] ? `best sees ${s.positions[0].seesPct} %` : '' }],
        };
      }
      case 'infil': {
        const q = r.reading;
        return {
          v: `${q.lanes.length} lanes · ${q.posts.filter((x) => x.source === 'new').length} new posts`,
          s: `The band is ${q.seenPct} % seen now; the lanes ${q.afterPct} % seen with the new posts`,
          facts: [
            { k: 'Existing posts', v: String(q.existing.length) },
            { k: 'Band', v: `${km(p.bandM)} each side`, s: `posts see ${km(p.rangeM)} at night` },
            { k: 'Longest lane', v: q.lanes.length ? km(Math.max(...q.lanes.map((l) => l.lengthM))) : '-' },
          ],
        };
      }
      case 'water': {
        const w = r.reading;
        if (!w) {
          return r.mode === 'axis'
            ? { v: 'No water on the axis', s: 'The axis crosses no canal, river, drain or water the data shows.', facts: [] }
            : { v: 'No water here', s: 'Nothing within 500 m: click nearer a canal, river or drain.', facts: [] };
        }
        const t = w.verdict.tanks;
        const tankable = w.crossings.filter((q) => q.tankable).length;
        const pre = r.mode === 'axis' && r.axis ? `${r.chosen + 1} of ${r.axis.obstacles.length}: ` : '';
        return {
          v: `${pre}${w.annex ? `${w.annex}. ` : ''}${w.typeLabel}`,
          s: `${w.name ? `${w.name} · ` : ''}${figText(w.width)} wide · tanks ${GOING_W[t.v]}: ${t.why}`,
          facts: [
            { k: 'Tanks', v: `${GOING_W[t.v]}`, s: `wheels ${GOING_W[w.verdict.wheels.v]} · foot ${GOING_W[w.verdict.foot.v]}`, c: GOING_C[t.v] },
            { k: `Home bank ${w.home.dir}`, v: figText(w.home.aboveWater.src !== 'none' ? w.home.aboveWater : w.home.aboveLand), s: srcText(w.home.aboveWater.src !== 'none' ? w.home.aboveWater : w.home.aboveLand) },
            { k: `Far bank ${w.far.dir}`, v: figText(w.far.aboveWater.src !== 'none' ? w.far.aboveWater : w.far.aboveLand), s: srcText(w.far.aboveWater.src !== 'none' ? w.far.aboveWater : w.far.aboveLand) },
            { k: 'Depth', v: figText(w.depth), s: srcText(w.depth) },
            { k: 'Crossings', v: String(w.crossings.length), s: `${tankable} class 60 · within ${p.crossingsKm} km` },
          ],
        };
      }
    }
  }

  private _hint(input: string): string {
    switch (input) {
      case 'cordon':
        return 'Click a Town (the cordon goes round its built-up area), Draw Area, or select a placed area and Use Selected.';
      case 'route':
        return 'Draw Route, or select a placed line and Use Selected. One route serves Picket, Convoy, Mines, Ambush and Rd Block.';
      case 'patrol':
        return 'Click Start, then Objective.';
      case 'water':
        return 'Click the Bank (click on your own side, a little off the water), Draw Axis across several obstacles, Along the Reach for a strip, or Use Selected (a point, an AT Ditch / DCB, an axis).';
      default:
        return 'Draw the line to watch (a border, the LoC or your own line) and say which side the enemy is on.';
    }
  }

  private _sections(m: CardsModel): string {
    // The Water card reads through its lenses (the input and settings sit on the Type lens).
    if (m.card === 'water' && m.result?.card === 'water' && m.result.reading && m.waterRules)
      return lensBand(this._lens, m.result, m.waterRules, m.ctx.params, this._inputSec(m) + this._formSec(m));
    // The picture first (the eye goes to it), then the input and settings, then the tables.
    return (m.result ? this._picture(m) : '') + this._inputSec(m) + this._formSec(m) + (m.result ? this._result(m) : '');
  }

  private _picture(m: CardsModel): string {
    const r = m.result!;
    const p = m.ctx.params;
    const sec = (title: string, body: string) => (body ? `<section class="mgd-sec"><div class="mgd-cap">${esc(title)}</div>${body}</section>` : '');
    switch (r.card) {
      case 'cordon':
        return sec('Cordon at a glance', cordonRing(r.reading, r.layout));
      case 'picket': {
        const pk = r.plan.pickets.map((k, i) => ({ from: k.coversFromM, to: k.coversToM, side: k.side, n: i + 1 }));
        const prof = routeProfile(r.route, { pickets: pk, gaps: r.plan.gaps, marks: r.checkPosts.map((c) => ({ m: c.chainM, label: 'CP', c: VZ.blue, shape: 'square' as const })) });
        const perKm = r.route.lengthM > 0 ? (r.plan.pickets.length / (r.route.lengthM / 1000)).toFixed(1) : '0';
        const seen = r.plan.coveragePct;
        return sec('Route · picket reach', prof + `<div class="mgd-pic">${gauge(seen, 'Rd seen', seen >= 80 ? VZ.green : seen >= 50 ? VZ.yellow : VZ.red)}<div class="mgd-in" style="max-width:150px"><b style="font-size:18px;color:#fff">${perKm}</b> pickets a km<br>${r.plan.gaps.length} gaps for patrols<br>${r.timings.length ? `last up +${dur(Math.max(...r.timings.map((t) => t.upByMin)))}` : ''}</div></div>`);
      }
      case 'convoy':
        return sec('Packets · time vs distance', convoyChart(r.route, r.plan, r.plan.speedKmh)) + sec('Route · bounds', routeProfile(r.route, { bounds: r.plan.bounds.slice(0, -1).map((b) => ({ toM: b.toM, n: b.n })) }));
      case 'mines':
        return sec('Likely sites · route', routeProfile(r.route, { marks: r.sites.map((s) => ({ m: s.chainM, label: String(s.rank), c: vband(s.score), shape: 'diamond' as const })) }));
      case 'patrol':
        return r.out && m.elevAt ? sec('Route out · ground and legs', patrolProfile(r.out, m.elevAt)) + sec('Leg bearings', legRose(r.out)) : '';
      case 'ambush': {
        const s = r.sites[r.chosen];
        return (s ? sec(`Site ${s.rank} from above`, ambushSketch(s, Number(p.kzM))) : '') + sec('Sites · route', routeProfile(r.route, { marks: r.sites.map((q, i) => ({ m: q.chainM, label: String(q.rank), c: i === r.chosen ? VZ.red : VZ.orange, shape: 'pin' as const })), highlight: s ? { fromM: s.chainM - Number(p.kzM) / 2, toM: s.chainM + Number(p.kzM) / 2 } : null }));
      }
      case 'block': {
        const s = r.sites[r.chosen];
        return (s ? sec(`Site ${s.rank}: the approach`, blockSketch(s, Number(p.approachM))) : '') + sec('Sites · route', routeProfile(r.route, { marks: r.sites.map((q, i) => ({ m: q.chainM, label: String(q.rank), c: i === r.chosen ? VZ.red : VZ.orange, shape: 'square' as const })), highlight: s ? { fromM: s.approachFromM, toM: s.chainM } : null }));
      }
      case 'infil': {
        const q = r.reading;
        const pics = `<div class="mgd-pic">${gauge(q.seenPct, 'band seen now', q.seenPct >= 70 ? VZ.green : q.seenPct >= 40 ? VZ.yellow : VZ.red)}${gauge(q.afterPct, 'lanes seen after', q.afterPct >= 80 ? VZ.green : q.afterPct >= 50 ? VZ.yellow : VZ.red)}</div>`;
        return sec('Lanes across the band', m.infilLine && m.infilLine.length >= 2 ? infilBand(q, m.infilLine, Number(p.enemySide) < 0 ? -1 : 1) : '') + sec('Before and after the new posts', pics);
      }
      case 'water': {
        const w = r.reading;
        return (
          (r.axis && r.axis.obstacles.length ? sec(`Along the axis (${r.axis.obstacles.length}): click one`, axisStrip(r.axis, r.chosen)) : '') +
          (w ? sec(`Cross-section · home left, far right${w.pending ? ' (loading)' : ''}`, waterSection(w)) : '') +
          (r.reach ? sec(`Along the reach · ${km(r.reach.lengthM)}`, reachStrip(r.reach) + '<div class="mgd-in">Bars: width. Lines: home (green) and far (red) bank. N narrowest, L lowest far bank, B a crossing.</div>') : '')
        );
      }
    }
  }

  private _inputSec(m: CardsModel): string {
    const def = CARDS.find((c) => c.id === m.card)!;
    const i = m.inputs;
    if (m.drawing) return `<section class="mgd-sec"><div class="mgd-cap">Input</div><div class="mgd-in" style="margin-bottom:6px">Drawing on the map: Enter or double-click finishes, Backspace undoes a point, Esc stops.</div><button class="mgd-btn" data-input="stopDrawing">Stop Drawing</button></section>`;
    let btns = '';
    let have = '';
    switch (def.input) {
      case 'cordon':
        btns = `<button class="mgd-btn" data-input="pickTown">Click a Town</button><button class="mgd-btn" data-input="drawArea">Draw Area</button><button class="mgd-btn" data-input="useSelected">Use Selected</button>`;
        have = i.cordon ? `<span class="mgd-ok">✓</span> ${esc(i.cordon)}` : 'No cordon yet';
        break;
      case 'route':
        btns = `<button class="mgd-btn" data-input="drawRoute">Draw Route</button><button class="mgd-btn" data-input="useSelected">Use Selected</button>`;
        have = i.route ? `<span class="mgd-ok">✓</span> ${esc(i.route.name)}` : 'No route yet';
        break;
      case 'patrol':
        btns = `<button class="mgd-btn${i.patrolStart ? ' on' : ''}" data-input="patrolStart">${i.patrolStart ? '✓ ' : ''}Start</button><button class="mgd-btn${i.patrolObj ? ' on' : ''}" data-input="patrolObj">${i.patrolObj ? '✓ ' : ''}Objective</button>`;
        have = i.patrolStart && i.patrolObj ? '<span class="mgd-ok">✓</span> start and objective set' : 'Click Start, then Objective';
        break;
      case 'water': {
        const w = m.result?.card === 'water' ? m.result.reading : null;
        btns = `<button class="mgd-btn" data-input="waterPoint">Click the Bank</button><button class="mgd-btn" data-input="waterAxis">Draw Axis</button><button class="mgd-btn" data-input="waterReach">Along the Reach</button><button class="mgd-btn" data-input="useSelected">Use Selected</button><button class="mgd-btn" data-act="swapHome" ${w ? '' : 'disabled'} title="Swap home and far bank">⇄ Swap Home</button>`;
        have = i.water ? `<span class="mgd-ok">✓</span> ${esc(i.water)}${w ? ` · home ${esc(w.home.dir)} (${esc(w.homeWhy)})` : ''}` : 'No input yet';
        break;
      }
      default:
        btns = `<button class="mgd-btn" data-input="drawLine">Draw Line</button><button class="mgd-btn" data-input="useSelected">Use Selected</button>`;
        have = i.infil ? '<span class="mgd-ok">✓</span> line drawn' : 'No line yet';
    }
    return `<section class="mgd-sec"><div class="mgd-cap">Input</div><div class="mgd-row">${btns}</div><div class="mgd-in" style="margin-top:5px">${have}</div></section>`;
  }

  private _formSec(m: CardsModel): string {
    const specs = PARAMS[m.card];
    if (!specs.length) return '';
    const p = m.ctx.params;
    const f = specs
      .map((s) => {
        const v = p[s.key];
        if (s.type === 'bool') return `<label class="mgd-f bool"><input type="checkbox" data-param="${s.key}" ${v ? 'checked' : ''}/>${esc(s.label)}</label>`;
        if (s.type === 'select') return `<label class="mgd-f">${esc(s.label)}<select data-param="${s.key}">${s.options!.map((o) => `<option value="${esc(o.value)}" ${String(v) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
        if (s.type === 'time') return `<label class="mgd-f">${esc(s.label)}<input type="time" data-param="${s.key}" value="${esc(v)}"/></label>`;
        return `<label class="mgd-f">${esc(s.label)}${s.unit ? ` (${esc(s.unit)})` : ''}<input type="number" data-param="${s.key}" value="${esc(v)}" min="${s.min ?? ''}" max="${s.max ?? ''}" step="${s.step ?? 1}"/></label>`;
      })
      .join('');
    return `<section class="mgd-sec"><div class="mgd-cap">Settings</div><div class="mgd-form">${f}</div></section>`;
  }

  private _xy(x: number, y: number): string {
    return `data-x="${x}" data-y="${y}"`;
  }
  private _sec(title: string, body: string, flow = false): string {
    return `<section class="mgd-sec${flow ? ' flow' : ''}"><div class="mgd-cap">${esc(title)}</div>${body}</section>`;
  }
  private _dangers(r: Extract<CardResult, { route: any }>['route']): string {
    return this._sec('Route', `<div class="mgd-in">${km(r.lengthM)} · Risk <b style="color:${r.risk === 'high' ? '#ff6b6f' : r.risk === 'medium' ? '#f5a35a' : '#3fb27f'}">${riskWord(r.risk)}</b><br>${esc(countWords(r))}${r.placesPassed.length ? `<br>Places: ${esc(r.placesPassed.slice(0, 6).map((p) => p.name ?? p.kind).join(', '))}` : ''}</div>`);
  }

  private _result(m: CardsModel): string {
    const r = m.result!;
    const p = m.ctx.params;
    switch (r.card) {
      case 'cordon': {
        const c = r.reading;
        const y = r.layout;
        const roof = y.posts.filter((q) => q.kind === 'rooftop');
        const side = y.posts.filter((q) => q.kind === 'sideRoad');
        const rb = y.posts.filter((q) => q.kind === 'roadBlock');
        const escp = y.posts.filter((q) => q.kind === 'escape');
        const by = new Map<string, number>();
        for (const s of c.sensitive) by.set(s.label, (by.get(s.label) ?? 0) + 1);
        const comp = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        return (
          this._sec(
            `Inner cordon · ${c.urban ? 'built-up' : 'rural'}`,
            c.urban
              ? `<div class="mgd-in">${num(c.inner.perimeterMen)} on the line + ${num(c.inner.rooftopMen)} rooftops (${km(c.rooftopM)}, ${roof.length} sections) + ${num(c.inner.sideRoadMen)} side roads (${side.length}) = <b>${num(c.inner.men)}</b></div>`
              : `<div class="mgd-in">A section on each escape route: <b>${c.inner.sections}</b> sections, ${num(c.inner.men)} men</div>`,
          ) +
          (c.urban
            ? this._sec(`Platoon sectors (${y.sectors.length})`, `<table class="mgd-t"><tr><th>Sector</th><th>Along</th><th>Men</th><th>Faces</th></tr>${y.sectors.map((s) => `<tr ${this._xy(s.x, s.y)}><td>${esc(s.label)}${s.rooftop ? ' <span class="mgd-why">+ roof</span>' : ''}</td><td>${Math.round(s.fromM)}-${Math.round(s.toM)} m</td><td>${s.men}</td><td>${comp[Math.round(s.facingDeg / 45) % 8]}</td></tr>`).join('')}</table>`, true)
            : this._sec('Escape routes', `<table class="mgd-t">${escp.map((q) => `<tr ${this._xy(q.x, q.y)}><td>${esc(q.label)}</td><td>${q.men}</td></tr>`).join('')}</table>`, true)) +
          this._sec(`Outer cordon · ${km(p.outerRingM)} out`, `<div class="mgd-in">${rb.length} road blocks, ${num(c.outerCordon.men)} men</div><table class="mgd-t">${rb.map((q) => `<tr ${this._xy(q.x, q.y)}><td>${esc(q.label)}</td><td>${q.men} men</td></tr>`).join('')}</table>`) +
          this._sec(
            'Inside',
            `<div class="mgd-in">${c.people !== null ? `≈ ${num(c.people)} people` : 'people: loading'}${r.ages ? `<br>men 15-49 ≈ ${num(r.ages.males15_49)} · under 15 ≈ ${num(r.ages.under15)} · over 65 ≈ ${num(r.ages.over65)}` : ''}</div><div class="mgd-in">${by.size ? `Sensitive: ${esc([...by].map(([k, n]) => `${n} ${k}`).join(', '))}` : 'No sensitive site recorded'}</div>${c.hides.length ? `<div class="mgd-in">Possible hides: ${esc(c.hides.slice(0, 8).map((h) => `${h.label} ${km(h.distM)}`).join(', '))}</div>` : ''}`,
          )
        );
      }
      case 'picket': {
        const pl = r.plan;
        return (
          this._dangers(r.route) +
          this._sec(
            `${pl.mode === 'bothSides' ? 'Route picketing' : 'Piqueting'} (${pl.pickets.length})`,
            `<table class="mgd-t"><tr><th>No</th><th>At</th><th>On</th><th>Sees</th><th>Up by</th></tr>${pl.pickets.map((k, i) => `<tr ${this._xy(k.x, k.y)}><td>P${i + 1} ${k.side}</td><td>${kmAt(k.chainM)}<br><span class="mgd-why">${k.offsetM} m off${k.riseM > 0 ? `, +${k.riseM} m` : ''}</span></td><td>${esc(k.name ? `${SOURCE_WORD[k.source]}: ${k.name}` : SOURCE_WORD[k.source])}</td><td>${kmRange(k.coversFromM, k.coversToM)}</td><td>+${dur(r.timings[i]?.upByMin ?? 0)}</td></tr>`).join('')}</table>${pl.gaps.length ? `<div class="mgd-in" style="margin-top:4px">Gaps no picket sees: ${pl.gaps.map((g) => kmRange(g.fromM, g.toM)).join(', ')}</div>` : ''}`,
            true,
          ) +
          this._sec('Check posts', r.checkPosts.length ? `<table class="mgd-t">${r.checkPosts.map((c, i) => `<tr ${this._xy(c.x, c.y)}><td>CP ${i + 1}</td><td>${kmAt(c.chainM)}</td><td>${esc(c.why)}</td></tr>`).join('')}</table>` : '<div class="mgd-in">No junction that cannot be bypassed.</div>') +
          this._sec('Clear first', r.clear.length ? `<table class="mgd-t">${r.clear.map((s, i) => `<tr ${this._xy(s.x, s.y)}><td><span class="mgd-dot" style="background:${BAND(s.score)}"></span>${i + 1}</td><td>${kmAt(s.fromM)}</td><td><b>${esc(s.label)}</b> <span class="mgd-why">${esc(s.why)}</span></td></tr>`).join('')}</table>` : '<div class="mgd-in">Nothing scored 50 or more.</div>', true) +
          this._sec('Casevac (straight line)', r.casevac.map((c) => `<div class="mgd-in">${esc(c.where)}: ${esc(nearWords(c.c.at, c.c.hospital))}<br><span class="mgd-why">LS ${esc(nearWords(c.c.at, c.c.hls))}</span></div>`).join(''))
        );
      }
      case 'convoy': {
        const c = r.plan;
        return (
          this._dangers(r.route) +
          this._sec('Packets', `<table class="mgd-t"><tr><th>Packet</th><th>Veh</th><th>SP</th><th>RP</th></tr>${c.packets.map((k) => `<tr><td>${k.n}</td><td>${k.vehicles}</td><td>${hhmm(k.spMin)}</td><td>${hhmm(k.rpMin)}</td></tr>`).join('')}</table><div class="mgd-in" style="margin-top:4px">Run ${dur(c.runMin)}${c.halts ? `, ${c.halts} halt${c.halts > 1 ? 's' : ''}` : ''}</div>`) +
          this._sec(
            'Bounds · clear before the first packet',
            `<table class="mgd-t"><tr><th>Bound</th><th>Km</th><th>In / out</th><th>Clear</th></tr>${c.bounds.map((b) => `<tr ${this._xy(b.x, b.y)}><td>B${b.n}</td><td>${kmRange(b.fromM, b.toM)}</td><td>${hhmm(b.firstInMin)}<br>${hhmm(b.lastOutMin)}</td><td>${b.clear.length ? b.clear.slice(0, 4).map((s) => `<span class="mgd-dot" style="background:${BAND(s.score)}"></span>${esc(s.label)} ${kmAt(s.chainM)}`).join('<br>') : '<span class="mgd-why">nothing to clear</span>'}${b.clear.length > 4 ? `<br><span class="mgd-why">+${b.clear.length - 4} more</span>` : ''}</td></tr>`).join('')}</table><div class="mgd-in" style="margin-top:4px">Bounds end at safe halts: no danger within 300 m, not built-up, a way off the Rd.</div>`,
            true,
          )
        );
      }
      case 'mines':
        return this._dangers(r.route) + this._sec(`Ranked (${r.sites.length})`, `<table class="mgd-t"><tr><th>#</th><th>At</th><th>Why</th></tr>${r.sites.map((s) => `<tr ${this._xy(s.x, s.y)}><td><span class="mgd-dot" style="background:${BAND(s.score)}"></span>${s.rank}</td><td>${kmAt(s.chainM)}</td><td>${esc(s.why)}</td></tr>`).join('')}</table><div class="mgd-in" style="margin-top:4px">From the ground only: no record of past incidents is in the data.</div>`, true);
      case 'patrol': {
        const o = r.out;
        const b = r.back;
        if (!o) return this._sec('No route', '<div class="mgd-in">The objective cannot be reached on foot from the start (water, cliffs or marsh between). Move the start or the objective.</div>');
        const legs = (c: NonNullable<typeof o>) =>
          `<table class="mgd-t"><tr><th>Leg</th><th>Brg</th><th>Dist</th><th>Paces</th><th>Night</th><th>Ends at</th></tr>${c.legs.map((l) => `<tr ${this._xy(l.to[0], l.to[1])}><td>${l.i + 1}</td><td>${String(Math.round(l.bearingDeg)).padStart(3, '0')}°</td><td>${Math.round(l.distM)} m</td><td>${num(l.paces)}</td><td>${dur(l.minNight)}</td><td>${l.endFeature ? esc(`${l.endFeature.label}${l.endFeature.name ? ` (${l.endFeature.name})` : ''}`) : '<span class="mgd-why">count paces</span>'}</td></tr>`).join('')}</table>`;
        const notes = [...o.exposed, ...o.skyline].slice(0, 6).map((s) => `${kmRange(s.fromM, s.toM)}: ${esc(s.why)}`);
        return (
          this._sec('Night march chart · route out', legs(o) + (o.fmp ? `<div class="mgd-in" style="margin-top:4px">FMP ${km(o.lengthM - o.fmp.chainM)} short of the objective.</div>` : ''), true) +
          (notes.length || o.obstacles.length ? this._sec('On the way out', `<div class="mgd-in">${notes.join('<br>')}${o.obstacles.length ? `<br>Obstacles: ${o.obstacles.map((x) => `${esc(x.label)} ${kmAt(x.chainM)}`).join(', ')}` : ''}${o.villages.length ? `<br>Villages: ${esc(o.villages.map((v) => v.name ?? 'village').join(', '))}` : ''}</div>`) : '') +
          (b ? this._sec('Route in (a different way)', legs(b) + (b.sameWayBack || o.sameWayBack ? '<div class="mgd-in" style="color:#f5a35a">The route in runs along the route out.</div>' : ''), true) : '') +
          this._sec('Notes', '<div class="mgd-in">Grid bearings: add the declination for magnetic. 120 paces = 100 m. Night times from the foot tables and Tobler on slopes.</div>')
        );
      }
      case 'ambush': {
        const s = r.sites[r.chosen];
        return (
          this._dangers(r.route) +
          this._sec('Sites (click one)', r.sites.length ? `<table class="mgd-t"><tr><th>#</th><th>At</th><th>Score</th><th>Layout</th></tr>${r.sites.map((q, i) => `<tr data-choose="${i}" class="${i === r.chosen ? 'sel' : ''}"><td>${q.rank}</td><td>${kmAt(q.chainM)}</td><td><span class="mgd-dot" style="background:${BAND(q.score)}"></span>${q.score}</td><td>${q.layout.shape}, fire ${q.layout.side === 'L' ? 'left' : 'right'}</td></tr>`).join('')}</table>` : '<div class="mgd-in">No stretch where the target cannot leave the Rd beside cover.</div>') +
          (s
            ? this._sec(`Site ${s.rank}: ${s.layout.shape} layout`, `${s.parts.map((q) => `<div class="mgd-in">${q.ok ? '<span class="mgd-ok">+</span>' : '<span style="color:#ff6b6f">−</span>'} ${esc(q.what)}</div>`).join('')}<div class="mgd-in" style="margin-top:4px">Killing zone ${p.kzM} m (red), fire group (blue), stop groups S1 S2, meeting point MP ${s.layout.meetingM} m back.</div><div class="mgd-row" style="margin-top:6px"><button class="mgd-btn" ${this._xy(s.x, s.y)} data-goto="1">Show on Map</button></div>`)
            : '')
        );
      }
      case 'block': {
        const s = r.sites[r.chosen];
        return (
          this._dangers(r.route) +
          this._sec('Sites (click one)', r.sites.length ? `<table class="mgd-t"><tr><th>#</th><th>At</th><th>Score</th><th>Posns</th></tr>${r.sites.map((q, i) => `<tr data-choose="${i}" class="${i === r.chosen ? 'sel' : ''}"><td>${q.rank}</td><td>${kmAt(q.chainM)}</td><td><span class="mgd-dot" style="background:${BAND(q.score)}"></span>${q.score}</td><td>${q.positions.length}</td></tr>`).join('')}</table>` : '<div class="mgd-in">None: no stretch round a bend or over a crest with NO-GO on both sides.</div>') +
          (s
            ? this._sec(`Site ${s.rank}`, `${s.parts.map((q) => `<div class="mgd-in">${q.ok ? '<span class="mgd-ok">+</span>' : '<span style="color:#ff6b6f">−</span>'} ${esc(q.what)}</div>`).join('')}${s.positions.map((q, i) => `<div class="mgd-in">A${i + 1}: ${q.side === 'L' ? 'left' : 'right'} ${q.offM} m off, ${q.riseM >= 0 ? `+${q.riseM}` : q.riseM} m, sees ${q.seesPct} % of the approach</div>`).join('')}<div class="mgd-row" style="margin-top:6px"><button class="mgd-btn" ${this._xy(s.x, s.y)} data-goto="1">Show on Map</button></div>`)
            : '')
        );
      }
      case 'infil': {
        const q = r.reading;
        const nw = q.posts.filter((x) => x.source === 'new');
        return (
          this._sec(`Lanes (${q.lanes.length})`, `<table class="mgd-t"><tr><th>Lane</th><th>Crosses</th><th>Length</th><th>Seen</th></tr>${q.lanes.map((l) => `<tr ${this._xy(l.path[Math.floor(l.path.length / 2)][0], l.path[Math.floor(l.path.length / 2)][1])}><td>L${l.n}</td><td>${esc(l.where)}</td><td>${km(l.lengthM)}</td><td>${l.seenPct} %</td></tr>`).join('')}</table>`) +
          this._sec(`Anti-infiltration posts (${nw.length})`, `<table class="mgd-t">${nw.map((x) => `<tr ${this._xy(x.x, x.y)}><td>P${x.n}</td><td>${esc(x.name ?? 'new post')}</td><td>sees ${x.coversPct} % of the lanes</td></tr>`).join('')}</table><div class="mgd-in" style="margin-top:4px">${q.existing.length} existing posts in the data (grey E on the map).</div>`, true)
        );
      }
      case 'water':
        return this._water(r, p);
    }
  }

  private _water(r: Extract<CardResult, { card: 'water' }>, p: Record<string, any>): string {
    let out = '';
    if (r.axis) {
      out += this._sec(
        `Obstacles on the axis (${r.axis.obstacles.length})`,
        r.axis.obstacles.length
          ? `<table class="mgd-t"><tr><th>#</th><th>At</th><th>Type</th><th>Tanks</th></tr>${r.axis.obstacles.map((o, i) => `<tr data-choose="${i}" class="${i === r.chosen ? 'sel' : ''}"><td>${i + 1}</td><td>${kmAt(o.chainM)}</td><td>${esc(`${o.reading.annex ? `${o.reading.annex}. ` : ''}${o.reading.typeLabel}`)}${o.reading.name ? `<br><span class="mgd-why">${esc(o.reading.name)}</span>` : ''}</td><td><span class="mgd-dot" style="background:${GOING_C[o.reading.verdict.tanks.v]}"></span>${GOING_W[o.reading.verdict.tanks.v]}</td></tr>`).join('')}</table>`
          : '<div class="mgd-in">The axis crosses no water the data shows.</div>',
      );
    }
    const w: WaterReading | null = r.reading;
    if (!w) return out;
    const row = (k: string, v: string, src: string) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td><td class="mgd-why">${esc(src)}</td></tr>`;
    const bankRows = (name: string, b: WaterReading['home']) =>
      row(`${name} ${b.dir}: above water`, figText(b.aboveWater), srcText(b.aboveWater)) +
      row(`${name} ${b.dir}: above land`, figText(b.aboveLand), srcText(b.aboveLand)) +
      (b.marshM ? row(`${name}: marsh beside`, `${b.marshM} m`, 'Map class / wet layer') : '');
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][w.season.month - 1];
    out += this._sec(
      `${w.annex ? `IBB Annex P ${w.annex}: ` : ''}${w.typeLabel}`,
      `<div class="mgd-in"><b>Why:</b> ${esc(w.typeWhy.join('; '))} <span class="mgd-why">(${esc(w.typeSrc)})</span></div><div class="mgd-in" style="margin-top:3px"><b>${month}${w.season.wet ? ', monsoon' : ', dry season'}:</b> ${esc(w.season.text)}</div>${w.notes.length ? `<div class="mgd-in" style="margin-top:3px">${w.notes.map((n) => `· ${esc(n)}`).join('<br>')}</div>` : ''}`,
    );
    out += this._sec(
      'Figures and where they come from',
      `<table class="mgd-t">${row('Width', figText(w.width), srcText(w.width))}${row('Depth', figText(w.depth), srcText(w.depth))}${w.current.src !== 'none' ? row('Current', figText(w.current, 'm/s'), srcText(w.current)) : ''}${w.bed ? row('Bed', w.bed, 'Sheet reach') : ''}${bankRows('Home', w.home)}${bankRows('Far', w.far)}${w.sheetBanks ? row('Sheet banks', [w.sheetBanks.a, w.sheetBanks.b].filter((v) => v !== null).map((v) => `${v} m`).join(' / '), 'side not recorded') : ''}${w.home.bund || w.far.bund ? row('Bunds', [w.home.bund && `home: ${w.home.bund}`, w.far.bund && `far: ${w.far.bund}`].filter(Boolean).join(', '), 'Map class') : ''}${w.shape ? row('Water level', w.shape === 'raised' ? 'above the land (in-filled)' : w.shape === 'sunk' ? 'below the land (in-cut)' : 'level with the land', 'Est. 30 m') : ''}</table><div class="mgd-in" style="margin-top:4px">${w.purpose === 'cross' ? 'Crossing it: an unknown is taken at its bigger end.' : 'Holding it: an unknown is taken at its smaller end, so its value is never overstated.'}</div>`,
      true,
    );
    const v = w.verdict;
    out += this._sec(
      `Going across · ${w.purpose === 'cross' ? 'we cross' : 'the enemy crosses'}`,
      (['tanks', 'wheels', 'foot'] as const).map((k) => `<div class="mgd-in"><span class="mgd-dot" style="background:${GOING_C[v[k].v]}"></span><b>${k === 'tanks' ? 'Tanks' : k === 'wheels' ? 'Wheels' : 'Foot'} ${GOING_W[v[k].v]}</b>: ${esc(v[k].why)}</div>`).join(''),
    );
    out += this._sec(
      `Crossings within ${p.crossingsKm} km (${w.crossings.length})`,
      w.crossings.length
        ? `<table class="mgd-t"><tr><th>Crossing</th><th>Load / use</th><th>Where</th></tr>${w.crossings.map((q) => `<tr ${this._xy(q.x, q.y)}><td>${esc(q.label)}${q.name ? `<br><span class="mgd-why">${esc(q.name)}</span>` : ''}</td><td>${q.load ? `<span class="mgd-dot" style="background:${q.tankable ? '#3fb27f' : q.tankable === false ? '#f28c28' : '#8a96a3'}"></span>${esc(q.load)}` : ''}${q.months ? `${q.load ? '<br>' : ''}${esc(q.months)}${q.inUseNow === false ? ' <b style="color:#ff6b6f">not now</b>' : q.inUseNow ? ' <span class="mgd-ok">now</span>' : ''}` : ''}${q.boats ? `<br>${esc(q.boats)}` : ''}${q.status ? `<br><span class="mgd-why">${esc(q.status)}</span>` : ''}</td><td>${km(q.distM)} ${esc(q.dir)}</td></tr>`).join('')}</table>`
        : '<div class="mgd-in">None recorded on this obstacle within reach: an assault crossing or a bridge to be built.</div>',
      true,
    );
    if (r.reach) {
      const st = r.reach.stations;
      out += this._sec(
        `Along the reach (${st.length} stations)`,
        `<table class="mgd-t"><tr><th>#</th><th>Along</th><th>Width</th><th>Home / far</th></tr>${st.map((s, i) => `<tr ${this._xy(s.at[0], s.at[1])} class="${i === r.reach!.narrowest || i === r.reach!.lowestFar ? 'sel' : ''}"><td>${s.n}${i === r.reach!.narrowest ? ' N' : ''}${i === r.reach!.lowestFar ? ' L' : ''}</td><td>${km(s.alongM)}</td><td>${s.widthM ?? '?'} m</td><td>${s.homeM ?? '?'} / ${s.farM ?? '?'} m${s.marsh ? ' <span class="mgd-why">marsh</span>' : ''}${s.crossing ? `<br><span class="mgd-why">${esc(s.crossing)}</span>` : ''}</td></tr>`).join('')}</table><div class="mgd-in" style="margin-top:4px">Banks from 30 m ground at each station: a shortlist for the breach or crossing site, not a measurement.</div>`,
        true,
      );
    }
    out += this._sec('Confirm on the ground', `<div class="mgd-in">${w.recce.map((t) => `· ${esc(t)}`).join('<br>')}</div>`, true);
    out += this._sec('Home and far', `<div class="mgd-in">Home bank ${esc(w.home.dir)}: ${esc(w.homeWhy)}. Far bank ${esc(w.far.dir)}.</div><div class="mgd-row" style="margin-top:6px"><button class="mgd-btn" data-act="swapHome">⇄ Swap Home</button><button class="mgd-btn" ${this._xy(w.at[0], w.at[1])} data-goto="1">Show on Map</button></div>`);
    return out;
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _click(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') return this._cb.close();
    if (act) return this._cb.action(act);
    const card = t.closest<HTMLElement>('[data-card]')?.dataset.card as CardId | undefined;
    if (card) return this._cb.card(card);
    const lens = t.closest<HTMLElement>('[data-lens]')?.dataset.lens as WaterLens | undefined;
    if (lens) return this.setLens(lens);
    const input = t.closest<HTMLElement>('[data-input]')?.dataset.input;
    if (input) return this._cb.input(input);
    const choose = t.closest<HTMLElement>('[data-choose]')?.dataset.choose;
    if (choose !== undefined) return this._cb.action('choose', Number(choose));
    const row = t.closest<HTMLElement>('[data-x]');
    if (row) this._cb.goTo(Number(row.dataset.x), Number(row.dataset.y));
  }

  private _change(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const key = t.dataset?.param;
    if (!key || !this._last) return;
    const v = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t.value;
    this._cb.param(this._last.card, key, v);
  }

  /** Grip: drag the top edge to set the card's height (kept for next time). */
  attachGrip(): void {
    const el = this._el;
    if (!el || (el as any)._gripBound) return;
    (el as any)._gripBound = true;
    el.addEventListener('pointerdown', (e) => {
      const g = (e.target as HTMLElement).closest('[data-grip]');
      if (!g) return;
      e.preventDefault();
      const y0 = e.clientY;
      const h0 = el.getBoundingClientRect().height;
      const move = (ev: PointerEvent) => {
        this._height = Math.max(220, Math.min(1200, h0 + (y0 - ev.clientY)));
        el.style.height = `${this._height}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        try {
          localStorage.setItem(HEIGHT_KEY, String(Math.round(this._height)));
        } catch {
          /* storage blocked */
        }
        this._measure();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
}
