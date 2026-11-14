/**
 * PlatoonGuideHalo.ts
 *
 * The halo: the Platoon Guide at the cursor without a box over the ground (user, 2026-11-13: "its mouse move card is
 * blocking the view", then picked views 1 2 3 of platoon-guide-view-options.html; this is view 1). The pointer is the
 * centre of the bubble radar, turned inside out, so the map under and round the symbol stays clear:
 *   - a thin ring round the symbol: the outer arcs are the way out on foot, the inner arcs for vehicles, in the going
 *     colours (eight directions, as the radar's rim);
 *   - the answers on a second ring, each in the direction it really lies, however far, with its short word and distance
 *     beside it (Wtr 340 m; user, 2026-11-13: "2-3 chars can tell users about it"): water, the lead danger with a red
 *     ring, casevac (landing Gr and hospital), help (Pol, Post, BOP...), the nearest BUA, patrol base, OP;
 *   - the verdict above in the ladder's colour (going on foot, echelon and bubble) with the A key.
 * Directions turn with the map (GroundGuideNorth: `northDeg` is where north points on screen). Glyphs are the radar's
 * (PlatoonGuideRadar); colours and the verdict tones from GroundGuideTokens.ts. Never takes pointer events; DOM nodes
 * and textContent only.
 */

import { ensureTokensCss, STEP_COLOR, SURFACE, TONE, toneIcon } from '../GroundGuide/GroundGuideTokens';
import type { PlReading, PlSpot } from './PlatoonGuideRead';
import { dangerGlyph, glyph, GLYPH_CODE, GLYPH_COLOR, helpCode } from './PlatoonGuideRadar';
import { dist, ECHELON_WORD, type PlatoonBrief } from './PlatoonGuideText';

const STYLE_ID = 'ms-platoon-guide-halo-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Room outside the glyph ring for the distance labels and the verdict. */
const PAD = 118;
const GAP_RING = 24;

function el(tag: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

export const HALO_GOING_TONE = { go: 'go', slow: 'slow', nogo: 'nogo', unknown: 'chk' } as const;
const GOING_TITLE = { go: 'GO on foot', slow: 'SLOW-GO on foot', nogo: 'NO-GO on foot', unknown: 'Checking' } as const;

const CSS = `
.ms-plh{position:fixed;left:0;top:0;z-index:2147482990;pointer-events:none;display:none}
.ms-plh>svg{position:absolute;left:0;top:0;overflow:visible}
.ms-plh-lab{position:absolute;white-space:nowrap;padding:0 7px;border-radius:999px;background:${SURFACE.ring};border:1px solid rgba(255,255,255,.3);
  font:700 12px/19px system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;font-variant-numeric:tabular-nums;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.ms-plh-lab[data-lead]{color:#ff8a8d;border-color:${STEP_COLOR.nogo}}
.ms-plh-lab>b{font-weight:800;margin-right:4px}
.ms-plh-v{position:absolute;display:flex;align-items:center;gap:6px;padding:3px 10px 3px 7px;border-radius:999px;border:1.5px solid ${SURFACE.ring};
  font:750 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;white-space:nowrap;transform:translate(-50%,-100%);box-shadow:0 2px 8px rgba(0,0,0,.5)}
.ms-plh-v>svg{flex:none}
.ms-plh-k{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;margin-left:2px;box-sizing:border-box;border-radius:4px;
  font:750 11.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
`;

export interface HaloItem {
  kind: keyof typeof GLYPH_COLOR;
  /** The short word beside it (Wtr, IED, Pol...). */
  code: string;
  bearingDeg: number;
  distM: number;
  lead: boolean;
  title: string;
}

/** The answers the halo carries, in the order they matter (at most eight); places within 15 m are "here" and left out. */
export function haloItems(r: PlReading): HaloItem[] {
  const out: HaloItem[] = [];
  const add = (s: PlSpot | null | undefined, kind: keyof typeof GLYPH_COLOR | null, lead = false, code?: string) => {
    if (!s || !kind || s.distM < 15 || out.length >= 8) return;
    out.push({ kind, code: code ?? GLYPH_CODE[kind], bearingDeg: s.bearingDeg, distM: s.distM, lead, title: s.label });
  };
  const H = r.here;
  const lead = leadOf(r);
  if (lead) add(lead, dangerGlyph(lead.kind) ?? 'mine', true);
  const W = H.water;
  add(W.perennial && W.nearest && W.perennial.distM < W.nearest.distM * 2 ? W.perennial : W.nearest, 'water');
  add(H.hls.ground, 'hls');
  add(r.help.friends[0], 'help', false, helpCode(r.help.friends[0]?.kind));
  add(H.medical.hospital, 'hospital');
  add(r.people.bua, 'bua');
  add(r.stop?.harbour, 'harbour');
  add(r.stop?.op, 'op');
  return out;
}

/** The lead danger (same rule as the cursor card): the nearest strong mine / ambush / block, then VP, then overlooked. */
function leadOf(r: PlReading): PlSpot | null {
  const s = r.danger?.spots ?? [];
  const nearest = (a: PlSpot[]) => (a.length ? a.reduce((m, x) => (x.distM < m.distM ? x : m)) : null);
  for (const kinds of [['mine', 'ambush', 'block'], ['vp', 'rooftops'], ['overlooked']]) {
    const hit = nearest(s.filter((x) => kinds.includes(x.kind) && (x.score ?? 0) >= 50));
    if (hit) return hit;
  }
  return nearest(s);
}

/** Spread screen angles (degrees, any order) so neighbours are at least `minSep` apart, keeping their order round the ring. */
export function spreadAngles(angles: number[], minSep: number): number[] {
  const n = angles.length;
  if (n < 2) return angles.slice();
  if (n * minSep >= 360) minSep = 360 / n;
  const idx = angles.map((a, i) => ({ a: ((a % 360) + 360) % 360, i })).sort((p, q) => p.a - q.a);
  const pos = idx.map((p) => p.a);
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const gap = ((pos[j] - pos[k]) % 360 + 360) % 360 || (j === k ? 360 : 0);
      if (gap < minSep - 0.01) {
        const push = (minSep - gap) / 2;
        pos[k] -= push;
        pos[j] += push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const out = new Array<number>(n);
  idx.forEach((p, k) => (out[p.i] = pos[k]));
  return out;
}

export class PlatoonGuideHalo {
  private _el: HTMLDivElement | null = null;
  private _size = 0;
  private _x = -1;
  private _y = -1;
  private _shown = false;

  get isShown(): boolean {
    return this._shown;
  }

  /** Build the halo for a reading. `radius`: the way-out ring in px (outside the symbol). `northDeg`: north on screen. */
  update(b: PlatoonBrief, northDeg: number, opts: { radius: number; keys: boolean }): void {
    const r = b.reading;
    if (!r) return this.hide();
    const root = this._ensure();
    const R = Math.max(36, Math.min(160, Math.round(opts.radius)));
    const RG = R + GAP_RING;
    const S = 2 * (RG + PAD);
    const c = S / 2;
    this._size = S;
    root.style.width = `${S}px`;
    root.style.height = `${S}px`;
    root.replaceChildren();
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('width', String(S));
    svg.setAttribute('height', String(S));
    svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
    svg.setAttribute('aria-hidden', 'true');
    root.append(svg);
    const add = (tag: string, attrs: Record<string, string | number>): SVGElement => {
      const e = document.createElementNS(SVG_NS, tag) as SVGElement;
      for (const k in attrs) e.setAttribute(k, String(attrs[k]));
      svg.append(e);
      return e;
    };
    const at = (rad: number, screenDeg: number): [number, number] => {
      const a = (screenDeg * Math.PI) / 180;
      return [c + rad * Math.sin(a), c - rad * Math.cos(a)];
    };
    const arc = (rad: number, a0: number, a1: number, color: string, w: number) => {
      const [x0, y0] = at(rad, a0);
      const [x1, y1] = at(rad, a1);
      add('path', { d: `M${x0.toFixed(1)} ${y0.toFixed(1)}A${rad} ${rad} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`, fill: 'none', stroke: color, 'stroke-width': w });
    };

    // 1. The way-out ring on a dark bed so it reads on any imagery.
    add('circle', { cx: c, cy: c, r: R - 4, fill: 'none', stroke: SURFACE.ring, 'stroke-opacity': 0.55, 'stroke-width': 15 });
    const goCol = (g: string) => (g === 'go' || g === 'slow' || g === 'nogo' ? STEP_COLOR[g] : '#5b6470');
    for (const d of r.here.waysOut.dirs) {
      const a = d.bearingDeg + northDeg;
      arc(R, a - 19, a + 19, goCol(d.foot), 7);
      arc(R - 9, a - 17, a + 17, goCol(d.veh), 2.5);
    }

    // 2. The answers where they lie, spread just enough not to overlap.
    const items = haloItems(r);
    const minSep = (2 * Math.asin(Math.min(1, 15 / RG)) * 180) / Math.PI;
    const angles = spreadAngles(items.map((it) => it.bearingDeg + northDeg), minSep);
    items.forEach((it, i) => {
      const a = angles[i];
      const [x, y] = at(RG, a);
      const disc = it.lead ? 14 : 11.5;
      if (it.lead) add('circle', { cx: x, cy: y, r: disc + 3, fill: 'none', stroke: STEP_COLOR.nogo, 'stroke-opacity': 0.35, 'stroke-width': 3 });
      add('circle', { cx: x, cy: y, r: disc, fill: SURFACE.ring, stroke: it.lead ? STEP_COLOR.nogo : 'rgba(255,255,255,.4)', 'stroke-width': it.lead ? 2.4 : 1.2 });
      glyph(svg, it.kind, x, y, it.lead ? 6.4 : 5.4);
      const lab = document.createElement('div');
      lab.className = 'ms-plh-lab';
      if (it.lead) lab.dataset.lead = '';
      const code = el('b', it.code);
      code.style.color = it.lead ? '#ff8a8d' : GLYPH_COLOR[it.kind];
      lab.append(code, document.createTextNode(dist(it.distM)));
      const sin = Math.sin((a * Math.PI) / 180);
      const cos = Math.cos((a * Math.PI) / 180);
      if (sin > 0.3) {
        lab.style.left = `${x + disc + 4}px`;
        lab.style.top = `${y}px`;
        lab.style.transform = 'translateY(-50%)';
      } else if (sin < -0.3) {
        lab.style.left = `${x - disc - 4}px`;
        lab.style.top = `${y}px`;
        lab.style.transform = 'translate(-100%,-50%)';
      } else {
        lab.style.left = `${x}px`;
        lab.style.top = `${cos > 0 ? y - disc - 3 : y + disc + 3}px`;
        lab.style.transform = cos > 0 ? 'translate(-50%,-100%)' : 'translateX(-50%)';
      }
      root.append(lab);
    });

    // 3. The verdict above, in the ladder's colour, with its word and icon (never colour alone).
    const foot = r.here.going.foot;
    const tone = b.pending && foot === 'unknown' ? 'chk' : HALO_GOING_TONE[foot];
    const v = document.createElement('div');
    v.className = 'ms-plh-v';
    v.style.left = `${c}px`;
    v.style.top = `${c - RG - 40}px`;
    v.style.background = TONE[tone].fill;
    v.style.color = TONE[tone].fg;
    v.append(toneIcon(tone, 16), document.createTextNode(`${GOING_TITLE[foot]} · ${ECHELON_WORD[r.echelon] ?? 'Pl'} ${dist(r.radiusM)}`));
    if (opts.keys) {
      const k = document.createElement('span');
      k.className = 'ms-plh-k';
      k.textContent = 'A';
      v.append(k);
    }
    root.append(v);
    root.setAttribute('aria-label', `${GOING_TITLE[foot]}. ${items.map((it) => `${it.title} ${dist(it.distM)}`).join(', ')}`);
    this._shown = true;
    if (this._x >= 0) this._place();
  }

  /** The pointer moved (client coordinates): the halo stays centred on it. */
  moveTo(x: number, y: number): void {
    this._x = x;
    this._y = y;
    if (this._shown) this._place();
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
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    if (!this._el) {
      const e = document.createElement('div');
      e.className = 'ms-plh';
      e.setAttribute('role', 'img');
      document.body.appendChild(e);
      this._el = e;
    }
    return this._el;
  }

  private _place(): void {
    const e = this._el;
    if (!e) return;
    e.style.transform = `translate(${Math.round(this._x - this._size / 2)}px, ${Math.round(this._y - this._size / 2)}px)`;
    e.style.display = 'block';
  }
}
