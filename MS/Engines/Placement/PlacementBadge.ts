/**
 * PlacementBadge.ts
 *
 * The small cursor-following card the Placement Advisor shows while drawing.
 * A coloured header gives the verdict (how much of the shape is inside bad
 * ground, and an S keycap when the quick fix can help); sections underneath, on
 * alternating bands and captioned in the verdict colour, say why (with a GO /
 * SLOW-GO / NO-GO scale), how much, what is nearest, whether the echelon's
 * intermediate gap rule holds and which Important Tactical Ground candidates lie
 * round it. Enforce mode closes the card with a red strip.
 * The unit type and the P / S keys live in the legend. Built from DOM nodes and
 * `textContent` only, so class names and unit labels can never inject markup.
 *
 * Position updates are direct style writes from a passive pointermove listener.
 * The card's size is measured once per show(), so following the cursor costs no
 * layout reads and the card can flip to stay on screen.
 */

import { fmtDistance, titleCase } from './PlacementEvaluator';
import type { PlacementVerdict } from './PlacementTypes';

const STYLE_ID = 'ms-placement-badge-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const EDGE = 8;
/** How long the cursor must rest on a verdict before it is read out to a screen reader. */
const SPEAK_DELAY_MS = 500;
/** Gap between a fingertip and the card above it. */
const TOUCH_GAP = 28;

const CSS = `
.ms-placement-badge{position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;
  --pb-c:#5b6470;--pb-fg:#fff;--pb-k:#aab3bd;width:280px;max-width:calc(100vw - 8px);box-sizing:border-box;border-radius:10px;overflow:hidden;
  font:400 12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;
  background:#1b1f25;border:1.5px solid var(--pb-c);box-shadow:0 4px 14px rgba(0,0,0,.4);display:none}
.ms-placement-badge[data-verdict="ok"]{--pb-c:#1c8247;--pb-k:#3fc07a}
.ms-placement-badge[data-verdict="near"]{--pb-c:#e9a526;--pb-fg:#1b1f25;--pb-k:#f2b84b}
.ms-placement-badge[data-verdict="caution"]{--pb-c:#e08a1e;--pb-fg:#1b1f25;--pb-k:#f0a04b}
.ms-placement-badge[data-verdict="partial"]{--pb-c:#d9622b;--pb-fg:#1b1f25;--pb-k:#ef7d4a}
.ms-placement-badge[data-verdict="in"]{--pb-c:#d63a3f;--pb-k:#ff6b6f}
.ms-pb-bar{display:flex;flex-wrap:wrap;align-items:center;gap:4px 7px;padding:6px 11px;background:var(--pb-c);color:var(--pb-fg);font-weight:600;font-size:13px}
.ms-pb-bar>svg{flex:none}
.ms-pb-title{flex:1 1 0;min-width:0}
.ms-pb-pills{display:flex;gap:4px;margin-left:auto}
.ms-pb-pct,.ms-pb-fix{display:flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,.2);font-size:11.5px;white-space:nowrap}
.ms-pb-fix{padding-left:2px}
.ms-placement-badge[data-verdict="near"] .ms-pb-pills>span,.ms-placement-badge[data-verdict="caution"] .ms-pb-pills>span,.ms-placement-badge[data-verdict="partial"] .ms-pb-pills>span{background:rgba(0,0,0,.12)}
.ms-pb-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;border-radius:4px;
  font:700 10px/1 ui-monospace,Consolas,monospace;color:#fff;background:linear-gradient(#3f8f5b,#2b6b42);border:1px solid #5fc183;border-bottom-width:2px}
.ms-pb-sr{position:fixed;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.ms-pb-body{padding:6px 11px 8px}
.ms-pb-sec{padding:7px 11px 8px}
.ms-pb-sec:nth-child(even){background:#222830}
.ms-pb-cap{font:700 10px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--pb-k);margin-bottom:5px}
.ms-pb-b{font-weight:600;color:#fff}
.ms-pb-scale{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:6px}
.ms-pb-scale>span{font:700 9.5px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;text-align:center;padding:4px 0 3px;border-radius:2px;background:rgba(255,255,255,.06);color:#6b737c}
.ms-pb-scale>.ms-on-go{background:#2fa862;color:#fff}
.ms-pb-scale>.ms-on-slow{background:#f0932b;color:#1b1f25}
.ms-pb-scale>.ms-on-nogo{background:#e5484d;color:#fff}
.ms-pb-nr{display:flex;gap:10px;align-items:center}
.ms-pb-big{font-size:18px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;line-height:1.15}
.ms-pb-track{height:6px;margin:4px 0 2px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden}
.ms-pb-track>div{height:100%}
.ms-pb-enf{display:flex;gap:7px;align-items:flex-start;padding:7px 11px;background:rgba(229,72,77,.14);border-top:1px solid rgba(229,72,77,.45);color:#ffb3b5}
.ms-pb-enf>svg{flex:none;margin-top:1px;color:#e5484d}
.ms-pb-warn{color:#ffc861}
.ms-pb-soft{color:#9aa3ad;font-size:11px;padding-top:2px}
.ms-pb-itg+.ms-pb-itg{margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}
.ms-pb-strong{color:#f2b84b;font-weight:600}
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
const GOING: Partial<Record<PlacementVerdict['verdict'], 'go' | 'slow' | 'nogo'>> = {
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

/** `plain()` for other Placement UI (the legend's terrain lists), so a class reads the same everywhere. */
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

/**
 * A small compass for the view as it is on screen. `northDeg` is where north points on screen (clockwise from up):
 * the ring turns to it, with N kept upright, and the needle points `bearingDeg` (clockwise from north) from there,
 * so it still points at the feature when the map is rotated.
 */
function dial(bearingDeg: number, color: string, northDeg: number): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '44');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('aria-hidden', 'true'); // the row's text already gives the distance and compass point
  svg.dataset.pbDial = String(Math.round(bearingDeg));
  const add = (parent: Element, tag: string, attrs: Record<string, string>, text?: string): SVGElement => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    parent.appendChild(e);
    return e as SVGElement;
  };
  const ring = add(svg, 'g', { 'data-pb-ring': '' });
  add(ring, 'circle', { cx: '22', cy: '22', r: '20.5', fill: 'rgba(255,255,255,.06)', stroke: 'rgba(255,255,255,.3)', 'stroke-width': '1.5' });
  add(ring, 'text', { x: '22', y: '12', 'text-anchor': 'middle', 'font-size': '11', fill: '#9aa3ad', 'font-family': 'system-ui,Segoe UI,Arial,sans-serif', 'data-pb-n': '' }, 'N');
  for (const [x1, y1, x2, y2] of [[41.5, 22, 37.5, 22], [22, 41.5, 22, 37.5], [2.5, 22, 6.5, 22]]) {
    add(ring, 'line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), stroke: '#9aa3ad', 'stroke-width': '1.5' });
  }
  add(svg, 'polygon', {
    points: '22,14 27.5,30 22,26 16.5,30',
    fill: color,
    stroke: color,
    'stroke-width': '1.5',
    'stroke-linejoin': 'round',
    'data-pb-needle': '',
  });
  orientDial(svg, northDeg);
  return svg;
}

/** Turn an existing dial to a new on-screen north, without rebuilding it. */
function orientDial(svg: SVGElement, northDeg: number): void {
  const north = Math.round(northDeg);
  const bearing = Number(svg.dataset.pbDial) || 0;
  svg.querySelector('[data-pb-ring]')?.setAttribute('transform', `rotate(${north} 22 22)`);
  svg.querySelector('[data-pb-n]')?.setAttribute('transform', `rotate(${-north} 22 8)`); // keep the letter upright, turning about its own centre so it stays on the north line
  svg.querySelector('[data-pb-needle]')?.setAttribute('transform', `rotate(${north + bearing} 22 22)`);
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function track(fraction: number, color: string): HTMLElement {
  const t = el('div', 'ms-pb-track');
  const f = el('div');
  f.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  f.style.background = color;
  t.appendChild(f);
  return t;
}

/** One band of the card: a caption in the verdict colour over its content. */
function section(caption: string, ...content: Array<Node | string>): HTMLElement {
  const s = el('div', 'ms-pb-sec');
  s.append(el('div', 'ms-pb-cap', caption), ...content);
  return s;
}

/** GO / SLOW-GO / NO-GO with the verdict's own step lit. */
function goingScale(step: 'go' | 'slow' | 'nogo'): HTMLElement {
  const s = el('div', 'ms-pb-scale');
  for (const [k, text] of [['go', 'GO'], ['slow', 'SLOW-GO'], ['nogo', 'NO-GO']] as const) {
    s.appendChild(el('span', k === step ? `ms-on-${k}` : undefined, text));
  }
  return s;
}

/** A keyboard key as drawn on the card. */
function keycap(key: string): HTMLElement {
  return el('span', 'ms-pb-kbd', key);
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

function titleOf(v: PlacementVerdict): string {
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

function iconOf(v: PlacementVerdict): string {
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
function spokenFor(v: PlacementVerdict): string {
  const parts = [titleOf(v)];
  if (v.verdict !== 'unknown' && v.verdict !== 'ok' && v.message) parts.push(v.message);
  if (v.snappable) parts.push('Press S to move it to the nearest usable ground');
  if (v.blocked) parts.push(v.overridable ? 'A click here is refused. Hold Shift and click to place it anyway' : 'A click here is refused');
  return parts.map((p) => p.replace(/[.\s]+$/, '')).join('. ') + '.';
}

/** Why: the ground that decides the verdict, for which unit type, and where that sits on the going scale. */
function whySection(v: PlacementVerdict): HTMLElement | null {
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
  const line = el('div');
  line.append(el('span', 'ms-pb-b', titleCase(name)), ` · ${v.profileLabel}`);
  const s = section('Why', line);
  if (v.reason) s.append(el('div', 'ms-pb-soft', v.reason)); // the rule owner's own words, when the bundle gives them
  s.append(goingScale(step));
  return s;
}

function insideSection(v: PlacementVerdict, pct: number): HTMLElement {
  return section('Inside', track(pct / 100, verdictColor(v)), `${pct}% of the ${v.footprint ? 'Footprint' : 'Shape'}`);
}

/** Header colour, for the bar and arrow that echo it; keep in step with the CSS above. */
function verdictColor(v: PlacementVerdict): string {
  switch (v.verdict) {
    case 'ok': return '#1c8247';
    case 'near': return '#e9a526';
    case 'caution': return '#e08a1e';
    case 'partial': return '#d9622b';
    case 'in': return '#d63a3f';
    default: return '#5b6470';
  }
}

function nearestSection(v: PlacementVerdict, northDeg: number): HTMLElement | null {
  const n = v.nearest;
  if (n) {
    // The dial points at the ground; the text names it and says how far.
    const text = el('div');
    const far = el('div');
    far.append(el('span', 'ms-pb-big', fmtDistance(n.distanceM)), ` ${n.compass}`);
    text.append(el('div', 'ms-pb-b', featureTitle(n.className)), far);
    const nr = el('div', 'ms-pb-nr');
    nr.append(dial(n.bearingDeg, verdictColor(v), northDeg), text);
    return section('Nearest', nr);
  }
  const label = v.verdict === 'in' ? 'Suitable Ground' : 'NO-GO Ground';
  if (v.noneWithinM) return section('Nearest', el('div', 'ms-pb-b', label), `Nothing within ${fmtDistance(v.noneWithinM)}`);
  if ((v.verdict === 'ok' || v.verdict === 'caution') && v.distanceM !== null) {
    return section('Nearest', el('div', 'ms-pb-b', label), `${fmtDistance(v.distanceM)} away`);
  }
  return null;
}

/**
 * G · Important Tactical Ground: the candidates round the point, strongest first. The bundle only proposes them;
 * the user designates ITG / MITG, so the wording stays "Candidate".
 */
function groundSection(v: PlacementVerdict): HTMLElement | null {
  const g = v.ground;
  if (!g) return null;
  const rows: Array<Node | string> = [];
  for (const c of g.candidates) {
    const what = `${c.kindLabel}${c.elevationM !== null ? ` ${c.elevationM.toLocaleString('en')} m` : ''}`;
    const head = el('div');
    head.append(el('span', 'ms-pb-b', titleCase(c.name ?? what)), c.name ? ` · ${what}` : '');
    const where = el('div');
    where.append(
      el('span', c.level === 2 ? 'ms-pb-strong' : undefined, c.level === 2 ? 'Strong Candidate (Check as MITG)' : 'ITG Candidate'),
      ` · ${fmtDistance(c.distanceM)} ${c.compass}`,
    );
    const item = el('div', 'ms-pb-itg');
    item.append(head, where, el('div', 'ms-pb-soft', c.reasonLabels.map(titleCase).join(' · ')));
    rows.push(item);
  }
  if (!rows.length) {
    rows.push(el('span', 'ms-pb-soft', g.pending ? 'Loading ground features' : `None within ${fmtDistance(g.radiusM)}`));
  }
  return section('Important Tactical Ground', ...rows);
}

/** Enforce mode: this click would be refused, and whether Shift gets past it. A red strip that closes the card. */
function enforceStrip(v: PlacementVerdict): HTMLElement | null {
  if (!v.blocked) return null;
  const text = v.overridable ? 'A click here is refused. Hold Shift and click to place it anyway.' : 'A click here is refused.';
  const body = el('div');
  body.append(el('span', 'ms-pb-b', 'Enforce Mode: '), text);
  const strip = el('div', 'ms-pb-enf');
  strip.append(icon('octagon', 14), body);
  return strip;
}

/** The echelon's minimum gap to the next same-echelon unit. Advisory, so it never changes the title. */
function spacingSection(v: PlacementVerdict): HTMLElement | null {
  const s = v.spacing;
  if (!s) return null;
  const echelon = v.footprint?.echelon ?? 'unit';
  const colour = SPACING_COLOR[s.status];
  if (s.nearestGapM === null) return section('Intermediate Gap Rule', el('span', 'ms-pb-soft', `No other ${echelon} nearby`));
  const text = el(
    'span',
    s.status !== 'ok' ? 'ms-pb-warn' : undefined,
    s.status === 'overlap'
      ? `Overlaps the next ${echelon}`
      : `${fmtDistance(s.nearestGapM)} of ${fmtDistance(s.minGapM)} to the next ${echelon}`,
  );
  return section('Intermediate Gap Rule', track(s.nearestGapM / s.minGapM, colour), text);
}

export class PlacementBadge {
  private _el: HTMLDivElement | null = null;
  private _bar: HTMLDivElement | null = null;
  private _body: HTMLDivElement | null = null;
  private _x = 0;
  private _y = 0;
  private _w = 280;
  private _h = 120;
  private _hasPointer = false;
  private _touch = false;
  private _last: PlacementVerdict | null = null;
  private _north = 0; // where north points on screen, degrees clockwise from up
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
  toast(t: { verdict: PlacementVerdict['verdict']; title: string; lines: string[]; hint?: string }, ms = 5000): void {
    this._ensure();
    if (!this._toastEl) {
      const root = el('div', 'ms-placement-badge') as HTMLDivElement;
      this._toastBar = el('div', 'ms-pb-bar') as HTMLDivElement;
      this._toastBody = el('div', 'ms-pb-body') as HTMLDivElement;
      root.append(this._toastBar, this._toastBody);
      document.body.appendChild(root);
      this._toastEl = root;
    }
    const root = this._toastEl;
    root.dataset.verdict = t.verdict;
    // A refusal interrupts (alert); "advisor ready", "loading", "not terrain-bound" wait their turn (status).
    root.setAttribute('role', t.verdict === 'in' || t.verdict === 'partial' ? 'alert' : 'status');
    this._toastBar!.replaceChildren(icon('x', 17), el('span', undefined, t.title));
    const rows = t.lines.map((l) => el('div', undefined, l));
    if (t.hint) rows.push(el('div', 'ms-pb-soft', t.hint));
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

  /** The map was rotated: `northDeg` is where north now points on screen. Turns the dial in place; the card is not rebuilt. */
  setNorth(northDeg: number): void {
    if (northDeg === this._north) return;
    this._north = northDeg;
    const d = this._el?.querySelector('[data-pb-dial]');
    if (d) orientDial(d as SVGElement, northDeg);
  }

  show(v: PlacementVerdict): void {
    this._last = v;
    if (this._toastEl && this._toastEl.style.display !== 'none') this.dismissToast();
    const el0 = this._ensure();
    el0.dataset.verdict = v.verdict;

    const bar = this._bar!;
    bar.replaceChildren(icon(iconOf(v), 17), el('span', 'ms-pb-title', titleOf(v)));
    const pct = v.samples > 1 && v.fraction > 0 ? Math.max(1, Math.round(v.fraction * 100)) : 0;
    const pills = el('div', 'ms-pb-pills');
    if (pct > 0) pills.appendChild(el('span', 'ms-pb-pct', `${pct}% Inside`));
    if (v.snappable) {
      // S moves the point to the nearest usable ground; the legend explains the key, the card only cues it.
      const fix = el('span', 'ms-pb-fix');
      fix.append(keycap('S'), 'Quick Fix');
      pills.appendChild(fix);
    }
    if (pills.childElementCount) bar.appendChild(pills);

    const rows =
      v.verdict === 'unknown'
        ? []
        : [whySection(v), pct > 0 ? insideSection(v, pct) : null, nearestSection(v, this._north), spacingSection(v), groundSection(v)].filter(
            (r): r is HTMLElement => r !== null,
          );
    if (v.loading) rows.push(el('div', 'ms-pb-sec ms-pb-soft', 'Still loading terrain data'));
    if (this._notice) rows.push(el('div', 'ms-pb-sec ms-pb-warn', this._notice));
    const strip = v.verdict === 'unknown' ? null : enforceStrip(v);
    if (strip) rows.push(strip);
    const body = this._body!;
    body.replaceChildren(...rows);
    body.style.display = rows.length ? 'block' : 'none';
    this._say(spokenFor(v));

    if (!this._hasPointer) {
      this._x = Math.round(window.innerWidth / 2);
      this._y = 90;
    }
    el0.style.display = 'block';
    this._w = el0.offsetWidth;
    this._h = el0.offsetHeight;
    this._place();
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
    root.className = 'ms-placement-badge';
    // The card follows the cursor and is rebuilt as it moves, so it is not a live region itself (that would
    // read the whole card out again on every change); a screen reader gets a short sentence from `_live`.
    root.setAttribute('aria-hidden', 'true');
    const live = el('div', 'ms-pb-sr') as HTMLDivElement;
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    document.body.appendChild(live);
    this._live = live;
    const bar = el('div', 'ms-pb-bar') as HTMLDivElement;
    const body = el('div') as HTMLDivElement; // its sections carry their own padding and bands
    root.append(bar, body);
    document.body.appendChild(root);
    this._el = root;
    this._bar = bar;
    this._body = body;
    return root;
  }
}
