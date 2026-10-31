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
import { SYMBOL_LAYER_IDS } from '../../Managers/GraphicsLayerManager';
import EngineLogger from '../../Support/EngineLogger';
import { compileProfile, evaluateSamples, fmtDistance, type CompiledProfile } from './PlacementEvaluator';
import { PlacementBadge } from './PlacementBadge';
import { PlacementBoundary } from './PlacementBoundary';
import { checkSpacing, echelonCodeOf, planFootprint, sideOf, type FootprintCandidate, type FootprintPlan } from './PlacementFootprint';
import { PlacementIndicators } from './PlacementIndicators';
import { createOverlayLayer, type OverlayRenderingSource } from './PlacementOverlay';
import { WorkerTileSource } from './WorkerTileSource';
import { resolveProfile } from './PlacementProfiles';
import { samplePoints, toMercatorShape, type MercShape } from './PlacementSampling';
import {
  DEFAULT_PLACEMENT_OPTIONS,
  DIST_FAR,
  DIST_NODATA,
  NODATA_CLASS,
  layerNames,
  type MercXY,
  type PlacementIndicator,
  type PlacementNearest,
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
  MERC_ORIGIN,
  TerrainTileCache,
  lngLatToMercator,
  mercatorToTilePixel,
  resolutionAt,
  zoomForResolution,
} from './TerrainTileCache';

const ENGINE = 'Placement Advisor';
const NULL_SAMPLE: TerrainSample = { classCode: null, distanceM: null };
/** Layers whose point symbols count as neighbours for the intergap check. */
const NEIGHBOUR_LAYER_IDS = SYMBOL_LAYER_IDS;
/** Half-width of the local search for the nearest terrain of the opposite kind, in tile pixels. */
const SCAN_RADIUS_PX = 32;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

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
  /** Set when a sample needed a tile that has not arrived (as opposed to one with no coverage). */
  waiting: boolean;
}

/** Orders verdicts for worst-of-N facings: higher is worse. Ties go to the larger share in no-go, then the smaller gap to it. */
function severity(v: PlacementVerdict): number {
  const rank =
    v.verdict === 'in' ? 5
    : v.verdict === 'partial' ? 4
    : v.verdict === 'near' && v.fraction > 0 ? 3
    : v.verdict === 'caution' ? 2
    : v.verdict === 'near' ? 1
    : v.verdict === 'ok' ? 0
    : -1;
  return rank * 10 + v.fraction * 5 + (v.distanceM === null ? 0 : 1 / (1 + v.distanceM));
}

/** SIDC of an already-placed graphic. */
function graphicSidc(g: any): string | null {
  const a = g?.attributes;
  return a?.drawEssentials?.SIDC || a?.drawEssentials?.AMPLIFIER?.SIDC || a?.sidc || a?.SIDC || null;
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
  private _source: OverlayRenderingSource | null = null;
  private _overlay: any = null;
  private _overlayMap: any = null;
  private _overlayShown: PlacementProfile | null = null;
  private _lastArmedProfile: PlacementProfile | null = null;
  private _compiled = new Map<PlacementProfile, CompiledProfile>();
  private _configToken = 0;

  private _activeSidc: string | null = null;
  private _activeProfile: PlacementProfile | null = null;
  private _lastDetail: { geometry: any; sidc: string | null } | null = null;
  private _lastKey = '';
  private _lastBadgeKey = '';
  private _lastWarmKey = '';
  private _lastKind = '';
  private _lastSpacingMsg = '';
  private _reevalTimer: ReturnType<typeof setTimeout> | null = null;

  private _badge = new PlacementBadge();
  private _indicators = new PlacementIndicators(() => this._getView());
  private _boundary = new PlacementBoundary(() => this._getView());
  private _lastClient: { x: number; y: number } | null = null;
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
    this._source?.dispose?.();
    this._source = null;
    this._removeOverlay();
    this._boundary.reset(); // a different bundle may carry a different (or no) boundary file

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
      this._source = this._makeSource(base, manifest.tileSize);
      this._cache = new TerrainTileCache(this._source, this._opts.cacheTiles, () => this._onTilesChanged());
      EngineLogger.success(
        ENGINE,
        `Terrain bundle ready — ${manifest.name ?? base} (rules ${rules.version ?? 'unversioned'})`,
      );
      this._emitState('ready');
      if (this._enabled) this._bindView();
      this._prefetch();
      this._syncOverlay();
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
    if (typeof patch.useWorker === 'boolean') next.useWorker = patch.useWorker;
    const ind = patch.indicators;
    next.indicators = { ...prev.indicators };
    if (ind && typeof ind === 'object') {
      if (typeof ind.enabled === 'boolean') next.indicators.enabled = ind.enabled;
      if (typeof ind.labels === 'boolean') next.indicators.labels = ind.labels;
    }
    const ov = patch.overlay;
    next.overlay = { ...prev.overlay };
    if (ov && typeof ov === 'object') {
      if (typeof ov.enabled === 'boolean') next.overlay.enabled = ov.enabled;
      if (typeof ov.profile === 'string' && (ov.profile === 'auto' || ov.profile !== 'exempt')) {
        next.overlay.profile = ov.profile as PlacementOptions['overlay']['profile'];
      }
      if (Number.isFinite(ov.opacity)) next.overlay.opacity = Math.min(1, Math.max(0.05, ov.opacity));
      if (typeof ov.boundary === 'boolean') next.overlay.boundary = ov.boundary;
    }
    const fp = patch.footprint;
    next.footprint = { ...prev.footprint };
    if (fp && typeof fp === 'object') {
      if (typeof fp.enabled === 'boolean') next.footprint.enabled = fp.enabled;
      if (fp.facing === 'fixed' || fp.facing === 'worst4' || fp.facing === 'circle') next.footprint.facing = fp.facing;
      if (Number.isFinite(fp.bearingDeg)) next.footprint.bearingDeg = (((fp.bearingDeg % 360) + 360) % 360);
      if (fp.size === 'min' || fp.size === 'mid' || fp.size === 'max') next.footprint.size = fp.size;
      if (typeof fp.outline === 'boolean') next.footprint.outline = fp.outline;
      if (typeof fp.spacing === 'boolean') next.footprint.spacing = fp.spacing;
    }
    this._opts = next;

    if (next.cacheTiles !== prev.cacheTiles) this._cache?.setCapacity(next.cacheTiles);
    if (next.useWorker !== prev.useWorker) this._swapSource();
    this._syncOverlay(next.overlay.profile !== prev.overlay.profile || next.nearThresholdM !== prev.nearThresholdM);
    if (next.mode === 'off') this.deactivate();
    if (!next.showBadge) this._badge.hide();
    if (!next.indicators.enabled) this._indicators.hide();
    if (!next.footprint.outline || !next.footprint.enabled) this._indicators.hideFootprint();
    if (next.bundleUrl !== prev.bundleUrl && this._enabled) void this.configure();
    this._lastKey = ''; // thresholds changed — republish the next verdict
    this._lastBadgeKey = '';
    this._prefetch(); // mode switched on / overlay profile changed — make sure its layers are warm
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
    this._removeOverlay();
    this._boundary.hide();
    this._emitState('disabled');
  }

  // ── Draw lifecycle ───────────────────────────────────────────────────────

  /** A draw was armed for this SIDC: resolve its profile and warm the tiles. */
  prepareFor(sidc: string | null | undefined): void {
    if (!this.isActive) return;
    this._activeSidc = sidc ?? null;
    this._activeProfile = resolveProfile(this._activeSidc, this._rules);
    if (this._activeProfile !== 'exempt') this._lastArmedProfile = this._activeProfile;
    this._attachPointer();
    this._prefetch();
    this._syncOverlay();
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
    this._warmAround(geometry, resolveProfile(sidc ?? this._activeSidc, this._rules));
    this._apply(this.evaluateGeometry(geometry, sidc, { ref: () => this._pointerMerc() }));
  }

  /** Draw ended or was cancelled — hide feedback and stop tracking the cursor. */
  deactivate(): void {
    this._badge.hide();
    this._indicators.hide();
    this._indicators.hideFootprint();
    this._detachPointer();
    this._lastDetail = null;
    this._lastBadgeKey = '';
    this._lastWarmKey = '';
    this._activeSidc = null;
    this._activeProfile = null;
    if (this._reevalTimer !== null) {
      clearTimeout(this._reevalTimer);
      this._reevalTimer = null;
    }
    if (this._lastKey !== '') {
      this._lastKey = '';
      this._lastKind = '';
      this._lastSpacingMsg = '';
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
            ...(verdict.footprint && {
              echelon: verdict.footprint.echelon,
              frontageM: verdict.footprint.frontageM,
              depthM: verdict.footprint.depthM,
              ...(verdict.spacing && { spacing: verdict.spacing.status }),
            }),
          };
    const block = this._opts.mode === 'enforce' && this._opts.blockOn.includes(verdict.verdict);
    if (block) this._emit('placement-blocked', { verdict, drawEssentials });
    return { allow: !block, verdict, stamp };
  }

  onViewChanged(): void {
    this._detachPointer();
    this._unbindView();
    if (this._enabled && this._manifest) this._bindView();
    this._boundary.onViewChanged(); // leave the old map; _syncOverlay() re-attaches it to the new one
    this._syncOverlay(); // moves the overlay (and the boundary) onto the new view's map
    this._indicators.onViewChanged(); // re-attaches to the new map on the next show
  }

  destroy(): void {
    this.disable();
    this._indicators.destroy();
    this._boundary.reset();
    this._configToken++;
    this._cache?.clear();
    this._cache = null;
    this._source?.dispose?.();
    this._source = null;
    this._badge.destroy();
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  resolveProfile(sidc: string | null | undefined): PlacementProfile {
    return resolveProfile(sidc, this._rules);
  }

  /** Synchronous verdict for a geometry from the tiles currently in memory. */
  evaluateGeometry(geometry: any, sidc?: string | null, opts?: { ref?: () => MercXY | null }): PlacementVerdict {
    const profile = resolveProfile(sidc ?? this._activeSidc, this._rules);
    if (!this.isActive) return this._blank('off', profile, 'Placement advisor off');
    const compiled = this._profile(profile);
    if (compiled.exempt) return this._blank('exempt', profile, 'Not terrain-bound');

    const shape = toMercatorShape(geometry);
    if (!shape) return this._blank('unknown', profile, 'Cannot check this geometry');

    const ctx = this._readContext(profile);
    const evalOpts = {
      nearThresholdM: this._opts.nearThresholdM,
      partialFraction: this._opts.partialFraction,
      farM: DIST_FAR * ctx.scale,
    };
    // An echelon symbol occupies ground (frontage × depth), so it is judged on its footprint
    // rather than its click point. Several candidates (worst-of-four facings) keep the worst.
    const effSidc = sidc ?? this._activeSidc;
    const plan = planFootprint(shape, effSidc, this._rules, this._opts.footprint);
    const candidates: Array<{ shape: MercShape; cand: FootprintCandidate | null }> = plan
      ? plan.candidates.map((cand) => ({ shape: cand.shape, cand }))
      : [{ shape, cand: null }];

    let best: { v: PlacementVerdict; samples: TerrainSample[]; pts: MercXY[]; cand: FootprintCandidate | null } | null = null;
    for (const c of candidates) {
      // One sample per tile pixel along edges, so a 1–2 px wide feature (a stream) is not stepped over.
      const cpts = samplePoints(c.shape, resolutionAt(ctx.z, ctx.ts), this._opts.maxSamples);
      const csamples: TerrainSample[] = new Array(cpts.length);
      for (let i = 0; i < cpts.length; i++) csamples[i] = this._read(ctx, cpts[i][0], cpts[i][1]);
      const cv = evaluateSamples(csamples, compiled, evalOpts, this._rules);
      if (!best || severity(cv) > severity(best.v)) best = { v: cv, samples: csamples, pts: cpts, cand: c.cand };
    }
    const { v, samples, pts, cand } = best!;
    const stats = this._cache?.stats();
    if (v.verdict === 'unknown') {
      // Judge by the tiles this shape needed, not the cache-wide counts: a prefetch burst keeps
      // `pending` high long after the cursor's own tile arrived (or when it is outside coverage).
      v.message = !ctx.waiting
        ? 'Outside terrain data coverage'
        : (stats?.pending ?? 0) > 0
          ? 'Terrain data loading…'
          : 'Terrain data could not be loaded';
    } else {
      this._enrich(v, samples, pts, ctx, compiled);
      this._addIndicators(v, samples, pts, compiled, opts?.ref);
      // A shape spanning tiles that are still arriving is judged on what is known so far.
      if (v.unknown > 0 && ctx.waiting && (stats?.pending ?? 0) > 0) {
        v.detail = v.detail ? `${v.detail} · still loading terrain data` : 'Still loading terrain data';
        v.loading = true;
      }
    }
    if (plan && cand) this._applyFootprint(v, plan, cand, effSidc);
    return v;
  }

  /** Record the footprint the verdict was judged on, say so in the detail line, and run the intergap check. */
  private _applyFootprint(v: PlacementVerdict, plan: FootprintPlan, cand: FootprintCandidate, sidc: string | null): void {
    const d = plan.dims;
    v.footprint = {
      code: d.code,
      echelon: d.name,
      frontageM: d.frontageM,
      depthM: d.depthM,
      gapM: d.gapM,
      facingDeg: cand.facingDeg,
      facing: plan.facing,
      ring: cand.ring,
    };
    v.message = v.message.replace(' of the shape', ' of the footprint');
    const text =
      cand.facingDeg === null
        ? `${d.name} footprint ⌀ ${fmtDistance(d.frontageM)}`
        : `${d.name} footprint ${fmtDistance(d.frontageM)}${d.depthM > 0 ? ` × ${fmtDistance(d.depthM)}` : ' front'}, facing ${COMPASS[Math.round(cand.facingDeg / 45) % 8]}`;
    v.detail = v.detail ? `${v.detail} · ${text}` : text;
    if (this._opts.footprint.spacing) v.spacing = checkSpacing(plan, this._neighbours(d.code, sidc));
  }

  /** Web Mercator positions of same-echelon, same-side point symbols already on the map. */
  private _neighbours(code: string, sidc: string | null): MercXY[] {
    const map = (this._getView?.() as any)?.map;
    if (!map) return [];
    const side = sideOf(sidc);
    const out: MercXY[] = [];
    for (const id of NEIGHBOUR_LAYER_IDS) {
      const layer = map.findLayerById?.(id);
      layer?.graphics?.forEach((g: any) => {
        const geom = g?.geometry;
        if (geom?.type !== 'point') return;
        const gs = graphicSidc(g);
        // Cheap string test first: this runs for every symbol on the map on each mouse move.
        if (!gs || gs.length !== 20 || gs.substring(8, 10) !== code || echelonCodeOf(gs) !== code || sideOf(gs) !== side) return;
        const m = toMercatorShape(geom)?.parts[0]?.[0];
        if (m) out.push(m);
      });
    }
    return out;
  }

  /**
   * Say what is nearby. The distance layer gives how far the nearest no-go is
   * but not what it is, so search the class tile around the deciding sample for
   * the closest pixel of the opposite kind (no-go near a deployable point,
   * deployable ground near a no-go point) and report its class, distance and
   * compass direction. One bounded window scan per evaluation (≤ 65×65 px).
   */
  private _enrich(
    v: PlacementVerdict,
    samples: TerrainSample[],
    pts: Array<[number, number]>,
    ctx: ReadContext,
    cp: CompiledProfile,
  ): void {
    const label = v.profileLabel;
    if (v.verdict === 'in' && pts.length === 1) {
      const { nearest, rangeM } = this._scanNearest(ctx, pts[0][0], pts[0][1], false, cp);
      if (nearest) {
        v.nearest = nearest;
        v.detail = `Nearest deployable ground: ${nearest.className}, ${fmtDistance(nearest.distanceM)} to the ${nearest.compass}`;
      } else if (rangeM > 0) {
        v.detail = `No deployable ground within ${fmtDistance(rangeM)}`;
        v.noneWithinM = rangeM;
      }
      return;
    }
    const touching = v.fraction > 0;
    if (touching || (v.verdict !== 'near' && v.verdict !== 'caution' && v.verdict !== 'ok')) return;

    // The deciding sample is the deployable one closest to no-go.
    let idx = -1;
    let best = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.classCode === null || s.classCode === NODATA_CLASS || cp.nogo[s.classCode]) continue;
      const d = s.distanceM ?? Infinity;
      if (idx < 0 || d < best) {
        idx = i;
        best = d;
      }
    }
    if (idx < 0) return;
    const { nearest } = this._scanNearest(ctx, pts[idx][0], pts[idx][1], true, cp);
    if (!nearest) return;
    v.nearest = nearest;
    // Prefer the pipeline's exact distance; the scan supplies the class and direction.
    const dist = v.distanceM !== null && v.distanceM < ctx.scale * DIST_FAR ? v.distanceM : nearest.distanceM;
    nearest.distanceM = dist; // the badge shows the exact figure, not the pixel-scan estimate
    const where = `${nearest.className}, ${fmtDistance(dist)} to the ${nearest.compass}`;
    if (v.verdict === 'near') {
      v.message =
        dist < 1
          ? `At the edge of ${nearest.className}`
          : `${nearest.className} ${fmtDistance(dist)} to the ${nearest.compass}`;
      v.detail = `No-go for ${label}`;
    } else if (v.verdict === 'caution') {
      v.detail = `Difficult ground for ${label}. Nearest no-go: ${where}`;
    } else {
      v.detail = `Nearest no-go: ${where}`;
    }
  }

  /**
   * Closest pixel of the wanted kind within SCAN_RADIUS_PX of a map point.
   * `rangeM` is the ground distance the window covered (for "none within …").
   */
  private _scanNearest(
    ctx: ReadContext,
    mx: number,
    my: number,
    wantNoGo: boolean,
    cp: CompiledProfile,
  ): { nearest: PlacementNearest | null; rangeM: number } {
    const cache = this._cache;
    if (!cache) return { nearest: null, rangeM: 0 };
    const res = resolutionAt(ctx.z, ctx.ts);
    const lat = 2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2;
    const groundPx = res * Math.cos(lat); // true metres per tile pixel here
    const ts = ctx.ts;
    const n = 2 ** ctx.z;
    const cx = Math.floor((mx + MERC_ORIGIN) / res);
    const cy = Math.floor((MERC_ORIGIN - my) / res);
    const R = SCAN_RADIUS_PX;
    const tiles = new Map<number, Uint8Array | null | undefined>();

    let bestD2 = Infinity;
    let bdx = 0;
    let bdy = 0;
    let bcls = -1;
    for (let dy = -R; dy <= R; dy++) {
      const gy = cy + dy;
      if (gy < 0 || gy >= n * ts) continue;
      const ty = Math.floor(gy / ts);
      const py = gy - ty * ts;
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 >= bestD2 || d2 > R * R) continue;
        const gx = cx + dx;
        if (gx < 0 || gx >= n * ts) continue;
        const tx = Math.floor(gx / ts);
        const key = ty * n + tx;
        let t: Uint8Array | null | undefined;
        if (tiles.has(key)) t = tiles.get(key);
        else {
          t = cache.peek(ctx.cls, ctx.z, tx, ty);
          tiles.set(key, t);
        }
        if (!t) continue;
        const c = t[py * ts + (gx - tx * ts)];
        if (c === NODATA_CLASS) continue;
        if (wantNoGo ? cp.nogo[c] === 1 : cp.nogo[c] === 0) {
          bestD2 = d2;
          bdx = dx;
          bdy = dy;
          bcls = c;
        }
      }
    }
    const rangeM = R * groundPx;
    if (bcls < 0) return { nearest: null, rangeM };
    // Pixel centres are one pixel apart; the edge of the target is half a pixel nearer.
    const distanceM = Math.max(0, (Math.sqrt(bestD2) - 0.5) * groundPx);
    const bearingDeg = ((Math.atan2(bdx, -bdy) * 180) / Math.PI + 360) % 360;
    // Where the edge of that pixel is: from the sample towards the pixel centre, stopping half a pixel short.
    const pcx = (cx + bdx + 0.5) * res - MERC_ORIGIN;
    const pcy = MERC_ORIGIN - (cy + bdy + 0.5) * res;
    const len = Math.hypot(pcx - mx, pcy - my);
    const k = len > 0.5 * res ? (len - 0.5 * res) / len : 1;
    const to: MercXY = len > 0.5 * res ? [mx + (pcx - mx) * k, my + (pcy - my) * k] : [pcx, pcy];
    return {
      rangeM,
      nearest: {
        kind: wantNoGo ? 'no-go' : 'deployable',
        classCode: bcls,
        className: this._rules?.classes?.[String(bcls)]?.label ?? `class ${bcls}`,
        distanceM,
        from: [mx, my],
        to,
        bearingDeg,
        compass: COMPASS[Math.round(bearingDeg / 45) % 8],
      },
    };
  }

  /**
   * Lines to the terrain behind the verdict, in Web Mercator metres (the advisor draws
   * them itself; the same data rides on the `placement-advice` event for hosts).
   *  - too close to no-go (point, or the part of a shape nearest it): to that no-go edge;
   *  - a point inside no-go: to the nearest deployable ground;
   *  - a line/area partly or mostly in no-go: from the cursor to the nearest contested
   *    sample, with marks on the contested samples.
   */
  private _addIndicators(
    v: PlacementVerdict,
    samples: TerrainSample[],
    pts: MercXY[],
    cp: CompiledProfile,
    ref?: () => MercXY | null,
  ): void {
    const n = v.nearest;
    const single = pts.length === 1;
    if (n && ((v.verdict === 'near' && v.fraction === 0) || (v.verdict === 'in' && single))) {
      v.indicators.push({
        kind: n.kind,
        from: n.from,
        to: n.to,
        marks: [],
        classCode: n.classCode,
        className: n.className,
        label:
          n.kind === 'no-go'
            ? v.message
            : `${n.className} ${fmtDistance(n.distanceM)} to the ${n.compass}`,
      });
      return;
    }
    if (single || !(v.verdict === 'in' || v.verdict === 'partial' || (v.verdict === 'near' && v.fraction > 0))) return;

    const bad: MercXY[] = [];
    for (let i = 0; i < samples.length; i++) {
      const c = samples[i].classCode;
      if (c !== null && c !== NODATA_CLASS && cp.nogo[c]) bad.push(pts[i]);
    }
    if (bad.length === 0) return;
    let from = ref?.() ?? null;
    if (!from) {
      let sx = 0;
      let sy = 0;
      for (const p of pts) {
        sx += p[0];
        sy += p[1];
      }
      from = [sx / pts.length, sy / pts.length];
    }
    let to = bad[0];
    let best = Infinity;
    for (const b of bad) {
      const d = Math.hypot(b[0] - from[0], b[1] - from[1]);
      if (d < best) {
        best = d;
        to = b;
      }
    }
    const stride = Math.max(1, Math.ceil(bad.length / 16));
    const ind: PlacementIndicator = {
      kind: 'contested',
      from,
      to,
      marks: bad.filter((_, i) => i % stride === 0),
      classCode: v.classCode,
      className: v.className,
      label: `${v.className ?? 'No-go'} (${Math.max(1, Math.round(v.fraction * 100))}% of the shape)`,
    };
    v.indicators.push(ind);
  }

  /** Cursor position in Web Mercator metres, for shapes where "the pointer" is not a vertex. */
  private _pointerMerc(): MercXY | null {
    const view: any = this._getView?.();
    const c = this._container;
    const p = this._lastClient;
    if (!view || !c || !p) return null;
    const r = c.getBoundingClientRect();
    let mp: any = null;
    try {
      mp = view.toMap({ x: p.x - r.left, y: p.y - r.top });
    } catch {
      return null;
    }
    return mp ? (toMercatorShape(mp)?.parts[0]?.[0] ?? null) : null;
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

  /** The indicator-line layer (null until a line has been drawn), for hosts that want to inspect or restyle it. */
  get indicatorLayer(): any {
    return this._indicators.layer;
  }

  /** True while tile decoding and overlay painting run in the Web Worker (false = main thread). */
  get tileWorkerActive(): boolean {
    return this._source?.workerActive === true;
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
    return {
      verdict,
      profile,
      profileLabel: this._rules?.profiles?.[profile]?.label ?? profile,
      detail: null,
      nearest: null,
      indicators: [],
      classCode: null,
      className: null,
      distanceM: null,
      fraction: 0,
      samples: 0,
      unknown: 0,
      message,
    };
  }

  private _layerNames(profile: PlacementProfile): { cls: string; dist: string | null } {
    return layerNames(this._manifest!, profile);
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
      waiting: false,
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
    if (!c.ct) {
      if (c.ct === undefined) c.waiting = true;
      return NULL_SAMPLE;
    }
    // Class tile arrived but its distance tile has not: report unknown rather than a verdict
    // computed without the distance (a transient wrong "ok" next to a marsh).
    if (c.dist && c.dt === undefined) {
      c.waiting = true;
      return NULL_SAMPLE;
    }
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

  /** Update the map lines (every call: their end follows the cursor), then badge + events (only on change). */
  private _apply(v: PlacementVerdict): void {
    if (this._opts.indicators.enabled && this.isActive && v.indicators.length > 0) {
      this._indicators.show(v.indicators, this._opts.indicators.labels);
    } else {
      this._indicators.hide();
    }
    if (this._opts.footprint.outline && this.isActive && v.footprint) {
      this._indicators.showFootprint(v.footprint.ring, v.spacing?.conflicts.map((c) => c.ring) ?? []);
    } else {
      this._indicators.hideFootprint();
    }
    this._publish(v);
  }

  /** The card shows figures (percent, distances, gaps) the event key does not carry, so it refreshes on its own key. */
  private _showBadge(v: PlacementVerdict): void {
    const key = [
      v.verdict, v.message, v.detail ?? '', v.loading ? 1 : 0, Math.round(v.fraction * 100),
      Math.round(v.nearest?.distanceM ?? -1), v.nearest?.compass ?? '',
      v.spacing?.status ?? '', Math.round(v.spacing?.nearestGapM ?? -1),
    ].join('|');
    if (key === this._lastBadgeKey) return;
    this._lastBadgeKey = key;
    if (this._opts.showBadge && v.verdict !== 'off' && v.verdict !== 'exempt') this._badge.show(v);
    else this._badge.hide();
  }

  private _publish(v: PlacementVerdict): void {
    this._showBadge(v);
    const key = `${v.verdict}|${v.message}|${v.detail ?? ''}|${v.spacing?.message ?? ''}`;
    if (key === this._lastKey) return;
    this._lastKey = key;

    if (this._opts.logVerdicts && v.verdict !== this._lastKind) {
      if (v.verdict === 'in' || v.verdict === 'partial') EngineLogger.error(ENGINE, v.message);
      else if (v.verdict === 'near' || v.verdict === 'caution') EngineLogger.nextStep(ENGINE, v.message);
    }
    this._lastKind = v.verdict;
    const spacingMsg = v.spacing?.message ?? '';
    if (this._opts.logVerdicts && spacingMsg && spacingMsg !== this._lastSpacingMsg) {
      EngineLogger.nextStep(ENGINE, spacingMsg);
    }
    this._lastSpacingMsg = spacingMsg;
    this._emit('placement-advice', v);
  }

  private _onTilesChanged(): void {
    this._emit('placement-tiles', this.tileStats());
    // A tile the cursor was waiting on may have arrived — refresh the verdict.
    if (!this._lastDetail || this._reevalTimer !== null) return;
    this._reevalTimer = setTimeout(() => {
      this._reevalTimer = null;
      const d = this._lastDetail;
      if (d && this.isActive) this._apply(this.evaluateGeometry(d.geometry, d.sidc, { ref: () => this._pointerMerc() }));
    }, 30);
  }

  /**
   * Fetch the tiles under the viewport (plus a margin). With a symbol armed this is
   * its profile's layers; while idle it warms the class layer and every profile's
   * distance layer (when they fit the cache), so the first draw already has data.
   */
  private _prefetch(): void {
    if (!this.isActive || !this._cache) return;
    if (this._activeProfile === 'exempt') return;
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

    // Whatever was queued for the previous viewport / profile is stale; letting it drain first
    // would keep the tile under the cursor waiting behind hundreds of off-screen ones.
    this._cache.cancelQueued();

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
    let tx0 = Math.max(0, tl.tx - margin);
    let tx1 = Math.min(n - 1, br.tx + margin);
    let ty0 = Math.max(0, tl.ty - margin);
    let ty1 = Math.min(n - 1, br.ty + margin);
    // A very large view (big monitor, tilted 3D horizon, low zoom over a wide bundle) would flood the
    // queue, but skipping it altogether leaves every tile to load under the cursor — so warm a capped
    // window around the middle of it and let the cursor-following warm-up (_warmAround) cover the rest.
    const MAX_SIDE = 10;
    if (tx1 - tx0 + 1 > MAX_SIDE) {
      tx0 = Math.max(0, Math.round((tx0 + tx1) / 2) - MAX_SIDE / 2);
      tx1 = Math.min(n - 1, tx0 + MAX_SIDE - 1);
    }
    if (ty1 - ty0 + 1 > MAX_SIDE) {
      ty0 = Math.max(0, Math.round((ty0 + ty1) / 2) - MAX_SIDE / 2);
      ty1 = Math.min(n - 1, ty0 + MAX_SIDE - 1);
    }
    this._lastWarmKey = ''; // the queue was cleared above; let the cursor ring be requested again
    // Armed: just that symbol's layers. Idle: the class layer plus every profile's distance
    // layer, so whatever symbol is drawn first already has its data — unless that would
    // overflow the cache, in which case warm only the likeliest profile.
    const perLayer = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    const profiles: PlacementProfile[] = [];
    if (this._activeProfile) profiles.push(this._activeProfile);
    else if (perLayer * (m.profiles.length + 1) <= this._opts.cacheTiles * 0.9) {
      profiles.push(...(m.profiles as PlacementProfile[]));
    } else {
      profiles.push(this._overlayProfileNow());
    }
    const layers = new Set<string>();
    for (const p of profiles) {
      const { cls, dist } = this._layerNames(p);
      layers.add(cls);
      if (dist) layers.add(dist);
    }
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        for (const layer of layers) this._cache.request(layer, z, tx, ty);
      }
    }
  }

  /**
   * Warm the tiles around the cursor (the armed profile's class + distance layers) whenever it
   * enters a new tile, so the next few tiles it crosses are already decoded. Requests are cheap
   * and de-duplicated; this is what keeps the badge off "loading" while the symbol is dragged
   * across ground the viewport prefetch did not cover.
   */
  private _warmAround(geometry: any, profile: PlacementProfile): void {
    const cache = this._cache;
    if (!cache || profile === 'exempt') return;
    const p = toMercatorShape(geometry)?.parts[0]?.[0];
    if (!p) return;
    const m = this._manifest!;
    const z = this._sampleZoom();
    const tp = mercatorToTilePixel(p[0], p[1], z, m.tileSize);
    const key = `${profile}|${z}|${tp.tx}|${tp.ty}`;
    if (key === this._lastWarmKey) return;
    this._lastWarmKey = key;
    const { cls, dist } = this._layerNames(profile);
    const n = 2 ** z;
    const R = 2;
    for (let ty = Math.max(0, tp.ty - R); ty <= Math.min(n - 1, tp.ty + R); ty++) {
      for (let tx = Math.max(0, tp.tx - R); tx <= Math.min(n - 1, tp.tx + R); tx++) {
        cache.request(cls, z, tx, ty);
        if (dist) cache.request(dist, z, tx, ty);
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
      { initial: true }, // warm the current viewport now, not on the first pan or draw
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
    this._pointerHandler = (e: PointerEvent) => {
      this._lastClient = { x: e.clientX, y: e.clientY };
      this._badge.moveTo(e.clientX, e.clientY);
    };
    container.addEventListener('pointermove', this._pointerHandler, { passive: true });
    this._container = container;
  }

  private _detachPointer(): void {
    if (this._container && this._pointerHandler) {
      this._container.removeEventListener('pointermove', this._pointerHandler);
    }
    this._container = null;
    this._pointerHandler = null;
    this._lastClient = null;
  }

  // ── Tile source ──────────────────────────────────────────────────────────

  /** Worker-backed source when enabled and supported, else the main-thread one. */
  private _makeSource(base: string, tileSize: number): OverlayRenderingSource {
    return this._opts.useWorker && typeof Worker !== 'undefined'
      ? new WorkerTileSource(base, tileSize)
      : new HttpPngTileSource(base, tileSize);
  }

  /** Switch worker ↔ main thread at runtime without reloading the bundle. */
  private _swapSource(): void {
    if (!this._manifest || !this._opts.bundleUrl || !this._cache) return;
    const old = this._source;
    this._source = this._makeSource(this._opts.bundleUrl, this._manifest.tileSize);
    this._cache.setSource(this._source); // clears the cache; tiles reload on demand
    old?.dispose?.();
    if (this._overlay) {
      this._removeOverlay();
      this._syncOverlay();
    }
    this._prefetch();
  }

  // ── Map overlay ──────────────────────────────────────────────────────────

  /** Profile the overlay paints: the chosen one, or (auto) the armed symbol's, else the last armed, else dismounted. */
  private _overlayProfileNow(): PlacementProfile {
    const p = this._opts.overlay.profile;
    if (p !== 'auto') return p;
    const armed = this._activeProfile && this._activeProfile !== 'exempt' ? this._activeProfile : null;
    return armed ?? this._lastArmedProfile ?? 'dismounted';
  }

  /** Add / update / remove the overlay layer to match the options. Safe to call at any time. */
  /** Draw the bundle's boundary outline when the option is on and the bundle ships one. */
  private _syncBoundary(): void {
    const file = this._manifest?.boundary?.file;
    if (!(this._enabled && file && this._opts.overlay.boundary && this._opts.bundleUrl)) {
      this._boundary.hide();
      return;
    }
    void this._boundary.load(`${this._opts.bundleUrl}/${file}`).then((ok) => {
      if (ok && this._enabled && this._opts.overlay.boundary) this._boundary.show();
    });
  }

  private _syncOverlay(refresh = false): void {
    this._syncBoundary();
    const want = this._enabled && this._manifest !== null && this._rules !== null && this._opts.overlay.enabled;
    if (!want) {
      this._removeOverlay();
      return;
    }
    const map = (this._getView?.() as any)?.map;
    if (!map || !this._source) return;
    if (!this._overlay) {
      this._overlay = createOverlayLayer(
        {
          source: this._source,
          manifest: this._manifest!,
          rules: this._rules!,
          getProfile: () => this._overlayProfileNow(),
          getNearM: () => this._opts.nearThresholdM,
        },
        this._opts.overlay.opacity,
      );
      this._overlayShown = null;
    }
    if (this._overlayMap !== map) {
      this._overlayMap?.remove(this._overlay);
      map.add(this._overlay, 0); // under the symbol graphics layers
      this._overlayMap = map;
    }
    this._overlay.opacity = this._opts.overlay.opacity;
    const profile = this._overlayProfileNow();
    if (refresh || (this._overlayShown !== null && this._overlayShown !== profile)) this._overlay.refresh?.();
    this._overlayShown = profile;
  }

  private _removeOverlay(): void {
    if (this._overlay) {
      try {
        this._overlayMap?.remove(this._overlay);
        this._overlay.destroy?.();
      } catch {
        /* map already torn down */
      }
    }
    this._overlay = null;
    this._overlayMap = null;
    this._overlayShown = null;
  }

  /** The overlay layer when it is on the map (for hosts that want to restyle or inspect it). */
  get overlayLayer(): any {
    return this._overlay;
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
