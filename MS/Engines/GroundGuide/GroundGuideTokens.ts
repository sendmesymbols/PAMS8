/**
 * GroundGuideTokens.ts
 *
 * One type scale and one set of colours for every Ground Guide surface: the cursor card, the hint chip, the Ground
 * Detail, the views it reuses, the legend and the map marks (user, 2026-11-08, visual review: item 17 "Five steps",
 * item 18 "Dark only, more contrast", item 1 "Five steps, one ladder", item 16 "Reserve the ladder"). A file that
 * needs a colour or a size takes it from here instead of writing its own hex, so a verdict reads the same everywhere.
 *
 *   Type: 12 meta (labels, units, captions) · 13.5 body · 15.5 value · 18 title · 22 lead number; weights 400 / 600 / 750.
 *   Verdict ladder (bar, chip, gauge, overlay, legend key, indicator lines):
 *     go   Suitable      green   tick
 *     marg Marginal      yellow  outline triangle   (Adjacent to NO-GO ground; the shape itself is on GO ground)
 *     slow SLOW-GO       orange  filled triangle
 *     part Part NO-GO    red, hatched, outline octagon (Encroaching, Partially Obstructed)
 *     nogo NO-GO         deep red, filled octagon with a cross (Unsuitable)
 *     chk  Checking      grey    three dots (tiles still loading: never a colour that has not been checked)
 *   Red and green are kept for verdicts: roads are white (MSR, cased), blue (all-weather), violet (fair-weather) and
 *   dashed grey (track); other units' footprints are violet; natural obstacles a neutral blue-grey.
 *
 * Also the shared pieces several files draw: the GO / SLOW-GO / NO-GO gauge (item 2), the read-only ruler (item 11)
 * and the frame every round picture shares (item 12: one ring, one size, one N, one key under it).
 *
 * No DOM work at import time (only inside functions), so a module the tile worker loads may import the constants.
 */

import type { GoingStep, GroundGuideVerdict } from './GroundGuideTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'ms-ground-guide-tokens';

// ── type ─────────────────────────────────────────────────────────────────────

export const FONT = 'system-ui,Segoe UI,Arial,sans-serif';
/** The five sizes, px. Nothing in the Ground Guide is set smaller than `meta`. */
export const FS = { meta: 12, body: 13.5, value: 15.5, title: 18, lead: 22 } as const;
/** The three weights. */
export const FW = { regular: 400, semi: 600, bold: 750 } as const;

// ── colours ──────────────────────────────────────────────────────────────────

export type Tone = 'go' | 'marg' | 'slow' | 'part' | 'nogo' | 'chk';
export type LadderIcon = 'check' | 'trio' | 'tri' | 'octo' | 'octx' | 'dots';

/** The verdict ladder: fill (bar, chip, overlay), text on that fill, dot and text on the dark card, icon. */
export const TONE: Record<Tone, { fill: string; fg: string; dot: string; text: string; icon: LadderIcon; hatch: boolean; word: string }> = {
  go: { fill: '#18733f', fg: '#ffffff', dot: '#2fa862', text: '#74dca3', icon: 'check', hatch: false, word: 'Suitable' },
  marg: { fill: '#f1d646', fg: '#14181d', dot: '#f1d646', text: '#f1d646', icon: 'trio', hatch: false, word: 'Marginal' },
  slow: { fill: '#ee8a1f', fg: '#14181d', dot: '#ee8a1f', text: '#ffb46b', icon: 'tri', hatch: false, word: 'SLOW-GO' },
  part: { fill: '#c62f35', fg: '#ffffff', dot: '#e5484d', text: '#ff8a8d', icon: 'octo', hatch: true, word: 'Part NO-GO' },
  nogo: { fill: '#b92b31', fg: '#ffffff', dot: '#e5484d', text: '#ff8a8d', icon: 'octx', hatch: false, word: 'NO-GO' },
  chk: { fill: '#5b6470', fg: '#ffffff', dot: '#7f8893', text: '#c3cbd3', icon: 'dots', hatch: false, word: 'Checking' },
};

/** The three going steps on the dark card: dots, gauge segments, rose wedges and spokes. */
export const STEP_COLOR: Record<GoingStep, string> = { go: '#2fa862', slow: '#ee8a1f', nogo: '#e5484d' };
/** A going word written in its colour on the dark card. */
export const STEP_TEXT: Record<GoingStep, string> = { go: '#74dca3', slow: '#ffb46b', nogo: '#ff8a8d' };
/** Cover / concealment levels 0 None, 1 Poor, 2 Fair, 3 Good, on the ladder's colours (dot / fill). */
export const LEVEL_COLOR = ['#7f8893', '#ee8a1f', '#d9c23e', '#2fa862'] as const;
/** The same levels as text on the dark card. */
export const LEVEL_TEXT = ['#c3cbd3', '#ffb46b', '#f1d646', '#74dca3'] as const;

/** Card surfaces, darkest to lightest. */
export const SURFACE = { ring: '#14181d', card: '#1b1f25', strip: '#20262e', raised: '#222830', head: '#262d36' } as const;
/** Text on the dark card. Labels were #7f8893 – #a9b2bc; raised for daylight (item 18). No text is faded with opacity. */
export const TEXT = { strong: '#ffffff', main: '#f1f3f6', label: '#c3cbd3', soft: '#b8c1ca', warn: '#ffd27a' } as const;
/** Hairlines and rings, a step stronger than before (item 18). */
export const LINE = { hair: 'rgba(255,255,255,.14)', soft: 'rgba(255,255,255,.1)', ring: '#5d6772' } as const;
/** Focus rings and the mode icon. */
export const ACCENT = '#8ec1ea';

/** Road classes, off the verdict colours (item 16): MSR white on a dark casing with the letters MSR, all-weather blue, fair-weather violet, track dashed grey. */
export const ROAD = { msr: '#ffffff', msrCasing: '#14181d', allWeather: '#8cc4ff', fairWeather: '#b9a2e8', track: '#9aa3ad' } as const;
/** Other units' footprints on the map and in keys (was SLOW-GO orange). */
export const OTHER_UNIT = '#a78bfa';
/** This unit's own footprint. */
export const OWN_UNIT = '#1e64c8';
/** Natural obstacles in tiles and keys when no going is meant (was green). */
export const NEUTRAL_OBSTACLE = '#7f95a8';
/**
 * The Gr Scope rail's map (user, 2026-11-08, approved in ground-guide-scope-window.html). Going cells are the ladder
 * a shade darker so the marks on top read (Suitable, Marginal, SLOW-GO, NO-GO, no data); `plain` is the ground with the
 * T layer off (NO-GO kept, in the neutral obstacle blue-grey); the rest are the GROTBC marks.
 */
export const SCOPE_MAP = {
  cell: { go: '#2f7d4f', marg: '#cdb944', slow: '#cf6f1f', nogo: '#a8282e', none: '#2a2f36' },
  plain: { ground: '#4a4f43', nogo: '#55697a' },
  water: '#4f8fc0',
  power: '#d6c27a',
  ridge: '#c9a36b',
  hill: '#c9a36b',
  itg: '#b892ff',
  town: '#d8c6a8',
  clear: '#74dca3',
  minor: '#c3cbd3',
  rail: '#e8ebee',
  bua: [236, 232, 222] as const,
  trees: [10, 30, 18] as const,
  nullah: [217, 182, 122] as const,
  /** Front blocks: mostly in NO-GO, some in NO-GO. */
  frontNogo: '#ff3b44',
  frontPart: '#ff9aa0',
  /** The dark casing under every line and the halo under every name. */
  casing: '#0b0d10',
} as const;

/** Letter badges and tabs are neutral: GROTBC letters are not verdicts (items 8, 16). */
export const LETTER_FILL = '#aab3bd';
export const LETTER_FG = '#14181d';

/** `#rrggbb` → `[r, g, b]`, for ArcGIS symbols and canvas fills. */
export function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ── the verdict on the ladder ────────────────────────────────────────────────

/**
 * Where a verdict sits on the ladder. Adjacent (near, nothing inside) is Marginal: the shape stands on GO ground
 * (the evaluator only says "near" when no sample is SLOW-GO) beside NO-GO. Encroaching (near with a sliver inside)
 * and Partially Obstructed are Part NO-GO. A verdict that is still provisional (`loading`: reused from a moment ago,
 * or judged before all its tiles arrived) is Checking (item 4: grey until checked), unless what is known already
 * puts NO-GO ground in the shape: a warning is never hidden behind "Checking" (never understate the danger either).
 */
export function verdictTone(v: Pick<GroundGuideVerdict, 'verdict' | 'fraction'> & { loading?: boolean }): Tone {
  const bad = v.verdict === 'in' || v.verdict === 'partial' || (v.verdict === 'near' && v.fraction > 0);
  if (v.loading && !bad) return 'chk';
  switch (v.verdict) {
    case 'ok': return 'go';
    case 'near': return v.fraction > 0 ? 'part' : 'marg';
    case 'caution': return 'slow';
    case 'partial': return 'part';
    case 'in': return 'nogo';
    default: return 'chk';
  }
}

/** The step the GO / SLOW-GO / NO-GO gauge lights for a tone (Marginal lights GO: the ground under it is GO). */
export const TONE_STEP: Record<Tone, GoingStep | null> = { go: 'go', marg: 'go', slow: 'slow', part: 'nogo', nogo: 'nogo', chk: null };

const ICON_PATHS: Record<LadderIcon, (cut: string) => string> = {
  check: () => '<path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  trio: () =>
    '<path d="M10 2.8l8 14.4H2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 8v4M10 14.7v.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  tri: (cut) =>
    `<path d="M10 2.2l8.6 15.3H1.4z" fill="currentColor"/><path d="M10 7.8v4.2M10 14.6v.1" stroke="${cut}" stroke-width="2.2" stroke-linecap="round"/>`,
  octo: () =>
    '<path d="M6.9 2.2h6.2l4.7 4.7v6.2l-4.7 4.7H6.9l-4.7-4.7V6.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 6.2v4.6M10 13.6v.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  octx: (cut) =>
    `<path d="M6.7 1.5h6.6l4.7 4.7v7.6l-4.7 4.7H6.7L2 13.8V6.2z" fill="currentColor"/><path d="M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6" stroke="${cut}" stroke-width="2.2" stroke-linecap="round"/>`,
  dots: () => '<circle cx="4.5" cy="10" r="1.9" fill="currentColor"/><circle cx="10" cy="10" r="1.9" fill="currentColor"/><circle cx="15.5" cy="10" r="1.9" fill="currentColor"/>',
};

/** The SVG markup of a ladder icon, `cut` the colour of the mark punched into a filled shape (the fill behind it). */
export function ladderIconMarkup(name: LadderIcon, cut: string, color = 'currentColor'): string {
  return `<g style="color:${color}">${ICON_PATHS[name](cut)}</g>`;
}

/** A ladder icon as an SVG element (inherits `currentColor`). `cut`: the colour behind it, for the mark in a filled shape. */
export function ladderIcon(name: LadderIcon, size = 18, cut: string = SURFACE.card): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICON_PATHS[name](cut); // fixed markup from this file, never user text
  return svg;
}

/** The icon of a tone, drawn in the tone's text colour on its own fill. */
export function toneIcon(tone: Tone, size = 18): SVGElement {
  return ladderIcon(TONE[tone].icon, size, TONE[tone].fill);
}

// ── shared CSS ───────────────────────────────────────────────────────────────

const CSS = `
:root{--gg-go:${TONE.go.fill};--gg-marg:${TONE.marg.fill};--gg-slow:${TONE.slow.fill};--gg-part:${TONE.part.fill};--gg-nogo:${TONE.nogo.fill};--gg-chk:${TONE.chk.fill};
  --gg-dot-go:${STEP_COLOR.go};--gg-dot-slow:${STEP_COLOR.slow};--gg-dot-nogo:${STEP_COLOR.nogo};--gg-dot-marg:${TONE.marg.dot};
  --gg-tx-go:${STEP_TEXT.go};--gg-tx-slow:${STEP_TEXT.slow};--gg-tx-nogo:${STEP_TEXT.nogo};--gg-tx-marg:${TONE.marg.text};
  --gg-card:${SURFACE.card};--gg-strip:${SURFACE.strip};--gg-raised:${SURFACE.raised};--gg-head:${SURFACE.head};--gg-ringbg:${SURFACE.ring};
  --gg-text:${TEXT.main};--gg-strong:${TEXT.strong};--gg-label:${TEXT.label};--gg-soft:${TEXT.soft};--gg-warn:${TEXT.warn};
  --gg-hair:${LINE.hair};--gg-hair-soft:${LINE.soft};--gg-ring:${LINE.ring};--gg-accent:${ACCENT};
  --gg-fs-meta:${FS.meta}px;--gg-fs-body:${FS.body}px;--gg-fs-value:${FS.value}px;--gg-fs-title:${FS.title}px;--gg-fs-lead:${FS.lead}px;
  --gg-road-msr:${ROAD.msr};--gg-road-aw:${ROAD.allWeather};--gg-road-fw:${ROAD.fairWeather};--gg-road-tr:${ROAD.track};--gg-other-unit:${OTHER_UNIT}}
.ms-gg-hatch{background-image:repeating-linear-gradient(135deg,rgba(0,0,0,.22) 0 6px,transparent 6px 12px)}
/* The going gauge (item 2): one bar in three colours, a pointer over the lit part, the words under it. Nothing in it looks pressable. */
.ms-gg-gz{position:relative}
.ms-gg-gz-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;align-items:end;height:19px}
.ms-gg-gz-bar>i{display:block;height:6px;border-radius:3px;position:relative}
.ms-gg-gz-bar>i.ms-go{background:#1d4d33}.ms-gg-gz-bar>i.ms-slow{background:#5e3c17}.ms-gg-gz-bar>i.ms-nogo{background:#5a2427}
.ms-gg-gz-bar>i.ms-on{height:10px}
.ms-gg-gz-bar>i.ms-on.ms-go{background:${STEP_COLOR.go}}.ms-gg-gz-bar>i.ms-on.ms-slow{background:${STEP_COLOR.slow}}.ms-gg-gz-bar>i.ms-on.ms-nogo{background:${STEP_COLOR.nogo}}
.ms-gg-gz-bar>i.ms-on::after{content:"";position:absolute;left:50%;top:-9px;margin-left:-6px;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${TEXT.main}}
.ms-gg-gz-lab{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:4px;text-align:center;font:${FW.semi} ${FS.meta}px/1.2 ${FONT};color:${TEXT.label}}
.ms-gg-gz-lab>.ms-on{font-weight:${FW.bold};font-size:${FS.body}px}
.ms-gg-gz-lab>.ms-on.ms-go{color:${STEP_TEXT.go}}.ms-gg-gz-lab>.ms-on.ms-slow{color:${STEP_TEXT.slow}}.ms-gg-gz-lab>.ms-on.ms-nogo{color:${STEP_TEXT.nogo}}
.ms-gg-gz-tag{display:inline-flex;align-items:center;gap:5px;margin-top:7px;padding:1px 9px;border-radius:999px;font:${FW.semi} ${FS.meta}px/1.5 ${FONT};color:${STEP_TEXT.nogo};border:1px solid rgba(229,72,77,.6)}
.ms-gg-gz-tag>svg{flex:none}
/* A read-only ruler (item 11): bands on a line, a pointer at the value, the current band bold. */
.ms-gg-ru{margin:4px 0 2px}
.ms-gg-ru-l{font:${FW.regular} ${FS.meta}px/1.3 ${FONT};color:${TEXT.label};margin-bottom:3px}
.ms-gg-ru-bar{position:relative;display:grid;gap:2px;height:22px;align-items:end}
.ms-gg-ru-bar>i{display:block;height:6px;background:#3a434e;border-radius:2px}
.ms-gg-ru-bar>i.ms-on{background:#c9d1d9;height:8px}
.ms-gg-ru-ptr{position:absolute;top:0;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${TEXT.main};margin-left:-6px}
.ms-gg-ru-lab{display:grid;gap:2px;margin-top:3px;text-align:center;font:${FW.regular} ${FS.meta}px/1.25 ${FONT};color:${TEXT.label}}
.ms-gg-ru-lab>span{min-width:0;overflow-wrap:anywhere}
.ms-gg-ru-lab>.ms-on{color:${TEXT.main};font-weight:${FW.bold}}
.ms-gg-ru-v{margin-top:3px;font:${FW.regular} ${FS.body}px/1.35 ${FONT};color:${TEXT.label}}
/* The key under every round picture (item 12): one line, one size, one place. */
.ms-gg-rkey{margin-top:4px;font:${FW.regular} ${FS.meta}px/1.35 ${FONT};color:${TEXT.label};text-align:center;max-width:180px;margin-left:auto;margin-right:auto}
.ms-gg-rkey i{display:inline-block;width:12px;height:4px;border-radius:2px;margin:0 4px 2px 0;vertical-align:middle}
.ms-gg-rkey i.ms-cased{height:5px;background:${ROAD.msr};box-shadow:0 0 0 1.5px ${ROAD.msrCasing}}
.ms-gg-rkey i.ms-dash{background:repeating-linear-gradient(90deg,${ROAD.track} 0 3px,transparent 3px 5px)}
.ms-gg-rkey b{color:${TEXT.main};font-weight:${FW.semi}}
`;

/** Add the shared CSS (custom properties, gauge, ruler, rose key) once. Every view that uses them calls this. */
export function ensureTokensCss(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
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

// ── the going gauge ──────────────────────────────────────────────────────────

const STEPS: Array<[GoingStep, string]> = [
  ['go', 'GO'],
  ['slow', 'SLOW-GO'],
  ['nogo', 'NO-GO'],
];

/**
 * GO / SLOW-GO / NO-GO as a gauge (item 2): one bar in three colours, a pointer over the lit step, the words under it
 * with the lit one bold in its colour. `lit` null: nothing lit (still checking). `tag`: a line under it, such as the
 * NO-GO ground beside a Marginal position ("NO-GO 120 m NE").
 */
export function gauge(lit: GoingStep | null, tag?: Node | string | null): HTMLElement {
  ensureTokensCss();
  const g = el('div', 'ms-gg-gz');
  const bar = el('div', 'ms-gg-gz-bar');
  const lab = el('div', 'ms-gg-gz-lab');
  for (const [k, word] of STEPS) {
    bar.append(el('i', `ms-${k}${k === lit ? ' ms-on' : ''}`));
    lab.append(el('span', k === lit ? `ms-on ms-${k}` : undefined, word));
  }
  g.append(bar, lab);
  if (tag) {
    const t = el('div', 'ms-gg-gz-tag');
    t.append(ladderIcon('octo', 13), tag);
    g.append(t);
  }
  g.setAttribute('role', 'img');
  g.setAttribute('aria-label', lit ? `Going: ${STEPS.find(([k]) => k === lit)?.[1]}` : 'Going: still checking');
  return g;
}

// ── the read-only ruler ──────────────────────────────────────────────────────

/**
 * A reading on a scale that is not a control (item 11): `bands` along a line, the band `on` drawn brighter with its
 * word bold, a pointer at `pos` (0 to 1 along the whole line; the middle of the band when left out), an optional
 * label above and a value line under it. A reading off the scale (`on` < 0) lights nothing.
 */
export function ruler(bands: readonly string[], on: number, opts: { label?: string; value?: string | Node; pos?: number | null } = {}): HTMLElement {
  ensureTokensCss();
  const n = Math.max(1, bands.length);
  const cols = `repeat(${n},minmax(0,1fr))`;
  const r = el('div', 'ms-gg-ru');
  if (opts.label) r.append(el('div', 'ms-gg-ru-l', opts.label));
  const bar = el('div', 'ms-gg-ru-bar');
  bar.style.gridTemplateColumns = cols;
  const lab = el('div', 'ms-gg-ru-lab');
  lab.style.gridTemplateColumns = cols;
  bands.forEach((b, i) => {
    bar.append(el('i', i === on ? 'ms-on' : undefined));
    lab.append(el('span', i === on ? 'ms-on' : undefined, b));
  });
  const pos = opts.pos ?? (on >= 0 ? (on + 0.5) / n : null);
  if (pos !== null && Number.isFinite(pos)) {
    const p = el('span', 'ms-gg-ru-ptr');
    p.style.left = `${(Math.min(1, Math.max(0, pos)) * 100).toFixed(1)}%`;
    bar.append(p);
  }
  r.append(bar, lab);
  if (opts.value !== undefined) {
    const v = el('div', 'ms-gg-ru-v');
    v.append(opts.value);
    r.append(v);
  }
  r.setAttribute('role', 'img');
  r.setAttribute('aria-label', `${opts.label ? `${opts.label}: ` : ''}${on >= 0 ? bands[on] : 'off the scale'}`);
  return r;
}

// ── the round picture frame ──────────────────────────────────────────────────

/** Every round picture is drawn this size on screen, px (item 12). */
export const ROSE_PX = 120;
/** The frame's own units: centre, the ring, and the radius a picture may draw to inside it. */
export const ROSE_C = 60;
export const ROSE_RING = 50;
export const ROSE_R = 47;

export interface RoseFrame {
  svg: SVGSVGElement;
  /** The group that turns with the map (`data-gv-rose`): draw wedges, spokes and dots here, in map bearings, north up. */
  g: SVGGElement;
  /** Add an SVG element: `parent` defaults to the turning group. */
  add(tag: string, attrs: Record<string, string | number>, parent?: Element, text?: string): SVGElement;
  /** A point at `r` (frame units) and bearing `deg` (clockwise from north), as "x y". */
  at(r: number, deg: number): string;
}

/**
 * The frame every round picture shares (item 12, "Same frame, own shape"): one size (`ROSE_PX`), a dark disc with
 * one ring, N above the ring kept upright as the map turns, all in a 120 × 120 box centred at (60, 60). The picture
 * draws its own shape (pie, spokes, dots, rose) inside radius `ROSE_R`, colours from the ladder only, and puts its
 * key under it with `roseKey`. `label` is the picture's accessible name.
 */
export function roseFrame(label: string, px = ROSE_PX): RoseFrame {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.classList.add('ms-gg-rose');
  const add = (tag: string, attrs: Record<string, string | number>, parent?: Element, text?: string): SVGElement => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    if (text !== undefined) e.textContent = text;
    (parent ?? g).appendChild(e);
    return e as SVGElement;
  };
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('data-gv-rose', `${ROSE_C} ${ROSE_C}`);
  svg.appendChild(g);
  add('circle', { cx: ROSE_C, cy: ROSE_C, r: ROSE_RING, fill: SURFACE.ring, stroke: LINE.ring, 'stroke-width': 1.3 });
  add('text', { x: ROSE_C, y: 5.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': FS.meta, 'font-weight': FW.bold, fill: '#c9d1d9', 'font-family': FONT, 'data-gv-upright': `${ROSE_C} 5.5` }, undefined, 'N');
  const at = (r: number, deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${(ROSE_C + r * Math.sin(a)).toFixed(2)} ${(ROSE_C - r * Math.cos(a)).toFixed(2)}`;
  };
  return { svg, g, add, at };
}

/** The small hub at the centre of a round picture: where the unit stands. */
export function roseHub(f: RoseFrame, r = 6): void {
  f.add('circle', { cx: ROSE_C, cy: ROSE_C, r, fill: SURFACE.card, stroke: '#c9d1d9', 'stroke-width': 1.5 });
}

/** A wedge from radius `r0` to `r1` between bearings `a0` and `a1` (degrees clockwise from north), as a path `d`. */
export function wedgePath(r0: number, r1: number, a0: number, a1: number): string {
  const P = (r: number, a: number) => {
    const t = (a * Math.PI) / 180;
    return `${(ROSE_C + r * Math.sin(t)).toFixed(2)} ${(ROSE_C - r * Math.cos(t)).toFixed(2)}`;
  };
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${P(r0, a0)} L${P(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${P(r1, a1)} L${P(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${P(r0, a0)}Z`;
}

/**
 * The one-line key under a round picture (item 12): plain text, or swatches with their words, e.g.
 * `roseKey([['cased', 'MSR'], [ROAD.allWeather, 'all-weather']])`. A swatch is a colour, 'cased' (white MSR on its
 * casing) or 'dash' (a track).
 */
export function roseKey(parts: string | Array<[string, string]>): HTMLElement {
  ensureTokensCss();
  const k = el('div', 'ms-gg-rkey');
  if (typeof parts === 'string') {
    k.textContent = parts;
    return k;
  }
  parts.forEach(([sw, word], i) => {
    if (i) k.append(' · ');
    const s = el('i');
    if (sw === 'cased') s.className = 'ms-cased';
    else if (sw === 'dash') s.className = 'ms-dash';
    else s.style.background = sw;
    k.append(s, word);
  });
  return k;
}
