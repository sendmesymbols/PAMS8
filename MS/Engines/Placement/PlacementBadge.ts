/**
 * PlacementBadge.ts
 *
 * The small cursor-following card the Placement Advisor shows while drawing.
 * A coloured header gives the verdict (and how much of the shape is inside bad
 * ground); labelled rows underneath say why, how much, what is nearest and
 * whether the echelon's spacing rule holds. Built from DOM nodes and
 * `textContent` only, so class names and unit labels can never inject markup.
 *
 * Position updates are direct style writes from a passive pointermove listener.
 * The card's size is measured once per show(), so following the cursor costs no
 * layout reads and the card can flip to stay on screen.
 */

import { fmtDistance } from './PlacementEvaluator';
import type { PlacementVerdict } from './PlacementTypes';

const STYLE_ID = 'ms-placement-badge-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const EDGE = 8;

const CSS = `
.ms-placement-badge{position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;
  --pb-c:#5b6470;--pb-fg:#fff;width:280px;border-radius:10px;overflow:hidden;
  font:400 12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;
  background:#1b1f25;border:1.5px solid var(--pb-c);box-shadow:0 4px 14px rgba(0,0,0,.4);display:none}
.ms-placement-badge[data-verdict="ok"]{--pb-c:#1f8a4c}
.ms-placement-badge[data-verdict="near"]{--pb-c:#e9a526;--pb-fg:#1b1f25}
.ms-placement-badge[data-verdict="caution"]{--pb-c:#e08a1e;--pb-fg:#1b1f25}
.ms-placement-badge[data-verdict="partial"]{--pb-c:#d9622b}
.ms-placement-badge[data-verdict="in"]{--pb-c:#d63a3f}
.ms-pb-bar{display:flex;align-items:center;gap:7px;padding:6px 11px;background:var(--pb-c);color:var(--pb-fg);font-weight:600;font-size:13px}
.ms-pb-pct{margin-left:auto;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,.2);font-size:12px;white-space:nowrap}
.ms-placement-badge[data-verdict="near"] .ms-pb-pct,.ms-placement-badge[data-verdict="caution"] .ms-pb-pct{background:rgba(0,0,0,.12)}
.ms-pb-body{padding:6px 11px 8px}
.ms-pb-row{display:flex;gap:8px;padding:4px 0;align-items:flex-start}
.ms-pb-row>svg{flex:none;margin-top:1px;color:#9aa3ad}
.ms-pb-main{flex:1;min-width:0}
.ms-pb-k{display:block;font-size:11px;color:#9aa3ad}
.ms-pb-b{font-weight:600;color:#fff}
.ms-pb-track{height:6px;margin:4px 0 2px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden}
.ms-pb-track>div{height:100%}
.ms-pb-warn{color:#ffc861}
.ms-pb-soft{color:#9aa3ad;font-size:11px;padding-top:2px}
`;

const ICONS: Record<string, string[]> = {
  check: ['M5 12l5 5L20 7'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  triangle: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.9 18.4a1.9 1.9 0 0 0 1.7 2.8h16.8a1.9 1.9 0 0 0 1.7-2.8L13.7 3.9a1.9 1.9 0 0 0-3.4 0z'],
  octagon: ['M12 8v4', 'M12 16h.01', 'M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z'],
  help: ['M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 8h.01', 'M11 12h1v4h1'],
  pie: ['M21.2 15.9A10 10 0 1 1 8 2.8', 'M22 12A10 10 0 0 0 12 2v10z'],
  target: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  ruler: [
    'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z',
    'M14.5 12.5l2-2', 'M11.5 9.5l2-2', 'M8.5 6.5l2-2', 'M17.5 15.5l2-2',
  ],
  arrow: ['M12 19V5', 'M5 12l7-7 7 7'],
};

const SPACING_COLOR = { ok: '#2fa862', tight: '#ee7b30', overlap: '#e5484d' } as const;

/** Rule labels read ">30°" and "15–30°"; say them in words, with no symbols or dashes. */
function plain(label: string): string {
  return label.replace(/>\s*(\d)/g, 'over $1').replace(/(\d+)\s*[–-]\s*(\d+)/g, '$1 to $2');
}

function icon(name: string, size = 15, color?: string, rotateDeg?: number): SVGElement {
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
  if (rotateDeg !== undefined) svg.style.transform = `rotate(${Math.round(rotateDeg)}deg)`;
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
  const t = el('div', 'ms-pb-track');
  const f = el('div');
  f.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  f.style.background = color;
  t.appendChild(f);
  return t;
}

function row(iconName: string, label: string, color: string | undefined, ...content: Array<Node | string>): HTMLElement {
  const r = el('div', 'ms-pb-row');
  const main = el('div', 'ms-pb-main');
  main.appendChild(el('span', 'ms-pb-k', label));
  main.append(...content);
  r.append(icon(iconName, 15, color), main);
  return r;
}

/** A class label as a noun for a sentence: "Steep slope (>30°)" becomes "steep slope". */
function feature(label: string | null | undefined): string {
  const s = plain(label ?? '').replace(/\s*\([^)]*\)/g, '').trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : 'unusable ground';
}

function titleOf(v: PlacementVerdict): string {
  switch (v.verdict) {
    case 'ok': return 'Good spot';
    case 'near': {
      // Name the ground itself: touching the shape's own class, otherwise the nearest ground the unit can't use.
      const thing = feature(v.fraction > 0 ? v.className : v.nearest?.className);
      return v.fraction > 0 ? `Touching ${thing}` : `Close to ${thing}`;
    }
    case 'caution': return 'Difficult ground';
    case 'partial': return 'Partly blocked';
    case 'in': return 'Cannot deploy here';
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

/** Why: the ground that decides the verdict, and what it means for this unit type. */
function whyRow(v: PlacementVerdict): HTMLElement | null {
  const unit = v.profileLabel;
  let name: string;
  let rule: string;
  switch (v.verdict) {
    case 'ok':
      name = v.className ? plain(v.className) : 'Deployable ground';
      rule = `${unit} can use it.`;
      break;
    case 'caution':
      name = v.className ? plain(v.className) : 'Difficult ground';
      rule = `Hard going for ${unit}.`;
      break;
    case 'near':
      // Touching: the shape's own class. Otherwise the nearest ground the unit can't use.
      name = plain(v.fraction > 0 ? (v.className ?? '') : (v.nearest?.className ?? v.className ?? '')) || 'Unusable ground nearby';
      rule = `${unit} can't use it.`;
      break;
    case 'partial':
    case 'in':
      name = v.className ? plain(v.className) : 'Unusable ground';
      rule = `${unit} can't use it.`;
      break;
    default:
      return null;
  }
  const body = el('div');
  body.append(el('span', 'ms-pb-b', name), el('div', undefined, rule));
  if (v.reason) body.append(el('div', 'ms-pb-soft', v.reason)); // the rule owner's own words, when the bundle gives them
  return row('info', 'Why', undefined, body);
}

function insideRow(v: PlacementVerdict, pct: number): HTMLElement {
  const color = verdictColor(v);
  return row('pie', 'Inside', undefined, track(pct / 100, color), `${pct}% of the ${v.footprint ? 'footprint' : 'shape'}`);
}

/** Header colour, for the bar and arrow that echo it; keep in step with the CSS above. */
function verdictColor(v: PlacementVerdict): string {
  switch (v.verdict) {
    case 'ok': return '#1f8a4c';
    case 'near': return '#e9a526';
    case 'caution': return '#e08a1e';
    case 'partial': return '#d9622b';
    case 'in': return '#d63a3f';
    default: return '#5b6470';
  }
}

function nearestRow(v: PlacementVerdict): HTMLElement | null {
  const n = v.nearest;
  if (n) {
    // The label names the ground, so the row only has to say how far and which way.
    const body = el('div');
    body.append(el('span', 'ms-pb-b', fmtDistance(n.distanceM)), ` ${n.compass} `);
    body.append(icon('arrow', 13, verdictColor(v), n.bearingDeg));
    return row('target', `Nearest ${feature(n.className)}`, undefined, body);
  }
  const label = v.verdict === 'in' ? 'Nearest open ground' : 'Nearest unusable ground';
  if (v.noneWithinM) return row('target', label, undefined, `Nothing within ${fmtDistance(v.noneWithinM)}`);
  if ((v.verdict === 'ok' || v.verdict === 'caution') && v.distanceM !== null) {
    return row('target', label, undefined, `${fmtDistance(v.distanceM)} away`);
  }
  return null;
}

/** Which unit type the ground is judged for, and that P changes it (the SIDC does not always say how a unit moves). */
function profileRow(v: PlacementVerdict): HTMLElement | null {
  if (!v.profileKey) return null;
  const body = el('div');
  body.append(
    el('span', 'ms-pb-b', v.profileLabel),
    el('span', v.profileOverride ? 'ms-pb-warn' : 'ms-pb-soft', `${v.profileOverride ? ', set by hand' : ''}. P changes it`),
  );
  return row('info', 'Judged as', undefined, body);
}

/** Enforce mode: this click would be refused, and whether Shift gets past it. */
function enforceRow(v: PlacementVerdict): HTMLElement | null {
  if (!v.blocked) return null;
  const text = v.overridable ? 'A click here is refused. Hold Shift and click to place it anyway.' : 'A click here is refused.';
  return row('octagon', 'Enforce mode', SPACING_COLOR.overlap, el('span', 'ms-pb-warn', text));
}

/** The quick-fix hint, shown while pressing S would move the point to usable ground. */
function snapRow(v: PlacementVerdict): HTMLElement | null {
  if (!v.snappable) return null;
  return row('target', 'Quick fix', undefined, el('span', 'ms-pb-b', 'S'), ' moves it to the nearest usable ground');
}

/** The echelon's minimum gap to the next same-echelon unit. Advisory, so it never changes the title. */
function spacingRow(v: PlacementVerdict): HTMLElement | null {
  const s = v.spacing;
  if (!s) return null;
  const echelon = v.footprint?.echelon ?? 'unit';
  const colour = SPACING_COLOR[s.status];
  if (s.nearestGapM === null) return row('ruler', 'Spacing rule', undefined, el('span', 'ms-pb-soft', `No other ${echelon} nearby`));
  const bad = s.status !== 'ok';
  const text = el(
    'span',
    bad ? 'ms-pb-warn' : undefined,
    s.status === 'overlap'
      ? `Overlaps the next ${echelon}`
      : `${fmtDistance(s.nearestGapM)} of ${fmtDistance(s.minGapM)} to the next ${echelon}`,
  );
  return row('ruler', 'Spacing rule', bad ? colour : undefined, track(s.nearestGapM / s.minGapM, colour), text);
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
  private _last: PlacementVerdict | null = null;
  private _notice: string | null = null;
  private _noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private _toastEl: HTMLDivElement | null = null;
  private _toastBar: HTMLDivElement | null = null;
  private _toastBody: HTMLDivElement | null = null;
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Show a short message under the verdict for a few seconds (e.g. why the quick fix found nothing). */
  flash(text: string, ms = 3500): void {
    this._notice = text;
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
      root.setAttribute('role', 'alert');
      this._toastBar = el('div', 'ms-pb-bar') as HTMLDivElement;
      this._toastBody = el('div', 'ms-pb-body') as HTMLDivElement;
      root.append(this._toastBar, this._toastBody);
      document.body.appendChild(root);
      this._toastEl = root;
    }
    const root = this._toastEl;
    root.dataset.verdict = t.verdict;
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

  /** Pointer position in client coordinates; call from a pointermove listener. */
  moveTo(clientX: number, clientY: number): void {
    this._x = clientX;
    this._y = clientY;
    this._hasPointer = true;
    if (this._el && this._el.style.display !== 'none') this._place();
  }

  show(v: PlacementVerdict): void {
    this._last = v;
    if (this._toastEl && this._toastEl.style.display !== 'none') this.dismissToast();
    const el0 = this._ensure();
    el0.dataset.verdict = v.verdict;

    const bar = this._bar!;
    bar.replaceChildren(icon(iconOf(v), 17), el('span', undefined, titleOf(v)));
    const pct = v.samples > 1 && v.fraction > 0 ? Math.max(1, Math.round(v.fraction * 100)) : 0;
    if (pct > 0) bar.appendChild(el('span', 'ms-pb-pct', `${pct}% inside`));

    const rows =
      v.verdict === 'unknown'
        ? []
        : [whyRow(v), pct > 0 ? insideRow(v, pct) : null, nearestRow(v), snapRow(v), enforceRow(v), spacingRow(v), profileRow(v)].filter(
            (r): r is HTMLElement => r !== null,
          );
    if (v.loading) rows.push(el('div', 'ms-pb-soft', 'Still loading terrain data'));
    if (this._notice) rows.push(el('div', 'ms-pb-warn', this._notice));
    const body = this._body!;
    body.replaceChildren(...rows);
    body.style.display = rows.length ? 'block' : 'none';

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
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    const bar = el('div', 'ms-pb-bar') as HTMLDivElement;
    const body = el('div', 'ms-pb-body') as HTMLDivElement;
    root.append(bar, body);
    document.body.appendChild(root);
    this._el = root;
    this._bar = bar;
    this._body = body;
    return root;
  }
}
