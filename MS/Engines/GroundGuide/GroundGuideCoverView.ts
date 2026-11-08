/**
 * GroundGuideCoverView.ts
 *
 * C (Cover, Camouflage & Concealment) on the Ground Guide card and in the Ground Brief, from `v.cover`
 * (GroundGuideCover.ts). Every card style is kept, as with T and People, so the owner can compare them live
 * (ground-guide-cover-options.html shows them side by side); `groundGuide.cover.card` picks one:
 *   lines    C1  four lines with a four-step meter and what gives each; the mode's need marked
 *   grid     C2  Cover (direct, indirect) beside Concealment (ground, aerial) as four shaded tiles
 *   summary  C3  one line: Cover and Concealment, then the mode's need and where better is
 *   icons    C4  a shield (cover from direct fire) and an eye (concealment, the weaker of ground and air)
 *   nearest  C5  for each field: here, or the nearest Fair or better within the radius
 *   rose     C6  eight wedges round the position shaded by the best cover for the mode's need
 *   block    C7  everything: four lines, local density, bank, nearest, rose
 *
 * DOM nodes and `textContent` only (class labels and bank names never become markup). CSS injected once.
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { registerBriefSection } from './GroundGuideBrief';
import {
  COVER_FIELDS,
  COVER_FIELD_LABEL,
  COVER_KIND,
  COVER_WORD,
  coverText,
  shelterText,
  formText,
  builtText,
  type CoverField,
  type CoverLevel,
  type GroundGuideCover,
} from './GroundGuideCover';
import {
  ACCENT,
  ensureTokensCss,
  FONT,
  FS,
  FW,
  LETTER_FG,
  LETTER_FILL,
  LEVEL_COLOR as LEVEL_TONE,
  LEVEL_TEXT as LEVEL_TONE_TEXT,
  LINE,
  ROSE_C,
  ROSE_R,
  roseFrame,
  roseKey,
  SURFACE,
  TEXT,
  wedgePath,
} from './GroundGuideTokens';
import type { GroundGuideVerdict } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-cover-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** C's letter badge: neutral like every GROTBC letter (letters are not verdicts, 2026-11-08 review item 16). */
export const COVER_LETTER = LETTER_FILL;
/** The four levels on the ladder's colours (GroundGuideTokens LEVEL_COLOR): None grey, Poor orange, Fair yellow, Good green. */
export const LEVEL_COLOR: Record<CoverLevel, string> = { 0: LEVEL_TONE[0], 1: LEVEL_TONE[1], 2: LEVEL_TONE[2], 3: LEVEL_TONE[3] };
/** The same levels as words on the dark card. */
export const LEVEL_TEXT: Record<CoverLevel, string> = { 0: LEVEL_TONE_TEXT[0], 1: LEVEL_TONE_TEXT[1], 2: LEVEL_TONE_TEXT[2], 3: LEVEL_TONE_TEXT[3] };
const FIELD_SHORT: Record<CoverField, string> = { direct: 'Direct', indirect: 'Indirect', ground: 'Gr', aerial: 'Air' };

/**
 * Sizes and colours from GroundGuideTokens.ts (2026-11-08 visual review): five type steps, labels in TEXT.label, group
 * labels in sentence case over a hairline, no uppercase chips, no text cut with an ellipsis (two lines, then clamp).
 */
const CSS = `
.ms-gc-cap{display:flex;align-items:center;gap:6px}
.ms-gc-l{display:inline-flex;align-items:center;justify-content:center;flex:none;width:17px;height:17px;border-radius:4px;font:${FW.bold} ${FS.meta}px/1 ${FONT};color:${LETTER_FG};background:${COVER_LETTER}}
.ms-gc-tag{margin-left:auto;font:${FW.regular} ${FS.meta}px/1.2 ${FONT};color:${TEXT.label};text-transform:none;letter-spacing:0}
.ms-gc-k{font:${FW.semi} ${FS.body}px/1.25 ${FONT};color:${TEXT.main};margin:6px 0 4px;padding-bottom:2px;border-bottom:1px solid ${LINE.hair}}
.ms-gc-k:first-of-type{margin-top:0}
.ms-gc-row{display:grid;grid-template-columns:82px 46px minmax(0,1fr);gap:6px;align-items:center;font-size:${FS.meta}px;line-height:1.3}
.ms-gc-row+.ms-gc-row{margin-top:3px}
.ms-gc-row>.ms-gc-f{color:${TEXT.label};white-space:nowrap}
.ms-gc-row.ms-need>.ms-gc-f{color:${TEXT.strong};font-weight:${FW.semi}}
.ms-gc-row.ms-need>.ms-gc-f::after{content:"";display:inline-block;width:6px;height:6px;margin:0 0 1px 6px;background:${ACCENT};transform:rotate(45deg)}
.ms-gc-row>.ms-gc-w{min-width:0;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
.ms-gc-row>.ms-gc-w>b{font-weight:${FW.semi}}
.ms-gc-row>.ms-gc-w>span{color:${TEXT.label}}
.ms-gc-m{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}
.ms-gc-m>i{display:block;height:7px;border-radius:1.5px;background:#3a434e}
.ms-gc-soft{color:${TEXT.soft};font-size:${FS.meta}px;line-height:1.35;margin-top:5px}
.ms-gc-soft b{color:${TEXT.main};font-weight:${FW.semi}}
.ms-gc-dep{margin-left:6px;font-weight:${FW.semi};color:${ACCENT}}
.ms-gc-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 6px}
.ms-gc-grid>.ms-gc-k{margin:0}
.ms-gc-tile{border-radius:6px;padding:5px 7px;background:${SURFACE.raised};border:1px solid ${LINE.soft};min-width:0}
.ms-gc-tile small{display:block;font-size:${FS.meta}px;line-height:1.25;color:${TEXT.label}}
.ms-gc-tile b{display:block;font-size:${FS.body}px;font-weight:${FW.bold};color:${TEXT.strong};line-height:1.25}
.ms-gc-tile.ms-need{border-color:${ACCENT}}
.ms-gc-sum{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;font-size:${FS.body}px;color:${TEXT.label}}
.ms-gc-sum b{font-weight:${FW.bold}}
.ms-gc-ico{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ms-gc-ico>div{display:flex;gap:7px;align-items:center;min-width:0}
.ms-gc-ico>div>svg{flex:none}
.ms-gc-ico small{display:block;font-size:${FS.meta}px;line-height:1.25;color:${TEXT.label}}
.ms-gc-ico b{display:block;font-size:${FS.body}px;font-weight:${FW.bold}}
.ms-gc-near{display:grid;grid-template-columns:82px minmax(0,1fr);gap:3px 6px;font-size:${FS.meta}px;line-height:1.3}
.ms-gc-near>span:nth-child(odd){color:${TEXT.label};white-space:nowrap}
.ms-gc-near>span.ms-need{color:${TEXT.strong};font-weight:${FW.semi}}
.ms-gc-near>span:nth-child(even){min-width:0;color:${TEXT.main};overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
.ms-gc-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:0}
.ms-gc-rose{display:flex;gap:10px;align-items:center}
.ms-gc-rose>svg,.ms-gc-rose>figure{flex:none}
.ms-gc-rose>div{min-width:0;font-size:${FS.meta}px;line-height:1.35;color:${TEXT.label}}
.ms-gc-rose b{font-weight:${FW.bold}}
.ms-gc-fig{margin:0;flex:none;width:132px;display:flex;flex-direction:column;align-items:center}
.ms-gc-fig>.ms-gg-rkey{margin-top:2px;max-width:132px}
.ms-gc-key i{border-radius:2px}
`;

export function ensureCoverCss(): void {
  ensureTokensCss();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A level's word ("Good", "Poor") in bold, in its colour on the dark card. */
function levelWord(level: CoverLevel): HTMLElement {
  const b = el('b', undefined, COVER_WORD[level]);
  b.style.color = LEVEL_TEXT[level];
  return b;
}

function section(caption: string, ...content: Array<Node | null>): HTMLElement {
  const sec = el('div', 'ms-ggb-sec');
  const cap = el('div', 'ms-ggb-cap ms-gc-cap');
  cap.append(el('span', 'ms-gc-l', 'C'), caption, el('span', 'ms-gc-tag', 'Proposal'));
  cap.lastElementChild!.setAttribute('title', 'Levels from the ground class: a starting proposal for the rule owner to correct');
  sec.append(cap, ...content.filter((c): c is Node => c !== null));
  return sec;
}

function meter(level: CoverLevel): HTMLElement {
  const m = el('div', 'ms-gc-m');
  m.setAttribute('aria-hidden', 'true');
  for (let k = 1; k <= 3; k++) {
    const i = el('i');
    if (k <= level) i.style.background = LEVEL_COLOR[level];
    m.append(i);
  }
  return m;
}

function wordFrom(c: GroundGuideCover, f: CoverField): HTMLElement {
  const w = el('div', 'ms-gc-w');
  w.append(levelWord(c.levels[f]));
  const from = c.from[f];
  if (from) w.append(el('span', undefined, ` · ${from}`));
  return w;
}

function nearText(c: GroundGuideCover, f: CoverField): string | null {
  const n = c.nearest[f];
  return n ? `${COVER_WORD[n.level]} ${fmtDistance(n.distanceM)} ${n.compass} (${n.label})` : null;
}

/** "Mode needs Ground Obs: Poor · Fair 120 m E (Bund)" — only when the mode's need is short here. */
export function needLine(c: GroundGuideCover, profileLabel: string): HTMLElement | null {
  const f = c.focus;
  if (!f || c.levels[f] >= 2) return null;
  const line = el('div', 'ms-gc-soft');
  line.append(`${profileLabel} needs ${COVER_FIELD_LABEL[f]}: `, levelWord(c.levels[f]));
  const n = nearText(c, f);
  line.append(n ? ` · ${n}` : ` · none Fair or better within ${fmtDistance(c.radiusM)}`);
  return line;
}

export function bankLine(c: GroundGuideCover): HTMLElement | null {
  if (!c.bank) return null;
  const line = el('div', 'ms-gc-soft');
  line.append(el('b', undefined, c.bank.label), ` within ${fmtDistance(c.bank.withinM)}`);
  if (c.bank.deploy) line.append(el('span', 'ms-gc-dep', 'Deployment line'));
  return line;
}

export function localLine(c: GroundGuideCover): HTMLElement | null {
  if (!c.local) return null;
  const line = el('div', 'ms-gc-soft');
  line.append('Area round it: cover ', levelWord(c.local.cover), ', concealment ', levelWord(c.local.concealment));
  line.title = 'The cover density of the area round it, not this spot. It never raises the levels above.';
  return line;
}

/**
 * The area conceals better than the spot (a road through trees): say where, and on a road, track or railway that a
 * canopy may screen it from the air but the data cannot tell. The levels themselves are never raised (GroundGuideCover.ts).
 * When the mode's need line already names the nearest concealment, only the canopy caveat is added.
 */
export function aroundLine(c: GroundGuideCover): HTMLElement | null {
  const a = c.around;
  if (!a) return null;
  const needSaid = !!c.focus && (c.focus === 'ground' || c.focus === 'aerial') && c.levels[c.focus] < 2;
  const line = el('div', 'ms-gc-soft');
  if (!needSaid) {
    line.append('Concealed round it, not on this spot: ');
    const n = a.nearest;
    if (n) line.append(el('b', undefined, `${COVER_WORD[n.level]} ${fmtDistance(n.distanceM)} ${n.compass}`), ` (${n.label})`);
    else line.append(levelWord(a.concealment), ' in the area');
    if (a.clearedLine) line.append('. ');
  }
  if (a.clearedLine) line.append('A canopy over the road may screen it from the air: check on the ground.');
  return line.childNodes.length ? line : null;
}

export function fourLines(c: GroundGuideCover): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const kind of ['Cover', 'Concealment'] as const) {
    out.push(el('div', 'ms-gc-k', kind));
    for (const f of COVER_FIELDS.filter((x) => COVER_KIND[x] === kind)) {
      const row = el('div', `ms-gc-row${c.focus === f ? ' ms-need' : ''}`);
      row.append(el('span', 'ms-gc-f', COVER_FIELD_LABEL[f]), meter(c.levels[f]), wordFrom(c, f));
      out.push(row);
    }
  }
  return out;
}

// ── C1 lines ──────────────────────────────────────────────────────────────
function styleLines(v: GroundGuideVerdict, c: GroundGuideCover): HTMLElement {
  return section('Cover & Concealment', ...fourLines(c), needLine(c, v.profileLabel), aroundLine(c), bankLine(c));
}

// ── C2 grid ───────────────────────────────────────────────────────────────
/** The four levels as shaded tiles: Cover (direct, indirect) beside Concealment (ground, aerial). */
export function coverGridTiles(c: GroundGuideCover): HTMLElement {
  const g = el('div', 'ms-gc-grid');
  g.append(el('div', 'ms-gc-k', 'Cover'), el('div', 'ms-gc-k', 'Concealment'));
  for (const pair of [['direct', 'ground'], ['indirect', 'aerial']] as const) {
    for (const f of pair) {
      const lv = c.levels[f];
      const t = el('div', `ms-gc-tile${c.focus === f ? ' ms-need' : ''}`);
      t.style.background = lv ? `${LEVEL_COLOR[lv]}33` : '';
      t.append(el('small', undefined, `From ${COVER_FIELD_LABEL[f]}`), levelWord(lv));
      g.append(t);
    }
  }
  return g;
}

/** What the ground gives, in one line ("From Tree cover · Bund"), for under the tiles. */
export function coverGivesLine(c: GroundGuideCover): HTMLElement {
  const gives = [...new Set(COVER_FIELDS.map((f) => c.from[f]).filter((x): x is string => !!x))];
  return el('div', 'ms-gc-soft', gives.length ? `From ${gives.join(' · ')}` : `${c.classLabel ?? 'This Gr'} gives none`);
}

function styleGrid(v: GroundGuideVerdict, c: GroundGuideCover): HTMLElement {
  const g = coverGridTiles(c);
  const gives = [...new Set(COVER_FIELDS.map((f) => c.from[f]).filter((x): x is string => !!x))];
  return section(
    'Cover & Concealment',
    g,
    el('div', 'ms-gc-soft', gives.length ? `From ${gives.join(' · ')}` : `${c.classLabel ?? 'This Gr'} gives none`),
    needLine(c, v.profileLabel),
    aroundLine(c),
  );
}

// ── C3 summary ────────────────────────────────────────────────────────────
function styleSummary(v: GroundGuideVerdict, c: GroundGuideCover): HTMLElement {
  const conceal = Math.min(c.levels.ground, c.levels.aerial) as CoverLevel;
  const s = el('div', 'ms-gc-sum');
  const a = el('span');
  a.append('Cover ', levelWord(c.levels.direct));
  const b = el('span');
  b.append('Concealment ', levelWord(conceal));
  s.append(a, b);
  const from = c.from.direct ?? c.from.ground ?? c.from.aerial;
  return section('Cover & Concealment', s, from ? el('div', 'ms-gc-soft', `From ${from}`) : null, needLine(c, v.profileLabel), aroundLine(c));
}

// ── C4 icons ──────────────────────────────────────────────────────────────
function shield(level: CoverLevel): SVGElement {
  const sv = svg('svg', { width: 26, height: 30, viewBox: '0 0 26 30', 'aria-hidden': 'true' });
  const path = 'M13 2 L23 6 V14 C23 21 18 26 13 28 C8 26 3 21 3 14 V6 Z';
  const id = `gcs${Math.random().toString(36).slice(2, 8)}`;
  const clip = svg('clipPath', { id });
  clip.append(svg('rect', { x: 0, y: 30 - (30 * level) / 3, width: 26, height: 30 }));
  const defs = svg('defs', {});
  defs.append(clip);
  sv.append(defs, svg('path', { d: path, fill: LEVEL_COLOR[level], 'clip-path': `url(#${id})` }), svg('path', { d: path, fill: 'none', stroke: TEXT.label, 'stroke-width': 1.5 }));
  return sv;
}

function eye(level: CoverLevel): SVGElement {
  const sv = svg('svg', { width: 30, height: 30, viewBox: '0 0 30 30', 'aria-hidden': 'true' });
  sv.append(
    svg('path', { d: 'M2 15 C7 7 23 7 28 15 C23 23 7 23 2 15 Z', fill: 'none', stroke: TEXT.label, 'stroke-width': 1.5 }),
    svg('circle', { cx: 15, cy: 15, r: 4.5, fill: TEXT.label, 'fill-opacity': 1 - level / 3.5 }),
  );
  // The more concealment, the more the eye is screened: one bar per level across it.
  for (let k = 0; k < level; k++) sv.append(svg('line', { x1: 6 + k * 7, y1: 25, x2: 12 + k * 7, y2: 5, stroke: LEVEL_COLOR[level], 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
  return sv;
}

/** A shield filled to the cover from direct fire and an eye screened to the weaker concealment. */
export function coverIconsRow(c: GroundGuideCover): HTMLElement {
  const conceal = Math.min(c.levels.ground, c.levels.aerial) as CoverLevel;
  const g = el('div', 'ms-gc-ico');
  const a = el('div');
  const at = el('div');
  at.append(el('small', undefined, 'Cover (Direct Fire)'), levelWord(c.levels.direct));
  a.append(shield(c.levels.direct), at);
  const b = el('div');
  const bt = el('div');
  bt.append(el('small', undefined, 'Concealment (Weaker)'), levelWord(conceal));
  b.append(eye(conceal), bt);
  g.append(a, b);
  return g;
}

function styleIcons(v: GroundGuideVerdict, c: GroundGuideCover): HTMLElement {
  const g = coverIconsRow(c);
  return section('Cover & Concealment', g, c.classLabel ? el('div', 'ms-gc-soft', `Gr: ${c.classLabel}`) : null, needLine(c, v.profileLabel), aroundLine(c));
}

// ── C5 nearest ────────────────────────────────────────────────────────────
export function nearestGrid(c: GroundGuideCover): HTMLElement {
  const g = el('div', 'ms-gc-near');
  for (const f of COVER_FIELDS) {
    g.append(el('span', c.focus === f ? 'ms-need' : undefined, COVER_FIELD_LABEL[f]));
    const val = el('span');
    const dot = el('span', 'ms-gc-dot');
    const lv = c.levels[f];
    const n = c.nearest[f];
    if (lv >= 2) {
      dot.style.background = LEVEL_COLOR[lv];
      val.append(dot, `${COVER_WORD[lv]} here`);
    } else if (n) {
      dot.style.background = LEVEL_COLOR[n.level];
      val.append(dot, `${COVER_WORD[n.level]} ${fmtDistance(n.distanceM)} ${n.compass} · ${n.label}`);
    } else {
      dot.style.background = LEVEL_COLOR[0];
      val.append(dot, `None within ${fmtDistance(c.radiusM)}`);
    }
    g.append(val);
  }
  return g;
}

function styleNearest(_v: GroundGuideVerdict, c: GroundGuideCover): HTMLElement {
  // The nearest grid already says where concealment is; only the canopy caveat is added.
  const canopy = c.around?.clearedLine ? el('div', 'ms-gc-soft', 'A canopy over the road may screen it from the air: check on the ground.') : null;
  return section(`Nearest Cover · ${fmtDistance(c.radiusM)}`, nearestGrid(c), canopy, bankLine(c));
}

// ── C6 rose ───────────────────────────────────────────────────────────────
/**
 * The C Cover rose in the shared frame (item 12): eight wedges in map bearings, longer where Fair-or-better cover is
 * closer (a sector with none keeps a grey stub), coloured by the best level found; the hub is the level at the spot.
 * The group turns with the map (`data-gv-rose`). Drawn at ROSE_PX on screen: `size` is kept for the callers but no
 * longer used.
 */
export function coverRose(c: GroundGuideCover, size: number, northDeg: number): SVGElement {
  void size;
  const r0 = 10;
  const R = ROSE_R;
  const f = roseFrame(`Cover from ${COVER_FIELD_LABEL[c.roseField]} round the position, to ${fmtDistance(c.radiusM)}`);
  for (const x of c.sectors) {
    // Long wedge = cover close by; a sector with none keeps a stub.
    const reach = x.nearM === null ? 0.12 : 1 - Math.min(0.85, x.nearM / c.radiusM);
    const r = r0 + (R - r0) * reach;
    const w = f.add('path', { d: wedgePath(r0, r, x.bearingDeg - 20.5, x.bearingDeg + 20.5), fill: LEVEL_COLOR[x.level], stroke: SURFACE.ring, 'stroke-width': 0.8 });
    const tip = svg('title', {});
    tip.textContent = x.nearM === null ? `${x.compass}: none Fair or better within ${fmtDistance(c.radiusM)}` : `${x.compass}: ${COVER_WORD[x.level]} ${fmtDistance(x.nearM)}`;
    w.append(tip);
  }
  // The hub: the level at the spot itself.
  f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: r0 - 2, fill: LEVEL_COLOR[c.levels[c.roseField]], stroke: '#c9d1d9', 'stroke-width': 1.5 });
  const n = Math.round((northDeg || 0) * 10) / 10;
  if (n) {
    // Turned to the map's north now (attributes only); the card's north pass turns it again later.
    f.g.setAttribute('transform', `rotate(${n} ${ROSE_C} ${ROSE_C})`);
    f.g.querySelectorAll('[data-gv-upright]').forEach((u) => {
      const [x, y] = (u.getAttribute('data-gv-upright') ?? '0 0').split(/\s+/);
      u.setAttribute('transform', `rotate(${-n} ${x} ${y ?? x})`);
    });
  }
  return f.svg;
}

/** The C rose with its key under it, as one figure (item 12). */
export function coverRoseFigure(c: GroundGuideCover, northDeg: number): HTMLElement {
  const fig = el('figure', 'ms-gc-fig');
  fig.append(coverRose(c, 0, northDeg), coverRoseKey());
  return fig;
}

export function roseText(c: GroundGuideCover): HTMLElement {
  const t = el('div');
  const f = c.roseField;
  t.append(el('div', 'ms-gc-soft', `From ${COVER_FIELD_LABEL[f]}, ${fmtDistance(c.radiusM)}`));
  t.firstElementChild!.setAttribute('style', 'margin-top:0');
  const here = el('div');
  here.append('Here ', levelWord(c.levels[f]));
  t.append(here);
  const best = [...c.sectors].filter((s) => s.nearM !== null).sort((a, b) => b.level - a.level || a.nearM! - b.nearM!)[0];
  if (best) {
    const b = el('div');
    b.append('Best ', levelWord(best.level), ` ${fmtDistance(best.nearM!)} ${best.compass}`);
    t.append(b);
  } else t.append(el('div', 'ms-gc-soft', 'None Fair or better round it'));
  // Sectors with nothing Fair or better (not "open": Open Dirs is the cross-country count on O and T).
  const bare = c.sectors.filter((s) => s.nearM === null).map((s) => s.compass);
  if (bare.length && bare.length < 8) t.append(el('div', 'ms-gc-soft', `No cover to the ${bare.join(', ')}`));
  return t;
}

/** The one-line key under the cover rose (item 12): "Longer = closer · Good · Fair · Poor" with the level swatches. */
export function coverRoseKey(): HTMLElement {
  const key = roseKey(([3, 2, 1] as const).map((lv): [string, string] => [LEVEL_COLOR[lv], COVER_WORD[lv]]));
  key.classList.add('ms-gc-key');
  key.prepend('Longer = closer · ');
  return key;
}

function styleRose(_v: GroundGuideVerdict, c: GroundGuideCover, northDeg: number): HTMLElement {
  const box = el('div', 'ms-gc-rose');
  box.append(coverRoseFigure(c, northDeg), roseText(c));
  return section(c.focus ? `Cover Round It · ${FIELD_SHORT[c.roseField]}` : 'Cover Round It', box);
}

// ── C7 block ──────────────────────────────────────────────────────────────
function styleBlock(v: GroundGuideVerdict, c: GroundGuideCover, northDeg: number): HTMLElement {
  const box = el('div', 'ms-gc-rose');
  box.style.marginTop = '7px';
  box.append(coverRoseFigure(c, northDeg), nearestGrid(c));
  return section('Cover, Camouflage & Concealment', ...fourLines(c), localLine(c), aroundLine(c), bankLine(c), box, needLine(c, v.profileLabel));
}

/** "Underground: Bunker 1.2 km NE · Trench 2.4 km N" (caves, bunkers, trenches, tunnels); null when none is mapped near. */
export function shelterLine(c: GroundGuideCover, always = false): HTMLElement | null {
  if (!c.shelters?.length && !always) return null;
  const text = shelterText(c, fmtDistance);
  if (!text) return null;
  const line = el('div', 'ms-gc-soft');
  line.append(el('b', undefined, 'Underground'), ` · ${text}`);
  line.title = 'Mapped caves, bunkers, trenches and road or railway tunnels. Points on the map: they do not change the levels above.';
  return line;
}

/** "Ground · Valley floor · depression 420 m N, 16 m deep": where dead ground may be; not in the four levels. */
export function formLine(c: GroundGuideCover): HTMLElement | null {
  const t = formText(c, fmtDistance);
  if (!t) return null;
  const line = el('div', 'ms-gc-soft');
  line.append(el('b', undefined, 'Gr'), ` · ${t}`);
  line.title = 'Landform at the point and the nearest closed depression (DEM). Dead ground to check on the ground; it does not change the levels above.';
  return line;
}

/** "Buildings · Medium (300-1,000 / km2) · 2 to 4 storeys": built-up cover at the point; not in the four levels. */
export function builtLine(c: GroundGuideCover): HTMLElement | null {
  if (!c.built) return null;
  const line = el('div', 'ms-gc-soft');
  line.append(el('b', undefined, 'Bldgs'), ` · ${builtText(c)}`);
  line.title = 'Building density and height at the point (Open Buildings + GHSL). The levels above come from the ground class only.';
  return line;
}

/** The C section for the card, or null when the verdict carries no C or the style is off. */
export function coverSection(v: GroundGuideVerdict, northDeg = 0): HTMLElement | null {
  const c = v.cover;
  if (!c || c.style === 'off' || v.verdict === 'unknown') return null;
  ensureCoverCss();
  let sec: HTMLElement;
  switch (c.style) {
    case 'grid': sec = styleGrid(v, c); break;
    case 'summary': sec = styleSummary(v, c); break;
    case 'icons': sec = styleIcons(v, c); break;
    case 'nearest': sec = styleNearest(v, c); break;
    case 'rose': sec = styleRose(v, c, northDeg); break;
    case 'block': sec = styleBlock(v, c, northDeg); break;
    default: sec = styleLines(v, c);
  }
  // Every style: the mapped underground and enclosed cover nearby, when there is any.
  const sh = shelterLine(c);
  if (sh) sec.append(sh);
  // Every style: the lie of the ground and the buildings at the point (added 2026-11-06).
  for (const x of [formLine(c), builtLine(c)]) if (x) sec.append(x);
  return sec;
}

// The Ground Brief (G): C in full, whatever the card style.
registerBriefSection({
  id: 'cover',
  letter: 'C',
  order: 10,
  title: 'Cover, Camouflage & Concealment',
  render: (v) => {
    const c = v.cover;
    if (!c) return null;
    ensureCoverCss();
    const wrap = el('div');
    const box = el('div', 'ms-gc-rose');
    box.style.marginTop = '8px';
    box.append(coverRoseFigure(c, 0), nearestGrid(c));
    wrap.append(
      ...fourLines(c),
      localLine(c) ?? el('span'),
      aroundLine(c) ?? el('span'),
      bankLine(c) ?? el('span'),
      shelterLine(c, true) ?? el('span'),
      formLine(c) ?? el('span'),
      builtLine(c) ?? el('span'),
      box,
      el('div', 'ms-gc-soft', 'Levels: this spot, from the ground class and river or canal banks (a starting proposal). Area round it: the cover density of the area round it, which never raises them. Check on the ground.'),
    );
    return wrap;
  },
  text: (v) => (v.cover ? coverText(v.cover, fmtDistance) : []),
});
