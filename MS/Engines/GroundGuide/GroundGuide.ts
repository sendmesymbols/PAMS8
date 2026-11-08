/**
 * GroundGuide.ts
 *
 * Optional engine that tells the user, while a symbol is being drawn, whether
 * it sits on deployable terrain, near a no-go area (and how far), partly in
 * one, or inside one. Data comes from a "terrain bundle" — static PNG tiles
 * served by the host app (see MS/Docs/15-ground-guide.md); with no bundle
 * configured the engine is dormant.
 *
 * Hot path (every onDrawProgress): geometry → pixel indices → typed-array
 * reads from already-decoded tiles → pure verdict function. No network, no
 * await. Cold path (pan / zoom / new draw armed): tiles are fetched and decoded
 * in the background by TerrainTileCache.
 *
 * Events (dispatched from the view container, bubbling to document):
 *   "ground-guide-advice"       – GroundGuideVerdict (only when the verdict text changes)
 *   "ground-guide-clear"        – {} when the draw ends / is cancelled
 *   "ground-guide-state-change" – { state: "enabled"|"disabled"|"ready"|"no-bundle", isEnabled, error }
 *                              (`error` says why when the bundle failed; see also `status` / `retry()`)
 *   "ground-guide-blocked"      – { verdict, drawEssentials } (enforce mode)
 *   "ground-guide-override"     – { verdict, drawEssentials } (enforce mode, Shift-click placed it anyway)
 *   "ground-guide-snap"         – GroundGuideSnapResult (the S quick fix)
 *   "ground-guide-audit"        – GroundGuideAudit (openAudit(): every symbol on the map re-judged)
 *   "ground-guide-recheck"      – GroundGuideAudit (symbols re-judged after a move / edit)
 *   "ground-guide-tiles"        – { loaded, pending, failed, missing }
 *   "ground-guide-access"       – { graphic, access } (the way out by road after a placement; traffic.access)
 *
 * Integration: SymbolEngine feeds onDrawProgress, calls prepareFor() when a
 * draw is armed, checkCommit() before a graphic is added, afterPlace() once it is
 * on the map, deactivate() when the draw ends, and onViewChanged() on a 2D↔3D
 * switch; setRouter() gives it a road server for the way out by road.
 */

import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import Graphic from '@arcgis/core/Graphic';
import { SYMBOL_LAYER_IDS } from '../../Managers/GraphicsLayerManager';
import EngineLogger from '../../Support/EngineLogger';
import { setSetting } from '../../Support/SettingsBus';
import { compileProfile, evaluateSamples, fmtDistance, setDistanceUnits, titleCase, type CompiledProfile } from './GroundGuideEvaluator';
import { GroundGuideAuditPanel, type AuditPanelHandlers } from './GroundGuideAuditPanel';
import { GroundGuideBadge, plainLabel } from './GroundGuideBadge';
import { GroundGuideBoundary } from './GroundGuideBoundary';
import { GroundGuideFeatures } from './GroundGuideFeatures';
import { GroundGuideRoads } from './GroundGuideRoads';
import { roadDensityReading, type RoadDensityReading } from './GroundGuideRoadDensity';
import { ROAD_DENSITY_LEADS, ROAD_DENSITY_STYLES } from './GroundGuideRoadDensityView';
import { GroundGuideDetail, type DetailLegendInfo, type DetailTab, type DetailToggle } from './GroundGuideDetail';
import { screenNorth } from './GroundGuideNorth';
import { GroundGuidePopulation as PopulationGrid, POPULATION_FLAGS } from './GroundGuidePopulation';
import { createPopulationLayer } from './GroundGuidePopulationLayer';
import { ensurePopulationCss, populationBriefText, populationKey, populationKeyElement } from './GroundGuidePopulationView';
import {
  COMPASS8,
  ClimateGrid,
  decodeRci,
  decodeSoil,
  pixelGoing,
  rateMovement,
  resolveSeason,
  vehicleFor,
  GOING_CODE,
  goingKey,
  resolveMonth,
  type GoingCause,
  type GoingRule,
} from './GroundGuideGoing';
import {
  bearingStep,
  landingLine,
  monthName,
  pickRoad,
  trafficKey,
  TRAFFIC_LEGEND_STYLES,
  TRAFFIC_RAIN_RULES,
  TRAFFIC_BLOCK_STYLES,
  TRAFFIC_WHERE,
  type GroundGuideTraffic,
} from './GroundGuideTrafficability';
import type { OverlayGoing } from './GroundGuideOverlay';
import SymbolMetadataService from '../SymbolMetadataService';
import {
  BUILTIN_SPEED_TABLES,
  SPEED_CARD_STYLES,
  mergeTables,
  readSpeed,
  resolveMover,
  speedKey,
  speedText,
  type GroundGuideSpeed,
  type MoverSource,
  type SpeedLight,
  type SpeedTables,
} from './GroundGuideSpeed';
import { COVER_CARD_STYLES, COVER_WHERE, coverKey, coverText, readCover, type CoverShelter, type GroundGuideCover } from './GroundGuideCover';
import { BLD_HEIGHT, KINDS as SECTION_KINDS, SECTIONS_STYLES, G_STYLES, R_STYLES, O_STYLES, B_STYLES, W_STYLES, readSections, sectionsKey, type GroundGuideSections, type SectionsFeatures, type SectionsLayers } from './GroundGuideSections';
import { sectionsText } from './GroundGuideSectionsView';
import { GroundGuidePlaceData } from './GroundGuidePlaceData';
import { normaliseSidc } from './GroundGuideProfiles';
import { checkSpacing, echelonCodeOf, planFootprint, sideOf, type FootprintCandidate, type FootprintPlan } from './GroundGuideFootprint';
import { GroundGuideIndicators } from './GroundGuideIndicators';
import { GroundGuideLegend, type LegendState } from './GroundGuideLegend';
import { createOverlayLayer, OVERLAY_COLORS, OVERLAY_LEGEND, type OverlayRenderingSource } from './GroundGuideOverlay';
import { verdictTone } from './GroundGuideTokens';
import { WorkerTileSource } from './WorkerTileSource';
import { resolveProfile } from './GroundGuideProfiles';
import { boundaryPaths, fromMercatorXY, nearEdges, samplePoints, toMercatorShape, type MercShape } from './GroundGuideSampling';
import {
  DEFAULT_GROUND_GUIDE_OPTIONS,
  DIST_FAR,
  DIST_NODATA,
  NODATA_CLASS,
  layerNames,
  type MercXY,
  type GroundGuideAccess,
  type GroundGuideAudit,
  type GroundGuideAuditEntry,
  type GoingSeason,
  type GoingStep,
  type GroundGuideCardOptions,
  type GroundGuideGoingInfo,
  type GroundGuideMovementSector,
  type GroundGuideItg,
  type GroundGuideItgCandidate,
  type GroundGuideIndicator,
  type GroundGuideNearest,
  type GroundGuideOptionIssue,
  type GroundGuideOptions,
  type GroundGuidePopulation,
  type GroundGuidePopulationCardStyle,
  type GroundGuidePopulationReading,
  type GroundGuideProfile,
  type GroundGuideRouter,
  type GroundGuideSnapResult,
  type GroundGuideStamp,
  type GroundGuideStatus,
  type GroundGuideVerdict,
  type GroundGuideVerdictKind,
  type TerrainManifest,
  type TerrainRules,
  type TerrainSample,
} from './GroundGuideTypes';
import {
  HttpPngTileSource,
  MERC_ORIGIN,
  TerrainTileCache,
  lngLatToMercator,
  mercatorToLngLat,
  mercatorToTilePixel,
  resolutionAt,
  zoomForResolution,
} from './TerrainTileCache';

const ENGINE = 'Ground Guide';
const NULL_SAMPLE: TerrainSample = { classCode: null, distanceM: null };
/** Layers whose point symbols count as neighbours for the intergap check. */
const NEIGHBOUR_LAYER_IDS = SYMBOL_LAYER_IDS;
/** Half-width of the local search for the nearest terrain of the opposite kind, in tile pixels. */
const SCAN_RADIUS_PX = 32;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** How far C looks for mapped caves, bunkers, trenches and tunnels (they are sparse: about 1,100 in Pakistan). */
const SHELTER_RADIUS_M = 5000;
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
const FIRST_USE_KEY = 'ms.groundGuide.hintSeen';

/**
 * The stamp on a graphic (`attributes.groundGuide`). Plans saved before the Placement Advisor was
 * renamed Ground Guide carry it as `attributes.placement`; that is moved to the new key on first read,
 * so the next save writes it under the new name.
 */
function readStamp(g: any): GroundGuideStamp | undefined {
  const a = g?.attributes;
  if (!a) return undefined;
  if (!a.groundGuide && a.placement && typeof a.placement === 'object') {
    a.groundGuide = a.placement;
    delete a.placement;
  }
  return a.groundGuide ?? undefined;
}
/** The order modes are offered in (P, the Legend): on foot, wheels, tracks, then the rest; the v2 site and movement modes after. */
const PROFILE_ORDER: readonly GroundGuideProfile[] = [
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
function severity(v: GroundGuideVerdict): number {
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
  verdict: GroundGuideVerdict;
  stamp: GroundGuideStamp | null;
}

export default class GroundGuide {
  private _opts: GroundGuideOptions = { ...DEFAULT_GROUND_GUIDE_OPTIONS };
  private _enabled = false;
  private _manifest: TerrainManifest | null = null;
  private _rules: TerrainRules | null = null;
  private _boundsMerc: [number, number, number, number] = [0, 0, 0, 0];
  private _cache: TerrainTileCache | null = null;
  /** Bundle v2 point features (ITG candidates); null when the bundle has none. */
  private _features: GroundGuideFeatures | null = null;
  /**
   * The routing network's roads for the T road line (`traffic.roadSource: 'network'`): the same edges GeoCore routes
   * on. Null when the bundle has none; the NCGDB road lines in `_features` are used then.
   */
  private _roads: GroundGuideRoads | null = null;
  /** The road server asked for the way out after a placement (`setRouter`). */
  private _router: GroundGuideRouter | null = null;
  private _accessGraphic: Graphic | null = null;
  private _accessTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bundle v2 monthly climate (season for the going); null when the bundle has none. */
  private _climate: ClimateGrid | null = null;
  /** Bundle v2 population grid (B: people round the cursor); null when the bundle has none. */
  private _population: PopulationGrid | null = null;
  /** The People map layer and its key, while `population.layer` is on. */
  private _popLayer: any = null;
  private _popLayerMap: any = null;
  private _popKey: HTMLElement | null = null;
  /** The Ground Detail (D): a wide card with a tab a GROTBC letter and the Legend (K); it holds the docked legend's controls too. */
  private _detail = new GroundGuideDetail({
    close: () => this._toggleBrief(false),
    resized: () => this._badge.reflow(), // the card keeps clear of the Detail at its new height (item 7)
    legend: {
      step: (dir) => this._legendStep(dir),
      pick: (key) => this._legendPick(key as GroundGuideProfile),
      season: (s) => this._setGoing({ season: s }),
      month: (dir) => this._setGoing({ season: 'auto', month: ((resolveMonth(this._opts.going.month) - 1 + dir + 12) % 12) + 1 }),
      light: (light) => {
        this.setOptions({ speed: { ...this._opts.speed, light } });
        setSetting(['groundGuide', 'speed', 'light'], light);
      },
    },
    toggle: (key, on) => this._toggleLayer(key, on),
    opacity: (v) => {
      this.setOptions({ overlay: { ...this._opts.overlay, opacity: v } });
      setSetting(['groundGuide', 'overlay', 'opacity'], v);
      this._syncLegend();
    },
  });
  /** True while the Ground Detail is open (`isDetailOpen`; the older name `isBriefOpen` still works). */
  private _briefOpen = false;
  private _source: OverlayRenderingSource | null = null;
  private _overlay: any = null;
  private _overlayMap: any = null;
  private _overlayShown: GroundGuideProfile | null = null;
  private _lastArmedProfile: GroundGuideProfile | null = null;
  private _compiled = new Map<GroundGuideProfile, CompiledProfile>();
  private _configToken = 0;
  private _loading = false;
  private _loadError: string | null = null;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _retryAttempt = 0;
  private _retryAt = 0;
  /** What the user was last told about the data ("loading", "failed|why", "ready"), so each is said once. */
  private _noticedKey = '';

  private _activeSidc: string | null = null;
  private _activeProfile: GroundGuideProfile | null = null;
  private _lastDetail: { geometry: any; sidc: string | null } | null = null;
  private _lastSnappable = false;
  /** The last real verdict of this draw and where the cursor was, to show while the next tile loads. */
  private _lastGood: GroundGuideVerdict | null = null;
  private _lastGoodGeom: any = null;
  /** Unit type chosen by hand for the draw in progress (P key); null = derived from the SIDC. Cleared when the draw ends. */
  private _profileOverride: GroundGuideProfile | null = null;
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

  private _badge = new GroundGuideBadge();
  private _auditPanel = new GroundGuideAuditPanel();
  private _legend = new GroundGuideLegend({
    step: (dir) => this._legendStep(dir),
    pick: (key) => this._legendPick(key as GroundGuideProfile),
    season: (s) => this._setGoing({ season: s }),
    month: (dir) => this._setGoing({ season: 'auto', month: ((resolveMonth(this._opts.going.month) - 1 + dir + 12) % 12) + 1 }),
    light: (light) => {
      this.setOptions({ speed: { ...this._opts.speed, light } });
      setSetting(['groundGuide', 'speed', 'light'], light);
    },
  });
  /** Season (and profile) the overlay last painted the going for (T); a change repaints it. */
  private _overlaySeasonKey = '';
  /** T block state on the full cursor card: a folded block counts as open while the Ground Detail is; the `tabs` style shows its first tab (T is the Trafficability tab since 2026-11-06). */
  private _trafficOpen = false;
  private _trafficTab = 0;
  private _hintedThisSession = false;
  private _lastIssueKey = '';
  /** The last pointer move was a finger: the card goes above it and does not offer keyboard shortcuts. */
  private _touchInput = false;
  private _nbr: { at: number; map: Map<string, { pts: MercXY[]; gs: any[] }> } | null = null;
  private _tileWaiters: Array<() => void> = [];
  private _indicators = new GroundGuideIndicators(() => this._getView());
  private _boundary = new GroundGuideBoundary(() => this._getView());
  private _lastClient: { x: number; y: number } | null = null;
  private _container: HTMLElement | null = null;
  private _pointerHandler: ((e: PointerEvent) => void) | null = null;
  private _stationaryHandle: { remove(): void } | null = null;
  private _northHandle: { remove(): void } | null = null;

  constructor(private _getView: () => any) {
    // The cursor card keeps clear of the open Ground Detail (user, 2026-11-08, item 7: step aside, then chip).
    this._badge.setAvoid(() => (this._briefOpen ? this._detail.rect : null));
  }

  // ── Configuration ────────────────────────────────────────────────────────

  get options(): Readonly<GroundGuideOptions> {
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
  get status(): GroundGuideStatus {
    const state: GroundGuideStatus['state'] = !this._enabled
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
    this._features?.destroy();
    this._features = null;
    this._roads?.destroy();
    this._roads = null;
    this._climate = null;
    this._removePopulationLayer();
    this._population?.destroy();
    this._population = null;
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
        EngineLogger.error(ENGINE, `Setting groundGuide.overlay.profile = ${JSON.stringify(this._opts.overlay.profile)}: ${problem}; using auto`);
        this._opts.overlay.profile = 'auto';
      }
      const [w, s, e, n] = manifest.bounds;
      const [x0, y0] = lngLatToMercator(w, s);
      const [x1, y1] = lngLatToMercator(e, n);
      this._boundsMerc = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
      this._source = this._makeSource(base, manifest.tileSize, manifest);
      this._cache = new TerrainTileCache(this._source, this._opts.cacheTiles, () => this._onTilesChanged());
      const fm = manifest.grotbc?.features;
      this._features = fm ? new GroundGuideFeatures(base, fm, rules, () => this._onTilesChanged(false)) : null;
      const nm = (manifest.grotbc as any)?.network;
      if (typeof nm?.index === 'string') {
        void GroundGuideRoads.open(base, nm.index, () => this._onTilesChanged(false)).then((roads) => {
          if (token !== this._configToken) roads?.destroy();
          else this._roads = roads;
        });
      }
      const cm = manifest.grotbc?.climate;
      this._climate = cm ? new ClimateGrid(`${base}/${cm.index}`, `${base}/${cm.data}`, () => this._onTilesChanged(false)) : null;
      const pm = manifest.grotbc?.population;
      this._population = pm ? new PopulationGrid(base, pm, () => this._onPopulationReady()) : null;
      this._loadPopulation();
      EngineLogger.success(
        ENGINE,
        `Terrain bundle ready — ${manifest.name ?? base} (rules ${rules.version ?? 'unversioned'})`,
      );
      this._loading = false;
      this._retryAttempt = 0;
      // The user was told it was down or loading: say it is back, so they do not have to guess.
      if (this._enabled && this._noticedKey !== '' && this._noticedKey !== 'ready') {
        this._badge.toast({ verdict: 'ok', title: 'Ground Guide ready', lines: ['Terrain data loaded. Advice is on.'] }, 3500);
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
        title: 'Ground Guide paused',
        lines: [
          'Terrain data is unavailable, so this symbol gets no advice.',
          s.state === 'no-bundle-url' ? 'No terrain bundle is configured.' : (s.error ?? 'The terrain bundle could not be loaded.'),
        ],
        hint:
          s.state === 'no-bundle-url'
            ? 'Set the bundle URL in the Ground Guide settings.'
            : retrying
              ? `Retrying automatically in ${Math.max(1, Math.round((s.retryInMs ?? 0) / 1000))} s. Settings has a Retry button.`
              : 'Press Retry in the Ground Guide settings, or call groundGuide.retry().',
      },
      7000,
    );
  }

  /**
   * Apply settings. Anything that is not a valid value for its setting is ignored (the previous value stays)
   * and reported, as is a number that had to be clamped; the list comes back and is written once to the
   * Engine Log, so a typo in a settings file does not fail silently.
   */
  setOptions(patch: Partial<GroundGuideOptions>): GroundGuideOptionIssue[] {
    const prev = this._opts;
    const next: GroundGuideOptions = { ...prev };
    const issues: GroundGuideOptionIssue[] = [];
    const bad = (path: string, value: unknown, reason: string) => issues.push({ path: `groundGuide.${path}`, value, reason });
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
      const blockable: readonly GroundGuideVerdictKind[] = ['unknown', 'near', 'caution', 'partial', 'in'];
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
        if (problem === null) next.overlay.profile = ov.profile as GroundGuideOptions['overlay']['profile'];
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
    const itg = patch.itg;
    next.itg = { ...prev.itg };
    if (itg && typeof itg === 'object') {
      flag('itg.enabled', itg.enabled, (b) => (next.itg.enabled = b));
      num('itg.radiusKm', itg.radiusKm, 0.5, 10, (n) => (next.itg.radiusKm = n));
      num('itg.max', itg.max, 1, 5, (n) => (next.itg.max = n), true);
      if (itg.minLevel !== undefined) {
        const lvl = Number(itg.minLevel); // the settings widget sends enum values as strings
        if (lvl === 1 || lvl === 2) next.itg.minLevel = lvl;
        else bad('itg.minLevel', itg.minLevel, 'must be 1 (every candidate) or 2 (strong candidates only)');
      }
    }
    const go = patch.going;
    next.going = { ...prev.going };
    if (go && typeof go === 'object') {
      pick('going.season', go.season, ['auto', 'dry', 'wet'] as const, (x) => (next.going.season = x));
      if (go.month !== undefined) {
        const m = Number(go.month); // the settings widget sends enum values as strings
        if (Number.isInteger(m) && m >= 0 && m <= 12) next.going.month = m;
        else bad('going.month', go.month, 'must be 0 (this month) or 1-12');
      }
      num('going.wetMonthMm', go.wetMonthMm, 10, 500, (n) => (next.going.wetMonthMm = n));
      num('going.rangeKm', go.rangeKm, 0.5, 5, (n) => (next.going.rangeKm = n));
      pick('going.movementFor', go.movementFor, ['units', 'points', 'all'] as const, (x) => (next.going.movementFor = x));
    }
    const cd = patch.card;
    next.card = { ...prev.card };
    if (cd && typeof cd === 'object') {
      for (const k of Object.keys(DEFAULT_GROUND_GUIDE_OPTIONS.card) as Array<keyof GroundGuideCardOptions>) {
        if (k === 'cursor') pick('card.cursor', cd.cursor, ['minimal', 'full'] as const, (x) => (next.card.cursor = x));
        else if (k === 'nearest') pick('card.nearest', cd.nearest, ['ranked', 'deciding'] as const, (x) => (next.card.nearest = x));
        else flag(`card.${k}`, cd[k], (b) => (next.card[k] = b));
      }
    }
    const pp = patch.population;
    next.population = { ...prev.population };
    if (pp && typeof pp === 'object') {
      flag('population.enabled', pp.enabled, (b) => (next.population.enabled = b));
      pick(
        'population.card',
        pp.card,
        ['off', 'line', 'scale', 'rings', 'ages', 'rose', 'minimap', 'profile', 'icons', 'compare', 'block'] as const satisfies readonly GroundGuidePopulationCardStyle[],
        (x) => (next.population.card = x),
      );
      flag('population.flag', pp.flag, (b) => (next.population.flag = b));
      num('population.radiusKm', pp.radiusKm, 1, 10, (n) => (next.population.radiusKm = n));
      flag('population.layer', pp.layer, (b) => (next.population.layer = b));
      num('population.layerOpacity', pp.layerOpacity, 0.1, 1, (n) => (next.population.layerOpacity = n));
    }
    const tr = patch.traffic;
    next.traffic = { ...prev.traffic };
    if (tr && typeof tr === 'object') {
      flag('traffic.road', tr.road, (b) => (next.traffic.road = b));
      num('traffic.roadRadiusKm', tr.roadRadiusKm, 0.5, 10, (n) => (next.traffic.roadRadiusKm = n));
      pick('traffic.legend', tr.legend, TRAFFIC_LEGEND_STYLES, (x) => (next.traffic.legend = x));
      flag('traffic.overlay', tr.overlay, (b) => (next.traffic.overlay = b));
      pick('traffic.header', tr.header, ['dry', 'season'] as const, (x) => (next.traffic.header = x));
      flag('traffic.pill', tr.pill, (b) => (next.traffic.pill = b));
      flag('traffic.dual', tr.dual, (b) => (next.traffic.dual = b));
      pick('traffic.rain', tr.rain, TRAFFIC_RAIN_RULES, (x) => (next.traffic.rain = x));
      pick('traffic.block', tr.block, TRAFFIC_BLOCK_STYLES, (x) => (next.traffic.block = x));
      pick('traffic.where', tr.where, TRAFFIC_WHERE, (x) => (next.traffic.where = x));
      pick('traffic.roadSource', tr.roadSource, ['network', 'ncgdb'] as const, (x) => (next.traffic.roadSource = x));
      flag('traffic.access', tr.access, (b) => (next.traffic.access = b));
      num('traffic.accessRadiusKm', tr.accessRadiusKm, 1, 30, (n) => (next.traffic.accessRadiusKm = n));
    }
    const sx = patch.sections;
    next.sections = { ...prev.sections };
    if (sx && typeof sx === 'object') {
      flag('sections.ground', sx.ground, (b) => (next.sections.ground = b));
      flag('sections.roads', sx.roads, (b) => (next.sections.roads = b));
      flag('sections.buildings', sx.buildings, (b) => (next.sections.buildings = b));
      flag('sections.weather', sx.weather, (b) => (next.sections.weather = b));
      flag('sections.obstacles', sx.obstacles, (b) => (next.sections.obstacles = b));
      pick('sections.style', sx.style, SECTIONS_STYLES, (x) => (next.sections.style = x));
      flag('sections.detail', sx.detail, (b) => (next.sections.detail = b));
      num('sections.radiusKm', sx.radiusKm, 0.5, 10, (n) => (next.sections.radiusKm = n));
      flag('sections.roadDensity', sx.roadDensity, (b) => (next.sections.roadDensity = b));
      num('sections.roadDensityKm', sx.roadDensityKm, 0.5, 10, (n) => (next.sections.roadDensityKm = n));
      pick('sections.roadDensityStyle', sx.roadDensityStyle, ROAD_DENSITY_STYLES, (x) => (next.sections.roadDensityStyle = x));
      pick('sections.roadDensityLead', sx.roadDensityLead, ROAD_DENSITY_LEADS, (x) => (next.sections.roadDensityLead = x));
      pick('sections.gStyle', sx.gStyle, G_STYLES, (x) => (next.sections.gStyle = x));
      pick('sections.rStyle', sx.rStyle, R_STYLES, (x) => (next.sections.rStyle = x));
      pick('sections.oStyle', sx.oStyle, O_STYLES, (x) => (next.sections.oStyle = x));
      pick('sections.bStyle', sx.bStyle, B_STYLES, (x) => (next.sections.bStyle = x));
      pick('sections.wStyle', sx.wStyle, W_STYLES, (x) => (next.sections.wStyle = x));
    }
    const cv = patch.cover;
    next.cover = { ...prev.cover };
    if (cv && typeof cv === 'object') {
      flag('cover.enabled', cv.enabled, (b) => (next.cover.enabled = b));
      pick('cover.card', cv.card, COVER_CARD_STYLES, (x) => (next.cover.card = x));
      pick('cover.where', cv.where, COVER_WHERE, (x) => (next.cover.where = x));
      num('cover.radiusM', cv.radiusM, 100, 2000, (n) => (next.cover.radiusM = n));
      flag('cover.focus', cv.focus, (b) => (next.cover.focus = b));
    }
    const sp = patch.speed;
    next.speed = { ...prev.speed };
    if (sp && typeof sp === 'object') {
      flag('speed.enabled', sp.enabled, (b) => (next.speed.enabled = b));
      pick('speed.card', sp.card, SPEED_CARD_STYLES, (x) => (next.speed.card = x));
      pick('speed.light', sp.light, ['day', 'night'] as const, (x) => (next.speed.light = x));
      pick('speed.road', sp.road, ['convoy', 'single'] as const, (x) => (next.speed.road = x));
      pick('speed.load', sp.load, ['combat', 'none'] as const, (x) => (next.speed.load = x));
      if (sp.mover !== undefined) {
        const movers = Object.keys(this._speedTablesNow().movers);
        if (sp.mover === 'auto' || (typeof sp.mover === 'string' && movers.includes(sp.mover))) next.speed.mover = sp.mover;
        else bad('speed.mover', sp.mover, `must be auto or one of: ${movers.join(', ')}`);
      }
      flag('speed.legend', sp.legend, (b) => (next.speed.legend = b));
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
    this._badge.setCard(next.card);
    if (!next.card.briefKey && this._briefOpen) this._toggleBrief(false);
    if (JSON.stringify(next.going) !== JSON.stringify(prev.going) || JSON.stringify(next.card) !== JSON.stringify(prev.card)) {
      this._refreshLive();
    }
    const trafficChanged = JSON.stringify(next.traffic) !== JSON.stringify(prev.traffic);
    // The overlay paints the going for the season (T): a new season, month or rain rule repaints it.
    if (trafficChanged || (next.traffic.overlay && JSON.stringify(next.going) !== JSON.stringify(prev.going))) {
      this._overlaySeasonKey = '';
      this._overlay?.refresh?.();
      this._syncLegend();
    }
    if (trafficChanged) this._refreshLive();
    if (JSON.stringify(next.cover) !== JSON.stringify(prev.cover) || JSON.stringify(next.sections) !== JSON.stringify(prev.sections)) this._refreshLive();
    if (JSON.stringify(next.speed) !== JSON.stringify(prev.speed)) {
      this._syncLegend();
      this._refreshLive();
    }
    if (JSON.stringify(next.population) !== JSON.stringify(prev.population)) {
      this._loadPopulation();
      this._syncPopulationLayer();
      this._refreshLive();
    }
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
  private _reportIssues(issues: GroundGuideOptionIssue[]): void {
    const key = issues.map((i) => `${i.path}=${JSON.stringify(i.value)}`).join('|');
    if (key === this._lastIssueKey) return;
    this._lastIssueKey = key;
    for (const i of issues) EngineLogger.error(ENGINE, `Setting ${i.path} = ${JSON.stringify(i.value)}: ${i.reason}`);
  }

  /** A short notice chip at the foot of the screen (the Ctrl+G toggle says the new state through it). Works while disabled too. */
  announce(text: string, ms = 3500): void {
    this._legend.hint(text, 'announce', ms);
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._retryAttempt = 0;
    this._attachKeys();
    this._emitState('enabled');
    if (this._manifest) {
      this._firstUseHint();
      this._bindView();
      this._loadPopulation();
      this._syncPopulationLayer();
    } else if (this._opts.bundleUrl) void this.configure();
    else this._emitState('no-bundle');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._clearRetry();
    this.deactivate();
    this._detachKeys();
    if (this._briefOpen) {
      this._briefOpen = false;
      this._detail.hide();
    }
    this._unbindView();
    this._removeOverlay();
    this._removePopulationLayer();
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
  private _judgeLive(geometry: any, sidc: string | null): GroundGuideVerdict {
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
    const op = this._opts.overlay;
    v.overlayOther = op.enabled && this._overlay && op.profile !== 'auto' && op.profile !== v.profile ? (this._rules?.profiles?.[op.profile]?.label ?? op.profile) : null;
    v.ground = this._groundNear(geometry, v);
    v.going = this._goingNear(geometry, sidc, v);
    v.briefKey = keys && this._opts.card.briefKey;
    v.traffic = this._trafficNear(geometry, v);
    v.speed = this._speedNear(geometry, sidc, v);
    v.population = this._populationNear(geometry, v);
    v.cover = this._coverNear(geometry, v);
    v.sections = this._sectionsNear(geometry, v);
    this._legend.setKeys(v.profileKey, v.snappable);
    this._detail.setKeys(v.profileKey, v.snappable);
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
  private _staleVerdict(geometry: any): GroundGuideVerdict | null {
    const g = this._lastGood;
    if (!g || !this._lastGoodGeom || (this._cache?.stats().pending ?? 0) === 0) return null;
    const view: any = this._getView?.();
    const a = view?.toScreen?.(this._lastGoodGeom);
    const b = view?.toScreen?.(geometry);
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > STALE_MAX_PX) return null;
    return { ...g, loading: true };
  }

  /** Would `enforce` mode refuse a click with this verdict? */
  private _refuses(v: GroundGuideVerdict): boolean {
    return this._opts.mode === 'enforce' && this._opts.blockOn.includes(v.verdict);
  }

  /** A verdict the user cannot keep: in/partial, or anything `enforce` mode would refuse. */
  private _isBad(v: GroundGuideVerdict): boolean {
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
    this._detail.setKeys(false, false);
    this._syncLegend(); // back to the overlay's mode, or hidden when the overlay is off
    if (this._reevalTimer !== null) {
      clearTimeout(this._reevalTimer);
      this._reevalTimer = null;
    }
    if (this._lastKey !== '') {
      this._lastKey = '';
      this._lastKind = '';
      this._lastSpacingMsg = '';
      this._emit('ground-guide-clear', {});
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
      this._emit('ground-guide-override', { verdict, drawEssentials });
    }
    if (block) {
      this._emit('ground-guide-blocked', { verdict, drawEssentials });
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

  /** What is stored on `graphic.attributes.groundGuide`; null for verdicts that say nothing (off / exempt). */
  private _stampOf(verdict: GroundGuideVerdict): GroundGuideStamp | null {
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
   * Record why a symbol was placed against the rules. Call after a `ground-guide-override` placement with the
   * graphic the engine created; returns false when the graphic was not an override.
   */
  annotateOverride(graphic: any, reason: string): boolean {
    const p = readStamp(graphic);
    if (!p || p.overridden !== true) return false;
    const text = String(reason ?? '').trim().slice(0, 500);
    if (text) p.reason = text;
    else delete p.reason;
    return true;
  }

  // ── The way out by road (T, `traffic.access`) ────────────────────────────

  /**
   * The road server to ask for the way out after a placement (SymbolEngine passes one built on RoadNetworkEngine,
   * which talks to GeoCore). Null switches the Access answer off.
   */
  setRouter(router: GroundGuideRouter | null): void {
    this._router = router;
  }

  /**
   * Called by SymbolEngine once a judged point symbol is on the map: when `traffic.access` is on and a road server is
   * attached, ask it once (in the background) for the way out by road to the nearest MSR, for the symbol's vehicle.
   * The answer is stamped on `graphic.attributes.groundGuide.access`, shown as a short card and the route drawn for a
   * few seconds. Never runs while drawing; nothing happens without a server.
   */
  afterPlace(graphic: any): void {
    const stamp = readStamp(graphic);
    if (!stamp || !this._opts.traffic.access || !this._router || !this.isActive) return;
    if (graphic?.geometry?.type !== 'point') return;
    const mode = this._accessMode(stamp.profile);
    if (mode === null) return;
    void this._access(graphic, stamp, mode).catch((e) => EngineLogger.error(ENGINE, `Way out by road failed: ${e?.message ?? e}`));
  }

  /** The travel mode for a profile: Tracked Vehicle for tracks, Wheeled Vehicle for wheels, null when roads do not matter. */
  private _accessMode(profile: GroundGuideProfile): string | null {
    const want =
      profile === 'tracked' || profile === 'amphibious' ? 'Tracked Vehicle'
      : profile === 'wheeled' || profile === 'gun' || profile === 'ad' || profile === 'signals' || profile === 'roadbound' || profile === 'generic' ? 'Wheeled Vehicle'
      : null;
    if (want === null) return null;
    return this._router?.travelModes().includes(want) ? want : ''; // '' = any vehicle, on a server without military modes
  }

  private async _access(graphic: any, stamp: GroundGuideStamp, mode: string): Promise<void> {
    const at = toMercatorShape(graphic.geometry)?.parts[0]?.[0] as MercXY | undefined;
    const src = this._roadSource();
    const router = this._router;
    if (!at || !src || !router) return;
    const radiusM = this._opts.traffic.accessRadiusKm * 1000;
    await src.whenReady(at, radiusM);
    const near = src.roadsNear(at, radiusM).list;
    const tracked = mode === 'Tracked Vehicle';
    // The nearest MSR; else the nearest road the vehicle can use (tankable for tracks, all-weather for wheels).
    // A numbered MSR (N-5, M-2) is preferred to a nearer stretch of unnumbered MSR (a slip road, a U-turn) when it is
    // no more than half as far again.
    const msr = near.find((h) => h.attrs.m);
    const numbered = msr && !msr.attrs.r ? near.find((h) => h.attrs.m && h.attrs.r && h.distanceM <= msr.distanceM * 1.5 + 200) : undefined;
    const target =
      numbered
      ?? msr
      ?? near.find((h) => (tracked ? h.attrs.k === 3 : h.attrs.aw !== false))
      ?? null;
    const modeLabel = mode || 'Any Vehicle';
    const roadLabel = (h: { attrs: Record<string, unknown> }) =>
      String((h.attrs.r as string) || (h.attrs.n as string) || titleCase(String(h.attrs.t ?? 'road')));
    const version = this._roads?.dataVersion || undefined;
    let access: GroundGuideAccess;
    if (!target) {
      access = { status: 'none', mode, to: '', msr: false, text: `No MSR or ${tracked ? 'Tankable' : 'All-Weather'} Rd within ${fmtDistance(radiusM)}`, dataVersion: version };
    } else if (target.distanceM <= 150) {
      access = { status: 'on', mode, to: roadLabel(target), msr: !!target.attrs.m, text: `On ${target.attrs.m ? 'MSR ' : ''}${roadLabel(target)} (${fmtDistance(target.distanceM)})`, dataVersion: version };
    } else {
      const from = mercatorToLngLat(at[0], at[1]) as [number, number];
      const to = mercatorToLngLat(target.at[0], target.at[1]) as [number, number];
      const r = await router.route(from, to, mode);
      const name = `${roadLabel(target)}${target.attrs.m ? ' (MSR)' : ''}`;
      if (r.ok && r.km !== undefined) {
        // The server starts the route on the nearest road the vehicle may use, which can be the MSR itself: the
        // stretch from the symbol to that road is cross-country and is said separately.
        const p0 = r.paths?.[0]?.[0];
        const offM = p0 ? GroundGuide._groundM(at, lngLatToMercator(p0[0], p0[1]) as MercXY) : 0;
        const roadM = r.km * 1000;
        const cross = offM >= 150 ? `${fmtDistance(offM)} Cross-Country` : '';
        const byRoad = roadM >= 50 ? `${fmtDistance(roadM)} by Rd · ${Math.max(1, Math.round(r.min ?? 0))} min` : '';
        const weakest = roadM < 50
          ? undefined
          : r.limitingCrossing
            ? `Weakest: ${titleCase(r.limitingCrossing)}`
            : r.minLoadClass ? `Lowest Class ${r.minLoadClass}${r.minLoadClassAt ? ` (${r.minLoadClassAt})` : ''}` : undefined;
        access = {
          status: 'ok', mode, to: roadLabel(target), msr: !!target.attrs.m, km: r.km, min: r.min,
          text: `${[cross, byRoad].filter(Boolean).join(', then ') || fmtDistance(Math.max(offM, roadM))} to ${name}`,
          detail: weakest, dataVersion: version,
        };
        this._drawAccess(r.paths ?? null);
      } else {
        const blocked = /travel mode|restriction/i.test(r.error ?? '');
        access = {
          status: blocked ? 'blocked' : 'error', mode, to: roadLabel(target), msr: !!target.attrs.m,
          text: blocked ? `No Rd Out for ${modeLabel} to ${name}` : 'Road server did not answer',
          detail: blocked ? String(r.error).replace(/^.*?they close:\s*/i, 'Closed by: ').slice(0, 220) : undefined,
          dataVersion: version,
        };
      }
    }
    stamp.access = access;
    if (access.status === 'error') return; // nothing to tell: the road server is down, the card says so elsewhere
    this._badge.toast(
      {
        verdict: access.status === 'ok' || access.status === 'on' ? 'ok' : 'caution',
        title: `Way Out by Rd · ${modeLabel}`,
        lines: [access.text, access.detail ?? ''].filter(Boolean),
      },
      access.status === 'ok' ? 8000 : 6000,
    );
    this._emit('ground-guide-access', { graphic, access });
  }

  /** Ground metres between two Web Mercator points. */
  private static _groundM(a: MercXY, b: MercXY): number {
    const lat = 2 * Math.atan(Math.exp((a[1] + b[1]) / 2 / 6378137)) - Math.PI / 2;
    return Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.cos(lat);
  }

  /** The way out on the map for a few seconds: dashed, in the roads layer's MSR red. */
  private _drawAccess(paths: number[][][] | null): void {
    const view: any = this._getView?.();
    if (!view?.graphics || !paths?.length) return;
    if (this._accessGraphic) view.graphics.remove(this._accessGraphic);
    const g = new Graphic({
      geometry: { type: 'polyline', paths, spatialReference: { wkid: 4326 } } as any,
      symbol: { type: 'simple-line', color: [214, 69, 65, 0.95], width: 3, style: 'dash' } as any,
    });
    this._accessGraphic = g;
    view.graphics.add(g);
    clearTimeout(this._accessTimer);
    this._accessTimer = setTimeout(() => {
      if (this._accessGraphic === g) {
        view.graphics?.remove(g);
        this._accessGraphic = null;
      }
    }, 8000);
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
  ): Promise<GroundGuideAudit> {
    return this._auditGraphics(this._placedGraphics(), opts);
  }

  /** `auditPlacements()` with the results panel: progress while it runs, then the list (click a row to zoom to the symbol). */
  async openAudit(): Promise<GroundGuideAudit> {
    if (!this.isActive) {
      this._toastUnavailable('Gr Check');
      return this._auditGraphics([]);
    }
    this._auditPanel.showProgress(0, this._placedGraphics().length);
    const audit = await this.auditPlacements({ onProgress: (d, t) => this._auditPanel.showProgress(d, t) });
    this._auditPanel.show(audit, this._panelHandlers(() => void this.openAudit()));
    this._emit('ground-guide-audit', audit);
    return audit;
  }

  /** Judge one symbol and show why in the panel (context menu: "Ground check…"). */
  async explain(graphic: any): Promise<GroundGuideAuditEntry | null> {
    if (!this.isActive) {
      this._toastUnavailable('Gr Check');
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
      this._badge.toast({ verdict: 'unknown', title: 'Gr Check', lines: [why] }, 4000);
      return null;
    }
    this._auditPanel.show(audit, this._panelHandlers(() => void this.explain(graphic)), { title: 'Gr Check', focus: entry });
    return entry;
  }

  /**
   * Judge symbols again after they were moved or edited, keep their stamps true, and tell the user when one
   * has ended up on ground it cannot use. Fire and forget; does nothing while the guide is inactive.
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
            hint: 'Right-click a symbol, Gr Check, for details.',
          },
          5000,
        );
      }
      this._emit('ground-guide-recheck', audit);
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
      s.state === 'disabled' ? 'The Ground Guide is off.'
      : this._opts.mode === 'off' ? 'The Ground Guide mode is Off.'
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
  ): Promise<GroundGuideAudit> {
    const audit: GroundGuideAudit = { checked: 0, exempt: 0, outside: 0, unchecked: 0, counts: {}, entries: [], problems: [] };
    if (!this.isActive) return audit;
    const token = this._configToken;
    this._nbr = null; // judge against the symbols as they are now

    const items: Array<{ g: any; sidc: string | null; zoom: number; profile: GroundGuideProfile }> = [];
    for (const g of graphics) {
      const sidc = graphicSidc(g);
      const shape = toMercatorShape(g?.geometry);
      // A unit type chosen by hand when the symbol was placed keeps being the one it is judged for.
      const stamped = readStamp(g);
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
      const verdicts = new Map<(typeof items)[number], GroundGuideVerdict>();
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

  private _auditEntry(g: any, sidc: string | null, v: GroundGuideVerdict, problem: boolean, refresh: boolean): GroundGuideAuditEntry {
    const old = readStamp(g);
    if (refresh && g.attributes) {
      const stamp = this._stampOf(v);
      if (stamp) {
        // A Shift-click override stays on record for as long as the symbol is still somewhere it needs one.
        if (old?.overridden && this._isBad(v)) {
          stamp.overridden = true;
          if (old.reason) stamp.reason = old.reason;
        }
        if (old?.profileOverride && old.profile === v.profile) stamp.profileOverride = true;
        g.attributes.groundGuide = stamp;
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
   * the guide would flag or `enforce` refuse. An `ok` spot wins over one that is merely
   * `near`/`caution`, if there is one just a little further out. Point symbols only.
   */
  snapToDeployable(): GroundGuideSnapResult {
    const none = (reason: NonNullable<GroundGuideSnapResult['reason']>, message: string, searchedM = 0): GroundGuideSnapResult =>
      this._announceSnap({ moved: false, at: null, distanceM: null, compass: null, verdict: null, searchedM, reason, message });
    const d = this._lastDetail;
    if (!this.isActive || !d) return none('no-draw', 'Nothing is being drawn');
    if (d.geometry?.type !== 'point') return none('not-point', 'Moving to usable ground works for point symbols only');
    const view: any = this._getView?.();
    const found = this._findSnap(d.geometry, d.sidc);
    if (!found.at) {
      return found.loading
        ? none('loading', 'Terrain data is still loading, try again in a moment')
        : none('no-ground', `No usable Gr within ${fmtDistance(found.searchedM)}`, found.searchedM);
    }
    const target = this._withMerc(d.geometry, found.at);
    const px = target && this._settleOnScreen(view, target, d.sidc);
    if (!px) return none('no-ground', 'Cannot place the symbol there on this view');
    const compass = COMPASS[Math.round(found.bearingDeg / 45) % 8];
    const result: GroundGuideSnapResult = {
      moved: true,
      at: found.at,
      distanceM: found.distanceM,
      compass,
      verdict: found.verdict,
      searchedM: found.searchedM,
      message: `Moved ${fmtDistance(found.distanceM)} ${compass} to ${found.verdict === 'ok' ? 'usable Gr' : 'the nearest usable Gr'}`,
    };
    this._announceSnap(result);
    // The armed symbol's own click handler finishes the draw at this spot, so every point
    // symbol type, the commit check and the stamp go through their normal path.
    this._clickAt(view, px.x, px.y);
    return result;
  }

  /** 0 = clean spot, 1 = usable but marginal (near / caution, not touching), -1 = not usable. */
  private _snapRank(v: GroundGuideVerdict): number {
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
    | { at: MercXY; distanceM: number; bearingDeg: number; verdict: GroundGuideVerdict['verdict']; searchedM: number }
    | { at: null; searchedM: number; loading: boolean } {
    const profile = this._profileFor(sidc);
    const origin = toMercatorShape(geometry)?.parts[0]?.[0];
    if (!origin || profile === 'exempt') return { at: null, searchedM: 0, loading: false };
    const res = resolutionAt(this._sampleZoom(), this._manifest!.tileSize);
    const lat = 2 * Math.atan(Math.exp(origin[1] / 6378137)) - Math.PI / 2;
    const groundK = Math.cos(lat); // true metres per Web Mercator metre here
    const searchedM = SNAP_MAX_PX * res * groundK;

    let best: { rank: number; at: MercXY; dx: number; dy: number; verdict: GroundGuideVerdict['verdict'] } | null = null;
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

  private _announceSnap(r: GroundGuideSnapResult): GroundGuideSnapResult {
    this._emit('ground-guide-snap', r);
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
    this._removePopulationLayer(); // and the People layer and its key go to the new view
    this._syncPopulationLayer();
  }

  destroy(): void {
    this.disable();
    this._indicators.destroy();
    this._boundary.reset();
    this._configToken++;
    this._clearRetry();
    this._cache?.clear();
    this._cache = null;
    this._features?.destroy();
    this._features = null;
    this._roads?.destroy();
    this._roads = null;
    this._router = null;
    clearTimeout(this._accessTimer);
    if (this._accessGraphic) (this._getView?.() as any)?.graphics?.remove(this._accessGraphic);
    this._accessGraphic = null;
    this._climate = null;
    this._population?.destroy();
    this._population = null;
    this._source?.dispose?.();
    this._source = null;
    this._badge.destroy();
    this._detail.destroy();
    this._auditPanel.destroy();
    this._legend.destroy();
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  resolveProfile(sidc: string | null | undefined): GroundGuideProfile {
    return resolveProfile(sidc, this._rules);
  }

  /** The profile a draw is judged for: the hand-picked one, else the one derived from the SIDC (never for a symbol that is not terrain-bound). */
  private _profileFor(sidc: string | null | undefined): GroundGuideProfile {
    const base = resolveProfile(sidc ?? this._activeSidc, this._rules);
    return this._profileOverride !== null && base !== 'exempt' ? this._profileOverride : base;
  }

  /**
   * Unit types P and the Legend step through: those the bundle has distance layers for, foot to heavy
   * then the rest (the manifest lists them alphabetically), any others the bundle adds after them.
   */
  get profileChoices(): GroundGuideProfile[] {
    const rank = (p: string) => {
      const i = PROFILE_ORDER.indexOf(p as GroundGuideProfile);
      return i < 0 ? PROFILE_ORDER.length : i;
    };
    return ((this._manifest?.profiles ?? []) as GroundGuideProfile[]).filter((p) => p !== 'exempt').sort((a, b) => rank(a) - rank(b));
  }

  /** The unit type chosen by hand for the draw in progress, or null when it is derived from the SIDC. */
  get profileOverride(): GroundGuideProfile | null {
    return this._profileOverride;
  }

  /**
   * Judge the draw in progress for a different unit type (null = back to what the SIDC says), for that one
   * symbol: the SIDC does not always say how a unit moves (a mounted vs dismounted infantry platoon).
   * The stamp records it as chosen by hand and the audit keeps judging the symbol that way. Returns false
   * when nothing is being drawn, the symbol is not terrain-bound, or the bundle has no such profile.
   */
  setProfileOverride(profile: GroundGuideProfile | null): boolean {
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
    this._emit('ground-guide-profile', { profile: this._activeProfile, overridden: profile !== null });
    const d = this._lastDetail;
    if (d) this._apply(this._judgeLive(d.geometry, d.sidc));
    return true;
  }

  /**
   * Step the draw in progress to the next (or previous) unit type, in the legend's order; reaching the
   * SIDC's own type goes back to "auto". Returns the override now in force (null = from the SIDC).
   */
  cycleProfile(dir: 1 | -1 = 1): GroundGuideProfile | null {
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
      profile?: GroundGuideProfile;
      /** The placed symbol being judged, so the spacing check does not count it as its own neighbour. */
      self?: any;
    },
  ): GroundGuideVerdict {
    const profile = opts?.profile ?? this._profileFor(sidc);
    if (!this.isActive) return this._blank('off', profile, 'Ground Guide off');
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
      v: GroundGuideVerdict;
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
    if (this._opts.traffic.header === 'season' && geometry?.type === 'point') this._seasonHeader(v, shape.parts[0]?.[0]);
    return v;
  }

  /**
   * T, `traffic.header: 'season'` (opt-in): the verdict at a point takes the going for the season, soil and wet
   * ground included, so the header, the Why scale and Enforce Mode follow it. It only ever makes the verdict worse,
   * and only for what the class verdict does not already say (soft soil, sand, wet ground).
   */
  private _seasonHeader(v: GroundGuideVerdict, at: MercXY | undefined): void {
    if (!at || v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt' || v.verdict === 'in') return;
    const L = this._goingLayers();
    if (!L || !this._cache) return;
    const { read } = this._pixelReader(this._sampleZoom());
    const [lon, lat] = mercatorToLngLat(at[0], at[1]);
    const { season } = resolveSeason(this._opts.going, this._climate?.precAt(lon, lat) ?? null);
    const rule = this._goingRule();
    const rci = read(season === 'dry' ? L.dry : L.wet, at[0], at[1]);
    const g = pixelGoing(
      {
        cls: read(this._layerNames(v.profile).cls, at[0], at[1]),
        rci,
        wet: L.wetLayer ? read(L.wetLayer, at[0], at[1]) : null,
        soil: rule.kind === 'bearing' ? read(L.soil, at[0], at[1]) : null,
      },
      this._profile(v.profile),
      vehicleFor(this._rules, v.profile),
      season,
      rule,
    );
    if (!g || g.step === 'go' || g.cause === 'class') return; // the class is already in the verdict
    const when = season === 'wet' ? 'After Rain' : 'in the Dry Season';
    const why = this._causeText(g.cause, null, decodeRci(rci)?.coarse ?? false, season);
    if (g.step === 'nogo') {
      v.verdict = 'in';
      v.message = `NO-GO ${when}`;
    } else if (v.verdict === 'ok' || (v.verdict === 'near' && v.fraction === 0)) {
      v.verdict = 'caution';
      v.message = `SLOW-GO ${when}`;
    } else return;
    const step = g.step === 'nogo' ? 'NO-GO' : 'SLOW-GO';
    v.detail = `${why ?? 'Soil'}: ${step} for ${v.profileLabel} ${when.toLowerCase()}`;
    v.reason = `${why ?? 'The soil'} makes this ground ${step} ${when.toLowerCase()}.`;
  }

  /** T on the card while drawing: the road (or landing-site) line, the rain pill and the second scale. Null when no T option is on. */
  private _trafficNear(geometry: any, v: GroundGuideVerdict): GroundGuideTraffic | null {
    const t = this._opts.traffic;
    const blockOn = t.block !== 'off';
    if (!(t.road || t.pill || t.dual || blockOn) || v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt') return null;
    if (!this._extrasWanted() && !this._nearestWanted()) return null;
    const pt = v.going?.point ?? null;
    const wet = v.going?.season === 'wet';
    let road: GroundGuideTraffic['road'] = null;
    let pending = false;
    if (t.road) {
      if (v.profile === 'hls') road = landingLine(v.classCode, pt ? pt.wet !== pt.dry : false);
      else if (this._roadSource()) {
        const at = geometry?.type === 'point' ? toMercatorShape(geometry)?.parts[0]?.[0] : this._pointerMerc();
        if (at) {
          const radiusM = t.roadRadiusKm * 1000;
          const near = this._roadSource()!.roadsNear(at, radiusM);
          pending = near.pending;
          const step: GoingStep = pt ? (wet ? pt.wet : pt.dry) : v.verdict === 'ok' || v.verdict === 'near' ? 'go' : v.verdict === 'caution' ? 'slow' : 'nogo';
          road = pickRoad(v.profile, step, wet, near.list, radiusM);
        }
      }
    }
    if (!road && !t.pill && !t.dual && !blockOn) return null;
    return { road, pending, pill: t.pill, dual: t.dual, block: t.block, where: t.where, open: this._trafficOpen || this._briefOpen, tab: this._trafficTab };
  }

  // ── Speed (T) ────────────────────────────────────────────────────────────

  /** A host's override of the speed tables (`setSpeedTables`), merged over the bundle's (`grotbc.speed`) and the built-in ones. */
  private _speedPatch: unknown = null;
  private _speedTablesCache: { rules: unknown; patch: unknown; tables: SpeedTables } | null = null;
  /** Catalogue lookup: a Symbols.json key (symbol set + entity) to its `Mover`. */
  private _moverLookup: (key: string) => string | null | undefined = (k) => SymbolMetadataService.getByKey(k)?.Mover ?? null;

  private _speedTablesNow(): SpeedTables {
    const fromBundle = (this._rules?.grotbc as any)?.speed;
    const c = this._speedTablesCache;
    if (c && c.rules === fromBundle && c.patch === this._speedPatch) return c.tables;
    const tables = mergeTables(mergeTables(BUILTIN_SPEED_TABLES, fromBundle), this._speedPatch);
    this._speedTablesCache = { rules: fromBundle, patch: this._speedPatch, tables };
    return tables;
  }

  /**
   * The movement speed tables in force: MS/Data/MovementSpeeds.json (a starting proposal), then the bundle's
   * rules.json `grotbc.speed`, then `setSpeedTables()`. Movers, grounds, road and column speeds, slope rules, sources.
   */
  get speedTables(): SpeedTables {
    return this._speedTablesNow();
  }

  /**
   * Override any part of the speed tables (deep merge, key by key; arrays replace), e.g.
   * `setSpeedTables({ movers: { foot: { ground: { open: [4.5, 3] } } } })`. `null` drops the override.
   */
  setSpeedTables(patch: unknown): void {
    this._speedPatch = patch ?? null;
    this._speedTablesCache = null;
    this._refreshLive();
  }

  /** Where the catalogue's `Mover` comes from (default: MS/Data/Symbols.json); a host with its own catalogue sets its own. */
  setMoverLookup(fn: ((catalogKey: string) => string | null | undefined) | null): void {
    this._moverLookup = fn ?? ((k) => SymbolMetadataService.getByKey(k)?.Mover ?? null);
    this._refreshLive();
  }

  /** Who moves for a SIDC (see GroundGuideSpeed resolveMover): the mover key, its label, A / B / C and where it came from. */
  moverFor(sidc: string | null | undefined, profile?: GroundGuideProfile): { key: string; label: string; cat: 'A' | 'B' | 'C' | null; from: MoverSource } | null {
    const t = this._speedTablesNow();
    const p = profile ?? this.resolveProfile(sidc);
    const r = resolveMover(t, sidc, p, { setting: this._opts.speed.mover, catalog: this._moverLookup });
    if (!r) return null;
    const m = t.movers[r.key];
    return { key: r.key, label: m.label, cat: m.cat, from: r.from };
  }

  /** The going for any profile at a spot and season, with what limits it, read the way the card reads it. */
  private _goingReader(read: (layer: string, mx: number, my: number) => number | null | undefined, clsLayer: string) {
    const L = this._goingLayers();
    const rule = this._goingRule();
    const compiled = new Map<string, { cp: CompiledProfile; veh: ReturnType<typeof vehicleFor> }>();
    return (profile: string, x: number, y: number, season: GoingSeason): { step: GoingStep; why: string | null } | null => {
      let e = compiled.get(profile);
      if (!e) {
        e = { cp: this._profile(profile as GroundGuideProfile), veh: L ? vehicleFor(this._rules, profile) : null };
        compiled.set(profile, e);
      }
      const cls = read(clsLayer, x, y);
      const rci = L ? read(season === 'dry' ? L.dry : L.wet, x, y) : null;
      const g = pixelGoing(
        { cls, rci, wet: L?.wetLayer ? read(L.wetLayer, x, y) : null, soil: rule.kind === 'bearing' && L ? read(L.soil, x, y) : null },
        e.cp,
        e.veh,
        season,
        rule,
      );
      return g ? { step: g.step, why: this._causeText(g.cause, cls, decodeRci(rci)?.coarse ?? false, season) } : null;
    };
  }

  /** Read speed at a point (shared by the live card and `speedAround`). */
  private _readSpeed(
    at: MercXY,
    profile: GroundGuideProfile,
    mover: { key: string; from: MoverSource },
    z: number,
    o: { rays: boolean; season?: GoingSeason; light?: SpeedLight; rangeKm?: number },
  ): GroundGuideSpeed | null {
    const m = this._manifest!;
    const { read, state } = this._pixelReader(z);
    const [lon, lat] = mercatorToLngLat(at[0], at[1]);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const season = o.season ?? resolveSeason(this._opts.going, this._climate?.precAt(lon, lat) ?? null).season;
    const clsLayer = this._layerNames(profile).cls;
    const L = this._sectionLayers();
    const radiusM = this._opts.traffic.roadRadiusKm * 1000;
    const roads = this._roadSource()?.roadsNear(at, radiusM) ?? null;
    return readSpeed({
      tables: this._speedTablesNow(),
      mover,
      opts: o.light ? { ...this._opts.speed, light: o.light } : this._opts.speed,
      season,
      at,
      cosLat,
      pxM: resolutionAt(z, m.tileSize) * cosLat,
      read,
      layers: { cls: clsLayer, elevHi: L.elevHi, elevLo: L.elevLo, terrain: L.terrain },
      goingAt: this._goingReader(read, clsLayer),
      roads,
      roadRadiusM: radiusM,
      rays: o.rays,
      rangeM: (o.rangeKm ?? this._opts.going.rangeKm) * 1000,
      pending: () => state.pending,
    });
  }

  /** Speed at the point being placed (the cursor, for lines and areas). Null when off, or the symbol does not move on the ground. */
  private _speedNear(geometry: any, sidc: string | null, v: GroundGuideVerdict): GroundGuideSpeed | null {
    const o = this._opts.speed;
    if (!o.enabled || v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt' || !this._cache || !this._manifest) return null;
    if ((o.card === 'off' || !this._extrasWanted()) && !this._briefOpen) return null;
    const at = geometry?.type === 'point' ? toMercatorShape(geometry)?.parts[0]?.[0] : this._pointerMerc();
    if (!at) return null;
    const mover = resolveMover(this._speedTablesNow(), sidc, v.profile, { setting: o.mover, hand: !!v.profileOverride, catalog: this._moverLookup });
    if (!mover) return null;
    return this._readSpeed(at, v.profile, mover, this._sampleZoom(), { rays: o.card === 'rose' || this._briefOpen });
  }

  /**
   * Speed at a map point for a symbol (its SIDC picks the mover) or a mover key (`opts.mover`), read at the bundle's
   * finest zoom: cross-country now, day / night x dry / after rain, up / down the slope, the road with the time to reach
   * it, eight directions to `rangeKm`, a day's march. Waits for the tiles. Null when the guide is off or nothing moves.
   */
  async speedAround(
    point: any,
    opts: { sidc?: string; mover?: string; profile?: GroundGuideProfile; season?: GoingSeason; light?: SpeedLight; rangeKm?: number } = {},
  ): Promise<GroundGuideSpeed | null> {
    const ll = this._lngLatOf(point);
    if (!ll || !this._cache || !this._manifest) return null;
    const m = this._manifest;
    const z = m.zoom.max;
    const at = lngLatToMercator(ll[0], ll[1]) as MercXY;
    const rangeKm = Math.min(5, Math.max(0.5, opts.rangeKm ?? this._opts.going.rangeKm));
    const t = this._speedTablesNow();
    const profile = opts.profile ?? (opts.sidc ? this.resolveProfile(opts.sidc) : this._activeProfile ?? this._lastArmedProfile ?? 'dismounted');
    const mover = opts.mover && t.movers[opts.mover]
      ? { key: opts.mover, from: 'setting' as MoverSource }
      : resolveMover(t, opts.sidc ?? null, profile, { setting: this._opts.speed.mover, catalog: this._moverLookup });
    if (!mover) return null;
    const reach = 600 / Math.cos((ll[1] * Math.PI) / 180) + rangeKm * 1000;
    const a = mercatorToTilePixel(at[0] - reach, at[1] + reach, z, m.tileSize);
    const b = mercatorToTilePixel(at[0] + reach, at[1] - reach, z, m.tileSize);
    const L = this._sectionLayers();
    const G = this._goingLayers();
    const layers = [this._layerNames(profile).cls, L.elevHi, L.elevLo, L.terrain, G?.soil, G?.dry, G?.wet, G?.wetLayer];
    for (let ty = a.ty; ty <= b.ty; ty++) {
      for (let tx = a.tx; tx <= b.tx; tx++) {
        for (const layer of layers) if (layer) this._cache.request(layer, z, tx, ty);
      }
    }
    await Promise.all([this._tilesSettled(10000), this._roadSource()?.whenReady(at, this._opts.traffic.roadRadiusKm * 1000)]);
    this._climate?.precAt(ll[0], ll[1]); // starts the climate grid if it is not in memory
    for (let i = 0; i < 20 && this._climate && this._climate.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 150));
    return this._readSpeed(at, profile, mover, z, { rays: true, season: opts.season, light: opts.light, rangeKm });
  }

  /** `speedAround()` as Copy as Text lines; null when there is no reading. */
  async speedText(point: any, opts: Parameters<GroundGuide['speedAround']>[1] = {}): Promise<string[] | null> {
    const s = await this.speedAround(point, opts);
    return s ? speedText(s) : null;
  }

  /**
   * Where the road line's roads come from: the routing network (the roads GeoCore routes on and the map draws) when
   * `traffic.roadSource` is `network` and the bundle ships it, else the NCGDB road lines of the feature tiles.
   */
  private _roadSource(): GroundGuideRoads | GroundGuideFeatures | null {
    if (this._opts.traffic.roadSource === 'network' && this._roads) return this._roads;
    return this._features;
  }

  /**
   * The going the overlay paints for a profile (T, `traffic.overlay`): the season at the view's centre, the mode's
   * soil thresholds and the rain rule, with the soil and wet layers it reads. Null paints the ground classes alone.
   */
  private _overlayGoing(profile: GroundGuideProfile): OverlayGoing | null {
    const t = this._opts.traffic;
    const L = this._goingLayers();
    if (!t.overlay || !L) return null;
    const season = this._viewSeason();
    const veh = vehicleFor(this._rules, profile);
    let bearingMin: Uint8Array | undefined;
    if (t.rain === 'bearing') {
      bearingMin = new Uint8Array(256);
      for (let b = 0; b < 255; b++) bearingMin[b] = GOING_CODE[bearingStep(this._rules, b, season, veh?.onFoot ?? false) ?? 'go'];
    }
    return {
      params: { season, rule: t.rain, veh, bearingMin },
      soilLayer: t.rain === 'words' || !veh ? null : t.rain === 'bearing' ? L.soil : season === 'dry' ? L.dry : L.wet,
      wetLayer: season === 'wet' ? L.wetLayer : null,
    };
  }

  /** The season at the view's centre (`going.season`, `auto` from that point's monthly rain). */
  private _viewSeason(): GoingSeason {
    const c = (this._getView?.() as any)?.center;
    const p = c ? toMercatorShape(c)?.parts[0]?.[0] : null;
    const prec = p ? this._climate?.precAt(...(mercatorToLngLat(p[0], p[1]) as [number, number])) ?? null : null;
    return resolveSeason(this._opts.going, prec).season;
  }

  /** The view came to rest: repaint the overlay when the season at the centre changed (an `auto` season moves with the map). */
  private _checkOverlaySeason(): void {
    if (this._opts.traffic.legend === 'month') this._syncLegend(); // the month's rain is read at the view's centre
    if (!this._overlay || !this._opts.traffic.overlay) return;
    const key = `${this._viewSeason()}|${this._opts.traffic.rain}`;
    if (this._overlaySeasonKey !== '' && key !== this._overlaySeasonKey) {
      this._overlay.refresh?.();
      this._syncLegend();
    }
    this._overlaySeasonKey = key;
  }

  /** Change the going settings from the legend (T season switch / month stepper), keeping the settings panel in step. */
  private _setGoing(patch: Partial<GroundGuideOptions['going']>): void {
    const going = { ...this._opts.going, ...patch };
    this.setOptions({ going });
    // The settings widget keeps the month as an enum string ("7").
    for (const k of Object.keys(patch) as Array<keyof typeof patch>) setSetting(['groundGuide', 'going', k], k === 'month' ? String(going[k]) : going[k]);
  }

  /**
   * The rule owner's own words for why this ground decides the verdict: the profile's `why` for the class,
   * else the class's `note` (rules.json). Next to no-go (nothing touching), it is the nearest no-go that
   * counts. Null when the bundle carries no text; the guide never makes any up.
   */
  private _reasonFor(v: GroundGuideVerdict): string | null {
    const rules = this._rules;
    if (!rules || v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt') return null;
    const code = v.verdict === 'near' && v.fraction === 0 ? (v.nearest?.kind === 'no-go' ? v.nearest.classCode : null) : v.classCode;
    if (code === null || code === undefined) return null;
    const text = rules.profiles?.[v.profile]?.why?.[String(code)] ?? rules.classes?.[String(code)]?.note;
    return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
  }

  /** Record the footprint the verdict was judged on, say so in the detail line, and run the intergap check. */
  private _applyFootprint(
    v: GroundGuideVerdict,
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
    v: GroundGuideVerdict,
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
        v.detail = `Nearest suitable Gr: ${nearest.className}, ${fmtDistance(nearest.distanceM)} to the ${nearest.compass}`;
      } else if (rangeM > 0) {
        v.detail = `No suitable Gr within ${fmtDistance(rangeM)}`;
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
    let { nearest } = this._scanNearest(ctx, pts[idx][0], pts[idx][1], true, cp);
    // Beyond the scan window the distance layer still knows how far the no-go is: take its direction from the layer
    // too, so the card's Nearest keeps its compass rather than turning into a bare distance (user, 2026-11-07).
    if (!nearest && v.distanceM !== null && v.distanceM > 0 && v.distanceM < ctx.scale * DIST_FAR) {
      nearest = this._nearestAlongDistance(ctx, pts[idx][0], pts[idx][1], v.distanceM, cp);
    }
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
  ): { nearest: GroundGuideNearest | null; rangeM: number } {
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
   * The nearest no-go past the scan window, found from the distance layer by walking down it: from the point, step to
   * the lowest of sixteen reads round it (half the distance left, at least a pixel, at most 40), until the distance
   * is spent; the walk ends at the edge of the nearest no-go, and the bearing is from the point to there. One read a
   * pixel on names the class when its tile is in; otherwise it is "NO-GO ground". Null when the walk cannot start
   * (tiles not in, or nothing lower round the point).
   */
  private _nearestAlongDistance(ctx: ReadContext, mx: number, my: number, distM: number, cp: CompiledProfile): GroundGuideNearest | null {
    const c: ReadContext = { ...ctx, tx: -1, ty: -1, ct: undefined, dt: undefined, waiting: false };
    const lat = 2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2;
    const k = 1 / Math.cos(lat); // Web Mercator metres per ground metre here
    const groundPx = resolutionAt(ctx.z, ctx.ts) / k;
    const N = 16;
    let x = mx;
    let y = my;
    let left = distM;
    for (let step = 0; step < 48 && left > ctx.scale; step++) {
      const s = Math.max(groundPx, Math.min(left * 0.5, 40 * groundPx));
      let best = left;
      let bx = x;
      let by = y;
      for (let i = 0; i < N; i++) {
        const b = (i * 2 * Math.PI) / N;
        const px = x + Math.sin(b) * s * k;
        const py = y + Math.cos(b) * s * k;
        const d = this._read(c, px, py).distanceM;
        if (d !== null && d < best) {
          best = d;
          bx = px;
          by = py;
        }
      }
      if (bx === x && by === y) break; // nothing lower round here: the walk is as far as the layer can take it
      x = bx;
      y = by;
      left = best;
    }
    if (x === mx && y === my) return null;
    const bearingDeg = ((Math.atan2(x - mx, y - my) * 180) / Math.PI + 360) % 360;
    const br = (bearingDeg * Math.PI) / 180;
    const to: MercXY = [x, y];
    // Name it from the first no-go pixel at the walk's end: on, then one and two pixels on, then a pixel either side.
    let code: number | null = null;
    const u = groundPx * k;
    for (const [a, b] of [[0, 0], [1, 0], [2, 0], [1, 1], [1, -1]] as const) {
      const hit = this._read(c, x + (Math.sin(br) * a + Math.cos(br) * b) * u, y + (Math.cos(br) * a - Math.sin(br) * b) * u).classCode;
      if (hit !== null && hit !== NODATA_CLASS && cp.target[hit] === 1) {
        code = hit;
        break;
      }
    }
    return {
      kind: 'no-go',
      classCode: code ?? -1,
      className: code !== null ? (this._rules?.classes?.[String(code)]?.label ?? `class ${code}`) : 'NO-GO Gr',
      distanceM: distM,
      from: [mx, my],
      to,
      bearingDeg,
      compass: COMPASS[Math.round(bearingDeg / 45) % 8],
    };
  }

  /**
   * Lines to the terrain behind the verdict, in Web Mercator metres (the guide draws
   * them itself; the same data rides on the `ground-guide-advice` event for hosts).
   *  - too close to no-go (point, or the part of a shape nearest it): to that no-go edge;
   *  - a point inside no-go: to the nearest deployable ground;
   *  - a line/area partly or mostly in no-go: from the cursor to the nearest contested
   *    sample, with marks on the contested samples.
   */
  private _addIndicators(
    v: GroundGuideVerdict,
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
        // Short enough for the dark plate it sits on (item 15): what the ground is, then how far.
        label:
          n.kind === 'no-go'
            ? `${titleCase(n.className)} · ${n.distanceM < 1 ? 'at the edge' : fmtDistance(n.distanceM)}`
            : `${titleCase(n.className)} · ${fmtDistance(n.distanceM)} ${n.compass}`,
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
    const ind: GroundGuideIndicator = {
      kind: 'contested',
      from,
      to,
      marks: loose.filter((_, i) => i % stride === 0),
      stretches,
      classCode: v.classCode,
      className: v.className,
      label: `${titleCase(v.className ?? 'NO-GO Gr')} · ${Math.max(1, Math.round(v.fraction * 100))}% inside`,
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

  /**
   * Important Tactical Ground (ITG) candidates round a map point (G in GROTBC), strongest first, then nearest.
   * Waits for the feature tiles it needs. Empty when the bundle carries no ground features. Candidates only:
   * whether one is ITG or MITG for a task is the user's decision (`SymbolEngine.designateGround()`).
   */
  async groundCandidates(
    point: any,
    opts: { radiusKm?: number; max?: number; minLevel?: 1 | 2 } = {},
  ): Promise<GroundGuideItgCandidate[]> {
    const f = this._features;
    const p = toMercatorShape(point)?.parts[0]?.[0];
    if (!f || !p) return [];
    const radiusM = Math.min(25, Math.max(0.1, opts.radiusKm ?? this._opts.itg.radiusKm)) * 1000;
    await f.whenReady(p, radiusM);
    return f.candidatesNear(p, radiusM, Math.max(1, opts.max ?? 50), opts.minLevel ?? 1).list;
  }

  /** The card's ITG lines: candidates round the point being placed (or the cursor, for lines and areas). */
  private _groundNear(geometry: any, v: GroundGuideVerdict): GroundGuideItg | null {
    const o = this._opts.itg;
    if (!o.enabled || !this._features || v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt') return null;
    if (!this._extrasWanted() && !this._nearestWanted()) return null;
    const at = geometry?.type === 'point' ? toMercatorShape(geometry)?.parts[0]?.[0] : this._pointerMerc();
    if (!at) return null;
    const radiusM = o.radiusKm * 1000;
    const { list, pending } = this._features.candidatesNear(at, radiusM, o.max, o.minLevel);
    return { candidates: list, radiusM, pending };
  }

  /**
   * People round a point (B in GROTBC, civil considerations): `[lng, lat]`, an ArcGIS point or any geometry (its
   * first vertex). Waits for the population grid and the place tiles. Null when the bundle has no population grid
   * or the point is outside it. WorldPop estimates, not a census.
   */
  async populationAround(point: any, opts: { radiusKm?: number } = {}): Promise<GroundGuidePopulationReading | null> {
    const grid = this._population;
    if (!grid || !(await grid.load())) return null;
    const ll = this._lngLatOf(point);
    if (!ll) return null;
    await this._features?.whenReady(lngLatToMercator(ll[0], ll[1]) as MercXY, 10000);
    const radiusKm = Math.min(10, Math.max(1, opts.radiusKm ?? this._opts.population.radiusKm));
    return grid.around(ll[0], ll[1], radiusKm, this._placesSource());
  }

  /**
   * C (Cover, Camouflage & Concealment) at a map point, read at the bundle's finest zoom: the four-way cover from the
   * class split and any bank, the local cc density, the nearest Fair or better within `radiusM` and the rose.
   * `profile` picks the need that is marked (default: the armed or last profile, else dismounted). Waits for the tiles.
   * Null when the guide is off or the bundle has no cover rules. The levels are a proposal (rules.json coverSplit).
   */
  async coverAround(point: any, opts: { profile?: GroundGuideProfile; radiusM?: number } = {}): Promise<GroundGuideCover | null> {
    const L = this._coverLayers();
    const ll = this._lngLatOf(point);
    if (!L || !ll || !this._cache || !this._manifest) return null;
    const m = this._manifest;
    const z = m.zoom.max;
    const profile = opts.profile ?? this._activeProfile ?? this._lastArmedProfile ?? 'dismounted';
    const cls = this._layerNames(profile).cls;
    const at = lngLatToMercator(ll[0], ll[1]) as MercXY;
    const cosLat = Math.cos((ll[1] * Math.PI) / 180);
    const radiusM = Math.min(2000, Math.max(100, opts.radiusM ?? this._opts.cover.radiusM));
    const reach = radiusM / cosLat;
    const a = mercatorToTilePixel(at[0] - reach, at[1] + reach, z, m.tileSize);
    const b = mercatorToTilePixel(at[0] + reach, at[1] - reach, z, m.tileSize);
    for (let ty = a.ty; ty <= b.ty; ty++) {
      for (let tx = a.tx; tx <= b.tx; tx++) {
        for (const layer of [cls, L.cc, L.bank, this._sectionLayers().landform, this._sectionLayers().bld]) if (layer) this._cache.request(layer, z, tx, ty);
      }
    }
    await Promise.all([this._tilesSettled(8000), this._features?.whenReady(at, SHELTER_RADIUS_M)]);
    const { read, state } = this._pixelReader(z);
    return readCover({
      rules: this._rules?.grotbc ?? null,
      opts: { ...this._opts.cover, radiusM },
      profile,
      at: [at[0], at[1]],
      cosLat,
      pxM: resolutionAt(z, m.tileSize) * cosLat,
      layers: { cls, cc: L.cc, bank: L.bank },
      read,
      classLabel: (c) => plainLabel(this._rules?.classes?.[String(c)]?.label ?? '') || `Class ${c}`,
      pending: () => state.pending,
      scan: true,
      shelters: this._sheltersNear(at),
      ...this._coverExtras(at, read),
    });
  }

  /** `coverAround()` as the Ground Brief's Copy as Text lines; null when there is no reading. */
  async coverText(point: any, opts: { profile?: GroundGuideProfile; radiusM?: number } = {}): Promise<string[] | null> {
    const c = await this.coverAround(point, opts);
    return c ? coverText(c, fmtDistance) : null;
  }

  /** `populationAround()` as the Ground Brief's Copy as Text lines; null when there is no reading. */
  async populationText(point: any): Promise<string[] | null> {
    const r = await this.populationAround(point);
    return r ? populationBriefText(r) : null;
  }

  /** True when the bundle has a population grid and it is in memory. */
  get populationReady(): boolean {
    return this._population?.ready === true;
  }

  private _lngLatOf(point: any): [number, number] | null {
    if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) return [point[0], point[1]];
    const p = toMercatorShape(point)?.parts[0]?.[0];
    return p ? (mercatorToLngLat(p[0], p[1]) as [number, number]) : null;
  }

  private _placesSource(): ((at: MercXY, radiusM: number) => ReturnType<GroundGuideFeatures['placesNear']>) | undefined {
    const f = this._features;
    return f ? (at, radiusM) => f.placesNear(at, radiusM) : undefined;
  }

  /**
   * The card's B row: the people round the point being placed (or the cursor, for lines and areas), the card style,
   * and the civil flag when the unit type's threshold is met. Kept with the style `off` too: the Ground Brief uses it.
   */
  private _populationNear(geometry: any, v: GroundGuideVerdict): GroundGuidePopulation | null {
    const o = this._opts.population;
    const grid = this._population;
    if (!o.enabled || !grid?.ready || v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt') return null;
    const at = geometry?.type === 'point' ? toMercatorShape(geometry)?.parts[0]?.[0] : this._pointerMerc();
    if (!at) return null;
    const [lng, lat] = mercatorToLngLat(at[0], at[1]);
    const reading = grid.around(lng, lat, o.radiusKm, this._placesSource());
    if (!reading) return null;
    const rule = o.flag ? POPULATION_FLAGS[v.profile] : undefined;
    const people = rule ? (reading.rings.find((r) => r.km === rule.km)?.people ?? 0) : 0;
    return { reading, style: o.card, flag: rule && people >= rule.min ? { km: rule.km, people, message: rule.message } : null };
  }

  /** Fetch the population grid in the background when something needs it. */
  private _loadPopulation(): void {
    const g = this._population;
    if (this._enabled && this._opts.population.enabled && g && !g.ready) void g.load();
  }

  private _onPopulationReady(): void {
    EngineLogger.success(ENGINE, `Population grid ready (${this._population?.header?.layers.length ?? 0} layers, WorldPop ${this._population?.header?.year ?? ''})`);
    this._syncPopulationLayer();
    this._refreshLive();
  }

  /** Put the People layer and its key on the current view's map, or take them off. */
  private _syncPopulationLayer(): void {
    const o = this._opts.population;
    const grid = this._population;
    const view: any = this._getView?.();
    const map = view?.map;
    if (!(this._enabled && o.enabled && o.layer && grid?.ready && map)) {
      this._removePopulationLayer();
      return;
    }
    if (!this._popLayer) this._popLayer = createPopulationLayer(grid, o.layerOpacity);
    if (this._popLayerMap !== map) {
      this._popLayerMap?.remove(this._popLayer);
      map.add(this._popLayer, 0); // under the symbol graphics layers
      this._popLayerMap = map;
    }
    this._popLayer.opacity = o.layerOpacity;
    const host: HTMLElement | null = view?.container ?? null;
    if (host && !this._popKey) {
      ensurePopulationCss();
      this._popKey = populationKeyElement(String(grid.header?.year ?? ''));
      host.appendChild(this._popKey);
    }
  }

  private _removePopulationLayer(): void {
    if (this._popLayer) {
      this._popLayerMap?.remove(this._popLayer);
      this._popLayer.destroy?.();
    }
    this._popLayer = null;
    this._popLayerMap = null;
    this._popKey?.remove();
    this._popKey = null;
  }

  /** The indicator-line layer (null until a line has been drawn), for hosts that want to inspect or restyle it. */
  get indicatorLayer(): any {
    return this._indicators.layer;
  }

  /** True while tile decoding and overlay painting run in the Web Worker (false = main thread). */
  get tileWorkerActive(): boolean {
    return this._source?.workerActive === true;
  }

  // ── Going, soil and movement (GROTBC T) ──────────────────────────────────

  /** True while the Ground Detail is open. */
  get isDetailOpen(): boolean {
    return this._briefOpen;
  }

  /** The older name of `isDetailOpen` (the Ground Brief became the Ground Detail on 2026-11-06). */
  get isBriefOpen(): boolean {
    return this._briefOpen;
  }

  /** The tab the Ground Detail shows (G R O T B C, or L the Legend, opened with K). */
  get detailTab(): DetailTab {
    return this._detail.tab;
  }

  /**
   * Open or close the Ground Detail (the D key while drawing), on `tab` when given. It keeps the last draw's content
   * until closed. While it is open the docked legend is held back: the Legend tab has it.
   */
  showDetail(open = true, tab?: DetailTab): void {
    this._toggleBrief(open, tab);
  }

  /** The older name of `showDetail`. */
  showBrief(open = true): void {
    this._toggleBrief(open);
  }

  private _toggleBrief(open: boolean, tab?: DetailTab): void {
    if (tab !== undefined) this._detail.setTab(tab);
    if (open === this._briefOpen) return;
    this._briefOpen = open;
    if (!open) this._detail.hide();
    else {
      this._syncLegend(); // the Legend tab gets the legend as it stands
      if (!this._lastDetail) this._detail.open(); // no draw in progress: the Legend tab works, the letters wait for one
    }
    this._refreshLive();
    this._badge.reflow(); // opened: step aside of it, or fold to the chip; closed: back to the card (item 7)
  }

  /** The Legend tab's map switches: the overlay (and its opacity), the boundary, the People layer, indicator lines, the footprint outline. */
  private _legendInfo(): DetailLegendInfo {
    const o = this._opts;
    return {
      overlayOpacity: o.overlay.opacity,
      toggles: [
        { key: 'overlay', label: 'Going overlay', on: o.overlay.enabled, note: o.overlay.profile === 'auto' ? 'Paints the ground for the mode being drawn' : `Paints the ground for ${this._rules?.profiles?.[o.overlay.profile]?.label ?? o.overlay.profile}` },
        { key: 'boundary', label: 'Terrain data boundary', on: o.overlay.boundary, note: 'The outline of the ground the data covers' },
        { key: 'people', label: 'People layer', on: o.population.layer, note: 'People per km² on the map, with its key' },
        { key: 'indicators', label: 'Indicator lines', on: o.indicators.enabled, note: 'Lines from the symbol to the ground that decides the verdict' },
        { key: 'footprint', label: 'Footprint outline', on: o.footprint.outline, note: 'The echelon footprint the verdict is judged on' },
      ],
    };
  }

  /** A map switch in the Legend tab: change the option and tell the settings panel, as the legend's mode pick does. */
  private _toggleLayer(key: DetailToggle, on: boolean): void {
    const o = this._opts;
    switch (key) {
      case 'overlay': this.setOptions({ overlay: { ...o.overlay, enabled: on } }); setSetting(['groundGuide', 'overlay', 'enabled'], on); break;
      case 'boundary': this.setOptions({ overlay: { ...o.overlay, boundary: on } }); setSetting(['groundGuide', 'overlay', 'boundary'], on); break;
      case 'people': this.setOptions({ population: { ...o.population, layer: on } }); setSetting(['groundGuide', 'population', 'layer'], on); break;
      case 'indicators': this.setOptions({ indicators: { ...o.indicators, enabled: on } }); setSetting(['groundGuide', 'indicators', 'enabled'], on); break;
      default: this.setOptions({ footprint: { ...o.footprint, outline: on } }); setSetting(['groundGuide', 'footprint', 'outline'], on);
    }
    this._syncLegend();
  }

  /** Judge the cursor again now (settings changed, the brief opened). */
  private _refreshLive(): void {
    this._lastBadgeKey = '';
    const d = this._lastDetail;
    if (d && this.isActive) this._apply(this._judgeLive(d.geometry, d.sidc));
  }

  /** The bundle's soil layer names, or null when it has none (older bundle). */
  private _goingLayers(): { soil: string; dry: string; wet: string; wetLayer: string | null } | null {
    const l = this._manifest?.layers;
    if (!l?.soil || !l.rci_dry || !l.rci_wet || !this._rules?.grotbc?.soilStrength) return null;
    return { soil: l.soil, dry: l.rci_dry, wet: l.rci_wet, wetLayer: l.wet ?? null };
  }

  private _goingWanted(): boolean {
    const c = this._opts.card;
    const t = this._opts.traffic;
    if (this._briefOpen) return true;
    if (c.cursor !== 'full') return true; // the minimal card's key fact: the going in the other season (the point only)
    return (
      c.goingLines || c.movementRose || c.soilStrength || c.exitStrip || c.modeMatrix || c.seasonRibbon || c.goingMap ||
      t.pill || t.dual || t.header === 'season' || t.block !== 'off' || // T reads the going at the point too
      this._opts.speed.enabled // and so does speed
    );
  }

  /** The cursor card shows the extra sections (`card.cursor: full`), or the Ground Detail is open to show them. */
  private _extrasWanted(): boolean {
    return this._briefOpen || this._opts.card.cursor === 'full';
  }

  /**
   * The minimal cursor card ranks the things round the point (`card.nearest: ranked`, 2026-11-07): it needs the road
   * for the mode, the ITG candidates, the better cover and the obstacles even while the Detail is closed.
   */
  private _nearestWanted(): boolean {
    const c = this._opts.card;
    return c.cursor !== 'full' && c.nearest === 'ranked';
  }

  /** Tiles speed reads besides the going's: elevation (slope) and the terrain type (a day's march). */
  private _speedTileLayers(): string[] {
    if (!this._opts.speed.enabled || this._activeProfile === 'exempt') return [];
    const L = this._sectionLayers();
    return [L.elevHi, L.elevLo, L.terrain].filter((x): x is string => !!x);
  }

  /** How the soil changes the going (`traffic.rain`), for pixelGoing. */
  private _goingRule(): GoingRule {
    const r = this._opts.traffic.rain;
    if (r === 'words') return { kind: 'words' };
    if (r === 'bearing') {
      const rules = this._rules;
      return { kind: 'bearing', step: (soil, season, onFoot) => bearingStep(rules, soil, season, onFoot) };
    }
    return { kind: 'cone' };
  }

  /** Tiles the going sections read (prefetched with the class tiles while a symbol is armed). */
  private _goingTileLayers(): string[] {
    const L = this._goingLayers();
    if (!L || !(this._goingWanted() || this._opts.card.briefKey) || this._activeProfile === 'exempt') return [];
    return [L.soil, L.dry, L.wet, ...(L.wetLayer ? [L.wetLayer] : [])];
  }

  /** C: the bundle's cover layers, or null when it has no cover rules (older bundle). */
  private _coverLayers(): { cc: string | null; bank: string | null } | null {
    const l = this._manifest?.layers;
    if (!this._rules?.grotbc?.coverSplit) return null;
    return { cc: l?.cc ?? null, bank: l?.bank ?? null };
  }

  /** Tiles C reads (prefetched with the class tiles while a symbol is armed). */
  private _coverTileLayers(): string[] {
    const L = this._coverLayers();
    if (!L || !this._opts.cover.enabled || this._activeProfile === 'exempt') return [];
    return [L.cc, L.bank].filter((x): x is string => !!x);
  }

  /**
   * C at the point being placed (the cursor, for lines and areas): the four-way cover from the class split and any
   * bank, the local cc density, and (when the card style or the Brief wants it) the nearest better and the rose.
   */
  private _coverNear(geometry: any, v: GroundGuideVerdict): GroundGuideCover | null {
    if (v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt') return null;
    const o = this._opts.cover;
    const L = this._coverLayers();
    if (!o.enabled || !L || !this._cache) return null;
    // The minimal card shows the cover the mode needs (a key fact) whatever the full card's style.
    const minimal = this._opts.card.cursor !== 'full';
    if (!minimal && (o.card === 'off' || !this._extrasWanted()) && !this._briefOpen) return null;
    const at = geometry?.type === 'point' ? toMercatorShape(geometry)?.parts[0]?.[0] : this._pointerMerc();
    if (!at) return null;
    const z = this._sampleZoom();
    const { read, state } = this._pixelReader(z);
    const [, lat] = mercatorToLngLat(at[0], at[1]);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    return readCover({
      rules: this._rules?.grotbc ?? null,
      opts: o,
      profile: v.profile,
      at: [at[0], at[1]],
      cosLat,
      pxM: resolutionAt(z, this._manifest!.tileSize) * cosLat,
      layers: { cls: this._layerNames(v.profile).cls, cc: L.cc, bank: L.bank },
      read,
      classLabel: (c) => plainLabel(this._rules?.classes?.[String(c)]?.label ?? '') || `Class ${c}`,
      pending: () => state.pending,
      // Every style can say where better cover is (the mode's need line), and the Brief always does.
      scan: true,
      shelters: this._sheltersNear(at),
      ...this._coverExtras(at, read),
    });
  }

  /**
   * C (added 2026-11-06): the landform at the point and the nearest closed depression within 2 km (dead ground), and
   * the building density and height at the point. Read from tiles in memory; a piece not loaded yet is left out.
   */
  private _coverExtras(at: MercXY, read: (layer: string, mx: number, my: number) => number | null | undefined): { form: GroundGuideCover['form']; built: GroundGuideCover['built'] } {
    const L = this._sectionLayers();
    const books = (this._rules?.grotbc?.layers ?? {}) as Record<string, any>;
    const lf = L.landform ? read(L.landform, at[0], at[1]) : null;
    const landform = typeof lf === 'number' && lf > 0 && lf !== 255 ? (books.landform?.[String(lf)] as string | undefined) ?? null : null;
    const dep = this._features?.nearestOfKinds(at, 2000, SECTION_KINDS.depression, 1).list[0];
    const depression = dep ? { distanceM: dep.distanceM, compass: dep.compass, depthM: typeof dep.attrs.dp === 'number' ? dep.attrs.dp : null } : null;
    const bv = L.bld ? read(L.bld, at[0], at[1]) : null;
    let built: GroundGuideCover['built'] = null;
    if (typeof bv === 'number' && bv !== 255 && (bv & 7) > 0) {
      const density = (books.bld?.density?.[String(bv & 7)] as string | undefined) ?? `Density ${bv & 7}`;
      built = { density, height: BLD_HEIGHT[bv >> 6] ?? null };
    }
    return { form: landform || depression ? { landform, depression } : null, built };
  }

  /**
   * C: the nearest mapped cave, bunker, trench, road and railway tunnel (feature tiles), one per kind, up to three.
   * Reads tiles in memory only; while a tile loads and nothing is found, the radius is 0 so the card does not say
   * "none mapped" too early. Null when the bundle has no feature tiles.
   */
  private _sheltersNear(at: MercXY): { list: CoverShelter[]; radiusM: number } | null {
    const f = this._features;
    if (!f) return null;
    const res = f.nearestOfKinds(at, SHELTER_RADIUS_M, SECTION_KINDS.shelter, 40);
    const seen = new Set<string>();
    const list: CoverShelter[] = [];
    for (const h of res.list) {
      if (seen.has(h.kind)) continue;
      seen.add(h.kind);
      list.push({ label: h.kindLabel, name: h.name, distanceM: h.distanceM, compass: h.compass });
      if (list.length >= 3) break;
    }
    return { list, radiusM: res.pending && !list.length ? 0 : SHELTER_RADIUS_M };
  }

  /** The auxiliary layers the G / R / B sections read, by the names the manifest gives them (null when missing). */
  private _sectionLayers(): SectionsLayers {
    const l = this._manifest?.layers ?? {};
    const n = (k: string) => (typeof l[k] === 'string' ? (l[k] as string) : null);
    return { terrain: n('terrain'), landform: n('landform'), elevHi: n('elev_hi'), elevLo: n('elev_lo'), route: n('route'), bld: n('bld'), hut: n('hut'), cc: n('cc'), bank: n('bank') };
  }

  /** Tiles the switched-on sections read (prefetched with the class tiles while a symbol is armed). */
  private _sectionTileLayers(all = this._briefOpen || this._opts.card.briefKey): string[] {
    const o = this._opts.sections;
    if (this._activeProfile === 'exempt' || (o.style === 'brief' && !all && this._sectionsAllAuto())) return [];
    const L = this._sectionLayers();
    const out: Array<string | null> = [];
    if (o.ground || all) out.push(L.terrain, L.landform, L.elevHi, L.elevLo, L.cc, this._manifest?.layers?.wet ?? null);
    if (o.roads || all) out.push(L.route);
    if (o.buildings || all) out.push(L.bld, L.hut);
    if (o.obstacles || all) out.push(this._manifest?.layers?.wet ?? null, L.bank); // the class layer is warmed anyway
    return out.filter((x): x is string => !!x);
  }

  /** True when every section follows `sections.style` (so `brief` means nothing on the card). */
  private _sectionsAllAuto(): boolean {
    const o = this._opts.sections;
    return [o.gStyle, o.rStyle, o.oStyle, o.bStyle, o.wStyle].every((x) => !x || x === 'auto');
  }

  /** Admin areas, borders, sheets and named routes, loaded once when a section needs them. */
  private _placeData: GroundGuidePlaceData | null = null;
  private _places(all: boolean): GroundGuidePlaceData | null {
    const base = this._opts.bundleUrl;
    if (!base || !this._manifest) return null;
    if (!this._placeData) this._placeData = new GroundGuidePlaceData(base, () => this._refreshLive());
    const o = this._opts.sections;
    this._placeData.ensure({ admin: o.buildings || all, borders: o.buildings || all, sheets: o.buildings || all, routes: o.roads || all });
    return this._placeData;
  }

  /** A class's label, origin and GROTBC letters (rules.json `classes`), for the O section. */
  private _classInfo(c: number): { name: string; label: string; origin: 'natural' | 'man_made'; letters: string; kind: string } | null {
    const k = this._rules?.classes?.[String(c)] as { name?: string; label?: string; origin?: string; grotbc?: string; kind?: string } | undefined;
    if (!k?.label) return null;
    return { name: String(k.name ?? ''), label: plainLabel(k.label) || k.label, origin: k.origin === 'natural' ? 'natural' : 'man_made', letters: String(k.grotbc ?? ''), kind: String(k.kind ?? '') };
  }

  /** Read the G / R / B / W sections at a point (shared by the live card and `sectionsAround`). */
  private _readSections(
    at: MercXY,
    profile: GroundGuideProfile,
    z: number,
    all: boolean,
    radiusKm = this._opts.sections.radiusKm,
    opts: GroundGuideOptions['sections'] = this._opts.sections,
    /** Pixels only: no feature-index queries (power lines, dams, levees, closures), for the cursor card's Nearest. */
    pixelsOnly = false,
  ): GroundGuideSections {
    const m = this._manifest!;
    const { read, state } = this._pixelReader(z);
    const [lon, lat] = mercatorToLngLat(at[0], at[1]);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const g = this._rules?.grotbc;
    const books = g?.layers ?? {};
    const route = (books.route ?? {}) as Record<string, unknown>;
    const bld = (books.bld ?? {}) as Record<string, unknown>;
    let featuresPending = false;
    const f = pixelsOnly ? null : this._features;
    const features: SectionsFeatures | null = f
      ? {
          nearestOfKinds: (p, r, k, max, filter) => {
            const res = f.nearestOfKinds(p, r, k, max, filter);
            featuresPending ||= res.pending;
            return res;
          },
          linesNear: (p, r, k) => {
            const res = f.linesNear(p, r, k);
            featuresPending ||= res.pending;
            return res;
          },
          roadsNear: (p, r) => {
            const res = f.roadsNear(p, r);
            featuresPending ||= res.pending;
            return res;
          },
        }
      : null;
    const cp = this._profile(profile);
    return readSections({
      opts,
      profile,
      at,
      cosLat,
      pxM: resolutionAt(z, m.tileSize) * cosLat,
      zoom: z,
      maxZoom: m.zoom.max,
      radiusM: radiusKm * 1000,
      L: this._sectionLayers(),
      read,
      features,
      books: {
        terrain: books.terrain as Record<string, unknown> | undefined,
        landform: books.landform as Record<string, unknown> | undefined,
        routeTypes: route.types as Record<string, unknown> | undefined,
        routeTiers: route.tiers as Record<string, unknown> | undefined,
        bldDensity: bld.density as Record<string, unknown> | undefined,
        bldSize: bld.size as Record<string, unknown> | undefined,
        wet: books.wet as Record<string, unknown> | undefined,
      },
      rules: g ? { tankable: g.tankable, roadDensity: g.roadDensity, banks: g.banks as any } : null,
      lonLat: [lon, lat],
      clsLayer: this._layerNames(profile).cls,
      classInfo: (c) => this._classInfo(c),
      effect: (c) => (cp.exempt ? null : cp.nogo[c] ? 'NO-GO' : cp.caution[c] ? 'SLOW-GO' : null),
      wetLayer: this._manifest?.layers?.wet ?? null,
      place: this._places(all),
      roadNet: this._roads,
      waterKinds: g?.water?.kinds ?? ['tube_well', 'well_lined', 'well_unlined', 'spring', 'tank_perennial', 'karez'],
      climate: this._climate?.normalsAt(lon, lat) ?? null,
      month: resolveMonth(this._opts.going.month),
      all,
      pending: () => state.pending,
      featuresPending: () => featuresPending,
    });
  }

  /** The card's G / R / B / W sections at the point being placed (the cursor, for lines and areas). */
  private _sectionsNear(geometry: any, v: GroundGuideVerdict): GroundGuideSections | null {
    if (v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt' || !this._cache || !this._manifest) return null;
    const o = this._opts.sections;
    const at = geometry?.type === 'point' ? toMercatorShape(geometry)?.parts[0]?.[0] : this._pointerMerc();
    if (!at) return null;
    if (!this._briefOpen && !this._extrasWanted()) {
      // The minimal card's Nearest only needs the nearest natural and man-made obstacle class round the point (a pixel
      // scan): the terrain rays, road density and the feature queries cost 3 to 6 ms a move in a city and wait for the
      // Detail (measured 2026-11-07).
      if (!this._nearestWanted() || !o.obstacles) return null;
      return this._readSections(
        at,
        v.profile,
        this._sampleZoom(),
        false,
        o.radiusKm,
        { ...o, ground: false, roads: false, buildings: false, weather: false, roadDensity: false },
        true,
      );
    }
    const any = o.ground || o.roads || o.buildings || o.weather || o.obstacles;
    if (!any && !this._briefOpen) return null;
    if (o.style === 'brief' && !this._briefOpen && this._sectionsAllAuto()) return null;
    return this._readSections(at, v.profile, this._sampleZoom(), this._briefOpen);
  }

  /**
   * The G / R / B / W sections at a map point, read at the bundle's finest zoom with every section on: terrain type and
   * relief, the route and how it suits the mode (rules.json tankable), buildings and services, the month's weather.
   * Waits for the tiles and feature tiles. Null when the guide is off.
   */
  async sectionsAround(point: any, opts: { profile?: GroundGuideProfile; radiusKm?: number } = {}): Promise<GroundGuideSections | null> {
    const ll = this._lngLatOf(point);
    if (!ll || !this._cache || !this._manifest) return null;
    const m = this._manifest;
    const z = m.zoom.max;
    const at = lngLatToMercator(ll[0], ll[1]) as MercXY;
    const radiusKm = Math.min(10, Math.max(0.5, opts.radiusKm ?? this._opts.sections.radiusKm));
    const reach = 600 / Math.cos((ll[1] * Math.PI) / 180) + radiusKm * 1000; // terrain rays go out to the radius
    const a = mercatorToTilePixel(at[0] - reach, at[1] + reach, z, m.tileSize);
    const b = mercatorToTilePixel(at[0] + reach, at[1] - reach, z, m.tileSize);
    const L = this._sectionLayers();
    const profile0 = opts.profile ?? this._activeProfile ?? this._lastArmedProfile ?? 'dismounted';
    const more = [this._layerNames(profile0).cls, this._manifest.layers?.wet ?? null];
    for (let ty = a.ty; ty <= b.ty; ty++) {
      for (let tx = a.tx; tx <= b.tx; tx++) {
        for (const layer of [...Object.values(L), ...more]) if (layer) this._cache.request(layer, z, tx, ty);
      }
    }
    // Admin, borders, sheets and routes: start them and wait (once) until they are in memory.
    const places = this._places(true);
    for (let i = 0; i < 100 && places && !places.ensure({ admin: true, borders: true, sheets: true, routes: true }); i++) await new Promise((r) => setTimeout(r, 100));
    await Promise.all([
      this._tilesSettled(10000),
      this._features?.whenReady(at, Math.max(15000, radiusKm * 1000)),
      this._roads?.whenReady(at, this._opts.sections.roadDensityKm * 1000),
    ]);
    this._climate?.normalsAt(ll[0], ll[1]); // starts the climate grid if it is not in memory
    for (let i = 0; i < 20 && this._climate && this._climate.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 150));
    const profile = opts.profile ?? this._activeProfile ?? this._lastArmedProfile ?? 'dismounted';
    return this._readSections(at, profile, z, true, radiusKm);
  }

  /**
   * Road network density round a map point (GROTBC R, Road Connectivity): km of road and track per km² in a circle
   * (`radiusKm`, default `sections.roadDensityKm`), all-weather and fair-weather, MSR and tankable km, the band and
   * the ways out by direction. Read from the routing network the T road line uses; waits for its tiles. Null when the
   * guide is off or the bundle has no network.
   */
  async roadDensityAround(point: any, opts: { radiusKm?: number } = {}): Promise<RoadDensityReading | null> {
    const ll = this._lngLatOf(point);
    if (!ll || !this._roads) return null;
    const at = lngLatToMercator(ll[0], ll[1]) as MercXY;
    const radiusM = Math.min(10, Math.max(0.5, opts.radiusKm ?? this._opts.sections.roadDensityKm)) * 1000;
    await this._roads.whenReady(at, radiusM);
    const res = this._roads.densityAround(at, radiusM);
    return roadDensityReading(res.totals, res.pending, this._rules?.grotbc?.roadDensity);
  }

  /** `sectionsAround()` as Copy as Text lines; null when there is no reading. */
  async sectionsText(point: any, opts: { profile?: GroundGuideProfile; radiusKm?: number } = {}): Promise<string[] | null> {
    const s = await this.sectionsAround(point, opts);
    return s ? sectionsText(s) : null;
  }

  /** Do the movement sections apply to this symbol (`going.movementFor`)? */
  private _movementApplies(geometry: any, sidc: string | null): boolean {
    const f = this._opts.going.movementFor;
    if (f === 'all') return true;
    if (geometry?.type !== 'point') return false;
    if (f === 'points') return true;
    const s = normaliseSidc(sidc);
    const set = s ? s.slice(4, 6) : '';
    return set === '10' || set === '15'; // land unit, land equipment
  }

  /** Synchronous pixel reads at one zoom, memoising tiles; `pending` turns true when a tile is still on its way. */
  private _pixelReader(z: number) {
    const cache = this._cache!;
    const ts = this._manifest!.tileSize;
    const n = 2 ** z;
    const b = this._boundsMerc;
    const memo = new Map<string, Uint8Array | null | undefined>();
    const state = { pending: false };
    const read = (layer: string, mx: number, my: number): number | null | undefined => {
      if (mx < b[0] || mx > b[2] || my < b[1] || my > b[3]) return null;
      const tp = mercatorToTilePixel(mx, my, z, ts);
      if (tp.tx < 0 || tp.ty < 0 || tp.tx >= n || tp.ty >= n) return null;
      const key = `${layer}/${tp.tx}/${tp.ty}`;
      let t = memo.get(key);
      if (!memo.has(key)) {
        t = cache.peek(layer, z, tp.tx, tp.ty);
        memo.set(key, t);
      }
      if (t === undefined) {
        state.pending = true;
        return undefined;
      }
      return t === null ? null : t[tp.py * ts + tp.px];
    };
    return { read, state };
  }

  /** What limits the going, in words, for the card. */
  private _causeText(cause: GoingCause, cls: number | null | undefined, coarse: boolean, season: GoingSeason): string | null {
    if (cause === 'class') return cls !== null && cls !== undefined ? plainLabel(this._rules?.classes?.[String(cls)]?.label ?? '') || null : null;
    if (cause === 'soil') return coarse ? (season === 'dry' ? 'Loose sand' : 'Wet sand') : season === 'dry' ? 'Soft soil' : 'Soft soil after rain';
    if (cause === 'wet') return 'Flood-prone or waterlogged Gr';
    return null;
  }

  /**
   * Going, soil and movement round the point being placed (the cursor, for lines and areas): what the card's going
   * sections and the Ground Brief show. Null when no section wants it or the bundle has no soil layers.
   */
  private _goingNear(geometry: any, sidc: string | null, v: GroundGuideVerdict): GroundGuideGoingInfo | null {
    if (v.verdict === 'unknown' || v.verdict === 'off' || v.verdict === 'exempt') return null;
    const L = this._goingLayers();
    if (!L || !this._cache || !this._goingWanted()) return null;
    const at = geometry?.type === 'point' ? toMercatorShape(geometry)?.parts[0]?.[0] : this._pointerMerc();
    if (!at) return null;
    const o = this._opts.going;
    const c = this._opts.card;
    const brief = this._briefOpen;
    const z = this._sampleZoom();
    const { read, state } = this._pixelReader(z);
    const clsLayer = this._layerNames(v.profile).cls;
    const [lon, lat] = mercatorToLngLat(at[0], at[1]);

    // Season: by hand, or from the month's rain at the point (Jul-Sep wet when the bundle has no climate).
    const precMm = this._climate?.precAt(lon, lat) ?? null;
    const { season, month } = resolveSeason(o, precMm);

    // The point.
    const cls = read(clsLayer, at[0], at[1]);
    const rDryV = read(L.dry, at[0], at[1]);
    const rWetV = read(L.wet, at[0], at[1]);
    const wetV = L.wetLayer ? read(L.wetLayer, at[0], at[1]) : null;
    const soilV = decodeSoil(read(L.soil, at[0], at[1]));
    const rDry = decodeRci(rDryV);
    const rWet = decodeRci(rWetV);
    const coarse = (rDry ?? rWet)?.coarse ?? false;
    const cp = this._profile(v.profile);
    const veh = vehicleFor(this._rules, v.profile);
    const rule = this._goingRule();
    const soilRaw = rule.kind === 'bearing' ? read(L.soil, at[0], at[1]) : null;
    const gDry = pixelGoing({ cls, rci: rDryV, wet: wetV, soil: soilRaw }, cp, veh, 'dry', rule);
    const gWet = pixelGoing({ cls, rci: rWetV, wet: wetV, soil: soilRaw }, cp, veh, 'wet', rule);
    const g = this._rules?.grotbc;
    const soil = soilV
      ? {
          texture: soilV.texture,
          label: String(g?.layers?.soil?.[String(soilV.texture)] ?? `Soil ${soilV.texture}`),
          confidence: soilV.confidence,
          confidenceLabel: String(
            g?.layers?.soilConfidence?.[String(soilV.confidence)] ?? g?.soilStrength?.confidence?.labels?.[String(soilV.confidence)] ?? '',
          ),
          mapped: soilV.mapped,
          note: g?.soilBearing?.[String(soilV.texture)]?.note ?? null,
          ciDry: rDry?.ci ?? null,
          ciWet: rWet?.ci ?? null,
          coarse,
        }
      : null;

    // The three main modes (and the one being placed, when it is another), at the same pixel.
    const modeList: string[] = ['dismounted', 'wheeled', 'tracked'].filter((p) => this._manifest!.profiles.includes(p));
    if (!modeList.includes(v.profile)) modeList.push(v.profile);
    const modes: GroundGuideGoingInfo['modes'] = [];
    for (const p of modeList) {
      const pcp = this._profile(p as GroundGuideProfile);
      const pv = vehicleFor(this._rules, p);
      const d = pixelGoing({ cls, rci: rDryV, wet: wetV, soil: soilRaw }, pcp, pv, 'dry', rule);
      const w = pixelGoing({ cls, rci: rWetV, wet: wetV, soil: soilRaw }, pcp, pv, 'wet', rule);
      if (d && w) modes.push({ profile: p, label: this._rules?.profiles?.[p]?.label ?? p, dry: d.step, wet: w.step, active: p === v.profile });
    }

    const moveOk = this._movementApplies(geometry, sidc);
    const rangeM = o.rangeKm * 1000;
    const layerFor = season === 'dry' ? L.dry : L.wet;
    const sample = (x: number, y: number) => {
      const pc = read(clsLayer, x, y);
      const pg = pixelGoing(
        { cls: pc, rci: read(layerFor, x, y), wet: L.wetLayer ? read(L.wetLayer, x, y) : null, soil: rule.kind === 'bearing' ? read(L.soil, x, y) : null },
        cp,
        veh,
        season,
        rule,
      );
      return pg ? { ...pg, cls: pc } : null;
    };
    const tb = this._opts.traffic.block;
    const tMove = tb === 'band' || tb === 'rose' || tb === 'tabs'; // T blocks that say how open the ground is
    // The minimal card with the Detail closed reads the point only; the rays and the map wait for the Detail.
    const full = brief || c.cursor === 'full';
    const movement = full && moveOk && (c.movementRose || c.exitStrip || brief || tMove) ? this._rays(at, lat, z, rangeM, sample, coarse, season) : null;
    const map = full && moveOk && (c.goingMap || brief) ? this._goingGrid(at, lat, rangeM, brief ? 33 : 25, sample) : null;

    return {
      season,
      month,
      vehicle: veh ? { label: veh.label, vci: coarse ? veh.coarse : veh.fine } : null,
      soil,
      point:
        gDry && gWet
          ? {
              dry: gDry.step,
              wet: gWet.step,
              limitDry: this._causeText(gDry.cause, cls, coarse, 'dry'),
              limitWet: this._causeText(gWet.cause, cls, coarse, 'wet'),
            }
          : null,
      modes,
      movement,
      climate: precMm ? { precMm, wetMm: o.wetMonthMm } : null,
      map,
      pending: state.pending,
    };
  }

  /** Eight rays to `rangeM`: how far each direction goes before the first NO-GO, and its going on the way. */
  private _rays(
    at: MercXY,
    lat: number,
    z: number,
    rangeM: number,
    sample: (x: number, y: number) => { step: GoingStep; cause: GoingCause; cls: number | null | undefined } | null,
    coarse: boolean,
    season: GoingSeason,
  ) {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const groundPx = resolutionAt(z, this._manifest!.tileSize) * cosLat;
    const n = Math.min(80, Math.max(4, Math.ceil(rangeM / groundPx)));
    const stepG = rangeM / n;
    const stepM = stepG / cosLat;
    const sectors: GroundGuideMovementSector[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 * Math.PI) / 180;
      const dx = Math.sin(a);
      const dy = Math.cos(a);
      let reach = rangeM;
      let slow = 0;
      let walked = 0;
      let blockedBy: string | null = null;
      for (let k = 1; k <= n; k++) {
        const x = at[0] + dx * k * stepM;
        const y = at[1] + dy * k * stepM;
        const g = sample(x, y);
        if (!g) continue; // no data (or still loading) here: skip the sample
        walked++;
        if (g.step === 'nogo') {
          reach = (k - 0.5) * stepG;
          blockedBy = this._causeText(g.cause, g.cls, coarse, season);
          break;
        }
        if (g.step === 'slow') slow++;
      }
      const step: GoingStep = reach < Math.min(250, rangeM / 4) ? 'nogo' : walked && slow / walked > 0.4 ? 'slow' : 'go';
      sectors.push({ bearingDeg: i * 45, compass: COMPASS8[i], step, reachM: reach, blockedBy });
    }
    return rateMovement(sectors, rangeM);
  }

  /** Going on a size x size grid over the range square round the point (outside the circle = 255). */
  private _goingGrid(
    at: MercXY,
    lat: number,
    rangeM: number,
    size: number,
    sample: (x: number, y: number) => { step: GoingStep } | null,
  ): GroundGuideGoingInfo['map'] {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const cells = new Uint8Array(size * size).fill(255);
    for (let r = 0; r < size; r++) {
      const gy = (1 - ((r + 0.5) / size) * 2) * rangeM;
      for (let q = 0; q < size; q++) {
        const gx = (((q + 0.5) / size) * 2 - 1) * rangeM;
        if (gx * gx + gy * gy > rangeM * rangeM) continue;
        const g = sample(at[0] + gx / cosLat, at[1] + gy / cosLat);
        if (g) cells[r * size + q] = GOING_CODE[g.step];
      }
    }
    return { size, cells, rangeM };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _profile(name: GroundGuideProfile): CompiledProfile {
    let c = this._compiled.get(name);
    if (!c) {
      c = compileProfile(this._rules, name);
      this._compiled.set(name, c);
    }
    return c;
  }

  private _blank(verdict: GroundGuideVerdict['verdict'], profile: GroundGuideProfile, message: string): GroundGuideVerdict {
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

  private _layerNames(profile: GroundGuideProfile): { cls: string; dist: string | null } {
    return layerNames(this._manifest!, profile);
  }

  /** Per-evaluation lookup state: layer names resolved once, last tile memoised. */
  private _readContext(profile: GroundGuideProfile, zoom?: number): ReadContext {
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
  private _apply(v: GroundGuideVerdict): void {
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
      this._indicators.show(v.indicators, this._opts.indicators.labels, verdictTone(v));
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
  private _showBadge(v: GroundGuideVerdict): void {
    const key = [
      v.verdict, v.message, v.detail ?? '', v.loading ? 1 : 0, Math.round(v.fraction * 100),
      Math.round(v.nearest?.distanceM ?? -1), v.nearest?.compass ?? '',
      v.spacing?.status ?? '', Math.round(v.spacing?.nearestGapM ?? -1), v.snappable ? 1 : 0,
      v.ground?.candidates.map((c) => `${c.kind}${c.level}${Math.round(c.distanceM / 50)}${c.compass}`).join(',') ?? '',
      goingKey(v.going), v.briefKey ? 1 : 0,
      populationKey(v.population),
      trafficKey(v.traffic),
      speedKey(v.speed),
      coverKey(v.cover),
      sectionsKey(v.sections),
    ].join('|');
    if (key === this._lastBadgeKey) return;
    this._lastBadgeKey = key;
    if (this._opts.showBadge && v.verdict !== 'off' && v.verdict !== 'exempt') this._badge.show(v);
    else this._badge.hide();
    if (this._briefOpen && v.verdict !== 'off' && v.verdict !== 'exempt') {
      this._detail.show(v);
      this._badge.reflow(); // the Detail may have just opened under the card: step aside (item 7)
    }
  }

  private _publish(v: GroundGuideVerdict): void {
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
    this._emit('ground-guide-advice', v);
  }

  private _onTilesChanged(terrain = true): void {
    if (terrain) {
      this._emit('ground-guide-tiles', this.tileStats());
      if (this._tileWaiters.length > 0 && (this._cache?.stats().pending ?? 0) === 0) {
        for (const wake of this._tileWaiters.splice(0)) wake();
      }
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
    const profiles: GroundGuideProfile[] = [];
    if (this._activeProfile) profiles.push(this._activeProfile);
    else if (perLayer * (m.profiles.length + 1) <= this._opts.cacheTiles * 0.9) {
      profiles.push(...(m.profiles as GroundGuideProfile[]));
    } else {
      profiles.push(this._overlayProfileNow());
    }
    const layers = new Set<string>();
    for (const p of profiles) {
      const { cls, dist } = this._layerNames(p);
      layers.add(cls);
      if (dist) layers.add(dist);
    }
    if (this._activeProfile) for (const l of [...this._goingTileLayers(), ...this._coverTileLayers(), ...this._sectionTileLayers(), ...this._speedTileLayers()]) layers.add(l);
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
  private _warmAround(geometry: any, profile: GroundGuideProfile): void {
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
    const going = [...this._goingTileLayers(), ...this._coverTileLayers(), ...this._sectionTileLayers(), ...this._speedTileLayers()];
    for (let ty = Math.max(0, tp.ty - R); ty <= Math.min(n - 1, tp.ty + R); ty++) {
      for (let tx = Math.max(0, tp.tx - R); tx <= Math.min(n - 1, tp.tx + R); tx++) {
        cache.request(cls, z, tx, ty);
        if (dist) cache.request(dist, z, tx, ty);
        for (const l of going) cache.request(l, z, tx, ty);
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
        if (stationary) {
          this._prefetch();
          this._checkOverlaySeason();
        }
      },
      { initial: true }, // warm the current viewport now, not on the first pan or draw
    );
    // Where north points on screen: the 2D rotation, or the opposite of the 3D camera heading. The cards' dials, roses and arrows follow it.
    this._northHandle = reactiveUtils.watch(
      () => screenNorth(view),
      (north: number) => {
        this._badge.setNorth(north);
        this._detail.setNorth(north);
      },
      { initial: true },
    );
  }

  private _unbindView(): void {
    this._stationaryHandle?.remove();
    this._stationaryHandle = null;
    this._northHandle?.remove();
    this._northHandle = null;
  }

  /** The key handler lives as long as the guide is enabled (D and K work before a draw); the pointer handler only while drawing. */
  private _attachKeys(): void {
    if (this._keyHandler) return;
    this._keyHandler = (e: KeyboardEvent) => this._onKey(e);
    this._blurHandler = () => (this._shift = false); // keyup lands elsewhere on Alt-Tab
    window.addEventListener('keydown', this._keyHandler, true);
    window.addEventListener('keyup', this._keyHandler, true);
    window.addEventListener('blur', this._blurHandler);
  }

  private _detachKeys(): void {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler, true);
      window.removeEventListener('keyup', this._keyHandler, true);
      this._keyHandler = null;
    }
    if (this._blurHandler) {
      window.removeEventListener('blur', this._blurHandler);
      this._blurHandler = null;
    }
  }

  private _attachPointer(): void {
    if (this._pointerHandler) return;
    this._attachKeys();
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
    const tabKey = k === 'g' || k === 'r' || k === 'o' || k === 't' || k === 'b' || k === 'c' || k === 'k'; // K = the Legend tab (L is Lasso Select)
    if ((k !== 's' && k !== 'p' && k !== 'd' && k !== 'h' && k !== 'escape' && !tabKey) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (k === 'escape') {
      // The first Esc closes only the Detail (user, 2026-11-08): it is stopped here, before the draw tool or the app's
      // shortcuts see it, so the draw goes on; a second Esc, with the Detail closed, cancels the draw as before.
      if (this._briefOpen) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._toggleBrief(false);
      }
      return;
    }
    if (k === 'd' || tabKey) {
      // D opens or closes the Ground Detail (before a draw too: the Legend tab); a letter opens it on that tab (K the Legend).
      // The same letter again turns to the tab's next page when it has one (the card never scrolls: the mouse is busy
      // placing the symbol, user 2026-11-07); from the last page it wraps to the first, and Shift + the letter goes back
      // a page (user, 2026-11-08). The letter no longer closes the card: D and Esc do.
      if (!this._opts.card.briefKey || !this.isActive || this._activeProfile === 'exempt') return;
      e.preventDefault();
      if (k === 'd') this._toggleBrief(!this._briefOpen);
      else {
        const tab = (k === 'k' ? 'L' : k.toUpperCase()) as DetailTab;
        if (this._briefOpen && this._detail.tab === tab) {
          if (e.shiftKey) this._detail.prevPage();
          else this._detail.nextPage();
        } else this._toggleBrief(true, tab);
      }
      return;
    }
    if (k === 'h') {
      // H: the cursor card shrinks to a hint chip (GO / SLOW-GO / NO-GO) so the map under the symbol shows, and H again
      // brings the card back (user, 2026-11-07). Only while drawing, like P: H is free for anything else otherwise.
      if (!this.isActive || !this._lastDetail || this._activeProfile === 'exempt') return;
      e.preventDefault();
      this._badge.toggleHint();
      return;
    }
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
  private _overlayProfileNow(): GroundGuideProfile {
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
          getGoing: (p) => this._overlayGoing(p),
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
  private _legendProfile(): GroundGuideProfile {
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
    if (!this._enabled || !rules || !this._manifest || !view) {
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
    const state: LegendState = {
      modes: this.profileChoices.map((p) => ({ key: p, label: rules.profiles?.[p]?.label ?? p })),
      current: profile,
      tag,
      hand,
      entries: OVERLAY_LEGEND.map((e) => ({ label: e.label, rgba: OVERLAY_COLORS[e.key] })),
      // What Marginal means, in the ladder's words (item 1): GO ground with NO-GO close by.
      note: `${label('near')}: GO Gr within ${fmtDistance(this._opts.nearThresholdM)} of ${label('nogo')}`,
      // A vessel needs water: everything off it is NO-GO, so say that rather than list every land class.
      nogo: rule?.requires?.length ? [`Anywhere Off ${classes(rule.requires).join(' / ')}`] : classes(rule?.nogo),
      slow: classes(rule?.caution),
      keys: keyboard ? { profile: this._opts.profileKey, snap: this._opts.snapKey } : null,
      traffic: this._legendTraffic(),
      speed: this._legendSpeed(drawing),
    };
    this._legend.hide(); // the docked card is retired (2026-11-06): the Ground Detail's Legend tab (K) is the legend
    this._detail.setLegend(state, this._legendInfo());
  }

  /** Speed on the legend (`speed.legend`): the mover while drawing and a Day / Night switch. */
  private _legendSpeed(drawing: boolean): { caption: string; light: SpeedLight } | undefined {
    const o = this._opts.speed;
    if (!o.enabled || !o.legend) return undefined;
    const t = this._speedTablesNow();
    const mover = drawing ? this.moverFor(this._activeSidc, this._activeProfile ?? undefined) : o.mover !== 'auto' ? { label: t.movers[o.mover]?.short ?? o.mover } : null;
    const who = mover ? ` · ${'key' in mover ? t.movers[mover.key]?.short ?? mover.label : mover.label}` : '';
    return { caption: `Speed${who} · ${o.light === 'night' ? 'Night' : 'Day'} · ${o.road === 'convoy' ? 'Column' : 'One Vehicle'}`, light: o.light };
  }

  /** T on the legend (`traffic.legend`): a caption naming the season, with a Dry / After Rain switch or a month stepper. */
  private _legendTraffic(): { caption: string; season?: 'dry' | 'wet'; month?: string } | undefined {
    const style = this._opts.traffic.legend;
    if (style === 'none') return undefined;
    const o = this._opts.going;
    const season = this._viewSeason();
    const what = this._opts.traffic.overlay && this._overlay ? 'Going' : 'Trafficability';
    const when = o.season === 'auto' ? `${monthName(resolveMonth(o.month))}, ${season === 'wet' ? 'Wet' : 'Dry'}` : season === 'wet' ? 'After Rain' : 'Dry Season';
    const caption = `T · ${what} · ${when}`;
    if (style === 'season') return { caption, season };
    if (style === 'month') {
      const c = (this._getView?.() as any)?.center;
      const p = c ? toMercatorShape(c)?.parts[0]?.[0] : null;
      const m = resolveMonth(o.month);
      const prec = p ? this._climate?.precAt(...(mercatorToLngLat(p[0], p[1]) as [number, number])) ?? null : null;
      const rain = prec ? ` · ${Math.round(prec[m - 1])} mm` : '';
      return { caption, month: `${monthName(m)}${rain}${o.season === 'auto' ? '' : ' (Season Set by Hand)'}` };
    }
    return { caption };
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
  private _legendPick(profile: GroundGuideProfile): void {
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
    setSetting(['groundGuide', 'overlay', 'profile'], profile);
  }

  /** Once per browser: tell whoever just got the guide what it does, since nothing shows until a symbol is picked. */
  private _firstUseHint(): void {
    if (this._hintedThisSession || this._opts.mode === 'off' || this._activeSidc !== null) return;
    this._hintedThisSession = true;
    try {
      if (localStorage.getItem(FIRST_USE_KEY)) return;
      localStorage.setItem(FIRST_USE_KEY, '1');
    } catch {
      /* storage blocked: the session flag still keeps it to once per page */
    }
    this._legend.hint('Ground Guide is on: pick a symbol and terrain advice follows your cursor.', 'first-use', 7000);
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
    this._emit('ground-guide-state-change', { state, isEnabled: this._enabled, error });
  }

  private _emit(type: string, detail: unknown): void {
    const target: EventTarget = ((this._getView?.() as any)?.container as HTMLElement | undefined) ?? document;
    target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}
