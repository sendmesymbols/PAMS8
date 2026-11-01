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
 *   "placement-state-change" – { state: "enabled"|"disabled"|"ready"|"no-bundle", isEnabled, error }
 *                              (`error` says why when the bundle failed; see also `status` / `retry()`)
 *   "placement-blocked"      – { verdict, drawEssentials } (enforce mode)
 *   "placement-override"     – { verdict, drawEssentials } (enforce mode, Shift-click placed it anyway)
 *   "placement-snap"         – PlacementSnapResult (the S quick fix)
 *   "placement-audit"        – PlacementAudit (openAudit(): every symbol on the map re-judged)
 *   "placement-recheck"      – PlacementAudit (symbols re-judged after a move / edit)
 *   "placement-tiles"        – { loaded, pending, failed, missing }
 *
 * Integration: SymbolEngine feeds onDrawProgress, calls prepareFor() when a
 * draw is armed, checkCommit() before a graphic is added, deactivate() when the
 * draw ends, and onViewChanged() on a 2D↔3D switch.
 */

import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import { SYMBOL_LAYER_IDS } from '../../Managers/GraphicsLayerManager';
import EngineLogger from '../../Support/EngineLogger';
import { setSetting } from '../../Support/SettingsBus';
import { compileProfile, evaluateSamples, fmtDistance, setDistanceUnits, titleCase, type CompiledProfile } from './PlacementEvaluator';
import { PlacementAuditPanel, type AuditPanelHandlers } from './PlacementAuditPanel';
import { PlacementBadge, plainLabel } from './PlacementBadge';
import { PlacementBoundary } from './PlacementBoundary';
import { checkSpacing, echelonCodeOf, planFootprint, sideOf, type FootprintCandidate, type FootprintPlan } from './PlacementFootprint';
import { PlacementIndicators } from './PlacementIndicators';
import { PlacementLegend } from './PlacementLegend';
import { createOverlayLayer, OVERLAY_COLORS, OVERLAY_LEGEND, type OverlayRenderingSource } from './PlacementOverlay';
import { WorkerTileSource } from './WorkerTileSource';
import { resolveProfile } from './PlacementProfiles';
import { boundaryPaths, fromMercatorXY, nearEdges, samplePoints, toMercatorShape, type MercShape } from './PlacementSampling';
import {
  DEFAULT_PLACEMENT_OPTIONS,
  DIST_FAR,
  DIST_NODATA,
  NODATA_CLASS,
  layerNames,
  type MercXY,
  type PlacementAudit,
  type PlacementAuditEntry,
  type PlacementIndicator,
  type PlacementNearest,
  type PlacementOptionIssue,
  type PlacementOptions,
  type PlacementProfile,
  type PlacementSnapResult,
  type PlacementStamp,
  type PlacementStatus,
  type PlacementVerdict,
  type PlacementVerdictKind,
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
/** Snap search: rings of candidate spots out to this many tile pixels (inside the 2-tile ring _warmAround keeps loaded). */
const SNAP_MAX_PX = 160;
const SNAP_FIRST_PX = 2;
const SNAP_GROWTH = 1.25;
const SNAP_DIRECTIONS = 16;
/** Waits before the automatic retries of a bundle that failed for a reason that may pass (network, 5xx). */
const RETRY_DELAYS_MS = [4000, 15000, 45000];
/** After a ring with only a marginal spot (near / caution), keep looking this much further for a clean `ok`. */
const SNAP_PREFER_OK = 1.6;
/** How long the card waits on a missing tile before saying "loading", and how far (screen px) the cursor may move before the last verdict stops being a fair stand-in for the new spot. */
const LOADING_GRACE_MS = 200;
const STALE_MAX_PX = 80;
/** Audit: symbols judged per batch (their tiles must fit the cache), passes to wait out missing tiles, wait per pass, and the tile span a shape is judged over. */
const FIRST_USE_KEY = 'ms.placement.hintSeen';
/** The order modes are offered in (P, the Legend): on foot, wheels, tracks, then the rest; the v2 site and movement modes after. */
const PROFILE_ORDER: readonly PlacementProfile[] = [
  'dismounted', 'wheeled', 'tracked', 'generic', 'vessel',
  'gun', 'ad', 'hls', 'signals', 'amphibious', 'pack', 'oversnow', 'roadbound', 'rail',
];
/** How long the grouping of placed symbols (for the spacing check) is reused. */
const NEIGHBOUR_TTL_MS = 2000;
/** Points walked along a shape's edge to find which stretches lie in no-go ground. */
const STRETCH_MAX_POINTS = 1200;
const AUDIT_BATCH = 16;
const AUDIT_PASSES = 4;
const AUDIT_TILE_WAIT_MS = 8000;
const AUDIT_SPAN_PX = 96;

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
  private _loading = false;
  private _loadError: string | null = null;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _retryAttempt = 0;
  private _retryAt = 0;
  /** What the user was last told about the data ("loading", "failed|why", "ready"), so each is said once. */
  private _noticedKey = '';

  private _activeSidc: string | null = null;
  private _activeProfile: PlacementProfile | null = null;
  private _lastDetail: { geometry: any; sidc: string | null } | null = null;
  private _lastSnappable = false;
  /** The last real verdict of this draw and where the cursor was, to show while the next tile loads. */
  private _lastGood: PlacementVerdict | null = null;
  private _lastGoodGeom: any = null;
  /** Unit type chosen by hand for the draw in progress (P key); null = derived from the SIDC. Cleared when the draw ends. */
  private _profileOverride: PlacementProfile | null = null;
  private _loadingSince = 0;
  private _graceTimer: ReturnType<typeof setTimeout> | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _blurHandler: (() => void) | null = null;
  /** Shift is held (tracked from pointer and key events while a draw is armed): the click is a deliberate override. */
  private _shift = false;
  private _lastKey = '';
  private _lastBadgeKey = '';
  private _lastWarmKey = '';
  private _lastKind = '';
  private _lastSpacingMsg = '';
  private _reevalTimer: ReturnType<typeof setTimeout> | null = null;

  private _badge = new PlacementBadge();
  private _auditPanel = new PlacementAuditPanel();
  private _legend = new PlacementLegend({
    step: (dir) => this._legendStep(dir),
    pick: (key) => this._legendPick(key as PlacementProfile),
  });
  private _hintedThisSession = false;
  private _lastIssueKey = '';
  /** The last pointer move was a finger: the card goes above it and does not offer keyboard shortcuts. */
  private _touchInput = false;
  private _nbr: { at: number; map: Map<string, { pts: MercXY[]; gs: any[] }> } | null = null;
  private _tileWaiters: Array<() => void> = [];
  private _indicators = new PlacementIndicators(() => this._getView());
  private _boundary = new PlacementBoundary(() => this._getView());
  private _lastClient: { x: number; y: number } | null = null;
  private _container: HTMLElement | null = null;
  private _pointerHandler: ((e: PointerEvent) => void) | null = null;
  private _stationaryHandle: { remove(): void } | null = null;
  private _northHandle: { remove(): void } | null = null;

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

  /** Data state: why there is (not) advice, and whether a retry is on its way. */
  get status(): PlacementStatus {
    const state: PlacementStatus['state'] = !this._enabled
      ? 'disabled'
      : this._manifest
        ? 'ready'
        : this._loading
          ? 'loading'
          : !this._opts.bundleUrl
            ? 'no-bundle-url'
            : 'failed';
    return {
      state,
      error: state === 'failed' ? this._loadError : null,
      retryInMs: this._retryTimer !== null ? Math.max(0, this._retryAt - Date.now()) : null,
    };
  }

  /** Try loading the terrain bundle again now (e.g. after the server came back). Resolves true when it is ready. */
  retry(): Promise<boolean> {
    this._retryAttempt = 0;
    return this.configure();
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
    this._clearRetry();
    this._loadError = null;
    this._loading = base !== '';

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
      // A profile chosen for the overlay before the bundle was known may not exist in it.
      const problem = this._overlayProfileProblem(this._opts.overlay.profile);
      if (problem !== null) {
        EngineLogger.error(ENGINE, `Setting placement.overlay.profile = ${JSON.stringify(this._opts.overlay.profile)}: ${problem}; using auto`);
        this._opts.overlay.profile = 'auto';
      }
      const [w, s, e, n] = manifest.bounds;
      const [x0, y0] = lngLatToMercator(w, s);
      const [x1, y1] = lngLatToMercator(e, n);
      this._boundsMerc = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
      this._source = this._makeSource(base, manifest.tileSize, manifest);
      this._cache = new TerrainTileCache(this._source, this._opts.cacheTiles, () => this._onTilesChanged());
      EngineLogger.success(
        ENGINE,
        `Terrain bundle ready — ${manifest.name ?? base} (rules ${rules.version ?? 'unversioned'})`,
      );
      this._loading = false;
      this._retryAttempt = 0;
      // The user was told it was down or loading: say it is back, so they do not have to guess.
      if (this._enabled && this._noticedKey !== '' && this._noticedKey !== 'ready') {
        this._badge.toast({ verdict: 'ok', title: 'Placement advisor ready', lines: ['Terrain data loaded. Advice is on.'] }, 3500);
      }
      this._noticedKey = 'ready';
      this._emitState('ready');
      if (this._enabled) {
        this._firstUseHint();
        this._bindView();
      }
      this._prefetch();
      this._syncOverlay();
      return true;
    } catch (err) {
      if (token !== this._configToken) return false;
      const message = (err as Error).message;
      this._loading = false;
      this._loadError = message;
      const retryMs = this._scheduleRetry(err);
      EngineLogger.error(
        ENGINE,
        `Terrain bundle unavailable (${base}): ${message}${retryMs === null ? '' : ` — retrying in ${Math.round(retryMs / 1000)} s`}`,
      );
      this._emitState('no-bundle', message);
      return false;
    }
  }

  /** Queue the next automatic attempt for a failure that may pass by itself; null when it is a dead end. */
  private _scheduleRetry(err: unknown): number | null {
    if (!this._enabled || (err as { transient?: boolean })?.transient !== true) return null;
    if (this._retryAttempt >= RETRY_DELAYS_MS.length) return null;
    const delay = RETRY_DELAYS_MS[this._retryAttempt++];
    this._retryAt = Date.now() + delay;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      void this.configure();
    }, delay);
    return delay;
  }

  private _clearRetry(): void {
    if (this._retryTimer !== null) clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  /**
   * A draw was armed while there is no terrain data: say why there will be no advice, once per cause
   * (the Engine Log has it too, but nobody is looking there while drawing).
   */
  private _noticeUnavailable(): void {
    if (!this._enabled || this._opts.mode === 'off' || this._manifest) return;
    const s = this.status;
    const key = s.state === 'failed' ? `failed|${s.error}` : s.state;
    if (key === this._noticedKey) return;
    this._noticedKey = key;
    if (s.state === 'loading') {
      this._badge.toast({ verdict: 'unknown', title: 'Loading terrain data', lines: ['Advice starts as soon as it is ready.'] }, 3500);
      return;
    }
    const retrying = s.retryInMs !== null;
    this._badge.toast(
      {
        verdict: 'unknown',
        title: 'Placement advisor paused',
        lines: [
          'Terrain data is unavailable, so this symbol gets no advice.',
          s.state === 'no-bundle-url' ? 'No terrain bundle is configured.' : (s.error ?? 'The terrain bundle could not be loaded.'),
        ],
        hint:
          s.state === 'no-bundle-url'
            ? 'Set the bundle URL in the Placement settings.'
            : retrying
              ? `Retrying automatically in ${Math.max(1, Math.round((s.retryInMs ?? 0) / 1000))} s. Settings has a Retry button.`
              : 'Press Retry in the Placement settings, or call placementAdvisor.retry().',
      },
      7000,
    );
  }

  /**
   * Apply settings. Anything that is not a valid value for its setting is ignored (the previous value stays)
   * and reported, as is a number that had to be clamped; the list comes back and is written once to the
   * Engine Log, so a typo in a settings file does not fail silently.
   */
  setOptions(patch: Partial<PlacementOptions>): PlacementOptionIssue[] {
    const prev = this._opts;
    const next: PlacementOptions = { ...prev };
    const issues: PlacementOptionIssue[] = [];
    const bad = (path: string, value: unknown, reason: string) => issues.push({ path: `placement.${path}`, value, reason });
    const flag = (path: string, v: unknown, set: (b: boolean) => void) => {
      if (v === undefined) return;
      if (typeof v === 'boolean') set(v);
      else bad(path, v, 'must be true or false');
    };
    const pick = <T extends string>(path: string, v: unknown, allowed: readonly T[], set: (x: T) => void) => {
      if (v === undefined) return;
      if (allowed.includes(v as T)) set(v as T);
      else bad(path, v, `must be one of: ${allowed.join(', ')}`);
    };
    /** A finite number kept within [lo, hi]; reports when it had to be moved. */
    const num = (path: string, v: unknown, lo: number, hi: number, set: (n: number) => void, whole = false) => {
      if (v === undefined) return;
      if (typeof v !== 'number' || !Number.isFinite(v)) return void bad(path, v, 'must be a number');
      const n = Math.min(hi, Math.max(lo, whole ? Math.floor(v) : v));
      if (n !== v) bad(path, v, `out of range, using ${n}`);
      set(n);
    };

    pick('mode', patch.mode, ['off', 'advise', 'enforce'] as const, (x) => (next.mode = x));
    if (patch.bundleUrl !== undefined) {
      if (typeof patch.bundleUrl === 'string') next.bundleUrl = patch.bundleUrl.trim().replace(/\/+$/, '');
      else bad('bundleUrl', patch.bundleUrl, 'must be a URL string');
    }
    num('nearThresholdM', patch.nearThresholdM, 0, Number.MAX_SAFE_INTEGER, (n) => (next.nearThresholdM = n));
    num('partialFraction', patch.partialFraction, 0.01, 1, (n) => (next.partialFraction = n));
    if (patch.blockOn !== undefined) {
      const blockable: readonly PlacementVerdictKind[] = ['unknown', 'near', 'caution', 'partial', 'in'];
      if (!Array.isArray(patch.blockOn)) bad('blockOn', patch.blockOn, 'must be a list of verdicts');
      else {
        const unknown = patch.blockOn.filter((k) => !blockable.includes(k));
        if (unknown.length) bad('blockOn', unknown, `not verdicts that can be refused (${blockable.join(', ')})`);
        next.blockOn = patch.blockOn.filter((k) => blockable.includes(k));
      }
    }
    flag('showBadge', patch.showBadge, (b) => (next.showBadge = b));
    pick('units', patch.units, ['metric', 'imperial', 'nautical'] as const, (x) => (next.units = x));
    flag('snapKey', patch.snapKey, (b) => (next.snapKey = b));
    flag('profileKey', patch.profileKey, (b) => (next.profileKey = b));
    flag('allowOverride', patch.allowOverride, (b) => (next.allowOverride = b));
    flag('logVerdicts', patch.logVerdicts, (b) => (next.logVerdicts = b));
    num('cacheTiles', patch.cacheTiles, 16, Number.MAX_SAFE_INTEGER, (n) => (next.cacheTiles = n), true);
    num('prefetchMarginTiles', patch.prefetchMarginTiles, 0, Number.MAX_SAFE_INTEGER, (n) => (next.prefetchMarginTiles = n), true);
    num('maxSamples', patch.maxSamples, 8, Number.MAX_SAFE_INTEGER, (n) => (next.maxSamples = n), true);
    flag('useWorker', patch.useWorker, (b) => (next.useWorker = b));
    const ind = patch.indicators;
    next.indicators = { ...prev.indicators };
    if (ind && typeof ind === 'object') {
      flag('indicators.enabled', ind.enabled, (b) => (next.indicators.enabled = b));
      flag('indicators.labels', ind.labels, (b) => (next.indicators.labels = b));
    }
    const ov = patch.overlay;
    next.overlay = { ...prev.overlay };
    if (ov && typeof ov === 'object') {
      flag('overlay.enabled', ov.enabled, (b) => (next.overlay.enabled = b));
      if (ov.profile !== undefined) {
        const problem = this._overlayProfileProblem(ov.profile);
        if (problem === null) next.overlay.profile = ov.profile as PlacementOptions['overlay']['profile'];
        else bad('overlay.profile', ov.profile, problem);
      }
      num('overlay.opacity', ov.opacity, 0.05, 1, (n) => (next.overlay.opacity = n));
      flag('overlay.boundary', ov.boundary, (b) => (next.overlay.boundary = b));
    }
    const fp = patch.footprint;
    next.footprint = { ...prev.footprint };
    if (fp && typeof fp === 'object') {
      flag('footprint.enabled', fp.enabled, (b) => (next.footprint.enabled = b));
      pick('footprint.facing', fp.facing, ['fixed', 'worst4', 'circle'] as const, (x) => (next.footprint.facing = x));
      if (fp.bearingDeg !== undefined) {
        if (typeof fp.bearingDeg === 'number' && Number.isFinite(fp.bearingDeg)) next.footprint.bearingDeg = ((fp.bearingDeg % 360) + 360) % 360;
        else bad('footprint.bearingDeg', fp.bearingDeg, 'must be a number of degrees');
      }
      pick('footprint.size', fp.size, ['min', 'mid', 'max'] as const, (x) => (next.footprint.size = x));
      flag('footprint.outline', fp.outline, (b) => (next.footprint.outline = b));
      flag('footprint.spacing', fp.spacing, (b) => (next.footprint.spacing = b));
    }
    this._reportIssues(issues);
    this._opts = next;
    setDistanceUnits(next.units);

    if (next.cacheTiles !== prev.cacheTiles) this._cache?.setCapacity(next.cacheTiles);
    if (next.useWorker !== prev.useWorker) this._swapSource();
    this._syncOverlay(next.overlay.profile !== prev.overlay.profile || next.nearThresholdM !== prev.nearThresholdM);
    if (next.mode === 'off') this.deactivate();
    if (!next.showBadge) this._badge.hide();
    if (!next.indicators.enabled) this._indicators.hide();
    if (!next.footprint.outline || !next.footprint.enabled) this._indicators.hideFootprint();
    if (next.bundleUrl !== prev.bundleUrl && this._enabled) {
      this._retryAttempt = 0;
      void this.configure();
    }
    this._lastKey = ''; // thresholds changed — republish the next verdict
    this._lastBadgeKey = '';
    this._prefetch(); // mode switched on / overlay profile changed — make sure its layers are warm
    if (next.units !== prev.units) {
      // Every sentence on screen was written in the old units: drop the cached verdict and say it again.
      this._lastGood = null;
      this._lastGoodGeom = null;
      const d = this._lastDetail;
      if (d && this.isActive) this._apply(this._judgeLive(d.geometry, d.sidc));
    }
    return issues;
  }

  /** Why `profile` cannot be the overlay's profile, or null when it can (checked against the bundle once one is loaded). */
  private _overlayProfileProblem(profile: unknown): string | null {
    if (profile === 'auto') return null;
    if (typeof profile !== 'string' || profile === '' || profile === 'exempt') return 'must be auto or the name of a unit type (not exempt)';
    const known = this._manifest?.profiles;
    if (known && !known.includes(profile)) return `this bundle has no "${profile}" profile (it has: ${known.join(', ')})`;
    return null;
  }

  /** Write option problems to the Engine Log, once per distinct set (the whole settings block is re-sent on every change). */
  private _reportIssues(issues: PlacementOptionIssue[]): void {
    const key = issues.map((i) => `${i.path}=${JSON.stringify(i.value)}`).join('|');
    if (key === this._lastIssueKey) return;
    this._lastIssueKey = key;
    for (const i of issues) EngineLogger.error(ENGINE, `Setting ${i.path} = ${JSON.stringify(i.value)}: ${i.reason}`);
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._retryAttempt = 0;
    this._emitState('enabled');
    if (this._manifest) {
      this._firstUseHint();
      this._bindView();
    } else if (this._opts.bundleUrl) void this.configure();
    else this._emitState('no-bundle');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._clearRetry();
    this.deactivate();
    this._unbindView();
    this._removeOverlay();
    this._legend.hide();
    this._legend.hideHint();
    this._boundary.hide();
    this._emitState('disabled');
  }

  // ── Draw lifecycle ───────────────────────────────────────────────────────

  /** A draw was armed for this SIDC: resolve its profile and warm the tiles. */
  prepareFor(sidc: string | null | undefined): void {
    if (!this.isActive) {
      this._noticeUnavailable();
      return;
    }
    this._activeSidc = sidc ?? null;
    this._nbr = null; // the symbols already placed may have changed since the last draw
    this._profileOverride = null; // a hand-picked unit type lasts for one draw
    this._activeProfile = this._profileFor(this._activeSidc);
    if (this._activeProfile !== 'exempt') this._lastArmedProfile = this._activeProfile;
    // Say why there is no card, rather than leaving it looking broken; any other hint has done its job.
    if (this._activeProfile === 'exempt') {
      this._legend.hint('This symbol is not terrain-bound, so it gets no terrain advice.', 'exempt', 3500);
    } else {
      this._legend.hideHint();
    }
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
      this._activeProfile = this._profileFor(sidc);
    }
    this._lastDetail = { geometry, sidc };
    this._warmAround(geometry, this._profileFor(sidc));
    this._apply(this._judgeLive(geometry, sidc));
  }

  /** Verdict for the live cursor position, flagged when the snap key could improve it. */
  private _judgeLive(geometry: any, sidc: string | null): PlacementVerdict {
    const v = this.evaluateGeometry(geometry, sidc, { ref: () => this._pointerMerc() });
    // The cursor is on a tile that has not arrived: keep showing the verdict from a moment ago, marked
    // as updating, rather than blanking the card to "loading" on every pan.
    if (v.verdict === 'unknown' && v.waiting) return this._staleVerdict(geometry) ?? v;
    // S, P and Shift-click need a keyboard: with a finger on the screen the card does not offer them.
    const keys = !this._touchInput;
    v.snappable = keys && this._opts.snapKey && geometry?.type === 'point' && this._isBad(v);
    this._lastSnappable = v.snappable;
    v.blocked = this._refuses(v);
    v.overridable = keys && v.blocked && this._opts.allowOverride;
    v.profileKey = keys && this._opts.profileKey && this.profileChoices.length > 1 && v.verdict !== 'exempt';
    v.profileOverride = this._profileOverride !== null && v.profile === this._profileOverride;
    this._legend.setKeys(v.profileKey, v.snappable);
    if (v.verdict !== 'unknown' && v.verdict !== 'off' && v.verdict !== 'exempt') {
      this._lastGood = v;
      this._lastGoodGeom = geometry;
    }
    return v;
  }

  /**
   * The last real verdict flagged as updating; null when there is none, the cursor has moved on, or the tiles
   * are not coming. "Moved on" is measured between the two map positions on screen now (not from pointer
   * events, which reach us after the view has already reported the move).
   */
  private _staleVerdict(geometry: any): PlacementVerdict | null {
    const g = this._lastGood;
    if (!g || !this._lastGoodGeom || (this._cache?.stats().pending ?? 0) === 0) return null;
    const view: any = this._getView?.();
    const a = view?.toScreen?.(this._lastGoodGeom);
    const b = view?.toScreen?.(geometry);
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > STALE_MAX_PX) return null;
    return { ...g, loading: true };
  }

  /** Would `enforce` mode refuse a click with this verdict? */
  private _refuses(v: PlacementVerdict): boolean {
    return this._opts.mode === 'enforce' && this._opts.blockOn.includes(v.verdict);
  }

  /** A verdict the user cannot keep: in/partial, or anything `enforce` mode would refuse. */
  private _isBad(v: PlacementVerdict): boolean {
    return v.verdict === 'in' || v.verdict === 'partial' || this._refuses(v);
  }

  /** Draw ended or was cancelled — hide feedback and stop tracking the cursor. */
  deactivate(): void {
    this._badge.hide();
    this._indicators.hide();
    this._indicators.hideFootprint();
    this._legend.hideHint('exempt');
    this._detachPointer();
    this._lastDetail = null;
    this._lastSnappable = false;
    this._touchInput = false;
    this._nbr = null;
    this._profileOverride = null;
    this._lastGood = null;
    this._lastGoodGeom = null;
    this._loadingSince = 0;
    if (this._graceTimer !== null) {
      clearTimeout(this._graceTimer);
      this._graceTimer = null;
    }
    this._shift = false;
    this._lastBadgeKey = '';
    this._lastWarmKey = '';
    this._activeSidc = null;
    this._activeProfile = null;
    this._legend.setKeys(false, false);
    this._syncLegend(); // back to the overlay's mode, or hidden when the overlay is off
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
    const stamp = this._stampOf(verdict);
    if (stamp && this._profileOverride !== null && verdict.profile === this._profileOverride) stamp.profileOverride = true;
    const refused = this._refuses(verdict);
    // Shift held at the click places it anyway, and the stamp says so for whoever reviews the plan.
    const override = refused && this._opts.allowOverride && this._shift;
    const block = refused && !override;
    if (override) {
      if (stamp) stamp.overridden = true;
      EngineLogger.nextStep(ENGINE, `Placed anyway (Shift-click): ${verdict.message}`);
      this._emit('placement-override', { verdict, drawEssentials });
    }
    if (block) {
      this._emit('placement-blocked', { verdict, drawEssentials });
      this._badge.toast(
        {
          verdict: verdict.verdict,
          title: 'Not placed',
          lines: [verdict.message, verdict.reason ?? '', verdict.detail ?? ''].filter(Boolean),
          hint: this._opts.allowOverride
            ? this._touchInput
              ? 'Placing it anyway needs a keyboard (Shift-click).'
              : 'Hold Shift and click to place it anyway.'
            : 'Placement on this ground is blocked.',
        },
        5000,
      );
    }
    return { allow: !block, verdict, stamp };
  }

  /** What is stored on `graphic.attributes.placement`; null for verdicts that say nothing (off / exempt). */
  private _stampOf(verdict: PlacementVerdict): PlacementStamp | null {
    if (verdict.verdict === 'off' || verdict.verdict === 'exempt') return null;
    return {
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
  }

  /**
   * Record why a symbol was placed against the rules. Call after a `placement-override` placement with the
   * graphic the engine created; returns false when the graphic was not an override.
   */
  annotateOverride(graphic: any, reason: string): boolean {
    const p = graphic?.attributes?.placement;
    if (!p || p.overridden !== true) return false;
    const text = String(reason ?? '').trim().slice(0, 500);
    if (text) p.reason = text;
    else delete p.reason;
    return true;
  }

  // ── Symbols already on the map ───────────────────────────────────────────

  /** Point / line / area graphics in the symbol layers (not the sketch or declutter layers). */
  private _placedGraphics(): any[] {
    const map = (this._getView?.() as any)?.map;
    const out: any[] = [];
    if (!map) return out;
    for (const id of NEIGHBOUR_LAYER_IDS) {
      map.findLayerById?.(id)?.graphics?.forEach((g: any) => {
        const t = g?.geometry?.type;
        if (g?.attributes?.id && (t === 'point' || t === 'polyline' || t === 'polygon')) out.push(g);
      });
    }
    return out;
  }

  /**
   * Judge every symbol on the map against the terrain now, bring each stamp up to date (an Shift-click
   * override is kept while it is still needed) and return the ones that need attention, worst first.
   * Symbols anywhere on the map are checked, not only those in view: their tiles are loaded in small
   * batches first.
   */
  async auditPlacements(
    opts: { onProgress?: (done: number, total: number) => void; refreshStamps?: boolean } = {},
  ): Promise<PlacementAudit> {
    return this._auditGraphics(this._placedGraphics(), opts);
  }

  /** `auditPlacements()` with the results panel: progress while it runs, then the list (click a row to zoom to the symbol). */
  async openAudit(): Promise<PlacementAudit> {
    if (!this.isActive) {
      this._toastUnavailable('Placement check');
      return this._auditGraphics([]);
    }
    this._auditPanel.showProgress(0, this._placedGraphics().length);
    const audit = await this.auditPlacements({ onProgress: (d, t) => this._auditPanel.showProgress(d, t) });
    this._auditPanel.show(audit, this._panelHandlers(() => void this.openAudit()));
    this._emit('placement-audit', audit);
    return audit;
  }

  /** Judge one symbol and show why in the panel (context menu: "Placement check…"). */
  async explain(graphic: any): Promise<PlacementAuditEntry | null> {
    if (!this.isActive) {
      this._toastUnavailable('Placement check');
      return null;
    }
    const audit = await this._auditGraphics([graphic], { refreshStamps: true });
    const entry = audit.entries[0] ?? null;
    if (!entry) {
      const why = audit.exempt
        ? 'This symbol is not terrain-bound.'
        : audit.outside
          ? 'Outside terrain data coverage.'
          : 'Terrain data could not be loaded for this symbol.';
      this._badge.toast({ verdict: 'unknown', title: 'Placement check', lines: [why] }, 4000);
      return null;
    }
    this._auditPanel.show(audit, this._panelHandlers(() => void this.explain(graphic)), { title: 'Placement check', focus: entry });
    return entry;
  }

  /**
   * Judge symbols again after they were moved or edited, keep their stamps true, and tell the user when one
   * has ended up on ground it cannot use. Fire and forget; does nothing while the advisor is inactive.
   */
  recheck(graphics: any[]): void {
    const list = graphics.filter((g) => g?.geometry);
    if (!this.isActive || list.length === 0) return;
    void this._auditGraphics(list, { refreshStamps: true }).then((audit) => {
      const worse = audit.problems.filter((e) => e.previous !== e.verdict);
      for (const e of worse) EngineLogger.nextStep(ENGINE, `${e.name}: ${e.message}`);
      if (worse.length > 0) {
        this._badge.toast(
          {
            verdict: worse[0].verdict,
            title: worse.length === 1 ? 'Placement changed' : `${worse.length} placements changed`,
            lines: worse.slice(0, 3).map((e) => `${e.name}: ${e.message}`),
            hint: 'Right-click a symbol, Placement check, for details.',
          },
          5000,
        );
      }
      this._emit('placement-recheck', audit);
    });
  }

  private _panelHandlers(again: () => void): AuditPanelHandlers {
    return { onZoom: (e) => this._zoomTo(e.graphic), onRecheck: again };
  }

  /** Bring a symbol into view and flash it. */
  private _zoomTo(graphic: any): void {
    const view: any = this._getView?.();
    const geom = graphic?.geometry;
    if (!view || !geom) return;
    try {
      const target = geom.type === 'point' ? { target: geom, scale: Math.min(view.scale || 25000, 25000) } : { target: graphic };
      void Promise.resolve(view.goTo(target, { duration: 600 })).catch(() => {});
      const layer = graphic.layer;
      void Promise.resolve(view.whenLayerView?.(layer))
        .then((lv: any) => {
          const h = lv?.highlight?.(graphic);
          setTimeout(() => h?.remove?.(), 2500);
        })
        .catch(() => {});
    } catch {
      /* view not ready */
    }
  }

  private _toastUnavailable(title: string): void {
    const s = this.status;
    const why =
      s.state === 'disabled' ? 'The Placement advisor is off.'
      : this._opts.mode === 'off' ? 'The Placement advisor mode is Off.'
      : s.state === 'loading' ? 'Terrain data is still loading.'
      : s.state === 'no-bundle-url' ? 'No terrain bundle is configured.'
      : (s.error ?? 'Terrain data is unavailable.');
    this._badge.toast({ verdict: 'unknown', title, lines: [why] }, 4500);
  }

  /** Resolves when no tile is outstanding, or after `timeoutMs`. */
  private _tilesSettled(timeoutMs: number): Promise<void> {
    if ((this._cache?.stats().pending ?? 0) === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const i = this._tileWaiters.indexOf(done);
        if (i >= 0) this._tileWaiters.splice(i, 1);
        resolve();
      }, timeoutMs);
      this._tileWaiters.push(done);
    });
  }

  /** Tile zoom that keeps a shape (or the footprints it would be judged on) within about AUDIT_SPAN_PX pixels. */
  private _auditZoom(shape: MercShape, sidc: string | null): number {
    const m = this._manifest!;
    const plan = planFootprint(shape, sidc, this._rules, this._opts.footprint);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const take = (s: MercShape) => {
      for (const part of s.parts) {
        for (const p of part) {
          x0 = Math.min(x0, p[0]);
          x1 = Math.max(x1, p[0]);
          y0 = Math.min(y0, p[1]);
          y1 = Math.max(y1, p[1]);
        }
      }
    };
    if (plan) plan.candidates.forEach((c) => take(c.shape));
    else take(shape);
    const extent = Math.max(x1 - x0, y1 - y0);
    return extent > 0 ? zoomForResolution(extent / AUDIT_SPAN_PX, m.zoom.min, m.zoom.max, m.tileSize) : m.zoom.max;
  }

  private async _auditGraphics(
    graphics: any[],
    opts: { onProgress?: (done: number, total: number) => void; refreshStamps?: boolean } = {},
  ): Promise<PlacementAudit> {
    const audit: PlacementAudit = { checked: 0, exempt: 0, outside: 0, unchecked: 0, counts: {}, entries: [], problems: [] };
    if (!this.isActive) return audit;
    const token = this._configToken;
    this._nbr = null; // judge against the symbols as they are now

    const items: Array<{ g: any; sidc: string | null; zoom: number; profile: PlacementProfile }> = [];
    for (const g of graphics) {
      const sidc = graphicSidc(g);
      const shape = toMercatorShape(g?.geometry);
      // A unit type chosen by hand when the symbol was placed keeps being the one it is judged for.
      const stamped = g?.attributes?.placement as PlacementStamp | undefined;
      const profile =
        stamped?.profileOverride && this.profileChoices.includes(stamped.profile) ? stamped.profile : resolveProfile(sidc, this._rules);
      if (!shape || this._profile(profile).exempt) {
        audit.exempt++;
        continue;
      }
      items.push({ g, sidc, profile, zoom: this._auditZoom(shape, sidc) });
    }

    for (let i = 0; i < items.length; i += AUDIT_BATCH) {
      if (token !== this._configToken || !this.isActive) break;
      const batch = items.slice(i, i + AUDIT_BATCH);
      const verdicts = new Map<(typeof items)[number], PlacementVerdict>();
      // Judging a symbol queues the tiles it needs; wait for them and judge again until none is missing.
      let pending = batch;
      for (let pass = 0; pass < AUDIT_PASSES && pending.length > 0; pass++) {
        const missing: typeof batch = [];
        for (const it of pending) {
          const v = this.evaluateGeometry(it.g.geometry, it.sidc, { light: true, zoom: it.zoom, profile: it.profile });
          verdicts.set(it, v);
          if (v.waiting) missing.push(it);
        }
        if (missing.length === 0) break;
        await this._tilesSettled(AUDIT_TILE_WAIT_MS);
        pending = missing;
      }

      for (const it of batch) {
        let v = verdicts.get(it)!;
        if (v.waiting) {
          audit.unchecked++;
          continue;
        }
        if (v.verdict === 'unknown') {
          audit.outside++;
          continue;
        }
        const problem = v.verdict === 'in' || v.verdict === 'partial' || (v.verdict === 'near' && v.fraction > 0);
        // The cheap pass has no wording; spend the full one only on what will be listed.
        if (problem || this._opts.footprint.spacing) v = this.evaluateGeometry(it.g.geometry, it.sidc, { zoom: it.zoom, profile: it.profile, self: it.g });
        audit.entries.push(this._auditEntry(it.g, it.sidc, v, problem, opts.refreshStamps !== false));
        audit.checked++;
        audit.counts[v.verdict] = (audit.counts[v.verdict] ?? 0) + 1;
      }
      opts.onProgress?.(Math.min(items.length, i + batch.length), items.length);
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe between batches
    }

    audit.entries.sort((a, b) => b.severity - a.severity);
    audit.problems = audit.entries.filter((e) => e.problem);
    return audit;
  }

  private _auditEntry(g: any, sidc: string | null, v: PlacementVerdict, problem: boolean, refresh: boolean): PlacementAuditEntry {
    const old = g.attributes?.placement as PlacementStamp | undefined;
    if (refresh && g.attributes) {
      const stamp = this._stampOf(v);
      if (stamp) {
        // A Shift-click override stays on record for as long as the symbol is still somewhere it needs one.
        if (old?.overridden && this._isBad(v)) {
          stamp.overridden = true;
          if (old.reason) stamp.reason = old.reason;
        }
        if (old?.profileOverride && old.profile === v.profile) stamp.profileOverride = true;
        g.attributes.placement = stamp;
      }
    }
    const de = g.attributes?.drawEssentials;
    return {
      graphic: g,
      id: g.attributes?.id != null ? String(g.attributes.id) : null,
      name: de?.SYM_NAME || g.attributes?.name || g.attributes?.type || 'Symbol',
      sidc,
      profile: v.profile,
      profileLabel: v.profileLabel,
      verdict: v.verdict,
      message: v.message,
      detail: v.detail,
      rule: v.reason ?? null,
      profileOverride: old?.profileOverride === true && old.profile === v.profile,
      fraction: v.fraction,
      spacing: v.spacing && v.spacing.status !== 'ok' ? v.spacing.message : null,
      previous: old?.verdict ?? null,
      changed: old?.verdict !== undefined && old.verdict !== v.verdict,
      overridden: old?.overridden === true,
      reason: old?.reason ?? null,
      problem,
      severity: severity(v),
    };
  }

  /**
   * Quick fix for the point being drawn: place it at the nearest ground that passes, as if the
   * user had clicked there. Candidates are rings of spots around the cursor judged by the same
   * verdict function that gates a commit (footprint included), so what it picks is never one
   * the advisor would flag or `enforce` refuse. An `ok` spot wins over one that is merely
   * `near`/`caution`, if there is one just a little further out. Point symbols only.
   */
  snapToDeployable(): PlacementSnapResult {
    const none = (reason: NonNullable<PlacementSnapResult['reason']>, message: string, searchedM = 0): PlacementSnapResult =>
      this._announceSnap({ moved: false, at: null, distanceM: null, compass: null, verdict: null, searchedM, reason, message });
    const d = this._lastDetail;
    if (!this.isActive || !d) return none('no-draw', 'Nothing is being drawn');
    if (d.geometry?.type !== 'point') return none('not-point', 'Moving to usable ground works for point symbols only');
    const view: any = this._getView?.();
    const found = this._findSnap(d.geometry, d.sidc);
    if (!found.at) {
      return found.loading
        ? none('loading', 'Terrain data is still loading, try again in a moment')
        : none('no-ground', `No usable ground within ${fmtDistance(found.searchedM)}`, found.searchedM);
    }
    const target = this._withMerc(d.geometry, found.at);
    const px = target && this._settleOnScreen(view, target, d.sidc);
    if (!px) return none('no-ground', 'Cannot place the symbol there on this view');
    const compass = COMPASS[Math.round(found.bearingDeg / 45) % 8];
    const result: PlacementSnapResult = {
      moved: true,
      at: found.at,
      distanceM: found.distanceM,
      compass,
      verdict: found.verdict,
      searchedM: found.searchedM,
      message: `Moved ${fmtDistance(found.distanceM)} ${compass} to ${found.verdict === 'ok' ? 'usable ground' : 'the nearest usable ground'}`,
    };
    this._announceSnap(result);
    // The armed symbol's own click handler finishes the draw at this spot, so every point
    // symbol type, the commit check and the stamp go through their normal path.
    this._clickAt(view, px.x, px.y);
    return result;
  }

  /** 0 = clean spot, 1 = usable but marginal (near / caution, not touching), -1 = not usable. */
  private _snapRank(v: PlacementVerdict): number {
    if (v.verdict === 'unknown' || v.loading) return -1;
    if (v.verdict === 'ok') return 0;
    return (v.verdict === 'near' || v.verdict === 'caution') && v.fraction === 0 && !this._isBad(v) ? 1 : -1;
  }

  /**
   * Whole screen pixel to click for a Web Mercator target. A click lands on an integer pixel, which can
   * be many metres from the target when zoomed out, so the verdict is re-checked where the click will
   * really land and the neighbouring pixels are tried when it no longer passes.
   */
  private _settleOnScreen(view: any, target: any, sidc: string | null): { x: number; y: number } | null {
    const sp = view?.toScreen?.(target);
    if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) return null;
    const bx = Math.round(sp.x);
    const by = Math.round(sp.y);
    const around: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around.push([dx, dy]);
    around.sort((a, b) => Math.hypot(bx + a[0] - sp.x, by + a[1] - sp.y) - Math.hypot(bx + b[0] - sp.x, by + b[1] - sp.y));
    for (const [dx, dy] of around) {
      let mp: any = null;
      try {
        mp = view.toMap({ x: bx + dx, y: by + dy });
      } catch {
        /* off the globe */
      }
      if (mp && this._snapRank(this.evaluateGeometry(mp, sidc, { light: true })) >= 0) return { x: bx + dx, y: by + dy };
    }
    return null;
  }

  /** Move the pointer to a view pixel and click it, with real pointer events (the view's own `emit` does not reach `view.on` listeners). */
  private _clickAt(view: any, x: number, y: number): void {
    const container = view?.container as HTMLElement | undefined;
    if (!container) return;
    const surface = (container.querySelector('.esri-view-surface') as HTMLElement | null) ?? container;
    const r = container.getBoundingClientRect();
    const make = (type: string, down: boolean) =>
      new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: down ? 0 : -1, buttons: down ? 1 : 0, clientX: r.left + x, clientY: r.top + y, view: window,
      });
    surface.dispatchEvent(make('pointermove', false));
    surface.dispatchEvent(make('pointerdown', true));
    surface.dispatchEvent(make('pointerup', true));
  }

  /** Search outward in rings; see {@link snapToDeployable}. */
  private _findSnap(
    geometry: any,
    sidc: string | null,
  ):
    | { at: MercXY; distanceM: number; bearingDeg: number; verdict: PlacementVerdict['verdict']; searchedM: number }
    | { at: null; searchedM: number; loading: boolean } {
    const profile = this._profileFor(sidc);
    const origin = toMercatorShape(geometry)?.parts[0]?.[0];
    if (!origin || profile === 'exempt') return { at: null, searchedM: 0, loading: false };
    const res = resolutionAt(this._sampleZoom(), this._manifest!.tileSize);
    const lat = 2 * Math.atan(Math.exp(origin[1] / 6378137)) - Math.PI / 2;
    const groundK = Math.cos(lat); // true metres per Web Mercator metre here
    const searchedM = SNAP_MAX_PX * res * groundK;

    let best: { rank: number; at: MercXY; dx: number; dy: number; verdict: PlacementVerdict['verdict'] } | null = null;
    let loading = false;
    let limit = SNAP_MAX_PX;
    for (let px = SNAP_FIRST_PX; px <= limit; px *= SNAP_GROWTH) {
      const r = px * res;
      for (let k = 0; k < SNAP_DIRECTIONS; k++) {
        const a = (k / SNAP_DIRECTIONS) * 2 * Math.PI;
        const dx = Math.sin(a) * r;
        const dy = Math.cos(a) * r;
        const at: MercXY = [origin[0] + dx, origin[1] + dy];
        const g = this._withMerc(geometry, at);
        if (!g) continue;
        const v = this.evaluateGeometry(g, sidc, { light: true });
        if (v.verdict === 'unknown' || v.loading) loading = true;
        const rank = this._snapRank(v);
        if (rank >= 0 && (!best || rank < best.rank)) best = { rank, at, dx, dy, verdict: v.verdict };
      }
      if (best) {
        if (best.rank === 0) break;
        limit = Math.min(limit, px * SNAP_PREFER_OK); // marginal spot found: only look a bit further for a clean one
      }
    }
    if (!best) return { at: null, searchedM, loading };
    return {
      at: best.at,
      distanceM: Math.hypot(best.dx, best.dy) * groundK,
      bearingDeg: ((Math.atan2(best.dx, best.dy) * 180) / Math.PI + 360) % 360,
      verdict: best.verdict,
      searchedM,
    };
  }

  /** A copy of the point geometry moved to a Web Mercator position (same spatial reference and z). */
  private _withMerc(geometry: any, xy: MercXY): any | null {
    const c = fromMercatorXY(geometry, xy);
    if (!c || typeof geometry.clone !== 'function') return null;
    const g = geometry.clone();
    g.x = c[0];
    g.y = c[1];
    return g;
  }

  private _announceSnap(r: PlacementSnapResult): PlacementSnapResult {
    this._emit('placement-snap', r);
    if (r.moved) EngineLogger.success(ENGINE, r.message);
    else {
      EngineLogger.nextStep(ENGINE, r.message);
      this._badge.flash(r.message);
    }
    return r;
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
    this._clearRetry();
    this._cache?.clear();
    this._cache = null;
    this._source?.dispose?.();
    this._source = null;
    this._badge.destroy();
    this._auditPanel.destroy();
    this._legend.destroy();
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  resolveProfile(sidc: string | null | undefined): PlacementProfile {
    return resolveProfile(sidc, this._rules);
  }

  /** The profile a draw is judged for: the hand-picked one, else the one derived from the SIDC (never for a symbol that is not terrain-bound). */
  private _profileFor(sidc: string | null | undefined): PlacementProfile {
    const base = resolveProfile(sidc ?? this._activeSidc, this._rules);
    return this._profileOverride !== null && base !== 'exempt' ? this._profileOverride : base;
  }

  /**
   * Unit types P and the Legend step through: those the bundle has distance layers for, foot to heavy
   * then the rest (the manifest lists them alphabetically), any others the bundle adds after them.
   */
  get profileChoices(): PlacementProfile[] {
    const rank = (p: string) => {
      const i = PROFILE_ORDER.indexOf(p as PlacementProfile);
      return i < 0 ? PROFILE_ORDER.length : i;
    };
    return ((this._manifest?.profiles ?? []) as PlacementProfile[]).filter((p) => p !== 'exempt').sort((a, b) => rank(a) - rank(b));
  }

  /** The unit type chosen by hand for the draw in progress, or null when it is derived from the SIDC. */
  get profileOverride(): PlacementProfile | null {
    return this._profileOverride;
  }

  /**
   * Judge the draw in progress for a different unit type (null = back to what the SIDC says), for that one
   * symbol: the SIDC does not always say how a unit moves (a mounted vs dismounted infantry platoon).
   * The stamp records it as chosen by hand and the audit keeps judging the symbol that way. Returns false
   * when nothing is being drawn, the symbol is not terrain-bound, or the bundle has no such profile.
   */
  setProfileOverride(profile: PlacementProfile | null): boolean {
    if (!this.isActive || this._activeSidc === null) return false;
    if (resolveProfile(this._activeSidc, this._rules) === 'exempt') return false;
    if (profile !== null && !this.profileChoices.includes(profile)) return false;
    if (profile === this._profileOverride) return true;
    this._profileOverride = profile;
    this._activeProfile = this._profileFor(this._activeSidc);
    if (this._activeProfile !== 'exempt') this._lastArmedProfile = this._activeProfile;
    // Everything cached about the old profile (last verdict, key, tiles of its distance layer) is stale.
    this._lastGood = null;
    this._lastGoodGeom = null;
    this._lastKey = '';
    this._lastBadgeKey = '';
    this._lastWarmKey = '';
    this._prefetch();
    this._syncOverlay();
    const label = this._rules?.profiles?.[this._activeProfile]?.label ?? this._activeProfile;
    EngineLogger.nextStep(ENGINE, profile === null ? `Judging by the symbol again: ${label}` : `Judging this symbol as: ${label}`);
    this._emit('placement-profile', { profile: this._activeProfile, overridden: profile !== null });
    const d = this._lastDetail;
    if (d) this._apply(this._judgeLive(d.geometry, d.sidc));
    return true;
  }

  /**
   * Step the draw in progress to the next (or previous) unit type, in the legend's order; reaching the
   * SIDC's own type goes back to "auto". Returns the override now in force (null = from the SIDC).
   */
  cycleProfile(dir: 1 | -1 = 1): PlacementProfile | null {
    const choices = this.profileChoices;
    if (!choices.length) return this._profileOverride;
    const fromSidc = resolveProfile(this._activeSidc, this._rules);
    const i = choices.indexOf(this._profileOverride ?? fromSidc);
    const next = choices[(i + dir + choices.length) % choices.length];
    const override = next === fromSidc ? null : next;
    return this.setProfileOverride(override) ? override : this._profileOverride;
  }

  /** Synchronous verdict for a geometry from the tiles currently in memory. */
  evaluateGeometry(
    geometry: any,
    sidc?: string | null,
    opts?: {
      ref?: () => MercXY | null;
      /** Verdict only: skips the nearest-terrain scan, indicator lines and the intergap check. */
      light?: boolean;
      /** Judge at this tile zoom instead of the one matching the view (audits of symbols anywhere on the map). */
      zoom?: number;
      /** Judge for this profile, ignoring the SIDC and any override of the draw in progress (audits). */
      profile?: PlacementProfile;
      /** The placed symbol being judged, so the spacing check does not count it as its own neighbour. */
      self?: any;
    },
  ): PlacementVerdict {
    const profile = opts?.profile ?? this._profileFor(sidc);
    if (!this.isActive) return this._blank('off', profile, 'Placement advisor off');
    const compiled = this._profile(profile);
    if (compiled.exempt) return this._blank('exempt', profile, 'Not Terrain-Bound');

    const shape = toMercatorShape(geometry);
    if (!shape) return this._blank('unknown', profile, 'Cannot check this geometry');

    const ctx = this._readContext(profile, opts?.zoom);
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

    let best: {
      v: PlacementVerdict;
      samples: TerrainSample[];
      pts: MercXY[];
      cand: FootprintCandidate | null;
      shape: MercShape;
    } | null = null;
    for (const c of candidates) {
      // One sample per tile pixel along edges, so a 1–2 px wide feature (a stream) is not stepped over.
      const cpts = samplePoints(c.shape, resolutionAt(ctx.z, ctx.ts), this._opts.maxSamples);
      const csamples: TerrainSample[] = new Array(cpts.length);
      for (let i = 0; i < cpts.length; i++) csamples[i] = this._read(ctx, cpts[i][0], cpts[i][1]);
      const cv = evaluateSamples(csamples, compiled, evalOpts, this._rules);
      if (!best || severity(cv) > severity(best.v)) best = { v: cv, samples: csamples, pts: cpts, cand: c.cand, shape: c.shape };
    }
    const { v, samples, pts, cand, shape: judged } = best!;
    const stats = this._cache?.stats();
    if (v.verdict === 'unknown') {
      // Judge by the tiles this shape needed, not the cache-wide counts: a prefetch burst keeps
      // `pending` high long after the cursor's own tile arrived (or when it is outside coverage).
      v.message = !ctx.waiting
        ? this._coverageMessage(shape.parts[0]?.[0])
        : (stats?.pending ?? 0) > 0
          ? 'Terrain data loading…'
          : 'Terrain data could not be loaded';
      v.waiting = ctx.waiting;
    } else {
      if (!opts?.light) {
        this._enrich(v, samples, pts, ctx, compiled);
        this._addIndicators(v, samples, pts, compiled, opts?.ref, judged, ctx);
      }
      // A shape spanning tiles that are still arriving is judged on what is known so far.
      if (v.unknown > 0 && ctx.waiting && (stats?.pending ?? 0) > 0) {
        v.detail = v.detail ? `${v.detail} · still loading terrain data` : 'Still loading terrain data';
        v.loading = true;
      }
    }
    if (plan && cand) this._applyFootprint(v, plan, cand, effSidc, !opts?.light, opts?.self);
    v.reason = this._reasonFor(v);
    return v;
  }

  /**
   * The rule owner's own words for why this ground decides the verdict: the profile's `why` for the class,
   * else the class's `note` (rules.json). Next to no-go (nothing touching), it is the nearest no-go that
   * counts. Null when the bundle carries no text; the advisor never makes any up.
   */
  private _reasonFor(v: PlacementVerdict): string | null {
    const rules = this._rules;
    if (!rules || v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt') return null;
    const code = v.verdict === 'near' && v.fraction === 0 ? (v.nearest?.kind === 'no-go' ? v.nearest.classCode : null) : v.classCode;
    if (code === null || code === undefined) return null;
    const text = rules.profiles?.[v.profile]?.why?.[String(code)] ?? rules.classes?.[String(code)]?.note;
    return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
  }

  /** Record the footprint the verdict was judged on, say so in the detail line, and run the intergap check. */
  private _applyFootprint(
    v: PlacementVerdict,
    plan: FootprintPlan,
    cand: FootprintCandidate,
    sidc: string | null,
    withSpacing: boolean,
    self?: any,
  ): void {
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
    if (withSpacing && this._opts.footprint.spacing) v.spacing = checkSpacing(plan, this._neighbours(d.code, sidc, self));
  }

  /**
   * Web Mercator positions of same-echelon, same-side point symbols already on the map, other than `exclude`
   * (a symbol being checked for spacing is on the map itself and is not its own neighbour).
   */
  private _neighbours(code: string, sidc: string | null, exclude?: any): MercXY[] {
    const entry = this._neighbourIndex().get(`${code}|${sideOf(sidc)}`);
    if (!entry) return [];
    if (!exclude) return entry.pts;
    return entry.pts.filter((_, i) => entry.gs[i] !== exclude);
  }

  /**
   * Every placed point symbol that has an echelon, grouped by echelon and side. The check runs on every mouse move
   * while an echelon symbol is drawn, and walking every graphic on the map each time cost more the more symbols
   * there were; during a draw the others do not move, so the grouping is built once and reused for a couple of
   * seconds (and dropped when a draw starts or ends, or an audit begins).
   */
  private _neighbourIndex(): Map<string, { pts: MercXY[]; gs: any[] }> {
    const now = Date.now();
    if (this._nbr && now - this._nbr.at < NEIGHBOUR_TTL_MS) return this._nbr.map;
    const map = new Map<string, { pts: MercXY[]; gs: any[] }>();
    const view = (this._getView?.() as any)?.map;
    for (const id of NEIGHBOUR_LAYER_IDS) {
      view?.findLayerById?.(id)?.graphics?.forEach((g: any) => {
        const geom = g?.geometry;
        if (geom?.type !== 'point') return;
        const gs = graphicSidc(g);
        if (!gs || gs.length !== 20) return;
        const code = gs.substring(8, 10);
        if (echelonCodeOf(gs) !== code) return;
        const m = toMercatorShape(geom)?.parts[0]?.[0];
        if (!m) return;
        const key = `${code}|${sideOf(gs)}`;
        let e = map.get(key);
        if (!e) map.set(key, (e = { pts: [], gs: [] }));
        e.pts.push(m);
        e.gs.push(g);
      });
    }
    this._nbr = { at: now, map };
    return map;
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
        v.detail = `Nearest suitable ground: ${nearest.className}, ${fmtDistance(nearest.distanceM)} to the ${nearest.compass}`;
      } else if (rangeM > 0) {
        v.detail = `No suitable ground within ${fmtDistance(rangeM)}`;
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
          ? `At Edge of ${titleCase(nearest.className)}`
          : `${titleCase(nearest.className)} ${fmtDistance(dist)} to the ${nearest.compass}`;
      v.detail = `NO-GO for ${label}`;
    } else if (v.verdict === 'caution') {
      v.detail = `SLOW-GO terrain for ${label}. Nearest NO-GO: ${where}`;
    } else {
      v.detail = `Nearest NO-GO: ${where}`;
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
        // No-go wanted: only what the distance layer measures to, so the class and the distance agree.
        if (wantNoGo ? cp.target[c] === 1 : cp.nogo[c] === 0) {
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
    ref: (() => MercXY | null) | undefined,
    judged: MercShape,
    ctx: ReadContext,
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
            : `${titleCase(n.className)} ${fmtDistance(n.distanceM)} to the ${n.compass}`,
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
    // Colour the edge where it runs through no-go ground; the X marks are left for ground inside an area
    // (no edge to colour there) and for single samples too short to make a stretch.
    const { stretches, isolated } = this._badStretches(judged, ctx, cp);
    const res = resolutionAt(ctx.z, ctx.ts);
    const closed = judged.kind === 'area';
    const loose =
      stretches.length === 0 && isolated.length === 0
        ? bad
        : [...(closed ? bad.filter((p) => !nearEdges(p[0], p[1], judged.parts, true, res * 0.75)) : []), ...isolated];
    const stride = Math.max(1, Math.ceil(loose.length / 16));
    const ind: PlacementIndicator = {
      kind: 'contested',
      from,
      to,
      marks: loose.filter((_, i) => i % stride === 0),
      stretches,
      classCode: v.classCode,
      className: v.className,
      label: `${v.className ?? 'NO-GO'} (${Math.max(1, Math.round(v.fraction * 100))}% of the shape)`,
    };
    v.indicators.push(ind);
  }

  /**
   * Walk the edge of a line / area (or footprint outline) one tile pixel at a time and return the runs that lie in
   * no-go ground, each run ending half a step into the good ground beside it. A run of one sample is too short to
   * draw as a line and comes back in `isolated` to be marked instead.
   */
  private _badStretches(shape: MercShape, ctx: ReadContext, cp: CompiledProfile): { stretches: MercXY[][]; isolated: MercXY[] } {
    const stretches: MercXY[][] = [];
    const isolated: MercXY[] = [];
    const mid = (a: MercXY, b: MercXY): MercXY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const flush = (run: MercXY[]) => (run.length >= 2 ? stretches.push(run) : isolated.push(run[0]));
    for (const path of boundaryPaths(shape, resolutionAt(ctx.z, ctx.ts), STRETCH_MAX_POINTS)) {
      let run: MercXY[] | null = null;
      let prev: MercXY | null = null;
      for (const p of path) {
        const c = this._read(ctx, p[0], p[1]).classCode;
        if (c !== null && c !== NODATA_CLASS && cp.nogo[c]) {
          if (!run) run = prev ? [mid(prev, p)] : [];
          run.push(p);
        } else if (run) {
          run.push(mid(run[run.length - 1], p));
          flush(run);
          run = null;
        }
        prev = p;
      }
      if (run) flush(run);
    }
    return { stretches, isolated };
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

  /** "Outside terrain data coverage", plus how far the nearest covered ground is and which way, when outside the bundle's bounds. */
  private _coverageMessage(p: MercXY | undefined): string {
    const base = 'Outside terrain data coverage';
    if (!p) return base;
    const b = this._boundsMerc;
    const vx = Math.min(b[2], Math.max(b[0], p[0])) - p[0];
    const vy = Math.min(b[3], Math.max(b[1], p[1])) - p[1];
    const d = Math.hypot(vx, vy);
    if (d < 1) return base; // inside the bounds: a gap in the data (e.g. outside the boundary), nothing to point at
    const lat = 2 * Math.atan(Math.exp(p[1] / 6378137)) - Math.PI / 2;
    const bearing = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
    return `${base}, nearest data ${fmtDistance(d * Math.cos(lat))} ${COMPASS[Math.round(bearing / 45) % 8]}`;
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
  private _readContext(profile: PlacementProfile, zoom?: number): ReadContext {
    const m = this._manifest!;
    const { cls, dist } = this._layerNames(profile);
    return {
      z: zoom ?? this._sampleZoom(),
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
    // Nothing earlier to show while the tile loads: give it a moment before the card says "loading",
    // so a tile that arrives within the blink never flashes it.
    if (v.verdict === 'unknown' && v.waiting) {
      const now = Date.now();
      if (this._loadingSince === 0) this._loadingSince = now;
      const left = LOADING_GRACE_MS - (now - this._loadingSince);
      if (left > 0) {
        if (this._graceTimer === null) {
          this._graceTimer = setTimeout(() => {
            this._graceTimer = null;
            const d = this._lastDetail;
            if (d && this.isActive) this._apply(this._judgeLive(d.geometry, d.sidc));
          }, left + 5);
        }
        return;
      }
    } else {
      this._loadingSince = 0;
    }
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
      v.spacing?.status ?? '', Math.round(v.spacing?.nearestGapM ?? -1), v.snappable ? 1 : 0,
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
    if (this._tileWaiters.length > 0 && (this._cache?.stats().pending ?? 0) === 0) {
      for (const wake of this._tileWaiters.splice(0)) wake();
    }
    // A tile the cursor was waiting on may have arrived — refresh the verdict.
    if (!this._lastDetail || this._reevalTimer !== null) return;
    this._reevalTimer = setTimeout(() => {
      this._reevalTimer = null;
      const d = this._lastDetail;
      if (d && this.isActive) this._apply(this._judgeLive(d.geometry, d.sidc));
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
    // Where north points on screen: the 2D rotation, or the opposite of the 3D camera heading. The badge dial follows it.
    this._northHandle = reactiveUtils.watch(
      () => (view.type === '3d' ? -(view.camera?.heading ?? 0) : (view.rotation ?? 0)),
      (north: number) => this._badge.setNorth(north),
      { initial: true },
    );
  }

  private _unbindView(): void {
    this._stationaryHandle?.remove();
    this._stationaryHandle = null;
    this._northHandle?.remove();
    this._northHandle = null;
  }

  private _attachPointer(): void {
    if (this._pointerHandler) return;
    if (!this._keyHandler) {
      this._keyHandler = (e: KeyboardEvent) => this._onKey(e);
      this._blurHandler = () => (this._shift = false); // keyup lands elsewhere on Alt-Tab
      window.addEventListener('keydown', this._keyHandler, true);
      window.addEventListener('keyup', this._keyHandler, true);
      window.addEventListener('blur', this._blurHandler);
    }
    const container = (this._getView?.() as any)?.container as HTMLElement | null | undefined;
    if (!container) return;
    this._pointerHandler = (e: PointerEvent) => {
      this._lastClient = { x: e.clientX, y: e.clientY };
      this._shift = e.shiftKey;
      const touch = e.pointerType === 'touch';
      if (touch !== this._touchInput) {
        this._touchInput = touch;
        this._syncLegend(); // the keys need a keyboard: the legend explains them only for mouse and pen
      }
      this._badge.moveTo(e.clientX, e.clientY, this._touchInput);
    };
    container.addEventListener('pointermove', this._pointerHandler, { passive: true });
    this._container = container;
  }

  /** S while drawing a point on bad ground: take the quick fix. Ignored when typing, with modifiers, or when there is nothing to fix. */
  private _onKey(e: KeyboardEvent): void {
    this._shift = e.shiftKey;
    if (e.type !== 'keydown') return;
    const k = e.key.toLowerCase();
    if ((k !== 's' && k !== 'p') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (k === 'p') {
      if (!this._opts.profileKey || !this._lastDetail || this._activeProfile === 'exempt') return;
      e.preventDefault();
      this.cycleProfile();
      return;
    }
    if (!this._opts.snapKey || !this._lastSnappable || !this._lastDetail) return;
    e.preventDefault();
    this.snapToDeployable();
  }

  private _detachPointer(): void {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler, true);
      window.removeEventListener('keyup', this._keyHandler, true);
      this._keyHandler = null;
    }
    if (this._blurHandler) {
      window.removeEventListener('blur', this._blurHandler);
      this._blurHandler = null;
    }
    if (this._container && this._pointerHandler) {
      this._container.removeEventListener('pointermove', this._pointerHandler);
    }
    this._container = null;
    this._pointerHandler = null;
    this._lastClient = null;
  }

  // ── Tile source ──────────────────────────────────────────────────────────

  /** Worker-backed source when enabled and supported, else the main-thread one. */
  private _makeSource(base: string, tileSize: number, manifest: TerrainManifest): OverlayRenderingSource {
    // The bundle's own stamp goes into every tile URL, so tiles cached for a different bundle at this address are not reused.
    const version = manifest.built ?? manifest.pipelineVersion ?? manifest.rulesVersion ?? '';
    return this._opts.useWorker && typeof Worker !== 'undefined'
      ? new WorkerTileSource(base, tileSize, version)
      : new HttpPngTileSource(base, tileSize, version);
  }

  /** Switch worker ↔ main thread at runtime without reloading the bundle. */
  private _swapSource(): void {
    if (!this._manifest || !this._opts.bundleUrl || !this._cache) return;
    const old = this._source;
    this._source = this._makeSource(this._opts.bundleUrl, this._manifest.tileSize, this._manifest);
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

  /** Add / update / remove the overlay layer (and its key and the boundary outline) to match the options. Safe to call at any time. */
  private _syncOverlay(refresh = false): void {
    this._syncBoundary();
    const want = this._enabled && this._manifest !== null && this._rules !== null && this._opts.overlay.enabled;
    if (!want) {
      this._removeOverlay();
      this._syncLegend();
      return;
    }
    const view: any = this._getView?.();
    const map = view?.map;
    if (!map || !this._source) {
      this._syncLegend();
      return;
    }
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
    this._syncLegend();
  }

  /** A terrain-bound symbol is armed for drawing, so the legend's mode is that draw's own. */
  private _drawingTerrainBound(): boolean {
    return this._activeSidc !== null && this._activeProfile !== null && this._activeProfile !== 'exempt';
  }

  /** The mode the legend names: the draw's own while drawing, otherwise the one the overlay paints. */
  private _legendProfile(): PlacementProfile {
    return this._drawingTerrainBound() ? this._activeProfile! : this._overlayProfileNow();
  }

  /**
   * The Legend, shown while the overlay is on or a terrain-bound symbol is being drawn: which mode the ground is
   * judged for (and how it was chosen), the overlay's colours, what counts as NO-GO and SLOW-GO for that mode
   * (from the bundle's own rules) and the P / S keys. Rebuilt on mode and option changes, not per cursor move.
   */
  private _syncLegend(): void {
    const view: any = this._getView?.();
    const drawing = this._drawingTerrainBound();
    const rules = this._rules;
    if (!this._enabled || !rules || !this._manifest || !view || !(this._overlay || drawing)) {
      this._legend.hide();
      return;
    }
    const profile = this._legendProfile();
    const rule = rules.profiles?.[profile];
    const classes = (codes: readonly number[] | undefined): string[] =>
      (codes ?? []).map((c) => titleCase(plainLabel(rules.classes?.[String(c)]?.label ?? String(c))));
    const label = (e: (typeof OVERLAY_LEGEND)[number]['key']) => OVERLAY_LEGEND.find((x) => x.key === e)?.label ?? e;
    const fixed = this._opts.overlay.profile !== 'auto';
    const hand = drawing ? this._profileOverride !== null : fixed;
    let tag = '';
    if (drawing) tag = hand ? 'Set by Hand' : 'Auto · From Symbol';
    else if (fixed) tag = 'Set in Settings';
    const keyboard = !this._touchInput && (this._opts.profileKey || this._opts.snapKey);
    this._legend.show(view, {
      modes: this.profileChoices.map((p) => ({ key: p, label: rules.profiles?.[p]?.label ?? p })),
      current: profile,
      tag,
      hand,
      entries: OVERLAY_LEGEND.map((e) => ({ label: e.label, rgba: OVERLAY_COLORS[e.key] })),
      note: `${label('near')}: Within ${fmtDistance(this._opts.nearThresholdM)} of ${label('nogo')}`,
      // A vessel needs water: everything off it is NO-GO, so say that rather than list every land class.
      nogo: rule?.requires?.length ? [`Anywhere Off ${classes(rule.requires).join(' / ')}`] : classes(rule?.nogo),
      slow: classes(rule?.caution),
      keys: keyboard ? { profile: this._opts.profileKey, snap: this._opts.snapKey } : null,
    });
  }

  /** Legend Previous / Next: the draw's mode while drawing (as P does), otherwise the mode the overlay paints. */
  private _legendStep(dir: 1 | -1): void {
    if (this._drawingTerrainBound()) {
      this.cycleProfile(dir);
      return;
    }
    const choices = this.profileChoices;
    if (!choices.length) return;
    const i = choices.indexOf(this._legendProfile());
    this._legendPick(choices[(i + dir + choices.length) % choices.length]);
  }

  /** A mode's icon in the legend was clicked. */
  private _legendPick(profile: PlacementProfile): void {
    if (this._drawingTerrainBound()) {
      this.setProfileOverride(profile === resolveProfile(this._activeSidc, this._rules) ? null : profile);
      return;
    }
    if (this._opts.overlay.profile === 'auto') {
      // With nothing drawn, "auto" paints the last symbol's mode: change that; the next draw takes over again.
      if (profile === this._lastArmedProfile) return;
      this._lastArmedProfile = profile;
      this._syncOverlay();
      return;
    }
    // A mode fixed in the settings: change the setting, and tell the settings panel so it stays in step.
    this.setOptions({ overlay: { ...this._opts.overlay, profile } });
    setSetting(['placement', 'overlay', 'profile'], profile);
  }

  /** Once per browser: tell whoever just got the advisor what it does, since nothing shows until a symbol is picked. */
  private _firstUseHint(): void {
    if (this._hintedThisSession || this._opts.mode === 'off' || this._activeSidc !== null) return;
    this._hintedThisSession = true;
    try {
      if (localStorage.getItem(FIRST_USE_KEY)) return;
      localStorage.setItem(FIRST_USE_KEY, '1');
    } catch {
      /* storage blocked: the session flag still keeps it to once per page */
    }
    this._legend.hint('Placement advisor is on: pick a symbol and terrain advice follows your cursor.', 'first-use', 7000);
  }

  /** Take the overlay off the map. The legend may stay for a draw in progress; `_syncLegend` decides. */
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
    // Network errors and 5xx/408/429 can pass by themselves, so they are marked for the automatic retry;
    // a 404 or a file that is not valid JSON will not get better by asking again.
    let resp: Response;
    try {
      resp = await fetch(url, { cache: 'no-cache' });
    } catch {
      throw Object.assign(new Error(`${url}: could not reach the server`), { transient: true });
    }
    if (!resp.ok) {
      const transient = resp.status >= 500 || resp.status === 408 || resp.status === 429;
      throw Object.assign(new Error(`${url}: HTTP ${resp.status}`), { transient });
    }
    try {
      return (await resp.json()) as T;
    } catch {
      throw new Error(`${url}: not valid JSON (is the bundle URL right?)`);
    }
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

  private _emitState(state: 'enabled' | 'disabled' | 'ready' | 'no-bundle', error: string | null = null): void {
    this._emit('placement-state-change', { state, isEnabled: this._enabled, error });
  }

  private _emit(type: string, detail: unknown): void {
    const target: EventTarget = ((this._getView?.() as any)?.container as HTMLElement | undefined) ?? document;
    target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}
