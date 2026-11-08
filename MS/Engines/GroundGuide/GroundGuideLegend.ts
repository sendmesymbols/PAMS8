/**
 * GroundGuideLegend.ts
 *
 * Two small pieces of orientation for the Ground Guide:
 *  - the Legend. Since 2026-11-06 the docked card is retired: `buildLegend()` builds its pieces for the Ground
 *    Detail's Legend tab (K), and the engine never attaches the card. The class remains for the hint chip and
 *    for hosts that want the docked card back (`show()` still works). It docked bottom-left on the map through the view's own UI so it followed 2D / 3D switches.
 *    It names the mode the ground is judged for and steps between modes (Previous / Next, or a mode's
 *    icon), keys the overlay's four colours on a ramp, lists what counts as NO-GO and SLOW-GO for that
 *    mode, and explains the P and S keys (S lights up while the quick fix can help);
 *  - a one-line hint chip ("pick a symbol to see terrain advice", "this symbol gets no terrain
 *    advice because it is not terrain-bound").
 * Built from DOM nodes and `textContent` only.
 *
 * Visual review (user, 2026-11-08): sizes and colours from GroundGuideTokens.ts (items 17, 18). The overlay key draws
 * the colours it is given at full strength, so a key swatch is the same fill as the bar and the chip (item 1); the
 * NO-GO and SLOW-GO lists are headed by their word in its ladder colour with its icon. Captions are group labels in
 * sentence case, no tracked capitals (item 13). Keycaps share one style; nothing is dimmed by opacity.
 */

import { ACCENT, ensureTokensCss, FONT, FS, FW, LINE, ladderIcon, rgbOf, STEP_TEXT, SURFACE, TEXT, TONE, type Tone } from './GroundGuideTokens';

const STYLE_ID = 'ms-ground-guide-legend-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DETAILS_KEY = 'ms-ground-guide-legend-details';

/** One keycap style for every key the Ground Guide explains (item 17): 20 px tall, 12 px bold. */
const KEYCAP = `display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:4px;
  font:${FW.bold} ${FS.meta}px/1 ${FONT};color:#e8ebee;background:#2b313a;border:1px solid #545e6b;border-bottom-width:2px`;
/** A group label (item 13): 13.5 px semibold over a hairline. */
const GROUP = `font:${FW.semi} ${FS.body}px/1.3 ${FONT};color:${TEXT.main};padding-bottom:4px;border-bottom:1px solid ${LINE.hair};margin-bottom:6px`;

const LEGEND_CSS = `
.ms-ggl{width:290px;max-width:calc(100vw - 24px);box-sizing:border-box;font:${FW.regular} ${FS.meta}px/1.4 ${FONT};color:${TEXT.main};
  background:rgba(27,31,37,.95);border:1px solid #39414b;border-radius:10px;padding:10px 12px 11px;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.ms-ggl button{font:inherit;color:inherit;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:6px;cursor:pointer;padding:0}
.ms-ggl button:hover{background:rgba(255,255,255,.12)}
.ms-ggl button:focus-visible{outline:2px solid ${ACCENT};outline-offset:1px}
.ms-ggl-head{display:flex;align-items:center;gap:8px}
.ms-ggl-title{font-weight:${FW.bold};font-size:${FS.body}px}
.ms-ggl-count{margin-left:auto;font:${FW.regular} ${FS.meta}px/1 ${FONT};color:${TEXT.label}}
.ms-ggl-more{width:22px;height:20px;font-size:${FS.meta}px;line-height:1}
.ms-ggl-strip{display:flex;align-items:stretch;gap:4px;margin-top:9px}
.ms-ggl-strip>button{flex:none;width:24px;min-height:32px;font-size:${FS.value}px}
.ms-ggl-icons{flex:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(26px,1fr));gap:3px}
.ms-ggl-icons button{height:32px;display:flex;align-items:center;justify-content:center;color:${TEXT.label}}
.ms-ggl-icons button[aria-pressed="true"]{color:${SURFACE.card};background:${ACCENT};border-color:${ACCENT}}
.ms-ggl-name{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;margin-top:7px}
.ms-ggl-name b{font-size:${FS.body}px;font-weight:${FW.bold};color:${TEXT.strong}}
.ms-ggl-tag{font-size:${FS.meta}px;color:${TEXT.label}}
.ms-ggl-tag.ms-hand{color:${TEXT.warn}}
.ms-ggl-ramp{display:grid;grid-template-columns:repeat(4,1fr);margin-top:9px;border-radius:4px;overflow:hidden}
.ms-ggl-ramp>i{height:10px}
.ms-ggl-ramp-l{display:grid;grid-template-columns:repeat(4,1fr);gap:0 3px;font-size:${FS.meta}px;color:${TEXT.main};margin-top:4px}
.ms-ggl-ramp-l>span{text-align:center;min-width:0;overflow-wrap:anywhere}
.ms-ggl-ramp-l>span:first-child{text-align:left}
.ms-ggl-ramp-l>span:last-child{text-align:right}
.ms-ggl-note{font-size:${FS.meta}px;color:${TEXT.soft};margin-top:3px}
.ms-ggl-list{display:flex;flex-direction:column;gap:9px;margin-top:9px;padding-top:9px;border-top:1px solid ${LINE.hair};
  max-height:190px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#4a535e transparent}
/* NO-GO / SLOW-GO for the mode: a group label, the word in its ladder colour with its icon. */
.ms-ggl-cap{${GROUP};display:flex;align-items:center;gap:5px}
.ms-ggl-cap>svg{flex:none}
.ms-ggl-chips{display:flex;flex-wrap:wrap;gap:4px}
.ms-ggl-chips>span{font-size:${FS.meta}px;padding:2px 7px;border-radius:4px;background:${SURFACE.head};color:${TEXT.main}}
.ms-ggl-keys{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:9px;padding-top:9px;border-top:1px solid ${LINE.hair}}
/* A key that cannot help right now is dimmed by colour (item 18), never by opacity. */
.ms-ggl-key{display:flex;align-items:center;gap:7px;color:${TEXT.label};transition:color .2s}
.ms-ggl-key.ms-on{color:${TEXT.main}}
.ms-ggl-key small{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:${FS.meta}px;color:${TEXT.label}}
.ms-ggl-kbd{${KEYCAP}}
.ms-ggl-key:not(.ms-on) .ms-ggl-kbd{color:${TEXT.label};background:${SURFACE.strip};border-color:#3d4550}
.ms-ggl-key.ms-lit .ms-ggl-kbd{color:#fff;border-color:${ACCENT};box-shadow:0 0 0 3px rgba(142,193,234,.28)}
.ms-ggl-hint{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:2147482500;display:none;
  max-width:min(90vw,460px);padding:7px 14px;border-radius:999px;background:#242a32;border:1px solid #4a535e;
  box-shadow:0 3px 12px rgba(0,0,0,.4);font:${FW.regular} ${FS.meta}px/1.4 ${FONT};color:${TEXT.main};pointer-events:none}
/* T and Speed captions: a plain group label in sentence case (they were small blue capitals). */
.ms-ggl-tcap{${GROUP};margin-top:9px}
.ms-ggl-season{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:6px}
.ms-ggl-season>button{font-size:${FS.meta}px;padding:4px 0}
.ms-ggl-season>button[aria-pressed="true"]{color:${SURFACE.card};background:${ACCENT};border-color:${ACCENT};font-weight:${FW.semi}}
.ms-ggl-month{display:flex;align-items:center;gap:6px;margin-top:6px}
.ms-ggl-month>button{flex:none;width:24px;height:24px;font-size:${FS.body}px}
.ms-ggl-month>span{flex:1;text-align:center;font-size:${FS.meta}px}
@media (prefers-reduced-motion: reduce){.ms-ggl-key{transition:none}}
`;

/** Words kept capitalised inside a sentence: months, military short forms and key names (the user's wording rules). */
const KEEP_CAPS = new Set([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'Gr', 'Rd', 'Rds', 'Tr', 'Trs', 'Obs', 'Obsn', 'Svcs', 'Bldg', 'Bldgs', 'Dir', 'Dirs', 'Posn', 'Posns',
  'Coy', 'Bn', 'Bde', 'Div', 'Sqn', 'Regt', 'Pl', 'Sec', 'Esc', 'Shift', 'Ctrl', 'Alt',
]);

/**
 * Sentence case for a label that used to be shown in capitals (item 13): the first word as written; later words in
 * plain Title case ("After Rain", "Fair-Weather") lowered; all-capital terms (GO, SLOW-GO, NO-GO, MSR, ITG), single
 * letters, numbers, months and military short forms (Gr, Rd, Dirs …) kept: "Trafficability · Nov, Dry" →
 * "Trafficability · Nov, dry", "Fair-Weather · SLOW-GO After Rain" → "Fair-weather · SLOW-GO after rain". Idempotent.
 */
export function sentenceCase(text: string): string {
  let first = true;
  return text.replace(/[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*/g, (w) => {
    if (first) {
      first = false;
      return w.replace(/-([A-Z])(?=[a-z])/g, (_m, c: string) => `-${c.toLowerCase()}`); // "Fair-Weather" → "Fair-weather"
    }
    if (w.length === 1 || w === w.toUpperCase() || KEEP_CAPS.has(w)) return w;
    return /^[A-Z][a-z'’]+(?:-[A-Za-z][a-z]+)*$/.test(w) ? w.toLowerCase() : w;
  });
}

/** Line icons for the modes, on a 24-unit grid. A mode without one gets a plain dot. */
const MODE_ICONS: Record<string, string[]> = {
  dismounted: ['M15 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M12 8l-2 6', 'M9 11l3-3 3 3 2 0', 'M10 14l-2 7', 'M10 14l3 3v4'],
  wheeled: ['M2 7h11v8H2z', 'M13 10h4l3 3v2h-7', 'M8 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z', 'M18 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'],
  tracked: ['M5 14h14a3 3 0 0 1 0 6H5a3 3 0 0 1 0-6z', 'M8 14l1.5-4h6l1 4', 'M15 11.5h6', 'M7 17h.01', 'M12 17h.01', 'M17 17h.01'],
  vessel: ['M3 14h18l-3 5H6z', 'M8 14V9h6v5', 'M11 9V5'],
  generic: ['M4 20h16', 'M6 20V10l6-4 6 4v10', 'M10 20v-5h4v5'],
  gun: ['M8 16L20 7', 'M8 16l-5 4', 'M11 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
  ad: ['M5 20h14', 'M9 20l2-5h2l2 5', 'M12 15V5', 'M10 7l2-3 2 3'],
  hls: ['M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z', 'M9 8v8', 'M15 8v8', 'M9 12h6'],
  signals: ['M12 21V10', 'M9 21h6', 'M8.5 7.5a5 5 0 0 1 7 0', 'M6 5a8.5 8.5 0 0 1 12 0', 'M12 10h.01'],
  amphibious: ['M4 11h12l3 3H4z', 'M7 11V8h5v3', 'M3 18c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0'],
  pack: ['M2 20l7-12 4 6 3-4 6 10z'],
  oversnow: ['M12 3v18', 'M4.2 7.5l15.6 9', 'M4.2 16.5l15.6-9'],
  roadbound: ['M7 21L10 3', 'M17 21L14 3', 'M12 6v2', 'M12 11v2', 'M12 16v3'],
  rail: ['M8 3L6 21', 'M16 3l2 18', 'M6.8 7h10.4', 'M6.4 11h11.2', 'M6 15h12', 'M5.6 19h12.8'],
  _: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
};

export interface LegendEntry {
  label: string;
  /** RGBA as the overlay paints it. */
  rgba: readonly number[];
  /** Its step on the verdict ladder, when known (a Part NO-GO key is hatched); else found from the colour. */
  tone?: Tone;
}

export interface LegendMode {
  key: string;
  label: string;
}

/** Everything the legend shows; rebuilt only when the mode or the options change, not on every cursor move. */
export interface LegendState {
  /** The modes Previous / Next step through, in order. */
  modes: LegendMode[];
  /** Key of the mode shown. */
  current: string;
  /** How the mode was chosen ("Auto · From Symbol", "Set by Hand", …); empty for none. */
  tag: string;
  /** The mode was picked by hand (the tag is drawn as a warning). */
  hand: boolean;
  /** The overlay's colours, from good to bad. */
  entries: LegendEntry[];
  /** A line under the ramp (what "Marginal" means). */
  note: string;
  /** Terrain the mode cannot use / is slowed by. */
  nogo: string[];
  slow: string[];
  /** Whether to explain the keys at all (off for touch, or when both keys are switched off). */
  keys: { profile: boolean; snap: boolean } | null;
  /**
   * T (Trafficability): a caption over the ramp ("T · Trafficability · Dry Season"), and optionally a Dry / After Rain
   * switch (`season`) or a month stepper (`month`, its label). Absent: the legend is as before.
   */
  traffic?: { caption: string; season?: 'dry' | 'wet'; month?: string };
  /** T, Speed: a caption ("Speed · Foot · Day") and a Day / Night switch (`groundGuide.speed.legend`). */
  speed?: { caption: string; light: 'day' | 'night' };
}

export interface LegendHandlers {
  /** Previous (-1) / Next (+1). */
  step(dir: 1 | -1): void;
  /** A mode's icon was clicked. */
  pick(key: string): void;
  /** T: the Dry / After Rain switch was used. */
  season?(season: 'dry' | 'wet'): void;
  /** T: the month stepper, previous (-1) / next (+1). */
  month?(dir: 1 | -1): void;
  /** Speed: the Day / Night switch was used. */
  light?(light: 'day' | 'night'): void;
}

export function ensureLegendStyle(): void {
  ensureTokensCss();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = LEGEND_CSS;
  document.head.appendChild(style);
}

export function legendEl<K extends keyof HTMLElementTagNameMap = 'div'>(cls: string, text?: string, tag?: K): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag ?? 'div') as HTMLElementTagNameMap[K];
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function legendButton(cls: string, label: string, text?: string): HTMLButtonElement {
  const b = legendEl(cls, text, 'button');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

export function modeIcon(key: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [['width', '19'], ['height', '19'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'],
    ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) {
    svg.setAttribute(k, v);
  }
  for (const d of MODE_ICONS[key] ?? MODE_ICONS._) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/**
 * The overlay is drawn over imagery at partial strength; the key draws the colour it is given at full strength, so
 * each swatch is the very fill the bar, chip and gauge use for that step (item 1). The alpha is the overlay's own.
 */
function swatch(rgba: readonly number[]): string {
  const [r, g, b] = rgba;
  return `rgb(${r},${g},${b})`;
}

/** The ladder step an overlay key stands for: as given, else the tone whose fill is this colour. */
function entryTone(e: LegendEntry): Tone | null {
  if (e.tone) return e.tone;
  const [r, g, b] = e.rgba;
  for (const t of Object.keys(TONE) as Tone[]) {
    const [tr, tg, tb] = rgbOf(TONE[t].fill);
    if (tr === r && tg === g && tb === b) return t;
  }
  return null;
}

/** "Marginal: Within 250 m of NO-GO" → "Marginal: GO Gr within 250 m of NO-GO" (what Marginal means, item 1). */
function legendNote(note: string): string {
  const m = /^([^:]+):\s*within\s+(.+?)\s+of\s+(.+)$/i.exec(note.trim());
  if (!m || /\bGO Gr\b/.test(note)) return note;
  return `${m[1]}: GO Gr within ${m[2]} of ${m[3]}`;
}

/** A T or Speed caption as a group label: the GROTBC letter in front dropped, sentence case (item 13). */
function captionText(caption: string): string {
  return sentenceCase(caption.replace(/^[A-Z]\s*·\s*/, ''));
}

function readDetailsOpen(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) !== '0';
  } catch {
    return true;
  }
}

/** The legend's pieces, built once from a state; the docked card stacks them, the Detail card's Legend tab lays them out sideways. */
export interface LegendPieces {
  /** Previous / icon grid / Next, when there is more than one mode. */
  strip: HTMLElement | null;
  /** The mode's name and how it was chosen. */
  name: HTMLElement;
  /** T caption and its season switch or month stepper. */
  traffic: HTMLElement[];
  /** Speed caption and the Day / Night switch. */
  speed: HTMLElement[];
  ramp: HTMLElement;
  labels: HTMLElement;
  note: HTMLElement | null;
  /** NO-GO and SLOW-GO chip lists (always built; the docked card shows it only when its details are open). */
  list: HTMLElement | null;
  /** The P and S key rows, or null when the keys are not explained. */
  keys: HTMLElement | null;
  keyP: HTMLElement | null;
  keyS: HTMLElement | null;
}

/** A key row as the legend draws it: a keycap, a label and an optional second line. */
export function legendKeyRow(k: string, label: string, sub?: string): HTMLElement {
  const row = legendEl('ms-ggl-key ms-on');
  const text = legendEl('', label);
  if (sub) text.appendChild(legendEl('', sub, 'small'));
  row.append(legendEl('ms-ggl-kbd', k, 'span'), text);
  return row;
}

export function buildLegend(s: LegendState, handlers: LegendHandlers): LegendPieces {
  ensureLegendStyle();
  const idx = Math.max(0, s.modes.findIndex((m) => m.key === s.current));
  const mode = s.modes[idx] ?? { key: s.current, label: s.current };

  let strip: HTMLElement | null = null;
  if (s.modes.length > 1) {
    strip = legendEl('ms-ggl-strip');
    const prev = legendButton('', 'Previous mode', '‹');
    const next = legendButton('', 'Next mode', '›');
    prev.dataset.plFocus = 'prev';
    next.dataset.plFocus = 'next';
    prev.onclick = () => handlers.step(-1);
    next.onclick = () => handlers.step(1);
    const icons = legendEl('ms-ggl-icons');
    icons.setAttribute('role', 'group');
    icons.setAttribute('aria-label', 'Modes');
    for (const m of s.modes) {
      const b = legendButton('', m.label);
      b.setAttribute('aria-pressed', String(m.key === mode.key));
      b.dataset.plFocus = `mode:${m.key}`;
      b.appendChild(modeIcon(m.key));
      b.onclick = () => handlers.pick(m.key);
      icons.appendChild(b);
    }
    strip.append(prev, icons, next);
  }

  const name = legendEl('ms-ggl-name');
  name.append(legendEl('', mode.label, 'b'));
  if (s.tag) name.append(legendEl(s.hand ? 'ms-ggl-tag ms-hand' : 'ms-ggl-tag', s.tag, 'span'));

  const traffic: HTMLElement[] = [];
  if (s.traffic) {
    traffic.push(legendEl('ms-ggl-tcap', captionText(s.traffic.caption)));
    if (s.traffic.season) {
      const sw = legendEl('ms-ggl-season');
      sw.setAttribute('role', 'group');
      sw.setAttribute('aria-label', 'Season');
      for (const [key, text] of [['dry', 'Dry'], ['wet', 'After Rain']] as const) {
        const b = legendButton('', `Going ${text === 'Dry' ? 'in the dry season' : 'after rain'}`, text);
        b.setAttribute('aria-pressed', String(s.traffic.season === key));
        b.dataset.plFocus = `season:${key}`;
        b.onclick = () => handlers.season?.(key);
        sw.appendChild(b);
      }
      traffic.push(sw);
    }
    if (s.traffic.month) {
      const row = legendEl('ms-ggl-month');
      const prev = legendButton('', 'Previous month', '‹');
      const next = legendButton('', 'Next month', '›');
      prev.dataset.plFocus = 'month-prev';
      next.dataset.plFocus = 'month-next';
      prev.onclick = () => handlers.month?.(-1);
      next.onclick = () => handlers.month?.(1);
      row.append(prev, legendEl('', s.traffic.month, 'span'), next);
      traffic.push(row);
    }
  }
  const speed: HTMLElement[] = [];
  if (s.speed) {
    speed.push(legendEl('ms-ggl-tcap', captionText(s.speed.caption)));
    const sw = legendEl('ms-ggl-season');
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'Speed by day or night');
    for (const [key, text] of [['day', 'Day'], ['night', 'Night']] as const) {
      const b = legendButton('', `Speed ${key === 'day' ? 'by day' : 'by night (blackout / night vision)'}`, text);
      b.setAttribute('aria-pressed', String(s.speed.light === key));
      b.dataset.plFocus = `light:${key}`;
      b.onclick = () => handlers.light?.(key);
      sw.appendChild(b);
    }
    speed.push(sw);
  }

  const ramp = legendEl('ms-ggl-ramp');
  const labels = legendEl('ms-ggl-ramp-l');
  ramp.style.gridTemplateColumns = `repeat(${Math.max(1, s.entries.length)},1fr)`;
  labels.style.gridTemplateColumns = ramp.style.gridTemplateColumns;
  for (const e of s.entries) {
    const tone = entryTone(e);
    const i = legendEl(tone && TONE[tone].hatch ? 'ms-gg-hatch' : '', undefined, 'i');
    i.style.backgroundColor = swatch(e.rgba);
    ramp.appendChild(i);
    labels.appendChild(legendEl('', e.label, 'span'));
  }
  const note = s.note ? legendEl('ms-ggl-note', legendNote(s.note)) : null;

  let list: HTMLElement | null = null;
  if (s.nogo.length || s.slow.length) {
    list = legendEl('ms-ggl-list');
    const group = (caption: string, tone: 'nogo' | 'slow', items: string[]) => {
      if (!items.length) return;
      const g = legendEl('');
      const cap = legendEl('ms-ggl-cap');
      cap.style.color = STEP_TEXT[tone];
      cap.append(ladderIcon(TONE[tone].icon, 15), caption);
      const chips = legendEl('ms-ggl-chips');
      for (const t of items) chips.appendChild(legendEl('', t, 'span'));
      g.append(cap, chips);
      list!.appendChild(g);
    };
    group(`NO-GO for ${mode.label}`, 'nogo', s.nogo);
    group('SLOW-GO', 'slow', s.slow);
  }

  let keys: HTMLElement | null = null;
  let keyP: HTMLElement | null = null;
  let keyS: HTMLElement | null = null;
  if (s.keys) {
    keys = legendEl('ms-ggl-keys');
    const key = (k: string, label: string, sub?: string) => {
      const row = legendKeyRow(k, label, sub);
      row.classList.remove('ms-on');
      keys!.appendChild(row);
      return row;
    };
    if (s.keys.profile) keyP = key('P', 'Change mode');
    if (s.keys.snap) keyS = key('S', 'Quick fix', 'Moves it to the nearest usable Gr');
    if (!keys.childElementCount) keys = null;
  }
  return { strip, name, traffic, speed, ramp, labels, note, list, keys, keyP, keyS };
}

export class GroundGuideLegend {
  private _card: HTMLDivElement | null = null;
  private _view: any = null;
  private _attached = false;
  /** Held back (not on the map) while the Ground Detail shows the same legend in its Legend tab. */
  private _suppressed = false;
  private _keyP: HTMLElement | null = null;
  private _keyS: HTMLElement | null = null;
  private _detailsOpen = readDetailsOpen();
  private _state: LegendState | null = null;
  private _pOn = false;
  private _sOn = false;
  private _hint: HTMLDivElement | null = null;
  private _hintKind = '';
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly _handlers: LegendHandlers) {}

  /** Show (or update) the legend on this view; moves it when the view has changed. */
  show(view: any, state: LegendState): void {
    ensureLegendStyle();
    this._state = state;
    if (!this._card) {
      this._card = legendEl('ms-ggl');
      this._card.setAttribute('role', 'group');
      this._card.setAttribute('aria-label', 'Legend');
      // Clicks on the legend must never reach a draw tool listening on the map.
      for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick']) this._card.addEventListener(t, (e) => e.stopPropagation());
    }
    this._render(state);
    if (this._view !== view) {
      this._detach();
      this._view = view;
    }
    if (!this._suppressed && !this._attached) this._attach();
  }

  /** The last state shown (the Detail card's Legend tab reads it). */
  get state(): LegendState | null {
    return this._state;
  }

  /** Hold the docked card back (the Ground Detail is showing the legend), or put it back on the map. */
  setSuppressed(on: boolean): void {
    if (on === this._suppressed) return;
    this._suppressed = on;
    if (on) this._detach();
    else if (this._view && this._card) this._attach();
  }

  /** Light the keys that work right now: P while a draw can change mode, S while the quick fix can help. Cheap; call per verdict. */
  setKeys(profile: boolean, snap: boolean): void {
    this._pOn = profile;
    this._sOn = snap;
    this._keyP?.classList.toggle('ms-on', profile);
    this._keyS?.classList.toggle('ms-on', snap);
    this._keyS?.classList.toggle('ms-lit', snap);
  }

  hide(): void {
    this._detach();
    this._view = null;
  }

  /** A one-line chip at the bottom of the screen. `kind` lets the caller take back only its own hint. */
  hint(text: string, kind: string, ms = 5000): void {
    ensureLegendStyle();
    if (!this._hint) {
      this._hint = legendEl('ms-ggl-hint');
      this._hint.setAttribute('role', 'status');
      document.body.appendChild(this._hint);
    }
    this._hint.textContent = text;
    this._hint.style.display = 'block';
    this._hintKind = kind;
    if (this._hintTimer !== null) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.hideHint(), ms);
  }

  /** Hide the hint; with `kind`, only if it is that hint. */
  hideHint(kind?: string): void {
    if (kind !== undefined && kind !== this._hintKind) return;
    if (this._hintTimer !== null) clearTimeout(this._hintTimer);
    this._hintTimer = null;
    this._hintKind = '';
    if (this._hint) this._hint.style.display = 'none';
  }

  destroy(): void {
    this.hide();
    this.hideHint();
    this._hint?.remove();
    this._hint = null;
    this._card = null;
    this._keyP = this._keyS = null;
    this._state = null;
  }

  private _render(s: LegendState): void {
    const card = this._card!;
    const idx = Math.max(0, s.modes.findIndex((m) => m.key === s.current));
    // Rebuilding moves focus out of the card; put it back on the same control so keyboard users keep their place.
    const focused = card.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.plFocus : undefined;

    const head = legendEl('ms-ggl-head');
    const more = legendButton('ms-ggl-more', this._detailsOpen ? 'Hide terrain lists' : 'Show terrain lists', this._detailsOpen ? '▾' : '▸');
    more.setAttribute('aria-expanded', String(this._detailsOpen));
    more.dataset.plFocus = 'more';
    more.onclick = () => {
      this._detailsOpen = !this._detailsOpen;
      try {
        localStorage.setItem(DETAILS_KEY, this._detailsOpen ? '1' : '0');
      } catch {
        /* storage blocked: the choice lasts for this page */
      }
      if (this._state) this._render(this._state);
    };
    head.append(legendEl('ms-ggl-title', 'Legend'), legendEl('ms-ggl-count', s.modes.length > 1 ? `Mode ${idx + 1} / ${s.modes.length}` : ''), more);

    const p = buildLegend(s, this._handlers);
    const parts: HTMLElement[] = [head];
    if (p.strip) parts.push(p.strip);
    parts.push(p.name, ...p.traffic, ...p.speed, p.ramp, p.labels);
    if (p.note) parts.push(p.note);
    if (this._detailsOpen && p.list) parts.push(p.list);
    this._keyP = p.keyP;
    this._keyS = p.keyS;
    if (p.keys) parts.push(p.keys);

    card.replaceChildren(...parts);
    this.setKeys(this._pOn, this._sOn);
    if (focused) (card.querySelector(`[data-pl-focus="${CSS.escape(focused)}"]`) as HTMLElement | null)?.focus();
  }

  private _attach(): void {
    if (!this._card || !this._view) return;
    try {
      this._view.ui.add(this._card, { position: 'bottom-left', index: 0 });
    } catch {
      // no view UI (headless host): float it instead
      this._card.style.cssText = 'position:fixed;left:12px;bottom:40px;z-index:2147482400';
      document.body.appendChild(this._card);
    }
    this._attached = true;
  }

  private _detach(): void {
    if (!this._card) return;
    try {
      this._view?.ui?.remove(this._card);
    } catch {
      /* view already torn down */
    }
    this._card.remove();
    this._attached = false;
  }
}
