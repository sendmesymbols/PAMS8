/**
 * PlacementGoingView.ts
 *
 * The going, soil and movement sections of the Placement card and the Ground Brief (GROTBC T, with soil under G).
 * Each card option is one builder, so the user can switch them on one at a time and compare
 * (placement.card.*, letters as in placement-card-movement.html):
 *
 *   A goingLines    cross-country going dry / after rain, the soil and what limits the going
 *   B movementRose  eight wedges: going and reach per direction, with a freedom rating
 *   C soilStrength  soil swatch + cone-index gauge against the mode's thresholds
 *   E exitStrip     the eight directions as one compact row
 *   F modeMatrix    foot / wheeled / tracked x dry / after rain
 *   G seasonRibbon  twelve months of rain coloured by the going they leave
 *   H goingMap      a small picture of the going all round the point
 *
 * DOM nodes and textContent only (labels come from the bundle), like PlacementBadge.ts.
 */

import { fmtDistance } from './PlacementEvaluator';
import {
  CODE_STEP,
  GOING_COLOR,
  GOING_WORD,
  RATING_COLOR,
  RATING_LABEL,
  SOIL_COLOR,
  TEXTURE_POLYGONS,
} from './PlacementGoing';
import type { GoingStep, PlacementCardOptions, PlacementGoingInfo, PlacementVerdict } from './PlacementTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'ms-placement-going-style';
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT: Record<string, string> = { dismounted: 'Foot', wheeled: 'Wheeled', tracked: 'Tracked' };

export const GOING_CSS = `
.ms-gv-cap{display:flex;align-items:center;gap:6px}
.ms-gv-l{display:inline-flex;align-items:center;justify-content:center;flex:none;width:15px;height:15px;border-radius:4px;font:800 10px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0;color:#1b1f25}
.ms-gv-l[data-l="G"]{background:#8fb35a}.ms-gv-l[data-l="T"]{background:#5aa9e6}
.ms-gv-scale{display:grid;grid-template-columns:repeat(3,1fr);gap:3px}
.ms-gv-scale>span{font:700 9.5px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;text-align:center;padding:4px 0 3px;border-radius:2px;background:rgba(255,255,255,.06);color:#6b737c}
.ms-gv-scale>.ms-gv-go{background:#2fa862;color:#fff}.ms-gv-scale>.ms-gv-slow{background:#f0932b;color:#1b1f25}.ms-gv-scale>.ms-gv-nogo{background:#e5484d;color:#fff}
.ms-gv-row{display:grid;grid-template-columns:74px 1fr;gap:6px;align-items:center}
.ms-gv-row+.ms-gv-row{margin-top:4px}
.ms-gv-k{display:flex;align-items:center;gap:5px;font-size:11px;color:#c3cbd3;white-space:nowrap}
.ms-gv-line{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
.ms-gv-b{font-weight:600;color:#fff}
.ms-gv-soft{color:#9aa3ad;font-size:11px;padding-top:2px}
.ms-gv-chip{display:inline-flex;align-items:center;gap:4px;font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:3px 6px 2px;border-radius:999px;background:#3a3424;color:#e8cf95;white-space:nowrap}
.ms-gv-chip.ms-gv-map{background:#2c4a2f;color:#9fe0a8}
.ms-gv-limit{margin-top:6px;font-size:11px;color:#c3cbd3}
.ms-gv-rose{display:flex;gap:10px;align-items:center}
.ms-gv-rose>svg{flex:none}
.ms-gv-rate{font-size:15px;font-weight:700;line-height:1.15}
.ms-gv-blk{font-size:11px;color:#c3cbd3;margin-top:3px;line-height:1.35}
.ms-gv-leg{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:6px;font-size:10.5px;color:#9aa3ad}
.ms-gv-leg>span{white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
.ms-gv-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex:none}
.ms-gv-soil{display:flex;gap:9px;align-items:center}
.ms-gv-sw{flex:none;width:30px;height:30px;border-radius:7px;border:1px solid rgba(255,255,255,.25);box-shadow:inset 0 -6px 10px rgba(0,0,0,.25)}
.ms-gv-g{position:relative;margin:17px 2px 2px}
.ms-gv-gt{display:flex;height:9px;border-radius:5px;overflow:hidden}
.ms-gv-gt>i{height:100%}
.ms-gv-gk{position:absolute;top:9px;width:1px;height:5px;background:#9aa3ad}
.ms-gv-gm{position:absolute;top:-16px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center}
.ms-gv-gm::after{content:"";width:2px;height:14px;background:#fff;margin-top:-1px;border-radius:1px;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.ms-gv-gm.ms-gv-wet::after{background:#bfe2ff}
.ms-gv-gl{position:relative;height:12px;font-size:9.5px;color:#7f8994;margin-top:3px;font-variant-numeric:tabular-nums}
.ms-gv-gl>span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
.ms-gv-gl>.ms-gv-l0{left:0;transform:none}.ms-gv-gl>.ms-gv-r0{right:0;transform:none}
.ms-gv-mx{display:grid;grid-template-columns:auto 1fr 1fr;gap:3px 4px;font-size:11px;align-items:center}
.ms-gv-mx>.ms-gv-h{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:#9aa3ad;display:flex;gap:4px;justify-content:center;align-items:center}
.ms-gv-mx>.ms-gv-m{color:#c3cbd3;padding-right:6px;white-space:nowrap}
.ms-gv-mx>.ms-gv-m.ms-gv-on{color:#fff;font-weight:600}
.ms-gv-mx>.ms-gv-c{font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;text-align:center;padding:4px 0 3px;border-radius:2px}
.ms-gv-c.ms-gv-go{background:#2fa862;color:#fff}.ms-gv-c.ms-gv-slow{background:#f0932b;color:#1b1f25}.ms-gv-c.ms-gv-nogo{background:#e5484d;color:#fff}
.ms-gv-ex{display:grid;grid-template-columns:repeat(8,1fr);gap:3px}
.ms-gv-ex>div{display:flex;flex-direction:column;align-items:center;gap:2px}
.ms-gv-ex small{font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;color:#c3cbd3}
.ms-gv-ex i{display:block;width:100%;height:16px;border-radius:2px;background:rgba(255,255,255,.07);position:relative;overflow:hidden}
.ms-gv-ex i>b{position:absolute;left:0;bottom:0;width:100%}
.ms-gv-ex i.ms-gv-cut{box-shadow:inset 0 2px 0 #fff}
.ms-gv-rb{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;align-items:end;height:42px}
.ms-gv-rb>i{display:block;border-radius:2px 2px 0 0;min-height:3px}
.ms-gv-rb>i.ms-gv-now{outline:1.5px solid #fff;outline-offset:1px}
.ms-gv-rl{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;font:600 9px/1 system-ui,Segoe UI,Arial,sans-serif;color:#9aa3ad;text-align:center;margin-top:3px}
.ms-gv-rl>.ms-gv-now{color:#fff}
.ms-gv-map{display:flex;gap:10px;align-items:center}
.ms-gv-map>canvas{flex:none;border-radius:50%}
.ms-gv-pc{display:grid;grid-template-columns:auto 1fr;gap:2px 7px;font-size:11px;align-items:center}
.ms-gv-pc b{font-weight:600;color:#fff;font-variant-numeric:tabular-nums}
.ms-gv-foot{display:flex;align-items:center;gap:7px;padding:5px 11px;border-top:1px solid rgba(255,255,255,.08);color:#9aa3ad;font-size:11px}
.ms-gv-kbd{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;border-radius:4px;font:700 10px/1 ui-monospace,Consolas,monospace;color:#fff;background:linear-gradient(#3a424d,#2b313a);border:1px solid #545e6b;border-bottom-width:2px}
`;

export function ensureGoingCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = GOING_CSS;
  document.head.appendChild(style);
}

// ── small DOM helpers ──────────────────────────────────────────────────────

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function s(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Sun (dry) or drop (after rain) icon. */
export function seasonIcon(season: 'dry' | 'wet', size = 13): SVGElement {
  const svg = s('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' });
  if (season === 'dry') {
    svg.append(s('circle', { cx: 8, cy: 8, r: 3.2, fill: '#f2c14e' }));
    svg.append(
      s('path', {
        d: 'M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3',
        stroke: '#f2c14e',
        'stroke-width': 1.5,
        'stroke-linecap': 'round',
        fill: 'none',
      }),
    );
  } else {
    svg.append(s('path', { d: 'M8 1.5C6 4.5 3.5 7.3 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7.3 10 4.5 8 1.5z', fill: '#5aa9e6' }));
  }
  return svg;
}

/** A card band: GROTBC letter badge + caption, then the content. */
export function band(letter: 'G' | 'T', caption: string, ...content: Array<Node | null>): HTMLElement {
  const sec = h('div', 'ms-pb-sec');
  const cap = h('div', 'ms-pb-cap ms-gv-cap');
  cap.append(h('span', 'ms-gv-l', letter), caption);
  cap.firstElementChild!.setAttribute('data-l', letter);
  sec.append(cap, ...content.filter((c): c is Node => c !== null));
  return sec;
}

export function goingScale(step: GoingStep): HTMLElement {
  const sc = h('div', 'ms-gv-scale');
  for (const k of ['go', 'slow', 'nogo'] as const) sc.append(h('span', k === step ? `ms-gv-${k}` : undefined, GOING_WORD[k]));
  return sc;
}

function seasonWord(g: PlacementGoingInfo): string {
  return g.season === 'dry' ? 'Dry' : 'After Rain';
}

function modeShort(profile: string, label: string): string {
  return SHORT[profile] ?? label;
}

export function sourceChip(g: PlacementGoingInfo): HTMLElement | null {
  const soil = g.soil;
  if (!soil) return null;
  if (soil.mapped) return h('span', 'ms-gv-chip ms-gv-map', '1:50k Map');
  return h('span', 'ms-gv-chip', soil.confidenceLabel ? `Modelled · ${soil.confidenceLabel}` : 'Modelled');
}

function legend(withReach: boolean): HTMLElement {
  const lg = h('div', 'ms-gv-leg');
  for (const k of ['go', 'slow', 'nogo'] as const) {
    const it = h('span');
    const dot = h('span', 'ms-gv-dot');
    dot.style.background = GOING_COLOR[k];
    it.append(dot, GOING_WORD[k]);
    lg.append(it);
  }
  if (withReach) lg.append(h('span', undefined, 'length = reach'));
  return lg;
}

function blockedText(g: PlacementGoingInfo, max = 3, sep = ' · '): string {
  const m = g.movement;
  if (!m) return '';
  const items: string[] = [];
  for (const x of m.sectors) {
    if (x.blockedBy && x.reachM < m.rangeM) items.push(`${x.compass} ${x.blockedBy} ${fmtDistance(x.reachM)}`);
    else if (x.step === 'nogo') items.push(`${x.compass} NO-GO ground`);
  }
  if (!items.length) return `Nothing blocks the way within ${fmtDistance(m.rangeM)}`;
  return 'Blocked: ' + items.slice(0, max).join(sep) + (items.length > max ? `${sep}+${items.length - max} more` : '');
}

// ── shared pictures (card and brief) ───────────────────────────────────────

/** The movement rose. The wedges are in map bearings; the group turns with the map (`data-gv-rose`). */
export function roseSvg(g: PlacementGoingInfo, size: number, rings: boolean, northDeg: number): SVGElement {
  const m = g.movement!;
  const c = size / 2;
  const r0 = size * 0.12;
  const R = size / 2 - (rings ? 12 : 4);
  const svg = s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': 'Movement rose' });
  const grp = s('g', { transform: `rotate(${northDeg} ${c} ${c})`, 'data-gv-rose': `${c}` });
  const ringR = (k: number) => r0 + (R - r0) * k;
  if (rings) {
    for (const k of [0.5, 1]) grp.append(s('circle', { cx: c, cy: c, r: ringR(k), fill: 'none', stroke: 'rgba(255,255,255,.16)', 'stroke-dasharray': '2 3' }));
  } else grp.append(s('circle', { cx: c, cy: c, r: R, fill: 'none', stroke: 'rgba(255,255,255,.1)' }));
  const P = (a: number, rr: number) => `${(c + rr * Math.sin(a)).toFixed(1)} ${(c - rr * Math.cos(a)).toFixed(1)}`;
  for (const x of m.sectors) {
    const a0 = ((x.bearingDeg - 20.5) * Math.PI) / 180;
    const a1 = ((x.bearingDeg + 20.5) * Math.PI) / 180;
    const r = Math.max(r0 + 3, ringR(Math.min(1, x.reachM / m.rangeM)));
    grp.append(
      s('path', {
        d: `M ${P(a0, r0)} L ${P(a0, r)} A ${r} ${r} 0 0 1 ${P(a1, r)} L ${P(a1, r0)} A ${r0} ${r0} 0 0 0 ${P(a0, r0)} Z`,
        fill: GOING_COLOR[x.step],
        'fill-opacity': 0.88,
      }),
    );
    if (x.blockedBy && x.reachM < m.rangeM) {
      grp.append(s('path', { d: `M ${P(a0, r)} A ${r} ${r} 0 0 1 ${P(a1, r)}`, fill: 'none', stroke: '#fff', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
    }
  }
  grp.append(s('circle', { cx: c, cy: c, r: r0 - 2, fill: '#1b1f25', stroke: '#fff', 'stroke-width': 1.5 }));
  grp.append(s('path', { d: `M ${c} 1 l 3.5 6 h -7 z`, fill: '#fff' }));
  svg.append(grp);
  if (rings) {
    const t1 = s('text', { x: c + 3, y: c - ringR(0.5) + 9, fill: '#9aa3ad', 'font-size': 8 });
    t1.textContent = fmtDistance(m.rangeM / 2);
    const t2 = s('text', { x: c + 3, y: c - R + 9, fill: '#9aa3ad', 'font-size': 8 });
    t2.textContent = fmtDistance(m.rangeM);
    svg.append(t1, t2);
  }
  return svg;
}

/** Turn every rose under `root` to the map's north (no rebuild). */
export function orientRoses(root: ParentNode, northDeg: number): void {
  root.querySelectorAll('[data-gv-rose]').forEach((g) => {
    const c = g.getAttribute('data-gv-rose');
    g.setAttribute('transform', `rotate(${northDeg} ${c} ${c})`);
  });
}

/** Cone-index gauge: the mode's NO-GO / SLOW-GO / GO zones, the sun at the dry value, the drop after rain. */
export function soilGauge(g: PlacementGoingInfo): HTMLElement | null {
  const soil = g.soil;
  const v = g.vehicle;
  if (!soil || !v || soil.ciDry === null || soil.ciWet === null) return null;
  const max = 130;
  const pc = (x: number) => Math.min(100, Math.max(0, (x / max) * 100));
  const wrap = h('div');
  const gg = h('div', 'ms-gv-g');
  const track = h('div', 'ms-gv-gt');
  const z1 = h('i');
  z1.style.cssText = `width:${pc(v.vci[0])}%;background:#e5484d`;
  const z2 = h('i');
  z2.style.cssText = `width:${pc(v.vci[1]) - pc(v.vci[0])}%;background:#f0932b`;
  const z3 = h('i');
  z3.style.cssText = 'flex:1;background:#2fa862';
  track.append(z1, z2, z3);
  gg.append(track);
  for (const t of v.vci) {
    const k = h('span', 'ms-gv-gk');
    k.style.left = `${pc(t)}%`;
    gg.append(k);
  }
  for (const [val, season] of [[soil.ciDry, 'dry'], [soil.ciWet, 'wet']] as const) {
    const mk = h('div', season === 'wet' ? 'ms-gv-gm ms-gv-wet' : 'ms-gv-gm');
    mk.style.left = `${pc(val)}%`;
    mk.append(seasonIcon(season, 12));
    gg.append(mk);
  }
  const gl = h('div', 'ms-gv-gl');
  // End words only where the threshold numbers leave room for them (foot thresholds sit near the left end).
  if (pc(v.vci[0]) >= 18) gl.append(h('span', 'ms-gv-l0', 'bogs'));
  const close = pc(v.vci[1]) - pc(v.vci[0]) < 9;
  v.vci.forEach((t, i) => {
    const lab = h('span', undefined, String(t));
    lab.style.left = `${pc(t)}%`;
    // Two thresholds close together: hang the first left of its tick and the second right of its own.
    if (close) lab.style.transform = i === 0 ? 'translateX(calc(-100% - 2px))' : 'translateX(2px)';
    gl.append(lab);
  });
  if (pc(v.vci[1]) <= 82) gl.append(h('span', 'ms-gv-r0', 'firm'));
  const fmt = (x: number) => (x >= 127 ? '127+' : String(x));
  const txt = h('div', 'ms-gv-soft');
  txt.append(
    'Cone index ',
    seasonIcon('dry', 10),
    ` ${fmt(soil.ciDry)} · `,
    seasonIcon('wet', 10),
    ` ${fmt(soil.ciWet)} · needs ${v.vci[0]} to pass once, ${v.vci[1]} for a column${soil.coarse ? ' (sand)' : ''}`,
  );
  wrap.append(gg, gl, txt);
  return wrap;
}

/** Foot / wheeled / tracked x dry / after rain. */
export function modeGrid(g: PlacementGoingInfo): HTMLElement {
  const mx = h('div', 'ms-gv-mx');
  mx.append(h('span'));
  for (const season of ['dry', 'wet'] as const) {
    const hd = h('span', 'ms-gv-h');
    hd.append(seasonIcon(season, 11), season === 'dry' ? 'Dry' : 'After Rain');
    mx.append(hd);
  }
  for (const m of g.modes) {
    mx.append(h('span', m.active ? 'ms-gv-m ms-gv-on' : 'ms-gv-m', modeShort(m.profile, m.label)));
    mx.append(h('span', `ms-gv-c ms-gv-${m.dry}`, GOING_WORD[m.dry]), h('span', `ms-gv-c ms-gv-${m.wet}`, GOING_WORD[m.wet]));
  }
  return mx;
}

/** Twelve months: bar height = rain, colour = the going that month leaves for the mode. */
export function ribbon(g: PlacementGoingInfo, tall = 42): HTMLElement | null {
  const p = g.point;
  if (!p) return null;
  const wrap = h('div');
  const prec = g.climate?.precMm ?? null;
  const wetMm = g.climate?.wetMm ?? 75;
  const top = prec ? Math.max(wetMm * 1.6, ...prec) : 1;
  const now = g.month ?? new Date().getMonth() + 1;
  const bars = h('div', 'ms-gv-rb');
  bars.style.height = `${tall}px`;
  const labels = h('div', 'ms-gv-rl');
  const wetMonths: string[] = [];
  for (let i = 0; i < 12; i++) {
    const wet = prec ? prec[i] >= wetMm : i >= 6 && i <= 8;
    if (wet) wetMonths.push(MONTH_NAMES[i]);
    const step = wet ? p.wet : p.dry;
    const b = h('i', i + 1 === now ? 'ms-gv-now' : undefined);
    b.style.background = GOING_COLOR[step];
    b.style.height = prec ? `${Math.max(8, (prec[i] / top) * 100)}%` : '60%';
    b.title = `${MONTH_NAMES[i]}: ${prec ? `${Math.round(prec[i])} mm, ` : ''}${GOING_WORD[step]}`;
    bars.append(b);
    labels.append(h('span', i + 1 === now ? 'ms-gv-now' : undefined, MONTHS[i]));
  }
  const note = prec
    ? wetMonths.length
      ? `Wet months (${wetMm} mm or more): ${wetMonths.join(', ')}`
      : `No month reaches ${wetMm} mm of rain here`
    : 'No climate data: Jul to Sep taken as wet';
  wrap.append(bars, labels, h('div', 'ms-gv-soft', note));
  return wrap;
}

/** The going map as a round canvas, turned to the map's north. */
export function goingCanvas(g: PlacementGoingInfo, px: number, northDeg: number, ring = false): HTMLCanvasElement | null {
  const map = g.map;
  if (!map) return null;
  const dpr = Math.min(2, (globalThis as any).devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.round(px * dpr);
  cv.style.width = cv.style.height = `${px}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  ctx.scale(dpr, dpr);
  ctx.save();
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#2a3038';
  ctx.fillRect(0, 0, px, px);
  ctx.translate(px / 2, px / 2);
  ctx.rotate((northDeg * Math.PI) / 180);
  ctx.translate(-px / 2, -px / 2);
  const cell = px / map.size;
  for (let r = 0; r < map.size; r++) {
    for (let q = 0; q < map.size; q++) {
      const v = map.cells[r * map.size + q];
      if (v === 255) continue;
      ctx.fillStyle = GOING_COLOR[CODE_STEP[v]];
      ctx.fillRect(q * cell, r * cell, cell + 0.6, cell + 0.6);
    }
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 1;
  if (ring) {
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px / 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, px / 2 - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#1b1f25';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // north tick
  const a = (northDeg * Math.PI) / 180;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  const tx = px / 2 + Math.sin(a) * (px / 2 - 5);
  const ty = px / 2 - Math.cos(a) * (px / 2 - 5);
  ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

function mapShares(g: PlacementGoingInfo): HTMLElement | null {
  const map = g.map;
  if (!map) return null;
  const n = [0, 0, 0];
  for (const v of map.cells) if (v < 3) n[v]++;
  const tot = n[0] + n[1] + n[2];
  if (!tot) return null;
  const grid = h('div', 'ms-gv-pc');
  for (let i = 0; i < 3; i++) {
    const dot = h('span', 'ms-gv-dot');
    dot.style.background = GOING_COLOR[CODE_STEP[i]];
    const t = h('span');
    t.append(h('b', undefined, `${Math.round((n[i] / tot) * 100)}%`), ` ${GOING_WORD[CODE_STEP[i]]}`);
    grid.append(dot, t);
  }
  return grid;
}

/** USDA texture triangle with this soil's class filled (Sand bottom-left, Silt bottom-right, Clay top). */
export function textureTriangle(texture: number, size: number): SVGElement {
  const W = size;
  const H = size * 0.87;
  const pad = 4;
  const svg = s('svg', { width: W, height: H + 14, viewBox: `0 -6 ${W} ${H + 20}`, role: 'img', 'aria-label': 'Soil texture triangle' });
  const xy = ([sa, cl]: [number, number]) => {
    const si = 100 - sa - cl;
    const x = (si + cl / 2) / 100;
    const y = cl / 100;
    return `${(pad + x * (W - 2 * pad)).toFixed(1)},${(H - pad - y * (H - 2 * pad)).toFixed(1)}`;
  };
  for (const [id, poly] of Object.entries(TEXTURE_POLYGONS)) {
    const on = Number(id) === texture;
    svg.append(
      s('polygon', {
        points: poly.map(xy).join(' '),
        fill: on ? (SOIL_COLOR[texture] ?? '#8a6a4a') : 'rgba(255,255,255,.05)',
        stroke: on ? '#fff' : 'rgba(255,255,255,.22)',
        'stroke-width': on ? 1.6 : 0.7,
      }),
    );
  }
  const label = (x: number, y: number, t: string, anchor = 'start') => {
    const e = s('text', { x, y, 'font-size': 8, fill: '#9aa3ad', 'text-anchor': anchor });
    e.textContent = t;
    svg.append(e);
  };
  label(pad, H + 9, 'Sand');
  label(W - pad, H + 9, 'Silt', 'end');
  label(W / 2, 0, 'Clay', 'middle');
  return svg;
}

// ── card options ───────────────────────────────────────────────────────────

/** A · Going Lines. */
export function goingLinesSection(g: PlacementGoingInfo, v: PlacementVerdict): HTMLElement | null {
  const p = g.point;
  if (!p) return null;
  const row = (season: 'dry' | 'wet', step: GoingStep) => {
    const r = h('div', 'ms-gv-row');
    const k = h('span', 'ms-gv-k');
    k.append(seasonIcon(season), season === 'dry' ? 'Dry' : 'After Rain');
    r.append(k, goingScale(step));
    return r;
  };
  const soil = g.soil;
  let line: HTMLElement | null = null;
  if (soil) {
    line = h('div', 'ms-gv-line');
    line.append(h('span', 'ms-gv-b', soil.label));
    const chip = sourceChip(g);
    if (chip) line.append(chip);
  }
  let lim: HTMLElement | null = null;
  const { limitDry: d, limitWet: w } = p;
  if (d || w) {
    lim = h('div', 'ms-gv-limit');
    if (d && w && d !== w) lim.append('Limited by ', h('span', 'ms-gv-b', d), '; after rain by ', h('span', 'ms-gv-b', w));
    else if (d) lim.append('Limited by ', h('span', 'ms-gv-b', d));
    else lim.append('After rain: limited by ', h('span', 'ms-gv-b', w!));
  }
  return band('T', `Cross-Country · ${modeShort(v.profile, v.profileLabel)}`, row('dry', p.dry), row('wet', p.wet), line, lim);
}

/** B · Movement Rose. */
export function movementRoseSection(g: PlacementGoingInfo, northDeg: number): HTMLElement | null {
  const m = g.movement;
  if (!m) return null;
  const box = h('div', 'ms-gv-rose');
  const txt = h('div');
  const rate = h('div', 'ms-gv-rate', RATING_LABEL[m.rating]);
  rate.style.color = RATING_COLOR[m.rating];
  txt.append(rate, h('div', 'ms-gv-blk', `${m.open} of 8 directions open to ${fmtDistance(m.rangeM / 2)}`), h('div', 'ms-gv-blk', blockedText(g)));
  box.append(roseSvg(g, 82, false, northDeg), txt);
  return band('T', `Movement Freedom · ${seasonWord(g)}`, box, legend(true), g.pending ? h('div', 'ms-gv-soft', 'Still loading round the edges') : null);
}

/** C · Soil Strength. */
export function soilStrengthSection(g: PlacementGoingInfo, v: PlacementVerdict): HTMLElement | null {
  const soil = g.soil;
  if (!soil) return null;
  const head = h('div', 'ms-gv-soil');
  const sw = h('span', 'ms-gv-sw');
  sw.style.background = SOIL_COLOR[soil.texture] ?? '#8a6a4a';
  const name = h('div');
  const chipLine = h('div', 'ms-gv-line');
  chipLine.style.marginTop = '2px';
  const chip = sourceChip(g);
  if (chip) chipLine.append(chip);
  name.append(h('div', 'ms-gv-b', soil.label), chipLine);
  head.append(sw, name);
  const gauge = soilGauge(g);
  const note = soil.note ? h('div', 'ms-gv-soft', soil.note) : null;
  const caption = g.vehicle ? `Soil · ${modeShort(v.profile, v.profileLabel)}` : 'Soil';
  return band('G', caption, head, gauge ?? h('div', 'ms-gv-soft', 'This mode is not judged on soil.'), note);
}

/** E · Exit Strip: the eight directions in one row (bar = reach, white cap = blocked). */
export function exitStripSection(g: PlacementGoingInfo): HTMLElement | null {
  const m = g.movement;
  if (!m) return null;
  const row = h('div', 'ms-gv-ex');
  for (const x of m.sectors) {
    const cell = h('div');
    const bar = h('i', x.blockedBy && x.reachM < m.rangeM ? 'ms-gv-cut' : undefined);
    const fill = h('b');
    fill.style.height = `${Math.max(12, Math.min(100, (x.reachM / m.rangeM) * 100))}%`;
    fill.style.background = GOING_COLOR[x.step];
    bar.append(fill);
    bar.title = `${x.compass}: ${GOING_WORD[x.step]}, ${fmtDistance(x.reachM)}${x.blockedBy ? ` (${x.blockedBy})` : ''}`;
    cell.append(bar, h('small', undefined, x.compass));
    row.append(cell);
  }
  const open = m.sectors.filter((x) => x.step !== 'nogo' && x.reachM >= m.rangeM / 2).map((x) => x.compass);
  const rate = h('span', 'ms-gv-b', RATING_LABEL[m.rating]);
  rate.style.color = RATING_COLOR[m.rating];
  const line = h('div', 'ms-gv-blk');
  line.append(rate, open.length ? ` · open ${open.join(' ')}` : ' · no direction open');
  return band('T', `Exits · ${seasonWord(g)} · ${fmtDistance(m.rangeM)}`, row, line, h('div', 'ms-gv-blk', blockedText(g, 2)));
}

/** F · Mode Matrix. */
export function modeMatrixSection(g: PlacementGoingInfo): HTMLElement | null {
  if (!g.modes.length) return null;
  return band('T', 'Going by Mode', modeGrid(g));
}

/** G · Season Ribbon. */
export function seasonRibbonSection(g: PlacementGoingInfo, v: PlacementVerdict): HTMLElement | null {
  const r = ribbon(g);
  return r ? band('T', `Going by Month · ${modeShort(v.profile, v.profileLabel)}`, r) : null;
}

/** H · Going Map. */
export function goingMapSection(g: PlacementGoingInfo, northDeg: number): HTMLElement | null {
  const cv = goingCanvas(g, 84, northDeg);
  if (!cv || !g.map) return null;
  const box = h('div', 'ms-gv-map');
  box.append(cv, mapShares(g) ?? h('span'));
  return band('T', `Going Map · ${seasonWord(g)} · ${fmtDistance(g.map.rangeM)}`, box);
}

/** Every card section switched on in `card`, in the order of the letters. */
export function goingSections(v: PlacementVerdict, card: PlacementCardOptions, northDeg: number): HTMLElement[] {
  const g = v.going;
  if (!g) return [];
  ensureGoingCss();
  const out: Array<HTMLElement | null> = [
    card.goingLines ? goingLinesSection(g, v) : null,
    card.movementRose ? movementRoseSection(g, northDeg) : null,
    card.soilStrength ? soilStrengthSection(g, v) : null,
    card.exitStrip ? exitStripSection(g) : null,
    card.modeMatrix ? modeMatrixSection(g) : null,
    card.seasonRibbon ? seasonRibbonSection(g, v) : null,
    card.goingMap ? goingMapSection(g, northDeg) : null,
  ];
  return out.filter((x): x is HTMLElement => x !== null);
}

/** "G Ground Brief" cue at the foot of the card. */
export function briefCue(): HTMLElement {
  ensureGoingCss();
  const f = h('div', 'ms-gv-foot');
  f.append(h('span', 'ms-gv-kbd', 'G'), 'Ground Brief');
  return f;
}
