/**
 * Compare.ts
 *
 * Compare (user, 2026-11-17: "Compare candidate positions or corridors. Let users draw a few alternatives and read them
 * against the same mover, season, and assumptions"). Off by default (`features.compare`); the top bar's ⚖ Compare turns
 * it on and opens its panel (docked on the right).
 *
 *   alternatives  up to four, lettered A-D: + Line (a corridor), + Area or + Point (a position; a point is read as a
 *                 circle of the set radius), + Selected (the selected line / area / point symbols); each can be removed;
 *   assumptions   one set for all: mover (rules.json profile), month (dry / after rain at the place), the Ground Guide's
 *                 threat marker for "seen" (eye height set here), the point radius; shown above the table;
 *   reading       CompareRead.compareAlts on the terrain bundle: corridor rows (length, climb, steepest, NO-GO, SLOW-GO,
 *                 water crossings, bridges, rly crossings, through BUA, seen by threat, no data) and position rows (area,
 *                 usable ground, tilt, firm, wet / flood, hidden from air, cover from fire, road, seen, people, no data);
 *                 the best value in each row is marked, the differences written out, and every row's "how" shown;
 *   map           layer `ms-compare`: each alternative in its colour with its letter; NO-GO stretches on corridors in red;
 *   output        Copy as Text.
 *
 * It reads the terrain bundle only while on (claude_rules.md).
 */

import EngineLogger from '../../Support/EngineLogger';
import Utils from '../../Support/utils';
import { ensureTokensCss } from '../GroundGuide/GroundGuideTokens';
import { MovementGuideDraw } from '../MovementGuide/MovementGuideDraw';
import { SiteBundle } from '../SiteScan/SiteProbe';
import { SiteMap, type MapSpec, type RGB } from '../SiteScan/SiteMap';
import { dockBelowBar, siteHint } from '../SiteScan/SitePanel';
import { MONTHS, dataCatalog, lngLatToMerc, seasonFor, type Season, type XY } from '../SiteScan/SiteScan';
import { fmtM, walkPath } from '../SiteScan/SiteLine';
import { altLength, circleRing, compareAlts, ringAreaKm2, type Alt, type CompareResult } from './CompareRead';

const ENGINE = 'Compare';
const HINT = 'ms-compare-hint';
const ICON = '⚖';
const PANEL_ID = 'ms-compare-panel';
const WET_FROM_MM = 100;
const FALLBACK_WET = [7, 8, 9];
const LETTERS = ['A', 'B', 'C', 'D'];
const ALT_RGB: Record<string, RGB> = { A: [77, 166, 255], B: [255, 159, 67], C: [74, 222, 128], D: [192, 132, 252] };
const ALT_HEX: Record<string, string> = { A: '#4da6ff', B: '#ff9f43', C: '#4ade80', D: '#c084fc' };
const MOVERS = ['dismounted', 'wheeled', 'tracked', 'pack', 'roadbound', 'generic', 'amphibious', 'oversnow'];

export interface CompareOptions {
  bundleUrl: string;
  cacheTiles: number;
  useWorker: boolean;
  mover: string;
  month: number;
  seen: boolean;
  eyeM: number;
  /** A point alternative is read as a circle of this radius (m). */
  pointRadiusM: number;
  map: boolean;
  labels: boolean;
  keys: boolean;
}

export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
  bundleUrl: '/terrain-bundle',
  cacheTiles: 384,
  useWorker: true,
  mover: 'tracked',
  month: 0,
  seen: true,
  eyeM: 2,
  pointRadiusM: 250,
  map: true,
  labels: true,
  keys: true,
};

export interface CompareHost {
  threat?: () => [number, number] | null;
  selected?: () => any[];
}

interface AltDoc {
  id: string;
  kind: 'line' | 'area' | 'point';
  pts: XY[];
  name: string;
}

function toMerc(p: number[], sr: any): XY {
  const merc = !!sr?.isWebMercator || [102100, 3857, 102113].includes(sr?.wkid);
  return merc ? [p[0], p[1]] : lngLatToMerc(p[0], p[1]);
}

const esc = (s: unknown) => Utils.escapeHtml(String(s ?? ''));

const CSS = `
#${PANEL_ID}{position:fixed;right:10px;top:118px;z-index:2147482807;width:min(640px,calc(100vw - 20px));max-height:calc(100vh - 130px);display:none;flex-direction:column;
 background:var(--gg-card);color:#f1f3f6;border:1px solid var(--gg-hair);border-radius:11px;box-shadow:0 10px 28px rgba(0,0,0,.5);font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif}
#${PANEL_ID}.ms-open{display:flex}
#${PANEL_ID} *{box-sizing:border-box}
#${PANEL_ID} .cp-head,#${PANEL_ID} .cp-strip,#${PANEL_ID} .cp-alts{flex:none}
#${PANEL_ID} .h{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 10px;background:linear-gradient(90deg,#1d2635,var(--gg-head) 45%);border-radius:11px 11px 0 0}
#${PANEL_ID} .t{font-weight:750;font-size:13.5px;color:#fff;flex:1}
#${PANEL_ID} button{font:500 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:27px;padding:0 9px;white-space:nowrap}
#${PANEL_ID} button:hover{background:rgba(255,255,255,.14);color:#fff}
#${PANEL_ID} button.x{width:27px;padding:0;font-size:17px}
#${PANEL_ID} button[disabled]{opacity:.45;cursor:default}
#${PANEL_ID} .strip{display:flex;flex-wrap:wrap;gap:5px 12px;padding:6px 10px;background:var(--gg-strip);border-bottom:1px solid var(--gg-hair-soft);font-size:12px;color:var(--gg-label)}
#${PANEL_ID} label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
#${PANEL_ID} select,#${PANEL_ID} input[type=number]{font:500 12.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;background:#11151a;border:1px solid #3d4650;border-radius:5px;padding:2px 4px;height:23px}
#${PANEL_ID} input[type=number]{width:62px;text-align:right}
#${PANEL_ID} input[type=checkbox]{accent-color:#8ec1ea}
#${PANEL_ID} .alts{display:flex;flex-wrap:wrap;gap:5px 6px;padding:6px 10px;border-bottom:1px solid var(--gg-hair)}
#${PANEL_ID} .chip{display:inline-flex;align-items:center;gap:6px;padding:2px 4px 2px 3px;border-radius:12px;background:rgba(255,255,255,.07);font-size:12.5px}
#${PANEL_ID} .chip i{display:inline-flex;width:18px;height:18px;border-radius:50%;align-items:center;justify-content:center;font-style:normal;font-weight:750;color:#14181d;font-size:11.5px}
#${PANEL_ID} .chip button{height:18px;width:18px;padding:0;border:0;background:transparent;color:#ff8a8d;font-size:14px}
#${PANEL_ID} .body{flex:1 1 auto;min-height:0;overflow:auto;padding:6px 10px 10px}
#${PANEL_ID} table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
#${PANEL_ID} th{font-size:11.5px;font-weight:650;color:var(--gg-label);text-align:left;padding:3px 6px;border-bottom:1px solid var(--gg-hair);position:sticky;top:0;background:var(--gg-card)}
#${PANEL_ID} th.alt{text-align:left}
#${PANEL_ID} td{padding:3px 6px;border-bottom:1px solid var(--gg-hair-soft);vertical-align:top;font-size:12.5px}
#${PANEL_ID} td.k{color:var(--gg-label);white-space:nowrap;cursor:help}
#${PANEL_ID} td.best{background:rgba(47,168,98,.16);color:#a6ebc4;font-weight:650}
#${PANEL_ID} td.worst{color:#ffb3b5}
#${PANEL_ID} td.bad{color:#ff8a8d}#${PANEL_ID} td.warn{color:#ffd09a}
#${PANEL_ID} tr.grp td{font-weight:700;color:#e4e8ec;border-bottom:1px solid var(--gg-hair);padding-top:8px}
#${PANEL_ID} tr.tally td{font-weight:650;color:#fff}
#${PANEL_ID} h4{margin:10px 0 4px;font-size:12.5px;color:#e4e8ec}
#${PANEL_ID} ul{margin:0;padding-left:18px;font-size:12.5px}
#${PANEL_ID} li{margin:2px 0}
#${PANEL_ID} details{margin-top:8px;font-size:12px;color:var(--gg-label)}
#${PANEL_ID} details summary{cursor:pointer;color:#e4e8ec;font-weight:650}
#${PANEL_ID} .empty{padding:18px;color:var(--gg-label);text-align:center}
`;

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-compare-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

export default class Compare {
  private _opts: CompareOptions = { ...DEFAULT_COMPARE_OPTIONS };
  private _enabled = false;
  private _host: CompareHost;
  private _bundle: SiteBundle | null = null;
  private _bundleState: 'off' | 'loading' | 'ready' | 'missing' = 'off';
  private _bundleKey = '';
  private _alts: AltDoc[] = [];
  private _res: CompareResult | null = null;
  private _season: { season: Season; why: string } | null = null;
  private _pending = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _draw: MovementGuideDraw;
  private _map: SiteMap;
  private _el: HTMLElement | null = null;
  private _open = false;
  private _parts: { head: HTMLElement; strip: HTMLElement; alts: HTMLElement; body: HTMLElement } | null = null;
  private _last: Record<string, string> = {};

  constructor(getView: () => any, host: CompareHost = {}) {
    this._host = host;
    this._draw = new MovementGuideDraw(getView);
    this._map = new SiteMap(getView, 'ms-compare', 'Compare');
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this._enabled;
  }
  get result(): CompareResult | null {
    return this._res;
  }
  get panelOpen(): boolean {
    return this._open;
  }
  get alternatives(): Array<{ id: string; kind: string; name: string }> {
    return this._alts.map((a) => ({ id: a.id, kind: a.kind, name: a.name }));
  }

  setOptions(o: Partial<CompareOptions>): void {
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null)) } as CompareOptions;
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
    EngineLogger.nextStep(ENGINE, 'Compare on: add two or more lines, areas or points');
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
      return;
    }
    if (!this._enabled) return;
    ensureCss();
    if (!this._el) this._build();
    this._open = true;
    dockBelowBar(this._el!);
    this._el!.classList.add('ms-open');
    this._render();
  }

  togglePanel(): boolean {
    this.openPanel(!this._open);
    return this._open;
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
    if (!ok) EngineLogger.error(ENGINE, `No terrain bundle at ${base}: the comparison needs terrain data`);
    this._schedule();
  }

  private _onData(): void {
    if (this._enabled && this._pending) this._schedule(300);
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

  private _moverLabel(k = this._opts.mover): string {
    return String((this._bundle?.rules as any)?.profiles?.[k]?.label ?? k);
  }

  // ── alternatives ──────────────────────────────────────────────────────────────────────────────────────────────────

  private _nextLetter(): string | null {
    return LETTERS.find((l) => !this._alts.some((a) => a.id === l)) ?? null;
  }

  /** Add an alternative (Web Mercator points, or lng / lat when `lngLat`). Returns its letter, or null when full. */
  addAlternative(kind: 'line' | 'area' | 'point', pts: Array<[number, number]>, o: { lngLat?: boolean; name?: string } = {}): string | null {
    const id = this._nextLetter();
    if (!id) {
      siteHint(HINT, ICON, 'Four alternatives at most: remove one first', 2200);
      return null;
    }
    const path = pts.map((p) => (o.lngLat ? lngLatToMerc(p[0], p[1]) : ([p[0], p[1]] as XY)));
    if ((kind === 'line' && path.length < 2) || (kind === 'area' && path.length < 3) || (kind === 'point' && path.length < 1)) return null;
    this._alts.push({ id, kind, pts: kind === 'point' ? [path[0]] : path, name: o.name ?? '' });
    this._alts.sort((a, b) => a.id.localeCompare(b.id));
    this.openPanel(true);
    this._schedule();
    return id;
  }

  removeAlternative(id: string): void {
    this._alts = this._alts.filter((a) => a.id !== id);
    this._schedule();
  }

  clear(): void {
    this._alts = [];
    this._res = null;
    this._schedule();
  }

  /** Draw a new alternative on the map. */
  drawAlternative(kind: 'line' | 'area' | 'point'): void {
    if (!this._enabled) return;
    if (!this._nextLetter()) {
      siteHint(HINT, ICON, 'Four alternatives at most: remove one first', 2200);
      return;
    }
    const prompt =
      kind === 'line' ? 'Draw the corridor: click points, double-click to finish (Esc cancels)' : kind === 'area' ? 'Draw the position: click its corners, double-click to finish (Esc cancels)' : 'Click the position (Esc cancels)';
    this._draw.start({
      kind,
      prompt,
      onStatus: (t) => siteHint(HINT, ICON, t),
      onCancel: () => siteHint(HINT, ICON, null),
      onDone: (pts) => {
        siteHint(HINT, ICON, null);
        this.addAlternative(kind, pts.map((p) => [p[0], p[1]] as [number, number]));
      },
    });
  }

  /** Add the selected line / area / point symbols. Returns how many were added. */
  addSelected(): number {
    let n = 0;
    for (const g of this._host.selected?.() ?? []) {
      const geo = g?.geometry;
      const sr = geo?.spatialReference;
      let name = '';
      try {
        name = String(g.attributes?.drawEssentials?.AMPLIFIER?.UNIQUE_DESIG ?? '');
      } catch {
        name = '';
      }
      if (geo?.type === 'polyline') {
        const pts: XY[] = [];
        for (const path of geo.paths ?? []) for (const q of path) pts.push(toMerc(q, sr));
        if (this.addAlternative('line', pts, { name })) n++;
      } else if (geo?.type === 'polygon' && geo.rings?.length) {
        if (this.addAlternative('area', (geo.rings[0] as number[][]).map((q) => toMerc(q, sr)), { name })) n++;
      } else if (geo?.type === 'point') {
        if (this.addAlternative('point', [toMerc([geo.x, geo.y], sr)], { name })) n++;
      }
    }
    if (!n) siteHint(HINT, ICON, 'Select line, area or point symbols on the map first', 2200);
    return n;
  }

  // ── running ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private _schedule(ms = 40): void {
    if (!this._enabled) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this._run();
    }, ms);
  }

  compare(): CompareResult | null {
    this._run();
    return this._res;
  }

  private _altFor(a: AltDoc): Alt {
    return { id: a.id, kind: a.kind === 'line' ? 'line' : 'area', pts: a.kind === 'point' ? circleRing(a.pts[0], this._opts.pointRadiusM) : a.pts, name: a.name };
  }

  private _run(): void {
    if (!this._enabled) return;
    const b = this._bundle;
    if (!this._alts.length || !b || this._bundleState !== 'ready') {
      this._res = null;
      this._pending = false;
      this._paint();
      this._render();
      return;
    }
    const month = this._month();
    const first = this._alts[0].pts[0];
    const prec = b.precAt(first[0], first[1]);
    this._season = seasonFor(month, prec, WET_FROM_MM, FALLBACK_WET);
    const onFoot = this._opts.mover === 'dismounted' || this._opts.mover === 'pack';
    b.begin();
    try {
      this._res = compareAlts(b, b.rules, this._alts.map((a) => this._altFor(a)), {
        mover: this._opts.mover,
        moverLabel: this._moverLabel(),
        season: this._season.season,
        seasonWhy: this._season.why,
        threat: this._threat(),
        eyeM: this._opts.eyeM,
        targetM: onFoot ? 1.8 : 2.5,
        dataLine: b.dataLine(),
        dataText: (() => {
          const cat = dataCatalog(b.manifest);
          return (k: string) => {
            const r = cat(k as any, k);
            return `${r.book}${r.quote ? ` (${r.quote})` : ''}`;
          };
        })(),
        inputText: this._alts.map((a) => `${a.id} ${a.name ? `"${a.name}" ` : ''}${a.kind === 'point' ? `a point read as a ${this._opts.pointRadiusM} m circle` : a.kind}`).join(', ') + ' (drawn on the map or the selected symbols)',
      });
    } catch (err) {
      this._res = null;
      EngineLogger.error(ENGINE, `Alternatives not read: ${(err as Error)?.message ?? err}`);
    }
    this._pending = b.pending() || (prec === null && b.climateLoading);
    this._paint();
    this._render();
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────

  text(): string {
    const r = this._res;
    if (!r) return '';
    const L: string[] = [];
    L.push(`COMPARE: ${this._alts.map((a) => `${a.id} ${a.kind}${a.name ? ` "${a.name}"` : ''}`).join(', ')}`);
    L.push(`Assumptions: ${this._moverLabel()}; ${this._season?.season === 'wet' ? 'after rain' : 'dry'} (${this._season?.why ?? ''}); threat ${this._threat() ? `marker, eye ${this._opts.eyeM} m` : 'not set'}; point = circle of ${this._opts.pointRadiusM} m`);
    L.push('');
    for (const row of r.rows) {
      const cells = Object.entries(row.cells).map(([id, c]) => `${id} ${c ? c.value : 'not read'}${row.best.includes(id) ? ' (best)' : ''}`);
      L.push(`${row.label}: ${cells.join(' | ')}`);
    }
    L.push('');
    L.push('Differences:');
    for (const d of r.diffs) L.push(`- ${d}`);
    L.push('');
    L.push('How each row was worked out:');
    for (const row of r.rows) L.push(`- ${row.label} (${row.kind === 'line' ? 'corridor' : 'position'}): ${row.how}`);
    L.push(`Data: ${this._bundle?.dataLine() ?? ''}. Check on the ground.`);
    return L.join('\n');
  }

  async copyText(): Promise<boolean> {
    const t = this.text();
    if (!t) return false;
    try {
      await navigator.clipboard.writeText(t);
      siteHint(HINT, ICON, 'Comparison copied as text', 1800);
      return true;
    } catch {
      siteHint(HINT, ICON, 'Copy failed: the browser refused the clipboard', 2200);
      return false;
    }
  }

  // ── panel ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _build(): void {
    const el = document.createElement('section');
    el.id = PANEL_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Compare');
    el.innerHTML = '<div class="cp-head"></div><div class="cp-strip"></div><div class="cp-alts"></div><div class="body"></div>';
    this._parts = { head: el.children[0] as HTMLElement, strip: el.children[1] as HTMLElement, alts: el.children[2] as HTMLElement, body: el.children[3] as HTMLElement };
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const a = t.dataset.act!;
      if (a === 'close') this.openPanel(false);
      else if (a === 'line' || a === 'area' || a === 'point') this.drawAlternative(a);
      else if (a === 'sel') this.addSelected();
      else if (a === 'clear') this.clear();
      else if (a === 'copy') void this.copyText();
      else if (a.startsWith('rm:')) this.removeAlternative(a.slice(3));
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const k = t.dataset?.ctl;
      if (k === 'mover') this.setOptions({ mover: t.value });
      else if (k === 'month') this.setOptions({ month: Number(t.value) || 0 });
      else if (k === 'seen') this.setOptions({ seen: (t as HTMLInputElement).checked });
      else if (k === 'eyeM') this.setOptions({ eyeM: Math.max(0.5, Math.min(100, Number(t.value) || 2)) });
      else if (k === 'radius') this.setOptions({ pointRadiusM: Math.max(25, Math.min(5000, Number(t.value) || 250)) });
    });
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') e.stopPropagation();
    });
    document.body.appendChild(el);
    this._el = el;
  }

  private _set(k: 'head' | 'strip' | 'alts' | 'body', html: string): void {
    if (!this._parts || this._last[k] === html) return;
    this._last[k] = html;
    this._parts[k].innerHTML = html;
  }

  private _render(): void {
    if (!this._open || !this._el) return;
    const r = this._res;
    const full = this._alts.length >= 4;
    this._set(
      'head',
      `<div class="h"><span class="t">${ICON} Compare</span>` +
        `<button data-act="line"${full ? ' disabled' : ''} title="Draw a corridor">+ Line</button><button data-act="area"${full ? ' disabled' : ''} title="Draw a position as an area">+ Area</button>` +
        `<button data-act="point"${full ? ' disabled' : ''} title="Click a position (read as a circle)">+ Point</button><button data-act="sel"${full ? ' disabled' : ''} title="The selected line / area / point symbols">+ Selected</button>` +
        `<button data-act="clear"${this._alts.length ? '' : ' disabled'}>Clear</button><button data-act="copy"${r ? '' : ' disabled'}>Copy as Text</button>` +
        `<button class="x" data-act="close" aria-label="Close" title="Close (Esc)">×</button></div>`,
    );
    const rules: any = this._bundle?.rules;
    const movers = MOVERS.filter((k) => !rules || rules.profiles?.[k]);
    const threatOn = !!this._host.threat?.();
    this._set(
      'strip',
      `<div class="strip"><label>Mover <select data-ctl="mover">${movers.map((k) => `<option value="${k}"${k === this._opts.mover ? ' selected' : ''}>${esc(this._moverLabel(k))}</option>`).join('')}</select></label>` +
        `<label>Month <select data-ctl="month"><option value="0">This month (${MONTHS[new Date().getMonth()]})</option>${MONTHS.map((m, i) => `<option value="${i + 1}"${Number(this._opts.month) === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select></label>` +
        `<label title="${threatOn ? 'What the Ground Guide\'s threat marker sees' : 'Set a threat marker (Ground Guide Extended View) to read what it sees'}"><input type="checkbox" data-ctl="seen"${this._opts.seen ? ' checked' : ''}${threatOn ? '' : ' disabled'}> Seen by threat, eye <input type="number" data-ctl="eyeM" min="0.5" max="100" step="0.5" value="${this._opts.eyeM}"> m</label>` +
        `<label title="A point is read as a circle of this radius">Point radius <input type="number" data-ctl="radius" min="25" max="5000" step="25" value="${this._opts.pointRadiusM}"> m</label></div>`,
    );
    this._set(
      'alts',
      this._alts.length
        ? `<div class="alts">${this._alts
            .map((a) => {
              const what = a.kind === 'line' ? `corridor ${fmtM(altLength(a.pts))}` : a.kind === 'area' ? `area ${ringAreaKm2(a.pts).toFixed(2)} km²` : `point (${this._opts.pointRadiusM} m circle)`;
              return `<span class="chip"><i style="background:${ALT_HEX[a.id]}">${a.id}</i>${esc(a.name ? `${a.name}, ${what}` : what)}<button data-act="rm:${a.id}" aria-label="Remove ${a.id}" title="Remove ${a.id}">×</button></span>`;
            })
            .join('')}</div>`
        : '',
    );
    let body = '';
    if (this._bundleState === 'loading') body = '<div class="empty">Opening the terrain data…</div>';
    else if (this._bundleState === 'missing') body = '<div class="empty">Needs terrain data: no terrain bundle at this address.</div>';
    else if (!this._alts.length) body = '<div class="empty">Add two or more corridors (+ Line) or positions (+ Area, + Point), or select symbols and + Selected. All are read with the same mover, month and threat.</div>';
    else if (!r) body = '<div class="empty">Reading…</div>';
    else {
      const ids = this._alts.map((a) => a.id);
      const head = `<tr><th></th>${ids.map((id) => `<th class="alt"><span style="color:${ALT_HEX[id]}">●</span> ${id}</th>`).join('')}</tr>`;
      const rowsHtml = (kind: 'line' | 'area', title: string) => {
        const rows = r.rows.filter((x) => x.kind === kind);
        if (!rows.length) return '';
        const own = this._alts.filter((a) => (kind === 'line' ? a.kind === 'line' : a.kind !== 'line')).map((a) => a.id);
        const tr = rows
          .map((row) => {
            const tds = ids
              .map((id) => {
                if (!own.includes(id)) return '<td>—</td>';
                const c = row.cells[id];
                if (!c) return '<td class="warn">not read</td>';
                const cls = row.best.includes(id) ? 'best' : row.worst.includes(id) ? 'worst' : c.tone === 'bad' ? 'bad' : c.tone === 'warn' ? 'warn' : '';
                return `<td class="${cls}">${esc(c.value)}</td>`;
              })
              .join('');
            return `<tr><td class="k" title="${esc(row.how)}">${esc(row.label)}${row.better ? '' : ' ·'}</td>${tds}</tr>`;
          })
          .join('');
        const tally = `<tr class="tally"><td>Best on</td>${ids.map((id) => (own.includes(id) ? `<td>${r.tally[id]?.best ?? 0} of ${r.tally[id]?.of ?? 0}</td>` : '<td>—</td>')).join('')}</tr>`;
        return `<tr class="grp"><td colspan="${ids.length + 1}">${title}</td></tr>${tr}${tally}`;
      };
      body =
        (this._pending ? '<div class="empty" style="padding:4px">Reading the ground… the table fills as tiles arrive</div>' : '') +
        `<table>${head}${rowsHtml('line', 'Corridors')}${rowsHtml('area', 'Positions')}</table>` +
        `<h4>Differences</h4><ul>${r.diffs.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` +
        (r.notes.length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '') +
        `<details><summary>How each row was worked out</summary><p>Same for every alternative: ${esc(this._moverLabel())}; ${this._season?.season === 'wet' ? 'after rain' : 'dry'} (${esc(this._season?.why ?? '')}); threat ${this._threat() ? `marker, eye ${this._opts.eyeM} m` : 'not set'}; a point is a circle of ${this._opts.pointRadiusM} m. Rows marked · are shown, not ranked. A row ranks only when the alternatives differ by more than its smallest real difference.</p>` +
        `<ul>${r.rows.filter((x, i, a) => a.findIndex((y) => y.key === x.key && y.kind === x.kind) === i).map((row) => `<li><b>${esc(row.label)}</b> (${row.kind === 'line' ? 'corridor' : 'position'}): ${esc(row.how)}</li>`).join('')}</ul><p>Data: ${esc(this._bundle?.dataLine() ?? '')}. Check on the ground.</p></details>`;
    }
    this._set('body', body);
  }

  // ── map ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _paint(): void {
    if (!this._enabled || !this._opts.map || !this._alts.length) {
      this._map.clear();
      return;
    }
    const spec: MapSpec = { circle: null, polys: [], lines: [], marks: [] };
    for (const a of this._alts) {
      const rgb = ALT_RGB[a.id];
      if (a.kind === 'line') {
        spec.lines.push({ pts: a.pts, rgb, width: 3.5 });
        const p = this._res?.lines[a.id];
        if (p) {
          for (const st of p.nogo) {
            const pts = walkPath(a.pts, Math.max(15, p.stepM / 2)).filter((q) => q.m >= st.fromM && q.m <= st.toM).map((q) => q.p);
            spec.lines.push({ pts, rgb: [229, 72, 77], width: 6, label: st.toM - st.fromM > 200 ? `${a.id}: NO-GO ${st.why}` : undefined });
          }
        }
        spec.marks.push({ at: a.pts[0], kind: 'letter', letter: a.id, rgb });
      } else {
        const ring = a.kind === 'point' ? circleRing(a.pts[0], this._opts.pointRadiusM) : a.pts;
        spec.polys.push({ ring, tone: 'unknown', selected: false, rgb });
        let cx = 0, cy = 0;
        for (const q of ring) {
          cx += q[0];
          cy += q[1];
        }
        spec.marks.push({ at: [cx / ring.length, cy / ring.length], kind: 'letter', letter: a.id, rgb });
      }
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
