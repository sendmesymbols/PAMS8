/**
 * GroundGuideThreat.ts
 *
 * The threat marker of the Extended View (F; user, 2026-11-10: "some sort of option which can be repositioned on map,
 * front by default, not enemy symbols"). A small handle over the map that says where the threat is:
 *   - docked at the top of the map it shows the threat's bearing: the unit's front (the default), a bearing turned
 *     with [ and ], or "all round";
 *   - dragged onto the map it becomes a place, and the threat is then judged toward that place from wherever the
 *     symbol is put (`extended.threat: 'point'`, `extended.at`);
 *   - a double-click puts it back to the front.
 * A DOM element over the view, not a map graphic, so it can be dragged while a draw tool owns the map's pointer
 * events. The guide tells it where its place is on screen (`reflow`) when the view moves.
 */

import type { OcokaThreatMode } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-threat-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const CSS = `
.ms-gg-threat{position:absolute;z-index:40;display:flex;align-items:center;gap:6px;padding:4px 9px 4px 5px;border-radius:16px;background:#1b1f25;border:1.5px solid #ffd23f;color:#ffd23f;font:600 12px/1.2 system-ui,Segoe UI,Arial,sans-serif;white-space:nowrap;cursor:grab;user-select:none;touch-action:none;box-shadow:0 2px 8px rgba(0,0,0,.45);transform:translate(-50%,-50%)}
.ms-gg-threat.ms-drag{cursor:grabbing;box-shadow:0 4px 14px rgba(0,0,0,.6)}
.ms-gg-threat.ms-pt{padding:4px 9px 4px 5px;background:#3a1416;border-color:#ff6b6f;color:#ffd0d1}
.ms-gg-threat svg{flex:none;overflow:visible}
.ms-gg-threat small{font-weight:400;color:#c3cbd3;font-size:12px}
.ms-gg-threat:focus-visible{outline:2px solid #fff;outline-offset:2px}
`;

export interface ThreatState {
  mode: OcokaThreatMode;
  /** The bearing in force, degrees clockwise from north (for the docked arrow). */
  bearingDeg: number;
  /** The threat point, [longitude, latitude], for `point` mode. */
  at: [number, number] | null;
}
export interface ThreatHost {
  container(): HTMLElement | null;
  /** A place on the map to a position inside the container, px; null when it is off the view. */
  toScreen(lngLat: [number, number]): { x: number; y: number } | null;
  /** A position inside the container to a place on the map. */
  toMap(x: number, y: number): [number, number] | null;
  /** The marker was dropped on the map. */
  moved(lngLat: [number, number]): void;
  /** The marker was double-clicked: back to the front. */
  reset(): void;
}

export class GroundGuideThreat {
  private _el: HTMLDivElement | null = null;
  private _arrow: SVGElement | null = null;
  private _text: HTMLElement | null = null;
  private _state: ThreatState | null = null;
  private _north = 0;
  private _drag: { dx: number; dy: number; x0: number; y0: number; moved: boolean } | null = null;
  /** Where the docked marker sits, from the top of the map, px. */
  topPx = 70;

  constructor(private readonly _host: ThreatHost) {}

  get isShown(): boolean {
    return !!this._el && this._el.style.display !== 'none';
  }

  show(state: ThreatState, northDeg = this._north): void {
    this._state = state;
    this._north = northDeg;
    const c = this._host.container();
    if (!c) return this.hide();
    const el0 = this._ensure(c);
    el0.style.display = 'flex';
    this._paint();
    this.reflow();
  }

  hide(): void {
    if (this._el) this._el.style.display = 'none';
  }

  setNorth(northDeg: number): void {
    this._north = northDeg;
    if (this.isShown) this._paint();
  }

  /** Put the marker where it belongs: on its place when it has one and the place is on the view, else docked at the top. */
  reflow(): void {
    const el0 = this._el;
    const s = this._state;
    if (!el0 || !s || el0.style.display === 'none' || this._drag) return;
    const c = this._host.container();
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    let x = w / 2;
    let y = this.topPx;
    let off = false;
    if (s.mode === 'point' && s.at) {
      const p = this._host.toScreen(s.at);
      if (p && p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h) [x, y] = [p.x, p.y];
      else off = true; // the place is off the view: stay docked and point at it
    }
    el0.style.left = `${Math.round(x)}px`;
    el0.style.top = `${Math.round(y)}px`;
    el0.classList.toggle('ms-pt', s.mode === 'point' && !!s.at && !off);
  }

  destroy(): void {
    this._el?.remove();
    this._el = null;
    this._state = null;
  }

  private _paint(): void {
    const s = this._state;
    if (!s || !this._arrow || !this._text) return;
    const all = s.mode === 'allRound';
    this._arrow.style.transform = `rotate(${Math.round(s.bearingDeg + this._north)}deg)`;
    this._arrow.style.display = all ? 'none' : '';
    const pt = s.mode === 'point' && !!s.at;
    const how = all ? 'All Round' : pt ? 'here' : `${COMPASS[Math.round((((s.bearingDeg % 360) + 360) % 360) / 45) % 8]} ${Math.round(s.bearingDeg)}°`;
    const from = all || pt ? '' : s.mode === 'front' ? ' (front)' : ' (set)';
    this._text.replaceChildren('Threat ', how, Object.assign(document.createElement('small'), { textContent: from }));
    const el0 = this._el!;
    el0.title = pt ? 'The threat is judged toward this place. Drag to move it; double-click to go back to the front.' : 'Where the threat is. Drag onto the map to make it a place; [ and ] turn it; double-click for the front.';
    el0.setAttribute('aria-label', `Threat ${how}${from}`);
  }

  private _ensure(container: HTMLElement): HTMLDivElement {
    if (this._el && this._el.parentElement === container) return this._el;
    this._el?.remove();
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el0 = document.createElement('div');
    el0.className = 'ms-gg-threat';
    el0.tabIndex = 0;
    el0.setAttribute('role', 'button');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 18 18');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M9 1.5 14 9.5H11V16.5H7V9.5H4Z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    svg.style.transformOrigin = '9px 9px';
    const text = document.createElement('span');
    el0.append(svg, text);
    // Nothing the marker does may reach a draw tool listening on the map.
    for (const t of ['mousedown', 'click', 'dblclick', 'pointerup', 'touchstart']) el0.addEventListener(t, (e) => e.stopPropagation());
    el0.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const r = el0.getBoundingClientRect();
      this._drag = { dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2), x0: e.clientX, y0: e.clientY, moved: false };
      try {
        el0.setPointerCapture(e.pointerId); // so the drag goes on when the pointer leaves the marker
      } catch {
        /* no such active pointer (a synthetic event): the drag still works while over the marker */
      }
      el0.classList.add('ms-drag');
    });
    el0.addEventListener('pointermove', (e) => {
      const d = this._drag;
      if (!d) return;
      e.stopPropagation();
      const cr = container.getBoundingClientRect();
      const x = e.clientX - d.dx - cr.left;
      const y = e.clientY - d.dy - cr.top;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return;
      d.moved = true;
      el0.style.left = `${Math.round(x)}px`;
      el0.style.top = `${Math.round(y)}px`;
    });
    const drop = (e: PointerEvent): void => {
      const d = this._drag;
      if (!d) return;
      this._drag = null;
      el0.classList.remove('ms-drag');
      try {
        el0.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (!d.moved) return;
      const cr = container.getBoundingClientRect();
      const ll = this._host.toMap(e.clientX - d.dx - cr.left, e.clientY - d.dy - cr.top);
      if (ll) this._host.moved(ll);
      else this.reflow();
    };
    el0.addEventListener('pointerup', drop);
    el0.addEventListener('pointercancel', drop);
    el0.addEventListener('dblclick', () => this._host.reset());
    el0.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this._host.reset();
      }
    });
    container.appendChild(el0);
    this._el = el0;
    this._arrow = svg;
    this._text = text;
    return el0;
  }
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
