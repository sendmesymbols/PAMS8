/**
 * GroundGuideBadge.ts
 *
 * The small cursor-following card the Ground Guide shows while drawing.
 * A coloured header gives the verdict (and an S keycap when the quick fix can
 * help); label-left rows underneath say why (led by the GO / SLOW-GO / NO-GO
 * scale), how much is inside, what is nearest and whether the echelon's inter
 * gap rule holds. The full card (`card.cursor: full`) adds the stacked GROTBC
 * sections after them. Enforce mode closes the card with a red strip.
 * The unit type and the P / S keys live in the legend. Built from DOM nodes and
 * `textContent` only, so class names and unit labels can never inject markup.
 *
 * Position updates are direct style writes from a passive pointermove listener.
 * The card's size is measured once per show(), so following the cursor costs no
 * layout reads and the card can flip to stay on screen.
 */

import { monthName } from './GroundGuideBrief';
import { COVER_FIELD_LABEL, COVER_KIND, COVER_WORD } from './GroundGuideCover';
import { fmtDistance, titleCase } from './GroundGuideEvaluator';
import { GOING_WORD } from './GroundGuideGoing';
import { detailCue, goingSections, seasonIcon } from './GroundGuideGoingView';
import { modeIcon } from './GroundGuideLegend';
import { arrowCompass, compassBearing, dial, dirArrow, orientNorth, whereNode } from './GroundGuideNorth';
import { ensurePopulationCss, populationFlagPill, populationFlagStrip, populationSection, populationSpoken } from './GroundGuidePopulationView';
import { decorateTraffic, trafficCard } from './GroundGuideTrafficView';
import { decorateSpeed } from './GroundGuideSpeedView';
import { coverSection } from './GroundGuideCoverView';
import { sectionsCard } from './GroundGuideSectionsView';
import { itgTraitLines } from './GroundGuideFeatures';
import { DEFAULT_GROUND_GUIDE_OPTIONS, type GroundGuideCardOptions, type GroundGuideVerdict } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-badge-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const EDGE = 8;
/** How long the cursor must rest on a verdict before it is read out to a screen reader. */
const SPEAK_DELAY_MS = 500;
/** Gap between a fingertip and the card above it. */
const TOUCH_GAP = 28;

/*
 * Layout (2026-11-07, user: "keep all five, just cleaner", a bit bigger text for laptops in daylight): the verdict
 * bar, then the items as label-left rows (Inside, Nearest, Inter Gap Rule) split by hairlines, so the eye runs down
 * one column of labels instead of reading a stacked caption above each item. Why has no label (the user, same day:
 * the going scale says what it is) and takes the card's whole width, straight under the verdict. Nearest keeps its
 * compass under its label. Sections from the full card (`card.cursor: full`) keep their stacked bands.
 */
const CSS = `
.ms-ground-guide-badge{position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;
  --pb-c:#5b6470;--pb-fg:#fff;--pb-k:#aab3bd;width:320px;max-width:calc(100vw - 8px);box-sizing:border-box;border-radius:11px;overflow:hidden;
  font:400 13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;
  background:#1b1f25;border:1.5px solid var(--pb-c);box-shadow:0 6px 18px rgba(0,0,0,.42);display:none}
.ms-ground-guide-badge[data-verdict="ok"]{--pb-c:#1c8247;--pb-k:#3fc07a}
.ms-ground-guide-badge[data-verdict="near"]{--pb-c:#e9a526;--pb-fg:#1b1f25;--pb-k:#f2b84b}
.ms-ground-guide-badge[data-verdict="caution"]{--pb-c:#e08a1e;--pb-fg:#1b1f25;--pb-k:#f0a04b}
.ms-ground-guide-badge[data-verdict="partial"]{--pb-c:#d9622b;--pb-fg:#1b1f25;--pb-k:#ef7d4a}
.ms-ground-guide-badge[data-verdict="in"]{--pb-c:#d63a3f;--pb-k:#ff6b6f}
.ms-ggb-bar{display:flex;flex-wrap:wrap;align-items:center;gap:5px 8px;padding:8px 12px;background:var(--pb-c);color:var(--pb-fg);font-weight:650;font-size:14.5px;line-height:1.25}
.ms-ggb-bar>svg{flex:none}
.ms-ggb-title{flex:1 1 0;min-width:0}
.ms-ggb-pills{display:flex;gap:4px;margin-left:auto}
.ms-ggb-pct,.ms-ggb-fix{display:flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.2);font-size:12px;font-weight:600;white-space:nowrap}
.ms-ggb-fix{padding-left:3px}
.ms-ground-guide-badge[data-verdict="near"] .ms-ggb-pills>span,.ms-ground-guide-badge[data-verdict="caution"] .ms-ggb-pills>span,.ms-ground-guide-badge[data-verdict="partial"] .ms-ggb-pills>span{background:rgba(0,0,0,.12)}
.ms-ggb-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:4px;
  font:700 11px/1 ui-monospace,Consolas,monospace;color:#fff;background:linear-gradient(#3f8f5b,#2b6b42);border:1px solid #5fc183;border-bottom-width:2px}
.ms-ggb-sr{position:fixed;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.ms-ggb-body{padding:7px 12px 9px}
.ms-ggb-sec{padding:8px 12px 9px}
.ms-ggb-sec:nth-child(even){background:#222830}
.ms-ggb-cap{font:700 10.5px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--pb-k);margin-bottom:6px}
.ms-ggb-row{display:grid;grid-template-columns:86px minmax(0,1fr);column-gap:10px;row-gap:5px;align-items:start;padding:9px 12px 10px;border-top:1px solid rgba(255,255,255,.08)}
.ms-ggb-row:first-child{border-top:0}
.ms-ggb-note{padding:8px 12px;border-top:1px solid rgba(255,255,255,.08)}
.ms-ggb-for{flex:1 1 100%;display:flex;align-items:center;gap:6px;min-width:0;font:600 12.5px/1.3 system-ui,Segoe UI,Arial,sans-serif}
.ms-ggb-for>svg{flex:none}
.ms-ggb-who{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-ggb-hand{flex:none;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.32);color:#fff;font:700 10px/1.2 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase}
.ms-ggb-when{flex:none;margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-weight:500;opacity:.88}
.ms-ggb-other{padding:7px 12px;background:rgba(242,184,75,.13);border-bottom:1px solid rgba(242,184,75,.35);color:#ffd27a;font-size:12.5px}
.ms-ggb-facts{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid rgba(255,255,255,.08)}
.ms-ggb-fact{min-width:0;padding:8px 12px 9px}
.ms-ggb-fact+.ms-ggb-fact{border-left:1px solid rgba(255,255,255,.08)}
.ms-ggb-fk{font-size:11.5px;line-height:1.3;color:#a9b2bc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggb-fv{margin-top:2px;font:700 13.5px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggb-fd{display:inline-block;width:9px;height:9px;margin-right:6px;border-radius:50%;vertical-align:0}
.ms-ggb-fd[data-tone="go"],.ms-ggb-fd[data-tone="c3"]{background:#2fa862}
.ms-ggb-fd[data-tone="slow"],.ms-ggb-fd[data-tone="c1"]{background:#f0932b}
.ms-ggb-fd[data-tone="nogo"]{background:#e5484d}
.ms-ggb-fd[data-tone="c2"]{background:#9cc45a}
.ms-ggb-fd[data-tone="c0"]{background:#5b6470;box-shadow:inset 0 0 0 1.5px #9aa3ad}
.ms-ggb-fv[data-tone="go"],.ms-ggb-fv[data-tone="c3"]{color:#74dca3}
.ms-ggb-fv[data-tone="slow"],.ms-ggb-fv[data-tone="c1"]{color:#ffb46b}
.ms-ggb-fv[data-tone="nogo"]{color:#ff8a8d}
.ms-ggb-fv[data-tone="c2"]{color:#c3df8f}
.ms-ggb-row>.ms-ggb-cap{grid-column:1;grid-row:1;margin:0;padding-top:2px;font:600 12px/1.3 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:0;text-transform:none;color:#a9b2bc}
.ms-ggb-row>:not(.ms-ggb-cap){grid-column:2;min-width:0}
.ms-ggb-row.ms-ggb-wide{grid-template-columns:minmax(0,1fr)}
.ms-ggb-row.ms-ggb-wide>:not(.ms-ggb-cap){grid-column:1}
.ms-ggb-wide>.ms-ggb-b{font-size:14px}
.ms-ggb-row.ms-ggb-nrow{grid-template-columns:62px minmax(0,1fr);grid-template-rows:auto 1fr}
.ms-ggb-nrow>.ms-ggb-side{grid-column:1;grid-row:2;align-self:start;line-height:0}
.ms-ggb-nrow>.ms-ggb-nlist{grid-column:2;grid-row:1 / span 2}
.ms-ggb-ni+.ms-ggb-ni{margin-top:7px}
.ms-ggb-nh{display:flex;align-items:baseline;gap:6px;min-width:0}
.ms-ggb-nd{flex:none;align-self:center;width:9px;height:9px;border-radius:50%}
.ms-ggb-nn{flex:1 1 auto;min-width:0;font-weight:600;color:#fff;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.ms-ggb-nf{flex:none;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
.ms-ggb-ni:first-child .ms-ggb-nf{font-size:14px}
.ms-ggb-nw{padding-left:15px;font-size:11.5px;line-height:1.3;color:#a9b2bc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggb-nw[data-tone="nogo"]{color:#ff8a8d}
.ms-ggb-nw[data-tone="slow"]{color:#ffb46b}
.ms-ggb-row>.ms-ggb-scale,.ms-ggb-row>.ms-ggb-track{margin:0}
.ms-ggb-row>.ms-ggb-scale{margin-bottom:2px}
.ms-ggb-row .ms-ggb-soft{padding-top:0}
.ms-ggb-b{font-weight:600;color:#fff}
.ms-ggb-dim{color:#a9b2bc}
.ms-ggb-scale{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:6px}
.ms-ggb-scale>span{font:700 11px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.03em;text-align:center;padding:5px 0 4px;border-radius:3px;background:rgba(255,255,255,.06);color:#7f8893}
.ms-ggb-scale>.ms-on-go{background:#2fa862;color:#fff}
.ms-ggb-scale>.ms-on-slow{background:#f0932b;color:#1b1f25}
.ms-ggb-scale>.ms-on-nogo{background:#e5484d;color:#fff}
.ms-ggb-nr{display:flex;gap:10px;align-items:center}
.ms-ggb-nr>svg{flex:none}
.ms-ggb-big{font-size:19px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;line-height:1.15}
.ms-ggb-track{height:6px;margin:4px 0 2px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden}
.ms-ggb-track>div{height:100%}
.ms-ggb-enf{display:flex;gap:8px;align-items:flex-start;padding:8px 12px;background:rgba(229,72,77,.14);border-top:1px solid rgba(229,72,77,.45);color:#ffb3b5}
.ms-ggb-enf>svg{flex:none;margin-top:2px;color:#e5484d}
.ms-ggb-warn{color:#ffc861}
.ms-ggb-soft{color:#a3acb6;font-size:12px;padding-top:2px}
.ms-ggb-itg+.ms-ggb-itg{margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}
.ms-ggb-itgt{font-size:11.5px;line-height:1.35;margin-top:2px}
.ms-ggb-strong{color:#f2b84b;font-weight:600}
.ms-ground-guide-badge .ms-gv-foot{padding:7px 12px;font-size:12px;color:#a3acb6}
.ms-ground-guide-badge .ms-gv-foot-l{opacity:.8;gap:3px}
.ms-ground-guide-badge .ms-gv-foot-l>.ms-gv-kbd{min-width:16px;height:16px;font-size:9.5px}
`;

const ICONS: Record<string, string[]> = {
  check: ['M5 12l5 5L20 7'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  triangle: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.9 18.4a1.9 1.9 0 0 0 1.7 2.8h16.8a1.9 1.9 0 0 0 1.7-2.8L13.7 3.9a1.9 1.9 0 0 0-3.4 0z'],
  octagon: ['M12 8v4', 'M12 16h.01', 'M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z'],
  help: ['M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'],
};

const SPACING_COLOR = { ok: '#2fa862', tight: '#ee7b30', overlap: '#e5484d' } as const;

/** Where a verdict sits on the GO / SLOW-GO / NO-GO scale. */
const GOING: Partial<Record<GroundGuideVerdict['verdict'], 'go' | 'slow' | 'nogo'>> = {
  ok: 'go',
  caution: 'slow',
  near: 'nogo',
  partial: 'nogo',
  in: 'nogo',
};

/** Rule labels read ">30°" and "15–30°"; say them in words, with no symbols or dashes. */
function plain(label: string): string {
  return label.replace(/>\s*(\d)/g, 'over $1').replace(/(\d+)\s*[–-]\s*(\d+)/g, '$1 to $2');
}

/** `plain()` for other Ground Guide UI (the legend's terrain lists), so a class reads the same everywhere. */
export const plainLabel = plain;

function icon(name: string, size = 15, color?: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (color) svg.style.color = color;
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function track(fraction: number, color: string): HTMLElement {
  const t = el('div', 'ms-ggb-track');
  const f = el('div');
  f.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  f.style.background = color;
  t.appendChild(f);
  return t;
}

/** One band of the card: a caption in the verdict colour over its content. */
function section(caption: string, ...content: Array<Node | string>): HTMLElement {
  const s = el('div', 'ms-ggb-sec');
  s.append(el('div', 'ms-ggb-cap', caption), ...content);
  return s;
}

/**
 * One of the cursor card's five items: its label in a left column, the content beside it (every child after the
 * label goes to the right column, so a section that adds to Why, such as T's second scale, lines up too). The label
 * is `.ms-ggb-cap`, as on a stacked section, so the T and Speed decorators still find Why.
 */
function row(caption: string, ...content: Array<Node | string>): HTMLElement {
  const r = el('div', 'ms-ggb-row');
  r.append(el('div', 'ms-ggb-cap', caption));
  for (const c of content) r.append(typeof c === 'string' ? el('div', undefined, c) : c);
  return r;
}

/** GO / SLOW-GO / NO-GO with the verdict's own step lit. */
function goingScale(step: 'go' | 'slow' | 'nogo'): HTMLElement {
  const s = el('div', 'ms-ggb-scale');
  for (const [k, text] of [['go', 'GO'], ['slow', 'SLOW-GO'], ['nogo', 'NO-GO']] as const) {
    s.appendChild(el('span', k === step ? `ms-on-${k}` : undefined, text));
  }
  return s;
}

/** A keyboard key as drawn on the card. */
function keycap(key: string): HTMLElement {
  return el('span', 'ms-ggb-kbd', key);
}

/** A class label as a noun for a sentence: "Steep slope (>30°)" becomes "steep slope". */
function feature(label: string | null | undefined): string {
  const s = plain(label ?? '').replace(/\s*\([^)]*\)/g, '').trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : 'NO-GO ground';
}

/** `feature()` in Title Case for a headline: "Steep slope (>30°)" becomes "Steep Slope". */
function featureTitle(label: string | null | undefined): string {
  return titleCase(feature(label));
}

export function titleOf(v: GroundGuideVerdict): string {
  switch (v.verdict) {
    case 'ok': return 'Suitable Position';
    case 'near': {
      // Name the ground itself: touching the shape's own class, otherwise the nearest ground the unit can't use.
      const thing = featureTitle(v.fraction > 0 ? v.className : v.nearest?.className);
      return v.fraction > 0 ? `Encroaching on ${thing}` : `Adjacent to ${thing}`;
    }
    case 'caution': return 'SLOW-GO Terrain';
    case 'partial': return 'Partially Obstructed';
    case 'in': return 'Unsuitable Position';
    default: return v.message;
  }
}

function iconOf(v: GroundGuideVerdict): string {
  switch (v.verdict) {
    case 'ok': return 'check';
    case 'near':
    case 'caution': return 'triangle';
    case 'partial': return 'octagon';
    case 'in': return 'x';
    default: return 'help';
  }
}

/** The card as one short sentence for a screen reader: the verdict, why, and the keys that can change it. */
function spokenFor(v: GroundGuideVerdict): string {
  const parts = [titleOf(v)];
  if (v.verdict !== 'unknown' && v.verdict !== 'ok' && v.message) parts.push(v.message);
  if (v.snappable) parts.push('Press S to move it to the nearest usable ground');
  if (v.blocked) parts.push(v.overridable ? 'A click here is refused. Hold Shift and click to place it anyway' : 'A click here is refused');
  return parts.map((p) => p.replace(/[.\s]+$/, '')).join('. ') + '.';
}

/** Why: the ground that decides the verdict, for which unit type, and where that sits on the going scale. */
function whySection(v: GroundGuideVerdict): HTMLElement | null {
  const step = GOING[v.verdict];
  if (!step) return null;
  let name: string;
  switch (v.verdict) {
    case 'ok':
      name = v.className ? plain(v.className) : 'Suitable Ground';
      break;
    case 'caution':
      name = v.className ? plain(v.className) : 'SLOW-GO Terrain';
      break;
    case 'near':
      // Touching: the shape's own class. Otherwise the nearest ground the unit can't use.
      name = plain(v.fraction > 0 ? (v.className ?? '') : (v.nearest?.className ?? v.className ?? '')) || 'NO-GO Ground Nearby';
      break;
    default:
      name = v.className ? plain(v.className) : 'NO-GO Ground';
  }
  // The scale first, straight under the verdict bar: GO / SLOW-GO / NO-GO is what the eye takes in at a glance.
  // The mode is named once, under the verdict (forLine), so the ground's name stands alone here. No "Why" label: the
  // scale says what the row is, and the row gets the card's whole width (user, 2026-11-07). `data-gg-why` lets the
  // T decorators of the full card find it.
  const s = el('div', 'ms-ggb-row ms-ggb-wide');
  s.dataset.ggWhy = '';
  s.append(goingScale(step), el('div', 'ms-ggb-b', titleCase(name)));
  if (v.reason) s.append(el('div', 'ms-ggb-soft', v.reason)); // the rule owner's own words, when the bundle gives them
  return s;
}

function insideSection(v: GroundGuideVerdict, pct: number): HTMLElement {
  const line = el('div');
  line.append(el('span', 'ms-ggb-b', `${pct}%`), ` of the ${v.footprint ? 'Footprint' : 'Shape'}`);
  return row('Inside', line, track(pct / 100, verdictColor(v)));
}

/**
 * Who the ground is judged for, as the second line of the verdict bar (user, 2026-11-07: "nothing showing which force
 * type data is being used ... he can make wrong decisions"): the mode's icon and name with the echelon, a SET BY HAND
 * tag when P chose it rather than the symbol, and the season and light the going and speed are read for.
 */
function forLine(v: GroundGuideVerdict): HTMLElement {
  const line = el('div', 'ms-ggb-for');
  const ic = modeIcon(v.profile);
  ic.setAttribute('width', '16');
  ic.setAttribute('height', '16');
  const echelon = v.footprint?.echelon;
  line.append(ic, el('span', 'ms-ggb-who', echelon ? `${v.profileLabel} · ${titleCase(echelon)}` : v.profileLabel));
  if (v.profileOverride) {
    const hand = el('span', 'ms-ggb-hand', 'Set by Hand');
    hand.title = 'Chosen with P, not taken from the symbol';
    line.append(hand);
  }
  const g = v.going;
  const when: string[] = [];
  if (g) when.push(`${g.season === 'wet' ? 'After Rain' : 'Dry'}${g.month ? `, ${monthName(g.month)}` : ''}`);
  if (v.speed) when.push(v.speed.light === 'night' ? 'Night' : 'Day');
  if (when.length) {
    const w = el('span', 'ms-ggb-when');
    if (g) w.append(seasonIcon(g.season, 12));
    w.append(when.join(' · '));
    line.append(w);
  }
  return line;
}

/** One key fact: a small label over a word with its dot (the word says it without the colour). */
function keyFact(k: string, word: string, tone: string): HTMLElement {
  const f = el('div', 'ms-ggb-fact');
  const val = el('div', 'ms-ggb-fv');
  val.dataset.tone = tone;
  const dot = el('span', 'ms-ggb-fd');
  dot.dataset.tone = tone;
  val.append(dot, word);
  f.append(el('div', 'ms-ggb-fk', k), val);
  return f;
}

/**
 * The two facts the cursor card adds to its five (user, 2026-11-07): the going in the other season (rain can turn a
 * GO position SLOW-GO before the unit moves) and the cover or concealment the mode needs most. The full story of
 * both is in the Detail's T and C tabs.
 */
function keyFacts(v: GroundGuideVerdict): HTMLElement | null {
  const cells: HTMLElement[] = [];
  const g = v.going;
  const p = g?.point;
  if (g && p) {
    const wet = g.season === 'wet';
    const step = wet ? p.dry : p.wet;
    cells.push(keyFact(wet ? 'When Dry' : 'After Rain', GOING_WORD[step], step));
  }
  const c = v.cover;
  if (c) {
    const f = c.focus ?? c.roseField;
    cells.push(keyFact(`${COVER_KIND[f]} · ${COVER_FIELD_LABEL[f]}`, COVER_WORD[c.levels[f]], `c${c.levels[f]}`));
  }
  if (!cells.length) return null;
  const r = el('div', 'ms-ggb-facts');
  r.append(...cells);
  return r;
}

/** The map overlay paints another mode than the one judged: say so first, before the colours mislead. */
function overlayWarning(v: GroundGuideVerdict): HTMLElement | null {
  return v.overlayOther ? el('div', 'ms-ggb-other', `Map colours show ${v.overlayOther}, not ${v.profileLabel}`) : null;
}

/** Header colour, for the bar and arrow that echo it; keep in step with the CSS above. */
export function verdictColor(v: GroundGuideVerdict): string {
  switch (v.verdict) {
    case 'ok': return '#1c8247';
    case 'near': return '#e9a526';
    case 'caution': return '#e08a1e';
    case 'partial': return '#d9622b';
    case 'in': return '#d63a3f';
    default: return '#5b6470';
  }
}

function nearestSection(v: GroundGuideVerdict, northDeg: number): HTMLElement | null {
  const n = v.nearest;
  if (n) {
    // The dial points at the ground; the text names it and says how far.
    const text = el('div');
    const far = el('div');
    far.append(el('span', 'ms-ggb-big', fmtDistance(n.distanceM)), ` ${n.compass}`);
    text.append(el('div', 'ms-ggb-b', featureTitle(n.className)), far);
    const nr = el('div', 'ms-ggb-nr');
    nr.append(dial(n.bearingDeg, verdictColor(v), northDeg), text);
    return row('Nearest', nr);
  }
  const label = v.verdict === 'in' ? 'Suitable Ground' : 'NO-GO Ground';
  if (v.noneWithinM) return row('Nearest', el('div', 'ms-ggb-b', label), el('div', 'ms-ggb-soft', `Nothing within ${fmtDistance(v.noneWithinM)}`));
  if ((v.verdict === 'ok' || v.verdict === 'caution') && v.distanceM !== null) {
    const far = el('div');
    far.append(el('span', 'ms-ggb-big', fmtDistance(v.distanceM)), el('span', 'ms-ggb-dim', ' away'));
    return row('Nearest', el('div', 'ms-ggb-b', label), far);
  }
  return null;
}

type NearTone = 'nogo' | 'slow' | 'go' | 'road' | 'place' | 'cover' | 'itg' | 'other';

/** One thing round the point on the minimal card's Nearest. */
interface NearThing {
  /** What it is, by name ("Permanent Water", "N-5 · GT Road", "Dullewali"). */
  name: string;
  /** Why it matters, in a few words ("NO-GO Ground", "SLOW-GO · Natural Obstacle", "Village"). */
  what: string;
  distanceM: number;
  /** Null when only the distance is known (it then has no arrow and no mark on the compass). */
  compass: string | null;
  bearingDeg: number | null;
  tone: NearTone;
  /** Lower is more important. */
  rank: number;
  /** One of each kind is listed, so the three are three different things. */
  kind: 'ground' | 'obstacle' | 'cover' | 'road' | 'place' | 'itg';
}

/** Dot and compass mark colours: the going colours for ground and obstacles, B's taupe for places. */
const NEAR_COLOR: Record<NearTone, string> = {
  nogo: '#e5484d',
  slow: '#f0932b',
  go: '#2fa862',
  road: '#e3e7ec',
  place: '#c8b49a',
  cover: '#3fbfae',
  itg: '#b892ff',
  other: '#8a939d',
};

const NEAR_MAX = 3;

/**
 * Everything the verdict knows round the point, ranked by what a planner needs first (user, 2026-11-07: "not only
 * water but different things according to their importance"): the ground that decides the verdict (0); an obstacle
 * that is NO-GO for the mode (1); better cover when there is little here, and the nearest place when the civil flag is
 * raised (2); the road for the mode, an obstacle that slows it, a strong ITG candidate (3); the nearest place (4); an
 * ITG candidate, an obstacle that does not stop the mode (5). Nearer first within a rank.
 */
function nearThings(v: GroundGuideVerdict): NearThing[] {
  const out: NearThing[] = [];
  const n = v.nearest;
  if (n) {
    const nogo = n.kind === 'no-go';
    out.push({ name: featureTitle(n.className), what: nogo ? 'NO-GO Ground' : 'Suitable Ground', distanceM: n.distanceM, compass: n.compass, bearingDeg: n.bearingDeg, tone: nogo ? 'nogo' : 'go', rank: 0, kind: 'ground' });
  } else if ((v.verdict === 'ok' || v.verdict === 'caution') && v.distanceM !== null && !v.noneWithinM) {
    // The distance layer has it but not where (beyond the walk): the distance alone, never a guessed direction.
    out.push({ name: 'NO-GO Ground', what: 'Direction not known', distanceM: v.distanceM, compass: null, bearingDeg: null, tone: 'nogo', rank: 0, kind: 'ground' });
  }
  const o = v.sections?.obstacles;
  const here = titleCase(plain(v.className ?? '')); // the ground at the point, which Why already names
  for (const [h, origin] of [[o?.natural, 'Natural Obstacle'], [o?.manMade, 'Man-Made Obstacle']] as const) {
    if (!h) continue;
    const name = titleCase(plain(h.label));
    if (h.distanceM < 1 && name === here) continue;
    const e = h.effect;
    out.push({
      name,
      what: e ? `${e} · ${origin}` : origin,
      distanceM: h.distanceM,
      compass: h.compass,
      bearingDeg: null,
      tone: e === 'NO-GO' ? 'nogo' : e === 'SLOW-GO' ? 'slow' : 'other',
      rank: e === 'NO-GO' ? 1 : e === 'SLOW-GO' ? 3 : 5,
      kind: 'obstacle',
    });
  }
  const c = v.cover;
  if (c) {
    const f = c.focus ?? c.roseField;
    const b = c.nearest[f];
    // Only when the field the mode needs is Poor or None here: otherwise the point already has it.
    if (b && c.levels[f] < 2) {
      out.push({ name: titleCase(b.label), what: `Better ${COVER_KIND[f]} · ${COVER_WORD[b.level]}`, distanceM: b.distanceM, compass: b.compass, bearingDeg: b.bearingDeg, tone: 'cover', rank: 2, kind: 'cover' });
    }
  }
  const r = v.traffic?.road?.main;
  if (r) {
    // A numbered road leads with its number ("N-5 · GT Road"); an unnumbered one by its name, and the small line
    // says it is a road ("Road · All-Weather"), so "Road · Jia Musa Road" never reads twice.
    const generic = /^(road|track)$/i.test(r.shield);
    // An unnamed road is named by its type ("Tertiary"): say "Tertiary Road".
    const named = r.name && /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living street)$/i.test(r.name) ? `${r.name} Road` : r.name;
    const name = generic ? (named ? titleCase(named) : r.shield) : named ? `${r.shield} · ${titleCase(named)}` : r.shield;
    const what = generic ? [r.shield, r.tag].filter(Boolean).join(' · ') : (r.tag ?? 'Road');
    out.push({ name, what, distanceM: r.distanceM, compass: r.compass, bearingDeg: r.bearingDeg ?? null, tone: 'road', rank: 3, kind: 'road' });
  }
  const pop = v.population;
  const pl = pop?.reading?.places[0];
  if (pl) {
    out.push({ name: pl.name, what: pop?.flag ? `${titleCase(pl.kindLabel)} · Civil Flag` : titleCase(pl.kindLabel), distanceM: pl.distanceM, compass: pl.compass, bearingDeg: pl.bearingDeg, tone: 'place', rank: pop?.flag ? 2 : 4, kind: 'place' });
  }
  const it = v.ground?.candidates[0];
  if (it) {
    const what = `${titleCase(it.kindLabel)}${it.elevationM !== null ? ` ${it.elevationM.toLocaleString('en')} m` : ''}`;
    out.push({ name: it.name ? titleCase(it.name) : what, what: it.level === 2 ? 'Strong ITG Candidate' : 'ITG Candidate', distanceM: it.distanceM, compass: it.compass, bearingDeg: it.bearingDeg, tone: 'itg', rank: it.level === 2 ? 3 : 5, kind: 'itg' });
  }
  return out;
}

/** The most important few, one of each kind, with the same ground seen twice (the deciding water and the river) kept once. */
function pickNear(all: NearThing[]): NearThing[] {
  all.sort((a, b) => a.rank - b.rank || a.distanceM - b.distanceM);
  const out: NearThing[] = [];
  const kinds = new Set<NearThing['kind']>();
  const terrain = (t: NearThing) => t.kind === 'ground' || t.kind === 'obstacle';
  for (const t of all) {
    if (out.length >= NEAR_MAX) break;
    if (kinds.has(t.kind)) continue;
    const same = out.some(
      (o) =>
        o.name.toLowerCase() === t.name.toLowerCase() ||
        (terrain(o) && terrain(t) && o.compass === t.compass && Math.abs(o.distanceM - t.distanceM) <= Math.max(150, 0.2 * Math.min(o.distanceM, t.distanceM))),
    );
    if (same) continue;
    kinds.add(t.kind);
    out.push(t);
  }
  return out;
}

/**
 * The Nearest compass: drawn north up in map bearings inside one group that turns with the map (`data-gv-rose`, so
 * `orientNorth` keeps it true on a rotated map), the first thing as the needle and the others as dots on the rim,
 * each in its list colour. The list beside it gives every direction in words as well.
 */
function nearDial(things: NearThing[]): SVGElement | null {
  const marks = things.map((t) => ({ t, b: t.bearingDeg ?? compassBearing(t.compass) })).filter((m): m is { t: NearThing; b: number } => m.b !== null);
  if (!marks.length) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '58');
  svg.setAttribute('height', '58');
  svg.setAttribute('viewBox', '0 0 58 58');
  svg.setAttribute('aria-hidden', 'true'); // the list names every direction
  const add = (parent: Element, tag: string, attrs: Record<string, string | number>, text?: string): SVGElement => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    if (text) e.textContent = text;
    parent.appendChild(e);
    return e as SVGElement;
  };
  const g = add(svg, 'g', { 'data-gv-rose': '29 29' });
  add(g, 'circle', { cx: 29, cy: 29, r: 27, fill: 'rgba(255,255,255,.06)', stroke: 'rgba(255,255,255,.3)', 'stroke-width': 1.5 });
  for (const [x1, y1, x2, y2] of [[56, 29, 51.5, 29], [29, 56, 29, 51.5], [2, 29, 6.5, 29]]) {
    add(g, 'line', { x1, y1, x2, y2, stroke: '#9aa3ad', 'stroke-width': 1.5 });
  }
  add(g, 'text', { x: 29, y: 17, 'text-anchor': 'middle', 'font-size': 11, fill: '#9aa3ad', 'font-family': 'system-ui,Segoe UI,Arial,sans-serif', 'data-gv-upright': '29 13' }, 'N');
  const [lead, ...rest] = marks;
  // Two things in the same direction would hide one dot under the other: the later one moves in towards the centre.
  const placed: number[] = [];
  const dots = rest.map(({ t, b }) => {
    const clash = placed.some((p) => Math.abs((((b - p) % 360) + 540) % 360 - 180) < 16);
    placed.push(b);
    return { t, b, r: clash ? 13 : 22 };
  });
  for (const { t, b, r } of dots.reverse()) {
    const rad = (b * Math.PI) / 180;
    add(g, 'circle', { cx: (29 + r * Math.sin(rad)).toFixed(1), cy: (29 - r * Math.cos(rad)).toFixed(1), r: 4.5, fill: NEAR_COLOR[t.tone], stroke: '#1b1f25', 'stroke-width': 1.5 });
  }
  const needle = add(g, 'g', { transform: `rotate(${Math.round(lead.b)} 29 29)` });
  const col = NEAR_COLOR[lead.t.tone];
  add(needle, 'polygon', { points: '29,19 36,40 29,35 22,40', fill: col, stroke: col, 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
  return svg;
}

/**
 * Nearest, ranked (`card.nearest: ranked`): the compass under the label, and beside it up to three things, each a
 * dot in its colour, its name, its distance and direction, and in small type why it matters. When no ground the unit
 * can use is in reach, that comes first, plainly.
 */
function nearestRanked(v: GroundGuideVerdict): HTMLElement | null {
  const things = pickNear(nearThings(v));
  const list = el('div', 'ms-ggb-nlist');
  if (!v.nearest && v.noneWithinM) {
    const none = el('div', 'ms-ggb-ni');
    const head = el('div', 'ms-ggb-nh');
    const dot = el('span', 'ms-ggb-nd');
    dot.style.background = NEAR_COLOR[v.verdict === 'in' ? 'go' : 'nogo'];
    head.append(dot, el('span', 'ms-ggb-nn', v.verdict === 'in' ? 'Suitable Ground' : 'NO-GO Ground'));
    none.append(head, el('div', 'ms-ggb-nw', `None within ${fmtDistance(v.noneWithinM)}`));
    list.append(none);
  }
  for (const t of things) {
    const item = el('div', 'ms-ggb-ni');
    const head = el('div', 'ms-ggb-nh');
    const dot = el('span', 'ms-ggb-nd');
    dot.style.background = NEAR_COLOR[t.tone];
    const far = el('span', 'ms-ggb-nf');
    // Under a metre is "here", not "0 m E": ground touches the shape, a road or place is at the point.
    if (t.distanceM < 1) far.textContent = t.kind === 'ground' || t.kind === 'obstacle' ? 'Touching' : 'At the Point';
    else far.append(t.compass ? whereNode(t.distanceM, t.compass, t.bearingDeg) : fmtDistance(t.distanceM));
    head.append(dot, el('span', 'ms-ggb-nn', t.name), far);
    const what = el('div', 'ms-ggb-nw', t.what);
    if (t.tone === 'nogo' || t.tone === 'slow') what.dataset.tone = t.tone;
    item.append(head, what);
    list.append(item);
  }
  if (!list.childElementCount) return null;
  const r = el('div', 'ms-ggb-row ms-ggb-nrow');
  r.append(el('div', 'ms-ggb-cap', 'Nearest'));
  const d = nearDial(things);
  if (d) {
    const side = el('div', 'ms-ggb-side');
    side.append(d);
    r.append(side);
  }
  r.append(list);
  return r;
}

/**
 * G · Important Tactical Ground: the candidates round the point, strongest first. The bundle only proposes them;
 * the user designates ITG / MITG, so the wording stays "Candidate".
 */
export function itgSection(v: GroundGuideVerdict): HTMLElement | null {
  const g = v.ground;
  if (!g) return null;
  const rows: Array<Node | string> = [];
  for (const c of g.candidates) {
    const what = `${titleCase(c.kindLabel)}${c.elevationM !== null ? ` ${c.elevationM.toLocaleString('en')} m` : ''}`;
    const head = el('div');
    head.append(el('span', 'ms-ggb-b', c.name ? titleCase(c.name) : what), c.name ? ` · ${what}` : '');
    const where = el('div');
    where.append(
      el('span', c.level === 2 ? 'ms-ggb-strong' : undefined, c.level === 2 ? 'Strong Candidate (Check as MITG)' : 'ITG Candidate'),
      ` · ${fmtDistance(c.distanceM)} ${c.compass}`,
      dirArrow(c.bearingDeg) ?? '',
    );
    const item = el('div', 'ms-ggb-itg');
    item.append(head, where, el('div', 'ms-ggb-soft', c.reasonLabels.map(titleCase).join(' · ')));
    // What the bundle measured on it (ground.py): what it commands, and what it is like to hold.
    for (const line of c.traits ? itgTraitLines(c.traits) : []) item.append(el('div', 'ms-ggb-soft ms-ggb-itgt', line));
    rows.push(item);
  }
  if (!rows.length) {
    rows.push(el('span', 'ms-ggb-soft', g.pending ? 'Loading ground features' : `None within ${fmtDistance(g.radiusM)}`));
  }
  return section('Important Tactical Ground', ...rows);
}

/** Enforce mode: this click would be refused, and whether Shift gets past it. A red strip that closes the card. */
function enforceStrip(v: GroundGuideVerdict): HTMLElement | null {
  if (!v.blocked) return null;
  const text = v.overridable ? 'A click here is refused. Hold Shift and click to place it anyway.' : 'A click here is refused.';
  const body = el('div');
  body.append(el('span', 'ms-ggb-b', 'Enforce Mode: '), text);
  const strip = el('div', 'ms-ggb-enf');
  strip.append(icon('octagon', 14), body);
  return strip;
}

/** The echelon's minimum gap to the next same-echelon unit. Advisory, so it never changes the title. */
function spacingSection(v: GroundGuideVerdict): HTMLElement | null {
  const s = v.spacing;
  if (!s) return null;
  const echelon = v.footprint?.echelon ?? 'unit';
  const colour = SPACING_COLOR[s.status];
  if (s.nearestGapM === null) return row('Inter Gap Rule', el('div', 'ms-ggb-dim', `No other ${echelon} nearby`));
  const text = el('div', s.status !== 'ok' ? 'ms-ggb-warn' : undefined);
  if (s.status === 'overlap') text.textContent = `Overlaps the next ${echelon}`;
  else text.append(el('span', s.status === 'ok' ? 'ms-ggb-b' : undefined, fmtDistance(s.nearestGapM)), ` of ${fmtDistance(s.minGapM)} to the next ${echelon}`);
  return row('Inter Gap Rule', text, track(s.nearestGapM / s.minGapM, colour));
}

export class GroundGuideBadge {
  private _el: HTMLDivElement | null = null;
  private _bar: HTMLDivElement | null = null;
  private _body: HTMLDivElement | null = null;
  private _x = 0;
  private _y = 0;
  private _w = 280;
  private _h = 120;
  private _hasPointer = false;
  private _touch = false;
  private _last: GroundGuideVerdict | null = null;
  private _north = 0; // where north points on screen, degrees clockwise from up
  /** Which going / soil / movement sections to show (groundGuide.card). */
  private _card: GroundGuideCardOptions = { ...DEFAULT_GROUND_GUIDE_OPTIONS.card };
  private _notice: string | null = null;
  private _noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private _toastEl: HTMLDivElement | null = null;
  private _toastBar: HTMLDivElement | null = null;
  private _toastBody: HTMLDivElement | null = null;
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;
  private _live: HTMLDivElement | null = null;
  private _spoken = '';
  private _pending = '';
  private _speakTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Say the verdict to a screen reader, once the cursor has settled and only when what is said changes: the
   * card is rebuilt on every move, and reading it out each time would drown out everything else.
   */
  private _say(text: string): void {
    if (text === this._pending) return;
    this._pending = text;
    if (this._speakTimer !== null) clearTimeout(this._speakTimer);
    this._speakTimer = setTimeout(() => {
      this._speakTimer = null;
      if (text !== this._spoken && this._live) {
        this._spoken = text;
        this._live.textContent = text;
      }
    }, SPEAK_DELAY_MS);
  }

  /** Show a short message under the verdict for a few seconds (e.g. why the quick fix found nothing). */
  flash(text: string, ms = 3500): void {
    this._notice = text;
    if (this._live) this._live.textContent = text; // the card is hidden from assistive tech, so say it here
    this._spoken = '';
    if (this._noticeTimer !== null) clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => {
      this._noticeTimer = null;
      this._notice = null;
      if (this._last && this._el && this._el.style.display !== 'none') this.show(this._last);
    }, ms);
    if (this._last && this._el && this._el.style.display !== 'none') this.show(this._last);
  }

  /**
   * A card that outlives the draw (hide() does not touch it): why a placement was refused. It sits
   * where the cursor was and goes away on its own, or as soon as the next draw shows the badge.
   */
  toast(t: { verdict: GroundGuideVerdict['verdict']; title: string; lines: string[]; hint?: string }, ms = 5000): void {
    this._ensure();
    if (!this._toastEl) {
      const root = el('div', 'ms-ground-guide-badge') as HTMLDivElement;
      this._toastBar = el('div', 'ms-ggb-bar') as HTMLDivElement;
      this._toastBody = el('div', 'ms-ggb-body') as HTMLDivElement;
      root.append(this._toastBar, this._toastBody);
      document.body.appendChild(root);
      this._toastEl = root;
    }
    const root = this._toastEl;
    root.dataset.verdict = t.verdict;
    // A refusal interrupts (alert); "guide ready", "loading", "not terrain-bound" wait their turn (status).
    root.setAttribute('role', t.verdict === 'in' || t.verdict === 'partial' ? 'alert' : 'status');
    this._toastBar!.replaceChildren(icon('x', 17), el('span', undefined, t.title));
    const rows = t.lines.map((l) => el('div', undefined, l));
    if (t.hint) rows.push(el('div', 'ms-ggb-soft', t.hint));
    this._toastBody!.replaceChildren(...rows);
    if (!this._hasPointer) {
      this._x = Math.round(window.innerWidth / 2);
      this._y = 90;
    }
    root.style.display = 'block';
    this._position(root, root.offsetWidth, root.offsetHeight);
    if (this._toastTimer !== null) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.dismissToast(), ms);
  }

  dismissToast(): void {
    if (this._toastTimer !== null) clearTimeout(this._toastTimer);
    this._toastTimer = null;
    if (this._toastEl) this._toastEl.style.display = 'none';
  }

  /** Pointer position in client coordinates; call from a pointermove listener. `touch`: it is a finger, so keep the card off it. */
  moveTo(clientX: number, clientY: number, touch = false): void {
    this._x = clientX;
    this._y = clientY;
    this._touch = touch;
    this._hasPointer = true;
    if (this._el && this._el.style.display !== 'none') this._place();
  }

  /** Which going / soil / movement sections the card shows (groundGuide.card); applies from the next show(). */
  setCard(card: GroundGuideCardOptions): void {
    this._card = { ...card };
  }

  /** The map was rotated: `northDeg` is where north now points on screen. Turns the dial, roses, maps and arrows in place; the card is not rebuilt. */
  setNorth(northDeg: number): void {
    if (northDeg === this._north) return;
    this._north = northDeg;
    orientNorth(this._el, northDeg); // dials, roses, canvases and (through --gg-north) every arrow on the card
  }

  show(v: GroundGuideVerdict): void {
    this._last = v;
    if (this._toastEl && this._toastEl.style.display !== 'none') this.dismissToast();
    const el0 = this._ensure();
    el0.dataset.verdict = v.verdict;

    const bar = this._bar!;
    bar.replaceChildren(icon(iconOf(v), 17), el('span', 'ms-ggb-title', titleOf(v)));
    const pct = v.samples > 1 && v.fraction > 0 ? Math.max(1, Math.round(v.fraction * 100)) : 0;
    const pills = el('div', 'ms-ggb-pills');
    // The share inside bad ground is the Inside row's own figure; the bar keeps only what a key can act on.
    if (v.snappable) {
      // S moves the point to the nearest usable ground; the legend explains the key, the card only cues it.
      const fix = el('span', 'ms-ggb-fix');
      fix.append(keycap('S'), 'Quick Fix');
      pills.appendChild(fix);
    }
    const civil = v.verdict === 'unknown' ? null : populationFlagPill(v.population);
    if (civil) pills.appendChild(civil);
    if (pills.childElementCount) bar.appendChild(pills);
    if (v.verdict !== 'unknown') bar.appendChild(forLine(v));

    const rows = this._card.cursor === 'full' ? this._fullRows(v, pct, bar, pills) : this._minimalRows(v, pct);
    const body = this._body!;
    body.replaceChildren(...rows);
    // Every picture and compass point on the card follows the map (GroundGuideNorth).
    // On the card root, not the body: orientNorth sets --gg-north on what it is given, and a stale copy on the body
    // would hide the root's value from the arrows when setNorth later turns the root.
    orientNorth(el0, this._north);
    arrowCompass(body);
    body.style.display = rows.length ? 'block' : 'none';
    const civilSaid = populationSpoken(v.population);
    this._say(civilSaid ? `${spokenFor(v)} ${civilSaid}.` : spokenFor(v));

    if (!this._hasPointer) {
      this._x = Math.round(window.innerWidth / 2);
      this._y = 90;
    }
    el0.style.display = 'block';
    this._w = el0.offsetWidth;
    this._h = el0.offsetHeight;
    this._place();
  }

  /**
   * The minimal cursor card (`card.cursor: minimal`): Why with the going scale, Inside, Nearest with its compass and
   * the Inter Gap Rule, then the enforce strip. Everything else waits in the Ground Detail, which the foot cue names.
   */
  private _minimalRows(v: GroundGuideVerdict, pct: number): HTMLElement[] {
    const rows =
      v.verdict === 'unknown'
        ? []
        : [
            overlayWarning(v),
            whySection(v),
            keyFacts(v),
            pct > 0 ? insideSection(v, pct) : null,
            this._card.nearest === 'deciding' ? nearestSection(v, this._north) : nearestRanked(v),
            spacingSection(v),
          ].filter(
            (r): r is HTMLElement => r !== null,
          );
    if (v.loading) rows.push(el('div', 'ms-ggb-note ms-ggb-soft', 'Still loading terrain data'));
    if (this._notice) rows.push(el('div', 'ms-ggb-note ms-ggb-warn', this._notice));
    const strip = v.verdict === 'unknown' ? null : enforceStrip(v);
    if (strip) rows.push(strip);
    if (v.briefKey && v.verdict !== 'unknown') rows.push(detailCue());
    return rows;
  }

  /** The full cursor card (`card.cursor: full`): every section switched on, in GROTBC order, as before the Detail card. */
  private _fullRows(v: GroundGuideVerdict, pct: number, bar: HTMLElement, pills: HTMLElement): HTMLElement[] {
    // G / R / B (buildings) / W sections (sections.*): G after the ITG lines, R after G, B buildings after People, W last.
    const sx = sectionsCard(v);
    const rows =
      v.verdict === 'unknown'
        ? []
        : [whySection(v), pct > 0 ? insideSection(v, pct) : null, nearestSection(v, this._north), spacingSection(v), itgSection(v), sx.g, sx.r, sx.o].filter(
            (r): r is HTMLElement => r !== null,
          );
    // A T block (traffic.block) carries the Cross-Country and Movement sections itself.
    if (v.verdict !== 'unknown') rows.push(...goingSections(v, trafficCard(v, this._card), this._north));
    // C (cover.where): right after Why goes in before T, so T (also after Why) lands between them in GROTBC order.
    const cover = coverSection(v, this._north);
    if (cover && v.cover?.where === 'afterWhy') rows.splice(rows.length && v.verdict !== 'unknown' ? 1 : 0, 0, cover);
    decorateTraffic(v, bar, pills, rows, rows.length, this._north); // T: block or road band, rain pill, second scale under Why
    decorateSpeed(v, rows, rows.length, this._north); // T, Speed: after the last T section (else before B)
    const people = v.verdict === 'unknown' ? null : populationSection(v.population);
    if (people) {
      ensurePopulationCss();
      rows.push(people);
    }
    if (sx.b) rows.push(sx.b);
    if (cover && v.cover?.where !== 'afterWhy') rows.push(cover); // GROTBC order: C comes last, after B
    if (sx.w) rows.push(sx.w);
    if (v.loading) rows.push(el('div', 'ms-ggb-sec ms-ggb-soft', 'Still loading terrain data'));
    if (this._notice) rows.push(el('div', 'ms-ggb-sec ms-ggb-warn', this._notice));
    const civilStrip = v.verdict === 'unknown' ? null : populationFlagStrip(v.population);
    if (civilStrip) {
      ensurePopulationCss();
      rows.push(civilStrip);
    }
    const strip = v.verdict === 'unknown' ? null : enforceStrip(v);
    if (strip) rows.push(strip);
    if (v.briefKey && v.verdict !== 'unknown') rows.push(detailCue());
    return rows;
  }

  hide(): void {
    if (this._el) this._el.style.display = 'none';
    // Forget what was said, so the next draw announces its first verdict again.
    if (this._speakTimer !== null) clearTimeout(this._speakTimer);
    this._speakTimer = null;
    this._spoken = this._pending = '';
    if (this._live) this._live.textContent = '';
    this._notice = null;
    if (this._noticeTimer !== null) {
      clearTimeout(this._noticeTimer);
      this._noticeTimer = null;
    }
  }

  destroy(): void {
    this.hide();
    this.dismissToast();
    this._toastEl?.remove();
    this._toastEl = this._toastBar = this._toastBody = null;
    this._last = null;
    this._el?.remove();
    this._live?.remove();
    this._live = null;
    this._el = null;
    this._bar = null;
    this._body = null;
    this._hasPointer = false;
  }

  /** Below and right of the cursor; flips to the other side near a screen edge. */
  private _place(): void {
    if (this._el) this._position(this._el, this._w, this._h);
  }

  private _position(target: HTMLElement, w: number, h: number): void {
    if (this._touch) {
      // A finger covers what is below and beside it: centre the card above the touch point, below it only when
      // there is no room above.
      const tx = Math.min(Math.max(EDGE / 2, this._x - w / 2), window.innerWidth - w - EDGE / 2);
      const above = this._y - h - TOUCH_GAP;
      const ty = above >= EDGE / 2 ? above : this._y + TOUCH_GAP;
      target.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
      return;
    }
    let x = this._x + 16;
    let y = this._y + 20;
    if (x + w > window.innerWidth - EDGE) x = this._x - 16 - w;
    if (y + h > window.innerHeight - EDGE) y = this._y - 14 - h;
    x = Math.max(EDGE / 2, x);
    y = Math.max(EDGE / 2, y);
    target.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private _ensure(): HTMLDivElement {
    if (this._el) return this._el;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = document.createElement('div');
    root.className = 'ms-ground-guide-badge';
    // The card follows the cursor and is rebuilt as it moves, so it is not a live region itself (that would
    // read the whole card out again on every change); a screen reader gets a short sentence from `_live`.
    root.setAttribute('aria-hidden', 'true');
    const live = el('div', 'ms-ggb-sr') as HTMLDivElement;
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    document.body.appendChild(live);
    this._live = live;
    const bar = el('div', 'ms-ggb-bar') as HTMLDivElement;
    const body = el('div') as HTMLDivElement; // its sections carry their own padding and bands
    root.append(bar, body);
    document.body.appendChild(root);
    this._el = root;
    this._bar = bar;
    this._body = body;
    return root;
  }
}
