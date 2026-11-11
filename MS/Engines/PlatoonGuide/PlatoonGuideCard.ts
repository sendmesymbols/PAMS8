/**
 * PlatoonGuideCard.ts
 *
 * The Platoon Guide's cursor card, built like the Ground Guide's (GroundGuideBadge.ts; user, 2026-11-11: "make it
 * platoonguide like cards", then "mouse move card as well — make it visually appealing and use creative visualization
 * techniques"). It follows the pointer while hovering or placing and never scrolls:
 *   - the bar in the verdict ladder's colour holds the verdict only (the going on foot here) and the bubble;
 *   - a neutral line: from where, eye height, vehicles, the ground, the light;
 *   - the hero: the bubble radar (PlatoonGuideRadar: sight to true scale, the way out round the rim, glyphs for water,
 *     dangers, casevac, help, BUA, patrol base, OP; far things on a log band) beside four stat tiles (water, way out,
 *     casevac, help), each led by the glyph it has on the radar;
 *   - the danger strip: the lead danger with a severity meter and counts by kind as glyph chips;
 *   - the people strip: the count within 1 km and spark bars for the rings out to 3 km, the nearest BUA, sensitive sites.
 * The footer names the key: A opens the Pl Detail. Every colour and size from GroundGuideTokens.ts; every direction has
 * an arrow and the radar turns with the map (GroundGuideNorth). DOM nodes and textContent only.
 *
 * The card's size is measured once per update, so following the cursor costs no layout reads; it flips to stay on
 * screen, steps aside of the open Pl Detail, and never takes pointer events.
 */

import { ensureTokensCss, STEP_COLOR, STEP_TEXT, TONE, toneIcon, type Tone } from '../GroundGuide/GroundGuideTokens';
import { ensureNorthCss, orientNorth, whereNode } from '../GroundGuide/GroundGuideNorth';
import type { PlGoing, PlReading, PlSpot } from './PlatoonGuideRead';
import { glyphIcon, GLYPH_COLOR, plRadar } from './PlatoonGuideRadar';
import { dist, ECHELON_WORD, EYE_WORD, num, type PlatoonBrief } from './PlatoonGuideText';

const STYLE_ID = 'ms-platoon-guide-card-style';
const EDGE = 8;
const GAP = 18;

const toneCss = (Object.keys(TONE) as Tone[]).map((t) => `.ms-plc[data-tone="${t}"]{--pc-c:${TONE[t].fill};--pc-fg:${TONE[t].fg}}`).join('\n');
const CSS = `
.ms-plc{position:fixed;left:0;top:0;z-index:2147482990;pointer-events:none;--pc-c:${TONE.chk.fill};--pc-fg:#fff;width:350px;max-width:calc(100vw - 8px);
  box-sizing:border-box;border-radius:12px;overflow:hidden;font:400 13.5px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:var(--gg-text);
  background:linear-gradient(180deg,#1f242b 0%,var(--gg-card) 60%);border:1.5px solid var(--pc-c);box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.35);display:none}
${toneCss}
.ms-plc-bar{display:flex;align-items:center;gap:9px;padding:9px 12px;background-color:var(--pc-c);color:var(--pc-fg);font-weight:750;font-size:18px;line-height:1.2;
  background-image:linear-gradient(90deg,rgba(255,255,255,.12),rgba(255,255,255,0) 60%)}
.ms-plc-bar>svg{flex:none}
.ms-plc-title{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-plc-pill{flex:none;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.2);font-size:12px;font-weight:750;line-height:1.5;white-space:nowrap}
.ms-plc[data-tone="marg"] .ms-plc-pill,.ms-plc[data-tone="slow"] .ms-plc-pill{background:rgba(0,0,0,.18)}
.ms-plc-mode{display:flex;flex-wrap:wrap;gap:2px 10px;padding:6px 12px;background:var(--gg-raised);border-bottom:1px solid var(--gg-hair);font-size:12px;line-height:1.35;color:var(--gg-label)}
.ms-plc-mode b{color:var(--gg-text);font-weight:600}
.ms-plc-mode b[data-g="go"]{color:${STEP_TEXT.go}}.ms-plc-mode b[data-g="slow"]{color:${STEP_TEXT.slow}}.ms-plc-mode b[data-g="nogo"]{color:${STEP_TEXT.nogo}}
.ms-plc-hero{display:grid;grid-template-columns:150px minmax(0,1fr);gap:4px 8px;align-items:center;padding:8px 10px 6px 6px}
.ms-plc-radar{line-height:0}
.ms-plc-stats{display:flex;flex-direction:column;gap:5px;min-width:0}
.ms-plc-st{display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:7px;align-items:start;padding:4px 7px 5px;border-radius:7px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
.ms-plc-st>svg{margin-top:2px}
.ms-plc-sk{font-size:11.5px;line-height:1.2;color:var(--gg-label)}
.ms-plc-sv{font-size:14px;font-weight:750;line-height:1.25;color:var(--gg-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ms-plc-ss{font-size:11.5px;line-height:1.25;color:var(--gg-soft);overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ms-plc-ways{display:inline-flex;gap:1.5px;vertical-align:1px;margin-left:6px}
.ms-plc-ways>i{display:block;width:6px;height:10px;border-radius:1.5px}
.ms-plc-sec{padding:8px 12px 9px;border-top:1px solid var(--gg-hair)}
.ms-plc-sh{display:flex;align-items:baseline;gap:8px;min-width:0}
.ms-plc-sl{flex:none;font-size:12px;color:var(--gg-label);width:56px}
.ms-plc-big{flex:1 1 auto;min-width:0;font-size:15.5px;font-weight:750;color:var(--gg-strong);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ms-plc-big[data-s="hi"]{color:${STEP_TEXT.nogo}}.ms-plc-big[data-s="mid"]{color:${STEP_TEXT.slow}}.ms-plc-big[data-s="lo"]{color:${TONE.marg.text}}.ms-plc-big[data-s="none"]{color:${STEP_TEXT.go}}
.ms-plc-sub{margin:3px 0 0 64px;font-size:12px;line-height:1.35;color:var(--gg-label);overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ms-plc-meter{position:relative;height:7px;margin:6px 0 0 64px;border-radius:4px;background:linear-gradient(90deg,${STEP_COLOR.go} 0%,${TONE.marg.fill} 40%,${STEP_COLOR.slow} 62%,${STEP_COLOR.nogo} 100%);opacity:.9}
.ms-plc-meter>b{position:absolute;top:-4px;width:3px;height:15px;margin-left:-1.5px;border-radius:2px;background:#fff;box-shadow:0 0 0 1.5px #14181d}
.ms-plc-chips{display:flex;flex-wrap:wrap;gap:4px 6px;margin:6px 0 0 64px}
.ms-plc-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 7px 1px 4px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);font-size:12px;font-weight:650;color:var(--gg-text)}
.ms-plc-spark{display:flex;align-items:flex-end;gap:5px;height:30px;margin:4px 0 0 64px}
.ms-plc-spark>div{display:flex;flex-direction:column;align-items:center;gap:2px;flex:1 1 0;min-width:0}
.ms-plc-spark i{display:block;width:100%;max-width:34px;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,#e2c79a,#a07c4c)}
.ms-plc-spark span{font-size:10.5px;line-height:1;color:var(--gg-label);white-space:nowrap}
.ms-plc-wait{display:flex;align-items:center;gap:8px;color:var(--gg-label);font-size:12px}
.ms-plc-wait>i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#8a96a3}
@media (prefers-reduced-motion:no-preference){.ms-plc-wait>i{animation:ms-plc-pulse 1.1s ease-in-out infinite}.ms-plc-wait>i:nth-child(2){animation-delay:.18s}.ms-plc-wait>i:nth-child(3){animation-delay:.36s}}
@keyframes ms-plc-pulse{0%,100%{opacity:.25}50%{opacity:1}}
.ms-plc-foot{display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;padding:6px 12px;font-size:12px;color:var(--gg-label);border-top:1px solid var(--gg-hair);background:rgba(0,0,0,.12)}
.ms-plc-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;margin-right:5px;box-sizing:border-box;border-radius:4px;
  font:750 12px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
`;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function where(s: PlSpot): Node {
  if (s.distM < 15) return document.createTextNode('here');
  return whereNode(s.distM, s.dir, s.bearingDeg);
}
/** A stat tile: the glyph it has on the radar, a small label, the value (with its arrow), a sub line. */
function stat(kind: keyof typeof GLYPH_COLOR, label: string, value: Array<Node | string>, sub?: Array<Node | string> | string): HTMLElement {
  const t = el('div', 'ms-plc-st');
  const body = el('div');
  body.style.minWidth = '0';
  const v = el('div', 'ms-plc-sv');
  v.append(...value);
  body.append(el('div', 'ms-plc-sk', label), v);
  if (sub && (typeof sub === 'string' ? sub : sub.length)) {
    const s = el('div', 'ms-plc-ss');
    if (typeof sub === 'string') s.textContent = sub;
    else s.append(...sub);
    body.append(s);
  }
  t.append(glyphIcon(kind, 15), body);
  return t;
}

export const GOING_TONE: Record<PlGoing, Tone> = { go: 'go', slow: 'slow', nogo: 'nogo', unknown: 'chk' };
export const GOING_TITLE: Record<PlGoing, string> = { go: 'GO on foot', slow: 'SLOW-GO on foot', nogo: 'NO-GO on foot', unknown: 'Checking' };
const GO_WORD: Record<PlGoing, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO', unknown: '…' };

/** Kinds of danger in the order a small card leads with them: what can kill the patrol first, then what helps the enemy. */
const LEAD_ORDER = [['mine', 'ambush', 'block'], ['vp', 'rooftops'], ['overlooked']];

/** The danger that matters most for the card: the nearest of the first kinds that score 50 or more, else the nearest of all. */
export function leadDanger(r: PlReading): PlSpot | null {
  const s = r.danger?.spots ?? [];
  const nearest = (a: PlSpot[]) => (a.length ? a.reduce((m, x) => (x.distM < m.distM ? x : m)) : null);
  for (const kinds of LEAD_ORDER) {
    const hit = nearest(s.filter((x) => kinds.includes(x.kind) && (x.score ?? 0) >= 50));
    if (hit) return hit;
  }
  return nearest(s);
}

export class PlatoonGuideCard {
  private _el: HTMLDivElement | null = null;
  private _w = 350;
  private _h = 300;
  private _x = -1;
  private _y = -1;
  private _shown = false;

  get isShown(): boolean {
    return this._shown;
  }

  /** Build (or rebuild) the card for a brief. `northDeg`: where north points on screen. */
  update(b: PlatoonBrief, northDeg: number, keys: boolean): void {
    const r = b.reading;
    if (!r) return this.hide();
    const root = this._ensure();
    const H = r.here;
    const tone = b.pending && H.going.foot === 'unknown' ? 'chk' : GOING_TONE[H.going.foot];
    root.dataset.tone = tone;
    root.replaceChildren();

    // 1. The bar: the verdict only, and the bubble.
    const bar = el('div', 'ms-plc-bar');
    bar.append(toneIcon(tone, 20), el('span', 'ms-plc-title', GOING_TITLE[H.going.foot]), el('span', 'ms-plc-pill', `${ECHELON_WORD[r.echelon] ?? 'Pl'} · ${dist(r.radiusM)}`));
    root.append(bar);

    // 2. Who and what it is read for.
    const mode = el('div', 'ms-plc-mode');
    const veh = el('span');
    const vb = el('b', undefined, GO_WORD[H.going.veh]);
    vb.dataset.g = H.going.veh;
    veh.append('Veh ', vb);
    mode.append(el('span', undefined, `${b.what.split(' · ')[1] ?? 'point'} · ${EYE_WORD[r.eye] ?? r.eye}`), veh, el('span', undefined, H.clsLabel));
    if (b.light) mode.append(el('span', undefined, b.light.now));
    root.append(mode);

    // 3. The hero: the radar beside four stat tiles.
    const hero = el('div', 'ms-plc-hero');
    const rad = el('div', 'ms-plc-radar');
    rad.append(plRadar(r, { px: 150, sight: true, scale: false }));
    const stats = el('div', 'ms-plc-stats');
    const W = H.water;
    const wLead = W.perennial && W.nearest && W.perennial.distM < W.nearest.distM * 2 ? W.perennial : W.nearest;
    stats.append(stat('water', 'Water', wLead ? [where(wLead)] : ['none in 5 km'], wLead ? `${wLead.label}${wLead.why ? ` · ${wLead.why}` : ''}` : undefined));
    const ways = H.waysOut.dirs.filter((d) => d.foot === 'go').length;
    const wv = el('span', 'ms-plc-ways');
    for (const d of H.waysOut.dirs) {
      const i = el('i');
      i.style.background = d.foot === 'unknown' ? '#3a434e' : STEP_COLOR[d.foot];
      i.title = d.dir;
      wv.append(i);
    }
    const vOpen = H.waysOut.dirs.filter((d) => d.veh === 'go').length;
    const wayTile = stat('harbour', 'Way out', [`${ways}/8`, wv], `on foot · veh ${vOpen}/8${H.waysOut.road ? ` · Rd ${dist(H.waysOut.road.distM)} ${H.waysOut.road.dir}` : ''}`);
    wayTile.replaceChild(arrowsIcon(), wayTile.firstChild!);
    stats.append(wayTile);
    const hl = H.hls.ground;
    const hosp = H.medical.hospital;
    stats.append(stat('hls', 'Casevac', hl ? [hl.distM < 15 ? 'HLS Gr here' : 'HLS ', hl.distM < 15 ? '' : where(hl)] : ['no HLS Gr in 2 km'], hosp ? ['Hospital ', where(hosp), H.medical.driveMin !== null ? ` · ~${H.medical.driveMin} min` : ''] : 'no hospital in 60 km'));
    const f = r.help.friends[0];
    stats.append(stat('help', 'Help', f ? [where(f)] : ['none in 30 km'], f ? `${f.label}${f.name && f.name !== f.label ? ` ${f.name}` : ''}` : undefined));
    hero.append(rad, stats);
    root.append(hero);

    // 4. The danger strip: the lead danger, how bad, and the counts by kind.
    const ds = el('div', 'ms-plc-sec');
    if (r.danger) {
      const D = r.danger;
      const lead = leadDanger(r);
      const head = el('div', 'ms-plc-sh');
      head.append(el('span', 'ms-plc-sl', 'Danger'));
      const big = el('div', 'ms-plc-big');
      if (lead) {
        big.append(`${lead.label.replace('Likely ', '')} `, where(lead));
        big.dataset.s = (lead.score ?? 0) >= 70 ? 'hi' : (lead.score ?? 0) >= 50 ? 'mid' : 'lo';
      } else {
        big.textContent = 'None found on the Rds';
        big.dataset.s = 'none';
      }
      head.append(big);
      ds.append(head);
      if (lead) {
        const meter = el('div', 'ms-plc-meter');
        const mk = el('b');
        mk.style.left = `${Math.min(100, Math.max(0, lead.score ?? 0))}%`;
        meter.append(mk);
        meter.title = `Score ${lead.score ?? 0} of 100`;
        ds.append(meter);
        const chips = el('div', 'ms-plc-chips');
        const count = (k: string) => D.spots.filter((x) => x.kind === k).length;
        const kinds: Array<[keyof typeof GLYPH_COLOR, string, string]> = [['mine', 'mine', 'Mine / IED'], ['ambush', 'ambush', 'Ambush'], ['vp', 'vp', 'VP'], ['block', 'block', 'Rd block']];
        for (const [g, k, word] of kinds) {
          const n = count(k);
          if (!n) continue;
          const c = el('span', 'ms-plc-chip');
          c.append(glyphIcon(g, 12), `${n} ${word}`);
          chips.append(c);
        }
        const ov = (r.see?.overlook.length ?? 0) + count('overlooked');
        if (ov) {
          const c = el('span', 'ms-plc-chip');
          c.append(glyphIcon('overlook', 12), `${ov} overlook`);
          chips.append(c);
        }
        ds.append(chips);
      } else ds.append(el('div', 'ms-plc-sub', `${D.roadKm.toFixed(1)} km of Rds read: ground pattern only, not intelligence`));
    } else {
      const head = el('div', 'ms-plc-sh');
      const wait = el('div', 'ms-plc-wait');
      wait.append(el('i'), el('i'), el('i'), 'Rest the cursor: sight, dangers, where to stop');
      head.append(el('span', 'ms-plc-sl', 'Danger'), wait);
      ds.append(head);
    }
    root.append(ds);

    // 5. The people strip: within 1 km, spark bars for the rings, the nearest BUA and sensitive sites.
    const P = r.people;
    const ps = el('div', 'ms-plc-sec');
    const ph = el('div', 'ms-plc-sh');
    const r1 = P.rings.find((x) => x.km === 1);
    ph.append(el('span', 'ms-plc-sl', 'People'), el('div', 'ms-plc-big', r1 ? `${num(r1.people)} within 1 km` : P.within500 !== null ? `~${num(P.within500)} within 500 m` : 'Not known'));
    ps.append(ph);
    const bars: Array<[string, number]> = [];
    if (P.within500 !== null) bars.push(['0.5', P.within500]);
    for (const x of P.rings) bars.push([String(x.km), x.people]);
    if (bars.length >= 2) {
      const spark = el('div', 'ms-plc-spark');
      const max = Math.max(...bars.map(([, v]) => v), 1);
      for (const [km, v] of bars) {
        const col = el('div');
        const i = el('i');
        i.style.height = `${Math.round(3 + 19 * Math.sqrt(v / max))}px`;
        i.title = `${num(v)} within ${km} km`;
        col.append(i, el('span', undefined, `${km} km`));
        spark.append(col);
      }
      ps.append(spark);
    }
    const sub = el('div', 'ms-plc-sub');
    if (P.bua) sub.append(`${P.bua.name} `, where(P.bua), P.bua.why ? ` · ${P.bua.why}` : '');
    const sens = P.sensitive.counts.slice(0, 3).map((c) => `${c.label} ${c.n}`).join(', ');
    if (sens) sub.append(`${P.bua ? ' · ' : ''}${sens}`);
    if (sub.childNodes.length) ps.append(sub);
    root.append(ps);

    if (keys) {
      const ft = el('div', 'ms-plc-foot');
      const k = el('span');
      k.append(el('span', 'ms-plc-kbd', 'A'), 'Pl Detail: sight, range card, dangers, where to stop');
      ft.append(k);
      root.append(ft);
    }
    orientNorth(root, northDeg);
    // Measure once per update; moving the card costs no layout reads.
    root.style.visibility = 'hidden';
    root.style.display = 'block';
    this._w = root.offsetWidth;
    this._h = root.offsetHeight;
    root.style.visibility = '';
    this._shown = true;
    if (this._x >= 0) this._place();
    else root.style.display = 'none';
  }

  /** The pointer moved (client coordinates). */
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
      e.className = 'ms-plc';
      e.setAttribute('role', 'status');
      e.setAttribute('aria-live', 'polite');
      document.body.appendChild(e);
      this._el = e;
    }
    return this._el;
  }

  /** Below and right of the pointer; flipped to stay on screen; out of the way of the open Pl Detail. */
  private _place(): void {
    const e = this._el;
    if (!e) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const detail = document.querySelector<HTMLElement>('.ms-pld.ms-open');
    const bottom = detail ? Math.max(EDGE, vh - detail.offsetHeight - 10 - EDGE) : vh - EDGE;
    // No room above the open Pl Detail: the card steps aside (the Detail is reading the same point and says it all).
    if (detail && bottom - EDGE < this._h) {
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

/** Four arrows out of a dot: the way-out tile's icon (the radar shows the way out as its rim). */
function arrowsIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M6 3.5L8 1.5L10 3.5M6 12.5L8 14.5L10 12.5M3.5 6L1.5 8L3.5 10M12.5 6L14.5 8L12.5 10');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', STEP_COLOR.go);
  p.setAttribute('stroke-width', '1.6');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}
