/**
 * CrossSection.ts
 *
 * X-Section (user, 2026-11-17: "Terrain cross-section for a drawn line. Plot elevation and relevant obstacles along a
 * route or boundary, with distance markers and sample gaps"). Off by default (`features.crossSection`); the top bar's
 * 📈 X-Section turns it on and starts a line; right-click a placed line or area → "X-Section…" reads that one.
 *
 *   line     drawn (click points, double-click to finish), the selected line / area symbol, or a right-clicked one; an
 *            area is read round its edge;
 *   reading  SiteLine.profileLine on the terrain bundle (30 m samples up to 120 km, wider beyond and said so): the
 *            ground's height, the going for the mover in the month, the obstacles crossed or followed, the steep
 *            stretches, the no-data gaps and, with a threat marker, what the threat sees (OCOKA sight engine);
 *   panel    docked at the foot and kept low so the map stays in view (user, 2026-11-18: "Improve UI"): the answers in
 *            a strip (the going as a bar), then the chart (CrossSectionChart) beside the list of what the line meets,
 *            with a filter (all / NO-GO and SLOW-GO / water / roads and railways / other) the chart follows; hovering
 *            the chart or a list line reads that place and moves a marker on the map, a click brings it into view; the
 *            panel folds to its answers, and to its header while a new line is drawn;
 *   map      layer `ms-cross-section`: the line from A to B with distance markers, NO-GO stretches in red, gaps dashed
 *            grey; closing the panel takes it off the map (it comes back with the panel), Clear drops the line;
 *   output   Copy as Text.
 *
 * It reads the terrain bundle only while on (claude_rules.md). The always-on RouteProfileEngine (symbolEngine
 * .showRouteProfile) stays as it was: it profiles from the map's own elevation service, without the bundle.
 */

import EngineLogger from '../../Support/EngineLogger';
import Utils from '../../Support/utils';
import { ensureTokensCss } from '../GroundGuide/GroundGuideTokens';
import { MovementGuideDraw } from '../MovementGuide/MovementGuideDraw';
import { mgrsOf } from '../PlatoonGuide/PlatoonGuideText';
import { SiteBundle } from '../SiteScan/SiteProbe';
import { SiteMap, type MapSpec } from '../SiteScan/SiteMap';
import { fitBelowBar, siteHint, watchFootDock } from '../SiteScan/SitePanel';
import { MONTHS, dataCatalog, goingRule, lngLatToMerc, mercToLngLat, refLine, seasonFor, soilRuleRef, terrainRef, type RuleRef, type Season, type XY } from '../SiteScan/SiteScan';
import { CLIMB_STEP_M, OBSTACLE_WORD, pathLength, profileLine, steepFor, walkPath, type LineEvent, type LineProfile, type LineSample, type ObstacleKind } from '../SiteScan/SiteLine';
import { KIND_GLYPH, KIND_GROUP, axisMarks, chartSvg, fmtCh, isStop, type ChartLayout } from './CrossSectionChart';

const ENGINE = 'CrossSection';
const HINT = 'ms-cross-section-hint';
const ICON = '📈';
const PANEL_ID = 'ms-cross-section-panel';
const WET_FROM_MM = 100;
const FALLBACK_WET = [7, 8, 9];
/** The line is read every 30 m up to this many samples (120 km); a longer line is read wider, and the panel says so. */
const STEP_M = 30;
const MAX_SAMPLES = 4000;
/** The list beside the chart (px), and the panel width from which it sits beside it rather than under it. */
const SIDE_W = 292;
const WIDE_FROM = 860;
/** Ground movers offered (rules.json profiles). */
export const MOVERS = ['dismounted', 'wheeled', 'tracked', 'pack', 'roadbound', 'generic', 'amphibious', 'oversnow'];

export interface CrossSectionOptions {
  bundleUrl: string;
  cacheTiles: number;
  useWorker: boolean;
  /** rules.json profile of the mover. */
  mover: string;
  /** 1-12, or 0 = this month. */
  month: number;
  /** Read what the Ground Guide's threat marker sees. */
  seen: boolean;
  /** The threat's eye above the ground (m). */
  eyeM: number;
  map: boolean;
  labels: boolean;
  /** Bring a newly read line into view above the panel when part of it is off the map or under the panel. */
  fit: boolean;
  keys: boolean;
}

export const DEFAULT_CROSS_SECTION_OPTIONS: CrossSectionOptions = {
  bundleUrl: '/terrain-bundle',
  cacheTiles: 384,
  useWorker: true,
  mover: 'wheeled',
  month: 0,
  seen: true,
  eyeM: 2,
  map: true,
  labels: true,
  fit: true,
  keys: true,
};

export interface CrossSectionHost {
  threat?: () => [number, number] | null;
  selected?: () => any[];
  /** Keep a choice made on the panel as the `crossSection.<key>` setting, so the next settings change does not undo it. */
  save?: (key: 'mover' | 'month' | 'seen', value: unknown) => void;
}

/** The list's filter: everything, what stops or slows the mover, or one group of obstacles. */
type Filter = 'all' | 'stops' | 'water' | 'route' | 'other';
const FILTER_WORD: Record<Filter, string> = { all: 'All', stops: 'NO-GO / SLOW-GO', water: 'Water', route: 'Rd / Rly', other: 'Other' };

function toMerc(p: number[], sr: any): XY {
  const merc = !!sr?.isWebMercator || [102100, 3857, 102113].includes(sr?.wkid);
  return merc ? [p[0], p[1]] : lngLatToMerc(p[0], p[1]);
}

/** The line of a polyline (its paths joined) or an area (its outer ring), Web Mercator. */
export function pathOf(geometry: any): XY[] | null {
  if (!geometry) return null;
  const sr = geometry.spatialReference;
  if (geometry.type === 'polyline') {
    const pts: XY[] = [];
    for (const path of geometry.paths ?? []) for (const q of path) pts.push(toMerc(q, sr));
    return pts.length >= 2 ? pts : null;
  }
  if (geometry.type === 'polygon' && geometry.rings?.length) {
    const pts = (geometry.rings[0] as number[][]).map((q) => toMerc(q, sr));
    return pts.length >= 3 ? pts : null;
  }
  return null;
}

const esc = (s: unknown) => Utils.escapeHtml(String(s ?? ''));
const goingWord = (g: LineSample['going']): string => (g === 'nogo' ? 'NO-GO' : g === 'slow' ? 'SLOW-GO' : g === 'go' ? 'GO' : 'not read');
const WHY_WORD: Record<NonNullable<LineSample['why']>, string> = { class: 'Gr class', soil: 'soft soil', wet: 'wet Gr' };
const GAP_WORD = { both: 'height, class', elev: 'height', class: 'class' } as const;
/** Crossings in the answers strip: water first, roads last. */
const CROSS_ORDER: ObstacleKind[] = ['canal', 'river', 'drain', 'nullah', 'ford', 'water', 'marsh', 'rail', 'bund', 'cutting', 'cliff', 'wall', 'bridge', 'railBridge', 'footBridge', 'road'];

const P = `#${PANEL_ID}`;
const CSS = `
${P}{position:fixed;left:50%;transform:translateX(-50%);bottom:10px;z-index:2147482806;width:clamp(min(680px,calc(100vw - 20px)),calc(100vw - 150px),1300px);max-height:calc(100vh - 150px);display:none;flex-direction:column;
 background:var(--gg-card);color:#f1f3f6;border:1px solid var(--gg-hair);border-radius:11px;box-shadow:0 10px 28px rgba(0,0,0,.5);font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif}
${P}.ms-open{display:flex}
${P} *{box-sizing:border-box}
${P} .xs-head,${P} .xs-facts{flex:none}
${P} .h{display:flex;flex-wrap:wrap;align-items:center;gap:6px 7px;padding:7px 10px;background:linear-gradient(90deg,#1d2635,var(--gg-head) 45%);border-radius:11px 11px 0 0}
${P}.xs-fold .h,${P}.xs-drawing .h{border-radius:11px}
${P} .t{font-weight:750;font-size:14px;color:#fff;margin-right:4px;white-space:nowrap}
${P} .sp{flex:1}
${P} label{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:var(--gg-label);white-space:nowrap}
${P} select{font:500 12.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;background:#11151a;border:1px solid #3d4650;border-radius:5px;padding:2px 4px;height:25px;max-width:150px}
${P} input[type=checkbox]{accent-color:#8ec1ea}
${P} button{font:500 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:27px;padding:0 9px;white-space:nowrap}
${P} button:hover{background:rgba(255,255,255,.14);color:#fff}
${P} button:focus-visible,${P} select:focus-visible,${P} .er:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
${P} button.pri{background:#2b5d86;border-color:#4f8ab8;color:#fff}
${P} button.x{width:27px;padding:0;font-size:16px}
${P} button[disabled]{opacity:.45;cursor:default}
${P} .facts{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 0;padding:8px 0;border-bottom:1px solid var(--gg-hair)}
${P}.xs-fold .facts{border-bottom:0}
${P} .f{display:flex;flex-direction:column;gap:1px;padding:0 12px;border-left:1px solid var(--gg-hair-soft);min-width:0}
${P} .f:first-child{border-left:0}
${P} .fk{font-size:12px;color:var(--gg-label);white-space:nowrap}
${P} .fv{font:700 14.5px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#f4f6f8;font-variant-numeric:tabular-nums;white-space:nowrap}
${P} .fv small{font:500 12px/1 system-ui,Segoe UI,Arial,sans-serif;color:var(--gg-label)}
${P} .bad{color:#ff8a8d}${P} .warn{color:#ffb46b}${P} .ok{color:#74dca3}${P} .un{color:#b8c1ca}
${P} .fg{flex:1 1 300px;max-width:430px}
${P} .gbar{display:flex;height:8px;border-radius:4px;overflow:hidden;margin:4px 0 3px;background:#2a313a}
${P} .gbar i{display:block;min-width:2px}
${P} .gleg{display:flex;flex-wrap:wrap;gap:0 12px;font:700 13px/1.25 system-ui,Segoe UI,Arial,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}
${P} .body{flex:1 1 auto;min-height:0;overflow:auto;padding:6px 10px 8px}
${P}.xs-fold .body,${P}.xs-drawing .body,${P}.xs-drawing .xs-facts{display:none}
${P} .xs-main{display:grid;grid-template-columns:minmax(0,1fr) ${SIDE_W}px;gap:12px}
${P}.xs-narrow .xs-main{grid-template-columns:minmax(0,1fr);gap:6px}
${P} .read{min-height:21px;display:flex;flex-wrap:wrap;align-items:baseline;gap:0 14px;font-size:12.5px;color:var(--gg-soft);font-variant-numeric:tabular-nums;padding:0 2px 3px;white-space:nowrap;overflow:hidden}
${P} .read b{font-weight:600;color:#ffe08a}
${P} .read b.bad{color:#ff8a8d}${P} .read b.warn{color:#ffb46b}${P} .read b.ok{color:#74dca3}
${P} .xs-side{position:relative;min-height:150px;border-left:1px solid var(--gg-hair);padding-left:10px}
${P} .xs-side-in{position:absolute;inset:0 0 0 10px;display:flex;flex-direction:column}
${P}.xs-narrow .xs-side{border-left:0;padding-left:0;min-height:0}
${P}.xs-narrow .xs-side-in{position:static;max-height:170px}
${P} .chips{flex:none;display:flex;flex-wrap:wrap;gap:4px;padding-bottom:5px}
${P} .chip{height:23px;padding:0 8px;border-radius:999px;font-size:12px}
${P} .chip b{font-weight:600;color:var(--gg-label);margin-left:3px}
${P} .chip.on{background:#2b5d86;border-color:#4f8ab8;color:#fff}
${P} .chip.on b{color:#d7e8f6}
${P} .ev{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:#4a535e transparent}
${P} .er{display:grid;grid-template-columns:60px 13px minmax(0,1fr) auto;gap:0 6px;align-items:baseline;padding:3px 5px 3px 2px;border-bottom:1px solid var(--gg-hair-soft);border-radius:3px;font-size:12.5px;cursor:pointer}
${P} .er:hover,${P} .er:focus-visible{background:rgba(255,255,255,.09)}
${P} .er b{font-weight:600;color:#c3cbd3;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
${P} .er i{font-style:normal;font-weight:700;text-align:center}
${P} .er span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${P} .er em{font-style:normal;font-weight:700;font-size:12px;white-space:nowrap}
${P} .none{padding:10px 4px;font-size:12.5px;color:var(--gg-label)}
${P} .wline{font-size:12.5px;color:var(--gg-warn);margin-top:5px}
${P} .rest{font-size:12px;color:var(--gg-label);margin-top:5px}
${P} .rest summary{cursor:pointer;color:#8ec1ea;width:fit-content}
${P} .rest p{margin:4px 0 0}
${P} .rest ul{margin:4px 0 0;padding-left:16px}
${P} .empty{padding:18px;color:var(--gg-label);text-align:center}
${P} .empty.bad{color:#ff8a8d}
`;

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-cross-section-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

export default class CrossSection {
  private _opts: CrossSectionOptions = { ...DEFAULT_CROSS_SECTION_OPTIONS };
  private _enabled = false;
  private _host: CrossSectionHost;
  private _bundle: SiteBundle | null = null;
  private _bundleState: 'off' | 'loading' | 'ready' | 'missing' = 'off';
  private _bundleKey = '';
  private _path: XY[] | null = null;
  private _pathName = '';
  private _res: LineProfile | null = null;
  private _err: string | null = null;
  private _pending = false;
  /** A newly given line is still to be brought into view (once its first reading is on the panel). */
  private _fitPending = false;
  private _season: { season: Season; why: string } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _resizeHandler: (() => void) | null = null;
  private _unwatchDock: (() => void) | null = null;
  private _draw: MovementGuideDraw;
  private _map: SiteMap;
  private _el: HTMLElement | null = null;
  private _open = false;
  private _fold = false;
  private _filter: Filter = 'all';
  private _restOpen = false;
  private _layout: ChartLayout | null = null;
  private _lastW = 0;
  private _parts: { head: HTMLElement; facts: HTMLElement; body: HTMLElement } | null = null;
  private _last: Record<string, string> = {};

  constructor(getView: () => any, host: CrossSectionHost = {}) {
    this._host = host;
    this._draw = new MovementGuideDraw(getView);
    this._map = new SiteMap(getView, 'ms-cross-section', 'X-Section');
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this._enabled;
  }
  get result(): LineProfile | null {
    return this._res;
  }
  get panelOpen(): boolean {
    return this._open;
  }

  setOptions(o: Partial<CrossSectionOptions>): void {
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null)) } as CrossSectionOptions;
    if (!this._enabled) return;
    this._bindKeys();
    void this._ensureBundle();
    this._schedule();
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._bindKeys();
    if (typeof window !== 'undefined' && !this._resizeHandler) {
      this._resizeHandler = () => this._onResize();
      window.addEventListener('resize', this._resizeHandler);
    }
    void this._ensureBundle();
    EngineLogger.nextStep(ENGINE, 'X-Section on: draw a line, or right-click a line → X-Section…');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.openPanel(false);
    this._map.clear();
    this._unbindKeys();
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    this._resizeHandler = null;
    siteHint(HINT, ICON, null);
    this._bundle?.destroy();
    this._bundle = null;
    this._bundleState = 'off';
    this._bundleKey = '';
  }

  destroy(): void {
    this.disable();
    this._draw.destroy();
    this._unwatchDock?.();
    this._unwatchDock = null;
    this._el?.remove();
    this._el = null;
    this._parts = null;
    this._last = {};
    this._map.destroy();
  }

  onViewChanged(): void {
    this._stopDraw();
    this._map.destroy();
    if (this._enabled) this._paint();
  }

  /**
   * Open or close the panel. Closing it stops a line being drawn and takes the cross-section off the map; the line is
   * kept, so opening the panel again shows it as it was (Clear drops it).
   */
  openPanel(open = true): void {
    if (!open) {
      this._open = false;
      this._el?.classList.remove('ms-open');
      this._stopDraw();
      this._map.clear();
      return;
    }
    if (!this._enabled) return;
    ensureCss();
    if (!this._el) this._build();
    this._open = true;
    fitBelowBar(this._el!, 62);
    this._el!.classList.add('ms-open');
    this._render();
    this._paint();
  }

  /** The top-bar button: open (and with no line yet, start drawing one) or close. */
  togglePanel(): boolean {
    if (this._open) this.openPanel(false);
    else this.start();
    return this._open;
  }

  /** The button: open the panel and, with no line yet, start drawing one. */
  start(): void {
    if (!this._enabled) return;
    this.openPanel(true);
    if (!this._path) this.drawLine();
  }

  /** Drop the line: off the map and off the panel. */
  clear(): void {
    this._stopDraw();
    this._path = null;
    this._pathName = '';
    this._res = null;
    this._err = null;
    this._pending = false;
    this._fitPending = false;
    this._filter = 'all';
    this._map.clear();
    this._render();
  }

  // ── data ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async _ensureBundle(): Promise<void> {
    const base = String(this._opts.bundleUrl || '').replace(/\/+$/, '');
    const key = `${base}|${this._opts.cacheTiles}|${this._opts.useWorker}`;
    if (this._bundleKey === key && this._bundle) return;
    this._bundle?.destroy();
    this._bundleKey = key;
    if (!base) {
      this._bundle = null;
      this._bundleState = 'missing';
      this._render();
      return;
    }
    const b = new SiteBundle(() => this._onData());
    this._bundle = b;
    this._bundleState = 'loading';
    this._render();
    const ok = await b.configure(base, { cacheTiles: this._opts.cacheTiles, useWorker: this._opts.useWorker });
    if (this._bundle !== b) return;
    this._bundleState = ok ? 'ready' : 'missing';
    if (!ok) EngineLogger.error(ENGINE, `No terrain bundle at ${base}: the cross-section needs terrain data`);
    this._schedule();
  }

  private _onData(): void {
    if (this._enabled && this._pending) this._schedule(250);
  }

  private _month(): number {
    const m = Number(this._opts.month);
    return m >= 1 && m <= 12 ? Math.floor(m) : new Date().getMonth() + 1;
  }

  private _threat(): XY | null {
    if (!this._opts.seen) return null;
    const t = this._host.threat?.();
    return t ? lngLatToMerc(t[0], t[1]) : null;
  }

  private _onFoot(): boolean {
    return this._opts.mover === 'dismounted' || this._opts.mover === 'pack';
  }

  private _take(path: XY[], name: string): void {
    this._stopDraw();
    this._path = path;
    this._pathName = name;
    this._res = null;
    this._err = null;
    this._filter = 'all';
    this._fitPending = true;
    this.openPanel(true);
    this._schedule();
  }

  /** Read a line (Web Mercator points, or lng / lat when `lngLat`). */
  setLine(pts: Array<[number, number]>, o: { lngLat?: boolean; name?: string } = {}): void {
    const path = pts.map((p) => (o.lngLat ? lngLatToMerc(p[0], p[1]) : ([p[0], p[1]] as XY)));
    if (path.length < 2 || !(pathLength(path) > 0)) return;
    this._take(path, o.name ?? 'drawn line');
  }

  /** Read a placed line or area symbol. Returns false when it has no line to read. */
  useGraphic(g: any): boolean {
    const path = pathOf(g?.geometry);
    if (!path || !(pathLength(path) > 0)) return false;
    let name = '';
    try {
      name = String(g.attributes?.drawEssentials?.AMPLIFIER?.UNIQUE_DESIG ?? '') || String(g.attributes?.symbolName ?? '');
    } catch {
      name = '';
    }
    this._take(path, name ? `"${name}"` : g.geometry.type === 'polygon' ? "the area's edge" : 'the selected line');
    return true;
  }

  /** Can this graphic be read (a line or area)? */
  canUse(g: any): boolean {
    return !!pathOf(g?.geometry);
  }

  /** Draw a new line on the map. The panel folds to its header meanwhile, so the map is free; Esc keeps the old line. */
  drawLine(): void {
    if (!this._enabled) return;
    this._draw.start({
      kind: 'line',
      prompt: 'Draw the line: click points, double-click to finish (Backspace takes the last point back, Esc cancels)',
      onStatus: (t) => siteHint(HINT, ICON, t),
      onCancel: () => {
        siteHint(HINT, ICON, null);
        this._render();
      },
      onDone: (pts) => {
        siteHint(HINT, ICON, null);
        const path = pts.map((p) => [p[0], p[1]] as XY);
        if (path.length >= 2 && pathLength(path) > 0) this._take(path, 'drawn line');
        else this._render();
      },
    });
    this._render();
  }

  /** Stop a line being drawn (nothing is read), with its hint. */
  private _stopDraw(): void {
    if (!this._draw.active) return;
    this._draw.cancel(false);
    siteHint(HINT, ICON, null);
    this._render();
  }

  private _schedule(ms = 40): void {
    if (!this._enabled) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this._run();
    }, ms);
  }

  /** Read the line now (also done on every change). */
  read(): LineProfile | null {
    this._run();
    return this._res;
  }

  private _run(): void {
    if (!this._enabled) return;
    const b = this._bundle;
    if (!this._path || !b || this._bundleState !== 'ready') {
      this._res = null;
      this._pending = false;
      this._paint();
      this._render();
      return;
    }
    const month = this._month();
    const mid = this._path[Math.floor(this._path.length / 2)];
    const prec = b.precAt(mid[0], mid[1]);
    this._season = seasonFor(month, prec, WET_FROM_MM, FALLBACK_WET);
    const mover = this._opts.mover;
    const rule = goingRule(b.rules, mover, this._season.season);
    const threat = this._threat();
    const onFoot = this._onFoot();
    this._err = null;
    b.begin();
    try {
      this._res = profileLine(b, this._path, rule, {
        stepM: STEP_M,
        maxSamples: MAX_SAMPLES,
        steepPct: steepFor(mover),
        onFoot,
        sightFrom: threat ? { at: threat, eyeM: this._opts.eyeM, targetM: onFoot ? 1.8 : 2.5 } : null,
      });
    } catch (err) {
      this._res = null;
      this._err = String((err as Error)?.message ?? err);
      EngineLogger.error(ENGINE, `Line not read: ${this._err}`);
    }
    this._pending = b.pending() || (prec === null && b.climateLoading);
    this._paint();
    this._render();
    if (this._fitPending && this._res) {
      this._fitPending = false;
      if (this._opts.fit) this._afterLayout(() => this.zoomToLine(true));
    }
  }

  /** Read wider than 30 m (a line over 120 km)? Narrow obstacles between two samples are then not met. */
  private _coarse(p: LineProfile): boolean {
    return p.stepM > STEP_M + 0.5;
  }

  /** What the reading rests on: the data with its sources and dates, the rules, the working thresholds, your inputs. */
  backing(): RuleRef[] {
    const b = this._bundle;
    if (!b?.manifest || !this._res) return [];
    const cat = dataCatalog(b.manifest);
    const e = (figure: string, note: string): RuleRef => ({ basis: 'E', book: '', page: '', quote: null, role: 'rule', checked: null, figure, note });
    const out: RuleRef[] = [
      { basis: 'D', book: 'Your input', page: '', quote: this._pathName, role: 'data', checked: null, figure: 'The line' },
      cat('elev', 'Heights along the line'),
      cat('class', 'Gr class along the line (obstacles, going)'),
      cat('wet', 'Wet Gr along the line'),
      cat('rci', `Soil strength ${this._season?.season === 'wet' ? 'after rain' : 'dry'}`),
      cat('climate', `The month's rain: ${this._season?.why ?? ''}`),
      terrainRef(b.rules, this._opts.mover, `NO-GO / SLOW-GO classes for ${this._moverLabel()}`),
      soilRuleRef(b.rules, this._opts.mover, 'Soil strength against the mover'),
      { basis: 'T', book: 'Terrain rules (rules.json slope classes)', page: '', quote: `steep from ${steepFor(this._opts.mover)}%: vehicles from 15° (class 10), foot from 30° (class 9)`, role: 'rule', checked: null, figure: 'Steep' },
      { basis: 'T', book: 'Climate grid threshold (climate.json thresholds.wetFromMm)', page: '', quote: `a month is wet from ${WET_FROM_MM} mm of rain`, role: 'rule', checked: null, figure: 'Dry or after rain' },
      e('Sample spacing', `every ${Math.round(this._res.stepM)} m (${STEP_M} m up to ${(STEP_M * MAX_SAMPLES) / 1000} km of line, wider beyond: at most ${MAX_SAMPLES.toLocaleString('en-US')} samples)`),
      e('Crossing or along', 'a linear feature crossed in 250 m or less is a crossing; more is a stretch along it'),
      e('Climb', `a rise or fall counts once it reaches ${CLIMB_STEP_M} m (about the GLO-30 elevation's vertical noise)`),
      e('Slope', 'measured along the line over a 60 m base'),
    ];
    if (this._res.stats.seenShare !== null) {
      out.push(e('Seen', `chance 0.5 or more that an eye ${this._opts.eyeM} m up at the threat marker sees ${this._onFoot() ? 1.8 : 2.5} m above the line (OCOKA sight engine: 30 m elevation plus trees, crops and buildings from OcokaDoctrine.json, proposals)`));
      out.push({ basis: 'D', book: 'Your input', page: '', quote: "the Ground Guide's threat marker", role: 'data', checked: null, figure: 'Threat place' });
      out.push(cat('bld', 'Bldgs in the line of sight'));
    }
    return out;
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _seasonWord(): string {
    return `${this._season?.season === 'wet' ? 'after rain' : 'dry'} (${MONTHS[this._month() - 1]})`;
  }

  private _crossings(p: LineProfile): string {
    const c = p.stats.crossings;
    const kinds = (Object.keys(c) as ObstacleKind[]).sort((a, b) => (CROSS_ORDER.indexOf(a) + 100) % 100 - (CROSS_ORDER.indexOf(b) + 100) % 100);
    return kinds.map((k) => `${c[k]} ${OBSTACLE_WORD[k]}`).join(', ') || 'none';
  }

  private _coarseLine(p: LineProfile): string {
    return `Read every ${Math.round(p.stepM)} m, not ${STEP_M} m (the line is over ${(STEP_M * MAX_SAMPLES) / 1000} km): an obstacle narrower than that can fall between two samples. Read it in shorter lines for the full reading.`;
  }

  text(): string {
    const p = this._res;
    if (!p) return '';
    const L: string[] = [];
    const s = p.stats;
    L.push(`X-SECTION: ${this._pathName}, ${fmtCh(p.lengthM)}, ${this._moverLabel()}, ${this._seasonWord()}`);
    if (this._path) L.push(`A ${this._grid(this._path[0])} to B ${this._grid(this._path[this._path.length - 1])}`);
    L.push(`Height ${Math.round(s.minElev ?? 0)}-${Math.round(s.maxElev ?? 0)} m, up ${Math.round(s.gainM)} m, down ${Math.round(s.lossM)} m, steepest ${Math.round(s.maxSlopePct)}% at ${fmtCh(s.maxSlopeAtM)}`);
    L.push(`Going: GO ${fmtCh(s.goM)}, SLOW-GO ${fmtCh(s.slowM)}, NO-GO ${fmtCh(s.nogoM)}${p.nogo.length ? ` in ${p.nogo.length}` : ''}${s.unknownM > 1 ? `, not read ${fmtCh(s.unknownM)}` : ''}`);
    L.push(`Crossings: ${this._crossings(p)}`);
    if (s.seenShare !== null) L.push(`Seen by the threat: ${Math.round(s.seenShare * 100)}% of the line`);
    if (this._coarse(p)) L.push(this._coarseLine(p));
    L.push('');
    for (const r of this._rows(p, 'all')) L.push(`${fmtCh(r.m).padStart(9)}  ${r.label}${r.tag ? ` (${r.tag})` : ''}`);
    L.push('');
    L.push('What this reading rests on:');
    for (const r of this.backing()) L.push(`- ${refLine(r)}`);
    L.push('Check on the ground.');
    return L.join('\n');
  }

  async copyText(): Promise<boolean> {
    const t = this.text();
    if (!t) return false;
    try {
      await navigator.clipboard.writeText(t);
      siteHint(HINT, ICON, 'Cross-section copied as text', 1800);
      return true;
    } catch {
      siteHint(HINT, ICON, 'Copy failed: the browser refused the clipboard', 2200);
      return false;
    }
  }

  private _grid(p: XY): string {
    const [lng, lat] = mercToLngLat(p[0], p[1]);
    try {
      return mgrsOf(lng, lat);
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  private _moverLabel(k = this._opts.mover): string {
    return String((this._bundle?.rules as any)?.profiles?.[k]?.label ?? k);
  }

  // ── panel ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _build(): void {
    const el = document.createElement('section');
    el.id = PANEL_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'X-Section');
    el.addEventListener('click', (e) => {
      const tgt = e.target as HTMLElement;
      const t = tgt.closest('[data-act]') as HTMLElement | null;
      if (t) {
        const a = t.dataset.act;
        if (a === 'close') this.openPanel(false);
        else if (a === 'draw') this.drawLine();
        else if (a === 'cancel') this._stopDraw();
        else if (a === 'sel') {
          const g = (this._host.selected?.() ?? []).find((x: any) => this.canUse(x));
          if (!g || !this.useGraphic(g)) siteHint(HINT, ICON, 'Select a line or area symbol on the map first', 2200);
        } else if (a === 'zoom') this.zoomToLine();
        else if (a === 'clear') this.clear();
        else if (a === 'copy') void this.copyText();
        else if (a === 'fold') {
          this._fold = !this._fold;
          this._render();
        } else if (a === 'flt') {
          this._filter = (t.dataset.flt as Filter) || 'all';
          this._render();
        }
        return;
      }
      // a click on the chart or on a list line brings that place into view above the panel
      const m = this._chainageOf(e);
      if (m !== null) this._showOnMap(m);
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const k = t.dataset?.ctl;
      if (k === 'mover') this._choose('mover', t.value);
      else if (k === 'month') this._choose('month', Number(t.value) || 0);
      else if (k === 'seen') this._choose('seen', (t as HTMLInputElement).checked);
    });
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') e.stopPropagation();
      else if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('er')) {
        e.preventDefault();
        this._showOnMap(Number(t.dataset.m));
      }
    });
    // one marker for the chart and the list: the place under the pointer is read out and shown on the map
    el.addEventListener('mousemove', (e) => {
      if ((e.target as HTMLElement).closest?.('svg.xs-svg')) this._cursorAt(this._chainageOf(e));
    });
    el.addEventListener('mouseover', (e) => {
      const row = (e.target as HTMLElement).closest?.('.er') as HTMLElement | null;
      if (row) this._cursorAt(Number(row.dataset.m));
    });
    el.addEventListener('mouseout', (e) => {
      const t = e.target as HTMLElement;
      const from = (t.closest?.('svg.xs-svg') ?? t.closest?.('.er')) as Element | null;
      if (from && !from.contains(e.relatedTarget as Node | null)) this._cursorAt(null);
    });
    el.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList?.contains('er')) this._cursorAt(Number(t.dataset.m));
    });
    // <details> does not bubble its toggle: caught on the way down, so it stays open across a re-read
    el.addEventListener(
      'toggle',
      (e) => {
        const t = e.target as HTMLDetailsElement;
        if (t.classList?.contains('rest')) this._restOpen = t.open;
      },
      true,
    );
    document.body.appendChild(el);
    this._el = el;
    // lets a panel above it (AOI Check) stop short of this one
    this._unwatchDock = watchFootDock(el);
  }

  /** A choice made on the panel: used now and kept as the setting, so another settings change does not undo it. */
  private _choose(key: 'mover' | 'month' | 'seen', value: unknown): void {
    this.setOptions({ [key]: value } as Partial<CrossSectionOptions>);
    try {
      this._host.save?.(key, value);
    } catch {
      /* the host's settings are its own affair */
    }
  }

  /** The chainage (m) under a pointer event on the chart, or of the list line it is on; null elsewhere. */
  private _chainageOf(e: MouseEvent): number | null {
    const t = e.target as HTMLElement;
    const p = this._res;
    const L = this._layout;
    if (!p) return null;
    const svg = t.closest?.('svg.xs-svg') as SVGSVGElement | null;
    if (svg && L) {
      const r = svg?.getBoundingClientRect();
      if (!r || !(r.width > 0)) return null;
      const px = ((e.clientX - r.left) / r.width) * L.W;
      return Math.max(0, Math.min(p.lengthM, ((px - L.padL) / (L.W - L.padL - L.padR)) * p.lengthM));
    }
    const row = t.closest?.('.er') as HTMLElement | null;
    return row ? Number(row.dataset.m) : null;
  }

  /** The sample nearest a chainage. */
  private _sampleAt(m: number): LineSample | null {
    const ss = this._res?.samples;
    if (!ss?.length) return null;
    let lo = 0, hi = ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid].m <= m) lo = mid;
      else hi = mid;
    }
    return Math.abs(ss[hi].m - m) < Math.abs(ss[lo].m - m) ? ss[hi] : ss[lo];
  }

  /** Put the marker at a chainage: on the chart, in the read-out line and on the map. Null takes it off. */
  private _cursorAt(m: number | null): void {
    const el = this._el;
    const L = this._layout;
    const g = el?.querySelector('.xs-hover') as SVGGElement | null;
    const read = el?.querySelector('.read') as HTMLElement | null;
    const s = m === null || !Number.isFinite(m) ? null : this._sampleAt(m);
    if (!s || !L || !g || !read) {
      if (g) g.style.display = 'none';
      if (read) read.innerHTML = this._readIdle();
      this._map.hover(null);
      return;
    }
    const line = g.querySelector('.xs-hl') as SVGLineElement | null;
    const dot = g.querySelector('.xs-hd') as SVGCircleElement | null;
    g.style.display = '';
    line?.setAttribute('x1', String(L.x(s.m)));
    line?.setAttribute('x2', String(L.x(s.m)));
    dot?.setAttribute('cx', String(L.x(s.m)));
    dot?.setAttribute('cy', String(Number.isFinite(s.elev) ? L.y(s.elev) : L.plotTop + L.plotH));
    const rules: any = this._bundle?.rules;
    const cls = s.cls !== null ? String(rules?.classes?.[String(s.cls)]?.label ?? `class ${s.cls}`) : 'no class data';
    const tone = s.going === 'nogo' ? 'bad' : s.going === 'slow' ? 'warn' : s.going === 'go' ? 'ok' : 'un';
    const slope = s.slopePct === null ? '' : `<span>${s.slopePct > 0.5 ? 'up ' : s.slopePct < -0.5 ? 'down ' : ''}${Math.round(Math.abs(s.slopePct))}%</span>`;
    read.innerHTML =
      `<b>${esc(fmtCh(s.m))}</b><span>${Number.isFinite(s.elev) ? `${Math.round(s.elev)} m` : 'no height'}</span>${slope}<span>${esc(cls)}</span>` +
      `<b class="${tone}">${goingWord(s.going)}${s.why && s.going !== 'go' ? ` (${WHY_WORD[s.why]})` : ''}</b>` +
      (s.seen !== null ? `<span>seen ${Math.round(s.seen * 100)}%</span>` : '');
    if (this._opts.map) this._map.hover([s.x, s.y]);
  }

  private _readIdle(): string {
    return this._pending ? '<span>Reading the ground… the chart fills as tiles arrive</span>' : '<span>Move along the chart or the list to read a place; click to bring it into view on the map</span>';
  }

  /** The band of the window the map shows clear: below the host's top bar, above this panel. */
  private _clearBand(): { top: number; bottom: number } {
    const bar = typeof document !== 'undefined' ? document.getElementById('infoDiv')?.getBoundingClientRect() : null;
    const top = bar && bar.height > 0 && bar.bottom < window.innerHeight * 0.6 ? bar.bottom : 0;
    const r = this._open && this._el ? this._el.getBoundingClientRect() : null;
    return { top, bottom: r && r.height > 0 ? r.top : window.innerHeight };
  }

  /** Bring the whole line into view above the panel. `onlyIfHidden`: leave the map alone when all of it shows already. */
  zoomToLine(onlyIfHidden = false): void {
    if (!this._path) return;
    const band = this._clearBand();
    if (onlyIfHidden && !this._map.outside(this._path, band)) return;
    this._map.fit(this._path, band);
  }

  private _showOnMap(m: number): void {
    const s = Number.isFinite(m) ? this._sampleAt(m) : null;
    if (!s) return;
    this._map.centre([s.x, s.y], this._clearBand());
    this._cursorAt(s.m);
  }

  private _afterLayout(fn: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
    else setTimeout(fn, 0);
  }

  private _onResize(): void {
    if (!this._open || !this._el) return;
    fitBelowBar(this._el, 62);
    if (Math.abs(this._el.clientWidth - this._lastW) > 4) this._render();
  }

  private _show(e: LineEvent, f = this._filter): boolean {
    return f === 'all' || (f === 'stops' ? isStop(e) : KIND_GROUP[e.kind] === f);
  }

  /** The list's lines for a filter, in order along the line: what the line meets, and the no-data gaps (never GO). */
  private _rows(p: LineProfile, f: Filter): Array<{ m: number; glyph: string; color: string; label: string; tag: string; tone: string }> {
    const rows = p.events
      .filter((e) => this._show(e, f))
      .map((e) => ({ m: e.m, glyph: KIND_GLYPH[e.kind].s, color: KIND_GLYPH[e.kind].c, label: e.label, tag: e.going && e.going !== 'go' ? goingWord(e.going) : '', tone: e.going === 'nogo' ? 'bad' : 'warn' }));
    if (f === 'all' || f === 'stops') for (const g of p.gaps) rows.push({ m: g.fromM, glyph: '?', color: '#9aa3ad', label: `No data (${GAP_WORD[g.what]}) to ${fmtCh(g.toM)}`, tag: '', tone: 'un' });
    return rows.sort((a, b) => a.m - b.m);
  }

  private _render(): void {
    if (!this._open || !this._el) return;
    const el = this._el;
    const p = this._res;
    const drawing = this._draw.active;
    el.classList.toggle('xs-drawing', drawing);
    el.classList.toggle('xs-fold', this._fold && !drawing);
    const wide = (el.clientWidth || 980) >= WIDE_FROM;
    el.classList.toggle('xs-narrow', !wide);
    this._lastW = el.clientWidth;

    const rules: any = this._bundle?.rules;
    const movers = MOVERS.filter((k) => !rules || rules.profiles?.[k]);
    const threatOn = !!this._host.threat?.();
    const head =
      `<div class="h"><span class="t">${ICON} X-Section</span>` +
      `<label>Mover <select data-ctl="mover">${movers.map((k) => `<option value="${k}"${k === this._opts.mover ? ' selected' : ''}>${esc(this._moverLabel(k))}</option>`).join('')}</select></label>` +
      `<label>Month <select data-ctl="month"><option value="0">This month (${MONTHS[new Date().getMonth()]})</option>${MONTHS.map((m, i) => `<option value="${i + 1}"${Number(this._opts.month) === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select></label>` +
      `<label title="${threatOn ? "What the Ground Guide's threat marker sees along the line" : 'Set a threat marker (Ground Guide Extended View) to read what it sees'}"><input type="checkbox" data-ctl="seen"${this._opts.seen ? ' checked' : ''}${threatOn ? '' : ' disabled'}> Seen by threat</label>` +
      `<span class="sp"></span>` +
      (drawing
        ? `<button data-act="cancel" class="pri" title="Stop drawing (Esc); the line read before stays">Cancel drawing</button>`
        : `<button data-act="draw" class="${this._path ? '' : 'pri'}" title="Draw a new line on the map: click points, double-click to finish">Draw line</button>`) +
      `<button data-act="sel" title="Read the selected line or area symbol (an area is read round its edge)">Selected line</button>` +
      `<button data-act="zoom" title="Bring the whole line into view above this panel"${this._path ? '' : ' disabled'}>Zoom to line</button>` +
      `<button data-act="clear" title="Take the line off the map and the panel"${this._path ? '' : ' disabled'}>Clear</button>` +
      `<button data-act="copy" title="Copy the reading as text, with what it rests on"${p ? '' : ' disabled'}>Copy as Text</button>` +
      `<button class="x" data-act="fold" aria-expanded="${this._fold ? 'false' : 'true'}" aria-label="${this._fold ? 'Show the chart' : 'Fold to the answers'}" title="${this._fold ? 'Show the chart and the list' : 'Fold to the answers, so the map is free'}"${p && !drawing ? '' : ' disabled'}>${this._fold ? '▴' : '▾'}</button>` +
      `<button class="x" data-act="close" aria-label="Close" title="Close (Esc): the cross-section comes off the map, the line is kept">×</button></div>`;

    let facts = '';
    let body = '';
    if (this._bundleState === 'loading') body = '<div class="empty">Opening the terrain data…</div>';
    else if (this._bundleState === 'missing') body = '<div class="empty">Needs terrain data: no terrain bundle at this address.</div>';
    else if (!this._path) body = '<div class="empty">Draw a line on the map, use the selected line, or right-click a line → X-Section…</div>';
    else if (this._err) body = `<div class="empty bad">The line could not be read: ${esc(this._err)}</div>`;
    else if (!p) body = '<div class="empty">Reading the line…</div>';
    else {
      facts = this._factsHtml(p);
      body = this._bodyHtml(p, wide);
    }
    if (!this._parts) {
      el.innerHTML = '<div class="xs-head"></div><div class="xs-facts"></div><div class="body"></div>';
      this._parts = { head: el.children[0] as HTMLElement, facts: el.children[1] as HTMLElement, body: el.children[2] as HTMLElement };
    }
    // only what changed is rewritten: a select in use keeps its focus, and the list its place, while tiles arrive
    const set = (k: 'head' | 'facts' | 'body', html: string): void => {
      if (this._last[k] === html) return;
      this._last[k] = html;
      const list = k === 'body' ? (this._parts!.body.querySelector('.ev') as HTMLElement | null) : null;
      const at = list?.scrollTop ?? 0;
      this._parts![k].innerHTML = html;
      if (k === 'body' && at > 0) {
        const now = this._parts!.body.querySelector('.ev') as HTMLElement | null;
        if (now) now.scrollTop = at;
      }
    };
    set('head', head);
    set('facts', facts);
    set('body', body);
  }

  /** The answers strip: the line, the going as a bar, heights, climb, steepest, crossings, seen, no data. */
  private _factsHtml(p: LineProfile): string {
    const s = p.stats;
    const f = (k: string, v: string, tone = '', tip = '') => `<div class="f"${tip ? ` title="${esc(tip)}"` : ''}><span class="fk">${esc(k)}</span><span class="fv ${tone}">${v}</span></div>`;
    const total = Math.max(1, s.goM + s.slowM + s.nogoM + s.unknownM);
    const seg = (m: number, c: string) => (m > 0 ? `<i style="flex:${Math.max(1, Math.round((m / total) * 1000))};background:${c}"></i>` : '');
    const going =
      `<div class="f fg" title="${esc(`Going for ${this._moverLabel()}, ${this._season?.season === 'wet' ? 'after rain' : 'dry'}: ${this._season?.why ?? ''}`)}">` +
      `<span class="fk">Going: ${esc(this._moverLabel())}, ${esc(this._seasonWord())}</span>` +
      `<span class="gbar">${seg(s.goM, '#2fa862')}${seg(s.slowM, '#ee8a1f')}${seg(s.nogoM, '#e5484d')}${seg(s.unknownM, '#5d6772')}</span>` +
      `<span class="gleg"><span class="ok">GO ${esc(fmtCh(s.goM))}</span>` +
      `<span class="${s.slowM > 0 ? 'warn' : 'un'}">SLOW-GO ${s.slowM > 0 ? esc(fmtCh(s.slowM)) : 'none'}</span>` +
      `<span class="${s.nogoM > 0 ? 'bad' : 'un'}">NO-GO ${s.nogoM > 0 ? `${esc(fmtCh(s.nogoM))} in ${p.nogo.length}` : 'none'}</span>` +
      (s.unknownM > 1 ? `<span class="un">Not read ${esc(fmtCh(s.unknownM))}</span>` : '') +
      `</span></div>`;
    const steepFrom = steepFor(this._opts.mover);
    return (
      `<div class="facts">` +
      f('Line A to B', `${esc(fmtCh(p.lengthM))} <small>${esc(this._pathName)}</small>`) +
      going +
      f('Height', s.minElev === null ? 'no data' : `${Math.round(s.minElev)}-${Math.round(s.maxElev ?? s.minElev)} m`, s.minElev === null ? 'warn' : '') +
      f('Up / down', `${Math.round(s.gainM)} / ${Math.round(s.lossM)} m`, '', `Climb and descent from A to B, counted in steps of ${CLIMB_STEP_M} m`) +
      f('Steepest', `${Math.round(s.maxSlopePct)}% <small>at ${esc(fmtCh(s.maxSlopeAtM))}</small>`, s.maxSlopePct >= steepFrom ? 'bad' : '', `Steep for ${this._moverLabel()} from ${steepFrom}%`) +
      f('Crossings', esc(this._crossings(p))) +
      (s.seenShare !== null ? f('Seen by threat', `${Math.round(s.seenShare * 100)}%`, s.seenShare > 0.5 ? 'warn' : '') : '') +
      f('No data', s.gapM > 1 ? esc(fmtCh(s.gapM)) : 'none', s.gapM > 1 ? 'warn' : 'ok') +
      `</div>`
    );
  }

  /** The chart beside the list of what the line meets (under it on a narrow panel), then the warnings and the backing. */
  private _bodyHtml(p: LineProfile, wide: boolean): string {
    const s = p.stats;
    const W = Math.max(420, (this._el!.clientWidth || 980) - 22 - (wide ? SIDE_W + 12 : 0));
    const { svg, L } = chartSvg(p, W, { withSeen: s.seenShare !== null, show: (e) => this._show(e) });
    this._layout = L;
    const count: Record<Filter, number> = {
      all: p.events.length + p.gaps.length,
      stops: p.events.filter(isStop).length + p.gaps.length,
      water: p.events.filter((e) => KIND_GROUP[e.kind] === 'water').length,
      route: p.events.filter((e) => KIND_GROUP[e.kind] === 'route').length,
      other: p.events.filter((e) => KIND_GROUP[e.kind] === 'other').length,
    };
    const chips = (Object.keys(FILTER_WORD) as Filter[])
      .filter((k) => k === 'all' || count[k] > 0 || k === this._filter)
      .map((k) => `<button class="chip${k === this._filter ? ' on' : ''}" data-act="flt" data-flt="${k}" aria-pressed="${k === this._filter}">${FILTER_WORD[k]}<b>${count[k]}</b></button>`)
      .join('');
    const rows = this._rows(p, this._filter)
      .map((r) => `<div class="er" role="listitem" tabindex="0" data-m="${r.m.toFixed(1)}" title="${esc(`${r.label} at ${fmtCh(r.m)}: click to bring it into view`)}"><b>${esc(fmtCh(r.m))}</b><i style="color:${r.color}">${esc(r.glyph)}</i><span>${esc(r.label)}</span>${r.tag ? `<em class="${r.tone}">${r.tag}</em>` : '<em></em>'}</div>`)
      .join('');
    const none = count.all === 0 ? 'Nothing on the line: no obstacle, road or gap.' : `No ${FILTER_WORD[this._filter]} on the line.`;
    const backing = this.backing();
    return (
      `<div class="xs-main"><div class="xs-chart"><div class="read">${this._readIdle()}</div>${svg}</div>` +
      `<div class="xs-side"><div class="xs-side-in"><div class="chips" role="group" aria-label="Show in the list and the chart">${chips}</div>` +
      `<div class="ev" role="list" aria-label="What the line meets, from A to B">${rows || `<div class="none">${none}</div>`}</div></div></div></div>` +
      (this._coarse(p) ? `<div class="wline">⚠ ${esc(this._coarseLine(p))}</div>` : '') +
      `<details class="rest"${this._restOpen ? ' open' : ''}><summary>How it was read, and what it rests on (${backing.length})</summary>` +
      `<p>Read every ${Math.round(p.stepM)} m from the terrain bundle (30 m elevation, ground class, wet layer, soil): going for ${esc(this._moverLabel())} ${this._season?.season === 'wet' ? 'after rain' : 'dry'} (${esc(this._season?.why ?? '')}); steep from ${steepFor(this._opts.mover)}% (rules.json slope classes); a crossing is a linear feature crossed in 250 m or less.${s.seenShare !== null ? ` Seen: chance 0.5 or more from the threat marker at ${this._opts.eyeM} m eye height.` : ''} Red tint: NO-GO. Hatched: no data. Check on the ground.</p>` +
      `<ul>${backing.map((r) => `<li>${esc(refLine(r))}</li>`).join('')}</ul></details>`
    );
  }

  // ── map ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _paint(): void {
    if (!this._enabled || !this._open || !this._opts.map || !this._path) {
      this._map.clear();
      return;
    }
    const path = this._path;
    const spec: MapSpec = { circle: null, polys: [], lines: [], marks: [] };
    spec.lines.push({ pts: path, rgb: [142, 193, 234], width: 3 });
    const p = this._res;
    const first = path[0], last = path[path.length - 1];
    const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1;
    if (p) {
      const fine = walkPath(path, Math.max(15, p.stepM / 2));
      const along = (fromM: number, toM: number): XY[] => fine.filter((q) => q.m >= fromM && q.m <= toM).map((q) => q.p);
      for (const st of p.nogo) spec.lines.push({ pts: along(st.fromM, st.toM), rgb: [229, 72, 77], width: 5, label: st.toM - st.fromM > 150 ? `NO-GO ${st.why}` : undefined });
      for (const gp of p.gaps) spec.lines.push({ pts: along(gp.fromM, gp.toM), rgb: [154, 163, 173], width: 4, dash: true, label: 'No data' });
      // the chart's own distance markers; the ends are A and B
      const ax = axisMarks(p.lengthM);
      const ticks = walkPath(path, ax.step);
      ax.marks.forEach((mk, i) => {
        const q = ticks[i];
        if (!q || mk.m <= 0 || mk.m > p.lengthM - ax.step * 0.35) return;
        spec.marks.push({ at: q.p, kind: 'tick', label: `${mk.label} ${ax.unit}` });
      });
      spec.marks.push({ at: first, kind: 'letter', letter: 'A', rgb: [142, 193, 234], label: closed ? `A = B ${fmtCh(p.lengthM)}` : undefined });
      if (!closed) spec.marks.push({ at: last, kind: 'letter', letter: 'B', rgb: [142, 193, 234], label: fmtCh(p.lengthM) });
    } else {
      spec.marks.push({ at: first, kind: 'letter', letter: 'A', rgb: [142, 193, 234] });
      if (!closed) spec.marks.push({ at: last, kind: 'letter', letter: 'B', rgb: [142, 193, 234] });
    }
    const t = this._threat();
    if (t) spec.marks.push({ at: t, kind: 'threat', label: 'Threat' });
    this._map.draw(spec, this._opts.labels);
  }

  // ── keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _bindKeys(): void {
    this._unbindKeys();
    if (!this._opts.keys) return;
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this._enabled || e.key !== 'Escape' || !this._open || this._draw.active) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      this.openPanel(false);
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  private _unbindKeys(): void {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    this._keyHandler = null;
  }
}
