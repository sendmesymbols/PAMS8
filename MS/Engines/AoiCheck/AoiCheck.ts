/**
 * AoiCheck.ts
 *
 * AOI Check (user, 2026-11-17: "AOI preflight. Let users check an area before planning: bundle coverage, missing
 * tiles, available layers and profiles, data build date, and source/licence notes. Highlight gaps on the map and say
 * which readings they affect"). Off by default (`features.aoiCheck`); the top bar's 🗺 AOI Check turns it on and opens
 * its panel (docked top left).
 *
 *   AOI      drawn (Pick area: click corners, double-click) or This view (the map's extent);
 *   check    every raster layer of the manifest (and the distance layer of every mover) is fetched tile by tile over the
 *            AOI, at the finest zoom that keeps it to `maxTiles` tiles a layer (a bigger AOI is checked coarser, and the
 *            panel says so); a tile is present, missing (404: no cover) or failed; in present tiles the pixels inside the
 *            AOI with no data are counted. The feature and road tiles (z10) and the population, climate and
 *            visibility grids are checked too;
 *   report   the share of the AOI inside the bundle's frame, each layer's gap, the readings the gaps blank (core layers
 *            first: Gr class and heights blank everything), the movers, the build stamps, and every source with its
 *            data date and licence (restricted and non-commercial ones marked);
 *   map      layer `ms-aoi-check`: the AOI, gap tiles in red (Gr class or heights) or amber (other layers), the frame;
 *   output   Copy as Text.
 *
 * It fetches nothing until a check is asked for, and only while on (claude_rules.md).
 */

import EngineLogger from '../../Support/EngineLogger';
import Utils from '../../Support/utils';
import { ensureTokensCss } from '../GroundGuide/GroundGuideTokens';
import { HttpPngTileSource, type TileSource } from '../GroundGuide/TerrainTileCache';
import { WorkerTileSource } from '../GroundGuide/WorkerTileSource';
import { MovementGuideDraw } from '../MovementGuide/MovementGuideDraw';
import { SiteMap, type MapSpec } from '../SiteScan/SiteMap';
import { dockBelowBar, siteHint } from '../SiteScan/SitePanel';
import {
  AOI_JUDGED,
  EXTRA_USES,
  aoiLayers,
  boxOf,
  buildReport,
  gapShare,
  inRing,
  lngLatToMerc,
  mercToLngLat,
  nodataInTile,
  pickZoom,
  shareInside,
  sourceName,
  tileBox,
  tileRange,
  type AoiReport,
  type ExtraTally,
  type LayerTally,
  type XY,
} from './AoiCheckRead';

const ENGINE = 'AoiCheck';
const HINT = 'ms-aoi-check-hint';
const ICON = '🗺';
const PANEL_ID = 'ms-aoi-check-panel';
const IN_FLIGHT = 6;

export interface AoiCheckOptions {
  bundleUrl: string;
  useWorker: boolean;
  /** Most tiles fetched per layer; a bigger AOI is checked at a coarser zoom. */
  maxTiles: number;
  map: boolean;
  labels: boolean;
  keys: boolean;
}

export const DEFAULT_AOI_CHECK_OPTIONS: AoiCheckOptions = { bundleUrl: '/terrain-bundle', useWorker: true, maxTiles: 48, map: true, labels: true, keys: true };

const esc = (s: unknown) => Utils.escapeHtml(String(s ?? ''));
const pct = (x: number) => `${Math.round(x * 100)}%`;

const CSS = `
#${PANEL_ID}{position:fixed;left:10px;top:118px;z-index:2147482808;width:min(600px,calc(100vw - 20px));max-height:calc(100vh - 130px);display:none;flex-direction:column;
 background:var(--gg-card);color:#f1f3f6;border:1px solid var(--gg-hair);border-radius:11px;box-shadow:0 10px 28px rgba(0,0,0,.5);font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif}
#${PANEL_ID}.ms-open{display:flex}
#${PANEL_ID} *{box-sizing:border-box}
#${PANEL_ID} .ac-head{flex:none}
#${PANEL_ID} .h{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 10px;background:linear-gradient(90deg,#1d2635,var(--gg-head) 45%);border-radius:11px 11px 0 0}
#${PANEL_ID} .t{font-weight:750;font-size:13.5px;color:#fff;flex:1}
#${PANEL_ID} button{font:500 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:27px;padding:0 9px;white-space:nowrap}
#${PANEL_ID} button:hover{background:rgba(255,255,255,.14);color:#fff}
#${PANEL_ID} button.pri{background:#2b5d86;border-color:#4f8ab8}
#${PANEL_ID} button.x{width:27px;padding:0;font-size:17px}
#${PANEL_ID} button[disabled]{opacity:.45;cursor:default}
#${PANEL_ID} .body{flex:1 1 auto;min-height:0;overflow:auto;padding:6px 12px 10px}
#${PANEL_ID} .ans{font-weight:700;font-size:14px;padding:6px 0}
#${PANEL_ID} .ans.ok{color:#74dca3}#${PANEL_ID} .ans.warn{color:#ffb46b}#${PANEL_ID} .ans.bad{color:#ff8a8d}#${PANEL_ID} .ans.unknown{color:#c3cbd3}
#${PANEL_ID} .facts{display:flex;flex-wrap:wrap;gap:4px 16px;padding:2px 0 6px;font-size:12px;color:var(--gg-label)}
#${PANEL_ID} .facts b{color:#f4f6f8;font-weight:650}
#${PANEL_ID} h4{margin:10px 0 4px;font-size:12.5px;color:#e4e8ec}
#${PANEL_ID} ul{margin:0;padding-left:18px;font-size:12.5px}
#${PANEL_ID} li{margin:2px 0}
#${PANEL_ID} table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:12px}
#${PANEL_ID} th{font-size:11.5px;font-weight:650;color:var(--gg-label);text-align:left;padding:2px 6px;border-bottom:1px solid var(--gg-hair)}
#${PANEL_ID} td{padding:2px 6px;border-bottom:1px solid var(--gg-hair-soft);vertical-align:top}
#${PANEL_ID} td.bad{color:#ff8a8d}#${PANEL_ID} td.warn{color:#ffd09a}#${PANEL_ID} td.ok{color:#a6ebc4}
#${PANEL_ID} .bar{display:inline-block;height:7px;border-radius:3px;background:#2fa862;vertical-align:middle;margin-right:5px}
#${PANEL_ID} details{margin-top:8px;font-size:12px;color:var(--gg-label)}
#${PANEL_ID} details summary{cursor:pointer;color:#e4e8ec;font-weight:650}
#${PANEL_ID} .tag{display:inline-block;padding:0 5px;border-radius:8px;font-size:10.5px;font-weight:650;margin-left:4px;background:rgba(229,72,77,.25);color:#ffb3b5}
#${PANEL_ID} .tag.nc{background:rgba(238,138,31,.25);color:#ffd09a}
#${PANEL_ID} .empty{padding:18px;color:var(--gg-label);text-align:center}
`;

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-aoi-check-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

export default class AoiCheck {
  private _opts: AoiCheckOptions = { ...DEFAULT_AOI_CHECK_OPTIONS };
  private _enabled = false;
  private _getView: () => any;
  private _manifest: any = null;
  private _rules: any = null;
  private _metaState: 'none' | 'loading' | 'ready' | 'missing' = 'none';
  private _source: TileSource | null = null;
  private _ring: XY[] | null = null;
  private _ringName = '';
  private _z = 12;
  private _tallies: LayerTally[] = [];
  private _extras: ExtraTally[] = [];
  private _report: AoiReport | null = null;
  private _token = 0;
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _draw: MovementGuideDraw;
  private _map: SiteMap;
  private _el: HTMLElement | null = null;
  private _open = false;
  private _tiles = 0;

  constructor(getView: () => any) {
    this._getView = getView;
    this._draw = new MovementGuideDraw(getView);
    this._map = new SiteMap(getView, 'ms-aoi-check', 'AOI Check');
  }

  get isEnabled(): boolean {
    return this._enabled;
  }
  get report(): AoiReport | null {
    return this._report;
  }
  get panelOpen(): boolean {
    return this._open;
  }

  setOptions(o: Partial<AoiCheckOptions>): void {
    const prevBase = this._opts.bundleUrl;
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null)) } as AoiCheckOptions;
    if (!this._enabled) return;
    this._bindKeys();
    if (this._opts.bundleUrl !== prevBase) {
      this._metaState = 'none';
      this._manifest = null;
    }
    this._paint();
    this._render();
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._bindKeys();
    EngineLogger.nextStep(ENGINE, 'AOI Check on: pick an area or use this view');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._token++;
    this._draw.cancel(false);
    this.openPanel(false);
    this._map.clear();
    this._unbindKeys();
    siteHint(HINT, ICON, null);
    this._source?.dispose?.();
    this._source = null;
  }

  destroy(): void {
    this.disable();
    this._el?.remove();
    this._el = null;
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

  // ── the AOI ───────────────────────────────────────────────────────────────────────────────────────────────────────

  pickArea(): void {
    if (!this._enabled) return;
    this._draw.start({
      kind: 'area',
      prompt: 'Draw the AOI: click its corners, double-click to finish (Esc cancels)',
      onStatus: (t) => siteHint(HINT, ICON, t),
      onCancel: () => siteHint(HINT, ICON, null),
      onDone: (pts) => {
        siteHint(HINT, ICON, null);
        if (pts.length >= 3) void this.check(pts.map((p) => [p[0], p[1]] as XY), 'drawn AOI');
      },
    });
  }

  /** Check the map's current extent. */
  useView(): void {
    const v = this._getView();
    const e = v?.extent;
    if (!e) return;
    let x0 = e.xmin, y0 = e.ymin, x1 = e.xmax, y1 = e.ymax;
    if (!e.spatialReference?.isWebMercator) {
      [x0, y0] = lngLatToMerc(e.xmin, e.ymin);
      [x1, y1] = lngLatToMerc(e.xmax, e.ymax);
    }
    void this.check([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 'this view');
  }

  /** Check an AOI (Web Mercator ring, or lng / lat when `lngLat`). Resolves when every tile has settled. */
  async check(ring: XY[], name = 'AOI', o: { lngLat?: boolean } = {}): Promise<AoiReport | null> {
    if (!this._enabled) return null;
    const r = o.lngLat ? ring.map((p) => lngLatToMerc(p[0], p[1])) : ring;
    if (r.length < 3) return null;
    this._ring = r;
    this._ringName = name;
    this.openPanel(true);
    const token = ++this._token;
    if (!(await this._ensureMeta())) {
      this._report = null;
      this._render();
      return null;
    }
    if (token !== this._token) return null;
    const m = this._manifest;
    const layers = aoiLayers(m, this._rules);
    const box = boxOf(r);
    const zMin = Number(m.zoom?.min ?? 8), zMax = Number(m.zoom?.max ?? 12);
    this._z = pickZoom(box, zMin, zMax, this._opts.maxTiles);
    const tr = tileRange(box, this._z);
    // only tiles that touch the AOI ring (its box corners or centre inside the ring, or the ring crossing the tile)
    const tiles: Array<{ tx: number; ty: number }> = [];
    for (let tx = tr.tx0; tx <= tr.tx1; tx++)
      for (let ty = tr.ty0; ty <= tr.ty1; ty++) if (tileTouches(tileBox(tx, ty, this._z), r)) tiles.push({ tx, ty });
    this._tiles = tiles.length;
    this._tallies = layers.map((l) => ({ layer: l, z: this._z, total: tiles.length, loaded: 0, missing: 0, failed: 0, pending: tiles.length, gapTiles: [], inside: 0, empty: 0 }));
    this._extras = [];
    this._report = buildReport(r, m, this._tallies, this._extras);
    this._paint();
    this._render();
    const base = this._base();
    const version = String(m.built ?? m.pipelineVersion ?? '');
    this._source?.dispose?.();
    this._source = this._opts.useWorker && typeof Worker !== 'undefined' ? new WorkerTileSource(base, m.tileSize ?? 256, version) : new HttpPngTileSource(base, m.tileSize ?? 256, version);
    const src = this._source;
    const ts = Number(m.tileSize ?? 256);
    const jobs: Array<{ t: LayerTally; tx: number; ty: number }> = [];
    for (const t of this._tallies) for (const q of tiles) jobs.push({ t, tx: q.tx, ty: q.ty });
    const extrasP = this._checkExtras(r, token);
    let next = 0;
    const work = async () => {
      while (next < jobs.length && token === this._token) {
        const j = jobs[next++];
        let data: Uint8Array | null = null;
        let failed = false;
        try {
          data = await src.fetchTile(j.t.layer.tileLayer, this._z, j.tx, j.ty);
        } catch {
          failed = true;
        }
        if (token !== this._token) return;
        j.t.pending--;
        if (failed) {
          j.t.failed++;
          j.t.gapTiles.push({ tx: j.tx, ty: j.ty, failed: true });
        } else if (!data) {
          j.t.missing++;
          j.t.gapTiles.push({ tx: j.tx, ty: j.ty, failed: false });
        } else {
          j.t.loaded++;
          if (j.t.layer.nodata !== null) {
            const c = nodataInTile(data, j.tx, j.ty, this._z, ts, r, j.t.layer.nodata, 8);
            j.t.inside += c.inside;
            j.t.empty += c.empty;
          }
        }
        this._soon();
      }
    };
    await Promise.all(Array.from({ length: IN_FLIGHT }, work));
    await extrasP;
    if (token !== this._token) return null;
    this._report = buildReport(r, m, this._tallies, this._extras);
    this._paint();
    this._render();
    EngineLogger.success(ENGINE, `${this._ringName}: ${this._report.verdict.text}`);
    return this._report;
  }

  private _base(): string {
    return String(this._opts.bundleUrl || '').replace(/\/+$/, '');
  }

  private async _ensureMeta(): Promise<boolean> {
    if (this._metaState === 'ready') return true;
    const base = this._base();
    this._metaState = 'loading';
    this._render();
    try {
      if (!base) throw new Error('no bundle URL');
      const [mr, rr] = await Promise.all([fetch(`${base}/manifest.json`), fetch(`${base}/rules.json`)]);
      const isJson = (x: Response) => x.ok && (x.headers.get('content-type') ?? '').includes('json');
      if (!isJson(mr) || !isJson(rr)) throw new Error('no terrain bundle at this address');
      this._manifest = await mr.json();
      this._rules = await rr.json();
      this._metaState = 'ready';
      return true;
    } catch (err) {
      this._metaState = 'missing';
      EngineLogger.error(ENGINE, `No terrain bundle at ${base || '(none)'}: ${(err as Error)?.message ?? err}`);
      return false;
    }
  }

  /** Feature and road tiles (z10) and the population, climate and visibility grids over the AOI. */
  private async _checkExtras(r: XY[], token: number): Promise<void> {
    const m = this._manifest;
    const g = m?.grotbc ?? {};
    const base = this._base();
    const out: ExtraTally[] = [];
    const tileSet = async (key: string, tpl: string | undefined, z: number) => {
      if (!tpl) {
        out.push({ key, uses: EXTRA_USES[key], share: null, note: 'not in this bundle' });
        return;
      }
      const tr = tileRange(boxOf(r), z);
      const list: Array<{ tx: number; ty: number }> = [];
      for (let tx = tr.tx0; tx <= tr.tx1; tx++) for (let ty = tr.ty0; ty <= tr.ty1; ty++) if (tileTouches(tileBox(tx, ty, z), r)) list.push({ tx, ty });
      if (list.length > 60) {
        out.push({ key, uses: EXTRA_USES[key], share: null, note: `${list.length} tiles: too many to check one by one` });
        return;
      }
      let have = 0;
      for (const q of list) {
        if (token !== this._token) return;
        try {
          const res = await fetch(`${base}/${tpl.replace('{z}', String(z)).replace('{x}', String(q.tx)).replace('{y}', String(q.ty))}`, { cache: 'force-cache' });
          if (res.ok && !(res.headers.get('content-type') ?? '').includes('html')) have++;
        } catch {
          /* counted as absent */
        }
      }
      out.push({ key, uses: EXTRA_USES[key], share: list.length ? have / list.length : null, note: `${have} of ${list.length} z${z} tiles hold data (a tile with nothing recorded in it is not written, so an absent one may only mean an empty place)` });
    };
    const grid = async (key: string, index: string | undefined) => {
      if (!index) {
        out.push({ key, uses: EXTRA_USES[key], share: null, note: 'not in this bundle' });
        return;
      }
      try {
        const res = await fetch(`${base}/${index}`);
        const j = await res.json();
        const s = shareInside(r, j.bounds);
        out.push({ key, uses: EXTRA_USES[key], share: s, note: `grid ${j.cell ? `${(Number(j.cell) * 111).toFixed(1)} km cells` : ''}${j.sourceRef?.dataDate ? `, ${j.sourceRef.dataDate}` : j.year ? `, ${j.year}` : ''}` });
      } catch {
        out.push({ key, uses: EXTRA_USES[key], share: null, note: 'could not be read' });
      }
    };
    const net = g.network?.index ? await fetch(`${base}/${g.network.index}`).then((x) => x.json()).catch(() => null) : null;
    await Promise.all([
      tileSet('features', g.features?.path, Number(g.features?.z ?? 10)),
      tileSet('network', typeof g.network?.tiles === 'string' ? g.network.tiles : undefined, Number(net?.tiles?.z ?? 10)),
      grid('population', g.population?.index),
      grid('climate', g.climate?.index),
      grid('visibility', g.visibility?.index),
    ]);
    if (token !== this._token) return;
    const order = ['features', 'network', 'population', 'climate', 'visibility'];
    this._extras = out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    this._soon();
  }

  private _soon(): void {
    if (this._renderTimer) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      if (!this._ring || !this._manifest) return;
      this._report = buildReport(this._ring, this._manifest, this._tallies, this._extras);
      this._paint();
      this._render();
    }, 300);
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────

  text(): string {
    const rep = this._report;
    const m = this._manifest;
    if (!rep || !m || !this._ring) return '';
    const L: string[] = [];
    const [lng, lat] = mercToLngLat(...centre(this._ring));
    L.push(`AOI CHECK: ${this._ringName}, ${rep.areaKm2.toFixed(rep.areaKm2 < 10 ? 1 : 0)} km² round ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    L.push(`Result: ${rep.verdict.text}`);
    L.push(`Inside the terrain data's frame: ${rep.inFrame === null ? 'not read' : pct(rep.inFrame)}; checked at zoom ${this._z} (${this._tiles} tiles a layer)`);
    L.push(`Bundle built ${String(m.built ?? '').slice(0, 10)}, pipeline ${m.pipelineVersion ?? '?'}, rules ${m.rulesVersion ?? '?'}, data version ${m.dataVersion ?? '?'}`);
    L.push('');
    L.push('Readings affected:');
    if (!rep.affected.length) L.push('- none');
    for (const a of rep.affected) L.push(`- ${pct(a.share)} of the AOI: ${a.what} (${a.layers.join(', ')})`);
    L.push('');
    L.push('Layers:');
    for (const t of rep.layers) L.push(`- ${t.layer.label}: ${t.loaded}/${t.total} tiles${t.missing ? `, ${t.missing} missing` : ''}${t.failed ? `, ${t.failed} failed` : ''}; gap ${pct(gapShare(t))}`);
    for (const e of rep.extras) L.push(`- ${e.key}: ${e.share === null ? 'not checked' : pct(e.share)} (${e.note})`);
    L.push('');
    L.push('How it is judged:');
    for (const j of AOI_JUDGED) L.push(`- ${j}`);
    L.push('');
    L.push('Sources:');
    for (const s of (m.sources ?? []) as any[]) L.push(`- ${sourceName(s.id, s.name)}: data ${s.dataDate ?? '?'}; released ${s.released ?? '?'}; licence ${s.licence ?? '?'}${s.restricted ? ' [restricted]' : ''}`);
    return L.join('\n');
  }

  async copyText(): Promise<boolean> {
    const t = this.text();
    if (!t) return false;
    try {
      await navigator.clipboard.writeText(t);
      siteHint(HINT, ICON, 'AOI check copied as text', 1800);
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
    el.setAttribute('aria-label', 'AOI Check');
    el.innerHTML = '<div class="ac-head"></div><div class="body"></div>';
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const a = t.dataset.act;
      if (a === 'close') this.openPanel(false);
      else if (a === 'pick') this.pickArea();
      else if (a === 'view') this.useView();
      else if (a === 'again' && this._ring) void this.check(this._ring, this._ringName);
      else if (a === 'copy') void this.copyText();
    });
    document.body.appendChild(el);
    this._el = el;
  }

  private _render(): void {
    if (!this._open || !this._el) return;
    const head = this._el.querySelector('.ac-head') as HTMLElement;
    const bodyEl = this._el.querySelector('.body') as HTMLElement;
    const rep = this._report;
    const m = this._manifest;
    const headHtml =
      `<div class="h"><span class="t">${ICON} AOI Check</span><button data-act="pick" class="${this._ring ? '' : 'pri'}" title="Draw the AOI on the map">Pick area</button>` +
      `<button data-act="view" title="Check the map's current extent">This view</button><button data-act="again"${this._ring ? '' : ' disabled'}>Check again</button>` +
      `<button data-act="copy"${rep && !rep.pending ? '' : ' disabled'}>Copy as Text</button><button class="x" data-act="close" aria-label="Close" title="Close (Esc)">×</button></div>`;
    if (head.innerHTML !== headHtml) head.innerHTML = headHtml;
    let body = '';
    if (this._metaState === 'loading') body = '<div class="empty">Opening the terrain data…</div>';
    else if (this._metaState === 'missing') body = '<div class="empty">No terrain bundle at this address: every terrain reading is blank. Set the bundle URL in the settings.</div>';
    else if (!this._ring || !rep || !m) body = '<div class="empty">Pick an area on the map, or check this view, before you plan there: what the terrain data covers, what is missing and which readings it blanks.</div>';
    else {
      const sizeKm = Math.round((2 * Math.PI * 6378137 * Math.cos((mercToLngLat(...centre(this._ring))[1] * Math.PI) / 180)) / 2 ** this._z / 100) / 10;
      const done = rep.layers.reduce((t, l) => t + (l.total - l.pending), 0), all = rep.layers.reduce((t, l) => t + l.total, 0);
      body += `<div class="ans ${rep.verdict.tone}">${esc(rep.verdict.text)}${rep.pending ? ` (${done} of ${all} tiles)` : ''}</div>`;
      body +=
        `<div class="facts"><span>AOI <b>${esc(this._ringName)}</b>, <b>${rep.areaKm2.toFixed(rep.areaKm2 < 10 ? 1 : 0)} km²</b></span>` +
        `<span>In the data's frame <b>${rep.inFrame === null ? 'not read' : pct(rep.inFrame)}</b></span>` +
        `<span>Checked at zoom <b>${this._z}</b> (tiles ~${sizeKm} km, ${this._tiles} a layer)${this._z < Number(m.zoom?.max ?? 12) ? ' <b style="color:#ffd09a">coarser than the readers use: a gap smaller than a tile may not show</b>' : ''}</span>` +
        `<span>Built <b>${esc(String(m.built ?? '').slice(0, 10))}</b>, rules <b>${esc(m.rulesVersion ?? '?')}</b>, data v<b>${esc(m.dataVersion ?? '?')}</b></span></div>`;
      body += '<h4>Readings affected</h4>';
      body += rep.affected.length
        ? `<ul>${rep.affected.map((a) => `<li><b style="color:${a.core ? '#ff8a8d' : '#ffd09a'}">${pct(a.share)}</b> of the AOI: ${esc(a.what)} <span style="color:#9aa3ad">(${esc(a.layers.join(', '))})</span></li>`).join('')}</ul>`
        : rep.pending
          ? '<ul><li>Checking…</li></ul>'
          : '<ul><li>None: every layer and grid answers over the whole AOI.</li></ul>';
      const rows = rep.layers
        .filter((t) => !t.layer.key.startsWith('dist:'))
        .map((t) => this._layerRow(t))
        .join('');
      body += `<h4>Layers</h4><table><tr><th>Layer</th><th>Tiles</th><th>Gap</th><th>Sources</th></tr>${rows}</table>`;
      const movers = rep.layers.filter((t) => t.layer.key.startsWith('dist:'));
      body += `<h4>Movers (profiles)</h4><table><tr><th>Mover</th><th>Tiles</th><th>Gap</th><th>Reads</th></tr>${movers
        .map((t) => {
          const g = gapShare(t);
          return `<tr><td>${esc(t.layer.label.replace('Dist to NO-GO: ', ''))}</td><td>${t.loaded}/${t.total}</td><td class="${t.pending ? '' : g >= 0.005 ? 'warn' : 'ok'}">${t.pending ? '…' : pct(g)}</td><td>${esc(t.layer.uses)}</td></tr>`;
        })
        .join('')}</table>`;
      body += `<h4>Grids and point data</h4><table><tr><th>Data</th><th>Cover</th><th>Reads</th><th>Note</th></tr>${rep.extras
        .map((e) => `<tr><td>${esc(e.key)}</td><td class="${e.share === null ? '' : e.share >= 0.995 ? 'ok' : 'warn'}">${e.share === null ? '—' : pct(e.share)}</td><td>${esc(e.uses)}</td><td>${esc(e.note)}</td></tr>`)
        .join('') || '<tr><td colspan="4">Checking…</td></tr>'}</table>`;
      body += `<details><summary>Sources, dates and licences (${(m.sources ?? []).length})</summary><table><tr><th>Source</th><th>Data</th><th>Licence</th></tr>${((m.sources ?? []) as any[])
        .map((s) => {
          const nc = /non-commercial/i.test(String(s.licence ?? ''));
          return `<tr><td>${esc(sourceName(s.id, s.name))}${s.restricted ? '<span class="tag">restricted</span>' : ''}${nc ? '<span class="tag nc">non-commercial</span>' : ''}</td><td>${esc(s.dataDate ?? '?')}<br><span style="color:#9aa3ad">released ${esc(s.released ?? '?')}</span></td><td>${esc(s.licence ?? '?')}</td></tr>`;
        })
        .join('')}</table><p>${m.restricted ? 'This bundle holds restricted data: confirm before passing it on. ' : ''}${esc(m.boundary?.note ?? '')}</p></details>` +
        `<details data-k="judged"><summary>📖 How it is judged (data and thresholds)</summary><ul>${AOI_JUDGED.map((j) => `<li>${esc(j)}</li>`).join('')}</ul></details>`;
    }
    if (this._lastBody === body) return;
    this._lastBody = body;
    // folded sections that were open stay open (by position)
    const open = [...bodyEl.querySelectorAll('details')].map((d) => (d as HTMLDetailsElement).open);
    const scroll = bodyEl.scrollTop;
    bodyEl.innerHTML = body;
    [...bodyEl.querySelectorAll('details')].forEach((d, i) => {
      if (open[i]) (d as HTMLDetailsElement).open = true;
    });
    bodyEl.scrollTop = scroll;
  }

  private _lastBody = '';

  private _layerRow(t: LayerTally): string {
    const g = gapShare(t);
    const m = this._manifest;
    const src = t.layer.sources
      .map((id) => {
        const s = ((m?.sources ?? []) as any[]).find((x) => x.id === id);
        // a short date from the source's data date ("2021", "1984-2021", "2026-10-28"); none when it has no year
        const d = /\d{4}-\d{2}-\d{2}|\d{4}\s*-\s*\d{4}|\d{4}/.exec(String(s?.dataDate ?? ''))?.[0] ?? '';
        return s ? `${sourceName(id, s.name).split(' (')[0]}${d ? ` ${d.replace(/\s+/g, '')}` : ''}` : id;
      })
      .join('; ');
    const tone = t.pending ? '' : g >= 0.5 && t.layer.core ? 'bad' : g >= 0.005 ? 'warn' : 'ok';
    return `<tr><td title="${esc(t.layer.uses)}">${esc(t.layer.label)}</td><td>${t.loaded}/${t.total}${t.missing ? ` <span style="color:#ff8a8d">${t.missing} missing</span>` : ''}${t.failed ? ` <span style="color:#ffd09a">${t.failed} failed</span>` : ''}</td><td class="${tone}">${t.pending ? '…' : `<span class="bar" style="width:${Math.max(2, Math.round((1 - g) * 40))}px"></span>${pct(g)}`}</td><td>${esc(src)}</td></tr>`;
  }

  // ── map ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _paint(): void {
    if (!this._enabled || !this._opts.map || !this._ring) {
      this._map.clear();
      return;
    }
    const spec: MapSpec = { circle: null, polys: [], lines: [], marks: [] };
    spec.lines.push({ pts: [...this._ring, this._ring[0]], rgb: [142, 193, 234], width: 2.5, label: `AOI: ${this._ringName}` });
    // gap tiles: red where the Gr class or heights are missing, amber where only other layers are
    const per = new Map<string, { tx: number; ty: number; core: boolean; n: number; failed: boolean }>();
    for (const t of this._tallies)
      for (const q of t.gapTiles) {
        const k = `${q.tx}/${q.ty}`;
        const e = per.get(k) ?? { tx: q.tx, ty: q.ty, core: false, n: 0, failed: false };
        e.n++;
        e.core = e.core || t.layer.core;
        e.failed = e.failed || q.failed;
        per.set(k, e);
      }
    const many = per.size > 40;
    for (const e of per.values()) {
      const b = tileBox(e.tx, e.ty, this._z);
      spec.polys.push({
        ring: [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]],
        tone: e.core ? 'bad' : 'warn',
        selected: false,
        label: many ? undefined : e.failed ? `${e.n} failed` : `${e.n} layer${e.n === 1 ? '' : 's'} missing`,
      });
    }
    const fb = this._manifest?.bounds as number[] | undefined;
    if (fb && fb.length === 4 && (shareInside(this._ring, fb as [number, number, number, number]) ?? 1) < 0.999) {
      const a = lngLatToMerc(fb[0], fb[1]), c = lngLatToMerc(fb[2], fb[3]);
      spec.lines.push({ pts: [a, [c[0], a[1]], c, [a[0], c[1]], a], rgb: [241, 243, 246], width: 1.5, dash: true, label: 'Terrain data frame' });
    }
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

function centre(ring: XY[]): XY {
  let x = 0, y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/** Does a tile box touch the ring: a ring point in the box, a box corner or centre in the ring, or an edge crossing. */
function tileTouches(b: [number, number, number, number], ring: XY[]): boolean {
  for (const p of ring) if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]) return true;
  const corners: XY[] = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]];
  if (corners.some((c) => inRing(c, ring))) return true;
  const edges: Array<[XY, XY]> = [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[3]], [corners[3], corners[0]]];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) for (const [p, q] of edges) if (cross(ring[j], ring[i], p, q)) return true;
  return false;
}

function cross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
