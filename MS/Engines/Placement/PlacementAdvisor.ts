/**
 * PlacementAdvisor.ts
 *
 * Optional engine that tells the user, while a symbol is being drawn, whether
 * it sits on deployable terrain, near a no-go area (and how far), partly in
 * one, or inside one. Data comes from a "terrain bundle" — static PNG tiles
 * served by the host app (see MS/Docs/15-placement-advisor.md); with no bundle
 * configured the engine is dormant.
 *
 * Hot path (every onDrawProgress): geometry → pixel indices → typed-array
 * reads from already-decoded tiles → pure verdict function. No network, no
 * await. Cold path (pan / zoom / new draw armed): tiles are fetched and decoded
 * in the background by TerrainTileCache.
 *
 * Events (dispatched from the view container, bubbling to document):
 *   "placement-advice"       – PlacementVerdict (only when the verdict text changes)
 *   "placement-clear"        – {} when the draw ends / is cancelled
 *   "placement-state-change" – { state: "enabled"|"disabled"|"ready"|"no-bundle", isEnabled }
 *   "placement-blocked"      – { verdict, drawEssentials } (enforce mode)
 *   "placement-tiles"        – { loaded, pending, failed, missing }
 *
 * Integration: SymbolEngine feeds onDrawProgress, calls prepareFor() when a
 * draw is armed, checkCommit() before a graphic is added, deactivate() when the
 * draw ends, and onViewChanged() on a 2D↔3D switch.
 */

import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import EngineLogger from '../../Support/EngineLogger';
import { compileProfile, evaluateSamples, type CompiledProfile } from './PlacementEvaluator';
import { PlacementBadge } from './PlacementBadge';
import { resolveProfile } from './PlacementProfiles';
import { samplePoints, toMercatorShape } from './PlacementSampling';
import {
  DEFAULT_PLACEMENT_OPTIONS,
  DIST_NODATA,
  type PlacementOptions,
  type PlacementProfile,
  type PlacementStamp,
  type PlacementVerdict,
  type TerrainManifest,
  type TerrainRules,
  type TerrainSample,
} from './PlacementTypes';
import {
  HttpPngTileSource,
  TerrainTileCache,
  lngLatToMercator,
  mercatorToTilePixel,
  resolutionAt,
  zoomForResolution,
} from './TerrainTileCache';

const ENGINE = 'Placement Advisor';
const NULL_SAMPLE: TerrainSample = { classCode: null, distanceM: null };

interface ReadContext {
  z: number;
  ts: number;
  scale: number;
  cls: string;
  dist: string | null;
  tx: number;
  ty: number;
  ct: Uint8Array | null | undefined;
  dt: Uint8Array | null | undefined;
}

export interface CommitCheck {
  allow: boolean;
  verdict: PlacementVerdict;
  stamp: PlacementStamp | null;
}

export default class PlacementAdvisor {
  private _opts: PlacementOptions = { ...DEFAULT_PLACEMENT_OPTIONS };
  private _enabled = false;
  private _manifest: TerrainManifest | null = null;
  private _rules: TerrainRules | null = null;
  private _boundsMerc: [number, number, number, number] = [0, 0, 0, 0];
  private _cache: TerrainTileCache | null = null;
  private _compiled = new Map<PlacementProfile, CompiledProfile>();
  private _configToken = 0;

  private _activeSidc: string | null = null;
  private _activeProfile: PlacementProfile | null = null;
  private _lastDetail: { geometry: any; sidc: string | null } | null = null;
  private _lastKey = '';
  private _lastKind = '';
  private _reevalTimer: ReturnType<typeof setTimeout> | null = null;

  private _badge = new PlacementBadge();
  private _container: HTMLElement | null = null;
  private _pointerHandler: ((e: PointerEvent) => void) | null = null;
  private _stationaryHandle: { remove(): void } | null = null;

  constructor(private _getView: () => any) {}

  // ── Configuration ────────────────────────────────────────────────────────

  get options(): Readonly<PlacementOptions> {
    return this._opts;
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  /** True when enabled, not `off`, and a bundle has loaded. */
  get isActive(): boolean {
    return this._enabled && this._opts.mode !== 'off' && this._manifest !== null;
  }

  getManifest(): TerrainManifest | null {
    return this._manifest;
  }

  getRules(): TerrainRules | null {
    return this._rules;
  }

  /**
   * Load manifest.json + rules.json from `bundleUrl` (a folder URL served by
   * the host). Resolves true when the bundle is valid and ready.
   */
  async configure(cfg?: { bundleUrl?: string }): Promise<boolean> {
    if (cfg?.bundleUrl !== undefined) this._opts.bundleUrl = cfg.bundleUrl.trim().replace(/\/+$/, '');
    const base = this._opts.bundleUrl;
    const token = ++this._configToken;

    this._manifest = null;
    this._rules = null;
    this._compiled.clear();
    this._cache?.clear();
    this._cache = null;

    if (!base) {
      this._emitState('no-bundle');
      return false;
    }
    try {
      const [manifest, rules] = await Promise.all([
        this._fetchJson<TerrainManifest>(`${base}/manifest.json`),
        this._fetchJson<TerrainRules>(`${base}/rules.json`),
      ]);
      if (token !== this._configToken) return false; // superseded by a newer configure()
      this._validate(manifest, rules);

      this._manifest = manifest;
      this._rules = rules;
      const [w, s, e, n] = manifest.bounds;
      const [x0, y0] = lngLatToMercator(w, s);
      const [x1, y1] = lngLatToMercator(e, n);
      this._boundsMerc = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
      this._cache = new TerrainTileCache(
        new HttpPngTileSource(base, manifest.tileSize),
        this._opts.cacheTiles,
        () => this._onTilesChanged(),
      );
      EngineLogger.success(
        ENGINE,
        `Terrain bundle ready — ${manifest.name ?? base} (rules ${rules.version ?? 'unversioned'})`,
      );
      this._emitState('ready');
      if (this._enabled) this._bindView();
      this._prefetch();
      return true;
    } catch (err) {
      if (token !== this._configToken) return false;
      EngineLogger.error(ENGINE, `Terrain bundle unavailable (${base}): ${(err as Error).message}`);
      this._emitState('no-bundle');
      return false;
    }
  }

  setOptions(patch: Partial<PlacementOptions>): void {
    const prev = this._opts;
    const next: PlacementOptions = { ...prev };
    if (patch.mode === 'off' || patch.mode === 'advise' || patch.mode === 'enforce') next.mode = patch.mode;
    if (typeof patch.bundleUrl === 'string') next.bundleUrl = patch.bundleUrl.trim().replace(/\/+$/, '');
    if (Number.isFinite(patch.nearThresholdM)) next.nearThresholdM = Math.max(0, patch.nearThresholdM as number);
    if (Number.isFinite(patch.partialFraction)) {
      next.partialFraction = Math.min(1, Math.max(0.01, patch.partialFraction as number));
    }
    if (Array.isArray(patch.blockOn)) next.blockOn = [...patch.blockOn];
    if (typeof patch.showBadge === 'boolean') next.showBadge = patch.showBadge;
    if (typeof patch.logVerdicts === 'boolean') next.logVerdicts = patch.logVerdicts;
    if (Number.isFinite(patch.cacheTiles)) next.cacheTiles = Math.max(16, Math.floor(patch.cacheTiles as number));
    if (Number.isFinite(patch.prefetchMarginTiles)) {
      next.prefetchMarginTiles = Math.max(0, Math.floor(patch.prefetchMarginTiles as number));
    }
    if (Number.isFinite(patch.maxSamples)) next.maxSamples = Math.max(8, Math.floor(patch.maxSamples as number));
    this._opts = next;

    if (next.cacheTiles !== prev.cacheTiles) this._cache?.setCapacity(next.cacheTiles);
    if (next.mode === 'off') this.deactivate();
    if (!next.showBadge) this._badge.hide();
    if (next.bundleUrl !== prev.bundleUrl && this._enabled) void this.configure();
    this._lastKey = ''; // thresholds changed — republish the next verdict
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._emitState('enabled');
    if (this._manifest) this._bindView();
    else if (this._opts.bundleUrl) void this.configure();
    else this._emitState('no-bundle');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this.deactivate();
    this._unbindView();
    this._emitState('disabled');
  }

  // ── Draw lifecycle ───────────────────────────────────────────────────────

  /** A draw was armed for this SIDC: resolve its profile and warm the tiles. */
  prepareFor(sidc: string | null | undefined): void {
    if (!this.isActive) return;
    this._activeSidc = sidc ?? null;
    this._activeProfile = resolveProfile(this._activeSidc, this._rules);
    this._attachPointer();
    this._prefetch();
  }

  /** Hot path. Called for every onDrawProgress of the engine's own view. */
  onDrawProgress(detail: any): void {
    if (!this.isActive) return;
    const geometry = detail?.currentGeometry;
    if (!geometry) return;
    const de = detail.currentDrawEssentials;
    const sidc: string | null = de?.SIDC || de?.AMPLIFIER?.SIDC || this._activeSidc;
    if (!this._pointerHandler) this._attachPointer();
    if (sidc && sidc !== this._activeSidc) {
      this._activeSidc = sidc;
      this._activeProfile = resolveProfile(sidc, this._rules);
    }
    this._lastDetail = { geometry, sidc };
    this._publish(this.evaluateGeometry(geometry, sidc));
  }

  /** Draw ended or was cancelled — hide feedback and stop tracking the cursor. */
  deactivate(): void {
    this._badge.hide();
    this._detachPointer();
    this._lastDetail = null;
    this._activeSidc = null;
    this._activeProfile = null;
    if (this._reevalTimer !== null) {
      clearTimeout(this._reevalTimer);
      this._reevalTimer = null;
    }
    if (this._lastKey !== '') {
      this._lastKey = '';
      this._lastKind = '';
      this._emit('placement-clear', {});
    }
  }

  /**
   * Called by SymbolEngine just before a drawn graphic is added. In enforce
   * mode `allow` is false when the verdict is in `blockOn`.
   */
  checkCommit(geometry: any, drawEssentials: any): CommitCheck {
    const sidc: string | null = drawEssentials?.SIDC || drawEssentials?.AMPLIFIER?.SIDC || this._activeSidc;
    const verdict = this.evaluateGeometry(geometry, sidc);
    const stamp: PlacementStamp | null =
      verdict.verdict === 'off' || verdict.verdict === 'exempt'
        ? null
        : {
            verdict: verdict.verdict,
            profile: verdict.profile,
            classCode: verdict.classCode,
            distanceM: verdict.distanceM,
            fraction: verdict.fraction,
          };
    const block = this._opts.mode === 'enforce' && this._opts.blockOn.includes(verdict.verdict);
    if (block) this._emit('placement-blocked', { verdict, drawEssentials });
    return { allow: !block, verdict, stamp };
  }

  onViewChanged(): void {
    this._detachPointer();
    this._unbindView();
    if (this._enabled && this._manifest) this._bindView();
  }

  destroy(): void {
    this.disable();
    this._configToken++;
    this._cache?.clear();
    this._cache = null;
    this._badge.destroy();
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  resolveProfile(sidc: string | null | undefined): PlacementProfile {
    return resolveProfile(sidc, this._rules);
  }

  /** Synchronous verdict for a geometry from the tiles currently in memory. */
  evaluateGeometry(geometry: any, sidc?: string | null): PlacementVerdict {
    const profile = resolveProfile(sidc ?? this._activeSidc, this._rules);
    if (!this.isActive) return this._blank('off', profile, 'Placement advisor off');
    const compiled = this._profile(profile);
    if (compiled.exempt) return this._blank('exempt', profile, 'Not terrain-bound');

    const shape = toMercatorShape(geometry);
    if (!shape) return this._blank('unknown', profile, 'Cannot check this geometry');

    const ctx = this._readContext(profile);
    // One sample per tile pixel along edges, so a 1–2 px wide feature (a stream) is not stepped over.
    const pts = samplePoints(shape, resolutionAt(ctx.z, ctx.ts), this._opts.maxSamples);
    const samples: TerrainSample[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) samples[i] = this._read(ctx, pts[i][0], pts[i][1]);
    const v = evaluateSamples(samples, compiled, this._opts, this._rules);
    if (v.verdict === 'unknown') {
      v.message = (this._cache?.stats().pending ?? 0) > 0 ? 'Terrain data loading…' : 'Outside terrain data coverage';
    }
    return v;
  }

  /** Raw terrain reading at a map point for the armed profile (generic when none is armed). */
  sampleAt(point: any): TerrainSample {
    if (!this.isActive) return NULL_SAMPLE;
    const shape = toMercatorShape(point);
    const p = shape?.parts[0]?.[0];
    if (!p) return NULL_SAMPLE;
    return this._read(this._readContext(this._activeProfile ?? 'generic'), p[0], p[1]);
  }

  tileStats() {
    return this._cache?.stats() ?? { loaded: 0, missing: 0, pending: 0, failed: 0 };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _profile(name: PlacementProfile): CompiledProfile {
    let c = this._compiled.get(name);
    if (!c) {
      c = compileProfile(this._rules, name);
      this._compiled.set(name, c);
    }
    return c;
  }

  private _blank(verdict: PlacementVerdict['verdict'], profile: PlacementProfile, message: string): PlacementVerdict {
    return { verdict, profile, classCode: null, className: null, distanceM: null, fraction: 0, samples: 0, unknown: 0, message };
  }

  private _layerNames(profile: PlacementProfile): { cls: string; dist: string | null } {
    const m = this._manifest!;
    const cls = m.layers?.class ?? 'class';
    const tpl = m.layers?.dist ?? 'dist_{profile}';
    const dist = profile !== 'exempt' && m.profiles.includes(profile) ? tpl.replace('{profile}', profile) : null;
    return { cls, dist };
  }

  /** Per-evaluation lookup state: layer names resolved once, last tile memoised. */
  private _readContext(profile: PlacementProfile): ReadContext {
    const m = this._manifest!;
    const { cls, dist } = this._layerNames(profile);
    return {
      z: this._sampleZoom(),
      ts: m.tileSize,
      scale: m.distScaleM,
      cls,
      dist,
      tx: -1,
      ty: -1,
      ct: undefined,
      dt: undefined,
    };
  }

  private _read(c: ReadContext, mx: number, my: number): TerrainSample {
    const b = this._boundsMerc;
    if (!this._cache || mx < b[0] || mx > b[2] || my < b[1] || my > b[3]) return NULL_SAMPLE;
    const tp = mercatorToTilePixel(mx, my, c.z, c.ts);
    if (tp.tx < 0 || tp.ty < 0 || tp.tx >= 2 ** c.z || tp.ty >= 2 ** c.z) return NULL_SAMPLE;

    // Consecutive samples almost always share a tile — touch the cache (key
    // string + LRU bump) once per tile instead of once per sample.
    if (tp.tx !== c.tx || tp.ty !== c.ty) {
      c.tx = tp.tx;
      c.ty = tp.ty;
      c.ct = this._cache.peek(c.cls, c.z, tp.tx, tp.ty);
      c.dt = c.dist ? this._cache.peek(c.dist, c.z, tp.tx, tp.ty) : undefined;
    }
    if (!c.ct) return NULL_SAMPLE;
    const idx = tp.py * c.ts + tp.px;
    let distanceM: number | null = null;
    if (c.dt) {
      const v = c.dt[idx];
      if (v !== DIST_NODATA) distanceM = v * c.scale;
    }
    return { classCode: c.ct[idx], distanceM };
  }

  /** Tile zoom matching the view's resolution, clamped to the bundle's levels. */
  private _sampleZoom(): number {
    const m = this._manifest!;
    const res = this._viewResolution();
    return res ? zoomForResolution(res, m.zoom.min, m.zoom.max, m.tileSize) : m.zoom.max;
  }

  private _viewResolution(): number | null {
    const view: any = this._getView?.();
    if (!view) return null;
    const direct = view.resolution;
    if (Number.isFinite(direct) && direct > 0) return direct;
    const ext = view.extent;
    const w = view.width;
    if (!ext || !w) return null;
    const shape = toMercatorShape({
      type: 'multipoint',
      points: [[ext.xmin, ext.ymin], [ext.xmax, ext.ymax]],
      spatialReference: ext.spatialReference,
    });
    const pts = shape?.parts[0];
    if (!pts || pts.length < 2) return null;
    const res = Math.abs(pts[1][0] - pts[0][0]) / w;
    return res > 0 ? res : null;
  }

  private _publish(v: PlacementVerdict): void {
    const key = `${v.verdict}|${v.message}`;
    if (key === this._lastKey) return;
    this._lastKey = key;

    if (this._opts.showBadge && v.verdict !== 'off' && v.verdict !== 'exempt') this._badge.show(v);
    else this._badge.hide();

    if (this._opts.logVerdicts && v.verdict !== this._lastKind) {
      if (v.verdict === 'in' || v.verdict === 'partial') EngineLogger.error(ENGINE, v.message);
      else if (v.verdict === 'near' || v.verdict === 'caution') EngineLogger.nextStep(ENGINE, v.message);
    }
    this._lastKind = v.verdict;
    this._emit('placement-advice', v);
  }

  private _onTilesChanged(): void {
    this._emit('placement-tiles', this.tileStats());
    // A tile the cursor was waiting on may have arrived — refresh the verdict.
    if (!this._lastDetail || this._reevalTimer !== null) return;
    this._reevalTimer = setTimeout(() => {
      this._reevalTimer = null;
      const d = this._lastDetail;
      if (d && this.isActive) this._publish(this.evaluateGeometry(d.geometry, d.sidc));
    }, 30);
  }

  /** Fetch the tiles under the viewport (plus a margin) for the armed profile. */
  private _prefetch(): void {
    if (!this.isActive || !this._cache || !this._activeProfile || this._activeProfile === 'exempt') return;
    const view: any = this._getView?.();
    const ext = view?.extent;
    if (!ext) return;
    const shape = toMercatorShape({
      type: 'multipoint',
      points: [[ext.xmin, ext.ymin], [ext.xmax, ext.ymax]],
      spatialReference: ext.spatialReference,
    });
    const pts = shape?.parts[0];
    if (!pts || pts.length < 2) return;

    const m = this._manifest!;
    const z = this._sampleZoom();
    const b = this._boundsMerc;
    const x0 = Math.max(Math.min(pts[0][0], pts[1][0]), b[0]);
    const x1 = Math.min(Math.max(pts[0][0], pts[1][0]), b[2]);
    const y0 = Math.max(Math.min(pts[0][1], pts[1][1]), b[1]);
    const y1 = Math.min(Math.max(pts[0][1], pts[1][1]), b[3]);
    if (x0 > x1 || y0 > y1) return; // view is entirely outside the bundle

    const tl = mercatorToTilePixel(x0, y1, z, m.tileSize);
    const br = mercatorToTilePixel(x1, y0, z, m.tileSize);
    const margin = this._opts.prefetchMarginTiles;
    const n = 2 ** z;
    const tx0 = Math.max(0, tl.tx - margin);
    const tx1 = Math.min(n - 1, br.tx + margin);
    const ty0 = Math.max(0, tl.ty - margin);
    const ty1 = Math.min(n - 1, br.ty + margin);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 120) return; // absurdly large view — rely on on-demand reads

    const { cls, dist } = this._layerNames(this._activeProfile);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        this._cache.request(cls, z, tx, ty);
        if (dist) this._cache.request(dist, z, tx, ty);
      }
    }
  }

  private _bindView(): void {
    this._unbindView();
    const view: any = this._getView?.();
    if (!view) return;
    this._stationaryHandle = reactiveUtils.watch(
      () => view.stationary,
      (stationary: boolean) => {
        if (stationary) this._prefetch();
      },
    );
  }

  private _unbindView(): void {
    this._stationaryHandle?.remove();
    this._stationaryHandle = null;
  }

  private _attachPointer(): void {
    if (this._pointerHandler) return;
    const container = (this._getView?.() as any)?.container as HTMLElement | null | undefined;
    if (!container) return;
    this._pointerHandler = (e: PointerEvent) => this._badge.moveTo(e.clientX, e.clientY);
    container.addEventListener('pointermove', this._pointerHandler, { passive: true });
    this._container = container;
  }

  private _detachPointer(): void {
    if (this._container && this._pointerHandler) {
      this._container.removeEventListener('pointermove', this._pointerHandler);
    }
    this._container = null;
    this._pointerHandler = null;
  }

  private async _fetchJson<T>(url: string): Promise<T> {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
    return (await resp.json()) as T;
  }

  private _validate(m: TerrainManifest, r: TerrainRules): void {
    if (!m || m.format !== 'pams-terrain-bundle') throw new Error('manifest.json is not a pams-terrain-bundle');
    if (m.version !== 1) throw new Error(`unsupported bundle version ${m.version} (this build reads version 1)`);
    if (!(m.tileSize > 0) || !m.zoom || !(m.zoom.max >= m.zoom.min)) throw new Error('manifest zoom/tileSize invalid');
    if (!Array.isArray(m.bounds) || m.bounds.length !== 4) throw new Error('manifest bounds invalid');
    if (!(m.distScaleM > 0)) throw new Error('manifest distScaleM invalid');
    if (!Array.isArray(m.profiles)) throw new Error('manifest profiles missing');
    if (!r || typeof r.classes !== 'object' || typeof r.profiles !== 'object') throw new Error('rules.json invalid');
  }

  private _emitState(state: 'enabled' | 'disabled' | 'ready' | 'no-bundle'): void {
    this._emit('placement-state-change', { state, isEnabled: this._enabled });
  }

  private _emit(type: string, detail: unknown): void {
    const target: EventTarget = ((this._getView?.() as any)?.container as HTMLElement | undefined) ?? document;
    target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}
