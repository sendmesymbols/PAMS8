/**
 * GroundGuideGoingView.ts
 *
 * The going, soil and movement sections of the Ground Guide card and the Ground Brief (GROTBC T, with soil under G).
 * Each card option is one builder, so the user can switch them on one at a time and compare
 * (groundGuide.card.*, letters as in ground-guide-card-movement.html):
 *
 *   A goingLines    cross-country going dry / after rain, the soil and what limits the going
 *   B movementRose  eight wedges: going and reach per direction, with a freedom rating
 *   C soilStrength  soil swatch + cone-index gauge against the mode's thresholds
 *   E exitStrip     the eight directions as one compact row
 *   F modeMatrix    foot / wheeled / tracked x dry / after rain
 *   G seasonRibbon  twelve months of rain coloured by the going they leave
 *   H goingMap      a small picture of the going all round the point
 *
 * DOM nodes and textContent only (labels come from the bundle), like GroundGuideBadge.ts.
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { compassNode, joinNodes, orientNorth, registerCanvas } from './GroundGuideNorth';
import {
  CODE_STEP,
  GOING_WORD,
  RATING_COLOR,
  RATING_LABEL,
  SOIL_COLOR,
  TEXTURE_POLYGONS,
} from './GroundGuideGoing';
import {
  ensureTokensCss,
  FONT,
  FS,
  FW,
  gauge,
  LETTER_FG,
  LETTER_FILL,
  LINE,
  ROSE_C,
  ROSE_R,
  roseFrame,
  roseHub,
  roseKey,
  STEP_COLOR,
  SURFACE,
  TEXT,
  TONE,
  wedgePath,
  type RoseFrame,
} from './GroundGuideTokens';
import type { GoingStep, GroundGuideCardOptions, GroundGuideGoingInfo, GroundGuideVerdict } from './GroundGuideTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'ms-ground-guide-going-style';
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT: Record<string, string> = { dismounted: 'Foot', wheeled: 'Wheeled', tracked: 'Tracked' };

/**
 * Sizes and colours come from GroundGuideTokens.ts (2026-11-08 visual review): five type steps, labels in TEXT.label,
 * no text faded with opacity, no uppercase labels (GO / SLOW-GO / NO-GO stay in capitals: they are terms).
 */
export const GOING_CSS = `
.ms-gv-cap{display:flex;align-items:center;gap:6px}
.ms-gv-l{display:inline-flex;align-items:center;justify-content:center;flex:none;width:17px;height:17px;border-radius:4px;font:${FW.bold} ${FS.meta}px/1 ${FONT};color:${LETTER_FG};background:${LETTER_FILL}}
.ms-gv-row{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px;align-items:center}
.ms-gv-row+.ms-gv-row{margin-top:6px}
.ms-gv-k{display:flex;align-items:center;gap:5px;font-size:${FS.body}px;color:${TEXT.label};white-space:nowrap}
.ms-gv-line{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
.ms-gv-b{font-weight:${FW.semi};color:${TEXT.strong}}
.ms-gv-soft{color:${TEXT.soft};font-size:${FS.meta}px;line-height:1.35;padding-top:2px}
.ms-gv-chip{display:inline;font:${FW.semi} ${FS.meta}px/1.3 ${FONT};color:${TEXT.warn}}
.ms-gv-chip.ms-gv-mapped{color:${TEXT.main}}
.ms-gv-limit{margin-top:6px;font-size:${FS.meta}px;color:${TEXT.label}}
.ms-gv-rose{display:flex;gap:10px;align-items:center}
.ms-gv-rose>svg,.ms-gv-rose>figure{flex:none}
.ms-gv-rose>div{min-width:0}
.ms-gv-fig{margin:0;flex:none;width:132px;display:flex;flex-direction:column;align-items:center}
.ms-gv-fig>.ms-gg-rkey{margin-top:2px;max-width:132px}
.ms-gv-rate{font-size:${FS.value}px;font-weight:${FW.bold};line-height:1.15}
.ms-gv-blk{font-size:${FS.meta}px;color:${TEXT.label};margin-top:3px;line-height:1.35}
.ms-gv-blk b{color:${TEXT.main};font-weight:${FW.semi}}
.ms-gv-leg{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:6px;font-size:${FS.meta}px;color:${TEXT.label}}
.ms-gv-leg>span{white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
.ms-gv-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex:none}
.ms-gv-soil{display:flex;gap:9px;align-items:center}
.ms-gv-sw{flex:none;width:30px;height:30px;border-radius:7px;border:1px solid ${LINE.hair};box-shadow:inset 0 -6px 10px rgba(0,0,0,.25)}
.ms-gv-g{position:relative;margin:17px 2px 2px}
.ms-gv-gt{display:flex;height:9px;border-radius:5px;overflow:hidden}
.ms-gv-gt>i{height:100%}
.ms-gv-gk{position:absolute;top:9px;width:1px;height:5px;background:${TEXT.label}}
.ms-gv-gm{position:absolute;top:-16px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center}
.ms-gv-gm::after{content:"";width:2px;height:14px;background:${TEXT.strong};margin-top:-1px;border-radius:1px;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.ms-gv-gm.ms-gv-wet::after{background:#bfe2ff}
.ms-gv-gl{position:relative;height:15px;font-size:${FS.meta}px;line-height:15px;color:${TEXT.label};margin-top:3px;font-variant-numeric:tabular-nums}
.ms-gv-gl>span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
.ms-gv-gl>.ms-gv-l0{left:0;transform:none}.ms-gv-gl>.ms-gv-r0{right:0;transform:none}
.ms-gv-mx{display:grid;grid-template-columns:auto 1fr 1fr;gap:3px 4px;font-size:${FS.meta}px;align-items:center}
.ms-gv-mx>.ms-gv-h{font-size:${FS.meta}px;color:${TEXT.label};display:flex;gap:4px;justify-content:center;align-items:center}
.ms-gv-mx>.ms-gv-m{color:${TEXT.label};padding-right:6px;white-space:nowrap}
.ms-gv-mx>.ms-gv-m.ms-gv-on{color:${TEXT.strong};font-weight:${FW.semi}}
.ms-gv-mx>.ms-gv-c{font:${FW.bold} ${FS.meta}px/1 ${FONT};text-align:center;padding:4px 0 3px;border-radius:3px}
.ms-gv-c.ms-gv-go{background:${TONE.go.fill};color:${TONE.go.fg}}.ms-gv-c.ms-gv-slow{background:${TONE.slow.fill};color:${TONE.slow.fg}}.ms-gv-c.ms-gv-nogo{background:${TONE.nogo.fill};color:${TONE.nogo.fg}}
.ms-gv-exc{display:flex;flex-direction:column;align-items:center;margin:2px 0 5px}
.ms-gv-rb{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;align-items:end;height:42px}
.ms-gv-rb>i{display:block;border-radius:2px 2px 0 0;min-height:3px}
.ms-gv-rb>i.ms-gv-now{outline:1.5px solid ${TEXT.strong};outline-offset:1px}
.ms-gv-rl{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;font:${FW.semi} ${FS.meta}px/1.1 ${FONT};color:${TEXT.label};text-align:center;margin-top:3px}
.ms-gv-rl>.ms-gv-now{color:${TEXT.strong};font-weight:${FW.bold}}
.ms-gv-map{display:flex;gap:10px;align-items:center}
.ms-gv-map>canvas{flex:none;border-radius:50%}
.ms-gv-pc{display:grid;grid-template-columns:auto 1fr;gap:2px 7px;font-size:${FS.meta}px;align-items:center;color:${TEXT.label}}
.ms-gv-pc b{font-weight:${FW.semi};color:${TEXT.strong};font-variant-numeric:tabular-nums}
.ms-gv-foot{display:flex;align-items:center;flex-wrap:wrap;gap:6px 16px;padding:6px 12px;border-top:1px solid ${LINE.hair};color:${TEXT.main};font:${FW.regular} ${FS.body}px/1.2 ${FONT}}
.ms-gv-foot>.ms-gv-fi{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;color:${TEXT.main};font-size:${FS.body}px}
.ms-gv-kbd{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:4px;font:${FW.bold} ${FS.meta}px/1 ui-monospace,Consolas,monospace;color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px}
`;

export function ensureGoingCss(): void {
  ensureTokensCss();
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
  const sec = h('div', 'ms-ggb-sec');
  const cap = h('div', 'ms-ggb-cap ms-gv-cap');
  cap.append(h('span', 'ms-gv-l', letter), caption);
  cap.firstElementChild!.setAttribute('data-l', letter);
  sec.append(cap, ...content.filter((c): c is Node => c !== null));
  return sec;
}

/** GO / SLOW-GO / NO-GO as the shared gauge (item 2): the step lit, a pointer over it, nothing that looks pressable. */
export function goingScale(step: GoingStep): HTMLElement {
  const g = gauge(step);
  g.classList.add('ms-gv-scale'); // kept for layout rules elsewhere that still name it
  return g;
}

/** "Better Than Guess" → "better than guess": words in Title Case lowered, capitals (MSR, 1:50k) kept. */
function sentence(s: string): string {
  return s.replace(/\b([A-Z])([a-z]+)\b/g, (_m, a: string, b: string) => a.toLowerCase() + b);
}

/** A round picture with its one-line key under it (item 12). A `figure`, so layout rules aimed at `div` columns pass it by. */
export function roseFigure(pic: Element, key: Element | null): HTMLElement {
  ensureGoingCss();
  const f = h('figure', 'ms-gv-fig');
  f.append(pic);
  if (key) f.append(key);
  return f;
}

/**
 * Turn a round picture to the map's north now, its letters upright. Attributes only (no CSS variable is stamped on the
 * picture), so the card's own north pass (`orientNorth`) turns it again later as the map turns.
 */
export function turnRose(f: RoseFrame, northDeg: number): void {
  const n = Math.round((northDeg || 0) * 10) / 10;
  if (!n) return;
  f.g.setAttribute('transform', `rotate(${n} ${ROSE_C} ${ROSE_C})`);
  f.g.querySelectorAll('[data-gv-upright]').forEach((u) => {
    const [x, y] = (u.getAttribute('data-gv-upright') ?? '0 0').split(/\s+/);
    u.setAttribute('transform', `rotate(${-n} ${x} ${y ?? x})`);
  });
}

/** A distance label on a range ring: readable on the wedges under it (a dark halo), never turned with the map. */
function ringLabel(f: RoseFrame, y: number, text: string): void {
  f.add(
    'text',
    {
      x: ROSE_C + 3,
      y,
      fill: TEXT.label,
      'font-size': 11,
      'font-family': FONT,
      'font-weight': FW.semi,
      stroke: SURFACE.ring,
      'stroke-width': 3,
      'paint-order': 'stroke',
      'stroke-linejoin': 'round',
    },
    f.svg,
    text,
  );
}

function seasonWord(g: GroundGuideGoingInfo): string {
  return g.season === 'dry' ? 'Dry' : 'After Rain';
}

function modeShort(profile: string, label: string): string {
  return SHORT[profile] ?? label;
}

export function sourceChip(g: GroundGuideGoingInfo): HTMLElement | null {
  const soil = g.soil;
  if (!soil) return null;
  // A coloured word in sentence case, not an uppercase chip (item 13): the map's own class, or a modelled guess.
  if (soil.mapped) return h('span', 'ms-gv-chip ms-gv-mapped', '1:50k map');
  return h('span', 'ms-gv-chip', soil.confidenceLabel ? `Modelled · ${sentence(soil.confidenceLabel)}` : 'Modelled');
}

/**
 * The one-line key under the movement rose (item 12): "Length to 1 km · colour = going". `rangeM` names the range the
 * longest wedge stands for; without it the key says "Length = reach".
 */
export function roseLegend(withReach: boolean, rangeM?: number | null): HTMLElement {
  if (!withReach) return roseKey('Colour = going');
  return roseKey(rangeM ? `Length to ${fmtDistance(rangeM)} · colour = going` : 'Length = reach · colour = going');
}

export function blockedText(g: GroundGuideGoingInfo, max = 3, sep = ' · '): string {
  const m = g.movement;
  if (!m) return '';
  const items: string[] = [];
  for (const x of m.sectors) {
    if (x.blockedBy && x.reachM < m.rangeM) items.push(`${x.compass} ${x.blockedBy} ${fmtDistance(x.reachM)}`);
    else if (x.step === 'nogo') items.push(`${x.compass} NO-GO Gr`);
  }
  if (!items.length) return `Nothing blocks the way within ${fmtDistance(m.rangeM)}`;
  return 'Blocked: ' + items.slice(0, max).join(sep) + (items.length > max ? `${sep}+${items.length - max} more` : '');
}

/** `blockedText` as nodes: each blocked direction carries its arrow, which turns with the map. */
export function blockedNode(g: GroundGuideGoingInfo, max = 3, sep = ' · '): DocumentFragment {
  const m = g.movement;
  const f = document.createDocumentFragment();
  if (!m) return f;
  const items: DocumentFragment[] = [];
  for (const x of m.sectors) {
    if (x.blockedBy && x.reachM < m.rangeM) items.push(joinNodes([compassNode(x.compass, x.bearingDeg), ` ${x.blockedBy} ${fmtDistance(x.reachM)}`], ''));
    else if (x.step === 'nogo') items.push(joinNodes([compassNode(x.compass, x.bearingDeg), ' NO-GO Gr'], ''));
  }
  if (!items.length) {
    f.append(`Nothing blocks the way within ${fmtDistance(m.rangeM)}`);
    return f;
  }
  f.append('Blocked: ', joinNodes(items.slice(0, max), sep));
  if (items.length > max) f.append(`${sep}+${items.length - max} more`);
  return f;
}

// ── shared pictures (card and brief) ───────────────────────────────────────

/**
 * The movement rose in the shared frame (item 12): eight wedges in map bearings, as long as the going reaches (the
 * ring is the range), coloured GO / SLOW-GO / NO-GO, with a white arc where something blocks the way. The group turns
 * with the map (`data-gv-rose`). Drawn at ROSE_PX on screen: `size` is kept for the callers but no longer used.
 * `rings`: the half-range ring and both distances written on it.
 */
export function roseSvg(g: GroundGuideGoingInfo, size: number, rings: boolean, northDeg: number): SVGElement {
  void size;
  const m = g.movement!;
  const f = roseFrame(`Going and reach by direction, to ${fmtDistance(m.rangeM)}`);
  const r0 = 9;
  const R = ROSE_R;
  const ringR = (k: number) => r0 + (R - r0) * k;
  f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: ringR(0.5), fill: 'none', stroke: rings ? LINE.ring : LINE.hair, 'stroke-dasharray': '2 3' });
  const P = (deg: number, rr: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(ROSE_C + rr * Math.sin(a)).toFixed(2)} ${(ROSE_C - rr * Math.cos(a)).toFixed(2)}`;
  };
  for (const x of m.sectors) {
    const a0 = x.bearingDeg - 20.5;
    const a1 = x.bearingDeg + 20.5;
    const r = Math.max(r0 + 3, ringR(Math.min(1, x.reachM / m.rangeM)));
    const w = f.add('path', { d: wedgePath(r0, r, a0, a1), fill: STEP_COLOR[x.step], stroke: SURFACE.ring, 'stroke-width': 0.8 });
    const tip = s('title', {});
    tip.textContent = `${x.compass}: ${GOING_WORD[x.step]}, ${fmtDistance(x.reachM)}${x.blockedBy && x.reachM < m.rangeM ? ` (${x.blockedBy})` : ''}`;
    w.append(tip);
    if (x.blockedBy && x.reachM < m.rangeM) {
      f.add('path', { d: `M${P(a0, r)} A${r} ${r} 0 0 1 ${P(a1, r)}`, fill: 'none', stroke: TEXT.strong, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
    }
  }
  roseHub(f, r0 - 2);
  turnRose(f, northDeg);
  if (rings) {
    ringLabel(f, ROSE_C - ringR(0.5) + 11, fmtDistance(m.rangeM / 2));
    ringLabel(f, ROSE_C - R + 11, fmtDistance(m.rangeM));
  }
  return f.svg;
}

/** Turn every rose, arrow, dial and canvas under `root` to the map's north (no rebuild): `orientNorth` in GroundGuideNorth.ts. */
export function orientRoses(root: ParentNode, northDeg: number): void {
  orientNorth(root, northDeg);
}

/** Cone-index gauge: the mode's NO-GO / SLOW-GO / GO zones, the sun at the dry value, the drop after rain. */
export function soilGauge(g: GroundGuideGoingInfo): HTMLElement | null {
  const soil = g.soil;
  const v = g.vehicle;
  if (!soil || !v || soil.ciDry === null || soil.ciWet === null) return null;
  const max = 130;
  const pc = (x: number) => Math.min(100, Math.max(0, (x / max) * 100));
  const wrap = h('div');
  const gg = h('div', 'ms-gv-g');
  const track = h('div', 'ms-gv-gt');
  const z1 = h('i');
  z1.style.cssText = `width:${pc(v.vci[0])}%;background:${STEP_COLOR.nogo}`;
  const z2 = h('i');
  z2.style.cssText = `width:${pc(v.vci[1]) - pc(v.vci[0])}%;background:${STEP_COLOR.slow}`;
  const z3 = h('i');
  z3.style.cssText = `flex:1;background:${STEP_COLOR.go}`;
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
  const close = pc(v.vci[1]) - pc(v.vci[0]) < 11;
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
export function modeGrid(g: GroundGuideGoingInfo): HTMLElement {
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
export function ribbon(g: GroundGuideGoingInfo, tall = 42): HTMLElement | null {
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
    b.style.background = STEP_COLOR[step];
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

/**
 * The going map as a round canvas, turned to the map's north. The painter is registered with the north pass
 * (`registerCanvas`), so `orientNorth` repaints it in place when the map is rotated after the card was built.
 */
export function goingCanvas(g: GroundGuideGoingInfo, px: number, northDeg: number, ring = false): HTMLCanvasElement | null {
  const map = g.map;
  if (!map) return null;
  const dpr = Math.min(2, (globalThis as any).devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.round(px * dpr);
  cv.style.width = cv.style.height = `${px}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const paint = (north: number): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.scale(dpr, dpr);
    ctx.save();
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = SURFACE.head;
    ctx.fillRect(0, 0, px, px);
    ctx.translate(px / 2, px / 2);
    ctx.rotate((north * Math.PI) / 180);
    ctx.translate(-px / 2, -px / 2);
    const cell = px / map.size;
    for (let r = 0; r < map.size; r++) {
      for (let q = 0; q < map.size; q++) {
        const v = map.cells[r * map.size + q];
        if (v === 255) continue;
        ctx.fillStyle = STEP_COLOR[CODE_STEP[v]];
        ctx.fillRect(q * cell, r * cell, cell + 0.6, cell + 0.6);
      }
    }
    ctx.restore();
    ctx.strokeStyle = LINE.ring;
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
    ctx.fillStyle = SURFACE.card;
    ctx.strokeStyle = '#c9d1d9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // North: a tick on the rim and the letter beside it, both where north now points.
    const a = (north * Math.PI) / 180;
    ctx.fillStyle = TEXT.strong;
    ctx.beginPath();
    const tx = px / 2 + Math.sin(a) * (px / 2 - 5);
    const ty = px / 2 - Math.cos(a) * (px / 2 - 5);
    ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (px >= 100) {
      ctx.font = `${FW.bold} 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = TEXT.main;
      ctx.fillText('N', px / 2 + Math.sin(a) * (px / 2 - 15), px / 2 - Math.cos(a) * (px / 2 - 15));
    }
  };
  paint(northDeg);
  registerCanvas(cv, paint);
  return cv;
}

export function mapShares(g: GroundGuideGoingInfo): HTMLElement | null {
  const map = g.map;
  if (!map) return null;
  const n = [0, 0, 0];
  for (const v of map.cells) if (v < 3) n[v]++;
  const tot = n[0] + n[1] + n[2];
  if (!tot) return null;
  const grid = h('div', 'ms-gv-pc');
  for (let i = 0; i < 3; i++) {
    const dot = h('span', 'ms-gv-dot');
    dot.style.background = STEP_COLOR[CODE_STEP[i]];
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
  // Room above for "Clay" and below for "Sand" / "Silt" at 11 px, drawn 1:1 so the labels stay that size on screen.
  const svg = s('svg', { width: W, height: H + 24, viewBox: `0 -10 ${W} ${H + 24}`, role: 'img', 'aria-label': 'Soil texture triangle' });
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
        stroke: on ? TEXT.strong : LINE.ring,
        'stroke-width': on ? 1.6 : 0.7,
      }),
    );
  }
  const label = (x: number, y: number, t: string, anchor = 'start') => {
    const e = s('text', { x, y, 'font-size': 11, 'font-family': FONT, fill: TEXT.label, 'text-anchor': anchor });
    e.textContent = t;
    svg.append(e);
  };
  label(pad, H + 11, 'Sand');
  label(W - pad, H + 11, 'Silt', 'end');
  label(W / 2, -1, 'Clay', 'middle');
  return svg;
}

// ── card options ───────────────────────────────────────────────────────────

/** A · Going Lines. */
export function goingLinesSection(g: GroundGuideGoingInfo, v: GroundGuideVerdict): HTMLElement | null {
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
export function movementRoseSection(g: GroundGuideGoingInfo, northDeg: number): HTMLElement | null {
  const m = g.movement;
  if (!m) return null;
  const box = h('div', 'ms-gv-rose');
  const txt = h('div');
  const rate = h('div', 'ms-gv-rate', RATING_LABEL[m.rating]);
  rate.style.color = RATING_COLOR[m.rating];
  const blocked = h('div', 'ms-gv-blk');
  blocked.append(blockedNode(g));
  txt.append(rate, openDirsLine(m.open, m.rangeM), blocked);
  box.append(roseFigure(roseSvg(g, 0, false, northDeg), roseLegend(true, m.rangeM)), txt);
  return band('T', `Movement Freedom · ${seasonWord(g)}`, box, g.pending ? h('div', 'ms-gv-soft', 'Still loading round the edges') : null);
}

/**
 * "Open Dirs 6 of 8, to 500 m" (item 10): the directions the mode can go cross-country, at least half the range and
 * not NO-GO; the same name and number on O Exits and T Movement.
 */
export function openDirsLine(open: number, rangeM: number): HTMLElement {
  const d = h('div', 'ms-gv-blk');
  d.append('Open Dirs ', h('b', undefined, `${open} of 8`), `, to ${fmtDistance(rangeM / 2)}`);
  return d;
}

/** C · Soil Strength. */
export function soilStrengthSection(g: GroundGuideGoingInfo, v: GroundGuideVerdict): HTMLElement | null {
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

/**
 * E · Exits as spokes in the shared frame (item 12): one spoke per direction, as long as the going reaches (the ring
 * is the range), coloured GO / SLOW-GO / NO-GO, with a white bar across it where something blocks the way. The group
 * turns with the map (`data-gv-rose`, orientNorth); the frame's N stays upright. Drawn at ROSE_PX: `size` is kept for
 * the callers but no longer used.
 */
export function exitCompass(g: GroundGuideGoingInfo, size = 104): SVGElement | null {
  void size;
  const m = g.movement;
  if (!m) return null;
  const R = ROSE_R;
  const r0 = 7;
  const P = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [ROSE_C + r * Math.sin(a), ROSE_C - r * Math.cos(a)];
  };
  const f = roseFrame(`Open Dirs ${m.open} of 8: going by direction to ${fmtDistance(m.rangeM)}`);
  f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: r0 + (R - r0) / 2, fill: 'none', stroke: LINE.hair, 'stroke-dasharray': '2 3' });
  for (const x of m.sectors) {
    const cardinal = x.bearingDeg % 90 === 0;
    const [tx, ty] = P(x.bearingDeg, R);
    const [ix, iy] = P(x.bearingDeg, r0);
    f.add('line', { x1: ix.toFixed(2), y1: iy.toFixed(2), x2: tx.toFixed(2), y2: ty.toFixed(2), stroke: LINE.soft, 'stroke-width': 1 });
    const r = r0 + (R - r0) * Math.max(0.12, Math.min(1, x.reachM / m.rangeM));
    const [ex, ey] = P(x.bearingDeg, r);
    const spoke = f.add('line', {
      x1: ix.toFixed(2),
      y1: iy.toFixed(2),
      x2: ex.toFixed(2),
      y2: ey.toFixed(2),
      stroke: STEP_COLOR[x.step],
      'stroke-width': cardinal ? 5.5 : 4.5,
      'stroke-linecap': 'round',
    });
    const tip = s('title', {});
    tip.textContent = `${x.compass}: ${GOING_WORD[x.step]}, ${fmtDistance(x.reachM)}${x.blockedBy ? ` (${x.blockedBy})` : ''}`;
    spoke.append(tip);
    if (x.blockedBy && x.reachM < m.rangeM) {
      // A white bar across the spoke's end: something stops the way there.
      const a = (x.bearingDeg * Math.PI) / 180;
      const dx = 5 * Math.cos(a);
      const dy = 5 * Math.sin(a);
      f.add('line', { x1: (ex - dx).toFixed(2), y1: (ey - dy).toFixed(2), x2: (ex + dx).toFixed(2), y2: (ey + dy).toFixed(2), stroke: TEXT.strong, 'stroke-width': 2.4, 'stroke-linecap': 'round' });
    }
  }
  roseHub(f, r0 - 1.5);
  return f.svg;
}

/** The key under the Exits spokes: "Spoke to 2 km · colour = going". */
export function exitKey(rangeM: number): HTMLElement {
  return roseKey(`Spoke to ${fmtDistance(rangeM)} · colour = going`);
}

/**
 * E · Exits: the spokes with their key, then how free the movement is, the Open Dirs (item 10: the same number as T)
 * and what blocks the way. `size`: kept for the callers (the spokes are drawn at ROSE_PX).
 */
export function exitStripSection(g: GroundGuideGoingInfo, size = 96): HTMLElement | null {
  const m = g.movement;
  if (!m) return null;
  const pic = h('div', 'ms-gv-exc');
  pic.append(exitCompass(g, size)!, exitKey(m.rangeM));
  const open = m.sectors.filter((x) => x.step !== 'nogo' && x.reachM >= m.rangeM / 2);
  const rate = h('span', 'ms-gv-b', RATING_LABEL[m.rating]);
  rate.style.color = RATING_COLOR[m.rating];
  const line = h('div', 'ms-gv-blk');
  line.append(rate, ' · Open Dirs ', h('b', undefined, `${m.open} of 8`));
  // Name the open directions when some are shut (all eight open needs no list).
  if (open.length && open.length < 8) line.append(': ', joinNodes(open.map((x) => compassNode(x.compass, x.bearingDeg)), ' '));
  const blocked = h('div', 'ms-gv-blk');
  blocked.append(blockedNode(g, 2));
  return band('T', `Exits · ${seasonWord(g)} · ${fmtDistance(m.rangeM)}`, pic, line, blocked);
}

/** F · Mode Matrix. */
export function modeMatrixSection(g: GroundGuideGoingInfo): HTMLElement | null {
  if (!g.modes.length) return null;
  return band('T', 'Going by Mode', modeGrid(g));
}

/** G · Season Ribbon. */
export function seasonRibbonSection(g: GroundGuideGoingInfo, v: GroundGuideVerdict): HTMLElement | null {
  const r = ribbon(g);
  return r ? band('T', `Going by Month · ${modeShort(v.profile, v.profileLabel)}`, r) : null;
}

/** H · Going Map. The canvas repaints itself when the map turns (registerCanvas, orientNorth). */
export function goingMapSection(g: GroundGuideGoingInfo, northDeg: number): HTMLElement | null {
  const cv = goingCanvas(g, 84, northDeg);
  if (!cv || !g.map) return null;
  const box = h('div', 'ms-gv-map');
  box.append(cv, mapShares(g) ?? h('span'));
  return band('T', `Going Map · ${seasonWord(g)} · ${fmtDistance(g.map.rangeM)}`, box);
}

/** Every card section switched on in `card`, in the order of the letters. */
export function goingSections(v: GroundGuideVerdict, card: GroundGuideCardOptions, northDeg: number): HTMLElement[] {
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

/** One footer item: a keycap and its word, at full strength. */
export function footItem(key: string, word: string): HTMLElement {
  ensureGoingCss();
  const it = h('span', 'ms-gv-fi');
  it.append(h('span', 'ms-gv-kbd', key), word);
  return it;
}

/**
 * The card's footer (item 6): "D Detail · H Hint" at full strength (H only with `hintKey`; it shrinks the card to its
 * hint chip). A flex row with a gap whose direct children are inline items, so the card can append its own (S Quick Fix).
 */
export function detailCue(hintKey = false): HTMLElement {
  ensureGoingCss();
  const f = h('div', 'ms-gv-foot');
  f.append(footItem('D', 'Detail'));
  if (hintKey) f.append(footItem('H', 'Hint'));
  return f;
}
