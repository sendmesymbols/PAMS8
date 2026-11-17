/**
 * CrossSection.ts
 *
 * X-Section (user, 2026-11-17: "Terrain cross-section for a drawn line. Plot elevation and relevant obstacles along a
 * route or boundary, with distance markers and sample gaps"). Off by default (`features.crossSection`); the top bar's
 * 📈 X-Section turns it on and starts a line; right-click a placed line or area → "X-Section…" reads that one.
 *
 *   line     drawn (click points, double-click to finish), the selected line / area symbol, or a right-clicked one; an
 *            area is read round its edge;
 *   reading  SiteLine.profileLine on the terrain bundle (30 m samples): the ground's height, the going for the mover in
 *            the month, the obstacles crossed or followed, the steep stretches, the no-data gaps and, with a threat
 *            marker, what the threat sees (OCOKA sight engine);
 *   panel    docked at the foot: the facts, the chart (CrossSectionChart) with the going band, obstacle row, seen band and
 *            distance markers, and the list of events; hovering the chart moves a marker on the map;
 *   map      layer `ms-cross-section`: the line with distance markers, NO-GO stretches in red, gaps dashed grey;
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
import { fitBelowBar, siteHint } from '../SiteScan/SitePanel';
import { MONTHS, dataCatalog, goingRule, lngLatToMerc, mercToLngLat, refLine, seasonFor, soilRuleRef, terrainRef, type RuleRef, type Season, type XY } from '../SiteScan/SiteScan';
import { CLIMB_STEP_M, OBSTACLE_WORD, fmtM, profileLine, steepFor, walkPath, type LineProfile } from '../SiteScan/SiteLine';
import { chartSvg, markerStep, type ChartLayout } from './CrossSectionChart';

const ENGINE = 'CrossSection';
const HINT = 'ms-cross-section-hint';
const ICON = '📈';
const PANEL_ID = 'ms-cross-section-panel';
const WET_FROM_MM = 100;
const FALLBACK_WET = [7, 8, 9];
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
  keys: true,
};

export interface CrossSectionHost {
  threat?: () => [number, number] | null;
  selected?: () => any[];
}

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

const CSS = `
#${PANEL_ID}{position:fixed;left:50%;transform:translateX(-50%);bottom:10px;z-index:2147482806;width:min(1000px,calc(100vw - 20px));max-height:calc(100vh - 150px);display:none;flex-direction:column;
 background:var(--gg-card);color:#f1f3f6;border:1px solid var(--gg-hair);border-radius:11px;box-shadow:0 10px 28px rgba(0,0,0,.5);font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif}
#${PANEL_ID}.ms-open{display:flex}
#${PANEL_ID} *{box-sizing:border-box}
#${PANEL_ID} .xs-head,#${PANEL_ID} .xs-facts{flex:none}
#${PANEL_ID} .h{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:7px 10px;background:linear-gradient(90deg,#1d2635,var(--gg-head) 45%);border-radius:11px 11px 0 0}
#${PANEL_ID} .t{font-weight:750;font-size:13.5px;color:#fff;margin-right:4px}
#${PANEL_ID} .sp{flex:1}
#${PANEL_ID} label{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--gg-label);white-space:nowrap}
#${PANEL_ID} select{font:500 12.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;background:#11151a;border:1px solid #3d4650;border-radius:5px;padding:2px 4px;height:23px}
#${PANEL_ID} input[type=checkbox]{accent-color:#8ec1ea}
#${PANEL_ID} button{font:500 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:27px;padding:0 9px;white-space:nowrap}
#${PANEL_ID} button:hover{background:rgba(255,255,255,.14);color:#fff}
#${PANEL_ID} button.pri{background:#2b5d86;border-color:#4f8ab8}
#${PANEL_ID} button.x{width:27px;padding:0;font-size:17px}
#${PANEL_ID} button[disabled]{opacity:.45;cursor:default}
#${PANEL_ID} .facts{flex:none;display:flex;flex-wrap:wrap;gap:6px 18px;padding:7px 12px;border-bottom:1px solid var(--gg-hair)}
#${PANEL_ID} .f{display:flex;flex-direction:column}
#${PANEL_ID} .fk{font-size:11.5px;color:var(--gg-label)}
#${PANEL_ID} .fv{font:700 14px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:#f4f6f8;font-variant-numeric:tabular-nums;white-space:nowrap}
#${PANEL_ID} .fv.bad{color:#ff8a8d}#${PANEL_ID} .fv.warn{color:#ffb46b}#${PANEL_ID} .fv.ok{color:#74dca3}
#${PANEL_ID} .body{flex:1 1 auto;min-height:0;overflow:auto;padding:6px 10px 8px}
#${PANEL_ID} .read{min-height:18px;font-size:12.5px;color:#ffe08a;font-variant-numeric:tabular-nums;padding:2px 2px 4px}
#${PANEL_ID} .ev{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:2px 14px;margin-top:6px;font-size:12px}
#${PANEL_ID} .ev span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${PANEL_ID} .ev b{color:#c3cbd3;font-weight:600;font-variant-numeric:tabular-nums;display:inline-block;min-width:56px}
#${PANEL_ID} .note{font-size:11.5px;color:var(--gg-label);margin-top:6px}
#${PANEL_ID} .empty{padding:18px;color:var(--gg-label);text-align:center}
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
  private _pending = false;
  private _season: { season: Season; why: string } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _draw: MovementGuideDraw;
  private _map: SiteMap;
  private _el: HTMLElement | null = null;
  private _open = false;
  private _layout: ChartLayout | null = null;

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
    void this._ensureBundle();
    EngineLogger.nextStep(ENGINE, 'X-Section on: draw a line, or right-click a line → X-Section…');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._draw.cancel(false);
    this.openPanel(false);
    this._map.clear();
    this._unbindKeys();
    siteHint(HINT, ICON, null);
    this._bundle?.destroy();
    this._bundle = null;
    this._bundleState = 'off';
    this._bundleKey = '';
  }

  destroy(): void {
    this.disable();
    this._el?.remove();
    this._el = null;
    this._parts = null;
    this._last = {};
    this._map.destroy();
  }

  onViewChanged(): void {
    this._draw.cancel(false);
    this._map.destroy();
    if (this._enabled) this._paint();
  }

  openPanel(open = true): void {
    if (!open) {
      this._open = false;
      this._el?.classList.remove('ms-open');
      this._map.hover(null);
      return;
    }
    if (!this._enabled) return;
    ensureCss();
    if (!this._el) this._build();
    this._open = true;
    fitBelowBar(this._el!);
    this._el!.classList.add('ms-open');
    this._render();
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

  /** Read a line (Web Mercator points, or lng / lat when `lngLat`). */
  setLine(pts: Array<[number, number]>, o: { lngLat?: boolean; name?: string } = {}): void {
    const path = pts.map((p) => (o.lngLat ? lngLatToMerc(p[0], p[1]) : ([p[0], p[1]] as XY)));
    if (path.length < 2) return;
    this._path = path;
    this._pathName = o.name ?? 'drawn line';
    this.openPanel(true);
    this._schedule();
  }

  /** Read a placed line or area symbol. Returns false when it has no line to read. */
  useGraphic(g: any): boolean {
    const path = pathOf(g?.geometry);
    if (!path) return false;
    let name = '';
    try {
      name = String(g.attributes?.drawEssentials?.AMPLIFIER?.UNIQUE_DESIG ?? '') || String(g.attributes?.symbolName ?? '');
    } catch {
      name = '';
    }
    this._path = path;
    this._pathName = name ? `"${name}"` : g.geometry.type === 'polygon' ? 'the area\'s edge' : 'the selected line';
    this.openPanel(true);
    this._schedule();
    return true;
  }

  /** Can this graphic be read (a line or area)? */
  canUse(g: any): boolean {
    return !!pathOf(g?.geometry);
  }

  drawLine(): void {
    if (!this._enabled) return;
    this._draw.start({
      kind: 'line',
      prompt: 'Draw the line: click points, double-click to finish (Backspace takes the last point back, Esc cancels)',
      onStatus: (t) => siteHint(HINT, ICON, t),
      onCancel: () => siteHint(HINT, ICON, null),
      onDone: (pts) => {
        siteHint(HINT, ICON, null);
        if (pts.length >= 2) {
          this._path = pts.map((p) => [p[0], p[1]] as XY);
          this._pathName = 'drawn line';
          this.openPanel(true);
          this._schedule();
        }
      },
    });
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
    const onFoot = mover === 'dismounted' || mover === 'pack';
    b.begin();
    try {
      this._res = profileLine(b, this._path, rule, {
        stepM: 30,
        steepPct: steepFor(mover),
        onFoot,
        sightFrom: threat ? { at: threat, eyeM: this._opts.eyeM, targetM: onFoot ? 1.8 : 2.5 } : null,
      });
    } catch (err) {
      this._res = null;
      EngineLogger.error(ENGINE, `Line not read: ${(err as Error)?.message ?? err}`);
    }
    this._pending = b.pending() || (prec === null && b.climateLoading);
    this._paint();
    this._render();
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
      e('Sample spacing', `every ${Math.round(this._res.stepM)} m (30 m, wider for a long line: at most 1,500 samples)`),
      e('Crossing or along', 'a linear feature crossed in 250 m or less is a crossing; more is a stretch along it'),
      e('Climb', `a rise or fall counts once it reaches ${CLIMB_STEP_M} m (about the GLO-30 elevation's vertical noise)`),
      e('Slope', 'measured along the line over a 60 m base'),
    ];
    if (this._res.stats.seenShare !== null) {
      out.push(e('Seen', `chance 0.5 or more that an eye ${this._opts.eyeM} m up at the threat marker sees ${this._opts.mover === 'dismounted' || this._opts.mover === 'pack' ? 1.8 : 2.5} m above the line (OCOKA sight engine: 30 m elevation plus trees, crops and buildings from OcokaDoctrine.json, proposals)`));
      out.push({ basis: 'D', book: 'Your input', page: '', quote: "the Ground Guide's threat marker", role: 'data', checked: null, figure: 'Threat place' });
      out.push(cat('bld', 'Bldgs in the line of sight'));
    }
    return out;
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────

  text(): string {
    const p = this._res;
    if (!p) return '';
    const L: string[] = [];
    const mover = this._moverLabel();
    L.push(`X-SECTION: ${this._pathName}, ${fmtM(p.lengthM)}, ${mover}, ${this._season?.season === 'wet' ? 'after rain' : 'dry'} (${MONTHS[this._month() - 1]})`);
    if (this._path) L.push(`From ${this._grid(this._path[0])} to ${this._grid(this._path[this._path.length - 1])}`);
    const s = p.stats;
    L.push(`Height ${Math.round(s.minElev ?? 0)}-${Math.round(s.maxElev ?? 0)} m, up ${Math.round(s.gainM)} m, down ${Math.round(s.lossM)} m, steepest ${Math.round(s.maxSlopePct)}% at ${fmtM(s.maxSlopeAtM)}`);
    L.push(`Going: GO ${fmtM(s.goM)}, SLOW-GO ${fmtM(s.slowM)}, NO-GO ${fmtM(s.nogoM)}${s.unknownM > 1 ? `, not read ${fmtM(s.unknownM)}` : ''}`);
    if (s.seenShare !== null) L.push(`Seen by the threat: ${Math.round(s.seenShare * 100)}% of the line`);
    L.push('');
    for (const e of p.events) L.push(`${fmtM(e.m).padStart(8)}  ${e.label}${e.going && e.going !== 'go' ? ` (${e.going === 'nogo' ? 'NO-GO' : 'SLOW-GO'})` : ''}`);
    for (const g of p.gaps) L.push(`${fmtM(g.fromM).padStart(8)}  No data (${g.what === 'both' ? 'height and class' : g.what === 'elev' ? 'height' : 'class'}) to ${fmtM(g.toM)}`);
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
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'X-Section');
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const a = t.dataset.act;
      if (a === 'close') this.openPanel(false);
      else if (a === 'draw') this.drawLine();
      else if (a === 'sel') {
        const g = (this._host.selected?.() ?? []).find((x: any) => this.canUse(x));
        if (!g || !this.useGraphic(g)) siteHint(HINT, ICON, 'Select a line or area symbol on the map first', 2200);
      } else if (a === 'copy') void this.copyText();
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const k = t.dataset?.ctl;
      if (k === 'mover') this.setOptions({ mover: t.value });
      else if (k === 'month') this.setOptions({ month: Number(t.value) || 0 });
      else if (k === 'seen') this.setOptions({ seen: (t as HTMLInputElement).checked });
    });
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') e.stopPropagation();
    });
    document.body.appendChild(el);
    this._el = el;
  }

  private _render(): void {
    if (!this._open || !this._el) return;
    const p = this._res;
    const rules: any = this._bundle?.rules;
    const movers = MOVERS.filter((k) => !rules || rules.profiles?.[k]);
    const threatOn = !!this._host.threat?.();
    const head =
      `<div class="h"><span class="t">${ICON} X-Section</span>` +
      `<label>Mover <select data-ctl="mover">${movers.map((k) => `<option value="${k}"${k === this._opts.mover ? ' selected' : ''}>${esc(this._moverLabel(k))}</option>`).join('')}</select></label>` +
      `<label>Month <select data-ctl="month"><option value="0">This month (${MONTHS[new Date().getMonth()]})</option>${MONTHS.map((m, i) => `<option value="${i + 1}"${Number(this._opts.month) === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select></label>` +
      `<label title="${threatOn ? 'What the Ground Guide\'s threat marker sees along the line' : 'Set a threat marker (Ground Guide Extended View) to read what it sees'}"><input type="checkbox" data-ctl="seen"${this._opts.seen ? ' checked' : ''}${threatOn ? '' : ' disabled'}> Seen by threat</label>` +
      `<span class="sp"></span><button data-act="draw" class="${this._path ? '' : 'pri'}">Draw line</button><button data-act="sel">Selected line</button>` +
      `<button data-act="copy"${p ? '' : ' disabled'}>Copy as Text</button><button class="x" data-act="close" aria-label="Close" title="Close (Esc)">×</button></div>`;
    let facts = '';
    let body = '';
    if (this._bundleState === 'loading') body = '<div class="empty">Opening the terrain data…</div>';
    else if (this._bundleState === 'missing') body = '<div class="empty">Needs terrain data: no terrain bundle at this address.</div>';
    else if (!this._path) body = '<div class="empty">Draw a line on the map, use the selected line, or right-click a line → X-Section…</div>';
    else if (!p) body = '<div class="empty">Reading the line…</div>';
    else {
      const s = p.stats;
      const cross = Object.entries(s.crossings).map(([k, n]) => `${n} ${OBSTACLE_WORD[k as keyof typeof OBSTACLE_WORD]}`).join(', ') || 'none';
      const f = (k: string, v: string, tone = '') => `<div class="f"><span class="fk">${esc(k)}</span><span class="fv ${tone}">${esc(v)}</span></div>`;
      facts =
        `<div class="facts">` +
        f('Line', `${fmtM(p.lengthM)} (${this._pathName})`) +
        f('Height', `${Math.round(s.minElev ?? 0)}-${Math.round(s.maxElev ?? 0)} m`) +
        f('Up / down', `${Math.round(s.gainM)} / ${Math.round(s.lossM)} m`) +
        f('Steepest', `${Math.round(s.maxSlopePct)}% at ${fmtM(s.maxSlopeAtM)}`, s.maxSlopePct >= steepFor(this._opts.mover) ? 'bad' : '') +
        f(`NO-GO (${this._moverLabel()})`, s.nogoM > 0 ? `${fmtM(s.nogoM)} in ${p.nogo.length}` : 'none', s.nogoM > 0 ? 'bad' : 'ok') +
        f('SLOW-GO', s.slowM > 0 ? fmtM(s.slowM) : 'none', s.slowM > 0 ? 'warn' : '') +
        f('Crossings', cross) +
        (s.seenShare !== null ? f('Seen by threat', `${Math.round(s.seenShare * 100)}%`, s.seenShare > 0.5 ? 'warn' : '') : '') +
        f('No data', s.gapM > 1 ? fmtM(s.gapM) : 'none', s.gapM > 1 ? 'warn' : 'ok') +
        `</div>`;
      const W = Math.max(480, Math.min(976, (this._el.clientWidth || 980) - 22));
      const km = (m: number) => (markerStep(p.lengthM) < 1000 ? `${(m / 1000).toFixed(1)}` : `${Math.round(m / 1000)}`) + ' km';
      const { svg, L } = chartSvg(p, W, { withSeen: s.seenShare !== null, km });
      this._layout = L;
      const ev = p.events
        .filter((e) => e.kind !== 'steep')
        .map((e) => `<span title="${esc(e.label)}"><b>${esc(fmtM(e.m))}</b> ${esc(e.label)}${e.going && e.going !== 'go' ? ` <em style="color:${e.going === 'nogo' ? '#ff8a8d' : '#ffb46b'};font-style:normal">${e.going === 'nogo' ? 'NO-GO' : 'SLOW-GO'}</em>` : ''}</span>`)
        .concat(p.gaps.map((g) => `<span><b>${esc(fmtM(g.fromM))}</b> <em style="color:#9aa3ad;font-style:normal">No data (${g.what === 'both' ? 'height, class' : g.what === 'elev' ? 'height' : 'class'}) to ${esc(fmtM(g.toM))}</em></span>`))
        .join('');
      body =
        `<div class="read">${this._pending ? 'Reading the ground… the chart fills as tiles arrive' : 'Move along the chart to read a point; the marker follows on the map'}</div>` +
        svg +
        (ev ? `<div class="ev">${ev}</div>` : '<div class="note">No obstacles on the line.</div>') +
        `<div class="note">Read every ${Math.round(p.stepM)} m from the terrain bundle (30 m elevation, ground class, wet layer, soil): going for ${esc(this._moverLabel())} ${this._season?.season === 'wet' ? 'after rain' : 'dry'} (${esc(this._season?.why ?? '')}); steep from ${steepFor(this._opts.mover)}% (rules.json slope classes); a crossing is a linear feature crossed in 250 m or less.${s.seenShare !== null ? ` Seen: chance 0.5 or more from the threat marker at ${this._opts.eyeM} m eye height.` : ''} Hatched: no data.</div>` +
        `<details class="note" style="margin-top:4px"><summary style="cursor:pointer;color:#8ec1ea">📖 What this rests on: data with sources and dates, rules, thresholds (${this.backing().length})</summary><ul style="margin:4px 0 0;padding-left:16px">${this.backing().map((r) => `<li>${esc(refLine(r))}</li>`).join('')}</ul></details>`;
    }
    if (!this._parts) {
      this._el.innerHTML = '<div class="xs-head"></div><div class="xs-facts"></div><div class="body"></div>';
      this._parts = { head: this._el.children[0] as HTMLElement, facts: this._el.children[1] as HTMLElement, body: this._el.children[2] as HTMLElement };
    }
    // only what changed is rewritten: a select in use keeps its focus while tiles arrive
    const set = (k: 'head' | 'facts' | 'body', html: string): boolean => {
      if (this._last[k] === html) return false;
      this._last[k] = html;
      this._parts![k].innerHTML = html;
      return true;
    };
    set('head', head);
    set('facts', facts);
    if (set('body', body)) this._wireHover();
  }

  private _parts: { head: HTMLElement; facts: HTMLElement; body: HTMLElement } | null = null;
  private _last: Record<string, string> = {};

  private _wireHover(): void {
    const p = this._res;
    const L = this._layout;
    const svg = this._el?.querySelector('svg');
    const hit = svg?.querySelector('.xs-hit') as SVGRectElement | null;
    const g = svg?.querySelector('.xs-hover') as SVGGElement | null;
    const line = svg?.querySelector('.xs-hl') as SVGLineElement | null;
    const dot = svg?.querySelector('.xs-hd') as SVGCircleElement | null;
    const read = this._el?.querySelector('.read') as HTMLElement | null;
    if (!p || !L || !svg || !hit || !g || !line || !dot || !read) return;
    const rules: any = this._bundle?.rules;
    hit.addEventListener('mousemove', (ev: MouseEvent) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * L.W;
      const m = Math.max(0, Math.min(p.lengthM, ((px - L.padL) / (L.W - L.padL - L.padR)) * p.lengthM));
      let i = 0;
      while (i + 1 < p.samples.length && p.samples[i + 1].m <= m) i++;
      const s = p.samples[i];
      g.style.display = '';
      line.setAttribute('x1', String(L.x(m)));
      line.setAttribute('x2', String(L.x(m)));
      dot.setAttribute('cx', String(L.x(m)));
      dot.setAttribute('cy', String(Number.isFinite(s.elev) ? L.y(s.elev) : L.plotTop + L.plotH));
      const cls = s.cls !== null ? String(rules?.classes?.[String(s.cls)]?.label ?? `class ${s.cls}`) : 'no class data';
      const going = s.going === 'nogo' ? 'NO-GO' : s.going === 'slow' ? 'SLOW-GO' : s.going === 'go' ? 'GO' : 'not read';
      read.textContent = `${fmtM(s.m)} · ${Number.isFinite(s.elev) ? `${Math.round(s.elev)} m` : 'no height'}${s.slopePct !== null ? ` · ${Math.round(s.slopePct)}%` : ''} · ${cls} · ${going}${s.why && s.going !== 'go' ? ` (${s.why})` : ''}${s.seen !== null ? ` · seen ${Math.round(s.seen * 100)}%` : ''}`;
      this._map.hover([s.x, s.y]);
    });
    hit.addEventListener('mouseleave', () => {
      g.style.display = 'none';
      this._map.hover(null);
    });
  }

  // ── map ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _paint(): void {
    if (!this._enabled || !this._opts.map || !this._path) {
      this._map.clear();
      return;
    }
    const spec: MapSpec = { circle: null, polys: [], lines: [], marks: [] };
    spec.lines.push({ pts: this._path, rgb: [142, 193, 234], width: 3 });
    const p = this._res;
    if (p) {
      const along = (fromM: number, toM: number): XY[] => {
        const pts = walkPath(this._path!, Math.max(15, p.stepM / 2)).filter((q) => q.m >= fromM && q.m <= toM).map((q) => q.p);
        return pts;
      };
      for (const st of p.nogo) spec.lines.push({ pts: along(st.fromM, st.toM), rgb: [229, 72, 77], width: 5, label: st.toM - st.fromM > 150 ? `NO-GO ${st.why}` : undefined });
      for (const gp of p.gaps) spec.lines.push({ pts: along(gp.fromM, gp.toM), rgb: [154, 163, 173], width: 4, dash: true, label: 'No data' });
      const step = markerStep(p.lengthM);
      for (const q of walkPath(this._path, step)) spec.marks.push({ at: q.p, kind: 'tick', label: q.m === 0 ? '0' : fmtM(q.m) });
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
