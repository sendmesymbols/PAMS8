/**
 * Compare.ts
 *
 * Compare (user, 2026-11-17: "Compare candidate positions or corridors. Let users draw a few alternatives and read them
 * against the same mover, season, and assumptions"). Off by default (`features.compare`); the top bar's ⚖ Compare turns
 * it on and opens its panel (docked on the right).
 *
 *   alternatives  up to four, lettered A-D: + Line (a corridor), + Area or + Point (a position; a point is read as a
 *                 circle of the set radius), + Selected (the selected line / area / point symbols); each is a card with
 *                 what to check first on it (NO-GO, steep, soft or wet ground, no road, no data); click its letter to
 *                 show it on the map, × removes it;
 *   assumptions   one set for all: mover (rules.json profile), month (dry / after rain at the place), the Ground Guide's
 *                 threat marker for "seen" (eye height set here), the point radius; shown above the table;
 *   reading       CompareRead.compareAlts on the terrain bundle: corridor rows (length, climb, steepest, NO-GO, SLOW-GO,
 *                 water crossings, bridges, rly crossings, through BUA, seen by threat, no data) and position rows (area,
 *                 usable ground, tilt, firm, wet / flood, hidden from air, cover from fire, road, seen, people, no data),
 *                 each kind in its own table with its own columns; the best value in each row is marked "best", the
 *                 worst "worst", the differences written out, and every row's method one click away (ⓘ);
 *   map           layer `ms-compare`: each alternative in its colour with its letter; NO-GO stretches on corridors in red;
 *   output        Copy as Text.
 *
 * 18 Nov 2026 (Compare Option UI and bugs): cards with flags, tables per kind, values on two lines, "not ranked" said
 * in words, a filter to the rows that differ or need a check, the panel steps aside while an alternative is drawn,
 * alternatives off the view are brought into it, selected lines use their whole curve (CTRL_PTS), the area's road is read
 * from its centroid, and "seen by threat" with no threat set is said so instead of reading "not read".
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
import { altLength, cellText, circleRing, compareAlts, ringAreaKm2, ringCentroid, type Alt, type AltKind, type CompareResult, type CompareRow } from './CompareRead';

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
const FULL_HINT = 'Four alternatives at most: remove one first';

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
  /** Where it came from: drawn on the map, the selected symbol, or added by code. */
  src: 'drawn' | 'selected' | 'code';
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
#${PANEL_ID}.ms-open.ms-hide{display:none}
#${PANEL_ID} *{box-sizing:border-box}
#${PANEL_ID} .cp-head,#${PANEL_ID} .cp-add,#${PANEL_ID} .cp-strip,#${PANEL_ID} .cp-alts{flex:none}
#${PANEL_ID} .h{display:flex;align-items:center;gap:6px;padding:7px 10px;background:linear-gradient(90deg,#1d2635,var(--gg-head) 45%);border-radius:11px 11px 0 0}
#${PANEL_ID} .t{font-weight:750;font-size:13.5px;color:#fff;flex:1}
#${PANEL_ID} button{font:500 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:27px;padding:0 9px;white-space:nowrap}
#${PANEL_ID} button:hover{background:rgba(255,255,255,.14);color:#fff}
#${PANEL_ID} button:focus-visible,#${PANEL_ID} select:focus-visible,#${PANEL_ID} input:focus-visible,#${PANEL_ID} summary:focus-visible{outline:2px solid var(--gg-accent);outline-offset:1px}
#${PANEL_ID} button.x{width:27px;padding:0;font-size:17px}
#${PANEL_ID} button.pri{background:#2b5d86;border-color:#4f8ab8;color:#fff}
#${PANEL_ID} button.pri:hover{background:#34709f}
#${PANEL_ID} button[disabled]{opacity:.45;cursor:default}
#${PANEL_ID} .add{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--gg-hair-soft)}
#${PANEL_ID} .add .k{color:var(--gg-label);font-size:12px;margin-right:2px}
#${PANEL_ID} .add .n{margin-left:auto;color:var(--gg-label);font-size:12px}
#${PANEL_ID} .strip{display:flex;flex-wrap:wrap;gap:5px 12px;align-items:center;padding:6px 10px;background:var(--gg-strip);border-bottom:1px solid var(--gg-hair-soft);font-size:12px;color:var(--gg-label)}
#${PANEL_ID} label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
#${PANEL_ID} select,#${PANEL_ID} input[type=number]{font:500 12.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;background:#11151a;border:1px solid #3d4650;border-radius:5px;padding:2px 4px;height:23px}
#${PANEL_ID} input[type=number]{width:62px;text-align:right}
#${PANEL_ID} input[type=checkbox]{accent-color:#8ec1ea}
#${PANEL_ID} .mut{color:#9aa3ad;font-size:11.5px}
#${PANEL_ID} .alts{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:6px;padding:7px 10px;border-bottom:1px solid var(--gg-hair)}
#${PANEL_ID} .card{display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:center;padding:6px 6px 6px 8px;border-radius:8px;background:rgba(255,255,255,.05);border-left:3px solid var(--c)}
#${PANEL_ID} .card .bd{width:24px;height:24px;border-radius:50%;padding:0;background:var(--c);border:0;color:#14181d;font-weight:750;font-size:12.5px}
#${PANEL_ID} .card .bd:hover{background:var(--c);filter:brightness(1.15);color:#14181d}
#${PANEL_ID} .card .ct{min-width:0;display:flex;flex-direction:column}
#${PANEL_ID} .card .ct b{font-size:12.5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${PANEL_ID} .card .ct span{font-size:11.5px;color:var(--gg-label)}
#${PANEL_ID} .card button.rm{width:22px;height:22px;padding:0;border:0;background:transparent;color:#ff8a8d;font-size:15px}
#${PANEL_ID} .flags{grid-column:2/4;display:flex;flex-wrap:wrap;gap:3px 4px}
#${PANEL_ID} .fl{font-size:11.5px;padding:1px 7px;border-radius:9px;background:rgba(255,255,255,.08);color:#d5dbe1}
#${PANEL_ID} .fl.bad{background:rgba(229,72,77,.2);color:#ffb3b5}
#${PANEL_ID} .fl.warn{background:rgba(238,138,31,.2);color:#ffd09a}
#${PANEL_ID} .fl.none{color:#9aa3ad}
#${PANEL_ID} .body{flex:1 1 auto;min-height:0;overflow:auto;padding:6px 10px 10px}
#${PANEL_ID} .filt{display:flex;align-items:center;gap:10px;margin:2px 0 4px;font-size:12px;color:var(--gg-label)}
#${PANEL_ID} .filt .g{margin-left:auto}
#${PANEL_ID} table{border-collapse:collapse;width:100%;table-layout:fixed;font-variant-numeric:tabular-nums;margin-bottom:6px}
#${PANEL_ID} caption{text-align:left;font-weight:700;font-size:12.5px;color:#e4e8ec;padding:8px 0 3px}
#${PANEL_ID} th{font-size:11.5px;font-weight:650;color:var(--gg-label);text-align:left;padding:3px 6px;border-bottom:1px solid var(--gg-hair)}
#${PANEL_ID} th.dot span{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
#${PANEL_ID} col.k{width:132px}
#${PANEL_ID} td,#${PANEL_ID} tbody th{padding:4px 6px;border-bottom:1px solid var(--gg-hair-soft);vertical-align:top;font-size:12.5px;overflow-wrap:anywhere}
#${PANEL_ID} tbody th{font-weight:500;color:var(--gg-label)}
#${PANEL_ID} tbody th button.i{height:16px;width:16px;padding:0;margin-left:4px;border-radius:50%;font-size:10px;line-height:14px;vertical-align:1px;background:transparent;border-color:rgba(255,255,255,.25);color:#9aa3ad}
#${PANEL_ID} tbody th button.i[aria-expanded=true]{background:#e4e8ec;color:#14181d}
#${PANEL_ID} .nr{display:block;font-size:10.5px;color:#7f8892}
#${PANEL_ID} td .v{display:block;color:#f4f6f8}
#${PANEL_ID} td .s{display:block;font-size:11.5px;color:var(--gg-label)}
#${PANEL_ID} td .tg{display:inline-block;margin-top:1px;font-style:normal;font-size:10px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;padding:0 5px;border-radius:7px}
#${PANEL_ID} td.best{background:rgba(47,168,98,.16)}
#${PANEL_ID} td.best .v{color:#a6ebc4;font-weight:650}
#${PANEL_ID} td.best .tg{background:rgba(47,168,98,.35);color:#c9f4dc}
#${PANEL_ID} td.worst .v{color:#ffb3b5}
#${PANEL_ID} td.worst .tg{background:rgba(229,72,77,.28);color:#ffc9cb}
#${PANEL_ID} td.bad .v{color:#ff8a8d}#${PANEL_ID} td.warn .v{color:#ffd09a}#${PANEL_ID} td.unk .v{color:#9aa3ad}
#${PANEL_ID} tr.how td{font-size:11.5px;color:#c3cbd3;background:rgba(255,255,255,.03)}
#${PANEL_ID} tr.tally th,#${PANEL_ID} tr.tally td{font-weight:650;color:#fff}
#${PANEL_ID} h4{margin:10px 0 4px;font-size:12.5px;color:#e4e8ec}
#${PANEL_ID} ul{margin:0;padding-left:18px;font-size:12.5px}
#${PANEL_ID} li{margin:2px 0}
#${PANEL_ID} details{margin-top:8px;font-size:12px;color:var(--gg-label)}
#${PANEL_ID} details summary{cursor:pointer;color:#e4e8ec;font-weight:650}
#${PANEL_ID} .empty{padding:16px 12px;color:var(--gg-label)}
#${PANEL_ID} .empty ol{margin:8px 0 0;padding-left:20px;color:#d5dbe1}
#${PANEL_ID} .busy{padding:3px 0 5px;font-size:12px;color:#8ec1ea}
#${PANEL_ID} .none-rows{padding:6px 0;color:var(--gg-label);font-size:12px}
@media (max-width:520px){#${PANEL_ID} col.k{width:96px}#${PANEL_ID} .alts{grid-template-columns:1fr}}
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

type PartKey = 'head' | 'add' | 'strip' | 'alts' | 'body';

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
  private _resize: (() => void) | null = null;
  private _draw: MovementGuideDraw;
  private _map: SiteMap;
  private _el: HTMLElement | null = null;
  private _open = false;
  private _parts: Record<PartKey, HTMLElement> | null = null;
  private _last: Record<string, string> = {};
  /** Rows whose method is unfolded (kind:key). */
  private _openRows = new Set<string>();
  /** Show only the rows that differ or need a check. */
  private _onlyDiff = false;

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
    this._el?.classList.remove('ms-hide');
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
    this._draw.destroy();
  }

  onViewChanged(): void {
    this._draw.cancel(false);
    this._el?.classList.remove('ms-hide');
    this._map.destroy();
    if (this._enabled) this._paint();
  }

  openPanel(open = true): void {
    if (!open) {
      this._open = false;
      this._el?.classList.remove('ms-open');
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
      return;
    }
    if (!this._enabled) return;
    ensureCss();
    if (!this._el) this._build();
    this._open = true;
    dockBelowBar(this._el!);
    this._el!.classList.add('ms-open');
    if (!this._resize) {
      this._resize = () => {
        if (this._el && this._open) dockBelowBar(this._el);
      };
      window.addEventListener('resize', this._resize);
    }
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

  /** The assumptions in words (the panel, the text and the notes say the same). */
  private _assume(): string {
    const thr = this._host.threat?.();
    const threat = !this._opts.seen ? 'threat not read (off)' : thr ? `threat marker, eye ${this._opts.eyeM} m` : 'threat not set';
    return `${this._moverLabel()}; ${this._season?.season === 'wet' ? 'after rain' : 'dry'} (${this._season?.why ?? ''}); ${threat}; a point is a circle of ${this._opts.pointRadiusM} m`;
  }

  // ── alternatives ──────────────────────────────────────────────────────────────────────────────────────────────────

  private _nextLetter(): string | null {
    return LETTERS.find((l) => !this._alts.some((a) => a.id === l)) ?? null;
  }

  /** Add an alternative (Web Mercator points, or lng / lat when `lngLat`). Returns its letter, or null when full. */
  addAlternative(kind: 'line' | 'area' | 'point', pts: Array<[number, number]>, o: { lngLat?: boolean; name?: string; src?: AltDoc['src'] } = {}): string | null {
    const id = this._nextLetter();
    if (!id) {
      siteHint(HINT, ICON, FULL_HINT, 2200);
      return null;
    }
    const path = pts.map((p) => (o.lngLat ? lngLatToMerc(p[0], p[1]) : ([p[0], p[1]] as XY)));
    if ((kind === 'line' && path.length < 2) || (kind === 'area' && path.length < 3) || (kind === 'point' && path.length < 1)) return null;
    const alt: AltDoc = { id, kind, pts: kind === 'point' ? [path[0]] : path, name: o.name ?? '', src: o.src ?? 'code' };
    this._alts.push(alt);
    this._alts.sort((a, b) => a.id.localeCompare(b.id));
    this.openPanel(true);
    // one the view does not show is brought into it (the panel keeps to the right)
    if (this._opts.map && this._map.outside(this._ring(alt))) this._map.fit(this._ring(alt));
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

  /** The points to show for an alternative: its path, or the circle read for a point. */
  private _ring(a: AltDoc): XY[] {
    return a.kind === 'point' ? circleRing(a.pts[0], this._opts.pointRadiusM) : a.pts;
  }

  /** Show one alternative on the map. */
  showAlternative(id: string): void {
    const a = this._alts.find((x) => x.id === id);
    if (a) this._map.fit(this._ring(a));
  }

  /** Draw a new alternative on the map; the panel steps aside while drawing. */
  drawAlternative(kind: 'line' | 'area' | 'point'): void {
    if (!this._enabled) return;
    if (!this._nextLetter()) {
      siteHint(HINT, ICON, FULL_HINT, 2200);
      return;
    }
    const prompt =
      kind === 'line' ? 'Draw the corridor: click points, double-click the last (Backspace takes one back, Esc cancels)' : kind === 'area' ? 'Draw the position: click its corners, double-click the last (Backspace takes one back, Esc cancels)' : 'Click the position (Esc cancels)';
    const back = () => this._el?.classList.remove('ms-hide');
    this._el?.classList.add('ms-hide');
    this._draw.start({
      kind,
      prompt,
      onStatus: (t) => siteHint(HINT, ICON, t),
      onCancel: () => {
        siteHint(HINT, ICON, null);
        back();
      },
      onDone: (pts) => {
        siteHint(HINT, ICON, null);
        back();
        this.addAlternative(kind, pts.map((p) => [p[0], p[1]] as [number, number]), { src: 'drawn' });
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
        // the whole route when the symbol keeps it (CTRL_PTS), else the drawn path
        const ctrl = g.attributes?.drawEssentials?.CTRL_PTS;
        const pts: XY[] = [];
        if (Array.isArray(ctrl) && ctrl.length >= 2) for (const q of ctrl) pts.push(toMerc([q.x, q.y], q.spatialReference ?? sr));
        else for (const path of geo.paths ?? []) for (const q of path) pts.push(toMerc(q, sr));
        if (this.addAlternative('line', pts, { name, src: 'selected' })) n++;
      } else if (geo?.type === 'polygon' && geo.rings?.length) {
        const ring = (geo.rings[0] as number[][]).map((q) => toMerc(q, sr));
        // an ArcGIS ring repeats its first point at the end
        const f = ring[0], l = ring[ring.length - 1];
        if (ring.length > 3 && f[0] === l[0] && f[1] === l[1]) ring.pop();
        if (this.addAlternative('area', ring, { name, src: 'selected' })) n++;
      } else if (geo?.type === 'point') {
        if (this.addAlternative('point', [toMerc([geo.x, geo.y], sr)], { name, src: 'selected' })) n++;
      }
      if (!this._nextLetter()) break;
    }
    if (!n) siteHint(HINT, ICON, this._nextLetter() ? 'Select line, area or point symbols on the map first' : FULL_HINT, 2200);
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
    return { id: a.id, kind: a.kind === 'line' ? 'line' : 'area', pts: this._ring(a), name: a.name };
  }

  /** Where the alternatives of a kind came from, for each row's "how". */
  private _inputText(kind: AltKind): string {
    const list = this._alts.filter((a) => (kind === 'line') === (a.kind === 'line'));
    const from = (a: AltDoc) => {
      const what = a.kind === 'point' ? `a point read as a ${this._opts.pointRadiusM} m circle` : a.kind;
      const src = a.src === 'drawn' ? 'drawn on the map' : a.src === 'selected' ? 'the selected symbol' : 'added by code';
      return `${a.id} ${a.name ? `"${a.name}" ` : ''}${what}, ${src}`;
    };
    return list.map(from).join('; ');
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
        dataText: this._dataText(),
        inputText: (kind) => this._inputText(kind),
      });
    } catch (err) {
      this._res = null;
      EngineLogger.error(ENGINE, `Alternatives not read: ${(err as Error)?.message ?? err}`);
    }
    this._pending = b.pending() || (prec === null && b.climateLoading);
    this._paint();
    this._render();
  }

  /** A data layer named with its sources and dates (SiteScan.dataCatalog). */
  private _dataText(): ((k: string) => string) | undefined {
    const b = this._bundle;
    if (!b) return undefined;
    const cat = dataCatalog(b.manifest);
    return (k: string) => {
      const r = cat(k as any, k);
      return `${r.book}${r.quote ? ` (${r.quote})` : ''}`;
    };
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────

  text(): string {
    const r = this._res;
    if (!r) return '';
    const L: string[] = [];
    L.push(`COMPARE: ${this._alts.map((a) => `${a.id} ${a.kind}${a.name ? ` "${a.name}"` : ''}`).join(', ')}`);
    L.push(`Assumptions: ${this._assume()}`);
    L.push('');
    for (const [kind, title] of [['line', 'Corridors'], ['area', 'Positions']] as const) {
      const rows = r.rows.filter((x) => x.kind === kind);
      if (!rows.length) continue;
      L.push(`${title}:`);
      for (const row of rows) {
        const cells = Object.entries(row.cells).map(([id, c]) => `${id} ${cellText(c)}${row.best.includes(id) ? ' (best)' : ''}`);
        L.push(`${row.label}: ${cells.join(' | ')}`);
      }
      L.push('');
    }
    const checks = this._alts.filter((a) => r.flags[a.id]?.length);
    if (checks.length) {
      L.push('Check first:');
      for (const a of checks) for (const f of r.flags[a.id]) L.push(`- ${a.id}: ${f.text}`);
      L.push('');
    }
    L.push('Differences:');
    for (const d of r.diffs) L.push(`- ${d}`);
    for (const n of r.notes) L.push(`- ${n}`);
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
    el.innerHTML = '<div class="cp-head"></div><div class="cp-add add"></div><div class="cp-strip"></div><div class="cp-alts"></div><div class="body"></div>';
    this._parts = { head: el.children[0] as HTMLElement, add: el.children[1] as HTMLElement, strip: el.children[2] as HTMLElement, alts: el.children[3] as HTMLElement, body: el.children[4] as HTMLElement };
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t || t.hasAttribute('disabled')) return;
      const a = t.dataset.act!;
      if (a === 'close') this.openPanel(false);
      else if (a === 'line' || a === 'area' || a === 'point') this.drawAlternative(a);
      else if (a === 'sel') this.addSelected();
      else if (a === 'clear') this.clear();
      else if (a === 'copy') void this.copyText();
      else if (a.startsWith('rm:')) this.removeAlternative(a.slice(3));
      else if (a.startsWith('show:')) this.showAlternative(a.slice(5));
      else if (a.startsWith('row:')) {
        const k = a.slice(4);
        if (this._openRows.has(k)) this._openRows.delete(k);
        else this._openRows.add(k);
        this._render();
      }
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const k = t.dataset?.ctl;
      if (k === 'mover') this.setOptions({ mover: t.value });
      else if (k === 'month') this.setOptions({ month: Number(t.value) || 0 });
      else if (k === 'seen') this.setOptions({ seen: (t as HTMLInputElement).checked });
      else if (k === 'eyeM') this.setOptions({ eyeM: Math.max(0.5, Math.min(100, Number(t.value) || 2)) });
      else if (k === 'radius') this.setOptions({ pointRadiusM: Math.max(25, Math.min(5000, Number(t.value) || 250)) });
      else if (k === 'diff') {
        this._onlyDiff = (t as HTMLInputElement).checked;
        this._render();
      }
    });
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') e.stopPropagation();
    });
    document.body.appendChild(el);
    this._el = el;
  }

  /** Rewrite a part only when its HTML changed; folded lists that were open stay open and the scroll stays. */
  private _set(k: PartKey, html: string): void {
    if (!this._parts || this._last[k] === html) return;
    this._last[k] = html;
    const p = this._parts[k];
    const open = new Set([...p.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset.k ?? ''));
    const scroll = p.scrollTop;
    p.innerHTML = html;
    for (const d of p.querySelectorAll('details')) if (open.has((d as HTMLElement).dataset.k ?? '')) (d as HTMLDetailsElement).open = true;
    p.scrollTop = scroll;
  }

  private _render(): void {
    if (!this._open || !this._el) return;
    const r = this._res;
    const n = this._alts.length;
    const full = n >= 4;
    const dis = full ? ' disabled' : '';
    const fullTip = full ? ' (four at most: remove one first)' : '';
    this._set(
      'head',
      `<div class="h"><span class="t">${ICON} Compare</span>` +
        `<button data-act="copy"${r ? '' : ' disabled'} title="Copy the table, the differences and how each row was read">Copy as Text</button>` +
        `<button data-act="clear"${n ? '' : ' disabled'} title="Remove every alternative">Clear</button>` +
        `<button class="x" data-act="close" aria-label="Close" title="Close (Esc)">×</button></div>`,
    );
    this._set(
      'add',
      `<span class="k">Add</span>` +
        `<button data-act="line"${dis} class="${n ? '' : 'pri'}" title="Draw a corridor${fullTip}">+ Line</button><button data-act="area"${dis} title="Draw a position as an area${fullTip}">+ Area</button>` +
        `<button data-act="point"${dis} title="Click a position, read as a circle${fullTip}">+ Point</button><button data-act="sel"${dis} title="The selected line / area / point symbols${fullTip}">+ Selected</button>` +
        `<span class="n">${n} of 4</span>`,
    );
    const rules: any = this._bundle?.rules;
    const movers = MOVERS.filter((k) => !rules || rules.profiles?.[k]);
    const threatOn = !!this._host.threat?.();
    this._set(
      'strip',
      `<div class="strip"><label>Mover <select data-ctl="mover">${movers.map((k) => `<option value="${k}"${k === this._opts.mover ? ' selected' : ''}>${esc(this._moverLabel(k))}</option>`).join('')}</select></label>` +
        `<label>Month <select data-ctl="month"><option value="0">This month (${MONTHS[new Date().getMonth()]})</option>${MONTHS.map((m, i) => `<option value="${i + 1}"${Number(this._opts.month) === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select></label>` +
        `<label title="${threatOn ? 'What the Ground Guide threat marker sees' : 'Set a threat marker (Ground Guide Extended View) to read what it sees'}"><input type="checkbox" data-ctl="seen"${this._opts.seen && threatOn ? ' checked' : ''}${threatOn ? '' : ' disabled'}> Seen by threat${threatOn ? '' : ' <span class="mut">(no marker set)</span>'}, eye <input type="number" data-ctl="eyeM" min="0.5" max="100" step="0.5" value="${this._opts.eyeM}"> m</label>` +
        `<label title="A point is read as a circle of this radius">Point radius <input type="number" data-ctl="radius" min="25" max="5000" step="25" value="${this._opts.pointRadiusM}"> m</label></div>`,
    );
    this._set('alts', n ? `<div class="alts">${this._alts.map((a) => this._card(a)).join('')}</div>` : '');
    this._set('body', this._body());
  }

  /** One alternative as a card: its letter (click: show it), what it is, what to check first. */
  private _card(a: AltDoc): string {
    const what =
      a.kind === 'line' ? `Corridor · ${fmtM(altLength(a.pts))}` : a.kind === 'area' ? `Area · ${ringAreaKm2(a.pts).toFixed(2)} km²` : `Point · ${this._opts.pointRadiusM} m circle`;
    const flags = this._res?.flags[a.id];
    const fl = !this._res ? '' : flags?.length ? flags.map((f) => `<span class="fl ${f.tone}">${esc(f.text)}</span>`).join('') : '<span class="fl none">No stopper read on this data</span>';
    return (
      `<div class="card" style="--c:${ALT_HEX[a.id]}"><button class="bd" data-act="show:${a.id}" aria-label="Show ${a.id} on the map" title="Show ${a.id} on the map">${a.id}</button>` +
      `<div class="ct"><b>${esc(a.name || what)}</b>${a.name ? `<span>${esc(what)}</span>` : `<span>${a.src === 'drawn' ? 'Drawn' : a.src === 'selected' ? 'Selected symbol' : 'Added by code'}</span>`}</div>` +
      `<button class="rm" data-act="rm:${a.id}" aria-label="Remove ${a.id}" title="Remove ${a.id}">×</button>` +
      (fl ? `<div class="flags">${fl}</div>` : '') +
      `</div>`
    );
  }

  private _body(): string {
    const r = this._res;
    if (this._bundleState === 'loading') return '<div class="empty">Opening the terrain data…</div>';
    if (this._bundleState === 'missing') return '<div class="empty">Needs terrain data: no terrain bundle at this address.</div>';
    if (!this._alts.length)
      return (
        '<div class="empty"><b style="color:#e4e8ec">Read two or more alternatives side by side</b>' +
        '<ol><li>Add corridors (<b>+ Line</b>) or positions (<b>+ Area</b>, <b>+ Point</b>), or select symbols on the map and press <b>+ Selected</b>.</li>' +
        '<li>Set the mover, month and threat once: every alternative is read the same way.</li>' +
        '<li>Read the best and worst in each row, and open ⓘ for how a row was worked out.</li></ol></div>'
      );
    if (!r) return '<div class="empty">Reading…</div>';
    const lines = this._alts.filter((a) => a.kind === 'line').length;
    const places = this._alts.length - lines;
    const hint =
      this._alts.length === 1
        ? '<div class="empty" style="padding:4px 0 2px">One alternative: add another of the same kind to rank them.</div>'
        : lines === 1 && places === 1
          ? '<div class="empty" style="padding:4px 0 2px">One corridor and one position are read, not ranked: add another of either kind.</div>'
          : '';
    const filt = `<div class="filt"><label><input type="checkbox" data-ctl="diff"${this._onlyDiff ? ' checked' : ''}> Only rows that differ or need a check</label></div>`;
    const diffs = r.diffs.length ? `<h4>Differences</h4><ul>${r.diffs.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
    const notes = r.notes.length ? `<ul class="mut-list" style="margin-top:4px">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    return (
      (this._pending ? '<div class="busy" role="status">Reading the ground… the table fills as tiles arrive</div>' : '') +
      hint +
      filt +
      this._table('line', 'Corridors', r) +
      this._table('area', 'Positions', r) +
      diffs +
      notes +
      this._howHtml(r)
    );
  }

  /** The table of one kind: its own alternatives as columns, a row each, best and worst said in words as well as colour. */
  private _table(kind: 'line' | 'area', title: string, r: CompareResult): string {
    const ids = this._alts.filter((a) => (kind === 'line') === (a.kind === 'line')).map((a) => a.id);
    if (!ids.length) return '';
    const all = r.rows.filter((x) => x.kind === kind);
    const need = (x: CompareRow) => x.best.length > 0 || ids.some((id) => ['bad', 'warn'].includes(x.cells[id]?.tone ?? ''));
    const rows = this._onlyDiff ? all.filter(need) : all;
    const head = `<tr><th scope="col"><span class="mut">${kind === 'line' ? 'per corridor' : 'per position'}</span></th>${ids.map((id) => `<th scope="col" class="dot"><span style="background:${ALT_HEX[id]}"></span>${id}</th>`).join('')}</tr>`;
    const cell = (row: CompareRow, id: string): string => {
      const c = row.cells[id];
      if (!c) return '<td class="warn"><span class="v">not read</span><span class="s">no data here yet</span></td>';
      const isBest = row.best.includes(id), isWorst = row.worst.includes(id);
      const cls = isBest ? 'best' : isWorst ? 'worst' : c.tone === 'bad' ? 'bad' : c.tone === 'warn' ? 'warn' : c.tone === 'unknown' ? 'unk' : '';
      return `<td class="${cls}"><span class="v">${esc(c.value)}</span>${c.sub ? `<span class="s">${esc(c.sub)}</span>` : ''}${isBest ? '<i class="tg">best</i>' : isWorst ? '<i class="tg">worst</i>' : ''}</td>`;
    };
    const body = rows
      .map((row) => {
        const k = `${kind}:${row.key}`;
        const open = this._openRows.has(k);
        const nr = row.better ? '' : row.cells && Object.values(row.cells).every((c) => c && c.tone === 'unknown') ? '<span class="nr">needs a threat marker</span>' : '<span class="nr">not ranked</span>';
        const main = `<tr><th scope="row">${esc(row.label)}<button class="i" data-act="row:${k}" aria-expanded="${open}" aria-label="How ${esc(row.label)} was worked out" title="How it was worked out">i</button>${nr}</th>${ids.map((id) => cell(row, id)).join('')}</tr>`;
        const how = open ? `<tr class="how"><td colspan="${ids.length + 1}">${esc(row.method)} ${esc(row.rank)}${row.delta ? ` Here the two ends are ${esc(row.delta)} apart.` : ''}</td></tr>` : '';
        return main + how;
      })
      .join('');
    const tally = ids.length > 1 ? `<tr class="tally"><th scope="row">Best on</th>${ids.map((id) => `<td>${r.tally[id]?.best ?? 0} of ${r.tally[id]?.of ?? 0}</td>`).join('')}</tr>` : '';
    const hidden = all.length - rows.length;
    const empty = !rows.length ? `<tr><td colspan="${ids.length + 1}" class="none-rows">Nothing differs or needs a check on this data.</td></tr>` : '';
    return `<table><caption>${title}${hidden ? ` <span class="mut">· ${hidden} row${hidden === 1 ? '' : 's'} hidden</span>` : ''}</caption><colgroup><col class="k">${ids.map(() => '<col>').join('')}</colgroup><thead>${head}</thead><tbody>${body}${empty}${tally}</tbody></table>`;
  }

  /** The assumptions, each row's method and the data read, each said once. */
  private _howHtml(r: CompareResult): string {
    const dt = this._dataText();
    const keys = [...new Set(r.rows.flatMap((x) => x.dataKeys))];
    const rowLi = r.rows
      .filter((x, i, a) => a.findIndex((y) => y.key === x.key && y.kind === x.kind) === i)
      .map((row) => `<li><b>${esc(row.label)}</b> (${row.kind === 'line' ? 'corridor' : 'position'}): ${esc(row.method)} <span class="mut">${esc(row.rank)}</span></li>`)
      .join('');
    const dataLi = dt ? keys.map((k) => `<li>${esc(dt(k))}</li>`).join('') : '';
    return (
      `<details data-k="how"><summary>How each row was worked out</summary>` +
      `<p>The same for every alternative: ${esc(this._assume())}. The month and its rain are read at ${esc(this._alts[0]?.id ?? 'A')}'s first point. A row ranks only when the alternatives differ by more than its smallest real difference; there is no overall score.</p>` +
      `<ul>${rowLi}</ul>` +
      (dataLi ? `<h4>Data read</h4><ul>${dataLi}</ul>` : '') +
      `<p>${esc(this._bundle?.dataLine() ?? '')}. Check on the ground.</p></details>`
    );
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
        const ring = this._ring(a);
        spec.polys.push({ ring, tone: 'unknown', selected: false, rgb });
        spec.marks.push({ at: ringCentroid(ring), kind: 'letter', letter: a.id, rgb });
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
